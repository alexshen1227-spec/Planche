import type { StepId } from '../types'

/**
 * Side-view figures of each position, built from body geometry rather than
 * drawn point by point.
 *
 * Segment lengths are the ones the camera judge's synthetic skeletons use
 * (`PROPORTIONS` in lib/poseSynth, measured off real BlazePose output), and
 * each position's lean and hip and knee angles follow its `IDEAL` there — so
 * the figure on Home is the same shape the camera grades against. The body
 * faces right: hands planted, head toward the right, feet to the left.
 */

/** Torso length in drawing units; every other segment is a share of it. */
const T = 26
const SEG = {
  forearm: 0.6 * T,
  upperArm: 0.59 * T,
  thigh: 0.82 * T,
  shin: 0.81 * T,
  neck: 0.42 * T,
}
const HEAD_R = 6
const GROUND_Y = 81

/**
 * One position as segment directions, in degrees with y pointing up:
 * 0 = toward the head side, 90 = up, 180 = toward the feet, 270 = down.
 */
interface Spec {
  /** Wrist → elbow, then elbow → shoulder. One number is a straight arm. */
  arm: number | [number, number]
  /** Shoulder → hip. */
  torso: number
  /** Hip → knee and knee → ankle for the near leg. */
  thigh: number
  shin: number
  /** The far leg when it differs (one-leg, straddle); drawn faint, behind. */
  far?: { thigh: number; shin: number }
  /** Shoulder → head; defaults to straight on from the torso. */
  neck?: number
  /** Feet resting on the floor (plank and lean shapes). */
  feetDown?: boolean
  /**
   * Hands on parallettes. With these proportions a hip at shoulder height
   * hangs the knees within a few units of the floor — true to life on the
   * floor, but it reads as kneeling — so the flying shapes are drawn on bars.
   */
  bars?: boolean
}

/** Grip height of the parallettes, in drawing units. */
const BAR_H = 8

/** Arm direction for a straight arm whose shoulder sits `lean` torso-lengths ahead of the hand. */
const straightArm = (lean: number) => 90 - (Math.asin(Math.min(0.99, (lean * T) / (SEG.forearm + SEG.upperArm))) * 180) / Math.PI
/** Body slope for a straight body from the shoulder down to feet on the floor. */
const slopeToFloor = (lean: number) => {
  const arm = SEG.forearm + SEG.upperArm
  const height = Math.sqrt(arm ** 2 - (lean * T) ** 2)
  return 180 + (Math.asin(height / (T + SEG.thigh + SEG.shin)) * 180) / Math.PI
}

const SPECS: Record<StepId, Spec> = (() => {
  // Straight-arm planks and leans: one straight line from shoulder to toes.
  const plank = (lean: number): Spec => {
    const slope = slopeToFloor(lean)
    return { arm: straightArm(lean), torso: slope, thigh: slope, shin: slope, neck: slope - 180 + 4, feetDown: true }
  }
  return {
    foundations: plank(0.45), // the pseudo planche push-up hold
    lean: plank(0.8),
    // Bent arms, knees resting on the backs of the upper arms, hips high.
    frog: { arm: [80, 0], torso: 135, thigh: 305, shin: 170, neck: 340 },
    // Rounded back with the hips a little high, knees pulled to the chest.
    tuck: { arm: straightArm(0.68), torso: 172, thigh: 315, shin: 182, neck: 4, bars: true },
    // Flat back, thighs under the hips (hip ~95°, knee ~95°).
    advtuck: { arm: straightArm(0.76), torso: 180, thigh: 262, shin: 170, neck: 2, bars: true },
    // One leg long, the other tucked under.
    oneleg: { arm: straightArm(0.85), torso: 180, thigh: 181, shin: 181, far: { thigh: 262, shin: 170 }, neck: 2, bars: true },
    // Legs wide: from the side the V reads as two lines either side of the body's.
    straddle: { arm: straightArm(0.9), torso: 180, thigh: 186, shin: 186, far: { thigh: 173, shin: 173 }, neck: 2, bars: true },
    full: { arm: straightArm(0.95), torso: 180, thigh: 180.5, shin: 180.5, neck: 2, bars: true },
  }
})()

type Pt = [number, number]
const ray = (from: Pt, deg: number, len: number): Pt => [
  from[0] + len * Math.cos((deg * Math.PI) / 180),
  from[1] + len * Math.sin((deg * Math.PI) / 180),
]

