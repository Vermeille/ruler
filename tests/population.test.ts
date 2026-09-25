import test from 'node:test';
import assert from 'node:assert/strict';
import { assertModel, commitEffects, step } from '../src/sim/engine';
import { deepFreeze } from '../src/sim/math';
import { populationAgingRule, populationLifeStageRule } from '../src/sim/population/aging';
import { ARCHETYPE_COUNT, archetypeAt, generateArchetypes } from '../src/sim/population/archetypes';
import { populationDemographicsRule } from '../src/sim/population/demographics';
import { mergePopulation } from '../src/sim/population/merge';
import { populationExperienceRule } from '../src/sim/population/experience';
import { entryOccupationRule, retrainingRule } from '../src/sim/population/retraining';
import { approvalOf, childrenShareOf, educationOf, employmentOf, populationOf, seniorShareOf, wellbeingOf } from '../src/sim/population/selectors';
import { deserialize, serialize } from '../src/sim/save';
import { enact } from '../src/sim/policy';
import { defaultRules, migrationRule } from '../src/sim/rules';
import type { Effect, Game, PopulationGroup } from '../src/sim/types';
import { people } from '../src/sim/units';
import { createGame } from '../src/sim/world';

const game = () => createGame('population-tests', 12, 12);
const land = (g: Game) => g.model.cells.filter(cell => cell.population > 0);
const total = (g: Game) => g.model.cells.reduce((sum, cell) => sum + cell.population, 0);
const settle = (g: Game, effects: Effect[]) => commitEffects(
  g, deepFreeze(structuredClone(g.model)), effects.map(effect => ({ rule: 'test.population', effect })),
);

test('archetypes are globally deterministic baselines and local groups preserve aggregate counts', () => {
  const g = game();
  assert.equal(generateArchetypes(g.model.seed).length, ARCHETYPE_COUNT);
  assert.deepEqual(archetypeAt(g.model.seed, 431), archetypeAt(g.model.seed, 431));
  assert.notDeepEqual(archetypeAt(g.model.seed, 431), archetypeAt(g.model.seed, 432));
  assertModel(g.model);
  for (const cell of g.model.cells) {
    assert.ok(Math.abs(populationOf(g.model, cell.id) - cell.population) < 1e-9);
    if (cell.biome === 'water') assert.equal(g.model.populationGroups[cell.id].length, 0);
  }
  const cell = land(g)[0];
  assert.ok(Math.abs(approvalOf(g.model, cell.id) - cell.approval) < 1e-9);
  assert.ok(Math.abs(wellbeingOf(g.model, cell.id) - cell.happiness) < 1e-9);
  assert.ok(Math.abs(childrenShareOf(g.model, cell.id) - cell.children) < 1e-9);
  assert.ok(Math.abs(seniorShareOf(g.model, cell.id) - cell.seniors) < 1e-9);
  assert.ok(Math.abs(employmentOf(g.model, cell.id) - cell.employment) < 1e-9);
  assert.ok(Math.abs(educationOf(g.model, cell.id) - cell.education) < 0.1);
  const groups = g.model.populationGroups[cell.id];
  assert.ok(groups.some(a => groups.some(b => a.archetype === b.archetype && a.employed !== b.employed)));
});

test('partial transitions split a group while whole-group transitions preserve its ID', () => {
  const g = game();
  const cell = land(g)[0];
  const source = g.model.populationGroups[cell.id].find(group => group.lifeStage === 'adult' && group.employed)!;
  const originalCount = source.count;
  const originalTotal = total(g);
  settle(g, [{ kind: 'population-transition', cell: cell.id, group: source.id,
    amount: originalCount / 4, transition: { employed: false } }]);
  assert.ok(Math.abs(source.count - originalCount * 0.75) < 1e-9);
  const split = g.model.populationGroups[cell.id].find(group => group.id >= g.model.nextPopulationGroupId - 1)!;
  assert.equal(split.archetype, source.archetype);
  assert.equal(split.employed, false);
  assert.ok(Math.abs(split.count - originalCount / 4) < 1e-9);
  assert.ok(Math.abs(total(g) - originalTotal) < 1e-9);
  assertModel(g.model);

  const priorId = split.id;
  const priorNextId = g.model.nextPopulationGroupId;
  settle(g, [{ kind: 'population-transition', cell: cell.id, group: priorId,
    amount: split.count, transition: { occupation: 'services' } }]);
  assert.equal(split.id, priorId);
  assert.equal(split.occupation, 'services');
  assert.equal(g.model.nextPopulationGroupId, priorNextId);
});

