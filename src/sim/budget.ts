import { SECTORS, type DeepReadonly, type Model, type StepCache } from './types';
import { subsidyFor } from './policy';
import { crowns, type Crowns } from './units';

export type StepBudgetForecast = {
  revenue: Crowns;
  spending: Crowns;
  interest: Crowns;
  balance: Crowns;
};

/**
 * Fiscal execution uses the same step-start people summary as every other rule.
 * This deliberately avoids the persisted human compatibility projections on Mapxel.
 */
// [I] FISCAL-TAX1
// [I] FISCAL-INTEREST1
// [I] FISCAL-FUNDING1
// [I] FISCAL-SPENDING1
export function forecastBudgetForStep(
  model: DeepReadonly<Model>,
  cache: DeepReadonly<StepCache>,
): StepBudgetForecast {
  const publicServices = Object.values(model.policy.spending)
    .reduce((sum, amount) => sum + amount, 0);
  const effectiveTaxRate = 0.7 * model.policy.incomeTax + 0.3 * model.policy.businessTax;
  let revenue = 0;
  let spending = 0;

  for (const cell of model.cells) {
    if (cell.biome === 'water') continue;
    const people = cache.peopleByCell[cell.id];
    if (people.population <= 0) continue;

    revenue += cell.output * effectiveTaxRate;
    const subsidies = SECTORS.reduce(
      (sum, sector) => sum + people.occupationShares[sector] * subsidyFor(model, cell, sector),
      0,
    );
    spending += people.population * (publicServices + subsidies);
  }

  const interest = model.debt * 0.003;
  return {
    revenue: crowns(revenue),
    spending: crowns(spending),
    interest: crowns(interest),
    balance: crowns(revenue - spending - interest),
  };
}

// [I] FISCAL-BORROW1
export function debtLimitForStep(cache: DeepReadonly<StepCache>): Crowns {
  return crowns(cache.peopleByCell.reduce((sum, people) => sum + people.population, 0) * 30);
}
