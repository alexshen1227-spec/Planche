import type { FormIssue } from '../types'

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
}

type Kp = { x: number; y: number; score?: number; name?: string }

const MIN_KP_SCORE = 0.3
const MIN_FRAMES = 3

/**
 * What "correct" means for each position. Only the checks listed run, which
 * is what stops the analyser flagging the deliberate shapes of a progression.
 */
interface PoseProfile {
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

/**
 * A small tolerance outside the headline thresholds keeps one near-boundary
 * estimate from stealing time. These are deliberately still narrow enough to
 * catch a material loss of the position.
 */
function materiallyOutsideEnvelope(frame: FrameReading, profile: PoseProfile): boolean | null {
  const required: (number | undefined)[] = []
  const failed: boolean[] = []
  const check = (value: number | undefined, didFail: (n: number) => boolean) => {
    required.push(value)
    if (value !== undefined) failed.push(didFail(value))
  }

  if (profile.minElbowDeg !== undefined) {
    check(frame.elbowDeg, (n) => n < profile.minElbowDeg! - 5)
  }
  if (profile.minKneeDeg !== undefined) {
    check(frame.kneeDeg, (n) => n < profile.minKneeDeg! - 7)
  }
  if (profile.minHipAngleDeg !== undefined) {
    check(frame.hipAngleDeg, (n) => n < profile.minHipAngleDeg! - 8)
  }
  if (profile.levelTolerance !== undefined) {
    check(frame.hipOffset, (n) => Math.abs(n) > profile.levelTolerance! + 0.08)
  }
  if (profile.minLeanRatio !== undefined) {
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

/** Angles come back NaN when two keypoints coincide; never let that through. */
function push(arr: number[], v: number) {
  if (Number.isFinite(v)) arr.push(v)
}

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

let detectorPromise: Promise<{
  estimatePoses: (img: HTMLVideoElement) => Promise<{ keypoints: Kp[] }[]>
}> | null = null

/**
 * Loaded on demand, not at startup: it is several megabytes and most sessions
 * never ask for it. The first analysis needs a network connection; after that
 * the service worker serves it from cache.
 */
async function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const [tf, poseDetection] = await Promise.all([
        import('@tensorflow/tfjs-core'),
        import('@tensorflow-models/pose-detection'),
      ])
      await import('@tensorflow/tfjs-backend-webgl')
      await tf.setBackend('webgl')
      await tf.ready()
      return poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
      })
    })().catch((e) => {
      detectorPromise = null // let a later attempt retry rather than fail forever
      throw e
    })
  }
  return detectorPromise
}

/**
 * Start loading the detector while the athlete is still setting up, so an
 * enabled automatic form check does not sit through the model spin-up after
 * the set. The setting is the athlete's opt-in to the initial model download.
 */
