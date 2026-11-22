// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GYM_EXERCISES, GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { GYM_EQUIPMENT_BY_ID } from '../../data/gym/catalog'
import { draftItemFor, useInertBackground } from '../../components/gym/GymPlayer'
import { buildGymSession } from './builder'
import { previousSets } from './draft'
import { allowsUnloaded, countWord, gymRecords, isHardBodyweight, isUnloadedSet, repPlanFor, suggestLoad } from './progression'
import { defaultGym, defaultPrefs, mergeGym, reduceGym, sanitizeGym } from './state'
import type { GymLocation, GymSession, GymSet, GymState } from './types'

/** Decisions the second independent review (round two) found wrong, pinned by the range, the pick, the load and the merge. */

const T0 = Date.UTC(2026, 10, 2, 17)
const DAY = 86_400_000
const NOW = T0 + 100 * DAY

const everything = (): GymLocation => ({
  id: 'all',
  name: 'Everything',
  unit: 'kg',
  equipment: [
    ...(Object.keys(GYM_EQUIPMENT_BY_ID) as GymLocation['equipment']),
    'floor', 'parallettes', 'band', 'pullup-bar', 'rings', 'dip-bars', 'box', 'wall', 'pole',
  ],
  updatedAt: T0,
})
const gymA: GymLocation = {
  id: 'a',
  name: 'Gym A',
  unit: 'kg',
  equipment: ['barbell', 'squat-rack', 'bench', 'incline-bench', 'dumbbells', 'cable', 'leg-press', 'leg-curl', 'pullup-bar', 'dip-bars'],
  updatedAt: T0,
}
/** A home with dumbbells, a bench and parallettes: nothing a machine could press. */
const home: GymLocation = { id: 'home', name: 'Home', unit: 'kg', equipment: ['dumbbells', 'bench', 'parallettes', 'pullup-bar', 'floor'], updatedAt: T0 }

const set = (kg: number | undefined, reps: number, rpe?: number, at = T0): GymSet => ({ ...(kg ? { kg } : {}), reps, ...(rpe ? { rpe } : {}), at })
const session = (id: string, locationId: string, at: number, exerciseId: string, sets: GymSet[]): GymSession => ({
  id,
  locationId,
  startedAt: at,
  endedAt: at + 3600_000,
  name: 'Session',
  exercises: [{ exerciseId, sets }],
})

describe('1. hard bodyweight movements are a few slow reps, and never a beginner’s first pick', () => {
  const HARD = ['nordic-curl', 'reverse-nordic', 'dragon-flag']
  it('gives them 3–6 reps for an adult and 4–6 under 18, whatever the emphasis', () => {
    for (const id of ['nordic-curl', 'reverse-nordic', 'dragon-flag', 'ring-fly', 'archer-pull-up']) {
      const ex = GYM_EXERCISE_BY_ID[id]
      expect(isHardBodyweight(ex), id).toBe(true)
      for (const emphasis of ['strength', 'muscle', 'endurance'] as const) {
        expect(repPlanFor(ex, emphasis, false).range, `${id} ${emphasis}`).toEqual([3, 6])
        expect(repPlanFor(ex, emphasis, true).range, `${id} ${emphasis} youth`).toEqual([4, 6])
      }
    }
  })
  it('leaves ordinary isolation work at 10–15', () => {
    expect(repPlanFor(GYM_EXERCISE_BY_ID['leg-curl'], 'muscle', true).range).toEqual([10, 15])
    expect(repPlanFor(GYM_EXERCISE_BY_ID['cable-curl'], 'muscle', false).range).toEqual([10, 15])
  })
  const flexion = (p: ReturnType<typeof buildGymSession>) => p.items.find((i) => GYM_EXERCISE_BY_ID[i.exerciseId].pattern === 'knee-flexion')?.exerciseId
  it('does not give a 13-year-old a Nordic curl in place of the leg curl machine', () => {
    const plan = buildGymSession({ location: everything(), minutes: 90, focus: 'lower', sessions: [], youth: true, now: NOW })
    for (const id of HARD) expect(plan.items.map((i) => i.exerciseId)).not.toContain(id)
    expect(GYM_EXERCISE_BY_ID[flexion(plan)!].load).toBe('machine')
  })
  it('does not give an adult beginner one either, until it has been logged', () => {
    const fresh = buildGymSession({ location: everything(), minutes: 90, focus: 'lower', sessions: [], now: NOW })
    expect(flexion(fresh)).not.toBe('nordic-curl')
    // Logged once, long ago: it is no longer a stranger, and data order lets it back in.
    const logged = [session('n', 'all', T0, 'nordic-curl', [set(undefined, 5)])]
    expect(flexion(buildGymSession({ location: everything(), minutes: 90, focus: 'lower', sessions: logged, now: NOW }))).toBe('nordic-curl')
  })
  it('lets love bring one back in at any age', () => {
    const plan = buildGymSession({ location: everything(), minutes: 90, focus: 'lower', sessions: [], youth: true, ratings: { 'nordic-curl': 'love' }, now: NOW })
    expect(flexion(plan)).toBe('nordic-curl')
  })
})

