import { clamp } from '../math';
import type { DeepReadonly, Effect, Model, PopulationGroup } from '../types';
import { ARCHETYPE_COUNT } from './archetypes';

type PopulationEffect = Extract<Effect, { kind: 'population-transfer' | 'population-transition' | 'population-state' | 'population-delta' }>;
type GroupEffect = Exclude<PopulationEffect, { kind: 'population-delta' }>
  | (Extract<PopulationEffect, { kind: 'population-delta' }> & { group: number; cause: 'death' });

type GroupLocation = { cell: number; group: DeepReadonly<PopulationGroup> };

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
  } else if (effect.kind === 'population-transition') {
    const entries = Object.entries(effect.transition);
    if (!entries.length || entries.some(([key, value]) =>
      !['lifeStage', 'occupation', 'employed'].includes(key)
      || (key === 'lifeStage' && !['child', 'adult', 'senior'].includes(String(value)))
      || (key === 'occupation' && ![null, 'agriculture', 'manufacturing', 'services', 'sports'].includes(value as string | null))
      || (key === 'employed' && typeof value !== 'boolean'))) {
      throw new Error('Invalid population transition.');
    }
  } else if (effect.kind === 'population-state') {
    const entries = Object.entries(effect.change);
    if (!entries.length || entries.some(([key, value]) =>
      !['age', 'education', 'income', 'wealth', 'health', 'wellbeing', 'approval',
        'environmentalism', 'civicLiberty', 'traditionalism', 'solidarity'].includes(key)
      || !Number.isFinite(value))) {
      throw new Error('Invalid population state change.');
    }
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
  const numbers = [group.age, group.education, group.income, group.wealth, group.health, group.wellbeing,
    group.approval, ...Object.values(group.attitudes)];
  if (numbers.some(value => !Number.isFinite(value) || value < 0)
    || [group.education, group.health, group.wellbeing, group.approval,
      ...Object.values(group.attitudes)].some(value => value > 1)
    || !['child', 'adult', 'senior'].includes(group.lifeStage)
    || (group.occupation !== null && !['agriculture', 'manufacturing', 'services', 'sports'].includes(group.occupation))
    || typeof group.employed !== 'boolean') throw new Error('Invalid initial population state.');
}

export interface PopulationPlan {
  demands: Map<number, number>;
  groups: Map<number, GroupLocation>;
}

export interface PopulationOutcome {
  actual: number;
  resultingGroup?: number;
}

export function planPopulation(snapshot: DeepReadonly<Model>, effects: readonly PopulationEffect[]): PopulationPlan {
  const demands = new Map<number, number>();
  const groups = new Map<number, GroupLocation>();
  if (effects.length === 0) return { demands, groups };
  snapshot.populationGroups.forEach((cellGroups, cell) => {
    cellGroups.forEach(group => groups.set(group.id, { cell, group }));
  });
  for (const effect of effects) {
    validatePopulationEffect(snapshot, effect, groups);
    if (!isGroupEffect(effect)) continue;
    demands.set(effect.group, (demands.get(effect.group) ?? 0) + effect.amount);
  }
  return { demands, groups };
}

function changedGroup(source: DeepReadonly<PopulationGroup>, effect: GroupEffect): PopulationGroup {
  const group = structuredClone(source) as PopulationGroup;
  if (effect.kind === 'population-transition') Object.assign(group, effect.transition);
  if (effect.kind === 'population-state') {
    for (const [field, delta] of Object.entries(effect.change)) {
      if (field in group.attitudes) {
        const key = field as keyof PopulationGroup['attitudes'];
        group.attitudes[key] = clamp(group.attitudes[key] + delta);
        continue;
      }
      const key = field as keyof Pick<PopulationGroup, 'age' | 'education' | 'income' | 'wealth' | 'health' | 'wellbeing' | 'approval'>;
      const value = group[key] + delta;
      group[key] = ['education', 'health', 'wellbeing', 'approval'].includes(field)
        ? clamp(value) : Math.max(0, value);
    }
  }
  return group;
}

/** Settle all requests from phase-start groups. New children are never source groups in this phase. */
export function settlePopulation(
  model: Model,
  effects: readonly PopulationEffect[],
  plan: PopulationPlan,
): PopulationOutcome[] {
  if (effects.length === 0) return [];
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
        model.populationGroups[cell] = model.populationGroups[cell].filter(group => group.id !== live.id);
        model.populationGroups[only.to].push(live);
        model.cells[cell].population -= consumed;
        model.cells[only.to].population += consumed;
      } else {
        Object.assign(live, changedGroup(source, only));
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
    if (live.count <= 1e-12) model.populationGroups[cell] = model.populationGroups[cell].filter(group => group.id !== live.id);
  }

  effects.forEach((effect, index) => {
    if (effect.kind !== 'population-delta' || effect.cause !== 'birth' || actuals[index] <= 0) return;
    const id = model.nextPopulationGroupId++;
    model.populationGroups[effect.cell].push({
      ...structuredClone(effect.state!), id, archetype: effect.archetype!, count: actuals[index],
    });
    outcomes[index].resultingGroup = id;
    model.cells[effect.cell].population += actuals[index];
  });
  return outcomes;
}

/** Temporary bridge for aggregate birth/death and migration effects during shadow mode. */
export function reconcileLegacyPopulation(model: Model): void {
  model.cells.forEach(cell => {
    if (cell.biome === 'water') return;
    const groups = model.populationGroups[cell.id];
    const total = groups.reduce((sum, group) => sum + group.count, 0);
    const difference = cell.population - total;
    if (Math.abs(difference) <= 1e-9) return;
    if (!groups.length || total <= 0) throw new Error('Cannot reconcile empty population groups.');
    const ratio = cell.population / total;
    groups.forEach(group => { group.count *= ratio; });
    groups[groups.length - 1].count += cell.population - groups.reduce((sum, group) => sum + group.count, 0);
  });
}
