import { clamp } from '../math';
import {
  SECTORS,
  type DeepReadonly,
  type Effect,
  type Evidence,
  type Mapxel,
  type Rule,
} from '../types';
import { changeToward, delta, isLand, read } from './helpers';
import { unitOutput, viableJobs } from './wages';

export const productionRule: Rule = {
  id: 'economy.production',
  phase: 'production',
  description: 'Land, labor, health, and seasonal weather produce food and materials. Exports bring in money.',
  run({ model, random }) {
    return model.cells.filter(isLand).flatMap(cell => {
      const weather = 0.96
        + random(cell.id, 'weather') * 0.08
        + Math.sin(model.tick * Math.PI / 6) * 0.09;
      const labor = cell.employment * (0.65 + 0.35 * cell.health);
      const food = cell.population
        * cell.agriculture
        * (3 + 2 * cell.fertility)
        * labor
        * weather
        * (1 - cell.pollution * 0.18)
        * (1 - cell.waterStress * 0.6);
      const materials = cell.population
        * cell.manufacturing
        * (1.4 + cell.minerals)
        * labor
        * (model.policy.laws.cleanAir ? 0.9 : 1);
      const output = cell.population * labor * SECTORS.reduce(
        (sum, sector) => sum + cell[sector] * unitOutput(cell, model, sector), 0,
      );

      return [
        delta(cell, 'food', food),
        delta(cell, 'materials', materials),
        delta(cell, 'output', output - cell.output),
        delta(cell, 'foodMade', food - cell.foodMade),
        delta(cell, 'foodTraded', -cell.foodTraded),
        {
          kind: 'transfer',
          from: 'external',
          to: cell.id,
          resource: 'cash',
          amount: output * 0.65,
        },
      ];
    });
  },
};

function tradeEvidence(
  seller: DeepReadonly<Mapxel>,
  buyer: DeepReadonly<Mapxel>,
  amount: number,
): Evidence | undefined {
  if (buyer.foodSecurity >= 0.92 || amount <= buyer.population * 0.1) {
    return undefined;
  }

  return {
    title: `Food flows from ${seller.name} to ${buyer.name}`,
    detail: `${amount.toFixed(0)} units offered along a neighboring road. Settlement is limited by available stock and cash. Transport links determine how quickly shortages can be relieved.`,
    cells: [buyer.id, seller.id],
    reads: [
      read(seller, 'agriculture', 'Supplier farm employment'),
      read(buyer, 'foodSecurity', 'Buyer food security'),
      read(buyer, 'infrastructure', 'Buyer transport access'),
    ],
  };
}

export const tradeRule: Rule = {
  id: 'economy.neighbor-trade',
  phase: 'trade',
  description: 'Neighbors exchange stocks and money at a midpoint price, limited by roads, inventory, and buyer cash.',
  run({ model }) {
    const effects: Effect[] = [];

    for (const a of model.cells.filter(isLand)) {
      for (const neighborId of model.neighbors[a.id]) {
        if (neighborId <= a.id) continue;

        const b = model.cells[neighborId];
        for (const resource of ['food', 'materials'] as const) {
          const aStock = a[resource] / a.population;
          const bStock = b[resource] / b.population;
          const [seller, buyer] = aStock > bStock ? [a, b] : [b, a];
          const roadCapacity = 0.18 + 0.55 * Math.min(a.infrastructure, b.infrastructure);
          const equalizingAmount = Math.abs(aStock - bStock)
            * a.population
            * b.population
            / (a.population + b.population);
          const amount = Math.min(equalizingAmount * roadCapacity, seller.population * 0.85);

          if (amount < 0.01) continue;

          const price = resource === 'food' ? (a.price + b.price) / 2 : 0.65;
          effects.push({
            kind: 'trade',
            from: seller.id,
            to: buyer.id,
            resource,
            amount,
            price,
            evidence: resource === 'food'
              ? tradeEvidence(seller, buyer, amount)
              : undefined,
          });
        }
      }
    }

    return effects;
  },
};

