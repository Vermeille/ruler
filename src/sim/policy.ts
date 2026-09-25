import { clamp, summarize } from './math';
import {
  LAWS,
  SECTORS,
  SERVICES,
  type Action,
  type DeepReadonly,
  type Game,
  type Mapxel,
  type Model,
  type Scope,
  type Sector,
} from './types';
import { crowns, foodPrice, type Crowns } from './units';

const TAXES = ['incomeTax', 'businessTax'] as const;
const PROJECTS = ['transport', 'hospital', 'school', 'stadium'] as const;

const INVESTMENT_FIELD = {
  transport: 'infrastructure',
  hospital: 'health',
  school: 'education',
  stadium: 'sportsInterest',
} as const;

type InvestmentProject = keyof typeof INVESTMENT_FIELD;
type InvestmentField = typeof INVESTMENT_FIELD[InvestmentProject];

type BudgetForecast = {
  revenue: number;
  spending: number;
  interest: number;
  balance: number;
};

export type PolicyPreview = {
  actions: Action[];
  descriptions: string[];
  monthlyChange: number;
  upfront: number;
  warnings: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyFields(record: Record<string, unknown>, fields: string[]): void {
  const hasUnexpectedField = Object.keys(record).some(field => !fields.includes(field));
  const isMissingField = fields.some(field => !(field in record));

  if (hasUnexpectedField || isMissingField) {
    throw new Error(`Expected fields: ${fields.join(', ')}.`);
  }
}

function requireFiniteRange(value: unknown, minimum: number, maximum: number): void {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < minimum
    || value > maximum
  ) {
    throw new Error(`Value must be a finite number from ${minimum} to ${maximum}.`);
  }
}

function includes<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && values.includes(value as T[number]);
}

function isLandCell(model: DeepReadonly<Model>, id: unknown): id is number {
  return Number.isInteger(id)
    && Boolean(model.cells[Number(id)])
    && model.cells[Number(id)].biome !== 'water';
}

function validateScope(input: unknown, model: DeepReadonly<Model>): Scope {
  if (!isRecord(input)) {
    throw new Error('A scope is required.');
  }

  let scope: Scope;

  if (input.kind === 'national') {
    hasOnlyFields(input, ['kind']);
    scope = { kind: 'national' };
  } else if (input.kind === 'region') {
    hasOnlyFields(input, ['kind', 'id']);
    requireFiniteRange(input.id, 0, model.regions.length - 1);

    if (!Number.isInteger(input.id)) {
      throw new Error('Region ID must be an integer.');
    }

    scope = { kind: 'region', id: input.id as number };
  } else if (input.kind === 'cells') {
    hasOnlyFields(input, ['kind', 'ids']);

    if (
      !Array.isArray(input.ids)
      || input.ids.length === 0
      || input.ids.length > model.cells.length
      || input.ids.some(id => !isLandCell(model, id))
      || new Set(input.ids).size !== input.ids.length
    ) {
      throw new Error('Select distinct land mapxels.');
    }

    scope = { kind: 'cells', ids: input.ids as number[] };
  } else {
    throw new Error('Unknown scope.');
  }

  if (scopeCells(model, scope).length === 0) {
    throw new Error('The scope contains no land.');
  }

  return scope;
}

function validateTaxAction(input: Record<string, unknown>): void {
  hasOnlyFields(input, ['type', 'tax', 'rate']);

  if (!includes(TAXES, input.tax)) {
    throw new Error('Unknown tax.');
  }

  requireFiniteRange(input.rate, 0, 0.65);
}

function validateMinimumWageAction(input: Record<string, unknown>): void {
  hasOnlyFields(input, ['type', 'amount']);
  requireFiniteRange(input.amount, 0, 10);
}

function validateSpendingAction(input: Record<string, unknown>): void {
  hasOnlyFields(input, ['type', 'service', 'amount']);

  if (!includes(SERVICES, input.service)) {
    throw new Error('Unknown public service.');
  }

  requireFiniteRange(input.amount, 0, 2);
}

function validateSubsidyAction(input: Record<string, unknown>, model: DeepReadonly<Model>): void {
  hasOnlyFields(input, ['type', 'sector', 'amount', 'scope']);

  if (!includes(SECTORS, input.sector)) {
    throw new Error('Unknown sector.');
  }

  requireFiniteRange(input.amount, 0, 3);
  validateScope(input.scope, model);
}

function validateLawAction(input: Record<string, unknown>): void {
  hasOnlyFields(input, ['type', 'law', 'enabled']);

  if (!includes(LAWS, input.law) || typeof input.enabled !== 'boolean') {
    throw new Error('Unknown law or invalid boolean.');
  }
}

