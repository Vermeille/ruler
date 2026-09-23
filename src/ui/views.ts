import { summarize } from '../sim/math';
import { forecastBudget, subsidyFor } from '../sim/policy';
import { defaultRules } from '../sim/rules';
import { LAWS, SECTORS, SERVICES, type Game, type Metric } from '../sim/types';
import { LAYERS, SECTOR_COLORS, type Layer } from './map';
import {
  escapeHtml,
  formatCompact,
  formatMoney,
  formatMonth,
  formatNumber,
  formatPercent,
  label,
} from './format';

export type DeskTab = 'cabinet' | 'ledger' | 'trends' | 'rules';
export type PolicyTab = 'budget' | 'development' | 'laws' | 'console';

export interface ViewState {
  selected: ReadonlySet<number>;
  layer: Layer;
  roads: boolean;
  tab: DeskTab;
  policyTab: PolicyTab;
  feedFilter: string;
  darkMode: boolean;
  running: boolean;
  speed: number;
  saveFailed: boolean;
}

const LOGO = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 5v22M7 27h18M16 19C3 19 4 8 4 8s10 0 12 11Zm0-6C16 4 25 4 25 4s2 9-9 9Zm0 11c0-9 12-11 12-11s0 11-12 11Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;

const LAW_INFO: Record<(typeof LAWS)[number], readonly [string, string]> = {
  cleanAir: [
    'Clean Air Act',
    'Lower industrial pollution, with a small manufacturing output cost.',
  ],
  freeMovement: [
    'Freedom of movement',
    'Allow residents to move toward nearby work and better living conditions.',
  ],
  publicAssembly: [
    'Freedom of assembly',
    'Protect civic life and public morale. Repeal carries a lasting wellbeing and approval cost.',
  ],
};

const TREND_CHARTS: readonly [Metric, string, boolean][] = [
  ['approval', 'Public approval', true],
  ['happiness', 'Household wellbeing', true],
  ['foodSecurity', 'Food needs met', true],
  ['crime', 'Crime pressure', true],
  ['wealth', 'Private reserves / person', false],
  ['output', 'Monthly economic output', false],
];

function sparkline(
  game: Game,
  metric: Metric,
  color = '#39755d',
  width = 90,
  height = 26,
): string {
  const values = game.history.map(entry => entry.summary[metric]);
  if (values.length === 1) values.push(values[0]);

  const low = Math.min(...values) * 0.98;
  const high = Math.max(...values) * 1.02 + 0.0001;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - 3 - ((value - low) / (high - low)) * (height - 6);
      return `${x},${y}`;
    })
    .join(' ');

  return `<svg viewBox="0 0 ${width} ${height}" aria-label="${escapeHtml(metric)} trend" role="img"><polyline fill="none" stroke="${color}" stroke-width="1.8" points="${points}"/></svg>`;
}

function metricCard(
  game: Game,
  name: string,
  value: string,
  detail: string,
  metric?: Metric,
): string {
  const visual = metric
    ? sparkline(game, metric)
    : '<span class="currency-seal">₡</span>';

  return `<div class="metric"><span class="eyebrow">${name}</span><div class="metric-main"><strong>${value}</strong>${visual}</div><span class="metric-note">${detail}</span></div>`;
}

function currentLayer(layer: Layer) {
  return LAYERS.find(candidate => candidate.id === layer)!;
}

function renderHeader(game: Game, state: ViewState): string {
  const model = game.model;
  return `
    <header class="masthead">
      <a class="brand" href="#" aria-label="Commonwealth home">${LOGO}<span>Commonwealth<small>A COUNTRY OF SMALL DECISIONS</small></span></a>
      <div class="mandate-info"><span class="live-dot"></span><span>${game.ended ? 'Mandate complete' : 'Your first mandate'}<small>${formatMonth(0)} — ${formatMonth(model.mandate)}</small></span></div>
      <div class="header-actions">
        <button class="quiet" id="theme-toggle" aria-pressed="${state.darkMode}" aria-label="Switch to ${state.darkMode ? 'light' : 'dark'} mode">${state.darkMode ? '☀ Light mode' : '☾ Dark mode'}</button>
        <button class="quiet" id="help">Field guide</button>
        <button class="quiet" id="save-menu">Save & load</button>
        <button class="outline" id="new-country">New country <span>↗</span></button>
      </div>
    </header>`;
}

