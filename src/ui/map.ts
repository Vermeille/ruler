import { clamp } from '../sim/math';
import type { Game, Mapxel } from '../sim/types';
export type Layer = 'terrain' | 'approval' | 'wealth' | 'foodSecurity' | 'crime' | 'population' | 'pollution' | 'industry';
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
export const SECTOR_COLORS = { agriculture: '#b6c785', manufacturing: '#b2a391', services: '#78a9a3', sports: '#cc9b75' };
const terrainColors = { water: '#e7efed', plain: '#cbd7ad', forest: '#91b296', hill: '#b6b7a0', city: '#748e7d' };
const darkTerrainColors = { water: '#172a30', plain: '#53634b', forest: '#355b49', hill: '#625f4d', city: '#40574c' };
const mix = (a: number[], b: number[], t: number) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * clamp(t))).join(',')})`;
function color(c: Mapxel, layer: Layer): string {
  const dark = document.body.classList.contains('dark-mode');
  if (layer === 'terrain') return (dark ? darkTerrainColors : terrainColors)[c.biome];
  if (layer === 'industry') return SECTOR_COLORS[(['agriculture', 'manufacturing', 'services', 'sports'] as const).reduce((a, b) => c[a] > c[b] ? a : b)];
  const value = layer === 'wealth' ? c.cash / c.population / 70 : layer === 'population' ? c.population / 850 : c[layer];
  return layer === 'crime' || layer === 'pollution'
    ? mix(dark ? [52, 78, 59] : [205, 221, 194], dark ? [194, 87, 72] : [173, 79, 65], value)
    : mix(dark ? [96, 78, 61] : [223, 188, 143], dark ? [49, 151, 116] : [47, 115, 93], value);
}
export interface MapOptions { game: Game; selected: Set<number>; layer: Layer; zoom: number; roads: boolean; onSelect: (ids: number[], additive: boolean) => void }
export function attachMap(canvas: HTMLCanvasElement, options: MapOptions): () => void {
  const ctx = canvas.getContext('2d')!, m = options.game.model;
  let cellSize = 1, ox = 0, oy = 0, start: { x: number; y: number } | undefined, hover: Mapxel | undefined;
  let pointer: { x: number; y: number } | undefined;
  const tooltip = document.getElementById('map-tooltip')!;
  const coords = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const at = ({ x, y }: { x: number; y: number }) => { const cx = Math.floor((x - ox) / cellSize), cy = Math.floor((y - oy) / cellSize); return cx >= 0 && cy >= 0 && cx < m.width && cy < m.height ? m.cells[cy * m.width + cx] : undefined; };
  function draw(): void {
    const dark = document.body.classList.contains('dark-mode');
    const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
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
      ctx.fillStyle = color(c, options.layer); ctx.fillRect(x, y, cellSize + .2, cellSize + .2);
      if (options.layer === 'terrain') { ctx.fillStyle = dark ? `rgba(255,255,255,${(c.fertility % .1) * .28})` : `rgba(255,255,255,${(c.fertility % .1) * .85})`; ctx.fillRect(x, y, cellSize, cellSize); }
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
    // Label one center for each city, even when its urban area spans several mapxels.
    const names = new Set<string>();
    for (const c of [...m.cells].sort((a, b) => b.population - a.population)) if (c.biome === 'city' && !names.has(c.name)) {
      names.add(c.name); const x = ox + (c.x + .5) * cellSize, y = oy + (c.y + .5) * cellSize;
      ctx.beginPath(); ctx.arc(x, y, 3.1, 0, Math.PI * 2); ctx.fillStyle = dark ? '#26372f' : '#f7f7e8'; ctx.fill(); ctx.strokeStyle = dark ? '#b2c69a' : '#385a46'; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.font = '600 11px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 3.5; ctx.strokeStyle = dark ? '#26372f' : '#e4ead4'; ctx.strokeText(c.name, x, y - 9); ctx.fillStyle = dark ? '#e1e8d7' : '#294b3d'; ctx.fillText(c.name, x, y - 9);
    }
    ctx.textAlign = 'left';
    if (hover && hover.biome !== 'water') { ctx.strokeStyle = '#fffef2'; ctx.lineWidth = 2; ctx.strokeRect(ox + hover.x * cellSize, oy + hover.y * cellSize, cellSize, cellSize); }
    if (start && pointer) { ctx.fillStyle = 'rgba(36,84,62,.09)'; ctx.strokeStyle = '#315d48'; ctx.setLineDash([4, 3]); ctx.fillRect(start.x, start.y, pointer.x - start.x, pointer.y - start.y); ctx.strokeRect(start.x, start.y, pointer.x - start.x, pointer.y - start.y); ctx.setLineDash([]); }
    ctx.fillStyle = dark ? '#9aada4' : '#527568'; ctx.font = '9px system-ui'; ctx.fillText('1 MAPXEL ≈ 4 KM²', 18, h - 17);
  }
  canvas.onpointerdown = e => { start = coords(e); pointer = start; canvas.setPointerCapture(e.pointerId); };
  canvas.onpointermove = e => {
    pointer = coords(e); hover = at(pointer);
    if (hover && hover.biome !== 'water' && !start) {
      tooltip.textContent = `${hover.name} · ${Math.round(hover.population).toLocaleString()} residents · ${Math.round(hover.approval * 100)}% approval`;
      tooltip.style.display = 'block'; tooltip.style.left = `${Math.min(pointer.x + 12, canvas.clientWidth - 260)}px`; tooltip.style.top = `${Math.max(8, pointer.y - 36)}px`;
    } else tooltip.style.display = 'none';
    draw();
  };
  canvas.onpointerup = e => {
    if (!start) return; const end = coords(e), ids: number[] = [];
    if (Math.hypot(end.x - start.x, end.y - start.y) < 5) { const c = at(end); if (c && c.biome !== 'water') ids.push(c.id); }
    else for (const c of m.cells) if (c.biome !== 'water') { const x = ox + (c.x + .5) * cellSize, y = oy + (c.y + .5) * cellSize; if (x >= Math.min(start.x, end.x) && x <= Math.max(start.x, end.x) && y >= Math.min(start.y, end.y) && y <= Math.max(start.y, end.y)) ids.push(c.id); }
    start = undefined; canvas.releasePointerCapture(e.pointerId); options.onSelect(ids, e.shiftKey); tooltip.style.display = 'none';
  };
  canvas.onpointercancel = () => { start = undefined; pointer = undefined; draw(); };
  canvas.onpointerleave = () => { hover = undefined; tooltip.style.display = 'none'; if (!start) draw(); };
  const observer = new ResizeObserver(draw); observer.observe(canvas); draw();
  return () => observer.disconnect();
}
