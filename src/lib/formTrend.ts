import type { AppState, AutoForm } from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { MATERIAL_TOLERANCE } from './poseForm'
import { robustSlopePerWeek } from './signals'

/**
 * What the camera has measured about one position, over weeks.
 *
 * The judge answers "was that rep clean?" one set at a time. It cannot answer
 * "is my lean actually getting deeper, or does it just feel that way?" — and
 * that is the question a form-focused athlete is really asking. Nothing in the
 * app looked across clips until now.
 *
 * Three rules make this honest rather than decorative:
 *
 * 1. **A criterion the camera did not see contributes nothing.** The judge
 *    already reports `unseen` per set; a set where the elbows were out of shot
 *    is excluded from the elbow trend rather than quietly averaged in. Those
 *    exclusions are counted and shown, because "your lean is improving" means
 *    something different when it rests on four clips out of eleven.
 * 2. **A change smaller than the camera's own error is not a change.** Every
 *    deadband here is the measured `MATERIAL_TOLERANCE` for that criterion —
 *    the same numbers that decide whether a fault is nameable. Below it, the
 *    verdict is "steady", never a direction.
 * 3. **Trends are per exercise.** A planche lean's lean ratio and a tuck
 *    planche's are not the same measurement, and pooling them would produce a
 *    line that moves when you change position rather than when you improve.
 */

const DAY = 86_400_000

/** Below these counts a slope is a line through noise. */
export const MIN_TREND_POINTS = 4
export const MIN_TREND_SPAN_DAYS = 14

export type FormCriterionId = 'elbow' | 'lean' | 'line' | 'shrug' | 'knees' | 'score' | 'clean'

interface CriterionSpec {
  id: FormCriterionId
  label: string
  /** How the athlete reads the number. */
  unit: 'deg' | 'ratio' | 'points' | 'percent'
  field: keyof AutoForm
  /** The judge's own `unseen` label, so exclusions line up exactly. */
  unseenLabel?: string
  higherIsBetter: boolean
  /**
   * Total change across the window that must be exceeded before a direction is
   * claimed. Measured camera error, not a chosen sensitivity.
   */
  deadband: number
  /** What a rising number means, in the athlete's language. */
  betterMeans: string
}

const CRITERIA: CriterionSpec[] = [
  {
    id: 'elbow',
    label: 'Elbow lockout',
    unit: 'deg',
    field: 'elbowDeg',
    unseenLabel: 'elbows',
    higherIsBetter: true,
    deadband: MATERIAL_TOLERANCE.elbowDeg,
    betterMeans: 'arms straighter — 180° is fully locked',
  },
  {
    id: 'lean',
    label: 'Forward lean',
    unit: 'ratio',
    field: 'leanRatio',
    unseenLabel: 'forward lean',
    higherIsBetter: true,
    deadband: MATERIAL_TOLERANCE.leanRatio,
    betterMeans: 'shoulders travelling further past your hands',
  },
  {
    id: 'line',
    label: 'Body line',
    unit: 'ratio',
    field: 'hipOffset',
    unseenLabel: 'body line',
    // hipOffset is distance from level, so smaller is flatter.
    higherIsBetter: false,
    deadband: MATERIAL_TOLERANCE.lineRatio,
    betterMeans: 'hips closer to level with your shoulders',
  },
  {
    id: 'shrug',
    label: 'Shoulders down',
    unit: 'ratio',
    field: 'shrugRatio',
    unseenLabel: 'shoulder-to-ear line',
    // The gap from shoulder to ear over torso length: bigger gap = less shrug.
    higherIsBetter: true,
    deadband: MATERIAL_TOLERANCE.shrugRatio,
    betterMeans: 'less shrugging — more space between shoulder and ear',
  },
  {
    id: 'knees',
    label: 'Knee extension',
    unit: 'deg',
    field: 'kneeDeg',
    unseenLabel: 'knees',
    higherIsBetter: true,
    deadband: MATERIAL_TOLERANCE.kneeDeg,
    betterMeans: 'legs straighter',
  },
  {
    id: 'score',
    label: 'Overall form score',
    unit: 'points',
    field: 'score',
    higherIsBetter: true,
    // The judge's own free band is 5° of angular deviation; a score wobble
    // smaller than that band is inside its own noise.
    deadband: 5,
    betterMeans: 'a cleaner position overall',
  },
  {
    id: 'clean',
    label: 'Share of the hold that stayed clean',
    unit: 'percent',
    field: 'cleanRatio',
    higherIsBetter: true,
    deadband: 0.1,
    betterMeans: 'holding the shape for more of the set before it breaks down',
  },
]

