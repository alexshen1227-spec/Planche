import { describe, expect, it } from 'vitest'
import type { AppState, CheckIn, Session, SetLog, StepId } from '../types'
import { initialState } from './store'
import { buildPlan } from './coach'
import { applySession } from './engine'
import { readSignals } from './signals'
import { learningSeries } from './progression'
import { adjustsSetToSet } from './autoregulate'
import { sessionsInWeekOf } from './stats'
import {
  MICRO_HOLDS,
  MICRO_HOLD_SEC,
  adaptiveTarget,
  finalizeWorkout,
  microBlockedReason,
  microDoseWorkout,
} from '../data/workouts'
import { STEPS, STEP_BY_ID } from '../data/progressions'

/**
 * The minimum dose: a few short maximal holds for a day a full session will
 * not happen. Decisions asserted: what it prescribes, every reason it is
 * withheld, and that it never feeds the coach's reading of capacity, the
 * frequency signal or the weekly goal.
 */

const DAY = 86_400_000
// Local times on one date: "today" is the athlete's calendar day.
const NOW = new Date(2026, 10, 1, 18, 0).getTime()
const MORNING = new Date(2026, 10, 1, 9, 0).getTime()

function athlete(stepId: StepId, sessions: Session[] = [], symptoms: AppState['symptoms'] = []): AppState {
  const base = initialState()
  return {
    ...base,
    onboarded: true,
    stepId,
    baseStepId: stepId,
    unlocked: STEPS.filter((s) => s.order <= STEP_BY_ID[stepId].order).map((s) => s.id),
    sessions,
    symptoms,
    profile: { ...base.profile, equipment: ['floor', 'parallettes'], preferredSurface: 'parallettes' },
    settings: { ...base.settings, sessionMinutes: 45 },
  }
}

const key = (value: number, target = value, exerciseId = 'tuck-planche'): Partial<SetLog> => ({
  exerciseId,
  kind: 'hold',
  value,
  target,
  section: 'main',
  surface: 'parallettes',
})

function session(at: number, sets: Partial<SetLog>[], extra: Partial<Session> = {}): Session {
  return {
    id: `s-${at}`,
    startedAt: at,
    endedAt: at + 30 * 60_000,
    workoutName: 'Training Day',
    workoutKind: 'auto',
    stepId: 'tuck',
    sets: sets.map((s, i) => ({ kind: 'hold', target: 5, section: 'main', value: 5, exerciseId: 'tuck-planche', at: at + i * 60_000, ...s })) as SetLog[],
    ...extra,
  }
}

const daysAgo = (n: number) => NOW - n * DAY
const steady = () => [session(daysAgo(6), [key(8), key(8), key(9)]), session(daysAgo(3), [key(8), key(9), key(9)])]

describe('what the minimum dose prescribes', () => {
  it('is a few short holds at the step’s own shape before the bridge opens', () => {
    const state = athlete('tuck', steady())
    const workout = microDoseWorkout(state, buildPlan(state, NOW))
    const main = workout.blocks.filter((b) => b.section === 'main')
    expect(workout.kind).toBe('micro')
    expect(main).toHaveLength(1)
    expect(main[0]).toMatchObject({ exerciseId: 'tuck-planche', sets: MICRO_HOLDS, target: { kind: 'hold', sec: MICRO_HOLD_SEC } })
    // Nothing else is loaded: a warm-up, the holds, one stretch.
    expect(workout.blocks.filter((b) => b.section === 'strength' || b.section === 'core')).toHaveLength(0)
    expect(workout.blocks.some((b) => b.section === 'warmup')).toBe(true)
  })

  it('moves to the next shape once the bridge is open, at an opener it can hold', () => {
    const state = athlete('tuck', [session(daysAgo(4), [key(12), key(11)]), session(daysAgo(2), [key(12), key(12)])])
    const main = microDoseWorkout(state, buildPlan(state, NOW)).blocks.find((b) => b.section === 'main')!
    expect(main.exerciseId).toBe('adv-tuck-planche')
    expect(main.role).toBe('bridge')
    const sec = main.target.kind === 'hold' ? main.target.sec : 0
    expect(sec).toBeGreaterThanOrEqual(1)
    expect(sec).toBeLessThanOrEqual(Math.min(MICRO_HOLD_SEC, Math.round(STEP_BY_ID.advtuck.startSec * 0.4)))
  })

  it('never asks for more than the athlete has shown', () => {
    const state = athlete('tuck', [session(daysAgo(3), [key(2), key(2)])])
    const main = microDoseWorkout(state, buildPlan(state, NOW)).blocks.find((b) => b.section === 'main')!
    expect(main.target).toEqual({ kind: 'hold', sec: 2 })
  })

  it('keeps its holds short: set-to-set targets never lengthen them', () => {
    expect(adjustsSetToSet({ section: 'main', sets: 5, role: 'skill' }, 'micro', false)).toBe(false)
  })
})

