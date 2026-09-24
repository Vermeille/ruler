# Simulation design

## Units and state

One tick is one month; the default mandate is 48 ticks. A mapxel is approximately 4 km². Population is a continuous count of residents, allowing fractional expected births and deaths while independent discrete choices such as migration and retraining are resolved at person-scale cohort quanta. Money is fictional crowns. Food is measured in person-month units: each resident needs one unit each month. Materials are abstract maintenance inputs. Taxable output is an abstract monthly economic-activity measure, not cash.

Each land cell has terrain, fertility, mineral suitability, water stress, private cash, food and material stocks, local health/education/service conditions, crime pressure, pollution, transport quality, business viability, sports interest, output, prices, and reported starvation deaths. It also stores cached human compatibility projections such as employment, happiness, approval, demographic shares, and industry shares. Those fields are materialized from settled population groups at the end of each month for UI/save compatibility; causal rules should use authoritative groups or the step cache instead of treating them as a second social model. Indices lie in [0,1]; food prices lie in [0.4,5]. A country has four named regions and a finite external cash account in addition to its treasury and debt.

The model contains 2,048 deterministic archetype definitions, identified by the world seed, archetype model version, and archetype ID. An archetype contains stable predispositions, needs, values, and sector affinities. Each land cell instantiates a sparse set of mutable groups from those archetypes. A group has its own age, education, occupation, employment status, income, wealth, health, wellbeing, approval, and attitudes. Archetype identity does not change when a group loses work or income. The same archetype can therefore exist in several mapxels and in several different socioeconomic states at once.

## Four causal rule directions

The simulation engine is articulated around four causal transformations:

```text
MAPXEL → MAPXEL    how places/world systems evolve
MAPXEL → PEOPLE    how people experience places, policy and opportunity
PEOPLE → MAPXEL    how people act and change the world
PEOPLE → PEOPLE    how people evolve from human state itself
```

Every `Rule` declares exactly one `direction`. The four arrows are the primary causal ontology. Phases only schedule when rules run and settle.

The engine mechanically enforces the **right-hand side** of the arrow. A rule ending in `people` may emit population effects but not world/resource mutations; a rule ending in `mapxel` may emit world/resource effects but not population mutations. `event` effects are metadata and may accompany the relevant mechanism. Violations fail the step before settlement.

The read side is deliberately not hard-restricted. A `mapxel-to-people` rule can legitimately inspect current person state while evaluating how a place affects that person, and a `people-to-mapxel` rule can inspect world conditions while determining what an action accomplishes. Suspicious reads belong in analysis/tests rather than being prohibited by a prematurely narrow type system.

If one mechanic needs to emit both population and world mutations, represent the distinct arrows as distinct rules. Split stochastic rules may share `randomNamespace` so keyed random decisions remain identical after the split.

### Ephemeral step cache

At the start of `step()`, after the working model advances to the month being simulated and before any rule phase runs, the engine builds one immutable `StepCache` from authoritative `PopulationGroup` state. The cache contains per-mapxel population totals, adult/employed counts, employment rate, child/senior shares, population-weighted education/income/wealth/health/wellbeing/approval, and employed occupational shares. Every rule in that month receives the same cache instance.

The cache is a read optimization, not state. It is not part of `Game` or `Model`, cannot be written by Effects, is not settled or persisted, and is discarded after the step. A later month rebuilds it from then-authoritative groups. The cache deliberately never falls back to mapxel human projections.

The cache means **step-start population state**. A rule that genuinely needs human changes settled earlier in the same month must read the current authoritative groups instead of expecting the cache to refresh. This is why food-driven mortality, which runs after ordinary demographics, reads the post-demographic groups directly. Direct isolated rule calls in tests may derive a local cache from their supplied snapshot because no step lifecycle owns one. The developer causal lens instead rebuilds the real step-start cache from the game at the beginning of the traced month, tracks cache reads explicitly as people-summary inputs, and uses that same cache semantics for local perturbations.

`traceStep()` builds the cache at the same point and reuses it for all traced phases, so developer instrumentation observes the same temporal semantics as production execution. Rule traces also retain each rule's declared direction.

