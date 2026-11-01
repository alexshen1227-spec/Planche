import { describe, expect, it } from 'vitest'
import type { AppState, CheckIn, Session, SetLog, StepId } from '../types'
import { initialState, rebuildDerivedState } from './store'
import { applySession } from './engine'
import { buildPlan } from './coach'
import { todaysSession } from '../data/workouts'
import { STEPS, STEP_BY_ID } from '../data/progressions'
import { BRIDGE_SHARE, bridgeStatus, earlyPromotionEarned, hipOpening } from './bridge'
import { TRANSITIONS } from '../data/transitions'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 1, 12)

function athlete(stepId: StepId, sessions: Session[] = [], settings: Partial<AppState['settings']> = {}): AppState {
  const base = initialState()
  return {
    ...base,
    onboarded: true,
    stepId,
    baseStepId: stepId,
    unlocked: STEPS.filter((s) => s.order <= STEP_BY_ID[stepId].order).map((s) => s.id),
    sessions,
    profile: { ...base.profile, equipment: ['floor', 'parallettes'], preferredSurface: 'parallettes' },
    settings: { ...base.settings, sessionMinutes: 90, ...settings },
  }
}

/** A hold with the full evidence chain: Clean, camera pass, flight confirmed. */
function verified(exerciseId: string, value: number, extra: Partial<SetLog> = {}): Partial<SetLog> {
  return {
    exerciseId,
    kind: 'hold',
    value,
    target: value,
    section: 'main',
    surface: 'parallettes',
    form: {
      rating: 'clean',
      confirmed: true,
      flightConfirmed: true,
      auto: { issues: [], heldIssues: [], confidence: 0.9, cleanSeconds: value, cleanRatio: 1 },
    },
    ...extra,
  }
}

function session(stepId: StepId, sets: Partial<SetLog>[], daysAgo: number): Session {
  const at = NOW - daysAgo * DAY
  return {
    id: `s-${stepId}-${daysAgo}-${Math.random()}`,
    startedAt: at,
    endedAt: at + 30 * 60_000,
    workoutName: 'Training Day',
    workoutKind: 'auto',
    stepId,
    sets: sets.map((s, i) => ({ kind: 'hold', target: 5, section: 'main', at: at + i * 60_000, value: 5, exerciseId: 'tuck-planche', ...s })) as SetLog[],
  }
}

describe('bridge practice', () => {
  it('opens at half the bar, and from day one at the lean', () => {
    const bar = STEP_BY_ID.tuck.unlockSec * BRIDGE_SHARE
    expect(bridgeStatus(athlete('tuck', [session('tuck', [{ value: bar - 1 }], 3)]))!.open).toBe(false)
    expect(bridgeStatus(athlete('tuck', [session('tuck', [{ value: bar }], 3)]))!.open).toBe(true)
    expect(bridgeStatus(athlete('lean'))!.open).toBe(true)
    expect(bridgeStatus(athlete('full'))).toBeNull()
  })

  it('opens every session with fresh next-shape attempts once the bridge is open', () => {
    const state = athlete('tuck', [session('tuck', [{ value: 12 }, { value: 11 }], 3)])
    const plan = { ...buildPlan(state, NOW), strategy: 'balanced' as const, dayType: 'build' as const }
    const workout = todaysSession(state, plan)
    const firstMain = workout.blocks.find((b) => b.section === 'main')!
    expect(firstMain.exerciseId).toBe('adv-tuck-planche')
    expect(firstMain.role).toBe('bridge')
    expect(workout.blocks.some((b) => b.exerciseId === 'tuck-open-close')).toBe(true)
    // The key hold is still the main volume, one set lighter for the attempts.
    const key = workout.blocks.find((b) => b.role === 'skill')!
    expect(key.exerciseId).toBe('tuck-planche')
  })

  it('keeps next-shape attempts out of easy days, sore days and unlock-attempt days', () => {
    const state = athlete('tuck', [session('tuck', [{ value: 12 }], 3)])
    const easy = todaysSession(state, { ...buildPlan(state, NOW), strategy: 'technique', dayType: 'technique' })
    expect(easy.blocks.some((b) => b.role === 'bridge')).toBe(false)

    const niggle: CheckIn = { joints: 'niggle', energy: 'ok', at: NOW, regions: ['wrist'] }
    const sore = buildPlan(state, NOW, niggle)
    expect(sore.challengeAllowed).toBe(false)
    expect(todaysSession(state, sore).blocks.some((b) => b.role === 'bridge')).toBe(false)

    const attempt = todaysSession(state, {
      ...buildPlan(state, NOW),
      strategy: 'balanced',
      dayType: 'push',
      queueUnlockAttempt: true,
      challengeAllowed: true,
    })
    expect(attempt.blocks.some((b) => b.role === 'attempt')).toBe(true)
    expect(attempt.blocks.some((b) => b.role === 'bridge')).toBe(false)
  })
})

