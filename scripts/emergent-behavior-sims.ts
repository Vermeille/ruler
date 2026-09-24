import { step } from '../src/sim/engine';
import { defaultRules } from '../src/sim/rules';
import type { Game, PopulationGroup, Rule } from '../src/sim/types';
import { createGame } from '../src/sim/world';

const rules: readonly Rule[] = defaultRules.filter(rule =>
  rule.id !== 'stories.events' && rule.id !== 'population.event-experience');

type Metric = Record<string, number>;
type SimulationResult = {
  behavior: string;
  seed: string;
  months: number;
  nudge: string;
  baseline: Metric;
  nudged: Metric;
  delta: Metric;
};

function run(game: Game, months: number): Game {
  let current = game;
  for (let month = 0; month < months; month += 1) current = step(current, rules);
  return current;
}

function land(game: Game) {
  return game.model.cells.filter(cell => cell.biome !== 'water');
}

function focalCell(game: Game): number {
  return land(game).sort((a, b) => b.population - a.population || a.id - b.id)[0].id;
}

function neighborCell(game: Game, cell: number): number {
  return game.model.neighbors[cell]
    .filter(id => game.model.cells[id].biome !== 'water')
    .sort((a, b) => game.model.cells[b].population - game.model.cells[a].population || a - b)[0];
}

function groups(game: Game, cells: readonly number[]): PopulationGroup[] {
  return cells.flatMap(cell => game.model.populationGroups[cell]);
}

function weighted(
  game: Game,
  cells: readonly number[],
  value: (group: PopulationGroup) => number,
  predicate: (group: PopulationGroup) => boolean = () => true,
): number {
  let mass = 0;
  let total = 0;
  for (const group of groups(game, cells)) {
    if (!predicate(group)) continue;
    mass += group.count;
    total += group.count * value(group);
  }
  return mass > 0 ? total / mass : 0;
}

function population(game: Game, cells: readonly number[]): number {
  return cells.reduce((sum, id) => sum + game.model.cells[id].population, 0);
}

function rounded(metric: Metric): Metric {
  return Object.fromEntries(Object.entries(metric).map(([key, value]) => [key, +value.toFixed(6)]));
}

function result(
  behavior: string,
  seed: string,
  months: number,
  nudge: string,
  baseline: Metric,
  nudged: Metric,
): SimulationResult {
  const delta = Object.fromEntries(Object.keys(baseline).map(key => [key, (nudged[key] ?? 0) - baseline[key]]));
  return {
    behavior,
    seed,
    months,
    nudge,
    baseline: rounded(baseline),
    nudged: rounded(nudged),
    delta: rounded(delta),
  };
}

function matched(seed: string): [Game, Game] {
  const base = createGame(seed, 12, 12, 24);
  return [structuredClone(base), structuredClone(base)];
}

function unrestSimulation(): SimulationResult {
  const seed = 'emergence-unrest';
  const [baselineStart, nudgedStart] = matched(seed);
  const focal = focalCell(nudgedStart);
  const neighbor = neighborCell(nudgedStart, focal);
  for (const group of nudgedStart.model.populationGroups[focal]) {
    group.approval = Math.max(0, group.approval - 0.28);
    group.wellbeing = Math.max(0, group.wellbeing - 0.14);
    group.outlook = -0.55;
  }
  const baseline = run(baselineStart, 6);
  const nudged = run(nudgedStart, 6);
  return result('UNREST-MOBILIZATION1', seed, 6,
    'Lower approval and wellbeing in the largest city and give its residents a sharply negative outlook.', {
      focalUnrest: baseline.model.cells[focal].unrest,
      neighborUnrest: baseline.model.cells[neighbor].unrest,
      focalApproval: weighted(baseline, [focal], group => group.approval),
    }, {
      focalUnrest: nudged.model.cells[focal].unrest,
      neighborUnrest: nudged.model.cells[neighbor].unrest,
      focalApproval: weighted(nudged, [focal], group => group.approval),
    });
}

