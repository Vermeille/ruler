# Commonwealth: project orientation

## The one-minute version

Commonwealth is a browser-playable policy, economy, and society simulator written in TypeScript and Vue. The player governs a procedurally generated country for a finite mandate, 48 months by default. They adjust taxes and services, subsidize sectors nationally or locally, make investments, enact laws, advance time, and watch those choices propagate through places, people, firms, public finances, migration, wellbeing, and chance events.

The central design principle is **world conditions → people experience them → people react → their actions change the world**. The simulation is not meant to be a realistic forecast or a one-score optimization puzzle. It is meant to generate understandable, uneven, traceable consequences from interacting systems.

The codebase is deliberately organized so adding social richness normally means adding a behavior rule and tests, not teaching the engine a new piece of sociology.

## What the player does

1. **Inspect the country.** The map shows generated terrain and settlements. The player can select places and switch layers for local conditions such as approval, wealth, food security, crime, population, pollution, and industry.
2. **Choose policy.** Cabinet controls include taxes, service spending, sector subsidies, investments, and laws. Scope matters: many interventions can be national, regional, or targeted to selected mapxels.
3. **Advance time.** One simulation step is one month. Actions mutate policy at the current tick; advancing executes the ordered simulation phases.
4. **Observe consequences.** Trends, map changes, news, local inspection, and causal views show how policy and world conditions affected residents and downstream systems.
5. **Finish the mandate.** The mandate report compares initial/final conditions and follows recorded causal chains where the evidence is sufficiently complete.

Progress autosaves in IndexedDB and can be exported/imported as validated JSON.

## The country has places and people

### Mapxels: place and local systems

The world is a grid of mapxels, approximately 4 km² each. A land mapxel represents local physical and economic conditions: terrain, fertility/minerals, food and material stocks, price, pollution, infrastructure, crime pressure, business health, public-service conditions, production, private aggregate cash, and other local indicators.

Mapxels trade with orthogonal neighbors. Infrastructure influences economic equalization and activity; there is no separate road graph yet.

Mutable mapxel mechanics are centralized in `src/sim/map-fields.ts`. That registry defines engine-level semantics such as bounds, whether a field accepts generic delta effects, and whether negative changes consume a conserved stock. Behavior formulas do **not** belong in that registry.

### Archetypes: durable predispositions

The simulation defines roughly 2,048 deterministic global archetypes. Archetypes are not voters and are not current socioeconomic classes. They represent relatively durable predispositions: traits, needs, values, mobility/community attachment, adaptability, and sector affinities.

An archetype is closer to “how this kind of person tends to evaluate situations” than “what is currently happening to them.”

### Population groups: mutable circumstances

Each mapxel contains a sparse set of population groups. A group combines an archetype with mutable lived circumstances such as:

- count,
- age and life stage,
- education,
- occupation,
- employment,
- income,
- wealth,
- health,
- wellbeing,
- approval,
- attitudes.

The same archetype can exist simultaneously as employed and unemployed residents, rich and poor residents, migrants, retirees, children, or people in different sectors. Circumstances change without requiring an archetype change.

Population groups can split when a meaningful discrete divergence occurs, such as job loss, migration, or retraining. Similar groups can merge again. The representation is intentionally sparse.

Mutable population-state mechanics are centralized in `src/sim/population/fields.ts`, including storage, bounds, and merge tolerances. Adding a new scalar human state should extend that registry rather than add synchronized field lists throughout settlement/validation/merge code.

## People are authoritative

`PopulationGroup` is the source of truth for mutable human state.

Mapxel fields such as employment, happiness/wellbeing, approval, child/senior shares, and sector labor shares are materialized projections of the people living there. They exist because economy rules, summaries, and UI need convenient local aggregates, but they are **not** an independent human simulation.

A useful rule when designing mechanics is:

> Nothing social should happen directly to a mapxel when it can instead happen to the people living there.

Policies normally change opportunities, constraints, services, prices, rights, public spending, or environmental conditions. Population groups then experience those conditions according to their mutable state and archetype. Their reactions alter employment, occupation, migration, demographics, wellbeing, and eventually the map/economy/politics again.

The default aggregate `economy.labor` adaptation rule remains exported for compatibility and selected tests, but it is not part of `defaultRules`. Normal labor change happens through actual population-group employment transitions and retraining.

## A representative causal story

A sector subsidy illustrates the intended loop:

```text
policy subsidy
→ local sector opportunity changes
→ population groups evaluate alternatives
→ some workers retrain/switch occupation
→ population.aggregate changes local labor shares
→ production mix changes in later months
→ stocks/prices/business health change
→ people experience those new conditions
→ later migration/retraining/wellbeing responses change again
```

