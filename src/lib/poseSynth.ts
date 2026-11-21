import type { Kp } from './poseBackend'
import type { JudgeInput, Posture } from './poseForm'

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
  /**
   * Shoulder and hip width seen from the front, as the model reports them on
   * real front-on flags: the widest bilateral span over torso read 0.46–0.87,
   * and the hips sit closer together than the shoulders.
   */
  shoulderWidth: 0.62,
  hipWidth: 0.4,
} as const

/** A parameter that may hold steady or move across the hold. */
export type Track = number | ((progress: number) => number)

/**
 * What the generator uses for every numeric knob that is not given. One
 * table, read by both the generator and the bench's sliders: the bench used
 * to show an absent knob as zero while the generator quietly used something
 * else, so the first nudge of a slider jumped the scenario.
 */
export const SYNTH_DEFAULTS = {
  elbowBendDeg: 0,
  kneeBendDeg: 0,
  hipAngleDeg: 180,
  hipOffset: 0,
  leanRatio: 0.4,
  shrugGap: PROPORTIONS.earGap,
  noise: 0.012,
  rollDeg: 0,
  bodyWidth: PROPORTIONS.bodyWidth,
  nearScore: 0.88,
  farScore: 0.45,
  dropoutRate: 0,
  foreshorten: 1,
  seed: 1,
} as const

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
   * How the body is carried (see `Posture` in lib/poseForm). `support` is the
   * original side-on hold on the hands; `hang` is the same skeleton hung under
   * a bar; `inverted` is a side-on handstand; `flag` is a front-on flag, with
   * both sides of the body laid out.
   */
  posture?: Posture
  /**
   * Hang only. A body hanging still has its weight under its hands, so where
   * the hands sit along it follows from its shape and is worked out here.
   * `false` leaves them where `leanRatio` puts them, even when no bar could
   * hold that skeleton — for showing the judge an impossible one on purpose.
   */
  balanced?: boolean
  /** Inverted: elbow–shoulder–hip, degrees. 180 = arms in line with the trunk. */
  shoulderDeg?: Track
  /** Inverted: how far the trunk leans from straight up, degrees (a wall plank's incline). */
  trunkLeanDeg?: Track
  /** Flag: degrees the body sits off level. */
  tiltDeg?: Track
  /** Flag: both knees tucked to the chest. */
  tucked?: boolean
  /** Flag: half-angle between the legs, degrees. */
  straddleDeg?: number

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
    shoulderDeg?: number
    tiltDeg?: number
  }
  /**
   * Every joint by its detector name, for postures seen from the front, where
   * the two sides of the body are not one stacked on the other.
   */
  joints?: Record<string, Vec>
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
  const posture = params.posture ?? 'support'
  if (posture === 'inverted') return buildInvertedPose(params, progress)
  if (posture === 'flag') return buildFlagPose(params, progress)
  if (posture === 'hang') {
    const hang = (leanRatio: Track | undefined) =>
      hung(buildSupportPose({ ...params, leanRatio, hipOffset: negated(params.hipOffset) }, progress))
    if (params.balanced === false) return hang(params.leanRatio)
    // The lean is not a free choice under a bar: the hands sit over the centre
    // of mass, whatever the shape. Each textbook lever names a lean close to
    // that; a shape changed from it — a pike, a sag, a dead hang — is balanced
    // again here, or the skeleton would be one nothing could hang.
    const facing = params.facing ?? 1
    let lean = at(params.leanRatio, progress, SYNTH_DEFAULTS.leanRatio)
    let pose = hang(lean)
    for (let i = 0; i < 5; i++) {
      const weight = centreOfMass(pose)
      lean = Math.max(0, Math.min(1.1, lean + ((pose.wrist.x - weight.x) * facing) / pose.torso))
      pose = hang(lean)
    }
    return pose
  }
  return buildSupportPose(params, progress)
}

/**
 * Where a skeleton's weight sits: each segment's share of body mass and how
 * far along it its centre lies (Winter's anthropometric table, rounded). Kept
 * apart from the judge's own copy on purpose — the generator must not borrow
 * the thing it tests.
 */
