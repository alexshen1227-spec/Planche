import {
  athleticDomain,
  GYM_EXERCISE_BY_ID,
  type AthleticDomain,
  type GymExercise,
  type IntensityTier,
} from '../../data/gym/exercises'
import { maxKgFor, roundToStep, stepKgFor } from './units'
import type { GymLocation, GymSession, GymSet } from './types'

/**
 * Double progression (CONSENSUS — the standard way gyms program it, not a
 * trial-tested rule): work inside a rep range; when every working set reaches
 * the top of the range at or under the target effort, add the smallest load
 * the equipment allows and start again at the bottom.
 */

export interface RepPlan {
  range: [number, number]
  /** Effort to stop at, on the 6–10 RPE scale. */
  targetRpe: number
}

/**
 * Default ranges. An athlete under 18 never gets a range under 6 reps: no
 * near-maximal singles or doubles, and their maxes are estimated from sets of
 * 6+ rather than tested (the goal's youth rule; see `estimateOneRepMax`).
 */
export function repPlanFor(
  exercise: GymExercise,
  emphasis: 'strength' | 'muscle' | 'endurance' | 'power' = 'muscle',
  youth = false,
): RepPlan {
  // Runs, hops and throws are dosed in contacts or reps at an effort, never by load.
  if (exercise.dose && exercise.load === 'bodyweight') return { range: exercise.dose.range, targetRpe: exercise.dose.rpe }
  if (exercise.explosive || emphasis === 'power') return youth ? { range: [6, 8], targetRpe: 7 } : { range: [3, 6], targetRpe: 7 }
  if (emphasis === 'endurance') return { range: exercise.compound ? [12, 20] : [15, 25], targetRpe: 8 }
  if (emphasis === 'strength') {
    if (!exercise.compound) return { range: [8, 12], targetRpe: 8 }
    return youth ? { range: [6, 8], targetRpe: 8 } : { range: [4, 6], targetRpe: 8 }
  }
  return { range: exercise.compound ? [6, 10] : [10, 15], targetRpe: youth ? 7.5 : 8 }
}

/**
 * Estimated one-rep max from a set, adjusted for reps in reserve (Epley on
 * reps + RIR). Refuses past 12 total reps — the estimate is too loose there to
 * be a number worth showing — and for bodyweight or unloaded sets.
 */
export function estimateOneRepMax(set: Pick<GymSet, 'kg' | 'reps' | 'rpe'>): number | null {
  if (set.kg === undefined || !(set.kg > 0) || !(set.reps >= 1)) return null
  const rir = set.rpe !== undefined ? Math.max(0, 10 - set.rpe) : 0
  const total = set.reps + rir
  if (total > 12) return null
  return total <= 1 ? set.kg : set.kg * (1 + total / 30)
}

/** The load that should give `reps` at `rpe`, from an estimated max (the same model, inverted). */
export function loadForReps(oneRepMax: number, reps: number, rpe: number): number {
  const total = reps + Math.max(0, 10 - rpe)
  return total <= 1 ? oneRepMax : oneRepMax / (1 + total / 30)
}

export interface LastPerformance {
  session: GymSession
  sets: GymSet[]
}

/** The latest session's working sets of this exercise — at this location when `locationId` is given. */
export function lastPerformance(
  sessions: GymSession[],
  exerciseId: string,
  locationId?: string,
  before = Infinity,
): LastPerformance | null {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i]
    if (s.startedAt >= before) continue
    if (locationId !== undefined && s.locationId !== locationId) continue
    const log = s.exercises.find((e) => e.exerciseId === exerciseId)
    const sets = log?.sets.filter((set) => !set.warmup && set.reps > 0) ?? []
    if (sets.length) return { session: s, sets }
  }
  return null
}

/** Best estimated max for an exercise across every location, when free weights make them comparable. */
export function sharedEstimate(sessions: GymSession[], exerciseId: string, before = Infinity): number | null {
  const ex = GYM_EXERCISE_BY_ID[exerciseId]
  // Machines differ from gym to gym; only free weights carry a load across.
  if (!ex || !['barbell', 'dumbbell', 'kettlebell'].includes(ex.load)) return null
  let best: number | null = null
  const cutoff = before - 120 * 86_400_000
  for (const s of sessions) {
    if (s.startedAt >= before || s.startedAt < cutoff) continue
    for (const log of s.exercises) {
      if (log.exerciseId !== exerciseId) continue
      for (const set of log.sets) {
        if (set.warmup) continue
        const e = estimateOneRepMax(set)
        if (e !== null && (best === null || e > best)) best = e
      }
    }
  }
  return best
}