## A month

| Phase | What changes |
| --- | --- |
| Production | `people→mapxel`: farms/factories create stocks and output from step-start population, employment, health, and occupations; exports bring external cash |
| Trade | `mapxel→mapxel`: neighboring places exchange food/materials and cash; roads limit equalization |
| Consumption | `people→mapxel`: residents consume food and private cash; unmet need sets local food security |
| Market | `mapxel→mapxel`: scarcity moves prices; insecurity and payroll affordability alter business conditions |
| Taxation | `mapxel→mapxel`: taxes move private cash to the treasury |
| Financing | `mapxel→mapxel`: borrowing covers eligible cash shortfalls |
| Fiscal | `mapxel→mapxel`: interest, services, subsidies, and principal repayment settle |
| Society | autonomous `mapxel→mapxel` conditions, `people→mapxel` resident environmental pressures, and `mapxel→people` employment |
| Experience | `mapxel→people`: groups update income, wealth, health, education, wellbeing, approval, and environment/liberty attitudes |
| Behavior | `people→mapxel` crime pressure plus `people→people` endogenous solidarity/traditionalism drift |
| Aging | `people→people`: every group ages one month |
| Life stage | `people→people`: age thresholds create adults/seniors and retirement transitions |
| Demographics | `people→people`: yearly births and ordinary mortality |
| Deprivation | `mapxel→people`: food insecurity causes additional mortality; a mapxel report records the severe component |
| Migration | `mapxel→people`: groups choose/move to better-fitting places; `people→mapxel`: their proportional pooled cash follows |
| Adaptation | `mapxel→people`: new adults choose occupations and existing adults retrain toward local opportunity |
| Events | `mapxel→mapxel` world/event consequences plus `mapxel→people` morale experience from the same keyed draw |
| Projection | `people→mapxel`: final compatibility human fields are materialized for UI/save consumers |

All rules in a phase read the same immutable phase snapshot. They return proposals rather than mutating state. The engine commits proposals together before taking the next phase's snapshot. Incoming stocks cannot be spent until a later phase. Taxation, financing, and fiscal payments therefore have separate phases. Population rules use the same settlement contract: phase-start groups are the authority, partial changes split cohorts, competing requests share the source count, and compaction may merge sufficiently similar histories afterward.

A same-phase `after` dependency orders evaluation/provenance but does not let one rule observe another rule's writes. Use a later phase when a rule must consume newly settled state. This distinction matters for cohort integrity: two full-group changes that should happen sequentially belong in sequential phases rather than competing from the same source snapshot.

The default engine has no aggregate sector-share adaptation rule. Labor composition changes because actual people enter occupations, gain/lose employment, and retrain. Production reads the immutable population summary rather than legacy mapxel labor projections.

## Conservation and settlement

Cash cannot be changed through a cell delta. A `transfer` moves equal amounts between two accounts. A `trade` moves both a commodity and its cash payment atomically. Competing requests reserve the same starting stocks: source demands are summed, then each proposal is scaled proportionally to source availability. A trade takes the smaller of its goods and cash capacity factors. This is intentionally a conservative one-pass settlement; it may leave some inventory unused when another participant is cash-constrained, but does not mint money or sell the same unit twice.

Food/material consumption and outgoing transfers share that same stock budget. Production and destruction are explicit deltas. Generic resource settlement cannot mutate population. Migration uses `population-transfer`; births and deaths use `population-delta`; population settlement updates both group counts and the cached mapxel population. Raw mapxel population deltas are rejected rather than reconciled by resizing groups afterward.

Population effects request a transfer, discrete transition, continuous state change, birth, or death from a phase-start group. Competing branching requests from one group scale to that starting group's count; partial requests split the group, and similar groups may merge after settlement. Group IDs are deterministic and unique. Migration moves actual groups, so archetype composition moves between cells. Monthly deaths remove people from source groups, and yearly births add new child cohorts.

