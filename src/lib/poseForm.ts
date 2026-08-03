import type { FormIssue } from '../types'
import { getBackend, trackingScore, type Kp, type PoseBackend } from './poseBackend'

export { poseModelReady, warmDetector } from './poseBackend'

/**
 * Automatic form analysis from a recorded clip.
 *
 * A pose model gives 2D keypoints; the useful part is what you compute from
 * them. Every step of the road is a different shape, so a single set of rules
 * would be wrong most of the time — a tuck planche is *supposed* to have bent
 * knees, a frog stand is *supposed* to have bent arms. Each position therefore
 * gets its own profile saying which checks apply and at what thresholds.
 *
 * Everything here is advisory. Pose models are trained overwhelmingly on
 * upright people, so a horizontal athlete is exactly the case they are worst
 * at — results are gated on keypoint confidence and always land as a
 * *suggestion* the athlete confirms.
 */

export interface PoseFormResult {
  ok: boolean
  reason?: string
  confidence: number
  framesUsed: number
  /** Moments requested across the hold; `framesUsed` is the usable subset. */
  framesSampled?: number
  /**
   * Overall form score, 0–100, aggregated with FIG-style deduction bands over
   * the criteria that were actually judged. Advisory and explainable — the
   * per-criterion breakdown is in `subscores`.
   */
  score?: number
  /** Per-criterion 0–100 scores behind the headline number. */
  subscores?: FormSubscore[]
  /** The single highest-priority correction, CaliPro-style: one cue, not ten. */
  fixFirst?: { issue: FormIssue; cue: string }
  /**
   * What the model saw, for drawing a skeleton over the replay. Transient —
   * never persisted; kept light by pruning to the joints the verdict used.
   */
  track?: PoseTrack
  /** Credited seconds before the first sustained, material form breakdown. */
  cleanSeconds?: number
  /** Clean seconds divided by the timer's credited hold. */
  cleanRatio?: number
  /** Representative sustained elbow angle, degrees (180 = locked). */
  elbowDeg?: number
  /** Shoulder→hip→knee angle: how open the hips are. */
  hipAngleDeg?: number
  /** Representative sustained knee angle. */
  kneeDeg?: number
  /** Hip height relative to shoulders, as a fraction of torso length.
   * Positive = hips above shoulders. */
  hipOffset?: number
  /** How far shoulders sit past the wrists, as a fraction of torso length. */
  leanRatio?: number
  /** Shoulder-to-ear gap over torso length; small means shrugged. */
  shrugRatio?: number
  /** Positional drift per second — high means the hold was slipping. */
  wobble?: number
  /** Shoulder-line vs hip-line mismatch, over torso length. */
  asymmetry?: number
  issues: FormIssue[]
  notes: string[]
  /** Things that went well, so the feedback is not only negative. */
  good: string[]
  /** Secondary observations — shown folded away to keep the panel readable. */
  details: string[]
  /**
   * Criteria this position cares about that the camera could not see well
   * enough to grade. The rest of the result is still valid — these are simply
   * not part of it.
   */
  unseen: string[]
}

const MIN_KP_SCORE = 0.3
/** Fine angle/line judgements need more than the minimum "joint exists" score. */
const MIN_PRECISE_KP_SCORE = 0.42
const MIN_FAR_KP_SCORE = 0.6
const MIN_FRAMES = 3
export const MIN_VERIFIABLE_HOLD_SEC = 1

/** Tracked poses mapped back to source-frame pixels, for replay overlays. */
export interface PoseTrack {
  width: number
  height: number
  frames: { t: number; kps: Kp[] }[]
}

/**
 * Pose to draw at an arbitrary replay time.
 *
 * Analysis samples are intentionally much slower than video playback. Drawing
 * the nearest sample made the skeleton pop from one frozen location to the
 * next. Interpolate only across a short, genuinely observed gap; a longer hole
 * stays blank so the overlay never pretends the detector saw what it missed.
 */
export function poseKeypointsAtTime(
  track: PoseTrack,
  time: number,
  maxSpanSec = 0.9,
): Kp[] {
  if (!track.frames.length || !Number.isFinite(time)) return []
  let afterIndex = track.frames.findIndex((frame) => frame.t >= time)
  if (afterIndex < 0) afterIndex = track.frames.length
  const before = afterIndex > 0 ? track.frames[afterIndex - 1] : undefined
  const after = afterIndex < track.frames.length ? track.frames[afterIndex] : undefined

  if (before && after) {
    const span = after.t - before.t
    if (span >= 0 && span <= maxSpanSec) {
      if (span === 0) return before.kps
      const weight = Math.max(0, Math.min(1, (time - before.t) / span))
      const afterByName = new Map(after.kps.filter((kp) => kp.name).map((kp) => [kp.name!, kp]))
      return before.kps.flatMap((point) => {
        if (!point.name) return []
        const next = afterByName.get(point.name)
        if (!next) return []
        return [{
          name: point.name,
          x: point.x + (next.x - point.x) * weight,
          y: point.y + (next.y - point.y) * weight,
          score: Math.min(point.score ?? 1, next.score ?? 1),
        }]
      })
    }
  }

  const nearest = [before, after]
    .filter((frame): frame is PoseTrack['frames'][number] => Boolean(frame))
    .sort((a, b) => Math.abs(a.t - time) - Math.abs(b.t - time))[0]
  return nearest && Math.abs(nearest.t - time) <= maxSpanSec / 2 ? nearest.kps : []
}

export interface FormSubscore {
  key: 'elbow' | 'knee' | 'hipAngle' | 'line' | 'lean' | 'shrug' | 'steadiness' | 'cleanTime'
  label: string
  score: number
}

/**
 * What "correct" means for each position. Only the checks listed run, which
 * is what stops the analyser flagging the deliberate shapes of a progression.
 */
export interface PoseProfile {
  label: string
  /** No geometric checks apply — say so rather than implying it looked good. */
  noChecks?: boolean
  /** Straight-arm target (180 degrees). Undefined = do not check. */
  minElbowDeg?: number
  /** Knee angle below this counts as bent. Undefined = legs are meant to bend. */
  minKneeDeg?: number
  /** Allowed |hip − shoulder| height, as a fraction of torso. */
  levelTolerance?: number
  /** Hips should be at least this open (shoulder–hip–knee degrees). */
  minHipAngleDeg?: number
  /** Shoulders should travel at least this far past the wrists. */
  minLeanRatio?: number
  /** Judge the deliberately extended leg, rather than the tucked leg. */
  oneLeg?: boolean
  checkShrug: boolean
}

export interface FrameReading {
  t: number
  elbowDeg?: number
  kneeDeg?: number
  hipAngleDeg?: number
  hipOffset?: number
  leanRatio?: number
  shrugRatio?: number
  asymmetry?: number
}

/**
 * Pose estimates are not exact enough for a measurement sitting one pixel
 * beyond a profile threshold to become a red form fault. These deadbands are
 * shared by the clean-window and headline verdict so those two answers cannot
 * contradict one another.
 */
const MATERIAL_TOLERANCE = {
  // Tight enough to catch a visible soft elbow without turning sub-pixel
  // landmark jitter into a fault. The bend still has to persist across
  // several samples before it reaches the verdict.
  elbowDeg: 3,
  kneeDeg: 7,
  hipAngleDeg: 8,
  lineRatio: 0.06,
  leanRatio: 0.06,
  shrugRatio: 0.05,
  asymmetryRatio: 0.05,
} as const

export const POSE_PROFILES: Record<string, PoseProfile> = {
  'ppp-hold': {
    label: 'Pseudo planche plank',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.45,
    minHipAngleDeg: 170,
    minLeanRatio: 0.15,
    checkShrug: true,
  },
  'planche-lean': {
    label: 'Planche lean',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.4,
    minHipAngleDeg: 170,
    minLeanRatio: 0.3,
    checkShrug: true,
  },
  'frog-stand': {
    // Balance, not shape: bent arms and tucked knees are both correct here, so
    // there is nothing meaningful to measure. Saying that is better than
    // running zero checks and reporting "clean".
    label: 'Frog stand',
    noChecks: true,
    checkShrug: false,
  },
  'tuck-planche': {
    // Knees are meant to be at the chest, so knee and hip angles are not faults.
    label: 'Tuck planche',
    minElbowDeg: 180,
    levelTolerance: 0.22,
    minLeanRatio: 0.25,
    checkShrug: true,
  },
  'adv-tuck-planche': {
    label: 'Advanced tuck planche',
    minElbowDeg: 180,
    levelTolerance: 0.16,
    minHipAngleDeg: 82,
    minLeanRatio: 0.32,
    checkShrug: true,
  },
  'one-leg-lean': {
    label: 'One-leg planche lean',
    minElbowDeg: 180,
    levelTolerance: 0.4,
    minHipAngleDeg: 165,
    minLeanRatio: 0.3,
    checkShrug: true,
  },
  'one-leg-planche': {
    label: 'One-leg extension',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.14,
    minHipAngleDeg: 175,
    minLeanRatio: 0.36,
    oneLeg: true,
    checkShrug: true,
  },
  'straddle-planche': {
    label: 'Straddle planche',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.12,
    minHipAngleDeg: 175,
    minLeanRatio: 0.4,
    checkShrug: true,
  },
  'band-straddle-planche': {
    label: 'Band-assisted straddle',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.14,
    minHipAngleDeg: 172,
    minLeanRatio: 0.32,
    checkShrug: true,
  },
  'full-planche': {
    label: 'Full planche',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.1,
    minHipAngleDeg: 178,
    minLeanRatio: 0.45,
    checkShrug: true,
  },
}

/** Which of a position's criteria the camera saw well enough to grade. */
export interface JudgedCriteria {
  elbow: boolean
  knee: boolean
  hipAngle: boolean
  line: boolean
  lean: boolean
}

/** How many frames carried each measurement. */
export interface CoverageCounts {
  elbows: number
  knees: number
  hipAngles: number
  hipOffsets: number
  leans: number
}

/**
 * Decide which of a position's criteria this clip can actually grade.
 *
 * A criterion needs a measurement in a majority of tracked frames. Falling
 * short costs that criterion its verdict and nothing else — the point of
 * grading partially is that one limb wandering out of shot should not throw
 * away everything the camera did see. Exported so the rule stays tested.
 */
