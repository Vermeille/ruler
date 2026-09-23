import { clamp } from '../math';
import type { DeepReadonly, Effect, Mapxel, Rule } from '../types';
import { changeToward, delta, isLand, read } from './helpers';

function averageNeighborWealth(
  neighbors: readonly DeepReadonly<Mapxel>[],
): number {
  const total = neighbors.reduce(
    (sum, neighbor) => sum + neighbor.cash / neighbor.population,
    0,
  );
  return total / Math.max(1, neighbors.length);
}

export const societyRule: Rule = {
  id: 'society.wellbeing',
  phase: 'society',
  description: 'Poverty and neighboring inequality drive crime; services, health, food, employment, and civil liberties shape wellbeing.',
  run({ model }) {
    return model.cells.filter(isLand).flatMap(cell => {
      const spending = model.policy.spending;
      const funding = model.budget.funding;
      const wealth = cell.cash / cell.population;
      const neighbors = model.neighbors[cell.id].map(id => model.cells[id]);
      const neighborWealth = averageNeighborWealth(neighbors);
      const inequality = clamp((neighborWealth - wealth) / 40);
      const poverty = clamp((24 - wealth) / 24);
      const police = spending.police * funding;

      const crimeTarget = clamp(
        0.11
          + poverty * 0.3
          + inequality * 0.24
          + (1 - cell.employment) * 0.3
          - police * 0.3
          - spending.welfare * funding * 0.09,
        0.015,
        0.7,
      );
      const crimeEvidence = Math.abs(crimeTarget - cell.crime) > 0.06
        && model.tick % 3 === 0
        ? {
            title: `${cell.name}: crime pressure ${crimeTarget > cell.crime ? 'rises' : 'recedes'}`,
            detail: `Private reserves are ₡${wealth.toFixed(1)} per resident, compared with ₡${neighborWealth.toFixed(1)} next door. Effective police funding is ₡${police.toFixed(2)} per resident.`,
            cells: [cell.id],
            reads: [
              read(cell, 'cash', 'Private reserves'),
              read(cell, 'employment', 'Employment'),
              ...neighbors.slice(0, 2).map(neighbor => read(neighbor, 'cash', 'Neighbor reserves')),
            ],
            parents: [
              'policy:spending:police',
              'policy:spending:welfare',
              'policy:incomeTax',
              'policy:businessTax',
            ],
          }
        : undefined;

      const healthTarget = clamp(
        0.55
          + spending.health * funding * 0.5
          - cell.pollution * 0.18
          - (1 - cell.foodSecurity) * 0.35
          + wealth * 0.001,
      );
      const educationTarget = clamp(
        0.35 + spending.education * funding * 0.6 + wealth * 0.002,
      );
      const infrastructureTarget = clamp(
        0.3
          + spending.infrastructure * funding * 0.9
          + Math.min(1, cell.materials / cell.population) * 0.06,
      );
      const pollutionTarget = clamp(
        cell.manufacturing * (model.policy.laws.cleanAir ? 0.6 : 1.1)
          + cell.population / 12000
          - spending.environment * funding * 0.7,
      );
      const employmentTarget = clamp(
        0.96
          - (1 - cell.businessHealth) * cell.services * 0.6
          - model.policy.businessTax * 0.12
          - (1 - cell.foodSecurity) * 0.05,
        0.45,
        0.98,
      );
      const happinessTarget = clamp(
        0.29
          + cell.health * 0.22
          + cell.foodSecurity * 0.2
          + cell.employment * 0.16
          + clamp(wealth / 45) * 0.08
          - cell.crime * 0.45
          - cell.pollution * 0.08
          + spending.culture * funding * 0.12
          - (model.policy.laws.publicAssembly ? 0 : 0.12),
      );
      const approvalTarget = clamp(
        cell.happiness * 0.82
          + 0.12
          - model.policy.incomeTax * 0.25
          - (1 - funding) * 0.17
          + (model.policy.laws.publicAssembly ? 0.025 : -0.06),
      );
      const sportsInterestTarget = clamp(
        0.17 + cell.sports * 0.85 + spending.culture * funding * 0.6,
      );
      const birthRate = 0.00065 + cell.happiness * 0.00055 + cell.health * 0.0002;
      const deathRate = 0.00095
        + (1 - cell.health) * 0.0005
        + (1 - cell.foodSecurity) * 0.0008;
      const populationChange = cell.population * (birthRate - deathRate);
      const childrenTarget = clamp(0.15 + cell.happiness * 0.09, 0.12, 0.28);
      const seniorsTarget = clamp(0.12 + cell.health * 0.07, 0.12, 0.22);

      return [
        changeToward(cell, 'crime', crimeTarget, 0.12, crimeEvidence),
        changeToward(cell, 'health', healthTarget, 0.045),
        changeToward(cell, 'education', educationTarget, 0.025),
        changeToward(cell, 'infrastructure', infrastructureTarget, 0.06),
        changeToward(cell, 'pollution', pollutionTarget, 0.08),
        changeToward(cell, 'employment', employmentTarget, 0.1),
        changeToward(cell, 'happiness', happinessTarget, 0.09),
        changeToward(cell, 'approval', approvalTarget, 0.12),
        changeToward(cell, 'sportsInterest', sportsInterestTarget, 0.06),
        delta(cell, 'population', populationChange),
        changeToward(cell, 'children', childrenTarget, 0.008),
        changeToward(cell, 'seniors', seniorsTarget, 0.005),
      ];
    });
  },
};

function appeal(cell: DeepReadonly<Mapxel>): number {
  return cell.happiness
    + cell.employment * 0.4
    + clamp(cell.cash / cell.population / 60) * 0.15
    - cell.population / 15000;
}

export const migrationRule: Rule = {
  id: 'society.migration',
  phase: 'migration',
  description: 'Residents move to adjacent opportunities, carrying their savings. Moves are gradual and population-conserving.',
  run({ model }) {
    const effects: Effect[] = [];

    for (const a of model.cells.filter(isLand)) {
      for (const neighborId of model.neighbors[a.id]) {
        if (neighborId <= a.id) continue;

        const b = model.cells[neighborId];
        const difference = appeal(b) - appeal(a);
        const [from, to] = difference > 0 ? [a, b] : [b, a];
        const movementRate = Math.min(0.003, Math.abs(difference) * 0.007);
        const freedomMultiplier = model.policy.laws.freeMovement ? 1 : 0.08;
        const population = from.population * movementRate * freedomMultiplier;
        const cash = population * from.cash / from.population;

        effects.push({
          kind: 'transfer',
          from: from.id,
          to: to.id,
          resource: 'population',
          amount: population,
        });
        effects.push({
          kind: 'transfer',
          from: from.id,
          to: to.id,
          resource: 'cash',
          amount: cash,
        });
      }
    }

    return effects;
  },
};
