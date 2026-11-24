import type { AppState, AssessmentRecord, EquipmentId, Session, SetLog, SkillId, StepId } from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { equivalentGymExercise } from '../data/gym/exercises'
import { skillOfStep } from '../data/progressions'
import { ownsKit, SKILLS, type RepLadder, type RepRung } from '../data/skills'
import { isAssisted } from './progression'
import { isActiveSkill, trackOf, wholeState } from './skills'
import { dayKey } from './time'

/**
 * Rep ladders: the push-up lines that move on their own standards.
 *
 * A handstand push-up does not wait for a freestanding handstand, and a
 * freestanding handstand does not wait for the press — so the handstand road
 * keeps its pressing on a separate ladder (pike push-up → … → freestanding
 * push-up), and the 90° hold does the same for the 90° push-up. A rung opens
 * the next one on a *standard*: one set of that many full reps.
 *
 * Like every unlock in the app the rung is **derived by replaying history**,
 * never stored — delete the session that met a standard and the ladder steps
 * back. Its evidence is the frog stand's: the set is filmed, the athlete rates
 * it Clean, and then checks the replay against the rung's own list (`check`) —
 * every rep to the bottom, every rep locked out, none kicked. A number typed
 * into Quick Log, a light day's set or an assisted one never moves it.
 *
 * **The camera does not count the reps, on purpose.** The judge samples three
 * moments a second; the bottom of a two-second rep can fall between two of
 * them, and no source measured depth or lockout at anything near that rate
 * (ledger §13). A count the camera cannot stand behind would either open rungs
 * on half reps or refuse real ones, so there is none: the replay is put in
 * front of the athlete instead.
 *
 * The order of each line follows what coaches teach; the rep numbers do not
 * have that standing — single coaches' figures for the handstand push-up, the
 * app's own design for the 90° push-up (ledger §13.5, §13.6). Each ladder says
 * which in its `sourcing`, and its screens print that sentence.
 */

/** How many full reps a set can be credited with toward a standard. */
export function verifiedReps(set: SetLog): number {
  if (set.kind !== 'reps' || set.value <= 0) return 0
  if (set.section === 'warmup' || set.section === 'cooldown') return 0
  if (set.light || isAssisted(set) || set.repaired?.length) return 0
  const form = set.form
  if (!form || form.confirmed !== true || form.rating !== 'clean') return 0
  // The athlete's review of the replay against the rung's checklist. Only the
  // review row can set it, and only for a set that has a clip to review.
  return form.visualReviewPassed === true ? set.value : 0
}

/** Whether a set meets a rung's standard with full evidence. */
export function meetsStandard(set: SetLog, rung: RepRung): boolean {
  return set.exerciseId === rung.exerciseId && verifiedReps(set) >= rung.standardReps
}

/** The rungs an athlete can actually train: a rung whose kit is missing is stepped over. */
export function availableRungs(ladder: RepLadder, equipment: EquipmentId[]): RepRung[] {
  const usable = ladder.rungs.filter((rung) =>
    (EXERCISE_BY_ID[rung.exerciseId]?.requires ?? []).every((id) => ownsKit(equipment, id)),
  )
  // A ladder with nothing trainable still shows its first rung rather than nothing.
  return usable.length ? usable : ladder.rungs.slice(0, 1)
}

export interface LadderStatus {
  ladder: RepLadder
  /** The rungs available with the athlete's kit, in order. */
  rungs: RepRung[]
  /** Index into `rungs` of the rung being trained. */
  index: number
  rung: RepRung
  /** Preparation for the first full pike rep. It never earns a ladder standard. */
  pikePreparation?: 'practice' | 'trial'
  /** A first-rep milestone, independent of placement and of the hold destination. */
  goal: { rung: RepRung; reviewed: boolean; logged: boolean; gymBest?: number; missingKit?: EquipmentId[]; atPlace?: string }
  /** The next rung, when there is one. */
  next?: RepRung
  /** Most full reps shown with evidence on the current rung, in one set. */
  verifiedBest: number
  /** Most reps logged on the current rung in one set, evidence or not. */
  loggedBest: number
  /**
   * The current rung's standard has been met, but the next rung waits for a
   * step on the skill's hold road — a freestanding push-up for the
   * freestanding handstand. The step it waits for.
   */
  waitingOn?: StepId
  /** The steps open on the skill's hold road — what a rung's `needsStep` is checked against. */
  holdRoad: StepId[]
  /** Where placement started the athlete. */
  baseIndex: number
  /** When each rung past the base was opened, by rung exercise id. */
  openedAt: Record<string, number>
  /**
   * The placement answer named a rung past a gate the roads have not opened,
   * so the line starts below it. (`waitingOn` then says what for, without the
   * current rung's standard having been met.)
   */
  placedPastGate?: true
}

