import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/world';
import { step, assertModel } from '../src/sim/engine';
import { enact } from '../src/sim/policy';
import { summarize } from '../src/sim/math';
import { defaultRules } from '../src/sim/rules';
import type { Action, Game, Summary } from '../src/sim/types';

// Extreme scenarios are stress tests for causal mechanisms, not predictions that every harsh
// policy package must produce one predetermined catastrophe.
const rules = defaultRules.filter(rule => rule.id !== 'stories.events');
const seeds = ['alder-42', 'marlow'];
const services = ['health', 'education', 'police', 'infrastructure', 'welfare', 'culture', 'environment'] as const;
const tax = (rate: number): Action[] => [
  { type: 'tax', tax: 'incomeTax', rate },
  { type: 'tax', tax: 'businessTax', rate },
];
const spend = (amount: number): Action[] => services.map(service => ({ type: 'spending', service, amount }));
const subsidy = (sector: 'sports' | 'manufacturing'): Action => ({
  type: 'subsidy', sector, amount: 3, scope: { kind: 'national' },
});
type Frame = Summary & { revenue: number; funding: number };

function run(initial: Game, months = 48): { game: Game; frames: Frame[] } {
  let game = initial;
  const frames: Frame[] = [];
  for (let i = 0; i < months; i++) {
    game = step(game, rules);
    assertModel(game.model);
    frames.push({
      ...summarize(game.model),
      revenue: game.model.budget.revenue / game.initial.population,
      funding: game.model.budget.funding,
    });
  }
  return { game, frames };
}

const scenario = (seed: string, actions: Action[] = [], months = 48) => run(
  actions.length ? enact(createGame(seed, 12, 12, months), actions) : createGame(seed, 12, 12, months),
  months,
);
const last = (frames: Frame[]) => frames.at(-1)!;
const lateRevenue = (frames: Frame[]) => frames.slice(-12)
  .reduce((sum, frame) => sum + frame.revenue, 0) / 12;

test('maximum tax plus no police or welfare depletes reserves and raises crime', () => {
  for (const seed of seeds) {
    const baseline = last(scenario(seed).frames);
    const punitive = last(scenario(seed, [
      ...tax(.65),
      { type: 'spending', service: 'police', amount: 0 },
      { type: 'spending', service: 'welfare', amount: 0 },
    ]).frames);

    assert.ok(punitive.wealth < 2, `${seed}: private reserves are nearly exhausted`);
    assert.ok(punitive.crime > baseline.crime + .08, `${seed}: weak safety nets and depleted reserves raise crime`);
    assert.ok(punitive.employment < baseline.employment - .05, `${seed}: the labor market weakens`);
    assert.ok(punitive.approval < baseline.approval - .04, `${seed}: affected residents withdraw approval`);
    assert.ok(punitive.funding > .99, `${seed}: the result is not caused by an unfunded public budget`);
  }
});

test('maximum taxes with maximum service promises incur debt but suppress crime', () => {
  for (const seed of seeds) {
    const baseline = last(scenario(seed).frames);
    const maximal = last(scenario(seed, [...tax(.65), ...spend(2)]).frames);
    assert.ok(maximal.debt > baseline.population * 28, `${seed}: borrowing reaches its principal limit`);
    assert.ok(maximal.funding < .4, `${seed}: promises are rationed`);
    assert.ok(maximal.health > baseline.health + .1, `${seed}: funded health services still help`);
    assert.ok(maximal.crime < baseline.crime - .02, `${seed}: police and welfare still suppress crime`);
    assert.ok(maximal.foodSecurity > .9, `${seed}: fiscal stress does not imply famine`);
  }
});

test('zero taxes and zero services preserve more private wealth but degrade health and safety', () => {
  for (const seed of seeds) {
    const baseline = last(scenario(seed).frames);
    const minimal = last(scenario(seed, [...tax(0), ...spend(0)]).frames);
    assert.equal(minimal.revenue, 0);
    assert.equal(minimal.debt, 0, `${seed}: no public promises require borrowing`);
    assert.ok(minimal.wealth > baseline.wealth, `${seed}: more wealth remains private`);
    assert.ok(minimal.health < baseline.health - .1, `${seed}: public health deteriorates`);
    assert.ok(minimal.pollution > baseline.pollution + .05, `${seed}: environmental upkeep disappears`);
    assert.ok(minimal.crime > baseline.crime + .05, `${seed}: no policing or welfare raises crime`);
  }
});

test('both ends of the tax range have distinct fiscal failures', () => {
  for (const seed of seeds) {
    const noTax = scenario(seed, tax(0));
    const moderate = scenario(seed, tax(.45));
    const maximum = scenario(seed, tax(.65));
    assert.equal(lateRevenue(noTax.frames), 0);
    assert.ok(last(noTax.frames).funding < .1 && last(noTax.frames).debt > 0,
      `${seed}: zero revenue cannot sustain promised services`);
    assert.ok(maximum.frames[0].revenue > moderate.frames[0].revenue,
      `${seed}: the high rate initially collects more`);
    assert.ok(lateRevenue(maximum.frames) < lateRevenue(moderate.frames) - .1,
      `${seed}: the high rate eventually collects less after the economy responds`);
    assert.ok(last(maximum.frames).wealth < last(moderate.frames).wealth,
      `${seed}: high tax exhausts more private cash`);
  }
});

test('industrial support plus neglected health and environment worsens pollution and illness', () => {
  for (const seed of seeds) {
    const industrial = last(scenario(seed, [subsidy('manufacturing')]).frames);
    const neglected = last(scenario(seed, [
      subsidy('manufacturing'),
      { type: 'spending', service: 'health', amount: 0 },
      { type: 'spending', service: 'environment', amount: 0 },
    ]).frames);

    assert.ok(neglected.pollution > industrial.pollution + .05, `${seed}: environmental neglect raises pollution`);
    assert.ok(neglected.health < industrial.health - .1, `${seed}: health deteriorates materially`);
    assert.ok(neglected.happiness < industrial.happiness - .015, `${seed}: illness reaches lived wellbeing`);
    assert.ok(neglected.output < industrial.output * .97, `${seed}: the unhealthy economy also produces less`);
  }
});

test('stacking large sector subsidies strains the budget without requiring a food crisis', () => {
  for (const seed of seeds) {
    const baseline = last(scenario(seed).frames);
    const distortedRun = scenario(seed, [subsidy('sports'), subsidy('manufacturing')]);
    const distorted = last(distortedRun.frames);
    const worstFood = Math.min(...distortedRun.frames.map(frame => frame.foodSecurity));

    assert.ok(distorted.funding < .7, `${seed}: large subsidies compete with other public spending`);
    assert.ok(distorted.debt > 0, `${seed}: the package requires borrowing`);
    assert.ok(distorted.pollution > baseline.pollution + .1, `${seed}: the industrial shift has environmental costs`);
    assert.ok(distorted.health < baseline.health - .02, `${seed}: those costs reach health`);
    assert.ok(worstFood > .9, `${seed}: sector distortion need not become famine; worst food security was ${worstFood}`);
  }
});
