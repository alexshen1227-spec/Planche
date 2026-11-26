import { GYM_EQUIPMENT, type Joint, type Muscle, type Pattern } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID, type LocationEquipment } from '../../data/gym/exercises'
import { LIGHT_PRESS_SPARE } from '../plan/load'
import { steerInput } from '../plan/screens'
import { availableAt } from './availability'
import type { BodyweightCapacity } from './bodyweight'
import { buildGymSession, type GymFocus } from './builder'
import type { GymInput } from './planInvariants'
import type { GoalWeights, GymLocation, GymSession, GymSet, Rating } from './types'

/**
 * Generated athletes for the generator's stress test: every focus, time, place, priority, steer, exclusion, light and
 * hard day, opener warm-up and history the app can hand the builder, mixed by a seeded generator so a failure can be
 * rebuilt from its seed. Histories are closed-loop — the builder's own sessions, logged back as done — so rotation,
 * stalls, the chin-up rotation, the speed ladder and practice doses all see the kind of history they read in the app.
 */

export const STRESS_NOW = new Date(2026, 10, 25, 17).getTime()
const DAY = 86_400_000

export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T,>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]
const some = <T,>(r: () => number, list: readonly T[], most: number): T[] => {
  const n = Math.floor(r() * (most + 1))
  return [...new Set(Array.from({ length: n }, () => pick(r, list)))]
}

const place = (id: string, equipment: LocationEquipment[]): GymLocation => ({ id, name: id, unit: 'kg', updatedAt: 1, equipment })
export const PLACES: Record<string, GymLocation> = {
  bare: place('bare', []),
  home: place('home', ['floor', 'dumbbells', 'incline-bench', 'pullup-bar']),
  homeBand: place('homeBand', ['floor', 'dumbbells', 'incline-bench', 'pullup-bar', 'band']),
  cali: place('cali', ['floor', 'parallettes', 'band', 'pullup-bar', 'rings', 'dip-bars', 'box', 'wall']),
  hotel: place('hotel', ['dumbbells', 'bench']),
  gym: place('gym', ['barbell', 'squat-rack', 'bench', 'incline-bench', 'dumbbells', 'cable', 'lat-pulldown', 'cable-row', 'pullup-bar', 'dip-bars',
    'leg-press', 'leg-curl', 'leg-extension', 'calf-machine', 'pec-deck', 'box', 'track']),
  everything: place('everything', [...GYM_EQUIPMENT.map((e) => e.id), 'parallettes', 'band', 'pullup-bar', 'rings', 'dip-bars', 'box', 'wall', 'pole']),
}

export const GOALS: Record<string, GoalWeights | undefined> = {
  mixed: { skills: 3, physique: 5, strength: 3, power: 0, endurance: 0 },
  strength: { skills: 0, physique: 2, strength: 5, power: 0, endurance: 0 },
  power: { skills: 2, physique: 2, strength: 3, power: 4, endurance: 0 },
  endurance: { skills: 0, physique: 1, strength: 1, power: 0, endurance: 5 },
  skills: { skills: 5, physique: 1, strength: 2, power: 0, endurance: 0 },
  none: undefined,
}

const MUSCLES: Muscle[] = ['chest', 'chest-upper', 'front-delts', 'side-delts', 'rear-delts', 'triceps', 'triceps-long', 'biceps', 'forearms', 'lats',
  'upper-back', 'traps', 'lower-back', 'abs', 'obliques', 'hip-flexors', 'glutes', 'quads', 'hamstrings', 'adductors', 'calves', 'tibialis-anterior']
const JOINTS: Joint[] = ['wrists', 'elbows', 'shoulders', 'lower-back', 'knees', 'hips', 'ankles']
const OWN: Muscle[][] = [[], [], ['chest', 'chest-upper', 'side-delts'], ['biceps'], ['abs'], ['lats', 'biceps'], ['hamstrings'], ['calves'], ['side-delts'],
  ['rear-delts'], ['triceps'], ['quads', 'glutes'], ['traps'], ['forearms'], ['chest']]
