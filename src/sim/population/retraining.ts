import { SECTORS, type Rule } from '../types';
import { viableJobs } from '../rules/wages';
import { archetypeAt } from './archetypes';

/** Occupational adaptation is a change in circumstance, never a change of archetype. */
export const retrainingRule: Rule = {
  id: 'population.retraining',
  phase: 'adaptation',
  description: 'Unemployed adults can retrain into locally viable sectors according to adaptability and education access.',
  run({ model }) {
    if (model.tick % 6 !== 0) return [];
    return model.cells.flatMap(cell => {
      if (cell.biome === 'water') return [];
      return model.populationGroups[cell.id].flatMap(group => {
        if (group.lifeStage !== 'adult' || group.employed || group.count < 1) return [];
        const archetype = archetypeAt(model.seed, group.archetype, model.archetypeModelVersion);
        const score = (sector: typeof SECTORS[number]) => cell[sector]
          * viableJobs(cell, model, sector)
          * (0.4 + archetype.affinities[sector]);
        const opportunity = [...SECTORS].sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0];
        if (opportunity === group.occupation || score(opportunity) < 0.02) return [];
        const amount = group.count * 0.25
          * (0.2 + archetype.traits.adaptability)
          * (0.3 + 0.7 * cell.education);
        if (amount < 0.1) return [];
        return [{
          kind: 'population-transition' as const,
          cell: cell.id,
          group: group.id,
          amount,
          transition: { occupation: opportunity },
          evidence: amount >= 1 ? {
            title: `${cell.name}: residents retrain for ${opportunity}`,
            detail: `${amount.toFixed(1)} unemployed residents of archetype #${group.archetype} change occupation as local opportunity and education access permit.`,
            cells: [cell.id],
            reads: [
              { cell: cell.id, group: group.id, field: 'education' as const, label: 'Group education' },
              { cell: cell.id, field: 'education' as const, label: 'Local education access' },
              { cell: cell.id, field: 'employment' as const, label: 'Local employment' },
            ],
          } : undefined,
        }];
      });
    });
  },
};