/** The placement answer that sets a ladder's starting rung, when one was given. */
export function ladderAnswerKey(ladder: RepLadder): string {
  return `ladder:${ladder.id}`
}

function counts(session: Session): boolean {
  return session.workoutName !== 'Quick Log'
}

function firstPikePreparation(assessment: AssessmentRecord | undefined, sessions: Session[], lastGymRep: number, now: number): LadderStatus['pikePreparation'] {
  let lastMiss = assessment?.answers['prep:hspu'] === 1 && assessment.at <= now ? assessment.at : -Infinity
  let lastRep = lastGymRep
  const practice = new Map<string, { at: number; sets: number }>()
  for (const session of sessions) {
    const full: SetLog[] = []
    for (const set of session.sets) {
      if (set.exerciseId !== 'pike-pushup' && set.exerciseId !== 'kneeling-pike-pushup') continue
      if (set.at > now || set.kind !== 'reps' || set.section === 'warmup' || set.section === 'cooldown' ||
          set.repaired?.length || isAssisted(set) || set.endReason === 'interruption' || set.endReason === 'timing') continue
      if (set.exerciseId === 'pike-pushup') {
        full.push(set)
        if (set.value > 0 && set.form?.rating !== 'slipped') lastRep = Math.max(lastRep, set.at)
      } else if (set.value >= 5 && !set.light && (set.rpe ?? session.rpe ?? 8) <= 8 && (!set.form || set.form.rating === 'clean')) {
        const key = dayKey(set.at)
        const day = practice.get(key)
        practice.set(key, { at: set.at, sets: (day?.sets ?? 0) + 1 })
      }
    }
    if (full.length && full.every((s) => s.value === 0) &&
        (full.length >= 2 || full.some((s) => s.target === 1 || (s.rpe ?? session.rpe ?? 0) >= 9))) {
      for (const set of full) lastMiss = Math.max(lastMiss, set.at)
    }
  }
  if (!Number.isFinite(lastMiss) || lastRep >= lastMiss) return undefined
  // A coaching cue to try one full rep after two manageable practice days.
  // A missed trial starts a fresh practice period, independently of filming.
  const days = [...practice.values()].filter((day) => day.sets >= 2 && day.at > lastMiss && dayKey(day.at) !== dayKey(lastMiss))
  return days.length >= 2 ? 'trial' : 'practice'
}

/** Whether a step is open on its own skill's road — whichever skill that is. */
function stepOpen(state: AppState, stepId: StepId): boolean {
  return trackOf(state, skillOfStep(stepId)).unlocked.includes(stepId)
}

/**
 * Where the athlete stands on a skill's rep ladder, replayed from history.
 * Null when the skill has no ladder.
 */