export function gradeCoverage(
  profile: PoseProfile,
  counts: CoverageCounts,
  framesUsed: number,
): { judged: JudgedCriteria; unseen: string[] } {
  const need = Math.max(MIN_FRAMES, Math.ceil(framesUsed * 0.55))
  const applies = (threshold: number | undefined, seen: number) => threshold !== undefined && seen >= need
  const judged: JudgedCriteria = {
    elbow: applies(profile.minElbowDeg, counts.elbows),
    knee: applies(profile.minKneeDeg, counts.knees),
    hipAngle: applies(profile.minHipAngleDeg, counts.hipAngles),
    line: applies(profile.levelTolerance, counts.hipOffsets),
    lean: applies(profile.minLeanRatio, counts.leans),
  }
  const unseen: string[] = []
  if (profile.minElbowDeg !== undefined && !judged.elbow) unseen.push('elbows')
  if (profile.minKneeDeg !== undefined && !judged.knee) unseen.push('knees')
  if (profile.minHipAngleDeg !== undefined && !judged.hipAngle) unseen.push('hips')
  if (profile.levelTolerance !== undefined && !judged.line) unseen.push('body line')
  if (profile.minLeanRatio !== undefined && !judged.lean) unseen.push('forward lean')
  return { judged, unseen }
}

/**
 * A small tolerance outside the headline thresholds keeps one near-boundary
 * estimate from stealing time. These are deliberately still narrow enough to
 * catch a material loss of the position.
 *
 * `judged` scopes this to the criteria the clip could actually see. A criterion
 * that was never visible is not evidence of anything and is left out entirely;
 * one that is normally visible but missing from *this* frame still makes the
 * frame unjudgeable, so a limb leaving the shot cannot buy clean seconds.
 */
export function materialIssuesForReading(
  frame: FrameReading,
  profile: PoseProfile,
  judged: JudgedCriteria,
): FormIssue[] {
  const issues: FormIssue[] = []
  if (
    judged.elbow &&
    profile.minElbowDeg !== undefined &&
    frame.elbowDeg !== undefined &&
    frame.elbowDeg < profile.minElbowDeg - MATERIAL_TOLERANCE.elbowDeg
  ) {
    issues.push('arms')
  }
  if (
    judged.knee &&
    profile.minKneeDeg !== undefined &&
    frame.kneeDeg !== undefined &&
    frame.kneeDeg < profile.minKneeDeg - MATERIAL_TOLERANCE.kneeDeg
  ) {
    issues.push('knees')
  }
  if (
    judged.hipAngle &&
    profile.minHipAngleDeg !== undefined &&
    frame.hipAngleDeg !== undefined &&
    frame.hipAngleDeg < profile.minHipAngleDeg - MATERIAL_TOLERANCE.hipAngleDeg
  ) {
    issues.push('closed')
  }
  if (judged.line && profile.levelTolerance !== undefined && frame.hipOffset !== undefined) {
    if (frame.hipOffset > profile.levelTolerance + MATERIAL_TOLERANCE.lineRatio) issues.push('pike')
    if (frame.hipOffset < -profile.levelTolerance - MATERIAL_TOLERANCE.lineRatio) issues.push('sag')
  }
  if (
    judged.lean &&
    profile.minLeanRatio !== undefined &&
    frame.leanRatio !== undefined &&
    frame.leanRatio < profile.minLeanRatio - MATERIAL_TOLERANCE.leanRatio
  ) {
    issues.push('lean')
  }
  if (
    profile.checkShrug &&
    frame.shrugRatio !== undefined &&
    frame.shrugRatio < 0.32 - MATERIAL_TOLERANCE.shrugRatio
  ) {
    issues.push('shrug')
  }
  if (
    frame.asymmetry !== undefined &&
    frame.asymmetry > 0.18 + MATERIAL_TOLERANCE.asymmetryRatio
  ) {
    issues.push('twist')
  }
  return issues
}

/**
 * Name faults that really persisted, even when they began late in the hold.
 *
 * The clean-window code deliberately grades the shape before a breakdown, but
 * that used to erase the cause from the final issue list: a locked arm that
 * softened for the final two seconds shortened clean time while still being
 * reported as "no measured issue". This mirrors the same sample-count and
 * elapsed-time gate used for clean time, per issue, so one noisy frame still
 * cannot accuse the athlete of a fault.
 */
export function sustainedMaterialIssues(
  samples: { t: number; issues: FormIssue[] }[],
  minimumBadSamples = 3,
  minimumBadDurationSec = 0.75,
): FormIssue[] {
  const sorted = [...samples].sort((a, b) => a.t - b.t)
  const candidates = [...new Set(sorted.flatMap((sample) => sample.issues))]
  return candidates.filter((issue) => {
    let run = 0
    let startedAt = 0
    for (const sample of sorted) {
      if (!sample.issues.includes(issue)) {
        run = 0
        continue
      }
      if (run === 0) startedAt = sample.t
      run += 1
      if (
        run >= Math.max(1, minimumBadSamples) &&
        sample.t - startedAt >= Math.max(0, minimumBadDurationSec)
      ) {
        return true
      }
    }
    return false
  })
}

function materiallyOutsideEnvelope(
  frame: FrameReading,
  profile: PoseProfile,
  judged: JudgedCriteria,
): boolean | null {
  const required: (number | undefined)[] = []
  if (profile.minElbowDeg !== undefined && judged.elbow) required.push(frame.elbowDeg)
  if (profile.minKneeDeg !== undefined && judged.knee) required.push(frame.kneeDeg)
  if (profile.minHipAngleDeg !== undefined && judged.hipAngle) required.push(frame.hipAngleDeg)
  if (profile.levelTolerance !== undefined && judged.line) required.push(frame.hipOffset)
  if (profile.minLeanRatio !== undefined && judged.lean) required.push(frame.leanRatio)
  if (required.some((value) => value === undefined)) return null
  return materialIssuesForReading(frame, profile, judged).length > 0
}

type ReadingMetric = Exclude<keyof FrameReading, 't'>

/**
 * Remove a one-sample joint snap when the estimates immediately before and
 * after agree. This operates per metric: a bad ankle must not throw away a
 * well-tracked elbow from the same frame. Gradual movement and sustained
 * changes survive because their neighbouring samples do not agree.
 */
export function suppressIsolatedMetricSpikes(
  frames: FrameReading[],
): { metricsIgnored: number; framesTouched: number } {
  const tolerances: Partial<Record<ReadingMetric, number>> = {
    elbowDeg: 22,
    kneeDeg: 24,
    hipAngleDeg: 26,
    hipOffset: 0.32,
    leanRatio: 0.32,
    shrugRatio: 0.2,
    asymmetry: 0.24,
  }
  const source = frames.map((frame) => ({ ...frame }))
  const touched = new Set<number>()
  let metricsIgnored = 0

  for (const [key, tolerance] of Object.entries(tolerances) as [ReadingMetric, number][]) {
    for (let i = 1; i < source.length - 1; i++) {
      const prev = source[i - 1][key]
      const value = source[i][key]
      const next = source[i + 1][key]
      if (prev === undefined || value === undefined || next === undefined) continue
      if (
        Math.abs(prev - next) <= tolerance * 0.55 &&
        Math.abs(value - prev) > tolerance &&
        Math.abs(value - next) > tolerance
      ) {
        delete frames[i][key]
        touched.add(i)
        metricsIgnored++
      }
    }
  }

  return { metricsIgnored, framesTouched: touched.size }
}

/**
 * Returns the portion of a hold before a sustained breakdown. Both a minimum
 * sample count and real elapsed time are required, so increasing sampling
 * density cannot make the same movement fail sooner.
 */
export function sustainedCleanSeconds(
  samples: { t: number; bad: boolean }[],
  creditedHoldSec: number,
  minimumBadSamples = 3,
  minimumBadDurationSec = 0.75,
): number {
  const hold = Math.max(0, creditedHoldSec)
  let badRun = 0
  let badRunStartedAt = hold
  for (const sample of [...samples].sort((a, b) => a.t - b.t)) {
    if (!sample.bad) {
      badRun = 0
      badRunStartedAt = hold
      continue
    }
    if (badRun === 0) badRunStartedAt = sample.t
    badRun += 1
    if (
      badRun >= Math.max(1, minimumBadSamples) &&
      sample.t - badRunStartedAt >= Math.max(0, minimumBadDurationSec)
    ) {
      return Math.round(Math.min(hold, Math.max(0, badRunStartedAt)) * 10) / 10
    }
  }
  return Math.round(hold * 10) / 10
}

/**
 * A sampled moment with incomplete pose evidence cannot prove the athlete was
 * still holding. One brief miss remains harmless because sustainedCleanSeconds
 * requires a real run; a fast drop or leaving the frame ends the clean window.
 */
export function sustainedObservableCleanSeconds(
  samples: { t: number; bad: boolean | null }[],
  creditedHoldSec: number,
): number {
  return sustainedCleanSeconds(
    samples.map((sample) => ({ t: sample.t, bad: sample.bad !== false })),
    creditedHoldSec,
  )
}

export function hasVerifiableHoldDuration(creditedHoldSec: number): boolean {
  return Number.isFinite(creditedHoldSec) && creditedHoldSec >= MIN_VERIFIABLE_HOLD_SEC
}

/** Positions worth filming for automated or replay-based form review. */
export function isFilmable(exerciseId: string): boolean {
  return exerciseId in POSE_PROFILES
}

function angleDeg(a: Kp, b: Kp, c: Kp): number {
  const abx = a.x - b.x
  const aby = a.y - b.y
  const cbx = c.x - b.x
  const cby = c.y - b.y
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby)
  if (mag === 0) return NaN
  return (Math.acos(Math.max(-1, Math.min(1, (abx * cbx + aby * cby) / mag))) * 180) / Math.PI
}

/**
 * Rotation-invariant mismatch between the shoulder and hip lines, 0â€“1.
 * Comparing their raw vertical offsets made a wider shoulder line look more
 * twisted and a narrower one look straighter. The sine of the angle between
 * the two unoriented lines measures the rotation itself and cancels phone roll.
 */
export function shoulderHipLineMismatch(
  leftShoulder: Kp,
  rightShoulder: Kp,
  leftHip: Kp,
  rightHip: Kp,
): number | undefined {
  const shoulderX = rightShoulder.x - leftShoulder.x
  const shoulderY = rightShoulder.y - leftShoulder.y
  const hipX = rightHip.x - leftHip.x
  const hipY = rightHip.y - leftHip.y
  const scale = Math.hypot(shoulderX, shoulderY) * Math.hypot(hipX, hipY)
  if (scale < 1) return undefined
  return Math.abs(shoulderX * hipY - shoulderY * hipX) / scale
}

/** Hip height against the shoulder line. A clearly observed second side is
 * averaged to cancel mild three-quarter-view perspective; side-on footage
 * keeps the visible side and never relies on an occluded landmark guess. */
