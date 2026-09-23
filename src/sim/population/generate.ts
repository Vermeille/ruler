import { clamp, randomAt } from '../math';
import { SECTORS, type Mapxel, type PopulationGroup, type Sector } from '../types';
import { ARCHETYPE_COUNT, archetypeAt } from './archetypes';

export interface GeneratedPopulation {
  groups: PopulationGroup[][];
  nextId: number;
}

/** Build sparse local groups from the legacy aggregate at the current tick. */
export function generatePopulation(seed: string, cells: readonly Mapxel[]): GeneratedPopulation {
  let nextId = 1;
  const groups = cells.map(cell => {
    if (cell.biome === 'water' || cell.population <= 0) return [];

    const candidateIds = new Set<number>();
    for (let index = 0; candidateIds.size < 20; index += 1) {
      candidateIds.add(Math.floor(randomAt(seed, 'local-archetype', cell.id, index) * ARCHETYPE_COUNT));
    }
    const selected = [...candidateIds].map(id => {
      const archetype = archetypeAt(seed, id);
      const sectorFit = SECTORS.reduce((sum, sector) => sum + cell[sector] * archetype.affinities[sector], 0);
      const educationFit = 1 - Math.abs(cell.education - archetype.affinities.education);
      const score = 0.3 + sectorFit * 0.5 + educationFit * 0.2;
      return { id, score };
    }).sort((a, b) => b.score - a.score || a.id - b.id).slice(0, 6);
    const scoreTotal = selected.reduce((sum, item) => sum + item.score, 0);
    const result: PopulationGroup[] = [];
    const childShare = cell.children;
    const seniorShare = cell.seniors;
    const adultShare = 1 - childShare - seniorShare;

    selected.forEach(({ id, score }) => {
      const archetype = archetypeAt(seed, id);
      const archetypeShare = score / scoreTotal;
      const occupation = SECTORS.reduce((best, sector) =>
        cell[sector] * archetype.affinities[sector] > cell[best] * archetype.affinities[best]
          ? sector : best, SECTORS[0]) as Sector;
      const common = {
        archetype: id,
        education: clamp(cell.education + (archetype.affinities.education - 0.5) * 0.18),
        health: cell.health,
        wellbeing: cell.happiness,
        approval: cell.approval,
        wealth: cell.cash / cell.population,
        attitudes: {
          environmentalism: archetype.values.environmentalism,
          civicLiberty: archetype.values.civicLiberty,
          traditionalism: archetype.values.traditionalism,
          solidarity: archetype.values.solidarity,
        },
      };
      const add = (share: number, age: number, lifeStage: PopulationGroup['lifeStage'], employed: boolean) => {
        if (share <= 0) return;
        result.push({
          ...common,
          attitudes: { ...common.attitudes },
          id: nextId++, count: cell.population * archetypeShare * share,
          age, lifeStage,
          occupation: lifeStage === 'adult' ? occupation : null,
          employed,
          income: lifeStage === 'adult' ? (employed ? cell.output / cell.population : 0) : 0,
        });
      };
      add(childShare, 10, 'child', false);
      add(adultShare * cell.employment, 40, 'adult', true);
      add(adultShare * (1 - cell.employment), 40, 'adult', false);
      add(seniorShare, 72, 'senior', false);
    });
    // Assign the floating-point residue to one existing group so cell totals match exactly.
    result[result.length - 1].count += cell.population - result.reduce((sum, group) => sum + group.count, 0);
    return result;
  });
  return { groups, nextId };
}
