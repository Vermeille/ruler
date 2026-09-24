import { createPhaseCausality } from './causality/provenance';
import { deepFreeze, randomAt, summarize } from './math';
import { writeMonthlyNews } from './narrative';
import { defaultRules } from './rules';
import { mergePopulation } from './population/merge';
import { planPopulation, settlePopulation } from './population/settlement';
import {
  applyAccumulatedDeltas,
  planResourceSettlement,
  settleResourceEffect,
} from './settlement/resources';
import { buildStepCache } from './step-cache';
import { assertModel } from './validation/model';
import {
  PHASES,
  type DeepReadonly,
  type Effect,
  type Game,
  type Model,
  type Phase,
  type Rule,
  type StepCache,
} from './types';

export { recordCause } from './causality/provenance';
export { assertModel } from './validation/model';

type Proposal = { rule: string; effect: Effect };
type PopulationEffect = Extract<Effect, {
  kind: 'population-transfer' | 'population-transition' | 'population-state' | 'population-delta'
}>;

const TRUSTED_RULES = new Set<Rule>(defaultRules);

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
    for (const rule of phaseRules) visit(rule);
  }

  return ordered;
}

function populationProposalsOf(proposals: readonly Proposal[]): (Proposal & { effect: PopulationEffect })[] {
  return proposals.filter((proposal): proposal is Proposal & { effect: PopulationEffect } =>
    proposal.effect.kind === 'population-transfer'
    || proposal.effect.kind === 'population-transition'
    || proposal.effect.kind === 'population-state'
    || proposal.effect.kind === 'population-delta');
}

function touchedPopulationCells(effects: readonly PopulationEffect[]): Set<number> {
  const cells = new Set<number>();
  for (const effect of effects) {
    if (effect.kind === 'population-transfer') {
      cells.add(effect.from);
      cells.add(effect.to);
    } else {
      cells.add(effect.cell);
    }
  }
  return cells;
}

function compactPopulationIfNeeded(
  game: Game,
  populationEffects: readonly PopulationEffect[],
  populationPlan: ReturnType<typeof planPopulation>,
  populationTouchedCells: Set<number>,
): void {
  let needsCompaction = false;
  for (const effect of populationEffects) {
    if (effect.kind === 'population-delta' && effect.cause === 'death') continue;
    if (effect.kind !== 'population-state') {
      needsCompaction = true;
      break;
    }
    const sourceCount = populationPlan.groups.get(effect.group)?.group.count ?? 0;
    if (effect.amount < sourceCount) {
      needsCompaction = true;
      break;
    }
  }

  if (needsCompaction) {
    mergePopulation(game.model, populationTouchedCells);
  }
}

/** Resolve a whole phase against one immutable snapshot. Incoming goods cannot be spent in that phase. */
export function commitEffects(
  game: Game,
  snapshot: DeepReadonly<Model>,
  proposals: Proposal[],
): void {
  const effects = proposals.map(proposal => proposal.effect);
  const resourcePlan = planResourceSettlement(snapshot, effects);
  const deltas = new Map<string, number>();
  const causality = createPhaseCausality(game, snapshot);

  const populationProposals = populationProposalsOf(proposals);
  const populationEffects = populationProposals.map(proposal => proposal.effect);
  const populationPlan = planPopulation(snapshot, populationEffects);
  const populationTouchedCells = touchedPopulationCells(populationEffects);

  for (const { rule, effect } of proposals) {
    switch (effect.kind) {
      case 'event':
        causality.recordEvent(rule, effect);
        break;
      case 'population-transfer':
      case 'population-transition':
      case 'population-state':
      case 'population-delta':
        break;
      default: {
        const actual = settleResourceEffect(game, snapshot, resourcePlan, deltas, effect);
        causality.recordEffect(rule, effect, actual);
        if (effect.kind === 'delta') causality.linkEventDelta(effect);
        break;
      }
    }
  }

  applyAccumulatedDeltas(game, deltas);

  const populationActuals = settlePopulation(game.model, populationEffects, populationPlan);
  populationProposals.forEach((proposal, index) => {
    const { actual, resultingGroup } = populationActuals[index];
    causality.recordPopulation(proposal.rule, proposal.effect, actual, resultingGroup);
  });
  causality.commit();

  compactPopulationIfNeeded(game, populationEffects, populationPlan, populationTouchedCells);
}

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

