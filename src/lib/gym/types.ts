import type { GymEquipmentId, Unit } from '../../data/gym/catalog'
import type { LocationEquipment } from '../../data/gym/exercises'

/** A named place to train, with what is there. */
export interface GymLocation {
  id: string
  name: string
  /** The unit loads are entered and shown in here, unless a piece of equipment says otherwise. */
  unit: Unit
  equipment: LocationEquipment[]
  /**
   * Per-equipment detail: its own unit (a kg gym with lb dumbbells), its top
   * weight (dumbbells run out), and its smallest step — all in kg.
   */
  gear?: Partial<Record<GymEquipmentId, { unit?: Unit; maxKg?: number; stepKg?: number }>>
  /** Exercises that are hard to do here (always busy, awkward machine): offered last. */
  hardHere?: string[]
  updatedAt: number
}

export type Rating = 'love' | 'fine' | 'avoid'

export interface GymSet {
  /**
   * Load in kg — the canonical unit, whatever was typed. Absent for a
   * bodyweight set; for an assisted machine it is the assistance.
   */
  kg?: number
  reps: number
  /** 6–10, half steps allowed. Absent when not asked or skipped. */
  rpe?: number
  /** The unit it was entered in, for showing it back the same way. */
  unit?: Unit
  warmup?: boolean
  at: number
}

export interface GymExerciseLog {
  exerciseId: string
  sets: GymSet[]
  /** What it replaced on the day ("this machine is taken"). */
  swappedFrom?: string
  /** The rep range and effort it was programmed with. */
  repRange?: [number, number]
  targetRpe?: number
  note?: string
}

export interface GymSession {
  id: string
  locationId: string
  startedAt: number
  endedAt: number
  name: string
  exercises: GymExerciseLog[]
  notes?: string
  completion?: 'full' | 'partial'
  updatedAt?: number
}

export interface GymState {
  locations: GymLocation[]
  activeLocationId?: string
  sessions: GymSession[]
  /** Tombstones, so a deletion on one tab is not undone by another's merge. */
  deletedSessionIds?: string[]
  deletedLocationIds?: string[]
  /** love / fine / avoid, per exercise. */
  ratings: Record<string, Rating>
  /** Exercise → the location the athlete prefers to do it at. */
  favoriteAt: Record<string, string>
  prefsUpdatedAt?: number
  /** Goals, muscles and schedule the planner reads. Absent until set. */
  prefs?: TrainingPrefs
  /** Sports and activities outside the app, counted toward fatigue. */
  activities?: OutsideActivity[]
  deletedActivityIds?: string[]
}

/** How much each goal matters to the athlete, 0 (not at all) to 5 (most). */
export interface GoalWeights {
  strength: number
  power: number
  physique: number
  skills: number
  endurance: number
}

/** "Advanced tuck planche by Dec 31." */
export interface SkillGoal {
  id: string
  skill: import('../../types').SkillId
  stepId: import('../../types').StepId
  /** Local calendar date, YYYY-MM-DD. */
  by: string
}

/** The planner's inputs the athlete sets (Phase 3 of Fitness Lab). */
export interface TrainingPrefs {
  goals: GoalWeights
  skillGoals: SkillGoal[]
  /** Muscles the gym should not train ("no legs — I sprint"). */
  musclesOff: import('../../data/gym/catalog').Muscle[]
  /** Lagging muscles that get extra weekly sets. */
  musclesPriority: import('../../data/gym/catalog').Muscle[]
  /** Minutes available on each weekday, Sunday first; 0 = a rest day. */
  minutesByDay: number[]
  /** Hours between hard straight-arm sessions of the same family. */
  straightArmRestHours: number
  updatedAt: number
}

export type ActivityKind = 'sprint' | 'practice' | 'game' | 'pe' | 'run' | 'other'

/** Training that happens outside the app — a sport, a run, PE — counted toward fatigue. */
export interface OutsideActivity {
  id: string
  at: number
  kind: ActivityKind
  minutes: number
  /** How hard it was, 1–10. */
  rpe: number
  /** Whether it loaded the legs hard (sprints, jumps, a game). */
  legs: boolean
  note?: string
  updatedAt: number
}
