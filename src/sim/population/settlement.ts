import type { DeepReadonly, Effect, Model, PopulationGroup } from '../types';
import { ARCHETYPE_COUNT } from './archetypes';
import {
  applyPopulationStateDelta,
  POPULATION_STATE_FIELDS,
  POPULATION_TRANSITION_FIELDS,
  populationStateFieldSpec,
  populationTransitionFieldSpec,
  validPopulationStateValue,
} from './fields';

type PopulationEffect = Extract<Effect, { kind: 'population-transfer' | 'population-transition' | 'population-state' | 'population-delta' }>;
type GroupEffect = Exclude<PopulationEffect, { kind: 'population-delta' }>
  | (Extract<PopulationEffect, { kind: 'population-delta' }> & { group: number; cause: 'death' });

type GroupLocation = { cell: number; index: number; group: DeepReadonly<PopulationGroup> };

function groupIn(groups: Map<number, GroupLocation>, cell: number, id: number): DeepReadonly<PopulationGroup> {
  const found = groups.get(id);
  if (!found || found.cell !== cell) throw new Error(`Invalid population group ${id} in mapxel ${cell}.`);
  return found.group;
}

function isGroupEffect(effect: PopulationEffect): effect is GroupEffect {
  return effect.kind !== 'population-delta' || (effect.cause === 'death' && effect.group !== undefined);
}

function sourceCell(effect: GroupEffect): number {
  return effect.kind === 'population-transfer' ? effect.from : effect.cell;
}

function validatePopulationEffect(
  snapshot: DeepReadonly<Model>,
  effect: PopulationEffect,
  groups: Map<number, GroupLocation>,
  strictShape: boolean,
): void {
  if (!Number.isFinite(effect.amount) || effect.amount < 0) throw new Error('Invalid population effect amount.');
  if (isGroupEffect(effect)) {
    if (effect.group === undefined) throw new Error('Population effect requires a group.');
    groupIn(groups, sourceCell(effect), effect.group);
  }
  if (effect.kind === 'population-transfer') {
    if (effect.from === effect.to || snapshot.cells[effect.to]?.biome === 'water' || !snapshot.cells[effect.to]) {
      throw new Error('Invalid population destination.');
    }
  } else if (effect.kind === 'population-transition' && strictShape) {
    let count = 0;
    for (const key in effect.transition) {
      count += 1;
      const spec = populationTransitionFieldSpec(key);
      const value = effect.transition[key as keyof typeof effect.transition];
      if (!spec || !spec.valid(value)) throw new Error('Invalid population transition.');
    }
    if (count === 0) throw new Error('Invalid population transition.');
  } else if (effect.kind === 'population-state' && strictShape) {
    let count = 0;
    for (const key in effect.change) {
      count += 1;
      const spec = populationStateFieldSpec(key);
      const value = effect.change[key as keyof typeof effect.change];
      if (!spec || typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('Invalid population state change.');
      }
    }
    if (count === 0) throw new Error('Invalid population state change.');
  } else if (effect.kind === 'population-delta') {
    if (!snapshot.cells[effect.cell] || snapshot.cells[effect.cell].biome === 'water') throw new Error('Invalid population delta cell.');
    if (effect.cause === 'birth') {
      if (effect.group !== undefined || effect.archetype === undefined || !effect.state
        || !Number.isInteger(effect.archetype) || effect.archetype < 0 || effect.archetype >= ARCHETYPE_COUNT) {
        throw new Error('Birth requires an archetype and initial state.');
      }
      validateGroupState(effect.state);
    } else if (effect.cause !== 'death' || effect.group === undefined) {
      throw new Error('Death requires a source group.');
    }
  }
}

function validateGroupState(group: Omit<PopulationGroup, 'id' | 'archetype' | 'count'>): void {
  if (!group || !group.attitudes) throw new Error('Invalid initial population state.');
  const raw = group as unknown as Record<string, unknown>;
  const attitudes = group.attitudes as unknown as Record<string, unknown>;
  for (const [field, spec] of Object.entries(POPULATION_STATE_FIELDS)) {
    const value = spec.storage === 'attitudes' ? attitudes[field] : raw[field];
    if (!validPopulationStateValue(field as keyof typeof POPULATION_STATE_FIELDS, value)) {
      throw new Error('Invalid initial population state.');
    }
  }
  for (const [field, spec] of Object.entries(POPULATION_TRANSITION_FIELDS)) {
    if (!spec.valid(raw[field])) throw new Error('Invalid initial population state.');
  }
}

