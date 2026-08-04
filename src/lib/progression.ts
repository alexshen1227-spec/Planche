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
/** One isolated secondary flag is tolerated; two means the shape is not mastered. */
export const MAX_PROGRESSION_FORM_ISSUES = 1
const TRUE_FLIGHT_EXERCISES = new Set([
  'tuck-planche',
  'adv-tuck-planche',
  'one-leg-planche',
  'straddle-planche',
  'full-planche',
])

/** Ground contact is not observable enough in a side-on 2D pose to infer. */
export function requiresFlightConfirmation(exerciseId: string): boolean {
  return TRUE_FLIGHT_EXERCISES.has(exerciseId)
}

/**
 * The camera now grades whatever it can see and reports the rest as unseen,
 * so a knee out of shot no longer voids an otherwise good check. Locked arms
 * are the exception: they are what makes a straight-arm skill that skill, so
 * an unlock is never granted on a clip where the elbows were never visible.
 * Records written before partial grading existed carry no `unseen` list and
 * were fully covered by definition.
 */
export function formEvidenceCoversArms(auto: NonNullable<SetLog['form']>['auto']): boolean {
  return !auto?.unseen?.includes('elbows')
}

/**
 * The second half of the mastery gate. Most skills need a successful camera
 * check with at most one isolated secondary flag. A bent-arm flag is never
 * tolerated because straight arms define every graded planche progression.
 * Frog Stand intentionally has no
 * honest fixed geometry for the model to grade, so it needs a filmed replay
 * that the athlete explicitly reviewed against the checklist instead.
 */
export function passesProgressionFormCheck(form: SetLog['form'], exerciseId: string): boolean {
  if (!form) return false
  if (exerciseId === 'frog-stand') {
    return form.visualReviewPassed === true
  }
  if (requiresFlightConfirmation(exerciseId) && form.flightConfirmed !== true) return false
  return Boolean(
    form.auto &&
      form.auto.confidence >= MIN_PROGRESSION_FORM_CONFIDENCE &&
      form.auto.issues.length <= MAX_PROGRESSION_FORM_ISSUES &&
      !form.auto.issues.includes('arms') &&
      formEvidenceCoversArms(form.auto),
  )
}

/**
 * A progression set is stricter than a PR:
 * - it must be the step's main hold, not a warm-up/accessory/quick-log number;
 * - it must have an athlete-confirmed clean rating;
 * - its filmed form check must show no bent-arm fault and at most one isolated
 *   secondary flag;
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

/**
 * Camera analysis can see a hold start clean and then break down. Keep the
 * honest PR, but only credit the clean portion toward progression. Older
 * evidence has no cleanSeconds field and retains its historical value.
 */
export function progressionCredit(set: SetLog, exerciseId: string): number {
  if (!isQualifyingSet(set, exerciseId)) return 0
  const cameraClean = set.form?.auto?.cleanSeconds
  return cameraClean === undefined ? set.value : Math.min(set.value, Math.max(0, cameraClean))
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
    return {
      value: sets.reduce(
        (best, set) => Math.max(best, progressionCredit(set, step.keyExerciseId)),
        0,
      ),
    }
  }

  const left = sets
    .filter((set) => set.side === 'left')
    .reduce((best, set) => Math.max(best, progressionCredit(set, step.keyExerciseId)), 0)
  const right = sets
    .filter((set) => set.side === 'right')
    .reduce((best, set) => Math.max(best, progressionCredit(set, step.keyExerciseId)), 0)
  return { value: Math.min(left, right), left, right }
}

/** Clean progression value achieved inside one session. */
export function qualifyingSessionValue(session: Session, stepId: StepId): number {
  const state = { sessions: [session] }
  return qualifyingProgress(state, stepId).value
}

/**
 * What the coach measures a session against when learning which session shape
 * works — deliberately a lower bar than progression credit.
 *
 * Unlocking a harder skill demands the whole evidence chain (athlete-confirmed
 * Clean, a passing camera check, confirmed flight) because handing out a skill
 * nobody earned is the expensive mistake. "Did this session shape move my
 * hold?" is a different question, and holding it to the unlock bar meant an
 * athlete who does not film and confirm every single set taught the coach
 * nothing at all: every strategy sat at "not tested yet" forever, however long
 * they trained.
 *
 * So this asks only what it needs to — the best main-set hold of the step's
 * key exercise — minus the parts the athlete or the camera said were not real:
 * a set rated as broken down is not evidence a strategy worked, and where a
 * filmed set measured a clean window, that window is the number rather than
 * the stopwatch. Quick Log is excluded like everywhere else: it is a number
 * typed in afterwards, not a session the coach shaped.
 */
export function sessionLearningValue(session: Session, stepId: StepId): number {
  const step = STEP_BY_ID[stepId]
  if (!step || session.workoutName === 'Quick Log') return 0
  return session.sets.reduce((best, set) => {
    if (
      set.exerciseId !== step.keyExerciseId ||
      set.kind !== 'hold' ||
      set.section !== 'main' ||
      set.value <= 0 ||
      set.form?.rating === 'broke'
    ) {
      return best
    }
    const cleanSeconds = set.form?.auto?.cleanSeconds
    const value =
      cleanSeconds !== undefined ? Math.min(set.value, Math.max(0, cleanSeconds)) : set.value
    return Math.max(best, value)
  }, 0)
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
