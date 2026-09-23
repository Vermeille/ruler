import { deepFreeze, randomAt } from '../sim/math';
import { defaultRules } from '../sim/rules';
import { traceStep, type PhaseTrace } from '../sim/trace';
import {
  MUTABLE_FIELDS,
  type Account,
  type DeepReadonly,
  type Effect,
  type Game,
  type Model,
  type MutableField,
  type Rule,
} from '../sim/types';

export interface InputGroup {
  key: string;
  label: string;
  category: InputCategory;
  reads: number;
  analyzed: number;
  importance: number;
  example: string;
}

export interface OutputGroup {
  key: string;
  label: string;
  effects: number;
  magnitude: number;
}

export interface JacobianCell {
  key: string;
  inputKey: string;
  outputKey: string;
  strength: number;
  response: number;
  derivative: number;
  sign: 'positive' | 'negative' | 'mixed' | 'none';
  example: string;
  nudge: string;
}

export interface FootprintCell {
  id: number;
  score: number;
  outputKeys: string[];
}

export interface FootprintFlow {
  key: string;
  from: number;
  to: number;
  outputKey: string;
  label: string;
  amount: number;
  score: number;
}

export interface StateImpact {
  label: string;
  relative: number;
  absolute: number;
}

export interface DownstreamStage {
  key: string;
  month: 'this month' | 'next month';
  phase: string;
  changedCells: number;
  impacts: StateImpact[];
  magnitude: number;
}

export interface RuleAnalysis {
  ruleId: string;
  description: string;
  phase: string;
  inputs: InputGroup[];
  structuralInputs: InputGroup[];
  outputs: OutputGroup[];
  jacobian: JacobianCell[];
  footprintCells: FootprintCell[];
  footprintFlows: FootprintFlow[];
  downstream: DownstreamStage[];
  analyzedReads: number;
  totalReads: number;
}

type Scalar = string | number | boolean;
type InputCategory = 'cell' | 'policy' | 'budget' | 'global' | 'random' | 'event' | 'structure';
type InputSource = 'model' | 'lastEvents' | 'random';

interface ConcreteInput {
  key: string;
  source: InputSource;
  path: string;
  groupKey: string;
  groupLabel: string;
  category: InputCategory;
  value: Scalar;
  cell?: number;
  perturbable: boolean;
  example: string;
}

interface Perturbation {
  value: number | boolean;
  delta: number;
  label: string;
}

interface VectorChannel {
  key: string;
  groupKey: string;
  groupLabel: string;
  value: number;
}

interface OutputDifference {
  absolute: number;
  signed: number;
}

interface ConcreteResponse {
  input: ConcreteInput;
  perturbation: Perturbation;
  byOutput: Map<string, OutputDifference>;
}

const CELL_STRUCTURAL_FIELDS = new Set(['id', 'x', 'y', 'region', 'name', 'biome']);
const NORMALIZED_FIELDS = new Set<string>([
  'elevation',
  'fertility',
  'minerals',
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
  'agriculture',
  'manufacturing',
  'services',
  'sports',
  'businessHealth',
  'funding',
  'incomeTax',
  'businessTax',
]);
const MAX_INPUTS_PER_GROUP = 5;
const MAX_ANALYZED_INPUTS = 72;
const MAX_INPUT_GROUPS = 14;
const MAX_OUTPUT_GROUPS = 10;

