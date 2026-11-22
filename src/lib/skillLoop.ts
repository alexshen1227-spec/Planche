import type { AppState, EquipmentId, Session, SetLog, SkillId, StepId, Workout } from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { STEP_BY_ID, stepsOf } from '../data/progressions'
import { skillOfExercise } from '../data/skills'
import { finalizeFromPlan, planForToday } from '../data/workouts'
import type { CoachPlan } from './coach'
import { applySession } from './engine'
import { rolesTrained, type LineupEntry } from './lineup'
import { ladderOfExercise } from './repLadder'
import { sessionSkillSteps, stepOfSkill } from './skills'
import { initialState, reducer } from './store'

/**
 * The loop an athlete with several skills actually lives in: the real line-up,
 * the real session builder, logged the way the player logs it, fed back
 * through the real engine — for months.
 *
 * `closedLoop.eval` does this for the planche, and found six faults no unit
 * test could: targets that echoed themselves downward, a deload that never
 * ended. This is the same loop for every road and for mixes of them, so the
 * same class of fault has somewhere to show.
 *
 * The athlete is obedient and gets steadily stronger: comes down at every
 * working-set call, holds attempts and re-tests to their limit, films and
 * confirms every main hold. Strength on a skill only rises on days that skill
 * was trained — so a skill the line-up starves visibly stops moving.
 */


const ALL_KIT: EquipmentId[] = ['floor', 'parallettes', 'pullup-bar', 'wall', 'pole', 'band', 'box', 'dip-bars']

export interface SkillLoopOptions {
  skills: SkillId[]
  /** Where each skill starts; the road's first step when absent. */
  steps?: Partial<Record<SkillId, StepId>>
  sessions: number
  sessionMinutes?: number
  equipment?: EquipmentId[]
  /** Seconds every trained skill's holds gain per session it is trained in. */
  gainPerSession?: number
  /** Where a later shape starts, as a share of its opening dose. */
  nextShapeShare?: number
  /** Called with each session's time before it is planned, for a fake clock. */
  setClock?: (at: number) => void
  /** Weekdays trained on (0 is Sunday). Monday, Wednesday and Friday when left out. */
  trainOn?: number[]
  /** The athlete's own week plan, when the season should follow one. */
  weekPlan?: unknown
}

export interface SkillLoopDay {
  at: number
  lineup: LineupEntry[]
  workout: Workout
  plan: CoachPlan
  /** The step each tracked skill was on when the session started. */
  stepsBefore: Partial<Record<SkillId, StepId>>
  /** Steps this session opened, across skills. */
  unlocked: StepId[]
  session: Session
}

/** A hold filmed, confirmed and passed — the evidence an unlock asks for. */
function verified(sec: number): SetLog['form'] {
  return {
    rating: 'clean',
    confirmed: true,
    flightConfirmed: true,
    // Where the camera only sees a large elbow bend, the athlete vouches for the lock.
    armsConfirmed: true,
    visualReviewPassed: true,
    auto: { issues: [], confidence: 0.9, score: 90, cleanSeconds: sec, cleanRatio: 1 },
  }
}

export function startingState(options: Pick<SkillLoopOptions, 'skills' | 'steps' | 'sessionMinutes' | 'equipment'>): AppState {
  const { skills, steps = {} } = options
  const state = reducer(initialState(), {
    type: 'COMPLETE_ONBOARDING',
    name: 'Loop',
    stepId: skills.includes('planche') ? (steps.planche ?? 'foundations') : 'foundations',
    weeklyGoal: 3,
    sessionMinutes: options.sessionMinutes ?? 45,
    // An adult: the closed loops measure the standard session. The longer
    // warm-up under 18 (or with no age) is pinned in youthWarmup.test.
    profile: { equipment: options.equipment ?? ALL_KIT, birthYear: 1990 },
    units: 'metric',
    skills,
    placements: Object.fromEntries(
      skills.filter((skill) => skill !== 'planche').map((skill) => [skill, { stepId: steps[skill] ?? stepsOf(skill)[0].id }]),
    ),
  })
  return state
}

/**
 * A generated workout, logged the way the session player saves it by an
 * athlete who does what was asked: every set done, working holds stopped at
 * their call, maximal ones held to `capacityOf`, main holds and rung sets
 * filmed and confirmed. Shared with the store fuzz, so both feed the engine
 * the same shape of session a real one produces.
 */
