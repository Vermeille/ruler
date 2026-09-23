import { SECTORS, type Effect, type Evidence, type MutableField, type Rule, type Sector } from '../types';
import {
  approvalOf,
  childrenShareOf,
  employmentOf,
  occupationShareOf,
  seniorShareOf,
  wellbeingOf,
} from './selectors';

function projectionParents(
  model: Parameters<Rule['run']>[0]['model'],
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
  model: Parameters<Rule['run']>[0]['model'],
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
      const target: Partial<Record<MutableField, number>> = {
        employment: employmentOf(model, cell.id),
        happiness: wellbeingOf(model, cell.id),
        approval: approvalOf(model, cell.id),
        children: childrenShareOf(model, cell.id),
        seniors: seniorShareOf(model, cell.id),
      };
      for (const sector of SECTORS) target[sector] = occupationShareOf(model, cell.id, sector);
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
