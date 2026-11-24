import {
  athleticDomain,
  GYM_EXERCISE_BY_ID,
  type AthleticDomain,
  type GymExercise,
  type IntensityTier,
} from '../../data/gym/exercises'
import { formatLoad, maxKgFor, minKgFor, roundToStep, stepKgFor, takesAddedLoad, unitFor, unloadedLabel } from './units'
import type { GymSession, GymSet } from './types'
import type { StampedLocation } from './state'
import { addDays, dayKey } from '../time'

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

/** Read both newer per-lift prescriptions and the outstanding sets in older partial workouts. */
export function unfinishedLiftSets(session: GymSession, exerciseId: string): number {
  const pending = session.remaining?.items.reduce((n, it) =>
    n + (it.exerciseId === exerciseId ? it.sets.filter((s) => !s.warmup).length : 0), 0) ?? 0
  const missing = session.exercises.reduce((n, log) => n + (log.exerciseId === exerciseId && log.plannedWorkingSets ?
    Math.max(0, log.plannedWorkingSets - log.sets.filter((s) => !s.warmup && s.reps > 0).length) : 0), 0)
  return Math.max(pending, missing)
}

/** A bodyweight movement that needs coaching to do well: dosed in a few slow reps. */
export function isHardBodyweight(ex: GymExercise): boolean {
  return Boolean(ex.technical && ex.load === 'bodyweight' && !ex.dose && !ex.explosive && !ex.assisted)
}

/** What a set of this movement is counted in. Reps logged on a hold are read as seconds. */
export function countUnit(ex: Pick<GymExercise, 'count' | 'distanceM'> | undefined): 'reps' | 'seconds' | 'contacts' | 'trips' {
  if (ex?.count === 'seconds' || ex?.count === 'contacts') return ex.count
  return ex?.distanceM ? 'trips' : 'reps'
}

/** "12 reps" or "30 s": a count as the movement is counted (reps logged on a hold read as seconds). */
export function countWord(ex: Pick<GymExercise, 'count' | 'distanceM'> | undefined, n: number | string): string {
  const unit = countUnit(ex)
  if (unit === 'seconds') return `${n} s`
  if (unit === 'trips') return Number(n) === 1 ? `${ex!.distanceM} m` : `${n} trips of ${ex!.distanceM} m`
  return `${n} ${Number(n) === 1 ? unit.slice(0, -1) : unit}`
}

/**
 * Whether a set with no load may be logged as bodyweight: only for a movement
 * that is bodyweight or where the logged weight is help. A loaded lift needs a weight.
 */
export function allowsUnloaded(ex: Pick<GymExercise, 'load' | 'assisted' | 'stepFrom'> | undefined): boolean {
  return !ex || ex.load === 'bodyweight' || Boolean(ex.assisted) || ex.stepFrom === 'sled'
}

/** A loaded movement's set that no weight was logged on: it says nothing about the load. */
export function isUnloadedSet(ex: GymExercise | undefined, set: Pick<GymSet, 'kg'>): boolean {
  return Boolean(ex) && !allowsUnloaded(ex) && !(set.kg !== undefined && set.kg > 0)
}

/** The fewest reps in a range for an athlete under 18 (see `repPlanFor`). */
export const YOUTH_REP_FLOOR = 6

/** A jump or throw counted in reps or contacts: the unloaded work whose dose range a youth floor applies to. */
function isCountedInReps(ex: GymExercise): boolean {
  return (ex.pattern === 'jump' || ex.pattern === 'throw') && (ex.count === 'reps' || ex.count === 'contacts')
}

/**
 * Default ranges. An athlete under 18 never gets a loaded range under 6 reps:
 * no near-maximal singles or doubles, and their maxes are estimated from sets
 * of 6+ rather than tested (the goal's youth rule; see `estimateOneRepMax`).
 * The one exception is hard bodyweight work (a Nordic curl, a dragon flag),
 * which is 4–6 slow reps under 18: those are not loaded maxes.
 */