function renderPageHeading(game: Game, state: ViewState): string {
  const model = game.model;
  return `
    <section class="page-heading">
      <div>
        <div class="eyebrow">THE COMMONWEALTH · OFFICE OF THE PRIME MINISTER</div>
        <h1>A country in your hands.</h1>
        <p>Watch closely. Govern thoughtfully. See what happens.</p>
      </div>
      <div class="time-controls">
        <div class="date"><strong>${formatMonth(model.tick)}</strong><span>${Math.min(model.tick, model.mandate)} of ${model.mandate} months served</span></div>
        <div class="time-buttons">
          <select id="speed" aria-label="Simulation speed">
            <option value="1" ${state.speed === 1 ? 'selected' : ''}>1×</option>
            <option value="3" ${state.speed === 3 ? 'selected' : ''}>3×</option>
            <option value="8" ${state.speed === 8 ? 'selected' : ''}>8×</option>
          </select>
          <button id="play" class="play" ${game.ended ? 'disabled' : ''} aria-label="${state.running ? 'Pause' : 'Play'} simulation">${state.running ? 'Ⅱ' : '▶'}</button>
          <button id="advance" class="primary" ${game.ended ? 'disabled' : ''}>Next month <span>→</span></button>
        </div>
      </div>
    </section>`;
}

function renderMetrics(game: Game): string {
  const model = game.model;
  const summary = summarize(model);
  const forecast = forecastBudget(model);
  const inhabited = model.cells.filter(cell => cell.population > 0).length;
  const forecastSign = forecast.balance >= 0 ? '+' : '−';

  return `
    <section class="metrics" aria-label="National indicators">
      ${metricCard(game, 'PUBLIC APPROVAL', formatPercent(summary.approval), summary.approval >= 0.5 ? 'A majority is with you' : 'Public confidence is fragile', 'approval')}
      ${metricCard(game, 'THE PEOPLE', formatCompact(summary.population), `${formatNumber(inhabited)} inhabited mapxels`, 'population')}
      ${metricCard(game, 'PUBLIC TREASURY', formatMoney(summary.treasury), `${forecastSign}₡${formatCompact(Math.abs(forecast.balance))} projected / month`)}
      ${metricCard(game, 'HOUSEHOLD WELLBEING', formatPercent(summary.happiness), `${formatPercent(summary.employment)} employment`, 'happiness')}
      ${metricCard(game, 'FOOD NEEDS MET', formatPercent(summary.foodSecurity), `${summary.price.toFixed(2)}× food price index`, 'foodSecurity')}
    </section>`;
}

function renderStatusBanner(game: Game): string {
  if (game.ended) {
    return '<div class="end-banner"><span>Your mandate is over. The country has a story to tell.</span><button id="report" class="primary">Read your legacy →</button></div>';
  }
  if (game.model.budget.funding < 0.99) {
    return `<div class="alert-banner">Public services received ${formatPercent(game.model.budget.funding)} of promised funding this month. Review your budget.</div>`;
  }
  return '';
}

