/**
 * `updates` has no bottom-nav entry of its own — it is a page reached from
 * Settings, and keeps Settings lit while you are on it.
 */
import type { GymState } from './lib/gym/types'

export type Tab = 'home' | 'train' | 'path' | 'library' | 'stats' | 'settings' | 'updates'

/**
 * A skill the app coaches: one road of holds from first shape to summit,
 * usually with a pressing or pulling twin beside it. The planche was the only
 * one until state v8; its progress keeps the top-level fields it always had,
 * and every other skill lives in `AppState.tracks`.
 */
export type SkillId = 'planche' | 'frontlever' | 'handstand' | 'ninety' | 'flag'

export const SKILL_IDS: SkillId[] = ['planche', 'frontlever', 'handstand', 'ninety', 'flag']

/** A weekday as `Date#getDay()` numbers it: 0 is Sunday, 6 is Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6
/** What one weekday is set aside for: skills in order (the first leads), or planned rest. */
export type DayPlan = SkillId[] | 'rest'
/** The athlete's own week. A weekday left out is the coach's to decide. See `lib/weekPlan.ts`. */
export type WeekPlan = Partial<Record<Weekday, DayPlan>>

export type PlancheStepId =
  | 'foundations'
  | 'lean'
  | 'frog'
  | 'tuck'
  | 'advtuck'
  | 'oneleg'
  | 'straddle'
  | 'full'

export type FrontLeverStepId = 'fl-hang' | 'fl-tuck' | 'fl-advtuck' | 'fl-oneleg' | 'fl-straddle' | 'fl-full'

export type HandstandStepId = 'hs-foundations' | 'hs-wall' | 'hs-float' | 'hs-free'

export type NinetyStepId = 'n90-lean' | 'n90-tuck' | 'n90-advtuck' | 'n90-straddle' | 'n90-full'

export type FlagStepId =
  | 'flag-foundations'
  | 'flag-vertical'
  | 'flag-tuck'
  | 'flag-oneleg'
  | 'flag-straddle'
  | 'flag-full'

/** Step ids are unique across skills, so a step id alone says which road it is on. */
export type StepId = PlancheStepId | FrontLeverStepId | HandstandStepId | NinetyStepId | FlagStepId

/**
 * What a movement is, for grouping and load. The five skill lines each have
 * their own (`planche`, `lever`, `handstand`, `ninety`, `flag`); the rest is
 * the supporting cast.
 */
export type Category =
  | 'planche'
  | 'lever'
  | 'handstand'
  | 'ninety'
  | 'flag'
  | 'push'
  | 'pull'
  | 'scapula'
  | 'core'
  | 'wrist'
  | 'mobility'
  | 'general'

export type Units = 'metric' | 'imperial'

export type EquipmentId =
  | 'floor'
  | 'parallettes'
  | 'band'
  | 'pullup-bar'
  | 'rings'
  | 'dip-bars'
  | 'box'
  | 'wall'
  | 'pole'
export type TrainingSurface = 'floor' | 'parallettes'

/**
 * v7 adds attempt provenance (timing, assistance, end reasons, repaired
 * fields), independent symptom events, and the revision/epoch pair that keeps
 * tabs and imports from overwriting newer work. Every addition is optional, so
 * a v6 save loads unchanged; the bump exists for the pre-upgrade snapshot and
 * so stricter evidence rules cannot silently demote an earned step.
 *
 * v8 adds the other skills: `tracks` (a road per skill beside the planche's
 * top-level fields), `profile.skills` (which are trained, in priority order)
 * and per-skill session notes. Again every addition is optional — a v7 save is
 * a planche-only athlete and loads as one.
 *
 * v9 (Fitness Lab) adds `gym`: locations with their equipment, gym sessions
 * (weight × reps × effort) and exercise preferences. It lives beside the
 * skill history rather than inside it, so the skill coach, records and
 * achievements replay exactly as before; an older save simply has none.
 */
export const CURRENT_STATE_VERSION = 9 as const

export interface Measurement {
  at: number
  weightKg?: number
  heightCm?: number
}

