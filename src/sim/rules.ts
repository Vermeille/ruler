import {
  consumptionRule,
  marketRule,
  productionRule,
  tradeRule,
} from './rules/economy';
import { environmentRule, populationEnvironmentImpactRule } from './rules/environment';
import { eventRule, populationEventExperienceRule } from './rules/events';
import { populationAggregationRule } from './population/aggregation';
import {
  populationExperienceRule,
  populationInternalAttitudesRule,
} from './population/experience';
import { populationCrimeRule } from './population/crime';
import { populationEmploymentRule } from './population/employment';
import { populationAgingRule, populationLifeStageRule } from './population/aging';
import {
  populationDemographicsRule,
  populationStarvationRule,
  starvationReportRule,
} from './population/demographics';
import { migrationCashRule, migrationRule } from './population/migration';
import { entryOccupationRule, retrainingRule } from './population/retraining';
import { financingRule, fiscalRule, taxationRule } from './rules/state';
import type { Rule } from './types';

export {
  consumptionRule,
  environmentRule,
  populationEnvironmentImpactRule,
  eventRule,
  populationEventExperienceRule,
  financingRule,
  fiscalRule,
  marketRule,
  migrationRule,
  migrationCashRule,
  productionRule,
  populationAggregationRule,
  populationExperienceRule,
  populationInternalAttitudesRule,
  populationCrimeRule,
  populationEmploymentRule,
  populationAgingRule,
  populationLifeStageRule,
  populationDemographicsRule,
  populationStarvationRule,
  starvationReportRule,
  entryOccupationRule,
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
  populationEnvironmentImpactRule,
  populationEmploymentRule,
  populationExperienceRule,
  populationInternalAttitudesRule,
  populationCrimeRule,
  populationAgingRule,
  populationLifeStageRule,
  populationDemographicsRule,
  populationStarvationRule,
  starvationReportRule,
  migrationRule,
  migrationCashRule,
  entryOccupationRule,
  retrainingRule,
  eventRule,
  populationEventExperienceRule,
  populationAggregationRule,
];