function renderMapPanel(game: Game, state: ViewState): string {
  const model = game.model;
  const layer = currentLayer(state.layer);
  const legend = state.layer !== 'terrain' && state.layer !== 'industry'
    ? `<i class="legend-gradient ${state.layer === 'crime' || state.layer === 'pollution' ? 'warm' : ''}"></i>`
    : '<span class="legend-dots">● ● ●</span>';

  return `
    <div class="map-panel panel">
      <div class="panel-heading">
        <div><span class="eyebrow">A LIVING ATLAS</span><h2>The Commonwealth <span class="subtle">/</span> <span class="map-view-title">${layer.name}</span></h2></div>
        <select id="region" aria-label="Select a region"><option value="">Explore a region</option>${model.regions.map((region, index) => `<option value="${index}">${escapeHtml(region)}</option>`).join('')}</select>
      </div>
      <div class="layer-bar" role="group" aria-label="Map layers">${LAYERS.map(candidate => `<button data-layer="${candidate.id}" class="layer ${state.layer === candidate.id ? 'active' : ''}" aria-pressed="${state.layer === candidate.id}">${candidate.name}</button>`).join('')}</div>
      <div class="map-wrap">
        <canvas id="map" aria-label="Country map. Click a mapxel or drag to select an area. Use the region menu for keyboard selection."></canvas>
        <div id="map-tooltip" role="tooltip"></div>
        <div class="map-tools"><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-reset" aria-label="Reset zoom">⌖</button></div>
        <div class="map-badge"><span class="live-dot"></span> ${state.running ? 'Country evolving' : 'Time is paused'}</div>
      </div>
      <div class="map-footer"><span>${legend} ${layer.low} <span class="legend-high">${layer.high}</span></span><label><input type="checkbox" id="roads" ${state.roads ? 'checked' : ''}/> Neighbor links</label></div>
    </div>`;
}

function renderDeskContent(game: Game, state: ViewState): string {
  switch (state.tab) {
    case 'cabinet':
      return renderCabinet(game, state.selected, state.policyTab);
    case 'ledger':
      return renderLedger(game, state.feedFilter);
    case 'trends':
      return renderTrends(game);
    case 'rules':
      return renderRules();
  }
}

function renderDesk(game: Game, state: ViewState): string {
  const tabs: readonly [DeskTab, string][] = [
    ['cabinet', 'The cabinet'],
    ['ledger', 'The daily ledger'],
    ['trends', 'National accounts'],
    ['rules', 'How the country works'],
  ];
  const note = state.tab === 'cabinet'
    ? 'Small decisions. Long consequences.'
    : 'Every number has a neighborhood.';

  return `
    <section class="panel desk">
      <div class="desk-tabs" role="tablist" aria-label="Government desk">
        ${tabs.map(([id, name]) => `<button role="tab" aria-selected="${state.tab === id}" class="${state.tab === id ? 'active' : ''}" data-tab="${id}">${name}${id === 'ledger' ? `<span class="count">${game.articles.length}</span>` : ''}</button>`).join('')}
        <span class="desk-note">${note}</span>
      </div>
      <div class="desk-content" role="tabpanel">${renderDeskContent(game, state)}</div>
    </section>`;
}

function renderFooter(game: Game, saveFailed: boolean): string {
  return `<footer><span>${LOGO} COMMONWEALTH <span class="subtle">/</span> A political simulation</span><span>Seed: ${escapeHtml(game.model.seed)} <span class="subtle">·</span> ${saveFailed ? 'Export to save progress' : 'Progress saves automatically'} <span class="save-dot"></span></span></footer>`;
}

export function renderPage(game: Game, state: ViewState): string {
  return `
    ${renderHeader(game, state)}
    <main>
      ${renderPageHeading(game, state)}
      ${renderMetrics(game)}
      ${renderStatusBanner(game)}
      <section class="workspace">${renderMapPanel(game, state)}<aside class="panel inspector">${renderInspector(game, state.selected)}</aside></section>
      ${renderDesk(game, state)}
      ${renderFooter(game, state.saveFailed)}
    </main>`;
}

