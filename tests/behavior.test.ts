import test from 'node:test';
import { createGame } from '../src/sim/world';
import {
  assertBehaviorTriggered,
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
const report: BehaviorReportEntry[] = [];
test.after(() => writeBehaviorReport(report));
const reportRun = (name: string, run: BehaviorReportEntry['run']) => report.push({ name, run });

test('food scarcity triggers household/market behavior and propagates into prices and wellbeing', t => {
  const run = compareBehavior(base, baseline, game => {
    const cell = game.model.cells[focal.id];
    cell.food *= .55;
  });

  reportRun('Food scarcity', run);

  assertBehaviorTriggered(run, 'economy.households');
  assertBehaviorTriggered(run, 'economy.businesses');
  assertRipple(run, 'foodSecurity', r => r.deltas.some(delta => delta < -1e-4),
    'Less starting food must become measurably worse food access');
  assertRipple(run, 'price', r => r.deltas.some(delta => delta > 1e-4),
    'The shortage must propagate into the price signal');
  assertRipple(run, 'happiness', r => r.firstVisibleMonth !== null,
    'The material shock must eventually reach resident wellbeing');

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
    const ids = [focal.id, ...game.model.neighbors[focal.id]];
    for (const id of ids) game.model.cells[id].infrastructure = Math.min(1, game.model.cells[id].infrastructure + .08);
  });

  reportRun('Infrastructure improvement', run);

  assertRipple(run, 'output', r => r.firstVisibleMonth !== null && r.peak > 1e-3,
    'Infrastructure must change downstream economic output');
  assertRipple(run, 'food', r => r.firstVisibleMonth !== null,
    'Infrastructure must alter real food stocks through production/trade');
  assertRipple(run, 'wealth', r => r.firstVisibleMonth !== null,
    'The physical/economic change must eventually reach household resources');

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
