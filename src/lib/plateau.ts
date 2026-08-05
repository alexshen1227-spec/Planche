import type { AppState, StepId, StrategyId } from '../types'
import { STEP_BY_ID } from '../data/progressions'
import { qualifyingSeries } from './forecast'
import { median, type Signals } from './signals'

/**
 * Naming a plateau, and naming its cause.
 *
 * The coach could already see a flat trend, but "flat" is not coaching — it is
 * a chart. Two athletes with identical flat lines need opposite instructions:
 * one is grinding max holds four days a week on wrecked tendons, the other has
 * trained twice this month. Telling both of them "you have plateaued" is worse
 * than silence, because it invites them both to try harder.
 *
 * So this module separates *is it stalled* from *why*, and every cause carries
 * a different prescription that the planner actually applies. Where the
 * evidence cannot separate causes it says so and stops, rather than picking the
 * most dramatic one.
 */

/** A stall is only meaningful over a real block of training. */
export const PLATEAU_MIN_SESSIONS = 4
export const PLATEAU_MIN_DAYS = 21
/** Seconds per week below which the key hold is not meaningfully moving. */
export const FLAT_RATE = 0.15

export type PlateauCause =
  | 'form-limited'
  | 'under-recovered'
  | 'under-stimulated'
  | 'monotony'
  | 'strength-ceiling'
  | 'skill-ceiling'
  | 'measurement-noise'
  | 'unclear'

export interface PlateauVerdict {
  status: 'stalled' | 'regressing'
  /** Whole weeks the key hold has been flat or falling. */
  weeksFlat: number
  cause: PlateauCause
  /** What in the log supports this reading. */
  evidence: string
  /** What the app is doing about it — matches what the planner really does. */
  intervention: string
  /** How much to trust the *cause*; the stall itself is measured. */
  confidence: 'low' | 'moderate' | 'good'
  /** Strategy the planner should adopt, when the cause implies one. */
  suggestStrategy?: StrategyId
  /** Deload now, regardless of the calendar. */
  suggestDeload?: boolean
  /** Re-measure before believing the plateau at all. */
  suggestMaxTest?: boolean
}

/**
 * @param sig readings from `readSignals` for the same state and moment.
 */
