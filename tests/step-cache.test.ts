import test from 'node:test';
import assert from 'node:assert/strict';
import { step } from '../src/sim/engine';
import { buildStepCache } from '../src/sim/step-cache';
import type { DeepReadonly, Rule, StepCache } from '../src/sim/types';
import { createGame } from '../src/sim/world';

const HUMAN_COMPATIBILITY_FIELDS = [
  'employment',
  'happiness',
  'approval',
  'children',
  'seniors',
  'agriculture',
  'manufacturing',
  'services',
  'sports',
] as const;

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

test('default causal rules ignore persisted human compatibility projections', () => {
  const baseline = createGame('step-cache-causal-authority', 12, 12, 48);
  const poisoned = structuredClone(baseline);

  for (const cell of poisoned.model.cells) {
    if (cell.biome === 'water') continue;
    cell.employment = 1 - cell.employment;
    cell.happiness = 1 - cell.happiness;
    cell.approval = 1 - cell.approval;
    cell.children = 1 - cell.children;
    cell.seniors = 1 - cell.seniors;
    cell.agriculture = 0;
    cell.manufacturing = 0;
    cell.services = 0;
    cell.sports = 1;
  }

  const ordinary = step(baseline);
  const fromPoisonedMirrors = step(poisoned);

  // Projection writes are expressed as deltas, so old + (target - old) can differ by an
  // IEEE-754 rounding bit for different old mirror values. They must still reconverge to
  // the same authoritative human projection within numeric precision.
  for (const cell of ordinary.model.cells) {
    if (cell.biome === 'water') continue;
    const poisonedCell = fromPoisonedMirrors.model.cells[cell.id];
    for (const field of HUMAN_COMPATIBILITY_FIELDS) {
      assert.ok(
        Math.abs(poisonedCell[field] - cell[field]) < 1e-12,
        `${field} projection in mapxel ${cell.id} must be independent of its persisted mirror`,
      );
    }
  }

  // Ignore the compatibility copies themselves for the exact comparison. Everything
  // causal, including authoritative population groups, must remain bit-for-bit identical.
  const ordinaryCausalModel = structuredClone(ordinary.model);
  const poisonedCausalModel = structuredClone(fromPoisonedMirrors.model);
  for (const cell of ordinaryCausalModel.cells) {
    for (const field of HUMAN_COMPATIBILITY_FIELDS) cell[field] = 0;
  }
  for (const cell of poisonedCausalModel.cells) {
    for (const field of HUMAN_COMPATIBILITY_FIELDS) cell[field] = 0;
  }
  assert.deepEqual(
    poisonedCausalModel,
    ordinaryCausalModel,
    'changing compatibility projections must not alter causal simulation results',
  );
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
    direction: 'mapxel-to-mapxel',
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
    direction: 'people-to-people',
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
    direction: 'mapxel-to-mapxel',
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
    direction: 'mapxel-to-mapxel',
    phase: 'production',
    description: 'Observe the next step cache.',
    run({ cache }) {
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
