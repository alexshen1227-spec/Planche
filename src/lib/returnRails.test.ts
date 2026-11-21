import { describe, expect, it } from 'vitest'
import type { AppState, CheckIn, FormCheck, Session, SetLog, SymptomEvent, WorkoutRequest } from '../types'
import { STEP_BY_ID, STEPS } from '../data/progressions'
import {
  challengeBlockedReason,
  finalizeFromPlan,
  finalizeWorkoutWithPlan,
  isRecommendedRequest,
  microBlockedReason,
  planForToday,
} from '../data/workouts'
import { initialState } from './store'
import { BAR_ATTEMPT_SPACING_DAYS, buildPlan, type CoachPlan } from './coach'
import { PAIN_RETURN_WINDOW_DAYS } from './signals'

/**
 * Three defects found by running the app as an athlete (2026-11), each
 * asserted on the decision its fix makes — never on the sentence beside it:
 * a failed attempt at the bar re-queued every session, an ordinary day handed
 * back one tap after a pain report, and a preview that showed a different
 * session from the one Start ran.
 */

const DAY = 86_400_000
const HOUR = 3_600_000
const NOW = Date.UTC(2026, 7, 4, 12)
const KEY = STEP_BY_ID.tuck.keyExerciseId
const BAR = STEP_BY_ID.tuck.unlockSec

function form(): FormCheck {
  return { rating: 'clean', confirmed: true, flightConfirmed: true, auto: { issues: [], confidence: 0.9, cleanRatio: 1 } }
}

/** A verified hold taken to its limit — a measurement, not a hold stopped at its call. */
function holdSet(value: number, at: number, overrides: Partial<SetLog> = {}): SetLog {
  return { exerciseId: KEY, kind: 'hold', value, target: value, endReason: 'effort', section: 'main', at, form: form(), ...overrides }
}

function session(daysAgo: number, sets: (at: number) => SetLog[], overrides: Partial<Session> = {}): Session {
  const at = NOW - daysAgo * DAY
  return {
    id: `s-${daysAgo}`,
    startedAt: at,
    endedAt: at + 60_000,
    workoutName: 'Session',
    workoutKind: 'auto',
    stepId: 'tuck',
    sets: sets(at),
    ...overrides,
  }
}

/**
 * Eight sessions of a steady climb to within reach of the tuck's bar, the
 * last two days ago: a rested push day with an unlock attempt earned and a
 * first max test due. `shift` moves the whole history further into the past.
 */
function climb(shift = 0): Session[] {
  const values = [10, 11, 12, 13, 14, 15, 16, 17.5]
  return values.map((value, i) => session(shift + 23 - i * 3, (at) => [holdSet(value, at)]))
}

function athlete(sessions: Session[], symptoms: SymptomEvent[] = []): AppState {
  return {
    ...initialState(),
    onboarded: true,
    stepId: 'tuck',
    baseStepId: 'tuck',
    unlocked: STEPS.filter((s) => s.skill === 'planche' && s.order <= STEP_BY_ID.tuck.order).map((s) => s.id),
    sessions,
    symptoms,
  }
}

const symptom = (daysAgo: number, joints: SymptomEvent['joints'], extra: Partial<SymptomEvent> = {}): SymptomEvent => ({
  id: `symptom-${daysAgo}-${joints}-${extra.correction ? 'undo' : 'report'}`,
  at: NOW - daysAgo * DAY,
  joints,
  regions: ['wrist'],
  source: 'check-in',
  ...extra,
})

const GOOD: CheckIn = { joints: 'good', energy: 'ok', at: NOW }

/** The decisions a rail makes, for comparing a plan with its control. */
const decisionsOf = (plan: CoachPlan) => ({
  dayType: plan.dayType,
  challengeAllowed: plan.challengeAllowed,
  queueUnlockAttempt: plan.queueUnlockAttempt,
  suggestMaxTest: plan.suggestMaxTest,
  volumeFactor: plan.volumeFactor,
  targetFactor: plan.targetFactor,
  loadPermission: plan.loadPermission,
})

const hasMaximalBlock = (state: AppState, request: WorkoutRequest, checkIn?: CheckIn) =>
  finalizeWorkoutWithPlan(state, request, checkIn, NOW).workout.blocks.some((b) => b.role === 'attempt' || b.role === 'bridge')