The simulation should not hard-code the narrative outcome. A moderate subsidy may produce a manageable reallocation; an extreme intervention combined with bad conditions may produce a crisis. Tests should verify mechanisms and bounded consequences, not insist that ordinary policy always generates drama.

## Economy/accounting layers

Keep these layers distinct:

- `output` is abstract monthly economic activity, not cash.
- Cell cash is an aggregate local private household/business reserve.
- Group income and wealth are distributional behavioral state and are not separately conserved bank accounts yet.
- The treasury is government cash.
- Debt tracks government borrowing/principal.
- `externalCash` is the modeled external boundary for flows such as exports, procurement, investment, and interest.
- Food and materials are conserved local stocks except for explicit production/consumption/source/sink effects.
- Trades move both goods and payment atomically.

This separation is why an intervention can affect production, affordability, budget funding, employment, and wellbeing through different channels rather than through one generic “economy modifier.”

## Monthly simulation phases

The phase list is defined in `src/sim/types.ts`. In broad terms a month runs:

```text
production
trade
consumption
market
taxation
financing
fiscal
society
population experience
aging
demographics
migration
adaptation / retraining
events + population aggregate projection
```

Rules in a phase conceptually read the same phase-start state and emit Effects. Settlement happens after all active rules for that phase have proposed their Effects.

A rule cannot observe another rule's same-phase result. `after` dependencies order rule evaluation but do not turn same-phase proposals into sequential state mutation.

### Important final-phase nuance

`stories.events` and `population.aggregate` currently share the `events` phase. Because they read the same phase-start snapshot, stochastic population changes made by an event are not visible to the aggregate projection until the following tick. This is a known architectural nuance, not a reason to bypass the people-first model with direct aggregate writes. If same-month event projection becomes important, the clean solution is a later projection phase, not special-case mutation.

## Rules emit Effects, they do not mutate state

The rule contract is intentionally small:

```ts
interface Rule {
  id: string;
  phase: Phase;
  after?: readonly string[];
  description: string;
  run(context: RuleContext): Effect[];
}
```

Rules inspect state and return generic Effects. The core Effect vocabulary covers:

- mapxel deltas,
- conserved-resource/account transfers,
- coupled trades,
- debt repayment and budget updates,
- events,
- population transfers,
- population transitions,
- population state changes,
- explicit births/deaths.

The engine and settlement layers should not gain a new Effect kind for every new behavior. Religion, activism, disease, housing choice, family formation, unionization, crime participation, etc. should normally compose the existing state transformations.

## Settlement and conservation

`src/sim/settlement/resources.ts` owns generic resource settlement.

It plans total outgoing demand from phase-start balances, scales competing demands when they exceed available resources, settles transfers/trades/budget/debt effects, and applies accumulated mapxel deltas. Incoming goods/cash cannot be re-spent inside the same phase.

`src/sim/population/settlement.ts` owns population-specific splitting/movement/state updates. Population is conserved across transfers/transitions except for explicit births and deaths.

Discrete behavioral cohort flows use deterministic stochastic quantization at person-scale resolution where appropriate. The accounting layer remains continuous, but the representation should not create thousands of groups for 0.00003-person migration histories. Quantization preserves expected flows while keeping the sparse group model computationally meaningful.

## Causality and provenance

`src/sim/causality/provenance.ts` owns causal recording mechanics.

Effects may include evidence describing:

- affected cells,
- relevant group state reads,
- relevant mapxel reads,
- parent provenance keys such as policy changes,
- human-readable explanation text.

The causality layer turns significant realized Effects into causes, observations, event articles, and provenance writes.

Provenance writes are buffered until the end of the phase. A cause created inside a phase therefore cannot incorrectly claim a causal parent that was only produced by another same-phase effect.

These records are **selective evidence**, not a complete causal DAG and not counterfactual proof. Small changes may be omitted. The developer workbench can also estimate local sensitivities/perturbations, but a derivative is not the same thing as historical causation.

Player UI and developer tooling should ultimately consume the same underlying causal evidence, with different levels of presentation.

## Model validation

`src/sim/validation/model.ts` owns runtime model invariants. `engine.ts` re-exports `assertModel` for compatibility with existing callers/tests.

Validation checks population identity/conservation, registry-defined population-state bounds, transition-field validity, public accounts, registry-defined mapxel bounds, sector normalization, demographic consistency, price-control constraints, and related structural invariants.

Save validation in `src/sim/save.ts` separately validates serialized boundary data and references before importing a save.

When adding state, prefer extending the relevant field registry and having validation derive from it rather than adding one more handwritten list.

## Engine responsibilities

`src/sim/engine.ts` is now primarily an orchestrator. It owns:

- rule dependency ordering,
- phase execution,
- trusted/untrusted snapshot policy,
- efficient game/model cloning,
- population-phase coordination,
- the top-level monthly `step()`.

