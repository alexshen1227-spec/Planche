import { describe, expect, it } from 'vitest'
import type { AppState } from '../../types'
import { initialState } from '../store'
import { defaultPrefs, newLocation } from './state'
import { estimatedMaxGains, gymRecords, isFirstEstimate, repPlanFor, suggestLoad } from './progression'
import { nextTimeLines } from './sessionLines'
import { gymBadges, weeklySummary } from '../plan/weekly'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import type { GymSession } from './types'

const DAY = 86_400_000
const NOW = new Date(2026, 10, 26, 18).getTime() // a Thursday evening

const A = { ...newLocation('Gym A', 'kg', ['chest-press-machine', 'barbell', 'bench', 'dumbbells'] as any, NOW - 200 * DAY), id: 'A' }
const B = { ...newLocation('Gym B', 'kg', ['chest-press-machine', 'barbell', 'bench', 'dumbbells'] as any, NOW - 200 * DAY), id: 'B' }
let n = 0
function gs(loc: string, daysAgo: number, ex: string, sets: [number | undefined, number, number?][]): GymSession {
  const at = NOW - daysAgo * DAY
  return {
    id: `g${n++}`,
    locationId: loc,
    startedAt: at,
    endedAt: at + 3_600_000,
    name: 'Lift',
    exercises: [{ exerciseId: ex, sets: sets.map(([kg, reps, rpe], i) => ({ ...(kg ? { kg, unit: 'kg' } : {}), reps, ...(rpe ? { rpe } : {}), at: at + i * 60_000 })) }],
  } as any
}
function withGym(sessions: GymSession[]): AppState {
  const base = initialState()
  return {
    ...base,
    onboarded: true,
    gym: { ...(base as any).gym, locations: [A, B], activeLocationId: 'B', sessions, ratings: {}, favoriteAt: {}, prefs: defaultPrefs(NOW - 100 * DAY) },
  } as AppState
}

describe('gym9: estimated maxes compare only what can be compared', () => {
  it('requires a completed rep in a later workout to badge a heavier lift, and counts only productive sets in the week', () => {
    const first = gs('A', 2, 'goblet-squat', [[2, 10, 7]])
    first.exercises.push({ ...first.exercises[0], sets: [{ kg: 3, reps: 2, at: first.startedAt + 4000 }] })
    const last = gs('A', 1, 'goblet-squat', [[4, 0, 10], [2, 10, 7]])
    const saved = withGym([first, last])
    expect(weeklySummary(saved, NOW).gymSets).toBe(3)
    expect(gymBadges(saved).find((b) => b.id === 'gym-step')?.at).toBeUndefined()
    last.exercises[0].sets[0].reps = 1
    expect(gymBadges(saved).find((b) => b.id === 'gym-step')?.at).toBe(last.endedAt)
  })
  const machine = [
    gs('A', 7, 'machine-chest-press', [[50, 8, 8], [50, 8, 8], [50, 8, 8]]),
    gs('B', 1, 'machine-chest-press', [[70, 8, 8], [70, 8, 8], [70, 8, 8]]),
  ]
  it('a machine at a second gym is not a new max, a record, a badge or a celebration', () => {
    expect(estimatedMaxGains(machine)).toEqual([])
    expect(weeklySummary(withGym(machine), NOW).newMaxes).toEqual([])
    expect(gymBadges(withGym(machine) as any).find((b) => b.id === 'gym-pr')?.at).toBeUndefined()
    // The record is the one at the place it was last used, never the other gym's machine.
    expect(gymRecords(machine)['machine-chest-press'].bestE1rm?.locationId).toBe('B')
    const reversed = gymRecords([machine[1], { ...machine[0], startedAt: NOW - DAY / 2, endedAt: NOW - DAY / 4 }])['machine-chest-press']
    expect(reversed.bestE1rm?.locationId).toBe('A')
    expect(reversed.bestE1rm!.kg).toBeLessThan(70)
  })
  it('the same machine at one gym still counts, and a free weight carries across gyms', () => {
    const same = [machine[0], gs('A', 1, 'machine-chest-press', [[60, 8, 8], [60, 8, 8]])]
    expect(estimatedMaxGains(same).map((g) => g.exerciseId)).toEqual(['machine-chest-press'])
    const free = [gs('A', 7, 'bench-press', [[60, 8], [60, 8]]), gs('B', 1, 'bench-press', [[70, 8], [70, 8]])]
    expect(estimatedMaxGains(free)).toHaveLength(1)
  })
  it('rating the same performance later is not a new max', () => {
    const s = [gs('B', 8, 'bench-press', [[60, 8], [60, 8], [60, 8]]), gs('B', 1, 'bench-press', [[60, 8, 7], [60, 8, 7], [60, 8, 7]])]
    expect(estimatedMaxGains(s)).toEqual([])
    expect(weeklySummary(withGym(s), NOW).newMaxes).toEqual([])
    // ...while one more rep at the same load is.
    const more = [s[0], gs('B', 1, 'bench-press', [[60, 9, 7], [60, 9, 7]])]
    expect(estimatedMaxGains(more)).toHaveLength(1)
  })
  it('the first gym session has nothing to beat, even with a heavier set inside it', () => {
    const first = [gs('B', 1, 'bench-press', [[40, 10], [60, 8], [70, 6]])]
    expect(estimatedMaxGains(first)).toEqual([])
    expect(gymBadges(withGym(first) as any).find((b) => b.id === 'gym-pr')?.at).toBeUndefined()
    expect(weeklySummary(withGym(first), NOW).newMaxes).toEqual([])
  })
})

