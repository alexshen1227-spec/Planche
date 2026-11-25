import { describe, expect, it } from 'vitest'
import type { Muscle } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID, volumeShare } from '../../data/gym/exercises'
import { addLiftVolume, type Credit } from '../plan/load'
import { steerInput } from '../plan/screens'
import { buildGymSession, chinUpAllowed, CHIN_UP_EVERY, fatigueOrder, MAIN_COMPOUND_SETS } from './builder'
import { draftItemFromPlan, type DraftItem, type GymDraft } from './draft'
import { fitsGymFocus } from './focus'
import { GYM_PLAN_REVISION, outdatedGymPlan, regeneratedPlan } from './replan'
import type { GymLocation, GymSession } from './types'

// The workout generator's rules for Push and Pull days (the athlete's, 2026-11-24): the day type comes first, the main
// compounds get the time first, curls never outnumber the back compounds, the pull-up is the default vertical pull,
// and an old plan nobody has started is rebuilt when the generator changes.

const NOW = new Date(2026, 10, 24, 17).getTime()
const DAY = 86_400_000
const home: GymLocation = { id: 'home', name: 'Home', unit: 'kg', updatedAt: 1, equipment: ['floor', 'dumbbells', 'incline-bench', 'pullup-bar'] }
const gym: GymLocation = { id: 'gym', name: 'The gym', unit: 'kg', updatedAt: 1,
  equipment: ['barbell', 'squat-rack', 'bench', 'incline-bench', 'dumbbells', 'cable', 'lat-pulldown', 'cable-row', 'pullup-bar', 'dip-bars'] }
const goals = { skills: 3, physique: 5, strength: 3, power: 0, endurance: 0 }
const ex = (id: string) => GYM_EXERCISE_BY_ID[id]
type Input = Parameters<typeof buildGymSession>[0]
const pullDay = (minutes: number, extra: Partial<Input> = {}, own: Muscle[] = [], week: { priority?: Muscle[]; spare?: Muscle[] } = {}) =>
  buildGymSession({ location: home, focus: 'pull', minutes, sessions: [], goals, now: NOW, ...steerInput(week, own), ...extra })
const setsOf = (plan: ReturnType<typeof buildGymSession>, test: (e: ReturnType<typeof ex>) => boolean) =>
  plan.items.reduce((n, it) => n + (test(ex(it.exerciseId)) ? it.sets : 0), 0)
const isRow = (e: ReturnType<typeof ex>) => e.pattern === 'horizontal-pull'
const isCurl = (e: ReturnType<typeof ex>) => e.pattern === 'biceps' && e.primary.includes('biceps')
const isBack = (e: ReturnType<typeof ex>) => e.compound && (e.pattern === 'horizontal-pull' || e.pattern === 'vertical-pull')

describe('(a) the day type comes first', () => {
  it('a Pull day with chest as a priority and 28 minutes has zero chest exercises and includes a row', () => {
    for (const location of [home, gym]) {
      const plan = pullDay(28, { location }, ['chest', 'chest-upper'], { priority: ['chest', 'side-delts'] })
      const lifts = plan.items.map((it) => ex(it.exerciseId))
      expect(plan.fits).toBe(true)
      expect(plan.estimatedMin).toBeLessThanOrEqual(28)
      expect(lifts.some(isRow), location.id).toBe(true)
      expect(lifts.filter((e) => [...e.primary, ...e.secondary].some((m) => m === 'chest' || m === 'chest-upper')), location.id).toEqual([])
      // A priority outside the day type changes nothing: the same Pull day as with no priority at all.
      expect(plan.items, location.id).toEqual(pullDay(28, { location }).items)
    }
  })

  it('picks only the day’s muscles (core on either) at every length, with any priorities', () => {
    const pull = new Set<Muscle>(['lats', 'upper-back', 'traps', 'rear-delts', 'biceps', 'forearms', 'abs', 'obliques', 'hip-flexors'])
    const push = new Set<Muscle>(['chest', 'chest-upper', 'front-delts', 'side-delts', 'triceps', 'triceps-long', 'abs', 'obliques', 'hip-flexors'])
    const everything: Muscle[] = ['chest', 'chest-upper', 'lats', 'biceps', 'triceps', 'side-delts', 'rear-delts', 'quads', 'abs']
    for (const [focus, allowed] of [['pull', pull], ['push', push]] as const) for (const location of [home, gym]) for (const minutes of [20, 28, 45, 60, 90]) {
      const plan = buildGymSession({ location, focus, minutes, sessions: [], goals, now: NOW, ...steerInput({ priority: everything }, everything) })
      for (const it of plan.items) {
        expect(ex(it.exerciseId).primary.every((m) => allowed.has(m)), `${focus} ${minutes} ${it.exerciseId}`).toBe(true)
        expect(fitsGymFocus(focus, ex(it.exerciseId))).toBe(true)
      }
    }
  })
})