It deliberately does **not** own generic resource accounting, causality, or model validation anymore.

### Trusted and untrusted snapshot behavior

For built-in trusted rules, performance matters. The engine lets rules read the live phase-start model, gathers their proposals, then snapshots only the state categories those proposals are about to mutate before settlement.

For untrusted/extension rules, the engine provides a fully cloned and deeply frozen snapshot so an extension cannot mutate or partially advance the caller's game.

This optimization preserves phase-start semantics while avoiding full-world cloning for every built-in phase.

Do not casually change this path: snapshotting affects determinism, atomicity, performance, evidence observations, and settlement correctness.

## Society rule organization

The former large `rules/society.ts` has been split by domain:

```text
src/sim/rules/society.ts              thin society-phase orchestrator
src/sim/rules/society/conditions.ts   crime, health, education, infrastructure, pollution
src/sim/rules/society/labor.ts        sector viability, employment transitions
src/sim/rules/society/wellbeing.ts    happiness/approval/etc. society-phase conditions
src/sim/rules/society/migration.ts    group-specific migration
```

Use this pattern as the simulation gets richer. Split by coherent gameplay domain, not by arbitrary line count, and avoid constructing a generic behavior-plugin framework merely because there are many behaviors.

## Code architecture and data flow

```text
Browser UI
   │
   ├── policy/action → policy.ts → new Game
   │
   └── advance month
          │
          ▼
       engine.ts
       orchestration
          │
          ├── rules/ + population/ behavior rules
          │        │
          │        └── Effects[]
          │
          ├── settlement/resources.ts
          ├── population/settlement.ts
          │
          ├── causality/provenance.ts
          │
          ▼
       updated Model
          │
          ├── population.aggregate → cached human mapxel projections
          ├── validation/model.ts
          ├── math.ts summaries
          └── narrative.ts news/reporting
```

The simulation in `src/sim/` is framework-independent. Vue is a presentation shell around it.

## Module map

| Module | Responsibility |
| --- | --- |
| `types.ts` | Core data vocabulary, rule/effect contracts, phase list. |
| `map-fields.ts` | Mutable mapxel engine semantics and bounds. |
| `population/fields.ts` | Mutable group state storage/bounds/merge semantics. |
| `population/archetypes.ts` | Deterministic archetype definitions/cache. |
| `population/generate.ts` | Initial sparse groups. |
| `population/experience.ts` | How groups experience local economic/social conditions and drift. |
| `population/demographics.ts` | Aging/life-stage transitions, births, mortality. |
| `population/retraining.ts` | Sector opportunity evaluation and occupation switching. |
| `population/aggregation.ts` | Materializes human mapxel projections from settled groups. |
| `population/settlement.ts` | Population effect planning/splitting/movement/state settlement. |
| `population/merge.ts` | Deterministic cohort compaction using registry tolerances. |
| `rules/economy.ts` | Production, trade, consumption, market/business mechanics. |
| `rules/state.ts` | Taxation, financing, and fiscal/service payments. |
| `rules/society/*` | Local social conditions, labor, wellbeing, migration. |
| `rules/events.ts` | Stochastic story/event mechanics. |
| `settlement/resources.ts` | Generic conserved resource and mapxel effect settlement. |
| `causality/provenance.ts` | Evidence/cause/event/provenance infrastructure. |
| `validation/model.ts` | Runtime invariants. |
| `engine.ts` | Rule ordering, phase orchestration, snapshots, monthly step. |
| `policy.ts` | Government action validation, preview, and enactment. |
| `world.ts` | Seeded world and starting state. |
| `math.ts` | Numerical helpers, summaries, keyed RNG. |
| `narrative.ts` | Articles, causal traversal, mandate report. |
| `save.ts` | Versioned serialization/import validation. |
| `src/dev/` | Developer causal/sensitivity workbench. |

## Adding a new behavior

A normal new behavior should follow this route:

```text
new gameplay idea
→ choose/create coherent domain module
→ read existing place + population state
→ calculate reaction from lived state + archetype
→ emit generic Effects + evidence
→ generic settlement/provenance handles mechanics
→ focused tests
→ scenario test only when cross-system emergence needs protection
```

For a new mutable human property, update `PopulationGroup` plus `population/fields.ts` and verify save/UI implications.

For a new mutable place property, update `Mapxel` plus `map-fields.ts` and verify world generation/save/UI implications.

Do not add domain-specific conditionals to `engine.ts`, resource settlement, validation, or causality unless the new concept genuinely changes an engine-level invariant.

## Testing philosophy

The suite is intentionally behavioral, not only structural.

Prefer tests that protect:

- conservation,
- phase simultaneity,
- atomic failure,
- deterministic keyed randomness,
- people-first authority,
- directional policy effects,
- bounded long-run behavior,
- causal traceability,
- save/load reproducibility,
- browser workflows.

