---
name: commonwealth-city
description: Orient to and work on the Commonwealth project, a people-first policy and society simulator. Use for gameplay, simulation design, architecture, rule, metric, UI, testing, performance, or code questions in this repository.
---

# Commonwealth

Use this skill for work in this repository's fictional country, economy, and society simulation. For unfamiliar subsystems or broad design work, first read [the project orientation](references/project-orientation.md). Treat checked-out source and tests as authoritative when prose differs, and verify current implementation before making numerical or architectural claims.

## The core model

The central causal loop is:

```text
WORLD / MAP / POLITICS
        ↓
people experience conditions
        ↓
people react and change
        ↓
people act
        ↓
MAP / ECONOMY / POLITICS change
```

Preserve that loop when adding mechanics.

- **Archetypes are durable predispositions.** They hold needs, values, traits, and affinities.
- **Population groups are mutable circumstances.** They hold age/life stage, education, occupation, employment, income, wealth, health, wellbeing, approval, and attitudes.
- **Population groups are authoritative for human state.** Mapxel employment, happiness/wellbeing, approval, demographic shares, and sector labor shares are projections/caches derived from residents, not a second social simulation.
- **Human events should happen to people when possible.** Job loss, retraining, migration, aging, births/deaths, attitude drift, and similar mechanics should operate on groups rather than directly editing a social mapxel aggregate.
- **Mapxels represent place and local systems.** Terrain, stocks, prices, pollution, infrastructure, crime pressure, business conditions, services, and other local conditions can affect people and be affected by them.
- **Policies usually change conditions, incentives, constraints, rights, or resources.** People then react according to both their archetype and lived circumstances.

Do not reintroduce aggregate-only social mechanics merely because a projected mapxel field is convenient to read.

## Architecture at a glance

- `src/sim/rules.ts`: active/default rule composition and public exports.
- `src/sim/rules/`: economy, state, environment, events, and other world-facing rules.
- `src/sim/population/`: deterministic archetypes, sparse mutable population groups, field semantics, selectors, experience, employment, crime, aging/demographics, migration, retraining, settlement, merge/compaction, and compatibility projection.
- `src/sim/step-cache.ts`: immutable per-step population summaries derived from authoritative groups.
- `src/sim/rule-direction.ts`: four-arrow direction validation and output-side Effect enforcement.
- `src/sim/population/fields.ts`: single source of truth for mutable population-state mechanics such as storage, bounds, and merge tolerances.
- `src/sim/map-fields.ts`: single source of truth for mutable mapxel-field mechanics such as bounds, delta eligibility, and conserved-resource behavior.
- `src/sim/engine.ts`: simulation orchestration: rule ordering, phase execution, one step-start people cache, optimized snapshots, generic settlement, cloning, and the monthly `step()`.
- `src/sim/settlement/resources.ts`: generic conserved-resource settlement, transfers, trades, debt/budget settlement, and accumulated mapxel deltas.
- `src/sim/population/settlement.ts`: generic population splitting, movement, transitions, state changes, births, and deaths.
- `src/sim/causality/provenance.ts`: evidence capture, causes, events, ancestry, and buffered provenance writes.
- `src/sim/validation/model.ts`: runtime model invariants; `engine.ts` re-exports `assertModel` for compatibility.
- `src/sim/policy.ts`: action validation, mutation, scope/subsidy precedence, previews, and investments.
- `src/sim/world.ts`: seeded initial world, policy, accounts, and initial population groups.
- `src/sim/types.ts`: state vocabulary, actions, phases, rules, evidence, and the small generic Effect union.
- `src/sim/math.ts`: deterministic keyed randomness, numerical helpers, and national/selected summaries.
- `src/sim/narrative.ts`: monthly news, cause traversal, and mandate reporting.
- `src/sim/save.ts`: versioned JSON serialization and boundary validation.
- `src/App.vue`, `src/components/`, `src/composables/useGame.ts`: player UI and browser-facing game lifecycle.
- `src/dev/`: developer workbench, causal graph, perturbation/sensitivity analysis, and rule inspection.
- `src/ui/map.ts`: canvas map rendering, layers, selection, and map interactions.
- `src/ui/storage.ts`: IndexedDB autosaves.

Read the specific source and tests relevant to the change. Documentation examples and calibration results are not proof of mechanics when implementation can be inspected directly.

## Four-arrow rules and Effects

Every rule declares exactly one causal transformation:

```text
mapxel → mapxel
mapxel → people
people → mapxel
people → people
```