export function renderInspector(game: Game, selected: ReadonlySet<number>): string {
  const ids = [...selected];
  const summary = summarize(game.model, ids.length ? ids : undefined);
  const cell = ids.length === 1 ? game.model.cells[ids[0]] : undefined;
  const cells = ids.length
    ? ids.map(id => game.model.cells[id])
    : game.model.cells.filter(candidate => candidate.population > 0);
  const mean = (key: (typeof SECTORS)[number]) =>
    cells.reduce((total, candidate) => total + candidate[key] * candidate.population, 0) /
    Math.max(1, summary.population);
  const latest = game.causes
    .filter(cause => !ids.length || cause.cells.some(id => selected.has(id)))
    .slice(-1)[0];

  const title = cell
    ? escapeHtml(cell.name)
    : ids.length
      ? `${ids.length} mapxels selected`
      : 'Many places. One country.';
  const description = cell
    ? `${escapeHtml(game.model.regions[cell.region])} · ${label(cell.biome)} · Mapxel ${cell.id}`
    : ids.length
      ? 'Population-weighted conditions across your selected area.'
      : 'Click a mapxel to meet a neighborhood, or drag across the map to inspect a region.';

  const localDetails = cell
    ? `<details class="local-details"><summary>Resources & living conditions</summary><div class="inspector-grid">${[
        ['Fertility', formatPercent(cell.fertility)],
        ['Minerals', formatPercent(cell.minerals)],
        ['Health', formatPercent(cell.health)],
        ['Education', formatPercent(cell.education)],
        ['Transport', formatPercent(cell.infrastructure)],
        ['Pollution', formatPercent(cell.pollution)],
        ['Food stored', `${(cell.food / cell.population).toFixed(1)} months`],
        ['Net food trade', `${cell.foodTraded > 0 ? '+' : ''}${formatNumber(cell.foodTraded)} units`],
        ['Food price', `₡${cell.price.toFixed(2)}`],
        ['Sports interest', formatPercent(cell.sportsInterest)],
      ].map(([name, value]) => `<div><span>${name}</span><strong>${value}</strong></div>`).join('')}</div></details>`
    : '';

  return `
    <div class="inspector-head"><span class="eyebrow">${ids.length ? 'LOCAL INTELLIGENCE' : 'THE NATIONAL PICTURE'}</span>${ids.length ? '<button id="clear-selection" class="text-button">Clear ×</button>' : '<span class="tiny-seal">◎</span>'}</div>
    <h2>${title}</h2>
    <p class="muted inspector-description">${description}</p>
    <div class="selection-stat"><strong>${formatNumber(summary.population)}</strong><span>residents${cell ? ` · ${formatPercent(cell.children)} children · ${formatPercent(cell.seniors)} seniors` : ''}</span></div>
    <div class="inspector-grid">${[
      ['Approval', formatPercent(summary.approval)],
      ['Wellbeing', formatPercent(summary.happiness)],
      ['Reserves / person', `₡${summary.wealth.toFixed(1)}`],
      ['Employment', formatPercent(summary.employment)],
      ['Food needs met', formatPercent(summary.foodSecurity)],
      ['Crime pressure', formatPercent(summary.crime)],
    ].map(([name, value]) => `<div><span>${name}</span><strong>${value}</strong></div>`).join('')}</div>
    <div class="industry-heading"><span class="eyebrow">HOW PEOPLE MAKE A LIVING</span></div>
    <div class="industry-bar">${SECTORS.map(key => `<span style="width:${mean(key) * 100}%;background:${SECTOR_COLORS[key]}" title="${key}: ${formatPercent(mean(key))}"></span>`).join('')}</div>
    <div class="industry-key">${SECTORS.map(key => `<span><i style="background:${SECTOR_COLORS[key]}"></i>${label(key)} <b>${formatPercent(mean(key))}</b></span>`).join('')}</div>
    ${localDetails}
    <div class="field-note"><span class="eyebrow">${latest ? 'A RECENT CONSEQUENCE' : 'YOUR FIRST FIELD NOTE'}</span><p>${latest ? escapeHtml(latest.title) : 'A prosperous neighbor can be an opportunity, a trading partner, or a source of resentment. Geography matters.'}</p>${latest ? `<button class="text-button" data-cause="${escapeHtml(latest.id)}">Follow the story <span>↗</span></button>` : '<span class="muted">The country evolves one month at a time.</span>'}</div>`;
}

