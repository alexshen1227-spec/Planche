import type { GymEquipmentId, Joint, Muscle, Unit } from '../../data/gym/catalog'
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
  /**
   * When each exercise's hard-here mark was last set or cleared (a cleared one
   * keeps its time, so the removal survives a merge). Absent on a save from
   * before per-mark times: the place's own `updatedAt` stands in.
   */
  hardHereAt?: Record<string, number>
  updatedAt: number
}

export type Rating = 'love' | 'fine' | 'avoid'

export interface GymSet {
  /**
   * Load in kg — the canonical unit, whatever was typed. Absent for a
   * bodyweight set. On an assisted machine, zero is confirmed no assistance
   * and an absent value means the help was never recorded.
   */
  kg?: number
  reps: number
  /** 6–10, half steps allowed. Absent when not asked or skipped. */
  rpe?: number
  /** The unit it was entered in, for showing it back the same way. */
  unit?: Unit
  warmup?: boolean
  at: number
  /** When this set was last corrected; two tabs' corrections merge set by set on it. */
  editedAt?: number
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

export interface RemainingLift {
  exerciseId: string
  repRange: [number, number]
  targetRpe: number
  restSec: number
  unit: Unit
  /** Loads stay in the display unit specified on this lift. */
  sets: { reps: number; load?: number; warmup?: boolean }[]
  swappedFrom?: string
}

export interface GymRemainder {
  items: RemainingLift[]
  avoidJoints?: Joint[]
  musclesOff?: Muscle[]
  volumeFactor?: number
  goals?: GoalWeights
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
  /** The unlogged prescription, kept separately from completed sets. */
  remaining?: GymRemainder
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
  /**
   * When each rating / favourite was last set or cleared, per exercise, so two
   * tabs merge them key by key and a removal survives. Absent on older saves:
   * `prefsUpdatedAt` stands in for any mark without a time.
   */
  ratingAtTime?: Record<string, number>
  favoriteAtTime?: Record<string, number>
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
  /** Index 0 is Sunday. An empty entry lets the planner use the usual place. */
  placeByDay?: (string | null)[]
  /** A single calendar date the athlete chose for lifting from the weekly comparison. */
  extraGymDate?: string
  /** Hours between hard straight-arm sessions of the same family. */
  straightArmRestHours: number
  /**
   * In season, the sport comes first: gym volume is kept lower (the weights
   * stay, the sets drop) and legs are kept fresh around games. Absent = off-season.
   */
  season?: 'off' | 'in'
  /**
   * The athlete's regular sport week ("practice Tuesday and Thursday, a game
   * on Saturday"), entered once. The planner reads each slot like a logged
   * activity on that day; a log on the same day replaces it. Absent = none.
   */
  sportSchedule?: SportSlot[]
  /**
   * When each field above was last changed, by field name, so two tabs merge
   * them one by one: tab A's goals survive tab B's new schedule. Absent on
   * older saves: `updatedAt` stands in for any field without a time.
   */
  fieldTimes?: Record<string, number>
  updatedAt: number
}

/** One regular sport session in the week. At most one per weekday. */
export interface SportLoadAreas {
  legs: boolean
  upperPush?: boolean
  upperPull?: boolean
}

export interface SportSlot extends SportLoadAreas {
  /** 0 = Sunday … 6 = Saturday, like `minutesByDay`. */
  weekday: number
  kind: ActivityKind
  minutes: number
  /** How hard it usually is, 1–10. */
  rpe: number
  /** Local start hour, 0–23. Absent = 17:00. */
  hour?: number
}

export type ActivityKind = 'sprint' | 'practice' | 'game' | 'pe' | 'run' | 'climb' | 'other'

/** Training that happens outside the app — a sport, a run, PE — counted toward fatigue. */
export interface OutsideActivity extends SportLoadAreas {
  id: string
  at: number
  kind: ActivityKind
  minutes: number
  /** How hard it was, 1–10. */
  rpe: number
  note?: string
  updatedAt: number
}
