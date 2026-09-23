import {
  SECTORS,
  type DeepReadonly,
  type Effect,
  type Evidence,
  type Model,
  type MutableField,
  type Rule,
  type Sector,
} from '../types';

function projectionParents(
  model: DeepReadonly<Model>,
  cell: number,
  field: MutableField,
): string[] {
  const groups = model.populationGroups[cell];
  if (SECTORS.includes(field as Sector)) {
    return groups.map(group => `group:${group.id}:occupation`);
  }
  if (field === 'employment') {
    return groups.map(group => `group:${group.id}:employed`);
  }
  if (field === 'happiness') {
    return groups.map(group => `group:${group.id}:wellbeing`);
  }
  if (field === 'approval') {
    return groups.map(group => `group:${group.id}:approval`);
  }
  if (field === 'children' || field === 'seniors') {
    return groups.map(group => `group:${group.id}:lifeStage`);
  }
  return [];
}

function projectionEvidence(
  model: DeepReadonly<Model>,
  cell: number,
  field: MutableField,
  before: number,
  after: number,
): Evidence | undefined {
  const amount = Math.abs(after - before);
  const threshold = SECTORS.includes(field as Sector)
    ? 0.0025
    : field === 'employment' || field === 'children' || field === 'seniors'
      ? 0.005
      : 0.01;
  if (amount < threshold) return undefined;

  const place = model.cells[cell];
  const label = SECTORS.includes(field as Sector)
    ? `${field} workforce share`
    : field === 'happiness' ? 'resident wellbeing'
      : field === 'approval' ? 'resident approval'
        : field;
  return {
    title: `${place.name}: ${label} follows residents`,
    detail: `${label} moves from ${(before * 100).toFixed(1)}% to ${(after * 100).toFixed(1)}% because this mapxel now contains a different mix of resident states. The mapxel field is a projection of people, not an independent social variable.`,
    cells: [cell],
    parents: projectionParents(model, cell, field),
  };
}

function projectedFields(model: DeepReadonly<Model>, cellId: number): Record<'employment' | 'happiness' | 'approval' | 'children' | 'seniors' | Sector, number> {
  const groups = model.populationGroups[cellId];
  let population = 0;
  let adults = 0;
  let employedAdults = 0;
  let workers = 0;
  let wellbeing = 0;
  let approval = 0;
  let children = 0;
  let seniors = 0;
  const occupations: Record<Sector, number> = {
    agriculture: 0,
    manufacturing: 0,
    services: 0,
    sports: 0,
  };

  for (const group of groups) {
    population += group.count;
    wellbeing += group.count * group.wellbeing;
    approval += group.count * group.approval;
    if (group.lifeStage === 'child') children += group.count;
    if (group.lifeStage === 'senior') seniors += group.count;
    if (group.lifeStage !== 'adult') continue;
    adults += group.count;
    if (!group.employed) continue;
    employedAdults += group.count;
    if (group.occupation === null) continue;
    workers += group.count;
    occupations[group.occupation] += group.count;
  }

  const cell = model.cells[cellId];
  const populationDivisor = Math.max(population, 1e-12);
  const result = {
    employment: adults > 0 ? employedAdults / adults : 0,
    happiness: wellbeing / populationDivisor,
    approval: approval / populationDivisor,
    children: children / populationDivisor,
    seniors: seniors / populationDivisor,
    agriculture: cell.agriculture,
    manufacturing: cell.manufacturing,
    services: cell.services,
    sports: cell.sports,
  };
  if (workers > 0) {
    for (const sector of SECTORS) result[sector] = occupations[sector] / workers;
  }
  return result;
}

/**
 * Materialize human aggregates back onto mapxels for legacy economic rules, summaries, and UI.
 * Population groups are authoritative; these fields are projections, not an independent social model.
 * Running in the final phase also means next month's economy reads the people produced by this month.
 */
export const populationAggregationRule: Rule = {
  id: 'population.aggregate',
  phase: 'events',
  description: 'Project settled population groups into mapxel employment, wellbeing, approval, demographics, and occupational shares.',
  run({ model }) {
    return model.cells.flatMap(cell => {
      if (cell.biome === 'water') return [];
      const target = projectedFields(model, cell.id);
      return Object.entries(target).map(([rawField, rawValue]) => {
        const field = rawField as MutableField;
        const value = Number(rawValue);
        return {
          kind: 'delta' as const,
          cell: cell.id,
          field,
          amount: value - cell[field],
          evidence: projectionEvidence(model, cell.id, field, cell[field], value),
        } satisfies Effect;
      });
    });
  },
};
