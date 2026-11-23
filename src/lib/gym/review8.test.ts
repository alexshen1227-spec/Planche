import { describe, expect, it } from 'vitest'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { draftItemFor } from '../../components/gym/GymPlayer'
import { addedSetReps, prefillReps } from './draft'
import { repPlanFor, stepDownKg, suggestLoad, YOUTH_LARGE_STEP_SHARE } from './progression'
import type { GymLocation, GymSession } from './types'

// Review round eight: a held-back lift shows its real bar, a unit switch never turns one step down into two,
// and a large relative step is earned with reps first by an athlete under 18.

const DAY = 86_400_000
const NOW = new Date(2026, 10, 2, 17).getTime()
const at = (i: number) => NOW - 300 * DAY + i * 3.5 * DAY
const equipment = ['dumbbells', 'leg-curl', 'leg-extension', 'calf-machine', 'cable'] as GymLocation['equipment']
const KG: GymLocation = { id: 'gym', name: 'Gym', unit: 'kg', updatedAt: 1, equipment }
const LB: GymLocation = { ...KG, unit: 'lb' }
const leg = 'leg-curl'
const ex = GYM_EXERCISE_BY_ID[leg]
const plan = repPlanFor(ex)

const session = (id: string, i: number, exerciseId: string, kg: number, reps: number, rpe: number | undefined, n = 3): GymSession =>
  ({
    id,
    locationId: 'gym',
    startedAt: at(i),
    endedAt: at(i) + 3_600_000,
    name: 'x',
    completion: 'full',
    exercises: [{ exerciseId, repRange: [10, 15], targetRpe: 8, sets: Array.from({ length: n }, () => ({ kg, reps, ...(rpe !== undefined ? { rpe } : {}) })) }],
  }) as unknown as GymSession
const suggest = (sessions: GymSession[], i: number, location = KG, youth = true, exerciseId = leg) =>
  suggestLoad({ exerciseId, location, sessions, plan: repPlanFor(GYM_EXERCISE_BY_ID[exerciseId]), youth, now: at(i) })

describe('1. a held-back lift shows the bar it has to clear', () => {
  const failed = [session('a', 0, leg, 20, 7, 10), session('b', 1, leg, 15, 15, 8)]

  it('the suggestion carries the reps to move up, and the player starts there', () => {
    const s = suggest(failed, 2, KG, false)
    expect(s.kind).toBe('repeat')
    expect(s.kg).toBe(15)
    expect(s.repsToMoveUp).toBe(17)
    expect(prefillReps(plan, s, 15)).toBe(17)
    const item = draftItemFor(ex, KG, failed, false, 3, at(2))
    expect(item.suggestion?.repsToMoveUp).toBe(17)
    expect(item.sets.map((x) => x.reps)).toEqual([17, 17, 17])
  })

  it('a set added to the block starts at the bar when there is no set before it', () => {
    const s = suggest(failed, 2, KG, false)
    expect(addedSetReps(undefined, plan, s)).toBe(17)
    expect(addedSetReps(16, plan, s)).toBe(16)
    expect(addedSetReps(undefined, plan, undefined)).toBe(plan.range[1])
  })

  it('the bar rises with each failed step', () => {
    const two = [session('a', 0, leg, 20, 7, 10), session('b', 1, leg, 15, 15, 8), session('c', 2, leg, 20, 6, 10), session('d', 3, leg, 15, 15, 8)]
    expect(suggest(two, 4, KG, false).repsToMoveUp).toBe(19)
  })

  it('a lift that is not held back keeps the range prefill and no bar', () => {
    const s = suggest([session('a', 0, leg, 15, 15, 8)], 1, KG, false)
    expect(s.kind).toBe('increase')
    expect(s.repsToMoveUp).toBeUndefined()
    expect(prefillReps(plan, s, 15)).toBe(plan.range[0])
  })
})

