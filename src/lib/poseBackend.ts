/**
 * Pose model loading, kept apart from the geometry that interprets it.
 *
 * Two models are available and they fail in different ways, which is the whole
 * reason both are here:
 *
 * - **BlazePose GHUM** via MediaPipe Tasks (`PoseLandmarker`) returns 33
 *   landmarks with a real per-joint visibility score, so "I could not see the
 *   shoulder" is reported rather than guessed at. It is markedly better on
 *   bodies that are not standing up, and the Tasks runtime is the maintained
 *   successor to the frozen TFJS wrapper this app used to ship (same model
 *   weights, faster WASM+GPU runtime, honest visibility values).
 * - **MoveNet Thunder** is a single-stage heatmap model. It has no person
 *   detector to fail first, so it sometimes holds on where BlazePose finds
 *   nobody at all.
 *
 * A planche is the hard case for both: horizontal, often face-down, limbs
 * overlapping. Rather than pick a winner in the abstract, the analyser probes
 * a couple of frames from the actual clip and keeps whichever model tracked
 * that footage better.
 *
 * Both are normalised to the same joint names for everything measured here
 * (`left_shoulder`, `right_hip`, …), so callers do not care which one ran.
 */

export type Kp = { x: number; y: number; score?: number; name?: string }

export type BackendId = 'mediapipe' | 'movenet'

export interface PoseBackend {
  id: BackendId
  estimate(img: HTMLCanvasElement | HTMLVideoElement): Promise<Kp[]>
}