export interface Profile {
  /** Latest known height; also mirrored into the measurement log. */
  heightCm?: number
  equipment: EquipmentId[]
  /** Default hand support for new planche sets; each logged set keeps its own. */
  preferredSurface?: TrainingSurface
  /** Long-term destination used to keep the coach and dashboard goal-aware. */
  goalStepId?: StepId
  /**
   * The skills this athlete trains, most important first. The first is the
   * focus: it leads every mixed session and gets the fullest dose. Absent on
   * saves from before the other skills existed, which means the planche alone.
   */
  skills?: SkillId[]
  /** Free-text note about anything currently sore or previously injured. */
  injuryNote?: string
  /** Optional local context; it never changes an earned progression result. */
  birthYear?: number
  /**
   * Months of straight-arm training behind the athlete. Connective tissue
   * adapts over months while muscle adapts over weeks, so this changes the
   * sensible starting dose for someone who is already strong.
   */
  trainingAgeMonths?: number
}

/**
 * What went wrong in a hold. `hips` and `level` are the original coarse
 * values, kept so older logs stay readable; new ratings use the specific ones.
 */
export type FormIssue =
  | 'arms'
  | 'scapula'
  | 'shrug'
  | 'pike'
  | 'sag'
  | 'closed'
  | 'knees'
  | 'lean'
  | 'twist'
  | 'narrow'
  | 'hips'
  | 'level'
  /** Shoulders not open (a handstand's arm-to-torso angle short of a straight line). */
  | 'shoulders'
  /** The body off its line as a whole: a handstand off vertical, a flag off level. */
  | 'tilt'
  /** Elbow angle away from the one the position is defined by (a 90° hold). */
  | 'angle'
  /** Reps that stopped short of the bottom of the range. */
  | 'depth'
  /** Reps that did not finish at locked-out arms. */
  | 'lockout'
  /** Reps helped by a kick, a bounce or a swing. */
  | 'kip'

export type FormRating = 'clean' | 'slipped' | 'broke'

/** What the camera measured, kept even if the athlete never confirms it. */
export interface AutoForm {
  issues: FormIssue[]
  /**
   * Faults inside the portion of the hold that receives progression credit.
   * `issues` also names a sustained breakdown after that clean window so the
   * athlete still gets useful feedback. Older records omit this and safely
   * fall back to `issues`.
   */
  heldIssues?: FormIssue[]
  confidence: number
  /**
   * Overall camera form score, 0–100, over the criteria that were judged.
   * Advisory — progression still runs on issues/cleanSeconds, not this.
   */
  score?: number
  /**
   * Seconds that stayed inside the camera's tolerant form envelope before a
   * sustained breakdown. Progression credit is capped here when available.
   */
  cleanSeconds?: number
  /** Clean seconds divided by the athlete's credited hold. */
  cleanRatio?: number
  /**
   * Share of the requested moments across the hold in which the camera saw
   * every criterion it judged (judge v4+). Below 0.6 the clean time is a
   * training-dose estimate, not camera verification. Older readings omit it
   * and stay as they were judged.
   */
  coverage?: number
  /**
   * Seconds at the end of the hold the recording never reached (a camera that
   * stopped sending pictures). Clean time describes the filmed part only; this
   * part is unknown, so it is never verified and never a breakdown.
   */
  unfilmedSec?: number
  elbowDeg?: number
  kneeDeg?: number
  hipAngleDeg?: number
  hipOffset?: number
  leanRatio?: number
  /** Shoulder-to-ear gap over torso length; small means shrugged. */
  shrugRatio?: number
  /** Wrist–shoulder–hip angle: how open the shoulders are (a handstand's line). */
  shoulderDeg?: number
  /** Degrees the whole body sits off the line the position asks for (vertical or level). */
  tiltDeg?: number
  /** Legacy pre-side-view camera field, kept so older logs still import. */
  asymmetry?: number
  /**
   * Picture-frame drift speed from judge v1–3. It mixed camera movement into
   * the athlete's, so it is kept for old readings only and no longer written.
   */
  wobble?: number
  /**
   * Spread of shoulder and hip positions measured against the planted hand,
   * over torso length (judge v4+). Movement, not its cause.
   */
  drift?: number
  /** The lockout reference the elbows were measured from, when not 180 (judge v8). */
  lockoutDeg?: number
  /**
   * Criteria the camera could not see well enough to grade. The rest of the
   * verdict still stands; these were simply not checked.
   */
  unseen?: string[]
  /**
   * Criteria the camera did judge, but only coarsely (judge v6+). `elbows` in
   * a hang, a handstand or a flag: a large bend would have been named, a small
   * one cannot be seen. Not a pass for them — the athlete confirms lockout.
   */
  coarse?: string[]
  /**
   * Seconds of the hold the analysis actually covered. When the credited
   * value is corrected later (the walk-back tap), evidence that only covered
   * the old, shorter window must not be read as covering the new one.
   */
  analysedSec?: number
  /** Clip time the analysed window began at (0 unless the hold was timed from the video). */
  analysedFromSec?: number
  /** Widest gap between sampled moments; a break shorter than this can hide between them. */
  samplingGapSec?: number
  /** Which detector produced the reading, so results stay attributable to model bytes. */
  model?: string
  /** Version of the verdict rules that produced it. */
  judge?: number
  /**
   * An import found this reading structurally malformed (a string where a list
   * belongs, a null duration). It stays visible but can never steer coaching
   * or count toward progression: a repair must not manufacture evidence.
   */
  malformed?: boolean
}

