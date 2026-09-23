# Simulation design

## Units and state

One tick is one month; the default mandate is 48 ticks. A mapxel is approximately 4 km². Population is a continuous count of residents, allowing fractional expected births, deaths, and migration. Money is fictional crowns. Food is measured in person-month units: each resident needs one unit each month. Materials are abstract maintenance inputs. Taxable output is an abstract monthly economic-activity measure, not cash.

Each land cell has terrain, fertility, mineral suitability, water stress, private cash, food and material stocks, industry shares, demographic fractions, health, education, happiness, approval, employment, crime pressure, pollution, transport quality, business viability, sports interest, and monthly expected starvation deaths. Indices lie in [0,1]; food prices lie in [0.4,5]. Demographic fractions leave an implicit working-age share. A country has four named regions and a finite external cash account in addition to its treasury and debt.

Macro behavior is derived from mapxel states and flows. National indicators summarize local outcomes; a policy can set constraints or move shared funds, but its effects on food, work, prices, health, and migration must pass through mapxel rules. Historical scenario targets follow the same rule even when the current simulation cannot yet meet them.

## A month

| Phase | What changes |
| --- | --- |
| Production | Farms and factories create physical stocks; industry output generates explicit export receipts from the external account |
| Trade | Four-neighbor bilateral food/material trades exchange goods and cash together; roads limit equalization |
| Consumption | Residents eat available food; unmet needs set food security; imports, upkeep, and spoilage drain cash or stocks explicitly |
| Market | Food prices respond gradually to scarcity; shortages, ingredients, and payroll affordability weaken restaurants/shops |
| Taxation | Taxes on output move private money to the treasury, limited by actual private cash |
| Financing | Explicit borrowing covers a shortfall up to a principal credit limit of ₡30 per resident |
| Fiscal | Interest is paid first; services and subsidies are funded proportionately; surplus above operating reserves repays debt principal |
| Society | Public services, wealth, crime, food, liberties, and industry-specific affordable hiring gradually change living conditions; expected births/deaths change population |
| Migration | Small numbers compare neighboring jobs, food-adjusted production receipts, reserves, and food access, carrying proportional savings |
| Adaptation | Workers gradually reallocate among four industries in response to relative returns |
| Events | Risk-conditioned, reproducible crime, sports, and weather events feed back into state |

All rules in a phase read the same deeply frozen snapshot. They return proposals rather than mutating state. The engine commits proposals together before taking the next phase's snapshot. Incoming stocks cannot be spent until a later phase. Taxation, financing, and fiscal payments therefore have separate phases.

## Conservation and settlement

Cash cannot be changed through a cell delta. A `transfer` moves equal amounts between two accounts. A `trade` moves both a commodity and its cash payment atomically. Competing requests reserve the same starting stocks: source demands are summed, then each proposal is scaled proportionally to source availability. A trade takes the smaller of its goods and cash capacity factors. This is intentionally a conservative one-pass settlement; it may leave some inventory unused when another participant is cash-constrained, but does not mint money or sell the same unit twice.

Food/material consumption and outgoing transfers share that same stock budget. Production and destruction are explicit deltas. Migration conserves national population and carries wealth; demographic births/deaths are separate sources/sinks. All phases validate finite numbers, nonnegative stocks/accounts, bounded indices, demographic consistency, and industry shares summing to one. A failing rule rolls back the **entire tick** because the engine only mutates its working copy.

The open-economy boundary is intentional: firms/households in a cell share a private account. Export receipts come from the external account; imported consumption, a fraction of public procurement, capital projects, interest, and principal repayment go back to it. Local transactions within a mapxel net out. The model does not claim that gross output itself creates money. Public borrowing transfers existing external cash and increases debt; surplus cash above operating reserves repays principal. Unpaid interest capitalizes as arrears, so total debt can exceed the principal borrowing limit after default.

Save version 3 adds the national wage floor. Version 1 and 2 saves load with the floor set to zero, preserving their previously unregulated labor market.

## Calibrating feedback

- Price adjustments are damped at 14% of the supply-demand gap per month; the index has explicit bounds.
- Sector allocation moves 6.5% toward normalized relative-return weights. Subsidies can attract workers out of farming, but scarcity increases agricultural returns.
- Business viability adjusts by 15%; employment, crime, happiness, and approval by roughly 9–12%; health, education, and infrastructure are slower.
- Food spoils by 16% of post-consumption stock; materials have upkeep and 12% inventory depreciation. Stockpiles cannot accumulate without limit under ordinary production.
- Higher reserves increase imports, creating a savings equilibrium. Neighbor migration compares local economic opportunity and remains capped at 0.3% per edge per month; food scarcity can overwhelm an output gain.
- A wage floor changes hiring only when it exceeds what local firms can pay from receipts after business tax and imported inputs. High floors can collapse employment, output, and private reserves; repeal allows recovery. The pooled private account cannot distinguish higher pay for retained workers from lower income for those losing jobs.
- Event families sample one candidate place per month rather than rolling a national catastrophe once per cell. Cooldowns keep events from dominating the model as map size increases.
- A regional drought adds local water stress, cutting subsequent farm yields by up to 60%; 35% of accumulated stress recovers each month. Repeated shocks can stack without changing permanent terrain fertility.
- The default budget starts at 28% income tax, 18% business tax, and ₡1.50 of services per resident. At initial output, revenue equals spending. Starting reserves absorb transitional deficits.

