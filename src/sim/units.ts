declare const quantityBrand: unique symbol;

/**
 * Compile-time tag for values with physical/economic meaning. Quantities are still
 * plain numbers at runtime, so saves and arithmetic stay cheap; constructors make
 * literals and boundary conversions explicit in code and tests.
 */
export type Quantity<Unit extends string> = number & {
  readonly [quantityBrand]: Unit;
};

export type People = Quantity<'people'>;
export type PersonMonths = Quantity<'person-months-food'>;
export type MaterialUnits = Quantity<'material-units'>;
export type Crowns = Quantity<'crowns'>;
export type CrownsPerPerson = Quantity<'crowns/person'>;
export type CrownsPerPersonMonth = Quantity<'crowns/person/month'>;
export type CrownsPerMonth = Quantity<'crowns/month'>;
export type FoodPrice = Quantity<'crowns/person-month-food'>;
export type MaterialPrice = Quantity<'crowns/material-unit'>;
export type Share = Quantity<'share'>;
export type Index = Quantity<'index'>;
export type Years = Quantity<'years'>;
export type Months = Quantity<'months'>;

function asQuantity<Unit extends string>(value: number, name: Unit): Quantity<Unit> {
  if (!Number.isFinite(value)) throw new Error(`Invalid ${name}: ${value}`);
  return value as Quantity<Unit>;
}

export const people = (value: number): People => asQuantity(value, 'people');
export const personMonths = (value: number): PersonMonths => asQuantity(value, 'person-months-food');
export const materialUnits = (value: number): MaterialUnits => asQuantity(value, 'material-units');
export const crowns = (value: number): Crowns => asQuantity(value, 'crowns');
export const crownsPerPerson = (value: number): CrownsPerPerson => asQuantity(value, 'crowns/person');
export const crownsPerPersonMonth = (value: number): CrownsPerPersonMonth => asQuantity(value, 'crowns/person/month');
export const crownsPerMonth = (value: number): CrownsPerMonth => asQuantity(value, 'crowns/month');
export const foodPrice = (value: number): FoodPrice => asQuantity(value, 'crowns/person-month-food');
export const materialPrice = (value: number): MaterialPrice => asQuantity(value, 'crowns/material-unit');
export const share = (value: number): Share => asQuantity(value, 'share');
export const index = (value: number): Index => asQuantity(value, 'index');
export const years = (value: number): Years => asQuantity(value, 'years');
export const months = (value: number): Months => asQuantity(value, 'months');

/** Reference price used wherever behavior needs a dimensionless food-price ratio. */
export const REFERENCE_FOOD_PRICE = foodPrice(1);

/** One simulation step is exactly one month. */
export const STEP_DURATION = months(1);

/** Each resident requires one person-month of food per monthly step. */
export function monthlyFoodNeed(population: People): PersonMonths {
  return personMonths(population);
}

/** Realized food coverage, capped at 100%. */
export function foodCoverage(available: PersonMonths, need: PersonMonths): Share {
  return share(need > 0 ? Math.min(1, available / need) : 1);
}

/** Convert monthly monetary output into one step's cash amount. */
export function oneMonthOf(rate: CrownsPerMonth): Crowns {
  return crowns(rate * STEP_DURATION);
}

/** Monthly monetary output per resident. */
export function outputPerPerson(output: CrownsPerMonth, population: People): CrownsPerPersonMonth {
  return crownsPerPersonMonth(output / Math.max(population, 1e-12));
}

/** Food price normalized to the reference price, for dimensionless behavioral formulas. */
export function relativeFoodPrice(price: FoodPrice): number {
  return price / REFERENCE_FOOD_PRICE;
}

export function foodTradeCost(amount: PersonMonths, price: FoodPrice): Crowns {
  return crowns(amount * price);
}

export function materialTradeCost(amount: MaterialUnits, price: MaterialPrice): Crowns {
  return crowns(amount * price);
}
