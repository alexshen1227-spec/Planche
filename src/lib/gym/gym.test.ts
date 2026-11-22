import { describe, expect, it } from 'vitest'
import { GYM_EXERCISE_BY_ID, GYM_EXERCISES } from '../../data/gym/exercises'
import { MUSCLE_BY_ID } from '../../data/gym/catalog'
import { alternativesFor, availableAt, canDoHere } from './availability'
import { buildGymSession } from './builder'
import { estimateOneRepMax, gymRecords, repPlanFor, suggestLoad } from './progression'
import { defaultGym, mergeGym, newLocation, reduceGym, sanitizeGym } from './state'
import type { GymLocation, GymSession, GymSet } from './types'
import { displayLoad, fromKg, roundToStep, stepKgFor, toKg } from './units'
import { initialState, mergeExternalState, normalizeState, reducer } from '../store'

const T0 = Date.UTC(2026, 10, 2, 17)
const DAY = 86_400_000
const gymA: GymLocation = {
  id: 'a',
  name: 'Gym A',
  unit: 'kg',
  equipment: ['barbell', 'squat-rack', 'bench', 'incline-bench', 'dumbbells', 'cable', 'lat-pulldown', 'leg-press', 'leg-curl', 'chest-press-machine', 'pullup-bar', 'dip-bars'],
  gear: { dumbbells: { maxKg: 30 } },
  updatedAt: T0,
}
const home: GymLocation = { id: 'home', name: 'Home', unit: 'kg', equipment: ['parallettes', 'pullup-bar'], updatedAt: T0 }

const set = (kg: number | undefined, reps: number, rpe?: number, at = T0): GymSet => ({
  ...(kg ? { kg } : {}),
  reps,
  ...(rpe ? { rpe } : {}),
  at,
})
const session = (id: string, locationId: string, at: number, exerciseId: string, sets: GymSet[], name = 'Upper body'): GymSession => ({
  id,
  locationId,
  startedAt: at,
  endedAt: at + 3600_000,
  name,
  exercises: [{ exerciseId, sets }],
})

describe('catalog', () => {
  it('every exercise names real muscles, a unique id and a cue', () => {
    expect(new Set(GYM_EXERCISES.map((e) => e.id)).size).toBe(GYM_EXERCISES.length)
    for (const e of GYM_EXERCISES) {
      for (const m of [...e.primary, ...e.secondary]) expect(MUSCLE_BY_ID[m], `${e.id} ${m}`).toBeDefined()
      expect(e.primary.length, e.id).toBeGreaterThan(0)
      expect(e.cue.length, e.id).toBeGreaterThan(10)
    }
  })
  it('the lagging sub-targets the goal names have movements that bias them', () => {
    expect(GYM_EXERCISES.some((e) => e.primary.includes('chest-upper'))).toBe(true)
    expect(GYM_EXERCISES.some((e) => e.primary.includes('triceps-long'))).toBe(true)
  })
})

describe('units', () => {
  it('converts and shows loads the way they are read', () => {
    expect(fromKg(toKg(225, 'lb'), 'lb')).toBeCloseTo(225, 6)
    expect(displayLoad(toKg(45, 'lb'), 'lb')).toBe(45)
    expect(displayLoad(20.4, 'kg')).toBe(20.5)
  })
  it('takes the step from the equipment, in its own unit, unless the location says otherwise', () => {
    const db = GYM_EXERCISE_BY_ID['db-bench-press']
    expect(stepKgFor(db, gymA)).toBe(2)
    expect(stepKgFor(db, { ...gymA, unit: 'lb' })).toBeCloseTo(toKg(5, 'lb'), 6)
    expect(stepKgFor(db, { ...gymA, gear: { dumbbells: { stepKg: 2.5 } } })).toBe(2.5)
    expect(roundToStep(33, 2, 30)).toBe(30)
  })
})

describe('availability and swaps', () => {
  it('programs only what the location has', () => {
    expect(canDoHere('bench-press', home)).toBe(false)
    expect(canDoHere('pull-up', home)).toBe(true)
    for (const e of availableAt(home)) {
      expect(e.needs.every((g) => g.some((i) => ['floor', 'parallettes', 'pullup-bar'].includes(i))), e.id).toBe(true)
    }
  })
  it('offers the same movement first, never an avoided one, and anything hard here last', () => {
    const alts = alternativesFor('machine-chest-press', gymA, { 'bench-press': 'avoid' })
    expect(alts[0].pattern).toBe('horizontal-press')
    expect(alts.map((a) => a.id)).not.toContain('bench-press')
    const hard = alternativesFor('machine-chest-press', { ...gymA, hardHere: ['db-bench-press'] }, {})
    const samePattern = hard.filter((a) => a.pattern === 'horizontal-press').map((a) => a.id)
    expect(samePattern[samePattern.length - 1]).toBe('db-bench-press')
  })
})

