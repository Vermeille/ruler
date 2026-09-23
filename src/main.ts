import './style.css';
import { createGame } from './sim/world';
import { step } from './sim/engine';
import {
  enact,
  parseCommand,
  previewActions,
  scopeCells,
} from './sim/policy';
import { mandateReport, traceCauses } from './sim/narrative';
import { deserialize, serialize } from './sim/save';
import {
  LAWS,
  SERVICES,
  type Game,
  type Scope,
} from './sim/types';
import { attachMap, type Layer } from './ui/map';
import { loadAutosave, storeAutosave } from './ui/storage';
import {
  escapeHtml,
  formatMoney,
  formatMonth,
  formatNumber,
  formatPercent,
} from './ui/format';
import {
  renderPage,
  type DeskTab,
  type PolicyTab,
  type ViewState,
} from './ui/views';

const app = document.getElementById('app')!;

let game: Game = createGame();
let selected = new Set<number>();
let layer: Layer = 'terrain';
let zoom = 1;
let roads = false;
let tab: DeskTab = 'cabinet';
let policyTab: PolicyTab = 'budget';
let feedFilter = 'all';
let running = false;
let speed = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
let destroyMap: (() => void) | undefined;
let pending: unknown;
let saveFailed = false;
let darkMode = localStorage.getItem('commonwealth-theme') === 'dark';

function currentViewState(): ViewState {
  return {
    selected,
    layer,
    roads,
    tab,
    policyTab,
    feedFilter,
    darkMode,
    running,
    speed,
    saveFailed,
  };
}

function setDarkMode(enabled: boolean): void {
  darkMode = enabled;
  document.body.classList.toggle('dark-mode', enabled);
  document.documentElement.style.colorScheme = enabled ? 'dark' : 'light';
  localStorage.setItem('commonwealth-theme', enabled ? 'dark' : 'light');
}

setDarkMode(darkMode);

function save(): void {
  const text = serialize(game);
  void storeAutosave(text)
    .then(() => {
      saveFailed = false;
    })
    .catch(() => {
      if (!saveFailed) {
        toast(
          'Autosave is unavailable. Export a save to keep this mandate.',
          true,
        );
      }
      saveFailed = true;
    });
}

function toast(text: string, error = false): void {
  let element = document.getElementById('toast');
  if (!element) {
    element = document.createElement('div');
    element.id = 'toast';
    element.setAttribute('role', 'status');
    document.body.append(element);
  }

  element.className = error ? 'toast error' : 'toast';
  element.textContent = text;
  element.hidden = false;

  setTimeout(() => {
    if (element?.textContent === text) element.hidden = true;
  }, 6000);
}

function pause(): void {
  running = false;
  clearTimeout(timer);
}

function advance(): void {
  if (game.ended) return;

  try {
    game = step(game);
    save();
    render();

    if (game.ended) {
      pause();
      showReport();
    }
  } catch (error) {
    pause();
    toast(`The month was rolled back: ${(error as Error).message}`, true);
    render();
  }
}

function schedule(): void {
  clearTimeout(timer);
  if (!running || game.ended) return;

  timer = setTimeout(() => {
    advance();
    schedule();
  }, 1200 / speed);
}

function setSelection(ids: number[], additive = false): void {
  if (!additive) {
    selected = new Set(ids);
  } else {
    for (const id of ids) {
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
    }
  }

  render();
}

function render(): void {
  destroyMap?.();
  app.innerHTML = renderPage(game, currentViewState());
  bind();

  destroyMap = attachMap(
    document.getElementById('map') as HTMLCanvasElement,
    {
      game,
      selected,
      layer,
      zoom,
      roads,
      onSelect: setSelection,
    },
  );
}

function getScope(value: string): Scope {
  if (value === 'national') return { kind: 'national' };
  if (value === 'selected') {
    return {
      kind: 'cells',
      ids: [...selected].sort((left, right) => left - right),
    };
  }
  return { kind: 'region', id: Number(value) };
}

function on(
  id: string,
  event: string,
  handler: (event: Event) => void,
): void {
  document.getElementById(id)?.addEventListener(event, handler);
}

function bindSimulationControls(): void {
  on('advance', 'click', () => {
    pause();
    advance();
  });

  on('play', 'click', () => {
    running = !running;
    render();
    schedule();
  });

  on('speed', 'change', event => {
    speed = Number((event.target as HTMLSelectElement).value);
    schedule();
  });
}

