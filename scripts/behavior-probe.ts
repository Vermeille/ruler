import { createGame } from '../src/sim/world';
import { step } from '../src/sim/engine';
import { enact } from '../src/sim/policy';
import { summarize } from '../src/sim/math';
import { defaultRules } from '../src/sim/rules';
import type { Action, Game, Rule, Sector } from '../src/sim/types';

const rules = defaultRules.filter(rule => rule.id !== 'stories.events');
const services = ['health', 'education', 'police', 'infrastructure', 'welfare', 'culture', 'environment'] as const;
const tax = (rate: number): Action[] => [
  { type: 'tax', tax: 'incomeTax', rate },
  { type: 'tax', tax: 'businessTax', rate },
];
const spend = (amount: number): Action[] => services.map(service => ({ type: 'spending', service, amount }));
const subsidy = (sector: Sector): Action => ({ type: 'subsidy', sector, amount: 3, scope: { kind: 'national' } });

function run(start: Game, months: number, activeRules: readonly Rule[] = rules): Game {
  let game = start;
  for (let month = 0; month < months; month += 1) game = step(game, activeRules);
  return game;
}

function compact(game: Game) {
  const summary = summarize(game.model);
  return {
    population: summary.population,
    wealth: summary.wealth,
    approval: summary.approval,
    happiness: summary.happiness,
    crime: summary.crime,
    foodSecurity: summary.foodSecurity,
    pollution: summary.pollution,
    health: summary.health,
    employment: summary.employment,
    price: summary.price,
    output: summary.output,
    funding: game.model.budget.funding,
    debt: game.model.debt,
  };
}

function workerShare(game: Game, sector: Sector, cellId?: number) {
  const cells = cellId === undefined ? game.model.populationGroups : [game.model.populationGroups[cellId]];
  let workers = 0;
  let matching = 0;
  for (const groups of cells) for (const group of groups) {
    if (group.lifeStage !== 'adult' || !group.employed || group.occupation === null) continue;
    workers += group.count;
    if (group.occupation === sector) matching += group.count;
  }
  return workers > 0 ? matching / workers : 0;
}

function print(label: string, value: unknown) {
  console.log('BEHAVIOR', label, JSON.stringify(value));
}

for (const seed of ['alder-42', 'marlow']) {
  const weather: Rule = {
    id: 'probe.sustained-drought', phase: 'events', description: 'probe drought',
    run({ model }) {
      return model.cells.filter(c => c.biome !== 'water' && c.region === 1)
        .map(c => ({ kind: 'delta' as const, cell: c.id, field: 'waterStress' as const, amount: .8 - c.waterStress }));
    },
  };
  const base = createGame(seed, 12, 12, 48);
  const baseline = run(base, 48);
  const dry = run(createGame(seed, 12, 12, 48), 48, [...rules, weather]);
  const dryNoMigration = run(createGame(seed, 12, 12, 48), 48,
    [...rules.filter(rule => rule.phase !== 'migration'), weather]);
  const ids = baseline.model.cells.filter(c => c.biome !== 'water' && c.region === 1).map(c => c.id);
  const region = (game: Game) => {
    const s = summarize(game.model, ids);
    return {
      population: s.population,
      foodSecurity: s.foodSecurity,
      health: s.health,
      happiness: s.happiness,
      harvest: ids.reduce((sum, id) => sum + game.model.cells[id].foodMade, 0),
    };
  };
  print(`drought:${seed}`, { baseline: region(baseline), dry: region(dry), dryNoMigration: region(dryNoMigration) });
}

for (const [seed, id] of [['alder-42', 113], ['marlow', 114]] as const) {
  const start = createGame(seed, 12, 12, 48);
  const treated = enact(start, { type: 'subsidy', sector: 'manufacturing', amount: 3, scope: { kind: 'cells', ids: [id] } });
  const baseline = run(start, 48);
  const developed = run(treated, 48);
  const immobile = run(treated, 48, rules.filter(rule => rule.phase !== 'migration'));
  const restricted = run(enact(treated, { type: 'law', law: 'freeMovement', enabled: false }), 48);
  const local = (game: Game) => {
    const c = game.model.cells[id];
    return {
      population: c.population,
      manufacturingProjection: c.manufacturing,
      manufacturingWorkers: workerShare(game, 'manufacturing', id),
      outputPerCapita: c.output / Math.max(1, c.population),
      foodSecurity: c.foodSecurity,
      price: c.price,
      happiness: c.happiness,
    };
  };
  print(`local-industry:${seed}:${id}`, { baseline: local(baseline), developed: local(developed), immobile: local(immobile), restricted: local(restricted) });
}

for (const seed of ['alder-42', 'marlow']) {
  const industry: Action = { type: 'subsidy', sector: 'manufacturing', amount: 3, scope: { kind: 'national' } };
  const industrial = run(enact(createGame(seed, 12, 12, 48), industry), 12);
  const unregulated = run(industrial, 24);
  const controlled = run(enact(industrial, { type: 'law', law: 'cleanAir', enabled: true }), 24);
  print(`clean-air:${seed}`, { unregulated: compact(unregulated), controlled: compact(controlled) });
}

{
  const long = run(createGame('long-run', 18, 14, 240), 240);
  const lastYear = long.history.slice(-12).map(h => h.summary.happiness);
  print('long-run', {
    final: compact(long),
    happinessRange: Math.max(...lastYear) - Math.min(...lastYear),
    maxGroupsPerCell: Math.max(...long.model.populationGroups.map(groups => groups.length)),
    groups: long.model.populationGroups.reduce((sum, groups) => sum + groups.length, 0),
  });
}

for (const seed of ['alder-42', 'marlow']) {
  const scenario = (actions: Action[]) => run(actions.length
    ? enact(createGame(seed, 12, 12, 48), actions)
    : createGame(seed, 12, 12, 48), 48);
  const baseline = scenario([]);
  const punitive = scenario([...tax(.65),
    { type: 'spending', service: 'police', amount: 0 },
    { type: 'spending', service: 'welfare', amount: 0 }]);
  const minimal = scenario([...tax(0), ...spend(0)]);
  const industrial = scenario([subsidy('manufacturing')]);
  const neglected = scenario([subsidy('manufacturing'),
    { type: 'spending', service: 'health', amount: 0 },
    { type: 'spending', service: 'environment', amount: 0 }]);
  const distorted = scenario([subsidy('sports'), subsidy('manufacturing')]);
  const minFood = Math.min(...distorted.history.map(h => h.summary.foodSecurity));
  const starvation = distorted.history.reduce((sum, h) => sum + h.summary.starvationDeaths, 0);
  print(`extremes:${seed}`, {
    baseline: compact(baseline), punitive: compact(punitive), minimal: compact(minimal),
    industrial: compact(industrial), neglected: compact(neglected),
    distorted: { ...compact(distorted), minFood, starvation },
  });
}

for (const seed of ['alder-42', 'marlow']) {
  const base = createGame(seed, 12, 12, 48);
  const baseline = run(base, 24);
  const health = run(enact(base, { type: 'spending', service: 'health', amount: .6 }), 24);
  const clean = run(enact(base, { type: 'law', law: 'cleanAir', enabled: true }), 24);
  const unfunded = run(enact(base, spend(2)), 36);
  print(`ripples:${seed}`, { baseline: compact(baseline), health: compact(health), clean: compact(clean), unfunded: compact(unfunded) });
}
