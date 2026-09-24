import test from 'node:test';
import assert from 'node:assert/strict';
import { step } from '../src/sim/engine';
import {
  migrationRule,
  policyAdjustmentRule,
  populationAggregationRule,
  populationComparisonRule,
  populationInfectionRule,
  populationMobilizationRule,
  populationPolicyAdjustmentRule,
  populationSalienceRule,
  serviceCapacityRule,
  serviceStrainRule,
  environmentRule,
  populationEnvironmentImpactRule,
} from '../src/sim/rules';
import type { Game, PopulationGroup, Rule } from '../src/sim/types';
import { createGame } from '../src/sim/world';

const make = (seed: string) => createGame(seed, 12, 12, 18);
const land = (game: Game) => game.model.cells.filter(cell => cell.biome !== 'water');
const focal = (game: Game) => [...land(game)].sort((a, b) => b.population - a.population || a.id - b.id)[0];
const run = (game: Game, months: number, rules: readonly Rule[]) => {
  let current = game;
  for (let month = 0; month < months; month += 1) current = step(current, rules);
  return current;
};
const weighted = (
  game: Game,
  cells: readonly number[],
  value: (group: PopulationGroup) => number,
) => {
  let mass = 0;
  let total = 0;
  for (const id of cells) for (const group of game.model.populationGroups[id]) {
    mass += group.count;
    total += group.count * value(group);
  }
  return total / Math.max(mass, 1e-12);
};

test('service overload creates disruption and lowers effective access before capacity catches up', () => {
  const baselineStart = make('overload-mechanism');
  const nudgedStart = structuredClone(baselineStart);
  const id = focal(nudgedStart).id;
  nudgedStart.model.cells[id].healthCapacity *= 0.4;
  nudgedStart.model.cells[id].educationCapacity *= 0.4;
  const rules = [serviceCapacityRule, serviceStrainRule, environmentRule, populationEnvironmentImpactRule];
  const baseline = run(baselineStart, 4, rules);
  const nudged = run(nudgedStart, 4, rules);
  assert.ok(nudged.model.cells[id].healthDisruption > baseline.model.cells[id].healthDisruption + 0.05);
  assert.ok(nudged.model.cells[id].educationDisruption > baseline.model.cells[id].educationDisruption + 0.05);
  assert.ok(nudged.model.cells[id].health < baseline.model.cells[id].health);
  assert.ok(nudged.model.cells[id].education < baseline.model.cells[id].education);
  assert.ok(nudged.model.cells[id].healthCapacity > nudgedStart.model.cells[id].healthCapacity,
    'funded capacity should already be adapting upward');
});

test('an infection nudge propagates into neighboring residents and local health', () => {
  const baselineStart = make('infection-mechanism');
  const nudgedStart = structuredClone(baselineStart);
  const id = focal(nudgedStart).id;
  const neighbor = nudgedStart.model.neighbors[id][0];
  for (const group of nudgedStart.model.populationGroups[id]) group.infection = 0.32;
  const rules = [populationInfectionRule, populationAggregationRule];
  const baseline = run(baselineStart, 4, rules);
  const nudged = run(nudgedStart, 4, rules);
  assert.ok(nudged.model.cells[id].infection > baseline.model.cells[id].infection + 0.08);
  assert.ok(nudged.model.cells[neighbor].infection > baseline.model.cells[neighbor].infection);
  assert.ok(weighted(nudged, [id], group => group.health)
    < weighted(baseline, [id], group => group.health));
});

test('a severe local crisis displaces residents even outside the ordinary quarterly cadence', () => {
  const baselineStart = make('displacement-mechanism');
  const nudgedStart = structuredClone(baselineStart);
  const id = focal(nudgedStart).id;
  const sourceBefore = nudgedStart.model.cells[id].population;
  nudgedStart.model.cells[id].foodSecurity = 0.12;
  nudgedStart.model.cells[id].waterStress = 0.95;
  nudgedStart.model.cells[id].healthDisruption = 0.7;
  const baseline = run(baselineStart, 1, [migrationRule]);
  const nudged = run(nudgedStart, 1, [migrationRule]);
  assert.equal(baseline.model.tick, 1, 'the matched month is not an ordinary quarterly migration month');
  assert.ok(nudged.model.cells[id].population < sourceBefore);
  assert.ok(nudged.model.cells[id].population < baseline.model.cells[id].population);
});

test('an abrupt policy change creates temporary adjustment pressure experienced by people', () => {
  const baselineStart = make('policy-shock-mechanism');
  const nudgedStart = structuredClone(baselineStart);
  const id = focal(nudgedStart).id;
  nudgedStart.model.policy.incomeTax = 0.62;
  nudgedStart.model.policy.spending.health = 1.2;
  const rules = [policyAdjustmentRule, populationPolicyAdjustmentRule, populationAggregationRule];
  const baseline = run(baselineStart, 1, rules);
  const nudged = run(nudgedStart, 1, rules);
  assert.ok(nudged.model.cells[id].policyAdjustment > baseline.model.cells[id].policyAdjustment + 0.1);
  assert.ok(weighted(nudged, [id], group => group.outlook)
    < weighted(baseline, [id], group => group.outlook));
  const later = run(nudged, 3, rules);
  assert.ok(later.model.cells[id].policyAdjustment < nudged.model.cells[id].policyAdjustment,
    'adjustment pressure should fade after the new policy regime becomes familiar');
});

test('local danger raises safety salience while political hardship builds mobilization', () => {
  const baselineStart = make('salience-mobilization-mechanism');
  const nudgedStart = structuredClone(baselineStart);
  const id = focal(nudgedStart).id;
  nudgedStart.model.cells[id].crime = 0.72;
  for (const group of nudgedStart.model.populationGroups[id]) {
    group.approval = 0.24;
    group.wellbeing = 0.38;
    group.outlook = -0.5;
  }
  const rules = [populationSalienceRule, populationMobilizationRule, populationAggregationRule];
  const baseline = run(baselineStart, 4, rules);
  const nudged = run(nudgedStart, 4, rules);
  assert.ok(weighted(nudged, [id], group => group.salienceSafety)
    > weighted(baseline, [id], group => group.salienceSafety) + 0.05);
  assert.ok(nudged.model.cells[id].unrest > baseline.model.cells[id].unrest + 0.05);
});

test('relative regional decline creates additional pessimism and mobilization', () => {
  const baselineStart = make('regional-divergence-mechanism');
  const nudgedStart = structuredClone(baselineStart);
  const region = focal(nudgedStart).region;
  const ids = land(nudgedStart).filter(cell => cell.region === region).map(cell => cell.id);
  for (const id of ids) for (const group of nudgedStart.model.populationGroups[id]) {
    group.wellbeing = Math.max(0, group.wellbeing - 0.18);
  }
  const rules = [populationComparisonRule, populationMobilizationRule, populationAggregationRule];
  const baseline = run(baselineStart, 4, rules);
  const nudged = run(nudgedStart, 4, rules);
  assert.ok(weighted(nudged, ids, group => group.outlook)
    < weighted(baseline, ids, group => group.outlook));
  assert.ok(weighted(nudged, ids, group => group.approval)
    < weighted(baseline, ids, group => group.approval));
  assert.ok(weighted(nudged, ids, group => group.mobilization)
    > weighted(baseline, ids, group => group.mobilization));
});
