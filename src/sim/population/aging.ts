import type { Effect, Rule } from '../types';

/** Time itself changes people: every settled population group ages by one month. */
// [I] DEMOGRAPHICS-AGING1
export const populationAgingRule: Rule = {
  id: 'population.aging',
  direction: 'people-to-people',
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
// [I] DEMOGRAPHICS-LIFESTAGE1
export const populationLifeStageRule: Rule = {
  id: 'population.life-stage',
  direction: 'people-to-people',
  phase: 'lifeStage',
  description: 'Children become working-age adults at 18; adults retire at 65.',
  run({ model }) {
    const effects: Effect[] = [];
    model.populationGroups.forEach((groups, cell) => {
      for (const group of groups) {
        if (group.lifeStage === 'child' && group.age >= 18) {
          effects.push({
            kind: 'population-transition',
            cell,
            group: group.id,
            amount: group.count,
            transition: { lifeStage: 'adult', occupation: null, employed: false },
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
