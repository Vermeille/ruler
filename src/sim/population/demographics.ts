import { clamp } from '../math';
import { SECTORS, type DeepReadonly, type Effect, type PopulationGroup, type Rule } from '../types';
import { archetypeAt } from './archetypes';

/** Life stages change only after the monthly age increment has settled. */
export const populationAgingRule: Rule = {
  id: 'population.aging',
  phase: 'aging',
  description: 'Children enter the working-age population at 18; adults retire at 65.',
  run({ model }) {
    const effects: Effect[] = [];
    model.populationGroups.forEach((groups, cell) => {
      for (const group of groups) {
        if (group.lifeStage === 'child' && group.age >= 18) {
          const archetype = archetypeAt(model.seed, group.archetype, model.archetypeModelVersion);
          const occupation = SECTORS.reduce((best, sector) =>
            model.cells[cell][sector] * archetype.affinities[sector]
              > model.cells[cell][best] * archetype.affinities[best] ? sector : best, SECTORS[0]);
          effects.push({ kind: 'population-transition', cell, group: group.id, amount: group.count,
            transition: { lifeStage: 'adult', occupation, employed: false } });
        } else if (group.lifeStage === 'adult' && group.age >= 65) {
          effects.push({ kind: 'population-transition', cell, group: group.id, amount: group.count,
            transition: { lifeStage: 'senior', occupation: null, employed: false } });
        }
      }
    });
    return effects;
  },
};

function mortalityWeight(group: DeepReadonly<PopulationGroup>, foodSecurity: number): number {
  const ageRisk = group.lifeStage === 'senior'
    ? Math.min(10, 1.6 + Math.exp((group.age - 65) / 16))
    : group.lifeStage === 'child' ? 1.2 : 0.65;
  return ageRisk * (0.55 + (1 - group.health) * 1.4)
    * (1 + (1 - foodSecurity) * (group.lifeStage === 'child' ? 1.4 : 0.7));
}

function inheritedArchetype(
  seed: string, version: number, parent: number, variation: number,
): number {
  if (variation >= 0.12) return parent;
  const baseline = archetypeAt(seed, parent, version);
  const candidates = [1, 2, 4, 8].map(bit => parent ^ bit);
  return candidates.map(id => {
    const candidate = archetypeAt(seed, id, version);
    const distance = Object.keys(baseline.traits).reduce((sum, key) => {
      const trait = key as keyof typeof baseline.traits;
      return sum + (baseline.traits[trait] - candidate.traits[trait]) ** 2;
    }, 0);
    return { id, distance };
  }).sort((a, b) => a.distance - b.distance || a.id - b.id)[0].id;
}

type WeightedMortality = { group: DeepReadonly<PopulationGroup>; weight: number };
type WeightedParent = { group: DeepReadonly<PopulationGroup>; weight: number };

function allocateDeaths(weighted: WeightedMortality[], targetDeaths: number, weightTotal: number): Map<number, number> | null {
  const scale = targetDeaths / weightTotal;
  // Ordinary monthly mortality is tiny compared with every source cohort. In that common
  // case proportional allocation is already the exact answer, so avoid constructing the
  // redistribution maps/arrays needed only when a severe shock actually exhausts a group.
  if (weighted.every(item => item.weight * scale <= item.group.count + 1e-12)) return null;

  let remaining = targetDeaths;
  let eligible = weighted;
  const allocated = new Map<number, number>();
  while (remaining > 1e-9 && eligible.length > 0) {
    const totalWeight = eligible.reduce((sum, item) => sum + item.weight, 0);
    let removed = 0;
    const next: WeightedMortality[] = [];
    for (const item of eligible) {
      const prior = allocated.get(item.group.id) ?? 0;
      const actual = Math.max(0, Math.min(item.group.count - prior,
        remaining * item.weight / totalWeight));
      allocated.set(item.group.id, prior + actual);
      removed += actual;
      if (item.group.count - prior - actual > 1e-9) next.push(item);
    }
    if (removed <= 1e-9) break;
    remaining -= removed;
    eligible = next;
  }
  return allocated;
}