export function ladderStatus(stateIn: AppState, skill: SkillId, now = Number.POSITIVE_INFINITY): LadderStatus | null {
  const state = wholeState(stateIn)
  const ladder = SKILLS[skill].ladder
  if (!ladder) return null
  const rungs = availableRungs(ladder, state.profile.equipment)

  // Placement: the rung the athlete said they could already do, by exercise.
  const assessment = trackOf(state, skill).assessment
  const answered = assessment?.answers[ladderAnswerKey(ladder)]
  const answeredId = answered !== undefined ? ladder.rungs[Math.round(answered)]?.exerciseId : undefined
  let baseIndex = 0
  if (answeredId) {
    // The rung answered, or — if its kit is missing — the nearest one below it.
    const full = ladder.rungs.findIndex((rung) => rung.exerciseId === answeredId)
    for (let i = 0; i < rungs.length; i++) {
      if (ladder.rungs.findIndex((rung) => rung.exerciseId === rungs[i].exerciseId) <= full) baseIndex = i
    }
  }
  // A claim does not open a gate. Placed on "freestanding handstand push-up"
  // with no freestanding handstand, the line once started there: the starting
  // rung was never checked against the hold it needs.
  const gated = (rung: RepRung | undefined) => rung?.needsStep !== undefined && !stepOpen(state, rung.needsStep)
  const firstGate = rungs.findIndex((rung, i) => i > 0 && gated(rung))
  const placedPastGate = firstGate > 0 && baseIndex >= firstGate
  if (placedPastGate) baseIndex = firstGate - 1

  let index = baseIndex
  let waitingOn: StepId | undefined = placedPastGate ? rungs[firstGate].needsStep : undefined
  const openedAt: Record<string, number> = {}
  const sessions = state.sessions
    .filter((session) => session.startedAt <= now && counts(session))
    .sort((a, b) => a.startedAt - b.startedAt)
  for (const session of sessions) {
    // One session can clear more than one rung, as one can more than one step.
    for (let guard = 0; guard < ladder.rungs.length; guard++) {
      const rung = rungs[index]
      const next = rungs[index + 1]
      if (!next || !session.sets.some((set) => meetsStandard(set, rung))) break
      // The standard is met, but the next rung needs a hold the road has not
      // reached: the ladder waits there, and says what for.
      if (gated(next)) {
        waitingOn = next.needsStep
        break
      }
      index += 1
      openedAt[next.exerciseId] = session.endedAt
    }
  }

  const rung = rungs[index]
  const goalRung = ladder.rungs.find((r) => r.exerciseId === trackOf(state, skill).repGoal) ?? ladder.rungs[ladder.rungs.length - 1]
  const goal: LadderStatus['goal'] = { rung: goalRung, reviewed: false, logged: false }
  const needed = EXERCISE_BY_ID[goalRung.exerciseId]?.requires ?? []
  const missingHome = needed.filter((k) => !ownsKit(state.profile.equipment, k))
  if (missingHome.length) {
    const place = state.gym?.locations.find((l) => missingHome.every((k) => ownsKit(l.equipment as EquipmentId[], k)) &&
      needed.every((k) => ownsKit(l.equipment as EquipmentId[], k) || (['floor', 'band', 'rings', 'parallettes'].includes(k) && ownsKit(state.profile.equipment, k))))
    if (place) goal.atPlace = place.name
    else goal.missingKit = missingHome
  }
  const currentGymId = equivalentGymExercise(rung.exerciseId)?.id
  const goalGymId = equivalentGymExercise(goalRung.exerciseId)?.id
  let verifiedBest = 0
  let loggedBest = 0
  let lastGymRep = -Infinity
  if (goalGymId || currentGymId) for (const session of state.gym?.sessions ?? []) {
    if (session.startedAt > now) continue
    for (const row of session.exercises) {
      if (row.exerciseId !== currentGymId && row.exerciseId !== goalGymId) continue
      for (const set of row.sets) {
        if (set.warmup || set.reps < 1 || set.at > now) continue
        if (row.exerciseId === currentGymId) {
          loggedBest = Math.max(loggedBest, set.reps)
          lastGymRep = Math.max(lastGymRep, set.at)
        }
        if (row.exerciseId === goalGymId) {
          goal.logged = true
          goal.gymBest = Math.max(goal.gymBest ?? 0, set.reps)
        }
      }
    }
  }
  for (const session of sessions) {
    for (const set of session.sets) {
      if (set.kind !== 'reps' || (set.exerciseId !== rung.exerciseId && set.exerciseId !== goalRung.exerciseId)) continue
      if (set.section === 'warmup' || set.section === 'cooldown' || isAssisted(set)) continue
      if (set.exerciseId === goalRung.exerciseId && set.value >= 1 && !set.repaired?.length) {
        goal.logged = true
        if (verifiedReps(set) >= 1) goal.reviewed = true
      }
      if (set.exerciseId !== rung.exerciseId) continue
      loggedBest = Math.max(loggedBest, set.value)
      verifiedBest = Math.max(verifiedBest, verifiedReps(set))
    }
  }
  return {
    ladder,
    rungs,
    index,
    rung,
    ...(rung.exerciseId === 'pike-pushup' ? { pikePreparation: firstPikePreparation(assessment, sessions, lastGymRep, now) } : {}),
    goal,
    ...(rungs[index + 1] ? { next: rungs[index + 1] } : {}),
    verifiedBest,
    loggedBest,
    ...(waitingOn && rungs[index + 1]?.needsStep === waitingOn ? { waitingOn } : {}),
    ...(placedPastGate && index === baseIndex ? { placedPastGate: true as const } : {}),
    // The gate steps that are open, on whichever road each belongs to.
    holdRoad: rungs.flatMap((r) => (r.needsStep && stepOpen(state, r.needsStep) ? [r.needsStep] : [])),
    baseIndex,
    openedAt,
  }
}

/**
 * How many rungs' standards the athlete has met with evidence, at or above the
 * rung placement started them on — the top rung aside, which opens nothing.
 *
 * Read from the sessions and the placement alone, never from the kit listed
 * today. `ladderStatus` is rightly a function of the kit (a rung that cannot
 * be trained is stepped over), but a badge is a record of something that
 * happened: counted on the ladder's position, "Next Rung" was taken back the
 * moment an athlete who had earned it un-ticked their wall, and returned when
 * they ticked it again.
 */
