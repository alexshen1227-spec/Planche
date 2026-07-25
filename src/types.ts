export type Tab = 'home' | 'train' | 'path' | 'library' | 'stats' | 'settings'

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

export type EquipmentId = 'floor' | 'parallettes' | 'band' | 'pullup-bar' | 'dip-bars'

export interface Measurement {
  at: number
  weightKg?: number
  heightCm?: number
}

export interface Profile {
  /** Latest known height; also mirrored into the measurement log. */
  heightCm?: number
  equipment: EquipmentId[]
  /** Free-text note about anything currently sore or previously injured. */
  injuryNote?: string
  /** Optional — only used to soften recovery expectations. */
  birthYear?: number
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
  confidence: number
  elbowDeg?: number
  kneeDeg?: number
  hipAngleDeg?: number
  hipOffset?: number
  leanRatio?: number
  /** Keypoint jitter across frames — high means the hold was shaky. */
  wobble?: number
}

export interface FormCheck {
  rating: FormRating
  issues?: FormIssue[]
  /** Key of the recorded clip in the clip store, when one was kept. */
  clipKey?: string
  /** Objective reading from the clip, independent of the athlete's rating. */
  auto?: AutoForm
}

/** Answers to the coach's periodic pre-session check-in. */
export interface CheckIn {
  joints: 'good' | 'niggle' | 'pain'
  energy: 'fresh' | 'ok' | 'tired'
  at: number
}

export type ExerciseType = 'hold' | 'reps'

export interface Exercise {
  id: string
  name: string
  category: Category
  type: ExerciseType
  difficulty: 1 | 2 | 3 | 4 | 5
  equipment: string[]
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

export interface Workout {
  id: string
  name: string
  focus: string
  minutes: number
  kind: 'auto' | 'template' | 'test'
  blocks: Block[]
  strategy?: StrategyId
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
  /** Which side a unilateral movement was performed on. */
  side?: 'left' | 'right'
}

export type StrategyId = 'balanced' | 'volume' | 'intensity' | 'density' | 'technique'

export interface Session {
  id: string
  startedAt: number
  endedAt: number
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
}

export interface PR {
  value: number
  at: number
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
   * pressed. Subtracted from timed holds so the numbers mean what they say.
   */
  stopLatencySec: number
}

export interface AppState {
  version: 3
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
  unlocked: StepId[]
  sessions: Session[]
  prs: Record<string, PR>
  /** Achievement id -> unlock timestamp. */
  achievements: Record<string, number>
  /** Exercise id -> a demo video URL the user pinned themselves. */
  videoLinks: Record<string, string>
  profile: Profile
  /** Bodyweight / height log, oldest first. */
  measurements: Measurement[]
  /** When the weekly check was last dismissed, so it stops re-asking. */
  measureSnoozedAt?: number
  settings: Settings
}

/** Everything noteworthy that a saved session produced. */
export interface SessionEvents {
  prs: { exerciseId: string; value: number; previous?: number }[]
  achievements: string[]
  unlockedStep?: StepId
}
