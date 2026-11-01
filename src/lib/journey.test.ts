import { describe, expect, it } from 'vitest'
import type { AppState, Session, SetLog, StepId } from '../types'
import { initialState, rebuildDerivedState, skipToStep } from './store'
import { readJourney } from './journey'
import { STEPS, STEP_BY_ID } from '../data/progressions'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 1, 12)

function athlete(stepId: StepId, sessions: Session[] = []): AppState {
  const base = initialState()
  const state: AppState = {
    ...base,
    onboarded: true,
    stepId,
    baseStepId: stepId,
    unlocked: STEPS.filter((s) => s.order <= STEP_BY_ID[stepId].order).map((s) => s.id),
    sessions,
    profile: { ...base.profile, equipment: ['floor', 'parallettes'], preferredSurface: 'parallettes' },
  }
  return rebuildDerivedState(state)
}

/** A hold with the full evidence chain: Clean, camera pass, flight confirmed. */
function verified(exerciseId: string, value: number): SetLog {
  return {
    exerciseId,
    kind: 'hold',
    value,
    target: value,
    section: 'main',
    surface: 'parallettes',
    at: 0,
    form: {
      rating: 'clean',
      confirmed: true,
      flightConfirmed: true,
      auto: { issues: [], heldIssues: [], confidence: 0.9, cleanSeconds: value, cleanRatio: 1 },
    },
  }
}

function session(stepId: StepId, sets: SetLog[], daysAgo: number): Session {
  const at = NOW - daysAgo * DAY
  return {
    id: `s-${stepId}-${daysAgo}`,
    startedAt: at,
    endedAt: at + 30 * 60_000,
    workoutName: 'Training Day',
    workoutKind: 'auto',
    stepId,
    sets: sets.map((s, i) => ({ ...s, at: at + i * 60_000 })),
  }
}

describe('the road so far', () => {
  it('dates each step from the session that opened it, and times each one to the next', () => {
    const tuckBar = STEP_BY_ID.tuck.unlockSec
    const state = athlete('tuck', [
      session('tuck', [verified('tuck-planche', 6)], 40),
      session('tuck', [verified('tuck-planche', 12)], 30),
      session('tuck', [verified('tuck-planche', tuckBar)], 19),
      session('advtuck', [verified('adv-tuck-planche', 4)], 10),
      session('advtuck', [verified('adv-tuck-planche', 6)], 2),
    ])
    expect(state.stepId).toBe('advtuck')
    const journey = readJourney(state, NOW)
    const byId = Object.fromEntries(journey.stops.map((s) => [s.stepId, s]))

    // Placed at the tuck: the steps before it were never trained here.
    expect(byId.lean).toMatchObject({ via: 'start' })
    expect(byId.lean.openedAt).toBeUndefined()
    // Training began at the tuck with the first session, and the tuck took
    // 21 days and three sessions to clear.
    expect(byId.tuck).toMatchObject({ via: 'start', openedAt: NOW - 40 * DAY, days: 21, sessions: 3 })
    // The advanced tuck opened on the session that met the bar, and is current.
    expect(byId.advtuck).toMatchObject({ via: 'bar', openedAt: NOW - 19 * DAY, current: true, days: 19, sessions: 2 })
    expect(journey.stops.map((s) => s.stepId)).toEqual(['foundations', 'lean', 'frog', 'tuck', 'advtuck'])
    expect(journey.totalSessions).toBe(5)
  })

  it('never borrows a date for a step reached by a jump', () => {
    const trained = athlete('tuck', [session('tuck', [verified('tuck-planche', 8)], 20)])
    const jumped = rebuildDerivedState(skipToStep(trained, 'straddle'))
    const byId = Object.fromEntries(readJourney(jumped, NOW).stops.map((s) => [s.stepId, s]))
    expect(byId.straddle).toMatchObject({ via: 'placed', current: true })
    expect(byId.straddle.openedAt).toBeUndefined()
    expect(byId.straddle.days).toBeUndefined()
  })

  it('has nothing to date before the first session', () => {
    const journey = readJourney(athlete('frog'), NOW)
    expect(journey.firstSessionAt).toBeUndefined()
    expect(journey.stops.every((s) => s.openedAt === undefined && s.days === undefined)).toBe(true)
  })

  it('ignores sessions dated in the future', () => {
    const state = athlete('tuck', [session('tuck', [verified('tuck-planche', 6)], 5), session('tuck', [verified('tuck-planche', 7)], -3)])
    expect(readJourney(state, NOW).totalSessions).toBe(1)
  })
})