export function diagnosePlateau(
  state: AppState,
  sig: Signals,
  now = Date.now(),
): PlateauVerdict | null {
  const step = STEP_BY_ID[state.stepId]
  if (!step) return null

  const series = qualifyingSeries(state, state.stepId)
  if (series.length < PLATEAU_MIN_SESSIONS) return null

  const spanDays = (series[series.length - 1].at - series[0].at) / 86_400_000
  if (spanDays < PLATEAU_MIN_DAYS) return null

  const rate = sig.trendPerWeek
  if (rate === null) return null
  if (rate > FLAT_RATE) return null

  // How long it has actually been flat: walk back while no session beats the
  // best of the ones before it by a meaningful margin.
  const overallBest = Math.max(...series.map((p) => p.value))
  const firstAtBest = series.find((p) => p.value >= overallBest * 0.98)?.at ?? series[0].at
  const weeksFlat = Math.max(1, Math.floor((now - firstAtBest) / (7 * 86_400_000)))

  const status: PlateauVerdict['status'] = rate < -FLAT_RATE ? 'regressing' : 'stalled'

  // ——— Cause, in priority order: the ones that make training unsafe or
  // wasted come before the ones that merely make it slow. ———

  // Noise first. A "plateau" measured through ±25% swing is a measurement
  // problem, and every other prescription below would be acting on a fiction.
  if (sig.noisy) {
    return {
      status,
      weeksFlat,
      cause: 'measurement-noise',
      confidence: 'good',
      evidence: `Your recent verified bests swing about ±${Math.round(
        (sig.variability ?? 0) * 100,
      )}%, which is wider than the trend itself. Whether you have actually stalled is not currently measurable.`,
      intervention:
        'Targets stay where they are and the app stops reacting to the swing. The cheapest fix is consistency of setup: same surface, same camera position, same time of day for your main sets.',
      suggestMaxTest: true,
    }
  }

  // Recovery. Grinding into a hole is the one cause where "train more" is
  // actively harmful, so it outranks everything except the noise check.
  const jointsUnhappy = sig.lastCheckIn?.joints === 'niggle' || sig.lastCheckIn?.joints === 'pain'
  const loadHigh = sig.readinessLoad !== null && sig.readinessLoad > 1.35
  const grinding = (sig.lastLoadedRpe ?? 0) >= 9
  if (loadHigh || (jointsUnhappy && sig.sessionsPerWeek >= 3) || (grinding && sig.weeksSinceDeload >= 3)) {
    return {
      status,
      weeksFlat,
      cause: 'under-recovered',
      confidence: loadHigh && grinding ? 'good' : 'moderate',
      evidence: [
        loadHigh
          ? `Your recent load is running ${Math.round((sig.readinessLoad ?? 1) * 100)}% of your own four-week normal`
          : null,
        grinding ? 'your last hard session was RPE 9 or above' : null,
        jointsUnhappy ? 'and you flagged joints that are not happy' : null,
        `${sig.weeksSinceDeload} weeks since an easy week`,
      ]
        .filter(Boolean)
        .join(', ')
        .replace(/^./, (c) => c.toUpperCase()) + '.',
      // Deliberately hedged, and it must stay that way. The obvious sentence
      // here — "adaptation lands during recovery" — is the one CLAUDE.md
      // forbids: the two controlled trials of planned deloads found no
      // benefit. The honest case for backing off is not that it makes you
      // stronger, it is that it costs nothing and the alternative is grinding.
      // The companion claim that tendon is "the slowest tissue to recover" is
      // also unsupported: on detraining, muscle size decayed sooner.
      intervention:
        'An easy week now rather than later. Backing off is not proven to make you stronger — the handful of trials on planned deloads found no benefit either way — but it reliably costs nothing, and continuing to grind a stalled hold under this much accumulated load has a real cost. Drop the volume, keep the movements.',
      suggestDeload: true,
      suggestStrategy: 'technique',
    }
  }

  // Form. Seconds bought with a collapsing position are not seconds.
  const formPoor =
    (sig.meanCleanRatio !== null && sig.meanCleanRatio < 0.75) ||
    (sig.formCleanRate !== null && sig.formRatedCount >= 3 && sig.formCleanRate < 0.5) ||
    sig.formDegrading
  if (formPoor) {
    return {
      status,
      weeksFlat,
      cause: 'form-limited',
      confidence: sig.meanCleanRatio !== null && sig.cameraSetCount >= 4 ? 'good' : 'moderate',
      evidence:
        sig.meanCleanRatio !== null
          ? `The camera verified only about ${Math.round(
              sig.meanCleanRatio * 100,
            )}% of your recent hold time as inside the clean envelope${
              sig.topFormIssue ? `, most often ${sig.topFormIssue.issue}` : ''
            }.`
          : `You rated ${Math.round((sig.formCleanRate ?? 0) * 100)}% of recent main sets as clean${
              sig.formDegrading ? ', and that share has been falling while your times climbed' : ''
            }.`,
      intervention:
        'The position is the limiter, not the clock. Targets come down so every rep is a rehearsal of the shape you actually want, and the hold rebuilds from a clean base rather than a survivable one.',
      suggestStrategy: 'technique',
    }
  }

  // Not enough training to expect anything. Checked before the ceilings, or a
  // twice-a-month athlete gets told they have hit their strength ceiling.
  if (sig.sessionsPerWeek < 1.5) {
    return {
      status,
      weeksFlat,
      cause: 'under-stimulated',
      confidence: 'good',
      evidence: `You have averaged ${sig.sessionsPerWeek.toFixed(
        1,
      )} sessions a week over the last month. Straight-arm strength responds to repeated exposure, and this is below the frequency that reliably produces it.`,
      intervention:
        'Nothing about your programming needs fixing before the frequency does. Two or three sessions a week — even short ones — will move this number more than any change the coach could make to the sets themselves.',
    }
  }

  // Strategy monotony: the same shape of session for weeks. Distinct from
  // under-stimulation — plenty of work, no variation in the stimulus.
  const recentStrategies = state.sessions
    .slice(-8)
    .map((s) => s.strategy)
    .filter((s): s is StrategyId => Boolean(s))
  const distinct = new Set(recentStrategies).size
  if (recentStrategies.length >= 6 && distinct <= 1 && weeksFlat >= 4) {
    return {
      status,
      weeksFlat,
      cause: 'monotony',
      confidence: 'moderate',
      evidence: `Your last ${recentStrategies.length} sessions all ran the same shape, and the hold has been flat for ${weeksFlat} weeks.`,
      intervention:
        'The coach deliberately rotates to an untested session shape. A stimulus your body has fully adapted to is maintenance, however hard it feels.',
    }
  }

  // Strength vs skill: the accessory trend separates these two cleanly, and
  // they need opposite work.
  if (sig.pressingLags) {
    return {
      status,
      weeksFlat,
      cause: 'strength-ceiling',
      confidence: 'moderate',
      evidence:
        'Your pressing numbers have flattened alongside the hold, which points at the engine rather than the position or the recovery.',
      intervention:
        'Pressing volume goes up and max-hold attempts stay controlled. When both the isometric and the dynamic work stall together, more max attempts is the one thing that reliably does not help.',
      suggestStrategy: 'volume',
    }
  }
  if (sig.accessoryTrend === 'up') {
    return {
      status,
      weeksFlat,
      cause: 'skill-ceiling',
      confidence: 'moderate',
      evidence:
        'Your pressing strength is still climbing while the hold sits flat — so the limiter is more likely the position, the lean and the balance than raw force production.',
      intervention:
        'Low-fatigue position and balance practice gets priority over more loaded attempts. Strength you cannot yet organise into the shape does not show up on the stopwatch.',
      suggestStrategy: 'technique',
    }
  }

  // Everything measurable came back ordinary. Say that honestly.
  return {
    status,
    weeksFlat,
    cause: 'unclear',
    confidence: 'low',
    evidence: `Your key hold has been ${
      status === 'regressing' ? 'drifting down' : 'flat'
    } for about ${weeksFlat} weeks, and none of the usual causes — recovery, form quality, frequency, pressing strength — stands out in your log.`,
    intervention:
      'A fresh max test recalibrates every target from a real number rather than an ageing one, and plateaus of this kind are often a measurement that drifted rather than a body that stopped adapting. Sleep and eating enough are the two inputs the app cannot see.',
    suggestMaxTest: true,
  }
}

