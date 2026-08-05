import type { AppState, StepId } from '../types'
import { STEPS, STEP_BY_ID } from '../data/progressions'
import { qualifyingProgress, qualifyingSessionValue } from './progression'
import { median } from './signals'

/**
 * How long until the next unlock — answered as a range, or not at all.
 *
 * The old answer was a single number ("on pace to unlock in ~4 weeks") fitted
 * by least squares to at most six noisy session bests. Two things were wrong
 * with it. Least squares lets one lucky hold rotate the whole line, and a
 * point estimate hides the fact that the honest answer spans months. An
 * athlete who is told four weeks and takes eleven concludes the app is lying —
 * and they are right to.
 *
 * So this module returns an interval built from the spread of the athlete's
 * own pairwise progress rates, a confidence tier that says how much to trust
 * it, and — importantly — the option to refuse. Refusing is a real answer:
 * "not enough evidence yet" is more useful than a number nobody should act on.
 */

const DAY = 86_400_000
const WEEK = 7 * DAY

/** Below this many measured session bests, no rate is worth quoting. */
export const MIN_FORECAST_POINTS = 4
/** A rate measured inside a few days is cadence, not progress. */
export const MIN_FORECAST_SPAN_DAYS = 14
/** Past this the honest phrasing is "longer than a year", not a number. */
export const MAX_FORECAST_WEEKS = 52

export type ForecastConfidence = 'low' | 'moderate' | 'good'

export type Forecast =
  /** The bar is already cleared on measured evidence — go and test it. */
  | { kind: 'ready' }
  /** Enough signal for an honest interval. */
  | {
      kind: 'range'
      lowWeeks: number
      /** Null means the upper edge ran past the horizon — "more than a year". */
      highWeeks: number | null
      confidence: ForecastConfidence
      /** Plain-language account of what the estimate rests on. */
      basis: string
      /** Measured central rate, seconds per week. */
      ratePerWeek: number
      points: number
      spanDays: number
    }
  /** Measured, and the trend is flat or downward — a number would be fiction. */
  | { kind: 'not-trending'; basis: string; ratePerWeek: number; points: number }
  /** Not enough evidence. Says what is missing rather than guessing. */
  | { kind: 'insufficient'; need: string }

interface Point {
  at: number
  value: number
}

/** Every pairwise rate in the series, seconds per week. Theil–Sen's input. */
function pairwiseRates(points: Point[]): number[] {
  const rates: number[] = []
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const elapsed = points[j].at - points[i].at
      // Two bests logged the same day say nothing about a weekly rate, and
      // dividing by a near-zero span manufactures enormous ones.
      if (elapsed < DAY) continue
      rates.push(((points[j].value - points[i].value) / elapsed) * WEEK)
    }
  }
  return rates
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** Verified session bests on a step's key hold, oldest first. */
export function qualifyingSeries(state: Pick<AppState, 'sessions'>, stepId: StepId): Point[] {
  return [...state.sessions]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => ({ at: s.startedAt, value: qualifyingSessionValue(s, stepId) }))
    .filter((p) => p.value > 0)
}

/**
 * Weeks to the unlock bar on the athlete's current step.
 *
 * The interval comes from the interquartile spread of pairwise rates rather
 * than a standard error: it makes no distributional assumption, it degrades
 * gracefully on five points, and one outlier session moves the quartiles far
 * less than it moves a variance.
 */
