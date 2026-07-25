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
  issues: FormIssue[]
  notes: string[]
  /** Things that went well, so the feedback is not only negative. */
  good: string[]
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
    // Arms are allowed to bend here; balance is the skill being trained.
    label: 'Frog stand',
    checkShrug: true,
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

export async function analyseClip(
  blob: Blob,
  exerciseId: string,
  sampleCount = 10,
): Promise<PoseFormResult> {
  const empty: PoseFormResult = { ok: false, confidence: 0, framesUsed: 0, issues: [], notes: [], good: [] }
  const profile = POSE_PROFILES[exerciseId]
  if (!profile) return { ...empty, reason: 'This movement is not one the camera can assess.' }

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
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
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
      const ear = byName(kps, `${side}_ear`) ?? byName(kps, 'nose')
      if (!shoulder || !hip) continue

      const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
      if (torso < 1) continue

      confidences.push(
        ([shoulder, elbow, wrist, hip].filter(Boolean) as Kp[]).reduce((t2, k) => t2 + (k.score ?? 0), 0) / 4,
      )

      if (elbow && wrist) elbows.push(angleDeg(shoulder, elbow, wrist))

      // Legs: take the straighter side, since one-leg work deliberately keeps
      // the other tucked and the extended leg is the one being judged.
      for (const s of ['left', 'right'] as const) {
        const h = byName(kps, `${s}_hip`)
        const k = byName(kps, `${s}_knee`)
        const a = byName(kps, `${s}_ankle`)
        if (h && k && a) knees.push(angleDeg(h, k, a))
        if (h && k) {
          const sh = byName(kps, `${s}_shoulder`) ?? shoulder
          hipAngles.push(angleDeg(sh, h, k))
        }
      }

      // Screen y grows downward, so a hip above the shoulders is negative dy.
      hipOffsets.push((shoulder.y - hip.y) / torso)

      if (wrist) {
        // Lean is signed by which way the body points, so it reads the same
        // whichever way round the phone was set up.
        const facing = Math.sign(shoulder.x - hip.x) || 1
        leans.push(((shoulder.x - wrist.x) * facing) / torso)
      }
      if (ear) shrugs.push(Math.hypot(shoulder.x - ear.x, shoulder.y - ear.y) / torso)
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
        issues.push('pike')
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

    if (profile.checkShrug && shrugRatio !== undefined && shrugRatio < 0.32) {
      issues.push('shrug')
      notes.push('Your shoulders looked shrugged up toward your ears — push the floor away and keep them down.')
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
      issues: [...new Set(issues)],
      notes,
      good,
    }
  } catch (err) {
    return { ...empty, reason: err instanceof Error ? err.message : 'Analysis failed.' }
  } finally {
    URL.revokeObjectURL(url)
    video.src = ''
  }
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
