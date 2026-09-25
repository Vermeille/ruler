import { MUTABLE_FIELDS } from './map-fields';
export { MUTABLE_FIELDS };

export const SECTORS = [
  'agriculture',
  'manufacturing',
  'services',
  'sports',
] as const;
export type Sector = typeof SECTORS[number];

export const SERVICES = [
  'health',
  'education',
  'police',
  'infrastructure',
  'welfare',
  'culture',
  'environment',
] as const;
export type Service = typeof SERVICES[number];

export const LAWS = [
  'cleanAir',
  'freeMovement',
  'publicAssembly',
  'foodPriceControls',
] as const;
export type Law = typeof LAWS[number];

export type Biome = 'water' | 'plain' | 'forest' | 'hill' | 'city';

export type ArchetypeId = number;
export type PopulationGroupId = number;

export interface Archetype {
  id: ArchetypeId;
  traits: {
    adaptability: number;
    mobility: number;
    riskTolerance: number;
    communityAttachment: number;
    familyOrientation: number;
    entrepreneurialism: number;
  };
  needs: {
    income: number;
    employment: number;
    food: number;
    health: number;
    safety: number;
    housing: number;
    education: number;
    environment: number;
    culture: number;
  };
  values: {
    materialism: number;
    environmentalism: number;
    civicLiberty: number;
    traditionalism: number;
    individualism: number;
    solidarity: number;
  };
  affinities: Record<Sector, number> & { education: number };
}

export type LifeStage = 'child' | 'adult' | 'senior';

/**
 * Authoritative human state.
 * - count: people
 * - age: years
 * - income: crowns/person/month
 * - wealth: crowns/person
 * - education, health, wellbeing, approval and attitudes: normalized [0,1]
 *
 * Use the constructors in units.ts when writing literal dimensional values in
 * rules, fixtures, or tests. They are zero-overhead branded numbers.
 */
export interface PopulationGroup {
  id: PopulationGroupId;
  archetype: ArchetypeId;
  count: number;
  age: number;
  lifeStage: LifeStage;
  education: number;
  occupation: Sector | null;
  employed: boolean;
  income: number;
  wealth: number;
  health: number;
  wellbeing: number;
  approval: number;
  attitudes: {
    environmentalism: number;
    civicLiberty: number;
    traditionalism: number;
    solidarity: number;
  };
}

/**
 * Read-only population aggregates derived once from authoritative groups at the
 * beginning of a simulation step. They are an execution cache, never model state.
 * Counts are people; average income is crowns/person/month; average wealth is crowns/person.
 */
export interface StepPeopleSummary {
  readonly population: number;
  readonly adultPopulation: number;
  readonly employedAdults: number;
  readonly workerPopulation: number;
  readonly employmentRate: number;
  readonly childShare: number;
  readonly seniorShare: number;
  readonly averageEducation: number;
  readonly averageIncome: number;
  readonly averageWealth: number;
  readonly averageHealth: number;
  readonly averageWellbeing: number;
  readonly averageApproval: number;
  readonly occupationShares: Readonly<Record<Sector, number>>;
}

/** Ephemeral, immutable summaries available to every rule during one step. */
export interface StepCache {
  readonly peopleByCell: readonly StepPeopleSummary[];
}

type NumericPopulationGroupField = {
  [K in keyof PopulationGroup]: PopulationGroup[K] extends number ? K : never
}[keyof PopulationGroup];

export type PopulationStateField =
  | Exclude<NumericPopulationGroupField, 'id' | 'archetype' | 'count'>
  | keyof PopulationGroup['attitudes'];

type PrimitivePopulationTransitionField = {
  [K in keyof PopulationGroup]: PopulationGroup[K] extends string | boolean | null ? K : never
}[keyof PopulationGroup];

export type PopulationTransitionField = PrimitivePopulationTransitionField;

/**
 * Place state and compatibility projections.
 *
 * Dimensional fields:
 * - population: people
 * - cash: crowns
 * - food, foodMade, foodUsed, foodTraded: person-months of food
 * - materials: abstract material units
 * - price, scarcityPrice: crowns per person-month of food (reference price = 1)
 * - output: crowns/month
 * - starvationDeaths: people/month (reported severe component for the current step)
 *
 * children/seniors/employment and sector fields are shares in [0,1]. Health,
 * happiness, approval, crime, pollution, infrastructure, businessHealth and the
 * terrain/service qualities are normalized [0,1] indices. foodSecurity is the
 * realized share of monthly food need actually consumed, capped at 1.
 *
 * Use units.ts constructors for literals and dimensional helper functions for
 * conversions. MAPXEL_FIELDS only describes mutation/bounds mechanics.
 */
