import { assertModel } from './engine';
import { validateAction } from './policy';
import {
  LAWS,
  MUTABLE_FIELDS,
  SECTORS,
  SERVICES,
  type Game,
  type Mapxel,
} from './types';
import { createGame } from './world';

const MAX_SAVE_BYTES = 40_000_000;
const MAX_TEXT_LENGTH = 20_000;
const MAX_CAUSES = 150_000;
const MAX_ARTICLES = 10_000;
const MAX_ACTIONS = 10_000;
const SAVE_ERROR = 'This save is incomplete, corrupted, or from an unsupported version.';

function fail(): never {
  throw new Error(SAVE_ERROR);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSafeString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT_LENGTH;
}

function parseSave(text: string): Record<string, unknown> {
  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    return fail();
  }

  if (!isRecord(data) || data.version !== 1 || !isRecord(data.model)) {
    return fail();
  }

  return data;
}

function validateWorldIdentity(model: Record<string, unknown>): Game {
  if (
    !isSafeString(model.seed)
    || !isFiniteNumber(model.width)
    || !isFiniteNumber(model.height)
    || !isFiniteNumber(model.mandate)
  ) {
    return fail();
  }

  return createGame(model.seed, model.width, model.height, model.mandate);
}

function validateTimeline(
  data: Record<string, unknown>,
  model: Record<string, unknown>,
): void {
  if (
    !Number.isInteger(model.tick)
    || Number(model.tick) < 0
    || Number(model.tick) > Number(model.mandate)
    || data.ended !== (model.tick === model.mandate)
  ) {
    return fail();
  }
}

function validateWorldTopology(model: Record<string, unknown>, original: Game): void {
  if (
    !Array.isArray(model.cells)
    || model.cells.length !== original.model.cells.length
    || JSON.stringify(model.neighbors) !== JSON.stringify(original.model.neighbors)
    || JSON.stringify(model.regions) !== JSON.stringify(original.model.regions)
  ) {
    return fail();
  }
}

function validateCell(saved: unknown, base: Mapxel): void {
  if (!isRecord(saved)) return fail();

  for (const field of Object.keys(base) as (keyof Mapxel)[]) {
    if (MUTABLE_FIELDS.includes(field as never)) {
      if (!isFiniteNumber(saved[field])) return fail();
    } else if (saved[field] !== base[field]) {
      return fail();
    }
  }

  if (
    saved.biome === 'water'
    && (saved.population !== 0 || saved.cash !== 0 || saved.food !== 0 || saved.materials !== 0)
  ) {
    return fail();
  }
}

function validateCells(model: Record<string, unknown>, original: Game): void {
  const cells = model.cells as unknown[];
  for (let index = 0; index < cells.length; index += 1) {
    validateCell(cells[index], original.model.cells[index]);
  }
}

function requirePolicyRecords(model: Record<string, unknown>): {
  policy: Record<string, unknown>;
  spending: Record<string, unknown>;
  subsidies: Record<string, unknown>;
  laws: Record<string, unknown>;
  budget: Record<string, unknown>;
} {
  if (!isRecord(model.policy) || !isRecord(model.budget)) return fail();

  const policy = model.policy;
  if (
    !isRecord(policy.spending)
    || !isRecord(policy.subsidies)
    || !isRecord(policy.laws)
  ) {
    return fail();
  }

  return {
    policy,
    spending: policy.spending,
    subsidies: policy.subsidies,
    laws: policy.laws,
    budget: model.budget,
  };
}

function validateBudget(budget: Record<string, unknown>): void {
  for (const key of ['revenue', 'spending', 'interest', 'borrowed', 'funding']) {
    if (!isFiniteNumber(budget[key]) || Number(budget[key]) < 0) {
      return fail();
    }
  }

  if (Number(budget.funding) > 1) return fail();
}

function validatePolicy(model: Record<string, unknown>, game: Game): void {
  const { policy, spending, subsidies, laws, budget } = requirePolicyRecords(model);
  validateBudget(budget);

  try {
    for (const tax of ['incomeTax', 'businessTax'] as const) {
      validateAction({ type: 'tax', tax, rate: policy[tax] }, game.model);
    }

    for (const service of SERVICES) {
      validateAction({ type: 'spending', service, amount: spending[service] }, game.model);
    }

    for (const sector of SECTORS) {
      validateAction({
        type: 'subsidy',
        sector,
        amount: subsidies[sector],
        scope: { kind: 'national' },
      }, game.model);
    }

    for (const law of LAWS) {
      validateAction({ type: 'law', law, enabled: laws[law] }, game.model);
    }

    assertModel(game.model);
  } catch {
    return fail();
  }
}

function validateCollections(data: Record<string, unknown>, model: Record<string, unknown>): void {
  if (
    !Array.isArray(data.causes)
    || data.causes.length > MAX_CAUSES
    || !Array.isArray(data.articles)
    || data.articles.length > MAX_ARTICLES
    || !Array.isArray(data.history)
    || data.history.length !== Number(model.tick) + 1
    || !Array.isArray(data.actionLog)
    || data.actionLog.length > MAX_ACTIONS
    || !Array.isArray(model.localSubsidies)
    || !isRecord(data.provenance)
    || !isRecord(data.lastEvents)
  ) {
    return fail();
  }
}

function cellValidator(game: Game): (id: unknown) => boolean {
  return id => Number.isInteger(id)
    && Number(id) >= 0
    && Number(id) < game.model.cells.length
    && game.model.cells[Number(id)].biome !== 'water';
}

