import { clamp } from '../math';
import { resolveStepCache } from '../step-cache';
import type {
  Archetype,
  DeepReadonly,
  Evidence,
  Mapxel,
  Model,
  PopulationGroup,
  Rule,
  StepCache,
} from '../types';
import { isLand } from '../rules/helpers';
import { archetypeAt } from './archetypes';
import { viabilityOf } from './employment';
import { quantizeCohortFlow } from './resolution';

type MigrationRandom = (cell: number, channel?: string) => number;

type PlannedMigration = {
  from: number;
  to: number;
  group: number;
  amount: number;
  evidence?: Evidence;
};

function migrationAppeal(
  group: DeepReadonly<PopulationGroup>,
  archetype: Archetype,
  cell: DeepReadonly<Mapxel>,
  population: number,
  communityMood: number,
  jobChance: number,
  culture: number,
  atHome: boolean,
): number {
  const wealthBuffer = clamp(group.wealth / 35);
  const employment = atHome ? (group.employed ? 1 : 0.2) : 0.2 + jobChance * 0.8;
  const expectedIncome = atHome
    ? group.income
    : cell.output / Math.max(1, population) * (0.8 + group.education * 0.3) * jobChance;
  const purchasingPower = clamp(
    (expectedIncome + Math.min(group.wealth, 30) * 0.08) / (6 * cell.price),
  );
  const food = clamp(
    cell.foodSecurity
      + wealthBuffer * 0.08
      - Math.max(0, cell.price - 1) * (1 - wealthBuffer) * 0.12,
  );
  const health = atHome ? group.health : cell.health;
  const needs = archetype.needs;
  const foodWeight = needs.food * group.salienceFood;
  const healthWeight = needs.health * group.salienceHealth;
  const safetyWeight = needs.safety * group.salienceSafety;
  const educationWeight = needs.education * group.salienceEducation;
  const weight = foodWeight
    + needs.income
    + needs.employment
    + healthWeight
    + safetyWeight
    + needs.housing
    + educationWeight
    + needs.environment
    + needs.culture;
  const lived = (
    foodWeight * food
    + needs.income * purchasingPower
    + needs.employment * employment
    + healthWeight * health
    + safetyWeight * (1 - cell.crime)
    + needs.housing * clamp(1 - population / 20_000)
    + educationWeight * cell.education
    + needs.environment * (1 - cell.pollution)
    + needs.culture * culture
  ) / weight;

  return lived + communityMood * 0.25;
}

function displacementPressure(cell: DeepReadonly<Mapxel>): number {
  return clamp(Math.max(
    (1 - cell.foodSecurity) * 1.15,
    cell.waterStress * 0.9,
    Math.max(0, cell.crime - 0.22) * 1.35,
    cell.healthDisruption * 0.95,
    cell.educationDisruption * 0.45,
    cell.infrastructureDisruption * 0.75,
    Math.max(0, 0.48 - cell.health) * 1.4,
  ));
}