The open-economy boundary is intentional: firms/households in a cell share a private account. Export receipts come from the external account; imported consumption, a fraction of public procurement, capital projects, interest, and principal repayment go back to it. Local transactions within a mapxel net out. Group income and wealth are distributional/behavioral human state rather than separately conserved bank accounts. The model does not claim that gross output itself creates money. Public borrowing transfers existing external cash and increases debt; surplus cash above operating reserves repays principal. Unpaid interest capitalizes as arrears, so total debt can exceed the principal borrowing limit after default.

All phases validate finite numbers, nonnegative stocks/accounts, bounded indices, group validity, population consistency, and industry shares summing to one. A failing rule rolls back the **entire tick** because the engine mutates only its working copy. Direction/output mismatches fail before settlement as well.

Save version 4 persists mutable groups and their next ID. Archetype definitions are reconstructed from the seed and model version. Version 1–3 saves construct deterministic population groups from aggregate cell state at the saved tick. Version 1 and 2 saves also load with the wage floor set to zero.

## Calibrating feedback

- Price adjustments are damped at 14% of the supply-demand gap per month; the index has explicit bounds.
- Occupational composition changes through group entry, employment and retraining rather than macro sector-share relaxation. Subsidies and high food prices alter the opportunities people see; the next step's population cache exposes the settled occupational mix to production.
- Business viability adjusts by 15%. Local health/education access, pollution, infrastructure, food access, and other environmental conditions remain damped mapxel processes. Resident wealth, density and worker composition contribute through a separate `people-to-mapxel` environment-impact rule.
- Crime is `people-to-mapxel`. Group wealth, employment status, neighborhood inequality, policing, and welfare contribute to pressure; the resulting mapxel crime state feeds later business, migration, events, and experience rules.
- Severe food deprivation is `mapxel-to-people` in the deprivation phase. Natural births/deaths settle first; then current groups experience food-driven mortality. `starvationDeaths` is a compatibility report of the severe component, not the mortality authority.
- Food spoils by 16% of post-consumption stock; materials have upkeep and 12% inventory depreciation. Stockpiles cannot accumulate without limit under ordinary production.
- Higher reserves increase imports, creating a savings equilibrium. Neighbor migration is evaluated by groups every third month and each group's rate is capped at 0.9% per decision before movement-law restrictions; food scarcity can overwhelm an output gain.
- A wage floor changes sector job viability only when it exceeds what local firms can pay from receipts after business tax and imported inputs. Firms change available work conditions; actual population groups gain or lose jobs through the `mapxel-to-people` employment rule.
- Event families sample one candidate place per month rather than rolling a national catastrophe once per cell. Cooldowns keep events from dominating the model as map size increases. World consequences and human morale consequences share a random namespace so a split event produces one stochastic outcome, not two independent lotteries. Event-linked population provenance resolves at phase commit rather than forcing a false same-phase rule dependency.
- A regional drought adds local water stress, cutting subsequent farm yields by up to 60%; 35% of accumulated stress recovers each month. Repeated shocks can stack without changing permanent terrain fertility.
- The default budget starts at 28% income tax, 18% business tax, and ₡1.50 of services per resident. At initial output, revenue equals spending. Starting reserves absorb transitional deficits.

Calibration ranges recorded before the population-authority and four-arrow refactors should be treated as historical evidence, not current guarantees. The regression suite checks long runs, conservation, policy directionality, extreme fiscal settings, authority boundaries, four-arrow enforcement, and matched scenarios. [TESTING.md](TESTING.md) records scenario contracts and limits; [HISTORICAL_ANALOGUES.md](HISTORICAL_ANALOGUES.md) distinguishes reproducible mechanisms from historical cases this model cannot represent. `npm run calibrate` runs multi-seed full-size worlds.

## Adding state and behavior

Rules are ordinary TypeScript objects. Pass an expanded registry to `step(game, rules)` or add a rule to `defaultRules` for the game UI. Every rule must declare one of the four directions.

