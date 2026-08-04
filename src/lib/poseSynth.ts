import type { Kp } from './poseBackend'
import type { JudgeInput } from './poseForm'

/**
 * Synthetic side-view poses with known ground truth.
 *
 * The form judge is a chain of estimates — a model guesses joints, geometry
 * turns them into angles, thresholds turn those into accusations. Filmed clips
 * can only ever tell you the chain's *output* looked wrong; they cannot tell
 * you the true elbow angle, so they cannot tell you which link failed.
 *
 * This builds skeletons from the answer backwards: state the real elbow bend,
 * hip height, lean and so on, lay out anatomically-proportioned joints that
 * genuinely have those values, then add the failure modes a real detector adds
 * (correlated jitter, low visibility on the far side, dropped joints, camera
 * roll). Feed that to the judge and any disagreement is the judge's, not the
 * model's.
 *
 * Test and dev-lab support only — nothing here runs in a workout.
 */

export type Vec = { x: number; y: number }

/**
 * Segment lengths as multiples of torso, measured off the landmarks the pose
 * model actually returns for a real side-on planche — not off an anatomy table.
 *
 * The distinction matters. BlazePose's "shoulder" is not the acromion and its
 * "ear" is not the ear canal, so textbook ratios are the wrong ones: real
 * frames put the forearm slightly *longer* than the upper arm, where anatomy
 * says the reverse. Thresholds tuned against a body shape the model never
 * reports would be tuned for nobody.
 */
export const PROPORTIONS = {
  upperArm: 0.59,
  forearm: 0.6,
  thigh: 0.82,
  shank: 0.81,
  /**
   * Shoulder → ear with the head in a neutral planche position. Real frames
   * give 0.35 here, 0.46 with the head up and 0.24 on a head-down push-up —
   * a spread driven by where the athlete is looking, not by shrugging.
   */
  earGap: 0.35,
  /**
   * Bilateral shoulder/hip separation in a genuine side view. A real side-on
   * planche measures 0.17 and a real three-quarter one 0.44, which is what puts
   * MAX_SIDE_VIEW_RATIO between them.
   */
  bodyWidth: 0.16,
} as const

/** A parameter that may hold steady or move across the hold. */
export type Track = number | ((progress: number) => number)

const at = (value: Track | undefined, progress: number, fallback: number): number =>
  value === undefined ? fallback : typeof value === 'function' ? value(progress) : value

export interface SynthLeg {
  /** Shoulder–hip–knee angle in degrees; 180 = in line with the torso. */
  hipAngleDeg?: Track
  /** Degrees away from a locked knee. Positive folds the heel toward the hip. */
  kneeBendDeg?: Track
  /**
   * Foreshortening of both leg segments, 0–1. A straddle spreads the legs
   * across the camera's depth axis, so a side view sees them short.
   */
  foreshorten?: Track
}

export interface SynthArm {
  /** Degrees away from a locked elbow, signed like the main parameter. */
  elbowBendDeg?: Track
}

export interface SynthParams {
  /** Torso length in pixels — everything else scales from it. */
  torso?: number
  frames?: number
  durationSec?: number

  /**
   * Degrees away from a locked elbow. Positive is flexion, which moves the
   * elbow toward the hips; negative is the hyperextension a locked-out
   * straight-arm hold really shows. This sign is the whole point: an unsigned
   * three-point angle cannot tell them apart.
   */
  elbowBendDeg?: Track
  /**
   * Out-of-plane elbow flare, degrees. With both hands planted the elbow can
   * only leave the sagittal plane by rotating about the shoulder–wrist chord,
   * and the camera sees that rotation as the elbow sliding toward the chord
   * (cos of the flare). At 90° the projection lands exactly on the chord —
   * indistinguishable from a straight arm, which is precisely the monocular
   * blind spot this knob exists to demonstrate.
   */
  armYawDeg?: Track
  /** The far-side arm, for asymmetric bends. Omitted = both arms match. */
  secondArm?: SynthArm
  /** Shoulder–hip–knee, degrees. */
  hipAngleDeg?: Track
  /** Degrees away from a locked knee. */
  kneeBendDeg?: Track
  /** Leg foreshortening, 0–1. */
  foreshorten?: Track
  /** (shoulder.y − hip.y) / torso. Positive puts the hips above the shoulders. */
  hipOffset?: Track
  /** How far the shoulders sit past the wrists, over torso. */
  leanRatio?: Track
  /** Shoulder → ear distance over torso. Small reads as shrugged. */
  shrugGap?: Track
  /** The other leg, for one-leg work. Omitted = both legs share the main shape. */
  secondLeg?: SynthLeg

