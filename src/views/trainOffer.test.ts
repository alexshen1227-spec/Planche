import { describe, expect, it } from 'vitest'
import type { AppState, Session } from '../types'
import type { TodayPlan } from '../lib/plan/planner'
import { initialState } from '../lib/store'
import { offersCalisthenicsInstead } from './Train'

/**
 * After the planche opener of a gym day was saved, Train still offered "Instead
 * of the gym: a calisthenics session (~45 min, 28 sets)" while Home said "go
 * to the lifts". Asserted on the decision (is the card offered), not its words.
 */
const NOW = new Date(2026, 10, 27, 17).getTime()
const OPEN = { openerDay: false, ended: false }
const session = (at: number): Session => ({
  id: `s${at}`, startedAt: at, endedAt: at + 60_000, workoutName: 'x', workoutKind: 'auto', stepId: 'tuck',
  sets: [{ exerciseId: 'planche-lean', kind: 'hold', value: 5, target: 5, section: 'main', at }],
})
const withSessions = (...s: Session[]): AppState => ({ ...initialState(), sessions: s })
const gymDay = { kind: 'gym', gym: {}, skill: { opener: true } } as unknown as TodayPlan
const gymDayNoOpener = { kind: 'gym', gym: {} } as unknown as TodayPlan
const caliDay = { kind: 'calisthenics', skill: { skills: ['planche'] } } as unknown as TodayPlan

describe('Train does not offer a second full session after the opener', () => {
  it('is offered as the alternative on a gym day before anything is trained', () => {
    expect(offersCalisthenicsInstead(withSessions(), gymDay, NOW, OPEN)).toBe(true)
  })
  it('is withdrawn once the opener is saved', () => {
    const st = withSessions(session(NOW - 3_600_000))
    expect(offersCalisthenicsInstead(st, gymDay, NOW, OPEN)).toBe(false)
    expect(offersCalisthenicsInstead(st, gymDay, NOW, { openerDay: true, ended: false })).toBe(false)
  })
  it('is withdrawn after any skill session on a gym day, opener or not', () => {
    expect(offersCalisthenicsInstead(withSessions(session(NOW - 3_600_000)), gymDayNoOpener, NOW, OPEN)).toBe(false)
  })
  it('is withdrawn when the planner flips the saved opener day to calisthenics (the day mark says the lifts are owed)', () => {
    expect(offersCalisthenicsInstead(withSessions(session(NOW - 3_600_000)), caliDay, NOW, { openerDay: true, ended: false })).toBe(false)
  })
  it('a skill session from another day changes nothing, and a calisthenics day is untouched', () => {
    expect(offersCalisthenicsInstead(withSessions(session(NOW - 30 * 3_600_000)), gymDay, NOW, OPEN)).toBe(true)
    expect(offersCalisthenicsInstead(withSessions(session(NOW - 3_600_000)), caliDay, NOW, OPEN)).toBe(true)
  })
})
