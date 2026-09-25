import { constrainMapxelFieldValue, mapxelFieldSpec } from '../map-fields';
import type { Account, DeepReadonly, Effect, Game, Model, MutableField } from '../types';
import {
  foodPrice,
  foodTradeCost,
  materialPrice,
  materialTradeCost,
  materialUnits,
  personMonths,
} from '../units';

export type Resource = 'cash' | 'food' | 'materials';

export type ResourceSettlementPlan = {
  demands: Map<string, number>;
};

function accountBalance(
  model: DeepReadonly<Model>,
  account: Account,
  resource: Resource,
): number {
  if (account === 'external' || account === 'treasury') {
    if (resource !== 'cash') {
      throw new Error('Public and external accounts only hold cash.');
    }
    return account === 'treasury' ? model.treasury : model.externalCash;
  }

  const cell = model.cells[account];
  if (!cell || cell.biome === 'water') {
    throw new Error(`Invalid account ${account}`);
  }
  return cell[resource];
}

function moveResource(
  model: Model,
  account: Account,
  resource: Resource,
  amount: number,
): void {
  if (account === 'external') {
    model.externalCash += amount;
    return;
  }
  if (account === 'treasury') {
    model.treasury += amount;
    return;
  }
  model.cells[account][resource] += amount;
}

function demandKey(account: Account, resource: Resource): string {
  return `${account}/${resource}`;
}

function addDemand(
  demands: Map<string, number>,
  snapshot: DeepReadonly<Model>,
  account: Account,
  resource: Resource,
  amount: number,
): void {
  accountBalance(snapshot, account, resource);
  const key = demandKey(account, resource);
  demands.set(key, (demands.get(key) ?? 0) + amount);
}

function tradeCashAmount(
  effect: Extract<Effect, { kind: 'trade' }>,
  amount: number,
): number {
  return effect.resource === 'food'
    ? foodTradeCost(personMonths(amount), foodPrice(effect.price))
    : materialTradeCost(materialUnits(amount), materialPrice(effect.price));
}

function validateEffectAmount(effect: Effect): void {
  if (!('amount' in effect)) return;
  if (!Number.isFinite(effect.amount) || (effect.kind !== 'delta' && effect.amount < 0)) {
    throw new Error('Invalid effect amount.');
  }
}

function validateBudgetEffect(
  effect: Extract<Effect, { kind: 'budget' }>,
  budgetEffectCount: number,
): void {
  const invalidBudget = Object.values(effect.value).some(value => !Number.isFinite(value) || value < 0);
  if (
    budgetEffectCount > 1
    || !Number.isFinite(effect.debtDelta)
    || effect.debtDelta < 0
    || invalidBudget
    || effect.value.funding > 1
  ) {
    throw new Error('Invalid or conflicting fiscal effects.');
  }
}

/** Plan all phase-start resource claims before any effect mutates the model. */
export function planResourceSettlement(
  snapshot: DeepReadonly<Model>,
  effects: readonly Effect[],
): ResourceSettlementPlan {
  const demands = new Map<string, number>();
  let budgetEffectCount = 0;
  let repaymentDemand = 0;

  for (const effect of effects) {
    validateEffectAmount(effect);
    switch (effect.kind) {
      case 'delta': {
        const cell = snapshot.cells[effect.cell];
        const spec = mapxelFieldSpec(effect.field);
        if (!spec?.delta || !cell || cell.biome === 'water') {
          throw new Error('Invalid delta; this field must use its dedicated effect.');
        }
        if (effect.amount < 0 && spec.resource) {
          addDemand(demands, snapshot, effect.cell, spec.resource, -effect.amount);
        }
        break;
      }
      case 'transfer':
        accountBalance(snapshot, effect.to, effect.resource);
        addDemand(demands, snapshot, effect.from, effect.resource, effect.amount);
        break;
      case 'repayDebt':
        addDemand(demands, snapshot, 'treasury', 'cash', effect.amount);
        repaymentDemand += effect.amount;
        break;
      case 'trade':
        if (!Number.isFinite(effect.price) || effect.price <= 0) {
          throw new Error('Invalid trade price.');
        }
        addDemand(demands, snapshot, effect.from, effect.resource, effect.amount);
        addDemand(demands, snapshot, effect.to, 'cash', tradeCashAmount(effect, effect.amount));
        break;
      case 'budget':
        budgetEffectCount += 1;
        validateBudgetEffect(effect, budgetEffectCount);
        break;
    }
  }

  if (repaymentDemand > snapshot.debt + 1e-6) {
    throw new Error('Debt repayment exceeds outstanding principal.');
  }

  return { demands };
}

function demandScale(
  snapshot: DeepReadonly<Model>,
  plan: ResourceSettlementPlan,
  account: Account,
  resource: Resource,
): number {
  const available = accountBalance(snapshot, account, resource);
  const requested = plan.demands.get(demandKey(account, resource)) ?? 0;
  return Math.min(1, available / Math.max(1e-12, requested));
}

/** Settle one non-population, non-event effect. Returns its realized magnitude. */
export function settleResourceEffect(
  game: Game,
  snapshot: DeepReadonly<Model>,
  plan: ResourceSettlementPlan,
  deltas: Map<string, number>,
  effect: Effect,
): number {
  switch (effect.kind) {
    case 'delta': {
      let actual = effect.amount;
      const resource = mapxelFieldSpec(effect.field)?.resource;
      if (actual < 0 && resource) {
        actual *= demandScale(snapshot, plan, effect.cell, resource);
      }
      const key = `${effect.cell}:${effect.field}`;
      deltas.set(key, (deltas.get(key) ?? 0) + actual);
      return actual;
    }
    case 'transfer': {
      const actual = effect.amount * demandScale(snapshot, plan, effect.from, effect.resource);
      moveResource(game.model, effect.from, effect.resource, -actual);
      moveResource(game.model, effect.to, effect.resource, actual);
      return actual;
    }
    case 'repayDebt': {
      const actual = effect.amount * demandScale(snapshot, plan, 'treasury', 'cash');
      moveResource(game.model, 'treasury', 'cash', -actual);
      moveResource(game.model, 'external', 'cash', actual);
      game.model.debt -= actual;
      return actual;
    }
    case 'trade': {
      const sellerScale = demandScale(snapshot, plan, effect.from, effect.resource);
      const buyerScale = demandScale(snapshot, plan, effect.to, 'cash');
      const actual = effect.amount * Math.min(sellerScale, buyerScale);
      const cash = tradeCashAmount(effect, actual);
      moveResource(game.model, effect.from, effect.resource, -actual);
      moveResource(game.model, effect.to, effect.resource, actual);
      moveResource(game.model, effect.to, 'cash', -cash);
      moveResource(game.model, effect.from, 'cash', cash);
      if (effect.resource === 'food') {
        game.model.cells[effect.from].foodTraded -= actual;
        game.model.cells[effect.to].foodTraded += actual;
      }
      return actual;
    }
    case 'budget':
      game.model.budget = { ...effect.value };
      game.model.debt += effect.debtDelta;
      return 0;
    case 'event':
    case 'population-transfer':
    case 'population-transition':
    case 'population-state':
    case 'population-delta':
      return 0;
  }
}

export function applyAccumulatedDeltas(game: Game, deltas: Map<string, number>): void {
  for (const [key, amount] of deltas) {
    const [cellId, field] = key.split(':') as [string, MutableField];
    const cell = game.model.cells[Number(cellId)];
    cell[field] = constrainMapxelFieldValue(field, cell[field] + amount);
  }
}
