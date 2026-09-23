# Rules and metrics

This document records the rules implemented by the current default simulation and its government-action interface. It describes the fictional model in this repository; its outputs are not real-world forecasts. One tick is one month. Unless stated otherwise, rules below apply to land mapxels and use that phase's input snapshot.

## Units and state

- A mapxel represents approximately 4 km². Population is a continuous resident count, so demographic change and migration can be fractional.
- Money is in fictional crowns (`₡`). Each resident needs one food unit per month. Materials are abstract maintenance inputs. `output` is an abstract monthly economic-activity measure, not cash.
- There are four regions, with zero-based IDs: Northreach (0), The Greenbelt (1), Eastmere (2), Southbank (3). Neighbor relationships are the four orthogonal map directions; there is no separate interregional transport network.
- Industry shares are fractions for agriculture, manufacturing, services, and sports. On each land mapxel they must sum to 1. Children and seniors are population fractions; the working-age fraction is implicit. Children plus seniors cannot exceed 1.
- Index-like fields are constrained to [0, 1]. The engine also constrains food prices to [0.4, 5]. Food, materials, population, cash, and public accounts cannot go below zero. `foodTraded` is a signed net-flow accumulator and may be negative.

### Cell fields and national metrics

Terrain fields are elevation, fertility, and mineral suitability. The simulation also stores local water stress, cash, food, materials, posted food price, an unconstrained scarcity-price signal, children, seniors, education, health, happiness, approval, crime pressure, pollution, infrastructure, employment, food security, sports interest, the four industry shares, output, food made, food used, net food traded, business health, and starvation deaths during the most recent month.

National summary metrics are calculated over land mapxels. Let `P = Σᵢ pᵢ` be their total population. For each per-cell indicator `x`, its national summary is the population-weighted mean `Σᵢ(pᵢ xᵢ) / max(1, P)`. This applies to approval, happiness, crime, food security, employment, pollution, health, education, and price. The remaining summary values are:

| Metric | Definition |
| --- | --- |
| Population | `Σᵢ pᵢ` |
| Wealth | Total private cell cash divided by `max(1, P)`; crowns per resident |
| Output | `Σᵢ outputᵢ` per month |
| Food | `Σᵢ foodᵢ` in stock |
| Starvation deaths | `Σᵢ starvationDeathsᵢ` during the most recent month |
| Treasury, debt | Public account balances in crowns |

The UI's “household wellbeing” is the authoritative cell happiness metric. Food needs met is food security. Population groups also track a distinct shadow wellbeing value, which does not yet feed the national `Summary`. Other cell fields, such as infrastructure, sports interest, and business health, are not part of that type.

### Archetypes and population groups

The world seed and archetype model version deterministically define 2,048 global archetypes. Their traits, needs, values, and sector affinities lie in [0.1, 0.9]. They contain no current age, job, income, wealth, health, approval, or wellbeing. Each land mapxel initially instantiates six locally compatible archetypes, with child, employed-adult, unemployed-adult, and senior groups. Counts add to the cell population; adult employment and child/senior shares initially match the cell aggregates. Group counts may be fractional. Archetypes need not be present in every mapxel.

Mutable group state includes age, life stage, education, occupation, employment status, income, wealth, health, wellbeing, approval, and four current attitudes. Group income and wealth are distributional indices, not separately conserved cash accounts. Partial population effects split groups; whole-group effects retain the ID when possible. Deterministic compaction combines groups with the same archetype and discrete state when their continuous state is within explicit tolerances. All population effects settle against phase-start counts. Group totals equal cell population, and water mapxels contain no groups. The cell social fields remain authoritative while this layer is calibrated.

## Monthly update order

Each phase reads one deeply frozen snapshot and returns proposed effects. The engine settles all proposals for that phase together, validates the resulting model, then takes the next phase's snapshot. Effects within a phase cannot see other effects proposed in that same phase. Tick order:

1. Production
2. Neighbor trade
3. Household consumption
4. Market adjustment
5. Taxation
6. Financing
7. Fiscal payments
8. Society
9. Population experience
10. Aging and life-stage transitions
11. Births and deaths
12. Migration
13. Industry adaptation
14. Stochastic events

Time advances before the first phase. A default mandate lasts 48 ticks; the supported mandate range is 1–240.

## Implemented monthly rules

The equations below use values from the phase snapshot. `clamp(x)` means `min(1, max(0, x))`, except where explicit bounds are shown. A target adjustment at rate `r` means `x ← x + r(target − x)`.

### 1. Production

For each land mapxel, keyed seasonal weather is

`w = 0.96 + 0.08U + 0.09 sin(πt/6)`,

where `U` is a deterministic pseudorandom value in [0, 1), keyed by seed, tick, rule, mapxel, and channel. Effective labor is `L = employment × (0.65 + 0.35 × health)`.

- Food produced: `population × agriculture × (3 + 2 × fertility) × L × w × (1 − 0.18 × pollution) × (1 − 0.6 × waterStress)`.
- Materials produced: `population × manufacturing × (1.4 + minerals) × L`; multiply by 0.9 when Clean Air is active.
- Monthly output: `population × L × [6 agriculture × price + 10 manufacturing × cₘ + 9 services × businessHealth + sports × (4 + 7 sportsInterest)]`, where `cₘ = 0.93` under Clean Air and 1 otherwise.
- The external account pays each cell `0.65 × output` in export receipts. Output itself is not added to cash.

Weather is bounded by its formula, not by an additional clamp. `foodMade` is reset to the new production amount each month; `foodTraded` is reset before this month's trade.

### 2. Neighbor trade

Each land-neighbor pair is processed once for food and once for materials. Let `qₐ = stockₐ/populationₐ` and `qᵦ = stockᵦ/populationᵦ`. The cell with more stock per resident offers goods. The requested quantity is

`min(|qₐ − qᵦ| × populationₐ × populationᵦ / (populationₐ + populationᵦ) × road, 0.85 × sellerPopulation)`,

where `road = 0.18 + 0.55 × min(infrastructureₐ, infrastructureᵦ)`. Food trades use the midpoint of the two food prices; materials cost ₡0.65 per unit. Requests below 0.01 units are skipped.

Trade settles atomically in goods and cash. For each source account/resource, all outgoing demands share the starting balance proportionally. Each trade is further limited by the buyer's starting cash; its settled amount is the request multiplied by the smaller of the seller-stock and buyer-cash availability factors. The goods and payment move together. Food trade updates each cell's signed net `foodTraded` total.

### 3. Household consumption

Residents eat up to the available food: `eaten = min(food, population)`. Monthly food security is `eaten/population`; it is a fraction in [0, 1]. Remaining food is `max(0, food − eaten)`, of which 16% spoils. Thus food stock falls by `eaten + 0.16 × remaining`.

Materials fall by `min(materials, 0.08 × population + 0.12 × materials)`: a population-based upkeep charge plus 12% inventory depreciation, capped at available stock.

The cell pays the external account

`population × (1.6 + 0.04 × cash/population) + 0.09 × output`

in monthly household/import expenditure. Cash transfers are settled from available starting cash, so a cell cannot spend more cash than it has. Unmet food needs are recorded as low food security; this formula does not create negative food.

### 4. Market and businesses

The target food price is

`clamp(1 + [1 − min(2, (foodUsed + food/0.84)/population)] × 1.3 + (1 − foodSecurity) × 1.8, 0.55, 4.5)`.

The local `scarcityPrice` signal moves 14% of the way toward that target each month. The posted `price` follows the same adjustment and stays in [0.4, 5] without controls. With food price controls it is capped immediately at ₡1, while `scarcityPrice` remains free to rise. The latter is a modeled pressure signal, not a measured black-market transaction price. Posted prices set neighbor-trade payments and the return that attracts workers into farming, so the cap can prolong an actual shortage.

Business-health target is