export interface PopulationPlan {
  demands: Map<number, number>;
  groups: Map<number, GroupLocation>;
  independent: boolean;
}

export interface PopulationOutcome {
  actual: number;
  resultingGroup?: number;
}

export function planPopulation(snapshot: DeepReadonly<Model>, effects: readonly PopulationEffect[]): PopulationPlan {
  const demands = new Map<number, number>();
  const groups = new Map<number, GroupLocation>();
  let independent = true;
  if (effects.length === 0) return { demands, groups, independent };
  snapshot.populationGroups.forEach((cellGroups, cell) => {
    cellGroups.forEach((group, index) => groups.set(group.id, { cell, index, group }));
  });
  const strictShape = Object.isFrozen(snapshot);
  for (const effect of effects) {
    validatePopulationEffect(snapshot, effect, groups, strictShape);
    if (!isGroupEffect(effect)) continue;
    const prior = demands.get(effect.group);
    if (prior !== undefined) independent = false;
    demands.set(effect.group, (prior ?? 0) + effect.amount);
  }
  return { demands, groups, independent };
}

function cloneGroup(source: DeepReadonly<PopulationGroup>): PopulationGroup {
  return {
    ...source,
    attitudes: { ...source.attitudes },
  } as PopulationGroup;
}

function applyGroupChange(target: PopulationGroup, source: DeepReadonly<PopulationGroup>, effect: GroupEffect): void {
  if (effect.kind === 'population-transition') {
    Object.assign(target, effect.transition);
    return;
  }
  if (effect.kind !== 'population-state') return;
  for (const field in effect.change) {
    const delta = effect.change[field as keyof typeof effect.change];
    if (delta === undefined) continue;
    applyPopulationStateDelta(target, source, field as keyof typeof POPULATION_STATE_FIELDS, delta);
  }
}

function changedGroup(source: DeepReadonly<PopulationGroup>, effect: GroupEffect): PopulationGroup {
  const group = cloneGroup(source);
  applyGroupChange(group, source, effect);
  return group;
}

function removeGroup(model: Model, cell: number, id: number): void {
  const groups = model.populationGroups[cell];
  const index = groups.findIndex(group => group.id === id);
  if (index >= 0) groups.splice(index, 1);
}

function addBirth(model: Model, effect: Extract<PopulationEffect, { kind: 'population-delta' }>, amount: number): number {
  const id = model.nextPopulationGroupId++;
  model.populationGroups[effect.cell].push({
    ...effect.state!,
    attitudes: { ...effect.state!.attitudes },
    id,
    archetype: effect.archetype!,
    count: amount,
  });
  model.cells[effect.cell].population += amount;
  return id;
}

function stableSourceIndices(effects: readonly PopulationEffect[], plan: PopulationPlan): boolean {
  for (const effect of effects) {
    if (!isGroupEffect(effect)
      || effect.kind === 'population-state'
      || effect.kind === 'population-transition') continue;
    const source = plan.groups.get(effect.group)!.group;
    if (effect.amount >= source.count - 1e-9) return false;
  }
  return true;
}

function settleIndependentPopulation(
  model: Model,
  effects: readonly PopulationEffect[],
  plan: PopulationPlan,
): PopulationOutcome[] {
  const stableIndices = stableSourceIndices(effects, plan);
  const liveGroups = stableIndices ? undefined : new Map<number, PopulationGroup>();
  if (liveGroups) {
    model.populationGroups.forEach(cellGroups => cellGroups.forEach(group => liveGroups.set(group.id, group)));
  }
  const outcomes: PopulationOutcome[] = [];

  for (const effect of effects) {
    if (!isGroupEffect(effect)) {
      const id = addBirth(model, effect, effect.amount);
      outcomes.push({ actual: effect.amount, resultingGroup: id });
      continue;
    }

    const cell = sourceCell(effect);
    const location = plan.groups.get(effect.group)!;
    const source = location.group;
    const live = stableIndices
      ? model.populationGroups[location.cell][location.index]
      : liveGroups!.get(effect.group)!;
    if (!live || live.id !== effect.group) throw new Error(`Population group ${effect.group} moved during settlement.`);
    const actual = Math.min(effect.amount, source.count);
    const outcome: PopulationOutcome = { actual };

    if (actual <= 1e-12) {
      outcomes.push(outcome);
      continue;
    }

    if (effect.kind === 'population-delta') {
      live.count = Math.max(0, source.count - actual);
      model.cells[cell].population -= actual;
      if (live.count <= 1e-12) removeGroup(model, cell, live.id);
      outcomes.push(outcome);
      continue;
    }

    const whole = Math.abs(source.count - actual) <= 1e-9;
    if (whole) {
      if (effect.kind === 'population-transfer') {
        removeGroup(model, cell, live.id);
        model.populationGroups[effect.to].push(live);
        model.cells[cell].population -= actual;
        model.cells[effect.to].population += actual;
      } else {
        applyGroupChange(live, source, effect);
      }
      outcome.resultingGroup = live.id;
      outcomes.push(outcome);
      continue;
    }

    live.count = Math.max(0, source.count - actual);
    const child = changedGroup(source, effect);
    child.id = model.nextPopulationGroupId++;
    child.count = actual;
    outcome.resultingGroup = child.id;
    const destination = effect.kind === 'population-transfer' ? effect.to : cell;
    model.populationGroups[destination].push(child);
    if (effect.kind === 'population-transfer') {
      model.cells[cell].population -= actual;
      model.cells[destination].population += actual;
    }
    outcomes.push(outcome);
  }

  return outcomes;
}

