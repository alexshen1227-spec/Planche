import type { AppState, SkillId, StepId } from '../types'
import { roadOf, STEP_BY_ID } from '../data/progressions'
import { EXERCISE_BY_ID } from '../data/exercises'
import { skillForStep } from '../data/skills'
import { MEASUREMENT_FRESH_DAYS, qualifyingProgress, qualifyingSessionValue, qualifyingValueIsFloor } from './progression'
import { median, NOISY_SPREAD, readSignals, spreadAroundTrend, type Signals } from './signals'

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
/**
 * The rate that predicts the coming weeks is the recent one. Progress on a
 * step decelerates — the first weeks are largely the nervous system learning
 * the position — and pairwise rates over the whole history let a fast first
 * month keep promising "1–3 weeks" long after the climb had slowed.
 */
export const FORECAST_WINDOW_DAYS = 56

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
  /**
   * Measured, but the holds swing wider than any trend: the reading the coach
   * holds targets on and Progress reports. `basis` is Progress's own sentence.
   */
  | { kind: 'noisy'; variability: number; points: number; basis: string }
  /**
   * Not enough evidence. Says what is missing rather than guessing.
   * `staleDays`: there were measurements, but none recent — the days since
   * the last one.
   */
  | { kind: 'insufficient'; need: string; staleDays?: number }

interface Point {
  at: number
  value: number
  /**
   * The session's verified best stopped at its target call: "at least this
   * much", never a measurement. Rates and levels read measured points only.
   */
  floor?: true
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
  // A minimum dose stops its holds at about three seconds on purpose: as
  // points in a rate they read as collapses, turning an eight-week forecast
  // into "past a year" and a steady climb into a capability jump. Its
  // next-shape holds still count toward early promotion (qualifyingProgress).
  return [...state.sessions]
    .filter((s) => s.workoutKind !== 'micro')
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => {
      const value = qualifyingSessionValue(s, stepId)
      return { at: s.startedAt, value, ...(qualifyingValueIsFloor(s, stepId, value) ? { floor: true as const } : {}) }
    })
    .filter((p) => p.value > 0)
}

/**
 * The verified series without its floors: what a rate, a stall or a jump may
 * be read from. A session stopped at its targets logs whatever was asked —
 * read as data, a run of them was "flat" or "going backwards" for an athlete
 * gaining every session, and the next re-test read as a sudden jump.
 */
export function measuredSeries(state: Pick<AppState, 'sessions'>, stepId: StepId): Point[] {
  return qualifyingSeries(state, stepId).filter((p) => !p.floor)
}

/**
 * Whether most of the recent verified sessions were stopped at the call —
 * the only time "a hold you stop at the call measures nothing" is the reason
 * a number is missing. Said on any floor, it told an athlete who held every
 * set to failure that they had stopped at the call.
 */
export function mostlyFloors(points: Point[]): boolean {
  const recent = points.slice(-6)
  return recent.length > 0 && recent.filter((p) => p.floor).length * 2 > recent.length
}

/**
 * The bar `readSignals` calls noisy (defined there, one constant for both):
 * past it the swing from session to session is wider than any trend, so a
 * pace, a breakthrough or a jump read from those points is reading the swing.
 */
export { NOISY_SPREAD }
/**
 * The most scatter a "Good confidence" forecast may rest on — half the noise
 * bar — because that note says the progress has been consistent. Before, the
 * tier never looked at the scatter at all. The app's design, not a measured
 * threshold.
 */
export const CONSISTENT_SPREAD = NOISY_SPREAD / 2

/**
 * The signals' spread reading on a series: the last six points from the
 * eight weeks before the latest, their spread around the median-slope line,
 * over their median. Null when it cannot be read.
 */
export function seriesSpread(points: { at: number; value: number }[]): number | null {
  if (points.length === 0) return null
  const lastAt = points[points.length - 1].at
  const recent = points.filter((p) => lastAt - p.at <= FORECAST_WINDOW_DAYS * DAY).slice(-6)
  const mid = median(recent.map((p) => p.value))
  const spread = spreadAroundTrend(recent)
  return mid !== null && mid > 0 && spread !== null ? spread / mid : null
}

export interface NoiseReading {
  noisy: boolean
  /** The swing as a share of the level, when it could be read. */
  variability: number | null
}

/**
 * Whether a step's holds are too noisy to read a pace, a breakthrough or a
 * jump from — one gate for every headline number. Noisy when the signals say
 * so (what the coach holds targets on and Progress reports), or when the
 * step's own verified measurements spread past the same bar. Home once showed
 * "2–5 weeks", "Good confidence", a breakthrough card and a capability jump
 * beside a coach calling the same holds "±28% … measurement noise".
 *
 * @param sig the signals already read for this state and moment; left out,
 *   they are read here. They describe the current step only.
 */
