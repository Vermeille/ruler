import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/world';
import { assertModel, step } from '../src/sim/engine';
import { enact } from '../src/sim/policy';
import { summarize } from '../src/sim/math';
import { defaultRules } from '../src/sim/rules';
import { mandateReport, traceCauses } from '../src/sim/narrative';
import type { Action, Game } from '../src/sim/types';
const run = (g: Game, months: number, events = true): Game => { for (let i = 0; i < months; i++) g = step(g, events ? defaultRules : defaultRules.filter(r => r.phase !== 'events')); return g; };
const tiny = (seed = 'alder-42', mandate = 48) => createGame(seed, 18, 14, mandate);

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
test('a twenty-year baseline settles and small perturbations stay small', () => {
  const base = tiny('long-run', 240), perturbed = structuredClone(base);
  perturbed.model.cells.find(c => c.population > 0)!.happiness += .00001;
  const a = run(base, 240, false), b = run(perturbed, 240, false), sa = summarize(a.model), sb = summarize(b.model);
  assert.ok(sa.foodSecurity > .95); assert.ok(sa.happiness > .6); assert.ok(a.model.budget.funding > .98);
  assert.ok(Math.abs(sa.happiness - sb.happiness) < .001);
  assert.ok(Math.abs(sa.wealth - sb.wealth) < .01);
  const lastYear = a.history.slice(-12).map(h => h.summary.happiness);
  assert.ok(Math.max(...lastYear) - Math.min(...lastYear) < .015);
});
test('policing, health spending, and environmental law have measured directional effects', () => {
  const g = tiny('policy-comparison');
  const baseline = summarize(run(g, 36, false).model);
  const noPolice = summarize(run(enact(g, [{ type: 'spending', service: 'police', amount: 0 }, { type: 'spending', service: 'welfare', amount: 0 }]), 36, false).model);
  const health = summarize(run(enact(g, [{ type: 'spending', service: 'health', amount: .6 }, { type: 'tax', tax: 'incomeTax', rate: .35 }]), 36, false).model);
  const clean = summarize(run(enact(g, { type: 'law', law: 'cleanAir', enabled: true }), 36, false).model);
  assert.ok(noPolice.crime > baseline.crime + .05); assert.ok(health.health > baseline.health + .08); assert.ok(clean.pollution < baseline.pollution - .04);
});
test('a sports subsidy creates a traceable labor → food → business chain and later recovery', () => {
  let g = enact(tiny('alder-42'), { type: 'subsidy', sector: 'sports', amount: 3, scope: { kind: 'national' } });
  g = run(g, 48);
  const worst = Math.min(...g.history.map(h => h.summary.foodSecurity));
  assert.ok(worst < .85, `Expected a food shortage, got ${worst}`);
  assert.ok(g.history.at(-1)!.summary.foodSecurity > worst + .08);
  const chain = g.causes.filter(c => c.rule === 'economy.businesses' && c.title.includes('struggle')).map(c => traceCauses(g, [c.id])).find(causes => ['government', 'economy.labor', 'economy.households', 'economy.businesses'].every(rule => causes.some(c => c.rule === rule)));
  assert.ok(chain, 'Expected observed chain from the subsidy to worker shifts, shortage, and struggling businesses');
  assert.ok(g.articles.some(a => a.category === 'economy'));
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
  for (const id of base.model.neighbors[a.id]) { const c = unequal.model.cells[id], extra = c.population * 100; c.cash += extra; unequal.model.externalCash -= extra; }
  const baseline = run(base, 6, false), changed = run(unequal, 6, false);
  assert.ok(changed.model.cells[a.id].crime > baseline.model.cells[a.id].crime + .025);
});
