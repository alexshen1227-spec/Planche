import { expect, it } from 'vitest'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { initialState } from '../store'
import { canDoHere } from './availability'
import { bodyweightCapacity, readyForBodyweight } from './bodyweight'
import { buildGymSession } from './builder'
import { allowsUnloaded } from './progression'
import { defaultGym, homeLocation } from './state'
import type { GymSession } from './types'

it('advances the introductory dose from manageable working sets and limits the first increase', () => {
  const now = Date.now()
  const state = initialState()
  state.profile.birthYear = new Date(now).getFullYear() - 65
  const gym = defaultGym(['floor'], 'kg', now)
  const visits = (tolerated: boolean): GymSession[] => [3, 1].map((days) => {
    const at = now - days * 86_400_000
    return { id: String(days), locationId: 'home', startedAt: at, endedAt: at + 300_000, name: 'Lifting', completion: 'partial',
      exercises: (tolerated ? ['bodyweight-squat', 'kneeling-push-up'] : ['goblet-squat']).map((exerciseId) => ({
        exerciseId, sets: tolerated ? [{ at, reps: 8, rpe: 7 }, { at: at + 30_000, reps: 8, rpe: 7 }] : [{ at, kg: 8, reps: 2, rpe: 10 }],
      })) }
  })
  const plan = (tolerated: boolean) => {
    const sessions = visits(tolerated)
    const capacity = bodyweightCapacity({ ...state, gym: { ...gym, sessions } }, now)
    return buildGymSession({ location: gym.locations[0], capacity, focus: 'full', minutes: 60, sessions, now })
  }
  const early = plan(false)
  expect(early.items.every((i) => i.sets <= 2 && i.plan.targetRpe <= 7)).toBe(true)
  const next = plan(true)
  expect(next.items.reduce((n, item) => n + item.sets, 0)).toBeLessThanOrEqual(6)
  expect(next.items.every((i) => i.plan.targetRpe <= 7)).toBe(true)
})

it('offers a plain pull-up after confirmed no-help sets on the machine, and keeps unknown or positive assistance on its own progression', () => {
  const now = Date.now()
  const state = initialState()
  const gym = defaultGym(['pullup-bar'], 'kg', now)
  const location = { ...gym.locations[0], equipment: [...gym.locations[0].equipment, 'assisted-pullup' as const] }
  const ex = GYM_EXERCISE_BY_ID['assisted-pull-up']
  for (const help of [undefined, 15, 0]) {
    const at = now - 3 * 86_400_000
    gym.sessions = [{ id: 'machine', startedAt: at, endedAt: at + 1000, locationId: location.id, name: 'Pull',
      exercises: [{ exerciseId: ex.id, repRange: [6, 10], sets: [0, 1, 2].map((j) => ({ reps: 10, rpe: 7, kg: help, at: at + j })) }] }]
    const capacity = bodyweightCapacity({ ...state, gym }, now)
    expect(readyForBodyweight('pull-up', capacity)).toBe(help === 0)
    expect(readyForBodyweight('weighted-pull-up', capacity)).toBe(false)
    const next = buildGymSession({ location, capacity, sessions: gym.sessions, focus: 'pull', minutes: 55, now })
    expect(next.items[0].exerciseId).toBe(help === 0 ? 'pull-up' : ex.id)
    if (help === 0) expect(next.items[0].suggestion.why).toMatch(/zero assistance/)
    if (help === undefined) expect(next.items[0].suggestion.kind).toBe('first-time')
  }
})

it('builds attainable presses and pulls from placement, and responds to later work', () => {
  const now = new Date(2026, 10, 16).getTime()
  const state = initialState()
  state.assessment = { at: now - 1000, answers: { pushups: 3, pullups: 0 }, confidence: 'moderate', placedStepId: 'foundations', gapIds: [] }
  const capacity = bodyweightCapacity(state, now)
  const location = homeLocation(['floor', 'band', 'pullup-bar'], 'kg')
  const plan = (focus: 'upper' | 'pull') => buildGymSession({ location, capacity, focus, minutes: 45, sessions: [], now }).items.map((x) => x.exerciseId)
  expect(plan('upper')).toContain('kneeling-push-up')
  expect(plan('upper')).not.toContain('diamond-push-up')
  expect(plan('pull')).toContain('band-assisted-pull-up')
  expect(plan('pull')).not.toContain('pull-up')
  const bandOnly = { ...location, equipment: ['band'] as typeof location.equipment }
  expect(canDoHere('assisted-pull-up', bandOnly)).toBe(false)
  expect(canDoHere('band-assisted-pull-up', bandOnly)).toBe(false)
  expect(canDoHere('inverted-row', { ...location, equipment: ['pullup-bar'] })).toBe(false)
  expect(allowsUnloaded(GYM_EXERCISE_BY_ID['walking-lunge'])).toBe(true)
  state.gym = { ...defaultGym([], 'kg'), locations: [location], sessions: [
    { id: 'test', name: 'Push', locationId: location.id, startedAt: now, endedAt: now,
      exercises: [{ exerciseId: 'push-up', sets: [{ reps: 10, rpe: 8, at: now }] }] },
  ] }
  expect(readyForBodyweight('diamond-push-up', bodyweightCapacity(state, now))).toBe(true)
})

it('gives a new athlete a loggable introductory workout with only the kit they have', () => {
  const now = Date.now()
  const state = initialState()
  const capacity = bodyweightCapacity(state, now)
  const floor = homeLocation(['floor'], 'kg')
  const lower = buildGymSession({ location: floor, capacity, focus: 'lower', minutes: 45, sessions: [], now })
  expect(lower.items.length).toBeGreaterThanOrEqual(2)
  expect(lower.items.length).toBeLessThanOrEqual(4)
  expect(lower.items.every((i) => i.sets <= 2 && i.plan.targetRpe <= 7)).toBe(true)
  expect(lower.items.every((i) => !GYM_EXERCISE_BY_ID[i.exerciseId].technical)).toBe(true)
  for (const id of ['slider-leg-curl', 'nordic-curl', 'chest-supported-row']) expect(canDoHere(id, floor)).toBe(false)
  for (const id of ['decline-push-up', 'elevated-pike-push-up', 'wall-hspu']) expect(readyForBodyweight(id, capacity)).toBe(false)
  const band = homeLocation(['floor', 'band'], 'kg')
  const pull = buildGymSession({ location: band, capacity, focus: 'pull', minutes: 30, sessions: [], now })
  expect(pull.items.some((i) => i.exerciseId === 'band-seated-row')).toBe(true)
  expect(pull.items.every((i) => allowsUnloaded(GYM_EXERCISE_BY_ID[i.exerciseId]))).toBe(true)
})