describe('2. holds are counted in seconds', () => {
  const HOLDS = ['plank', 'hollow-hold', 'l-sit', 'side-plank', 'copenhagen-plank']
  it('plans seconds, not 10–15 reps', () => {
    for (const id of HOLDS) {
      const ex = GYM_EXERCISE_BY_ID[id]
      expect(ex.count, id).toBe('seconds')
      const [lo, hi] = repPlanFor(ex, 'muscle', true).range
      expect(lo, id).toBeGreaterThanOrEqual(10)
      expect(hi, id).toBeLessThanOrEqual(40)
    }
    expect(repPlanFor(GYM_EXERCISE_BY_ID.plank, 'muscle', false).range).toEqual([20, 40])
  })
  it('says seconds in the suggestion, first time and after', () => {
    const plan = repPlanFor(GYM_EXERCISE_BY_ID.plank, 'muscle', false)
    const first = suggestLoad({ exerciseId: 'plank', location: home, sessions: [], plan, now: NOW })
    expect(first.kind).toBe('bodyweight')
    expect(first.why).toContain('seconds')
    expect(first.why).not.toContain('reps')
    const hist = [session('p', 'home', T0, 'plank', [set(undefined, 25), set(undefined, 30)])]
    const next = suggestLoad({ exerciseId: 'plank', location: home, sessions: hist, plan, now: NOW })
    expect(next.why).toContain('25, 30 seconds')
    expect(next.kg).toBeUndefined()
  })
  it('prefills the bottom of the hold range and reads old rep logs as seconds', () => {
    const item = draftItemFor(GYM_EXERCISE_BY_ID.plank, home, [], false, 3, NOW)
    expect(item.sets.map((s) => s.reps)).toEqual([20, 20, 20])
    const hist = [session('p', 'home', T0, 'plank', [set(undefined, 12), set(undefined, 12)])]
    expect(previousSets(hist, 'plank', 'home', 'kg', NOW)).toEqual([{ reps: 12 }, { reps: 12 }])
    expect(countWord(GYM_EXERCISE_BY_ID.plank, 12)).toBe('12 s')
    expect(countWord(GYM_EXERCISE_BY_ID['push-up'], 12)).toBe('12 reps')
  })
  it('keeps the longest hold as the record', () => {
    const hist = [session('p', 'home', T0, 'plank', [set(undefined, 25), set(undefined, 41), set(undefined, 30)])]
    expect(gymRecords(hist).plank.longestHold).toMatchObject({ sec: 41 })
    expect(gymRecords([session('q', 'home', T0, 'push-up', [set(undefined, 20)])])['push-up'].longestHold).toBeUndefined()
  })
})

