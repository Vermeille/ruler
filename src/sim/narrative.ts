import { summarize } from './math';
import type { Article, Cause, Game, Summary } from './types';

export function traceCauses(
  game: Game,
  ids: readonly string[],
  limit = 40,
): Cause[] {
  const byId = new Map(game.causes.map(cause => [cause.id, cause]));
  const seen = new Set<string>();
  const result: Cause[] = [];

  function visit(id: string): void {
    if (seen.has(id) || seen.size >= limit) return;

    seen.add(id);
    const cause = byId.get(id);
    if (!cause) return;

    for (const parent of cause.parents) {
      visit(parent);
    }

    result.push(cause);
  }

  ids.forEach(visit);
  return result;
}

function addMonthlyArticle(
  game: Game,
  article: Omit<Article, 'id' | 'tick'>,
): void {
  const tick = game.model.tick;
  game.articles.unshift({
    ...article,
    id: `report-${tick}-${game.articles.length}`,
    tick,
  });
}

function writeFoodSecurityStory(
  game: Game,
  now: Summary,
  before: Summary,
  recentCauses: Cause[],
): void {
  const shouldPublish = now.foodSecurity < 0.9
    && (before.foodSecurity >= 0.9 || game.model.tick % 6 === 0);
  if (!shouldPublish) return;

  const worst = game.model.cells
    .filter(cell => cell.population > 0)
    .sort((a, b) => a.foodSecurity - b.foodSecurity)[0];
  const relevantRules = [
    'economy.households',
    'economy.labor',
    'economy.neighbor-trade',
  ];
  const causeIds = recentCauses
    .filter(cause => cause.cells.includes(worst.id) && relevantRules.includes(cause.rule))
    .map(cause => cause.id)
    .slice(-4);

  addMonthlyArticle(game, {
    category: 'economy',
    headline: 'The politics of an empty plate',
    body: `Food needs are ${(now.foodSecurity * 100).toFixed(0)}% met across the country. ${worst.name} is among the hardest hit. Local farm employment, transport access, and neighboring stocks explain why some communities are struggling more than others.`,
    voice: 'Ada Moss · Economy correspondent',
    cell: worst.id,
    causeIds,
    tone: 'bad',
  });
}

function writeFundingStory(game: Game): void {
  const budget = game.model.budget;
  const tick = game.model.tick;
  const shouldPublish = budget.funding < 0.99
    && (tick % 3 === 0 || game.lastEvents.funding === undefined);
  if (!shouldPublish) return;

  game.lastEvents.funding = tick;
  const causeIds = game.actionLog
    .filter(entry => ['spending', 'tax', 'subsidy', 'invest'].includes(entry.action.type))
    .slice(-5)
    .map(entry => entry.causeId);

  addMonthlyArticle(game, {
    category: 'politics',
    headline: 'The promises exceed the purse',
    body: `Only ${(budget.funding * 100).toFixed(0)}% of promised spending was funded this month. The treasury has exhausted its available cash and borrowing capacity. Health, schools, policing, and subsidies all receive less than their headline allocations.`,
    voice: 'Mira Vale · Public affairs',
    causeIds,
    tone: 'bad',
  });
}

function approvalBriefingTitle(change: number): string {
  if (change > 0.015) return 'A little more faith in the government';
  if (change < -0.015) return 'The honeymoon gives way to questions';
  return 'A country getting on with things';
}

function approvalBriefingTone(change: number): Article['tone'] {
  if (change > 0.015) return 'good';
  if (change < -0.015) return 'bad';
  return 'neutral';
}

function writeQuarterlyBriefing(
  game: Game,
  now: Summary,
  recentCauses: Cause[],
): void {
  if (game.model.tick % 3 !== 0) return;

  const comparisonIndex = Math.max(0, game.history.length - 4);
  const approvalBefore = game.history[comparisonIndex].summary.approval;
  const approvalChange = now.approval - approvalBefore;
  const topCauses = recentCauses
    .filter(cause => cause.rule !== 'stories.events')
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 3);
  const foodSentence = now.foodSecurity > 0.97
    ? 'Food supplies are meeting almost all household needs.'
    : 'Uneven food access remains a concern.';
  const borrowingSentence = game.model.budget.borrowed > 0
    ? 'The government borrowed to cover this month’s gap.'
    : 'The public budget required no new borrowing this month.';

  addMonthlyArticle(game, {
    category: 'briefing',
    headline: approvalBriefingTitle(approvalChange),
    body: `Approval stands at ${(now.approval * 100).toFixed(0)}%. Employment is ${(now.employment * 100).toFixed(0)}%, and households hold an average ₡${now.wealth.toFixed(1)} in reserves per resident. ${foodSentence} ${borrowingSentence}`,
    voice: 'The Commonwealth Ledger · Quarterly briefing',
    causeIds: topCauses.map(cause => cause.id),
    tone: approvalBriefingTone(approvalChange),
  });
}

export function writeMonthlyNews(game: Game): void {
  const now = game.history.at(-1)!.summary;
  const before = game.history.at(-2)!.summary;
  const recentCauses = game.causes.filter(cause => cause.tick === game.model.tick);

  writeFoodSecurityStory(game, now, before, recentCauses);
  writeFundingStory(game);
  writeQuarterlyBriefing(game, now, recentCauses);
}

