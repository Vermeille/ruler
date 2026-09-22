import { clamp, deepFreeze, randomAt, summarize } from './math';
import { MUTABLE_FIELDS, PHASES, SECTORS, type Account, type Cause, type DeepReadonly, type Effect, type Evidence, type Game, type Model, type MutableField, type Rule } from './types';
import { defaultRules } from './rules';
import { writeMonthlyNews } from './narrative';

export function orderRules(rules: readonly Rule[]): Rule[] {
  const byId = new Map(rules.map(r => [r.id, r]));
  if (byId.size !== rules.length) throw new Error('Rule IDs must be unique.');
  const result: Rule[] = [], visiting = new Set<string>(), done = new Set<string>();
  function visit(r: Rule): void {
    if (done.has(r.id)) return;
    if (!PHASES.includes(r.phase)) throw new Error(`Unknown phase: ${r.phase}`);
    if (visiting.has(r.id)) throw new Error(`Rule dependency cycle at ${r.id}`);
    visiting.add(r.id);
    for (const id of [...(r.after ?? [])].sort()) {
      const dep = byId.get(id); if (!dep) throw new Error(`Missing dependency: ${id}`);
      if (PHASES.indexOf(dep.phase) > PHASES.indexOf(r.phase)) throw new Error(`Dependency ${id} runs after ${r.id}`);
      visit(dep);
    }
    visiting.delete(r.id); done.add(r.id); result.push(r);
  }
  for (const phase of PHASES) for (const rule of rules.filter(r => r.phase === phase).sort((a, b) => a.id.localeCompare(b.id))) visit(rule);
  return result;
}
const bounded = new Set<MutableField>(['children', 'seniors', 'education', 'health', 'happiness', 'approval', 'crime', 'pollution', 'infrastructure', 'employment', 'foodSecurity', 'sportsInterest', 'businessHealth', ...SECTORS]);
function balance(model: DeepReadonly<Model>, account: Account, resource: string): number {
  if (account === 'external' || account === 'treasury') { if (resource !== 'cash') throw new Error('Public and external accounts only hold cash.'); return account === 'treasury' ? model.treasury : model.externalCash; }
  const c = model.cells[account]; if (!c || c.biome === 'water') throw new Error(`Invalid account ${account}`);
  return c[resource as 'cash' | 'food' | 'materials' | 'population'];
}
function move(model: Model, account: Account, resource: string, delta: number): void {
  if (account === 'external') model.externalCash += delta;
  else if (account === 'treasury') model.treasury += delta;
  else model.cells[account][resource as 'cash' | 'food' | 'materials' | 'population'] += delta;
}
export function recordCause(game: Game, snapshot: DeepReadonly<Model>, rule: string, evidence: Evidence, magnitude: number, provenance = game.provenance): string {
  const parents = new Set<string>();
  for (const key of evidence.parents ?? []) if (provenance[key]) parents.add(provenance[key]);
  const observations = (evidence.reads ?? []).map(r => {
    if (provenance[`${r.cell}:${r.field}`]) parents.add(provenance[`${r.cell}:${r.field}`]);
    return { ...r, value: snapshot.cells[r.cell][r.field] };
  });
  const id = `c${game.model.tick}-${game.causes.length}`;
  const cause: Cause = { id, tick: game.model.tick, rule, title: evidence.title, detail: evidence.detail, cells: [...evidence.cells], parents: [...parents], observations, magnitude };
  game.causes.push(cause); return id;
}
/** Resolve a whole phase against one immutable snapshot. Incoming goods cannot be spent in that phase. */
export function commitEffects(game: Game, snapshot: DeepReadonly<Model>, proposals: { rule: string; effect: Effect }[]): void {
  const provenance = { ...game.provenance };
  const eventIds = new Map<string, string>();
  const demands = new Map<string, number>();
  const key = (account: Account, resource: string) => `${account}/${resource}`;
  const demand = (a: Account, r: string, amount: number) => { balance(snapshot, a, r); demands.set(key(a, r), (demands.get(key(a, r)) ?? 0) + amount); };
  const deltas = new Map<string, number>();
  let budgets = 0;
  for (const { effect: e } of proposals) {
    if ('amount' in e && (!Number.isFinite(e.amount) || (e.kind !== 'delta' && e.amount < 0))) throw new Error('Invalid effect amount.');
    if (e.kind === 'delta') {
      if (!MUTABLE_FIELDS.includes(e.field) || e.field === 'cash' || !snapshot.cells[e.cell] || snapshot.cells[e.cell].biome === 'water') throw new Error('Invalid delta; cash must use transfers.');
      if (['food', 'materials', 'population'].includes(e.field) && e.amount < 0) demand(e.cell, e.field, -e.amount);
    }
    if (e.kind === 'transfer') { balance(snapshot, e.to, e.resource); demand(e.from, e.resource, e.amount); }
    if (e.kind === 'trade') {
      if (!Number.isFinite(e.price) || e.price <= 0) throw new Error('Invalid trade price.');
      demand(e.from, e.resource, e.amount); demand(e.to, 'cash', e.amount * e.price);
    }
    if (e.kind === 'budget') { budgets++; if (budgets > 1 || !Number.isFinite(e.debtDelta) || e.debtDelta < 0 || Object.values(e.value).some(v => !Number.isFinite(v) || v < 0) || e.value.funding > 1) throw new Error('Invalid or conflicting fiscal effects.'); }
  }
  const scale = (a: Account, r: string) => Math.min(1, balance(snapshot, a, r) / Math.max(1e-12, demands.get(key(a, r)) ?? 0));
  for (const { rule, effect: e } of proposals) {
    let actual = 0;
    if (e.kind === 'delta') {
      actual = e.amount;
      if (['food', 'materials', 'population'].includes(e.field) && actual < 0) actual *= scale(e.cell, e.field);
      const k = `${e.cell}:${e.field}`; deltas.set(k, (deltas.get(k) ?? 0) + actual);
    }
    if (e.kind === 'transfer') {
      actual = e.amount * scale(e.from, e.resource);
      move(game.model, e.from, e.resource, -actual); move(game.model, e.to, e.resource, actual);
    }
    if (e.kind === 'trade') {
      actual = e.amount * Math.min(scale(e.from, e.resource), scale(e.to, 'cash'));
      move(game.model, e.from, e.resource, -actual); move(game.model, e.to, e.resource, actual);
      move(game.model, e.to, 'cash', -actual * e.price); move(game.model, e.from, 'cash', actual * e.price);
      if (e.resource === 'food') { game.model.cells[e.from].foodTraded -= actual; game.model.cells[e.to].foodTraded += actual; }
    }
    if (e.kind === 'budget') { game.model.budget = { ...e.value }; game.model.debt += e.debtDelta; }
    if (e.kind === 'event') {
      const cause = recordCause(game, snapshot, rule, e.evidence, 1, provenance);
      eventIds.set(e.key, cause);
      game.lastEvents[e.key] = game.model.tick;
      game.articles.unshift({ ...e.article, id: `event-${cause}`, tick: game.model.tick, causeIds: [cause] });
    } else if ('evidence' in e && e.evidence && Math.abs(actual) > 1e-9) {
      const id = recordCause(game, snapshot, rule, e.evidence, Math.abs(actual), provenance);
      if (e.kind === 'delta') game.provenance[`${e.cell}:${e.field}`] = id;
      if (e.kind === 'transfer' || e.kind === 'trade') for (const cell of [e.from, e.to]) if (typeof cell === 'number') game.provenance[`${cell}:${e.resource}`] = id;
    }
    if (e.kind === 'delta' && e.eventKey) {
      const id = eventIds.get(e.eventKey); if (!id) throw new Error(`Missing event ${e.eventKey}`);
      game.provenance[`${e.cell}:${e.field}`] = id;
    }
  }
  for (const [key, amount] of deltas) {
    const [cell, field] = key.split(':') as [string, MutableField];
    const c = game.model.cells[Number(cell)], value = c[field] + amount;
    c[field] = bounded.has(field) ? clamp(value) : field === 'price' ? clamp(value, .4, 5) : field === 'foodTraded' ? value : Math.max(0, value);
  }
}
export function assertModel(model: DeepReadonly<Model>): void {
  if (![model.treasury, model.debt, model.externalCash].every(n => Number.isFinite(n) && n >= -1e-5)) throw new Error('Invalid public accounts.');
  for (const c of model.cells) {
    for (const k of MUTABLE_FIELDS) if (!Number.isFinite(c[k]) || (k !== 'foodTraded' && c[k] < -1e-6) || (bounded.has(k) && c[k] > 1 + 1e-6)) throw new Error(`Invalid ${k} in mapxel ${c.id}: ${c[k]}`);
    if (c.biome !== 'water' && Math.abs(SECTORS.reduce((a, k) => a + c[k], 0) - 1) > 1e-6) throw new Error(`Sector shares must sum to one: ${c.id}`);
    if (c.children + c.seniors > 1) throw new Error('Invalid demographics.');
    if (c.price < .4 || c.price > 5) throw new Error('Food prices must remain in the calibrated range.');
  }
}
export function step(game: Game, rules: readonly Rule[] = defaultRules): Game {
  if (game.ended) return game;
  const ordered = orderRules(rules);
  const next: Game = { ...game, model: structuredClone(game.model), causes: [...game.causes], articles: [...game.articles], history: [...game.history], provenance: { ...game.provenance }, lastEvents: { ...game.lastEvents } };
  next.model.tick++;
  for (const phase of PHASES) {
    const active = ordered.filter(r => r.phase === phase); if (!active.length) continue;
    const snapshot = deepFreeze(structuredClone(next.model));
    const proposals = active.flatMap(rule => rule.run({ model: snapshot, random: (cell, channel = '') => randomAt(snapshot.seed, snapshot.tick, rule.id, cell, channel), lastEvents: Object.freeze({ ...next.lastEvents }) }).map(effect => ({ rule: rule.id, effect })));
    commitEffects(next, snapshot, proposals);
    assertModel(next.model);
  }
  next.history.push({ tick: next.model.tick, summary: summarize(next.model) });
  writeMonthlyNews(next);
  next.ended = next.model.tick >= next.model.mandate;
  return next;
}
