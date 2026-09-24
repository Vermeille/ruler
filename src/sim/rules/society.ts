import { clamp } from '../math';
import { SECTORS, type Archetype, type DeepReadonly, type Effect, type Mapxel, type Model, type PopulationGroup, type Rule, type Sector } from '../types';
import { changeToward, delta, isLand, read } from './helpers';
import { viableJobs } from './wages';
import { archetypeAt } from '../population/archetypes';
import { averageWealthOf, employmentOf } from '../population/selectors';

type SectorViability = Record<Sector, number>;

function viabilityOf(cell: DeepReadonly<Mapxel>, model: DeepReadonly<Model>): SectorViability {
  return {
    agriculture: viableJobs(cell, model, 'agriculture'),
    manufacturing: viableJobs(cell, model, 'manufacturing'),
    services: viableJobs(cell, model, 'services'),
    sports: viableJobs(cell, model, 'sports'),
  };
}

/** Legacy mapxel projection used for diagnostics during the authority migration. */
function employmentTarget(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
  viability: SectorViability,
): number {
  const affordableJobs = SECTORS.reduce(
    (sum, sector) => sum + cell[sector] * viability[sector], 0,
  );
  const ordinaryJobs = clamp(
    0.96
      - (1 - cell.businessHealth) * cell.services * 0.6
      - model.policy.businessTax * 0.12
      - (1 - cell.foodSecurity) * 0.05,
    0.45,
    0.98,
  );
  return clamp(ordinaryJobs * affordableJobs, 0.05, 0.98);
}

function desiredEmployedAdults(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
  adults: readonly DeepReadonly<PopulationGroup>[],
  viability: SectorViability,
): number {
  const capacity = adults.reduce((sum, group) => {
    if (!group.occupation) return sum;
    return sum + group.count * viability[group.occupation];
  }, 0);
  const ordinaryDemand = clamp(
    0.98
      - (1 - cell.businessHealth) * 0.35
      - model.policy.businessTax * 0.12
      - (1 - cell.foodSecurity) * 0.05,
    0.45,
    0.99,
  );
  return capacity * ordinaryDemand;
}

function employmentTransitions(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
  viability: SectorViability,
): Effect[] {
  const adults = model.populationGroups[cell.id].filter(group => group.lifeStage === 'adult');
  if (!adults.length) return [];
  const employed = adults.reduce((sum, group) => sum + (group.employed ? group.count : 0), 0);
  const target = desiredEmployedAdults(cell, model, adults, viability);
  const change = target - employed;
  if (Math.abs(change) < 0.25) return [];
  const losingJobs = change < 0;
  let remaining = Math.abs(change);
  const candidates = adults.filter(group => group.employed === losingJobs).map(group => {
    const archetype = archetypeAt(model.seed, group.archetype, model.archetypeModelVersion);
    const sectorViability = group.occupation ? viability[group.occupation] : 0;
    const score = losingJobs
      ? (1 - sectorViability) * 0.6 + (1 - group.education) * 0.2 + (1 - archetype.traits.adaptability) * 0.2
      : sectorViability * 0.45 + archetype.traits.adaptability * 0.3 + group.education * 0.25;
    return { group, score };
  }).sort((a, b) => b.score - a.score || a.group.id - b.group.id);
  const effects: Effect[] = [];
  for (const { group } of candidates) {
    if (remaining <= 1e-9) break;
    const amount = Math.min(group.count, remaining);
    effects.push({ kind: 'population-transition', cell: cell.id, group: group.id,
      amount, transition: { employed: !losingJobs },
      evidence: amount >= 1 && model.tick % 3 === 0 ? {
        title: `${cell.name}: ${losingJobs ? 'workers lose jobs' : 'residents find work'}`,
        detail: `${amount.toFixed(1)} residents of archetype #${group.archetype} ${losingJobs ? 'lose employment' : 'enter employment'} because local firms can support a different number of jobs. Adaptability, education, and occupation viability decide who is affected.`,
        cells: [cell.id],
        reads: [
          { cell: cell.id, group: group.id, field: 'employed', label: 'Starting employment status' },
          { cell: cell.id, field: 'businessHealth', label: 'Business viability' },
        ],
        parents: ['policy:minimumWage', 'policy:businessTax'],
      } : undefined,
    });
    remaining -= amount;
  }
  return effects;
}

