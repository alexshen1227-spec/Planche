import type { FormIssue } from '../types'
import {
  apparentBodyWidthRatio,
  getBackend,
  MAX_SIDE_VIEW_RATIO,
  retireBackend,
  trackingScore,
  type BackendId,
  type Kp,
  type PoseBackend,
} from './poseBackend'

import { MIN_VERIFIED_COVERAGE } from './progression'

export { poseModelReady, warmDetector } from './poseBackend'
export { MIN_VERIFIED_COVERAGE }

/**
 * Version of the verdict rules, stored on every camera reading.
 *
 * Bumped whenever a change can alter a verdict on the *same* detections, so a
 * stored result always says which rules produced it. Readings saved before
 * this existed carry none and are treated as version 1.
 *
 * 2 - per-moment side-view gate, observed-only coverage, bounded gap filling,
 *     decode misses as missing evidence, a resolved bend is not cancelled by
 *     the other arm's hyperextension, density-aware persistence.
 * 3 - a picture on its side or upside down is turned the right way up before
 *     hip height and lean are measured (`floorEdge`); before, a phone turned
 *     sideways as the app suggests read a level hold as sagging and leaning
 *     backwards.
 * 4 - the 2026-10-10 camera audit: a sustained late softening of the elbows
 *     ends clean time where it starts (`sustainedSofteningStart`); a
 *     "hyperextension" larger than any elbow can make is read as the bend it
 *     is; joints placed outside the picture are not observations; a far arm
 *     that alone reads bent can no longer be averaged into a certified lockout;
 *     coverage counts every requested moment of the hold, not only the ones
 *     where a body was found; steadiness is measured against the planted
 *     hands, so a moving phone mostly cancels; and "Held clean" means
 *     camera-verified clean — a held arm fault reads zero, unjudged elbows
 *     read unknown.
 * 5 - positions that are not a side-on support hold (2026-11): a hung body, a
 *     handstand and a front-on flag each get their own posture, view gate and
 *     floor rule, and their own elbow and knee deadbands measured on real
 *     photographs (`POSTURE_TOLERANCE`). The planche family's verdicts are
 *     unchanged by it; the number moves because readings of the new positions
 *     did not exist before, and a stored reading says which judge made it.
 */
export const JUDGE_VERSION = 7

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
  /** Moments requested across the hold; `framesUsed` is the usable subset. */
  framesSampled?: number
  /** Which detector weights produced this reading. */
  model?: string
  /**
   * Widest gap between requested moments. A loss of position shorter than a
   * couple of these can fall between samples, so long holds disclose it.
   */
  samplingGapSec?: number
  /**
   * Overall form score, 0–100, aggregated with FIG-style deduction bands over
   * the criteria that were actually judged. Advisory and explainable — the
   * per-criterion breakdown is in `subscores`.
   */
  score?: number
  /** Per-criterion 0–100 scores behind the headline number. */
  subscores?: FormSubscore[]
  /** The single highest-priority correction, CaliPro-style: one cue, not ten. */
  fixFirst?: { issue: FormIssue; cue: string }
  /**
   * What the model saw, for drawing a skeleton over the replay. Transient —
   * never persisted; kept light by pruning to the joints the verdict used.
   */
  track?: PoseTrack
  /** Credited seconds before the first sustained, material form breakdown. */
  cleanSeconds?: number
  /** Clean seconds divided by the timer's credited hold. */
  cleanRatio?: number
  /**
   * Share of the moments requested across the credited hold in which the
   * camera saw every criterion it judged. Below `MIN_VERIFIED_COVERAGE` the
   * clean time is a training-dose estimate, not a verification.
   */
  coverage?: number
  /**
   * Seconds at the end of the credited hold the recording never reached.
   * Clean time and its ratio describe the filmed part only; this is unknown.
   */
  unfilmedSec?: number
  /** Representative sustained elbow angle, degrees (180 = locked). */
  elbowDeg?: number
  /** Shoulder→hip→knee angle: how open the hips are. */
  hipAngleDeg?: number
  /** Representative sustained knee angle. */
  kneeDeg?: number
  /** Hip height relative to shoulders, as a fraction of torso length.
   * Positive = hips above shoulders. */
  hipOffset?: number
  /** How far shoulders sit past the wrists, as a fraction of torso length. */
  leanRatio?: number
  /** Shoulder-to-ear gap over torso length; small means shrugged. */
  shrugRatio?: number
  /** Elbow–shoulder–hip angle: how open the shoulders are (a handstand's line). */
  shoulderDeg?: number
  /** Degrees the body sat off level (a flag's line out from the pole). */
  tiltDeg?: number
  /**
   * Robust spread of shoulder and hip positions measured from the planted
   * hand, over torso length (judge v4+). Describes movement, not its cause.
   */
  drift?: number
  issues: FormIssue[]
  /** Faults measured inside the clean window that can receive progression credit. */
  heldIssues?: FormIssue[]
  notes: string[]
  /** Things that went well, so the feedback is not only negative. */
  good: string[]
  /** Secondary observations — shown folded away to keep the panel readable. */
  details: string[]
  /**
   * Criteria this position cares about that the camera could not see well
   * enough to grade. The rest of the result is still valid — these are simply
   * not part of it.
   */
  unseen: string[]
  /**
   * Criteria that were judged, but only coarsely: `elbows` wherever the body
   * is not side-on on its hands (`coarseElbow`). A large bend would have been
   * named; a small one cannot be seen, so nothing here says the arms were
   * locked — no subscore, no "verified clean" wording, and the athlete's own
   * confirmation is what progression asks for.
   */
  coarse?: string[]
  /**
   * The picture was on its side (or upside down) and was turned the right way
   * up before hip height and lean were measured — see `floorEdge`. Transient,
   * for the result screen; never persisted.
   */
  frameTurned?: Exclude<FloorEdge, 'bottom'>
  /**
   * The working the verdict was built from, present only when explicitly
   * requested. A headline like "arms" is either right or wrong about a body
   * that is no longer in the room — this is the per-moment evidence trail that
   * lets a person (or an automated reviewer) check *which* frames convicted
   * it. Transient like `track`; never persisted.
   */
  explain?: JudgeExplanation
}

/** Per-moment working behind a verdict, for the bench and automated review. */
export interface JudgeExplanation {
  /** Which criteria had the coverage to be judged at all. */
  judged: JudgedCriteria
  /** Cleaned per-frame measurements the aggregates were built from. */
  frames: FrameReading[]
  /**
   * One entry per sampled moment: what the clean-window envelope saw there.
   * `bad: null` means the moment carried too little evidence to prove the
   * position was still held — which also ends verified time.
   */
  envelope: { t: number; bad: boolean | null; issues: FormIssue[] }[]
  /** Faults visible in the whole-hold aggregate reading. */
  aggregateFaults: FormIssue[]
  /** Faults that persisted long enough to be named on their own. */
  sustainedFaults: FormIssue[]
}

const MIN_KP_SCORE = 0.3
/** Fine angle/line judgements need more than the minimum "joint exists" score. */
const MIN_PRECISE_KP_SCORE = 0.42
const MIN_FAR_KP_SCORE = 0.6
const MIN_FRAMES = 3
export const MIN_VERIFIABLE_HOLD_SEC = 1
/**
 * A recording this much shorter than its credited hold is disclosed. Chosen,
 * not measured: the recorder starts with the hold and the timer rounds to a
 * tenth, so a shorter gap is start-up and rounding, not a stalled camera.
 */
export const UNFILMED_DISCLOSURE_SEC = 0.3

/** Tracked poses mapped back to source-frame pixels, for replay overlays. */
export interface PoseTrack {
  width: number
  height: number
  /** Stable visible side the verdict actually graded in side-view mode. */
  gradedSide?: 'left' | 'right'
  /**
   * Clip time the frames' `t` is measured from. Analysis of a hold timed from
   * the video starts at the marked start, and the replay must add it back.
   */
  offsetSec?: number
  frames: { t: number; kps: Kp[] }[]
}

/**
 * Pose to draw at an arbitrary replay time.
 *
 * Analysis samples are intentionally much slower than video playback. Drawing
 * the nearest sample made the skeleton pop from one frozen location to the
 * next. Interpolate only across a short, genuinely observed gap; a longer hole
 * stays blank so the overlay never pretends the detector saw what it missed.
 */
export function poseKeypointsAtTime(
  track: PoseTrack,
  time: number,
  maxSpanSec = 0.9,
): Kp[] {
  if (!track.frames.length || !Number.isFinite(time)) return []
  let afterIndex = track.frames.findIndex((frame) => frame.t >= time)
  if (afterIndex < 0) afterIndex = track.frames.length
  const before = afterIndex > 0 ? track.frames[afterIndex - 1] : undefined
  const after = afterIndex < track.frames.length ? track.frames[afterIndex] : undefined

  if (before && after) {
    const span = after.t - before.t
    if (span >= 0 && span <= maxSpanSec) {
      if (span === 0) return before.kps
      const weight = Math.max(0, Math.min(1, (time - before.t) / span))
      const afterByName = new Map(after.kps.filter((kp) => kp.name).map((kp) => [kp.name!, kp]))
      return before.kps.flatMap((point) => {
        if (!point.name) return []
        const next = afterByName.get(point.name)
        if (!next) return []
        return [{
          name: point.name,
          x: point.x + (next.x - point.x) * weight,
          y: point.y + (next.y - point.y) * weight,
          score: Math.min(point.score ?? 1, next.score ?? 1),
        }]
      })
    }
  }

  const nearest = [before, after]
    .filter((frame): frame is PoseTrack['frames'][number] => Boolean(frame))
    .sort((a, b) => Math.abs(a.t - time) - Math.abs(b.t - time))[0]
  return nearest && Math.abs(nearest.t - time) <= maxSpanSec / 2 ? nearest.kps : []
}

/**
 * Keypoints that belong in the athlete-facing replay.
 *
 * The detector still returns both anatomical sides in a side-on clip, even
 * when the hidden side is really a confident guess placed through a shirt,
 * hand or thigh. The judge deliberately grades one stable visible side; draw
 * that same evidence instead of connecting ignored landmarks into fake limbs.
 * Raw detections remain untouched in JudgeInput and problem-report exports.
 */
export function replayKeypointsAtTime(track: PoseTrack, time: number, maxSpanSec = 0.9): Kp[] {
  const points = poseKeypointsAtTime(track, time, maxSpanSec)
  if (!track.gradedSide) return points
  const prefix = `${track.gradedSide}_`
  return points.filter((point) => point.name?.startsWith(prefix))
}

export interface FormSubscore {
  key:
    | 'elbow'
    | 'angle'
    | 'knee'
    | 'hipAngle'
    | 'line'
    | 'lean'
    | 'shrug'
    | 'shoulder'
    | 'tilt'
    | 'steadiness'
    | 'cleanTime'
  label: string
  score: number
}

/**
 * What "correct" means for each position. Only the checks listed run, which
 * is what stops the analyser flagging the deliberate shapes of a progression.
 */
/**
 * How the body is carried in a position — which way up it is expected to be,
 * which view the camera needs, and how the arms can be read.
 *
 * - `support`: on the hands, body across gravity, seen from the side (the
 *   planche and the 90° hold). The original contract; absent means this.
 * - `hang`: under a bar, body across gravity, seen from the side (the front
 *   lever). Measured exactly like a support hold — the hands are simply above
 *   the shoulders, so "which way is the floor" is read the other way round.
 * - `inverted`: on the hands with the body up the picture, seen from the side
 *   (the handstand). The trunk is in line with the arms, so the hips cannot
 *   say which way an elbow bends: the elbow is a plain angle, with a wider
 *   deadband to match.
 * - `flag`: out sideways from a pole, seen from the **front**. Both sides of
 *   the body are in view, so measurements run through the midpoints of the
 *   shoulders, hips and feet, and a side-on clip is the one refused.
 */
export type Posture = 'support' | 'hang' | 'inverted' | 'flag'

export interface PoseProfile {
  label: string
  /** No geometric checks apply — say so rather than implying it looked good. */
  noChecks?: boolean
  /** How the body is carried. Absent = `support`. */
  posture?: Posture
  /** Straight-arm target (180 degrees). Undefined = do not check. */
  minElbowDeg?: number
  /**
   * Bent-arm positions: the elbow angle the position is defined by, and how
   * far either side of it still counts. Used instead of `minElbowDeg`.
   */
  elbowTargetDeg?: number
  elbowBandDeg?: number
  /** Shoulders at least this open: elbow–shoulder–hip, degrees (180 = arms in line with the body). */
  minShoulderDeg?: number
  /** The body within this many degrees of level (a flag's line out from the pole). */
  maxTiltDeg?: number
  /** Knee angle below this counts as bent. Undefined = legs are meant to bend. */
  minKneeDeg?: number
  /** Allowed |hip − shoulder| height, as a fraction of torso. */
  levelTolerance?: number
  /** Hips should be at least this open (shoulder–hip–knee degrees). */
  minHipAngleDeg?: number
  /** Shoulders should travel at least this far past the wrists. */
  minLeanRatio?: number
  /** Judge the deliberately extended leg, rather than the tucked leg. */
  oneLeg?: boolean
  checkShrug: boolean
}

export interface FrameReading {
  t: number
  elbowDeg?: number
  kneeDeg?: number
  hipAngleDeg?: number
  hipOffset?: number
  leanRatio?: number
  shrugRatio?: number
  /** Elbow–shoulder–hip: how open the shoulders are. */
  shoulderDeg?: number
  /** Degrees the body sits off level. */
  tiltDeg?: number
}

/** The posture a profile is judged in. */
export function postureOf(profile: PoseProfile): Posture {
  return profile.posture ?? 'support'
}

/**
 * Whether a posture's elbow is read as a plain three-point angle. In a side-on
 * support or hang the hips sit off the arm's line, and which side of that line
 * the elbow lies on says flexion from hyperextension. Upside down the trunk
 * continues the arm, and in a flag the arms are seen from the front: there is
 * nothing to sign the bend with.
 */
export function unsignedElbow(profile: PoseProfile): boolean {
  const posture = postureOf(profile)
  return posture === 'inverted' || posture === 'flag'
}

/**
 * Whether a posture's elbow is read coarsely: every posture but the side-on
 * support hold, which is the one pose the model reads to within a few degrees
 * (see POSTURE_TOLERANCE). A coarse elbow gets a wide deadband and none of the
 * fine machinery built on the tight one — late softening, near/far arm
 * disagreement, the borderline-spread rule.
 */
export function coarseElbow(profile: PoseProfile): boolean {
  return postureOf(profile) !== 'support'
}

/** Whether a profile has an elbow criterion at all: locked arms, or a target angle. */
function hasElbowCriterion(profile: PoseProfile): boolean {
  return profile.minElbowDeg !== undefined || profile.elbowTargetDeg !== undefined
}

export interface SideViewLegReading {
  knee?: number
  hipAngle?: number
  /** Hip-to-ankle distance divided by torso length. */
  extension?: number
  /** The knee angle rests only on observed points (hip, knee, ankle). */
  kneeObserved?: boolean
  /** The hip angle rests only on observed points (shoulder, hip, knee). */
  hipObserved?: boolean
}

/**
 * Hip-to-ankle reach, over torso, above which a side-view leg cannot be the
 * deliberately tucked one.
 *
 * Derived from the measured segment proportions rather than chosen: with the
 * model's thigh (0.82) and shank (0.81), a straight leg reaches 1.63 torsos
 * and a knee folded to 90° or tighter — any deliberate tuck — reaches at most
 * √(0.82² + 0.81²) ≈ 1.15. The margin on top covers landmark noise. An earlier
 * gate of 0.5 sat *below* every tuck the model can produce (a loose 70° tuck
 * reaches 0.93, a tight 40° one 0.56), so when the extended leg was the poorly
 * tracked far one, the tucked leg passed the gate and was confidently accused
 * of bent knees and closed hips.
 */
export const MIN_EXTENDED_LEG_REACH = 1.2

/**
 * Pick the leg the side-view camera is actually entitled to grade.
 * Normal two-leg shapes use the stable visible side. One-leg work uses the
 * longest leg whose reach proves it is the extended one, and returns nothing
 * when the detector saw only the tucked leg — reporting the criterion unseen
 * instead of accusing the tuck of a bent knee or closed hip.
 */
export function selectSideViewLeg(
  readings: SideViewLegReading[],
  oneLeg = false,
): SideViewLegReading | undefined {
  if (!oneLeg) return readings[0]
  return [...readings]
    .filter((reading) => (reading.extension ?? 0) >= MIN_EXTENDED_LEG_REACH)
    .sort((a, b) => (b.extension ?? 0) - (a.extension ?? 0))[0]
}

/**
 * Shoulder-to-ear gap, over torso length, below which the shoulders read as
 * shrugged up toward the ears.
 *
 * Named because three separate places have to agree on it — the fault test,
 * the score and the wording — and a drift between them would show an athlete a
 * green "shoulders down" badge next to a shrug deduction.
 */
export const SHRUG_MIN_RATIO = 0.32

/**
 * Pose estimates are not exact enough for a measurement sitting one pixel
 * beyond a profile threshold to become a red form fault. These deadbands are
 * shared by the clean-window and headline verdict so those two answers cannot
 * contradict one another.
 */
export const MATERIAL_TOLERANCE = {
  // Measured, not guessed. Sweeping this against synthetic holds of known
  // elbow angle puts the knee of the curve here: no false accusation at all up
  // to 2% torso landmark error, while every bend of 10° or more — the point
  // where a soft elbow becomes visible on video at all — is still caught every
  // time. Tightening it to 3° was costing a textbook locked-out hold a false
  // "bent arms" verdict on nearly half of realistic clips, and taking its
  // progression credit with it. Smaller bends still cost score; they just do
  // not get *named*, because at that size the camera cannot honestly tell a
  // bend from its own error.
  elbowDeg: 8,
  // Also swept rather than chosen. A side view of a straddle or full planche
  // sees the legs edge-on and foreshortened to little over half their length,
  // and a three-point angle built from short segments is proportionally
  // noisier — 7° was accusing a straddle of bent knees on a third of clips at
  // realistic tracking noise. At 11° that is zero, and a knee bent enough to
  // matter in a planche is 20°+ anyway.
  kneeDeg: 11,
  hipAngleDeg: 8,
  // Hip height is the one measurement here that is irreducibly camera-relative:
  // "above the shoulders" means above them with respect to gravity, and a
  // monocular side view has no horizon to recover gravity from. A phone propped
  // 8° off level reads a perfectly flat body as hips a seventh of a torso high
  // — past the full planche's whole standard on its own. This is the width of
  // that blind spot, and it is why the criterion still scores strictly while
  // only *naming* a fault once the line is clearly beyond what a tilted phone
  // could explain.
  lineRatio: 0.1,
  // Forward lean is gravity-relative for the same reason hip height is, and it
  // is corrupted by camera roll slightly harder — the shoulder-to-wrist vector
  // is longer than the torso, so a tilted phone leaks more of it into the
  // answer. Sized to absorb the few degrees a propped phone realistically sits
  // at, which is as far as it can go before the shallowest positions stop being
  // gradeable at all.
  leanRatio: 0.1,
  // The widest margin here, because the measurement is the weakest. A
  // shoulder-to-ear gap moves further with where the athlete is looking than
  // with whether the shoulders are actually shrugged: real side-on frames give
  // 0.35 for a neutral planche lean, 0.46 with the head up, and 0.24 for a
  // head-down push-up that involves no shrug at all. Only a gap below anything
  // a head position alone can explain is worth naming.
  shrugRatio: 0.1,
  // Shoulder opening in a handstand (elbow–shoulder–hip). Real side-on frames
  // of straight handstands read 164–179° through the same model, and a visibly
  // arched, closed-shoulder one read 110°: the profile floor sits under the
  // straight ones, and this is the margin a fault must clear beyond it.
  shoulderDeg: 10,
  // How far off level a flag sits is measured against the picture's horizontal,
  // so it inherits the phone's tilt exactly as hip height does. A few degrees
  // of propped-phone roll must not name a fault.
  tiltDeg: 6,
  // A bent-arm hold's elbow angle, beyond the band the profile allows.
  angleDeg: 8,
} as const

/**
 * A single sampled moment carries more elbow error than the whole-hold centre.
 * In particular, the three-point angle turns ordinary landmark jitter into a
 * short run of apparent flexion even when the true arm is exactly straight.
 * The aggregate can safely use the measured 8° deadband above; a temporal run
 * must clear this wider, independently swept bar before it can shorten clean
 * time or become a sustained fault. Other criteria keep their aggregate bars.
 */
export const MOMENTARY_MATERIAL_TOLERANCE = {
  ...MATERIAL_TOLERANCE,
  elbowDeg: 16,
} as const

/**
 * How much landmark error the elbow and knee readings carry outside a support
 * hold, measured on real photographs through the same model
 * (realPoses.fixture.ts) rather than assumed.
 *
 * The side-on support hold is the pose the model reads best: its straight arms
 * read within a few degrees of 180, which is what MATERIAL_TOLERANCE's 8° rests
 * on. Every other posture is worse, and by different amounts:
 *
 * - hang: under a bar, face up, the model sets the shoulder points on the chest
 *   rather than at the top of the arms, and splits the hips. The one clean
 *   side-on front lever available read its visibly straight arms at 154–158°
 *   and its straight legs at 166–168° in every frame rotation — a steady bias,
 *   not jitter. One photograph is thin evidence, which is why these two sit
 *   well clear of it rather than just under.
 * - inverted: visibly straight arms read 160–176° in side-on handstands, and a
 *   silhouette whose arms could not be made out read 155°. (A plain angle also
 *   half-wave-rectifies landmark error: noise either side of straight reads as
 *   a bend.)
 * - flag: seen from the front, straight arms read 160–179° across twelve
 *   flags; a visibly bent top arm read 148–152°, arms folded at the pole
 *   under 50°. Straight legs read 168–179°, and because the verdict takes the
 *   more bent of the two legs, measured tracker jitter pulled the lowest of
 *   those down to 162°.
 *
 * So a bend is only *named* once it is past anything a straight arm produced
 * in that posture. A smaller one is not the camera's to call from there — the
 * verdict says so, and the athlete's own check of the replay covers it.
 */
export const POSTURE_TOLERANCE: Record<
  Exclude<Posture, 'support'>,
  { elbowDeg: number; momentaryElbowDeg: number; kneeDeg: number }
> = {
  hang: { elbowDeg: 36, momentaryElbowDeg: 44, kneeDeg: 18 },
  inverted: { elbowDeg: 30, momentaryElbowDeg: 38, kneeDeg: MATERIAL_TOLERANCE.kneeDeg },
  flag: { elbowDeg: 24, momentaryElbowDeg: 32, kneeDeg: 15 },
}

/** The elbow deadband for a profile: the support hold's tight one, or its posture's measured one. */
export function elbowSlack(
  profile: PoseProfile,
  tolerance: typeof MATERIAL_TOLERANCE | typeof MOMENTARY_MATERIAL_TOLERANCE = MATERIAL_TOLERANCE,
): number {
  const posture = postureOf(profile)
  if (posture === 'support') return tolerance.elbowDeg
  const slack = POSTURE_TOLERANCE[posture]
  return tolerance === MOMENTARY_MATERIAL_TOLERANCE ? slack.momentaryElbowDeg : slack.elbowDeg
}

/** The knee deadband for a profile's posture. */
export function kneeSlack(profile: PoseProfile): number {
  const posture = postureOf(profile)
  return posture === 'support' ? MATERIAL_TOLERANCE.kneeDeg : POSTURE_TOLERANCE[posture].kneeDeg
}