The regression suite checks five 48-month seeds, 240 months without discrete events, and a tiny perturbation of an initial condition. It checks complete account conservation, policy directionality, a subsidy/food/business chain, deliberately unaffordable fiscal settings, and matched extreme-policy scenarios. [TESTING.md](TESTING.md) records the scenario contracts and their limits; [HISTORICAL_ANALOGUES.md](HISTORICAL_ANALOGUES.md) distinguishes reproducible mechanisms from historical cases this model cannot represent. `npm run calibrate` additionally runs five scenarios on three full-size 36×26 worlds. After the local drought and mortality changes, the baseline's observed 48-month outcomes are 73.1–73.7% approval, 80.2–80.9% wellbeing, 98.9–99.9% food needs met at month 48, no debt, and full service funding. National sports subsidies of ₡3 produce temporary national food-coverage lows of 64.3–65.4%, then recovery as farming becomes attractive and funding is constrained. These ranges describe three seeded runs, not a proof that every future rule combination is stable.

## Adding a rule

Rules are independent TypeScript objects. Pass an expanded registry to `step(game, rules)` or add it to `defaultRules` for the game UI.

```ts
import type { Rule } from './src/sim/types';
import { defaultRules } from './src/sim/rules';
import { step } from './src/sim/engine';

const literacy: Rule = {
  id: 'society.library-circles',
  phase: 'society',
  description: 'Educated neighbors gently help each other learn.',
  run({ model }) {
    return model.cells.filter(c => c.population > 0).map(c => {
      const neighbors = model.neighbors[c.id].map(id => model.cells[id]);
      const average = neighbors.length
        ? neighbors.reduce((sum, n) => sum + n.education, 0) / neighbors.length
        : c.education;
      return {
        kind: 'delta' as const, cell: c.id, field: 'education' as const,
        amount: (average - c.education) * 0.01,
      };
    });
  },
};

// game = step(game, [...defaultRules, literacy]);
```

Use unique IDs and existing phases. Optional `after` dependencies validate order, including rejecting missing dependencies, cycles, and dependencies in later phases. **Same-phase dependencies do not allow observing writes from another rule.** Use a later phase when effects need to consume updated state. Registration order is canonicalized; keyed RNG uses world seed, month, rule ID, cell ID, and optional channel, so an unrelated rule cannot consume another rule's random sequence.

Use `transfer` for ordinary cash movement, `repayDebt` for the paired principal payment and debt reduction, `trade` for coupled exchange, and `delta` for actual production/destruction or index adjustments. Keep changing industry shares normalized as a group. Extensions must not directly modify snapshot state, topology, identity, or time. Give substantial changes `evidence`: title, mechanism, affected cells, measured input fields, and relevant policy keys. Run conservation and stress tests after adding a feedback loop. New state fields require updates to types, world initialization, validation, save versioning, and inspection UI.

## Stories and causal honesty

Significant changes create immutable cause records containing tick, rule, cells, magnitude, observations, and IDs of earlier recorded contributors. A cell/field provenance index connects later changes to recorded inputs. Same-phase effects only reference provenance from their shared input snapshot, preventing false within-phase causation. Event records state probabilities where relevant; an event is not attributed to policy as an inevitable outcome.

The journal is **selective**, not a full structural causal model. Small updates may have no record. Parent links show contributing inputs and latest relevant interventions, not counterfactual proof or exhaustive attribution. News retains evidence IDs. Mandate chains traverse the existing graph rather than inventing relationships. Community quotes are explicitly fictional templates selected from measured conditions. All graphs and histories persist in exported saves; IndexedDB stores larger browser autosaves.

## Current limits

This is a fictional, deliberately simplified economy. Citizens and firms are aggregates, and demographic fractions are not yet full individual cohorts. Agriculture represents a staple basket; manufacturing produces generic materials. Restaurant failures are represented through business viability rather than separate balance sheets and bankruptcies. There is no interregional transport graph beyond cell neighbors, market auction, electoral-party system, or foreign diplomacy. Projects immediately improve an index that subsequently needs public upkeep. Policies have deterministic mechanical effects; only events and weather are stochastic. Save validation protects against corruption and invalid engine state, not cheating. Default scenarios are calibrated; custom extremes can cause hardship and default, with finite and inspectable consequences.