function validateInvestmentAction(input: Record<string, unknown>, model: DeepReadonly<Model>): void {
  hasOnlyFields(input, ['type', 'project', 'amount', 'scope']);

  if (!includes(PROJECTS, input.project)) {
    throw new Error('Unknown investment.');
  }

  requireFiniteRange(input.amount, 1, 1e9);
  validateScope(input.scope, model);
}

export function scopeCells(model: DeepReadonly<Model>, scope: DeepReadonly<Scope>): number[] {
  return model.cells
    .filter(cell => {
      if (cell.biome === 'water') return false;
      if (scope.kind === 'national') return true;
      if (scope.kind === 'region') return cell.region === scope.id;
      return scope.ids.includes(cell.id);
    })
    .map(cell => cell.id);
}

function scopeContainsCell(scope: DeepReadonly<Scope>, cell: DeepReadonly<Mapxel>): boolean {
  if (scope.kind === 'national') return true;
  if (scope.kind === 'region') return scope.id === cell.region;
  return scope.ids.includes(cell.id);
}

export function subsidyFor(
  model: DeepReadonly<Model>,
  cell: DeepReadonly<Mapxel>,
  sector: Sector,
): number {
  let amount = model.policy.subsidies[sector];

  for (const local of model.localSubsidies) {
    if (local.sector === sector && scopeContainsCell(local.scope, cell)) {
      amount = local.amount;
    }
  }

  return amount;
}

export function validateAction(input: unknown, model: DeepReadonly<Model>): Action {
  if (!isRecord(input)) {
    throw new Error('An action must be an object.');
  }

  switch (input.type) {
    case 'tax':
      validateTaxAction(input);
      break;
    case 'minimumWage':
      validateMinimumWageAction(input);
      break;
    case 'spending':
      validateSpendingAction(input);
      break;
    case 'subsidy':
      validateSubsidyAction(input, model);
      break;
    case 'law':
      validateLawAction(input);
      break;
    case 'invest':
      validateInvestmentAction(input, model);
      break;
    default:
      throw new Error('Unknown action type.');
  }

  return structuredClone(input) as Action;
}

function parseScope(words: string[], selected: number[]): Scope {
  const scopeMarker = words.indexOf('in');
  if (scopeMarker < 0) return { kind: 'national' };

  const scopeWords = words.splice(scopeMarker);

  if (scopeWords.length === 2 && scopeWords[1] === 'selected') {
    return { kind: 'cells', ids: [...selected].sort((a, b) => a - b) };
  }

  if (scopeWords.length === 3 && scopeWords[1] === 'region') {
    return { kind: 'region', id: Number(scopeWords[2]) };
  }

  if (scopeWords.length === 2 && scopeWords[1] === 'national') {
    return { kind: 'national' };
  }

  throw new Error('Use “in selected”, “in region 0”, or “in national”.');
}

function parseTax(target: string, value: string): unknown {
  const tax = target === 'income'
    ? 'incomeTax'
    : target === 'business'
      ? 'businessTax'
      : target;

  return { type: 'tax', tax, rate: Number(value) };
}

export function parseCommand(text: string, selected: number[] = []): unknown {
  const source = text.trim();

  if (source.startsWith('{') || source.startsWith('[')) {
    return JSON.parse(source);
  }

  const words = source.split(/\s+/);
  const hadExplicitScope = words.includes('in');
  const scope = parseScope(words, selected);

  if (words.length !== 3) {
    throw new Error('Expected a command, a target, and a value.');
  }

  const [verb, target, value] = words;

  if (hadExplicitScope && ['tax', 'spend', 'wage', 'law'].includes(verb)) {
    throw new Error('Taxes, public spending, wage floors, and laws apply nationally.');
  }

  switch (verb) {
    case 'tax':
      return parseTax(target, value);
    case 'wage':
      if (target === 'minimum') return { type: 'minimumWage', amount: Number(value) };
      break;
    case 'spend':
      return { type: 'spending', service: target, amount: Number(value) };
    case 'subsidize':
      return { type: 'subsidy', sector: target, amount: Number(value), scope };
    case 'invest':
      return { type: 'invest', project: target, amount: Number(value), scope };
    case 'law':
      if (value === 'on' || value === 'off') {
        return { type: 'law', law: target, enabled: value === 'on' };
      }
      break;
  }

  throw new Error('Unknown command. Try “tax income 0.22”.');
}

