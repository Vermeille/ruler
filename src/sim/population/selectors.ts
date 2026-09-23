import { SECTORS, type DeepReadonly, type Model, type PopulationGroup, type Sector } from '../types';

export function populationOf(model: DeepReadonly<Model>, cell: number): number {
  return model.populationGroups[cell].reduce((sum, group) => sum + group.count, 0);
}

function weighted(model: DeepReadonly<Model>, cell: number, value: (group: DeepReadonly<PopulationGroup>) => number): number {
  const groups = model.populationGroups[cell];
  const total = populationOf(model, cell);
  return total > 0 ? groups.reduce((sum, group) => sum + group.count * value(group), 0) / total : 0;
}

export const approvalOf = (model: DeepReadonly<Model>, cell: number) => weighted(model, cell, group => group.approval);
export const wellbeingOf = (model: DeepReadonly<Model>, cell: number) => weighted(model, cell, group => group.wellbeing);
export const educationOf = (model: DeepReadonly<Model>, cell: number) => weighted(model, cell, group => group.education);
export const healthOf = (model: DeepReadonly<Model>, cell: number) => weighted(model, cell, group => group.health);
export const averageWealthOf = (model: DeepReadonly<Model>, cell: number) => weighted(model, cell, group => group.wealth);
export const childrenShareOf = (model: DeepReadonly<Model>, cell: number) => weighted(model, cell, group => Number(group.lifeStage === 'child'));
export const seniorShareOf = (model: DeepReadonly<Model>, cell: number) => weighted(model, cell, group => Number(group.lifeStage === 'senior'));

export function employmentOf(model: DeepReadonly<Model>, cell: number): number {
  const adults = model.populationGroups[cell].filter(group => group.lifeStage === 'adult');
  const total = adults.reduce((sum, group) => sum + group.count, 0);
  return total > 0 ? adults.reduce((sum, group) => sum + (group.employed ? group.count : 0), 0) / total : 0;
}

/** Employed adult occupational composition. This is the source of truth behind legacy mapxel sector shares. */
export function occupationShareOf(model: DeepReadonly<Model>, cell: number, sector: Sector): number {
  const workers = model.populationGroups[cell].filter(group =>
    group.lifeStage === 'adult' && group.employed && group.occupation !== null);
  const total = workers.reduce((sum, group) => sum + group.count, 0);
  if (total <= 0) return model.cells[cell][sector];
  return workers.reduce((sum, group) => sum + (group.occupation === sector ? group.count : 0), 0) / total;
}

export function occupationSharesOf(model: DeepReadonly<Model>, cell: number): Record<Sector, number> {
  return Object.fromEntries(SECTORS.map(sector => [sector, occupationShareOf(model, cell, sector)])) as Record<Sector, number>;
}