function words(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function accountLabel(account: Account): string {
  return typeof account === 'number' ? `cell ${account}` : account;
}

function classifyModelRead(
  path: string,
  value: Scalar,
  model: DeepReadonly<Model>,
): Omit<ConcreteInput, 'key' | 'source' | 'path' | 'value'> {
  const cellMatch = /^cells\.(\d+)\.([^.]+)$/.exec(path);
  if (cellMatch) {
    const cell = Number(cellMatch[1]);
    const field = cellMatch[2];
    const structural = CELL_STRUCTURAL_FIELDS.has(field);
    return {
      groupKey: `cell.${field}`,
      groupLabel: structural ? `Cell ${words(field)} (structure)` : `Cell ${words(field)}`,
      category: structural ? 'structure' : 'cell',
      cell,
      perturbable: !structural && (typeof value === 'number' || typeof value === 'boolean'),
      example: `${model.cells[cell]?.name ?? `cell ${cell}`} · ${field}`,
    };
  }

  if (path.startsWith('policy.')) {
    const key = path.slice('policy.'.length);
    return {
      groupKey: `policy.${key}`,
      groupLabel: `Policy · ${words(key)}`,
      category: 'policy',
      perturbable: typeof value === 'number' || typeof value === 'boolean',
      example: `policy.${key}`,
    };
  }

  if (path.startsWith('budget.')) {
    const key = path.slice('budget.'.length);
    return {
      groupKey: `budget.${key}`,
      groupLabel: `Budget · ${words(key)}`,
      category: 'budget',
      perturbable: typeof value === 'number',
      example: `budget.${key}`,
    };
  }

  const subsidyAmount = /^localSubsidies\.(\d+)\.amount$/.exec(path);
  if (subsidyAmount) {
    return {
      groupKey: 'localSubsidy.amount',
      groupLabel: 'Local Subsidy · Amount',
      category: 'policy',
      perturbable: typeof value === 'number',
      example: `local subsidy ${Number(subsidyAmount[1]) + 1} amount`,
    };
  }

  if (path === 'treasury' || path === 'debt' || path === 'externalCash') {
    return {
      groupKey: `global.${path}`,
      groupLabel: words(path),
      category: 'global',
      perturbable: typeof value === 'number',
      example: path,
    };
  }

  const structural = path === 'seed'
    || path === 'width'
    || path === 'height'
    || path === 'tick'
    || path === 'mandate'
    || path.startsWith('neighbors.')
    || path.startsWith('regions.')
    || path.endsWith('.length')
    || path.includes('.scope.')
    || path.endsWith('.sector');

  return {
    groupKey: structural ? `structure.${path.split('.')[0]}` : `global.${path}`,
    groupLabel: structural ? `${words(path.split('.')[0])} (structure)` : words(path),
    category: structural ? 'structure' : 'global',
    perturbable: !structural && (typeof value === 'number' || typeof value === 'boolean'),
    example: path,
  };
}

function recordPrimitive(
  reads: Map<string, ConcreteInput>,
  source: InputSource,
  path: string,
  value: Scalar,
  model: DeepReadonly<Model>,
): void {
  const key = `${source}:${path}`;
  if (reads.has(key)) return;

  if (source === 'lastEvents') {
    reads.set(key, {
      key,
      source,
      path,
      value,
      groupKey: `lastEvent.${path}`,
      groupLabel: `Last Event · ${words(path)}`,
      category: 'event',
      perturbable: typeof value === 'number',
      example: `lastEvents.${path}`,
    });
    return;
  }

  const classified = classifyModelRead(path, value, model);
  reads.set(key, { key, source, path, value, ...classified });
}

function trackedObject<T extends object>(
  value: T,
  prefix: string,
  source: Exclude<InputSource, 'random'>,
  reads: Map<string, ConcreteInput>,
  model: DeepReadonly<Model>,
): T {
  return new Proxy(value, {
    get(target, property, receiver) {
      const result = Reflect.get(target, property, receiver) as unknown;
      if (typeof property === 'symbol') return result;
      const path = prefix ? `${prefix}.${String(property)}` : String(property);

      if (result !== null && typeof result === 'object') {
        return trackedObject(
          result as object,
          path,
          source,
          reads,
          model,
        );
      }

      if (typeof result === 'number' || typeof result === 'boolean' || typeof result === 'string') {
        recordPrimitive(reads, source, path, result, model);
      }

      return result;
    },
    set() {
      throw new Error('Rules must not mutate their read snapshot');
    },
    deleteProperty() {
      throw new Error('Rules must not mutate their read snapshot');
    },
  }) as T;
}

function runTrackedRule(
  game: Game,
  phase: PhaseTrace,
  rule: Rule,
): { effects: Effect[]; reads: ConcreteInput[] } {
  const reads = new Map<string, ConcreteInput>();
  const model = deepFreeze(structuredClone(phase.before));
  const trackedModel = trackedObject(model, '', 'model', reads, model);
  const trackedEvents = trackedObject(
    Object.freeze({ ...game.lastEvents }),
    '',
    'lastEvents',
    reads,
    model,
  );

  const random = (cell: number, channel = '') => {
    const path = `${cell}:${channel || 'default'}`;
    const value = randomAt(model.seed, model.tick, rule.id, cell, channel);
    const key = `random:${path}`;
    if (!reads.has(key)) {
      reads.set(key, {
        key,
        source: 'random',
        path,
        value,
        groupKey: `random.${channel || 'default'}`,
        groupLabel: `Random · ${words(channel || 'default')}`,
        category: 'random',
        cell,
        perturbable: true,
        example: `${model.cells[cell]?.name ?? `cell ${cell}`} · random(${channel || 'default'})`,
      });
    }
    return value;
  };

  return {
    effects: rule.run({
      model: trackedModel,
      random,
      lastEvents: trackedEvents,
    }),
    reads: [...reads.values()],
  };
}

function outputChannels(effects: readonly Effect[]): VectorChannel[] {
  const channels: VectorChannel[] = [];

  for (const effect of effects) {
    switch (effect.kind) {
      case 'delta':
        channels.push({
          key: `delta:${effect.cell}:${effect.field}`,
          groupKey: `delta.${effect.field}`,
          groupLabel: `Δ ${words(effect.field)}`,
          value: effect.amount,
        });
        break;
      case 'transfer':
        channels.push({
          key: `transfer:${effect.from}:${effect.to}:${effect.resource}`,
          groupKey: `transfer.${effect.resource}`,
          groupLabel: `${words(effect.resource)} Flow`,
          value: effect.amount,
        });
        break;
      case 'trade':
        channels.push({
          key: `trade:${effect.from}:${effect.to}:${effect.resource}:amount`,
          groupKey: `trade.${effect.resource}.amount`,
          groupLabel: `${words(effect.resource)} Trade`,
          value: effect.amount,
        });
        channels.push({
          key: `trade:${effect.from}:${effect.to}:${effect.resource}:price`,
          groupKey: `trade.${effect.resource}.price`,
          groupLabel: `${words(effect.resource)} Trade Price`,
          value: effect.price,
        });
        break;
      case 'budget':
        channels.push({
          key: 'budget:debtDelta',
          groupKey: 'budget.debtDelta',
          groupLabel: 'Debt Change',
          value: effect.debtDelta,
        });
        for (const [field, value] of Object.entries(effect.value)) {
          channels.push({
            key: `budget:${field}`,
            groupKey: `budget.${field}`,
            groupLabel: `Budget · ${words(field)}`,
            value,
          });
        }
        break;
      case 'event':
        channels.push({
          key: `event:${effect.key}`,
          groupKey: `event.${effect.key}`,
          groupLabel: `Event · ${words(effect.key)}`,
          value: 1,
        });
        break;
    }
  }

  return channels;
}

function channelMap(effects: readonly Effect[]): Map<string, VectorChannel> {
  const result = new Map<string, VectorChannel>();
  for (const channel of outputChannels(effects)) {
    const current = result.get(channel.key);
    if (current) current.value += channel.value;
    else result.set(channel.key, { ...channel });
  }
  return result;
}

function outputDifferences(
  baseline: readonly Effect[],
  changed: readonly Effect[],
): Map<string, OutputDifference> {
  const before = channelMap(baseline);
  const after = channelMap(changed);
  const keys = new Set([...before.keys(), ...after.keys()]);
  const byGroup = new Map<string, OutputDifference>();

  for (const key of keys) {
    const baselineChannel = before.get(key);
    const changedChannel = after.get(key);
    const groupKey = baselineChannel?.groupKey ?? changedChannel!.groupKey;
    const difference = (changedChannel?.value ?? 0) - (baselineChannel?.value ?? 0);
    const current = byGroup.get(groupKey) ?? { absolute: 0, signed: 0 };
    current.absolute += Math.abs(difference);
    current.signed += difference;
    byGroup.set(groupKey, current);
  }

  return byGroup;
}

function getAtPath(root: unknown, path: string): unknown {
  let cursor = root as Record<string, unknown>;
  for (const part of path.split('.')) {
    cursor = cursor[part] as Record<string, unknown>;
  }
  return cursor;
}

function setAtPath(root: unknown, path: string, value: number | boolean): void {
  const parts = path.split('.');
  let cursor = root as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

function perturbationFor(input: ConcreteInput): Perturbation | undefined {
  if (typeof input.value === 'boolean') {
    return {
      value: !input.value,
      delta: 1,
      label: `${input.value ? 'true' : 'false'} → ${input.value ? 'false' : 'true'}`,
    };
  }

  if (typeof input.value !== 'number' || !Number.isFinite(input.value)) return undefined;

  const leaf = input.path.split('.').at(-1) ?? input.path;
  const normalized = NORMALIZED_FIELDS.has(leaf) || input.source === 'random';
  const magnitude = normalized
    ? 0.01
    : Math.max(Math.abs(input.value) * 0.01, 0.01);
  const direction = normalized && input.value >= 0.995 ? -1 : 1;
  const delta = magnitude * direction;
  let value = input.value + delta;
  if (input.source === 'random') value = Math.max(0, Math.min(1, value));

  return {
    value,
    delta: value - input.value,
    label: `${input.value.toPrecision(4)} → ${value.toPrecision(4)}`,
  };
}

function runPerturbedRule(
  game: Game,
  phase: PhaseTrace,
  rule: Rule,
  input: ConcreteInput,
  perturbation: Perturbation,
): Effect[] {
  const model = structuredClone(phase.before);
  const lastEvents = { ...game.lastEvents };
  const randomOverride = new Map<string, number>();

  if (input.source === 'model') {
    const current = getAtPath(model, input.path);
    if (typeof current === 'number' || typeof current === 'boolean') {
      setAtPath(model, input.path, perturbation.value);
    }
  } else if (input.source === 'lastEvents') {
    lastEvents[input.path] = perturbation.value as number;
  } else {
    randomOverride.set(input.path, perturbation.value as number);
  }

  const frozen = deepFreeze(model);
  return rule.run({
    model: frozen,
    lastEvents: Object.freeze(lastEvents),
    random: (cell, channel = '') => {
      const key = `${cell}:${channel || 'default'}`;
      return randomOverride.get(key)
        ?? randomAt(frozen.seed, frozen.tick, rule.id, cell, channel);
    },
  });
}

function effectCellActivity(
  effects: readonly Effect[],
  model: DeepReadonly<Model>,
): Map<number, number> {
  const activity = new Map<number, number>();
  const add = (cell: number, value: number) => {
    activity.set(cell, (activity.get(cell) ?? 0) + value);
  };

  for (const effect of effects) {
    switch (effect.kind) {
      case 'delta': {
        const baseline = Math.abs(model.cells[effect.cell]?.[effect.field] ?? 0);
        add(effect.cell, Math.abs(effect.amount) / Math.max(baseline, 0.01));
        break;
      }
      case 'transfer': {
        if (typeof effect.from === 'number') {
          const stock = Math.abs(model.cells[effect.from]?.[effect.resource] ?? 0);
          add(effect.from, effect.amount / Math.max(stock, 1));
        }
        if (typeof effect.to === 'number') {
          const stock = Math.abs(model.cells[effect.to]?.[effect.resource] ?? 0);
          add(effect.to, effect.amount / Math.max(stock, 1));
        }
        break;
      }
      case 'trade': {
        const sellerStock = Math.abs(model.cells[effect.from]?.[effect.resource] ?? 0);
        const buyerStock = Math.abs(model.cells[effect.to]?.[effect.resource] ?? 0);
        add(effect.from, effect.amount / Math.max(sellerStock, 1));
        add(effect.to, effect.amount / Math.max(buyerStock, 1));
        break;
      }
      case 'event':
        for (const cell of effect.evidence.cells) add(cell, 1);
        if (effect.article.cell !== undefined) add(effect.article.cell, 1);
        break;
      case 'budget':
        break;
    }
  }

  return activity;
}

function chooseInputs(
  reads: readonly ConcreteInput[],
  effects: readonly Effect[],
  model: DeepReadonly<Model>,
): ConcreteInput[] {
  const activity = effectCellActivity(effects, model);
  const focusCells = new Set(
    [...activity.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([cell]) => cell),
  );
  const byGroup = new Map<string, ConcreteInput[]>();

  for (const input of reads.filter(item => item.perturbable)) {
    const list = byGroup.get(input.groupKey) ?? [];
    list.push(input);
    byGroup.set(input.groupKey, list);
  }

  const selected: ConcreteInput[] = [];
  for (const list of byGroup.values()) {
    const focused = list.filter(input => input.cell === undefined || focusCells.has(input.cell));
    const candidates = focused.length ? focused : list;
    selected.push(...candidates.slice(0, MAX_INPUTS_PER_GROUP));
  }

  return selected.slice(0, MAX_ANALYZED_INPUTS);
}

function concreteResponses(
  game: Game,
  phase: PhaseTrace,
  rule: Rule,
  baselineEffects: readonly Effect[],
  inputs: readonly ConcreteInput[],
): ConcreteResponse[] {
  return inputs.flatMap(input => {
    const perturbation = perturbationFor(input);
    if (!perturbation || Math.abs(perturbation.delta) < 1e-12) return [];
    const effects = runPerturbedRule(game, phase, rule, input, perturbation);
    return [{
      input,
      perturbation,
      byOutput: outputDifferences(baselineEffects, effects),
    }];
  });
}

function buildOutputs(effects: readonly Effect[]): OutputGroup[] {
  const groups = new Map<string, OutputGroup>();
  for (const channel of outputChannels(effects)) {
    const current = groups.get(channel.groupKey) ?? {
      key: channel.groupKey,
      label: channel.groupLabel,
      effects: 0,
      magnitude: 0,
    };
    current.effects += 1;
    current.magnitude += Math.abs(channel.value);
    groups.set(channel.groupKey, current);
  }

  return [...groups.values()].slice(0, MAX_OUTPUT_GROUPS);
}

function buildJacobian(
  reads: readonly ConcreteInput[],
  responses: readonly ConcreteResponse[],
  outputs: readonly OutputGroup[],
): { inputs: InputGroup[]; cells: JacobianCell[] } {
  const outputKeys = new Set(outputs.map(output => output.key));
  const responseByPair = new Map<string, {
    derivative: number;
    response: number;
    signed: number;
    example: string;
    nudge: string;
  }>();

  for (const item of responses) {
    for (const [outputKey, difference] of item.byOutput) {
      if (!outputKeys.has(outputKey)) continue;
      const derivative = difference.absolute / Math.max(Math.abs(item.perturbation.delta), 1e-12);
      const pairKey = `${item.input.groupKey}→${outputKey}`;
      const current = responseByPair.get(pairKey);
      if (!current || derivative > current.derivative) {
        responseByPair.set(pairKey, {
          derivative,
          response: difference.absolute,
          signed: difference.signed,
          example: item.input.example,
          nudge: item.perturbation.label,
        });
      }
    }
  }

  const maxByOutput = new Map<string, number>();
  for (const [pairKey, response] of responseByPair) {
    const outputKey = pairKey.split('→')[1];
    maxByOutput.set(outputKey, Math.max(maxByOutput.get(outputKey) ?? 0, response.derivative));
  }

  const cells: JacobianCell[] = [];
  for (const [pairKey, response] of responseByPair) {
    const [inputKey, outputKey] = pairKey.split('→');
    const strength = response.derivative / Math.max(maxByOutput.get(outputKey) ?? 0, 1e-12);
    const sign = response.response < 1e-12
      ? 'none'
      : Math.abs(response.signed) < response.response * 0.25
        ? 'mixed'
        : response.signed > 0 ? 'positive' : 'negative';
    cells.push({
      key: pairKey,
      inputKey,
      outputKey,
      strength,
      response: response.response,
      derivative: response.derivative,
      sign,
      example: response.example,
      nudge: response.nudge,
    });
  }

  const readGroups = new Map<string, ConcreteInput[]>();
  for (const read of reads.filter(item => item.category !== 'structure')) {
    const list = readGroups.get(read.groupKey) ?? [];
    list.push(read);
    readGroups.set(read.groupKey, list);
  }

  const analyzedByGroup = new Map<string, number>();
  for (const response of responses) {
    analyzedByGroup.set(
      response.input.groupKey,
      (analyzedByGroup.get(response.input.groupKey) ?? 0) + 1,
    );
  }

  const inputs = [...readGroups.entries()].map(([key, groupReads]) => ({
    key,
    label: groupReads[0].groupLabel,
    category: groupReads[0].category,
    reads: groupReads.length,
    analyzed: analyzedByGroup.get(key) ?? 0,
    importance: Math.max(
      0,
      ...cells.filter(cell => cell.inputKey === key).map(cell => cell.strength),
    ),
    example: groupReads[0].example,
  })).sort((a, b) => b.importance - a.importance || b.reads - a.reads)
    .slice(0, MAX_INPUT_GROUPS);

  const visibleInputKeys = new Set(inputs.map(input => input.key));
  return {
    inputs,
    cells: cells.filter(cell => visibleInputKeys.has(cell.inputKey)),
  };
}

function buildStructuralInputs(reads: readonly ConcreteInput[]): InputGroup[] {
  const groups = new Map<string, ConcreteInput[]>();
  for (const read of reads.filter(item => item.category === 'structure')) {
    const list = groups.get(read.groupKey) ?? [];
    list.push(read);
    groups.set(read.groupKey, list);
  }

  return [...groups.entries()].map(([key, items]) => ({
    key,
    label: items[0].groupLabel,
    category: 'structure' as const,
    reads: items.length,
    analyzed: 0,
    importance: 0,
    example: items[0].example,
  }));
}

function outputKeyForEffect(effect: Effect): string {
  switch (effect.kind) {
    case 'delta': return `delta.${effect.field}`;
    case 'transfer': return `transfer.${effect.resource}`;
    case 'trade': return `trade.${effect.resource}.amount`;
    case 'budget': return 'budget.debtDelta';
    case 'event': return `event.${effect.key}`;
  }
}

function buildFootprint(
  effects: readonly Effect[],
  model: DeepReadonly<Model>,
): { cells: FootprintCell[]; flows: FootprintFlow[] } {
  const activity = effectCellActivity(effects, model);
  const maxActivity = Math.max(0, ...activity.values());
  const outputsByCell = new Map<number, Set<string>>();
  const addOutput = (cell: number, key: string) => {
    const set = outputsByCell.get(cell) ?? new Set<string>();
    set.add(key);
    outputsByCell.set(cell, set);
  };
  const flows: FootprintFlow[] = [];

  effects.forEach((effect, index) => {
    const outputKey = outputKeyForEffect(effect);
    if (effect.kind === 'delta') {
      addOutput(effect.cell, outputKey);
    } else if (effect.kind === 'transfer') {
      if (typeof effect.from === 'number') addOutput(effect.from, outputKey);
      if (typeof effect.to === 'number') addOutput(effect.to, outputKey);
      if (typeof effect.from === 'number' && typeof effect.to === 'number') {
        flows.push({
          key: `transfer:${index}`,
          from: effect.from,
          to: effect.to,
          outputKey,
          label: `${words(effect.resource)} flow`,
          amount: effect.amount,
          score: 0,
        });
      }
    } else if (effect.kind === 'trade') {
      addOutput(effect.from, outputKey);
      addOutput(effect.to, outputKey);
      flows.push({
        key: `trade:${index}`,
        from: effect.from,
        to: effect.to,
        outputKey,
        label: `${words(effect.resource)} trade`,
        amount: effect.amount,
        score: 0,
      });
    } else if (effect.kind === 'event') {
      for (const cell of effect.evidence.cells) addOutput(cell, outputKey);
    }
  });

  const maxFlow = Math.max(0, ...flows.map(flow => Math.abs(flow.amount)));
  for (const flow of flows) flow.score = Math.abs(flow.amount) / Math.max(maxFlow, 1e-12);

  return {
    cells: [...activity.entries()].map(([id, score]) => ({
      id,
      score: score / Math.max(maxActivity, 1e-12),
      outputKeys: [...(outputsByCell.get(id) ?? [])],
    })),
    flows,
  };
}

function compareModels(
  baseline: DeepReadonly<Model>,
  counterfactual: DeepReadonly<Model>,
): { changedCells: number; impacts: StateImpact[] } {
  let changedCells = 0;
  const totals = new Map<string, { absolute: number; baseline: number }>();
  const add = (label: string, difference: number, baselineValue: number) => {
    const current = totals.get(label) ?? { absolute: 0, baseline: 0 };
    current.absolute += Math.abs(difference);
    current.baseline += Math.abs(baselineValue);
    totals.set(label, current);
  };

  for (let index = 0; index < baseline.cells.length; index += 1) {
    const left = baseline.cells[index];
    const right = counterfactual.cells[index];
    let cellChanged = false;
    for (const field of MUTABLE_FIELDS) {
      const difference = left[field] - right[field];
      if (Math.abs(difference) > 1e-10) cellChanged = true;
      add(words(field), difference, left[field]);
    }
    if (cellChanged) changedCells += 1;
  }

  add('Treasury', baseline.treasury - counterfactual.treasury, baseline.treasury);
  add('Debt', baseline.debt - counterfactual.debt, baseline.debt);
  add('External Cash', baseline.externalCash - counterfactual.externalCash, baseline.externalCash);
  for (const field of Object.keys(baseline.budget) as (keyof Model['budget'])[]) {
    add(
      `Budget ${words(field)}`,
      baseline.budget[field] - counterfactual.budget[field],
      baseline.budget[field],
    );
  }

  const impacts = [...totals.entries()].map(([label, total]) => ({
    label,
    absolute: total.absolute,
    relative: total.absolute / Math.max(total.baseline, 1e-9),
  })).filter(impact => impact.absolute > 1e-9)
    .sort((a, b) => b.relative - a.relative);

  return { changedCells, impacts };
}

function disabledRules(ruleId: string): Rule[] {
  return defaultRules.map(rule => rule.id === ruleId
    ? { ...rule, run: () => [] }
    : rule);
}

function buildDownstream(game: Game, rule: Rule): DownstreamStage[] {
  const baseline = traceStep(game);
  const counterfactual = traceStep(game, disabledRules(rule.id));
  const start = baseline.phases.findIndex(phase => phase.phase === rule.phase);
  const stages: DownstreamStage[] = [];

  for (let index = Math.max(0, start); index < baseline.phases.length; index += 1) {
    const comparison = compareModels(
      baseline.phases[index].after,
      counterfactual.phases[index].after,
    );
    stages.push({
      key: `this:${baseline.phases[index].phase}`,
      month: 'this month',
      phase: baseline.phases[index].phase,
      changedCells: comparison.changedCells,
      impacts: comparison.impacts.slice(0, 4),
      magnitude: comparison.impacts[0]?.relative ?? 0,
    });
  }

  if (!baseline.result.ended && !counterfactual.result.ended) {
    const nextBaseline = traceStep(baseline.result);
    const nextCounterfactual = traceStep(counterfactual.result);
    for (let index = 0; index < nextBaseline.phases.length; index += 1) {
      const comparison = compareModels(
        nextBaseline.phases[index].after,
        nextCounterfactual.phases[index].after,
      );
      stages.push({
        key: `next:${nextBaseline.phases[index].phase}`,
        month: 'next month',
        phase: nextBaseline.phases[index].phase,
        changedCells: comparison.changedCells,
        impacts: comparison.impacts.slice(0, 4),
        magnitude: comparison.impacts[0]?.relative ?? 0,
      });
    }
  }

  return stages.filter((stage, index) => index === 0 || stage.impacts.length > 0);
}

export function analyzeRule(
  game: Game,
  phase: PhaseTrace,
  ruleId: string,
): RuleAnalysis | undefined {
  const rule = defaultRules.find(candidate => candidate.id === ruleId);
  if (!rule) return undefined;

  const tracked = runTrackedRule(game, phase, rule);
  const selectedInputs = chooseInputs(tracked.reads, tracked.effects, phase.before);
  const responses = concreteResponses(
    game,
    phase,
    rule,
    tracked.effects,
    selectedInputs,
  );
  const outputs = buildOutputs(tracked.effects);
  const jacobian = buildJacobian(tracked.reads, responses, outputs);
  const footprint = buildFootprint(tracked.effects, phase.before);

  return {
    ruleId: rule.id,
    description: rule.description,
    phase: rule.phase,
    inputs: jacobian.inputs,
    structuralInputs: buildStructuralInputs(tracked.reads),
    outputs,
    jacobian: jacobian.cells,
    footprintCells: footprint.cells,
    footprintFlows: footprint.flows,
    downstream: buildDownstream(game, rule),
    analyzedReads: selectedInputs.length,
    totalReads: tracked.reads.filter(read => read.category !== 'structure').length,
  };
}