test('competing transitions and migration share the phase-start group budget', () => {
  const g = game();
  const [from, to] = land(g);
  const source = g.model.populationGroups[from.id].find(group => group.lifeStage === 'adult')!;
  const sourceCount = source.count;
  const before = total(g);
  const destinationBefore = to.population;
  const nextId = g.model.nextPopulationGroupId;
  const effects: Effect[] = [
    { kind: 'population-transfer', from: from.id, to: to.id, group: source.id, amount: source.count * 0.7 },
    { kind: 'population-transition', cell: from.id, group: source.id, amount: source.count * 0.6,
      transition: { employed: false } },
  ];
  settle(g, effects);
  assert.ok(Math.abs(total(g) - before) < 1e-9);
  assert.ok(Math.abs(g.model.cells[to.id].population - destinationBefore - sourceCount * 0.7 / 1.3) < 1e-6);
  assert.ok(Math.abs(g.model.populationGroups[to.id].filter(group => group.id >= nextId).reduce((sum, group) => sum + group.count, 0) - sourceCount * 0.7 / 1.3) < 1e-6);
  assertModel(g.model);
});

test('birth and death effects are explicit population sources and sinks', () => {
  const g = game();
  const cell = land(g)[0];
  const source = g.model.populationGroups[cell.id][0];
  const before = total(g);
  const state: Omit<PopulationGroup, 'id' | 'archetype' | 'count'> = {
    ...structuredClone(source), age: 0, lifeStage: 'child', occupation: null, employed: false, income: 0,
  };
  settle(g, [
    { kind: 'population-delta', cell: cell.id, group: source.id, amount: 2, cause: 'death' },
    { kind: 'population-delta', cell: cell.id, archetype: source.archetype, amount: 3, cause: 'birth', state },
  ]);
  assert.ok(Math.abs(total(g) - before - 1) < 1e-9);
  assertModel(g.model);
});

test('mortality removes actual groups and yearly births create inherited children', () => {
  const g = game();
  const cell = land(g)[0];
  g.model.tick = 12;
  cell.foodSecurity = 0.1;
  cell.starvationDeaths = people(cell.population * 0.008 * ((0.7 - cell.foodSecurity) / 0.7) ** 2);
  const before = total(g);
  const snapshot = deepFreeze(structuredClone(g.model));
  const effects = populationDemographicsRule.run({ model: snapshot, random: () => 0,
    lastEvents: {} });
  const deaths = effects.filter(effect => effect.kind === 'population-delta'
    && effect.cell === cell.id && effect.cause === 'death');
  const birth = effects.find(effect => effect.kind === 'population-delta'
    && effect.cell === cell.id && effect.cause === 'birth');
  assert.ok(birth && birth.kind === 'population-delta');
  assert.ok(deaths.length > 1);
  assert.ok(deaths.every(effect => effect.kind === 'population-delta'
    && effect.group !== undefined && effect.amount > 0));
  const parent = g.model.populationGroups[cell.id].find(group => group.lifeStage === 'adult')!;
  assert.notEqual(birth.archetype, parent.archetype);
  const expected = effects.reduce((sum, effect) => effect.kind === 'population-delta'
    ? sum + (effect.cause === 'birth' ? effect.amount : -effect.amount) : sum, 0);
  settle(g, effects);
  assert.ok(Math.abs(total(g) - before - expected) < 1e-7);
  assert.ok(g.model.populationGroups[cell.id].some(group => group.age === 0 && group.lifeStage === 'child'));
  assertModel(g.model);
});

