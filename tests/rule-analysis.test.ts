import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRule } from '../src/dev/rule-analysis';
import { traceStep } from '../src/sim/trace';
import { createGame } from '../src/sim/world';

function analysisFor(ruleId: string) {
  const game = createGame('causal-lens-test', 18, 14, 48);
  const trace = traceStep(game);
  const phase = trace.phases.find(candidate => (
    candidate.rules.some(rule => rule.id === ruleId)
  ));
  assert.ok(phase, `missing phase for ${ruleId}`);
  const analysis = analyzeRule(game, phase, ruleId);
  assert.ok(analysis, `missing analysis for ${ruleId}`);
  return { game, analysis };
}

test('causal analysis discovers actual reads and outputs for stochastic, spatial, and national rules', () => {
  const production = analysisFor('economy.production').analysis;
  assert.ok(production.inputs.some(input => input.key === 'random.weather'));
  assert.ok(production.inputs.some(input => input.key === 'cell.employment'));
  assert.ok(production.outputs.some(output => output.key === 'delta.food'));
  assert.ok(production.jacobian.length > 0);

  const migration = analysisFor('society.migration').analysis;
  for (const input of [
    'cell.happiness',
    'cell.employment',
    'cell.cash',
    'cell.population',
    'policy.laws.freeMovement',
  ]) {
    assert.ok(migration.inputs.some(candidate => candidate.key === input), `migration should read ${input}`);
  }
  assert.ok(migration.outputs.some(output => output.key === 'transfer.population'));
  assert.ok(migration.outputs.some(output => output.key === 'transfer.cash'));
  assert.ok(migration.footprintFlows.length > 0);

  const fiscal = analysisFor('state.fiscal').analysis;
  assert.ok(fiscal.inputs.some(input => input.category === 'budget' || input.category === 'global'));
  assert.ok(fiscal.outputs.length > 0);
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
      assert.ok(analysis.totalReads > 0, `${rule.id} should expose at least one input`);
      assert.ok(analysis.analyzedReads <= 72, `${rule.id} should respect the analysis budget`);
      assert.ok(Array.isArray(analysis.downstream));
    }
  }

  assert.deepEqual(game, before);
});