/**
 * Above this bilateral span a handstand is not side-on. Lower than the general
 * side-view bar because arms overhead draw the shoulders together: a handstand
 * filmed from behind read 0.36 — inside the planche's 0.42 — while true side-on
 * ones read 0.06–0.25.
 */
export const MAX_INVERTED_SIDE_VIEW_RATIO = 0.3

/**
 * Below this bilateral span a flag is not front-on. Real front-on flags read
 * 0.46–0.70 through the model (one read 0.38 in one frame rotation), and a
 * side-on body under 0.25.
 */
export const MIN_FRONT_VIEW_RATIO = 0.33

/**
 * Above this span the body is pointing toward or away from the camera: the
 * trunk is foreshortened while the shoulders, stacked along the pole, are not.
 * Twelve flags filmed square-on read 0.46–0.70; the two filmed at an angle
 * both read 0.86, and their legs — pointing at the lens — read as bent.
 */
export const MAX_FRONT_VIEW_RATIO = 0.8

/**
 * How far from the picture's vertical (or its horizontal) the line between the
 * two hands may sit and still say which way up a flag clip is. On real flags
 * the hands sat 0–22° off vertical — a leaning tree, a ladder's rungs — and in
 * a photograph stored on its side 6° off horizontal. People who were not
 * holding a pole at all read 33–52°: between the two, the clip does not say.
 */
export const FLAG_GRIP_SLACK_DEG = 30

/** Past this robust spread, a borderline elbow aggregate is detector drift. */
export const MAX_STABLE_ELBOW_IQR_DEG = 7

/**
 * A sustained late softening of the elbows.
 *
 * Two existing rules both missed it: the whole-hold median describes the
 * typical shape, so seven straight seconds outvote three bent ones; and the
 * momentary envelope needs 16° in single samples, because one sample carries
 * a lot of landmark error. A 15° bend for the last three seconds of a ten-second
 * tuck passed with "Straight arms 100" and full clean time.
 *
 * Pooling the readings in a short window removes most of that per-sample
 * error, so a window's median can be held to a tighter bar than one sample.
 * Swept on synthetic tuck, advanced tuck and full planche holds of known angle
 * (300 seeds per cell, 24 and 31 samples over 10 s, AR(1) landmark noise):
 * with a 1.5 s window, a bar 5° past the aggregate deadband (a 13° bend), a
 * 1 s persistence, and arms that read locked before it, exactly straight arms
 * were never flagged at 2% torso noise — the top of the measured range of real
 * jitter — in 1,800 holds, and about 1% of the time at 2.5%. A late 15° bend
 * over the final 3 s was caught 76–83% of the time (the old rules: 37–40%), a
 * late 20° bend 96%, a 15° bend mid-hold 72%, a gradual 0→15° fade 33%.
 * Without the "locked before" rule a constant 10° bend drifting with the noise
 * could pass for straight-then-soft and keep its early seconds; with it, 1 in
 * 300 at 2% noise and none at 1%. Detection lands ~0.4 s after the true start,
 * so the clean seconds before it are kept rather than discarded.
 */
export const SOFTENING_WINDOW_SEC = 1.5
export const SOFTENING_MARGIN_DEG = 5
export const SOFTENING_PERSIST_SEC = 1
/**
 * A softening must follow this much holding. A bend from the very start is the
 * held shape, which the whole-hold reading already judges — treating it as a
 * breakdown at 0.7 s would wipe out the hold's training dose (invariant 9).
 */
export const SOFTENING_MIN_LEAD_SEC = 1.5

/**
 * Past this, a "hyperextension" is not something an elbow can do: the sign of
 * the reading is wrong, not the joint. Elbows extend a few degrees past
 * straight and a hypermobile one perhaps 15–20°; the hip-direction sign rule
 * breaks down during a collapse (an athlete lowering out of a planche read as
 * 125° of hyperextension and the elbows went unjudged). A reading beyond this
 * is counted as the bend its magnitude says it is. Set well clear of any real
 * hyperextension plus landmark error; medium sign confusions still widen the
 * angle spread enough for the uncertainty gate to leave the elbows unjudged.
 */
export const MAX_PLAUSIBLE_HYPEREXTENSION_DEG = 45

/** Drift at or below this is landmark noise on a still hold (measured ~0.02). */
export const DRIFT_STILL = 0.025
/** Above this the body moved a fair amount against the hands (synthetic sway: 0.043). */
export const DRIFT_MOVED = 0.05
/** Where the steadiness score bottoms out (a real lowering read 0.104). */
export const DRIFT_FLOOR = 0.1

/**
 * Robust spread of hand-relative shoulder and hip positions, in torso lengths:
 * the median absolute deviation of each, combined. Needs five moments with the
 * hand seen; otherwise there is no fixed reference and nothing is reported.
 */
export function robustPositionSpread(
  points: { sx: number; sy: number; hx: number; hy: number; torso: number }[],
): number | undefined {
  if (points.length < 5) return undefined
  const torso = median(points.map((p) => p.torso))
  if (torso === undefined || torso < 1) return undefined
  const mad = (xs: number[]) => {
    const m = median(xs)!
    return median(xs.map((x) => Math.abs(x - m)))!
  }
  const shoulder = Math.hypot(mad(points.map((p) => p.sx)), mad(points.map((p) => p.sy)))
  const hip = Math.hypot(mad(points.map((p) => p.hx)), mad(points.map((p) => p.hy)))
  return (shoulder + hip) / 2 / torso
}

/**
 * Two resolved arms that disagree by this much are not two noisy looks at one
 * lockout. When only the far arm reads bent and averaging would pass the hold,
 * the camera cannot certify straight arms — but nor can it convict on the arm
 * it sees least well — so elbows go unjudged (and earn no credit).
 */
export const ARM_DISAGREEMENT_DEG = 15


/**
 * Earliest start of a sustained elbow softening inside the credited hold, or
 * null. Exported so the swept parameters stay pinned by tests.
 */
export function sustainedSofteningStart(
  frames: FrameReading[],
  minElbowDeg: number,
  creditedSec: number,
): number | null {
  const bar = minElbowDeg - MATERIAL_TOLERANCE.elbowDeg - SOFTENING_MARGIN_DEG
  const seen = frames
    .filter((frame) => frame.elbowDeg !== undefined && frame.t <= creditedSec + 0.05)
    .sort((a, b) => a.t - b.t)
  let runStart: number | null = null
  for (const frame of seen) {
    const window = seen.filter((other) => Math.abs(other.t - frame.t) <= SOFTENING_WINDOW_SEC / 2)
    const soft = window.length >= 3 && (median(window.map((other) => other.elbowDeg!)) ?? 180) < bar
    if (!soft) {
      runStart = null
      continue
    }
    if (runStart === null) runStart = frame.t
    // A run that began before the lead time is the shape being entered or
    // held, not a breakdown; keep scanning past it for a later one. And a
    // softening has to soften *from* a lockout: the arms before it must read
    // locked by the judge's own definition (inside half the deadband), or this
    // is a constant bend wandering with the noise — which the whole-hold
    // reading judges, and which must not keep its early seconds as "clean".
    if (frame.t - runStart >= SOFTENING_PERSIST_SEC && runStart >= SOFTENING_MIN_LEAD_SEC) {
      const before = seen.filter((other) => other.t < runStart!).map((other) => other.elbowDeg!)
      const lockedBefore =
        before.length >= 3 && (median(before) ?? 0) >= minElbowDeg - MATERIAL_TOLERANCE.elbowDeg / 2
      if (lockedBefore) return runStart
    }
  }
  return null
}

export const POSE_PROFILES: Record<string, PoseProfile> = {
  'ppp-hold': {
    // The lean floor here is the one that separates this from an ordinary
    // plank, which is the whole exercise. Measured on real side-on frames: a
    // plank with the shoulders stacked over the hands reads 0.12, and a strong
    // planche lean reads 0.82. At the old 0.15 a plain plank passed as a
    // pseudo planche plank — the athlete could do the easier movement forever
    // and never be told. This sits clear of a plank and well under anything a
    // genuine attempt produces.
    label: 'Pseudo planche plank',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.45,
    minHipAngleDeg: 170,
    minLeanRatio: 0.28,
    checkShrug: true,
  },
  'planche-lean': {
    // Same measurement, one step further along: leaning is the entire point of
    // the movement, so its floor has to be a real lean rather than a plank with
    // ambitions. Still forgiving — the filmed reference athlete sat at 0.82.
    label: 'Planche lean',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.4,
    minHipAngleDeg: 170,
    minLeanRatio: 0.4,
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
    minElbowDeg: 180,
    levelTolerance: 0.22,
    minLeanRatio: 0.25,
    checkShrug: true,
  },
  'adv-tuck-planche': {
    label: 'Advanced tuck planche',
    minElbowDeg: 180,
    levelTolerance: 0.16,
    minHipAngleDeg: 82,
    minLeanRatio: 0.32,
    checkShrug: true,
  },
  'one-leg-lean': {
    label: 'One-leg planche lean',
    minElbowDeg: 180,
    levelTolerance: 0.4,
    minHipAngleDeg: 165,
    minLeanRatio: 0.3,
    checkShrug: true,
  },
  'one-leg-planche': {
    label: 'One-leg extension',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.14,
    minHipAngleDeg: 175,
    minLeanRatio: 0.36,
    oneLeg: true,
    checkShrug: true,
  },
  'straddle-planche': {
    label: 'Straddle planche',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.12,
    minHipAngleDeg: 175,
    minLeanRatio: 0.4,
    checkShrug: true,
  },
  'band-straddle-planche': {
    label: 'Band-assisted straddle',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.14,
    minHipAngleDeg: 172,
    minLeanRatio: 0.32,
    checkShrug: true,
  },
  'full-planche': {
    label: 'Full planche',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.1,
    minHipAngleDeg: 178,
    minLeanRatio: 0.45,
    checkShrug: true,
  },

  // ————— Front lever —————
  // Hung, seen from the side: straight arms, hips level with the shoulders,
  // hips open and legs straight where the shape asks for them. There is no
  // lean to grade and the shoulder blades cannot be seen. The model reads a
  // hung, face-up body less well than a support hold (POSTURE_TOLERANCE): a
  // real level lever on rings, feet a touch high, read 165° at the hip and
  // 0.06 of a torso off level, so the hip floors sit a little under the
  // planche's shape for shape.
  'active-hang': {
    // A plain hang has no shape the camera can be wrong about in a useful way.
    label: 'Active hang',
    noChecks: true,
    checkShrug: false,
  },
  'tuck-front-lever': {
    label: 'Tuck front lever',
    posture: 'hang',
    minElbowDeg: 180,
    levelTolerance: 0.3,
    checkShrug: false,
  },
  'adv-tuck-front-lever': {
    label: 'Advanced tuck front lever',
    posture: 'hang',
    minElbowDeg: 180,
    levelTolerance: 0.2,
    minHipAngleDeg: 82,
    checkShrug: false,
  },
  'one-leg-front-lever': {
    label: 'One-leg front lever',
    posture: 'hang',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.16,
    minHipAngleDeg: 168,
    oneLeg: true,
    checkShrug: false,
  },
  'straddle-front-lever': {
    label: 'Straddle front lever',
    posture: 'hang',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.14,
    minHipAngleDeg: 168,
    checkShrug: false,
  },
  'band-front-lever': {
    label: 'Band-assisted front lever',
    posture: 'hang',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.16,
    minHipAngleDeg: 166,
    checkShrug: false,
  },
  'front-lever': {
    label: 'Front lever',
    posture: 'hang',
    minElbowDeg: 180,
    minKneeDeg: 180,
    levelTolerance: 0.12,
    minHipAngleDeg: 170,
    checkShrug: false,
  },

  // ————— Handstand —————
  // Upside down, seen from the side: locked arms, shoulders open so the arms
  // continue the trunk, hips in line, straight legs. Real side-on handstands
  // read 164–179° at the shoulder and 174–178° at the hip through the model;
  // an arched, closed-shoulder one read 110° and 140°. Head position is not
  // graded — coaches and the small studies on it disagree.
  'wall-plank': {
    // An incline, not a handstand: where the hands sit decides the shoulder
    // angle, so only the arms and the line are graded.
    label: 'Wall plank',
    posture: 'inverted',
    minElbowDeg: 180,
    minKneeDeg: 172,
    minHipAngleDeg: 165,
    checkShrug: false,
  },
  'wall-handstand': {
    label: 'Wall handstand',
    posture: 'inverted',
    minElbowDeg: 180,
    minKneeDeg: 172,
    minHipAngleDeg: 165,
    minShoulderDeg: 160,
    checkShrug: false,
  },
  'wall-float': {
    label: 'Wall float',
    posture: 'inverted',
    minElbowDeg: 180,
    minKneeDeg: 172,
    minHipAngleDeg: 165,
    minShoulderDeg: 160,
    checkShrug: false,
  },
  'freestanding-handstand': {
    label: 'Freestanding handstand',
    posture: 'inverted',
    minElbowDeg: 180,
    minKneeDeg: 172,
    minHipAngleDeg: 165,
    minShoulderDeg: 160,
    checkShrug: false,
  },

  // ————— 90° hold —————
  // A support hold whose elbows are *meant* to bend: the criterion is an angle
  // near a right angle, either side of it, rather than a lock. Nothing here
  // asks for an upright forearm — no source states one, and with a straight
  // body the hand sits under the centre of mass, behind the elbow.
  'bent-arm-lean-hold': {
    label: 'Bent-arm lean hold',
    elbowTargetDeg: 90,
    elbowBandDeg: 20,
    minKneeDeg: 180,
    levelTolerance: 0.35,
    minHipAngleDeg: 168,
    minLeanRatio: 0.25,
    checkShrug: false,
  },
  'elbow-lever': {
    label: 'Elbow lever',
    elbowTargetDeg: 90,
    elbowBandDeg: 25,
    minKneeDeg: 180,
    levelTolerance: 0.22,
    minHipAngleDeg: 165,
    checkShrug: false,
  },
  'tuck-ninety-hold': {
    label: 'Tuck 90° hold',
    elbowTargetDeg: 90,
    elbowBandDeg: 20,
    levelTolerance: 0.25,
    checkShrug: false,
  },
  'adv-tuck-ninety-hold': {
    label: 'Advanced tuck 90° hold',
    elbowTargetDeg: 90,
    elbowBandDeg: 20,
    levelTolerance: 0.18,
    minHipAngleDeg: 82,
    checkShrug: false,
  },
  'straddle-ninety-hold': {
    label: 'Straddle 90° hold',
    elbowTargetDeg: 90,
    elbowBandDeg: 20,
    minKneeDeg: 180,
    levelTolerance: 0.15,
    minHipAngleDeg: 172,
    checkShrug: false,
  },
  'ninety-hold': {
    label: '90° hold',
    elbowTargetDeg: 90,
    elbowBandDeg: 20,
    minKneeDeg: 180,
    levelTolerance: 0.12,
    minHipAngleDeg: 175,
    checkShrug: false,
  },

  // ————— Human flag —————
  // Seen from the front: how level the body is, whether it folds at the waist,
  // both arms, and the legs. A clean level flag read 3–5° off level with a 176°
  // line on a real photo, competent ones 12–15° and 164–168°, a deliberately
  // angled one 37°. The least-proven of the checks: the athlete's own replay
  // review counts alongside it.
  'supported-flag': {
    label: 'Supported flag hold',
    noChecks: true,
    checkShrug: false,
  },
  'vertical-flag': {
    label: 'Vertical flag',
    noChecks: true,
    checkShrug: false,
  },
  'tuck-flag': {
    label: 'Tuck flag',
    posture: 'flag',
    minElbowDeg: 180,
    maxTiltDeg: 14,
    checkShrug: false,
  },
  'one-leg-flag': {
    label: 'One-leg flag',
    posture: 'flag',
    minElbowDeg: 180,
    minKneeDeg: 175,
    minHipAngleDeg: 162,
    maxTiltDeg: 14,
    oneLeg: true,
    checkShrug: false,
  },
  'straddle-flag': {
    label: 'Straddle flag',
    posture: 'flag',
    minElbowDeg: 180,
    minKneeDeg: 175,
    minHipAngleDeg: 162,
    maxTiltDeg: 12,
    checkShrug: false,
  },
  'human-flag': {
    label: 'Human flag',
    posture: 'flag',
    minElbowDeg: 180,
    minKneeDeg: 175,
    minHipAngleDeg: 164,
    maxTiltDeg: 10,
    checkShrug: false,
  },
}

/** Which of a position's criteria the camera saw well enough to grade. */
export interface JudgedCriteria {
  elbow: boolean
  knee: boolean
  hipAngle: boolean
  line: boolean
  lean: boolean
  shrug: boolean
  /** Absent on records from before the handstand and flag criteria existed. */
  shoulder?: boolean
  tilt?: boolean
}

/** How many frames carried each measurement. */
export interface CoverageCounts {
  elbows: number
  knees: number
  hipAngles: number
  hipOffsets: number
  leans: number
  shrugs: number
  /** Absent on callers that predate the handstand and flag criteria. */
  shoulders?: number
  tilts?: number
}

/**
 * Decide which of a position's criteria this clip can actually grade.
 *
 * A criterion needs a measurement in a majority of tracked frames. Falling
 * short costs that criterion its verdict and nothing else — the point of
 * grading partially is that one limb wandering out of shot should not throw
 * away everything the camera did see. Exported so the rule stays tested.
 */
export function gradeCoverage(
  profile: PoseProfile,
  counts: CoverageCounts,
  framesUsed: number,
): { judged: JudgedCriteria; unseen: string[] } {
  const need = Math.max(MIN_FRAMES, Math.ceil(framesUsed * 0.55))
  const applies = (threshold: number | undefined, seen: number) => threshold !== undefined && seen >= need
  const judged: JudgedCriteria = {
    elbow: applies(profile.minElbowDeg ?? profile.elbowTargetDeg, counts.elbows),
    knee: applies(profile.minKneeDeg, counts.knees),
    hipAngle: applies(profile.minHipAngleDeg, counts.hipAngles),
    line: applies(profile.levelTolerance, counts.hipOffsets),
    lean: applies(profile.minLeanRatio, counts.leans),
    // Same bar as every other criterion. An ear glimpsed in a handful of
    // frames used to be enough for a confident shrug accusation while the
    // identical elbow evidence was correctly refused.
    shrug: profile.checkShrug && counts.shrugs >= need,
    shoulder: applies(profile.minShoulderDeg, counts.shoulders ?? 0),
    tilt: applies(profile.maxTiltDeg, counts.tilts ?? 0),
  }
  const unseen: string[] = []
  if (hasElbowCriterion(profile) && !judged.elbow) unseen.push('elbows')
  if (profile.minKneeDeg !== undefined && !judged.knee) unseen.push('knees')
  if (profile.minHipAngleDeg !== undefined && !judged.hipAngle) unseen.push('hips')
  if (profile.levelTolerance !== undefined && !judged.line) unseen.push('body line')
  if (profile.minLeanRatio !== undefined && !judged.lean) unseen.push('forward lean')
  if (profile.checkShrug && !judged.shrug) unseen.push('shoulder-to-ear line')
  if (profile.minShoulderDeg !== undefined && !judged.shoulder) unseen.push('shoulder opening')
  if (profile.maxTiltDeg !== undefined && !judged.tilt) unseen.push('level line')
  return { judged, unseen }
}

/**
 * A small tolerance outside the headline thresholds keeps one near-boundary
 * estimate from stealing time. These are deliberately still narrow enough to
 * catch a material loss of the position.
 *
 * `judged` scopes this to the criteria the clip could actually see. A criterion
 * that was never visible is not evidence of anything and is left out entirely;
 * one that is normally visible but missing from *this* frame still makes the
 * frame unjudgeable, so a limb leaving the shot cannot buy clean seconds.
 */
export function materialIssuesForReading(
  frame: FrameReading,
  profile: PoseProfile,
  judged: JudgedCriteria,
  tolerance: typeof MATERIAL_TOLERANCE | typeof MOMENTARY_MATERIAL_TOLERANCE = MATERIAL_TOLERANCE,
): FormIssue[] {
  const issues: FormIssue[] = []
  if (
    judged.elbow &&
    profile.minElbowDeg !== undefined &&
    frame.elbowDeg !== undefined &&
    frame.elbowDeg < profile.minElbowDeg - elbowSlack(profile, tolerance)
  ) {
    issues.push('arms')
  }
  if (
    judged.elbow &&
    profile.elbowTargetDeg !== undefined &&
    frame.elbowDeg !== undefined &&
    Math.abs(frame.elbowDeg - profile.elbowTargetDeg) > (profile.elbowBandDeg ?? 0) + tolerance.angleDeg
  ) {
    issues.push('angle')
  }
  if (
    judged.shoulder &&
    profile.minShoulderDeg !== undefined &&
    frame.shoulderDeg !== undefined &&
    frame.shoulderDeg < profile.minShoulderDeg - tolerance.shoulderDeg
  ) {
    issues.push('shoulders')
  }
  if (
    judged.tilt &&
    profile.maxTiltDeg !== undefined &&
    frame.tiltDeg !== undefined &&
    frame.tiltDeg > profile.maxTiltDeg + tolerance.tiltDeg
  ) {
    issues.push('tilt')
  }
  if (
    judged.knee &&
    profile.minKneeDeg !== undefined &&
    frame.kneeDeg !== undefined &&
    frame.kneeDeg < profile.minKneeDeg - kneeSlack(profile)
  ) {
    issues.push('knees')
  }
  if (
    judged.hipAngle &&
    profile.minHipAngleDeg !== undefined &&
    frame.hipAngleDeg !== undefined &&
    frame.hipAngleDeg < profile.minHipAngleDeg - tolerance.hipAngleDeg
  ) {
    issues.push('closed')
  }
  if (judged.line && profile.levelTolerance !== undefined && frame.hipOffset !== undefined) {
    if (frame.hipOffset > profile.levelTolerance + tolerance.lineRatio) issues.push('pike')
    if (frame.hipOffset < -profile.levelTolerance - tolerance.lineRatio) issues.push('sag')
  }
  if (
    judged.lean &&
    profile.minLeanRatio !== undefined &&
    frame.leanRatio !== undefined &&
    frame.leanRatio < profile.minLeanRatio - tolerance.leanRatio
  ) {
    issues.push('lean')
  }
  if (
    judged.shrug &&
    profile.checkShrug &&
    frame.shrugRatio !== undefined &&
    frame.shrugRatio < SHRUG_MIN_RATIO - tolerance.shrugRatio
  ) {
    issues.push('shrug')
  }
  return issues
}

/**
 * Name faults that really persisted, even when they began late in the hold.
 *
 * The clean-window code deliberately grades the shape before a breakdown, but
 * that used to erase the cause from the final issue list: a locked arm that
 * softened for the final two seconds shortened clean time while still being
 * reported as "no measured issue". This mirrors the same sample-count and
 * elapsed-time gate used for clean time, per issue, so one noisy frame still
 * cannot accuse the athlete of a fault.
 */
export function sustainedMaterialIssues(
  samples: { t: number; issues: FormIssue[] }[],
  minimumBadSamples = 3,
  minimumBadDurationSec = 0.75,
): FormIssue[] {
  const sorted = [...samples].sort((a, b) => a.t - b.t)
  const candidates = [...new Set(sorted.flatMap((sample) => sample.issues))]
  return candidates.filter((issue) => {
    let run = 0
    let startedAt = 0
    for (const sample of sorted) {
      if (!sample.issues.includes(issue)) {
        run = 0
        continue
      }
      if (run === 0) startedAt = sample.t
      run += 1
      if (
        run >= Math.max(1, minimumBadSamples) &&
        sample.t - startedAt >= Math.max(0, minimumBadDurationSec)
      ) {
        return true
      }
    }
    return false
  })
}