export function forecastUnlock(state: AppState, stepId: StepId = state.stepId, now = Date.now()): Forecast {
  const step = STEP_BY_ID[stepId]
  if (!step) return { kind: 'insufficient', need: 'a known step' }

  const best = qualifyingProgress(state, stepId).value
  if (best >= step.unlockSec) return { kind: 'ready' }

  const series = qualifyingSeries(state, stepId)
  if (series.length < MIN_FORECAST_POINTS) {
    const missing = MIN_FORECAST_POINTS - series.length
    return {
      kind: 'insufficient',
      need: `${missing} more session${missing === 1 ? '' : 's'} with a verified ${
        EX_LABEL(step.keyExerciseId)
      } hold. A rate needs at least ${MIN_FORECAST_POINTS} measured points before it means anything.`,
    }
  }

  const spanDays = (series[series.length - 1].at - series[0].at) / DAY
  if (spanDays < MIN_FORECAST_SPAN_DAYS) {
    return {
      kind: 'insufficient',
      need: `a longer run of evidence — your verified holds so far span ${Math.round(
        spanDays,
      )} days, and a weekly rate measured inside ${MIN_FORECAST_SPAN_DAYS} days is mostly day-to-day swing.`,
    }
  }

  const rates = pairwiseRates(series).sort((a, b) => a - b)
  if (rates.length === 0) return { kind: 'insufficient', need: 'verified holds on separate days' }

  const central = median(rates) ?? 0
  const remaining = step.unlockSec - best

  // Quartiles, not extremes: the fastest and slowest pair in a noisy series are
  // both artefacts, and quoting them would make every interval useless.
  const slow = quantile(rates, 0.25)
  const fast = quantile(rates, 0.75)

  const points = series.length
  const staleDays = (now - series[series.length - 1].at) / DAY

  if (central <= 0.01) {
    return {
      kind: 'not-trending',
      ratePerWeek: central,
      points,
      basis:
        central < -0.05
          ? `Your verified holds have been going backwards (about ${central.toFixed(
              1,
            )}s a week across ${points} sessions), so there is no rate to project forward.`
          : `Your verified holds have been flat across ${points} sessions, so any date would be invented. Something needs to change before the bar moves.`,
    }
  }

  // Fast edge → the soonest plausible week; slow edge → the latest.
  const lowRaw = Math.max(1, Math.ceil(remaining / Math.max(fast, central)))
  // The horizon binds the *near* edge too. A barely-positive rate put the
  // soonest plausible date 1095 weeks out — twenty-one years, printed beside a
  // basis line that rounded the same rate to "+0.0s a week". Past a year there
  // is no honest number, only "at this rate, not soon".
  if (lowRaw > MAX_FORECAST_WEEKS) {
    return {
      kind: 'not-trending',
      ratePerWeek: central,
      points,
      basis: `Your verified holds are climbing, but at about ${central.toFixed(
        2,
      )}s a week the remaining ${remaining.toFixed(
        1,
      )}s would take years at this rate. That is a real measurement rather than a stall — it just is not a number worth planning around, and something in the training needs to change before it is.`,
    }
  }
  const lowWeeks = lowRaw
  const highRate = slow > 0.01 ? slow : null
  const highRaw = highRate === null ? null : Math.ceil(remaining / highRate)
  const highWeeks = highRaw === null || highRaw > MAX_FORECAST_WEEKS ? null : Math.max(lowWeeks, highRaw)

  // Confidence is about the evidence, not the answer. Wide bands, thin series
  // and stale data each cost a tier.
  let score = 0
  if (points >= 6) score += 1
  if (points >= 10) score += 1
  if (spanDays >= 28) score += 1
  if (highWeeks !== null && highWeeks <= lowWeeks * 2.5) score += 1
  if (staleDays > 21) score -= 1
  const confidence: ForecastConfidence = score >= 3 ? 'good' : score >= 2 ? 'moderate' : 'low'

  return {
    kind: 'range',
    lowWeeks,
    highWeeks,
    confidence,
    ratePerWeek: central,
    points,
    spanDays: Math.round(spanDays),
    basis: `Measured from ${points} verified sessions over ${Math.round(spanDays)} days: typically +${central.toFixed(
      1,
    )}s a week, with ${remaining.toFixed(1)}s of clean hold left to find.`,
  }
}

function EX_LABEL(exerciseId: string): string {
  return exerciseId.replace(/-/g, ' ')
}

/** Human phrasing for a forecast, so every screen says it the same way. */
export function describeForecast(f: Forecast): string {
  switch (f.kind) {
    case 'ready':
      return 'You have already held the bar on verified evidence — test it and take the step.'
    case 'range':
      return f.highWeeks === null
        ? `${f.lowWeeks}+ weeks at your current rate`
        : f.lowWeeks === f.highWeeks
          ? `about ${f.lowWeeks} week${f.lowWeeks === 1 ? '' : 's'}`
          : `${f.lowWeeks}–${f.highWeeks} weeks`
    case 'not-trending':
      return 'no date yet — the trend is flat'
    case 'insufficient':
      return 'not enough evidence yet'
  }
}

export const CONFIDENCE_NOTE: Record<ForecastConfidence, string> = {
  low: 'Low confidence — this is a wide guess off thin evidence, and it will sharpen as you log more verified holds.',
  moderate: 'Moderate confidence — enough evidence for a range, not enough for a date.',
  good: 'Good confidence — your progress has been consistent enough for this range to mean something.',
}

export interface GoalOutlook {
  goalStepId: StepId
  /** Steps still to clear, current one included. */
  stepsRemaining: number
  /** Present only when the athlete's own completed steps can measure it. */
  estimate: {
    lowWeeks: number
    highWeeks: number
    /** How many completed steps the per-step duration was measured from. */
    measuredFrom: number
  } | null
  note: string
}

/**
 * How far the chosen goal is — measured against this athlete, or not at all.
 *
 * Chaining a per-step forecast across four future steps is the purest form of
 * false precision this app could ship: each step is harder than the last by an
 * unknown amount, and the error compounds. So the long-range number is only
 * offered when the athlete has actually finished steps *inside the app*, and
 * then it is their own measured pace, widened, and labelled as such. With
 * nothing to measure, it says how many steps remain and stops talking.
 */
