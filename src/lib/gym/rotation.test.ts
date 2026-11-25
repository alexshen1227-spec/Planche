import { describe, expect, it } from 'vitest'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { buildGymSession, exploringNote } from './builder'
import { EXPLORE_EVERY, rotateSlot, type RotationChoice } from './rotation'
import type { GymLocation, GymSession, Rating } from './types'

// The athlete's ask: rate exercises so the plan knows — loved ones more often, the rest less — and it still tries
// something new once in a while. Pinned by what gets picked, session after session, never by the copy.

const DAY = 86_400_000
const START = Date.UTC(2026, 0, 5, 12)
const CURLS = ['db-curl', 'hammer-curl', 'incline-db-curl', 'cable-curl', 'barbell-curl', 'preacher-curl']
const ranked: RotationChoice[] = CURLS.map((id) => ({ exercise: GYM_EXERCISE_BY_ID[id], fit: 0.25 }))

/** One logged session per pick, run closed loop: each pick becomes the next call's history. */
function season(ratings: Record<string, Rating>, sessions = 60, history: GymSession[] = [], choices = ranked) {
  const log = [...history]
  const picks: { id: string; explored: boolean }[] = []
  for (let i = 0; i < sessions; i++) {
    const now = START + (history.length + i) * 3 * DAY
    const turn = rotateSlot({ ranked: choices, ratings, sessions: log, now })
    const id = turn?.pick.id ?? choices[0].exercise.id
    picks.push({ id, explored: turn?.explored ?? false })
    log.push({ id: `s${i}`, name: 'Pull', locationId: 'g', startedAt: now, endedAt: now + 3_600_000,
      exercises: [{ exerciseId: id, sets: [{ at: now, reps: 10, kg: 10, unit: 'kg' }] }] })
  }
  const count = (id: string) => picks.filter((p) => p.id === id).length
  return { picks, count }
}

describe('a slot shared out by the athlete’s ratings', () => {
  it('keeps the plan’s one pick while nothing comparable is rated, or only avoided', () => {
    expect(rotateSlot({ ranked, ratings: {}, sessions: [], now: START })).toBeUndefined()
    expect(rotateSlot({ ranked, ratings: { 'cable-curl': 'avoid' }, sessions: [], now: START })).toBeUndefined()
    // A rating on a movement that does another job does not start a rotation here.
    expect(rotateSlot({ ranked, ratings: { 'pull-up': 'love' }, sessions: [], now: START })).toBeUndefined()
  })

  it('picks loved movements most, then liked, fine and disliked ones, and never an avoided one', () => {
    const ratings: Record<string, Rating> = { 'db-curl': 'love', 'hammer-curl': 'like', 'incline-db-curl': 'fine', 'cable-curl': 'dislike', 'barbell-curl': 'avoid' }
    const { count } = season(ratings, 80)
    expect(count('db-curl')).toBeGreaterThan(80 * 0.4)
    expect(count('db-curl')).toBeGreaterThan(count('hammer-curl'))
    expect(count('hammer-curl')).toBeGreaterThan(count('incline-db-curl'))
    expect(count('incline-db-curl')).toBeGreaterThan(count('cable-curl'))
    // Disliked is rarely, not never; avoided is never.
    expect(count('cable-curl')).toBeGreaterThan(0)
    expect(count('cable-curl')).toBeLessThan(80 * 0.08)
    expect(count('barbell-curl')).toBe(0)
  })

  it('tries a movement never done about once every five sessions of the slot, and each one only once that way', () => {
    const { picks } = season({ 'db-curl': 'love' }, 40)
    const explored = picks.flatMap((p, i) => (p.explored ? [i] : []))
    expect(explored.length).toBeGreaterThanOrEqual(2)
    for (let k = 1; k < explored.length; k++) expect(explored[k] - explored[k - 1]).toBeGreaterThanOrEqual(EXPLORE_EVERY)
    expect(new Set(explored.map((i) => picks[i].id)).size).toBe(explored.length)
    expect(explored.every((i) => !['db-curl'].includes(picks[i].id))).toBe(true)
    // The new ones tried along the way share one fine weight: they never crowd out the loved one.
    expect(picks.slice(20).filter((p) => p.id === 'db-curl').length).toBeGreaterThan(20 * 0.6)
  })

  it('makes a disliked first choice come up less than before, not more', () => {
    // Long done every session, then disliked: the next movement in the plan's order takes over most sessions.
    const before = season({}, 10).picks.map((p) => p.id)
    expect(new Set(before)).toEqual(new Set(['db-curl']))
    const history = season({}, 10).picks.map((p, i): GymSession => ({ id: `h${i}`, name: 'Pull', locationId: 'g', startedAt: START + i * 3 * DAY,
      endedAt: START + i * 3 * DAY + 1, exercises: [{ exerciseId: p.id, sets: [{ at: START + i * 3 * DAY, reps: 10 }] }] }))
    const disliked: RotationChoice[] = [...ranked.slice(1), ranked[0]]
    const { count } = season({ 'db-curl': 'dislike' }, 30, history, disliked)
    expect(count('db-curl')).toBeLessThan(30 * 0.3)
  })

  it('does not offer again, as something new, a movement the athlete swapped away from', () => {
    const swappedAway: GymSession = { id: 'x', name: 'Pull', locationId: 'g', startedAt: START - DAY, endedAt: START - DAY + 1,
      exercises: [{ exerciseId: 'db-curl', swappedFrom: 'hammer-curl', sets: [{ at: START - DAY, reps: 10 }] }] }
    const { picks } = season({ 'db-curl': 'love' }, 40, [swappedAway])
    expect(picks.filter((p) => p.explored).map((p) => p.id)).not.toContain('hammer-curl')
  })

  it('is deterministic: the same history and ratings plan the same day', () => {
    const ratings: Record<string, Rating> = { 'db-curl': 'love', 'hammer-curl': 'like' }
    expect(season(ratings, 25).picks).toEqual(season(ratings, 25).picks)
  })
})