test('mortality weights age and health while birth cohorts follow the yearly schedule', () => {
  const g = game();
  const cell = land(g)[0];
  const senior = g.model.populationGroups[cell.id].find(group => group.lifeStage === 'senior')!;
  const adults = g.model.populationGroups[cell.id].filter(group => group.lifeStage === 'adult');
  adults[0].health = 0.1;
  adults[1].health = 0.9;
  senior.health = 0.9;
  const proposed = (tick: number) => {
    g.model.tick = tick;
    return populationDemographicsRule.run({ model: deepFreeze(structuredClone(g.model)),
      random: () => 0.5, lastEvents: {} });
  };
  const effects = proposed(11);
  const rate = (group: PopulationGroup) => {
    const effect = effects.find(item => item.kind === 'population-delta'
      && item.cause === 'death' && item.group === group.id);
    assert.ok(effect && effect.kind === 'population-delta');
    return effect.amount / group.count;
  };
  assert.ok(rate(senior) > rate(adults[1]));
  assert.ok(rate(adults[0]) > rate(adults[1]));
  assert.ok(!effects.some(effect => effect.kind === 'population-delta' && effect.cause === 'birth'));
  assert.ok(proposed(12).some(effect => effect.kind === 'population-delta' && effect.cause === 'birth'));
});

test('age progression is people-to-people; first occupation choice waits for adaptation', () => {
  const g = game();
  const cell = land(g)[0];
  const child = g.model.populationGroups[cell.id].find(group => group.lifeStage === 'child')!;
  const adult = g.model.populationGroups[cell.id].find(group => group.lifeStage === 'adult')!;
  child.age = 18 - 1 / 12;
  adult.age = 65 - 1 / 12;
  const before = total(g);

  const experience = populationExperienceRule.run({ model: deepFreeze(structuredClone(g.model)),
    random: () => 0, lastEvents: {} });
  const childExperience = experience.find(effect => effect.kind === 'population-state' && effect.group === child.id);
  assert.ok(childExperience && childExperience.kind === 'population-state');
  assert.equal(childExperience.change.age, undefined);

  const staged = step(g, [populationExperienceRule, populationAgingRule, populationLifeStageRule]);
  const grown = staged.model.populationGroups[cell.id].find(group => group.id === child.id)!;
  const retired = staged.model.populationGroups[cell.id].find(group => group.id === adult.id)!;
  assert.ok(Math.abs(grown.age - 18) < 1e-9);
  assert.equal(grown.lifeStage, 'adult');
  assert.equal(grown.employed, false);
  assert.equal(grown.occupation, null);
  assert.ok(Math.abs(retired.age - 65) < 1e-9);
  assert.equal(retired.lifeStage, 'senior');
  assert.equal(retired.occupation, null);
  assert.equal(retired.employed, false);
  assert.ok(Math.abs(total(staged) - before) < 1e-9);
  assertModel(staged.model);

  const adapted = step(g, [
    populationExperienceRule,
    populationAgingRule,
    populationLifeStageRule,
    entryOccupationRule,
  ]);
  const assigned = adapted.model.populationGroups[cell.id].find(group => group.id === child.id)!;
  assert.ok(assigned.occupation, 'new adults choose an occupation in the later adaptation phase');
  assert.equal(assigned.employed, false);
  assert.ok(Math.abs(total(adapted) - before) < 1e-9);
  assertModel(adapted.model);
});

test('compaction merges similar histories and retains meaningful differences', () => {
  const g = game();
  const cell = land(g)[0];
  const source = g.model.populationGroups[cell.id][0];
  const originalCount = source.count;
  source.count /= 2;
  const similar = structuredClone(source);
  similar.id = g.model.nextPopulationGroupId++;
  similar.age += 0.1;
  g.model.populationGroups[cell.id].push(similar);
  assert.equal(mergePopulation(g.model), 1);
  assert.ok(Math.abs(source.count - originalCount) < 1e-9);
  assert.ok(Math.abs(source.age - (similar.age - 0.05)) < 1e-9);

  source.count /= 2;
  const different = structuredClone(source);
  different.id = g.model.nextPopulationGroupId++;
  different.wealth += 10;
  g.model.populationGroups[cell.id].push(different);
  assert.equal(mergePopulation(g.model), 0);
  assertModel(g.model);
});

test('compaction result is independent of input group ordering', () => {
  const a = game();
  const cell = land(a)[0];
  const source = a.model.populationGroups[cell.id][0];
  source.count /= 2;
  const similar = structuredClone(source);
  similar.id = a.model.nextPopulationGroupId++;
  similar.age += 0.1;
  a.model.populationGroups[cell.id].push(similar);
  const b = structuredClone(a);
  b.model.populationGroups[cell.id].reverse();
  assert.equal(mergePopulation(a.model), 1);
  assert.equal(mergePopulation(b.model), 1);
  assert.deepEqual(a.model.populationGroups[cell.id], b.model.populationGroups[cell.id]);
});

