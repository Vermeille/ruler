import { clamp } from '../math';
import { averageWealthOf } from '../population/selectors';
import type { DeepReadonly, Effect, Mapxel, Model, Rule } from '../types';
import { changeToward, isLand } from './helpers';

function conditionEffects(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
  wealthByCell: readonly number[],
): Effect[] {
  const spending = model.policy.spending;
  const funding = model.budget.funding;
  const wealth = wealthByCell[cell.id];
  const neighbors = model.neighbors[cell.id].map(id => model.cells[id]);
  const neighborIndustry = neighbors.length
    ? neighbors.reduce((sum, neighbor) => sum + neighbor.manufacturing, 0) / neighbors.length
    : cell.manufacturing;

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
  const sportsInterestTarget = clamp(
    0.17 + cell.sports * 0.85 + spending.culture * funding * 0.6,
  );

  return [
    changeToward(cell, 'health', healthTarget, 0.045),
    changeToward(cell, 'education', educationTarget, 0.025),
    changeToward(cell, 'infrastructure', infrastructureTarget, 0.06),
    changeToward(cell, 'pollution', pollutionTarget, 0.08),
    changeToward(cell, 'sportsInterest', sportsInterestTarget, 0.06),
  ];
}

/** Environment-to-environment state. Human outcomes are changed by population rules instead. */
export const environmentRule: Rule = {
  id: 'environment.conditions',
  phase: 'society',
  description: 'Services, pollution, infrastructure, and cultural conditions respond to policy and world state.',
  run({ model }) {
    const effects: Effect[] = [];
    const wealthByCell = model.cells.map(cell => (
      cell.biome === 'water' ? 0 : averageWealthOf(model, cell.id)
    ));
    for (const cell of model.cells) {
      if (!isLand(cell)) continue;
      effects.push(...conditionEffects(cell, model, wealthByCell));
    }
    return effects;
  },
};
