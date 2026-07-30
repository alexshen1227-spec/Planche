import { STEPS } from '../data/progressions'

export const STANDARD_LEAD_IN_SEC = 5
export const PROGRESSION_LEAD_IN_SEC = 8
export const PROGRESSION_STOP_LATENCY_SEC = 5

/**
 * The eight skills on the Path are the main progression line. Planche Lean is
 * deliberately excluded from the slower phone setup: it is easy to walk out
 * of under control and the athlete asked to keep its existing timing.
 */
const MAIN_PROGRESSION_HOLDS = new Set(
  STEPS.map((step) => step.keyExerciseId).filter((exerciseId) => exerciseId !== 'planche-lean'),
)

export function isMainProgressionHold(exerciseId: string | undefined): boolean {
  return Boolean(exerciseId && MAIN_PROGRESSION_HOLDS.has(exerciseId))
}

export function leadInSecondsFor(exerciseId: string | undefined): number {
  return isMainProgressionHold(exerciseId) ? PROGRESSION_LEAD_IN_SEC : STANDARD_LEAD_IN_SEC
}

export function stopLatencySecondsFor(
  exerciseId: string | undefined,
  calibratedLatencySec: number,
): number {
  return isMainProgressionHold(exerciseId)
    ? PROGRESSION_STOP_LATENCY_SEC
    : Math.max(0, calibratedLatencySec)
}
