import type { Joint, Muscle, Pattern } from '../../data/gym/catalog'
import { athleticDomain, GYM_EXERCISE_BY_ID, type AthleticDomain, type GymExercise, type IntensityTier } from '../../data/gym/exercises'
import { availableAt, preferenceRank } from './availability'
import { gateTier, liftTrend, plyoGate, repPlanFor, STALL_SESSIONS, suggestLoad, TIER_RANK, type LoadSuggestion, type RepPlan } from './progression'
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
/** The speed and power session's own drills are its warm-up. */
const ATHLETIC_WARM_UP_MIN = 2

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
  /** Where each movement is liked best (`gym.favoriteAt`): it wins its slot at that place. */
  favoriteAt?: Record<string, string>
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
  const focus = input.focus ?? nextFocus(sessions, now, input.musclesOff)
  const here = availableAt(location)
  const used = new Set<string>()
  const items: PlannedExercise[] = []
  const notes: string[] = []
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
  // A movement the athlete likes best at this very place wins its slot there.
  const favouriteHere = (e: GymExercise) => (location !== undefined && input.favoriteAt?.[e.id] === location.id ? FAVOURITE_HERE_BONUS : 0)
  // A movement that needs coaching is never a first pick: last for under-18s, and for anyone who has
  // not logged it yet, unless they rated it love.
  const technicalPenalty = (e: GymExercise) =>
    e.technical && ratings[e.id] !== 'love' && (youth || !lastLogged.has(e.id)) ? 5 : 0
  const scoreOf = (e: GymExercise, extra = 0) =>
    preferenceRank(e.id, ratings, location) +
    technicalPenalty(e) +
    (e.compound ? 0 : 0.25) -
    (isPriority(e) ? 1 : 0) -
    favouriteHere(e) +
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
      // The highest tier allowed today; inside it the ladder is climbed in order.
      const top = Math.max(...pool.map((e) => TIER_RANK[gateTier(e)!]))
      return pool.filter((e) => TIER_RANK[gateTier(e)!] === top).sort(ladder)[0]
    }
    // A lighter day has no maximal or high-impact work.
    let cap: IntensityTier = factor < 1 ? 'medium' : 'high'
    const dose = (e: GymExercise | undefined) => (e?.dose ? Math.max(1, Math.round(e.dose.sets * factor)) : undefined)
    // Warm-up drills: one gentle, one at the highest tier allowed (never above medium).
    const drillPool = here.filter((e) => e.pattern === 'drill' && usable(e))
    const gentle = drillPool.filter((e) => e.tier === 'low').sort(ladder)[0]
    take(gentle, 2)
    const upper = drillPool.filter((e) => e.tier === 'medium' && !used.has(e.id)).sort(ladder)[0]
    take(upper ?? drillPool.filter((e) => !used.has(e.id)).sort(ladder)[0], 2)
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
            technicalPenalty(e) -
            favouriteHere(e) +
            // Within a slot the earlier-listed pattern is the one the slot is for.
            slot.indexOf(e.pattern) * 0.5 +
            (e.compound ? 0 : 0.25) -
            (isPriority(e) ? 1 : 0) +
            // Without a tier ladder to climb, prefer the gentler jump or throw.
            (e.tier ? TIER_RANK[gateTier(e)!] * 0.25 : 0),
        }))
        .sort((a, b) => a.score - b.score)
      const first = ranked[0]
      if (!first) continue
      let pick = first.e
      // A lift that has stopped progressing lends its slot to a variation of
      // the same movement for a while: a change of exercise is a common way to
      // restart progress (CONSENSUS). Only a close fit — never one that is
      // hard to do here, or coached-only under 18 — and never a favourite.
      if (!wantsExplosive && ratings[pick.id] !== 'love' && liftTrend(sessions, pick.id, now).status === 'stalled') {
        const alt = ranked.find(
          (r) => r.e.id !== first.e.id && r.e.pattern === first.e.pattern && r.score <= first.score + 1.5 && liftTrend(sessions, r.e.id, now).status !== 'stalled',
        )
        if (alt) {
          notes.push(
            `${first.e.name} has not beaten its best in its last ${STALL_SESSIONS} sessions, so ${alt.e.name} takes its place for now — changing the variation is a common way to restart progress (a coaching convention, not a proven rule). Swap back any time.`,
          )
          used.add(first.e.id)
          pick = alt.e
        }
      }
      used.add(pick.id)
      items.push(makeItem(pick, wantsExplosive))
    }
  }
  // Fit the time strictly: trim sets on isolation work, then on compounds,
  // down to two; then give up the last slots, down to one block. A block that
  // cannot fit even alone is reported, never built on invented minutes.
  const dropped: string[] = []
  const warm = focus === 'athletic' ? ATHLETIC_WARM_UP_MIN : WARM_UP_MIN
  const total = () =>
    warm + items.reduce((m, it) => m + blockMinutes(it.sets, it.restSec, GYM_EXERCISE_BY_ID[it.exerciseId].dose?.workSec), 0)
  for (const compound of [false, true]) {
    for (let i = items.length - 1; i >= 0 && total() > minutes; i--) {
      if (Boolean(GYM_EXERCISE_BY_ID[items[i].exerciseId].compound) === compound && items[i].sets > 2) items[i] = { ...items[i], sets: 2 }
    }
  }
  while (items.length > 1 && total() > minutes) {
    const gone = items.pop()!
    dropped.unshift(GYM_EXERCISE_BY_ID[gone.exerciseId].name)
  }
  const fits = items.length === 0 || total() <= minutes
  if (!fits) {
    for (const it of items) dropped.unshift(GYM_EXERCISE_BY_ID[it.exerciseId].name)
    items.length = 0
  }
  return { name: FOCUS_LABEL[focus], focus, items, dropped, estimatedMin: items.length ? Math.round(total()) : 0, fits, notes }
}
