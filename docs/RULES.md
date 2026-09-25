# Rules and metrics

This file is the compact reference for the current default simulation. The model is fictional; its outputs are not real-world forecasts. One tick is one month.

For architecture and extension guidance, see [SIMULATION.md](SIMULATION.md). For matched experiments showing how the new feedback loops actually react to controlled nudges, see [EMERGENT_BEHAVIOR_SIMS.md](EMERGENT_BEHAVIOR_SIMS.md).

## Authority and causal directions

There are two authoritative mutable domains:

- **World/mapxel state**: terrain-adjacent conditions, stocks, prices, pollution, infrastructure, service capacity and disruption, business health, food security, crime pressure, sports interest, policy-adjustment memory, public/private cash, and other local/world conditions.
- **People state**: age, life stage, education, occupation, employment status, income, wealth, health, wellbeing, approval, outlook, mobilization, infection, temporary issue salience, and attitudes on population groups.

Every rule declares exactly one causal direction:

```text
mapxel → mapxel
mapxel → people
people → mapxel
people → people
```

The engine mechanically enforces the output side. A rule ending in `people` cannot emit world/resource mutations, and a rule ending in `mapxel` cannot emit population mutations. Reads are intentionally more flexible: cross-domain mechanisms may inspect both people and place context when the formula genuinely needs it.

Human aggregates on mapxels are compatibility projections, not a second social model. `employment`, `happiness`, `approval`, `children`, `seniors`, `unrest`, `infection`, and the four occupational shares are projected from settled population groups by `population.aggregate` at the end of the tick. Causal rules should read authoritative groups or the immutable step cache instead.

At the beginning of each step the engine derives one immutable population summary cache from authoritative groups. It contains population, employment, demographics, weighted human state, occupational shares, average outlook/mobilization/infection, and regional/national wellbeing comparisons. The same cache is read throughout the month and discarded afterward. It never refreshes mid-step.

Raw mapxel population changes are not allowed. Migration, births, and deaths operate on population groups, and population settlement updates cell population consistently.

## Units and bounds

- A mapxel is approximately 4 km².
- Population is a continuous resident count. Births and deaths may be fractional expected mass; independent discrete cohort choices use person-scale stochastic quantization.
- Money is fictional crowns (`₡`).
- Each resident needs one food unit per month.
- Materials are abstract maintenance/industrial stocks.
- `output` is monthly economic activity, not cash.
- Most indices are constrained to `[0, 1]`.
- `outlook` is constrained to `[-1, 1]`.
- Temporary food/health/safety/education salience multipliers are constrained to `[0.5, 2]`.
- Health and education capacity are non-negative resident-equivalent demand capacities rather than normalized indices.
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
8. `services`
9. `society`
10. `attention`
11. `experience`
12. `policyReaction`
13. `comparison`
14. `contagion`
15. `behavior`
16. `mobilization`
17. `aging`
18. `lifeStage`
19. `demographics`
20. `deprivation`
21. `migration`
22. `adaptation`
23. `events`
24. `projection`

Every rule in a phase reads the same phase-start snapshot and emits effects. Effects settle together before the next phase snapshot. A same-phase `after` dependency orders evaluation/provenance only; it does not expose another same-phase rule's writes.

The extra population phases are deliberate. Outlook, comparison, infection, and mobilization are conceptually sequential reactions, so they settle separately rather than pretending same-phase writes are visible. This also prevents continuous human-state updates from manufacturing cohort fragmentation merely because several feedback loops are active.

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

## Capacity, overload, and policy adjustment

### Service capacity — `population.service-capacity` — people → mapxel

Health and education capacity are explicit staffed/usable capacities. Their targets depend on resident demand, funded public provision, and population composition, but capacity moves gradually rather than instantly matching population.

This means migration or demographic change can increase demand faster than hospitals and schools adapt.

### Service strain — `population.service-strain` — people → mapxel

The simulation compares demand with capacity for health and education, and resident/trade load with infrastructure. Utilization below ordinary capacity creates little disruption. Once utilization becomes high, disruption pressure rises nonlinearly and is worse when the underlying service condition is already weak.

`healthDisruption`, `educationDisruption`, and `infrastructureDisruption` are temporary failures, not permanent destruction of capacity. Disruption recovers when pressure falls, faster when public provision remains funded.

### Policy adjustment — `policy.adjustment-pressure` — mapxel → mapxel