function centreOfMass(pose: TruePose): Vec {
  const mix = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  const mean = (a: Vec, b: Vec | undefined): Vec => (b ? mix(a, b, 0.5) : a)
  const knee = mean(pose.knee, pose.secondKnee)
  const ankle = mean(pose.ankle, pose.secondAnkle)
  const parts: [number, Vec][] = [
    [0.08, mix(pose.shoulder, pose.hip, -0.25)],
    [0.5, mix(pose.shoulder, pose.hip, 0.5)],
    [0.1, mix(pose.shoulder, pose.wrist, 0.5)],
    [0.2, mix(pose.hip, knee, 0.43)],
    [0.12, mix(knee, ankle, 0.6)],
  ]
  const mass = parts.reduce((sum, [m]) => sum + m, 0)
  return {
    x: parts.reduce((sum, [m, v]) => sum + m * v.x, 0) / mass,
    y: parts.reduce((sum, [m, v]) => sum + m * v.y, 0) / mass,
  }
}

/** A track with its sign flipped. */
function negated(track: Track | undefined): Track | undefined {
  if (track === undefined) return undefined
  return typeof track === 'function' ? (progress: number) => -track(progress) : -track
}

/**
 * A support pose hung under a bar: the same skeleton with the picture's
 * vertical flipped, so the hands are above the shoulders and the chest faces
 * up. A front lever really is a planche's mirror in this sense — straight
 * arms, a level trunk, the hands over the body's centre of mass — which is why
 * one layout serves both. `hipOffset` keeps its meaning (positive = hips above
 * the shoulders): the support pose is built with it negated, then flipped.
 */
function hung(pose: TruePose): TruePose {
  const flip = (v: Vec): Vec => ({ x: v.x, y: -v.y })
  const maybe = (v: Vec | undefined) => (v ? flip(v) : undefined)
  const shoulder = flip(pose.shoulder)
  const hip = flip(pose.hip)
  return {
    ...pose,
    shoulder,
    elbow: flip(pose.elbow),
    wrist: flip(pose.wrist),
    hip,
    knee: flip(pose.knee),
    ankle: flip(pose.ankle),
    ear: flip(pose.ear),
    secondKnee: maybe(pose.secondKnee),
    secondAnkle: maybe(pose.secondAnkle),
    secondElbow: maybe(pose.secondElbow),
    secondWrist: maybe(pose.secondWrist),
    truth: { ...pose.truth, hipOffset: (shoulder.y - hip.y) / pose.torso },
  }
}

/**
 * A side-on handstand: hands planted, the arm running up to the shoulder, the
 * trunk continuing it (or leaning off it by a closed shoulder), legs above.
 * The elbow bends toward the side the athlete faces, the shoulders close by
 * tipping the trunk the other way, and the hips fold the legs forward — so each
 * fault moves its own joint and nothing else.
 */
function buildInvertedPose(params: SynthParams, progress: number): TruePose {
  const torso = params.torso ?? 220
  const facing = params.facing ?? 1
  const bend = Math.abs(at(params.elbowBendDeg, progress, SYNTH_DEFAULTS.elbowBendDeg))
  const shoulderDeg = at(params.shoulderDeg, progress, 180)
  const lean = at(params.trunkLeanDeg, progress, 0)
  const upperArm = PROPORTIONS.upperArm * torso
  const forearm = PROPORTIONS.forearm * torso
  const up: Vec = { x: 0, y: -1 }

  const wrist: Vec = { x: 0, y: 0 }
  // The arm stays over the hand; a bend shortens it and pushes the elbow forward.
  const elbowAngle = 180 - bend
  const span = Math.sqrt(upperArm ** 2 + forearm ** 2 - 2 * upperArm * forearm * Math.cos((elbowAngle * Math.PI) / 180))
  const shoulder = add(wrist, up, span)
  const along = (forearm ** 2 - upperArm ** 2 + span ** 2) / (2 * span)
  const off = Math.sqrt(Math.max(0, forearm ** 2 - along ** 2))
  const elbow: Vec = { x: wrist.x + off * facing, y: wrist.y - along }

  // The trunk: in line with the upper arm when the shoulders are open, tipped
  // back from it as they close; `trunkLeanDeg` leans the whole body (a wall plank).
  const upperArmDir = unit(elbow, shoulder)
  const trunkDir = rotate(upperArmDir, (180 - shoulderDeg + lean) * -facing)
  const hip = add(shoulder, trunkDir, torso)

  const leg = (spec: SynthLeg) => {
    const hipAngle = at(spec.hipAngleDeg, progress, SYNTH_DEFAULTS.hipAngleDeg)
    const kneeBend = at(spec.kneeBendDeg, progress, SYNTH_DEFAULTS.kneeBendDeg)
    const thigh = PROPORTIONS.thigh * torso
    const shank = PROPORTIONS.shank * torso
    // Folding at the hips brings the legs forward of the trunk's line.
    const thighDir = rotate(trunkDir, (180 - hipAngle) * facing)
    const knee = add(hip, thighDir, thigh)
    const ankle = add(knee, rotate(thighDir, -kneeBend * facing), shank)
    return { knee, ankle }
  }
  const primary = leg({ hipAngleDeg: params.hipAngleDeg, kneeBendDeg: params.kneeBendDeg })
  const second = params.secondLeg ? leg(params.secondLeg) : undefined
  // Head between the arms, a little forward of the shoulder.
  const ear = add(shoulder, rotate(unit(shoulder, wrist), 25 * facing), PROPORTIONS.earGap * torso)

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
    torso,
    truth: {
      elbowDeg: angleAt(shoulder, elbow, wrist),
      kneeDeg: angleAt(hip, primary.knee, primary.ankle),
      hipAngleDeg: angleAt(shoulder, hip, primary.knee),
      hipOffset: (shoulder.y - hip.y) / torso,
      leanRatio: 0,
      shrugRatio: Math.hypot(shoulder.x - ear.x, shoulder.y - ear.y) / torso,
      shoulderDeg: angleAt(elbow, shoulder, hip),
    },
  }
}

