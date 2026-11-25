import { type Joint, type Muscle, type Pattern } from '../../data/gym/catalog'
import { addDays, dayKey, weekStart } from '../time'
import { athleticDomain, GYM_EXERCISE_BY_ID, jointsToRest, volumeShare, type AthleticDomain, type GymExercise, type IntensityTier } from '../../data/gym/exercises'
import { availableAt, canDoHere, preferenceRank } from './availability'
import { hasBodyweightGate, readyForBodyweight, type BodyweightCapacity } from './bodyweight'
import { legPracticeAt, LEG_VARIATIONS, preparesFor, unassistedDose, UNASSISTED_LIFTS } from './bodyweightSteps'
import { canPairExercises, savedPairSeconds } from './pairedSets'
import { gateTier, isHardBodyweight, liftTrend, plyoGate, repPlanFor, STALL_SESSIONS, suggestLoad, TIER_RANK, type LoadSuggestion, type RepPlan } from './progression'
import type { GoalWeights, GymLocation, GymSession, Rating } from './types'
import { fitsGymFocus, FOCUS_LABEL, muscleFitsGymFocus, type GymFocus } from './focus'
export { FOCUS_LABEL, type GymFocus } from './focus'

/**
 * Slots in priority order: the first ones are the session, the last ones are
 * what a short session gives up first. Each slot is filled by one movement
 * from its patterns that can be done at the location.
 */
const SLOTS: Record<Exclude<GymFocus, 'athletic'>, Pattern[][]> = {
  full: [
    ['squat', 'lunge'],
    ['horizontal-press', 'incline-press', 'dip'],
    ['vertical-pull', 'horizontal-pull'],
    ['hinge'],
    ['horizontal-pull', 'vertical-pull'],
    ['lateral-raise'],
    ['triceps', 'biceps'],
    ['core-flexion', 'core-anti-rotation'],
  ],
  upper: [
    ['incline-press', 'horizontal-press'],
    ['vertical-pull'],
    ['horizontal-press', 'dip', 'vertical-press'],
    ['horizontal-pull'],
    ['lateral-raise'],
    ['triceps'],
    ['biceps'],
    ['rear-delt'],
  ],
  lower: [['squat'], ['hinge'], ['lunge'], ['knee-flexion'], ['knee-extension'], ['calf'], ['core-flexion', 'core-anti-rotation']],
  push: [['horizontal-press', 'incline-press'], ['vertical-press'], ['incline-press', 'dip'], ['lateral-raise'], ['triceps'], ['chest-fly']],
  pull: [['vertical-pull'], ['horizontal-pull'], ['straight-arm-pull'], ['rear-delt'], ['biceps'], ['core-flexion']],
}

/**
 * The movements a gym day is named for: a push day presses, a pull day pulls,
 * a lower day squats, lunges or hinges. Steering a day off a muscle the week
 * already has plenty of (`spare`) may change which of them go in and how many
 * sets, never take them all out.
 */
export const NAMED_PATTERNS: Record<GymFocus, Pattern[][]> = {
  push: [['horizontal-press', 'incline-press']],
  pull: [['horizontal-pull'], ['vertical-pull']],
  lower: [['squat', 'lunge', 'hinge']],
  upper: [
    ['horizontal-press', 'incline-press'],
    ['vertical-pull', 'horizontal-pull'],
  ],
  full: [
    ['squat', 'lunge', 'hinge'],
    ['horizontal-press', 'incline-press', 'dip'],
    ['vertical-pull', 'horizontal-pull'],
  ],
  athletic: [],
}

/** Movements that press (a push skill's family): the light-pressing rail keeps them out. */
const PRESSING_PATTERNS: ReadonlySet<Pattern> = new Set<Pattern>(['horizontal-press', 'incline-press', 'vertical-press', 'dip'])

/** Movements that pull (a pull skill's family). */
const PULLING_PATTERNS: ReadonlySet<Pattern> = new Set<Pattern>(['vertical-pull', 'horizontal-pull', 'straight-arm-pull'])
const UPPER_ISOLATION = new Set<Pattern>(['lateral-raise', 'rear-delt', 'biceps', 'triceps', 'chest-fly', 'shrug'])

/**
 * Working sets each main compound of a Push or Pull day (the rows and pull-ups, the presses) reaches before an
 * isolation movement is given any time (the athlete's rule; "about four" is a coaching convention, CONSENSUS).
 */
export const MAIN_COMPOUND_SETS = 4
/**
 * Lifting is fitted to at most this many minutes, whatever time is free (the athlete's rule; a coaching convention,
 * not a measured limit): past it the accessories and finishers go first, never a main compound.
 */
export const MAX_LIFTING_MIN = 60
/** An easier version of a movement follows it as a finisher of at most this many sets. */
export const FINISHER_SETS = 2
/** A harder version of a movement already in the session goes in with at most this many sets. */
export const HARDER_VARIANT_SETS = 2
/** About two isolation exercises for one muscle in a session: a third angle adds little (the athlete's rule). */
export const ISOLATION_PER_MUSCLE = 2
/** The chin-up is the pull-up's occasional variation: at most one vertical-pull day in this many uses it. */
export const CHIN_UP_EVERY = 3
/** How far the pull-up leads the other vertical pulls when nothing else separates them (one notch and a half of rating). */
const PULL_UP_DEFAULT = 1.5
/** How far the chin-up trails while the pull-up itself can be done: never the default, only a variation. */
const CHIN_UP_VARIATION = 3

const workingSet = (set: { warmup?: boolean; reps: number }) => !set.warmup && set.reps > 0

/**
 * Whether the chin-up may be picked today: none of the athlete's last `CHIN_UP_EVERY - 1` days with a vertical pull
 * (any session, any place) included one. Days are calendar days, so an opener and its lifts are one day.
 */
export function chinUpAllowed(sessions: readonly GymSession[], now: number): boolean {
  const days = new Map<string, { at: number; chin: boolean }>()
  for (const s of sessions) {
    if (s.startedAt >= now) continue
    const pulls = s.exercises.filter((row) => GYM_EXERCISE_BY_ID[row.exerciseId]?.pattern === 'vertical-pull' && row.sets.some(workingSet))
    if (!pulls.length) continue
    const key = dayKey(s.startedAt)
    const day = days.get(key) ?? { at: s.startedAt, chin: false }
    day.chin ||= pulls.some((row) => row.exerciseId === 'chin-up')
    day.at = Math.max(day.at, s.startedAt)
    days.set(key, day)
  }
  return ![...days.values()].sort((a, b) => b.at - a.at).slice(0, CHIN_UP_EVERY - 1).some((d) => d.chin)
}

const isBicepsIsolation = (ex: GymExercise) => ex.pattern === 'biceps' && ex.primary.includes('biceps')
const isBackCompound = (ex: GymExercise) => ex.compound && (ex.pattern === 'vertical-pull' || ex.pattern === 'horizontal-pull')

/**
 * Pull days: curls and hammer curls together never get more working sets than the rows and pull-ups (the
 * athlete's rule). The last curl gives up sets first; one left with none is removed (and named in `dropped`, if given).
 */
export function capBicepsIsolation<T extends { exerciseId: string; sets: number }>(items: T[], dropped: string[] = []): T[] {
  const back = items.reduce((n, it) => n + (isBackCompound(GYM_EXERCISE_BY_ID[it.exerciseId]) ? it.sets : 0), 0)
  let curls = items.reduce((n, it) => n + (isBicepsIsolation(GYM_EXERCISE_BY_ID[it.exerciseId]) ? it.sets : 0), 0)
  for (let i = items.length - 1; i >= 0 && curls > back; i--) {
    const ex = GYM_EXERCISE_BY_ID[items[i].exerciseId]
    if (!isBicepsIsolation(ex)) continue
    const cut = Math.min(items[i].sets, curls - back)
    items[i].sets -= cut
    curls -= cut
    if (items[i].sets <= 0) {
      items.splice(i, 1)
      dropped.push(ex.name)
    }
  }
  return items
}

/**
 * Order matters: the first movements get the freshest effort, and an isolation exercise done before a compound that
 * leans on the same muscle tires it for the compound — curls before pull-ups shortchange the pull-ups. Each
 * isolation movement goes after the last compound that works one of its main muscles; nothing else moves. Speed
 * and power work is never moved: it stays first while fresh.
 */
export function fatigueOrder<T extends { exerciseId: string }>(items: T[]): T[] {
  for (let i = 0; i < items.length; i++) {
    const ex = GYM_EXERCISE_BY_ID[items[i].exerciseId]
    if (!ex || ex.compound || ex.explosive) continue
    let last = -1
    for (let j = i + 1; j < items.length; j++) {
      const other = GYM_EXERCISE_BY_ID[items[j].exerciseId]
      if (other?.compound && !other.explosive && ex.primary.some((m) => volumeShare(other, m) > 0)) last = j
    }
    if (last > i) {
      const [moved] = items.splice(i, 1)
      items.splice(last, 0, moved)
      i--
    }
  }
  return items
}

/** With time for two lifts, alternate knee/hip work and pressing/pulling using
 * the athlete's actual recent working sets. Missing kit leaves the other
 * pattern available. A second angle of the same movement can wait. */
function briefSlots(focus: 'full' | 'lower' | 'upper', sessions: GymSession[], now: number): Pattern[][] {
  const trained = { quads: 0, hamstrings: 0, chest: 0, lats: 0 }
  for (const session of sessions) {
    if (session.startedAt >= now || session.startedAt < now - 7 * 86_400_000) continue
    for (const row of session.exercises) {
      const ex = GYM_EXERCISE_BY_ID[row.exerciseId]
      if (!ex) continue
      const sets = row.sets.filter((s) => !s.warmup && s.reps > 0 && s.at <= now).length
      for (const muscle of ['quads', 'hamstrings', 'chest', 'lats'] as const) {
        trained[muscle] += sets * (ex.primary.includes(muscle) ? 1 : ex.secondary.includes(muscle) ? 0.5 : 0)
      }
    }
  }
  const knee: Pattern[] = ['squat', 'lunge', 'knee-extension']
  const hip: Pattern[] = ['hinge', 'knee-flexion']
  const press: Pattern[] = ['horizontal-press', 'incline-press', 'dip']
  const pull: Pattern[] = ['horizontal-pull', 'vertical-pull']
  const lower = trained.quads <= trained.hamstrings ? [knee, hip] : [hip, knee]
  const upper = trained.chest <= trained.lats ? [press, pull] : [pull, press]
  if (focus === 'lower') return [...lower, ['calf'], ['core-flexion', 'core-anti-rotation']]
  if (focus === 'upper') return [...upper, ['vertical-press'], ['rear-delt', 'lateral-raise'], ['biceps', 'triceps']]
  return [lower[0], ...upper, lower[1], ['core-flexion', 'core-anti-rotation']]
}

