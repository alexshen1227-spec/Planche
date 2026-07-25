import { EXERCISE_BY_ID } from '../data/exercises'
import { STEP_BY_ID } from '../data/progressions'
import type { AppState, Session, SetLog, StepId } from '../types'

export interface Qualification {
  value: number
  left?: number
  right?: number
}

/** A successful pose result is already coverage- and confidence-gated. */
export const MIN_PROGRESSION_FORM_CONFIDENCE = 0.35
/** One isolated camera flag is tolerated; two means the shape is not mastered. */
export const MAX_PROGRESSION_FORM_ISSUES = 1

/**
 * The second half of the mastery gate. Most skills need a successful camera
 * check with at most one isolated flag. Frog Stand intentionally has no
 * honest fixed geometry for the model to grade, so it needs a filmed replay
 * that the athlete explicitly reviewed against the checklist instead.
 */
export function passesProgressionFormCheck(form: SetLog['form'], exerciseId: string): boolean {
  if (!form) return false
  if (exerciseId === 'frog-stand') {
    return form.visualReviewPassed === true
  }
  return Boolean(
    form.auto &&
      form.auto.confidence >= MIN_PROGRESSION_FORM_CONFIDENCE &&
      form.auto.issues.length <= MAX_PROGRESSION_FORM_ISSUES,
  )
}

/**
 * A progression set is stricter than a PR:
 * - it must be the step's main hold, not a warm-up/accessory/quick-log number;
 * - it must have an athlete-confirmed clean rating;
 * - its filmed form check must be clean or show at most one isolated flag;
 * - unilateral steps are limited by the weaker side.
 *
 * Old/unrated numbers remain honest PRs but cannot unlock a harder skill
 * without both forms of evidence.
 */
export function isQualifyingSet(set: SetLog, exerciseId: string): boolean {
  return (
    set.exerciseId === exerciseId &&
    set.kind === 'hold' &&
    set.section === 'main' &&
    set.value > 0 &&
    Boolean(set.form && set.form.confirmed === true && set.form.rating === 'clean') &&
    passesProgressionFormCheck(set.form, exerciseId)
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

export function setNeedsProgressionFormEvidence(set: SetLog, state: Pick<AppState, 'stepId'>): boolean {
  const step = STEP_BY_ID[state.stepId]
  return (
    set.exerciseId === step.keyExerciseId &&
    set.kind === 'hold' &&
    set.section === 'main' &&
    set.value >= step.unlockSec &&
    !isQualifyingSet(set, step.keyExerciseId)
  )
}
