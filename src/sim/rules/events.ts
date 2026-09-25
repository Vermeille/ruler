import { resolveStepCache } from '../step-cache';
import type {
  DeepReadonly,
  Effect,
  Evidence,
  Mapxel,
  Model,
  PopulationGroup,
  Rule,
} from '../types';
import { crowns, personMonths } from '../units';
import { delta, isLand, read } from './helpers';

type EventRandom = (cell: number, channel?: string) => number;

type EventOutcomes = {
  candidates: readonly DeepReadonly<Mapxel>[];
  violentCrime?: { cell: DeepReadonly<Mapxel>; chance: number };
  festival?: { cell: DeepReadonly<Mapxel>; chance: number };
  drought?: { farm: DeepReadonly<Mapxel>; affected: readonly DeepReadonly<Mapxel>[] };
};

function violentCrimeChance(cell: DeepReadonly<Mapxel>): number {
  return 0.05 + cell.crime * 0.8;
}

function eventOutcomes(
  model: DeepReadonly<Model>,
  random: EventRandom,
  lastEvents: Readonly<Record<string, number>>,
): EventOutcomes {
  const candidates = model.cells.filter(isLand);
  const choose = (channel: string) => {
    const index = Math.floor(random(-1, channel) * candidates.length);
    return candidates[index];
  };

  const crime = choose('crime-place');
  const crimeChance = violentCrimeChance(crime);
  const crimeCooldownElapsed = model.tick - (lastEvents.violentCrime ?? -12) >= 5;
  const violentCrime = crimeCooldownElapsed && random(-1, 'crime-roll') < crimeChance
    ? { cell: crime, chance: crimeChance }
    : undefined;

  const sport = choose('sport-place');
  const festivalChance = 0.12 + sport.sportsInterest * 0.35;
  const festivalCooldownElapsed = model.tick - (lastEvents.festival ?? -12) >= 4;
  const festival = festivalCooldownElapsed && random(-1, 'sport-roll') < festivalChance
    ? { cell: sport, chance: festivalChance }
    : undefined;

  const farm = choose('weather-place');
  const droughtCooldownElapsed = model.tick - (lastEvents.drought ?? -12) >= 9;
  const drought = droughtCooldownElapsed && random(-1, 'weather-roll') < 0.1
    ? { farm, affected: candidates.filter(cell => cell.region === farm.region) }
    : undefined;

  return { candidates, violentCrime, festival, drought };
}

