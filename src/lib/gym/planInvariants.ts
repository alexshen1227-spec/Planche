import type { Muscle, Pattern } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID, jointsToRest, volumeShare, type GymExercise } from '../../data/gym/exercises'
import { HARD_GYM_FAMILY_SETS, LIGHT_PRESS_SPARE } from '../plan/load'
import { availableAt, canDoHere } from './availability'
import { readyForBodyweight } from './bodyweight'
import {
  buildGymSession, chinUpAllowed, FINISHER_SETS, FOCUS_LABEL, HARDER_VARIANT_SETS, ISOLATION_PER_MUSCLE, MAIN_COMPOUND_SETS,
  MAX_LIFTING_MIN, namedGroupLabel, namedGroups, nextFocus, PATTERN_LIMIT, type GymFocus, type GymPlan,
} from './builder'
import { fitsGymFocus } from './focus'
import { isHardBodyweight, plyoGate } from './progression'

/**
 * Everything that must hold for any session the gym generator builds, whatever it was asked for: the day type, the
 * athlete's exclusions, the duplicate rules, the time, light and hard days, the order, and the labels and notes that
 * describe it. `planViolations` checks one built plan against the input that built it; `relationalViolations` builds
 * the same request again with one thing changed (a lighter day, more time) and checks the two agree. The stress test
 * (`planInvariants.test.ts`) runs both over hundreds of generated athletes.
 */

export type GymInput = Parameters<typeof buildGymSession>[0]
export interface Violation {
  rule: string
  detail: string
}

const ex = (id: string): GymExercise => GYM_EXERCISE_BY_ID[id]
const PRESSING = new Set<Pattern>(['horizontal-press', 'incline-press', 'vertical-press', 'dip'])
const SPLIT_MUSCLES: Record<'push' | 'pull', ReadonlySet<Muscle>> = {
  pull: new Set(['lats', 'upper-back', 'traps', 'rear-delts', 'biceps', 'forearms', 'abs', 'obliques', 'hip-flexors']),
  push: new Set(['chest', 'chest-upper', 'front-delts', 'side-delts', 'triceps', 'triceps-long', 'abs', 'obliques', 'hip-flexors']),
}
/** The main compounds of a Push or Pull day, most important first. */
const SPLIT_MAINS: Record<'push' | 'pull', Pattern[][]> = {
  pull: [['vertical-pull'], ['horizontal-pull']],
  push: [['horizontal-press', 'incline-press', 'dip'], ['vertical-press']],
}
/** The fewest minutes at which every movement a day is named for must be in it (a shorter day rotates them). */
export const NAMED_FROM_MIN = 30

export const setCount = (plan: Pick<GymPlan, 'items'>) => plan.items.reduce((n, it) => n + it.sets, 0)

/** The movement a named group is represented by in a plan: its first compound, else its first movement. */
function namedOf<T extends { exerciseId: string }>(items: T[], group: Pattern[]): T[] {
  const inGroup = items.filter((it) => group.includes(ex(it.exerciseId).pattern))
  const first = inGroup.find((it) => ex(it.exerciseId).compound) ?? inGroup[0]
  return first ? [first] : []
}

/** The focus a request is built for: the one asked, or the one the builder picks from the history. */
export function focusOf(input: GymInput): GymFocus {
  return input.focus ?? nextFocus(input.sessions, input.now ?? Date.now(), input.musclesOff)
}

/** Whether the builder may pick a movement for this request at all (the athlete's switches, kit, joints, gates). */
export function allowedFor(input: GymInput, e: GymExercise): boolean {
  const ratings = input.ratings ?? {}
  const now = input.now ?? Date.now()
  const youth = input.youth ?? false
  if (!canDoHere(e.id, input.location)) return false
  if (e.id === 'chin-up' && !chinUpAllowed(input.sessions, now)) return false
  if (!readyForBodyweight(e.id, input.capacity)) return false
  if (e.technical && !e.tier && ratings[e.id] !== 'love' && (youth || (input.capacity && isHardBodyweight(e) && !input.capacity.practiced.has(e.id)))) return false
  if (e.primary.some((m) => input.musclesOff?.includes(m))) return false
  if (jointsToRest(e.id).some((j) => input.avoidJoints?.includes(j))) return false
  if (ratings[e.id] === 'avoid') return false
  return plyoGate(e, input.sessions, youth, now).allowed
}