export interface FormTrendPoint {
  at: number
  value: number
}

export interface FormTrend {
  criterion: FormCriterionId
  label: string
  unit: CriterionSpec['unit']
  direction: 'improving' | 'declining' | 'steady'
  points: FormTrendPoint[]
  earliest: number
  latest: number
  /** Signed change per week in the raw unit; sign is raw, not "goodness". */
  changePerWeek: number
  /** Clips where this criterion was measured, and where it was not. */
  seen: number
  unseen: number
  confidence: 'low' | 'moderate' | 'good'
  betterMeans: string
  higherIsBetter: boolean
}

export type FormTrendResult =
  | {
      kind: 'trends'
      exerciseId: string
      trends: FormTrend[]
      /** Criteria that exist for this position but could not be trended. */
      skipped: { label: string; reason: string }[]
      filmedSets: number
    }
  | { kind: 'insufficient'; need: string; filmedSets: number }

interface FilmedSet {
  at: number
  auto: AutoForm
}

/** Every filmed, analysed set of one exercise, oldest first. */
function filmedSetsFor(state: Pick<AppState, 'sessions'>, exerciseId: string): FilmedSet[] {
  const out: FilmedSet[] = []
  for (const session of state.sessions) {
    for (const set of session.sets) {
      const auto = set.form?.auto
      if (set.exerciseId !== exerciseId || !auto) continue
      // A refused or near-blind read is not evidence about the athlete.
      if (auto.confidence < 0.35) continue
      out.push({ at: set.at, auto })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

/**
 * Per-criterion trends for one exercise.
 *
 * Returns `insufficient` rather than a thin chart: the point of this feature is
 * to tell an athlete something their stopwatch cannot, and a two-point line
 * does not do that.
 */
export function readFormTrends(
  state: Pick<AppState, 'sessions'>,
  exerciseId: string,
  now = Date.now(),
): FormTrendResult {
  const filmed = filmedSetsFor(state, exerciseId)
  if (filmed.length < MIN_TREND_POINTS) {
    const missing = MIN_TREND_POINTS - filmed.length
    return {
      kind: 'insufficient',
      filmedSets: filmed.length,
      need: `${missing} more filmed ${
        missing === 1 ? 'set' : 'sets'
      } of this exercise. Trends need at least ${MIN_TREND_POINTS} camera-checked sets before they say anything.`,
    }
  }

  const spanDays = (filmed[filmed.length - 1].at - filmed[0].at) / DAY
  if (spanDays < MIN_TREND_SPAN_DAYS) {
    return {
      kind: 'insufficient',
      filmedSets: filmed.length,
      need: `a longer run — your filmed sets so far span ${Math.round(
        spanDays,
      )} days, and form measured inside ${MIN_TREND_SPAN_DAYS} days is mostly session-to-session variation.`,
    }
  }

  const trends: FormTrend[] = []
  const skipped: { label: string; reason: string }[] = []

  for (const spec of CRITERIA) {
    let unseen = 0
    const points: FormTrendPoint[] = []
    for (const f of filmed) {
      // Excluded, not averaged: the judge said it could not see this.
      if (spec.unseenLabel && f.auto.unseen?.includes(spec.unseenLabel)) {
        unseen++
        continue
      }
      const raw = f.auto[spec.field]
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        unseen++
        continue
      }
      points.push({ at: f.at, value: raw })
    }

    if (points.length < MIN_TREND_POINTS) {
      // Only worth mentioning if the camera was genuinely trying and failing.
      if (unseen > 0) {
        skipped.push({
          label: spec.label,
          reason:
            points.length === 0
              ? `the camera never had this in shot`
              : `only ${points.length} of ${filmed.length} filmed sets had this in shot`,
        })
      }
      continue
    }
    const pointSpanDays = (points[points.length - 1].at - points[0].at) / DAY
    if (pointSpanDays < MIN_TREND_SPAN_DAYS) {
      skipped.push({ label: spec.label, reason: 'the sets it was visible in are too close together' })
      continue
    }

    // Median pairwise slope: one hallucinated frame cannot flip the direction.
    const perWeek = robustSlopePerWeek(points) ?? 0
    const totalChange = perWeek * (pointSpanDays / 7)

    // A move smaller than the camera's own measurement error is not a move.
    const direction: FormTrend['direction'] =
      Math.abs(totalChange) < spec.deadband
        ? 'steady'
        : (totalChange > 0) === spec.higherIsBetter
          ? 'improving'
          : 'declining'

    let score = 0
    if (points.length >= 6) score += 1
    if (points.length >= 10) score += 1
    if (pointSpanDays >= 28) score += 1
    if (unseen === 0) score += 1
    if (now - points[points.length - 1].at > 21 * DAY) score -= 1
    const confidence: FormTrend['confidence'] = score >= 3 ? 'good' : score >= 2 ? 'moderate' : 'low'

    trends.push({
      criterion: spec.id,
      label: spec.label,
      unit: spec.unit,
      direction,
      points,
      earliest: points[0].value,
      latest: points[points.length - 1].value,
      changePerWeek: perWeek,
      seen: points.length,
      unseen,
      confidence,
      betterMeans: spec.betterMeans,
      higherIsBetter: spec.higherIsBetter,
    })
  }

  if (trends.length === 0) {
    return {
      kind: 'insufficient',
      filmedSets: filmed.length,
      need: `${filmed.length} filmed sets, but the camera has not seen any one thing often enough to trend it. Framing is usually the cause — the live guide on the ready screen helps get your whole body in shot.`,
    }
  }

  // Declining first: it is the thing worth acting on, and burying it under
  // three improving criteria is how an athlete misses it.
  const rank = { declining: 0, improving: 1, steady: 2 }
  trends.sort((a, b) => rank[a.direction] - rank[b.direction])

  return { kind: 'trends', exerciseId, trends, skipped, filmedSets: filmed.length }
}

/** Which exercises have any camera-checked sets at all, most recent first. */
export function filmedExercises(state: Pick<AppState, 'sessions'>): string[] {
  const lastSeen = new Map<string, number>()
  for (const session of state.sessions) {
    for (const set of session.sets) {
      if (!set.form?.auto || !EXERCISE_BY_ID[set.exerciseId]) continue
      lastSeen.set(set.exerciseId, Math.max(lastSeen.get(set.exerciseId) ?? 0, set.at))
    }
  }
  return [...lastSeen.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

/** How a value reads on screen. */
export function formatCriterionValue(value: number, unit: CriterionSpec['unit']): string {
  switch (unit) {
    case 'deg':
      return `${Math.round(value)}°`
    case 'percent':
      return `${Math.round(value * 100)}%`
    case 'points':
      return `${Math.round(value)}`
    case 'ratio':
      return value.toFixed(2)
  }
}

/** One sentence an athlete can act on, or an honest absence of one. */
export function describeTrend(t: FormTrend): string {
  const from = formatCriterionValue(t.earliest, t.unit)
  const to = formatCriterionValue(t.latest, t.unit)
  if (t.direction === 'steady') {
    return `Holding around ${to} across ${t.seen} filmed sets — no change the camera can distinguish from its own error.`
  }
  const verb = t.direction === 'improving' ? 'up' : 'down'
  return `${from} → ${to} across ${t.seen} filmed sets. That is ${verb}, and ${
    t.direction === 'improving' ? 'in the direction you want' : `the wrong way — better here means ${t.betterMeans}`
  }.`
}