`clamp(0.97 − 0.9(1 − foodSecurity) − 0.17 max(0, price − 1.4) − 0.25 crime − 0.7(1 − viableServices), 0.12, 1)`.

Business health moves 15% toward its target each month.

The national minimum wage is in crowns per worker per month. Each mapxel estimates payroll capacity separately for each industry. Let `unitOutput` be that industry's per-worker contribution inside the production equation, and `healthFactor = 0.65 + 0.35 health`. Then `capacity = (0.65 − 0.09 − 0.3 businessTax) × unitOutput × healthFactor`: export cash receipts less the modeled imported-input expense and business-tax share. Firms within an industry are approximated as having capacities uniformly spread from half to 1.5 times this mean, so the fraction of jobs that can meet a positive floor `w` is `viableSector = clamp(1.5 − w/capacity)` (zero when capacity is zero). With no floor, all jobs remain viable. `viableServices` is the services fraction; a floor beyond what local shops can earn lowers business health, which further reduces their output next month. This is a local hiring model, not an extra cash debit: wages paid within a mapxel net out of its pooled private account.

### 5–7. Taxation, financing, and fiscal payments

Taxes are assessed on measured output, not cash receipts. For each cell, tax due is

`max(0, min(cellCash, output × [0.7 incomeTax + 0.3 businessTax]))`.

Collected cash moves from cells to the treasury. The forecast used for financing and policy previews is different: it uses the full output-based tax amount, without the per-cell cash cap.

For a model snapshot, forecast monthly spending is

`Σᵢ populationᵢ × [Σₛ serviceRateₛ + Σₖ industryShareᵢₖ × subsidyᵢₖ]`,

over populated land cells. Forecast interest is `0.003 × debt` per month. Forecast revenue is `Σᵢ outputᵢ × (0.7 incomeTax + 0.3 businessTax)`. Forecast balance is revenue minus spending and interest.

Borrowing covers the forecast shortfall against current treasury, subject to both remaining principal capacity and external cash:

`borrowed = max(0, min(forecastSpending + forecastInterest − treasury, 30 × population − debt, externalCash))`.

The principal debt limit is ₡30 per resident. Interest is due before service and subsidy spending. The amount actually paid is `min(treasury, forecastInterest)`; any unpaid interest is added to debt as arrears. Therefore, total debt can exceed the principal borrowing limit through unpaid interest.

The common funding fraction is `clamp((treasury − interestPaid)/forecastSpending)` when forecast spending is positive, and 1 when it is zero. Service and subsidy payments are scaled proportionally by this factor. Of basic service spending, 72% is transferred to local cells and 28% to the external account; subsidies go to local cells. There is no money creation to cover an unfunded budget.

After funding the month's services, cash above an operating reserve of ₡6 per resident repays outstanding debt principal, up to the amount owed. Repayment is an explicit treasury-to-external cash transfer paired with an equal debt reduction; it is separate from interest. A government that restores a surplus therefore repairs its balance sheet instead of accumulating cash indefinitely while debt remains outstanding.

### 8. Society

All targets below are calculated from the society-phase snapshot, then each listed index moves toward its target by the specified fraction per month.

Let `wealth = cash/population`; `neighborWealth` is the unweighted average cash per resident of the cell's land neighbors (0 if there are none). Define `inequality = clamp((neighborWealth − wealth)/40)` and `poverty = clamp((24 − wealth)/24)`. With service rates `s`, funding fraction `f`, and effective police rate `police = s.police × f`:

