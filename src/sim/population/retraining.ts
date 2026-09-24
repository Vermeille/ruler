import { clamp } from '../math';
import { subsidyFor } from '../policy';
import { SECTORS, type DeepReadonly, type Mapxel, type Model, type Rule, type Sector } from '../types';
import { unitOutput, viableJobs } from '../rules/wages';
import { archetypeAt } from './archetypes';
import { quantizeCohortFlow } from './resolution';

function sectorOpportunity(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
  sector: Sector,
): number {
  const structuralFit = 0.2 + cell[sector];
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
  return structuralFit * localFit * returns * viableJobs(cell, model, sector) * unitOutput(cell, model, sector);
}

/** Occupational adaptation is a change in circumstance, never a change of archetype. */
export const retrainingRule: Rule = {
  id: 'population.retraining',
  phase: 'adaptation',
  description: 'Adults react to local jobs, prices, subsidies, education access, and adaptability by retraining or switching sectors.',
  run({ model, random }) {
    if (model.tick % 6 !== 0) return [];
    const effects = [] as ReturnType<Rule['run']>;

    for (const cell of model.cells) {
      if (cell.biome === 'water') continue;
      const opportunityBySector: Record<Sector, number> = {
        agriculture: sectorOpportunity(cell, model, 'agriculture'),
        manufacturing: sectorOpportunity(cell, model, 'manufacturing'),
        services: sectorOpportunity(cell, model, 'services'),
        sports: sectorOpportunity(cell, model, 'sports'),
      };

      for (const group of model.populationGroups[cell.id]) {
        if (group.lifeStage !== 'adult' || group.count < 1) continue;
        const archetype = archetypeAt(model.seed, group.archetype, model.archetypeModelVersion);
        const score = (sector: Sector) => opportunityBySector[sector] * (0.4 + archetype.affinities[sector]);
        let opportunity = SECTORS[0];
        let bestScore = score(opportunity);
        for (let index = 1; index < SECTORS.length; index += 1) {
          const candidate = SECTORS[index];
          const candidateScore = score(candidate);
          if (candidateScore > bestScore
            || (candidateScore === bestScore && candidate.localeCompare(opportunity) < 0)) {
            opportunity = candidate;
            bestScore = candidateScore;
          }
        }
        if (opportunity === group.occupation || bestScore < 0.02) continue;

        let desiredAmount: number;
        if (group.employed) {
          const currentScore = group.occupation ? score(group.occupation) : 0;
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