/** Explicit group sources and sinks replace the former aggregate population delta. */
export const populationDemographicsRule: Rule = {
  id: 'population.demographics',
  phase: 'demographics',
  description: 'Reproductive adults have children; actual group wellbeing, health, age, and food access determine demographic pressure.',
  run({ model, random }) {
    const effects: Effect[] = [];
    for (const cell of model.cells) {
      if (cell.biome === 'water' || cell.population <= 0) continue;
      const groups = model.populationGroups[cell.id];
      const parents: WeightedParent[] = [];
      const weighted: WeightedMortality[] = [];
      let populationMass = 0;
      let wellbeingMass = 0;
      let healthMass = 0;
      let reproductiveMass = 0;
      let weightTotal = 0;

      for (const group of groups) {
        populationMass += group.count;
        wellbeingMass += group.count * group.wellbeing;
        healthMass += group.count * group.health;

        if (group.lifeStage === 'adult' && group.age < 50) {
          const familyOrientation = archetypeAt(
            model.seed, group.archetype, model.archetypeModelVersion,
          ).traits.familyOrientation;
          const weight = group.count * (0.7 + familyOrientation * 0.6);
          parents.push({ group, weight });
          reproductiveMass += weight;
        }

        const weight = group.count * mortalityWeight(group, cell.foodSecurity);
        weighted.push({ group, weight });
        weightTotal += weight;
      }

      const livedWellbeing = populationMass > 0 ? wellbeingMass / populationMass : 0;
      const livedHealth = populationMass > 0 ? healthMass / populationMass : 0;
      const birthRate = 0.00065 + livedWellbeing * 0.00055 + livedHealth * 0.0002;
      // Batch fractional births into yearly cohorts so a mapxel does not
      // accumulate dozens of tiny, distinct newborn groups each year.
      const births = model.tick % 12 === 0
        ? 12 * cell.population * birthRate * clamp(reproductiveMass / (cell.population * 0.45), 0, 1.5)
        : 0;
      if (births > 1e-12 && reproductiveMass > 0) {
        let draw = random(cell.id, 'birth-parent') * reproductiveMass;
        let parent = parents[parents.length - 1].group;
        for (const candidate of parents) {
          draw -= candidate.weight;
          if (draw < 0) {
            parent = candidate.group;
            break;
          }
        }
        const archetype = inheritedArchetype(model.seed, model.archetypeModelVersion,
          parent.archetype, random(cell.id, 'birth-variation'));
        effects.push({ kind: 'population-delta', cell: cell.id, archetype, amount: births, cause: 'birth',
          state: {
            age: 0, lifeStage: 'child', occupation: null, employed: false,
            education: 0, income: 0, wealth: Math.max(0, parent.wealth * 0.1),
            health: clamp((parent.health + cell.health) / 2),
            wellbeing: parent.wellbeing, approval: parent.approval,
            attitudes: { ...parent.attitudes },
          },
          evidence: births >= 1 && model.tick % 12 === 0 ? {
            title: `${cell.name}: a new cohort is born`,
            detail: `${births.toFixed(1)} children are born to local adults. Most inherit a parent's archetype; a small share varies.`,
            cells: [cell.id],
            reads: [{ cell: cell.id, group: parent.id, field: 'age', label: 'Parent cohort age' },
              { cell: cell.id, group: parent.id, field: 'health', label: 'Parent health' }],
          } : undefined,
        });
      }

      const deathRate = 0.00095 + (1 - livedHealth) * 0.0005 + (1 - cell.foodSecurity) * 0.0008;
      const targetDeaths = Math.min(cell.population,
        cell.population * deathRate + cell.starvationDeaths);
      if (targetDeaths <= 0 || weightTotal <= 0) continue;
      const allocated = allocateDeaths(weighted, targetDeaths, weightTotal);
      const scale = targetDeaths / weightTotal;
      for (const item of weighted) {
        const amount = allocated?.get(item.group.id) ?? item.weight * scale;
        if (amount <= 0) continue;
        effects.push({ kind: 'population-delta', cell: cell.id, group: item.group.id, amount, cause: 'death',
          evidence: cell.starvationDeaths > 1 && amount > 0.5 && model.tick % 3 === 0 ? {
            title: `${cell.name}: food deprivation causes deaths`,
            detail: `${amount.toFixed(1)} members of this cohort die; age, health and food access determine its share of local mortality.`,
            cells: [cell.id],
            reads: [{ cell: cell.id, group: item.group.id, field: 'health', label: 'Cohort health' },
              { cell: cell.id, field: 'foodSecurity', label: 'Food access' }],
          } : undefined,
        });
      }
    }
    return effects;
  },
};
