import type { Cause, DeepReadonly, Effect, Evidence, Game, Model } from '../types';

type ProvenanceWrites = Record<string, string>;
type PopulationEffect = Extract<Effect, {
  kind: 'population-transfer' | 'population-transition' | 'population-state' | 'population-delta'
}>;

export function recordCause(
  game: Game,
  snapshot: DeepReadonly<Model>,
  rule: string,
  evidence: Evidence,
  magnitude: number,
  provenance = game.provenance,
): string {
  const parents = new Set<string>();

  for (const key of evidence.parents ?? []) {
    if (provenance[key]) parents.add(provenance[key]);
  }

  const observations = (evidence.reads ?? []).map(read => {
    const key = 'group' in read ? `group:${read.group}:${read.field}` : `${read.cell}:${read.field}`;
    const source = provenance[key];
    if (source) parents.add(source);

    if ('group' in read) {
      const group = snapshot.populationGroups[read.cell]?.find(item => item.id === read.group);
      if (!group) throw new Error(`Evidence references unknown population group ${read.group}.`);
      const value = read.field in group.attitudes
        ? group.attitudes[read.field as keyof typeof group.attitudes]
        : Number(group[read.field as keyof typeof group]);
      return { ...read, value };
    }

    return {
      ...read,
      value: snapshot.cells[read.cell][read.field],
    };
  });

  const id = `c${game.model.tick}-${game.causes.length}`;
  const cause: Cause = {
    id,
    tick: game.model.tick,
    rule,
    title: evidence.title,
    detail: evidence.detail,
    cells: [...evidence.cells],
    parents: [...parents],
    observations,
    magnitude,
  };

  game.causes.push(cause);
  return id;
}

/**
 * Causal records created inside a phase only see provenance that existed at phase start.
 * Writes are buffered until commit so simultaneous effects cannot causally depend on one another.
 */
export function createPhaseCausality(
  game: Game,
  snapshot: DeepReadonly<Model>,
) {
  const provenance = game.provenance;
  const writes: ProvenanceWrites = {};
  const eventIds = new Map<string, string>();
  const pendingEventLinks: { eventKey: string; provenanceKey: string }[] = [];

  const linkToEvent = (eventKey: string, provenanceKey: string) => {
    const eventId = eventIds.get(eventKey);
    if (eventId) writes[provenanceKey] = eventId;
    else pendingEventLinks.push({ eventKey, provenanceKey });
  };

  function recordEvent(rule: string, effect: Extract<Effect, { kind: 'event' }>): void {
    const causeId = recordCause(game, snapshot, rule, effect.evidence, 1, provenance);
    eventIds.set(effect.key, causeId);
    game.lastEvents[effect.key] = game.model.tick;
    game.articles.unshift({
      ...effect.article,
      id: `event-${causeId}`,
      tick: game.model.tick,
      causeIds: [causeId],
    });
  }

  function recordEffect(rule: string, effect: Effect, actual: number): void {
    if (!('evidence' in effect) || !effect.evidence || Math.abs(actual) <= 1e-9) return;
    const causeId = recordCause(game, snapshot, rule, effect.evidence, Math.abs(actual), provenance);

    if (effect.kind === 'delta') {
      writes[`${effect.cell}:${effect.field}`] = causeId;
    }

    if (effect.kind === 'transfer' || effect.kind === 'trade') {
      for (const cell of [effect.from, effect.to]) {
        if (typeof cell === 'number') writes[`${cell}:${effect.resource}`] = causeId;
      }
    }
  }

  function linkEventDelta(effect: Extract<Effect, { kind: 'delta' }>): void {
    if (!effect.eventKey) return;
    linkToEvent(effect.eventKey, `${effect.cell}:${effect.field}`);
  }

  function recordPopulation(
    rule: string,
    effect: PopulationEffect,
    actual: number,
    resultingGroup?: number,
  ): void {
    const fields = effect.kind === 'population-state' ? Object.keys(effect.change)
      : effect.kind === 'population-transition' ? Object.keys(effect.transition)
        : ['count'];

    if (effect.kind === 'population-state' && effect.eventKey && resultingGroup !== undefined) {
      for (const field of fields) {
        linkToEvent(effect.eventKey, `group:${resultingGroup}:${field}`);
      }
    }

    if (!effect.evidence || actual <= 1e-9) return;
    const causeId = recordCause(game, snapshot, rule, effect.evidence, actual, provenance);
    const cells = effect.kind === 'population-transfer' ? [effect.from, effect.to] : [effect.cell];
    for (const cell of cells) writes[`${cell}:population`] = causeId;

    if (resultingGroup !== undefined) {
      for (const field of fields) writes[`group:${resultingGroup}:${field}`] = causeId;
    }
  }

  function commit(): void {
    for (const { eventKey, provenanceKey } of pendingEventLinks) {
      const eventId = eventIds.get(eventKey);
      if (eventId) writes[provenanceKey] = eventId;
    }
    Object.assign(game.provenance, writes);
  }

  return { recordEvent, recordEffect, linkEventDelta, recordPopulation, commit };
}