function bindMapControls(): void {
  on('region', 'change', event => {
    const value = (event.target as HTMLSelectElement).value;
    if (value === '') return;

    setSelection(
      scopeCells(game.model, { kind: 'region', id: Number(value) }),
    );
  });

  on('clear-selection', 'click', () => setSelection([]));

  on('roads', 'change', event => {
    roads = (event.target as HTMLInputElement).checked;
    render();
  });

  on('zoom-in', 'click', () => {
    zoom = Math.min(2, zoom + 0.2);
    render();
  });

  on('zoom-out', 'click', () => {
    zoom = Math.max(0.6, zoom - 0.2);
    render();
  });

  on('zoom-reset', 'click', () => {
    zoom = 1;
    render();
  });

  document.querySelectorAll<HTMLElement>('[data-layer]').forEach(button => {
    button.onclick = () => {
      layer = button.dataset.layer as Layer;
      render();
    };
  });

  document.querySelectorAll<HTMLElement>('[data-place]').forEach(button => {
    button.onclick = () => {
      setSelection([Number(button.dataset.place)]);
      document
        .querySelector('.workspace')!
        .scrollIntoView({ behavior: 'smooth' });
    };
  });
}

function bindDeskControls(): void {
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach(button => {
    button.onclick = () => {
      tab = button.dataset.tab as DeskTab;
      render();
    };
  });

  document
    .querySelectorAll<HTMLElement>('[data-policy-tab]')
    .forEach(button => {
      button.onclick = () => {
        policyTab = button.dataset.policyTab as PolicyTab;
        render();
      };
    });

  document.querySelectorAll<HTMLElement>('[data-cause]').forEach(button => {
    button.onclick = () => showCauses([button.dataset.cause!]);
  });

  document.querySelectorAll<HTMLElement>('[data-story]').forEach(button => {
    button.onclick = () => {
      const article = game.articles.find(
        candidate => candidate.id === button.dataset.story,
      );
      if (article) showCauses(article.causeIds);
    };
  });

  on('feed-filter', 'change', event => {
    feedFilter = (event.target as HTMLSelectElement).value;
    render();
  });
}

function bindForm(id: string, action: (data: FormData) => unknown): void {
  on(id, 'submit', event => {
    event.preventDefault();
    try {
      preview(action(new FormData(event.target as HTMLFormElement)));
    } catch (error) {
      toast((error as Error).message, true);
    }
  });
}

function bindPolicyForms(): void {
  bindForm('tax-form', data => [
    {
      type: 'tax',
      tax: 'incomeTax',
      rate: Number(data.get('income')) / 100,
    },
    {
      type: 'tax',
      tax: 'businessTax',
      rate: Number(data.get('business')) / 100,
    },
  ]);

  bindForm('spending-form', data => ({
    type: 'spending',
    service: data.get('service'),
    amount: Number(data.get('amount')),
  }));

  bindForm('subsidy-form', data => ({
    type: 'subsidy',
    sector: data.get('sector'),
    amount: Number(data.get('amount')),
    scope: getScope(String(data.get('scope'))),
  }));

  bindForm('invest-form', data => ({
    type: 'invest',
    project: data.get('project'),
    amount: Number(data.get('amount')),
    scope: getScope(String(data.get('scope'))),
  }));

  bindForm('console-form', data =>
    parseCommand(String(data.get('command')), [...selected]),
  );
}

function pauseWhileEditingPolicy(): void {
  document
    .querySelectorAll(
      '.cabinet-main input, .cabinet-main select, .cabinet-main textarea',
    )
    .forEach(element => {
      element.addEventListener('focus', () => {
        if (!running) return;

        pause();
        const playButton = document.getElementById('play');
        if (playButton) {
          playButton.textContent = '▶';
          playButton.setAttribute('aria-label', 'Play simulation');
        }

        const badge = document.querySelector('.map-badge');
        if (badge) {
          badge.innerHTML = '<span class="live-dot"></span> Time is paused';
        }
      });
    });
}

function bindPolicyControls(): void {
  document.querySelectorAll<HTMLElement>('[data-law]').forEach(button => {
    button.onclick = () => {
      const law = button.dataset.law as (typeof LAWS)[number];
      preview({
        type: 'law',
        law,
        enabled: !game.model.policy.laws[law],
      });
    };
  });

  on('income-tax', 'input', event => {
    document.getElementById('income-value')!.textContent =
      `${(event.target as HTMLInputElement).value}%`;
  });

  on('business-tax', 'input', event => {
    document.getElementById('business-value')!.textContent =
      `${(event.target as HTMLInputElement).value}%`;
  });

  on('service-select', 'change', event => {
    const service = (event.target as HTMLSelectElement)
      .value as (typeof SERVICES)[number];
    const amount = document.getElementById(
      'service-amount',
    ) as HTMLInputElement;
    amount.value = String(game.model.policy.spending[service]);
  });

  bindPolicyForms();
  pauseWhileEditingPolicy();
}