function overloadSimulation(): SimulationResult {
  const seed = 'emergence-overload';
  const [baselineStart, nudgedStart] = matched(seed);
  const focal = focalCell(nudgedStart);
  nudgedStart.model.cells[focal].healthCapacity *= 0.48;
  nudgedStart.model.cells[focal].educationCapacity *= 0.48;
  const baseline = run(baselineStart, 6);
  const nudged = run(nudgedStart, 6);
  return result('SERVICE-OVERLOAD1', seed, 6,
    'Cut staffed health and education capacity in the largest city to 48% of its matched baseline.', {
      healthAccess: baseline.model.cells[focal].health,
      educationAccess: baseline.model.cells[focal].education,
      healthDisruption: baseline.model.cells[focal].healthDisruption,
      educationDisruption: baseline.model.cells[focal].educationDisruption,
    }, {
      healthAccess: nudged.model.cells[focal].health,
      educationAccess: nudged.model.cells[focal].education,
      healthDisruption: nudged.model.cells[focal].healthDisruption,
      educationDisruption: nudged.model.cells[focal].educationDisruption,
    });
}

function epidemicSimulation(): SimulationResult {
  const seed = 'emergence-epidemic';
  const [baselineStart, nudgedStart] = matched(seed);
  const focal = focalCell(nudgedStart);
  const neighbor = neighborCell(nudgedStart, focal);
  for (const group of nudgedStart.model.populationGroups[focal]) group.infection = 0.28;
  const baseline = run(baselineStart, 6);
  const nudged = run(nudgedStart, 6);
  return result('EPIDEMIC-SPREAD1', seed, 6,
    'Seed a 28% infection load across resident groups in the largest city.', {
      focalInfection: baseline.model.cells[focal].infection,
      neighborInfection: baseline.model.cells[neighbor].infection,
      focalHealth: weighted(baseline, [focal], group => group.health),
      healthDisruption: baseline.model.cells[focal].healthDisruption,
    }, {
      focalInfection: nudged.model.cells[focal].infection,
      neighborInfection: nudged.model.cells[neighbor].infection,
      focalHealth: weighted(nudged, [focal], group => group.health),
      healthDisruption: nudged.model.cells[focal].healthDisruption,
    });
}

function displacementSimulation(): SimulationResult {
  const seed = 'emergence-displacement';
  const [baselineStart, nudgedStart] = matched(seed);
  const focal = focalCell(nudgedStart);
  const neighbors = nudgedStart.model.neighbors[focal];
  const cell = nudgedStart.model.cells[focal];
  cell.foodSecurity = 0.18;
  cell.waterStress = 0.92;
  cell.healthDisruption = 0.55;
  const beforeSource = cell.population;
  const baseline = run(baselineStart, 2);
  const nudged = run(nudgedStart, 2);
  return result('CRISIS-DISPLACEMENT1', seed, 2,
    'Combine severe food insecurity, water stress, and health disruption in one large city on a non-quarter migration month.', {
      sourcePopulationChange: baseline.model.cells[focal].population - beforeSource,
      neighborPopulation: population(baseline, neighbors),
      sourceOutlook: weighted(baseline, [focal], group => group.outlook),
    }, {
      sourcePopulationChange: nudged.model.cells[focal].population - beforeSource,
      neighborPopulation: population(nudged, neighbors),
      sourceOutlook: weighted(nudged, [focal], group => group.outlook),
    });
}

