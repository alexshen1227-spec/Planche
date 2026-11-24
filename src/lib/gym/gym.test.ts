import { describe, expect, it } from 'vitest'
import { GYM_EXERCISE_BY_ID, GYM_EXERCISES, jointsToRest } from '../../data/gym/exercises'
import { GYM_EQUIPMENT_BY_ID, MUSCLE_BY_ID, PATTERN_LABEL, type Pattern } from '../../data/gym/catalog'
import { athleticDomain } from '../../data/gym/exercises'
import { alternativesFor, availableAt, canDoHere } from './availability'
import { buildGymSession, FOCUS_LABEL } from './builder'
import { estimateOneRepMax, gateTier, gymRecords, isHardBodyweight, plyoGate, repPlanFor, suggestLoad, unlockedTier } from './progression'
import { defaultGym, mergeGym, newLocation, reduceGym, sanitizeGym } from './state'
import type { GymLocation, GymSession, GymSet } from './types'
import { displayLoad, fromKg, maxKgFor, roundToStep, stepKgFor, toKg, unitFor } from './units'
import { initialState, mergeExternalState, normalizeState, reducer } from '../store'
import { prefillReps } from './draft'
import { nextTimeLines } from './sessionLines'

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

it('takes the nearest heavier weight from an offset working load and respects actual weights on the same rack', () => {
  const increase = (exerciseId: string, weight: number, earlier: GymSession[] = []) => {
    const plan = repPlanFor(GYM_EXERCISE_BY_ID[exerciseId])
    const work = [1, 2, 3].map(() => ({ ...set(weight, plan.range[1], 8), unit: 'kg' as const }))
    const visit = session('earned', gymA.id, T0, exerciseId, work)
    return suggestLoad({ exerciseId, location: gymA, sessions: [...earlier, visit], plan, now: T0 + DAY })
  }
  expect(increase('db-lateral-raise', 5)).toMatchObject({ kg: 6, kind: 'increase' })
  expect(increase('lat-pulldown', 42.5)).toMatchObject({ kg: 45, kind: 'increase' })
  const trial = { ...set(5.5, 10, 7, T0 - DAY), unit: 'kg' as const }
  expect(increase('db-lateral-raise', 5, [session('pair', gymA.id, T0 - DAY, 'db-curl', [trial])]).kg).toBe(5.5)
  expect(increase('db-lateral-raise', 5, [session('elsewhere', 'another-gym', T0 - DAY, 'db-curl', [trial])]).kg).toBe(6)
})

it('lowers a working weight when multiple sets miss the range above the prescribed effort', () => {
  const id = 'db-lateral-raise'
  const plan = repPlanFor(GYM_EXERCISE_BY_ID[id])
  const next = (reps: number[], effort: number) => suggestLoad({ exerciseId: id, location: gymA, plan,
    sessions: [session('raises', gymA.id, T0, id, reps.map((n) => set(8, n, effort)))], now: T0 + DAY })
  expect(next([8, 7, 7, 6], 9)).toMatchObject({ kind: 'decrease', kg: 6 })
  expect(next([8, 7], 8).kind).toBe('repeat')
  expect(next([11, 11, 10, 9], 9).kind).toBe('repeat')
})

it('saves and restores timed carries while keeping older rep logs out of their prescription and time chart', async () => {
  const { draftItemFor } = await import('../../components/gym/GymPlayer')
  const { sessionFromDraft, resumePartial, previousSets } = await import('./draft')
  const { sanitizeGym } = await import('./state')
  const { liftSeries } = await import('./performance')
  const { setsCsv } = await import('../exportImport')
  const ex = GYM_EXERCISE_BY_ID['suitcase-carry']
  const legacy = session('legacy', gymA.id, T0, ex.id, [set(10, 8, 7)])
  const item = draftItemFor(ex, gymA, [legacy], false, 3, T0 + DAY)
  expect(item.plan.measure).toBe('seconds')
  expect(item.previous).toBeUndefined()
  expect(item.sets.map((s) => s.reps)).toEqual([20, 20, 20])
  item.sets[0] = { done: true, reps: 25, load: 10, rpe: 7 }
  const timed = sessionFromDraft({ id: 'timed', startedAt: T0 + DAY, name: 'Carry', locationId: gymA.id, items: [item] }, T0 + DAY + 60_000)
  const gym = sanitizeGym({ ...defaultGym([]), locations: [gymA], activeLocationId: gymA.id, sessions: [legacy, timed] })!
  const saved = gym.sessions.find((s) => s.id === timed.id)!
  expect(saved.exercises[0].sets[0]).toMatchObject({ measure: 'seconds', reps: 25 })
  expect(resumePartial(saved)?.items[0].plan.measure).toBe('seconds')
  expect(previousSets(gym.sessions, ex.id, gymA.id, 'kg')?.[0].reps).toBe(25)
  expect(liftSeries(gym.sessions, ex.id).map((s) => [s.kind, s.points[0].value]).sort()).toEqual([['reps', 8], ['seconds', 25]])
  const lines = setsCsv({ ...initialState(), gym }).trim().split('\n').map((l) => l.split(','))
  expect(lines.slice(1).map((row) => [row[9], row[10]])).toEqual([['8', ''], ['', '25']])
})

