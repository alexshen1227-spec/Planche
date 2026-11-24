import { describe, expect, it } from 'vitest'
import { defaultGym, defaultPrefs, mergeGym, reduceGym, sanitizeGym } from '../gym/state'
import type { OutsideActivity, SportSlot } from '../gym/types'
import { gymToday } from './planner'
import { sportBetween, sportStart } from './sport'
import { makeAthlete } from './wholeAthleteLoop'

const at = (s: string) => new Date(s).getTime()
const thu: SportSlot = { weekday: 4, kind: 'practice', legs: true, minutes: 90, rpe: 8, hour: 17 }
const fri: SportSlot = { ...thu, weekday: 5, hour: 9 }
const club = { ...defaultGym(['floor', 'wall']), prefs: { ...defaultPrefs(1), sportSchedule: [thu, fri] } }
const move = { day: '2026-10-08', slot: thu, status: 'moved' as const, start: '2026-10-09T19:30' }
const range = (s: typeof club | ReturnType<typeof reduceGym>, day: string) => sportBetween(s, at(day + 'T00:00'), at(day + 'T23:59'))

describe('one occurrence of a recurring sport', () => {
  it('moves a practice alongside another and replaces exactly one with a log, including in a partial-day query', () => {
    const gym = reduceGym(club, { op: 'changeSportDate', change: move }, 2)!
    expect(range(gym, move.day)).toHaveLength(0)
    expect(range(gym, '2026-10-09').map((s) => [s.at, s.movedFrom])).toEqual([[at('2026-10-09T09:00'), undefined], [at(move.start), move.day]])
    const actual: OutsideActivity = { id: 'evening', at: at('2026-10-09T19:25'), kind: 'practice', minutes: 45, rpe: 5, legs: true, updatedAt: 3 }
    const logged = reduceGym(gym, { op: 'logActivity', activity: actual }, 3)!
    expect(range(logged, '2026-10-09').map((s) => [s.scheduled, s.minutes])).toEqual([[true, 90], [false, 45]])
    expect(sportBetween(logged, at('2026-10-09T19:29'), at('2026-10-09T20:00'))).toEqual([])
    expect(range(gym, '2026-10-15')[0].at).toBe(at('2026-10-15T17:00'))
  })

  it('keeps skips, cross-week moves and restores through reload and independent edits on two devices', () => {
    const oct29 = { ...move, day: '2026-10-29', start: '2026-11-02T18:45' }
    const left = reduceGym(club, { op: 'changeSportDate', change: oct29 }, 2)!
    const right = reduceGym(club, { op: 'changeSportDate', change: { day: '2026-10-30', slot: fri, status: 'skipped' } }, 3)!
    const combined = sanitizeGym(JSON.parse(JSON.stringify(mergeGym(left, right))))!
    expect(range(combined, '2026-10-29')).toEqual([])
    expect(range(combined, '2026-10-30')).toEqual([])
    expect(range(combined, '2026-11-02')[0].at).toBe(at(oct29.start))
    const undone = reduceGym(combined, { op: 'changeSportDate', change: { day: oct29.day, slot: thu, status: 'restored' } }, 4)!
    for (const merged of [mergeGym(left, undone), mergeGym(undone, left)]) {
      expect(range(merged, '2026-10-29')[0].at).toBe(at('2026-10-29T17:00'))
      expect(range(merged, '2026-10-30')).toEqual([])
      expect(range(merged, '2026-11-02')).toEqual([])
    }
    expect(sportStart('2026-02-30T18:45')).toBeUndefined()
  })

  it('moves the lower-body recovery rule to the rescheduled date', () => {
    const athlete = makeAthlete({ skills: [], active: 'gym', prefs: { sportSchedule: [thu], minutesByDay: Array(7).fill(60) } })
    const wed = at('2026-10-07T17:00')
    const saturday = at('2026-10-10T16:00')
    const today = (state: typeof athlete, now: number) => gymToday(state, { now, minutes: 60, focus: 'lower' })
    expect(today(athlete, wed).musclesOff).toContain('quads')
    const moved = { ...athlete, gym: reduceGym(athlete.gym, { op: 'changeSportDate', change: { ...move, start: '2026-10-10T18:00' } }, wed) }
    expect(today(moved, wed).musclesOff).not.toContain('quads')
    const day = today(moved, saturday)
    expect(day.musclesOff).toContain('quads')
    expect(day.limits.join(' ')).toContain('your rescheduled practice')
  })
})