export interface FormCheck {
  rating: FormRating
  /**
   * False when the camera suggested this rating but the athlete has not
   * confirmed it. Progression requires an explicit true value.
   */
  confirmed?: boolean
  /**
   * The athlete watched the recorded replay and checked it against the
   * position checklist. Used only where pose geometry cannot grade the skill
   * honestly (currently Frog Stand).
   */
  visualReviewPassed?: boolean
  /**
   * The athlete confirmed that a true flight skill stayed unsupported for the
   * verified window. A side-on 2D pose cannot reliably infer floor contact.
   */
  flightConfirmed?: boolean
  /**
   * The athlete confirmed the part of the shape that defines this variant —
   * the extended leg, the open hips, the lean — when the camera could not see
   * it. Without this, an unseen variant-critical criterion cannot earn credit:
   * a camera that lost the extended leg has not verified a one-leg planche.
   */
  variantConfirmed?: boolean
  /**
   * The athlete watched the replay and confirmed the elbows stayed locked, for
   * a hold where the camera can only see a large bend (a hang, a handstand, a
   * flag — `requiresArmsConfirmation`). Needed for progression credit there.
   */
  armsConfirmed?: boolean
  issues?: FormIssue[]
  /** Key of the recorded clip in the clip store, when one was kept. */
  clipKey?: string
  /** Objective reading from the clip, independent of the athlete's rating. */
  auto?: AutoForm
}

/**
 * Where something hurts.
 *
 * A single "joints hurt" flag made every complaint cost the same session: a
 * sore wrist and an angry biceps tendon both wiped out the whole day. They are
 * not the same problem and they do not need the same rest — a wrist that
 * cannot take floor extension is usually fine on parallettes, while an elbow
 * is the one signal that should stop straight-arm loading outright.
 */
export type BodyRegion = 'wrist' | 'elbow' | 'shoulder' | 'lower-back' | 'knee' | 'hip' | 'ankle' | 'other'

export const BODY_REGIONS: BodyRegion[] = ['wrist', 'elbow', 'shoulder', 'lower-back', 'knee', 'hip', 'ankle', 'other']

/** Answers to the coach's periodic pre-session check-in. */
export interface CheckIn {
  joints: 'good' | 'niggle' | 'pain'
  energy: 'fresh' | 'ok' | 'tired'
  at: number
  /**
   * Where the complaint is, asked only when `joints` is not 'good'. Empty or
   * absent means "reported but not localised" — the rails then fall back to
   * the conservative whole-body response rather than guessing a region.
   */
  regions?: BodyRegion[]
  /**
   * Sleep the night before. Optional because an athlete who does not want to
   * answer should not be blocked, and a missing answer must never read as
   * 'poor' — absence of evidence is not evidence of bad recovery.
   */
  sleep?: 'good' | 'ok' | 'poor'
  /**
   * Asked only after a long logging gap: weeks with nothing logged are not
   * evidence of rest. Someone who kept training elsewhere and someone coming
   * back from a real break need different first sessions. Absent = not asked
   * or skipped, which stays unknown.
   */
  gap?: 'trained-elsewhere' | 'break' | 'unsure'
}

/**
 * A joint report kept on its own, not only inside a saved session.
 *
 * Check-ins used to live solely on the session they preceded, so a pain answer
 * followed by a discarded session vanished — and the onboarding "it hurts"
 * answer never reached the rails at all. These events are the durable record
 * the rails read alongside session check-ins.
 */
