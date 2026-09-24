import fs from 'node:fs';

function replaceOnce(path, before, after) {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes(before)) throw new Error(`Expected block not found in ${path}`);
  if (source.indexOf(before) !== source.lastIndexOf(before)) throw new Error(`Expected unique block in ${path}`);
  fs.writeFileSync(path, source.replace(before, after));
}

const registry = `import type { MutableField } from './types';

export type MapxelResource = 'food' | 'materials' | 'population';

export type MapxelFieldSpec = {
  min?: number;
  max?: number;
  /** Whether rules may write this field with a delta effect. Cash moves through transfers instead. */
  delta: boolean;
  /** Negative deltas to conserved resources are scaled to phase-start availability. */
  resource?: MapxelResource;
};

/**
 * Mechanical semantics for mutable mapxel state. Rules decide why a field changes; the engine,
 * saves, validation, and tools can derive how that field behaves from this registry.
 * Adding a mutable numeric Mapxel field makes this exhaustive registry a compiler-enforced task.
 */
export const MAPXEL_FIELDS = {
  population: { min: 0, delta: true, resource: 'population' },
  cash: { min: 0, delta: false },
  food: { min: 0, delta: true, resource: 'food' },
  materials: { min: 0, delta: true, resource: 'materials' },
  price: { min: 0.4, max: 5, delta: true },
  scarcityPrice: { min: 0.4, max: 5, delta: true },
  waterStress: { min: 0, max: 1, delta: true },
  children: { min: 0, max: 1, delta: true },
  seniors: { min: 0, max: 1, delta: true },
  education: { min: 0, max: 1, delta: true },
  health: { min: 0, max: 1, delta: true },
  happiness: { min: 0, max: 1, delta: true },
  approval: { min: 0, max: 1, delta: true },
  crime: { min: 0, max: 1, delta: true },
  pollution: { min: 0, max: 1, delta: true },
  infrastructure: { min: 0, max: 1, delta: true },
  employment: { min: 0, max: 1, delta: true },
  foodSecurity: { min: 0, max: 1, delta: true },
  sportsInterest: { min: 0, max: 1, delta: true },
  agriculture: { min: 0, max: 1, delta: true },
  manufacturing: { min: 0, max: 1, delta: true },
  services: { min: 0, max: 1, delta: true },
  sports: { min: 0, max: 1, delta: true },
  output: { min: 0, delta: true },
  foodMade: { min: 0, delta: true },
  foodUsed: { min: 0, delta: true },
  foodTraded: { delta: true },
  businessHealth: { min: 0, max: 1, delta: true },
  starvationDeaths: { min: 0, delta: true },
} as const satisfies Record<MutableField, MapxelFieldSpec>;

export const MUTABLE_FIELDS = Object.keys(MAPXEL_FIELDS) as MutableField[];

export function mapxelFieldSpec(field: string): MapxelFieldSpec | undefined {
  return (MAPXEL_FIELDS as Record<string, MapxelFieldSpec>)[field];
}

export function isMutableMapxelField(field: string): field is MutableField {
  return mapxelFieldSpec(field) !== undefined;
}

export function constrainMapxelFieldValue(field: MutableField, value: number): number {
  const spec: MapxelFieldSpec = MAPXEL_FIELDS[field];
  let result = value;
  if (spec.min !== undefined) result = Math.max(spec.min, result);
  if (spec.max !== undefined) result = Math.min(spec.max, result);
  return result;
}

export function validMapxelFieldValue(
  field: MutableField,
  value: unknown,
  epsilon = 0,
): boolean {
  const spec: MapxelFieldSpec = MAPXEL_FIELDS[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (spec.min !== undefined && value < spec.min - epsilon) return false;
  if (spec.max !== undefined && value > spec.max + epsilon) return false;
  return true;
}
`;
fs.writeFileSync('src/sim/map-fields.ts', registry);

replaceOnce('src/sim/types.ts',
`export const SECTORS = [`,
`import { MUTABLE_FIELDS } from './map-fields';\nexport { MUTABLE_FIELDS };\n\nexport const SECTORS = [`);

replaceOnce('src/sim/types.ts',
`export const MUTABLE_FIELDS = [
  'population',
  'cash',
  'food',
  'materials',
  'price',
  'scarcityPrice',
  'waterStress',
  'children',
  'seniors',
  'education',
  'health',
  'happiness',
  'approval',
  'crime',
  'pollution',
  'infrastructure',
  'employment',
  'foodSecurity',
  'sportsInterest',
  ...SECTORS,
  'output',
  'foodMade',
  'foodUsed',
  'foodTraded',
  'businessHealth',
  'starvationDeaths',
] as const satisfies readonly Field[];

export type MutableField = typeof MUTABLE_FIELDS[number];`,
`type ImmutableNumericMapxelField = 'id' | 'x' | 'y' | 'region' | 'elevation' | 'fertility' | 'minerals';
export type MutableField = Exclude<Field, ImmutableNumericMapxelField>;`);

replaceOnce('src/sim/engine.ts',
`import { deepFreeze, randomAt, summarize, clamp } from './math';`,
`import { deepFreeze, randomAt, summarize } from './math';\nimport { constrainMapxelFieldValue, mapxelFieldSpec, validMapxelFieldValue } from './map-fields';`);