| Field | Target | Monthly adjustment |
| --- | --- | ---: |
| Crime | `clamp(0.11 + 0.30 poverty + 0.24 inequality + 0.30(1 − employment) − 0.30 police − 0.09 s.welfare f, 0.015, 0.7)` | 12% |
| Health | `clamp(0.55 + 0.5 s.health f − 0.18 pollution − 0.35(1 − foodSecurity) + 0.001 wealth)` | 4.5% |
| Education | `clamp(0.35 + 0.6 s.education f + 0.002 wealth)` | 2.5% |
| Infrastructure | `clamp(0.3 + 0.9 s.infrastructure f + 0.06 min(1, materials/population))` | 6% |
| Pollution | `clamp((0.75 manufacturing + 0.25 meanNeighborManufacturing) × (0.6 if Clean Air else 1.1) + population/12000 − 0.7 s.environment f)` | 8% |
| Employment | `clamp(ordinaryJobs × Σ(sectorShare × viableSector), 0.05, 0.98)`, where `ordinaryJobs = clamp(0.96 − 0.6(1 − businessHealth) services − 0.12 businessTax − 0.05(1 − foodSecurity), 0.45, 0.98)` | 10% |
| Happiness | `clamp(0.29 + 0.22 health + 0.20 foodSecurity + 0.16 employment + 0.08 clamp(wealth/45) − 0.45 crime − 0.08 pollution + 0.12 s.culture f − assemblyPenalty)` | 9% |
| Approval | `clamp(0.82 happiness + 0.12 − 0.25 incomeTax − 0.17(1 − f) + assemblyEffect)` | 12% |
| Sports interest | `clamp(0.17 + 0.85 sportsShare + 0.6 s.culture f)` | 6% |

`meanNeighborManufacturing` is the unweighted mean of adjacent land mapxels, or the cell's own share if it has no neighbors. It gives adjacent communities part of the modeled pollution exposure. For happiness, `assemblyPenalty` is 0 while public assembly is enabled and 0.12 otherwise. For approval, `assemblyEffect` is +0.025 when enabled and −0.06 otherwise. `clamp` without explicit bounds uses [0, 1].

Severe food deprivation produces explicit expected starvation deaths in each mapxel:

`starvationDeaths = population × 0.008 × clamp((0.7 − foodSecurity)/0.7)²`.

This is zero when at least 70% of food needs are met. It is a modeled count for the current month, not a cumulative total or a historical mortality estimate. The following demographics phase removes that count from actual groups along with ordinary mortality.

Children move 0.8% toward `clamp(0.15 + 0.09 happiness, 0.12, 0.28)`. Seniors move 0.5% toward `clamp(0.12 + 0.07 health, 0.12, 0.22)`.

The same society phase also aligns adult group employment with the newly proposed cell employment. A mismatch smaller than 0.25 expected people is deferred. For job losses, groups are ordered by a score of `0.6(1 − occupationViability) + 0.2(1 − education) + 0.2(1 − adaptability)`; for job gains, the score is `0.5 adaptability + 0.3 education + 0.2 occupationViability`. The engine transitions enough people in that order, splitting groups when only part changes status. The cell employment target remains the authority during this migration stage.

### 9. Population experience

Each group reads the settled cell conditions from the start of this phase. Let `B = clamp(groupWealth/35)`, `F = clamp(foodSecurity + 0.08 B − 0.12 max(0, price − 1)(1 − B))`, and `Q = clamp((groupIncome + 0.08 min(groupWealth, 30))/(6 price))`. Its target wellbeing is the weighted mean of nine outcomes, using that archetype's corresponding need weights: food `F`, income `Q`, employment (1 if employed, 0.2 if unemployed, 0.7 for children/seniors), health, safety `1 − crime`, housing `clamp(1 − population/20000)`, education access, environment `1 − pollution`, and culture `clamp(0.5 + cultureSpending × funding)`. Group wellbeing moves 10% toward this target. Thus the same food price or job shock can affect groups differently through both their circumstances and needs.

For employed adults, monthly target income is `(output/population) × (0.8 + 0.3 education)`; for other groups it is zero. Income moves 18% toward that target. Let `nextIncome` include that adjustment. Group wealth changes by `max(−wealth, 0.25(nextIncome − 1.5 − 1.7 price) + 0.01(cellCash/population − wealth))`. This is distributional state, not a transfer from the conserved cell cash account. Group health moves 4% toward cell health. Education targets `clamp(cellEducation + 0.18(archetypeEducationAffinity − 0.5))`, with monthly adjustments of 2% for children, 0.5% for adults, and zero for seniors.

