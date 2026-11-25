import { expect, it } from 'vitest'
import type { Muscle } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { steerInput } from '../plan/screens'
import { buildGymSession } from './builder'
import { fitsGymFocus } from './focus'
import type { GymLocation } from './types'

const home: GymLocation = { id: 'home', name: 'Home', unit: 'kg', updatedAt: 1,
  equipment: ['floor', 'dumbbells', 'incline-bench', 'pullup-bar'] }
const pushPriorities: Muscle[] = ['chest', 'chest-upper', 'side-delts']
type Options = { minutes?: number; spare?: Muscle[]; equipment?: GymLocation['equipment']; volumeFactor?: number }
const plan = (focus: 'pull' | 'push', priority: Muscle[], options: Options = {}) =>
  buildGymSession({ location: { ...home, equipment: options.equipment ?? home.equipment }, focus,
    minutes: options.minutes ?? 28, volumeFactor: options.volumeFactor, sessions: [], now: 1_800_000_000_000,
    goals: { skills: 3, physique: 5, strength: 3, power: 0, endurance: 0 },
    ratings: { 'chest-supported-db-row': 'love', 'db-rear-delt-fly': 'love', 'cuban-press': 'love',
      'db-fly': 'love', 'incline-db-fly': 'love', 'db-lateral-raise': 'love' },
    ...steerInput({ priority, spare: options.spare }, priority) })
const exercises = (workout: ReturnType<typeof plan>) => workout.items.map((it) => GYM_EXERCISE_BY_ID[it.exerciseId])

it('keeps the row and gives zero chest work on a 28-minute home Pull day with chest prioritized', () => {
  for (const options of [{}, { equipment: ['floor', 'dumbbells', 'incline-bench'] },
    { spare: ['lats', 'upper-back', 'rear-delts'] }] satisfies Options[]) {
    const workout = plan('pull', pushPriorities, options)
    const lifts = exercises(workout)
    expect(workout.fits).toBe(true)
    expect(workout.estimatedMin).toBeLessThanOrEqual(28)
    expect(lifts.map((e) => e.id)).toContain('chest-supported-db-row')
    expect(lifts.flatMap((e) => e.primary).filter((m) => pushPriorities.includes(m))).toEqual([])
    expect(lifts.flatMap((e) => e.secondary)).not.toContain('chest')
    expect(workout.items).toEqual(plan('pull', [], options).items)
  }
})

it('gives a short Pull day to both main pulls before any isolation work, whatever the priorities', () => {
  const workout = plan('pull', ['biceps', 'abs'], { minutes: 22 })
  expect(exercises(workout).map((e) => e.pattern)).toEqual(['vertical-pull', 'horizontal-pull'])
  expect(workout.items.map((it) => it.sets)).toEqual([3, 3])
  expect(workout.estimatedMin).toBeLessThanOrEqual(22)
})

it('lets a weekly curl suggestion order the accessories once the main pulls have four sets each', () => {
  const build = (minutes: number) => buildGymSession({ location: home, focus: 'pull', minutes, sessions: [],
    ...steerInput({ priority: ['biceps'] }) })
  const accessories = (minutes: number) => exercises(build(minutes)).map((e) => e.pattern).filter((p) => p === 'biceps' || p === 'rear-delt')
  expect(accessories(22)).toEqual([])
  expect(accessories(35)).toEqual(['biceps'])
  expect(build(35).items.filter((it) => !GYM_EXERCISE_BY_ID[it.exerciseId].compound).every((it) => it.sets <= 4)).toBe(true)
  expect(accessories(60).slice(0, 2)).toEqual(['biceps', 'rear-delt'])
  for (const minutes of [35, 60]) {
    expect(build(minutes).items.filter((it) => GYM_EXERCISE_BY_ID[it.exerciseId].compound).map((it) => it.sets), `${minutes}`).toEqual([4, 4])
  }
})

it('keeps the main Push presses ahead of accessory priorities and excludes pulling muscles', () => {
  const workout = plan('push', ['side-delts', 'triceps', 'abs', 'lats', 'rear-delts'])
  const lifts = exercises(workout)
  expect(lifts.map((e) => e.pattern)).toEqual(['horizontal-press', 'vertical-press'])
  expect(workout.items.map((it) => it.sets)).toEqual([4, 4])
  expect(lifts.flatMap((e) => e.primary).filter((m) => ['lats', 'upper-back', 'rear-delts', 'biceps', 'forearms', 'traps'].includes(m))).toEqual([])
  expect(workout.estimatedMin).toBeLessThanOrEqual(28)
  // Seven more minutes go to the athlete's own priority, the side delts, before any other accessory.
  const longer = exercises(plan('push', ['side-delts', 'triceps', 'abs', 'lats', 'rear-delts'], { minutes: 35 }))
  expect(longer.map((e) => e.pattern)).toEqual(['horizontal-press', 'vertical-press', 'lateral-raise'])
})

it.each([[9, 1], [12, 0.8]])('keeps a row when only one compound fits (%i minutes at %s volume)', (minutes, volumeFactor) => {
  const workout = plan('pull', [], { minutes, volumeFactor })
  expect(exercises(workout).map((e) => e.pattern)).toEqual(['horizontal-pull'])
  expect(workout.estimatedMin).toBeLessThanOrEqual(minutes)
})

it('allows shared core and checks every primary muscle of a mixed movement', () => {
  for (const focus of ['push', 'pull'] as const) {
    expect(fitsGymFocus(focus, GYM_EXERCISE_BY_ID['side-plank'])).toBe(true)
    expect(fitsGymFocus(focus, GYM_EXERCISE_BY_ID['cuban-press'])).toBe(false)
  }
})
