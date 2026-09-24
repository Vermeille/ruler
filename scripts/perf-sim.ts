import { performance } from 'node:perf_hooks';
import { createGame } from '../src/sim/world';
import { enact } from '../src/sim/policy';
import { step } from '../src/sim/engine';
import { deepFreeze, randomAt } from '../src/sim/math';
import { defaultRules, migrationRule } from '../src/sim/rules';
import type { Model } from '../src/sim/types';

let game = enact(createGame('alder-42', 18, 14, 48), {
  type: 'subsidy', sector: 'sports', amount: 3, scope: { kind: 'national' },
});

const groupCount = () => game.model.populationGroups.reduce((sum, groups) => sum + groups.length, 0);

function cloneModel(model: Model): Model {
  return {
    ...model,
    cells: model.cells.map(cell => ({ ...cell })),
    populationGroups: model.populationGroups.map(groups => groups.map(group => ({
      ...group,
      attitudes: { ...group.attitudes },
    }))),
    neighbors: model.neighbors.map(neighbors => [...neighbors]),
    regions: [...model.regions],
    policy: {
      ...model.policy,
      spending: { ...model.policy.spending },
      subsidies: { ...model.policy.subsidies },
      laws: { ...model.policy.laws },
    },
    localSubsidies: model.localSubsidies.map(subsidy => ({
      ...subsidy,
      scope: subsidy.scope.kind === 'cells'
        ? { ...subsidy.scope, ids: [...subsidy.scope.ids] }
        : { ...subsidy.scope },
    })),
    budget: { ...model.budget },
  };
}

function bench(label: string, fn: () => void, iterations: number): void {
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) fn();
  const elapsed = performance.now() - start;
  console.log(JSON.stringify({ label, iterations, totalMs: elapsed, meanMs: elapsed / iterations }));
}

function reportGroupSizes(): void {
  const sizes = game.model.populationGroups.flat().map(group => group.count).sort((a, b) => a - b);
  if (!sizes.length) return;
  const q = (fraction: number) => sizes[Math.min(sizes.length - 1, Math.floor((sizes.length - 1) * fraction))];
  const under = (limit: number) => sizes.filter(size => size < limit).length;
  console.log('GROUP_SIZES', JSON.stringify({
    tick: game.model.tick,
    count: sizes.length,
    min: sizes[0],
    q10: q(.1),
    q25: q(.25),
    median: q(.5),
    q75: q(.75),
    q90: q(.9),
    max: sizes.at(-1),
    under01: under(.1),
    under05: under(.5),
    under1: under(1),
  }));
}

function reportMigrationAmounts(): void {
  const effects = migrationRule.run({
    model: game.model,
    random: (cell, channel = '') => randomAt(
      game.model.seed,
      game.model.tick,
      migrationRule.id,
      cell,
      channel,
    ),
    lastEvents: game.lastEvents,
  });
  const amounts = effects
    .filter(effect => effect.kind === 'population-transfer')
    .map(effect => effect.amount)
    .sort((a, b) => a - b);
  if (!amounts.length) {
    console.log('MIGRATION_AMOUNTS', JSON.stringify({ tick: game.model.tick, count: 0 }));
    return;
  }
  const q = (fraction: number) => amounts[Math.min(amounts.length - 1, Math.floor((amounts.length - 1) * fraction))];
  const under = (limit: number) => amounts.filter(amount => amount < limit).length;
  console.log('MIGRATION_AMOUNTS', JSON.stringify({
    tick: game.model.tick,
    count: amounts.length,
    min: amounts[0], q10: q(.1), q25: q(.25), median: q(.5), q75: q(.75), q90: q(.9), max: amounts.at(-1),
    under001: under(.01), under005: under(.05), under01: under(.1), under025: under(.25), under05: under(.5), under1: under(1),
  }));
}

console.log('PERF_MODEL', JSON.stringify({ cells: game.model.cells.length, groups: groupCount() }));
reportGroupSizes();
bench('structuredClone(model)', () => { structuredClone(game.model); }, 20);
bench('typedClone(model)', () => { cloneModel(game.model); }, 20);
bench('deepFreeze(structuredClone(model))', () => { deepFreeze(structuredClone(game.model)); }, 20);

for (let month = 1; month <= 12; month += 1) {
  (globalThis as typeof globalThis & { __SIM_PROFILE__?: boolean }).__SIM_PROFILE__ = month === 12;
  const start = performance.now();
  game = step(game, defaultRules);
  const elapsed = performance.now() - start;
  console.log('PERF_STEP', JSON.stringify({ month, elapsedMs: elapsed, groups: groupCount(), causes: game.causes.length }));
  if (month % 3 === 0) {
    reportGroupSizes();
    reportMigrationAmounts();
  }
  if (month === 11) {
    bench('late structuredClone(model)', () => { structuredClone(game.model); }, 10);
    bench('late typedClone(model)', () => { cloneModel(game.model); }, 10);
  }
}
