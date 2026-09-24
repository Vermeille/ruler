import { clamp } from '../math';
import type { DeepReadonly, Model, PopulationGroup, Rule, StepCache } from '../types';
import { changeToward } from '../rules/helpers';

function groupPoverty(group: DeepReadonly<PopulationGroup>): number {
  return clamp((24 - group.wealth) / 24);
}

function localCrimePressure(
  model: DeepReadonly<Model>,
  cache: DeepReadonly<StepCache>,
  cellId: number,
): {
  target: number;
  wealth: number;
  neighborWealth: number;
  unemployment: number;
  representative?: DeepReadonly<PopulationGroup>;
} {
  const groups = model.populationGroups[cellId];
  const people = cache.peopleByCell[cellId];
  const unemployment = people.adultPopulation > 0 ? 1 - people.employmentRate : 0;

  const poverty = people.population > 0
    ? groups.reduce((sum, group) => sum + group.count * groupPoverty(group), 0) / people.population
    : 0;
  const wealth = people.averageWealth;
  const neighbors = model.neighbors[cellId].filter(id => model.cells[id].biome !== 'water');
  const neighborWealth = neighbors.length > 0
    ? neighbors.reduce((sum, id) => sum + cache.peopleByCell[id].averageWealth, 0) / neighbors.length
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
  direction: 'people-to-mapxel',
  phase: 'behavior',
  description: 'Resident poverty, unemployment, and nearby inequality create crime pressure; policing and welfare damp it.',
  run({ model, cache }) {
    return model.cells.flatMap(cell => {
      if (cell.biome === 'water' || cache.peopleByCell[cell.id].population <= 0) return [];
      const pressure = localCrimePressure(model, cache, cell.id);
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
