# Commonwealth: project orientation

## The one-minute version

Commonwealth is a browser policy, economy, and society simulator written in TypeScript and Vue. The player governs a procedurally generated country for a finite mandate and changes taxes, services, subsidies, investments, and laws while watching consequences propagate through places, people, firms, public finances, migration, wellbeing, and events.

The simulation is articulated around four causal rule directions:

```text
MAPXEL → MAPXEL    places/world systems evolve
MAPXEL → PEOPLE    people experience places and opportunities
PEOPLE → MAPXEL    people act and change the world
PEOPLE → PEOPLE    people evolve from human state itself
```

Those four arrows are the primary causal ontology. Phases are execution scheduling. Domain folders are code organization. Neither should be confused with the causal type of a rule.

The engine should remain generic. Adding social richness should normally mean adding a plain rule module and tests, not teaching settlement a new piece of sociology.

## Places, archetypes, and population groups

A land mapxel represents local world state: terrain, fertility/minerals, stocks, prices, pollution, infrastructure, crime pressure, business health, public-service conditions, production, and aggregate private cash.

The world seed and archetype model version deterministically define roughly 2,048 archetypes. Archetypes contain durable-ish predispositions, needs, values, traits, and sector affinities. They are not current socioeconomic classes.

Each mapxel contains sparse mutable population groups. A group combines an archetype with lived circumstances such as count, age/life stage, education, occupation, employment, income, wealth, health, wellbeing, approval, and attitudes. The same archetype can simultaneously exist in different jobs, places, income states, and life stages.

Groups split when a meaningful discrete divergence occurs, such as job loss, migration, retirement, or retraining. Similar histories may merge again. Person-scale stochastic quantization prevents tiny independent choices from creating endless microscopic cohorts.

## People are authoritative

`PopulationGroup` is the source of truth for mutable human state.

Mapxel `employment`, `happiness`, `approval`, child/senior shares, and occupational labor shares remain cached compatibility projections for UI/save consumers. Causal rules should use authoritative groups or the per-step population cache rather than treating those fields as an independent social model.

A useful design rule is:

> Nothing social should happen directly to a mapxel when it can happen to the people living there.

The default engine therefore uses actual group transitions for employment, occupation/retraining, migration, aging/life-stage changes, births, deaths, wellbeing, approval, and attitudes. `population.aggregate` currently materializes final human compatibility fields after behavior and events settle; it is plumbing, not an independent causal authority.

Raw mapxel population mutation is forbidden. Births/deaths use `population-delta`; migration uses `population-transfer`; population settlement updates cached cell population alongside groups.

### Per-step population cache

At the beginning of each simulation step, `src/sim/step-cache.ts` derives one immutable `StepCache` directly from authoritative population groups. It contains per-mapxel population counts, employment, demographic shares, population-weighted human state, and employed occupational shares. The same cache instance is supplied to every rule phase for that month and is discarded afterward.

The step cache is execution data, not model state: it is not written by Effects, settled, saved, restored, recorded as provenance, or used as the source for the next cache. It deliberately does not read mapxel human projections, even for empty cohorts.

The cache represents **step-start people**. If a later phase genuinely needs a human change settled earlier in the same month, it must read current authoritative population groups rather than expecting the cache to refresh. Direct isolated rule calls in tests may derive a local cache from the supplied snapshot because no step lifecycle owns one. The developer causal lens is different: it reconstructs the actual step-start cache from the game at the beginning of the traced month and observes cache reads explicitly, so later-phase analysis keeps production timing semantics.

## Four-arrow rule contract

Every `Rule` declares exactly one `direction`:

- `mapxel-to-mapxel`
- `mapxel-to-people`
- `people-to-mapxel`
- `people-to-people`

The engine and trace path mechanically enforce the **output side**. A rule whose direction ends in `people` may emit population effects but not world/resource mutations. A rule whose direction ends in `mapxel` may emit world/resource effects but not population mutations. Event records are metadata and can accompany either side.

The read side is intentionally not hard-restricted. Cross-arrow mechanisms often need state from both ontologies: a `mapxel-to-people` employment rule may inspect current education/adaptability while applying local job conditions; a `people-to-mapxel` behavior may inspect policing or infrastructure while deciding what residents accomplish. Treat unexpected reads as something to inspect and test, not something the type system should prohibit before the model has demonstrated the right boundary.

When one old rule emits effects on both sides, split it into coherent arrows. If two split stochastic rules must reproduce one decision, they may share a `randomNamespace`. If two rules need each other's settled writes, they belong in different phases; same-phase `after` only orders evaluation/provenance, not visibility.

## State registries

Runtime mechanics for mutable place state live in `src/sim/map-fields.ts`. Runtime mechanics for mutable population state live in `src/sim/population/fields.ts`.

