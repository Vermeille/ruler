import { assertModel, commitEffects, orderRules } from './engine';
import { deepFreeze, randomAt, summarize } from './math';
import { writeMonthlyNews } from './narrative';
import { defaultRules } from './rules';
import {
  PHASES,
  type DeepReadonly,
  type Effect,
  type Game,
  type Model,
  type Phase,
  type Rule,
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

function cloneGameForTrace(game: Game): Game {
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

function traceRule(
  game: Game,
  snapshot: DeepReadonly<Model>,
  rule: Rule,
): RuleTrace {
  const random = (cell: number, channel = '') => {
    return randomAt(snapshot.seed, snapshot.tick, rule.id, cell, channel);
  };

  return {
    id: rule.id,
    description: rule.description,
    effects: rule.run({
      model: snapshot,
      random,
      lastEvents: Object.freeze({ ...game.lastEvents }),
    }),
  };
}

function proposalsFromRules(rules: RuleTrace[]): Proposal[] {
  return rules.flatMap(rule => {
    return rule.effects.map(effect => ({
      rule: rule.id,
      effect,
    }));
  });
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

  for (const phase of PHASES) {
    const activeRules = orderedRules.filter(rule => rule.phase === phase);
    if (activeRules.length === 0) continue;

    const before = structuredClone(next.model);
    const snapshot = deepFreeze(structuredClone(next.model));
    const causesBefore = next.causes.length;
    const articlesBefore = next.articles.length;
    const ruleTraces = activeRules.map(rule => traceRule(next, snapshot, rule));

    commitEffects(next, snapshot, proposalsFromRules(ruleTraces));
    assertModel(next.model);

    const after = structuredClone(next.model);
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
