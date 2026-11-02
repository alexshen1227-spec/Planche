import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppState, Session, SetLog, StepId } from '../types'
import { initialState } from './store'
import { buildPlan, type CoachPlan } from './coach'
import { applySession } from './engine'
import { finalizeFromPlan } from '../data/workouts'
import { EXERCISE_BY_ID } from '../data/exercises'
import { STEPS, STEP_BY_ID, stepAfter } from '../data/progressions'

/**
 * The loop the athlete actually lives in: the real session builder, logged
 * the way the player logs it, fed back through the real engine.
 *
 * `simulateSeason` builds its own sets, names its deloads "Deload Flow" and
 * never changes step, so it could not see what an independent review found by
 * running this loop: the coach's own deload week was never recognised as one,
 * and athletes on shorter sessions were held in a deload that never ended.
 *
 * The athlete is perfectly obedient — comes down at every working-set call,
 * holds attempts and re-tests to their limit, films and confirms everything —
 * and gets steadily stronger with no noise.
 */

const DAY = 86_400_000
const verified = (sec: number): SetLog['form'] => ({
  rating: 'clean',
  confirmed: true,
  flightConfirmed: true,
  visualReviewPassed: true,
  auto: { issues: [], confidence: 0.9, score: 90, cleanSeconds: sec, cleanRatio: 1 },
})

interface LoopDay {
  plan: CoachPlan
  stepId: StepId
  keyTarget: number | undefined
}

function runLoop(stepId: StepId, sessionMinutes: number, count: number, gainPerSession = 0.25): { days: LoopDay[]; state: AppState } {
  const base = initialState()
  let state: AppState = {
    ...base,
    onboarded: true,
    stepId,
    baseStepId: stepId,
    unlocked: STEPS.filter((s) => s.order <= STEP_BY_ID[stepId].order).map((s) => s.id),
    settings: { ...base.settings, sessionMinutes },
  }
  // True capacity per key exercise, rising every session.
  const capacity = new Map<string, number>()
  const capOf = (exerciseId: string) => {
    if (!capacity.has(exerciseId)) {
      const step = STEPS.find((s) => s.keyExerciseId === exerciseId)
      capacity.set(exerciseId, step ? step.startSec * 1.6 : 20)
    }
    return capacity.get(exerciseId)!
  }
  const days: LoopDay[] = []
  // Mondays, Wednesdays and Fridays at 18:00, local time.
  let at = new Date(2026, 0, 5, 18, 0).getTime()
  for (let i = 0; i < count; i++) {
    vi.setSystemTime(at)
    const plan = buildPlan(state, at)
    const { workout } = finalizeFromPlan(state, { source: 'auto' }, plan)
    const key = STEP_BY_ID[state.stepId].keyExerciseId
    const sets: SetLog[] = []
    let clock = at
    for (const block of workout.blocks) {
      const ex = EXERCISE_BY_ID[block.exerciseId]
      for (let s = 0; s < block.sets; s++) {
        clock += 60_000
        const side = ex?.perSide ? (s % 2 === 0 ? 'left' : 'right') : undefined
        if (block.target.kind === 'reps') {
          sets.push({ exerciseId: block.exerciseId, kind: 'reps', value: block.target.reps, target: block.target.reps, section: block.section, at: clock, ...(side ? { side } : {}) })
          continue
        }
        const target = block.target.sec
        const maximal = block.role === 'attempt' || block.role === 'bridge'
        const value = maximal ? Math.round(capOf(block.exerciseId) * 10) / 10 : target
        const filmed = block.section === 'main'
        sets.push({
          exerciseId: block.exerciseId,
          kind: 'hold',
          value,
          target,
          section: block.section,
          at: clock,
          ...(side ? { side } : {}),
          ...(!maximal && block.section !== 'warmup' && block.section !== 'cooldown' ? { calledAtTarget: true } : {}),
          ...(filmed ? { form: verified(value) } : {}),
          ...(block.light ? { light: true } : {}),
        })
      }
    }
    const session: Session = {
      id: `loop-${i}`,
      startedAt: at,
      endedAt: clock + 60_000,
      workoutName: workout.name,
      workoutKind: workout.kind,
      stepId: state.stepId,
      sets,
      rpe: 7,
      ...(workout.strategy ? { strategy: workout.strategy } : {}),
      ...(workout.baseTargetSec !== undefined ? { baseTargetSec: workout.baseTargetSec } : {}),
      ...(workout.blocks.some((b) => b.retest) ? { retestOffered: true } : {}),
      ...(workout.plannedDeload ? { plannedDeload: true } : {}),
    }
    const main = workout.blocks.find((b) => b.section === 'main' && b.role === 'skill' && b.exerciseId === key)
    days.push({ plan, stepId: state.stepId, keyTarget: main?.target.kind === 'hold' ? main.target.sec : undefined })
    state = applySession(state, session).next
    for (const [id, c] of capacity) capacity.set(id, c + gainPerSession)
    // Next Monday, Wednesday or Friday.
    const weekday = new Date(at).getDay()
    at += (weekday === 5 ? 3 : 2) * DAY
  }
  return { days, state }
}

afterEach(() => vi.useRealTimers())

describe('the real loop, for an athlete who does exactly what it asks', () => {
  it.each([20, 30, 45, 60])('takes an easy week and comes out of it, on %s-minute sessions', (minutes) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { days } = runLoop('tuck', minutes, 36)
    const deloads = days.filter((d) => d.plan.dayType === 'deload').length
    // About one easy week in five or six — never most of the season.
    expect(deloads).toBeLessThanOrEqual(9)
    // And the last third still has days a maximal effort is allowed on.
    expect(days.slice(-12).some((d) => d.plan.challengeAllowed)).toBe(true)
  })

  it.each(STEPS.map((s) => s.id))('never holds %s in a deload that does not end, at any session length', (stepId) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    for (const minutes of [20, 30, 45, 60]) {
      const { days } = runLoop(stepId, minutes, 36)
      const deloads = days.filter((d) => d.plan.dayType === 'deload').length
      expect({ stepId, minutes, deloads: deloads <= 9 }).toEqual({ stepId, minutes, deloads: true })
    }
  })

  it('moves up the road when the athlete gets strong enough', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { state } = runLoop('tuck', 45, 45, 0.35)
    expect(stepAfter('tuck')).toBeDefined()
    expect(STEP_BY_ID[state.stepId].order).toBeGreaterThan(STEP_BY_ID.tuck.order)
  })
})
