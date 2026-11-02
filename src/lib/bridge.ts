import type { AppState, Session, StepDef, StepId } from '../types'
import { STEP_BY_ID, stepAfter } from '../data/progressions'
import { defaultSurface } from '../data/equipment'
import { learningSeries, measuredLevel, qualifyingProgress } from './progression'

/**
 * The bridge between one step and the next — the part of the road where
 * athletes actually lose months.
 *
 * Every step's unlock bar is a coaching convention (no hold-time standard is
 * validated; see the research ledger). Training only the current shape until
 * that bar is met, and only then meeting the next shape for the first time,
 * makes every transition a cold start. Two changes make the road faster
 * without loosening what "earned" means:
 *
 * 1. **Bridge practice.** Once the current hold is halfway to its bar,
 *    sessions open with a few short, fresh attempts at the *next* shape, plus
 *    the drill that teaches the change between the two. Isometric strength is
 *    largely specific to the joint angle trained (ledger §1, MODERATE), so the
 *    next position is practised directly rather than only approached. Short,
 *    hard holds are also the stronger tendon stimulus in the one trial that
 *    compared hold lengths (Bohm 2014, MODERATE).
 * 2. **Early promotion.** Holding the next shape's opening dose clean — athlete
 *    rating, camera pass, flight confirmed: the full evidence chain — while the
 *    current one is past half its bar opens the next step. That is direct
 *    evidence of readiness for the next shape, which a stopwatch on the easier
 *    one only predicts.
 *
 * Both rules are the app's design (CONSENSUS-level reasoning: coaches commonly
 * start the next progression before the current one is "finished"); neither
 * is a measured threshold, and the copy says so.
 */

/** Share of the current bar that opens bridge practice. */
export const BRIDGE_SHARE = 0.5
/** Share of the current bar that, with the next shape shown, opens the next step. */
export const EARLY_PROMOTION_SHARE = 0.5

/**
 * Steps whose bridge opens from day one. The frog stand is a balance skill
 * with almost no strength cost, so a lean athlete can practise it at once.
 */
const BRIDGE_FROM_DAY_ONE = new Set<StepId>(['lean'])

/**
 * The most the athlete has shown they can hold on a step's key exercise, on
 * the comparable surface — or undefined when nothing has been measured.
 *
 * Recent sessions, and the latest fresh measurement however many sessions ago
 * it was. Holds stopped at their calls are floors: six obedient sessions pushed
 * a re-tested 8.4s out of a last-six window, the capacity fell to the 2s
 * targets they had been given, and next-shape practice closed on an athlete
 * who was still getting stronger. Fresh means within `MEASUREMENT_FRESH_DAYS`
 * of their latest session, so a reading from months before cannot hold the cap
 * up through a real drop.
 */
export function capacityOn(state: AppState, stepId: StepId): number | undefined {
  const step = STEP_BY_ID[stepId]
  const surface = defaultSurface(state.profile.equipment, state.profile.preferredSurface)
  const series = learningSeries(state, stepId, surface)
  const recent = series.points.slice(-6).map((p) => p.value)
  const newest = series.points[series.points.length - 1]
  if (newest) return Math.max(...recent, measuredLevel(series.points, newest.at) ?? 0)
  const timerBest = state.prs[step.keyExerciseId]?.value
  if (timerBest !== undefined && timerBest > 0) return timerBest
  const answered = state.assessment?.answers[step.keyExerciseId]
  return answered !== undefined && answered > 0 ? answered : undefined
}

export interface BridgeStatus {
  /** The step being bridged toward. */
  next: StepDef
  /** Bridge practice belongs in today's session (readiness permitting). */
  open: boolean
  /** Best comparable hold on the current step, when measured. */
  currentSec: number | undefined
  /** What the current step needs before the bridge opens. */
  openAtSec: number
  /** Verified clean best on the next shape so far. */
  nextVerifiedSec: number
  /** What the next shape must show, verified, for early promotion. */
  promotionSec: number
  /** Verified best on the current step, for the early-promotion half. */
  currentVerifiedSec: number
  /** What the current step's verified best must reach for early promotion. */
  promotionCurrentSec: number
}

/** Where the athlete stands between this step and the next; null at the summit. */
export function bridgeStatus(state: AppState, stepId: StepId = state.stepId): BridgeStatus | null {
  const step = STEP_BY_ID[stepId]
  const next = stepAfter(stepId)
  if (!step || !next) return null
  const currentSec = capacityOn(state, stepId)
  const openAtSec = BRIDGE_FROM_DAY_ONE.has(stepId) ? 0 : step.unlockSec * BRIDGE_SHARE
  return {
    next,
    open: openAtSec === 0 || (currentSec !== undefined && currentSec >= openAtSec),
    currentSec,
    openAtSec,
    nextVerifiedSec: qualifyingProgress(state, next.id).value,
    promotionSec: next.startSec,
    currentVerifiedSec: qualifyingProgress(state, stepId).value,
    promotionCurrentSec: step.unlockSec * EARLY_PROMOTION_SHARE,
  }
}