/** Pinned with the npm package so the runtime and its WASM never drift apart. */
const TASKS_VISION_VERSION = '1.0.0'
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`
/**
 * The full (9 MB) variant: the same GHUM weights the old TFJS path used.
 * Heavy is markedly slower on phones for little gain on side-on footage,
 * lite gives up accuracy exactly where a horizontal body needs it.
 */
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task'

/** BlazePose's fixed landmark order, mapped to the names the geometry uses. */
const BLAZEPOSE_NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer', 'right_eye_inner', 'right_eye',
  'right_eye_outer', 'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist',
  'left_pinky', 'right_pinky', 'left_index', 'right_index', 'left_thumb', 'right_thumb',
  'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
  'left_heel', 'right_heel', 'left_foot_index', 'right_foot_index',
]

const READY_KEY = 'planchelab.poseReady'

/** True once any pose model has loaded successfully on this device. */
export function poseModelReady(): boolean {
  try {
    return localStorage.getItem(READY_KEY) === '1'
  } catch {
    return false
  }
}

function markReady() {
  try {
    localStorage.setItem(READY_KEY, '1')
  } catch {
    /* private mode — warming just stays off */
  }
}

let tfReady: Promise<void> | null = null

/** WebGL backend init for the MoveNet fallback. */
async function initTf(): Promise<void> {
  if (!tfReady) {
    tfReady = (async () => {
      const tf = await import('@tensorflow/tfjs-core')
      await import('@tensorflow/tfjs-backend-webgl')
      await tf.setBackend('webgl')
      await tf.ready()
    })().catch((e) => {
      tfReady = null
      throw e
    })
  }
  return tfReady
}

const loaders: Partial<Record<BackendId, Promise<PoseBackend>>> = {}

function sizeOf(img: HTMLCanvasElement | HTMLVideoElement): { w: number; h: number } {
  return img instanceof HTMLVideoElement
    ? { w: img.videoWidth, h: img.videoHeight }
    : { w: img.width, h: img.height }
}

async function loadMediaPipe(): Promise<PoseBackend> {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision')
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE)
  const create = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'IMAGE',
      numPoses: 1,
      // A horizontal, face-down body is the weakest case for the person
      // detector, so it gets a lower bar than the upright-selfie default.
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
    })
  // Some WebViews advertise a GPU they cannot actually deliver; the model is
  // the same either way, CPU is merely slower.
  const landmarker = await create('GPU').catch(() => create('CPU'))
  markReady()
  return {
    id: 'mediapipe',
    estimate: async (img) => {
      const { w, h } = sizeOf(img)
      if (!w || !h) return []
      const found = landmarker.detect(img).landmarks[0]
      if (!found) return []
      return found.map((p, i) => ({
        // Landmarks arrive normalised 0–1; the geometry works in pixels.
        x: p.x * w,
        y: p.y * h,
        // Visibility is the model's own "was this joint actually seen" —
        // absent (older runtime quirk) counts as unseen, never as trusted.
        score: p.visibility ?? 0,
        name: BLAZEPOSE_NAMES[i],
      }))
    },
  }
}

async function loadMoveNet(): Promise<PoseBackend> {
  await initTf()
  const poseDetection = await import('@tensorflow-models/pose-detection')
  const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
    modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
  })
  markReady()
  return {
    id: 'movenet',
    estimate: async (img) => (await detector.estimatePoses(img))[0]?.keypoints ?? [],
  }
}

function load(id: BackendId): Promise<PoseBackend> {
  const existing = loaders[id]
  if (existing) return existing
  const started = (id === 'mediapipe' ? loadMediaPipe() : loadMoveNet()).catch((e) => {
    // Let a later attempt retry instead of failing forever.
    delete loaders[id]
    throw e
  })
  loaders[id] = started
  return started
}

export function getBackend(id: BackendId): Promise<PoseBackend> {
  return load(id)
}

/**
 * Start loading in the background while the athlete is still setting up, so
 * the first analysis is not waiting on a model. Gated on the ready flag so a
 * fresh install never quietly pulls megabytes without being asked.
 */
export function warmDetector(): void {
  if (!poseModelReady()) return
  void load('mediapipe').catch(() => {
    /* offline — the explicit tap surfaces the error */
  })
}

/**
 * Fetch the model on purpose, right now.
 *
 * Until this existed the several-megabyte download could only be triggered by
 * tapping "check my form" — which happens mid-workout, between sets, on
 * whatever connection the gym has. This lets it be done deliberately at home
 * instead; afterwards the service worker serves it from cache and the check
 * works offline.
 */
export async function downloadPoseModel(): Promise<void> {
  await load('mediapipe')
}

/** Joints every measurement depends on, used to score how well a model tracked. */
const CORE_JOINTS = [
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip', 'left_knee', 'right_knee',
]

/** Above this, bilateral depth is too visible for an honest side-view grade. */
export const MAX_SIDE_VIEW_RATIO = 0.42

/** Mean confidence across the joints that matter, 0–1. */
export function trackingScore(kps: Kp[]): number {
  if (!kps.length) return 0
  const total = CORE_JOINTS.reduce((sum, n) => sum + (kps.find((k) => k.name === n)?.score ?? 0), 0)
  return total / CORE_JOINTS.length
}

/**
 * Apparent shoulder/hip depth relative to torso length.
 *
 * In the required side view, left/right landmarks collapse onto nearly the
 * same image location. A large bilateral span means the athlete is filmed
 * front-on or at a strong three-quarter angle, where sagittal elbow, hip and
 * lean measurements are foreshortened and must not be graded.
 */
export function apparentBodyWidthRatio(kps: Kp[], minScore = 0.42): number | undefined {
  const point = (name: string) => {
    const found = kps.find((candidate) => candidate.name === name)
    return found && (found.score ?? 0) >= minScore ? found : undefined
  }
  const ls = point('left_shoulder')
  const rs = point('right_shoulder')
  const lh = point('left_hip')
  const rh = point('right_hip')
  const torsos = [
    ls && lh ? Math.hypot(ls.x - lh.x, ls.y - lh.y) : 0,
    rs && rh ? Math.hypot(rs.x - rh.x, rs.y - rh.y) : 0,
  ].filter((length) => length >= 1)
  const widths = [
    ls && rs ? Math.hypot(ls.x - rs.x, ls.y - rs.y) : 0,
    lh && rh ? Math.hypot(lh.x - rh.x, lh.y - rh.y) : 0,
  ].filter((length) => length >= 1)
  if (!torsos.length || !widths.length) return undefined
  const torso = torsos.reduce((total, length) => total + length, 0) / torsos.length
  return Math.max(...widths) / torso
}