function materiallyOutsideEnvelope(
  frame: FrameReading,
  profile: PoseProfile,
  judged: JudgedCriteria,
): boolean | null {
  const required: (number | undefined)[] = []
  if (hasElbowCriterion(profile) && judged.elbow) required.push(frame.elbowDeg)
  if (profile.minShoulderDeg !== undefined && judged.shoulder) required.push(frame.shoulderDeg)
  if (profile.maxTiltDeg !== undefined && judged.tilt) required.push(frame.tiltDeg)
  if (profile.minKneeDeg !== undefined && judged.knee) required.push(frame.kneeDeg)
  if (profile.minHipAngleDeg !== undefined && judged.hipAngle) required.push(frame.hipAngleDeg)
  if (profile.levelTolerance !== undefined && judged.line) required.push(frame.hipOffset)
  if (profile.minLeanRatio !== undefined && judged.lean) required.push(frame.leanRatio)
  if (required.some((value) => value === undefined)) return null
  return materialIssuesForReading(frame, profile, judged, MOMENTARY_MATERIAL_TOLERANCE).length > 0
}

type ReadingMetric = Exclude<keyof FrameReading, 't'>

/**
 * Remove a one-sample joint snap when the estimates immediately before and
 * after agree. This operates per metric: a bad ankle must not throw away a
 * well-tracked elbow from the same frame. Gradual movement and sustained
 * changes survive because their neighbouring samples do not agree.
 */
export function suppressIsolatedMetricSpikes(
  frames: FrameReading[],
): { metricsIgnored: number; framesTouched: number } {
  const tolerances: Partial<Record<ReadingMetric, number>> = {
    elbowDeg: 22,
    kneeDeg: 24,
    hipAngleDeg: 26,
    hipOffset: 0.32,
    leanRatio: 0.32,
    shrugRatio: 0.2,
    shoulderDeg: 26,
    tiltDeg: 20,
  }
  const source = frames.map((frame) => ({ ...frame }))
  const touched = new Set<number>()
  let metricsIgnored = 0

  for (const [key, tolerance] of Object.entries(tolerances) as [ReadingMetric, number][]) {
    for (let i = 1; i < source.length - 1; i++) {
      const prev = source[i - 1][key]
      const value = source[i][key]
      const next = source[i + 1][key]
      if (prev === undefined || value === undefined || next === undefined) continue
      if (
        Math.abs(prev - next) <= tolerance * 0.55 &&
        Math.abs(value - prev) > tolerance &&
        Math.abs(value - next) > tolerance
      ) {
        delete frames[i][key]
        touched.add(i)
        metricsIgnored++
      }
    }
  }

  return { metricsIgnored, framesTouched: touched.size }
}

/**
 * Returns the portion of a hold before a sustained breakdown. Both a minimum
 * sample count and real elapsed time are required, so increasing sampling
 * density cannot make the same movement fail sooner.
 */
export function sustainedBreakdownStart(
  samples: { t: number; bad: boolean }[],
  creditedHoldSec: number,
  minimumBadSamples = 3,
  minimumBadDurationSec = 0.75,
): number {
  const hold = Math.max(0, creditedHoldSec)
  let badRun = 0
  let badRunStartedAt = hold
  for (const sample of [...samples].sort((a, b) => a.t - b.t)) {
    if (!sample.bad) {
      badRun = 0
      badRunStartedAt = hold
      continue
    }
    if (badRun === 0) badRunStartedAt = sample.t
    badRun += 1
    if (
      badRun >= Math.max(1, minimumBadSamples) &&
      sample.t - badRunStartedAt >= Math.max(0, minimumBadDurationSec)
    ) {
      return Math.min(hold, Math.max(0, badRunStartedAt))
    }
  }
  return hold
}

export function sustainedCleanSeconds(
  samples: { t: number; bad: boolean }[],
  creditedHoldSec: number,
  minimumBadSamples = 3,
  minimumBadDurationSec = 0.75,
): number {
  const start = sustainedBreakdownStart(
    samples,
    creditedHoldSec,
    minimumBadSamples,
    minimumBadDurationSec,
  )
  return Math.round(start * 10) / 10
}

/**
 * A sampled moment with incomplete pose evidence cannot prove the athlete was
 * still holding. One brief miss remains harmless because sustainedCleanSeconds
 * requires a real run; a fast drop or leaving the frame ends the clean window.
 */
export function sustainedObservableCleanSeconds(
  samples: { t: number; bad: boolean | null }[],
  creditedHoldSec: number,
): number {
  return sustainedCleanSeconds(
    samples.map((sample) => ({ t: sample.t, bad: sample.bad !== false })),
    creditedHoldSec,
  )
}

/**
 * Remove an abrupt final collapse from the angles that describe the held
 * position. Athletes stop the timer as they come down, so the final sample can
 * catch a kneeling body even when its timestamp is technically inside the
 * credited hold. A gradual late loss stays: only two independent measurements
 * dropping implausibly far from their recent baseline, inside the last fraction
 * of a second, is treated as the dismount.
 */
export function trimTerminalDismountFrames(
  frames: FrameReading[],
  creditedHoldSec: number,
  maxTailSec = 0.8,
): FrameReading[] {
  if (frames.length < 6 || !Number.isFinite(creditedHoldSec)) return frames

  const angularKeys = ['elbowDeg', 'kneeDeg', 'hipAngleDeg', 'shoulderDeg'] as const
  for (let index = 3; index < frames.length; index++) {
    const current = frames[index]
    if (creditedHoldSec - current.t > maxTailSec || current.t > creditedHoldSec + 0.05) continue
    const recent = frames.slice(Math.max(0, index - 6), index)
    let collapseSignals = 0

    for (const key of angularKeys) {
      const value = current[key]
      const history = recent
        .map((frame) => frame[key])
        .filter((candidate): candidate is number =>
          typeof candidate === 'number' && Number.isFinite(candidate),
        )
      const baseline = median(history)
      if (value !== undefined && baseline !== undefined && baseline - value > 30) collapseSignals++
    }

    const ratioJump = (key: 'hipOffset' | 'leanRatio', threshold: number) => {
      const value = current[key]
      const history = recent
        .map((frame) => frame[key])
        .filter((candidate): candidate is number =>
          typeof candidate === 'number' && Number.isFinite(candidate),
        )
      const baseline = median(history)
      return value !== undefined && baseline !== undefined && Math.abs(value - baseline) > threshold
    }
    if (ratioJump('hipOffset', 0.35)) collapseSignals++
    if (ratioJump('leanRatio', 0.35)) collapseSignals++

    if (collapseSignals >= 2) return frames.slice(0, index)
  }
  return frames
}

export function hasVerifiableHoldDuration(creditedHoldSec: number): boolean {
  return Number.isFinite(creditedHoldSec) && creditedHoldSec >= MIN_VERIFIABLE_HOLD_SEC
}

/** Positions worth filming for automated or replay-based form review. */
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

/**
 * Reject an angle built from anatomically implausible segment lengths. Pose
 * models can put an elbow almost on the shoulder while leaving a high
 * confidence score; the resulting angle is numerically valid but is not a
 * credible arm measurement.
 */
export function reliableJointAngle(a: Kp, b: Kp, c: Kp, bodyScale: number): number | undefined {
  if (!Number.isFinite(bodyScale) || bodyScale <= 0) return undefined
  const first = Math.hypot(a.x - b.x, a.y - b.y)
  const second = Math.hypot(c.x - b.x, c.y - b.y)
  const shorter = Math.min(first, second)
  const longer = Math.max(first, second)
  if (
    shorter < bodyScale * 0.18 ||
    longer > bodyScale * 1.35 ||
    longer / shorter > 2.2 ||
    first + second > bodyScale * 2.2
  ) {
    return undefined
  }
  const angle = angleDeg(a, b, c)
  return Number.isFinite(angle) ? angle : undefined
}

/**
 * How open the shoulder is: the angle between the upper arm and the trunk.
 *
 * Its two segments are meant to differ — the trunk is nearly twice the upper
 * arm — so the limb-ratio gate `reliableJointAngle` applies to elbows and knees
 * throws away exactly the well-formed readings: real straight handstands came
 * back with their shoulders unseen, and only an arched one, whose arm the
 * model drew long, was measured. Here only an upper arm too short or too long
 * to be one is rejected.
 */
export function shoulderOpeningDeg(elbow: Kp, shoulder: Kp, hip: Kp, torso: number): number | undefined {
  if (!Number.isFinite(torso) || torso <= 0) return undefined
  const upperArm = Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y)
  if (upperArm < torso * 0.25 || upperArm > torso) return undefined
  const angle = angleDeg(elbow, shoulder, hip)
  return Number.isFinite(angle) ? angle : undefined
}

/**
 * Departure from a locked elbow, signed: positive is flexion, negative is the
 * hyperextension a locked-out straight arm genuinely shows.
 *
 * An unsigned three-point angle reads 174° for both a six-degree bend and a
 * six-degree hyperextension, and in straight-arm work those are opposites. The
 * side view separates them: flexion carries the elbow toward the hips, lockout
 * carries it away. Signing the whole measurement — rather than special-casing
 * one direction — is what makes it symmetric. The two are never confusable
 * where it matters, because the same off-chord displacement that sets the sign
 * also sets the magnitude: by the time the bend is large enough to be a fault,
 * the displacement is many times landmark noise.
 *
 * The projection gate rejects elbows the model placed beyond either end of the
 * upper-arm/forearm chord.
 */
export function signedElbowBend(
  shoulder: Kp,
  elbow: Kp,
  wrist: Kp,
  hip: Kp,
  bodyScale: number,
): number | undefined {
  const angle = reliableJointAngle(shoulder, elbow, wrist, bodyScale)
  if (angle === undefined) return undefined

  const chordX = wrist.x - shoulder.x
  const chordY = wrist.y - shoulder.y
  const chordSq = chordX * chordX + chordY * chordY
  if (chordSq < bodyScale * bodyScale * 0.08) return undefined
  const projection = ((elbow.x - shoulder.x) * chordX + (elbow.y - shoulder.y) * chordY) / chordSq
  if (projection < 0.08 || projection > 0.92) return undefined

  const onLineX = shoulder.x + chordX * projection
  const onLineY = shoulder.y + chordY * projection
  const torsoX = hip.x - shoulder.x
  const torsoY = hip.y - shoulder.y
  const torsoMag = Math.hypot(torsoX, torsoY)
  if (torsoMag < 1) return undefined
  const towardHips =
    ((elbow.x - onLineX) * torsoX + (elbow.y - onLineY) * torsoY) / torsoMag / bodyScale

  const departure = 180 - angle
  // The hip-direction rule is a posture assumption, and it fails in a
  // collapse: a clearly bent elbow lowering out of a hold can sit on the far
  // side of the torso line. No elbow hyperextends this far, so the magnitude
  // is trusted over the sign.
  if (towardHips < 0 && departure > MAX_PLAUSIBLE_HYPEREXTENSION_DEG) return departure
  return towardHips >= 0 ? departure : -departure
}

/**
 * Elbow angle as the verdict should read it.
 *
 * Hyperextension is clamped to 180 rather than reported as 184: it is lockout,
 * which is the goal, and an athlete reading "184°" beside a red flag would
 * reasonably conclude the app was broken. Flexion is reported honestly and left
 * continuous — deciding how much of it is a fault belongs to the deduction
 * thresholds, not to the measurement.
 */
export function plancheArmAngle(
  shoulder: Kp,
  elbow: Kp,
  wrist: Kp,
  hip: Kp,
  bodyScale: number,
): number | undefined {
  const bend = signedElbowBend(shoulder, elbow, wrist, hip, bodyScale)
  if (bend === undefined) return undefined
  return 180 - Math.max(0, bend)
}

function byName(kps: Kp[], name: string, minScore = MIN_KP_SCORE): Kp | undefined {
  const k = kps.find((p) => p.name === name)
  return k && (k.score ?? 0) >= minScore ? k : undefined
}

function pickSide(kps: Kp[]): 'left' | 'right' | null {
  const score = (side: string) =>
    ['shoulder', 'elbow', 'wrist', 'hip'].reduce((t, part) => t + (byName(kps, `${side}_${part}`)?.score ?? 0), 0)
  const l = score('left')
  const r = score('right')
  if (Math.max(l, r) === 0) return null
  return l >= r ? 'left' : 'right'
}

/** Pick the best-observed side across the clip, not whichever won frame one. */
function pickStableSide(frames: { kps: Kp[] }[]): 'left' | 'right' | null {
  const score = (side: 'left' | 'right') =>
    frames.reduce(
      (total, frame) =>
        total +
        ['shoulder', 'elbow', 'wrist', 'hip'].reduce(
          (sum, part) => sum + (frame.kps.find((k) => k.name === `${side}_${part}`)?.score ?? 0),
          0,
        ),
      0,
    )
  const left = score('left')
  const right = score('right')
  if (Math.max(left, right) === 0) return null
  return left >= right ? 'left' : 'right'
}

/**
 * An occluded far limb often receives plausible-looking guessed landmarks.
 * Use it only when it is visibly separate from the primary limb; otherwise the
 * side-on camera can honestly grade only the near side.
 */
function sidesAreVisiblySeparate(
  kps: Kp[],
  primary: 'left' | 'right',
  secondary: 'left' | 'right',
  parts: string[],
  torso: number,
): boolean {
  const distances: number[] = []
  for (const part of parts) {
    const near = byName(kps, `${primary}_${part}`)
    const far = byName(kps, `${secondary}_${part}`, 0.55)
    if (near && far) distances.push(Math.hypot(near.x - far.x, near.y - far.y) / torso)
  }
  return distances.length >= 2 && distances.reduce((a, b) => a + b, 0) / distances.length >= 0.14
}

const BILATERAL_COLLISION_LIMITS = {
  elbow: 0.1,
  wrist: 0.12,
  knee: 0.1,
  ankle: 0.12,
} as const

/**
 * Side-on footage often makes the detector place both left/right endpoints on
 * the same visible hand or foot. That is one observation, not evidence from
 * two limbs. Keep the stable primary side and remove the duplicate far point
 * before building the overlay or measuring angles.
 */
export function suppressBilateralCollisions(
  frames: { kps: Kp[] }[],
  primarySide: 'left' | 'right',
): { jointsIgnored: number; framesTouched: number } {
  const secondarySide = primarySide === 'left' ? 'right' : 'left'
  const touched = new Set<number>()
  let jointsIgnored = 0
  for (const [frameIndex, frame] of frames.entries()) {
    const primaryShoulder = byName(frame.kps, `${primarySide}_shoulder`)
    const primaryHip = byName(frame.kps, `${primarySide}_hip`)
    const secondaryShoulder = byName(frame.kps, `${secondarySide}_shoulder`)
    const secondaryHip = byName(frame.kps, `${secondarySide}_hip`)
    const shoulder = primaryShoulder ?? secondaryShoulder
    const hip = primaryHip ?? secondaryHip
    if (!shoulder || !hip) continue
    const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
    if (torso < 1) continue

    for (const [part, limit] of Object.entries(BILATERAL_COLLISION_LIMITS)) {
      const primary = byName(frame.kps, `${primarySide}_${part}`)
      const secondary = byName(frame.kps, `${secondarySide}_${part}`)
      if (!primary || !secondary) continue
      if (Math.hypot(primary.x - secondary.x, primary.y - secondary.y) / torso >= limit) continue
      const at = frame.kps.findIndex((k) => k.name === `${secondarySide}_${part}`)
      if (at < 0) continue
      frame.kps.splice(at, 1)
      touched.add(frameIndex)
      jointsIgnored++
    }
  }
  return { jointsIgnored, framesTouched: touched.size }
}

/** Joints worth repairing across a dropout; the rest are never measured. */
const BRIDGEABLE = [
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle', 'left_ear', 'right_ear',
]

/** Longest span (seconds, neighbour to neighbour) a missing joint may be filled across. */
export const MAX_BRIDGE_SPAN_SEC = 1.25
/** Farther than this (in torso lengths) between neighbours is movement, not a static hold. */
const MAX_BRIDGE_TRAVEL = 0.35

/**
 * Fill single-frame keypoint dropouts by interpolating between the samples
 * either side. During a hold the body is close to static between samples, so a
 * joint that is tracked before and after but missing in between is a detector
 * miss rather than movement. Only isolated gaps are bridged — two consecutive
 * misses are treated as genuinely not visible, and the interpolated point
 * carries a reduced score so it never props up the confidence average.
 *
 * Bounded in time and motion: a joint seen at 0s and 60s says nothing about
 * 30s, and one that moved a third of a torso between its neighbours was
 * moving. Filled points are marked `interpolated` — they keep the replay
 * continuous but never count as observed coverage.
 *
 * Exported for tests: silently inventing keypoints would be a bad bug, so the
 * boundaries of what this will and will not fabricate are pinned down.
 */
export function bridgeKeypointGaps(frames: { t: number; kps: Kp[] }[]): number {
  let repaired = 0
  const good = (kps: Kp[], name: string) => {
    const k = kps.find((p) => p.name === name)
    return k && (k.score ?? 0) >= MIN_KP_SCORE ? k : undefined
  }
  for (const name of BRIDGEABLE) {
    for (let i = 1; i < frames.length - 1; i++) {
      if (good(frames[i].kps, name)) continue
      const before = good(frames[i - 1].kps, name)
      const after = good(frames[i + 1].kps, name)
      if (!before || !after) continue
      const span = frames[i + 1].t - frames[i - 1].t
      if (!Number.isFinite(span) || span <= 0 || span > MAX_BRIDGE_SPAN_SEC) continue
      const scale = median(
        [torsoScale(frames[i - 1].kps), torsoScale(frames[i + 1].kps)].filter((v): v is number => v !== undefined),
      )
      if (scale !== undefined && Math.hypot(after.x - before.x, after.y - before.y) / scale > MAX_BRIDGE_TRAVEL) continue
      const w = (frames[i].t - frames[i - 1].t) / span
      const score = Math.min(before.score ?? 0, after.score ?? 0) * 0.9
      if (score < MIN_KP_SCORE) continue
      const filled: Kp = {
        name,
        x: before.x + (after.x - before.x) * w,
        y: before.y + (after.y - before.y) * w,
        score,
        origin: 'interpolated',
      }
      const at = frames[i].kps.findIndex((p) => p.name === name)
      if (at >= 0) frames[i].kps[at] = filled
      else frames[i].kps.push(filled)
      repaired++
    }
  }
  return repaired
}

function torsoScale(kps: Kp[]): number | undefined {
  const lengths = (['left', 'right'] as const).flatMap((side) => {
    const shoulder = byName(kps, `${side}_shoulder`)
    const hip = byName(kps, `${side}_hip`)
    if (!shoulder || !hip) return []
    const length = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
    return length >= 1 ? [length] : []
  })
  return median(lengths)
}

/**
 * Repair an impossible one-sample landmark teleport.
 *
 * This deliberately has a much larger threshold than the form checks. A real
 * elbow bend, hip shift, or controlled exit survives; a wrist/body point that
 * leaps more than half a torso away and immediately returns does not. Reading
 * from a frozen copy prevents one repaired joint influencing the next one.
 */
export function stabilizeKeypointSpikes(
  frames: { t: number; kps: Kp[] }[],
): { jointsRepaired: number; framesTouched: number } {
  const source = frames.map((frame) => ({
    t: frame.t,
    kps: frame.kps.map((point) => ({ ...point })),
  }))
  const touched = new Set<number>()
  let jointsRepaired = 0
  const good = (kps: Kp[], name: string) => {
    const point = kps.find((candidate) => candidate.name === name)
    return point && (point.score ?? 0) >= MIN_KP_SCORE ? point : undefined
  }

  for (let i = 1; i < source.length - 1; i++) {
    const beforeFrame = source[i - 1]
    const frame = source[i]
    const afterFrame = source[i + 1]
    // Never infer smooth motion across sparse diagnostic sampling or a long
    // detector blackout.
    if (afterFrame.t - beforeFrame.t > 1.25) continue
    const scale = median([torsoScale(beforeFrame.kps), torsoScale(afterFrame.kps)].filter(
      (value): value is number => value !== undefined,
    ))
    if (scale === undefined || scale < 1) continue
    const span = afterFrame.t - beforeFrame.t
    const weight = span > 0 ? (frame.t - beforeFrame.t) / span : 0.5

    for (const name of BRIDGEABLE) {
      const before = good(beforeFrame.kps, name)
      const point = good(frame.kps, name)
      const after = good(afterFrame.kps, name)
      if (!before || !point || !after) continue
      const expectedX = before.x + (after.x - before.x) * weight
      const expectedY = before.y + (after.y - before.y) * weight
      const neighbourTravel = Math.hypot(after.x - before.x, after.y - before.y) / scale
      const residual = Math.hypot(point.x - expectedX, point.y - expectedY) / scale
      // Neighbours must agree first. The adaptive term prevents a fast but
      // smooth real movement being flattened just because its midpoint is not
      // perfectly linear.
      if (
        neighbourTravel > 0.32 ||
        residual <= Math.max(0.52, neighbourTravel * 2.5 + 0.16)
      ) continue

      const replacement: Kp = {
        ...point,
        x: expectedX,
        y: expectedY,
        score: Math.min(point.score ?? 0, before.score ?? 0, after.score ?? 0) * 0.9,
        origin: 'repaired',
      }
      const at = frames[i].kps.findIndex((candidate) => candidate.name === name)
      if (at >= 0) frames[i].kps[at] = replacement
      touched.add(i)
      jointsRepaired++
    }
  }

  return { jointsRepaired, framesTouched: touched.size }
}

