import { clamp } from '../sim/math';
import { SECTORS, type Cause, type Game, type Mapxel, type Sector } from '../sim/types';
import { ALL_LAYERS, type Layer } from './map-layers';

export type ActivityTone = 'good' | 'bad' | 'neutral';

export interface ActivityMarker {
  cell: number;
  glyph: string;
  label: string;
  layer: Extract<Layer, 'foodSecurity' | 'crime' | 'pollution' | 'industry'>;
  score: number;
  phase: number;
  tone: ActivityTone;
  kind: 'status' | 'industry';
}

export interface EventMarker {
  cell: number;
  glyph: string;
  label: string;
  phase: number;
  tone: ActivityTone;
  magnitude: number;
}

export interface FoodFlow {
  from: number;
  to: number;
  strength: number;
  phase: number;
}

export interface MapActivity {
  markers: ActivityMarker[];
  events: EventMarker[];
  foodFlows: FoodFlow[];
  labelsByCell: Map<number, string[]>;
}

const INDUSTRY: Record<Sector, { glyph: string; label: string }> = {
  agriculture: { glyph: '🌾', label: 'Farming' },
  manufacturing: { glyph: '⚙', label: 'Manufacturing' },
  services: { glyph: '◆', label: 'Services' },
  sports: { glyph: '●', label: 'Sports' },
};

function fract(value: number): number {
  return value - Math.floor(value);
}

function phaseFor(id: number, salt = 0): number {
  return fract(Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453);
}

function dominantSector(cell: Mapxel): Sector {
  return SECTORS.reduce((best, sector) => cell[sector] > cell[best] ? sector : best);
}

