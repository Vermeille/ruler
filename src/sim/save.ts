import { assertModel } from './engine';
import { validateAction } from './policy';
import { createGame } from './world';
import { MUTABLE_FIELDS, LAWS, SECTORS, SERVICES, type Game } from './types';
const fail = (): never => { throw new Error('This save is incomplete, corrupted, or from an unsupported version.'); };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const string = (v: unknown): v is string => typeof v === 'string' && v.length <= 20000;
export function serialize(game: Game): string { return JSON.stringify(game); }
export function deserialize(text: string): Game {
  if (text.length > 40_000_000) throw new Error('Save file is too large (40 MB maximum).');
  let data: unknown;
  try { data = JSON.parse(text); } catch { return fail(); }
  if (!record(data) || data.version !== 1 || !record(data.model)) return fail();
  const m = data.model;
  if (!string(m.seed) || !finite(m.width) || !finite(m.height) || !finite(m.mandate)) return fail();
  const original = createGame(m.seed, m.width, m.height, m.mandate);
  if (!Number.isInteger(m.tick) || Number(m.tick) < 0 || Number(m.tick) > m.mandate || data.ended !== (m.tick === m.mandate)) return fail();
  if (!Array.isArray(m.cells) || m.cells.length !== original.model.cells.length || JSON.stringify(m.neighbors) !== JSON.stringify(original.model.neighbors) || JSON.stringify(m.regions) !== JSON.stringify(original.model.regions)) return fail();
  for (let i = 0; i < m.cells.length; i++) {
    const c: unknown = m.cells[i], base = original.model.cells[i]; if (!record(c)) return fail();
    for (const k of Object.keys(base) as (keyof typeof base)[]) {
      if (MUTABLE_FIELDS.includes(k as never)) { if (!finite(c[k])) return fail(); }
      else if (c[k] !== base[k]) return fail();
    }
    if (c.biome === 'water' && (c.population !== 0 || c.cash !== 0 || c.food !== 0 || c.materials !== 0)) return fail();
  }
  if (!record(m.policy) || !record(m.policy.spending) || !record(m.policy.subsidies) || !record(m.policy.laws) || !record(m.budget)) return fail();
  for (const key of ['revenue', 'spending', 'interest', 'borrowed', 'funding']) if (!finite(m.budget[key]) || Number(m.budget[key]) < 0) return fail();
  if (Number(m.budget.funding) > 1) return fail();
  const game = data as unknown as Game;
  try {
    for (const tax of ['incomeTax', 'businessTax'] as const) validateAction({ type: 'tax', tax, rate: m.policy[tax] }, game.model);
    for (const service of SERVICES) validateAction({ type: 'spending', service, amount: m.policy.spending[service] }, game.model);
    for (const sector of SECTORS) validateAction({ type: 'subsidy', sector, amount: m.policy.subsidies[sector], scope: { kind: 'national' } }, game.model);
    for (const law of LAWS) validateAction({ type: 'law', law, enabled: m.policy.laws[law] }, game.model);
    assertModel(game.model);
  } catch { return fail(); }
  if (!Array.isArray(data.causes) || data.causes.length > 150000 || !Array.isArray(data.articles) || data.articles.length > 10000 || !Array.isArray(data.history) || data.history.length !== Number(m.tick) + 1 || !Array.isArray(data.actionLog) || data.actionLog.length > 10000 || !Array.isArray(m.localSubsidies) || !record(data.provenance) || !record(data.lastEvents)) return fail();
  const cell = (id: unknown) => Number.isInteger(id) && Number(id) >= 0 && Number(id) < game.model.cells.length && game.model.cells[Number(id)].biome !== 'water';
  const tick = (v: unknown) => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= Number(m.tick);
  const ids = new Set<string>();
  for (const c of data.causes) {
    if (!record(c) || !string(c.id) || ids.has(c.id) || !tick(c.tick) || !string(c.rule) || !string(c.title) || !string(c.detail) || !finite(c.magnitude) || !Array.isArray(c.cells) || !c.cells.every(cell) || !Array.isArray(c.parents) || !c.parents.every(p => typeof p === 'string' && ids.has(p)) || !Array.isArray(c.observations)) return fail();
    for (const o of c.observations) if (!record(o) || (o.cell !== undefined && !cell(o.cell)) || !MUTABLE_FIELDS.includes(o.field as never) || !finite(o.value) || !string(o.label)) return fail();
    ids.add(c.id);
  }
  for (const a of data.articles) if (!record(a) || !string(a.id) || !tick(a.tick) || !['dispatch', 'economy', 'politics', 'culture', 'briefing'].includes(String(a.category)) || !['good', 'bad', 'neutral'].includes(String(a.tone)) || !string(a.headline) || !string(a.body) || !string(a.voice) || (a.cell !== undefined && !cell(a.cell)) || !Array.isArray(a.causeIds) || !a.causeIds.every(id => ids.has(String(id)))) return fail();
  for (const a of data.actionLog) {
    if (!record(a) || !tick(a.tick) || !ids.has(String(a.causeId))) return fail();
    try { validateAction(a.action, game.model); } catch { return fail(); }
  }
  for (const s of m.localSubsidies) {
    if (!record(s) || !ids.has(String(s.cause))) return fail();
    try { validateAction({ type: 'subsidy', sector: s.sector, amount: s.amount, scope: s.scope }, game.model); } catch { return fail(); }
  }
  for (const v of Object.values(data.provenance)) if (!ids.has(String(v))) return fail();
  for (const v of Object.values(data.lastEvents)) if (!tick(v)) return fail();
  const summaryKeys = Object.keys(original.initial);
  const summary = (v: unknown) => record(v) && summaryKeys.every(k => finite(v[k]) && Number(v[k]) >= 0);
  if (!summary(data.initial)) return fail();
  for (let i = 0; i < data.history.length; i++) { const h: unknown = data.history[i]; if (!record(h) || h.tick !== i || !summary(h.summary)) return fail(); }
  return game;
}