it('carries earned reps forward at a fixed rack and offers an actionable swap below its lightest weight', () => {
  const rack = { ...gymA, gear: { dumbbells: { stepKg: 2, maxKg: 2 } } }
  const log: GymSession[] = []
  const plan = { range: [6, 10] as [number, number], targetRpe: 8 }
  for (const [i, n] of [10, 11, 12, 13, 14, 15, 15].entries()) {
    const t = T0 + i * DAY
    const visit = session(String(i), rack.id, t, 'goblet-squat', [set(2, n, 6), set(2, n, 6)])
    visit.exercises[0].repRange = plan.range
    visit.exercises[0].targetRpe = 8
    log.push(visit)
    const next = suggestLoad({ exerciseId: 'goblet-squat', location: rack, sessions: log, plan })
    expect(next.kg).toBe(2)
    expect(prefillReps(plan, next)).toBe(Math.min(n + 1, 15))
    expect(nextTimeLines(visit, log, rack, false)[0].text).toContain(`2 kg × ${next.targetReps}`)
  }
  const grind = session('hard', rack.id, T0, 'db-lateral-raise', Array.from({ length: 4 }, () => set(2, 4, 10)))
  for (const youth of [true, false]) {
    const s = suggestLoad({ exerciseId: 'db-lateral-raise', location: rack, sessions: [grind], plan, youth })
    expect(s).toMatchObject({ kind: 'at-minimum-weight', chooseAlternative: true, easierId: 'bent-arm-db-lateral-raise' })
    expect(s.kg).toBeUndefined()
  }
})

it('uses a stated empty bar and the increments above it, including a change of gym or time away', () => {
  const location = { ...gymA, gear: { barbell: { minKg: 15, stepKg: 4, maxKg: 31 } } }
  const exerciseId = 'barbell-curl'
  const plan = { range: [8, 12] as [number, number], targetRpe: 8 }
  const visit = (kg: number, reps: number, effort: number, place = location.id) =>
    session('bar', place, T0, exerciseId, [set(kg, reps, effort), set(kg, reps, effort)])
  const next = (last: GymSession, days = 1) => suggestLoad({ exerciseId, location, plan, sessions: [last], now: T0 + days * DAY })
  expect(next(visit(15, 12, 8)).kg).toBe(19)
  expect(next(visit(19, 5, 10)).kg).toBe(15)
  expect(next(visit(15, 7, 10))).toMatchObject({ kg: 15, targetReps: 5 })
  expect(next(visit(15, 4, 10)).chooseAlternative).toBe(true)
  expect(next(visit(3, 8, 8, 'another')).kg).toBeUndefined()
  expect(next(visit(15, 9, 8), 100)).toMatchObject({ kg: 15, targetReps: 7 })
})

it('earns a load increase only after all prescribed working sets of that lift are completed', () => {
  const place: GymLocation = { ...gymA, unit: 'lb', gear: {} }
  const kg = toKg(35, 'lb')
  const performed = { ...set(kg, 10, 8), unit: 'lb' as const }
  const original = session('partial', place.id, T0, 'goblet-squat', [performed, performed])
  const pending = { exerciseId: 'goblet-squat', repRange: [6, 10] as [number, number], targetRpe: 8, restSec: 120, unit: 'lb' as const, sets: [{ reps: 6 }, { reps: 6 }] }
  const next = (s: GymSession) => suggestLoad({ exerciseId: 'goblet-squat', location: place, sessions: [s], plan: { range: [6, 10], targetRpe: 8 }, now: T0 + DAY })
  const partial: GymSession = { ...original, completion: 'partial', remaining: { items: [pending] } }
  expect(next(partial)).toMatchObject({ kg, kind: 'repeat', why: expect.stringContaining('2 planned sets') })
  const stopped: GymSession = { ...partial, remaining: undefined, exercises: [{ ...original.exercises[0], plannedWorkingSets: 4 }] }
  expect(next(stopped).kind).toBe('repeat')
  const finishedLift = { ...original.exercises[0], sets: [performed, performed, performed, performed], plannedWorkingSets: 4 }
  expect(next({ ...partial, exercises: [finishedLift], remaining: { items: [{ ...pending, exerciseId: 'leg-curl' }] } }))
    .toMatchObject({ kg: toKg(40, 'lb'), kind: 'increase' })
})

