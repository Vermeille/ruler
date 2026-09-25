import type { MutableField } from './types';
import type { MapxelQuantity } from './units';

export type MapxelResource = 'food' | 'materials';

export type MapxelFieldSpec = {
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
  population: { min: 0, delta: false },
  cash: { min: 0, delta: false },
  food: { min: 0, delta: true, resource: 'food' },
  materials: { min: 0, delta: true, resource: 'materials' },
  price: { min: 0.4, max: 5, delta: true },
  scarcityPrice: { min: 0.4, max: 5, delta: true },
  waterStress: { min: 0, max: 1, delta: true },
  children: { min: 0, max: 1, delta: true },
  seniors: { min: 0, max: 1, delta: true },
  education: { min: 0, max: 1, delta: true },
  health: { min: 0, max: 1, delta: true },
  happiness: { min: 0, max: 1, delta: true },
  approval: { min: 0, max: 1, delta: true },
  crime: { min: 0, max: 1, delta: true },
  pollution: { min: 0, max: 1, delta: true },
  infrastructure: { min: 0, max: 1, delta: true },
  employment: { min: 0, max: 1, delta: true },
  foodSecurity: { min: 0, max: 1, delta: true },
  sportsInterest: { min: 0, max: 1, delta: true },
  agriculture: { min: 0, max: 1, delta: true },
  manufacturing: { min: 0, max: 1, delta: true },
  services: { min: 0, max: 1, delta: true },
  sports: { min: 0, max: 1, delta: true },
  output: { min: 0, delta: true },
  foodMade: { min: 0, delta: true },
  foodUsed: { min: 0, delta: true },
  foodTraded: { delta: true },
  businessHealth: { min: 0, max: 1, delta: true },
  starvationDeaths: { min: 0, delta: true },
} as const satisfies Record<MutableField, MapxelFieldSpec>;

export const MUTABLE_FIELDS = Object.keys(MAPXEL_FIELDS) as MutableField[];

export function mapxelFieldSpec(field: string): MapxelFieldSpec | undefined {
  return (MAPXEL_FIELDS as Record<string, MapxelFieldSpec>)[field];
}

export function isMutableMapxelField(field: string): field is MutableField {
  return mapxelFieldSpec(field) !== undefined;
}

export function constrainMapxelFieldValue<Field extends MutableField>(
  field: Field,
  value: number,
): MapxelQuantity<Field> {
  const spec: MapxelFieldSpec = MAPXEL_FIELDS[field];
  let result = value;
  if (spec.min !== undefined) result = Math.max(spec.min, result);
  if (spec.max !== undefined) result = Math.min(spec.max, result);
  return result as MapxelQuantity<Field>;
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
