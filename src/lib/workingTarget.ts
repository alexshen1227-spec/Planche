import type { AppState, StepDef, StepId } from '../types'
import { STEP_BY_ID } from '../data/progressions'
import { defaultSurface } from '../data/equipment'
import { completedBaseTarget, learningSeries, measuredLevel, qualifyingProgress } from './progression'
import { capacityOn } from './bridge'
import { median } from './signals'

/**
 * The key hold's working target, in one place for the session that prescribes
 * it and the coach that explains it. They once computed it apart: the coach
 * said "nudging the target up 7%" from its factor alone, and at a five-second
 * target that is a third of a second — rounded away, so the athlete read the
 * promise beside the same 5s, session after session.
 */

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * The longest a working target may be: a second short of the bar. A key hold
 * targeted at the bar is how a max effort is told from a working set
 * (`isBarAttempt` — set logs keep no role), and clamped to the bar itself the
 * working sets of an athlete past it read as max efforts: holding 14–16s full
 * planches and stopping intensity-day sets at the 10s call, they were "measured"
 * at 10s — base and cap fell, and the trend read −1.5s a week.
 */
export function workingCeiling(step: StepDef): number {
  return Math.max(1, step.unlockSec - 1)
}

/**
 * Working-set target, anchored robustly.
 *
 * Anchoring on the all-time best is tempting but fragile: a single
 * mis-measured or lucky hold would permanently inflate every future target
 * and quietly set the athlete up to fail every set. Instead the anchor is the
 * median of recent session bests, and the all-time best is only allowed to
 * pull it up a little. Sessions stopped at their calls are floors, raised to
 * the measured level — which follows the latest max effort when it is higher
 * (see measuredLevel) — so for an athlete who stops at every call one fresh
 * re-test does move the anchor; that is the point of it. The coach applies
 * the one evidence-scaled hit-rate nudge later; doing it here as well caused
 * swings.
 *
 * Read from one comparable task: the surface the athlete trains on now, with a
 * unilateral hold's weaker side setting the value. With nothing comparable
 * logged, the placement answer for this exact hold is the next-best evidence,
 * then the timer PR as a ceiling, then the step's conventional start.
 */
export function adaptiveTarget(state: AppState, stepId: StepId, now = Date.now()): number {
  const step = STEP_BY_ID[stepId]
  const surface = defaultSurface(state.profile.equipment, state.profile.preferredSurface)
  const series = learningSeries(state, stepId, surface, now)
  // Sessions stopped at their targets are right-censored: they say "at least
  // this much". They may not pull the estimate below where the athlete was
  // last measured — a re-test, an attempt, a set that went past or fell short
  // of its target (see measuredLevel for why the latest one leads) — while
  // that measurement is fresh against their latest session.
  const newest = series.points[series.points.length - 1]
  const measured = newest ? measuredLevel(series.points, newest.at) : null
  const recentBests = series.points
    .slice(-6)
    .map((p) => (p.cappedAt !== undefined && measured !== null ? Math.max(p.value, measured) : p.value))

  if (recentBests.length === 0) {
    // A standalone unverified PR must never raise a target or unlock a step,
    // but it is still useful as a safety ceiling. A beginner with a real 3s
    // tuck should not receive generic 5s working sets merely because the clip
    // failed.
    const timerBest = state.prs[step.keyExerciseId]?.value ?? 0
    if (timerBest > 0) return clamp(Math.round(timerBest * 0.6), 1, step.startSec)
    const answered = state.assessment?.answers[step.keyExerciseId]
    if (answered !== undefined) {
      // "Can't hold it yet" is not a reason to prescribe the conventional
      // start anyway. A short hold at an easier lean is the honest dose; the
      // block note says how to make it easier.
      return answered > 0 ? clamp(Math.round(answered * 0.6), 1, step.startSec) : Math.min(step.startSec, 5)
    }
    return step.startSec
  }

  const verifiedBest = qualifyingProgress(state, stepId).value
  const typical = median(recentBests)
  // Blend: mostly what you can repeat, with a nod to your peak. A verified best
  // on another surface is not this task's peak.
  const peak = series.transferred || series.surface === null ? 0 : verifiedBest
  const observedBest = Math.max(peak, ...recentBests)
  const anchor =
    typical === null
      ? observedBest
      : typical * 0.75 + Math.min(observedBest, typical * 1.5) * 0.25
  const t = anchor * 0.6
  // A prescription completed as asked is evidence it was within capacity: the
  // next base does not fall below it (strategy and rail factors still apply).
  // Without this, an athlete who stopped every set at its target — as the
  // hold screen invites — saw each target come out at a fraction of the last.
  const floor = series.transferred ? null : completedBaseTarget(state, stepId, series.surface, now)
  const target = clamp(Math.max(Math.round(t), floor ?? 0), 1, workingCeiling(step))
  // Nothing on this surface yet: another surface's numbers are an uncertain
  // transfer, so they may only lower the conventional start, never raise it.
  return series.transferred ? Math.min(target, step.startSec) : target
}

/**
 * Today's working target in whole seconds: the base scaled by the plan's
 * factor, inside the bar, and never past the best this athlete has actually
 * held. The floor is one second, not three — a three-second floor silently
 * raised a capacity-capped one-second target back above what the athlete had
 * shown, and contradicted Full Planche's own two-second start.
 */
export function workingTargetSec(state: AppState, stepId: StepId, targetFactor: number, now = Date.now()): number {
  return workingTarget(state, stepId, targetFactor, now).sec
}

/**
 * The same target, with whether the capacity cap is what held it. For an
 * athlete who stops every set at its call the best they have held *is* the
 * last target, so an earned increase cannot show until something measures
 * past it — worth saying, rather than blaming rounding.
 */
export function workingTarget(
  state: AppState,
  stepId: StepId,
  targetFactor: number,
  now = Date.now(),
): { sec: number; heldByCapacity: boolean } {
  const step = STEP_BY_ID[stepId]
  const base = adaptiveTarget(state, stepId, now)
  const target = clamp(Math.round(base * targetFactor), 1, workingCeiling(step))
  const capacity = capacityOn(state, stepId)
  const cap = capacity !== undefined ? Math.max(1, Math.floor(capacity)) : Infinity
  return { sec: Math.min(target, cap), heldByCapacity: cap < target }
}
