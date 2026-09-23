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

The HUD and charts use population-weighted national means for local indices. UI wording maps “household wellbeing” to `happiness`; it is not an extra variable. Policy previews use a fiscal forecast from current output, while realized tax collection can be lower because it is limited by the private cash actually available in each cell.

## A useful mental model of the country

The world is a grid of mapxels, approximately 4 km² each. Each land mapxel represents an aggregate community, not named people or individual firms. It has residents and private cash; food and materials stocks; employment and industry shares; physical suitability; living-condition indices; and local prices/business health. Mapxels trade with orthogonal neighbors. There are no roads as a separate network: infrastructure changes the modeled rate of local equalization.

The four sectors compete for workers:

- **Agriculture** produces staple food. Land fertility and food prices affect its productivity/return.
- **Manufacturing** produces generic materials and output. Mineral suitability, education, and Clean Air affect it.
- **Services** contributes output through business viability.
- **Sports** contributes output and responds to sports interest and culture.

Residents need one food unit per month. Insufficient food lowers food security; shortages and high food prices weaken business health; relative returns and subsidies gradually change sector shares; and high prices can eventually attract workers back to farming. This feedback takes time, so inventories can cushion an initial labor shift. Read `docs/RULES.md` for equations and thresholds before making numerical claims.

Keep the accounting layers separate:

- `output` measures abstract monthly activity and is not cash.
- Cell cash is private household/business reserves in an aggregate local account.
- The treasury is government cash; debt tracks borrowing and unpaid interest.
- The external account is finite. Export receipts, imports/procurement, investments, and interest cross that boundary.
- Food and materials are stocks. Trades move a stock and cash payment together.

This is why a policy can have multiple consequences. A subsidy both costs public money and changes relative industry returns; the resulting labor change can influence food output, prices, businesses, employment, migration, and later tax revenue. These are interacting mechanics, not scripted narrative beats.

## The simulation's design principles

### Explicit, sequential monthly phases

The engine increments the month, then runs production, trade, consumption, market adjustment, taxation, financing, fiscal payments, society/demographics, migration, industry adaptation, and stochastic events. Every rule in one phase reads the same immutable snapshot. Rules propose effects; the engine settles the entire phase before taking the next snapshot. A rule cannot see another rule's same-phase proposal, even if an `after` dependency orders them.

### Effects instead of direct mutation

Rules describe resource deltas, account transfers, coupled trades, budget changes, or events. The engine validates and commits those effects. Competing outflows are proportionally constrained by phase-start balances; incoming resources cannot be re-spent inside that phase. Transfers conserve cash; trades conserve the paired goods/payment exchange. Physical production and destruction are explicit.

### Determinism with bounded chance

Given the same seed and choices, keyed rule randomness is reproducible. Random streams are keyed by world seed, tick, rule, cell, and channel so unrelated rules do not disturb each other's rolls. Events are chance-conditioned and use one candidate place per event family per month plus cooldowns. This keeps event rates from multiplying just because the map has more cells.

### Observable but selective causality

Meaningful effects can record observations, affected cells, magnitude, and parent cause IDs. News keeps links to those records, and the end report follows existing cause links. The journal is selective: small updates may have no entry; parent links represent recorded inputs, not counterfactual proof or full causal attribution. Community quotes and news wording are templates selected from model state, not simulated conversations or an unconstrained text generator.

### Validate actions and saves at boundaries

Government actions are data, never generated JavaScript. `validateAction` is authoritative; parsing and previews do not mutate the live game. An action package is checked as a whole and enactment returns a new state. Imported saves are version-checked, reconstitute the seeded world, and validate topology, mutable fields, references, and histories before use.

## Code architecture and data flow

```text
Browser UI (src/App.vue, src/components/, src/composables/useGame.ts)
   │  selection, preview, action, advance
   ├── action → parse/validate/preview → enact → new Game
   └── advance → step(Game)
                    │
                    ├── world.ts creates the initial seeded Game
                    ├── rules/ domain modules propose effects phase by phase
                    ├── engine.ts settles effects, validates, records history
                    ├── math.ts summarizes metrics and provides keyed RNG
                    └── narrative.ts turns evidence into articles and reports
   │
   ├── render national/local views, trends, ledger, and cause chains
   └── save.ts serializes/validates JSON; ui/storage.ts persists autosaves
```

The core simulation in `src/sim/` is browser-framework-independent:

| Module | What it owns | Where to start |
| --- | --- | --- |
| `types.ts` | `Game`, `Model`, `Mapxel`, actions, effects, rule contract, metrics | Understand the data vocabulary before changing shape or behavior. |
| `world.ts` | Seeded geography, initial cell values, default policy and accounts | Understand what a new country starts with. |
| `rules.ts`, `rules/` | Rule registry and domain implementations for economy, state, society, and events | Find a simulation behavior in its domain module. |
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
- For invariants and behavior checks, begin with `tests/engine.test.ts` and `tests/scenarios.test.ts`; browser workflows are in `tests/browser/game.spec.ts`.

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

The simulation deliberately aggregates residents and firms. Food is a staple basket; manufacturing materials are generic; restaurant/retail failure is represented by business health. It currently has no individual cohorts, separately accounted firms, market auction, political parties/elections, diplomacy, multiplayer, or real AI calls. Project effects change an index immediately; the index then responds to ordinary monthly upkeep. Be clear about these boundaries when explaining features or proposing extensions.