Group approval has a separate target: `clamp(0.16 + 0.55 nextWellbeing + 0.15 wellbeingChange + 0.1 funding + assemblyAgreement − 0.2 incomeTax × archetypeMaterialism)`. `assemblyAgreement` is `+0.035 × currentCivicLiberty` with public assembly and `−0.18 × currentCivicLiberty` without it. Approval moves 8% toward the target, so it can differ from wellbeing and carries memory of past conditions.

Current group attitudes drift slowly around their archetype baselines. Environmentalism moves 0.3% per month toward `clamp(baselineEnvironmentalism + 0.2(pollution − 0.2))`; civic-liberty concern moves 0.2% toward `clamp(baselineCivicLiberty + 0.08 if public assembly is restricted)`. Solidarity moves 0.2% toward `clamp(baselineSolidarity + 0.1(1 − wellbeing))`; traditionalism moves 0.1% toward `clamp(baselineTraditionalism + 0.05(1 − wellbeing))`. Archetype definitions themselves never drift.

### 10–11. Group aging and demographics

Each existing group ages by 1/12 year per month. A child reaching 18 becomes an unemployed adult with an occupation chosen from local industry shares and archetype affinities. An adult reaching 65 becomes a senior and leaves employment. These whole-group transitions retain the group ID.

Births and deaths are explicit population source and sink effects. In each land mapxel, reproductive adults are groups aged 18–49. Their selection weight is `groupCount × (0.7 + 0.6 familyOrientation)`. Every twelfth month, the birth count is `12 × population × (0.00065 + 0.00055 happiness + 0.0002 health) × clamp(reproductiveWeight / (0.45 population), 0, 1.5)`; it is zero in the intervening months. Batching expected fractional births makes inspectable yearly child cohorts. A keyed draw selects one parent cohort. Children inherit its archetype 88% of the time; for the other 12%, one of four one-bit variants with the closest stable trait vector is chosen. The newborn group begins at age zero with no occupation, employment, education, or income. Its health, reserves, wellbeing, approval, and attitudes come from current parent and local conditions.

Ordinary deaths target `population × [0.00095 + 0.0005(1 − health) + 0.0008(1 − foodSecurity)]`; the current month's starvation deaths are added. The total is capped at current population. Group allocations are weighted by count, age risk, group health, and food deprivation, capped at each source group count, with any excess redistributed. Older and less healthy groups therefore experience a larger share of mortality. The resulting changes to mapxel population come from group birth and death Effects, rather than an aggregate net population delta.

### 12. Migration

Each mapxel compares its adjacent communities using an economic opportunity proxy. Let `foodAdjustedReceipts = (0.65 × output/population)/price` and `foodAdjustedReserves = (cash/population)/price`. The 0.65 factor matches the cash actually received from production exports; `price` is the local staple-food price. These are proxies for potential earnings and purchasing power, not observed wages or a complete cost-of-living index. Cell appeal is

`happiness + 0.4 employment + 0.28 clamp(foodAdjustedReceipts/5) + 0.12 clamp(foodAdjustedReserves/60) + 0.3 foodSecurity − population/15000`.

Every third month, across each land-neighbor pair, residents move from lower to higher appeal. The requested quarterly flow is the source population times `min(0.009, 0.021 × |appeal difference|)`. With Freedom of Movement repealed, multiply that flow by 0.08. An adult group large enough to supply that flow is selected with weight proportional to its count, `(0.2 + mobility)`, `(1 − 0.75 communityAttachment)`, `clamp(groupWealth/10, 0.2, 1)`, hardship `1 + 0.5(1 − groupWellbeing) + 0.35 if unemployed`, and destination opportunity `1 + 0.5 max(0, destinationEmployment − sourceEmployment)`. A keyed deterministic draw selects the group. If no single adult group is large enough, the flow is divided among adult groups in descending count order. Migrants carry the same fraction of source-cell cash as their fraction of source population. Group transfers and cash outflows settle against phase-start balances; national population is conserved by migration. Jobs can attract people, while expensive or unavailable food can outweigh higher nominal output.

