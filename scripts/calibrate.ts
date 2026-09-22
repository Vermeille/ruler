import { createGame } from '../src/sim/world';
import { step } from '../src/sim/engine';
import { enact } from '../src/sim/policy';
import { summarize } from '../src/sim/math';
import type { Action } from '../src/sim/types';
const scenarios: Record<string, Action[]> = {
  baseline: [],
  'sports boom': [{ type: 'subsidy', sector: 'sports', amount: 3, scope: { kind: 'national' } }],
  'no police': [{ type: 'spending', service: 'police', amount: 0 }, { type: 'spending', service: 'welfare', amount: 0 }],
  'public investment': [{ type: 'tax', tax: 'incomeTax', rate: .3 }, { type: 'spending', service: 'health', amount: .6 }, { type: 'spending', service: 'education', amount: .45 }],
  'fiscal stress': [{ type: 'tax', tax: 'incomeTax', rate: 0 }, { type: 'tax', tax: 'businessTax', rate: 0 }, { type: 'spending', service: 'culture', amount: 2 }],
};
for (const seed of ['alder-42', 'marlow', 'greenbelt']) for (const [scenario, actions] of Object.entries(scenarios)) {
  let game = createGame(seed); if (actions.length) game = enact(game, actions);
  let worstFood = 1, biggestSwing = 0, previous = .65;
  for (let i = 0; i < 48; i++) {
    game = step(game); const s = summarize(game.model); worstFood = Math.min(worstFood, s.foodSecurity); biggestSwing = Math.max(biggestSwing, Math.abs(s.happiness - previous)); previous = s.happiness;
  }
  const s = summarize(game.model);
  console.log(JSON.stringify({ seed, scenario, approval: +s.approval.toFixed(3), happiness: +s.happiness.toFixed(3), health: +s.health.toFixed(3), crime: +s.crime.toFixed(3), wealth: +s.wealth.toFixed(2), food: +s.foodSecurity.toFixed(3), worstFood: +worstFood.toFixed(3), debtPerResident: +(s.debt / s.population).toFixed(2), funding: +game.model.budget.funding.toFixed(3), biggestSwing: +biggestSwing.toFixed(4), causes: game.causes.length }));
}
