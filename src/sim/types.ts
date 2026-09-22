export const SECTORS = ['agriculture', 'manufacturing', 'services', 'sports'] as const;
export type Sector = typeof SECTORS[number];
export const SERVICES = ['health', 'education', 'police', 'infrastructure', 'welfare', 'culture', 'environment'] as const;
export type Service = typeof SERVICES[number];
export const LAWS = ['cleanAir', 'freeMovement', 'publicAssembly'] as const;
export type Law = typeof LAWS[number];
export type Biome = 'water' | 'plain' | 'forest' | 'hill' | 'city';
export interface Mapxel {
  id: number; x: number; y: number; name: string; region: number; biome: Biome;
  elevation: number; fertility: number; minerals: number;
  population: number; cash: number; food: number; materials: number; price: number;
  children: number; seniors: number; education: number; health: number;
  happiness: number; approval: number; crime: number; pollution: number; infrastructure: number;
  employment: number; foodSecurity: number; sportsInterest: number;
  agriculture: number; manufacturing: number; services: number; sports: number;
  output: number; foodMade: number; foodUsed: number; foodTraded: number; businessHealth: number;
}
export type Field = { [K in keyof Mapxel]: Mapxel[K] extends number ? K : never }[keyof Mapxel];
export const MUTABLE_FIELDS = ['population', 'cash', 'food', 'materials', 'price', 'children', 'seniors', 'education', 'health', 'happiness', 'approval', 'crime', 'pollution', 'infrastructure', 'employment', 'foodSecurity', 'sportsInterest', ...SECTORS, 'output', 'foodMade', 'foodUsed', 'foodTraded', 'businessHealth'] as const satisfies readonly Field[];
export type MutableField = typeof MUTABLE_FIELDS[number];
export interface Policy {
  incomeTax: number; businessTax: number;
  spending: Record<Service, number>; subsidies: Record<Sector, number>; laws: Record<Law, boolean>;
}
export type Scope = { kind: 'national' } | { kind: 'region'; id: number } | { kind: 'cells'; ids: number[] };
export type Action =
  | { type: 'tax'; tax: 'incomeTax' | 'businessTax'; rate: number }
  | { type: 'spending'; service: Service; amount: number }
  | { type: 'subsidy'; sector: Sector; amount: number; scope: Scope }
  | { type: 'law'; law: Law; enabled: boolean }
  | { type: 'invest'; project: 'transport' | 'hospital' | 'school' | 'stadium'; amount: number; scope: Scope };
export interface LocalSubsidy { sector: Sector; amount: number; scope: Scope; cause: string }
export interface Budget { revenue: number; spending: number; interest: number; borrowed: number; funding: number }
export interface Model {
  seed: string; width: number; height: number; tick: number; mandate: number;
  cells: Mapxel[]; neighbors: number[][]; regions: string[]; policy: Policy; localSubsidies: LocalSubsidy[];
  treasury: number; debt: number; externalCash: number; budget: Budget;
}
export type Metric = 'approval' | 'happiness' | 'crime' | 'foodSecurity' | 'population' | 'wealth' | 'employment' | 'pollution' | 'output' | 'health' | 'education' | 'price';
export interface Summary extends Record<Metric, number> { treasury: number; debt: number; food: number }
export interface Observation { cell?: number; field: MutableField; value: number; label: string }
export interface Cause {
  id: string; tick: number; rule: string; title: string; detail: string; cells: number[];
  parents: string[]; observations: Observation[]; magnitude: number;
}
export interface Article {
  id: string; tick: number; category: 'dispatch' | 'economy' | 'politics' | 'culture' | 'briefing';
  headline: string; body: string; voice: string; cell?: number; causeIds: string[]; tone: 'good' | 'bad' | 'neutral';
}
export interface History { tick: number; summary: Summary }
export interface Game {
  version: 1; model: Model; initial: Summary; history: History[]; causes: Cause[];
  articles: Article[]; actionLog: { tick: number; action: Action; causeId: string }[];
  provenance: Record<string, string>; lastEvents: Record<string, number>; ended: boolean;
}
export type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T : T extends object ? { readonly [P in keyof T]: DeepReadonly<T[P]> } : T;
export type Account = number | 'treasury' | 'external';
export interface Evidence { title: string; detail: string; cells: number[]; reads?: { cell: number; field: MutableField; label: string }[]; parents?: string[] }
export type Effect =
  | { kind: 'delta'; cell: number; field: MutableField; amount: number; evidence?: Evidence; eventKey?: string }
  | { kind: 'transfer'; from: Account; to: Account; resource: 'cash' | 'food' | 'materials' | 'population'; amount: number; evidence?: Evidence }
  | { kind: 'trade'; from: number; to: number; resource: 'food' | 'materials'; amount: number; price: number; evidence?: Evidence }
  | { kind: 'budget'; value: Budget; debtDelta: number }
  | { kind: 'event'; key: string; article: Omit<Article, 'id' | 'tick' | 'causeIds'>; evidence: Evidence };
export const PHASES = ['production', 'trade', 'consumption', 'market', 'taxation', 'financing', 'fiscal', 'society', 'migration', 'adaptation', 'events'] as const;
export type Phase = typeof PHASES[number];
export interface RuleContext {
  model: DeepReadonly<Model>; random: (cell: number, channel?: string) => number;
  lastEvents: Readonly<Record<string, number>>;
}
export interface Rule { id: string; phase: Phase; after?: readonly string[]; description: string; run(context: RuleContext): Effect[] }
