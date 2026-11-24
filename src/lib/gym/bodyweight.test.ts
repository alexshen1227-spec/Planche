import { expect, it } from 'vitest'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { initialState } from '../store'
import { canDoHere } from './availability'
import { bodyweightCapacity, readyForBodyweight } from './bodyweight'
import { buildGymSession } from './builder'
import { allowsUnloaded } from './progression'
import { defaultGym, homeLocation } from './state'

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