interface Built {
  wrist: Pt
  elbow: Pt
  shoulder: Pt
  hip: Pt
  knee: Pt
  ankle: Pt
  farKnee?: Pt
  farAnkle?: Pt
  head: Pt
}

function build(spec: Spec): Built {
  const wrist: Pt = [0, spec.bars ? BAR_H : 0]
  const [lower, upper] = typeof spec.arm === 'number' ? [spec.arm, spec.arm] : spec.arm
  const elbow = ray(wrist, lower, SEG.forearm)
  const shoulder = ray(elbow, upper, SEG.upperArm)
  const hip = ray(shoulder, spec.torso, T)
  const knee = ray(hip, spec.thigh, SEG.thigh)
  const ankle = ray(knee, spec.shin, SEG.shin)
  const far = spec.far ? { farKnee: ray(hip, spec.far.thigh, SEG.thigh) } : {}
  const farAnkle = spec.far && far.farKnee ? ray(far.farKnee, spec.far.shin, SEG.shin) : undefined
  const head = ray(shoulder, spec.neck ?? spec.torso - 180, SEG.neck)
  return { wrist, elbow, shoulder, hip, knee, ankle, ...far, ...(farAnkle ? { farAnkle } : {}), head }
}

/** Model space (y up, floor at 0) placed in the 96×90 view, centred on its own extent. */
function place(b: Built): { map: (p: Pt) => Pt; minX: number; maxX: number } {
  const xs = [b.wrist, b.elbow, b.shoulder, b.hip, b.knee, b.ankle, b.farKnee, b.farAnkle]
    .filter((p): p is Pt => Boolean(p))
    .map((p) => p[0])
  const minX = Math.min(...xs, b.head[0] - HEAD_R, b.wrist[0])
  const maxX = Math.max(...xs, b.head[0] + HEAD_R, b.wrist[0] + 5)
  const dx = 48 - (minX + maxX) / 2
  return { map: ([x, y]) => [x + dx, GROUND_Y - 1.5 - y], minX: minX + dx, maxX: maxX + dx }
}

const path = (...pts: Pt[]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')

/** One stroke of a figure, in the 96×90 view. */
export interface FigureStroke {
  d: string
  width: number
  /** Far-side limbs are drawn faint, behind the near side. */
  far?: boolean
}

/** Everything a figure is made of, so the share card can draw the same shapes. */
export interface FigureParts {
  strokes: FigureStroke[]
  head: { cx: number; cy: number; r: number }
  ground: { x1: number; x2: number; y: number }
  /** A parallette under the hands, when the position is drawn on bars. */
  bars?: string
}

export function figureParts(step: StepId): FigureParts {
  const spec = SPECS[step]
  const b = build(spec)
  const { map, minX, maxX } = place(b)
  const [W, E, S, H, K, A, HEAD] = [b.wrist, b.elbow, b.shoulder, b.hip, b.knee, b.ankle, b.head].map(map)
  // The far arm and leg sit just behind the near ones: offset up and back.
  const back = ([x, y]: Pt): Pt => [x - 1.8, y - 1.6]
  const farLeg = b.farKnee && b.farAnkle ? [map(b.farKnee), map(b.farAnkle)] : [back(K), back(A)]
  const farHip = b.farKnee ? H : back(H)
  const floor = map([0, 0])[1]
  const strokes: FigureStroke[] = [
    { d: path(back(W), back(E), back(S)), width: 5, far: true },
    { d: path(farHip, farLeg[0], farLeg[1]), width: 6, far: true },
    { d: path(H, K), width: 7.4 },
    { d: path(K, A), width: 5.6 },
    ...(spec.feetDown ? [{ d: path(A, [A[0] - 2.5, A[1] + 0.2]), width: 3.4 }] : []),
    { d: path(S, H), width: 10 },
    { d: path(W, E), width: 5.2 },
    { d: path(E, S), width: 6.4 },
    // The hand: flat on the floor, or wrapped over the grip.
    { d: path(W, [W[0] + 4.5, W[1] + (spec.bars ? 1.2 : 0)]), width: 3.6 },
  ]
  return {
    strokes,
    head: { cx: HEAD[0], cy: HEAD[1], r: HEAD_R },
    ground: { x1: Math.max(2, minX - 4), x2: Math.min(94, maxX + 4), y: GROUND_Y },
    ...(spec.bars
      ? { bars: path([W[0] - 5, floor + 1.5], [W[0] - 2.5, W[1] + 3], [W[0] + 6.5, W[1] + 3], [W[0] + 9, floor + 1.5]) }
      : {}),
  }
}
