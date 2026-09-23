import { clamp, randomAt, summarize } from './math';
import type { Game, Mapxel, Model, Policy } from './types';

export const DEFAULT_POLICY: Policy = {
  incomeTax: 0.28,
  businessTax: 0.18,
  minimumWage: 0,
  spending: {
    health: 0.3,
    education: 0.25,
    police: 0.2,
    infrastructure: 0.25,
    welfare: 0.3,
    culture: 0.08,
    environment: 0.12,
  },
  subsidies: {
    agriculture: 0,
    manufacturing: 0,
    services: 0,
    sports: 0,
  },
  laws: {
    cleanAir: false,
    freeMovement: true,
    publicAssembly: true,
    foodPriceControls: false,
  },
};

const REGION_NAMES = ['Northreach', 'The Greenbelt', 'Eastmere', 'Southbank'];
const CITY_NAMES = ['Alderwick', 'Port Marlow', 'Bellweather', 'Foxbridge', 'Fernhaven', 'Ashford'];
const CITY_CENTERS = [
  [0.43, 0.3],
  [0.69, 0.59],
  [0.37, 0.72],
  [0.6, 0.42],
  [0.29, 0.51],
  [0.57, 0.79],
] as const;

function validateWorldParameters(
  seed: string,
  width: number,
  height: number,
  mandate: number,
): void {
  const invalidSeed = !seed.trim() || seed.length > 100;
  const invalidWidth = !Number.isInteger(width) || width < 12 || width > 80;
  const invalidHeight = !Number.isInteger(height) || height < 12 || height > 80;
  const invalidMandate = !Number.isInteger(mandate) || mandate < 1 || mandate > 240;

  if (invalidSeed || invalidWidth || invalidHeight || invalidMandate) {
    throw new Error('Invalid world dimensions, seed, or mandate.');
  }
}

function nearestCity(nx: number, ny: number): { index: number; distance: number } {
  let nearest = 0;
  let distance = Infinity;

  CITY_CENTERS.forEach(([centerX, centerY], index) => {
    const candidate = Math.hypot(nx - centerX, (ny - centerY) * 0.8);
    if (candidate < distance) {
      distance = candidate;
      nearest = index;
    }
  });

  return { index: nearest, distance };
}

function regionFor(nx: number, ny: number): number {
  if (ny < 0.44) return 0;
  if (nx < 0.47) return 1;
  if (ny < 0.68) return 2;
  return 3;
}

function biomeFor(
  land: boolean,
  urban: number,
  elevation: number,
  fertility: number,
): Mapxel['biome'] {
  if (!land) return 'water';
  if (urban > 0.68) return 'city';
  if (elevation > 0.59) return 'hill';
  if (fertility > 0.71) return 'forest';
  return 'plain';
}

