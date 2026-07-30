import type { AppState, CheckIn, Session, SetLog } from '../types'
import { STEP_BY_ID } from '../data/progressions'
import { EXERCISE_BY_ID } from '../data/exercises'
import { dayKey } from './time'
import { progressionCredit, qualifyingSessionValue } from './progression'
import { leadInSecondsFor, stopLatencySecondsFor } from './sessionTiming'

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

/**
 * Camera output is strong enough to coach from only after the athlete reviewed
 * the set and the two sources broadly agree. A disputed or unconfirmed model
 * guess may still be shown beside the replay, but it must not quietly lower
 * future targets.
 */
export function trustedCameraEvidence(set: SetLog): boolean {
  const form = set.form
  const auto = form?.auto
  if (!form || form.confirmed !== true || !auto || auto.confidence < 0.5) return false
  const athleteClean = form.rating === 'clean'
  const cameraClean = auto.issues.length === 0 && (auto.cleanRatio ?? 1) >= 0.8
  return athleteClean === cameraClean
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
export function observedRestSec(
  session: Session,
  exerciseId: string,
  calibratedStopLatencySec = 2.3,
): number | null {
  const sets = keySetsOf(session, exerciseId, 'main').sort((a, b) => a.at - b.at)
  if (sets.length < 2) return null
  const rests: number[] = []
  for (let i = 1; i < sets.length; i++) {
    const gap = (sets[i].at - sets[i - 1].at) / 1000
    const work =
      sets[i].kind === 'hold'
        ? (sets[i].raw ?? sets[i].value + stopLatencySecondsFor(exerciseId, calibratedStopLatencySec))
        : sets[i].value * 3
    const lead = sets[i].kind === 'hold' ? (sets[i].leadInSec ?? leadInSecondsFor(exerciseId)) : 0
    const rest = gap - work - lead
    if (rest > 15 && rest < 600) rests.push(rest)
  }
  return median(rests)
}

/**
 * How much a session actually costs, in planche-relevant units.
 *
 * Not all training is equal: a minute of straight-arm planche work loads the
 * tendons far harder than a minute of wrist circles. Without this, a 10-minute
 * prehab session yesterday reads the same as a max session, and the coach
 * blocks a push day for no reason — or worse, schedules one after a beating.
 */
const CATEGORY_STRAIN: Record<string, number> = {
  planche: 1.5,
  push: 1.0,
  scapula: 0.8,
  core: 0.5,
  general: 0.2,
  wrist: 0.1,
  mobility: 0.1,
}

export function strainOf(session: Session): number {
  let s = 0
  for (const set of session.sets) {
    const cat = EXERCISE_BY_ID[set.exerciseId]?.category
    const factor = (cat && CATEGORY_STRAIN[cat]) || 0.3
    const seconds = set.kind === 'hold' ? set.value : set.value * 2
    s += seconds * factor
  }
  // RPE scales the whole session: the same sets at RPE 9 cost more than at 7.
  const rpeFactor = session.rpe ? Math.min(1.25, Math.max(0.75, session.rpe / 8)) : 1
  return s * rpeFactor
}

/** Below this a session is upkeep, not training — it should not block a push day. */
export const LOADED_STRAIN = 60

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

export interface SideGap {
  exerciseId: string
  weakSide: 'left' | 'right'
  weakMean: number
  strongMean: number
  /** 0–1 fraction the weak side trails the strong one by. */
  gapPct: number
}

export interface Signals {
  /** Days since the last logged session of any kind. */
  restDays: number
  lastRpe?: number
  /** Days since the last session with meaningful training load. */
  daysSinceLoaded: number
  /** RPE of that loaded session — a light prehab day can't mask it. */
  lastLoadedRpe?: number
  /**
   * Recent decayed load against the athlete's own 4-week normal.
   * ~1 = typical, >1.5 = piling up, <0.6 = well rested. Null without history.
   */
  readinessLoad: number | null
  /** Average daily strain over the last 28 days (or the shorter span actually logged). */
  chronicDailyStrain: number | null
  /** Left/right imbalance on unilateral work, when both sides have data. */
  sideGap: SideGap | null
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
  topFormIssue: { issue: string; count: number; of: number } | null
  /** Seconds are climbing while form ratings are getting worse. */
  formDegrading: boolean
  /** Average camera-measured shakiness across recent filmed sets. */
  meanWobble: number | null
  /** Average share of the timer that survived the camera's clean envelope. */
  meanCleanRatio: number | null
  /** How many sets the camera has measured recently. */
  cameraSetCount: number
  /** Average camera form score (0–100) across recent filmed sets. */
  meanFormScore: number | null
  /** Form-score points gained per week — quality progress the timer can't see. */
  formScoreTrend: number | null
  /**
   * A criterion the camera keeps failing to see. One blind clip is chance;
   * the same limb missing from most filmed sets is a fixable tripod problem.
   */
  chronicUnseen: { criterion: string; count: number; of: number } | null

  weightKg: number | null
  /** Bodyweight change per week over the last ~8 weeks. */
  weightTrendPerWeek: number | null

  sessionsPerWeek: number
  daysSinceMaxTest: number | null
  /** Weeks since the last deliberately easy week. */
  weeksSinceDeload: number
  /** True during the seven-day block started by the latest deload session. */
  deloadActive: boolean
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

  // ——— Training load: what recovery actually depends on ———
  const lastLoaded = [...sessions].reverse().find((s) => strainOf(s) >= LOADED_STRAIN)
  const daysSinceLoaded = lastLoaded
    ? Math.max(0, Math.round((new Date(dayKey(now)).getTime() - new Date(dayKey(lastLoaded.startedAt)).getTime()) / DAY))
    : 99
  const lastLoadedRpe = lastLoaded?.rpe

  const monthAgo = now - 28 * DAY
  const monthSessions = sessions.filter((s) => s.startedAt >= monthAgo)
  const chronicTotal = monthSessions.reduce((t, s) => t + strainOf(s), 0)
  // Divided over the days actually logged, not a flat 28: someone in their
  // first fortnight would otherwise read as ~2× "over their own normal" for
  // training at a perfectly steady cadence, and get technique days forever.
  const oldestMonth = monthSessions.length ? Math.min(...monthSessions.map((s) => s.startedAt)) : now
  const chronicSpanDays = Math.min(28, Math.max(7, (now - oldestMonth) / DAY))
  const chronicDailyStrain = monthSessions.length >= 4 ? chronicTotal / chronicSpanDays : null
  // Acute load: strain decayed with a 2-day half-life, so yesterday's session
  // weighs on today and last week's barely registers.
  // Age clamped at 0: a session stamped in the future (a device clock that
  // was wrong and then corrected) must not decay backwards into a multiplier.
  const acute = sessions
    .filter((s) => s.startedAt >= now - 7 * DAY)
    .reduce((t, s) => t + strainOf(s) * 0.5 ** (Math.max(0, now - s.startedAt) / (2 * DAY)), 0)
  // A "typical" acute value is ~2.5 days' worth of chronic load.
  const readinessLoad =
    chronicDailyStrain !== null && chronicDailyStrain > 5 ? acute / (chronicDailyStrain * 2.5) : null

  // ——— Left/right balance on unilateral work ———
  const sidedHolds = sessions
    .slice(-10)
    .flatMap((s) => s.sets.filter((x) => x.side && x.kind === 'hold' && x.value > 0))
  const byExercise = new Map<string, SetLog[]>()
  for (const x of sidedHolds) {
    const list = byExercise.get(x.exerciseId) ?? []
    list.push(x)
    byExercise.set(x.exerciseId, list)
  }
  let sideGap: SideGap | null = null
  const mostSided = [...byExercise.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  if (mostSided) {
    const [exerciseId, sets] = mostSided
    const leftVals = sets.filter((x) => x.side === 'left').map((x) => x.value)
    const rightVals = sets.filter((x) => x.side === 'right').map((x) => x.value)
    const l = median(leftVals)
    const r = median(rightVals)
    if (l !== null && r !== null && leftVals.length >= 2 && rightVals.length >= 2 && Math.max(l, r) > 0) {
      const weakSide = l < r ? 'left' : 'right'
      const weakMean = Math.min(l, r)
      const strongMean = Math.max(l, r)
      const gapPct = (strongMean - weakMean) / strongMean
      if (gapPct >= 0.15) sideGap = { exerciseId, weakSide, weakMean, strongMean, gapPct }
    }
  }

  // ——— Key-hold performance, measured robustly ———
  const withKey = sessions.filter((s) => qualifyingSessionValue(s, state.stepId) > 0)
  const recent = withKey.slice(-6)
  const recentBests = recent.map((s) => qualifyingSessionValue(s, state.stepId))
  const mainMedian = median(recentBests)
  const spread = mad(recentBests)
  const variability = mainMedian && mainMedian > 0 && spread !== null ? spread / mainMedian : null
  // Isometrics swing day to day; past ~22% deviation the signal is mostly noise.
  const noisy = variability !== null && variability > 0.22 && recentBests.length >= 3

  const trendPerWeek = slopePerWeek(
    withKey.slice(-6).map((s) => ({ at: s.startedAt, value: qualifyingSessionValue(s, state.stepId) })),
  )

  // Hit rate from the most recent session that actually trained the key hold,
  // not the literal last session — a wrist day in between used to null this
  // out and silently skip the target adjustment.
  let mainHitRate: number | null = null
  let mainSetCount = 0
  const lastRelevant = [...sessions]
    .reverse()
    .find((s) => now - s.startedAt <= 14 * DAY && keySetsOf(s, keyId, 'main').length > 0)
  if (lastRelevant) {
    const mains = keySetsOf(lastRelevant, keyId, 'main')
    mainSetCount = mains.length
    mainHitRate = mains.filter((s) => progressionCredit(s, keyId) >= s.target).length / mains.length
  }

  // An outlier is a value far outside the robust range of the ones before it.
  let lastWasOutlier = false
  if (withKey.length >= 4) {
    const prior = withKey.slice(-5, -1).map((s) => qualifyingSessionValue(s, state.stepId))
    const pm = median(prior)
    const pmad = mad(prior)
    const latest = qualifyingSessionValue(withKey[withKey.length - 1], state.stepId)
    if (pm !== null && pmad !== null && pmad > 0) {
      lastWasOutlier = Math.abs(latest - pm) > Math.max(3, 3.5 * pmad)
    }
  }

  // ——— Accessory pressing work ———
  const pressIds = ['pppu', 'pike-pushup', 'tuck-planche-pushup', 'pushup', 'dip']
  const recentPressSessions = sessions.slice(-12)
  const pressId =
    pressIds
      .map((id) => ({
        id,
        count: recentPressSessions.filter((s) => bestIn(s, id) > 0).length,
      }))
      .sort((a, b) => b.count - a.count)[0]?.id ?? pressIds[0]
  // Compare one repeated movement with itself. Raw reps from push-ups, dips
  // and PPPUs are not interchangeable strength units.
  const pressPoints = recentPressSessions
    .map((s) => {
      const best = bestIn(s, pressId)
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
    .flatMap((s) =>
      s.sets.filter(
        (x) =>
          x.exerciseId === keyId && x.form && x.form.confirmed !== false && x.section === 'main',
      ),
    )
  const formCleanRate = ratedSets.length
    ? ratedSets.filter((x) => x.form!.rating === 'clean').length / ratedSets.length
    : null
  // Counts both what the athlete reported and what the camera measured. The
  // camera's reading survives even when a set was never rated, so a recurring
  // fault is not invisible just because the rest screen was skipped.
  // Weight decides what surfaces; the count is what gets reported. Reporting
  // the weight as a set count understates how often something actually
  // happened — five camera-detected faults are five sets, not three.
  const issueWeight = new Map<string, number>()
  const issueSets = new Map<string, number>()
  const bump = (i: string, w: number) => {
    issueWeight.set(i, (issueWeight.get(i) ?? 0) + w)
    issueSets.set(i, (issueSets.get(i) ?? 0) + 1)
  }
  const cameraSets = sessions
    .slice(-8)
    .flatMap((s) =>
      s.sets.filter(
        (x) =>
          x.exerciseId === keyId && x.form?.auto && Array.isArray(x.form.auto.issues) && x.section === 'main',
      ),
    )
  const trustedCameraSets = cameraSets.filter(trustedCameraEvidence)
  for (const s of cameraSets) {
    // Never count the same fault twice. Athlete-reported issues are strongest;
    // camera-only issues join coaching only after the athlete reviewed the set
    // and broadly agreed. A disputed model guess stays visible in the replay,
    // but never becomes a training prescription.
    const athleteIssues = s.form?.issues ?? []
    if (s.form?.confirmed !== false && athleteIssues.length) {
      for (const i of athleteIssues) bump(i, 1)
    } else if (trustedCameraEvidence(s)) {
      for (const i of s.form!.auto!.issues) bump(i, 0.75)
    }
  }
  for (const s of ratedSets.filter((s) => !s.form?.auto)) {
    for (const i of s.form?.issues ?? []) bump(i, 1)
  }
  const topEntry = [...issueWeight.entries()].sort((a, b) => b[1] - a[1])[0]
  const reviewedEvidenceCount = new Set([...ratedSets, ...trustedCameraSets]).size
  const topIssueCount = topEntry ? (issueSets.get(topEntry[0]) ?? 0) : 0
  // More clips should create consensus, not more lottery tickets for a false
  // warning. Once four or more reviewed sets exist, a camera limiter must
  // recur in at least 40% of them before it can shape accessory work.
  const topFormIssue =
    topEntry &&
    topEntry[1] >= 1.5 &&
    topIssueCount >= 2 &&
    (reviewedEvidenceCount < 4 || topIssueCount / reviewedEvidenceCount >= 0.4)
      ? { issue: topEntry[0], count: topIssueCount, of: reviewedEvidenceCount }
      : null

  // Shakiness the camera saw, averaged over recent filmed sets: consistently
  // high means the prescribed holds are sitting at the very limit.
  const wobbles = trustedCameraSets
    .map((s) => s.form!.auto!.wobble)
    .filter((w): w is number => w !== undefined)
  const meanWobble = wobbles.length >= 3 ? wobbles.reduce((a, b) => a + b, 0) / wobbles.length : null
  const cleanRatios = trustedCameraSets
    .map((s) => s.form!.auto!.cleanRatio)
    .filter((ratio): ratio is number => ratio !== undefined)
  const meanCleanRatio =
    cleanRatios.length >= 3 ? cleanRatios.reduce((a, b) => a + b, 0) / cleanRatios.length : null

  // Camera form scores over time: seconds can flatline while the position
  // quietly improves (or rot while seconds climb) — this is the quality axis.
  const scorePoints = trustedCameraSets
    .map((s) => ({ at: s.at, value: s.form!.auto!.score }))
    .filter((p): p is { at: number; value: number } => p.value !== undefined)
  const meanFormScore =
    scorePoints.length >= 3 ? scorePoints.reduce((t, p) => t + p.value, 0) / scorePoints.length : null
  const formScoreTrend = slopePerWeek(scorePoints)

  // The criterion the camera most often could not see. Majority-of-sets is the
  // bar: below that it is framing luck, above it the phone placement itself is
  // the thing to coach.
  const unseenCounts = new Map<string, number>()
  for (const s of cameraSets) {
    for (const u of s.form!.auto!.unseen ?? []) unseenCounts.set(u, (unseenCounts.get(u) ?? 0) + 1)
  }
  const topUnseen = [...unseenCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const chronicUnseen =
    topUnseen && cameraSets.length >= 3 && topUnseen[1] / cameraSets.length >= 0.6
      ? { criterion: topUnseen[0], count: topUnseen[1], of: cameraSets.length }
      : null
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
  let deloadActive = false
  if (lastDeload && now - lastDeload.startedAt < 7 * DAY) {
    const lastIndex = sessions.indexOf(lastDeload)
    let blockStart = lastDeload.startedAt
    for (let i = lastIndex - 1; i >= 0; i--) {
      if (!sessions[i].workoutName.toLowerCase().includes('deload')) break
      blockStart = sessions[i].startedAt
    }
    deloadActive = now - blockStart < 7 * DAY
  }

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
    daysSinceLoaded,
    lastLoadedRpe,
    readinessLoad,
    chronicDailyStrain,
    sideGap,
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
    meanCleanRatio,
    cameraSetCount: trustedCameraSets.length,
    meanFormScore,
    formScoreTrend,
    chronicUnseen,
    formDegrading,
    weightKg,
    weightTrendPerWeek,
    warmupRate,
    skippedLastWarmup,
    sessionsPerWeek,
    daysSinceMaxTest,
    weeksSinceDeload,
    deloadActive,
    totalSessions: sessions.length,
  }
}