The arrow states what the rule **changes**, not a whitelist of everything it may inspect. The engine hard-enforces the right-hand/output side. Read-side inputs intentionally remain flexible because real mechanisms often need context from both ontologies: employment depends on local firms and worker characteristics; migration evaluates places through a group's circumstances; people-to-world actions depend on world constraints. Keep these cross-side reads visible in developer analysis and tests rather than banning them in the type system.

Rules should remain boring, local functions:

```ts
const rule: Rule = {
  id: 'domain.behavior',
  direction: 'mapxel-to-people',
  phase: '...',
  description: '...',
  run({ model, cache, random, lastEvents }) {
    // read phase-start state plus the immutable step-start people cache
    // calculate response
    // emit generic Effects whose output side matches direction
    return effects;
  },
};
```

Rules do not directly mutate the model. They emit a deliberately small vocabulary of generic effects: mapxel deltas, account/resource transfers, trades, budget/debt operations, events, population state changes, population transitions, births/deaths, and population transfers.

If one mechanic naturally has consequences on both output sides, split it into distinct arrow rules instead of granting an exception. Split stochastic rules may share `randomNamespace` so both halves use the same keyed draw.

Prefer composing existing effects over adding behavior-specific engine machinery. Do not introduce `protest-effect`, `religion-effect`, `disease-effect`, etc. merely because a new behavior exists. Add a new fundamental Effect kind only when the state transformation truly cannot be represented by the existing primitives.

## Adding new behavior

For a new archetype/population behavior, normally:

1. Identify the domain module that owns the behavior, or create one focused module.
2. Choose the rule's causal direction from the four arrows.
3. Read required world/person state through existing types, selectors, or the step cache.
4. Compute the reaction using archetype predispositions plus mutable group circumstances.
5. Emit generic Effects whose output side matches the declared direction, with evidence for meaningful causal changes.
6. Add focused unit/behavioral tests, plus a scenario only if the behavior is genuinely emergent or cross-system.
7. Update reader-facing docs when the mechanic changes player-visible behavior.

For a new mutable population scalar, add it to `PopulationGroup` and `population/fields.ts`; settlement, validation, compaction, and save mechanics should derive from the registry rather than acquiring new handwritten field lists.

For a new mutable mapxel scalar, add it to `Mapxel` and `map-fields.ts`; bounds/resource semantics should live in the registry rather than new `engine.ts` conditionals.

Do **not** add domain-specific branches to `engine.ts`, generic settlement, provenance, or direction validation just to make a behavior easier to implement. The engine should remain largely ignorant of sociology.

## Step cache, phase, and settlement invariants

- One tick is one month.
- At step start, after advancing the month and before phases run, build exactly one immutable people cache from authoritative population groups. All rules in that month receive the same cache.
- The cache is ephemeral execution state, never persisted model state and never an Effect target.
- The cache means **step-start people**. If a later phase needs population changes settled earlier in the same month, read current authoritative groups instead.
- Rules in the same phase conceptually read the same phase-start state; same-phase proposals cannot depend on one another's results.
- A same-phase `after` dependency orders execution/provenance only; it does not expose writes. Use a later phase for causal consumption of settled state.
- Trusted built-in rules use an optimized snapshot strategy: rules read the live phase-start model, then the engine snapshots only state needed by proposed mutations before settlement.
- Untrusted/extension rules receive a deep-frozen cloned snapshot. This protects the caller from direct rule mutation.
- Competing outgoing resource demands are scaled against phase-start balances. Incoming resources cannot be re-spent within the same phase.
- Population settlement conserves cohort mass except for explicit births/deaths; migration and transitions split/move actual groups.
- Two conceptually sequential full-group updates should settle in distinct phases rather than competing from the same cohort snapshot.
- Discrete behavioral cohort flows use deterministic stochastic quantization at person-scale resolution where appropriate. Preserve expected flows without manufacturing thousands of meaningless sub-person cohorts.
- Population aggregation at the final projection phase materializes resident-derived mapxel compatibility fields for UI/save consumers. Causal rules should not use those projections as social authority.
- Keyed randomness is reproducible by seed, tick, random namespace (normally the rule ID), cell ID, and channel. Do not replace it with incidental iteration-order RNG.

When changing phases, effect order, settlement, snapshotting, population compaction, or cache semantics, assume the change can alter determinism and causal ancestry until tests prove otherwise.

## Causality and developer tooling

Meaningful behavior should be explainable through the same evidence/provenance infrastructure used by the player UI and developer workbench.

