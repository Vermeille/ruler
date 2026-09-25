import { clamp } from '../math';
import { resolveStepCache } from '../step-cache';
import {
  SECTORS,
  type DeepReadonly,
  type Effect,
  type Evidence,
  type Mapxel,
  type Rule,
} from '../types';
import {
  crowns,
  crownsPerMonth,
  foodCoverage,
  foodPrice,
  materialPrice,
  materialUnits,
  monthlyFoodNeed,
  oneMonthOf,
  people,
  personMonths,
  relativeFoodPrice,
} from '../units';
import { changeToward, delta, isLand, read } from './helpers';
import { unitOutput, viableJobs } from './wages';

// World generation starts ordinary rural infrastructure at 0.52. Treat that as
// neutral productivity and let better/worse infrastructure modestly change how
// effectively labor becomes market output. An 8-point infrastructure improvement
// therefore contributes roughly +0.64% output before downstream feedback.
const REFERENCE_INFRASTRUCTURE = 0.52;
const INFRASTRUCTURE_PRODUCTIVITY_SENSITIVITY = 0.08;

// [I] ECONOMY-PRODUCTION1
// [I] ECONOMY-FARM1
// [I] ECONOMY-MANUFACTURING1
// [I] ECONOMY-SECTOR-RETURNS1
// [I] ECONOMY-CASHFLOW1
export const productionRule: Rule = {
  id: 'economy.production',
  direction: 'people-to-mapxel',
  phase: 'production',
  description: 'Settled workers, their health, land, infrastructure, and seasonal weather produce food, materials, and output.',
  run({ model, cache, random }) {
    const peopleCache = resolveStepCache(model, cache);
    return model.cells.filter(isLand).flatMap(cell => {
      const population = people(peopleCache.peopleByCell[cell.id].population);
      const localPeople = peopleCache.peopleByCell[cell.id];
      const weather = 0.96
        + random(cell.id, 'weather') * 0.08
        + Math.sin(model.tick * Math.PI / 6) * 0.09;
      const labor = localPeople.employmentRate * (0.65 + 0.35 * localPeople.averageHealth);
      const food = personMonths(localPeople.population
        * localPeople.occupationShares.agriculture
        * (3 + 2 * cell.fertility)
        * labor
        * weather
        * (1 - cell.pollution * 0.18)
        * (1 - cell.waterStress * 0.6));
      const materials = materialUnits(localPeople.population
        * localPeople.occupationShares.manufacturing
        * (1.4 + cell.minerals)
        * labor
        * (model.policy.laws.cleanAir ? 0.9 : 1));
      const infrastructureProductivity = 1
        + (cell.infrastructure - REFERENCE_INFRASTRUCTURE) * INFRASTRUCTURE_PRODUCTIVITY_SENSITIVITY;
      const output = crownsPerMonth(localPeople.population * labor * infrastructureProductivity * SECTORS.reduce(
        (sum, sector) => sum + localPeople.occupationShares[sector] * unitOutput(cell, model, sector), 0,
      ));
      const foodEvidence: Evidence | undefined = food < monthlyFoodNeed(population)
        ? {
            title: `${cell.name}: local harvest falls short of monthly needs`,
            detail: `Local farms produced ${food.toFixed(0)} person-months of food for ${localPeople.population.toFixed(0)} residents. The settled worker mix and employment level combine with worker health, fertility, weather, pollution, and water stress to determine the harvest.`,
            cells: [cell.id],
            reads: [
              read(cell, 'pollution', 'Pollution pressure'),
              read(cell, 'waterStress', 'Water stress'),
            ],
            parents: model.populationGroups[cell.id].flatMap(group => [
              `group:${group.id}:occupation`,
              `group:${group.id}:employed`,
              `group:${group.id}:health`,
            ]),
          }
        : undefined;

      return [
        delta(cell, 'food', food, foodEvidence),
        delta(cell, 'materials', materials),
        delta(cell, 'output', crownsPerMonth(output - cell.output)),
        delta(cell, 'foodMade', personMonths(food - cell.foodMade)),
        delta(cell, 'foodTraded', personMonths(-cell.foodTraded)),
        {
          kind: 'transfer' as const,
          from: 'external' as const,
          to: cell.id,
          resource: 'cash' as const,
          amount: oneMonthOf(crownsPerMonth(output * 0.65)),
        },
      ];
    });
  },
};

