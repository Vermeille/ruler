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
    && Math.abs(a.attitudes.environmentalism - b.attitudes.environmentalism) <= TOLERANCE.attitude
    && Math.abs(a.attitudes.civicLiberty - b.attitudes.civicLiberty) <= TOLERANCE.attitude
    && Math.abs(a.attitudes.traditionalism - b.attitudes.traditionalism) <= TOLERANCE.attitude
    && Math.abs(a.attitudes.solidarity - b.attitudes.solidarity) <= TOLERANCE.attitude;
}

function combine(target: PopulationGroup, source: PopulationGroup): void {
  const count = target.count + source.count;
  const weighted = (a: number, b: number) => (a * target.count + b * source.count) / count;
  target.age = weighted(target.age, source.age);
  target.education = weighted(target.education, source.education);
  target.income = weighted(target.income, source.income);
  target.wealth = weighted(target.wealth, source.wealth);
  target.health = weighted(target.health, source.health);
  target.wellbeing = weighted(target.wellbeing, source.wellbeing);
  target.approval = weighted(target.approval, source.approval);
  target.attitudes.environmentalism = weighted(target.attitudes.environmentalism, source.attitudes.environmentalism);
  target.attitudes.civicLiberty = weighted(target.attitudes.civicLiberty, source.attitudes.civicLiberty);
  target.attitudes.traditionalism = weighted(target.attitudes.traditionalism, source.attitudes.traditionalism);
  target.attitudes.solidarity = weighted(target.attitudes.solidarity, source.attitudes.solidarity);
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

/** Keep the oldest ID as the deterministic representative of equivalent local histories. */
export function mergePopulation(model: Model): number {
  let merged = 0;
  model.populationGroups.forEach((groups, cell) => {
    if (groups.length < 2) return;

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
  });
  return merged;
}
