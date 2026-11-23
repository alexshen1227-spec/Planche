import { describe, expect, it } from 'vitest'
import type { AppState, WorkoutRequest } from '../../types'
import { initialState } from '../store'
import { dayFinished, dayStage, liftsNext, withRestFlag } from './screens'
import { endTheDay, markOpenerDay, readDayMarks } from './nextBlock'

/**
 * Fifth strict review, screens side: a gym day with an opener is not done when
 * the opener is saved. Pinned by the stage each screen reads, not by wording.
 */
const HOUR = 3_600_000
const noon = new Date(2026, 10, 24, 12).getTime()
const withSkill = (at: number): AppState => ({ ...initialState(), sessions: [{ startedAt: at, workoutKind: 'auto' } as never] })
const withGym = (s: AppState, at: number): AppState => ({ ...s, gym: { ...(s.gym ?? ({} as never)), sessions: [{ startedAt: at } as never] } as never })
const none = { openerDay: false, ended: false }

describe('a gym day with an opener', () => {
  const opener = withSkill(noon - 2 * HOUR)

  it('is not finished by the opener alone, even once the planner calls the day calisthenics', () => {
    // The plan flipped: the day's kind is now what was logged.
    expect(dayStage(opener, { kind: 'calisthenics' }, noon, { openerDay: true, ended: false })).toBe('lifts-next')
    expect(dayFinished(opener, { kind: 'calisthenics' }, noon, { openerDay: true, ended: false })).toBe(false)
    // Or still a gym day that opens with a skill.
    expect(liftsNext(opener, { kind: 'gym', skill: { opener: true } }, noon, none)).toBe(true)
  })

  it('is finished when the lifts are saved', () => {
    const both = withGym(opener, noon - HOUR)
    expect(dayStage(both, { kind: 'calisthenics' }, noon, { openerDay: true, ended: false })).toBe('done')
    expect(dayFinished(both, { kind: 'gym', skill: { opener: true } }, noon, none)).toBe(true)
  })

  it('is finished when the athlete ends the day, logged or not', () => {
    expect(dayFinished(opener, { kind: 'calisthenics' }, noon, { openerDay: true, ended: true })).toBe(true)
  })

  it('a plain calisthenics day is done with its session, and a fresh day is open', () => {
    expect(dayStage(opener, { kind: 'calisthenics' }, noon, none)).toBe('done')
    expect(dayStage(initialState(), { kind: 'gym', skill: { opener: true } }, noon, { openerDay: true, ended: false })).toBe('open')
  })

  it('yesterday’s opener owes nothing today', () => {
    const old = withSkill(noon - 30 * HOUR)
    expect(dayStage(old, { kind: 'gym' }, noon, { openerDay: true, ended: false })).toBe('open')
  })
})

describe('a picked skill day inside the rest rule says so on its request', () => {
  const request = { source: 'auto', skills: ['planche'] } as WorkoutRequest
  it('carries hours and the rule', () => {
    const flagged = withRestFlag(request, { hours: 22, ruleHours: 48 }) as WorkoutRequest & { insideRest?: { hours: number; ruleHours: number } }
    expect(flagged.insideRest).toEqual({ hours: 22, ruleHours: 48 })
    expect(flagged.skills).toEqual(['planche'])
  })
  it('leaves a request outside the rule exactly as it was', () => {
    expect(withRestFlag(request, undefined)).toBe(request)
  })
})

describe('the day marks outlive the page', () => {
  it('end the day, mark an opener, and forget it tomorrow', () => {
    const store = new Map<string, string>()
    const g = globalThis as unknown as { localStorage?: unknown }
    const before = g.localStorage
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    try {
      expect(readDayMarks(noon)).toEqual({ openerDay: false, ended: false })
      markOpenerDay(noon)
      expect(readDayMarks(noon)).toEqual({ openerDay: true, ended: false })
      endTheDay(noon)
      expect(readDayMarks(noon)).toEqual({ openerDay: true, ended: true })
      expect(readDayMarks(noon + 24 * HOUR)).toEqual({ openerDay: false, ended: false })
    } finally {
      g.localStorage = before
    }
  })
})
