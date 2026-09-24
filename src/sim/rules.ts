import {
  consumptionRule,
  marketRule,
  productionRule,
  tradeRule,
} from './rules/economy';
import { environmentRule } from './rules/environment';
import { eventRule } from './rules/events';
import { populationAggregationRule } from './population/aggregation';
import { populationExperienceRule } from './population/experience';
import { populationCrimeRule } from './population/crime';
import { populationEmploymentRule } from './population/employment';
import { populationAgingRule, populationLifeStageRule } from './population/aging';
import { populationDemographicsRule } from './population/demographics';
import { migrationRule } from './population/migration';
import { retrainingRule } from './population/retraining';
import { financingRule, fiscalRule, taxationRule } from './rules/state';
import type { Rule } from './types';

/** Compatibility alias while callers migrate from the old aggregate society module name. */
export const societyRule = environmentRule;

export {
  consumptionRule,
  environmentRule,
  eventRule,
  financingRule,
  fiscalRule,
  marketRule,
  migrationRule,
  productionRule,
  populationAggregationRule,
  populationExperienceRule,
  populationCrimeRule,
  populationEmploymentRule,
  populationAgingRule,
  populationLifeStageRule,
  populationDemographicsRule,
  retrainingRule,
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
  environmentRule,
  populationEmploymentRule,
  populationExperienceRule,
  populationCrimeRule,
  populationAgingRule,
  populationLifeStageRule,
  populationDemographicsRule,
  migrationRule,
  retrainingRule,
  eventRule,
  populationAggregationRule,
];