export function renderScopeOptions(game: Game, selected: ReadonlySet<number>): string {
  return `<option value="national">Whole country</option><option value="selected" ${selected.size ? 'selected' : 'disabled'}>Selected (${selected.size})</option>${game.model.regions.map((region, index) => `<option value="${index}">${escapeHtml(region)}</option>`).join('')}`;
}

export function renderCabinet(
  game: Game,
  selected: ReadonlySet<number>,
  policyTab: PolicyTab,
): string {
  const policy = game.model.policy;
  const forecast = forecastBudget(game.model);
  const tabs: readonly PolicyTab[] = ['budget', 'development', 'laws', 'console'];

  const budget = `
    <div class="policy-grid">
      <form id="tax-form" class="policy-card"><span class="card-icon">%</span><h3>Raise the revenue</h3><p>Taxes fund public life and reduce private reserves.</p><label>Income tax <output id="income-value">${formatPercent(policy.incomeTax)}</output><input name="income" id="income-tax" type="range" min="0" max="65" value="${policy.incomeTax * 100}"/></label><label>Business tax <output id="business-value">${formatPercent(policy.businessTax)}</output><input name="business" id="business-tax" type="range" min="0" max="65" value="${policy.businessTax * 100}"/></label><button class="outline" ${game.ended ? 'disabled' : ''}>Review tax changes →</button></form>
      <form id="spending-form" class="policy-card"><span class="card-icon">↗</span><h3>Fund the everyday</h3><p>Health, schools, safe streets. Promises need a budget.</p><label>Public service<select name="service" id="service-select">${SERVICES.map(key => `<option value="${key}">${label(key)}</option>`).join('')}</select></label><label>₡ per resident / month<input name="amount" id="service-amount" type="number" min="0" max="2" step="0.01" value="${policy.spending.health}" required/></label><button class="outline" ${game.ended ? 'disabled' : ''}>Review spending →</button></form>
    </div>`;

  const development = `
    <div class="policy-grid">
      <form id="subsidy-form" class="policy-card"><span class="card-icon">♧</span><h3>Give an industry a nudge</h3><p>Recurring grants attract workers. Other industries may lose them.</p><label>Industry<select name="sector" id="subsidy-sector">${SECTORS.map(key => `<option value="${key}">${label(key)}</option>`).join('')}</select></label><div class="input-pair"><label>₡ / worker / month<input name="amount" type="number" min="0" max="3" step="0.05" value="0.50" required/></label><label>Where<select name="scope">${renderScopeOptions(game, selected)}</select></label></div><button class="outline" ${game.ended ? 'disabled' : ''}>Review subsidy →</button><small>National grants replace local grants for that industry. Set zero to remove support.</small></form>
      <form id="invest-form" class="policy-card"><span class="card-icon">⌂</span><h3>Build something lasting</h3><p>A one-time improvement, paid from the treasury. Upkeep still matters.</p><label>Project<select name="project"><option value="transport">Transport links</option><option value="hospital">Local hospitals</option><option value="school">Schools & training</option><option value="stadium">Community stadiums</option></select></label><div class="input-pair"><label>Total investment (₡)<input name="amount" type="number" min="1" step="100" value="10000" required/></label><label>Where<select name="scope">${renderScopeOptions(game, selected)}</select></label></div><button class="outline" ${game.ended ? 'disabled' : ''}>Review investment →</button></form>
    </div>`;

  const laws = `<div class="law-list">${LAWS.map(law => {
    const [name, description] = LAW_INFO[law];
    const enabled = policy.laws[law];
    return `<div class="law"><div><h3>${name} <span class="status-pill ${enabled ? 'on' : ''}">${enabled ? 'In force' : 'Not in force'}</span></h3><p>${description}</p></div><button class="outline" data-law="${law}" ${game.ended ? 'disabled' : ''}>${enabled ? 'Review repeal' : 'Review enactment'} →</button></div>`;
  }).join('')}</div>`;

  const console = `<form id="console-form" class="console-form"><p>Write a precise command, or submit a JSON action package. Every command is validated and previewed before enactment.</p><label for="command">Government command</label><textarea id="command" name="command" rows="4" spellcheck="false" placeholder="subsidize sports 1.5 in selected" required></textarea><div class="console-actions"><code>tax income 0.25</code><code>spend police 0.35</code><code>law cleanAir on</code><button class="primary" ${game.ended ? 'disabled' : ''}>Preview command →</button></div><details><summary>Command reference</summary><pre>tax income|business RATE               # 0–0.65
spend SERVICE AMOUNT                   # 0–2 per resident
subsidize SECTOR AMOUNT in SCOPE        # 0–3 per worker
invest transport|hospital|school|stadium AMOUNT in SCOPE
law cleanAir|freeMovement|publicAssembly on|off

SCOPE: national | selected | region 0 (through 3)
JSON example:
[{"type":"tax","tax":"incomeTax","rate":0.25},
 {"type":"spending","service":"health","amount":0.4}]</pre></details></form>`;

  const content = {
    budget,
    development,
    laws,
    console,
  }[policyTab];

  const selectedGrantSummary = selected.size === 1
    ? `<p>Selected mapxel grants: ${SECTORS.map(key => {
        const cell = game.model.cells[[...selected][0]];
        return `${key} ₡${subsidyFor(game.model, cell, key).toFixed(2)}`;
      }).join(' · ')}</p>`
    : '';

  const budgetNarrative = game.model.tick === 0
    ? 'Projections use current output. They will change as households and businesses respond.'
    : `Last month: ${formatMoney(game.model.budget.revenue)} collected, ${formatMoney(game.model.budget.spending)} spent. ${formatPercent(game.model.budget.funding)} of services funded.`;

  return `
    <div class="cabinet-layout">
      <div class="cabinet-main">
        <div class="section-intro"><div><span class="eyebrow">THE TOOLS OF GOVERNMENT</span><h2>What will you set in motion?</h2></div><div class="segmented">${tabs.map(id => `<button data-policy-tab="${id}" class="${policyTab === id ? 'active' : ''}">${label(id)}</button>`).join('')}</div></div>
        ${content}
      </div>
      <aside class="budget-note"><span class="eyebrow">THE PUBLIC PURSE</span><h3>Every promise has a price.</h3><dl><div><dt>Projected revenue</dt><dd>${formatMoney(forecast.revenue)}</dd></div><div><dt>Public spending</dt><dd>${formatMoney(forecast.spending)}</dd></div><div><dt>Debt interest</dt><dd>${formatMoney(forecast.interest)}</dd></div><div class="budget-total"><dt>Monthly balance</dt><dd class="${forecast.balance < 0 ? 'negative' : 'positive'}">${forecast.balance > 0 ? '+' : ''}${formatMoney(forecast.balance)}</dd></div></dl><p>${budgetNarrative}</p><div class="debt-line">Public debt <strong>${formatMoney(game.model.debt)}</strong></div><details><summary>Current allocations</summary><dl>${SERVICES.map(key => `<div><dt>${label(key)}</dt><dd>₡${policy.spending[key].toFixed(2)}</dd></div>`).join('')}${SECTORS.map(key => `<div><dt>${label(key)} grant</dt><dd>₡${policy.subsidies[key].toFixed(2)}</dd></div>`).join('')}</dl><p>${game.model.localSubsidies.length} local grant overrides in effect.</p></details>${selectedGrantSummary}</aside>
    </div>`;
}

