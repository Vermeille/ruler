import { clamp } from '../../math';
import type { DeepReadonly, Effect, Mapxel, Model } from '../../types';
import { changeToward, delta } from '../helpers';

/** World-level social conditions that are not projections of resident state. */
export function wellbeingEffects(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
): Effect[] {
  const spending = model.policy.spending;
  const funding = model.budget.funding;
  const sportsInterestTarget = clamp(
    0.17 + cell.sports * 0.85 + spending.culture * funding * 0.6,
  );
  const deprivation = clamp((0.7 - cell.foodSecurity) / 0.7);
  const starvationDeaths = cell.population * deprivation * deprivation * 0.008;

  return [
    changeToward(cell, 'sportsInterest', sportsInterestTarget, 0.06),
    delta(cell, 'starvationDeaths', starvationDeaths - cell.starvationDeaths),
  ];
}