### 13. Industry adaptation and retraining

For each sector `k`, compute a base weight `bₖ`, return `rₖ`, and normalized target share `qₖ`:

| Sector | Base weight `bₖ` | Return `rₖ` |
| --- | --- | --- |
| Agriculture | `0.24 + 0.19 fertility` | `1.1(price − 1)` |
| Manufacturing | `0.13 + 0.1 minerals` | `0.2 education − 0.08` if Clean Air is active; otherwise `0.2 education` |
| Services | `0.36` | `0.8(businessHealth − 0.85)` |
| Sports | `0.045 + 0.06 sportsInterest` | `0.25 sportsInterest` |

`wₖ = bₖ × exp(clamp(rₖ + 1.1 × subsidyₖ × funding, −2, 4))`, and `qₖ = wₖ / Σⱼwⱼ`. Each sector share moves 6.5% toward `qₖ` per month. Since all shares use the same snapshot and the targets sum to 1, the shares remain normalized. Local subsidies replace, rather than add to, that sector's national subsidy.

Every sixth month, each unemployed adult group of at least one expected person compares sector opportunities `sectorShare × viableJobs × (0.4 + archetypeSectorAffinity)`. If the best sector differs from its occupation and scores at least 0.02, the group requests an occupation transition for `count × 0.25 × (0.2 + adaptability) × (0.3 + 0.7 cellEducation)` people, provided the request reaches 0.1 person. Only that subgroup changes occupation; its archetype and employment status stay the same. Retraining changes which sector viability can subsequently help it find work, but does not create jobs directly.

### 14. Stochastic events

Random values are deterministic for a given seed, tick, rule ID, mapxel ID, and channel. Each event family samples one candidate land mapxel per month, so adding mapxels does not create an independent national event roll for every cell. Cooldowns are measured from the last event of that family.

| Event | Eligibility and probability | Effects |
| --- | --- | --- |
| Violent crime | At least 5 months since the prior event; probability `0.05 + 0.8 × chosenCellCrime` | Happiness −0.06 in the chosen cell and −0.008 in every other land cell |
| Festival | At least 4 months since the prior event; probability `0.12 + 0.35 × chosenCellSportsInterest` | Chosen cell: sports interest +0.15, happiness +0.04, and external cash transfer of ₡0.40 per resident |
| Drought | At least 9 months since the prior event; probability 0.10 | Selects the chosen cell's region, destroys 35% of food stock, and adds `0.4 × (1 − waterStress)` water stress to each land cell there |

The probabilities are evaluated against a uniform value in [0, 1); if the event is in cooldown, no roll produces an event. Each month, water stress falls by 35% of its current value before any new drought increase; both changes use the same phase-start state. Effects are applied in the final phase, after that month's consumption, so drought reduces food available and farm output in the following month. Policy may affect risk through modeled state, but does not make a stochastic event inevitable.

## Settlement, validation, and causal records

- A cash `transfer` moves the same settled amount from one account to another; a `trade` transfers both commodity and payment atomically. Cash cannot be created with a cell delta. Production and destruction use explicit resource deltas.
- Competing outgoing demands reserve the same phase-start stock. Each demand is scaled by the source's available balance divided by total demand, capped at 1. For a trade, the goods and buyer-cash capacity factors are both applied, using the smaller factor. This conservative one-pass settlement can leave stock unused when another participant is cash-constrained.
- Incoming resources cannot fund another outgoing effect in the same phase. All effects and model values must be finite; resource stocks and accounts stay nonnegative; index bounds, demographics, and industry-share sums are checked after each phase. A failed tick does not replace the original game state.
- Rules have unique IDs and must use known phases. Optional `after` dependencies are checked for missing IDs, cycles, and dependencies on later phases. Dependencies within one phase define order only; rules still read the same phase snapshot. The engine canonicalizes registration order.
- Rule randomness is keyed so an unrelated rule does not consume another rule's random sequence. Extension rules return effects and must not mutate snapshot state, time, topology, or identity.
- Significant effects and policy decisions may create immutable causes with observed inputs, affected cells, magnitudes, and links to earlier recorded causes. The journal is selective, not exhaustive, and links do not establish counterfactual causation. Small effects may have no record.

