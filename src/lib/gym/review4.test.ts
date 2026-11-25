// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { GYM_EQUIPMENT_BY_ID } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { draftItemFor } from '../../components/gym/GymPlayer'
import { gymBadges } from '../plan/weekly'
import { buildGymSession, setsForFactor, type GymFocus } from './builder'
import { dayOfItem } from './draft'
import { repPlanFor, suggestLoad } from './progression'
import { mergeGym, reduceGym, sanitizeGym } from './state'
import type { GymLocation, GymSession, GymSet, GymState } from './types'

/** The third independent review's gym findings, each pinned by the decision (sets, loads, stored values), not the sentence. */

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
  equipment: ['barbell', 'squat-rack', 'bench', 'incline-bench', 'dumbbells', 'cable', 'lat-pulldown', 'leg-press', 'leg-curl', 'chest-press-machine', 'pullup-bar', 'dip-bars'],
  updatedAt: T0,
}
const set = (kg: number | undefined, reps: number, rpe?: number, at = T0): GymSet => ({ ...(kg ? { kg } : {}), reps, ...(rpe ? { rpe } : {}), at })
const session = (id: string, locationId: string, at: number, exerciseId: string, sets: GymSet[]): GymSession => ({
  id,
  locationId,
  startedAt: at,
  endedAt: at + 3600_000,
  name: 'Upper body',
  exercises: [{ exerciseId, sets }],
})
const plan = { range: [6, 10] as [number, number], targetRpe: 8 }
const sets = (p: { items: { sets: number }[] }) => p.items.reduce((n, it) => n + it.sets, 0)

const FOCUSES: GymFocus[] = ['full', 'upper', 'lower', 'push', 'pull', 'athletic']
const MINUTES = [20, 25, 30, 35, 40, 45, 50, 60, 75]

describe('1. a lighter or harder day changes the sets, not only the words', () => {
  const build = (focus: GymFocus, minutes: number, volumeFactor: number, extra = {}) =>
    buildGymSession({ location: everything(), minutes, focus, sessions: [], volumeFactor, youth: false, now: NOW, ...extra })

  it('a 0.6 day has at most about 0.65 of a normal day’s working sets, at every length and focus', () => {
    let compared = 0
    for (const focus of FOCUSES) {
      for (const minutes of MINUTES) {
        const normal = build(focus, minutes, 1)
        const light = build(focus, minutes, 0.6)
        if (!normal.items.length) continue
        compared++
        expect(sets(light), `${focus} ${minutes}`).toBeLessThanOrEqual(Math.ceil(0.65 * sets(normal)))
        expect(light.estimatedMin, `${focus} ${minutes} minutes`).toBeLessThanOrEqual(normal.estimatedMin)
        expect(light.fits).toBe(true)
      }
    }
    expect(compared).toBeGreaterThan(30)
  })

  it('a light day takes sets off lifts before it drops lifts', () => {
    const normal = build('full', 60, 1)
    const light = build('full', 60, 0.6)
    expect(light.items.length).toBeGreaterThanOrEqual(Math.min(normal.items.length, Math.ceil(sets(normal) * 0.6)))
    expect(light.items.some((it) => it.sets === 1)).toBe(true)
  })

  it('a harder day (1.2) never has fewer sets than a normal one, and has more where the minutes allow', () => {
    let more = 0
    for (const focus of FOCUSES) {
      for (const minutes of MINUTES) {
        const normal = build(focus, minutes, 1)
        const hard = build(focus, minutes, 1.2)
        expect(sets(hard), `${focus} ${minutes}`).toBeGreaterThanOrEqual(sets(normal))
        expect(hard.estimatedMin, `${focus} ${minutes}`).toBeLessThanOrEqual(minutes)
        if (sets(hard) > sets(normal)) more++
      }
    }
    expect(more).toBeGreaterThan(10)
  })

  it('a harder upper day never has fewer sets than a normal one (a 75-minute one once had fewer)', () => {
    // Lifting is capped near an hour (2026-11-24), and a usual 60- or 75-minute day already fills it: a harder day
    // keeps every set, and adds where the hour still has room.
    expect(sets(build('upper', 75, 1.2))).toBeGreaterThanOrEqual(sets(build('upper', 75, 1)))
    expect(sets(build('upper', 60, 1.2))).toBeGreaterThanOrEqual(sets(build('upper', 60, 1)))
    expect(sets(build('upper', 40, 1.2))).toBeGreaterThan(sets(build('upper', 40, 1)))
  })

  it('the lifts keep the same picks whatever the factor', () => {
    expect(build('upper', 60, 1.2).items.map((i) => i.exerciseId).slice(0, 4)).toEqual(build('upper', 60, 1).items.map((i) => i.exerciseId).slice(0, 4))
  })

  it('warmUpMin replaces the warm-up in the minutes budget', () => {
    const usual = build('upper', 40, 1)
    const short = build('upper', 40, 1, { warmUpMin: 2 })
    expect(sets(short)).toBeGreaterThanOrEqual(sets(usual))
    // Four minutes more room is at least one more set or block somewhere.
    const tight = build('upper', 24, 1)
    const tightShort = build('upper', 24, 1, { warmUpMin: 2 })
    expect(sets(tightShort)).toBeGreaterThan(sets(tight))
  })
})

