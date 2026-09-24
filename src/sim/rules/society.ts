import { averageWealthOf, employmentOf } from '../population/selectors';
import type { Effect, Rule } from '../types';
import { isLand } from './helpers';
import { conditionEffects } from './society/conditions';
import { employmentEffects } from './society/labor';
import { wellbeingEffects } from './society/wellbeing';

export { migrationRule } from './society/migration';

/**
 * The society phase is intentionally a thin orchestrator. World conditions change here; mutable
 * human state changes in population rules and is projected back to mapxels only in projection.
 */
export const societyRule: Rule = {
  id: 'society.wellbeing',
  phase: 'society',
  description: 'Local crime, services, employment opportunities, sports interest, and deprivation respond to residents, policy, and world conditions.',
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
      effects.push(...wellbeingEffects(cell, model));
    }

    return effects;
  },
};