function describeScope(scope: Scope, model: DeepReadonly<Model>): string {
  if (scope.kind === 'national') return 'nationally';
  if (scope.kind === 'region') return `in ${model.regions[scope.id]}`;
  return `in ${scope.ids.length} selected mapxels`;
}

export function describeAction(action: Action, model: DeepReadonly<Model>): string {
  switch (action.type) {
    case 'tax': {
      const name = action.tax === 'incomeTax' ? 'income' : 'business';
      return `Set ${name} tax to ${(action.rate * 100).toFixed(0)}%`;
    }
    case 'spending':
      return `Fund ${action.service} at ₡${action.amount.toFixed(2)} per resident / month`;
    case 'minimumWage':
      return `Set the minimum wage to ₡${action.amount.toFixed(2)} per worker / month`;
    case 'subsidy':
      return `Set ${action.sector} subsidy to ₡${action.amount.toFixed(2)} per worker / month ${describeScope(action.scope, model)}`;
    case 'law': {
      const lawName = {
        cleanAir: 'the Clean Air Act',
        freeMovement: 'freedom of movement',
        publicAssembly: 'freedom of assembly',
        foodPriceControls: 'food price controls',
      }[action.law];
      return `${action.enabled ? 'Enact' : 'Repeal'} ${lawName}`;
    }
    case 'invest':
      return `Invest ₡${Math.round(action.amount).toLocaleString()} in ${action.project} ${describeScope(action.scope, model)}`;
  }
}

function monthlyPolicySpending(model: DeepReadonly<Model>, cell: DeepReadonly<Mapxel>): number {
  const publicServices = Object.values(model.policy.spending).reduce((sum, amount) => sum + amount, 0);
  const subsidies = SECTORS.reduce(
    (sum, sector) => sum + cell[sector] * subsidyFor(model, cell, sector),
    0,
  );

  return cell.population * (publicServices + subsidies);
}

function monthlyTaxRevenue(model: DeepReadonly<Model>, cell: DeepReadonly<Mapxel>): number {
  const effectiveRate = 0.7 * model.policy.incomeTax + 0.3 * model.policy.businessTax;
  return cell.output * effectiveRate;
}

export function forecastBudget(model: DeepReadonly<Model>): BudgetForecast {
  let revenue = 0;
  let spending = 0;

  for (const cell of model.cells) {
    if (cell.population <= 0) continue;
    revenue += monthlyTaxRevenue(model, cell);
    spending += monthlyPolicySpending(model, cell);
  }

  const interest = model.debt * 0.003;
  return {
    revenue,
    spending,
    interest,
    balance: revenue - spending - interest,
  };
}

function scopesEqual(a: Scope, b: Scope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'national' && b.kind === 'national') return true;
  if (a.kind === 'region' && b.kind === 'region') return a.id === b.id;
  if (a.kind === 'cells' && b.kind === 'cells') {
    return a.ids.length === b.ids.length && a.ids.every((id, index) => id === b.ids[index]);
  }
  return false;
}

function applySubsidy(model: Model, action: Extract<Action, { type: 'subsidy' }>, cause: string): void {
  if (action.scope.kind === 'national') {
    model.policy.subsidies[action.sector] = action.amount;
    model.localSubsidies = model.localSubsidies.filter(local => local.sector !== action.sector);
    return;
  }

  model.localSubsidies = model.localSubsidies.filter(local => {
    return local.sector !== action.sector || !scopesEqual(local.scope, action.scope);
  });
  model.localSubsidies.push({ ...action, cause });
}

function applyInvestment(model: Model, action: Extract<Action, { type: 'invest' }>): void {
  const cells = scopeCells(model, action.scope);
  const population = cells.reduce((sum, id) => sum + model.cells[id].population, 0);
  const field = INVESTMENT_FIELD[action.project];
  const divisor = action.project === 'stadium' ? 30 : 60;
  const improvement = action.amount / population / divisor;

  model.treasury = crowns(model.treasury - action.amount);
  model.externalCash = crowns(model.externalCash + action.amount);

  for (const id of cells) {
    model.cells[id][field] = clamp(model.cells[id][field] + improvement);
  }
}

function mutatePolicy(model: Model, action: Action, cause: string): void {
  switch (action.type) {
    case 'tax':
      model.policy[action.tax] = action.rate;
      break;
    case 'minimumWage':
      model.policy.minimumWage = action.amount;
      break;
    case 'spending':
      model.policy.spending[action.service] = action.amount;
      break;
    case 'law':
      model.policy.laws[action.law] = action.enabled;
      if (action.law === 'foodPriceControls' && action.enabled) {
        for (const cell of model.cells) cell.price = foodPrice(Math.min(cell.price, 1));
      }
      break;
    case 'subsidy':
      applySubsidy(model, action, cause);
      break;
    case 'invest':
      applyInvestment(model, action);
      break;
  }
}

