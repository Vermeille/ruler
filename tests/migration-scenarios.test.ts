import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/world';
import { enact } from '../src/sim/policy';
import { step } from '../src/sim/engine';
import { defaultRules } from '../src/sim/rules';
import type { Game } from '../src/sim/types';

const rules = defaultRules.filter(rule => rule.id !== 'stories.events');
const withoutMigration = rules.filter(rule => rule.phase !== 'migration');
const run = (start: Game, useMigration = true): Game => {
  let game = start;
  for (let month = 0; month < 48; month += 1) game = step(game, useMigration ? rules : withoutMigration);
  return game;
};
const factory = (start: Game, id: number) => enact(start,
  { type: 'subsidy', sector: 'manufacturing', amount: 3, scope: { kind: 'cells', ids: [id] } });

function manufacturingShare(game: Game, id: number): number {
  const workers = game.model.populationGroups[id].filter(group =>
    group.lifeStage === 'adult' && group.employed && group.occupation !== null);
  const total = workers.reduce((sum, group) => sum + group.count, 0);
  const manufacturing = workers.reduce((sum, group) =>
    sum + (group.occupation === 'manufacturing' ? group.count : 0), 0);
  return total > 0 ? manufacturing / total : 0;
}

test('local industrial policy reallocates actual workers rather than directly rewriting a sector share', () => {
  for (const [seed, id] of [['alder-42', 113], ['marlow', 114]] as const) {
    const start = createGame(seed, 12, 12, 48);
    assert.equal(start.model.neighbors[id].length, 4, `${seed}: treated town has four local connections`);

    const baseline = run(start);
    const developed = run(factory(start, id));
    const before = manufacturingShare(baseline, id);
    const after = manufacturingShare(developed, id);

    assert.ok(after > before + .05,
      `${seed}: manufacturing workers respond materially to the local subsidy: ${before} → ${after}`);
    assert.ok(Math.abs(developed.model.cells[id].manufacturing - after) < 1e-9,
      `${seed}: mapxel manufacturing is the projection of employed residents`);
    assert.ok(developed.causes.some(cause => cause.rule === 'population.retraining'
      && cause.cells.includes(id) && cause.title.includes('manufacturing')),
      `${seed}: the change is explained by residents switching or retraining`);
  }
});

test('free movement changes a town population path without being the source of its new jobs', () => {
  const seed = 'alder-42', id = 113;
  const start = createGame(seed, 12, 12, 48);
  const treatment = factory(start, id);
  const developed = run(treatment);
  const immobile = run(treatment, false);
  const restricted = run(enact(treatment, { type: 'law', law: 'freeMovement', enabled: false }));

  const mobileCell = developed.model.cells[id];
  const immobileCell = immobile.model.cells[id];
  const restrictedCell = restricted.model.cells[id];

  assert.ok(mobileCell.population > immobileCell.population + .5,
    'open movement produces a measurably different local population path');
  assert.ok(Math.abs(restrictedCell.population - immobileCell.population) < .1,
    'strong movement restrictions leave the town close to the no-migration counterfactual');
  assert.ok(manufacturingShare(developed, id) > .3
    && manufacturingShare(immobile, id) > .3
    && manufacturingShare(restricted, id) > .3,
    'the local jobs come from worker reactions to the subsidy, not from migration itself');
  assert.ok(mobileCell.foodSecurity > .9 && restrictedCell.foodSecurity > .9,
    'this case tests mobility around a viable town, not migration forced by hunger');
});