describe('2. time away', () => {
  const squat = (day: number, kg: number, reps: number[], rpe = 8) =>
    session(`s${day}`, 'a', T0 + day * DAY, 'back-squat', reps.map((r) => set(kg, r, rpe)))
  const at = (days: number, youth = false, reps = [10, 10, 10]) =>
    suggestLoad({ exerciseId: 'back-squat', location: gymA, sessions: [squat(0, 60, reps)], plan, youth, now: T0 + days * DAY })

  it('a recent session that earned a step still steps up', () => {
    const s = at(7)
    expect(s.kind).toBe('increase')
    expect(s.kg).toBe(62.5)
  })
  it('past 28 days it never steps up, at any age', () => {
    for (const youth of [false, true]) {
      const s = at(35, youth)
      expect(s.kind).toBe('repeat')
      expect(s.kg).toBe(60)
    }
  })
  it('steps down after six weeks and asks for a new starting weight once the 120-day load history expires', () => {
    for (const youth of [false, true]) {
      for (const days of [43, 120]) {
        const s = at(days, youth)
        expect(s.kind).toBe('decrease')
        expect(s.kg).toBe(57.5)
        expect(s.why).toContain('weeks')
      }
      for (const days of [121, 200]) {
        const s = at(days, youth)
        expect(s.kind).toBe('first-time')
        expect(s.kg).toBeUndefined()
      }
    }
  })
  it('the same applies to an unrated pair of sessions at the top', () => {
    const s = suggestLoad({
      exerciseId: 'back-squat',
      location: gymA,
      sessions: [session('a', 'a', T0, 'back-squat', [set(60, 10), set(60, 10)]), session('b', 'a', T0 + 3 * DAY, 'back-squat', [set(60, 10), set(60, 10)])],
      plan,
      now: T0 + 33 * DAY,
    })
    expect(s.kind).toBe('repeat')
  })
  it('an assisted lift away for six weeks gets help put back', () => {
    const s = suggestLoad({
      exerciseId: 'assisted-pull-up',
      location: { ...gymA, equipment: [...gymA.equipment, 'assisted-pullup'] },
      sessions: [session('a', 'a', T0, 'assisted-pull-up', [set(30, 10, 8), set(30, 10, 8)])],
      plan,
      now: T0 + 50 * DAY,
    })
    expect(s.kind).toBe('decrease')
    expect(s.kg).toBeGreaterThan(30)
  })
  it('the shared estimate keeps its own 120-day window', () => {
    const s = suggestLoad({
      exerciseId: 'back-squat',
      location: { ...gymA, id: 'b' },
      sessions: [squat(0, 60, [8, 8])],
      plan,
      now: T0 + 100 * DAY,
    })
    // Still inside the window — and the time away shows at the new place too (review 5).
    expect(s.kind).toBe('decrease')
    expect(s.why).toMatch(/weeks/)
    const past = suggestLoad({ exerciseId: 'back-squat', location: { ...gymA, id: 'b' }, sessions: [squat(0, 60, [8, 8])], plan, now: T0 + 130 * DAY })
    expect(past.kind).not.toBe('from-estimate')
    expect(past.kind).not.toBe('decrease')
  })
})

