import type { AppState, Session, StepId } from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { STEP_BY_ID } from '../data/progressions'
import { addDays, weekStart } from './time'
import { median } from './signals'
import { qualifyingSeries } from './forecast'

/**
 * How hard a position actually is, and how fast the load on it is climbing.
 *
 * Two things this app was getting wrong, both invisible without doing the
 * mechanics:
 *
 * 1. **A progression name is not a difficulty.** In a balanced planche the
 *    shoulder torque is (bodyweight − arms) × the horizontal distance from
 *    shoulder to the centre of mass of everything it supports. That distance
 *    is set by hip and knee angle, not by the label on the exercise. An
 *    "advanced tuck" spans roughly 72%–92% of full-planche load depending on
 *    how open the hips are, and a straddle swings about ten points on leg
 *    width alone. So a weekly volume chart that adds thirty seconds of planche
 *    lean to six seconds of advanced tuck is summing two different quantities,
 *    and a hold time that improves because the legs opened wider is not
 *    progress.
 *
 * 2. **Capability outruns the tissue that carries it.** Tendon collagen turns
 *    over roughly an order of magnitude slower than muscle protein, and
 *    measured strength gains have preceded tendon stiffness changes by one to
 *    two months. The usual app instinct — got stronger, add volume — is
 *    exactly wrong in the window where it matters most.
 *
 * Evidence note: the lever fractions below are INFERENCE from a rigid-body
 * model with standard segment parameters, not measurements of anyone. They are
 * used only to compare like with like and to notice drift — never to grade an
 * athlete or to claim a precise load. Where the model and a label disagree,
 * this module reports uncertainty rather than a number.
 */

/**
 * Shoulder torque as a fraction of the same athlete's full planche, by
 * position. Derived from the horizontal shoulder-to-centre-of-mass distance
 * for each shape using standard anthropometric segment masses.
 *
 * Deliberately a coarse table rather than a live per-frame calculation: the
 * camera measures hip angle with a few degrees of error, and pretending to
 * resolve a 3% load difference from that would be exactly the false precision
 * this app refuses everywhere else.
 */
export const LEVER_FRACTION: Record<string, number> = {
  'ppp-hold': 0.2,
  'planche-lean': 0.35,
  // A bent-arm balance drill, not a straight-arm position. Kept low and
  // flagged elsewhere so it is never summed as planche load.
  'frog-stand': 0.15,
  'tuck-planche': 0.54,
  'adv-tuck-planche': 0.72,
  'one-leg-planche': 0.8,
  'band-straddle-planche': 0.6,
  'straddle-planche': 0.91,
  'full-planche': 1,
}

/** Positions whose difficulty genuinely moves with a joint angle we can see. */
const HIP_SENSITIVE = new Set(['adv-tuck-planche', 'straddle-planche', 'one-leg-planche'])

/**
 * Refine a position's lever fraction using the hip angle the camera measured.
 *
 * Only for the shapes where hip angle is the actual dial, and only within the
 * range the label can plausibly cover — a reading that lands outside it is far
 * more likely to be a bad frame than a genuinely exotic position.
 */
