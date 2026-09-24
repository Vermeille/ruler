import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/world';
import { step } from '../src/sim/engine';
import { enact } from '../src/sim/policy';
import { randomAt, summarize } from '../src/sim/math';
import { consumptionRule, defaultRules, eventRule, marketRule, tradeRule } from '../src/sim/rules';
import type { Action, Game, Mapxel } from '../src/sim/types';

// Paired trajectories use the same seed and exclude discrete events so policy is the only input difference.
const rules = defaultRules.filter(r => r.id !== 'stories.events');
type Frame = ReturnType<typeof summarize> & { revenue: number; funding: number; agriculture: number; businessHealth: number };
function trajectory(seed: string, actions: Action[] = [], months = 48): Frame[] {
  let g: Game = createGame(seed, 12, 12, months);
  if (actions.length) g = enact(g, actions);
  const frames: Frame[] = [];
  for (let month = 0; month < months; month++) {
    g = step(g, rules);
    const summary = summarize(g.model), cells = g.model.cells.filter(c => c.biome !== 'water');
    const weighted = (key: keyof Mapxel) => cells.reduce((total, c) => total + Number(c[key]) * c.population, 0) / summary.population;
    frames.push({ ...summary, revenue: g.model.budget.revenue / g.initial.population, funding: g.model.budget.funding,
      agriculture: weighted('agriculture'), businessHealth: weighted('businessHealth') });
  }
  return frames;
}
const mean = (frames: Frame[], key: keyof Frame, from = 36) => frames.slice(from)
  .reduce((total, frame) => total + frame[key], 0) / (frames.length - from);

test('ordinary policy changes remain gradual but visible within half a mandate', () => {
  for (const seed of ['alder-42', 'marlow']) {
    const baseline = trajectory(seed, [], 24);
    const tax = trajectory(seed, [{ type: 'tax', tax: 'incomeTax', rate: .35 }], 24);
    const health = trajectory(seed, [{ type: 'spending', service: 'health', amount: .5 }], 24);
    for (const frames of [baseline, tax, health]) {
      assert.ok(frames.every(f => f.funding > .98 && f.foodSecurity > .9), `${seed}: ordinary policy keeps services and food viable`);
      assert.ok(frames.slice(1).every((f, i) => Math.abs(f.happiness - frames[i].happiness) < .05),
        `${seed}: wellbeing does not jump month to month`);
    }
    assert.ok(tax[23].revenue > baseline[23].revenue + .2, `${seed}: tax collection responds`);
    assert.ok(tax[23].wealth < baseline[23].wealth - 3, `${seed}: tax reaches private reserves`);
    assert.ok(health[23].health > baseline[23].health + .04, `${seed}: health policy is visible`);
    assert.ok(health[23].output > baseline[23].output, `${seed}: healthier residents support later output`);
  }
});

test('extreme combined tax rates can produce a late Laffer reversal through the complete engine', () => {
  for (const seed of ['alder-42', 'marlow']) {
    const tax = (rate: number): Action[] => [
      { type: 'tax', tax: 'incomeTax', rate }, { type: 'tax', tax: 'businessTax', rate },
    ];
    const moderate = trajectory(seed, tax(.45));
    const extreme = trajectory(seed, tax(.65));
    assert.ok(extreme[0].revenue > moderate[0].revenue + 1, `${seed}: the statutory rate initially collects more`);
    assert.ok(mean(extreme, 'revenue') < mean(moderate, 'revenue') - .1,
      `${seed}: realized revenue reverses late in the mandate`);
    assert.ok(extreme[47].wealth < moderate[47].wealth,
      `${seed}: the higher rate leaves less private reserve to tax`);
  }
});

test('funded health spending improves health and later economic output', () => {
  const baseline = trajectory('alder-42');
  const health = trajectory('alder-42', [{ type: 'spending', service: 'health', amount: .7 }]);
  const after = 23;
  assert.ok(health[after].funding > .99, 'the treatment must actually be funded');
  assert.ok(health[after].health > baseline[after].health + .1);
  assert.ok(health[after].output > baseline[after].output * 1.03);
  assert.ok(health[after].revenue > baseline[after].revenue + .04);
});

