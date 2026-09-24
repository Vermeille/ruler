import { clamp } from '../math';
import { debtLimit, forecastBudget, subsidyFor } from '../policy';
import { SECTORS, type Effect, type Rule } from '../types';
import { isLand } from './helpers';

export const taxationRule: Rule = {
  id: 'state.taxation',
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
        amount: due,
      });
    }

    effects.push({
      kind: 'budget',
      value: {
        revenue,
        spending: 0,
        interest: 0,
        borrowed: 0,
        funding: 1,
      },
      debtDelta: 0,
    });

    return effects;
  },
};

export const financingRule: Rule = {
  id: 'state.financing',
  phase: 'financing',
  description: 'Borrow only to cover a cash shortfall, up to a transparent per-resident credit limit.',
  run({ model }) {
    const forecast = forecastBudget(model);
    const shortfall = forecast.spending + forecast.interest - model.treasury;
    const remainingCredit = debtLimit(model) - model.debt;
    const borrowed = Math.max(
      0,
      Math.min(shortfall, remainingCredit, model.externalCash),
    );

    return [
      {
        kind: 'transfer',
        from: 'external',
        to: 'treasury',
        resource: 'cash',
        amount: borrowed,
      },
      {
        kind: 'budget',
        value: { ...model.budget, borrowed },
        debtDelta: borrowed,
      },
    ];
  },
};

export const fiscalRule: Rule = {
  id: 'state.services',
  phase: 'fiscal',
  description: 'Public services and targeted subsidies compete for a finite budget. Unfunded services weaken rather than creating money.',
  run({ model }) {
    const forecast = forecastBudget(model);
    const interest = Math.max(0, Math.min(model.treasury, forecast.interest));
    const availableForServices = Math.max(0, model.treasury - interest);
    const funding = forecast.spending > 0
      ? clamp(availableForServices / forecast.spending)
      : 1;
    const reserve = model.cells.reduce((total, cell) => total + cell.population, 0) * 6;
    const surplus = Math.max(0, availableForServices - forecast.spending * funding - reserve);
    const principalRepaid = Math.min(model.debt, surplus);
    const effects: Effect[] = [
      {
        kind: 'transfer',
        from: 'treasury',
        to: 'external',
        resource: 'cash',
        amount: interest,
      },
      { kind: 'repayDebt', amount: principalRepaid },
    ];
    const serviceRate = Object.values(model.policy.spending)
      .reduce((sum, amount) => sum + amount, 0);

    for (const cell of model.cells.filter(isLand)) {
      const basicServices = cell.population * serviceRate * funding;
      const subsidyRate = SECTORS.reduce(
        (sum, sector) => sum + cell[sector] * subsidyFor(model, cell, sector),
        0,
      );
      const subsidies = cell.population * subsidyRate * funding;

      effects.push({
        kind: 'transfer',
        from: 'treasury',
        to: cell.id,
        resource: 'cash',
        amount: basicServices * 0.72 + subsidies,
      });
      effects.push({
        kind: 'transfer',
        from: 'treasury',
        to: 'external',
        resource: 'cash',
        amount: basicServices * 0.28,
      });
    }

    effects.push({
      kind: 'budget',
      value: {
        ...model.budget,
        spending: forecast.spending * funding,
        interest,
        funding,
      },
      debtDelta: forecast.interest - interest,
    });

    return effects;
  },
};
