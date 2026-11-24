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

it('trims Pull isolation work before either main pulling movement', () => {
  const lifts = exercises(plan('pull', ['biceps', 'abs'], { minutes: 22 }))
  expect(lifts.map((e) => e.pattern)).toEqual(expect.arrayContaining(['horizontal-pull', 'vertical-pull', 'biceps']))
  expect(lifts.map((e) => e.pattern)).not.toContain('rear-delt')
})

it('keeps the main Push presses ahead of accessory priorities and excludes pulling muscles', () => {
  const workout = plan('push', ['side-delts', 'triceps', 'abs', 'lats', 'rear-delts'])
  const lifts = exercises(workout)
  expect(lifts.map((e) => e.pattern)).toEqual(expect.arrayContaining(['horizontal-press', 'vertical-press', 'lateral-raise']))
  expect(lifts.flatMap((e) => e.primary).filter((m) => ['lats', 'upper-back', 'rear-delts', 'biceps', 'forearms', 'traps'].includes(m))).toEqual([])
  expect(workout.estimatedMin).toBeLessThanOrEqual(28)
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