function averageNeighborWealth(
  model: DeepReadonly<Model>,
  neighbors: readonly DeepReadonly<Mapxel>[],
): number {
  const total = neighbors.reduce(
    (sum, neighbor) => sum + averageWealthOf(model, neighbor.id),
    0,
  );
  return total / Math.max(1, neighbors.length);
}

export const societyRule: Rule = {
  id: 'society.wellbeing',
  phase: 'society',
  description: 'People-facing conditions respond to poverty, actual employment, services, health, food, pollution, and civil liberties.',
  run({ model }) {
    return model.cells.filter(isLand).flatMap(cell => {
      const spending = model.policy.spending;
      const funding = model.budget.funding;
      const wealth = averageWealthOf(model, cell.id);
      const actualEmployment = employmentOf(model, cell.id);
      const neighbors = model.neighbors[cell.id].map(id => model.cells[id]);
      const neighborIndustry = neighbors.length
        ? neighbors.reduce((sum, neighbor) => sum + neighbor.manufacturing, 0) / neighbors.length
        : cell.manufacturing;
      const neighborWealth = averageNeighborWealth(model, neighbors);
      const inequality = clamp((neighborWealth - wealth) / 40);
      const poverty = clamp((24 - wealth) / 24);
      const police = spending.police * funding;

      const crimeTarget = clamp(
        0.11
          + poverty * 0.3
          + inequality * 0.24
          + (1 - actualEmployment) * 0.3
          - police * 0.3
          - spending.welfare * funding * 0.09,
        0.015,
        0.7,
      );
      const crimeEvidence = Math.abs(crimeTarget - cell.crime) > 0.06
        && model.tick % 3 === 0
        ? {
            title: `${cell.name}: crime pressure ${crimeTarget > cell.crime ? 'rises' : 'recedes'}`,
            detail: `Average household reserves are ${wealth.toFixed(1)} for local population groups, compared with ${neighborWealth.toFixed(1)} next door. Effective police funding is ₡${police.toFixed(2)} per resident.`,
            cells: [cell.id],
            reads: [
              read(cell, 'employment', 'Previous aggregate employment'),
              ...neighbors.slice(0, 2).map(neighbor => read(neighbor, 'cash', 'Neighbor private account')),
            ],
            parents: [
              'policy:spending:police',
              'policy:spending:welfare',
              'policy:incomeTax',
              'policy:businessTax',
            ],
          }
        : undefined;

      const healthTarget = clamp(
        0.55
          + spending.health * funding * 0.5
          - cell.pollution * 0.18
          - (1 - cell.foodSecurity) * 0.35
          + wealth * 0.001,
      );
      const educationTarget = clamp(
        0.35 + spending.education * funding * 0.6 + wealth * 0.002,
      );
      const infrastructureTarget = clamp(
        0.3
          + spending.infrastructure * funding * 0.9
          + Math.min(1, cell.materials / cell.population) * 0.06,
      );
      const pollutionTarget = clamp(
        (cell.manufacturing * 0.75 + neighborIndustry * 0.25) * (model.policy.laws.cleanAir ? 0.6 : 1.1)
          + cell.population / 12000
          - spending.environment * funding * 0.7,
      );

      // Keep the old mapxel employment proposal only as a diagnostic compatibility signal.
      // population.aggregate overwrites it from actual groups before the tick is summarized.
      const viability = viabilityOf(cell, model);
      const affordableJobs = SECTORS.reduce(
        (sum, sector) => sum + cell[sector] * viability[sector], 0,
      );
      const jobsTarget = employmentTarget(cell, model, viability);
      const employmentEvidence = affordableJobs < 0.6
        && cell.employment > jobsTarget + 0.1 && model.tick % 3 === 0
        ? {
            title: `${cell.name}: firms cut hiring`,
            detail: `At a ₡${model.policy.minimumWage.toFixed(2)} wage floor, only ${(affordableJobs * 100).toFixed(0)}% of the previous occupational mix can cover payroll. Actual job losses are assigned to population groups separately.`,
            cells: [cell.id],
            reads: [read(cell, 'output', 'Local production'), read(cell, 'businessHealth', 'Business viability'), read(cell, 'employment', 'Previous employment projection')],
            parents: ['policy:minimumWage'],
          }
        : undefined;
      const happinessTarget = clamp(
        0.29
          + cell.health * 0.22
          + cell.foodSecurity * 0.2
          + actualEmployment * 0.16
          + clamp(wealth / 45) * 0.08
          - cell.crime * 0.45
          - cell.pollution * 0.08
          + spending.culture * funding * 0.12
          - (model.policy.laws.publicAssembly ? 0 : 0.12),
      );
      const approvalTarget = clamp(
        cell.happiness * 0.82
          + 0.12
          - model.policy.incomeTax * 0.25
          - (1 - funding) * 0.17
          + (model.policy.laws.publicAssembly ? 0.025 : -0.06),
      );
      const sportsInterestTarget = clamp(
        0.17 + cell.sports * 0.85 + spending.culture * funding * 0.6,
      );
      const deprivation = clamp((0.7 - cell.foodSecurity) / 0.7);
      const starvationDeaths = cell.population * deprivation * deprivation * 0.008;
      const childrenTarget = clamp(0.15 + cell.happiness * 0.09, 0.12, 0.28);
      const seniorsTarget = clamp(0.12 + cell.health * 0.07, 0.12, 0.22);

      return [
        changeToward(cell, 'crime', crimeTarget, 0.12, crimeEvidence),
        changeToward(cell, 'health', healthTarget, 0.045),
        changeToward(cell, 'education', educationTarget, 0.025),
        changeToward(cell, 'infrastructure', infrastructureTarget, 0.06),
        changeToward(cell, 'pollution', pollutionTarget, 0.08),
        changeToward(cell, 'employment', jobsTarget, 0.1, employmentEvidence),
        ...employmentTransitions(cell, model, viability),
        changeToward(cell, 'happiness', happinessTarget, 0.09),
        changeToward(cell, 'approval', approvalTarget, 0.12),
        changeToward(cell, 'sportsInterest', sportsInterestTarget, 0.06),
        delta(cell, 'starvationDeaths', starvationDeaths - cell.starvationDeaths),
        changeToward(cell, 'children', childrenTarget, 0.008),
        changeToward(cell, 'seniors', seniorsTarget, 0.005),
      ];
    });
  },
};

