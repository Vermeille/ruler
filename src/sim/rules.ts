import {
  consumptionRule,
  marketRule,
  productionRule,
  tradeRule,
} from './rules/economy';
import { eventRule } from './rules/events';
import { populationAggregationRule } from './population/aggregation';
import { populationExperienceRule } from './population/experience';
import { populationCrimeRule } from './population/crime';
import { populationEmploymentRule } from './population/employment';
import { populationAgingRule, populationLifeStageRule } from './population/aging';
import { populationDemographicsRule } from './population/demographics';
import { retrainingRule } from './population/retraining';
import { migrationRule, societyRule } from './rules/society';
import { financingRule, fiscalRule, taxationRule } from './rules/state';
import type { Rule } from './types';

export {
  consumptionRule,
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
