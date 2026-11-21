import type { BlockRole, BodyRegion, EquipmentId, Exercise, FormIssue, SkillId, StepDef, StepId } from '../../types'

/**
 * What a skill is made of, as data.
 *
 * The planche was written first and by hand; its session builder lives in
 * `data/workouts.ts` and stays there. Every other skill is described here —
 * its road, its movements and the shape of a session at each step — and one
 * builder (`data/skillSession.ts`) turns that description plus the coach's plan
 * into a workout. Adding a skill is then a file of data rather than another
 * six hundred lines of assembly.
 */

/** How a movement family pairs inside one session. */
export type SkillFamily = 'push' | 'pull' | 'balance' | 'lateral'

/** A block before the coach's plan has shaped it: what to do, and roughly how much. */
export interface BlockSpec {
  exerciseId: string
  /** Sets on an ordinary day; the strategy and the day's volume scale it. */
  sets: number
  /** Seconds for a hold, reps for rep work — which one is the exercise's own type. */
  amount: number
  /** Rest after each set. `main` and `accessory` take the plan's values. */
  rest?: 'main' | 'accessory' | number
  note?: string
  /** Warm-up items a short warm-up leaves out. */
  skipWhenShort?: boolean
}

/** The shape of a session at one step of a skill's road. */
export interface StepProgram {
  /**
   * The moving version of this step's hold — the push-up or pull that shares
   * its shape. Programmed after the key holds, and (like the planche's) one
   * step behind until the hold is half-way to its bar.
   */
  twin?: BlockSpec
  /** A second strength movement at another angle. */
  strength?: BlockSpec
  /** Straight-arm or support work that feeds the position at a load that repeats. */
  support?: BlockSpec
  /** Low-fatigue balance or position practice. */
  balance?: BlockSpec
  /** The same shape with help, when the kit for it is owned. Never counts toward an unlock. */
  assisted?: BlockSpec
  /** Trunk work this step leans on. The first is kept longest. */
  core: BlockSpec[]
  /** The drill that teaches the change to the next step, once the bridge is open. */
  transition?: BlockSpec
  /** One sentence added to the key hold's note while the bridge is open. */
  bridgeCue?: string
  /** Stretches after the session, beyond the skill's standard cooldown. */
  mobility?: BlockSpec
}

/** Words the coach uses that differ from skill to skill. */
export interface SkillWords {
  /** The strength work behind the hold: "pressing", "pulling". */
  strength: string
  /** One rep of it: "press", "pull". */
  strengthVerb: string
  /** What the support accessory is: "leans", "hangs". */
  support: string
  /** What the hands hold: "the floor", "the bar", "the pole". */
  contact: string
  /** How the summit reads in a sentence: "the full planche". */
  summit: string
}

/** What the coach says and does when the camera keeps naming one fault, for this skill. */
export interface IssueGuidance {
  /** How the fault reads in a sentence: "elbows bending". */
  label: string
  /** The limiter chip. */
  limiter: string
  emphasis: 'pressing' | 'scapula' | 'balance' | 'core' | 'lockout' | 'none'
  prescription: string
}

/** A rung of a rep ladder: a movement and the standard that opens the next one. */
export interface RepRung {
  exerciseId: string
  /** Reps to start at when nothing is logged. */
  startReps: number
  /** One set of this many full reps — filmed, rated Clean and passed on the replay — opens the next rung. */
  standardReps: number
  /** Plain-language reason this rung is where it is. */
  why: string
  /**
   * What every counted rep has to show on the replay. No camera count stands
   * behind a rung — at three samples a second the judge cannot vouch for the
   * bottom of a rep (ledger §13) — so this list, checked by the athlete against
   * their own footage, is the evidence.
   */
  check: string[]
  /** The shape the set makes in the picture: wide (phone on its side) or tall (phone upright). */
  frame: 'wide' | 'tall'
  /**
   * A step that must be open before this rung is: a freestanding push-up is
   * not trained before the freestanding handstand. Usually on the skill's own
   * hold road; it may be on another skill's — the 90° push-up's last rungs
   * start and finish in a handstand, so they wait for the handstand road.
   */
  needsStep?: StepId
}

/**
 * A ladder of rep movements that progresses on its own standards, beside the
 * hold road rather than behind it: the handstand push-up line does not wait
 * for the freestanding handstand, and the reverse.
 */
export interface RepLadder {
  id: string
  name: string
  /** What the top rung is, in a sentence. */
  summit: string
  /** How well-sourced the line's order and its rep numbers are, in a sentence its screens show. */
  sourcing: string
  rungs: RepRung[]
}

export interface SkillDef {
  id: SkillId
  /** "Front lever". */
  name: string
  /** A chip-sized name: "Lever". */
  short: string
  /** What the hold road is called in a sentence: "front lever", "handstand". */
  holdName: string
  tagline: string
  /** Two or three sentences on what the skill is and what training it involves. */
  blurb: string
  family: SkillFamily
  /**
   * Straight-arm strength work under high load — the kind two skills in one
   * session share an elbow budget for.
   */
  straightArm: boolean
  /** Hand support is a variable worth keeping apart (floor against parallettes). */
  surfaces: boolean
  /**
   * Kit the road cannot be trained without: every inner list needs at least
   * one item owned. Empty = floor space is enough.
   */
  requires: EquipmentId[][]
  /** What to say when that kit is missing. */
  requiresNote?: string
  /** Joint regions this skill loads hardest, most first — for pairing and for pain days. */
  loads: BodyRegion[]
  /** How well-sourced this road is, in a sentence the skill's screens show. */
  sourcing: string
  /** What coaches commonly ask for before starting. Advice shown to the athlete — never a gate. */
  prerequisites: string[]
  /** Things worth knowing before training it. Never a promise of safety. */
  safety: string[]
  /** How often coaches train it, as they state it. */
  frequency: string
  /** How the camera has to be placed, in one sentence. */
  camera: {
    view: 'side' | 'front'
    placement: string
    /** What the camera can and cannot judge on this skill, said plainly. */
    honesty: string
  }
  steps: StepDef[]
  /** The step a new athlete aims at by default. */
  defaultGoal: StepId
  words: SkillWords
  /** Total seconds of key-hold practice a session aims at (the planche's minute, per skill). */
  holdAggregateSec: number
  /**
   * The longest rest between this skill's holds. Absent = the plan's main
   * rest. Balance practice is low in load and does not need a strength hold's
   * rest; a design choice, like every rest length here.
   */
  holdRestMaxSec?: number
  /** The session's shape at each step. Absent for the planche, which is built by hand. */
  program?: {
    warmup: BlockSpec[]
    /** An easy rehearsal of the position, last in the warm-up. `at` = the step it first appears from. */
    primer?: (stepId: StepId) => BlockSpec | undefined
    steps: Partial<Record<StepId, StepProgram>>
    cooldown: BlockSpec[]
  }
  /** A rep line with its own standards (the handstand push-up, the 90° push-up). */
  ladder?: RepLadder
  /** Fault-specific coaching, where it differs from the planche's. */
  issues?: Partial<Record<FormIssue, IssueGuidance>>
  /** This skill's movements. */
  exercises: Exercise[]
  /** Roles a block of this skill can have, in the order a session lists them. */
  order?: BlockRole[]
}
