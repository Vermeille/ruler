---
name: commonwealth-city
description: Orient to and work on the Commonwealth City project, a playable policy simulator. Use for gameplay, simulation design, architecture, rule, metric, or code questions in this repository.
---

# Commonwealth City

Use this skill for work in this repository's fictional city and economy simulation. For onboarding, broad design questions, or an unfamiliar subsystem, first read [the 10-minute project orientation](references/project-orientation.md). Treat the checked-out code as authoritative when behavior and prose differ; verify current source before relying on this context.

## Project map

- `src/sim/rules.ts`: default rule registry; implementations are split across `rules/economy.ts`, `rules/state.ts`, `rules/society.ts`, and `rules/events.ts`.
- `src/sim/policy.ts`: action validation, policy mutation, subsidy precedence, budget forecasting, and investment effects.
- `src/sim/engine.ts`: phase ordering, effect settlement, model invariants, and tick execution.
- `src/sim/math.ts`: deterministic keyed randomness and national summary calculations.
- `src/sim/world.ts`: initial world, policy, and cell values.
- `src/sim/types.ts`: state, metric, action, phase, and effect types.
- `src/ui/map.ts`: map drawing, data layers, selection, and neighbor-link display.
- `src/ui/storage.ts`: IndexedDB autosave storage.
- `src/App.vue` and `src/components/`: browser views and policy controls; `src/composables/useGame.ts` owns playback, selection, and autosave.
- `src/dev/`: optional developer workbench, traces, and causal rule analysis.
- `src/sim/narrative.ts`: generated news, evidence traversal, and end-of-mandate report.
- `src/sim/save.ts`: versioned JSON save validation and import/export support.
- `docs/RULES.md`: reader-facing rule and metric reference. Keep it synchronized with source when mechanics change.
- `docs/ACTIONS.md`: action interface and AI boundary; check it when changing action syntax or validation.
- `docs/SIMULATION.md`: design rationale, calibration notes, extension guidance, and model limitations.

Read the specific source and tests relevant to a requested change. Do not treat documentation examples or calibration results as proof of mechanics when the implementation can be checked directly.

For gameplay or broad simulation design questions, explain both the player's decisions and the downstream system response; the main gameplay is observing local and national trade-offs across a finite mandate, not maximizing one standalone score.

## Mathematical conventions

- One tick is one month. Population is continuous, food is in resident-month units, money is fictional crowns, and `output` is abstract activity rather than cash.
- The UI's household wellbeing is the `happiness` metric; there is no separate composite wellbeing field. National cell indicators are population-weighted means. `wealth` is total private cash divided by population; national output and food are totals.
- Keep projected budget values distinct from realized collections. The forecast uses output-based tax without the per-cell cash cap; actual taxation is capped by each cell's available cash.
- Phase rules read immutable phase-start snapshots. Settlement limits competing outgoing demands using starting balances; same-phase incoming resources cannot fund outgoing effects.
- Randomness is deterministic and keyed by seed, tick, rule ID, cell ID, and channel. Event probabilities and cooldowns are model rules, not guarantees of outcomes.
- For any equation, rate, bound, metric, or calibration claim, verify the exact implementation before editing prose. Mark observed calibration ranges as observations for specified runs, not universal guarantees.

## Working in this repository

Prefer explicit equations and defined units in rule documentation. When a mechanical change alters behavior, update `docs/RULES.md`; update `docs/ACTIONS.md` too when the action contract changes. Keep model simplifications and causal-reporting limits clear, and do not present journal links as counterfactual proof.

Use the narrowest useful verification for the requested code change. Available commands include `npm test`, `npm run build`, and `npm run calibrate`; calibration runs multiple scenarios and should be used when its evidence is relevant. Documentation-only edits do not require running the simulation.