describe('3. long holds are kept', () => {
  const gym = (reps: number, exerciseId: string): GymState => ({
    locations: [gymA],
    sessions: [{ ...session('s', 'a', T0, exerciseId, [set(undefined, reps)]) }],
    ratings: {},
    favoriteAt: {},
  })
  it('a 240 second plank survives a reload; a count over an hour or 1000 reps does not', () => {
    expect(sanitizeGym(gym(240, 'plank'))!.sessions[0].exercises[0].sets[0].reps).toBe(240)
    expect(sanitizeGym(gym(3600, 'plank'))!.sessions).toHaveLength(1)
    expect(sanitizeGym(gym(3601, 'plank'))!.sessions[0].exercises[0].sets).toHaveLength(0)
    expect(sanitizeGym(gym(240, 'back-squat'))!.sessions[0].exercises[0].sets[0].reps).toBe(240)
    expect(sanitizeGym(gym(1001, 'back-squat'))!.sessions[0].exercises[0].sets).toHaveLength(0)
  })
  it('correcting a plank to 240 seconds is accepted, and a squat to 2000 is not', () => {
    const g = gym(30, 'plank')
    const fixed = reduceGym(g, { op: 'correctSet', sessionId: 's', exerciseIndex: 0, setIndex: 0, reps: 240 }, NOW)!
    expect(fixed.sessions[0].exercises[0].sets[0].reps).toBe(240)
    const sq = gym(5, 'back-squat')
    expect(reduceGym(sq, { op: 'correctSet', sessionId: 's', exerciseIndex: 0, setIndex: 0, reps: 2000 }, NOW)).toBe(sq)
    expect(reduceGym(sq, { op: 'correctSet', sessionId: 's', exerciseIndex: 0, setIndex: 0, reps: 240 }, NOW)!.sessions[0].exercises[0].sets[0].reps).toBe(240)
  })
})

describe('4. marking a movement hard here does not outvote an equipment edit on another tab', () => {
  const base: GymState = { locations: [{ ...gymA, updatedAt: 1000 }], sessions: [], ratings: {}, favoriteAt: {} }
  it('keeps the place’s own stamp when a mark is toggled', () => {
    const toggled = reduceGym(base, { op: 'toggleHardHere', locationId: 'a', exerciseId: 'back-squat' }, 5000)!
    expect(toggled.locations[0].updatedAt).toBe(1000)
    expect(toggled.locations[0].hardHere).toEqual(['back-squat'])
    expect(toggled.locations[0].hardHereAt!['back-squat']).toBe(5000)
  })
  it('merges a mark on one tab and an equipment edit on the other, in both orders', () => {
    const marked = reduceGym(base, { op: 'toggleHardHere', locationId: 'a', exerciseId: 'back-squat' }, 5000)!
    const edited = reduceGym(base, { op: 'saveLocation', location: { ...base.locations[0], equipment: [...base.locations[0].equipment, 'kettlebells'] } }, 3000)!
    for (const [x, y] of [[marked, edited], [edited, marked]]) {
      const loc = mergeGym(x, y)!.locations[0]
      expect(loc.equipment).toContain('kettlebells')
      expect(loc.hardHere).toEqual(['back-squat'])
    }
  })
})

