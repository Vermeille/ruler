import {
  adaptationRule,
  consumptionRule,
  marketRule,
  productionRule,
  tradeRule,
} from './rules/economy';
import { eventRule } from './rules/events';
import { migrationRule, societyRule } from './rules/society';
import { financingRule, fiscalRule, taxationRule } from './rules/state';
import type { Rule } from './types';

export {
  adaptationRule,
  consumptionRule,
  eventRule,
  financingRule,
  fiscalRule,
  marketRule,
  migrationRule,
  productionRule,
  societyRule,
  taxationRule,
  tradeRule,
};

export const defaultRules: readonly Rule[] = [
  productionRule,
  tradeRule,
  consumptionRule,
  marketRule,
  taxationRule,
  financingRule,
  fiscalRule,
  societyRule,
  migrationRule,
  adaptationRule,
  eventRule,
];
