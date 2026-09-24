# Simulation design

## Units and state

One tick is one month; the default mandate is 48 ticks. A mapxel is approximately 4 km². Population is a continuous count of residents, allowing fractional expected births and deaths while independent discrete choices such as migration and retraining are resolved at person-scale cohort quanta. Money is fictional crowns. Food is measured in person-month units: each resident needs one unit each month. Materials are abstract maintenance inputs. Taxable output is an abstract monthly economic-activity measure, not cash.

Each land cell has terrain, fertility, mineral suitability, water stress, private cash, food and material stocks, local health/education/service conditions, crime pressure, pollution, transport quality, business viability, sports interest, output, prices, and reported starvation deaths from the most recent demographic pass. It also stores cached human aggregates such as employment, happiness, approval, demographic shares, and industry shares. Those human aggregates are materialized from settled population groups at the end of each month; they are not an independent second social model. Indices lie in [0,1]; food prices lie in [0.4,5]. A country has four named regions and a finite external cash account in addition to its treasury and debt.

The model contains 2,048 deterministic archetype definitions, identified by the world seed, archetype model version, and archetype ID. An archetype contains stable predispositions, needs, values, and sector affinities. Each land cell instantiates a sparse set of mutable groups from those archetypes. A group has its own age, education, occupation, employment status, income, wealth, health, wellbeing, approval, and attitudes. Archetype identity does not change when a group loses work or income. The same archetype can therefore exist in several mapxels and in several different socioeconomic states at once.

The principal causal loop is **world conditions → people experience them → people react and act → their actions change the world**. Mapxel rules provide resources, prices, environmental conditions, public services, business conditions, legal constraints, and job opportunities. Population rules turn those conditions into human state changes, employment histories, crime pressure, migration, demographics, and retraining. `population.aggregate` then projects settled human state back into mapxel employment, wellbeing/happiness, approval, demographic shares, and employed occupational shares so the following month's economy reads the people produced by the previous month.

### Ephemeral step cache

At the start of `step()`, after the working model has advanced to the month being simulated and before any rule phase runs, the engine builds one immutable `StepCache` from `PopulationGroup` state. The cache contains per-mapxel population totals, adult/employed counts, employment rate, child/senior shares, population-weighted education/income/wealth/health/wellbeing/approval, and employed occupational shares. Every rule in that month receives the same cache instance.

The cache is a read optimization, not state. It is not part of `Game` or `Model`, cannot be written by Effects, is not settled or persisted, and is discarded after the step. A later month rebuilds it from the then-authoritative population groups. The cache deliberately never falls back to mapxel human projections. Those persisted projection fields still exist for compatibility with current economy/UI code while rule consumers are migrated; they must not become an input authority for the cache.

`traceStep()` builds the cache at the same point and reuses it for all traced phases, so developer instrumentation observes the same temporal semantics as production execution.

## A month

| Phase | What changes |
| --- | --- |
| Production | Farms and factories create physical stocks; industry output generates explicit export receipts from the external account, using the previous settled human labor projections |
| Trade | Four-neighbor bilateral food/material trades exchange goods and cash together; roads limit equalization |
| Consumption | Residents eat available food; unmet needs set food security; imports, upkeep, and spoilage drain cash or stocks explicitly |
| Market | Food prices respond gradually to scarcity; shortages, ingredients, and payroll affordability weaken restaurants/shops |
| Taxation | Taxes on output move private money to the treasury, limited by actual private cash |
| Financing | Explicit borrowing covers a shortfall up to a principal credit limit of ₡30 per resident |
| Fiscal | Interest is paid first; services and subsidies are funded proportionately; surplus above operating reserves repays debt principal |
| Environment (`society`) | Public services and world state update health access, education access, infrastructure, pollution, and cultural/sports conditions |
| Employment | Actual adult groups gain or lose employment according to local business demand, occupation viability, education, and adaptability |
| Experience | Groups update income, wealth, health, wellbeing, approval, and attitudes from their circumstances and archetype needs |
| Behavior | Resident behavior changes the world; currently group poverty, employment, inequality, policing, and welfare produce local crime pressure |
| Aging | Every group ages by one month |
| Life stage | People crossing age thresholds become adults or seniors; retirement/employment transitions happen to the affected groups |
| Demographics | Yearly birth cohorts create children; monthly ordinary and starvation mortality remove people from actual groups and report starvation deaths |
| Migration | Every third month each adult group evaluates neighboring mapxels through its own needs, work, wealth, mobility, community attachment, and local conditions |
| Adaptation | Groups retrain or switch occupation toward opportunities made attractive by local conditions, prices, subsidies, education access, and archetype adaptability |
| Events | Risk-conditioned, reproducible crime, sports, and weather events affect world state and the groups experiencing them |
| Projection | Settled population state is materialized into cached mapxel employment, wellbeing, approval, demographics, and occupational shares |

