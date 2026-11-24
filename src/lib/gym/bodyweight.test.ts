import { expect, it } from 'vitest'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { initialState } from '../store'
import { canDoHere } from './availability'
import { bodyweightCapacity, readyForBodyweight } from './bodyweight'
import { buildGymSession } from './builder'
import { legPracticeAt, unassistedDose, unassistedSteps } from './bodyweightSteps'
import { allowsUnloaded } from './progression'
import { nextTimeLines } from './sessionLines'
import { defaultGym, homeLocation } from './state'
import type { GymSession } from './types'

it('offers an available unilateral leg trial, keeps the earned base dose and learns from the weaker-side result', () => {
  const now = +new Date(2026, 7, 11, 10)
  const day = 86_400_000
  const home = homeLocation(['floor', 'band', 'box'], 'kg', now)
  const base = ['bodyweight-squat', 'glute-bridge', 'floor-calf-raise']
  const at = now - 7 * day
  const easy: GymSession = { id: 'easy', locationId: home.id, startedAt: at, endedAt: at + 1000, name: 'Legs',
    exercises: base.map((exerciseId) => ({ exerciseId, repRange: [8, 15], plannedWorkingSets: 2, targetRpe: 7,
      sets: [{ at, reps: 25, rpe: 6 }, { at: at + 500, reps: 25, rpe: 6 }] })) }
  const input = { location: home, minutes: 45, focus: 'lower' as const, now, sessions: [easy] }
  const slots = buildGymSession(input).items.filter((it) => it.suggestion.variationTrial)
  expect(slots.map((it) => it.exerciseId).sort()).toEqual([...base].sort())
  for (const it of slots) {
    expect(it.suggestion.targetReps).toBe(25)
    expect(canDoHere(it.suggestion.variationTrial!.id, home)).toBe(true)
  }
  const trial = slots.find((it) => it.exerciseId === 'glute-bridge')!.suggestion.variationTrial!
  const athlete = initialState()
  athlete.gym = { ...defaultGym(['floor', 'band', 'box'], 'kg', at), locations: [home], sessions: [easy] }
  const finish = nextTimeLines(easy, [], home, false, easy.endedAt + 1000, { state: athlete }).find((line) => line.exerciseId === 'glute-bridge')!
  expect(finish.text).toContain('25 reps')
  expect(finish.why).toBe(slots.find((it) => it.exerciseId === 'glute-bridge')!.suggestion.why)
  const played = now - day
  const visit: GymSession = { ...easy, id: 'trial', startedAt: played, endedAt: played + 1000,
    exercises: [{ exerciseId: trial.id, swappedFrom: 'glute-bridge', plannedWorkingSets: 1, sets: [{ reps: 6, rpe: 7, at: played }] }] }
  const next = buildGymSession({ ...input, sessions: [easy, visit] }).items.find((it) => it.exerciseId === trial.id)
  expect(next).toMatchObject({ sets: 2, plan: { range: [3, 3] }, practice: { easierId: 'glute-bridge' } })
  expect(buildGymSession({ ...input, volumeFactor: 0.6 }).items.some((it) => it.suggestion.variationTrial)).toBe(false)
  expect(legPracticeAt([easy], 'somewhere-else', now).size).toBe(0)
  expect(legPracticeAt([{ ...easy, exercises: easy.exercises.map((e) => ({ ...e, plannedWorkingSets: 3 })) }], home.id, now).get('glute-bridge')?.baseReps).toBeUndefined()
})

