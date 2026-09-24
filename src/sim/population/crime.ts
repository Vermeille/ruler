import { clamp } from '../math';
import { averageWealthOf } from './selectors';
import type { DeepReadonly, Model, PopulationGroup, Rule } from '../types';
import { changeToward } from '../rules/helpers';

function groupPoverty(group: DeepReadonly<PopulationGroup>): number {
  return clamp((24 - group.wealth) / 24);
}

function localCrimePressure(model: DeepReadonly<Model>, cellId: number): {
  target: number;
  wealth: number;
  neighborWealth: number;
  unemployment: number;
  representative?: DeepReadonly<PopulationGroup>;
} {
  const cell = model.cells[cellId];
  const groups = model.populationGroups[cellId];
  const population = groups.reduce((sum, group) => sum + group.count, 0);
  const adults = groups.reduce((sum, group) =>
    sum + (group.lifeStage === 'adult' ? group.count : 0), 0);
  const unemployedAdults = groups.reduce((sum, group) =>
    sum + (group.lifeStage === 'adult' && !group.employed ? group.count : 0), 0);
  const unemployment = adults > 0 ? unemployedAdults / adults : 0;

  const poverty = population > 0
    ? groups.reduce((sum, group) => sum + group.count * groupPoverty(group), 0) / population
    : 0;
  const wealth = averageWealthOf(model, cellId);
  const neighbors = model.neighbors[cellId].filter(id => model.cells[id].biome !== 'water');
  const neighborWealth = neighbors.length > 0
    ? neighbors.reduce((sum, id) => sum + averageWealthOf(model, id), 0) / neighbors.length
    : wealth;
  const inequality = clamp((neighborWealth - wealth) / 40);
  const police = model.policy.spending.police * model.budget.funding;
  const welfare = model.policy.spending.welfare * model.budget.funding;
  const target = clamp(
    0.11
      + poverty * 0.3
      + inequality * 0.24
      + unemployment * 0.3
      - police * 0.3
      - welfare * 0.09,
    0.015,
    0.7,
  );

  const representative = groups
    .map(group => ({
      group,
      pressure: groupPoverty(group)
        + (group.lifeStage === 'adult' && !group.employed ? 1 : 0),
    }))
    .sort((a, b) => b.pressure - a.pressure || a.group.id - b.group.id)[0]?.group;

  return { target, wealth, neighborWealth, unemployment, representative };
}

/** Resident circumstances create crime pressure; policing and welfare change how much reaches the world. */
export const populationCrimeRule: Rule = {
  id: 'population.crime',
  phase: 'behavior',
  description: 'Resident poverty, unemployment, and nearby inequality create crime pressure; policing and welfare damp it.',
  run({ model }) {
    return model.cells.flatMap(cell => {
      if (cell.biome === 'water' || cell.population <= 0) return [];
      const pressure = localCrimePressure(model, cell.id);
      const shouldExplain = Math.abs(pressure.target - cell.crime) > 0.06
        && model.tick % 3 === 0;
      const evidence = shouldExplain
        ? {
            title: `${cell.name}: crime pressure ${pressure.target > cell.crime ? 'rises' : 'recedes'}`,
            detail: `Resident circumstances imply a ${(pressure.target * 100).toFixed(0)}% local crime-pressure target. Average household reserves are ${pressure.wealth.toFixed(1)}, neighboring reserves average ${pressure.neighborWealth.toFixed(1)}, and ${(pressure.unemployment * 100).toFixed(0)}% of working-age residents are unemployed.`,
            cells: [cell.id],
            reads: pressure.representative ? [
              { cell: cell.id, group: pressure.representative.id, field: 'wealth' as const, label: 'At-risk group reserves' },
              { cell: cell.id, group: pressure.representative.id, field: 'employed' as const, label: 'At-risk group employment' },
            ] : [],
            parents: [
              'policy:spending:police',
              'policy:spending:welfare',
              'policy:incomeTax',
              'policy:businessTax',
            ],
          }
        : undefined;
      return [changeToward(cell, 'crime', pressure.target, 0.12, evidence)];
    });
  },
};