export function repPlanFor(
  exercise: GymExercise,
  emphasis: 'strength' | 'muscle' | 'endurance' | 'power' = 'muscle',
  youth = false,
): RepPlan {
  // Runs, hops and throws are dosed in contacts or reps at an effort, never by load.
  if (exercise.dose) {
    const [lo, hi] = exercise.dose.range
    // Under 18 a jump or a throw counted in reps never goes under six, like every other rep range (a landing, a
    // box jump, a medicine-ball throw): the dose's own range is the adult one. A run is one rep by definition,
    // a hold is counted in seconds, and a drill's contacts already start higher.
    if (youth && lo < YOUTH_REP_FLOOR && isCountedInReps(exercise)) return { range: [YOUTH_REP_FLOOR, Math.max(hi, YOUTH_REP_FLOOR + 2)], targetRpe: exercise.dose.rpe }
    return { range: exercise.dose.range, targetRpe: exercise.dose.rpe }
  }
  if (exercise.explosive || emphasis === 'power') return youth ? { range: [6, 8], targetRpe: 7 } : { range: [3, 6], targetRpe: 7 }
  // A hard bodyweight movement (a Nordic curl, a dragon flag) is a few slow, controlled reps, never an
  // isolation set of 10–15. Under 18 the floor stays one rep above the lowest: these are not loaded maxes.
  if (isHardBodyweight(exercise)) return { range: youth ? [4, 6] : [3, 6], targetRpe: 8 }
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
 * be a number worth showing — for unloaded sets, and (pass the id) for an
 * assisted movement, where the logged weight is the help, and for bodyweight
 * movements, where only the added load is known.
 */
export function estimateOneRepMax(set: Pick<GymSet, 'kg' | 'reps' | 'rpe'>, exerciseId?: string, opts: { effort?: boolean } = {}): number | null {
  const known = exerciseId !== undefined ? GYM_EXERCISE_BY_ID[exerciseId] : undefined
  if (known?.assisted || known?.count || known?.distanceM || known?.dose) return null
  // Bodyweight is optional and usually unknown, so the added load alone says nothing about a max.
  if (known?.load === 'bodyweight') return null
  if (set.kg === undefined || !(set.kg > 0) || !(set.reps >= 1)) return null
  const rir = opts.effort !== false && set.rpe !== undefined ? Math.max(0, 10 - set.rpe) : 0
  const total = set.reps + rir
  if (total > 12) return null
  return total <= 1 ? set.kg : set.kg * (1 + total / 30)
}

/**
 * The estimate a "new max" is judged on: load and reps alone, the effort left out. An unrated set reads as no reps
 * in reserve, so rating the same 60 kg × 8 at RPE 7 once moved its estimate from 76 to 82 and called it a new max
 * (found by review). A rating added later must not make a "new" max out of the same performance; a lift that was
 * really easier at the same load shows in its reps or its load. The prescription (`loadForReps`) and the displayed
 * estimate still use the effort, which is a better guess for what to lift, not a claim of progress.
 */
export function comparableMax(set: Pick<GymSet, 'kg' | 'reps'>, exerciseId?: string): number | null {
  return estimateOneRepMax(set, exerciseId, { effort: false })
}

/**
 * Whether an estimate on this lift can be compared across places. Free weights are the same bar anywhere; a
 * machine is not ("machines differ from gym to gym"), so its maxes are only compared within one place.
 */
export function maxKey(exerciseId: string, locationId: string): string {
  const ex = GYM_EXERCISE_BY_ID[exerciseId]
  return !ex || isFreeWeight(ex) ? exerciseId : `${locationId}:${exerciseId}`
}

export interface MaxGain {
  sessionId: string
  exerciseId: string
  at: number
  endedAt: number
  kg: number
  before: number
  set: GymSet
}

/**
 * Every time a session's best comparable estimate beat the best of the sessions before it on the same lift (same
 * place for a machine). A new max needs an earlier estimate from an earlier session: the first session has nothing
 * to beat, and a heavier set inside the same session is not a new max. Derived by replay, never stored.
 */
export function estimatedMaxGains(sessions: GymSession[]): MaxGain[] {
  const out: MaxGain[] = []
  const best = new Map<string, number>()
  for (const s of [...sessions].sort((a, b) => a.startedAt - b.startedAt || a.endedAt - b.endedAt)) {
    const today = new Map<string, { estimate: number; set: GymSet }>()
    for (const log of s.exercises) {
      const key = maxKey(log.exerciseId, s.locationId)
      for (const set of log.sets) {
        if (set.warmup || !(set.reps > 0)) continue
        const e = comparableMax(set, log.exerciseId)
        if (e !== null && e > (today.get(key)?.estimate ?? 0)) today.set(key, { estimate: e, set })
      }
    }
    for (const [key, { estimate: e, set }] of today) {
      const had = best.get(key)
      const exerciseId = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key
      if (had !== undefined && e > had + 0.01) out.push({ sessionId: s.id, exerciseId, at: s.startedAt, endedAt: s.endedAt, kg: e, before: had, set })
      if (had === undefined || e > had) best.set(key, e)
    }
  }
  return out
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
  keep?: (set: GymSet) => boolean,
): LastPerformance | null {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i]
    if (s.startedAt >= before) continue
    if (locationId !== undefined && s.locationId !== locationId) continue
    const sets = s.exercises.flatMap((log) => log.exerciseId === exerciseId
      ? log.sets.filter((set) => !set.warmup && set.reps > 0 && (!keep || keep(set))) : [])
    if (sets.length) return { session: s, sets }
  }
  return null
}

const isFreeWeight = (ex: GymExercise) => ['barbell', 'dumbbell', 'kettlebell'].includes(ex.load)

/**
 * The estimated max from the latest session of a free-weight lift at any place, for a place the athlete has not
 * lifted it at. The latest performance, never the best of the last months: the best of 120 days once sent a bench of
 * 80 × 8 (RPE 10) to a new gym at 82.5 kg × 6–10. Machines return null: they differ from gym to gym.
 */
export function sharedEstimate(sessions: GymSession[], exerciseId: string, before = Infinity): number | null {
  const ex = GYM_EXERCISE_BY_ID[exerciseId]
  if (!ex || !isFreeWeight(ex)) return null
  const cutoff = Number.isFinite(before) ? before - 120 * 86_400_000 : -Infinity
  const latest = lastPerformance(sessions, exerciseId, undefined, before, (set) => !isUnloadedSet(ex, set))
  if (!latest || latest.session.startedAt < cutoff) return null
  let best: number | null = null
  for (const set of latest.sets) {
    const e = estimateOneRepMax(set, exerciseId)
    if (e !== null && (best === null || e > best)) best = e
  }
  return best
}

/** Past this many days since a lift was last done, it does not step up: the last session is not today's strength. */
export const NO_STEP_UP_DAYS = 28
/** Past this many, it starts one step lighter and builds back. */
export const STEP_DOWN_DAYS = 42

/** What to say for work counted in contacts or runs: quality and rest, never "add reps". */
function countedWhy(ex: GymExercise, plan: RepPlan, lastSeconds?: number[]): string {
  const [lo, hi] = plan.range
  if (ex.count === 'seconds') {
    return lastSeconds?.length
      ? `Aim to beat last time’s ${lastSeconds.join(', ')} seconds: add a few seconds, and stop the moment the line breaks.`
      : `Hold ${lo}–${hi} seconds a set, in a straight clean line. Stop when form goes, not at a number.`
  }
  const dist = ex.distanceM ? ` of about ${ex.distanceM} m` : ''
  if (ex.pattern === 'sprint') {
    return `${ex.maximal ? 'Maximal runs' : 'Runs'}${dist}, one per set, with full rest. Stop the moment speed drops: more runs do not help.`
  }
  if (ex.count === 'contacts') return `${lo}–${hi} foot contacts a set${dist}, quick and light. Quality over quantity: stop when they get slow or loud.`
  return `${lo}–${hi} reps a set at a crisp pace with full rest. Keep every rep fast; stop when speed drops.`
}

/**
 * Where the working sets were done: the load most sets used. On a tie, the
 * heaviest (or, for help, the least help) so a ramp of single sets reads as
 * its top.
 */
function workingLoad(loads: number[], tie: 'heaviest' | 'lightest'): number {
  const counts = new Map<number, number>()
  for (const l of loads) counts.set(l, (counts.get(l) ?? 0) + 1)
  let best = loads[0] ?? 0
  let n = 0
  for (const [l, c] of counts) {
    if (c > n || (c === n && (tie === 'heaviest' ? l > best : l < best))) {
      best = l
      n = c
    }
  }
  return best
}

/** A step up that fell short is remembered this long: after it the lighter load has to earn the next try. */
export const FAILED_STEP_MEMORY_DAYS = 56
/** Reps past the top of the range each remembered failed step asks for before the same step is tried again. */
export const FAILED_STEP_EXTRA_REPS = 2
/** The most failed steps that count: the bar rises to this many times the extra reps, never further. */
const FAILED_STEP_CAP = 3

