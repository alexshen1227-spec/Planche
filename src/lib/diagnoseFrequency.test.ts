import { describe, expect, it } from 'vitest'
import type { AppState, Session } from '../types'
import type { GymSession } from './gym/types'
import { defaultGym } from './gym/state'
import { initialState } from './store'
import { trainingDaysPerWeek } from './diagnose'

// The weekly goal counts training days, skill and gym alike (round eight). The
// plateau diagnosis's "training less than you planned" once compared one
// skill's sessions with it, so two skill days and two gym days a week against
// a goal of four read as half the plan.
const DAY = 86_400_000
const NOW = new Date(2026, 10, 23, 18).getTime()

const skill = (daysAgo: number, kind: Session['workoutKind'] = 'auto') => ({ startedAt: NOW - daysAgo * DAY, workoutKind: kind }) as unknown as Session
const lifts = (daysAgo: number) => ({ startedAt: NOW - daysAgo * DAY }) as unknown as GymSession

function athlete(skillDays: number[], gymDays: number[], micro: number[] = []): AppState {
  const base = initialState()
  return {
    ...base,
    sessions: [...skillDays.map((d) => skill(d)), ...micro.map((d) => skill(d, 'micro'))],
    gym: { ...defaultGym(base.profile.equipment, 'kg', 1), sessions: gymDays.map(lifts) },
  }
}

describe('the frequency cause counts what the weekly goal counts', () => {
  it('counts gym days beside skill days: two of each a week is four', () => {
    // Three weeks: skill on two days and the gym on two other days each week.
    const skillDays = [20, 17, 13, 10, 6, 3]
    const gymDays = [19, 15, 12, 8, 5, 1]
    expect(trainingDaysPerWeek(athlete(skillDays, gymDays), NOW)).toBeGreaterThanOrEqual(3.9)
    // Skill days alone would have read two a week.
    expect(trainingDaysPerWeek(athlete(skillDays, []), NOW)).toBeCloseTo(2.1, 5)
  })

  it('counts a day once, however many sessions it held, and leaves minimum doses out', () => {
    expect(trainingDaysPerWeek(athlete([10, 3], [10, 3], [5]), NOW)).toBeCloseTo(2 / (10 / 7), 5)
  })

  it('divides by the time actually trained, at least a week', () => {
    // A fortnight in, three days a week.
    expect(trainingDaysPerWeek(athlete([13, 11, 9, 6, 4, 2], []), NOW)).toBeGreaterThanOrEqual(3)
    expect(trainingDaysPerWeek(athlete([1], []), NOW)).toBe(1)
    expect(trainingDaysPerWeek(athlete([], []), NOW)).toBe(0)
  })
})
