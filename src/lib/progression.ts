import { EXERCISE_BY_ID } from '../data/exercises'
import { STEP_BY_ID } from '../data/progressions'
import type { AppState, AutoForm, FormCheck, FormIssue, FormRating, Session, SetLog, StepId, TrainingSurface } from '../types'
import { trustedCameraEvidence } from './formEvidence'
import { PROGRESSION_STOP_LATENCY_SEC, WALK_BACK_MAX_SEC } from './sessionTiming'

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
 * How much of a hold the camera can vouch for as clean.
 *
 * `cleanRatio` is the time before a sustained breakdown, measured against the
 * tolerant momentary envelope — the right number for training dose, where a
 * hold that stayed together counts whatever its shape. But when bent arms sat
 * *inside* that window (`heldIssues`), none of it was clean for the criterion
 * that blocks progression outright: a soft elbow held at the same angle for
 * the whole set never "breaks down", and the result read "bent arms" beside a
 * green "clean window 7.4s of 7.4s" — and the form trend reported 100% clean
 * holds for an athlete whose camera flagged their arms on most sets.
 */
export function verifiedCleanRatio(auto: AutoForm | undefined): number | undefined {
  if (!auto || auto.cleanRatio === undefined) return undefined
  if (progressionRelevantIssues(auto).includes('arms')) return 0
  return cleanTimeVerifiable(auto) ? auto.cleanRatio : undefined
}

/** `verifiedCleanRatio`, in seconds. */
export function verifiedCleanSeconds(auto: AutoForm | undefined): number | undefined {
  if (!auto || auto.cleanSeconds === undefined) return undefined
  if (progressionRelevantIssues(auto).includes('arms')) return 0
  return cleanTimeVerifiable(auto) ? auto.cleanSeconds : undefined
}

/** Below this share of the hold seen in full, clean time is not verified. */
export const MIN_VERIFIED_COVERAGE = 0.6

/**
 * Whether a reading's clean time can be called camera-verified at all.
 *
 * The 2026-10 camera audit found two ways "unknown" was being reported as
 * "verified": a reading whose elbows were never judged showed a full green
 * clean window (straight arms define the skill, so clean time without them is
 * not clean time), and a hold the camera mostly did not see could still certify
 * every second of it. Either way the honest answer is "unknown" — not zero,
 * which would claim a fault nobody measured. Readings from before coverage was
 * recorded keep their judged value; a malformed one is never verified.
 */
export function cleanTimeVerifiable(auto: AutoForm): boolean {
  if (auto.malformed) return false
  if (auto.unseen?.includes('elbows')) return false
  return auto.coverage === undefined || auto.coverage >= MIN_VERIFIED_COVERAGE
}

/** The three answers a camera reading can give about clean time. */
export type CleanEvidence =
  | { state: 'verified'; seconds: number; ratio: number }
  | { state: 'fault'; seconds: 0 }
  | { state: 'unknown'; reason: 'elbows' | 'coverage' | 'malformed' | 'missing' }

/** One canonical reading of clean time, for every badge, panel and coach line. */
export function cleanEvidence(auto: AutoForm | undefined): CleanEvidence {
  if (!auto || auto.cleanSeconds === undefined || auto.cleanRatio === undefined) return { state: 'unknown', reason: 'missing' }
  if (auto.malformed) return { state: 'unknown', reason: 'malformed' }
  if (progressionRelevantIssues(auto).includes('arms')) return { state: 'fault', seconds: 0 }
  if (auto.unseen?.includes('elbows')) return { state: 'unknown', reason: 'elbows' }
  if (auto.coverage !== undefined && auto.coverage < MIN_VERIFIED_COVERAGE) return { state: 'unknown', reason: 'coverage' }
  return { state: 'verified', seconds: auto.cleanSeconds, ratio: auto.cleanRatio }
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
      formEvidenceCoversArms(form.auto) &&
      // A hold the camera mostly did not see is not a verified one, however
      // clean the moments it did see were (judge v4+; older readings carry no
      // coverage and keep their judged value).
      (form.auto.coverage === undefined || form.auto.coverage >= MIN_VERIFIED_COVERAGE),
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
  const auto = set.form?.auto
  const cameraClean = auto?.cleanSeconds
  if (cameraClean === undefined) return set.value
  // The camera vouches for a stretch of the clip, not for a number of
  // seconds. Credit is the part of the hold's counted stretch that the
  // verified stretch covers: a hold re-timed to a disjoint stretch of the clip
  // (2–8 s analysed, now marked 20–26 s) kept its six seconds of credit while
  // the panel warned it was stale — now it earns nothing until it is checked
  // again, and a same-start extension stays capped at what was verified.
  const verifiedFrom = auto?.analysedFromSec ?? 0
  const verifiedTo = verifiedFrom + Math.max(0, cameraClean)
  const counted = countedClipWindow(set)
  const overlap = Math.max(
    0,
    Math.min(verifiedTo, counted.startSec + counted.lengthSec) - Math.max(verifiedFrom, counted.startSec),
  )
  return Math.min(set.value, overlap)
}