it('uses a repeatable high-rep performance in the next prescription and previews the earned optional floor trial', () => {
  const now = +new Date(2026, 10, 9, 13)
  const at = now - 3 * 86_400_000
  const state = initialState()
  state.profile.birthYear = 1995
  const gym = defaultGym(['floor', 'wall'], 'kg', at)
  const home = gym.locations[0]
  const workout: GymSession = { id: 'home', name: 'Upper body', locationId: home.id, startedAt: at, endedAt: at + 120_000,
    exercises: [{ exerciseId: 'incline-push-up', repRange: [6, 10], plannedWorkingSets: 2, targetRpe: 7,
      sets: [{ at, reps: 24, rpe: 6 }, { at: at + 100_000, reps: 24, rpe: 6 }] }] }
  state.gym = { ...gym, sessions: [workout] }
  const plan = buildGymSession({ capacity: bodyweightCapacity(state, now), location: home, minutes: 30, focus: 'upper', sessions: [workout], now })
  const push = plan.items.find((it) => it.exerciseId === 'incline-push-up')!
  const [line] = nextTimeLines(workout, [], home, false, workout.endedAt + 1000, { state })
  expect(push.suggestion).toMatchObject({ targetReps: 24, floorPushupTrial: 1 })
  expect(line.text).toContain('24 reps')
  expect(line.why).toBe(push.suggestion.why)
  state.profile.birthYear = 2011
  expect(bodyweightCapacity(state, now).floorPushupTrial).toBeUndefined()
})

it('offers a specific floor push-up trial after two easy preparation days and adapts to the actual result', () => {
  const now = new Date(2026, 9, 16, 12).getTime()
  const day = 86_400_000
  const state = initialState()
  const gym = defaultGym(['floor', 'wall'], 'kg', now)
  const visit = (days: number, exerciseId: string, reps: number, rpe: number, n = 3): GymSession => {
    const at = now - days * day
    return { id: String(at) + exerciseId, locationId: gym.locations[0].id, startedAt: at, endedAt: at + 60_000,
      name: 'Pressing', exercises: [{ exerciseId, repRange: [8, 12], sets: Array.from({ length: n }, () => ({ at, reps, rpe })) }] }
  }
  const prep = [visit(7, 'incline-push-up', 15, 6), visit(4, 'kneeling-push-up', 15, 6)]
  const capacity = (sessions: GymSession[]) => bodyweightCapacity({ ...state, gym: { ...gym, sessions } }, now)
  expect(capacity(prep.slice(1)).floorPushupTrial).toBeUndefined()
  expect(capacity([prep[0], visit(4, 'kneeling-push-up', 15, 9)]).floorPushupTrial).toBeUndefined()
  const initial = capacity(prep)
  expect(initial.floorPushupTrial).toBe(1)
  expect(readyForBodyweight('push-up', initial)).toBe(false)
  const plan = buildGymSession({ location: gym.locations[0], minutes: 30, focus: 'upper', sessions: prep, capacity: initial, now })
  expect(plan.items.filter((i) => i.suggestion.floorPushupTrial)).toHaveLength(1)
  expect(plan.items.find((i) => i.suggestion.floorPushupTrial)?.suggestion.why).toContain('1 clean floor push-up')
  expect(buildGymSession({ location: gym.locations[0], minutes: 30, focus: 'upper', sessions: prep, capacity: initial, avoidJoints: ['wrists'], now })
    .items.some((i) => i.suggestion.floorPushupTrial)).toBe(false)
  const missed = visit(3, 'push-up', 0, 8, 1)
  expect(capacity([...prep, missed]).floorPushupTrial).toBeUndefined()
  expect(capacity([...prep, missed, visit(2, 'kneeling-push-up', 15, 6), visit(1, 'incline-push-up', 15, 6)]).floorPushupTrial).toBe(1)
  expect(capacity([...prep, visit(3, 'push-up', 1, 7, 1)]).floorPushupTrial).toBe(2)
  expect(capacity([...prep, visit(3, 'push-up', 1, 9, 1)]).floorPushupTrial).toBe(1)
  expect(capacity([...prep, visit(0, 'push-up', 1, 7, 1)]).floorPushupTrial).toBeUndefined()
  const trained = capacity([...prep, visit(1, 'push-up', 4, 7, 1)])
  expect(trained.floorPushupTrial).toBeUndefined()
  expect(readyForBodyweight('push-up', trained)).toBe(true)
  const working = buildGymSession({ capacity: trained, sessions: [...prep, visit(1, 'push-up', 4, 7, 1)], location: gym.locations[0], minutes: 45, focus: 'push', now })
  expect(working.items.find((i) => i.exerciseId === 'push-up')).toMatchObject({ sets: 2, plan: { range: [2, 2] }, suggestion: { targetReps: 2, easierId: expect.any(String) } })
})

