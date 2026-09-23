import test from 'node:test';
import assert from 'node:assert/strict';
import { step } from '../src/sim/engine';
import { traceStep } from '../src/sim/trace';
import { PHASES } from '../src/sim/types';
import { createGame } from '../src/sim/world';

test('traceStep is exactly equivalent to the production step', () => {
  const game = createGame('trace-equivalence', 12, 12, 6);
  const before = structuredClone(game);
  const trace = traceStep(game);
  const next = step(game);

  assert.deepEqual(trace.result, next);
  assert.deepEqual(game, before);
  assert.deepEqual(trace.phases.map(phase => phase.phase), PHASES);
});

test('phase traces form a continuous sequence of immutable snapshots', () => {
  const trace = traceStep(createGame('trace-continuity', 12, 12, 6));

  assert.equal(trace.phases[0].before.tick, 1);
  assert.ok(trace.phases.every(phase => phase.rules.length > 0));
  assert.ok(trace.phases.some(phase => phase.rules.some(rule => rule.effects.length > 0)));

  for (let index = 1; index < trace.phases.length; index += 1) {
    assert.deepEqual(trace.phases[index].before, trace.phases[index - 1].after);
  }
});
