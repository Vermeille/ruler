import type { MutableField } from './types';

export type MapxelResource = 'food' | 'materials';

export type SimulationUnit =
  | 'count'
  | 'person-month'
  | 'crown'
  | 'crown/person'
  | 'activity/month'
  | 'index'
  | 'share'
  | 'price-index'
  | 'map-coordinate'
  | 'region-id';

export type MapxelFieldSpec = {
  /** Human- and tool-readable dimensional meaning of this number. */
  unit: SimulationUnit;
  /** Short semantic definition; units alone cannot distinguish two different indices. */
  description: string;
  min?: number;
  max?: number;
  /** Whether rules may write this field with a delta effect. Cash and population use dedicated effects. */
  delta: boolean;
  /** Negative deltas to conserved resources are scaled to phase-start availability. */
  resource?: MapxelResource;
};

/**
 * Mechanical semantics for mutable mapxel state. Rules decide why a field changes; the engine,
 * saves, validation, and tools can derive how that field behaves from this registry.
 * Adding a mutable numeric Mapxel field makes this exhaustive registry a compiler-enforced task.
 */
export const MAPXEL_FIELDS = {
  population: { unit: 'count', description: 'Residents in this mapxel', min: 0, delta: false },
  cash: { unit: 'crown', description: 'Pooled private cash held in this mapxel', min: 0, delta: false },
  food: { unit: 'person-month', description: 'Food stock; one unit feeds one resident for one month', min: 0, delta: true, resource: 'food' },
  materials: { unit: 'index', description: 'Abstract material stock; not yet mapped to a physical unit', min: 0, delta: true, resource: 'materials' },
  price: { unit: 'price-index', description: 'Local food price relative to reference price 1', min: 0.4, max: 5, delta: true },
  scarcityPrice: { unit: 'price-index', description: 'Scarcity-driven reference food price, where 1 is baseline', min: 0.4, max: 5, delta: true },
  waterStress: { unit: 'index', description: 'Normalized water stress', min: 0, max: 1, delta: true },
  children: { unit: 'share', description: 'Share of residents who are children', min: 0, max: 1, delta: true },
  seniors: { unit: 'share', description: 'Share of residents who are seniors', min: 0, max: 1, delta: true },
  education: { unit: 'index', description: 'Population-weighted normalized education level', min: 0, max: 1, delta: true },
  health: { unit: 'index', description: 'Population-weighted normalized health', min: 0, max: 1, delta: true },
  happiness: { unit: 'index', description: 'Population-weighted normalized wellbeing projection', min: 0, max: 1, delta: true },
  approval: { unit: 'index', description: 'Population-weighted normalized government approval', min: 0, max: 1, delta: true },
  crime: { unit: 'index', description: 'Normalized local crime pressure', min: 0, max: 1, delta: true },
  pollution: { unit: 'index', description: 'Normalized local pollution', min: 0, max: 1, delta: true },
  infrastructure: { unit: 'index', description: 'Normalized transport and infrastructure quality', min: 0, max: 1, delta: true },
  employment: { unit: 'share', description: 'Share of working-age residents employed', min: 0, max: 1, delta: true },
  foodSecurity: { unit: 'share', description: 'Realized food consumption divided by monthly food need, capped at 1', min: 0, max: 1, delta: true },
  sportsInterest: { unit: 'index', description: 'Normalized local interest in sports', min: 0, max: 1, delta: true },
  agriculture: { unit: 'share', description: 'Projected share of employed residents in agriculture', min: 0, max: 1, delta: true },
  manufacturing: { unit: 'share', description: 'Projected share of employed residents in manufacturing', min: 0, max: 1, delta: true },
  services: { unit: 'share', description: 'Projected share of employed residents in services', min: 0, max: 1, delta: true },
  sports: { unit: 'share', description: 'Projected share of employed residents in sports', min: 0, max: 1, delta: true },
  output: { unit: 'activity/month', description: 'Abstract taxable economic activity produced per month; not currency', min: 0, delta: true },
  foodMade: { unit: 'person-month', description: 'Food produced during the current month', min: 0, delta: true },
  foodUsed: { unit: 'person-month', description: 'Food consumed during the current month', min: 0, delta: true },
  foodTraded: { unit: 'person-month', description: 'Net food imported this month; negative means net exports', delta: true },
  businessHealth: { unit: 'index', description: 'Normalized local business viability', min: 0, max: 1, delta: true },
  starvationDeaths: { unit: 'count', description: 'Reported severe food-deprivation deaths this month', min: 0, delta: true },
} as const satisfies Record<MutableField, MapxelFieldSpec>;

export const MUTABLE_FIELDS = Object.keys(MAPXEL_FIELDS) as MutableField[];

export function mapxelFieldSpec(field: string): MapxelFieldSpec | undefined {
  return (MAPXEL_FIELDS as Record<string, MapxelFieldSpec>)[field];
}

export function isMutableMapxelField(field: string): field is MutableField {
  return mapxelFieldSpec(field) !== undefined;
}

export function constrainMapxelFieldValue(field: MutableField, value: number): number {
  const spec: MapxelFieldSpec = MAPXEL_FIELDS[field];
  let result = value;
  if (spec.min !== undefined) result = Math.max(spec.min, result);
  if (spec.max !== undefined) result = Math.min(spec.max, result);
  return result;
}

export function validMapxelFieldValue(
  field: MutableField,
  value: unknown,
  epsilon = 0,
): boolean {
  const spec: MapxelFieldSpec = MAPXEL_FIELDS[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (spec.min !== undefined && value < spec.min - epsilon) return false;
  if (spec.max !== undefined && value > spec.max + epsilon) return false;
  return true;
}
