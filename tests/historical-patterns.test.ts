import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/world';
import { step } from '../src/sim/engine';
import { enact } from '../src/sim/policy';
import { summarize } from '../src/sim/math';
import { defaultRules } from '../src/sim/rules';
import type { Action, Game } from '../src/sim/types';

// These are qualitative mechanism tests. They are not country reconstructions.
const rules = defaultRules.filter(rule => rule.phase !== 'events');
const seeds = ['alder-42', 'marlow'];
const services = ['health', 'education', 'police', 'infrastructure', 'welfare', 'culture', 'environment'] as const;
const spending = (amount: number): Action[] => services.map(service => ({ type: 'spending', service, amount }));
const run = (start: Game, months: number): Game => {
  let game = start;
  for (let i = 0; i < months; i++) game = step(game, rules);
  return game;
};

test('fiscal consolidation of an inherited deficit restores funding and reserves with real service costs', () => {
  for (const seed of seeds) {
    const distressed = run(enact(createGame(seed, 12, 12, 60), spending(2)), 12);
    assert.ok(distressed.model.budget.funding < .2, `${seed}: the starting budget must be distressed`);
    const continuation = run(distressed, 24);
    const consolidation = run(enact(distressed, spending(.1)), 24);
    const untreated = summarize(continuation.model), treated = summarize(consolidation.model);
    assert.ok(consolidation.model.budget.funding > .99, `${seed}: the smaller budget is actually funded`);
    assert.ok(treated.treasury > distressed.initial.population * 5, `${seed}: an operating cash reserve remains`);
    assert.ok(consolidation.model.debt < distressed.model.debt - distressed.initial.population * 5,
      `${seed}: surplus cash repays part of the inherited debt`);
    assert.ok(treated.treasury - treated.debt > distressed.model.treasury - distressed.model.debt + distressed.initial.population * 10,
      `${seed}: the public balance sheet improves after repayment`);
    assert.ok(continuation.model.budget.funding < .2, `${seed}: the original promises remain unfunded`);
    assert.ok(treated.health < untreated.health - .03, `${seed}: health service cuts have a cost`);
    assert.ok(treated.crime > untreated.crime + .03, `${seed}: police and welfare cuts have a cost`);
    assert.ok(treated.output < untreated.output * .99, `${seed}: output is lower than continued spending`);
  }
});

test('industrial pollution control lowers pollution and later improves health at an output cost', () => {
  const industry: Action = { type: 'subsidy', sector: 'manufacturing', amount: 3, scope: { kind: 'national' } };
  for (const seed of seeds) {
    const industrial = run(enact(createGame(seed, 12, 12, 48), industry), 12);
    const unregulated = run(industrial, 24);
    const controlled = run(enact(industrial, { type: 'law', law: 'cleanAir', enabled: true }), 24);
    const a = summarize(unregulated.model), b = summarize(controlled.model);
    assert.ok(b.pollution < a.pollution - .2, `${seed}: pollution responds to regulation`);
    assert.ok(b.health > a.health + .02, `${seed}: health follows pollution with a delay`);
    assert.ok(b.output < a.output * .97, `${seed}: production pays a modeled cost`);
  }
});

test('administered food prices prolong local shortages by muting farmers price signal', () => {
  const support: Action[] = ['sports', 'manufacturing'].map(sector =>
    ({ type: 'subsidy', sector: sector as 'sports' | 'manufacturing', amount: 3, scope: { kind: 'national' } }));
  for (const seed of seeds) {
    const start = enact(createGame(seed, 12, 12, 48), support);
    const free = run(start, 48);
    const controlled = run(enact(start, { type: 'law', law: 'foodPriceControls', enabled: true }), 48);
    const a = summarize(free.model), b = summarize(controlled.model);
    const land = controlled.model.cells.filter(c => c.biome !== 'water');
    assert.ok(land.every(c => c.price <= 1), `${seed}: the posted price ceiling binds`);
    assert.ok(land.some(c => c.foodSecurity < .5 && c.scarcityPrice > c.price + .5),
      `${seed}: the same mapxels have unmet food demand and a hidden scarcity signal`);
    const farmShare = (game: Game) => game.model.cells.filter(c => c.biome !== 'water')
      .reduce((total, c) => total + c.agriculture * c.population, 0) / summarize(game.model).population;
    assert.ok(farmShare(controlled) < farmShare(free) - .05, `${seed}: fewer workers return to farming`);
    assert.ok(b.foodSecurity < a.foodSecurity - .2 && b.foodSecurity < .7,
      `${seed}: the national shortage persists because local shortages persist`);
    assert.ok(b.starvationDeaths > a.starvationDeaths + 1,
      `${seed}: unmet local needs produce measurable harm`);
  }
});
