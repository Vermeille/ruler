# Emergent behavior micro-simulations

This document records what the simulation actually did when each new emergent-pressure behavior was given one controlled nudge. These are small matched experiments, not calibration targets or claims about every future run.

## Protocol

Each experiment uses a deterministic 12×12 Commonwealth with the same seed for a baseline and nudged run. Ordinary simulation rules remain active, but the unrelated stochastic story-event rules are disabled so a festival, drought, or violent-crime draw cannot obscure the comparison. The nudge is applied only to the nudged copy, then both copies advance for the stated number of months.

Run the probes with:

```sh
npm run simulate:emergence
```

CI runs the same command and archives the raw JSON output. The observations below are from the run on commit `405f9a65987cd95362bdf714044ec8576448ec35` on 24 September 2026.

The useful thing to look for is not merely whether the new state variable moved. Each section records at least one downstream response, and when another feedback loop counteracted the nudge that is recorded too. A feedback system that always obeys our preferred story would be suspiciously well behaved.

## UNREST-MOBILIZATION1

**Nudge:** in the largest city, reduce group approval and wellbeing and give residents a sharply negative outlook. Run for 6 months.

| Measure | Baseline | Nudged | Delta |
| --- | ---: | ---: | ---: |
| focal visible unrest | 0.000000 | 0.096367 | +0.096367 |
| neighboring visible unrest | 0.000000 | 0.000000 | 0.000000 |
| focal approval | 0.609832 | 0.407826 | -0.202006 |

**Observed reaction:** the local grievance crossed the mobilization threshold and became visible unrest. The neighboring place did not mobilize merely because unrest existed next door: neighboring mobilization is an amplifier for communities with their own grievance, not a magical contagion switch. The nudge therefore created a local political problem without automatically manufacturing a national protest wave.

**Ripple path:** hardship + low approval + pessimism → latent mobilization → visible unrest projection. Nearby mobilization becomes an input to later months, but this particular matched neighbor never accumulated enough grievance to activate it.

## SERVICE-OVERLOAD1

**Nudge:** cut staffed health and education capacity in the largest city to 48% of the matched baseline. Run for 6 months.

| Measure | Baseline | Nudged | Delta |
| --- | ---: | ---: | ---: |
| health access | 0.705096 | 0.613592 | -0.091503 |
| education access | 0.619305 | 0.568013 | -0.051293 |
| health disruption | 0.000124 | 0.399698 | +0.399574 |
| education disruption | 0.004213 | 0.517038 | +0.512825 |

**Observed reaction:** capacity scarcity did not merely set a lower service number. Utilization generated large temporary disruptions, which then further reduced effective health and education access. Funded capacity was simultaneously adapting upward, so the city was already trying to recover while the disruption was still worsening lived service quality.

**Ripple path:** inadequate capacity → utilization above capacity → temporary disruption → lower effective access → worse resident experience. Meanwhile funded provision → gradual capacity expansion, creating a delayed stabilizing loop.

## EPIDEMIC-SPREAD1

**Nudge:** seed a 28% infection load across resident groups in the largest city. Run for 6 months.

| Measure | Baseline | Nudged | Delta |
| --- | ---: | ---: | ---: |
| focal infection | 0.004804 | 0.170027 | +0.165222 |
| neighboring infection | 0.004324 | 0.009733 | +0.005409 |
| focal resident health | 0.700417 | 0.689569 | -0.010848 |
| health disruption | 0.000110 | 0.045722 | +0.045611 |

**Observed reaction:** infection remained materially elevated in the seeded city, leaked into its neighbor, reduced resident health, and created enough additional health demand to produce measurable health-system disruption. The health-system response therefore became part of the epidemic dynamics rather than a separate scripted penalty.

**Ripple path:** infected residents → local and neighboring exposure → more infection → worse human health + higher health demand → service strain → weaker effective health access → slower recovery pressure.

## CRISIS-DISPLACEMENT1

**Nudge:** combine severe food insecurity, water stress, and health disruption in one large city on a month outside the ordinary quarterly migration cadence. Run for 2 months.

| Measure | Baseline | Nudged | Delta |
| --- | ---: | ---: | ---: |
| source population change | -1.855585 | -36.836360 | -34.980775 |
| neighboring population | 1245.261636 | 1280.241833 | +34.980197 |
| source outlook | 0.030770 | 0.029760 | -0.001011 |

**Observed reaction:** the source lost about 35 additional residents and the neighboring destination gained almost exactly the same mass. This happened outside ordinary quarterly migration, showing that extreme conditions can override the normal cadence while still moving actual population groups rather than editing a population scalar. The receiving place now carries the extra demand into service, employment, disease, crime, and later migration rules.

**Ripple path:** severe local deprivation → displacement pressure → exceptional migration → receiving-place population load → downstream service and social pressures. The migration remains population-conserving.

## REGIONAL-DIVERGENCE1

**Nudge:** reduce resident wellbeing throughout one region by 0.16 while leaving the rest of the country matched. Run for 5 months.

| Measure | Baseline | Nudged | Delta |
| --- | ---: | ---: | ---: |
| regional approval | 0.605676 | 0.581101 | -0.024576 |
| regional outlook | 0.049936 | 0.097149 | +0.047213 |
| regional mobilization | 0.000000 | 0.000000 | 0.000000 |

**Observed reaction:** relative disadvantage lowered approval, but outlook became *more positive*, not more negative. The reason is a useful cross-loop result: the one-time wellbeing loss made the region fall behind, while subsequent monthly recovery gave residents a positive direction-of-travel signal. Relative comparison said “we are worse off than the country”; expectations said “things are improving.” Approval remained lower, but grievance never crossed the mobilization threshold in this run.

