import type { Model, PopulationGroup } from '../types';

const TOLERANCE = {
  childAge: 2.5,
  adultAge: 1,
  seniorAge: 2,
  education: 0.03,
  income: 0.75,
  wealth: 2,
  health: 0.03,
  wellbeing: 0.04,
  approval: 0.04,
  attitude: 0.03,
} as const;

function equivalent(a: PopulationGroup, b: PopulationGroup): boolean {
  return a.archetype === b.archetype
    && a.lifeStage === b.lifeStage
    && a.occupation === b.occupation
    && a.employed === b.employed
    && Math.abs(a.age - b.age) <= (a.lifeStage === 'child' ? TOLERANCE.childAge
      : a.lifeStage === 'senior' ? TOLERANCE.seniorAge : TOLERANCE.adultAge)
    && Math.abs(a.education - b.education) <= TOLERANCE.education
    && Math.abs(a.income - b.income) <= TOLERANCE.income
    && Math.abs(a.wealth - b.wealth) <= TOLERANCE.wealth
    && Math.abs(a.health - b.health) <= TOLERANCE.health
    && Math.abs(a.wellbeing - b.wellbeing) <= TOLERANCE.wellbeing
    && Math.abs(a.approval - b.approval) <= TOLERANCE.approval
    && Object.keys(a.attitudes).every(key =>
      Math.abs(a.attitudes[key as keyof PopulationGroup['attitudes']]
        - b.attitudes[key as keyof PopulationGroup['attitudes']]) <= TOLERANCE.attitude);
}

function combine(target: PopulationGroup, source: PopulationGroup): void {
  const count = target.count + source.count;
  const weighted = (a: number, b: number) => (a * target.count + b * source.count) / count;
  for (const field of ['age', 'education', 'income', 'wealth', 'health', 'wellbeing', 'approval'] as const) {
    target[field] = weighted(target[field], source[field]);
  }
  for (const field of Object.keys(target.attitudes) as (keyof PopulationGroup['attitudes'])[]) {
    target.attitudes[field] = weighted(target.attitudes[field], source.attitudes[field]);
  }
  target.count = count;
}

/** Keep the oldest ID as the deterministic representative of equivalent local histories. */
export function mergePopulation(model: Model): number {
  let merged = 0;
  model.populationGroups.forEach((groups, cell) => {
    if (groups.length < 2) return;
    const ordered = [...groups].sort((a, b) => a.archetype - b.archetype
      || a.lifeStage.localeCompare(b.lifeStage)
      || String(a.occupation).localeCompare(String(b.occupation))
      || Number(a.employed) - Number(b.employed)
      || a.id - b.id);
    const compact: PopulationGroup[] = [];
    const buckets = new Map<string, PopulationGroup[]>();
    for (const group of ordered) {
      const key = `${group.archetype}:${group.lifeStage}:${group.occupation}:${group.employed}`;
      const bucket = buckets.get(key) ?? [];
      const match = bucket.find(existing => equivalent(existing, group));
      if (match) {
        combine(match, group);
        merged += 1;
      } else {
        compact.push(group);
        bucket.push(group);
        buckets.set(key, bucket);
      }
    }
    model.populationGroups[cell] = compact;
  });
  return merged;
}