export const consumptionRule: Rule = {
  id: 'economy.households',
  phase: 'consumption',
  description: 'Households eat first; food shortages constrain restaurants. Imports and spoilage prevent unlimited stock accumulation.',
  run({ model }) {
    return model.cells.filter(isLand).flatMap(cell => {
      const need = cell.population;
      const eaten = Math.min(cell.food, need);
      const security = eaten / need;
      const shouldExplainFood = Math.abs(security - cell.foodSecurity) > 0.08
        || (security < 0.85 && model.tick % 6 === 0);
      const foodEvidence = shouldExplainFood
        ? {
            title: `${cell.name}: ${security < 0.9 ? 'food supplies fall short' : 'food supplies recover'}`,
            detail: `Households could meet ${(security * 100).toFixed(0)}% of this month's food needs. Farms produced ${cell.foodMade.toFixed(0)} units; net neighboring trade was ${cell.foodTraded.toFixed(0)} units.`,
            cells: [cell.id],
            reads: [
              read(cell, 'agriculture', 'Farm employment share'),
              read(cell, 'food', 'Available food'),
              read(cell, 'population', 'Residents to feed'),
              read(cell, 'infrastructure', 'Transport access'),
            ],
          }
        : undefined;
      const remainingFood = Math.max(0, cell.food - eaten);
      const materialUse = Math.min(
        cell.materials,
        cell.population * 0.08 + cell.materials * 0.12,
      );
      const householdSpending = cell.population * (1.6 + cell.cash / cell.population * 0.04)
        + cell.output * 0.09;

      return [
        delta(cell, 'food', -eaten - remainingFood * 0.16),
        delta(cell, 'foodUsed', eaten - cell.foodUsed),
        delta(cell, 'materials', -materialUse),
        delta(cell, 'foodSecurity', security - cell.foodSecurity, foodEvidence),
        {
          kind: 'transfer',
          from: cell.id,
          to: 'external',
          resource: 'cash',
          amount: householdSpending,
        },
      ];
    });
  },
};

export const marketRule: Rule = {
  id: 'economy.businesses',
  phase: 'market',
  description: 'Scarcity changes prices; food, insecurity, and unaffordable payrolls squeeze local businesses.',
  run({ model }) {
    return model.cells.filter(isLand).flatMap(cell => {
      const supplyRatio = (cell.foodUsed + cell.food / 0.84) / cell.population;
      const targetPrice = clamp(
        1
          + (1 - Math.min(2, supplyRatio)) * 1.3
          + (1 - cell.foodSecurity) * 1.8,
        0.55,
        4.5,
      );
      const priceEvidence = Math.abs(targetPrice - cell.price) > 0.5 && model.tick % 3 === 0
        ? {
            title: `${cell.name}: food prices ${targetPrice > cell.price ? 'rise' : 'ease'}`,
            detail: 'Prices move gradually toward the local supply-demand balance. Scarcity raises the return to farming, but workers take time to change industries.',
            cells: [cell.id],
            reads: [
              read(cell, 'foodSecurity', 'Last measured food security'),
              read(cell, 'agriculture', 'Farm employment'),
              read(cell, 'food', 'Stock available'),
            ],
          }
        : undefined;

      const serviceJobs = viableJobs(cell, model, 'services');
      const businessTarget = clamp(
        0.97
          - (1 - cell.foodSecurity) * 0.9
          - Math.max(0, cell.price - 1.4) * 0.17
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
              read(cell, 'price', 'Ingredient price index'),
              read(cell, 'crime', 'Local crime'),
            ],
            parents: serviceJobs < 1 ? ['policy:minimumWage'] : [],
          }
        : undefined;

      return [
        delta(cell, 'price', clamp(cell.price + (targetPrice - cell.price) * 0.14, 0.4, model.policy.laws.foodPriceControls ? 1 : 5) - cell.price, priceEvidence),
        changeToward(cell, 'scarcityPrice', targetPrice, 0.14),
        changeToward(cell, 'businessHealth', businessTarget, 0.15, businessEvidence),
      ];
    });
  },
};
