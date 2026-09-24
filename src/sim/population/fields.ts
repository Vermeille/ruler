import { clamp } from '../math';
import { SECTORS, type DeepReadonly, type PopulationGroup, type PopulationStateField, type PopulationTransitionField } from '../types';

type MergeTolerance = number | Readonly<Record<PopulationGroup['lifeStage'], number>>;

export type PopulationStateFieldSpec = {
  storage: 'group' | 'attitudes';
  min?: number;
  max?: number;
  mergeTolerance: MergeTolerance;
};

export type PopulationTransitionFieldSpec = {
  valid(value: unknown): boolean;
};

/**
 * Mechanical semantics for mutable population state. Behavior rules should only decide what
 * changes; settlement, validation, and compaction all read their mechanics from this registry.
 * The exhaustive `satisfies` clauses intentionally make adding state to PopulationGroup produce
 * one obvious compiler task rather than several synchronized field lists.
 */
export const POPULATION_STATE_FIELDS = {
  age: {
    storage: 'group',
    min: 0,
    mergeTolerance: { child: 2.5, adult: 1, senior: 2 },
  },
  education: { storage: 'group', min: 0, max: 1, mergeTolerance: 0.03 },
  income: { storage: 'group', min: 0, mergeTolerance: 0.75 },
  wealth: { storage: 'group', min: 0, mergeTolerance: 2 },
  health: { storage: 'group', min: 0, max: 1, mergeTolerance: 0.03 },
  wellbeing: { storage: 'group', min: 0, max: 1, mergeTolerance: 0.04 },
  approval: { storage: 'group', min: 0, max: 1, mergeTolerance: 0.04 },
  outlook: { storage: 'group', min: -1, max: 1, mergeTolerance: 0.08 },
  mobilization: { storage: 'group', min: 0, max: 1, mergeTolerance: 0.08 },
  infection: { storage: 'group', min: 0, max: 1, mergeTolerance: 0.05 },
  salienceFood: { storage: 'group', min: 0.5, max: 2, mergeTolerance: 0.1 },
  salienceHealth: { storage: 'group', min: 0.5, max: 2, mergeTolerance: 0.1 },
  salienceSafety: { storage: 'group', min: 0.5, max: 2, mergeTolerance: 0.1 },
  salienceEducation: { storage: 'group', min: 0.5, max: 2, mergeTolerance: 0.1 },
  environmentalism: { storage: 'attitudes', min: 0, max: 1, mergeTolerance: 0.03 },
  civicLiberty: { storage: 'attitudes', min: 0, max: 1, mergeTolerance: 0.03 },
  traditionalism: { storage: 'attitudes', min: 0, max: 1, mergeTolerance: 0.03 },
  solidarity: { storage: 'attitudes', min: 0, max: 1, mergeTolerance: 0.03 },
} as const satisfies Record<PopulationStateField, PopulationStateFieldSpec>;

export const POPULATION_STATE_FIELD_NAMES = Object.keys(POPULATION_STATE_FIELDS) as PopulationStateField[];

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

export function writePopulationStateField(
  group: PopulationGroup,
  field: PopulationStateField,
  value: number,
): void {
  const spec: PopulationStateFieldSpec = POPULATION_STATE_FIELDS[field];
  if (spec.storage === 'attitudes') {
    group.attitudes[field as keyof PopulationGroup['attitudes']] = value;
    return;
  }
  (group as unknown as Record<string, unknown>)[field] = value;
}

export function populationStateMergeTolerance(
  field: PopulationStateField,
  group: DeepReadonly<PopulationGroup>,
): number {
  const tolerance: MergeTolerance = POPULATION_STATE_FIELDS[field].mergeTolerance;
  return typeof tolerance === 'number' ? tolerance : tolerance[group.lifeStage];
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
  writePopulationStateField(target, field, bounded(readPopulationStateField(source, field) + delta, spec));
}

export function validPopulationStateValue(
  field: PopulationStateField,
  value: unknown,
  epsilon = 0,
): boolean {
  const spec: PopulationStateFieldSpec = POPULATION_STATE_FIELDS[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (spec.min !== undefined && value < spec.min - epsilon) return false;
  if (spec.max !== undefined && value > spec.max + epsilon) return false;
  return true;
}
