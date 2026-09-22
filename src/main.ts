import './style.css';
import { createGame } from './sim/world';
import { step } from './sim/engine';
import { enact, forecastBudget, parseCommand, previewActions, scopeCells, subsidyFor } from './sim/policy';
import { summarize } from './sim/math';
import { mandateReport, traceCauses } from './sim/narrative';
import { deserialize, serialize } from './sim/save';
import { LAWS, SECTORS, SERVICES, type Game, type Metric, type Scope } from './sim/types';
import { attachMap, LAYERS, SECTOR_COLORS, type Layer } from './ui/map';
import { defaultRules } from './sim/rules';
import { loadAutosave, storeAutosave } from './ui/storage';

const app = document.getElementById('app')!;
const esc = (v: unknown): string => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const num = (n: number): string => Math.round(n).toLocaleString('en-US');
const compact = (n: number): string => Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)}m` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : n.toFixed(0);
const money = (n: number): string => `${n < 0 ? '−' : ''}₡${compact(Math.abs(n))}`;
const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;
const month = (tick: number): string => new Date(Date.UTC(2032, tick, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const label = (s: string) => s[0].toUpperCase() + s.slice(1);
let game: Game = createGame();
let selected = new Set<number>(), layer: Layer = 'terrain', zoom = 1, roads = false;
let tab: 'cabinet' | 'ledger' | 'trends' | 'rules' = 'cabinet', policyTab: 'budget' | 'development' | 'laws' | 'console' = 'budget';
let running = false, speed = 1, timer: ReturnType<typeof setTimeout> | undefined;
let destroyMap: (() => void) | undefined, pending: unknown, feedFilter = 'all';
let saveFailed = false;
let darkMode = localStorage.getItem('commonwealth-theme') === 'dark';
function setDarkMode(enabled: boolean): void {
  darkMode = enabled;
  document.body.classList.toggle('dark-mode', enabled);
  document.documentElement.style.colorScheme = enabled ? 'dark' : 'light';
  localStorage.setItem('commonwealth-theme', enabled ? 'dark' : 'light');
}
setDarkMode(darkMode);
const logo = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 5v22M7 27h18M16 19C3 19 4 8 4 8s10 0 12 11Zm0-6C16 4 25 4 25 4s2 9-9 9Zm0 11c0-9 12-11 12-11s0 11-12 11Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;

function save(): void {
  const text = serialize(game);
  void storeAutosave(text).then(() => { saveFailed = false; }).catch(() => { if (!saveFailed) toast('Autosave is unavailable. Export a save to keep this mandate.', true); saveFailed = true; });
}
function toast(text: string, error = false): void {
  let el = document.getElementById('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.className = error ? 'toast error' : 'toast'; el.textContent = text; el.hidden = false; setTimeout(() => { if (el?.textContent === text) el.hidden = true; }, 6000);
}
function pause(): void { running = false; clearTimeout(timer); }
function advance(): void {
  if (game.ended) return;
  try { game = step(game); save(); render(); if (game.ended) { pause(); showReport(); } } catch (e) { pause(); toast(`The month was rolled back: ${(e as Error).message}`, true); render(); }
}
function schedule(): void { clearTimeout(timer); if (running && !game.ended) timer = setTimeout(() => { advance(); schedule(); }, 1200 / speed); }
function setSelection(ids: number[], additive = false): void {
  if (!additive) selected = new Set(ids); else for (const id of ids) selected.has(id) ? selected.delete(id) : selected.add(id);
  render();
}
function sparkline(metric: Metric, color = '#39755d', width = 90, height = 26): string {
  const values = game.history.map(h => h.summary[metric]); if (values.length === 1) values.push(values[0]);
  const low = Math.min(...values) * .98, high = Math.max(...values) * 1.02 + .0001;
  const points = values.map((v, i) => `${i / (values.length - 1) * width},${height - 3 - (v - low) / (high - low) * (height - 6)}`).join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" aria-label="${esc(metric)} trend" role="img"><polyline fill="none" stroke="${color}" stroke-width="1.8" points="${points}"/></svg>`;
}
function metricCard(name: string, value: string, detail: string, metric?: Metric): string { return `<div class="metric"><span class="eyebrow">${name}</span><div class="metric-main"><strong>${value}</strong>${metric ? sparkline(metric) : '<span class="currency-seal">₡</span>'}</div><span class="metric-note">${detail}</span></div>`; }
function render(): void {
  destroyMap?.();
  const m = game.model, s = summarize(m), forecast = forecastBudget(m);
  app.innerHTML = `
  <header class="masthead"><a class="brand" href="#" aria-label="Commonwealth home">${logo}<span>Commonwealth<small>A COUNTRY OF SMALL DECISIONS</small></span></a><div class="mandate-info"><span class="live-dot"></span><span>${game.ended ? 'Mandate complete' : 'Your first mandate'}<small>${month(0)} — ${month(m.mandate)}</small></span></div><div class="header-actions"><button class="quiet" id="theme-toggle" aria-pressed="${darkMode}" aria-label="Switch to ${darkMode ? 'light' : 'dark'} mode">${darkMode ? '☀ Light mode' : '☾ Dark mode'}</button><button class="quiet" id="help">Field guide</button><button class="quiet" id="save-menu">Save & load</button><button class="outline" id="new-country">New country <span>↗</span></button></div></header>
  <main><section class="page-heading"><div><div class="eyebrow">THE COMMONWEALTH · OFFICE OF THE PRIME MINISTER</div><h1>A country in your hands.</h1><p>Watch closely. Govern thoughtfully. See what happens.</p></div><div class="time-controls"><div class="date"><strong>${month(m.tick)}</strong><span>${Math.min(m.tick, m.mandate)} of ${m.mandate} months served</span></div><div class="time-buttons"><select id="speed" aria-label="Simulation speed"><option value="1" ${speed === 1 ? 'selected' : ''}>1×</option><option value="3" ${speed === 3 ? 'selected' : ''}>3×</option><option value="8" ${speed === 8 ? 'selected' : ''}>8×</option></select><button id="play" class="play" ${game.ended ? 'disabled' : ''} aria-label="${running ? 'Pause' : 'Play'} simulation">${running ? 'Ⅱ' : '▶'}</button><button id="advance" class="primary" ${game.ended ? 'disabled' : ''}>Next month <span>→</span></button></div></div></section>
  <section class="metrics" aria-label="National indicators">
  ${metricCard('PUBLIC APPROVAL', pct(s.approval), `${s.approval >= .5 ? 'A majority is with you' : 'Public confidence is fragile'}`, 'approval')}
  ${metricCard('THE PEOPLE', compact(s.population), `${num(m.cells.filter(c => c.population > 0).length)} inhabited mapxels`, 'population')}
  ${metricCard('PUBLIC TREASURY', money(s.treasury), `${forecast.balance >= 0 ? '+' : '−'}₡${compact(Math.abs(forecast.balance))} projected / month`)}
  ${metricCard('HOUSEHOLD WELLBEING', pct(s.happiness), `${pct(s.employment)} employment`, 'happiness')}
  ${metricCard('FOOD NEEDS MET', pct(s.foodSecurity), `${s.price.toFixed(2)}× food price index`, 'foodSecurity')}
  </section>
  ${game.ended ? `<div class="end-banner"><span>Your mandate is over. The country has a story to tell.</span><button id="report" class="primary">Read your legacy →</button></div>` : m.budget.funding < .99 ? `<div class="alert-banner">Public services received ${pct(m.budget.funding)} of promised funding this month. Review your budget.</div>` : ''}
  <section class="workspace"><div class="map-panel panel"><div class="panel-heading"><div><span class="eyebrow">A LIVING ATLAS</span><h2>The Commonwealth <span class="subtle">/</span> <span class="map-view-title">${LAYERS.find(l => l.id === layer)!.name}</span></h2></div><select id="region" aria-label="Select a region"><option value="">Explore a region</option>${m.regions.map((r, i) => `<option value="${i}">${esc(r)}</option>`).join('')}</select></div>
  <div class="layer-bar" role="group" aria-label="Map layers">${LAYERS.map(l => `<button data-layer="${l.id}" class="layer ${layer === l.id ? 'active' : ''}" aria-pressed="${layer === l.id}">${l.name}</button>`).join('')}</div>
  <div class="map-wrap"><canvas id="map" aria-label="Country map. Click a mapxel or drag to select an area. Use the region menu for keyboard selection."></canvas><div id="map-tooltip" role="tooltip"></div><div class="map-tools"><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-reset" aria-label="Reset zoom">⌖</button></div><div class="map-badge"><span class="live-dot"></span> ${running ? 'Country evolving' : 'Time is paused'}</div></div>
  <div class="map-footer"><span>${layer !== 'terrain' && layer !== 'industry' ? `<i class="legend-gradient ${layer === 'crime' || layer === 'pollution' ? 'warm' : ''}"></i>` : '<span class="legend-dots">● ● ●</span>'} ${LAYERS.find(l => l.id === layer)!.low} <span class="legend-high">${LAYERS.find(l => l.id === layer)!.high}</span></span><label><input type="checkbox" id="roads" ${roads ? 'checked' : ''}/> Neighbor links</label></div></div>
  <aside class="panel inspector">${inspector()}</aside></section>
  <section class="panel desk"><div class="desk-tabs" role="tablist" aria-label="Government desk">${([['cabinet', 'The cabinet'], ['ledger', 'The daily ledger'], ['trends', 'National accounts'], ['rules', 'How the country works']] as const).map(([id, name]) => `<button role="tab" aria-selected="${tab === id}" class="${tab === id ? 'active' : ''}" data-tab="${id}">${name}${id === 'ledger' ? `<span class="count">${game.articles.length}</span>` : ''}</button>`).join('')}<span class="desk-note">${tab === 'cabinet' ? 'Small decisions. Long consequences.' : 'Every number has a neighborhood.'}</span></div><div class="desk-content" role="tabpanel">${tab === 'cabinet' ? cabinet() : tab === 'ledger' ? ledger() : tab === 'trends' ? trends() : rulesView()}</div></section>
  <footer><span>${logo} COMMONWEALTH <span class="subtle">/</span> A political simulation</span><span>Seed: ${esc(m.seed)} <span class="subtle">·</span> ${saveFailed ? 'Export to save progress' : 'Progress saves automatically'} <span class="save-dot"></span></span></footer></main>`;
  bind();
  destroyMap = attachMap(document.getElementById('map') as HTMLCanvasElement, { game, selected, layer, zoom, roads, onSelect: setSelection });
}
function inspector(): string {
  const ids = [...selected], s = summarize(game.model, ids.length ? ids : undefined);
  const c = ids.length === 1 ? game.model.cells[ids[0]] : undefined;
  const cells = ids.length ? ids.map(id => game.model.cells[id]) : game.model.cells.filter(c => c.population > 0);
  const mean = (key: 'agriculture' | 'manufacturing' | 'services' | 'sports') => cells.reduce((a, c) => a + c[key] * c.population, 0) / Math.max(1, s.population);
  const latest = game.causes.filter(cause => !ids.length || cause.cells.some(id => selected.has(id))).slice(-1)[0];
  return `<div class="inspector-head"><span class="eyebrow">${ids.length ? 'LOCAL INTELLIGENCE' : 'THE NATIONAL PICTURE'}</span>${ids.length ? '<button id="clear-selection" class="text-button">Clear ×</button>' : '<span class="tiny-seal">◎</span>'}</div><h2>${c ? esc(c.name) : ids.length ? `${ids.length} mapxels selected` : 'Many places. One country.'}</h2><p class="muted inspector-description">${c ? `${esc(game.model.regions[c.region])} · ${label(c.biome)} · Mapxel ${c.id}` : ids.length ? 'Population-weighted conditions across your selected area.' : 'Click a mapxel to meet a neighborhood, or drag across the map to inspect a region.'}</p>
  <div class="selection-stat"><strong>${num(s.population)}</strong><span>residents${c ? ` · ${pct(c.children)} children · ${pct(c.seniors)} seniors` : ''}</span></div>
  <div class="inspector-grid">${[['Approval', pct(s.approval)], ['Wellbeing', pct(s.happiness)], ['Reserves / person', `₡${s.wealth.toFixed(1)}`], ['Employment', pct(s.employment)], ['Food needs met', pct(s.foodSecurity)], ['Crime pressure', pct(s.crime)]].map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join('')}</div>
  <div class="industry-heading"><span class="eyebrow">HOW PEOPLE MAKE A LIVING</span></div><div class="industry-bar">${SECTORS.map(k => `<span style="width:${mean(k) * 100}%;background:${SECTOR_COLORS[k]}" title="${k}: ${pct(mean(k))}"></span>`).join('')}</div><div class="industry-key">${SECTORS.map(k => `<span><i style="background:${SECTOR_COLORS[k]}"></i>${label(k)} <b>${pct(mean(k))}</b></span>`).join('')}</div>
  ${c ? `<details class="local-details"><summary>Resources & living conditions</summary><div class="inspector-grid">${[['Fertility', pct(c.fertility)], ['Minerals', pct(c.minerals)], ['Health', pct(c.health)], ['Education', pct(c.education)], ['Transport', pct(c.infrastructure)], ['Pollution', pct(c.pollution)], ['Food stored', `${(c.food / c.population).toFixed(1)} months`], ['Net food trade', `${c.foodTraded > 0 ? '+' : ''}${num(c.foodTraded)} units`], ['Food price', `₡${c.price.toFixed(2)}`], ['Sports interest', pct(c.sportsInterest)]].map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join('')}</div></details>` : ''}
  <div class="field-note"><span class="eyebrow">${latest ? 'A RECENT CONSEQUENCE' : 'YOUR FIRST FIELD NOTE'}</span><p>${latest ? esc(latest.title) : 'A prosperous neighbor can be an opportunity, a trading partner, or a source of resentment. Geography matters.'}</p>${latest ? `<button class="text-button" data-cause="${esc(latest.id)}">Follow the story <span>↗</span></button>` : '<span class="muted">The country evolves one month at a time.</span>'}</div>`;
}
function cabinet(): string {
  const p = game.model.policy, f = forecastBudget(game.model);
  return `<div class="cabinet-layout"><div class="cabinet-main"><div class="section-intro"><div><span class="eyebrow">THE TOOLS OF GOVERNMENT</span><h2>What will you set in motion?</h2></div><div class="segmented">${(['budget', 'development', 'laws', 'console'] as const).map(id => `<button data-policy-tab="${id}" class="${policyTab === id ? 'active' : ''}">${label(id)}</button>`).join('')}</div></div>
  ${policyTab === 'budget' ? `<div class="policy-grid"><form id="tax-form" class="policy-card"><span class="card-icon">%</span><h3>Raise the revenue</h3><p>Taxes fund public life and reduce private reserves.</p><label>Income tax <output id="income-value">${pct(p.incomeTax)}</output><input name="income" id="income-tax" type="range" min="0" max="65" value="${p.incomeTax * 100}"/></label><label>Business tax <output id="business-value">${pct(p.businessTax)}</output><input name="business" id="business-tax" type="range" min="0" max="65" value="${p.businessTax * 100}"/></label><button class="outline" ${game.ended ? 'disabled' : ''}>Review tax changes →</button></form>
  <form id="spending-form" class="policy-card"><span class="card-icon">↗</span><h3>Fund the everyday</h3><p>Health, schools, safe streets. Promises need a budget.</p><label>Public service<select name="service" id="service-select">${SERVICES.map(k => `<option value="${k}">${label(k)}</option>`).join('')}</select></label><label>₡ per resident / month<input name="amount" id="service-amount" type="number" min="0" max="2" step="0.01" value="${p.spending.health}" required/></label><button class="outline" ${game.ended ? 'disabled' : ''}>Review spending →</button></form></div>` : ''}
  ${policyTab === 'development' ? `<div class="policy-grid"><form id="subsidy-form" class="policy-card"><span class="card-icon">♧</span><h3>Give an industry a nudge</h3><p>Recurring grants attract workers. Other industries may lose them.</p><label>Industry<select name="sector" id="subsidy-sector">${SECTORS.map(k => `<option value="${k}">${label(k)}</option>`).join('')}</select></label><div class="input-pair"><label>₡ / worker / month<input name="amount" type="number" min="0" max="3" step="0.05" value="0.50" required/></label><label>Where<select name="scope">${scopeOptions()}</select></label></div><button class="outline" ${game.ended ? 'disabled' : ''}>Review subsidy →</button><small>National grants replace local grants for that industry. Set zero to remove support.</small></form>
  <form id="invest-form" class="policy-card"><span class="card-icon">⌂</span><h3>Build something lasting</h3><p>A one-time improvement, paid from the treasury. Upkeep still matters.</p><label>Project<select name="project"><option value="transport">Transport links</option><option value="hospital">Local hospitals</option><option value="school">Schools & training</option><option value="stadium">Community stadiums</option></select></label><div class="input-pair"><label>Total investment (₡)<input name="amount" type="number" min="1" step="100" value="10000" required/></label><label>Where<select name="scope">${scopeOptions()}</select></label></div><button class="outline" ${game.ended ? 'disabled' : ''}>Review investment →</button></form></div>` : ''}
  ${policyTab === 'laws' ? `<div class="law-list">${LAWS.map(l => { const info = { cleanAir: ['Clean Air Act', 'Lower industrial pollution, with a small manufacturing output cost.'], freeMovement: ['Freedom of movement', 'Allow residents to move toward nearby work and better living conditions.'], publicAssembly: ['Freedom of assembly', 'Protect civic life and public morale. Repeal carries a lasting wellbeing and approval cost.'] }[l]; return `<div class="law"><div><h3>${info[0]} <span class="status-pill ${p.laws[l] ? 'on' : ''}">${p.laws[l] ? 'In force' : 'Not in force'}</span></h3><p>${info[1]}</p></div><button class="outline" data-law="${l}" ${game.ended ? 'disabled' : ''}>${p.laws[l] ? 'Review repeal' : 'Review enactment'} →</button></div>`; }).join('')}</div>` : ''}
  ${policyTab === 'console' ? `<form id="console-form" class="console-form"><p>Write a precise command, or submit a JSON action package. Every command is validated and previewed before enactment.</p><label for="command">Government command</label><textarea id="command" name="command" rows="4" spellcheck="false" placeholder="subsidize sports 1.5 in selected" required></textarea><div class="console-actions"><code>tax income 0.25</code><code>spend police 0.35</code><code>law cleanAir on</code><button class="primary" ${game.ended ? 'disabled' : ''}>Preview command →</button></div><details><summary>Command reference</summary><pre>tax income|business RATE               # 0–0.65
spend SERVICE AMOUNT                   # 0–2 per resident
subsidize SECTOR AMOUNT in SCOPE        # 0–3 per worker
invest transport|hospital|school|stadium AMOUNT in SCOPE
law cleanAir|freeMovement|publicAssembly on|off

SCOPE: national | selected | region 0 (through 3)
JSON example:
[{"type":"tax","tax":"incomeTax","rate":0.25},
 {"type":"spending","service":"health","amount":0.4}]</pre></details></form>` : ''}</div>
  <aside class="budget-note"><span class="eyebrow">THE PUBLIC PURSE</span><h3>Every promise has a price.</h3><dl><div><dt>Projected revenue</dt><dd>${money(f.revenue)}</dd></div><div><dt>Public spending</dt><dd>${money(f.spending)}</dd></div><div><dt>Debt interest</dt><dd>${money(f.interest)}</dd></div><div class="budget-total"><dt>Monthly balance</dt><dd class="${f.balance < 0 ? 'negative' : 'positive'}">${f.balance > 0 ? '+' : ''}${money(f.balance)}</dd></div></dl><p>${game.model.tick === 0 ? 'Projections use current output. They will change as households and businesses respond.' : `Last month: ${money(game.model.budget.revenue)} collected, ${money(game.model.budget.spending)} spent. ${pct(game.model.budget.funding)} of services funded.`}</p><div class="debt-line">Public debt <strong>${money(game.model.debt)}</strong></div><details><summary>Current allocations</summary><dl>${SERVICES.map(k => `<div><dt>${label(k)}</dt><dd>₡${p.spending[k].toFixed(2)}</dd></div>`).join('')}${SECTORS.map(k => `<div><dt>${label(k)} grant</dt><dd>₡${p.subsidies[k].toFixed(2)}</dd></div>`).join('')}</dl><p>${game.model.localSubsidies.length} local grant overrides in effect.</p></details>${selected.size === 1 ? `<p>Selected mapxel grants: ${SECTORS.map(k => `${k} ₡${subsidyFor(game.model, game.model.cells[[...selected][0]], k).toFixed(2)}`).join(' · ')}</p>` : ''}</aside></div>`;
}
function scopeOptions(): string { return `<option value="national">Whole country</option><option value="selected" ${selected.size ? 'selected' : 'disabled'}>Selected (${selected.size})</option>${game.model.regions.map((r, i) => `<option value="${i}">${esc(r)}</option>`).join('')}`; }
function getScope(value: string): Scope { return value === 'national' ? { kind: 'national' } : value === 'selected' ? { kind: 'cells', ids: [...selected].sort((a, b) => a - b) } : { kind: 'region', id: Number(value) }; }
function ledger(): string {
  const articles = game.articles.filter(a => feedFilter === 'all' || a.category === feedFilter);
  return `<div class="ledger-heading"><div><span class="eyebrow">INDEPENDENT VOICES. A SHARED STORY.</span><h2>The Commonwealth Ledger</h2><p>Reports from the places behind the numbers.</p></div><select id="feed-filter" aria-label="Filter news">${['all', 'dispatch', 'economy', 'politics', 'culture', 'briefing'].map(v => `<option value="${v}" ${feedFilter === v ? 'selected' : ''}>${v === 'all' ? 'All stories' : label(v)}</option>`).join('')}</select></div><div class="news-grid">${articles.length ? articles.slice(0, 60).map(a => `<article class="news-card"><div class="article-meta"><span class="category ${a.tone}">${a.category}</span><time>${month(a.tick)}</time></div><h3>${esc(a.headline)}</h3><p>${esc(a.body)}</p><div class="byline">${esc(a.voice)}</div><div class="news-actions">${a.causeIds.length ? `<button class="text-button" data-story="${esc(a.id)}">Follow the causes ↗</button>` : '<span class="muted">Your story is just beginning.</span>'}${a.cell !== undefined ? `<button class="text-button" data-place="${a.cell}">Locate on map ⌖</button>` : ''}</div></article>`).join('') : '<p class="empty">No reports in this section yet. Advance the country a few months.</p>'}</div><p class="small muted">Dispatches use predefined text grounded in simulation events. Voices are fictional. ${articles.length > 60 ? `Showing the 60 latest of ${articles.length} reports; the complete archive is retained in your save.` : ''}</p>`;
}
function trends(): string {
  const s = summarize(game.model);
  const charts: [Metric, string, boolean][] = [['approval', 'Public approval', true], ['happiness', 'Household wellbeing', true], ['foodSecurity', 'Food needs met', true], ['crime', 'Crime pressure', true], ['wealth', 'Private reserves / person', false], ['output', 'Monthly economic output', false]];
  return `<div class="section-intro"><div><span class="eyebrow">A COUNTRY OVER TIME</span><h2>The national accounts</h2><p>Population-weighted living conditions, measured every month.</p></div><button class="outline" id="export-data">Export monthly data ↓</button></div><div class="trend-grid">${charts.map(([metric, name, percent]) => `<div class="trend-card"><span class="eyebrow">${name}</span><strong>${percent ? pct(s[metric]) : money(s[metric])}</strong>${sparkline(metric, metric === 'crime' ? '#b38368' : '#39755d', 350, 90)}<div class="chart-axis"><span>${month(0)}</span><span>${month(game.model.tick)}</span></div><small>Range: ${percent ? pct(Math.min(...game.history.map(h => h.summary[metric]))) : money(Math.min(...game.history.map(h => h.summary[metric])))} – ${percent ? pct(Math.max(...game.history.map(h => h.summary[metric]))) : money(Math.max(...game.history.map(h => h.summary[metric])))}</small></div>`).join('')}</div>`;
}
function rulesView(): string { return `<div class="section-intro"><div><span class="eyebrow">THE COUNTRY BENEATH THE STORIES</span><h2>Simple rules. Interconnected lives.</h2><p>Each month follows this sequence. Local conditions shape what happens next.</p></div></div><div class="rule-grid">${defaultRules.map((r, i) => `<div class="rule-card"><span class="rule-number">${String(i + 1).padStart(2, '0')}</span><div><h3>${label(r.phase)}</h3><p>${r.description}</p></div></div>`).join('')}</div><p class="small muted">Money moves between private, treasury, and external accounts. Food is produced, eaten, traded, or spoiled. Events use seeded probabilities. Indices move gradually toward conditions implied by the rules.</p>`; }