/** What to say for work counted in contacts or runs: quality and rest, never "add reps". */
function countedWhy(ex: GymExercise, plan: RepPlan): string {
  const [lo, hi] = plan.range
  const dist = ex.distanceM ? ` of about ${ex.distanceM} m` : ''
  if (ex.pattern === 'sprint') {
    return `${ex.maximal ? 'Maximal runs' : 'Runs'}${dist}, one per set, with full rest. Stop the moment speed drops: more runs do not help.`
  }
  if (ex.count === 'contacts') return `${lo}–${hi} foot contacts a set${dist}, quick and light. Quality over quantity: stop when they get slow or loud.`
  return `${lo}–${hi} reps a set at a crisp pace with full rest. Keep every rep fast; stop when speed drops.`
}

export interface LoadSuggestion {
  /** kg, rounded to a load this location can make; absent when the app will not guess. */
  kg?: number
  /** Reps to aim for. */
  reps: [number, number]
  targetRpe: number
  /** One line on why, in the athlete's terms. */
  why: string
  kind: 'increase' | 'repeat' | 'decrease' | 'from-estimate' | 'first-time' | 'bodyweight' | 'at-top-weight'
}

/**
 * What to load next time. Pure: history in, suggestion out. The athlete's
 * age only ever makes it more careful — one step at a time, never two.
 */
export function suggestLoad(input: {
  exerciseId: string
  location: GymLocation | undefined
  sessions: GymSession[]
  plan: RepPlan
  youth?: boolean
  now?: number
}): LoadSuggestion {
  const { exerciseId, location, sessions, plan, youth = false, now = Infinity } = input
  const ex = GYM_EXERCISE_BY_ID[exerciseId]
  const [lo, hi] = plan.range
  const base = { reps: plan.range, targetRpe: plan.targetRpe }
  if (!ex) return { ...base, kind: 'first-time', why: 'Not a movement this app knows.' }
  const last = lastPerformance(sessions, exerciseId, location?.id, now)
  const step = stepKgFor(ex, location)
  const top = maxKgFor(ex, location)
  if (!last) {
    const shared = sharedEstimate(sessions, exerciseId, now)
    if (shared !== null) {
      const kg = roundToStep(loadForReps(shared, hi, plan.targetRpe), step, top)
      return { ...base, kg, kind: 'from-estimate', why: `First time here — started from your estimated max on this lift elsewhere.` }
    }
    if (ex.load === 'bodyweight') {
      if (ex.count) return { ...base, kind: 'bodyweight', why: countedWhy(ex, plan) }
      return { ...base, kind: 'bodyweight', why: `Bodyweight: aim for ${lo}–${hi} clean reps.` }
    }
    return {
      ...base,
      kind: 'first-time',
      why: `First time here: pick a weight you could lift about ${hi} times with two reps to spare. The next session sets it from what you log.`,
    }
  }
  const working = last.sets
  const loads = working.map((s) => s.kg ?? 0)
  const kg = Math.max(...loads)
  const atLoad = working.filter((s) => (s.kg ?? 0) === kg)
  // One set stopped early is not "every set": a step up needs at least two.
  // ...and each with its effort logged: a set nobody rated says nothing about effort.
  const allTop = atLoad.length >= 2 && atLoad.every((s) => s.reps >= hi && s.rpe !== undefined && s.rpe <= plan.targetRpe + 0.5)
  const anyShort = atLoad.some((s) => s.reps < lo)
  const grinding = atLoad.some((s) => s.rpe !== undefined && s.rpe >= 9.5)
  if (ex.load === 'bodyweight' && !(kg > 0)) {
    if (ex.count) return { ...base, kind: 'bodyweight', why: countedWhy(ex, plan) }
    if (allTop) return { ...base, kind: 'bodyweight', why: `Every set reached ${hi} last time: add a few reps, slow the lowering, or move to a harder version.` }
    return { ...base, kind: 'bodyweight', why: `Aim to beat last time’s ${working.map((s) => s.reps).join(', ')} reps.` }
  }
  if (allTop && step > 0) {
    const next = roundToStep(kg + step, step, top)
    if (next <= kg) {
      return { ...base, kg, kind: 'at-top-weight', why: `Every set reached ${hi} — and that is the heaviest weight here. Add reps, a pause, or a harder variation.` }
    }
    // Sets that blew well past the range at an easy effort earn two steps —
    // for an adult. Under 18 a jump is always the smallest step there is.
    const easy = atLoad.every((s) => s.reps >= hi + 3 && s.rpe !== undefined && s.rpe <= 7)
    const twoSteps = !youth && easy ? roundToStep(kg + 2 * step, step, top) : next
    return {
      ...base,
      kg: twoSteps,
      kind: 'increase',
      why:
        twoSteps > next
          ? `Every set went well past ${hi} at an easy effort last time: up two steps.`
          : `Every set reached ${hi} at the target effort last time: up one step.`,
    }
  }
  if (anyShort && grinding && step > 0) {
    return { ...base, kg: roundToStep(Math.max(0, kg - step), step, top), kind: 'decrease', why: `Last time fell short of ${lo} reps at a near-max effort: one step lighter, then build back.` }
  }
  return { ...base, kg, kind: 'repeat', why: `Same weight: aim to add a rep to last time’s ${atLoad.map((s) => s.reps).join(', ')}.` }
}