/**
 * Where a set's hold sits on its clip, in clip seconds: the marked stretch for
 * a hold timed from the video, otherwise from the clip's start for the
 * credited hold less any time that passed before recording began.
 */
export function countedClipWindow(
  set: Pick<SetLog, 'value' | 'timing' | 'recordingOffsetSec'>,
): { startSec: number; lengthSec: number } {
  const timing = set.timing
  if (timing?.method === 'video' && timing.videoStartSec !== undefined && timing.videoEndSec !== undefined) {
    return { startSec: timing.videoStartSec, lengthSec: Math.max(0, timing.videoEndSec - timing.videoStartSec) }
  }
  return { startSec: 0, lengthSec: Math.max(0, set.value - (set.recordingOffsetSec ?? 0)) }
}

/**
 * Whether a camera reading was taken over the stretch of the clip a set's hold
 * occupies *now*. A check started before the hold was re-timed finishes for
 * the old stretch; applied anyway, it relabelled the new one with evidence
 * about the old. Start-matched readings that cover less than the hold are
 * fine — credit is already capped at what they verified.
 */
export function readingFitsWindow(
  auto: Pick<AutoForm, 'analysedFromSec'>,
  window: { startSec: number },
): boolean {
  return Math.abs((auto.analysedFromSec ?? 0) - window.startSec) <= 0.1
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
 * Whether a session's verified value is a floor: every qualifying hold that
 * reached it came down at its target call. The same reading as
 * `sessionLearningPoint`, on the verified series the forecast, plateau and
 * capability-jump readers use.
 */
export function qualifyingValueIsFloor(session: Session, stepId: StepId, value: number): boolean {
  const step = STEP_BY_ID[stepId]
  if (!step || value <= 0 || session.workoutName === 'Quick Log') return false
  const key = step.keyExerciseId
  const credit = (set: SetLog) => progressionCredit(set, key)
  const qualifying = session.sets.filter((set) => isQualifyingSet(set, key) && credit(set) > 0)
  // A maximal effort at the bar measured the session.
  if (qualifying.some((set) => isBarAttempt(set, stepId))) return false
  // The holds the value came from: for a unilateral hold, the weaker side's
  // best, which is the value — the stronger side's lesser sets can match it.
  let top = qualifying.filter((set) => Math.abs(credit(set) - value) <= 0.05)
  if (EXERCISE_BY_ID[key]?.perSide) {
    const bestOn = (side: 'left' | 'right') =>
      qualifying.filter((set) => set.side === side).reduce((best, set) => Math.max(best, credit(set)), 0)
    const left = bestOn('left')
    const right = bestOn('right')
    if (Math.abs(left - right) > 0.05) top = top.filter((set) => set.side === (left < right ? 'left' : 'right'))
  }
  // A verified hold carries the reading the athlete confirmed, so the camera
  // decides here even with the one secondary flag that keeps it from counting
  // as trusted. Not the credit: that is capped at the logged value, which a
  // quick walker's walk allowance pulls under the target.
  return top.length > 0 && top.every((set) => !cameraMeasured(set, set.form?.auto) && stoppedAtTarget(set, stepId))
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
  const auto = trustedCameraEvidence(set) ? set.form?.auto : undefined
  const cleanSeconds = auto?.cleanSeconds
  if (auto === undefined || cleanSeconds === undefined) return set.value
  return Math.min(set.value, Math.max(0, cleanSeconds) + unfilmedAfterCleanFilm(auto))
}

/**
 * The unfilmed tail of a hold whose footage stayed clean to its last frame.
 * The cap above is time before a breakdown; a recording that stopped early
 * saw none, so the seconds it missed are not taken off the training dose.
 * (They still earn no progression credit — that runs on what was verified.)
 */
function unfilmedAfterCleanFilm(auto: AutoForm | undefined): number {
  if (!auto) return 0
  const unfilmed = auto.unfilmedSec ?? 0
  if (unfilmed <= 0 || auto.analysedSec === undefined || auto.cleanSeconds === undefined) return 0
  // Three numbers each rounded to a tenth.
  return auto.cleanSeconds >= auto.analysedSec - unfilmed - 0.15 ? unfilmed : 0
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
/**
 * One set as a reading of what the athlete can hold.
 *
 * A hold stopped at its target call reached the target: the screen asks for
 * exactly that, and the fixed walk-back allowance can land its log a second
 * or two under. Read at the logged value, every such hold looked like a
 * shortfall — and since targets are capped at the best recent reading, a
 * compliant athlete who walks back faster than the allowance had their target
 * shaved each session. Trusted camera evidence of an earlier breakdown still
 * wins: a cap below the logged value is a seen breakdown, not an artifact.
 */
export function capacityReading(set: SetLog): number {
  const value = trainingSetValue(set)
  // The athlete said balance, technique or effort ended it — the walk
  // overlapped the call rather than following it — or set the number
  // themselves, re-timing it from the video or editing it: the logged value is
  // the reading. Lifted, an 8.2s hold marked on its clip read as a 10s floor.
  if (
    set.calledAtTarget !== true ||
    endedAtLimit(set) ||
    set.timing?.method === 'video' ||
    set.timing?.method === 'edited'
  ) {
    return value
  }
  // Filmed, confirmed and agreed: the check runs up to the target, so the
  // camera saw how long the position actually lasted — believe it over the
  // assumption, either way.
  const auto = trustedCameraEvidence(set) ? set.form?.auto : undefined
  if (auto?.cleanSeconds !== undefined) return Math.max(value, Math.min(set.target, auto.cleanSeconds))
  return Math.max(value, set.target)
}

export function sessionLearningValue(session: Session, stepId: StepId, scope?: LearningScope): number {
  return sessionLearningPoint(session, stepId, scope).value
}

/** The athlete said the hold ended at their limit: balance, technique or effort. */
function endedAtLimit(set: Pick<SetLog, 'endReason'>): boolean {
  return set.endReason === 'balance' || set.endReason === 'technique' || set.endReason === 'effort'
}

/**
 * A hold that came down at its target call: it says "at least this much",
 * not how far the athlete could have gone. The hold screen asks for exactly
 * that stop, so an obedient athlete's log is mostly these. A maximal effort at
 * the bar is never one, whatever it logged, and neither is a hold the athlete
 * said ended at their limit, or one the camera saw break before its target.
 *
 * Without the call flag, a hold that reached its target and did not
 * meaningfully pass it is one too. "Meaningfully" is the size of the stop: a
 * second for a stopwatch within reach, and for a walk back to the phone the
 * walk the allowance may have missed — a hold stopped at the call by an
 * athlete who walks 7s against the assumed 5s logs two seconds over, without
 * the flag. Read as measurements, those echoed the day's target back, and a
 * slow walker gaining every session was told for fifteen weeks that their
 * hold was going backwards.
 */
export function stoppedAtTarget(set: SetLog, stepId: StepId): boolean {
  if (set.kind !== 'hold' || !(set.target > 0) || isBarAttempt(set, stepId) || endedAtLimit(set)) return false
  const auto = trustedCameraEvidence(set) ? set.form?.auto : undefined
  if (cameraMeasured(set, auto)) return false
  if (set.endReason === 'target') return true
  if (set.calledAtTarget === true && capacityReading(set) >= set.target - 0.05) return true
  const held = trainingSetValue(set)
  return held >= set.target - 0.05 && held <= set.target + stopBandSec(set)
}

/**
 * The camera saw where the clean hold ended, and it was not at the call: it
 * certified clean time well past the call, or it saw a breakdown before the
 * target. The stopwatch cannot say either — net of a walk allowance it reads
 * short for a quick walker and long for a slow one — so the camera decides,
 * whatever the band or the flag would.
 *
 * A breakdown means one inside what it analysed (the credited stretch, or up
 * to the target for a hold stopped at its call). Clean to the end of that
 * window — footage that ran out, or a stretch the walk allowance cut short —
 * is no breakdown, and says nothing about where the hold ended.
 */
function cameraMeasured(set: SetLog, auto: AutoForm | undefined): boolean {
  if (auto?.cleanSeconds === undefined) return false
  if (auto.cleanSeconds > set.target + Math.max(1, set.target * 0.1)) return true
  const sawBreakdown =
    (auto.cleanRatio !== undefined ? auto.cleanRatio < 0.98 : auto.cleanSeconds < set.value - 0.15) &&
    unfilmedAfterCleanFilm(auto) === 0
  return sawBreakdown && auto.cleanSeconds < set.target - 0.05
}

/**
 * How far past its target a hold can log and still have come down at the
 * call: the stop itself — a second, or a tenth of a long hold — and, when the
 * walk back to the phone was the *assumed* allowance, the walk it may have
 * missed. A measured walk is the slowest of three, so it gets none: given the
 * room, a measured 2.5s walker's 12s on an 8s target read as a floor.
 */
function stopBandSec(set: SetLog): number {
  const assumedWalk =
    set.timing?.allowance === 'walk-back' && set.timing.allowanceSec === PROGRESSION_STOP_LATENCY_SEC
  return Math.max(1, set.target * 0.1, assumedWalk ? WALK_BACK_MAX_SEC - PROGRESSION_STOP_LATENCY_SEC : 0)
}

/** Reached its target and did not meaningfully pass it: the prescription, done. */
function completedAtTarget(set: SetLog): boolean {
  return (
    set.endReason === 'target' ||
    // Came down at the target call: reached it, whatever the fixed walk-back
    // allowance made of the logged value — unless the camera saw otherwise.
    (set.calledAtTarget === true && capacityReading(set) >= set.target - 0.05) ||
    // The same band as a floor's: with the 1s band alone, a slow walker's stops
    // at the call never counted as done, and their targets fell 8s → 5s.
    (set.value >= set.target - 0.05 && set.value <= set.target + stopBandSec(set))
  )
}

/**
 * A session's learning value, and whether it is a floor.
 *
 * The value is a floor when the hold that set it stopped at its target call:
 * the number is then whatever the coach prescribed — 0.7× on a technique day,
 * 1.25× on an intensity day — and only a lower bound on the athlete. A later
 * set falling short does not turn the best one into a measurement; that is
 * fatigue, not the limit. Read as measurements, floors made a noise-free
 * athlete who gained every session look noisy (withholding an earned unlock
 * attempt), "going backwards" for weeks, and capped their targets at the 2s
 * they had last been asked for while they could hold 10.
 */
export function sessionLearningPoint(
  session: Session,
  stepId: StepId,
  scope?: LearningScope,
): { value: number; floorAt: number | null } {
  const none = { value: 0, floorAt: null }
  const step = STEP_BY_ID[stepId]
  // A minimum dose is a few holds stopped at about three seconds on purpose:
  // read as capacity, it would look like a collapse to the noise, trend and
  // plateau readers, and the coach would answer a fiction.
  if (!step || session.workoutName === 'Quick Log' || session.workoutKind === 'micro') return none
  const bestOf = (sideScope: LearningScope | undefined) => {
    const sets = session.sets.filter(
      (set) =>
        set.exerciseId === step.keyExerciseId &&
        set.kind === 'hold' &&
        set.section === 'main' &&
        // A hold stopped at its call can log zero when the walk back is quicker
        // than the allowance; it still happened.
        (set.value > 0 || set.calledAtTarget === true) &&
        humanRating(set.form) !== 'broke' &&
        !endedForNonCapacityReason(set) &&
        inScope(set, sideScope),
    )
    const isFloor = (set: SetLog) => stoppedAtTarget(set, stepId)
    // A maximal effort at the bar measures the session, and sets the call lifted
    // to their target may not outrank it: with the walk overlapping the call, a
    // failed working set reads as reached, and a re-test at 9s under three
    // "reached" 11s sets left a 16s reading from weeks before standing.
    const measuredAtMax = sets.some((set) => isBarAttempt(set, stepId) && set.value > 0)
    const counted = measuredAtMax ? sets.filter((set) => !isFloor(set)) : sets
    const value = counted.reduce((best, set) => Math.max(best, capacityReading(set)), 0)
    if (value <= 0) return none
    if (measuredAtMax) return { value, floorAt: null }
    const top = counted.filter((set) => capacityReading(set) >= value - 0.05)
    const floorAt = top.every(isFloor) ? Math.max(...top.map((set) => set.target)) : null
    return { value, floorAt }
  }
  if (EXERCISE_BY_ID[step.keyExerciseId]?.perSide && !scope?.side) {
    const left = bestOf({ ...scope, side: 'left' })
    const right = bestOf({ ...scope, side: 'right' })
    // Both sides trained: the weaker one sets the dose. One side only (or the
    // other side failed at zero): the session says nothing about the pair, so
    // it contributes no bilateral value — the missing side is unknown, not
    // permission to inherit the stronger side's number.
    if (left.value > 0 && right.value > 0) {
      const gap = left.value - right.value
      if (Math.abs(gap) > 0.05) return gap < 0 ? left : right
      // Level sides: a floor only when neither side was measured.
      const floorAt = left.floorAt !== null && right.floorAt !== null ? Math.max(left.floorAt, right.floorAt) : null
      return { value: Math.min(left.value, right.value), floorAt }
    }
    const sided = session.sets.some((set) => set.exerciseId === step.keyExerciseId && set.side)
    return sided ? none : bestOf(scope)
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
      (set.value > 0 || set.calledAtTarget === true) &&
      !endedForNonCapacityReason(set) &&
      humanRating(set.form) !== 'broke' &&
      inScope(set, { surface }),
  )
  if (!key.length) return null
  // A maximal effort at the bar is a measurement, whatever it logged: at the
  // summit a 10.4s re-test of the 10s full planche read as "reached and not
  // passed", and the targets that followed sat at 2s.
  if (key.some((set) => isBarAttempt(set, stepId) && set.value > 0)) return null
  // Reached, and not meaningfully passed — however the hold felt: this asks
  // whether the prescription was done, not whether it was a measurement.
  const capped = key.every(completedAtTarget)
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
   * Set when the session's best key hold stopped at its target call (see
   * `sessionLearningPoint`): the value is then a lower bound ("at least this
   * much"), not a measurement, and this is the target it stopped at.
   */
  cappedAt?: number
}

/**
 * How long a measurement speaks for the athlete: two re-test cycles. A
 * fresher one is due every three weeks, and past this an old reading says
 * nothing about today — six scattered holds from two months back kept an
 * athlete "too noisy to read" for good, and noise held back the very re-test
 * that would have measured them again.
 */
export const MEASUREMENT_FRESH_DAYS = 42

/**
 * Where a series' measurements put the athlete: the latest one, unless it is
 * below the ones before it — then the median of the last three, so one bad
 * day is not believed until a second agrees. Floors never set it. With
 * `asOf`, only measurements from the `MEASUREMENT_FRESH_DAYS` before it count.
 * Null when nothing (fresh) has been measured.
 *
 * Asymmetric on purpose. A hold can come up short for many reasons — a bad
 * day, fatigue, a poor setup — but can only run long by mis-timing, which the
 * walk-back allowance and trusted camera evidence already guard. And a level
 * read too low sets targets the athlete completes, which measures nothing, so
 * it would stand until the next re-test: the median of three spread one
 * re-test's 8.4s across two older 5s readings, and the targets after it stayed
 * where they had been. A real drop is believed at the second low max effort.
 */
export function measuredLevel(points: LearningPoint[], asOf?: number): number | null {
  const measured = points
    .filter((p) => p.cappedAt === undefined && (asOf === undefined || asOf - p.at <= MEASUREMENT_FRESH_DAYS * 86_400_000))
    .map((p) => p.value)
  if (!measured.length) return null
  const last3 = measured.slice(-3).sort((a, b) => a - b)
  const middle = last3.length % 2 ? last3[(last3.length - 1) / 2] : (last3[0] + last3[1]) / 2
  return Math.max(measured[measured.length - 1], middle)
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
        const { value, floorAt } = sessionLearningPoint(s, stepId, { surface })
        return { at: s.startedAt, value, ...(floorAt !== null ? { cappedAt: floorAt } : {}) }
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

/**
 * The session measured the athlete's hold at its max: a max test, or a session
 * whose key hold was attempted at the step's bar — an unlock attempt, or the
 * re-test the coach puts inside a session when targets have gone stale. Either
 * re-anchors the working target, so either resets the re-test clock.
 */
export function measuredMaxIn(session: Session): boolean {
  if (testWasAttempted(session)) return true
  const step = STEP_BY_ID[session.stepId]
  return Boolean(step && session.sets.some((set) => isBarAttempt(set, step.id)))
}

/**
 * A key hold asked for at the step's bar: an unlock attempt, a re-test or a
 * max test's attempt. Working targets stop a second short of the bar
 * (`workingCeiling`), so the target says which sets were maximal efforts — set
 * logs keep no role. Clamped to the bar itself, an intensity day's working
 * sets read as max efforts that fell short of nothing.
 * Falling short of one is a measurement, never a missed working set.
 */
export function isBarAttempt(set: SetLog, stepId: StepId): boolean {
  const step = STEP_BY_ID[stepId]
  return Boolean(
    step &&
      set.section === 'main' &&
      set.kind === 'hold' &&
      set.exerciseId === step.keyExerciseId &&
      set.target >= step.unlockSec,
  )
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