export function standardsMet(stateIn: AppState, skill: SkillId): number {
  const state = wholeState(stateIn)
  const ladder = SKILLS[skill].ladder
  if (!ladder) return 0
  const answered = trackOf(state, skill).assessment?.answers[ladderAnswerKey(ladder)]
  const base = answered !== undefined ? Math.min(ladder.rungs.length - 1, Math.max(0, Math.round(answered))) : 0
  const sessions = state.sessions.filter(counts)
  return ladder.rungs.filter(
    (rung, index) =>
      index >= base &&
      index < ladder.rungs.length - 1 &&
      sessions.some((session) => session.sets.some((set) => meetsStandard(set, rung))),
  ).length
}

/** Whether an exercise is a rung of any skill's rep ladder. */
export function ladderOfExercise(exerciseId: string): { skill: SkillId; ladder: RepLadder; rung: RepRung } | null {
  for (const skill of Object.values(SKILLS)) {
    const rung = skill.ladder?.rungs.find((r) => r.exerciseId === exerciseId)
    if (rung && skill.ladder) return { skill: skill.id, ladder: skill.ladder, rung }
  }
  return null
}

/**
 * The ladder a set of this movement can count toward, when it can: the athlete
 * trains that ladder's skill, this is the rung they are on, and the set is
 * real work — not a warm-up, a cool-down or a light day's. This is what makes
 * a rep set worth filming; every other rep set is simply logged.
 */
export function rungInPlay(
  stateIn: AppState,
  exerciseId: string,
  set: { section: SetLog['section']; light?: boolean },
): LadderStatus | null {
  if (set.section === 'warmup' || set.section === 'cooldown' || set.light) return null
  const found = ladderOfExercise(exerciseId)
  if (!found) return null
  const state = wholeState(stateIn)
  if (!isActiveSkill(state, found.skill)) return null
  const status = ladderStatus(state, found.skill)
  return status && status.rung.exerciseId === exerciseId ? status : null
}

/**
 * What a reviewed set of `reps` on the current rung does to the ladder:
 * `opens` the next rung, meets the standard but `waits` for a step on the hold
 * road, is the `top` of the line, or is still `short` of the standard.
 */
export function rungOutcome(status: LadderStatus, reps: number): 'opens' | 'waits' | 'top' | 'short' {
  if (reps < status.rung.standardReps) return 'short'
  if (!status.next) return 'top'
  return status.next.needsStep && !status.holdRoad.includes(status.next.needsStep) ? 'waits' : 'opens'
}

/**
 * A rep set with its logged count changed by hand. A replay review vouches for
 * the reps that were logged when it was given: lowering the count keeps it
 * (fewer reps than were checked), raising it drops it — more reps than that
 * were never checked, and a review must not stretch to cover them.
 */
export function withRepCount(set: SetLog, value: number): SetLog {
  if (set.kind !== 'reps' || value <= set.value || !set.form?.visualReviewPassed) return { ...set, value }
  const form = { ...set.form }
  delete form.visualReviewPassed
  return { ...set, value, form }
}

/**
 * The filmed rep sets worth putting in front of the athlete when a session
 * ends: per movement, the biggest set that has not been rated down. A standard
 * is met on the best set, so that is the review that matters — and once given
 * it stays listed, so the athlete sees what it earned. Rating the best set
 * Slipped moves the question to the next best.
 */
export function repSetsToReview(sets: SetLog[], reviewable: (set: SetLog) => boolean): SetLog[] {
  const candidates = sets.filter(
    (set) => set.kind === 'reps' && reviewable(set) && !(set.form?.confirmed === true && set.form.rating !== 'clean'),
  )
  const best = new Map<string, SetLog>()
  for (const set of candidates) {
    const held = best.get(set.exerciseId)
    // The bigger set; between equals, the earlier one.
    if (!held || set.value > held.value || (set.value === held.value && set.at < held.at)) best.set(set.exerciseId, set)
  }
  return [...best.values()]
}

/**
 * Rungs a saved session opened, for the summary screen: compares the ladder
 * just before the session with the ladder including it.
 */
export function rungsOpenedBy(stateBefore: AppState, session: Session): { skill: SkillId; rung: RepRung }[] {
  const before = wholeState(stateBefore)
  const after: AppState = { ...before, sessions: [...before.sessions, session] }
  const out: { skill: SkillId; rung: RepRung }[] = []
  for (const skill of Object.values(SKILLS)) {
    if (!skill.ladder) continue
    const was = ladderStatus(before, skill.id)
    const is = ladderStatus(after, skill.id)
    if (was && is && is.index > was.index) out.push({ skill: skill.id, rung: is.rung })
  }
  return out
}
