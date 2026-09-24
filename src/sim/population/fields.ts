import { clamp } from '../math';
import { SECTORS, type DeepReadonly, type PopulationGroup, type PopulationStateField, type PopulationTransitionField } from '../types';

export type PopulationStateFieldSpec = {
  storage: 'group' | 'attitudes';
  min?: number;
  max?: number;
};

export type PopulationTransitionFieldSpec = {
  valid(value: unknown): boolean;
};

/**
 * Mechanical semantics for mutable population state. Behavior rules should only decide what
 * changes; settlement reads storage and bounds from this registry. The exhaustive `satisfies`
 * clauses intentionally make adding state to PopulationGroup produce one obvious compiler task.
 */
export const POPULATION_STATE_FIELDS = {
  age: { storage: 'group', min: 0 },
  education: { storage: 'group', min: 0, max: 1 },
  income: { storage: 'group', min: 0 },
  wealth: { storage: 'group', min: 0 },
  health: { storage: 'group', min: 0, max: 1 },
  wellbeing: { storage: 'group', min: 0, max: 1 },
  approval: { storage: 'group', min: 0, max: 1 },
  environmentalism: { storage: 'attitudes', min: 0, max: 1 },
  civicLiberty: { storage: 'attitudes', min: 0, max: 1 },
  traditionalism: { storage: 'attitudes', min: 0, max: 1 },
  solidarity: { storage: 'attitudes', min: 0, max: 1 },
} as const satisfies Record<PopulationStateField, PopulationStateFieldSpec>;

export const POPULATION_TRANSITION_FIELDS = {
  lifeStage: { valid: (value: unknown) => value === 'child' || value === 'adult' || value === 'senior' },
  occupation: { valid: (value: unknown) => value === null
    || (typeof value === 'string' && (SECTORS as readonly string[]).includes(value)) },
  employed: { valid: (value: unknown) => typeof value === 'boolean' },
} satisfies Record<PopulationTransitionField, PopulationTransitionFieldSpec>;

export function populationStateFieldSpec(field: string): PopulationStateFieldSpec | undefined {
  return (POPULATION_STATE_FIELDS as Record<string, PopulationStateFieldSpec>)[field];
}

export function populationTransitionFieldSpec(field: string): PopulationTransitionFieldSpec | undefined {
  return (POPULATION_TRANSITION_FIELDS as Record<string, PopulationTransitionFieldSpec>)[field];
}

export function readPopulationStateField(
  group: DeepReadonly<PopulationGroup>,
  field: PopulationStateField,
): number {
  const spec: PopulationStateFieldSpec = POPULATION_STATE_FIELDS[field];
  return spec.storage === 'attitudes'
    ? group.attitudes[field as keyof PopulationGroup['attitudes']]
    : Number(group[field as keyof PopulationGroup]);
}

function bounded(value: number, spec: PopulationStateFieldSpec): number {
  if (spec.min !== undefined && spec.max !== undefined) return clamp(value, spec.min, spec.max);
  if (spec.min !== undefined) return Math.max(spec.min, value);
  if (spec.max !== undefined) return Math.min(spec.max, value);
  return value;
}

export function applyPopulationStateDelta(
  target: PopulationGroup,
  source: DeepReadonly<PopulationGroup>,
  field: PopulationStateField,
  delta: number,
): void {
  const spec: PopulationStateFieldSpec = POPULATION_STATE_FIELDS[field];
  const value = bounded(readPopulationStateField(source, field) + delta, spec);
  if (spec.storage === 'attitudes') {
    target.attitudes[field as keyof PopulationGroup['attitudes']] = value;
    return;
  }
  (target as unknown as Record<string, unknown>)[field] = value;
}

export function validPopulationStateValue(field: PopulationStateField, value: unknown): boolean {
  const spec: PopulationStateFieldSpec = POPULATION_STATE_FIELDS[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (spec.min !== undefined && value < spec.min) return false;
  if (spec.max !== undefined && value > spec.max) return false;
  return true;
}
