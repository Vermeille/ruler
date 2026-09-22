import { clamp, summarize } from './math';
import { LAWS, SECTORS, SERVICES, type Action, type DeepReadonly, type Game, type Mapxel, type Model, type Scope, type Sector } from './types';
export function scopeCells(model: DeepReadonly<Model>, scope: DeepReadonly<Scope>): number[] {
  return model.cells.filter(c => c.biome !== 'water' && (scope.kind === 'national' || (scope.kind === 'region' ? c.region === scope.id : scope.ids.includes(c.id)))).map(c => c.id);
}
export function subsidyFor(model: DeepReadonly<Model>, cell: DeepReadonly<Mapxel>, sector: Sector): number {
  let amount = model.policy.subsidies[sector];
  for (const local of model.localSubsidies) if (local.sector === sector && (local.scope.kind === 'national' || (local.scope.kind === 'region' ? local.scope.id === cell.region : local.scope.ids.includes(cell.id)))) amount = local.amount;
  return amount;
}
const isRecord = (a: unknown): a is Record<string, unknown> => !!a && typeof a === 'object' && !Array.isArray(a);
function exact(a: Record<string, unknown>, keys: string[]): void { if (Object.keys(a).some(k => !keys.includes(k)) || keys.some(k => !(k in a))) throw new Error(`Expected fields: ${keys.join(', ')}.`); }
function range(n: unknown, lo: number, hi: number): void { if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) throw new Error(`Value must be a finite number from ${lo} to ${hi}.`); }
export function validateAction(input: unknown, model: DeepReadonly<Model>): Action {
  if (!isRecord(input)) throw new Error('An action must be an object.');
  switch (input.type) {
    case 'tax': exact(input, ['type', 'tax', 'rate']); if (!['incomeTax', 'businessTax'].includes(String(input.tax))) throw new Error('Unknown tax.'); range(input.rate, 0, .65); break;
    case 'spending': exact(input, ['type', 'service', 'amount']); if (!SERVICES.includes(input.service as never)) throw new Error('Unknown public service.'); range(input.amount, 0, 2); break;
    case 'subsidy': exact(input, ['type', 'sector', 'amount', 'scope']); if (!SECTORS.includes(input.sector as never)) throw new Error('Unknown sector.'); range(input.amount, 0, 3); break;
    case 'law': exact(input, ['type', 'law', 'enabled']); if (!LAWS.includes(input.law as never) || typeof input.enabled !== 'boolean') throw new Error('Unknown law or invalid boolean.'); break;
    case 'invest': exact(input, ['type', 'project', 'amount', 'scope']); if (!['transport', 'hospital', 'school', 'stadium'].includes(String(input.project))) throw new Error('Unknown investment.'); range(input.amount, 1, 1e9); break;
    default: throw new Error('Unknown action type.');
  }
  if ('scope' in input) {
    const scope = input.scope;
    if (!isRecord(scope)) throw new Error('A scope is required.');
    if (scope.kind === 'national') exact(scope, ['kind']);
    else if (scope.kind === 'region') { exact(scope, ['kind', 'id']); range(scope.id, 0, model.regions.length - 1); if (!Number.isInteger(scope.id)) throw new Error('Region ID must be an integer.'); }
    else if (scope.kind === 'cells') {
      exact(scope, ['kind', 'ids']);
      if (!Array.isArray(scope.ids) || !scope.ids.length || scope.ids.length > model.cells.length || scope.ids.some(id => !Number.isInteger(id) || !model.cells[Number(id)] || model.cells[Number(id)].biome === 'water') || new Set(scope.ids).size !== scope.ids.length) throw new Error('Select distinct land mapxels.');
    } else throw new Error('Unknown scope.');
    if (!scopeCells(model, scope as Scope).length) throw new Error('The scope contains no land.');
  }
  return structuredClone(input) as Action;
}
export function parseCommand(text: string, selected: number[] = []): unknown {
  const source = text.trim();
  if (source.startsWith('{') || source.startsWith('[')) return JSON.parse(source);
  const p = source.split(/\s+/);
  const scopeAt = p.indexOf('in');
  let scope: Scope = { kind: 'national' };
  if (scopeAt >= 0) {
    const tail = p.splice(scopeAt);
    if (tail.length === 2 && tail[1] === 'selected') scope = { kind: 'cells', ids: [...selected].sort((a, b) => a - b) };
    else if (tail.length === 3 && tail[1] === 'region') scope = { kind: 'region', id: Number(tail[2]) };
    else if (tail.length !== 2 || tail[1] !== 'national') throw new Error('Use “in selected”, “in region 0”, or “in national”.');
  }
  if (p.length !== 3) throw new Error('Expected a command, a target, and a value.');
  if (['tax', 'spend', 'law'].includes(p[0]) && scopeAt >= 0) throw new Error('Taxes, public spending, and laws apply nationally.');
  if (p[0] === 'tax') return { type: 'tax', tax: p[1] === 'income' ? 'incomeTax' : p[1] === 'business' ? 'businessTax' : p[1], rate: Number(p[2]) };
  if (p[0] === 'spend') return { type: 'spending', service: p[1], amount: Number(p[2]) };
  if (p[0] === 'subsidize') return { type: 'subsidy', sector: p[1], amount: Number(p[2]), scope };
  if (p[0] === 'invest') return { type: 'invest', project: p[1], amount: Number(p[2]), scope };
  if (p[0] === 'law' && ['on', 'off'].includes(p[2])) return { type: 'law', law: p[1], enabled: p[2] === 'on' };
  throw new Error('Unknown command. Try “tax income 0.22”.');
}
export function describeAction(action: Action, model: DeepReadonly<Model>): string {
  const place = 'scope' in action ? action.scope.kind === 'national' ? 'nationally' : action.scope.kind === 'region' ? `in ${model.regions[action.scope.id]}` : `in ${action.scope.ids.length} selected mapxels` : '';
  switch (action.type) {
    case 'tax': return `Set ${action.tax === 'incomeTax' ? 'income' : 'business'} tax to ${(action.rate * 100).toFixed(0)}%`;
    case 'spending': return `Fund ${action.service} at ₡${action.amount.toFixed(2)} per resident / month`;
    case 'subsidy': return `Set ${action.sector} subsidy to ₡${action.amount.toFixed(2)} per worker / month ${place}`;
    case 'law': return `${action.enabled ? 'Enact' : 'Repeal'} ${({ cleanAir: 'the Clean Air Act', freeMovement: 'freedom of movement', publicAssembly: 'freedom of assembly' })[action.law]}`;
    case 'invest': return `Invest ₡${Math.round(action.amount).toLocaleString()} in ${action.project} ${place}`;
  }
}
export function forecastBudget(model: DeepReadonly<Model>): { revenue: number; spending: number; interest: number; balance: number } {
  let revenue = 0, spending = 0;
  for (const c of model.cells) if (c.population > 0) {
    revenue += c.output * (.7 * model.policy.incomeTax + .3 * model.policy.businessTax);
    spending += c.population * (Object.values(model.policy.spending).reduce((a, b) => a + b, 0) + SECTORS.reduce((s, k) => s + c[k] * subsidyFor(model, c, k), 0));
  }
  const interest = model.debt * .003;
  return { revenue, spending, interest, balance: revenue - spending - interest };
}
export function previewActions(game: Game, input: unknown): { actions: Action[]; descriptions: string[]; monthlyChange: number; upfront: number; warnings: string[] } {
  const raw = Array.isArray(input) ? input : [input];
  if (!raw.length || raw.length > 20) throw new Error('Submit between 1 and 20 actions at a time.');
  const trial = structuredClone(game.model), before = forecastBudget(trial).balance;
  const actions = raw.map(a => validateAction(a, trial));
  let upfront = 0;
  for (const action of actions) { if (action.type === 'invest') upfront += action.amount; mutatePolicy(trial, action, 'preview'); }
  if (upfront > game.model.treasury) throw new Error('Not enough treasury cash for this investment package.');
  const after = forecastBudget(trial);
  return { actions, descriptions: actions.map(a => describeAction(a, trial)), monthlyChange: after.balance - before, upfront, warnings: after.balance < 0 ? ['This budget spends more than it raises. Reserves cover the gap first; borrowing has a limit.'] : [] };
}
function mutatePolicy(model: Model, action: Action, cause: string): void {
  if (action.type === 'tax') model.policy[action.tax] = action.rate;
  if (action.type === 'spending') model.policy.spending[action.service] = action.amount;
  if (action.type === 'law') model.policy.laws[action.law] = action.enabled;
  if (action.type === 'subsidy') {
    if (action.scope.kind === 'national') { model.policy.subsidies[action.sector] = action.amount; model.localSubsidies = model.localSubsidies.filter(s => s.sector !== action.sector); }
    else {
      model.localSubsidies = model.localSubsidies.filter(s => !(s.sector === action.sector && JSON.stringify(s.scope) === JSON.stringify(action.scope)));
      model.localSubsidies.push({ ...action, cause });
    }
  }
  if (action.type === 'invest') {
    const ids = scopeCells(model, action.scope), pop = ids.reduce((sum, id) => sum + model.cells[id].population, 0);
    model.treasury -= action.amount; model.externalCash += action.amount;
    const field = ({ transport: 'infrastructure', hospital: 'health', school: 'education', stadium: 'sportsInterest' } as const)[action.project];
    for (const id of ids) model.cells[id][field] = clamp(model.cells[id][field] + action.amount / pop / (action.project === 'stadium' ? 30 : 60));
  }
}
export function enact(game: Game, input: unknown): Game {
  if (game.ended) throw new Error('Your mandate has ended. Start a new country to govern again.');
  const preview = previewActions(game, input);
  const next: Game = { ...game, model: structuredClone(game.model), causes: [...game.causes], articles: [...game.articles], actionLog: [...game.actionLog], provenance: { ...game.provenance } };
  for (const action of preview.actions) {
    const id = `a${next.actionLog.length}`, title = describeAction(action, next.model), cells = 'scope' in action ? scopeCells(next.model, action.scope) : [];
    const field = action.type === 'invest' ? ({ transport: 'infrastructure', hospital: 'health', school: 'education', stadium: 'sportsInterest' } as const)[action.project] : undefined;
    const observations = field ? cells.map(cell => ({ cell, field, value: next.model.cells[cell][field], label: 'Before investment' })) : [];
    mutatePolicy(next.model, action, id);
    next.causes.push({ id, tick: next.model.tick, rule: 'government', title, detail: 'A decision made by your administration. Policy effects propagate through the economy in subsequent months.', cells, parents: [], observations, magnitude: 1 });
    next.actionLog.push({ tick: next.model.tick, action, causeId: id });
    if (action.type === 'tax') next.provenance[`policy:${action.tax}`] = id;
    if (action.type === 'spending') next.provenance[`policy:spending:${action.service}`] = id;
    if (action.type === 'law') next.provenance[`policy:law:${action.law}`] = id;
    if (action.type === 'subsidy') for (const cell of cells) next.provenance[`${cell}:subsidy:${action.sector}`] = id;
    if (field) for (const cell of cells) next.provenance[`${cell}:${field}`] = id;
    next.articles.unshift({ id: `news-${id}`, tick: next.model.tick, category: 'politics', headline: title, body: 'The cabinet has adopted the measure. The Ledger will follow its effects on households, businesses, and the public finances.', voice: 'The Commonwealth Ledger · Government desk', causeIds: [id], tone: 'neutral' });
  }
  return next;
}
export const debtLimit = (model: DeepReadonly<Model>): number => summarize(model).population * 30;