/** "elbows, knees and hips" — reads as a sentence rather than a CSV dump. */
function listPhrase(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
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

/**
 * Pose models are trained overwhelmingly on people who are standing up, so a
 * horizontal athlete is the single case they handle worst — and that is every
 * planche ever filmed. Feeding the detector a rotated frame puts the body back
 * near upright and recovers tracking that is otherwise simply lost.
 *
 * Keypoints come back in rotated space and are mapped straight back to the
 * original frame, so every measurement downstream still uses real screen axes:
 * angles are rotation-invariant anyway, but hip height and forward lean are
 * emphatically not.
 */
export type Rotation = 0 | 90 | 270

/**
 * Redraw a frame at one of the probe rotations. Exported so a still image can
 * be pushed through the identical path a clip takes — a bench that rotated
 * frames even slightly differently would be measuring its own arithmetic.
 */
export function drawRotated(
  source: CanvasImageSource,
  width: number,
  height: number,
  canvas: HTMLCanvasElement,
  rotation: Rotation,
): boolean {
  if (!width || !height) return false
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  canvas.width = rotation === 0 ? width : height
  canvas.height = rotation === 0 ? height : width
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (rotation === 90) {
    ctx.translate(height, 0)
    ctx.rotate(Math.PI / 2)
  } else if (rotation === 270) {
    ctx.translate(0, width)
    ctx.rotate(-Math.PI / 2)
  }
  ctx.drawImage(source, 0, 0, width, height)
  return true
}

/** Which edge of the picture the floor runs along. */
export type FloorEdge = 'bottom' | 'right' | 'left' | 'top'

/**
 * Past this, the trunk runs closer to the picture's sides than to its bottom:
 * the phone was on its side. Every graded position is a support hold whose
 * trunk lies across gravity, so a trunk running up the picture means the
 * picture, not the athlete, is turned.
 *
 * Measured, not chosen. Across 3,780 synthetic holds — every graded position
 * and fault, phone roll up to ±15°, two noise levels — an upright trunk never
 * sat more than 61° from horizontal, and that only in an extreme pike filmed on
 * a 15°-tilted phone; real holds sit under 18°. Turned 90°, the real photos
 * read 72–85°, and the sideways clip an athlete reported read 80.5°. The
 * arm direction alone cannot do this job: a leaning arm in a turned frame can
 * line up with the bottom edge (synthetic overlap 1°–97°).
 */
export const SIDEWAYS_TRUNK_DEG = 68
/**
 * Past this, the shoulder→wrist line points up the picture: it is upside down.
 * Upright synthetic holds never exceeded 97° (a deep lean on a tilted phone);
 * the real photos turned upside down read 137–171°.
 */
export const UPSIDE_DOWN_ARM_DEG = 120

/**
 * How far from straight down a handstand's or wall plank's arms may point and
 * still be standing on the picture's bottom edge. Half-way to sideways: upright
 * synthetic holds on a phone tilted 15° stayed under 36°, and turned a quarter
 * the same holds read 54° or more.
 */
export const INVERTED_ARM_SLACK_DEG = 45

/**
 * Where a hanging body's weight sits, from the joints a side view shows: each
 * segment's share of body mass and how far along it its centre lies (Winter's
 * anthropometric table, rounded). Only the *direction* from the hands to this
 * point is ever used (`readFloor`), so nothing here needs to be exact.
 */
const SEGMENT_MASS = {
  /** Head and neck, placed a quarter of a trunk beyond the shoulders. */
  head: 0.08,
  /** Shoulder to hip, centred half-way. */
  trunk: 0.5,
  /** Both arms, centred half-way from shoulder to wrist. */
  arms: 0.1,
  /** Both thighs, centred 43% of the way from hip to knee. */
  thighs: 0.2,
  /** Both shanks and feet, centred 60% of the way from knee to ankle. */
  shanks: 0.12,
}

/** Why a clip's gravity could not be accepted for its posture. */
export type FloorRefusal =
  /** A lever or hang filmed with the hands below the shoulders: not hanging. */
  | 'not-hanging'
  /** A handstand filmed any way but upright: indistinguishable from standing or lying. */
  | 'not-upright'

export interface FloorVerdict {
  floor: FloorEdge | null
  refusal?: FloorRefusal
  /**
   * Inverted postures only: how steeply the body rises from the shoulders to
   * its far end — the ankles, or the knees or hips when they are all that was
   * seen — in degrees above level (90 = feet straight above the shoulders,
   * below 0 = a plank on the floor, whose feet sit lower than its shoulders).
   */
  bodyRiseDeg?: number
}

/**
 * How steeply the body must rise before a hold is judged as an inverted one —
 * a wall plank or a handstand — at all.
 *
 * Nothing in an inverted profile said the body had to be inverted, so a plank
 * on the floor — straight arms, straight body, arms pointing at the floor —
 * passed clean as a wall plank. The trunk alone cannot say: a real arched
 * handstand's trunk lies within 20° of level while its feet are far overhead.
 * The feet can. Measured from the shoulders to the ankles, with the phone
 * rolled 12° either way: floor planks, leans and level planches −13° to 14°
 * (tucks far below); the synthetic wall plank 36° to 60°; synthetic handstands
 * 69° to 87°; the real straight handstand 89° and the real arched one 59°.
 * The bar sits in the gap, nearer the planks' side of it: a low wall plank is
 * still a wall plank, and a handstand at a shallow incline is caught by its
 * shoulder angle, not by this.
 */
export const MIN_INVERTED_RISE_DEG = 25

/**
 * Where the floor is in the picture, read from the body itself.
 *
 * The app suggests turning the phone on its side, and with rotation lock on a
 * phone does not turn the recording with it: the clip stays portrait with the
 * scene lying sideways. Elbow, knee and hip angles do not care, but hip height
 * and forward lean are measured against the picture's bottom edge, and on such
 * a clip they reported a hold as sagging and leaning backwards. The hands are
 * always below the shoulders in these holds, so once the picture is known to
 * be on its side, which way the arms point says which side the floor is on.
 * `null` when too few moments resolve shoulder, wrist and hip to say.
 *
 * Two postures can also be *refused* (`readFloor`), because a body alone does
 * not always say which way gravity runs:
 *
 * - **Hanging.** The trunk cannot be the reference — how far it is from level
 *   is the thing being judged. It once was: a trunk pointing up the picture
 *   was taken for a phone on its side, so a dead hang was turned a quarter and
 *   certified as a perfect level lever. The plumb line from the hands to the
 *   centre of mass is used instead, and weight *above* the hands is not a
 *   hang at all.
 * - **Inverted.** A handstand in an upside-down picture is, joint for joint,
 *   someone standing with their arms overhead; in a sideways one, someone
 *   lying down. Both were once turned and passed. Only an upright picture —
 *   hands at the bottom — is judged; the screen already asks for the phone
 *   upright for these.
 */
export function floorEdge(frames: { kps: Kp[] }[], posture: Posture = 'support'): FloorEdge | null {
  return readFloor(frames, posture).floor
}

export function readFloor(frames: { kps: Kp[] }[], posture: Posture = 'support'): FloorVerdict {
  const decided = (floor: FloorEdge | null): FloorVerdict => ({ floor })
  const trunks: number[] = []
  const arms: number[] = []
  const armAcross: number[] = []
  /** Per moment, the unit direction from the hands to the body's centre of mass. */
  const plumbX: number[] = []
  const plumbY: number[] = []
  /** How far the hips sit up the picture from the shoulders (+1 = straight up), and across it. */
  const trunkUp: number[] = []
  const trunkAcross: number[] = []
  /** The line between the two hands, in degrees from the picture's horizontal. */
  const gripLines: number[] = []
  /** How far up the picture the body's far end sits from the shoulders (+1 = straight up). */
  const bodyUp: number[] = []
  for (const { kps } of frames) {
    if (posture === 'flag') {
      const lw = byName(kps, 'left_wrist', MIN_PRECISE_KP_SCORE)
      const rw = byName(kps, 'right_wrist', MIN_PRECISE_KP_SCORE)
      if (lw && rw && Math.hypot(lw.x - rw.x, lw.y - rw.y) >= 1) {
        gripLines.push((Math.atan2(Math.abs(lw.y - rw.y), Math.abs(lw.x - rw.x)) * 180) / Math.PI)
      }
      continue
    }
    let best: { s: Kp; w: Kp; h: Kp; q: number; side: 'left' | 'right' } | undefined
    for (const side of ['left', 'right'] as const) {
      const s = byName(kps, `${side}_shoulder`, MIN_PRECISE_KP_SCORE)
      const w = byName(kps, `${side}_wrist`, MIN_PRECISE_KP_SCORE)
      const h = byName(kps, `${side}_hip`, MIN_PRECISE_KP_SCORE)
      if (!s || !w || !h) continue
      const q = (s.score ?? 0) + (w.score ?? 0) + (h.score ?? 0)
      if (!best || q > best.q) best = { s, w, h, q, side }
    }
    if (!best) continue
    const ax = best.w.x - best.s.x
    const ay = best.w.y - best.s.y
    const tx = best.h.x - best.s.x
    const ty = best.h.y - best.s.y
    const armLength = Math.hypot(ax, ay)
    if (armLength < 1 || Math.hypot(tx, ty) < 1) continue
    // Degrees from straight down the picture (0) to straight up it (180).
    arms.push((Math.atan2(Math.abs(ax), ay) * 180) / Math.PI)
    // Degrees from the picture's horizontal (0) to its vertical (90).
    trunks.push((Math.atan2(Math.abs(ty), Math.abs(tx)) * 180) / Math.PI)
    armAcross.push(ax / armLength)
    const trunkLength = Math.hypot(tx, ty)
    trunkUp.push(-ty / trunkLength)
    trunkAcross.push(tx / trunkLength)
    if (posture === 'inverted') {
      const far = byName(kps, `${best.side}_ankle`) ?? byName(kps, `${best.side}_knee`) ?? best.h
      const reach = Math.hypot(far.x - best.s.x, far.y - best.s.y)
      if (reach >= 1) bodyUp.push((best.s.y - far.y) / reach)
    }
    if (posture === 'hang') {
      // The centre of mass, from whichever segments this moment shows. The
      // legs matter — in a full lever they carry the weight out past the hips
      // — so they are counted whenever the knee (and ankle) can be seen.
      const { s, w, h } = best
      const knee = byName(kps, `${best.side}_knee`)
      const ankle = byName(kps, `${best.side}_ankle`)
      const parts: [number, number, number][] = [
        [SEGMENT_MASS.head, s.x - 0.25 * tx, s.y - 0.25 * ty],
        [SEGMENT_MASS.trunk, s.x + 0.5 * tx, s.y + 0.5 * ty],
        [SEGMENT_MASS.arms, s.x + 0.5 * ax, s.y + 0.5 * ay],
      ]
      if (knee) parts.push([SEGMENT_MASS.thighs, h.x + 0.43 * (knee.x - h.x), h.y + 0.43 * (knee.y - h.y)])
      if (knee && ankle) parts.push([SEGMENT_MASS.shanks, knee.x + 0.6 * (ankle.x - knee.x), knee.y + 0.6 * (ankle.y - knee.y)])
      const mass = parts.reduce((sum, [m]) => sum + m, 0)
      const cx = parts.reduce((sum, [m, x]) => sum + m * x, 0) / mass
      const cy = parts.reduce((sum, [m, , y]) => sum + m * y, 0) / mass
      const reach = Math.hypot(cx - w.x, cy - w.y)
      if (reach >= 1) {
        plumbX.push((cx - w.x) / reach)
        plumbY.push((cy - w.y) / reach)
      }
    }
  }
  if (posture === 'flag') {
    // A flag's body lies across the picture *if* it is level — and a clip of a
    // body pointing up the picture is either a phone on its side or an athlete
    // who is not level, which the trunk alone cannot tell apart: a vertical
    // hold on a pole was read as a perfect level flag that way. The pole can.
    // Both hands are on it, so the line between them is the upright, however
    // the body hangs. Which side the floor is on does not matter to anything a
    // flag is measured by (angles to the horizontal, straightness), so one
    // quarter-turn serves. Hands that are neither stacked nor side by side
    // say nothing, and then how level the body is goes unjudged.
    if (gripLines.length < MIN_FRAMES) return decided(null)
    const grip = median(gripLines)!
    if (grip >= 90 - FLAG_GRIP_SLACK_DEG) return decided('bottom')
    if (grip <= FLAG_GRIP_SLACK_DEG) return decided('right')
    return decided(null)
  }
  if (trunks.length < MIN_FRAMES) return decided(null)
  if (posture === 'inverted') {
    // On the hands with the body above them, the arms point at the floor —
    // straight down in a handstand, within about 20° of it in a wall plank,
    // whose trunk can lie anywhere from a low incline to upright and so says
    // nothing reliable. Arms pointing any other way, the picture is on its
    // side or upside down — or this is not a handstand — and nothing in the
    // joints can say which.
    if (median(arms)! > INVERTED_ARM_SLACK_DEG) return { floor: null, refusal: 'not-upright' }
    const up = Math.max(-1, Math.min(1, median(bodyUp) ?? median(trunkUp)!))
    return { floor: 'bottom', bodyRiseDeg: (Math.asin(up) * 180) / Math.PI }
  }
  if (posture === 'hang') {
    // A body hanging still has its centre of mass directly below its hands:
    // the line from the hands to it is a plumb line, whatever shape the body
    // makes — a dead hang, a tuck, a level lever, a pike. That is the gravity
    // reference the trunk could never be, and it needs no tuned number: the
    // plumb line simply points at the nearest edge of the picture, and stays
    // right until the phone is rolled past 45°. (The arms alone are not
    // enough — a long lever's lean 20–42° from vertical, real and synthetic,
    // and turned a quarter they are almost as close to "up" again.)
    if (plumbX.length < MIN_FRAMES) return decided(null)
    const gx = median(plumbX)!
    const gy = median(plumbY)!
    if (Math.abs(gy) >= Math.abs(gx)) {
      // Weight below the hands down the picture: upright. Above them: this is
      // a body supported on its hands, not hanging from them.
      return gy > 0 ? decided('bottom') : { floor: null, refusal: 'not-hanging' }
    }
    return decided(gx > 0 ? 'right' : 'left')
  }
  if (median(trunks)! >= SIDEWAYS_TRUNK_DEG) return decided(median(armAcross)! >= 0 ? 'right' : 'left')
  if (median(arms)! >= UPSIDE_DOWN_ARM_DEG) return decided('top')
  return decided('bottom')
}

/**
 * Turn keypoints so the floor runs along the bottom. A pure rotation: every
 * measurement downstream is an angle or a ratio of lengths, so no frame size is
 * needed — and the replay track is never turned, because it is drawn over the
 * video as recorded.
 */
export function turnUpright<T extends { x: number; y: number }>(kps: T[], floor: FloorEdge): T[] {
  if (floor === 'bottom') return kps
  return kps.map((k) =>
    floor === 'right'
      ? { ...k, x: -k.y, y: k.x }
      : floor === 'left'
        ? { ...k, x: k.y, y: -k.x }
        : { ...k, x: -k.x, y: -k.y },
  )
}

/** Map keypoints from rotated-canvas space back into original frame space. */
export function unrotateKeypoints<T extends { x: number; y: number }>(
  kps: T[],
  rotation: Rotation,
  srcWidth: number,
  srcHeight: number,
): T[] {
  if (rotation === 0) return kps
  return kps.map((k) =>
    rotation === 90
      ? { ...k, x: k.y, y: srcHeight - k.x }
      : { ...k, x: srcWidth - k.y, y: k.x },
  )
}

/** How long one seek may take to deliver a decoded frame before that moment counts as unread. */
const SEEK_DEADLINE_MS = 1500

/**
 * Move to a moment and wait for a *decoded frame* there.
 *
 * The old version resolved on 'seeked' or after 600 ms, without saying which —
 * so a seek that never completed was inferred on whatever pixels were still on
 * screen and labelled with the requested time. A deadline is not evidence of
 * a frame: a timed-out moment is now reported as unread and carries no pose.
 */
function seekTo(video: HTMLVideoElement, t: number): Promise<'ok' | 'timeout'> {
  return new Promise((resolve) => {
    let done = false
    let timer: number | undefined
    const onData = () => {
      if (video.readyState >= 2) finish('ok')
    }
    // 'seeked' says the position moved; HAVE_CURRENT_DATA says a frame for it exists.
    const onSeeked = () => {
      if (video.readyState >= 2) finish('ok')
      else {
        video.addEventListener('loadeddata', onData)
        video.addEventListener('canplay', onData)
      }
    }
    const finish = (outcome: 'ok' | 'timeout') => {
      if (done) return
      done = true
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('loadeddata', onData)
      video.removeEventListener('canplay', onData)
      window.clearTimeout(timer)
      resolve(outcome)
    }
    video.addEventListener('seeked', onSeeked)
    timer = window.setTimeout(() => finish('timeout'), SEEK_DEADLINE_MS)
    try {
      video.currentTime = t
    } catch {
      finish('timeout')
    }
  })
}

/** A result that ran nothing, ready to carry a reason. */
export function emptyResult(reason?: string): PoseFormResult {
  return { ok: false, confidence: 0, framesUsed: 0, issues: [], notes: [], good: [], details: [], unseen: [], reason }
}

/**
 * Dense enough to observe a short loss of position, bounded so a long
 * foundations hold does not leave a phone running inference indefinitely.
 * Explicit sample counts remain exact for tests and diagnostic re-runs.
 *
 * Three moments a second up to 40 seconds. The old cap of 72 stretched the
 * spacing past 0.8s on a one-minute hold, where a 1.5s bend landed on one or
 * two samples and could never meet the persistence rule — so the camera
 * certified time it could not have seen fail. Beyond the cap the spacing is
 * disclosed with the verdict instead of hidden.
 */
export const MAX_SAMPLES = 120
export function chooseSampleCount(holdWindowSec: number, requested?: number): number {
  if (requested !== undefined && Number.isFinite(requested)) {
    return Math.max(1, Math.min(MAX_SAMPLES, Math.round(requested)))
  }
  const seconds = Math.max(0, holdWindowSec)
  return Math.round(Math.min(MAX_SAMPLES, Math.max(18, seconds * 3)))
}

/**
 * Bad samples needed before a breakdown counts, at a given spacing.
 *
 * The persistence rule is "roughly a second": three samples at the normal
 * three-a-second spacing. At sparse spacing three samples would demand two
 * whole gaps of persistence — far more than a second — so two suffice once the
 * spacing alone exceeds the minimum duration.
 */
export function minimumBadSamplesFor(samplingGapSec: number): number {
  return samplingGapSec >= 0.75 ? 2 : 3
}

/** Widest step between consecutive requested moments inside a window. */
export function widestSamplingGap(times: number[], until = Infinity): number {
  const inside = times.filter((t) => Number.isFinite(t) && t <= until + 0.05).sort((a, b) => a - b)
  let widest = 0
  for (let i = 1; i < inside.length; i++) widest = Math.max(widest, inside[i] - inside[i - 1])
  return widest
}

/**
 * Everything the verdict needs that is not a pose: the sampling window the
 * clip was read over and which detector produced it.
 */
/** Why a position with no geometric checks is not graded, in the athlete's words. */
function noChecksReason(exerciseId: string, profile: PoseProfile): string {
  return exerciseId === 'frog-stand'
    ? `A ${profile.label.toLowerCase()} is about balance rather than a fixed shape, so there is nothing here the camera can judge for you. Rate it yourself.`
    : `A ${profile.label.toLowerCase()} has no fixed shape the camera can grade honestly, so there is nothing here for it to judge. Watch the replay against the checklist and rate it yourself.`
}

/** Why a clip whose gravity cannot be accepted is not judged, in the athlete's words. */
const FLOOR_REFUSAL: Record<FloorRefusal, string> = {
  'not-hanging':
    'Your weight is above your hands in this clip, so it is not a hang the camera can check as a lever. If the phone was upside down, film again with it the right way up.',
  'not-upright':
    'This clip is not the right way up — your hands are not at the bottom of the picture — and from there the camera cannot tell a handstand from someone standing or lying down. Stand the phone upright (turn rotation lock off if the picture comes out sideways) and film again.',
}

/** A flag filmed at an angle: readable as a flag, not measurable as one. */
const FLAG_OBLIQUE_VIEW =
  'This clip is at an angle to you: your body is pointing toward or away from the camera, which shortens every line this check reads and makes straight legs look bent. Put the phone square in front of the pole, facing your chest, and retry.'

/** What each posture's refusals and notes say about the view it needs. */
const POSTURE_COPY: Record<
  Posture,
  {
    /** "side-on" / "front-on". */
    view: string
    viewNoun: string
    from: string
    wrongView: string
    fitInFrame: string
    /** Why a softened elbow matters here, completing "Elbows softened … — ". */
    softElbows: string
    /** What this check cannot see, said plainly at the end of every verdict. */
    unmeasured: string
  }
> = {
  support: {
    view: 'side-on',
    viewNoun: 'side view',
    from: 'from the side',
    wrongView:
      'This clip is not fully side-on. Elbow, hip and lean angles are foreshortened from the front or a strong three-quarter view — put the phone directly beside you and retry.',
    fitInFrame: 'Move the phone further back and turn it on its side so the whole body fits end to end.',
    softElbows: 'even a small bend changes this from straight-arm work',
    unmeasured: 'Scapular protraction is not measured by this camera check — confirm it yourself.',
  },
  hang: {
    view: 'side-on',
    viewNoun: 'side view',
    from: 'from the side',
    wrongView:
      'This clip is not fully side-on. Elbow and hip angles are foreshortened from the front or a strong three-quarter view — put the phone directly beside the bar, level with your chest, and retry.',
    fitInFrame: 'Move the phone further back and turn it on its side so the whole body and your hands on the bar fit in the picture.',
    softElbows: 'a lever is held on straight arms, and a bend turns it into the top of a row',
    unmeasured: 'Shoulder-blade position is not measured by this camera check — confirm it yourself.',
  },
  inverted: {
    view: 'side-on',
    viewNoun: 'side view',
    from: 'from the side',
    wrongView:
      'This clip is not side-on enough. A handstand’s line cannot be read from the front or the back — put the phone directly beside you, low, and retry.',
    fitInFrame: 'Move the phone further back and keep it upright so your hands and toes both fit in the picture.',
    softElbows: 'a handstand rests on locked arms',
    unmeasured: 'How tall the shoulders are pushed is not measured by this camera check — confirm it yourself.',
  },
  flag: {
    view: 'front-on',
    viewNoun: 'front view',
    from: 'from the front',
    wrongView:
      'This clip is not front-on. A flag lies in the plane of its pole, so it can only be read facing you — put the phone square in front of you, looking at your chest, and retry.',
    fitInFrame: 'Move the phone further back and turn it on its side so your hands and feet both fit in the picture.',
    softElbows: 'a bent bottom arm lets the body sink toward the pole',
    unmeasured:
      'Rolling toward the floor or toward the camera cannot be seen from the front — confirm your chest stayed square.',
  },
}

interface FlagFrame {
  reading: FrameReading
  observed: Partial<Record<ReadingMetric, boolean>>
  confidence: number
  torso: number
  shoulder: { x: number; y: number }
  hip: { x: number; y: number }
  /** The midpoint of the hands on the pole, when both were seen: the fixed reference for steadiness. */
  anchor?: { x: number; y: number }
}

/**
 * One moment of a flag, read from the front.
 *
 * Both sides of the body are in view, so the line runs through midpoints: the
 * middle of the shoulders, the middle of the hips, the middle of the feet.
 * How far that line sits off the picture's horizontal is the tilt; the angle at
 * the hips is the fold at the waist. Each arm is its own plain angle and the
 * verdict takes the more bent of the two — a locked bottom arm is the one that
 * matters, and a straight arm must not hide a bent one. Legs are read one at a
 * time for the same reason; a one-leg shape grades the leg whose reach shows
 * it is the extended one, exactly as the side-view judge does.
 */
function flagReading(kps: Kp[], t: number, profile: PoseProfile, levelKnown: boolean): FlagFrame | null {
  const P = (name: string) => byName(kps, name, MIN_PRECISE_KP_SCORE)
  const sides = ['left', 'right'] as const
  /** How many of these points were filled in from their neighbours rather than seen. */
  const filled = (...points: (Kp | undefined)[]) => points.filter((point) => point?.origin).length
  const mid = (a: Kp | undefined, b: Kp | undefined) =>
    a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, filled: filled(a, b) } : undefined
  const S = mid(P('left_shoulder'), P('right_shoulder'))
  const H = mid(P('left_hip'), P('right_hip'))
  if (!S || !H) return null
  const torso = Math.hypot(S.x - H.x, S.y - H.y)
  if (torso < 1) return null

  // ——— Arms: each on its own, the more bent of the two is the reading ———
  const arms = sides
    .map((side) => {
      const s = P(`${side}_shoulder`)
      const e = P(`${side}_elbow`)
      const w = P(`${side}_wrist`)
      if (!s || !e || !w) return undefined
      const angle = reliableJointAngle(s, e, w, torso)
      return angle === undefined ? undefined : { angle, wrist: w, filled: filled(s, e, w), wristSeen: !w.origin }
    })
    .filter((arm): arm is NonNullable<typeof arm> => arm !== undefined)
  // Both arms or neither: a straight arm must not stand in for one the model
  // lost, which in a flag is usually the one that matters.
  const elbowDeg = arms.length === 2 ? Math.min(...arms.map((arm) => arm.angle)) : undefined

  // ——— Legs: each on its own ———
  const legs = sides
    .map((side) => {
      const h = P(`${side}_hip`)
      const k = P(`${side}_knee`)
      const a = P(`${side}_ankle`)
      if (!h || !k || !a) return undefined
      return {
        knee: reliableJointAngle(h, k, a, torso),
        reach: Math.hypot(h.x - a.x, h.y - a.y) / torso,
        ankle: a,
        filled: filled(h, k, a),
        /** The knee and ankle alone: the hips are counted once, with the trunk. */
        filledBelowHip: filled(k, a),
      }
    })
    .filter((leg): leg is NonNullable<typeof leg> => leg !== undefined)
  // A one-leg shape grades the leg whose reach shows it is the extended one.
  // Every other shape needs both legs: with one out of shot the middle of the
  // feet is not the body's line, and a straight leg must not stand in for a
  // bent one — so the legs and the line go unseen rather than half-seen.
  const graded = profile.oneLeg
    ? legs.filter((leg) => leg.reach >= MIN_EXTENDED_LEG_REACH).sort((a, b) => b.reach - a.reach).slice(0, 1)
    : legs.length === 2
      ? legs
      : []
  const kneeAngles = graded.map((leg) => leg.knee).filter((v): v is number => v !== undefined)
  const kneeDeg = kneeAngles.length === graded.length && graded.length ? Math.min(...kneeAngles) : undefined
  // Where the body line ends: the middle of the graded feet.
  const feet = graded.length
    ? {
        x: graded.reduce((total, leg) => total + leg.ankle.x, 0) / graded.length,
        y: graded.reduce((total, leg) => total + leg.ankle.y, 0) / graded.length,
        filled: graded.reduce((total, leg) => total + leg.filledBelowHip, 0),
      }
    : undefined
  // A front view asks each criterion for six or eight joints at once, where a
  // side view asks for three or four. Holding it to "every joint seen" would
  // throw a moment away for one joint bridged across a third of a second —
  // which is good evidence — so a moment here counts as seen while at most one
  // of the joints behind it was filled in. Two or more, and it is continuity
  // for the replay rather than observation.
  const seen = (filledJoints: number) => filledJoints <= 1

  // The fold at the waist: shoulders–hips–feet, a plain angle on long segments.
  const hipAngleDeg = feet ? angleDeg(S as Kp, H as Kp, feet as Kp) : undefined
  // Off level: the whole line where both legs are long, the trunk otherwise
  // (a tuck's knees and a one-leg shape's tucked leg are not on the line).
  const lineEnd = feet && profile.minKneeDeg !== undefined && !profile.oneLeg ? feet : H
  // Only when the hands on the pole said which way is up (see `floorEdge`).
  const tiltDeg = levelKnown
    ? (Math.atan2(Math.abs(lineEnd.y - S.y), Math.abs(lineEnd.x - S.x)) * 180) / Math.PI
    : NaN

  const scored = [P('left_shoulder'), P('right_shoulder'), P('left_hip'), P('right_hip'), ...sides.flatMap((side) => [P(`${side}_elbow`), P(`${side}_wrist`)])].filter(
    (point): point is Kp => point !== undefined,
  )
  const bothWrists = arms.length === 2 && arms.every((arm) => arm.wristSeen)
  const armsFilled = arms.reduce((total, arm) => total + arm.filled, 0)
  const lineFilled = S.filled + H.filled + (feet?.filled ?? 0)
  return {
    reading: {
      t,
      ...(elbowDeg !== undefined ? { elbowDeg } : {}),
      ...(kneeDeg !== undefined ? { kneeDeg } : {}),
      ...(hipAngleDeg !== undefined && Number.isFinite(hipAngleDeg) ? { hipAngleDeg } : {}),
      ...(Number.isFinite(tiltDeg) ? { tiltDeg } : {}),
    },
    observed: {
      elbowDeg: elbowDeg !== undefined && seen(armsFilled),
      kneeDeg: kneeDeg !== undefined && seen(graded.reduce((total, leg) => total + leg.filled, 0)),
      hipAngleDeg: hipAngleDeg !== undefined && feet !== undefined && seen(lineFilled),
      tiltDeg: levelKnown && (lineEnd === H ? seen(S.filled + H.filled) : feet !== undefined && seen(lineFilled)),
    },
    confidence: scored.reduce((total, point) => total + (point.score ?? 0), 0) / Math.max(1, scored.length),
    torso,
    shoulder: S,
    hip: H,
    ...(bothWrists
      ? { anchor: { x: (arms[0].wrist.x + arms[1].wrist.x) / 2, y: (arms[0].wrist.y + arms[1].wrist.y) / 2 } }
      : {}),
  }
}

