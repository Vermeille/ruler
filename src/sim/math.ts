import type { DeepReadonly, Mapxel, Model, Summary } from './types';
import type { SimulationUnit } from './map-fields';

export type SummaryFieldSpec = {
  unit: SimulationUnit;
  description: string;
};

export const SUMMARY_FIELDS = {
  population: { unit: 'count', description: 'Total residents in the selected area' },
  wealth: { unit: 'crown/person', description: 'Private cash per resident in the selected area' },
  approval: { unit: 'index', description: 'Population-weighted government approval' },
  happiness: { unit: 'index', description: 'Population-weighted resident wellbeing projection' },
  crime: { unit: 'index', description: 'Population-weighted crime pressure' },
  foodSecurity: { unit: 'share', description: 'Population-weighted realized food consumption divided by need, capped at 1' },
  employment: { unit: 'share', description: 'Population-weighted employment share' },
  pollution: { unit: 'index', description: 'Population-weighted pollution' },
  output: { unit: 'activity/month', description: 'Total abstract taxable economic activity per month' },
  health: { unit: 'index', description: 'Population-weighted health' },
  education: { unit: 'index', description: 'Population-weighted education' },
  price: { unit: 'price-index', description: 'Population-weighted food price relative to reference price 1' },
  treasury: { unit: 'crown', description: 'Government cash balance' },
  debt: { unit: 'crown', description: 'Government debt balance' },
  food: { unit: 'person-month', description: 'Total food stock; one unit feeds one resident for one month' },
  starvationDeaths: { unit: 'count', description: 'Reported severe food-deprivation deaths this month' },
} as const satisfies Record<keyof Summary, SummaryFieldSpec>;


export function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function approach(from: number, target: number, rate: number): number {
  return (target - from) * rate;
}

export function hash(text: string): number {
  let value = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }

  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function randomAt(seed: string, ...keys: (number | string)[]): number {
  return hash(`${seed}|${keys.join('|')}`) / 4294967296;
}

function selectedLandCells(
  model: DeepReadonly<Model>,
  ids?: readonly number[],
): readonly DeepReadonly<Mapxel>[] {
  if (ids) {
    return ids
      .map(id => model.cells[id])
      .filter(cell => cell && cell.biome !== 'water');
  }

  return model.cells.filter(cell => cell.biome !== 'water');
}

export function summarize(
  model: DeepReadonly<Model>,
  ids?: readonly number[],
): Summary {
  const cells = selectedLandCells(model, ids);
  const population = cells.reduce((sum, cell) => sum + cell.population, 0);
  const populationDivisor = Math.max(1, population);

  const weightedMean = (field: keyof Mapxel): number => {
    const weightedTotal = cells.reduce(
      (sum, cell) => sum + Number(cell[field]) * cell.population,
      0,
    );
    return weightedTotal / populationDivisor;
  };

  return {
    population,
    wealth: cells.reduce((sum, cell) => sum + cell.cash, 0) / populationDivisor,
    approval: weightedMean('approval'),
    happiness: weightedMean('happiness'),
    crime: weightedMean('crime'),
    foodSecurity: weightedMean('foodSecurity'),
    employment: weightedMean('employment'),
    pollution: weightedMean('pollution'),
    health: weightedMean('health'),
    education: weightedMean('education'),
    price: weightedMean('price'),
    output: cells.reduce((sum, cell) => sum + cell.output, 0),
    food: cells.reduce((sum, cell) => sum + cell.food, 0),
    starvationDeaths: cells.reduce((sum, cell) => sum + cell.starvationDeaths, 0),
    treasury: model.treasury,
    debt: model.debt,
  };
}

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);

    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }

  return value as DeepReadonly<T>;
}
