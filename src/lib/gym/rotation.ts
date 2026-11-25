import type { GymExercise } from '../../data/gym/exercises'
import type { GymSession, Rating } from './types'

/**
 * How the athlete's ratings set how often a movement comes up (their ask: rate the exercises, and the plan still tries
 * something new now and then). Among the movements that would do one accessory slot's job about equally well — the
 * same movement pattern and main muscle, within `COMPARABLE_FIT` of the best fit before ratings — the slot rotates by weight: love 4,
 * like 2, fine 1, dislike ¼. Avoided movements never get this far. The unrated movements in play — the plan's own
 * first choice and any already done — share one fine weight between them, so disliking a movement always makes it
 * come up less and the new ones tried along the way never crowd out a loved one.
 *
 * The rotation is deterministic: over the slot's last `ROTATION_WINDOW` sessions, the movement furthest behind its
 * weight's share goes in (a smooth weighted round-robin), the plan's order breaking ties. After
 * `EXPLORE_EVERY - 1` sessions of the slot with nothing new in them, a movement never tried gets one turn; one the
 * athlete swapped away from is not offered again this way. All of it is the app's design, not a measured rule.
 *
 * Nothing rotates in a slot where nothing is rated: it keeps the plan's single best pick, as before ratings existed.
 * The day's main compounds never rotate (the caller passes accessory slots only), so their progress stays comparable.
 */

export const RATING_WEIGHT: Record<Exclude<Rating, 'avoid'>, number> = { love: 4, like: 2, fine: 1, dislike: 0.25 }
/** How much worse than the best fit (before ratings) a movement may be and still share the slot. */
export const COMPARABLE_FIT = 0.5
/**
 * The slot sessions the rotation looks back over. Long enough for a disliked movement's small share to come round
 * (under about 1 / (movements × window) a share never would); short enough that a new rating takes over within weeks.
 */
export const ROTATION_WINDOW = 20
/** At most one never-tried movement per this many sessions of a slot. */
export const EXPLORE_EVERY = 5

export interface RotationChoice {
  exercise: GymExercise
  /** The slot's score for the movement without its rating (lower is a better fit). */
  fit: number
}

export interface RotationResult {
  pick: GymExercise
  /** A movement the athlete has never done, given its turn. */
  explored: boolean
}

const logged = (log: GymSession['exercises'][number]) => log.sets.length > 0

/**
 * The slot's pick under the athlete's ratings, or undefined when the slot keeps its usual pick (nothing comparable
 * rated). `ranked` is the slot's candidates in the plan's order, best first.
 */
export function rotateSlot(input: {
  ranked: readonly RotationChoice[]
  ratings: Record<string, Rating>
  sessions: readonly GymSession[]
  now: number
}): RotationResult | undefined {
  const { ranked, ratings, sessions, now } = input
  const first = ranked[0]
  // Avoided means never planned, whatever a caller passes in.
  if (!first || ratings[first.exercise.id] === 'avoid') return undefined
  // The same job: the same movement pattern, working the first pick's main muscle (a reverse curl is forearm work,
  // not a biceps curl's stand-in; a front raise is not a lateral raise).
  const same = ranked.filter((r) => ratings[r.exercise.id] !== 'avoid' && r.exercise.pattern === first.exercise.pattern &&
    r.exercise.primary.includes(first.exercise.primary[0]))
  const bestFit = Math.min(...same.map((r) => r.fit))
  const comparable = same.filter((r) => r === first || r.fit <= bestFit + COMPARABLE_FIT + 1e-9)
  const rated = (id: string) => {
    const r = ratings[id]
    return r && r !== 'avoid' ? r : undefined
  }
  if (comparable.length < 2 || !comparable.some((r) => rated(r.exercise.id))) return undefined

  const ids = new Set(comparable.map((r) => r.exercise.id))
  const past = sessions.filter((s) => s.startedAt < now).sort((a, b) => b.startedAt - a.startedAt)
  const firstDone = new Map<string, number>()
  const declined = new Set<string>()
  for (const s of past) {
    for (const log of s.exercises) {
      if (log.swappedFrom) declined.add(log.swappedFrom)
      if (!logged(log)) continue
      const at = firstDone.get(log.exerciseId)
      if (at === undefined || s.startedAt < at) firstDone.set(log.exerciseId, s.startedAt)
    }
  }
  const inSlot = (s: GymSession) => s.exercises.some((log) => (logged(log) && ids.has(log.exerciseId)) || (log.swappedFrom !== undefined && ids.has(log.swappedFrom)))
  const recent = past.filter(inSlot).slice(0, ROTATION_WINDOW)

  // Something new in a slot session: a movement done there for the first time, or one planned and swapped away
  // before it was ever done.
  const brandNew = (s: GymSession) => s.exercises.some((log) =>
    (logged(log) && ids.has(log.exerciseId) && firstDone.get(log.exerciseId) === s.startedAt) ||
    (log.swappedFrom !== undefined && ids.has(log.swappedFrom) && !((firstDone.get(log.swappedFrom) ?? Infinity) < s.startedAt)))
  const lastNew = recent.findIndex(brandNew)
  const sinceNew = lastNew < 0 ? recent.length : lastNew
  if (sinceNew >= EXPLORE_EVERY - 1) {
    const untried = comparable.find((r) => r !== first && !rated(r.exercise.id) && !firstDone.has(r.exercise.id) && !declined.has(r.exercise.id))
    if (untried) return { pick: untried.exercise, explored: true }
  }

  // The unrated movements in play (the plan's first choice, and any already done) share one fine weight between
  // them: trying new things must not crowd out the ones the athlete said they love.
  const unrated = comparable.filter((r) => !rated(r.exercise.id) && (r === first || firstDone.has(r.exercise.id)))
  const weightOf = (r: RotationChoice) => {
    const rating = rated(r.exercise.id)
    if (rating) return RATING_WEIGHT[rating]
    return unrated.includes(r) ? RATING_WEIGHT.fine / unrated.length : 0
  }
  const pool = comparable.filter((r) => weightOf(r) > 0)
  const total = pool.reduce((n, r) => n + weightOf(r), 0)
  const used = new Map<string, number>()
  for (const s of recent) {
    for (const id of new Set(s.exercises.filter(logged).map((log) => log.exerciseId))) {
      if (ids.has(id)) used.set(id, (used.get(id) ?? 0) + 1)
    }
  }
  const deficit = (r: RotationChoice) => (weightOf(r) / total) * (recent.length + 1) - (used.get(r.exercise.id) ?? 0)
  const pick = pool.reduce((best, r) => (deficit(r) > deficit(best) + 1e-9 ? r : best))
  return { pick: pick.exercise, explored: false }
}
