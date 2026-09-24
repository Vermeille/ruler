import { SECTORS, type Effect, type Rule } from '../types';
import { archetypeAt } from './archetypes';

/** Time itself changes people: every settled population group ages by one month. */
export const populationAgingRule: Rule = {
  id: 'population.aging',
  phase: 'aging',
  description: 'Every population group ages by one month.',
  run({ model }) {
    const effects: Effect[] = [];
    model.populationGroups.forEach((groups, cell) => {
      for (const group of groups) {
        effects.push({
          kind: 'population-state',
          cell,
          group: group.id,
          amount: group.count,
          change: { age: 1 / 12 },
        });
      }
    });
    return effects;
  },
};

/** Life-stage transitions see the age already settled by the preceding aging phase. */
export const populationLifeStageRule: Rule = {
  id: 'population.life-stage',
  phase: 'lifeStage',
  description: 'Children enter the working-age population at 18; adults retire at 65.',
  run({ model }) {
    const effects: Effect[] = [];
    model.populationGroups.forEach((groups, cell) => {
      for (const group of groups) {
        if (group.lifeStage === 'child' && group.age >= 18) {
          const archetype = archetypeAt(model.seed, group.archetype, model.archetypeModelVersion);
          const occupation = SECTORS.reduce((best, sector) =>
            model.cells[cell][sector] * archetype.affinities[sector]
              > model.cells[cell][best] * archetype.affinities[best] ? sector : best, SECTORS[0]);
          effects.push({
            kind: 'population-transition',
            cell,
            group: group.id,
            amount: group.count,
            transition: { lifeStage: 'adult', occupation, employed: false },
          });
        } else if (group.lifeStage === 'adult' && group.age >= 65) {
          effects.push({
            kind: 'population-transition',
            cell,
            group: group.id,
            amount: group.count,
            transition: { lifeStage: 'senior', occupation: null, employed: false },
          });
        }
      }
    });
    return effects;
  },
};
