import { createGame } from '../src/sim/world';
import { step } from '../src/sim/engine';
import { enact } from '../src/sim/policy';
import { defaultRules } from '../src/sim/rules';
import { summarize } from '../src/sim/math';
import type { Game, Sector } from '../src/sim/types';

function workerShare(game: Game, sector: Sector): number {
  let total = 0;
  let matching = 0;
  for (const groups of game.model.populationGroups) {
    for (const group of groups) {
      if (group.lifeStage !== 'adult' || !group.employed || group.occupation === null) continue;
      total += group.count;
      if (group.occupation === sector) matching += group.count;
    }
  }
  return total > 0 ? matching / total : 0;
}

function weightedCellMean(game: Game, field: 'price' | 'businessHealth' | 'foodMade'): number {
  let weighted = 0;
  let population = 0;
  for (const cell of game.model.cells) {
    if (cell.biome === 'water' || cell.population <= 0) continue;
    weighted += cell[field] * cell.population;
    population += cell.population;
  }
  return population > 0 ? weighted / population : 0;
}

function snapshot(game: Game) {
  const summary = summarize(game.model);
  return {
    month: game.model.tick,
    foodSecurity: summary.foodSecurity,
    price: weightedCellMean(game, 'price'),
    businessHealth: weightedCellMean(game, 'businessHealth'),
    foodMadePerResident: weightedCellMean(game, 'foodMade'),
    agricultureWorkers: workerShare(game, 'agriculture'),
    sportsWorkers: workerShare(game, 'sports'),
    funding: game.model.budget.funding,
  };
}

let game = enact(createGame('alder-42', 18, 14, 48), {
  type: 'subsidy',
  sector: 'sports',
  amount: 3,
  scope: { kind: 'national' },
});

const timeline = [snapshot(game)];
for (let month = 1; month <= 48; month += 1) {
  game = step(game, defaultRules);
  timeline.push(snapshot(game));
}

const worst = timeline.reduce((a, b) => b.foodSecurity < a.foodSecurity ? b : a);
const retrainingCauses = game.causes.filter(cause => cause.rule === 'population.retraining');
const projectionCauses = game.causes.filter(cause => cause.rule === 'population.aggregate');
const shortageCauses = game.causes.filter(cause => cause.rule === 'economy.households' && cause.title.includes('food supplies fall short'));
const businessCauses = game.causes.filter(cause => cause.rule === 'economy.businesses' && cause.title.includes('struggle'));

console.log('SPORTS_SCENARIO_TIMELINE');
for (const point of timeline.filter(point => point.month % 3 === 0 || point.month === worst.month || point.month === 48)) {
  console.log(JSON.stringify(point));
}
console.log('SPORTS_SCENARIO_SUMMARY');
console.log(JSON.stringify({
  worstMonth: worst.month,
  worstFoodSecurity: worst.foodSecurity,
  finalFoodSecurity: timeline.at(-1)!.foodSecurity,
  initialAgricultureWorkers: timeline[0].agricultureWorkers,
  minimumAgricultureWorkers: Math.min(...timeline.map(point => point.agricultureWorkers)),
  finalAgricultureWorkers: timeline.at(-1)!.agricultureWorkers,
  initialSportsWorkers: timeline[0].sportsWorkers,
  maximumSportsWorkers: Math.max(...timeline.map(point => point.sportsWorkers)),
  finalSportsWorkers: timeline.at(-1)!.sportsWorkers,
  retrainingCauses: retrainingCauses.length,
  projectionCauses: projectionCauses.length,
  shortageCauses: shortageCauses.length,
  businessCauses: businessCauses.length,
}));
