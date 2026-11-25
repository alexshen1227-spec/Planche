import type { Muscle } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID, volumeShare, type GymExercise } from '../../data/gym/exercises'
import { steerInput } from '../plan/screens'
import { availableAt } from './availability'
import type { BodyweightCapacity } from './bodyweight'
import {
  buildGymSession, FINISHER_SETS, HARDER_VARIANT_SETS, ISOLATION_PER_MUSCLE, MAIN_COMPOUND_SETS, MAX_LIFTING_MIN, type GymPlan,
} from './builder'
import { fitsGymFocus } from './focus'
import type { GoalWeights, GymLocation } from './types'

/**
 * A matrix of Push and Pull sessions the builder makes for realistic athletes, with every rule the athlete set for the
 * generator checked on each one. `npm run sessions:sample` prints them as a table; `sampleSessions.test.ts` keeps
 * the checks clean.
 */

const HOME: GymLocation = { id: 'home', name: 'Home', unit: 'kg', updatedAt: 1, equipment: ['floor', 'dumbbells', 'incline-bench', 'pullup-bar'] }
const HOME_BAND: GymLocation = { ...HOME, id: 'home-band', name: 'Home + band', equipment: [...HOME.equipment, 'band'] }
const GYM: GymLocation = { id: 'gym', name: 'Gym', unit: 'kg', updatedAt: 1,
  equipment: ['barbell', 'squat-rack', 'bench', 'incline-bench', 'dumbbells', 'cable', 'lat-pulldown', 'cable-row', 'pullup-bar', 'dip-bars', 'pec-deck'] }
const GOALS: GoalWeights = { skills: 3, physique: 5, strength: 3, power: 0, endurance: 0 }
/** Can do a few strict pull-ups: the pull-up is practised at a set rep count, an easier version finishes it. */
const BUILDING_PULLUPS: BodyweightCapacity = { base: { pullups: 3, pushups: 15 }, practiced: new Map(), reportedPullups: 3 }

export interface SampleCase {
  focus: 'push' | 'pull'
  minutes: number
  priority: Muscle[]
  place: GymLocation
  youth: boolean
  capacity?: BodyweightCapacity
  note?: string
}

export interface SampleRow {
  sample: SampleCase
  plan: GymPlan
  issues: string[]
}

const PRIORITIES: Muscle[][] = [[], ['chest', 'chest-upper', 'side-delts'], ['biceps'], ['abs']]

export function sampleCases(): SampleCase[] {
  const cases: SampleCase[] = []
  for (const focus of ['pull', 'push'] as const) for (const minutes of [30, 45, 60, 75]) for (const priority of PRIORITIES) {
    cases.push({ focus, minutes, priority, place: HOME, youth: true })
  }
  for (const focus of ['pull', 'push'] as const) for (const minutes of [30, 45, 60, 75]) {
    cases.push({ focus, minutes, priority: focus === 'pull' ? ['lats', 'biceps'] : ['triceps', 'side-delts'], place: GYM, youth: false })
  }
  for (const minutes of [30, 45, 60]) {
    cases.push({ focus: 'pull', minutes, priority: [], place: HOME_BAND, youth: true, capacity: BUILDING_PULLUPS, note: '3 pull-ups' })
  }
  return cases
}

const DAY_MUSCLES: Record<'push' | 'pull', ReadonlySet<Muscle>> = {
  pull: new Set(['lats', 'upper-back', 'traps', 'rear-delts', 'biceps', 'forearms', 'abs', 'obliques', 'hip-flexors']),
  push: new Set(['chest', 'chest-upper', 'front-delts', 'side-delts', 'triceps', 'triceps-long', 'abs', 'obliques', 'hip-flexors']),
}
const MAIN_GROUPS: Record<'push' | 'pull', string[][]> = {
  pull: [['vertical-pull'], ['horizontal-pull']],
  push: [['horizontal-press', 'incline-press', 'dip'], ['vertical-press']],
}