  /** Which anatomical side faces the camera. */
  side?: 'left' | 'right'
  /** +1 puts the head at increasing x, −1 mirrors the setup. */
  facing?: 1 | -1
  /** Whole-frame rotation, for a phone that was not perfectly level. */
  rollDeg?: number
  /** Bilateral separation over torso; large means the shot is not side-on. */
  bodyWidth?: Track

  /** Landmark score for the camera-side joints. */
  nearScore?: Track
  /** Landmark score for the occluded far side. */
  farScore?: Track
  /** Per-joint scores that override the near/far default, e.g. a hidden wrist. */
  jointScores?: Record<string, Track>
  /** Gaussian landmark error, as a fraction of torso, per axis. */
  noise?: number
  /** AR(1) coefficient — real tracker error drifts rather than resampling. */
  noiseCorrelation?: number
  /** Chance per joint per frame of dropping below the usable score. */
  dropoutRate?: number
  seed?: number

  width?: number
  height?: number
}

/** Deterministic RNG — a flaky eval is worse than no eval. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rand: () => number): number {
  const u = Math.max(1e-9, rand())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

/** Screen space has y growing downward, so a positive angle rotates clockwise. */
function rotate(v: Vec, deg: number): Vec {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }
}

function unit(from: Vec, to: Vec): Vec {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const m = Math.hypot(dx, dy) || 1
  return { x: dx / m, y: dy / m }
}

const add = (a: Vec, b: Vec, k = 1): Vec => ({ x: a.x + b.x * k, y: a.y + b.y * k })

/** Joint positions for one moment, before any detector noise is applied. */
export interface TruePose {
  shoulder: Vec
  elbow: Vec
  wrist: Vec
  hip: Vec
  knee: Vec
  ankle: Vec
  ear: Vec
  secondKnee?: Vec
  secondAnkle?: Vec
  secondElbow?: Vec
  secondWrist?: Vec
  torso: number
  /** What the geometry actually came out as, for round-trip assertions. */
  truth: {
    elbowDeg: number
    kneeDeg: number
    hipAngleDeg: number
    hipOffset: number
    leanRatio: number
    shrugRatio: number
    secondElbowDeg?: number
  }
}

function angleAt(a: Vec, b: Vec, c: Vec): number {
  const abx = a.x - b.x
  const aby = a.y - b.y
  const cbx = c.x - b.x
  const cby = c.y - b.y
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby)
  if (mag === 0) return NaN
  return (Math.acos(Math.max(-1, Math.min(1, (abx * cbx + aby * cby) / mag))) * 180) / Math.PI
}

/**
 * Lay out one side of the body so it genuinely has the requested measurements.
 *
 * Built shoulder-first: the torso fixes the hip from the requested hip height,
 * the requested lean fixes the wrist's horizontal offset and the arm's length
 * fixes its height, and the elbow is placed on whichever side of the
 * shoulder–wrist chord the requested bend sign calls for.
 */
