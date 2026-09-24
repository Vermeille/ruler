import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPopulationStateDelta,
  POPULATION_STATE_FIELD_NAMES,
  POPULATION_STATE_FIELDS,
  POPULATION_TRANSITION_FIELDS,
  populationStateMergeTolerance,
  readPopulationStateField,
  validPopulationStateValue,
  writePopulationStateField,
} from '../src/sim/population/fields';
import { createGame } from '../src/sim/world';

test('population field registry owns bounds, storage, merge tolerances, and discrete validation', () => {
  const game = createGame('field-registry-contract', 12, 12, 4);
  const group = game.model.populationGroups.find(groups => groups.length > 0)![0];
  const source = structuredClone(group);

  applyPopulationStateDelta(group, source, 'health', 10);
  assert.equal(group.health, 1);

  applyPopulationStateDelta(group, source, 'wealth', -1e6);
  assert.equal(group.wealth, 0);

  applyPopulationStateDelta(group, source, 'solidarity', 10);
  assert.equal(group.attitudes.solidarity, 1);

  writePopulationStateField(group, 'environmentalism', 0.42);
  assert.equal(readPopulationStateField(group, 'environmentalism'), 0.42);

  assert.equal(validPopulationStateValue('wellbeing', 0.5), true);
  assert.equal(validPopulationStateValue('wellbeing', 1.5), false);
  assert.equal(validPopulationStateValue('income', 1.5), true);
  assert.equal(validPopulationStateValue('income', -0.1), false);
  assert.equal(validPopulationStateValue('wellbeing', 1 + 5e-10, 1e-9), true);

  const child = { ...source, lifeStage: 'child' as const };
  const adult = { ...source, lifeStage: 'adult' as const };
  const senior = { ...source, lifeStage: 'senior' as const };
  assert.equal(populationStateMergeTolerance('age', child), 2.5);
  assert.equal(populationStateMergeTolerance('age', adult), 1);
  assert.equal(populationStateMergeTolerance('age', senior), 2);
  assert.equal(populationStateMergeTolerance('wealth', adult), 2);

  assert.equal(POPULATION_TRANSITION_FIELDS.lifeStage.valid('adult'), true);
  assert.equal(POPULATION_TRANSITION_FIELDS.lifeStage.valid('wizard'), false);
  assert.equal(POPULATION_TRANSITION_FIELDS.occupation.valid('services'), true);
  assert.equal(POPULATION_TRANSITION_FIELDS.occupation.valid('alchemy'), false);

  assert.deepEqual([...POPULATION_STATE_FIELD_NAMES].sort(), [
    'age', 'approval', 'civicLiberty', 'education', 'environmentalism', 'health',
    'income', 'solidarity', 'traditionalism', 'wealth', 'wellbeing',
  ].sort());
  assert.deepEqual(Object.keys(POPULATION_STATE_FIELDS).sort(), [...POPULATION_STATE_FIELD_NAMES].sort());
});
