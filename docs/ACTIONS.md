# Government actions and the AI boundary

The simulation accepts data, never generated JavaScript. `parseCommand` is a convenience parser. `validateAction` is the authoritative boundary for both the parser and future model output. `previewActions` validates a package and estimates its immediate fiscal impact. `enact` returns a new game atomically; an invalid or unaffordable package changes nothing.

## Console DSL

```text
tax income 0.28
tax business 0.18
spend health 0.40
spend police 0.35
wage minimum 4
subsidize sports 1.50 in selected
subsidize agriculture 0.50 in region 1
subsidize sports 0 in national
invest transport 10000 in region 1
invest hospital 5000 in selected
law cleanAir on
law freeMovement off
law publicAssembly on
law foodPriceControls on
```

Commands accept exactly the documented arguments. Rates are fractions, not percentages. Omit the scope to default to national. Region IDs are zero-based: Northreach 0, The Greenbelt 1, Eastmere 2, Southbank 3. `selected` resolves to a fixed, explicit list of land mapxel IDs at submission time.

| Action | Fields | Bounds and semantics |
| --- | --- | --- |
| `tax` | `tax: incomeTax \| businessTax`, `rate` | 0–0.65, national |
| `minimumWage` | `amount` | 0–10 crowns / worker / month, national; 0 removes the floor |
| `spending` | `service`, `amount` | 0–2 crowns / resident / month, national |
| `subsidy` | `sector`, `amount`, `scope` | 0–3 crowns / sector worker / month |
| `law` | `law`, `enabled` | A supported law and a boolean |
| `invest` | `project`, `amount`, `scope` | 1–1e9 crowns, limited by current treasury |

Services: `health`, `education`, `police`, `infrastructure`, `welfare`, `culture`, `environment`.

Sectors: `agriculture`, `manufacturing`, `services`, `sports`.

Projects: `transport`, `hospital`, `school`, `stadium`.

Laws: `cleanAir`, `freeMovement`, `publicAssembly`, `foodPriceControls`.

Scopes:

```json
{"kind":"national"}
{"kind":"region","id":1}
{"kind":"cells","ids":[450,451]}
```

Cell IDs must exist, be distinct, and refer to land in the current world. A local subsidy overrides the national rate for its sector. Overlapping local grants use the most recently enacted rate. A new national grant clears all local overrides for that sector. An amount of zero removes support. This prevents accidental subsidy stacking.

## Atomic JSON packages

The console accepts a single action or an array of up to 20 actions:

```json
[
  {"type":"tax","tax":"incomeTax","rate":0.35},
  {"type":"spending","service":"health","amount":0.6},
  {"type":"subsidy","sector":"sports","amount":1.5,"scope":{"kind":"region","id":1}},
  {"type":"law","law":"cleanAir","enabled":true}
]
```

Unknown keys, unknown actions, out-of-range or non-finite amounts, invalid scopes, and unaffordable investments are rejected. Packages are checked in full before mutation. Policy decisions receive immutable causal IDs and enter the action log and press archive. They do not advance time.

## Future language-model integration

1. Give the translator the `Action` discriminated union, allowed services/sectors/laws, selected IDs, current policy, and a summarized world state.
2. Have it propose JSON actions, with prose presented separately.
3. Pass the **untrusted** result through `previewActions(game, result)`; show the accepted actions and cost estimate to the player.
4. After the player chooses to enact them, call `enact(game, acceptedActions)`.
5. Generate optional narrative wording from existing `Article`, `Cause`, and `MandateReport` records. Keep cause IDs attached; do not let wording invent or mutate events.

The AI layer should have no direct write access to model state, no arbitrary evaluation, and no control over RNG. New mechanics belong in explicit rule/action extensions, not in free-form model-written code. The existing non-AI UI uses this same validation and preview path.