/**
 * How many times a heavier load than `kg` was tried at this place lately and fell short (a set under the range
 * at a near-max effort, or half the sets under it with no effort logged). It looks back from the session being
 * read through the sessions at heavier loads and stops at the first heavier session that was handled or at the
 * edge of the memory, so a step that worked clears the slate. Pure; history in, a count out.
 */
function failedStepsAbove(
  sessions: GymSession[],
  exerciseId: string,
  locationId: string | undefined,
  kg: number,
  from: GymSession,
  lo: number,
  targetRpe: number,
  keep: (set: GymSet) => boolean,
): number {
  let failed = 0
  let before = from.startedAt
  for (let i = 0; i < 16; i++) {
    const prev = lastPerformance(sessions, exerciseId, locationId, before, keep)
    if (!prev) break
    if (from.startedAt - prev.session.startedAt > FAILED_STEP_MEMORY_DAYS * 86_400_000) break
    before = prev.session.startedAt
    const load = workingLoad(prev.sets.map((s) => s.kg ?? 0), 'heaviest')
    if (!(load > kg + 0.01)) continue
    const atHeavier = prev.sets.filter((s) => (s.kg ?? 0) === load)
    const fell = atHeavier.some((s) => s.reps < lo && (s.rpe ?? 0) >= 9.5) ||
      shortAtHighEffort(atHeavier, lo, targetRpe) || failedWithoutEffort(atHeavier, lo)
    if (!fell) break
    failed++
  }
  return failed
}

/** At least half the sets at the working load fell short of the range, and no effort was logged on any of them. */
function failedWithoutEffort(atLoad: GymSet[], lo: number): boolean {
  if (!atLoad.length || atLoad.some((s) => s.rpe !== undefined)) return false
  return atLoad.filter((s) => s.reps < lo).length * 2 >= atLoad.length
}

/** Several sets missed the bottom even though the athlete worked harder than prescribed. */
function shortAtHighEffort(sets: GymSet[], floor: number, targetRpe: number): boolean {
  const misses = sets.filter((s) => s.reps < floor && (s.rpe ?? 0) > targetRpe + 0.5).length
  return misses >= 2 && misses * 2 >= sets.length
}

export interface LoadSuggestion {
  /** kg, rounded to a load this location can make; absent when the app will not guess. */
  kg?: number
  /** Reps to aim for. */
  reps: [number, number]
  /** Starting count when the athlete's history gives a more useful target than the generic range. */
  targetReps?: number
  chooseAlternative?: boolean
  /** The athlete may log this many clean floor push-ups in place of one easier set. */
  floorPushupTrial?: number
  pullupTrial?: number
  /** An easier movement the athlete can use for the remaining unassisted sets. */
  easierId?: string
  targetRpe: number
  /** One line on why, in the athlete's terms. */
  why: string
  kind: 'increase' | 'repeat' | 'decrease' | 'from-estimate' | 'first-time' | 'bodyweight' | 'at-top-weight' | 'at-minimum-weight'
  /** Set when the next step is held back: the reps every set needs at this load first. The screen shows and pre-fills it. */
  repsToMoveUp?: number
  /** Set when the load is only the nearest this place can make to last time's (kg): the screen says so, never "up". */
  nearestTo?: number
}

/** The target shown beside the set fields, including an earned bodyweight starting dose. */
export function prescribedCount(plan: RepPlan, suggestion?: LoadSuggestion): string {
  const target = suggestion?.repsToMoveUp ?? suggestion?.targetReps
  if (target !== undefined) return String(target)
  return plan.range[0] === plan.range[1] ? String(plan.range[0]) : plan.range.join('–')
}

/**
 * What to load next time. Pure: history in, suggestion out. The athlete's
 * age only ever makes it more careful — one step at a time, never two.
 */
/** The heaviest load on this unit's grid that is at most one step above the true last load (a jump under 18 never exceeds it). */
export function youthCeiling(lastKg: number, stepKg: number, topKg?: number, minKg = 0): number {
  const grid = minKg + Math.floor((lastKg + stepKg - minKg) / stepKg + 1e-9) * stepKg
  return grid < minKg ? 0 : roundToStep(grid, stepKg, topKg, minKg)
}

/**
 * A step this large (more than a quarter of the load) is earned with reps past the range before an under-18 takes it.
 * The app's own rule on top of double progression (CONSENSUS); the share is a design choice, not a measured one:
 * a 5 kg step on a 15 kg machine is a third of the load, a 2.5 kg dumbbell step on 10 kg is exactly a quarter and stays allowed.
 */
export const YOUTH_LARGE_STEP_SHARE = 0.25
/** Reps past the top of the range a large youth step asks for first (the same two as a retry after a failed step). */
export const YOUTH_LARGE_STEP_EXTRA_REPS = 2

/** One step down taken from the load that was really lifted, then up to the grid: never more than one step of this unit below it. */
export function stepDownKg(kg: number, stepKg: number, topKg?: number, minKg = 0): number {
  if (!(stepKg > 0)) return Math.max(0, kg)
  const lowered = Math.max(minKg, kg - stepKg)
  const grid = minKg + Math.ceil((lowered - minKg) / stepKg - 1e-9) * stepKg
  return roundToStep(grid, stepKg, topKg, minKg)
}