All rules in a phase read the same immutable phase snapshot. They return proposals rather than mutating state. The engine commits proposals together before taking the next phase's snapshot. Incoming stocks cannot be spent until a later phase. Taxation, financing, and fiscal payments therefore have separate phases. Population rules use the same settlement contract: phase-start groups are the authority, partial changes split cohorts, competing requests share the source count, and compaction may merge sufficiently similar histories afterward.

The default engine has no aggregate sector-share adaptation rule. Labor composition changes because actual groups gain or lose employment and because people retrain or switch occupation; `population.aggregate` then recalculates employed occupational shares from those groups.

## Conservation and settlement

Cash cannot be changed through a cell delta. A `transfer` moves equal amounts between two accounts. A `trade` moves both a commodity and its cash payment atomically. Competing requests reserve the same starting stocks: source demands are summed, then each proposal is scaled proportionally to source availability. A trade takes the smaller of its goods and cash capacity factors. This is intentionally a conservative one-pass settlement; it may leave some inventory unused when another participant is cash-constrained, but does not mint money or sell the same unit twice.

Food/material consumption and outgoing transfers share that same stock budget. Production and destruction are explicit deltas. Generic resource settlement cannot mutate population. Migration uses `population-transfer`; births and deaths use `population-delta`; population settlement updates both group counts and the cached mapxel population. Raw mapxel population deltas are rejected rather than reconciled by resizing groups afterward.

Population effects request a transfer, discrete transition, continuous state change, birth, or death from a phase-start group. Competing branching requests from one group scale to that starting group's count; partial requests split the group, and similar groups may merge after settlement. Group IDs are deterministic and unique. Migration moves actual groups, so archetype composition moves between cells. Monthly deaths remove people from source groups, and yearly births add new child cohorts.

The open-economy boundary is intentional: firms/households in a cell share a private account. Export receipts come from the external account; imported consumption, a fraction of public procurement, capital projects, interest, and principal repayment go back to it. Local transactions within a mapxel net out. Group income and wealth are distributional/behavioral human state rather than separately conserved bank accounts. The model does not claim that gross output itself creates money. Public borrowing transfers existing external cash and increases debt; surplus cash above operating reserves repays principal. Unpaid interest capitalizes as arrears, so total debt can exceed the principal borrowing limit after default.

All phases validate finite numbers, nonnegative stocks/accounts, bounded indices, group validity, population consistency, and industry shares summing to one. A failing rule rolls back the **entire tick** because the engine mutates only its working copy.

Save version 4 persists mutable groups and their next ID. Archetype definitions are reconstructed from the seed and model version. Version 1–3 saves construct deterministic population groups from the aggregate cell state at the saved tick. Version 1 and 2 saves also load with the wage floor set to zero.

## Calibrating feedback

- Price adjustments are damped at 14% of the supply-demand gap per month; the index has explicit bounds.
- Occupational composition changes through group employment and retraining rather than macro sector-share relaxation. Subsidies and high food prices alter the opportunities groups see; `population.aggregate` materializes the resulting employed occupational mix for next month's production.
- Business viability adjusts by 15%. Local health/education access, pollution, infrastructure, food access, and other environmental conditions remain damped mapxel processes. Human wellbeing, approval, employment, and occupational composition are population state or projections.
- Crime is a people-to-world behavior. Group wealth, employment status, neighborhood inequality, policing, and welfare contribute to pressure; the resulting mapxel crime state then feeds later business, migration, events, and experience rules.
- Severe food deprivation is resolved inside demographics. The demographic rule derives starvation pressure from current food security, emits actual group death effects, and writes `starvationDeaths` as a reported outcome of the same process.
- Food spoils by 16% of post-consumption stock; materials have upkeep and 12% inventory depreciation. Stockpiles cannot accumulate without limit under ordinary production.
- Higher reserves increase imports, creating a savings equilibrium. Neighbor migration is evaluated by groups every third month and each group's rate is capped at 0.9% per decision before movement-law restrictions; food scarcity can overwhelm an output gain.
- A wage floor changes sector job viability only when it exceeds what local firms can pay from receipts after business tax and imported inputs. Firms therefore change the number of jobs available; population groups, ordered by occupation viability, education, and archetype adaptability, are the entities that actually lose or gain employment.
- Event families sample one candidate place per month rather than rolling a national catastrophe once per cell. Cooldowns keep events from dominating the model as map size increases. Morale-changing events change group wellbeing so the final projection remains consistent with the people who experienced the event.
- A regional drought adds local water stress, cutting subsequent farm yields by up to 60%; 35% of accumulated stress recovers each month. Repeated shocks can stack without changing permanent terrain fertility.
- The default budget starts at 28% income tax, 18% business tax, and ₡1.50 of services per resident. At initial output, revenue equals spending. Starting reserves absorb transitional deficits.