export interface SymptomEvent {
  id: string
  at: number
  joints: CheckIn['joints']
  regions?: BodyRegion[]
  /** Where the report came from, so a correction or onboarding answer is never mistaken for a check-in. */
  source: 'onboarding' | 'check-in' | 'attempt' | 'manual'
  /** Energy from the same check-in, when there was one. */
  energy?: CheckIn['energy']
  /** True when this entry corrects an accidental report rather than claiming recovery. */
  correction?: boolean
}

/**
 * A completed placement interview.
 *
 * Kept as data rather than only its result so a later change to the placement
 * rules can be re-applied to what the athlete actually answered, and so the
 * app can show its working when someone asks why they started where they did.
 * Answers are a plain id→number map to keep this module free of dependencies
 * on the assessment logic that consumes it.
 */
export interface AssessmentRecord {
  at: number
  answers: Record<string, number>
  placedStepId: StepId
  confidence: 'low' | 'moderate' | 'good'
  /** Prerequisite gap ids the placement identified, for the first plans. */
  gapIds: string[]
}

export type ExerciseType = 'hold' | 'reps'

export interface Exercise {
  id: string
  name: string
  category: Category
  /** The skill this movement belongs to, when it is part of one skill's road rather than shared support work. */
  skill?: SkillId
  type: ExerciseType
  difficulty: 1 | 2 | 3 | 4 | 5
  /** Human-readable kit description, shown in Learn. */
  equipment: string[]
  /**
   * Kit this movement genuinely cannot be done without. Absent means floor
   * space is enough. Session assembly checks it, so a plan never quietly
   * assumes dip bars or a band the athlete does not own.
   */
  requires?: EquipmentId[]
  /**
   * Catalogue-only movements the planner never schedules on its own — later
   * dynamic or supported options that need their setup reviewed first.
   */
  catalogueOnly?: boolean
  blurb: string
  howTo: string[]
  cues: string[]
  mistakes: string[]
  muscles: string[]
  perSide?: boolean
}

export interface StepDef {
  id: StepId
  /** Which skill's road this step is on. */
  skill: SkillId
  order: number
  name: string
  /** A name that fits under a small figure: "Adv. tuck". */
  short: string
  tagline: string
  keyExerciseId: string
  /** Hold (seconds) on the key exercise required to unlock the next step. */
  unlockSec: number
  /** Sensible first working-set target when there is no history yet. */
  startSec: number
  /**
   * How many different days the bar must be shown on before the step opens.
   * Absent = one. Balance holds ask for two: a balance held once can be luck —
   * coaches describe "having" a handstand by how often it stays up, not by one
   * best hold — so a single long float does not open the next step by itself.
   */
  repeatDays?: number
  description: string
  formChecks: string[]
  mistakes: string[]
  whyItMatters: string
  scheme: string
}

export type BlockTarget = { kind: 'hold'; sec: number } | { kind: 'reps'; reps: number }

export type Section = 'warmup' | 'main' | 'strength' | 'core' | 'cooldown'

/**
 * What a block is *for* inside a generated session. The section says where it
 * sits; the role says why it is there — which is what decides what a short
 * session gives up first, and what the preview calls it. Absent on templates
 * and on workouts saved before roles existed.
 */
export type BlockRole =
  | 'attempt'
  | 'bridge'
  | 'skill'
  | 'backoff'
  | 'assisted'
  | 'balance'
  | 'press'
  | 'pressing'
  | 'straight-arm'
  | 'core'
  | 'mobility'

export interface Block {
  exerciseId: string
  sets: number
  target: BlockTarget
  restSec: number
  section: Section
  note?: string
  role?: BlockRole
  /**
   * Chosen by the coach for a measured limiter. A short session keeps it
   * longer than the default accessories it would otherwise be trimmed with.
   */
  emphasis?: boolean
  /** An easy day's lighter dose: its sets are logged `light` (see `SetLog.light`). */
  light?: boolean
  /**
   * Sets past the dose a short session keeps: the key hold's reach toward
   * about a minute of practice (`mainHoldSets`). A time budget gives these up
   * before any strength block goes, and nothing else.
   */
  reach?: number
  /**
   * An attempt queued to re-measure the hold rather than to unlock it
   * (`plan.queueRetest`) — the same single max hold at the bar, named for what
   * it is for.
   */
  retest?: boolean
  /** The skill this block trains, in a session that mixes several. Absent on shared work and older workouts. */
  skill?: SkillId
}

