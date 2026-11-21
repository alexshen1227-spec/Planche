import type { FlagStepId, FrontLeverStepId, HandstandStepId, NinetyStepId, PlancheStepId, StepId } from '../types'

/**
 * Figures of each position, built from body geometry rather than drawn point
 * by point.
 *
 * Segment lengths are the ones the camera judge's synthetic skeletons use
 * (`PROPORTIONS` in lib/poseSynth, measured off real BlazePose output), and
 * each planche position's lean and hip and knee angles follow its `IDEAL`
 * there — so the figure on Home is the same shape the camera grades against.
 * The body faces right: hands planted, head toward the right, feet to the left.
 *
 * The other skills are the same body in the same convention, shaped by each
 * step's own description. The front lever, the handstand and the 90° hold are
 * side views like the planche; the flag is seen from the front, the side it is
 * filmed from. Where a shape balances on one support — hung under a bar, or
 * propped on bent arms — the arm is not chosen: it is turned until the hand
 * lines up with the centre of mass (`hung`, `propped`). That is why a front
 * lever's bar sits over the waist rather than the shoulders, and why a 90°
 * hold's forearm leans.
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
/** Ankle to toes, where a foot is drawn. */
const FOOT = 0.24 * T
const FOOT_W = 3.4
/**
 * Half the distance between the shoulder joints and between the hip joints
 * with the body seen from the front (`shoulderWidth` and `hipWidth` in the
 * same `PROPORTIONS`).
 */
const HALF_SHOULDERS = 0.31 * T
const HALF_HIPS = 0.2 * T

const GROUND_W = 2.5
const BARS_W = 2.2
/** The floor line is never shorter than this, so an upright figure does not stand on a dash. */
const GROUND_MIN = 30
/** An overhead bar, seen as the short length of it the hands hold. */
const BAR_HALF = 10
const BAR_W = 3
const WALL_W = 2.5
const POLE_W = 3
/**
 * Nothing is inked above this line of the 96×90 view: the share card draws its
 * large figure from just above it downward, and would crop anything higher.
 */
const TOP = 7

/**
 * Body size against the planche figures'. An upright body is nearly four torso
 * lengths from hands to toes and the view is 90 tall, so the shapes that stand
 * or hang full length are drawn smaller — and a level flag, pole and arms
 * included, is a little too wide at full size.
 */
const SCALE = {
  hang: 19 / 26,
  handstand: 17 / 26,
  flag: 22 / 26,
  flagUpright: 17 / 26,
}

/**
 * How thick a body drawn at `scale` is. Lengths shrink in proportion; limbs
 * and head shrink less, the way small type is cut heavier, so a figure at two
 * thirds the size still reads at 40px.
 */
const weight = (scale: number) => scale ** 0.6

type Pt = [number, number]
const ray = (from: Pt, deg: number, len: number): Pt => [
  from[0] + len * Math.cos((deg * Math.PI) / 180),
  from[1] + len * Math.sin((deg * Math.PI) / 180),
]
const along = (a: Pt, b: Pt, share: number): Pt => [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share]
const degrees = (radians: number) => (radians * 180) / Math.PI

/**
 * One side-view position as segment directions, in degrees with y pointing up:
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
   * A number is the grip height of a taller pair.
   */
  bars?: boolean | number
  /** Body size against the planche figures' (see `SCALE`). */
  scale?: number
  /** Hung by the hands from an overhead bar: the arm runs down from the grip, and no floor is in the picture. */
  hang?: boolean
  /** Ankle → toes, drawn where the foot matters: up on its toes, on a wall, pointed. */
  foot?: number
  /**
   * A wall behind the feet: where the toes are (`'toes'`), or this many torso
   * lengths behind the hands with nothing touching it.
   */
  wall?: 'toes' | number
}

/** Grip height of the parallettes, in drawing units. */
const BAR_H = 8
/**
 * A taller pair for the 90° holds. Bent arms carry the body about half a torso
 * above the hands rather than most of an arm's length, and on the low pair an
 * advanced tuck's knees would be drawn through the floor.
 */
const TALL_BAR_H = 13

interface Built {
  wrist: Pt
  elbow: Pt
  shoulder: Pt
  hip: Pt
  knee: Pt
  ankle: Pt
  farKnee?: Pt
  farAnkle?: Pt
  toe?: Pt
  head: Pt
}