function migrationAppeal(
  group: DeepReadonly<PopulationGroup>,
  archetype: Archetype,
  cell: DeepReadonly<Mapxel>,
  jobChance: number,
  culture: number,
  atHome: boolean,
): number {
  const wealthBuffer = clamp(group.wealth / 35);
  const employment = atHome ? (group.employed ? 1 : 0.2) : 0.2 + jobChance * 0.8;
  const expectedIncome = atHome
    ? group.income
    : cell.output / Math.max(1, cell.population) * (0.8 + group.education * 0.3) * jobChance;
  const purchasingPower = clamp((expectedIncome + Math.min(group.wealth, 30) * 0.08) / (6 * cell.price));
  const food = clamp(cell.foodSecurity + wealthBuffer * 0.08
    - Math.max(0, cell.price - 1) * (1 - wealthBuffer) * 0.12);
  const health = atHome ? group.health : cell.health;
  const needs = archetype.needs;
  const weight = needs.food + needs.income + needs.employment + needs.health + needs.safety
    + needs.housing + needs.education + needs.environment + needs.culture;
  const lived = (
    needs.food * food
    + needs.income * purchasingPower
    + needs.employment * employment
    + needs.health * health
    + needs.safety * (1 - cell.crime)
    + needs.housing * clamp(1 - cell.population / 20_000)
    + needs.education * cell.education
    + needs.environment * (1 - cell.pollution)
    + needs.culture * culture
  ) / weight;
  // Community mood is itself a projection of residents after population.aggregate.
  // It is a small shared contextual signal, not the source of the migration amount.
  const communityMood = atHome ? group.wellbeing : cell.happiness;
  return lived + communityMood * 0.25;
}