export function shoulderHipLevelOffset(
  shoulder: Kp,
  hip: Kp,
  farShoulder?: Kp,
  farHip?: Kp,
): number | undefined {
  const hasFarSide = Boolean(farShoulder && farHip)
  const shoulderPoint = hasFarSide
    ? { x: (shoulder.x + farShoulder!.x) / 2, y: (shoulder.y + farShoulder!.y) / 2 }
    : shoulder
  const hipPoint = hasFarSide
    ? { x: (hip.x + farHip!.x) / 2, y: (hip.y + farHip!.y) / 2 }
    : hip
  const torso = Math.hypot(shoulderPoint.x - hipPoint.x, shoulderPoint.y - hipPoint.y)
  if (torso < 1) return undefined
  return (shoulderPoint.y - hipPoint.y) / torso
}

/**
 * Reject an angle built from anatomically implausible segment lengths. Pose
 * models can put an elbow almost on the shoulder while leaving a high
 * confidence score; the resulting angle is numerically valid but is not a
 * credible arm measurement.
 */
export function reliableJointAngle(a: Kp, b: Kp, c: Kp, bodyScale: number): number | undefined {
  if (!Number.isFinite(bodyScale) || bodyScale <= 0) return undefined
  const first = Math.hypot(a.x - b.x, a.y - b.y)
  const second = Math.hypot(c.x - b.x, c.y - b.y)
  const shorter = Math.min(first, second)
  const longer = Math.max(first, second)
  if (
    shorter < bodyScale * 0.18 ||
    longer > bodyScale * 1.35 ||
    longer / shorter > 2.2 ||
    first + second > bodyScale * 2.2
  ) {
    return undefined
  }
  const angle = angleDeg(a, b, c)
  return Number.isFinite(angle) ? angle : undefined
}

/**
 * Elbow angle with planche-specific hyperextension handling.
 *
 * An unsigned three-point angle reads 174 degrees for both a six-degree bend
 * and a six-degree hyperextension. Those are opposites in straight-arm work.
 * From a side view, flexion moves the elbow toward the hips while lockout or
 * hyperextension moves it away. Treat only the latter as locked; ambiguous
 * points keep their ordinary angle. The projection gate also rejects elbows
 * that the model placed beyond either end of the upper-arm/forearm chord.
 */
export function plancheArmAngle(
  shoulder: Kp,
  elbow: Kp,
  wrist: Kp,
  hip: Kp,
  bodyScale: number,
): number | undefined {
  const angle = reliableJointAngle(shoulder, elbow, wrist, bodyScale)
  if (angle === undefined) return undefined

  const chordX = wrist.x - shoulder.x
  const chordY = wrist.y - shoulder.y
  const chordSq = chordX * chordX + chordY * chordY
  if (chordSq < bodyScale * bodyScale * 0.08) return undefined
  const projection = ((elbow.x - shoulder.x) * chordX + (elbow.y - shoulder.y) * chordY) / chordSq
  if (projection < 0.08 || projection > 0.92) return undefined

  const onLineX = shoulder.x + chordX * projection
  const onLineY = shoulder.y + chordY * projection
  const torsoX = hip.x - shoulder.x
  const torsoY = hip.y - shoulder.y
  const torsoMag = Math.hypot(torsoX, torsoY)
  if (torsoMag < 1) return undefined
  const towardHips =
    ((elbow.x - onLineX) * torsoX + (elbow.y - onLineY) * torsoY) / torsoMag / bodyScale

  // Require a visible directional displacement. Tiny signs around zero are
  // normal landmark jitter and must not convert an uncertain 174 into 180.
  return 180 - angle >= 3 && towardHips < -0.018 ? 180 : angle
}

function byName(kps: Kp[], name: string, minScore = MIN_KP_SCORE): Kp | undefined {
  const k = kps.find((p) => p.name === name)
  return k && (k.score ?? 0) >= minScore ? k : undefined
}

function pickSide(kps: Kp[]): 'left' | 'right' | null {
  const score = (side: string) =>
    ['shoulder', 'elbow', 'wrist', 'hip'].reduce((t, part) => t + (byName(kps, `${side}_${part}`)?.score ?? 0), 0)
  const l = score('left')
  const r = score('right')
  if (Math.max(l, r) === 0) return null
  return l >= r ? 'left' : 'right'
}

/** Pick the best-observed side across the clip, not whichever won frame one. */
function pickStableSide(frames: { kps: Kp[] }[]): 'left' | 'right' | null {
  const score = (side: 'left' | 'right') =>
    frames.reduce(
      (total, frame) =>
        total +
        ['shoulder', 'elbow', 'wrist', 'hip'].reduce(
          (sum, part) => sum + (frame.kps.find((k) => k.name === `${side}_${part}`)?.score ?? 0),
          0,
        ),
      0,
    )
  const left = score('left')
  const right = score('right')
  if (Math.max(left, right) === 0) return null
  return left >= right ? 'left' : 'right'
}

/**
 * An occluded far limb often receives plausible-looking guessed landmarks.
 * Use it only when it is visibly separate from the primary limb; otherwise the
 * side-on camera can honestly grade only the near side.
 */
function sidesAreVisiblySeparate(
  kps: Kp[],
  primary: 'left' | 'right',
  secondary: 'left' | 'right',
  parts: string[],
  torso: number,
): boolean {
  const distances: number[] = []
  for (const part of parts) {
    const near = byName(kps, `${primary}_${part}`)
    const far = byName(kps, `${secondary}_${part}`, 0.55)
    if (near && far) distances.push(Math.hypot(near.x - far.x, near.y - far.y) / torso)
  }
  return distances.length >= 2 && distances.reduce((a, b) => a + b, 0) / distances.length >= 0.14
}

const BILATERAL_COLLISION_LIMITS = {
  elbow: 0.1,
  wrist: 0.12,
  knee: 0.1,
  ankle: 0.12,
} as const

/**
 * Side-on footage often makes the detector place both left/right endpoints on
 * the same visible hand or foot. That is one observation, not evidence from
 * two limbs. Keep the stable primary side and remove the duplicate far point
 * before building the overlay or measuring angles.
 */
export function suppressBilateralCollisions(
  frames: { kps: Kp[] }[],
  primarySide: 'left' | 'right',
): { jointsIgnored: number; framesTouched: number } {
  const secondarySide = primarySide === 'left' ? 'right' : 'left'
  const touched = new Set<number>()
  let jointsIgnored = 0
  for (const [frameIndex, frame] of frames.entries()) {
    const primaryShoulder = byName(frame.kps, `${primarySide}_shoulder`)
    const primaryHip = byName(frame.kps, `${primarySide}_hip`)
    const secondaryShoulder = byName(frame.kps, `${secondarySide}_shoulder`)
    const secondaryHip = byName(frame.kps, `${secondarySide}_hip`)
    const shoulder = primaryShoulder ?? secondaryShoulder
    const hip = primaryHip ?? secondaryHip
    if (!shoulder || !hip) continue
    const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
    if (torso < 1) continue

    for (const [part, limit] of Object.entries(BILATERAL_COLLISION_LIMITS)) {
      const primary = byName(frame.kps, `${primarySide}_${part}`)
      const secondary = byName(frame.kps, `${secondarySide}_${part}`)
      if (!primary || !secondary) continue
      if (Math.hypot(primary.x - secondary.x, primary.y - secondary.y) / torso >= limit) continue
      const at = frame.kps.findIndex((k) => k.name === `${secondarySide}_${part}`)
      if (at < 0) continue
      frame.kps.splice(at, 1)
      touched.add(frameIndex)
      jointsIgnored++
    }
  }
  return { jointsIgnored, framesTouched: touched.size }
}

/** Joints worth repairing across a dropout; the rest are never measured. */
const BRIDGEABLE = [
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'left_ear', 'right_ear',
]

/**
 * Fill single-frame keypoint dropouts by interpolating between the samples
 * either side. During a hold the body is close to static between samples, so a
 * joint that is tracked before and after but missing in between is a detector
 * miss rather than movement. Only isolated gaps are bridged — two consecutive
 * misses are treated as genuinely not visible, and the interpolated point
 * carries a reduced score so it never props up the confidence average.
 *
 * Exported for tests: silently inventing keypoints would be a bad bug, so the
 * boundaries of what this will and will not fabricate are pinned down.
 */
export function bridgeKeypointGaps(frames: { t: number; kps: Kp[] }[]): number {
  let repaired = 0
  const good = (kps: Kp[], name: string) => {
    const k = kps.find((p) => p.name === name)
    return k && (k.score ?? 0) >= MIN_KP_SCORE ? k : undefined
  }
  for (const name of BRIDGEABLE) {
    for (let i = 1; i < frames.length - 1; i++) {
      if (good(frames[i].kps, name)) continue
      const before = good(frames[i - 1].kps, name)
      const after = good(frames[i + 1].kps, name)
      if (!before || !after) continue
      const span = frames[i + 1].t - frames[i - 1].t
      const w = span > 0 ? (frames[i].t - frames[i - 1].t) / span : 0.5
      const score = Math.min(before.score ?? 0, after.score ?? 0) * 0.9
      if (score < MIN_KP_SCORE) continue
      const filled: Kp = {
        name,
        x: before.x + (after.x - before.x) * w,
        y: before.y + (after.y - before.y) * w,
        score,
      }
      const at = frames[i].kps.findIndex((p) => p.name === name)
      if (at >= 0) frames[i].kps[at] = filled
      else frames[i].kps.push(filled)
      repaired++
    }
  }
  return repaired
}

function torsoScale(kps: Kp[]): number | undefined {
  const lengths = (['left', 'right'] as const).flatMap((side) => {
    const shoulder = byName(kps, `${side}_shoulder`)
    const hip = byName(kps, `${side}_hip`)
    if (!shoulder || !hip) return []
    const length = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
    return length >= 1 ? [length] : []
  })
  return median(lengths)
}

/**
 * Repair an impossible one-sample landmark teleport.
 *
 * This deliberately has a much larger threshold than the form checks. A real
 * elbow bend, hip shift, or controlled exit survives; a wrist/body point that
 * leaps more than half a torso away and immediately returns does not. Reading
 * from a frozen copy prevents one repaired joint influencing the next one.
 */