/**
 * What the athlete asked for, kept beside the workout built from it.
 *
 * The workout is the *result* of a request plus today's rails; storing only
 * the result meant a readiness answer rebuilt "today's session" from scratch
 * and silently dropped the 15-minute version the athlete had chosen. Anything
 * that rebuilds a workout rebuilds it from this.
 */
export interface WorkoutRequest {
  /** `micro` is the minimum dose: a few short maximal holds for a day a session will not happen. */
  source: 'auto' | 'template' | 'test' | 'micro'
  templateId?: string
  stepId?: StepId
  /** One-off shorter budget for today. Absent = the profile default. */
  minutes?: number
  /**
   * Which skills this session is for. Absent = the coach picks today's line-up
   * from the athlete's priorities; one skill = a session for that skill alone.
   */
  skills?: SkillId[]
  /**
   * `ladder`: a day for the skill's rep ladder (the handstand push-up line, the
   * 90° push-up line). The ladder's current rung is the main work and the
   * skill's holds shrink to practice. Only meaningful with one skill that has a
   * ladder; absent builds the session exactly as before.
   */
  focus?: 'ladder'
  /**
   * Kit at the place this session happens, beside the athlete's own (a gym's
   * pull-up bar for a front-lever opener). Added to the profile's equipment for
   * this build only; absent builds exactly as before.
   */
  kit?: EquipmentId[]
  /**
   * The athlete picked this session inside their straight-arm rest rule
   * (`insideRestRule`): hours since the family's last hard session, and the
   * rule's own hours. A pick still outranks the plan, so it is built — as a
   * lighter day: never a push day, no target above the base, a little less
   * volume, nothing maximal (`CoachPlan.insideRest`). Absent builds exactly as
   * before.
   */
  insideRest?: { hours: number; ruleHours: number }
}

export interface Workout {
  id: string
  name: string
  focus: string
  minutes: number
  kind: 'auto' | 'template' | 'test' | 'micro'
  blocks: Block[]
  strategy?: StrategyId
  /** The request this was built from; absent on drafts saved by older versions. */
  request?: WorkoutRequest
  /** One-line statement of what the session is for. */
  purpose?: string
  /**
   * What the final safety, equipment and capacity checks changed, in plain
   * words, so the brief can say it instead of hiding it.
   */
  adjustments?: string[]
  /** The key hold's working target before strategy and rail factors. Coach sessions only. */
  baseTargetSec?: number
  /** Built on a day the coach scheduled as part of an easy week (`dayType` deload). */
  plannedDeload?: boolean
  /** The skills this session trains, lead first. Absent = the planche alone (older workouts). */
  skills?: SkillId[]
  /**
   * Why each skill is in a mixed session and how much of it: the lead, its
   * partner, a maintenance dose, or balance practice. Shown before the session.
   */
  lineup?: { skill: SkillId; role: LineupRole; reason: string }[]
  /**
   * What each skill other than the planche was given: the strategy that shaped
   * its work and its key hold's base target — the planche's sit at the top
   * level, where they always were.
   */
  skillMeta?: Partial<Record<SkillId, WorkoutSkillMeta>>
}

/** One skill's share of a workout's coaching record. */
export interface WorkoutSkillMeta {
  strategy?: StrategyId
  baseTargetSec?: number
  /** The session opened this skill's work with a re-test. */
  retest?: boolean
}

/** Why an attempt ended, when the athlete chose to say. Unanswered stays unknown. */
export type EndReason = 'target' | 'balance' | 'technique' | 'effort' | 'interruption' | 'timing' | 'unsure'

/** Assistance the athlete reported for a hold. Absent = unknown (older records). */
export type AssistType = 'none' | 'band' | 'feet' | 'partner' | 'other'

/**
 * How a timed value was measured. The credited value alone could not say
 * whether a 5s hold was a stopwatch reading, an interrupted attempt, or a
 * number the athlete typed in — and those are not the same evidence.
 */
