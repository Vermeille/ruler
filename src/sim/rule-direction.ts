import {
  RULE_DIRECTIONS,
  type Effect,
  type Rule,
  type RuleDirection,
} from './types';

export type RuleOutputDomain = 'mapxel' | 'people' | 'meta';

const PEOPLE_EFFECT_KINDS = new Set<Effect['kind']>([
  'population-transfer',
  'population-transition',
  'population-state',
  'population-delta',
]);

export function ruleOutputDomain(direction: RuleDirection): Exclude<RuleOutputDomain, 'meta'> {
  return direction === 'mapxel-to-people' || direction === 'people-to-people'
    ? 'people'
    : 'mapxel';
}

export function effectOutputDomain(effect: Effect): RuleOutputDomain {
  if (effect.kind === 'event') return 'meta';
  return PEOPLE_EFFECT_KINDS.has(effect.kind) ? 'people' : 'mapxel';
}

export function assertRuleDirection(rule: Rule): void {
  if (!RULE_DIRECTIONS.includes(rule.direction)) {
    throw new Error(`Unknown rule direction on ${rule.id}: ${String(rule.direction)}`);
  }
}

/**
 * Enforce the right-hand side of the four-arrow contract.
 *
 * Reads are intentionally not restricted here. A mapxel→people rule may need to
 * inspect current person state to determine susceptibility, and a people→mapxel
 * rule may need world context to determine what an action accomplishes. Those
 * read-side choices are surfaced by developer analysis rather than prohibited.
 */
export function assertRuleEffects(rule: Rule, effects: readonly Effect[]): void {
  assertRuleDirection(rule);
  const expected = ruleOutputDomain(rule.direction);

  for (const effect of effects) {
    const actual = effectOutputDomain(effect);
    if (actual === 'meta' || actual === expected) continue;
    throw new Error(
      `Rule ${rule.id} declares ${rule.direction} but emitted ${effect.kind} (${actual} output).`,
    );
  }
}
