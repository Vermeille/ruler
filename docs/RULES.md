# Rules and metrics

This file is the compact reference for the current default simulation. The model is fictional; its outputs are not real-world forecasts. One tick is one month.

For architecture and extension guidance, see [SIMULATION.md](SIMULATION.md). This file focuses on what the default rules currently do.

## Authority model

There are two kinds of mutable state:

- **World/mapxel state**: terrain-adjacent conditions, stocks, prices, pollution, infrastructure, business health, food security, crime pressure, sports interest, and other local conditions.
- **People state**: age, life stage, education, occupation, employment status, income, wealth, health, wellbeing, approval, and attitudes on population groups.

Human aggregates on mapxels are caches, not a second social model. `employment`, `happiness`, `approval`, `children`, `seniors`, and the four occupational shares are projected from settled population groups by `population.aggregate` at the end of the tick.

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

Mutable mapxel field mechanics are defined in `src/sim/map-fields.ts`. Population field mechanics are defined in `src/sim/population/fields.ts`. Validation, settlement, merging, saves, and tooling should derive behavior from those registries rather than maintaining duplicate field lists.

## Monthly phase order

1. `production`
2. `trade`
3. `consumption`
4. `market`
5. `taxation`
6. `financing`
7. `fiscal`
8. `society` — currently world/environment conditions plus population employment
9. `experience`
10. `behavior`
11. `aging`
12. `lifeStage`
13. `demographics`
14. `migration`
15. `adaptation`
16. `events`
17. `projection`

Every rule in a phase reads the same phase-start snapshot and emits effects. Effects settle together before the next phase snapshot. A same-phase rule therefore cannot observe another same-phase rule's writes.

## Economy

### Production — `economy.production`

Effective labor is

`employment × (0.65 + 0.35 × health)`.

Food production is proportional to population, agricultural labor share, fertility, labor, seasonal weather, pollution, and water stress. Manufacturing produces materials from population, manufacturing share, minerals, labor, and Clean Air policy. Output combines the four occupational shares with sector-specific productivity.

Firms receive an explicit export receipt from the external account equal to `0.65 × output`. Output itself does not mint money.

### Neighbor trade — `economy.neighbor-trade`

Adjacent land cells compare food/material stocks per resident. The better-stocked cell offers goods toward equalization, limited by road quality and seller inventory. Food trades use the midpoint of local prices; materials use a fixed modeled price.

Trade settles goods and payment atomically. Competing outgoing claims share phase-start inventory, and poor buyers cannot spend incoming cash from the same phase.

### Households — `economy.households`

Residents consume up to one food unit per resident. `foodSecurity` is the share of that need actually met. Remaining food partially spoils, materials decay through upkeep, and household/import spending transfers cash to the external account.

### Businesses — `economy.businesses`

Food scarcity raises a free scarcity-price signal. Posted prices move gradually toward that signal, subject to food price controls. Low food security, expensive ingredients, crime, and unviable service jobs reduce `businessHealth`.

Sector job viability comes from `src/sim/rules/wages.ts`. A minimum wage only destroys modeled jobs when it exceeds what local firms in that sector can support from their productive capacity.

## Government finance

### Taxation — `state.taxation`

Taxes are assessed on measured output using the configured income- and business-tax rates. Actual collection is capped by local private cash and moves cash to the treasury.

### Financing — `state.financing`

Borrowing covers forecast shortfalls subject to a principal credit limit of `₡30 × population` and available external cash.

### Fiscal settlement — `state.services`

Interest is paid first. Services and subsidies then share remaining treasury cash through a common funding fraction. Surplus cash above operating reserves repays principal through an explicit treasury-to-external transfer.

## World/environment conditions

### Environment — `environment.conditions`

The environment rule updates world-level conditions only:

- health access responds to health spending, pollution, food access, and resident wealth;
- education access responds to education spending and resident wealth;
- infrastructure responds to infrastructure spending and available materials;
- pollution responds to local/neighbor manufacturing, Clean Air policy, population, and environmental spending;
- sports interest responds to the current sports workforce share and culture spending.

It does **not** directly write cached human employment, happiness, approval, demographics, or occupational shares.

## People

### Employment — `population.employment`

Employment starts from actual adult groups, not cached `cell.employment`.

Local firms determine how many employed adults can be supported from occupation viability, business health, taxes, and food conditions. If jobs are lost, affected groups are chosen using occupation viability, education, and archetype adaptability. If jobs expand, the same group-level state determines who enters employment.

