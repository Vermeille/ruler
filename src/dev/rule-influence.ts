import { randomAt } from '../sim/math';
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
  month: 'this month' | 'next month';
  self: boolean;
  strength: number;
  paths: InfluencePath[];
}

export interface RuleInfluence {
  outputKey: string;
  writtenPaths: InfluencePath[];
  consumers: RuleConsumer[];
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
    case 'trade': return [
      `trade.${effect.resource}.amount`,
      `trade.${effect.resource}.price`,
    ];
    case 'budget': return [
      'budget.debtDelta',
      ...Object.keys(effect.value).map(field => `budget.${field}`),
    ];
    case 'event': return [`event.${effect.key}`];
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
        self: rule.id === ruleId,
        strength: matched.length / Math.max(1, writes.length),
        paths: matched.slice(0, 6),
      });
    }
  });

  return consumers;
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

  if (!baseline.result.ended) {
    const next = traceStep(baseline.result);
    consumers.push(...collectConsumers(
      baseline.result,
      next.phases,
      writes,
      ruleId,
      'next month',
    ));
  }

  return {
    outputKey,
    writtenPaths: writes,
    consumers,
  };
}