describe('when the minimum dose is withheld', () => {
  const plan = (state: AppState, checkIn?: CheckIn) => buildPlan(state, NOW, checkIn)

  it('is allowed on an ordinary fresh day', () => {
    const state = athlete('tuck', steady())
    expect(microBlockedReason(state, plan(state), NOW)).toBeNull()
  })

  it('is withheld for pain and for low energy, like a max test', () => {
    const state = athlete('tuck', steady())
    expect(microBlockedReason(state, plan(state, { joints: 'pain', energy: 'ok', at: NOW, regions: ['wrist'] }), NOW)).toMatch(
      /no loaded work/,
    )
    expect(microBlockedReason(state, plan(state, { joints: 'good', energy: 'tired', at: NOW }), NOW)).toMatch(/low energy/)
  })

  it('is withheld on a lighter day: the day after an RPE 9 session', () => {
    const state = athlete('tuck', [...steady(), session(daysAgo(1), [key(9), key(9), key(9), key(9)], { rpe: 9 })])
    const p = plan(state)
    expect(p.dayType).toBe('technique')
    expect(microBlockedReason(state, p, NOW)).toMatch(/lighter day/)
  })

  it('is withheld while the camera keeps flagging the shape', () => {
    const armFault = (n: number) =>
      session(
        daysAgo(n),
        [0, 1, 2].map(() => ({
          ...key(8, 6),
          form: {
            rating: 'slipped' as const,
            confirmed: true,
            issues: ['arms' as const],
            auto: { issues: ['arms' as const], heldIssues: ['arms' as const], confidence: 0.9, cleanSeconds: 0, cleanRatio: 0 },
          },
        })),
      )
    const state = athlete('tuck', [armFault(9), armFault(6), armFault(3)])
    expect(microBlockedReason(state, plan(state), NOW)).toMatch(/losing their shape/)
  })

  it('is withheld after loaded training today, and after one today already', () => {
    const trained = athlete('tuck', [...steady(), session(MORNING, [key(9), key(9), key(9), key(9)], { rpe: 9 })])
    expect(microBlockedReason(trained, plan(trained), NOW)).toMatch(/already trained hard today/)
    const dosed = athlete('tuck', [...steady(), session(MORNING, [key(3, 3), key(3, 3)], { workoutKind: 'micro', workoutName: 'Tuck Planche · Minimum dose' })])
    expect(microBlockedReason(dosed, plan(dosed), NOW)).toMatch(/already did one today/)
  })

  it('becomes an ordinary session, and says why, when asked for on a day it is withheld', () => {
    const state = athlete('tuck', steady())
    const workout = finalizeWorkout(state, { source: 'micro' }, { joints: 'good', energy: 'tired', at: NOW }, NOW)
    expect(workout.kind).toBe('auto')
    expect(workout.adjustments?.some((a) => /No minimum dose today because you reported low energy/.test(a))).toBe(true)
    const allowed = finalizeWorkout(state, { source: 'micro' }, undefined, NOW)
    expect(allowed.kind).toBe('micro')
    expect(allowed.request).toEqual({ source: 'micro' })
  })
})

describe('the minimum dose is extra, not a session', () => {
  const micro = session(MORNING, [key(3, 3), key(3, 3), key(3, 3), key(3, 3), key(3, 3)], {
    workoutKind: 'micro',
    workoutName: 'Tuck Planche · Minimum dose',
  })

  it('never reads as capacity: targets and the learning series ignore it', () => {
    const without = athlete('tuck', steady())
    const withMicro = athlete('tuck', [...steady(), micro])
    expect(learningSeries(withMicro, 'tuck', 'parallettes', NOW).points).toEqual(learningSeries(without, 'tuck', 'parallettes', NOW).points)
    expect(adaptiveTarget(withMicro, 'tuck', NOW)).toBe(adaptiveTarget(without, 'tuck', NOW))
    expect(readSignals(withMicro, NOW).noisy).toBe(readSignals(without, NOW).noisy)
    // Five holds stopped at three seconds would read as every set hit.
    expect(readSignals(withMicro, NOW).mainHitRate).toBe(readSignals(without, NOW).mainHitRate)
  })

  it('does not hide a session that fell short behind its own easy hits', () => {
    // The last real session missed most targets; five holds stopped at their
    // three-second targets would read as "every set hit" and lift the target.
    const short = [session(daysAgo(3), [key(5, 8), key(6, 8), key(8, 8)])]
    const without = athlete('tuck', short)
    const withMicro = athlete('tuck', [...short, micro])
    expect(readSignals(without, NOW).mainHitRate).toBeLessThan(0.5)
    expect(readSignals(withMicro, NOW).mainHitRate).toBe(readSignals(without, NOW).mainHitRate)
  })

  it('sets no records, so a new athlete’s next target never falls back on one', () => {
    // Found by running a fresh athlete through the app: the first minimum dose
    // set a 1.1s "record" (a three-second hold less the walk-back allowance),
    // and with no other history the next real session's target became 1s.
    const fresh = athlete('tuck')
    const { next, events } = applySession(fresh, micro)
    expect(events.prs).toEqual([])
    expect(next.prs['tuck-planche']).toBeUndefined()
    expect(adaptiveTarget(next, 'tuck', NOW)).toBe(adaptiveTarget(fresh, 'tuck', NOW))
  })

  it('does not count toward the weekly goal or the training-frequency signal', () => {
    const without = athlete('tuck', steady())
    const withMicro = athlete('tuck', [...steady(), micro])
    expect(sessionsInWeekOf(withMicro, NOW, NOW)).toHaveLength(sessionsInWeekOf(without, NOW, NOW).length)
    expect(readSignals(withMicro, NOW).sessionsPerWeek).toBe(readSignals(without, NOW).sessionsPerWeek)
  })
})
