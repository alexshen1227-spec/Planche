import { describe, expect, it } from 'vitest'
import type { AppState, Session, WeekPlan } from '../types'
import { skillOfExercise } from '../data/skills'
import { finalizeWorkoutWithPlan, planForToday } from '../data/workouts'
import { lineupFor, todaysLineup } from './lineup'
import { startingState } from './skillLoop'
import { normalizeState, reducer } from './store'
import {
  coverageNotes,
  describeDay,
  nextPlannedDay,
  planCoverage,
  plannedTrainingDays,
  readDay,
  sanitizeWeekPlan,
  todaysDay,
  weekdayOf,
  weekOutline,
  WEEK_ORDER,
} from './weekPlan'

const DAY = 86_400_000
/** Monday 5 January 2026, 18:00 local. */
const MON = new Date(2026, 0, 5, 18, 0).getTime()
const WED = new Date(2026, 0, 7, 18, 0).getTime()
const THU = new Date(2026, 0, 8, 18, 0).getTime()
const SAT = new Date(2026, 0, 10, 18, 0).getTime()
const SUN = new Date(2026, 0, 11, 18, 0).getTime()

/** The week the feature was asked for: a lever day, a planche day, and one for both. */
const PLAN: WeekPlan = { 6: ['frontlever'], 0: ['planche'], 3: ['planche', 'frontlever'] }

const roles = (state: AppState, now: number, minutes?: number) =>
  todaysLineup(state, now, minutes).map((entry) => `${entry.skill}:${entry.role}`)

function planned(skills: Parameters<typeof startingState>[0]['skills'], plan: unknown, extra: Partial<Parameters<typeof startingState>[0]> = {}) {
  return reducer(startingState({ skills, ...extra }), { type: 'SET_WEEK_PLAN', plan })
}

