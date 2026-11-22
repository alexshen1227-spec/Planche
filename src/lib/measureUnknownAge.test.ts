import { describe, expect, it } from 'vitest'
import { measurementDue } from '../components/MeasurePrompt'
import { initialState } from './store'
import type { AppState, Session } from '../types'

const NOW = new Date(2026, 10, 22, 12).getTime()
const DAY = 86_400_000
const session = { id: 's', startedAt: NOW - 5 * DAY, endedAt: NOW - 5 * DAY + 3_600_000, workoutName: 'x', workoutKind: 'skill', stepId: 'tuck', sets: [] } as unknown as Session

function athlete(birthYear: number | undefined): AppState {
  const s = initialState()
  const profile = { ...s.profile }
  if (birthYear === undefined) delete profile.birthYear
  else profile.birthYear = birthYear
  return { ...s, onboarded: true, startedAt: NOW - 30 * DAY, sessions: [session], profile, settings: { ...s.settings, trackBodyweight: true } }
}

describe('an unknown age is careful about bodyweight, like every gym rule', () => {
  it('does not ask for a weight when no age is set', () => {
    expect(measurementDue(athlete(undefined), NOW).weight).toBe(false)
  })
  it('still asks an adult who turned reminders on', () => {
    expect(measurementDue(athlete(1990), NOW).weight).toBe(true)
  })
  it('does not ask a 17 or 18 year old by birth year', () => {
    expect(measurementDue(athlete(2008), NOW).weight).toBe(false)
  })
})
