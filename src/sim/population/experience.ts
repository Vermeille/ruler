import { clamp } from '../math';
import type { Archetype, Effect, PopulationGroup, Rule } from '../types';
import { archetypeAt } from './archetypes';

type LocalConditions = {
  foodSecurity: number;
  price: number;
  crime: number;
  pollution: number;
  education: number;
  population: number;
  housing: number;
  culture: number;
};

function livedWellbeing(
  group: Readonly<PopulationGroup>,
  archetype: Archetype,
  cell: LocalConditions,
): number {
  const buffer = clamp(group.wealth / 35);
  const food = clamp(cell.foodSecurity + buffer * 0.08 - Math.max(0, cell.price - 1) * (1 - buffer) * 0.12);
  const purchasingPower = clamp((group.income + Math.min(group.wealth, 30) * 0.08) / (6 * cell.price));
  const employment = group.lifeStage === 'adult' ? (group.employed ? 1 : 0.2) : 0.7;
  const needs = archetype.needs;
  const weight = needs.food + needs.income + needs.employment + needs.health + needs.safety
    + needs.housing + needs.education + needs.environment + needs.culture;
  return (
    needs.food * food
    + needs.income * purchasingPower
    + needs.employment * employment
    + needs.health * group.health
    + needs.safety * (1 - cell.crime)
    + needs.housing * cell.housing
    + needs.education * cell.education
    + needs.environment * (1 - cell.pollution)
    + needs.culture * cell.culture
  ) / weight;
}

/** Group circumstances change through Effects; mapxel conditions are the environment people experience. */
export const populationExperienceRule: Rule = {
  id: 'population.experience',
  phase: 'experience',
  description: 'Employment, purchasing power, health, services and local conditions change group income, wealth, wellbeing and approval.',
  run({ model }) {
    const effects: Effect[] = [];
    const cultureFunding = model.policy.spending.culture * model.budget.funding;
    for (const cell of model.cells) {
      if (cell.biome === 'water') continue;
      const macroWealth = cell.cash / cell.population;
      const conditions: LocalConditions = {
        foodSecurity: cell.foodSecurity,
        price: cell.price,
        crime: cell.crime,
        pollution: cell.pollution,
        education: cell.education,
        population: cell.population,
        housing: clamp(1 - cell.population / 20_000),
        culture: clamp(0.5 + cultureFunding),
      };
      for (const group of model.populationGroups[cell.id]) {
        const archetype = archetypeAt(model.seed, group.archetype, model.archetypeModelVersion);
        const incomeTarget = group.lifeStage === 'adult' && group.employed
          ? cell.output / cell.population * (0.8 + group.education * 0.3)
          : 0;
        const incomeChange = (incomeTarget - group.income) * 0.18;
        const nextIncome = group.income + incomeChange;
        const necessities = 1.5 + cell.price * 1.7;
        const wealthChange = Math.max(-group.wealth, (nextIncome - necessities) * 0.25
          + (macroWealth - group.wealth) * 0.01);
        const healthChange = (cell.health - group.health) * 0.04;
        const educationTarget = clamp(cell.education + (archetype.affinities.education - 0.5) * 0.18);
        const educationChange = (educationTarget - group.education)
          * (group.lifeStage === 'child' ? 0.02 : group.lifeStage === 'adult' ? 0.005 : 0);
        const wellbeingTarget = livedWellbeing(group, archetype, conditions);
        const wellbeingChange = (wellbeingTarget - group.wellbeing) * 0.1;
        const assemblyAgreement = model.policy.laws.publicAssembly
          ? group.attitudes.civicLiberty * 0.035
          : -group.attitudes.civicLiberty * 0.18;
        const approvalTarget = clamp(0.16
          + (group.wellbeing + wellbeingChange) * 0.55
          + wellbeingChange * 0.15
          + model.budget.funding * 0.1
          + assemblyAgreement
          - model.policy.incomeTax * archetype.values.materialism * 0.2);
        const environmentalismTarget = clamp(archetype.values.environmentalism
          + (cell.pollution - 0.2) * 0.2);
        const libertyTarget = clamp(archetype.values.civicLiberty
          + (model.policy.laws.publicAssembly ? 0 : 0.08));
        const solidarityTarget = clamp(archetype.values.solidarity
          + (1 - group.wellbeing) * 0.1);
        const traditionalismTarget = clamp(archetype.values.traditionalism
          + (1 - group.wellbeing) * 0.05);
        effects.push({
          kind: 'population-state',
          cell: cell.id,
          group: group.id,
          amount: group.count,
          change: {
            age: 1 / 12,
            income: incomeChange,
            wealth: wealthChange,
            health: healthChange,
            education: educationChange,
            wellbeing: wellbeingChange,
            approval: (approvalTarget - group.approval) * 0.08,
            environmentalism: (environmentalismTarget - group.attitudes.environmentalism) * 0.003,
            civicLiberty: (libertyTarget - group.attitudes.civicLiberty) * 0.002,
            solidarity: (solidarityTarget - group.attitudes.solidarity) * 0.002,
            traditionalism: (traditionalismTarget - group.attitudes.traditionalism) * 0.001,
          },
          evidence: group.count > 5 && wellbeingChange < -0.03 && model.tick % 3 === 0 ? {
            title: `${cell.name}: group #${group.id} experiences hardship`,
            detail: `Employment, income, reserves, prices, and local services combine into a lower lived wellbeing target for this group.`,
            cells: [cell.id],
            reads: [
              { cell: cell.id, group: group.id, field: 'income', label: 'Group income' },
              { cell: cell.id, group: group.id, field: 'wealth', label: 'Group wealth' },
              { cell: cell.id, group: group.id, field: 'employed', label: 'Employment status' },
              { cell: cell.id, field: 'foodSecurity', label: 'Food access' },
              { cell: cell.id, field: 'price', label: 'Food price' },
            ],
          } : undefined,
        });
      }
    }
    return effects;
  },
};