describe('the athlete’s own week', () => {
  it('reads a moment as the local weekday it falls on', () => {
    expect([MON, WED, SAT, SUN].map(weekdayOf)).toEqual([1, 3, 6, 0])
    // Just before and just after midnight are different days.
    expect(weekdayOf(new Date(2026, 0, 10, 23, 59).getTime())).toBe(6)
    expect(weekdayOf(new Date(2026, 0, 11, 0, 1).getTime())).toBe(0)
  })

  it('trains an assigned day as written, and leaves the rest to the coach', () => {
    const state = planned(['planche', 'frontlever'], PLAN)
    // Saturday is the lever's, though the planche is the first priority.
    expect(roles(state, SAT)).toEqual(['frontlever:lead'])
    expect(todaysLineup(state, SAT)[0].reason).toMatch(/Saturday is your front lever day in your week plan/)
    expect(roles(state, SUN)).toEqual(['planche:lead'])
    // Wednesday is both, in the order given.
    expect(roles(state, WED)).toEqual(['planche:lead', 'frontlever:partner'])
    expect(todaysLineup(state, WED)[0].reason).toMatch(/Wednesday is set to planche and front lever in your week plan, planche first/)
    // A day nobody assigned is still shared by priority, as before.
    expect(roles(state, THU)).toEqual(['planche:lead', 'frontlever:partner'])
    expect(todaysLineup(state, THU)[0].reason).toMatch(/first priority/)
    // The order on a day is the athlete's: the lever can lead a shared day.
    const leverFirst = planned(['planche', 'frontlever'], { 3: ['frontlever', 'planche'] })
    expect(roles(leverFirst, WED)).toEqual(['frontlever:lead', 'planche:partner'])
  })

  it('builds the whole session, and the day’s plan, for the skill the day belongs to', () => {
    const state = planned(['planche', 'frontlever'], PLAN)
    const saturday = finalizeWorkoutWithPlan(state, { source: 'auto' }, undefined, SAT)
    expect(saturday.workout.skills).toEqual(['frontlever'])
    expect(saturday.plan.skill).toBe('frontlever')
    expect(planForToday(state, SAT).skill).toBe('frontlever')
    // A lever day has no planche in it, and is not squeezed to share the time.
    expect(saturday.workout.blocks.some((block) => skillOfExercise(block.exerciseId) === 'planche')).toBe(false)
    expect(saturday.workout.blocks.some((block) => block.section === 'main' && skillOfExercise(block.exerciseId) === 'frontlever')).toBe(true)
    expect(saturday.workout.blocks.some((block) => block.section === 'strength')).toBe(true)
    const wednesday = finalizeWorkoutWithPlan(state, { source: 'auto' }, undefined, WED)
    expect(wednesday.workout.skills).toEqual(['planche', 'frontlever'])
    expect(wednesday.lineup.map((entry) => entry.skill)).toEqual(['planche', 'frontlever'])
  })

  it('fits a planned day into the time there is, and says who was left out', () => {
    const state = planned(['planche', 'frontlever', 'flag', 'handstand'], { 3: ['frontlever', 'planche', 'flag'] })
    expect(roles(state, WED, 45)).toEqual(['frontlever:lead', 'planche:partner', 'flag:maintenance'])
    // Twenty minutes is one skill: the first on the list.
    const short = todaysLineup(state, WED, 20)
    expect(short.map((entry) => `${entry.skill}:${entry.role}`)).toEqual(['frontlever:lead'])
    expect(short[0].reason).toMatch(/Planche and human flag are left out today: a 20-minute session has room for one skill/)
    // Twenty-six is two in full and no short dose.
    expect(roles(state, WED, 26)).toEqual(['frontlever:lead', 'planche:partner'])
    // A balance skill's short dose is practice, done first.
    const withBalance = planned(['planche', 'frontlever', 'handstand'], { 3: ['planche', 'frontlever', 'handstand'] })
    expect(roles(withBalance, WED, 45)).toEqual(['planche:lead', 'handstand:practice', 'frontlever:partner'])
  })

  it('lets a session the athlete picks by hand outrank the plan for the day', () => {
    const state = planned(['planche', 'frontlever'], PLAN)
    expect(lineupFor(state, { source: 'auto', skills: ['planche'] }, SAT).map((entry) => entry.skill)).toEqual(['planche'])
    expect(lineupFor(state, { source: 'auto' }, SAT).map((entry) => entry.skill)).toEqual(['frontlever'])
  })

  it('treats a rest day as rest, and still builds a session for someone who trains anyway', () => {
    const state = planned(['planche', 'frontlever'], { ...PLAN, 1: 'rest' })
    expect(todaysDay(state, MON)).toEqual({ kind: 'rest', weekday: 1 })
    expect(roles(state, MON)).toEqual(['planche:lead', 'frontlever:partner'])
    expect(nextPlannedDay(state, MON)).toEqual({ weekday: 3, daysAhead: 2, skills: ['planche', 'frontlever'] })
    expect(nextPlannedDay(state, SAT)).toEqual({ weekday: 0, daysAhead: 1, skills: ['planche'] })
    // The only planned day is today: the next one is a week away.
    const once = planned(['planche'], { 6: ['planche'] })
    expect(nextPlannedDay(once, SAT)).toEqual({ weekday: 6, daysAhead: 7, skills: ['planche'] })
    expect(nextPlannedDay(startingState({ skills: ['planche'] }), SAT)).toBeNull()
  })

  it('hands a day back to the coach when its skills cannot train', () => {
    // The lever needs a bar. Without one, Saturday is not a session of nothing.
    const noBar = planned(['planche', 'frontlever'], PLAN, { equipment: ['floor'] })
    expect(readDay(noBar, 6)).toEqual({ kind: 'open', weekday: 6, unavailable: ['frontlever'] })
    expect(roles(noBar, SAT)).toEqual(['planche:lead'])
    // On the shared day the planche trains and the lever is named as unavailable.
    expect(readDay(noBar, 3)).toEqual({ kind: 'skills', weekday: 3, skills: ['planche'], unavailable: ['frontlever'] })
    expect(roles(noBar, WED)).toEqual(['planche:lead'])
    // A skill the athlete stopped training is not trained because a plan still names it.
    const dropped = reducer(planned(['planche', 'frontlever'], PLAN), { type: 'SET_SKILLS', skills: ['planche'] })
    expect(readDay(dropped, 6).kind).toBe('open')
    expect(roles(dropped, SAT)).toEqual(['planche:lead'])
  })

  it('keeps a short dose off a joint flagged today, on a planned day too', () => {
    const state = planned(['planche', 'frontlever', 'handstand'], { 3: ['frontlever', 'planche', 'handstand'] })
    expect(roles(state, WED, 45)).toEqual(['frontlever:lead', 'handstand:practice', 'planche:partner'])
    const sore = reducer(state, { type: 'RECORD_SYMPTOM', event: { at: WED - 60_000, joints: 'niggle', regions: ['wrist'], source: 'check-in' } })
    const lineup = todaysLineup(sore, WED, 45)
    expect(lineup.map((entry) => `${entry.skill}:${entry.role}`)).toEqual(['frontlever:lead', 'planche:partner'])
    expect(lineup[0].reason).toMatch(/Handstand push-up is left out today/)
    expect(lineup[0].reason).toMatch(/loads the joint you flagged/)
  })

  it('validates a plan from anywhere, and keeps the weekly goal in step with it', () => {
    expect(sanitizeWeekPlan(undefined)).toBeUndefined()
    expect(sanitizeWeekPlan('rest')).toBeUndefined()
    expect(sanitizeWeekPlan([['planche']])).toBeUndefined()
    expect(sanitizeWeekPlan({ 6: [], 9: ['planche'], monday: ['planche'] })).toBeUndefined()
    expect(sanitizeWeekPlan({ 6: ['frontlever', 'frontlever', 'juggling', 42], 0: 'rest', 3: 'nap' })).toEqual({ 6: ['frontlever'], 0: 'rest' })
    // No more than a lead, a partner and one short dose.
    expect(sanitizeWeekPlan({ 2: ['planche', 'frontlever', 'flag', 'ninety', 'handstand'] })).toEqual({ 2: ['planche', 'frontlever', 'flag'] })
    expect(plannedTrainingDays(PLAN)).toBe(3)
    expect(plannedTrainingDays({ 0: 'rest' })).toBe(0)
    expect(plannedTrainingDays(undefined)).toBe(0)
    expect([describeDay(['planche', 'frontlever']), describeDay('rest'), describeDay(undefined), describeDay([])]).toEqual([
      'Planche + Front lever',
      'Rest',
      'Coach decides',
      'Coach decides',
    ])

    const base = startingState({ skills: ['planche', 'frontlever'] })
    expect(base.settings.weeklyGoal).toBe(3)
    const four = reducer(base, { type: 'SET_WEEK_PLAN', plan: { ...PLAN, 5: ['planche'] } })
    expect(four.settings.weeklyGoal).toBe(4)
    expect(four.settings.weekPlan).toEqual({ ...PLAN, 5: ['planche'] })
    // Only rest days named: the goal is the athlete's own number still.
    expect(reducer(four, { type: 'SET_WEEK_PLAN', plan: { 1: 'rest' } }).settings.weeklyGoal).toBe(4)
    // Cleared, the coach decides every day again.
    const cleared = reducer(four, { type: 'SET_WEEK_PLAN', plan: {} })
    expect(cleared.settings.weekPlan).toBeUndefined()
    expect(roles(cleared, SAT)).toEqual(['planche:lead', 'frontlever:partner'])
    // Saved, loaded, and loaded again from a file someone edited by hand.
    const loaded = normalizeState(JSON.parse(JSON.stringify(four)))
    expect(loaded.settings.weekPlan).toEqual({ ...PLAN, 5: ['planche'] })
    const raw = JSON.parse(JSON.stringify(four))
    raw.settings.weekPlan = { 6: ['frontlever', 'nonsense'], 8: ['planche'], 0: 'sleep' }
    expect(normalizeState(raw).settings.weekPlan).toEqual({ 6: ['frontlever'] })
  })

  it('says how a plan spreads the skills, only when the plan itself settles it', () => {
    const state = startingState({ skills: ['planche', 'frontlever', 'handstand'] })
    // The asked-for week leaves four days to the coach: nothing to say yet.
    expect(planCoverage(state, PLAN)).toEqual({
      skills: [
        { skill: 'planche', full: 2, short: 0 },
        { skill: 'frontlever', full: 2, short: 0 },
        { skill: 'handstand', full: 0, short: 0 },
      ],
      trainingDays: 3,
      restDays: 0,
      openDays: 4,
    })
    expect(coverageNotes(state, PLAN)).toEqual([])
    expect(coverageNotes(state, undefined)).toEqual([])
    // The same week with every other day a rest day is the whole week.
    const whole: WeekPlan = { ...PLAN, 1: 'rest', 2: 'rest', 4: 'rest', 5: 'rest' }
    const notes = coverageNotes(state, whole)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/Handstand push-up is in none of your days/)
    // Once a week, and third on the list, are each said — as convention, not as fact.
    const thin: WeekPlan = { 1: 'rest', 2: 'rest', 4: 'rest', 5: 'rest', 6: 'rest', 0: ['planche', 'frontlever', 'handstand'], 3: ['planche'] }
    const said = coverageNotes(state, thin)
    expect(said.find((note) => note.startsWith('Planche'))).toBeUndefined()
    expect(said.find((note) => note.startsWith('Front lever'))).toMatch(/one full day a week.*a convention, not something a trial has tested/)
    expect(said.find((note) => note.startsWith('Handstand'))).toMatch(/only ever gets a short dose/)
  })

  it('lays the week out Monday to Sunday with what was planned and what was done', () => {
    const state = planned(['planche', 'frontlever'], { ...PLAN, 1: 'rest' })
    const session: Session = {
      id: 'wed',
      startedAt: WED - 2 * DAY,
      endedAt: WED - 2 * DAY + 1,
      workoutName: 'x',
      workoutKind: 'auto',
      stepId: 'foundations',
      sets: [
        { exerciseId: 'ppp-hold', kind: 'hold', value: 12, target: 12, section: 'main', at: MON },
        { exerciseId: 'active-hang', kind: 'hold', value: 0, target: 15, section: 'main', at: MON },
        { exerciseId: 'tuck-front-lever', kind: 'hold', value: 3, target: 3, section: 'warmup', at: MON },
      ],
    }
    const week = weekOutline({ ...state, sessions: [session] }, WED)
    expect(week.map((day) => day.weekday)).toEqual([...WEEK_ORDER])
    expect(week.map((day) => day.plan.kind)).toEqual(['rest', 'open', 'skills', 'open', 'open', 'skills', 'skills'])
    expect(week.filter((day) => day.isToday).map((day) => day.weekday)).toEqual([3])
    expect(week.filter((day) => day.isPast).map((day) => day.weekday)).toEqual([1, 2])
    // Monday's session trained the planche: a hold of nothing and a primer do not count.
    expect(week[0]).toMatchObject({ sessionLogged: true, trained: ['planche'] })
    expect(week[2]).toMatchObject({ sessionLogged: false, trained: [] })
    // Seen from Sunday, it is the same week and Sunday is today.
    expect(weekOutline(state, SUN).filter((day) => day.isToday).map((day) => day.weekday)).toEqual([0])
  })
})