describe('the fixture is an ordinary rested day', () => {
  it('pushes, queues the unlock attempt it is within reach of, and has a max test due', () => {
    const plan = buildPlan(athlete(climb()), NOW, GOOD)
    expect(plan.dayType).toBe('push')
    expect(plan.challengeAllowed).toBe(true)
    expect(plan.queueUnlockAttempt).toBe(true)
    expect(plan.suggestMaxTest).toBe(true)
    expect(plan.signals.daysSinceFailedBarAttempt).toBeNull()
    expect(plan.signals.returningFromPain).toBeNull()
    expect(hasMaximalBlock(athlete(climb()), { source: 'auto' }, GOOD)).toBe(true)
  })
})

describe('a failed attempt at the bar is not re-queued every session', () => {
  /** The same climb, with the last session's hold an attempt at the bar that reached `value`. */
  const attempted = (value: number) =>
    athlete([...climb().slice(0, -1), session(2, (at) => [holdSet(value, at, { target: BAR })])])

  it('the session after a failed attempt queues no unlock attempt', () => {
    const plan = buildPlan(attempted(18), NOW)
    // Still a rested push day within reach of the bar: only the attempt waits.
    expect(plan.dayType).toBe('push')
    expect(plan.challengeAllowed).toBe(true)
    expect(plan.signals.daysSinceFailedBarAttempt).toBe(2)
    expect(plan.queueUnlockAttempt).toBe(false)
    expect(plan.queueRetest).toBe(false)
    expect(finalizeWorkoutWithPlan(attempted(18), { source: 'auto' }, undefined, NOW).workout.blocks.some((b) => b.role === 'attempt')).toBe(
      false,
    )
  })

  it('says so once, as loaded-work advice a no-load day drops', () => {
    const waiting = (plan: CoachPlan) => plan.decisions.filter((d) => d.source === 'loaded-session' && d.text.includes(`${BAR}s bar`))
    expect(waiting(buildPlan(attempted(18), NOW))).toHaveLength(1)
    const pain: CheckIn = { joints: 'pain', energy: 'ok', at: NOW, regions: ['wrist'] }
    const painDay = buildPlan(attempted(18), NOW, pain)
    expect(painDay.loadPermission).toBe('none')
    expect(waiting(painDay)).toHaveLength(0)
  })

  it('queues it again once the spacing has passed, and not a day sooner', () => {
    const state = attempted(18)
    const daysAfterAttempt = (days: number) => buildPlan(state, NOW + (days - 2) * DAY)
    for (let days = 2; days < BAR_ATTEMPT_SPACING_DAYS; days++) {
      expect(daysAfterAttempt(days).queueUnlockAttempt, `${days} days after`).toBe(false)
    }
    const due = daysAfterAttempt(BAR_ATTEMPT_SPACING_DAYS)
    expect(due.signals.daysSinceFailedBarAttempt).toBe(BAR_ATTEMPT_SPACING_DAYS)
    expect(due.queueUnlockAttempt).toBe(true)
  })

  it('an athlete within reach who has never attempted the bar gets their attempt', () => {
    const plan = buildPlan(athlete(climb()), NOW)
    expect(plan.signals.daysSinceFailedBarAttempt).toBeNull()
    expect(plan.queueUnlockAttempt).toBe(true)
  })

  it('an attempt on an earlier step does not hold back this one', () => {
    // The test that opened the tuck measured the frog stand, not this hold.
    const frog = STEP_BY_ID.frog
    const earlier = session(26, (at) => [holdSet(frog.unlockSec - 2, at, { exerciseId: frog.keyExerciseId, target: frog.unlockSec })], {
      stepId: 'frog',
    })
    const plan = buildPlan(athlete([earlier, ...climb()]), NOW)
    expect(plan.signals.daysSinceFailedBarAttempt).toBeNull()
    expect(plan.queueUnlockAttempt).toBe(true)
  })
})

