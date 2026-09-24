import test from 'node:test';
import assert from 'node:assert/strict';
import { deepFreeze } from '../src/sim/math';
import { populationAggregationRule } from '../src/sim/population/aggregation';
import {
  approvalOf,
  employmentOf,
  occupationShareOf,
  wellbeingOf,
} from '../src/sim/population/selectors';
import {
  defaultRules,
  migrationRule,
  populationEmploymentRule,
  retrainingRule,
} from '../src/sim/rules';
import { SECTORS, type Effect, type Game, type Rule } from '../src/sim/types';
import { step } from '../src/sim/engine';
import { createGame } from '../src/sim/world';

const game = () => createGame('population-authority-tests', 12, 12, 48);
const land = (g: Game) => g.model.cells.find(cell => cell.biome !== 'water')!;
const effects = (rule: Rule, g: Game, draw = 0.5): Effect[] => rule.run({
  model: deepFreeze(structuredClone(g.model)),
  random: () => draw,
  lastEvents: {},
});
const projectedHumanFields = new Set([
  'employment', 'happiness', 'approval', 'children', 'seniors',
  ...SECTORS,
]);

test('population aggregation makes groups authoritative over social and labor mapxel projections', () => {
  const g = game();
  const cell = land(g);
  const groups = g.model.populationGroups[cell.id];

  for (const group of groups) {
    group.wellbeing = 0.23;
    group.approval = 0.31;
    if (group.lifeStage === 'adult') group.employed = group.occupation === 'services';
  }

  const next = step(g, [populationAggregationRule]);
  const projected = next.model.cells[cell.id];
  assert.ok(Math.abs(projected.happiness - wellbeingOf(next.model, cell.id)) < 1e-10);
  assert.ok(Math.abs(projected.approval - approvalOf(next.model, cell.id)) < 1e-10);
  assert.ok(Math.abs(projected.employment - employmentOf(next.model, cell.id)) < 1e-10);
  for (const sector of SECTORS) {
    assert.ok(Math.abs(projected[sector] - occupationShareOf(next.model, cell.id, sector)) < 1e-10);
  }
});

test('only population projection writes cached human mapxel fields in the default engine', () => {
  const g = game();
  g.model.tick = 12;
  for (const rule of defaultRules) {
    for (const draw of [0, 0.5, 0.999]) {
      for (const effect of effects(rule, g, draw)) {
        if (effect.kind !== 'delta' || !projectedHumanFields.has(effect.field)) continue;
        assert.equal(rule.id, 'population.aggregate',
          `${rule.id} directly writes projected human field ${effect.field}`);
      }
    }
  }
});

test('default engine uses population rules for employment, retraining, and projection', () => {
  assert.ok(!defaultRules.some(rule => rule.id === 'economy.labor'));
  assert.ok(defaultRules.some(rule => rule.id === 'population.employment'));
  assert.ok(defaultRules.some(rule => rule.id === 'population.retraining'));
  assert.ok(defaultRules.some(rule => rule.id === 'population.aggregate'));
  assert.equal(populationAggregationRule.phase, 'projection');
});

test('employment transitions start from population groups, not the stale mapxel employment projection', () => {
  const lowProjection = game();
  const highProjection = structuredClone(lowProjection);
  const cell = land(lowProjection);
  lowProjection.model.cells[cell.id].employment = 0;
  highProjection.model.cells[cell.id].employment = 1;

  const transitions = (g: Game) => effects(populationEmploymentRule, g)
    .filter((effect): effect is Extract<Effect, { kind: 'population-transition' }> =>
      effect.kind === 'population-transition' && 'employed' in effect.transition)
    .map(effect => ({ group: effect.group, amount: effect.amount, employed: effect.transition.employed }));

  assert.deepEqual(transitions(lowProjection), transitions(highProjection));
});

test('employed adults can switch sectors when policy makes another occupation materially better', () => {
  const g = game();
  const cell = land(g);
  g.model.tick = 6;
  g.model.budget.funding = 1;
  g.model.policy.subsidies.sports = 3;
  cell.sportsInterest = 1;
  const source = g.model.populationGroups[cell.id].find(group =>
    group.lifeStage === 'adult' && group.employed && group.occupation !== 'sports' && group.count >= 1)!;

  // A zero draw realizes any positive expected sub-person cohort. This test is about the
  // direction/mechanism; unbiased stochastic rounding is tested separately.
  const transition = effects(retrainingRule, g, 0).find((effect): effect is Extract<Effect, { kind: 'population-transition' }> =>
    effect.kind === 'population-transition' && effect.group === source.id);
  assert.ok(transition);
  assert.equal(transition.transition.occupation, 'sports');
  assert.equal(transition.transition.employed, undefined);
  assert.ok(transition.amount > 0 && transition.amount <= source.count);
});

test('migration emerges from individual group circumstances rather than one precomputed cell flow', () => {
  const g = game();
  const from = g.model.cells.find(cell => cell.biome !== 'water'
    && g.model.neighbors[cell.id].some(id => g.model.cells[id].biome !== 'water'))!;
  const toId = g.model.neighbors[from.id].find(id => g.model.cells[id].biome !== 'water')!;
  const to = g.model.cells[toId];
  const archetypeGroups = g.model.populationGroups[from.id].filter(group => group.lifeStage === 'adult');
  const first = archetypeGroups[0];
  const second = archetypeGroups.find(group => group.archetype === first.archetype
    && group.occupation === first.occupation && group.employed !== first.employed);
  assert.ok(second);

  first.count = 10;
  second.count = 10;
  first.wealth = second.wealth = 8;
  first.wellbeing = second.wellbeing = 0.45;
  first.income = second.income = 1;

  Object.assign(from, {
    foodSecurity: 0.55,
    price: 2,
    crime: 0.35,
    pollution: 0.35,
    health: 0.55,
    education: 0.55,
    output: from.population * 2,
  });
  for (const neighborId of g.model.neighbors[from.id]) {
    const neighbor = g.model.cells[neighborId];
    if (neighbor.biome === 'water' || neighbor.id === to.id) continue;
    Object.assign(neighbor, {
      foodSecurity: 0.2,
      price: 4,
      crime: 0.7,
      pollution: 0.7,
      health: 0.3,
      education: 0.3,
      output: neighbor.population,
    });
    for (const group of g.model.populationGroups[neighbor.id]) group.wellbeing = 0.1;
  }
  Object.assign(to, {
    foodSecurity: 1,
    price: 0.8,
    crime: 0.02,
    pollution: 0.02,
    health: 0.9,
    education: 0.9,
    output: to.population * 8,
  });
  for (const group of g.model.populationGroups[to.id]) group.wellbeing = 0.85;
  g.model.tick = 3;

  // Cohort actions are stochastically rounded to person-scale units. Average deterministic
  // draws to recover the underlying expected flow instead of comparing one lottery result.
  const expectedMove = (group: number) => {
    const samples = 200;
    let total = 0;
    for (let index = 0; index < samples; index += 1) {
      const draw = (index + 0.5) / samples;
      const move = effects(migrationRule, g, draw).find((effect): effect is Extract<Effect, { kind: 'population-transfer' }> =>
        effect.kind === 'population-transfer'
          && effect.from === from.id
          && effect.to === to.id
          && effect.group === group);
      total += move?.amount ?? 0;
    }
    return total / samples;
  };

  const a = expectedMove(first.id);
  const b = expectedMove(second.id);
  assert.ok(a > 0 && b > 0);
  assert.ok(Math.abs(a - b) > 1e-3);
});
