import fs from 'node:fs';

const path = 'src/sim/engine.ts';
let text = fs.readFileSync(path, 'utf8');
if (text.includes('function snapshotForTrustedPhase(')) {
  console.log('Engine performance refactor already applied.');
  process.exit(0);
}

const phaseMarker = '\nfunction phaseIndex(phase: Phase): number {';
if (!text.includes(phaseMarker)) throw new Error('Could not find phaseIndex marker.');
text = text.replace(phaseMarker,
  '\nconst TRUSTED_RULES = new Set<Rule>(defaultRules);\n' + phaseMarker);

const tailStart = text.indexOf('function proposalsForPhase(');
if (tailStart < 0) throw new Error('Could not find proposalsForPhase.');

const tail = `function proposalsForPhase(
  game: Game,
  snapshot: DeepReadonly<Model>,
  rules: Rule[],
): Proposal[] {
  const proposals: Proposal[] = [];
  const lastEvents = Object.freeze({ ...game.lastEvents });
  for (const rule of rules) {
    const random = (cell: number, channel = '') => {
      return randomAt(snapshot.seed, snapshot.tick, rule.id, cell, channel);
    };
    const effects = rule.run({ model: snapshot, random, lastEvents });
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

function runPhase(game: Game, phase: Phase, orderedRules: Rule[]): void {
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
    proposals = proposalsForPhase(game, game.model as DeepReadonly<Model>, activeRules);
    if (profiling) rulesMs = performance.now() - rulesStart;
    const snapshotStart = profiling ? performance.now() : 0;
    snapshot = snapshotForTrustedPhase(game.model, proposals);
    if (profiling) snapshotMs = performance.now() - snapshotStart;
  } else {
    const snapshotStart = profiling ? performance.now() : 0;
    snapshot = deepFreeze(structuredClone(game.model));
    if (profiling) snapshotMs = performance.now() - snapshotStart;
    const rulesStart = profiling ? performance.now() : 0;
    proposals = proposalsForPhase(game, snapshot, activeRules);
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

  for (const phase of PHASES) {
    runPhase(next, phase, orderedRules);
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
`;

text = text.slice(0, tailStart) + tail;
fs.writeFileSync(path, text);
console.log('Applied selective phase snapshots and trusted-rule validation.');