describe('double progression', () => {
  const plan = repPlanFor(GYM_EXERCISE_BY_ID['db-bench-press'], 'muscle')
  it('adds the smallest step once every set reaches the top at the target effort', () => {
    const hist = [session('s1', 'a', T0, 'db-bench-press', [set(20, 10, 8), set(20, 10, 8), set(20, 10, 8)])]
    const next = suggestLoad({ exerciseId: 'db-bench-press', location: gymA, sessions: hist, plan })
    expect(next.kind).toBe('increase')
    expect(next.kg).toBe(22)
  })
  it('does not step up from one set stopped early', () => {
    const hist = [session('s1', 'a', T0, 'db-bench-press', [set(20, 10, 8)])]
    expect(suggestLoad({ exerciseId: 'db-bench-press', location: gymA, sessions: hist, plan }).kind).toBe('repeat')
  })
  it('repeats the load until then', () => {
    const hist = [session('s1', 'a', T0, 'db-bench-press', [set(20, 10, 8), set(20, 9, 8.5), set(20, 8, 9)])]
    const next = suggestLoad({ exerciseId: 'db-bench-press', location: gymA, sessions: hist, plan })
    expect(next.kind).toBe('repeat')
    expect(next.kg).toBe(20)
  })
  it('steps back after a grinding miss', () => {
    const hist = [session('s1', 'a', T0, 'db-bench-press', [set(24, 5, 10), set(24, 4, 10)])]
    expect(suggestLoad({ exerciseId: 'db-bench-press', location: gymA, sessions: hist, plan }).kg).toBe(22)
  })
  it('jumps two steps for an adult who blew past the range, never for an athlete under 18', () => {
    const hist = [session('s1', 'a', T0, 'db-bench-press', [set(20, 14, 6), set(20, 13, 7)])]
    expect(suggestLoad({ exerciseId: 'db-bench-press', location: gymA, sessions: hist, plan }).kg).toBe(24)
    expect(suggestLoad({ exerciseId: 'db-bench-press', location: gymA, sessions: hist, plan, youth: true }).kg).toBe(22)
  })
  it('says so at the heaviest dumbbell instead of inventing one', () => {
    const hist = [session('s1', 'a', T0, 'db-bench-press', [set(30, 10, 7), set(30, 10, 7)])]
    expect(suggestLoad({ exerciseId: 'db-bench-press', location: gymA, sessions: hist, plan }).kind).toBe('at-top-weight')
  })
  it('refuses to guess a first machine load, and carries a free-weight estimate to a new gym', () => {
    const machinePlan = repPlanFor(GYM_EXERCISE_BY_ID['machine-chest-press'])
    const first = suggestLoad({ exerciseId: 'machine-chest-press', location: gymA, sessions: [], plan: machinePlan })
    expect(first.kind).toBe('first-time')
    expect(first.kg).toBeUndefined()
    const elsewhere = [session('s1', 'b', T0, 'db-bench-press', [set(24, 8, 8)])]
    const carried = suggestLoad({ exerciseId: 'db-bench-press', location: gymA, sessions: elsewhere, plan, now: T0 + DAY })
    expect(carried.kind).toBe('from-estimate')
    expect(carried.kg).toBeGreaterThan(0)
  })
  it('never gives an athlete under 18 a range below six reps', () => {
    for (const e of GYM_EXERCISES) {
      if (e.explosive) continue
      for (const emphasis of ['strength', 'muscle', 'endurance'] as const) {
        expect(repPlanFor(e, emphasis, true).range[0], `${e.id} ${emphasis}`).toBeGreaterThanOrEqual(6)
      }
    }
  })
  it('estimates a max only where the estimate means something', () => {
    expect(estimateOneRepMax({ kg: 100, reps: 5, rpe: 8 })).toBeCloseTo(100 * (1 + 7 / 30), 6)
    expect(estimateOneRepMax({ kg: 40, reps: 15 })).toBeNull()
    expect(estimateOneRepMax({ reps: 10 })).toBeNull()
  })
  it('derives records by replay', () => {
    const recs = gymRecords([
      session('s1', 'a', T0, 'bench-press', [set(60, 8, 8), set(60, 8, 9)]),
      session('s2', 'a', T0 + DAY, 'bench-press', [set(65, 5, 8, T0 + DAY)]),
    ])
    expect(recs['bench-press'].heaviest?.kg).toBe(65)
    expect(recs['bench-press'].bestE1rm!.kg).toBeGreaterThan(0)
  })
})