export function suggestLoad(input: {
  exerciseId: string
  location: StampedLocation | undefined
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
  // A set of a loaded movement with no weight logged says nothing about the load.
  const addedLoad = takesAddedLoad(ex, location)
  const keep = (set: GymSet) => !isUnloadedSet(ex, set) && (!ex.assisted || set.kg !== undefined) && (ex.load !== 'bodyweight' || !ex.stepFrom || addedLoad || !set.kg)
  const last = lastPerformance(sessions, exerciseId, location?.id, now, keep)
  const step = stepKgFor(ex, location)
  const top = maxKgFor(ex, location)
  const min = minKgFor(ex, location)
  const external = ex.load !== 'bodyweight' && !ex.assisted
  const easier = exerciseId === 'db-lateral-raise' ? 'bent-arm-db-lateral-raise' : undefined
  const changeLift = (why: string): LoadSuggestion => ({
    ...base, kind: 'at-minimum-weight', chooseAlternative: true, ...(easier ? { easierId: easier } : {}),
    why: `${why} Choose an easier variation or enter a lighter weight if you have one.`,
  })
  if (!last) {
    if (ex.stepFrom === 'sled' && ex.distanceM) return { ...base, kind: 'first-time', targetReps: 1,
      why: `Push the sled ${ex.distanceM} m once per set. Start with a load you can move smoothly and log the plates you add. An empty sled is fine.` }
    const shared = sharedEstimate(sessions, exerciseId, now)
    if (shared !== null) {
      const estimate = loadForReps(shared, hi, plan.targetRpe)
      let kg = roundToStep(estimate, step, top, min)
      // Under 18 a new place never asks for more than one step past what was really lifted last (the youth rule).
      const elsewhereLast = lastPerformance(sessions, exerciseId, undefined, now, keep)
      if (youth && elsewhereLast && step > 0) {
        const lifted = workingLoad(elsewhereLast.sets.map((x) => x.kg ?? 0), 'heaviest')
        if (lifted > 0) kg = Math.min(kg, youthCeiling(lifted, step, top, min))
      }
      if (external && (kg <= 0 || (min !== undefined && estimate < min))) return changeLift('Your starting estimate from the other gym is below the first available weight here.')
      // Time away follows the lift, not the place: a new gym does not forget it.
      const elsewhere = lastPerformance(sessions, exerciseId, undefined, now, keep)
      const awayDays = elsewhere && Number.isFinite(now) ? (now - elsewhere.session.startedAt) / 86_400_000 : 0
      if (awayDays > STEP_DOWN_DAYS && step > 0 && kg > 0) {
        const lower = stepDownKg(kg, step, top, min)
        if (external && (lower <= 0 || lower >= kg)) return changeLift('Your return session calls for a lighter weight than this rack can supply.')
        return {
          ...base,
          kg: lower,
          kind: 'decrease',
          why: `First time here, and first time in ${Math.round(awayDays / 7)} weeks: a step under your estimate from elsewhere, then build back.`,
        }
      }
      return { ...base, kg, kind: 'from-estimate', why: `First time here — started from your estimated max on this lift elsewhere.` }
    }
    if (ex.load === 'bodyweight') {
      if (ex.count) return { ...base, kind: 'bodyweight', why: countedWhy(ex, plan) }
      if (unloadedLabel(ex) === 'Band') return { ...base, kind: 'bodyweight', why: `Choose a band that lets you do ${lo}–${hi} controlled reps. Note the band in your session notes.` }
      if (addedLoad) return { ...base, kind: 'bodyweight', why: `Aim for ${lo}–${hi} clean reps. Enter the extra weight you use, or zero for bodyweight.` }
      if (isHardBodyweight(ex)) return { ...base, kind: 'bodyweight', why: `Hard bodyweight movement: ${lo}–${hi} slow, controlled reps, lowering for about three seconds. Stop a rep before form breaks.` }
      return { ...base, kind: 'bodyweight', why: `Bodyweight: aim for ${lo}–${hi} clean reps.` }
    }
    const rir = Math.max(0, Math.round(10 - plan.targetRpe))
    const reserve = rir === 1 ? 'one rep' : rir === 2 ? 'two reps' : rir === 3 ? 'three reps' : `${rir} reps`
    if (ex.assisted) {
      return {
        ...base,
        kind: 'first-time',
        why: `Choose enough assistance for ${hi} clean reps with ${reserve} to spare. Record the help you use. Progress gradually reduces it.`,
      }
    }
    return {
      ...base,
      kind: 'first-time',
      why: `Pick a weight you can lift for ${hi} controlled reps with ${reserve} to spare. Your logged sets guide the next workout.`,
    }
  }
  const working = last.sets
  const unfinished = unfinishedLiftSets(last.session, exerciseId)
  // Time away: a session this old says little about what the body can do today (CONSENSUS —
  // the usual return-to-training convention, not a measured rule), at any age.
  // Free weights carry between gyms, so the gap runs from the lift's latest session at any place
  // (work elsewhere is not time away); a machine's is its own place's.
  const gapFrom = isFreeWeight(ex) ? (lastPerformance(sessions, exerciseId, undefined, now, keep) ?? last).session : last.session
  const gapDays = Number.isFinite(now) ? (now - gapFrom.startedAt) / 86_400_000 : 0
  const stale = gapDays > NO_STEP_UP_DAYS
  const away = gapDays > STEP_DOWN_DAYS
  const weeksAway = Math.round(gapDays / 7)
  // The working load is where the working sets were done: the load most sets
  // used, the heavier one on a tie. A heavier top set before back-off sets is
  // not what the next session repeats.
  const kg = workingLoad(working.map((s) => s.kg ?? 0), 'heaviest')
  const atLoad = working.filter((s) => (s.kg ?? 0) === kg)
  const hitTop = (s: GymSet) => s.reps >= hi && s.rpe !== undefined && s.rpe <= plan.targetRpe + 0.5
  const singleDose = (s: GymSession) => {
    const logs = s.exercises.filter((log) => log.exerciseId === exerciseId)
    return logs.length === 1 && logs[0].sets.filter((set) => !set.warmup).length === 1 &&
      (logs[0].plannedWorkingSets === 1 || (logs[0].plannedWorkingSets === undefined && s.completion === 'full' && !!logs[0].repRange))
  }
  const single = !stale && !unfinished && atLoad.length === 1 && hitTop(atLoad[0]) && singleDose(last.session)
  const previousSingle = single ? lastPerformance(sessions, exerciseId, location?.id, last.session.startedAt, keep) : null
  const repeatedSingle = Boolean(previousSingle && singleDose(previousSingle.session) &&
    dayKey(previousSingle.session.startedAt) !== dayKey(last.session.startedAt) &&
    last.session.startedAt - previousSingle.session.startedAt <= NO_STEP_UP_DAYS * 86_400_000 &&
    !unfinishedLiftSets(previousSingle.session, exerciseId) && (previousSingle.sets[0].kg ?? 0) === kg && hitTop(previousSingle.sets[0]))
  // A pair of deliberately programmed singles on separate days can establish the
  // same repeatability. Stopping after one of several prescribed sets cannot.
  const allTop = !stale && !unfinished && (atLoad.length >= 2 || repeatedSingle) && atLoad.every(hitTop)
  const anyShort = atLoad.some((s) => s.reps < lo)
  const grinding = atLoad.some((s) => s.rpe !== undefined && s.rpe >= 9.5)
  // No effort was ever logged, so one session at the top of the range proves
  // nothing (it may have been a grind). The same load at the top of the range
  // in two sessions running is repeatable: that earns one step.
  const unratedTwice = (() => {
    if (stale || unfinished || allTop || atLoad.length < 2 || atLoad.some((s) => s.rpe !== undefined) || !atLoad.every((s) => s.reps >= hi)) return false
    const before = lastPerformance(sessions, exerciseId, location?.id, last.session.startedAt, keep)
    if (!before || unfinishedLiftSets(before.session, exerciseId)) return false
    const prior = before.sets.filter((s) => (s.kg ?? 0) === kg)
    return prior.length >= 2 && prior.every((s) => s.reps >= hi && (s.rpe === undefined || s.rpe <= plan.targetRpe + 0.5))
  })()
  const failing = failedWithoutEffort(atLoad, lo)
  const hardMisses = shortAtHighEffort(atLoad, lo, plan.targetRpe)
  const unit = unitFor(ex, location)
  // Two racks with the same nominal increment can include a half-size pair
  // or an extra plate. Compare the next grid stop to weights used here since
  // the equipment setup changed, across lifts using that same implement.
  const adjacent = (value: number, up: boolean) => {
    if (!(step > 0)) return value
    const grid = up ? youthCeiling(value, step, top, min) : stepDownKg(value, step, top, min)
    if (!location || !ex.stepFrom) return grid
    const distance = (weight: number) => up ? weight - value : value - weight
    let closest = grid
    let gap = distance(grid) > 0.001 ? distance(grid) : Infinity
    for (const visit of sessions) {
      if (visit.locationId !== location.id || visit.startedAt >= now || visit.startedAt < (location.fieldTimes?.gear ?? 0)) continue
      for (const row of visit.exercises) {
        if (GYM_EXERCISE_BY_ID[row.exerciseId]?.stepFrom !== ex.stepFrom) continue
        for (const set of row.sets) {
          const weight = set.kg
          if (weight === undefined || set.reps <= 0 || set.at > now || set.unit !== unit ||
            weight < (min ?? 0) || (top !== undefined && weight > top)) continue
          const diff = distance(weight)
          if (diff > 0.001 && diff < gap) { closest = weight; gap = diff }
        }
      }
    }
    return closest
  }
  const reach = (v: number) => {
    // A logged 12.5 kg dumbbell is on this rack even if our default step
    // guesses 2 kg. A changed unit or a new equipment maximum still applies.
    const observed = location?.id === last.session.locationId && (top === undefined || v <= top + 0.001) && (min === undefined || v >= min - 0.001) &&
      working.some((s) => s.kg === v && s.unit === unit)
    return observed ? v : roundToStep(v > 0 ? Math.max(v, min ?? step) : 0, step, top, min)
  }
  const incompleteWhy = unfinished ? `${unfinished} planned ${unfinished === 1 ? 'set of this lift was' : 'sets of this lift were'} unfinished. Repeat the prescription at the same load.` : undefined
  if (ex.assisted) return assistedSuggestion(base, working, lo, hi, plan, step, adjacent, reach, { stale, away, weeksAway, incompleteWhy })
  if (ex.stepFrom === 'sled' && ex.distanceM) {
    const lighten = away || atLoad.some((set) => (set.rpe ?? 0) > plan.targetRpe + 0.5)
    const load = lighten ? adjacent(kg, false) : reach(kg)
    return { ...base, kg: load, targetReps: 1, kind: load < kg ? 'decrease' : 'repeat',
      why: `One smooth ${ex.distanceM} m push per set. ${lighten ? 'Use a lighter load if needed to keep your speed.' : 'Keep the same plates while each push stays quick.'} Rest ${ex.dose!.restSec} seconds between pushes.` }
  }
  if (external && min !== undefined && kg < min - 0.001) return changeLift('Your last working weight is lighter than the first weight listed here.')
  if (ex.load === 'bodyweight' && !(kg > 0)) {
    if (ex.count) return { ...base, kind: 'bodyweight', why: countedWhy(ex, plan, working.map((s) => s.reps)) }
    const reps = atLoad.map((s) => s.reps).sort((a, b) => a - b)
    const typical = reps[Math.floor((reps.length - 1) / 2)]
    const easy = !stale && !unfinished && atLoad.every((s) => s.rpe !== undefined && s.rpe <= plan.targetRpe)
    const targetReps = Math.max(1, Math.min(hi, typical + (easy ? 1 : grinding || away ? -1 : 0)))
    let why = `Last time you did ${atLoad.map((s) => s.reps).join(', ')} reps. Aim for ${targetReps} clean reps per set.${incompleteWhy ? ' ' + incompleteWhy : ''}`
    if (grinding && typical < lo) why += ` Swap to an easier version if you need help reaching ${lo} with reps to spare.`
    if (allTop) why += ' When every set feels controlled, try a harder variation.'
    return { ...base, kind: 'bodyweight', targetReps, why }
  }
  const lower = adjacent(kg, false)
  const atMinimum = external && step > 0 && kg > 0 && (lower <= 0 || lower >= kg - 0.001)
  const lowestReps = Math.min(...atLoad.map((set) => set.reps))
  if (atMinimum && (away || anyShort)) {
    const reserve = Math.max(1, Math.round(10 - plan.targetRpe))
    const controlled = atLoad.every((set) => set.rpe !== undefined && set.rpe <= plan.targetRpe)
    const target = grinding || hardMisses || failing || away ? lowestReps - reserve : lowestReps + (controlled && !unfinished && !stale ? 1 : 0)
    const why = `The next lighter weight is unavailable here. Your shortest set at ${formatLoad(kg, unit)} was ${lowestReps} reps.`
    if (target < Math.min(lo, youth ? YOUTH_REP_FLOOR : 5)) return changeLift(why)
    const targetReps = Math.max(1, Math.min(lo, target))
    return { ...base, kind: 'at-minimum-weight', kg, targetReps, ...(easier ? { easierId: easier } : {}),
      why: `${why} Aim for ${targetReps} with reps in reserve. Switch exercises if that feels too hard.` }
  }
  if (away && step > 0 && kg > 0) {
    return {
      ...base,
      kg: lower,
      kind: 'decrease',
      why: `First time in ${weeksAway} weeks: a step lighter, then build back.`,
    }
  }
  const wantsUp = (allTop || unratedTwice) && step > 0
  const here = reach(kg)
  const next = adjacent(kg, true)
  if (step > 0 && top !== undefined && next <= kg + 0.001 && lowestReps >= hi) {
    const ceiling = hi + 5
    const targetReps = Math.max(lo, Math.min(ceiling, lowestReps + (wantsUp ? 1 : grinding ? -1 : 0)))
    const cue = targetReps === ceiling ? 'When this stays comfortable, try a harder variation.' : 'Keep the same weight and leave reps in reserve.'
    return { ...base, kg: here, targetReps, kind: 'at-top-weight',
      why: `This is the heaviest weight here. Aim for ${targetReps} reps per set. ${incompleteWhy ?? cue}` }
  }
  // A step that fell short lately is not tried again on the same evidence: the sets that earned it last time did
  // not hold at the heavier load. Reps past the top of the range are the proof that there is room (double
  // progression, CONSENSUS; the extra bar is the app's own rule, not a measured one).
  const failedSteps = wantsUp ? failedStepsAbove(sessions, exerciseId, location?.id, kg, last.session, lo, plan.targetRpe, keep) : 0
  const retryBar = hi + FAILED_STEP_EXTRA_REPS * Math.min(failedSteps, FAILED_STEP_CAP)
  // Under 18 a step that is a large share of the load is earned with reps first, however the equipment is graded.
  const youthNext = youth && wantsUp && kg > 0 ? next : 0
  const bigYouthStep = youthNext > kg && (youthNext - kg) / kg > YOUTH_LARGE_STEP_SHARE + 1e-9
  const bigBar = bigYouthStep ? hi + YOUTH_LARGE_STEP_EXTRA_REPS : hi
  // ...or by the same load at the top of the range at the target effort in two sessions running (the load held until it is easy).
  const topTwice = (() => {
    if (!bigYouthStep || !allTop) return false
    const before = lastPerformance(sessions, exerciseId, location?.id, last.session.startedAt, keep)
    const prior = before && !unfinishedLiftSets(before.session, exerciseId) ? before.sets.filter((s) => (s.kg ?? 0) === kg) : []
    return (prior.length >= 2 || repeatedSingle) && prior.every(hitTop)
  })()
  const moveUpBar = Math.max(failedSteps > 0 ? retryBar : hi, bigBar)
  const bigHeld = bigYouthStep && !topTwice
  const heldBack = (failedSteps > 0 || bigHeld) && !atLoad.every((s) => s.reps >= moveUpBar)
  if ((allTop || unratedTwice) && step > 0 && !heldBack) {
    // Sets that blew well past the range at an easy effort earn two steps —
    // for an adult. Under 18 a jump is always the smallest step there is.
    const easy = atLoad.length >= 2 && !unratedTwice && atLoad.every((s) => s.reps >= hi + 3 && s.rpe !== undefined && s.rpe <= 7)
    const twoSteps = !youth && easy && failedSteps === 0 ? adjacent(next, true) : next
    // Under 18 a jump is one step of the unit in use from the load that was really lifted: rounding that load to
    // the grid first (20 kg is 44.1 lb, which became 45) and adding a step landed 2.68 kg up against a 2.27 kg step.
    const jump = youth ? Math.min(twoSteps, youthCeiling(kg, step, top, min)) : twoSteps
    // Only a real step is "up one step". When the grid has nothing between last time's load and one step above it
    // but a load barely heavier (22.5 kg dumbbells at a place now counted in pounds: 50 lb is +0.18 kg), it is the
    // nearest load, not a step — said as such below.
    const smallerStep = youth && here === kg && jump > kg && jump - kg < step / 2 - 1e-9
    const realStep = !youth || smallerStep || jump - kg >= step / 2 - 1e-9
    if (realStep) {
      return {
        ...base,
        kg: jump,
        kind: 'increase',
        why:
          repeatedSingle ? `Your single prescribed set reached ${hi} at target effort on two visits. Try the next available load.`
            : smallerStep
            ? `Every set reached ${hi}. Try the next small increase available here, up to ${formatLoad(jump, unit)}.`
            : twoSteps > next
            ? `Every set went well past ${hi} at an easy effort last time: up two steps.`
            : unratedTwice
              ? `Every set reached ${hi} in your last two sessions at this weight (no effort logged, so two in a row stands in for it): up one step.`
              : `Every set reached ${hi} at the target effort last time: up one step.`,
      }
    }
  }
  if (anyShort && grinding && step > 0) {
    return { ...base, kg: lower, kind: 'decrease', why: `Last time fell short of ${lo} reps at a near-max effort: one step lighter, then build back.` }
  }
  if (failing && step > 0 && kg > 0) {
    return { ...base, kg: lower, kind: 'decrease', why: `Half the sets fell short of ${lo} reps and no effort was logged: one step lighter, then build back.` }
  }
  if (hardMisses && step > 0 && kg > 0) {
    return { ...base, kg: lower, kind: 'decrease', why: `Several sets fell below ${lo} reps above your target effort of RPE ${plan.targetRpe}. Use the next lighter weight.` }
  }
  const repeatKg = reach(kg)
  const reps = atLoad.map((s) => s.reps).join(', ')
  if (single && !allTop && !away && repeatKg === kg) return { ...base, kg: repeatKg, kind: 'repeat', targetReps: hi,
    why: `You completed the single prescribed set. Repeat ${hi} at the same weight and effort on a second visit to earn a step.` }
  if (heldBack) {
    return {
      ...base,
      kg: repeatKg,
      kind: 'repeat',
      repsToMoveUp: moveUpBar,
      why:
        failedSteps > 0
          ? `Every set reached ${hi}, but a heavier weight than this fell short of ${lo} reps lately: stay here until every set reaches ${moveUpBar} reps, then try the step again (the app's own rule on top of double progression, a coaching convention).`
          : `Every set reached ${hi}, but the next step here is more than a quarter of this weight: stay until every set reaches ${moveUpBar} reps, or every set reaches ${hi} again next time, then step up (the app's own rule for under 18s on top of double progression, a coaching convention; the quarter is a design choice).`,
    }
  }
  // This place's steps may not reach last time's exact load (a unit change, other plates): say so.
  if (kg > 0 && Math.abs(repeatKg - kg) > 0.01) {
    const there = formatLoad(kg, atLoad[0]?.unit ?? unitFor(ex, location))
    const grown = (allTop || unratedTwice) && repeatKg > kg
    return {
      ...base,
      kg: repeatKg,
      kind: 'repeat',
      nearestTo: kg,
      why: `Nearest load here to last time’s ${there}${grown ? ' (not a step up: the next real step is further than an under-18 jump allows)' : ''}: aim to add a rep to last time’s ${reps}.`,
    }
  }
  return { ...base, kg: repeatKg, kind: 'repeat', why: incompleteWhy ?? `Same weight: aim to add a rep to last time’s ${reps}.` }
}

/**
 * Double progression with the direction turned round: the logged weight is
 * help, so every set at the top of the range takes one step of help off
 * (never two — the last steps are the hard ones), and falling short at a
 * near-max effort puts one back.
 */
function assistedSuggestion(
  base: { reps: [number, number]; targetRpe: number },
  working: GymSet[],
  lo: number,
  hi: number,
  plan: RepPlan,
  step: number,
  adjacent: (kg: number, up: boolean) => number,
  repeatLoad: (value: number) => number,
  gap: { stale: boolean; away: boolean; weeksAway: number; incompleteWhy?: string },
): LoadSuggestion {
  const help = workingLoad(working.map((s) => s.kg ?? 0), 'lightest')
  const atHelp = working.filter((s) => (s.kg ?? 0) === help)
  if (gap.away && step > 0) {
    return { ...base, kg: adjacent(help, true), kind: 'decrease', why: `First time in ${gap.weeksAway} weeks: a step more help, then build back.` }
  }
  const allTop = !gap.stale && !gap.incompleteWhy && atHelp.length >= 2 && atHelp.every((s) => s.reps >= hi && s.rpe !== undefined && s.rpe <= plan.targetRpe + 0.5)
  const anyShort = atHelp.some((s) => s.reps < lo)
  const grinding = atHelp.some((s) => s.rpe !== undefined && s.rpe >= 9.5)
  if (allTop) {
    if (help === 0) {
      return { ...base, kg: 0, kind: 'at-top-weight', why: `Every set reached ${hi} with no help: time for the unassisted version.` }
    }
    if (step <= 0) return { ...base, kg: help, kind: 'repeat', why: 'You reached the top of the range. Use a smaller amount of assistance when your machine allows it.' }
    const next = adjacent(help, false)
    return {
      ...base,
      kg: next,
      kind: 'increase',
      why:
        next > 0
          ? `Every set reached ${hi} at the target effort last time: one step less help.`
          : `Every set reached ${hi} with one step of help left: try it with none, or with the lightest band.`,
    }
  }
  if (anyShort && grinding && step > 0) {
    return { ...base, kg: adjacent(help, true), kind: 'decrease', why: `Last time fell short of ${lo} reps at a near-max effort: one step more help, then build back.` }
  }
  if (failedWithoutEffort(atHelp, lo) && step > 0) {
    return { ...base, kg: adjacent(help, true), kind: 'decrease', why: `Half the sets fell short of ${lo} reps and no effort was logged: one step more help, then build back.` }
  }
  if (shortAtHighEffort(atHelp, lo, plan.targetRpe) && step > 0) {
    return { ...base, kg: adjacent(help, true), kind: 'decrease', why: `Several sets fell below ${lo} reps above RPE ${plan.targetRpe}. Use one more step of assistance.` }
  }
  return { ...base, kg: repeatLoad(help), kind: 'repeat', why: gap.incompleteWhy ?? `Aim to add a rep to last time’s ${atHelp.map((s) => s.reps).join(', ')} with this assistance.` }
}

export interface GymRecord {
  exerciseId: string
  /** Best estimated one-rep max, with the set it came from. */
  bestE1rm?: { kg: number; at: number; locationId: string; set: GymSet }
  /**
   * How many sessions gave an estimate in the same comparison as `bestE1rm` (the same place for a machine). One
   * session is a first estimate, not a trend: screens say so until a second session backs it.
   */
  e1rmSessions?: number
  /** Heaviest working load moved for at least one rep (never for an assisted movement, where the weight is help). */
  heaviest?: { kg: number; reps: number; at: number }
  /** Most reps in one working set (bodyweight work). */
  mostReps?: { reps: number; kg?: number; at: number }
  /** Longest hold in one working set, for movements counted in seconds (older logs kept seconds in `reps`). */
  longestHold?: { sec: number; at: number }
}

/** What every screen says beside an estimated max that rests on a single session. */
export const FIRST_ESTIMATE_NOTE = 'first estimate, one session'

/** Whether a record's estimated max is only a first estimate: fewer than two sessions of the lift gave one. */
export function isFirstEstimate(rec: Pick<GymRecord, 'e1rmSessions'> | undefined): boolean {
  return (rec?.e1rmSessions ?? 0) < 2
}

/** Records per exercise, derived by replaying history — never stored, never edited. */
export function gymRecords(sessions: GymSession[], locationId?: string): Record<string, GymRecord> {
  const out: Record<string, GymRecord> = {}
  const ordered = [...sessions].sort((a, b) => a.startedAt - b.startedAt)
  // A machine's estimate is only comparable inside one place: the record is the one at the place it was last used.
  const lastPlace = new Map<string, string>()
  for (const s of ordered) for (const log of s.exercises) if (log.sets.some((x) => !x.warmup && x.reps > 0)) lastPlace.set(log.exerciseId, s.locationId)
  for (const s of ordered) {
    const estimated = new Set<string>()
    for (const log of s.exercises) {
      const rec = (out[log.exerciseId] ??= { exerciseId: log.exerciseId })
      const assisted = Boolean(GYM_EXERCISE_BY_ID[log.exerciseId]?.assisted)
      const sameBar = maxKey(log.exerciseId, s.locationId) === log.exerciseId || (locationId ?? lastPlace.get(log.exerciseId)) === s.locationId
      for (const set of log.sets) {
        if (set.warmup || !(set.reps > 0)) continue
        const e = sameBar ? estimateOneRepMax(set, log.exerciseId) : null
        if (e !== null) estimated.add(log.exerciseId)
        if (e !== null && (!rec.bestE1rm || e > rec.bestE1rm.kg)) rec.bestE1rm = { kg: e, at: set.at, locationId: s.locationId, set }
        // The heaviest load follows the same rule as the estimate: a machine's weight stack is only comparable inside
        // one place, so another gym's machine never sets this one's heaviest.
        if (!assisted && sameBar && set.kg !== undefined && set.kg > 0 && (!rec.heaviest || set.kg > rec.heaviest.kg)) {
          rec.heaviest = { kg: set.kg, reps: set.reps, at: set.at }
        }
        if (GYM_EXERCISE_BY_ID[log.exerciseId]?.count === 'seconds' && (!rec.longestHold || set.reps > rec.longestHold.sec)) {
          rec.longestHold = { sec: set.reps, at: set.at }
        }
        if (!rec.mostReps || set.reps > rec.mostReps.reps) rec.mostReps = { reps: set.reps, ...(set.kg ? { kg: set.kg } : {}), at: set.at }
      }
    }
    for (const id of estimated) out[id].e1rmSessions = (out[id].e1rmSessions ?? 0) + 1
  }
  return out
}

// ---- Is a lift still moving? (CONSENSUS: "no new best in three sessions") ----

export interface LiftTrend {
  /** Unknown is the honest answer for too few sessions, a lift not done lately, or work with no comparable number. */
  status: 'progressing' | 'stalled' | 'unknown'
  /** Sessions read, each by its best working set. */
  sessions: number
}

const TREND_WINDOW_DAYS = 56
/** Three sessions without a new best, after at least one that set the bar. */
export const STALL_SESSIONS = 3
/** A stall is about now: a lift last done longer ago than this says nothing about today. */
const STALL_CURRENT_DAYS = 21

/**
 * Whether a lift is still progressing, from each session's best working set
 * over the last eight weeks: the estimated max for loaded sets, the most reps
 * for bodyweight ones. Stalled means the latest three sessions all failed to
 * beat the best before them, unless those three rose one after another (an
 * old lucky high is not a stall). A coaching reading, not a measurement — and
 * never about fatigue or anything else it cannot see.
 */
export function liftTrend(sessions: GymSession[], exerciseId: string, now: number, locationId?: string): LiftTrend {
  const ex = GYM_EXERCISE_BY_ID[exerciseId]
  if (!ex || ex.assisted || ex.count || ex.explosive || ex.dose) return { status: 'unknown', sessions: 0 }
  const from = now - TREND_WINDOW_DAYS * 86_400_000
  const points: { at: number; value: number; kind: 'e1rm' | 'reps' }[] = []
  const machinePlace = ex.load === 'machine' || ex.load === 'cable'
    ? locationId ?? lastPerformance(sessions, exerciseId, undefined, now)?.session.locationId
    : undefined
  for (const s of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    if (s.startedAt >= now || s.startedAt < from) continue
    if (machinePlace !== undefined && s.locationId !== machinePlace) continue
    const sets = s.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter((x) => !x.warmup && x.reps > 0))
    if (!sets.length) continue
    const e1rm = Math.max(-1, ...sets.map((x) => estimateOneRepMax(x, exerciseId) ?? -1))
    if (e1rm > 0) points.push({ at: s.startedAt, value: e1rm, kind: 'e1rm' })
    else if (ex.load === 'bodyweight' && sets.every((x) => !(x.kg && x.kg > 0))) points.push({ at: s.startedAt, value: Math.max(...sets.map((x) => x.reps)), kind: 'reps' })
  }
  // One kind of number only: the latest session's.
  const kind = points[points.length - 1]?.kind
  const series = points.filter((p) => p.kind === kind)
  if (series.length < STALL_SESSIONS + 1) return { status: 'unknown', sessions: series.length }
  if (now - series[series.length - 1].at > STALL_CURRENT_DAYS * 86_400_000) return { status: 'unknown', sessions: series.length }
  const recent = series.slice(-STALL_SESSIONS).map((p) => p.value)
  const before = Math.max(...series.slice(0, -STALL_SESSIONS).map((p) => p.value))
  const rising = recent.every((v, i) => i === 0 || v > recent[i - 1] + 1e-6)
  const stalled = !rising && Math.max(...recent) <= before + 1e-6
  return { status: stalled ? 'stalled' : 'progressing', sessions: series.length }
}