describe('(b) spare time goes to the main compounds first', () => {
  const curlDay = (minutes: number) => pullDay(minutes, { ratings: { 'hammer-curl': 'love' } }, ['biceps'])

  it('adds row sets before any hammer curls', () => {
    let curlsAt: number | undefined
    let rowSets = 0
    for (let minutes = 20; minutes <= 60; minutes++) {
      const plan = curlDay(minutes)
      const row = setsOf(plan, isRow)
      const curls = plan.items.filter((it) => it.exerciseId === 'hammer-curl')
      expect(row, `${minutes} min`).toBeGreaterThan(0)
      // Never fewer row sets with more time, and no curl until the row and the pull-up have their four sets each.
      expect(row, `${minutes} min`).toBeGreaterThanOrEqual(rowSets)
      rowSets = row
      if (curls.length) {
        curlsAt ??= minutes
        for (const it of plan.items.filter((i) => isBack(ex(i.exerciseId)))) expect(it.sets, `${minutes} min ${it.exerciseId}`).toBeGreaterThanOrEqual(MAIN_COMPOUND_SETS)
      }
    }
    expect(curlsAt).toBeDefined()
    // Below that point the minutes bought row sets: three, then four, and still no curl.
    const short = curlDay(22), enough = curlDay(28), longer = curlDay(curlsAt!)
    expect([setsOf(short, isRow), setsOf(enough, isRow)]).toEqual([3, 4])
    expect([short, enough].map((p) => p.items.some((it) => it.exerciseId === 'hammer-curl'))).toEqual([false, false])
    expect(longer.items.map((it) => it.exerciseId)).toContain('hammer-curl')
  })

  it('trims isolation first and keeps both main pulls, also on a lighter day', () => {
    for (const [minutes, factor] of [[22, 1], [28, 0.8], [45, 0.6]] as const) {
      const plan = curlDay(minutes)
      const light = pullDay(minutes, { volumeFactor: factor, ratings: { 'hammer-curl': 'love' } }, ['biceps'])
      for (const p of [plan, light]) {
        expect(p.items.map((it) => ex(it.exerciseId).pattern), `${minutes}`).toEqual(expect.arrayContaining(['vertical-pull', 'horizontal-pull']))
      }
      // A lighter day gives up the curls before any row or pull-up set.
      if (setsOf(light, isBack) < setsOf(plan, isBack)) expect(setsOf(light, isCurl), `${minutes}`).toBe(0)
    }
  })

  it('never lets curls outnumber the back compounds on a Pull day', () => {
    const ratings = { 'hammer-curl': 'love', 'db-curl': 'love', 'incline-db-curl': 'love' } as const
    for (const location of [home, gym]) for (let minutes = 20; minutes <= 120; minutes += 5) for (const factor of [0.6, 1, 1.2]) {
      const plan = pullDay(minutes, { location, ratings, volumeFactor: factor }, ['biceps', 'forearms'], { priority: ['biceps'] })
      expect(setsOf(plan, isCurl), `${location.id} ${minutes} ${factor}`).toBeLessThanOrEqual(setsOf(plan, isBack))
    }
  })
})

