import { EXERCISE_BY_ID } from '../data/exercises'
import { STEP_BY_ID } from '../data/progressions'
import type { AppState, AutoForm, FormCheck, FormIssue, FormRating, Session, SetLog, StepId, TrainingSurface } from '../types'
import { trustedCameraEvidence } from './formEvidence'

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
 * The criteria that make a variant *that* variant, per exercise.
 *
 * Partial grading lets the camera judge what it saw and report the rest as
 * unseen — but some criteria are not secondary. A one-leg planche whose
 * extended leg dropped out of tracking scored 100 with twelve clean seconds,
 * while the same clip with the leg visibly bent scored 78 and earned nothing:
 * less evidence produced more credit. When one of these is unseen, the camera
 * has not verified the variant, so the athlete must confirm it explicitly —
 * the same way true flight is confirmed.
 */
export const VARIANT_CRITICAL: Record<string, { criteria: string[]; prompt: string }> = {
  'ppp-hold': {
    criteria: ['forward lean'],
    prompt:
      'The camera could not see your lean. Confirm your shoulders stayed ahead of your wrists — with the shoulders over the hands it is a plank, a different exercise.',
  },
  'planche-lean': {
    criteria: ['forward lean'],
    prompt: 'The camera could not see your lean. Confirm your shoulders stayed clearly past your hands for the counted time.',
  },
  'one-leg-lean': {
    criteria: ['forward lean'],
    prompt: 'The camera could not see your lean. Confirm your shoulders stayed clearly past your hands for the counted time.',
  },
  'tuck-planche': {
    criteria: ['body line'],
    prompt:
      'The camera could not see your hip height. Confirm your hips stayed up near shoulder height rather than sinking into a supported crouch.',
  },
  'adv-tuck-planche': {
    criteria: ['hips', 'body line'],
    prompt:
      'The camera could not see your back and hips well enough. Confirm your back stayed flat and your hips open — a rounded back is a tuck, not an advanced tuck.',
  },
  'one-leg-planche': {
    criteria: ['knees', 'hips'],
    prompt:
      'The camera could not see your extended leg well enough. Confirm it stayed straight and in line with your body for the counted time.',
  },
  'straddle-planche': {
    criteria: ['knees', 'hips'],
    prompt: 'The camera could not see your legs well enough. Confirm both legs stayed straight and your hips stayed open.',
  },
  'full-planche': {
    criteria: ['knees', 'hips'],
    prompt:
      'The camera could not see your legs well enough. Confirm your legs stayed straight and together and your hips stayed open.',
  },
}