test('legacy version-three saves gain deterministic groups and current saves reject corrupt population', () => {
  const g = game();
  const legacy = JSON.parse(serialize(g));
  legacy.version = 3;
  delete legacy.model.populationGroups;
  delete legacy.model.nextPopulationGroupId;
  delete legacy.model.archetypeModelVersion;
  const text = JSON.stringify(legacy);
  const a = deserialize(text);
  const b = deserialize(text);
  assert.equal(a.version, 4);
  assert.deepEqual(a.model.populationGroups, b.model.populationGroups);
  assertModel(a.model);

  const corrupt = JSON.parse(serialize(a));
  corrupt.model.populationGroups[land(a)[0].id][0].count = -10;
  assert.throws(() => deserialize(JSON.stringify(corrupt)));
});

test('the same archetype has different lived outcomes after employment loss', () => {
  const g = game();
  const cell = land(g)[0];
  const employed = g.model.populationGroups[cell.id].find(group => group.lifeStage === 'adult' && group.employed)!;
  const unemployed = g.model.populationGroups[cell.id].find(group => group.archetype === employed.archetype
    && group.lifeStage === 'adult' && !group.employed)!;
  employed.wealth = 40;
  unemployed.wealth = 2;
  const first = populationExperienceRule.run({ model: deepFreeze(structuredClone(g.model)),
    random: () => 0, lastEvents: {} });
  const employedEffect = first.find(effect => effect.kind === 'population-state' && effect.group === employed.id)!;
  const unemployedEffect = first.find(effect => effect.kind === 'population-state' && effect.group === unemployed.id)!;
  assert.equal(employedEffect.kind, 'population-state');
  assert.equal(unemployedEffect.kind, 'population-state');
  assert.ok(employedEffect.change.wellbeing! > unemployedEffect.change.wellbeing!);
  assert.ok(unemployedEffect.change.wealth! < 0);
  const before = unemployed.wealth;
  let later = g;
  for (let month = 0; month < 6; month += 1) later = step(later, [populationExperienceRule]);
  const affected = later.model.populationGroups[cell.id].find(group => group.id === unemployed.id)!;
  assert.ok(affected.wealth < before);
  assertModel(later.model);
});

test('different archetypes interpret identical local circumstances differently', () => {
  const g = game();
  const cell = land(g)[0];
  const groups = g.model.populationGroups[cell.id];
  const a = groups[0];
  const b = groups.find(group => group.archetype !== a.archetype)!;
  const id = b.id;
  const archetype = b.archetype;
  const count = b.count;
  Object.assign(b, structuredClone(a), { id, archetype, count });
  const effects = populationExperienceRule.run({ model: deepFreeze(structuredClone(g.model)),
    random: () => 0, lastEvents: {} });
  const aChange = effects.find(effect => effect.kind === 'population-state' && effect.group === a.id);
  const bChange = effects.find(effect => effect.kind === 'population-state' && effect.group === b.id);
  assert.ok(aChange && aChange.kind === 'population-state');
  assert.ok(bChange && bChange.kind === 'population-state');
  assert.ok(Math.abs(aChange.change.wellbeing! - bChange.change.wellbeing!) > 1e-6);
});

test('an unaffordable wage floor creates divergent employment histories without changing archetypes', () => {
  let g = enact(game(), { type: 'minimumWage', amount: 8 });
  const cell = land(g)[0];
  const before = employmentOf(g.model, cell.id);
  for (let month = 0; month < 6; month += 1) g = step(g);
  assert.ok(employmentOf(g.model, cell.id) < before);
  assert.ok(Math.abs(employmentOf(g.model, cell.id) - g.model.cells[cell.id].employment) < 0.01);
  const groups = g.model.populationGroups[cell.id];
  assert.ok(groups.some(a => groups.some(b => a.archetype === b.archetype && a.employed !== b.employed)));
  assert.ok(groups.length < 80);
  assert.ok(g.causes.some(cause => cause.observations.some(observation => observation.group !== undefined)));
  assertModel(g.model);
});