These registries define things such as bounds, storage, merge tolerances, validation, and whether generic delta effects are legal. Behavior formulas do not belong there.

When adding a state field, prefer extending the typed state plus the appropriate registry so settlement, validation, saves, merging, and developer tooling can reuse the same definition rather than growing parallel handwritten field lists.

## Monthly causal pipeline

The exact phase list is in `src/sim/types.ts`. Broadly:

```text
production      people → mapxel production from step-start workforce summaries
trade           mapxel → mapxel stock/cash exchange
consumption     people → mapxel household demand and food use
market          mapxel → mapxel prices/business conditions
taxation        mapxel → mapxel fiscal accounting
financing       mapxel → mapxel borrowing/accounting
fiscal          mapxel → mapxel public spending/subsidy transfers
society         mapxel → mapxel conditions + people → mapxel resident pressures
                + mapxel → people employment
experience      mapxel → people lived income/wealth/health/wellbeing/approval
behavior        people → mapxel crime + people → people endogenous attitude drift
aging           people → people aging
lifeStage       people → people age-threshold transitions
demographics    people → people births and ordinary mortality
deprivation     mapxel → people food-driven mortality + mapxel report
migration       mapxel → people movement + people → mapxel cash consequence
adaptation      mapxel → people first occupation/retraining
events          mapxel → mapxel event consequences + mapxel → people experience
projection      people → mapxel compatibility projection
```

Every rule in a phase reads the same phase-start state and emits Effects. Settlement happens after all rules in that phase have proposed their Effects. A same-phase dependency can order evaluation/provenance but cannot expose another rule's writes. Use a later phase when a rule must consume newly settled state.

The dedicated `projection` phase is intentionally last. Event changes to population state are therefore visible to the same month's final compatibility projection.

## Current rule boundaries

- `economy.production` is `people-to-mapxel`: production reads the step-start people cache for population, employment, health, and occupations.
- `environment.conditions` is `mapxel-to-mapxel`; `population.environment-impact` carries resident wealth, density, and workforce pressures into the world separately.
- `population.employment` is `mapxel-to-people`.
- `population.experience` is `mapxel-to-people`; `population.internal-attitudes` is a later `people-to-people` drift.
- `population.crime` is `people-to-mapxel`.
- `population.aging` and `population.life-stage` are `people-to-people`. Turning 18 no longer secretly chooses a job from mapxel labor shares.
- `population.entry-occupation` and `population.retraining` are `mapxel-to-people` adaptation rules.
- `population.demographics` is `people-to-people`; `population.starvation` is `mapxel-to-people` in the later deprivation phase; `environment.starvation-report` only materializes the compatibility report.
- `population.migration` is `mapxel-to-people`; `population.migration-cash` is its `people-to-mapxel` accounting consequence. Both share the same keyed random namespace.
- `stories.events` owns world/event consequences; `population.event-experience` translates the same stochastic outcome into human wellbeing using the same random namespace. Their event-linked provenance is resolved at phase commit rather than through a false same-phase data dependency.
- `population.aggregate` is an explicitly temporary `people-to-mapxel` compatibility projection, not a causal authority.

## Effects and settlement

Rules are ordinary TypeScript objects that inspect state and return generic Effects. The vocabulary intentionally stays small:

- mapxel delta,
- cash/resource transfer,
- trade,
- budget/debt effects,
- event,
- population state change,
- population transition,
- population transfer,
- birth/death.

Do not add one Effect kind per behavior. Activism, disease, unionization, family formation, entrepreneurship, crime participation, religion, housing choice, and similar systems should normally compose existing state and generic effects.

`src/sim/settlement/resources.ts` owns generic resource settlement. `src/sim/population/settlement.ts` owns population splitting, movement, state changes, births, and deaths. `src/sim/causality/provenance.ts` owns causal recording. `src/sim/validation/model.ts` owns runtime invariants. `engine.ts` is primarily the phase orchestrator plus four-arrow output validation.

## Economy/accounting layers

Keep these concepts distinct:

- `output` is economic activity, not money creation;
- cell cash is pooled local private reserves;
- group income/wealth are behavioral and distributional state, not conserved personal bank accounts;
- treasury is public cash;
- debt is government borrowing/principal plus arrears where modeled;
- `externalCash` is the modeled outside monetary boundary;
- food/materials are stocks changed only by explicit source/sink/transfer effects.

Migration carries proportional cell cash separately from the population-group transfer. Production/export receipts, imports, taxes, public spending, debt, and repayment all have explicit cash paths.

## Causality and developer workbench

Rules can attach evidence with affected places, input observations, explanatory text, and policy/provenance parents. The causality layer records significant realized effects and parent links without pretending that the journal is a complete counterfactual causal model.

