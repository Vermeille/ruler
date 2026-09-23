import type { Mapxel, Model } from '../sim/types';
import terrainAtlasUrl from '../assets/map/terrain-atlas.svg?url';

export type LandformKind = 'mountain' | 'forest' | 'farmland' | 'coast';
export type SettlementKind = 'village' | 'city';

export interface TerrainIdentity {
  landform?: LandformKind;
  settlement?: SettlementKind;
  label: string;
}

const TILE_SIZE = 96;
const ATLAS_INDEX: Record<LandformKind | SettlementKind, number> = {
  mountain: 0,
  forest: 1,
  farmland: 2,
  coast: 3,
  village: 4,
  city: 5,
};

let atlas: HTMLImageElement | undefined;
let atlasReady = false;
let atlasStarted = false;
const readyListeners = new Set<() => void>();

function orthogonalCells(cell: Mapxel, model: Model): Mapxel[] {
  const result: Mapxel[] = [];
  const coordinates = [
    [cell.x - 1, cell.y],
    [cell.x + 1, cell.y],
    [cell.x, cell.y - 1],
    [cell.x, cell.y + 1],
  ];

  for (const [x, y] of coordinates) {
    if (x < 0 || y < 0 || x >= model.width || y >= model.height) continue;
    result.push(model.cells[y * model.width + x]);
  }

  return result;
}

export function terrainIdentity(cell: Mapxel, model: Model): TerrainIdentity {
  const coastal = orthogonalCells(cell, model).some(neighbor => neighbor.biome === 'water');
  const settlement: SettlementKind | undefined = cell.biome === 'city' || cell.population >= 500
    ? 'city'
    : cell.population >= 175
      ? 'village'
      : undefined;

  let landform: LandformKind | undefined;
  if (cell.biome === 'hill') landform = 'mountain';
  else if (cell.biome === 'forest') landform = 'forest';
  else if (coastal) landform = 'coast';
  else if (cell.agriculture >= 0.39 || cell.fertility >= 0.66) landform = 'farmland';

  const landformLabel = landform === 'mountain'
    ? 'mountain'
    : landform === 'forest'
      ? 'forest'
      : landform === 'farmland'
        ? 'farming'
        : landform === 'coast'
          ? 'coastal'
          : '';

  const label = settlement
    ? `${landformLabel ? `${landformLabel} ` : ''}${settlement}`
    : landform === 'mountain'
      ? 'mountains'
      : landform === 'forest'
        ? 'forest'
        : landform === 'farmland'
          ? 'farmland'
          : landform === 'coast'
            ? 'coast'
            : 'open country';

  return { landform, settlement, label };
}

function ensureAtlas(): HTMLImageElement {
  if (atlas) return atlas;

  atlas = new Image();
  atlas.decoding = 'async';
  atlas.onload = () => {
    atlasReady = true;
    for (const listener of readyListeners) listener();
    readyListeners.clear();
  };
  atlas.src = terrainAtlasUrl;
  atlasStarted = true;
  return atlas;
}

export function onTerrainAtlasReady(listener: () => void): () => void {
  if (atlasReady) {
    queueMicrotask(listener);
    return () => undefined;
  }

  readyListeners.add(listener);
  if (!atlasStarted) ensureAtlas();
  return () => readyListeners.delete(listener);
}

function drawAtlasTile(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  kind: LandformKind | SettlementKind,
  x: number,
  y: number,
  size: number,
): void {
  const sourceX = ATLAS_INDEX[kind] * TILE_SIZE;
  ctx.drawImage(image, sourceX, 0, TILE_SIZE, TILE_SIZE, x, y, size, size);
}

export function drawTerrainIdentity(
  ctx: CanvasRenderingContext2D,
  cell: Mapxel,
  model: Model,
  x: number,
  y: number,
  size: number,
  muted: boolean,
): void {
  if (size < 10) return;

  const image = ensureAtlas();
  if (!atlasReady || !image.complete) return;

  const identity = terrainIdentity(cell, model);
  const primary = identity.settlement ?? identity.landform;
  if (!primary) return;

  ctx.save();
  ctx.globalAlpha = muted ? 0.28 : 0.82;

  if (size < 18 || !identity.landform || !identity.settlement) {
    const iconSize = Math.min(size * 0.9, 17);
    drawAtlasTile(
      ctx,
      image,
      primary,
      x + (size - iconSize) / 2,
      y + (size - iconSize) / 2,
      iconSize,
    );
    ctx.restore();
    return;
  }

  const landformSize = Math.min(size * 0.88, 21);
  drawAtlasTile(
    ctx,
    image,
    identity.landform,
    x + (size - landformSize) / 2,
    y + (size - landformSize) / 2,
    landformSize,
  );

  ctx.globalAlpha = muted ? 0.42 : 0.96;
  const settlementSize = Math.min(size * 0.55, 13);
  drawAtlasTile(
    ctx,
    image,
    identity.settlement,
    x + size - settlementSize - 1,
    y + size - settlementSize - 1,
    settlementSize,
  );
  ctx.restore();
}