export interface Mapxel {
  id: number;
  x: number;
  y: number;
  name: string;
  region: number;
  biome: Biome;

  elevation: number;
  fertility: number;
  minerals: number;
  waterStress: number;

  population: number;
  cash: number;
  food: number;
  materials: number;
  price: number;
  scarcityPrice: number;

  children: number;
  seniors: number;
  education: number;
  health: number;
  happiness: number;
  approval: number;
  crime: number;
  pollution: number;
  infrastructure: number;
  employment: number;
  foodSecurity: number;
  sportsInterest: number;

  agriculture: number;
  manufacturing: number;
  services: number;
  sports: number;

  output: number;
  foodMade: number;
  foodUsed: number;
  foodTraded: number;
  businessHealth: number;
  starvationDeaths: number;
}

export type Field = {
  [K in keyof Mapxel]: Mapxel[K] extends number ? K : never
}[keyof Mapxel];

type ImmutableNumericMapxelField = 'id' | 'x' | 'y' | 'region' | 'elevation' | 'fertility' | 'minerals';
export type MutableField = Exclude<Field, ImmutableNumericMapxelField>;

/** Tax rates are shares; minimumWage and service/subsidy rates are crowns/person/month. */
export interface Policy {
  incomeTax: number;
  businessTax: number;
  minimumWage: number;
  spending: Record<Service, number>;
  subsidies: Record<Sector, number>;
  laws: Record<Law, boolean>;
}

export type Scope =
  | { kind: 'national' }
  | { kind: 'region'; id: number }
  | { kind: 'cells'; ids: number[] };

export type Action =
  | { type: 'tax'; tax: 'incomeTax' | 'businessTax'; rate: number }
  | { type: 'minimumWage'; amount: number }
  | { type: 'spending'; service: Service; amount: number }
  | { type: 'subsidy'; sector: Sector; amount: number; scope: Scope }
  | { type: 'law'; law: Law; enabled: boolean }
  | {
      type: 'invest';
      project: 'transport' | 'hospital' | 'school' | 'stadium';
      amount: number;
      scope: Scope;
    };

export interface LocalSubsidy {
  sector: Sector;
  amount: number;
  scope: Scope;
  cause: string;
}

/** Monetary budget amounts are crowns for the current monthly step; funding is a [0,1] share. */
export interface Budget {
  revenue: number;
  spending: number;
  interest: number;
  borrowed: number;
  funding: number;
}

/** tick/mandate are months; treasury/debt/externalCash are crowns. */
export interface Model {
  seed: string;
  archetypeModelVersion: number;
  populationGroups: PopulationGroup[][];
  nextPopulationGroupId: number;
  width: number;
  height: number;
  tick: number;
  mandate: number;
  cells: Mapxel[];
  neighbors: number[][];
  regions: string[];
  policy: Policy;
  localSubsidies: LocalSubsidy[];
  treasury: number;
  debt: number;
  externalCash: number;
  budget: Budget;
}

export type Metric =
  | 'approval'
  | 'happiness'
  | 'crime'
  | 'foodSecurity'
  | 'population'
  | 'wealth'
  | 'employment'
  | 'pollution'
  | 'output'
  | 'health'
  | 'education'
  | 'price';

/**
 * National/selected-area projection.
 * population and starvationDeaths are people; wealth is crowns/person; output is
 * crowns/month; treasury/debt are crowns; food is person-months; price is
 * crowns/person-month of food. Remaining metrics are normalized indices/shares.
 */
export interface Summary extends Record<Metric, number> {
  treasury: number;
  debt: number;
  food: number;
  starvationDeaths: number;
}

export interface Observation {
  cell?: number;
  group?: PopulationGroupId;
  field: MutableField | PopulationStateField | 'count' | 'employed';
  value: number;
  label: string;
}

export interface Cause {
  id: string;
  tick: number;
  rule: string;
  title: string;
  detail: string;
  cells: number[];
  parents: string[];
  observations: Observation[];
  magnitude: number;
}