## Government actions

The authoritative action boundary is `validateAction`; the console parser is only a convenience. Actions accept exact documented fields, reject unknown keys and non-finite values, and do not advance time. The console supports a single action or an atomic package of 1–20 actions. Every action is validated before any package mutation; an invalid or unaffordable package changes nothing. Preview reports an immediate forecast-budget change and upfront investment cost; the forecast uses current output and policy, not a simulation of future behavioral responses.

| Action | Allowed values | Scope and effect |
| --- | --- | --- |
| Tax | Income or business rate from 0 to 0.65 | National. Changes the tax parameter used by taxation and society rules. |
| Minimum wage | ₡0 to ₡10 per worker per month | National. Zero is the default and removes the floor; a positive floor enters each mapxel's payroll-capacity test. |
| Public spending | Each service rate from ₡0 to ₡2 per resident per month | National. Services: health, education, police, infrastructure, welfare, culture, environment. |
| Subsidy | ₡0 to ₡3 per sector worker per month | Sector is agriculture, manufacturing, services, or sports; scope is national, region, or explicit land cells. |
| Law | Boolean on/off | National. Laws: Clean Air, Freedom of Movement, Public Assembly, Food Price Controls. |
| Investment | ₡1 to ₡1,000,000,000 | Project and scope required; total package cost cannot exceed current treasury. |

Scopes are `{"kind":"national"}`, `{"kind":"region","id":0}`, or `{"kind":"cells","ids":[...]}`. Region IDs must be valid integers. Cell IDs must exist, be distinct, nonempty, and refer to land. Taxes, spending, and laws are national-only. Omitted scope in the console DSL means national for actions that have a scope. `selected` is converted to a fixed list of selected land-cell IDs when parsed.

Local subsidy rates override the national rate. Where local grants overlap, the most recently enacted applicable local rate wins. Setting a national rate clears all local overrides for that sector; setting an applicable rate to zero removes support at that scope. Subsidies do not stack.

Investment costs are taken immediately from treasury and moved to the external account. The amount is divided by total population in the scoped cells, then added to each cell's relevant index: transport → infrastructure, hospital → health, school → education, stadium → sports interest. For the first three projects the increment is `amount / scopedPopulation / 60`; for stadium it is `amount / scopedPopulation / 30`. Each resulting index is clamped to [0, 1].

## Calibration evidence and limits

The simulation documentation reports these observed 48-month baseline ranges on three full-size seeded maps: approval 73.1–73.7%, wellbeing/happiness 80.2–80.9%, food needs met 98.9–99.9% at month 48, zero debt, and full service funding. The documented regression coverage also includes five 48-month seeds, a 240-month run without discrete events, a small initial-condition perturbation, account-conservation checks, policy-direction checks, a subsidy/food/business feedback chain, and unaffordable fiscal settings. `npm run calibrate` runs five scenarios on three 36×26 worlds. Under a national sports subsidy of ₡3 per sector worker per month, national food-security lows are 64.3–65.4% before recovery as farming returns rise and fiscal constraints limit funding.

These are observations and regression checks for selected seeds and scenarios, not mathematical guarantees of stability or universal outcomes. The economy is intentionally simplified: households and firms are aggregates, agriculture is a staple-food basket, manufacturing makes generic materials, and business failures are represented through business health. Population groups have age state, but births, deaths, and stage changes still use the legacy aggregate demographic rule. There is no market auction, electoral-party system, foreign diplomacy, or interregional transport graph. Projects raise an index immediately; that index then follows ordinary public-service upkeep. Custom policy extremes can cause hardship and default, with finite, inspectable state.
