# Commonwealth

A playable TypeScript political simulator. Govern a procedurally generated country for a 48-month mandate, then read how different communities remember it. No AI service, API key, backend, or account is needed.

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (normally http://localhost:5173). `npm run build` produces a static site in `dist/`; `npm run preview` serves that build. Node 18.19+ is supported. Dependencies are locked in `package-lock.json`.

## Playing

- Click a mapxel, drag a rectangle, or choose a region. Shift-click adds/removes cells. Eight map layers expose local differences.
- Use the cabinet to change taxes, fund seven public services, grant local or national industry subsidies, build infrastructure, or enact laws. Every policy has a cost preview.
- Advance a month or press play. Space toggles playback. Editing a policy pauses time. Look at several months of change before drawing conclusions.
- Read the Ledger, locate reported events, and inspect recorded contributing causes. The national accounts show trends and export CSV.
- At month 48, read and export the mandate report: public opinion, community voices, measured changes, dispatches, and policy-to-outcome chains.
- Progress autosaves to IndexedDB. Save & load exports/imports a validated JSON file. New country lets you choose a seed and export the previous mandate first.

Try a sports subsidy of ₡3 per worker in a region. Workers respond to relative returns, reducing local farming. Food stocks and imports initially cushion the change. Scarcity can later raise prices and hurt restaurants and shops; high prices eventually attract farmers back. This is a model interaction, not a scripted chain.

## The core

The framework-independent simulation lives in `src/sim/`:

| Module | Responsibility |
| --- | --- |
| `types.ts` | Mapxels, government actions, effects, rules, causal records |
| `world.ts` | Seeded country, regions, cities, land/resources, starting calibration |
| `engine.ts` | Immutable phase snapshots, simultaneous settlement, validation, atomic ticks |
| `rules.ts` | Production, local trade, consumption, prices/businesses, taxes, finance, services, society, migration, labor adaptation, events |
| `policy.ts` | Strict DSL and JSON validation, scoped policies, cost previews, atomic enactment |
| `narrative.ts` | Evidence-linked news, causal traversal, community voices and mandate reports |
| `save.ts` | Versioned serialization and structural/reference validation |

See [the simulation design](docs/SIMULATION.md) for units, economic assumptions, calibration, extension contracts, and limits. [The action reference](docs/ACTIONS.md) describes the future AI boundary.

## Verification

```sh
npm test                 # conservation, determinism, policy, saves, full mandates, stress and long-run tests
npm run build            # strict TypeScript check and production bundle
npm run calibrate        # 15 full-size runs: five policy scenarios × three seeds
npx playwright install chromium
npm run test:e2e         # browser playthrough, policy, selection, save/reload, mandate, mobile, invalid imports
```

Linux browser testing also requires Chromium's system libraries (`npx playwright install-deps chromium`). To use an existing Chromium installation, set `COMMONWEALTH_CHROME` to its executable path. These are testing requirements; the game itself runs in a normal browser.

The verified baseline across the three full-size calibration seeds finishes with 100% public-service funding, zero public debt, 99.7–99.8% food coverage, and 80.2–81.1% wellbeing. A separate test follows a 20-year baseline and a tiny perturbation; conditions settle instead of diverging. These are regression bounds for this fictional model, not a mathematical proof of global stability or a model of real-world policy.

## Scope

This is a substantial first playable core. Four broad industries share local labor; household and business cash are aggregated per mapxel. Food is one staple commodity, materials are an aggregate, and restaurants/shops are represented by a business-viability index. News and community quotes use transparent predefined templates. There are no separate firms, named individual citizens, parliamentary factions, diplomacy, real AI calls, or multiplayer yet. The action and rule interfaces are intended to support further depth without coupling it to the browser interface.
