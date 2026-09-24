import { assertModel } from './engine';
import { MUTABLE_FIELDS, isMutableMapxelField, validMapxelFieldValue } from './map-fields';
import { validateAction } from './policy';
import { ARCHETYPE_MODEL_VERSION } from './population/archetypes';
import {
  POPULATION_STATE_FIELD_NAMES,
  POPULATION_STATE_FIELDS,
  POPULATION_TRANSITION_FIELDS,
  validPopulationStateValue,
} from './population/fields';
import { generatePopulation } from './population/generate';
import {
  LAWS,
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
const POPULATION_OBSERVATION_FIELDS = new Set<string>([
  'count',
  'employed',
  ...POPULATION_STATE_FIELD_NAMES,
]);

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

function clampValue(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function parseSave(text: string): Record<string, unknown> {
  let data: unknown;

  try {
    data = JSON.parse(text);
  } catch {
    return fail();
  }

  if (!isRecord(data) || typeof data.version !== 'number'
    || ![1, 2, 3, 4, 5].includes(data.version) || !isRecord(data.model)) {
    return fail();
  }

  return data;
}

function scopeContainsLegacyCell(scope: unknown, cell: Record<string, unknown>): boolean {
  if (!isRecord(scope)) return false;
  if (scope.kind === 'national') return true;
  if (scope.kind === 'region') return scope.id === cell.region;
  return scope.kind === 'cells'
    && Array.isArray(scope.ids)
    && scope.ids.includes(cell.id);
}

function legacySubsidySignature(
  model: Record<string, unknown>,
  cell: Record<string, unknown>,
): number {
  if (!isRecord(model.policy) || !isRecord(model.policy.subsidies)) return 0;
  const amounts = new Map<string, number>();
  for (const sector of SECTORS) {
    const value = model.policy.subsidies[sector];
    amounts.set(sector, isFiniteNumber(value) ? value : 0);
  }
  if (Array.isArray(model.localSubsidies)) {
    for (const local of model.localSubsidies) {
      if (!isRecord(local)
        || typeof local.sector !== 'string'
        || !SECTORS.includes(local.sector as typeof SECTORS[number])
        || !isFiniteNumber(local.amount)
        || !scopeContainsLegacyCell(local.scope, cell)) continue;
      amounts.set(local.sector, local.amount);
    }
  }
  return clampValue(SECTORS.reduce((sum, sector) => sum + (amounts.get(sector) ?? 0), 0)
    / (SECTORS.length * 3));
}

function migrateVersionFour(model: Record<string, unknown>): void {
  if (!Array.isArray(model.cells) || !Array.isArray(model.populationGroups)
    || !isRecord(model.policy) || !isRecord(model.policy.spending)
    || !isRecord(model.policy.laws) || !isRecord(model.budget)) return fail();

  const tax = clampValue((Number(model.policy.incomeTax) + Number(model.policy.businessTax)) / 1.3);
  const spending = clampValue(SERVICES.reduce((sum, service) => {
    const value = model.policy.spending[service];
    return sum + (isFiniteNumber(value) ? value : 0);
  }, 0) / 14);
  const wage = clampValue(Number(model.policy.minimumWage) / 10);
  const rights = LAWS.reduce((sum, law) => sum + (model.policy.laws[law] === true ? 1 : 0), 0) / 4;
  const funding = isFiniteNumber(model.budget.funding) ? model.budget.funding : 1;
  const healthSpending = isFiniteNumber(model.policy.spending.health) ? model.policy.spending.health : 0;
  const educationSpending = isFiniteNumber(model.policy.spending.education) ? model.policy.spending.education : 0;

  for (const groups of model.populationGroups) {
    if (!Array.isArray(groups)) return fail();
    for (const group of groups) {
      if (!isRecord(group)) return fail();
      if (!isFiniteNumber(group.outlook)) group.outlook = 0;
      if (!isFiniteNumber(group.mobilization)) group.mobilization = 0;
      if (!isFiniteNumber(group.infection)) group.infection = 0.006;
      if (!isFiniteNumber(group.salienceFood)) group.salienceFood = 1;
      if (!isFiniteNumber(group.salienceHealth)) group.salienceHealth = 1;
      if (!isFiniteNumber(group.salienceSafety)) group.salienceSafety = 1;
      if (!isFiniteNumber(group.salienceEducation)) group.salienceEducation = 1;
    }
  }

  for (const cell of model.cells) {
    if (!isRecord(cell) || !isFiniteNumber(cell.population)) return fail();
    const population = cell.population;
    const childShare = isFiniteNumber(cell.children) ? cell.children : 0.21;
    if (!isFiniteNumber(cell.healthCapacity)) {
      cell.healthCapacity = population * clampValue(0.58 + healthSpending * funding, 0.45, 1.35);
    }
    if (!isFiniteNumber(cell.educationCapacity)) {
      cell.educationCapacity = population * clampValue(
        childShare * (0.72 + educationSpending * funding * 1.35) + 0.035,
        0.04,
        0.6,
      );
    }
    if (!isFiniteNumber(cell.healthDisruption)) cell.healthDisruption = 0;
    if (!isFiniteNumber(cell.educationDisruption)) cell.educationDisruption = 0;
    if (!isFiniteNumber(cell.infrastructureDisruption)) cell.infrastructureDisruption = 0;
    if (!isFiniteNumber(cell.unrest)) cell.unrest = 0;
    if (!isFiniteNumber(cell.infection)) cell.infection = 0.006;
    if (!isFiniteNumber(cell.policyAdjustment)) cell.policyAdjustment = 0;
    if (!isFiniteNumber(cell.policyTaxBaseline)) cell.policyTaxBaseline = tax;
    if (!isFiniteNumber(cell.policySpendingBaseline)) cell.policySpendingBaseline = spending;
    if (!isFiniteNumber(cell.policyWageBaseline)) cell.policyWageBaseline = wage;
    if (!isFiniteNumber(cell.policyRightsBaseline)) cell.policyRightsBaseline = rights;
    if (!isFiniteNumber(cell.policySubsidyBaseline)) {
      cell.policySubsidyBaseline = legacySubsidySignature(model, cell);
    }
  }
}

function migrateSave(data: Record<string, unknown>): void {
  const model = data.model as Record<string, unknown>;
  if (!isRecord(model.policy)) return fail();

  if (data.version === 1) {
    if (!Array.isArray(model.cells)) return fail();
    for (const cell of model.cells) {
      if (!isRecord(cell) || !isFiniteNumber(cell.price)) return fail();
      cell.waterStress = 0;
      cell.starvationDeaths = 0;
      cell.scarcityPrice = cell.price;
    }
    if (!isRecord(data.initial) || !Array.isArray(data.history) || !isRecord(model.policy.laws)) return fail();
    data.initial.starvationDeaths = 0;
    for (const entry of data.history) {
      if (!isRecord(entry) || !isRecord(entry.summary)) return fail();
      entry.summary.starvationDeaths = 0;
    }
    model.policy.laws.foodPriceControls = false;
    data.version = 2;
  }

  if (data.version === 2) {
    if ('minimumWage' in model.policy) return fail();
    model.policy.minimumWage = 0;
    data.version = 3;
  }

  if (data.version === 3) {
    if (!Array.isArray(model.cells) || !isSafeString(model.seed)) return fail();
    const generated = generatePopulation(model.seed, model.cells as Mapxel[]);
    model.populationGroups = generated.groups;
    model.nextPopulationGroupId = generated.nextId;
    model.archetypeModelVersion = ARCHETYPE_MODEL_VERSION;
    data.version = 4;
  }

  if (data.version === 4) {
    migrateVersionFour(model);
    data.version = 5;
  }
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
    const fieldName = String(field);
    if (isMutableMapxelField(fieldName)) {
      if (!validMapxelFieldValue(fieldName, saved[field], 1e-6)) return fail();
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

function validatePopulation(model: Record<string, unknown>, original: Game): void {
  if (model.archetypeModelVersion !== ARCHETYPE_MODEL_VERSION
    || !Number.isSafeInteger(model.nextPopulationGroupId)
    || !Array.isArray(model.populationGroups)
    || model.populationGroups.length !== original.model.cells.length) return fail();
  let count = 0;
  for (const cellGroups of model.populationGroups) {
    if (!Array.isArray(cellGroups)) return fail();
    count += cellGroups.length;
    if (count > 2_000_000) return fail();
    for (const group of cellGroups) {
      if (!isRecord(group) || !isRecord(group.attitudes)) return fail();
      const invalidState = POPULATION_STATE_FIELD_NAMES.some(field => {
        const spec = POPULATION_STATE_FIELDS[field];
        const value = spec.storage === 'attitudes'
          ? (group.attitudes as Record<string, unknown>)[field]
          : group[field];
        return !validPopulationStateValue(field, value, 1e-9);
      });
      if (!Number.isSafeInteger(group.id)
        || !Number.isInteger(group.archetype)
        || !isFiniteNumber(group.count)
        || invalidState
        || !POPULATION_TRANSITION_FIELDS.employed.valid(group.employed)
        || !POPULATION_TRANSITION_FIELDS.lifeStage.valid(group.lifeStage)
        || !POPULATION_TRANSITION_FIELDS.occupation.valid(group.occupation)) return fail();
    }
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

    validateAction({ type: 'minimumWage', amount: policy.minimumWage }, game.model);

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
  nextGroupId: number,
): void {
  if (
    !isRecord(observation)
    || (observation.cell !== undefined && !isCell(observation.cell))
    || (observation.group === undefined
      ? !MUTABLE_FIELDS.includes(observation.field as never)
      : (!Number.isSafeInteger(observation.group)
        || !isCell(observation.cell)
        || Number(observation.group) < 1
        || Number(observation.group) >= nextGroupId
        || !POPULATION_OBSERVATION_FIELDS.has(String(observation.field))))
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
  nextGroupId: number,
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
      validateObservation(observation, isCell, nextGroupId);
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
    && keys.every(key => isFiniteNumber(value[key]) && Number(value[key]) >= -1e-6);
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
  migrateSave(data);
  const model = data.model as Record<string, unknown>;
  const original = validateWorldIdentity(model);

  validateTimeline(data, model);
  validateWorldTopology(model, original);
  validateCells(model, original);
  validatePopulation(model, original);

  const game = data as unknown as Game;
  validatePolicy(model, game);
  validateCollections(data, model);

  const isCell = cellValidator(game);
  const isTick = tickValidator(Number(model.tick));
  const knownCauseIds = validateCauses(data.causes as unknown[], isCell, isTick,
    Number(model.nextPopulationGroupId));

  validateArticles(data.articles as unknown[], knownCauseIds, isCell, isTick);
  validateActionLog(data.actionLog as unknown[], game, knownCauseIds, isTick);
  validateLocalSubsidies(model.localSubsidies as unknown[], game, knownCauseIds);
  validateReferences(data, knownCauseIds, isTick);
  validateHistory(data, original);

  return game;
}
