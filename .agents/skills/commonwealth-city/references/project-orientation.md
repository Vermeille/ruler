# Commonwealth City: 10-minute orientation

## The one-minute version

Commonwealth is a browser-playable political and local-economy simulator written in TypeScript. The player governs a seeded, procedurally generated country for a finite mandate (48 months by default). Each month, they can change national taxes and services, direct sector subsidies locally or nationally, invest in local conditions, or enact laws. Then they advance time and observe how those choices interact with food, jobs, business health, public finances, migration, approval, and chance events.

The intended experience is to make understandable policy choices, see their uneven consequences across communities, inspect evidence-linked stories, and finish with a report on the mandate. It is a compact fictional model for exploration, not a realistic macroeconomic forecast, an AI-powered advisor, or a single-score strategy game. There is no required winning policy. Approval is prominent, but food access, wellbeing, employment, public services, wealth, and debt can move differently.

## What the player does

1. **Inspect the country.** The map shows a generated grid of land and water, four regions, and named urban areas. Select a cell, rectangle, or region. Switch between terrain, approval, wealth, food security, crime pressure, population, pollution, and dominant industry layers. The inspector compares local conditions with national and selected-area summaries.
2. **Choose a policy.** Use the cabinet to adjust income and business tax, fund seven services, subsidize one of four industries, make an investment, or toggle a law. Local scope matters: a regional or cell-level intervention can help a specific place while leaving other places under different conditions. Previews estimate fiscal effects and investment cost.
3. **Advance the simulation.** Step one month at a time or run at selectable speeds. Any policy edit pauses playback. Each month is a complete ordered simulation tick; time is not advanced by simply submitting an action.
4. **Read what happened.** National accounts show trends; the ledger reports selected developments; cause views expose recorded observations and contributing IDs. At mandate end, a report compares initial and final indicators, adds template community voices selected from measured conditions, and traces some sufficiently complete policy-to-story chains.
5. **Keep or compare the mandate.** Progress autosaves in the browser's IndexedDB. JSON saves can be exported/imported; starting a new country can use a chosen seed.

The HUD and charts use population-weighted national means for local indices. Mapxel `happiness`, `approval`, `employment`, demographic shares, and sector shares are materialized projections of the settled population groups, not a second independent social simulation. Policy previews use a fiscal forecast from current output, while realized tax collection can be lower because it is limited by the private cash actually available in each cell.

## A useful mental model of the country

The world is a grid of mapxels, approximately 4 km² each. Each land mapxel is the local environment and economy: terrain, resources, food and materials stocks, prices, pollution, infrastructure, crime pressure, business conditions, public-service conditions, and an aggregate private cash account. Mapxels trade with orthogonal neighbors. There are no roads as a separate network: infrastructure changes the modeled rate of local equalization.

The people are represented by 2,048 deterministic global human archetypes and sparse mutable population groups instantiated locally in each mapxel. Archetypes hold persistent predispositions, needs, values, and sector affinities. Groups hold the circumstances that change: age, employment, occupation, income, wealth, health, education, wellbeing, approval, and attitudes. The same archetype can simultaneously exist as wealthy employed residents, poor unemployed residents, migrants, students, or retirees. Employment shocks can split a group; similar groups can merge; migration moves actual groups and their archetype composition. Births create child cohorts, deaths remove members of actual groups, and children mature into adults who later retire.

The central causal loop is **world conditions → people experience them → people react → their reactions change the world**. Policies normally change opportunities, constraints, services, prices, rights, or environmental conditions. Population groups then react according to both their circumstances and archetype. Their settled employment, occupations, wellbeing, approval, migration, demographics, and adaptation are projected back onto mapxel aggregates before the next month. Human properties should not be independently authored at mapxel level when they can be derived from the people living there.

The four sectors compete for workers:

- **Agriculture** produces staple food. Land fertility and food prices affect its productivity/return.
- **Manufacturing** produces generic materials and output. Mineral suitability, education, and Clean Air affect it.
- **Services** contributes output through business viability.
- **Sports** contributes output and responds to sports interest and culture.

