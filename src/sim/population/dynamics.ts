import { clamp } from '../math';
import { resolveStepCache } from '../step-cache';
import type { Effect, Rule } from '../types';
import { archetypeAt } from './archetypes';

function regionalLag(
  nationalAverageWellbeing: number,
  regionAverageWellbeing: readonly number[],
  region: number,
): number {
  return Math.max(0, nationalAverageWellbeing - regionAverageWellbeing[region]);
}

/** People notice when their region or their own group falls behind an otherwise better-off country. */
// [I] REGIONAL-DIVERGENCE1
// [I] DISTRIBUTIONAL-REACTION1
export const populationComparisonRule: Rule = {
  id: 'population.relative-comparison',
  direction: 'mapxel-to-people',
  phase: 'experience',
  description: 'Relative regional and within-region disadvantage modestly depress approval and outlook even when absolute conditions remain tolerable.',
  run({ model, cache }) {
    const peopleCache = resolveStepCache(model, cache);
    const effects: Effect[] = [];
    for (const cell of model.cells) {
      if (cell.biome === 'water') continue;
      const local = peopleCache.peopleByCell[cell.id];
      const regionAverage = peopleCache.regionAverageWellbeing[cell.region];
      const lag = regionalLag(
        peopleCache.nationalAverageWellbeing,
        peopleCache.regionAverageWellbeing,
        cell.region,
      );
      for (const group of model.populationGroups[cell.id]) {
        const distributionGap = Math.max(0, regionAverage - group.wellbeing);
        const localGap = Math.max(0, local.averageWellbeing - group.wellbeing);
        const comparisonPressure = lag * 0.7 + distributionGap * 0.45 + localGap * 0.2;
        if (comparisonPressure <= 1e-9) continue;
        effects.push({
          kind: 'population-state',
          cell: cell.id,
          group: group.id,
          amount: group.count,
          change: {
            approval: -comparisonPressure * 0.018,
            outlook: -comparisonPressure * 0.03,
          },
          evidence: group.count > 5 && comparisonPressure > 0.08 && model.tick % 3 === 0 ? {
            title: `${cell.name}: residents compare their trajectory with the country around them`,
            detail: 'Relative regional and within-region disadvantage add political grievance even though absolute lived conditions still matter independently.',
            cells: [cell.id],
            reads: [
              { cell: cell.id, group: group.id, field: 'wellbeing', label: 'Group wellbeing' },
            ],
          } : undefined,
        });
      }
    }
    return effects;
  },
};

/** Abrupt policy changes create temporary adjustment stress rather than magical material damage. */
// [I] POLICY-SHOCK1
export const populationPolicyAdjustmentRule: Rule = {
  id: 'population.policy-adjustment',
  direction: 'mapxel-to-people',
  phase: 'experience',
  description: 'People experience abrupt policy changes as temporary uncertainty, with adaptable and risk-tolerant archetypes reacting less strongly.',
  run({ model }) {
    const effects: Effect[] = [];
    for (const cell of model.cells) {
      if (cell.biome === 'water' || cell.policyAdjustment <= 1e-9) continue;
      for (const group of model.populationGroups[cell.id]) {
        const archetype = archetypeAt(model.seed, group.archetype, model.archetypeModelVersion);
        const sensitivity = clamp(
          1.15 - archetype.traits.adaptability * 0.5 - archetype.traits.riskTolerance * 0.25,
          0.35,
          1.1,
        );
        const stress = cell.policyAdjustment * sensitivity;
        effects.push({
          kind: 'population-state',
          cell: cell.id,
          group: group.id,
          amount: group.count,
          change: {
            outlook: -stress * 0.055,
            approval: -stress * 0.022,
          },
          evidence: group.count > 5 && stress > 0.12 ? {
            title: `${cell.name}: people adjust to a sharp policy change`,
            detail: 'The policy regime changed faster than this group usually adapts. Material effects still come from the underlying tax, spending, wage, law, or subsidy rules.',
            cells: [cell.id],
            reads: [
              { cell: cell.id, field: 'policyAdjustment', label: 'Policy adjustment pressure' },
            ],
          } : undefined,
        });
      }
    }
    return effects;
  },
};

/** Recent local problems temporarily change which existing needs dominate attention. */
// [I] PUBLIC-SALIENCE1
export const populationSalienceRule: Rule = {
  id: 'population.public-salience',
  direction: 'mapxel-to-people',
  phase: 'behavior',
  description: 'Food shortages, health pressure, crime, and education failures temporarily raise attention to the corresponding existing need.',
  run({ model }) {
    const effects: Effect[] = [];
    for (const cell of model.cells) {
      if (cell.biome === 'water') continue;
      for (const group of model.populationGroups[cell.id]) {
        const foodTarget = clamp(1 + (1 - cell.foodSecurity) * 0.9, 0.5, 2);
        const healthTarget = clamp(
          1 + (1 - cell.health) * 0.45 + cell.healthDisruption * 0.6 + group.infection * 0.8,
          0.5,
          2,
        );
        const safetyTarget = clamp(1 + cell.crime * 0.75, 0.5, 2);
        const educationTarget = clamp(
          1 + (1 - cell.education) * 0.35 + cell.educationDisruption * 0.65,
          0.5,
          2,
        );
        effects.push({
          kind: 'population-state',
          cell: cell.id,
          group: group.id,
          amount: group.count,
          change: {
            salienceFood: (foodTarget - group.salienceFood) * 0.12,
            salienceHealth: (healthTarget - group.salienceHealth) * 0.12,
            salienceSafety: (safetyTarget - group.salienceSafety) * 0.12,
            salienceEducation: (educationTarget - group.salienceEducation) * 0.12,
          },
        });
      }
    }
    return effects;
  },
};

