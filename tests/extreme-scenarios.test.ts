import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/sim/world';
import { step, assertModel } from '../src/sim/engine';
import { enact } from '../src/sim/policy';
import { summarize } from '../src/sim/math';
import { defaultRules, eventRule } from '../src/sim/rules';
import type { Action, Game, Summary } from '../src/sim/types';

// Scenario labels describe exact available controls, not real political systems.
// Remove chance events so each paired run differs only by its stated intervention.
const rules = defaultRules.filter(rule => rule.phase !== 'events');
const seeds = ['alder-42', 'marlow'];
const services = ['health', 'education', 'police', 'infrastructure', 'welfare', 'culture', 'environment'] as const;
const tax = (rate: number): Action[] => [{ type: 'tax', tax: 'incomeTax', rate }, { type: 'tax', tax: 'businessTax', rate }];
const spend = (amount: number): Action[] => services.map(service => ({ type: 'spending', service, amount }));
const subsidy = (sector: 'sports' | 'manufacturing'): Action => ({ type: 'subsidy', sector, amount: 3, scope: { kind: 'national' } });
type Frame = Summary & { revenue: number; funding: number; lowestCellFood: number };
function run(initial: Game, months = 48): { game: Game; frames: Frame[] } {
  let game = initial;
  const frames: Frame[] = [];
  for (let i = 0; i < months; i++) {
    game = step(game, rules);
    assertModel(game.model);
    frames.push({ ...summarize(game.model), revenue: game.model.budget.revenue / game.initial.population,
      funding: game.model.budget.funding,
      lowestCellFood: Math.min(...game.model.cells.filter(c => c.biome !== 'water').map(c => c.foodSecurity)) });
  }
  return { game, frames };
}
const scenario = (seed: string, actions: Action[] = [], months = 48) => run(actions.length ? enact(createGame(seed, 12, 12, months), actions) : createGame(seed, 12, 12, months), months);
const last = (frames: Frame[]) => frames.at(-1)!;
const lateRevenue = (frames: Frame[]) => frames.slice(-12).reduce((sum, frame) => sum + frame.revenue, 0) / 12;

test('maximum tax plus no police or welfare creates high national crime and depleted private cash', () => {
  for (const seed of seeds) {
    const reference = scenario(seed), baseline = last(reference.frames);
    const punitive = scenario(seed, [...tax(.65), { type: 'spending', service: 'police', amount: 0 }, { type: 'spending', service: 'welfare', amount: 0 }]);
    const final = last(punitive.frames);
    assert.ok(final.wealth < 1.5, `${seed}: private reserves depleted`);
    assert.ok(final.crime > .4 && final.crime > baseline.crime + .35, `${seed}: crime becomes nationally severe`);
    assert.ok(final.happiness < baseline.happiness - .2, `${seed}: wellbeing deteriorates`);
    assert.ok(final.approval < .5, `${seed}: support falls`);
    assert.ok(final.funding > .99, `${seed}: crime is not caused by an empty public budget`);
    const riskRoll = (_cell: number, channel = '') => channel === 'crime-roll' ? .2 : 0;
    const violentCrime = (game: Game) => eventRule.run({ model: game.model, random: riskRoll, lastEvents: {} })
      .some(effect => effect.kind === 'event' && effect.key === 'violentCrime');
    assert.equal(violentCrime(reference.game), false, `${seed}: the same roll does not trigger baseline crime`);
    assert.equal(violentCrime(punitive.game), true, `${seed}: higher crime raises event risk`);
  }
});

test('maximum taxes with maximum service promises incur debt but actually suppress crime', () => {
  for (const seed of seeds) {
    const baseline = last(scenario(seed).frames);
    const maximal = last(scenario(seed, [...tax(.65), ...spend(2)]).frames);
    assert.ok(maximal.debt > baseline.population * 28, `${seed}: borrowing reaches its principal limit`);
    assert.ok(maximal.funding < .4, `${seed}: promises are rationed`);
    assert.ok(maximal.health > baseline.health + .1, `${seed}: funded health services still help`);
    assert.ok(maximal.crime < baseline.crime - .02, `${seed}: police and welfare still suppress crime`);
    assert.ok(maximal.foodSecurity > .9, `${seed}: this package does not itself cause famine`);
  }
});

test('zero taxes and zero services preserve private cash but degrade health and safety', () => {
  for (const seed of seeds) {
    const baseline = last(scenario(seed).frames);
    const minimal = last(scenario(seed, [...tax(0), ...spend(0)]).frames);
    assert.equal(minimal.revenue, 0);
    assert.equal(minimal.debt, 0, `${seed}: no public promises require borrowing`);
    assert.ok(minimal.wealth > baseline.wealth + 5, `${seed}: cash stays private`);
    assert.ok(minimal.health < baseline.health - .1, `${seed}: public health deteriorates`);
    assert.ok(minimal.pollution > baseline.pollution + .05, `${seed}: environmental upkeep disappears`);
    assert.ok(minimal.crime > baseline.crime + .07, `${seed}: no policing or welfare raises crime`);
  }
});