export function stabilizeKeypointSpikes(
  frames: { t: number; kps: Kp[] }[],
): { jointsRepaired: number; framesTouched: number } {
  const source = frames.map((frame) => ({
    t: frame.t,
    kps: frame.kps.map((point) => ({ ...point })),
  }))
  const touched = new Set<number>()
  let jointsRepaired = 0
  const good = (kps: Kp[], name: string) => {
    const point = kps.find((candidate) => candidate.name === name)
    return point && (point.score ?? 0) >= MIN_KP_SCORE ? point : undefined
  }

  for (let i = 1; i < source.length - 1; i++) {
    const beforeFrame = source[i - 1]
    const frame = source[i]
    const afterFrame = source[i + 1]
    // Never infer smooth motion across sparse diagnostic sampling or a long
    // detector blackout.
    if (afterFrame.t - beforeFrame.t > 1.25) continue
    const scale = median([torsoScale(beforeFrame.kps), torsoScale(afterFrame.kps)].filter(
      (value): value is number => value !== undefined,
    ))
    if (scale === undefined || scale < 1) continue
    const span = afterFrame.t - beforeFrame.t
    const weight = span > 0 ? (frame.t - beforeFrame.t) / span : 0.5

    for (const name of BRIDGEABLE) {
      const before = good(beforeFrame.kps, name)
      const point = good(frame.kps, name)
      const after = good(afterFrame.kps, name)
      if (!before || !point || !after) continue
      const expectedX = before.x + (after.x - before.x) * weight
      const expectedY = before.y + (after.y - before.y) * weight
      const neighbourTravel = Math.hypot(after.x - before.x, after.y - before.y) / scale
      const residual = Math.hypot(point.x - expectedX, point.y - expectedY) / scale
      // Neighbours must agree first. The adaptive term prevents a fast but
      // smooth real movement being flattened just because its midpoint is not
      // perfectly linear.
      if (
        neighbourTravel > 0.32 ||
        residual <= Math.max(0.52, neighbourTravel * 2.5 + 0.16)
      ) continue

      const replacement: Kp = {
        ...point,
        x: expectedX,
        y: expectedY,
        score: Math.min(point.score ?? 0, before.score ?? 0, after.score ?? 0) * 0.9,
      }
      const at = frames[i].kps.findIndex((candidate) => candidate.name === name)
      if (at >= 0) frames[i].kps[at] = replacement
      touched.add(i)
      jointsRepaired++
    }
  }

  return { jointsRepaired, framesTouched: touched.size }
}

/** "elbows, knees and hips" — reads as a sentence rather than a CSV dump. */
function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Angles come back NaN when two keypoints coincide; never let that through. */
function push(arr: number[], v: number) {
  if (Number.isFinite(v)) arr.push(v)
}

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/**
 * MediaRecorder WebM has no duration in its header, so `video.duration` reads
 * Infinity — which used to fail every analysis on browsers without MP4
 * recording (Firefox, and Chromium builds without proprietary codecs).
 * Seeking far past the end forces the browser to compute the real duration.
 */
function resolveDuration(video: HTMLVideoElement): Promise<number> {
  const d = video.duration
  if (Number.isFinite(d) && d > 0) return Promise.resolve(d)
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      video.removeEventListener('durationchange', onChange)
      const real = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
      // Put playback back somewhere sane before sampling begins.
      try {
        video.currentTime = 0
      } catch {
        /* ignore */
      }
      resolve(real)
    }
    const onChange = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) finish()
    }
    video.addEventListener('durationchange', onChange)
    try {
      video.currentTime = 1e101
    } catch {
      finish()
    }
    window.setTimeout(finish, 3000)
  })
}

/**
 * Pose models are trained overwhelmingly on people who are standing up, so a
 * horizontal athlete is the single case they handle worst — and that is every
 * planche ever filmed. Feeding the detector a rotated frame puts the body back
 * near upright and recovers tracking that is otherwise simply lost.
 *
 * Keypoints come back in rotated space and are mapped straight back to the
 * original frame, so every measurement downstream still uses real screen axes:
 * angles are rotation-invariant anyway, but hip height and forward lean are
 * emphatically not.
 */
export type Rotation = 0 | 90 | 270

function drawRotated(video: HTMLVideoElement, canvas: HTMLCanvasElement, rotation: Rotation): boolean {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return false
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  canvas.width = rotation === 0 ? w : h
  canvas.height = rotation === 0 ? h : w
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (rotation === 90) {
    ctx.translate(h, 0)
    ctx.rotate(Math.PI / 2)
  } else if (rotation === 270) {
    ctx.translate(0, w)
    ctx.rotate(-Math.PI / 2)
  }
  ctx.drawImage(video, 0, 0, w, h)
  return true
}

/** Map keypoints from rotated-canvas space back into original frame space. */
export function unrotateKeypoints<T extends { x: number; y: number }>(
  kps: T[],
  rotation: Rotation,
  srcWidth: number,
  srcHeight: number,
): T[] {
  if (rotation === 0) return kps
  return kps.map((k) =>
    rotation === 90
      ? { ...k, x: k.y, y: srcHeight - k.x }
      : { ...k, x: srcWidth - k.y, y: k.x },
  )
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      video.removeEventListener('seeked', finish)
      resolve()
    }
    video.addEventListener('seeked', finish)
    video.currentTime = t
    window.setTimeout(finish, 600)
  })
}

/** A result that ran nothing, ready to carry a reason. */
export function emptyResult(reason?: string): PoseFormResult {
  return { ok: false, confidence: 0, framesUsed: 0, issues: [], notes: [], good: [], details: [], unseen: [], reason }
}

/**
 * Dense enough to observe a short loss of position, bounded so a long
 * foundations hold does not leave a phone running inference indefinitely.
 * Explicit sample counts remain exact for tests and diagnostic re-runs.
 */
export function chooseSampleCount(holdWindowSec: number, requested?: number): number {
  if (requested !== undefined && Number.isFinite(requested)) {
    return Math.max(1, Math.min(120, Math.round(requested)))
  }
  const seconds = Math.max(0, holdWindowSec)
  return Math.round(Math.min(72, Math.max(18, seconds * 3)))
}

