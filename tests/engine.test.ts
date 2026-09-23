import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/world';
import { assertModel, commitEffects, orderRules, step } from '../src/sim/engine';
import { deepFreeze, randomAt, summarize } from '../src/sim/math';
import { enact, parseCommand, previewActions, subsidyFor, validateAction } from '../src/sim/policy';
import { defaultRules, migrationRule, productionRule, tradeRule } from '../src/sim/rules';
import { deserialize, serialize } from '../src/sim/save';
import { mandateReport } from '../src/sim/narrative';
import type { Action, Effect, Game, Rule } from '../src/sim/types';

const tiny = (seed = 'testing', mandate = 48) => createGame(seed, 18, 14, mandate);
const run = (g: Game, months: number, rules = defaultRules): Game => { for (let i = 0; i < months; i++) g = step(g, rules); return g; };
const cash = (g: Game) => g.model.treasury + g.model.externalCash + g.model.cells.reduce((a, c) => a + c.cash, 0);
const total = (g: Game, key: 'food' | 'materials' | 'population') => g.model.cells.reduce((a, c) => a + c[key], 0);
const close = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} is not within ${tolerance} of ${b}`);

test('seeded generation creates diverse cells and valid four-neighbor geography', () => {
  const a = tiny(), b = tiny(), c = tiny('another');
  assert.deepEqual(a, b); assert.notDeepEqual(a.model.cells, c.model.cells); assertModel(a.model);
  assert.ok(a.model.cells.some(c => c.biome === 'water')); assert.ok(a.model.cells.some(c => c.biome === 'city'));
  assert.ok(new Set(a.model.cells.map(c => c.fertility.toFixed(1))).size > 4);
  for (const c of a.model.cells) for (const id of a.model.neighbors[c.id]) { const n = a.model.cells[id]; assert.equal(Math.abs(n.x - c.x) + Math.abs(n.y - c.y), 1); assert.ok(a.model.neighbors[id].includes(c.id)); assert.notEqual(n.biome, 'water'); }
  assert.throws(() => createGame('', 10, 10));
});
test('keyed random streams and full trajectories are reproducible', () => {
  assert.equal(randomAt('seed', 2, 'rule', 6), randomAt('seed', 2, 'rule', 6));
  assert.notEqual(randomAt('seed', 2, 'rule', 6), randomAt('seed', 2, 'different-rule', 6));
  assert.deepEqual(run(tiny(), 6), run(tiny(), 6, [...defaultRules].reverse()));
});
test('dependency validation rejects duplicates, cycles, missing rules, and backward phases', () => {
  const a: Rule = { id: 'a', phase: 'production', description: '', run: () => [] };
  assert.throws(() => orderRules([a, a]), /unique/);
  assert.throws(() => orderRules([{ ...a, after: ['missing'] }]), /Missing/);
  assert.throws(() => orderRules([{ ...a, after: ['b'] }, { ...a, id: 'b', after: ['a'] }]), /cycle/);
  assert.throws(() => orderRules([{ ...a, after: ['b'] }, { ...a, id: 'b', phase: 'events' }]), /runs after/);
});
test('a broken extension cannot mutate or partially advance the input game', () => {
  const g = tiny(), original = serialize(g);
  const malicious: Rule = { id: 'mutation', phase: 'production', description: '', run: ({ model }) => { (model.cells[0] as unknown as { cash: number }).cash = 100; return []; } };
  assert.throws(() => step(g, [malicious]), TypeError); assert.equal(serialize(g), original);
  const bad: Rule = { id: 'bad', phase: 'events', description: '', run: () => [{ kind: 'delta', cell: g.model.cells.find(c => c.population > 0)!.id, field: 'food', amount: NaN }] };
  assert.throws(() => step(g, [...defaultRules, bad]), /Invalid effect/); assert.equal(serialize(g), original);
});
test('simultaneous transfers cannot overspend inventory or double-spend incoming stock', () => {
  const g = tiny(), [a, b, c] = g.model.cells.filter(c => c.population > 0);
  a.food = 10; b.food = 0; c.food = 0;
  const original = total(g, 'food'), effects: Effect[] = [
    { kind: 'transfer', from: a.id, to: b.id, resource: 'food', amount: 10 },
    { kind: 'transfer', from: a.id, to: c.id, resource: 'food', amount: 10 },
    { kind: 'transfer', from: b.id, to: c.id, resource: 'food', amount: 10 },
  ];
  commitEffects(g, deepFreeze(structuredClone(g.model)), effects.map(effect => ({ rule: 'test', effect })));
  close(a.food, 0); close(b.food, 5); close(c.food, 5); close(total(g, 'food'), original);
});
test('competing trades settle goods and payment atomically, respecting a poor buyer', () => {
  const g = tiny(), [a, b, c] = g.model.cells.filter(c => c.population > 0);
  a.food = 10; b.food = 0; c.food = 0; b.cash = 4; c.cash = 100;
  const beforeFood = total(g, 'food'), beforeCash = cash(g), aCash = a.cash;
  const effects: Effect[] = [{ kind: 'trade', from: a.id, to: b.id, resource: 'food', amount: 10, price: 2 }, { kind: 'trade', from: a.id, to: c.id, resource: 'food', amount: 10, price: 2 }];
  commitEffects(g, deepFreeze(structuredClone(g.model)), effects.map(effect => ({ rule: 'trade', effect })));
  close(b.food, 2); close(b.cash, 0); close(c.food, 5); close(a.food, 3); close(a.cash - aCash, 14); close(total(g, 'food'), beforeFood); close(cash(g), beforeCash, .001);
});
test('consumption and outgoing transfers share the same stock budget', () => {
  const g = tiny(), [a, b] = g.model.cells.filter(c => c.population > 0); a.food = 10; b.food = 0;
  commitEffects(g, deepFreeze(structuredClone(g.model)), [
    { rule: 'eat', effect: { kind: 'delta', cell: a.id, field: 'food', amount: -10 } },
    { rule: 'trade', effect: { kind: 'transfer', from: a.id, to: b.id, resource: 'food', amount: 10 } },
  ]);
  close(a.food, 0); close(b.food, 5);
});
test('debt repayment moves only available cash and cannot erase more principal than owed', () => {
  const g = tiny(); g.model.debt = 10; g.model.treasury = 5;
  const beforeCash = cash(g), beforeExternal = g.model.externalCash;
  commitEffects(g, deepFreeze(structuredClone(g.model)), [{ rule: 'repay', effect: { kind: 'repayDebt', amount: 10 } }]);
  close(g.model.treasury, 0); close(g.model.debt, 5); close(g.model.externalCash - beforeExternal, 5);
  close(cash(g), beforeCash, .001);
  assert.throws(() => commitEffects(g, deepFreeze(structuredClone(g.model)),
    [{ rule: 'repay', effect: { kind: 'repayDebt', amount: 6 } }]), /exceeds outstanding/);
});
test('neighbor trade and migration conserve resources and national population', () => {
  const start = tiny(), traded = run(start, 1, [tradeRule]), moved = run(start, 1, [migrationRule]);
  close(total(start, 'food'), total(traded, 'food')); close(total(start, 'materials'), total(traded, 'materials')); close(cash(start), cash(traded), .001);
  close(total(start, 'population'), total(moved, 'population')); close(cash(start), cash(moved), .001);
});
test('production has explicit resource sources and exports use an external account', () => {
  const start = tiny(), next = step(start, [productionRule]);
  close(total(next, 'food') - total(start, 'food'), next.model.cells.reduce((a, c) => a + c.foodMade, 0));
  close(cash(start), cash(next), .002);
  assert.ok(next.model.externalCash < start.model.externalCash);
});
test('summaries are weighted by residents, including selected regions', () => {
  const g = tiny(), [a, b] = g.model.cells.filter(c => c.population > 0); a.population = 100; b.population = 900; a.happiness = 0; b.happiness = 1;
  close(summarize(g.model, [a.id, b.id]).happiness, .9);
  assert.equal(summarize(g.model, []).population, 0);
});
test('DSL parses scoped and JSON commands without evaluating code', () => {
  const g = tiny(), id = g.model.cells.find(c => c.population > 0)!.id;
  const command = parseCommand('subsidize sports 1.5 in selected', [id]);
  assert.deepEqual(validateAction(command, g.model), { type: 'subsidy', sector: 'sports', amount: 1.5, scope: { kind: 'cells', ids: [id] } });
  assert.deepEqual(parseCommand('law cleanAir on'), { type: 'law', law: 'cleanAir', enabled: true });
  assert.deepEqual(parseCommand('wage minimum 4'), { type: 'minimumWage', amount: 4 });
  assert.deepEqual(parseCommand('[{"type":"tax","tax":"incomeTax","rate":0.2}]'), [{ type: 'tax', tax: 'incomeTax', rate: .2 }]);
  for (const text of ['tax income 0.2 in selected', 'tax income 0.2 garbage', 'globalThis.hacked = true', 'law cleanAir maybe']) assert.throws(() => parseCommand(text));
});
test('invalid, non-finite, unknown, duplicate-scope, and unaffordable actions are rejected atomically', () => {
  const g = tiny(), before = serialize(g), id = g.model.cells.find(c => c.population > 0)!.id;
  const valid: Action = { type: 'tax', tax: 'incomeTax', rate: .3 };
  for (const invalid of [
    { ...valid, rate: NaN }, { ...valid, rate: .8 }, { ...valid, surprise: 5 }, { type: 'law', law: '__proto__', enabled: true },
    { type: 'minimumWage', amount: -1 }, { type: 'minimumWage', amount: 11 }, { type: 'minimumWage', amount: 3, surprise: true },
    { type: 'subsidy', sector: 'sports', amount: 1, scope: { kind: 'cells', ids: [] } },
    { type: 'subsidy', sector: 'sports', amount: 1, scope: { kind: 'cells', ids: [id, id] } },
    { type: 'invest', project: 'transport', amount: g.model.treasury + 1, scope: { kind: 'national' } },
  ]) assert.throws(() => enact(g, [valid, invalid]));
  assert.equal(serialize(g), before);
});
test('a cash-free policy change remains available with tiny floating-point treasury debt', () => {
  const g = tiny();
  g.model.treasury = -1e-12;
  assertModel(g.model);
  const next = enact(g, { type: 'spending', service: 'health', amount: .1 });
  assert.equal(next.model.policy.spending.health, .1);
  assert.equal(g.model.policy.spending.health, .3);
  assert.throws(() => enact(g, { type: 'invest', project: 'hospital', amount: 1, scope: { kind: 'national' } }), /Not enough treasury/);
});
test('local subsidies target only the selected area, with predictable override and repeal semantics', () => {
  const g = tiny(), [a, b] = g.model.cells.filter(c => c.population > 0);
  let next = enact(g, { type: 'subsidy', sector: 'sports', amount: 2, scope: { kind: 'cells', ids: [a.id] } });
  assert.equal(subsidyFor(next.model, a, 'sports'), 2); assert.equal(subsidyFor(next.model, b, 'sports'), 0);
  next = enact(next, { type: 'subsidy', sector: 'sports', amount: .3, scope: { kind: 'national' } });
  assert.equal(subsidyFor(next.model, a, 'sports'), .3); assert.equal(next.model.localSubsidies.length, 0);
  next = enact(next, { type: 'subsidy', sector: 'sports', amount: 0, scope: { kind: 'national' } });
  assert.equal(subsidyFor(next.model, a, 'sports'), 0);
});
test('investments change only the selected area and debit the treasury exactly once', () => {
  const g = tiny(), [a, b] = g.model.cells.filter(c => c.population > 0), amount = 1000;
  const action: Action = { type: 'invest', project: 'transport', amount, scope: { kind: 'cells', ids: [a.id] } };
  assert.equal(previewActions(g, action).upfront, amount);
  const next = enact(g, action);
  assert.ok(next.model.cells[a.id].infrastructure > a.infrastructure); assert.equal(next.model.cells[b.id].infrastructure, b.infrastructure);
  close(next.model.treasury, g.model.treasury - amount); close(cash(next), cash(g), .001);
});
test('saving mid-mandate reproduces the exact future including events and causal records', () => {
  let g = enact(tiny(), { type: 'spending', service: 'police', amount: .05 }); g = run(g, 9);
  const restored = deserialize(serialize(g)); assert.deepEqual(restored, g);
  assert.deepEqual(run(restored, 8), run(g, 8));
});
test('a wage ruling survives save and resumes the same local economy', () => {
  const ruled = run(enact(tiny('wage-save'), { type: 'minimumWage', amount: 6 }), 6);
  assert.equal(ruled.model.policy.minimumWage, 6);
  const restored = deserialize(serialize(ruled));
  assert.deepEqual(run(restored, 6), run(ruled, 6));
});
test('save validation rejects invalid shapes, indices, policy, histories, references, and numbers', () => {
  const base = run(tiny(), 3);
  for (const corrupt of [
    (g: Game) => { g.model.cells[0].id = 100000; }, (g: Game) => { g.model.cells[40].health = NaN; },
    (g: Game) => { g.model.neighbors = []; }, (g: Game) => { g.model.policy.spending.health = 9; },
    (g: Game) => { g.model.policy.minimumWage = 11; },
    (g: Game) => { g.model.cells.find(c => c.population > 0)!.price = 100; },
    (g: Game) => { g.model.cells.find(c => c.population > 0)!.scarcityPrice = 100; },
    (g: Game) => { g.model.cells.find(c => c.population > 0)!.waterStress = 2; },
    (g: Game) => { g.model.cells.find(c => c.population > 0)!.starvationDeaths = -1; },
    (g: Game) => { g.history.pop(); }, (g: Game) => { g.articles[0].causeIds = ['missing']; },
    (g: Game) => { g.causes[0].parents = [g.causes[0].id]; }, (g: Game) => { g.model.width = 10000; },
  ]) { const g = structuredClone(base); corrupt(g); assert.throws(() => deserialize(serialize(g))); }
  assert.throws(() => deserialize('{')); assert.throws(() => deserialize('{"version":999}'));
});
test('version-one saves migrate with initially unstressed land', () => {
  const prior = JSON.parse(serialize(run(tiny('legacy-save'), 3)));
  prior.version = 1;
  for (const c of prior.model.cells) { delete c.waterStress; delete c.starvationDeaths; delete c.scarcityPrice; }
  delete prior.initial.starvationDeaths;
  for (const h of prior.history) delete h.summary.starvationDeaths;
  delete prior.model.policy.laws.foodPriceControls;
  delete prior.model.policy.minimumWage;
  const restored = deserialize(JSON.stringify(prior));
  assert.equal(restored.version, 4);
  assert.equal(restored.model.policy.minimumWage, 0);
  assert.ok(restored.model.cells.every(c => c.waterStress === 0));
  assert.ok(restored.model.cells.every(c => c.starvationDeaths === 0));
  assert.ok(restored.model.cells.every(c => c.scarcityPrice === c.price));
  assert.equal(restored.model.policy.laws.foodPriceControls, false);
  assert.equal(restored.history.at(-1)!.summary.starvationDeaths, 0);
});
test('version-two saves migrate with an unregulated wage floor', () => {
  const prior = JSON.parse(serialize(run(tiny('legacy-wage'), 3)));
  prior.version = 2;
  delete prior.model.policy.minimumWage;
  const restored = deserialize(JSON.stringify(prior));
  assert.equal(restored.version, 4);
  assert.equal(restored.model.policy.minimumWage, 0);
});
test('enacting food price controls caps posted local prices and survives a save', () => {
  const start = tiny('price-cap-save');
  const cell = start.model.cells.find(c => c.biome !== 'water')!;
  cell.price = 2.5;
  cell.scarcityPrice = 2.5;
  const controlled = enact(start, { type: 'law', law: 'foodPriceControls', enabled: true });
  assert.equal(controlled.model.cells[cell.id].price, 1);
  assert.equal(controlled.model.cells[cell.id].scarcityPrice, 2.5);
  assert.deepEqual(deserialize(serialize(controlled)), controlled);
});
test('a mandate ends exactly once and refuses further policies or simulation steps', () => {
  const g = run(tiny('short-term', 3), 5); assert.equal(g.model.tick, 3); assert.equal(g.history.length, 4); assert.ok(g.ended); assert.equal(step(g), g);
  assert.throws(() => enact(g, { type: 'tax', tax: 'incomeTax', rate: .2 }), /ended/);
  const r = mandateReport(g); assert.equal(r.voices.length, 3); assert.equal(r.changes.length, 6); assert.match(r.opening, /3 months/);
  assert.deepEqual(deserialize(serialize(g)), g);
});