test('both ends of the tax range have distinct fiscal failures', () => {
  for (const seed of seeds) {
    const noTax = scenario(seed, tax(0));
    const moderate = scenario(seed, tax(.45));
    const maximum = scenario(seed, tax(.65));
    assert.equal(lateRevenue(noTax.frames), 0);
    assert.ok(last(noTax.frames).funding < .1 && last(noTax.frames).debt > 0, `${seed}: zero revenue cannot sustain promised services`);
    assert.ok(maximum.frames[0].revenue > moderate.frames[0].revenue, `${seed}: the high rate initially collects more`);
    assert.ok(lateRevenue(maximum.frames) < lateRevenue(moderate.frames) - .1, `${seed}: the high rate collects less after cash and output respond`);
    assert.ok(last(maximum.frames).wealth < last(moderate.frames).wealth, `${seed}: high tax exhausts private cash`);
  }
});

test('industrial subsidies with no health or environmental spending cause pollution and illness', () => {
  for (const seed of seeds) {
    const industrial = scenario(seed, [subsidy('manufacturing')]);
    const neglected = scenario(seed, [subsidy('manufacturing'), { type: 'spending', service: 'health', amount: 0 }, { type: 'spending', service: 'environment', amount: 0 }]);
    const a = last(industrial.frames), b = last(neglected.frames);
    assert.ok(b.pollution > .65 && b.pollution > a.pollution + .07, `${seed}: pollution rises`);
    assert.ok(b.health < .45 && b.health < a.health - .1, `${seed}: health falls`);
    assert.ok(b.happiness < a.happiness - .04, `${seed}: illness reaches wellbeing`);
    assert.ok(b.population < a.population - 100, `${seed}: the net demographic trajectory worsens`);
  }
});

test('diverting labor from farming leaves most food needs unmet for multiple months', () => {
  for (const seed of seeds) {
    const baselineRun = scenario(seed), baseline = last(baselineRun.frames);
    const crisis = scenario(seed, [subsidy('sports'), subsidy('manufacturing')]);
    const shortage = crisis.frames.filter(frame => frame.foodSecurity < .6);
    assert.ok(shortage.length >= 6, `${seed}: food shortage is sustained, not one bad month`);
    assert.ok(Math.min(...crisis.frames.map(frame => frame.foodSecurity)) < .5, `${seed}: national food coverage falls below half`);
    assert.ok(Math.min(...crisis.frames.map(frame => frame.lowestCellFood)) < .4, `${seed}: some communities fare worse`);
    assert.ok(crisis.frames.some(frame => frame.starvationDeaths > 1), `${seed}: severe unmet food needs cause observable deaths`);
    assert.ok(crisis.frames.reduce((sum, frame) => sum + frame.starvationDeaths, 0) > 30,
      `${seed}: the crisis produces sustained mortality rather than a one-month artifact`);
    assert.ok(baselineRun.frames.every(frame => frame.starvationDeaths === 0), `${seed}: ordinary conditions do not cause starvation`);
    assert.ok(last(crisis.frames).health < baseline.health - .1, `${seed}: shortage reaches health`);
    assert.ok(last(crisis.frames).population < baseline.population - 100, `${seed}: net population falls relative to the matched baseline`);
    assert.ok(last(crisis.frames).foodSecurity > shortage[0].foodSecurity, `${seed}: feedback eventually eases the shortage`);
  }
});

test('a poor cell beside very rich neighbors develops worse local crime and outmigration', () => {
  for (const seed of seeds) {
    const ordinary = enact(createGame(seed, 12, 12, 24), [
      { type: 'spending', service: 'police', amount: 0 }, { type: 'spending', service: 'welfare', amount: 0 },
    ]);
    const poor = ordinary.model.cells.find(c => c.biome !== 'water' && ordinary.model.neighbors[c.id].length === 4)!;
    ordinary.model.externalCash += poor.cash; poor.cash = 0;
    const unequal = structuredClone(ordinary);
    for (const id of unequal.model.neighbors[poor.id]) {
      const neighbor = unequal.model.cells[id], added = neighbor.population * 150;
      neighbor.cash += added; unequal.model.externalCash -= added;
    }
    const reference = run(ordinary, 24).game.model.cells[poor.id];
    const exposed = run(unequal, 24).game.model.cells[poor.id];
    const restricted = run(enact(unequal, { type: 'law', law: 'freeMovement', enabled: false }), 24).game.model.cells[poor.id];
    assert.ok(exposed.crime > .5 && exposed.crime > reference.crime + .1, `${seed}: visible local crime hotspot`);
    assert.ok(exposed.happiness < reference.happiness - .02, `${seed}: local wellbeing suffers`);
    assert.ok(exposed.population < reference.population - 6, `${seed}: more residents leave`);
    assert.ok(restricted.population > exposed.population * 1.1, `${seed}: movement restrictions trap residents in the hotspot`);
  }
});

test('severe crime and food shortages persist on the standard 36×26 map', () => {
  const crime = run(enact(createGame('alder-42', 36, 26, 48), [
    ...tax(.65), { type: 'spending', service: 'police', amount: 0 }, { type: 'spending', service: 'welfare', amount: 0 },
  ]));
  const food = run(enact(createGame('alder-42', 36, 26, 48), [subsidy('sports'), subsidy('manufacturing')]));
  assert.ok(last(crime.frames).crime > .4, 'National crime remains severe at normal map size');
  assert.ok(Math.min(...food.frames.map(frame => frame.foodSecurity)) < .5, 'Food shortage remains severe at normal map size');
});