/** Grievances can mobilize collectively and diffuse through neighboring communities. */
// [I] UNREST-MOBILIZATION1
// [I] REGIONAL-DIVERGENCE1
// [I] DISTRIBUTIONAL-REACTION1
export const populationMobilizationRule: Rule = {
  id: 'population.mobilization',
  direction: 'people-to-people',
  phase: 'behavior',
  description: 'Low approval, hardship, pessimism, relative disadvantage, civic-liberty conflict, and nearby mobilization build latent collective action.',
  run({ model, cache }) {
    const peopleCache = resolveStepCache(model, cache);
    const effects: Effect[] = [];
    for (const cell of model.cells) {
      if (cell.biome === 'water') continue;
      const neighbors = model.neighbors[cell.id].filter(id => model.cells[id].biome !== 'water');
      const nearbyMobilization = neighbors.length
        ? neighbors.reduce(
            (sum, id) => sum + peopleCache.peopleByCell[id].averageMobilization,
            0,
          ) / neighbors.length
        : 0;
      const lag = regionalLag(
        peopleCache.nationalAverageWellbeing,
        peopleCache.regionAverageWellbeing,
        cell.region,
      );
      const regionAverage = peopleCache.regionAverageWellbeing[cell.region];
      for (const group of model.populationGroups[cell.id]) {
        const distributionGap = Math.max(0, regionAverage - group.wellbeing);
        const civicPressure = model.policy.laws.publicAssembly
          ? 0
          : group.attitudes.civicLiberty * 0.16;
        const grievance = Math.max(0, 0.58 - group.approval) * 1.15
          + Math.max(0, 0.58 - group.wellbeing) * 0.65
          + Math.max(0, -group.outlook) * 0.38
          + lag * 0.55
          + distributionGap * 0.3
          + nearbyMobilization * 0.24
          + civicPressure;
        const target = clamp((grievance - 0.11) * 0.82);
        const rate = target > group.mobilization ? 0.1 : 0.14;
        effects.push({
          kind: 'population-state',
          cell: cell.id,
          group: group.id,
          amount: group.count,
          change: { mobilization: (target - group.mobilization) * rate },
          evidence: group.count > 5 && target > 0.28 && model.tick % 3 === 0 ? {
            title: `${cell.name}: political mobilization builds`,
            detail: 'Low approval, hardship, pessimism, relative disadvantage, civic-liberty conflict, and mobilized neighbors combine into collective action pressure.',
            cells: [cell.id],
            reads: [
              { cell: cell.id, group: group.id, field: 'approval', label: 'Group approval' },
              { cell: cell.id, group: group.id, field: 'outlook', label: 'Group outlook' },
            ],
          } : undefined,
        });
      }
    }
    return effects;
  },
};

/** Background infection propagates through co-location and neighboring populations and travels with people. */
// [I] EPIDEMIC-SPREAD1
export const populationInfectionRule: Rule = {
  id: 'population.infection',
  direction: 'people-to-people',
  phase: 'behavior',
  description: 'Infection spreads from local and neighboring people, worsens under density and health-system strain, and recovers faster where health access is strong.',
  run({ model, cache }) {
    const peopleCache = resolveStepCache(model, cache);
    const effects: Effect[] = [];
    for (const cell of model.cells) {
      if (cell.biome === 'water') continue;
      const people = peopleCache.peopleByCell[cell.id];
      const neighbors = model.neighbors[cell.id].filter(id => model.cells[id].biome !== 'water');
      const neighborPrevalence = neighbors.length
        ? neighbors.reduce(
            (sum, id) => sum + peopleCache.peopleByCell[id].averageInfection,
            0,
          ) / neighbors.length
        : people.averageInfection;
      const prevalence = people.averageInfection * 0.76 + neighborPrevalence * 0.24;
      const density = clamp(people.population / 1200);
      const systemPressure = 1 + cell.healthDisruption * 0.8;
      const transmission = prevalence
        * (0.5 + density * 0.65)
        * (1.05 - cell.health * 0.4)
        * systemPressure;
      for (const group of model.populationGroups[cell.id]) {
        const newInfection = (1 - group.infection) * transmission * 0.16;
        const recovery = group.infection * (0.055 + cell.health * 0.14);
        const infectionChange = newInfection - recovery;
        const healthChange = -group.infection * 0.006 - newInfection * 0.012 + recovery * 0.002;
        effects.push({
          kind: 'population-state',
          cell: cell.id,
          group: group.id,
          amount: group.count,
          change: {
            infection: infectionChange,
            health: healthChange,
          },
          evidence: group.count > 5 && infectionChange > 0.01 && model.tick % 2 === 0 ? {
            title: `${cell.name}: infection is spreading`,
            detail: 'Local and neighboring prevalence, density, health access, and health-system disruption determine transmission; infected groups carry their infection state when they migrate.',
            cells: [cell.id],
            reads: [
              { cell: cell.id, group: group.id, field: 'infection', label: 'Group infection load' },
              { cell: cell.id, field: 'health', label: 'Local health access' },
            ],
          } : undefined,
        });
      }
    }
    return effects;
  },
};
