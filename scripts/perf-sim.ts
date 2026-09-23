import { performance } from 'node:perf_hooks';
import { createGame } from '../src/sim/world';
import { enact } from '../src/sim/policy';
import { step } from '../src/sim/engine';
import { deepFreeze } from '../src/sim/math';
import { defaultRules } from '../src/sim/rules';

let game = enact(createGame('alder-42', 18, 14, 48), {
  type: 'subsidy', sector: 'sports', amount: 3, scope: { kind: 'national' },
});

const groupCount = () => game.model.populationGroups.reduce((sum, groups) => sum + groups.length, 0);

function bench(label: string, fn: () => void, iterations: number): void {
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) fn();
  const elapsed = performance.now() - start;
  console.log(JSON.stringify({ label, iterations, totalMs: elapsed, meanMs: elapsed / iterations }));
}

console.log('PERF_MODEL', JSON.stringify({ cells: game.model.cells.length, groups: groupCount() }));
bench('structuredClone(model)', () => { structuredClone(game.model); }, 20);
bench('deepFreeze(structuredClone(model))', () => { deepFreeze(structuredClone(game.model)); }, 20);

for (let month = 1; month <= 12; month += 1) {
  const start = performance.now();
  game = step(game, defaultRules);
  const elapsed = performance.now() - start;
  console.log('PERF_STEP', JSON.stringify({ month, elapsedMs: elapsed, groups: groupCount(), causes: game.causes.length }));
}
