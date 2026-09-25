import type { Effect, Mapxel } from '../src/sim/types';
import {
  crowns,
  crownsPerMonth,
  foodPrice,
  people,
  personMonths,
} from '../src/sim/units';

/**
 * Compile-only examples for maintainers. This file is included by TypeScript but
 * not executed by the test runner. If a future refactor weakens the unit brands,
 * the @ts-expect-error assertions become unused and fail the build.
 */
function mapxelUnitContracts(cell: Mapxel): void {
  cell.population = people(120);
  cell.cash = crowns(500);
  cell.food = personMonths(240);
  cell.price = foodPrice(1.2);
  cell.output = crownsPerMonth(900);

  // @ts-expect-error resident counts are not food inventories
  cell.food = people(240);
  // @ts-expect-error food inventories are not money
  cell.cash = personMonths(500);
  // @ts-expect-error monthly output is a rate, not a cash balance
  cell.cash = crownsPerMonth(900);
  // @ts-expect-error a food price is not a monthly output rate
  cell.output = foodPrice(1.2);
}
void mapxelUnitContracts;

const validFoodTrade: Effect = {
  kind: 'trade',
  from: 1,
  to: 2,
  resource: 'food',
  amount: personMonths(10),
  price: foodPrice(1.3),
};
void validFoodTrade;

const invalidFoodTrade: Effect = {
  kind: 'trade',
  from: 1,
  to: 2,
  resource: 'food',
  // @ts-expect-error food trade amount must be person-months, not people
  amount: people(10),
  price: foodPrice(1.3),
};
void invalidFoodTrade;
