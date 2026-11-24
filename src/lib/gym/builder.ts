import { type Joint, type Muscle, type Pattern } from '../../data/gym/catalog'
import { athleticDomain, GYM_EXERCISE_BY_ID, type AthleticDomain, type GymExercise, type IntensityTier } from '../../data/gym/exercises'
import { availableAt, preferenceRank } from './availability'
import { readyForBodyweight, type BodyweightCapacity } from './bodyweight'
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

/**
 * The movements a gym day is named for: a push day presses, a pull day pulls,
 * a lower day squats, lunges or hinges. Steering a day off a muscle the week
 * already has plenty of (`spare`) may change which of them go in and how many
 * sets, never take them all out.
 */
export const NAMED_PATTERNS: Record<GymFocus, Pattern[][]> = {
  push: [['horizontal-press', 'incline-press']],
  pull: [['vertical-pull', 'horizontal-pull']],
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
export function setsForFactor(factor: number, priority = false): number {
  return Math.max(2, Math.round((3 + (priority ? 1 : 0)) * factor))
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
  const { location, minutes, sessions, ratings = {}, youth = false, now = Date.now() } = input
  const musclesOff = new Set(input.musclesOff ?? [])
  const priority = new Set(input.priority ?? [])
  // A muscle the athlete asked for is not spared: a movement built on a priority muscle keeps its slot whatever
  // the week's steer says about the other muscles it leans on, and a muscle on both lists counts as priority.
  // One exception is a recovery rail, not a steer: with the pressing pair spared (the planner's light pressing
  // beside a push skill, `LIGHT_PRESS_SPARE`) nothing built on either of them comes back for a priority — the
  // week is lighter on them because the skill days carry them.
  const spare = new Set(input.spare ?? [])
  const lightPress = spare.has('front-delts') && spare.has('triceps')
  const spareIn = (e: GymExercise) => {
    const held = lightPress && e.primary.some((m) => m === 'front-delts' || m === 'triceps')
    if (!held && e.primary.some((m) => priority.has(m))) return 0
    return e.primary.filter((m) => spare.has(m)).length
  }
  const avoid = new Set(input.avoidJoints ?? [])
  const factor = input.volumeFactor ?? 1
  const goalEmphasis = input.goals ? { power: input.goals.power >= 3 } : null
  const emphasisOf = (e: GymExercise) => input.emphasis ?? goalEmphasisFor(input.goals, e)
  const usable = (e: GymExercise) =>
    readyForBodyweight(e.id, input.capacity) &&
    !e.primary.some((m) => musclesOff.has(m)) &&
    !e.stress.some((j) => avoid.has(j)) &&
    ratings[e.id] !== 'avoid' &&
    // Speed and power work is built up to, never started at the top (see plyoGate).
    plyoGate(e, sessions, youth, now).allowed
  const focus = input.focus ?? nextFocus(sessions, now, input.musclesOff)
  const here = availableAt(location)
  const used = new Set<string>()
  const items: Omit<PlannedExercise, 'suggestion'>[] = []
  /** Movements kept for what the day is named for, though they lean on a spare muscle: never given a set more. */
  const steered = new Set<string>()
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
    const plan = factor < 1 ? { ...base, targetRpe: Math.max(6, base.targetRpe - 1) } : base
    return {
      exerciseId: pick.id,
      // The usual dose: a light or hard day is made from the fitted session below, so it cannot lose to the time fit.
      sets: sets ?? 3 + (isPriority(pick) ? 1 : 0),
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
    const dose = (e: GymExercise | undefined) => (e?.dose ? e.dose.sets : undefined)
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
    // What the day is named for, still to be filled: each group keeps one movement whatever the steer says.
    const named = NAMED_PATTERNS[focus].map((group) => [...group])
    const unfilled = (slot: Pattern[]) => named.some((group) => group.some((p) => slot.includes(p)) && !items.some((it) => group.includes(GYM_EXERCISE_BY_ID[it.exerciseId].pattern)))
    for (const slot of slots) {
      const wantsExplosive = slot.includes('jump') || slot.includes('throw')
      // Avoided means avoided: a slot nothing else can fill is left out.
      const fit = here.filter(
        (e) => slot.includes(e.pattern) && !used.has(e.id) && (wantsExplosive ? e.explosive : !e.explosive) && usable(e),
      )
      // A muscle the week has plenty of steers the slot to a movement not built on it. When every movement of the
      // slot is, the slot goes — unless it is what the day is named for: then the movement that leans on the spare
      // muscles least goes in, at two sets.
      const free = fit.filter((e) => spareIn(e) === 0)
      const spared = free.length === 0 && fit.length > 0
      if (spared && !unfilled(slot)) continue
      const options = spared ? fit : free.length ? free : fit
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
            (e.tier ? TIER_RANK[gateTier(e)!] * 0.25 : 0) +
            spareIn(e) * 0.5,
        }))
        .sort((a, b) => a.score - b.score)
      const first = ranked[0]
      if (!first) continue
      let pick = first.e
      // A lift that has stopped progressing lends its slot to a variation of
      // the same movement for a while: a change of exercise is a common way to
      // restart progress (CONSENSUS). Only a close fit — never one that is
      // hard to do here, or coached-only under 18 — and never a favourite.
      if (sessions.length > STALL_SESSIONS && !wantsExplosive && ratings[pick.id] !== 'love' && liftTrend(sessions, pick.id, now, location?.id).status === 'stalled') {
        const alt = ranked.find(
          (r) => r.e.id !== first.e.id && r.e.pattern === first.e.pattern && r.score <= first.score + 1.5 && liftTrend(sessions, r.e.id, now, location?.id).status !== 'stalled',
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
      items.push(makeItem(pick, wantsExplosive, spared ? 2 : undefined))
      if (spared) steered.add(pick.id)
    }
  }
  // Fit the time strictly: trim sets on isolation work, then on compounds,
  // down to two; then give up the last slots, down to one block. A block that
  // cannot fit even alone is reported, never built on invented minutes.
  const dropped: string[] = []
  const warm = input.warmUpMin !== undefined ? Math.max(0, input.warmUpMin) : focus === 'athletic' ? ATHLETIC_WARM_UP_MIN : WARM_UP_MIN
  const total = () =>
    warm + items.reduce((m, it) => m + blockMinutes(it.sets, it.restSec, GYM_EXERCISE_BY_ID[it.exerciseId].dose?.workSec), 0)
  let trimmed = false
  for (const compound of [false, true]) {
    for (let i = items.length - 1; i >= 0 && total() > minutes; i--) {
      if (Boolean(GYM_EXERCISE_BY_ID[items[i].exerciseId].compound) === compound && items[i].sets > 2) {
        items[i] = { ...items[i], sets: 2 }
        trimmed = true
      }
    }
  }
  while (items.length > 1 && total() > minutes) {
    const gone = items.pop()!
    dropped.unshift(GYM_EXERCISE_BY_ID[gone.exerciseId].name)
    trimmed = true
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
  if (focus !== 'athletic' && fits && items.length && !trimmed) {
    const slotPatterns = new Set<Pattern>(SLOTS[focus].flat())
    const main = new Set<Muscle>(FOCUS_MAIN[focus])
    const credit = new Map<Muscle, number>()
    const addCredit = (ex: GymExercise, sets: number) => {
      for (const m of ex.primary) credit.set(m, (credit.get(m) ?? 0) + sets)
      for (const m of ex.secondary) credit.set(m, (credit.get(m) ?? 0) + sets * 0.5)
    }
    for (const it of items) addCredit(GYM_EXERCISE_BY_ID[it.exerciseId], it.sets)
    const added: GymExercise[] = []
    // A harder day (factor above 1) keeps room above the usual ceiling for its extra sets.
    const ceiling = Math.round(FILL_SESSION_SETS * Math.max(1, factor))
    for (;;) {
      const room = minutes - FILL_HEADROOM_MIN - total()
      const setsSoFar = items.reduce((n, it) => n + it.sets, 0)
      if (setsSoFar + 2 > ceiling) break
      const candidates = here
        .filter(
          (e) =>
            !used.has(e.id) &&
            slotPatterns.has(e.pattern) &&
            !e.explosive &&
            (![PRESSING_PATTERNS, PULLING_PATTERNS].some((f) => f.has(e.pattern)) || FILL_FAMILIES[focus].some((f) => f.has(e.pattern))) &&
            usable(e) &&
            spareIn(e) === 0 &&
            technicalPenalty(e) === 0 &&
            e.primary.every((m) => (credit.get(m) ?? 0) < FILL_MUSCLE_SETS),
        )
        .map((e) => {
          const tier = isPriority(e) ? 0 : e.primary.some((m) => (main.size ? main.has(m) : true)) ? 1 : 2
          const least = Math.min(...e.primary.map((m) => credit.get(m) ?? 0))
          return { e, score: tier * 1000 + least * 10 + hardHere(e) * 3 + scoreOf(e, staleness(e)) }
        })
        .sort((a, b) => a.score - b.score)
      let placed = false
      for (const { e } of candidates) {
        const want = 3 + (isPriority(e) ? 1 : 0)
        const rest = restFor(e, makeItem(e, false, 2).plan)
        const sets = [...new Set([want, 3, 2])].find((n) => n <= want && setsSoFar + n <= ceiling && blockMinutes(n, rest, e.dose?.workSec) <= room)
        if (sets === undefined) continue
        used.add(e.id)
        items.push(makeItem(e, false, sets))
        addCredit(e, sets)
        added.push(e)
        placed = true
        break
      }
      if (!placed) break
    }
    if (added.length) {
      notes.push(
        `There was time left in the ${minutes} minutes, so ${added.map((e) => e.name).join(', ')} ${added.length === 1 ? 'was' : 'were'} added for the muscles the session gave least — your priority muscles first. It is the app's own way of using a long day, not a prescription.`,
      )
    }
  }
  // The day's factor works on the fitted session, so it changes the sets and not only the effort:
  // a lighter day keeps about that share of the usual working sets (taken off the lifts first, then
  // the last lifts), and a harder one adds a set at a time while the minutes allow — never fewer.
  const setCount = () => items.reduce((n, it) => n + it.sets, 0)
  if (items.length && factor < 1) {
    const target = Math.max(1, Math.floor(setCount() * factor + 0.25))
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
      else if (items.length > 1) dropped.unshift(GYM_EXERCISE_BY_ID[items.pop()!.exerciseId].name)
      else break
    }
  } else if (items.length && factor > 1) {
    for (let i = 0; i < items.length; i++) {
      const ex = GYM_EXERCISE_BY_ID[items[i].exerciseId]
      if (ex.dose || steered.has(ex.id)) continue
      if (total() + blockMinutes(1, items[i].restSec) > minutes) break
      items[i] = { ...items[i], sets: items[i].sets + 1 }
    }
  }
  return { name: FOCUS_LABEL[focus], focus, items, dropped, estimatedMin: items.length ? Math.round(total()) : 0, fits, notes }
}

export function buildGymSession(input: GymSessionInput): GymPlan {
  const now = input.now ?? Date.now()
  const session = planGymExercises({ ...input, now })
  const items = session.items.map((item) => ({
    ...item,
    suggestion: suggestLoad({ exerciseId: item.exerciseId, location: input.location, sessions: input.sessions, plan: item.plan, youth: input.youth, now }),
  }))
  return { ...session, items }
}
