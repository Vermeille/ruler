import { clamp } from '../math';
import type { DeepReadonly, Mapxel, Model, Sector } from '../types';

export function unitOutput(cell: DeepReadonly<Mapxel>, model: DeepReadonly<Model>, sector: Sector): number {
  switch (sector) {
    case 'agriculture': return 6 * cell.price;
    case 'manufacturing': return 10 * (model.policy.laws.cleanAir ? 0.93 : 1);
    case 'services': return 9 * cell.businessHealth;
    case 'sports': return 4 + cell.sportsInterest * 7;
  }
}

// The local firm mix has payroll capacity spread uniformly from half to 1.5 times its mean.
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