export const migrationRule: Rule = {
  id: 'society.migration',
  phase: 'migration',
  description: 'Each quarter, every adult group evaluates nearby places through its own needs, job, wealth, mobility, attachment, and lived conditions.',
  run({ model }) {
    if (model.tick % 3 !== 0) return [];
    const effects: Effect[] = [];
    const culture = clamp(0.5 + model.policy.spending.culture * model.budget.funding);
    const viability = model.cells.map(cell => cell.biome === 'water' ? undefined : viabilityOf(cell, model));

    for (const from of model.cells) {
      if (!isLand(from)) continue;
      const movedByDestination = new Map<number, number>();
      const originViability = viability[from.id]!;
      for (const group of model.populationGroups[from.id]) {
        if (group.lifeStage !== 'adult' || group.count <= 0) continue;
        const archetype = archetypeAt(model.seed, group.archetype, model.archetypeModelVersion);
        const originJobChance = group.occupation ? originViability[group.occupation] : 0.5;
        const originAppeal = migrationAppeal(group, archetype, from, originJobChance, culture, true);
        let bestCell: DeepReadonly<Mapxel> | undefined;
        let bestAdvantage = -Infinity;
        for (const neighborId of model.neighbors[from.id]) {
          const to = model.cells[neighborId];
          if (to.biome === 'water') continue;
          const jobChance = group.occupation ? viability[to.id]![group.occupation] : 0.5;
          const advantage = migrationAppeal(group, archetype, to, jobChance, culture, false) - originAppeal;
          if (advantage > bestAdvantage || (advantage === bestAdvantage && bestCell && to.id < bestCell.id)) {
            bestCell = to;
            bestAdvantage = advantage;
          }
        }
        if (!bestCell || bestAdvantage <= 0) continue;

        const means = clamp(group.wealth / 10, 0.2, 1);
        const hardship = 1 + (1 - group.wellbeing) * 0.4 + (group.employed ? 0 : 0.25);
        const propensity = (0.2 + archetype.traits.mobility)
          * (1 - archetype.traits.communityAttachment * 0.75)
          * means
          * hardship;
        const freedomMultiplier = model.policy.laws.freeMovement ? 1 : 0.08;
        const rate = Math.min(0.009, bestAdvantage * 0.021 * propensity) * freedomMultiplier;
        const amount = group.count * rate;
        if (amount <= 1e-9) continue;

        effects.push({
          kind: 'population-transfer',
          group: group.id,
          from: from.id,
          to: bestCell.id,
          amount,
          evidence: amount >= 0.5 ? {
            title: `${from.name}: archetype #${group.archetype} moves toward ${bestCell.name}`,
            detail: `${amount.toFixed(1)} people move because this group values the destination more under its own needs and circumstances. Employment status, income, reserves, mobility, community attachment, prices, services, safety, and environment all contribute.`,
            cells: [from.id, bestCell.id],
            reads: [
              { cell: from.id, group: group.id, field: 'wealth', label: 'Group reserves' },
              { cell: from.id, group: group.id, field: 'wellbeing', label: 'Group wellbeing' },
              { cell: from.id, group: group.id, field: 'employed', label: 'Current employment' },
              { cell: bestCell.id, field: 'price', label: 'Destination prices' },
              { cell: bestCell.id, field: 'foodSecurity', label: 'Destination food access' },
            ],
            parents: ['policy:law:freeMovement'],
          } : undefined,
        });
        movedByDestination.set(bestCell.id, (movedByDestination.get(bestCell.id) ?? 0) + amount);
      }

      for (const [destination, movingPopulation] of movedByDestination) {
        effects.push({
          kind: 'transfer',
          from: from.id,
          to: destination,
          resource: 'cash',
          amount: movingPopulation * Math.max(0, from.cash) / Math.max(1e-12, from.population),
        });
      }
    }

    return effects;
  },
};
