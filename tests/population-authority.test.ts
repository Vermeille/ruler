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
import { migrationRule, societyRule, defaultRules } from '../src/sim/rules';
import { SECTORS, type Effect, type Game } from '../src/sim/types';
import { step } from '../src/sim/engine';
import { createGame } from '../src/sim/world';

const game = () => createGame('population-authority-tests', 12, 12, 48);
const land = (g: Game) => g.model.cells.find(cell => cell.biome !== 'water')!;
const effects = (rule: typeof societyRule | typeof migrationRule, g: Game): Effect[] => rule.run({
  model: deepFreeze(structuredClone(g.model)),
  random: () => 0.5,
  lastEvents: {},
});

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

test('default engine no longer runs the aggregate labor-share adaptation rule', () => {
  assert.ok(!defaultRules.some(rule => rule.id === 'economy.labor'));
  assert.ok(defaultRules.some(rule => rule.id === 'population.retraining'));
  assert.ok(defaultRules.some(rule => rule.id === 'population.aggregate'));
});

test('employment transitions start from population groups, not the stale mapxel employment projection', () => {
  const lowProjection = game();
  const highProjection = structuredClone(lowProjection);
  const cell = land(lowProjection);
  lowProjection.model.cells[cell.id].employment = 0;
  highProjection.model.cells[cell.id].employment = 1;

  const transitions = (g: Game) => effects(societyRule, g)
    .filter((effect): effect is Extract<Effect, { kind: 'population-transition' }> =>
      effect.kind === 'population-transition' && 'employed' in effect.transition)
    .map(effect => ({ group: effect.group, amount: effect.amount, employed: effect.transition.employed }));

  assert.deepEqual(transitions(lowProjection), transitions(highProjection));
});

test('migration emerges from individual group circumstances rather than one precomputed cell flow', () => {
  const g = game();
  const from = g.model.cells.find(cell => cell.biome !== 'water' && g.model.neighbors[cell.id].length > 0)!;
  const to = g.model.cells[g.model.neighbors[from.id][0]];
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
    happiness: 0.3,
    foodSecurity: 0.55,
    price: 2,
    crime: 0.35,
    pollution: 0.35,
    health: 0.55,
    education: 0.55,
    output: from.population * 2,
  });
  Object.assign(to, {
    happiness: 0.85,
    foodSecurity: 1,
    price: 0.8,
    crime: 0.02,
    pollution: 0.02,
    health: 0.9,
    education: 0.9,
    output: to.population * 8,
  });
  g.model.tick = 3;

  const moves = effects(migrationRule, g).filter((effect): effect is Extract<Effect, { kind: 'population-transfer' }> =>
    effect.kind === 'population-transfer' && effect.from === from.id && effect.to === to.id);
  const a = moves.find(effect => effect.group === first.id);
  const b = moves.find(effect => effect.group === second.id);
  assert.ok(a && b);
  assert.notEqual(a.amount, b.amount);
});
