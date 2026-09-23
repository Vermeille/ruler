import {
  adaptationRule,
  consumptionRule,
  marketRule,
  productionRule,
  tradeRule,
} from './rules/economy';
import { eventRule } from './rules/events';
import { populationAggregationRule } from './population/aggregation';
import { populationExperienceRule } from './population/experience';
import { populationAgingRule, populationDemographicsRule } from './population/demographics';
import { retrainingRule } from './population/retraining';
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
  populationAggregationRule,
  populationExperienceRule,
  populationAgingRule,
  populationDemographicsRule,
  retrainingRule,
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
  populationExperienceRule,
  populationAgingRule,
  populationDemographicsRule,
  migrationRule,
  retrainingRule,
  eventRule,
  populationAggregationRule,
];