describe('(c) the pull-up is the default vertical pull', () => {
  const vertical = (plan: ReturnType<typeof buildGymSession>) => plan.items.find((it) => ex(it.exerciseId).pattern === 'vertical-pull')?.exerciseId
  const pullUps = (at: number, id: string, exerciseId = 'pull-up', reps = 8): GymSession => ({
    id, name: 'Pull', locationId: 'home', startedAt: at, endedAt: at + 3_600_000,
    exercises: [{ exerciseId, sets: [0, 1, 2].map((k) => ({ at: at + k * 120_000, reps, rpe: 8 })) }],
  })

  it('picks the pull-up, also when the week has plenty of upper-back work and at a gym with a pulldown', () => {
    for (const location of [home, gym]) for (const spare of [[], ['upper-back'], ['upper-back', 'rear-delts']] as Muscle[][]) {
      expect(vertical(pullDay(28, { location }, [], { spare })), `${location.id} ${spare.join()}`).toBe('pull-up')
      expect(vertical(buildGymSession({ location, focus: 'upper', minutes: 45, sessions: [], goals, now: NOW, ...steerInput({ spare }) })), `upper ${location.id}`).toBe('pull-up')
    }
  })

  it('uses the chin-up only as an occasional variation, at most once every three pull days', () => {
    // A pull-up stuck at eight reps for four pull days: the builder lends its slot to a variation.
    let sessions = [0, 1, 2, 3].map((i) => pullUps(NOW - (12 - i * 3) * DAY, `p${i}`))
    const firstStall = pullDay(28, { sessions })
    expect(vertical(firstStall)).toBe('chin-up')
    expect(firstStall.notes.some((n) => n.includes('Chin-up takes its place'))).toBe(true)
    // Simulate the next nine pull days, logging what was planned: never a chin-up within three pull days of the last.
    const picks: string[] = []
    for (let day = 0; day < 9; day++) {
      const at = NOW + day * 3 * DAY
      const pick = vertical(pullDay(28, { sessions, now: at }))!
      picks.push(pick)
      sessions = [...sessions, pullUps(at, `d${day}`, pick)]
    }
    for (let i = 0; i < picks.length; i++) {
      if (picks[i] === 'chin-up') expect(picks.slice(Math.max(0, i - CHIN_UP_EVERY + 1), i), `day ${i}: ${picks.join()}`).not.toContain('chin-up')
    }
    expect(picks.filter((p) => p === 'chin-up').length).toBeLessThanOrEqual(Math.ceil(picks.length / CHIN_UP_EVERY))
    // A chin-up done on either of the last two pull days keeps it out today, wherever it was done.
    expect(chinUpAllowed([pullUps(NOW - 2 * DAY, 'c', 'chin-up'), pullUps(NOW - DAY, 'p', 'pull-up')], NOW)).toBe(false)
    expect(chinUpAllowed([pullUps(NOW - 3 * DAY, 'c', 'chin-up'), pullUps(NOW - 2 * DAY, 'p1'), pullUps(NOW - DAY, 'p2')], NOW)).toBe(true)
  })
})