const WEEKLY: Muscle[][] = [[], [], ['chest', 'lats'], ['side-delts', 'rear-delts'], ['hamstrings', 'quads'], ['lats'], ['chest']]
const SPARE: Muscle[][] = [[], [], [], [...LIGHT_PRESS_SPARE], [...LIGHT_PRESS_SPARE], ['upper-back'], ['chest'], ['quads', 'glutes'], ['biceps'],
  [...LIGHT_PRESS_SPARE, 'chest'], ['upper-back', 'rear-delts']]
const OFF: Muscle[][] = [[], [], [], ['quads', 'glutes', 'hamstrings'], ['biceps'], ['chest', 'chest-upper'], ['abs'], ['lower-back'], ['calves']]
const JOINT_SETS: Joint[][] = [[], [], [], ['shoulders'], ['elbows'], ['wrists'], ['knees'], ['lower-back'], ['ankles'], ['hips'], ['shoulders', 'elbows']]
export const FOCI: (GymFocus | undefined)[] = ['full', 'upper', 'lower', 'push', 'pull', 'athletic', undefined]
export const MINUTES = [15, 20, 25, 30, 35, 45, 60, 75, 90, 120]
export const FACTORS = [0.6, 0.7, 0.8, 1, 1, 1, 1.2]

const CAPACITIES: Record<string, BodyweightCapacity | undefined> = {
  none: undefined,
  beginner: { base: { pushups: 3, pullups: 0, dips: 0 }, practiced: new Map() },
  intermediate: { base: { pushups: 15, pullups: 6, dips: 8 }, practiced: new Map() },
  strong: { base: { pushups: 40, pullups: 15, dips: 20 }, practiced: new Map([['pull-up', 12], ['dip', 15]]) },
  buildingPullups: { base: { pullups: 3, pushups: 15 }, practiced: new Map(), reportedPullups: 3 },
  firstPullup: { base: { pullups: 0, pushups: 10 }, practiced: new Map(), tryPullup: true },
  introductory: { base: { pushups: 5, pullups: 0 }, practiced: new Map(), introductory: true, introductoryVisitsLeft: 2 },
  buildUp: { base: { pushups: 12, pullups: 4 }, practiced: new Map(), buildUpSetLimit: 10 },
}

/** A load to log for a movement with no suggestion yet: something plausible for its kind. */
const firstLoad: Record<string, number> = { barbell: 40, dumbbell: 12, kettlebell: 12, machine: 35, cable: 15 }

/**
 * A closed-loop history: `count` sessions before `end`, each built by the builder from the history so far and logged
 * as done. `stall` logs every lift at the same load and reps, so lifts stop beating their best.
 */
export function simulateHistory(opts: {
  location: GymLocation
  youth: boolean
  goals?: GoalWeights
  count: number
  end: number
  seed: number
  stall?: boolean
  foci?: GymFocus[]
  ratings?: Record<string, Rating>
}): GymSession[] {
  const r = rng(opts.seed)
  let sessions: GymSession[] = []
  let t = opts.end - opts.count * 2.5 * DAY
  const loads = new Map<string, number>()
  for (let k = 0; k < opts.count; k++) {
    t += Math.round((2 + r()) * DAY / 3_600_000) * 3_600_000
    if (t >= opts.end - 3_600_000) break
    const focus = opts.foci ? opts.foci[k % opts.foci.length] : undefined
    const plan = buildGymSession({ location: opts.location, minutes: pick(r, [30, 45, 60]), focus, sessions, youth: opts.youth, goals: opts.goals,
      ratings: opts.ratings, now: t })
    let clock = t
    const exercises = plan.items.map((it) => {
      const e = GYM_EXERCISE_BY_ID[it.exerciseId]
      const [lo, hi] = it.plan.range
      const loaded = e.load !== 'bodyweight' || e.assisted
      const prior = loads.get(e.id)
      const kg = loaded ? (opts.stall && prior !== undefined ? prior : it.suggestion.kg ?? prior ?? (e.assisted ? 25 : firstLoad[e.load] ?? 20)) : undefined
      if (kg !== undefined) loads.set(e.id, kg)
      const sets: GymSet[] = []
      for (let s = 0; s < it.sets; s++) {
        clock += 150_000
        const reps = opts.stall ? lo : Math.max(lo, Math.min(hi, (it.suggestion.targetReps ?? hi) - (r() < 0.3 ? 1 : 0)))
        sets.push({ at: clock, reps, rpe: Math.min(10, it.plan.targetRpe + (r() < 0.5 ? 0 : 0.5)), ...(kg !== undefined ? { kg, unit: 'kg' as const } : {}) })
      }
      return { exerciseId: it.exerciseId, sets, repRange: [lo, hi] as [number, number], targetRpe: it.plan.targetRpe, plannedWorkingSets: it.sets }
    })
    if (!exercises.length) continue
    sessions = [...sessions, { id: `h${opts.seed}-${k}`, locationId: opts.location.id, startedAt: t, endedAt: clock + 60_000, name: plan.name, exercises, completion: 'full' }]
  }
  return sessions
}