function createCell(
  seed: string,
  width: number,
  height: number,
  x: number,
  y: number,
  shapePhase: number,
): Mapxel {
  const id = y * width + x;
  const nx = (x + 0.5) / width;
  const ny = (y + 0.5) / height;
  const dx = (nx - 0.5) / 0.4;
  const dy = (ny - 0.51) / 0.44;
  const angle = Math.atan2(dy, dx);
  const radius = Math.sqrt(dx * dx + dy * dy);
  const coastline = 0.89
    + 0.075 * Math.sin(angle * 5 + shapePhase)
    + 0.065 * Math.cos(angle * 3 - shapePhase)
    + (randomAt(seed, id, 'coast') - 0.5) * 0.07;
  const land = radius < coastline;
  const elevation = clamp(
    0.34
      + 0.3 * Math.sin(nx * 9 + ny * 5 + shapePhase)
      + 0.15 * Math.cos(ny * 16),
  );
  const fertility = clamp(
    0.85 - elevation * 0.5 + 0.15 * Math.sin(nx * 15 - ny * 6),
    0.2,
    0.95,
  );
  const { index: cityIndex, distance: cityDistance } = nearestCity(nx, ny);
  const urban = Math.exp(-cityDistance * cityDistance / 0.0025);
  const population = land
    ? 70 + fertility * 110 + urban * 650 + randomAt(seed, id, 'pop') * 80
    : 0;
  const agriculture = clamp(0.28 + fertility * 0.29 - urban * 0.3, 0.07, 0.65);
  const manufacturing = 0.12 + elevation * 0.15;
  const sports = 0.035 + urban * 0.02;
  const services = 1 - agriculture - manufacturing - sports;
  const region = regionFor(nx, ny);
  const biome = biomeFor(land, urban, elevation, fertility);
  const name = urban > 0.68
    ? CITY_NAMES[cityIndex]
    : `${REGION_NAMES[region]} ${x + 1}·${y + 1}`;

  return {
    id,
    x,
    y,
    name,
    region,
    biome,
    elevation,
    fertility,
    minerals: clamp(0.18 + elevation * 0.7),
    waterStress: 0,
    population,
    cash: population * (25 + urban * 20 + randomAt(seed, id, 'wealth') * 10),
    food: population * (1.5 + agriculture),
    materials: population * 0.6,
    price: 1,
    scarcityPrice: 1,
    children: 0.21,
    seniors: 0.16,
    education: 0.48 + urban * 0.15,
    health: 0.7,
    happiness: 0.65,
    approval: 0.59,
    crime: 0.1 + urban * 0.04,
    pollution: 0.1 + manufacturing * 0.2,
    infrastructure: 0.52 + urban * 0.16,
    employment: 0.91,
    foodSecurity: 1,
    sportsInterest: 0.25,
    agriculture,
    manufacturing,
    services,
    sports,
    output: population * 6,
    foodMade: 0,
    foodUsed: 0,
    foodTraded: 0,
    businessHealth: 0.85,
    starvationDeaths: 0,
  };
}

function createCells(
  seed: string,
  width: number,
  height: number,
  shapePhase: number,
): Mapxel[] {
  const cells: Mapxel[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells.push(createCell(seed, width, height, x, y, shapePhase));
    }
  }

  return cells;
}

function createNeighbors(cells: Mapxel[], width: number, height: number): number[][] {
  return cells.map(cell => {
    if (cell.biome === 'water') return [];

    const coordinates = [
      [cell.x - 1, cell.y],
      [cell.x + 1, cell.y],
      [cell.x, cell.y - 1],
      [cell.x, cell.y + 1],
    ];

    return coordinates
      .filter(([x, y]) => {
        return x >= 0
          && x < width
          && y >= 0
          && y < height
          && cells[y * width + x].biome !== 'water';
      })
      .map(([x, y]) => y * width + x);
  });
}

function createModel(
  seed: string,
  width: number,
  height: number,
  mandate: number,
  cells: Mapxel[],
  neighbors: number[][],
): Model {
  const population = cells.reduce((sum, cell) => sum + cell.population, 0);

  return {
    seed,
    width,
    height,
    tick: 0,
    mandate,
    cells,
    neighbors,
    regions: REGION_NAMES,
    policy: structuredClone(DEFAULT_POLICY),
    localSubsidies: [],
    treasury: population * 6,
    debt: 0,
    externalCash: 1e12,
    budget: {
      revenue: 0,
      spending: 0,
      interest: 0,
      borrowed: 0,
      funding: 1,
    },
  };
}

export function createGame(
  seed = 'alder-42',
  width = 36,
  height = 26,
  mandate = 48,
): Game {
  validateWorldParameters(seed, width, height, mandate);

  const shapePhase = randomAt(seed, 'shape') * Math.PI * 2;
  const cells = createCells(seed, width, height, shapePhase);
  const neighbors = createNeighbors(cells, width, height);
  const model = createModel(seed, width, height, mandate, cells, neighbors);
  const initial = summarize(model);

  return {
    version: 3,
    model,
    initial,
    history: [{ tick: 0, summary: initial }],
    causes: [],
    actionLog: [],
    provenance: {},
    lastEvents: {},
    ended: false,
    articles: [
      {
        id: 'welcome',
        tick: 0,
        category: 'briefing',
        headline: 'A new mandate. A country watching.',
        body: 'The votes are counted. You have four years to govern the Commonwealth. Farms feed their neighbors, businesses compete for workers, and every promise has a price. Your first budget is balanced on a narrow margin. What will you change?',
        voice: 'The Commonwealth Ledger · Editorial desk',
        causeIds: [],
        tone: 'neutral',
      },
    ],
  };
}