function tradeEvidence(
  seller: DeepReadonly<Mapxel>,
  buyer: DeepReadonly<Mapxel>,
  buyerPopulation: number,
  amount: number,
): Evidence | undefined {
  if (buyer.foodSecurity >= 0.92 || amount <= buyerPopulation * 0.1) {
    return undefined;
  }

  return {
    title: `Food flows from ${seller.name} to ${buyer.name}`,
    detail: `${amount.toFixed(0)} person-months of food offered along a neighboring road. Settlement is limited by available stock and cash. Transport links determine how quickly shortages can be relieved.`,
    cells: [buyer.id, seller.id],
    reads: [
      read(buyer, 'foodSecurity', 'Buyer food security'),
      read(buyer, 'infrastructure', 'Buyer transport access'),
    ],
  };
}

// [I] ECONOMY-TRADE1
// [I] ECONOMY-TRADE2
// [I] ECONOMY-TRADE3
export const tradeRule: Rule = {
  id: 'economy.neighbor-trade',
  direction: 'mapxel-to-mapxel',
  phase: 'trade',
  description: 'Neighboring places exchange stocks and money according to inventories, prices, and transport capacity.',
  run({ model, cache }) {
    const peopleCache = resolveStepCache(model, cache);
    const effects: Effect[] = [];

    for (const a of model.cells.filter(isLand)) {
      const aPopulation = peopleCache.peopleByCell[a.id].population;
      if (aPopulation <= 0) continue;
      for (const neighborId of model.neighbors[a.id]) {
        if (neighborId <= a.id) continue;

        const b = model.cells[neighborId];
        const bPopulation = peopleCache.peopleByCell[b.id].population;
        if (bPopulation <= 0) continue;
        for (const resource of ['food', 'materials'] as const) {
          const aStock = a[resource] / aPopulation;
          const bStock = b[resource] / bPopulation;
          const [seller, buyer] = aStock > bStock ? [a, b] : [b, a];
          const sellerPopulation = seller.id === a.id ? aPopulation : bPopulation;
          const buyerPopulation = buyer.id === a.id ? aPopulation : bPopulation;
          const roadCapacity = 0.18 + 0.55 * Math.min(a.infrastructure, b.infrastructure);
          const equalizingAmount = Math.abs(aStock - bStock)
            * aPopulation
            * bPopulation
            / (aPopulation + bPopulation);
          const amount = Math.min(equalizingAmount * roadCapacity, sellerPopulation * 0.85);

          if (amount < 0.01) continue;

          if (resource === 'food') {
            effects.push({
              kind: 'trade',
              from: seller.id,
              to: buyer.id,
              resource: 'food',
              amount: personMonths(amount),
              price: foodPrice((a.price + b.price) / 2),
              evidence: tradeEvidence(seller, buyer, buyerPopulation, amount),
            });
          } else {
            effects.push({
              kind: 'trade',
              from: seller.id,
              to: buyer.id,
              resource: 'materials',
              amount: materialUnits(amount),
              price: materialPrice(0.65),
            });
          }
        }
      }
    }

    return effects;
  },
};

// [I] ECONOMY-CONSUMPTION1
// [I] ECONOMY-SPOILAGE1
// [I] ECONOMY-SPENDING1
export const consumptionRule: Rule = {
  id: 'economy.households',
  direction: 'people-to-mapxel',
  phase: 'consumption',
  description: 'Residents consume food and private cash; unmet needs become local food insecurity.',
  run({ model, cache }) {
    const peopleCache = resolveStepCache(model, cache);
    return model.cells.filter(isLand).flatMap(cell => {
      const localPeople = peopleCache.peopleByCell[cell.id];
      const need = monthlyFoodNeed(people(localPeople.population));
      const eaten = personMonths(Math.min(cell.food, need));
      const security = foodCoverage(eaten, need);
      const shouldExplainFood = Math.abs(security - cell.foodSecurity) > 0.08
        || (security < 0.85 && model.tick % 6 === 0);
      const foodEvidence = shouldExplainFood
        ? {
            title: `${cell.name}: ${security < 0.9 ? 'food supplies fall short' : 'food supplies recover'}`,
            detail: `Households could meet ${(security * 100).toFixed(0)}% of this month's food needs. Farms produced ${cell.foodMade.toFixed(0)} person-months; net neighboring trade was ${cell.foodTraded.toFixed(0)} person-months.`,
            cells: [cell.id],
            reads: [
              read(cell, 'food', 'Available food'),
              read(cell, 'infrastructure', 'Transport access'),
            ],
          }
        : undefined;
      const remainingFood = personMonths(Math.max(0, cell.food - eaten));
      const materialUse = materialUnits(Math.min(
        cell.materials,
        localPeople.population * 0.08 + cell.materials * 0.12,
      ));
      const householdSpending = localPeople.population
        * (1.6 + cell.cash / Math.max(localPeople.population, 1e-12) * 0.04)
        + oneMonthOf(crownsPerMonth(cell.output)) * 0.09;

      return [
        delta(cell, 'food', personMonths(-eaten - remainingFood * 0.16)),
        delta(cell, 'foodUsed', personMonths(eaten - cell.foodUsed)),
        delta(cell, 'materials', materialUnits(-materialUse)),
        delta(cell, 'foodSecurity', security - cell.foodSecurity, foodEvidence),
        {
          kind: 'transfer' as const,
          from: cell.id,
          to: 'external' as const,
          resource: 'cash' as const,
          amount: crowns(householdSpending),
        },
      ];
    });
  },
};

