import type { AppState, AssessmentRecord, Category, Exercise, Session, SkillId, SkillTrack, StepDef, StepId } from '../types'
import { SKILL_IDS } from '../types'
import { missingKit } from '../data/skills'
import { firstStep, skillOfStep, STEP_BY_ID, stepForKeyExercise, stepsOf, summitOf } from '../data/progressions'
import { isReviewOnly } from './progression'

/**
 * Several skills, one coach.
 *
 * Everything that reads an athlete's training — signals, the plan, the
 * forecast, the plateau diagnosis, the form trends — was written for one road:
 * it asks the state for "the step" and reads sessions against it. Rather than
 * teach each of those modules about five roads, the state is *viewed* as one
 * skill at a time: `skillView(state, 'frontlever')` is the same athlete with
 * the front lever's step, base, unlocks, placement and per-session notes in
 * the places the planche's have always been. All sessions stay in the view,
 * because fatigue, rest days and joint reports belong to the body, not to a
 * skill; only what is specific to a road is swapped.
 *
 * The convention this rests on: **the skill of a state is the skill of its
 * `stepId`**. Step ids are unique across skills, so any function handed a
 * (possibly viewed) state can tell which road it is on without being told.
 *
 * The planche keeps its top-level fields — a save from before the other
 * skills is, unchanged, a valid planche-only athlete — so its view is the
 * state itself.
 */

/** Categories whose movements are a skill's own positions, as against shared support work. */
const SKILL_CATEGORIES: ReadonlySet<Category> = new Set<Category>(['planche', 'lever', 'handstand', 'ninety', 'flag'])

/**
 * Whether a movement is on one of the skill lines: filed under a skill's
 * category, or the key hold of a step. The second half is for the planche's
 * Foundations hold — a pseudo planche plank, catalogued with the scapula
 * drills — which every other road's first step never needed, because their
 * first holds are filed under the skill.
 */
function onSkillLine(exercise: Exercise): boolean {
  return SKILL_CATEGORIES.has(exercise.category) || stepForKeyExercise(exercise.id) !== undefined
}

/** One of a skill's own positions, held: a tuck planche, a front lever, a handstand — not a hollow hold. */
export function isSkillHold(exercise: Exercise | undefined): boolean {
  return Boolean(exercise && exercise.type === 'hold' && onSkillLine(exercise))
}

/** A movement on one of the skill lines, held or for reps. */
export function isSkillWork(exercise: Exercise | undefined): boolean {
  return Boolean(exercise && onSkillLine(exercise))
}

/**
 * Holds done either on the floor or on parallettes, with a record kept for
 * each: the planche line and the 90° hold. A bar, a wall and a pole have no
 * second surface to compare.
 */
export function isSurfaceAware(exercise: Exercise | undefined): boolean {
  return Boolean(exercise && (exercise.category === 'planche' || exercise.category === 'ninety'))
}

/** Holds whose support is the point of them, so "any assistance?" has no answer worth storing. */
const NEVER_ASSISTED = new Set(['ppp-hold', 'wall-plank', 'wall-handstand', 'wall-float', 'bent-arm-lean-hold', 'elbow-lever'])

/** Holds where a remembered setup — a band, a spotter — is worth asking about. */
export function assistAppliesTo(exercise: Exercise | undefined): boolean {
  return Boolean(exercise && isSkillHold(exercise) && !isReviewOnly(exercise.id) && !NEVER_ASSISTED.has(exercise.id))
}

/** The step, among those the athlete is on right now, whose key hold this movement is. */
export function currentStepForExercise(stateIn: AppState, exerciseId: string): StepDef | undefined {
  const state = wholeState(stateIn)
  for (const skill of trackedSkills(state)) {
    const step = STEP_BY_ID[stepOfSkill(state, skill)]
    if (step?.keyExerciseId === exerciseId) return step
  }
  return undefined
}

/**
 * The straight-arm family a skill's hard work belongs to, for shared recovery:
 * the planche and the 90° hold push, the front lever and the flag pull — the
 * pairs the planner's rest rule spaces as one. The handstand is balance work
 * and belongs to neither. The pairing is CONSENSUS; the shared joints behind it
 * are INFERENCE from the positions.
 */
export function straightArmFamily(skill: SkillId): 'push' | 'pull' | null {
  if (skill === 'planche' || skill === 'ninety') return 'push'
  if (skill === 'frontlever' || skill === 'flag') return 'pull'
  return null
}