/** Sets aimed at a muscle: the movements it is a main muscle of, at their share. */
export function aimedAt(plan: Pick<GymPlan, 'items'>, m: Muscle): number {
  return plan.items.reduce((n, it) => n + (ex(it.exerciseId).primary.includes(m) ? it.sets * volumeShare(ex(it.exerciseId), m) : 0), 0)
}

export function planViolations(input: GymInput, plan: GymPlan): Violation[] {
  const out: Violation[] = []
  const add = (rule: string, detail: string) => out.push({ rule, detail })
  const focus = focusOf(input)
  const factor = input.volumeFactor ?? 1
  const youth = input.youth ?? false
  const ratings = input.ratings ?? {}
  const now = input.now ?? Date.now()
  const spare = new Set(input.spare ?? [])
  const lightPress = LIGHT_PRESS_SPARE.every((m) => spare.has(m))
  const items = plan.items
  const known = items.filter((it) => ex(it.exerciseId))
  if (known.length !== items.length) {
    add('unknown-exercise', items.filter((it) => !ex(it.exerciseId)).map((it) => it.exerciseId).join(', '))
    return out
  }
  const name = (it: { exerciseId: string }) => ex(it.exerciseId).name
  const standalone = items.filter((it) => !it.finisher)
  const introductory = Boolean(input.capacity?.introductory && focus !== 'athletic')
  const capped = input.capacity?.buildUpSetLimit !== undefined

  // --- Structure ---------------------------------------------------------------------------------------------
  if (plan.focus !== focus) add('label', `focus ${plan.focus} for a ${focus} request`)
  if (plan.name !== FOCUS_LABEL[plan.focus]) add('label', `named "${plan.name}" on a ${plan.focus} day`)
  if (!plan.fits && items.length) add('unfit-nonempty', `${items.length} items in a plan that does not fit`)
  if ((plan.estimatedMin === 0) !== (items.length === 0)) add('estimate', `${plan.estimatedMin} min for ${items.length} items`)
  const budget = focus === 'athletic' ? input.minutes : Math.min(input.minutes, MAX_LIFTING_MIN)
  if (plan.estimatedMin > budget) add('time', `${plan.estimatedMin} min for a ${budget}-minute budget`)
  if (focus !== 'athletic' && input.minutes > MAX_LIFTING_MIN && items.length) {
    if (plan.cappedAt !== MAX_LIFTING_MIN) add('cap-label', `asked ${input.minutes} min, cappedAt ${plan.cappedAt}`)
    if (!plan.notes.some((n) => n.includes(`capped at about ${MAX_LIFTING_MIN}`))) add('cap-label', 'no note for the lifting cap')
  }
  if ((focus === 'athletic' || input.minutes <= MAX_LIFTING_MIN) && plan.cappedAt !== undefined) add('cap-label', `cappedAt ${plan.cappedAt} for ${input.minutes} min`)
  const ids = items.map((it) => it.exerciseId)
  if (new Set(ids).size !== ids.length) add('duplicate-exercise', ids.join(', '))
  const movements = standalone.map((it) => ex(it.exerciseId).variantOf ?? it.exerciseId)
  if (new Set(movements).size !== movements.length) add('duplicate-movement', standalone.map(name).join(', '))
  for (const it of items) {
    const e = ex(it.exerciseId)
    if (!Number.isInteger(it.sets) || it.sets < 1) add('bad-sets', `${e.name} ×${it.sets}`)
    const [lo, hi] = it.plan.range
    if (!(lo >= 1 && hi >= lo && Number.isFinite(hi))) add('bad-range', `${e.name} ${lo}–${hi}`)
    if (!(it.plan.targetRpe >= 5 && it.plan.targetRpe <= 10)) add('bad-range', `${e.name} RPE ${it.plan.targetRpe}`)
    if (!(it.restSec >= 30 && it.restSec <= 300)) add('bad-range', `${e.name} rest ${it.restSec}s`)
    const s = it.suggestion
    if (s) {
      if (!(s.reps[0] >= 1 && s.reps[1] >= s.reps[0])) add('suggestion', `${e.name} reps ${s.reps.join('–')}`)
      if (s.kg !== undefined && !(Number.isFinite(s.kg) && s.kg >= 0)) add('suggestion', `${e.name} ${s.kg} kg`)
      if (s.targetReps !== undefined && !(s.targetReps >= 1 && Number.isFinite(s.targetReps))) add('suggestion', `${e.name} target ${s.targetReps}`)
      if (!s.why?.trim()) add('suggestion', `${e.name} has no reason`)
    }
  }
  if (plan.dropped.some((d) => items.some((it) => name(it) === d))) add('dropped', `listed as left out but planned: ${plan.dropped.filter((d) => items.some((it) => name(it) === d)).join(', ')}`)
  if (new Set(plan.dropped).size !== plan.dropped.length) add('dropped', `named twice: ${plan.dropped.join(', ')}`)
  const limit = (plan as GymPlan & { setLimit?: number }).setLimit
  if (limit !== undefined && setCount(plan) > limit) add('set-limit', `${setCount(plan)} sets over the limit of ${limit}`)
  if (introductory && (items.length > 4 || items.some((it) => it.sets > 2))) add('introductory', items.map((it) => `${name(it)} ×${it.sets}`).join('; '))

  // --- The athlete's exclusions and gates -----------------------------------------------------------------------
  for (const it of items) {
    const e = ex(it.exerciseId)
    if (!canDoHere(e.id, input.location)) add('kit', `${e.name} needs kit this place lacks`)
    if (ratings[e.id] === 'avoid') add('avoid-rated', e.name)
    const off = e.primary.filter((m) => input.musclesOff?.includes(m))
    if (off.length) add('muscle-off', `${e.name} trains ${off.join(', ')}`)
    const joints = jointsToRest(e.id).filter((j) => input.avoidJoints?.includes(j))
    if (joints.length) add('joint', `${e.name} loads ${joints.join(', ')}`)
    if (youth && e.technical && !e.tier && ratings[e.id] !== 'love') add('youth-technical', e.name)
    if (!readyForBodyweight(e.id, input.capacity)) add('bodyweight-gate', e.name)
    if (!plyoGate(e, input.sessions, youth, now).allowed) add('plyo', e.name)
    if (youth && !it.practice && !e.dose && !isHardBodyweight(e) && it.plan.range[0] < 6) add('youth-reps', `${e.name} ${it.plan.range.join('–')}`)
    if (e.id === 'chin-up' && !chinUpAllowed(input.sessions, now)) add('chin-up', 'chin-up inside its rotation')
  }

  // --- The day type -------------------------------------------------------------------------------------------------
  for (const it of items) {
    const e = ex(it.exerciseId)
    if (!fitsGymFocus(focus, e)) add('day-type', `${e.name} on a ${focus} day`)
    if ((focus === 'push' || focus === 'pull') && !e.primary.every((m) => SPLIT_MUSCLES[focus].has(m))) add('day-type', `${e.name} trains ${e.primary.join(', ')} on a ${focus} day`)
    if (focus === 'pull' && [...e.primary, ...e.secondary].some((m) => m === 'chest' || m === 'chest-upper')) add('day-type', `chest on a pull day: ${e.name}`)
  }
  const atPlace = availableAt(input.location).filter((e) => fitsGymFocus(focus, e))
  const pool = atPlace.filter((e) => allowedFor(input, e))
  if (focus !== 'athletic') {
    for (const group of namedGroups(focus, lightPress)) {
      const inPlan = standalone.some((it) => group.includes(ex(it.exerciseId).pattern))
      const allowed = pool.some((e) => !e.explosive && group.includes(e.pattern))
      // A movement the day is named for is there whenever one is allowed and the day is long enough to hold it.
      if (!inPlan && allowed && items.length && input.minutes >= NAMED_FROM_MIN && !introductory && !capped) {
        add('named-missing', `no ${group.join('/')} on a ${focus} day (${items.map(name).join(', ')})`)
      }
      // ...and when none is allowed, the plan says why instead of carrying the day's name without it.
      if (!inPlan && !allowed && !plan.notes.some((n) => n.startsWith(`No ${namedGroupLabel(group)} today:`))) {
        add('named-unexplained', `no ${namedGroupLabel(group)} and no reason on a ${focus} day (${items.map(name).join(', ') || 'empty'})`)
      }
    }
  } else if (!items.some((it) => ex(it.exerciseId).explosive) && !pool.some((e) => e.explosive) &&
      !plan.notes.some((n) => n.startsWith('No speed or power work today:'))) {
    add('named-unexplained', `a speed and power day with no speed work and no reason (${items.map(name).join(', ') || 'empty'})`)
  }
  // A named movement is never thinned below the accessories: one set of it while an isolation movement keeps two.
  if (focus !== 'athletic' && input.minutes >= NAMED_FROM_MIN) {
    const named = namedGroups(focus, lightPress).flatMap((group) => namedOf(standalone, group))
    // ...nor below a speed or power drill a goal put first: the drill gives way before a named lift loses a set.
    const thick = standalone.filter((it) => !named.includes(it) && (!ex(it.exerciseId).compound || ex(it.exerciseId).explosive) && it.sets >= 2)
    // The light-pressing rail's single practice set beside a push skill is the rail, not a thinned lift.
    for (const it of named) if (it.sets < 2 && !it.practice && !(lightPress && PRESSING.has(ex(it.exerciseId).pattern)) && thick.length) add('named-thin', `${name(it)} ×${it.sets} beside ${thick.map((t) => `${name(t)} ×${t.sets}`).join(', ')}`)
  }
  if ((focus === 'push' || focus === 'pull') && !introductory && !capped) {
    // The day's main movements are the first of each main group (the builder's anchors), whatever their kind.
    const mains = SPLIT_MAINS[focus].flatMap((group) => namedOf(standalone, group))
    const isolation = standalone.filter((it) => !mains.includes(it) && !ex(it.exerciseId).compound && !ex(it.exerciseId).explosive)
    for (const main of mains) {
      if (!isolation.length || main.sets >= MAIN_COMPOUND_SETS) continue
      if (main.practice || items.some((it) => it.finisher?.of === main.exerciseId)) continue
      if (lightPress && PRESSING.has(ex(main.exerciseId).pattern)) continue
      add('mains-first', `${name(main)} ×${main.sets} beside ${isolation.map((it) => `${name(it)} ×${it.sets}`).join(', ')}`)
    }
  }

  // --- Duplicates and doses ---------------------------------------------------------------------------------------------
  items.forEach((it, i) => {
    const e = ex(it.exerciseId)
    if (it.finisher) {
      const parent = ex(it.finisher.of)
      if (!parent || items[i - 1]?.exerciseId !== parent.id) add('finisher', `${e.name} not straight after ${parent?.name ?? it.finisher.of}`)
      if (it.sets > FINISHER_SETS) add('finisher', `${e.name} ×${it.sets}`)
      if (parent && (!e.ladder || !parent.ladder || e.ladder.id !== parent.ladder.id || e.ladder.level >= parent.ladder.level) &&
          !items.some((p) => p.exerciseId === parent.id && p.practice?.easierId === e.id)) {
        add('finisher', `${e.name} is not an easier version of ${parent.name}`)
      }
    }
    if (it.pairedWith) {
      const j = items.findIndex((o) => o.exerciseId === it.pairedWith)
      if (j < 0 || Math.abs(j - i) !== 1 || items[j].pairedWith !== it.exerciseId) add('pair', `${e.name} paired with ${it.pairedWith}`)
    }
  })
  for (const a of standalone) for (const b of standalone) {
    const ea = ex(a.exerciseId), eb = ex(b.exerciseId)
    if (ea === eb || !ea.ladder || !eb.ladder || ea.ladder.id !== eb.ladder.id) continue
    if (ea.ladder.level === eb.ladder.level) {
      if (ea.id < eb.id) add('same-rung', `${ea.name} + ${eb.name}`)
    } else if (ea.ladder.level > eb.ladder.level && a.sets > HARDER_VARIANT_SETS) add('harder-volume', `${ea.name} ×${a.sets} beside ${eb.name}`)
  }
  const perMuscle = new Map<Muscle, string[]>()
  for (const it of standalone) {
    const e = ex(it.exerciseId)
    if (e.compound || e.explosive) continue
    perMuscle.set(e.primary[0], [...(perMuscle.get(e.primary[0]) ?? []), e.name])
  }
  for (const [m, names] of perMuscle) if (names.length > ISOLATION_PER_MUSCLE) add('isolation-per-muscle', `${m}: ${names.join(', ')}`)
  const requested = new Set(input.athletePriority ?? [])
  const priority = new Set(input.priority ?? [])
  const muscles = new Set(items.flatMap((it) => ex(it.exerciseId).primary))
  for (const m of muscles) {
    const ceiling = (requested.has(m) || (!input.athletePriority && priority.has(m)) || (focus === 'pull' && m === 'upper-back') ? 12 : 10) * Math.max(1, factor)
    const n = aimedAt(plan, m)
    if (n > ceiling + 1e-9 && focus !== 'athletic') add('muscle-ceiling', `${n} sets aimed at ${m} (ceiling ${ceiling})`)
  }
  for (const it of items) {
    const top = factor > 1 || (input.weeklyPriority?.length && !(focus === 'push' || focus === 'pull')) ? MAIN_COMPOUND_SETS + 1 : MAIN_COMPOUND_SETS
    if (it.sets > top && !ex(it.exerciseId).dose) add('item-sets', `${name(it)} ×${it.sets}`)
  }
  if (setCount(plan) > Math.round(30 * Math.max(1, factor))) add('session-sets', `${setCount(plan)} working sets`)
  if (focus === 'pull') {
    const back = items.reduce((n, it) => n + (ex(it.exerciseId).compound && ['vertical-pull', 'horizontal-pull'].includes(ex(it.exerciseId).pattern) ? it.sets : 0), 0)
    const curls = items.reduce((n, it) => n + (ex(it.exerciseId).pattern === 'biceps' ? it.sets : 0), 0)
    if (curls > back) add('curl-cap', `${curls} curl sets for ${back} back sets`)
  }

  // --- Order ------------------------------------------------------------------------------------------------------
  if (focus !== 'athletic') {
    const lastExplosive = items.map((it) => Boolean(ex(it.exerciseId).explosive)).lastIndexOf(true)
    const firstOther = items.findIndex((it) => !ex(it.exerciseId).explosive)
    if (lastExplosive > firstOther && firstOther >= 0) add('explosive-first', items.map(name).join(', '))
    items.forEach((it, i) => {
      const e = ex(it.exerciseId)
      if (e.compound || e.explosive || it.finisher) return
      const later = items.slice(i + 1).find((o) => !o.finisher && ex(o.exerciseId).compound && !ex(o.exerciseId).explosive &&
        e.primary.some((m) => volumeShare(ex(o.exerciseId), m) > 0))
      if (later) add('fatigue-order', `${e.name} before ${name(later)}`)
    })
  }

  // --- Light and hard days ---------------------------------------------------------------------------------------------
  if (factor < 1) {
    for (const it of items) {
      const e = ex(it.exerciseId)
      if (!e.dose && !it.practice && it.plan.targetRpe > 7.5 - (youth ? 0.5 : 0) + 1e-9) add('light-rpe', `${e.name} at RPE ${it.plan.targetRpe} on a lighter day`)
    }
  }
  if (lightPress && focus !== 'athletic') {
    const pressing = items.filter((it) => PRESSING.has(ex(it.exerciseId).pattern))
    const pressSets = pressing.reduce((n, it) => n + it.sets, 0)
    if (pressSets >= HARD_GYM_FAMILY_SETS) add('light-press', `${pressSets} pressing sets on a light pressing day: ${pressing.map((it) => `${name(it)} ×${it.sets}`).join(', ')}`)
    if (pressing.length > 1) add('light-press', `${pressing.length} pressing movements on a light pressing day`)
    const pair = items.filter((it) => !PRESSING.has(ex(it.exerciseId).pattern) && ex(it.exerciseId).primary.some((m) => LIGHT_PRESS_SPARE.includes(m)) &&
      !ex(it.exerciseId).primary.some((m) => requested.has(m) && !LIGHT_PRESS_SPARE.includes(m)))
    if (pair.length) add('light-press', `front delts or triceps trained on a light pressing day: ${pair.map(name).join(', ')}`)
  }
  if (focus === 'athletic' && factor < 1) {
    for (const it of items) if (ex(it.exerciseId).tier === 'high' || ex(it.exerciseId).maximal) add('athletic-light', `${name(it)} on a lighter day`)
  }

  // --- Notes say what the plan holds ------------------------------------------------------------------------------------
  for (const note of plan.notes) {
    const stall = /^(.+) has not beaten its best in its last \d+ sessions, so (.+) takes its place/.exec(note)
    if (stall) {
      if (items.some((it) => name(it) === stall[1])) add('note-stall', `stalled ${stall[1]} is still planned`)
      if (!items.some((it) => name(it) === stall[2])) add('note-stall', `stand-in ${stall[2]} is not planned`)
    }
    const explore = /^(.+) is new to you:/.exec(note)
    if (explore) {
      const it = items.find((x) => name(x) === explore[1])
      if (!it) add('note-explore', `"${explore[1]} is new to you" but it is not planned`)
      else if (input.sessions.some((s) => s.startedAt < now && s.exercises.some((log) => log.exerciseId === it.exerciseId && log.sets.length))) add('note-explore', `${explore[1]} called new but logged before`)
    }
    const alternate = /^Alternate one set of (.+) with one set of (.+?)\./.exec(note)
    if (alternate && !items.some((it) => it.pairedWith)) add('note-pair', 'an alternating note with no pair')
    const added = /so (.+) (?:was|were) added\./.exec(note)
    if (added && plan.cappedAt === undefined && !note.includes(`in the ${input.minutes} minutes`)) add('note-fill', `fill note quotes other minutes: ${note.slice(0, 60)}`)
  }
  if (new Set(plan.notes).size !== plan.notes.length) add('note-twice', 'the same note twice')
  // A coach's eye: three or more separate exercises of one pattern is one movement done three ways.
  if (focus !== 'athletic') {
    const byPattern = new Map<string, string[]>()
    for (const it of standalone) byPattern.set(ex(it.exerciseId).pattern, [...(byPattern.get(ex(it.exerciseId).pattern) ?? []), name(it)])
    for (const [p, names] of byPattern) if (names.length > PATTERN_LIMIT) add('pattern-repeat', `${names.length}× ${p}: ${names.join(', ')}`)
    // Trunk work braces every lift: it never comes before a compound.
    items.forEach((it, i) => {
      const e = ex(it.exerciseId)
      if (it.finisher || !(e.pattern === 'core-flexion' || e.pattern === 'core-anti-rotation')) return
      const later = items.slice(i + 1).find((o) => ex(o.exerciseId).compound && !ex(o.exerciseId).explosive)
      if (later) add('core-early', `${e.name} before ${name(later)}`)
    })
  }
  return out
}

