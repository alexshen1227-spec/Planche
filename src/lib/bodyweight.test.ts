import { describe, expect, it } from 'vitest'
import { measurementDue } from '../components/MeasurePrompt'
import { initialState } from './store'
import type { AppState, Session } from '../types'

const NOW = new Date(2026, 10, 22, 12).getTime()
const DAY = 86_400_000
const session: Session = {
  id: 's',
  startedAt: NOW - 5 * DAY,
  endedAt: NOW - 5 * DAY + 3_600_000,
  workoutName: 'x',
  workoutKind: 'skill' as Session['workoutKind'],
  stepId: 'tuck',
  sets: [],
}

function athlete(birthYear: number, trackBodyweight?: boolean): AppState {
  const s = initialState()
  return {
    ...s,
    onboarded: true,
    startedAt: NOW - 30 * DAY,
    sessions: [session],
    profile: { ...s.profile, birthYear },
    settings: { ...s.settings, ...(trackBodyweight !== undefined ? { trackBodyweight } : {}) },
  }
}

describe('bodyweight is optional, neutral and off by default', () => {
  it('never asks for a weight unless the athlete turned reminders on', () => {
    expect(measurementDue(athlete(1990), NOW).weight).toBe(false)
    expect(measurementDue(athlete(1990, true), NOW).weight).toBe(true)
  })
  it('never asks an athlete under 18, even with reminders on', () => {
    expect(measurementDue(athlete(2012, true), NOW).weight).toBe(false)
  })
})
