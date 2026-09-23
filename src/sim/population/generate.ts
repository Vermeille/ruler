import { clamp, randomAt } from '../math';
import { SECTORS, type Mapxel, type PopulationGroup, type Sector } from '../types';
import { ARCHETYPE_COUNT, archetypeAt } from './archetypes';

export interface GeneratedPopulation {
  groups: PopulationGroup[][];
  nextId: number;
}

function candidateArchetypes(seed: string, cell: Mapxel): number[] {
  const ids = new Set<number>();

  // Most local population types come from a shared regional pool. Adjacent places should
  // have overlapping populations, rather than six unrelated archetypes on either side of
  // a road. A smaller cell-local pool keeps genuine local variation and lets geography
  // select different subsets of the same regional population.
  for (let index = 0; ids.size < 14; index += 1) {
    ids.add(Math.floor(randomAt(seed, 'regional-archetype', cell.region, index) * ARCHETYPE_COUNT));
  }
  for (let index = 0; ids.size < 20; index += 1) {
    ids.add(Math.floor(randomAt(seed, 'local-archetype', cell.id, index) * ARCHETYPE_COUNT));
  }
  return [...ids];
}

/** Build sparse local groups from the legacy aggregate at the current tick. */
export function generatePopulation(seed: string, cells: readonly Mapxel[]): GeneratedPopulation {
  let nextId = 1;
  const groups = cells.map(cell => {
    if (cell.biome === 'water' || cell.population <= 0) return [];

    const selected = candidateArchetypes(seed, cell).map(id => {
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
      const add = (
        share: number,
        age: number,
        lifeStage: PopulationGroup['lifeStage'],
        employed: boolean,
        occupation: PopulationGroup['occupation'],
      ) => {
        if (share <= 0) return;
        result.push({
          ...common,
          attitudes: { ...common.attitudes },
          id: nextId++, count: cell.population * archetypeShare * share,
          age, lifeStage, occupation, employed,
          income: lifeStage === 'adult' && employed ? cell.output / cell.population : 0,
        });
      };

      add(childShare, 10, 'child', false, null);

      // Occupation is mutable circumstance, not archetype identity. Employed adults are
      // distributed across the current local economy so their aggregate reproduces the
      // mapxel sector mix exactly. Unemployed adults keep one occupational background and
      // can later retrain; this avoids multiplying every archetype into tiny idle cohorts.
      for (const sector of SECTORS) {
        add(adultShare * cell.employment * cell[sector], 40, 'adult', true, sector);
      }
      const unemployedOccupation = SECTORS.reduce((best, sector) =>
        cell[sector] * archetype.affinities[sector] > cell[best] * archetype.affinities[best]
          ? sector : best, SECTORS[0]) as Sector;
      add(adultShare * (1 - cell.employment), 40, 'adult', false, unemployedOccupation);

      add(seniorShare, 72, 'senior', false, null);
    });
    // Assign the floating-point residue to one existing group so cell totals match exactly.
    result[result.length - 1].count += cell.population - result.reduce((sum, group) => sum + group.count, 0);
    return result;
  });
  return { groups, nextId };
}
