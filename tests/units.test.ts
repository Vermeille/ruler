import assert from 'node:assert/strict';
import test from 'node:test';
import { MAPXEL_FIELDS } from '../src/sim/map-fields';
import { SUMMARY_FIELDS } from '../src/sim/math';

test('simulation fields expose meaningful units and descriptions', () => {
  for (const [field, spec] of Object.entries(MAPXEL_FIELDS)) {
    assert.ok(spec.unit, `${field} must declare a unit`);
    assert.ok(spec.description.trim(), `${field} must describe its semantics`);
  }

  for (const [field, spec] of Object.entries(SUMMARY_FIELDS)) {
    assert.ok(spec.unit, `${field} must declare a unit`);
    assert.ok(spec.description.trim(), `${field} must describe its semantics`);
  }
});

test('food accounting uses person-months while food security is a coverage share', () => {
  assert.equal(MAPXEL_FIELDS.food.unit, 'person-month');
  assert.equal(MAPXEL_FIELDS.foodMade.unit, 'person-month');
  assert.equal(MAPXEL_FIELDS.foodUsed.unit, 'person-month');
  assert.equal(MAPXEL_FIELDS.foodTraded.unit, 'person-month');
  assert.equal(MAPXEL_FIELDS.foodSecurity.unit, 'share');
  assert.equal(SUMMARY_FIELDS.food.unit, 'person-month');
  assert.equal(SUMMARY_FIELDS.foodSecurity.unit, 'share');
});

test('economic activity is not mislabeled as money', () => {
  assert.equal(MAPXEL_FIELDS.output.unit, 'activity/month');
  assert.equal(SUMMARY_FIELDS.output.unit, 'activity/month');
  assert.equal(MAPXEL_FIELDS.cash.unit, 'crown');
  assert.equal(SUMMARY_FIELDS.treasury.unit, 'crown');
  assert.equal(SUMMARY_FIELDS.debt.unit, 'crown');
});