/** Every rule the athlete set for the generator, checked on one built session; each broken rule is one line. */
export function sessionIssues(focus: 'push' | 'pull', plan: GymPlan, minutes: number, place: GymLocation, priority: readonly Muscle[] = []): string[] {
  const issues: string[] = []
  const ex = (id: string) => GYM_EXERCISE_BY_ID[id]
  const items = plan.items
  const standalone = items.filter((it) => !it.finisher)
  // The day type comes first.
  for (const it of items) {
    const e = ex(it.exerciseId)
    if (!e.primary.every((m) => DAY_MUSCLES[focus].has(m)) || !fitsGymFocus(focus, e)) issues.push(`wrong day: ${e.name}`)
    if (focus === 'pull' && [...e.primary, ...e.secondary].some((m) => m === 'chest' || m === 'chest-upper')) issues.push(`chest on a pull day: ${e.name}`)
  }
  // The main compounds are there, first, and at their full dose before any isolation work.
  const here = availableAt(place)
  const mains: GymExercise[] = []
  for (const group of MAIN_GROUPS[focus]) {
    const main = standalone.map((it) => ex(it.exerciseId)).find((e) => e.compound && group.includes(e.pattern))
    if (main) mains.push(main)
    else if (here.some((e) => e.compound && group.includes(e.pattern) && fitsGymFocus(focus, e))) issues.push(`missing main ${group[0]}`)
  }
  const isolation = standalone.filter((it) => !ex(it.exerciseId).compound)
  for (const main of mains) {
    const sets = items.find((it) => it.exerciseId === main.id)!.sets
    if (isolation.length && sets < MAIN_COMPOUND_SETS && !items.some((it) => it.finisher?.of === main.id || it.practice)) {
      issues.push(`isolation before ${main.name} has ${MAIN_COMPOUND_SETS} sets`)
    }
  }
  // No redundant pairs: one rung of a ladder at a time, an easier one only as a finisher right after the harder one,
  // a harder one in small volume.
  items.forEach((it, i) => {
    const e = ex(it.exerciseId)
    if (it.finisher) {
      const parent = ex(it.finisher.of)
      if (items[i - 1]?.exerciseId !== parent.id) issues.push(`finisher not after ${parent.name}: ${e.name}`)
      if (it.sets > FINISHER_SETS) issues.push(`finisher over ${FINISHER_SETS} sets: ${e.name}`)
      if (e.ladder && parent.ladder && e.ladder.level >= parent.ladder.level) issues.push(`finisher not easier: ${e.name}`)
      return
    }
    for (const other of standalone) {
      const o = ex(other.exerciseId)
      if (o.id === e.id || !e.ladder || !o.ladder || e.ladder.id !== o.ladder.id) continue
      if (e.ladder.level === o.ladder.level) issues.push(`same rung twice: ${e.name} + ${o.name}`)
      else if (e.ladder.level < o.ladder.level) issues.push(`easier version as its own exercise: ${e.name} beside ${o.name}`)
      else if (it.sets > HARDER_VARIANT_SETS) issues.push(`harder version over ${HARDER_VARIANT_SETS} sets: ${e.name}`)
    }
  })
  // About two isolation exercises a muscle, and no muscle buried in sets.
  const perMuscle = new Map<Muscle, number>()
  for (const it of isolation) perMuscle.set(ex(it.exerciseId).primary[0], (perMuscle.get(ex(it.exerciseId).primary[0]) ?? 0) + 1)
  for (const [m, n] of perMuscle) if (n > ISOLATION_PER_MUSCLE) issues.push(`${n} isolation exercises for ${m}`)
  // Sets aimed at a muscle (the exercises it is a main muscle of, at their share): ten a session, twelve for a priority.
  const credit = new Map<Muscle, number>()
  for (const it of items) for (const m of ex(it.exerciseId).primary) {
    credit.set(m, (credit.get(m) ?? 0) + it.sets * volumeShare(ex(it.exerciseId), m))
  }
  for (const [m, n] of credit) if (n > (priority.includes(m) || (focus === 'pull' && m === 'upper-back') ? 12 : 10)) issues.push(`${n} sets for ${m}`)
  for (const it of items) if (it.sets > MAIN_COMPOUND_SETS) issues.push(`${it.sets} sets of ${ex(it.exerciseId).name}`)
  // Curls never outnumber the back compounds.
  if (focus === 'pull') {
    const back = items.reduce((n, it) => n + (ex(it.exerciseId).compound && ['vertical-pull', 'horizontal-pull'].includes(ex(it.exerciseId).pattern) ? it.sets : 0), 0)
    const curls = items.reduce((n, it) => n + (ex(it.exerciseId).pattern === 'biceps' ? it.sets : 0), 0)
    if (curls > back) issues.push(`${curls} curl sets for ${back} back sets`)
    if (items.some((it) => it.exerciseId === 'chin-up') && here.some((e) => e.id === 'pull-up')) issues.push('chin-up picked where the pull-up can be done')
  }
  // Order: no isolation exercise before a compound that works the same muscle.
  items.forEach((it, i) => {
    const e = ex(it.exerciseId)
    if (e.compound || it.finisher) return
    const later = items.slice(i + 1).find((o) => ex(o.exerciseId).compound && e.primary.some((m) => volumeShare(ex(o.exerciseId), m) > 0))
    if (later) issues.push(`${e.name} before ${ex(later.exerciseId).name}`)
  })
  // Lifting capped near an hour, and inside the minutes asked for.
  if (plan.estimatedMin > Math.min(minutes, MAX_LIFTING_MIN)) issues.push(`${plan.estimatedMin} min for ${Math.min(minutes, MAX_LIFTING_MIN)}`)
  // The same movement twice.
  const ids = items.map((it) => it.exerciseId)
  if (new Set(ids).size !== ids.length) issues.push('the same exercise twice')
  return issues
}