/**
 * A flag seen from the front: a pole up the picture at x = 0, the body out to
 * one side of it, both sides of the body laid out. The top side of the body is
 * given the `left_` names and the bottom side `right_` — which is which does
 * not matter to anything measured.
 */
function buildFlagPose(params: SynthParams, progress: number): TruePose {
  const torso = params.torso ?? 220
  const bend = Math.abs(at(params.elbowBendDeg, progress, SYNTH_DEFAULTS.elbowBendDeg))
  const bend2 = params.secondArm ? Math.abs(at(params.secondArm.elbowBendDeg, progress, 0)) : bend
  const tilt = at(params.tiltDeg, progress, 0)
  const hipAngle = at(params.hipAngleDeg, progress, SYNTH_DEFAULTS.hipAngleDeg)
  const kneeBend = at(params.kneeBendDeg, progress, SYNTH_DEFAULTS.kneeBendDeg)
  const upperArm = PROPORTIONS.upperArm * torso
  const forearm = PROPORTIONS.forearm * torso
  const thigh = PROPORTIONS.thigh * torso
  const shank = PROPORTIONS.shank * torso

  // The body's long axis, pointing away from the pole; positive tilt hangs the feet low.
  const axis = rotate({ x: 1, y: 0 }, tilt)
  const across: Vec = { x: -axis.y, y: axis.x } // toward the bottom side
  // How far the shoulders hang from the pole. Real flags gripped it about
  // 1.6–2.3 torsos apart (hand to hand), which puts the shoulders nearly a
  // torso out with the arms reaching back to it.
  const S: Vec = { x: 0.95 * torso, y: 0 }
  const H = add(S, axis, torso)
  // `bodyWidth` narrows the body as a turn away from the camera would.
  const shoulderWidth = at(params.bodyWidth, progress, PROPORTIONS.shoulderWidth)
  const halfShoulders = (shoulderWidth * torso) / 2
  const halfHips = ((shoulderWidth * PROPORTIONS.hipWidth) / PROPORTIONS.shoulderWidth) * torso * 0.5
  const topShoulder = add(S, across, -halfShoulders)
  const bottomShoulder = add(S, across, halfShoulders)
  const topHip = add(H, across, -halfHips)
  const bottomHip = add(H, across, halfHips)

  // An arm from its shoulder to the pole: the hand sits where the arm's span
  // reaches x = 0, above the shoulder for the top arm and below for the bottom.
  const arm = (shoulder: Vec, bendDeg: number, direction: -1 | 1) => {
    const elbowAngle = 180 - bendDeg
    const span = Math.sqrt(upperArm ** 2 + forearm ** 2 - 2 * upperArm * forearm * Math.cos((elbowAngle * Math.PI) / 180))
    const rise = Math.sqrt(Math.max(0, span ** 2 - shoulder.x ** 2))
    const wrist: Vec = { x: 0, y: shoulder.y + rise * direction }
    const u = unit(shoulder, wrist)
    const along = (upperArm ** 2 - forearm ** 2 + span ** 2) / (2 * span)
    const off = Math.sqrt(Math.max(0, upperArm ** 2 - along ** 2))
    // The elbow leaves the chord on the side away from the pole.
    const n: Vec = -u.y >= 0 ? { x: -u.y, y: u.x } : { x: u.y, y: -u.x }
    const elbow: Vec = { x: shoulder.x + u.x * along + n.x * off, y: shoulder.y + u.y * along + n.y * off }
    return { elbow, wrist }
  }
  const topArm = arm(topShoulder, bend, -1)
  const bottomArm = arm(bottomShoulder, bend2, 1)

  // Legs: along the body's axis, folded at the waist by the hip angle (toward
  // the floor), spread by the straddle, tucked when asked.
  const legDir = rotate(axis, 180 - hipAngle)
  const leg = (hip: Vec, spread: number, tucked: boolean, bendDeg: number) => {
    const dir = tucked ? rotate(axis, 150) : rotate(legDir, spread)
    const knee = add(hip, dir, tucked ? thigh * 0.55 : thigh)
    const ankle = tucked ? add(knee, rotate(dir, 150), shank * 0.6) : add(knee, rotate(dir, bendDeg), shank)
    return { knee, ankle }
  }
  const straddle = params.straddleDeg ?? 0
  const topLeg = leg(topHip, -straddle, Boolean(params.tucked), kneeBend)
  const secondTucked = Boolean(params.tucked) || params.secondLeg !== undefined
  const bottomLeg = leg(bottomHip, straddle, secondTucked, kneeBend)

  const head = add(S, axis, -PROPORTIONS.earGap * torso)
  const joints: Record<string, Vec> = {
    left_shoulder: topShoulder,
    right_shoulder: bottomShoulder,
    left_elbow: topArm.elbow,
    right_elbow: bottomArm.elbow,
    left_wrist: topArm.wrist,
    right_wrist: bottomArm.wrist,
    left_hip: topHip,
    right_hip: bottomHip,
    left_knee: topLeg.knee,
    right_knee: bottomLeg.knee,
    left_ankle: topLeg.ankle,
    right_ankle: bottomLeg.ankle,
    left_ear: add(head, across, -0.08 * torso),
    right_ear: add(head, across, 0.08 * torso),
  }
  const feet: Vec = secondTucked && !params.tucked ? topLeg.ankle : { x: (topLeg.ankle.x + bottomLeg.ankle.x) / 2, y: (topLeg.ankle.y + bottomLeg.ankle.y) / 2 }
  const lineEnd = params.tucked || secondTucked ? H : feet
  return {
    shoulder: S,
    elbow: topArm.elbow,
    wrist: topArm.wrist,
    hip: H,
    knee: topLeg.knee,
    ankle: topLeg.ankle,
    ear: head,
    torso,
    joints,
    truth: {
      elbowDeg: Math.min(angleAt(topShoulder, topArm.elbow, topArm.wrist), angleAt(bottomShoulder, bottomArm.elbow, bottomArm.wrist)),
      kneeDeg: Math.min(angleAt(topHip, topLeg.knee, topLeg.ankle), secondTucked ? 180 : angleAt(bottomHip, bottomLeg.knee, bottomLeg.ankle)),
      hipAngleDeg: angleAt(S, H, feet),
      hipOffset: 0,
      leanRatio: 0,
      shrugRatio: PROPORTIONS.earGap,
      tiltDeg: (Math.atan2(Math.abs(lineEnd.y - S.y), Math.abs(lineEnd.x - S.x)) * 180) / Math.PI,
    },
  }
}