Each place remembers a normalized signature of the policy regime it had adapted to: taxes, aggregate public spending, minimum wage, enabled laws, and effective local subsidies. A large month-to-month change creates temporary `policyAdjustment` pressure. The per-place subsidy signature means scoped policy can create adjustment pressure only where it actually applies.

The memory then moves toward the new policy regime and pressure decays. This is transition stress, not a second implementation of the material policy effect.

## World and resident environmental effects

### Autonomous conditions — `environment.conditions` — mapxel → mapxel

This rule updates the part of local conditions caused by policy and other world state:

- health access from health spending, pollution, food access, and health disruption;
- education access from education spending and education disruption;
- infrastructure from infrastructure spending and infrastructure disruption;
- pollution reduction from environmental spending;
- sports/cultural conditions from culture spending.

### Resident impacts — `population.environment-impact` — people → mapxel

People contribute separately through:

- resident wealth improving private health/education access;
- health and education demand exceeding capacity, reducing effective access;
- population/material intensity affecting infrastructure pressure;
- local and neighboring manufacturing workers creating pollution pressure;
- population density contributing pollution pressure;
- sports workers contributing sports interest.

The two environment rules settle in the same phase, so their deltas sum without pretending resident effects are autonomous environment dynamics.

## People

### Employment — `population.employment` — mapxel → people

Actual adult groups gain or lose employment based on local firm demand, occupation viability, taxes, food conditions, education and adaptability. Worker-health input comes from actual population summaries rather than the mapxel health-access field.

### Public salience — `population.public-salience` — mapxel → people

Food shortages, poor health access and infection, crime, and education failure temporarily raise food, health, safety, or education salience for the people experiencing them. Salience moves gradually and decays back toward ordinary attention as conditions normalize.

Salience multiplies the relevant existing archetype need. It does not create a new generic grievance score.

### Experience and expectations — `population.experience` — mapxel → people

Groups experience prices, food access, crime, pollution, public services, policy and local economic conditions through their own needs, temporary salience, and circumstances. Income, wealth, health, education, wellbeing, approval, environmentalism and civic-liberty attitudes update on groups.

The rule also derives a short-term trend signal from changes in wellbeing, health, income, and wealth. `outlook` is a slower memory of that direction of travel. Approval responds modestly to outlook as well as to current wellbeing.

### Policy reaction — `population.policy-adjustment` — mapxel → people

Temporary local policy-adjustment pressure reduces outlook and approval. Archetypes with more adaptability and risk tolerance react less strongly. Taxes, spending, wages, laws, and subsidies still create their real material effects through their ordinary mechanics; this rule represents the transition experience only.

### Relative comparison — `population.relative-comparison` — mapxel → people

People compare their lived wellbeing with their region, local peers, and the national regional benchmark. Falling behind creates modest additional political grievance through approval and outlook.

This is deliberately compatible with contradictory signals. A disadvantaged region can have lower approval while its outlook improves if conditions are recovering quickly, as the matched simulations demonstrate.

### Infection — `population.infection` — people → people

Groups carry an infection load. Transmission depends on local and neighboring prevalence, density, health access, and health-system disruption. Recovery is faster with good health access. Infection harms human health and moves with population groups when they migrate.

Because infection increases health demand, epidemic pressure can feed service overload, which can then weaken effective health access and recovery.

### Endogenous attitudes — `population.internal-attitudes` — people → people

After experience settles, existing wellbeing slowly shifts solidarity and traditionalism relative to archetype baselines.

### Crime behavior — `population.crime` — people → mapxel

Group poverty, employment status and neighboring wealth inequality create crime pressure; policing and welfare damp it. Cached mapxel employment is not an authority.

### Mobilization — `population.mobilization` — people → people

Latent political mobilization grows from a combination of low approval, hardship, pessimistic outlook, relative disadvantage, civic-liberty conflict, and mobilized neighboring communities. It decays when grievance subsides.

The compatibility `unrest` projection represents visible mobilization. Restricting public assembly sharply reduces visible unrest, but does not erase latent mobilization; for civic-liberty-sensitive groups the restriction can itself add grievance.

Neighboring mobilization is an amplifier rather than an unconditional contagion rule. A contented neighboring community does not automatically protest merely because another city does.

### Aging — `population.aging` — people → people

Every group ages by `1/12` year each month.

### Life stage — `population.life-stage` — people → people