describe('the builder with ratings, run like a season of Pull days', () => {
  const GYM: GymLocation = { id: 'g', name: 'Gym', unit: 'kg', updatedAt: 0,
    equipment: ['floor', 'pullup-bar', 'dumbbells', 'bench', 'incline-bench', 'cable', 'ez-bar', 'preacher-bench'] as GymLocation['equipment'] }
  function pullDays(ratings: Record<string, Rating>, days = 15) {
    const sessions: GymSession[] = []
    const plans = []
    for (let i = 0; i < days; i++) {
      const now = START + i * 3 * DAY
      const plan = buildGymSession({ location: GYM, minutes: 45, focus: 'pull', sessions, ratings, youth: false, now })
      plans.push(plan)
      // Every lift moves up a rep each time, so none reads as stalled and lends its slot to a variation (a separate
      // rule, which may change even a main compound).
      sessions.push({ id: `p${i}`, name: 'Pull', locationId: GYM.id, startedAt: now, endedAt: now + 3_600_000,
        exercises: plan.items.map((it, k) => ({ exerciseId: it.exerciseId, sets: Array.from({ length: it.sets }, (_, j) => ({
          at: now + (k * 10 + j) * 60_000, reps: 6 + i,
          ...(GYM_EXERCISE_BY_ID[it.exerciseId].load === 'bodyweight' ? {} : { kg: 10 + i, unit: 'kg' as const }), rpe: 8 })) })) })
    }
    return plans
  }
  const patternOf = (id: string) => GYM_EXERCISE_BY_ID[id].pattern

  it('rotates the curl by the ratings and never moves the day’s main compounds', () => {
    const plans = pullDays({ 'db-curl': 'love', 'hammer-curl': 'like', 'chest-supported-db-row': 'love', 'db-row': 'like', 'neutral-pull-up': 'like' })
    const curls = plans.map((p) => p.items.find((it) => patternOf(it.exerciseId) === 'biceps')?.exerciseId).filter(Boolean) as string[]
    expect(curls.length).toBe(plans.length)
    expect(new Set(curls).size).toBeGreaterThan(1)
    expect(curls.filter((id) => id === 'db-curl').length).toBeGreaterThan(curls.filter((id) => id === 'hammer-curl').length)
    for (const pattern of ['vertical-pull', 'horizontal-pull'] as const) {
      const main = plans.map((p) => p.items.find((it) => patternOf(it.exerciseId) === pattern)?.exerciseId)
      expect(new Set(main).size, pattern).toBe(1)
    }
  })

  it('says so when a slot tries a movement for the first time', () => {
    const plans = pullDays({ 'db-curl': 'love' }, 15)
    const tried = plans.find((p) => p.notes.some((n) => n.endsWith('Rate it afterwards to set how often it comes back.')))
    expect(tried).toBeDefined()
    const named = tried!.items.map((it) => GYM_EXERCISE_BY_ID[it.exerciseId])
    expect(named.some((e) => tried!.notes.includes(exploringNote(e)))).toBe(true)
  })

  it('plans exactly as before for an athlete who rates nothing', () => {
    const plans = pullDays({}, 8)
    const curls = plans.map((p) => p.items.find((it) => patternOf(it.exerciseId) === 'biceps')?.exerciseId)
    expect(new Set(curls).size).toBe(1)
    expect(plans.every((p) => !p.notes.some((n) => n.includes('is new to you')))).toBe(true)
  })
})
