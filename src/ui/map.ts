import { clamp } from '../sim/math';
import type { Game, Mapxel } from '../sim/types';

export type Layer =
  | 'terrain'
  | 'approval'
  | 'wealth'
  | 'foodSecurity'
  | 'crime'
  | 'population'
  | 'pollution'
  | 'industry';

export const LAYERS: { id: Layer; name: string; low: string; high: string }[] = [
  { id: 'terrain', name: 'Landscape', low: 'Plains · forests · highlands', high: '' },
  { id: 'approval', name: 'Public approval', low: '0% approval', high: '100%' },
  { id: 'wealth', name: 'Prosperity', low: '₡0 / resident', high: '₡70+' },
  { id: 'foodSecurity', name: 'Food access', low: 'Unmet needs', high: 'Fully fed' },
  { id: 'crime', name: 'Crime pressure', low: 'Low pressure', high: 'High pressure' },
  { id: 'population', name: 'Population', low: 'Sparse', high: 'Dense' },
  { id: 'pollution', name: 'Pollution', low: 'Clean', high: 'Polluted' },
  { id: 'industry', name: 'Local economy', low: 'Farms · factories · services · sports', high: '' },
];

export const SECTOR_COLORS = {
  agriculture: '#b6c785',
  manufacturing: '#b2a391',
  services: '#78a9a3',
  sports: '#cc9b75',
};

const TERRAIN_COLORS = {
  water: '#e7efed',
  plain: '#cbd7ad',
  forest: '#91b296',
  hill: '#b6b7a0',
  city: '#748e7d',
};

const DARK_TERRAIN_COLORS = {
  water: '#172a30',
  plain: '#53634b',
  forest: '#355b49',
  hill: '#625f4d',
  city: '#40574c',
};

const SECTORS = ['agriculture', 'manufacturing', 'services', 'sports'] as const;

type Point = { x: number; y: number };
type Sector = typeof SECTORS[number];

type Viewport = {
  width: number;
  height: number;
  cellSize: number;
  offsetX: number;
  offsetY: number;
};

export interface MapOptions {
  game: Game;
  selected: Set<number>;
  layer: Layer;
  zoom: number;
  roads: boolean;
  onSelect: (ids: number[], additive: boolean) => void;
}

function darkMode(): boolean {
  return document.body.classList.contains('dark-mode');
}

function mixColors(from: number[], to: number[], amount: number): string {
  const channels = from.map((value, index) => {
    return Math.round(value + (to[index] - value) * clamp(amount));
  });
  return `rgb(${channels.join(',')})`;
}

function dominantSector(cell: Mapxel): Sector {
  return SECTORS.reduce((best, candidate) => {
    return cell[best] > cell[candidate] ? best : candidate;
  });
}

function layerValue(cell: Mapxel, layer: Layer): number {
  if (layer === 'wealth') return cell.cash / cell.population / 70;
  if (layer === 'population') return cell.population / 850;
  return cell[layer] as number;
}

function cellColor(cell: Mapxel, layer: Layer, dark: boolean): string {
  if (layer === 'terrain') {
    return (dark ? DARK_TERRAIN_COLORS : TERRAIN_COLORS)[cell.biome];
  }

  if (layer === 'industry') {
    return SECTOR_COLORS[dominantSector(cell)];
  }

  const value = layerValue(cell, layer);
  const negative = layer === 'crime' || layer === 'pollution';

  if (negative) {
    return mixColors(
      dark ? [52, 78, 59] : [205, 221, 194],
      dark ? [194, 87, 72] : [173, 79, 65],
      value,
    );
  }

  return mixColors(
    dark ? [96, 78, 61] : [223, 188, 143],
    dark ? [49, 151, 116] : [47, 115, 93],
    value,
  );
}