describe('2. a unit switch never turns one step down into two', () => {
  const grind = [session('a', 0, leg, 20, 7, 10)]
  it('in kg the step down is 15', () => {
    expect(suggest(grind, 1, KG).kg).toBe(15)
  })
  it('in lb it is never more than one step of the lb grid below the load that was lifted, and still lighter', () => {
    const s = suggest(grind, 1, LB)
    expect(s.kind).toBe('decrease')
    const stepKg = 10 * 0.45359237
    expect(s.kg!).toBeLessThan(20)
    expect(s.kg!).toBeGreaterThanOrEqual(20 - stepKg - 0.01)
    expect(Math.abs(s.kg! / stepKg - Math.round(s.kg! / stepKg))).toBeLessThan(0.01)
  })
  it('the step down helper stays on the grid and within one step', () => {
    for (const kg of [20, 20.4, 18.9, 33.3, 7]) {
      const d = stepDownKg(kg, 4.536)
      expect(d).toBeLessThan(kg)
      expect(d).toBeGreaterThanOrEqual(Math.max(0, kg - 4.536) - 1e-6)
    }
  })
  it('a long absence steps down by the same rule', () => {
    const old = [session('a', 0, leg, 20, 12, 8)]
    const s = suggestLoad({ exerciseId: leg, location: LB, sessions: old, plan, youth: false, now: at(0) + 60 * DAY })
    expect(s.kind).toBe('decrease')
    expect(s.kg!).toBeGreaterThanOrEqual(20 - 4.54 - 0.01)
  })
})

describe('3. a large relative step is earned with reps first under 18', () => {
  const top = [session('a', 0, leg, 15, 15, 8)]
  it('leg curl 15 -> 20 kg (a third) is held until every set reaches two reps past the range', () => {
    const s = suggest(top, 1, KG, true)
    expect(s.kg).toBe(15)
    expect(s.kind).toBe('repeat')
    expect(s.repsToMoveUp).toBe(17)
    expect(s.why).toContain('quarter')
  })
  it('the step comes once every set reaches the bar', () => {
    const s = suggest([session('a', 0, leg, 15, 17, 8)], 1, KG, true)
    expect(s.kg).toBe(20)
    expect(s.kind).toBe('increase')
  })
  it('or once the same load reaches the top of the range at the target effort twice running', () => {
    const twice = [session('a', 0, leg, 15, 15, 8), session('b', 1, leg, 15, 15, 8)]
    expect(suggest(twice, 2, KG, true).kg).toBe(20)
    const hard = [session('a', 0, leg, 15, 15, 8), session('b', 1, leg, 15, 15, 9.5)]
    expect(suggest(hard, 2, KG, true).kg).toBe(15)
    const middling = [session('a', 0, leg, 15, 12, 8), session('b', 1, leg, 15, 15, 8)]
    expect(suggest(middling, 2, KG, true).kg).toBe(15)
  })
  it('one set short of the bar still holds', () => {
    const mixed = session('a', 0, leg, 15, 17, 8)
    mixed.exercises[0].sets[2] = { ...mixed.exercises[0].sets[2], reps: 16 }
    expect(suggest([mixed], 1, KG, true).kg).toBe(15)
  })
  it('a step of exactly a quarter (10 -> 12.5 kg) is not held', () => {
    expect(YOUTH_LARGE_STEP_SHARE).toBe(0.25)
    const lat = 'db-lateral-raise'
    const s = suggestLoad({ exerciseId: lat, location: { ...KG, gear: { dumbbells: { unit: 'kg', stepKg: 2.5 } } } as GymLocation, sessions: [session('a', 0, lat, 10, 15, 8)], plan: repPlanFor(GYM_EXERCISE_BY_ID[lat]), youth: true, now: at(1) })
    expect(s.kg).toBe(12.5)
  })
  it('adults keep today’s behaviour', () => {
    const s = suggest(top, 1, KG, false)
    expect(s.kg).toBe(20)
    expect(s.kind).toBe('increase')
  })
})
