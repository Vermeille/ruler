import { averageWealthOf, employmentOf } from '../population/selectors';
import type { Effect, Rule } from '../types';
import { isLand } from './helpers';
import { conditionEffects } from './society/conditions';
import { employmentEffects } from './society/labor';
import { wellbeingEffects } from './society/wellbeing';

export { migrationRule } from './society/migration';

/**
 * The society phase is intentionally a thin orchestrator. Each behavior domain owns its formulas
 * and evidence in src/sim/rules/society/, while this rule preserves their phase and effect order.
 */
export const societyRule: Rule = {
  id: 'society.wellbeing',
  phase: 'society',
  description: 'People-facing conditions respond to poverty, actual employment, services, health, food, pollution, and civil liberties.',
  run({ model }) {
    const effects: Effect[] = [];
    const wealthByCell = model.cells.map(cell => (
      cell.biome === 'water' ? 0 : averageWealthOf(model, cell.id)
    ));
    const employmentByCell = model.cells.map(cell => (
      cell.biome === 'water' ? 0 : employmentOf(model, cell.id)
    ));

    for (const cell of model.cells) {
      if (!isLand(cell)) continue;
      const actualEmployment = employmentByCell[cell.id];

      effects.push(...conditionEffects(cell, model, wealthByCell, actualEmployment));
      effects.push(...employmentEffects(cell, model));
      effects.push(...wellbeingEffects(
        cell,
        model,
        wealthByCell[cell.id],
        actualEmployment,
      ));
    }

    return effects;
  },
};
