import { GYM_EXERCISE_BY_ID, GYM_EXERCISES, type GymExercise, type LocationEquipment } from '../../data/gym/exercises'
import { plyoGate } from './progression'
import { readyForBodyweight, type BodyweightCapacity } from './bodyweight'
import type { GymLocation, GymSession, Rating } from './types'

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

const RATING_ORDER: Record<Rating | 'unrated', number> = { love: 0, fine: 1, unrated: 2, avoid: 3 }

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
 * anything sharing a primary muscle, all doable here, best-liked first. An
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
  const sameMuscle = candidates.filter(
    (c) => c.pattern !== ex.pattern && c.primary.some((m) => ex.primary.includes(m)) && c.compound === ex.compound,
  )
  const rank = (c: GymExercise) => preferenceRank(c.id, ratings, location)
  const ordered = [...samePattern.sort((a, b) => rank(a) - rank(b)), ...sameMuscle.sort((a, b) => rank(a) - rank(b))]
  // Under 18 a lift that needs coaching comes after everything else, unless it is a favourite.
  if (!athlete?.youth) return ordered
  const coached = (c: GymExercise) => Boolean(c.technical) && ratings[c.id] !== 'love'
  return [...ordered.filter((c) => !coached(c)), ...ordered.filter(coached)]
}
