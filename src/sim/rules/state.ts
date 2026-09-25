import { forecastBudgetForStep, debtLimitForStep } from '../budget';
import { clamp } from '../math';
import { subsidyFor } from '../policy';
import { resolveStepCache } from '../step-cache';
import { SECTORS, type Effect, type Rule } from '../types';
import { crowns } from '../units';
import { isLand } from './helpers';

// [I] FISCAL-TAX1
export const taxationRule: Rule = {
  id: 'state.taxation',
  direction: 'mapxel-to-mapxel',
  phase: 'taxation',
  description: 'Collect income and business taxes on measured output, limited by liquid private funds.',
  run({ model }) {
    const effects: Effect[] = [];
    let revenue = 0;

    for (const cell of model.cells.filter(isLand)) {
      const effectiveTaxRate = 0.7 * model.policy.incomeTax
        + 0.3 * model.policy.businessTax;
      const due = Math.max(0, Math.min(cell.cash, cell.output * effectiveTaxRate));

      revenue += due;
      effects.push({
        kind: 'transfer',
        from: cell.id,
        to: 'treasury',
        resource: 'cash',
        amount: crowns(due),
      });
    }

    effects.push({
      kind: 'budget',
      value: {
        revenue: crowns(revenue),
        spending: crowns(0),
        interest: crowns(0),
        borrowed: crowns(0),
        funding: 1,
      },
      debtDelta: crowns(0),
    });

    return effects;
  },
};

// [I] FISCAL-INTEREST1
// [I] FISCAL-BORROW1
export const financingRule: Rule = {
  id: 'state.financing',
  direction: 'mapxel-to-mapxel',
  phase: 'financing',
  description: 'Borrow only to cover a cash shortfall, up to a transparent per-resident credit limit.',
  run({ model, cache }) {
    const peopleCache = resolveStepCache(model, cache);
    const forecast = forecastBudgetForStep(model, peopleCache);
    const shortfall = forecast.spending + forecast.interest - model.treasury;
    const remainingCredit = debtLimitForStep(peopleCache) - model.debt;
    const borrowed = Math.max(
      0,
      Math.min(shortfall, remainingCredit, model.externalCash),
    );

    return [
      {
        kind: 'transfer' as const,
        from: 'external' as const,
        to: 'treasury' as const,
        resource: 'cash' as const,
        amount: crowns(borrowed),
      },
      {
        kind: 'budget' as const,
        value: { ...model.budget, borrowed: crowns(borrowed) },
        debtDelta: crowns(borrowed),
      },
    ];
  },
};

// [I] FISCAL-INTEREST1
// [I] FISCAL-FUNDING1
// [I] FISCAL-SPENDING1
// [I] FISCAL-REPAY1
export const fiscalRule: Rule = {
  id: 'state.services',
  direction: 'mapxel-to-mapxel',
  phase: 'fiscal',
  description: 'Public services and targeted subsidies compete for a finite budget. Unfunded services weaken rather than creating money.',
  run({ model, cache }) {
    const peopleCache = resolveStepCache(model, cache);
    const forecast = forecastBudgetForStep(model, peopleCache);
    const interest = Math.max(0, Math.min(model.treasury, forecast.interest));
    const availableForServices = Math.max(0, model.treasury - interest);
    const funding = forecast.spending > 0
      ? clamp(availableForServices / forecast.spending)
      : 1;
    const reserve = peopleCache.peopleByCell.reduce(
      (total, people) => total + people.population,
      0,
    ) * 6;
    const surplus = Math.max(0, availableForServices - forecast.spending * funding - reserve);
    const principalRepaid = Math.min(model.debt, surplus);
    const effects: Effect[] = [
      {
        kind: 'transfer',
        from: 'treasury',
        to: 'external',
        resource: 'cash',
        amount: crowns(interest),
      },
      { kind: 'repayDebt', amount: crowns(principalRepaid) },
    ];
    const serviceRate = Object.values(model.policy.spending)
      .reduce((sum, amount) => sum + amount, 0);

    for (const cell of model.cells.filter(isLand)) {
      const people = peopleCache.peopleByCell[cell.id];
      const basicServices = people.population * serviceRate * funding;
      const subsidyRate = SECTORS.reduce(
        (sum, sector) => sum + people.occupationShares[sector] * subsidyFor(model, cell, sector),
        0,
      );
      const subsidies = people.population * subsidyRate * funding;

      effects.push({
        kind: 'transfer',
        from: 'treasury',
        to: cell.id,
        resource: 'cash',
        amount: crowns(basicServices * 0.72 + subsidies),
      });
      effects.push({
        kind: 'transfer',
        from: 'treasury',
        to: 'external',
        resource: 'cash',
        amount: crowns(basicServices * 0.28),
      });
    }

    effects.push({
      kind: 'budget',
      value: {
        ...model.budget,
        spending: crowns(forecast.spending * funding),
        interest: crowns(interest),
        funding,
      },
      debtDelta: crowns(forecast.interest - interest),
    });

    return effects;
  },
};
