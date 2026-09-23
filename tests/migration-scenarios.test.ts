import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/world';
import { enact } from '../src/sim/policy';
import { step } from '../src/sim/engine';
import { defaultRules } from '../src/sim/rules';
import type { Game } from '../src/sim/types';

const rules = defaultRules.filter(rule => rule.phase !== 'events');
const withoutMigration = rules.filter(rule => rule.phase !== 'migration');
const run = (start: Game, useMigration = true): Game => {
  let game = start;
  for (let month = 0; month < 48; month++) game = step(game, useMigration ? rules : withoutMigration);
  return game;
};
const factory = (start: Game, id: number) => enact(start,
  { type: 'subsidy', sector: 'manufacturing', amount: 3, scope: { kind: 'cells', ids: [id] } });

test('local industry draws residents when earnings rise and food stays accessible', () => {
  const seed = 'alder-42', id = 113;
  const start = createGame(seed, 12, 12, 48);
  assert.equal(start.model.neighbors[id].length, 4, 'the treated town has four local connections');
  const baseline = run(start).model.cells[id];
  const treatment = factory(start, id);
  const developed = run(treatment).model.cells[id];
  const immobile = run(treatment, false).model.cells[id];
  const restricted = run(enact(treatment, { type: 'law', law: 'freeMovement', enabled: false })).model.cells[id];
  assert.ok(developed.manufacturing > baseline.manufacturing + .5, 'the subsidy changes local work');
  assert.ok(developed.output / developed.population > baseline.output / baseline.population + 1,
    'local cash-generating output per resident rises');
  assert.ok(developed.foodSecurity > .9 && developed.price < 1, 'food remains accessible and affordable');
  assert.ok(developed.population > baseline.population + 20, 'the town gains residents relative to the matched map');
  assert.ok(developed.population > immobile.population + 30, 'migration causes the extra local growth');
  assert.ok(restricted.population < developed.population - 30 && restricted.population > immobile.population,
    'movement restrictions dampen the economic inflow without removing local jobs');
});

test('food scarcity drives residents away despite a nominal factory-output gain', () => {
  const seed = 'marlow', id = 114;
  const start = createGame(seed, 12, 12, 48);
  assert.equal(start.model.neighbors[id].length, 4, 'the treated city has four local connections');
  const baseline = run(start).model.cells[id];
  const treatment = factory(start, id);
  const developed = run(treatment).model.cells[id];
  const immobile = run(treatment, false).model.cells[id];
  assert.ok(developed.manufacturing > baseline.manufacturing + .5, 'the subsidy changes local work');
  assert.ok(developed.output / developed.population > baseline.output / baseline.population + 1,
    'nominal output per resident still rises');
  assert.ok(developed.foodSecurity < baseline.foodSecurity - .1, 'food access deteriorates');
  assert.ok(developed.price > baseline.price + .3, 'the staple cost rises');
  assert.ok(developed.population < baseline.population - 5, 'the city loses residents relative to the matched map');
  assert.ok(developed.population < immobile.population - 30, 'outmigration explains the loss');
});