describe('catalog', () => {
  it('keeps all pressing and hanging variants off a reported elbow and all gripping hangs off a reported wrist', () => {
    for (const ex of GYM_EXERCISES.filter((e) => ['horizontal-press', 'incline-press', 'dip', 'vertical-press', 'horizontal-pull', 'vertical-pull'].includes(e.pattern))) {
      expect(jointsToRest(ex.id), ex.name).toEqual(expect.arrayContaining(['elbows', 'shoulders', 'wrists']))
    }
    for (const id of ['hanging-leg-raise', 'hanging-knee-raise', 'l-sit', 'ab-wheel']) {
      expect(jointsToRest(id), id).toEqual(expect.arrayContaining(['wrists', 'elbows', 'shoulders']))
    }
    expect(jointsToRest('bodyweight-squat')).not.toContain('elbows')
  })
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
    expect(roundToStep(30, 2.5, 24)).toBe(22.5)
  })
})

describe('availability and swaps', () => {
  it('chooses the implement before transferring a load from another gym', () => {
    const small: GymLocation = { id: 'small', name: 'Home', unit: 'kg', equipment: ['dumbbells', 'bench'], updatedAt: T0,
      gear: { dumbbells: { unit: 'lb', stepKg: toKg(5, 'lb'), maxKg: toKg(25, 'lb') } } }
    const heavy = session('barbell-session', 'a', T0, 'romanian-deadlift', [set(100, 8), set(100, 8), set(100, 8)])
    const plan = buildGymSession({ location: small, focus: 'full', minutes: 45, sessions: [heavy], ratings: { 'db-rdl': 'love' }, youth: false, now: T0 + 3 * DAY })
    expect(canDoHere('romanian-deadlift', small)).toBe(false)
    expect(canDoHere('seal-row', small)).toBe(false)
    expect(plan.items.find((it) => it.exerciseId === 'db-rdl')?.suggestion).toMatchObject({ kind: 'first-time' })
    const db = GYM_EXERCISE_BY_ID['db-rdl']
    expect(unitFor(db, small)).toBe('lb')
    expect(stepKgFor(db, small)).toBe(toKg(5, 'lb'))
    expect(maxKgFor(db, small)).toBe(toKg(25, 'lb'))
    const earlier = session('dumbbell-session', 'a', T0, db.id, [set(25, 8), set(25, 8)])
    const suggestion = suggestLoad({ exerciseId: db.id, location: small, sessions: [heavy, earlier], plan: repPlanFor(db) })
    expect(fromKg(suggestion.kg!, 'lb')).toBeCloseTo(25)
    expect(availableAt(small).filter((e) => e.load !== 'bodyweight').every((e) => e.stepFrom && small.equipment.includes(e.stepFrom))).toBe(true)
    expect(availableAt({ ...small, equipment: ['hip-thrust-machine'] }).some((e) => e.id === 'machine-hip-thrust' && e.load === 'machine')).toBe(true)
  })
  it('programs only what the location has', () => {
    expect(canDoHere('bench-press', home)).toBe(false)
    expect(canDoHere('pull-up', home)).toBe(true)
    for (const e of availableAt(home)) {
      expect(e.needs.every((g) => g.some((i) => ['floor', 'parallettes', 'pullup-bar'].includes(i))), e.id).toBe(true)
    }
  })

  it('needs actual bar supports and a raised row bench, and distinguishes ring dips from dips on high bars', () => {
    const garage: GymLocation = { ...home, equipment: ['floor', 'bench', 'incline-bench', 'barbell', 'parallettes', 'rings'] }
    const presses = ['bench-press', 'close-grip-bench', 'incline-bench-press', 'barbell-incline-close-grip', 'jm-press']
    for (const id of [...presses, 'seal-row', 'dip']) expect(canDoHere(id, garage), id).toBe(false)
    expect(canDoHere('ring-dip', garage)).toBe(true)
    for (const support of ['squat-rack', 'bench-stands'] as const) {
      const equipped: GymLocation = { ...garage, equipment: [...garage.equipment, support, 'seal-row-bench', 'dip-bars'] }
      for (const id of [...presses, 'seal-row', 'dip']) expect(canDoHere(id, equipped), id).toBe(true)
    }
    const session = buildGymSession({ location: garage, youth: true, minutes: 60, focus: 'full', priority: ['triceps'], sessions: [] })
    expect(session.items.length).toBeGreaterThan(0)
    expect(session.items.some((it) => [...presses, 'seal-row', 'dip', 'ring-dip'].includes(it.exerciseId))).toBe(false)
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
  it('repeats the weight actually used at this location and increases on its configured rack', () => {
    const hist = [session('db-rack', 'a', T0, 'db-bench-press', [{ ...set(12.5, 9, 7), unit: 'kg' }])]
    const suggest = (location: GymLocation, sessions = hist) => suggestLoad({ exerciseId: 'db-bench-press', location, sessions, plan, now: T0 + DAY })
    expect(suggest(gymA)).toMatchObject({ kind: 'repeat', kg: 12.5 })
    expect(suggest(gymA).nearestTo).toBeUndefined()
    expect(suggest({ ...gymA, gear: { dumbbells: { maxKg: 10 } } }).kg).toBe(10)
    const rack = { ...gymA, gear: { dumbbells: { stepKg: 2.5, maxKg: 30 } } }
    expect(suggest(rack, [session('next', 'a', T0, 'db-bench-press', [set(12.5, 10, 7), set(12.5, 10, 7)])])).toMatchObject({ kind: 'increase', kg: 15 })
  })
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

  it('lets a scheduled single set progress over two separate visits including older completed logs', () => {
    const visit = (d: number, planned?: number) => {
      const s = session(String(d), gymA.id, T0 + d * DAY, 'db-row', [set(14, 10, 8)])
      s.completion = 'full'
      s.exercises[0].repRange = [6, 10]
      s.exercises[0].plannedWorkingSets = planned
      return s
    }
    const row = (h: GymSession[]) => suggestLoad({ exerciseId: 'db-row', location: gymA, plan: { range: [6, 10], targetRpe: 8 }, sessions: h })
    expect(row([visit(0)])).toMatchObject({ kg: 14, targetReps: 10, kind: 'repeat' })
    expect(row([visit(0), visit(5, 1)])).toMatchObject({ kg: 16, kind: 'increase' })
    expect(row([visit(0, 2), visit(5, 1)]).kind).toBe('repeat')
    expect(row([visit(0, 1), visit(0.01, 1)]).kind).toBe('repeat')
    expect(row([visit(0, 1), visit(50, 1)]).kind).toBe('repeat')
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
      // A run is one rep a set and a hold is counted in seconds: neither has a rep range. Jumps and throws counted
      // in reps do (round seven: a landing was programmed at 5-8 for a 13-year-old).
      if (e.pattern === 'sprint' || e.count === 'seconds') continue
      for (const emphasis of ['strength', 'muscle', 'endurance', 'power'] as const) {
        // A hard bodyweight movement (Nordic curl, dragon flag) is a few slow lowering reps, not a loaded max:
        // its floor is 4 (round 2 review). Everything else keeps the six-rep floor.
        const floor = isHardBodyweight(e) && emphasis !== 'power' ? 4 : 6
        expect(repPlanFor(e, emphasis, true).range[0], `${e.id} ${emphasis}`).toBeGreaterThanOrEqual(floor)
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
    // A log of a movement the catalogue does not have is kept under its id (review 9), never dropped.
    expect(g.sessions[1].exercises).toEqual([{ exerciseId: 'not-real', sets: [] }])
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
  it('keeps a corrected workout when an old editor repeats its original save', () => {
    const log = session('shared', 'home', T0, 'push-up', [set(undefined, 8)])
    const saved = reduceGym(defaultGym([]), { op: 'saveSession', session: log }, T0)!
    const corrected = reduceGym(saved, { op: 'correctSet', sessionId: log.id, exerciseIndex: 0, setIndex: 0, reps: 10 }, T0 + 1)!
    expect(corrected.sessions[0].exercises[0].sets[0].reps).toBe(10)
    expect(reduceGym(corrected, { op: 'saveSession', session: log }, T0 + 2)).toBe(corrected)
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
    expect(lines[0]).toBe('date,kind,session,place,exercise,section,set,load_kg,unit,reps,hold_sec,rpe,distance_m,contacts')
    expect(lines[1]).toContain('gym,Upper body,"Home, upstairs",push-up,main,1,,,12,,8')
  })
})

describe('found by the review of the gym code', () => {
  it('never steps up on sets whose effort was not logged', () => {
    const plan = repPlanFor(GYM_EXERCISE_BY_ID['db-bench-press'], 'muscle')
    const hist = [session('s1', 'a', T0, 'db-bench-press', [set(20, 10), set(20, 10), set(20, 10)])]
    expect(suggestLoad({ exerciseId: 'db-bench-press', location: gymA, sessions: hist, plan }).kind).toBe('repeat')
  })
  it('keeps a movement out when any of its main muscles is switched off', () => {
    for (const focus of ['lower', 'full', 'pull'] as const) {
      const p = buildGymSession({ location: gymA, minutes: 90, focus, sessions: [], musclesOff: ['quads', 'biceps'] })
      for (const item of p.items) {
        const ex = GYM_EXERCISE_BY_ID[item.exerciseId]
        expect(ex.primary.includes('quads') || ex.primary.includes('biceps'), `${focus} ${ex.id}`).toBe(false)
      }
    }
  })
  it('merges identical saved gyms into the same object, whatever order built them', () => {
    const g = sanitizeGym({ ...defaultGym(['parallettes']), prefsUpdatedAt: T0, ratings: { 'bench-press': 'love' }, prefs: { goals: { strength: 3 }, updatedAt: T0 } })!
    const copy = sanitizeGym(JSON.parse(JSON.stringify(g)))!
    expect(mergeGym(g, copy)).toBe(g)
  })
  it('treats a birth-year difference of 18 as possibly 17', async () => {
    const { conservative } = await import('./draft')
    const year = new Date(T0).getFullYear()
    expect(conservative({ equipment: [], birthYear: year - 18 }, T0)).toBe(true)
    expect(conservative({ equipment: [], birthYear: year - 19 }, T0)).toBe(false)
  })
})

describe('previous values on each set', () => {
  it('shows last session’s sets at this place in the display unit, and nothing the first time', async () => {
    const { previousSets } = await import('./draft')
    const hist = [session('s1', 'a', T0, 'db-bench-press', [set(toKg(50, 'lb'), 10, 8), set(toKg(50, 'lb'), 9)])]
    expect(previousSets(hist, 'db-bench-press', 'a', 'lb')).toEqual([
      { load: 50, reps: 10, rpe: 8 },
      { load: 50, reps: 9 },
    ])
    expect(previousSets(hist, 'db-bench-press', 'home', 'lb')).toBeUndefined()
  })
})

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

describe('the exercise library', () => {
  it('is big, with unique ids and only real equipment and patterns', () => {
    expect(GYM_EXERCISES.length).toBeGreaterThanOrEqual(150)
    const known = new Set<string>([...Object.keys(GYM_EQUIPMENT_BY_ID), 'floor', 'parallettes', 'band', 'pullup-bar', 'rings', 'dip-bars', 'box', 'wall', 'pole'])
    for (const e of GYM_EXERCISES) {
      for (const group of e.needs) {
        expect(group.length, e.id).toBeGreaterThan(0)
        for (const item of group) expect(known.has(item), `${e.id} needs ${item}`).toBe(true)
      }
      expect(PATTERN_LABEL[e.pattern], e.id).toBeDefined()
      if (e.stepFrom) expect(GYM_EQUIPMENT_BY_ID[e.stepFrom], `${e.id} stepFrom`).toBeDefined()
    }
  })
  it('every speed and power movement has a tier, a rung and a dose in contacts or reps', () => {
    for (const e of GYM_EXERCISES.filter((e) => ['jump', 'throw', 'sprint', 'drill'].includes(e.pattern))) {
      expect(e.tier, e.id).toBeDefined()
      expect(e.rung, e.id).toBeGreaterThan(0)
      expect(e.dose, e.id).toBeDefined()
      expect(e.count, e.id).toBeDefined()
      expect(athleticDomain(e), e.id).not.toBeNull()
    }
    // Maximal runs are always gated as the top tier.
    for (const e of GYM_EXERCISES.filter((e) => e.maximal)) expect(gateTier(e)).toBe('high')
  })
  it('offers at least three same-pattern swaps for every common pattern at a well-equipped gym', () => {
    const gym = everything()
    const common: Pattern[] = [
      'horizontal-press', 'incline-press', 'vertical-press', 'dip', 'chest-fly', 'lateral-raise', 'rear-delt', 'triceps', 'biceps',
      'vertical-pull', 'horizontal-pull', 'straight-arm-pull', 'squat', 'lunge', 'hinge', 'knee-extension', 'knee-flexion', 'calf',
      'core-flexion', 'core-anti-rotation', 'carry', 'jump', 'throw', 'adduction', 'abduction',
    ]
    for (const pattern of common) {
      const first = GYM_EXERCISES.find((e) => e.pattern === pattern)!
      const alts = alternativesFor(first.id, gym, {}).filter((a) => a.pattern === pattern)
      expect(alts.length, pattern).toBeGreaterThanOrEqual(3)
    }
  })
  it('keeps the calisthenics-adjacent work honest about what it carries toward', () => {
    expect(GYM_EXERCISE_BY_ID['pseudo-planche-push-up'].carries).toContain('planche')
    expect(GYM_EXERCISE_BY_ID['typewriter-pull-up'].carries).toContain('frontlever')
    expect(GYM_EXERCISE_BY_ID['ice-cream-maker'].technical).toBe(true)
    expect(GYM_EXERCISE_BY_ID['copenhagen-plank'].primary).toContain('adductors')
    expect(GYM_EXERCISE_BY_ID['bayesian-curl'].primary).toEqual(['biceps'])
    expect(GYM_EXERCISE_BY_ID['jm-press'].primary).toContain('triceps-long')
    // A machine squat carries nothing toward a skill it does not resemble.
    expect(GYM_EXERCISE_BY_ID['hack-squat'].carries).toBeUndefined()
  })
})

describe('speed and power: the progression gate', () => {
  const logged = (id: string, n: number, exerciseId: string, start = 0) =>
    Array.from({ length: n }, (_, i) => {
      const at = T0 + (start + i) * DAY
      const dose = GYM_EXERCISE_BY_ID[exerciseId].dose!
      const work = Array.from({ length: dose.sets }, (_, index) => set(undefined, dose.range[0], dose.rpe, at + index * 60_000))
      return session(`${id}${i}`, 'all', at, exerciseId, work, 'Speed & power')
    })
  const NOW = T0 + 36 * DAY
  const picks = (plan: ReturnType<typeof buildGymSession>) => plan.items.map((i) => ({ id: i.exerciseId, ex: GYM_EXERCISE_BY_ID[i.exerciseId] }))
  const high = (ex: (typeof GYM_EXERCISES)[number]) => gateTier(ex) === 'high'
  const rich = [
    ...logged('a', 6, 'pogo-hop'),
    ...logged('b', 6, 'b-skip', 6),
    ...logged('c', 6, 'acceleration-run', 12),
    ...logged('d', 6, 'box-jump', 18),
    ...logged('e', 6, 'med-ball-slam', 24),
  ]

  it('an athlete under 18 with no history gets only low-tier speed and power work', () => {
    const plan = buildGymSession({ location: everything(), minutes: 60, focus: 'athletic', sessions: [], youth: true, now: NOW })
    const fast = picks(plan).filter(({ ex }) => athleticDomain(ex))
    expect(fast.length).toBeGreaterThan(2)
    for (const { id, ex } of fast) expect(ex.tier, id).toBe('low')
  })
  it('climbs one tier at a time as lower tiers are logged, and high only after medium', () => {
    const base = { location: everything(), minutes: 60, focus: 'athletic' as const, youth: true, now: NOW }
    const oneLow = buildGymSession({ ...base, sessions: logged('a', 1, 'pogo-hop') })
    expect(picks(oneLow).some(({ ex }) => ex.tier === 'medium')).toBe(false)
    const twoLow = [...logged('a', 2, 'pogo-hop'), ...logged('b', 2, 'a-skip', 2), ...logged('c', 2, 'build-up-run', 4), ...logged('d', 2, 'kneeling-chest-pass', 6)]
    const medium = buildGymSession({ ...base, sessions: twoLow })
    const kinds = picks(medium).filter(({ ex }) => athleticDomain(ex))
    expect(kinds.some(({ ex }) => ex.tier === 'medium')).toBe(true)
    expect(kinds.some(({ ex }) => high(ex))).toBe(false)
    const twoMedium = [...twoLow, ...logged('e', 2, 'box-jump', 8), ...logged('f', 2, 'acceleration-run', 10), ...logged('g', 2, 'med-ball-slam', 12)]
    expect(picks(buildGymSession({ ...base, sessions: twoMedium })).some(({ ex }) => high(ex))).toBe(true)
  })
  it('never gives a young athlete a maximal sprint or a high plyometric while only low tiers are logged', () => {
    const history = [...logged('a', 6, 'pogo-hop'), ...logged('b', 6, 'a-march', 6), ...logged('c', 6, 'build-up-run', 12), ...logged('d', 6, 'landing-stick', 18)]
    for (const focus of ['athletic', 'lower', 'full'] as const) {
      for (const minutes of [20, 45, 90]) {
        const plan = buildGymSession({
          location: everything(),
          minutes,
          focus,
          sessions: history,
          youth: true,
          now: NOW,
          goals: { strength: 2, power: 5, physique: 1, skills: 1, endurance: 0 },
        })
        for (const { id, ex } of picks(plan)) {
          expect(ex.maximal, `${focus} ${id}`).not.toBe(true)
          expect(high(ex), `${focus} ${id}`).toBe(false)
        }
      }
    }
    const flying = GYM_EXERCISE_BY_ID['flying-sprint']
    expect(plyoGate(flying, history, true, NOW).allowed).toBe(false)
    expect(plyoGate(flying, history, true, NOW).reason).toBeTruthy()
    expect(plyoGate(GYM_EXERCISE_BY_ID['depth-jump'], history, true, NOW).allowed).toBe(false)
    expect(unlockedTier(history, 'jump', true, NOW)).toBe('medium')
    expect(unlockedTier(history, 'sprint', true, NOW)).toBe('medium')
  })
  it('does not count a session in the future, and one session of a tier is not enough for a young athlete', () => {
    expect(unlockedTier(logged('a', 3, 'pogo-hop', 200), 'jump', true, NOW)).toBe('low')
    expect(unlockedTier(logged('a', 1, 'pogo-hop'), 'jump', true, NOW)).toBe('low')
    expect(unlockedTier(logged('a', 2, 'pogo-hop'), 'jump', true, NOW)).toBe('medium')
    // medium alone, with no low work on record, is not a route to high
    expect(unlockedTier(logged('a', 4, 'box-jump'), 'jump', true, NOW)).toBe('low')
  })
  it('lets an adult start at medium but not at the top', () => {
    expect(plyoGate(GYM_EXERCISE_BY_ID['box-jump'], [], false, NOW).allowed).toBe(true)
    expect(plyoGate(GYM_EXERCISE_BY_ID['flying-sprint'], [], false, NOW).allowed).toBe(false)
    const flying = GYM_EXERCISE_BY_ID['flying-sprint']
    expect(plyoGate(flying, logged('a', 1, 'build-up-run'), false, NOW).allowed).toBe(false)
    expect(plyoGate(flying, logged('a', 1, 'acceleration-run'), false, NOW).allowed).toBe(true)
  })
  it('requires prior days of actual running before maximal sprinting', () => {
    const flying = GYM_EXERCISE_BY_ID['flying-sprint']
    const at = T0 + DAY
    const march = session('march', 'all', T0, 'a-march', [set(undefined, 1, 10, T0)])
    const run = logged('run', 1, 'acceleration-run')[0]
    const allowed = (s: GymSession[], when = at) => plyoGate(flying, s, false, when).allowed
    expect(allowed([march])).toBe(false)
    expect(allowed(logged('skip', 1, 'b-skip'))).toBe(false)
    expect(allowed([run], run.endedAt + 500)).toBe(false)
    for (const edits of [{ warmup: true }, { rpe: 10 }, { rpe: undefined }, { reps: 0 }]) {
      expect(allowed([{ ...run, exercises: run.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, ...edits })) })) }])).toBe(false)
    }
    expect(allowed([run])).toBe(true)
    expect(allowed([run], T0 + 90 * DAY)).toBe(false)
    const low = logged('two', 1, 'pogo-hop')[0]
    expect(unlockedTier([low, { ...low, id: 'another' }], 'jump', true, at)).toBe('low')
  })
  it('keeps gated movements out of swap lists when the athlete is known', () => {
    const gated = alternativesFor('pogo-hop', everything(), {}, [], { youth: true, sessions: [], now: NOW })
    for (const a of gated) expect(plyoGate(a, [], true, NOW).allowed, a.id).toBe(true)
    expect(gated.some((a) => a.id === 'depth-jump')).toBe(false)
    expect(alternativesFor('pogo-hop', everything(), {}).some((a) => a.id === 'depth-jump')).toBe(true)
  })
  it('asks nothing high of a lighter day', () => {
    const full = buildGymSession({ location: everything(), minutes: 60, focus: 'athletic', sessions: rich, youth: true, now: NOW })
    expect(picks(full).some(({ ex }) => high(ex))).toBe(true)
    const light = buildGymSession({ location: everything(), minutes: 60, focus: 'athletic', sessions: rich, youth: true, now: NOW, volumeFactor: 0.8 })
    expect(picks(light).some(({ ex }) => high(ex))).toBe(false)
  })
  it('puts every explosive block before the strength movement, with one high-intensity block at most', () => {
    for (const youth of [true, false]) {
      const plan = buildGymSession({ location: everything(), minutes: 90, focus: 'athletic', sessions: youth ? rich : [], youth, now: NOW })
      const order = picks(plan)
      const strengthAt = order.findIndex(({ ex }) => !athleticDomain(ex))
      expect(strengthAt, 'a strength movement comes last').toBe(order.length - 1)
      // drills, then jumps, then runs, then throws
      const rank = (p: string) => ({ drill: 0, jump: 1, sprint: 2, throw: 3 })[p] ?? 4
      const ranks = order.map(({ ex }) => rank(ex.pattern))
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
      expect(order.filter(({ ex }) => high(ex)).length).toBeLessThanOrEqual(1)
      expect(order.filter(({ ex }) => ex.pattern === 'drill').length).toBeGreaterThan(0)
      expect(plan.name).toBe(FOCUS_LABEL.athletic)
      expect(FOCUS_LABEL.athletic).toBe('Speed & power')
      if (plan.items.length > 2) expect(plan.estimatedMin).toBeLessThanOrEqual(90)
    }
  })
  it('respects muscles off, joints to avoid and ratings', () => {
    const gym = everything()
    const off = buildGymSession({ location: gym, minutes: 60, focus: 'athletic', sessions: rich, youth: true, now: NOW, musclesOff: ['calves', 'quads'] })
    for (const { id, ex } of picks(off)) expect(ex.primary.some((m) => m === 'calves' || m === 'quads'), id).toBe(false)
    const noAnkles = buildGymSession({ location: gym, minutes: 60, focus: 'athletic', sessions: rich, youth: true, now: NOW, avoidJoints: ['ankles', 'knees'] })
    for (const { id, ex } of picks(noAnkles)) expect(ex.stress.some((j) => j === 'ankles' || j === 'knees'), id).toBe(false)
    const first = buildGymSession({ location: gym, minutes: 60, focus: 'athletic', sessions: rich, youth: false, now: NOW })
    const avoided = Object.fromEntries(first.items.map((i) => [i.exerciseId, 'avoid' as const]))
    const second = buildGymSession({ location: gym, minutes: 60, focus: 'athletic', sessions: rich, youth: false, now: NOW, ratings: avoided })
    for (const i of second.items) expect(avoided[i.exerciseId]).toBeUndefined()
  })
  it('programs only what the place has', () => {
    const bare = buildGymSession({ location: home, minutes: 45, focus: 'athletic', sessions: [], youth: true, now: NOW })
    for (const i of bare.items) expect(canDoHere(i.exerciseId, home), i.exerciseId).toBe(true)
  })
  it('keeps the sprint distance and rest when a sled is added manually or repeated with plates', async () => {
    const { draftItemFor } = await import('../../components/gym/GymPlayer')
    const { countWord } = await import('./progression')
    const sled = GYM_EXERCISE_BY_ID['sled-push'], place = everything()
    const item = draftItemFor(sled, place, [], false)
    expect(item.sets.map((s) => s.reps)).toEqual([1, 1, 1, 1])
    expect(item.restSec).toBe(120)
    expect(countWord(sled, 1)).toBe('15 m')
    const last = session('sled', place.id, T0, sled.id, [set(20, 1, 7), set(20, 1, 7)])
    const recommendation = (youth: boolean) => suggestLoad({ exerciseId: sled.id, location: place,
      sessions: [last], now: T0 + DAY, plan: repPlanFor(sled, 'power', youth), youth })
    expect(recommendation(true)).toMatchObject({ reps: [1, 1], targetReps: 1, kg: 20, kind: 'repeat' })
    expect(recommendation(false).why).toContain('15 m')
    expect(estimateOneRepMax(last.exercises[0].sets[0], sled.id)).toBeNull()
  })

  it('counts contacts and runs, never load', () => {
    const plan = repPlanFor(GYM_EXERCISE_BY_ID['acceleration-start'])
    expect(plan.range).toEqual([1, 1])
    const s = suggestLoad({ exerciseId: 'acceleration-start', location: everything(), sessions: [], plan })
    expect(s.kg).toBeUndefined()
    expect(s.kind).toBe('bodyweight')
    const hops = suggestLoad({ exerciseId: 'pogo-hop', location: everything(), sessions: [], plan: repPlanFor(GYM_EXERCISE_BY_ID['pogo-hop']) })
    expect(hops.kg).toBeUndefined()
    expect(GYM_EXERCISE_BY_ID['pogo-hop'].count).toBe('contacts')
  })
})