const histories = new Map<string, GymSession[]>()
function historyFor(kind: string, location: GymLocation, youth: boolean, goalsKey: string, seed: number): GymSession[] {
  if (kind === 'empty') return []
  const key = `${kind}|${location.id}|${youth}|${goalsKey}|${seed % 3}`
  let h = histories.get(key)
  if (!h) {
    // The history's own seed comes from its key, so a case rebuilt alone gets the history it had in the sweep.
    seed = 1 + (seed % 3) + 10 * ['short', 'long', 'split', 'stall'].indexOf(kind)
    const goals = GOALS[goalsKey]
    h = kind === 'short' ? simulateHistory({ location, youth, goals, count: 4, end: STRESS_NOW, seed })
      : kind === 'long' ? simulateHistory({ location, youth, goals, count: 24, end: STRESS_NOW, seed })
      : kind === 'split' ? simulateHistory({ location, youth, goals, count: 16, end: STRESS_NOW, seed, foci: ['push', 'pull', 'lower'] })
      : simulateHistory({ location, youth, goals, count: 14, end: STRESS_NOW, seed, stall: true, foci: ['pull', 'push', 'lower', 'upper'] })
    histories.set(key, h)
  }
  return h
}

/** Ratings for a place: a few random marks, or every movement of one pattern but one avoided. */
function ratingsFor(r: () => number, location: GymLocation): Record<string, Rating> | undefined {
  const here = availableAt(location)
  const roll = r()
  if (roll < 0.45 || !here.length) return undefined
  const out: Record<string, Rating> = {}
  if (roll < 0.8) {
    for (let i = 0; i < 12; i++) out[pick(r, here).id] = pick(r, ['love', 'like', 'fine', 'dislike', 'avoid'] as Rating[])
    return out
  }
  const patterns = [...new Set(here.map((e) => e.pattern))] as Pattern[]
  const pattern = pick(r, patterns)
  const ofIt = here.filter((e) => e.pattern === pattern)
  const keep = r() < 0.5 ? pick(r, ofIt).id : undefined
  for (const e of ofIt) if (e.id !== keep) out[e.id] = 'avoid'
  return out
}

export interface StressCase {
  seed: number
  input: GymInput
  /** Short words for the case, to read a failure without rebuilding it. */
  tags: string
}

