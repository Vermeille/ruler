import { clamp } from '../math';
import type {
  Archetype,
  DeepReadonly,
  Effect,
  Mapxel,
  Model,
  PopulationGroup,
  Rule,
} from '../types';
import { isLand } from '../rules/helpers';
import { archetypeAt } from './archetypes';
import { viabilityOf } from './employment';
import { quantizeCohortFlow } from './resolution';
import { wellbeingOf } from './selectors';

function migrationAppeal(
  model: DeepReadonly<Model>,
  group: DeepReadonly<PopulationGroup>,
  archetype: Archetype,
  cell: DeepReadonly<Mapxel>,
  jobChance: number,
  culture: number,
  atHome: boolean,
): number {
  const wealthBuffer = clamp(group.wealth / 35);
  const employment = atHome ? (group.employed ? 1 : 0.2) : 0.2 + jobChance * 0.8;
  const expectedIncome = atHome
    ? group.income
    : cell.output / Math.max(1, cell.population) * (0.8 + group.education * 0.3) * jobChance;
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
  const weight = needs.food
    + needs.income
    + needs.employment
    + needs.health
    + needs.safety
    + needs.housing
    + needs.education
    + needs.environment
    + needs.culture;
  const lived = (
    needs.food * food
    + needs.income * purchasingPower
    + needs.employment * employment
    + needs.health * health
    + needs.safety * (1 - cell.crime)
    + needs.housing * clamp(1 - cell.population / 20_000)
    + needs.education * cell.education
    + needs.environment * (1 - cell.pollution)
    + needs.culture * culture
  ) / weight;

  const communityMood = atHome ? group.wellbeing : wellbeingOf(model, cell.id);
  return lived + communityMood * 0.25;
}

export const migrationRule: Rule = {
  id: 'population.migration',
  phase: 'migration',
  description: 'Each quarter, every adult group evaluates nearby places through its own needs, job, wealth, mobility, attachment, and lived conditions.',
  run({ model, random }) {
    if (model.tick % 3 !== 0) return [];

    const effects: Effect[] = [];
    const culture = clamp(0.5 + model.policy.spending.culture * model.budget.funding);
    const viability = model.cells.map(cell => (
      cell.biome === 'water' ? undefined : viabilityOf(cell, model)
    ));

    for (const from of model.cells) {
      if (!isLand(from)) continue;
      const movedByDestination = new Map<number, number>();
      const originViability = viability[from.id]!;

      for (const group of model.populationGroups[from.id]) {
        if (group.lifeStage !== 'adult' || group.count <= 0) continue;

        const archetype = archetypeAt(model.seed, group.archetype, model.archetypeModelVersion);
        const originJobChance = group.occupation ? originViability[group.occupation] : 0.5;
        const originAppeal = migrationAppeal(
          model,
          group,
          archetype,
          from,
          originJobChance,
          culture,
          true,
        );
        let bestCell: DeepReadonly<Mapxel> | undefined;
        let bestAdvantage = -Infinity;

        for (const neighborId of model.neighbors[from.id]) {
          const to = model.cells[neighborId];
          if (to.biome === 'water') continue;
          const jobChance = group.occupation ? viability[to.id]![group.occupation] : 0.5;
          const advantage = migrationAppeal(
            model,
            group,
            archetype,
            to,
            jobChance,
            culture,
            false,
          ) - originAppeal;
          if (
            advantage > bestAdvantage
            || (advantage === bestAdvantage && bestCell && to.id < bestCell.id)
          ) {
            bestCell = to;
            bestAdvantage = advantage;
          }
        }
        if (!bestCell || bestAdvantage <= 0) continue;

        const means = clamp(group.wealth / 10, 0.2, 1);
        const hardship = 1 + (1 - group.wellbeing) * 0.4 + (group.employed ? 0 : 0.25);
        const propensity = (0.2 + archetype.traits.mobility)
          * (1 - archetype.traits.communityAttachment * 0.75)
          * means
          * hardship;
        const freedomMultiplier = model.policy.laws.freeMovement ? 1 : 0.08;
        const rate = Math.min(0.009, bestAdvantage * 0.021 * propensity) * freedomMultiplier;
        const desiredAmount = group.count * rate;
        if (desiredAmount <= 1e-9) continue;

        const amount = quantizeCohortFlow(
          desiredAmount,
          group.count,
          random(from.id, `migration-cohort:${group.id}:${bestCell.id}`),
        );
        if (amount <= 1e-9) continue;

        effects.push({
          kind: 'population-transfer',
          group: group.id,
          from: from.id,
          to: bestCell.id,
          amount,
          evidence: amount >= 0.5
            ? {
                title: `${from.name}: archetype #${group.archetype} moves toward ${bestCell.name}`,
                detail: `${amount.toFixed(1)} people move because this group values the destination more under its own needs and circumstances. Employment status, income, reserves, mobility, community attachment, prices, services, safety, and environment all contribute.`,
                cells: [from.id, bestCell.id],
                reads: [
                  { cell: from.id, group: group.id, field: 'wealth', label: 'Group reserves' },
                  { cell: from.id, group: group.id, field: 'wellbeing', label: 'Group wellbeing' },
                  { cell: from.id, group: group.id, field: 'employed', label: 'Current employment' },
                  { cell: bestCell.id, field: 'price', label: 'Destination prices' },
                  { cell: bestCell.id, field: 'foodSecurity', label: 'Destination food access' },
                ],
                parents: ['policy:law:freeMovement'],
              }
            : undefined,
        });
        movedByDestination.set(
          bestCell.id,
          (movedByDestination.get(bestCell.id) ?? 0) + amount,
        );
      }

      for (const [destination, movingPopulation] of movedByDestination) {
        effects.push({
          kind: 'transfer',
          from: from.id,
          to: destination,
          resource: 'cash',
          amount: movingPopulation
            * Math.max(0, from.cash)
            / Math.max(1e-12, from.population),
        });
      }
    }

    return effects;
  },
};
