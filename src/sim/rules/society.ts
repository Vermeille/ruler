import { averageWealthOf } from '../population/selectors';
import type { Effect, Rule } from '../types';
import { isLand } from './helpers';
import { conditionEffects } from './society/conditions';
import { employmentEffects } from './society/labor';
import { wellbeingEffects } from './society/wellbeing';

export { migrationRule } from './society/migration';

/**
 * The society phase is intentionally a thin orchestrator. Environment-to-environment changes and
 * labor-market opportunities settle here; resident reactions and actions live in population rules.
 */
export const societyRule: Rule = {
  id: 'society.wellbeing',
  phase: 'society',
  description: 'Services, pollution, infrastructure, employment opportunities, sports interest, and deprivation respond to policy and world conditions.',
  run({ model }) {
    const effects: Effect[] = [];
    const wealthByCell = model.cells.map(cell => (
      cell.biome === 'water' ? 0 : averageWealthOf(model, cell.id)
    ));

    for (const cell of model.cells) {
      if (!isLand(cell)) continue;
      effects.push(...conditionEffects(cell, model, wealthByCell));
      effects.push(...employmentEffects(cell, model));
      effects.push(...wellbeingEffects(cell, model));
    }

    return effects;
  },
};
