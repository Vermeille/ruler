export const POPULATION_COHORT_QUANTUM = 1;

/**
 * Turn a continuous expected flow into a representable cohort amount without biasing its
 * expectation. Population counts are measured in people, so independently tracked discrete
 * choices use one person as their normal resolution. Tiny source groups can still move whole.
 * The supplied draw keeps the engine fully deterministic under its keyed random stream.
 */
export function quantizeCohortFlow(
  desired: number,
  sourceCount: number,
  draw: number,
  quantum = POPULATION_COHORT_QUANTUM,
): number {
  if (!Number.isFinite(desired) || !Number.isFinite(sourceCount) || !Number.isFinite(draw)
    || !Number.isFinite(quantum) || desired < 0 || sourceCount < 0 || draw < 0 || draw >= 1 || quantum <= 0) {
    throw new Error('Invalid population cohort flow.');
  }
  if (desired === 0 || sourceCount === 0) return 0;

  const capped = Math.min(desired, sourceCount);
  const unit = Math.min(quantum, sourceCount);
  const exactUnits = capped / unit;
  const wholeUnits = Math.floor(exactUnits);
  const remainder = exactUnits - wholeUnits;
  const roundedUnits = wholeUnits + (draw < remainder ? 1 : 0);
  return Math.min(sourceCount, roundedUnits * unit);
}