export function buildTruePose(params: SynthParams, progress = 0): TruePose {
  const torso = params.torso ?? 220
  const facing = params.facing ?? 1
  const bend = at(params.elbowBendDeg, progress, 0)
  const hipOffset = at(params.hipOffset, progress, 0)
  const leanRatio = at(params.leanRatio, progress, 0.4)
  const shrugGap = at(params.shrugGap, progress, PROPORTIONS.earGap)

  const upperArm = PROPORTIONS.upperArm * torso
  const forearm = PROPORTIONS.forearm * torso

  const shoulder: Vec = { x: 0, y: 0 }

  // Torso: fixed length, tilted by the requested hip height. Clamped because a
  // hip offset past one torso length is not a body, it is an input mistake.
  const rise = Math.max(-0.95, Math.min(0.95, hipOffset)) * torso
  const run = Math.sqrt(Math.max(0, torso * torso - rise * rise))
  const hip: Vec = { x: shoulder.x - run * facing, y: shoulder.y - rise }

  // Wrist: the lean puts it behind the shoulder, the arm's own span puts it
  // below. A straight arm spans upperArm + forearm; a bent one spans less.
  const elbowDeg = 180 - Math.abs(bend)
  const span = Math.sqrt(
    upperArm * upperArm +
      forearm * forearm -
      2 * upperArm * forearm * Math.cos((elbowDeg * Math.PI) / 180),
  )
  const dx = leanRatio * torso
  const drop = Math.sqrt(Math.max(torso * torso * 0.04, span * span - dx * dx))
  const wrist: Vec = { x: shoulder.x - dx * facing, y: shoulder.y + drop }

  // Elbow: circle intersection, then pushed to the hip side for flexion and
  // the far side for hyperextension.
  const chord = Math.hypot(wrist.x - shoulder.x, wrist.y - shoulder.y)
  const along = (upperArm * upperArm - forearm * forearm + chord * chord) / (2 * chord)
  const perp = Math.sqrt(Math.max(0, upperArm * upperArm - along * along))
  const u = unit(shoulder, wrist)
  const nA: Vec = { x: -u.y, y: u.x }
  const towardHip = unit(shoulder, hip)
  const sign = nA.x * towardHip.x + nA.y * towardHip.y >= 0 ? 1 : -1
  // bend > 0 flexes toward the hips; bend < 0 is the away-side hyperextension.
  const n = sign * (bend >= 0 ? 1 : -1)
  // A flare rotates the elbow about the chord; the projection keeps only
  // cos(yaw) of its off-chord displacement, reaching the chord itself at 90°.
  const flare = Math.cos((at(params.armYawDeg, progress, 0) * Math.PI) / 180)
  const elbow: Vec = {
    x: shoulder.x + u.x * along + nA.x * perp * n * flare,
    y: shoulder.y + u.y * along + nA.y * perp * n * flare,
  }

  // The far arm shares the planted wrist and therefore the chord; its own
  // bend only chooses how far its elbow sits off that chord. Placed to make
  // the three-point angle exact for this chord — the implied segment lengths
  // stay inside the judge's plausibility gates for any bend the eval uses.
  const secondArm = (() => {
    if (!params.secondArm) return undefined
    const bend2 = at(params.secondArm.elbowBendDeg, progress, 0)
    const angle2 = 180 - Math.abs(bend2)
    const mid: Vec = { x: (shoulder.x + wrist.x) / 2, y: (shoulder.y + wrist.y) / 2 }
    const off = angle2 >= 179.5 ? 0 : chord / 2 / Math.tan((angle2 * Math.PI) / 360)
    const n2 = sign * (bend2 >= 0 ? 1 : -1)
    return {
      elbow: { x: mid.x + nA.x * off * n2, y: mid.y + nA.y * off * n2 },
      wrist: { ...wrist },
    }
  })()

  const leg = (spec: SynthLeg) => {
    const hipAngle = at(spec.hipAngleDeg, progress, 180)
    const kneeBend = at(spec.kneeBendDeg, progress, 0)
    const shorten = Math.max(0.2, Math.min(1, at(spec.foreshorten, progress, 1)))
    const thigh = PROPORTIONS.thigh * torso * shorten
    const shank = PROPORTIONS.shank * torso * shorten
    // Rotating the hip→shoulder direction by the hip angle puts the knee
    // behind the hip at 180° and straight down at 90°, which is the tuck.
    const knee = add(hip, rotate(unit(hip, shoulder), hipAngle * facing), thigh)
    // A locked knee continues the thigh's direction; a bending one always
    // folds the heel toward the hip, so pick whichever of the two circle
    // solutions does that rather than hard-coding a screen direction.
    const dir = unit(hip, knee)
    const ankle =
      kneeBend <= 0.01
        ? add(knee, dir, shank)
        : [rotate(dir, kneeBend), rotate(dir, -kneeBend)]
            .map((d) => add(knee, d, shank))
            .sort(
              (a, b) => Math.hypot(a.x - hip.x, a.y - hip.y) - Math.hypot(b.x - hip.x, b.y - hip.y),
            )[0]
    return { knee, ankle }
  }

  const primary = leg({
    hipAngleDeg: params.hipAngleDeg,
    kneeBendDeg: params.kneeBendDeg,
    foreshorten: params.foreshorten,
  })
  const second = params.secondLeg ? leg(params.secondLeg) : undefined

  // Head forward and up from the shoulder — the distance is what gets graded,
  // the direction only has to look like a person.
  const ear = add(shoulder, rotate(unit(hip, shoulder), -28 * facing), shrugGap * torso)

  return {
    shoulder,
    elbow,
    wrist,
    hip,
    knee: primary.knee,
    ankle: primary.ankle,
    ear,
    secondKnee: second?.knee,
    secondAnkle: second?.ankle,
    secondElbow: secondArm?.elbow,
    secondWrist: secondArm?.wrist,
    torso,
    truth: {
      elbowDeg: angleAt(shoulder, elbow, wrist),
      kneeDeg: angleAt(hip, primary.knee, primary.ankle),
      hipAngleDeg: angleAt(shoulder, hip, primary.knee),
      hipOffset: (shoulder.y - hip.y) / torso,
      leanRatio: ((shoulder.x - wrist.x) * (Math.sign(shoulder.x - hip.x) || 1)) / torso,
      shrugRatio: Math.hypot(shoulder.x - ear.x, shoulder.y - ear.y) / torso,
      ...(secondArm ? { secondElbowDeg: angleAt(shoulder, secondArm.elbow, wrist) } : {}),
    },
  }
}

