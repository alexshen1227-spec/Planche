import { describe, expect, it } from 'vitest'
import { GYM_EXERCISE_BY_ID, GYM_EXERCISES } from '../../data/gym/exercises'
import { GYM_EQUIPMENT_BY_ID, MUSCLE_BY_ID, PATTERN_LABEL, type Pattern } from '../../data/gym/catalog'
import { athleticDomain } from '../../data/gym/exercises'
import { alternativesFor, availableAt, canDoHere } from './availability'
import { buildGymSession, FOCUS_LABEL } from './builder'
import { estimateOneRepMax, gateTier, gymRecords, plyoGate, repPlanFor, suggestLoad, unlockedTier } from './progression'
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
      // Unloaded runs, hops and throws are dosed in contacts or reps with no weight: the 6-rep floor is for loaded work.
      if (e.dose && e.load === 'bodyweight') continue
      for (const emphasis of ['strength', 'muscle', 'endurance', 'power'] as const) {
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
    Array.from({ length: n }, (_, i) => session(`${id}${i}`, 'all', T0 + (start + i) * DAY, exerciseId, [set(undefined, 8)], 'Speed & power'))
  const NOW = T0 + 100 * DAY
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
    expect(plyoGate(GYM_EXERCISE_BY_ID['flying-sprint'], logged('a', 1, 'build-up-run'), false, NOW).allowed).toBe(true)
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
