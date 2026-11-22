import type { Joint, Muscle, Pattern } from '../../data/gym/catalog'
import { athleticDomain, GYM_EXERCISE_BY_ID, type AthleticDomain, type GymExercise, type IntensityTier } from '../../data/gym/exercises'
import { availableAt, preferenceRank } from './availability'
import { gateTier, plyoGate, repPlanFor, suggestLoad, TIER_RANK, type LoadSuggestion, type RepPlan } from './progression'
import type { GoalWeights, GymLocation, GymSession, Rating } from './types'

export type GymFocus = 'full' | 'upper' | 'lower' | 'push' | 'pull' | 'athletic'

export const FOCUS_LABEL: Record<GymFocus, string> = {
  full: 'Full body',
  upper: 'Upper body',
  lower: 'Lower body',
  push: 'Push',
  pull: 'Pull',
  athletic: 'Speed & power',
}

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

export interface PlannedExercise {
  exerciseId: string
  sets: number
  plan: RepPlan
  suggestion: LoadSuggestion
  restSec: number
}

export interface GymPlan {
  name: string
  focus: GymFocus
  items: PlannedExercise[]
  /** Exercises left out to fit the time, by name. */
  dropped: string[]
  estimatedMin: number
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

const WARM_UP_MIN = 6
/** The speed and power session's own drills are its warm-up. */
const ATHLETIC_WARM_UP_MIN = 2

/** Which focus comes next: the part of the body trained longest ago at the gym. */
export function nextFocus(sessions: GymSession[], now = Date.now()): GymFocus {
  const recent = sessions.filter((s) => s.startedAt < now).slice(-6)
  if (!recent.length) return 'full'
  const last = recent[recent.length - 1]
  const name = last.name.toLowerCase()
  if (name.startsWith('upper')) return 'lower'
  if (name.startsWith('lower')) return 'upper'
  if (name.startsWith('push')) return 'pull'
  if (name.startsWith('pull')) return 'lower'
  return 'full'
}

/**
 * Today's gym session for a location and a time budget. Every pick can be
 * done here; avoided movements are never chosen while another fills the slot;
 * loved ones win ties; anything marked hard to do here comes last. Under 18,
 * a movement that needs coaching is only picked when nothing else fills the
 * slot or the athlete loves it.
 */
export function buildGymSession(input: {
  location: GymLocation | undefined
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
  /** Joints to keep load off today (a pain report or a niggle). */
  avoidJoints?: Joint[]
  /** Below 1 on a lighter day: fewer sets, stopping a rep further from failure. */
  volumeFactor?: number
  now?: number
}): GymPlan {
  const { location, minutes, sessions, ratings = {}, youth = false, now = Date.now() } = input
  const musclesOff = new Set(input.musclesOff ?? [])
  const priority = new Set(input.priority ?? [])
  const avoid = new Set(input.avoidJoints ?? [])
  const factor = input.volumeFactor ?? 1
  const goalEmphasis = input.goals
    ? {
        compound: (input.goals.endurance > Math.max(input.goals.strength, input.goals.physique)
          ? 'endurance'
          : input.goals.strength > input.goals.physique
            ? 'strength'
            : 'muscle') as 'strength' | 'muscle' | 'endurance',
        isolation: (input.goals.endurance > input.goals.physique ? 'endurance' : 'muscle') as 'muscle' | 'endurance',
        power: input.goals.power >= 3,
      }
    : null
  const emphasisOf = (e: GymExercise) =>
    input.emphasis ?? (goalEmphasis ? (e.compound ? goalEmphasis.compound : goalEmphasis.isolation) : 'muscle')
  const usable = (e: GymExercise) =>
    !e.primary.some((m) => musclesOff.has(m)) &&
    !e.stress.some((j) => avoid.has(j)) &&
    ratings[e.id] !== 'avoid' &&
    // Speed and power work is built up to, never started at the top (see plyoGate).
    plyoGate(e, sessions, youth, now).allowed
  const focus = input.focus ?? nextFocus(sessions, now)
  const here = availableAt(location)
  const used = new Set<string>()
  const items: PlannedExercise[] = []
  // The day each movement was last logged, so rotation prefers what was done longest ago.
  const lastLogged = new Map<string, number>()
  for (const s of sessions) {
    if (s.startedAt >= now) continue
    for (const log of s.exercises) if (log.sets.length) lastLogged.set(log.exerciseId, Math.max(lastLogged.get(log.exerciseId) ?? 0, s.startedAt))
  }
  const staleness = (e: GymExercise) => ((lastLogged.get(e.id) ?? 0) === 0 ? -0.2 : -Math.min(0.2, (now - (lastLogged.get(e.id) ?? now)) / (60 * 86_400_000)))
  const isPriority = (e: GymExercise) => e.primary.some((m) => priority.has(m))
  const makeItem = (pick: GymExercise, wantsExplosive: boolean, sets?: number): PlannedExercise => {
    const base = repPlanFor(pick, wantsExplosive ? 'power' : emphasisOf(pick), youth)
    const plan = factor < 1 ? { ...base, targetRpe: Math.max(6, base.targetRpe - 1) } : base
    return {
      exerciseId: pick.id,
      sets: sets ?? Math.max(2, Math.round((3 + (isPriority(pick) ? 1 : 0)) * factor)),
      plan,
      suggestion: suggestLoad({ exerciseId: pick.id, location, sessions, plan, youth, now }),
      restSec: restFor(pick, plan),
    }
  }
  const scoreOf = (e: GymExercise, extra = 0) =>
    preferenceRank(e.id, ratings, location) + (youth && e.technical && ratings[e.id] !== 'love' ? 5 : 0) + (e.compound ? 0 : 0.25) - (isPriority(e) ? 1 : 0) + extra

  if (focus === 'athletic') {
    // Fresh and fast first, strength last: drills, then jumps, then runs and throws, then one lift.
    const take = (e: GymExercise | undefined, sets?: number) => {
      if (!e) return
      used.add(e.id)
      items.push(makeItem(e, false, sets))
    }
    const fromDomain = (domain: AthleticDomain, patterns: Pattern[], cap: IntensityTier) => {
      const pool = here.filter(
        (e) => !used.has(e.id) && patterns.includes(e.pattern) && athleticDomain(e) === domain && usable(e) && TIER_RANK[gateTier(e)!] <= TIER_RANK[cap],
      )
      if (!pool.length) return undefined
      // The highest tier allowed today; inside it the one done longest ago wins.
      const top = Math.max(...pool.map((e) => TIER_RANK[gateTier(e)!]))
      const ranked = pool
        .filter((e) => TIER_RANK[gateTier(e)!] === top)
        .sort((a, b) => scoreOf(a, staleness(a)) - scoreOf(b, staleness(b)) || (b.rung ?? 0) - (a.rung ?? 0))
      return ranked[0]
    }
    // A lighter day has no maximal or high-impact work.
    let cap: IntensityTier = factor < 1 ? 'medium' : 'high'
    const dose = (e: GymExercise | undefined) => (e?.dose ? Math.max(1, Math.round(e.dose.sets * factor)) : undefined)
    // Warm-up drills: one gentle, one at the highest tier allowed (never above medium).
    const drillPool = here.filter((e) => e.pattern === 'drill' && usable(e))
    const gentle = drillPool.filter((e) => e.tier === 'low').sort((a, b) => scoreOf(a, staleness(a)) - scoreOf(b, staleness(b)))[0]
    take(gentle, 2)
    const upper = drillPool.filter((e) => e.tier === 'medium' && !used.has(e.id)).sort((a, b) => (b.rung ?? 0) - (a.rung ?? 0) || scoreOf(a) - scoreOf(b))[0]
    take(upper ?? drillPool.filter((e) => !used.has(e.id)).sort((a, b) => scoreOf(a, staleness(a)) - scoreOf(b, staleness(b)))[0], 2)
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
        .filter((e) => slot.includes(e.pattern) && !used.has(e.id) && !e.explosive && !athleticDomain(e) && usable(e))
        .map((e) => ({ e, score: scoreOf(e, staleness(e)) + slot.indexOf(e.pattern) * 0.5 }))
        .sort((a, b) => a.score - b.score)
      if (options.length) {
        take(options[0].e)
        break
      }
    }
  } else {
    const slots: Pattern[][] = [...SLOTS[focus]]
    // Explosive work goes first, fresh, when power is a goal (and the legs are on).
    if (goalEmphasis?.power && focus !== 'pull' && !musclesOff.has('quads')) slots.unshift(['jump', 'throw'])
    for (const slot of slots) {
      const wantsExplosive = slot.includes('jump') || slot.includes('throw')
      // Avoided means avoided: a slot nothing else can fill is left out.
      const options = here.filter(
        (e) => slot.includes(e.pattern) && !used.has(e.id) && (wantsExplosive ? e.explosive : !e.explosive) && usable(e),
      )
      const ranked = options
        .map((e) => ({
          e,
          score:
            preferenceRank(e.id, ratings, location) +
            (youth && e.technical && ratings[e.id] !== 'love' ? 5 : 0) +
            // Within a slot the earlier-listed pattern is the one the slot is for.
            slot.indexOf(e.pattern) * 0.5 +
            (e.compound ? 0 : 0.25) -
            (isPriority(e) ? 1 : 0) +
            // Without a tier ladder to climb, prefer the gentler jump or throw.
            (e.tier ? TIER_RANK[gateTier(e)!] * 0.25 : 0),
        }))
        .sort((a, b) => a.score - b.score)
      const pick = ranked[0]?.e
      if (!pick) continue
      used.add(pick.id)
      items.push(makeItem(pick, wantsExplosive))
    }
  }
  // Fit the time: give up the last slots first, then trim isolation work to two sets.
  const dropped: string[] = []
  const warm = focus === 'athletic' ? ATHLETIC_WARM_UP_MIN : WARM_UP_MIN
  const total = () =>
    warm + items.reduce((m, it) => m + blockMinutes(it.sets, it.restSec, GYM_EXERCISE_BY_ID[it.exerciseId].dose?.workSec), 0)
  while (items.length > 2 && total() > minutes) {
    const gone = items.pop()!
    dropped.unshift(GYM_EXERCISE_BY_ID[gone.exerciseId].name)
  }
  for (let i = items.length - 1; i >= 0 && total() > minutes; i--) {
    if (!GYM_EXERCISE_BY_ID[items[i].exerciseId].compound && items[i].sets > 2) items[i] = { ...items[i], sets: 2 }
  }
  return { name: FOCUS_LABEL[focus], focus, items, dropped, estimatedMin: Math.round(total()) }
}
