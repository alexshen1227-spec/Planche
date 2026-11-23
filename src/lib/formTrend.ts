import type { AppState, AutoForm, SkillId } from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { skillOfExercise } from '../data/skills'
import { elbowSlack, kneeSlack, MATERIAL_TOLERANCE, POSE_PROFILES } from './poseForm'
import { median, robustSlopePerWeek } from './signals'
import { verifiedCleanRatio } from './progression'

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

export type FormCriterionId =
  | 'elbow'
  | 'angle'
  | 'shoulders'
  | 'tilt'
  | 'lean'
  | 'line'
  | 'shrug'
  | 'knees'
  | 'score'
  | 'clean'

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
  /** Read the value some other way than the raw field — for a derived reading. */
  read?: (auto: AutoForm) => number | undefined
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
    // A bent-arm hold: how far the elbows sit from the angle the hold asks
    // for, either side of it. Built per position in `criteriaFor`.
    id: 'angle',
    label: 'Elbow angle',
    unit: 'deg',
    field: 'elbowDeg',
    unseenLabel: 'elbows',
    higherIsBetter: false,
    deadband: MATERIAL_TOLERANCE.angleDeg,
    betterMeans: 'elbows closer to the right angle this hold is built on',
  },
  {
    id: 'shoulders',
    label: 'Shoulder opening',
    unit: 'deg',
    field: 'shoulderDeg',
    unseenLabel: 'shoulder opening',
    higherIsBetter: true,
    deadband: MATERIAL_TOLERANCE.shoulderDeg,
    betterMeans: 'arms closer to in line with your body — 180° is fully open',
  },
  {
    id: 'tilt',
    label: 'Off level',
    unit: 'deg',
    field: 'tiltDeg',
    unseenLabel: 'level line',
    // Degrees away from level, so smaller is flatter.
    higherIsBetter: false,
    deadband: MATERIAL_TOLERANCE.tiltDeg,
    betterMeans: 'your body closer to level',
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
    // Camera-verified: a hold with bent arms inside its window was not clean.
    read: verifiedCleanRatio,
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

/** A criterion that could not be trended, and which kind of gap it was. */
export interface SkippedCriterion {
  label: string
  reason: string
  /** Out of shot, never stored by the form check that made the record, or too bunched in time. */
  cause: 'framing' | 'unrecorded' | 'spacing'
}

export type FormTrendResult =
  | {
      kind: 'trends'
      exerciseId: string
      trends: FormTrend[]
      /** Criteria that exist for this position but could not be trended. */
      skipped: SkippedCriterion[]
      filmedSets: number
      /**
       * Oldest and newest surviving recordings, when there are two worth
       * putting side by side. Null once the older clip has been pruned.
       */
      comparison: FormComparison | null
    }
  | { kind: 'insufficient'; need: string; filmedSets: number }

interface FilmedSet {
  at: number
  auto: AutoForm
  /** Present while the recording still exists in the clip store. */
  clipKey?: string
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
      const clipKey = set.form?.clipKey ?? set.clipKey
      out.push({ at: set.at, auto, ...(clipKey ? { clipKey } : {}) })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

/**
 * The two clips worth putting side by side.
 *
 * A number tells you something drifted; two clips tell you what to change. So
 * the oldest and newest recordings still on the device are offered together,
 * with every criterion both of them measured.
 *
 * Deliberately the oldest *kept* clip rather than the oldest data point:
 * recordings are pruned after `CLIP_RETENTION_DAYS`, so reaching for the true
 * start of the trend would usually reach for a file that no longer exists.
 * The dates are shown so the window is never implied to be longer than it is.
 */
/**
 * The criteria the judge actually grades for this position.
 *
 * The judge reports a knee angle for every clip, but a tuck's knees are meant
 * to be bent: trending their "extension" would report the shape of the
 * position as if it were progress, and pairing it with "legs straighter" as
 * the better direction would point a tuck athlete the wrong way.
 */
function criteriaFor(exerciseId: string): CriterionSpec[] {
  const profile = POSE_PROFILES[exerciseId]
  return CRITERIA.filter((spec) => {
    if (!profile || profile.noChecks) return spec.id === 'score' || spec.id === 'clean'
    switch (spec.id) {
      case 'elbow':
        return profile.minElbowDeg !== undefined
      case 'angle':
        return profile.elbowTargetDeg !== undefined
      case 'shoulders':
        return profile.minShoulderDeg !== undefined
      case 'tilt':
        return profile.maxTiltDeg !== undefined
      case 'lean':
        return profile.minLeanRatio !== undefined
      case 'line':
        return profile.levelTolerance !== undefined
      case 'shrug':
        return profile.checkShrug
      case 'knees':
        return profile.minKneeDeg !== undefined
      default:
        return true
    }
  }).map((spec) => {
    if (!profile) return spec
    // The camera's error is the posture's, not the planche's: a hung or
    // upside-down elbow is read far more coarsely than a support hold's, and a
    // change inside that error is "steady" there too.
    if (spec.id === 'elbow') return { ...spec, deadband: elbowSlack(profile) }
    if (spec.id === 'knees') return { ...spec, deadband: kneeSlack(profile) }
    if (spec.id === 'angle') {
      const target = profile.elbowTargetDeg!
      return {
        ...spec,
        read: (auto: AutoForm) => (auto.elbowDeg === undefined ? undefined : Math.abs(auto.elbowDeg - target)),
        betterMeans: `elbows closer to the ${target}° this hold is built on`,
      }
    }
    return spec
  })
}

function buildComparison(filmed: FilmedSet[], criteria: CriterionSpec[]): FormComparison | null {
  const withClips = filmed.filter((f) => f.clipKey)
  if (withClips.length < 2) return null
  const from = withClips[0]
  const to = withClips[withClips.length - 1]
  if (from.clipKey === to.clipKey || to.at - from.at < 3 * DAY) return null

  const rows: FormComparison['criteria'] = []
  for (const spec of criteria) {
    // Both ends must have genuinely measured it, or the row would compare a
    // reading against a blank and call the difference progress.
    const unseenEitherEnd =
      spec.unseenLabel !== undefined &&
      (from.auto.unseen?.includes(spec.unseenLabel) || to.auto.unseen?.includes(spec.unseenLabel))
    if (unseenEitherEnd) continue
    const a = spec.read ? spec.read(from.auto) : from.auto[spec.field]
    const b = spec.read ? spec.read(to.auto) : to.auto[spec.field]
    if (typeof a !== 'number' || typeof b !== 'number') continue
    const change = b - a
    rows.push({
      label: spec.label,
      unit: spec.unit,
      from: a,
      to: b,
      direction:
        Math.abs(change) < spec.deadband
          ? 'steady'
          : (change > 0) === spec.higherIsBetter
            ? 'improving'
            : 'declining',
    })
  }
  if (rows.length === 0) return null
  return {
    from: { at: from.at, clipKey: from.clipKey! },
    to: { at: to.at, clipKey: to.clipKey! },
    criteria: rows,
  }
}

export interface FormComparison {
  from: { at: number; clipKey: string }
  to: { at: number; clipKey: string }
  criteria: {
    label: string
    unit: CriterionSpec['unit']
    from: number
    to: number
    direction: 'improving' | 'declining' | 'steady'
  }[]
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
  const skipped: SkippedCriterion[] = []
  const criteria = criteriaFor(exerciseId)

  for (const spec of criteria) {
    // Two different reasons a set says nothing about a criterion, kept apart
    // because they need different advice: the judge saw too little of it
    // (framing), or the record never stored it (older form checks kept fewer
    // measurements). Blaming framing for the second sent athletes to fix a
    // camera position that was never the problem.
    let unseen = 0
    let unrecorded = 0
    const points: FormTrendPoint[] = []
    for (const f of filmed) {
      // Excluded, not averaged: the judge said it could not see this.
      if (spec.unseenLabel && f.auto.unseen?.includes(spec.unseenLabel)) {
        unseen++
        continue
      }
      const raw = spec.read ? spec.read(f.auto) : f.auto[spec.field]
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        unrecorded++
        continue
      }
      points.push({ at: f.at, value: raw })
    }

    if (points.length < MIN_TREND_POINTS) {
      if (unseen > 0 || unrecorded > 0) {
        skipped.push({
          label: spec.label,
          cause: unseen > 0 ? 'framing' : 'unrecorded',
          reason:
            points.length > 0
              ? `only ${points.length} of ${filmed.length} filmed sets measured this`
              : unrecorded === 0
                ? 'the camera never had this in shot'
                : unseen === 0
                  ? 'none of these form checks recorded it — older checks stored fewer measurements'
                  : `out of shot in ${unseen} set${unseen === 1 ? '' : 's'} and not recorded in ${unrecorded}`,
        })
      }
      continue
    }
    const pointSpanDays = (points[points.length - 1].at - points[0].at) / DAY
    if (pointSpanDays < MIN_TREND_SPAN_DAYS) {
      skipped.push({ label: spec.label, cause: 'spacing', reason: 'the sets it was measured in are too close together' })
      continue
    }

    // Median pairwise slope: one hallucinated frame cannot flip the direction.
    const perWeek = robustSlopePerWeek(points) ?? 0
    const totalChange = perWeek * (pointSpanDays / 7)
    // The endpoints quoted are the same robust line's, not the raw first and
    // last frames: one bad last frame printed "160° → 140°" beside a verdict
    // that the elbows had straightened.
    const perMs = perWeek / (7 * DAY)
    const t0 = points[0].at
    const intercept = median(points.map((p) => p.value - perMs * (p.at - t0))) ?? points[0].value
    const lineAt = (at: number) => intercept + perMs * (at - t0)

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
      earliest: lineAt(points[0].at),
      latest: lineAt(points[points.length - 1].at),
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

  return {
    kind: 'trends',
    exerciseId,
    trends,
    skipped,
    filmedSets: filmed.length,
    comparison: buildComparison(filmed, criteria),
  }
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

/**
 * The filmed positions with one skill's first, each group most recently filmed
 * first. The form-trend card opens on the skill being looked at: switching
 * skill used to leave it on whichever position had been filmed last, on any
 * road.
 */
export function filmedExercisesFor(state: Pick<AppState, 'sessions'>, skill: SkillId): string[] {
  const all = filmedExercises(state)
  return [...all.filter((id) => skillOfExercise(id) === skill), ...all.filter((id) => skillOfExercise(id) !== skill)]
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
  // Which way the number moved, said apart from whether that is good: lower
  // is better for some criteria, and every improvement once read "up".
  const verb = t.latest > t.earliest ? 'up' : 'down'
  return `${from} → ${to} across ${t.seen} filmed sets. That is ${verb}, and ${
    t.direction === 'improving' ? 'in the direction you want' : `the wrong way — better here means ${t.betterMeans}`
  }.`
}
