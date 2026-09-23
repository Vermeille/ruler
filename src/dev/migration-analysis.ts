import { defaultRules } from '../sim/rules';
import {
  migrationAppealBreakdown,
  migrationFlow,
  migrationRule,
  type MigrationAppealBreakdown,
} from '../sim/rules/society';
import { traceStep, type PhaseTrace } from '../sim/trace';
import {
  MUTABLE_FIELDS,
  type DeepReadonly,
  type Game,
  type Mapxel,
  type Model,
  type MutableField,
  type Rule,
} from '../sim/types';

export interface MigrationEdge {
  key: string;
  a: number;
  b: number;
  from: number;
  to: number;
  population: number;
  cash: number;
  appealFrom: number;
  appealTo: number;
  appealDifference: number;
  movementRate: number;
  freedomMultiplier: number;
}

export interface AppealDriver {
  key: keyof Omit<MigrationAppealBreakdown, 'total'>;
  label: string;
  origin: number;
  destination: number;
  difference: number;
}

export interface MigrationSensitivity {
  key: string;
  label: string;
  location: 'origin' | 'destination';
  field: 'happiness' | 'employment' | 'cash' | 'population';
  value: number;
  nudge: number;
  nudgeLabel: string;
  flowImpact: number;
  gradient: number;
}

export interface FieldImpact {
  field: MutableField;
  relative: number;
  absolute: number;
}

export interface DownstreamImpactStage {
  key: string;
  month: 'this month' | 'next month';
  phase: string;
  rules: string[];
  changedCells: number;
  fields: FieldImpact[];
  magnitude: number;
}

const DRIVER_LABELS: Record<AppealDriver['key'], string> = {
  happiness: 'Happiness',
  employment: 'Employment × 0.4',
  wealth: 'Savings / resident',
  crowding: 'Crowding penalty',
};

function isLand(cell: DeepReadonly<Mapxel>): boolean {
  return cell.biome !== 'water';
}

export function migrationEdges(model: DeepReadonly<Model>): MigrationEdge[] {
  const result: MigrationEdge[] = [];

  for (const a of model.cells.filter(isLand)) {
    for (const neighborId of model.neighbors[a.id]) {
      if (neighborId <= a.id) continue;
      const b = model.cells[neighborId];
      if (!isLand(b)) continue;

      const flow = migrationFlow(a, b, model.policy.laws.freeMovement);
      result.push({
        key: `${a.id}:${b.id}`,
        a: a.id,
        b: b.id,
        ...flow,
      });
    }
  }

  return result.sort((left, right) => right.population - left.population);
}

export function appealDrivers(
  model: DeepReadonly<Model>,
  edge: MigrationEdge,
): AppealDriver[] {
  const origin = migrationAppealBreakdown(model.cells[edge.from]);
  const destination = migrationAppealBreakdown(model.cells[edge.to]);

  return (['happiness', 'employment', 'wealth', 'crowding'] as const).map(key => ({
    key,
    label: DRIVER_LABELS[key],
    origin: origin[key],
    destination: destination[key],
    difference: destination[key] - origin[key],
  }));
}

function directedFlow(
  origin: DeepReadonly<Mapxel>,
  destination: DeepReadonly<Mapxel>,
  freeMovement: boolean,
): number {
  const flow = migrationFlow(origin, destination, freeMovement);
  return flow.from === origin.id ? flow.population : -flow.population;
}

function nudgeValue(
  cell: Mapxel,
  field: MigrationSensitivity['field'],
): { amount: number; label: string } {
  if (field === 'happiness' || field === 'employment') {
    return { amount: Math.min(0.01, 1 - cell[field]), label: '+1 percentage point' };
  }

  const amount = Math.max(Math.abs(cell[field]) * 0.01, 0.01);
  return { amount, label: '+1%' };
}

