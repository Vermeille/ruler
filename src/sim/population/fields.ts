import { clamp } from '../math';
import type {
  DeepReadonly,
  PopulationGroup,
  PopulationStateField,
} from '../types';

export type PopulationStateFieldSpec = {
  storage: 'group' | 'attitudes';
  min?: number;
  max?: number;
};

/**
 * One registry owns the mechanics of mutable scalar population state.
 *
 * Rules should care about behavior. Settlement should not know that a concept called
 * "environmentalism" exists. Adding a new scalar circumstance or attitude should require
 * adding its type and one entry here, not editing engine internals in several places.
 *
 * The `satisfies` clause deliberately makes this exhaustive: when PopulationStateField grows,
 * TypeScript points at this registry until the new field's bounds/storage semantics are declared.
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

export function populationStateFieldSpec(field: string): PopulationStateFieldSpec | undefined {
  return (POPULATION_STATE_FIELDS as Record<string, PopulationStateFieldSpec>)[field];
}

export function readPopulationStateField(
  group: DeepReadonly<PopulationGroup>,
  field: PopulationStateField,
): number {
  const spec = POPULATION_STATE_FIELDS[field];
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
  const spec = POPULATION_STATE_FIELDS[field];
  const value = bounded(readPopulationStateField(source, field) + delta, spec);
  if (spec.storage === 'attitudes') {
    target.attitudes[field as keyof PopulationGroup['attitudes']] = value;
    return;
  }
  (target as unknown as Record<string, unknown>)[field] = value;
}
