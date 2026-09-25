import { clamp } from '../math';
import type { DeepReadonly, Mapxel, Model, Sector } from '../types';
import { crownsPerPersonMonth, type CrownsPerPersonMonth } from '../units';

// [I] ECONOMY-SECTOR-RETURNS1
/** Gross monetary output produced by one employed resident over one month. */
export function unitOutput(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
  sector: Sector,
): CrownsPerPersonMonth {
  switch (sector) {
    case 'agriculture': return crownsPerPersonMonth(6 * cell.price);
    case 'manufacturing': return crownsPerPersonMonth(10 * (model.policy.laws.cleanAir ? 0.93 : 1));
    case 'services': return crownsPerPersonMonth(9 * cell.businessHealth);
    case 'sports': return crownsPerPersonMonth(4 + cell.sportsInterest * 7);
  }
}

// The local firm mix has payroll capacity spread uniformly from half to 1.5 times its mean.
// Worker health is explicit so callers cannot silently substitute the mapxel health-access field.
// [I] EMPLOYMENT-WAGE1
export function viableJobs(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
  sector: Sector,
  averageWorkerHealth: number,
): number {
  if (model.policy.minimumWage === 0) return 1;
  const capacity = (0.65 - 0.3 * model.policy.businessTax - 0.09)
    * unitOutput(cell, model, sector) * (0.65 + 0.35 * averageWorkerHealth);
  return capacity > 0 ? clamp(1.5 - model.policy.minimumWage / capacity) : 0;
}
