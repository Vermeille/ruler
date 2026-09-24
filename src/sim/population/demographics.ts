import { clamp } from '../math';
import type { DeepReadonly, Effect, Evidence, PopulationGroup, Rule } from '../types';
import { archetypeAt } from './archetypes';

function naturalMortalityWeight(group: DeepReadonly<PopulationGroup>): number {
  const ageRisk = group.lifeStage === 'senior'
    ? Math.min(10, 1.6 + Math.exp((group.age - 65) / 16))
    : group.lifeStage === 'child' ? 1.2 : 0.65;
  return ageRisk * (0.55 + (1 - group.health) * 1.4);
}

function starvationMortalityWeight(
  group: DeepReadonly<PopulationGroup>,
  foodSecurity: number,
): number {
  return naturalMortalityWeight(group)
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

function allocateDeaths(
  weighted: WeightedMortality[],
  targetDeaths: number,
  weightTotal: number,
): Map<number, number> | null {
  const scale = targetDeaths / weightTotal;
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
      const actual = Math.max(0, Math.min(
        item.group.count - prior,
        remaining * item.weight / totalWeight,
      ));
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

function deathEffects(
  weighted: WeightedMortality[],
  targetDeaths: number,
  weightTotal: number,
  cell: number,
  evidence: (group: DeepReadonly<PopulationGroup>, amount: number) => Evidence | undefined,
): Effect[] {
  if (targetDeaths <= 0 || weightTotal <= 0) return [];
  const allocated = allocateDeaths(weighted, targetDeaths, weightTotal);
  const scale = targetDeaths / weightTotal;
  return weighted.flatMap(item => {
    const amount = allocated?.get(item.group.id) ?? item.weight * scale;
    if (amount <= 0) return [];
    return [{
      kind: 'population-delta' as const,
      cell,
      group: item.group.id,
      amount,
      cause: 'death' as const,
      evidence: evidence(item.group, amount),
    }];
  });
}

/** Births and ordinary mortality arise from people’s own age, health and lived state. */
export const populationDemographicsRule: Rule = {
  id: 'population.demographics',
  direction: 'people-to-people',
  phase: 'demographics',
  description: 'Reproductive adults have children; age and lived health determine ordinary mortality.',
  run({ model, random }) {
    const effects: Effect[] = [];
    for (let cellId = 0; cellId < model.populationGroups.length; cellId += 1) {
      if (model.cells[cellId].biome === 'water') continue;
      const groups = model.populationGroups[cellId];
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

        const weight = group.count * naturalMortalityWeight(group);
        weighted.push({ group, weight });
        weightTotal += weight;
      }
      if (populationMass <= 0) continue;

      const livedWellbeing = wellbeingMass / populationMass;
      const livedHealth = healthMass / populationMass;
      const birthRate = 0.00065 + livedWellbeing * 0.00055 + livedHealth * 0.0002;
      const births = model.tick % 12 === 0
        ? 12 * populationMass * birthRate * clamp(reproductiveMass / (populationMass * 0.45), 0, 1.5)
        : 0;
      if (births > 1e-12 && reproductiveMass > 0) {
        let draw = random(cellId, 'birth-parent') * reproductiveMass;
        let parent = parents[parents.length - 1].group;
        for (const candidate of parents) {
          draw -= candidate.weight;
          if (draw < 0) {
            parent = candidate.group;
            break;
          }
        }
        const archetype = inheritedArchetype(
          model.seed,
          model.archetypeModelVersion,
          parent.archetype,
          random(cellId, 'birth-variation'),
        );
        effects.push({
          kind: 'population-delta',
          cell: cellId,
          archetype,
          amount: births,
          cause: 'birth',
          state: {
            age: 0,
            lifeStage: 'child',
            occupation: null,
            employed: false,
            education: 0,
            income: 0,
            wealth: Math.max(0, parent.wealth * 0.1),
            health: parent.health,
            wellbeing: parent.wellbeing,
            approval: parent.approval,
            attitudes: { ...parent.attitudes },
          },
          evidence: births >= 1 && model.tick % 12 === 0 ? {
            title: `${model.cells[cellId].name}: a new cohort is born`,
            detail: `${births.toFixed(1)} children are born to local adults. Most inherit a parent's archetype; a small share varies.`,
            cells: [cellId],
            reads: [
              { cell: cellId, group: parent.id, field: 'age', label: 'Parent cohort age' },
              { cell: cellId, group: parent.id, field: 'health', label: 'Parent health' },
            ],
          } : undefined,
        });
      }

      const ordinaryDeaths = Math.min(
        populationMass,
        populationMass * (0.00095 + (1 - livedHealth) * 0.0005),
      );
      effects.push(...deathEffects(
        weighted,
        ordinaryDeaths,
        weightTotal,
        cellId,
        () => undefined,
      ));
    }
    return effects;
  },
};

function starvationDeaths(population: number, foodSecurity: number): number {
  const deprivation = clamp((0.7 - foodSecurity) / 0.7);
  return population * deprivation * deprivation * 0.008;
}

function currentPopulation(groups: readonly DeepReadonly<PopulationGroup>[]): number {
  return groups.reduce((sum, group) => sum + group.count, 0);
}

/** Food access is an environmental condition that removes actual people through mortality. */
export const populationStarvationRule: Rule = {
  id: 'population.starvation',
  direction: 'mapxel-to-people',
  phase: 'deprivation',
  description: 'Food insecurity creates additional mortality, weighted by age and current human health.',
  run({ model }) {
    const effects: Effect[] = [];
    for (const cell of model.cells) {
      if (cell.biome === 'water') continue;
      const groups = model.populationGroups[cell.id];
      const population = currentPopulation(groups);
      if (population <= 0) continue;

      const weighted: WeightedMortality[] = [];
      let weightTotal = 0;
      for (const group of groups) {
        const weight = group.count * starvationMortalityWeight(group, cell.foodSecurity);
        weighted.push({ group, weight });
        weightTotal += weight;
      }

      const foodDeaths = Math.min(
        population,
        starvationDeaths(population, cell.foodSecurity)
          + population * (1 - cell.foodSecurity) * 0.0008,
      );
      const severe = starvationDeaths(population, cell.foodSecurity);
      effects.push(...deathEffects(
        weighted,
        foodDeaths,
        weightTotal,
        cell.id,
        (group, amount) => severe > 1 && amount > 0.5 && model.tick % 3 === 0 ? {
          title: `${cell.name}: food deprivation causes deaths`,
          detail: `${amount.toFixed(1)} members of this cohort die; age, health and food access determine its share of local food-related mortality.`,
          cells: [cell.id],
          reads: [
            { cell: cell.id, group: group.id, field: 'health', label: 'Cohort health' },
            { cell: cell.id, field: 'foodSecurity', label: 'Food access' },
          ],
        } : undefined,
      ));
    }
    return effects;
  },
};

/** Compatibility report for UI/history; mortality itself is owned by population.starvation. */
export const starvationReportRule: Rule = {
  id: 'environment.starvation-report',
  direction: 'mapxel-to-mapxel',
  phase: 'deprivation',
  description: 'Report the current severe food-deprivation mortality component for each place.',
  run({ model }) {
    return model.cells.flatMap(cell => {
      if (cell.biome === 'water') return [];
      const population = currentPopulation(model.populationGroups[cell.id]);
      const target = starvationDeaths(population, cell.foodSecurity);
      return [{
        kind: 'delta' as const,
        cell: cell.id,
        field: 'starvationDeaths' as const,
        amount: target - cell.starvationDeaths,
      }];
    });
  },
};
