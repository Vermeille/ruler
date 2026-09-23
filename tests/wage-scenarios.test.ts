import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/world';
import { enact } from '../src/sim/policy';
import { step } from '../src/sim/engine';
import { summarize } from '../src/sim/math';
import { defaultRules } from '../src/sim/rules';
import type { Game } from '../src/sim/types';

const rules = defaultRules.filter(rule => rule.phase !== 'events');
const business = (game: Game) => {
  const cells = game.model.cells.filter(c => c.biome !== 'water');
  const population = cells.reduce((sum, c) => sum + c.population, 0);
  return cells.reduce((sum, c) => sum + c.population * c.businessHealth, 0) / population;
};
const run = (game: Game, months: number) => {
  const frames: { employment: number; wealth: number; output: number; foodSecurity: number; crime: number; business: number }[] = [];
  for (let month = 0; month < months; month++) {
    game = step(game, rules);
    const summary = summarize(game.model);
    frames.push({ ...summary, business: business(game) });
  }
  return { game, frames };
};

test('an unaffordable wage floor produces business contraction, mass unemployment, and poverty through local rules', () => {
  for (const seed of ['alder-42', 'marlow']) {
    const start = createGame(seed, 12, 12, 48);
    const ordinary = run(start, 48), moderate = run(enact(start, { type: 'minimumWage', amount: 2 }), 48);
    const extreme = run(enact(start, { type: 'minimumWage', amount: 8 }), 48);
    const ceiling = run(enact(start, { type: 'minimumWage', amount: 10 }), 48);
    const a = ordinary.frames.at(-1)!, m = moderate.frames.at(-1)!, b = extreme.frames.at(-1)!, c = ceiling.frames.at(-1)!;
    assert.ok(extreme.frames[0].employment < ordinary.frames[0].employment - .03, `${seed}: hiring responds first`);
    assert.ok(extreme.frames[1].output < ordinary.frames[1].output * .9, `${seed}: lost labor reduces next-month output`);
    assert.ok(b.business < .25 && b.business < a.business - .6, `${seed}: local firms remain distressed`);
    assert.ok(b.employment < .3 && b.employment < m.employment - .4, `${seed}: unemployment becomes severe`);
    assert.ok(b.output < a.output * .4, `${seed}: production and receipts contract`);
    assert.ok(b.wealth < 3 && b.wealth < a.wealth * .1, `${seed}: private cash depletion reaches poverty`);
    assert.ok(b.crime > a.crime + .4, `${seed}: poverty and unemployment reach safety`);
    assert.ok(b.foodSecurity < a.foodSecurity - .3, `${seed}: lost farm labor reaches food access`);
    assert.ok(m.employment > b.employment + .4 && m.wealth > b.wealth + 15,
      `${seed}: an ordinary floor does not reproduce the extreme collapse`);
    assert.ok(c.employment < b.employment - .04 && c.wealth < b.wealth,
      `${seed}: the maximum floor is worse and remains numerically valid`);
  }
});

test('repealing the unaffordable floor restores viable hiring and output over time', () => {
  for (const seed of ['alder-42', 'marlow']) {
    const start = enact(createGame(seed, 12, 12, 48), { type: 'minimumWage', amount: 8 });
    const first = run(start, 12), crisis = first.frames.at(-1)!;
    const recovered = run(enact(first.game, { type: 'minimumWage', amount: 0 }), 36).frames.at(-1)!;
    const sustained = run(start, 48).frames.at(-1)!;
    assert.ok(recovered.employment > crisis.employment + .5 && recovered.employment > sustained.employment + .6,
      `${seed}: firms can hire again when payroll is affordable`);
    assert.ok(recovered.business > sustained.business + .6 && recovered.output > sustained.output * 2,
      `${seed}: businesses and production recover`);
    assert.ok(recovered.wealth > sustained.wealth + 15, `${seed}: renewed receipts rebuild private reserves`);
  }
});

test('the wage shock persists on the standard map without invalid transfers', () => {
  const start = enact(createGame('alder-42', 36, 26, 48), { type: 'minimumWage', amount: 8 });
  const result = run(start, 48);
  const final = result.frames.at(-1)!;
  assert.ok(final.employment < .3 && final.business < .25);
  assert.ok(final.wealth < 3 && final.crime > .45);
});