/** Typical camera hip angle of a tuck planche, for the meter (judge's synthetic ideal: 70°). */
export const TUCK_HIP_DEG = 65
/** Where an advanced tuck begins: thighs perpendicular to the torso. */
export const ADV_TUCK_HIP_DEG = 90

export interface HipOpening {
  /** Median camera hip angle across recent filmed tuck and advanced tuck holds. */
  recentDeg: number
  /** The same, for the filmed holds before those, when there are enough. */
  earlierDeg?: number
  /** How many recent holds the median rests on. */
  sets: number
}

/**
 * How open the hips are on recent filmed tucks — the dial that turns a tuck
 * into an advanced tuck, which the camera measures directly (shoulder–hip–knee
 * angle). A side-on estimate with a few degrees of error per hold, so it is a
 * median of several and is only shown with three or more behind it.
 */
export function hipOpening(state: Pick<AppState, 'sessions'>, now = Date.now()): HipOpening | null {
  const readings = state.sessions
    .filter((s) => s.startedAt <= now)
    .flatMap((s) => s.sets)
    .filter(
      (set) =>
        (set.exerciseId === 'tuck-planche' || set.exerciseId === 'adv-tuck-planche') &&
        set.section === 'main' &&
        set.form?.auto?.hipAngleDeg !== undefined &&
        !set.form.auto.malformed &&
        set.form.auto.confidence >= 0.5 &&
        !(set.form.auto.unseen ?? []).includes('hips'),
    )
    .sort((a, b) => a.at - b.at)
    .map((set) => set.form!.auto!.hipAngleDeg!)
  if (readings.length < 3) return null
  const recent = readings.slice(-6)
  const earlier = readings.slice(-12, -6)
  const mid = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }
  return {
    recentDeg: Math.round(mid(recent)),
    ...(earlier.length >= 3 ? { earlierDeg: Math.round(mid(earlier)) } : {}),
    sets: recent.length,
  }
}

/** A plank with the shoulders over the hands reads about this (real photo). */
export const PLANK_LEAN = 0.12
/** A strong planche lean read this on a real photograph through the same model. */
export const STRONG_LEAN = 0.82

/**
 * How far the shoulders travel past the hands on recent filmed leans, in
 * torso lengths — the dial that makes a lean harder, which the camera reads
 * directly. Leaning further, not holding longer, is what builds toward the
 * planche; the stopwatch cannot see it. Median of the last six filmed leans;
 * shown with three or more.
 */
export function leanDepth(state: Pick<AppState, 'sessions'>, now = Date.now()): HipOpening | null {
  const readings = state.sessions
    .filter((s) => s.startedAt <= now)
    .flatMap((s) => s.sets)
    .filter(
      (set) =>
        (set.exerciseId === 'planche-lean' || set.exerciseId === 'ppp-hold') &&
        set.section !== 'warmup' &&
        set.form?.auto?.leanRatio !== undefined &&
        !set.form.auto.malformed &&
        set.form.auto.confidence >= 0.5 &&
        !(set.form.auto.unseen ?? []).includes('forward lean'),
    )
    .sort((a, b) => a.at - b.at)
    .map((set) => set.form!.auto!.leanRatio!)
  if (readings.length < 3) return null
  const mid = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }
  const recent = readings.slice(-6)
  const earlier = readings.slice(-12, -6)
  return {
    recentDeg: Math.round(mid(recent) * 100) / 100,
    ...(earlier.length >= 3 ? { earlierDeg: Math.round(mid(earlier) * 100) / 100 } : {}),
    sets: recent.length,
  }
}

/**
 * Whether the next step opens early: the next shape's opening dose held with
 * full evidence, and the current step verified past half its bar. Pure, so a
 * replay of history reaches the same answer every time.
 */
export function earlyPromotionEarned(
  state: Pick<AppState, 'sessions'>,
  stepId: StepId,
  extraSessions: Session[] = [],
): boolean {
  const step = STEP_BY_ID[stepId]
  const next = stepAfter(stepId)
  if (!step || !next) return false
  const current = qualifyingProgress(state, stepId, extraSessions).value
  if (current < step.unlockSec * EARLY_PROMOTION_SHARE) return false
  return qualifyingProgress(state, next.id, extraSessions).value >= next.startSec
}
