import type { Joint, Muscle, Pattern } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID, type GymExercise } from '../../data/gym/exercises'
import { availableAt, preferenceRank } from './availability'
import { repPlanFor, suggestLoad, type LoadSuggestion, type RepPlan } from './progression'
import type { GoalWeights, GymLocation, GymSession, Rating } from './types'

export type GymFocus = 'full' | 'upper' | 'lower' | 'push' | 'pull'

export const FOCUS_LABEL: Record<GymFocus, string> = {
  full: 'Full body',
  upper: 'Upper body',
  lower: 'Lower body',
  push: 'Push',
  pull: 'Pull',
}

/**
 * Slots in priority order: the first ones are the session, the last ones are
 * what a short session gives up first. Each slot is filled by one movement
 * from its patterns that can be done at the location.
 */
const SLOTS: Record<GymFocus, Pattern[][]> = {
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
  if (ex.explosive) return 120
  if (!ex.compound) return 75
  return plan.range[1] <= 6 ? 180 : 120
}

/** Minutes a block takes: each set's work plus the rest after it. */
function blockMinutes(sets: number, restSec: number): number {
  return (sets * (40 + restSec)) / 60
}

const WARM_UP_MIN = 6

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
    !e.primary.some((m) => musclesOff.has(m)) && !e.stress.some((j) => avoid.has(j)) && ratings[e.id] !== 'avoid'
  const focus = input.focus ?? nextFocus(sessions, now)
  const here = availableAt(location)
  const used = new Set<string>()
  const items: PlannedExercise[] = []
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
          (e.primary.some((m) => priority.has(m)) ? 1 : 0),
      }))
      .sort((a, b) => a.score - b.score)
    const pick = ranked[0]?.e
    if (!pick) continue
    used.add(pick.id)
    const base = repPlanFor(pick, wantsExplosive ? 'power' : emphasisOf(pick), youth)
    const plan = factor < 1 ? { ...base, targetRpe: Math.max(6, base.targetRpe - 1) } : base
    const sets = Math.max(2, Math.round((3 + (pick.primary.some((m) => priority.has(m)) ? 1 : 0)) * factor))
    items.push({
      exerciseId: pick.id,
      sets,
      plan,
      suggestion: suggestLoad({ exerciseId: pick.id, location, sessions, plan, youth, now }),
      restSec: restFor(pick, plan),
    })
  }
  // Fit the time: give up the last slots first, then trim isolation work to two sets.
  const dropped: string[] = []
  const total = () => WARM_UP_MIN + items.reduce((m, it) => m + blockMinutes(it.sets, it.restSec), 0)
  while (items.length > 2 && total() > minutes) {
    const gone = items.pop()!
    dropped.unshift(GYM_EXERCISE_BY_ID[gone.exerciseId].name)
  }
  for (let i = items.length - 1; i >= 0 && total() > minutes; i--) {
    if (!GYM_EXERCISE_BY_ID[items[i].exerciseId].compound && items[i].sets > 2) items[i] = { ...items[i], sets: 2 }
  }
  return { name: FOCUS_LABEL[focus], focus, items, dropped, estimatedMin: Math.round(total()) }
}