export function migrationSensitivities(
  model: DeepReadonly<Model>,
  edge: MigrationEdge,
): MigrationSensitivity[] {
  const origin = structuredClone(model.cells[edge.from]) as Mapxel;
  const destination = structuredClone(model.cells[edge.to]) as Mapxel;
  const baseFlow = directedFlow(origin, destination, model.policy.laws.freeMovement);
  const fields: MigrationSensitivity['field'][] = [
    'happiness',
    'employment',
    'cash',
    'population',
  ];
  const result: MigrationSensitivity[] = [];

  for (const location of ['origin', 'destination'] as const) {
    for (const field of fields) {
      const nextOrigin = structuredClone(origin);
      const nextDestination = structuredClone(destination);
      const target = location === 'origin' ? nextOrigin : nextDestination;
      const { amount, label } = nudgeValue(target, field);
      if (amount <= 0) continue;

      target[field] += amount;
      const nextFlow = directedFlow(
        nextOrigin,
        nextDestination,
        model.policy.laws.freeMovement,
      );

      result.push({
        key: `${location}:${field}`,
        label: `${location === 'origin' ? 'Origin' : 'Destination'} ${field}`,
        location,
        field,
        value: location === 'origin' ? origin[field] : destination[field],
        nudge: amount,
        nudgeLabel: label,
        flowImpact: nextFlow - baseFlow,
        gradient: (nextFlow - baseFlow) / amount,
      });
    }
  }

  return result.sort((left, right) => Math.abs(right.flowImpact) - Math.abs(left.flowImpact));
}

function compareModels(
  baseline: DeepReadonly<Model>,
  counterfactual: DeepReadonly<Model>,
): { changedCells: number; fields: FieldImpact[] } {
  let changedCells = 0;
  const fieldTotals = new Map<MutableField, { absolute: number; baseline: number }>();

  for (let index = 0; index < baseline.cells.length; index += 1) {
    const left = baseline.cells[index];
    const right = counterfactual.cells[index];
    let cellChanged = false;

    for (const field of MUTABLE_FIELDS) {
      const difference = Math.abs(left[field] - right[field]);
      if (difference > 1e-10) cellChanged = true;

      const total = fieldTotals.get(field) ?? { absolute: 0, baseline: 0 };
      total.absolute += difference;
      total.baseline += Math.abs(left[field]);
      fieldTotals.set(field, total);
    }

    if (cellChanged) changedCells += 1;
  }

  const fields = [...fieldTotals.entries()]
    .map(([field, totals]) => ({
      field,
      absolute: totals.absolute,
      relative: totals.absolute / Math.max(totals.baseline, 1e-9),
    }))
    .filter(item => item.absolute > 1e-9)
    .sort((a, b) => b.relative - a.relative);

  return { changedCells, fields };
}

function stageFromPhases(
  month: DownstreamImpactStage['month'],
  baseline: PhaseTrace,
  counterfactual: PhaseTrace,
): DownstreamImpactStage {
  const comparison = compareModels(baseline.after, counterfactual.after);
  return {
    key: `${month}:${baseline.phase}`,
    month,
    phase: baseline.phase,
    rules: baseline.rules.map(rule => rule.id),
    changedCells: comparison.changedCells,
    fields: comparison.fields.slice(0, 4),
    magnitude: comparison.fields[0]?.relative ?? 0,
  };
}

function migrationDisabledRules(): Rule[] {
  const disabledMigration: Rule = {
    ...migrationRule,
    description: `${migrationRule.description} (disabled for counterfactual)`,
    run: () => [],
  };

  return defaultRules.map(rule => (
    rule.id === migrationRule.id ? disabledMigration : rule
  ));
}

/**
 * Compare the real trajectory with the same month where only migration is
 * disabled. The difference is therefore the actual downstream consequence of
 * migration in this exact state, including interactions in the following tick.
 */
export function migrationDownstreamImpact(game: Game): DownstreamImpactStage[] {
  const baseline = traceStep(game);
  const counterfactual = traceStep(game, migrationDisabledRules());
  const migrationIndex = baseline.phases.findIndex(phase => phase.phase === 'migration');
  const stages: DownstreamImpactStage[] = [];

  for (let index = Math.max(0, migrationIndex); index < baseline.phases.length; index += 1) {
    stages.push(stageFromPhases(
      'this month',
      baseline.phases[index],
      counterfactual.phases[index],
    ));
  }

  if (!baseline.result.ended && !counterfactual.result.ended) {
    const baselineNext = traceStep(baseline.result);
    const counterfactualNext = traceStep(counterfactual.result);

    for (let index = 0; index < baselineNext.phases.length; index += 1) {
      stages.push(stageFromPhases(
        'next month',
        baselineNext.phases[index],
        counterfactualNext.phases[index],
      ));
    }
  }

  return stages.filter((stage, index) => index === 0 || stage.changedCells > 0);
}