describe('the first loaded session after a pain report is a step back', () => {
  const control = () => buildPlan(athlete(climb()), NOW, GOOD)

  it('pain, then "good": a build day with nothing maximal and less volume', () => {
    const state = athlete(climb(), [symptom(1, 'pain')])
    const plan = buildPlan(state, NOW, GOOD)
    expect(plan.signals.returningFromPain).toEqual({ daysSincePain: 1 })
    expect(plan.dayType).toBe('build')
    expect(plan.loadPermission).toBe('normal')
    expect(plan.challengeAllowed).toBe(false)
    expect(plan.queueUnlockAttempt).toBe(false)
    expect(plan.queueRetest).toBe(false)
    expect(plan.suggestMaxTest).toBe(false)
    expect(plan.volumeFactor).toBeLessThanOrEqual(0.85)
    expect(plan.targetFactor).toBeLessThanOrEqual(1)
    // Everything that creates a maximal effort reads the same permission.
    expect(challengeBlockedReason(plan)).toBe('this is your first session back after a pain report')
    expect(microBlockedReason(state, plan, NOW)).toBe(challengeBlockedReason(plan))
    expect(hasMaximalBlock(state, { source: 'auto' }, GOOD)).toBe(false)
    const test = finalizeWorkoutWithPlan(state, { source: 'test', stepId: 'tuck' }, GOOD, NOW).workout
    expect(test.kind).toBe('auto')
    expect(test.blocks.some((b) => b.role === 'attempt' || b.role === 'bridge')).toBe(false)
    expect(finalizeWorkoutWithPlan(state, { source: 'micro' }, GOOD, NOW).workout.kind).toBe('auto')
  })

  it('is said once, and the day is never called steady', () => {
    const plan = buildPlan(athlete(climb(), [symptom(1, 'pain')]), NOW, GOOD)
    // One line more than the same day without the report (which has its own
    // warnings — this history logs no warm-ups).
    const warnings = (p: CoachPlan) => p.decisions.filter((d) => d.kind === 'warn' && d.source === 'loaded-session').length
    expect(warnings(plan)).toBe(warnings(control()) + 1)
    expect(plan.decisions.some((d) => d.text.includes('looks steady'))).toBe(false)
    expect(plan.dayReason).not.toMatch(/push/i)
  })

  it('takes volume off a day that had none taken off', () => {
    // The climb above already has its volume held for another reason (a fast
    // rise), so the cut is shown on a history whose ordinary day keeps it all.
    const histories = [
      [8, 5, 2].map((daysAgo, i) => session(daysAgo, (at) => [holdSet(12 + i * 0.5, at)])),
      [23, 20, 17, 14, 11, 8, 5, 2].map((daysAgo) => session(daysAgo, (at) => [holdSet(12, at)])),
      [23, 20, 17, 14, 11, 8, 5, 2].map((daysAgo, i) => session(daysAgo, (at) => [holdSet(14 + i * 0.5, at)])),
    ]
    const steady = histories.find((sessions) => buildPlan(athlete(sessions), NOW, GOOD).volumeFactor === 1)
    expect(steady, 'a history whose ordinary day keeps full volume').toBeDefined()
    const plan = buildPlan(athlete(steady!, [symptom(1, 'pain')]), NOW, GOOD)
    expect(plan.signals.returningFromPain).toEqual({ daysSincePain: 1 })
    expect(plan.volumeFactor).toBe(0.85)
    expect(plan.targetFactor).toBeLessThanOrEqual(1)
    expect(plan.dayType).toBe('build')
    expect(plan.challengeAllowed).toBe(false)
  })

  it('holds without a fresh answer, and through a second "good"', () => {
    // Answered "good" yesterday and discarded the session; nothing asked today.
    const answered = athlete(climb(), [symptom(2, 'pain'), symptom(1, 'good')])
    expect(buildPlan(answered, NOW).challengeAllowed).toBe(false)
    expect(buildPlan(answered, NOW, GOOD).challengeAllowed).toBe(false)
    expect(buildPlan(answered, NOW, GOOD).signals.returningFromPain).toEqual({ daysSincePain: 2 })
  })

  it('one loaded session later, the plan is normal again', () => {
    const back: Session = {
      ...session(0, () => []),
      id: 'back',
      startedAt: NOW + HOUR,
      endedAt: NOW + 2 * HOUR,
      sets: [holdSet(17, NOW + HOUR + 60_000)],
      checkIn: GOOD,
    }
    const later = NOW + 2 * DAY + HOUR
    const after = buildPlan(athlete([...climb(), back], [symptom(1, 'pain')]), later)
    const neverHurt = buildPlan(athlete([...climb(), back]), later)
    expect(after.signals.returningFromPain).toBeNull()
    expect(after.challengeAllowed).toBe(true)
    expect(after.dayType).toBe('push')
    expect(decisionsOf(after)).toEqual(decisionsOf(neverHurt))
  })

  it('a session with no main or strength work is not the session back', () => {
    // The pain-safe session, or a mobility template: core and cooldown only.
    const recovery: Session = {
      ...session(0, () => []),
      id: 'recovery',
      startedAt: NOW - 12 * HOUR,
      endedAt: NOW - 11 * HOUR,
      workoutName: 'Pain-Safe Recovery',
      sets: [{ exerciseId: 'hollow-hold', kind: 'hold', value: 20, target: 20, section: 'core', at: NOW - 12 * HOUR + 60_000 }],
    }
    const plan = buildPlan(athlete([...climb(), recovery], [symptom(1, 'pain')]), NOW, GOOD)
    expect(plan.signals.returningFromPain).toEqual({ daysSincePain: 1 })
    expect(plan.challengeAllowed).toBe(false)
  })

  it('a withdrawn pain report changes nothing', () => {
    const state = athlete(climb(), [
      symptom(1, 'pain', { source: 'attempt' }),
      { ...symptom(1, 'pain', { source: 'attempt', correction: true }), at: NOW - DAY + 60_000 },
    ])
    const plan = buildPlan(state, NOW, GOOD)
    expect(plan.signals.returningFromPain).toBeNull()
    expect(decisionsOf(plan)).toEqual(decisionsOf(control()))
    expect(plan.queueUnlockAttempt).toBe(true)
  })

  it('a niggle is not a pain report', () => {
    const plan = buildPlan(athlete(climb(), [symptom(1, 'niggle')]), NOW, GOOD)
    expect(plan.signals.returningFromPain).toBeNull()
    expect(decisionsOf(plan)).toEqual(decisionsOf(control()))
    expect(plan.dayType).toBe('push')
  })

  it('a pain report older than the window no longer shapes the day', () => {
    // Nothing logged since before either report, so only the window decides.
    const shift = PAIN_RETURN_WINDOW_DAYS + 8
    const idle = (symptoms: SymptomEvent[]) => buildPlan(athlete(climb(shift), symptoms), NOW, GOOD)
    const inside = idle([symptom(PAIN_RETURN_WINDOW_DAYS, 'pain')])
    expect(inside.signals.returningFromPain).toEqual({ daysSincePain: PAIN_RETURN_WINDOW_DAYS })
    expect(inside.challengeAllowed).toBe(false)
    expect(inside.volumeFactor).toBeLessThanOrEqual(0.85)
    const outside = idle([symptom(PAIN_RETURN_WINDOW_DAYS + 6, 'pain')])
    expect(outside.signals.returningFromPain).toBeNull()
    expect(decisionsOf(outside)).toEqual(decisionsOf(idle([])))
  })
})