/** Exogenous and local world events alter places and create the event record. */
// [I] EVENT-WATER-RECOVERY1
// [I] EVENT-CRIME1
// [I] EVENT-FESTIVAL1
// [I] EVENT-FESTIVAL-EFFECT1
// [I] EVENT-DROUGHT1
// [I] EVENT-DROUGHT-EFFECT1
export const eventRule: Rule = {
  id: 'stories.events',
  direction: 'mapxel-to-mapxel',
  randomNamespace: 'stories.events',
  phase: 'events',
  description: 'Seeded risk-conditioned events alter world state; population experience is handled separately.',
  run({ model, cache, random, lastEvents }) {
    const peopleCache = resolveStepCache(model, cache);
    const effects: Effect[] = [];
    const outcomes = eventOutcomes(model, random, lastEvents);

    for (const cell of outcomes.candidates) {
      if (cell.waterStress > 0) effects.push(delta(cell, 'waterStress', -cell.waterStress * 0.35));
    }

    if (outcomes.violentCrime) {
      const crime = outcomes.violentCrime.cell;
      const evidence: Evidence = {
        title: `A violent crime shakes ${crime.name}`,
        detail: `This stochastic event occurred with a ${(outcomes.violentCrime.chance * 100).toFixed(1)}% chance this month. Local crime risk influenced that chance; policy did not make the event inevitable.`,
        cells: [crime.id],
        reads: [read(crime, 'crime', 'Local crime risk')],
        parents: ['policy:spending:police'],
      };
      effects.push({
        kind: 'event',
        key: 'violentCrime',
        evidence,
        article: {
          category: 'dispatch',
          headline: 'A quiet street, a national conversation',
          body: `A violent assault in ${crime.name} has shaken the Commonwealth. Residents are asking whether their streets are safe. The incident has lowered morale locally and, more slightly, across the country.`,
          voice: 'Mira Vale · Public affairs',
          cell: crime.id,
          tone: 'bad',
        },
      });
    }

    if (outcomes.festival) {
      const sport = outcomes.festival.cell;
      const evidence: Evidence = {
        title: `${sport.name} hosts a local cup`,
        detail: 'Sports interest raises the probability of a tournament. Visiting supporters increase local spending and enthusiasm; the boost fades toward ordinary demand over time.',
        cells: [sport.id],
        reads: [read(sport, 'sportsInterest', 'Sports interest')],
        parents: [`${sport.id}:subsidy:sports`, 'policy:spending:culture'],
      };
      effects.push(
        {
          kind: 'event',
          key: 'festival',
          evidence,
          article: {
            category: 'culture',
            headline: 'For one afternoon, everyone agrees on something',
            body: `The ${sport.name} cup brought a full touchline, visiting fans, and a rare truce in local arguments. “Even the opposition cheered,” a vendor told us. Sports interest and local morale have risen.`,
            voice: 'Theo Reed · Culture & community',
            cell: sport.id,
            tone: 'good',
          },
        },
        delta(sport, 'sportsInterest', 0.15),
        {
          kind: 'transfer',
          from: 'external',
          to: sport.id,
          resource: 'cash',
          amount: crowns(peopleCache.peopleByCell[sport.id].population * 0.4),
        },
      );
    }

    if (outcomes.drought) {
      const { farm, affected } = outcomes.drought;
      const regionName = model.regions[farm.region];
      effects.push({
        kind: 'event',
        key: 'drought',
        evidence: {
          title: `Dry weather hits ${regionName}`,
          detail: 'A seeded regional drought destroys 35% of stored food and leaves fields water-stressed. Local harvests recover gradually as the ground recovers.',
          cells: affected.map(cell => cell.id),
        },
        article: {
          category: 'dispatch',
          headline: `Dry fields in ${regionName}`,
          body: 'An unusually dry month has damaged local food reserves and weakened the next harvest. Farmers are looking to their neighbors for supplies.',
          voice: 'The Commonwealth Ledger · Regional desk',
          cell: farm.id,
          tone: 'bad',
        },
      });

      for (const cell of affected) {
        effects.push(delta(
          cell,
          'food',
          personMonths(-cell.food * 0.35),
          {
            title: `${cell.name}: the drought reduces food reserves`,
            detail: 'Regional weather destroyed 35% of food in storage.',
            cells: [cell.id],
            reads: [read(cell, 'food', 'Stored food before drought')],
          },
        ));
        effects.push({
          kind: 'delta',
          cell: cell.id,
          field: 'waterStress',
          amount: (1 - cell.waterStress) * 0.4,
          eventKey: 'drought',
        });
      }
    }

    return effects;
  },
};

type WellbeingShock = {
  cell: number;
  group: DeepReadonly<PopulationGroup>;
  change: number;
  eventKeys: Set<string>;
};

/** The same event draws are translated into the experience of the people who live through them. */
// [I] EVENT-CRIME-WELLBEING1
// [I] EVENT-FESTIVAL-EFFECT1
export const populationEventExperienceRule: Rule = {
  id: 'population.event-experience',
  direction: 'mapxel-to-people',
  randomNamespace: 'stories.events',
  phase: 'events',
  description: 'Crime and cultural events change the wellbeing of the population groups that experience them.',
  run({ model, random, lastEvents }) {
    const outcomes = eventOutcomes(model, random, lastEvents);
    const wellbeingShocks = new Map<number, WellbeingShock>();
    const shockWellbeing = (cell: DeepReadonly<Mapxel>, change: number, eventKey: string) => {
      for (const group of model.populationGroups[cell.id]) {
        const current = wellbeingShocks.get(group.id);
        if (current) {
          current.change += change;
          current.eventKeys.add(eventKey);
        } else {
          wellbeingShocks.set(group.id, {
            cell: cell.id,
            group,
            change,
            eventKeys: new Set([eventKey]),
          });
        }
      }
    };

    if (outcomes.violentCrime) {
      for (const cell of outcomes.candidates) {
        shockWellbeing(
          cell,
          cell.id === outcomes.violentCrime.cell.id ? -0.06 : -0.008,
          'violentCrime',
        );
      }
    }
    if (outcomes.festival) {
      shockWellbeing(outcomes.festival.cell, 0.04, 'festival');
    }

    const effects: Effect[] = [];
    for (const { cell, group, change, eventKeys } of wellbeingShocks.values()) {
      if (Math.abs(change) <= 1e-12) continue;
      effects.push({
        kind: 'population-state',
        cell,
        group: group.id,
        amount: group.count,
        change: { wellbeing: change },
        eventKey: eventKeys.size === 1 ? eventKeys.values().next().value : undefined,
      });
    }
    return effects;
  },
};