export function warmDetector(): void {
  void getDetector().catch(() => {
    /* offline — the explicit tap will surface the error */
  })
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
  return { ok: false, confidence: 0, framesUsed: 0, issues: [], notes: [], good: [], details: [], reason }
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

    const detector = await getDetector()
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

    for (const t of times) {
      await seekTo(video, t)
      const poses = await detector.estimatePoses(video)
      const kps = poses[0]?.keypoints
      if (!kps?.length) continue
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
      return {
        ...empty,
        framesUsed,
        reason:
          'Could not track your body reliably. Film side-on, whole body in frame, with the light in front of you rather than behind.',
      }
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
    // Every criterion which can change the verdict must be observable for a
    // majority of tracked frames. Missing wrists/elbows/knees are "unknown",
    // never a silent pass.
    const requiredCoverage = Math.max(MIN_FRAMES, Math.ceil(framesUsed * 0.55))
    const missing: string[] = []
    if (profile.minElbowDeg !== undefined && elbows.length < requiredCoverage) missing.push('elbows')
    if (profile.minKneeDeg !== undefined && knees.length < requiredCoverage) missing.push('knees')
    if (profile.minHipAngleDeg !== undefined && hipAngles.length < requiredCoverage) missing.push('hips')
    if (profile.levelTolerance !== undefined && hipOffsets.length < requiredCoverage) missing.push('body line')
    if (profile.minLeanRatio !== undefined && leans.length < requiredCoverage) missing.push('forward lean')
    if (missing.length) {
      return {
        ...empty,
        framesUsed,
        confidence,
        reason: `Could not see enough of your ${missing.join(', ')} to judge this hold. Keep your whole body and both hands in frame, side-on.`,
      }
    }

    const elbowPeak = elbows.length ? Math.max(...elbows) : undefined
    const kneePeak = knees.length ? Math.max(...knees) : undefined
    const hipAnglePeak = hipAngles.length ? Math.max(...hipAngles) : undefined
    const elbowDeg = sustainedMinimum(elbows)
    const kneeDeg = sustainedMinimum(knees)
    const hipAngleDeg = sustainedMinimum(hipAngles)
    const hipOffset = median(hipOffsets)
    const leanRatio = median(leans)
    const shrugRatio = median(shrugs)
    const asymmetry = median(asymmetries)
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

    const creditedSeconds =
      creditedHoldSec !== undefined && Number.isFinite(creditedHoldSec) && creditedHoldSec > 0
        ? Math.min(duration, creditedHoldSec)
        : duration
    const envelopeSamples = frameReadings.flatMap((frame) => {
      const outside = materiallyOutsideEnvelope(frame, profile)
      return outside === null ? [] : [{ t: frame.t, bad: outside }]
    })
    const cleanSeconds = sustainedCleanSeconds(envelopeSamples, creditedSeconds)
    const cleanRatio = creditedSeconds > 0 ? Math.min(1, cleanSeconds / creditedSeconds) : 0

    const issues: FormIssue[] = []
    const notes: string[] = []
    const good: string[] = []
    const details: string[] = []

    if (profile.minElbowDeg !== undefined && elbowDeg !== undefined) {
      if (elbowDeg < profile.minElbowDeg) {
        issues.push('arms')
        notes.push(
          elbowPeak !== undefined && elbowPeak >= profile.minElbowDeg
            ? `Elbows locked at their best (${Math.round(elbowPeak)}°) but sat nearer ${Math.round(elbowDeg)}° for much of the hold — keep the lock the whole way.`
            : `Elbows reached about ${Math.round(elbowPeak ?? elbowDeg)}° at their straightest — locked reads near 180°.`,
        )
      } else good.push(`Elbows locked (${Math.round(elbowDeg)}°)`)
    }

    if (profile.minKneeDeg !== undefined && kneeDeg !== undefined) {
      if (kneeDeg < profile.minKneeDeg) {
        issues.push('knees')
        notes.push(
          kneePeak !== undefined && kneePeak >= profile.minKneeDeg
            ? `Legs straightened fully at some point (${Math.round(kneePeak)}°) but bent for much of the hold — squeeze them straight and keep them there.`
            : `Knees measured about ${Math.round(kneePeak ?? kneeDeg)}° — straight legs read near 180°.`,
        )
      } else good.push(`Legs straight (${Math.round(kneeDeg)}°)`)
    }

    if (profile.minHipAngleDeg !== undefined && hipAngleDeg !== undefined) {
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

    if (profile.levelTolerance !== undefined && hipOffset !== undefined) {
      if (hipOffset > profile.levelTolerance) {
        issues.push('pike')
        notes.push('Hips sat above your shoulders — that reads as a pike rather than a flat line.')
      } else if (hipOffset < -profile.levelTolerance) {
        issues.push('sag')
        notes.push('Hips dropped below your shoulders — the line was sagging.')
      } else good.push('Hips and shoulders level')
    }

    if (profile.minLeanRatio !== undefined && leanRatio !== undefined) {
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

    if (elbowTrend && elbowTrend.early - elbowTrend.late > 8 && !issues.includes('arms')) {
      fadeSeen = true
      issues.push('arms')
      notes.push(
        `Elbows were straighter early (${Math.round(elbowTrend.early)}°) than late (${Math.round(elbowTrend.late)}°) — the lock gave out as you tired. End the set before that point.`,
      )
    }
    if (lineTrend && !issues.includes('sag') && !issues.includes('pike')) {
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
    if (leanTrend && leanTrend.early - leanTrend.late > 0.12 && !issues.includes('lean')) {
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
    details.push('Scapular protraction is not measured by this camera check — confirm it yourself.')

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
