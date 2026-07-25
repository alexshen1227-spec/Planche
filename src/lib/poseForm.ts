import type { FormIssue } from '../types'

/**
 * Automatic form analysis from a recorded clip.
 *
 * A pose model gives 2D keypoints; the useful part is what you compute from
 * them. For a planche the three questions that matter are measurable angles:
 * are the elbows locked, is the body level, and are the hips in line. This
 * runs on the clip after the set rather than live, so it never competes with
 * the timer for CPU.
 *
 * Everything here is advisory. Pose models are trained overwhelmingly on
 * upright people, so a horizontal athlete is exactly the case they are worst
 * at — results are gated on keypoint confidence and always land as a
 * *suggestion* the athlete confirms, never as a verdict written straight into
 * the log.
 */

export interface PoseFormResult {
  ok: boolean
  /** Why analysis could not run or could not be trusted. */
  reason?: string
  /** 0–1: how confident the underlying keypoints were. */
  confidence: number
  framesUsed: number
  /** Straightest observed elbow angle, degrees (180 = locked). */
  elbowDeg?: number
  /** Shoulder→hip→ankle angle, degrees (180 = flat body line). */
  bodyLineDeg?: number
  /** Hip height minus shoulder height, as a fraction of torso length.
   * Positive = hips above shoulders (piked), negative = sagging. */
  hipOffset?: number
  issues: FormIssue[]
  notes: string[]
}

type Kp = { x: number; y: number; score?: number; name?: string }

const MIN_KP_SCORE = 0.3
const MIN_FRAMES = 3

function angleDeg(a: Kp, b: Kp, c: Kp): number {
  const abx = a.x - b.x
  const aby = a.y - b.y
  const cbx = c.x - b.x
  const cby = c.y - b.y
  const dot = abx * cbx + aby * cby
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby)
  if (mag === 0) return NaN
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI
}

function byName(kps: Kp[], name: string): Kp | undefined {
  const k = kps.find((p) => p.name === name)
  return k && (k.score ?? 0) >= MIN_KP_SCORE ? k : undefined
}

/** Prefer whichever side the camera saw more clearly. */
function pickSide(kps: Kp[]): 'left' | 'right' | null {
  const score = (side: string) =>
    ['shoulder', 'elbow', 'wrist', 'hip'].reduce((t, part) => t + (byName(kps, `${side}_${part}`)?.score ?? 0), 0)
  const l = score('left')
  const r = score('right')
  if (Math.max(l, r) === 0) return null
  return l >= r ? 'left' : 'right'
}

let detectorPromise: Promise<{
  estimatePoses: (img: HTMLVideoElement) => Promise<{ keypoints: Kp[] }[]>
}> | null = null

/**
 * Loaded on demand, not at startup: it is several megabytes and most sessions
 * never ask for it. The first analysis needs a network connection; after that
 * the browser cache serves it.
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
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      })
    })()
  }
  return detectorPromise
}

/** Seek a video element and wait until that frame is actually painted. */
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

export async function analyseClip(blob: Blob, sampleCount = 8): Promise<PoseFormResult> {
  const empty: PoseFormResult = { ok: false, confidence: 0, framesUsed: 0, issues: [], notes: [] }
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.src = url

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('clip could not be decoded'))
      window.setTimeout(() => reject(new Error('clip timed out')), 8000)
    })

    const detector = await getDetector()
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
    if (duration === 0) return { ...empty, reason: 'That clip has no readable duration.' }

    // Sample the middle of the hold; the ends contain getting in and falling out.
    const from = duration * 0.25
    const to = duration * 0.85
    const times = Array.from({ length: sampleCount }, (_, i) =>
      sampleCount === 1 ? (from + to) / 2 : from + ((to - from) * i) / (sampleCount - 1),
    )

    const elbowAngles: number[] = []
    const bodyAngles: number[] = []
    const hipOffsets: number[] = []
    const confidences: number[] = []

    for (const t of times) {
      await seekTo(video, t)
      const poses = await detector.estimatePoses(video)
      const kps = poses[0]?.keypoints
      if (!kps || kps.length === 0) continue
      const side = pickSide(kps)
      if (!side) continue

      const shoulder = byName(kps, `${side}_shoulder`)
      const elbow = byName(kps, `${side}_elbow`)
      const wrist = byName(kps, `${side}_wrist`)
      const hip = byName(kps, `${side}_hip`)
      const ankle = byName(kps, `${side}_ankle`) ?? byName(kps, `${side}_knee`)
      if (!shoulder || !hip) continue

      confidences.push(
        ([shoulder, elbow, wrist, hip, ankle].filter(Boolean) as Kp[]).reduce(
          (t2, k) => t2 + (k.score ?? 0),
          0,
        ) / 5,
      )

      if (elbow && wrist) elbowAngles.push(angleDeg(shoulder, elbow, wrist))
      if (ankle) bodyAngles.push(angleDeg(shoulder, hip, ankle))

      const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
      // Screen y grows downward, so a hip above the shoulders is a negative dy.
      if (torso > 1) hipOffsets.push((shoulder.y - hip.y) / torso)
    }

    const framesUsed = confidences.length
    if (framesUsed < MIN_FRAMES) {
      return {
        ...empty,
        framesUsed,
        reason:
          'Could not track your body reliably. Film side-on with your whole body in frame and good light, then try again.',
      }
    }

    const confidence = confidences.reduce((a, b) => a + b, 0) / framesUsed
    const median = (xs: number[]) => {
      if (!xs.length) return undefined
      const s = [...xs].sort((a, b) => a - b)
      return s[Math.floor(s.length / 2)]
    }
    // Best (straightest) elbow rather than median: we want to know whether the
    // arm was ever actually locked during the hold.
    const elbowDeg = elbowAngles.length ? Math.max(...elbowAngles) : undefined
    const bodyLineDeg = median(bodyAngles)
    const hipOffset = median(hipOffsets)

    if (confidence < 0.35) {
      return {
        ...empty,
        framesUsed,
        confidence,
        elbowDeg,
        bodyLineDeg,
        hipOffset,
        reason: 'Tracking confidence was too low to judge form from this clip.',
      }
    }

    const issues: FormIssue[] = []
    const notes: string[] = []

    if (elbowDeg !== undefined) {
      if (elbowDeg < 160) {
        issues.push('arms')
        notes.push(`Elbows measured about ${Math.round(elbowDeg)}° at their straightest — a locked arm reads near 180°.`)
      } else {
        notes.push(`Elbows looked locked (about ${Math.round(elbowDeg)}°).`)
      }
    }
    if (bodyLineDeg !== undefined) {
      if (bodyLineDeg < 155) {
        issues.push('hips')
        notes.push(`Shoulder–hip–ankle measured about ${Math.round(bodyLineDeg)}° — a straight body reads near 180°.`)
      } else {
        notes.push(`Body line looked straight (about ${Math.round(bodyLineDeg)}°).`)
      }
    }
    if (hipOffset !== undefined) {
      if (hipOffset > 0.35) {
        issues.push('level')
        notes.push('Hips sat noticeably above your shoulders — that is a pike, not a planche.')
      } else if (hipOffset < -0.35) {
        issues.push('level')
        notes.push('Hips sat below your shoulders — the line was sagging.')
      } else {
        notes.push('Hips and shoulders looked level.')
      }
    }

    return { ok: true, confidence, framesUsed, elbowDeg, bodyLineDeg, hipOffset, issues, notes }
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