Residents need one food unit per month. Insufficient food lowers food security; shortages and high food prices weaken business health. Firms and policy create changing job opportunities; actual population groups gain or lose employment, and unemployed groups may retrain toward sectors that fit local opportunity, subsidies, prices, education access, and their archetype. The final mapxel sector and employment shares are then projected from those people. Read `docs/RULES.md` for equations and thresholds before making numerical claims.

Keep the accounting layers separate:

- `output` measures abstract monthly activity and is not cash.
- Cell cash is private household/business reserves in an aggregate local account.
- Group income and wealth are distributional human state; they are not separately conserved bank accounts yet.
- The treasury is government cash; debt tracks borrowing and unpaid interest.
- The external account is finite. Export receipts, imports/procurement, investments, and interest cross that boundary.
- Food and materials are stocks. Trades move a stock and cash payment together.

This is why a policy can have multiple consequences. A subsidy changes public spending and local opportunity; people may retrain, keep or lose jobs, move, or experience different wellbeing; their changed labor mix then affects later production, pollution, prices, businesses, migration, and tax revenue. These are interacting mechanics, not scripted narrative beats.

## The simulation's design principles

### Explicit, sequential monthly phases

The engine increments the month, then runs production, trade, consumption, market adjustment, taxation, financing, fiscal payments, society/world conditions, population experience, aging, demographics, migration, population retraining, and stochastic events plus final population projection. Every rule in one phase reads the same immutable snapshot. Rules propose effects; the engine settles the entire phase before taking the next snapshot. A rule cannot see another rule's same-phase proposal, even if an `after` dependency orders them.

### Effects instead of direct mutation

Rules describe resource deltas, account transfers, coupled trades, budget changes, events, population state changes, population transitions, births/deaths, or population transfers. The engine validates and commits those effects. Competing outflows are proportionally constrained by phase-start balances; incoming resources cannot be re-spent inside that phase. Transfers conserve cash; trades conserve the paired goods/payment exchange; migration and group splitting conserve population; births and deaths are explicit population sources and sinks.

### People are authoritative for human aggregates

`PopulationGroup` is the source of truth for mutable human state. `population.aggregate` materializes mapxel employment, wellbeing/happiness, approval, child/senior shares, and employed occupational shares from those groups at the end of the month. Economy and UI code may read those mapxel fields as cached projections, but new social mechanics should act on groups first rather than inventing a second mapxel-level human state. The legacy `economy.labor` aggregate adaptation rule remains exported for compatibility/tests but is not in `defaultRules`; ordinary sector adaptation occurs through population retraining and employment changes.

### Determinism with bounded chance

Given the same seed and choices, keyed rule randomness is reproducible. Random streams are keyed by world seed, tick, rule, cell, and channel so unrelated rules do not disturb each other's rolls. Events are chance-conditioned and use one candidate place per event family per month plus cooldowns. This keeps event rates from multiplying just because the map has more cells.

### Observable but selective causality

Meaningful effects can record observations, affected cells, magnitude, and parent cause IDs. News keeps links to those records, and the end report follows existing cause links. The journal is selective: small updates may have no entry; parent links represent recorded inputs, not counterfactual proof or full causal attribution. Community quotes and news wording are templates selected from model state, not simulated conversations or an unconstrained text generator.

### Validate actions and saves at boundaries

Government actions are data, never generated JavaScript. `validateAction` is authoritative; parsing and previews do not mutate the live game. An action package is checked as a whole and enactment returns a new state. Imported saves are version-checked, reconstitute the seeded world, and validate topology, mutable fields, population groups, references, and histories before use.

## Code architecture and data flow

```text
Browser UI (src/App.vue, src/components/, src/composables/useGame.ts)
   │  selection, preview, action, advance
   ├── action → parse/validate/preview → enact → new Game
   └── advance → step(Game)
                    │
                    ├── world.ts creates the initial seeded Game
                    ├── rules/ create local economic/environmental conditions
                    ├── population/ makes groups experience and react to them
                    ├── engine.ts settles effects and validates each phase
                    ├── population.aggregate projects people back to mapxel caches
                    ├── math.ts summarizes metrics and provides keyed RNG
                    └── narrative.ts turns evidence into articles and reports
   │
   ├── render national/local views, trends, ledger, and cause chains
   └── save.ts serializes/validates JSON; ui/storage.ts persists autosaves
```

