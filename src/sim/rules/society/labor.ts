import { clamp } from '../../math';
import { archetypeAt } from '../../population/archetypes';
import type {
  DeepReadonly,
  Effect,
  Mapxel,
  Model,
  PopulationGroup,
  Sector,
} from '../../types';
import { viableJobs } from '../wages';

export type SectorViability = Record<Sector, number>;

export function viabilityOf(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
): SectorViability {
  return {
    agriculture: viableJobs(cell, model, 'agriculture'),
    manufacturing: viableJobs(cell, model, 'manufacturing'),
    services: viableJobs(cell, model, 'services'),
    sports: viableJobs(cell, model, 'sports'),
  };
}

function desiredEmployedAdults(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
  adults: readonly DeepReadonly<PopulationGroup>[],
  viability: SectorViability,
): number {
  const capacity = adults.reduce((sum, group) => {
    if (!group.occupation) return sum;
    return sum + group.count * viability[group.occupation];
  }, 0);
  const ordinaryDemand = clamp(
    0.98
      - (1 - cell.businessHealth) * 0.35
      - model.policy.businessTax * 0.12
      - (1 - cell.foodSecurity) * 0.05,
    0.45,
    0.99,
  );
  return capacity * ordinaryDemand;
}

function employmentTransitions(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
  viability: SectorViability,
): Effect[] {
  const adults = model.populationGroups[cell.id].filter(group => group.lifeStage === 'adult');
  if (!adults.length) return [];

  const employed = adults.reduce(
    (sum, group) => sum + (group.employed ? group.count : 0),
    0,
  );
  const target = desiredEmployedAdults(cell, model, adults, viability);
  const change = target - employed;
  if (Math.abs(change) < 0.25) return [];

  const losingJobs = change < 0;
  let remaining = Math.abs(change);
  const candidates = adults
    .filter(group => group.employed === losingJobs)
    .map(group => {
      const archetype = archetypeAt(model.seed, group.archetype, model.archetypeModelVersion);
      const sectorViability = group.occupation ? viability[group.occupation] : 0;
      const score = losingJobs
        ? (1 - sectorViability) * 0.6
          + (1 - group.education) * 0.2
          + (1 - archetype.traits.adaptability) * 0.2
        : sectorViability * 0.45
          + archetype.traits.adaptability * 0.3
          + group.education * 0.25;
      return { group, score };
    })
    .sort((a, b) => b.score - a.score || a.group.id - b.group.id);

  const effects: Effect[] = [];
  for (const { group } of candidates) {
    if (remaining <= 1e-9) break;
    const amount = Math.min(group.count, remaining);
    effects.push({
      kind: 'population-transition',
      cell: cell.id,
      group: group.id,
      amount,
      transition: { employed: !losingJobs },
      evidence: amount >= 1 && model.tick % 3 === 0
        ? {
            title: `${cell.name}: ${losingJobs ? 'workers lose jobs' : 'residents find work'}`,
            detail: `${amount.toFixed(1)} residents of archetype #${group.archetype} ${losingJobs ? 'lose employment' : 'enter employment'} because local firms can support a different number of jobs. Adaptability, education, and occupation viability decide who is affected.`,
            cells: [cell.id],
            reads: [
              { cell: cell.id, group: group.id, field: 'employed', label: 'Starting employment status' },
              { cell: cell.id, field: 'businessHealth', label: 'Business viability' },
            ],
            parents: ['policy:minimumWage', 'policy:businessTax'],
          }
        : undefined,
    });
    remaining -= amount;
  }
  return effects;
}

export function employmentEffects(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
): Effect[] {
  return employmentTransitions(cell, model, viabilityOf(cell, model));
}