export function renderLedger(game: Game, feedFilter: string): string {
  const articles = game.articles.filter(
    article => feedFilter === 'all' || article.category === feedFilter,
  );
  const filters = ['all', 'dispatch', 'economy', 'politics', 'culture', 'briefing'];

  const cards = articles.length
    ? articles.slice(0, 60).map(article => `
        <article class="news-card">
          <div class="article-meta"><span class="category ${article.tone}">${article.category}</span><time>${formatMonth(article.tick)}</time></div>
          <h3>${escapeHtml(article.headline)}</h3>
          <p>${escapeHtml(article.body)}</p>
          <div class="byline">${escapeHtml(article.voice)}</div>
          <div class="news-actions">${article.causeIds.length ? `<button class="text-button" data-story="${escapeHtml(article.id)}">Follow the causes ↗</button>` : '<span class="muted">Your story is just beginning.</span>'}${article.cell !== undefined ? `<button class="text-button" data-place="${article.cell}">Locate on map ⌖</button>` : ''}</div>
        </article>`).join('')
    : '<p class="empty">No reports in this section yet. Advance the country a few months.</p>';

  return `
    <div class="ledger-heading"><div><span class="eyebrow">INDEPENDENT VOICES. A SHARED STORY.</span><h2>The Commonwealth Ledger</h2><p>Reports from the places behind the numbers.</p></div><select id="feed-filter" aria-label="Filter news">${filters.map(value => `<option value="${value}" ${feedFilter === value ? 'selected' : ''}>${value === 'all' ? 'All stories' : label(value)}</option>`).join('')}</select></div>
    <div class="news-grid">${cards}</div>
    <p class="small muted">Dispatches use predefined text grounded in simulation events. Voices are fictional. ${articles.length > 60 ? `Showing the 60 latest of ${articles.length} reports; the complete archive is retained in your save.` : ''}</p>`;
}