function tickValidator(currentTick: number): (tick: unknown) => boolean {
  return tick => Number.isInteger(tick)
    && Number(tick) >= 0
    && Number(tick) <= currentTick;
}

function validateObservation(
  observation: unknown,
  isCell: (id: unknown) => boolean,
): void {
  if (
    !isRecord(observation)
    || (observation.cell !== undefined && !isCell(observation.cell))
    || !MUTABLE_FIELDS.includes(observation.field as never)
    || !isFiniteNumber(observation.value)
    || !isSafeString(observation.label)
  ) {
    return fail();
  }
}

function validateCauses(
  causes: unknown[],
  isCell: (id: unknown) => boolean,
  isTick: (tick: unknown) => boolean,
): Set<string> {
  const knownIds = new Set<string>();

  for (const cause of causes) {
    if (
      !isRecord(cause)
      || !isSafeString(cause.id)
      || knownIds.has(cause.id)
      || !isTick(cause.tick)
      || !isSafeString(cause.rule)
      || !isSafeString(cause.title)
      || !isSafeString(cause.detail)
      || !isFiniteNumber(cause.magnitude)
      || !Array.isArray(cause.cells)
      || !cause.cells.every(isCell)
      || !Array.isArray(cause.parents)
      || !cause.parents.every(parent => typeof parent === 'string' && knownIds.has(parent))
      || !Array.isArray(cause.observations)
    ) {
      return fail();
    }

    for (const observation of cause.observations) {
      validateObservation(observation, isCell);
    }

    knownIds.add(cause.id);
  }

  return knownIds;
}

function validateArticles(
  articles: unknown[],
  knownCauseIds: Set<string>,
  isCell: (id: unknown) => boolean,
  isTick: (tick: unknown) => boolean,
): void {
  const categories = ['dispatch', 'economy', 'politics', 'culture', 'briefing'];
  const tones = ['good', 'bad', 'neutral'];

  for (const article of articles) {
    if (
      !isRecord(article)
      || !isSafeString(article.id)
      || !isTick(article.tick)
      || !categories.includes(String(article.category))
      || !tones.includes(String(article.tone))
      || !isSafeString(article.headline)
      || !isSafeString(article.body)
      || !isSafeString(article.voice)
      || (article.cell !== undefined && !isCell(article.cell))
      || !Array.isArray(article.causeIds)
      || !article.causeIds.every(id => knownCauseIds.has(String(id)))
    ) {
      return fail();
    }
  }
}

function validateActionLog(
  actionLog: unknown[],
  game: Game,
  knownCauseIds: Set<string>,
  isTick: (tick: unknown) => boolean,
): void {
  for (const entry of actionLog) {
    if (
      !isRecord(entry)
      || !isTick(entry.tick)
      || !knownCauseIds.has(String(entry.causeId))
    ) {
      return fail();
    }

    try {
      validateAction(entry.action, game.model);
    } catch {
      return fail();
    }
  }
}

function validateLocalSubsidies(
  localSubsidies: unknown[],
  game: Game,
  knownCauseIds: Set<string>,
): void {
  for (const subsidy of localSubsidies) {
    if (!isRecord(subsidy) || !knownCauseIds.has(String(subsidy.cause))) {
      return fail();
    }

    try {
      validateAction({
        type: 'subsidy',
        sector: subsidy.sector,
        amount: subsidy.amount,
        scope: subsidy.scope,
      }, game.model);
    } catch {
      return fail();
    }
  }
}

function validateReferences(
  data: Record<string, unknown>,
  knownCauseIds: Set<string>,
  isTick: (tick: unknown) => boolean,
): void {
  const provenance = data.provenance as Record<string, unknown>;
  const lastEvents = data.lastEvents as Record<string, unknown>;

  for (const causeId of Object.values(provenance)) {
    if (!knownCauseIds.has(String(causeId))) return fail();
  }

  for (const tick of Object.values(lastEvents)) {
    if (!isTick(tick)) return fail();
  }
}

function summaryValidator(original: Game): (value: unknown) => boolean {
  const keys = Object.keys(original.initial);
  return value => isRecord(value)
    && keys.every(key => isFiniteNumber(value[key]) && Number(value[key]) >= 0);
}

function validateHistory(data: Record<string, unknown>, original: Game): void {
  const isSummary = summaryValidator(original);

  if (!isSummary(data.initial)) return fail();

  const history = data.history as unknown[];
  for (let index = 0; index < history.length; index += 1) {
    const entry = history[index];
    if (!isRecord(entry) || entry.tick !== index || !isSummary(entry.summary)) {
      return fail();
    }
  }
}

export function serialize(game: Game): string {
  return JSON.stringify(game);
}

export function deserialize(text: string): Game {
  if (text.length > MAX_SAVE_BYTES) {
    throw new Error('Save file is too large (40 MB maximum).');
  }

  const data = parseSave(text);
  const model = data.model as Record<string, unknown>;
  const original = validateWorldIdentity(model);

  validateTimeline(data, model);
  validateWorldTopology(model, original);
  validateCells(model, original);

  const game = data as unknown as Game;
  validatePolicy(model, game);
  validateCollections(data, model);

  const isCell = cellValidator(game);
  const isTick = tickValidator(Number(model.tick));
  const knownCauseIds = validateCauses(data.causes as unknown[], isCell, isTick);

  validateArticles(data.articles as unknown[], knownCauseIds, isCell, isTick);
  validateActionLog(data.actionLog as unknown[], game, knownCauseIds, isTick);
  validateLocalSubsidies(model.localSubsidies as unknown[], game, knownCauseIds);
  validateReferences(data, knownCauseIds, isTick);
  validateHistory(data, original);

  return game;
}
