import test from 'node:test';
import assert from 'node:assert/strict';
import { commitEffects } from '../src/sim/engine';
import { deepFreeze } from '../src/sim/math';
import { createGame } from '../src/sim/world';

test('raw mapxel population deltas are rejected instead of reconciling groups afterward', () => {
  const game = createGame('population-boundary', 12, 12);
  const cell = game.model.cells.find(candidate => candidate.population > 0)!;
  const populationBefore = cell.population;
  const groupsBefore = structuredClone(game.model.populationGroups[cell.id]);
  const snapshot = deepFreeze(structuredClone(game.model));

  assert.throws(() => commitEffects(game, snapshot, [{
    rule: 'legacy.population-write',
    effect: { kind: 'delta', cell: cell.id, field: 'population', amount: -1 },
  }]), /dedicated effect/);

  assert.equal(cell.population, populationBefore);
  assert.deepEqual(game.model.populationGroups[cell.id], groupsBefore);
});
