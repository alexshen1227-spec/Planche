import { GYM_EXERCISE_BY_ID, GYM_EXERCISES, type GymExercise, type LocationEquipment } from '../../data/gym/exercises'
import { plyoGate } from './progression'
import { readyForBodyweight, type BodyweightCapacity } from './bodyweight'
import type { GymLocation, GymSession, Rating } from './types'
import { MUSCLE_BY_ID, PATTERN_LABEL, locationEquipmentLabel, type Muscle } from '../../data/gym/catalog'
import { exerciseWords, matchesExercise } from '../exerciseSearch'

/** The floor is everywhere. */
function equipmentAt(location: Pick<GymLocation, 'equipment'> | undefined): Set<LocationEquipment> {
  return new Set<LocationEquipment>(['floor', ...(location?.equipment ?? [])])
}

function meetsNeeds(have: Set<LocationEquipment>, needs: LocationEquipment[][]): boolean {
  return needs.every((group) => group.some((item) => have.has(item)))
}

export function hasEquipment(location: Pick<GymLocation, 'equipment'> | undefined, needs: LocationEquipment[][]): boolean {
  return meetsNeeds(equipmentAt(location), needs)
}

export function canDoHere(exerciseId: string, location: GymLocation | undefined): boolean {
  const ex = GYM_EXERCISE_BY_ID[exerciseId]
  return Boolean(ex) && hasEquipment(location, ex.needs)
}

const catalogByKit = new WeakMap<ReadonlyArray<LocationEquipment>, { key: string; exercises: GymExercise[] }>()
const bareFloor: LocationEquipment[] = []

const searchable = new Map(GYM_EXERCISES.map((e) => [e.id, exerciseWords([
  e.name, e.id, PATTERN_LABEL[e.pattern], ...e.primary.map((m) => MUSCLE_BY_ID[m].label), ...e.needs.flat().map(locationEquipmentLabel),
].join(' '))]))

export function searchExercises(exercises: GymExercise[], query: string): GymExercise[] {
  const terms = exerciseWords(query)
  return exercises.filter((e) => matchesExercise(searchable.get(e.id) ?? [], terms))
}

export function availableAt(location: GymLocation | undefined): GymExercise[] {
  const equipment = location?.equipment ?? bareFloor
  const key = equipment.join(',')
  const cached = catalogByKit.get(equipment)
  if (cached?.key === key) return cached.exercises.slice()
  const have = equipmentAt(location)
  const exercises = GYM_EXERCISES.filter((e) => meetsNeeds(have, e.needs))
  catalogByKit.set(equipment, { key, exercises })
  return exercises.slice()
}

/** A specific example of the kit missing for a priority with no direct exercise at this place. */
export function missingPriorityOption(muscle: Muscle, location: GymLocation): { exercise: GymExercise; needs: LocationEquipment[][] } | undefined {
  if (availableAt(location).some((e) => e.primary.includes(muscle) && !e.explosive)) return undefined
  const have = equipmentAt(location)
  return GYM_EXERCISES.filter((e) => e.primary.includes(muscle) && !e.explosive && !e.technical)
    .map((exercise) => ({ exercise, needs: exercise.needs.filter((group) => !group.some((item) => have.has(item))) }))
    .filter((x) => x.needs.length)
    .sort((a, b) => a.needs.length - b.needs.length || Number(b.needs.some((g) => g.includes('band'))) - Number(a.needs.some((g) => g.includes('band'))))[0]
}

/** The order ratings put movements in: liked ones first, disliked ones after the unrated, avoided ones last. */
export const RATING_ORDER: Record<Rating | 'unrated', number> = { love: 0, like: 0.5, fine: 1, unrated: 2, dislike: 2.5, avoid: 3 }

/** How each rating is shown wherever the athlete rates a movement, with what it does to the plan. */
export const RATING_CHOICES: { value: Rating; label: string; effect: string }[] = [
  { value: 'love', label: 'Love', effect: 'picked most often' },
  { value: 'like', label: 'Like', effect: 'picked often' },
  { value: 'fine', label: 'Fine', effect: 'picked sometimes' },
  { value: 'dislike', label: 'Dislike', effect: 'picked rarely' },
  { value: 'avoid', label: 'Avoid', effect: 'never planned' },
]

/**
 * Preference order for picking among movements that do the same job:
 * loved first, avoided never (unless nothing else exists), and anything marked
 * hard to do at this location after everything that is not.
 */
export function preferenceRank(
  exerciseId: string,
  ratings: Record<string, Rating>,
  location: GymLocation | undefined,
): number {
  const rating = RATING_ORDER[ratings[exerciseId] ?? 'unrated']
  const hard = location?.hardHere?.includes(exerciseId) ? 10 : 0
  return rating + hard
}

/**
 * Swaps for "this machine is taken": the same movement pattern first, then
 * anything whose main muscles include this one's main target, all doable here, best-liked first. An
 * avoided movement is never offered as a swap.
 */
export function alternativesFor(
  exerciseId: string,
  location: GymLocation | undefined,
  ratings: Record<string, Rating> = {},
  exclude: string[] = [],
  /** When given, speed and power work this athlete has not built up to is never offered. */
  athlete?: { youth: boolean; sessions: GymSession[]; now?: number; capacity?: BodyweightCapacity },
): GymExercise[] {
  const ex = GYM_EXERCISE_BY_ID[exerciseId]
  if (!ex) return []
  const skip = new Set([exerciseId, ...exclude])
  const candidates = availableAt(location).filter(
    (c) =>
      !skip.has(c.id) &&
      readyForBodyweight(c.id, athlete?.capacity) &&
      ratings[c.id] !== 'avoid' &&
      // An explosive movement is swapped for explosive ones only: a box jump is not a back squat.
      (!ex.explosive || c.explosive) &&
      (!athlete || plyoGate(c, athlete.sessions, athlete.youth, athlete.now).allowed),
  )
  const samePattern = candidates.filter((c) => c.pattern === ex.pattern)
  // The same muscles means the movement's own target (its first main muscle): a wrist curl shares the forearms with
  // a hammer curl, but it is not a way to train the biceps.
  const sameMuscle = candidates.filter(
    (c) => c.pattern !== ex.pattern && c.primary.includes(ex.primary[0]) && c.compound === ex.compound,
  )
  const rank = (c: GymExercise) => preferenceRank(c.id, ratings, location)
  const ordered = [...samePattern.sort((a, b) => rank(a) - rank(b)), ...sameMuscle.sort((a, b) => rank(a) - rank(b))]
  // Under 18 a lift that needs coaching comes after everything else, unless it is a favourite.
  if (!athlete?.youth) return ordered
  const coached = (c: GymExercise) => Boolean(c.technical) && ratings[c.id] !== 'love'
  return [...ordered.filter((c) => !coached(c)), ...ordered.filter(coached)]
}