**Ripple path:** regional lag → relative political grievance → lower approval, while recovery → positive outlook. Those two signals coexist rather than one mechanic overwriting the other.

## POLICY-SHOCK1

**Nudge:** abruptly raise income tax to 62% and health spending to 1.25 crowns per resident-month. Observe the initial response and run for 4 months.

| Measure | Baseline | Nudged | Delta |
| --- | ---: | ---: | ---: |
| initial policy adjustment | 0.000000 | 0.371099 | +0.371099 |
| adjustment after 4 months | 0.000000 | 0.061742 | +0.061742 |
| outlook after 4 months | 0.048184 | 0.023594 | -0.024589 |
| approval after 4 months | 0.602982 | 0.582553 | -0.020429 |

**Observed reaction:** the abrupt regime change generated a large short-lived adjustment pressure. Four months later most of that pressure had faded as places adapted to the new regime, while outlook and approval remained modestly lower. The adjustment mechanic itself does not invent material economic damage; taxes and health spending still propagate through their ordinary rules.

**Ripple path:** abrupt policy change → temporary adjustment pressure → archetype-weighted uncertainty → lower outlook/approval → possible migration/mobilization consequences, while the underlying policy separately changes finances and services.

## EXPECTATIONS1

**Nudge:** give one city a simultaneous food-price and health-access deterioration while leaving resident outlook untouched initially. Run for 3 months.

| Measure | Baseline | Nudged | Delta |
| --- | ---: | ---: | ---: |
| outlook | 0.037975 | 0.019241 | -0.018733 |
| approval | 0.597852 | 0.596641 | -0.001211 |
| mobilization | 0.000000 | 0.000000 | 0.000000 |

**Observed reaction:** residents remembered the deterioration as a weaker outlook even after only three months. Approval moved only slightly and mobilization stayed inactive, which is intentional: worsening direction is a pressure, not a guaranteed political crisis. That stored outlook remains available to migration, fertility, approval, and later mobilization decisions.

**Ripple path:** deteriorating lived conditions → negative trend signal → slower outlook memory → small approval pressure and higher future migration/mobilization pressure. In this run the political threshold was not crossed.

## PUBLIC-SALIENCE1

**Nudge:** raise local crime to 0.68 without directly changing any group need weights. Run for 5 months.

| Measure | Baseline | Nudged | Delta |
| --- | ---: | ---: | ---: |
| safety salience | 1.041474 | 1.187848 | +0.146374 |
| approval | 0.604187 | 0.600298 | -0.003889 |
| population change | -4.386347 | -27.311650 | -22.925302 |

**Observed reaction:** residents temporarily paid substantially more attention to safety. The direct approval effect was modest, but migration reacted much more strongly: the city lost about 23 additional residents over five months. Salience therefore changed how an existing condition was interpreted instead of acting as another generic happiness penalty.

**Ripple path:** crime → higher safety salience → safety weighs more heavily in lived/migration evaluation → stronger out-migration → changed local and destination population composition/load.

## CASCADE-FAILURE1

**Nudge:** push a large city well beyond health and education capacity while degrading its infrastructure. Run for 7 months.

| Measure | Baseline | Nudged | Delta |
| --- | ---: | ---: | ---: |
| health disruption | 0.000095 | 0.552518 | +0.552423 |
| education disruption | 0.004135 | 0.582162 | +0.578027 |
| infrastructure disruption | 0.000000 | 0.005486 | +0.005486 |
| health access | 0.707914 | 0.570289 | -0.137625 |
| outlook | 0.059028 | 0.047133 | -0.011894 |

**Observed reaction:** overloaded health and education systems crossed into large temporary disruptions and effective health access fell by almost 0.14. Infrastructure degradation produced only a small disruption in this protocol, so the model did **not** pretend that every stressed subsystem failed equally. Residents subsequently developed a weaker outlook.

**Ripple path:** severe utilization → nonlinear failure risk → service disruption → lower effective access → worse lived trajectory/outlook → migration and political pressure. Funding and spare capacity create the recovery loop.

## DISTRIBUTIONAL-REACTION1

**Nudge:** impoverish one locally common archetype while leaving its local peers and neighboring residents unchanged. Run for 5 months.

| Measure | Baseline | Nudged | Delta |
| --- | ---: | ---: | ---: |
| target approval gap vs peers | +0.003152 | -0.030517 | -0.033669 |
| target mobilization gap vs peers | 0.000000 | +0.000232 | +0.000232 |
| target outlook | 0.062012 | 0.123304 | +0.061292 |

**Observed reaction:** the disadvantaged group became clearly less approving than its local peers, but its outlook became much more positive because the one-time impoverishment was followed by recovery. Mobilization rose only fractionally. This is another useful conflict between feedback loops: relative outcomes created political grievance while direction-of-travel created optimism, so the simulation did not collapse both concepts into one mood variable.

**Ripple path:** unequal lived outcome → peer-relative grievance → lower relative approval, while recovery → positive expectations. Only if the combined grievance becomes strong enough does this feed substantial mobilization.

## What these probes tell us

The ten mechanics do not behave like ten independent crisis buttons. The matched experiments already show several coupled loops:

- service overload worsens access, but funded capacity simultaneously adapts;
- epidemic pressure reaches health-system disruption rather than stopping at infection;
- crisis migration exports the original problem as receiving-place population load;
- salience can produce a much larger migration response than approval response;
- regional and distributional disadvantage can lower approval while recovery raises outlook;
- unrest does not automatically spread into contented neighbors merely because they are adjacent;
- nonlinear cascade failure can be severe in one overloaded subsystem while another remains mostly functional.

Those countervailing responses are intentional. The player should encounter situations produced by several loops pulling in different directions, not a collection of deterministic event cards disguised as equations.
