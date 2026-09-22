import type { DeepReadonly, Mapxel, Model, Summary } from './types';
export const clamp = (n: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, n));
export const approach = (from: number, target: number, rate: number): number => (target - from) * rate;
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); return (h ^ (h >>> 16)) >>> 0;
}
export const randomAt = (seed: string, ...keys: (number | string)[]): number => hash(`${seed}|${keys.join('|')}`) / 4294967296;
export function summarize(model: DeepReadonly<Model>, ids?: readonly number[]): Summary {
  const cells = ids ? ids.map(i => model.cells[i]).filter(c => c && c.biome !== 'water') : model.cells.filter(c => c.biome !== 'water');
  const population = cells.reduce((a, c) => a + c.population, 0);
  const mean = (key: keyof Mapxel) => cells.reduce((a, c) => a + Number(c[key]) * c.population, 0) / Math.max(1, population);
  return {
    population, wealth: cells.reduce((a, c) => a + c.cash, 0) / Math.max(1, population),
    approval: mean('approval'), happiness: mean('happiness'), crime: mean('crime'), foodSecurity: mean('foodSecurity'),
    employment: mean('employment'), pollution: mean('pollution'), health: mean('health'), education: mean('education'), price: mean('price'),
    output: cells.reduce((a, c) => a + c.output, 0), food: cells.reduce((a, c) => a + c.food, 0), treasury: model.treasury, debt: model.debt,
  };
}
export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child);
  }
  return value as DeepReadonly<T>;
}