export function noiseReading(
  state: AppState,
  stepId: StepId = state.stepId,
  now = Date.now(),
  sig?: Pick<Signals, 'noisy' | 'variability'> | null,
): NoiseReading {
  const own = seriesSpread(measuredSeries(state, stepId))
  const signals = stepId === state.stepId ? (sig !== undefined ? sig : readSignals(state, now)) : null
  if (signals?.noisy) return { noisy: true, variability: signals.variability ?? own }
  if (own !== null && own > NOISY_SPREAD) return { noisy: true, variability: own }
  return { noisy: false, variability: own }
}

/** Progress's words for noise, so every screen that refuses says the same. */
export function noiseSentence(holdName: string, variability: number | null): string {
  return `Your recent ${holdName} holds swing about ±${Math.round(
    (variability ?? 0) * 100,
  )}% from session to session — wider than any trend, so whether you are progressing cannot be read yet. The same setup every time is the cheapest fix.`
}

/** "3 weeks ago", "about 7 months ago" — how long since a day count. */
export function sinceText(days: number): string {
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`
  if (days < 90) return `${Math.round(days / 7)} weeks ago`
  return `about ${Math.round(days / 30.4)} months ago`
}

/**
 * Where the athlete is now, read the way the rate is: the level of the
 * median-slope line at the latest measurement. One lucky hold moves a median
 * of adjusted values by one place; it moved the all-time best by eight
 * seconds.
 */
function robustLevel(series: Point[], ratePerWeek: number): number {
  const lastAt = series[series.length - 1].at
  return median(series.map((p) => p.value + (ratePerWeek * (lastAt - p.at)) / WEEK)) ?? series[series.length - 1].value
}

/**
 * The stretch of history a rate is measured from: the last
 * `FORECAST_WINDOW_DAYS` when that alone meets the evidence minimums, and the
 * whole history otherwise — sparse training has no "recent rate" to prefer,
 * and dropping points from it only makes the estimate thinner.
 */
function forecastWindow(all: Point[], now: number): Point[] {
  const recent = all.filter((p) => now - p.at <= FORECAST_WINDOW_DAYS * DAY)
  const enough =
    recent.length >= MIN_FORECAST_POINTS &&
    recent[recent.length - 1].at - recent[0].at >= MIN_FORECAST_SPAN_DAYS * DAY
  return enough ? recent : all
}

/**
 * Weeks to the unlock bar on the athlete's current step.
 *
 * The interval comes from the interquartile spread of pairwise rates rather
 * than a standard error: it makes no distributional assumption, it degrades
 * gracefully on five points, and one outlier session moves the quartiles far
 * less than it moves a variance.
 */
export function forecastUnlock(
  state: AppState,
  stepId: StepId = state.stepId,
  now = Date.now(),
  sig?: Pick<Signals, 'noisy' | 'variability'> | null,
): Forecast {
  const step = STEP_BY_ID[stepId]
  if (!step) return { kind: 'insufficient', need: 'a known step' }

  // The bar is the unlock's own: held once with the full evidence chain.
  const best = qualifyingProgress(state, stepId).value
  if (best >= step.unlockSec) return { kind: 'ready' }

  const verified = qualifyingSeries(state, stepId)
  const measured = verified.filter((p) => !p.floor)
  // Old evidence is not a pace. With nothing measured in the last six weeks
  // the window fell back to all history, and after six months off the
  // forecast still promised "about 7 weeks, Good confidence" from a climb
  // that ended in spring.
  const latest = measured[measured.length - 1]
  if (latest && now - latest.at > MEASUREMENT_FRESH_DAYS * DAY) {
    const staleDays = Math.floor((now - latest.at) / DAY)
    return {
      kind: 'insufficient',
      staleDays,
      need: `a recent measured ${EX_LABEL(step.keyExerciseId)} hold. Your last one was ${sinceText(
        staleDays,
      )}, and a pace from before a break says little about where you are now — one filmed max hold that passes the form check measures it again.`,
    }
  }
  const series = forecastWindow(measured, now)
  if (series.length < MIN_FORECAST_POINTS) {
    const missing = MIN_FORECAST_POINTS - series.length
    const floors = mostlyFloors(verified)
    return {
      kind: 'insufficient',
      need: floors
        ? `${missing} more measured ${EX_LABEL(step.keyExerciseId)} hold${
            missing === 1 ? '' : 's'
          }. A hold that ends at or just past its target call says "at least this much", not how far you could go — the re-tests and attempts the coach schedules are what measure it. A rate needs at least ${MIN_FORECAST_POINTS} measured points before it means anything.`
        : `${missing} more session${missing === 1 ? '' : 's'} with a filmed ${
            EX_LABEL(step.keyExerciseId)
          } hold that passes the form check (you rated it Clean and the camera agreed). A rate needs at least ${MIN_FORECAST_POINTS} of them before it means anything.`,
    }
  }

  const spanDays = (series[series.length - 1].at - series[0].at) / DAY
  if (spanDays < MIN_FORECAST_SPAN_DAYS) {
    return {
      kind: 'insufficient',
      need: `a longer run of evidence — your form-checked holds so far span ${Math.round(
        spanDays,
      )} days, and a weekly rate measured inside ${MIN_FORECAST_SPAN_DAYS} days is mostly day-to-day swing.`,
    }
  }

  // Noise before any rate: a pace read through a swing wider than the trend
  // is the swing, and Progress says so in these words.
  const noise = noiseReading(state, stepId, now, sig)
  if (noise.noisy) {
    return {
      kind: 'noisy',
      variability: noise.variability ?? 0,
      points: series.length,
      basis: noiseSentence(EX_LABEL(step.keyExerciseId), noise.variability),
    }
  }

  const rates = pairwiseRates(series).sort((a, b) => a - b)
  if (rates.length === 0) return { kind: 'insufficient', need: 'form-checked holds on separate days' }

  const central = median(rates) ?? 0
  // Measured from a robust current level, never above the best: from the
  // all-time best, one lucky 19s hold beside a steady 8 → 11s climb turned
  // "12–16 weeks" into "about 2 weeks, Good confidence" — and the tip on Home
  // promises one lucky hold cannot swing it.
  const level = Math.min(best, robustLevel(series, central))
  const remaining = step.unlockSec - level

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
  // A range is always a range: both edges rounding to the same week printed
  // "about 3 weeks" beside a note saying the evidence is "enough for a range,
  // not enough for a date".
  const highEdge = highRaw === null ? null : Math.max(lowWeeks + 1, highRaw)
  const highWeeks = highEdge === null || highEdge > MAX_FORECAST_WEEKS ? null : highEdge

  // Confidence is about the evidence, not the answer. Wide bands, thin series
  // and stale data each cost a tier, and "good" — whose note says the progress
  // has been consistent — needs the scatter around the trend to be small.
  const spread = seriesSpread(series)
  const consistent = spread !== null && spread <= CONSISTENT_SPREAD
  let score = 0
  if (points >= 6) score += 1
  if (points >= 10) score += 1
  if (spanDays >= 28) score += 1
  if (highWeeks !== null && highWeeks <= lowWeeks * 2.5) score += 1
  if (staleDays > 21) score -= 1
  const confidence: ForecastConfidence = score >= 3 && consistent ? 'good' : score >= 2 ? 'moderate' : 'low'

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
    )}s a week from a current level of about ${level.toFixed(1)}s, with ${remaining.toFixed(1)}s of clean hold left to find.`,
  }
}

