import type { Block, Workout } from '../types'
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

/** Coming down after the call takes about this long before the walk to the phone begins. */
export const TARGET_CALL_GRACE_SEC = 1

/**
 * Whether a hold was stopped at its target call: the call sounded (the time
 * held reached the target) and the stop came within the stop allowance of it.
 * The athlete was told to come down at the call; the walk back then took at
 * most about the allowance. Such a hold reached its target — however the fixed
 * allowance happens to land the logged value.
 */
export function stoppedAtTargetCall(rawStopSec: number, targetSec: number, allowanceSec: number): boolean {
  return targetSec > 0 && rawStopSec >= targetSec && rawStopSec - targetSec <= Math.max(0, allowanceSec) + TARGET_CALL_GRACE_SEC
}

/**
 * Whether stopping near the call says the athlete came down at it.
 *
 * Working sets and accessories sit well inside capacity, so coming down at the
 * call is what happens. Maximal efforts — unlock and next-shape attempts, max
 * tests, the minimum dose — fail before the target as a matter of course, and
 * the timer runs on through the walk back, so the call can sound after the
 * athlete is already down: a stop near it proves nothing there.
 */
export function callMarksCompliance(block: Pick<Block, 'role'>, workoutKind: Workout['kind']): boolean {
  return block.role !== 'attempt' && block.role !== 'bridge' && workoutKind !== 'test' && workoutKind !== 'micro'
}

/** What the hold screen says while the athlete is still in position. */
export interface HoldCues {
  /** Time actually held so far — the stopwatch since Go. */
  heldSec: number
  /** Progress toward the target on the clock the call uses (for the ring). */
  towardSec: number
  /** The target has been held: time to stop while clean. */
  targetReached: boolean
  /** A new best even after the stop allowance comes off — never celebrated early. */
  pr: boolean
}

/**
 * Cues for a hold in progress.
 *
 * The stop allowance (reaction, or the walk back to the phone) happens after
 * the hold ends, so it comes off the logged value — never off the cues an
 * athlete in position is listening for. Taking it off the cues too made the
 * "Target" call and the spoken counts arrive five seconds late for anyone
 * whose phone is across the room: a working set meant to stop well short of
 * the max ran on until the athlete had held five seconds more, which for a
 * twelve-second athlete with a seven-second target is the whole twelve. That
 * happened when the walk-back allowance arrived; the cues had been written for
 * a reaction delay of a few tenths.
 *
 * A record is the exception: it is only announced once the logged value would
 * stand, so walking time can never be celebrated as a PR.
 */
export function holdCues(
  rawElapsedSec: number,
  allowanceSec: number,
  targetSec: number,
  bestSec: number | undefined,
  /**
   * The target is a bar the *logged* value must reach — an unlock attempt or a
   * max test. There the call means "banked": it comes once the time held, less
   * the stop allowance, reaches the bar. Called on time held instead, an
   * athlete who came down at it and walked back in 3s logged 18s of a 20s bar
   * they had held, and the unlock failed.
   */
  banking = false,
): HoldCues {
  const heldSec = Math.max(0, rawElapsedSec)
  const toward = banking ? heldSec - Math.max(0, allowanceSec) : heldSec
  return {
    heldSec,
    towardSec: Math.max(0, toward),
    targetReached: targetSec > 0 && toward >= targetSec,
    pr: bestSec !== undefined && heldSec - Math.max(0, allowanceSec) > bestSec,
  }
}
