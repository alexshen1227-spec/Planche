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
  /** Credited seconds before the first sustained, material form breakdown. */
  cleanSeconds?: number
  /** Clean seconds divided by the timer's credited hold. */
  cleanRatio?: number
  /** Sustained elbow angle, degrees (lower quartile of frames; 180 = locked). */
  elbowDeg?: number
  /** Shoulder→hip→knee angle: how open the hips are (lower quartile). */
  hipAngleDeg?: number
  /** Sustained knee angle (lower quartile of frames). */
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
  /** Left/right height difference at the shoulders, over torso length. */
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
const MIN_FRAMES = 3

/**
 * What "correct" means for each position. Only the checks listed run, which
 * is what stops the analyser flagging the deliberate shapes of a progression.
 */
export interface PoseProfile {
  label: string
  /** No geometric checks apply — say so rather than implying it looked good. */
  noChecks?: boolean
  /** Elbow angle below this counts as bent. Undefined = do not check. */
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

interface FrameReading {
  t: number
  elbowDeg?: number
  kneeDeg?: number
  hipAngleDeg?: number
  hipOffset?: number
  leanRatio?: number
  shrugRatio?: number
  asymmetry?: number
}

export const POSE_PROFILES: Record<string, PoseProfile> = {
  'ppp-hold': {
    label: 'Pseudo planche plank',
    minElbowDeg: 165,
    minKneeDeg: 160,
    levelTolerance: 0.45,
    minLeanRatio: 0.15,
    checkShrug: true,
  },
  'planche-lean': {
    label: 'Planche lean',
    minElbowDeg: 168,
    minKneeDeg: 160,
    levelTolerance: 0.4,
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
    minElbowDeg: 165,
    levelTolerance: 0.5,
    minLeanRatio: 0.2,
    checkShrug: true,
  },
  'adv-tuck-planche': {
    label: 'Advanced tuck planche',
    minElbowDeg: 168,
    levelTolerance: 0.35,
    minHipAngleDeg: 70,
    minLeanRatio: 0.28,
    checkShrug: true,
  },
  'one-leg-lean': {
    label: 'One-leg planche lean',
    minElbowDeg: 168,
    levelTolerance: 0.4,
    minLeanRatio: 0.3,
    checkShrug: true,
  },
  'one-leg-planche': {
    label: 'One-leg extension',
    minElbowDeg: 168,
    levelTolerance: 0.3,
    minHipAngleDeg: 120,
    minLeanRatio: 0.3,
    oneLeg: true,
    checkShrug: true,
  },
  'straddle-planche': {
    label: 'Straddle planche',
    minElbowDeg: 170,
    minKneeDeg: 165,
    levelTolerance: 0.25,
    minHipAngleDeg: 150,
    minLeanRatio: 0.35,
    checkShrug: true,
  },
  'band-straddle-planche': {
    label: 'Band-assisted straddle',
    minElbowDeg: 168,
    minKneeDeg: 160,
    levelTolerance: 0.3,
    minHipAngleDeg: 145,
    checkShrug: true,
  },
  'full-planche': {
    label: 'Full planche',
    minElbowDeg: 172,
    minKneeDeg: 168,
    levelTolerance: 0.2,
    minHipAngleDeg: 160,
    minLeanRatio: 0.4,
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
function materiallyOutsideEnvelope(
  frame: FrameReading,
  profile: PoseProfile,
  judged: JudgedCriteria,
): boolean | null {
  const required: (number | undefined)[] = []
  const failed: boolean[] = []
  const check = (value: number | undefined, didFail: (n: number) => boolean) => {
    required.push(value)
    if (value !== undefined) failed.push(didFail(value))
  }

  if (profile.minElbowDeg !== undefined && judged.elbow) {
    check(frame.elbowDeg, (n) => n < profile.minElbowDeg! - 5)
  }
  if (profile.minKneeDeg !== undefined && judged.knee) {
    check(frame.kneeDeg, (n) => n < profile.minKneeDeg! - 7)
  }
  if (profile.minHipAngleDeg !== undefined && judged.hipAngle) {
    check(frame.hipAngleDeg, (n) => n < profile.minHipAngleDeg! - 8)
  }
  if (profile.levelTolerance !== undefined && judged.line) {
    check(frame.hipOffset, (n) => Math.abs(n) > profile.levelTolerance! + 0.08)
  }
  if (profile.minLeanRatio !== undefined && judged.lean) {
    check(frame.leanRatio, (n) => n < profile.minLeanRatio! - 0.06)
  }
  // Ears are frequently occluded side-on, so shrug remains an advisory check
  // when visible rather than making the whole frame unjudgeable.
  if (profile.checkShrug && frame.shrugRatio !== undefined) {
    failed.push(frame.shrugRatio < 0.27)
  }

  // Shoulder symmetry is only judgeable away from a true side view.
  if (frame.asymmetry !== undefined) failed.push(frame.asymmetry > 0.28)
  if (required.some((value) => value === undefined)) return null
  return failed.some(Boolean)
}

/**
 * Returns the portion of a hold before a sustained breakdown. A single bad
 * sample is treated as detector noise; two consecutive judgeable samples are
 * required. Exported so this progression-critical rule stays regression-tested.
 */
export function sustainedCleanSeconds(
  samples: { t: number; bad: boolean }[],
  creditedHoldSec: number,
  minimumBadSamples = 2,
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
    if (badRun >= Math.max(1, minimumBadSamples)) {
      return Math.round(Math.min(hold, Math.max(0, badRunStartedAt)) * 10) / 10
    }
  }
  return Math.round(hold * 10) / 10
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

function byName(kps: Kp[], name: string): Kp | undefined {
  const k = kps.find((p) => p.name === name)
  return k && (k.score ?? 0) >= MIN_KP_SCORE ? k : undefined
}

function pickSide(kps: Kp[]): 'left' | 'right' | null {
  const score = (side: string) =>
    ['shoulder', 'elbow', 'wrist', 'hip'].reduce((t, part) => t + (byName(kps, `${side}_${part}`)?.score ?? 0), 0)
  const l = score('left')
  const r = score('right')
  if (Math.max(l, r) === 0) return null
  return l >= r ? 'left' : 'right'
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

export async function analyseClip(
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
    // Sample across nearly the whole credited hold. Roughly 1.25 frames per
    // second catches short breakdowns without making on-device analysis drag.
    const holdWindow =
      creditedHoldSec !== undefined && Number.isFinite(creditedHoldSec) && creditedHoldSec > 0
        ? Math.min(duration, creditedHoldSec + 0.25)
        : duration
    const n = sampleCount ?? Math.round(Math.min(24, Math.max(8, holdWindow * 1.25)))
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

    let backend = await getBackend('blazepose').catch(() => getBackend('movenet'))
    let best = await probeBackend(backend)
    // Only pay for the second model when the first one struggled — each is a
    // multi-megabyte download, and on good footage the first is already right.
    if (best.score < 0.55 && backend.id === 'blazepose') {
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

    for (const { t, kps } of tracked) {
      // Keep anatomical identity stable through the clip. Switching to
      // whichever side scores higher on each frame creates fake angle jumps.
      const side: 'left' | 'right' | null = trackedSide ?? pickSide(kps)
      if (!side) continue

      const shoulder = byName(kps, `${side}_shoulder`)
      const elbow = byName(kps, `${side}_elbow`)
      const wrist = byName(kps, `${side}_wrist`)
      const hip = byName(kps, `${side}_hip`)
      // Ear only — the nose sits much further from the shoulder, so falling
      // back to it against the same threshold always reads as "not shrugged".
      const ear = byName(kps, `${side}_ear`)
      if (!shoulder || !hip) continue
      trackedSide = side

      const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
      if (torso < 1) continue

      // Averaged over the points actually found. Dividing by a fixed four
      // penalised clips where a wrist was hidden behind a parallette, which
      // then failed the confidence gate despite tracking everything else.
      const found = [shoulder, elbow, wrist, hip].filter(Boolean) as Kp[]
      confidences.push(found.reduce((t2, k) => t2 + (k.score ?? 0), 0) / found.length)

      let frameElbowDeg: number | undefined
      if (elbow && wrist) {
        const e = angleDeg(shoulder, elbow, wrist)
        push(elbows, e)
        if (Number.isFinite(e)) {
          frameElbowDeg = e
          elbowSeries.push({ t, v: e })
        }
      }

      // Keep the two legs separate within a frame. One-leg work judges the
      // extended (straighter) leg; full/straddle work judges the weaker leg so
      // one locked knee cannot hide the other bending.
      const frameKnees: number[] = []
      const frameHips: number[] = []
      for (const s of ['left', 'right'] as const) {
        const h = byName(kps, `${s}_hip`)
        const k = byName(kps, `${s}_knee`)
        const a = byName(kps, `${s}_ankle`)
        if (h && k && a) push(frameKnees, angleDeg(h, k, a))
        if (h && k) {
          const sh = byName(kps, `${s}_shoulder`) ?? shoulder
          push(frameHips, angleDeg(sh, h, k))
        }
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
      const frameHipOffset = (shoulder.y - hip.y) / torso
      hipOffsets.push(frameHipOffset)
      lineSeries.push({ t, v: frameHipOffset })

      let frameLeanRatio: number | undefined
      if (wrist) {
        // Lean is signed by which way the body points, so it reads the same
        // whichever way round the phone was set up.
        const facing = Math.sign(shoulder.x - hip.x) || 1
        const lean = ((shoulder.x - wrist.x) * facing) / torso
        push(leans, lean)
        if (Number.isFinite(lean)) {
          frameLeanRatio = lean
          leanSeries.push({ t, v: lean })
        }
      }
      const frameShrugRatio = ear
        ? Math.hypot(shoulder.x - ear.x, shoulder.y - ear.y) / torso
        : undefined
      if (frameShrugRatio !== undefined) push(shrugs, frameShrugRatio)

      // Twisting is only visible when the camera can actually see both
      // shoulders. Filmed dead side-on the far one is occluded and the model
      // guesses at it, so a height difference there means nothing — only
      // measure when the two are genuinely separated in frame.
      const ls = byName(kps, 'left_shoulder')
      const rs = byName(kps, 'right_shoulder')
      let frameAsymmetry: number | undefined
      if (ls && rs && Math.abs(ls.x - rs.x) / torso > 0.4) {
        frameAsymmetry = Math.abs(ls.y - rs.y) / torso
        push(asymmetries, frameAsymmetry)
        // Wider still means the camera is closer to head-on than side-on, and
        // every angle this analyser measures is projected garbage from there.
        if (Math.abs(ls.x - rs.x) / torso > 0.62) frontalFrames++
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
      return { ...empty, framesUsed, reason }
    }

    if (frontalFrames / framesUsed > 0.5) {
      return {
        ...empty,
        framesUsed,
        reason:
          'This looks filmed head-on. Elbow, hip and lean angles cannot be judged from the front — set the phone off to your side instead.',
      }
    }

    const confidence = confidences.reduce((a, b) => a + b, 0) / framesUsed
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
        confidence,
        unseen,
        reason: `Could not see your ${listPhrase(unseen)} well enough to judge anything here. Keep your whole body and both hands in frame, side-on.`,
      }
    }

    const creditedSeconds =
      creditedHoldSec !== undefined && Number.isFinite(creditedHoldSec) && creditedHoldSec > 0
        ? Math.min(duration, creditedHoldSec)
        : duration
    const envelopeSamples = frameReadings.flatMap((frame) => {
      const outside = materiallyOutsideEnvelope(frame, profile, judged)
      return outside === null ? [] : [{ t: frame.t, bad: outside }]
    })
    const cleanSeconds = sustainedCleanSeconds(envelopeSamples, creditedSeconds)
    const cleanRatio = creditedSeconds > 0 ? Math.min(1, cleanSeconds / creditedSeconds) : 0

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
    const elbowDeg = sustainedMinimum(heldElbows) ?? sustainedMinimum(elbows)
    const kneeDeg = sustainedMinimum(heldKnees) ?? sustainedMinimum(knees)
    const hipAngleDeg = sustainedMinimum(heldHipAngles) ?? sustainedMinimum(hipAngles)
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
        confidence,
        elbowDeg,
        kneeDeg,
        hipAngleDeg,
        hipOffset,
        leanRatio,
        shrugRatio,
        reason: 'Tracking confidence was too low to judge form from this clip.',
      }
    }

    const issues: FormIssue[] = []
    const notes: string[] = []
    const good: string[] = []
    const details: string[] = []

    if (judged.elbow && profile.minElbowDeg !== undefined && elbowDeg !== undefined) {
      if (elbowDeg < profile.minElbowDeg) {
        issues.push('arms')
        notes.push(
          elbowPeak !== undefined && elbowPeak >= profile.minElbowDeg
            ? `Elbows locked at their best (${Math.round(elbowPeak)}°) but sat nearer ${Math.round(elbowDeg)}° for much of the hold — keep the lock the whole way.`
            : `Elbows reached about ${Math.round(elbowPeak ?? elbowDeg)}° at their straightest — locked reads near 180°.`,
        )
      } else good.push(`Elbows locked (${Math.round(elbowDeg)}°)`)
    }

    if (judged.knee && profile.minKneeDeg !== undefined && kneeDeg !== undefined) {
      if (kneeDeg < profile.minKneeDeg) {
        issues.push('knees')
        notes.push(
          kneePeak !== undefined && kneePeak >= profile.minKneeDeg
            ? `Legs straightened fully at some point (${Math.round(kneePeak)}°) but bent for much of the hold — squeeze them straight and keep them there.`
            : `Knees measured about ${Math.round(kneePeak ?? kneeDeg)}° — straight legs read near 180°.`,
        )
      } else good.push(`Legs straight (${Math.round(kneeDeg)}°)`)
    }

    if (judged.hipAngle && profile.minHipAngleDeg !== undefined && hipAngleDeg !== undefined) {
      if (hipAngleDeg < profile.minHipAngleDeg) {
        // Its own issue, not "hips too high": a closed hip angle means the
        // body is still folded, which is the opposite complaint.
        issues.push('closed')
        notes.push(
          hipAnglePeak !== undefined && hipAnglePeak >= profile.minHipAngleDeg
            ? `Hips opened to ${Math.round(hipAnglePeak)}° at their best but closed back down for much of the hold — this position wants ${profile.minHipAngleDeg}°+ held, not visited.`
            : `Hips were only about ${Math.round(hipAngleDeg)}° open — this position wants closer to ${profile.minHipAngleDeg}°.`,
        )
      } else good.push(`Hips open (${Math.round(hipAngleDeg)}°)`)
    }

    if (judged.line && profile.levelTolerance !== undefined && hipOffset !== undefined) {
      if (hipOffset > profile.levelTolerance) {
        issues.push('pike')
        notes.push('Hips sat above your shoulders — that reads as a pike rather than a flat line.')
      } else if (hipOffset < -profile.levelTolerance) {
        issues.push('sag')
        notes.push('Hips dropped below your shoulders — the line was sagging.')
      } else good.push('Hips and shoulders level')
    }

    if (judged.lean && profile.minLeanRatio !== undefined && leanRatio !== undefined) {
      if (leanRatio < profile.minLeanRatio) {
        issues.push('lean')
        notes.push('Your shoulders stayed close to your hands — more forward lean is what makes this position lighter.')
      } else good.push('Good forward lean')
    }

    if (profile.checkShrug && shrugRatio !== undefined) {
      if (shrugRatio < 0.32) {
        issues.push('shrug')
        notes.push('Your shoulders looked shrugged up toward your ears — push the floor away and keep them down.')
      } else good.push('Shoulders down, not shrugged')
    }

    // ——— Faults that apply at every level, not just the headline geometry ———

    // Only reported when the camera was actually placed to see it.
    if (asymmetry !== undefined) {
      if (asymmetry > 0.22) {
        issues.push('twist')
        notes.push('One shoulder sat noticeably higher than the other — the hips are rotating. Square them up.')
      } else details.push('Shoulders looked square.')
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

    if (judged.elbow && elbowTrend && elbowTrend.early - elbowTrend.late > 8 && !issues.includes('arms')) {
      fadeSeen = true
      issues.push('arms')
      notes.push(
        `Elbows were straighter early (${Math.round(elbowTrend.early)}°) than late (${Math.round(elbowTrend.late)}°) — the lock gave out as you tired. End the set before that point.`,
      )
    }
    if (judged.line && lineTrend && !issues.includes('sag') && !issues.includes('pike')) {
      if (lineTrend.early - lineTrend.late > 0.18) {
        fadeSeen = true
        issues.push('sag')
        notes.push('You started level but the hips sank through the hold — the line broke down late, not from the start.')
      } else if (lineTrend.late - lineTrend.early > 0.18) {
        fadeSeen = true
        issues.push('pike')
        notes.push('Your hips crept upward as the hold went on — fatigue was folding you toward a pike.')
      }
    }
    if (judged.lean && leanTrend && leanTrend.early - leanTrend.late > 0.12 && !issues.includes('lean')) {
      fadeSeen = true
      issues.push('lean')
      notes.push('Your lean pulled back over the hold — shoulders drifted toward your hands as you tired.')
    }
    if (!fadeSeen && holdWindow >= 8 && (elbowTrend || lineTrend || leanTrend)) {
      details.push('Shape held up through the whole hold — no visible fade from start to finish.')
    }
    if (cleanSeconds < creditedSeconds) {
      details.push(
        `The clean window ended near ${cleanSeconds.toFixed(1)}s after two consecutive samples fell outside the tolerant form envelope.`,
      )
    } else {
      details.push('No sustained material breakdown was found across the credited hold.')
    }
    if (exitFramesDropped > 0) {
      details.push(
        `Graded on the ${verdictFrames.length} frames of the hold itself; the last ${exitFramesDropped} (coming out of the position) were left out.`,
      )
    }
    details.push('Scapular protraction is not measured by this camera check — confirm it yourself.')
    details.push(
      `Tracked with ${backend.id === 'blazepose' ? 'BlazePose' : 'MoveNet'}${
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

    return {
      ok: true,
      confidence,
      framesUsed,
      cleanSeconds,
      cleanRatio,
      elbowDeg,
      kneeDeg,
      hipAngleDeg,
      hipOffset,
      leanRatio,
      shrugRatio,
      wobble,
      asymmetry,
      issues: [...new Set(issues)],
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

/** A robust "kept through the hold" minimum that forgives a few bad detections. */
export function sustainedMinimum(xs: number[]): number | undefined {
  if (!xs.length) return undefined
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.25) - 1)]
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