function exportAccounts(): void {
  const keys = Object.keys(game.initial) as (keyof typeof game.initial)[];
  const rows = game.history.map(entry =>
    [entry.tick, ...keys.map(key => entry.summary[key])].join(','),
  );

  download(
    'commonwealth-accounts.csv',
    ['month,' + keys.join(','), ...rows].join('\n'),
    'text/csv',
  );
}

function bindUtilityControls(): void {
  on('theme-toggle', 'click', () => {
    setDarkMode(!darkMode);
    render();
  });
  on('help', 'click', showHelp);
  on('save-menu', 'click', showSave);
  on('new-country', 'click', showNew);
  on('report', 'click', showReport);
  on('export-data', 'click', exportAccounts);
}

function bind(): void {
  bindSimulationControls();
  bindMapControls();
  bindDeskControls();
  bindPolicyControls();
  bindUtilityControls();
}

function modal(title: string, body: string, wide = false): HTMLDialogElement {
  pause();

  const playButton = document.getElementById('play');
  if (playButton) {
    playButton.textContent = '▶';
    playButton.setAttribute('aria-label', 'Play simulation');
  }

  document.querySelector('dialog')?.remove();

  const dialog = document.createElement('dialog');
  dialog.className = wide ? 'modal wide' : 'modal';
  dialog.innerHTML = `
    <div class="modal-heading">
      <div><span class="eyebrow">COMMONWEALTH</span><h2 id="dialog-title">${escapeHtml(title)}</h2></div>
      <button class="close-button" aria-label="Close dialog">×</button>
    </div>
    <div class="modal-body">${body}</div>`;
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  document.body.append(dialog);

  dialog
    .querySelector('.close-button')!
    .addEventListener('click', () => dialog.close());

  dialog.addEventListener('close', () => {
    dialog.remove();
    render();
  });

  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;

    const bounds = dialog.getBoundingClientRect();
    const pointer = event as MouseEvent;
    const outside =
      pointer.clientX < bounds.left ||
      pointer.clientX > bounds.right ||
      pointer.clientY < bounds.top ||
      pointer.clientY > bounds.bottom;
    if (outside) dialog.close();
  });

  dialog.showModal();
  return dialog;
}

function preview(input: unknown): void {
  try {
    const result = previewActions(game, input);
    pending = result.actions;

    const descriptions = result.descriptions
      .map(description => `<li>${escapeHtml(description)}</li>`)
      .join('');
    const warnings = result.warnings
      .map(warning => `<p class="warning-note">${escapeHtml(warning)}</p>`)
      .join('');

    const dialog = modal(
      'A decision, before it becomes a story.',
      `<p>These measures take effect immediately. Economic and social responses unfold as the months pass.</p><ul class="preview-list">${descriptions}</ul><div class="preview-cost"><span>Estimated monthly balance change<strong class="${result.monthlyChange < 0 ? 'negative' : 'positive'}">${result.monthlyChange >= 0 ? '+' : ''}${formatMoney(result.monthlyChange)}</strong></span><span>One-time treasury cost<strong>${formatMoney(result.upfront)}</strong></span></div>${warnings}<p class="small muted">This is an estimate at current output and employment. Secondary effects can change the eventual cost.</p><div class="modal-actions"><button class="outline" id="cancel-policy">Keep considering</button><button class="primary" id="enact">Enact ${result.actions.length > 1 ? 'measures' : 'measure'} →</button></div>`,
    );

    dialog
      .querySelector('#cancel-policy')!
      .addEventListener('click', () => dialog.close());

    dialog.querySelector('#enact')!.addEventListener('click', () => {
      try {
        game = enact(game, pending);
        pending = undefined;
        save();
        dialog.close();
        render();
        toast('Policy enacted. Advance a month to see the first effects.');
      } catch (error) {
        toast((error as Error).message, true);
      }
    });
  } catch (error) {
    toast((error as Error).message, true);
  }
}