describe('(d) a cached plan from an older generator', () => {
  const sets = (n: number, reps: number, load?: number) => Array.from({ length: n }, () => ({ reps, ...(load ? { load } : {}), done: false }))
  const item = (exerciseId: string, n: number, load?: number): DraftItem => ({ exerciseId, unit: 'kg', restSec: 90, plan: { range: [6, 12], targetRpe: 8 }, sets: sets(n, 8, load) })
  const history: GymSession[] = [{ id: 'logged', name: 'Pull', locationId: 'home', startedAt: NOW - 3 * DAY, endedAt: NOW - 3 * DAY + 3_600_000,
    exercises: [{ exerciseId: 'db-row', sets: [{ at: NOW - 3 * DAY + 60_000, reps: 10, kg: 24, rpe: 8 }] }] }]
  const old: GymDraft = { id: 'old-pull', planRevision: 1, name: 'Pull', startedAt: NOW - 3_600_000, locationId: 'home', planMinutes: 28,
    items: [item('chin-up', 3), item('db-row', 2, 20), item('hammer-curl', 3, 10)] }

  it('is rebuilt with the new logic after a version bump, and logged history stays the same', () => {
    expect(GYM_PLAN_REVISION).toBeGreaterThan(1)
    expect(outdatedGymPlan(old)).toBe(true)
    const before = structuredClone(history)
    const built = pullDay(28, { sessions: history }, ['chest'])
    const fresh = regeneratedPlan(old, { name: built.name, items: built.items.map((it) => draftItemFromPlan(it, home, history)), planMinutes: 28 }, NOW)!
    expect(fresh).toMatchObject({ id: 'old-pull', name: 'Pull', locationId: 'home', planRevision: GYM_PLAN_REVISION, startedAt: NOW })
    expect(fresh.items.map((it) => [it.exerciseId, it.sets.length])).toEqual([['pull-up', 4], ['db-row', 4]])
    expect(fresh.items.flatMap((it) => it.sets).every((s) => !s.done)).toBe(true)
    expect(outdatedGymPlan(fresh)).toBe(false)
    expect(history).toEqual(before)
  })

  it('never rebuilds a workout with a logged set or an edit', () => {
    const started: GymDraft = { ...old, items: [{ ...old.items[0], sets: [{ reps: 8, done: true, at: NOW - 600_000 }, ...sets(2, 8)] }, ...old.items.slice(1)] }
    const edited: GymDraft = { ...old, items: [old.items[0], { ...old.items[1], sets: [{ reps: 8, load: 22, loadEdited: true, done: false }, ...sets(1, 8, 20)] }, old.items[2]] }
    for (const draft of [started, edited]) {
      expect(outdatedGymPlan(draft)).toBe(false)
      expect(regeneratedPlan(draft, { name: 'Pull', items: [item('pull-up', 4)] }, NOW)).toBeNull()
    }
  })
})

describe('volume and order', () => {
  it('counts a pull-up or a row as half a biceps set and a curl as a whole one', () => {
    const credit: Credit = {}
    addLiftVolume(credit, 'pull-up', 4)
    addLiftVolume(credit, 'db-row', 4)
    addLiftVolume(credit, 'hammer-curl', 2)
    expect(credit.biceps).toBe(4 * 0.5 + 4 * 0.5 + 2)
    expect(credit.lats).toBe(8)
    expect([volumeShare(ex('chin-up'), 'biceps'), volumeShare(ex('db-curl'), 'biceps'), volumeShare(ex('db-bench-press'), 'triceps')]).toEqual([0.5, 1, 1])
  })

  it('never puts an isolation exercise before a compound that works the same muscle', () => {
    expect(fatigueOrder([{ exerciseId: 'hammer-curl' }, { exerciseId: 'db-lateral-raise' }, { exerciseId: 'pull-up' }, { exerciseId: 'db-shoulder-press' }])
      .map((it) => it.exerciseId)).toEqual(['pull-up', 'hammer-curl', 'db-shoulder-press', 'db-lateral-raise'])
    for (const focus of ['pull', 'push', 'upper', 'full'] as const) for (const location of [home, gym]) for (const minutes of [30, 45, 60, 90]) {
      const items = buildGymSession({ location, focus, minutes, sessions: [], goals, now: NOW, ...steerInput({}, ['biceps', 'side-delts', 'triceps']) }).items
      items.forEach((it, i) => {
        const e = ex(it.exerciseId)
        if (e.compound || e.explosive) return
        const later = items.slice(i + 1).find((other) => ex(other.exerciseId).compound && e.primary.some((m) => volumeShare(ex(other.exerciseId), m) > 0))
        expect(later?.exerciseId, `${focus} ${location.id} ${minutes}: ${it.exerciseId}`).toBeUndefined()
      })
    }
  })
})