function markerFor(
  cell: Mapxel,
  tick: number,
  visibleLayers: ReadonlySet<Layer>,
): ActivityMarker | undefined {
  const candidates: ActivityMarker[] = [];

  if (visibleLayers.has('foodSecurity') && cell.foodSecurity < 0.82) {
    candidates.push({
      cell: cell.id,
      glyph: '🍞',
      label: 'Food pressure',
      layer: 'foodSecurity',
      score: 1.1 + (0.82 - cell.foodSecurity) * 4,
      phase: phaseFor(cell.id, tick),
      tone: 'bad',
      kind: 'status',
    });
  }

  if (visibleLayers.has('crime') && cell.crime > 0.32) {
    candidates.push({
      cell: cell.id,
      glyph: '!',
      label: 'Crime pressure',
      layer: 'crime',
      score: 0.95 + (cell.crime - 0.32) * 3,
      phase: phaseFor(cell.id, tick + 1),
      tone: 'bad',
      kind: 'status',
    });
  }

  if (visibleLayers.has('pollution') && cell.pollution > 0.42) {
    candidates.push({
      cell: cell.id,
      glyph: '≋',
      label: 'Pollution plume',
      layer: 'pollution',
      score: 0.8 + (cell.pollution - 0.42) * 2.6,
      phase: phaseFor(cell.id, tick + 2),
      tone: 'bad',
      kind: 'status',
    });
  }

  if (visibleLayers.has('industry')) {
    const sector = dominantSector(cell);
    const production = clamp(cell.output / Math.max(1, cell.population * 8), 0, 1.3);
    const industryScore = cell[sector] * production + (cell.biome === 'city' ? 0.12 : 0);
    if (industryScore > 0.23) {
      candidates.push({
        cell: cell.id,
        glyph: INDUSTRY[sector].glyph,
        label: INDUSTRY[sector].label,
        layer: 'industry',
        score: industryScore,
        phase: phaseFor(cell.id, tick + 3),
        tone: 'neutral',
        kind: 'industry',
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score)[0];
}

function thinMarkers(cells: readonly Mapxel[], markers: ActivityMarker[], limit: number): ActivityMarker[] {
  const chosen: ActivityMarker[] = [];

  for (const marker of [...markers].sort((a, b) => b.score - a.score)) {
    const cell = cells[marker.cell];
    const tooClose = chosen.some(existing => {
      const other = cells[existing.cell];
      return Math.hypot(cell.x - other.x, cell.y - other.y) < 1.8;
    });

    if (!tooClose) chosen.push(marker);
    if (chosen.length >= limit) break;
  }

  return chosen;
}

function toneFor(game: Game, cause: Cause): ActivityTone {
  const article = game.articles.find(candidate => candidate.causeIds.includes(cause.id));
  if (article) return article.tone;

  const title = cause.title.toLowerCase();
  if (/recover|ease|improv|cup|festival|boom|gain/.test(title)) return 'good';
  if (/crime|short|struggl|violent|fall|rise|scar|pollut|loss/.test(title)) return 'bad';
  return 'neutral';
}

function glyphFor(cause: Cause): string {
  const text = `${cause.rule} ${cause.title}`.toLowerCase();
  if (/sport|cup|match|stadium/.test(text)) return '●';
  if (/food|farm|price|restaurant|shop/.test(text)) return '🍞';
  if (/crime|violent|police/.test(text)) return '!';
  if (/pollut|clean air|environment/.test(text)) return '≋';
  if (/trade|flow|transport/.test(text)) return '→';
  if (/business|output|manufactur|industry/.test(text)) return '⚙';
  if (/health|hospital/.test(text)) return '+';
  if (/school|education/.test(text)) return 'A';
  return '•';
}

function eventMarkers(game: Game): EventMarker[] {
  const model = game.model;
  const current = game.causes
    .filter(cause => cause.tick === model.tick && cause.cells.some(id => model.cells[id]?.biome !== 'water'))
    .sort((a, b) => b.magnitude - a.magnitude);
  const used = new Set<number>();
  const result: EventMarker[] = [];

  for (const cause of current) {
    const cell = cause.cells.find(id => model.cells[id]?.biome !== 'water');
    if (cell === undefined || used.has(cell)) continue;
    used.add(cell);
    result.push({
      cell,
      glyph: glyphFor(cause),
      label: cause.title,
      phase: phaseFor(cell, model.tick + result.length + 10),
      tone: toneFor(game, cause),
      magnitude: cause.magnitude,
    });
    if (result.length >= 10) break;
  }

  return result;
}

function foodFlows(game: Game): FoodFlow[] {
  const model = game.model;
  const result: FoodFlow[] = [];

  for (const receiver of model.cells) {
    if (receiver.biome === 'water' || receiver.foodTraded <= 1) continue;
    const exporters = model.neighbors[receiver.id]
      .map(id => model.cells[id])
      .filter(cell => cell.biome !== 'water' && cell.foodTraded < -1)
      .sort((a, b) => a.foodTraded - b.foodTraded);
    const exporter = exporters[0];
    if (!exporter) continue;

    const amount = Math.min(receiver.foodTraded, -exporter.foodTraded);
    const population = Math.max(1, Math.min(receiver.population, exporter.population));
    result.push({
      from: exporter.id,
      to: receiver.id,
      strength: clamp(amount / (population * 0.5), 0.18, 1),
      phase: phaseFor(exporter.id, receiver.id + model.tick),
    });
  }

  return result
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 14);
}

function pushLabel(labels: Map<number, string[]>, cell: number, label: string): void {
  const current = labels.get(cell) ?? [];
  if (!current.includes(label)) current.push(label);
  labels.set(cell, current.slice(0, 3));
}

export function deriveMapActivity(
  game: Game,
  visibleLayers: ReadonlySet<Layer> = new Set(ALL_LAYERS),
): MapActivity {
  const model = game.model;
  const rawMarkers = model.cells
    .filter(cell => cell.biome !== 'water')
    .map(cell => markerFor(cell, model.tick, visibleLayers))
    .filter((marker): marker is ActivityMarker => marker !== undefined);
  const markers = thinMarkers(model.cells, rawMarkers, 18);
  const events = visibleLayers.has('events') ? eventMarkers(game) : [];
  const flows = visibleLayers.has('trade') ? foodFlows(game) : [];
  const labelsByCell = new Map<number, string[]>();

  for (const marker of markers) pushLabel(labelsByCell, marker.cell, marker.label);
  for (const event of events) pushLabel(labelsByCell, event.cell, event.label);
  for (const flow of flows) {
    pushLabel(labelsByCell, flow.from, 'Food exports moving');
    pushLabel(labelsByCell, flow.to, 'Food imports arriving');
  }

  return { markers, events, foodFlows: flows, labelsByCell };
}