function causeMarkup(ids: string[]): string {
  const chain = traceCauses(game, ids, 60);
  if (!chain.length) {
    return '<p>No contributing changes have been recorded yet.</p>';
  }

  return `<ol class="causal-chain">${chain.map(cause => {
    const observations = cause.observations.length
      ? `<details><summary>Observed inputs (${cause.observations.length})</summary><dl>${cause.observations.slice(0, 12).map(observation => `<div><dt>${escapeHtml(observation.label)}${observation.cell !== undefined ? ` · #${observation.cell}` : ''}</dt><dd>${observation.value.toFixed(3)}</dd></div>`).join('')}</dl></details>`
      : '';
    const parents = cause.parents.length
      ? ` · linked to ${cause.parents.map(escapeHtml).join(', ')}`
      : ' · no earlier recorded contributor';

    return `<li><div class="cause-meta">${formatMonth(cause.tick)} <span>· ${escapeHtml(cause.rule === 'government' ? 'Your decision' : cause.rule)}</span></div><h3>${escapeHtml(cause.title)}</h3><p>${escapeHtml(cause.detail)}</p>${observations}<small class="muted">Record ${escapeHtml(cause.id)}${parents}</small></li>`;
  }).join('')}</ol>`;
}

function showCauses(ids: string[]): void {
  modal(
    'Follow the consequences',
    `<p>Recorded contributing factors, ordered from earlier causes to later effects. This trace is selective: it shows significant recorded changes, and does not prove that any one factor alone caused an outcome.</p>${causeMarkup(ids)}`,
    true,
  );
}

function formatReportValue(value: number, unit: string): string {
  if (unit === 'percent') return formatPercent(value);
  if (unit === 'money') return formatMoney(value);
  return formatNumber(value);
}

function showReport(): void {
  const report = mandateReport(game);
  const voices = report.voices
    .map(voice => `<blockquote><span class="eyebrow">${voice.who}</span><p>${voice.text}</p><cite>${voice.metric}</cite></blockquote>`)
    .join('');
  const changes = report.changes
    .map(change => `<div><span>${change.label}</span><strong>${formatReportValue(change.before, change.unit)} <span>→</span> ${formatReportValue(change.after, change.unit)}</strong></div>`)
    .join('');
  const chains = report.chains.length
    ? `<h3>The long threads</h3>${report.chains.map(chain => `<details class="report-chain"><summary>${escapeHtml(chain.title)}</summary>${causeMarkup(chain.causes.slice(-3).map(cause => cause.id))}</details>`).join('')}`
    : '';
  const moments = report.moments.length
    ? report.moments.map(article => `<div class="report-moment"><span class="eyebrow">${formatMonth(article.tick)} · ${article.category}</span><h4>${escapeHtml(article.headline)}</h4><p>${escapeHtml(article.body)}</p></div>`).join('')
    : '<p>The mandate passed without a major dispatch. The quieter changes live in the national accounts.</p>';

  const dialog = modal(
    report.title,
    `<div class="report-intro"><span class="eyebrow">${formatMonth(0)} — ${formatMonth(game.model.tick)} · THE MANDATE IN RETROSPECT</span><h3>${report.verdict}</h3><p>${report.opening}</p></div><div class="report-voices">${voices}</div><h3>The record you leave</h3><div class="report-changes">${changes}</div>${chains}<h3>What made the papers</h3>${moments}<p class="small muted">${report.closing}</p><div class="modal-actions"><button id="download-report" class="outline">Export the mandate ↓</button><button id="next-country" class="primary">A new country →</button></div>`,
    true,
  );

  dialog.querySelector('#download-report')!.addEventListener('click', () =>
    download('commonwealth-mandate.md', reportMarkdown(), 'text/markdown'),
  );
  dialog.querySelector('#next-country')!.addEventListener('click', showNew);
}

function reportMarkdown(): string {
  const report = mandateReport(game);
  const voices = report.voices
    .map(voice => `## ${voice.who}\n\n${voice.text}\n\n${voice.metric}`)
    .join('\n\n');
  const changes = report.changes
    .map(change => `- ${change.label}: ${change.before.toFixed(3)} → ${change.after.toFixed(3)} (${change.unit})`)
    .join('\n');
  const chains = report.chains
    .map(chain => `### ${chain.title}\n\n${chain.causes.map(cause => `- ${formatMonth(cause.tick)}: ${cause.title}. ${cause.detail} [${cause.id}; parents: ${cause.parents.join(', ')}]`).join('\n')}`)
    .join('\n\n');
  const dispatches = report.moments
    .map(article => `### ${formatMonth(article.tick)}: ${article.headline}\n\n${article.body}`)
    .join('\n\n');

  return `# ${report.title}\n\n${report.verdict}\n\n${report.opening}\n\n${voices}\n\n## National record\n\n${changes}\n\n## The long threads\n\n${chains}\n\n## Dispatches\n\n${dispatches}\n\n${report.closing}\n`;
}

