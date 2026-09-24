import { SECTORS, type DeepReadonly, type Model, type Sector, type StepCache, type StepPeopleSummary } from './types';

function zeroOccupationShares(): Record<Sector, number> {
  return {
    agriculture: 0,
    manufacturing: 0,
    services: 0,
    sports: 0,
  };
}

/**
 * Build the immutable summaries that rules may use for aggregate reads during one
 * simulation step. PopulationGroup is the only authority: mapxel projection fields
 * are deliberately not consulted, even as a fallback for empty cohorts.
 */
export function buildStepCache(model: DeepReadonly<Model>): DeepReadonly<StepCache> {
  const peopleByCell = model.populationGroups.map(groups => {
    let population = 0;
    let adultPopulation = 0;
    let employedAdults = 0;
    let workerPopulation = 0;
    let children = 0;
    let seniors = 0;
    let education = 0;
    let income = 0;
    let wealth = 0;
    let health = 0;
    let wellbeing = 0;
    let approval = 0;
    let outlook = 0;
    let mobilization = 0;
    let infection = 0;
    const occupationCounts = zeroOccupationShares();

    for (const group of groups) {
      const count = group.count;
      population += count;
      education += count * group.education;
      income += count * group.income;
      wealth += count * group.wealth;
      health += count * group.health;
      wellbeing += count * group.wellbeing;
      approval += count * group.approval;
      outlook += count * group.outlook;
      mobilization += count * group.mobilization;
      infection += count * group.infection;

      if (group.lifeStage === 'child') {
        children += count;
        continue;
      }
      if (group.lifeStage === 'senior') {
        seniors += count;
        continue;
      }

      adultPopulation += count;
      if (!group.employed) continue;
      employedAdults += count;
      if (group.occupation === null) continue;
      workerPopulation += count;
      occupationCounts[group.occupation] += count;
    }

    const populationDivisor = Math.max(population, 1e-12);
    const occupationShares = zeroOccupationShares();
    if (workerPopulation > 0) {
      for (const sector of SECTORS) {
        occupationShares[sector] = occupationCounts[sector] / workerPopulation;
      }
    }

    const summary: StepPeopleSummary = {
      population,
      adultPopulation,
      employedAdults,
      workerPopulation,
      employmentRate: adultPopulation > 0 ? employedAdults / adultPopulation : 0,
      childShare: children / populationDivisor,
      seniorShare: seniors / populationDivisor,
      averageEducation: education / populationDivisor,
      averageIncome: income / populationDivisor,
      averageWealth: wealth / populationDivisor,
      averageHealth: health / populationDivisor,
      averageWellbeing: wellbeing / populationDivisor,
      averageApproval: approval / populationDivisor,
      averageOutlook: outlook / populationDivisor,
      averageMobilization: mobilization / populationDivisor,
      averageInfection: infection / populationDivisor,
      occupationShares: Object.freeze(occupationShares),
    };
    return Object.freeze(summary);
  });

  const regionPopulation = model.regions.map(() => 0);
  const regionWellbeing = model.regions.map(() => 0);
  let nationalPopulation = 0;
  let nationalWellbeing = 0;
  for (const cell of model.cells) {
    if (cell.biome === 'water') continue;
    const people = peopleByCell[cell.id];
    regionPopulation[cell.region] += people.population;
    regionWellbeing[cell.region] += people.averageWellbeing * people.population;
    nationalPopulation += people.population;
    nationalWellbeing += people.averageWellbeing * people.population;
  }
  const regionAverageWellbeing = regionWellbeing.map((total, region) =>
    total / Math.max(regionPopulation[region], 1e-12));

  return Object.freeze({
    peopleByCell: Object.freeze(peopleByCell),
    nationalAverageWellbeing: nationalWellbeing / Math.max(nationalPopulation, 1e-12),
    regionAverageWellbeing: Object.freeze(regionAverageWellbeing),
  });
}

/**
 * Production step execution always provides one shared cache. This fallback exists
 * only for isolated rule invocation in tests and developer analysis, where there is
 * no enclosing step lifecycle to own one.
 */
export function resolveStepCache(
  model: DeepReadonly<Model>,
  cache?: DeepReadonly<StepCache>,
): DeepReadonly<StepCache> {
  return cache ?? buildStepCache(model);
}
