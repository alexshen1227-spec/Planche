import type { AppState, Block, SkillId, Workout } from '../types'
import { skillOfStep, STEP_BY_ID } from '../data/progressions'
import { PRESS_LADDER } from '../data/pressing'
import { EXERCISE_BY_ID } from '../data/exercises'
import { SKILLS } from '../data/skills'
import { addDays, weekStart } from './time'
import { isAssisted } from './progression'

/**
 * The week's work, in the three currencies that move a planche: practice time
 * in the key position, pressing reps, and straight-arm accessory time.
 *
 * Volume control was invisible before: the coach trimmed and capped behind the
 * scenes, and the only weekly number on screen was a session count — which
 * says nothing about whether those sessions held the position for twenty
 * seconds or two hundred. Showing done against planned lets an athlete see
 * what a skipped session cost and what a short one still delivered.
 */

/** Rep work that builds planche pressing strength. */
const PRESSING = new Set([...PRESS_LADDER, 'pike-pushup', 'dip'])
/** Straight-arm accessory holds (the key hold is counted separately). */
const STRAIGHT_ARM_HOLDS = new Set(['planche-lean', 'ppp-hold', 'one-leg-lean', 'band-straddle-planche', 'frog-stand'])

export interface WeekWork {
  weekStart: number
  sessions: number
  /** Seconds held on the current step's key exercise in main work. */
  skillSec: number
  /** Reps of the skill's strength work (pressing for a planche, pulling for a lever). */
  pressReps: number
  /** Seconds of the skill's accessory holds (straight-arm leans for a planche). */
  straightArmSec: number
}

/**
 * The movements that count toward a skill's two accessory currencies: reps of
 * its strength work, and seconds of its support holds. The planche's are the
 * lists above; every other skill's come from its own session description, so a
 * movement added to a road is counted without being listed twice. Split by
 * what the movement is — a negative is counted in reps, a hang in seconds.
 */
const WORK_SETS = new Map<SkillId, { strength: Set<string>; support: Set<string> }>()
export function workSets(skill: SkillId): { strength: Set<string>; support: Set<string> } {
  const cached = WORK_SETS.get(skill)
  if (cached) return cached
  let sets: { strength: Set<string>; support: Set<string> }
  if (skill === 'planche') {
    sets = { strength: PRESSING, support: STRAIGHT_ARM_HOLDS }
  } else {
    const def = SKILLS[skill]
    const ids = new Set<string>(def.ladder?.rungs.map((rung) => rung.exerciseId) ?? [])
    for (const program of Object.values(def.program?.steps ?? {})) {
      for (const spec of [program?.twin, program?.strength, program?.support, program?.balance, program?.assisted, program?.transition]) {
        if (spec) ids.add(spec.exerciseId)
      }
    }
    sets = { strength: new Set(), support: new Set() }
    for (const id of ids) {
      const exercise = EXERCISE_BY_ID[id]
      if (!exercise) continue
      if (exercise.type === 'reps') sets.strength.add(id)
      // An earlier step's key hold, kept in a later step's session, is support work there.
      else sets.support.add(id)
    }
  }
  WORK_SETS.set(skill, sets)
  return sets
}

/** What this week has done so far (Monday-start weeks, like the rest of the app). */
export function weekWork(state: Pick<AppState, 'sessions' | 'stepId'>, now = Date.now()): WeekWork {
  const start = weekStart(now)
  const end = addDays(start, 7)
  const keyId = STEP_BY_ID[state.stepId].keyExerciseId
  const { strength: PRESSING, support: STRAIGHT_ARM_HOLDS } = workSets(skillOfStep(state.stepId))
  const out: WeekWork = { weekStart: start, sessions: 0, skillSec: 0, pressReps: 0, straightArmSec: 0 }
  for (const session of state.sessions) {
    if (session.startedAt < start || session.startedAt >= end || session.startedAt > now) continue
    out.sessions += 1
    for (const set of session.sets) {
      if (set.value <= 0 || set.section === 'warmup' || set.section === 'cooldown' || isAssisted(set)) continue
      if (set.exerciseId === keyId && set.kind === 'hold' && set.section === 'main') out.skillSec += set.value
      else if (PRESSING.has(set.exerciseId) && set.kind === 'reps') out.pressReps += set.value
      else if (STRAIGHT_ARM_HOLDS.has(set.exerciseId) && set.kind === 'hold') out.straightArmSec += set.value
    }
  }
  out.skillSec = Math.round(out.skillSec)
  out.straightArmSec = Math.round(out.straightArmSec)
  return out
}

/** One session's planned dose in the same currencies. */
export function sessionDose(workout: Pick<Workout, 'blocks'>, keyExerciseId: string): Omit<WeekWork, 'weekStart' | 'sessions'> {
  const dose = { skillSec: 0, pressReps: 0, straightArmSec: 0 }
  const owner = Object.values(STEP_BY_ID).find((step) => step.keyExerciseId === keyExerciseId)
  const { strength: PRESSING, support: STRAIGHT_ARM_HOLDS } = workSets(owner?.skill ?? 'planche')
  const amount = (b: Block) => (b.target.kind === 'hold' ? b.target.sec : b.target.reps) * b.sets
  for (const block of workout.blocks) {
    if (block.section === 'warmup' || block.section === 'cooldown') continue
    if (block.exerciseId === keyExerciseId && block.section === 'main' && block.target.kind === 'hold') {
      dose.skillSec += amount(block)
    } else if (PRESSING.has(block.exerciseId) && block.target.kind === 'reps') {
      dose.pressReps += amount(block)
    } else if (STRAIGHT_ARM_HOLDS.has(block.exerciseId) && block.target.kind === 'hold') {
      dose.straightArmSec += amount(block)
    }
  }
  return dose
}

export interface WeekPlan extends Omit<WeekWork, 'weekStart'> {}

/**
 * The week's plan: today's recommended dose times the sessions the athlete
 * means to train. An estimate by construction — each day's plan adapts — so it
 * is shown as "about", and only when today's session is a loaded one (a
 * recovery day's dose says nothing about a normal week).
 */
export function weekPlan(today: Pick<Workout, 'blocks'>, keyExerciseId: string, sessionsPerWeek: number): WeekPlan {
  const dose = sessionDose(today, keyExerciseId)
  return {
    sessions: sessionsPerWeek,
    skillSec: Math.round(dose.skillSec * sessionsPerWeek),
    pressReps: Math.round(dose.pressReps * sessionsPerWeek),
    straightArmSec: Math.round(dose.straightArmSec * sessionsPerWeek),
  }
}

/** Whether an exercise counts as pressing work in the weekly view. */
export function isPressingWork(exerciseId: string): boolean {
  return PRESSING.has(exerciseId) && EXERCISE_BY_ID[exerciseId]?.type === 'reps'
}
