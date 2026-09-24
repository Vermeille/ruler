import { createGame } from '../src/sim/world';
import { step } from '../src/sim/engine';
import { summarize } from '../src/sim/math';
import { defaultRules } from '../src/sim/rules';
import type { Game } from '../src/sim/types';

const rules = defaultRules.filter(rule => rule.id !== 'stories.events');
const run = (game: Game, months: number): Game => {
  for (let i = 0; i < months; i += 1) game = step(game, rules);
  return game;
};

const base = createGame('long-run', 18, 14, 240);
const perturbed = structuredClone(base);
const cell = perturbed.model.cells.find(c => c.population > 0)!;
perturbed.model.populationGroups[cell.id][0].wellbeing += 0.00001;

const a = run(base, 240);
const b = run(perturbed, 240);
const sa = summarize(a.model);
const sb = summarize(b.model);
const monthlyHappinessDiff = a.history.map((frame, index) =>
  Math.abs(frame.summary.happiness - b.history[index].summary.happiness));
const monthlyWealthDiff = a.history.map((frame, index) =>
  Math.abs(frame.summary.wealth - b.history[index].summary.wealth));

console.log('LONG_RUN_DIVERGENCE', JSON.stringify({
  baseline: sa,
  perturbed: sb,
  finalHappinessDiff: Math.abs(sa.happiness - sb.happiness),
  finalWealthDiff: Math.abs(sa.wealth - sb.wealth),
  finalPopulationDiff: Math.abs(sa.population - sb.population),
  maxMonthlyHappinessDiff: Math.max(...monthlyHappinessDiff),
  meanLastYearHappinessDiff: monthlyHappinessDiff.slice(-12).reduce((a, b) => a + b, 0) / 12,
  maxMonthlyWealthDiff: Math.max(...monthlyWealthDiff),
  baselineLastYearHappinessRange: Math.max(...a.history.slice(-12).map(h => h.summary.happiness))
    - Math.min(...a.history.slice(-12).map(h => h.summary.happiness)),
  maxGroupsA: Math.max(...a.model.populationGroups.map(groups => groups.length)),
  maxGroupsB: Math.max(...b.model.populationGroups.map(groups => groups.length)),
}));