The core simulation in `src/sim/` is browser-framework-independent:

| Module | What it owns | Where to start |
| --- | --- | --- |
| `types.ts` | `Game`, `Model`, `Mapxel`, archetypes, population groups, actions, effects, rule contract, metrics | Understand the data vocabulary before changing shape or behavior. |
| `population/` | Deterministic archetypes, sparse group generation, settlement, merging, selectors, experience, demographics, retraining, and aggregate projection | Keep archetype baselines separate from mutable group circumstances and keep groups authoritative. |
| `world.ts` | Seeded geography, initial cell values, default policy and accounts | Understand what a new country starts with. |
| `rules.ts`, `rules/` | Rule registry and domain implementations for economy, state, society, and events | Find world/environment mechanics and the active phase registry. |
| `policy.ts` | Scope resolution, action validation, preview, policy enactment and budget forecast | Change government controls or policy effects. |
| `engine.ts` | Dependency ordering, snapshots, settlement, invariants, complete tick | Change rule execution or accounting behavior. |
| `math.ts` | Clamp/approach helpers, deterministic RNG, national summaries | Change aggregation, summaries, or keyed randomness. |
| `narrative.ts` | Monthly articles, cause traversal, selected voices, mandate report | Change interpretation or reporting of outcomes. |
| `save.ts` | Versioned JSON serialization, import checks and validation | Change persisted state or save compatibility. |

`src/main.ts` mounts the Vue application or the optional developer workbench. `src/App.vue` composes the player views, `src/components/` owns their controls, and `src/composables/useGame.ts` manages the browser-facing game state, playback, and autosave. `src/ui/map.ts` draws the canvas map inside `MapPanel.vue`; `src/ui/storage.ts` wraps IndexedDB autosaves. `src/dev/` contains traces and causal rule analysis. Vite builds a static client; there is no backend or external AI service.

In an ordinary turn, the key state transition is:

```text
game = createGame(seed)
game = enact(game, validatedActions)  // same tick, new state
game = step(game, defaultRules)       // one complete month
```

Both action enactment and tick execution work with new game state rather than directly editing the caller's original state. `step` also makes the monthly transition atomic: if validation fails, the failed candidate tick is discarded.

## Fast orientation: where to read next

- For exact units, equations, summary metrics, action bounds, event probabilities, and known limitations: [`docs/RULES.md`](../../../docs/RULES.md).
- For console syntax and action validation/AI boundary: [`docs/ACTIONS.md`](../../../docs/ACTIONS.md).
- For model rationale, extension contracts, and calibration caveats: [`docs/SIMULATION.md`](../../../docs/SIMULATION.md).
- For the player-facing feature list and run commands: [`README.md`](../../../README.md).
- For invariants and behavior checks, begin with `tests/engine.test.ts`, `tests/population.test.ts`, `tests/population-authority.test.ts`, and `tests/scenarios.test.ts`; browser workflows are in `tests/browser/game.spec.ts`.

Useful commands documented by the project:

```sh
npm install
npm run dev        # local browser play
npm test           # simulation and policy tests
npm run build      # TypeScript check and static bundle
npm run calibrate  # multi-seed, multi-policy calibration scenarios
npm run test:e2e   # browser playthrough tests; requires Playwright browser setup
```

Calibration output is evidence for its specific seeds, scenarios, and protocol, not a general stability proof. Tests describe intended repository behavior, but when they conflict with current product intent, inspect the relevant implementation and user instruction before changing semantics.

## Scope boundaries

The simulation deliberately aggregates residents into population groups and firms into local economic indices. Population groups are cohorts, not individual people or households. Group income and wealth are behavioral/distributional state rather than separate conserved accounts. Food is a staple basket; manufacturing materials are generic; restaurant/retail failure is represented by business health. It currently has no separately accounted firms, market auction, political parties/elections, diplomacy, multiplayer, or real AI calls. Be clear about these boundaries when explaining features or proposing extensions.
