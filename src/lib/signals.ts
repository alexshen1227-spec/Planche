import type { AppState, CheckIn, Session, SetLog } from '../types'
import { STEP_BY_ID } from '../data/progressions'
import { dayKey } from './time'

/**
 * Everything the coach can observe, derived from the log alone.
 *
 * This module only measures — it never decides. Keeping observation separate
 * from policy is what stops the coach reacting to noise: statistics here are
 * deliberately robust (medians, MAD) so one mis-measured set cannot swing a
 * training decision.
 */

const DAY = 86_400_000

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Median absolute deviation — an outlier-proof spread measure. */
export function mad(xs: number[]): number | null {
  const m = median(xs)
  if (m === null) return null
  return median(xs.map((x) => Math.abs(x - m)))
}

function keySetsOf(session: Session, exerciseId: string, section?: SetLog['section']): SetLog[] {
  return session.sets.filter((s) => s.exerciseId === exerciseId && (!section || s.section === section))
}

function bestIn(session: Session, exerciseId: string): number {
  return session.sets.reduce((b, s) => (s.exerciseId === exerciseId && s.value > b ? s.value : b), 0)
}

/**
 * Estimated real rest between main sets, reconstructed from set timestamps.
 * The gap between two logged sets is rest plus the second set's work and
 * lead-in, so those are subtracted back out.
 */
export function observedRestSec(session: Session, exerciseId: string): number | null {
  const sets = keySetsOf(session, exerciseId, 'main').sort((a, b) => a.at - b.at)
  if (sets.length < 2) return null
  const rests: number[] = []
  for (let i = 1; i < sets.length; i++) {
    const gap = (sets[i].at - sets[i - 1].at) / 1000
    const work = sets[i].kind === 'hold' ? sets[i].value : sets[i].value * 3
    const rest = gap - work - 5 // 5s lead-in
    if (rest > 15 && rest < 600) rests.push(rest)
  }
  return median(rests)
}

/** Linear slope (units per week) over timestamped points. */
function slopePerWeek(points: { at: number; value: number }[]): number | null {
  if (points.length < 3) return null
  const n = points.length
  const mx = points.reduce((t, p) => t + p.at, 0) / n
  const my = points.reduce((t, p) => t + p.value, 0) / n
  let num = 0
  let den = 0
  for (const p of points) {
    num += (p.at - mx) * (p.value - my)
    den += (p.at - mx) ** 2
  }
  if (den === 0) return null
  return (num / den) * 7 * DAY
}

export interface Signals {
  /** Days since the last logged session. */
  restDays: number
  lastRpe?: number
  lastCheckIn?: AppState['sessions'][number]['checkIn']
  daysSinceCheckIn: number | null

  /** Fraction of last session's main sets that reached their target. */
  mainHitRate: number | null
  /** How many main sets that rate is based on — thin evidence gets less say. */
  mainSetCount: number
  /** Robust centre of recent session bests on the key hold. */
  mainMedian: number | null
  /** Spread of recent bests as a fraction of the median. */
  variability: number | null
  /** True when session-to-session numbers are too noisy to steer on. */
  noisy: boolean
  /** Seconds per week gained on the key hold. */
  trendPerWeek: number | null
  /** Last session's key-hold best sat far outside the recent range. */
  lastWasOutlier: boolean

  /** Direction of pressing accessories (PPPU / pike push-ups). */
  accessoryTrend: 'up' | 'flat' | 'down' | null
  /** Holds are progressing but pressing strength is not — or vice versa. */
  pressingLags: boolean

  /** Fraction of recent sessions that included warm-up work. */
  warmupRate: number
  skippedLastWarmup: boolean

  /** Share of recent main holds self-rated clean (null when never rated). */
  formCleanRate: number | null
  /** How many rated sets that share is based on. */
  formRatedCount: number
  /** The failure the athlete reports most often, if there is a clear one. */
  topFormIssue: { issue: string; count: number } | null
  /** Seconds are climbing while form ratings are getting worse. */
  formDegrading: boolean
  /** Average camera-measured shakiness across recent filmed sets. */
  meanWobble: number | null
  /** How many sets the camera has measured recently. */
  cameraSetCount: number

