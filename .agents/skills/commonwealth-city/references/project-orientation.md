# Commonwealth: project orientation

## The one-minute version

Commonwealth is a browser policy, economy, and society simulator written in TypeScript and Vue. The player governs a procedurally generated country for a finite mandate and changes taxes, services, subsidies, investments, and laws while watching consequences propagate through places, people, firms, public finances, migration, wellbeing, and events.

The central simulation principle is:

```text
WORLD / MAP / POLITICS
        ↓
people experience conditions
        ↓
people change and react
        ↓
people act
        ↓
actions alter MAP / ECONOMY / POLITICS
```

The engine should remain generic. Adding social richness should normally mean adding a plain rule module and tests, not teaching settlement a new piece of sociology.

## Places, archetypes, and population groups

A land mapxel represents local world state: terrain, fertility/minerals, stocks, prices, pollution, infrastructure, crime pressure, business health, public-service conditions, production, and aggregate private cash.

The world seed and archetype model version deterministically define roughly 2,048 archetypes. Archetypes contain durable-ish predispositions, needs, values, traits, and sector affinities. They are not current socioeconomic classes.

Each mapxel contains sparse mutable population groups. A group combines an archetype with lived circumstances such as count, age/life stage, education, occupation, employment, income, wealth, health, wellbeing, approval, and attitudes. The same archetype can simultaneously exist in different jobs, places, income states, and life stages.

Groups split when a meaningful discrete divergence occurs, such as job loss, migration, retirement, or retraining. Similar histories may merge again. Person-scale stochastic quantization prevents tiny independent choices from creating endless microscopic cohorts.

## People are authoritative

`PopulationGroup` is the source of truth for mutable human state.

Mapxel `employment`, `happiness`, `approval`, child/senior shares, and occupational labor shares are cached projections of the people living there. They are conveniences for production, summaries, and UI, not a second human model.

A useful design rule is:

> Nothing social should happen directly to a mapxel when it can happen to the people living there.

The default engine therefore uses actual group transitions for employment, occupation/retraining, migration, aging/life-stage changes, births, deaths, wellbeing, approval, and attitudes. `population.aggregate` materializes the final human caches after all behavior and events settle.

Raw mapxel population mutation is forbidden. Births/deaths use `population-delta`; migration uses `population-transfer`; population settlement updates cached cell population alongside groups.

### Per-step population cache

At the beginning of each simulation step, `src/sim/step-cache.ts` derives one immutable `StepCache` directly from authoritative population groups. It contains per-mapxel population counts, employment, demographic shares, population-weighted human state, and employed occupational shares. The same cache instance is supplied to every rule phase for that month and is discarded afterward.

The step cache is execution data, not model state: it is not written by Effects, settled, saved, restored, recorded as provenance, or used as the source for the next cache. It deliberately does not read mapxel human projections, even for empty cohorts. Current persisted mapxel human projections remain temporarily for compatibility with existing rule consumers and UI; rules can migrate to the step cache without turning those summaries into a second authority.

## State registries

Runtime mechanics for mutable place state live in `src/sim/map-fields.ts`. Runtime mechanics for mutable population state live in `src/sim/population/fields.ts`.

These registries define things such as bounds, storage, merge tolerances, validation, and whether generic delta effects are legal. Behavior formulas do not belong there.

When adding a state field, prefer extending the typed state plus the appropriate registry so settlement, validation, saves, merging, and developer tooling can reuse the same definition rather than growing parallel handwritten field lists.

## Monthly causal pipeline

The exact phase list is in `src/sim/types.ts`. Broadly:

```text
production
trade
consumption
market
taxation
financing
fiscal
society        environment.conditions + population.employment
experience     population.experience
behavior       people-to-world behavior, currently population.crime
aging          population.aging
lifeStage      population.life-stage
demographics   births, ordinary mortality, starvation mortality
migration      population.migration
adaptation     population.retraining
events          stories.events
projection     population.aggregate
```

Every rule in a phase reads the same phase-start state and emits Effects. Settlement happens after all rules in that phase have proposed their Effects. A same-phase dependency can order evaluation but cannot expose another rule's writes. Use a later phase when a rule must consume newly settled state.

The dedicated `projection` phase is intentionally last. Event changes to population state are therefore visible to the same month's final human mapxel projection.

## Current people-first rule boundaries