function pointerCoordinates(canvas: HTMLCanvasElement, event: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function cellAtPoint(game: Game, viewport: Viewport, point: Point): Mapxel | undefined {
  const { model } = game;
  const x = Math.floor((point.x - viewport.offsetX) / viewport.cellSize);
  const y = Math.floor((point.y - viewport.offsetY) / viewport.cellSize);

  if (x < 0 || y < 0 || x >= model.width || y >= model.height) {
    return undefined;
  }

  return model.cells[y * model.width + x];
}

function prepareCanvas(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  game: Game,
  zoom: number,
): Viewport {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = rect.width;
  const height = rect.height;
  const cellSize = Math.min(
    (width - 38) / game.model.width,
    (height - 28) / game.model.height,
  ) * zoom;
  const offsetX = (width - game.model.width * cellSize) / 2;
  const offsetY = (height - game.model.height * cellSize) / 2;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  return { width, height, cellSize, offsetX, offsetY };
}

function drawBackground(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  dark: boolean,
): void {
  const { width, height } = viewport;

  context.fillStyle = dark ? '#172126' : '#e7efed';
  context.fillRect(0, 0, width, height);

  context.fillStyle = dark ? '#25343a' : '#ccdcd6';
  for (let y = 12; y < height; y += 19) {
    for (let x = 12; x < width; x += 19) {
      context.fillRect(x, y, 1, 1);
    }
  }

  context.fillStyle = dark ? '#78949a' : '#72948a';
  context.font = 'italic 13px Georgia';
  context.fillText('The Western Sea', 22, height * 0.47);
}

function drawCompass(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  dark: boolean,
): void {
  context.save();
  context.translate(viewport.width - 32, 35);
  context.strokeStyle = dark ? '#718c91' : '#779489';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, 15);
  context.lineTo(0, -7);
  context.lineTo(-3, 0);
  context.moveTo(0, -7);
  context.lineTo(3, 0);
  context.stroke();
  context.fillStyle = dark ? '#a5bbb2' : '#486c5e';
  context.font = '10px sans-serif';
  context.fillText('N', -3, -13);
  context.restore();
}

function cellPosition(cell: Mapxel, viewport: Viewport): Point {
  return {
    x: viewport.offsetX + cell.x * viewport.cellSize,
    y: viewport.offsetY + cell.y * viewport.cellSize,
  };
}

function drawRegionBorders(
  context: CanvasRenderingContext2D,
  game: Game,
  cell: Mapxel,
  viewport: Viewport,
  x: number,
  y: number,
): void {
  const { model } = game;
  const size = viewport.cellSize;
  const edges = [
    [-1, 0, x, y, x, y + size],
    [1, 0, x + size, y, x + size, y + size],
    [0, -1, x, y, x + size, y],
    [0, 1, x, y + size, x + size, y + size],
  ];

  context.strokeStyle = 'rgba(62,91,69,.28)';
  context.lineWidth = 1;

  for (const [dx, dy, x1, y1, x2, y2] of edges) {
    const neighborX = cell.x + dx;
    const neighborY = cell.y + dy;
    const neighbor = neighborX >= 0
      && neighborX < model.width
      && neighborY >= 0
      && neighborY < model.height
      ? model.cells[neighborY * model.width + neighborX]
      : undefined;

    if (!neighbor || neighbor.biome === 'water' || neighbor.region !== cell.region) {
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
    }
  }
}

function drawSelection(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  x: number,
  y: number,
  dark: boolean,
): void {
  const size = viewport.cellSize;
  context.fillStyle = dark ? 'rgba(253,247,212,.24)' : 'rgba(253,247,212,.36)';
  context.fillRect(x, y, size, size);
  context.strokeStyle = dark ? '#d6e7ad' : '#214f3d';
  context.lineWidth = 1.6;
  context.strokeRect(x + 1, y + 1, size - 2, size - 2);
}

function drawCells(
  context: CanvasRenderingContext2D,
  options: MapOptions,
  viewport: Viewport,
  dark: boolean,
): void {
  for (const cell of options.game.model.cells) {
    if (cell.biome === 'water') continue;

    const { x, y } = cellPosition(cell, viewport);
    const size = viewport.cellSize;

    context.fillStyle = cellColor(cell, options.layer, dark);
    context.fillRect(x, y, size + 0.2, size + 0.2);

    if (options.layer === 'terrain') {
      const alpha = dark
        ? (cell.fertility % 0.1) * 0.28
        : (cell.fertility % 0.1) * 0.85;
      context.fillStyle = `rgba(255,255,255,${alpha})`;
      context.fillRect(x, y, size, size);
    }

    context.strokeStyle = 'rgba(40,72,53,.045)';
    context.lineWidth = 0.5;
    context.strokeRect(x, y, size, size);
    drawRegionBorders(context, options.game, cell, viewport, x, y);

    if (options.selected.has(cell.id)) {
      drawSelection(context, viewport, x, y, dark);
    }
  }
}