/** The exercise's own name, lower-cased — the id read "verified ppp hold hold". */
function EX_LABEL(exerciseId: string): string {
  return (EXERCISE_BY_ID[exerciseId]?.name ?? exerciseId.replace(/-/g, ' ')).toLowerCase()
}

/** Human phrasing for a forecast, so every screen says it the same way. */
export function describeForecast(f: Forecast): string {
  switch (f.kind) {
    case 'ready':
      return 'You have already held the bar on verified evidence — test it and take the step.'
    case 'range':
      // Printed as the range it is. Equal edges cannot come out of
      // forecastUnlock; if one ever does, it is one number, never "3–3".
      return f.highWeeks === null
        ? `${f.lowWeeks}+ weeks`
        : f.lowWeeks === f.highWeeks
          ? `${f.lowWeeks} week${f.lowWeeks === 1 ? '' : 's'}`
          : `${f.lowWeeks}–${f.highWeeks} weeks`
    case 'noisy':
      return 'no date yet — the holds swing wider than they trend'
    case 'not-trending':
      // Three different situations reach this branch and they are not the same
      // news. Saying "flat" to an athlete whose holds are measurably climbing
      // — just too slowly to date — is the module contradicting the number it
      // just computed.
      return f.ratePerWeek > 0.01
        ? 'no date yet — climbing too slowly to project'
        : f.ratePerWeek < -0.05
          ? 'no date yet — the trend is downward'
          : 'no date yet — the trend is flat'
    case 'insufficient':
      return 'not enough evidence yet'
  }
}

