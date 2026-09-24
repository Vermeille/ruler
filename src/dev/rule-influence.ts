import { randomAt } from '../sim/math';
import { populationStateFieldSpec } from '../sim/population/fields';
import { defaultRules } from '../sim/rules';
import { traceStep, type PhaseTrace } from '../sim/trace';
import {
  PHASES,
  type Account,
  type Effect,
  type Game,
  type Model,
  type Rule,
} from '../sim/types';

export interface InfluencePath {
  source: 'model' | 'lastEvents';
  path: string;
  label: string;
}

export interface RuleConsumer {
  key: string;
  ruleId: string;
  phase: string;
  month: 'this month' | 'next month' | 'later month';
  monthsAhead: number;
  self: boolean;
  strength: number;
  paths: InfluencePath[];
}

export interface RuleInfluence {
  outputKey: string;
  writtenPaths: InfluencePath[];
  consumers: RuleConsumer[];
}

export interface RuleProducer {
  key: string;
  ruleId: string;
  phase: string;
  month: 'this month' | 'previous month';
  strength: number;
  paths: InfluencePath[];
}

export interface RuleInputInfluence {
  inputKey: string;
  readPaths: InfluencePath[];
  producers: RuleProducer[];
}

interface ReadSet {
  model: Set<string>;
  lastEvents: Set<string>;
}

