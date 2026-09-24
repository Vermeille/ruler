import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAPXEL_FIELDS,
  MUTABLE_FIELDS,
  constrainMapxelFieldValue,
  validMapxelFieldValue,
} from '../src/sim/map-fields';
import { createGame } from '../src/sim/world';

test('mapxel field registry owns mutable field mechanics', () => {
  assert.deepEqual(new Set(MUTABLE_FIELDS), new Set(Object.keys(MAPXEL_FIELDS)));
  assert.equal(MAPXEL_FIELDS.cash.delta, false);
  assert.equal(MAPXEL_FIELDS.population.delta, false);
  assert.equal('resource' in MAPXEL_FIELDS.population, false);
  assert.equal(MAPXEL_FIELDS.food.resource, 'food');
  assert.equal(MAPXEL_FIELDS.materials.resource, 'materials');
  assert.equal(constrainMapxelFieldValue('price', 99), 5);
  assert.equal(constrainMapxelFieldValue('happiness', -2), 0);
  assert.equal(constrainMapxelFieldValue('foodTraded', -2), -2);
  assert.equal(validMapxelFieldValue('price', 0.39), false);
  assert.equal(validMapxelFieldValue('foodTraded', -999), true);
  assert.equal(validMapxelFieldValue('businessHealth', 1.01), false);
});

test('generated mapxels satisfy the registry', () => {
  const game = createGame('map-field-registry', 18, 14);
  for (const cell of game.model.cells) {
    for (const field of MUTABLE_FIELDS) {
      assert.ok(validMapxelFieldValue(field, cell[field], 1e-6), `${field} invalid in cell ${cell.id}`);
    }
  }
});