`src/dev/` analyzes the same ordinary rules. It discovers actual model reads, explicit step-cache summary reads, outputs, local sensitivities, map footprints, downstream consumers, and recurrent feedback. Cache reads are shown as people-summary inputs such as employment rate or average health rather than as the internal group fields used to construct the cache. Population changes can feed later direct group reads in the same month, but they can feed cache consumers only in a later month because the cache remains fixed for the step. New behavior should become inspectable without a bespoke developer-tool implementation. `traceStep()` also retains each rule's declared direction so developer views can organize the graph around the four arrows rather than only around phases.

The workbench should answer:

```text
what changed?
what inputs mattered?
which people reacted?
what did they do?
what changes downstream?
```

## Module map

| Module | Responsibility |
| --- | --- |
| `types.ts` | Core data vocabulary, Effects, four rule directions, and phases. |
| `rule-direction.ts` | Mechanical direction/output validation. |
| `step-cache.ts` | Immutable per-step population summaries derived from authoritative groups. |
| `map-fields.ts` | Mutable mapxel mechanics/registry. |
| `population/fields.ts` | Mutable population mechanics/registry. |
| `population/archetypes.ts` | Deterministic archetype definitions. |
| `population/generate.ts` | Initial sparse groups. |
| `population/employment.ts` | Group employment transitions. |
| `population/experience.ts` | Lived-state updates and endogenous attitude drift. |
| `population/crime.ts` | Resident behavior producing crime pressure. |
| `population/aging.ts` | Aging and life-stage transition rules. |
| `population/demographics.ts` | Natural demographics, food-driven mortality, and reporting. |
| `population/migration.ts` | Group-specific migration plus its cash consequence. |
| `population/retraining.ts` | First occupation and occupation switching/retraining. |
| `population/aggregation.ts` | Final compatibility human mapxel projections. |
| `population/settlement.ts` | Population effect planning/settlement. |
| `population/merge.ts` | Deterministic cohort compaction. |
| `rules/environment.ts` | Autonomous world conditions and resident-to-world pressures. |
| `rules/economy.ts` | Production, trade, consumption, market/business rules. |
| `rules/state.ts` | Taxation, financing, fiscal/service payments. |
| `rules/events.ts` | Stochastic world events and human event experience. |
| `settlement/resources.ts` | Generic resource/mapxel effect settlement. |
| `causality/provenance.ts` | Cause/evidence/provenance infrastructure. |
| `validation/model.ts` | Runtime invariants. |
| `engine.ts` | Rule ordering, direction validation, phases, snapshots, monthly step. |
| `src/dev/` | Causal/sensitivity workbench. |

The simulation in `src/sim/` is framework-independent. Vue is the presentation shell.

## Adding behavior without poisoning extensibility

A normal addition should look like:

```text
new gameplay idea
→ choose one causal arrow
→ choose a scheduling phase
→ read existing world/person state and step summaries as needed
→ calculate the mechanism
→ emit Effects only on the declared output side + evidence
→ generic settlement/validation/provenance handles mechanics
→ focused tests
```

A new behavior using existing state should usually touch one behavior module plus tests. A new state field should be defined once in typed state/registry, initialized and migrated when needed, then consumed by normal rules.

If an implementation needs to emit both population and world mutations, that is usually evidence of two causal arrows and should be split. Do not solve that by weakening `assertRuleEffects` or adding behavior-specific Effect exceptions.

Avoid abstract inheritance frameworks and behavior-specific fast paths. Performance optimizations should be structural: sparse cohorts, indexes, cached summaries, efficient settlement, and compiled registry metadata.

## Testing and performance

Tests should protect mechanisms, not scripted drama. Important contracts include conservation, phase simultaneity, deterministic keyed randomness, people-first authority, four-arrow output enforcement, flexible read-side legality, policy directionality, bounded long-run behavior, save/load reproducibility, causal traceability, and browser workflows.

The performance strategy is sparse people, not fewer possible archetypes. Runtime cost is driven by live cohorts, proposal allocation, population settlement, migration/retraining/demographics, compatibility aggregation, snapshots, and the once-per-step population-summary pass. `scripts/perf-sim.ts` and the performance workflow measure this path.

## What to read next

- `docs/RULES.md`: current mechanics and rule behavior.
- `docs/SIMULATION.md`: architecture rationale, extension rules, and limitations.
- `docs/ACTIONS.md`: player government actions and validation.
- `tests/rule-direction.test.ts`: four-arrow mechanical enforcement and flexible read-side contract.
- population authority/registry tests: invariants and people-first contracts.
- `tests/rule-analysis.test.ts`: developer causal-analysis contracts.
- `tests/browser/`: end-to-end UI/workbench behavior.

When architecture changes, update this orientation with the code. Leaving old causal models in agent documentation is how perfectly dead abstractions acquire second lives, which nobody needs.