function words(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function trackedObject<T extends object>(
  value: T,
  prefix: string,
  reads: Set<string>,
): T {
  return new Proxy(value, {
    get(target, property, receiver) {
      const result = Reflect.get(target, property, receiver) as unknown;
      if (typeof property === 'symbol') return result;
      const path = prefix ? `${prefix}.${String(property)}` : String(property);

      if (result !== null && typeof result === 'object') {
        return trackedObject(result as object, path, reads);
      }

      if (typeof result === 'number' || typeof result === 'boolean' || typeof result === 'string') {
        reads.add(path);
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

function readSet(game: Game, phase: PhaseTrace, rule: Rule): ReadSet {
  const modelReads = new Set<string>();
  const eventReads = new Set<string>();
  const model = structuredClone(phase.before);
  const trackedModel = trackedObject(model, '', modelReads);
  const trackedEvents = trackedObject({ ...game.lastEvents }, '', eventReads);

  rule.run({
    model: trackedModel,
    lastEvents: trackedEvents,
    random: (cell, channel = '') => (
      randomAt(model.seed, model.tick, rule.id, cell, channel)
    ),
  });

  return { model: modelReads, lastEvents: eventReads };
}

function accountPath(account: Account, resource: string): string | undefined {
  if (account === 'treasury') return resource === 'cash' ? 'treasury' : undefined;
  if (account === 'external') return resource === 'cash' ? 'externalCash' : undefined;
  return `cells.${account}.${resource}`;
}

function effectOutputKeys(effect: Effect): string[] {
  switch (effect.kind) {
    case 'delta': return [`delta.${effect.field}`];
    case 'transfer': return [`transfer.${effect.resource}`];
    case 'repayDebt': return ['repayDebt.amount'];
    case 'trade': return [
      `trade.${effect.resource}.amount`,
      `trade.${effect.resource}.price`,
    ];
    case 'budget': return [
      'budget.debtDelta',
      ...Object.keys(effect.value).map(field => `budget.${field}`),
    ];
    case 'event': return [`event.${effect.key}`];
    case 'population-transfer': return ['population.transfer'];
    case 'population-transition': return ['population.transition'];
    case 'population-state': return ['population.state'];
    case 'population-delta': return [`population.${effect.cause}`];
  }
}

function pathsWrittenByEffect(effect: Effect): { source: 'model' | 'lastEvents'; path: string }[] {
  switch (effect.kind) {
    case 'delta':
      return [{ source: 'model', path: `cells.${effect.cell}.${effect.field}` }];
    case 'transfer': {
      const paths = [
        accountPath(effect.from, effect.resource),
        accountPath(effect.to, effect.resource),
      ].filter((path): path is string => Boolean(path));
      return paths.map(path => ({ source: 'model' as const, path }));
    }
    case 'trade': {
      const paths = [
        `cells.${effect.from}.${effect.resource}`,
        `cells.${effect.to}.${effect.resource}`,
        `cells.${effect.from}.cash`,
        `cells.${effect.to}.cash`,
      ];
      if (effect.resource === 'food') {
        paths.push(`cells.${effect.from}.foodTraded`, `cells.${effect.to}.foodTraded`);
      }
      return paths.map(path => ({ source: 'model' as const, path }));
    }
    case 'repayDebt':
      return ['treasury', 'externalCash', 'debt'].map(path => ({ source: 'model' as const, path }));
    case 'budget':
      return [
        { source: 'model', path: 'debt' },
        ...Object.keys(effect.value).map(path => ({
          source: 'model' as const,
          path: `budget.${path}`,
        })),
      ];
    case 'event':
      return [{ source: 'lastEvents', path: effect.key }];
    case 'population-transfer':
      return [effect.from, effect.to].flatMap(cell => [
        { source: 'model' as const, path: `cells.${cell}.population` },
        { source: 'model' as const, path: `populationGroups.${cell}` },
      ]);
    case 'population-transition':
    case 'population-state':
    case 'population-delta':
      return [{ source: 'model', path: `populationGroups.${effect.cell}` }];
  }
}

function pathLabel(path: string, model: Model): string {
  const cellMatch = /^cells\.(\d+)\.([^.]+)$/.exec(path);
  if (cellMatch) {
    const cell = model.cells[Number(cellMatch[1])];
    return `${cell?.name ?? `Mapxel ${cellMatch[1]}`} · ${words(cellMatch[2])}`;
  }
  if (path.startsWith('budget.')) return `Budget · ${words(path.slice(7))}`;
  if (path === 'externalCash') return 'External Cash';
  return words(path);
}

function writtenPaths(
  effects: readonly Effect[],
  outputKey: string,
  model: Model,
): InfluencePath[] {
  const seen = new Set<string>();
  const result: InfluencePath[] = [];

  for (const effect of effects) {
    if (outputKey && !effectOutputKeys(effect).includes(outputKey)) continue;
    for (const write of pathsWrittenByEffect(effect)) {
      const key = `${write.source}:${write.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        ...write,
        label: write.source === 'lastEvents'
          ? `Last Event · ${words(write.path)}`
          : pathLabel(write.path, model),
      });
    }
  }
  return result;
}

function matchingPaths(writes: readonly InfluencePath[], reads: ReadSet): InfluencePath[] {
  return writes.filter(write => (
    write.source === 'model'
      ? reads.model.has(write.path)
      : reads.lastEvents.has(write.path)
  ));
}

function collectConsumers(
  game: Game,
  phases: readonly PhaseTrace[],
  writes: readonly InfluencePath[],
  ruleId: string,
  month: RuleConsumer['month'],
  afterPhaseIndex = -1,
  monthsAhead = 0,
): RuleConsumer[] {
  const consumers: RuleConsumer[] = [];

  phases.forEach(phase => {
    const index = PHASES.indexOf(phase.phase);
    if (month === 'this month' && index <= afterPhaseIndex) return;

    for (const trace of phase.rules) {
      const rule = defaultRules.find(candidate => candidate.id === trace.id);
      if (!rule) continue;
      const matched = matchingPaths(writes, readSet(game, phase, rule));
      if (!matched.length) continue;

      consumers.push({
        key: `${month}:${rule.id}`,
        ruleId: rule.id,
        phase: rule.phase,
        month,
        monthsAhead,
        self: rule.id === ruleId,
        strength: matched.length / Math.max(1, writes.length),
        paths: matched.slice(0, 6),
      });
    }
  });

  return consumers;
}

function inputGroupMatchesPath(inputKey: string, path: string): boolean {
  if (inputKey.startsWith('cell.')) {
    const field = inputKey.slice('cell.'.length);
    return new RegExp(`^cells\\.\\d+\\.${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(path);
  }
  if (inputKey.startsWith('population.')) {
    const field = inputKey.slice('population.'.length).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^populationGroups\\.\\d+\\.\\d+\\.(?:${field}|attitudes\\.${field})$`).test(path);
  }
  if (inputKey.startsWith('policy.')) return path === inputKey;
  if (inputKey.startsWith('budget.')) return path === inputKey;
  if (inputKey.startsWith('global.')) return path === inputKey.slice('global.'.length);
  if (inputKey.startsWith('lastEvent.')) return path === inputKey.slice('lastEvent.'.length);
  if (inputKey === 'localSubsidy.amount') return /^localSubsidies\.\d+\.amount$/.test(path);
  return false;
}

function inputReadPaths(
  game: Game,
  phase: PhaseTrace,
  ruleId: string,
  inputKey: string,
): InfluencePath[] {
  const rule = defaultRules.find(candidate => candidate.id === ruleId);
  if (!rule) return [];
  const reads = readSet(game, phase, rule);
  const paths: InfluencePath[] = [];

  for (const path of reads.model) {
    if (!inputGroupMatchesPath(inputKey, path)) continue;
    paths.push({ source: 'model', path, label: pathLabel(path, phase.before) });
  }
  for (const path of reads.lastEvents) {
    if (!inputGroupMatchesPath(inputKey, path)) continue;
    paths.push({ source: 'lastEvents', path, label: `Last Event · ${words(path)}` });
  }
  return paths;
}

function ruleWrittenPaths(trace: PhaseTrace['rules'][number], model: Model): InfluencePath[] {
  const result: InfluencePath[] = [];
  const seen = new Set<string>();
  const add = (path: string) => {
    const key = `model:${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ source: 'model', path, label: pathLabel(path, model) });
  };

  for (const effect of trace.effects) {
    if (effect.kind === 'population-state' || effect.kind === 'population-transition') {
      const index = model.populationGroups[effect.cell].findIndex(group => group.id === effect.group);
      if (index < 0) continue;
      if (effect.kind === 'population-state') {
        for (const field of Object.keys(effect.change)) {
          const spec = populationStateFieldSpec(field);
          if (!spec) continue;
          add(spec.storage === 'attitudes'
            ? `populationGroups.${effect.cell}.${index}.attitudes.${field}`
            : `populationGroups.${effect.cell}.${index}.${field}`);
        }
      } else {
        for (const field of Object.keys(effect.transition)) {
          add(`populationGroups.${effect.cell}.${index}.${field}`);
        }
      }
      continue;
    }

    for (const write of writtenPaths([effect], '', model)) {
      const key = `${write.source}:${write.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(write);
    }
  }

  return result;
}

function collectProducers(
  phases: readonly PhaseTrace[],
  reads: readonly InfluencePath[],
  rulePhaseIndex: number,
): RuleProducer[] {
  const producers: RuleProducer[] = [];

  for (const phase of phases) {
    const phaseIndex = PHASES.indexOf(phase.phase);
    const month: RuleProducer['month'] = phaseIndex < rulePhaseIndex ? 'this month' : 'previous month';

    for (const trace of phase.rules) {
      const writes = ruleWrittenPaths(trace, phase.before);
      const matched = reads.filter(read => writes.some(write => (
        write.source === read.source && write.path === read.path
      )));
      if (!matched.length) continue;

      producers.push({
        key: `${month}:${trace.id}`,
        ruleId: trace.id,
        phase: phase.phase,
        month,
        strength: matched.length / Math.max(1, reads.length),
        paths: matched.slice(0, 6),
      });
    }
  }

  return producers.sort((left, right) => (
    Number(left.month === 'previous month') - Number(right.month === 'previous month')
      || right.strength - left.strength
      || left.ruleId.localeCompare(right.ruleId)
  ));
}

export function analyzeRuleInfluence(
  game: Game,
  phase: PhaseTrace,
  ruleId: string,
  outputKey: string,
): RuleInfluence {
  const ruleTrace = phase.rules.find(candidate => candidate.id === ruleId);
  if (!ruleTrace) return { outputKey, writtenPaths: [], consumers: [] };

  const writes = writtenPaths(ruleTrace.effects, outputKey, phase.before);
  if (!writes.length) return { outputKey, writtenPaths: [], consumers: [] };

  const baseline = traceStep(game);
  const phaseIndex = PHASES.indexOf(phase.phase);
  const consumers = collectConsumers(
    game,
    baseline.phases,
    writes,
    ruleId,
    'this month',
    phaseIndex,
  );

  let future = baseline.result;
  const seenFutureRules = new Set<string>();
  const horizon = ruleId === 'society.migration' ? 3 : 1;
  for (let ahead = 1; ahead <= horizon && !future.ended; ahead += 1) {
    const next = traceStep(future);
    const found = collectConsumers(future, next.phases, writes, ruleId,
      ahead === 1 ? 'next month' : 'later month', -1, ahead);
    for (const consumer of found) {
      if (seenFutureRules.has(consumer.ruleId)) continue;
      consumers.push(consumer);
      seenFutureRules.add(consumer.ruleId);
    }
    future = next.result;
  }

  return {
    outputKey,
    writtenPaths: writes,
    consumers,
  };
}

export function analyzeRuleInputInfluence(
  game: Game,
  phase: PhaseTrace,
  ruleId: string,
  inputKey: string,
): RuleInputInfluence {
  const reads = inputReadPaths(game, phase, ruleId, inputKey);
  if (!reads.length) return { inputKey, readPaths: [], producers: [] };

  const baseline = traceStep(game);
  const phaseIndex = PHASES.indexOf(phase.phase);
  return {
    inputKey,
    readPaths: reads,
    producers: collectProducers(baseline.phases, reads, phaseIndex),
  };
}
