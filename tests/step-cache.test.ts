import test from 'node:test';
import assert from 'node:assert/strict';
import { step } from '../src/sim/engine';
import { buildStepCache } from '../src/sim/step-cache';
import type { DeepReadonly, Rule, StepCache } from '../src/sim/types';
import { createGame } from '../src/sim/world';

test('step cache is derived from population groups rather than mapxel social projections', () => {
  const game = createGame('step-cache-authority', 12, 12, 48);
  const cell = game.model.cells.find(candidate => candidate.biome !== 'water')!;
  const groups = game.model.populationGroups[cell.id];

  let population = 0;
  let health = 0;
  let wealth = 0;
  let adults = 0;
  let employed = 0;
  for (const group of groups) {
    population += group.count;
    health += group.count * group.health;
    wealth += group.count * group.wealth;
    if (group.lifeStage === 'adult') {
      adults += group.count;
      if (group.employed) employed += group.count;
    }
  }

  // Deliberately make legacy mapxel projections nonsense. The cache must ignore them.
  cell.population = population;
  cell.employment = adults > 0 && employed / adults > 0.5 ? 0 : 1;
  cell.happiness = 0;
  cell.approval = 1;
  cell.agriculture = 1;
  cell.manufacturing = 0;
  cell.services = 0;
  cell.sports = 0;

  const cache = buildStepCache(game.model);
  const summary = cache.peopleByCell[cell.id];
  assert.equal(summary.population, population);
  assert.equal(summary.adultPopulation, adults);
  assert.equal(summary.employedAdults, employed);
  assert.ok(Math.abs(summary.averageHealth - health / population) < 1e-12);
  assert.ok(Math.abs(summary.averageWealth - wealth / population) < 1e-12);
  assert.ok(Math.abs(summary.employmentRate - (adults > 0 ? employed / adults : 0)) < 1e-12);
  assert.notEqual(summary.employmentRate, cell.employment);
});

test('step cache is deeply frozen and is not persisted as model state', () => {
  const game = createGame('step-cache-frozen', 12, 12, 48);
  const cache = buildStepCache(game.model);
  const land = game.model.cells.find(candidate => candidate.biome !== 'water')!;

  assert.ok(Object.isFrozen(cache));
  assert.ok(Object.isFrozen(cache.peopleByCell));
  assert.ok(Object.isFrozen(cache.peopleByCell[land.id]));
  assert.ok(Object.isFrozen(cache.peopleByCell[land.id].occupationShares));
  assert.equal('cache' in game, false);
  assert.equal('cache' in game.model, false);
});

test('one cache instance is reused for the whole step and rebuilt on the next step', () => {
  const game = createGame('step-cache-lifetime', 12, 12, 48);
  const cell = game.model.cells.find(candidate => candidate.biome !== 'water')!;
  const group = game.model.populationGroups[cell.id][0];
  group.wellbeing = 0.4;

  const seen: DeepReadonly<StepCache>[] = [];
  const observeEarly: Rule = {
    id: 'test.cache.early',
    phase: 'production',
    description: 'Observe the step cache before population changes.',
    run({ cache }) {
      assert.ok(cache);
      seen.push(cache);
      return [];
    },
  };
  const changePeople: Rule = {
    id: 'test.cache.change-people',
    phase: 'experience',
    description: 'Change authoritative population state after the cache was built.',
    run({ model }) {
      const current = model.populationGroups[cell.id].find(candidate => candidate.id === group.id)!;
      return [{
        kind: 'population-state',
        cell: cell.id,
        group: current.id,
        amount: current.count,
        change: { wellbeing: 0.2 },
      }];
    },
  };
  const observeLate: Rule = {
    id: 'test.cache.late',
    phase: 'events',
    description: 'Observe the same cache after population changes settled.',
    run({ cache }) {
      assert.ok(cache);
      seen.push(cache);
      return [];
    },
  };

  const changed = step(game, [observeEarly, changePeople, observeLate]);
  assert.equal(seen.length, 2);
  assert.strictEqual(seen[0], seen[1]);
  const cachedWellbeing = seen[0].peopleByCell[cell.id].averageWellbeing;

  let nextCache: DeepReadonly<StepCache> | undefined;
  const observeNext: Rule = {
    id: 'test.cache.next',
    phase: 'production',
    description: 'Observe the next step cache.',
    run({ cache }) {
      assert.ok(cache);
      nextCache = cache;
      return [];
    },
  };
  step(changed, [observeNext]);

  assert.ok(nextCache);
  assert.notStrictEqual(nextCache, seen[0]);
  assert.ok(nextCache.peopleByCell[cell.id].averageWellbeing > cachedWellbeing);
  assert.equal('cache' in changed, false);
  assert.equal('cache' in changed.model, false);
});