describe('gym9: the first time at a new gym starts from the latest performance', () => {
  const bench = GYM_EXERCISE_BY_ID['bench-press']
  const history = [gs('A', 100, 'bench-press', [[100, 5, 10], [100, 5, 10]]), gs('A', 20, 'bench-press', [[80, 8, 10], [80, 8, 10]])]
  const ask = (hist: GymSession[], youth: boolean, emphasis: 'muscle' | 'strength' = 'muscle') =>
    suggestLoad({ exerciseId: 'bench-press', location: B as any, sessions: hist, plan: repPlanFor(bench, emphasis, youth), youth, now: NOW })
  it('does not prescribe the old best (82.5 kg) after a latest 80 x 8 at RPE 10', () => {
    const s = ask(history, false)
    expect(s.kind).toBe('from-estimate')
    expect(s.kg!).toBeLessThanOrEqual(75)
  })
  it('under 18 it never asks for more than one step past what was really lifted', () => {
    // A heavy top set (100 x 3 at RPE 10) over back-off sets of 70: the estimate prescribes ~78 kg, the load really lifted was 70.
    const topSet = [gs('A', 20, 'bench-press', [[100, 3, 10], [70, 8, 8], [70, 8, 8]])]
    const adult = ask(topSet, false)
    const kid = ask(topSet, true)
    expect(adult.kg!).toBeGreaterThan(75)
    expect(kid.kg!).toBeLessThanOrEqual(72.5 + 1e-9)
  })
})

describe('gym9: one session is a first estimate', () => {
  it('says so until a second session backs the number', () => {
    const one = gymRecords([gs('B', 3, 'lat-pulldown', [[50, 10], [50, 10]])])['lat-pulldown']
    expect(isFirstEstimate(one)).toBe(true)
    const two = gymRecords([gs('B', 9, 'lat-pulldown', [[50, 10]]), gs('B', 3, 'lat-pulldown', [[52.5, 10]])])['lat-pulldown']
    expect(isFirstEstimate(two)).toBe(false)
    // A machine's session at another gym does not back this gym's number.
    const away = gymRecords([gs('A', 9, 'lat-pulldown', [[50, 10]]), gs('B', 3, 'lat-pulldown', [[52.5, 10]])])['lat-pulldown']
    expect(isFirstEstimate(away)).toBe(true)
    expect(isFirstEstimate(undefined)).toBe(true)
  })
})

describe('gym9: next-time lines that do not contradict themselves', () => {
  const lbPlace = { ...newLocation('Home', 'lb', ['dumbbells', 'bench', 'barbell'] as any, NOW - 100 * DAY), id: 'H' }
  const sess = (ex: string, kg: number, reps: number[], rpe = 8, ago = 3) => {
    const at = NOW - ago * DAY
    return { id: `u${ago}`, locationId: 'H', startedAt: at, endedAt: at + 3_600_000, name: 'Lift', exercises: [{ exerciseId: ex, sets: reps.map((r, i) => ({ kg, unit: 'kg', reps: r, rpe, at: at + i })) }] } as any
  }
  it('a load the place cannot make is the nearest load, not a step up', () => {
    const s = sess('back-squat', 60, [8, 8])
    const [line] = nextTimeLines(s, [s], lbPlace as any, false, NOW)
    expect(line.text).toMatch(/^Nearest load here/)
    expect(line.text).not.toMatch(/^Next time/)
    expect(line.text).toMatch(/not a step up/)
  })
  it('under 18 a unit change that adds a sliver is the nearest load, never "up one step"', () => {
    const s = sess('db-bench-press', 22.5, [10, 10])
    const sug = suggestLoad({ exerciseId: 'db-bench-press', location: lbPlace as any, sessions: [s], plan: { range: [6, 10], targetRpe: 8 }, youth: true, now: NOW })
    expect(sug.kind).toBe('repeat')
    expect(sug.nearestTo).toBe(22.5)
    const [line] = nextTimeLines(s, [s], lbPlace as any, true, NOW)
    expect(line.why).not.toMatch(/up one step/)
    expect(line.text).toMatch(/Nearest load/)
  })
  it('a real step is still "up one step"', () => {
    const sug = suggestLoad({
      exerciseId: 'db-bench-press',
      location: lbPlace as any,
      sessions: [sess('db-bench-press', 20, [10, 10], 8, 6), sess('db-bench-press', 22.68, [10, 10], 8, 3)],
      plan: { range: [6, 10], targetRpe: 8 },
      youth: true,
      now: NOW,
    })
    expect(sug.kind).toBe('increase')
    expect(sug.why).toMatch(/up one step/)
  })
})