/** One generated request: every dimension drawn from the seed. */
export function stressCase(seed: number, fixed: Partial<{ focus: GymFocus | undefined; minutes: number; place: string; factor: number }> = {}): StressCase {
  const r = rng(seed * 7919 + 13)
  const placeKey = fixed.place ?? pick(r, Object.keys(PLACES))
  let location = PLACES[placeKey]
  if (r() < 0.15) {
    const here = availableAt(location)
    if (here.length) location = { ...location, hardHere: some(r, here.map((e) => e.id), 4) }
  }
  const youth = r() < 0.45
  const goalsKey = pick(r, Object.keys(GOALS))
  const historyKind = pick(r, ['empty', 'empty', 'short', 'long', 'split', 'stall'])
  const sessions = historyFor(historyKind, PLACES[placeKey], youth, goalsKey, seed)
  const focus = 'focus' in fixed ? fixed.focus : pick(r, FOCI)
  const minutes = fixed.minutes ?? pick(r, MINUTES)
  const factor = fixed.factor ?? pick(r, FACTORS)
  const own = r() < 0.15 ? some(r, MUSCLES, 3) : pick(r, OWN)
  const weekly = r() < 0.1 ? some(r, MUSCLES, 2) : pick(r, WEEKLY)
  const spare = r() < 0.1 ? some(r, MUSCLES, 3) : pick(r, SPARE)
  const musclesOff = r() < 0.08 ? some(r, MUSCLES, 2) : pick(r, OFF)
  const avoidJoints = r() < 0.08 ? some(r, JOINTS, 2) : pick(r, JOINT_SETS)
  const capKey = pick(r, Object.keys(CAPACITIES))
  const capacity = CAPACITIES[capKey]
  const ratings = ratingsFor(r, location)
  const warmUpMin = r() < 0.25 ? 2 : undefined
  const favoriteAt = r() < 0.15 && availableAt(location).length ? { [pick(r, availableAt(location)).id]: location.id } : undefined
  const now = STRESS_NOW + Math.floor(r() * 6) * 3_600_000
  const input: GymInput = {
    location,
    minutes,
    ...(focus ? { focus } : {}),
    sessions,
    youth,
    ...(GOALS[goalsKey] ? { goals: GOALS[goalsKey] } : {}),
    ...(capacity ? { capacity } : {}),
    ...(ratings ? { ratings } : {}),
    ...(musclesOff.length ? { musclesOff } : {}),
    ...(avoidJoints.length ? { avoidJoints } : {}),
    ...(factor !== 1 ? { volumeFactor: factor } : {}),
    ...(warmUpMin !== undefined ? { warmUpMin } : {}),
    ...(favoriteAt ? { favoriteAt } : {}),
    ...steerInput({ priority: weekly, spare }, own),
    now,
  }
  const tags = [focus ?? 'auto', `${minutes}m`, placeKey, youth ? 'teen' : 'adult', goalsKey, historyKind, `x${factor}`, capKey,
    own.length ? `own:${own.join('+')}` : '', weekly.length ? `week:${weekly.join('+')}` : '', spare.length ? `spare:${spare.join('+')}` : '',
    musclesOff.length ? `off:${musclesOff.join('+')}` : '', avoidJoints.length ? `joints:${avoidJoints.join('+')}` : '', ratings ? 'rated' : '',
    warmUpMin !== undefined ? 'after-opener' : ''].filter(Boolean).join(' ')
  return { seed, input, tags }
}

/** The structured matrix: every focus × time × place × day factor once, the other dimensions drawn from the seed. */
export const MATRIX_FACTORS = [0.6, 0.8, 1, 1.2]
export const MATRIX_SIZE = FOCI.length * MINUTES.length * Object.keys(PLACES).length * MATRIX_FACTORS.length
export function matrixCase(index: number): StressCase {
  const places = Object.keys(PLACES)
  let i = index
  const factor = MATRIX_FACTORS[i % MATRIX_FACTORS.length]; i = Math.floor(i / MATRIX_FACTORS.length)
  const placeKey = places[i % places.length]; i = Math.floor(i / places.length)
  const minutes = MINUTES[i % MINUTES.length]; i = Math.floor(i / MINUTES.length)
  const focus = FOCI[i % FOCI.length]
  return stressCase(index + 1, { focus, minutes, place: placeKey, factor })
}
/** Seeds below `RANDOM_SEED_BASE` are matrix cells; the rest draw every dimension. */
export const RANDOM_SEED_BASE = 100_000
export function caseFor(seed: number): StressCase {
  return seed < RANDOM_SEED_BASE ? { ...matrixCase(seed - 1), seed } : stressCase(seed)
}
