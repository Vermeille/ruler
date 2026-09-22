import { approach, clamp } from './math';
import { debtLimit, forecastBudget, subsidyFor } from './policy';
import { SECTORS, type DeepReadonly, type Effect, type Evidence, type Mapxel, type MutableField, type Rule } from './types';
const delta = (c: DeepReadonly<Mapxel>, field: MutableField, amount: number, evidence?: Evidence): Effect => ({ kind: 'delta', cell: c.id, field, amount, evidence });
const read = (c: DeepReadonly<Mapxel>, field: MutableField, label: string) => ({ cell: c.id, field, label });
const land = (c: DeepReadonly<Mapxel>) => c.biome !== 'water';
const change = (c: DeepReadonly<Mapxel>, field: MutableField, target: number, rate: number, evidence?: Evidence): Effect => delta(c, field, approach(c[field], target, rate), evidence);
export const productionRule: Rule = {
  id: 'economy.production', phase: 'production', description: 'Land, labor, health, and seasonal weather produce food and materials. Exports bring in money.',
  run({ model: m, random }) {
    return m.cells.filter(land).flatMap(c => {
      const weather = .96 + random(c.id, 'weather') * .08 + Math.sin(m.tick * Math.PI / 6) * .09;
      const labor = c.employment * (.65 + .35 * c.health);
      const food = c.population * c.agriculture * (3 + 2 * c.fertility) * labor * weather * (1 - c.pollution * .18);
      const materials = c.population * c.manufacturing * (1.4 + c.minerals) * labor * (m.policy.laws.cleanAir ? .9 : 1);
      const output = c.population * labor * (c.agriculture * 6 * c.price + c.manufacturing * 10 * (m.policy.laws.cleanAir ? .93 : 1) + c.services * 9 * c.businessHealth + c.sports * (4 + c.sportsInterest * 7));
      return [delta(c, 'food', food), delta(c, 'materials', materials), delta(c, 'output', output - c.output), delta(c, 'foodMade', food - c.foodMade), delta(c, 'foodTraded', -c.foodTraded), { kind: 'transfer', from: 'external', to: c.id, resource: 'cash', amount: output * .65 }];
    });
  },
};
export const tradeRule: Rule = {
  id: 'economy.neighbor-trade', phase: 'trade', description: 'Neighbors exchange stocks and money at a midpoint price, limited by roads, inventory, and buyer cash.',
  run({ model: m }) {
    const effects: Effect[] = [];
    for (const a of m.cells.filter(land)) for (const id of m.neighbors[a.id]) {
      if (id <= a.id) continue;
      const b = m.cells[id];
      for (const resource of ['food', 'materials'] as const) {
        const aStock = a[resource] / a.population, bStock = b[resource] / b.population;
        const [seller, buyer] = aStock > bStock ? [a, b] : [b, a];
        const road = .18 + .55 * Math.min(a.infrastructure, b.infrastructure);
        const equalize = Math.abs(aStock - bStock) * a.population * b.population / (a.population + b.population);
        const amount = Math.min(equalize * road, seller.population * .85);
        if (amount < .01) continue;
        const price = resource === 'food' ? (a.price + b.price) / 2 : .65;
        const evidence = resource === 'food' && buyer.foodSecurity < .92 && amount > buyer.population * .1 ? {
          title: `Food flows from ${seller.name} to ${buyer.name}`,
          detail: `${amount.toFixed(0)} units offered along a neighboring road. Settlement is limited by available stock and cash. Transport links determine how quickly shortages can be relieved.`,
          cells: [buyer.id, seller.id], reads: [read(seller, 'agriculture', 'Supplier farm employment'), read(buyer, 'foodSecurity', 'Buyer food security'), read(buyer, 'infrastructure', 'Buyer transport access')],
        } : undefined;
        effects.push({ kind: 'trade', from: seller.id, to: buyer.id, resource, amount, price, evidence });
      }
    }
    return effects;
  },
};
export const consumptionRule: Rule = {
  id: 'economy.households', phase: 'consumption', description: 'Households eat first; food shortages constrain restaurants. Imports and spoilage prevent unlimited stock accumulation.',
  run({ model: m }) {
    return m.cells.filter(land).flatMap(c => {
      const need = c.population, eaten = Math.min(c.food, need), security = eaten / need;
      const foodEvidence = Math.abs(security - c.foodSecurity) > .08 || (security < .85 && m.tick % 6 === 0) ? {
        title: `${c.name}: ${security < .9 ? 'food supplies fall short' : 'food supplies recover'}`,
        detail: `Households could meet ${(security * 100).toFixed(0)}% of this month's food needs. Farms produced ${c.foodMade.toFixed(0)} units; net neighboring trade was ${c.foodTraded.toFixed(0)} units.`,
        cells: [c.id], reads: [read(c, 'agriculture', 'Farm employment share'), read(c, 'food', 'Available food'), read(c, 'population', 'Residents to feed'), read(c, 'infrastructure', 'Transport access')],
      } : undefined;
      const remaining = Math.max(0, c.food - eaten);
      return [
        delta(c, 'food', -eaten - remaining * .16), delta(c, 'foodUsed', eaten - c.foodUsed),
        delta(c, 'materials', -Math.min(c.materials, c.population * .08 + c.materials * .12)),
        delta(c, 'foodSecurity', security - c.foodSecurity, foodEvidence),
        { kind: 'transfer', from: c.id, to: 'external', resource: 'cash', amount: c.population * (1.6 + c.cash / c.population * .04) + c.output * .09 },
      ];
    });
  },
};
export const marketRule: Rule = {
  id: 'economy.businesses', phase: 'market', description: 'Scarcity changes local prices; expensive ingredients and unmet food needs squeeze restaurants and shops.',
  run({ model: m }) {
    return m.cells.filter(land).flatMap(c => {
      const targetPrice = clamp(1 + (1 - Math.min(2, (c.foodUsed + c.food / .84) / c.population)) * 1.3 + (1 - c.foodSecurity) * 1.8, .55, 4.5);
      const priceEvidence = Math.abs(targetPrice - c.price) > .5 && m.tick % 3 === 0 ? {
        title: `${c.name}: food prices ${targetPrice > c.price ? 'rise' : 'ease'}`, detail: 'Prices move gradually toward the local supply-demand balance. Scarcity raises the return to farming, but workers take time to change industries.', cells: [c.id], reads: [read(c, 'foodSecurity', 'Last measured food security'), read(c, 'agriculture', 'Farm employment'), read(c, 'food', 'Stock available')],
      } : undefined;
      const businessTarget = clamp(.97 - (1 - c.foodSecurity) * .9 - Math.max(0, c.price - 1.4) * .17 - c.crime * .25, .12, 1);
      const businessEvidence = businessTarget < c.businessHealth - .12 ? {
        title: `${c.name}: restaurants and shops struggle`, detail: 'Food shortages, expensive ingredients, and insecurity squeeze local businesses. A weaker business sector cuts output and employment in subsequent months.', cells: [c.id], reads: [read(c, 'foodSecurity', 'Food security'), read(c, 'price', 'Ingredient price index'), read(c, 'crime', 'Local crime')],
      } : undefined;
      return [change(c, 'price', targetPrice, .14, priceEvidence), change(c, 'businessHealth', businessTarget, .15, businessEvidence)];
    });
  },
};
export const taxationRule: Rule = {
  id: 'state.taxation', phase: 'taxation', description: 'Collect income and business taxes on measured output, limited by liquid private funds.',
  run({ model: m }) {
    const effects: Effect[] = [];
    let revenue = 0;
    for (const c of m.cells.filter(land)) {
      const due = Math.min(c.cash, c.output * (.7 * m.policy.incomeTax + .3 * m.policy.businessTax));
      revenue += due; effects.push({ kind: 'transfer', from: c.id, to: 'treasury', resource: 'cash', amount: due });
    }
    effects.push({ kind: 'budget', value: { revenue, spending: 0, interest: 0, borrowed: 0, funding: 1 }, debtDelta: 0 }); return effects;
  },
};
export const financingRule: Rule = {
  id: 'state.financing', phase: 'financing', description: 'Borrow only to cover a cash shortfall, up to a transparent per-resident credit limit.',
  run({ model: m }) {
    const forecast = forecastBudget(m), borrowed = Math.max(0, Math.min(forecast.spending + forecast.interest - m.treasury, debtLimit(m) - m.debt, m.externalCash));
    return [{ kind: 'transfer', from: 'external', to: 'treasury', resource: 'cash', amount: borrowed }, { kind: 'budget', value: { ...m.budget, borrowed }, debtDelta: borrowed }];
  },
};
export const fiscalRule: Rule = {
  id: 'state.services', phase: 'fiscal', description: 'Public services and targeted subsidies compete for a finite budget. Unfunded services weaken rather than creating money.',
  run({ model: m }) {
    const forecast = forecastBudget(m), interest = Math.min(m.treasury, forecast.interest);
    const funding = forecast.spending > 0 ? clamp((m.treasury - interest) / forecast.spending) : 1;
    const effects: Effect[] = [{ kind: 'transfer', from: 'treasury', to: 'external', resource: 'cash', amount: interest }];
    for (const c of m.cells.filter(land)) {
      const basic = c.population * Object.values(m.policy.spending).reduce((a, b) => a + b, 0) * funding;
      const subsidy = c.population * SECTORS.reduce((a, sector) => a + c[sector] * subsidyFor(m, c, sector), 0) * funding;
      effects.push({ kind: 'transfer', from: 'treasury', to: c.id, resource: 'cash', amount: basic * .72 + subsidy });
      effects.push({ kind: 'transfer', from: 'treasury', to: 'external', resource: 'cash', amount: basic * .28 });
    }
    effects.push({ kind: 'budget', value: { ...m.budget, spending: forecast.spending * funding, interest, funding }, debtDelta: forecast.interest - interest });
    return effects;
  },
};
export const societyRule: Rule = {
  id: 'society.wellbeing', phase: 'society', description: 'Poverty and neighboring inequality drive crime; services, health, food, and civil liberties shape wellbeing.',
  run({ model: m }) {
    return m.cells.filter(land).flatMap(c => {
      const s = m.policy.spending, funding = m.budget.funding, wealth = c.cash / c.population;
      const neighbors = m.neighbors[c.id].map(id => m.cells[id]);
      const neighborWealth = neighbors.reduce((a, n) => a + n.cash / n.population, 0) / Math.max(1, neighbors.length);
      const inequality = clamp((neighborWealth - wealth) / 40), poverty = clamp((24 - wealth) / 24);
      const police = s.police * funding;
      const crimeTarget = clamp(.11 + poverty * .3 + inequality * .24 + (1 - c.employment) * .3 - police * .3 - s.welfare * funding * .09, .015, .7);
      const crimeEvidence = Math.abs(crimeTarget - c.crime) > .06 && m.tick % 3 === 0 ? {
        title: `${c.name}: crime pressure ${crimeTarget > c.crime ? 'rises' : 'recedes'}`, detail: `Private reserves are ₡${wealth.toFixed(1)} per resident, compared with ₡${neighborWealth.toFixed(1)} next door. Effective police funding is ₡${police.toFixed(2)} per resident.`, cells: [c.id], reads: [read(c, 'cash', 'Private reserves'), read(c, 'employment', 'Employment'), ...neighbors.slice(0, 2).map(n => read(n, 'cash', 'Neighbor reserves'))], parents: ['policy:spending:police', 'policy:spending:welfare', 'policy:incomeTax', 'policy:businessTax'],
      } : undefined;
      const healthTarget = clamp(.55 + s.health * funding * .5 - c.pollution * .18 - (1 - c.foodSecurity) * .35 + wealth * .001);
      const educationTarget = clamp(.35 + s.education * funding * .6 + wealth * .002);
      const infrastructureTarget = clamp(.3 + s.infrastructure * funding * .9 + Math.min(1, c.materials / c.population) * .06);
      const pollutionTarget = clamp(c.manufacturing * (m.policy.laws.cleanAir ? .6 : 1.1) + c.population / 12000 - s.environment * funding * .7);
      const employmentTarget = clamp(.96 - (1 - c.businessHealth) * c.services * .6 - m.policy.businessTax * .12 - (1 - c.foodSecurity) * .05, .45, .98);
      const happyTarget = clamp(.29 + c.health * .22 + c.foodSecurity * .2 + c.employment * .16 + clamp(wealth / 45) * .08 - c.crime * .45 - c.pollution * .08 + s.culture * funding * .12 - (m.policy.laws.publicAssembly ? 0 : .12));
      const approvalTarget = clamp(c.happiness * .82 + .12 - m.policy.incomeTax * .25 - (1 - funding) * .17 + (m.policy.laws.publicAssembly ? .025 : -.06));
      return [change(c, 'crime', crimeTarget, .12, crimeEvidence), change(c, 'health', healthTarget, .045), change(c, 'education', educationTarget, .025), change(c, 'infrastructure', infrastructureTarget, .06), change(c, 'pollution', pollutionTarget, .08), change(c, 'employment', employmentTarget, .1), change(c, 'happiness', happyTarget, .09), change(c, 'approval', approvalTarget, .12), change(c, 'sportsInterest', clamp(.17 + c.sports * .85 + s.culture * funding * .6), .06),
        delta(c, 'population', c.population * ((.00065 + c.happiness * .00055 + c.health * .0002) - (.00095 + (1 - c.health) * .0005 + (1 - c.foodSecurity) * .0008))),
        change(c, 'children', clamp(.15 + c.happiness * .09, .12, .28), .008), change(c, 'seniors', clamp(.12 + c.health * .07, .12, .22), .005),
      ];
    });
  },
};
export const migrationRule: Rule = {
  id: 'society.migration', phase: 'migration', description: 'Residents move to adjacent opportunities, carrying their savings. Moves are gradual and population-conserving.',
  run({ model: m }) {
    const effects: Effect[] = [];
    const appeal = (c: DeepReadonly<Mapxel>) => c.happiness + c.employment * .4 + clamp(c.cash / c.population / 60) * .15 - c.population / 15000;
    for (const a of m.cells.filter(land)) for (const id of m.neighbors[a.id]) {
      if (id <= a.id) continue;
      const b = m.cells[id], diff = appeal(b) - appeal(a), [from, to] = diff > 0 ? [a, b] : [b, a];
      const amount = from.population * Math.min(.003, Math.abs(diff) * .007) * (m.policy.laws.freeMovement ? 1 : .08);
      effects.push({ kind: 'transfer', from: from.id, to: to.id, resource: 'population', amount });
      effects.push({ kind: 'transfer', from: from.id, to: to.id, resource: 'cash', amount: amount * from.cash / from.population });
    }
    return effects;
  },
};
export const adaptationRule: Rule = {
  id: 'economy.labor', phase: 'adaptation', description: 'Workers slowly shift toward profitable industries. Subsidies attract labor; high food prices pull workers back into farming.',
  run({ model: m }) {
    return m.cells.filter(land).flatMap(c => {
      const base = { agriculture: .24 + c.fertility * .19, manufacturing: .13 + c.minerals * .1, services: .36, sports: .045 + c.sportsInterest * .06 };
      const returns = { agriculture: (c.price - 1) * 1.1, manufacturing: c.education * .2 - (m.policy.laws.cleanAir ? .08 : 0), services: (c.businessHealth - .85) * .8, sports: c.sportsInterest * .25 };
      const weights = SECTORS.map(k => base[k] * Math.exp(clamp(returns[k] + subsidyFor(m, c, k) * m.budget.funding * 1.1, -2, 4)));
      const total = weights.reduce((a, b) => a + b, 0);
      return SECTORS.map((sector, i) => {
        const amount = approach(c[sector], weights[i] / total, .065);
        const significant = Math.abs(amount) > .0035 && (m.tick % 3 === 0 || m.tick === 1);
        return delta(c, sector, amount, significant ? {
          title: `${c.name}: workers ${amount > 0 ? 'enter' : 'leave'} ${sector}`, detail: `${Math.abs(amount * c.population).toFixed(1)} residents' worth of employment shifts ${amount > 0 ? 'into' : 'out of'} ${sector}. Local food prices, business conditions, and relative subsidies determine the new mix.`, cells: [c.id], reads: [read(c, 'price', 'Food price signal'), read(c, 'businessHealth', 'Business viability'), read(c, 'sportsInterest', 'Demand for sport')], parents: SECTORS.map(k => `${c.id}:subsidy:${k}`),
        } : undefined);
      });
    });
  },
};
export const eventRule: Rule = {
  id: 'stories.events', phase: 'events', description: 'Seeded, risk-conditioned events create shared memories and feed back into local and national life.',
  run({ model: m, random, lastEvents }) {
    const effects: Effect[] = [], candidates = m.cells.filter(land);
    // One candidate per event family, per month: world size does not multiply national catastrophe rates.
    const choose = (channel: string) => candidates[Math.floor(random(-1, channel) * candidates.length)];
    const crime = choose('crime-place');
    if (m.tick - (lastEvents.violentCrime ?? -12) >= 5 && random(-1, 'crime-roll') < .05 + crime.crime * .8) {
      const evidence: Evidence = { title: `A violent crime shakes ${crime.name}`, detail: `This stochastic event occurred with a ${((.05 + crime.crime * .8) * 100).toFixed(1)}% chance this month. Local crime risk influenced that chance; policy did not make the event inevitable.`, cells: [crime.id], reads: [read(crime, 'crime', 'Local crime risk')], parents: ['policy:spending:police'] };
      effects.push({ kind: 'event', key: 'violentCrime', evidence, article: { category: 'dispatch', headline: `A quiet street, a national conversation`, body: `A violent assault in ${crime.name} has shaken the Commonwealth. Residents are asking whether their streets are safe. The incident has lowered morale locally and, more slightly, across the country.`, voice: 'Mira Vale · Public affairs', cell: crime.id, tone: 'bad' } });
      for (const c of candidates) effects.push({ kind: 'delta', cell: c.id, field: 'happiness', amount: c.id === crime.id ? -.06 : -.008, eventKey: 'violentCrime' });
    }
    const sport = choose('sport-place');
    if (m.tick - (lastEvents.festival ?? -12) >= 4 && random(-1, 'sport-roll') < .12 + sport.sportsInterest * .35) {
      const evidence: Evidence = { title: `${sport.name} hosts a local cup`, detail: 'Sports interest raises the probability of a tournament. Visiting supporters increase local spending and enthusiasm; the boost fades toward ordinary demand over time.', cells: [sport.id], reads: [read(sport, 'sports', 'Sports employment'), read(sport, 'sportsInterest', 'Sports interest')], parents: [`${sport.id}:subsidy:sports`, 'policy:spending:culture'] };
      effects.push({ kind: 'event', key: 'festival', evidence, article: { category: 'culture', headline: 'For one afternoon, everyone agrees on something', body: `The ${sport.name} cup brought a full touchline, visiting fans, and a rare truce in local arguments. “Even the opposition cheered,” a vendor told us. Sports interest and local morale have risen.`, voice: 'Theo Reed · Culture & community', cell: sport.id, tone: 'good' } }, delta(sport, 'sportsInterest', .15), delta(sport, 'happiness', .04), { kind: 'transfer', from: 'external', to: sport.id, resource: 'cash', amount: sport.population * .4 });
    }
    const farm = choose('weather-place');
    if (m.tick - (lastEvents.drought ?? -12) >= 9 && random(-1, 'weather-roll') < .1) {
      const affected = candidates.filter(c => c.region === farm.region);
      effects.push({ kind: 'event', key: 'drought', evidence: { title: `Dry weather hits ${m.regions[farm.region]}`, detail: 'A seeded regional weather shock destroys 35% of stored food. Neighbor trade and the remaining buffer determine whether households go hungry next month.', cells: affected.map(c => c.id) }, article: { category: 'dispatch', headline: `Dry fields in ${m.regions[farm.region]}`, body: 'An unusually dry month has damaged local food reserves. Farmers are looking to their neighbors for supplies. Well-connected communities may weather the disruption more easily.', voice: 'The Commonwealth Ledger · Regional desk', cell: farm.id, tone: 'bad' } });
      for (const c of affected) effects.push(delta(c, 'food', -c.food * .35, { title: `${c.name}: the drought reduces food reserves`, detail: 'Regional weather destroyed 35% of food in storage.', cells: [c.id], reads: [read(c, 'food', 'Stored food before drought')] }));
    }
    return effects;
  },
};
export const defaultRules: readonly Rule[] = [productionRule, tradeRule, consumptionRule, marketRule, taxationRule, financingRule, fiscalRule, societyRule, migrationRule, adaptationRule, eventRule];
