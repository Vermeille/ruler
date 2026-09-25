import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BehaviorMapCell, BehaviorMetric, BehaviorRun, MetricResponse } from './behavior-harness';

export type BehaviorReportEntry = Readonly<{ name: string; run: BehaviorRun }>;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]!));

const fmt = (value: number) => {
  if (!Number.isFinite(value)) return '—';
  const magnitude = Math.abs(value);
  if (magnitude >= 1e6) return value.toExponential(2);
  if (magnitude >= 1000) return value.toFixed(0);
  if (magnitude >= 10) return value.toFixed(2);
  return value.toPrecision(3);
};

function sparkline(response: MetricResponse): string {
  const values = response.deltas;
  const width = 220, height = 52, pad = 4;
  const max = Math.max(1e-12, ...values.map(Math.abs));
  const x = (index: number) => pad + index * (width - 2 * pad) / Math.max(1, values.length - 1);
  const y = (value: number) => height / 2 - value / max * (height / 2 - pad);
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly delta">
    <line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" class="zero"/>
    <polyline points="${points}" fill="none" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

function trajectoryChart(entry: BehaviorReportEntry, metric: BehaviorMetric): string {
  const baseline = entry.run.baseline.map(frame => frame.summary[metric]);
  const perturbed = entry.run.perturbed.map(frame => frame.summary[metric]);
  const all = [...baseline, ...perturbed];
  const min = Math.min(...all), max = Math.max(...all);
  const span = Math.max(1e-12, max - min);
  const width = 560, height = 150, px = 34, py = 18;
  const x = (index: number) => px + index * (width - 2 * px) / Math.max(1, baseline.length - 1);
  const y = (value: number) => height - py - (value - min) / span * (height - 2 * py);
  const line = (values: readonly number[], klass: string) =>
    `<polyline class="${klass}" points="${values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" fill="none"/>`;
  return `<div class="trajectory"><div class="chart-title">${escapeHtml(metric)}</div>
    <svg viewBox="0 0 ${width} ${height}">
      <line x1="${px}" y1="${height - py}" x2="${width - px}" y2="${height - py}" class="axis"/>
      ${line(baseline, 'baseline')}${line(perturbed, 'perturbed')}
      <text x="4" y="${py + 4}">${fmt(max)}</text><text x="4" y="${height - py}">${fmt(min)}</text>
    </svg></div>`;
}

const MAP_FIELDS = ['foodSecurity', 'price', 'pollution', 'health', 'happiness', 'infrastructure', 'output'] as const;
type MapField = typeof MAP_FIELDS[number];

function heatColor(value: number, max: number): string {
  if (max <= 1e-12) return 'rgb(241 245 249)';
  const strength = Math.min(1, Math.abs(value) / max);
  const fade = Math.round(245 - strength * 125);
  return value >= 0 ? `rgb(${fade} 245 ${fade})` : `rgb(245 ${fade} ${fade})`;
}

function map(entry: BehaviorReportEntry, field: MapField, month: number): string {
  const index = month - 1;
  const baseline = entry.run.baseline[index].map;
  const perturbed = entry.run.perturbed[index].map;
  const deltas = baseline.map((cell, i) => perturbed[i][field] - cell[field]);
  const max = Math.max(1e-12, ...deltas.map(Math.abs));
  const width = Math.max(...baseline.map(cell => cell.x)) + 1;
  const height = Math.max(...baseline.map(cell => cell.y)) + 1;
  const cells = baseline.map((cell, i) => {
    const delta = deltas[i];
    const fill = cell.biome === 'water' ? 'rgb(219 234 254)' : heatColor(delta, max);
    return `<rect x="${cell.x}" y="${cell.y}" width=".94" height=".94" fill="${fill}">
      <title>${escapeHtml(cell.biome)} · Δ ${escapeHtml(field)} ${fmt(delta)}</title></rect>`;
  }).join('');
  return `<div class="map-card"><div><b>Month ${month}</b> · max |Δ| ${fmt(max)}</div>
    <svg class="map" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${cells}</svg></div>`;
}

function responseTable(entry: BehaviorReportEntry): string {
  return Object.values(entry.run.responses)
    .filter(response => response.classification !== 'silent')
    .sort((a, b) => b.peak - a.peak)
    .map(response => `<tr><td><b>${escapeHtml(response.metric)}</b></td>
      <td><span class="pill ${response.classification}">${response.classification}</span></td>
      <td>m${response.firstVisibleMonth ?? '—'}</td><td>${fmt(response.peak)} @ m${response.peakMonth}</td>
      <td>${fmt(response.cumulative)}</td><td>${sparkline(response)}</td></tr>`).join('');
}

function section(entry: BehaviorReportEntry): string {
  const visible = Object.values(entry.run.responses).filter(r => r.classification !== 'silent');
  const chartMetrics = visible.sort((a, b) => b.peak - a.peak).slice(0, 6).map(r => r.metric);
  const mapFields = MAP_FIELDS.filter(field => {
    const response = entry.run.responses[field as BehaviorMetric];
    if (response) return response.classification !== 'silent';
    return entry.run.baseline.some((frame, index) => {
      const perturbed = entry.run.perturbed[index];
      return frame.map.some((cell, cellIndex) => Math.abs(perturbed.map[cellIndex][field] - cell[field]) > 1e-12);
    });
  }).slice(0, 3);
  return `<section><h2>${escapeHtml(entry.name)}</h2>
    <div class="legend"><span class="baseline-key">Baseline</span><span class="perturbed-key">Perturbed</span></div>
    <div class="charts">${chartMetrics.map(metric => trajectoryChart(entry, metric)).join('')}</div>
    <h3>Response profile</h3><div class="table-wrap"><table><thead><tr><th>Metric</th><th>Shape</th><th>First</th><th>Peak</th><th>Cumulative Δ</th><th>Monthly Δ</th></tr></thead>
    <tbody>${responseTable(entry)}</tbody></table></div>
    ${mapFields.length ? `<h3>Spatial propagation</h3>${mapFields.map(field => `<h4>Δ ${field}</h4><div class="maps">${[1,3,6,12].map(month => map(entry, field, month)).join('')}</div>`).join('')}` : ''}
  </section>`;
}

export function writeBehaviorReport(entries: readonly BehaviorReportEntry[], path = 'test-results/behavior-report.html'): void {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Commonwealth behavior report</title><style>
:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#f6f7f9}body{margin:0}main{max-width:1400px;margin:auto;padding:36px}
h1{font-size:32px;margin-bottom:6px}h2{margin-top:52px;padding-top:28px;border-top:1px solid #d9dee8}h3{margin-top:32px}.sub{color:#667085}
.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(390px,1fr));gap:14px}.trajectory,.map-card{background:white;border:1px solid #dde2ea;border-radius:10px;padding:12px}
.trajectory svg{width:100%;height:auto}.trajectory polyline{stroke-width:2.5;vector-effect:non-scaling-stroke}.baseline{stroke:#94a3b8}.perturbed{stroke:#2563eb}.axis,.zero{stroke:#d8dee8;stroke-width:1}.trajectory text{font-size:10px;fill:#667085}.chart-title{font-weight:650}
.legend{display:flex;gap:18px;margin:10px 0}.legend span:before{content:'';display:inline-block;width:18px;height:3px;margin:0 6px 3px 0}.baseline-key:before{background:#94a3b8}.perturbed-key:before{background:#2563eb}
.table-wrap{overflow:auto;background:white;border:1px solid #dde2ea;border-radius:10px}table{border-collapse:collapse;width:100%}th,td{padding:10px 12px;border-bottom:1px solid #edf0f4;text-align:left;white-space:nowrap}th{font-size:12px;text-transform:uppercase;color:#667085}.spark{width:220px;height:52px}.spark polyline{stroke:#475569;stroke-width:2}
.pill{font-size:12px;padding:3px 8px;border-radius:99px;background:#e9edf3}.damped{background:#dcfce7}.amplifying{background:#fee2e2}.oscillating{background:#fef3c7}.persistent{background:#dbeafe}
.maps{display:grid;grid-template-columns:repeat(4,minmax(180px,1fr));gap:12px}.map{width:100%;max-height:250px;image-rendering:auto}.map-card>div{font-size:12px;color:#667085;margin-bottom:7px}
@media(max-width:800px){main{padding:18px}.maps{grid-template-columns:repeat(2,1fr)}.charts{grid-template-columns:1fr}}
</style></head><body><main><h1>Behavior perturbation report</h1><p class="sub">12-month finite-difference probes against one deterministic control simulation. Maps show perturbed minus baseline values.</p>
${entries.map(section).join('')}</main></body></html>`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
}