```ts
import type { Rule } from './src/sim/types';
import { defaultRules } from './src/sim/rules';
import { step } from './src/sim/engine';

const airQuality: Rule = {
  id: 'environment.street-trees',
  direction: 'mapxel-to-mapxel',
  phase: 'society',
  description: 'Local environmental investment slowly improves air quality.',
  run({ model }) {
    return model.cells.filter(c => c.population > 0).map(c => ({
      kind: 'delta' as const,
      cell: c.id,
      field: 'pollution' as const,
      amount: -c.pollution * 0.01,
    }));
  },
};

// game = step(game, [...defaultRules, airQuality]);
```

Use unique IDs and existing phases. Optional `after` dependencies validate order, including rejecting missing dependencies, cycles, and dependencies in later phases. **Same-phase dependencies do not allow observing writes from another rule.** Use a later phase when effects need to consume updated state.

Keyed RNG normally uses world seed, month, rule ID, cell ID, and optional channel. Split rules that represent two causal consequences of one stochastic decision may declare the same `randomNamespace`; this intentionally gives them the same keyed draws while preserving separate rule IDs and effect directions.

Use `transfer` for ordinary cash movement, `repayDebt` for paired principal payment/debt reduction, `trade` for coupled exchange, `delta` for physical/world changes, and population effects for human changes. Continuous and discrete population field mechanics live in the population field registry; mutable mapxel field mechanics live in the mapxel field registry. Runtime validation, bounds, merge behavior, save validation, and tooling should consume those registries rather than growing parallel hardcoded field lists.

When a mechanism represents something people do or experience, change population groups and derive any compatibility aggregate rather than independently mutating employment, happiness, approval, demographics, or labor composition. If one proposed rule needs both population and world outputs, split the mechanism by arrow instead of adding an exception to direction validation.

When a rule only needs aggregate information about the settled population at the start of the month, prefer the immutable `StepCache` over adding or reading another persistent mapxel mirror. The cache is fixed for the whole step by design; a rule that must observe human changes settled earlier in the same month must read authoritative groups.

Give substantial changes `evidence`: title, mechanism, affected cells, measured input fields, and relevant policy keys. The rule-analysis tooling observes normal model reads, explicit step-cache summary reads, random inputs and Effects. It computes local sensitivities against the same summary values a rule actually consumes, and its influence graph treats population changes as feeding cache consumers only in later months. New behavior should acquire causal input/output and downstream views without a behavior-specific devtools implementation.

## Stories and causal honesty

Significant changes create immutable cause records containing tick, rule, cells, magnitude, observations, and IDs of earlier recorded contributors. A cell/field provenance index connects later changes to recorded inputs. Same-phase effects only reference provenance from their shared input snapshot, preventing false within-phase causation. Event records state probabilities where relevant; an event is not attributed to policy as an inevitable outcome.

Event-linked effects may register their provenance link before or after the matching event record within the same phase. Those links resolve at phase commit. This preserves the same-snapshot semantics of split event rules without imposing an `after` dependency solely for bookkeeping.

The journal is **selective**, not a full structural causal model. Small updates may have no record. Parent links show contributing inputs and latest relevant interventions, not counterfactual proof or exhaustive attribution. News retains evidence IDs. Mandate chains traverse the existing graph rather than inventing relationships. Community quotes are explicitly fictional templates selected from measured conditions. All graphs and histories persist in exported saves; IndexedDB stores larger browser autosaves.

## Current limits

This is a fictional, deliberately simplified economy. Residents are represented by cohorts rather than individual people or households, and firms remain aggregate local economic conditions rather than separate balance sheets. Group income and wealth are not separately conserved cash accounts. `population.aggregate` still writes human mapxel compatibility fields for UI/save consumers even though causal rules are being moved off them; removing that projection entirely is a later compatibility cleanup, not a reason to treat it as authority. Agriculture represents a staple basket; manufacturing produces generic materials. Restaurant failures are represented through business viability. There is no interregional transport graph beyond cell neighbors, market auction, electoral-party system, or foreign diplomacy. Projects immediately improve an index that subsequently needs public upkeep. Events, weather, inheritance variation, and some demographic choices use keyed deterministic random draws. Save validation protects against corruption and invalid engine state, not cheating. Custom extremes can cause hardship and default, with finite and inspectable consequences.
