import test from 'node:test';
import assert from 'node:assert/strict';
import { orderRules, step } from '../src/sim/engine';
import { defaultRules } from '../src/sim/rules';
import { RULE_DIRECTIONS, type Rule } from '../src/sim/types';
import { createGame } from '../src/sim/world';

test('every default rule declares one of the four causal directions', () => {
  assert.ok(defaultRules.length > 0);
  for (const rule of defaultRules) {
    assert.ok(RULE_DIRECTIONS.includes(rule.direction), `${rule.id} has no valid direction`);
  }
});

test('rule direction is mandatory at runtime for extension rules too', () => {
  const missingDirection = {
    id: 'test.missing-direction',
    phase: 'production',
    description: '',
    run: () => [],
  } as unknown as Rule;
  assert.throws(() => orderRules([missingDirection]), /Unknown rule direction/);
});

test('mapxel-to-people rules cannot emit mapxel effects', () => {
  const game = createGame('direction-map-to-people', 12, 12, 4);
  const cell = game.model.cells.find(candidate => candidate.biome !== 'water')!;
  const rule: Rule = {
    id: 'test.bad-mapxel-to-people',
    direction: 'mapxel-to-people',
    phase: 'experience',
    description: '',
    run: () => [{ kind: 'delta', cell: cell.id, field: 'crime', amount: 0.1 }],
  };
  assert.throws(() => step(game, [rule]), /mapxel-to-people.*delta.*mapxel output/);
});

test('people-to-mapxel rules cannot emit population effects', () => {
  const game = createGame('direction-people-to-map', 12, 12, 4);
  const cell = game.model.cells.find(candidate => candidate.biome !== 'water')!;
  const group = game.model.populationGroups[cell.id][0];
  const rule: Rule = {
    id: 'test.bad-people-to-mapxel',
    direction: 'people-to-mapxel',
    phase: 'behavior',
    description: '',
    run: () => [{
      kind: 'population-state',
      cell: cell.id,
      group: group.id,
      amount: group.count,
      change: { wellbeing: 0.01 },
    }],
  };
  assert.throws(() => step(game, [rule]), /people-to-mapxel.*population-state.*people output/);
});

test('people-to-people rules may emit population effects', () => {
  const game = createGame('direction-good-people', 12, 12, 4);
  const cell = game.model.cells.find(candidate => candidate.biome !== 'water')!;
  const group = game.model.populationGroups[cell.id][0];
  const rule: Rule = {
    id: 'test.good-people-to-people',
    direction: 'people-to-people',
    phase: 'aging',
    description: '',
    run: () => [{
      kind: 'population-state',
      cell: cell.id,
      group: group.id,
      amount: group.count,
      change: { age: 1 / 12 },
    }],
  };
  assert.doesNotThrow(() => step(game, [rule]));
});