describe('3. a lift with no effort logged still moves up, after two sessions at the top', () => {
  const plan = { range: [6, 10] as [number, number], targetRpe: 8 }
  const squat = (id: string, day: number, kg: number, reps: number[], rpe?: number) =>
    session(id, 'a', T0 + day * DAY, 'back-squat', reps.map((r) => set(kg, r, rpe)))
  const next = (sessions: GymSession[], youth = false) => suggestLoad({ exerciseId: 'back-squat', location: gymA, sessions, plan, youth, now: NOW })
  it('repeats after one unrated session at the top (the pinned rule)', () => {
    const s = next([squat('a', 0, 60, [12, 12, 12])])
    expect(s.kind).toBe('repeat')
    expect(s.kg).toBe(60)
  })
  it('steps up one step after two in a row', () => {
    const s = next([squat('a', 0, 60, [12, 12, 12]), squat('b', 3, 60, [12, 12, 12])])
    expect(s.kind).toBe('increase')
    expect(s.kg).toBe(62.5)
  })
  it('steps up one step only, for an adult and under 18', () => {
    const both = [squat('a', 0, 60, [20, 20, 20]), squat('b', 3, 60, [20, 20, 20])]
    expect(next(both, true).kg).toBe(62.5)
    expect(next(both).kg).toBe(62.5)
  })
  it('needs the same load both times, the top both times, and no grind', () => {
    expect(next([squat('a', 0, 57.5, [12, 12, 12]), squat('b', 3, 60, [12, 12, 12])]).kind).toBe('repeat')
    expect(next([squat('a', 0, 60, [12, 12, 8]), squat('b', 3, 60, [12, 12, 12])]).kind).toBe('repeat')
    expect(next([squat('a', 0, 60, [12, 12, 12], 10), squat('b', 3, 60, [12, 12, 12])]).kind).toBe('repeat')
  })
  it('never steps on a latest session that fell short of the top', () => {
    expect(next([squat('a', 0, 60, [12, 12, 12]), squat('b', 3, 60, [9, 8, 8])]).kind).toBe('repeat')
  })
})

describe('4. wrist pain keeps presses out', () => {
  const PRESSES = ['horizontal-press', 'incline-press', 'vertical-press', 'dip', 'triceps', 'biceps', 'chest-fly']
  it('tags every free-weight and bodyweight press, dip, push-up and curl with wrists', () => {
    for (const e of GYM_EXERCISES) {
      if (PRESSES.includes(e.pattern) && ['barbell', 'dumbbell', 'kettlebell', 'bodyweight'].includes(e.load) && !e.explosive) {
        expect(e.stress, e.id).toContain('wrists')
      }
    }
    expect(GYM_EXERCISE_BY_ID['db-bench-press'].stress).toContain('wrists')
    expect(GYM_EXERCISE_BY_ID['db-row'].stress).toContain('wrists')
    expect(GYM_EXERCISE_BY_ID['db-curl'].stress).toContain('wrists')
    expect(GYM_EXERCISE_BY_ID['pogo-hop'].stress).toContain('knees')
  })
  it('builds no press on a push day when the wrists are avoided', () => {
    const pressy = (p: ReturnType<typeof buildGymSession>) => p.items.filter((i) => GYM_EXERCISE_BY_ID[i.exerciseId].pattern.endsWith('press') || GYM_EXERCISE_BY_ID[i.exerciseId].pattern === 'dip')
    // Without the report there is a press to take out...
    expect(pressy(buildGymSession({ location: home, minutes: 60, focus: 'push', sessions: [], now: NOW })).length).toBeGreaterThan(0)
    // ...and with it there is none.
    expect(pressy(buildGymSession({ location: home, minutes: 60, focus: 'push', sessions: [], avoidJoints: ['wrists'], now: NOW }))).toEqual([])
  })
})

describe('5. a loaded lift is never logged at 0 kg', () => {
  const plan = { range: [6, 10] as [number, number], targetRpe: 8 }
  const squat = (id: string, day: number, sets: GymSet[]) => session(id, 'a', T0 + day * DAY, 'back-squat', sets)
  it('ignores 0 kg sets of a loaded movement when suggesting a load', () => {
    const s = suggestLoad({ exerciseId: 'back-squat', location: gymA, sessions: [squat('a', 0, [set(undefined, 8), set(undefined, 8)])], plan, now: NOW })
    expect(s.kind).toBe('first-time')
    expect(s.kg).toBeUndefined()
    // An earlier real session still counts when the latest one had no weight on it.
    const earlier = suggestLoad({
      exerciseId: 'back-squat',
      location: gymA,
      sessions: [squat('a', 0, [set(60, 8), set(60, 8)]), squat('b', 3, [set(undefined, 8), set(undefined, 8)])],
      plan,
      now: NOW,
    })
    expect(earlier.kind).toBe('repeat')
    expect(earlier.kg).toBe(60)
  })
  it('does not ignore bodyweight movements', () => {
    const pushUp = session('p', 'a', T0, 'push-up', [set(undefined, 12)])
    expect(suggestLoad({ exerciseId: 'push-up', location: gymA, sessions: [pushUp], plan, now: NOW }).why).toContain('12')
  })
  it('knows which sets need a weight and which movements may go without', () => {
    const squatEx = GYM_EXERCISE_BY_ID['back-squat']
    expect(isUnloadedSet(squatEx, {})).toBe(true)
    expect(isUnloadedSet(squatEx, { kg: 0 })).toBe(true)
    expect(isUnloadedSet(squatEx, { kg: 60 })).toBe(false)
    expect(isUnloadedSet(GYM_EXERCISE_BY_ID['push-up'], {})).toBe(false)
    expect(allowsUnloaded(squatEx)).toBe(false)
    expect(allowsUnloaded(GYM_EXERCISE_BY_ID['push-up'])).toBe(true)
    for (const a of GYM_EXERCISES.filter((e) => e.assisted)) expect(allowsUnloaded(a), a.id).toBe(true)
  })
})

