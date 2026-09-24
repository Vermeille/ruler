import { clamp } from '../math';
import { subsidyFor } from '../policy';
import { resolveStepCache } from '../step-cache';
import {
  SECTORS,
  type DeepReadonly,
  type Effect,
  type Mapxel,
  type Model,
  type Rule,
  type Sector,
  type StepPeopleSummary,
} from '../types';
import { unitOutput, viableJobs } from '../rules/wages';
import { archetypeAt } from './archetypes';
import { quantizeCohortFlow } from './resolution';

function sectorOpportunity(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
  people: DeepReadonly<StepPeopleSummary>,
  sector: Sector,
): number {
  const structuralFit = 0.2 + people.occupationShares[sector];
  const localFit = sector === 'agriculture'
    ? 0.45 + cell.fertility * 0.55
    : sector === 'manufacturing'
      ? 0.45 + cell.minerals * 0.35 + cell.education * 0.2
      : sector === 'services'
        ? 0.45 + cell.businessHealth * 0.55
        : 0.35 + cell.sportsInterest * 0.65;
  const marketSignal = sector === 'agriculture'
    ? (cell.price - 1) * 1.1
    : sector === 'manufacturing'
      ? (model.policy.laws.cleanAir ? -0.08 : 0)
      : sector === 'services'
        ? (cell.businessHealth - 0.85) * 0.8
        : cell.sportsInterest * 0.25;
  const subsidy = subsidyFor(model, cell, sector) * model.budget.funding * 1.1;
  const returns = Math.exp(clamp(marketSignal + subsidy, -2, 4));
  return structuralFit
    * localFit
    * returns
    * viableJobs(cell, model, sector, people.averageHealth)
    * unitOutput(cell, model, sector);
}

function opportunities(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
  people: DeepReadonly<StepPeopleSummary>,
): Record<Sector, number> {
  return {
    agriculture: sectorOpportunity(cell, model, people, 'agriculture'),
    manufacturing: sectorOpportunity(cell, model, people, 'manufacturing'),
    services: sectorOpportunity(cell, model, people, 'services'),
    sports: sectorOpportunity(cell, model, people, 'sports'),
  };
}

function bestSector(
  opportunityBySector: Record<Sector, number>,
  affinities: Readonly<Record<Sector, number>>,
): { sector: Sector; score: number } {
  const score = (sector: Sector) => opportunityBySector[sector] * (0.4 + affinities[sector]);
  let sector: Sector = SECTORS[0];
  let bestScore = score(sector);
  for (let index = 1; index < SECTORS.length; index += 1) {
    const candidate = SECTORS[index];
    const candidateScore = score(candidate);
    if (candidateScore > bestScore
      || (candidateScore === bestScore && candidate.localeCompare(sector) < 0)) {
      sector = candidate;
      bestScore = candidateScore;
    }
  }
  return { sector, score: bestScore };
}

/** New adults choose an occupation only after life-stage transition, using local opportunity. */
export const entryOccupationRule: Rule = {
  id: 'population.entry-occupation',
  direction: 'mapxel-to-people',
  phase: 'adaptation',
  description: 'Working-age adults without an occupation choose a sector from local opportunities and archetype affinities.',
  run({ model, cache }) {
    const peopleCache = resolveStepCache(model, cache);
    const effects: Effect[] = [];
    for (const cell of model.cells) {
      if (cell.biome === 'water') continue;
      const opportunityBySector = opportunities(cell, model, peopleCache.peopleByCell[cell.id]);
      for (const group of model.populationGroups[cell.id]) {
        if (group.lifeStage !== 'adult' || group.occupation !== null || group.count <= 0) continue;
        const archetype = archetypeAt(model.seed, group.archetype, model.archetypeModelVersion);
        const choice = bestSector(opportunityBySector, archetype.affinities);
        if (choice.score < 0.02) continue;
        effects.push({
          kind: 'population-transition',
          cell: cell.id,
          group: group.id,
          amount: group.count,
          transition: { occupation: choice.sector, employed: false },
        });
      }
    }
    return effects;
  },
};

/** Occupational adaptation is a change in circumstance, never a change of archetype. */
export const retrainingRule: Rule = {
  id: 'population.retraining',
  direction: 'mapxel-to-people',
  phase: 'adaptation',
  description: 'Adults react to local jobs, prices, subsidies, education access, and adaptability by retraining or switching sectors.',
  run({ model, cache, random }) {
    if (model.tick % 6 !== 0) return [];
    const peopleCache = resolveStepCache(model, cache);
    const effects: Effect[] = [];

    for (const cell of model.cells) {
      if (cell.biome === 'water') continue;
      const people = peopleCache.peopleByCell[cell.id];
      const opportunityBySector = opportunities(cell, model, people);

      for (const group of model.populationGroups[cell.id]) {
        if (group.lifeStage !== 'adult' || group.occupation === null || group.count < 1) continue;
        const archetype = archetypeAt(model.seed, group.archetype, model.archetypeModelVersion);
        const choice = bestSector(opportunityBySector, archetype.affinities);
        const opportunity = choice.sector;
        const bestScore = choice.score;
        if (opportunity === group.occupation || bestScore < 0.02) continue;

        const currentScore = opportunityBySector[group.occupation]
          * (0.4 + archetype.affinities[group.occupation]);
        let desiredAmount: number;
        if (group.employed) {
          const relativeGain = (bestScore - currentScore) / Math.max(0.02, currentScore);
          if (relativeGain < 0.15) continue;
          desiredAmount = group.count * 0.06
            * (0.25 + archetype.traits.adaptability)
            * (0.35 + 0.65 * cell.education)
            * Math.min(1, relativeGain);
        } else {
          desiredAmount = group.count * 0.25
            * (0.2 + archetype.traits.adaptability)
            * (0.3 + 0.7 * cell.education);
        }
        if (desiredAmount < 0.1) continue;

        const amount = quantizeCohortFlow(
          desiredAmount,
          group.count,
          random(cell.id, `retraining-cohort:${group.id}:${opportunity}`),
        );
        if (amount <= 1e-9) continue;

        const action = group.employed ? 'switch jobs into' : 'retrain for';
        effects.push({
          kind: 'population-transition',
          cell: cell.id,
          group: group.id,
          amount,
          transition: { occupation: opportunity },
          evidence: amount >= 1 ? {
            title: `${cell.name}: residents ${action} ${opportunity}`,
            detail: `${amount.toFixed(1)} ${group.employed ? 'employed' : 'unemployed'} residents of archetype #${group.archetype} change occupation because local opportunity, policy, education access, and adaptability make ${opportunity} materially more attractive.`,
            cells: [cell.id],
            reads: [
              { cell: cell.id, group: group.id, field: 'education' as const, label: 'Group education' },
              { cell: cell.id, group: group.id, field: 'employed' as const, label: 'Current employment' },
              { cell: cell.id, field: 'education' as const, label: 'Local education access' },
              { cell: cell.id, field: 'price' as const, label: 'Local price signal' },
            ],
            parents: [`${cell.id}:subsidy:${opportunity}`],
          } : undefined,
        });
      }
    }
    return effects;
  },
};