/**
 * What a day adds with spare time. The planner counts a session's pressing or pulling sets as a hard session of
 * that family (the straight-arm rest rule), so time does not buy more of either family than the day is named for:
 * a push day adds pressing, a pull day pulling, an upper day both, and no other day either.
 */
const FILL_FAMILIES: Record<GymFocus, ReadonlySet<Pattern>[]> = {
  push: [PRESSING_PATTERNS],
  pull: [PULLING_PATTERNS],
  upper: [PRESSING_PATTERNS, PULLING_PATTERNS],
  full: [],
  lower: [],
  athletic: [],
}

export interface PlannedExercise {
  exerciseId: string
  pairedWith?: string
  sets: number
  plan: RepPlan
  suggestion: LoadSuggestion
  restSec: number
  /** This movement is being built up from a small number of unassisted reps. */
  practice?: { easierId?: string }
  /**
   * A drop-set finisher: an easier version of the movement directly before it (`of`), one or two sets to finish that
   * movement off. An easier version of a movement in the session is never a separate exercise.
   */
  finisher?: { of: string }
}

export interface GymPlan {
  name: string
  focus: GymFocus
  items: PlannedExercise[]
  /** Exercises left out to fit the time, by name. */
  dropped: string[]
  estimatedMin: number
  /** The lifting minutes the plan was fitted to, when the time asked for was over the cap (`MAX_LIFTING_MIN`). */
  cappedAt?: number
  /**
   * False when the time asked for cannot hold even one block (warm-up
   * included): nothing is built then, rather than inventing minutes.
   */
  fits: boolean
  /** Why a pick is not the usual one (a stalled lift's variation), in the athlete's words. */
  notes: string[]
}

/**
 * The muscles each focus is for. A focus is worth a session only while more
 * than half of them are switched on: with the quads, glutes and hamstrings off
 * a "Lower" day once came out as a single set of cable crunches.
 */
const FOCUS_MAIN: Record<GymFocus, Muscle[]> = {
  full: [],
  upper: ['chest', 'lats', 'upper-back', 'front-delts', 'triceps', 'biceps'],
  lower: ['quads', 'glutes', 'hamstrings'],
  push: ['chest', 'front-delts', 'triceps'],
  pull: ['lats', 'upper-back', 'biceps'],
  athletic: ['quads', 'glutes', 'hamstrings'],
}

/** The muscles a focus is for (a full-body day is for none in particular). */
export function focusMain(focus: GymFocus): readonly Muscle[] {
  return FOCUS_MAIN[focus]
}

export function focusOpen(focus: GymFocus, musclesOff: readonly Muscle[] = []): boolean {
  const main = FOCUS_MAIN[focus]
  if (!main.length) return true
  return main.filter((m) => !musclesOff.includes(m)).length * 2 > main.length
}

/** What a closed focus falls back to, nearest first. Full body is always open. */
const FOCUS_FALLBACK: Record<GymFocus, GymFocus[]> = {
  full: [],
  upper: ['push', 'pull', 'lower'],
  lower: ['upper', 'push', 'pull'],
  push: ['pull', 'upper', 'lower'],
  pull: ['push', 'upper', 'lower'],
  athletic: ['lower', 'upper'],
}

/** Rest between sets (CONSENSUS ranges): longer for heavy compound work. */
export function restFor(ex: GymExercise, plan: RepPlan): number {
  if (ex.dose) return ex.dose.restSec
  if (ex.explosive) return 120
  if (!ex.compound) return 75
  return plan.range[1] <= 6 ? 180 : 120
}

/** Minutes a block takes: each set's work plus the rest after it. */
function blockMinutes(sets: number, restSec: number, workSec = 40): number {
  return (sets * (workSec + restSec)) / 60
}

/** What liking a movement at this place is worth in its slot: one rating notch, so a loved movement elsewhere still wins. */
const FAVOURITE_HERE_BONUS = 1

const WARM_UP_MIN = 6
/** Minutes the added movements leave unspent: changing plates and finding a machine run over the estimate, and a harder day needs room for its extra sets. */
const FILL_HEADROOM_MIN = 4
/** The most sets of credit one muscle gets in a session through the added movements (the app's own ceiling). */
const FILL_MUSCLE_SETS = 10
/** ...and the most working sets a whole session reaches this way: a long day is not a reason for an endless one. */
const FILL_SESSION_SETS = 30
/** The speed and power session's own drills are its warm-up. */
const ATHLETIC_WARM_UP_MIN = 2

export type Emphasis = 'strength' | 'muscle' | 'endurance' | 'power'

/**
 * The rep-range kind goals ask of a movement: compounds follow strength or
 * endurance when those lead, isolation work follows endurance or physique.
 * Shared with the player so a movement added mid-session reads the same goals.
 */
export function goalEmphasisFor(goals: GoalWeights | undefined, ex: GymExercise): 'strength' | 'muscle' | 'endurance' {
  if (!goals) return 'muscle'
  if (ex.compound) return goals.endurance > Math.max(goals.strength, goals.physique) ? 'endurance' : goals.strength > goals.physique ? 'strength' : 'muscle'
  return goals.endurance > goals.physique ? 'endurance' : 'muscle'
}

/** Sets a movement is given on a day at this volume factor: the usual three, scaled, never under two. */
export function setsForFactor(factor: number, priority = false, prescribed?: number): number {
  return Math.max(2, Math.round((prescribed ?? (priority ? 4 : 3)) * factor))
}

/** Which focus comes next: the part of the body trained longest ago at the gym, among the ones still switched on. */
export function nextFocus(sessions: GymSession[], now = Date.now(), musclesOff: readonly Muscle[] = []): GymFocus {
  const recent = sessions.filter((s) => s.startedAt < now).slice(-6)
  const last = recent[recent.length - 1]
  const name = last?.name.toLowerCase() ?? ''
  const wanted: GymFocus = name.startsWith('upper')
    ? 'lower'
    : name.startsWith('lower')
      ? 'upper'
      : name.startsWith('push')
        ? 'pull'
        : name.startsWith('pull')
          ? 'lower'
          : 'full'
  return [wanted, ...FOCUS_FALLBACK[wanted]].find((f) => focusOpen(f, musclesOff)) ?? 'full'
}

/**
 * Today's gym session for a location and a time budget. Every pick can be
 * done here; avoided movements are never chosen while another fills the slot;
 * loved ones win ties; anything marked hard to do here comes last. Under 18,
 * a movement that needs coaching is only picked when nothing else fills the
 * slot or the athlete loves it.
 */
interface GymSessionInput {
  location: GymLocation | undefined
  capacity?: BodyweightCapacity
  minutes: number
  focus?: GymFocus
  sessions: GymSession[]
  ratings?: Record<string, Rating>
  youth?: boolean
  emphasis?: 'strength' | 'muscle' | 'endurance' | 'power'
  /** Goal weights: set the compound and isolation rep ranges, and put explosive work first when power matters. */
  goals?: GoalWeights
  /** Muscles the athlete has switched off: a movement whose primary muscles are all off is never picked. */
  musclesOff?: Muscle[]
  /** Lagging muscles: movements that train them win their slot and get an extra set. */
  priority?: Muscle[]
  /** The athlete's own selections, ahead of the week's automatic suggestions when time is short. */
  athletePriority?: readonly Muscle[]
  /** Muscles still below their weekly targets after the planner priced each visit. */
  weeklyPriority?: readonly Muscle[]
  /**
   * Muscles the week already has far past target (the planner's steer). A movement built on one gives its slot to
   * one that is not, and a slot only such movements fill is left out — except the movements the day is named for
   * (`NAMED_PATTERNS`), which keep one movement at two sets: a push day still presses. Unlike `musclesOff`, which is
   * the athlete's own switch and always keeps a movement out.
   */
  spare?: Muscle[]
  /** Joints to keep load off today (a pain report or a niggle). */
  avoidJoints?: Joint[]
  /** Below 1 on a lighter day: fewer sets, stopping a rep further from failure. */
  volumeFactor?: number
  /** Minutes of warm-up in the budget; the default is the usual one (the lifts after a skill opener need only a couple). */
  warmUpMin?: number
  /** Where each movement is liked best (`gym.favoriteAt`): it wins its slot at that place. */
  favoriteAt?: Record<string, string>
  now?: number
}