function cloneGameForStep(game: Game): Game {
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

function proposalsForPhase(
  game: Game,
  snapshot: DeepReadonly<Model>,
  cache: DeepReadonly<StepCache>,
  rules: Rule[],
): Proposal[] {
  const proposals: Proposal[] = [];
  const lastEvents = Object.freeze({ ...game.lastEvents });

  for (const rule of rules) {
    const random = (cell: number, channel = '') => {
      return randomAt(snapshot.seed, snapshot.tick, rule.id, cell, channel);
    };
    const effects = rule.run({ model: snapshot, cache, random, lastEvents });
    for (const effect of effects) proposals.push({ rule: rule.id, effect });
  }

  return proposals;
}

function snapshotForTrustedPhase(model: Model, proposals: readonly Proposal[]): DeepReadonly<Model> {
  const populationChanges = proposals.some(({ effect }) => effect.kind.startsWith('population-'));
  const cellChanges = proposals.some(({ effect }) => {
    switch (effect.kind) {
      case 'delta':
      case 'trade':
      case 'population-transfer':
      case 'population-delta':
        return true;
      case 'transfer':
        return typeof effect.from === 'number' || typeof effect.to === 'number';
      default:
        return false;
    }
  });

  return {
    ...model,
    cells: cellChanges ? model.cells.map(cell => ({ ...cell })) : model.cells,
    populationGroups: populationChanges
      ? model.populationGroups.map(groups => groups.map(group => ({
          ...group,
          attitudes: { ...group.attitudes },
        })))
      : model.populationGroups,
  } as DeepReadonly<Model>;
}

function runPhase(
  game: Game,
  phase: Phase,
  orderedRules: Rule[],
  cache: DeepReadonly<StepCache>,
): void {
  const activeRules = orderedRules.filter(rule => rule.phase === phase);
  if (activeRules.length === 0) return;

  const profiling = Boolean((globalThis as typeof globalThis & { __SIM_PROFILE__?: boolean }).__SIM_PROFILE__);
  const trusted = activeRules.every(rule => TRUSTED_RULES.has(rule));
  let snapshot: DeepReadonly<Model>;
  let proposals: Proposal[];
  let snapshotMs = 0;
  let rulesMs = 0;

  if (trusted) {
    const rulesStart = profiling ? performance.now() : 0;
    proposals = proposalsForPhase(game, game.model as DeepReadonly<Model>, cache, activeRules);
    if (profiling) rulesMs = performance.now() - rulesStart;
    const snapshotStart = profiling ? performance.now() : 0;
    snapshot = snapshotForTrustedPhase(game.model, proposals);
    if (profiling) snapshotMs = performance.now() - snapshotStart;
  } else {
    const snapshotStart = profiling ? performance.now() : 0;
    snapshot = deepFreeze(structuredClone(game.model));
    if (profiling) snapshotMs = performance.now() - snapshotStart;
    const rulesStart = profiling ? performance.now() : 0;
    proposals = proposalsForPhase(game, snapshot, cache, activeRules);
    if (profiling) rulesMs = performance.now() - rulesStart;
  }

  const commitStart = profiling ? performance.now() : 0;
  commitEffects(game, snapshot, proposals);
  const commitMs = profiling ? performance.now() - commitStart : 0;

  let assertMs = 0;
  if (!trusted) {
    const assertStart = profiling ? performance.now() : 0;
    assertModel(game.model);
    if (profiling) assertMs = performance.now() - assertStart;
  }

  if (profiling) {
    console.log('PERF_PHASE', JSON.stringify({
      phase,
      rules: activeRules.map(rule => rule.id),
      proposals: proposals.length,
      snapshotMs,
      rulesMs,
      commitMs,
      assertMs,
      totalMs: snapshotMs + rulesMs + commitMs + assertMs,
    }));
  }
}

export function step(game: Game, rules: readonly Rule[] = defaultRules): Game {
  if (game.ended) return game;

  const orderedRules = orderRules(rules);
  const next = cloneGameForStep(game);
  next.model.tick += 1;
  const cache = buildStepCache(next.model);

  for (const phase of PHASES) {
    runPhase(next, phase, orderedRules, cache);
  }

  assertModel(next.model);
  next.history.push({
    tick: next.model.tick,
    summary: summarize(next.model),
  });

  writeMonthlyNews(next);
  next.ended = next.model.tick >= next.model.mandate;
  return next;
}