function divergenceSimulation(): SimulationResult {
  const seed = 'emergence-divergence';
  const [baselineStart, nudgedStart] = matched(seed);
  const focal = focalCell(nudgedStart);
  const region = nudgedStart.model.cells[focal].region;
  const regionCells = land(nudgedStart).filter(cell => cell.region === region).map(cell => cell.id);
  for (const group of groups(nudgedStart, regionCells)) {
    group.wellbeing = Math.max(0, group.wellbeing - 0.16);
  }
  const baseline = run(baselineStart, 5);
  const nudged = run(nudgedStart, 5);
  return result('REGIONAL-DIVERGENCE1', seed, 5,
    'Lower resident wellbeing throughout one region by 0.16 while leaving the rest of the country matched.', {
      regionApproval: weighted(baseline, regionCells, group => group.approval),
      regionOutlook: weighted(baseline, regionCells, group => group.outlook),
      regionMobilization: weighted(baseline, regionCells, group => group.mobilization),
    }, {
      regionApproval: weighted(nudged, regionCells, group => group.approval),
      regionOutlook: weighted(nudged, regionCells, group => group.outlook),
      regionMobilization: weighted(nudged, regionCells, group => group.mobilization),
    });
}

function policyShockSimulation(): SimulationResult {
  const seed = 'emergence-policy-shock';
  const [baselineStart, nudgedStart] = matched(seed);
  const focal = focalCell(nudgedStart);
  nudgedStart.model.policy.incomeTax = 0.62;
  nudgedStart.model.policy.spending.health = 1.25;
  const baselineOne = run(baselineStart, 1);
  const nudgedOne = run(nudgedStart, 1);
  const baseline = run(baselineOne, 3);
  const nudged = run(nudgedOne, 3);
  return result('POLICY-SHOCK1', seed, 4,
    'Abruptly raise income tax to 62% and health spending to 1.25 crowns per resident-month.', {
      initialAdjustment: baselineOne.model.cells[focal].policyAdjustment,
      adjustmentAfterFourMonths: baseline.model.cells[focal].policyAdjustment,
      outlookAfterFourMonths: weighted(baseline, [focal], group => group.outlook),
      approvalAfterFourMonths: weighted(baseline, [focal], group => group.approval),
    }, {
      initialAdjustment: nudgedOne.model.cells[focal].policyAdjustment,
      adjustmentAfterFourMonths: nudged.model.cells[focal].policyAdjustment,
      outlookAfterFourMonths: weighted(nudged, [focal], group => group.outlook),
      approvalAfterFourMonths: weighted(nudged, [focal], group => group.approval),
    });
}

function expectationsSimulation(): SimulationResult {
  const seed = 'emergence-expectations';
  const [baselineStart, nudgedStart] = matched(seed);
  const focal = focalCell(nudgedStart);
  nudgedStart.model.cells[focal].foodSecurity = 0.38;
  nudgedStart.model.cells[focal].price = 2.3;
  nudgedStart.model.cells[focal].health = 0.48;
  const baseline = run(baselineStart, 3);
  const nudged = run(nudgedStart, 3);
  return result('EXPECTATIONS1', seed, 3,
    'Give one city a simultaneous food-price and health-access deterioration, leaving resident outlook untouched initially.', {
      outlook: weighted(baseline, [focal], group => group.outlook),
      approval: weighted(baseline, [focal], group => group.approval),
      mobilization: weighted(baseline, [focal], group => group.mobilization),
    }, {
      outlook: weighted(nudged, [focal], group => group.outlook),
      approval: weighted(nudged, [focal], group => group.approval),
      mobilization: weighted(nudged, [focal], group => group.mobilization),
    });
}

function salienceSimulation(): SimulationResult {
  const seed = 'emergence-salience';
  const [baselineStart, nudgedStart] = matched(seed);
  const focal = focalCell(nudgedStart);
  nudgedStart.model.cells[focal].crime = 0.68;
  const beforePopulation = nudgedStart.model.cells[focal].population;
  const baseline = run(baselineStart, 5);
  const nudged = run(nudgedStart, 5);
  return result('PUBLIC-SALIENCE1', seed, 5,
    'Raise local crime to 0.68 without directly changing any group need weights.', {
      safetySalience: weighted(baseline, [focal], group => group.salienceSafety),
      approval: weighted(baseline, [focal], group => group.approval),
      populationChange: baseline.model.cells[focal].population - beforePopulation,
    }, {
      safetySalience: weighted(nudged, [focal], group => group.salienceSafety),
      approval: weighted(nudged, [focal], group => group.approval),
      populationChange: nudged.model.cells[focal].population - beforePopulation,
    });
}