- `environment.conditions` updates world/environment conditions such as health access, education access, infrastructure, pollution, and sports/culture conditions.
- `population.employment` makes actual adult groups gain or lose employment based on job viability and local demand.
- `population.experience` updates lived income, wealth, health, wellbeing, approval, and attitudes. It does not age people.
- `population.crime` is people-to-world behavior: resident poverty, unemployment, inequality, policing, and welfare produce mapxel crime pressure.
- `population.aging` increments age one month at a time.
- `population.life-stage` handles threshold crossings after aging settles.
- `population.demographics` owns births and mortality. Food deprivation is translated directly into actual group deaths there; `starvationDeaths` is a reported outcome of that same process.
- `population.migration` moves actual groups between neighboring cells every third month.
- `population.retraining` changes occupation through actual group transitions.
- `population.aggregate` is the only default rule that writes cached human aggregate fields.

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

`src/sim/settlement/resources.ts` owns generic resource settlement. `src/sim/population/settlement.ts` owns population splitting, movement, state changes, births, and deaths. `src/sim/causality/provenance.ts` owns causal recording. `src/sim/validation/model.ts` owns runtime invariants. `engine.ts` is primarily the phase orchestrator.

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

`src/dev/` analyzes the same ordinary rules. It discovers actual reads, outputs, local sensitivities, map footprints, downstream consumers, and recurrent feedback. New behavior should become inspectable without a bespoke developer-tool implementation.

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
| `types.ts` | Core data vocabulary, Effects, rules, phases. |
| `step-cache.ts` | Immutable per-step population summaries derived from authoritative groups. |
| `map-fields.ts` | Mutable mapxel mechanics/registry. |
| `population/fields.ts` | Mutable population mechanics/registry. |
| `population/archetypes.ts` | Deterministic archetype definitions. |
| `population/generate.ts` | Initial sparse groups. |
| `population/employment.ts` | Group employment transitions. |
| `population/experience.ts` | Lived-state updates from conditions. |
| `population/crime.ts` | Resident behavior producing crime pressure. |
| `population/aging.ts` | Aging and life-stage transition rules. |
| `population/demographics.ts` | Births and mortality. |
| `population/migration.ts` | Group-specific migration. |
| `population/retraining.ts` | Occupation switching/retraining. |
| `population/aggregation.ts` | Final cached human mapxel projections. |
| `population/settlement.ts` | Population effect planning/settlement. |
| `population/merge.ts` | Deterministic cohort compaction. |
| `rules/environment.ts` | World/environment conditions. |
| `rules/economy.ts` | Production, trade, consumption, market/business rules. |
| `rules/state.ts` | Taxation, financing, fiscal/service payments. |
| `rules/events.ts` | Stochastic event mechanics. |
| `settlement/resources.ts` | Generic resource/mapxel effect settlement. |
| `causality/provenance.ts` | Cause/evidence/provenance infrastructure. |
| `validation/model.ts` | Runtime invariants. |
| `engine.ts` | Rule ordering, phases, snapshots, monthly step. |
| `src/dev/` | Causal/sensitivity workbench. |

The simulation in `src/sim/` is framework-independent. Vue is the presentation shell.

## Adding behavior without poisoning extensibility

A normal addition should look like:

```text
new gameplay idea
→ choose a coherent rule module
→ read existing world/person state
→ calculate reaction
→ emit generic Effects + evidence
→ generic settlement/validation/provenance handles mechanics
→ focused tests
```

A new behavior using existing state should usually touch one behavior module plus tests. A new state field should be defined once in typed state/registry, initialized and migrated when needed, then consumed by normal rules.

Avoid abstract inheritance frameworks and behavior-specific fast paths. Performance optimizations should be structural: sparse cohorts, indexes, cached summaries, efficient settlement, and compiled registry metadata.

## Testing and performance

Tests should protect mechanisms, not scripted drama. Important contracts include conservation, phase simultaneity, deterministic keyed randomness, people-first authority, policy directionality, bounded long-run behavior, save/load reproducibility, causal traceability, and browser workflows.

The performance strategy is sparse people, not fewer possible archetypes. Runtime cost is driven by live cohorts, proposal allocation, population settlement, migration/retraining/demographics, aggregation, snapshots, and the once-per-step population-summary pass. `scripts/perf-sim.ts` and the performance workflow measure this path.

## What to read next

- `docs/RULES.md`: current mechanics and rule behavior.
- `docs/SIMULATION.md`: architecture rationale, extension rules, and limitations.
- `docs/ACTIONS.md`: player government actions and validation.
- population authority/registry tests: invariants and people-first contracts.
- `tests/rule-analysis.test.ts`: developer causal-analysis contracts.
- `tests/browser/`: end-to-end UI/workbench behavior.

When architecture changes, update this orientation with the code. Leaving old causal models in agent documentation is how perfectly dead abstractions acquire second lives, which nobody needs.