/** Skills the athlete trains, focus first. A save from before the other skills is the planche alone. */
export function activeSkills(state: Pick<AppState, 'profile'>): SkillId[] {
  const listed = state.profile.skills
  if (!listed?.length) return ['planche']
  const seen = new Set<SkillId>()
  const out: SkillId[] = []
  for (const id of listed) {
    if (SKILL_IDS.includes(id) && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out.length ? out : ['planche']
}

/** The skill that leads: the first in the athlete's order. */
export function focusSkill(state: Pick<AppState, 'profile'>): SkillId {
  return activeSkills(state)[0]
}

export function isActiveSkill(state: Pick<AppState, 'profile'>, skill: SkillId): boolean {
  return activeSkills(state).includes(skill)
}

/** A skill's road at its very start, for an athlete who has not been placed on it. */
export function freshTrack(skill: SkillId, at: number): SkillTrack {
  const first = firstStep(skill)
  return { stepId: first.id, baseStepId: first.id, unlocked: [first.id], addedAt: at }
}

/** The state these views were taken from, so a view can be re-viewed as another skill. */
const ORIGIN = new WeakMap<AppState, AppState>()
const VIEWS = new WeakMap<AppState, Partial<Record<SkillId, AppState>>>()
const PROJECTED = new WeakMap<Session[], Map<string, Session[]>>()

/** The real state behind a view (or the state itself). */
export function wholeState(state: AppState): AppState {
  return ORIGIN.get(state) ?? state
}

/** Which skill a state — whole or viewed — is currently reading as. */
export function skillOfState(state: Pick<AppState, 'stepId'>): SkillId {
  return skillOfStep(state.stepId)
}

/**
 * Where the athlete stands on a skill. For the planche this is assembled from
 * the top-level fields; for the others it is the stored track, or a fresh one
 * for a skill that has never been set up.
 */
export function trackOf(stateIn: AppState, skill: SkillId): SkillTrack {
  const state = wholeState(stateIn)
  if (skill === 'planche') {
    return {
      stepId: state.stepId,
      baseStepId: state.baseStepId,
      unlocked: state.unlocked,
      ...(state.profile.goalStepId ? { goalStepId: state.profile.goalStepId } : {}),
      ...(state.assessment ? { assessment: state.assessment } : {}),
      addedAt: state.startedAt,
    }
  }
  return state.tracks?.[skill] ?? freshTrack(skill, state.startedAt)
}

/** Whether the athlete has ever set this skill up. The planche always exists. */
export function hasTrack(stateIn: AppState, skill: SkillId): boolean {
  return skill === 'planche' || Boolean(wholeState(stateIn).tracks?.[skill])
}

/** The step the athlete is on, for a skill. */
export function stepOfSkill(state: AppState, skill: SkillId): StepId {
  return trackOf(state, skill).stepId
}

/** Read the current main hold. Accessories that need other equipment are fitted separately. */
export function missingSkillKit(state: AppState, skill: SkillId, equipment = state.profile.equipment) {
  return missingKit(skill, equipment, stepOfSkill(state, skill))
}

/** The goal step for a skill: the athlete's choice, else the summit (the planche keeps its straddle default). */
export function goalOfSkill(state: AppState, skill: SkillId): StepId {
  const chosen = trackOf(state, skill).goalStepId
  if (chosen && STEP_BY_ID[chosen]?.skill === skill) return chosen
  return skill === 'planche' ? 'straddle' : summitOf(skill).id
}

/**
 * Sessions as one skill sees them: the step that skill was on, and the
 * strategy and base target the coach gave it, in the fields the planche's have
 * always used. A session that says nothing about the skill carries the last
 * known step forward (before any, the base), and no strategy — it was not
 * shaped for this skill, so it teaches the skill's bandit nothing.
 */
function projectSessions(sessions: Session[], skill: SkillId, base: StepId): Session[] {
  const key = `${skill}:${base}`
  let bySkill = PROJECTED.get(sessions)
  if (!bySkill) {
    bySkill = new Map()
    PROJECTED.set(sessions, bySkill)
  }
  const cached = bySkill.get(key)
  if (cached) return cached

  // Carry the step forward in time order; the stored order is kept.
  const order = sessions.map((_, i) => i).sort((a, b) => sessions[a].startedAt - sessions[b].startedAt)
  const stepAt: StepId[] = new Array(sessions.length)
  let last = base
  for (const i of order) {
    const noted = sessions[i].skills?.[skill]?.stepId
    if (noted && STEP_BY_ID[noted]?.skill === skill) last = noted
    stepAt[i] = last
  }
  const out = sessions.map((s, i): Session => {
    const meta = s.skills?.[skill]
    const { strategy: _strategy, baseTargetSec: _base, retestOffered: _retest, ...rest } = s
    return {
      ...rest,
      stepId: stepAt[i],
      ...(meta?.strategy ? { strategy: meta.strategy } : {}),
      ...(meta?.baseTargetSec !== undefined ? { baseTargetSec: meta.baseTargetSec } : {}),
      ...(meta?.retestOffered ? { retestOffered: true } : {}),
    }
  })
  bySkill.set(key, out)
  return out
}

/**
 * The athlete, read as one skill. See the note at the top of this file.
 *
 * Views are cached per state object, so a screen asking for the same view on
 * every render gets the same object back (and the memoised work behind it).
 */
export function skillView(stateIn: AppState, skill: SkillId): AppState {
  const state = wholeState(stateIn)
  if (skill === 'planche') return state
  let views = VIEWS.get(state)
  if (!views) {
    views = {}
    VIEWS.set(state, views)
  }
  const cached = views[skill]
  if (cached) return cached

  const track = trackOf(state, skill)
  const { grandfatheredStepId: _grandfathered, assessment: _assessment, ...rest } = state
  const view: AppState = {
    ...rest,
    stepId: track.stepId,
    baseStepId: track.baseStepId,
    unlocked: track.unlocked,
    ...(track.assessment ? { assessment: track.assessment } : {}),
    profile: { ...state.profile, goalStepId: goalOfSkill(state, skill) },
    sessions: projectSessions(state.sessions, skill, track.baseStepId),
  }
  views[skill] = view
  ORIGIN.set(view, state)
  return view
}

/** The view for whichever skill a step is on. */
export function viewForStep(state: AppState, stepId: StepId): AppState {
  return skillView(state, skillOfStep(stepId))
}

/**
 * Write one skill's progress back onto the whole state: the planche's fields
 * at the top level, any other skill's in its track.
 */
export function withTrack(
  stateIn: AppState,
  skill: SkillId,
  patch: Partial<Pick<SkillTrack, 'stepId' | 'baseStepId' | 'unlocked' | 'goalStepId' | 'assessment'>>,
): AppState {
  const state = wholeState(stateIn)
  if (skill === 'planche') {
    const { goalStepId, assessment, ...steps } = patch
    return {
      ...state,
      ...steps,
      ...(goalStepId !== undefined ? { profile: { ...state.profile, goalStepId } } : {}),
      ...(assessment !== undefined ? { assessment } : {}),
    }
  }
  const current = state.tracks?.[skill] ?? freshTrack(skill, Date.now())
  return { ...state, tracks: { ...state.tracks, [skill]: { ...current, ...patch } } }
}

/** Give the athlete a skill they have not set up before, placed at `stepId` (or its first step). */
export function addTrack(
  stateIn: AppState,
  skill: SkillId,
  at: number,
  placedStepId?: StepId,
  assessment?: AssessmentRecord,
): AppState {
  const state = wholeState(stateIn)
  if (skill === 'planche' || state.tracks?.[skill]) return state
  const road = stepsOf(skill)
  const placed = placedStepId && STEP_BY_ID[placedStepId]?.skill === skill ? STEP_BY_ID[placedStepId] : road[0]
  const track: SkillTrack = {
    stepId: placed.id,
    baseStepId: placed.id,
    unlocked: road.filter((s) => s.order <= placed.order).map((s) => s.id),
    addedAt: at,
    ...(assessment ? { assessment } : {}),
  }
  return { ...state, tracks: { ...state.tracks, [skill]: track } }
}

/** Every skill with stored progress: the planche, and each track. */
export function trackedSkills(stateIn: AppState): SkillId[] {
  const state = wholeState(stateIn)
  return SKILL_IDS.filter((skill) => skill === 'planche' || Boolean(state.tracks?.[skill]))
}

/**
 * The per-skill notes a session saved now should carry: the step every tracked
 * skill other than the planche is on, so the session can be read for that
 * skill later whatever happens to the track in between.
 */
export function sessionSkillSteps(stateIn: AppState): NonNullable<Session['skills']> {
  const state = wholeState(stateIn)
  const out: NonNullable<Session['skills']> = {}
  for (const skill of trackedSkills(state)) {
    if (skill === 'planche') continue
    out[skill] = { stepId: trackOf(state, skill).stepId }
  }
  return out
}