function normalizeActionInput(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [input];
}

export function previewActions(game: Game, input: unknown): PolicyPreview {
  const rawActions = normalizeActionInput(input);

  if (rawActions.length === 0 || rawActions.length > 20) {
    throw new Error('Submit between 1 and 20 actions at a time.');
  }

  const trial = structuredClone(game.model);
  const balanceBefore = forecastBudget(trial).balance;
  const actions = rawActions.map(raw => validateAction(raw, trial));

  let upfront = 0;
  for (const action of actions) {
    if (action.type === 'invest') upfront += action.amount;
    mutatePolicy(trial, action, 'preview');
  }

  if (upfront > 0 && upfront > game.model.treasury) {
    throw new Error('Not enough treasury cash for this investment package.');
  }

  const after = forecastBudget(trial);
  const warnings = after.balance < 0
    ? ['This budget spends more than it raises. Reserves cover the gap first; borrowing has a limit.']
    : [];

  return {
    actions,
    descriptions: actions.map(action => describeAction(action, trial)),
    monthlyChange: after.balance - balanceBefore,
    upfront,
    warnings,
  };
}

function cloneGameForPolicyChange(game: Game): Game {
  return {
    ...game,
    model: structuredClone(game.model),
    causes: [...game.causes],
    articles: [...game.articles],
    actionLog: [...game.actionLog],
    provenance: { ...game.provenance },
  };
}

function investmentObservations(
  model: DeepReadonly<Model>,
  action: Action,
  cells: number[],
): { field?: InvestmentField; observations: { cell: number; field: InvestmentField; value: number; label: string }[] } {
  if (action.type !== 'invest') {
    return { observations: [] };
  }

  const field = INVESTMENT_FIELD[action.project];
  const observations = cells.map(cell => ({
    cell,
    field,
    value: model.cells[cell][field],
    label: 'Before investment',
  }));

  return { field, observations };
}

function updatePolicyProvenance(
  game: Game,
  action: Action,
  causeId: string,
  cells: number[],
  investmentField?: InvestmentField,
): void {
  switch (action.type) {
    case 'tax':
      game.provenance[`policy:${action.tax}`] = causeId;
      break;
    case 'minimumWage':
      game.provenance['policy:minimumWage'] = causeId;
      break;
    case 'spending':
      game.provenance[`policy:spending:${action.service}`] = causeId;
      break;
    case 'law':
      game.provenance[`policy:law:${action.law}`] = causeId;
      break;
    case 'subsidy':
      for (const cell of cells) {
        game.provenance[`${cell}:subsidy:${action.sector}`] = causeId;
      }
      break;
  }

  if (investmentField) {
    for (const cell of cells) {
      game.provenance[`${cell}:${investmentField}`] = causeId;
    }
  }
}

function recordGovernmentAction(game: Game, action: Action): void {
  const causeId = `a${game.actionLog.length}`;
  const title = describeAction(action, game.model);
  const cells = 'scope' in action ? scopeCells(game.model, action.scope) : [];
  const { field, observations } = investmentObservations(game.model, action, cells);

  mutatePolicy(game.model, action, causeId);

  game.causes.push({
    id: causeId,
    tick: game.model.tick,
    rule: 'government',
    title,
    detail: 'A decision made by your administration. Policy effects propagate through the economy in subsequent months.',
    cells,
    parents: [],
    observations,
    magnitude: 1,
  });

  game.actionLog.push({ tick: game.model.tick, action, causeId });
  updatePolicyProvenance(game, action, causeId, cells, field);

  game.articles.unshift({
    id: `news-${causeId}`,
    tick: game.model.tick,
    category: 'politics',
    headline: title,
    body: 'The cabinet has adopted the measure. The Ledger will follow its effects on households, businesses, and the public finances.',
    voice: 'The Commonwealth Ledger · Government desk',
    causeIds: [causeId],
    tone: 'neutral',
  });
}

export function enact(game: Game, input: unknown): Game {
  if (game.ended) {
    throw new Error('Your mandate has ended. Start a new country to govern again.');
  }

  const preview = previewActions(game, input);
  const next = cloneGameForPolicyChange(game);

  for (const action of preview.actions) {
    recordGovernmentAction(next, action);
  }

  return next;
}

export function debtLimit(model: DeepReadonly<Model>): Crowns {
  return crowns(summarize(model).population * 30);
}
