from pathlib import Path


def replace_once(path_name: str, old: str, new: str) -> None:
    path = Path(path_name)
    text = path.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'{path_name}: expected patch target not found')
    path.write_text(text.replace(old, new, 1))


replace_once(
    'src/sim/types.ts',
    """export type PopulationStateField = 'age' | 'education' | 'income' | 'wealth'\n  | 'health' | 'wellbeing' | 'approval'\n  | 'environmentalism' | 'civicLiberty' | 'traditionalism' | 'solidarity';\n""",
    """type NumericPopulationGroupField = {\n  [K in keyof PopulationGroup]: PopulationGroup[K] extends number ? K : never\n}[keyof PopulationGroup];\n\nexport type PopulationStateField =\n  | Exclude<NumericPopulationGroupField, 'id' | 'archetype' | 'count'>\n  | keyof PopulationGroup['attitudes'];\n\ntype PrimitivePopulationTransitionField = {\n  [K in keyof PopulationGroup]: PopulationGroup[K] extends string | boolean | null ? K : never\n}[keyof PopulationGroup];\n\nexport type PopulationTransitionField = PrimitivePopulationTransitionField;\n""",
)
replace_once(
    'src/sim/types.ts',
    "transition: Partial<Pick<PopulationGroup, 'lifeStage' | 'occupation' | 'employed'>>;",
    "transition: Partial<Pick<PopulationGroup, PopulationTransitionField>>;",
)

fields = Path('src/sim/population/fields.ts')
fields.write_text("""import { clamp } from '../math';
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

export function validPopulationStateValue(field: PopulationStateField, value: unknown): boolean {
  const spec = POPULATION_STATE_FIELDS[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (spec.min !== undefined && value < spec.min) return false;
  if (spec.max !== undefined && value > spec.max) return false;
  return true;
}
""")

path = Path('src/sim/population/settlement.ts')
text = path.read_text()
text = text.replace("import { clamp } from '../math';\n", '')
anchor = "import { ARCHETYPE_COUNT } from './archetypes';\n"
registry_import = """import {
  applyPopulationStateDelta,
  POPULATION_STATE_FIELDS,
  POPULATION_TRANSITION_FIELDS,
  populationStateFieldSpec,
  populationTransitionFieldSpec,
  validPopulationStateValue,
} from './fields';
"""
if registry_import not in text:
    if anchor not in text:
        raise SystemExit('settlement import anchor changed')
    text = text.replace(anchor, anchor + registry_import, 1)

old_validation = """  } else if (effect.kind === 'population-transition' && strictShape) {
    let count = 0;
    for (const key in effect.transition) {
      count += 1;
      const value = effect.transition[key as keyof typeof effect.transition];
      if (!['lifeStage', 'occupation', 'employed'].includes(key)
        || (key === 'lifeStage' && !['child', 'adult', 'senior'].includes(String(value)))
        || (key === 'occupation' && ![null, 'agriculture', 'manufacturing', 'services', 'sports'].includes(value as string | null))
        || (key === 'employed' && typeof value !== 'boolean')) {
        throw new Error('Invalid population transition.');
      }
    }
    if (count === 0) throw new Error('Invalid population transition.');
  } else if (effect.kind === 'population-state' && strictShape) {
    let count = 0;
    for (const key in effect.change) {
      count += 1;
      const value = effect.change[key as keyof typeof effect.change];
      if (!['age', 'education', 'income', 'wealth', 'health', 'wellbeing', 'approval',
        'environmentalism', 'civicLiberty', 'traditionalism', 'solidarity'].includes(key)
        || !Number.isFinite(value)) {
        throw new Error('Invalid population state change.');
      }
    }
    if (count === 0) throw new Error('Invalid population state change.');
"""
new_validation = """  } else if (effect.kind === 'population-transition' && strictShape) {
    let count = 0;
    for (const key in effect.transition) {
      count += 1;
      const spec = populationTransitionFieldSpec(key);
      const value = effect.transition[key as keyof typeof effect.transition];
      if (!spec || !spec.valid(value)) throw new Error('Invalid population transition.');
    }
    if (count === 0) throw new Error('Invalid population transition.');
  } else if (effect.kind === 'population-state' && strictShape) {
    let count = 0;
    for (const key in effect.change) {
      count += 1;
      const spec = populationStateFieldSpec(key);
      const value = effect.change[key as keyof typeof effect.change];
      if (!spec || typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('Invalid population state change.');
      }
    }
    if (count === 0) throw new Error('Invalid population state change.');
"""
if old_validation not in text:
    raise SystemExit('settlement validation block changed')