export function sampleSessions(now: number): SampleRow[] {
  return sampleCases().map((sample) => {
    const plan = buildGymSession({ location: sample.place, focus: sample.focus, minutes: sample.minutes, sessions: [], youth: sample.youth,
      goals: GOALS, now, ...(sample.capacity ? { capacity: sample.capacity } : {}), ...steerInput({}, sample.priority) })
    return { sample, plan, issues: sessionIssues(sample.focus, plan, sample.minutes, sample.place, sample.priority) }
  })
}

const MUSCLE_SHORT: Partial<Record<Muscle, string>> = { 'chest-upper': 'upper chest', 'side-delts': 'side delts' }

/** The rows as a Markdown table: one session a row, each exercise with its sets, finishers marked. */
export function sampleTable(rows: SampleRow[]): string {
  const lines = ['| # | Day | Place | Min | Priority | Plan | Exercises (sets) | Checks |', '|---|---|---|---|---|---|---|---|']
  rows.forEach(({ sample, plan, issues }, i) => {
    const exercises = plan.items.map((it) => {
      const name = GYM_EXERCISE_BY_ID[it.exerciseId].name
      return it.finisher ? `↳ finisher: ${name} ×${it.sets}` : `${name} ×${it.sets}`
    }).join('; ')
    const priority = sample.priority.map((m) => MUSCLE_SHORT[m] ?? m).join(', ') || '—'
    const who = `${sample.place.name}${sample.youth ? ', teen' : ''}${sample.note ? `, ${sample.note}` : ''}`
    lines.push(`| ${i + 1} | ${sample.focus === 'pull' ? 'Pull' : 'Push'} | ${who} | ${sample.minutes} | ${priority} | ${plan.estimatedMin} min | ${exercises} | ${issues.length ? issues.join('; ') : 'ok'} |`)
  })
  return lines.join('\n')
}