// [I] ECONOMY-PRICE1
// [I] ECONOMY-PRICECONTROL1
// [I] ECONOMY-BUSINESS1
export const marketRule: Rule = {
  id: 'economy.businesses',
  direction: 'mapxel-to-mapxel',
  phase: 'market',
  description: 'Scarcity changes prices; food, insecurity, and unaffordable payrolls squeeze local businesses.',
  run({ model, cache }) {
    const peopleCache = resolveStepCache(model, cache);
    return model.cells.filter(isLand).flatMap(cell => {
      const localPeople = peopleCache.peopleByCell[cell.id];
      const supplyRatio = localPeople.population > 0
        ? (cell.foodUsed + cell.food / 0.84) / localPeople.population
        : 2;
      const targetPrice = foodPrice(clamp(
        1
          + (1 - Math.min(2, supplyRatio)) * 1.3
          + (1 - cell.foodSecurity) * 1.8,
        0.55,
        4.5,
      ));
      const priceEvidence = Math.abs(targetPrice - cell.price) > 0.5 && model.tick % 3 === 0
        ? {
            title: `${cell.name}: food prices ${targetPrice > cell.price ? 'rise' : 'ease'}`,
            detail: 'Prices move gradually toward the local supply-demand balance. Scarcity raises the return to farming, but workers take time to change industries.',
            cells: [cell.id],
            reads: [
              read(cell, 'foodSecurity', 'Last measured food security'),
              read(cell, 'food', 'Stock available'),
            ],
          }
        : undefined;

      const normalizedFoodPrice = relativeFoodPrice(foodPrice(cell.price));
      const serviceJobs = viableJobs(cell, model, 'services', localPeople.averageHealth);
      const businessTarget = clamp(
        0.97
          - (1 - cell.foodSecurity) * 0.9
          - Math.max(0, normalizedFoodPrice - 1.4) * 0.17
          - cell.crime * 0.25
          - (1 - serviceJobs) * 0.7,
        0.12,
        1,
      );
      const businessEvidence = businessTarget < cell.businessHealth - 0.12
        ? {
            title: `${cell.name}: restaurants and shops struggle`,
            detail: serviceJobs < 1
              ? 'Food shortages, expensive ingredients, insecurity, and payroll costs squeeze local businesses. A weaker business sector cuts output and employment in subsequent months.'
              : 'Food shortages, expensive ingredients, and insecurity squeeze local businesses. A weaker business sector cuts output and employment in subsequent months.',
            cells: [cell.id],
            reads: [
              read(cell, 'foodSecurity', 'Food security'),
              read(cell, 'price', 'Food price'),
              read(cell, 'crime', 'Local crime'),
            ],
            parents: serviceJobs < 1 ? ['policy:minimumWage'] : [],
          }
        : undefined;

      return [
        delta(cell, 'price', foodPrice(
          clamp(
            cell.price + (targetPrice - cell.price) * 0.14,
            0.4,
            model.policy.laws.foodPriceControls ? 1 : 5,
          ) - cell.price,
        ), priceEvidence),
        changeToward(cell, 'scarcityPrice', targetPrice, 0.14),
        changeToward(cell, 'businessHealth', businessTarget, 0.15, businessEvidence),
      ];
    });
  },
};