/** Variant-defining criteria this reading could not see, in the camera's own words. */
export function unseenVariantCriteria(exerciseId: string, auto: AutoForm | undefined): string[] {
  const critical = VARIANT_CRITICAL[exerciseId]
  if (!critical || !auto?.unseen?.length) return []
  return critical.criteria.filter((criterion) => auto.unseen!.includes(criterion))
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
 * Issues in the verified portion of the hold, before a sustained breakdown.
 * New camera checks preserve this distinction; older checks safely retain the
 * original all-issues behaviour.
 */
export function progressionRelevantIssues(
  auto: AutoForm | undefined,
): FormIssue[] {
  return auto?.heldIssues ?? auto?.issues ?? []
}

/**
 * The athlete's own rating, or nothing.
 *
 * A camera suggestion is stored in the same `rating` field so the rest screen
 * can pre-fill it — which made it easy for code to read a model guess as if
 * the athlete had said it. An unreviewed "broke" from the model was zeroing
 * the coach's record of a set no person had judged. Ratings written before
 * the camera existed carry neither `confirmed` nor a reading: those were
 * always the athlete's own tap.
 */
export function humanRating(form: FormCheck | undefined): FormRating | undefined {
  if (!form) return undefined
  if (form.confirmed === true) return form.rating
  if (form.confirmed === undefined && !form.auto) return form.rating
  return undefined
}

/** Reported assistance makes it a different task; unknown (older records) does not block. */
export function isAssisted(set: Pick<SetLog, 'assist'>): boolean {
  return set.assist !== undefined && set.assist !== 'none'
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
  if (!form.auto || form.auto.malformed) return false
  if (unseenVariantCriteria(exerciseId, form.auto).length > 0 && form.variantConfirmed !== true) return false
  const issues = progressionRelevantIssues(form.auto)
  return Boolean(
    form.auto.confidence >= MIN_PROGRESSION_FORM_CONFIDENCE &&
      issues.length <= MAX_PROGRESSION_FORM_ISSUES &&
      !issues.includes('arms') &&
      formEvidenceCoversArms(form.auto),
  )
}

/**
 * A progression set is stricter than a PR:
 * - it must be the step's main hold, not a warm-up/accessory/quick-log number;
 * - it must have an athlete-confirmed clean rating;
 * - its filmed form check must show no bent-arm fault and at most one isolated
 *   secondary flag, and any unseen variant-defining criterion confirmed;
 * - it must be unassisted, and not a record an import had to repair;
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
    !set.repaired?.length &&
    !isAssisted(set) &&
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
 * Performance credit for day-to-day coaching, deliberately separate from the
 * stricter progression gate. An athlete-confirmed camera result can cap a
 * stopwatch value when athlete and camera agree; an unreviewed or disputed
 * model guess cannot silently rewrite what the coach thinks the athlete did —
 * including a pending "broke" suggestion, which no longer zeroes the set.
 */
export function trainingSetValue(set: SetLog): number {
  if (set.value <= 0 || humanRating(set.form) === 'broke') return 0
  const cleanSeconds = trustedCameraEvidence(set) ? set.form?.auto?.cleanSeconds : undefined
  return cleanSeconds === undefined ? set.value : Math.min(set.value, Math.max(0, cleanSeconds))
}

/**
 * Which comparable task a set belongs to.
 *
 * A floor hold and a parallette hold are different tasks; so is a hold with a
 * band under the hips. Pooling them turned two flat series — eight seconds on
 * the floor, eighteen on parallettes — into an apparent six-seconds-a-week
 * improvement, and anchored floor targets on parallette numbers. `undefined`
 * surface is a legacy record whose task is unknown, kept as its own series.
 */
export interface LearningScope {
  /** Only sets on this surface; `null` means only untagged (legacy) sets. */
  surface?: TrainingSurface | null
  /** Only this side of a unilateral hold. */
  side?: 'left' | 'right'
}

/**
 * The attempt ended for a reason that says nothing about capacity: the
 * athlete reported an interruption or a timing problem, or the screen went
 * away mid-hold. Its value stays in history and volume, but it is not a
 * measure of what the athlete can hold — a working target anchored on it
 * would drop for a phone call.
 */
export function endedForNonCapacityReason(set: Pick<SetLog, 'endReason' | 'timing'>): boolean {
  return set.endReason === 'interruption' || set.endReason === 'timing' || set.timing?.method === 'interrupted'
}

function inScope(set: SetLog, scope: LearningScope | undefined): boolean {
  if (isAssisted(set)) return false
  if (!scope) return true
  if (scope.surface !== undefined) {
    if (scope.surface === null ? set.surface !== undefined : set.surface !== scope.surface) return false
  }
  if (scope.side && set.side !== scope.side) return false
  return true
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
 * key exercise — minus the parts the athlete or trusted camera evidence said
 * were not real. A set the *athlete* rated as broken down is not evidence a
 * strategy worked; an athlete-confirmed camera result can cap the stopwatch,
 * while a disputed or unreviewed model guess cannot. Quick Log is excluded like
 * everywhere else: it is a number typed in afterwards, not a session the coach
 * shaped. Assisted holds are a different task and never count.
 *
 * For a unilateral hold, a session's value is its *weaker* side when both
 * sides were trained: a coach that anchored on the stronger side prescribed
 * 2.5× the weaker side's best while promising to cap at the weaker dose.
 *
 * An attempt the athlete said was interrupted, or that a hidden screen cut
 * short, is not a capacity reading and is left out.
 */
export function sessionLearningValue(session: Session, stepId: StepId, scope?: LearningScope): number {
  const step = STEP_BY_ID[stepId]
  if (!step || session.workoutName === 'Quick Log') return 0
  const bestOf = (sideScope: LearningScope | undefined) =>
    session.sets.reduce((best, set) => {
      if (
        set.exerciseId !== step.keyExerciseId ||
        set.kind !== 'hold' ||
        set.section !== 'main' ||
        set.value <= 0 ||
        humanRating(set.form) === 'broke' ||
        endedForNonCapacityReason(set) ||
        !inScope(set, sideScope)
      ) {
        return best
      }
      return Math.max(best, trainingSetValue(set))
    }, 0)
  if (EXERCISE_BY_ID[step.keyExerciseId]?.perSide && !scope?.side) {
    const left = bestOf({ ...scope, side: 'left' })
    const right = bestOf({ ...scope, side: 'right' })
    // Both sides trained: the weaker one sets the dose. One side only (or the
    // other side failed at zero): the session says nothing about the pair, so
    // it contributes no bilateral value — the missing side is unknown, not
    // permission to inherit the stronger side's number.
    if (left > 0 && right > 0) return Math.min(left, right)
    const sided = session.sets.some((set) => set.exerciseId === step.keyExerciseId && set.side)
    return sided ? 0 : bestOf(scope)
  }
  return bestOf(scope)
}

/**
 * The prescribed target the latest comparable session stopped at, when its
 * key work was capped by that target rather than by the athlete.
 *
 * A clean stop at the target proves "at least this much", not "this much".
 * Every key main set reaching its target — or the athlete saying it ended at
 * target — makes that session's best a lower bound. Anchoring the next target
 * on it as if it were capacity let an obedient athlete's prescription echo
 * downward session after session (6 → 3 seconds in the audit's replay). Null
 * when the session went past its targets or fell short: then the numbers are
 * a real reading.
 */
export function sessionTargetCap(session: Session, stepId: StepId, surface: TrainingSurface | null): number | null {
  const step = STEP_BY_ID[stepId]
  if (!step) return null
  const key = session.sets.filter(
    (set) =>
      set.exerciseId === step.keyExerciseId &&
      set.kind === 'hold' &&
      set.section === 'main' &&
      set.value > 0 &&
      !endedForNonCapacityReason(set) &&
      humanRating(set.form) !== 'broke' &&
      inScope(set, { surface }),
  )
  if (!key.length) return null
  // Reached, and not meaningfully passed. The tolerance is the size of the
  // stop itself: the chime sounds at the target and the stopwatch is stopped
  // a moment later, so an obedient hold reads up to about a second over.
  const capped = key.every(
    (set) =>
      set.endReason === 'target' ||
      (set.value >= set.target - 0.05 && set.value <= set.target + Math.max(1, set.target * 0.1)),
  )
  return capped ? Math.max(...key.map((set) => set.target)) : null
}

/** How recent a completed prescription must be to hold the next one up. */
const CAPPED_FLOOR_DAYS = 14

/**
 * The base working target the latest comparable coach session was built from,
 * when its key work was completed as prescribed.
 *
 * The working target is a fraction of recent bests, and the hold screen tells
 * an athlete to stop once the target is reached — so an athlete who does
 * exactly that logged bests equal to their targets, and the next target came
 * out at a fraction of the last: a perfectly obedient simulated athlete went
 * from 5s to 1s in five sessions while getting stronger. Completing a target
 * is evidence it was within capacity, so the next base does not fall below
 * it. A miss is a real reading and lifts nothing; a max test re-anchors upward.
 */
export function completedBaseTarget(
  state: Pick<AppState, 'sessions'>,
  stepId: StepId,
  surface: TrainingSurface | null,
  now = Date.now(),
): number | null {
  const latest = [...state.sessions]
    .filter((s) => s.startedAt <= now && sessionLearningValue(s, stepId, { surface }) > 0)
    .sort((a, b) => b.startedAt - a.startedAt)[0]
  if (!latest || latest.baseTargetSec === undefined || latest.stepId !== stepId) return null
  if (now - latest.startedAt > CAPPED_FLOOR_DAYS * 86_400_000) return null
  return sessionTargetCap(latest, stepId, surface) !== null ? latest.baseTargetSec : null
}

/** The surface a session's key-hold work was done on, when it is unambiguous. */
export function sessionSurface(session: Session, stepId: StepId): TrainingSurface | null | 'mixed' {
  const step = STEP_BY_ID[stepId]
  if (!step) return null
  const surfaces = new Set(
    session.sets
      .filter((set) => set.exerciseId === step.keyExerciseId && set.section === 'main' && set.value > 0)
      .map((set) => set.surface ?? null),
  )
  if (surfaces.size === 0) return null
  if (surfaces.size > 1) return 'mixed'
  return [...surfaces][0]
}

export interface LearningPoint {
  at: number
  value: number
  /**
   * Set when the session's key work stopped at its prescribed targets: the
   * value is then a lower bound ("at least this much"), not a measurement.
   */
  cappedAt?: number
}

export interface LearningSeries {
  /** Which task the points came from. `null` = untagged legacy history. */
  surface: TrainingSurface | null
  points: LearningPoint[]
  /**
   * True when nothing comparable to the requested surface exists and the
   * series comes from the other one — an uncertain transfer, to be said
   * aloud and used only conservatively, never as measured progress.
   */
  transferred: boolean
}

/**
 * The comparable training history for one step, oldest first.
 *
 * Prefers the requested surface; falls back to untagged legacy history, then
 * — flagged as a transfer — to the other surface. Never pools two tasks.
 */
export function learningSeries(
  state: Pick<AppState, 'sessions'>,
  stepId: StepId,
  preferred: TrainingSurface,
  now = Number.POSITIVE_INFINITY,
): LearningSeries {
  const sorted = [...state.sessions]
    .filter((s) => s.startedAt <= now)
    .sort((a, b) => a.startedAt - b.startedAt)
  const seriesFor = (surface: TrainingSurface | null): LearningPoint[] =>
    sorted
      .map((s) => {
        const value = sessionLearningValue(s, stepId, { surface })
        const cap = value > 0 ? sessionTargetCap(s, stepId, surface) : null
        return { at: s.startedAt, value, ...(cap !== null ? { cappedAt: cap } : {}) }
      })
      .filter((p) => p.value > 0)
  const own = seriesFor(preferred)
  if (own.length) return { surface: preferred, points: own, transferred: false }
  const legacy = seriesFor(null)
  if (legacy.length) return { surface: null, points: legacy, transferred: false }
  const other: TrainingSurface = preferred === 'floor' ? 'parallettes' : 'floor'
  const transfer = seriesFor(other)
  return { surface: transfer.length ? other : preferred, points: transfer, transferred: transfer.length > 0 }
}

/**
 * A max test counts once something was attempted in its main block.
 *
 * Saving the warm-ups of a test whose attempts were all skipped used to award
 * "Complete a max test" and reset the coach's re-test clock, for a test that
 * never happened. A zero-second logged attempt still counts — that is a real,
 * failed attempt, which is information. Any main-section set qualifies: a
 * test's main block is its key hold, and a test can be run for a step other
 * than the one currently selected.
 */
export function testWasAttempted(session: Session): boolean {
  return session.workoutKind === 'test' && session.sets.some((set) => set.section === 'main')
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
