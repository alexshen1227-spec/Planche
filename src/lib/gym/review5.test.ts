import { describe, expect, it } from 'vitest'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { cycleMuscleState, defaultGym, defaultPrefs, mergeGym, reduceGym } from './state'
import { repPlanFor, suggestLoad } from './progression'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = new Date(2026, 10, 22, 17).getTime()
const gymA: any = {
  id: 'a',
  name: 'Gym A',
  unit: 'kg',
  equipment: ['barbell', 'bench', 'dumbbells', 'cable', 'lat-pulldown', 'chest-press-machine'],
  updatedAt: 1,
}
const gymB: any = { ...gymA, id: 'b', name: 'Gym B', updatedAt: 2 }
const sess = (id: string, loc: string, daysAgo: number, kg: number, ex = 'bench-press') => ({
  id,
  locationId: loc,
  startedAt: NOW - daysAgo * DAY,
  endedAt: NOW - daysAgo * DAY + HOUR,
  name: 'Push',
  exercises: [{ exerciseId: ex, sets: [1, 2, 3].map(() => ({ kg, reps: 8, rpe: 8, at: NOW - daysAgo * DAY })) }],
})
const plan = repPlanFor(GYM_EXERCISE_BY_ID['bench-press'], 'muscle', true)
const ask = (location: any, sessions: any[], exerciseId = 'bench-press') =>
  suggestLoad({ exerciseId, location, sessions: sessions as any, plan, youth: true, now: NOW })

describe('a merge never leaves no place', () => {
  const base: any = { ...defaultGym(['floor'] as any), locations: [gymA, gymB], activeLocationId: 'a' }
  const t1 = reduceGym(base, { op: 'deleteLocation', id: 'a' }, 1000)!
  const t2 = reduceGym(base, { op: 'deleteLocation', id: 'b' }, 1001)!
  for (const [name, x, y] of [['local first', t1, t2], ['incoming first', t2, t1]] as const) {
    it(name, () => {
      const m = mergeGym(x, y)!
      expect(m.locations.map((l) => l.id)).toEqual(['b'])
      expect(m.activeLocationId).toBe('b')
      expect(m.deletedLocationIds).not.toContain('b')
      expect(m.deletedLocationIds).toContain('a')
      // and it converges whichever way round
      expect(mergeGym(mergeGym(x, y), y)).toEqual(mergeGym(mergeGym(y, x), x))
    })
  }
})

describe('time away follows the lift, not the place', () => {
  it('a new gym still knows the lift was last done 14 weeks ago', () => {
    const s = ask(gymB, [sess('x', 'a', 100, 60)])
    expect(s.kind).toBe('decrease')
    expect(s.why).toMatch(/14 weeks/)
    expect(s.kg).toBeLessThan(60)
  })
  it('the old gym says the same', () => {
    const s = ask(gymA, [sess('x', 'a', 100, 60)])
    expect(s.kind).toBe('decrease')
    expect(s.why).toMatch(/14 weeks/)
  })
  it('work elsewhere yesterday is not time away', () => {
    const s = ask(gymA, [sess('z', 'a', 60, 50), sess('y', 'b', 1, 70)])
    expect(s.kind).not.toBe('decrease')
    expect(s.why).not.toMatch(/weeks/)
  })
  it('a machine keeps its own place', () => {
    const s = ask(gymA, [sess('z', 'a', 60, 50, 'machine-chest-press'), sess('y', 'b', 1, 70, 'machine-chest-press')], 'machine-chest-press')
    expect(s.kind).toBe('decrease')
    expect(s.why).toMatch(/9 weeks/)
  })
})

describe('two tabs correct different sets of one session', () => {
  const t = NOW
  const base: any = { ...defaultGym(['floor'] as any), locations: [gymA], activeLocationId: 'a' }
  const g0 = reduceGym(base, { op: 'saveSession', session: { id: 'S', locationId: 'a', startedAt: t, endedAt: t + HOUR, name: 'Push', exercises: [{ exerciseId: 'bench-press', sets: [{ kg: 60, reps: 8, at: t }, { kg: 60, reps: 8, at: t }] }] } as any }, t + HOUR)!
  const tabA = reduceGym(g0, { op: 'correctSet', sessionId: 'S', exerciseIndex: 0, setIndex: 0, kg: 62.5 }, t + 2 * HOUR)!
  const tabB = reduceGym(g0, { op: 'correctSet', sessionId: 'S', exerciseIndex: 0, setIndex: 1, reps: 6 }, t + 3 * HOUR)!
  const sets = (g: any) => g.sessions[0].exercises[0].sets.map((x: any) => [x.kg, x.reps])
  it('keeps both corrections, either order', () => {
    expect(sets(mergeGym(tabA, tabB))).toEqual([[62.5, 8], [60, 6]])
    expect(sets(mergeGym(tabB, tabA))).toEqual([[62.5, 8], [60, 6]])
  })
  it('the later edit of the same set wins', () => {
    const later = reduceGym(g0, { op: 'correctSet', sessionId: 'S', exerciseIndex: 0, setIndex: 0, kg: 65 }, t + 4 * HOUR)!
    expect(sets(mergeGym(tabA, later))[0]).toEqual([65, 8])
    expect(sets(mergeGym(later, tabA))[0]).toEqual([65, 8])
  })
  it('returns local itself when nothing differs', () => {
    expect(mergeGym(tabA, tabA)).toBe(tabA)
    expect(mergeGym(tabB, structuredClone(g0))).toBe(tabB)
  })
})

describe('the muscle cycle advances from the stored state', () => {
  const p0 = defaultPrefs(1)
  const tap = (p: typeof p0, n: number) => {
    for (let i = 0; i < n; i++) p = cycleMuscleState(p, 'calves')
    return p
  }
  it('normal → priority → off → normal', () => {
    expect(tap(p0, 1).musclesPriority).toEqual(['calves'])
    const two = tap(p0, 2)
    expect(two.musclesOff).toEqual(['calves'])
    expect(two.musclesPriority).toEqual([])
    const three = tap(p0, 3)
    expect(three.musclesOff).toEqual([])
    expect(three.musclesPriority).toEqual([])
  })
  it('a muscle sits in one list, once, even from a doubled save', () => {
    const odd = { ...p0, musclesPriority: ['calves', 'calves'] as any }
    const next = cycleMuscleState(odd, 'calves')
    expect(next.musclesOff).toEqual(['calves'])
    expect(next.musclesPriority).toEqual([])
  })
})
