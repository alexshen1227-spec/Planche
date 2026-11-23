import { describe, expect, it } from 'vitest'
import { STRATEGY_BY_ID, buildPlan } from './coach'
import { coachTodayLabel } from './coachLabel'
import { initialState } from './store'

describe('the coach label names what it describes', () => {
  it('names the skill when there are several, and only then', () => {
    expect(coachTodayLabel('Technique', 'Planche')).toBe('Planche today: Technique')
    expect(coachTodayLabel('Technique', null)).toBe('Today: Technique')
  })
  it('two screens planning the same state at the same moment print the same strategy', () => {
    const state = initialState()
    const now = new Date(2026, 10, 24, 12).getTime()
    const a = STRATEGY_BY_ID[buildPlan(state, now).strategy].name
    const b = STRATEGY_BY_ID[buildPlan(state, now).strategy].name
    expect(coachTodayLabel(a, null)).toBe(coachTodayLabel(b, null))
  })
})