describe('5. a swap or an addition keeps the day', () => {
  const home = everything()
  it('an addition on a light day gets fewer sets and a lower effort target', () => {
    const ex = GYM_EXERCISE_BY_ID['lateral-raise'] ?? GYM_EXERCISE_BY_ID['db-lateral-raise']
    const normal = draftItemFor(ex, home, [], false, setsForFactor(1), NOW, { factor: 1 })
    const light = draftItemFor(ex, home, [], false, setsForFactor(0.6), NOW, { factor: 0.6 })
    expect(normal.sets).toHaveLength(3)
    expect(light.sets).toHaveLength(2)
    expect(light.plan.targetRpe).toBe(normal.plan.targetRpe - 1)
  })
  it('an addition reads the goals: a strength-led athlete’s compound gets a strength range', () => {
    const goals = { strength: 5, power: 0, physique: 1, skills: 0, endurance: 0 }
    const ex = GYM_EXERCISE_BY_ID['back-squat']
    const item = draftItemFor(ex, home, [], false, 3, NOW, { goals })
    expect(item.plan.range).toEqual(repPlanFor(ex, 'strength', false).range)
    expect(draftItemFor(ex, home, [], false, 3, NOW).plan.range).toEqual(repPlanFor(ex, 'muscle', false).range)
  })
  it('a swap keeps the rep-range kind and the lowered effort of the block it replaces', () => {
    const old = draftItemFor(GYM_EXERCISE_BY_ID['back-squat'], home, [], false, 3, NOW, { emphasis: 'strength', factor: 0.6 })
    const carried = dayOfItem(old, false)
    expect(carried.emphasis).toBe('strength')
    expect(carried.rpeShift).toBe(-1)
    const swapped = draftItemFor(GYM_EXERCISE_BY_ID['front-squat'] ?? GYM_EXERCISE_BY_ID['leg-press'], home, [], false, 2, NOW, carried)
    expect(swapped.plan.range).toEqual(repPlanFor(GYM_EXERCISE_BY_ID['front-squat'] ?? GYM_EXERCISE_BY_ID['leg-press'], 'strength', false).range)
    expect(swapped.plan.targetRpe).toBe(7)
    expect(swapped.sets).toHaveLength(2)
  })
})

describe('6. the nearest load is not called the same weight', () => {
  const lbGym: GymLocation = { ...gymA, unit: 'lb' }
  it('says so when this place’s steps cannot make last time’s load', () => {
    const s = suggestLoad({
      exerciseId: 'back-squat',
      location: lbGym,
      sessions: [session('a', 'a', T0, 'back-squat', [{ ...set(60, 8, 8), unit: 'kg' }, { ...set(60, 8, 8), unit: 'kg' }])],
      plan,
      now: T0 + 3 * DAY,
    })
    expect(s.kind).toBe('repeat')
    expect(s.kg).not.toBe(60)
    expect(s.why).toContain('Nearest load here')
    expect(s.why).toContain('60 kg')
    expect(s.why).not.toContain('Same weight')
  })
  it('keeps "Same weight" when the load is reachable', () => {
    const s = suggestLoad({
      exerciseId: 'back-squat',
      location: gymA,
      sessions: [session('a', 'a', T0, 'back-squat', [set(60, 8, 8), set(60, 8, 8)])],
      plan,
      now: T0 + 3 * DAY,
    })
    expect(s.kg).toBe(60)
    expect(s.why).toContain('Same weight')
  })
})

describe('7. an assisted lift getting easier is not a step up', () => {
  const state = (exerciseId: string, a: number, b: number) => ({
    sessions: [],
    gym: {
      locations: [gymA],
      ratings: {},
      favoriteAt: {},
      sessions: [session('1', 'a', T0, exerciseId, [set(a, 8)]), session('2', 'a', T0 + 3 * DAY, exerciseId, [set(b, 8)])],
    },
  })
  it('less help earns no badge; a heavier load does', () => {
    const earned = (s: ReturnType<typeof state>) => gymBadges(s as never).filter((b) => b.at !== undefined && /step/i.test(`${b.id} ${b.name}`))
    expect(earned(state('assisted-pull-up', 20, 30))).toHaveLength(0)
    expect(earned(state('back-squat', 60, 70))).toHaveLength(1)
  })
})