  weightKg: number | null
  /** Bodyweight change per week over the last ~8 weeks. */
  weightTrendPerWeek: number | null

  sessionsPerWeek: number
  daysSinceMaxTest: number | null
  /** Weeks since the last deliberately easy week. */
  weeksSinceDeload: number
  totalSessions: number
}

/**
 * @param freshCheckIn answers given moments ago, before this session is
 * logged — they take precedence so the plan responds immediately.
 */
export function readSignals(state: AppState, now = Date.now(), freshCheckIn?: CheckIn): Signals {
  const sessions = [...state.sessions].sort((a, b) => a.startedAt - b.startedAt)
  const step = STEP_BY_ID[state.stepId]
  const keyId = step.keyExerciseId
  const last = sessions[sessions.length - 1]

  const restDays = last
    ? Math.max(0, Math.round((new Date(dayKey(now)).getTime() - new Date(dayKey(last.startedAt)).getTime()) / DAY))
    : 99

  // ——— Key-hold performance, measured robustly ———
  const withKey = sessions.filter((s) => bestIn(s, keyId) > 0)
  const recent = withKey.slice(-6)
  const recentBests = recent.map((s) => bestIn(s, keyId))
  const mainMedian = median(recentBests)
  const spread = mad(recentBests)
  const variability = mainMedian && mainMedian > 0 && spread !== null ? spread / mainMedian : null
  // Isometrics swing day to day; past ~22% deviation the signal is mostly noise.
  const noisy = variability !== null && variability > 0.22 && recentBests.length >= 3

  const trendPerWeek = slopePerWeek(withKey.slice(-6).map((s) => ({ at: s.startedAt, value: bestIn(s, keyId) })))

  let mainHitRate: number | null = null
  let mainSetCount = 0
  if (last) {
    const mains = keySetsOf(last, keyId, 'main')
    mainSetCount = mains.length
    if (mains.length > 0) mainHitRate = mains.filter((s) => s.value >= s.target).length / mains.length
  }

  // An outlier is a value far outside the robust range of the ones before it.
  let lastWasOutlier = false
  if (withKey.length >= 4) {
    const prior = withKey.slice(-5, -1).map((s) => bestIn(s, keyId))
    const pm = median(prior)
    const pmad = mad(prior)
    const latest = bestIn(withKey[withKey.length - 1], keyId)
    if (pm !== null && pmad !== null && pmad > 0) {
      lastWasOutlier = Math.abs(latest - pm) > Math.max(3, 3.5 * pmad)
    }
  }

  // ——— Accessory pressing work ———
  const pressIds = ['pppu', 'pike-pushup', 'tuck-planche-pushup', 'pushup', 'dip']
  const pressPoints = sessions
    .slice(-8)
    .map((s) => {
      const best = pressIds.reduce((b, id) => Math.max(b, bestIn(s, id)), 0)
      return best > 0 ? { at: s.startedAt, value: best } : null
    })
    .filter((p): p is { at: number; value: number } => p !== null)
  const pressSlope = slopePerWeek(pressPoints)
  const accessoryTrend: Signals['accessoryTrend'] =
    pressSlope === null ? null : pressSlope > 0.15 ? 'up' : pressSlope < -0.15 ? 'down' : 'flat'
  // Holds stalling while pressing also stalls points at a strength ceiling.
  const pressingLags =
    accessoryTrend === 'flat' && trendPerWeek !== null && trendPerWeek <= 0.2 && pressPoints.length >= 3

  // ——— Adherence ———
  // ——— Form quality, the only non-numeric signal available ———
  const ratedSets = sessions
    .slice(-8)
    .flatMap((s) => s.sets.filter((x) => x.form && x.section === 'main'))
  const formCleanRate = ratedSets.length
    ? ratedSets.filter((x) => x.form!.rating === 'clean').length / ratedSets.length
    : null
  // Counts both what the athlete reported and what the camera measured. The
  // camera's reading survives even when a set was never rated, so a recurring
  // fault is not invisible just because the rest screen was skipped.
  const issueCounts = new Map<string, number>()
  const cameraSets = sessions.slice(-8).flatMap((s) => s.sets.filter((x) => x.form?.auto && x.section === 'main'))
  for (const s of ratedSets) for (const i of s.form?.issues ?? []) issueCounts.set(i, (issueCounts.get(i) ?? 0) + 1)
  for (const s of cameraSets) {
    for (const i of s.form!.auto!.issues) {
      // Half-weight: an unconfirmed machine reading is weaker evidence than
      // the athlete saying it themselves.
      issueCounts.set(i, (issueCounts.get(i) ?? 0) + 0.5)
    }
  }
  const topEntry = [...issueCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const topFormIssue =
    topEntry && topEntry[1] >= 2 ? { issue: topEntry[0], count: Math.round(topEntry[1]) } : null

  // Shakiness the camera saw, averaged over recent filmed sets: consistently
  // high means the prescribed holds are sitting at the very limit.
  const wobbles = cameraSets.map((s) => s.form!.auto!.wobble).filter((w): w is number => w !== undefined)
  const meanWobble = wobbles.length >= 3 ? wobbles.reduce((a, b) => a + b, 0) / wobbles.length : null
  // Chasing seconds while positions fall apart is the classic way to stall.
  const half = Math.floor(ratedSets.length / 2)
  const cleanIn = (arr: typeof ratedSets) =>
    arr.length ? arr.filter((x) => x.form!.rating === 'clean').length / arr.length : null
  const earlyClean = half >= 2 ? cleanIn(ratedSets.slice(0, half)) : null
  const lateClean = half >= 2 ? cleanIn(ratedSets.slice(half)) : null
  const formDegrading =
    earlyClean !== null && lateClean !== null && lateClean < earlyClean - 0.25 && (trendPerWeek ?? 0) >= 0

  // ——— Bodyweight ———
  const weights = state.measurements.filter((m) => m.weightKg !== undefined)
  const weightKg = weights.length ? weights[weights.length - 1].weightKg! : null
  const weightTrendPerWeek = slopePerWeek(
    weights.slice(-8).map((m) => ({ at: m.at, value: m.weightKg! })),
  )

  const recentTen = sessions.slice(-10)
  const withWarmup = recentTen.filter((s) => s.sets.some((x) => x.section === 'warmup'))
  const warmupRate = recentTen.length ? withWarmup.length / recentTen.length : 1
  const skippedLastWarmup = last ? !last.sets.some((x) => x.section === 'warmup') : false

  const fourWeeksAgo = now - 28 * DAY
  const recentCount = sessions.filter((s) => s.startedAt >= fourWeeksAgo).length
  const sessionsPerWeek = recentCount / 4

  const lastTest = [...sessions].reverse().find((s) => s.workoutKind === 'test')
  const daysSinceMaxTest = lastTest ? Math.round((now - lastTest.startedAt) / DAY) : null

  const lastDeload = [...sessions].reverse().find((s) => s.workoutName.toLowerCase().includes('deload'))
  const weeksSinceDeload = lastDeload
    ? Math.floor((now - lastDeload.startedAt) / (7 * DAY))
    : Math.floor((now - (sessions[0]?.startedAt ?? now)) / (7 * DAY))

  const lastWithCheckIn = [...sessions].reverse().find((s) => s.checkIn)
  const lastCheckIn = freshCheckIn ?? lastWithCheckIn?.checkIn
  const daysSinceCheckIn = freshCheckIn
    ? 0
    : lastWithCheckIn
      ? Math.round((now - lastWithCheckIn.startedAt) / DAY)
      : null

  return {
    restDays,
    lastRpe: last?.rpe,
    lastCheckIn,
    daysSinceCheckIn,
    mainHitRate,
    mainSetCount,
    mainMedian,
    variability,
    noisy,
    trendPerWeek,
    lastWasOutlier,
    accessoryTrend,
    pressingLags,
    formCleanRate,
    formRatedCount: ratedSets.length,
    topFormIssue,
    meanWobble,
    cameraSetCount: cameraSets.length,
    formDegrading,
    weightKg,
    weightTrendPerWeek,
    warmupRate,
    skippedLastWarmup,
    sessionsPerWeek,
    daysSinceMaxTest,
    weeksSinceDeload,
    totalSessions: sessions.length,
  }
}
