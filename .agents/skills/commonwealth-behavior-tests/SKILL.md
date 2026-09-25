---
name: commonwealth-behavior-tests
description: Design, interpret, and calibrate Commonwealth simulation behavior tests as deterministic counterfactual experiments. Use when adding perturbation tests, diagnosing surprising simulation responses, choosing effect-size expectations, testing stabilizing feedback, or deciding whether a red behavior test means the test or the simulation should change.
---

# Commonwealth behavior testing

Behavior tests are counterfactual experiments on the simulated world. They are not unit tests for individual rules and they are not assertions that a code path or `Cause` object appeared.

The question is always:

> Starting from the same world, if one meaningful initial condition is different, how does the simulated trajectory differ over time, and does that difference match the world behavior we intend?

Treat behavior tests like small scientific experiments: define the intervention, define the expected causal chain, compare against a deterministic control, inspect the whole response over time, and only then decide whether the model or the expectation is wrong.

## Default experiment shape

Use one canonical initial game and record one deterministic control trajectory, normally 12 monthly steps. Reuse that baseline across the behavior tests in the file/process rather than rerunning a different baseline for every assertion.

For each behavior:

1. Clone the same initial game.
2. Apply one conceptual intervention to the starting state.
3. Run the same rules for the same duration and seed as the control.
4. Compare the perturbed trajectory with the baseline month by month.
5. Assert the intended causal links, timing, direction, and meaningful effect sizes.
6. Record diagnostics/report data even when an assertion fails.

Disable unrelated stochastic narrative/story events when they would add noise to the comparison. Keep deterministic simulation mechanics intact.

A conceptual intervention may touch several fields or cells when that is the actual scenario. For example, “regional farming failure” may reassign agricultural workers across a focal cell and its neighbors. What matters is that the intervention has one coherent real-world meaning, not that exactly one numeric property changed.

Prefer perturbing the initial condition. Do not repeatedly mutate the simulation every month from test code merely to force an outcome. If the intended behavior is a sustained exogenous process, represent that process through model state/rules or a scenario-specific mechanism so the simulator, not the test harness, causes the downstream effects.

## Write the causal hypothesis before the assertions

State the expected chain in world terms before encoding predicates. Example:

`regional farming capacity ↓ -> food production ↓ -> reserves/trade buffer the shock -> foodSecurity ↓ once buffers fail -> food price ↑ -> resident wellbeing ↓ -> approval ↓`

Then assert those links in order where practical.

Do not substitute implementation observability for causal behavior. In particular:

- A rule executing is not evidence that its effect mattered.
- A `Cause` being emitted is not evidence that a rule executed or that the behavior triggered. Cause emission has narrative/evidence thresholds and may be intentionally sparse.
- Assert `Cause` records only when the behavior under test is specifically provenance, evidence, or narrative observability.

If the chain is local, inspect local mapxel or population-group state. National aggregates can wash out a perfectly real local effect. Extend the behavior frame/report when necessary instead of asserting against the wrong spatial scale.

## Test both propagation and stabilizing feedback

A good simulator should not merely propagate shocks. It should also absorb shocks when its corrective mechanisms are strong enough.

When a mechanism has an obvious stabilizing feedback, prefer a pair of tests:

1. **Recoverable shock:** the disturbance occurs with the corrective mechanism intact, and the test verifies that the system absorbs it without downstream crisis.
2. **Feedback-disabled or capacity-exceeded shock:** the same family of disturbance occurs while the relevant buffer is unavailable or insufficient, and the test verifies the full downstream chain.

Example for food:

- `food` is measured in person-months. One person-month feeds one resident for one month.
- `foodSecurity` is the realized monthly coverage share, effectively `min(1, food consumed / monthly need)`, after production and trade have had a chance to act.
- Destroying 45% of one cell's opening reserves is therefore not automatically “45% hunger.” A typical cell can still have roughly a month's food left, then produce and import more before consumption.
- Test that this one-off local reserve loss is absorbed when production and trade are healthy.
- Separately test a regional reserve loss with local farming capacity removed or otherwise unavailable; imports may still help, but once the regional buffer is exceeded the expected chain should reach food security, prices, wellbeing, and approval.

This distinction is important. A red “scarcity” test may reveal that the scenario never actually created scarcity, which is a test-design error rather than a model error.

## Interpret the initial state before judging a result

When a behavior test surprises you, do not immediately weaken the assertion or strengthen the shock. First translate the numbers into model semantics and inspect rule ordering.

Check:

- What are the units?
- How large is the perturbation relative to baseline stock, flow, population, or rate?
- Which rules run before the variable you are observing?
- What buffers, imports, reserves, adaptation, migration, or feedback loops can compensate first?
- Is the expected effect local while the assertion is national?
- Does the effect need several months to propagate through intermediate state?

For food, for example, production and trade precede consumption. A reserve shock can disappear before `foodSecurity` changes. That is a meaningful resilience result, not evidence that consumption is disconnected.

## Use units explicitly

Dimensionful test values must use the constructors in `src/sim/units.ts` rather than naked numbers. Examples include:

- `people(...)`
- `personMonths(...)`
- `materialUnits(...)`
- `crowns(...)`
- `crownsPerPerson(...)`
- `crownsPerPersonMonth(...)`
- `crownsPerMonth(...)`
- `foodPrice(...)`
- `materialPrice(...)`
- `years(...)`
- `months(...)`

Let the compiler ask “10 what?” in fixtures and scenario setup.

Normalized `[0,1]` indices and ordinary dimensionless shares may remain plain numbers where the model types allow them.

Never calibrate or assert an unexplained raw magnitude. If an effect-size number cannot be stated with a unit, ratio, percentage, or clearly defined index meaning, the expectation is not ready to become a regression contract.

