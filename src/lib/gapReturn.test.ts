import { describe, expect, it } from 'vitest'
import type { AppState, CheckIn, FormCheck, Session, SetLog } from '../types'
import { STEP_BY_ID, STEPS } from '../data/progressions'
import { challengeBlockedReason, finalizeWorkoutWithPlan, microBlockedReason } from '../data/workouts'
import { initialState } from './store'
import { buildPlan, type CoachPlan } from './coach'
import { LONG_GAP_DAYS } from './signals'

/**
 * The first loaded session after a long logging gap is a step back — asserted
 * on the decisions the rail makes (day type, factor, base, strategy, maximal
 * effort), never on the sentence beside them. Modelled on returnRails.test.
 */

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 16, 12)
const KEY = STEP_BY_ID.tuck.keyExerciseId

const form = (): FormCheck => ({ rating: 'clean', confirmed: true, flightConfirmed: true, auto: { issues: [], confidence: 0.9, cleanRatio: 1 } })
const holdSet = (value: number, at: number, overrides: Partial<SetLog> = {}): SetLog => ({
  exerciseId: KEY,
  kind: 'hold',
  value,
  target: value,
  endReason: 'effort',
  section: 'main',
  at,
  form: form(),
  ...overrides,
})

/** A coach session with its base target recorded, `daysAgo` before NOW. */
function session(daysAgo: number, value: number, base: number): Session {
  const at = NOW - daysAgo * DAY
  return {
    id: `s-${daysAgo}`,
    startedAt: at,
    endedAt: at + 60_000,
    workoutName: 'Tuck',
    workoutKind: 'auto',
    stepId: 'tuck',
    baseTargetSec: base,
    sets: [holdSet(value, at, { target: base, form: undefined })],
  }
}

/**
 * A history the bandit reads as "intensity is the responder" (found by search:
 * strategies cycle in the usual order over this climb), its last session
 * `gapDays` ago with `lastBase` as its recorded base.
 */
const IDS = ['balanced', 'volume', 'intensity', 'density', 'technique'] as const
const CLIMB = [8.8, 8.6, 10.9, 10.6, 11.9, 11.9, 13.9, 14.5, 15.9, 16.8, 17.1, 17.6]
function athlete(gapDays: number): AppState {
  const sessions = CLIMB.map((v, i) => ({
    ...session(gapDays + (CLIMB.length - 1 - i) * 2, v, 5),
    strategy: IDS[i % 5],
  }))
  return {
    ...initialState(),
    onboarded: true,
    stepId: 'tuck',
    baseStepId: 'tuck',
    unlocked: STEPS.filter((s) => s.skill === 'planche' && s.order <= STEP_BY_ID.tuck.order).map((s) => s.id),
    sessions,
  }
}

const GOOD: CheckIn = { joints: 'good', energy: 'ok', at: NOW }
const decisionsOf = (p: CoachPlan) => ({
  dayType: p.dayType,
  challengeAllowed: p.challengeAllowed,
  queueUnlockAttempt: p.queueUnlockAttempt,
  suggestMaxTest: p.suggestMaxTest,
  strategy: p.strategy,
  targetFactor: p.targetFactor,
})

describe('the first loaded session after a long gap is a step back', () => {
  const GAP = LONG_GAP_DAYS + 8 // 22 days, the reviewer's case
  const state = athlete(GAP)
  const plan = buildPlan(state, NOW, GOOD)

  it('is a build day with nothing maximal and a factor of at most 1', () => {
    expect(plan.signals.restDays).toBe(GAP)
    expect(plan.gapReturn).toEqual({ days: GAP, baseCapSec: 5 })
    expect(plan.dayType).toBe('build')
    expect(plan.challengeAllowed).toBe(false)
    expect(plan.queueUnlockAttempt).toBe(false)
    expect(plan.queueRetest).toBe(false)
    expect(plan.suggestMaxTest).toBe(false)
    expect(plan.targetFactor).toBeLessThanOrEqual(1)
    expect(plan.strategy).not.toBe('intensity')
    expect(challengeBlockedReason(plan)).toContain('first session back')
    expect(microBlockedReason(state, plan, NOW)).toBe(challengeBlockedReason(plan))
  })

  it('never takes a high-intensity strategy the bandit would have chosen', () => {
    // The control: the same history, rested, is on intensity — so the rail is what changes it.
    expect(buildPlan(athlete(2), NOW, GOOD).strategy).toBe('intensity')
    expect(plan.strategy).toBe('balanced')
    expect(plan.targetFactor).toBe(1)
  })

  it('builds the session on a base no higher than the last base, and a target no higher than it', () => {
    const { workout } = finalizeWorkoutWithPlan(state, { source: 'auto' }, GOOD, NOW)
    expect(workout.baseTargetSec).toBeLessThanOrEqual(5)
    const keyTargets = workout.blocks.filter((b) => b.section === 'main' && b.exerciseId === KEY).map((b) => (b.target.kind === 'hold' ? b.target.sec : 0))
    expect(keyTargets.length).toBeGreaterThan(0)
    for (const t of keyTargets) expect(t).toBeLessThanOrEqual(5)
    expect(workout.blocks.some((b) => b.role === 'attempt' || b.role === 'bridge')).toBe(false)
    // The control: the same athlete a week after their last session is not capped and may be asked for more.
    const control = finalizeWorkoutWithPlan(athlete(2), { source: 'auto' }, GOOD, NOW).workout
    expect(control.baseTargetSec ?? 0).toBeGreaterThan(5)
  })

  it('differs from a rested control only in the decisions the gap makes', () => {
    const control = buildPlan(athlete(2), NOW, GOOD)
    expect(control.gapReturn).toBeNull()
    expect(control.challengeAllowed).toBe(true)
    expect(decisionsOf(plan).challengeAllowed).not.toBe(decisionsOf(control).challengeAllowed)
  })

  it('lasts one loaded session: the next plan is no longer capped', () => {
    const back = { ...state, sessions: [...state.sessions, { ...session(0, 6, 5), id: 'back' }] }
    const next = buildPlan(back, NOW + 2 * DAY, GOOD)
    expect(next.gapReturn).toBeNull()
    expect(next.dayType).toBe('push')
  })

  it('a gap shorter than the threshold is not a return', () => {
    expect(buildPlan(athlete(LONG_GAP_DAYS - 1), NOW, GOOD).gapReturn).toBeNull()
  })

  it('an athlete who says they trained elsewhere keeps their base but gets nothing maximal', () => {
    const p = buildPlan(state, NOW, { ...GOOD, gap: 'trained-elsewhere' })
    expect(p.gap).toBe('trained-elsewhere')
    expect(p.gapReturn).toEqual({ days: GAP, baseCapSec: null })
    expect(p.challengeAllowed).toBe(false)
    expect(p.dayType).toBe('build')
    expect(p.targetFactor).toBeLessThanOrEqual(1)
  })

  it('says what the plan does, as loaded-session advice a no-load day drops', () => {
    const lines = (p: CoachPlan) => p.decisions.filter((d) => d.source === 'loaded-session' && d.text.includes('First session back after'))
    expect(lines(plan)).toHaveLength(1)
    expect(lines(plan)[0].text).toContain('5s')
    const pain: CheckIn = { joints: 'pain', energy: 'ok', at: NOW, regions: ['wrist'] }
    const painDay = buildPlan(state, NOW, pain)
    expect(painDay.loadPermission).toBe('none')
    expect(lines(painDay)).toHaveLength(0)
  })
})