export interface JudgeInput {
  /** Raw detections in source-frame pixels, one entry per moment that found a body. */
  tracked: { t: number; kps: Kp[] }[]
  /** Every moment that was requested, including ones that found nothing. */
  times: number[]
  width: number
  height: number
  /** Full clip length, seconds. */
  duration: number
  /** The timer's hold, which is the authority for where useful work ends. */
  creditedHoldSec?: number
  /** First and last sampled moment, for the early-vs-late fatigue comparison. */
  from: number
  to: number
  /** Length of the window that was sampled. */
  holdWindow: number
  backendId?: BackendId
  /** Exact detector weights, when known. */
  model?: string
  rotation?: Rotation
  /** Requested moments whose frame could not be decoded; they carry no pose. */
  decodeMisses?: number
  /** Clip time that `t = 0` corresponds to (a hold timed from the video). */
  timeOffsetSec?: number
}

/**
 * The verdict layer: pose keypoints in, form judgement out.
 *
 * Deliberately pure and free of the DOM. Everything above it is decoding and
 * inference, which cannot run in a test; everything in it is geometry and
 * reasoning, which is where form judgements are actually right or wrong. Split
 * this way the judge can be driven from recorded fixtures and from synthetic
 * poses whose true angles are known exactly.
 *
 * `options.explain` attaches the per-moment working (`explain`) to a graded
 * verdict. Refusals carry no explanation — there is no verdict to explain.
 */
