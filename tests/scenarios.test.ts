import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/world';
import { assertModel, step } from '../src/sim/engine';
import { enact } from '../src/sim/policy';
import { summarize } from '../src/sim/math';
import { defaultRules } from '../src/sim/rules';
import { mandateReport, traceCauses } from '../src/sim/narrative';
import type { Action, Game, Sector } from '../src/sim/types';
import { crowns } from '../src/sim/units';

const run = (g: Game, months: number, events = true): Game => {
  const rules = events ? defaultRules : defaultRules.filter(rule => rule.id !== 'stories.events');
  for (let i = 0; i < months; i++) g = step(g, rules);
  return g;
};
const tiny = (seed = 'alder-42', mandate = 48) => createGame(seed, 18, 14, mandate);

function workerShare(game: Game, sector: Sector): number {
  let total = 0;
  let matching = 0;
  for (const groups of game.model.populationGroups) {
    for (const group of groups) {
      if (group.lifeStage !== 'adult' || !group.employed || group.occupation === null) continue;
      total += group.count;
      if (group.occupation === sector) matching += group.count;
    }
  }
  return total > 0 ? matching / total : 0;
}

test('baseline remains viable for complete mandates across five seeds', () => {
  for (const seed of ['alder-42', 'marlow', 'greenbelt', 'coast', 'mountains']) {
    const g = run(tiny(seed), 48), s = summarize(g.model);
    assertModel(g.model); assert.ok(g.ended);
    assert.ok(s.happiness > .6 && s.happiness < .95, `${seed}: wellbeing ${s.happiness}`);
    assert.ok(s.foodSecurity > .95, `${seed}: food ${s.foodSecurity}`);
    assert.ok(s.employment > .8, `${seed}: employment ${s.employment}`);
    assert.ok(g.model.budget.funding > .98, `${seed}: funding ${g.model.budget.funding}`);
    assert.ok(s.wealth > 15 && s.wealth < 100);
    assert.ok(s.population / g.initial.population > .95 && s.population / g.initial.population < 1.1);
    for (let i = 1; i < g.history.length; i++) assert.ok(Math.abs(g.history[i].summary.happiness - g.history[i - 1].summary.happiness) < .045);
  }
});

test('a twenty-year baseline settles and microscopic human perturbations stay macroscopically bounded', () => {
  const base = tiny('long-run', 240), perturbed = structuredClone(base);
  const cell = perturbed.model.cells.find(c => c.population > 0)!;
  perturbed.model.populationGroups[cell.id][0].wellbeing += .00001;
  const a = run(base, 240, false), b = run(perturbed, 240, false), sa = summarize(a.model), sb = summarize(b.model);
  assert.ok(sa.foodSecurity > .8); assert.ok(sa.happiness > .6); assert.ok(a.model.budget.funding > .98);

  const normalizedFields = [
    'approval', 'happiness', 'crime', 'foodSecurity', 'employment', 'pollution', 'health', 'education',
  ] as const;
  for (const field of normalizedFields) {
    // Food stocks, prices, cohort decisions, and one-person stochastic rounding introduce more
    // threshold sensitivity than smooth social/environmental indices, while remaining bounded.
    const tolerance = field === 'foodSecurity' ? .015 : .01;
    assert.ok(Math.abs(sa[field] - sb[field]) < tolerance,
      `${field} diverged too far after a microscopic perturbation: ${sa[field]} vs ${sb[field]}`);
  }
  assert.ok(Math.abs(sa.wealth - sb.wealth) / Math.max(1, sa.wealth) < .01,
    `wealth diverged by more than 1%: ${sa.wealth} vs ${sb.wealth}`);
  assert.ok(Math.abs(sa.population - sb.population) / Math.max(1, sa.population) < .001,
    `population diverged by more than 0.1%: ${sa.population} vs ${sb.population}`);
  assert.ok(Math.abs(sa.output - sb.output) / Math.max(1, sa.output) < .01,
    `output diverged by more than 1%: ${sa.output} vs ${sb.output}`);

  const lastYear = a.history.slice(-12).map(h => h.summary.happiness);
  assert.ok(Math.max(...lastYear) - Math.min(...lastYear) < .015);
  const maxGroups = Math.max(...a.model.populationGroups.map(groups => groups.length));
  assert.ok(maxGroups < 160, `population groups grew to ${maxGroups} in one mapxel`);
});

test('policing, health spending, and environmental law have measured directional effects', () => {
  const g = tiny('policy-comparison');
  const baseline = summarize(run(g, 36, false).model);
  const noPolice = summarize(run(enact(g, [{ type: 'spending', service: 'police', amount: 0 }, { type: 'spending', service: 'welfare', amount: 0 }]), 36, false).model);
  const health = summarize(run(enact(g, [{ type: 'spending', service: 'health', amount: .6 }, { type: 'tax', tax: 'incomeTax', rate: .35 }]), 36, false).model);
  const clean = summarize(run(enact(g, { type: 'law', law: 'cleanAir', enabled: true }), 36, false).model);
  assert.ok(noPolice.crime > baseline.crime + .05); assert.ok(health.health > baseline.health + .08); assert.ok(clean.pollution < baseline.pollution - .04);
});