export interface GymRecord {
  exerciseId: string
  /** Best estimated one-rep max, with the set it came from. */
  bestE1rm?: { kg: number; at: number; locationId: string; set: GymSet }
  /** Heaviest working load moved for at least one rep. */
  heaviest?: { kg: number; reps: number; at: number }
  /** Most reps in one working set (bodyweight work). */
  mostReps?: { reps: number; kg?: number; at: number }
}

/** Records per exercise, derived by replaying history — never stored, never edited. */
export function gymRecords(sessions: GymSession[]): Record<string, GymRecord> {
  const out: Record<string, GymRecord> = {}
  for (const s of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    for (const log of s.exercises) {
      const rec = (out[log.exerciseId] ??= { exerciseId: log.exerciseId })
      for (const set of log.sets) {
        if (set.warmup || !(set.reps > 0)) continue
        const e = estimateOneRepMax(set)
        if (e !== null && (!rec.bestE1rm || e > rec.bestE1rm.kg)) rec.bestE1rm = { kg: e, at: set.at, locationId: s.locationId, set }
        if (set.kg !== undefined && set.kg > 0 && (!rec.heaviest || set.kg > rec.heaviest.kg)) {
          rec.heaviest = { kg: set.kg, reps: set.reps, at: set.at }
        }
        if (!rec.mostReps || set.reps > rec.mostReps.reps) rec.mostReps = { reps: set.reps, ...(set.kg ? { kg: set.kg } : {}), at: set.at }
      }
    }
  }
  return out
}

// ---- Progression gate for speed and power work (CONSENSUS) ----

const MIN_SESSIONS_YOUTH = 2
const MIN_SESSIONS_ADULT = 1

/** The tier an exercise is gated at: maximal runs count as high whatever their listed tier. */
export function gateTier(ex: GymExercise): IntensityTier | null {
  if (!athleticDomain(ex)) return null
  return ex.maximal ? 'high' : (ex.tier ?? null)
}

/** How many distinct sessions logged something of each tier in a domain (any set with reps, warm-up flag or not). */
export function tierSessions(sessions: GymSession[], domain: AthleticDomain, now = Infinity): Record<IntensityTier, number> {
  const counts: Record<IntensityTier, number> = { low: 0, medium: 0, high: 0 }
  for (const s of sessions) {
    if (s.startedAt >= now) continue
    const seen = new Set<IntensityTier>()
    for (const log of s.exercises) {
      const ex = GYM_EXERCISE_BY_ID[log.exerciseId]
      if (!ex || athleticDomain(ex) !== domain || !ex.tier) continue
      if (!log.sets.some((set) => set.reps > 0)) continue
      seen.add(gateTier(ex)!)
    }
    for (const t of seen) counts[t]++
  }
  return counts
}

/**
 * The highest tier of one domain this athlete may be given, from what they
 * have logged. Under 18: low always; medium after two sessions of low work;
 * high after two sessions of medium work (and some low). An adult starts at
 * medium, and gets high once any lower-tier session is on record. A coaching
 * ladder (CONSENSUS), not a measured threshold.
 */
export function unlockedTier(sessions: GymSession[], domain: AthleticDomain, youth: boolean, now = Infinity): IntensityTier {
  const c = tierSessions(sessions, domain, now)
  if (youth) {
    if (c.low >= MIN_SESSIONS_YOUTH && c.medium >= MIN_SESSIONS_YOUTH) return 'high'
    if (c.low >= MIN_SESSIONS_YOUTH) return 'medium'
    return 'low'
  }
  return c.low + c.medium >= MIN_SESSIONS_ADULT ? 'high' : 'medium'
}

export interface PlyoGate {
  allowed: boolean
  /** Why not, in the athlete's terms. */
  reason?: string
}

/** Whether this movement may be programmed yet. Exercises outside speed and power work are never gated. */
export function plyoGate(ex: GymExercise, sessions: GymSession[], youth: boolean, now = Infinity): PlyoGate {
  const domain = athleticDomain(ex)
  const tier = gateTier(ex)
  if (!domain || !tier) return { allowed: true }
  const top = unlockedTier(sessions, domain, youth, now)
  if (TIER_RANK[tier] <= TIER_RANK[top]) return { allowed: true }
  const need = tier === 'high' ? 'medium' : 'low'
  const n = youth ? MIN_SESSIONS_YOUTH : MIN_SESSIONS_ADULT
  return {
    allowed: false,
    reason: `Not yet: do ${n} session${n === 1 ? '' : 's'} of ${need}-tier ${domain === 'sprint' ? 'running' : domain} work first. ${
      youth ? 'Growing athletes build up through the lower tiers.' : 'Build up through the lower tiers first.'
    }`,
  }
}

const TIER_RANK: Record<IntensityTier, number> = { low: 0, medium: 1, high: 2 }
export { TIER_RANK }
