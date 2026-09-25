import { MUTABLE_FIELDS } from './map-fields';
import type {
  Crowns,
  CrownsPerMonth,
  CrownsPerPerson,
  FoodPrice,
  MapxelQuantity,
  MaterialPrice,
  MaterialUnits,
  People,
  PersonMonths,
} from './units';
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
 * Authoritative human state. Population-state write helpers use units.ts for
 * dimensional fields; normalized education/health/wellbeing/approval remain [0,1].
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
 * Place state and compatibility projections. Dimensionful values are branded so
 * fixtures and direct state edits must name their units explicitly.
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

  /** Residents. */
  population: People;
  /** Pooled private money, in crowns. */
  cash: Crowns;
  /** Stored food, in person-months. */
  food: PersonMonths;
  /** Abstract material inventory units. */
  materials: MaterialUnits;
  /** Crowns per person-month of food. */
  price: FoodPrice;
  /** Scarcity-implied crowns per person-month of food. */
  scarcityPrice: FoodPrice;

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
  /** Realized share of monthly food need consumed, capped at 1. */
  foodSecurity: number;
  sportsInterest: number;

  agriculture: number;
  manufacturing: number;
  services: number;
  sports: number;

  /** Gross monetary production rate, in crowns/month. */
  output: CrownsPerMonth;
  /** Food produced during this month, in person-months. */
  foodMade: PersonMonths;
  /** Food consumed during this month, in person-months. */
  foodUsed: PersonMonths;
  /** Net food imported this month, in person-months. */
  foodTraded: PersonMonths;
  businessHealth: number;
  /** Severe food-deprivation deaths reported for this month. */
  starvationDeaths: People;
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
  revenue: Crowns;
  spending: Crowns;
  interest: Crowns;
  borrowed: Crowns;
  funding: number;
}

/** tick/mandate are months; public/external balances are crowns. */
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
  treasury: Crowns;
  debt: Crowns;
  externalCash: Crowns;
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

/** National/selected-area projection with dimensional totals preserved. */
export interface Summary extends Record<Metric, number> {
  population: People;
  wealth: CrownsPerPerson;
  output: CrownsPerMonth;
  price: FoodPrice;
  treasury: Crowns;
  debt: Crowns;
  food: PersonMonths;
  starvationDeaths: People;
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

type Primitive = string | number | boolean | bigint | symbol | null | undefined;
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends Primitive
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

type DeltaEffect = {
  [F in MutableField]: {
    kind: 'delta';
    cell: number;
    field: F;
    amount: MapxelQuantity<F>;
    evidence?: Evidence;
    eventKey?: string;
  }
}[MutableField];

type TransferEffect =
  | { kind: 'transfer'; from: Account; to: Account; resource: 'cash'; amount: Crowns; evidence?: Evidence }
  | { kind: 'transfer'; from: Account; to: Account; resource: 'food'; amount: PersonMonths; evidence?: Evidence }
  | { kind: 'transfer'; from: Account; to: Account; resource: 'materials'; amount: MaterialUnits; evidence?: Evidence };

type TradeEffect =
  | { kind: 'trade'; from: number; to: number; resource: 'food'; amount: PersonMonths; price: FoodPrice; evidence?: Evidence }
  | { kind: 'trade'; from: number; to: number; resource: 'materials'; amount: MaterialUnits; price: MaterialPrice; evidence?: Evidence };

export type Effect =
  | DeltaEffect
  | TransferEffect
  | {
      kind: 'repayDebt';
      amount: Crowns;
    }
  | TradeEffect
  | {
      kind: 'budget';
      value: Budget;
      debtDelta: Crowns;
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