test('migration carries an actual archetype group between mapxels', () => {
  const g = game();
  const snapshot = deepFreeze(structuredClone(g.model));
  const effects = migrationRule.run({ model: snapshot, random: () => 0, lastEvents: {} });
  const transfer = effects.find(effect => effect.kind === 'population-transfer' && effect.amount > 0);
  assert.ok(transfer && transfer.kind === 'population-transfer');
  const source = g.model.populationGroups[transfer.from].find(group => group.id === transfer.group)!;
  const archetype = source.archetype;
  const sourceBefore = g.model.populationGroups[transfer.from]
    .filter(group => group.archetype === archetype).reduce((sum, group) => sum + group.count, 0);
  const destinationBefore = g.model.populationGroups[transfer.to]
    .filter(group => group.archetype === archetype).reduce((sum, group) => sum + group.count, 0);
  const before = total(g);
  settle(g, [transfer]);
  const sourceAfter = g.model.populationGroups[transfer.from]
    .filter(group => group.archetype === archetype).reduce((sum, group) => sum + group.count, 0);
  const destinationAfter = g.model.populationGroups[transfer.to]
    .filter(group => group.archetype === archetype).reduce((sum, group) => sum + group.count, 0);
  assert.ok(Math.abs(sourceBefore - sourceAfter - transfer.amount) < 1e-9);
  assert.ok(Math.abs(destinationAfter - destinationBefore - transfer.amount) < 1e-9);
  assert.ok(Math.abs(total(g) - before) < 1e-9);
  assertModel(g.model);
});

test('adaptability raises the share of unemployed adults entering retraining', () => {
  const g = game();
  g.model.tick = 6;
  const cell = land(g)[0];
  const groups = g.model.populationGroups[cell.id].filter(group => group.lifeStage === 'adult' && !group.employed);
  const [low, high] = groups;
  const archetypes = generateArchetypes(g.model.seed).sort((a, b) =>
    a.traits.adaptability - b.traits.adaptability);
  Object.assign(low, { archetype: archetypes[0].id, count: 20, occupation: 'agriculture', education: 0.5 });
  Object.assign(high, { archetype: archetypes.at(-1)!.id, count: 20, occupation: 'agriculture', education: 0.5 });
  const effects = retrainingRule.run({ model: deepFreeze(structuredClone(g.model)),
    random: () => 0, lastEvents: {} });
  const lowEffect = effects.find(effect => effect.kind === 'population-transition' && effect.group === low.id);
  const highEffect = effects.find(effect => effect.kind === 'population-transition' && effect.group === high.id);
  assert.ok(lowEffect && lowEffect.kind === 'population-transition');
  assert.ok(highEffect && highEffect.kind === 'population-transition');
  assert.notEqual(lowEffect.transition.occupation, 'agriculture');
  assert.notEqual(highEffect.transition.occupation, 'agriculture');
  assert.ok(highEffect.amount > lowEffect.amount);
});

test('local pollution slowly changes group attitudes without changing archetype identity', () => {
  let g = game();
  const [clean, polluted] = land(g);
  clean.pollution = 0;
  polluted.pollution = 1;
  const a = g.model.populationGroups[clean.id][0];
  const b = g.model.populationGroups[polluted.id][0];
  b.archetype = a.archetype;
  b.attitudes.environmentalism = a.attitudes.environmentalism;
  const baseline = archetypeAt(g.model.seed, a.archetype).values.environmentalism;
  for (let month = 0; month < 12; month += 1) g = step(g, [populationExperienceRule]);
  const cleanGroup = g.model.populationGroups[clean.id].find(group => group.id === a.id)!;
  const pollutedGroup = g.model.populationGroups[polluted.id].find(group => group.id === b.id)!;
  assert.equal(cleanGroup.archetype, pollutedGroup.archetype);
  assert.equal(archetypeAt(g.model.seed, a.archetype).values.environmentalism, baseline);
  assert.ok(pollutedGroup.attitudes.environmentalism > cleanGroup.attitudes.environmentalism);
  assertModel(g.model);
});

test('rule registration order leaves population settlement and group IDs unchanged', () => {
  const g = game();
  const forward = step(g, defaultRules);
  const reversed = step(g, [...defaultRules].reverse());
  assert.deepEqual(forward.model.populationGroups, reversed.model.populationGroups);
  assert.equal(forward.model.nextPopulationGroupId, reversed.model.nextPopulationGroupId);
});
