import type { AppState, StepId } from '../types'
import { STEPS, STEP_BY_ID } from '../data/progressions'
import { applySession } from './engine'

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

export function readJourney(state: AppState, now = Date.now()): Journey {
  const sessions = [...state.sessions].filter((s) => s.startedAt <= now).sort((a, b) => a.startedAt - b.startedAt)
  const base = startingStep(state)
  const baseOrder = STEP_BY_ID[base].order
  let acc: AppState = {
    ...state,
    sessions: [],
    prs: {},
    achievements: {},
    stepId: base,
    unlocked: STEPS.filter((s) => s.order <= baseOrder).map((s) => s.id),
  }
  const opened = new Map<StepId, { at: number; via: 'bar' | 'next-shape'; index: number }>()
  sessions.forEach((session, index) => {
    const { next, events } = applySession(acc, session)
    acc = next
    if (events.unlockedStep && !opened.has(events.unlockedStep)) {
      opened.set(events.unlockedStep, { at: session.startedAt, via: events.unlockedVia ?? 'bar', index })
    }
  })

  const firstSessionAt = sessions[0]?.startedAt
  // Training logged on a lower step than the base means the base was reached
  // by a jump, not where training began.
  const jumpedToBase = sessions.some((s) => STEP_BY_ID[s.stepId] && STEP_BY_ID[s.stepId].order < baseOrder)
  const highest = Math.max(
    baseOrder,
    ...state.unlocked.map((id) => STEP_BY_ID[id]?.order ?? 0),
    ...[...opened.keys()].map((id) => STEP_BY_ID[id].order),
  )

  const stops: (JourneyStop & { index?: number })[] = STEPS.filter((s) => s.order <= highest).map((step) => {
    const current = state.stepId === step.id
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
