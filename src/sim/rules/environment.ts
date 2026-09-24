import { clamp } from '../math';
import { resolveStepCache } from '../step-cache';
import type {
  DeepReadonly,
  Effect,
  Mapxel,
  Model,
  Rule,
  StepCache,
} from '../types';
import { changeToward, delta, isLand } from './helpers';

type ConditionTargets = {
  health: number;
  education: number;
  infrastructure: number;
  pollution: number;
  sportsInterest: number;
};

const CONDITION_RATES: Record<keyof ConditionTargets, number> = {
  health: 0.045,
  education: 0.025,
  infrastructure: 0.06,
  pollution: 0.08,
  sportsInterest: 0.06,
};

function baselineTargets(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
): ConditionTargets {
  const spending = model.policy.spending;
  const funding = model.budget.funding;
  return {
    health: clamp(
      0.55
        + spending.health * funding * 0.5
        - cell.pollution * 0.18
        - (1 - cell.foodSecurity) * 0.35,
    ),
    education: clamp(0.35 + spending.education * funding * 0.6),
    infrastructure: clamp(0.3 + spending.infrastructure * funding * 0.9),
    pollution: clamp(-spending.environment * funding * 0.7),
    sportsInterest: clamp(0.17 + spending.culture * funding * 0.6),
  };
}

function fullTargets(
  cell: DeepReadonly<Mapxel>,
  model: DeepReadonly<Model>,
  cache: DeepReadonly<StepCache>,
): ConditionTargets {
  const spending = model.policy.spending;
  const funding = model.budget.funding;
  const people = cache.peopleByCell[cell.id];
  const neighbors = model.neighbors[cell.id].filter(id => model.cells[id].biome !== 'water');
  const neighborIndustry = neighbors.length
    ? neighbors.reduce(
        (sum, id) => sum + cache.peopleByCell[id].occupationShares.manufacturing,
        0,
      ) / neighbors.length
    : people.occupationShares.manufacturing;
  const manufacturingPressure = (
    people.occupationShares.manufacturing * 0.75 + neighborIndustry * 0.25
  ) * (model.policy.laws.cleanAir ? 0.6 : 1.1);

  return {
    health: clamp(
      0.55
        + spending.health * funding * 0.5
        - cell.pollution * 0.18
        - (1 - cell.foodSecurity) * 0.35
        + people.averageWealth * 0.001,
    ),
    education: clamp(
      0.35 + spending.education * funding * 0.6 + people.averageWealth * 0.002,
    ),
    infrastructure: clamp(
      0.3
        + spending.infrastructure * funding * 0.9
        + Math.min(1, cell.materials / Math.max(people.population, 1e-12)) * 0.06,
    ),
    pollution: clamp(
      manufacturingPressure
        + people.population / 12000
        - spending.environment * funding * 0.7,
    ),
    sportsInterest: clamp(
      0.17
        + people.occupationShares.sports * 0.85
        + spending.culture * funding * 0.6,
    ),
  };
}

/** Place conditions evolve from policy and other place conditions without resident behavior. */
// [I] ENVIRONMENT-HEALTH1
// [I] ENVIRONMENT-EDUCATION1
// [I] ENVIRONMENT-INFRA1
// [I] ENVIRONMENT-POLLUTION1
// [I] ENVIRONMENT-SPORTS1
export const environmentRule: Rule = {
  id: 'environment.conditions',
  direction: 'mapxel-to-mapxel',
  phase: 'society',
  description: 'Public services, pollution, food access, and policy move local environmental conditions.',
  run({ model }) {
    const effects: Effect[] = [];
    for (const cell of model.cells) {
      if (!isLand(cell)) continue;
      const targets = baselineTargets(cell, model);
      for (const field of Object.keys(targets) as (keyof ConditionTargets)[]) {
        effects.push(changeToward(cell, field, targets[field], CONDITION_RATES[field]));
      }
    }
    return effects;
  },
};

/** Residents also alter local conditions through wealth, density, and workforce composition. */
// [I] ENVIRONMENT-HEALTH1
// [I] ENVIRONMENT-EDUCATION1
// [I] ENVIRONMENT-INFRA1
// [I] ENVIRONMENT-POLLUTION1
// [I] ENVIRONMENT-SPORTS1
export const populationEnvironmentImpactRule: Rule = {
  id: 'population.environment-impact',
  direction: 'people-to-mapxel',
  phase: 'society',
  description: 'Resident wealth, density, and occupations add private-service, infrastructure, pollution, and cultural pressure.',
  run({ model, cache }) {
    const peopleCache = resolveStepCache(model, cache);
    const effects: Effect[] = [];
    for (const cell of model.cells) {
      if (!isLand(cell)) continue;
      const baseline = baselineTargets(cell, model);
      const full = fullTargets(cell, model, peopleCache);
      for (const field of Object.keys(full) as (keyof ConditionTargets)[]) {
        effects.push(delta(
          cell,
          field,
          (full[field] - baseline[field]) * CONDITION_RATES[field],
        ));
      }
    }
    return effects;
  },
};