const JOINT_ORDER = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'ear'] as const
type JointName = (typeof JOINT_ORDER)[number]

/**
 * A full clip's worth of detections: the true skeleton at each moment, plus
 * both anatomical sides, landmark noise, per-side visibility and dropouts.
 */
export function synthesizeClip(params: SynthParams = {}): JudgeInput & { truth: TruePose[] } {
  const frames = params.frames ?? 24
  const duration = params.durationSec ?? 10
  const torso = params.torso ?? 220
  const width = params.width ?? 1280
  const height = params.height ?? 720
  const side = params.side ?? 'left'
  const far = side === 'left' ? 'right' : 'left'
  const noise = params.noise ?? 0.012
  const correlation = params.noiseCorrelation ?? 0.7
  const dropoutRate = params.dropoutRate ?? 0
  const rand = mulberry32(params.seed ?? 1)

  // Correlated error: one persistent offset per joint per axis, nudged each
  // frame. Independent per-frame noise is far kinder than a real tracker.
  const walk = new Map<string, Vec>()
  const step = (key: string): Vec => {
    const prev = walk.get(key) ?? { x: 0, y: 0 }
    const next = {
      x: prev.x * correlation + gaussian(rand) * noise * torso * Math.sqrt(1 - correlation ** 2),
      y: prev.y * correlation + gaussian(rand) * noise * torso * Math.sqrt(1 - correlation ** 2),
    }
    walk.set(key, next)
    return next
  }

  const centre: Vec = { x: width * 0.5, y: height * 0.45 }
  const times: number[] = []
  const tracked: { t: number; kps: Kp[] }[] = []
  const truth: TruePose[] = []

  for (let i = 0; i < frames; i++) {
    const progress = frames === 1 ? 0 : i / (frames - 1)
    const t = Math.round(duration * progress * 1000) / 1000
    times.push(t)
    const pose = buildTruePose(params, progress)
    truth.push(pose)

    const spread = at(params.bodyWidth, progress, PROPORTIONS.bodyWidth) * torso
    const kps: Kp[] = []
    const place = (name: JointName, point: Vec, which: 'near' | 'far') => {
      const key = `${which}_${name}`
      const jitter = step(key)
      // The far side sits a little deeper in the image and is guessed at more.
      const depth = which === 'far' ? spread : 0
      const rolled = rotate({ x: point.x + depth * 0.25, y: point.y + depth }, params.rollDeg ?? 0)
      const scoreTrack =
        params.jointScores?.[`${which === 'near' ? side : far}_${name}`] ??
        params.jointScores?.[name]
      const base =
        scoreTrack !== undefined
          ? at(scoreTrack, progress, 0.9)
          : which === 'near'
            ? at(params.nearScore, progress, 0.88)
            : at(params.farScore, progress, 0.45)
      const dropped = dropoutRate > 0 && rand() < dropoutRate
      kps.push({
        name: `${which === 'near' ? side : far}_${name}`,
        x: centre.x + rolled.x + jitter.x,
        y: centre.y + rolled.y + jitter.y,
        score: dropped ? 0.05 : Math.max(0, Math.min(1, base)),
      })
    }

    place('shoulder', pose.shoulder, 'near')
    place('elbow', pose.elbow, 'near')
    place('wrist', pose.wrist, 'near')
    place('hip', pose.hip, 'near')
    place('knee', pose.knee, 'near')
    place('ankle', pose.ankle, 'near')
    place('ear', pose.ear, 'near')

    place('shoulder', pose.shoulder, 'far')
    // A second arm shape only exists in asymmetric-arm scenarios; otherwise
    // the far arm is stacked on the near one exactly as a side view sees it.
    place('elbow', pose.secondElbow ?? pose.elbow, 'far')
    place('wrist', pose.secondWrist ?? pose.wrist, 'far')
    place('hip', pose.hip, 'far')
    place('ear', pose.ear, 'far')
    // A second leg shape only exists in one-leg work; otherwise the far leg is
    // stacked on the near one exactly as a side-on tracker reports it.
    place('knee', pose.secondKnee ?? pose.knee, 'far')
    place('ankle', pose.secondAnkle ?? pose.ankle, 'far')

    tracked.push({ t, kps })
  }

  const holdWindow = duration
  return {
    tracked,
    times,
    width,
    height,
    duration,
    creditedHoldSec: duration,
    from: times[0] ?? 0,
    to: times[times.length - 1] ?? duration,
    holdWindow,
    backendId: 'mediapipe',
    rotation: 0,
    truth,
  }
}