/**
 * The same request built again with one thing changed, and what must hold between the two: a lighter day is never
 * more work, a harder one never less, more time never fewer sets, the builder is deterministic, and a priority outside
 * the day type changes nothing.
 */
export function relationalViolations(input: GymInput, plan: GymPlan = buildGymSession(input)): Violation[] {
  const out: Violation[] = []
  const add = (rule: string, detail: string) => out.push({ rule, detail })
  const focus = focusOf(input)
  const factor = input.volumeFactor ?? 1
  const again = buildGymSession(input)
  if (JSON.stringify(again) !== JSON.stringify(plan)) add('deterministic', 'the same request built twice differs')
  const normal = factor !== 1 ? buildGymSession({ ...input, volumeFactor: 1 }) : plan
  if (factor < 1 && normal.fits && setCount(plan) > setCount(normal)) add('light-not-lighter', `${setCount(plan)} sets at ×${factor} vs ${setCount(normal)} at ×1`)
  if (factor < 1 && normal.items.length && !plan.items.length) add('light-not-lighter', `a lighter day builds nothing where the usual one builds ${normal.items.length}`)
  if (factor > 1 && setCount(plan) < setCount(normal)) add('hard-not-harder', `${setCount(plan)} sets at ×${factor} vs ${setCount(normal)} at ×1`)
  if (input.minutes >= NAMED_FROM_MIN && input.minutes < MAX_LIFTING_MIN && focus !== 'athletic' && !input.capacity?.buildUpSetLimit) {
    const longer = buildGymSession({ ...input, minutes: Math.min(MAX_LIFTING_MIN, input.minutes + 15) })
    if (setCount(longer) < setCount(plan)) add('more-time-fewer-sets', `${input.minutes} min: ${setCount(plan)} sets, ${input.minutes + 15} min: ${setCount(longer)}`)
  }
  if (focus === 'push' || focus === 'pull') {
    const outside = (['quads', 'hamstrings', 'glutes', 'calves'] as Muscle[]).filter((m) => !(input.priority ?? []).includes(m))
    if (outside.length) {
      const own = [...(input.athletePriority ?? []), ...outside]
      const withOutside = buildGymSession({ ...input, priority: [...(input.priority ?? []), ...outside], athletePriority: own })
      if (JSON.stringify(withOutside.items.map((it) => [it.exerciseId, it.sets])) !== JSON.stringify(plan.items.map((it) => [it.exerciseId, it.sets]))) {
        add('offday-priority', `leg priorities changed a ${focus} day`)
      }
    }
  }
  return out
}