/** Fit and sequence the movements. A week compares many candidate sessions before anyone needs load suggestions. */
export function planGymExercises(input: GymSessionInput) {
  const { location, sessions, ratings = {}, youth = false, now = Date.now() } = input
  const focus = input.focus ?? nextFocus(sessions, now, input.musclesOff)
  // Lifting is fitted to about an hour at most (`MAX_LIFTING_MIN`); a speed and power session keeps its own dose.
  const minutes = focus === 'athletic' ? input.minutes : Math.min(input.minutes, MAX_LIFTING_MIN)
  const cappedAt = minutes < input.minutes ? minutes : undefined
  const split = focus === 'pull' || focus === 'push'
  const musclesOff = new Set(input.musclesOff ?? [])
  const priority = new Set(input.priority?.filter((m) => muscleFitsGymFocus(focus, m)))
  const requested = new Set(input.athletePriority?.filter((m) => muscleFitsGymFocus(focus, m)))
  const combinedGoals = (input.goals?.skills ?? 0) > 0 && (input.goals?.physique ?? 0) >= 3
  const weeklyAccessories = minutes >= 35 || combinedGoals
    ? [...priority].filter((m) => !requested.has(m) && (m === 'chest' || m === 'lats' || m === 'side-delts' || (combinedGoals && (m === 'hamstrings' || m === 'quads')))) : []
  const priorityExercises = new Set([...requested, ...weeklyAccessories])
  // A muscle the athlete asked for is not spared: a movement built on a priority muscle keeps its slot whatever
  // the week's steer says about the other muscles it leans on, and a muscle on both lists counts as priority.
  // One exception is a recovery rail, not a steer: with the pressing pair spared (the planner's light pressing
  // beside a push skill, `LIGHT_PRESS_SPARE`) nothing built on either of them comes back for a priority — the
  // week is lighter on them because the skill days carry them.
  const spare = new Set(input.spare ?? [])
  const lightPress = spare.has('front-delts') && spare.has('triceps')
  // Every vertical pull works the upper back. The catalogue lists it among the pull-up's main muscles and the
  // chin-up's assisting ones, and a steer off the upper back must not turn that listing into a change of grip.
  const overlap = (e: GymExercise) => e.primary.filter((m) => spare.has(m) && !(e.pattern === 'vertical-pull' && m === 'upper-back')).length +
    (PRESSING_PATTERNS.has(e.pattern) || (e.compound && e.pattern === 'triceps') ? 0.5 * e.secondary.filter((m) => spare.has(m)).length : 0)
  const spareIn = (e: GymExercise) => {
    const held = lightPress && e.primary.some((m) => m === 'front-delts' || m === 'triceps')
    if (!held && e.primary.some((m) => requested.has(m) ? !cleanCoverage.has(m) : !input.athletePriority && priority.has(m))) return 0
    return overlap(e)
  }
  const avoid = new Set(input.avoidJoints ?? [])
  const factor = input.volumeFactor ?? 1
  const goalEmphasis = input.goals ? { power: input.goals.power >= 3 } : null
  const emphasisOf = (e: GymExercise) => input.emphasis ?? goalEmphasisFor(input.goals, e)
  const chinUps = chinUpAllowed(sessions, now)
  const usable = (e: GymExercise) =>
    (e.id !== 'chin-up' || chinUps) &&
    readyForBodyweight(e.id, input.capacity) &&
    !(e.technical && !e.tier && ratings[e.id] !== 'love' && (youth || (input.capacity && isHardBodyweight(e) && !input.capacity.practiced.has(e.id)))) &&
    !e.primary.some((m) => musclesOff.has(m)) &&
    (!avoid.size || !jointsToRest(e.id).some((j) => avoid.has(j))) &&
    ratings[e.id] !== 'avoid' &&
    // Speed and power work is built up to, never started at the top (see plyoGate).
    plyoGate(e, sessions, youth, now).allowed
  const legPractice = legPracticeAt(sessions, location?.id, now)
  const introductory = Boolean(input.capacity?.introductory && focus !== 'athletic')
  const fullPriorityDose = !introductory && factor >= 1 && (input.goals?.physique ?? 0) >= 3 &&
    (input.goals?.skills ?? 0) > 0 && requested.size > 0
  const here = availableAt(location).filter((e) => fitsGymFocus(focus, e))
  const cleanCoverage = new Set<Muscle>()
  if (spare.size && requested.size) {
    for (const e of here) {
      if (e.explosive || !e.primary.some((m) => requested.has(m)) || overlap(e) || !usable(e)) continue
      for (const m of e.primary) cleanCoverage.add(m)
    }
  }
  const used = new Set<string>()
  const movement = (e: GymExercise) => e.variantOf ?? e.id
  const items: Omit<PlannedExercise, 'suggestion'>[] = []
  const warm = input.warmUpMin !== undefined ? Math.max(0, input.warmUpMin) : focus === 'athletic' ? ATHLETIC_WARM_UP_MIN : WARM_UP_MIN
  let pair: [string, string] | undefined
  /** Movements whose dose is capped to keep the rest of the week's workouts available. */
  const steered = new Set<string>()
  const protectSets = new Set<string>()
  const anchors = new Set<string>()
  const notes: string[] = []
  // The day each movement was last logged, so rotation prefers what was done longest ago.
  const lastLogged = new Map<string, number>()
  for (const s of sessions) {
    if (s.startedAt >= now) continue
    for (const log of s.exercises) if (log.sets.length) lastLogged.set(log.exerciseId, Math.max(lastLogged.get(log.exerciseId) ?? 0, s.startedAt))
  }
  const staleness = (e: GymExercise) => ((lastLogged.get(e.id) ?? 0) === 0 ? -0.2 : -Math.min(0.2, (now - (lastLogged.get(e.id) ?? now)) / (60 * 86_400_000)))
  const isPriority = (e: GymExercise) => e.primary.some((m) => priority.has(m))
  const makeItem = (pick: GymExercise, wantsExplosive: boolean, sets?: number) => {
    const base = repPlanFor(pick, wantsExplosive ? 'power' : emphasisOf(pick), youth)
    const plan = introductory || input.capacity?.introductoryEffort ? { ...base, targetRpe: Math.min(7, base.targetRpe) }
      : factor < 1 ? { ...base, targetRpe: Math.max(6, base.targetRpe - 1) } : base
    return {
      exerciseId: pick.id,
      // The usual dose: a light or hard day is made from the fitted session below, so it cannot lose to the time fit.
      sets: introductory ? 2 : sets ?? 3 + (isPriority(pick) ? 1 : 0),
      plan,
      restSec: restFor(pick, plan),
    }
  }
  // A movement the athlete likes best at this very place wins its slot there.
  const favouriteHere = (e: GymExercise) => (location !== undefined && input.favoriteAt?.[e.id] === location.id ? FAVOURITE_HERE_BONUS : 0)
  // A movement that needs coaching is never a first pick: last for under-18s, and for anyone who has
  // not logged it yet, unless they rated it love.
  const technicalPenalty = (e: GymExercise) =>
    e.technical && ratings[e.id] !== 'love' && (youth || !lastLogged.has(e.id)) ? 5 : 0
  const earnedTrial = (e: GymExercise) => e.id === 'pull-up' && (input.capacity?.tryPullup || input.capacity?.reportedPullups) ? 1.5 : 0
  const scoreOf = (e: GymExercise, extra = 0) =>
    preferenceRank(e.id, ratings, location) +
    technicalPenalty(e) +
    (e.compound ? 0 : 0.25) -
    (isPriority(e) ? 1 : 0) -
    favouriteHere(e) - earnedTrial(e) +
    extra
  // The ladder is climbed from the bottom: the lowest rung never logged comes
  // first; once every rung has been done, the one done longest ago.
  const climb = (a: GymExercise, b: GymExercise) => {
    const aNew = !lastLogged.has(a.id)
    const bNew = !lastLogged.has(b.id)
    if (aNew !== bNew) return aNew ? -1 : 1
    if (aNew && bNew) return (a.rung ?? 0) - (b.rung ?? 0) || scoreOf(a) - scoreOf(b)
    return scoreOf(a, staleness(a)) - scoreOf(b, staleness(b)) || (a.rung ?? 0) - (b.rung ?? 0)
  }
  const hardHere = (e: GymExercise) => (location?.hardHere?.includes(e.id) ? 1 : 0)
  const ladder = (a: GymExercise, b: GymExercise) => hardHere(a) - hardHere(b) || climb(a, b)

  const exOf = (it: { exerciseId: string }) => GYM_EXERCISE_BY_ID[it.exerciseId]
  /** Harder versions of a movement already in the session: in small volume only (`HARDER_VARIANT_SETS`). */
  const smallDose = new Set<string>()
  /**
   * How a movement may join the session beside what is already in it (`LADDERS`): as a separate exercise; as a
   * harder version of one, in small volume; as an easier version of one, only as that movement's finisher; or not
   * at all, when the same rung is already there (a hanging knee raise beside a hanging leg raise adds nothing).
   */
  const rungRole = (e: GymExercise): { role: 'standalone' | 'harder' | 'finisher' | 'blocked'; of?: string } => {
    if (e.ladder) {
      for (const it of items) {
        const x = exOf(it)
        if (it.finisher || !x.ladder || x.ladder.id !== e.ladder.id) continue
        if (e.ladder.level === x.ladder.level) return { role: 'blocked' }
        return e.ladder.level < x.ladder.level ? { role: 'finisher', of: x.id } : { role: 'harder', of: x.id }
      }
    }
    return { role: 'standalone' }
  }
  /** A harder version only when the athlete has shown it: logged it before, or passed its starting gate on their own evidence. */
  const shownHarder = (e: GymExercise) =>
    lastLogged.has(e.id) || (input.capacity !== undefined && hasBodyweightGate(e.id) && readyForBodyweight(e.id, input.capacity))
  /** Isolation exercises already aimed at a muscle (each exercise's first main muscle), finishers aside. */
  const isolationFor = (m: Muscle) => items.filter((it) => !it.finisher && !exOf(it).compound && exOf(it).primary[0] === m).length
  /** Whether a movement can go in as a separate exercise: never a rung already there or below it, about two isolation exercises a muscle. */
  const joinable = (e: GymExercise) => {
    const { role } = rungRole(e)
    if (role === 'blocked' || role === 'finisher' || (role === 'harder' && !shownHarder(e))) return false
    return e.compound || isolationFor(e.primary[0]) < ISOLATION_PER_MUSCLE
  }
  /** The most sets of credit one muscle gets in a session (the app's own ceiling; more for the athlete's priorities). */
  const ceilingOf = (m: Muscle) => requested.has(m) || (!input.athletePriority && priority.has(m)) ||
    (focus === 'pull' && m === 'upper-back') ? FILL_MUSCLE_SETS + 2 : FILL_MUSCLE_SETS
  /**
   * The sets that aim at a muscle so far: the movements it is a main muscle of, at their share (`volumeShare`). A
   * muscle that only assists — the lats in a hanging leg raise — is not what the ceiling guards.
   */
  const creditOf = (m: Muscle) => items.reduce((n, it) => n + (exOf(it).primary.includes(m) ? it.sets * volumeShare(exOf(it), m) : 0), 0)
  /** The sets a movement can add before one of its main muscles passes its ceiling. */
  const roomFor = (e: GymExercise) => Math.min(...e.primary.map((m) => Math.floor((ceilingOf(m) - creditOf(m)) / volumeShare(e, m) + 1e-9)))
  /** Pull days: the sets the curls can still take before they outnumber the rows and pull-ups. */
  const curlRoom = () => focus !== 'pull' ? Infinity : items.reduce((n, it) => n + (isBackCompound(exOf(it)) ? it.sets : 0), 0) -
    items.reduce((n, it) => n + (isBicepsIsolation(exOf(it)) ? it.sets : 0), 0)

  if (focus === 'athletic') {
    // Fresh and fast first, strength last: drills, then jumps, then runs and throws, then one lift.
    const take = (e: GymExercise | undefined, sets?: number) => {
      if (!e) return
      used.add(movement(e))
      items.push(makeItem(e, false, sets))
    }
    const fromDomain = (domain: AthleticDomain, patterns: Pattern[], cap: IntensityTier) => {
      const pool = here.filter(
        (e) => !used.has(movement(e)) && patterns.includes(e.pattern) && athleticDomain(e) === domain && usable(e) && TIER_RANK[gateTier(e)!] <= TIER_RANK[cap],
      )
      if (!pool.length) return undefined
      // The highest tier allowed today; inside it the ladder is climbed in order.
      const top = Math.max(...pool.map((e) => TIER_RANK[gateTier(e)!]))
      return pool.filter((e) => TIER_RANK[gateTier(e)!] === top).sort(ladder)[0]
    }
    // A lighter day has no maximal or high-impact work.
    let cap: IntensityTier = factor < 1 ? 'medium' : 'high'
    const dose = (e: GymExercise | undefined) => (e?.dose ? e.dose.sets : undefined)
    // Warm-up drills: one gentle, one at the highest tier allowed (never above medium).
    const drillPool = here.filter((e) => e.pattern === 'drill' && usable(e))
    const gentle = drillPool.filter((e) => e.tier === 'low').sort(ladder)[0]
    take(gentle, 2)
    const upper = drillPool.filter((e) => e.tier === 'medium' && !used.has(movement(e))).sort(ladder)[0]
    take(upper ?? drillPool.filter((e) => !used.has(movement(e))).sort(ladder)[0], 2)
    // Only one high-intensity block a session: jumps first, then it is spent.
    const jump = fromDomain('jump', ['jump'], cap)
    if (jump && gateTier(jump) === 'high') cap = 'medium'
    take(jump, dose(jump))
    const sprint = fromDomain('sprint', ['sprint'], cap)
    if (sprint && gateTier(sprint) === 'high') cap = 'medium'
    take(sprint, dose(sprint))
    const thrown = fromDomain('throw', ['throw'], cap)
    take(thrown, dose(thrown))
    // One strength movement: the slot nothing explosive filled, lower body first unless the legs are off.
    for (const slot of [['squat', 'lunge', 'hinge'], ['horizontal-pull', 'vertical-pull'], ['horizontal-press', 'vertical-press']] as Pattern[][]) {
      const options = here
        .filter((e) => slot.includes(e.pattern) && !used.has(movement(e)) && !e.explosive && !athleticDomain(e) && usable(e))
        .map((e) => ({ e, score: scoreOf(e, staleness(e)) + slot.indexOf(e.pattern) * 0.5 }))
        .sort((a, b) => a.score - b.score)
      if (options.length) {
        take(options[0].e)
        break
      }
    }
  } else {
    // If four two-set compound blocks cannot fit, rotate the knee/hip and
    // push/pull work across visits before spending time on a second angle.
    const warmUp = Math.max(0, input.warmUpMin ?? WARM_UP_MIN)
    const brief = minutes >= 15 && (minutes < 20 || (minutes - warmUp < 4 * blockMinutes(2, 120) &&
      !here.some((ex) => PULLING_PATTERNS.has(ex.pattern) && usable(ex))))
    const slots: Pattern[][] = brief && (focus === 'full' || focus === 'lower' || focus === 'upper')
      ? briefSlots(focus, sessions, now) : [...SLOTS[focus]]
    const splitPriority = (split: 'upper' | 'lower') => here.some((ex) =>
      fitsGymFocus(split, ex) && !ex.pattern.startsWith('core') && ex.primary.some((m) => requested.has(m)) && usable(ex))
    const shortMixed = focus === 'full' && combinedGoals && minutes <= 25 && splitPriority('upper') && splitPriority('lower')
    if (shortMixed) {
      // On the only short lifting visit of a skill week, leave room for an upper
      // priority and both leg actions. The priority pass supplies the upper lift.
      slots.splice(0, slots.length, ['squat', 'lunge', 'knee-extension'], ['knee-flexion', 'hinge'])
    }
    // On a brief leg visit, buy knee and hip sets before an unrequested calf or trunk accessory.
    const shortLegs = combinedGoals && focus === 'lower' && minutes <= 25 && !requested.has('calves') && !requested.has('abs')
    if (shortLegs) slots.splice(2, slots.length - 2, here.some((e) => e.pattern === 'knee-extension' && usable(e)) ? ['knee-extension'] : ['lunge'])
    if (focus === 'lower' && avoid.has('ankles')) slots.push(['abduction'], ['adduction'])
    // A hinge and a knee curl give a hamstring priority two distinct movements on
    // a full-body visit. A longer session can also carry a second chest exercise.
    if (focus === 'full' && combinedGoals && minutes >= 35) {
      if (requested.has('hamstrings')) slots.push(['knee-flexion'])
      if (requested.has('chest') || requested.has('chest-upper')) slots.push(['chest-fly', 'incline-press'])
    }
    const calfAngles = !introductory && combinedGoals && requested.has('calves') && (focus === 'lower' || focus === 'full') && minutes >= 45
    if (calfAngles) {
      if (!slots.some((slot) => slot.includes('calf'))) slots.push(['calf'])
      slots.push(['calf'])
    }
    // A short upper session still gets a press and a pull. When the week
    // needs more back work, fit the row before a second pressing angle.
    if (!brief && focus === 'upper' && priority.has('lats') && !priority.has('chest') && !requested.has('chest-upper')) {
      [slots[2], slots[3]] = [slots[3], slots[2]]
    }
    const lateralAccessory = requested.has('side-delts') && fitsGymFocus(focus, { pattern: 'lateral-raise', primary: ['side-delts'] }) && !slots.some((slot) => slot.includes('lateral-raise'))
    if (lateralAccessory) slots.push(['lateral-raise'])
    // Explosive work goes first, fresh, when power is a goal (and the legs are on).
    if (goalEmphasis?.power && focus !== 'pull' && !musclesOff.has('quads')) slots.unshift(['jump', 'throw'])
    // What the day is named for, still to be filled: each group keeps one movement whatever the steer says.
    // On a Push day the overhead press is a main compound as well (`splitMains`): the week's steer may change which
    // press goes in, never leave it out. A light-pressing day is the exception: its rail keeps pressing to one movement.
    const named = (focus === 'push' && !lightPress ? [...NAMED_PATTERNS.push, ['vertical-press'] as Pattern[]] : NAMED_PATTERNS[focus])
      .map((group) => [...group])
    // If the skill plan already calls for light pressing and the athlete pressed
    // yesterday, keep one practice set in a named pressing slot.
    const yesterday = addDays(new Date(now).setHours(0, 0, 0, 0), -1)
    const recentPress = lightPress && sessions.some((s) => s.startedAt >= yesterday && s.startedAt < now &&
      s.exercises.some((log) => PRESSING_PATTERNS.has(GYM_EXERCISE_BY_ID[log.exerciseId]?.pattern) &&
        log.sets.filter((set) => !set.warmup && set.reps > 0).length >= 2))
    const unfilled = (slot: Pattern[]) => named.some((group) => group.some((p) => slot.includes(p)) && !items.some((it) => group.includes(GYM_EXERCISE_BY_ID[it.exerciseId].pattern)))
    for (const slot of slots) {
      const wantsExplosive = slot.includes('jump') || slot.includes('throw')
      // Avoided means avoided: a slot nothing else can fill is left out.
      const firstCalf = calfAngles && slot.includes('calf') && items.find((it) => GYM_EXERCISE_BY_ID[it.exerciseId].pattern === 'calf')
      const fit = here.filter((e) => slot.includes(e.pattern) && !used.has(movement(e)) && (wantsExplosive ? e.explosive : !e.explosive) && usable(e) &&
        joinable(e) && (!firstCalf || e.id.startsWith('seated-') !== firstCalf.exerciseId.startsWith('seated-')))
      // A muscle the week has plenty of steers the slot to a movement not built on it. When every movement of the
      // slot is, the slot goes — unless it is what the day is named for: then the movement that leans on the spare
      // muscles least goes in, at two sets.
      const free = fit.filter((e) => spareIn(e) === 0)
      const spared = free.length === 0 && fit.length > 0
      if (spared && !unfilled(slot)) continue
      const options = spared ? fit : free.length ? free : fit
      // The pull-up is the vertical pull by default; the chin-up is its occasional variation (`CHIN_UP_EVERY`).
      const pullUpHere = slot.includes('vertical-pull') && options.some((e) => e.id === 'pull-up')
      const defaultPick = (e: GymExercise) => !slot.includes('vertical-pull') ? 0
        : e.id === 'pull-up' ? -PULL_UP_DEFAULT : e.id === 'chin-up' && pullUpHere ? CHIN_UP_VARIATION : 0
      const scored = options
        .map((e) => ({
          e,
          score:
            preferenceRank(e.id, ratings, location) +
            technicalPenalty(e) -
            favouriteHere(e) - earnedTrial(e) +
            // Within a slot the earlier-listed pattern is the one the slot is for.
            slot.indexOf(e.pattern) * 0.5 +
            (e.unilateral && fullPriorityDose && warmUp <= 2 && minutes <= 30 ? 0.35 : 0) +
            (e.compound ? 0 : 0.25) -
            (isPriority(e) ? 1 : 0) +
            // The brief knee or hip slot may be the week's only one.
            (brief && slot.includes('knee-flexion') && !e.primary.includes('hamstrings') ? 1.5 : 0) +
            (brief && slot.includes('squat') && !e.primary.includes('quads') && !e.primary.some((m) => requested.has(m)) ? 2 : 0) +
            // Without a tier ladder to climb, prefer the gentler jump or throw.
            (e.tier ? TIER_RANK[gateTier(e)!] * 0.25 : 0) +
            spareIn(e) * 0.5,
        }))
      const ranked = [...scored].sort((a, b) => a.score + defaultPick(a.e) - (b.score + defaultPick(b.e)))
      const first = ranked[0]
      if (!first) continue
      let pick = first.e
      const learned = legPractice.get(pick.id)?.working
      if (learned && factor >= 1 && !wantsExplosive && ratings[pick.id] !== 'love') {
        const variation = GYM_EXERCISE_BY_ID[learned.id]
        if (canDoHere(variation.id, location) && usable(variation) && joinable(variation) && !used.has(movement(variation)) &&
            !hardHere(variation) && spareIn(variation) <= spareIn(pick)) {
          used.add(movement(pick))
          pick = variation
        }
      }
      // A lift that has stopped progressing lends its slot to a variation of
      // the same movement for a while: a change of exercise is a common way to
      // restart progress (CONSENSUS). Only a close fit — never one that is
      // hard to do here, or coached-only under 18 — and never a favourite.
      if (pick === first.e && sessions.length > STALL_SESSIONS && !wantsExplosive && ratings[pick.id] !== 'love' && liftTrend(sessions, pick.id, now, location?.id).status === 'stalled') {
        // The variation is the closest movement on its own merits (the pull-up's default lead set aside), so a
        // stalled pull-up can lend its slot to the chin-up — on the days `chinUpAllowed` leaves it in.
        const alt = [...scored].sort((a, b) => a.score - b.score).find(
          (r) => r.e.id !== first.e.id && r.e.pattern === first.e.pattern && r.score <= first.score + 1.5 && liftTrend(sessions, r.e.id, now, location?.id).status !== 'stalled',
        )
        if (alt) {
          notes.push(
            `${first.e.name} has not beaten its best in its last ${STALL_SESSIONS} sessions, so ${alt.e.name} takes its place for now — changing the variation is a common way to restart progress (a coaching convention, not a proven rule). Swap back any time.`,
          )
          used.add(movement(first.e))
          pick = alt.e
        }
      }
      used.add(movement(pick))
      const extraLateral = lateralAccessory && pick.pattern === 'lateral-raise'
      const limitAccessory = extraLateral && !fullPriorityDose
      const item = makeItem(pick, wantsExplosive, spared || limitAccessory ? 2 : shortLegs && !items.length ? 4 : undefined)
      if (focus !== 'full' && pick.pattern.startsWith('core-') && !pick.primary.some((m) => requested.has(m))) item.sets = Math.min(3, item.sets)
      if (spared && recentPress && PRESSING_PATTERNS.has(pick.pattern)) item.sets = 1
      if (rungRole(pick).role === 'harder') {
        item.sets = Math.min(item.sets, HARDER_VARIANT_SETS)
        smallDose.add(pick.id)
      }
      items.push(item)
      if (spared || limitAccessory) steered.add(pick.id)
    }
    // Keep the first compound(s) that define the day, then protect a direct exercise
    // for each requested muscle before spending time on another angle of the same lift.
    if (priorityExercises.size) {
      for (const muscle of priorityExercises) {
        let candidates = items.filter((it) => GYM_EXERCISE_BY_ID[it.exerciseId].primary.includes(muscle))
        if (!candidates.length && !musclesOff.has(muscle)) {
          // Fill a missing priority with an isolation move that belongs on this day.
          const options = here.filter((e) => !used.has(movement(e)) && (!e.compound || (shortMixed && requested.has(muscle))) && !e.explosive && !e.dose &&
            e.primary.includes(muscle) && usable(e) && joinable(e) && rungRole(e).role === 'standalone' && !spareIn(e) && !technicalPenalty(e))
          const best = options.sort((a, b) => scoreOf(a) - scoreOf(b) || a.primary.length - b.primary.length)[0]
          if (best) {
            const addition = makeItem(best, false, fullPriorityDose && requested.has(muscle) ? 4 : 3)
            items.push(addition)
            used.add(movement(best))
            steered.add(best.id)
            candidates = [addition]
          }
        }
        const isolation = candidates.find((it) => GYM_EXERCISE_BY_ID[it.exerciseId].primary.length === 1)
        const useFirst = (muscle === 'quads' || (combinedGoals && muscle === 'chest')) && (focus === 'lower' || focus === 'full')
        const best = useFirst ? candidates[0] : isolation ?? candidates[0]
        if (best) protectSets.add(best.exerciseId)
        if (calfAngles && muscle === 'calves') for (const it of candidates) protectSets.add(it.exerciseId)
        if (focus === 'full' && minutes >= 35 && combinedGoals && muscle === 'hamstrings' && requested.has(muscle) &&
            !sessions.some((s) => s.startedAt >= weekStart(now) && s.startedAt < now && s.exercises.some((row) =>
              GYM_EXERCISE_BY_ID[row.exerciseId]?.primary.includes(muscle) && row.sets.some((set) => !set.warmup && set.reps > 0)))) {
          for (const it of candidates) if (GYM_EXERCISE_BY_ID[it.exerciseId].pattern === 'hinge') protectSets.add(it.exerciseId)
        }
      }
    }
    if (split || priorityExercises.size) {
      // Protect the first lift for each main action before considering another
      // pressing angle or isolation work.
      const groups: Pattern[][] = focus === 'push'
        ? [['horizontal-press', 'incline-press', 'dip'], ['vertical-press']] : NAMED_PATTERNS[focus]
      for (const group of groups) {
        const inGroup = items.filter((it) => group.includes(GYM_EXERCISE_BY_ID[it.exerciseId].pattern))
        const first = split ? inGroup[0] : inGroup.find((it) => protectSets.has(it.exerciseId)) ?? inGroup[0]
        if (first) anchors.add(first.exerciseId)
      }
      // A week of pressing skill practice can leave just one short upper-body
      // visit for the back. Keep a row beside a pulldown before an optional raise.
      if (focus === 'upper' && combinedGoals && !requested.size && input.weeklyPriority?.[0] === 'lats') {
        const row = items.find((it) => GYM_EXERCISE_BY_ID[it.exerciseId].pattern === 'horizontal-pull')
        if (row) anchors.add(row.exerciseId)
      }
      // A short full-body block can pair a leg compound with the requested upper
      // movement. Requiring two upper compounds first would spend the whole visit.
      if (focus === 'full' && (minutes <= 25 || introductory) && combinedGoals && requested.size > 1) {
        const isLeg = (id: string) => fitsGymFocus('lower', GYM_EXERCISE_BY_ID[id]) &&
          !GYM_EXERCISE_BY_ID[id].pattern.startsWith('core')
        const direct = [...protectSets].filter((id) => GYM_EXERCISE_BY_ID[id].primary.some((m) => requested.has(m)))
        if (direct.some(isLeg) && direct.some((id) => !isLeg(id))) {
          const upperAnchor = introductory && !direct.some((id) => !isLeg(id) && GYM_EXERCISE_BY_ID[id].compound)
            ? [...anchors].find((id) => !isLeg(id)) : undefined
          for (const id of anchors) if (!isLeg(id) && !direct.includes(id) && id !== upperAnchor) anchors.delete(id)
        }
      }
      // Use the week's extra priorities to break ties when movements compete for time.
      const rankExtraPriority = split && (input.athletePriority === undefined || total() > minutes)
      const rank = (id: string) => {
        const ex = GYM_EXERCISE_BY_ID[id]
        if (ex.explosive || anchors.has(id) || (focus === 'lower' && ex.pattern === 'hinge')) return 0
        if (protectSets.has(id)) return ex.primary.some((m) => requested.has(m)) ? 1 : 2
        if (ex.primary.some((m) => requested.has(m))) return 3
        return rankExtraPriority && isPriority(ex) ? 4 : 5
      }
      items.sort((a, b) => rank(a.exerciseId) - rank(b.exerciseId))
    }
  }
  if (introductory && items.length) {
    items.splice(4)
    notes.push('Start with up to four movements and two sets each. Leave about three reps in reserve. The next step opens after two days with several manageable sets across at least two lifts.')
  }
  // Fit the time strictly: trim sets on isolation work, then on compounds,
  // down to two; then give up the last slots, down to one block. A block that
  // cannot fit even alone is reported, never built on invented minutes.
  const dropped: string[] = []
  function total() {
    const blocks = items.reduce((m, it) => m + blockMinutes(it.sets, it.restSec, GYM_EXERCISE_BY_ID[it.exerciseId].dose?.workSec), 0)
    // A brief visit finishes at its last set. Longer visits keep the usual
    // allowance to change equipment, rerack weights and record the workout.
    const lastRest = items.at(-1)?.restSec ?? 0
    const finalRest = minutes >= 15 && minutes < 20 ? lastRest / 60 :
      combinedGoals && (priorityExercises.size || input.capacity) && minutes <= 30 ? Math.max(0, lastRest - 30) / 60 : 0
    let saved = 0
    if (pair) {
      const [a, b] = pair
      const first = items.find((it) => it.exerciseId === a), second = items.find((it) => it.exerciseId === b)
      if (first && second) saved = savedPairSeconds(first.sets, second.sets, first.restSec) / 60
    }
    return warm + blocks - finalRest - saved
  }
  // Push and Pull days spend their time in the athlete's order (`allocateSplitDay`).
  const splitDose = split && !introductory
  // Use a single station. Basic strength work and a pair's own recovery stay intact.
  if (!splitDose && fullPriorityDose && !avoid.size && focus !== 'athletic' && minutes >= 15 && minutes <= 35 && total() > minutes) {
    const choices = items.filter((it) => protectSets.has(it.exerciseId) && !anchors.has(it.exerciseId) &&
      GYM_EXERCISE_BY_ID[it.exerciseId].primary.some((m) => requested.has(m)))
    for (const first of choices) {
      const second = choices.find((it) => it.restSec === first.restSec && canPairExercises(first.exerciseId, it.exerciseId))
      if (!second) continue
      pair = [first.exerciseId, second.exerciseId]
      items.splice(items.indexOf(second), 1)
      items.splice(items.indexOf(first) + 1, 0, second)
      break
    }
  }
  const mainLift = anchors.values().next().value
  const lowestPriorityIndex = () => {
    if (!split) return items.length - 1
    const lastFirst = [...items].reverse()
    const cut = lastFirst.find((it) => !anchors.has(it.exerciseId))
      ?? lastFirst.find((it) => it.exerciseId !== mainLift)
      ?? lastFirst[0]
    return items.indexOf(cut)
  }
  let trimmed = false
  // The day's main compounds (the row and the vertical pull, the press and the overhead press), most important first.
  const splitMains = splitDose
    ? (focus === 'push' ? [['horizontal-press', 'incline-press', 'dip'], ['vertical-press']] as Pattern[][] : NAMED_PATTERNS[focus])
      .flatMap((group) => items.filter((it) => anchors.has(it.exerciseId) && group.includes(GYM_EXERCISE_BY_ID[it.exerciseId].pattern)).slice(0, 1))
    : []
  /** A light-pressing day's presses keep the dose the steer gave them: a recovery rail beside a push skill, not a time fit. */
  const heldMain = (it: (typeof items)[number]) => lightPress && steered.has(it.exerciseId)
  /**
   * Push and Pull days (the athlete's rules): the main compounds get the time first and are raised a set at a time,
   * in turn, to `MAIN_COMPOUND_SETS` each; only then does any other movement go in — the athlete's priority muscles
   * first, then the week's, then the day's own order — each at its usual sets, or as few as two, before the next.
   * Trimming runs the other way: the other movements go before a main compound loses a set, and a main compound
   * is dropped only when not even one set of each fits.
   */
  const allocateSplitDay = () => {
    const priorityRank = (it: (typeof items)[number]) => {
      const ex = GYM_EXERCISE_BY_ID[it.exerciseId]
      return ex.primary.some((m) => requested.has(m)) ? 0 : isPriority(ex) ? 1 : 2
    }
    // Speed and power work a power goal puts first keeps its place ahead of the lifts, fresh (`goalEmphasis`).
    const power = items.filter((it) => !splitMains.includes(it) && GYM_EXERCISE_BY_ID[it.exerciseId].explosive)
    const others = items.filter((it) => !splitMains.includes(it) && !power.includes(it))
      .map((it, index) => ({ it, index }))
      .sort((a, b) => priorityRank(a.it) - priorityRank(b.it) || a.index - b.index)
      .map(({ it }) => it)
    const mainsInOrder = items.filter((it) => splitMains.includes(it))
    items.length = 0
    items.push(...power, ...mainsInOrder)
    for (const it of splitMains) if (!heldMain(it)) it.sets = Math.min(it.sets, 3)
    while (total() > minutes) {
      const fast = power.filter((it) => items.includes(it)).reverse()
      const shorter = fast.find((it) => it.sets > 2)
      if (shorter) {
        shorter.sets--
        continue
      }
      if (fast.length) {
        items.splice(items.indexOf(fast[0]), 1)
        dropped.unshift(GYM_EXERCISE_BY_ID[fast[0].exerciseId].name)
        continue
      }
      const lastFirst = [...splitMains].reverse().filter((it) => items.includes(it))
      const cut = lastFirst.find((it) => it.sets > 2) ?? lastFirst.find((it) => it.sets > 1)
      if (cut) {
        cut.sets--
        continue
      }
      if (items.length <= 1) break
      items.splice(items.indexOf(lastFirst[0]), 1)
      dropped.unshift(GYM_EXERCISE_BY_ID[lastFirst[0].exerciseId].name)
    }
    for (let grew = true; grew;) {
      grew = false
      for (const it of splitMains) {
        if (!items.includes(it) || heldMain(it) || it.sets >= MAIN_COMPOUND_SETS) continue
        it.sets++
        if (total() > minutes) it.sets--
        else grew = true
      }
    }
    const mainsFull = splitMains.every((it) => !items.includes(it) || heldMain(it) || it.sets >= MAIN_COMPOUND_SETS)
    for (const it of others) {
      // No muscle past its ceiling for the session (`ceilingOf`), and on a Pull day no more curl sets than back sets:
      // a movement with no room for two sets is not needed today (not a cut for time, so not listed as one).
      const ex = exOf(it)
      const room = Math.min(roomFor(ex), isBicepsIsolation(ex) ? curlRoom() : Infinity)
      if (room < 2) continue
      items.push(it)
      let sets = Math.min(it.sets, room)
      for (; sets >= 2; sets--) {
        it.sets = sets
        if (total() <= minutes) break
      }
      if (!mainsFull || sets < 2) {
        items.pop()
        dropped.push(GYM_EXERCISE_BY_ID[it.exerciseId].name)
      }
    }
    trimmed = dropped.length > 0
  }
  if (splitDose) allocateSplitDay()
  for (const trimPriority of splitDose ? [] : priorityExercises.size ? [false, true] : [false]) {
    if (trimPriority && focus !== 'athletic') {
      for (let i = items.length - 1; i > 0 && items.length > 3 && total() > minutes; i--) {
        const ex = GYM_EXERCISE_BY_ID[items[i].exerciseId]
        const solePriority = ex.primary.some((m) => requested.has(m) &&
          !items.some((it, j) => j !== i && GYM_EXERCISE_BY_ID[it.exerciseId].primary.includes(m)))
        if (protectSets.has(ex.id) || anchors.has(ex.id) || solePriority ||
          (focus === 'lower' && ['hinge', 'knee-flexion'].includes(ex.pattern))) continue
        if (ex.compound && !items.slice(0, i).some((other) => {
          const earlier = GYM_EXERCISE_BY_ID[other.exerciseId]
          return earlier.compound && earlier.primary.some((m) => ex.primary.includes(m))
        })) continue
        dropped.unshift(ex.name)
        items.splice(i, 1)
        trimmed = true
      }
    }
    for (const compound of [false, true]) {
      for (let i = items.length - 1; i >= 0 && total() > minutes; i--) {
        const ex = GYM_EXERCISE_BY_ID[items[i].exerciseId]
        if (protectSets.has(ex.id) !== trimPriority) continue
        if (Boolean(ex.compound) === compound && items[i].sets > 2) {
          const setMinutes = blockMinutes(1, items[i].restSec, ex.dose?.workSec)
          const remove = priorityExercises.size ? Math.ceil((total() - minutes) / setMinutes) : items[i].sets
          items[i] = { ...items[i], sets: Math.max(2, items[i].sets - remove) }
          trimmed = true
        }
      }
    }
  }
  while (!splitDose && items.length && total() > minutes) {
    const cut = lowestPriorityIndex()
    const last = items[cut].exerciseId
    if (split && anchors.has(last)) {
      // Only main movements remain. Keep a set of each if both fit.
      const extra = [...items].reverse().find((it) => it.sets > 1)
      if (extra) {
        extra.sets--
        trimmed = true
        continue
      }
    }
    if (items.length === 1) break
    if (protectSets.has(last) && (!requested.size || GYM_EXERCISE_BY_ID[last].primary.some((m) => requested.has(m)))) {
      // On a very short day a single accessory set can keep a chosen muscle in the program.
      const spareSet = [...items].reverse().find((it) => it.sets > 1 && !anchors.has(it.exerciseId) && !protectSets.has(it.exerciseId))
        ?? items.find((it) => it.sets > 1 && !anchors.has(it.exerciseId))
      if (spareSet) {
        spareSet.sets--
        trimmed = true
        continue
      }
    }
    items.splice(cut, 1)
    dropped.unshift(GYM_EXERCISE_BY_ID[last].name)
    trimmed = true
  }
  if (!splitDose && combinedGoals && trimmed && !introductory && factor >= 1 && total() <= minutes) {
    // Dropping the final movement can free several minutes after sets have already
    // been reduced. Spend those minutes on the athlete's selected lifts first.
    for (const item of items) {
      const ex = GYM_EXERCISE_BY_ID[item.exerciseId]
      if (ex.dose || ex.explosive || spareIn(ex) || !protectSets.has(ex.id) || !ex.primary.some((m) => requested.has(m))) continue
      while (item.sets < 4) {
        item.sets++
        if (total() > minutes) { item.sets--; break }
      }
    }
  }
  const fits = items.length === 0 || total() <= minutes
  if (!fits) {
    for (const it of items) dropped.unshift(GYM_EXERCISE_BY_ID[it.exerciseId].name)
    items.length = 0
  }
  // A long day uses its minutes: when the focus's own slots are placed and time is still there (a few minutes are
  // left unspent, and nothing was trimmed to fit), movements are added for the muscles the session gives least to —
  // the athlete's priorities first, then the focus's own muscles, then the rest of what its slots train. Spared and
  // switched-off muscles, avoided joints and kit all hold, no more pressing or pulling is added than the day is
  // named for, and a short day, which has no such room, builds exactly what it always did.
  let fillNotes = () => {}
  if (focus !== 'athletic' && !introductory && fits && items.length && (splitDose || !trimmed)) {
    const slotPatterns = new Set<Pattern>(SLOTS[focus].flat())
    if ((focus === 'pull' || focus === 'upper') && (input.minutes >= 75 || priority.has('traps'))) slotPatterns.add('shrug')
    if (input.minutes >= 75) {
      slotPatterns.add('core-anti-rotation')
      slotPatterns.add('core-flexion')
    }
    const main = new Set<Muscle>(FOCUS_MAIN[focus])
    const credit = new Map<Muscle, number>()
    // The same shares as weekly volume (`volumeShare`): a pull-up's sets are part, not all, of a biceps dose.
    const addCredit = (ex: GymExercise, sets: number) => {
      for (const m of new Set([...ex.primary, ...ex.secondary])) credit.set(m, (credit.get(m) ?? 0) + sets * volumeShare(ex, m))
    }
    for (const it of items) addCredit(GYM_EXERCISE_BY_ID[it.exerciseId], it.sets)
    const added: GymExercise[] = []
    const limit = ceilingOf
    const differentAccessory = (ex: GymExercise) => {
      if (ex.pattern.startsWith('core-')) {
        const chosen = ex.primary.some((m) => requested.has(m) || (!input.athletePriority && priority.has(m)))
        const core = items.filter((it) => GYM_EXERCISE_BY_ID[it.exerciseId].pattern.startsWith('core-'))
        return (chosen || input.minutes >= 75 || !core.length) &&
          core.filter((it) => GYM_EXERCISE_BY_ID[it.exerciseId].pattern === ex.pattern).length < (chosen ? 2 : 1)
      }
      if (!UPPER_ISOLATION.has(ex.pattern)) return true
      const chosen = ex.primary.some((m) => requested.has(m) || (!input.athletePriority && priority.has(m)))
      const count = items.filter((it) => GYM_EXERCISE_BY_ID[it.exerciseId].pattern === ex.pattern).length
      return count < (chosen ? 2 : 1)
    }
    // A harder day (factor above 1) keeps room above the usual ceiling for its extra sets.
    const ceiling = Math.round(FILL_SESSION_SETS * Math.max(1, factor))
    // Spare time first raises the session's own exercises, a set at a time in the order they were funded, to four
    // sets each (the athlete's rule) — a dose the week's steer, a harder version or a set dose fixed stays as it is,
    // no muscle passes its ceiling, and on a Pull day the curls never outnumber the rows and pull-ups. Only then does
    // a new movement go in.
    for (let grew = true; grew;) {
      grew = false
      for (const it of items) {
        const ex = exOf(it)
        if (it.sets >= MAIN_COMPOUND_SETS || it.finisher || ex.dose || ex.explosive || steered.has(ex.id) || smallDose.has(ex.id)) continue
        if (items.reduce((n, x) => n + x.sets, 0) + 1 > ceiling) break
        if (ex.primary.some((m) => creditOf(m) + volumeShare(ex, m) > limit(m) + 1e-9)) continue
        if (isBicepsIsolation(ex) && curlRoom() < 1) continue
        it.sets++
        if (total() > minutes) {
          it.sets--
          continue
        }
        addCredit(ex, 1)
        grew = true
      }
    }
    /**
     * How a new movement may join: as its own exercise (a new angle, within about two isolation exercises a muscle),
     * as a harder version in small volume, or — an easier version of a movement in the session — only as that
     * movement's one finisher. Never the same rung twice.
     */
    const fillRole = (e: GymExercise) => {
      const r = rungRole(e)
      if (r.role === 'finisher') return items.some((it) => it.finisher?.of === r.of) ? null : r
      if (!joinable(e) || (r.role === 'standalone' && !differentAccessory(e))) return null
      return r
    }
    for (;;) {
      if (trimmed) break
      const room = minutes - FILL_HEADROOM_MIN - total()
      const setsSoFar = items.reduce((n, it) => n + it.sets, 0)
      if (setsSoFar + 2 > ceiling) break
      const candidates = here
        .filter(
          (e) =>
            !used.has(movement(e)) &&
            // The chin-up only ever stands in for the pull-up, never beside it.
            e.id !== 'chin-up' &&
            slotPatterns.has(e.pattern) &&
            !e.explosive &&
            (![PRESSING_PATTERNS, PULLING_PATTERNS].some((f) => f.has(e.pattern)) || FILL_FAMILIES[focus].some((f) => f.has(e.pattern))) &&
            usable(e) &&
            spareIn(e) === 0 &&
            technicalPenalty(e) === 0 &&
            e.primary.every((m) => creditOf(m) < limit(m)) &&
            fillRole(e) !== null,
        )
        .map((e) => {
          const tier = isPriority(e) ? 0 : e.primary.some((m) => (main.size ? main.has(m) : true)) ? 1 : 2
          const least = Math.min(...e.primary.map((m) => credit.get(m) ?? 0))
          return { e, score: tier * 1000 + least * 10 + hardHere(e) * 3 + scoreOf(e, staleness(e)) }
        })
        .sort((a, b) => a.score - b.score)
      let placed = false
      for (const { e } of candidates) {
        const role = fillRole(e)!
        const cap = role.role === 'finisher' ? FINISHER_SETS : role.role === 'harder' ? HARDER_VARIANT_SETS : Infinity
        const want = Math.min(cap, 3 + (isPriority(e) ? 1 : 0))
        const rest = restFor(e, makeItem(e, false, 2).plan)
        const muscleRoom = Math.min(...e.primary.map((m) => (limit(m) - creditOf(m)) / volumeShare(e, m)), isBicepsIsolation(e) ? curlRoom() : Infinity)
        const smallest = role.role === 'standalone' ? 2 : 1
        const sets = [...new Set([want, 3, 2, 1])].find((n) => n >= smallest && n <= want && n <= muscleRoom && setsSoFar + n <= ceiling &&
          blockMinutes(n, rest, e.dose?.workSec) <= room)
        if (sets === undefined) continue
        used.add(movement(e))
        const item: (typeof items)[number] = makeItem(e, false, sets)
        if (role.role === 'finisher') {
          item.finisher = { of: role.of! }
          items.splice(items.findIndex((it) => it.exerciseId === role.of) + 1, 0, item)
        } else items.push(item)
        if (role.role === 'harder') smallDose.add(e.id)
        addCredit(e, sets)
        added.push(e)
        placed = true
        break
      }
      if (!placed) break
    }
    // Said once the day's factor and caps have had their say (`fillNotes`): only what the plan still holds.
    fillNotes = () => {
      const addedNow = added.filter((e) => items.some((it) => it.exerciseId === e.id))
      if (addedNow.length) {
        notes.push(
          `There was time left in the ${minutes} minutes, so ${addedNow.map((e) => e.name).join(', ')} ${addedNow.length === 1 ? 'was' : 'were'} added. These give ${[...new Set(addedNow.flatMap((e) => e.primary))].map((m) => m.replaceAll('-', ' ')).join(', ')} more work on this ${FOCUS_LABEL[focus].toLowerCase()} day.`,
        )
      }
    }
  }
  // The day's factor works on the fitted session, so it changes the sets and not only the effort:
  // a lighter day keeps about that share of the usual working sets (taken off the lifts first, then
  // the last lifts), and a harder one adds a set at a time while the minutes allow — never fewer.
  const setCount = () => items.reduce((n, it) => n + it.sets, 0)
  if (items.length && factor < 1) {
    const target = Math.max(1, Math.floor(setCount() * factor + 0.25))
    // Finishers are the first thing a lighter day gives up.
    for (let i = items.length - 1; i >= 0 && setCount() > target; i--) {
      if (items[i].finisher) dropped.unshift(GYM_EXERCISE_BY_ID[items.splice(i, 1)[0].exerciseId].name)
    }
    while (splitDose && setCount() > target) {
      // A lighter Push or Pull day gives up the other movements' sets first, down to two, then those movements from
      // the last; only then the main compounds' sets, the larger and later first, and never the first of them.
      const lastFirst = [...items].reverse()
      const other = lastFirst.find((it) => !anchors.has(it.exerciseId) && it.sets > 2) ?? lastFirst.find((it) => !anchors.has(it.exerciseId))
      if (other && other.sets > 2) other.sets--
      else if (other) {
        items.splice(items.indexOf(other), 1)
        dropped.unshift(GYM_EXERCISE_BY_ID[other.exerciseId].name)
      } else {
        // Most important first (`splitMains`): the last of them gives up a set on a tie, and goes first.
        const mains = splitMains.map((m) => items.find((it) => it.exerciseId === m.exerciseId)).filter((it) => it !== undefined).reverse()
        if (!mains.length) break
        const main = mains.reduce((a, b) => (b.sets > a.sets ? b : a))
        if (main.sets > 1) main.sets--
        else if (items.length > 1) {
          items.splice(items.indexOf(mains[0]), 1)
          dropped.unshift(GYM_EXERCISE_BY_ID[mains[0].exerciseId].name)
        } else break
      }
    }
    while (setCount() > target) {
      let cut = -1
      let best = -Infinity
      items.forEach((it, i) => {
        const ex = GYM_EXERCISE_BY_ID[it.exerciseId]
        if (it.sets <= 1) return
        const score = it.sets - (isPriority(ex) ? 1 : 0) + (ex.compound ? 0 : 0.3) + i * 0.01
        if (score > best) {
          best = score
          cut = i
        }
      })
      if (cut >= 0) items[cut] = { ...items[cut], sets: items[cut].sets - 1 }
      else if (items.length > 1) {
        const [removed] = items.splice(lowestPriorityIndex(), 1)
        dropped.unshift(GYM_EXERCISE_BY_ID[removed.exerciseId].name)
      }
      else break
    }
  } else if (items.length && factor > 1 && !introductory) {
    for (let i = 0; i < items.length; i++) {
      const ex = GYM_EXERCISE_BY_ID[items[i].exerciseId]
      if (ex.dose || steered.has(ex.id) || smallDose.has(ex.id) || items[i].finisher) continue
      if (total() + blockMinutes(1, items[i].restSec) > minutes) break
      items[i] = { ...items[i], sets: items[i].sets + 1 }
    }
  }
  const buildUpLimit = input.capacity?.buildUpSetLimit
  // A Push or Pull day's priorities change its order and sets inside `allocateSplitDay`; they never take a main compound's sets.
  if (!split && !introductory && factor >= 1 && !avoid.size && focus !== 'athletic' && input.weeklyPriority?.length) {
    const behind = input.weeklyPriority.filter((m) => requested.has(m) ||
      (combinedGoals && ((m === 'chest' || m === 'lats') && (focus === 'upper' || focus === 'full') ||
        (m === 'quads' || m === 'hamstrings') && (focus === 'lower' || focus === 'full'))))
    const withinBudget = () => total() <= minutes && setCount() <= Math.min(FILL_SESSION_SETS, buildUpLimit ?? Infinity)
    const fund = (muscle: Muscle) => {
      if (withinBudget()) return true
      for (let i = items.length - 1; i >= 0; i--) {
        const donor = items[i]
        const e = GYM_EXERCISE_BY_ID[donor.exerciseId]
        if (e.primary.includes(muscle) || e.explosive) continue
        const chosen = e.primary.filter((m) => requested.has(m))
        if (chosen.length && requested.has(muscle)) continue
        const before = donor.sets
        const optional = !e.compound && !anchors.has(e.id) && !['knee-flexion', 'knee-extension'].includes(e.pattern)
        // When a basic lift has fewer than four sets, a priority that already
        // has a full dose can lend a set while keeping its first four.
        const surplus = chosen.map((m) => items.reduce((n, it) => n + (GYM_EXERCISE_BY_ID[it.exerciseId].primary.includes(m) ? it.sets : 0), 0) - 4)
        const floor = Math.max(optional ? 0 : 2, before - Math.min(...surplus))
        while (donor.sets > floor) {
          donor.sets--
          if (!donor.sets) items.splice(i, 1)
          if (withinBudget()) return true
        }
        if (!donor.sets) items.splice(i, 0, donor)
        donor.sets = before
      }
      return false
    }
    let selectedAdded = 0
    let otherAdded = 0
    for (const m of behind) {
      let added = requested.has(m) ? selectedAdded : otherAdded
      const working = items.filter((it) => {
        const e = GYM_EXERCISE_BY_ID[it.exerciseId]
        return e.primary.includes(m) && !e.dose && !e.explosive && !spareIn(e) && !steered.has(e.id)
      })
      let direct = items.reduce((n, it) => n + (GYM_EXERCISE_BY_ID[it.exerciseId].primary.includes(m) ? it.sets : 0), 0)
      for (const it of working) {
        const target = requested.has(m) ? 6 : 4
        while (direct < target && it.sets < 5 && added < (requested.has(m) ? 3 : 2)) {
          it.sets++
          if (!fund(m)) { it.sets--; break }
          direct++
          added++
        }
      }
      if (requested.has(m) && combinedGoals && direct >= 3 && direct < 6 && working.length === 1 && added < 3) {
        const movements = new Set(items.map((it) => movement(GYM_EXERCISE_BY_ID[it.exerciseId])))
        const options = here.filter((e) => !e.compound && !e.dose && !e.explosive && !movements.has(movement(e)) &&
          e.primary.includes(m) && usable(e) && joinable(e) && rungRole(e).role === 'standalone' && !technicalPenalty(e) && !spareIn(e))
        const pick = options.sort((a, b) => scoreOf(a) - scoreOf(b))[0]
        if (pick) {
          const item = makeItem(pick, false, 2)
          const moved = Math.max(0, direct + item.sets - 6)
          working[0].sets -= moved
          items.push(item)
          if (fund(m)) added += item.sets - moved
          else { items.pop(); working[0].sets += moved }
        }
      }
      if (requested.has(m)) selectedAdded = added
      else otherAdded = added
    }
  }
  const capped = buildUpLimit !== undefined && focus !== 'athletic' && setCount() > buildUpLimit
  if (capped) {
    const chosen = (id: string) => protectSets.has(id) && GYM_EXERCISE_BY_ID[id].primary.some((m) => requested.has(m))
    for (let i = items.length - 1; i >= 0 && setCount() > buildUpLimit; i--) {
      if (items[i].finisher) items.splice(i, 1)
    }
    while (splitDose && items.length && setCount() > buildUpLimit) {
      // A Push or Pull day keeps its main compounds longest: the other movements give up sets to two, then their
      // places from the last, before a main compound loses a set (the larger first), and the first one stays.
      const lastFirst = [...items].reverse()
      const other = lastFirst.find((it) => !anchors.has(it.exerciseId) && it.sets > 2) ?? lastFirst.find((it) => !anchors.has(it.exerciseId))
      if (other && other.sets > 2) other.sets--
      else if (other) {
        items.splice(items.indexOf(other), 1)
        dropped.unshift(GYM_EXERCISE_BY_ID[other.exerciseId].name)
      } else {
        const mains = splitMains.map((m) => items.find((it) => it.exerciseId === m.exerciseId)).filter((it) => it !== undefined).reverse()
        if (!mains.length) break
        const main = mains.reduce((a, b) => (b.sets > a.sets ? b : a))
        if (main.sets > 1) main.sets--
        else if (items.length > 1) {
          items.splice(items.indexOf(mains[0]), 1)
          dropped.unshift(GYM_EXERCISE_BY_ID[mains[0].exerciseId].name)
        } else break
      }
    }
    while (items.length && setCount() > buildUpLimit) {
      const lastFirst = [...items].reverse()
      const ordinary = lastFirst.filter((it) => !chosen(it.exerciseId))
      const extra = ordinary.find((it) => it.sets > 3) ?? ordinary.find((it) => it.sets > 2)
      if (extra) { extra.sets--; continue }
      // Keep a direct lift for each chosen muscle and the movements the visit
      // is named for. A second angle or an optional accessory can give up its
      // place before every priority lift spends weeks at two sets.
      const prioritySet = lastFirst.find((it) => chosen(it.exerciseId) && it.sets > 2)
      const accessory = prioritySet && items.length > 4 && ordinary.find((it) => !anchors.has(it.exerciseId) &&
        !((focus === 'full' || focus === 'lower') && GYM_EXERCISE_BY_ID[it.exerciseId].pattern === 'hinge'))
      if (accessory) {
        if (setCount() - accessory.sets >= buildUpLimit) items.splice(items.indexOf(accessory), 1)
        else accessory.sets -= setCount() - buildUpLimit
      } else if (prioritySet) prioritySet.sets--
      else items.splice(lowestPriorityIndex(), 1)
    }
    notes.push(`Your recent lifting supports up to ${buildUpLimit} working sets this visit. Completing that amount comfortably on two days helps build up the next sessions.`)
  }
  const strongerLegWork = [...legPractice].flatMap(([base, practice]) => practice.working ? [{ base, ...practice.working }] : [])
  const reported = input.capacity?.reportedPullups
  for (const id of [...UNASSISTED_LIFTS, ...(reported ? ['chin-up', 'neutral-pull-up'] : []), ...strongerLegWork.map((w) => w.id)]) {
    const item = items.find((it) => it.exerciseId === id)
    if (!item) continue
    const leg = strongerLegWork.find((w) => w.id === id)
    const work = id === 'push-up' || id === 'pull-up' ? input.capacity?.unassistedWork?.[id]
      : leg ? { reps: Array<number>(leg.sets).fill(leg.reps), manageable: true, hard: false } : undefined
    const reportedDose = reported && ['pull-up', 'chin-up', 'neutral-pull-up'].includes(id)
      ? { sets: Math.min(item.sets, reported < 3 ? 1 : 3), reps: Math.max(1, Math.min(item.plan.range[1], Math.floor(reported * 2 / 3))) } : undefined
    const dose = reportedDose ?? (work ? unassistedDose(work, item.sets, item.plan.range[0]) :
      id === 'pull-up' && input.capacity?.tryPullup ? { sets: 1, reps: 1 } : undefined)
    if (!dose) continue
    const easier = here.filter((ex) => (ex.id === leg?.base || preparesFor(ex.id) === id || (id === 'pull-up' && ex.id === 'assisted-pull-up')) && usable(ex) && !spareIn(ex))
      .sort((a, b) => scoreOf(a) - scoreOf(b) || (lastLogged.get(b.id) ?? 0) - (lastLogged.get(a.id) ?? 0))[0]
    const backoffSets = item.sets - dose.sets
    item.sets = dose.sets
    item.plan = { range: [dose.reps, dose.reps], targetRpe: Math.min(7, item.plan.targetRpe) }
    item.practice = { easierId: easier?.id }
    if (easier && backoffSets > 0) {
      // The easier version is that lift's drop-set finisher, one or two sets straight after it — never a separate
      // exercise, even when it was already in the session on its own.
      const existing = items.find((it) => it.exerciseId === easier.id)
      if (existing) items.splice(items.indexOf(existing), 1)
      const backoff: (typeof items)[number] = existing ?? makeItem(easier, false, backoffSets)
      backoff.sets = Math.min(FINISHER_SETS, backoffSets + (existing?.sets ?? 0))
      backoff.restSec = Math.min(backoff.restSec, item.restSec)
      backoff.finisher = { of: item.exerciseId }
      items.splice(items.indexOf(item) + 1, 0, backoff)
    }
  }
  // A rule, not the clock: a curl it removes is not listed as left out to fit the time.
  if (focus === 'pull') capBicepsIsolation(items)
  if (splitDose) {
    // The session runs as it was funded: speed and power work while fresh, the main compounds (an easier back-off
    // right behind its lift), any other compound, the isolation work in the athlete's order, then core work nobody
    // asked for.
    const backoffs = new Set(items.flatMap((it) => it.practice?.easierId ? [it.practice.easierId] : []))
    const stage = (it: (typeof items)[number]) => {
      const ex = GYM_EXERCISE_BY_ID[it.exerciseId]
      if (ex.explosive) return -1
      if (anchors.has(ex.id) || backoffs.has(ex.id)) return 0
      if (ex.compound) return 1
      return ex.pattern.startsWith('core-') && !isPriority(ex) ? 3 : 2
    }
    items.sort((a, b) => stage(a) - stage(b))
  }
  if (focus !== 'athletic') fatigueOrder(items)
  if (pair) {
    const [a, b] = pair
    const first = items.find((it) => it.exerciseId === a), second = items.find((it) => it.exerciseId === b)
    // A pair is done as one block: the reorder above never parts them. The earlier one joins the later one, so
    // neither moves ahead of a compound it was placed after.
    if (first && second && items.indexOf(second) !== items.indexOf(first) + 1) {
      if (items.indexOf(first) < items.indexOf(second)) {
        items.splice(items.indexOf(first), 1)
        items.splice(items.indexOf(second), 0, first)
      } else {
        items.splice(items.indexOf(second), 1)
        items.splice(items.indexOf(first) + 1, 0, second)
      }
    }
    if (first && second) {
      first.pairedWith = second.exerciseId
      second.pairedWith = first.exerciseId
      notes.push(`Alternate one set of ${GYM_EXERCISE_BY_ID[first.exerciseId].name.toLowerCase()} with one set of ${GYM_EXERCISE_BY_ID[second.exerciseId].name.toLowerCase()}. Allow 20 seconds to switch and at least ${first.restSec} seconds before repeating a lift. Straight sets are available during the workout.`)
    }
  }
  // A finisher only ever follows the movement it finishes, straight after it — or it goes. It is also the first
  // thing to give way when the minutes run over.
  for (const finisher of items.filter((it) => it.finisher)) {
    items.splice(items.indexOf(finisher), 1)
    const parent = items.findIndex((it) => it.exerciseId === finisher.finisher!.of)
    if (parent >= 0) items.splice(parent + 1, 0, finisher)
  }
  for (let i = items.length - 1; i >= 0 && total() > minutes; i--) if (items[i].finisher) items.splice(i, 1)
  fillNotes()
  if (cappedAt !== undefined && items.length) {
    notes.push(`Lifting is capped at about ${cappedAt} of your ${input.minutes} minutes (a coaching convention, not a measured limit): accessories and finishers give way before any main lift.`)
  }
  const setLimit = introductory ? 8 : capped ? buildUpLimit : undefined
  return { name: FOCUS_LABEL[focus], focus, items, dropped, estimatedMin: items.length ? Math.round(total()) : 0, fits, notes,
    ...(setLimit !== undefined ? { setLimit } : {}), ...(cappedAt !== undefined ? { cappedAt } : {}) }
}

