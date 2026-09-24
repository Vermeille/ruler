import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/world';
import { step } from '../src/sim/engine';
import { clamp } from '../src/sim/math';
import { forecastBudget } from '../src/sim/policy';
import {
  adaptationRule, consumptionRule, eventRule, financingRule, fiscalRule, marketRule,
  migrationRule, populationDemographicsRule, productionRule, societyRule, taxationRule, tradeRule,
} from '../src/sim/rules';
import type { Effect, Game, Mapxel, MutableField, Rule } from '../src/sim/types';

const tiny = () => createGame('rule-contract', 12, 12, 48);
const land = (g: Game) => g.model.cells.find(c => c.biome !== 'water')!;
const effects = (rule: Rule, g: Game, random = (_cell: number, _channel = '') => .5, lastEvents: Record<string, number> = {}) => rule.run({ model: g.model, random, lastEvents });
const delta = (all: Effect[], cell: number, field: MutableField) => {
  const found = all.find(e => e.kind === 'delta' && e.cell === cell && e.field === field);
  assert.ok(found && found.kind === 'delta', `Missing ${field} delta for cell ${cell}`);
  return found.amount;
};
const near = (actual: number, expected: number, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const migrationEffects = (game: Game, draw: number) => effects(migrationRule, game, () => draw);
const outboundMigrants = (game: Game, from: number, draw: number) => migrationEffects(game, draw)
  .filter((effect): effect is Extract<Effect, { kind: 'population-transfer' }> =>
    effect.kind === 'population-transfer' && effect.from === from)
  .reduce((sum, effect) => sum + effect.amount, 0);
const expectedOutboundMigrants = (game: Game, from: number, samples = 400) => {
  let total = 0;
  for (let index = 0; index < samples; index += 1) {
    total += outboundMigrants(game, from, (index + 0.5) / samples);
  }
  return total / samples;
};

test('production depends on labor, terrain, weather and Clean Air, with an explicit export receipt', () => {
  const g = tiny(), c = land(g), e = effects(productionRule, g);
  const labor = c.employment * (.65 + .35 * c.health);
  const weather = 1 + Math.sin(g.model.tick * Math.PI / 6) * .09;
  const food = c.population * c.agriculture * (3 + 2 * c.fertility) * labor * weather * (1 - c.pollution * .18) * (1 - c.waterStress * .6);
  near(delta(e, c.id, 'food'), food);
  near(delta(e, c.id, 'foodMade'), food);
  const dry = structuredClone(g); dry.model.cells[c.id].waterStress = .4;
  near(delta(effects(productionRule, dry), c.id, 'foodMade'), food * .76);
  const output = c.population * labor * (c.agriculture * 6 * c.price + c.manufacturing * 10 + c.services * 9 * c.businessHealth + c.sports * (4 + c.sportsInterest * 7));
  near(delta(e, c.id, 'output'), output - c.output);
  assert.ok(e.some(x => x.kind === 'transfer' && x.from === 'external' && x.to === c.id && Math.abs(x.amount - output * .65) < 1e-7));
  const clean = structuredClone(g); clean.model.policy.laws.cleanAir = true;
  assert.ok(delta(effects(productionRule, clean), c.id, 'materials') < delta(e, c.id, 'materials'));
  assert.ok(delta(effects(productionRule, clean), c.id, 'output') < delta(e, c.id, 'output'));
});

test('neighbor trade moves toward equal stock per resident and better roads increase the offer', () => {
  const g = tiny(), a = g.model.cells.find(c => c.biome !== 'water' && g.model.neighbors[c.id].length)!;
  const b = g.model.cells[g.model.neighbors[a.id][0]];
  for (const c of g.model.cells) if (c.biome !== 'water') c.food = c.population;
  a.food = 3 * a.population;
  const offer = (game: Game) => effects(tradeRule, game).find(e => e.kind === 'trade' && e.resource === 'food' && e.from === a.id && e.to === b.id);
  const low = offer(g); assert.ok(low && low.kind === 'trade' && low.amount > 0);
  const highRoad = structuredClone(g); highRoad.model.cells[a.id].infrastructure = 1; highRoad.model.cells[b.id].infrastructure = 1;
  const high = offer(highRoad); assert.ok(high && high.kind === 'trade' && high.amount > low.amount);
  near(high.price, (a.price + b.price) / 2);
});

test('households consume available food, spoil leftovers and pay imports without minting cash', () => {
  const g = tiny(), c = land(g); c.food = c.population * .5; c.materials = c.population * .4;
  const e = effects(consumptionRule, g);
  near(delta(e, c.id, 'food'), -c.food);
  near(delta(e, c.id, 'foodSecurity'), -.5);
  near(delta(e, c.id, 'foodUsed'), c.food - c.foodUsed);
  near(delta(e, c.id, 'materials'), -(c.population * .08 + c.materials * .12));
  const payment = e.find(x => x.kind === 'transfer' && x.from === c.id && x.to === 'external');
  assert.ok(payment && payment.kind === 'transfer');
  near(payment.amount, c.population * (1.6 + c.cash / c.population * .04) + c.output * .09);
  const next = step(g, [consumptionRule]);
  near(next.model.cells[c.id].food, 0);
  near(next.model.cells[c.id].foodSecurity, .5);
});

test('scarcity raises food prices and lowers business health in the market rule', () => {
  const fed = tiny(), c = land(fed); c.foodUsed = c.population; c.food = c.population; c.foodSecurity = 1;
  const short = structuredClone(fed); short.model.cells[c.id].foodUsed = 0; short.model.cells[c.id].food = 0; short.model.cells[c.id].foodSecurity = .4;
  const a = effects(marketRule, fed), b = effects(marketRule, short);
  assert.ok(delta(b, c.id, 'price') > delta(a, c.id, 'price'));
  assert.ok(delta(b, c.id, 'businessHealth') < delta(a, c.id, 'businessHealth'));
  near(delta(b, c.id, 'price'), .14 * (clamp(1 + 1.3 + .6 * 1.8, .55, 4.5) - c.price));
});

test('food price controls separate posted prices from the local scarcity signal', () => {
  const g = tiny(), c = land(g);
  c.foodSecurity = .25; c.foodUsed = c.population * .25; c.food = 0;
  const free = step(g, [marketRule]);
  const controlled = structuredClone(g);
  controlled.model.policy.laws.foodPriceControls = true;
  const capped = step(controlled, [marketRule]);
  assert.ok(free.model.cells[c.id].price > 1);
  near(capped.model.cells[c.id].price, 1);
  near(capped.model.cells[c.id].scarcityPrice, free.model.cells[c.id].scarcityPrice);
  assert.ok(capped.model.cells[c.id].scarcityPrice > capped.model.cells[c.id].price);
});

test('tax collection is cash-capped, while the fiscal forecast uses measured output', () => {
  const g = tiny(), c = land(g); c.cash = 1; c.output = 1000;
  const due = Math.min(c.cash, c.output * (.7 * g.model.policy.incomeTax + .3 * g.model.policy.businessTax));
  const e = effects(taxationRule, g);
  assert.ok(e.some(x => x.kind === 'transfer' && x.from === c.id && x.to === 'treasury' && x.amount === due));
  const expected = g.model.cells.filter(x => x.biome !== 'water').reduce((s, x) => s + Math.min(x.cash, x.output * (.7 * g.model.policy.incomeTax + .3 * g.model.policy.businessTax)), 0);
  const next = step(g, [taxationRule]);
  near(next.model.budget.revenue, expected);
  assert.ok(forecastBudget(g.model).revenue > expected);
  near(next.model.treasury - g.model.treasury, expected);
});
test('cash exhausted to floating-point precision never requests a negative tax transfer', () => {
  const g = tiny(), c = land(g);
  c.cash = -1e-14;
  const payment = effects(taxationRule, g).find(e => e.kind === 'transfer' && e.from === c.id);
  assert.ok(payment && payment.kind === 'transfer');
  assert.equal(payment.amount, 0);
});

test('financing borrows only up to the remaining debt limit', () => {
  const g = tiny(), population = g.initial.population;
  g.model.treasury = 0; g.model.debt = population * 30 - 10;
  const financed = step(g, [financingRule]);
  near(financed.model.budget.borrowed, 10);
  near(financed.model.debt, population * 30);
});

test('fiscal payments share scarce cash proportionally', () => {
  const fiscal = tiny(); fiscal.model.treasury = 100; fiscal.model.externalCash = 1e12;
  const forecast = forecastBudget(fiscal.model);
  const paid = step(fiscal, [fiscalRule]);
  near(paid.model.budget.funding, 100 / forecast.spending);
  near(paid.model.budget.spending, 100);
  near(paid.model.treasury, 0, 1e-5);
});

test('fiscal surplus above operating reserves repays debt with an explicit cash transfer', () => {
  const g = tiny(), reserve = g.initial.population * 6;
  g.model.debt = reserve * 2;
  const forecast = forecastBudget(g.model);
  g.model.treasury = reserve + forecast.spending + forecast.interest + reserve;
  const totalCash = g.model.treasury + g.model.externalCash + g.model.cells.reduce((sum, c) => sum + c.cash, 0);
  const paid = step(g, [fiscalRule]);
  near(paid.model.debt, g.model.debt - reserve);
  near(paid.model.treasury, reserve);
  near(paid.model.budget.interest, forecast.interest);
  near(paid.model.treasury + paid.model.externalCash + paid.model.cells.reduce((sum, c) => sum + c.cash, 0), totalCash, .001);
});

test('floating-point exhausted treasury never requests negative fiscal transfers', () => {
  const g = tiny();
  g.model.treasury = -1e-12;
  const proposed = effects(fiscalRule, g).filter((effect): effect is Extract<Effect, { kind: 'transfer' | 'repayDebt' }> =>
    effect.kind === 'transfer' || effect.kind === 'repayDebt');
  assert.ok(proposed.every(effect => effect.amount >= 0));
});

test('society responds separately to food, spending, taxes, business health and liberties', () => {
  const base = tiny(), c = land(base);
  const changed = (edit: (cell: Mapxel, game: Game) => void, field: MutableField) => {
    const variant = structuredClone(base); edit(variant.model.cells[c.id], variant);
    return delta(effects(societyRule, variant), c.id, field) - delta(effects(societyRule, base), c.id, field);
  };
  assert.ok(changed((cell) => { cell.foodSecurity = .2; }, 'health') < 0);
  assert.ok(changed((_, g) => { g.model.policy.spending.health = 1; }, 'health') > 0);
  assert.ok(changed((_, g) => { g.model.policy.incomeTax = .6; }, 'approval') < 0);
  assert.ok(changed((cell) => { cell.businessHealth = .2; }, 'employment') < 0);
  assert.ok(changed((_, g) => { g.model.policy.laws.publicAssembly = false; }, 'happiness') < 0);
  assert.ok(changed((_, g) => { g.model.policy.laws.cleanAir = true; }, 'pollution') < 0);
  assert.ok(changed((_, g) => { g.model.policy.spending.police = 0; }, 'crime') > 0);
});

test('a wage floor reduces viable service firms and hiring according to local payroll capacity', () => {
  const baseline = tiny(), c = land(baseline);
  const ruled = structuredClone(baseline);
  ruled.model.policy.minimumWage = 4;
  assert.ok(delta(effects(marketRule, ruled), c.id, 'businessHealth') < delta(effects(marketRule, baseline), c.id, 'businessHealth') - .03,
    'service firms with insufficient receipts contract');
  assert.ok(delta(effects(societyRule, ruled), c.id, 'employment') < delta(effects(societyRule, baseline), c.id, 'employment') - .01,
    'the same local wage floor reduces viable jobs');
  const hiring = effects(societyRule, ruled).find(e => e.kind === 'delta' && e.cell === c.id && e.field === 'employment');
  assert.ok(hiring && hiring.kind === 'delta' && hiring.evidence?.parents?.includes('policy:minimumWage'),
    'the local hiring explanation links back to the ruling');
  const productive = structuredClone(ruled), farm = structuredClone(ruled);
  Object.assign(productive.model.cells[c.id], { agriculture: 0, manufacturing: 1, services: 0, sports: 0 });
  Object.assign(farm.model.cells[c.id], { agriculture: 1, manufacturing: 0, services: 0, sports: 0 });
  assert.ok(delta(effects(societyRule, productive), c.id, 'employment') > delta(effects(societyRule, farm), c.id, 'employment') + .02,
    'higher local receipts support more legal jobs at the same floor');
});

test('industrial pollution reaches adjacent residents and Clean Air improves their later health', () => {
  const base = tiny();
  const source = base.model.cells.find(c => c.biome !== 'water' && base.model.neighbors[c.id].length >= 2)!;
  const neighborId = base.model.neighbors[source.id][0];
  const industrial = structuredClone(base);
  Object.assign(industrial.model.cells[source.id], { agriculture: .05, manufacturing: .9, services: .04, sports: .01 });
  assert.ok(delta(effects(societyRule, industrial), neighborId, 'pollution') >
    delta(effects(societyRule, base), neighborId, 'pollution') + .001);
  const controlled = structuredClone(industrial);
  controlled.model.policy.laws.cleanAir = true;
  let untreated = step(industrial, [societyRule]);
  let treated = step(controlled, [societyRule]);
  assert.ok(treated.model.cells[neighborId].pollution < untreated.model.cells[neighborId].pollution);
  untreated = step(untreated, [societyRule]);
  treated = step(treated, [societyRule]);
  assert.ok(treated.model.cells[neighborId].health > untreated.model.cells[neighborId].health);
});

test('severe local food deprivation causes explicit deaths and resets when food recovers', () => {
  const g = tiny(), c = land(g);
  c.foodSecurity = .35;
  const deaths = c.population * .008 * .5 ** 2;
  near(delta(effects(societyRule, g), c.id, 'starvationDeaths'), deaths);
  const fedControl = structuredClone(g);
  fedControl.model.cells[c.id].foodSecurity = 1;
  const deprived = step(g, [societyRule, populationDemographicsRule]);
  const fedOnce = step(fedControl, [societyRule, populationDemographicsRule]);
  near(deprived.model.cells[c.id].starvationDeaths, deaths);
  assert.ok(deprived.model.cells[c.id].population < fedOnce.model.cells[c.id].population - deaths);
  const fed = structuredClone(deprived);
  fed.model.cells[c.id].foodSecurity = 1;
  near(delta(effects(societyRule, fed), c.id, 'starvationDeaths'), -deaths);
  near(step(fed, [societyRule, populationDemographicsRule]).model.cells[c.id].starvationDeaths, 0);
});

test('migration moves population and proportional savings toward appeal; movement law dampens expected flow', () => {
  const g = tiny(), a = g.model.cells.find(c => c.biome !== 'water' && g.model.neighbors[c.id].length)!;
  const b = g.model.cells[g.model.neighbors[a.id][0]];
  a.happiness = 0; b.happiness = 1;

  const open = migrationEffects(g, 0);
  const populationMoves = open.filter((effect): effect is Extract<Effect, { kind: 'population-transfer' }> =>
    effect.kind === 'population-transfer' && effect.from === a.id);
  assert.ok(populationMoves.length > 0);
  const destination = populationMoves[0].to;
  const residents = populationMoves.filter(effect => effect.to === destination)
    .reduce((sum, effect) => sum + effect.amount, 0);
  const savings = open.find(e => e.kind === 'transfer' && e.resource === 'cash'
    && e.from === a.id && e.to === destination);
  assert.ok(savings && savings.kind === 'transfer');
  near(savings.amount, residents * a.cash / a.population);

  const closed = structuredClone(g);
  closed.model.policy.laws.freeMovement = false;
  const openExpected = expectedOutboundMigrants(g, a.id);
  const restrictedExpected = expectedOutboundMigrants(closed, a.id);
  assert.ok(openExpected > 0);
  assert.ok(restrictedExpected < openExpected * .2,
    `movement restrictions should sharply reduce expected flow: ${openExpected} → ${restrictedExpected}`);
});

test('migration follows local earning opportunities when other conditions match', () => {
  const g = tiny(), a = g.model.cells.find(c => c.biome !== 'water' && g.model.neighbors[c.id].length)!;
  const b = g.model.cells[g.model.neighbors[a.id][0]];
  for (const c of [a, b]) Object.assign(c, { population: 200, cash: 8000, happiness: .65, employment: .9, foodSecurity: 1, price: 1 });
  a.output = 400; b.output = 1600;
  assert.ok(expectedOutboundMigrants(g, a.id) > 0, 'workers move out of the lower-opportunity place');
});

test('migration does not request negative savings transfers from a cash-depleted cell', () => {
  const g = tiny(), a = g.model.cells.find(c => c.biome !== 'water' && g.model.neighbors[c.id].length)!;
  const b = g.model.cells[g.model.neighbors[a.id][0]];
  a.cash = -1e-14;
  a.happiness = .1;
  b.happiness = 1;
  const moves = migrationEffects(g, 0).filter(e =>
    (e.kind === 'transfer' || e.kind === 'population-transfer') && e.from === a.id);
  assert.ok(moves.some(e => e.kind === 'population-transfer' && e.amount > 0));
  assert.ok(moves.every(e => 'amount' in e && e.amount >= 0));
});

test('high food costs or shortages raise outward migration pressure', () => {
  const g = tiny();
  const b = g.model.cells.find(c => c.biome !== 'water' && g.model.neighbors[c.id].length)!;
  for (const id of [b.id, ...g.model.neighbors[b.id]]) {
    const cell = g.model.cells[id];
    if (cell.biome !== 'water') Object.assign(cell, { cash: 8000, happiness: .65, foodSecurity: 1, price: 1 });
  }
  const baseline = expectedOutboundMigrants(g, b.id);

  const expensive = structuredClone(g);
  expensive.model.cells[b.id].price = 5;
  const costlyFlow = expectedOutboundMigrants(expensive, b.id);

  const hungry = structuredClone(g);
  hungry.model.cells[b.id].foodSecurity = 0;
  const hungryFlow = expectedOutboundMigrants(hungry, b.id);

  assert.ok(costlyFlow > baseline, `higher local prices should increase outward pressure: ${baseline} → ${costlyFlow}`);
  assert.ok(hungryFlow > baseline, `local hunger should increase outward pressure: ${baseline} → ${hungryFlow}`);
});

test('industry adaptation keeps shares normalized and reacts to subsidies and food prices', () => {
  const g = tiny(), c = land(g), baseline = effects(adaptationRule, g);
  const sports = structuredClone(g); sports.model.policy.subsidies.sports = 3;
  assert.ok(delta(effects(adaptationRule, sports), c.id, 'sports') > delta(baseline, c.id, 'sports'));
  const expensive = structuredClone(g); expensive.model.cells[c.id].price = 3;
  assert.ok(delta(effects(adaptationRule, expensive), c.id, 'agriculture') > delta(baseline, c.id, 'agriculture'));
  near(['agriculture', 'manufacturing', 'services', 'sports'].reduce((s, k) => s + delta(baseline, c.id, k as MutableField), 0), 0);
  const unfunded = structuredClone(sports); unfunded.model.budget.funding = 0;
  near(delta(effects(adaptationRule, unfunded), c.id, 'sports'), delta(baseline, c.id, 'sports'));
});

test('each stochastic event has its own probability, cooldown and bounded state effects', () => {
  const g = tiny(); g.model.tick = 10;
  const selected = land(g), random = (_cell: number, channel = '') => channel.endsWith('-place') ? g.model.cells.filter(c => c.biome !== 'water').findIndex(c => c.id === selected.id) / g.model.cells.filter(c => c.biome !== 'water').length : 0;
  const active = effects(eventRule, g, random);
  assert.deepEqual(active.filter(e => e.kind === 'event').map(e => e.kind === 'event' && e.key), ['violentCrime', 'festival', 'drought']);
  near(delta(active, selected.id, 'sportsInterest'), .15);
  near(delta(active, selected.id, 'food'), -selected.food * .35);
  near(delta(active, selected.id, 'waterStress'), .4);
  const recovering = structuredClone(g); recovering.model.cells[selected.id].waterStress = .4;
  const recovery = effects(eventRule, recovering, (_cell, channel = '') => channel.endsWith('-place') ? random(_cell, channel) : .999);
  near(delta(recovery, selected.id, 'waterStress'), -.14);
  assert.ok(active.some(e => e.kind === 'transfer' && e.from === 'external' && e.to === selected.id && e.amount === selected.population * .4));
  assert.equal(effects(eventRule, g, random, { violentCrime: 9, festival: 9, drought: 9 }).filter(e => e.kind === 'event').length, 0);
  const noRoll = effects(eventRule, g, (_cell, channel = '') => channel.endsWith('-place') ? random(_cell, channel) : .999);
  assert.equal(noRoll.filter(e => e.kind === 'event').length, 0);
});