export interface MandateReport {
  title: string;
  verdict: string;
  opening: string;
  voices: {
    who: string;
    text: string;
    metric: string;
  }[];
  changes: {
    label: string;
    before: number;
    after: number;
    unit: 'percent' | 'money' | 'people';
  }[];
  moments: Article[];
  chains: {
    title: string;
    causes: Cause[];
  }[];
  closing: string;
}

function reportMetric(
  summary: Summary,
  key: 'happiness' | 'crime' | 'employment',
): string {
  const label = key === 'crime' ? 'crime pressure' : key;
  return `${(summary[key] * 100).toFixed(0)}% ${label}`;
}

function policyChains(game: Game): MandateReport['chains'] {
  const traced = game.articles
    .filter(article => article.causeIds.length && article.category !== 'politics')
    .map(article => ({
      title: article.headline,
      causes: traceCauses(game, article.causeIds),
    }));

  return traced
    .filter(chain => {
      return chain.causes.some(cause => cause.rule === 'government')
        && chain.causes.length >= 3;
    })
    .sort((a, b) => b.causes.length - a.causes.length)
    .slice(0, 3);
}

function mandateVerdict(approval: number): string {
  if (approval >= 0.6) return 'A mandate remembered with trust.';
  if (approval >= 0.45) return 'A complicated place in the public memory.';
  return 'A country ready for a different chapter.';
}

function mandateOpening(game: Game, now: Summary): string {
  let lifeSentence = 'For many households, everyday life feels much as it did when you arrived.';

  if (now.happiness > game.initial.happiness + 0.025) {
    lifeSentence = 'Life feels better to more people than it did on inauguration day.';
  } else if (now.happiness < game.initial.happiness - 0.025) {
    lifeSentence = 'Daily life has become harder for many households.';
  }

  return `After ${game.model.tick} months and ${game.actionLog.length} government decisions, ${(now.approval * 100).toFixed(0)}% of residents approve of your administration. ${lifeSentence} There was no single national experience.`;
}

function reportVoices(
  now: Summary,
  farm: Summary,
  city: Summary,
): MandateReport['voices'] {
  const farmText = !farm.population
    ? 'Few communities now depend primarily on farming. The country’s employment mix has changed.'
    : farm.happiness > 0.65
      ? '“We could plan for the next season. That counts for something out here.”'
      : '“People talk about the national economy. We talk about whether the farm will make it through another season.”';
  const cityText = city.employment > 0.88 && city.foodSecurity > 0.95
    ? '“The shops stayed open. Customers kept coming. Most of us just wanted a little certainty.”'
    : '“You felt it first at the counter: fewer customers, harder choices, another shuttered window.”';
  const familyText = now.crime < 0.1 && now.health > 0.65
    ? '“Safe streets and someone to see you when you were ill. That’s what we’ll remember.”'
    : '“The speeches were one thing. What happened on our street was another.”';

  return [
    {
      who: 'From the farming communities',
      text: farmText,
      metric: reportMetric(farm, 'happiness'),
    },
    {
      who: 'From the city high streets',
      text: cityText,
      metric: reportMetric(city, 'employment'),
    },
    {
      who: 'From families across the country',
      text: familyText,
      metric: `${(now.health * 100).toFixed(0)}% health · ${reportMetric(now, 'crime')}`,
    },
  ];
}

function reportChanges(initial: Summary, now: Summary): MandateReport['changes'] {
  return [
    {
      label: 'Public approval',
      before: initial.approval,
      after: now.approval,
      unit: 'percent',
    },
    {
      label: 'Wellbeing',
      before: initial.happiness,
      after: now.happiness,
      unit: 'percent',
    },
    {
      label: 'Employment',
      before: initial.employment,
      after: now.employment,
      unit: 'percent',
    },
    {
      label: 'Food needs met',
      before: initial.foodSecurity,
      after: now.foodSecurity,
      unit: 'percent',
    },
    {
      label: 'Reserves / resident',
      before: initial.wealth,
      after: now.wealth,
      unit: 'money',
    },
    {
      label: 'Public debt',
      before: initial.debt,
      after: now.debt,
      unit: 'money',
    },
  ];
}

function memorableMoments(game: Game): Article[] {
  return game.articles
    .filter(article => {
      return article.category === 'dispatch'
        || article.category === 'culture'
        || article.category === 'economy';
    })
    .slice(0, 8)
    .reverse();
}

export function mandateReport(game: Game): MandateReport {
  const now = summarize(game.model);
  const farmers = game.model.cells.filter(
    cell => cell.population > 0 && cell.agriculture > 0.32,
  );
  const cities = game.model.cells.filter(cell => cell.biome === 'city');
  const farm = summarize(game.model, farmers.map(cell => cell.id));
  const city = summarize(game.model, cities.map(cell => cell.id));
  const chains = policyChains(game);
  const closing = chains.length
    ? 'This is a record of simulated outcomes, with fictional voices selected from measured living conditions. The linked stories show recorded contributing factors, including your decisions; chance and other pressures also mattered.'
    : 'This is a record of simulated outcomes, with fictional voices selected from measured living conditions. No complete policy-to-news chain was recorded for this mandate. The figures and dispatches above remain the record of what happened.';

  return {
    title: 'The country you leave behind',
    verdict: mandateVerdict(now.approval),
    opening: mandateOpening(game, now),
    voices: reportVoices(now, farm, city),
    changes: reportChanges(game.initial, now),
    moments: memorableMoments(game),
    chains,
    closing,
  };
}
