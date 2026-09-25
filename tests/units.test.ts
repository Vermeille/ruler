import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REFERENCE_FOOD_PRICE,
  crowns,
  crownsPerMonth,
  foodCoverage,
  foodPrice,
  foodTradeCost,
  materialPrice,
  materialTradeCost,
  materialUnits,
  monthlyFoodNeed,
  oneMonthOf,
  outputPerPerson,
  people,
  personMonths,
  relativeFoodPrice,
} from '../src/sim/units';

test('unit constructors are zero-overhead values suitable for fixtures', () => {
  assert.equal(people(12), 12);
  assert.equal(personMonths(18), 18);
  assert.equal(crowns(42), 42);
  assert.equal(foodPrice(1.3), 1.3);
});

test('food accounting is written in person-months and coverage shares', () => {
  const population = people(100);
  const need = monthlyFoodNeed(population);

  assert.equal(need, personMonths(100));
  assert.equal(foodCoverage(personMonths(73), need), 0.73);
  assert.equal(foodCoverage(personMonths(140), need), 1);
});

test('food price is money per person-month, not an unexplained index', () => {
  assert.equal(REFERENCE_FOOD_PRICE, foodPrice(1));
  assert.equal(relativeFoodPrice(foodPrice(1.4)), 1.4);
  assert.equal(foodTradeCost(personMonths(20), foodPrice(1.5)), crowns(30));
});

test('materials have their own quantity and price units', () => {
  assert.equal(materialTradeCost(materialUnits(10), materialPrice(0.65)), crowns(6.5));
});

test('monthly output has explicit time and per-person conversions', () => {
  const output = crownsPerMonth(600);
  assert.equal(oneMonthOf(output), crowns(600));
  assert.equal(outputPerPerson(output, people(100)), 6);
});
