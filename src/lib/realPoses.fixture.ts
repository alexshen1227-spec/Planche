import type { Kp } from './poseBackend'
import type { JudgeInput } from './poseForm'

/**
 * Landmarks the real pose model produced from real photographs.
 *
 * Synthetic poses prove the judge's reasoning is sound; they cannot prove its
 * numbers describe actual human beings. These do. Each entry is what MediaPipe
 * BlazePose actually returned for a freely-licensed photograph of the position
 * named — captured once through the app's own pipeline (same model, same
 * rotation probe) and frozen here, so the whole thing replays in a unit test
 * with no camera, no network and no 9 MB download.
 *
 * Stills rather than clips on purpose: with no frame-to-frame movement, any
 * disagreement is systematic — a landmark the model places badly on a
 * horizontal body, or a threshold that was never true of real proportions —
 * rather than one unlucky frame. Real footage measured separately puts
 * frame-to-frame landmark jitter at roughly 1.5–2% of torso length, which is
 * what the synthetic eval's noise levels are set from.
 *
 * Sources, all Wikimedia Commons:
 *  - plancheLean:  "Planche.jpg"
 *  - plank:        "Girl doing push-ups from the side.jpg"
 *  - straddleOffAxis: "Straddle planche 2 doigts.jpg"
 */

interface RealPose {
  /** What the photograph actually shows, established by looking at it. */
  truth: string
  width: number
  height: number
  /** Orientation the model's own probe chose for this frame. */
  rotation: 0 | 90 | 270
  points: [name: string, x: number, y: number, score: number][]
}

export const REAL_POSES: Record<string, RealPose> = {
  plancheLean: {
    truth:
      'Side-on, arms locked, legs straight, body level, shoulders far past the hands. Nothing to correct.',
    width: 1280,
    height: 790,
    rotation: 0,
    points: [
      ['left_ear', 122.5, 332.7, 1],
      ['right_ear', 122.2, 326.4, 1],
      ['left_shoulder', 240.8, 355.9, 1],
      ['right_shoulder', 268.1, 306.1, 1],
      ['left_elbow', 380.4, 498.5, 0.995],
      ['right_elbow', 434, 450.3, 0.377],
      ['left_wrist', 519, 650.1, 0.992],
      ['right_wrist', 548, 595.1, 0.437],
      ['left_hip', 580.3, 324, 0.999],
      ['right_hip', 590.4, 296.3, 0.999],
      ['left_knee', 859.7, 330.4, 0.891],
      ['right_knee', 857.2, 314.7, 0.163],
      ['left_ankle', 1135.2, 333.9, 0.895],
      ['right_ankle', 1116.7, 315.8, 0.352],
    ],
  },
  plank: {
    truth:
      'Side-on plank on push-up handles: straight body, shoulders stacked over the hands rather than leaning past them.',
    width: 1280,
    height: 853,
    rotation: 270,
    points: [
      ['left_ear', 1115.4, 199.5, 1],
      ['right_ear', 1115.1, 199.6, 1],
      ['left_shoulder', 993.7, 273.6, 0.999],
      ['right_shoulder', 993.3, 270.7, 1],
      ['left_elbow', 912.6, 394.8, 0.238],
      ['right_elbow', 875.9, 383.4, 0.973],
      ['left_wrist', 966.1, 502.6, 0.263],
      ['right_wrist', 951.2, 530.3, 0.94],
      ['left_hip', 693.1, 375, 0.998],
      ['right_hip', 676.7, 372.5, 1],
      ['left_knee', 657.9, 430.7, 0.344],
      ['right_knee', 401.1, 458, 0.981],
      ['left_ankle', 564, 473.9, 0.48],
      ['right_ankle', 124.3, 494.4, 0.978],
    ],
  },
  straddleOffAxis: {
    truth:
      'A real straddle planche, but filmed from a strong three-quarter angle. Every sagittal angle in it is foreshortened, so it must not be graded at all.',
    width: 1280,
    height: 853,
    rotation: 90,
    points: [
      ['left_ear', 1124.3, 355.9, 1],
      ['right_ear', 1110.1, 338.5, 1],
      ['left_shoulder', 999.8, 394.2, 1],
      ['right_shoulder', 916.2, 305.6, 1],
      ['left_elbow', 898.9, 496.4, 0.717],
      ['right_elbow', 752.2, 424.5, 0.993],
      ['left_wrist', 843.2, 632.1, 0.905],
      ['right_wrist', 651.3, 591.1, 0.985],
      ['left_hip', 723.7, 371.7, 0.997],
      ['right_hip', 664.2, 282.3, 0.999],
      ['left_knee', 756.6, 502.9, 0.631],
      ['right_knee', 429.4, 274.8, 0.978],
      ['left_ankle', 630.9, 639.8, 0.637],
      ['right_ankle', 150.8, 275.4, 0.971],
    ],
  },
}

/**
 * Expand a captured frame into the clip the judge expects. Optional jitter
 * reproduces the frame-to-frame landmark wander measured on real video, so a
 * still can be asked the harder question: does this verdict survive a tracker
 * that never sits perfectly still?
 */
export function realClip(
  key: keyof typeof REAL_POSES,
  { frames = 24, seconds = 10, jitter = 0, seed = 1 } = {},
): JudgeInput {
  const pose = REAL_POSES[key]
  let state = seed >>> 0
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296 - 0.5
  }
  const torso = Math.hypot(
    pose.points.find((p) => p[0] === 'left_shoulder')![1] -
      pose.points.find((p) => p[0] === 'left_hip')![1],
    pose.points.find((p) => p[0] === 'left_shoulder')![2] -
      pose.points.find((p) => p[0] === 'left_hip')![2],
  )
  const times = Array.from({ length: frames }, (_, i) => (seconds * i) / (frames - 1))
  return {
    tracked: times.map((t) => ({
      t,
      kps: pose.points.map(
        ([name, x, y, score]): Kp => ({
          name,
          x: x + rand() * jitter * torso * 2,
          y: y + rand() * jitter * torso * 2,
          score,
        }),
      ),
    })),
    times,
    width: pose.width,
    height: pose.height,
    duration: seconds,
    creditedHoldSec: seconds,
    from: times[0],
    to: times[times.length - 1],
    holdWindow: seconds,
    backendId: 'mediapipe',
    rotation: pose.rotation,
  }
}