/** A side-view position's joints in model space: y up, the floor (or, hung, the bar) at 0. */
function build(spec: Spec): Built {
  const s = spec.scale ?? 1
  const wrist: Pt = [0, spec.bars === true ? BAR_H : spec.bars || 0]
  const [lower, upper] = typeof spec.arm === 'number' ? [spec.arm, spec.arm] : spec.arm
  const elbow = ray(wrist, lower, SEG.forearm * s)
  const shoulder = ray(elbow, upper, SEG.upperArm * s)
  const hip = ray(shoulder, spec.torso, T * s)
  const knee = ray(hip, spec.thigh, SEG.thigh * s)
  const ankle = ray(knee, spec.shin, SEG.shin * s)
  const far = spec.far ? { farKnee: ray(hip, spec.far.thigh, SEG.thigh * s) } : {}
  const farAnkle = spec.far && far.farKnee ? ray(far.farKnee, spec.far.shin, SEG.shin * s) : undefined
  const head = ray(shoulder, spec.neck ?? spec.torso - 180, SEG.neck * s)
  const toe = spec.foot !== undefined ? ray(ankle, spec.foot, FOOT * s) : undefined
  return { wrist, elbow, shoulder, hip, knee, ankle, ...far, ...(farAnkle ? { farAnkle } : {}), ...(toe ? { toe } : {}), head }
}

/** Where a figure's wall stands, in model space: against the toes, or a set distance behind the hands. */
function wallAt(b: Built, spec: Spec): number {
  const s = spec.scale ?? 1
  return typeof spec.wall === 'number' ? b.wrist[0] - spec.wall * T * s : (b.toe ?? b.ankle)[0] - (FOOT_W * weight(s) + WALL_W) / 2
}

/**
 * Each segment's share of body mass, and how far along it — from the end
 * nearer the trunk — its own centre sits. Standard anthropometric segment
 * values (de Leva 1996, rounded): INFERENCE about a typical body, not a
 * measurement of anyone. Used only to place a hand under, or a bar over, the
 * body it carries.
 */
const MASS = { head: 0.069, trunk: 0.435, upperArm: 0.027, forearm: 0.016, hand: 0.006, thigh: 0.142, shin: 0.043, foot: 0.014 }
const MASS_AT = { trunk: 0.45, upperArm: 0.58, forearm: 0.46, thigh: 0.41, shin: 0.45 }

/** How far the body's centre of mass sits toward the head side of the hand. */
function offBalance(spec: Spec): number {
  const b = build(spec)
  const parts: [number, Pt][] = [
    [MASS.head, b.head],
    [MASS.trunk, along(b.shoulder, b.hip, MASS_AT.trunk)],
    [2 * MASS.upperArm, along(b.shoulder, b.elbow, MASS_AT.upperArm)],
    [2 * MASS.forearm, along(b.elbow, b.wrist, MASS_AT.forearm)],
    [2 * MASS.hand, b.wrist],
  ]
  for (const [knee, ankle] of [
    [b.knee, b.ankle],
    [b.farKnee ?? b.knee, b.farAnkle ?? b.ankle],
  ]) {
    parts.push([MASS.thigh, along(b.hip, knee, MASS_AT.thigh)], [MASS.shin, along(knee, ankle, MASS_AT.shin)], [MASS.foot, ankle])
  }
  let mass = 0
  let moment = 0
  for (const [share, at] of parts) {
    mass += share
    moment += share * at[0]
  }
  return moment / mass - b.wrist[0]
}

/**
 * The angle between `from` and `to` at which `f` crosses zero. When it does
 * not cross — the shape cannot balance inside that range — the end that comes
 * nearer is used, and figure.test fails on the balance it then lacks.
 */
function crossing(f: (angle: number) => number, from: number, to: number): number {
  let lo = from
  let hi = to
  let atLo = f(lo)
  const atHi = f(hi)
  if (atLo * atHi > 0) return Math.abs(atLo) < Math.abs(atHi) ? lo : hi
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    const atMid = f(mid)
    if (atMid * atLo > 0) {
      lo = mid
      atLo = atMid
    } else {
      hi = mid
    }
  }
  return (lo + hi) / 2
}

type Body = Omit<Spec, 'arm' | 'hang'>

/** A body hung by straight arms: the arm is turned until the bar is over the centre of mass. */
function hung(body: Body): Spec {
  const spec = (arm: number): Spec => ({ ...body, arm, hang: true })
  return spec(crossing((arm) => offBalance(spec(arm)), 185, 355))
}

