import type {
  DeepReadonly,
  Effect,
  Evidence,
  Mapxel,
  Rule,
} from '../types';
import { delta, isLand, read } from './helpers';

function violentCrimeChance(cell: DeepReadonly<Mapxel>): number {
  return 0.05 + cell.crime * 0.8;
}

export const eventRule: Rule = {
  id: 'stories.events',
  phase: 'events',
  description: 'Seeded, risk-conditioned events create shared memories and feed back into local and national life.',
  run({ model, random, lastEvents }) {
    const effects: Effect[] = [];
    const candidates = model.cells.filter(isLand);
    for (const cell of candidates) {
      if (cell.waterStress > 0) effects.push(delta(cell, 'waterStress', -cell.waterStress * 0.35));
    }

    // Pick one location per event family. Country size should not multiply the
    // probability of a national-scale event occurring in a given month.
    const choose = (channel: string) => {
      const index = Math.floor(random(-1, channel) * candidates.length);
      return candidates[index];
    };

    const crime = choose('crime-place');
    const crimeChance = violentCrimeChance(crime);
    const crimeCooldownElapsed = model.tick - (lastEvents.violentCrime ?? -12) >= 5;

    if (crimeCooldownElapsed && random(-1, 'crime-roll') < crimeChance) {
      const evidence: Evidence = {
        title: `A violent crime shakes ${crime.name}`,
        detail: `This stochastic event occurred with a ${(crimeChance * 100).toFixed(1)}% chance this month. Local crime risk influenced that chance; policy did not make the event inevitable.`,
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

      for (const cell of candidates) {
        effects.push({
          kind: 'delta',
          cell: cell.id,
          field: 'happiness',
          amount: cell.id === crime.id ? -0.06 : -0.008,
          eventKey: 'violentCrime',
        });
      }
    }

    const sport = choose('sport-place');
    const festivalChance = 0.12 + sport.sportsInterest * 0.35;
    const festivalCooldownElapsed = model.tick - (lastEvents.festival ?? -12) >= 4;

    if (festivalCooldownElapsed && random(-1, 'sport-roll') < festivalChance) {
      const evidence: Evidence = {
        title: `${sport.name} hosts a local cup`,
        detail: 'Sports interest raises the probability of a tournament. Visiting supporters increase local spending and enthusiasm; the boost fades toward ordinary demand over time.',
        cells: [sport.id],
        reads: [
          read(sport, 'sports', 'Sports employment'),
          read(sport, 'sportsInterest', 'Sports interest'),
        ],
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
        delta(sport, 'happiness', 0.04),
        {
          kind: 'transfer',
          from: 'external',
          to: sport.id,
          resource: 'cash',
          amount: sport.population * 0.4,
        },
      );
    }

    const farm = choose('weather-place');
    const droughtCooldownElapsed = model.tick - (lastEvents.drought ?? -12) >= 9;

    if (droughtCooldownElapsed && random(-1, 'weather-roll') < 0.1) {
      const affected = candidates.filter(cell => cell.region === farm.region);
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
          -cell.food * 0.35,
          {
            title: `${cell.name}: the drought reduces food reserves`,
            detail: 'Regional weather destroyed 35% of food in storage.',
            cells: [cell.id],
            reads: [read(cell, 'food', 'Stored food before drought')],
          },
        ));
        effects.push({ kind: 'delta', cell: cell.id, field: 'waterStress', amount: (1 - cell.waterStress) * 0.4, eventKey: 'drought' });
      }
    }

    return effects;
  },
};