function shouldDrawRoad(options: MapOptions, from: Mapxel, toId: number): boolean {
  if (toId <= from.id) return false;
  if (options.selected.size) {
    return options.selected.has(from.id) || options.selected.has(toId);
  }
  return from.infrastructure > 0.58;
}

function drawRoads(
  context: CanvasRenderingContext2D,
  options: MapOptions,
  viewport: Viewport,
): void {
  if (!options.roads) return;

  const { model } = options.game;
  context.strokeStyle = 'rgba(255,255,244,.55)';
  context.lineWidth = 1;

  for (const cell of model.cells) {
    for (const neighborId of model.neighbors[cell.id]) {
      if (!shouldDrawRoad(options, cell, neighborId)) continue;

      const neighbor = model.cells[neighborId];
      context.beginPath();
      context.moveTo(
        viewport.offsetX + (cell.x + 0.5) * viewport.cellSize,
        viewport.offsetY + (cell.y + 0.5) * viewport.cellSize,
      );
      context.lineTo(
        viewport.offsetX + (neighbor.x + 0.5) * viewport.cellSize,
        viewport.offsetY + (neighbor.y + 0.5) * viewport.cellSize,
      );
      context.stroke();
    }
  }
}

function drawCityLabels(
  context: CanvasRenderingContext2D,
  game: Game,
  viewport: Viewport,
  dark: boolean,
): void {
  const labelled = new Set<string>();
  const byPopulation = [...game.model.cells].sort((a, b) => b.population - a.population);

  for (const cell of byPopulation) {
    if (cell.biome !== 'city' || labelled.has(cell.name)) continue;
    labelled.add(cell.name);

    const x = viewport.offsetX + (cell.x + 0.5) * viewport.cellSize;
    const y = viewport.offsetY + (cell.y + 0.5) * viewport.cellSize;

    context.beginPath();
    context.arc(x, y, 3.1, 0, Math.PI * 2);
    context.fillStyle = dark ? '#26372f' : '#f7f7e8';
    context.fill();
    context.strokeStyle = dark ? '#b2c69a' : '#385a46';
    context.lineWidth = 1.4;
    context.stroke();

    context.font = '600 11px system-ui';
    context.textAlign = 'center';
    context.lineWidth = 3.5;
    context.strokeStyle = dark ? '#26372f' : '#e4ead4';
    context.strokeText(cell.name, x, y - 9);
    context.fillStyle = dark ? '#e1e8d7' : '#294b3d';
    context.fillText(cell.name, x, y - 9);
  }

  context.textAlign = 'left';
}

function drawHover(
  context: CanvasRenderingContext2D,
  hover: Mapxel | undefined,
  viewport: Viewport,
): void {
  if (!hover || hover.biome === 'water') return;

  context.strokeStyle = '#fffef2';
  context.lineWidth = 2;
  context.strokeRect(
    viewport.offsetX + hover.x * viewport.cellSize,
    viewport.offsetY + hover.y * viewport.cellSize,
    viewport.cellSize,
    viewport.cellSize,
  );
}

function drawDragSelection(
  context: CanvasRenderingContext2D,
  start: Point | undefined,
  pointer: Point | undefined,
): void {
  if (!start || !pointer) return;

  context.fillStyle = 'rgba(36,84,62,.09)';
  context.strokeStyle = '#315d48';
  context.setLineDash([4, 3]);
  context.fillRect(start.x, start.y, pointer.x - start.x, pointer.y - start.y);
  context.strokeRect(start.x, start.y, pointer.x - start.x, pointer.y - start.y);
  context.setLineDash([]);
}