/** The original layout: a side-on hold on the hands. */
function buildSupportPose(params: SynthParams, progress = 0): TruePose {
  const torso = params.torso ?? 220
  const facing = params.facing ?? 1
  const bend = at(params.elbowBendDeg, progress, SYNTH_DEFAULTS.elbowBendDeg)
  const hipOffset = at(params.hipOffset, progress, SYNTH_DEFAULTS.hipOffset)
  const leanRatio = at(params.leanRatio, progress, SYNTH_DEFAULTS.leanRatio)
  const shrugGap = at(params.shrugGap, progress, SYNTH_DEFAULTS.shrugGap)

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
    const hipAngle = at(spec.hipAngleDeg, progress, SYNTH_DEFAULTS.hipAngleDeg)
    const kneeBend = at(spec.kneeBendDeg, progress, SYNTH_DEFAULTS.kneeBendDeg)
    const shorten = Math.max(0.2, Math.min(1, at(spec.foreshorten, progress, SYNTH_DEFAULTS.foreshorten)))
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
  // A flag spreads both ways from its pole — arms up and down it, body out
  // from it — so it is drawn smaller to keep a folded or tilted one in shot.
  const torso = params.torso ?? (params.posture === 'flag' ? 160 : 220)
  // A handstand is nearly four torsos tall: it is filmed with the phone
  // upright, and laid out here in a portrait frame so it fits.
  const portrait = params.posture === 'inverted'
  const width = params.width ?? (portrait ? 720 : 1280)
  const height = params.height ?? (portrait ? 1280 : 720)
  const side = params.side ?? 'left'
  const far = side === 'left' ? 'right' : 'left'
  const noise = params.noise ?? SYNTH_DEFAULTS.noise
  const correlation = params.noiseCorrelation ?? 0.7
  const dropoutRate = params.dropoutRate ?? SYNTH_DEFAULTS.dropoutRate
  const rand = mulberry32(params.seed ?? SYNTH_DEFAULTS.seed)

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

  const centre: Vec = portrait ? { x: width * 0.5, y: height * 0.9 } : { x: width * 0.5, y: height * 0.45 }
  const times: number[] = []
  const tracked: { t: number; kps: Kp[] }[] = []
  const truth: TruePose[] = []

  for (let i = 0; i < frames; i++) {
    const progress = frames === 1 ? 0 : i / (frames - 1)
    const t = Math.round(duration * progress * 1000) / 1000
    times.push(t)
    // Built at the size it is drawn at: the noise below is a share of it.
    const pose = buildTruePose(params.torso === undefined ? { ...params, torso } : params, progress)
    truth.push(pose)

    const spread = at(params.bodyWidth, progress, SYNTH_DEFAULTS.bodyWidth) * torso
    const kps: Kp[] = []
    const place = (name: JointName, point: Vec, which: 'near' | 'far') => {
      const key = `${which}_${name}`
      const jitter = step(key)
      // The far side sits a little deeper in the image and is guessed at more.
      const depth = which === 'far' ? spread : 0
      const rolled = rotate({ x: point.x + depth * 0.25, y: point.y + depth }, params.rollDeg ?? SYNTH_DEFAULTS.rollDeg)
      const scoreTrack =
        params.jointScores?.[`${which === 'near' ? side : far}_${name}`] ??
        params.jointScores?.[name]
      const base =
        scoreTrack !== undefined
          ? at(scoreTrack, progress, 0.9)
          : which === 'near'
            ? at(params.nearScore, progress, SYNTH_DEFAULTS.nearScore)
            : at(params.farScore, progress, SYNTH_DEFAULTS.farScore)
      const dropped = dropoutRate > 0 && rand() < dropoutRate
      kps.push({
        name: `${which === 'near' ? side : far}_${name}`,
        x: centre.x + rolled.x + jitter.x,
        y: centre.y + rolled.y + jitter.y,
        score: dropped ? 0.05 : Math.max(0, Math.min(1, base)),
      })
    }

    if (pose.joints) {
      // Seen from the front: every joint is its own point, all of them in view.
      for (const [name, point] of Object.entries(pose.joints)) {
        const jitter = step(name)
        const rolled = rotate(point, params.rollDeg ?? SYNTH_DEFAULTS.rollDeg)
        const scoreTrack = params.jointScores?.[name] ?? params.jointScores?.[name.replace(/^(left|right)_/, '')]
        const base = scoreTrack !== undefined ? at(scoreTrack, progress, 0.9) : at(params.nearScore, progress, SYNTH_DEFAULTS.nearScore)
        const dropped = dropoutRate > 0 && rand() < dropoutRate
        kps.push({
          name,
          x: centre.x - torso + rolled.x + jitter.x,
          y: centre.y + rolled.y + jitter.y,
          score: dropped ? 0.05 : Math.max(0, Math.min(1, base)),
        })
      }
      tracked.push({ t, kps })
      continue
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

  // ——— Front lever: the same skeleton, hung. `leanRatio` here is how far
  // toward the hips the hands sit — the bar hangs over the body's centre of
  // mass, further down the body as the lever lengthens.
  'tuck-front-lever': { posture: 'hang', elbowBendDeg: -2, hipAngleDeg: 70, kneeBendDeg: 110, hipOffset: -0.08, leanRatio: 0.4 },
  'adv-tuck-front-lever': { posture: 'hang', elbowBendDeg: -2, hipAngleDeg: 95, kneeBendDeg: 95, hipOffset: -0.04, leanRatio: 0.5 },
  'one-leg-front-lever': {
    posture: 'hang',
    elbowBendDeg: -2,
    hipAngleDeg: 177,
    kneeBendDeg: 1,
    hipOffset: -0.02,
    leanRatio: 0.65,
    secondLeg: { hipAngleDeg: 80, kneeBendDeg: 110 },
  },
  'straddle-front-lever': { posture: 'hang', elbowBendDeg: -2, hipAngleDeg: 177, kneeBendDeg: 1, hipOffset: -0.02, leanRatio: 0.7, foreshorten: 0.72 },
  'band-front-lever': { posture: 'hang', elbowBendDeg: -2, hipAngleDeg: 175, kneeBendDeg: 1, hipOffset: -0.03, leanRatio: 0.65, foreshorten: 0.75 },
  'front-lever': { posture: 'hang', elbowBendDeg: -2, hipAngleDeg: 178, kneeBendDeg: 1, hipOffset: -0.01, leanRatio: 0.8 },

  // ——— Handstand: a small unsigned bend is what a straight arm really reads
  // (real side-on handstands: 160–176°), and shoulders a few degrees short of
  // a straight line (164–179°).
  // An incline rather than a handstand: wider than it is tall, so it gets a wider frame.
  'wall-plank': { posture: 'inverted', elbowBendDeg: 6, shoulderDeg: 150, trunkLeanDeg: 10, hipAngleDeg: 177, kneeBendDeg: 2, width: 1280, height: 1280 },
  'wall-handstand': { posture: 'inverted', elbowBendDeg: 6, shoulderDeg: 173, hipAngleDeg: 177, kneeBendDeg: 2 },
  'wall-float': { posture: 'inverted', elbowBendDeg: 6, shoulderDeg: 174, hipAngleDeg: 177, kneeBendDeg: 2 },
  'freestanding-handstand': { posture: 'inverted', elbowBendDeg: 6, shoulderDeg: 175, hipAngleDeg: 177, kneeBendDeg: 2 },

  // ——— 90° hold: a support hold whose elbows are meant to bend. With a
  // straight body the hands sit under the centre of mass, well back from the
  // shoulders, so the forearm leans rather than standing upright.
  'bent-arm-lean-hold': { elbowBendDeg: 90, hipAngleDeg: 177, kneeBendDeg: 1, hipOffset: 0.03, leanRatio: 0.5 },
  'elbow-lever': { elbowBendDeg: 95, hipAngleDeg: 176, kneeBendDeg: 1, hipOffset: 0.0, leanRatio: 0.55 },
  'tuck-ninety-hold': { elbowBendDeg: 90, hipAngleDeg: 70, kneeBendDeg: 110, hipOffset: 0.05, leanRatio: 0.35 },
  'adv-tuck-ninety-hold': { elbowBendDeg: 90, hipAngleDeg: 95, kneeBendDeg: 95, hipOffset: 0.03, leanRatio: 0.45 },
  'straddle-ninety-hold': { elbowBendDeg: 90, hipAngleDeg: 178, kneeBendDeg: 1, hipOffset: 0.01, leanRatio: 0.6, foreshorten: 0.72 },
  'ninety-hold': { elbowBendDeg: 90, hipAngleDeg: 179, kneeBendDeg: 1, hipOffset: 0.01, leanRatio: 0.68 },

  // ——— Human flag, front-on. A clean level flag read 3–5° off level and a
  // 176° line on a real photo; arms that are straight read 164–179°.
  'tuck-flag': { posture: 'flag', elbowBendDeg: 6, tiltDeg: 4, tucked: true },
  'one-leg-flag': { posture: 'flag', elbowBendDeg: 6, tiltDeg: 4, hipAngleDeg: 175, kneeBendDeg: 2, secondLeg: { hipAngleDeg: 80 } },
  'straddle-flag': { posture: 'flag', elbowBendDeg: 6, tiltDeg: 4, hipAngleDeg: 175, kneeBendDeg: 2, straddleDeg: 22 },
  'human-flag': { posture: 'flag', elbowBendDeg: 6, tiltDeg: 3, hipAngleDeg: 176, kneeBendDeg: 2 },
}
