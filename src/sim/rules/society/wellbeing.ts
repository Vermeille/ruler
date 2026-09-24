import { clamp } from '../../math';
import type { DeepReadonly, Effect, Mapxel, Model } from '../../types';
import { changeToward, delta } from '../helpers';

export function wellbeingEffects(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
  wealth: number,
  actualEmployment: number,
): Effect[] {
  const spending = model.policy.spending;
  const funding = model.budget.funding;

  const happinessTarget = clamp(
    0.29
      + cell.health * 0.22
      + cell.foodSecurity * 0.2
      + actualEmployment * 0.16
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
  const deprivation = clamp((0.7 - cell.foodSecurity) / 0.7);
  const starvationDeaths = cell.population * deprivation * deprivation * 0.008;
  const childrenTarget = clamp(0.15 + cell.happiness * 0.09, 0.12, 0.28);
  const seniorsTarget = clamp(0.12 + cell.health * 0.07, 0.12, 0.22);

  return [
    changeToward(cell, 'happiness', happinessTarget, 0.09),
    changeToward(cell, 'approval', approvalTarget, 0.12),
    changeToward(cell, 'sportsInterest', sportsInterestTarget, 0.06),
    delta(cell, 'starvationDeaths', starvationDeaths - cell.starvationDeaths),
    changeToward(cell, 'children', childrenTarget, 0.008),
    changeToward(cell, 'seniors', seniorsTarget, 0.005),
  ];
}