text = text.replace(old_validation, new_validation, 1)

old_group_validation = """function validateGroupState(group: Omit<PopulationGroup, 'id' | 'archetype' | 'count'>): void {
  if (!group || !group.attitudes) throw new Error('Invalid initial population state.');
  const numbers = [group.age, group.education, group.income, group.wealth, group.health, group.wellbeing,
    group.approval, ...Object.values(group.attitudes)];
  if (numbers.some(value => !Number.isFinite(value) || value < 0)
    || [group.education, group.health, group.wellbeing, group.approval,
      ...Object.values(group.attitudes)].some(value => value > 1)
    || !['child', 'adult', 'senior'].includes(group.lifeStage)
    || (group.occupation !== null && !['agriculture', 'manufacturing', 'services', 'sports'].includes(group.occupation))
    || typeof group.employed !== 'boolean') throw new Error('Invalid initial population state.');
}
"""
new_group_validation = """function validateGroupState(group: Omit<PopulationGroup, 'id' | 'archetype' | 'count'>): void {
  if (!group || !group.attitudes) throw new Error('Invalid initial population state.');
  const raw = group as unknown as Record<string, unknown>;
  const attitudes = group.attitudes as unknown as Record<string, unknown>;
  for (const [field, spec] of Object.entries(POPULATION_STATE_FIELDS)) {
    const value = spec.storage === 'attitudes' ? attitudes[field] : raw[field];
    if (!validPopulationStateValue(field as keyof typeof POPULATION_STATE_FIELDS, value)) {
      throw new Error('Invalid initial population state.');
    }
  }
  for (const [field, spec] of Object.entries(POPULATION_TRANSITION_FIELDS)) {
    if (!spec.valid(raw[field])) throw new Error('Invalid initial population state.');
  }
}
"""
if old_group_validation not in text:
    raise SystemExit('validateGroupState block changed')
text = text.replace(old_group_validation, new_group_validation, 1)

old_apply = """  for (const field in effect.change) {
    const delta = effect.change[field as keyof typeof effect.change];
    if (delta === undefined) continue;
    if (field === 'environmentalism' || field === 'civicLiberty'
      || field === 'traditionalism' || field === 'solidarity') {
      const key = field as keyof PopulationGroup['attitudes'];
      target.attitudes[key] = clamp(source.attitudes[key] + delta);
      continue;
    }
    const key = field as keyof Pick<PopulationGroup, 'age' | 'education' | 'income' | 'wealth' | 'health' | 'wellbeing' | 'approval'>;
    const value = source[key] + delta;
    const bounded = field === 'education' || field === 'health' || field === 'wellbeing' || field === 'approval';
    target[key] = bounded ? clamp(value) : Math.max(0, value);
  }
"""
new_apply = """  for (const field in effect.change) {
    const delta = effect.change[field as keyof typeof effect.change];
    if (delta === undefined) continue;
    applyPopulationStateDelta(target, source, field as keyof typeof POPULATION_STATE_FIELDS, delta);
  }
"""
if old_apply not in text:
    raise SystemExit('applyGroupChange block changed')
text = text.replace(old_apply, new_apply, 1)
path.write_text(text)