export function judgeTrackedFrames(
  input: JudgeInput,
  exerciseId: string,
  options: { explain?: boolean } = {},
): PoseFormResult {
  const empty = emptyResult()
  const profile = POSE_PROFILES[exerciseId]
  if (!profile) return { ...empty, reason: 'This movement is not one the camera can assess.' }
  if (profile.noChecks) {
    return {
      ...empty,
      reason: noChecksReason(exerciseId, profile),
    }
  }

  const { times, duration, creditedHoldSec, from, to, holdWindow } = input
  if (creditedHoldSec !== undefined && !hasVerifiableHoldDuration(creditedHoldSec)) {
    return {
      ...empty,
      reason:
        'That attempt was too brief for the camera to verify a held position. Stay in the hold for at least 1 second — a quick touch-and-drop cannot be graded clean.',
    }
  }
  // The verdict speaks for the credited hold, so the footage has to cover it.
  // A camera stream that delivered almost no frames once made a 0.015s clip
  // of a 2.9s hold: its 18 sampled moments were one picture, graded as the
  // whole hold, and the rounding turned "the clip ended" into "the position
  // left the envelope". Under a second of footage is a refusal; a recording
  // that stops partway is read for what it filmed and says so (below).
  if (creditedHoldSec !== undefined && !hasVerifiableHoldDuration(Math.min(duration, creditedHoldSec))) {
    return {
      ...empty,
      reason: `The recording holds under a second of this ${creditedHoldSec.toFixed(1)}s hold — the camera stopped sending pictures, so there is nothing to judge. Your set is saved either way.`,
    }
  }
  const srcW = input.width
  const srcH = input.height
  const n = times.length
  const backend = { id: input.backendId ?? 'mediapipe' }
  const rotation: Rotation = input.rotation ?? 0
  // Own the frames outright: the repair passes below rewrite keypoints in
  // place, and a caller replaying a fixture must get the same answer twice.
  const tracked = input.tracked.map((frame) => ({
    t: frame.t,
    kps: frame.kps.map((point) => ({ ...point })),
  }))
  // A joint the model placed outside the picture — or at a non-number — was
  // not observed, however confident the model sounds about it: a wrist cropped
  // out of the frame came back at visibility 0.95. It becomes a missing point
  // rather than being clamped into frame or used as found. (A guess *inside*
  // the frame, over something hidden, is beyond what any bounds check can see.)
  let outOfFrameJoints = 0
  if (srcW > 0 && srcH > 0) {
    for (const frame of tracked) {
      for (const point of frame.kps) {
        const inside =
          Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= 0 && point.x <= srcW && point.y >= 0 && point.y <= srcH
        if (inside || (point.score ?? 0) < MIN_KP_SCORE) continue
        point.score = 0
        outOfFrameJoints++
      }
    }
  }

  const posture = postureOf(profile)
  const copy = POSTURE_COPY[posture]
  const elbows: number[] = []
  const knees: number[] = []
  const hipAngles: number[] = []
  const hipOffsets: number[] = []
  const leans: number[] = []
  const shrugs: number[] = []
  const shoulderAngles: number[] = []
  const tilts: number[] = []
  const confidences: number[] = []
  /** Shoulder and hip positions measured from the visible wrist, per moment. */
  const handRelative: { sx: number; sy: number; hx: number; hy: number; torso: number }[] = []
  const frameReadings: FrameReading[] = []
  // Timestamped copies of the metrics that fatigue visibly, so the hold can
  // be compared against itself: early third vs final third.
  const elbowSeries: { t: number; v: number }[] = []
  const kneeSeries: { t: number; v: number }[] = []
  const hipAngleSeries: { t: number; v: number }[] = []
  const lineSeries: { t: number; v: number }[] = []
  const leanSeries: { t: number; v: number }[] = []
  let orientationFrames = 0
  let nonSideFrames = 0
  /** Moments whose side-on view could not be checked either way. */
  let viewUnknownFrames = 0
  /** Flag moments refused because the body pointed toward or away from the camera. */
  let obliqueFrames = 0
  /**
   * Which of each moment's measurements rest only on observed points. Filled
   * and repaired points keep the replay continuous, but coverage — whether a
   * criterion is graded at all — counts only what the camera actually saw.
   */
  const frameObserved = new Map<number, Partial<Record<ReadingMetric, boolean>>>()
  /** Moments where both arms were resolved as separate limbs, for the disagreement check. */
  const armPairs: { t: number; near: number; far: number }[] = []
  /** The near (best-seen) arm's own signed bend, by moment. */
  const nearArm = new Map<number, number>()
  let trackedSide: 'left' | 'right' | null = null

  /** Frames where a person was found at all, however partially. */
  let posesSeen = 0
  /** Which body regions the camera ever managed to see, for the error copy. */
  const regionsSeen = new Set<string>()
  for (const { kps } of tracked) {
    if (trackingScore(kps) > 0.15) posesSeen++
    if (byName(kps, 'left_shoulder') || byName(kps, 'right_shoulder')) regionsSeen.add('shoulders')
    if (byName(kps, 'left_wrist') || byName(kps, 'right_wrist')) regionsSeen.add('hands')
    if (byName(kps, 'left_hip') || byName(kps, 'right_hip')) regionsSeen.add('hips')
    if (byName(kps, 'left_ankle') || byName(kps, 'right_ankle')) regionsSeen.add('feet')
  }

  // Repair one-frame dropouts before measuring. A shoulder that vanishes for
  // a single sample and returns in the next has not moved — the model simply
  // lost it — and dropping the whole frame over it was throwing away good
  // evidence and leaving verdicts resting on a handful of samples.
  const bridgedJoints = bridgeKeypointGaps(tracked)
  const keypointStats = stabilizeKeypointSpikes(tracked)
  // One stable side, and the far side's stacked guesses ignored — for a side
  // view. Seen from the front both sides are real and in plain sight, and feet
  // held together are *supposed* to land on nearly the same pixels: treating
  // that as a collision threw away a real flag's legs on a third of noisy runs.
  trackedSide = posture === 'flag' ? null : pickStableSide(tracked)
  const collisionStats = trackedSide
    ? suppressBilateralCollisions(tracked, trackedSide)
    : { jointsIgnored: 0, framesTouched: 0 }

  // What the model saw, kept for drawing over the replay — including on
  // refusals, where seeing the three tracked dots on your shoulder is the
  // fastest possible explanation of why the clip could not be judged.
  const track: PoseTrack | undefined =
    srcW && srcH && tracked.length
      ? {
          width: srcW,
          height: srcH,
          ...(trackedSide ? { gradedSide: trackedSide } : {}),
          ...(input.timeOffsetSec ? { offsetSec: input.timeOffsetSec } : {}),
          frames: tracked.map(({ t, kps }) => ({
            t,
            kps: kps
              .filter((k) => k.name && BRIDGEABLE.includes(k.name) && (k.score ?? 0) >= MIN_KP_SCORE)
              .map((k) => ({ name: k.name, x: k.x, y: k.y, score: k.score })),
          })),
        }
      : undefined

  // Measure in a picture whose floor runs along the bottom. The track above
  // keeps the frame as recorded, because it is drawn over the video.
  const gravity = readFloor(tracked, posture)
  if (gravity.refusal) {
    return { ...empty, framesSampled: times.length, track, reason: FLOOR_REFUSAL[gravity.refusal] }
  }
  // On the hands is not yet upside down: a plank is on the hands too.
  if (posture === 'inverted' && gravity.bodyRiseDeg !== undefined) {
    const incline = profile.minShoulderDeg === undefined
    if (gravity.bodyRiseDeg < MIN_INVERTED_RISE_DEG) {
      return {
        ...empty,
        framesSampled: times.length,
        track,
        reason: incline
          ? 'Your feet are not clearly above your shoulders in this clip, so it reads as a plank on the floor rather than a wall plank. Walk your feet higher up the wall until your body is a steep incline, and film again.'
          : 'Your body is not upside down over your hands in this clip — the feet need to be well above the shoulders — so there is no handstand here for the camera to check.',
      }
    }
  }
  const floor = gravity.floor
  const frameTurned = floor && floor !== 'bottom' ? floor : undefined
  if (frameTurned) for (const frame of tracked) frame.kps = turnUpright(frame.kps, frameTurned)
  /** A flag's level is measured against the pole; without the hands there is no level to measure. */
  const flagLevelKnown = posture !== 'flag' || floor !== null

  const isObserved = (...points: (Kp | undefined)[]) => points.every((point) => point !== undefined && !point.origin)
  for (const { t, kps } of tracked) {
    // The side-view gate, per moment. A moment whose bilateral span is too
    // wide is measured no further: it used to count only toward a whole-clip
    // majority, so a clip that turned front-on halfway was graded as if it
    // were side-on throughout. A far side too faint for the precise gate is
    // checked again at the bar that says a joint exists at all — a weaker
    // prerequisite must not turn a refusal into a pass.
    const bodyWidth =
      apparentBodyWidthRatio(kps, MIN_PRECISE_KP_SCORE) ?? apparentBodyWidthRatio(kps, MIN_KP_SCORE)
    if (bodyWidth !== undefined) {
      orientationFrames++
      // The view each posture needs: side-on for everything but the flag,
      // which lies in the plane of its pole and is only readable from the front.
      const oblique = posture === 'flag' && bodyWidth > MAX_FRONT_VIEW_RATIO
      const wrongView =
        posture === 'flag'
          ? bodyWidth < MIN_FRONT_VIEW_RATIO || oblique
          : bodyWidth > (posture === 'inverted' ? MAX_INVERTED_SIDE_VIEW_RATIO : MAX_SIDE_VIEW_RATIO)
      if (wrongView) {
        nonSideFrames++
        if (oblique) obliqueFrames++
        continue
      }
    } else {
      viewUnknownFrames++
    }

    if (posture === 'flag') {
      // Front-on, both sides of the body are in view: measured through the
      // midpoints rather than one stable side.
      const flag = flagReading(kps, t, profile, flagLevelKnown)
      if (!flag) continue
      confidences.push(flag.confidence)
      frameObserved.set(t, flag.observed)
      frameReadings.push(flag.reading)
      if (flag.anchor && t <= (creditedHoldSec ?? Infinity) + 0.05) {
        handRelative.push({
          sx: flag.shoulder.x - flag.anchor.x,
          sy: flag.shoulder.y - flag.anchor.y,
          hx: flag.hip.x - flag.anchor.x,
          hy: flag.hip.y - flag.anchor.y,
          torso: flag.torso,
        })
      }
      continue
    }
    // Keep anatomical identity stable through the clip. Switching to
    // whichever side scores higher on each frame creates fake angle jumps.
    const side: 'left' | 'right' | null = trackedSide ?? pickSide(kps)
    if (!side) continue

    const shoulder = byName(kps, `${side}_shoulder`)
    const elbow = byName(kps, `${side}_elbow`)
    const wrist = byName(kps, `${side}_wrist`)
    const hip = byName(kps, `${side}_hip`)
    if (!shoulder || !hip) continue
    trackedSide = side

    const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
    if (torso < 1) continue

    // A 0.30 landmark is enough to say that a body region exists, but it is
    // not enough evidence for a five-degree elbow call. Fine geometry uses a
    // stricter gate and becomes "unseen" when the model is uncertain.
    const preciseShoulder = byName(kps, `${side}_shoulder`, MIN_PRECISE_KP_SCORE)
    const preciseElbow = byName(kps, `${side}_elbow`, MIN_PRECISE_KP_SCORE)
    const preciseWrist = byName(kps, `${side}_wrist`, MIN_PRECISE_KP_SCORE)
    const preciseHip = byName(kps, `${side}_hip`, MIN_PRECISE_KP_SCORE)

    // Averaged over the points actually found. Dividing by a fixed four
    // penalised clips where a wrist was hidden behind a parallette, which
    // then failed the confidence gate despite tracking everything else.
    const found = [shoulder, elbow, wrist, hip].filter(Boolean) as Kp[]
    confidences.push(found.reduce((t2, k) => t2 + (k.score ?? 0), 0) / found.length)

    // Side-view contract: grade the stable visible arm only. The rear arm is
    // normally occluded or stacked onto the same pixels; treating its model
    // guess as a second observation created confident false bend warnings.
    const farSide = side === 'left' ? 'right' : 'left'
    // Grade the stable visible arm, and use the far one only when the tracker
    // really resolved it as a separate limb rather than stacking a guess onto
    // the near one. When it did, the two are independent looks at the same
    // lockout, so they are *averaged*: a mean halves the landmark error, where
    // taking the worse of the two — as an earlier version did — systematically
    // biases toward "bent" and manufactures exactly the confident false warning
    // that made the far arm untrustworthy in the first place.
    const armBends: number[] = []
    let armObserved = false
    const bendOf = (s: Kp, e: Kp, w: Kp, h: Kp): number | undefined => {
      if (!unsignedElbow(profile)) return signedElbowBend(s, e, w, h, torso)
      // Upside down the trunk continues the arm, so the hips cannot say which
      // way the elbow bends: a plain angle, judged against a wider deadband.
      const angle = reliableJointAngle(s, e, w, torso)
      return angle === undefined ? undefined : 180 - angle
    }
    if (preciseShoulder && preciseElbow && preciseWrist && preciseHip) {
      const near = bendOf(preciseShoulder, preciseElbow, preciseWrist, preciseHip)
      if (near !== undefined) {
        armBends.push(near)
        armObserved = isObserved(preciseShoulder, preciseElbow, preciseWrist, preciseHip)
      }
    }
    if (armBends.length && sidesAreVisiblySeparate(kps, side, farSide, ['elbow', 'wrist'], torso)) {
      const farShoulder = byName(kps, `${farSide}_shoulder`, MIN_FAR_KP_SCORE)
      const farElbow = byName(kps, `${farSide}_elbow`, MIN_FAR_KP_SCORE)
      const farWrist = byName(kps, `${farSide}_wrist`, MIN_FAR_KP_SCORE)
      const farHip = byName(kps, `${farSide}_hip`, MIN_FAR_KP_SCORE)
      if (farShoulder && farElbow && farWrist && farHip) {
        const far = bendOf(farShoulder, farElbow, farWrist, farHip)
        if (far !== undefined) armBends.push(far)
      }
    }
    if (armBends.length === 2) armPairs.push({ t, near: armBends[0], far: armBends[1] })
    if (armBends.length) nearArm.set(t, armBends[0])
    let frameElbowDeg: number | undefined
    if (armBends.length) {
      // Keep the sign until the whole-hold aggregate is built. Clamping every
      // hyperextended/noisy sample to 180 here half-wave-rectifies otherwise
      // symmetric landmark error: away-from-hips error disappears while
      // toward-hips error survives as a bend. On an exactly straight arm that
      // bias was enough to manufacture a red fault in roughly 8% of noisy
      // clips. Athlete-facing output is still clamped to 180 below.
      //
      // One exception, for two arms only: when one arm reads a bend beyond
      // the measured deadband and the other reads past lockout, the two are
      // not noisy looks at one lockout — and a hyperextended arm cannot
      // numerically cancel a resolved bend in the other. That arm counts as
      // locked (0) instead of negative. Readings inside the deadband are
      // still averaged as-is, so symmetric noise keeps cancelling.
      const [first, second] = armBends
      const resolvedBendAgainstExtension =
        armBends.length === 2 &&
        Math.max(first, second) > elbowSlack(profile) &&
        Math.min(first, second) < 0
      const combined = resolvedBendAgainstExtension
        ? (Math.max(first, 0) + Math.max(second, 0)) / 2
        : armBends.reduce((a, b) => a + b, 0) / armBends.length
      const angle = 180 - combined
      push(elbows, angle)
      frameElbowDeg = angle
      elbowSeries.push({ t, v: angle })
    }

    // In a true side view, full/straddle footage can honestly grade only the
    // stable visible leg. One-leg work is the exception: the deliberately
    // extended leg may carry the opposite label, so identify it by visible
    // hip-to-ankle reach instead of assuming whichever leg looks straighter.
    const legReadings: SideViewLegReading[] = []
    const legSides = profile.oneLeg ? ([side, farSide] as const) : ([side] as const)
    for (const [index, s] of legSides.entries()) {
      const minScore = index === 0 ? MIN_PRECISE_KP_SCORE : MIN_FAR_KP_SCORE
      const h = byName(kps, `${s}_hip`, minScore)
      const k = byName(kps, `${s}_knee`, minScore)
      const a = byName(kps, `${s}_ankle`, minScore)
      const sh = byName(kps, `${s}_shoulder`, minScore)
      if (
        index > 0 &&
        !sidesAreVisiblySeparate(kps, side, farSide, ['hip', 'knee', 'ankle'], torso)
      ) continue
      const knee = h && k && a ? reliableJointAngle(h, k, a, torso) : undefined
      const hipAngle = sh && h && k ? reliableJointAngle(sh, h, k, torso) : undefined
      const extension = h && a ? Math.hypot(h.x - a.x, h.y - a.y) / torso : undefined
      if (knee !== undefined || hipAngle !== undefined) {
        legReadings.push({
          knee,
          hipAngle,
          extension,
          kneeObserved: isObserved(h, k, a),
          hipObserved: isObserved(sh, h, k),
        })
      }
    }
    const selectedLeg = selectSideViewLeg(legReadings, profile.oneLeg)
    const frameKneeDeg = selectedLeg?.knee
    const frameHipAngleDeg = selectedLeg?.hipAngle
    if (frameKneeDeg !== undefined) {
      push(knees, frameKneeDeg)
      kneeSeries.push({ t, v: frameKneeDeg })
    }
    if (frameHipAngleDeg !== undefined) {
      push(hipAngles, frameHipAngleDeg)
      hipAngleSeries.push({ t, v: frameHipAngleDeg })
    }

    // Screen y grows downward, so a hip above the shoulders is negative dy.
    // Shoulder and hip both pass the precision gate: a barely-visible hip
    // must not make a confident level-line call.
    const frameHipOffset =
      preciseShoulder && preciseHip
        ? (preciseShoulder.y - preciseHip.y) / torso
        : undefined
    if (frameHipOffset !== undefined) {
      hipOffsets.push(frameHipOffset)
      lineSeries.push({ t, v: frameHipOffset })
    }

    let frameLeanRatio: number | undefined
    if (preciseShoulder && preciseWrist && preciseHip) {
      // How far the shoulders sit past the hands, horizontally, over torso.
      //
      // Horizontally with respect to *gravity*, which is what actually makes a
      // planche hard: the moment the shoulders carry is the horizontal offset
      // from the hands, and nothing else. That makes this a screen-frame
      // measurement, and a screen-frame measurement inherits the camera's tilt.
      //
      // Measuring along the torso instead would shed the camera tilt, and it is
      // tempting for exactly that reason — but it trades a small unknown error
      // for a large known one. Real footage settles it: a plank filmed level
      // reads 0.13 here and 0.36 along the torso, because a body pitched
      // head-up projects its arm's whole vertical drop into the answer. The
      // shallower positions are the pitched ones *and* the ones with the
      // loosest line tolerance, so the torso frame is worst exactly where it
      // would be relied on most. Camera roll stays the smaller error, and
      // MATERIAL_TOLERANCE.leanRatio is what absorbs it.
      const facing = Math.sign(preciseShoulder.x - preciseHip.x) || 1
      const lean = ((preciseShoulder.x - preciseWrist.x) * facing) / torso
      push(leans, lean)
      if (Number.isFinite(lean)) {
        frameLeanRatio = lean
        leanSeries.push({ t, v: lean })
      }
    }
    // How open the shoulders are: the angle between the upper arm and the
    // trunk. Only where the position asks for it (a handstand's line).
    const frameShoulderDeg =
      profile.minShoulderDeg !== undefined && preciseElbow && preciseShoulder && preciseHip
        ? shoulderOpeningDeg(preciseElbow, preciseShoulder, preciseHip, torso)
        : undefined
    if (frameShoulderDeg !== undefined) push(shoulderAngles, frameShoulderDeg)

    // Ear only — the nose sits much further from the shoulder, so falling
    // back to it against the same threshold always reads as "not shrugged".
    const preciseEar = byName(kps, `${side}_ear`, MIN_PRECISE_KP_SCORE)
    const frameShrugRatio = preciseEar && preciseShoulder
      ? Math.hypot(preciseShoulder.x - preciseEar.x, preciseShoulder.y - preciseEar.y) / torso
      : undefined
    if (frameShrugRatio !== undefined) push(shrugs, frameShrugRatio)

    frameObserved.set(t, {
      elbowDeg: frameElbowDeg !== undefined && armObserved,
      kneeDeg: frameKneeDeg !== undefined && selectedLeg?.kneeObserved === true,
      hipAngleDeg: frameHipAngleDeg !== undefined && selectedLeg?.hipObserved === true,
      hipOffset: frameHipOffset !== undefined && isObserved(preciseShoulder, preciseHip),
      leanRatio: frameLeanRatio !== undefined && isObserved(preciseShoulder, preciseWrist, preciseHip),
      shrugRatio: frameShrugRatio !== undefined && isObserved(preciseEar, preciseShoulder),
      shoulderDeg: frameShoulderDeg !== undefined && isObserved(preciseElbow, preciseShoulder, preciseHip),
    })
    frameReadings.push({
      t,
      elbowDeg: frameElbowDeg,
      kneeDeg: frameKneeDeg,
      hipAngleDeg: frameHipAngleDeg,
      hipOffset: frameHipOffset,
      leanRatio: frameLeanRatio,
      shrugRatio: frameShrugRatio,
      ...(frameShoulderDeg !== undefined ? { shoulderDeg: frameShoulderDeg } : {}),
    })

    // Where the shoulders and hips sit *relative to the hands*. In a planche
    // the hands are planted, so measuring against the wrist cancels the
    // camera's own movement. Kept as positions, not as frame-to-frame speed:
    // a speed divides wrist jitter by a third of a second and amplifies it.
    const handRef = preciseWrist && !preciseWrist.origin ? preciseWrist : undefined
    if (handRef && t <= (creditedHoldSec ?? Infinity) + 0.05) {
      handRelative.push({
        sx: shoulder.x - handRef.x,
        sy: shoulder.y - handRef.y,
        hx: hip.x - handRef.x,
        hy: hip.y - handRef.y,
        torso,
      })
    }
  }

  // ——— Two resolved arms that read differently ———
  //
  // Averaging two looks at one lockout halves the landmark error, which is why
  // it is the default. But two arms that disagree by a wide, consistent margin
  // are not one lockout. A bent near arm — the limb the camera sees best — is
  // graded on its own rather than diluted by a straight-reading far arm. A
  // far arm that alone reads bent is the opposite case: averaging would turn
  // it into a certified straight hold, and convicting on the least-seen limb
  // is no better, so unless the average already names the bend, the elbows
  // go unjudged.
  let farArmContradicts = false
  let nearArmOnly = false
  if (
    profile.minElbowDeg !== undefined &&
    !coarseElbow(profile) &&
    armPairs.length >= Math.max(MIN_FRAMES, Math.ceil(confidences.length * 0.55))
  ) {
    const nearMedian = median(armPairs.map((pair) => pair.near))!
    const farMedian = median(armPairs.map((pair) => pair.far))!
    if (nearMedian - farMedian >= ARM_DISAGREEMENT_DEG && nearMedian > MATERIAL_TOLERANCE.elbowDeg) {
      nearArmOnly = true
      for (const frame of frameReadings) {
        const near = nearArm.get(frame.t)
        if (near !== undefined && frame.elbowDeg !== undefined) frame.elbowDeg = 180 - near
      }
    } else if (
      farMedian - nearMedian >= ARM_DISAGREEMENT_DEG &&
      farMedian > MATERIAL_TOLERANCE.elbowDeg + SOFTENING_MARGIN_DEG
    ) {
      farArmContradicts = true
    }
  }

  const glitchStats = suppressIsolatedMetricSpikes(frameReadings)
  // Rebuild every aggregate from the cleaned readings. Leaving the raw
  // arrays in place would remove a jump from clean-time but still let that
  // same bad landmark create a headline fault.
  elbows.length = 0
  knees.length = 0
  hipAngles.length = 0
  hipOffsets.length = 0
  leans.length = 0
  shrugs.length = 0
  shoulderAngles.length = 0
  tilts.length = 0
  elbowSeries.length = 0
  kneeSeries.length = 0
  hipAngleSeries.length = 0
  lineSeries.length = 0
  leanSeries.length = 0
  for (const frame of frameReadings) {
    if (frame.elbowDeg !== undefined) {
      push(elbows, frame.elbowDeg)
      elbowSeries.push({ t: frame.t, v: frame.elbowDeg })
    }
    if (frame.kneeDeg !== undefined) {
      push(knees, frame.kneeDeg)
      kneeSeries.push({ t: frame.t, v: frame.kneeDeg })
    }
    if (frame.hipAngleDeg !== undefined) {
      push(hipAngles, frame.hipAngleDeg)
      hipAngleSeries.push({ t: frame.t, v: frame.hipAngleDeg })
    }
    if (frame.hipOffset !== undefined) {
      push(hipOffsets, frame.hipOffset)
      lineSeries.push({ t: frame.t, v: frame.hipOffset })
    }
    if (frame.leanRatio !== undefined) {
      push(leans, frame.leanRatio)
      leanSeries.push({ t: frame.t, v: frame.leanRatio })
    }
    if (frame.shrugRatio !== undefined) push(shrugs, frame.shrugRatio)
    if (frame.shoulderDeg !== undefined) push(shoulderAngles, frame.shoulderDeg)
    if (frame.tiltDeg !== undefined) push(tilts, frame.tiltDeg)
  }

  const framesUsed = confidences.length
  // Checked first: front-on moments are no longer measured at all, so a
  // front-on clip would otherwise surface as "not enough of you in frame" —
  // true, but it sends the athlete to fix distance instead of the angle.
  if (
    orientationFrames >= MIN_FRAMES &&
    nonSideFrames / orientationFrames > 0.5
  ) {
    return {
      ...empty,
      framesUsed,
      framesSampled: n,
      track,
      reason: obliqueFrames > nonSideFrames / 2 ? FLAG_OBLIQUE_VIEW : copy.wrongView,
    }
  }
  if (framesUsed < MIN_FRAMES) {
    // Name what the camera actually found. "Could not track your body" gave
    // no clue whether the fix was moving the phone, turning it, or the light.
    const seen = [...regionsSeen]
    const reason =
      posesSeen === 0
        ? `No body was found in this clip at all. Move the phone back until your whole body — hands to feet — fits in the frame, and film ${copy.from}.`
        : seen.length
          ? `Only your ${listPhrase(seen)} stayed in frame. ${copy.fitInFrame}`
          : `Could not track your body reliably. Film ${copy.view}, whole body in frame, with the light in front of you rather than behind.`
    return { ...empty, framesUsed, framesSampled: n, reason, track }
  }

  const confidence = confidences.reduce((a, b) => a + b, 0) / framesUsed
  // The two cleaners operate at different layers (landmarks and derived
  // metrics), so use the conservative upper bound rather than adding them
  // and double-counting the same bad sample.
  const instabilityCount = Math.max(keypointStats.framesTouched, glitchStats.framesTouched)
  if (instabilityCount >= Math.max(3, Math.ceil(frameReadings.length * 0.3))) {
    return {
      ...empty,
      framesUsed,
      framesSampled: n,
      confidence,
      track,
      reason: `Tracking jumped between different body shapes too often to judge this clip reliably. Check the skeleton replay, then try brighter light, more distance, and a clear ${copy.viewNoun}.`,
    }
  }
  // A criterion is graded when it was observable for a majority of tracked
  // frames. Anything short of that is reported as *unseen* rather than
  // failing the whole clip: a knee out of frame should cost you the knee
  // verdict, not the elbow, hip and lean verdicts alongside it. What stays
  // non-negotiable is that thin coverage never reads as a silent pass.
  // Persistence is "roughly a second" in time, not a fixed number of samples:
  // at sparse spacing three samples would demand far longer than a second.
  const creditedWindow =
    creditedHoldSec !== undefined && Number.isFinite(creditedHoldSec) && creditedHoldSec > 0
      ? Math.min(duration, creditedHoldSec)
      : duration
  const samplingGapSec = widestSamplingGap(times, creditedWindow)
  const minBadSamples = minimumBadSamplesFor(samplingGapSec)
  const wholeClipElbow = sustainedTypical(elbows)
  const elbowIqr = interquartileSpread(elbows)
  const strongElbowRun =
    profile.minElbowDeg !== undefined &&
    sustainedMaterialIssues(
      frameReadings.map((frame) => ({
        t: frame.t,
        issues:
          frame.elbowDeg !== undefined &&
          frame.elbowDeg < profile.minElbowDeg! - elbowSlack(profile, MOMENTARY_MATERIAL_TOLERANCE)
            ? (['arms'] as FormIssue[])
            : [],
      })),
      minBadSamples,
    ).includes('arms')
  // A borderline bent-looking centre plus a wide signed-angle spread is not a
  // trustworthy accusation. This is the exact failure shape produced when a
  // straight elbow's landmarks drift coherently to one side of the arm chord:
  // the aggregate clears 8°, but no moment clears the independent 16° bar.
  // Preserve the strict static-bend check and gross breakdown check; only the
  // contradictory criterion becomes unseen.
  const elbowTrackingUncertain =
    profile.minElbowDeg !== undefined &&
    // Only where the elbow is read finely: a coarse posture's spread is
    // expected, and its wider deadband already absorbs it.
    !coarseElbow(profile) &&
    wholeClipElbow !== undefined &&
    wholeClipElbow < profile.minElbowDeg - MATERIAL_TOLERANCE.elbowDeg &&
    elbowIqr !== undefined &&
    elbowIqr > MAX_STABLE_ELBOW_IQR_DEG &&
    !strongElbowRun
  // Only the far arm reads bent and the average would pass the hold.
  const farArmUnjudged =
    farArmContradicts &&
    profile.minElbowDeg !== undefined &&
    wholeClipElbow !== undefined &&
    wholeClipElbow >= profile.minElbowDeg - MATERIAL_TOLERANCE.elbowDeg &&
    !strongElbowRun

  // Coverage may lean on filled-in points only while they are the minority.
  // An isolated dropout bridged from neighbours a third of a second either
  // side is good evidence — the robustness evals depend on it — but a
  // criterion resting mostly on filled points is continuity for the replay,
  // not observation, and then only what the camera actually saw counts.
  const observedCount = (key: ReadingMetric) => {
    const present = frameReadings.filter((frame) => frame[key] !== undefined)
    const observed = present.filter((frame) => frameObserved.get(frame.t)?.[key] === true).length
    return present.length - observed > observed ? observed : present.length
  }
  const { judged, unseen } = gradeCoverage(
    profile,
    {
      elbows: elbowTrackingUncertain || farArmUnjudged ? 0 : observedCount('elbowDeg'),
      knees: observedCount('kneeDeg'),
      hipAngles: observedCount('hipAngleDeg'),
      hipOffsets: observedCount('hipOffset'),
      leans: observedCount('leanRatio'),
      shrugs: observedCount('shrugRatio'),
      shoulders: observedCount('shoulderDeg'),
      tilts: observedCount('tiltDeg'),
    },
    framesUsed,
  )
  const filledReadings = frameReadings.reduce(
    (total, frame) =>
      total +
      (
        ['elbowDeg', 'kneeDeg', 'hipAngleDeg', 'hipOffset', 'leanRatio', 'shrugRatio', 'shoulderDeg', 'tiltDeg'] as ReadingMetric[]
      ).filter(
        (key) => frame[key] !== undefined && frameObserved.get(frame.t)?.[key] !== true,
      ).length,
    0,
  )

  // Only a total blackout is unjudgeable. With nothing graded there is no
  // verdict to give, so this stays a refusal rather than a hollow "clean".
  if (!Object.values(judged).some(Boolean)) {
    return {
      ...empty,
      framesUsed,
      framesSampled: n,
      confidence,
      unseen,
      track,
      reason: `Could not see your ${listPhrase(unseen)} well enough to judge anything here. Keep your whole body and both hands in frame, ${copy.view}.`,
    }
  }

  // The filmed part of the credited hold — everything below is measured over it.
  const creditedSeconds =
    creditedHoldSec !== undefined && Number.isFinite(creditedHoldSec) && creditedHoldSec > 0
      ? Math.min(duration, creditedHoldSec)
      : duration
  // What the recording never reached is unknown: not clean, not a breakdown.
  const unfilmedSeconds =
    creditedHoldSec !== undefined && Number.isFinite(creditedHoldSec) ? Math.max(0, creditedHoldSec - creditedSeconds) : 0
  const unfilmedSec = unfilmedSeconds > UNFILMED_DISCLOSURE_SEC ? Math.round(unfilmedSeconds * 10) / 10 : undefined
  const readingAt = new Map(frameReadings.map((frame) => [frame.t, frame]))
  const envelopeSamples = times.map((t) => {
    const frame = readingAt.get(t)
    return {
      t,
      bad: frame ? materiallyOutsideEnvelope(frame, profile, judged) : null,
    }
  })
  const observableEnvelope = envelopeSamples.map((sample) => ({
    t: sample.t,
    bad: sample.bad !== false,
  }))
  // Keep the exact sampled start for selecting verdict frames. The public
  // clean-time number is rounded to a tenth for display; using that rounded
  // value as a cutoff could round the first bad frame back into the supposedly
  // clean window and let one criterion manufacture a fault in another.
  const envelopeCutoff = sustainedBreakdownStart(observableEnvelope, creditedSeconds, minBadSamples)
  // A late softening the momentary envelope is too coarse to see ends clean
  // time where it starts; the seconds before it stay verified.
  const softeningAt =
    judged.elbow && profile.minElbowDeg !== undefined && !coarseElbow(profile)
      ? sustainedSofteningStart(frameReadings, profile.minElbowDeg, creditedSeconds)
      : null
  const cleanCutoffSeconds = softeningAt !== null ? Math.min(envelopeCutoff, softeningAt) : envelopeCutoff
  const cleanSeconds = Math.round(cleanCutoffSeconds * 10) / 10
  // The share of the verified window the camera actually saw in full: of the
  // moments requested before clean time ended, those that carried every
  // criterion it judged. A run of missing moments already ends clean time;
  // this catches the other shape — short gaps scattered through the hold,
  // each too brief to end it — under which 8 poses out of 31 requested could
  // certify every second. Measured over the window being certified, so a
  // hold that turns front-on halfway still keeps the half that was seen.
  const windowSamples = envelopeSamples.filter((sample) => sample.t <= cleanCutoffSeconds + 0.05)
  // Too short a window to say anything about: nothing is certified there anyway.
  const coverage =
    windowSamples.length >= MIN_FRAMES
      ? windowSamples.filter((sample) => sample.bad !== null).length / windowSamples.length
      : undefined
  const cleanRatio = creditedSeconds > 0 ? Math.min(1, cleanSeconds / creditedSeconds) : 0
  const sustainedFaults = new Set(
    sustainedMaterialIssues(
      times
        .filter((t) => t <= creditedSeconds + 0.05)
        .map((t) => ({
          t,
          issues: readingAt.has(t)
            ? materialIssuesForReading(
                readingAt.get(t)!,
                profile,
                judged,
                MOMENTARY_MATERIAL_TOLERANCE,
              )
            : [],
        })),
      minBadSamples,
    ),
  )
  if (softeningAt !== null && softeningAt + 0.05 < creditedSeconds) sustainedFaults.add('arms')

  // Judge the hold, not the dismount.
  //
  // Coming out of a planche is a controlled collapse: the arms bend, the hips
  // drop, the body folds. Those frames were being averaged into the verdict
  // alongside the hold itself, so a set held perfectly for twelve seconds
  // came back "elbows bent, hips sagging" — describing the exit, which is not
  // a form fault at all. The verdict now covers the sustained-clean portion,
  // and the breakdown is reported separately as the point where it ended.
  const brokeDown = cleanCutoffSeconds + 0.05 < creditedSeconds
  const cutoff = brokeDown ? cleanCutoffSeconds : creditedSeconds
  // A clean hold owns its final sampled moment. The strict `<` comparison used
  // for a real breakdown was also dropping the endpoint of every fully clean
  // clip; on an even sample count, losing that one observation can move the
  // median across the elbow threshold. Keep excluding the first bad moment
  // after a breakdown, but retain the credited endpoint otherwise.
  const withinHold = frameReadings.filter((f) =>
    brokeDown ? f.t < cutoff : f.t <= cutoff + 0.05,
  )
  const candidateVerdictFrames = withinHold.length >= MIN_FRAMES ? withinHold : frameReadings
  const verdictFrames = trimTerminalDismountFrames(candidateVerdictFrames, creditedSeconds)
  const exitFramesDropped = frameReadings.length - verdictFrames.length

  const pick = <K extends keyof FrameReading>(key: K): number[] =>
    verdictFrames.map((f) => f[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const heldElbows = pick('elbowDeg')
  const heldKnees = pick('kneeDeg')
  const heldHipAngles = pick('hipAngleDeg')

  // Every metric falls back to the whole clip when the narrowed window has
  // nothing for it. Coverage was judged over the full clip, so a criterion
  // that is graded must produce a number: leaving it undefined here would
  // drop its check silently and an all-undefined verdict reads as "clean".
  const elbowPeak = heldElbows.length ? Math.max(...heldElbows) : elbows.length ? Math.max(...elbows) : undefined
  const kneePeak = heldKnees.length ? Math.max(...heldKnees) : knees.length ? Math.max(...knees) : undefined
  const hipAnglePeak = heldHipAngles.length
    ? Math.max(...heldHipAngles)
    : hipAngles.length
      ? Math.max(...hipAngles)
      : undefined
  // Headline angles describe the typical held shape. Sustained bad runs
  // already cap clean time above; using the old lower quartile here let a
  // minority of plausible-looking detector errors create a red form flag.
  const elbowDeg = sustainedTypical(heldElbows) ?? sustainedTypical(elbows)
  const kneeDeg = sustainedTypical(heldKnees) ?? sustainedTypical(knees)
  const hipAngleDeg = sustainedTypical(heldHipAngles) ?? sustainedTypical(hipAngles)
  const hipOffset = median(pick('hipOffset')) ?? median(hipOffsets)
  const leanRatio = median(pick('leanRatio')) ?? median(leans)
  const shrugRatio = median(pick('shrugRatio')) ?? median(shrugs)
  const shoulderDeg = sustainedTypical(pick('shoulderDeg')) ?? sustainedTypical(shoulderAngles)
  const tiltDeg = median(pick('tiltDeg')) ?? median(tilts)
  // Steadiness: the robust spread of the body's position against the planted
  // hands, over torso length. Replayed on the audit's real footage - one hold
  // re-framed fixed, panning and oscillating - the old picture-frame speed read
  // 0.048 / 0.077 / 0.238 for identical body motion; this reads 0.020 / 0.023
  // / 0.022, while a genuine lowering reads 0.104 and synthetic sway 0.043. A
  // still hold at measured landmark noise sits near 0.02. It describes how much
  // the body moved, never why.
  const drift = robustPositionSpread(handRelative)

  // Median of the first and final thirds of the sampled window, for the
  // "clean early, broke down late" comparisons. Needs a hold long enough to
  // have thirds worth talking about.
  const thirds = (xs: { t: number; v: number }[]) => {
    if (xs.length < 6) return null
    const t1 = from + (to - from) / 3
    const t2 = from + (2 * (to - from)) / 3
    const early = xs.filter((p) => p.t <= t1).map((p) => p.v)
    const late = xs.filter((p) => p.t >= t2).map((p) => p.v)
    const e = median(early)
    const l = median(late)
    return e !== undefined && l !== undefined ? { early: e, late: l } : null
  }

  if (confidence < 0.35) {
    return {
      ...empty,
      framesUsed,
      framesSampled: n,
      confidence,
      elbowDeg,
      kneeDeg,
      hipAngleDeg,
      hipOffset,
      leanRatio,
      shrugRatio,
      track,
      reason: 'Tracking confidence was too low to judge form from this clip.',
    }
  }

  const issues: FormIssue[] = []
  const notes: string[] = []
  const good: string[] = []
  const details: string[] = []
  const aggregateFaults = new Set(
    materialIssuesForReading(
      { t: 0, elbowDeg, kneeDeg, hipAngleDeg, hipOffset, leanRatio, shrugRatio, shoulderDeg, tiltDeg },
      profile,
      judged,
    ),
  )
  const namedFaults = new Set([...aggregateFaults, ...sustainedFaults])
  const creditedReadings = trimTerminalDismountFrames(
    frameReadings.filter((frame) => frame.t <= creditedSeconds + 0.05),
    creditedSeconds,
  )
  const faultMetric = (issue: FormIssue, key: Exclude<keyof FrameReading, 't'>): number | undefined => {
    const values = creditedReadings
      .filter((frame) => materialIssuesForReading(frame, profile, judged).includes(issue))
      .map((frame) => frame[key])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    return key.endsWith('Deg') ? sustainedTypical(values) : median(values)
  }

  // When a fault appeared after an initially clean position, expose the
  // sustained faulty measurement rather than returning a pristine pre-fault
  // median next to a red issue label.
  const rawReportedElbowDeg = namedFaults.has('arms')
    ? faultMetric('arms', 'elbowDeg') ?? elbowDeg
    : namedFaults.has('angle')
      ? faultMetric('angle', 'elbowDeg') ?? elbowDeg
      : elbowDeg
  const reportedElbowDeg = rawReportedElbowDeg === undefined ? undefined : Math.min(180, rawReportedElbowDeg)
  const displayedElbowPeak = elbowPeak === undefined ? undefined : Math.min(180, elbowPeak)
  const reportedKneeDeg = namedFaults.has('knees') ? faultMetric('knees', 'kneeDeg') ?? kneeDeg : kneeDeg
  const reportedHipAngleDeg = namedFaults.has('closed')
    ? faultMetric('closed', 'hipAngleDeg') ?? hipAngleDeg
    : hipAngleDeg
  const reportedHipOffset = namedFaults.has('pike')
    ? faultMetric('pike', 'hipOffset') ?? hipOffset
    : namedFaults.has('sag')
      ? faultMetric('sag', 'hipOffset') ?? hipOffset
      : hipOffset
  const reportedLeanRatio = namedFaults.has('lean') ? faultMetric('lean', 'leanRatio') ?? leanRatio : leanRatio
  const reportedShrugRatio = namedFaults.has('shrug')
    ? faultMetric('shrug', 'shrugRatio') ?? shrugRatio
    : shrugRatio
  const reportedShoulderDeg = namedFaults.has('shoulders') ? faultMetric('shoulders', 'shoulderDeg') ?? shoulderDeg : shoulderDeg
  const reportedTiltDeg = namedFaults.has('tilt') ? faultMetric('tilt', 'tiltDeg') ?? tiltDeg : tiltDeg

  if (judged.elbow && profile.minElbowDeg !== undefined && reportedElbowDeg !== undefined) {
    if (namedFaults.has('arms')) {
      issues.push('arms')
      notes.push(
        coarseElbow(profile)
          ? `Elbows read about ${Math.round(reportedElbowDeg)}° — past anything a straight arm reads ${copy.from} (${Math.round(profile.minElbowDeg - elbowSlack(profile))}° and up), so this is a real bend: ${copy.softElbows}.`
          : sustainedFaults.has('arms') && !aggregateFaults.has('arms')
          ? `Elbows softened to about ${Math.round(reportedElbowDeg)}° for a sustained part of the hold — ${copy.softElbows}.`
          : elbowPeak !== undefined && elbowPeak >= profile.minElbowDeg - elbowSlack(profile)
            ? `Elbows locked at their best (${Math.round(displayedElbowPeak!)}°) but sat nearer ${Math.round(reportedElbowDeg)}° for much of the hold — keep the lock the whole way.`
            : `Elbows reached about ${Math.round(displayedElbowPeak ?? reportedElbowDeg)}° at their straightest — locked reads near 180°.`,
      )
    } else {
      // Two different good outcomes, and conflating them would overclaim.
      // Inside half the tolerance the arm is locked and can be said to be;
      // between there and the tolerance a bend was measured but is too small
      // for the camera to stand behind.
      good.push(
        coarseElbow(profile)
          ? 'No elbow bend the camera could call'
          : reportedElbowDeg >= profile.minElbowDeg - elbowSlack(profile) / 2
            ? `Elbows locked (${Math.round(reportedElbowDeg)}°)`
            : `No reliable elbow bend detected (${Math.round(reportedElbowDeg)}°)`,
      )
      if (coarseElbow(profile)) {
        details.push(
          `${copy.viewNoun[0].toUpperCase()}${copy.viewNoun.slice(1)} elbows here are read coarsely: the camera only calls a bend past about ${Math.round(elbowSlack(profile))}°, because a straight arm in this position already reads short of 180° through the model. A small bend is yours to check on the replay.`,
        )
      }
    }
  }

  if (judged.elbow && profile.elbowTargetDeg !== undefined && reportedElbowDeg !== undefined) {
    const target = profile.elbowTargetDeg
    if (namedFaults.has('angle')) {
      issues.push('angle')
      notes.push(
        reportedElbowDeg > target
          ? `Elbows sat near ${Math.round(reportedElbowDeg)}° — more open than the ${target}° this hold is defined by. Opening toward straight turns it into a different, straight-arm position.`
          : `Elbows sat near ${Math.round(reportedElbowDeg)}° — more closed than ${target}°, which lets the body sink toward the arms.`,
      )
    } else {
      good.push(
        Math.abs(reportedElbowDeg - target) <= (profile.elbowBandDeg ?? 0)
          ? `Elbows near ${target}° (${Math.round(reportedElbowDeg)}°)`
          : `Elbow angle within camera tolerance (${Math.round(reportedElbowDeg)}°)`,
      )
    }
  }

  if (judged.knee && profile.minKneeDeg !== undefined && reportedKneeDeg !== undefined) {
    if (namedFaults.has('knees')) {
      issues.push('knees')
      notes.push(
        sustainedFaults.has('knees') && !aggregateFaults.has('knees')
          ? `Knee extension softened to about ${Math.round(reportedKneeDeg)}° for a sustained part of the hold.`
          : kneePeak !== undefined && kneePeak - reportedKneeDeg >= 4
            ? `Knees reached about ${Math.round(kneePeak)}° at their straightest but sat nearer ${Math.round(reportedKneeDeg)}° for much of the hold — squeeze the quads and keep them locked.`
            : `Knees sat near ${Math.round(reportedKneeDeg)}° through the hold — straight legs read near 180°.`,
      )
    } else {
      good.push(
        reportedKneeDeg >= profile.minKneeDeg
          ? `Legs straight (${Math.round(reportedKneeDeg)}°)`
          : `Legs within camera tolerance (${Math.round(reportedKneeDeg)}°)`,
      )
    }
  }

  if (judged.hipAngle && profile.minHipAngleDeg !== undefined && reportedHipAngleDeg !== undefined) {
    if (namedFaults.has('closed')) {
      // Its own issue, not "hips too high": a closed hip angle means the
      // body is still folded, which is the opposite complaint.
      issues.push('closed')
      notes.push(
        posture === 'inverted' || posture === 'flag'
          ? // A plain angle: upside down or seen from the front, an arch and a
            // fold read the same, so the note names the break and not its direction.
            `The line broke at the ${posture === 'flag' ? 'waist' : 'hips'} — about ${Math.round(reportedHipAngleDeg)}°, where a straight body reads close to 180°. The camera cannot tell ${posture === 'flag' ? 'a fold from a twist' : 'an arch from a pike'} from this view; the replay will show which.`
          : sustainedFaults.has('closed') && !aggregateFaults.has('closed')
          ? `The hip angle closed to about ${Math.round(reportedHipAngleDeg)}° for a sustained part of the hold.`
          : hipAnglePeak !== undefined && hipAnglePeak - reportedHipAngleDeg >= 4
            ? `Hips opened to about ${Math.round(hipAnglePeak)}° at their best but sat nearer ${Math.round(reportedHipAngleDeg)}° for much of the hold — this position wants ${profile.minHipAngleDeg}°+ held, not visited.`
            : `Hips were only about ${Math.round(reportedHipAngleDeg)}° open — this position wants closer to ${profile.minHipAngleDeg}°.`,
      )
    } else {
      good.push(
        posture === 'inverted' || posture === 'flag'
          ? `Straight through the ${posture === 'flag' ? 'waist' : 'hips'} (${Math.round(reportedHipAngleDeg)}°)`
          : reportedHipAngleDeg >= profile.minHipAngleDeg
            ? `Hips open (${Math.round(reportedHipAngleDeg)}°)`
            : `Hip angle within camera tolerance (${Math.round(reportedHipAngleDeg)}°)`,
      )
    }
  }

  if (judged.line && profile.levelTolerance !== undefined && reportedHipOffset !== undefined) {
    if (namedFaults.has('pike')) {
      issues.push('pike')
      notes.push('Hips sat above your shoulders — that reads as a pike rather than a flat line.')
    } else if (namedFaults.has('sag')) {
      issues.push('sag')
      notes.push('Hips dropped below your shoulders — the line was sagging.')
    } else {
      good.push(
        Math.abs(reportedHipOffset) <= profile.levelTolerance
          ? 'Hips and shoulders level'
          : 'Hip height within camera tolerance',
      )
    }
  }

  if (judged.lean && profile.minLeanRatio !== undefined && reportedLeanRatio !== undefined) {
    if (namedFaults.has('lean')) {
      issues.push('lean')
      notes.push(
        'Your shoulders stayed close to your hands — lean further forward until they pass your hands. That lean is what puts your weight over your hands; it makes the hold harder, which is the point.',
      )
    } else {
      good.push(reportedLeanRatio >= profile.minLeanRatio ? 'Good forward lean' : 'Lean within camera tolerance')
    }
  }

  if (judged.shrug && profile.checkShrug && reportedShrugRatio !== undefined) {
    if (namedFaults.has('shrug')) {
      issues.push('shrug')
      notes.push('Your shoulders looked shrugged up toward your ears — push the floor away and keep them down.')
    } else {
      good.push(
        reportedShrugRatio >= SHRUG_MIN_RATIO ? 'Shoulders down, not shrugged' : 'No clear shrug detected',
      )
    }
  }

  if (judged.shoulder && profile.minShoulderDeg !== undefined && reportedShoulderDeg !== undefined) {
    if (namedFaults.has('shoulders')) {
      issues.push('shoulders')
      notes.push(
        `Shoulders were about ${Math.round(reportedShoulderDeg)}° open — in a straight line the arms continue the body, close to 180°. Push tall and bring the chest through the arms.`,
      )
    } else {
      good.push(
        reportedShoulderDeg >= profile.minShoulderDeg
          ? `Shoulders open (${Math.round(reportedShoulderDeg)}°)`
          : `Shoulder opening within camera tolerance (${Math.round(reportedShoulderDeg)}°)`,
      )
    }
  }

  if (judged.tilt && profile.maxTiltDeg !== undefined && reportedTiltDeg !== undefined) {
    if (namedFaults.has('tilt')) {
      issues.push('tilt')
      notes.push(
        `The body sat about ${Math.round(reportedTiltDeg)}° off level — this position is held level out from the pole.`,
      )
    } else {
      good.push(
        reportedTiltDeg <= profile.maxTiltDeg
          ? `Level (${Math.round(reportedTiltDeg)}° off)`
          : `Level within camera tolerance (${Math.round(reportedTiltDeg)}° off)`,
      )
    }
  }

  details.push(
    posture === 'flag'
      ? 'Front-view mode graded both arms and the line through the shoulders, hips and feet. It cannot see the body rolling toward or away from the camera.'
      : profile.oneLeg
        ? 'Side-view mode graded the stable visible-side arm and only treated a leg as extended when its full reach was visible.'
        : 'Side-view mode graded the stable visible-side arm, leg and hip height; overlapped rear-side landmarks were not treated as separate evidence.',
  )

  // Said as what was measured — movement of the body against the hands — and
  // never as a cause. Drift cannot tell fatigue from a deliberate adjustment
  // or from the tracker wandering, and the old "it was slipping as you tired"
  // was a diagnosis the measurement could not support.
  if (drift !== undefined) {
    if (drift > DRIFT_MOVED) {
      details.push(
        'Shoulders and hips moved a fair amount relative to your hands during the hold. That is what was measured — not why: settling in, a small adjustment and the tracker wandering all read the same.',
      )
    } else if (drift <= DRIFT_STILL) {
      details.push('Shoulders and hips stayed very still relative to your hands.')
    }
  } else if (judged.elbow || judged.lean) {
    details.push('Steadiness was not measured: it needs your hands in view as the fixed reference.')
  }
  if (softeningAt !== null && softeningAt + 0.05 < creditedSeconds) {
    details.push(
      `The elbows held their lock until about ${softeningAt.toFixed(1)}s and then stayed softer for the rest of the hold — clean time ends there, and the seconds before it still count.`,
    )
  }
  if (nearArmOnly) {
    details.push(
      'The arm nearest the camera read bent while the far arm read straight, so the near arm — the one the camera sees best — was graded on its own instead of being averaged away.',
    )
  }
  if (farArmUnjudged) {
    details.push(
      'The far arm read bent while the near arm read straight. One camera cannot settle which is right, so straight arms were not judged rather than certified — film the other side once to check.',
    )
  }
  if (outOfFrameJoints > 0) {
    details.push(
      `Ignored ${outOfFrameJoints} joint ${outOfFrameJoints === 1 ? 'estimate' : 'estimates'} the model placed outside the picture — a joint the camera could not see is not evidence.`,
    )
  }
  if (coverage !== undefined && coverage < MIN_VERIFIED_COVERAGE) {
    details.push(
      `The camera saw the whole position in only ${Math.round(coverage * 100)}% of the moments it sampled across the hold, so clean time here is not camera-verified.`,
    )
  }

  // ——— Early vs late: did the shape survive the fatigue? ———
  // The headline note already explains a named fault, so its trend stays quiet
  // there. It must still set fadeSeen: otherwise an already-named hip or elbow
  // fault can worsen late and be followed by the contradictory claim that the
  // shape held up from start to finish.
  const elbowTrend = thirds(elbowSeries)
  const kneeTrend = thirds(kneeSeries)
  const hipAngleTrend = thirds(hipAngleSeries)
  const lineTrend = thirds(lineSeries)
  const leanTrend = thirds(leanSeries)
  let fadeSeen = false

  if (
    judged.elbow &&
    elbowTrend &&
    profile.minElbowDeg !== undefined &&
    elbowTrend.early - elbowTrend.late > 8 &&
    elbowTrend.late < profile.minElbowDeg - elbowSlack(profile)
  ) {
    fadeSeen = true
    if (!issues.includes('arms')) {
      details.push(
        `Elbow tracking softened late (${Math.round(elbowTrend.early)}° → ${Math.round(elbowTrend.late)}°), but was not turned into a form flag without a sustained fault.`,
      )
    }
  }
  if (
    judged.knee &&
    kneeTrend &&
    profile.minKneeDeg !== undefined &&
    kneeTrend.early - kneeTrend.late > kneeSlack(profile) &&
    kneeTrend.late < profile.minKneeDeg - kneeSlack(profile)
  ) {
    fadeSeen = true
    if (!issues.includes('knees')) {
      details.push(
        `Knee extension softened late (${Math.round(kneeTrend.early)}° → ${Math.round(kneeTrend.late)}°), but was not turned into a form flag without a sustained fault.`,
      )
    }
  }
  if (
    judged.hipAngle &&
    hipAngleTrend &&
    profile.minHipAngleDeg !== undefined &&
    hipAngleTrend.early - hipAngleTrend.late > MATERIAL_TOLERANCE.hipAngleDeg &&
    hipAngleTrend.late < profile.minHipAngleDeg - MATERIAL_TOLERANCE.hipAngleDeg
  ) {
    fadeSeen = true
    if (!issues.includes('closed')) {
      details.push(
        `Hip opening faded late (${Math.round(hipAngleTrend.early)}° → ${Math.round(hipAngleTrend.late)}°), but was not turned into a form flag without a sustained fault.`,
      )
    }
  }
  if (judged.line && lineTrend) {
    if (
      profile.levelTolerance !== undefined &&
      lineTrend.early - lineTrend.late > 0.18 &&
      lineTrend.late < -profile.levelTolerance - MATERIAL_TOLERANCE.lineRatio
    ) {
      fadeSeen = true
      if (!issues.includes('sag') && !issues.includes('pike')) {
        details.push('The tracked hip line dropped late, but was not turned into a form flag without a sustained fault.')
      }
    } else if (
      profile.levelTolerance !== undefined &&
      lineTrend.late - lineTrend.early > 0.18 &&
      lineTrend.late > profile.levelTolerance + MATERIAL_TOLERANCE.lineRatio
    ) {
      fadeSeen = true
      if (!issues.includes('sag') && !issues.includes('pike')) {
        details.push('The tracked hip line rose late, but was not turned into a form flag without a sustained fault.')
      }
    }
  }
  if (
    judged.lean &&
    leanTrend &&
    profile.minLeanRatio !== undefined &&
    leanTrend.early - leanTrend.late > 0.12 &&
    leanTrend.late < profile.minLeanRatio - MATERIAL_TOLERANCE.leanRatio
  ) {
    fadeSeen = true
    if (!issues.includes('lean')) {
      details.push('The tracked lean pulled back late, but was not turned into a form flag without a sustained fault.')
    }
  }
  if (!fadeSeen && holdWindow >= 8 && (elbowTrend || kneeTrend || hipAngleTrend || lineTrend || leanTrend)) {
    details.push('Shape held up through the whole hold — no visible fade from start to finish.')
  }
  // Compared unrounded: the shown number is rounded to a tenth, and a window
  // a few hundredths long used to round to 0.0 and read as a breakdown.
  if (cleanCutoffSeconds < creditedSeconds) {
    details.push(
      softeningAt !== null && softeningAt <= envelopeCutoff
        ? `The clean window ended near ${cleanSeconds.toFixed(1)}s, where the elbows began to stay soft.`
        : `The clean window ended near ${cleanSeconds.toFixed(1)}s after the position stayed outside the tolerant form envelope for roughly a second.`,
    )
    if (notes.length === 0) {
      const incompleteAfterCutoff = envelopeSamples.some(
        (sample) => sample.t >= cleanCutoffSeconds && sample.bad === null,
      )
      notes.push(
        incompleteAfterCutoff
          ? `The camera stopped seeing a complete held position near ${cleanSeconds.toFixed(1)}s. A quick drop or leaving the frame ends verified time even when no single joint fault can be named.`
          : `The position left the tolerant envelope near ${cleanSeconds.toFixed(1)}s, but no single correction was stable enough for the camera to name confidently.`,
      )
    }
  } else {
    details.push(
      unfilmedSec !== undefined
        ? 'No sustained material breakdown was found in the filmed part of the hold.'
        : 'No sustained material breakdown was found across the credited hold.',
    )
  }
  if (unfilmedSec !== undefined) {
    notes.push(
      `The recording stopped ${unfilmedSec.toFixed(1)}s before your hold ended, so only the first ${creditedSeconds.toFixed(1)}s was checked — the rest was not filmed and cannot count as camera-verified.`,
    )
  }
  if (frameTurned) {
    details.push(
      frameTurned === 'top'
        ? 'The picture was upside down, so it was turned the right way up before hip height and lean were measured.'
        : `The phone was on its side — the floor ran along the ${frameTurned} edge of the picture — so the picture was turned the right way up before hip height and lean were measured.`,
    )
  }
  if (glitchStats.metricsIgnored > 0) {
    details.push(
      `Ignored ${glitchStats.metricsIgnored} isolated tracking ${glitchStats.metricsIgnored === 1 ? 'jump' : 'jumps'} that disagreed with the frames around them.`,
    )
  }
  if (collisionStats.jointsIgnored > 0) {
    details.push(
      `Ignored ${collisionStats.jointsIgnored} duplicated far-side joint ${collisionStats.jointsIgnored === 1 ? 'point' : 'points'} that the tracker stacked onto the visible limb.`,
    )
  }
  if (keypointStats.jointsRepaired > 0) {
    details.push(
      `Stabilized ${keypointStats.jointsRepaired} isolated skeleton ${keypointStats.jointsRepaired === 1 ? 'jump' : 'jumps'} that immediately returned to the athlete.`,
    )
  }
  if (exitFramesDropped > 0) {
    details.push(
      `Graded on the ${verdictFrames.length} frames of the hold itself; the last ${exitFramesDropped} (coming out of the position) were left out.`,
    )
  }
  if (nonSideFrames > 0) {
    details.push(
      `${nonSideFrames} ${nonSideFrames === 1 ? 'moment was' : 'moments were'} not ${copy.view} enough to measure and counted as unverified, not as clean.`,
    )
  }
  if (viewUnknownFrames > framesUsed / 2) {
    details.push(`For most of the clip the camera could not confirm the ${copy.viewNoun} either way; the verdict assumes it from the near side alone.`)
  }
  if (input.decodeMisses) {
    details.push(
      `${input.decodeMisses} sampled ${input.decodeMisses === 1 ? 'moment' : 'moments'} could not be decoded on this device and counted as unverified.`,
    )
  }
  if (bridgedJoints > 0) {
    details.push(
      `Filled ${bridgedJoints} brief joint ${bridgedJoints === 1 ? 'dropout' : 'dropouts'} from the moments either side for the replay; ${
        filledReadings > 0 ? 'measurements resting on them did not count toward coverage' : 'none changed what was measured'
      }.`,
    )
  }
  if (samplingGapSec * minBadSamples > 1.2) {
    details.push(
      `Moments were sampled about every ${samplingGapSec.toFixed(1)}s across this long hold, so a loss of position shorter than about ${(
        samplingGapSec * minBadSamples
      ).toFixed(1)}s could fall between them.`,
    )
  }
  details.push(copy.unmeasured)
  details.push(
    `Tracked with ${backend.id === 'mediapipe' ? 'BlazePose (MediaPipe)' : 'MoveNet'}${
      rotation === 0 ? '' : `, reading the frame rotated ${rotation}° so your body sat upright to the model`
    }.`,
  )
  const outOfView =
    elbowTrackingUncertain || farArmUnjudged ? unseen.filter((criterion) => criterion !== 'elbows') : unseen
  if (outOfView.length) {
    // Said plainly rather than buried: a verdict that quietly skipped a
    // criterion would read as a clean bill of health for it.
    details.push(
      `Your ${listPhrase(outOfView)} stayed out of shot, so ${outOfView.length === 1 ? 'it was' : 'they were'} not part of this verdict.`,
    )
  }
  if (elbowTrackingUncertain) {
    details.push(
      'Elbow landmarks drifted too widely for a reliable straight-versus-bent call, so the camera left that criterion unjudged instead of guessing.',
    )
  }

  const uniqueIssues = [...new Set(issues)]
  const fix = pickFixFirst(uniqueIssues, posture)
  // Judged, but with a deadband wide enough to hide a real bend.
  const readCoarsely = coarseElbow(profile) && judged.elbow && profile.minElbowDeg !== undefined ? ['elbows'] : []
  // "Held clean" is the camera-verified share, never the raw envelope time:
  // a held arm fault means none of it was verified, and elbows the camera did
  // not judge — or a hold it mostly did not see — mean it does not know. The
  // raw `cleanRatio` stays on the result as the training-dose number.
  const verifiedCleanShare =
    aggregateFaults.has('arms') || aggregateFaults.has('angle')
      ? 0
      : (hasElbowCriterion(profile) && !judged.elbow) || (coverage !== undefined && coverage < MIN_VERIFIED_COVERAGE)
        ? undefined
        : cleanRatio
  const scored = computeFormScore({
    profile,
    judged,
    elbowDeg: reportedElbowDeg,
    kneeDeg: reportedKneeDeg,
    hipAngleDeg: reportedHipAngleDeg,
    hipOffset: reportedHipOffset,
    leanRatio: reportedLeanRatio,
    shrugRatio: reportedShrugRatio,
    shoulderDeg: reportedShoulderDeg,
    tiltDeg: reportedTiltDeg,
    drift,
    cleanRatio: verifiedCleanShare,
    armsNamed: namedFaults.has('arms'),
  })

  return {
    ok: true,
    confidence,
    framesUsed,
    framesSampled: n,
    ...(input.model ? { model: input.model } : {}),
    samplingGapSec: Math.round(samplingGapSec * 1000) / 1000,
    ...(scored ? { score: scored.score, subscores: scored.subscores } : {}),
    ...(fix ? { fixFirst: fix } : {}),
    ...(options.explain
      ? {
          explain: {
            judged,
            frames: frameReadings.map((frame) => ({ ...frame })),
            envelope: envelopeSamples.map(({ t, bad }) => ({
              t,
              bad,
              issues: readingAt.has(t)
                ? materialIssuesForReading(
                    readingAt.get(t)!,
                    profile,
                    judged,
                    MOMENTARY_MATERIAL_TOLERANCE,
                  )
                : [],
            })),
            aggregateFaults: [...aggregateFaults],
            sustainedFaults: [...sustainedFaults],
          },
        }
      : {}),
    track,
    cleanSeconds,
    cleanRatio,
    ...(coverage !== undefined ? { coverage: Math.round(coverage * 100) / 100 } : {}),
    ...(unfilmedSec !== undefined ? { unfilmedSec } : {}),
    elbowDeg: reportedElbowDeg,
    kneeDeg: reportedKneeDeg,
    hipAngleDeg: reportedHipAngleDeg,
    hipOffset: reportedHipOffset,
    leanRatio: reportedLeanRatio,
    shrugRatio: reportedShrugRatio,
    ...(reportedShoulderDeg !== undefined ? { shoulderDeg: reportedShoulderDeg } : {}),
    ...(reportedTiltDeg !== undefined ? { tiltDeg: reportedTiltDeg } : {}),
    ...(drift !== undefined ? { drift: Math.round(drift * 1000) / 1000 } : {}),
    issues: uniqueIssues,
    // Aggregate faults are computed from `verdictFrames`, which ends at the
    // first sustained breakdown. Keep them separate from the full issue list:
    // the latter deliberately includes the late fault so feedback can explain
    // why verified time stopped, but that late fault must not erase the clean
    // seconds that came before it.
    heldIssues: [...aggregateFaults],
    notes,
    good,
    details,
    unseen,
    ...(readCoarsely.length ? { coarse: readCoarsely } : {}),
    ...(frameTurned ? { frameTurned } : {}),
  }
}

/**
 * A verdict plus the detections it was built from.
 *
 * The poses are what make a filmed clip reusable: saved once, they replay
 * through `judgeTrackedFrames` forever without a camera, a model download or a
 * GPU, which is what lets real footage become a regression fixture.
 */
export interface ClipAnalysis {
  result: PoseFormResult
  /** Absent when the clip was refused before any pose was read. */
  poses?: JudgeInput
}

async function analyseClipNow(
  blob: Blob,
  exerciseId: string,
  sampleCount?: number,
  creditedHoldSec?: number,
  windowStartSec = 0,
): Promise<ClipAnalysis> {
  const empty = emptyResult()
  const profile = POSE_PROFILES[exerciseId]
  if (!profile) return { result: { ...empty, reason: 'This movement is not one the camera can assess.' } }
  if (profile.noChecks) {
    return {
      result: {
        ...empty,
        reason: noChecksReason(exerciseId, profile),
      },
    }
  }
  if (creditedHoldSec !== undefined && !hasVerifiableHoldDuration(creditedHoldSec)) {
    return {
      result: {
        ...empty,
        reason:
          'That attempt was too brief for the camera to verify a held position. Stay in the hold for at least 1 second — a quick touch-and-drop cannot be graded clean.',
      },
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

    const fullDuration = await resolveDuration(video)
    if (fullDuration === 0) return { result: { ...empty, reason: 'That clip has no readable duration.' } }
    // A hold timed from the video is analysed from its marked start; every
    // time below is relative to that start, and seeks add it back.
    const offset = Math.max(0, Math.min(windowStartSec, fullDuration))
    const duration = fullDuration - offset
    if (duration <= 0) return { result: { ...empty, reason: 'The marked hold starts after the clip ends.' } }

    // Analyse the credited hold, not the walk back to the phone after it. The
    // timer's value is intentionally the authority for where useful work ends.
    // Sample across nearly the whole credited hold. Three moments per second
    // gives the form judge enough context to distinguish a detector snap from
    // an actual loss of position; the cap keeps long foundation holds bounded.
    const holdWindow =
      creditedHoldSec !== undefined && Number.isFinite(creditedHoldSec) && creditedHoldSec > 0
        ? Math.min(duration, creditedHoldSec + 0.25)
        : duration
    const n = chooseSampleCount(holdWindow, sampleCount)
    const from = Math.min(holdWindow * 0.04, 0.15)
    const to = Math.max(from, holdWindow * 0.98)
    const times = Array.from({ length: n }, (_, i) =>
      n === 1 ? (from + to) / 2 : from + ((to - from) * i) / (n - 1),
    )

    const srcW = video.videoWidth
    const srcH = video.videoHeight
    const canvas = document.createElement('canvas')

    // Choose the model *and* the orientation from the actual footage, on two
    // probe frames from the middle of the hold. Neither choice can be made
    // sensibly in the abstract: which model copes with a given body, lighting
    // and camera angle is exactly what the probe measures.
    const probes = [times[Math.floor(times.length / 3)], times[Math.floor((2 * times.length) / 3)]].filter(
      (t): t is number => t !== undefined,
    )
    const detectAt = async (backend: PoseBackend, candidate: Rotation): Promise<Kp[]> => {
      if (!srcW || !srcH || !drawRotated(video, srcW, srcH, canvas, candidate)) return backend.estimate(video)
      const found = await backend.estimate(canvas)
      return unrotateKeypoints(found, candidate, srcW, srcH)
    }

    /** Best rotation for a backend, or null when no probe frame could be decoded. */
    const probeBackend = async (backend: PoseBackend) => {
      const totals = new Map<Rotation, number>()
      let decoded = 0
      for (const t of probes) {
        if ((await seekTo(video, offset + t)) !== 'ok') continue
        decoded++
        for (const candidate of [0, 90, 270] as Rotation[]) {
          totals.set(candidate, (totals.get(candidate) ?? 0) + trackingScore(await detectAt(backend, candidate)))
        }
      }
      if (!decoded) return null
      let best: { rotation: Rotation; score: number } = { rotation: 0, score: -1 }
      for (const [candidate, total] of totals) {
        const score = total / decoded
        // Ties keep the unrotated frame: rotating is only worth it when it
        // measurably helps.
        if (score > best.score + 1e-6) best = { rotation: candidate, score }
      }
      return best
    }

    // A detector that loaded fine can still fail on every call — a lost WebGL
    // context is the classic case — and the cached instance used to be reused
    // forever. A runtime failure retires that instance and the clip is tried
    // once more on the other model; a second failure says so plainly.
    const runtimeFailed = new Set<BackendId>()
    const loadErrors: unknown[] = []
    const noteRuntimeFailure = (backend: PoseBackend) => {
      runtimeFailed.add(backend.id)
      retireBackend(backend.id, backend)
    }
    const runtimeRefusal: ClipAnalysis = {
      result: {
        ...empty,
        reason:
          'The form checker hit a device error and was reset. Run the check again — if it keeps failing, close and reopen the app.',
      },
    }

    for (let pass = 0; pass < 2; pass++) {
      let chosen: { backend: PoseBackend; rotation: Rotation; score: number } | null = null
      for (const id of ['mediapipe', 'movenet'] as BackendId[]) {
        if (runtimeFailed.has(id)) continue
        // Only pay for the second model when the first one struggled — each is
        // a multi-megabyte download, and on good footage the first is right.
        if (chosen && chosen.score >= 0.55) break
        const backend = await getBackend(id).catch((err: unknown) => {
          loadErrors.push(err)
          return null
        })
        if (!backend) continue
        let probed: { rotation: Rotation; score: number } | null
        try {
          probed = await probeBackend(backend)
        } catch {
          noteRuntimeFailure(backend)
          continue
        }
        if (!probed) {
          return {
            result: {
              ...empty,
              reason:
                'This device could not decode frames from that clip, so nothing was judged. Your set is saved either way — try the check again.',
            },
          }
        }
        if (!chosen || probed.score > chosen.score) chosen = { backend, ...probed }
      }
      if (!chosen) {
        if (runtimeFailed.size) return runtimeRefusal
        throw loadErrors[0] instanceof Error ? loadErrors[0] : new Error('The pose model failed to load.')
      }

      // Pass one: capture what the model saw, frame by frame. Measuring happens
      // in judgeTrackedFrames so single-frame dropouts can be repaired first —
      // and so the entire verdict stays a pure function of these detections.
      const tracked: { t: number; kps: Kp[] }[] = []
      let decodeMisses = 0
      try {
        for (const t of times) {
          if ((await seekTo(video, offset + t)) !== 'ok') {
            decodeMisses++
            continue
          }
          const kps = await detectAt(chosen.backend, chosen.rotation)
          if (kps.length) tracked.push({ t, kps })
        }
      } catch {
        noteRuntimeFailure(chosen.backend)
        continue
      }
      if (decodeMisses > Math.max(4, Math.round(times.length * 0.4))) {
        return {
          result: {
            ...empty,
            reason: `This device could not decode enough of the clip to judge it (${decodeMisses} of ${times.length} moments could not be read). Your set is saved either way — try the check again.`,
          },
        }
      }

      const poses: JudgeInput = {
        tracked,
        times,
        width: srcW,
        height: srcH,
        duration,
        creditedHoldSec,
        from,
        to,
        holdWindow,
        backendId: chosen.backend.id,
        model: chosen.backend.model,
        rotation: chosen.rotation,
        ...(decodeMisses ? { decodeMisses } : {}),
        ...(offset > 0 ? { timeOffsetSec: Math.round(offset * 1000) / 1000 } : {}),
      }
      return { result: judgeTrackedFrames(poses, exerciseId), poses }
    }
    return runtimeRefusal
  } catch (err) {
    return { result: { ...empty, reason: err instanceof Error ? err.message : 'Analysis failed.' } }
  } finally {
    URL.revokeObjectURL(url)
    video.src = ''
  }
}

// Multiple skipped-rest clips can arrive together on the summary screen.
// MediaPipe and WebGL inference are not reliably re-entrant on Android
// WebViews, so run checks one at a time instead of letting several clips fight
// over the same detector and GPU context.
let analysisQueue: Promise<void> = Promise.resolve()
/** Checks queued or running; a live reader stays off the detector while any are. */
let analysesPending = 0

/** Whether a form check is queued or running right now. */
export function analysisInFlight(): boolean {
  return analysesPending > 0
}

export interface AnalyseOptions {
  /**
   * Called when this job leaves the queue and actually starts. Waiting behind
   * another check and running are different states with different clocks — a
   * third queued check must not time out after five seconds of real work.
   */
  onStart?: () => void
  /** Clip time to start the analysed window at — the marked start of a video-timed hold. */
  windowStartSec?: number
}

export function analyseClipDetailed(
  blob: Blob,
  exerciseId: string,
  sampleCount?: number,
  creditedHoldSec?: number,
  options: AnalyseOptions = {},
): Promise<ClipAnalysis> {
  analysesPending += 1
  const analysis = analysisQueue.then(() => {
    options.onStart?.()
    return analyseClipNow(blob, exerciseId, sampleCount, creditedHoldSec, options.windowStartSec ?? 0)
  })
  const settle = () => {
    analysesPending = Math.max(0, analysesPending - 1)
  }
  analysisQueue = analysis.then(
    () => settle(),
    () => settle(),
  )
  return analysis
}

export function analyseClip(
  blob: Blob,
  exerciseId: string,
  sampleCount?: number,
  creditedHoldSec?: number,
): Promise<PoseFormResult> {
  return analyseClipDetailed(blob, exerciseId, sampleCount, creditedHoldSec).then((a) => a.result)
}

/** A robust "kept through the hold" minimum that forgives a few bad detections. */
export function sustainedMinimum(xs: number[]): number | undefined {
  if (!xs.length) return undefined
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.25) - 1)]
}

