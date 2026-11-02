import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppState, Session, SetLog, StepId } from '../types'
import { initialState } from './store'
import { buildPlan, type CoachPlan } from './coach'
import { applySession } from './engine'
import { finalizeFromPlan } from '../data/workouts'
import { EXERCISE_BY_ID } from '../data/exercises'
import { STEPS, STEP_BY_ID, stepAfter } from '../data/progressions'
import { bridgeStatus } from './bridge'

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
  /** The athlete's true capacity on the key hold that day. */
  truth: number
  bridgeOpen: boolean
  /** The working target before the strategy's factor. */
  base: number | undefined
}

/**
 * @param nextShapeShare where each later shape starts, as a share of its
 *   opening dose: above 1, the athlete holds the next shape as soon as they
 *   meet it; below, they practise it for weeks before early promotion is
 *   possible.
 */
function runLoop(
  stepId: StepId,
  sessionMinutes: number,
  count: number,
  gainPerSession = 0.25,
  nextShapeShare = 1.6,
): { days: LoopDay[]; state: AppState } {
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
      capacity.set(exerciseId, step ? step.startSec * (step.id === stepId ? 1.6 : nextShapeShare) : 20)
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
    days.push({
      plan,
      stepId: state.stepId,
      keyTarget: main?.target.kind === 'hold' ? main.target.sec : undefined,
      truth: capOf(key),
      bridgeOpen: bridgeStatus(state, state.stepId)?.open === true,
      base: workout.baseTargetSec,
    })
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

  // Found by an independent review, and by this loop: working sets stopped at
  // the coach's own targets were read as measurements. Targets vary with the
  // strategy (0.7× on a technique day, 1.25× on an intensity day), so a
  // noise-free athlete gaining every session was told for weeks their hold was
  // going backwards; the next re-test read as a sudden jump; one re-test was
  // credited to whichever strategy came before it, which then ran nine
  // sessions straight at 0.7× targets; the targets after a re-test stayed
  // where they had been; and the capacity cap fell to the 2s targets they had
  // been given while they could hold 10s, closing next-shape practice.
  function expectFloorsReadAsFloors(days: LoopDay[]) {
    expect(days.filter((d) => d.plan.signals.noisy)).toEqual([])
    expect(days.filter((d) => d.plan.plateau !== null)).toEqual([])
    expect(days.filter((d) => (d.plan.signals.trendPerWeek ?? 0) < 0)).toEqual([])
    expect(days.filter((d) => d.plan.capabilityJump !== null)).toEqual([])
    // Once next-shape practice opens on a step, it stays open while the athlete keeps getting stronger.
    for (const step of new Set(days.map((d) => d.stepId))) {
      const onStep = days.filter((d) => d.stepId === step)
      const firstOpen = onStep.findIndex((d) => d.bridgeOpen)
      if (firstOpen >= 0) expect({ step, closed: onStep.slice(firstOpen).filter((d) => !d.bridgeOpen).length }).toEqual({ step, closed: 0 })
    }
    // The session after a re-test works from what it measured: about 60% of it.
    days.forEach((d, i) => {
      const next = days[i + 1]
      if (!d.plan.queueRetest || !next || next.stepId !== d.stepId || next.base === undefined) return
      expect({ truth: d.truth, base: next.base >= Math.round(d.truth * 0.55) }).toEqual({ truth: d.truth, base: true })
    })
    // No strategy is repeated for a fortnight on the strength of one reading.
    let run = 0
    let longest = 0
    let last: string | undefined
    for (const d of days.filter((x) => x.plan.dayType !== 'deload')) {
      run = d.plan.strategy === last ? run + 1 : 1
      last = d.plan.strategy
      longest = Math.max(longest, run)
    }
    expect(longest).toBeLessThanOrEqual(3)
  }

  it('reads a hold stopped at its call as a floor, not as the athlete’s max', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { days, state } = runLoop('tuck', 45, 45, 0.3)
    expectFloorsReadAsFloors(days)
    // Before, this athlete never got past the straddle.
    expect(state.stepId).toBe('full')
  })

  it('reads floors as floors for a slower athlete who practises the next shape for weeks', () => {
    // The next shape starts well below its opening dose, so next-shape practice
    // stays open for weeks with nothing but floors between re-tests.
    vi.useFakeTimers({ toFake: ['Date'] })
    const { days } = runLoop('tuck', 45, 60, 0.12, 0.6)
    expect(days.filter((d) => d.bridgeOpen).length).toBeGreaterThanOrEqual(12)
    expectFloorsReadAsFloors(days)
    // The measured trend is the athlete's real one, about 0.36s a week.
    const trends = days.map((d) => d.plan.signals.trendPerWeek).filter((t): t is number => t !== null)
    expect(trends.length).toBeGreaterThan(10)
    for (const t of trends) expect(t).toBeCloseTo(0.36, 0)
  })

  it('moves up the road when the athlete gets strong enough', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { state } = runLoop('tuck', 45, 45, 0.35)
    expect(stepAfter('tuck')).toBeDefined()
    expect(STEP_BY_ID[state.stepId].order).toBeGreaterThan(STEP_BY_ID.tuck.order)
  })
})
