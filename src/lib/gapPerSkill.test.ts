import { describe, expect, it } from 'vitest'
import type { AppState, CheckIn, Session, SetLog } from '../types'
import { STEP_BY_ID } from '../data/progressions'
import { initialState } from './store'
import { buildPlan } from './coach'
import { addTrack, skillView } from './skills'
import { LONG_GAP_DAYS, readSignals } from './signals'

/**
 * The time-away rail is per skill, asserted on the decisions it makes. A front
 * lever left alone for 28 days while the planche was trained yesterday read
 * "1 day away" and was handed a re-test, an unlock attempt and a max test off
 * month-old logs.
 */
const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 28, 12)
const GOOD: CheckIn = { joints: 'good', energy: 'ok', at: NOW }
const PL = STEP_BY_ID.tuck.keyExerciseId
const FL = STEP_BY_ID['fl-tuck'].keyExerciseId

function made(exerciseId: string, stepId: 'tuck' | 'fl-tuck', daysAgo: number, value: number, base = 5): Session {
  const at = NOW - daysAgo * DAY
  const skill = stepId === 'tuck' ? 'planche' : 'frontlever'
  const set: SetLog = { exerciseId, kind: 'hold', value, target: base, endReason: 'effort', section: 'main', at }
  return { id: `${stepId}-${daysAgo}`, startedAt: at, endedAt: at + 60_000, workoutName: 'x', workoutKind: 'auto', stepId, baseTargetSec: base, sets: [set], skills: { [skill]: { stepId, strategy: 'balanced', baseTargetSec: base } } }
}
function athlete(lastLeverDaysAgo: number, lastPlancheDaysAgo = 1): AppState {
  const sessions: Session[] = []
  for (let i = 0; i < 8; i++) sessions.push(made(FL, 'fl-tuck', lastLeverDaysAgo + i * 2, 6 + i * 0.5))
  for (let d = lastPlancheDaysAgo; d < 24; d += 2) sessions.push(made(PL, 'tuck', d, 10 + (24 - d) * 0.2))
  sessions.sort((a, b) => a.startedAt - b.startedAt)
  const base: AppState = {
    ...initialState(), onboarded: true, stepId: 'tuck', baseStepId: 'tuck', unlocked: ['tuck'], sessions,
    profile: { ...initialState().profile, skills: ['planche', 'frontlever'] },
  }
  return addTrack(base, 'frontlever', NOW - 60 * DAY, 'fl-tuck')
}

describe('the time-away rail reads the skill’s own days', () => {
  const state = athlete(28, 3)
  const lever = skillView(state, 'frontlever')
  const planche = skillView(state, 'planche')

  it('a lever away 28 days is a step back though the planche was trained yesterday', () => {
    const sig = readSignals(lever, NOW, GOOD)
    expect(sig.restDays).toBe(3)
    expect(sig.gapDays).toBe(28)
    const p = buildPlan(lever, NOW, GOOD)
    expect(p.gap).toBe('unknown')
    expect(p.gapReturn?.days).toBe(28)
    expect(p.challengeAllowed).toBe(false)
    expect(p.queueRetest).toBe(false)
    expect(p.queueUnlockAttempt).toBe(false)
    expect(p.suggestMaxTest).toBe(false)
    expect(p.dayType).not.toBe('push')
    expect(p.targetFactor).toBeLessThanOrEqual(1)
    expect(p.decisions.some((d) => /front lever/i.test(d.text) && d.text.includes('28'))).toBe(true)
  })

  it('"trained elsewhere" does not excuse one skill’s own gap', () => {
    const p = buildPlan(lever, NOW, { ...GOOD, gap: 'trained-elsewhere' })
    expect(p.gap).toBe('unknown')
    expect(p.gapReturn?.baseCapSec).not.toBeNull()
  })

  it('the planche, trained yesterday, is untouched', () => {
    const p = buildPlan(planche, NOW, GOOD)
    expect(p.gap).toBe('none')
    expect(p.gapReturn).toBeNull()
  })

  it('a lever trained last week has no gap', () => {
    const p = buildPlan(skillView(athlete(LONG_GAP_DAYS - 1), 'frontlever'), NOW, GOOD)
    expect(p.gap).toBe('none')
    expect(p.gapReturn).toBeNull()
    // The control: the rail is what withholds the maximal effort in the 28-day case.
  })

  it('a planche-only athlete reads restDays day for day, and a skill never trained has no gap', () => {
    const only: AppState = { ...athlete(28), tracks: undefined, profile: { ...initialState().profile } }
    const sig = readSignals(only, NOW, GOOD)
    expect(sig.gapDays).toBe(sig.restDays)
    const noLever = { ...athlete(28), sessions: athlete(28).sessions.filter((s) => s.stepId === 'tuck') }
    const s2 = readSignals(skillView(noLever, 'frontlever'), NOW, GOOD)
    expect(s2.gapDays).toBe(s2.restDays)
  })
})

describe('the "tell a parent" note uses the app’s youth rule', () => {
  // Age 18 by birth year may still be 17: careful until it is certainly 18 (`conservative`).
  const pain: CheckIn = { joints: 'pain', energy: 'ok', at: NOW, regions: ['elbow'] } as CheckIn
  const noteFor = (birthYear?: number) => {
    const base = athlete(28, 3)
    const state = { ...base, profile: { ...base.profile, birthYear } }
    return buildPlan(state, NOW, pain).decisions.some((d) => /tell a parent/.test(d.text))
  }
  it('is given at 18 by year difference and when age is unknown, not at 19', () => {
    expect(noteFor(2026 - 14)).toBe(true)
    expect(noteFor(2026 - 18)).toBe(true)
    expect(noteFor(undefined)).toBe(true)
    expect(noteFor(2026 - 19)).toBe(false)
  })
})