// ---- Progression gate for speed and power work (CONSENSUS) ----

const MIN_SESSIONS_YOUTH = 2
const MIN_SESSIONS_ADULT = 1

/** The tier an exercise is gated at: maximal runs count as high whatever their listed tier. */
export function gateTier(ex: GymExercise): IntensityTier | null {
  if (!athleticDomain(ex)) return null
  return ex.maximal ? 'high' : (ex.tier ?? null)
}

/** Count recent, separate practice dates at the prescribed dose. A hard or partial attempt is still in history. */
export function tierSessions(sessions: GymSession[], domain: AthleticDomain, now = Infinity): Record<IntensityTier, number> {
  const dates = { low: new Set<string>(), medium: new Set<string>(), high: new Set<string>() }
  const today = Number.isFinite(now) ? new Date(now).setHours(0, 0, 0, 0) : Infinity
  const from = Number.isFinite(now) ? addDays(today, -84) : -Infinity
  for (const s of sessions) {
    if (s.startedAt >= today || s.endedAt >= today || s.endedAt < from) continue
    for (const log of s.exercises) {
      const ex = GYM_EXERCISE_BY_ID[log.exerciseId]
      if (!ex?.dose || athleticDomain(ex) !== domain || !ex.tier || unfinishedLiftSets(s, ex.id)) continue
      const tier = gateTier(ex)!
      // A medium coordination drill can prepare the warm-up. High-speed running needs actual runs.
      if (domain === 'sprint' && tier === 'medium' && ex.pattern !== 'sprint') continue
      const work = log.sets.filter((set) => !set.warmup && set.at >= from && set.at < today && set.at <= s.endedAt)
      const effort = Math.min(8.5, ex.dose.rpe + 1)
      if (work.length < 2 || !work.some((set) => set.rpe !== undefined) ||
          work.some((set) => set.reps < ex.dose!.range[0] || (set.rpe !== undefined && set.rpe > effort))) continue
      dates[tier].add(dayKey(Math.max(...work.map((set) => set.at))))
    }
  }
  return { low: dates.low.size, medium: dates.medium.size, high: dates.high.size }
}