describe('the preview is built from the request Start will run', () => {
  it('only the plain recommended request may reuse the session built for today', () => {
    expect(isRecommendedRequest({ source: 'auto' })).toBe(true)
    expect(isRecommendedRequest({ source: 'auto', skills: [] })).toBe(true)
    expect(isRecommendedRequest({ source: 'auto', skills: ['planche'] })).toBe(false)
    expect(isRecommendedRequest({ source: 'auto', minutes: 15 })).toBe(false)
    expect(isRecommendedRequest({ source: 'template', templateId: 'quick-ten' })).toBe(false)
    expect(isRecommendedRequest({ source: 'test', stepId: 'tuck' })).toBe(false)
    expect(isRecommendedRequest({ source: 'micro' })).toBe(false)
  })

  it('a chosen-skills preview is the session Start builds, and carries its own request', () => {
    const state = athlete(climb())
    const request: WorkoutRequest = { source: 'auto', skills: ['planche'] }
    // Train previews from the plan it already has for today; App starts from a fresh one.
    const preview = finalizeFromPlan(state, request, planForToday(state, NOW), NOW)
    const started = finalizeWorkoutWithPlan(state, request, undefined, NOW)
    expect(preview.workout.blocks).toEqual(started.workout.blocks)
    expect(preview.workout.name).toBe(started.workout.name)
    expect(preview.workout.request).toEqual(request)
    expect(preview.lineup.map((entry) => entry.skill)).toEqual(['planche'])
    // The session built for the recommended card is a different request's.
    expect(finalizeFromPlan(state, { source: 'auto' }, planForToday(state, NOW), NOW).workout.request).toEqual({ source: 'auto' })
  })
})