/** Settle all requests from phase-start groups. New children are never source groups in this phase. */
export function settlePopulation(
  model: Model,
  effects: readonly PopulationEffect[],
  plan: PopulationPlan,
): PopulationOutcome[] {
  if (effects.length === 0) return [];
  if (plan.independent) {
    return settleIndependentPopulation(model, effects, plan);
  }

  const liveGroups = new Map<number, PopulationGroup>();
  model.populationGroups.forEach(cellGroups => cellGroups.forEach(group => liveGroups.set(group.id, group)));
  const actuals = effects.map(effect => {
    if (!isGroupEffect(effect)) return effect.amount;
    const source = groupIn(plan.groups, sourceCell(effect), effect.group);
    const demand = plan.demands.get(effect.group) ?? 0;
    return effect.amount * Math.min(1, source.count / Math.max(1e-12, demand));
  });
  const outcomes: PopulationOutcome[] = actuals.map(actual => ({ actual }));
  const byGroup = new Map<number, number[]>();
  effects.forEach((effect, index) => {
    if (!isGroupEffect(effect)) return;
    const indices = byGroup.get(effect.group) ?? [];
    indices.push(index);
    byGroup.set(effect.group, indices);
  });

  for (const indices of byGroup.values()) {
    const first = effects[indices[0]] as GroupEffect;
    const cell = sourceCell(first);
    const source = groupIn(plan.groups, cell, first.group);
    const live = liveGroups.get(first.group)!;
    const consumed = indices.reduce((sum, index) => sum + actuals[index], 0);
    const only = indices.length === 1 ? effects[indices[0]] : undefined;
    const whole = Math.abs(source.count - consumed) <= 1e-9;

    if (whole && only && only.kind !== 'population-delta') {
      if (only.kind === 'population-transfer') {
        removeGroup(model, cell, live.id);
        model.populationGroups[only.to].push(live);
        model.cells[cell].population -= consumed;
        model.cells[only.to].population += consumed;
      } else {
        applyGroupChange(live, source, only);
      }
      outcomes[indices[0]].resultingGroup = live.id;
      continue;
    }

    live.count = Math.max(0, source.count - consumed);
    indices.forEach(index => {
      const effect = effects[index] as GroupEffect;
      const amount = actuals[index];
      if (amount <= 1e-12) return;
      if (effect.kind === 'population-delta') {
        model.cells[cell].population -= amount;
        return;
      }
      const child = changedGroup(source, effect);
      child.id = model.nextPopulationGroupId++;
      outcomes[index].resultingGroup = child.id;
      child.count = amount;
      const destination = effect.kind === 'population-transfer' ? effect.to : cell;
      model.populationGroups[destination].push(child);
      if (effect.kind === 'population-transfer') {
        model.cells[cell].population -= amount;
        model.cells[destination].population += amount;
      }
    });
    if (live.count <= 1e-12) removeGroup(model, cell, live.id);
  }

  effects.forEach((effect, index) => {
    if (effect.kind !== 'population-delta' || effect.cause !== 'birth' || actuals[index] <= 0) return;
    outcomes[index].resultingGroup = addBirth(model, effect, actuals[index]);
  });
  return outcomes;
}