async function analyseClipNow(
  blob: Blob,
  exerciseId: string,
  sampleCount?: number,
  creditedHoldSec?: number,
): Promise<PoseFormResult> {
  const empty = emptyResult()
  const profile = POSE_PROFILES[exerciseId]
  if (!profile) return { ...empty, reason: 'This movement is not one the camera can assess.' }
  if (profile.noChecks) {
    return {
      ...empty,
      reason: `A ${profile.label.toLowerCase()} is about balance rather than a fixed shape, so there is nothing here the camera can judge for you. Rate it yourself.`,
    }
  }
  if (creditedHoldSec !== undefined && !hasVerifiableHoldDuration(creditedHoldSec)) {
    return {
      ...empty,
      reason:
        'That attempt was too brief for the camera to verify a held position. Stay in the hold for at least 1 second — a quick touch-and-drop cannot be graded clean.',
    }
  }

  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.src = url

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('That clip could not be decoded.'))
      window.setTimeout(() => reject(new Error('That clip took too long to load.')), 10000)
    })

    const duration = await resolveDuration(video)
    if (duration === 0) return { ...empty, reason: 'That clip has no readable duration.' }

    // Analyse the credited hold, not the walk back to the phone after it. The
    // timer's value is intentionally the authority for where useful work ends.
    // Sample across nearly the whole credited hold. Three moments per second
    // gives the form judge enough context to distinguish a detector snap from
    // an actual loss of position; the cap keeps long foundation holds bounded.
    const holdWindow =
      creditedHoldSec !== undefined && Number.isFinite(creditedHoldSec) && creditedHoldSec > 0
        ? Math.min(duration, creditedHoldSec + 0.25)
        : duration
    const n = chooseSampleCount(holdWindow, sampleCount)
    const from = Math.min(holdWindow * 0.04, 0.15)
    const to = Math.max(from, holdWindow * 0.98)
    const times = Array.from({ length: n }, (_, i) =>
      n === 1 ? (from + to) / 2 : from + ((to - from) * i) / (n - 1),
    )

    const elbows: number[] = []
    const knees: number[] = []
    const hipAngles: number[] = []
    const hipOffsets: number[] = []
    const leans: number[] = []
    const shrugs: number[] = []
    const confidences: number[] = []
    const asymmetries: number[] = []
    const drifts: number[] = []
    const frameReadings: FrameReading[] = []
    // Timestamped copies of the metrics that fatigue visibly, so the hold can
    // be compared against itself: early third vs final third.
    const elbowSeries: { t: number; v: number }[] = []
    const lineSeries: { t: number; v: number }[] = []
    const leanSeries: { t: number; v: number }[] = []
    let frontalFrames = 0
    let trackedSide: 'left' | 'right' | null = null
    let prevAnchor: { sx: number; sy: number; hx: number; hy: number; torso: number; t: number } | null = null

    const srcW = video.videoWidth
    const srcH = video.videoHeight
    const canvas = document.createElement('canvas')

    // Choose the model *and* the orientation from the actual footage, on two
    // probe frames from the middle of the hold. Neither choice can be made
    // sensibly in the abstract: which model copes with a given body, lighting
    // and camera angle is exactly what the probe measures.
    const probes = [times[Math.floor(times.length / 3)], times[Math.floor((2 * times.length) / 3)]].filter(
      (t): t is number => t !== undefined,
    )
    const detectAt = async (backend: PoseBackend, candidate: Rotation): Promise<Kp[]> => {
      if (!srcW || !srcH || !drawRotated(video, canvas, candidate)) return backend.estimate(video)
      const found = await backend.estimate(canvas)
      return unrotateKeypoints(found, candidate, srcW, srcH)
    }

    const probeBackend = async (backend: PoseBackend) => {
      const totals = new Map<Rotation, number>()
      for (const t of probes) {
        await seekTo(video, t)
        for (const candidate of [0, 90, 270] as Rotation[]) {
          totals.set(candidate, (totals.get(candidate) ?? 0) + trackingScore(await detectAt(backend, candidate)))
        }
      }
      let best: { rotation: Rotation; score: number } = { rotation: 0, score: -1 }
      for (const [candidate, total] of totals) {
        const score = total / Math.max(1, probes.length)
        // Ties keep the unrotated frame: rotating is only worth it when it
        // measurably helps.
        if (score > best.score + 1e-6) best = { rotation: candidate, score }
      }
      return best
    }

    let backend = await getBackend('mediapipe').catch(() => getBackend('movenet'))
    let best = await probeBackend(backend)
    // Only pay for the second model when the first one struggled — each is a
    // multi-megabyte download, and on good footage the first is already right.
    if (best.score < 0.55 && backend.id === 'mediapipe') {
      const alt = await getBackend('movenet').catch(() => null)
      if (alt) {
        const altBest = await probeBackend(alt)
        if (altBest.score > best.score) {
          backend = alt
          best = altBest
        }
      }
    }
    const rotation = best.rotation

    /** Frames where a person was found at all, however partially. */
    let posesSeen = 0
    /** Which body regions the camera ever managed to see, for the error copy. */
    const regionsSeen = new Set<string>()

    // Pass one: capture what the model saw, frame by frame. Measuring comes
    // afterwards so single-frame dropouts can be repaired first.
    const tracked: { t: number; kps: Kp[] }[] = []
    for (const t of times) {
      await seekTo(video, t)
      const kps = await detectAt(backend, rotation)
      if (!kps.length) continue
      if (trackingScore(kps) > 0.15) posesSeen++
      if (byName(kps, 'left_shoulder') || byName(kps, 'right_shoulder')) regionsSeen.add('shoulders')
      if (byName(kps, 'left_wrist') || byName(kps, 'right_wrist')) regionsSeen.add('hands')
      if (byName(kps, 'left_hip') || byName(kps, 'right_hip')) regionsSeen.add('hips')
      if (byName(kps, 'left_ankle') || byName(kps, 'right_ankle')) regionsSeen.add('feet')
      tracked.push({ t, kps })
    }

    // Repair one-frame dropouts before measuring. A shoulder that vanishes for
    // a single sample and returns in the next has not moved — the model simply
    // lost it — and dropping the whole frame over it was throwing away good
    // evidence and leaving verdicts resting on a handful of samples.
    bridgeKeypointGaps(tracked)
    const keypointStats = stabilizeKeypointSpikes(tracked)
    trackedSide = pickStableSide(tracked)
    const collisionStats = trackedSide
      ? suppressBilateralCollisions(tracked, trackedSide)
      : { jointsIgnored: 0, framesTouched: 0 }

    // What the model saw, kept for drawing over the replay — including on
    // refusals, where seeing the three tracked dots on your shoulder is the
    // fastest possible explanation of why the clip could not be judged.
    const track: PoseTrack | undefined =
      srcW && srcH && tracked.length
        ? {
            width: srcW,
            height: srcH,
            frames: tracked.map(({ t, kps }) => ({
              t,
              kps: kps
                .filter((k) => k.name && BRIDGEABLE.includes(k.name) && (k.score ?? 0) >= MIN_KP_SCORE)
                .map((k) => ({ name: k.name, x: k.x, y: k.y, score: k.score })),
            })),
          }
        : undefined

    for (const { t, kps } of tracked) {
      // Keep anatomical identity stable through the clip. Switching to
      // whichever side scores higher on each frame creates fake angle jumps.
      const side: 'left' | 'right' | null = trackedSide ?? pickSide(kps)
      if (!side) continue

      const shoulder = byName(kps, `${side}_shoulder`)
      const elbow = byName(kps, `${side}_elbow`)
      const wrist = byName(kps, `${side}_wrist`)
      const hip = byName(kps, `${side}_hip`)
      if (!shoulder || !hip) continue
      trackedSide = side

      const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
      if (torso < 1) continue

      // A 0.30 landmark is enough to say that a body region exists, but it is
      // not enough evidence for a five-degree elbow call. Fine geometry uses a
      // stricter gate and becomes "unseen" when the model is uncertain.
      const preciseShoulder = byName(kps, `${side}_shoulder`, MIN_PRECISE_KP_SCORE)
      const preciseElbow = byName(kps, `${side}_elbow`, MIN_PRECISE_KP_SCORE)
      const preciseWrist = byName(kps, `${side}_wrist`, MIN_PRECISE_KP_SCORE)
      const preciseHip = byName(kps, `${side}_hip`, MIN_PRECISE_KP_SCORE)

      // Averaged over the points actually found. Dividing by a fixed four
      // penalised clips where a wrist was hidden behind a parallette, which
      // then failed the confidence gate despite tracking everything else.
      const found = [shoulder, elbow, wrist, hip].filter(Boolean) as Kp[]
      confidences.push(found.reduce((t2, k) => t2 + (k.score ?? 0), 0) / found.length)

      // The near arm always counts; the far arm joins the verdict only when
      // clearly tracked — occluded far-side joints are what pose models most
      // like to hallucinate, so it faces a stricter gate. Judging the weaker
      // of the two stops one locked elbow hiding the other one bending.
      const farSide = side === 'left' ? 'right' : 'left'
      const frameElbows: number[] = []
      if (preciseShoulder && preciseElbow && preciseWrist && preciseHip) {
        const angle = plancheArmAngle(preciseShoulder, preciseElbow, preciseWrist, preciseHip, torso)
        if (angle !== undefined) push(frameElbows, angle)
      }
      const farShoulder = byName(kps, `${farSide}_shoulder`, MIN_FAR_KP_SCORE)
      const farElbow = byName(kps, `${farSide}_elbow`, MIN_FAR_KP_SCORE)
      const farWrist = byName(kps, `${farSide}_wrist`, MIN_FAR_KP_SCORE)
      const farHip = byName(kps, `${farSide}_hip`, MIN_FAR_KP_SCORE)
      if (
        farShoulder &&
        farElbow &&
        farWrist &&
        farHip &&
        (!preciseElbow ||
          !preciseWrist ||
          sidesAreVisiblySeparate(kps, side, farSide, ['shoulder', 'elbow', 'wrist'], torso))
      ) {
        const angle = plancheArmAngle(farShoulder, farElbow, farWrist, farHip, torso)
        if (angle !== undefined) push(frameElbows, angle)
      }
      let frameElbowDeg: number | undefined
      if (frameElbows.length) {
        const e = Math.min(...frameElbows)
        push(elbows, e)
        frameElbowDeg = e
        elbowSeries.push({ t, v: e })
      }

      // Keep the two legs separate within a frame. One-leg work judges the
      // extended (straighter) leg; full/straddle work judges the weaker leg so
      // one locked knee cannot hide the other bending.
      const frameKnees: number[] = []
      const frameHips: number[] = []
      const legSides = [side, farSide] as const
      for (const [index, s] of legSides.entries()) {
        const minScore = index === 0 ? MIN_PRECISE_KP_SCORE : MIN_FAR_KP_SCORE
        const h = byName(kps, `${s}_hip`, minScore)
        const k = byName(kps, `${s}_knee`, minScore)
        const a = byName(kps, `${s}_ankle`, minScore)
        const sh = byName(kps, `${s}_shoulder`, minScore)
        const useFarLeg =
          index === 0 ||
          frameKnees.length === 0 ||
          profile.oneLeg ||
          sidesAreVisiblySeparate(kps, side, farSide, ['hip', 'knee', 'ankle'], torso)
        if (!useFarLeg) continue
        if (h && k && a) push(frameKnees, angleDeg(h, k, a))
        // Never mix a far-side hip with the near-side shoulder. That
        // cross-body angle looks valid numerically and was a major source of
        // simultaneous "closed hips" and "bent knees" false flags.
        if (sh && h && k) push(frameHips, angleDeg(sh, h, k))
      }
      const frameKneeDeg = frameKnees.length
        ? profile.oneLeg
          ? Math.max(...frameKnees)
          : Math.min(...frameKnees)
        : undefined
      const frameHipAngleDeg = frameHips.length
        ? profile.oneLeg
          ? Math.max(...frameHips)
          : Math.min(...frameHips)
        : undefined
      if (frameKneeDeg !== undefined) push(knees, frameKneeDeg)
      if (frameHipAngleDeg !== undefined) push(hipAngles, frameHipAngleDeg)

      // Screen y grows downward, so a hip above the shoulders is negative dy.
      // Shoulder and hip both pass the precision gate: a barely-visible hip
      // must not make a confident level-line call.
      const useBilateralLine =
        preciseShoulder &&
        preciseHip &&
        farShoulder &&
        farHip &&
        sidesAreVisiblySeparate(kps, side, farSide, ['shoulder', 'hip'], torso)
      const frameHipOffset =
        preciseShoulder && preciseHip
          ? shoulderHipLevelOffset(
              preciseShoulder,
              preciseHip,
              useBilateralLine ? farShoulder : undefined,
              useBilateralLine ? farHip : undefined,
            )
          : undefined
      if (frameHipOffset !== undefined) {
        hipOffsets.push(frameHipOffset)
        lineSeries.push({ t, v: frameHipOffset })
      }

      let frameLeanRatio: number | undefined
      if (preciseShoulder && preciseWrist && preciseHip) {
        // Lean is signed by which way the body points, so it reads the same
        // whichever way round the phone was set up.
        const facing = Math.sign(preciseShoulder.x - preciseHip.x) || 1
        const lean = ((preciseShoulder.x - preciseWrist.x) * facing) / torso
        push(leans, lean)
        if (Number.isFinite(lean)) {
          frameLeanRatio = lean
          leanSeries.push({ t, v: lean })
        }
      }
      // Ear only — the nose sits much further from the shoulder, so falling
      // back to it against the same threshold always reads as "not shrugged".
      const preciseEar = byName(kps, `${side}_ear`, MIN_PRECISE_KP_SCORE)
      const frameShrugRatio = preciseEar && preciseShoulder
        ? Math.hypot(preciseShoulder.x - preciseEar.x, preciseShoulder.y - preciseEar.y) / torso
        : undefined
      if (frameShrugRatio !== undefined) push(shrugs, frameShrugRatio)

      // Twisting is only visible when the camera can actually see both
      // shoulders. Filmed dead side-on the far one is occluded and the model
      // guesses at it, so a height difference there means nothing — only
      // measure when the two are genuinely separated in frame.
      const ls = byName(kps, 'left_shoulder', MIN_PRECISE_KP_SCORE)
      const rs = byName(kps, 'right_shoulder', MIN_PRECISE_KP_SCORE)
      const lh = byName(kps, 'left_hip', MIN_PRECISE_KP_SCORE)
      const rh = byName(kps, 'right_hip', MIN_PRECISE_KP_SCORE)
      let frameAsymmetry: number | undefined
      if (
        ls &&
        rs &&
        lh &&
        rh &&
        Math.abs(ls.x - rs.x) / torso > 0.28 &&
        Math.abs(lh.x - rh.x) / torso > 0.2
      ) {
        // Compare the shoulder and hip lines to each other. Their raw slopes
        // both change with camera roll; the mismatch between them is the more
        // reliable sign that the torso itself is twisting.
        frameAsymmetry = shoulderHipLineMismatch(ls, rs, lh, rh)
        if (frameAsymmetry !== undefined) push(asymmetries, frameAsymmetry)
        // Wider still means the camera is closer to head-on than side-on, and
        // every angle this analyser measures is projected garbage from there.
        if (Math.max(Math.abs(ls.x - rs.x), Math.abs(lh.x - rh.x)) / torso > 0.55) frontalFrames++
      }

      frameReadings.push({
        t,
        elbowDeg: frameElbowDeg,
        kneeDeg: frameKneeDeg,
        hipAngleDeg: frameHipAngleDeg,
        hipOffset: frameHipOffset,
        leanRatio: frameLeanRatio,
        shrugRatio: frameShrugRatio,
        asymmetry: frameAsymmetry,
      })

      // How far the position travels per second. Samples are seconds apart, so
      // this is positional drift, not tremor — dividing by the real gap keeps
      // it comparable between a 10s hold and a 40s one.
      const anchor = { sx: shoulder.x, sy: shoulder.y, hx: hip.x, hy: hip.y, torso, t }
      if (prevAnchor) {
        const dt = Math.max(0.25, t - prevAnchor.t)
        const moved =
          (Math.hypot(anchor.sx - prevAnchor.sx, anchor.sy - prevAnchor.sy) +
            Math.hypot(anchor.hx - prevAnchor.hx, anchor.hy - prevAnchor.hy)) /
          2 /
          torso
        push(drifts, moved / dt)
      }
      prevAnchor = anchor
    }

    const glitchStats = suppressIsolatedMetricSpikes(frameReadings)
    // Rebuild every aggregate from the cleaned readings. Leaving the raw
    // arrays in place would remove a jump from clean-time but still let that
    // same bad landmark create a headline fault.
    elbows.length = 0
    knees.length = 0
    hipAngles.length = 0
    hipOffsets.length = 0
    leans.length = 0
    shrugs.length = 0
    asymmetries.length = 0
    elbowSeries.length = 0
    lineSeries.length = 0
    leanSeries.length = 0
    for (const frame of frameReadings) {
      if (frame.elbowDeg !== undefined) {
        push(elbows, frame.elbowDeg)
        elbowSeries.push({ t: frame.t, v: frame.elbowDeg })
      }
      if (frame.kneeDeg !== undefined) push(knees, frame.kneeDeg)
      if (frame.hipAngleDeg !== undefined) push(hipAngles, frame.hipAngleDeg)
      if (frame.hipOffset !== undefined) {
        push(hipOffsets, frame.hipOffset)
        lineSeries.push({ t: frame.t, v: frame.hipOffset })
      }
      if (frame.leanRatio !== undefined) {
        push(leans, frame.leanRatio)
        leanSeries.push({ t: frame.t, v: frame.leanRatio })
      }
      if (frame.shrugRatio !== undefined) push(shrugs, frame.shrugRatio)
      if (frame.asymmetry !== undefined) push(asymmetries, frame.asymmetry)
    }

    const framesUsed = confidences.length
    if (framesUsed < MIN_FRAMES) {
      // Name what the camera actually found. "Could not track your body" gave
      // no clue whether the fix was moving the phone, turning it, or the light.
      const seen = [...regionsSeen]
      const reason =
        posesSeen === 0
          ? 'No body was found in this clip at all. Move the phone back until your whole body — hands to feet — fits in the frame, and film from the side.'
          : seen.length
            ? `Only your ${listPhrase(seen)} stayed in frame. Move the phone further back and turn it on its side so the whole body fits end to end.`
            : 'Could not track your body reliably. Film side-on, whole body in frame, with the light in front of you rather than behind.'
      return { ...empty, framesUsed, framesSampled: n, reason, track }
    }

    if (frontalFrames / framesUsed > 0.5) {
      return {
        ...empty,
        framesUsed,
        framesSampled: n,
        track,
        reason:
          'This looks filmed head-on. Elbow, hip and lean angles cannot be judged from the front — set the phone off to your side instead.',
      }
    }

    const confidence = confidences.reduce((a, b) => a + b, 0) / framesUsed
    // The two cleaners operate at different layers (landmarks and derived
    // metrics), so use the conservative upper bound rather than adding them
    // and double-counting the same bad sample.
    const instabilityCount = Math.max(keypointStats.framesTouched, glitchStats.framesTouched)
    if (instabilityCount >= Math.max(3, Math.ceil(frameReadings.length * 0.3))) {
      return {
        ...empty,
        framesUsed,
        framesSampled: n,
        confidence,
        track,
        reason:
          'Tracking jumped between different body shapes too often to judge this clip reliably. Check the skeleton replay, then try brighter light, more distance, and a clear side view.',
      }
    }
    // A criterion is graded when it was observable for a majority of tracked
    // frames. Anything short of that is reported as *unseen* rather than
    // failing the whole clip: a knee out of frame should cost you the knee
    // verdict, not the elbow, hip and lean verdicts alongside it. What stays
    // non-negotiable is that thin coverage never reads as a silent pass.
    const { judged, unseen } = gradeCoverage(
      profile,
      {
        elbows: elbows.length,
        knees: knees.length,
        hipAngles: hipAngles.length,
        hipOffsets: hipOffsets.length,
        leans: leans.length,
      },
      framesUsed,
    )

    // Only a total blackout is unjudgeable. With nothing graded there is no
    // verdict to give, so this stays a refusal rather than a hollow "clean".
    if (!Object.values(judged).some(Boolean)) {
      return {
        ...empty,
        framesUsed,
        framesSampled: n,
        confidence,
        unseen,
        track,
        reason: `Could not see your ${listPhrase(unseen)} well enough to judge anything here. Keep your whole body and both hands in frame, side-on.`,
      }
    }

    const creditedSeconds =
      creditedHoldSec !== undefined && Number.isFinite(creditedHoldSec) && creditedHoldSec > 0
        ? Math.min(duration, creditedHoldSec)
        : duration
    const readingAt = new Map(frameReadings.map((frame) => [frame.t, frame]))
    const envelopeSamples = times.map((t) => {
      const frame = readingAt.get(t)
      return {
        t,
        bad: frame ? materiallyOutsideEnvelope(frame, profile, judged) : null,
      }
    })
    const cleanSeconds = sustainedObservableCleanSeconds(envelopeSamples, creditedSeconds)
    const cleanRatio = creditedSeconds > 0 ? Math.min(1, cleanSeconds / creditedSeconds) : 0
    const sustainedFaults = new Set(
      sustainedMaterialIssues(
        times
          .filter((t) => t <= creditedSeconds + 0.05)
          .map((t) => ({
            t,
            issues: readingAt.has(t)
              ? materialIssuesForReading(readingAt.get(t)!, profile, judged)
              : [],
          })),
      ),
    )

    // Judge the hold, not the dismount.
    //
    // Coming out of a planche is a controlled collapse: the arms bend, the hips
    // drop, the body folds. Those frames were being averaged into the verdict
    // alongside the hold itself, so a set held perfectly for twelve seconds
    // came back "elbows bent, hips sagging" — describing the exit, which is not
    // a form fault at all. The verdict now covers the sustained-clean portion,
    // and the breakdown is reported separately as the point where it ended.
    const brokeDown = cleanSeconds + 0.05 < creditedSeconds
    const cutoff = brokeDown ? cleanSeconds : creditedSeconds
    const withinHold = frameReadings.filter((f) => f.t < cutoff)
    const verdictFrames = withinHold.length >= MIN_FRAMES ? withinHold : frameReadings
    const exitFramesDropped = frameReadings.length - verdictFrames.length

    const pick = <K extends keyof FrameReading>(key: K): number[] =>
      verdictFrames.map((f) => f[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    const heldElbows = pick('elbowDeg')
    const heldKnees = pick('kneeDeg')
    const heldHipAngles = pick('hipAngleDeg')

    // Every metric falls back to the whole clip when the narrowed window has
    // nothing for it. Coverage was judged over the full clip, so a criterion
    // that is graded must produce a number: leaving it undefined here would
    // drop its check silently and an all-undefined verdict reads as "clean".
    const elbowPeak = heldElbows.length ? Math.max(...heldElbows) : elbows.length ? Math.max(...elbows) : undefined
    const kneePeak = heldKnees.length ? Math.max(...heldKnees) : knees.length ? Math.max(...knees) : undefined
    const hipAnglePeak = heldHipAngles.length
      ? Math.max(...heldHipAngles)
      : hipAngles.length
        ? Math.max(...hipAngles)
        : undefined
    // Headline angles describe the typical held shape. Sustained bad runs
    // already cap clean time above; using the old lower quartile here let a
    // minority of plausible-looking detector errors create a red form flag.
    const elbowDeg = sustainedTypical(heldElbows) ?? sustainedTypical(elbows)
    const kneeDeg = sustainedTypical(heldKnees) ?? sustainedTypical(knees)
    const hipAngleDeg = sustainedTypical(heldHipAngles) ?? sustainedTypical(hipAngles)
    const hipOffset = median(pick('hipOffset')) ?? median(hipOffsets)
    const leanRatio = median(pick('leanRatio')) ?? median(leans)
    const shrugRatio = median(pick('shrugRatio')) ?? median(shrugs)
    const asymmetry = median(pick('asymmetry')) ?? median(asymmetries)
    const wobble = median(drifts)

    // Median of the first and final thirds of the sampled window, for the
    // "clean early, broke down late" comparisons. Needs a hold long enough to
    // have thirds worth talking about.
    const thirds = (xs: { t: number; v: number }[]) => {
      if (xs.length < 6) return null
      const t1 = from + (to - from) / 3
      const t2 = from + (2 * (to - from)) / 3
      const early = xs.filter((p) => p.t <= t1).map((p) => p.v)
      const late = xs.filter((p) => p.t >= t2).map((p) => p.v)
      const e = median(early)
      const l = median(late)
      return e !== undefined && l !== undefined ? { early: e, late: l } : null
    }

    if (confidence < 0.35) {
      return {
        ...empty,
        framesUsed,
        framesSampled: n,
        confidence,
        elbowDeg,
        kneeDeg,
        hipAngleDeg,
        hipOffset,
        leanRatio,
        shrugRatio,
        track,
        reason: 'Tracking confidence was too low to judge form from this clip.',
      }
    }

    const issues: FormIssue[] = []
    const notes: string[] = []
    const good: string[] = []
    const details: string[] = []
    const aggregateFaults = new Set(
      materialIssuesForReading(
        { t: 0, elbowDeg, kneeDeg, hipAngleDeg, hipOffset, leanRatio, shrugRatio, asymmetry },
        profile,
        judged,
      ),
    )
    const namedFaults = new Set([...aggregateFaults, ...sustainedFaults])
    const creditedReadings = frameReadings.filter((frame) => frame.t <= creditedSeconds + 0.05)
    const faultMetric = (issue: FormIssue, key: Exclude<keyof FrameReading, 't'>): number | undefined => {
      const values = creditedReadings
        .filter((frame) => materialIssuesForReading(frame, profile, judged).includes(issue))
        .map((frame) => frame[key])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      return key.endsWith('Deg') ? sustainedTypical(values) : median(values)
    }

    // When a fault appeared after an initially clean position, expose the
    // sustained faulty measurement rather than returning a pristine pre-fault
    // median next to a red issue label.
    const reportedElbowDeg = namedFaults.has('arms') ? faultMetric('arms', 'elbowDeg') ?? elbowDeg : elbowDeg
    const reportedKneeDeg = namedFaults.has('knees') ? faultMetric('knees', 'kneeDeg') ?? kneeDeg : kneeDeg
    const reportedHipAngleDeg = namedFaults.has('closed')
      ? faultMetric('closed', 'hipAngleDeg') ?? hipAngleDeg
      : hipAngleDeg
    const reportedHipOffset = namedFaults.has('pike')
      ? faultMetric('pike', 'hipOffset') ?? hipOffset
      : namedFaults.has('sag')
        ? faultMetric('sag', 'hipOffset') ?? hipOffset
        : hipOffset
    const reportedLeanRatio = namedFaults.has('lean') ? faultMetric('lean', 'leanRatio') ?? leanRatio : leanRatio
    const reportedShrugRatio = namedFaults.has('shrug')
      ? faultMetric('shrug', 'shrugRatio') ?? shrugRatio
      : shrugRatio
    const reportedAsymmetry = namedFaults.has('twist')
      ? faultMetric('twist', 'asymmetry') ?? asymmetry
      : asymmetry

    if (judged.elbow && profile.minElbowDeg !== undefined && reportedElbowDeg !== undefined) {
      if (namedFaults.has('arms')) {
        issues.push('arms')
        notes.push(
          sustainedFaults.has('arms') && !aggregateFaults.has('arms')
            ? `Elbows softened to about ${Math.round(reportedElbowDeg)}° for a sustained part of the hold — even a small bend changes this from straight-arm work.`
            : elbowPeak !== undefined && elbowPeak >= profile.minElbowDeg - MATERIAL_TOLERANCE.elbowDeg
              ? `Elbows locked at their best (${Math.round(elbowPeak)}°) but sat nearer ${Math.round(reportedElbowDeg)}° for much of the hold — keep the lock the whole way.`
              : `Elbows reached about ${Math.round(elbowPeak ?? reportedElbowDeg)}° at their straightest — locked reads near 180°.`,
        )
      } else {
        good.push(
          reportedElbowDeg >= profile.minElbowDeg - 2
            ? `Elbows locked (${Math.round(reportedElbowDeg)}°)`
            : `No reliable elbow bend detected (${Math.round(reportedElbowDeg)}°)`,
        )
      }
    }

    if (judged.knee && profile.minKneeDeg !== undefined && reportedKneeDeg !== undefined) {
      if (namedFaults.has('knees')) {
        issues.push('knees')
        notes.push(
          sustainedFaults.has('knees') && !aggregateFaults.has('knees')
            ? `Knee extension softened to about ${Math.round(reportedKneeDeg)}° for a sustained part of the hold.`
            : kneePeak !== undefined && kneePeak >= profile.minKneeDeg
              ? `Legs straightened fully at some point (${Math.round(kneePeak)}°) but bent for much of the hold — squeeze them straight and keep them there.`
              : `Knees measured about ${Math.round(kneePeak ?? reportedKneeDeg)}° — straight legs read near 180°.`,
        )
      } else {
        good.push(
          reportedKneeDeg >= profile.minKneeDeg
            ? `Legs straight (${Math.round(reportedKneeDeg)}°)`
            : `Legs within camera tolerance (${Math.round(reportedKneeDeg)}°)`,
        )
      }
    }

    if (judged.hipAngle && profile.minHipAngleDeg !== undefined && reportedHipAngleDeg !== undefined) {
      if (namedFaults.has('closed')) {
        // Its own issue, not "hips too high": a closed hip angle means the
        // body is still folded, which is the opposite complaint.
        issues.push('closed')
        notes.push(
          sustainedFaults.has('closed') && !aggregateFaults.has('closed')
            ? `The hip angle closed to about ${Math.round(reportedHipAngleDeg)}° for a sustained part of the hold.`
            : hipAnglePeak !== undefined && hipAnglePeak >= profile.minHipAngleDeg
              ? `Hips opened to ${Math.round(hipAnglePeak)}° at their best but closed back down for much of the hold — this position wants ${profile.minHipAngleDeg}°+ held, not visited.`
              : `Hips were only about ${Math.round(reportedHipAngleDeg)}° open — this position wants closer to ${profile.minHipAngleDeg}°.`,
        )
      } else {
        good.push(
          reportedHipAngleDeg >= profile.minHipAngleDeg
            ? `Hips open (${Math.round(reportedHipAngleDeg)}°)`
            : `Hip angle within camera tolerance (${Math.round(reportedHipAngleDeg)}°)`,
        )
      }
    }

    if (judged.line && profile.levelTolerance !== undefined && reportedHipOffset !== undefined) {
      if (namedFaults.has('pike')) {
        issues.push('pike')
        notes.push('Hips sat above your shoulders — that reads as a pike rather than a flat line.')
      } else if (namedFaults.has('sag')) {
        issues.push('sag')
        notes.push('Hips dropped below your shoulders — the line was sagging.')
      } else {
        good.push(
          Math.abs(reportedHipOffset) <= profile.levelTolerance
            ? 'Hips and shoulders level'
            : 'Body line within camera tolerance',
        )
      }
    }

    if (judged.lean && profile.minLeanRatio !== undefined && reportedLeanRatio !== undefined) {
      if (namedFaults.has('lean')) {
        issues.push('lean')
        notes.push('Your shoulders stayed close to your hands — more forward lean is what makes this position lighter.')
      } else {
        good.push(reportedLeanRatio >= profile.minLeanRatio ? 'Good forward lean' : 'Lean within camera tolerance')
      }
    }

    if (profile.checkShrug && reportedShrugRatio !== undefined) {
      if (namedFaults.has('shrug')) {
        issues.push('shrug')
        notes.push('Your shoulders looked shrugged up toward your ears — push the floor away and keep them down.')
      } else {
        good.push(reportedShrugRatio >= 0.32 ? 'Shoulders down, not shrugged' : 'No clear shrug detected')
      }
    }

    // ——— Faults that apply at every level, not just the headline geometry ———

    // Only reported when the camera was actually placed to see it.
    if (reportedAsymmetry !== undefined) {
      if (namedFaults.has('twist')) {
        issues.push('twist')
        notes.push('Your shoulder and hip lines did not stay square to each other — press evenly and resist torso rotation.')
      } else details.push('Shoulder and hip lines stayed square to each other.')
    }

    if (wobble !== undefined) {
      if (wobble > 0.05) {
        details.push('Your position drifted a fair amount through the hold — it was slipping as you tired.')
      } else if (wobble < 0.015) {
        details.push('Position held very steady.')
      }
    }

    // ——— Early vs late: did the shape survive the fatigue? ———
    // Each comparison stays quiet when the headline check already complained
    // about the same thing, so the panel never nags twice for one fault.
    const elbowTrend = thirds(elbowSeries)
    const lineTrend = thirds(lineSeries)
    const leanTrend = thirds(leanSeries)
    let fadeSeen = false

    if (
      judged.elbow &&
      elbowTrend &&
      profile.minElbowDeg !== undefined &&
      elbowTrend.early - elbowTrend.late > 8 &&
      elbowTrend.late < profile.minElbowDeg - MATERIAL_TOLERANCE.elbowDeg &&
      !issues.includes('arms')
    ) {
      fadeSeen = true
      details.push(
        `Elbow tracking softened late (${Math.round(elbowTrend.early)}° → ${Math.round(elbowTrend.late)}°), but was not turned into a form flag without a sustained fault.`,
      )
    }
    if (judged.line && lineTrend && !issues.includes('sag') && !issues.includes('pike')) {
      if (
        profile.levelTolerance !== undefined &&
        lineTrend.early - lineTrend.late > 0.18 &&
        lineTrend.late < -profile.levelTolerance - MATERIAL_TOLERANCE.lineRatio
      ) {
        fadeSeen = true
        details.push('The tracked hip line dropped late, but was not turned into a form flag without a sustained fault.')
      } else if (
        profile.levelTolerance !== undefined &&
        lineTrend.late - lineTrend.early > 0.18 &&
        lineTrend.late > profile.levelTolerance + MATERIAL_TOLERANCE.lineRatio
      ) {
        fadeSeen = true
        details.push('The tracked hip line rose late, but was not turned into a form flag without a sustained fault.')
      }
    }
    if (
      judged.lean &&
      leanTrend &&
      profile.minLeanRatio !== undefined &&
      leanTrend.early - leanTrend.late > 0.12 &&
      leanTrend.late < profile.minLeanRatio - MATERIAL_TOLERANCE.leanRatio &&
      !issues.includes('lean')
    ) {
      fadeSeen = true
      details.push('The tracked lean pulled back late, but was not turned into a form flag without a sustained fault.')
    }
    if (!fadeSeen && holdWindow >= 8 && (elbowTrend || lineTrend || leanTrend)) {
      details.push('Shape held up through the whole hold — no visible fade from start to finish.')
    }
    if (cleanSeconds < creditedSeconds) {
      details.push(
        `The clean window ended near ${cleanSeconds.toFixed(1)}s after the position stayed outside the tolerant form envelope for roughly a second.`,
      )
      if (notes.length === 0) {
        const incompleteAfterCutoff = envelopeSamples.some(
          (sample) => sample.t >= cleanSeconds && sample.bad === null,
        )
        notes.push(
          incompleteAfterCutoff
            ? `The camera stopped seeing a complete held position near ${cleanSeconds.toFixed(1)}s. A quick drop or leaving the frame ends verified time even when no single joint fault can be named.`
            : `The position left the tolerant envelope near ${cleanSeconds.toFixed(1)}s, but no single correction was stable enough for the camera to name confidently.`,
        )
      }
    } else {
      details.push('No sustained material breakdown was found across the credited hold.')
    }
    if (glitchStats.metricsIgnored > 0) {
      details.push(
        `Ignored ${glitchStats.metricsIgnored} isolated tracking ${glitchStats.metricsIgnored === 1 ? 'jump' : 'jumps'} that disagreed with the frames around them.`,
      )
    }
    if (collisionStats.jointsIgnored > 0) {
      details.push(
        `Ignored ${collisionStats.jointsIgnored} duplicated far-side joint ${collisionStats.jointsIgnored === 1 ? 'point' : 'points'} that the tracker stacked onto the visible limb.`,
      )
    }
    if (keypointStats.jointsRepaired > 0) {
      details.push(
        `Stabilized ${keypointStats.jointsRepaired} isolated skeleton ${keypointStats.jointsRepaired === 1 ? 'jump' : 'jumps'} that immediately returned to the athlete.`,
      )
    }
    if (exitFramesDropped > 0) {
      details.push(
        `Graded on the ${verdictFrames.length} frames of the hold itself; the last ${exitFramesDropped} (coming out of the position) were left out.`,
      )
    }
    details.push('Scapular protraction is not measured by this camera check — confirm it yourself.')
    details.push(
      `Tracked with ${backend.id === 'mediapipe' ? 'BlazePose (MediaPipe)' : 'MoveNet'}${
        rotation === 0 ? '' : `, reading the frame rotated ${rotation}° so your body sat upright to the model`
      }.`,
    )
    if (unseen.length) {
      // Said plainly rather than buried: a verdict that quietly skipped a
      // criterion would read as a clean bill of health for it.
      details.push(
        `Your ${listPhrase(unseen)} stayed out of shot, so ${unseen.length === 1 ? 'it was' : 'they were'} not part of this verdict.`,
      )
    }

    const uniqueIssues = [...new Set(issues)]
    const fix = pickFixFirst(uniqueIssues)
    const scored = computeFormScore({
      profile,
      judged,
      elbowDeg: reportedElbowDeg,
      kneeDeg: reportedKneeDeg,
      hipAngleDeg: reportedHipAngleDeg,
      hipOffset: reportedHipOffset,
      leanRatio: reportedLeanRatio,
      shrugRatio: reportedShrugRatio,
      wobble,
      cleanRatio,
    })

    return {
      ok: true,
      confidence,
      framesUsed,
      framesSampled: n,
      ...(scored ? { score: scored.score, subscores: scored.subscores } : {}),
      ...(fix ? { fixFirst: fix } : {}),
      track,
      cleanSeconds,
      cleanRatio,
      elbowDeg: reportedElbowDeg,
      kneeDeg: reportedKneeDeg,
      hipAngleDeg: reportedHipAngleDeg,
      hipOffset: reportedHipOffset,
      leanRatio: reportedLeanRatio,
      shrugRatio: reportedShrugRatio,
      wobble,
      asymmetry: reportedAsymmetry,
      issues: uniqueIssues,
      notes,
      good,
      details,
      unseen,
    }
  } catch (err) {
    return { ...empty, reason: err instanceof Error ? err.message : 'Analysis failed.' }
  } finally {
    URL.revokeObjectURL(url)
    video.src = ''
  }
}