function showHelp(): void {
  modal(
    'Your field guide',
    `<p class="lead">You have 48 months. There is no single winning budget.</p><ol class="guide"><li><strong>Read the country.</strong> Select a mapxel, drag a region, or use the region menu. Change map layers to find unequal conditions. Shift-click adds or removes mapxels.</li><li><strong>Make a decision.</strong> Adjust taxes, fund a service, subsidize an industry, invest locally, or change a law in the cabinet. Review the projected cost, then enact it.</li><li><strong>Give it time.</strong> Advance one month or press play. Effects are gradual. Editing a policy pauses the clock.</li><li><strong>Listen to the stories.</strong> Read the Ledger and follow recorded causes. A popular industry can draw workers away from something the country still needs.</li><li><strong>Face the public memory.</strong> At the end of your mandate, read the account from different communities and export it.</li></ol><div class="field-note"><strong>A first experiment</strong><p>Try a sports subsidy in one region. Watch the industry and food maps over the next year. Can neighboring farms and transport links absorb the change?</p></div><p class="small muted">₡ is the fictional crown. One turn is one month; each mapxel covers about 4 km². Crime, health, and similar measures are abstract indices. World seeds reproduce the same starting conditions and random draws. No AI or API key is needed.</p>`,
  );
}

function download(
  name: string,
  data: string,
  type = 'application/json',
): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showSave(): void {
  const dialog = modal(
    'Keep your country close.',
    `<p>Progress autosaves in this browser. Export a file to back up your mandate or continue on another device.</p><div class="save-options"><button class="primary" id="export-save">Export save ↓</button><label class="outline upload">Import a save<input id="import-save" type="file" accept="application/json,.json"/></label></div><p class="small muted">Importing replaces the current country after the file has passed validation. Export first if you want to keep both.</p><p id="import-error" role="alert"></p>`,
  );

  dialog.querySelector('#export-save')!.addEventListener('click', () =>
    download(`commonwealth-month-${game.model.tick}.json`, serialize(game)),
  );

  dialog.querySelector('#import-save')!.addEventListener('change', async event => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      if (file.size > 40_000_000) {
        throw new Error('Save files must be smaller than 40 MB.');
      }

      game = deserialize(await file.text());
      selected.clear();
      save();
      dialog.close();
      render();
      toast('Your country is restored.');
    } catch (error) {
      dialog.querySelector('#import-error')!.textContent =
        (error as Error).message;
    }
  });
}

function showNew(): void {
  const seed = `alder-${Math.floor(Math.random() * 10000)}`;
  const dialog = modal(
    'Another country. Another possibility.',
    `<p>A different seed gives you a different landscape. The same seed lets you try a different path through the same starting conditions.</p><form id="new-form"><label>Country seed<input name="seed" maxlength="100" value="${escapeHtml(seed)}" required/></label><p class="small muted">Starting a country replaces the current autosave. Export it first if you want to return.</p><div class="modal-actions"><button type="button" id="backup-first" class="outline">Export current country</button><button class="primary">Begin a new mandate →</button></div></form>`,
  );

  dialog.querySelector('#backup-first')!.addEventListener('click', () =>
    download(`commonwealth-month-${game.model.tick}.json`, serialize(game)),
  );

  dialog.querySelector('#new-form')!.addEventListener('submit', event => {
    event.preventDefault();

    try {
      const form = new FormData(event.target as HTMLFormElement);
      game = createGame(String(form.get('seed')));
      selected.clear();
      layer = 'terrain';
      zoom = 1;
      save();
      dialog.close();
      render();
      toast('Welcome to your new mandate.');
    } catch (error) {
      toast((error as Error).message, true);
    }
  });
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement
  );
}

window.addEventListener('keydown', event => {
  if (
    event.code !== 'Space' ||
    isInteractiveTarget(event.target) ||
    document.querySelector('dialog[open]')
  ) {
    return;
  }

  event.preventDefault();
  running = !running && !game.ended;
  render();
  schedule();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) {
    pause();
    render();
  }
});

app.innerHTML = '<main><h1>Opening the Commonwealth…</h1></main>';

void (async () => {
  let error = '';

  try {
    const saved = await loadAutosave();
    if (saved) game = deserialize(saved);
  } catch {
    error =
      'The autosave could not be loaded. A fresh country is ready; you can import a backup.';
  }

  render();
  if (error) toast(error, true);
})();
