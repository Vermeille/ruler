# Rules and metrics

This file is the compact reference for the current default simulation. The model is fictional; its outputs are not real-world forecasts. One tick is one month.

For architecture and extension guidance, see [SIMULATION.md](SIMULATION.md). This file focuses on what the default rules currently do.

## Authority and causal directions

There are two authoritative mutable domains:

- **World/mapxel state**: terrain-adjacent conditions, stocks, prices, pollution, infrastructure, business health, food security, crime pressure, sports interest, public/private cash and other local/world conditions.
- **People state**: age, life stage, education, occupation, employment status, income, wealth, health, wellbeing, approval, and attitudes on population groups.

Every rule declares exactly one causal direction:

```text
mapxel → mapxel
mapxel → people
people → mapxel
people → people
```

The engine mechanically enforces the output side. A rule ending in `people` cannot emit world/resource mutations, and a rule ending in `mapxel` cannot emit population mutations. Reads are intentionally more flexible: cross-domain mechanisms may inspect both people and place context when the formula genuinely needs it.

Human aggregates on mapxels are compatibility projections, not a second social model. `employment`, `happiness`, `approval`, `children`, `seniors`, and the four occupational shares are projected from settled population groups by `population.aggregate` at the end of the tick. Causal rules should read authoritative groups or the immutable step cache instead.

At the beginning of each step the engine derives one immutable population summary cache from authoritative groups. It contains population, employment, demographics, weighted human state and occupational shares per mapxel. The same cache is read throughout the month and discarded afterward. It never refreshes mid-step.

Raw mapxel population changes are not allowed. Migration, births, and deaths operate on population groups, and population settlement updates the cached cell population consistently.

## Units and bounds

- A mapxel is approximately 4 km².
- Population is a continuous resident count. Births and deaths may be fractional expected mass; independent discrete cohort choices use person-scale stochastic quantization.
- Money is fictional crowns (`₡`).
- Each resident needs one food unit per month.
- Materials are abstract maintenance/industrial stocks.
- `output` is monthly economic activity, not cash.
- Most indices are constrained to `[0, 1]`.
- Posted food price is constrained to `[0.4, 5]`.
- Food, materials, population, and ordinary accounts cannot become meaningfully negative.
- `foodTraded` is a signed monthly net-flow accumulator.

Mutable mapxel field mechanics are defined in `src/sim/map-fields.ts`. Population field mechanics are defined in `src/sim/population/fields.ts`.

## Monthly phase order

1. `production`
2. `trade`
3. `consumption`
4. `market`
5. `taxation`
6. `financing`
7. `fiscal`
8. `society`
9. `experience`
10. `behavior`
11. `aging`
12. `lifeStage`
13. `demographics`
14. `deprivation`
15. `migration`
16. `adaptation`
17. `events`
18. `projection`

Every rule in a phase reads the same phase-start snapshot and emits effects. Effects settle together before the next phase snapshot. A same-phase `after` dependency orders evaluation/provenance only; it does not expose another same-phase rule's writes.

## Economy

### Production — `economy.production` — people → mapxel

Production reads the step-start population cache rather than legacy human mapxel projections.

Effective labor is:

`employmentRate × (0.65 + 0.35 × averageHumanHealth)`.

Food production is proportional to cached resident population, cached agricultural worker share, fertility, labor, seasonal weather, pollution, and water stress. Manufacturing similarly uses cached manufacturing workers, minerals, labor, and Clean Air policy. Output combines cached occupational shares with sector productivity.

Firms receive an explicit export receipt from the external account equal to `0.65 × output`. Output itself does not mint money.

### Neighbor trade — `economy.neighbor-trade` — mapxel → mapxel

Adjacent land cells compare food/material stocks per resident. The better-stocked cell offers goods toward equalization, limited by road quality and seller inventory. Food trades use the midpoint of local prices; materials use a fixed modeled price.

### Households — `economy.households` — people → mapxel

Residents consume up to one food unit per cached step-start resident. `foodSecurity` is the share of that need met. Remaining food partially spoils, materials decay through upkeep, and household/import spending transfers cash to the external account.

### Businesses — `economy.businesses` — mapxel → mapxel

Food scarcity raises a free scarcity-price signal. Posted prices move gradually toward that signal, subject to food price controls. Low food security, expensive ingredients, crime, and unviable service jobs reduce `businessHealth`.

## Government finance

### Taxation — `state.taxation` — mapxel → mapxel

Taxes are assessed on measured output. Actual collection is capped by local private cash and moves cash to the treasury.

### Financing — `state.financing` — mapxel → mapxel

Borrowing covers forecast shortfalls subject to a principal credit limit of `₡30 × population` and available external cash.

### Fiscal settlement — `state.services` — mapxel → mapxel

Interest is paid first. Services and subsidies then share remaining treasury cash through a common funding fraction. Population and occupational summaries used for reserve/subsidy calculations come from the step cache. Surplus cash above operating reserves repays principal explicitly.

## World and resident environmental effects

### Autonomous conditions — `environment.conditions` — mapxel → mapxel

This rule updates the part of local conditions caused by policy and other world state:

- health access from health spending, pollution, and food access;
- education access from education spending;
- infrastructure from infrastructure spending;
- pollution reduction from environmental spending;
- sports/cultural conditions from culture spending.

### Resident impacts — `population.environment-impact` — people → mapxel

People contribute separately through:

- resident wealth improving private health/education access;
- population/material intensity affecting infrastructure pressure;
- local and neighboring manufacturing workers creating pollution pressure;
- population density contributing pollution pressure;
- sports workers contributing sports interest.