export function buildGymSession(input: GymSessionInput): GymPlan {
  const now = input.now ?? Date.now()
  const session = planGymExercises({ ...input, now })
  const items = session.items.map((item) => ({
    ...item,
    suggestion: suggestLoad({ exerciseId: item.exerciseId, location: input.location, sessions: input.sessions, plan: item.plan, youth: input.youth, now }),
  }))
  for (const item of items) if (item.practice) {
    const reps = item.plan.range[0]
    const firstPull = item.exerciseId === 'pull-up' && input.capacity?.tryPullup
    const reported = input.capacity?.reportedPullups
    const basis = reported && ['pull-up', 'chin-up', 'neutral-pull-up'].includes(item.exerciseId)
      ? `You reported ${reported} recent strict ${reported === 1 ? 'pull-up' : 'pull-ups'}.`
      : firstPull ? 'Your last machine sets used zero assistance.' : 'Your recent unassisted sets guide this starting dose.'
    item.suggestion = { ...item.suggestion, reps: item.plan.range, targetReps: reps, kind: 'bodyweight',
      why: `${basis} Aim for ${reps} clean ${reps === 1 ? 'rep' : 'reps'} per set with a little in reserve.`, easierId: item.practice.easierId }
  }
  applyBodyweightTrials(items, input, now)
  return { ...session, items }
}

