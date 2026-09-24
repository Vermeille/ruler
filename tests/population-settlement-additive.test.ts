import test from 'node:test';
import assert from 'node:assert/strict';
import { commitEffects } from '../src/sim/engine';
import { deepFreeze } from '../src/sim/math';
import { createGame } from '../src/sim/world';

test('full-cohort continuous state effects stack without fragmenting the cohort', () => {
  const game = createGame('additive-population-state', 12, 12);
  const cell = game.model.cells.find(candidate => candidate.population > 0)!;
  const group = game.model.populationGroups[cell.id][0];
  const groupId = group.id;
  const groupCount = group.count;
  const nextId = game.model.nextPopulationGroupId;
  const approval = group.approval;
  const outlook = group.outlook;
  const snapshot = deepFreeze(structuredClone(game.model));

  commitEffects(game, snapshot, [
    {
      rule: 'test.approval',
      effect: {
        kind: 'population-state',
        cell: cell.id,
        group: groupId,
        amount: groupCount,
        change: { approval: -0.04 },
      },
    },
    {
      rule: 'test.outlook',
      effect: {
        kind: 'population-state',
        cell: cell.id,
        group: groupId,
        amount: groupCount,
        change: { outlook: -0.12 },
      },
    },
  ]);

  const settled = game.model.populationGroups[cell.id].find(candidate => candidate.id === groupId)!;
  assert.equal(settled.count, groupCount);
  assert.equal(game.model.nextPopulationGroupId, nextId);
  assert.equal(game.model.populationGroups[cell.id].filter(candidate => candidate.id === groupId).length, 1);
  assert.ok(Math.abs(settled.approval - (approval - 0.04)) < 1e-12);
  assert.ok(Math.abs(settled.outlook - (outlook - 0.12)) < 1e-12);
});