/** Short label for the cause, for chips and headings. */
export const PLATEAU_LABEL: Record<PlateauCause, string> = {
  'form-limited': 'Position, not strength',
  'under-recovered': 'Recovery debt',
  'under-stimulated': 'Not enough exposure',
  monotony: 'Same stimulus too long',
  'strength-ceiling': 'Pressing strength',
  'skill-ceiling': 'Skill and balance',
  'measurement-noise': 'Too noisy to call',
  unclear: 'No clear cause',
}

/**
 * Progress worth celebrating, measured the same way the plateau is.
 *
 * Deliberately paired with the plateau check: an app that only speaks up when
 * things go wrong trains its users to dread opening it.
 */
export function recentBreakthrough(
  state: AppState,
  stepId: StepId = state.stepId,
  now = Date.now(),
): { gainSec: number; weeks: number } | null {
  const series = qualifyingSeries(state, stepId)
  if (series.length < 3) return null
  const recent = series.filter((p) => now - p.at <= 28 * 86_400_000)
  if (recent.length < 3) return null
  const earlier = series.filter((p) => now - p.at > 28 * 86_400_000)
  if (earlier.length === 0) return null
  const before = median(earlier.slice(-4).map((p) => p.value))
  const after = Math.max(...recent.map((p) => p.value))
  if (before === null || before <= 0) return null
  const gain = after - before
  if (gain < Math.max(1, before * 0.15)) return null
  return { gainSec: Math.round(gain * 10) / 10, weeks: 4 }
}
