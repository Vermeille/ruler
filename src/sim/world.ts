import { clamp, randomAt, summarize } from './math';
import type { Game, Mapxel, Model, Policy } from './types';
export const DEFAULT_POLICY: Policy = {
  incomeTax: .28, businessTax: .18,
  spending: { health: .3, education: .25, police: .2, infrastructure: .25, welfare: .3, culture: .08, environment: .12 },
  subsidies: { agriculture: 0, manufacturing: 0, services: 0, sports: 0 },
  laws: { cleanAir: false, freeMovement: true, publicAssembly: true },
};
const REGION_NAMES = ['Northreach', 'The Greenbelt', 'Eastmere', 'Southbank'];
const CITY_NAMES = ['Alderwick', 'Port Marlow', 'Bellweather', 'Foxbridge', 'Fernhaven', 'Ashford'];
export function createGame(seed = 'alder-42', width = 36, height = 26, mandate = 48): Game {
  if (!seed.trim() || seed.length > 100 || !Number.isInteger(width) || !Number.isInteger(height) || width < 12 || height < 12 || width > 80 || height > 80 || !Number.isInteger(mandate) || mandate < 1 || mandate > 240) throw new Error('Invalid world dimensions, seed, or mandate.');
  const centers = [[.43, .3], [.69, .59], [.37, .72], [.6, .42], [.29, .51], [.57, .79]];
  const cells: Mapxel[] = [];
  const shapePhase = randomAt(seed, 'shape') * Math.PI * 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const id = y * width + x, nx = (x + .5) / width, ny = (y + .5) / height;
    const dx = (nx - .5) / .4, dy = (ny - .51) / .44;
    const angle = Math.atan2(dy, dx), radius = Math.sqrt(dx * dx + dy * dy);
    const coastline = .89 + .075 * Math.sin(angle * 5 + shapePhase) + .065 * Math.cos(angle * 3 - shapePhase) + (randomAt(seed, id, 'coast') - .5) * .07;
    const land = radius < coastline;
    const elevation = clamp(.34 + .3 * Math.sin(nx * 9 + ny * 5 + shapePhase) + .15 * Math.cos(ny * 16));
    const fertility = clamp(.85 - elevation * .5 + .15 * Math.sin(nx * 15 - ny * 6), .2, .95);
    let nearest = 0, distance = Infinity;
    centers.forEach(([cx, cy], i) => { const d = Math.hypot(nx - cx, (ny - cy) * .8); if (d < distance) { distance = d; nearest = i; } });
    const urban = Math.exp(-distance * distance / .0025);
    const population = land ? 70 + fertility * 110 + urban * 650 + randomAt(seed, id, 'pop') * 80 : 0;
    const agriculture = clamp(.28 + fertility * .29 - urban * .3, .07, .65);
    const manufacturing = .12 + elevation * .15;
    const sports = .035 + urban * .02;
    const region = ny < .44 ? 0 : nx < .47 ? 1 : ny < .68 ? 2 : 3;
    const biome = !land ? 'water' : urban > .68 ? 'city' : elevation > .59 ? 'hill' : fertility > .71 ? 'forest' : 'plain';
    cells.push({
      id, x, y, name: urban > .68 ? CITY_NAMES[nearest] : `${REGION_NAMES[region]} ${x + 1}·${y + 1}`, region, biome,
      elevation, fertility, minerals: clamp(.18 + elevation * .7), population, cash: population * (25 + urban * 20 + randomAt(seed, id, 'wealth') * 10),
      food: population * (1.5 + agriculture), materials: population * .6, price: 1,
      children: .21, seniors: .16, education: .48 + urban * .15, health: .7, happiness: .65, approval: .59,
      crime: .1 + urban * .04, pollution: .1 + manufacturing * .2, infrastructure: .52 + urban * .16,
      employment: .91, foodSecurity: 1, sportsInterest: .25, agriculture, manufacturing, sports, services: 1 - agriculture - manufacturing - sports,
      output: population * 6, foodMade: 0, foodUsed: 0, foodTraded: 0, businessHealth: .85,
    });
  }
  const neighbors = cells.map(c => c.biome === 'water' ? [] : [[c.x - 1, c.y], [c.x + 1, c.y], [c.x, c.y - 1], [c.x, c.y + 1]].filter(([x, y]) => x >= 0 && x < width && y >= 0 && y < height && cells[y * width + x].biome !== 'water').map(([x, y]) => y * width + x));
  const population = cells.reduce((s, c) => s + c.population, 0);
  const model: Model = { seed, width, height, tick: 0, mandate, cells, neighbors, regions: REGION_NAMES, policy: structuredClone(DEFAULT_POLICY), localSubsidies: [], treasury: population * 6, debt: 0, externalCash: 1e12, budget: { revenue: 0, spending: 0, interest: 0, borrowed: 0, funding: 1 } };
  const initial = summarize(model);
  return { version: 1, model, initial, history: [{ tick: 0, summary: initial }], causes: [], actionLog: [], provenance: {}, lastEvents: {}, ended: false, articles: [{ id: 'welcome', tick: 0, category: 'briefing', headline: 'A new mandate. A country watching.', body: 'The votes are counted. You have four years to govern the Commonwealth. Farms feed their neighbors, businesses compete for workers, and every promise has a price. Your first budget is balanced on a narrow margin. What will you change?', voice: 'The Commonwealth Ledger · Editorial desk', causeIds: [], tone: 'neutral' }] };
}
