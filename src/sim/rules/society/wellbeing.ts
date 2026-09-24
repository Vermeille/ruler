import { clamp } from '../../math';
import type { DeepReadonly, Effect, Mapxel, Model } from '../../types';
import { changeToward } from '../helpers';

/** World-level cultural conditions that are not projections of resident state. */
export function wellbeingEffects(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
): Effect[] {
  const sportsInterestTarget = clamp(
    0.17 + cell.sports * 0.85 + model.policy.spending.culture * model.budget.funding * 0.6,
  );
  return [changeToward(cell, 'sportsInterest', sportsInterestTarget, 0.06)];
}
