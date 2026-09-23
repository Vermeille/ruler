# Simulation contracts and regression strategy

The tests constrain the fictional model as a game. They check explicit rule equations, engine accounting, and policy consequences. A passing test is evidence for the stated seeds, map size, time horizon, and intervention. It is not an economic forecast or a proof for every possible world.

[HISTORICAL_ANALOGUES.md](HISTORICAL_ANALOGUES.md) audits several real-world observations against the mechanics the model can actually represent.

National outcomes must emerge from mapxel production, trade, consumption, prices, health, and movement. A scenario test first checks the affected local state and flows, then checks the population-weighted or summed national result. Historically motivated targets may remain red while those local mechanisms are built; a failed target is evidence to diagnose, not a reason to lower its expectation to match the current engine. When an action or observation does not exist yet, specify its local contract before adding an executable target.

## Current layers

| Layer | Tests | Contract |
| --- | --- | --- |
| Rule isolation | `tests/rules.test.ts` | Each of the eleven default rules gets a focused check of its inputs, output effects, boundary conditions, or cooldowns. Rule tests use a 12×12 seeded world and controlled random values where necessary. |
| Settlement and lifecycle | `tests/engine.test.ts` | Phase snapshots, order, account and resource conservation, deterministic replay, validation, action atomicity, saves, and mandate end. |
| Matched policy trajectories | `tests/ripples.test.ts` | Same seed and initial state, one changed policy, full monthly engine. Discrete events are excluded for controlled comparisons. Tests assert the intermediate links as well as the final outcome. |
| Extreme scenarios | `tests/extreme-scenarios.test.ts` | Explicit packages of extreme legal actions, paired seed comparisons, sustained food shortage, public-health neglect, and a rich-versus-poor neighborhood. Full trajectories use 12×12 worlds for 48 months unless stated otherwise. |
| Historical mechanism probes | `tests/historical-patterns.test.ts` | Matched fiscal-consolidation, industrial-pollution, and administered-price shortage trajectories, with explicit limits on historical interpretation. |
| Drought persistence | `tests/drought.test.ts` | A seeded event first destroys local stocks, then reduces the affected farm's next harvest. Sustained regional water stress lowers harvests, food access, and health and drives migration across the border. |
| Economic migration | `tests/migration-scenarios.test.ts` | A local manufacturing subsidy raises output and attracts residents where food remains accessible; in a food-scarce city, higher prices and unmet needs instead drive outmigration. A movement-law comparison tests steerability. |
| Wage floor and hiring | `tests/wage-scenarios.test.ts` | A high national floor exceeds local sector payroll capacity, weakening service businesses and hiring before output, reserves, food access, and safety deteriorate. Moderate and repeal runs establish dose response and recovery on matched seeds. |
| Stability and narrative | `tests/scenarios.test.ts` | Five 48-month seeded baselines, a 240-month perturbation run, economic stress, and a recorded subsidy chain with linked causes. |

The [tax test](../tests/ripples.test.ts) checks a specific Laffer-like reversal: setting **both** income and business tax to 65% raises first-month receipts compared with 45%, then produces less average realized revenue in months 37–48 on two fixed seeds. It also checks a smaller output base, depleted private reserves, higher crime, and lower approval. This reversal is a result of the full model, particularly the per-cell cash collection cap and subsequent private-cash feedback. It does not assert that raising either tax alone always lowers revenue, or that the current forecast captures behavioral responses.

The policy scenarios are intentionally paired and inspect intermediate effects. A health-spending scenario checks funding before interpreting health gains. A sports subsidy must first move labor, then reduce food access, raise prices, weaken businesses and jobs, and eventually draw labor back to farming. Clean Air must reduce immediate production while improving pollution and later health. Better roads must change actual food trade, food eaten, and prices. An unaffordable budget must exhaust funding and reach services, safety, and approval. A seeded drought must affect the next month's food access, matching event phase order.

The migration tests separate a job signal from its living conditions. With matching happiness, employment, population, cash, and food, a higher output-per-resident mapxel attracts neighbors. Raising its food price or leaving needs unmet reverses the flow. Full-engine comparisons then pair the same local manufacturing subsidy with otherwise identical worlds, including a no-migration counterfactual. The subsidy attracts residents in a food-secure town but loses them in a food-scarce city despite higher nominal output. These are locally measured flows; national migration remains population-conserving.

## Extreme scenario ledger

The names below refer only to the implemented controls. “Communism” and “libertarianism” encompass institutions the game does not model, so tests use exact tax and spending packages instead. These are observed results for `alder-42` and `marlow` on 12×12 worlds, 48 months, with discrete events disabled. Thresholds in the tests allow some recalibration without losing the behavior.

