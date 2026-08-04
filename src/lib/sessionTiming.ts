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

/**
 * How much of a timed hold was not actually spent holding.
 *
 * Two different situations, and conflating them is what made this wrong:
 *
 * - A hold you stop yourself, phone in hand or within arm's reach, costs only
 *   reaction time. That is what the tap test in Settings measures, and it is
 *   what `calibratedLatencySec` carries.
 * - A main Path hold filmed side-on is normally stopped after climbing out of
 *   the position and walking back to a phone across the room. That gap is
 *   several seconds and has nothing to do with reflexes, so it gets its own
 *   fixed allowance rather than the calibrated one.
 *
 * The mistake was assuming the second case always applies to Path holds. An
 * athlete whose phone sits within reach — propped on a bench beside the
 * parallettes — was losing five seconds off every attempt for a walk they
 * never took, which at the tuck planche's 20s bar is a quarter of the
 * requirement, and silently logs any attempt under five seconds as zero.
 *
 * `phoneWithinReach` is deliberately a factual question about the setup rather
 * than a tunable number: a dial whose only effect is enlarging your own records
 * is an invitation, while "do you have to get up to stop it?" has a true
 * answer. It defaults to false, which under-credits rather than inventing time.
 */
export function stopLatencySecondsFor(
  exerciseId: string | undefined,
  calibratedLatencySec: number,
  phoneWithinReach = false,
): number {
  const calibrated = Math.max(0, calibratedLatencySec)
  if (!isMainProgressionHold(exerciseId)) return calibrated
  // Never charge less than the reaction time that applies either way.
  return phoneWithinReach ? calibrated : Math.max(PROGRESSION_STOP_LATENCY_SEC, calibrated)
}

/** Credit a stopwatch reading against one concrete stop setup. */
export function creditedHoldSeconds(
  rawSeconds: number,
  exerciseId: string | undefined,
  calibratedLatencySec: number,
  phoneWithinReach = false,
): number {
  return Math.max(
    0,
    Math.round(
      (rawSeconds - stopLatencySecondsFor(exerciseId, calibratedLatencySec, phoneWithinReach)) * 10,
    ) / 10,
  )
}

/**
 * The two values a Path hold can land on when the athlete corrects whether
 * they walked back to the phone.
 *
 * `delta` is derived from the credited values, not from the two latency
 * constants. That distinction matters for short attempts: a 3.2s stopwatch
 * reading changes from 0.0s to 0.9s, so promising "+2.7s" would contradict
 * the number the tap actually produces.
 */
export function stopSetupCredits(
  rawSeconds: number,
  exerciseId: string | undefined,
  calibratedLatencySec: number,
): { walkedBack: number; withinReach: number; delta: number } {
  const walkedBack = creditedHoldSeconds(rawSeconds, exerciseId, calibratedLatencySec, false)
  const withinReach = creditedHoldSeconds(rawSeconds, exerciseId, calibratedLatencySec, true)
  return {
    walkedBack,
    withinReach,
    delta: Math.round(Math.abs(withinReach - walkedBack) * 10) / 10,
  }
}
