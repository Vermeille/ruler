import { SECTORS, type Effect, type MutableField, type Rule } from '../types';
import {
  approvalOf,
  childrenShareOf,
  employmentOf,
  occupationShareOf,
  seniorShareOf,
  wellbeingOf,
} from './selectors';

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
      return Object.entries(target).map(([field, value]) => ({
        kind: 'delta' as const,
        cell: cell.id,
        field: field as MutableField,
        amount: Number(value) - cell[field as MutableField],
      } satisfies Effect));
    });
  },
};