type TrialInput = Pick<GymSessionInput, 'location' | 'sessions' | 'capacity' | 'volumeFactor' | 'ratings' | 'avoidJoints' | 'musclesOff'>

/** The same optional variation and fallback reps in a workout and its post-session guidance. */
export function applyBodyweightTrials(items: Pick<PlannedExercise, 'exerciseId' | 'sets' | 'suggestion'>[], input: TrialInput, now: number) {
  for (const id of UNASSISTED_LIFTS) {
    const target = id === 'push-up' ? input.capacity?.floorPushupTrial : input.capacity?.pullupTrial
    const ex = GYM_EXERCISE_BY_ID[id]
    if (!target || (input.volumeFactor ?? 1) < 1 || input.ratings?.[id] === 'avoid' || input.location?.hardHere?.includes(id) || !canDoHere(id, input.location) ||
        jointsToRest(id).some((j) => input.avoidJoints?.includes(j)) || ex.primary.some((m) => input.musclesOff?.includes(m)) || items.some((it) => it.exerciseId === id)) continue
    const prep = items.find((it) => preparesFor(it.exerciseId) === id && it.sets >= 2)
    if (!prep) continue
    const name = id === 'push-up' ? 'floor push-up' : 'unassisted pull-up'
    prep.suggestion = { ...prep.suggestion, ...(id === 'push-up' ? { floorPushupTrial: target } : { pullupTrial: target }),
      why: `Your recent preparation sets were manageable. You can try up to ${target} clean ${name}${target === 1 ? '' : 's'} for one set, then return to ${GYM_EXERCISE_BY_ID[prep.exerciseId].name.toLowerCase()}.` }
  }
  if ((input.volumeFactor ?? 1) >= 1) {
    const recent = legPracticeAt(input.sessions, input.location?.id, now)
    for (const item of items) {
      const practice = recent.get(item.exerciseId)
      if (!practice?.baseReps || practice.working || item.sets < 2 || item.suggestion.kg) continue
      const id = LEG_VARIATIONS[item.exerciseId]?.find((id) => canDoHere(id, input.location) &&
        !items.some((it) => it.exerciseId === id) && !input.location?.hardHere?.includes(id) && input.ratings?.[id] !== 'avoid' &&
        !jointsToRest(id).some((j) => input.avoidJoints?.includes(j)) && !GYM_EXERCISE_BY_ID[id].primary.some((m) => input.musclesOff?.includes(m)))
      const reps = Math.min(practice.baseReps, 30)
      item.suggestion = { ...item.suggestion, targetReps: reps,
        why: `You completed at least ${practice.baseReps} controlled reps in each working set.${id ? ` Try one set of ${GYM_EXERCISE_BY_ID[id].name.toLowerCase()} for up to 6 reps per side, or repeat your usual movement.` : ` Aim for ${reps} with the same control.`}`,
        ...(id ? { variationTrial: { id, reps: 6 } } : {}) }
    }
  }
}
