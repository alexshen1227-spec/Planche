import { describe, expect, it } from 'vitest'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { repPlanFor, suggestLoad, youthCeiling } from './progression'
import { fromKg, stepKgFor, toKg } from './units'

const DAY = 86_400_000
const NOW = new Date(2026, 10, 22, 17).getTime()
const lbGym: any = { id: 'lb', name: 'Gym L', unit: 'lb', equipment: ['dumbbells', 'bench'], updatedAt: 1 }
const done = (kg: number, ago = 3) => ({
  id: 's' + ago,
  locationId: 'lb',
  startedAt: NOW - ago * DAY,
  endedAt: NOW - ago * DAY + 3_600_000,
  name: 'Push',
  exercises: [{ exerciseId: 'db-bench-press', sets: [1, 2, 3].map(() => ({ kg, reps: 10, rpe: 7.5, at: NOW - ago * DAY })) }],
})
const plan = (youth: boolean) => repPlanFor(GYM_EXERCISE_BY_ID['db-bench-press'], 'muscle', youth)
const ask = (youth: boolean, kg: number) =>
  suggestLoad({ exerciseId: 'db-bench-press', location: lbGym, sessions: [done(kg, 3), done(kg, 6)] as any, plan: plan(youth), youth, now: NOW })

describe('under 18: one step of the unit in use, from the load that was lifted', () => {
  const step = stepKgFor(GYM_EXERCISE_BY_ID['db-bench-press'], lbGym)

  it('20 kg after a switch to lb goes up by no more than one step (it was 2.68 kg against 2.27)', () => {
    const s = ask(true, 20)
    // The only grid load within one step is 45 lb, +0.41 kg: that is the nearest load, not a step up (gym9 pins it).
    expect(s.kind).toBe('repeat')
    expect(s.nearestTo).toBe(20)
    expect(s.kg!).toBeGreaterThan(20)
    expect(s.kg! - 20).toBeLessThanOrEqual(step + 1e-9)
    // It lands on a dumbbell this place has: a multiple of 5 lb.
    expect(fromKg(s.kg!, 'lb') % 5).toBeCloseTo(0, 6)
  })

  it('holds across a sweep of last loads', () => {
    for (let kg = 5; kg <= 60; kg += 0.5) {
      const s = ask(true, kg)
      if (s.kind === 'increase') expect(s.kg! - kg).toBeLessThanOrEqual(step + 1e-9)
    }
  })

  it('an adult is not held to it', () => {
    const adult = ask(false, 20)
    expect(adult.kg!).toBeGreaterThan(20)
  })

  it('the ceiling is the heaviest grid load within one step of the last', () => {
    expect(fromKg(youthCeiling(20, step), 'lb')).toBeCloseTo(45, 6)
    expect(youthCeiling(toKg(45, 'lb'), step)).toBeCloseTo(toKg(50, 'lb'), 6)
  })
})
