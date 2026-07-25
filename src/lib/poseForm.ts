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
  /** Straightest observed elbow angle, degrees (180 = locked). */
  elbowDeg?: number
  /** Shoulder→hip→knee angle: how open the hips are. */
  hipAngleDeg?: number
  /** Straightest observed knee angle. */
  kneeDeg?: number
  /** Hip height relative to shoulders, as a fraction of torso length.
   * Positive = hips above shoulders. */
  hipOffset?: number
  /** How far shoulders sit past the wrists, as a fraction of torso length. */
  leanRatio?: number
  /** Shoulder-to-ear gap over torso length; small means shrugged. */
  shrugRatio?: number
  /** Mean keypoint movement between frames — high means the hold was shaky. */
  wobble?: number
  /** Left/right height difference at the shoulders, over torso length. */
  asymmetry?: number
  /** Angle between the legs; the straddle's width. */
  straddleDeg?: number
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
  checkShrug: boolean
  /** Legs should be spread at least this wide (straddle only). */
  minStraddleDeg?: number
  /** Legs should be together within this angle (full planche only). */
  maxLegGapDeg?: number
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
    // A narrow straddle is a longer lever — width is free strength here.
    minStraddleDeg: 45,
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
    maxLegGapDeg: 12,
  },
}

/** Positions the camera can meaningfully assess. */
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
  sampleCount = 10,
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

    // Sample the middle of the hold; the ends are getting in and falling out.
    const from = duration * 0.25
    const to = duration * 0.85
    const times = Array.from({ length: sampleCount }, (_, i) =>
      sampleCount === 1 ? (from + to) / 2 : from + ((to - from) * i) / (sampleCount - 1),
    )

    const elbows: number[] = []
    const knees: number[] = []
    const hipAngles: number[] = []
    const hipOffsets: number[] = []
    const leans: number[] = []
    const shrugs: number[] = []
    const confidences: number[] = []
    const asymmetries: number[] = []
    const legGaps: number[] = []
    const drifts: number[] = []
    let prevAnchor: { sx: number; sy: number; hx: number; hy: number; torso: number } | null = null

    for (const t of times) {
      await seekTo(video, t)
      const poses = await detector.estimatePoses(video)
      const kps = poses[0]?.keypoints
      if (!kps?.length) continue
      const side = pickSide(kps)
      if (!side) continue

      const shoulder = byName(kps, `${side}_shoulder`)
      const elbow = byName(kps, `${side}_elbow`)
      const wrist = byName(kps, `${side}_wrist`)
      const hip = byName(kps, `${side}_hip`)
      // Ear only — the nose sits much further from the shoulder, so falling
      // back to it against the same threshold always reads as "not shrugged".
      const ear = byName(kps, `${side}_ear`)
      if (!shoulder || !hip) continue

      const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
      if (torso < 1) continue

      // Averaged over the points actually found. Dividing by a fixed four
      // penalised clips where a wrist was hidden behind a parallette, which
      // then failed the confidence gate despite tracking everything else.
      const found = [shoulder, elbow, wrist, hip].filter(Boolean) as Kp[]
      confidences.push(found.reduce((t2, k) => t2 + (k.score ?? 0), 0) / found.length)

      if (elbow && wrist) push(elbows, angleDeg(shoulder, elbow, wrist))

      // Legs: take the straighter side, since one-leg work deliberately keeps
      // the other tucked and the extended leg is the one being judged.
      for (const s of ['left', 'right'] as const) {
        const h = byName(kps, `${s}_hip`)
        const k = byName(kps, `${s}_knee`)
        const a = byName(kps, `${s}_ankle`)
        if (h && k && a) push(knees, angleDeg(h, k, a))
        if (h && k) {
          const sh = byName(kps, `${s}_shoulder`) ?? shoulder
          push(hipAngles, angleDeg(sh, h, k))
        }
      }

      // Screen y grows downward, so a hip above the shoulders is negative dy.
      hipOffsets.push((shoulder.y - hip.y) / torso)

      if (wrist) {
        // Lean is signed by which way the body points, so it reads the same
        // whichever way round the phone was set up.
        const facing = Math.sign(shoulder.x - hip.x) || 1
        push(leans, ((shoulder.x - wrist.x) * facing) / torso)
      }
      if (ear) push(shrugs, Math.hypot(shoulder.x - ear.x, shoulder.y - ear.y) / torso)

      // Twisting: one shoulder riding higher than the other means the hips are
      // rotating, which is the usual reason a one-leg extension fails.
      const ls = byName(kps, 'left_shoulder')
      const rs = byName(kps, 'right_shoulder')
      if (ls && rs) push(asymmetries, Math.abs(ls.y - rs.y) / torso)

      // Leg separation, for the straddle's width and the full planche's
      // legs-together requirement.
      const lk = byName(kps, 'left_knee') ?? byName(kps, 'left_ankle')
      const rk = byName(kps, 'right_knee') ?? byName(kps, 'right_ankle')
      const lh = byName(kps, 'left_hip')
      const rh = byName(kps, 'right_hip')
      if (lk && rk && lh && rh) {
        const midHip = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2, score: 1 }
        push(legGaps, angleDeg(lk, midHip, rk))
      }

      // Frame-to-frame drift of the shoulder/hip anchors: a steady hold barely
      // moves, a hold at the limit visibly shakes.
      const anchor = { sx: shoulder.x, sy: shoulder.y, hx: hip.x, hy: hip.y, torso }
      if (prevAnchor) {
        const d =
          (Math.hypot(anchor.sx - prevAnchor.sx, anchor.sy - prevAnchor.sy) +
            Math.hypot(anchor.hx - prevAnchor.hx, anchor.hy - prevAnchor.hy)) /
          2 /
          torso
        push(drifts, d)
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

    const confidence = confidences.reduce((a, b) => a + b, 0) / framesUsed
    // Best observed values: we are asking whether the position was ever
    // genuinely achieved, not what the average frame looked like.
    const elbowDeg = elbows.length ? Math.max(...elbows) : undefined
    const kneeDeg = knees.length ? Math.max(...knees) : undefined
    const hipAngleDeg = hipAngles.length ? Math.max(...hipAngles) : undefined
    const hipOffset = median(hipOffsets)
    const leanRatio = median(leans)
    const shrugRatio = median(shrugs)
    const asymmetry = median(asymmetries)
    const legGapDeg = median(legGaps)
    const wobble = median(drifts)

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

    if (profile.minElbowDeg !== undefined && elbowDeg !== undefined) {
      if (elbowDeg < profile.minElbowDeg) {
        issues.push('arms')
        notes.push(`Elbows reached about ${Math.round(elbowDeg)}° at their straightest — locked reads near 180°.`)
      } else good.push(`Elbows locked (${Math.round(elbowDeg)}°)`)
    }

    if (profile.minKneeDeg !== undefined && kneeDeg !== undefined) {
      if (kneeDeg < profile.minKneeDeg) {
        issues.push('knees')
        notes.push(`Knees measured about ${Math.round(kneeDeg)}° — straight legs read near 180°.`)
      } else good.push(`Legs straight (${Math.round(kneeDeg)}°)`)
    }

    if (profile.minHipAngleDeg !== undefined && hipAngleDeg !== undefined) {
      if (hipAngleDeg < profile.minHipAngleDeg) {
        // Its own issue, not "hips too high": a closed hip angle means the
        // body is still folded, which is the opposite complaint.
        issues.push('closed')
        notes.push(
          `Hips were only about ${Math.round(hipAngleDeg)}° open — this position wants closer to ${profile.minHipAngleDeg}°.`,
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

    if (asymmetry !== undefined) {
      if (asymmetry > 0.22) {
        issues.push('twist')
        notes.push('One shoulder sat noticeably higher than the other — the hips are rotating. Square them up.')
      } else details.push('Shoulders were level side to side.')
    }

    if (profile.minStraddleDeg !== undefined && legGapDeg !== undefined) {
      if (legGapDeg < profile.minStraddleDeg) {
        issues.push('narrow')
        notes.push(
          `Your straddle was only about ${Math.round(legGapDeg)}° wide. Wider legs shorten the lever and make this hold cheaper — pancake work pays off here.`,
        )
      } else good.push(`Straddle wide (${Math.round(legGapDeg)}°)`)
    }

    if (profile.maxLegGapDeg !== undefined && legGapDeg !== undefined) {
      if (legGapDeg > profile.maxLegGapDeg) {
        issues.push('narrow')
        notes.push(`Legs were about ${Math.round(legGapDeg)}° apart — a full planche wants them glued together.`)
      } else good.push('Legs together')
    }

    if (wobble !== undefined) {
      if (wobble > 0.06) {
        details.push('You were shaking a fair amount — that hold was at or past your limit.')
      } else if (wobble < 0.02) {
        details.push('Very steady hold.')
      }
    }

    return {
      ok: true,
      confidence,
      framesUsed,
      elbowDeg,
      kneeDeg,
      hipAngleDeg,
      hipOffset,
      leanRatio,
      shrugRatio,
      wobble,
      asymmetry,
      straddleDeg: legGapDeg,
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

/** Fetch a stored clip's blob so it can be analysed. */
export async function blobFromUrl(url: string): Promise<Blob | null> {
  try {
    const res = await fetch(url)
    return await res.blob()
  } catch {
    return null
  }
}
