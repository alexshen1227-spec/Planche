import { describe, expect, it } from 'vitest'
import type { AppState, CheckIn, FormCheck, Session, SetLog } from '../types'
import { initialState, normalizeState, rebuildDerivedState } from './store'
import { applySession } from './engine'
import { qualifyingProgress } from './progression'
import { sustainedMinimum } from './poseForm'
import { buildPlan, rewardFor } from './coach'
import { painSafeRecoveryWorkout, todaysSession } from '../data/workouts'
import { validateImport } from './exportImport'

const DAY = 86_400_000

function state(stepId: AppState['stepId'] = 'foundations'): AppState {
  return {
    ...initialState(),
    onboarded: true,
    stepId,
    baseStepId: stepId,
    unlocked: [stepId],
  }
}

function form(rating: FormCheck['rating'] = 'clean', confirmed = true): FormCheck {
  return { rating, confirmed }
}

function log(
  exerciseId: string,
  value: number,
  overrides: Partial<SetLog> = {},
): SetLog {
  return {
    exerciseId,
    kind: 'hold',
    value,
    target: value,
    section: 'main',
    at: Date.now(),
    ...overrides,
  }
}

function session(
  stepId: AppState['stepId'],
  sets: SetLog[],
  overrides: Partial<Session> = {},
): Session {
  const at = overrides.startedAt ?? Date.now()
  return {
    id: crypto.randomUUID(),
    startedAt: at,
    endedAt: at + 1_000,
    workoutName: 'Test session',
    workoutKind: 'test',
    stepId,
    sets,
    ...overrides,
  }
}

describe('progression safety', () => {
  it('records a poor-form PR without unlocking a harder step', () => {
    const result = applySession(
      state(),
      session('foundations', [log('ppp-hold', 35, { form: form('broke') })]),
    )
    expect(result.next.prs['ppp-hold']?.value).toBe(35)
    expect(result.next.stepId).toBe('foundations')
  })

  it('unlocks from an athlete-confirmed clean main hold', () => {
    const result = applySession(
      state(),
      session('foundations', [log('ppp-hold', 30, { form: form() })]),
    )
    expect(result.next.stepId).toBe('lean')
  })

  it('does not unlock from Quick Log', () => {
    const s = session('foundations', [log('ppp-hold', 40, { form: form() })], {
      workoutName: 'Quick Log',
      workoutKind: 'auto',
    })
    expect(applySession(state(), s).next.stepId).toBe('foundations')
  })

  it('does not jump back up from unrelated work after selecting a lower step', () => {
    const owned = {
      ...state('lean'),
      unlocked: ['foundations', 'lean', 'frog'] as AppState['unlocked'],
      sessions: [
        session('lean', [log('planche-lean', 30, { form: form() })]),
      ],
    }
    const wristWork = session('lean', [log('wrist-stretch', 30, { section: 'cooldown' })], {
      workoutName: 'Wrist Armor',
      workoutKind: 'template',
    })
    expect(applySession(owned, wristWork).next.stepId).toBe('lean')
  })

  it('uses the weaker side for a unilateral unlock', () => {
    const base = state('oneleg')
    const oneSide = session('oneleg', [
      log('one-leg-planche', 14, { side: 'left', form: form() }),
      log('one-leg-planche', 9, { side: 'right', form: form() }),
    ])
    expect(qualifyingProgress(base, 'oneleg', [oneSide])).toMatchObject({
      value: 9,
      left: 14,
      right: 9,
    })
    expect(applySession(base, oneSide).next.stepId).toBe('oneleg')

    const both = session('oneleg', [log('one-leg-planche', 12, { side: 'right', form: form() })])
    const after = applySession(applySession(base, oneSide).next, both).next
    expect(after.stepId).toBe('straddle')
  })
})

describe('camera evaluator primitives', () => {
  it('uses the lower quartile so a few straight frames cannot hide a bent hold', () => {
    expect(sustainedMinimum([150, 150, 150, 150, 150, 150, 175, 175])).toBe(150)
  })
})

describe('readiness rails', () => {
  it('removes loaded upper-body work after a pain check-in', () => {
    const checkIn: CheckIn = { joints: 'pain', energy: 'ok', at: Date.now() }
    const plan = buildPlan(state('tuck'), Date.now(), checkIn)
    expect(plan.loadPermission).toBe('none')
    expect(todaysSession(state('tuck'), plan)).toEqual(painSafeRecoveryWorkout())
    expect(
      todaysSession(state('tuck'), plan).blocks.some((block) =>
        ['planche', 'push', 'scapula', 'wrist'].includes(
          // The recovery contract is intentionally asserted by exercise ids
          // here so a later content edit cannot quietly re-add loaded work.
          ['hollow-hold', 'leg-lifts', 'arch-hold', 'pancake-stretch', 'jumping-jacks'].includes(
            block.exerciseId,
          )
            ? ''
            : 'planche',
        ),
      ),
    ).toBe(false)
  })
})

describe('coach learning', () => {
  it('compares follow-up performance with a prior baseline, not the arm session peak', () => {
    const t = Date.now() - 5 * DAY
    const history = [
      session('foundations', [log('ppp-hold', 10, { form: form() })], { startedAt: t }),
      session('foundations', [log('ppp-hold', 11, { form: form() })], { startedAt: t + DAY }),
      session('foundations', [log('ppp-hold', 20, { form: form() })], {
        startedAt: t + 2 * DAY,
        strategy: 'intensity',
      }),
      session('foundations', [log('ppp-hold', 12, { form: form() })], { startedAt: t + 4 * DAY }),
    ]
    expect(rewardFor(history, history[2])).toBeGreaterThan(0)
  })
})

describe('backup validation and normalization', () => {
  it('rejects unrelated valid JSON before destructive import work', () => {
    expect(() => validateImport({})).toThrow(/Planche Lab backup/)
  })

  it('sanitizes behavior settings and rebuilds derived progress', () => {
    const raw = {
      ...state(),
      settings: { ...state().settings, theme: 'broken', sound: 'false' },
      sessions: [
        session('foundations', [log('ppp-hold', 30, { form: form() })]),
      ],
      prs: {},
    }
    const normalized = normalizeState(raw)
    expect(normalized.settings.theme).toBe('dark')
    expect(normalized.settings.sound).toBe(true)
    const rebuilt = rebuildDerivedState(normalized)
    expect(rebuilt.prs['ppp-hold']?.value).toBe(30)
    expect(rebuilt.stepId).toBe('lean')
  })
})
