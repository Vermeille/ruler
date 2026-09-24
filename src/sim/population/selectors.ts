import { SECTORS, type DeepReadonly, type Model, type PopulationGroup, type Sector } from '../types';

export function populationOf(model: DeepReadonly<Model>, cell: number): number {
  let total = 0;
  for (const group of model.populationGroups[cell]) total += group.count;
  return total;
}

function weighted(model: DeepReadonly<Model>, cell: number, value: (group: DeepReadonly<PopulationGroup>) => number): number {
  let total = 0;
  let sum = 0;
  for (const group of model.populationGroups[cell]) {
    total += group.count;
    sum += group.count * value(group);
  }
  return total > 0 ? sum / total : 0;
}

export const approvalOf = (model: DeepReadonly<Model>, cell: number) => weighted(model, cell, group => group.approval);
export const wellbeingOf = (model: DeepReadonly<Model>, cell: number) => weighted(model, cell, group => group.wellbeing);
export const educationOf = (model: DeepReadonly<Model>, cell: number) => weighted(model, cell, group => group.education);
export const healthOf = (model: DeepReadonly<Model>, cell: number) => weighted(model, cell, group => group.health);
export const averageWealthOf = (model: DeepReadonly<Model>, cell: number) => weighted(model, cell, group => group.wealth);
export const childrenShareOf = (model: DeepReadonly<Model>, cell: number) => weighted(model, cell, group => Number(group.lifeStage === 'child'));
export const seniorShareOf = (model: DeepReadonly<Model>, cell: number) => weighted(model, cell, group => Number(group.lifeStage === 'senior'));

export function employmentOf(model: DeepReadonly<Model>, cell: number): number {
  let adults = 0;
  let employed = 0;
  for (const group of model.populationGroups[cell]) {
    if (group.lifeStage !== 'adult') continue;
    adults += group.count;
    if (group.employed) employed += group.count;
  }
  return adults > 0 ? employed / adults : 0;
}

/** Employed adult occupational composition. This is the source of truth behind legacy mapxel sector shares. */
export function occupationSharesOf(model: DeepReadonly<Model>, cell: number): Record<Sector, number> {
  const totals: Record<Sector, number> = {
    agriculture: 0,
    manufacturing: 0,
    services: 0,
    sports: 0,
  };
  let workers = 0;
  for (const group of model.populationGroups[cell]) {
    if (group.lifeStage !== 'adult' || !group.employed || group.occupation === null) continue;
    workers += group.count;
    totals[group.occupation] += group.count;
  }
  if (workers <= 0) {
    return Object.fromEntries(SECTORS.map(sector => [sector, model.cells[cell][sector]])) as Record<Sector, number>;
  }
  for (const sector of SECTORS) totals[sector] /= workers;
  return totals;
}

export function occupationShareOf(model: DeepReadonly<Model>, cell: number, sector: Sector): number {
  return occupationSharesOf(model, cell)[sector];
}