Children become adults at 18; adults become seniors at 65. New adults enter as unemployed with no occupation.

### Natural demographics — `population.demographics` — people → people

Yearly birth cohorts arise from reproductive adults using lived wellbeing, health, family orientation, keyed variation, and average reproductive outlook. Positive outlook modestly increases births; pessimistic outlook modestly suppresses them. Ordinary mortality depends on human age and health.

Newborns begin with neutral salience and mobilization, inherit only a small fraction of parental outlook and infection, and otherwise follow the existing inheritance behavior.

### Food-driven mortality — `population.starvation` — mapxel → people

A later `deprivation` phase converts current food insecurity into additional group mortality. It reads the current post-demographics population groups rather than the step-start cache because ordinary births/deaths have already settled.

The severe deprivation component is:

`population × 0.008 × clamp((0.7 − foodSecurity) / 0.7)²`.

### Starvation report — `environment.starvation-report` — mapxel → mapxel

This compatibility/reporting rule writes `starvationDeaths` from the same severe-deprivation formula. The actual deaths are owned by `population.starvation`.

### Migration and crisis displacement — `population.migration` — mapxel → people

Ordinarily, every third month adult groups compare neighboring places through their needs and circumstances. Appeal includes employment, income, wealth, wellbeing, prices, food access, safety, services, pollution, culture, job viability, outlook, and temporary salience.

Severe food insecurity, water stress, crime, poor health, or service disruption creates `displacementPressure`. Strong crisis pressure can trigger migration outside the normal quarterly cadence, raises the flow cap, and partly overcomes the ordinary inability of households with few reserves to move. Freedom-of-movement restrictions still reduce displacement but do not make extreme distress disappear.

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
- visible unrest from latent mobilization and assembly law;
- resident infection load;
- employed occupational shares.

These projections are not human-state authority.

## Events

### World events — `stories.events` — mapxel → mapxel

Keyed stochastic families include violent crime, sports festivals and regional drought. This rule records the event and applies world/cash consequences.

### Human event experience — `population.event-experience` — mapxel → people

A companion rule translates the exact same stochastic outcome into resident wellbeing changes. It shares `randomNamespace: 'stories.events'`. Event-linked population provenance is resolved at phase commit, so bookkeeping does not create a false data dependency between the two arrows.

## Population settlement

Population effects are generic engine primitives:

- `population-state`: continuous state change;
- `population-transition`: discrete cohort-state change;
- `population-transfer`: migration between cells;
- `population-delta`: birth or death.

All requests settle against phase-start groups. Partial transitions, movement, and mortality compete for source cohort mass and cannot consume more people than exist.

Multiple same-phase **full-cohort continuous** `population-state` deltas can add together without splitting the cohort. That is safe because they are independent deltas against the same phase-start person state. If one human reaction conceptually needs to observe another reaction after it settles, the rules belong in different phases rather than relying on additive settlement.

Similar groups compact after settlement. Short-lived reaction state such as outlook, mobilization, infection, and salience is averaged during compaction rather than defining a permanent cohort identity boundary.

## National summaries

National social metrics are population-weighted over land cells. Population, output, food, starvation deaths, treasury, and debt are summed or reported directly as appropriate. Group income and wealth are behavioral/distributional state, not separately conserved bank accounts. The national `wealth` summary remains private cell cash per resident.

## Save compatibility

The current save schema is version 5. Version-4 saves are migrated by adding neutral emergent state to population groups and initializing service capacity/disruption and policy-memory fields on mapxels. Policy baselines are initialized from the policy actually stored in the save, including scoped subsidies, so loading an old game does not fabricate a new policy shock.

## Extending the simulation

New behavior should be a plain rule module that declares one of the four directions, reads whatever world/person context the mechanism genuinely requires, and emits effects only on its declared output side.

If a proposed rule needs both population and world mutations, split it by causal arrow rather than weakening direction validation. Split stochastic consequences may share a `randomNamespace` when they must reproduce one keyed decision.

When adding a state field, define its mechanics in the appropriate registry. When a rule needs aggregate human state at step start, use the immutable step cache rather than another persistent mapxel mirror. When it must observe people changed earlier in the same month, read current authoritative groups in a later phase.

The intended extension cost remains:

- **new behavior using existing state**: one focused rule module plus tests;
- **new state**: typed state + registry definition + initialization/save migration where required;
- **no engine branch** unless the behavior introduces a genuinely new generic mechanical primitive.
