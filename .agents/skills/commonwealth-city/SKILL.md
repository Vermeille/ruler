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
- `src/sim/rules/`: economy, state, events, and modular society/world rules.
  - `src/sim/rules/society.ts`: thin orchestration for the society phase.
  - `src/sim/rules/society/conditions.ts`: crime, health, education, infrastructure, pollution.
  - `src/sim/rules/society/labor.ts`: job viability and employment transitions.
  - `src/sim/rules/society/wellbeing.ts`: resident-facing aggregate projections/conditions used in the society phase.
  - `src/sim/rules/society/migration.ts`: people-first migration decisions.
- `src/sim/population/`: deterministic archetypes, sparse mutable population groups, field semantics, selectors, experience, aging/demographics, retraining, settlement, merge/compaction, and aggregate projection.
- `src/sim/population/fields.ts`: single source of truth for mutable population-state mechanics such as storage, bounds, and merge tolerances.
- `src/sim/map-fields.ts`: single source of truth for mutable mapxel-field mechanics such as bounds, delta eligibility, and conserved-resource behavior.
- `src/sim/engine.ts`: simulation orchestration: rule ordering, phase execution, optimized snapshots, population-phase coordination, cloning, and the monthly `step()`.
- `src/sim/settlement/resources.ts`: generic conserved-resource settlement, transfers, trades, debt/budget settlement, and accumulated mapxel deltas.
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

## Rules and Effects

Rules should remain boring, local functions:

```ts
const rule: Rule = {
  id: 'domain.behavior',
  phase: '...',
  description: '...',
  run({ model, random, lastEvents }) {
    // read phase-start state
    // calculate response
    // emit generic Effects
    return effects;
  },
};
```

Rules do not directly mutate the model. They emit a deliberately small vocabulary of generic effects: mapxel deltas, account/resource transfers, trades, budget/debt operations, events, population state changes, population transitions, births/deaths, and population transfers.

Prefer composing existing effects over adding behavior-specific engine machinery. Do not introduce `protest-effect`, `religion-effect`, `disease-effect`, etc. merely because a new behavior exists. Add a new fundamental Effect kind only when the state transformation truly cannot be represented by the existing primitives.

## Adding new behavior

For a new archetype/population behavior, normally:

1. Identify the domain module that owns the behavior, or create one focused module.
2. Read required world/person state through existing types/selectors.
3. Compute the reaction using archetype predispositions plus mutable group circumstances.
4. Emit generic Effects with evidence for meaningful causal changes.
5. Add focused unit/behavioral tests, plus a scenario only if the behavior is genuinely emergent or cross-system.
6. Update reader-facing docs when the mechanic changes player-visible behavior.

For a new mutable population scalar, add it to `PopulationGroup` and `population/fields.ts`; settlement, validation, compaction, and save mechanics should derive from the registry rather than acquiring new handwritten field lists.

For a new mutable mapxel scalar, add it to `Mapxel` and `map-fields.ts`; bounds/resource semantics should live in the registry rather than new `engine.ts` conditionals.

Do **not** add domain-specific branches to `engine.ts`, generic settlement, or provenance just to make a behavior easier to implement. The engine should remain largely ignorant of sociology.

## Phase and settlement invariants

- One tick is one month.
- Rules in the same phase conceptually read the same phase-start state; same-phase proposals cannot depend on one another's results.
- Trusted built-in rules use an optimized snapshot strategy: rules read the live phase-start model, then the engine snapshots only state needed by proposed mutations before settlement.
- Untrusted/extension rules receive a deep-frozen cloned snapshot. This protects the caller from direct rule mutation.
- Competing outgoing resource demands are scaled against phase-start balances. Incoming resources cannot be re-spent within the same phase.
- Population settlement conserves cohort mass except for explicit births/deaths; migration and transitions split/move actual groups.
- Discrete behavioral cohort flows use deterministic stochastic quantization at person-scale resolution where appropriate. Preserve expected flows without manufacturing thousands of meaningless sub-person cohorts.
- Population aggregation materializes resident-derived mapxel projections for later economy/UI use.
- Keyed randomness is reproducible by seed, tick, rule ID, cell ID, and channel. Do not replace it with incidental iteration-order RNG.

When changing phases, effect order, settlement, snapshotting, or population compaction, assume the change can alter determinism and causal ancestry until tests prove otherwise.

## Causality and developer tooling

Meaningful behavior should be explainable through the same evidence/provenance infrastructure used by the player UI and developer workbench.

- Evidence may record cells, population-group reads, mapxel reads, policy parent keys, and explanatory text.
- Provenance writes are buffered within a phase so a cause cannot incorrectly depend on another same-phase cause.
- Causal records are selective, not a complete event log and not counterfactual proof.
- New behavior should normally gain tracing by emitting ordinary Effects with evidence, not by adding custom devtools-only causal plumbing.
- Keep direct inputs visible in developer analysis even when a local perturbation happens to produce a zero derivative in the current state.

The workbench exists to understand mechanisms, not merely inspect values. Preserve its ability to answer: what changed, why, which people reacted, what they did, and what changed downstream.

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

The project intentionally supports roughly 2,048 possible archetypes; performance should come from sparse live population groups, efficient settlement, and compact representations, **not** by reducing archetype diversity.

The important performance quantity is the number and churn of live groups, not the size of the archetype definition table. Avoid microscopic cohort fragmentation. Use the existing performance probe after changes to snapshotting, settlement, population splitting/merging, migration, demographics, retraining, aggregation, or hot selectors.

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