function drawScale(
  context: CanvasRenderingContext2D,
  viewport: Viewport,
  dark: boolean,
): void {
  context.fillStyle = dark ? '#9aada4' : '#527568';
  context.font = '9px system-ui';
  context.fillText('1 MAPXEL ≈ 4 KM²', 18, viewport.height - 17);
}

function selectedCellsInRectangle(
  game: Game,
  viewport: Viewport,
  start: Point,
  end: Point,
): number[] {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);

  return game.model.cells
    .filter(cell => {
      if (cell.biome === 'water') return false;
      const x = viewport.offsetX + (cell.x + 0.5) * viewport.cellSize;
      const y = viewport.offsetY + (cell.y + 0.5) * viewport.cellSize;
      return x >= minX && x <= maxX && y >= minY && y <= maxY;
    })
    .map(cell => cell.id);
}

export function attachMap(canvas: HTMLCanvasElement, options: MapOptions): () => void {
  const context = canvas.getContext('2d')!;
  const tooltip = document.getElementById('map-tooltip')!;
  let viewport: Viewport = {
    width: 0,
    height: 0,
    cellSize: 1,
    offsetX: 0,
    offsetY: 0,
  };
  let dragStart: Point | undefined;
  let pointer: Point | undefined;
  let hover: Mapxel | undefined;

  function draw(): void {
    const dark = darkMode();
    viewport = prepareCanvas(canvas, context, options.game, options.zoom);

    drawBackground(context, viewport, dark);
    drawCompass(context, viewport, dark);
    drawCells(context, options, viewport, dark);
    drawRoads(context, options, viewport);
    drawCityLabels(context, options.game, viewport, dark);
    drawHover(context, hover, viewport);
    drawDragSelection(context, dragStart, pointer);
    drawScale(context, viewport, dark);
  }

  function hideTooltip(): void {
    tooltip.style.display = 'none';
  }

  function showTooltip(cell: Mapxel, point: Point): void {
    tooltip.textContent = `${cell.name} · ${Math.round(cell.population).toLocaleString()} residents · ${Math.round(cell.approval * 100)}% approval`;
    tooltip.style.display = 'block';
    tooltip.style.left = `${Math.min(point.x + 12, canvas.clientWidth - 260)}px`;
    tooltip.style.top = `${Math.max(8, point.y - 36)}px`;
  }

  function handlePointerDown(event: PointerEvent): void {
    dragStart = pointerCoordinates(canvas, event);
    pointer = dragStart;
    canvas.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent): void {
    pointer = pointerCoordinates(canvas, event);
    hover = cellAtPoint(options.game, viewport, pointer);

    if (hover && hover.biome !== 'water' && !dragStart) {
      showTooltip(hover, pointer);
    } else {
      hideTooltip();
    }

    draw();
  }

  function handlePointerUp(event: PointerEvent): void {
    if (!dragStart) return;

    const end = pointerCoordinates(canvas, event);
    const moved = Math.hypot(end.x - dragStart.x, end.y - dragStart.y);
    let ids: number[];

    if (moved < 5) {
      const cell = cellAtPoint(options.game, viewport, end);
      ids = cell && cell.biome !== 'water' ? [cell.id] : [];
    } else {
      ids = selectedCellsInRectangle(options.game, viewport, dragStart, end);
    }

    dragStart = undefined;
    canvas.releasePointerCapture(event.pointerId);
    options.onSelect(ids, event.shiftKey);
    hideTooltip();
  }

  function handlePointerCancel(): void {
    dragStart = undefined;
    pointer = undefined;
    draw();
  }

  function handlePointerLeave(): void {
    hover = undefined;
    hideTooltip();
    if (!dragStart) draw();
  }

  canvas.onpointerdown = handlePointerDown;
  canvas.onpointermove = handlePointerMove;
  canvas.onpointerup = handlePointerUp;
  canvas.onpointercancel = handlePointerCancel;
  canvas.onpointerleave = handlePointerLeave;

  const observer = new ResizeObserver(draw);
  observer.observe(canvas);
  draw();

  return () => {
    observer.disconnect();
    canvas.onpointerdown = null;
    canvas.onpointermove = null;
    canvas.onpointerup = null;
    canvas.onpointercancel = null;
    canvas.onpointerleave = null;
    hideTooltip();
  };
}
