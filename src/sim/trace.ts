import { assertModel, commitEffects, orderRules } from './engine';
import { deepFreeze, randomAt, summarize } from './math';
import { writeMonthlyNews } from './narrative';
import { defaultRules } from './rules';
import { buildStepCache } from './step-cache';
import {
  PHASES,
  type DeepReadonly,
  type Effect,
  type Game,
  type Model,
  type Phase,
  type Rule,
  type StepCache,
  type Summary,
} from './types';

export interface RuleTrace {
  id: string;
  description: string;
  effects: Effect[];
}

export interface PhaseTrace {
  phase: Phase;
  before: Model;
  after: Model;
  beforeSummary: Summary;
  afterSummary: Summary;
  rules: RuleTrace[];
  causesAdded: number;
  articlesAdded: number;
}

export interface StepTrace {
  result: Game;
  phases: PhaseTrace[];
}

type Proposal = {
  rule: string;
  effect: Effect;
};

function cloneModel(model: Model): Model {
  return {
    ...model,
    cells: model.cells.map(cell => ({ ...cell })),
    populationGroups: model.populationGroups.map(groups => groups.map(group => ({
      ...group,
      attitudes: { ...group.attitudes },
    }))),
    neighbors: model.neighbors.map(neighbors => [...neighbors]),
    regions: [...model.regions],
    policy: {
      ...model.policy,
      spending: { ...model.policy.spending },
      subsidies: { ...model.policy.subsidies },
      laws: { ...model.policy.laws },
    },
    localSubsidies: model.localSubsidies.map(subsidy => ({
      ...subsidy,
      scope: subsidy.scope.kind === 'cells'
        ? { ...subsidy.scope, ids: [...subsidy.scope.ids] }
        : { ...subsidy.scope },
    })),
    budget: { ...model.budget },
  };
}

function cloneGameForTrace(game: Game): Game {
  return {
    ...game,
    model: cloneModel(game.model),
    causes: [...game.causes],
    articles: [...game.articles],
    history: [...game.history],
    provenance: { ...game.provenance },
    lastEvents: { ...game.lastEvents },
  };
}

function traceRule(
  snapshot: DeepReadonly<Model>,
  cache: DeepReadonly<StepCache>,
  lastEvents: Readonly<Record<string, number>>,
  rule: Rule,
): RuleTrace {
  const random = (cell: number, channel = '') => {
    return randomAt(snapshot.seed, snapshot.tick, rule.id, cell, channel);
  };

  return {
    id: rule.id,
    description: rule.description,
    effects: rule.run({ model: snapshot, cache, random, lastEvents }),
  };
}

function proposalsFromRules(rules: RuleTrace[]): Proposal[] {
  const proposals: Proposal[] = [];
  for (const rule of rules) {
    for (const effect of rule.effects) proposals.push({ rule: rule.id, effect });
  }
  return proposals;
}

/**
 * Execute one month exactly like step(), while retaining the immutable input
 * snapshot, rule proposals, and settled output for every phase.
 *
 * This function is intentionally kept outside the player loop. Its unit test
 * asserts that the final Game is byte-for-byte equivalent to step(), so the
 * developer workbench cannot quietly become a second simulation engine.
 */
export function traceStep(
  game: Game,
  rules: readonly Rule[] = defaultRules,
): StepTrace {
  if (game.ended) {
    return { result: game, phases: [] };
  }

  const orderedRules = orderRules(rules);
  const next = cloneGameForTrace(game);
  const phases: PhaseTrace[] = [];
  next.model.tick += 1;
  const cache = buildStepCache(next.model);

  for (const phase of PHASES) {
    const activeRules = orderedRules.filter(rule => rule.phase === phase);
    if (activeRules.length === 0) continue;

    const before = cloneModel(next.model);
    const snapshot = deepFreeze(cloneModel(next.model));
    const causesBefore = next.causes.length;
    const articlesBefore = next.articles.length;
    const lastEvents = Object.freeze({ ...next.lastEvents });
    const ruleTraces = activeRules.map(rule => traceRule(snapshot, cache, lastEvents, rule));

    commitEffects(next, snapshot, proposalsFromRules(ruleTraces));
    assertModel(next.model);

    const after = cloneModel(next.model);
    phases.push({
      phase,
      before,
      after,
      beforeSummary: summarize(before),
      afterSummary: summarize(after),
      rules: ruleTraces,
      causesAdded: next.causes.length - causesBefore,
      articlesAdded: next.articles.length - articlesBefore,
    });
  }

  next.history.push({
    tick: next.model.tick,
    summary: summarize(next.model),
  });
  writeMonthlyNews(next);
  next.ended = next.model.tick >= next.model.mandate;

  return { result: next, phases };
}