test('a sports subsidy reallocates real workers and creates traceable downstream food pressure', () => {
  let g = enact(tiny('alder-42'), { type: 'subsidy', sector: 'sports', amount: 3, scope: { kind: 'national' } });
  const initialSports = workerShare(g, 'sports');
  const initialAgriculture = workerShare(g, 'agriculture');
  g = run(g, 48);

  const finalSports = workerShare(g, 'sports');
  const finalAgriculture = workerShare(g, 'agriculture');
  const worstFoodSecurity = Math.min(...g.history.map(h => h.summary.foodSecurity));
  assert.ok(finalSports > initialSports + .1,
    `Expected sports employment to grow materially, got ${initialSports} → ${finalSports}`);
  assert.ok(finalAgriculture < initialAgriculture - .03,
    `Expected some workers to leave agriculture, got ${initialAgriculture} → ${finalAgriculture}`);
  assert.ok(worstFoodSecurity < .995,
    `Expected labor reallocation to create some national food pressure, worst food security was ${worstFoodSecurity}`);
  assert.ok(worstFoodSecurity > .9,
    `A funded sector subsidy should not be required to create a national food crisis; got ${worstFoodSecurity}`);
  assert.ok(g.model.budget.funding > .95,
    `This scenario should test reallocation, not fiscal collapse; funding was ${g.model.budget.funding}`);

  assert.ok(g.causes.some(c => c.rule === 'population.retraining' && c.title.includes('sports')),
    'Expected actual population groups to switch or retrain into sports');
  assert.ok(g.causes.some(c => c.rule === 'economy.households' && c.title.includes('food supplies fall short')),
    'Expected at least some local food shortages after agricultural labor falls');
  assert.ok(g.causes.some(c => c.rule === 'economy.businesses' && c.title.includes('struggle')),
    'Expected some businesses to experience downstream food pressure');

  const chain = g.causes
    .filter(c => c.rule === 'economy.businesses' && c.title.includes('struggle'))
    .map(c => traceCauses(g, [c.id]))
    .find(causes => [
      'government',
      'population.retraining',
      'economy.production',
      'economy.households',
      'economy.businesses',
    ].every(rule => causes.some(c => c.rule === rule)));
  assert.ok(chain, 'Expected observed chain from subsidy to worker retraining, reduced food production, local shortage, and struggling businesses');
  assert.ok(mandateReport(g).chains.length > 0, 'Mandate should retain policy consequences');
  const seen = new Set<string>(); for (const c of g.causes) { assert.ok(c.parents.every(id => seen.has(id))); seen.add(c.id); }
});

test('fiscal extremes cause explicit rationing without negative stocks, runaway money, or NaN', () => {
  const actions: Action[] = [{ type: 'tax', tax: 'incomeTax', rate: 0 }, { type: 'tax', tax: 'businessTax', rate: 0 }, ...(['health', 'education', 'police', 'infrastructure', 'welfare', 'culture', 'environment'] as const).map(service => ({ type: 'spending' as const, service, amount: 2 }))];
  let g = enact(tiny('stress'), actions);
  const totalMoney = (g: Game) => g.model.treasury + g.model.externalCash + g.model.cells.reduce((a, c) => a + c.cash, 0);
  const before = totalMoney(g);
  g = run(g, 48); assertModel(g.model);
  assert.ok(g.model.budget.funding < .1); assert.ok(g.model.debt > 0);
  assert.ok(Math.abs(totalMoney(g) - before) < .1);
  assert.ok(g.articles.some(a => a.headline === 'The promises exceed the purse'));
});

test('higher inequality across a border raises poor-cell crime when policing is weak', () => {
  const base = tiny('inequality'), a = base.model.cells.find(c => c.population > 0 && base.model.neighbors[c.id].length === 4)!;
  base.model.policy.spending.police = 0;
  const unequal = structuredClone(base);
  for (const id of base.model.neighbors[a.id]) {
    const c = unequal.model.cells[id];
    const extraPerResident = 100;
    for (const group of unequal.model.populationGroups[id]) group.wealth += extraPerResident;
    const extraCash = c.population * extraPerResident;
    c.cash = crowns(c.cash + extraCash);
    unequal.model.externalCash = crowns(unequal.model.externalCash - extraCash);
  }
  const baseline = run(base, 6, false), changed = run(unequal, 6, false);
  assert.ok(changed.model.cells[a.id].crime > baseline.model.cells[a.id].crime + .025);
});
