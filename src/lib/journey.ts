import type { AppState, Session, SkillId, SkillTrack, StepId } from '../types'
import { skillOfStep, STEPS, STEP_BY_ID, stepsOf } from '../data/progressions'
import { skillOfExercise } from '../data/skills'
import { applySession } from './engine'
import { skillOfState, trackedSkills, trackOf, wholeState } from './skills'

const DAY = 86_400_000

/**
 * The road so far: when each step opened, and how long each one took.
 *
 * Unlocks are derived by replaying history, never stored, so their dates are
 * derived the same way — the replay `rebuildDerivedState` runs, keeping the
 * session that opened each step. A step the athlete started at, was placed
 * beyond, or jumped to has no session that opened it, and says so rather than
 * borrowing one.
 */
export interface JourneyStop {
  stepId: StepId
  /**
   * How the step opened: `start` is where training began, `bar` and
   * `next-shape` a session that earned it (`unlockedVia`), `placed` a step the
   * athlete was placed at or past without training through it here.
   */
  via: 'start' | 'bar' | 'next-shape' | 'placed'
  /** When it opened — the earning session, or the first session for `start`. */
  openedAt?: number
  /**
   * Whole days from opening to the next step's opening; for the current step,
   * days so far. Absent whenever either end has no date.
   */
  days?: number
  /** Sessions logged over the same stretch. */
  sessions?: number
  current: boolean
}

export interface Journey {
  /** Every step up to the highest one open, in order. */
  stops: JourneyStop[]
  firstSessionAt?: number
  /** Sessions logged in all. */
  totalSessions: number
}

/** The step a replay starts from — the same rule `rebuildDerivedState` uses. */
function startingStep(state: AppState): StepId {
  return [state.baseStepId, state.grandfatheredStepId]
    .filter((id): id is StepId => Boolean(id && STEP_BY_ID[id]))
    .reduce<StepId>((highest, id) => (STEP_BY_ID[id].order > STEP_BY_ID[highest].order ? id : highest), 'foundations')
}

/** Whether a session did any of a skill's own work. */
function trained(session: Session, skill: SkillId): boolean {
  return session.sets.some((set) => skillOfExercise(set.exerciseId) === skill)
}

/**
 * One skill's road so far. Read for the skill the state is viewed as unless
 * told otherwise; history is always replayed whole, because one session can
 * open a step on two roads.
 */
export function readJourney(stateIn: AppState, now = Date.now(), skill: SkillId = skillOfState(stateIn)): Journey {
  const state = wholeState(stateIn)
  const road = stepsOf(skill)
  const track = trackOf(state, skill)
  const tracked = trackedSkills(state)
  // With one road every session is that road's; with several, a step's
  // sessions are the ones that trained its skill.
  const all = [...state.sessions].filter((s) => s.startedAt <= now).sort((a, b) => a.startedAt - b.startedAt)
  const sessions = tracked.length > 1 ? all.filter((s) => trained(s, skill)) : all
  const plancheBase = startingStep(state)
  const base = skill === 'planche' ? plancheBase : track.baseStepId
  const baseOrder = STEP_BY_ID[base].order
  // Every road rewound to where it started — the replay `rebuildDerivedState` runs.
  const rewound: Partial<Record<SkillId, SkillTrack>> = {}
  for (const other of tracked) {
    if (other === 'planche') continue
    const t = trackOf(state, other)
    const from = STEP_BY_ID[t.baseStepId] ?? stepsOf(other)[0]
    rewound[other] = {
      ...t,
      stepId: from.id,
      unlocked: stepsOf(other).filter((s) => s.order <= from.order).map((s) => s.id),
    }
  }
  let acc: AppState = {
    ...state,
    sessions: [],
    prs: {},
    achievements: {},
    stepId: plancheBase,
    unlocked: STEPS.filter((s) => s.order <= STEP_BY_ID[plancheBase].order).map((s) => s.id),
    ...(state.tracks ? { tracks: rewound } : {}),
  }
  const opened = new Map<StepId, { at: number; via: 'bar' | 'next-shape'; index: number }>()
  for (const session of all) {
    const { next, events } = applySession(acc, session)
    acc = next
    const unlocks =
      events.unlocks ?? (events.unlockedStep ? [{ stepId: events.unlockedStep, via: events.unlockedVia ?? ('bar' as const) }] : [])
    for (const unlock of unlocks) {
      if (skillOfStep(unlock.stepId) !== skill || opened.has(unlock.stepId)) continue
      // Counted among this road's own sessions; the earning session is one of them.
      const index = Math.max(0, sessions.indexOf(session))
      opened.set(unlock.stepId, { at: session.startedAt, via: unlock.via, index })
    }
  }

  const firstSessionAt = sessions[0]?.startedAt
  // Training logged on a lower step than the base means the base was reached
  // by a jump, not where training began.
  const stepThen = (s: Session) => (skill === 'planche' ? s.stepId : s.skills?.[skill]?.stepId)
  const jumpedToBase = sessions.some((s) => {
    const then = stepThen(s)
    return then !== undefined && STEP_BY_ID[then] !== undefined && skillOfStep(then) === skill && STEP_BY_ID[then].order < baseOrder
  })
  const highest = Math.max(
    baseOrder,
    ...track.unlocked.map((id) => STEP_BY_ID[id]?.order ?? 0),
    ...[...opened.keys()].map((id) => STEP_BY_ID[id].order),
  )

  const stops: (JourneyStop & { index?: number })[] = road.filter((s) => s.order <= highest).map((step) => {
    const current = track.stepId === step.id
    const earned = opened.get(step.id)
    if (earned) return { stepId: step.id, via: earned.via, openedAt: earned.at, index: earned.index, current }
    if (step.id === base && !jumpedToBase && firstSessionAt !== undefined) {
      return { stepId: step.id, via: 'start', openedAt: firstSessionAt, index: 0, current }
    }
    return { stepId: step.id, via: step.order <= baseOrder && !jumpedToBase ? 'start' : 'placed', current }
  })

  // Each dated step runs until the next dated opening after it. The session
  // that earns an opening belongs to the step it cleared, so a step opened by
  // a session counts its own from the one after.
  stops.forEach((stop, i) => {
    if (stop.openedAt === undefined || stop.index === undefined) return
    const firstOwn = stop.via === 'start' ? stop.index : stop.index + 1
    const following = stops.slice(i + 1).find((s) => s.openedAt !== undefined)
    if (following?.openedAt !== undefined && following.index !== undefined) {
      stop.days = Math.max(0, Math.round((following.openedAt - stop.openedAt) / DAY))
      stop.sessions = Math.max(0, following.index - firstOwn + 1)
    } else if (stop.current) {
      stop.days = Math.max(0, Math.floor((now - stop.openedAt) / DAY))
      stop.sessions = Math.max(0, sessions.length - firstOwn)
    }
  })

  return {
    stops: stops.map(({ index: _index, ...stop }) => stop),
    ...(firstSessionAt !== undefined ? { firstSessionAt } : {}),
    totalSessions: sessions.length,
  }
}