function bind(): void {
  const on = (id: string, event: string, handler: (e: Event) => void) => document.getElementById(id)?.addEventListener(event, handler);
  on('theme-toggle', 'click', () => { setDarkMode(!darkMode); render(); });
  on('advance', 'click', () => { pause(); advance(); });
  on('play', 'click', () => { running = !running; render(); schedule(); });
  on('speed', 'change', e => { speed = Number((e.target as HTMLSelectElement).value); schedule(); });
  on('region', 'change', e => { const value = (e.target as HTMLSelectElement).value; if (value !== '') setSelection(scopeCells(game.model, { kind: 'region', id: Number(value) })); });
  on('clear-selection', 'click', () => setSelection([]));
  on('roads', 'change', e => { roads = (e.target as HTMLInputElement).checked; render(); });
  on('zoom-in', 'click', () => { zoom = Math.min(2, zoom + .2); render(); });
  on('zoom-out', 'click', () => { zoom = Math.max(.6, zoom - .2); render(); });
  on('zoom-reset', 'click', () => { zoom = 1; render(); });
  document.querySelectorAll<HTMLElement>('[data-layer]').forEach(b => b.onclick = () => { layer = b.dataset.layer as Layer; render(); });
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab as typeof tab; render(); });
  document.querySelectorAll<HTMLElement>('[data-policy-tab]').forEach(b => b.onclick = () => { policyTab = b.dataset.policyTab as typeof policyTab; render(); });
  document.querySelectorAll<HTMLElement>('[data-cause]').forEach(b => b.onclick = () => showCauses([b.dataset.cause!]));
  document.querySelectorAll<HTMLElement>('[data-story]').forEach(b => b.onclick = () => showCauses(game.articles.find(a => a.id === b.dataset.story)!.causeIds));
  document.querySelectorAll<HTMLElement>('[data-place]').forEach(b => b.onclick = () => { setSelection([Number(b.dataset.place)]); document.querySelector('.workspace')!.scrollIntoView({ behavior: 'smooth' }); });
  document.querySelectorAll<HTMLElement>('[data-law]').forEach(b => b.onclick = () => { const law = b.dataset.law as typeof LAWS[number]; preview({ type: 'law', law, enabled: !game.model.policy.laws[law] }); });
  on('feed-filter', 'change', e => { feedFilter = (e.target as HTMLSelectElement).value; render(); });
  on('income-tax', 'input', e => { document.getElementById('income-value')!.textContent = `${(e.target as HTMLInputElement).value}%`; });
  on('business-tax', 'input', e => { document.getElementById('business-value')!.textContent = `${(e.target as HTMLInputElement).value}%`; });
  on('service-select', 'change', e => { (document.getElementById('service-amount') as HTMLInputElement).value = String(game.model.policy.spending[(e.target as HTMLSelectElement).value as typeof SERVICES[number]]); });
  const form = (id: string, action: (data: FormData) => unknown) => on(id, 'submit', e => { e.preventDefault(); try { preview(action(new FormData(e.target as HTMLFormElement))); } catch (err) { toast((err as Error).message, true); } });
  form('tax-form', d => [{ type: 'tax', tax: 'incomeTax', rate: Number(d.get('income')) / 100 }, { type: 'tax', tax: 'businessTax', rate: Number(d.get('business')) / 100 }]);
  form('spending-form', d => ({ type: 'spending', service: d.get('service'), amount: Number(d.get('amount')) }));
  form('subsidy-form', d => ({ type: 'subsidy', sector: d.get('sector'), amount: Number(d.get('amount')), scope: getScope(String(d.get('scope'))) }));
  form('invest-form', d => ({ type: 'invest', project: d.get('project'), amount: Number(d.get('amount')), scope: getScope(String(d.get('scope'))) }));
  form('console-form', d => parseCommand(String(d.get('command')), [...selected]));
  // Editing a policy pauses time, preserving the inputs while the player considers a decision.
  document.querySelectorAll('.cabinet-main input, .cabinet-main select, .cabinet-main textarea').forEach(el => el.addEventListener('focus', () => { if (running) { pause(); const button = document.getElementById('play')!; button.textContent = '▶'; button.setAttribute('aria-label', 'Play simulation'); const badge = document.querySelector('.map-badge'); if (badge) badge.innerHTML = '<span class="live-dot"></span> Time is paused'; } }));
  on('help', 'click', showHelp); on('save-menu', 'click', showSave); on('new-country', 'click', showNew); on('report', 'click', showReport);
  on('export-data', 'click', () => { const keys = Object.keys(game.initial) as (keyof typeof game.initial)[]; download('commonwealth-accounts.csv', ['month,' + keys.join(','), ...game.history.map(h => [h.tick, ...keys.map(k => h.summary[k])].join(','))].join('\n'), 'text/csv'); });
}
function modal(title: string, body: string, wide = false): HTMLDialogElement {
  pause(); const play = document.getElementById('play'); if (play) { play.textContent = '▶'; play.setAttribute('aria-label', 'Play simulation'); }
  document.querySelector('dialog')?.remove();
  const dialog = document.createElement('dialog'); dialog.className = wide ? 'modal wide' : 'modal';
  dialog.innerHTML = `<div class="modal-heading"><div><span class="eyebrow">COMMONWEALTH</span><h2 id="dialog-title">${esc(title)}</h2></div><button class="close-button" aria-label="Close dialog">×</button></div><div class="modal-body">${body}</div>`;
  dialog.setAttribute('aria-labelledby', 'dialog-title'); document.body.append(dialog);
  dialog.querySelector('.close-button')!.addEventListener('click', () => dialog.close()); dialog.addEventListener('close', () => { dialog.remove(); render(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); const p = e as MouseEvent; if (p.clientX < r.left || p.clientX > r.right || p.clientY < r.top || p.clientY > r.bottom) dialog.close(); } });
  dialog.showModal(); return dialog;
}
function preview(input: unknown): void {
  try {
    const p = previewActions(game, input); pending = p.actions;
    const dialog = modal('A decision, before it becomes a story.', `<p>These measures take effect immediately. Economic and social responses unfold as the months pass.</p><ul class="preview-list">${p.descriptions.map(d => `<li>${esc(d)}</li>`).join('')}</ul><div class="preview-cost"><span>Estimated monthly balance change<strong class="${p.monthlyChange < 0 ? 'negative' : 'positive'}">${p.monthlyChange >= 0 ? '+' : ''}${money(p.monthlyChange)}</strong></span><span>One-time treasury cost<strong>${money(p.upfront)}</strong></span></div>${p.warnings.map(w => `<p class="warning-note">${esc(w)}</p>`).join('')}<p class="small muted">This is an estimate at current output and employment. Secondary effects can change the eventual cost.</p><div class="modal-actions"><button class="outline" id="cancel-policy">Keep considering</button><button class="primary" id="enact">Enact ${p.actions.length > 1 ? 'measures' : 'measure'} →</button></div>`);
    dialog.querySelector('#cancel-policy')!.addEventListener('click', () => dialog.close());
    dialog.querySelector('#enact')!.addEventListener('click', () => { try { game = enact(game, pending); pending = undefined; save(); dialog.close(); render(); toast('Policy enacted. Advance a month to see the first effects.'); } catch (e) { toast((e as Error).message, true); } });
  } catch (e) { toast((e as Error).message, true); }
}
function causeMarkup(ids: string[]): string {
  const chain = traceCauses(game, ids, 60);
  return chain.length ? `<ol class="causal-chain">${chain.map(c => `<li><div class="cause-meta">${month(c.tick)} <span>· ${esc(c.rule === 'government' ? 'Your decision' : c.rule)}</span></div><h3>${esc(c.title)}</h3><p>${esc(c.detail)}</p>${c.observations.length ? `<details><summary>Observed inputs (${c.observations.length})</summary><dl>${c.observations.slice(0, 12).map(o => `<div><dt>${esc(o.label)}${o.cell !== undefined ? ` · #${o.cell}` : ''}</dt><dd>${o.value.toFixed(3)}</dd></div>`).join('')}</dl></details>` : ''}<small class="muted">Record ${esc(c.id)}${c.parents.length ? ` · linked to ${c.parents.map(esc).join(', ')}` : ' · no earlier recorded contributor'}</small></li>`).join('')}</ol>` : '<p>No contributing changes have been recorded yet.</p>';
}
function showCauses(ids: string[]): void { modal('Follow the consequences', `<p>Recorded contributing factors, ordered from earlier causes to later effects. This trace is selective: it shows significant recorded changes, and does not prove that any one factor alone caused an outcome.</p>${causeMarkup(ids)}`, true); }
function showReport(): void {
  const r = mandateReport(game);
  const format = (n: number, unit: string) => unit === 'percent' ? pct(n) : unit === 'money' ? money(n) : num(n);
  const dialog = modal(r.title, `<div class="report-intro"><span class="eyebrow">${month(0)} — ${month(game.model.tick)} · THE MANDATE IN RETROSPECT</span><h3>${r.verdict}</h3><p>${r.opening}</p></div><div class="report-voices">${r.voices.map(v => `<blockquote><span class="eyebrow">${v.who}</span><p>${v.text}</p><cite>${v.metric}</cite></blockquote>`).join('')}</div><h3>The record you leave</h3><div class="report-changes">${r.changes.map(c => `<div><span>${c.label}</span><strong>${format(c.before, c.unit)} <span>→</span> ${format(c.after, c.unit)}</strong></div>`).join('')}</div>${r.chains.length ? `<h3>The long threads</h3>${r.chains.map(c => `<details class="report-chain"><summary>${esc(c.title)}</summary>${causeMarkup(c.causes.slice(-3).map(c => c.id))}</details>`).join('')}` : ''}<h3>What made the papers</h3>${r.moments.length ? r.moments.map(a => `<div class="report-moment"><span class="eyebrow">${month(a.tick)} · ${a.category}</span><h4>${esc(a.headline)}</h4><p>${esc(a.body)}</p></div>`).join('') : '<p>The mandate passed without a major dispatch. The quieter changes live in the national accounts.</p>'}<p class="small muted">${r.closing}</p><div class="modal-actions"><button id="download-report" class="outline">Export the mandate ↓</button><button id="next-country" class="primary">A new country →</button></div>`, true);
  dialog.querySelector('#download-report')!.addEventListener('click', () => download('commonwealth-mandate.md', reportMarkdown(), 'text/markdown'));
  dialog.querySelector('#next-country')!.addEventListener('click', showNew);
}
function reportMarkdown(): string { const r = mandateReport(game); return `# ${r.title}\n\n${r.verdict}\n\n${r.opening}\n\n${r.voices.map(v => `## ${v.who}\n\n${v.text}\n\n${v.metric}`).join('\n\n')}\n\n## National record\n\n${r.changes.map(c => `- ${c.label}: ${c.before.toFixed(3)} → ${c.after.toFixed(3)} (${c.unit})`).join('\n')}\n\n## The long threads\n\n${r.chains.map(c => `### ${c.title}\n\n${c.causes.map(c => `- ${month(c.tick)}: ${c.title}. ${c.detail} [${c.id}; parents: ${c.parents.join(', ')}]`).join('\n')}`).join('\n\n')}\n\n## Dispatches\n\n${r.moments.map(a => `### ${month(a.tick)}: ${a.headline}\n\n${a.body}`).join('\n\n')}\n\n${r.closing}\n`; }
function showHelp(): void { modal('Your field guide', `<p class="lead">You have 48 months. There is no single winning budget.</p><ol class="guide"><li><strong>Read the country.</strong> Select a mapxel, drag a region, or use the region menu. Change map layers to find unequal conditions. Shift-click adds or removes mapxels.</li><li><strong>Make a decision.</strong> Adjust taxes, fund a service, subsidize an industry, invest locally, or change a law in the cabinet. Review the projected cost, then enact it.</li><li><strong>Give it time.</strong> Advance one month or press play. Effects are gradual. Editing a policy pauses the clock.</li><li><strong>Listen to the stories.</strong> Read the Ledger and follow recorded causes. A popular industry can draw workers away from something the country still needs.</li><li><strong>Face the public memory.</strong> At the end of your mandate, read the account from different communities and export it.</li></ol><div class="field-note"><strong>A first experiment</strong><p>Try a sports subsidy in one region. Watch the industry and food maps over the next year. Can neighboring farms and transport links absorb the change?</p></div><p class="small muted">₡ is the fictional crown. One turn is one month; each mapxel covers about 4 km². Crime, health, and similar measures are abstract indices. World seeds reproduce the same starting conditions and random draws. No AI or API key is needed.</p>`); }
function download(name: string, data: string, type = 'application/json'): void { const url = URL.createObjectURL(new Blob([data], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function showSave(): void {
  const dialog = modal('Keep your country close.', `<p>Progress autosaves in this browser. Export a file to back up your mandate or continue on another device.</p><div class="save-options"><button class="primary" id="export-save">Export save ↓</button><label class="outline upload">Import a save<input id="import-save" type="file" accept="application/json,.json"/></label></div><p class="small muted">Importing replaces the current country after the file has passed validation. Export first if you want to keep both.</p><p id="import-error" role="alert"></p>`);
  dialog.querySelector('#export-save')!.addEventListener('click', () => download(`commonwealth-month-${game.model.tick}.json`, serialize(game)));
  dialog.querySelector('#import-save')!.addEventListener('change', async e => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; try { if (file.size > 40_000_000) throw new Error('Save files must be smaller than 40 MB.'); const loaded = deserialize(await file.text()); game = loaded; selected.clear(); save(); dialog.close(); render(); toast('Your country is restored.'); } catch (err) { dialog.querySelector('#import-error')!.textContent = (err as Error).message; } });
}
function showNew(): void {
  const dialog = modal('Another country. Another possibility.', `<p>A different seed gives you a different landscape. The same seed lets you try a different path through the same starting conditions.</p><form id="new-form"><label>Country seed<input name="seed" maxlength="100" value="${esc(`alder-${Math.floor(Math.random() * 10000)}`)}" required/></label><p class="small muted">Starting a country replaces the current autosave. Export it first if you want to return.</p><div class="modal-actions"><button type="button" id="backup-first" class="outline">Export current country</button><button class="primary">Begin a new mandate →</button></div></form>`);
  dialog.querySelector('#backup-first')!.addEventListener('click', () => download(`commonwealth-month-${game.model.tick}.json`, serialize(game)));
  dialog.querySelector('#new-form')!.addEventListener('submit', e => { e.preventDefault(); try { game = createGame(String(new FormData(e.target as HTMLFormElement).get('seed'))); selected.clear(); layer = 'terrain'; zoom = 1; save(); dialog.close(); render(); toast('Welcome to your new mandate.'); } catch (err) { toast((err as Error).message, true); } });
}
window.addEventListener('keydown', e => { if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement) && !document.querySelector('dialog[open]')) { e.preventDefault(); running = !running && !game.ended; render(); schedule(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden && running) { pause(); render(); } });
app.innerHTML = '<main><h1>Opening the Commonwealth…</h1></main>';
void (async () => {
  let error = '';
  try { const saved = await loadAutosave(); if (saved) game = deserialize(saved); }
  catch { error = 'The autosave could not be loaded. A fresh country is ready; you can import a backup.'; }
  render(); if (error) toast(error, true);
})();
