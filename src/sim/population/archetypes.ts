import { randomAt } from '../math';
import type { Archetype } from '../types';

export const ARCHETYPE_COUNT = 2048;
export const ARCHETYPE_MODEL_VERSION = 1;

const caches = new Map<string, Array<Archetype | undefined>>();
let lastSeed = '';
let lastVersion = -1;
let lastCache: Array<Archetype | undefined> | undefined;

function cacheFor(seed: string, version: number): Array<Archetype | undefined> {
  if (seed === lastSeed && version === lastVersion && lastCache) return lastCache;

  const key = `${seed}|${version}`;
  let cache = caches.get(key);
  if (!cache) {
    cache = new Array<Archetype | undefined>(ARCHETYPE_COUNT);
    caches.set(key, cache);
  }
  lastSeed = seed;
  lastVersion = version;
  lastCache = cache;
  return cache;
}

/** Stable human predispositions. No current social or economic state belongs here. */
export function archetypeAt(seed: string, id: number, version = ARCHETYPE_MODEL_VERSION): Archetype {
  if (!Number.isInteger(id) || id < 0 || id >= ARCHETYPE_COUNT || version !== ARCHETYPE_MODEL_VERSION) {
    throw new Error('Unknown archetype or archetype model version.');
  }
  const cache = cacheFor(seed, version);
  const cached = cache[id];
  if (cached) return cached;

  const trait = (name: string) => 0.1 + randomAt(seed, 'archetype', version, id, name) * 0.8;
  const result: Archetype = {
    id,
    traits: {
      adaptability: trait('adaptability'),
      mobility: trait('mobility'),
      riskTolerance: trait('riskTolerance'),
      communityAttachment: trait('communityAttachment'),
      familyOrientation: trait('familyOrientation'),
      entrepreneurialism: trait('entrepreneurialism'),
    },
    needs: {
      income: trait('needIncome'), employment: trait('needEmployment'),
      food: trait('needFood'), health: trait('needHealth'), safety: trait('needSafety'),
      housing: trait('needHousing'), education: trait('needEducation'),
      environment: trait('needEnvironment'), culture: trait('needCulture'),
    },
    values: {
      materialism: trait('materialism'), environmentalism: trait('environmentalism'),
      civicLiberty: trait('civicLiberty'), traditionalism: trait('traditionalism'),
      individualism: trait('individualism'), solidarity: trait('solidarity'),
    },
    affinities: {
      education: trait('educationAffinity'), agriculture: trait('agricultureAffinity'),
      manufacturing: trait('manufacturingAffinity'), services: trait('servicesAffinity'),
      sports: trait('sportsAffinity'),
    },
  };
  for (const part of [result.traits, result.needs, result.values, result.affinities]) Object.freeze(part);
  Object.freeze(result);
  cache[id] = result;
  return result;
}

export function generateArchetypes(seed: string): Archetype[] {
  return Array.from({ length: ARCHETYPE_COUNT }, (_, id) => archetypeAt(seed, id));
}
