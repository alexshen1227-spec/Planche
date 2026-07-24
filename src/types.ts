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
  /** Seconds for holds, reps for rep work. */
  value: number
  target: number
  section: Section
  at: number
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
}

export interface AppState {
  version: 1
  onboarded: boolean
  name: string
  startedAt: number
  /** When the user last exported a backup file. */
  lastBackupAt?: number
  stepId: StepId
  unlocked: StepId[]
  sessions: Session[]
  prs: Record<string, PR>
  /** Achievement id -> unlock timestamp. */
  achievements: Record<string, number>
  /** Exercise id -> a demo video URL the user pinned themselves. */
  videoLinks: Record<string, string>
  settings: Settings
}

/** Everything noteworthy that a saved session produced. */
export interface SessionEvents {
  prs: { exerciseId: string; value: number; previous?: number }[]
  achievements: string[]
  unlockedStep?: StepId
}