export interface SetTiming {
  /**
   * `video`: the athlete marked where the hold started and ended on the clip
   * itself. That interval is the measurement — no reaction or walk-back
   * allowance is taken off it, and the stopwatch reading stays in `raw`.
   */
  method: 'stopwatch' | 'interrupted' | 'edited' | 'video'
  /** Seconds taken off the raw reading, when any were. */
  allowanceSec?: number
  /**
   * The walk-back allowance was the athlete's measured walk, not the assumed
   * five seconds. Only an assumed walk may have missed a slow one.
   */
  walkMeasured?: boolean
  allowance?: 'walk-back' | 'reaction' | 'interruption'
  /** Clip-time of the marked start and end, for `video` timing. */
  videoStartSec?: number
  videoEndSec?: number
}

export interface SetLog {
  exerciseId: string
  kind: ExerciseType
  /** Seconds for holds, reps for rep work. Latency-corrected for holds. */
  value: number
  /** Stopwatch reading before reaction-time correction, when it differed. */
  raw?: number
  target: number
  section: Section
  at: number
  /** Self-assessed quality of this set, when the coach asked. */
  form?: FormCheck
  /** Recorded clip attached before the athlete or camera has rated the set. */
  clipKey?: string
  /** Which side a unilateral movement was performed on. */
  side?: 'left' | 'right'
  /** Hand support used for this planche set. Older records remain unspecified. */
  surface?: TrainingSurface
  /** Actual setup countdown used, so learned rest is not distorted if skipped. */
  leadInSec?: number
  /** Measurement provenance for timed holds. Absent on older records. */
  timing?: SetTiming
  /** Optional athlete-reported reason the attempt ended. */
  endReason?: EndReason
  /** Assistance reported for this hold; absent means unknown. */
  assist?: AssistType
  /**
   * Seconds of the hold that passed before the camera was actually recording.
   * A late start means the clip's first frame is not the hold's first second.
   */
  recordingOffsetSec?: number
  /**
   * The target call sounded during this hold and it was stopped within the
   * stop allowance of the call: the athlete came down at the call, as the hold
   * screen asks. With the phone across the room the allowance is a fixed guess,
   * so such a hold can log a little under its target; it is read as reaching
   * the target (a lower bound), never as falling short. Observed by the app,
   * not reported by the athlete — absent on older records.
   */
  calledAtTarget?: boolean
  /**
   * How hard the set felt, 6–10 (Fitness Lab): one optional tap on the rest
   * screen. It feeds the shared fatigue count beside the gym; the skill
   * coach's targets do not read it. Absent means not asked or skipped.
   */
  rpe?: number
  /**
   * Logged from an easy day's lighter accessory dose. Real work, so it counts
   * as volume — but a target chosen to be easy says nothing about capacity, so
   * it never moves accessory progression either way.
   */
  light?: boolean
  /**
   * Fields an import had to repair (an unknown section, a malformed camera
   * reading). The timer value is kept as history; the set can no longer
   * qualify for progression, because a repair must not create evidence.
   */
  repaired?: string[]
}

export type StrategyId = 'balanced' | 'volume' | 'intensity' | 'density' | 'technique'

export interface Session {
  id: string
  startedAt: number
  /** When training actually stopped — not when the summary was saved. */
  endedAt: number
  /** Time the app was backgrounded or closed during this session. */
  pausedMs?: number
  workoutName: string
  workoutKind: Workout['kind']
  stepId: StepId
  sets: SetLog[]
  rpe?: number
  notes?: string
  /** Which coach strategy shaped this session (drives its learning). */
  strategy?: StrategyId
  /** Pre-session readiness answers, when the coach asked. */
  checkIn?: CheckIn
  /** When the athlete pressed Save; review time on the summary lives here, not in the duration. */
  savedAt?: number
  /** Last edit after saving, e.g. a camera check attached later from the gallery. */
  updatedAt?: number
  /** 'partial' when the athlete finished early; planned work they skipped is not adherence. */
  completion?: 'full' | 'partial'
  /** Raw rounds the plan contained. */
  plannedRounds?: number
  /**
   * The key hold's base working target this session was built from. If its
   * key work was completed as prescribed, the next base does not fall below
   * it — completing a target is evidence it was within capacity.
   */
  baseTargetSec?: number
  /**
   * The session opened with a re-test (`plan.queueRetest`). Kept so a skipped
   * one backs off for a while instead of displacing next-shape practice every
   * session after.
   */
  retestOffered?: boolean
  /**
   * Trained on a day of an easy week the coach scheduled. Without it the coach
   * never recognised its own deload — its sessions are named for their
   * strategy, and keep enough of the session to sit above the light-week load
   * line — so shorter-session athletes stayed in a deload that never ended.
   */
  plannedDeload?: boolean
  /**
   * The other skills' side of this session: the step each was on, and what the
   * coach gave it. `stepId`, `strategy`, `baseTargetSec` and `retestOffered`
   * above are the planche's, as they always were; reading a session for
   * another skill goes through `skillView` (lib/skills), never these directly.
   */
  skills?: Partial<Record<SkillId, SessionSkill>>
  /**
   * What each skill's share of this session was: led it, partnered it, a
   * maintenance dose, or balance practice. The line-up reads it to tell a full
   * training day from a couple of sets kept ticking over — without it, a
   * maintenance dose counted as "trained", and a third skill never came round
   * for real work. Absent on sessions from before it was kept.
   */
  roles?: Partial<Record<SkillId, LineupRole>>
}