| Setup | Intended gameplay outcome | Observed result and diagnosis |
| --- | --- | --- |
| 65% income and business tax; zero police and welfare | Private cash depletion leads to severe national crime and lower support | Final private cash is about ₡0.72 per resident and national crime about 0.44, versus about 0.05 at baseline. The same fixed risk roll triggers a violent-crime event only in the high-crime state. |
| 65% taxes; all seven services promised at ₡2 per resident | Large, unsustainable state budget | Borrowing reaches roughly ₡30 per initial resident and only about 29% of promised spending is funded. Crime **falls** to about 0.015 and health **rises** to about 0.83. High promised rates remain effective even after rationing; a claim that this package causes high crime would be the wrong expected outcome for the current rules. |
| Zero taxes and zero services | Cash remains private; loss of public health, environmental, and safety benefits | No public debt is incurred because no services are promised. Health ends near 0.56, crime near 0.13, pollution near 0.25, while private wealth is higher. The displayed `funding` remains 1 by definition when planned spending is zero; it must not be interpreted as funded services. |
| Zero taxes with baseline service promises; 45% and 65% combined taxes | Constrain both ends of the revenue curve | Zero taxes collect zero and eventually cannot fund promises. The 65% package collects more than 45% in month one but less over months 37–48 as cash and output respond. This is a model-specific Laffer-like effect, not a claim about real taxation. |
| Maximum manufacturing subsidy; zero health and environment spending | Industrial output competes with food and creates a public-health crisis | Pollution reaches about 0.70 and health about 0.43. A matched manufacturing-subsidy run with ordinary health and environment spending has lower pollution and better health, isolating the service-cut effect. |
| Maximum sports and manufacturing subsidies | Prolonged severe food shortage and downstream harm | National food coverage drops below 0.5 and stays below 0.6 for at least six months; some cells fall below 0.4. Health and net population finish below the matched baseline. Price and labor feedback eventually ease the shortage. |
| One cash-poor cell surrounded by very wealthy cells, with no police or welfare | A local crime and migration hotspot | The poor cell's crime exceeds 0.5 by month 24, more than 0.1 above a matched poor cell with ordinary neighbors; wellbeing and population are lower. Repealing free movement retains more residents in the hotspot. The national crime average changes much less, so the assertion is local. |

`foodSecurity` measures the fraction of monthly food needs met. The society rule now records explicit expected starvation deaths per mapxel when coverage falls below 70%. The extreme food scenario asserts sustained unmet needs, a positive death count over several months, worse health, and a lower net population than its matched baseline. This is a fictional model rate; its numeric magnitude is a gameplay calibration target rather than a historical mortality estimate.

Two observations deserve design review rather than automatic test assertions. Zero tax and zero services can finish with slightly higher approval than the baseline despite worse health and crime, because the direct tax penalty in approval offsets those losses. Maximum taxes and maximum services improve health and crime despite deep fiscal rationing. Both follow the current equations; whether they make good gameplay trade-offs is a calibration choice.

## Constraints for new mechanics

For every new rule or altered equation, add an isolated contract for the equation, units, bounds, and special cases. For every new player action, run a matched scenario through the whole engine and assert a visible response within the mandate, plus its major cost or trade-off. Check at least one opposing or extreme setting so a policy is steerable without turning the default game into an immediate collapse. For cross-phase chains, assert the causal intermediate metrics; an endpoint alone can pass for an unrelated reason. Use `assertModel` and conservation checks for new resource flows, and verify deterministic replay for new randomness.

The scenario thresholds are deliberately wider than the measured values. Their role is to catch broken or reversed feedback while allowing modest calibration changes. When a threshold fails, inspect the trajectory before changing it. A changed equation may legitimately require an updated contract; a regression should not be hidden by relaxing a threshold.

## Useful next constraints

- **Policy reversal:** enact a policy for part of a mandate, then repeal it. Measure recovery speed, residual damage, and whether any metric moves irreversibly despite reversible mechanics.
- **Local spillovers:** compare a targeted subsidy or investment with neighboring and distant cells. Assert which effects cross the border through trade or migration and which remain local.
- **Crossed interventions:** tax plus spending, transport plus drought, policing plus poverty, and Clean Air plus manufacturing subsidy. Use a small factorial design to catch interactions that single-action tests miss.
- **Thresholds and saturation:** exercise zero stocks, zero cash, maximum taxes, maximum subsidy, exhausted debt capacity, bounded indices, and near-empty sector shares. Assert continuity where the model should be smooth and explicit clipping where it should not.
- **Stochastic risk:** compare event frequencies across seeds and map sizes with confidence intervals, while retaining exact seeded replay and cooldown checks. Avoid a single-seed claim about event probability.
- **Long horizon and geography:** repeat stability and perturbation tests on several full-size worlds, extreme terrain mixes, and asymmetric regional initial conditions. Check for unbounded drift or a collapse that only small worlds hide.
- **Causal evidence:** verify that event and policy journal links point to observations that existed before the reported effect, including across same-phase boundaries and save restoration.
- **Sensitivity scans:** sweep each policy lever at several levels and record response curves. Use these to spot flat controls, discontinuities, implausible dominance, and equilibria that make gameplay choices meaningless.

Run `npm test` for the behavioral suite and `npm run build` for TypeScript and bundling. Run `npm run calibrate` when changing default equations or parameters; record seed, map dimensions, month count, event setting, and action sequence with any reported result.
