import assert from 'node:assert/strict';
import test from 'node:test';
import { personMonths } from '../src/sim/units';
import { createGame } from '../src/sim/world';
import {
  assertRipple,
  compareBehavior,
  formatBehaviorRun,
  recordBehaviorBaseline,
} from './behavior-harness';
import { writeBehaviorReport, type BehaviorReportEntry } from './behavior-report';

// Deliberately one shared initial world and one shared 12-month control trajectory.
// Every behavior starts from an exact clone, changes one initial condition, and is
// compared month-by-month against this control.
const base = createGame('behavior-baseline', 12, 12, 12);
const baseline = recordBehaviorBaseline(base);
const land = base.model.cells.filter(cell => cell.biome !== 'water');
const focal = land.find(cell => base.model.neighbors[cell.id].length >= 2)!;
const localRegion = [focal.id, ...base.model.neighbors[focal.id]];
const report: BehaviorReportEntry[] = [];
test.after(() => writeBehaviorReport(report));
const reportRun = (name: string, run: BehaviorReportEntry['run']) => report.push({ name, run });
const regionalOutput = (frame: BehaviorReportEntry['run']['baseline'][number]) => frame.map
  .filter(cell => localRegion.includes(cell.id))
  .reduce((sum, cell) => sum + cell.output, 0);

test('a one-off food reserve shock is absorbed by production and trade feedback', t => {
  const run = compareBehavior(base, baseline, game => {
    const cell = game.model.cells[focal.id];
    cell.food = personMonths(cell.food * .55);
  });

  reportRun('Recoverable food reserve shock', run);

  assertRipple(run, 'foodSecurity', r => r.peak < 1e-4,
    'Normal production and trade should absorb a 45% local reserve loss without meaningful food insecurity');
  assertRipple(run, 'happiness', r => r.peak < 1e-4,
    'A successfully absorbed reserve shock should not become resident hardship');

  t.diagnostic(formatBehaviorRun(run));
});

test('food scarcity propagates when local farming capacity cannot replenish reserves', t => {
  const run = compareBehavior(base, baseline, game => {
    for (const id of localRegion) {
      const cell = game.model.cells[id];
      cell.food = personMonths(cell.food * .55);
      for (const group of game.model.populationGroups[id]) {
        if (group.occupation === 'agriculture') group.occupation = 'services';
      }
    }
  });

  reportRun('Food shock without local farming', run);

  assertRipple(run, 'foodSecurity', r => r.deltas.some(delta => delta < -1e-4),
    'Without local farming, depleted reserves must eventually become worse food access');
  assertRipple(run, 'price', r => r.deltas.some(delta => delta > 1e-4),
    'Worse food access must propagate into the market price signal');
  assertRipple(run, 'happiness', r => r.firstVisibleMonth !== null && r.deltas.some(delta => delta < 0),
    'Food access and purchasing-power pressure must propagate into resident wellbeing');
  assertRipple(run, 'approval', r => r.firstVisibleMonth !== null && r.deltas.some(delta => delta < 0),
    'Lower resident wellbeing must eventually propagate into approval');

  t.diagnostic(formatBehaviorRun(run));
});

test('a small pollution nudge reaches resident health and then shows whether the response damps or persists', t => {
  const run = compareBehavior(base, baseline, game => {
    game.model.cells[focal.id].pollution = Math.min(1, game.model.cells[focal.id].pollution + .08);
  });

  reportRun('Pollution nudge', run);

  assertRipple(run, 'pollution', r => r.peak > 1e-5,
    'The environmental state must retain a measurable trace of the nudge');
  assertRipple(run, 'health', r => r.deltas.some(delta => delta < -1e-6),
    'Pollution must propagate through resident experience into health');
  assertRipple(run, 'happiness', r => r.firstVisibleMonth !== null,
    'The health/environment effect must reach wellbeing');

  t.diagnostic(formatBehaviorRun(run));
});

test('better local infrastructure ripples through production/trade instead of remaining a decorative stat', t => {
  const run = compareBehavior(base, baseline, game => {
    for (const id of localRegion) {
      game.model.cells[id].infrastructure = Math.min(1, game.model.cells[id].infrastructure + .08);
    }
  });

  reportRun('Infrastructure improvement', run);

  const relativeOutputGains = run.perturbed.map((frame, index) => {
    const control = regionalOutput(run.baseline[index]);
    return control > 0 ? (regionalOutput(frame) - control) / control : 0;
  });
  const peakRegionalOutputGain = Math.max(...relativeOutputGains);

  // Calibration contract: improving infrastructure by 8 percentage points across a
  // connected local region should raise that region's monthly output by at least 0.5%
  // within a year. This is a dimensionless effect size, not an arbitrary raw output delta.
  assert.ok(peakRegionalOutputGain >= .005,
    `Regional infrastructure should raise regional monthly output by >=0.5% within a year; `
      + `observed peak=${(peakRegionalOutputGain * 100).toFixed(3)}% `
      + `trajectory=[${relativeOutputGains.map(gain => `${(gain * 100).toFixed(3)}%`).join(', ')}]`);
  assertRipple(run, 'wealth', r => r.firstVisibleMonth !== null,
    'The regional productivity improvement must eventually reach household resources');

  t.diagnostic(formatBehaviorRun(run));
});

test('the harness characterizes stabilization rather than only checking a month-12 endpoint', t => {
  const run = compareBehavior(base, baseline, game => {
    for (const group of game.model.populationGroups[focal.id]) {
      group.wellbeing = Math.max(0, group.wellbeing - .03);
    }
  });

  reportRun('Resident wellbeing shock', run);

  assertRipple(run, 'happiness', r =>
    r.firstVisibleMonth !== null
      && r.peakMonth > 0
      && ['damped', 'persistent', 'amplifying', 'oscillating'].includes(r.classification),
  'A resident wellbeing perturbation must have a measurable temporal response');

  t.diagnostic(formatBehaviorRun(run));
});
