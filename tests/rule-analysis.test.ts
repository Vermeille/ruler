import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRule } from '../src/dev/rule-analysis';
import { analyzeRuleInfluence, analyzeRuleInputInfluence } from '../src/dev/rule-influence';
import { traceStep } from '../src/sim/trace';
import { step } from '../src/sim/engine';
import { createGame } from '../src/sim/world';

function analysisFor(ruleId: string) {
  let game = createGame('causal-lens-test', 18, 14, 48);
  if (ruleId === 'population.migration' || ruleId === 'population.migration-cash') {
    game = step(step(game));
  }
  const trace = traceStep(game);
  const phase = trace.phases.find(candidate => (
    candidate.rules.some(rule => rule.id === ruleId)
  ));
  assert.ok(phase, `missing phase for ${ruleId}`);
  const tracedRule = phase.rules.find(rule => rule.id === ruleId)!;
  const analysis = analyzeRule(game, phase, ruleId);
  assert.ok(analysis, `missing analysis for ${ruleId}`);
  return { game, phase, tracedRule, analysis };
}

test('causal analysis discovers actual reads and outputs for stochastic, spatial, and national rules', () => {
  const productionResult = analysisFor('economy.production');
  const production = productionResult.analysis;
  assert.equal(productionResult.tracedRule.direction, 'people-to-mapxel');
  assert.ok(production.inputs.some(input => input.key === 'random.weather'));
  assert.ok(production.inputs.some(input => input.key === 'people.employmentRate'));
  assert.ok(production.inputs.some(input => input.key === 'people.averageHealth'));
  assert.ok(production.inputs.some(input => input.key === 'people.occupationShares.agriculture'));
  assert.ok(!production.inputs.some(input => input.key === 'cell.employment'));
  assert.ok(!production.inputs.some(input => input.key === 'population.employed'),
    'aggregate production should expose the actual step-cache summary it consumes, not cache construction internals');
  assert.ok(production.outputs.some(output => output.key === 'delta.food'));
  assert.ok(production.jacobian.length > 0);

  const migrationResult = analysisFor('population.migration');
  const migration = migrationResult.analysis;
  assert.equal(migrationResult.tracedRule.direction, 'mapxel-to-people');
  for (const input of [
    'population.wellbeing',
    'population.wealth',
    'population.employed',
    'cell.price',
    'cell.output',
    'policy.laws.freeMovement',
  ]) {
    assert.ok(migration.inputs.some(candidate => candidate.key === input), `migration should read ${input}`);
  }
  assert.ok(migration.outputs.some(output => output.key === 'population.transfer'));
  assert.ok(!migration.outputs.some(output => output.key === 'transfer.cash'));
  assert.ok(migration.footprintFlows.length > 0);

  const migrationCashResult = analysisFor('population.migration-cash');
  assert.equal(migrationCashResult.tracedRule.direction, 'people-to-mapxel');
  assert.ok(migrationCashResult.analysis.outputs.some(output => output.key === 'transfer.cash'));

  const fiscal = analysisFor('state.services').analysis;
  assert.ok(fiscal.inputs.some(input => input.category === 'budget' || input.category === 'global'));
  assert.ok(fiscal.outputs.length > 0);
});

test('rule influence traces exact downstream reads and recurrent self-dependencies', () => {
  const { game, phase } = analysisFor('population.migration');
  const influence = analyzeRuleInfluence(
    game,
    phase,
    'population.migration',
    'population.transfer',
  );

  assert.ok(influence.writtenPaths.length > 0);
  assert.ok(influence.writtenPaths.some(path => path.path.endsWith('.population')));
  assert.ok(influence.writtenPaths.some(path => path.path.startsWith('populationGroups.')));
  assert.ok(influence.consumers.some(consumer => (
    consumer.month === 'later month'
      && consumer.monthsAhead === 3
      && consumer.ruleId === 'population.migration'
      && consumer.self
      && consumer.strength > 0
  )), 'migration population should feed the next quarterly decision');
  assert.ok(influence.consumers.some(consumer => (
    consumer.ruleId !== 'population.migration' && consumer.strength > 0
  )), 'migration population should feed at least one other rule');
  assert.ok(influence.consumers.every(consumer => (
    consumer.paths.length > 0 && consumer.strength > 0 && consumer.strength <= 1
  )));
});

test('input influence traces migration back through population experience', () => {
  const { game, phase } = analysisFor('population.migration');
  const influence = analyzeRuleInputInfluence(
    game,
    phase,
    'population.migration',
    'population.wellbeing',
  );

  assert.ok(influence.readPaths.length > 0);
  assert.ok(influence.readPaths.every(path => path.path.includes('.wellbeing')));
  assert.ok(influence.producers.some(producer => (
    producer.ruleId === 'population.experience'
      && producer.phase === 'experience'
      && producer.strength > 0
  )), 'migration wellbeing should trace back to population experience');
  assert.ok(influence.producers.every(producer => (
    producer.paths.length > 0 && producer.strength > 0 && producer.strength <= 1
  )));
});

test('every current simulation rule can be explained without mutating the game', () => {
  const game = createGame('all-rule-analysis', 18, 14, 48);
  const before = structuredClone(game);
  const trace = traceStep(game);

  for (const phase of trace.phases) {
    for (const rule of phase.rules) {
      const analysis = analyzeRule(game, phase, rule.id);
      assert.ok(analysis, `analysis missing for ${rule.id}`);
      assert.equal(analysis.ruleId, rule.id);
      assert.equal(analysis.phase, phase.phase);
      assert.ok([
        'mapxel-to-mapxel',
        'mapxel-to-people',
        'people-to-mapxel',
        'people-to-people',
      ].includes(rule.direction));
      const structuralReads = analysis.structuralInputs.reduce((sum, input) => sum + input.reads, 0);
      assert.ok(analysis.totalReads + structuralReads > 0, `${rule.id} should expose at least one input`);
      assert.ok(analysis.analyzedReads <= 72, `${rule.id} should respect the analysis budget`);
      assert.ok(Array.isArray(analysis.downstream));
    }
  }

  assert.deepEqual(game, before);
});