function planMigration(
  model: DeepReadonly<Model>,
  cache: DeepReadonly<StepCache>,
  random: MigrationRandom,
): PlannedMigration[] {
  const ordinaryMigrationMonth = model.tick % 3 === 0;
  const planned: PlannedMigration[] = [];
  const culture = clamp(0.5 + model.policy.spending.culture * model.budget.funding);
  const viability = model.cells.map(cell => (
    cell.biome === 'water'
      ? undefined
      : viabilityOf(cell, model, cache.peopleByCell[cell.id].averageHealth)
  ));

  for (const from of model.cells) {
    if (!isLand(from)) continue;
    const crisis = displacementPressure(from);
    if (!ordinaryMigrationMonth && crisis < 0.25) continue;
    const originPeople = cache.peopleByCell[from.id];
    const originViability = viability[from.id]!;

    for (const group of model.populationGroups[from.id]) {
      if (group.lifeStage !== 'adult' || group.count <= 0) continue;

      const archetype = archetypeAt(model.seed, group.archetype, model.archetypeModelVersion);
      const originJobChance = group.occupation ? originViability[group.occupation] : 0.5;
      const originAppeal = migrationAppeal(
        group,
        archetype,
        from,
        originPeople.population,
        group.wellbeing,
        originJobChance,
        culture,
        true,
      );
      let bestCell: DeepReadonly<Mapxel> | undefined;
      let bestAdvantage = -Infinity;

      for (const neighborId of model.neighbors[from.id]) {
        const to = model.cells[neighborId];
        if (to.biome === 'water') continue;
        const destinationPeople = cache.peopleByCell[to.id];
        const jobChance = group.occupation ? viability[to.id]![group.occupation] : 0.5;
        const relief = Math.max(0, crisis - displacementPressure(to));
        const advantage = migrationAppeal(
          group,
          archetype,
          to,
          destinationPeople.population,
          destinationPeople.averageWellbeing,
          jobChance,
          culture,
          false,
        ) - originAppeal + relief * 0.32;
        if (
          advantage > bestAdvantage
          || (advantage === bestAdvantage && bestCell && to.id < bestCell.id)
        ) {
          bestCell = to;
          bestAdvantage = advantage;
        }
      }
      if (!bestCell || bestAdvantage <= 0) continue;

      const ordinaryMeans = clamp(group.wealth / 10, 0.2, 1);
      const displacementMeans = Math.max(ordinaryMeans, crisis * 0.78);
      const means = crisis >= 0.25 ? displacementMeans : ordinaryMeans;
      const hardship = 1
        + (1 - group.wellbeing) * 0.4
        + (group.employed ? 0 : 0.25)
        + Math.max(0, -group.outlook) * 0.4;
      const propensity = (0.2 + archetype.traits.mobility)
        * (1 - archetype.traits.communityAttachment * 0.75)
        * means
        * hardship;
      const freedomMultiplier = model.policy.laws.freeMovement
        ? 1
        : crisis >= 0.45 ? 0.22 : 0.08;
      const ordinaryRate = ordinaryMigrationMonth
        ? Math.min(0.009, bestAdvantage * 0.021 * propensity)
        : 0;
      const displacementRate = crisis >= 0.25
        ? Math.min(0.055, Math.max(0, crisis - 0.2) * 0.065 * (0.55 + propensity * 0.45))
        : 0;
      const rate = Math.max(ordinaryRate, displacementRate) * freedomMultiplier;
      const desiredAmount = group.count * rate;
      if (desiredAmount <= 1e-9) continue;

      const amount = quantizeCohortFlow(
        desiredAmount,
        group.count,
        random(from.id, `migration-cohort:${group.id}:${bestCell.id}`),
      );
      if (amount <= 1e-9) continue;

      planned.push({
        from: from.id,
        to: bestCell.id,
        group: group.id,
        amount,
        evidence: amount >= 0.5
          ? {
              title: crisis >= 0.25
                ? `${from.name}: hardship displaces archetype #${group.archetype} toward ${bestCell.name}`
                : `${from.name}: archetype #${group.archetype} moves toward ${bestCell.name}`,
              detail: crisis >= 0.25
                ? `${amount.toFixed(1)} people leave under severe local pressure. Food, water, safety, service failures, outlook, means, mobility, community attachment, and destination relief all shape the flow.`
                : `${amount.toFixed(1)} people move because this group values the destination more under its own needs and circumstances. Employment status, income, reserves, outlook, mobility, community attachment, prices, services, safety, and environment all contribute.`,
              cells: [from.id, bestCell.id],
              reads: [
                { cell: from.id, group: group.id, field: 'wealth', label: 'Group reserves' },
                { cell: from.id, group: group.id, field: 'wellbeing', label: 'Group wellbeing' },
                { cell: from.id, group: group.id, field: 'outlook', label: 'Group outlook' },
                { cell: from.id, group: group.id, field: 'employed', label: 'Current employment' },
                { cell: bestCell.id, field: 'price', label: 'Destination prices' },
                { cell: bestCell.id, field: 'foodSecurity', label: 'Destination food access' },
              ],
              parents: ['policy:law:freeMovement'],
            }
          : undefined,
      });
    }
  }

  return planned;
}

// [I] MIGRATION-NEEDS1
// [I] MIGRATION-MOOD1
// [I] MIGRATION-LOCAL1
// [I] MIGRATION-MEANS1
// [I] MIGRATION-ROOTS1
// [I] MIGRATION-FREEDOM1
// [I] CRISIS-DISPLACEMENT1
// [I] EXPECTATIONS1
// [I] PUBLIC-SALIENCE1
export const migrationRule: Rule = {
  id: 'population.migration',
  direction: 'mapxel-to-people',
  randomNamespace: 'population.migration',
  phase: 'migration',
  description: 'Adults normally evaluate nearby places quarterly; severe local crises can create faster displacement toward safer neighboring conditions.',
  run({ model, cache, random }) {
    const peopleCache = resolveStepCache(model, cache);
    return planMigration(model, peopleCache, random).map(move => ({
      kind: 'population-transfer' as const,
      group: move.group,
      from: move.from,
      to: move.to,
      amount: move.amount,
      evidence: move.evidence,
    }));
  },
};

/** Moving residents carry a proportional share of pooled private reserves to the destination. */
// [I] MIGRATION-CASH1
// [I] CRISIS-DISPLACEMENT1
export const migrationCashRule: Rule = {
  id: 'population.migration-cash',
  direction: 'people-to-mapxel',
  randomNamespace: 'population.migration',
  phase: 'migration',
  description: 'The residents who move, including people displaced by crises, carry a proportional share of local private cash with them.',
  run({ model, cache, random }) {
    const peopleCache = resolveStepCache(model, cache);
    const byRoute = new Map<string, { from: number; to: number; amount: number }>();
    for (const move of planMigration(model, peopleCache, random)) {
      const key = `${move.from}:${move.to}`;
      const route = byRoute.get(key);
      if (route) route.amount += move.amount;
      else byRoute.set(key, { from: move.from, to: move.to, amount: move.amount });
    }

    return [...byRoute.values()].map(route => ({
      kind: 'transfer' as const,
      from: route.from,
      to: route.to,
      resource: 'cash' as const,
      amount: route.amount
        * Math.max(0, model.cells[route.from].cash)
        / Math.max(1e-12, peopleCache.peopleByCell[route.from].population),
    }));
  },
};