Employment changes are `population-transition` effects. Partial transitions split cohorts.

### Experience — `population.experience`

Groups experience the world through their own archetype needs and current circumstances. Income, wealth, health, wellbeing, approval, and attitudes update on the group. Archetype identity does not change.

Age is deliberately **not** changed here.

### Crime behavior — `population.crime`

Crime pressure is people-to-world behavior rather than a direct environment target. Group wealth, employment status, local inequality, policing, and welfare contribute to resident crime pressure. The aggregated result changes the mapxel `crime` field.

This means cached `cell.employment` is not the authority for crime formation; actual resident groups are.

### Aging — `population.aging`

Every group ages by `1/12` year each month.

### Life stage — `population.life-stage`

After aging settles, threshold crossings produce discrete group transitions. Children become adults at 18; adults become seniors at 65. Retirement/employment changes happen to the transitioned groups.

### Demographics — `population.demographics`

Births and deaths are explicit population sources and sinks.

Yearly birth cohorts are produced from reproductive adult groups using lived wellbeing, health, family orientation, and deterministic keyed draws for parent/archetype variation.

Ordinary mortality depends on lived health and food access and is weighted by group age and health. Severe food deprivation adds starvation pressure directly inside this same rule:

`starvationDeaths = population × 0.008 × clamp((0.7 − foodSecurity) / 0.7)²`.

The rule both emits actual group death effects and writes `starvationDeaths` as the reported outcome of that demographic process. No separate society rule predicts deaths for demographics to consume later.

### Migration — `population.migration`

Every third month, adult groups evaluate neighboring cells. Appeal depends on the group's archetype needs and current circumstances, including work, income, wealth, wellbeing, mobility, community attachment, prices, food access, safety, health, education, pollution, culture, and local job viability.

A positive move is stochastically quantized to person-scale cohort units. Migration uses `population-transfer`, preserving archetype/group state. Proportional local cash moves with migrants through a separate ordinary cash transfer. Free-movement restrictions sharply reduce the movement rate rather than directly changing appeal.

### Retraining — `population.retraining`

Every sixth month, adults compare occupation opportunities. Opportunity combines structural local fit, market signals, subsidies, job viability, sector productivity, education access, archetype affinity, and adaptability.

Employed residents can switch occupation when the gain is material; unemployed residents can retrain. These are population transitions, not mapxel sector-share edits.

### Projection — `population.aggregate`

After all behavior/events settle, population groups are materialized into cached mapxel human aggregates:

- adult employment rate;
- resident wellbeing/happiness;
- resident approval;
- child and senior shares;
- employed occupational shares for agriculture, manufacturing, services, and sports.

This is the only default rule allowed to write those cached human fields.

## Events — `stories.events`

Event families use keyed deterministic random draws and cooldowns. Current families include violent crime, sports festivals, and regional drought.

Events may change world state, cash, or the population groups that experience them. Morale effects change group wellbeing rather than directly overwriting cached happiness. Projection happens later in the dedicated projection phase.

## Population settlement

Population effects are generic engine primitives:

- `population-state`: continuous state change;
- `population-transition`: discrete cohort-state change;
- `population-transfer`: migration between cells;
- `population-delta`: birth or death.

All requests settle against phase-start groups. Competing requests cannot consume more than the source cohort. Partial effects split groups. Similar groups may compact after settlement. Death-only settlement avoids unnecessary compaction.

## National summaries

National social metrics are population-weighted over land cells. Population, output, food, starvation deaths, treasury, and debt are summed or reported directly as appropriate. Because human cell aggregates are projected from groups, national approval, happiness, and employment ultimately derive from resident state.

Group income and wealth are behavioral/distributional state, not separately conserved bank accounts. The national `wealth` summary remains private cell cash per resident.

## Extending the simulation

New behavior should be a plain rule module that reads existing state and emits generic effects. Do not add a special settlement path for each new social mechanism.

When adding a new continuous or discrete state field, define its mechanical semantics in the appropriate field registry. Runtime validation, bounds, merge behavior, saves, and causal tooling should consume that registry.

The intended extension cost is:

- **new behavior using existing state**: one rule module plus tests;
- **new state**: typed state + one registry definition + initialization/save migration when required;
- **no engine branch** unless the behavior genuinely introduces a new generic mechanical primitive.

The causal-analysis tools observe ordinary rule reads and effects, so a normal new behavior should automatically acquire input, output, sensitivity, footprint, and downstream views without a bespoke devtools implementation.
