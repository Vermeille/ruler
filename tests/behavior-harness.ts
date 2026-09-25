import assert from 'node:assert/strict';
import { step, assertModel } from '../src/sim/engine';
import { summarize } from '../src/sim/math';
import { defaultRules } from '../src/sim/rules';
import type { Game, Summary } from '../src/sim/types';

export const BEHAVIOR_MONTHS = 12;
export const behaviorRules = defaultRules.filter(rule => rule.id !== 'stories.events');

export type BehaviorMetric = keyof Summary;
export type BehaviorFrame = Readonly<{
  month: number;
  summary: Summary;
  causes: readonly string[];
}>;
export type MetricResponse = Readonly<{
  metric: BehaviorMetric;
  deltas: readonly number[];
  peak: number;
  peakMonth: number;
  cumulative: number;
  firstVisibleMonth: number | null;
  signChanges: number;
  tailToPeak: number;
  classification: 'silent' | 'damped' | 'persistent' | 'amplifying' | 'oscillating';
}>;

export type BehaviorRun = Readonly<{
  baseline: readonly BehaviorFrame[];
  perturbed: readonly BehaviorFrame[];
  responses: Readonly<Record<BehaviorMetric, MetricResponse>>;
}>;

const METRICS = [
  'approval', 'happiness', 'crime', 'foodSecurity', 'population', 'wealth',
  'employment', 'pollution', 'output', 'health', 'education', 'price',
  'treasury', 'debt', 'food', 'starvationDeaths',
] as const satisfies readonly BehaviorMetric[];

function trajectory(initial: Game): BehaviorFrame[] {
  let game = structuredClone(initial);
  const frames: BehaviorFrame[] = [];
  for (let month = 1; month <= BEHAVIOR_MONTHS; month += 1) {
    game = step(game, behaviorRules);
    assertModel(game.model);
    frames.push({
      month,
      summary: summarize(game.model),
      causes: game.causes.map(cause => cause.rule),
    });
  }
  return frames;
}

export function recordBehaviorBaseline(initial: Game): readonly BehaviorFrame[] {
  return trajectory(initial);
}

function responseFor(
  metric: BehaviorMetric,
  baseline: readonly BehaviorFrame[],
  perturbed: readonly BehaviorFrame[],
): MetricResponse {
  const deltas = perturbed.map((frame, index) => frame.summary[metric] - baseline[index].summary[metric]);
  const magnitudes = deltas.map(Math.abs);
  const peak = Math.max(...magnitudes);
  const peakMonth = peak === 0 ? 0 : magnitudes.indexOf(peak) + 1;
  const scale = Math.max(1e-9, ...baseline.map(frame => Math.abs(frame.summary[metric])));
  const visible = scale * 1e-6;
  const first = magnitudes.findIndex(value => value > visible);
  const nonzeroSigns = deltas.filter(value => Math.abs(value) > visible).map(Math.sign);
  const signChanges = nonzeroSigns.slice(1)
    .filter((sign, index) => sign !== nonzeroSigns[index]).length;
  const tail = magnitudes.slice(-3).reduce((sum, value) => sum + value, 0) / 3;
  const early = magnitudes.slice(0, 3).reduce((sum, value) => sum + value, 0) / 3;
  const tailToPeak = peak === 0 ? 0 : tail / peak;

  let classification: MetricResponse['classification'];
  if (peak <= visible) classification = 'silent';
  else if (signChanges >= 2) classification = 'oscillating';
  else if (tailToPeak < .35) classification = 'damped';
  else if (tail > Math.max(visible, early) * 1.5 && peakMonth >= 7) classification = 'amplifying';
  else classification = 'persistent';

  return {
    metric,
    deltas,
    peak,
    peakMonth,
    cumulative: deltas.reduce((sum, value) => sum + value, 0),
    firstVisibleMonth: first < 0 ? null : first + 1,
    signChanges,
    tailToPeak,
    classification,
  };
}

export function compareBehavior(
  initial: Game,
  baseline: readonly BehaviorFrame[],
  nudge: (game: Game) => void,
): BehaviorRun {
  const perturbedInitial = structuredClone(initial);
  nudge(perturbedInitial);
  const perturbed = trajectory(perturbedInitial);
  const responses = Object.fromEntries(
    METRICS.map(metric => [metric, responseFor(metric, baseline, perturbed)]),
  ) as Record<BehaviorMetric, MetricResponse>;
  return { baseline, perturbed, responses };
}

export function assertBehaviorTriggered(
  run: BehaviorRun,
  rule: string,
  message = `Expected behavior rule ${rule} to trigger`,
): void {
  assert.ok(run.perturbed.some(frame => frame.causes.includes(rule)), message);
}

export function assertRipple(
  run: BehaviorRun,
  metric: BehaviorMetric,
  predicate: (response: MetricResponse) => boolean,
  message: string,
): void {
  const response = run.responses[metric];
  assert.ok(predicate(response), `${message}; ${metric} deltas=[${response.deltas.map(v => v.toPrecision(3)).join(', ')}], `
    + `classification=${response.classification}`);
}

export function formatBehaviorRun(run: BehaviorRun): string {
  return METRICS
    .filter(metric => run.responses[metric].classification !== 'silent')
    .map(metric => {
      const r = run.responses[metric];
      return `${metric}: ${r.classification}, peak=${r.peak.toPrecision(3)}@m${r.peakMonth}, `
        + `cumulative=${r.cumulative.toPrecision(3)}, first=m${r.firstVisibleMonth ?? '-'}`;
    })
    .join('\n');
}