it('earns an unassisted pull-up check from home equipment and uses the repeatable dose when a trial succeeds', () => {
  const now = new Date(2026, 9, 16, 12).getTime()
  const location = homeLocation(['pullup-bar', 'band'], 'kg')
  const visit = (days: number, id: string, reps: number[], rpe: number): GymSession => {
    const at = now - days * 86_400_000
    return { id: id + days, name: 'Pull', locationId: location.id, startedAt: at, endedAt: at + 1000,
      exercises: [{ exerciseId: id, repRange: [6, 10], sets: reps.map((n, i) => ({ at: at + i, reps: n, rpe })) }] }
  }
  const early = [visit(9, 'band-assisted-pull-up', [10, 10], 7), visit(7, 'negative-pull-up', [5, 5], 8)]
  const steps = (logs: GymSession[]) => unassistedSteps(logs, { pushups: 0, pullups: 0 }, now)
  expect(steps(early).trials['pull-up']).toBe(1)
  expect(steps([early[0], visit(7, 'negative-pull-up', [5, 5], 9)]).trials['pull-up']).toBeUndefined()
  const missed = visit(5, 'pull-up', [0], 8)
  expect(steps([...early, missed]).trials['pull-up']).toBeUndefined()
  expect(steps([...early, missed, visit(3, 'band-assisted-pull-up', [8, 8], 8), visit(1, 'negative-pull-up', [4, 4], 7)]).trials['pull-up']).toBe(1)
  const gym = { ...defaultGym([], 'kg'), sessions: early }
  const input = { capacity: bodyweightCapacity({ ...initialState(), gym }, now), sessions: early, location, minutes: 45, focus: 'pull' as const, now }
  expect(buildGymSession(input).items.some((i) => i.suggestion.pullupTrial === 1)).toBe(true)
  expect(buildGymSession({ ...input, avoidJoints: ['elbows'] }).items.some((i) => i.suggestion.pullupTrial)).toBe(false)
  const work = steps([...early, visit(1, 'pull-up', [4], 7)]).practice['pull-up']!
  expect(unassistedDose(work, 3, 6)).toEqual({ sets: 2, reps: 2 })
  expect(unassistedDose({ ...work, reps: [2, 2] }, 3, 6)).toEqual({ sets: 2, reps: 3 })
  expect(unassistedDose({ ...work, reps: [4, 4] }, 3, 6)).toEqual({ sets: 3, reps: 3 })
  expect(unassistedDose({ ...work, reps: [4, 4] }, 2, 6)).toEqual({ sets: 2, reps: 5 })
  expect(unassistedDose({ ...work, reps: [3, 3], manageable: false }, 3, 6)).toEqual({ sets: 2, reps: 3 })
  expect(unassistedDose({ ...work, reps: [6, 6, 6] }, 3, 6)).toBeUndefined()
})

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

it('unlocks a stronger push-up without turning a beginner’s short lifting history into a full-volume workout', () => {
  const now = new Date(2026, 9, 13, 17).getTime()
  const state = initialState()
  const gym = defaultGym(['floor'], 'kg', now)
  gym.sessions = [8, 6, 4, 2, 1].map((days) => {
    const at = now - days * 86_400_000
    return { id: String(days), name: 'Training', locationId: 'home', startedAt: at, endedAt: at + 60_000,
      exercises: [days === 1 ? 'kneeling-push-up' : 'push-up', 'bodyweight-squat'].map((exerciseId) => ({
        exerciseId, sets: [0, 1].map((i) => ({ at: at + i, reps: days === 1 ? 2 : 10, rpe: days === 1 ? 10 : 7 })),
      })) }
  })
  const capacity = bodyweightCapacity({ ...state, gym }, now)
  expect(readyForBodyweight('diamond-push-up', capacity)).toBe(true)
  expect(capacity.buildUpSetLimit).toBe(6)
  expect(capacity.introductoryEffort).toBe(true)
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