/** What a skill's share of a mixed session is for. */
export type LineupRole = 'lead' | 'partner' | 'maintenance' | 'practice'

/** One skill's record inside a session. */
export interface SessionSkill {
  /** The step this skill was on when the session was trained. */
  stepId: StepId
  strategy?: StrategyId
  baseTargetSec?: number
  retestOffered?: boolean
}

/**
 * Where an athlete stands on one skill's road (every skill but the planche,
 * whose progress keeps the top-level `stepId` / `baseStepId` / `unlocked`).
 * Derived by replaying history from `baseStepId`, like the planche's.
 */
export interface SkillTrack {
  stepId: StepId
  /** Where placement put the athlete; replay never rewinds below it. */
  baseStepId: StepId
  unlocked: StepId[]
  goalStepId?: StepId
  /** The placement interview for this skill, when one was taken. */
  assessment?: AssessmentRecord
  /** When the athlete added the skill. */
  addedAt: number
}

export interface PRMark {
  value: number
  at: number
}

export interface PR extends PRMark {
  /** Separate honest records; the top-level value remains the overall best. */
  bySurface?: Partial<Record<TrainingSurface, PRMark>>
}

export interface Settings {
  theme: 'dark' | 'light' | 'system'
  sound: boolean
  volume: number
  /** Spoken counts during holds — you can't watch a screen mid-planche. */
  voice: boolean
  restMainSec: number
  restAccessorySec: number
  weeklyGoal: number
  warmup: boolean
  beeps: boolean
  /** Time budget for generated sessions, minutes. */
  sessionMinutes: number
  units: Units
  /** Record a short clip of main-work holds from the camera. */
  recordForm: boolean
  /** Run the form check on each clip automatically once the model is cached. */
  autoAnalyze: boolean
  /**
   * Beta: speak "lock your elbows" during a filmed hold when the live camera
   * sees a sustained bend. Off by default — it runs the model while recording.
   */
  liveCues?: boolean
  /**
   * Seconds between actually coming out of a hold and the stop button being
   * pressed. Used for regular timed holds; main Path holds have a dedicated
   * longer allowance unless `phoneWithinReach` says otherwise.
   */
  stopLatencySec: number
  /**
   * Whether the phone is close enough to stop a filmed main hold without
   * getting up and walking to it.
   *
   * A statement of fact about the setup, not a preference: the longer Path
   * allowance exists only to model that walk, so an athlete who never walks
   * was having seconds deducted for something they did not do. Defaults to
   * false — the conservative reading, which under-credits rather than
   * inventing hold time.
   */
  phoneWithinReach: boolean
  /**
   * The athlete's measured walk back to a phone across the room, used for
   * main Path holds in place of the assumed five seconds. Absent until
   * measured (Settings → Measure my walk back); the slowest of three walks.
   */
  walkBackSec?: number
  /**
   * Bodyweight reminders (Fitness Lab): off unless the athlete turns them on.
   * Logging a weight in Settings works either way; nothing ever nudges toward
   * losing weight, and under 18 there is no reminder at all.
   */
  trackBodyweight?: boolean
  /**
   * Where this athlete's locked arm reads on their own camera (Settings →
   * Calibrate lockout), 160–180. Absent = not calibrated: the judge measures
   * from `UNCALIBRATED_LOCKOUT_DEG`.
   */
  lockoutDeg?: number
  /** When the lockout was calibrated. */
  lockoutCalibratedAt?: number
  /**
   * Play sounds and voice cues through an iPhone's silent switch (Safari's
   * Audio Session "playback"). Pauses music in another app while they play,
   * so it is the athlete's choice; off keeps Safari's default.
   */
  soundThroughSilent?: boolean
  /**
   * The weekly goal that applied before the latest change to it, and when it
   * changed. Weeks finished before then are still judged against the goal
   * they were trained under: without this, raising the goal — or saving a
   * week plan with more days in it — re-judged every past week against the
   * new number, and an eight-week streak read 0 the moment Save was pressed.
   */
  goalBefore?: { goal: number; until: number }
  /**
   * Which skills each weekday is for, when the athlete has said. Absent, or a
   * day left out of it, the coach shares sessions between skills by priority.
   */
  weekPlan?: WeekPlan
}

