import test from 'node:test';
import assert from 'node:assert/strict';
import { POPULATION_COHORT_QUANTUM, quantizeCohortFlow } from '../src/sim/population/resolution';

test('cohort flow resolution preserves the expected continuous amount', () => {
  const desired = 0.013;
  const source = 10;
  const samples = 10_000;
  let total = 0;
  for (let index = 0; index < samples; index += 1) {
    total += quantizeCohortFlow(desired, source, (index + 0.5) / samples);
  }
  assert.ok(Math.abs(total / samples - desired) < 1e-6);
});

test('partial cohort flows use the configured quantum while tiny source groups move whole', () => {
  assert.equal(quantizeCohortFlow(0.024, 10, 0), POPULATION_COHORT_QUANTUM);
  assert.equal(quantizeCohortFlow(0.024, 10, 0.99), 0);
  assert.equal(quantizeCohortFlow(0.0003, 0.03, 0), 0.03);
  assert.equal(quantizeCohortFlow(0.0003, 0.03, 0.99), 0);
});

test('cohort flow resolution is bounded by the source population', () => {
  assert.equal(quantizeCohortFlow(20, 3, 0.5), 3);
  assert.equal(quantizeCohortFlow(0, 3, 0.5), 0);
  assert.throws(() => quantizeCohortFlow(-1, 3, 0.5));
  assert.throws(() => quantizeCohortFlow(1, 3, 1));
});