export function leverFractionFor(exerciseId: string, hipAngleDeg?: number): number {
  const base = LEVER_FRACTION[exerciseId] ?? 0
  if (hipAngleDeg === undefined || !HIP_SENSITIVE.has(exerciseId)) return base
  if (exerciseId === 'adv-tuck-planche') {
    // Thighs perpendicular to the torso (~90°) up to in line with it (~180°).
    const t = clamp01((hipAngleDeg - 90) / 90)
    return 0.72 + t * 0.2
  }
  if (exerciseId === 'straddle-planche') {
    // A piked straddle is easier than a flat one; hips open toward 180°.
    const t = clamp01((hipAngleDeg - 135) / 45)
    return 0.85 + t * 0.08
  }
  return base
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/**
 * Planche-equivalent seconds: hold time weighted by how hard the position is.
 *
 * This is the unit the volume rails below use, because raw seconds are not
 * comparable across the road and adding them up produces a number that falls
 * as an athlete gets stronger (harder positions are held for less time).
 */
export function weightedHoldSeconds(session: Session): number {
  let total = 0
  for (const set of session.sets) {
    if (set.kind !== 'hold' || set.value <= 0) continue
    const fraction = leverFractionFor(set.exerciseId, set.form?.auto?.hipAngleDeg)
    if (fraction <= 0) continue
    total += set.value * fraction
  }
  return total
}

export interface WeeklyLoad {
  weekStart: number
  /** Lever-weighted planche seconds in that week. */
  weightedSec: number
}

/** Trailing weekly planche load, oldest first, including empty weeks. */
export function weeklyLoads(state: Pick<AppState, 'sessions'>, weeks = 8, now = Date.now()): WeeklyLoad[] {
  const out: WeeklyLoad[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    out.push({ weekStart: addDays(weekStart(now), -7 * i), weightedSec: 0 })
  }
  for (const s of state.sessions) {
    const idx = out.findIndex((w) => s.startedAt >= w.weekStart && s.startedAt < addDays(w.weekStart, 7))
    if (idx === -1) continue
    out[idx].weightedSec += weightedHoldSeconds(s)
  }
  for (const w of out) w.weightedSec = Math.round(w.weightedSec)
  return out
}

/**
 * Fastest weekly increase in planche-specific load this app will encourage.
 *
 * INFERENCE, and labelled as such wherever it reaches an athlete. It is a
 * conservative reading of the tendon-lag literature rather than a measured
 * threshold, and the acute:chronic ratio it resembles has been substantively
 * criticised. It exists because the alternative — no ceiling at all — is how
 * a strong newcomer earns a tendon problem in their second month.
 */
export const MAX_WEEKLY_LOAD_RAMP = 1.2

export interface LoadRamp {
  /** Completed last week, lever-weighted. */
  lastWeekSec: number
  /** Typical of the four weeks before that. */
  baselineSec: number
  ratio: number
  /** True when last week already ran hot against the athlete's own normal. */
  rampingFast: boolean
}

export function readLoadRamp(state: Pick<AppState, 'sessions'>, now = Date.now()): LoadRamp | null {
  const weeks = weeklyLoads(state, 6, now)
  // Drop the current, partial week — comparing three days against seven full
  // ones would report every Tuesday as a dramatic drop in training.
  const complete = weeks.slice(0, -1)
  if (complete.length < 3) return null
  const lastWeek = complete[complete.length - 1]
  const prior = complete.slice(0, -1).map((w) => w.weightedSec).filter((s) => s > 0)
  if (prior.length < 2) return null
  const baseline = median(prior)
  if (baseline === null || baseline < 30) return null
  const ratio = lastWeek.weightedSec / baseline
  return {
    lastWeekSec: lastWeek.weightedSec,
    baselineSec: Math.round(baseline),
    ratio,
    rampingFast: ratio > MAX_WEEKLY_LOAD_RAMP,
  }
}

/**
 * A recent, unusually large gain in what the athlete can hold.
 *
 * Reported so the planner can do the counter-intuitive thing and *hold volume
 * steady*: the muscle that produced the jump has adapted, and the tendon
 * carrying it has not yet. Measured on verified holds only, because an
 * unverified spike is far more likely to be a measurement than a gain.
 */
export interface CapabilityJump {
  fromSec: number
  toSec: number
  gainPct: number
}

/** Below this a gain is ordinary progress and needs no special handling. */
export const CAPABILITY_JUMP_PCT = 0.35

export function readCapabilityJump(
  state: AppState,
  stepId: StepId = state.stepId,
  now = Date.now(),
): CapabilityJump | null {
  const series = qualifyingSeries(state, stepId)
  if (series.length < 4) return null
  const recent = series.filter((p) => now - p.at <= 14 * 86_400_000)
  const earlier = series.filter((p) => now - p.at > 14 * 86_400_000)
  if (recent.length === 0 || earlier.length < 3) return null
  const before = median(earlier.slice(-4).map((p) => p.value))
  const after = Math.max(...recent.map((p) => p.value))
  if (before === null || before <= 0) return null
  const gainPct = (after - before) / before
  if (gainPct < CAPABILITY_JUMP_PCT) return null
  return { fromSec: Math.round(before * 10) / 10, toSec: Math.round(after * 10) / 10, gainPct }
}

/**
 * Whether recent holds on a step are being performed at an easier position
 * than earlier ones — improvement that came from the shape, not the strength.
 *
 * The honest failure this catches: a straddle planche logged at twelve seconds
 * where it used to be eight, because the legs are now wider. The stopwatch
 * says progress and the athlete is standing still.
 */
export interface DifficultyDrift {
  earlierFraction: number
  recentFraction: number
  /** Negative means the position got easier. */
  deltaPct: number
}

/** Camera hip-angle error means anything under this is not worth reporting. */
export const DRIFT_REPORT_PCT = 0.06

export function readDifficultyDrift(
  state: AppState,
  stepId: StepId = state.stepId,
  now = Date.now(),
): DifficultyDrift | null {
  const step = STEP_BY_ID[stepId]
  if (!step || !HIP_SENSITIVE.has(step.keyExerciseId)) return null

  const graded: { at: number; fraction: number }[] = []
  for (const s of state.sessions) {
    for (const set of s.sets) {
      const hip = set.form?.auto?.hipAngleDeg
      if (set.exerciseId !== step.keyExerciseId || set.section !== 'main' || hip === undefined) continue
      graded.push({ at: set.at, fraction: leverFractionFor(set.exerciseId, hip) })
    }
  }
  if (graded.length < 6) return null
  graded.sort((a, b) => a.at - b.at)
  const recent = graded.filter((g) => now - g.at <= 21 * 86_400_000)
  const earlier = graded.filter((g) => now - g.at > 21 * 86_400_000)
  if (recent.length < 3 || earlier.length < 3) return null
  const recentFraction = median(recent.map((g) => g.fraction))
  const earlierFraction = median(earlier.map((g) => g.fraction))
  if (recentFraction === null || earlierFraction === null || earlierFraction <= 0) return null
  const deltaPct = (recentFraction - earlierFraction) / earlierFraction
  if (Math.abs(deltaPct) < DRIFT_REPORT_PCT) return null
  return { earlierFraction, recentFraction, deltaPct }
}

/** Whether two exercises are close enough in load to compare hold times. */
export function comparableLoad(a: string, b: string): boolean {
  const fa = LEVER_FRACTION[a]
  const fb = LEVER_FRACTION[b]
  if (fa === undefined || fb === undefined) return false
  return Math.abs(fa - fb) <= 0.06
}

/** Positions that are not straight-arm planche work, whatever the road says. */
export function isStraightArmPlanche(exerciseId: string): boolean {
  const ex = EXERCISE_BY_ID[exerciseId]
  return ex?.category === 'planche' && exerciseId !== 'frog-stand'
}
