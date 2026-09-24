import {
  POPULATION_STATE_FIELD_NAMES,
  populationStateMergeTolerance,
  readPopulationStateField,
  writePopulationStateField,
} from './fields';
import type { Model, PopulationGroup } from '../types';

function equivalent(a: PopulationGroup, b: PopulationGroup): boolean {
  return a.archetype === b.archetype
    && a.lifeStage === b.lifeStage
    && a.occupation === b.occupation
    && a.employed === b.employed
    && POPULATION_STATE_FIELD_NAMES.every(field =>
      Math.abs(readPopulationStateField(a, field) - readPopulationStateField(b, field))
        <= populationStateMergeTolerance(field, a));
}

function combine(target: PopulationGroup, source: PopulationGroup): void {
  const count = target.count + source.count;
  const weighted = (a: number, b: number) => (a * target.count + b * source.count) / count;
  for (const field of POPULATION_STATE_FIELD_NAMES) {
    writePopulationStateField(
      target,
      field,
      weighted(readPopulationStateField(target, field), readPopulationStateField(source, field)),
    );
  }
  target.count = count;
}

type Bucket = {
  archetype: number;
  lifeStage: PopulationGroup['lifeStage'];
  occupation: PopulationGroup['occupation'];
  employed: boolean;
  groups: PopulationGroup[];
};

function compareBuckets(a: Bucket, b: Bucket): number {
  return a.archetype - b.archetype
    || a.lifeStage.localeCompare(b.lifeStage)
    || String(a.occupation).localeCompare(String(b.occupation))
    || Number(a.employed) - Number(b.employed);
}

function compactCell(model: Model, cell: number): number {
  const groups = model.populationGroups[cell];
  if (!groups || groups.length < 2) return 0;

  const byStructure = new Map<string, Bucket>();
  for (const group of groups) {
    const key = `${group.archetype}:${group.lifeStage}:${group.occupation}:${group.employed}`;
    let bucket = byStructure.get(key);
    if (!bucket) {
      bucket = {
        archetype: group.archetype,
        lifeStage: group.lifeStage,
        occupation: group.occupation,
        employed: group.employed,
        groups: [],
      };
      byStructure.set(key, bucket);
    }
    bucket.groups.push(group);
  }

  let merged = 0;
  const compact: PopulationGroup[] = [];
  const orderedBuckets = [...byStructure.values()].sort(compareBuckets);
  for (const bucket of orderedBuckets) {
    bucket.groups.sort((a, b) => a.id - b.id);
    const representatives: PopulationGroup[] = [];
    for (const group of bucket.groups) {
      const match = representatives.find(existing => equivalent(existing, group));
      if (match) {
        combine(match, group);
        merged += 1;
      } else {
        representatives.push(group);
        compact.push(group);
      }
    }
  }
  model.populationGroups[cell] = compact;
  return merged;
}

/** Keep the oldest ID as the deterministic representative of equivalent local histories. */
export function mergePopulation(model: Model, cells?: Iterable<number>): number {
  let merged = 0;
  if (cells) {
    const ordered = [...new Set(cells)].sort((a, b) => a - b);
    for (const cell of ordered) merged += compactCell(model, cell);
    return merged;
  }
  for (let cell = 0; cell < model.populationGroups.length; cell += 1) {
    merged += compactCell(model, cell);
  }
  return merged;
}