Calibration ranges recorded before the population-authority inversion should be treated as historical evidence, not current guarantees. The regression suite checks long runs, conservation, policy directionality, extreme fiscal settings, authority boundaries, and matched scenarios. [TESTING.md](TESTING.md) records the scenario contracts and their limits; [HISTORICAL_ANALOGUES.md](HISTORICAL_ANALOGUES.md) distinguishes reproducible mechanisms from historical cases this model cannot represent. `npm run calibrate` runs multi-seed full-size worlds.

## Adding state and behavior

Rules are ordinary TypeScript objects. Pass an expanded registry to `step(game, rules)` or add a rule to `defaultRules` for the game UI. New behavior should normally read existing world/person state and emit generic effects; the engine should not learn a special case for each social mechanism.

```ts
import type { Rule } from './src/sim/types';
import { defaultRules } from './src/sim/rules';
import { step } from './src/sim/engine';

const airQuality: Rule = {
  id: 'environment.street-trees',
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

Use unique IDs and existing phases. Optional `after` dependencies validate order, including rejecting missing dependencies, cycles, and dependencies in later phases. **Same-phase dependencies do not allow observing writes from another rule.** Use a later phase when effects need to consume updated state. Registration order is canonicalized; keyed RNG uses world seed, month, rule ID, cell ID, and optional channel, so an unrelated rule cannot consume another rule's random sequence.

Use `transfer` for ordinary cash movement, `repayDebt` for the paired principal payment and debt reduction, `trade` for coupled exchange, `delta` for physical/world changes, and population effects for human changes. Continuous and discrete population field mechanics live in the population field registry; mutable mapxel field mechanics live in the mapxel field registry. Runtime validation, bounds, merge behavior, save validation, and tooling should consume those registries rather than growing parallel hardcoded field lists.

When a mechanism represents something people do or experience, change population groups and derive any human mapxel aggregate instead of independently mutating employment, happiness, approval, demographics, or labor composition. A new behavior using existing state should usually be one small rule module plus tests. A new state field should be defined in the appropriate typed state and registry, initialized/persisted as necessary, and then automatically inherit the generic settlement/validation/tooling path rather than requiring engine branches.

When a rule only needs aggregate information about the settled population at the start of the month, prefer the immutable `StepCache` over adding or reading another persistent mapxel mirror. The cache is fixed for that whole step by design; a rule that must observe human changes settled earlier in the same month must read the authoritative population groups instead of expecting the cache to refresh mid-step.

Give substantial changes `evidence`: title, mechanism, affected cells, measured input fields, and relevant policy keys. The rule-analysis tooling observes normal reads and effects, so new behavior should acquire causal input/output and downstream views without a behavior-specific devtools implementation.

## Stories and causal honesty

Significant changes create immutable cause records containing tick, rule, cells, magnitude, observations, and IDs of earlier recorded contributors. A cell/field provenance index connects later changes to recorded inputs. Same-phase effects only reference provenance from their shared input snapshot, preventing false within-phase causation. Event records state probabilities where relevant; an event is not attributed to policy as an inevitable outcome.

The journal is **selective**, not a full structural causal model. Small updates may have no record. Parent links show contributing inputs and latest relevant interventions, not counterfactual proof or exhaustive attribution. News retains evidence IDs. Mandate chains traverse the existing graph rather than inventing relationships. Community quotes are explicitly fictional templates selected from measured conditions. All graphs and histories persist in exported saves; IndexedDB stores larger browser autosaves.

## Current limits

This is a fictional, deliberately simplified economy. Residents are represented by cohorts rather than individual people or households, and firms remain aggregate local economic conditions rather than separate balance sheets. Group income and wealth are not separately conserved cash accounts. Production still consumes end-of-previous-tick mapxel labor projections rather than the new step cache; those projections are generated from settled employed groups, so people remain the source of the labor state. Migrating those consumers to the cache is an architectural follow-up rather than part of the cache-introduction change. Agriculture represents a staple basket; manufacturing produces generic materials. Restaurant failures are represented through business viability. There is no interregional transport graph beyond cell neighbors, market auction, electoral-party system, or foreign diplomacy. Projects immediately improve an index that subsequently needs public upkeep. Events, weather, inheritance variation, and some demographic choices use keyed deterministic random draws. Save validation protects against corruption and invalid engine state, not cheating. Custom extremes can cause hardship and default, with finite and inspectable consequences.