/**
 * The highest tier of one domain this athlete may be given, from what they
 * have logged. Under 18: low always; medium after two sessions of low work;
 * high after two sessions of medium work (and some low). An adult starts at
 * medium, and gets high after a completed medium-tier practice day. A coaching
 * ladder (CONSENSUS), not a measured threshold.
 */
export function unlockedTier(sessions: GymSession[], domain: AthleticDomain, youth: boolean, now = Infinity): IntensityTier {
  const c = tierSessions(sessions, domain, now)
  if (youth) {
    if (c.low >= MIN_SESSIONS_YOUTH && c.medium >= MIN_SESSIONS_YOUTH) return 'high'
    if (c.low >= MIN_SESSIONS_YOUTH) return 'medium'
    return 'low'
  }
  return c.medium >= MIN_SESSIONS_ADULT ? 'high' : 'medium'
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
    reason: `Build up with ${need}-tier ${domain === 'sprint' ? 'running' : domain} work on ${n} earlier training ${n === 1 ? 'day' : 'days'} within 12 weeks. Complete at least two working sets at the prescribed count and log how hard they felt. Progress when the sets feel manageable.`,
  }
}

const TIER_RANK: Record<IntensityTier, number> = { low: 0, medium: 1, high: 2 }
export { TIER_RANK }