// Multiple skipped-rest clips can arrive together on the summary screen.
// MediaPipe and WebGL inference are not reliably re-entrant on Android
// WebViews, so run checks one at a time instead of letting several clips fight
// over the same detector and GPU context.
let analysisQueue: Promise<void> = Promise.resolve()

export function analyseClip(
  blob: Blob,
  exerciseId: string,
  sampleCount?: number,
  creditedHoldSec?: number,
): Promise<PoseFormResult> {
  const result = analysisQueue.then(() => analyseClipNow(blob, exerciseId, sampleCount, creditedHoldSec))
  analysisQueue = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

/** A robust "kept through the hold" minimum that forgives a few bad detections. */
export function sustainedMinimum(xs: number[]): number | undefined {
  if (!xs.length) return undefined
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.25) - 1)]
}

/** Typical held angle, robust to a minority of low or high detector misses. */
export function sustainedTypical(xs: number[]): number | undefined {
  if (!xs.length) return undefined
  const sorted = [...xs].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * FIG Code of Points deduction bands, mapped onto a 0–100 criterion score.
 * Gymnastics judges deduct nothing inside 5° of the ideal, a small error to
 * 20°, a medium error to 45°, and past 45° the element is simply not that
 * position any more. The 5° free band doubles as the measurement deadband —
 * monocular pose estimation carries roughly 5–8° of angle error, so deviations
 * inside it are as likely noise as fault.
 */
export function bandedScore(deviationDeg: number): number {
  const d = Math.max(0, deviationDeg)
  if (d <= 5) return 100
  if (d <= 20) return Math.round(100 - ((d - 5) * 30) / 15)
  if (d <= 45) return Math.round(70 - ((d - 20) * 40) / 25)
  return Math.max(0, Math.round(30 - (d - 45) * 2))
}

/**
 * Ratio-based criteria (body line, lean, shrug) are converted to a
 * degree-equivalent so one deduction table grades everything. Each factor is
 * chosen so the criterion's measurement deadband is about the 5° free band.
 */
const RATIO_TO_DEG = { line: 80, lean: 60, shrug: 100 } as const

/**
 * Relative weight of each criterion in the headline score, renormalised over
 * whichever criteria were actually judged. Straight arms dominate because a
 * bent-arm planche is a different (easier) skill, not a style fault.
 */
const SCORE_WEIGHTS: Record<FormSubscore['key'], number> = {
  elbow: 28,
  line: 18,
  cleanTime: 15,
  lean: 14,
  hipAngle: 12,
  knee: 8,
  shrug: 6,
  steadiness: 5,
}

const SUBSCORE_LABELS: Record<FormSubscore['key'], string> = {
  elbow: 'Straight arms',
  knee: 'Straight legs',
  hipAngle: 'Hip opening',
  line: 'Body line',
  lean: 'Forward lean',
  shrug: 'Shoulders down',
  steadiness: 'Steadiness',
  cleanTime: 'Held clean',
}

/**
 * The 0–100 verdict, built only from criteria the camera actually judged.
 * Returns null when nothing was gradeable — a score computed from nothing
 * would read as a verdict the camera never gave.
 */
export function computeFormScore(parts: {
  profile: PoseProfile
  judged: JudgedCriteria
  elbowDeg?: number
  kneeDeg?: number
  hipAngleDeg?: number
  hipOffset?: number
  leanRatio?: number
  shrugRatio?: number
  wobble?: number
  cleanRatio?: number
}): { score: number; subscores: FormSubscore[] } | null {
  const { profile, judged } = parts
  const subscores: FormSubscore[] = []
  const add = (key: FormSubscore['key'], score: number) =>
    subscores.push({ key, label: SUBSCORE_LABELS[key], score: Math.round(score) })

  if (judged.elbow && profile.minElbowDeg !== undefined && parts.elbowDeg !== undefined) {
    // Once a persistent bend clears the tight camera deadband it should
    // matter visibly in the score: bent-arm planche is a different skill, not
    // merely a cosmetic line deduction.
    add('elbow', bandedScore((profile.minElbowDeg - parts.elbowDeg) * 2))
  }
  if (judged.knee && profile.minKneeDeg !== undefined && parts.kneeDeg !== undefined) {
    add('knee', bandedScore(profile.minKneeDeg - parts.kneeDeg))
  }
  if (judged.hipAngle && profile.minHipAngleDeg !== undefined && parts.hipAngleDeg !== undefined) {
    add('hipAngle', bandedScore(profile.minHipAngleDeg - parts.hipAngleDeg))
  }
  if (judged.line && profile.levelTolerance !== undefined && parts.hipOffset !== undefined) {
    add('line', bandedScore((Math.abs(parts.hipOffset) - profile.levelTolerance) * RATIO_TO_DEG.line))
  }
  if (judged.lean && profile.minLeanRatio !== undefined && parts.leanRatio !== undefined) {
    add('lean', bandedScore((profile.minLeanRatio - parts.leanRatio) * RATIO_TO_DEG.lean))
  }
  if (profile.checkShrug && parts.shrugRatio !== undefined) {
    add('shrug', bandedScore((0.32 - parts.shrugRatio) * RATIO_TO_DEG.shrug))
  }
  if (parts.wobble !== undefined) {
    // Not a FIG criterion: drift is graded on its own scale, where the
    // existing "very steady" and "slipping" thresholds anchor the ends.
    add('steadiness', parts.wobble <= 0.015 ? 100 : Math.max(40, 100 - ((parts.wobble - 0.015) * 60) / 0.065))
  }
  if (parts.cleanRatio !== undefined) {
    add('cleanTime', Math.max(0, Math.min(1, parts.cleanRatio)) * 100)
  }

  if (!subscores.length) return null
  const totalWeight = subscores.reduce((t, s) => t + SCORE_WEIGHTS[s.key], 0)
  const score = Math.round(
    subscores.reduce((t, s) => t + s.score * SCORE_WEIGHTS[s.key], 0) / totalWeight,
  )
  return { score, subscores }
}

/**
 * Which fault to fix first when several were seen. Ordered by injury risk and
 * training impact, not by how loudly each one shows on camera: bent arms are
 * a different skill and an elbow risk, a shrug loads the wrong tissue, a lost
 * line wastes the set, and everything else is refinement. One cue at a time is
 * deliberate — motor-learning work shows a list of corrections fixes nothing.
 */
export const FIX_PRIORITY: { issue: FormIssue; cue: string }[] = [
  { issue: 'arms', cue: 'Lock the elbows — squeeze the triceps and keep them locked all the way to the end.' },
  { issue: 'shrug', cue: 'Push the floor away and keep the shoulders down away from your ears.' },
  { issue: 'sag', cue: 'Squeeze glutes and abs to bring the hips up level with the shoulders.' },
  { issue: 'pike', cue: 'Let the hips drop level — hold the height with lean, not by folding.' },
  { issue: 'closed', cue: 'Open the hips — drive the knees away from the chest and flatten the back.' },
  { issue: 'lean', cue: 'Lean further over your hands until the feet feel light before they leave.' },
  { issue: 'twist', cue: 'Press evenly through both hands and keep the shoulders square.' },
  { issue: 'knees', cue: 'Squeeze the knees dead straight and point the toes.' },
]

export function pickFixFirst(issues: FormIssue[]): { issue: FormIssue; cue: string } | null {
  return FIX_PRIORITY.find((f) => issues.includes(f.issue)) ?? null
}

/**
 * Keep loader internals out of the athlete's face. A failed dynamic import
 * reads as a stack-trace-ish string that means nothing mid-workout.
 */
export function friendlyResult(res: PoseFormResult): PoseFormResult {
  if (res.ok || !res.reason) return res
  const technical = /import|fetch|module|network|backend|webgl|undefined|\.js/i.test(res.reason)
  return technical
    ? {
        ...res,
        reason:
          'The form checker could not load. It needs a connection the first time it runs — try again once you are online.',
      }
    : res
}
