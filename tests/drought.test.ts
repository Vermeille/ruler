import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/world';
import { step } from '../src/sim/engine';
import { defaultRules, eventRule, productionRule } from '../src/sim/rules';
import { randomAt, summarize } from '../src/sim/math';
import type { Game, Rule } from '../src/sim/types';

// A historical mechanism target promoted into the regular regression suite.
test('a regional drought reduces the next local harvest beyond lost food stocks', () => {
  const seed = Array.from({ length: 1000 }, (_, i) => `drought-${i}`)
    .find(s => randomAt(s, 1, eventRule.id, -1, 'weather-roll') < .1);
  assert.ok(seed, 'find a deterministic drought seed');
  const base = createGame(seed, 12, 12, 14);
  const ordinary = step(base, []);
  const drought = step(base, [eventRule]);
  const event = drought.causes.find(c => c.rule === eventRule.id && c.title.startsWith('Dry weather'));
  assert.ok(event?.cells.length, 'the drought must affect a known region');
  const id = event.cells.find(cellId => drought.model.cells[cellId].agriculture > 0);
  assert.ok(id !== undefined, 'the region must contain a farming mapxel');

  const dryCell = drought.model.cells[id];
  const ordinaryCell = ordinary.model.cells[id];
  assert.ok(dryCell.food < ordinaryCell.food, 'immediate local food stocks fall');

  const dryHarvest = step(drought, [productionRule]).model.cells[id].foodMade;
  const ordinaryHarvest = step(ordinary, [productionRule]).model.cells[id].foodMade;
  assert.ok(dryHarvest < ordinaryHarvest,
    'affected farms should make less food the next month under otherwise matched conditions');
});

test('sustained regional drought cuts harvests and reaches resident health and wellbeing', () => {
  const regular = defaultRules.filter(rule => rule.id !== 'stories.events');
  const weather: Rule = {
    id: 'scenario.sustained-drought', phase: 'events', description: 'An exogenous regional dry period',
    run({ model }) {
      return model.cells.filter(c => c.biome !== 'water' && c.region === 1)
        .map(c => ({ kind: 'delta' as const, cell: c.id, field: 'waterStress' as const, amount: .8 - c.waterStress }));
    },
  };
  const run = (seed: string, dry: boolean): Game => {
    let game = createGame(seed, 12, 12, 48);
    const active = [...regular, ...(dry ? [weather] : [])];
    for (let month = 0; month < 48; month++) game = step(game, active);
    return game;
  };

  for (const seed of ['alder-42', 'marlow']) {
    const baseline = run(seed, false);
    const dry = run(seed, true);
    const ids = baseline.model.cells.filter(c => c.biome !== 'water' && c.region === 1).map(c => c.id);
    const harvest = (game: Game) => ids.reduce((total, id) => total + game.model.cells[id].foodMade, 0);
    const before = summarize(baseline.model, ids);
    const after = summarize(dry.model, ids);

    assert.ok(ids.every(id => dry.model.cells[id].waterStress > .79), `${seed}: affected mapxels stay dry`);
    assert.ok(harvest(dry) < harvest(baseline) * .7, `${seed}: local harvest contracts materially`);
    assert.ok(after.foodSecurity < before.foodSecurity - .05, `${seed}: less locally produced food reaches residents`);
    assert.ok(after.health < before.health - .02, `${seed}: sustained deprivation harms health`);
    assert.ok(after.happiness < before.happiness - .02, `${seed}: lived hardship reaches wellbeing`);
  }
});
