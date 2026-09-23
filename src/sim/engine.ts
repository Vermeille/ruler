import { deepFreeze, randomAt, summarize, clamp } from './math';
import { writeMonthlyNews } from './narrative';
import { defaultRules } from './rules';
import {
  MUTABLE_FIELDS,
  PHASES,
  SECTORS,
  type Account,
  type Cause,
  type DeepReadonly,
  type Effect,
  type Evidence,
  type Game,
  type Model,
  type MutableField,
  type Phase,
  type Rule,
} from './types';

type Resource = 'cash' | 'food' | 'materials' | 'population';
type Proposal = { rule: string; effect: Effect };

type SettlementPlan = {
  demands: Map<string, number>;
};

const BOUNDED_FIELDS = new Set<MutableField>([
  'waterStress',
  'children',
  'seniors',
  'education',
  'health',
  'happiness',
  'approval',
  'crime',
  'pollution',
  'infrastructure',
  'employment',
  'foodSecurity',
  'sportsInterest',
  'businessHealth',
  ...SECTORS,
]);

function phaseIndex(phase: Phase): number {
  return PHASES.indexOf(phase);
}

function rulesById(rules: readonly Rule[]): Map<string, Rule> {
  const result = new Map(rules.map(rule => [rule.id, rule]));

  if (result.size !== rules.length) {
    throw new Error('Rule IDs must be unique.');
  }

  return result;
}

export function orderRules(rules: readonly Rule[]): Rule[] {
  const byId = rulesById(rules);
  const ordered: Rule[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();

  function visit(rule: Rule): void {
    if (done.has(rule.id)) return;

    if (!PHASES.includes(rule.phase)) {
      throw new Error(`Unknown phase: ${rule.phase}`);
    }

    if (visiting.has(rule.id)) {
      throw new Error(`Rule dependency cycle at ${rule.id}`);
    }

    visiting.add(rule.id);

    for (const dependencyId of [...(rule.after ?? [])].sort()) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        throw new Error(`Missing dependency: ${dependencyId}`);
      }

      if (phaseIndex(dependency.phase) > phaseIndex(rule.phase)) {
        throw new Error(`Dependency ${dependencyId} runs after ${rule.id}`);
      }

      visit(dependency);
    }

    visiting.delete(rule.id);
    done.add(rule.id);
    ordered.push(rule);
  }

  for (const phase of PHASES) {
    const phaseRules = rules
      .filter(rule => rule.phase === phase)
      .sort((a, b) => a.id.localeCompare(b.id));

    for (const rule of phaseRules) {
      visit(rule);
    }
  }

  return ordered;
}

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