export interface Article {
  id: string;
  tick: number;
  category: 'dispatch' | 'economy' | 'politics' | 'culture' | 'briefing';
  headline: string;
  body: string;
  voice: string;
  cell?: number;
  causeIds: string[];
  tone: 'good' | 'bad' | 'neutral';
}

export interface History {
  tick: number;
  summary: Summary;
}

export interface Game {
  version: 4;
  model: Model;
  initial: Summary;
  history: History[];
  causes: Cause[];
  articles: Article[];
  actionLog: { tick: number; action: Action; causeId: string }[];
  provenance: Record<string, string>;
  lastEvents: Record<string, number>;
  ended: boolean;
}

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
    : T;

export type Account = number | 'treasury' | 'external';

export interface Evidence {
  title: string;
  detail: string;
  cells: number[];
  reads?: (
    | { cell: number; field: MutableField; label: string }
    | { cell: number; group: PopulationGroupId; field: PopulationStateField | 'count' | 'employed'; label: string }
  )[];
  parents?: string[];
}

export type Effect =
  | {
      kind: 'delta';
      cell: number;
      field: MutableField;
      amount: number;
      evidence?: Evidence;
      eventKey?: string;
    }
  | {
      kind: 'transfer';
      from: Account;
      to: Account;
      resource: 'cash' | 'food' | 'materials';
      amount: number;
      evidence?: Evidence;
    }
  | {
      kind: 'repayDebt';
      amount: number;
    }
  | {
      kind: 'trade';
      from: number;
      to: number;
      resource: 'food' | 'materials';
      amount: number;
      price: number;
      evidence?: Evidence;
    }
  | {
      kind: 'budget';
      value: Budget;
      debtDelta: number;
    }
  | {
      kind: 'event';
      key: string;
      article: Omit<Article, 'id' | 'tick' | 'causeIds'>;
      evidence: Evidence;
    }
  | {
      kind: 'population-transfer';
      group: PopulationGroupId;
      from: number;
      to: number;
      amount: number;
      evidence?: Evidence;
    }
  | {
      kind: 'population-transition';
      group: PopulationGroupId;
      cell: number;
      amount: number;
      transition: Partial<Pick<PopulationGroup, PopulationTransitionField>>;
      evidence?: Evidence;
    }
  | {
      kind: 'population-state';
      group: PopulationGroupId;
      cell: number;
      amount: number;
      change: Partial<Record<PopulationStateField, number>>;
      evidence?: Evidence;
      eventKey?: string;
    }
  | {
      kind: 'population-delta';
      cell: number;
      group?: PopulationGroupId;
      archetype?: ArchetypeId;
      amount: number;
      cause: 'birth' | 'death';
      state?: Omit<PopulationGroup, 'id' | 'archetype' | 'count'>;
      evidence?: Evidence;
    };

export const PHASES = [
  'production',
  'trade',
  'consumption',
  'market',
  'taxation',
  'financing',
  'fiscal',
  'society',
  'experience',
  'behavior',
  'aging',
  'lifeStage',
  'demographics',
  'deprivation',
  'migration',
  'adaptation',
  'events',
  'projection',
] as const;

export type Phase = typeof PHASES[number];

export const RULE_DIRECTIONS = [
  'mapxel-to-mapxel',
  'mapxel-to-people',
  'people-to-mapxel',
  'people-to-people',
] as const;

export type RuleDirection = typeof RULE_DIRECTIONS[number];

export interface RuleContext {
  model: DeepReadonly<Model>;
  /**
   * step() and traceStep() always provide the one shared step cache. It is optional
   * only for isolated rule execution in tests/devtools, where rules derive a local
   * cache from the supplied immutable snapshot.
   */
  cache?: DeepReadonly<StepCache>;
  random: (cell: number, channel?: string) => number;
  lastEvents: Readonly<Record<string, number>>;
}

export interface Rule {
  id: string;
  direction: RuleDirection;
  phase: Phase;
  after?: readonly string[];
  /**
   * Rules that are split only to respect causal direction can share a random
   * namespace so keyed stochastic choices remain identical across the split.
   */
  randomNamespace?: string;
  description: string;
  run(context: RuleContext): Effect[];
}
