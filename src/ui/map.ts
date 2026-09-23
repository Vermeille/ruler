import { clamp } from '../sim/math';
import type { Game, Mapxel } from '../sim/types';
import { deriveMapActivity, type ActivityTone } from './map-activity';
import {
  ALL_LAYERS,
  LAYERS,
  isHeatmapLayer,
  type HeatmapLayer,
  type Layer,
} from './map-layers';
import { drawTerrainIdentity, onTerrainAtlasReady, terrainIdentity } from './map-terrain';

export { ALL_LAYERS, LAYERS, type Layer } from './map-layers';

export const SECTOR_COLORS = { agriculture: '#b6c785', manufacturing: '#b2a391', services: '#78a9a3', sports: '#cc9b75' };
const terrainColors = { water: '#e7efed', plain: '#cbd7ad', forest: '#91b296', hill: '#b6b7a0', city: '#748e7d' };
const darkTerrainColors = { water: '#172a30', plain: '#53634b', forest: '#355b49', hill: '#625f4d', city: '#40574c' };
const sectors = ['agriculture', 'manufacturing', 'services', 'sports'] as const;
const mix = (a: number[], b: number[], t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * clamp(t))).join(',')})`;

function dominantSector(c: Mapxel): typeof sectors[number] {
  return sectors.reduce((a, b) => c[a] > c[b] ? a : b);
}

function terrainColor(c: Mapxel, dark: boolean): string {
  return (dark ? darkTerrainColors : terrainColors)[c.biome];
}

function heatmapColor(c: Mapxel, layer: HeatmapLayer, dark: boolean): string {
  if (layer === 'industry') return SECTOR_COLORS[dominantSector(c)];
  const value = layer === 'wealth' ? c.cash / c.population / 70 : layer === 'population' ? c.population / 850 : c[layer];
  return layer === 'crime' || layer === 'pollution'
    ? mix(dark ? [52, 78, 59] : [205, 221, 194], dark ? [194, 87, 72] : [173, 79, 65], value)
    : mix(dark ? [96, 78, 61] : [223, 188, 143], dark ? [49, 151, 116] : [47, 115, 93], value);
}

function toneColor(tone: ActivityTone, dark: boolean): string {
  if (tone === 'bad') return dark ? '#e69a7b' : '#a64f42';
  if (tone === 'good') return dark ? '#9ed69f' : '#477d4c';
  return dark ? '#d5c992' : '#6a7650';
}

export interface MapOptions {
  game: Game;
  selected: Set<number>;
  layers: Layer[];
  zoom: number;
  roads: boolean;
  running: boolean;
  onSelect: (ids: number[], additive: boolean) => void;
}

export function attachMap(canvas: HTMLCanvasElement, options: MapOptions): () => void {
  const ctx = canvas.getContext('2d')!, m = options.game.model;
  const visibleLayers = new Set<Layer>(options.layers);
  const activity = deriveMapActivity(options.game, visibleLayers);
  const heatmapLayers = options.layers.filter(isHeatmapLayer);
  const focusedHeatmap = heatmapLayers.length === 1 ? heatmapLayers[0] : undefined;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const activityStartedAt = performance.now();
  const animatedActivity = activity.foodFlows.length > 0 || activity.markers.length > 0;
  let animationFrame = 0;
  let lastAnimationFrame = 0;
  let cellSize = 1, ox = 0, oy = 0, start: { x: number; y: number } | undefined, hover: Mapxel | undefined;
  let pointer: { x: number; y: number } | undefined;
  const tooltip = document.getElementById('map-tooltip')!;
  const coords = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const at = ({ x, y }: { x: number; y: number }) => { const cx = Math.floor((x - ox) / cellSize), cy = Math.floor((y - oy) / cellSize); return cx >= 0 && cy >= 0 && cx < m.width && cy < m.height ? m.cells[cy * m.width + cx] : undefined; };
  const center = (c: Mapxel) => ({ x: ox + (c.x + .5) * cellSize, y: oy + (c.y + .5) * cellSize });

  function drawSummaryLayers(c: Mapxel, x: number, y: number, dark: boolean): void {
    if (visibleLayers.has('pollution') && c.pollution > .08) {
      ctx.fillStyle = dark
        ? `rgba(143,132,108,${c.pollution * .13})`
        : `rgba(98,104,82,${c.pollution * .11})`;
      ctx.fillRect(x, y, cellSize, cellSize);
    }

    if (visibleLayers.has('population')) {
      const density = clamp(c.population / 850);
      const radius = .7 + Math.sqrt(density) * Math.min(3.2, cellSize * .13);
      ctx.beginPath(); ctx.arc(x + cellSize * .5, y + cellSize * .5, radius, 0, Math.PI * 2);
      ctx.fillStyle = dark ? `rgba(222,229,218,${.18 + density * .22})` : `rgba(40,72,57,${.12 + density * .19})`;
      ctx.fill();
    }

    if (visibleLayers.has('approval')) {
      const approvalColor = c.approval >= .5
        ? (dark ? 'rgba(128,194,139,.72)' : 'rgba(53,111,76,.62)')
        : (dark ? 'rgba(220,154,123,.72)' : 'rgba(167,110,80,.62)');
      ctx.fillStyle = approvalColor;
      ctx.fillRect(x + 1, y + cellSize - 2.2, Math.max(1, (cellSize - 2) * c.approval), 1.4);
    }

    if (visibleLayers.has('wealth')) {
      const wealth = clamp(c.cash / Math.max(1, c.population) / 70);
      ctx.beginPath(); ctx.arc(x + 2.8, y + 2.8, .8 + wealth * 1.8, 0, Math.PI * 2);
      ctx.fillStyle = dark ? `rgba(232,203,122,${.28 + wealth * .4})` : `rgba(135,99,33,${.22 + wealth * .4})`;
      ctx.fill();
    }

    if (visibleLayers.has('foodSecurity') && c.foodSecurity < .94) {
      const pressure = clamp((.94 - c.foodSecurity) / .45);
      ctx.fillStyle = dark ? `rgba(230,154,123,${.3 + pressure * .5})` : `rgba(166,79,66,${.25 + pressure * .5})`;
      ctx.fillRect(x, y + cellSize * (1 - pressure), 1.7, Math.max(2, cellSize * pressure));
    }

    if (visibleLayers.has('crime') && c.crime > .16) {
      const pressure = clamp((c.crime - .16) / .5);
      ctx.strokeStyle = dark ? `rgba(238,151,125,${.3 + pressure * .55})` : `rgba(155,65,55,${.28 + pressure * .55})`;
      ctx.lineWidth = 1 + pressure;
      ctx.beginPath();
      ctx.moveTo(x + cellSize - 1.5, y + 1.5);
      ctx.lineTo(x + cellSize - 1.5 - Math.min(5, cellSize * .28), y + 1.5 + Math.min(5, cellSize * .28));
      ctx.stroke();
    }

    if (visibleLayers.has('industry')) {
      ctx.fillStyle = SECTOR_COLORS[dominantSector(c)];
      const size = Math.max(1.8, Math.min(3.2, cellSize * .16));
      ctx.fillRect(x + cellSize - size - 1, y + cellSize - size - 1, size, size);
    }
  }

  function drawFoodFlows(now: number, dark: boolean): void {
    ctx.save();
    ctx.lineCap = 'round';

    for (const flow of activity.foodFlows) {
      const from = m.cells[flow.from], to = m.cells[flow.to];
      const a = center(from), b = center(to);
      const strength = flow.strength;
      ctx.strokeStyle = dark ? `rgba(232,203,122,${0.16 + strength * .22})` : `rgba(122,91,33,${0.14 + strength * .2})`;
      ctx.lineWidth = 1 + strength * 1.25;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

      for (const offset of [0, .5]) {
        const t = reducedMotion ? .68 : ((now / 1450 + flow.phase + offset) % 1);
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        const radius = 1.3 + strength * 1.8;
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = dark ? '#f0ce75' : '#8d6a2b'; ctx.fill();
        ctx.strokeStyle = dark ? '#fff1bc' : '#f8e4a6'; ctx.lineWidth = .8; ctx.stroke();
      }
    }

    ctx.restore();
  }

  function drawMarkerBubble(x: number, y: number, radius: number, glyph: string, tone: ActivityTone, dark: boolean, alpha = 1): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = dark ? 'rgba(27,40,43,.91)' : 'rgba(255,255,244,.94)'; ctx.fill();
    ctx.strokeStyle = toneColor(tone, dark); ctx.lineWidth = 1.2; ctx.stroke();
    ctx.font = `${Math.max(8, Math.round(radius * 1.25))}px "Apple Color Emoji","Segoe UI Emoji",system-ui`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = toneColor(tone, dark); ctx.fillText(glyph, x, y + .3);
    ctx.restore();
  }

  function drawActivity(now: number, dark: boolean): void {
    drawFoodFlows(now, dark);

    for (const marker of activity.markers) {
      const c = m.cells[marker.cell], p = center(c);
      const bob = reducedMotion ? 0 : Math.sin(now / 620 + marker.phase * Math.PI * 2) * 1.5;
      const radius = Math.max(6.2, Math.min(9.5, cellSize * .34));
      const x = p.x + cellSize * .18, y = p.y + cellSize * .16 + bob;

      if (marker.layer === 'pollution' && !reducedMotion) {
        for (let i = 0; i < 2; i += 1) {
          const t = (now / 1800 + marker.phase + i * .46) % 1;
          ctx.beginPath();
          ctx.arc(x + Math.sin(t * 5) * 2, y - radius - t * 12, 1.3 + t * 1.1, 0, Math.PI * 2);
          ctx.fillStyle = dark ? `rgba(185,196,188,${.34 * (1 - t)})` : `rgba(89,102,92,${.27 * (1 - t)})`;
          ctx.fill();
        }
      }

      drawMarkerBubble(x, y, radius, marker.glyph, marker.tone, dark, marker.kind === 'industry' ? .82 : .96);
    }

    for (const event of activity.events) {
      const c = m.cells[event.cell], p = center(c);
      const radius = Math.max(7.5, Math.min(10.5, cellSize * .4));
      const x = p.x - cellSize * .23, y = p.y - cellSize * .2;
      const pulse = reducedMotion ? .45 : ((now / 1150 + event.phase) % 1);
      ctx.beginPath(); ctx.arc(x, y, radius + 3 + pulse * 10, 0, Math.PI * 2);
      ctx.strokeStyle = toneColor(event.tone, dark); ctx.globalAlpha = .45 * (1 - pulse); ctx.lineWidth = 1.4; ctx.stroke(); ctx.globalAlpha = 1;
      drawMarkerBubble(x, y, radius, event.glyph, event.tone, dark);
    }
  }

  function tooltipText(c: Mapxel): string {
    const labels = activity.labelsByCell.get(c.id) ?? [];
    const parts = [c.name, terrainIdentity(c, m).label];
    const overview = visibleLayers.size === ALL_LAYERS.length
      && LAYERS.every(layer => visibleLayers.has(layer.id));

    if (overview) {
      parts.push(
        `${Math.round(c.population).toLocaleString()} residents`,
        `${Math.round(c.approval * 100)}% approval`,
        `₡${(c.cash / Math.max(1, c.population)).toFixed(0)} / resident`,
      );
    } else {
      for (const layer of options.layers) {
        if (layer === 'approval') parts.push(`${Math.round(c.approval * 100)}% approval`);
        else if (layer === 'wealth') parts.push(`₡${(c.cash / Math.max(1, c.population)).toFixed(1)} / resident`);
        else if (layer === 'foodSecurity') parts.push(`${Math.round(c.foodSecurity * 100)}% food needs met`);
        else if (layer === 'crime') parts.push(`${Math.round(c.crime * 100)}% crime pressure`);
        else if (layer === 'population') parts.push(`${Math.round(c.population).toLocaleString()} residents`);
        else if (layer === 'pollution') parts.push(`${Math.round(c.pollution * 100)}% pollution`);
        else if (layer === 'industry') parts.push(`${dominantSector(c)} economy`);
      }
    }

    parts.push(...labels);
    return parts.join(' · ');
  }

  function draw(now = performance.now()): void {
    const dark = document.body.classList.contains('dark-mode');
    const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(rect.width * dpr), pixelHeight = Math.round(rect.height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = rect.width, h = rect.height;
    cellSize = Math.min((w - 38) / m.width, (h - 28) / m.height) * options.zoom;
    ox = (w - m.width * cellSize) / 2; oy = (h - m.height * cellSize) / 2;
    ctx.fillStyle = dark ? '#172126' : '#e7efed'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = dark ? '#25343a' : '#ccdcd6';
    for (let y = 12; y < h; y += 19) for (let x = 12; x < w; x += 19) ctx.fillRect(x, y, 1, 1);
    ctx.fillStyle = dark ? '#78949a' : '#72948a'; ctx.font = 'italic 13px Georgia'; ctx.fillText('The Western Sea', 22, h * .47);
    ctx.save(); ctx.translate(w - 32, 35); ctx.strokeStyle = dark ? '#718c91' : '#779489'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 15); ctx.lineTo(0, -7); ctx.lineTo(-3, 0); ctx.moveTo(0, -7); ctx.lineTo(3, 0); ctx.stroke(); ctx.fillStyle = dark ? '#a5bbb2' : '#486c5e'; ctx.font = '10px sans-serif'; ctx.fillText('N', -3, -13); ctx.restore();

    for (const c of m.cells) {
      if (c.biome === 'water') continue;
      const x = ox + c.x * cellSize, y = oy + c.y * cellSize;
      ctx.fillStyle = focusedHeatmap ? heatmapColor(c, focusedHeatmap, dark) : terrainColor(c, dark);
      ctx.fillRect(x, y, cellSize + .2, cellSize + .2);
      if (!focusedHeatmap) {
        ctx.fillStyle = dark ? `rgba(255,255,255,${(c.fertility % .1) * .2})` : `rgba(255,255,255,${(c.fertility % .1) * .55})`;
        ctx.fillRect(x, y, cellSize, cellSize);
        drawSummaryLayers(c, x, y, dark);
      }
      drawTerrainIdentity(ctx, c, m, x, y, cellSize, Boolean(focusedHeatmap));
      ctx.strokeStyle = 'rgba(40,72,53,.045)'; ctx.lineWidth = .5; ctx.strokeRect(x, y, cellSize, cellSize);
      ctx.strokeStyle = 'rgba(62,91,69,.28)'; ctx.lineWidth = 1;
      for (const [dx, dy, x1, y1, x2, y2] of [[-1, 0, x, y, x, y + cellSize], [1, 0, x + cellSize, y, x + cellSize, y + cellSize], [0, -1, x, y, x + cellSize, y], [0, 1, x, y + cellSize, x + cellSize, y + cellSize]]) {
        const nx = c.x + dx, ny = c.y + dy, n = nx >= 0 && nx < m.width && ny >= 0 && ny < m.height ? m.cells[ny * m.width + nx] : undefined;
        if (!n || n.biome === 'water' || n.region !== c.region) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
      }
      if (options.selected.has(c.id)) { ctx.fillStyle = dark ? 'rgba(253,247,212,.24)' : 'rgba(253,247,212,.36)'; ctx.fillRect(x, y, cellSize, cellSize); ctx.strokeStyle = dark ? '#d6e7ad' : '#214f3d'; ctx.lineWidth = 1.6; ctx.strokeRect(x + 1, y + 1, cellSize - 2, cellSize - 2); }
    }

    if (options.roads) {
      ctx.strokeStyle = 'rgba(255,255,244,.55)'; ctx.lineWidth = 1;
      for (const c of m.cells) for (const id of m.neighbors[c.id]) if (id > c.id && (options.selected.size ? options.selected.has(c.id) || options.selected.has(id) : c.infrastructure > .58)) {
        const n = m.cells[id]; ctx.beginPath(); ctx.moveTo(ox + (c.x + .5) * cellSize, oy + (c.y + .5) * cellSize); ctx.lineTo(ox + (n.x + .5) * cellSize, oy + (n.y + .5) * cellSize); ctx.stroke();
      }
    }

    const names = new Set<string>();
    for (const c of [...m.cells].sort((a, b) => b.population - a.population)) if (c.biome === 'city' && !names.has(c.name)) {
      names.add(c.name); const x = ox + (c.x + .5) * cellSize, y = oy + (c.y + .5) * cellSize;
      ctx.beginPath(); ctx.arc(x, y, 3.1, 0, Math.PI * 2); ctx.fillStyle = dark ? '#26372f' : '#f7f7e8'; ctx.fill(); ctx.strokeStyle = dark ? '#b2c69a' : '#385a46'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.font = '600 11px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 3.5; ctx.strokeStyle = dark ? '#26372f' : '#e4ead4'; ctx.strokeText(c.name, x, y - 9); ctx.fillStyle = dark ? '#e1e8d7' : '#294b3d'; ctx.fillText(c.name, x, y - 9);
    }

    drawActivity(now, dark);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if (hover && hover.biome !== 'water') { ctx.strokeStyle = '#fffef2'; ctx.lineWidth = 2; ctx.strokeRect(ox + hover.x * cellSize, oy + hover.y * cellSize, cellSize, cellSize); }
    if (start && pointer) { ctx.fillStyle = 'rgba(36,84,62,.09)'; ctx.strokeStyle = '#315d48'; ctx.setLineDash([4, 3]); ctx.fillRect(start.x, start.y, pointer.x - start.x, pointer.y - start.y); ctx.strokeRect(start.x, start.y, pointer.x - start.x, pointer.y - start.y); ctx.setLineDash([]); }
    ctx.fillStyle = dark ? '#9aada4' : '#527568'; ctx.font = '9px system-ui'; ctx.fillText('1 MAPXEL ≈ 4 KM²', 18, h - 17);
  }

  function redraw(): void {
    draw(performance.now());
  }

  function animate(now: number): void {
    if (now - lastAnimationFrame > 32) {
      draw(now);
      lastAnimationFrame = now;
    }
    const freshEventPulse = activity.events.length > 0 && now - activityStartedAt < 2600;
    if (!reducedMotion && ((options.running && animatedActivity) || freshEventPulse)) animationFrame = requestAnimationFrame(animate);
  }

  canvas.onpointerdown = e => { start = coords(e); pointer = start; canvas.setPointerCapture(e.pointerId); };
  canvas.onpointermove = e => {
    pointer = coords(e); hover = at(pointer);
    if (hover && hover.biome !== 'water' && !start) {
      tooltip.textContent = tooltipText(hover);
      tooltip.style.display = 'block'; tooltip.style.left = `${Math.min(pointer.x + 12, canvas.clientWidth - 260)}px`; tooltip.style.top = `${Math.max(8, pointer.y - 36)}px`;
    } else tooltip.style.display = 'none';
    redraw();
  };
  canvas.onpointerup = e => {
    if (!start) return; const end = coords(e), ids: number[] = [];
    if (Math.hypot(end.x - start.x, end.y - start.y) < 5) { const c = at(end); if (c && c.biome !== 'water') ids.push(c.id); }
    else for (const c of m.cells) if (c.biome !== 'water') { const x = ox + (c.x + .5) * cellSize, y = oy + (c.y + .5) * cellSize; if (x >= Math.min(start.x, end.x) && x <= Math.max(start.x, end.x) && y >= Math.min(start.y, end.y) && y <= Math.max(start.y, end.y)) ids.push(c.id); }
    start = undefined; canvas.releasePointerCapture(e.pointerId); options.onSelect(ids, e.shiftKey); tooltip.style.display = 'none';
  };
  canvas.onpointercancel = () => { start = undefined; pointer = undefined; redraw(); };
  canvas.onpointerleave = () => { hover = undefined; tooltip.style.display = 'none'; if (!start) redraw(); };
  const observer = new ResizeObserver(redraw);
  const unsubscribeTerrainAtlas = onTerrainAtlasReady(redraw);
  observer.observe(canvas); redraw();
  const freshEvents = activity.events.length > 0;
  if (!reducedMotion && ((options.running && animatedActivity) || freshEvents)) animationFrame = requestAnimationFrame(animate);

  return () => {
    observer.disconnect();
    unsubscribeTerrainAtlas();
    cancelAnimationFrame(animationFrame);
  };
}