/**
 * A body propped on arms bent to `elbowDeg`: the arm is turned as one piece
 * until the hand is under the centre of mass. For a straight body that is well
 * back toward the waist, so the forearm tips forward and the elbow rides above
 * the back — an upright forearm would leave the legs unsupported.
 */
function propped(body: Body, elbowDeg: number): Spec {
  const spec = (forearm: number): Spec => ({ ...body, arm: [forearm, forearm - (180 - elbowDeg)] })
  return spec(crossing((forearm) => offBalance(spec(forearm)), 50, 135))
}

/** Arm direction for a straight arm whose shoulder sits `lean` torso-lengths ahead of the hand. */
const straightArm = (lean: number) => 90 - (Math.asin(Math.min(0.99, (lean * T) / (SEG.forearm + SEG.upperArm))) * 180) / Math.PI
/** Body slope for a straight body from the shoulder down to feet on the floor. */
const slopeToFloor = (lean: number) => {
  const arm = SEG.forearm + SEG.upperArm
  const height = Math.sqrt(arm ** 2 - (lean * T) ** 2)
  return 180 + (Math.asin(height / (T + SEG.thigh + SEG.shin)) * 180) / Math.PI
}

const PLANCHE: Record<PlancheStepId, Spec> = (() => {
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

/**
 * The front lever: the planche's shapes turned face-up and hung. The athlete
 * faces the ceiling, so a tucked knee points up and toward the chest.
 */
const FRONT_LEVER: Record<FrontLeverStepId, Spec> = {
  // An active hang with a shallow hollow: legs a little in front of the bar, head forward of the arms.
  'fl-hang': hung({ torso: 272, thigh: 265, shin: 265, neck: 108, scale: SCALE.hang }),
  // Rounded back with the hips a little low, knees pulled to the chest.
  'fl-tuck': hung({ torso: 186, thigh: 46, shin: 192, neck: 0 }),
  // Flat back, thighs pointing at the ceiling, shins trailing level.
  'fl-advtuck': hung({ torso: 180, thigh: 98, shin: 190, neck: 0 }),
  // One leg long, the other still tucked.
  'fl-oneleg': hung({ torso: 180, thigh: 180, shin: 180, far: { thigh: 98, shin: 190 }, neck: 0 }),
  // Legs wide: two lines either side of the body's, as on the planche.
  'fl-straddle': hung({ torso: 180, thigh: 174, shin: 174, far: { thigh: 187, shin: 187 }, neck: 0 }),
  'fl-full': hung({ torso: 180, thigh: 180, shin: 180, neck: 0 }),
}

/**
 * The handstand, chest toward a wall on the feet side: one line from wrists to
 * toes, the head between the arms and tipped toward the fingers.
 */
const HANDSTAND: Record<HandstandStepId, Spec> = (() => {
  const line = (dir: number, rest: Partial<Spec>): Spec => ({
    arm: dir,
    torso: dir,
    thigh: dir,
    shin: dir,
    neck: dir + 205,
    scale: SCALE.handstand,
    ...rest,
  })
  // Chest to the wall: a few degrees off upright, toes resting on it.
  const wall = line(94.5, { foot: 160, wall: 'toes' })
  // How far behind the hands that wall stands, so the float is drawn at the same wall with the toes off it.
  const built = build(wall)
  const gap = (built.wrist[0] - wallAt(built, wall)) / (T * SCALE.handstand)
  return {
    // The wall plank: feet walked up the wall until the body is about halfway to upright.
    'hs-foundations': line(130, { foot: 205, wall: 'toes' }),
    'hs-wall': wall,
    'hs-float': line(90, { foot: 90, wall: gap }),
    'hs-free': line(90, { foot: 90 }),
  }
})()

/**
 * The 90° hold: the planche's shapes on bent arms. No source gives the forearm
 * an angle and none is assumed here — it falls out of the balance (`propped`).
 * At a true right angle the hand cannot reach as far back as a straight body's
 * centre of mass, so the flying shapes are drawn a few degrees more open, and
 * a straight body rides only a little above its hands.
 */
const NINETY: Record<NinetyStepId, Spec> = (() => {
  const elbow = 98
  const bars = TALL_BAR_H
  // The lean hold: toes down, the forearm tipped forward of upright, the elbow
  // square, and the body sloped by whatever puts the toes on the floor.
  const lean = ((): Spec => {
    const arm: [number, number] = [70, 340]
    const toesDown = 262
    const shoulderHeight = build({ arm, torso: 180, thigh: 180, shin: 180 }).shoulder[1]
    const ankleHeight = -FOOT * Math.sin((toesDown * Math.PI) / 180)
    const slope = 180 + degrees(Math.asin((shoulderHeight - ankleHeight) / (T + SEG.thigh + SEG.shin)))
    return { arm, torso: slope, thigh: slope, shin: slope, neck: slope - 180 + 4, foot: toesDown }
  })()
  return {
    'n90-lean': lean,
    // Knees high and tight to the chest, clear of the forearm that holds them up.
    'n90-tuck': propped({ torso: 174, thigh: 326, shin: 178, neck: 4, bars }, elbow),
    'n90-advtuck': propped({ torso: 180, thigh: 262, shin: 170, neck: 2, bars }, elbow),
    'n90-straddle': propped({ torso: 180, thigh: 186, shin: 186, far: { thigh: 173, shin: 173 }, neck: 2, bars }, elbow),
    'n90-full': propped({ torso: 180, thigh: 180.5, shin: 180.5, neck: 2, bars }, elbow),
  }
})()

/** One leg seen from the front: hip → knee → ankle, and how much of each segment's length the view sees. */
interface FrontLeg {
  thigh: number
  shin: number
  seen?: [number, number]
}

/**
 * One front-view position: the athlete faces the viewer, so both shoulders,
 * both hips, both arms and both legs are laid out. Directions as in `Spec`.
 */
interface FrontSpec {
  view: 'front'
  scale: number
  /** Middle of the shoulders → middle of the hips. */
  torso: number
  /**
   * Which side of that line the supporting arm's shoulder is on: 1 is a
   * quarter-turn counter-clockwise from `torso` (the underside of a level
   * flag), -1 the other side.
   */
  under: 1 | -1
  /** Supporting hand → its shoulder, a straight arm. */
  arm: number
  /** Height of the supporting hand above the floor, in torso lengths. */
  grip: number
  /** The other arm: straight to the pole above the first hand, or — a number — shoulder → hand, reaching free. */
  reach: 'pole' | number
  /** The supporting side's leg, then the other. */
  legs: [FrontLeg, FrontLeg]
  /** Middle of the shoulders → head; defaults to straight on from the torso. */
  neck?: number
}

interface FrontBuilt {
  wrist: Pt
  elbow: Pt
  shoulder: Pt
  farWrist: Pt
  farElbow: Pt
  farShoulder: Pt
  hip: Pt
  knee: Pt
  ankle: Pt
  farHip: Pt
  farKnee: Pt
  farAnkle: Pt
  /** Middle of the shoulders and of the hips. */
  chest: Pt
  pelvis: Pt
  head: Pt
}

/** A front-view position's joints in model space: y up, the floor at 0, the supporting hand at x = 0. */
function buildFront(spec: FrontSpec): FrontBuilt {
  const s = spec.scale
  const arm = (SEG.forearm + SEG.upperArm) * s
  const elbowAt = SEG.forearm / (SEG.forearm + SEG.upperArm)
  const across = spec.torso + 90 * spec.under
  const wrist: Pt = [0, spec.grip * T * s]
  const shoulder = ray(wrist, spec.arm, arm)
  const chest = ray(shoulder, across + 180, HALF_SHOULDERS * s)
  const farShoulder = ray(chest, across + 180, HALF_SHOULDERS * s)
  const pelvis = ray(chest, spec.torso, T * s)
  const hip = ray(pelvis, across, HALF_HIPS * s)
  const farHip = ray(pelvis, across + 180, HALF_HIPS * s)
  const leg = (from: Pt, { thigh, shin, seen = [1, 1] }: FrontLeg) => {
    const knee = ray(from, thigh, SEG.thigh * s * seen[0])
    return { knee, ankle: ray(knee, shin, SEG.shin * s * seen[1]) }
  }
  const near = leg(hip, spec.legs[0])
  const far = leg(farHip, spec.legs[1])
  // The other hand: on the pole — the upright the supporting hand is on — as
  // high as a straight arm reaches it, or wherever the arm points.
  const farWrist: Pt =
    spec.reach === 'pole'
      ? [wrist[0], farShoulder[1] + Math.sqrt(Math.max(0, arm ** 2 - (wrist[0] - farShoulder[0]) ** 2))]
      : ray(farShoulder, spec.reach, arm)
  return {
    wrist,
    elbow: along(wrist, shoulder, elbowAt),
    shoulder,
    farWrist,
    farElbow: along(farWrist, farShoulder, elbowAt),
    farShoulder,
    hip,
    knee: near.knee,
    ankle: near.ankle,
    farHip,
    farKnee: far.knee,
    farAnkle: far.ankle,
    chest,
    pelvis,
    head: ray(chest, spec.neck ?? spec.torso + 180, SEG.neck * s),
  }
}

/**
 * The human flag, pole on the head side. From the front the body is one line
 * out from the pole with a shoulder below it and a shoulder above, each arm
 * straight to its own grip.
 */
const FLAG: Record<FlagStepId, FrontSpec> = (() => {
  // Legs together: each runs from its own hip in toward the body's line.
  const closing = degrees(Math.atan((HALF_HIPS - 0.07 * T) / (SEG.thigh + SEG.shin)))
  const together = (axis: number, under: 1 | -1): [FrontLeg, FrontLeg] => [
    { thigh: axis - closing * under, shin: axis - closing * under },
    { thigh: axis + closing * under, shin: axis + closing * under },
  ]
  // A tucked knee comes toward the viewer and the chest, so the view sees the
  // thigh short, pointing back along the body and a little down, with the
  // shin trailing behind it — the same fold as every other tuck here.
  const tucked = (axis: number, under: 1 | -1): FrontLeg => ({ thigh: axis + 140 * under, shin: axis + 5 * under, seen: [0.6, 0.8] })
  // The supporting arm of a level flag whose shoulders hang `out` torso lengths from the pole.
  const fromPole = (out: number) => 180 - degrees(Math.acos((out * T) / (SEG.forearm + SEG.upperArm)))
  const level = (legs: [FrontLeg, FrontLeg]): FrontSpec => ({
    view: 'front',
    scale: SCALE.flag,
    torso: 180,
    under: 1,
    arm: fromPole(0.72),
    grip: 0.35,
    reach: 'pole',
    legs,
  })
  // The side plank: one straight arm under its shoulder, the other reaching
  // up, and the body sloping to the feet at whatever angle rests them on the floor.
  const plank = (slope: number): FrontSpec => ({
    view: 'front',
    scale: SCALE.flag,
    torso: 180 + slope,
    under: 1,
    arm: 90,
    grip: 0,
    reach: 90,
    legs: together(180 + slope, 1),
  })
  const shinRests = (5.6 / 2) * weight(SCALE.flag)
  const slope = crossing((trial) => buildFront(plank(trial)).ankle[1] - shinRests, 5, 60)
  return {
    'flag-foundations': plank(slope),
    // Upside down along the pole: the lower arm a strut under the shoulder
    // nearer the pole, the upper arm across to a grip beside the hips.
    'flag-vertical': {
      view: 'front',
      scale: SCALE.flagUpright,
      torso: 90,
      under: -1,
      arm: 112,
      grip: 0.35,
      reach: 'pole',
      legs: together(90, -1),
      neck: 262,
    },
    'flag-tuck': level([tucked(180, 1), tucked(180, 1)]),
    // The upper leg long, the lower one tucked.
    'flag-oneleg': level([tucked(180, 1), { thigh: 180, shin: 180 }]),
    // Legs apart: one below the body's line, one above.
    'flag-straddle': level([
      { thigh: 206, shin: 206 },
      { thigh: 154, shin: 154 },
    ]),
    'flag-full': level(together(180, 1)),
  }
})()

/** Every step's figure. A step id with no entry is a compile error here. */
const FIGURES: Record<StepId, Spec | FrontSpec> = { ...PLANCHE, ...FRONT_LEVER, ...HANDSTAND, ...NINETY, ...FLAG }

/** One stroke before it becomes a path: its points in the view, and its width. */
interface Ink {
  pts: Pt[]
  width: number
  far?: boolean
  closed?: boolean
}

/** A figure laid out in the 96×90 view, still as points. */
interface Drawn {
  strokes: Ink[]
  head: { at: Pt; r: number }
  ground: { x1: number; x2: number }
  /** Nothing in the picture stands on the floor. */
  noGround?: true
  bars?: Pt[]
  apparatus: Ink[]
  joints: FigureJoints
}

/** The floor line under ink that spans `minX`…`maxX`: a little wider than it, never a dash, and starting at a wall. */
function floorLine(minX: number, maxX: number, wall?: number): { x1: number; x2: number } {
  const ground = { x1: Math.max(2, minX - 4), x2: Math.min(94, maxX + 4) }
  if (wall !== undefined) {
    ground.x1 = wall
  } else if (ground.x2 - ground.x1 < GROUND_MIN) {
    const mid = (ground.x1 + ground.x2) / 2
    ground.x1 = mid - GROUND_MIN / 2
    ground.x2 = mid + GROUND_MIN / 2
  }
  return ground
}

function sideFigure(spec: Spec): Drawn {
  const s = spec.scale ?? 1
  const w = weight(s)
  const b = build(spec)
  const wall = spec.wall === undefined ? undefined : wallAt(b, spec)
  // Model space placed in the 96×90 view, centred on its own extent.
  const xs = [b.wrist, b.elbow, b.shoulder, b.hip, b.knee, b.ankle, b.farKnee, b.farAnkle, b.toe]
    .filter((p): p is Pt => Boolean(p))
    .map((p) => p[0])
  let minX = Math.min(...xs, b.head[0] - HEAD_R * w, b.wrist[0])
  let maxX = Math.max(...xs, b.head[0] + HEAD_R * w, b.wrist[0] + 5 * s)
  if (wall !== undefined) {
    // The wall and the floor that runs out from it are part of the picture.
    minX = Math.min(minX, wall)
    maxX = Math.max(maxX, wall + GROUND_MIN - 4)
  }
  if (spec.hang) {
    // No floor line frames a hung figure, so it is centred on what is inked: the bar and the faint far limbs too.
    minX = Math.min(minX - 4.8 * w, b.wrist[0] - BAR_HALF)
    maxX = Math.max(maxX, b.wrist[0] + BAR_HALF)
  }
  const dx = 48 - (minX + maxX) / 2
  const oy = spec.hang ? hungOrigin(b, w) : GROUND_Y - 1.5
  const map = ([x, y]: Pt): Pt => [x + dx, oy - y]
  minX += dx
  maxX += dx

  const [W, E, S, H, K, A, HEAD] = [b.wrist, b.elbow, b.shoulder, b.hip, b.knee, b.ankle, b.head].map(map)
  const TOE = b.toe ? map(b.toe) : undefined
  // The far arm and leg sit just behind the near ones: offset up and back.
  const back = ([x, y]: Pt): Pt => [x - 1.8 * w, y - 1.6 * w]
  const farKnee = b.farKnee ? map(b.farKnee) : undefined
  const farAnkle = b.farAnkle ? map(b.farAnkle) : undefined
  const farLeg = farKnee && farAnkle ? [farKnee, farAnkle] : [back(K), back(A)]
  const farHip = farKnee ? H : back(H)
  const floor = map([0, 0])[1]
  const footDown: Ink[] = spec.feetDown ? [{ pts: [A, [A[0] - 2.5, A[1] + 0.2]], width: 3.4 }] : []
  const foot: Ink[] = TOE ? [{ pts: [A, TOE], width: FOOT_W * w }] : []
  const strokes: Ink[] = [
    // Both hands hold the one overhead bar, so a hung far arm starts level with the near one.
    { pts: [spec.hang ? [W[0] - 1.8 * w, W[1]] : back(W), back(E), back(S)], width: 5 * w, far: true },
    { pts: [farHip, farLeg[0], farLeg[1]], width: 6 * w, far: true },
    { pts: [H, K], width: 7.4 * w },
    { pts: [K, A], width: 5.6 * w },
    ...footDown,
    ...foot,
    { pts: [S, H], width: 10 * w },
    { pts: [W, E], width: 5.2 * w },
    { pts: [E, S], width: 6.4 * w },
    // The hand: flat on the floor, wrapped over the grip, or closed round the overhead bar.
    spec.hang
      ? { pts: [[W[0] - 2.2 * s, W[1]], [W[0] + 2.2 * s, W[1]]], width: 3.6 * w }
      : { pts: [W, [W[0] + 4.5 * s, W[1] + (spec.bars ? 1.2 : 0)]], width: 3.6 * w },
  ]
  const apparatus: Ink[] = []
  if (spec.hang) apparatus.push({ pts: [[W[0] - BAR_HALF, W[1]], [W[0] + BAR_HALF, W[1]]], width: BAR_W })
  if (wall !== undefined) apparatus.push({ pts: [[wall + dx, TOP + WALL_W / 2], [wall + dx, GROUND_Y]], width: WALL_W })
  // A parallette in profile: the grip, and its two feet.
  const bars: Pt[] | undefined = spec.bars
    ? [[W[0] - 5, floor + 1.5], [W[0] - 2.5, W[1] + 3], [W[0] + 6.5, W[1] + 3], [W[0] + 9, floor + 1.5]]
    : undefined
  return {
    strokes,
    head: { at: HEAD, r: HEAD_R * w },
    ground: floorLine(minX, maxX, wall === undefined ? undefined : wall + dx),
    ...(spec.hang ? { noGround: true as const } : {}),
    ...(bars ? { bars } : {}),
    apparatus,
    joints: {
      head: HEAD,
      shoulder: S,
      elbow: E,
      wrist: W,
      hip: H,
      knee: K,
      ankle: A,
      ...(farKnee && farAnkle ? { farKnee, farAnkle } : {}),
      ...(TOE ? { toe: TOE } : {}),
    },
  }
}

/**
 * Where the bar — model height 0 — goes in the view. A hung figure has no
 * floor to stand on, so it sits in the middle of the view's height instead,
 * or as high as `TOP` allows when it fills it.
 */
function hungOrigin(b: Built, w: number): number {
  const reach: [Pt | undefined, number][] = [
    [b.wrist, BAR_W / 2 + 1],
    [b.shoulder, 5 * w],
    [b.hip, 5 * w],
    [b.knee, 3.7 * w],
    [b.ankle, 2.8 * w],
    [b.farKnee, 3 * w],
    [b.farAnkle, 3 * w],
    [b.head, HEAD_R * w],
  ]
  let top = -Infinity
  let bottom = Infinity
  for (const [p, r] of reach) {
    if (!p) continue
    top = Math.max(top, p[1] + r)
    bottom = Math.min(bottom, p[1] - r)
  }
  return Math.max(TOP + top, 46 + (top + bottom) / 2)
}

function frontFigure(spec: FrontSpec): Drawn {
  const s = spec.scale
  const w = weight(s)
  const b = buildFront(spec)
  const pole = spec.reach === 'pole' ? b.wrist[0] : undefined
  const joints = [b.wrist, b.elbow, b.shoulder, b.farWrist, b.farElbow, b.farShoulder, b.hip, b.knee, b.ankle, b.farHip, b.farKnee, b.farAnkle]
  const minX = Math.min(...joints.map((p) => p[0] - 2.8 * w), b.head[0] - HEAD_R * w)
  const maxX = Math.max(...joints.map((p) => p[0] + 2.8 * w), b.head[0] + HEAD_R * w, pole === undefined ? b.wrist[0] + 5 * s : pole + POLE_W / 2)
  const dx = 48 - (minX + maxX) / 2
  const map = ([x, y]: Pt): Pt => [x + dx, GROUND_Y - 1.5 - y]
  const [W, E, S, FW, FE, FS, H, K, A, FH, FK, FA, CHEST, PELVIS, HEAD] = [
    b.wrist,
    b.elbow,
    b.shoulder,
    b.farWrist,
    b.farElbow,
    b.farShoulder,
    b.hip,
    b.knee,
    b.ankle,
    b.farHip,
    b.farKnee,
    b.farAnkle,
    b.chest,
    b.pelvis,
    b.head,
  ].map(map)
  const fist = (at: Pt): Ink => ({ pts: [[at[0], at[1] - 2.2 * s], [at[0], at[1] + 2.2 * s]], width: 3.6 * w })
  // Hands: closed round the pole, or the one on the floor laid flat.
  const hands: Ink[] = pole === undefined ? [{ pts: [W, [W[0] + 4.5 * s, W[1]]], width: 3.6 * w }] : [fist(W), fist(FW)]
  const strokes: Ink[] = [
    { pts: [FH, FK], width: 7.4 * w },
    { pts: [FK, FA], width: 5.6 * w },
    { pts: [H, K], width: 7.4 * w },
    { pts: [K, A], width: 5.6 * w },
    // The trunk from the front: an outline through both shoulders and both hips, and the spine to fill it.
    { pts: [S, FS, FH, H], width: 6.4 * w, closed: true },
    { pts: [CHEST, PELVIS], width: 10 * w },
    { pts: [FW, FE], width: 5.2 * w },
    { pts: [FE, FS], width: 6.4 * w },
    { pts: [W, E], width: 5.2 * w },
    { pts: [E, S], width: 6.4 * w },
    ...hands,
  ]
  const apparatus: Ink[] = []
  if (pole !== undefined) {
    // The pole stands on the floor and runs past the upper hand — and past the feet, when the body is up along it.
    const top = Math.max(TOP + POLE_W / 2, Math.min(FW[1] - 0.35 * T * s, FA[1] - 3, A[1] - 3))
    apparatus.push({ pts: [[pole + dx, top], [pole + dx, GROUND_Y]], width: POLE_W })
  }
  return {
    strokes,
    head: { at: HEAD, r: HEAD_R * w },
    ground: floorLine(minX + dx, maxX + dx),
    apparatus,
    joints: {
      head: HEAD,
      shoulder: S,
      elbow: E,
      wrist: W,
      hip: H,
      knee: K,
      ankle: A,
      farShoulder: FS,
      farElbow: FE,
      farWrist: FW,
      farHip: FH,
      farKnee: FK,
      farAnkle: FA,
    },
  }
}

function draw(step: StepId): Drawn {
  const spec = FIGURES[step]
  return 'view' in spec ? frontFigure(spec) : sideFigure(spec)
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
  /**
   * What else the position is held on — an overhead bar, a wall, a pole —
   * drawn like the parallettes: lightly, behind the body.
   */
  apparatus?: FigureStroke[]
  /** Nothing in the picture stands on the floor — the figure hangs from a bar — so `ground` is not drawn. */
  noGround?: true
}

export function figureParts(step: StepId): FigureParts {
  const drawn = draw(step)
  const stroke = (ink: Ink): FigureStroke => ({
    d: path(...ink.pts) + (ink.closed ? ' Z' : ''),
    width: ink.width,
    ...(ink.far ? { far: true } : {}),
  })
  return {
    strokes: drawn.strokes.map(stroke),
    head: { cx: drawn.head.at[0], cy: drawn.head.at[1], r: drawn.head.r },
    ground: { ...drawn.ground, y: GROUND_Y },
    ...(drawn.bars ? { bars: path(...drawn.bars) } : {}),
    ...(drawn.apparatus.length ? { apparatus: drawn.apparatus.map(stroke) } : {}),
    ...(drawn.noGround ? { noGround: true as const } : {}),
  }
}

/**
 * Where a figure's joints are in the 96×90 view (y grows downward), so a shape
 * can be checked as geometry rather than read back out of path strings.
 *
 * In a side view these are the near side's joints, with the far leg where it
 * is drawn apart. In the flag's front view the first set is the supporting
 * side — the lower arm, its shoulder and hip, that side's leg — and `far…` is
 * the other side.
 */
export interface FigureJoints {
  head: Pt
  shoulder: Pt
  elbow: Pt
  wrist: Pt
  hip: Pt
  knee: Pt
  ankle: Pt
  farShoulder?: Pt
  farElbow?: Pt
  farWrist?: Pt
  farHip?: Pt
  farKnee?: Pt
  farAnkle?: Pt
  /** The tip of the foot, where one is drawn. */
  toe?: Pt
}

export function figureJoints(step: StepId): FigureJoints {
  return draw(step).joints
}

/** The box everything a figure draws falls inside: stroke widths, head, apparatus and (where drawn) the floor line. */
export function figureBounds(step: StepId): { x1: number; y1: number; x2: number; y2: number } {
  const drawn = draw(step)
  const box = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }
  const cover = ([x, y]: Pt, r: number) => {
    box.x1 = Math.min(box.x1, x - r)
    box.y1 = Math.min(box.y1, y - r)
    box.x2 = Math.max(box.x2, x + r)
    box.y2 = Math.max(box.y2, y + r)
  }
  for (const ink of [...drawn.strokes, ...drawn.apparatus]) for (const p of ink.pts) cover(p, ink.width / 2)
  for (const p of drawn.bars ?? []) cover(p, BARS_W / 2)
  cover(drawn.head.at, drawn.head.r)
  if (!drawn.noGround) {
    cover([drawn.ground.x1, GROUND_Y], GROUND_W / 2)
    cover([drawn.ground.x2, GROUND_Y], GROUND_W / 2)
  }
  return box
}