export function renderTrends(game: Game): string {
  const summary = summarize(game.model);

  return `
    <div class="section-intro"><div><span class="eyebrow">A COUNTRY OVER TIME</span><h2>The national accounts</h2><p>Population-weighted living conditions, measured every month.</p></div><button class="outline" id="export-data">Export monthly data ↓</button></div>
    <div class="trend-grid">${TREND_CHARTS.map(([metric, name, percent]) => {
      const values = game.history.map(entry => entry.summary[metric]);
      const display = percent ? formatPercent(summary[metric]) : formatMoney(summary[metric]);
      const minimum = percent ? formatPercent(Math.min(...values)) : formatMoney(Math.min(...values));
      const maximum = percent ? formatPercent(Math.max(...values)) : formatMoney(Math.max(...values));
      return `<div class="trend-card"><span class="eyebrow">${name}</span><strong>${display}</strong>${sparkline(game, metric, metric === 'crime' ? '#b38368' : '#39755d', 350, 90)}<div class="chart-axis"><span>${formatMonth(0)}</span><span>${formatMonth(game.model.tick)}</span></div><small>Range: ${minimum} – ${maximum}</small></div>`;
    }).join('')}</div>`;
}

export function renderRules(): string {
  return `
    <div class="section-intro"><div><span class="eyebrow">THE COUNTRY BENEATH THE STORIES</span><h2>Simple rules. Interconnected lives.</h2><p>Each month follows this sequence. Local conditions shape what happens next.</p></div></div>
    <div class="rule-grid">${defaultRules.map((rule, index) => `<div class="rule-card"><span class="rule-number">${String(index + 1).padStart(2, '0')}</span><div><h3>${label(rule.phase)}</h3><p>${rule.description}</p></div></div>`).join('')}</div>
    <p class="small muted">Money moves between private, treasury, and external accounts. Food is produced, eaten, traded, or spoiled. Events use seeded probabilities. Indices move gradually toward conditions implied by the rules.</p>`;
}
