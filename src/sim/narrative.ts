import { summarize } from './math';
import type { Article, Cause, Game, Summary } from './types';
export function traceCauses(game: Game, ids: readonly string[], limit = 40): Cause[] {
  const index = new Map(game.causes.map(c => [c.id, c])), seen = new Set<string>(), result: Cause[] = [];
  function visit(id: string): void {
    if (seen.has(id) || seen.size >= limit) return;
    seen.add(id); const c = index.get(id); if (!c) return;
    for (const parent of c.parents) visit(parent);
    result.push(c);
  }
  ids.forEach(visit); return result;
}
export function writeMonthlyNews(game: Game): void {
  const m = game.model, now = game.history.at(-1)!.summary, before = game.history.at(-2)!.summary;
  const recent = game.causes.filter(c => c.tick === m.tick);
  const make = (article: Omit<Article, 'id' | 'tick'>) => game.articles.unshift({ ...article, id: `report-${m.tick}-${game.articles.length}`, tick: m.tick });
  if (now.foodSecurity < .9 && (before.foodSecurity >= .9 || m.tick % 6 === 0)) {
    const worst = m.cells.filter(c => c.population > 0).sort((a, b) => a.foodSecurity - b.foodSecurity)[0];
    make({ category: 'economy', headline: 'The politics of an empty plate', body: `Food needs are ${(now.foodSecurity * 100).toFixed(0)}% met across the country. ${worst.name} is among the hardest hit. Local farm employment, transport access, and neighboring stocks explain why some communities are struggling more than others.`, voice: 'Ada Moss · Economy correspondent', cell: worst.id, causeIds: recent.filter(c => c.cells.includes(worst.id) && ['economy.households', 'economy.labor', 'economy.neighbor-trade'].includes(c.rule)).map(c => c.id).slice(-4), tone: 'bad' });
  }
  if (m.budget.funding < .99 && (m.tick % 3 === 0 || game.lastEvents.funding === undefined)) {
    game.lastEvents.funding = m.tick;
    make({ category: 'politics', headline: 'The promises exceed the purse', body: `Only ${(m.budget.funding * 100).toFixed(0)}% of promised spending was funded this month. The treasury has exhausted its available cash and borrowing capacity. Health, schools, policing, and subsidies all receive less than their headline allocations.`, voice: 'Mira Vale · Public affairs', causeIds: game.actionLog.filter(a => ['spending', 'tax', 'subsidy', 'invest'].includes(a.action.type)).slice(-5).map(a => a.causeId), tone: 'bad' });
  }
  if (m.tick % 3 === 0) {
    const change = now.approval - game.history[Math.max(0, game.history.length - 4)].summary.approval;
    const title = change > .015 ? 'A little more faith in the government' : change < -.015 ? 'The honeymoon gives way to questions' : 'A country getting on with things';
    const top = recent.filter(c => c.rule !== 'stories.events').sort((a, b) => b.magnitude - a.magnitude).slice(0, 3);
    make({ category: 'briefing', headline: title, body: `Approval stands at ${(now.approval * 100).toFixed(0)}%. Employment is ${(now.employment * 100).toFixed(0)}%, and households hold an average ₡${now.wealth.toFixed(1)} in reserves per resident. ${now.foodSecurity > .97 ? 'Food supplies are meeting almost all household needs.' : 'Uneven food access remains a concern.'} ${m.budget.borrowed > 0 ? 'The government borrowed to cover this month’s gap.' : 'The public budget required no new borrowing this month.'}`, voice: 'The Commonwealth Ledger · Quarterly briefing', causeIds: top.map(c => c.id), tone: change > .015 ? 'good' : change < -.015 ? 'bad' : 'neutral' });
  }
}
export interface MandateReport {
  title: string; verdict: string; opening: string;
  voices: { who: string; text: string; metric: string }[];
  changes: { label: string; before: number; after: number; unit: 'percent' | 'money' | 'people' }[];
  moments: Article[]; chains: { title: string; causes: Cause[] }[]; closing: string;
}
export function mandateReport(game: Game): MandateReport {
  const now = summarize(game.model), initial = game.initial;
  const farmers = game.model.cells.filter(c => c.population > 0 && c.agriculture > .32);
  const cities = game.model.cells.filter(c => c.biome === 'city');
  const farm = summarize(game.model, farmers.map(c => c.id)), city = summarize(game.model, cities.map(c => c.id));
  const metric = (summary: Summary, key: 'happiness' | 'crime' | 'employment') => `${(summary[key] * 100).toFixed(0)}% ${key === 'crime' ? 'crime pressure' : key}`;
  const traced = game.articles.filter(a => a.causeIds.length && a.category !== 'politics').map(a => ({ title: a.headline, causes: traceCauses(game, a.causeIds) }));
  const chains = traced.filter(t => t.causes.some(c => c.rule === 'government') && t.causes.length >= 3).sort((a, b) => b.causes.length - a.causes.length).slice(0, 3);
  const outcome = now.approval >= .6 ? 'A mandate remembered with trust.' : now.approval >= .45 ? 'A complicated place in the public memory.' : 'A country ready for a different chapter.';
  const moments = game.articles.filter(a => a.category === 'dispatch' || a.category === 'culture' || (a.category === 'economy')).slice(0, 8).reverse();
  return {
    title: 'The country you leave behind', verdict: outcome,
    opening: `After ${game.model.tick} months and ${game.actionLog.length} government decisions, ${(now.approval * 100).toFixed(0)}% of residents approve of your administration. ${now.happiness > initial.happiness + .025 ? 'Life feels better to more people than it did on inauguration day.' : now.happiness < initial.happiness - .025 ? 'Daily life has become harder for many households.' : 'For many households, everyday life feels much as it did when you arrived.'} There was no single national experience.`,
    voices: [
      { who: 'From the farming communities', text: !farm.population ? 'Few communities now depend primarily on farming. The country’s employment mix has changed.' : farm.happiness > .65 ? '“We could plan for the next season. That counts for something out here.”' : '“People talk about the national economy. We talk about whether the farm will make it through another season.”', metric: metric(farm, 'happiness') },
      { who: 'From the city high streets', text: city.employment > .88 && city.foodSecurity > .95 ? '“The shops stayed open. Customers kept coming. Most of us just wanted a little certainty.”' : '“You felt it first at the counter: fewer customers, harder choices, another shuttered window.”', metric: metric(city, 'employment') },
      { who: 'From families across the country', text: now.crime < .1 && now.health > .65 ? '“Safe streets and someone to see you when you were ill. That’s what we’ll remember.”' : '“The speeches were one thing. What happened on our street was another.”', metric: `${(now.health * 100).toFixed(0)}% health · ${metric(now, 'crime')}` },
    ],
    changes: [
      { label: 'Public approval', before: initial.approval, after: now.approval, unit: 'percent' }, { label: 'Wellbeing', before: initial.happiness, after: now.happiness, unit: 'percent' },
      { label: 'Employment', before: initial.employment, after: now.employment, unit: 'percent' }, { label: 'Food needs met', before: initial.foodSecurity, after: now.foodSecurity, unit: 'percent' },
      { label: 'Reserves / resident', before: initial.wealth, after: now.wealth, unit: 'money' }, { label: 'Public debt', before: initial.debt, after: now.debt, unit: 'money' },
    ], moments, chains,
    closing: `This is a record of simulated outcomes, with fictional voices selected from measured living conditions. ${chains.length ? 'The linked stories show recorded contributing factors, including your decisions; chance and other pressures also mattered.' : 'No complete policy-to-news chain was recorded for this mandate. The figures and dispatches above remain the record of what happened.'}`,
  };
}
