import { EXERCISE_BY_ID } from '../data/exercises'
import { STEP_BY_ID } from '../data/progressions'
import type { AppState, Session, SetLog, StepId } from '../types'

export interface Qualification {
  value: number
  left?: number
  right?: number
}

/**
 * A progression set is stricter than a PR:
 * - it must be the step's main hold, not a warm-up/accessory/quick-log number;
 * - it must have an athlete-confirmed clean rating;
 * - unilateral steps are limited by the weaker side.
 *
 * Older saved ratings have no `confirmed` field and remain valid; completely
 * unrated numbers do not unlock a harder skill.
 */
export function isQualifyingSet(set: SetLog, exerciseId: string): boolean {
  return (
    set.exerciseId === exerciseId &&
    set.kind === 'hold' &&
    set.section === 'main' &&
    set.value > 0 &&
    Boolean(set.form && set.form.confirmed !== false && set.form.rating === 'clean')
  )
}

export function qualifyingProgress(
  state: Pick<AppState, 'sessions'>,
  stepId: StepId,
  extraSessions: Session[] = [],
): Qualification {
  const step = STEP_BY_ID[stepId]
  const sets = [...state.sessions, ...extraSessions]
    .filter((session) => session.workoutName !== 'Quick Log')
    .flatMap((session) => session.sets.filter((set) => isQualifyingSet(set, step.keyExerciseId)))
  if (!EXERCISE_BY_ID[step.keyExerciseId]?.perSide) {
    return { value: sets.reduce((best, set) => Math.max(best, set.value), 0) }
  }

  const left = sets.filter((set) => set.side === 'left').reduce((best, set) => Math.max(best, set.value), 0)
  const right = sets.filter((set) => set.side === 'right').reduce((best, set) => Math.max(best, set.value), 0)
  return { value: Math.min(left, right), left, right }
}

/** Clean progression value achieved inside one session. */
export function qualifyingSessionValue(session: Session, stepId: StepId): number {
  const state = { sessions: [session] }
  return qualifyingProgress(state, stepId).value
}

export function setNeedsFormConfirmation(set: SetLog, state: Pick<AppState, 'stepId'>): boolean {
  const step = STEP_BY_ID[state.stepId]
  return (
    set.exerciseId === step.keyExerciseId &&
    set.kind === 'hold' &&
    set.section === 'main' &&
    set.value >= step.unlockSec &&
    (!set.form || set.form.confirmed === false)
  )
}
