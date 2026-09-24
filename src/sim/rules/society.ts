import { averageWealthOf } from '../population/selectors';
import type { Effect, Rule } from '../types';
import { isLand } from './helpers';
import { conditionEffects } from './society/conditions';
import { wellbeingEffects } from './society/wellbeing';

export { migrationRule } from './society/migration';

/** Environment-to-environment conditions settle here; resident state changes live in population rules. */
export const societyRule: Rule = {
  id: 'society.wellbeing',
  phase: 'society',
  description: 'Services, pollution, infrastructure, and cultural conditions respond to policy and world state.',
  run({ model }) {
    const effects: Effect[] = [];
    const wealthByCell = model.cells.map(cell => (
      cell.biome === 'water' ? 0 : averageWealthOf(model, cell.id)
    ));

    for (const cell of model.cells) {
      if (!isLand(cell)) continue;
      effects.push(...conditionEffects(cell, model, wealthByCell));
      effects.push(...wellbeingEffects(cell, model));
    }

    return effects;
  },
};