## Choose meaningful effect-size contracts

Behavior tests should assert more than “nonzero,” but avoid brittle golden trajectories.

Prefer contracts such as:

- direction: price is higher than baseline;
- timing: the first visible downstream effect appears within N months;
- local magnitude: affected-region output is at least X% above/below baseline;
- relative magnitude: national output changes by at least Y basis points;
- bounded resilience: food-security loss remains below a meaningful threshold;
- persistence: the final-quarter effect remains a substantial fraction of its peak;
- damping: the effect shrinks substantially after an initial shock;
- oscillation: repeated sign reversals indicate a feedback cycle.

Avoid arbitrary absolute assertions such as `output delta >= 0.01` unless `0.01` has an interpretable dimensional meaning in context. With compiler-enforced units, prefer explicit quantities or ratios.

Set the intended effect size from the world behavior you want before tuning coefficients. The test is the product/model contract, not a snapshot of whatever coefficients happen to produce today.

## Calibration rule: tune the simulation, not the test

When an expectation is physically/economically/gameplay-plausible and the scenario truly activates the intended mechanism, a red test means the model needs calibration.

Do not shave the assertion down to the observed value merely to get green CI.

Instead:

1. Measure the gap between expected and observed response.
2. Identify the coefficient or mechanism that causally controls that response.
3. Prefer a named, interpretable calibration parameter over scattering magic multipliers.
4. Change the smallest relevant mechanism.
5. Rerun the behavior suite and inspect collateral effects on other scenarios.
6. Keep the original expectation unless new reasoning shows the expectation itself was wrong.

If the expectation was wrong, change it because the model semantics, units, rule order, or real-world interpretation changed your mind, and capture that reasoning in the test name/comments. Do not move goalposts simply because CI is red.

Infrastructure is a useful example: if an infrastructure improvement produces a downstream output response that is an order of magnitude weaker than the intended economic effect, define the intended response in relative/local terms and tune the infrastructure/trade/productivity calibration. Do not preserve an arbitrary microscopic effect merely because the current coefficients happen to produce it.

## Measure trajectories, not endpoints

The behavior harness should preserve enough information to characterize the response, not just month 12.

Useful response diagnostics include:

- per-month delta from baseline;
- first visible month;
- peak absolute effect and peak month;
- cumulative signed effect;
- sign changes;
- tail-to-peak ratio;
- coarse shape such as `silent`, `damped`, `persistent`, `amplifying`, or `oscillating`;
- spatial snapshots for affected mapxels;
- population-group snapshots when the causal chain passes through people state.

Use these diagnostics to understand the model. Assertions should select the facts that define intended behavior rather than freeze every monthly value.

A behavior report is especially useful for calibration work. Keep report generation independent from pass/fail assertions so a failed experiment still leaves evidence about what happened.

## Preserve Commonwealth architecture while fixing red tests

A behavior test may expose a missing or weak causal link, but fixing it must still respect the engine contracts:

- rules use one of the four causal directions: mapxel -> mapxel, mapxel -> people, people -> mapxel, people -> people;
- step aggregates are read-only caches derived once at the beginning of a step and are not authoritative state;
- population groups remain authoritative for human state where the model says they are;
- resource conservation and explicit transfers remain intact;
- deterministic keyed randomness remains deterministic;
- provenance/evidence remains separate from the underlying causal mechanics.

Do not add a shortcut write merely to satisfy a behavior assertion if it bypasses the causal architecture. Strengthen or connect the actual mechanism.

## What a good behavior test looks like

A strong test name states the world behavior, for example:

- `a one-off food reserve shock is absorbed by production and trade feedback`
- `food scarcity propagates when regional farming capacity cannot replenish reserves`
- `a local pollution increase reaches resident health and later economic output`

The setup is a meaningful scenario, the assertions correspond to explicit causal links, and diagnostics explain the whole trajectory when the contract fails.

Prefer assertion messages that describe semantics:

`Without local farming, depleted reserves must eventually become worse food access`

rather than implementation details:

`economy.households should trigger`

The first survives refactors. The second confuses mechanism observability with behavior.

## Anti-patterns

Do not:

- generate a fresh unrelated baseline per test;
- assert that a rule emitted a `Cause` as a proxy for behavior;
- use national summaries for a causal effect that only exists locally;
- repeatedly force state each month from the test unless that forcing is itself the modeled scenario;
- use unexplained unitless absolute thresholds for dimensionful variables;
- freeze exact monthly values unless exact calibration is the behavior being specified;
- reduce a failed threshold to the current observed value without a realism/modeling argument;
- introduce direct shortcut effects that bypass the intended causal chain;
- assume a dramatic percentage change is dramatic in real terms before checking stock/flow units and baseline scale.

## Completion checklist

Before considering a new behavior regression complete:

1. The control and perturbation use the same seed, rule set, and duration.
2. The perturbation has one coherent real-world meaning.
3. Dimensionful fixture values use explicit unit constructors.
4. The expected causal chain is written in world terms.
5. Assertions cover the important links, direction, timing, and meaningful magnitude.
6. Corrective feedback is tested when relevant, including a recoverable case when useful.
7. Local effects are measured locally rather than hidden in national aggregates.
8. Diagnostics/reporting remain available on failure.
9. A surprising result was interpreted through units, initial state, rule ordering, and feedback before changing the expectation.
10. Calibration changes preserve the four-arrow architecture, caches, conservation, determinism, and provenance contracts.
11. Focused tests, the behavior suite, build/type checking, and relevant broader CI are green.

The purpose of these tests is not to prove that the simulator runs. It is to make the intended dynamics of the simulated world explicit, measurable, and difficult to accidentally destroy.