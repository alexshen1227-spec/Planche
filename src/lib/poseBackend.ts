/**
 * Pose model loading, kept apart from the geometry that interprets it.
 *
 * Two models are available and they fail in different ways, which is the whole
 * reason both are here:
 *
 * - **BlazePose** (the GHUM model, the same one MediaPipe ships) returns 33
 *   landmarks with a real per-joint visibility score, so "I could not see the
 *   shoulder" is reported rather than guessed at. It is markedly better on
 *   bodies that are not standing up.
 * - **MoveNet Thunder** is a single-stage heatmap model. It has no person
 *   detector to fail first, so it sometimes holds on where BlazePose finds
 *   nobody at all.
 *
 * A planche is the hard case for both: horizontal, often face-down, limbs
 * overlapping. Rather than pick a winner in the abstract, the analyser probes
 * a couple of frames from the actual clip and keeps whichever model tracked
 * that footage better.
 *
 * Both expose the same joint names for everything measured here
 * (`left_shoulder`, `right_hip`, …), so callers do not care which one ran.
 */

export type Kp = { x: number; y: number; score?: number; name?: string }

export type BackendId = 'blazepose' | 'movenet'

export interface PoseBackend {
  id: BackendId
  estimate(img: HTMLCanvasElement | HTMLVideoElement): Promise<Kp[]>
}

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

/** WebGL backend init, shared by both models. */
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

function load(id: BackendId): Promise<PoseBackend> {
  const existing = loaders[id]
  if (existing) return existing
  const started = (async (): Promise<PoseBackend> => {
    await initTf()
    const poseDetection = await import('@tensorflow-models/pose-detection')
    if (id === 'blazepose') {
      const detector = await poseDetection.createDetector(poseDetection.SupportedModels.BlazePose, {
        runtime: 'tfjs',
        modelType: 'full',
        // Smoothing assumes a live stream of adjacent frames. These samples are
        // seconds apart, so smoothing across them would blur real movement.
        enableSmoothing: false,
      })
      markReady()
      return {
        id,
        estimate: async (img) => (await detector.estimatePoses(img))[0]?.keypoints ?? [],
      }
    }
    const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
    })
    markReady()
    return {
      id,
      estimate: async (img) => (await detector.estimatePoses(img))[0]?.keypoints ?? [],
    }
  })().catch((e) => {
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
  void load('blazepose').catch(() => {
    /* offline — the explicit tap surfaces the error */
  })
}

/** Joints every measurement depends on, used to score how well a model tracked. */
const CORE_JOINTS = [
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip', 'left_knee', 'right_knee',
]

/** Mean confidence across the joints that matter, 0–1. */
export function trackingScore(kps: Kp[]): number {
  if (!kps.length) return 0
  const total = CORE_JOINTS.reduce((sum, n) => sum + (kps.find((k) => k.name === n)?.score ?? 0), 0)
  return total / CORE_JOINTS.length
}