export interface AppState {
  version: typeof CURRENT_STATE_VERSION
  onboarded: boolean
  name: string
  startedAt: number
  /** When the user last exported a backup file. */
  lastBackupAt?: number
  stepId: StepId
  /**
   * Where onboarding placed the athlete. Replaying history rewinds to here,
   * never below it — deleting a session must not undo your starting point.
   */
  baseStepId: StepId
  /**
   * Highest step earned before filmed evidence became mandatory. This keeps
   * legacy progress from being revoked when history is replayed.
   */
  grandfatheredStepId?: StepId
  unlocked: StepId[]
  sessions: Session[]
  prs: Record<string, PR>
  /** Catalog revision last reconciled against saved session history. */
  achievementVersion: number
  /** Achievement id -> unlock timestamp. */
  achievements: Record<string, number>
  /** Exercise id -> a demo video URL the user pinned themselves. */
  videoLinks: Record<string, string>
  profile: Profile
  /** Bodyweight / height log, oldest first. */
  measurements: Measurement[]
  /** When the weekly check was last dismissed, so it stops re-asking. */
  measureSnoozedAt?: number
  /**
   * The most recent placement interview. Absent for athletes who onboarded
   * before it existed or who skipped it — every consumer must treat that as
   * "unknown", never as "assessed and found lacking".
   */
  assessment?: AssessmentRecord
  settings: Settings
  /**
   * Increments on every change. Long operations (an import waiting on clip
   * cleanup, a late mirror restore) record it first and refuse to commit if a
   * newer write landed in the meantime.
   */
  rev?: number
  /**
   * Identifies this dataset. A reset, import or sample load starts a new one,
   * so another tab still holding the old dataset can never merge back into it.
   */
  epoch?: string
  /** Earlier epochs this dataset replaced; a write from one of them is stale. */
  retiredEpochs?: string[]
  /**
   * When each user-editable field (a setting, a profile entry, the selected
   * step) was last changed here. Two tabs editing different settings then
   * merge per field instead of the later write silently reverting the other.
   */
  fieldTimes?: Record<string, number>
  /** Deleted session ids, so a stale tab cannot resurrect them. Capped. */
  deletedSessionIds?: string[]
  /** Joint reports kept independently of sessions. Oldest first, capped. */
  symptoms?: SymptomEvent[]
  /** Remembered per-exercise setup, so assistance is asked once rather than every set. */
  setups?: Record<string, ExerciseSetup>
  /**
   * Progress on every skill other than the planche. A skill appears here once
   * the athlete has set it up; taking it off `profile.skills` keeps its track,
   * so what was earned is still there if they come back.
   */
  tracks?: Partial<Record<SkillId, SkillTrack>>
  /** Fitness Lab's gym side (state v9). Absent until the athlete sets up a location. */
  gym?: GymState
}

/** A remembered setup for one exercise. Changing it never relabels earlier sets. */
export interface ExerciseSetup {
  assist: AssistType
  /** Optional nickname or anchor description, e.g. "red band, top of the bar". */
  note?: string
  updatedAt: number
}

/** Everything noteworthy that a saved session produced. */
export interface SessionEvents {
  prs: { exerciseId: string; value: number; previous?: number; surface?: TrainingSurface }[]
  achievements: string[]
  unlockedStep?: StepId
  /**
   * How the step opened: its bar was met, or the next shape's opening dose
   * was shown with full evidence while the current hold was past half its bar.
   */
  unlockedVia?: 'bar' | 'next-shape'
  /**
   * Every step this session opened, across skills. `unlockedStep` is the first
   * of them, kept for readers that show one.
   */
  unlocks?: { stepId: StepId; via: 'bar' | 'next-shape' }[]
}