/** Typical held angle, robust to a minority of low or high detector misses. */
export function sustainedTypical(xs: number[]): number | undefined {
  if (!xs.length) return undefined
  const sorted = [...xs].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Robust middle-half spread, used to detect an internally unstable angle. */
export function interquartileSpread(xs: number[]): number | undefined {
  if (xs.length < 4) return undefined
  const sorted = [...xs].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const lower = sorted.slice(0, middle)
  const upper = sorted.slice(sorted.length % 2 ? middle + 1 : middle)
  const q1 = sustainedTypical(lower)
  const q3 = sustainedTypical(upper)
  return q1 === undefined || q3 === undefined ? undefined : q3 - q1
}

/**
 * FIG Code of Points deduction bands, mapped onto a 0–100 criterion score.
 * Gymnastics judges deduct nothing inside 5° of the ideal, a small error to
 * 20°, a medium error to 45°, and past 45° the element is simply not that
 * position any more. The 5° free band doubles as the measurement deadband —
 * monocular pose estimation carries roughly 5–8° of angle error, so deviations
 * inside it are as likely noise as fault.
 */
export function bandedScore(deviationDeg: number): number {
  const d = Math.max(0, deviationDeg)
  if (d <= 5) return 100
  if (d <= 20) return Math.round(100 - ((d - 5) * 30) / 15)
  if (d <= 45) return Math.round(70 - ((d - 20) * 40) / 25)
  return Math.max(0, Math.round(30 - (d - 45) * 2))
}

/**
 * Ratio-based criteria (body line, lean, shrug) are converted to a
 * degree-equivalent so one deduction table grades everything.
 *
 * These deliberately reach the 5° free-band edge *sooner* than the matching
 * `MATERIAL_TOLERANCE` entry names a fault. The two are answering different
 * questions: the score asks how far from ideal the position was, and a small
 * honest deduction costs an athlete nothing but a point or two; naming a fault
 * asks whether the camera is sure, and being wrong there sends someone away to
 * fix a problem they do not have. Scoring strictly and accusing conservatively
 * is the point, not an inconsistency.
 */
const RATIO_TO_DEG = { line: 80, lean: 60, shrug: 100 } as const

/**
 * Relative weight of each criterion in the headline score, renormalised over
 * whichever criteria were actually judged. Straight arms dominate because a
 * bent-arm planche is a different (easier) skill, not a style fault.
 */
const SCORE_WEIGHTS: Record<FormSubscore['key'], number> = {
  elbow: 28,
  // A bent-arm hold is defined by its elbow angle the way a planche is by a lock.
  angle: 28,
  shoulder: 16,
  tilt: 18,
  line: 18,
  cleanTime: 15,
  lean: 14,
  hipAngle: 12,
  knee: 8,
  shrug: 6,
  steadiness: 5,
}

/**
 * What the clean-time subscore is called where the elbows are read coarsely.
 * "Verified clean" there read 100 beside arms bent 30° in a lever: the camera
 * had verified the line, not the arms.
 */
export const COARSE_CLEAN_LABEL = 'Shape held'

const SUBSCORE_LABELS: Record<FormSubscore['key'], string> = {
  elbow: 'Straight arms',
  angle: 'Elbow angle',
  shoulder: 'Shoulders open',
  tilt: 'Level',
  knee: 'Straight legs',
  hipAngle: 'Hip opening',
  // This is shoulder-versus-hip height, not shoulder–hip–ankle collinearity.
  // Calling it "Body line" made a green 100 look like proof that the separate
  // hip-opening angle must also be straight.
  line: 'Hip height',
  lean: 'Forward lean',
  shrug: 'Shoulders down',
  steadiness: 'Steady over hands',
  cleanTime: 'Verified clean',
}

/**
 * The 0–100 verdict, built only from criteria the camera actually judged.
 * Returns null when nothing was gradeable — a score computed from nothing
 * would read as a verdict the camera never gave.
 */
export function computeFormScore(parts: {
  profile: PoseProfile
  judged: JudgedCriteria
  elbowDeg?: number
  kneeDeg?: number
  hipAngleDeg?: number
  hipOffset?: number
  leanRatio?: number
  shrugRatio?: number
  shoulderDeg?: number
  tiltDeg?: number
  drift?: number
  cleanRatio?: number
  /** A bent-arm fault was named on this reading (aggregate or sustained). */
  armsNamed?: boolean
}): { score: number; subscores: FormSubscore[] } | null {
  const { profile, judged } = parts
  const subscores: FormSubscore[] = []
  const coarse = coarseElbow(profile)
  const add = (key: FormSubscore['key'], score: number, label = SUBSCORE_LABELS[key]) =>
    subscores.push({ key, label, score: Math.round(score) })

  if (judged.elbow && profile.minElbowDeg !== undefined && parts.elbowDeg !== undefined) {
    // Once a persistent bend clears the tight camera deadband it should
    // matter visibly in the score: bent-arm planche is a different skill, not
    // merely a cosmetic line deduction.
    // Outside a support hold a straight arm reads well short of 180 (see
    // POSTURE_TOLERANCE), so nothing is deducted until the reading nears the
    // bar where a bend is named.
    const shortfall = profile.minElbowDeg - parts.elbowDeg - (coarse ? Math.max(0, elbowSlack(profile) - 6) : 0)
    // And there, nothing is *awarded* either. A reading inside that wide band
    // is every arm from locked to bent thirty degrees; "Straight arms 100" for
    // all of them was a number with nothing behind it. Only a bend the camera
    // stands behind — one it has named — is scored, as the deduction it is.
    if (!coarse || parts.armsNamed) add('elbow', bandedScore(Math.max(0, shortfall) * 2))
  }
  if (judged.elbow && profile.elbowTargetDeg !== undefined && parts.elbowDeg !== undefined) {
    // Free inside half the band; the band's edge is a small deduction.
    const off = Math.abs(parts.elbowDeg - profile.elbowTargetDeg) - (profile.elbowBandDeg ?? 0) / 2
    add('angle', bandedScore(Math.max(0, off) * 1.5))
  }
  if (judged.shoulder && profile.minShoulderDeg !== undefined && parts.shoulderDeg !== undefined) {
    add('shoulder', bandedScore(profile.minShoulderDeg - parts.shoulderDeg))
  }
  if (judged.tilt && profile.maxTiltDeg !== undefined && parts.tiltDeg !== undefined) {
    add('tilt', bandedScore((parts.tiltDeg - profile.maxTiltDeg) * 1.5))
  }
  if (judged.knee && profile.minKneeDeg !== undefined && parts.kneeDeg !== undefined) {
    add('knee', bandedScore(profile.minKneeDeg - parts.kneeDeg))
  }
  if (judged.hipAngle && profile.minHipAngleDeg !== undefined && parts.hipAngleDeg !== undefined) {
    add('hipAngle', bandedScore(profile.minHipAngleDeg - parts.hipAngleDeg))
  }
  if (judged.line && profile.levelTolerance !== undefined && parts.hipOffset !== undefined) {
    add('line', bandedScore((Math.abs(parts.hipOffset) - profile.levelTolerance) * RATIO_TO_DEG.line))
  }
  if (judged.lean && profile.minLeanRatio !== undefined && parts.leanRatio !== undefined) {
    add('lean', bandedScore((profile.minLeanRatio - parts.leanRatio) * RATIO_TO_DEG.lean))
  }
  if (judged.shrug && profile.checkShrug && parts.shrugRatio !== undefined) {
    add('shrug', bandedScore((SHRUG_MIN_RATIO - parts.shrugRatio) * RATIO_TO_DEG.shrug))
  }
  if (parts.drift !== undefined) {
    // Not a FIG criterion: graded on its own scale, from a still hold at
    // landmark-noise level (full marks) down to a genuine lowering (40).
    add(
      'steadiness',
      parts.drift <= DRIFT_STILL
        ? 100
        : Math.max(40, 100 - ((parts.drift - DRIFT_STILL) * 60) / (DRIFT_FLOOR - DRIFT_STILL)),
    )
  }
  if (parts.cleanRatio !== undefined) {
    add(
      'cleanTime',
      Math.max(0, Math.min(1, parts.cleanRatio)) * 100,
      coarse && profile.minElbowDeg !== undefined ? COARSE_CLEAN_LABEL : SUBSCORE_LABELS.cleanTime,
    )
  }

  if (!subscores.length) return null
  const totalWeight = subscores.reduce((t, s) => t + SCORE_WEIGHTS[s.key], 0)
  const score = Math.round(
    subscores.reduce((t, s) => t + s.score * SCORE_WEIGHTS[s.key], 0) / totalWeight,
  )
  return { score, subscores }
}

/**
 * Which fault to fix first when several were seen. Ordered by injury risk and
 * training impact, not by how loudly each one shows on camera: bent arms are
 * a different skill and an elbow risk, a shrug loads the wrong tissue, a lost
 * line wastes the set, and everything else is refinement. One cue at a time is
 * deliberate — motor-learning work shows a list of corrections fixes nothing.
 */
export const FIX_PRIORITY: { issue: FormIssue; cue: string }[] = [
  { issue: 'arms', cue: 'Lock the elbows — squeeze the triceps and keep them locked all the way to the end.' },
  { issue: 'angle', cue: 'Set the elbows at a right angle beside your ribs and keep them there — not straighter, not deeper.' },
  { issue: 'shrug', cue: 'Push the floor away and keep the shoulders down away from your ears.' },
  { issue: 'shoulders', cue: 'Open the shoulders — push tall until your arms continue the line of your body.' },
  { issue: 'tilt', cue: 'Bring the body level — lift from the side of the trunk until shoulders, hips and feet line up.' },
  { issue: 'sag', cue: 'Squeeze glutes and abs to bring the hips up level with the shoulders.' },
  { issue: 'pike', cue: 'Let the hips drop level — hold the height with lean, not by folding.' },
  { issue: 'closed', cue: 'Open the hips — drive the knees away from the chest and flatten the back.' },
  { issue: 'lean', cue: 'Lean further over your hands until the feet feel light before they leave.' },
  { issue: 'twist', cue: 'Press evenly through both hands and keep the shoulders square.' },
  { issue: 'knees', cue: 'Squeeze the knees dead straight and point the toes.' },
]

/** Cues that read differently when the body is not on its hands, seen from the side. */
const POSTURE_CUES: Partial<Record<Posture, Partial<Record<FormIssue, string>>>> = {
  hang: {
    arms: 'Lock the elbows — pull with straight arms. The moment they bend it is a row, not a lever.',
    sag: 'Squeeze the glutes and pull the bar toward your hips until the hips are level with the shoulders.',
    pike: 'Open the hips and bring them down level with the shoulders.',
    closed: 'Open the hips — push the feet away until the body is one line.',
  },
  inverted: {
    arms: 'Lock the elbows and push tall — a handstand rests on straight arms.',
    closed: 'Bring the hips into line — ribs in, glutes on, legs continuing the body.',
    knees: 'Squeeze the knees straight and the legs together, toes pointed.',
  },
  flag: {
    arms: 'Lock both arms — push with the bottom one, pull with the top one.',
    closed: 'Take the fold out of the waist — lift the hips and legs into line with the shoulders.',
  },
}

export function pickFixFirst(issues: FormIssue[], posture: Posture = 'support'): { issue: FormIssue; cue: string } | null {
  const first = FIX_PRIORITY.find((f) => issues.includes(f.issue))
  if (!first) return null
  return { issue: first.issue, cue: POSTURE_CUES[posture]?.[first.issue] ?? first.cue }
}

/**
 * Keep loader and runtime internals out of the athlete's face — and tell them
 * the fix that matches the failure. A detector that crashed mid-check used to
 * be reported as needing a first-time connection, which sent people hunting
 * for Wi-Fi when the model had been on the phone for weeks.
 */
export function friendlyResult(res: PoseFormResult): PoseFormResult {
  if (res.ok || !res.reason) return res
  const reason = res.reason
  if (/context lost|webgl|gpu|out of memory|RuntimeError|Aborted\(/i.test(reason)) {
    return {
      ...res,
      reason:
        'The form checker hit a device error and was reset. Run the check again — if it keeps failing, close and reopen the app.',
    }
  }
  if (/import|fetch|module|network|failed to load|load failed|\.js\b|\.wasm\b/i.test(reason)) {
    return {
      ...res,
      reason:
        'The form checker could not load. It needs a connection the first time it runs — try again once you are online.',
    }
  }
  if (/undefined|null|is not a function|TypeError|backend/i.test(reason)) {
    return { ...res, reason: 'The form check failed unexpectedly. Your set is saved — try the check again.' }
  }
  return res
}