export function goalOutlook(state: AppState, now = Date.now()): GoalOutlook {
  const goalStepId = state.profile.goalStepId ?? 'straddle'
  const goal = STEP_BY_ID[goalStepId] ?? STEP_BY_ID.straddle
  const current = STEP_BY_ID[state.stepId]
  const stepsRemaining = Math.max(0, goal.order - current.order)

  if (stepsRemaining === 0) {
    return {
      goalStepId: goal.id,
      stepsRemaining: 0,
      estimate: null,
      note: `You are training at ${goal.name}, your chosen goal. Pick a longer-lever goal whenever you want the road to keep going.`,
    }
  }

  // A step is "completed in app" when sessions exist on it and on a later one.
  const firstSessionOnStep = new Map<StepId, number>()
  for (const s of [...state.sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    if (!firstSessionOnStep.has(s.stepId)) firstSessionOnStep.set(s.stepId, s.startedAt)
  }
  const ordered = STEPS.filter((s) => firstSessionOnStep.has(s.id)).sort((a, b) => a.order - b.order)

  /**
   * Only steps that resemble the ones still ahead.
   *
   * The early road is genuinely quick — someone can pass Foundations, Planche
   * Lean and Frog Stand in a few weeks each — and every step after Tuck is a
   * different order of difficulty. Averaging the first three and multiplying
   * by the remaining four produced "1–14 weeks to a straddle planche", which
   * is not a wide estimate so much as a wrong one. So the pace is measured
   * only from steps at Tuck or beyond, and with fewer than two of those the
   * honest output is a step count and no duration at all.
   */
  const COMPARABLE_FROM = STEP_BY_ID.tuck.order
  const durations: number[] = []
  for (let i = 0; i < ordered.length - 1; i++) {
    if (ordered[i].order < COMPARABLE_FROM) continue
    const from = firstSessionOnStep.get(ordered[i].id)!
    const to = firstSessionOnStep.get(ordered[i + 1].id)!
    if (to > from) durations.push((to - from) / WEEK)
  }

  /**
   * A "duration" shorter than this is not a step someone trained through.
   *
   * The pace is measured from the first session logged on each step, so an
   * athlete placed high who logs one session per step while moving up records
   * days rather than months — and the arithmetic then offered a full planche
   * in "1–2 weeks", beside a note saying "typically 0 weeks each". Nothing on
   * this road is cleared in under a fortnight, so anything faster is an
   * artefact of how the placement was entered, not a measurement of them.
   */
  const MIN_PLAUSIBLE_STEP_WEEKS = 2
  const credible = durations.filter((w) => w >= MIN_PLAUSIBLE_STEP_WEEKS)

  if (credible.length < 2) {
    return {
      goalStepId: goal.id,
      stepsRemaining,
      estimate: null,
      note: `${stepsRemaining} step${stepsRemaining === 1 ? '' : 's'} between you and ${
        goal.name
      }. How long that takes depends on leverage, bodyweight, training age and how consistently you recover, and the honest ranges people report span years rather than months. The app will put a number on it once you have finished a couple of steps at this level of difficulty and it can measure your own pace instead of quoting somebody else's.`,
    }
  }

  const typical = median(credible)!
  const fastest = Math.min(...credible)
  const slowest = Math.max(...credible)

  // Later steps are longer than earlier ones, always. Widening the upper edge
  // per remaining step is the least-dishonest way to say so without pretending
  // to know the multiplier.
  const lowWeeks = Math.max(1, Math.round(fastest * stepsRemaining))
  const highWeeks = Math.max(lowWeeks + 1, Math.round(slowest * stepsRemaining * 1.5))

  // How long the current step has already taken, so "typically 5 weeks each"
  // is not quietly contradicted by an athlete who is nine weeks into this one.
  const startedCurrent = firstSessionOnStep.get(state.stepId)
  const onCurrentWeeks = startedCurrent ? Math.floor((now - startedCurrent) / WEEK) : null
  const behindTypical = onCurrentWeeks !== null && onCurrentWeeks > typical * 1.5

  return {
    goalStepId: goal.id,
    stepsRemaining,
    estimate: { lowWeeks, highWeeks, measuredFrom: credible.length },
    note: `Measured from the ${credible.length} steps you have finished here (typically ${Math.round(
      typical,
    )} weeks each).${
      behindTypical
        ? ` You are ${onCurrentWeeks} weeks into ${current.name}, longer than your own average — which is normal, because each step is harder than the last.`
        : ''
    } Treat the far end as the realistic one: every step on this road is harder than the one before it, and this range cannot know by how much.`,
  }
}