describe('6. two tabs editing different prefs fields keep both', () => {
  type Prefs = NonNullable<GymState['prefs']>
  const start = (): GymState => {
    const { updatedAt: _u, ...rest } = defaultPrefs(500)
    void _u
    return reduceGym(defaultGym([], 'kg', 1000), { op: 'setPrefs', prefs: rest }, 1000)!
  }
  const edit = (g: GymState, change: (p: Prefs) => Partial<Prefs>, at: number): GymState => {
    const { updatedAt: _u, fieldTimes: _f, ...rest } = g.prefs!
    void _u
    void _f
    return reduceGym(g, { op: 'setPrefs', prefs: { ...rest, ...change(g.prefs!) } }, at)!
  }
  it('keeps tab A’s power goal when tab B changes the schedule, either way round', () => {
    const g0 = start()
    const a = edit(g0, (p) => ({ goals: { ...p.goals, power: 5 } }), 2000)
    const b = edit(g0, () => ({ minutesByDay: [90, 90, 90, 90, 90, 90, 90] }), 3000)
    for (const merged of [mergeGym(a, b)!, mergeGym(b, a)!]) {
      expect(merged.prefs!.goals.power).toBe(5)
      expect(merged.prefs!.minutesByDay).toEqual([90, 90, 90, 90, 90, 90, 90])
    }
  })
  it('lets the later edit of the same field win', () => {
    const g0 = start()
    const a = edit(g0, (p) => ({ goals: { ...p.goals, power: 5 } }), 2000)
    const b = edit(g0, (p) => ({ goals: { ...p.goals, power: 1 } }), 3000)
    expect(mergeGym(a, b)!.prefs!.goals.power).toBe(1)
    expect(mergeGym(b, a)!.prefs!.goals.power).toBe(1)
  })
  it('returns local itself when nothing changed', () => {
    const g0 = start()
    const a = edit(g0, (p) => ({ goals: { ...p.goals, power: 5 } }), 2000)
    expect(mergeGym(a, a)).toBe(a)
    expect(mergeGym(a, g0)).toBe(a)
    expect(mergeGym(a, structuredClone(a))).toBe(a)
  })
  it('keeps field times through a save, and reads prefs saved before them by their one time', () => {
    const g0 = start()
    const a = edit(g0, (p) => ({ goals: { ...p.goals, power: 5 } }), 2000)
    expect(sanitizeGym(JSON.parse(JSON.stringify(a)))!.prefs!.fieldTimes).toEqual(a.prefs!.fieldTimes)
    const { fieldTimes: _f, ...legacyPrefs } = g0.prefs!
    void _f
    const merged = mergeGym({ ...g0, prefs: legacyPrefs }, a)!
    expect(merged.prefs!.goals.power).toBe(5)
  })
})

describe('7. the player hides the page beneath it', () => {
  it('makes #root inert and hidden while open, and restores it after', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { unmount } = renderHook(() => useInertBackground(root))
    expect(root.hasAttribute('inert')).toBe(true)
    expect(root.getAttribute('aria-hidden')).toBe('true')
    act(() => unmount())
    expect(root.hasAttribute('inert')).toBe(false)
    expect(root.hasAttribute('aria-hidden')).toBe(false)
    root.remove()
  })
  it('puts back what was there before', () => {
    const root = document.createElement('div')
    root.setAttribute('inert', '')
    document.body.appendChild(root)
    const { unmount } = renderHook(() => useInertBackground(root))
    act(() => unmount())
    expect(root.hasAttribute('inert')).toBe(true)
    root.remove()
  })
})