describe('assisted movements', () => {
  const withMachine: GymLocation = { ...gymA, id: 'm', equipment: [...gymA.equipment, 'assisted-pullup'] }
  const plan = repPlanFor(GYM_EXERCISE_BY_ID['assisted-pull-up'], 'muscle')
  const [lo, hi] = plan.range
  const day = (sets: GymSet[]) => [session('ap', 'm', T0, 'assisted-pull-up', sets)]

  it('takes help off when every set reaches the top, and puts help back after a grinding miss', () => {
    const up = suggestLoad({ exerciseId: 'assisted-pull-up', location: withMachine, sessions: day([set(30, hi, 8), set(30, hi, 8)]), plan, now: T0 + DAY })
    expect(up).toMatchObject({ kind: 'increase', kg: 25 })
    const down = suggestLoad({ exerciseId: 'assisted-pull-up', location: withMachine, sessions: day([set(30, lo - 2, 10), set(30, lo - 3, 10)]), plan, now: T0 + DAY })
    expect(down).toMatchObject({ kind: 'decrease', kg: 35 })
    const last = suggestLoad({ exerciseId: 'assisted-pull-up', location: withMachine, sessions: day([set(5, hi, 8), set(5, hi, 8)]), plan, now: T0 + DAY })
    expect(last).toMatchObject({ kind: 'increase', kg: 0 })
    expect(last.why).toMatch(/none/)
  })

  it('never reads help as strength: no estimated max and no heaviest-lift record', () => {
    expect(estimateOneRepMax({ kg: 40, reps: 5 }, 'assisted-pull-up')).toBeNull()
    expect(estimateOneRepMax({ kg: 40, reps: 5 }, 'lat-pulldown')).not.toBeNull()
    const rec = gymRecords(day([set(40, 8, 8)]))['assisted-pull-up']
    expect(rec.heaviest).toBeUndefined()
    expect(rec.bestE1rm).toBeUndefined()
    expect(rec.mostReps?.reps).toBe(8)
  })
})
