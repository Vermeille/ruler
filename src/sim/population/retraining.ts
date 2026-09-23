import { clamp } from '../math';
import { subsidyFor } from '../policy';
import { SECTORS, type DeepReadonly, type Mapxel, type Model, type Rule, type Sector } from '../types';
import { unitOutput, viableJobs } from '../rules/wages';
import { archetypeAt } from './archetypes';

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
  run({ model }) {
    if (model.tick % 6 !== 0) return [];
    return model.cells.flatMap(cell => {
      if (cell.biome === 'water') return [];
      return model.populationGroups[cell.id].flatMap(group => {
        if (group.lifeStage !== 'adult' || group.count < 1) return [];
        const archetype = archetypeAt(model.seed, group.archetype, model.archetypeModelVersion);
        const score = (sector: Sector) => sectorOpportunity(cell, model, sector)
          * (0.4 + archetype.affinities[sector]);
        const opportunity = [...SECTORS].sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0];
        const bestScore = score(opportunity);
        if (opportunity === group.occupation || bestScore < 0.02) return [];

        let amount: number;
        if (group.employed) {
          const currentScore = group.occupation ? score(group.occupation) : 0;
          const relativeGain = (bestScore - currentScore) / Math.max(0.02, currentScore);
          if (relativeGain < 0.15) return [];
          amount = group.count * 0.06
            * (0.25 + archetype.traits.adaptability)
            * (0.35 + 0.65 * cell.education)
            * Math.min(1, relativeGain);
        } else {
          amount = group.count * 0.25
            * (0.2 + archetype.traits.adaptability)
            * (0.3 + 0.7 * cell.education);
        }
        if (amount < 0.1) return [];

        const action = group.employed ? 'switch jobs into' : 'retrain for';
        return [{
          kind: 'population-transition' as const,
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
        }];
      });
    });
  },
};