The two rules settle in the same phase, so their deltas sum to the previous combined damped target without pretending resident effects are autonomous environment dynamics.

## People

### Employment — `population.employment` — mapxel → people

Actual adult groups gain or lose employment based on local firm demand, occupation viability, taxes, food conditions, education and adaptability. Worker-health input comes from actual population summaries rather than the mapxel health-access field.

### Experience — `population.experience` — mapxel → people

Groups experience prices, food access, crime, pollution, public services, policy and local economic conditions through their own needs and circumstances. Income, wealth, health, education, wellbeing, approval, environmentalism and civic-liberty attitudes update on groups.

### Endogenous attitudes — `population.internal-attitudes` — people → people

After experience settles, existing wellbeing slowly shifts solidarity and traditionalism relative to archetype baselines. This is a separate later rule so it acts on settled lived state rather than competing with experience from the same cohort snapshot.

### Crime behavior — `population.crime` — people → mapxel

Group poverty, employment status and neighboring wealth inequality create crime pressure; policing and welfare damp it. Cached mapxel employment is not an authority.

### Aging — `population.aging` — people → people

Every group ages by `1/12` year each month.

### Life stage — `population.life-stage` — people → people

Children become adults at 18; adults become seniors at 65. Turning 18 no longer chooses an occupation from the local sector-share cache. New adults enter as unemployed with no occupation.

### Natural demographics — `population.demographics` — people → people

Yearly birth cohorts arise from reproductive adults using lived wellbeing, health, family orientation and keyed variation. Ordinary mortality depends on human age and health.

This rule does not consume food security and does not write the starvation report.

### Food-driven mortality — `population.starvation` — mapxel → people

A later `deprivation` phase converts current food insecurity into additional group mortality. It reads the current post-demographics population groups rather than the step-start cache because ordinary births/deaths have already settled.

The severe deprivation component is:

`population × 0.008 × clamp((0.7 − foodSecurity) / 0.7)²`.

### Starvation report — `environment.starvation-report` — mapxel → mapxel

This compatibility/reporting rule writes `starvationDeaths` from the same severe-deprivation formula. The actual deaths are owned by `population.starvation`.

### Migration — `population.migration` — mapxel → people

Every third month adult groups compare neighboring places through their needs and circumstances. Appeal includes employment, income, wealth, wellbeing, mobility, attachment, prices, food access, safety, services, pollution, culture and job viability. Positive moves are person-scale quantized `population-transfer` effects.

### Migration cash — `population.migration-cash` — people → mapxel

A separate companion rule transfers a proportional share of pooled local private cash along the same planned migration routes. It shares `randomNamespace: 'population.migration'` with the movement rule so both halves reproduce the same stochastic decision from the shared phase snapshot.

### Entry occupation — `population.entry-occupation` — mapxel → people

Adults with no occupation choose a sector from local opportunity and archetype affinity. This includes newly adult cohorts, keeping local labor-market choice out of the natural life-stage transition.

### Retraining — `population.retraining` — mapxel → people

Every sixth month adults compare local occupational opportunities. Employed residents may switch sectors when the gain is material; unemployed residents may retrain. Sector shares are never directly edited.

### Projection — `population.aggregate` — people → mapxel

After all causal behavior/events settle, population groups are materialized into compatibility mapxel fields for UI/save consumers:

- adult employment rate;
- resident wellbeing/happiness;
- resident approval;
- child and senior shares;
- employed occupational shares.

This remains temporary compatibility plumbing. It is not a human-state authority.

## Events

### World events — `stories.events` — mapxel → mapxel

Keyed stochastic families include violent crime, sports festivals and regional drought. This rule records the event and applies world/cash consequences.

### Human event experience — `population.event-experience` — mapxel → people

A companion rule translates the exact same stochastic outcome into resident wellbeing changes. It shares `randomNamespace: 'stories.events'`. The two rules read the same phase-start state and do not require an `after` dependency. Event-linked population provenance is resolved at phase commit, so bookkeeping does not create a false data dependency between the two arrows.

## Population settlement

Population effects are generic engine primitives:

- `population-state`: continuous state change;
- `population-transition`: discrete cohort-state change;
- `population-transfer`: migration between cells;
- `population-delta`: birth or death.

All requests settle against phase-start groups. Competing requests cannot consume more than the source cohort. Partial effects split groups. Similar groups may compact after settlement. When two conceptually sequential full-group changes need each other's settled state, they belong in different phases rather than competing in one phase.

## National summaries

National social metrics are population-weighted over land cells. Population, output, food, starvation deaths, treasury, and debt are summed or reported directly as appropriate. Group income and wealth are behavioral/distributional state, not separately conserved bank accounts. The national `wealth` summary remains private cell cash per resident.

## Extending the simulation

New behavior should be a plain rule module that declares one of the four directions, reads whatever world/person context the mechanism genuinely requires, and emits effects only on its declared output side.

If a proposed rule needs both population and world mutations, split it by causal arrow rather than weakening direction validation. Split stochastic consequences may share a `randomNamespace` when they must reproduce one keyed decision.

When adding a state field, define its mechanics in the appropriate registry. When a rule needs aggregate human state at step start, use the immutable step cache rather than another persistent mapxel mirror. When it must observe people changed earlier in the same month, read current authoritative groups.

The intended extension cost remains:

- **new behavior using existing state**: one focused rule module plus tests;
- **new state**: typed state + registry definition + initialization/save migration where required;
- **no engine branch** unless the behavior introduces a genuinely new generic mechanical primitive.