describe('early promotion', () => {
  it('opens the next step when its opening dose is held clean and the current hold is past half its bar', () => {
    const start = athlete('tuck')
    const history = [
      session('tuck', [verified('tuck-planche', 10)], 6),
      session('tuck', [verified('adv-tuck-planche', STEP_BY_ID.advtuck.startSec)], 2),
    ]
    let state = start
    let via
    for (const s of history) {
      const { next, events } = applySession(state, s)
      state = next
      via = events.unlockedVia ?? via
    }
    expect(state.stepId).toBe('advtuck')
    expect(via).toBe('next-shape')
    // History replay reaches the same answer.
    expect(rebuildDerivedState({ ...start, sessions: history }).stepId).toBe('advtuck')
  })

  it('needs both halves, and the full evidence chain on the next shape', () => {
    const short = [verified('tuck-planche', 9), verified('adv-tuck-planche', 6)]
    expect(earlyPromotionEarned({ sessions: [session('tuck', short, 1)] }, 'tuck')).toBe(false)
    const tooBrief = [verified('tuck-planche', 12), verified('adv-tuck-planche', 4)]
    expect(earlyPromotionEarned({ sessions: [session('tuck', tooBrief, 1)] }, 'tuck')).toBe(false)
    const noFlight = [
      verified('tuck-planche', 12),
      verified('adv-tuck-planche', 6, {
        form: {
          rating: 'clean',
          confirmed: true,
          auto: { issues: [], confidence: 0.9, cleanSeconds: 6, cleanRatio: 1 },
        },
      }),
    ]
    expect(earlyPromotionEarned({ sessions: [session('tuck', noFlight, 1)] }, 'tuck')).toBe(false)
    const bentArms = [
      verified('tuck-planche', 12),
      verified('adv-tuck-planche', 6, {
        form: {
          rating: 'clean',
          confirmed: true,
          flightConfirmed: true,
          auto: { issues: ['arms'], heldIssues: ['arms'], confidence: 0.9, cleanSeconds: 6, cleanRatio: 1 },
        },
      }),
    ]
    expect(earlyPromotionEarned({ sessions: [session('tuck', bentArms, 1)] }, 'tuck')).toBe(false)
    const both = [verified('tuck-planche', 10), verified('adv-tuck-planche', 5)]
    expect(earlyPromotionEarned({ sessions: [session('tuck', both, 1)] }, 'tuck')).toBe(true)
  })

  it('still opens the usual way at the bar', () => {
    const { next, events } = applySession(athlete('tuck'), session('tuck', [verified('tuck-planche', 20)], 1))
    expect(next.stepId).toBe('advtuck')
    expect(events.unlockedVia).toBe('bar')
  })
})

describe('the hip-opening meter', () => {
  it('reports the median of recent filmed tucks and the trend against earlier ones', () => {
    const withHip = (deg: number, daysAgo: number) =>
      session('tuck', [verified('tuck-planche', 8, { form: { rating: 'clean', confirmed: true, auto: { issues: [], confidence: 0.9, hipAngleDeg: deg } } })], daysAgo)
    expect(hipOpening({ sessions: [withHip(60, 3), withHip(62, 2)] }, NOW)).toBeNull()
    const sessions = [60, 61, 62, 60, 63, 61, 70, 72, 71, 74, 73, 75].map((deg, i) => withHip(deg, 30 - i))
    const meter = hipOpening({ sessions }, NOW)!
    expect(meter.recentDeg).toBe(73)
    expect(meter.earlierDeg).toBe(61)
  })
})

describe('transition guides', () => {
  it('covers every step that has a next one', () => {
    for (const step of STEPS.slice(0, -1)) {
      expect(TRANSITIONS.some((t) => t.from === step.id)).toBe(true)
    }
  })
})

describe('next-shape attempts keep their bar in sight', () => {
  // Simulated: an athlete who came down at every call was given advanced tuck
  // attempts of 2s, then 1s, for good — sized at 70% of the last attempt,
  // which was the last target. The early-promotion hold was 5s.
  it('aims every attempt at the next shape’s opening dose, however short the last ones were', () => {
    const short = (daysAgo: number) =>
      session(
        'tuck',
        [
          { exerciseId: 'adv-tuck-planche', value: 1, target: 1 },
          { exerciseId: 'adv-tuck-planche', value: 1, target: 1 },
          { value: 12, target: 12 },
          { value: 11, target: 11 },
        ],
        daysAgo,
      )
    const state = athlete('tuck', [short(7), short(5), short(3)])
    const plan = { ...buildPlan(state, NOW), strategy: 'balanced' as const, dayType: 'build' as const, queueRetest: false }
    const attempt = todaysSession(state, plan).blocks.find((b) => b.role === 'bridge')!
    expect(attempt.exerciseId).toBe('adv-tuck-planche')
    expect(attempt.target).toEqual({ kind: 'hold', sec: STEP_BY_ID.advtuck.startSec })
  })
})