test('Clean Air trades immediate output for lower pollution and later health', () => {
  const baseline = trajectory('alder-42', [], 24);
  const clean = trajectory('alder-42', [{ type: 'law', law: 'cleanAir', enabled: true }], 24);
  assert.ok(clean[0].output < baseline[0].output * .99, 'production changes in the first month');
  assert.ok(clean[23].pollution < baseline[23].pollution - .05);
  assert.ok(clean[23].health > baseline[23].health + .005);
  assert.ok(clean[23].output < baseline[23].output * .99);
});

test('better roads carry more food through trade into consumption and local prices', () => {
  const low = createGame('trade-ripple', 12, 12, 3);
  const source = low.model.cells.find(c => c.biome !== 'water' && low.model.neighbors[c.id].length >= 2)!;
  const destination = low.model.cells[low.model.neighbors[source.id][0]];
  for (const c of low.model.cells) if (c.biome !== 'water') { c.food = 0; c.infrastructure = 0; c.cash = c.population * 100; }
  source.food = source.population * 5;
  const high = structuredClone(low);
  for (const c of high.model.cells) if (c.biome !== 'water') c.infrastructure = 1;
  const phases = [tradeRule, consumptionRule, marketRule];
  const scarce = step(low, phases), connected = step(high, phases);
  assert.ok(connected.model.cells[destination.id].foodTraded > scarce.model.cells[destination.id].foodTraded);
  assert.ok(connected.model.cells[destination.id].foodSecurity > scarce.model.cells[destination.id].foodSecurity);
  assert.ok(connected.model.cells[destination.id].price < scarce.model.cells[destination.id].price);
});

test('unfunded promises exhaust borrowing, then degrade services and safety', () => {
  const baseline = trajectory('alder-42');
  const services = ['health', 'education', 'police', 'infrastructure', 'welfare', 'culture', 'environment'] as const;
  const unaffordable: Action[] = [
    { type: 'tax', tax: 'incomeTax', rate: 0 }, { type: 'tax', tax: 'businessTax', rate: 0 },
    ...services.map(service => ({ type: 'spending' as const, service, amount: 2 })),
  ];
  const crisis = trajectory('alder-42', unaffordable);
  assert.ok(crisis[47].debt > 0);
  assert.ok(crisis[47].funding < .1);
  assert.ok(crisis[47].health < baseline[47].health - .1);
  assert.ok(crisis[47].education < baseline[47].education - .05);
  assert.ok(crisis[47].crime > baseline[47].crime + .05);
  assert.ok(crisis[47].approval < baseline[47].approval,
    'residents notice that promised services are not actually delivered');
});

test('a deterministic drought damages next-month food access and then raises prices', () => {
  const seed = Array.from({ length: 1000 }, (_, i) => `drought-${i}`)
    .find(s => randomAt(s, 1, eventRule.id, -1, 'weather-roll') < .1);
  assert.ok(seed);
  const base = createGame(seed, 12, 12, 3);
  for (const c of base.model.cells) if (c.biome !== 'water') c.food = c.population * 1.2;
  const noEvent = step(base, []), drought = step(base, [eventRule]);
  const affected = drought.causes.find(c => c.rule === eventRule.id && c.title.startsWith('Dry weather'));
  assert.ok(affected && affected.cells.length);
  const id = affected.cells[0];
  assert.ok(drought.model.cells[id].food < noEvent.model.cells[id].food);
  const phases = [consumptionRule, marketRule];
  const ordinary = step(noEvent, phases), shocked = step(drought, phases);
  assert.ok(shocked.model.cells[id].foodSecurity < ordinary.model.cells[id].foodSecurity);
  assert.ok(shocked.model.cells[id].price > ordinary.model.cells[id].price);
  assert.ok(shocked.model.cells[id].businessHealth < ordinary.model.cells[id].businessHealth);
});
