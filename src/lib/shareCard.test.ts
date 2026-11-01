import { describe, expect, it } from 'vitest'
import type { AppState, Session, SetLog, StepId } from '../types'
import { initialState, rebuildDerivedState } from './store'
import { shareCardData, shareCardLines } from './shareCard'
import { STEPS, STEP_BY_ID } from '../data/progressions'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 1, 12)

function athlete(stepId: StepId, sessions: Session[] = []): AppState {
  const base = initialState()
  return rebuildDerivedState({
    ...base,
    onboarded: true,
    stepId,
    baseStepId: stepId,
    unlocked: STEPS.filter((s) => s.order <= STEP_BY_ID[stepId].order).map((s) => s.id),
    sessions,
    profile: { ...base.profile, equipment: ['floor', 'parallettes'], preferredSurface: 'parallettes' },
  })
}

function hold(value: number, verified: boolean): SetLog {
  return {
    exerciseId: 'tuck-planche',
    kind: 'hold',
    value,
    target: value,
    section: 'main',
    surface: 'parallettes',
    at: 0,
    ...(verified
      ? {
          form: {
            rating: 'clean' as const,
            confirmed: true,
            flightConfirmed: true,
            auto: { issues: [], heldIssues: [], confidence: 0.9, cleanSeconds: value, cleanRatio: 1 },
          },
        }
      : {}),
  }
}

function session(sets: SetLog[], daysAgo: number): Session {
  const at = NOW - daysAgo * DAY
  return { id: `s${daysAgo}`, startedAt: at, endedAt: at + 1_800_000, workoutName: 'Training Day', workoutKind: 'auto', stepId: 'tuck', sets: sets.map((s, i) => ({ ...s, at: at + i * 60_000 })) }
}

describe('the share card', () => {
  it('shows the best verified hold, the bar it is aiming at, and the road', () => {
    const data = shareCardData(athlete('tuck', [session([hold(9, true), hold(12, true)], 20), session([hold(11, true)], 3)]), NOW)
    expect(data).toMatchObject({ stepName: 'Tuck Planche', stepNumber: 4, totalSteps: 8, verifiedBest: 12, bar: 20, nextName: 'Advanced Tuck' })
    expect(data.weeksTraining).toBe(3)
    expect(data.sessions).toBe(2)
    expect(data.ladder.filter((s) => s.state === 'cleared').map((s) => s.stepId)).toEqual(['foundations', 'lean', 'frog'])
    expect(data.ladder.find((s) => s.state === 'current')?.stepId).toBe('tuck')
    const lines = shareCardLines(data)
    expect(lines.headline).toBe('12s')
    expect(lines.caption).toBe('best verified hold · 20s opens Advanced Tuck')
    expect(lines.footer).toMatch(/^3 weeks training {2}· {2}2 sessions {2}· {2}\d+s held$/)
  })

  it('refuses to print a number the camera never verified', () => {
    // Timed holds with no camera pass are honest PRs, not verified holds.
    const data = shareCardData(athlete('tuck', [session([hold(15, false)], 2)]), NOW)
    expect(data.verifiedBest).toBeUndefined()
    const lines = shareCardLines(data)
    expect(lines.headline).toBe('—')
    expect(lines.caption).toBe('No verified hold on this step yet')
  })

  it('celebrates an opened step with the verified hold that opened it', () => {
    const state = athlete('tuck', [session([hold(20, true)], 1)])
    expect(state.stepId).toBe('advtuck')
    const data = shareCardData(state, NOW, { stepId: 'advtuck', via: 'bar' })
    expect(data).toMatchObject({ stepName: 'Advanced Tuck', stepNumber: 5, milestone: { fromName: 'Tuck Planche', fromBest: 20, early: false } })
    const lines = shareCardLines(data)
    expect(lines.label).toBe('NEW STEP · 5 OF 8')
    expect(lines.headline).toBe('20s')
    expect(lines.caption).toBe('verified tuck planche · Advanced Tuck opened')
    const early = shareCardLines(shareCardData(state, NOW, { stepId: 'advtuck', via: 'next-shape' }))
    expect(early.caption).toBe('verified tuck planche · Advanced Tuck opened early')
  })

  it('says nothing about weeks of training before the first session', () => {
    const data = shareCardData(athlete('frog'), NOW)
    expect(data.weeksTraining).toBeUndefined()
    expect(shareCardLines(data).footer).toBe('0 sessions')
  })
})