describe('gym state', () => {
  it('sanitizes junk away and keeps what is valid', () => {
    const g = sanitizeGym({
      locations: [gymA, { id: 7 }, { ...home, equipment: ['parallettes', 'laser'] }],
      sessions: [
        session('s1', 'a', T0, 'bench-press', [set(60, 8, 8)]),
        { id: 's2', startedAt: 'x' },
        session('s3', 'a', T0 + 1, 'not-real', []),
      ],
      ratings: { 'bench-press': 'love', 'db-row': 'meh', nope: 'avoid' },
      favoriteAt: { 'bench-press': 'a', 'db-row': 'ghost' },
    })!
    expect(g.locations.map((l) => l.id)).toEqual(['a', 'home'])
    expect(g.locations[1].equipment).toEqual(['parallettes'])
    expect(g.sessions.map((s) => s.id)).toEqual(['s1', 's3'])
    expect(g.sessions[1].exercises).toEqual([])
    expect(g.ratings).toEqual({ 'bench-press': 'love' })
    expect(g.favoriteAt).toEqual({ 'bench-press': 'a' })
  })
  it('merges two tabs: union, deletions stick, nothing new means the same object', () => {
    const base = { ...defaultGym(['parallettes']), sessions: [session('s1', 'home', T0, 'push-up', [set(undefined, 10)])] }
    const left = reduceGym(base, { op: 'saveSession', session: session('s2', 'home', T0 + DAY, 'push-up', [set(undefined, 12)]) }, T0 + DAY)!
    const right = reduceGym(base, { op: 'deleteSession', id: 's1' }, T0 + DAY)!
    const merged = mergeGym(left, right)!
    expect(merged.sessions.map((s) => s.id)).toEqual(['s2'])
    expect(mergeGym(merged, merged)).toBe(merged)
  })
  it('keeps at least one location, and moves the active one off a deleted gym', () => {
    let g = defaultGym([])
    g = reduceGym(g, { op: 'saveLocation', location: newLocation('Gym A', 'lb') })!
    const a = g.locations[1].id
    g = reduceGym(g, { op: 'setActiveLocation', id: a })!
    g = reduceGym(g, { op: 'deleteLocation', id: a })!
    expect(g.activeLocationId).toBe('home')
    expect(reduceGym(g, { op: 'deleteLocation', id: 'home' })).toBe(g)
  })
})

describe('the session builder', () => {
  it('programs only what the location has, never an avoided movement, and fits the time', () => {
    for (const minutes of [20, 30, 45, 60, 90]) {
      for (const focus of ['full', 'upper', 'lower', 'push', 'pull'] as const) {
        const plan = buildGymSession({ location: gymA, minutes, focus, sessions: [], ratings: { 'bench-press': 'avoid' } })
        for (const item of plan.items) {
          expect(canDoHere(item.exerciseId, gymA), item.exerciseId).toBe(true)
          expect(item.exerciseId).not.toBe('bench-press')
        }
        if (plan.items.length > 2) expect(plan.estimatedMin, `${focus} ${minutes}`).toBeLessThanOrEqual(minutes)
      }
    }
  })
  it('prefers movements that need no coaching for an athlete under 18', () => {
    const youth = buildGymSession({ location: gymA, minutes: 90, focus: 'lower', sessions: [], youth: true })
    expect(youth.items.length).toBeGreaterThan(2)
    expect(youth.items.some((i) => GYM_EXERCISE_BY_ID[i.exerciseId].technical)).toBe(false)
  })
})

describe('the store keeps gym data', () => {
  it('loads a save from before the gym unchanged, and round-trips one with it', () => {
    const before = normalizeState({ ...initialState(), version: 8 })
    expect(before.gym).toBeUndefined()
    const g = { ...defaultGym(['parallettes']), sessions: [session('s1', 'home', T0, 'push-up', [set(undefined, 15, 8)])] }
    const after = normalizeState(JSON.parse(JSON.stringify({ ...initialState(), gym: g })))
    expect(after.gym?.sessions[0].exercises[0].sets[0].reps).toBe(15)
  })
  it('merges another tab’s gym session in, and the GYM action changes only the gym', () => {
    const local = reducer(initialState(), { type: 'GYM', op: { op: 'init', gym: defaultGym([]) } })
    const incoming = reducer(local, {
      type: 'GYM',
      op: { op: 'saveSession', session: session('x', 'home', T0, 'push-up', [set(undefined, 10)]) },
    })
    const merged = mergeExternalState(local, incoming)
    expect(merged.gym?.sessions.map((s) => s.id)).toEqual(['x'])
    expect(merged.sessions).toEqual(local.sessions)
  })
})

describe('CSV export', () => {
  it('writes skill holds and gym sets as rows, quoting what needs it', async () => {
    const { setsCsv } = await import('../exportImport')
    const s = {
      ...initialState(),
      gym: {
        ...defaultGym([]),
        locations: [{ ...home, name: 'Home, upstairs' }],
        sessions: [session('g1', 'home', T0, 'push-up', [set(undefined, 12, 8)])],
      },
    }
    const csv = setsCsv(s)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('date,kind,session,place,exercise,section,set,load_kg,unit,reps,hold_sec,rpe')
    expect(lines[1]).toContain('gym,Upper body,"Home, upstairs",push-up,main,1,,,12,,8')
  })
})