replaceOnce('src/sim/engine.ts',
`const BOUNDED_FIELDS = new Set<MutableField>([
  'waterStress',
  'children',
  'seniors',
  'education',
  'health',
  'happiness',
  'approval',
  'crime',
  'pollution',
  'infrastructure',
  'employment',
  'foodSecurity',
  'sportsInterest',
  'businessHealth',
  ...SECTORS,
]);

`,
``);

replaceOnce('src/sim/engine.ts',
`  const cell = snapshot.cells[effect.cell];
  const invalidField = !MUTABLE_FIELDS.includes(effect.field) || effect.field === 'cash';

  if (invalidField || !cell || cell.biome === 'water') {
    throw new Error('Invalid delta; cash must use transfers.');
  }

  if (effect.amount < 0 && ['food', 'materials', 'population'].includes(effect.field)) {
    addDemand(demands, snapshot, effect.cell, effect.field as Resource, -effect.amount);
  }`,
`  const cell = snapshot.cells[effect.cell];
  const spec = mapxelFieldSpec(effect.field);

  if (!spec?.delta || !cell || cell.biome === 'water') {
    throw new Error('Invalid delta; this field must use its dedicated effect.');
  }

  if (effect.amount < 0 && spec.resource) {
    addDemand(demands, snapshot, effect.cell, spec.resource, -effect.amount);
  }`);

replaceOnce('src/sim/engine.ts',
`  let actual = effect.amount;

  if (actual < 0 && ['food', 'materials', 'population'].includes(effect.field)) {
    actual *= demandScale(snapshot, demands, effect.cell, effect.field as Resource);
  }`,
`  let actual = effect.amount;
  const resource = mapxelFieldSpec(effect.field)?.resource;

  if (actual < 0 && resource) {
    actual *= demandScale(snapshot, demands, effect.cell, resource);
  }`);

replaceOnce('src/sim/engine.ts',
`    const value = cell[field] + amount;

    if (BOUNDED_FIELDS.has(field)) {
      cell[field] = clamp(value);
    } else if (field === 'price' || field === 'scarcityPrice') {
      cell[field] = clamp(value, 0.4, 5);
    } else if (field === 'foodTraded') {
      cell[field] = value;
    } else {
      cell[field] = Math.max(0, value);
    }`,
`    cell[field] = constrainMapxelFieldValue(field, cell[field] + amount);`);

replaceOnce('src/sim/engine.ts',
`    for (const field of MUTABLE_FIELDS) {
      const value = cell[field];
      const belowMinimum = field !== 'foodTraded' && value < -1e-6;
      const aboveMaximum = BOUNDED_FIELDS.has(field) && value > 1 + 1e-6;

      if (!Number.isFinite(value) || belowMinimum || aboveMaximum) {
        throw new Error(\`Invalid \${field} in mapxel \${cell.id}: \${value}\`);
      }
    }`,
`    for (const field of MUTABLE_FIELDS) {
      const value = cell[field];
      if (!validMapxelFieldValue(field, value, 1e-6)) {
        throw new Error(\`Invalid \${field} in mapxel \${cell.id}: \${value}\`);
      }
    }`);

replaceOnce('src/sim/engine.ts',
`    if (cell.price < 0.4 || cell.price > 5 || cell.scarcityPrice < 0.4 || cell.scarcityPrice > 5) {
      throw new Error('Food prices must remain in the calibrated range.');
    }
`,
``);

replaceOnce('src/sim/save.ts',
`import { assertModel } from './engine';`,
`import { assertModel } from './engine';\nimport { isMutableMapxelField, validMapxelFieldValue } from './map-fields';`);

replaceOnce('src/sim/save.ts',
`  MUTABLE_FIELDS,
`,
``);

replaceOnce('src/sim/save.ts',
`    if (MUTABLE_FIELDS.includes(field as never)) {
      if (!isFiniteNumber(saved[field])) return fail();
    } else if (saved[field] !== base[field]) {`,
`    if (isMutableMapxelField(String(field))) {
      if (!validMapxelFieldValue(field, saved[field], 1e-6)) return fail();
    } else if (saved[field] !== base[field]) {`);

const test = `import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAPXEL_FIELDS,
  MUTABLE_FIELDS,
  constrainMapxelFieldValue,
  validMapxelFieldValue,
} from '../src/sim/map-fields';
import { createGame } from '../src/sim/world';

test('mapxel field registry owns mutable field mechanics', () => {
  assert.deepEqual(new Set(MUTABLE_FIELDS), new Set(Object.keys(MAPXEL_FIELDS)));
  assert.equal(MAPXEL_FIELDS.cash.delta, false);
  assert.equal(MAPXEL_FIELDS.food.resource, 'food');
  assert.equal(MAPXEL_FIELDS.materials.resource, 'materials');
  assert.equal(MAPXEL_FIELDS.population.resource, 'population');
  assert.equal(constrainMapxelFieldValue('price', 99), 5);
  assert.equal(constrainMapxelFieldValue('happiness', -2), 0);
  assert.equal(constrainMapxelFieldValue('foodTraded', -2), -2);
  assert.equal(validMapxelFieldValue('businessHealth', 1.01), false);
});

test('generated mapxels satisfy the registry', () => {
  const game = createGame('map-field-registry', 18, 14);
  for (const cell of game.model.cells) {
    for (const field of MUTABLE_FIELDS) {
      assert.ok(validMapxelFieldValue(field, cell[field], 1e-6), \`${'${field}'} invalid in cell ${'${cell.id}'}\`);
    }
  }
});
`;
fs.writeFileSync('tests/map-fields.test.ts', test);