function cascadeSimulation(): SimulationResult {
  const seed = 'emergence-cascade';
  const [baselineStart, nudgedStart] = matched(seed);
  const focal = focalCell(nudgedStart);
  const cell = nudgedStart.model.cells[focal];
  cell.healthCapacity *= 0.34;
  cell.educationCapacity *= 0.34;
  cell.infrastructure = 0.24;
  const baseline = run(baselineStart, 7);
  const nudged = run(nudgedStart, 7);
  return result('CASCADE-FAILURE1', seed, 7,
    'Push a large city well beyond health and education capacity while degrading its infrastructure.', {
      healthDisruption: baseline.model.cells[focal].healthDisruption,
      educationDisruption: baseline.model.cells[focal].educationDisruption,
      infrastructureDisruption: baseline.model.cells[focal].infrastructureDisruption,
      healthAccess: baseline.model.cells[focal].health,
      outlook: weighted(baseline, [focal], group => group.outlook),
    }, {
      healthDisruption: nudged.model.cells[focal].healthDisruption,
      educationDisruption: nudged.model.cells[focal].educationDisruption,
      infrastructureDisruption: nudged.model.cells[focal].infrastructureDisruption,
      healthAccess: nudged.model.cells[focal].health,
      outlook: weighted(nudged, [focal], group => group.outlook),
    });
}

function distributionSimulation(): SimulationResult {
  const seed = 'emergence-distribution';
  const [baselineStart, nudgedStart] = matched(seed);
  const focal = focalCell(nudgedStart);
  const adults = nudgedStart.model.populationGroups[focal]
    .filter(group => group.lifeStage === 'adult')
    .sort((a, b) => b.count - a.count || a.id - b.id);
  const targetArchetype = adults[0].archetype;
  for (const group of nudgedStart.model.populationGroups[focal]) {
    if (group.archetype !== targetArchetype) continue;
    group.wealth = Math.min(group.wealth, 2);
    group.income *= 0.25;
    group.wellbeing = Math.max(0, group.wellbeing - 0.2);
  }
  const target = (group: PopulationGroup) => group.archetype === targetArchetype;
  const peers = (group: PopulationGroup) => group.archetype !== targetArchetype;
  const baseline = run(baselineStart, 5);
  const nudged = run(nudgedStart, 5);
  return result('DISTRIBUTIONAL-REACTION1', seed, 5,
    'Impoverish one locally common archetype while leaving its neighbors and local peers unchanged.', {
      targetApprovalGap: weighted(baseline, [focal], group => group.approval, target)
        - weighted(baseline, [focal], group => group.approval, peers),
      targetMobilizationGap: weighted(baseline, [focal], group => group.mobilization, target)
        - weighted(baseline, [focal], group => group.mobilization, peers),
      targetOutlook: weighted(baseline, [focal], group => group.outlook, target),
    }, {
      targetApprovalGap: weighted(nudged, [focal], group => group.approval, target)
        - weighted(nudged, [focal], group => group.approval, peers),
      targetMobilizationGap: weighted(nudged, [focal], group => group.mobilization, target)
        - weighted(nudged, [focal], group => group.mobilization, peers),
      targetOutlook: weighted(nudged, [focal], group => group.outlook, target),
    });
}

const simulations = [
  unrestSimulation,
  overloadSimulation,
  epidemicSimulation,
  displacementSimulation,
  divergenceSimulation,
  policyShockSimulation,
  expectationsSimulation,
  salienceSimulation,
  cascadeSimulation,
  distributionSimulation,
];

for (const simulate of simulations) {
  console.log(JSON.stringify(simulate()));
}