/**
 * Textbook shapes for each graded position — what a good rep of it actually
 * looks like, not what the profile thresholds happen to demand. Grading a
 * correct hold as clean is the property most worth proving, so these have to be
 * genuinely correct reps rather than ones that merely scrape past.
 *
 * The lean and hip-height figures are anchored on measurements taken from real
 * photographs through the real pose model rather than invented: a level plank
 * reads 0.13 of forward lean, a strong feet-elevated planche lean reads 0.82
 * with the hips 0.09 high, and the arm spans about 1.19 torsos in both. The
 * rest are interpolated across that range by how much lean each progression
 * physically demands. An eval built on numbers no real body produces would
 * certify thresholds that no real athlete can meet.
 */
export const IDEAL: Record<string, SynthParams> = {
  'ppp-hold': { elbowBendDeg: -2, hipAngleDeg: 178, kneeBendDeg: 1, hipOffset: 0.05, leanRatio: 0.45 },
  'planche-lean': { elbowBendDeg: -2, hipAngleDeg: 178, kneeBendDeg: 1, hipOffset: 0.09, leanRatio: 0.8 },
  'tuck-planche': { elbowBendDeg: -2, hipAngleDeg: 70, kneeBendDeg: 110, hipOffset: 0.06, leanRatio: 0.68 },
  'adv-tuck-planche': { elbowBendDeg: -2, hipAngleDeg: 95, kneeBendDeg: 95, hipOffset: 0.04, leanRatio: 0.76 },
  'one-leg-lean': { elbowBendDeg: -2, hipAngleDeg: 176, kneeBendDeg: 1, hipOffset: 0.07, leanRatio: 0.8 },
  'one-leg-planche': {
    elbowBendDeg: -2,
    hipAngleDeg: 178,
    kneeBendDeg: 1,
    hipOffset: 0.02,
    leanRatio: 0.85,
    secondLeg: { hipAngleDeg: 80, kneeBendDeg: 110 },
  },
  'straddle-planche': {
    elbowBendDeg: -2,
    hipAngleDeg: 178,
    kneeBendDeg: 1,
    hipOffset: 0.01,
    leanRatio: 0.9,
    foreshorten: 0.72,
  },
  'band-straddle-planche': {
    elbowBendDeg: -2,
    hipAngleDeg: 176,
    kneeBendDeg: 1,
    hipOffset: 0.02,
    leanRatio: 0.78,
    foreshorten: 0.75,
  },
  'full-planche': { elbowBendDeg: -2, hipAngleDeg: 179, kneeBendDeg: 1, hipOffset: 0.01, leanRatio: 0.95 },
}
