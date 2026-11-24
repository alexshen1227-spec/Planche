// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { GYM_EQUIPMENT_BY_ID } from '../../data/gym/catalog'
import { draftItemFor } from '../../components/gym/GymPlayer'
import { alternativesFor, availableAt } from './availability'
import { buildGymSession, type GymFocus } from './builder'
import { estimateOneRepMax, gymRecords, repPlanFor, sharedEstimate, suggestLoad } from './progression'
import type { GymLocation, GymSession, GymSet } from './types'

/** Decisions the third independent review found wrong, each pinned by the number or the pick, not the sentence. */

const T0 = Date.UTC(2026, 10, 2, 17)
const DAY = 86_400_000
const NOW = T0 + 100 * DAY
const SOON = T0 + 10 * DAY // a few days after the sessions these tests build

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
  gear: { dumbbells: { maxKg: 30 } },
  updatedAt: T0,
}
const gymB: GymLocation = { ...gymA, id: 'b', name: 'Gym B' }
const home: GymLocation = { id: 'home', name: 'Home', unit: 'kg', equipment: ['parallettes', 'pullup-bar'], updatedAt: T0 }

const set = (kg: number | undefined, reps: number, rpe?: number, at = T0): GymSet => ({ ...(kg ? { kg } : {}), reps, ...(rpe ? { rpe } : {}), at })
const session = (id: string, locationId: string, at: number, exerciseId: string, sets: GymSet[], name = 'Upper body'): GymSession => ({
  id,
  locationId,
  startedAt: at,
  endedAt: at + 3600_000,
  name,
  exercises: [{ exerciseId, sets }],
})

describe('the speed and power ladder is climbed from the bottom', () => {
  const logged = (id: string, n: number, exerciseId: string, start = 0) =>
    Array.from({ length: n }, (_, i) => {
      const at = T0 + (start + i) * DAY
      const dose = GYM_EXERCISE_BY_ID[exerciseId].dose!
      const work = Array.from({ length: dose.sets }, (_, j) => set(undefined, dose.range[0], dose.rpe, at + j * 60_000))
      return session(`${id}${i}`, 'all', at, exerciseId, work, 'Speed & power')
    })
  // A young athlete with the medium tier behind them: the high tier is open.
  const unlocked = [...logged('l', 2, 'landing-stick'), ...logged('m', 2, 'jump-squat', 2)]
  const jumpOf = (sessions: GymSession[]) =>
    buildGymSession({ location: everything(), minutes: 60, focus: 'athletic', sessions, youth: true, now: SOON })
      .items.map((i) => i.exerciseId)
      .find((id) => GYM_EXERCISE_BY_ID[id].pattern === 'jump')

  it('gives the depth drop before the depth jump, then the next rung, never the top first', () => {
    expect(GYM_EXERCISE_BY_ID['depth-drop'].tier).toBe('high')
    expect(jumpOf(unlocked)).toBe('depth-drop')
    const afterDrop = [...unlocked, ...logged('d', 1, 'depth-drop', 5)]
    expect(['bounding', 'single-leg-hop']).toContain(jumpOf(afterDrop))
    const afterHops = [...afterDrop, ...logged('b', 1, 'bounding', 6), ...logged('s', 1, 'single-leg-hop', 7)]
    expect(jumpOf(afterHops)).toBe('depth-jump')
  })
  it('once every rung has been done, the one done longest ago comes round again', () => {
    const all = [
      ...unlocked,
      ...logged('d', 1, 'depth-drop', 5),
      ...logged('b', 1, 'bounding', 6),
      ...logged('s', 1, 'single-leg-hop', 7),
      ...logged('j', 1, 'depth-jump', 8),
    ]
    expect(jumpOf(all)).toBe('depth-drop')
  })
})

describe('the working load is where the working sets were done', () => {
  const plan = repPlanFor(GYM_EXERCISE_BY_ID['back-squat'], 'muscle', true)
  it('a heavier top set before back-off sets does not become everyone’s load', () => {
    const s = [session('s1', 'a', T0, 'back-squat', [set(60, 3, 9), set(55, 10, 7.5), set(55, 10, 7.5), set(55, 10, 7.5)])]
    const next = suggestLoad({ exerciseId: 'back-squat', location: gymA, sessions: s, plan, youth: true, now: SOON })
    // Three sets at 55 reached the top of the range at the target effort: one step up from 55, never from 60.
    expect(next.kg).toBe(57.5)
    expect(next.kind).toBe('increase')
  })
  it('an adult gets at most the same single step from the working load', () => {
    const adult = repPlanFor(GYM_EXERCISE_BY_ID['back-squat'], 'muscle', false)
    const s = [session('s1', 'a', T0, 'back-squat', [set(60, 3, 9), set(55, 10, 8), set(55, 10, 8), set(55, 10, 8)])]
    expect(suggestLoad({ exerciseId: 'back-squat', location: gymA, sessions: s, plan: adult, now: SOON }).kg).toBe(57.5)
  })
})