export function sessionFromWorkout(
  state: AppState,
  workout: Workout,
  lineup: LineupEntry[],
  at: number,
  id: string,
  capacityOf: (exerciseId: string) => number,
): Session {
  const sets: SetLog[] = []
  let clock = at
  for (const block of workout.blocks) {
    const exercise = EXERCISE_BY_ID[block.exerciseId]
    for (let s = 0; s < block.sets; s++) {
      clock += 60_000
      const side = exercise?.perSide ? (s % 2 === 0 ? ('left' as const) : ('right' as const)) : undefined
      const light = block.light ? { light: true } : {}
      if (block.target.kind === 'reps') {
        // A rung of a rep ladder is filmed and checked on the replay, which is
        // the evidence its standard asks for.
        const onLadder = ladderOfExercise(block.exerciseId) !== null && block.section !== 'warmup'
        sets.push({
          exerciseId: block.exerciseId,
          kind: 'reps',
          value: block.target.reps,
          target: block.target.reps,
          section: block.section,
          at: clock,
          ...(side ? { side } : {}),
          ...(onLadder ? { form: { rating: 'clean' as const, confirmed: true, visualReviewPassed: true } } : {}),
          ...light,
        })
        continue
      }
      const target = block.target.sec
      const maximal = block.role === 'attempt' || block.role === 'bridge' || block.retest === true
      const capacity = Math.round(capacityOf(block.exerciseId) * 10) / 10
      const value = maximal ? capacity : Math.min(target, capacity)
      const filmed = block.section === 'main'
      const reached = value >= target
      sets.push({
        exerciseId: block.exerciseId,
        kind: 'hold',
        value,
        target,
        section: block.section,
        at: clock,
        ...(side ? { side } : {}),
        ...(maximal ? { endReason: 'effort' as const } : {}),
        ...(!maximal && reached && block.section !== 'warmup' && block.section !== 'cooldown' ? { calledAtTarget: true } : {}),
        ...(filmed ? { form: verified(value) } : {}),
        ...light,
      })
    }
  }
  // The other skills' side of the session, as the player saves it.
  const notes = sessionSkillSteps(state)
  for (const skill of Object.keys(notes) as SkillId[]) {
    const meta = workout.skillMeta?.[skill]
    const note = notes[skill]
    if (!meta || !note) continue
    notes[skill] = {
      ...note,
      ...(meta.strategy ? { strategy: meta.strategy } : {}),
      ...(meta.baseTargetSec !== undefined ? { baseTargetSec: meta.baseTargetSec } : {}),
      ...(meta.retest ? { retestOffered: true } : {}),
    }
  }
  return {
    id,
    startedAt: at,
    endedAt: clock + 60_000,
    workoutName: workout.name,
    workoutKind: workout.kind,
    stepId: state.stepId,
    sets,
    rpe: 7,
    completion: 'full',
    ...(workout.strategy ? { strategy: workout.strategy } : {}),
    ...(workout.baseTargetSec !== undefined ? { baseTargetSec: workout.baseTargetSec } : {}),
    ...(workout.blocks.some((b) => b.retest && (b.skill ?? workout.skills?.[0] ?? 'planche') === 'planche')
      ? { retestOffered: true }
      : {}),
    ...(workout.plannedDeload ? { plannedDeload: true } : {}),
    ...(Object.keys(notes).length ? { skills: notes } : {}),
    // As the player saves it: from what was logged.
    ...(() => {
      const roles = rolesTrained(lineup, workout.blocks, sets)
      return Object.keys(roles).length ? { roles } : {}
    })(),
  }
}

export function runSkillLoop(options: SkillLoopOptions): { days: SkillLoopDay[]; state: AppState } {
  const gain = options.gainPerSession ?? 0.3
  const nextShapeShare = options.nextShapeShare ?? 0.8
  let state = startingState(options)
  if (options.weekPlan !== undefined) state = reducer(state, { type: 'SET_WEEK_PLAN', plan: options.weekPlan })
  // What the athlete can truly hold, per movement. A shape they are placed on
  // starts comfortably above its opening dose; a later one below it.
  const capacity = new Map<string, number>()
  const startedOn = new Set(options.skills.map((skill) => stepOfSkill(state, skill)))
  const capOf = (exerciseId: string) => {
    if (!capacity.has(exerciseId)) {
      const step = Object.values(STEP_BY_ID).find((candidate) => candidate.keyExerciseId === exerciseId)
      capacity.set(exerciseId, step ? step.startSec * (startedOn.has(step.id) ? 1.6 : nextShapeShare) : 30)
    }
    return capacity.get(exerciseId)!
  }
  const days: SkillLoopDay[] = []
  // Mondays, Wednesdays and Fridays at 18:00, local time — or the days asked for.
  const trainOn = options.trainOn?.length ? options.trainOn : [1, 3, 5]
  const nextDay = (from: number) => {
    const d = new Date(from)
    do d.setDate(d.getDate() + 1)
    while (!trainOn.includes(d.getDay()))
    return d.getTime()
  }
  let at = new Date(2026, 0, 5, 18, 0).getTime()
  if (!trainOn.includes(new Date(at).getDay())) at = nextDay(at)
  for (let i = 0; i < options.sessions; i++) {
    options.setClock?.(at)
    const plan = planForToday(state, at)
    const { workout, lineup } = finalizeFromPlan(state, { source: 'auto' }, plan, at)
    const stepsBefore = Object.fromEntries(options.skills.map((skill) => [skill, stepOfSkill(state, skill)])) as Partial<
      Record<SkillId, StepId>
    >
    const session = sessionFromWorkout(state, workout, lineup, at, `loop-${i}`, capOf)
    const sets = session.sets
    const { next, events } = applySession(state, session)
    const unlocked = (events.unlocks ?? (events.unlockedStep ? [{ stepId: events.unlockedStep }] : [])).map((u) => u.stepId)
    days.push({ at, lineup, workout, plan, stepsBefore, unlocked, session })
    state = next
    // Strength rises on what was trained today, and only on that.
    const trainedSkills = new Set(sets.map((set) => skillOfExercise(set.exerciseId)).filter((skill): skill is SkillId => Boolean(skill)))
    // A shape not met yet has not been practised, so it does not move.
    for (const [id, seconds] of capacity) {
      const owner = skillOfExercise(id)
      if (owner && trainedSkills.has(owner)) capacity.set(id, seconds + gain)
    }
    at = nextDay(at)
  }
  return { days, state }
}
