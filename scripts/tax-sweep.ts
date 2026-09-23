import { writeFileSync } from 'node:fs';
import { createGame } from '../src/sim/world';
import { step } from '../src/sim/engine';
import { defaultRules } from '../src/sim/rules';
import { enact } from '../src/sim/policy';
import { summarize } from '../src/sim/math';
import type { Action } from '../src/sim/types';

interface SweepRecord {
  revenue: number;
  output: number;
  wealth: number;
  employment: number;
  food: number;
  funding: number;
}

const arg = (name: string, fallback: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const rates = arg('rates', '0,0.15,0.3,0.45,0.6,0.65').split(',').map(Number);
const months = Number(arg('months', '48'));
const seeds = arg('seeds', 'alder-42').split(',');
const modes = arg('modes', 'income,business,both').split(',');
const result: Record<string, unknown>[] = [];
for (const seed of seeds) for (const mode of modes) for (const rate of rates) {
  let game = createGame(seed, 18, 14, months);
  const actions: Action[] = [];
  if (mode !== 'business') actions.push({ type: 'tax', tax: 'incomeTax', rate });
  if (mode !== 'income') actions.push({ type: 'tax', tax: 'businessTax', rate });
  game = enact(game, actions);
  const records: SweepRecord[] = [];
  for (let i = 0; i < months; i++) {
    game = step(game, defaultRules.filter(r => r.phase !== 'events'));
    const s = summarize(game.model);
    records.push({ revenue: game.model.budget.revenue / game.initial.population, output: s.output / game.initial.population, wealth: s.wealth, employment: s.employment, food: s.foodSecurity, funding: game.model.budget.funding });
  }
  const final = records.slice(-12), mean = (k: keyof SweepRecord) => final.reduce((s, r) => s + r[k], 0) / final.length;
  const row = { seed, mode, rate, months, firstMonthRevenue: records[0].revenue, revenue: mean('revenue'), output: mean('output'), wealth: mean('wealth'), employment: mean('employment'), food: mean('food'), funding: mean('funding') };
  result.push(row); console.log(JSON.stringify(row));
}
const output = arg('out', '');
if (output) writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