Scenario tests should protect **mechanisms**, not force a screenplay. If an ordinary sports subsidy reallocates labor and creates modest food pressure, the test should not insist on a national famine followed by a heroic recovery. Use an explicit stress scenario when a crisis/recovery feedback is what needs testing.

For stochastic flows, focused tests may choose deterministic RNG draws to expose a mechanism. End-to-end scenarios should normally keep keyed randomness and test directional/statistical/bounded outcomes rather than exact fractional bodies.

For tiny perturbations in a thresholded nonlinear simulation, test that national outcomes remain bounded at appropriate scale; do not require exact reconvergence after decades.

Key test areas include:

- `tests/engine.test.ts` for engine/resource/atomicity contracts,
- population authority/resolution/registry tests,
- rule-analysis/devtool causal tests,
- scenario/extreme/historical/ripple suites,
- `tests/browser/` for E2E UI flows.

## Performance model

The performance strategy is **sparse people, not fewer possible people-types**.

The approximately 2,048 archetypes are cheap definitions. Runtime cost is driven much more by live group count, group churn, proposal allocation, population settlement, migration/retraining/demographics, aggregation, and snapshots.

The project intentionally avoids tracking microscopic behavioral histories as independent cohorts. Person-scale stochastic quantization and deterministic compaction keep the sparse representation sparse while preserving expected flow.

`./scripts/perf-sim.ts` and `.github/workflows/perf-sim.yml` provide the current benchmark/profiling path. Treat benchmark numbers as observations, not gameplay contracts. Optimize representation/settlement before sacrificing social diversity or changing model semantics.

## Developer workbench

`src/dev/` exists to understand how the simulation works, not just inspect raw state.

It should help answer:

```text
what changed?
what inputs mattered?
which people reacted?
what did they do?
what changed downstream?
```

The causal graph combines explicit reads/effects/provenance with local perturbation analysis. Direct rule inputs should remain visible even when the current local derivative happens to be zero. Expensive perturbation/Jacobian-style analysis belongs in the on-demand developer path, not every simulation tick.

The intended player-facing hierarchy is roughly:

```text
SEE IT        map/world activity
NOTICE IT     headlines, trends, salient changes
UNDERSTAND IT causal chains
INVESTIGATE IT groups, sensitivities, history
```

The world should visibly react before the game explains everything in a wall of diagnostics.

## Important modeling limitations

Current deliberate simplifications include:

- population groups are cohorts, not individual households;
- group wealth/income are not separately conserved personal accounts;
- firms are represented through local sector/business conditions rather than individual firm agents;
- sector labor share still carries some structural/economic meaning that may eventually be separated from durable firm/job capacity;
- there is no separate road network;
- no full political parties/election system, diplomacy, multiplayer, or external AI service;
- event effects and population aggregate projection currently share a phase, producing the one-tick projection nuance described above;
- causal journals are selective evidence rather than complete counterfactual explanations.

When extending the model, preserve these distinctions rather than silently treating a simplification as a physical law.

## Commands and execution

```sh
npm install
npm run dev
npm test
npm run build
npm run test:e2e
npm run calibrate
npx tsx scripts/perf-sim.ts
```

The PR CI runs the unit/behavioral suite, production build/typecheck, Playwright setup, and E2E tests. A separate Actions workflow runs the simulation performance probe. GitHub Actions is a valid execution harness when a local checkout/runtime is unavailable.

## Documentation responsibilities

- `docs/RULES.md`: player/readable mechanics, equations, thresholds, and metrics.
- `docs/ACTIONS.md`: government controls, action syntax, validation, AI/action boundary.
- `docs/SIMULATION.md`: design rationale, architecture, extension contracts, calibration caveats, limitations.
- `.agents/skills/commonwealth-city/SKILL.md`: concise operational contract for coding/design agents.
- this file: deeper onboarding/mental model.

When architecture changes enough that the module map or authority model changes, update the skill/orientation in the same work rather than letting future agents reverse-engineer yesterday's assumptions from old prose.

## Fast orientation: what to read next

For exact formulas, bounds, event probabilities, and metrics, read `docs/RULES.md` and then verify current source. For action validation, read `docs/ACTIONS.md` and `policy.ts`. For model rationale and limitations, read `docs/SIMULATION.md`. For invariants, start with engine/population registry tests. For emergent behavior, read the relevant scenario tests. For causal debugging, inspect `src/dev/` and provenance-aware rule evidence.

Calibration output is evidence for its specified seeds/scenarios/protocol, not a universal stability guarantee. Tests encode intended repository behavior, but when product intent changes, update stale tests around the intended mechanism rather than tuning the simulation to satisfy obsolete drama.