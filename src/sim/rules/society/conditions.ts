import { clamp } from '../../math';
import type { DeepReadonly, Effect, Mapxel, Model } from '../../types';
import { changeToward, read } from '../helpers';

export function conditionEffects(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
  wealthByCell: readonly number[],
  actualEmployment: number,
): Effect[] {
  const spending = model.policy.spending;
  const funding = model.budget.funding;
  const wealth = wealthByCell[cell.id];
  const neighbors = model.neighbors[cell.id].map(id => model.cells[id]);
  const neighborIndustry = neighbors.length
    ? neighbors.reduce((sum, neighbor) => sum + neighbor.manufacturing, 0) / neighbors.length
    : cell.manufacturing;
  const neighborWealth = neighbors.reduce((sum, neighbor) => sum + wealthByCell[neighbor.id], 0)
    / Math.max(1, neighbors.length);
  const inequality = clamp((neighborWealth - wealth) / 40);
  const poverty = clamp((24 - wealth) / 24);
  const police = spending.police * funding;

  const crimeTarget = clamp(
    0.11
      + poverty * 0.3
      + inequality * 0.24
      + (1 - actualEmployment) * 0.3
      - police * 0.3
      - spending.welfare * funding * 0.09,
    0.015,
    0.7,
  );
  const crimeEvidence = Math.abs(crimeTarget - cell.crime) > 0.06
    && model.tick % 3 === 0
    ? {
        title: `${cell.name}: crime pressure ${crimeTarget > cell.crime ? 'rises' : 'recedes'}`,
        detail: `Average household reserves are ${wealth.toFixed(1)} for local population groups, compared with ${neighborWealth.toFixed(1)} next door. Effective police funding is ₡${police.toFixed(2)} per resident.`,
        cells: [cell.id],
        reads: [
          read(cell, 'employment', 'Previous aggregate employment'),
          ...neighbors.slice(0, 2).map(neighbor => read(neighbor, 'cash', 'Neighbor private account')),
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
    (cell.manufacturing * 0.75 + neighborIndustry * 0.25)
      * (model.policy.laws.cleanAir ? 0.6 : 1.1)
      + cell.population / 12000
      - spending.environment * funding * 0.7,
  );

  return [
    changeToward(cell, 'crime', crimeTarget, 0.12, crimeEvidence),
    changeToward(cell, 'health', healthTarget, 0.045),
    changeToward(cell, 'education', educationTarget, 0.025),
    changeToward(cell, 'infrastructure', infrastructureTarget, 0.06),
    changeToward(cell, 'pollution', pollutionTarget, 0.08),
  ];
}