export const CONFIDENCE_NOTE: Record<ForecastConfidence, string> = {
  low: 'Low confidence — this is a wide guess off thin evidence, and it will sharpen as you log more verified holds.',
  moderate: 'Moderate confidence — enough evidence for a range, not enough for a date.',
  good: 'Good confidence — your verified holds have stayed close to their trend, consistent enough for this range to mean something.',
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
  const current = STEP_BY_ID[state.stepId]
  // The athlete's own road. The planche's steps once stood in for every
  // skill, so a front-lever athlete with two finished steps never got an
  // estimate.
  const road = roadOf(current.id)
  const onRoad = (id: StepId | undefined) => (id && road.some((s) => s.id === id) ? STEP_BY_ID[id] : undefined)
  const goal = onRoad(state.profile.goalStepId) ?? onRoad(skillForStep(current.id).defaultGoal) ?? road[road.length - 1]
  const stepsRemaining = Math.max(0, goal.order - current.order)

  if (stepsRemaining === 0) {
    return {
      goalStepId: goal.id,
      stepsRemaining: 0,
      estimate: null,
      note: `${goal.order === current.order ? 'You are training at' : 'You are past'} ${
        goal.name
      }, your chosen goal. Pick a longer-lever goal whenever you want the road to keep going.`,
    }
  }

  // A step is "completed in app" when sessions exist on it and on a later one.
  const firstSessionOnStep = new Map<StepId, number>()
  for (const s of [...state.sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    if (!firstSessionOnStep.has(s.stepId)) firstSessionOnStep.set(s.stepId, s.startedAt)
  }
  const ordered = road.filter((s) => firstSessionOnStep.has(s.id)).sort((a, b) => a.order - b.order)

  /**
   * Only steps that resemble the ones still ahead.
   *
   * The early road is genuinely quick — someone can pass Foundations, Planche
   * Lean and Frog Stand in a few weeks each — and every step after Tuck is a
   * different order of difficulty. Averaging the first three and multiplying
   * by the remaining four produced "1–14 weeks to a straddle planche", which
   * is not a wide estimate so much as a wrong one. So the pace is measured
   * only from steps at Tuck or beyond, and with fewer than two of those the
   * honest output is a step count and no duration at all. Every road has its
   * own such step (`COMPARABLE_FROM`).
   */
  const comparableFrom = STEP_BY_ID[COMPARABLE_FROM[current.skill]]?.order ?? 0
  const durations: number[] = []
  for (let i = 0; i < ordered.length - 1; i++) {
    if (ordered[i].order < comparableFrom) continue
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
      }. How long that takes depends on leverage, bodyweight, training age and how consistently you recover. The app will put a number on it once you have finished a couple of steps at this level of difficulty and it can measure your own pace.`,
    }
  }

  const typical = median(credible)!
  const fastest = Math.min(...credible)
  const slowest = Math.max(...credible)

  // Later steps are longer than earlier ones, always. Widening the upper edge
  // per remaining step is the least-dishonest way to say so without pretending
  // to know the multiplier.
  //
  // The near edge also gets a floor that grows with how hard the *remaining*
  // steps are. Measuring two-week steps at Tuck and projecting them forward
  // produced "2–3 weeks to a full planche" — narrower than the original bug
  // but the same lie. Nobody has gone straddle-to-full in a month, and the
  // app should not be the one to suggest it. INFERENCE, deliberately coarse.
  // The hardest step ahead is the goal itself; its floor is read by how far it
  // sits below its road's summit (the planche's original table: full 12,
  // straddle 8, one-leg and advanced tuck 6, tuck 4, anything earlier 2).
  const fromSummit = road.length - 1 - road.findIndex((s) => s.id === goal.id)
  const floorPerStep = MIN_WEEKS_FROM_SUMMIT[fromSummit] ?? 2
  const lowWeeks = Math.max(
    Math.round(floorPerStep * stepsRemaining),
    Math.round(fastest * stepsRemaining),
  )
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

/**
 * Where each road's steps start to resemble the ones ahead: its first lever
 * shape (the planche's tuck). The steps before are conditioning and position
 * drills, quick for most people, and their pace says little about the hard
 * end of the road. The app's judgement, like the planche's original rule.
 */
const COMPARABLE_FROM: Record<SkillId, StepId> = {
  planche: 'tuck',
  frontlever: 'fl-tuck',
  handstand: 'hs-float',
  ninety: 'n90-tuck',
  flag: 'flag-tuck',
}

/**
 * The fewest weeks a step is allowed to take in the goal estimate, by how far
 * the hardest step ahead sits below its road's summit. INFERENCE, deliberately
 * coarse — the planche's original numbers, read from the top of each road.
 */
const MIN_WEEKS_FROM_SUMMIT = [12, 8, 6, 6, 4]
