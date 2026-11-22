import { describe, expect, it } from 'vitest'
import { activeLocationFor, parseBirthYear, STARTING_MINUTES_BY_DAY, summariseSchedule } from './onboardingPlan'
import { newLocation } from '../../lib/gym/state'

describe('summariseSchedule', () => {
  it('counts training days and reads the typical day as the median', () => {
    const s = summariseSchedule([0, 45, 0, 45, 0, 60, 0])
    expect(s).toMatchObject({ days: 3, typicalMinutes: 45, weeklyGoal: 3, sessionMinutes: 45 })
  })

  it('the starting week is the old default: three days of 45 minutes', () => {
    expect(summariseSchedule(STARTING_MINUTES_BY_DAY)).toMatchObject({ weeklyGoal: 3, sessionMinutes: 45 })
  })

  it('one long weekend day does not set the session length', () => {
    const s = summariseSchedule([0, 30, 30, 30, 0, 0, 150])
    expect(s.weeklyGoal).toBe(4)
    expect(s.sessionMinutes).toBe(30)
  })

  it('keeps the session length inside the range the app offers', () => {
    expect(summariseSchedule([120, 120, 0, 0, 0, 0, 0]).sessionMinutes).toBe(60)
    expect(summariseSchedule([15, 0, 0, 0, 0, 0, 0]).sessionMinutes).toBe(15)
    expect(summariseSchedule([5, 0, 0, 0, 0, 0, 0]).sessionMinutes).toBe(15)
  })

  it('an even count takes the middle of the two middle days, to the nearest five', () => {
    expect(summariseSchedule([30, 45, 0, 0, 0, 0, 0]).typicalMinutes).toBe(40)
  })

  it('seven training days is the most a week can hold', () => {
    expect(summariseSchedule([45, 45, 45, 45, 45, 45, 45]).weeklyGoal).toBe(7)
  })

  it('no training day says so instead of inventing a number', () => {
    const s = summariseSchedule([0, 0, 0, 0, 0, 0, 0])
    expect(s.days).toBe(0)
    expect(s.typicalMinutes).toBeUndefined()
  })
})

describe('parseBirthYear', () => {
  const now = new Date(2026, 10, 22)
  it('accepts a plausible year and refuses the rest', () => {
    expect(parseBirthYear('2010', now)).toBe(2010)
    expect(parseBirthYear('2021', now)).toBeUndefined()
    expect(parseBirthYear('1900', now)).toBeUndefined()
    expect(parseBirthYear('', now)).toBeUndefined()
    expect(parseBirthYear('20x0', now)).toBeUndefined()
    expect(parseBirthYear('2010.5', now)).toBeUndefined()
  })
})

describe('activeLocationFor', () => {
  const home = (equipment: string[]) => ({ id: 'home', equipment: equipment as never })
  it('stays at Home when Home has gym kit', () => {
    const gym = newLocation('Gym', 'kg', ['barbell'])
    expect(activeLocationFor(home(['floor', 'dumbbells']), [gym])).toBe('home')
  })
  it('moves to the first gym with kit when Home has none', () => {
    const empty = newLocation('Empty', 'kg', [])
    const gym = newLocation('Gym', 'kg', ['barbell'])
    expect(activeLocationFor(home(['floor', 'rings']), [empty, gym])).toBe(gym.id)
  })
  it('stays at Home when nothing added has gym kit', () => {
    expect(activeLocationFor(home(['floor']), [newLocation('Gym', 'kg', ['floor'])])).toBe('home')
  })
})
