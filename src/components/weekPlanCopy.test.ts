import { describe, expect, it } from 'vitest'
import type { SkillId } from '../types'
import { reducer } from '../lib/store'
import { startingState } from '../lib/skillLoop'
import { coverageNotes, planCoverage, todaysDay, type DayReading } from '../lib/weekPlan'
import { coverageSummary, skillWords, todayLine, unavailableClause, type TodayLineInput } from './weekPlanCopy'

const TWO: SkillId[] = ['planche', 'frontlever']
const said = (input: Partial<TodayLineInput> & Pick<TodayLineInput, 'today'>) =>
  todayLine({ next: null, hasPlan: true, active: TWO, minutes: 45, ...input })

describe('what the week card says about today', () => {
  it('names the day the plan gives, and the order when there is one', () => {
    expect(said({ today: { kind: 'skills', weekday: 6, skills: ['frontlever'], unavailable: [] } })).toBe('Today is your front lever day.')
    expect(said({ today: { kind: 'skills', weekday: 3, skills: ['planche', 'frontlever'], unavailable: [] } })).toBe(
      'Today is your planche and front lever day, planche first.',
    )
    expect(skillWords(['planche', 'frontlever', 'flag'])).toBe('planche, front lever and human flag')
  })

  it('defers to the session the rails built instead of naming a skill day beside it', () => {
    const today: DayReading = { kind: 'skills', weekday: 3, skills: ['planche', 'frontlever'], unavailable: [] }
    // The session follows the plan: nothing to add.
    expect(said({ today, sessionSkills: ['planche', 'frontlever'] })).toBe('Today is your planche and front lever day, planche first.')
    // A pain-safe session trains none of it, and what was reported comes first.
    expect(said({ today, sessionSkills: [] })).toBe(
      "Today is your planche and front lever day in your plan, but today's session is the pain-safe one — what you reported comes first.",
    )
    // No room in the time: said with the room there is.
    expect(said({ today, sessionSkills: ['planche'], minutes: 20 })).toBe(
      "Today is your planche and front lever day, planche first. Front lever is left out of today's session: a 20-minute session has room for one skill.",
    )
    // A short dose withheld from a skill that loads what was flagged today.
    const three: DayReading = { kind: 'skills', weekday: 3, skills: ['frontlever', 'planche', 'handstand'], unavailable: [] }
    const flagged = said({ today: three, sessionSkills: ['frontlever', 'planche'], sore: ['wrist'], active: [...TWO, 'handstand'] })
    expect(flagged).toMatch(/Handstand push-up is left out of today's session/)
    expect(flagged).toMatch(/a short dose is not given to a skill that loads a joint you flagged today\.$/)
    // The same squeeze with nothing flagged does not blame a joint.
    expect(said({ today: three, sessionSkills: ['frontlever', 'planche'], minutes: 26 })).not.toMatch(/flagged/)
  })

  it('says which skills cannot train, and that the coach decides when none can', () => {
    expect(said({ today: { kind: 'open', weekday: 6, unavailable: ['frontlever'] } })).toBe(
      'Today is set to front lever in your plan, but it is waiting for kit, so the coach decides today.',
    )
    // Off the athlete's list rather than short of kit.
    expect(said({ today: { kind: 'open', weekday: 6, unavailable: ['flag'] } })).toMatch(/but it is not in your skills now, so the coach decides today/)
    expect(said({ today: { kind: 'open', weekday: 6, unavailable: ['frontlever', 'flag'] } })).toMatch(/but they are not trainable right now/)
    // One trains and one cannot: the day keeps its name, and the gap is named.
    expect(said({ today: { kind: 'skills', weekday: 3, skills: ['planche'], unavailable: ['frontlever'] } })).toBe(
      'Today is your planche day. Front lever is in your plan for today too, but it is waiting for kit.',
    )
    expect(unavailableClause(['frontlever', 'planche'], TWO)).toBe('Front lever and planche are waiting for kit')
  })

  it('reads a rest day as rest, with what comes next and no rule against training', () => {
    expect(said({ today: { kind: 'rest', weekday: 1 }, next: { weekday: 0, skills: ['planche'] } })).toBe(
      'Rest day in your plan. Next: Sunday — Planche. Starting a session anyway is fine — the coach then decides what it trains.',
    )
    // Only rest days named: there is no next day to promise.
    expect(said({ today: { kind: 'rest', weekday: 1 } })).toBe(
      'Rest day in your plan. Starting a session anyway is fine — the coach then decides what it trains.',
    )
    // With one skill there is nothing for the coach to choose between.
    expect(said({ today: { kind: 'rest', weekday: 1 }, active: ['planche'] })).toBe('Rest day in your plan. Starting a session anyway is fine.')
  })

  it('invites a plan when there is none, and otherwise says the day is open', () => {
    const open: DayReading = { kind: 'open', weekday: 4, unavailable: [] }
    expect(said({ today: open, hasPlan: false })).toBe('Give each training day its skill, or leave it to the coach.')
    expect(said({ today: open, hasPlan: false, active: ['planche'] })).toBe('Mark your training days and rest days, or leave the week open.')
    expect(said({ today: open, next: { weekday: 6, skills: ['frontlever'] } })).toBe(
      'Nothing is set for today, so the coach decides. Next in your plan: Saturday — Front lever.',
    )
    expect(said({ today: open, active: ['planche'] })).toBe('Nothing is set for today.')
  })

  it('agrees with the real reading of a real plan', () => {
    const SAT = new Date(2026, 0, 10, 18, 0).getTime()
    const state = reducer(startingState({ skills: TWO }), { type: 'SET_WEEK_PLAN', plan: { 6: ['frontlever'], 0: ['planche'], 3: ['planche', 'frontlever'] } })
    expect(said({ today: todaysDay(state, SAT) })).toBe('Today is your front lever day.')
    // Without a bar the lever cannot train, and the day goes back to the coach.
    const noBar = reducer(startingState({ skills: TWO, equipment: ['floor'] }), { type: 'SET_WEEK_PLAN', plan: { 6: ['frontlever'] } })
    expect(said({ today: todaysDay(noBar, SAT) })).toMatch(/set to front lever in your plan, but it is waiting for kit/)
  })
})

describe('a plan’s week in one line', () => {
  const state = startingState({ skills: [...TWO, 'handstand'] })
  const line = (plan: Parameters<typeof planCoverage>[1]) => coverageSummary(planCoverage(state, plan))

  it('counts each skill’s days, and the days left to the coach for no one', () => {
    expect(line({ 6: ['frontlever'], 0: ['planche'], 3: ['planche', 'frontlever'] })).toBe(
      'Planche 2 days · Front lever 2 days · Handstand push-up 0 days · 4 days left to the coach',
    )
    expect(line({ 1: ['planche'], 2: 'rest' })).toBe('Planche 1 day · Front lever 0 days · Handstand push-up 0 days · 1 rest day · 5 days left to the coach')
  })

  it('keeps a third place apart: a short dose is not a day of training', () => {
    expect(line({ 3: ['planche', 'frontlever', 'handstand'], 5: ['frontlever', 'planche', 'handstand'], 6: ['handstand'] })).toBe(
      'Planche 2 days · Front lever 2 days · Handstand push-up 1 day + 2 short doses · 4 days left to the coach',
    )
    expect(line({ 3: ['planche', 'frontlever', 'handstand'] })).toMatch(/Handstand push-up 1 short dose ·/)
  })

  it('says nothing while nothing is set, and does not list skills for a week of rest alone', () => {
    // An emptied plan is `{}`: undefined would be read as the plan already saved.
    expect(line({})).toBeNull()
    expect(line({ 1: 'rest', 4: 'rest' })).toBe('No training days · 2 rest days · 5 days left to the coach')
    const saved = reducer(state, { type: 'SET_WEEK_PLAN', plan: { 1: ['planche'] } })
    expect(coverageSummary(planCoverage(saved, {}))).toBeNull()
    expect(coverageNotes(saved, {})).toEqual([])
    expect(coverageSummary(planCoverage(saved, saved.settings.weekPlan))).toMatch(/^Planche 1 day/)
    expect(coverageSummary(planCoverage(saved, undefined))).toBeNull()
  })
})
