import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppState, Session, SetLog, StepId } from '../types'
import { initialState } from './store'
import { buildPlan, type CoachPlan } from './coach'
import { applySession } from './engine'
import { finalizeFromPlan } from '../data/workouts'
import { EXERCISE_BY_ID } from '../data/exercises'
import { STEPS, STEP_BY_ID, stepAfter } from '../data/progressions'
import { bridgeStatus } from './bridge'
import { callMarksCompliance, isMainProgressionHold, stopLatencySecondsFor, stoppedAtTargetCall } from './sessionTiming'

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
 * An athlete who trains like a person: some days are better than others,
 * later sets are harder, the walk back to the phone is not the five seconds
 * the app assumes, and only some sets are filmed. Logged the way the hold
 * screen logs them — stopwatch time minus the stop allowance, the call flag
 * from `stoppedAtTargetCall` — so the floors and the walk ambiguity are real.
 */
interface Realism {
  seed: number
  /** Day-to-day swing in what the athlete can hold, as a standard deviation share. */
  dayNoise: number
  /** The walk back to the phone after a main hold, uniform, in seconds. */
  walk: [number, number]
  /** Share of main sets filmed, with a reading the athlete confirms. */
  filmShare: number
}

/** Small seeded generator (mulberry32), so a realistic run is the same every time. */
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * @param nextShapeShare where each later shape starts, as a share of its
 *   opening dose: above 1, the athlete holds the next shape as soon as they
 *   meet it; below, they practise it for weeks before early promotion is
 *   possible.
 * @param realism log like a person instead of a perfectly obedient machine.
 */
function runLoop(
  stepId: StepId,
  sessionMinutes: number,
  count: number,
  gainPerSession = 0.25,
  nextShapeShare = 1.6,
  realism?: Realism,
): { days: LoopDay[]; state: AppState } {
  const rng = realism ? seeded(realism.seed) : () => 0.5
  const gauss = () => {
    const u = Math.max(1e-9, rng())
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
  }
  const round1 = (n: number) => Math.round(n * 10) / 10
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
    // Today's form: one draw for the whole session.
    const dayFactor = realism ? Math.max(0.6, 1 + realism.dayNoise * gauss()) : 1
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
        if (realism) {
          // Held to failure on a max effort; otherwise down at the call, or
          // sooner when today's capacity runs out first.
          const can = Math.max(0.5, capOf(block.exerciseId) * dayFactor * (1 - 0.03 * s))
          const held = maximal ? can : Math.min(can, target + 0.3)
          const mainHold = isMainProgressionHold(block.exerciseId)
          const walk = mainHold ? realism.walk[0] + rng() * (realism.walk[1] - realism.walk[0]) : 0.8 + rng() * 1.5
          const raw = round1(held + walk)
          const allowance = stopLatencySecondsFor(block.exerciseId, state.settings.stopLatencySec, false, state.settings.walkBackSec)
          const value = Math.max(0, round1(raw - allowance))
          const called = callMarksCompliance(block, workout.kind) && stoppedAtTargetCall(raw, target, allowance)
          const filmed = block.section === 'main' && rng() < realism.filmShare
          // The camera analyses what was credited — up to the target for a hold
          // stopped at its call — and sees the athlete in position for `held`.
          const analysed = called ? Math.max(value, target) : value
          const clean = round1(Math.min(held, analysed))
          sets.push({
            exerciseId: block.exerciseId,
            kind: 'hold',
            value,
            raw,
            target,
            section: block.section,
            at: clock,
            timing: {
              method: 'stopwatch',
              ...(allowance > 0 ? { allowanceSec: allowance, allowance: mainHold ? ('walk-back' as const) : ('reaction' as const) } : {}),
            },
            ...(side ? { side } : {}),
            ...(called ? { calledAtTarget: true } : {}),
            ...(filmed
              ? {
                  form: {
                    rating: 'clean' as const,
                    confirmed: true,
                    flightConfirmed: true,
                    visualReviewPassed: true,
                    // Over the analysed window, as the judge computes it.
                    auto: {
                      issues: [],
                      confidence: 0.9,
                      score: 90,
                      cleanSeconds: clean,
                      cleanRatio: analysed > 0 ? Math.min(1, clean / analysed) : 1,
                      analysedSec: round1(analysed),
                    },
                  },
                }
              : {}),
            ...(block.light ? { light: true } : {}),
          })
          continue
        }
        const value = Math.round(capOf(block.exerciseId) * 10) / 10
        const loggedValue = maximal ? value : target
        const filmed = block.section === 'main'
        sets.push({
          exerciseId: block.exerciseId,
          kind: 'hold',
          value: loggedValue,
          target,
          section: block.section,
          at: clock,
          ...(side ? { side } : {}),
          ...(!maximal && block.section !== 'warmup' && block.section !== 'cooldown' ? { calledAtTarget: true } : {}),
          ...(filmed ? { form: verified(loggedValue) } : {}),
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

  // Found by running athletes who train like people: day-to-day swing, later
  // sets harder, a walk back to the phone that is not the assumed 5s, and only
  // some sets filmed. A 7s walker who comes down at the call logs two seconds
  // over with no call flag, and those holds were read as measurements: the
  // day's target echoed back, "going backwards for fifteen weeks", technique
  // picked for 2s targets at a true 15–22s, never past the tuck. And a quick
  // walker's filmed stops at the call read as camera-seen breakdowns, because
  // the check compared the stopwatch (net of the walk allowance) instead of
  // the camera's own clean time — those fake lows outvoted an 18s re-test.
  it.each([
    ['a 4s walker', 'tuck', 0.25, 1.6, { seed: 1, dayNoise: 0.1, walk: [3.5, 4.5], filmShare: 0.7 }],
    ['a slow 7s walker who rarely films', 'tuck', 0.25, 1.6, { seed: 2, dayNoise: 0.1, walk: [6.5, 7.5], filmShare: 0.3 }],
    ['a quick 3s walker starting at the lean', 'lean', 0.4, 1.6, { seed: 3, dayNoise: 0.15, walk: [2.5, 3.5], filmShare: 0.5 }],
    ['a slow gainer facing a hard next shape', 'advtuck', 0.15, 0.6, { seed: 4, dayNoise: 0.1, walk: [5, 6], filmShare: 0.8 }],
    ['an erratic 2–7s walker', 'tuck', 0.25, 1.6, { seed: 5, dayNoise: 0.1, walk: [2, 7], filmShare: 0.5 }],
  ] as [string, StepId, number, number, Realism][])('reads %s as getting stronger, and moves them up the road', (_who, start, gain, share, realism) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { days, state } = runLoop(start, 45, 60, gain, share, realism)
    // A 15% day-to-day swing on a fresh step's few readings is genuinely
    // scattered, and saying so is a fair reading (it no longer holds back the
    // re-test); at 10% it should never be called. A stall is never fair here.
    expect(days.filter((d) => d.plan.signals.noisy).length).toBeLessThanOrEqual(realism.dayNoise >= 0.15 ? 2 : 0)
    expect(days.filter((d) => d.plan.plateau !== null).length).toBe(0)
    expect(STEP_BY_ID[state.stepId].order - STEP_BY_ID[start].order).toBeGreaterThanOrEqual(2)
  })

  it('moves up the road when the athlete gets strong enough', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { state } = runLoop('tuck', 45, 45, 0.35)
    expect(stepAfter('tuck')).toBeDefined()
    expect(STEP_BY_ID[state.stepId].order).toBeGreaterThan(STEP_BY_ID.tuck.order)
  })
})
