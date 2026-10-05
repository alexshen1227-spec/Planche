/**
 * `updates` has no bottom-nav entry of its own — it is a page reached from
 * Settings, and keeps Settings lit while you are on it.
 */
export type Tab = 'home' | 'train' | 'path' | 'library' | 'stats' | 'settings' | 'updates'

export type StepId =
  | 'foundations'
  | 'lean'
  | 'frog'
  | 'tuck'
  | 'advtuck'
  | 'oneleg'
  | 'straddle'
  | 'full'

export type Category = 'planche' | 'push' | 'scapula' | 'core' | 'wrist' | 'mobility' | 'general'

export type Units = 'metric' | 'imperial'

export type EquipmentId = 'floor' | 'parallettes' | 'band' | 'pullup-bar' | 'dip-bars' | 'box'
export type TrainingSurface = 'floor' | 'parallettes'

/**
 * v7 adds attempt provenance (timing, assistance, end reasons, repaired
 * fields), independent symptom events, and the revision/epoch pair that keeps
 * tabs and imports from overwriting newer work. Every addition is optional, so
 * a v6 save loads unchanged; the bump exists for the pre-upgrade snapshot and
 * so stricter evidence rules cannot silently demote an earned step.
 */
export const CURRENT_STATE_VERSION = 7 as const

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
  elbowDeg?: number
  kneeDeg?: number
  hipAngleDeg?: number
  hipOffset?: number
  leanRatio?: number
  /** Shoulder-to-ear gap over torso length; small means shrugged. */
  shrugRatio?: number
  /** Legacy pre-side-view camera field, kept so older logs still import. */
  asymmetry?: number
  /** Keypoint jitter across frames — high means the hold was shaky. */
  wobble?: number
  /**
   * Criteria the camera could not see well enough to grade. The rest of the
   * verdict still stands; these were simply not checked.
   */
  unseen?: string[]
  /**
   * Seconds of the hold the analysis actually covered. When the credited
   * value is corrected later (the walk-back tap), evidence that only covered
   * the old, shorter window must not be read as covering the new one.
   */
  analysedSec?: number
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
export type BodyRegion = 'wrist' | 'elbow' | 'shoulder' | 'lower-back' | 'other'

export const BODY_REGIONS: BodyRegion[] = ['wrist', 'elbow', 'shoulder', 'lower-back', 'other']

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
  order: number
  name: string
  tagline: string
  keyExerciseId: string
  /** Hold (seconds) on the key exercise required to unlock the next step. */
  unlockSec: number
  /** Sensible first working-set target when there is no history yet. */
  startSec: number
  description: string
  formChecks: string[]
  mistakes: string[]
  whyItMatters: string
  scheme: string
}

export type BlockTarget = { kind: 'hold'; sec: number } | { kind: 'reps'; reps: number }

export type Section = 'warmup' | 'main' | 'strength' | 'core' | 'cooldown'

export interface Block {
  exerciseId: string
  sets: number
  target: BlockTarget
  restSec: number
  section: Section
  note?: string
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
  source: 'auto' | 'template' | 'test'
  templateId?: string
  stepId?: StepId
  /** One-off shorter budget for today. Absent = the profile default. */
  minutes?: number
}

export interface Workout {
  id: string
  name: string
  focus: string
  minutes: number
  kind: 'auto' | 'template' | 'test'
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
  method: 'stopwatch' | 'interrupted' | 'edited'
  /** Seconds taken off the raw reading, when any were. */
  allowanceSec?: number
  allowance?: 'walk-back' | 'reaction' | 'interruption'
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
}
