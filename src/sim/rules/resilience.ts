import { clamp } from '../math';
import { subsidyFor } from '../policy';
import { resolveStepCache } from '../step-cache';
import { SECTORS, type DeepReadonly, type Effect, type Mapxel, type Rule, type StepPeopleSummary } from '../types';
import { delta, isLand } from './helpers';

export type ServiceLoads = {
  healthDemand: number;
  educationDemand: number;
  healthUtilization: number;
  educationUtilization: number;
  infrastructureUtilization: number;
};

export function serviceLoads(
  cell: DeepReadonly<Mapxel>,
  people: DeepReadonly<StepPeopleSummary>,
): ServiceLoads {
  const healthDemand = people.population * (
    0.68
      + people.seniorShare * 0.75
      + people.averageInfection * 0.9
  );
  const educationDemand = people.population * (
    people.childShare
      + Math.max(0, 1 - people.childShare - people.seniorShare) * 0.04
  );
  const tradePressure = people.population > 0
    ? Math.min(0.35, Math.abs(cell.foodTraded) / people.population * 0.2)
    : 0;
  const infrastructureUtilization = people.population > 0
    ? people.population / 950 * (1.15 - cell.infrastructure * 0.45) + tradePressure
    : 0;

  return {
    healthDemand,
    educationDemand,
    healthUtilization: healthDemand / Math.max(cell.healthCapacity, 1e-9),
    educationUtilization: educationDemand / Math.max(cell.educationCapacity, 1e-9),
    infrastructureUtilization,
  };
}

function capacityTarget(
  kind: 'health' | 'education',
  people: DeepReadonly<StepPeopleSummary>,
  spending: number,
  funding: number,
): number {
  if (kind === 'health') {
    return people.population * clamp(0.58 + spending * funding, 0.45, 1.35);
  }
  return people.population * clamp(
    people.childShare * (0.72 + spending * funding * 1.35) + 0.035,
    0.04,
    0.6,
  );
}

/** Population growth can outrun staffed public-service capacity; funded systems adapt only gradually. */
// [I] SERVICE-OVERLOAD1
export const serviceCapacityRule: Rule = {
  id: 'population.service-capacity',
  direction: 'people-to-mapxel',
  phase: 'services',
  description: 'Health and education capacity adapt gradually to resident demand and funded public provision.',
  run({ model, cache }) {
    const peopleCache = resolveStepCache(model, cache);
    const effects: Effect[] = [];
    for (const cell of model.cells) {
      if (!isLand(cell)) continue;
      const people = peopleCache.peopleByCell[cell.id];
      const healthTarget = capacityTarget(
        'health', people, model.policy.spending.health, model.budget.funding,
      );
      const educationTarget = capacityTarget(
        'education', people, model.policy.spending.education, model.budget.funding,
      );
      effects.push(
        delta(cell, 'healthCapacity', (healthTarget - cell.healthCapacity) * 0.06),
        delta(cell, 'educationCapacity', (educationTarget - cell.educationCapacity) * 0.05),
      );
    }
    return effects;
  },
};

function disruptionTarget(utilization: number, condition: number): number {
  const overload = clamp((utilization - 0.9) / 0.75);
  return clamp(overload * overload * (0.45 + (1 - condition) * 0.55));
}

function disruptionChange(current: number, target: number, funding: number): number {
  const rate = target > current ? 0.24 : 0.08 + funding * 0.08;
  return (target - current) * rate;
}

/** Overload is normally absorbed, but severe sustained load creates temporary service failures. */
// [I] SERVICE-OVERLOAD1
// [I] CASCADE-FAILURE1
export const serviceStrainRule: Rule = {
  id: 'population.service-strain',
  direction: 'people-to-mapxel',
  phase: 'services',
  description: 'Resident load can push health, education, and infrastructure into temporary disruption; spare funded capacity lets them recover.',
  run({ model, cache }) {
    const peopleCache = resolveStepCache(model, cache);
    const effects: Effect[] = [];
    for (const cell of model.cells) {
      if (!isLand(cell)) continue;
      const loads = serviceLoads(cell, peopleCache.peopleByCell[cell.id]);
      const healthTarget = disruptionTarget(loads.healthUtilization, cell.health);
      const educationTarget = disruptionTarget(loads.educationUtilization, cell.education);
      const infrastructureTarget = disruptionTarget(
        loads.infrastructureUtilization,
        cell.infrastructure,
      );
      effects.push(
        delta(
          cell,
          'healthDisruption',
          disruptionChange(cell.healthDisruption, healthTarget, model.budget.funding),
        ),
        delta(
          cell,
          'educationDisruption',
          disruptionChange(cell.educationDisruption, educationTarget, model.budget.funding),
        ),
        delta(
          cell,
          'infrastructureDisruption',
          disruptionChange(cell.infrastructureDisruption, infrastructureTarget, model.budget.funding),
        ),
      );
    }
    return effects;
  },
};

type PolicySignature = {
  tax: number;
  spending: number;
  wage: number;
  rights: number;
  subsidy: number;
};

function policySignature(model: Parameters<typeof subsidyFor>[0], cell: DeepReadonly<Mapxel>): PolicySignature {
  const tax = clamp((model.policy.incomeTax + model.policy.businessTax) / 1.3);
  const spending = clamp(
    Object.values(model.policy.spending).reduce((sum, value) => sum + value, 0) / 14,
  );
  const wage = clamp(model.policy.minimumWage / 10);
  const rights = Object.values(model.policy.laws).filter(Boolean).length / 4;
  const subsidy = clamp(SECTORS.reduce(
    (sum, sector) => sum + subsidyFor(model, cell, sector),
    0,
  ) / (SECTORS.length * 3));
  return { tax, spending, wage, rights, subsidy };
}

/** Places remember the policy regime they had adapted to, making abrupt changes temporarily salient. */
// [I] POLICY-SHOCK1
export const policyAdjustmentRule: Rule = {
  id: 'policy.adjustment-pressure',
  direction: 'mapxel-to-mapxel',
  phase: 'services',
  description: 'Abrupt changes in taxes, spending, wages, laws, or subsidies create temporary local adjustment pressure that fades after the new regime becomes familiar.',
  run({ model }) {
    const effects: Effect[] = [];
    for (const cell of model.cells) {
      if (!isLand(cell)) continue;
      const current = policySignature(model, cell);
      const shock = clamp(
        Math.abs(current.tax - cell.policyTaxBaseline) * 0.9
          + Math.abs(current.spending - cell.policySpendingBaseline) * 2
          + Math.abs(current.wage - cell.policyWageBaseline) * 0.6
          + Math.abs(current.rights - cell.policyRightsBaseline) * 1.2
          + Math.abs(current.subsidy - cell.policySubsidyBaseline) * 0.8,
      );
      const adjustmentTarget = shock > 0.01 ? shock : cell.policyAdjustment * 0.55;
      effects.push(
        delta(cell, 'policyAdjustment', adjustmentTarget - cell.policyAdjustment),
        delta(cell, 'policyTaxBaseline', current.tax - cell.policyTaxBaseline),
        delta(cell, 'policySpendingBaseline', current.spending - cell.policySpendingBaseline),
        delta(cell, 'policyWageBaseline', current.wage - cell.policyWageBaseline),
        delta(cell, 'policyRightsBaseline', current.rights - cell.policyRightsBaseline),
        delta(cell, 'policySubsidyBaseline', current.subsidy - cell.policySubsidyBaseline),
      );
    }
    return effects;
  },
};