describe('failed sets with no effort logged lighten the load', () => {
  const plan = repPlanFor(GYM_EXERCISE_BY_ID['back-squat'], 'muscle', false)
  const next = (sets: GymSet[]) => suggestLoad({ exerciseId: 'back-squat', location: gymA, sessions: [session('s', 'a', T0, 'back-squat', sets)], plan, now: SOON })
  it('4, 4, 3 reps on a 6–10 range steps down once', () => {
    expect(next([set(60, 4), set(60, 4), set(60, 3)]).kg).toBe(57.5)
    expect(next([set(60, 4), set(60, 4), set(60, 3)]).kind).toBe('decrease')
  })
  it('one short set of three is a bad set, not a verdict; a logged effort is read as before', () => {
    expect(next([set(60, 8), set(60, 8), set(60, 4)]).kg).toBe(60)
    expect(next([set(60, 4, 8), set(60, 4, 8), set(60, 3, 8)]).kg).toBe(60)
  })
})

describe('sessions fit the minutes they are given', () => {
  const places = [everything(), gymA, home, { ...gymA, id: 'z', hardHere: ['back-squat', 'bench-press'] }, { id: 'bare', name: 'Bare', unit: 'kg', equipment: [], updatedAt: T0 } as GymLocation]
  const foci: GymFocus[] = ['full', 'upper', 'lower', 'push', 'pull', 'athletic']
  const minutesList = [5, 7, 10, 15, 20, 25, 30, 45, 60, 90]
  const spent = (plan: ReturnType<typeof buildGymSession>, minutes: number) =>
    plan.items.reduce((m, it) => {
      const ex = GYM_EXERCISE_BY_ID[it.exerciseId]
      return m + (it.sets * ((ex.dose?.workSec ?? 40) + it.restSec)) / 60
    }, plan.focus === 'athletic' ? 2 : 6) - (minutes >= 15 && minutes < 20 ? (plan.items.at(-1)?.restSec ?? 0) / 60 : 0)
  it('never builds more than the minutes asked, across places, lengths, foci and athletes', () => {
    let built = 0
    for (const location of places)
      for (const minutes of minutesList)
        for (const focus of foci)
          for (const youth of [false, true])
            for (const volumeFactor of [1, 0.7]) {
              const plan = buildGymSession({
                location,
                minutes,
                focus,
                sessions: [],
                youth,
                volumeFactor,
                goals: { strength: 3, physique: 2, endurance: 1, power: 3 } as never,
                now: NOW,
              })
              if (!plan.items.length) continue
              built++
              expect(spent(plan, minutes), `${location.id} ${minutes} ${focus}`).toBeLessThanOrEqual(minutes + 1e-9)
              expect(plan.estimatedMin).toBeLessThanOrEqual(minutes)
              expect(plan.fits).toBe(true)
            }
    expect(built).toBeGreaterThan(300)
  })
  it('15 minutes at a full gym is a short session, not nineteen', () => {
    const plan = buildGymSession({ location: everything(), minutes: 15, focus: 'full', sessions: [], now: NOW })
    expect(plan.items.length).toBeGreaterThanOrEqual(1)
    expect(plan.estimatedMin).toBeLessThanOrEqual(15)
    expect(plan.dropped.length).toBeGreaterThan(0)
  })
  it('says so when not even one block fits, and builds nothing', () => {
    const plan = buildGymSession({ location: everything(), minutes: 7, focus: 'upper', sessions: [], now: NOW })
    expect(plan.items).toHaveLength(0)
    expect(plan.fits).toBe(false)
    expect(plan.dropped.length).toBeGreaterThan(0)
  })
})

describe('the shared strength estimate survives a swap or an addition', () => {
  const elsewhere = [session('s', 'a', T0, 'back-squat', [set(100, 5, 8), set(100, 5, 8)])]
  const plan = repPlanFor(GYM_EXERCISE_BY_ID['back-squat'], 'muscle', false)
  it('suggestLoad without a clock still carries the estimate to a new place', () => {
    const s = suggestLoad({ exerciseId: 'back-squat', location: gymB, sessions: elsewhere, plan })
    expect(s.kind).toBe('from-estimate')
    expect(s.kg).toBeGreaterThan(0)
  })
  it('with a clock the 120-day window still applies', () => {
    expect(sharedEstimate(elsewhere, 'back-squat', T0 + 200 * DAY)).toBeNull()
    expect(sharedEstimate(elsewhere, 'back-squat', Infinity)).not.toBeNull()
  })
  it('a swapped-in movement in the player starts from the estimate, not from nothing', () => {
    const item = draftItemFor(GYM_EXERCISE_BY_ID['back-squat'], gymB, elsewhere, false, 3, T0 + 10 * DAY)
    expect(item.suggestion?.kind).toBe('from-estimate')
    expect(item.sets[0].load).toBeGreaterThan(0)
    const late = draftItemFor(GYM_EXERCISE_BY_ID['back-squat'], gymB, elsewhere, false, 3, T0 + 200 * DAY)
    expect(late.suggestion?.kind).toBe('first-time')
  })
})