export function recordCause(
  game: Game,
  snapshot: DeepReadonly<Model>,
  rule: string,
  evidence: Evidence,
  magnitude: number,
  provenance = game.provenance,
): string {
  const parents = new Set<string>();

  for (const key of evidence.parents ?? []) {
    if (provenance[key]) parents.add(provenance[key]);
  }

  const observations = (evidence.reads ?? []).map(read => {
    const source = provenance[`${read.cell}:${read.field}`];
    if (source) parents.add(source);

    return {
      ...read,
      value: snapshot.cells[read.cell][read.field],
    };
  });

  const id = `c${game.model.tick}-${game.causes.length}`;
  const cause: Cause = {
    id,
    tick: game.model.tick,
    rule,
    title: evidence.title,
    detail: evidence.detail,
    cells: [...evidence.cells],
    parents: [...parents],
    observations,
    magnitude,
  };

  game.causes.push(cause);
  return id;
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

function validateEffectAmount(effect: Effect): void {
  if (!('amount' in effect)) return;

  if (!Number.isFinite(effect.amount) || (effect.kind !== 'delta' && effect.amount < 0)) {
    throw new Error('Invalid effect amount.');
  }
}

function planDeltaDemand(
  demands: Map<string, number>,
  snapshot: DeepReadonly<Model>,
  effect: Extract<Effect, { kind: 'delta' }>,
): void {
  const cell = snapshot.cells[effect.cell];
  const invalidField = !MUTABLE_FIELDS.includes(effect.field) || effect.field === 'cash';

  if (invalidField || !cell || cell.biome === 'water') {
    throw new Error('Invalid delta; cash must use transfers.');
  }

  if (effect.amount < 0 && ['food', 'materials', 'population'].includes(effect.field)) {
    addDemand(demands, snapshot, effect.cell, effect.field as Resource, -effect.amount);
  }
}

function planTransferDemand(
  demands: Map<string, number>,
  snapshot: DeepReadonly<Model>,
  effect: Extract<Effect, { kind: 'transfer' }>,
): void {
  accountBalance(snapshot, effect.to, effect.resource);
  addDemand(demands, snapshot, effect.from, effect.resource, effect.amount);
}

function planTradeDemand(
  demands: Map<string, number>,
  snapshot: DeepReadonly<Model>,
  effect: Extract<Effect, { kind: 'trade' }>,
): void {
  if (!Number.isFinite(effect.price) || effect.price <= 0) {
    throw new Error('Invalid trade price.');
  }

  addDemand(demands, snapshot, effect.from, effect.resource, effect.amount);
  addDemand(demands, snapshot, effect.to, 'cash', effect.amount * effect.price);
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

function planSettlement(snapshot: DeepReadonly<Model>, proposals: Proposal[]): SettlementPlan {
  const demands = new Map<string, number>();
  let budgetEffectCount = 0;
  let repaymentDemand = 0;

  for (const { effect } of proposals) {
    validateEffectAmount(effect);

    switch (effect.kind) {
      case 'delta':
        planDeltaDemand(demands, snapshot, effect);
        break;
      case 'transfer':
        planTransferDemand(demands, snapshot, effect);
        break;
      case 'repayDebt':
        addDemand(demands, snapshot, 'treasury', 'cash', effect.amount);
        repaymentDemand += effect.amount;
        break;
      case 'trade':
        planTradeDemand(demands, snapshot, effect);
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
  demands: Map<string, number>,
  account: Account,
  resource: Resource,
): number {
  const available = accountBalance(snapshot, account, resource);
  const requested = demands.get(demandKey(account, resource)) ?? 0;
  return Math.min(1, available / Math.max(1e-12, requested));
}

function settleDelta(
  deltas: Map<string, number>,
  snapshot: DeepReadonly<Model>,
  demands: Map<string, number>,
  effect: Extract<Effect, { kind: 'delta' }>,
): number {
  let actual = effect.amount;

  if (actual < 0 && ['food', 'materials', 'population'].includes(effect.field)) {
    actual *= demandScale(snapshot, demands, effect.cell, effect.field as Resource);
  }

  const key = `${effect.cell}:${effect.field}`;
  deltas.set(key, (deltas.get(key) ?? 0) + actual);
  return actual;
}

function settleTransfer(
  game: Game,
  snapshot: DeepReadonly<Model>,
  demands: Map<string, number>,
  effect: Extract<Effect, { kind: 'transfer' }>,
): number {
  const actual = effect.amount * demandScale(snapshot, demands, effect.from, effect.resource);

  moveResource(game.model, effect.from, effect.resource, -actual);
  moveResource(game.model, effect.to, effect.resource, actual);
  return actual;
}

function settleTrade(
  game: Game,
  snapshot: DeepReadonly<Model>,
  demands: Map<string, number>,
  effect: Extract<Effect, { kind: 'trade' }>,
): number {
  const sellerScale = demandScale(snapshot, demands, effect.from, effect.resource);
  const buyerScale = demandScale(snapshot, demands, effect.to, 'cash');
  const actual = effect.amount * Math.min(sellerScale, buyerScale);

  moveResource(game.model, effect.from, effect.resource, -actual);
  moveResource(game.model, effect.to, effect.resource, actual);
  moveResource(game.model, effect.to, 'cash', -actual * effect.price);
  moveResource(game.model, effect.from, 'cash', actual * effect.price);

  if (effect.resource === 'food') {
    game.model.cells[effect.from].foodTraded -= actual;
    game.model.cells[effect.to].foodTraded += actual;
  }

  return actual;
}

function settleBudget(game: Game, effect: Extract<Effect, { kind: 'budget' }>): void {
  game.model.budget = { ...effect.value };
  game.model.debt += effect.debtDelta;
}

function settleDebtRepayment(
  game: Game,
  snapshot: DeepReadonly<Model>,
  demands: Map<string, number>,
  effect: Extract<Effect, { kind: 'repayDebt' }>,
): number {
  const actual = effect.amount * demandScale(snapshot, demands, 'treasury', 'cash');
  moveResource(game.model, 'treasury', 'cash', -actual);
  moveResource(game.model, 'external', 'cash', actual);
  game.model.debt -= actual;
  return actual;
}

function recordEvent(
  game: Game,
  snapshot: DeepReadonly<Model>,
  rule: string,
  effect: Extract<Effect, { kind: 'event' }>,
  provenance: Record<string, string>,
): string {
  const causeId = recordCause(game, snapshot, rule, effect.evidence, 1, provenance);
  game.lastEvents[effect.key] = game.model.tick;
  game.articles.unshift({
    ...effect.article,
    id: `event-${causeId}`,
    tick: game.model.tick,
    causeIds: [causeId],
  });
  return causeId;
}

function recordEffectCause(
  game: Game,
  snapshot: DeepReadonly<Model>,
  rule: string,
  effect: Effect,
  actual: number,
  provenance: Record<string, string>,
): void {
  if (!('evidence' in effect) || !effect.evidence || Math.abs(actual) <= 1e-9) return;

  const causeId = recordCause(game, snapshot, rule, effect.evidence, Math.abs(actual), provenance);

  if (effect.kind === 'delta') {
    game.provenance[`${effect.cell}:${effect.field}`] = causeId;
  }

  if (effect.kind === 'transfer' || effect.kind === 'trade') {
    for (const cell of [effect.from, effect.to]) {
      if (typeof cell === 'number') {
        game.provenance[`${cell}:${effect.resource}`] = causeId;
      }
    }
  }
}

function linkEventDelta(
  game: Game,
  effect: Extract<Effect, { kind: 'delta' }>,
  eventIds: Map<string, string>,
): void {
  if (!effect.eventKey) return;

  const eventId = eventIds.get(effect.eventKey);
  if (!eventId) {
    throw new Error(`Missing event ${effect.eventKey}`);
  }

  game.provenance[`${effect.cell}:${effect.field}`] = eventId;
}

function applyAccumulatedDeltas(game: Game, deltas: Map<string, number>): void {
  for (const [key, amount] of deltas) {
    const [cellId, field] = key.split(':') as [string, MutableField];
    const cell = game.model.cells[Number(cellId)];
    const value = cell[field] + amount;

    if (BOUNDED_FIELDS.has(field)) {
      cell[field] = clamp(value);
    } else if (field === 'price' || field === 'scarcityPrice') {
      cell[field] = clamp(value, 0.4, 5);
    } else if (field === 'foodTraded') {
      cell[field] = value;
    } else {
      cell[field] = Math.max(0, value);
    }
  }
}

/** Resolve a whole phase against one immutable snapshot. Incoming goods cannot be spent in that phase. */
export function commitEffects(
  game: Game,
  snapshot: DeepReadonly<Model>,
  proposals: Proposal[],
): void {
  const provenance = { ...game.provenance };
  const eventIds = new Map<string, string>();
  const deltas = new Map<string, number>();
  const { demands } = planSettlement(snapshot, proposals);

  for (const { rule, effect } of proposals) {
    let actual = 0;

    switch (effect.kind) {
      case 'delta':
        actual = settleDelta(deltas, snapshot, demands, effect);
        break;
      case 'transfer':
        actual = settleTransfer(game, snapshot, demands, effect);
        break;
      case 'repayDebt':
        actual = settleDebtRepayment(game, snapshot, demands, effect);
        break;
      case 'trade':
        actual = settleTrade(game, snapshot, demands, effect);
        break;
      case 'budget':
        settleBudget(game, effect);
        break;
      case 'event': {
        const causeId = recordEvent(game, snapshot, rule, effect, provenance);
        eventIds.set(effect.key, causeId);
        break;
      }
    }

    if (effect.kind !== 'event') {
      recordEffectCause(game, snapshot, rule, effect, actual, provenance);
    }

    if (effect.kind === 'delta') {
      linkEventDelta(game, effect, eventIds);
    }
  }

  applyAccumulatedDeltas(game, deltas);
}

export function assertModel(model: DeepReadonly<Model>): void {
  const publicAccounts = [model.treasury, model.debt, model.externalCash];
  if (!publicAccounts.every(value => Number.isFinite(value) && value >= -1e-5)) {
    throw new Error('Invalid public accounts.');
  }

  for (const cell of model.cells) {
    for (const field of MUTABLE_FIELDS) {
      const value = cell[field];
      const belowMinimum = field !== 'foodTraded' && value < -1e-6;
      const aboveMaximum = BOUNDED_FIELDS.has(field) && value > 1 + 1e-6;

      if (!Number.isFinite(value) || belowMinimum || aboveMaximum) {
        throw new Error(`Invalid ${field} in mapxel ${cell.id}: ${value}`);
      }
    }

    if (cell.biome !== 'water') {
      const sectorTotal = SECTORS.reduce((sum, sector) => sum + cell[sector], 0);
      if (Math.abs(sectorTotal - 1) > 1e-6) {
        throw new Error(`Sector shares must sum to one: ${cell.id}`);
      }
    }

    if (cell.children + cell.seniors > 1) {
      throw new Error('Invalid demographics.');
    }

    if (cell.price < 0.4 || cell.price > 5 || cell.scarcityPrice < 0.4 || cell.scarcityPrice > 5) {
      throw new Error('Food prices must remain in the calibrated range.');
    }
    if (model.policy.laws.foodPriceControls && cell.price > 1 + 1e-6) {
      throw new Error('Posted food price exceeds the administered ceiling.');
    }
  }
}

function cloneGameForStep(game: Game): Game {
  return {
    ...game,
    model: structuredClone(game.model),
    causes: [...game.causes],
    articles: [...game.articles],
    history: [...game.history],
    provenance: { ...game.provenance },
    lastEvents: { ...game.lastEvents },
  };
}

function proposalsForPhase(
  game: Game,
  snapshot: DeepReadonly<Model>,
  rules: Rule[],
): Proposal[] {
  return rules.flatMap(rule => {
    const random = (cell: number, channel = '') => {
      return randomAt(snapshot.seed, snapshot.tick, rule.id, cell, channel);
    };

    const effects = rule.run({
      model: snapshot,
      random,
      lastEvents: Object.freeze({ ...game.lastEvents }),
    });

    return effects.map(effect => ({ rule: rule.id, effect }));
  });
}

function runPhase(game: Game, phase: Phase, orderedRules: Rule[]): void {
  const activeRules = orderedRules.filter(rule => rule.phase === phase);
  if (activeRules.length === 0) return;

  const snapshot = deepFreeze(structuredClone(game.model));
  const proposals = proposalsForPhase(game, snapshot, activeRules);

  commitEffects(game, snapshot, proposals);
  assertModel(game.model);
}

export function step(game: Game, rules: readonly Rule[] = defaultRules): Game {
  if (game.ended) return game;

  const orderedRules = orderRules(rules);
  const next = cloneGameForStep(game);
  next.model.tick += 1;

  for (const phase of PHASES) {
    runPhase(next, phase, orderedRules);
  }

  next.history.push({
    tick: next.model.tick,
    summary: summarize(next.model),
  });

  writeMonthlyNews(next);
  next.ended = next.model.tick >= next.model.mandate;
  return next;
}
