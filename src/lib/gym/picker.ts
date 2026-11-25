import { GYM_EXERCISES, type GymExercise, type LocationEquipment } from '../../data/gym/exercises'
import { canDoHere, RATING_ORDER, searchExercises } from './availability'
import { exerciseWords } from '../exerciseSearch'
import { fitsGymFocus, type GymFocus } from './focus'
import type { GymLocation, GymSession, Rating } from './types'

/**
 * The exercise picker inside a workout (swap and add): the app's recommendations first, then the whole bank, searchable.
 * What today's joint check and switched-off muscles keep out stays out — the safety rails do not bend for a pick —
 * and how many that hides is counted, so the list can say why something is missing.
 */

export interface PickerRow {
  exercise: GymExercise
  /** Can be done with what this place lists. */
  here: boolean
  rating?: Rating
}

export interface PickerInput {
  location: GymLocation
  ratings: Record<string, Rating>
  query: string
  /** The day's focus, when the list is narrowed to it. */
  day?: GymFocus
  /** Show movements that need equipment this place does not list. */
  anyEquipment: boolean
  /** Movements already in the session. */
  exclude: readonly string[]
  /** Today's safety rails (joint check, switched-off muscles, speed-and-power gates): false hides a movement. */
  allowed: (e: GymExercise) => boolean
  /** The app's recommendations, best first. */
  recommended: readonly GymExercise[]
}

export const RECOMMENDED_COUNT = 8

/** The equipment groups a movement needs that this place does not list (the floor is everywhere). */
export function missingKit(exercise: Pick<GymExercise, 'needs'>, location: Pick<GymLocation, 'equipment'>): LocationEquipment[][] {
  return exercise.needs.filter((group) => !group.some((g) => g === 'floor' || location.equipment.includes(g)))
}

const ratingRank = (ratings: Record<string, Rating>, id: string) => RATING_ORDER[ratings[id] ?? 'unrated']

export function pickerRows(input: PickerInput): { recommended: PickerRow[]; rest: PickerRow[]; hidden: GymExercise[] } {
  const { location, ratings, query, day, anyEquipment, exclude, allowed } = input
  const row = (exercise: GymExercise): PickerRow => ({ exercise, here: canDoHere(exercise.id, location), ...(ratings[exercise.id] ? { rating: ratings[exercise.id] } : {}) })
  const inScope = (e: GymExercise) => !exclude.includes(e.id) && (!day || day === 'full' || fitsGymFocus(day, e)) &&
    (anyEquipment || canDoHere(e.id, location))
  const matches = searchExercises(GYM_EXERCISES, query).filter(inScope)
  const hidden = matches.filter((e) => !allowed(e))
  const shown = new Set(matches.filter(allowed).map((e) => e.id))
  const recommended = input.recommended.filter((e) => shown.has(e.id)).slice(0, RECOMMENDED_COUNT)
  const picked = new Set(recommended.map((e) => e.id))
  // A name that starts with what was typed comes first; then what can be done here, the athlete's favourites first.
  const terms = exerciseWords(query).join(' ')
  const nameRank = (e: GymExercise) => {
    if (!terms) return 0
    const name = exerciseWords(e.name).join(' ')
    return name === terms ? 0 : name.startsWith(terms) ? 1 : 2
  }
  const rest = matches.filter((e) => shown.has(e.id) && !picked.has(e.id))
    .sort((a, b) => nameRank(a) - nameRank(b) || Number(canDoHere(b.id, location)) - Number(canDoHere(a.id, location)) ||
      ratingRank(ratings, a.id) - ratingRank(ratings, b.id) || a.name.localeCompare(b.name))
  return { recommended: recommended.map(row), rest: rest.map(row), hidden }
}

/**
 * Recommendations for adding a movement: what the day's own muscles are getting least of in this session, among the
 * athlete's favourites and what they have done lately, never a movement they avoid.
 */
export function addRecommendations(input: {
  location: GymLocation
  ratings: Record<string, Rating>
  day?: GymFocus
  inSession: readonly string[]
  sessions: readonly GymSession[]
  allowed: (e: GymExercise) => boolean
  now: number
}): GymExercise[] {
  const { location, ratings, day, inSession, sessions, allowed, now } = input
  const patterns = new Set(inSession.map((id) => GYM_EXERCISES.find((e) => e.id === id)?.pattern))
  const recent = new Map<string, number>()
  for (const s of sessions) {
    if (s.startedAt >= now || s.startedAt < now - 60 * 86_400_000) continue
    for (const log of s.exercises) if (log.sets.some((set) => !set.warmup && set.reps > 0)) recent.set(log.exerciseId, (recent.get(log.exerciseId) ?? 0) + 1)
  }
  return GYM_EXERCISES
    .filter((e) => !inSession.includes(e.id) && ratings[e.id] !== 'avoid' && canDoHere(e.id, location) && allowed(e) &&
      (!day || day === 'full' || fitsGymFocus(day, e)))
    .map((e, order) => ({ e, order,
      score: ratingRank(ratings, e.id) * 2 - Math.min(3, recent.get(e.id) ?? 0) * 0.5 + (patterns.has(e.pattern) ? 1.5 : 0) + (e.technical ? 1 : 0) }))
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, RECOMMENDED_COUNT)
    .map(({ e }) => e)
}