- Evidence may record cells, population-group reads, mapxel reads, policy parent keys, and explanatory text.
- Provenance writes are buffered within a phase so a cause cannot incorrectly depend on another same-phase cause.
- Event provenance links may resolve at phase commit so split same-phase event rules do not require false data dependencies merely for bookkeeping.
- Causal records are selective, not a complete event log and not counterfactual proof.
- New behavior should normally gain tracing by emitting ordinary Effects with evidence, not by adding custom devtools-only causal plumbing.
- Keep direct inputs visible in developer analysis even when a local perturbation happens to produce a zero derivative in the current state.
- Developer analysis must execute rules with the same step-start cache and `randomNamespace` semantics as production. Show cache reads as people-summary inputs rather than pretending cached mapxel projections are causal inputs.
- Population writes feed later direct population reads immediately after settlement, but they feed step-cache reads only in a later month because the cache does not refresh mid-step.

The workbench exists to understand mechanisms, not merely inspect values. Preserve its ability to answer: what changed, what inputs mattered, which people reacted, what they did, what changes downstream, and where recurrent feedback returns.

## Testing philosophy

Tests should protect **mechanisms and invariants**, not force a predetermined dramatic story.

Good scenario assertions look like:

```text
policy/intervention
→ people or world conditions respond
→ downstream quantities move in the expected direction
→ the causal chain is traceable
→ conservation / boundedness still holds
```

Avoid tests that require an ordinary intervention to create a specific catastrophe, recovery arc, or exact long-run number unless that magnitude is itself part of the product contract. A moderate sports subsidy, for example, should prove labor reallocation and downstream pressure; it need not cause a famine merely because an old test once enjoyed theatre.

For stochastic person-scale flows, unit tests may use explicit deterministic draws to inspect a mechanism. Scenario tests should normally use the engine's keyed RNG and assert expected directional/bounded behavior rather than fractional-person determinism.

Long nonlinear simulations should be tested for bounded sensitivity and structural stability, not exact reconvergence after microscopic perturbations.

Important commands:

```sh
npm test
npm run build
npm run test:e2e
npm run calibrate
npx tsx scripts/perf-sim.ts
```

The PR CI runs unit/behavioral tests, production build/typecheck, and Playwright E2E. `.github/workflows/perf-sim.yml` runs the simulation performance probe. Use GitHub Actions as the execution harness when the local environment cannot run the repository.

## Performance guardrails

The project intentionally supports roughly 2,048 possible archetypes; performance should come from sparse live population groups, efficient settlement, compact representations, and the shared step cache, **not** by reducing archetype diversity.

The important performance quantity is the number and churn of live groups, not the size of the archetype definition table. Avoid microscopic cohort fragmentation. Use the existing performance probe after changes to snapshotting, settlement, population splitting/merging, migration, demographics, retraining, aggregation, hot selectors, or cache construction.

Current performance numbers are observations for the current benchmark, not universal targets. Do not hard-code them into gameplay contracts. Preserve or improve performance without changing model semantics merely to make a benchmark green.

## Mathematical and modeling conventions

- Population is continuous at the accounting layer but discrete behavioral splits are quantized where meaningful.
- Food is in resident-month units. Money is fictional crowns. `output` is abstract activity, not cash.
- Group income/wealth are distributional human state, not conserved individual bank accounts. Cell cash remains the aggregate private local account.
- National/local indices are generally population-weighted; totals remain totals. Verify `math.ts` for exact summary semantics.
- Budget forecasts and realized tax collections are different: realized taxation can be constrained by available private cash.
- Calibration output describes specific seeds/scenarios/protocols; never present one run's observed range as a universal law.

For any equation, rate, bound, metric, phase, or calibration claim, verify current source before editing prose.

## Documentation and extension hygiene

- Update `docs/RULES.md` when player-visible mechanics/equations change.
- Update `docs/ACTIONS.md` when action syntax, bounds, validation, or policy controls change.
- Update `docs/SIMULATION.md` when model architecture, rationale, limitations, or extension contracts change.
- Update this skill and the orientation when architectural ownership changes enough that a future agent could be pointed at the wrong file or ontology.
- Keep model limitations explicit. Do not present journal/provenance links as full causal proof.
- Prefer incremental domain refactors prompted by real feature work. Do not build abstract plugin/framework machinery merely to make files smaller.

The desired codebase is one where adding rich behavior mostly means adding or extending a domain rule plus tests, while the engine, settlement, validation, and causality infrastructure remain stable.