describe('swap lists for a young athlete', () => {
  const athlete = { youth: true, sessions: [] as GymSession[], now: NOW }
  it('puts lifts that need coaching after everything else, unless they are a favourite', () => {
    const ids = (r: Record<string, 'love'> = {}) => alternativesFor('goblet-squat', everything(), r, [], athlete).map((e) => e.id)
    const technical = (id: string) => Boolean(GYM_EXERCISE_BY_ID[id].technical)
    const list = ids()
    const firstTech = list.findIndex(technical)
    expect(firstTech).toBeGreaterThan(0)
    expect(list.slice(firstTech).every(technical)).toBe(true)
    // A loved one keeps its place in the order.
    const loved = list.find(technical)!
    const withLove = ids({ [loved]: 'love' })
    expect(withLove.indexOf(loved)).toBeLessThan(withLove.findIndex((id, i) => i > withLove.indexOf(loved) && technical(id) && id !== loved) || Infinity)
    expect(withLove.indexOf(loved)).toBeLessThan(firstTech)
    // An adult has no such penalty.
    const adult = alternativesFor('goblet-squat', everything(), {}, [], { ...athlete, youth: false }).map((e) => e.id)
    expect(adult).not.toEqual(list)
  })
  it('swaps an explosive movement for explosive movements only', () => {
    const alts = alternativesFor('box-jump', everything(), {}, [], athlete)
    expect(alts.length).toBeGreaterThan(0)
    for (const a of alts) expect(a.explosive, a.id).toBe(true)
    expect(alternativesFor('box-jump', everything()).map((a) => a.id)).not.toContain('back-squat')
  })
})

describe('a place a movement is liked at', () => {
  it('wins that movement its slot there, and only there', () => {
    const base = { minutes: 60, focus: 'full' as const, sessions: [], now: NOW }
    const first = (location: GymLocation, favoriteAt?: Record<string, string>) =>
      buildGymSession({ ...base, location, favoriteAt }).items[0].exerciseId
    const usual = first(gymA)
    const other = availableAt(gymA).find((e) => e.pattern === 'squat' && e.compound && !e.explosive && !e.technical && e.id !== usual)!
    expect(other).toBeDefined()
    expect(first(gymA, { [other.id]: 'a' })).toBe(other.id)
    expect(first(gymA, { [other.id]: 'somewhere-else' })).toBe(usual)
  })
  it('never outranks an avoided movement', () => {
    const usual = buildGymSession({ location: gymA, minutes: 60, focus: 'full', sessions: [], now: NOW }).items[0].exerciseId
    const plan = buildGymSession({ location: gymA, minutes: 60, focus: 'full', sessions: [], ratings: { [usual]: 'avoid' }, favoriteAt: { [usual]: 'a' }, now: NOW })
    expect(plan.items.map((i) => i.exerciseId)).not.toContain(usual)
  })
})

describe('a repeat is a load this place can make', () => {
  it('rounds 22.5 kg to the two-kilo dumbbell steps here', () => {
    const plan = repPlanFor(GYM_EXERCISE_BY_ID['db-bench-press'], 'muscle', false)
    const s = [session('s', 'a', T0, 'db-bench-press', [set(22.5, 8, 8), set(22.5, 8, 8), set(22.5, 7, 8.5)])]
    const next = suggestLoad({ exerciseId: 'db-bench-press', location: gymA, sessions: s, plan, now: SOON })
    expect(next.kind).toBe('repeat')
    expect(next.kg! % 2).toBe(0)
    expect(next.kg).toBe(22)
  })
  it('never past the heaviest dumbbell', () => {
    const plan = repPlanFor(GYM_EXERCISE_BY_ID['db-bench-press'], 'muscle', false)
    const s = [session('s', 'a', T0, 'db-bench-press', [set(40, 8, 8), set(40, 8, 8)])]
    expect(suggestLoad({ exerciseId: 'db-bench-press', location: gymA, sessions: s, plan, now: SOON }).kg).toBeLessThanOrEqual(30)
  })
})

describe('weighted bodyweight work has no estimated max', () => {
  it('refuses an estimate when only the added load is known, but keeps the records that are true', () => {
    expect(estimateOneRepMax({ kg: 10, reps: 5 }, 'pull-up')).toBeNull()
    expect(estimateOneRepMax({ kg: 10, reps: 5 }, 'dip')).toBeNull()
    expect(estimateOneRepMax({ kg: 60, reps: 5 }, 'back-squat')).not.toBeNull()
    const rec = gymRecords([session('s', 'a', T0, 'pull-up', [set(10, 5), set(5, 9)])])['pull-up']
    expect(rec.bestE1rm).toBeUndefined()
    expect(rec.heaviest?.kg).toBe(10)
    expect(rec.mostReps?.reps).toBe(9)
  })
})
