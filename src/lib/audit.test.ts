import { describe, expect, it } from 'vitest'
import type { AppState, FormCheck, Session, SetLog, StepId } from '../types'
import { STEP_BY_ID, STEPS } from '../data/progressions'
import { finalizeWorkout, finalizeWorkoutWithPlan, requestFor, TEMPLATE_BY_ID } from '../data/workouts'
import { ACHIEVEMENTS } from '../data/achievements'
import { initialState, mergeExternalState, normalizeStateWithReport, reducer, reportHasLosses } from './store'
import { buildPlan } from './coach'
import { readSignals, readinessTimeline } from './signals'
import {
  endedForNonCapacityReason,
  isQualifyingSet,
  progressionCredit,
  sessionLearningValue,
} from './progression'
import { bestSeries, sessionsInWeekOf, weekStreak } from './stats'
import { mergeHumanReview, mergeModelReading, suggestedRatingFor } from '../components/FormCheckRow'

/**
 * Regressions from the 2026-10-05 audit, asserted on the decision each fix
 * makes — never on its wording. A rail that only changes copy is not a rail.
 */

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 5, 12)
const at = (daysAgo: number) => NOW - daysAgo * DAY

function athlete(stepId: StepId = 'tuck', overrides: Partial<AppState> = {}): AppState {
  const order = STEP_BY_ID[stepId].order
  return {
    ...initialState(),
    onboarded: true,
    stepId,
    baseStepId: stepId,
    unlocked: STEPS.filter((s) => s.order <= order).map((s) => s.id),
    ...overrides,
  }
}

function verified(cleanSeconds?: number): FormCheck {
  return {
    rating: 'clean',
    confirmed: true,
    flightConfirmed: true,
    auto: { issues: [], confidence: 0.9, ...(cleanSeconds !== undefined ? { cleanSeconds } : {}) },
  }
}

function hold(exerciseId: string, value: number, when: number, overrides: Partial<SetLog> = {}): SetLog {
  return { exerciseId, kind: 'hold', value, target: value, section: 'main', at: when, ...overrides }
}

function trainingDay(daysAgo: number, sets: SetLog[], overrides: Partial<Session> = {}): Session {
  return {
    id: `s-${daysAgo}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: at(daysAgo),
    endedAt: at(daysAgo) + 30 * 60_000,
    workoutName: 'Training Day',
    workoutKind: 'auto',
    stepId: 'tuck',
    sets,
    ...overrides,
  }
}

describe('joint reports reach the rails wherever they were made', () => {
  it('a pain answer at setup locks out loaded work on the first session', () => {
    const fresh = reducer(initialState(), {
      type: 'COMPLETE_ONBOARDING',
      name: 'A',
      stepId: 'tuck',
      weeklyGoal: 3,
      profile: initialState().profile,
      units: 'metric',
      symptoms: [{ at: NOW - 60_000, joints: 'pain', regions: ['wrist'], source: 'onboarding' }],
    })
    const plan = buildPlan(fresh, NOW)
    expect(plan.loadPermission).toBe('none')
    expect(plan.challengeAllowed).toBe(false)
    expect(finalizeWorkout(fresh, { source: 'auto' }, undefined, NOW).id).toMatch(/^pain-safe-recovery/)
  })

  it('a check-in answered before a discarded session still counts', () => {
    const state = reducer(athlete(), {
      type: 'RECORD_SYMPTOM',
      event: { at: NOW - 3_600_000, joints: 'pain', regions: ['elbow'], source: 'check-in', energy: 'ok' },
    })
    expect(state.sessions).toHaveLength(0)
    expect(buildPlan(state, NOW).loadPermission).toBe('none')
  })

  it('a report made mid-set is on the timeline immediately', () => {
    const state = reducer(athlete(), {
      type: 'RECORD_SYMPTOM',
      event: { at: NOW - 60_000, joints: 'niggle', regions: ['wrist'], source: 'attempt' },
    })
    const timeline = readinessTimeline(state, NOW)
    expect(timeline.at(-1)).toMatchObject({ joints: 'niggle', source: 'attempt' })
    expect(buildPlan(state, NOW).challengeAllowed).toBe(false)
  })

  it('a report dated in the future cannot outrank a real past one', () => {
    const state = athlete('tuck', {
      symptoms: [
        { id: 'past', at: NOW - DAY, joints: 'pain', regions: ['elbow'], source: 'check-in' },
        { id: 'future', at: NOW + 30 * DAY, joints: 'good', source: 'check-in' },
      ],
    })
    expect(readSignals(state, NOW).lastCheckIn?.joints).toBe('pain')
  })
})

describe('every way of starting a workout goes through the same final decision', () => {
  const trained = () =>
    athlete('tuck', {
      sessions: [6, 4, 2].map((d) => trainingDay(d, [hold('tuck-planche', 8, at(d), { form: verified() })])),
    })

  it('a max test asked for on a day that rules out maximal effort becomes an ordinary session', () => {
    const tired = { joints: 'good' as const, energy: 'tired' as const, at: NOW }
    const { workout, plan } = finalizeWorkoutWithPlan(trained(), { source: 'test', stepId: 'tuck' }, tired, NOW)
    expect(plan.challengeAllowed).toBe(false)
    expect(workout.kind).not.toBe('test')
    expect(workout.adjustments?.length).toBeGreaterThan(0)
  })

  it('a template chosen on a pain day is replaced by the pain-safe session', () => {
    const pain = { joints: 'pain' as const, energy: 'ok' as const, at: NOW, regions: ['wrist' as const] }
    const workout = finalizeWorkout(trained(), { source: 'template', templateId: Object.keys(TEMPLATE_BY_ID)[0] }, pain, NOW)
    expect(workout.id).toMatch(/^pain-safe-recovery/)
  })

  it('a short version survives the readiness re-plan', () => {
    const state = trained()
    const first = finalizeWorkout(state, { source: 'auto', minutes: 15 }, undefined, NOW)
    const answer = { joints: 'good' as const, energy: 'ok' as const, at: NOW }
    const rebuilt = finalizeWorkout(state, requestFor(first), answer, NOW)
    expect(requestFor(rebuilt).minutes).toBe(15)
  })
})

describe('missing logs are missing evidence', () => {
  it('weeks with nothing logged are not banked rest: no push day and no unlock attempt', () => {
    const old = athlete('tuck', {
      sessions: [96, 93, 90].map((d) => trainingDay(d, [hold('tuck-planche', 18, at(d), { form: verified() })])),
    })
    const plan = buildPlan(old, NOW, { joints: 'good', energy: 'ok', at: NOW })
    expect(plan.dayType).not.toBe('push')
    expect(plan.queueUnlockAttempt).toBe(false)
    expect(plan.gap).toBe('unknown')
  })

  it('a max test counts as maximal effort however short it was', () => {
    const state = athlete('tuck', {
      sessions: [
        trainingDay(1, [hold('tuck-planche', 3, at(1)), hold('tuck-planche', 2, at(1) + 60_000)], {
          workoutKind: 'test',
          workoutName: 'Max Test',
        }),
      ],
    })
    expect(readSignals(state, NOW).lastLoadedWasTest).toBe(true)
    expect(buildPlan(state, NOW).dayType).toBe('technique')
  })
})

describe('progression evidence', () => {
  it('a verified-duration badge needs the clean seconds, not the stopwatch', () => {
    // 20s on the timer, but the camera saw only 5 clean seconds.
    const state = athlete('tuck', {
      sessions: [trainingDay(1, [hold('tuck-planche', 20, at(1), { form: verified(5) })])],
    })
    const tuck20 = ACHIEVEMENTS.find((a) => a.id === 'tuck-20')!
    const tuck5 = ACHIEVEMENTS.find((a) => a.id === 'tuck-5')!
    const last = state.sessions[0]
    expect(tuck20.check(state, last)).toBe(false)
    expect(tuck5.check(state, last)).toBe(true)
  })

  it('the qualified chart plots the same credit the unlock uses', () => {
    const state = athlete('tuck', {
      sessions: [
        trainingDay(2, [hold('tuck-planche', 20, at(2), { form: verified(5) })]),
        trainingDay(1, [hold('tuck-planche', 30, at(1), { form: verified(6) })]),
      ],
    })
    expect(bestSeries(state, 'tuck-planche').map((p) => p.value)).toEqual([5, 6])
  })

  it('a one-sided unilateral session earns no bilateral point, and both sides plot the weaker', () => {
    const left = hold('one-leg-planche', 15, at(1), { side: 'left', form: verified() })
    const right = hold('one-leg-planche', 5, at(1) + 60_000, { side: 'right', form: verified() })
    const both = athlete('oneleg', { sessions: [trainingDay(1, [left, right], { stepId: 'oneleg' })] })
    expect(bestSeries(both, 'one-leg-planche').map((p) => p.value)).toEqual([5])
    expect(sessionLearningValue(both.sessions[0], 'oneleg')).toBe(5)
    const oneSide = athlete('oneleg', { sessions: [trainingDay(1, [left], { stepId: 'oneleg' })] })
    expect(bestSeries(oneSide, 'one-leg-planche')).toEqual([])
    expect(sessionLearningValue(oneSide.sessions[0], 'oneleg')).toBe(0)
  })

  it('assisted holds are training, never unlock evidence', () => {
    const banded = hold('tuck-planche', 25, at(1), { form: verified(), assist: 'band' })
    expect(isQualifyingSet(banded, 'tuck-planche')).toBe(false)
    expect(progressionCredit(banded, 'tuck-planche')).toBe(0)
    const declaredNone = { ...banded, assist: 'none' as const }
    expect(isQualifyingSet(declaredNone, 'tuck-planche')).toBe(true)
  })

  it('an attempt that ended for a non-capacity reason does not set the working dose', () => {
    const interrupted = hold('tuck-planche', 1, at(1), { endReason: 'interruption' })
    const lockedScreen = hold('tuck-planche', 1, at(1), { timing: { method: 'interrupted' } })
    const balance = hold('tuck-planche', 1, at(1), { endReason: 'balance' })
    expect(endedForNonCapacityReason(interrupted)).toBe(true)
    expect(endedForNonCapacityReason(lockedScreen)).toBe(true)
    expect(endedForNonCapacityReason(balance)).toBe(false)
    expect(sessionLearningValue(trainingDay(1, [interrupted, lockedScreen]), 'tuck')).toBe(0)
    expect(sessionLearningValue(trainingDay(1, [balance]), 'tuck')).toBe(1)
  })
})

describe('a machine reading never stands in for the athlete', () => {
  const reading = {
    auto: { issues: [], confidence: 0.9, cleanSeconds: 10 },
    suggestedRating: 'clean' as const,
    suggestedIssues: [],
    clipKey: 'clip-1',
  }

  it('a camera result alone stays an unconfirmed suggestion', () => {
    expect(mergeModelReading(undefined, reading).confirmed).toBe(false)
  })

  it('a late camera result keeps the athlete’s newer answer', () => {
    const human = mergeHumanReview(undefined, { rating: 'slipped', issues: ['arms'] })
    const late = mergeModelReading(human, reading)
    expect(late.confirmed).toBe(true)
    expect(late.rating).toBe('slipped')
    expect(late.issues).toEqual(['arms'])
    expect(late.auto?.cleanSeconds).toBe(10)
  })

  it('flight and variant confirmations only survive a Clean rating', () => {
    const review = mergeHumanReview(undefined, { rating: 'broke', issues: [], flightConfirmed: true, variantConfirmed: true })
    expect(review.flightConfirmed).toBeUndefined()
    expect(review.variantConfirmed).toBeUndefined()
  })

  it('suggests a rating from what the camera measured', () => {
    expect(suggestedRatingFor({ issues: [], cleanRatio: 1 })).toBe('clean')
    expect(suggestedRatingFor({ issues: ['arms', 'sag'], cleanRatio: 1 })).toBe('broke')
  })
})

describe('saved history converges across tabs and replacements', () => {
  const s1 = trainingDay(1, [hold('tuck-planche', 8, at(1))])

  it('a deletion survives a later write from a tab that still had the session', () => {
    const both = reducer(athlete(), { type: 'SAVE_SESSION', session: s1 })
    const a = reducer(both, { type: 'DELETE_SESSION', id: s1.id })
    const b = reducer(both, { type: 'SET_SETTINGS', patch: { weeklyGoal: 4 } })
    expect(mergeExternalState(a, b).sessions.some((s) => s.id === s1.id)).toBe(false)
    expect(mergeExternalState(b, a).sessions.some((s) => s.id === s1.id)).toBe(false)
  })

  it('settings changed in two tabs merge field by field', () => {
    const start = athlete()
    const a = reducer(start, { type: 'SET_SETTINGS', patch: { theme: 'light' } })
    const b = reducer(start, { type: 'SET_SETTINGS', patch: { weeklyGoal: 4 } })
    const merged = mergeExternalState(a, b)
    expect(merged.settings.theme).toBe('light')
    expect(merged.settings.weeklyGoal).toBe(4)
  })

  it('a tab still holding the pre-reset dataset cannot merge it back', () => {
    const withData = reducer(athlete(), { type: 'SAVE_SESSION', session: s1 })
    const reset = reducer(withData, { type: 'RESET' })
    expect(mergeExternalState(reset, withData).sessions).toHaveLength(0)
    expect(mergeExternalState(withData, reset).sessions).toHaveLength(0)
  })

  it('an import staged before a newer save does not erase it', () => {
    const staged = athlete()
    const expectedRev = staged.rev ?? 0
    const saved = reducer(staged, { type: 'SAVE_SESSION', session: s1 })
    const imported = reducer(saved, { type: 'IMPORT_REPLACE', state: athlete('lean'), expectedRev })
    expect(imported).toBe(saved)
  })

  it('every change is a new revision', () => {
    const a = athlete()
    const b = reducer(a, { type: 'SET_SETTINGS', patch: { weeklyGoal: 5 } })
    expect((b.rev ?? 0) > (a.rev ?? 0)).toBe(true)
  })

  it('a clip that finishes after saving attaches to the saved set', () => {
    const saved = reducer(athlete(), { type: 'SAVE_SESSION', session: s1 })
    const next = reducer(saved, { type: 'ATTACH_SET_CLIP', sessionId: s1.id, setAt: s1.sets[0].at, clipKey: 'late-clip' })
    expect(next.sessions[0].sets[0].clipKey).toBe('late-clip')
  })
})

describe('imported data is repaired honestly', () => {
  it('a set with an unknown section is kept as history but cannot earn progression', () => {
    const raw = {
      ...athlete(),
      sessions: [
        {
          ...trainingDay(1, []),
          sets: [{ ...hold('tuck-planche', 25, at(1), { form: verified() }), section: 'bogus' }],
        },
      ],
    }
    const { state, report } = normalizeStateWithReport(raw, NOW)
    const set = state.sessions[0].sets[0]
    expect(set.value).toBe(25)
    expect(set.repaired).toContain('section')
    expect(isQualifyingSet(set, 'tuck-planche')).toBe(false)
    expect(report.repairedSets).toBe(1)
    expect(reportHasLosses(report)).toBe(true)
  })

  it('exact duplicate sessions in one file become one session', () => {
    const s = trainingDay(1, [hold('tuck-planche', 8, at(1))])
    const { state, report } = normalizeStateWithReport({ ...athlete(), sessions: [s, s, s] }, NOW)
    expect(state.sessions).toHaveLength(1)
    expect(report.duplicateSessions).toBe(2)
  })

  it('a bad set inside a duplicated session is reported once', () => {
    const s = trainingDay(1, [hold('tuck-planche', 8, at(1)), hold('no-such-move', 5, at(1) + 1)])
    const { report } = normalizeStateWithReport({ ...athlete(), sessions: [s, s] }, NOW)
    expect(report.droppedSets).toEqual([{ reason: 'unknown exercise', count: 1 }])
    expect(report.setsIn).toBe(2)
    expect(report.setsKept).toBe(1)
  })
})

describe('goals and streaks only count what has happened', () => {
  it('a session stamped next week does not meet this week’s goal', () => {
    const state = athlete('tuck', {
      settings: { ...initialState().settings, weeklyGoal: 1 },
      sessions: [trainingDay(-8, [hold('tuck-planche', 8, at(-8))])],
    })
    expect(sessionsInWeekOf(state, at(-8), NOW)).toHaveLength(0)
    expect(weekStreak(state, NOW).weeks).toBe(0)
  })
})

describe('what a session claims is what was done', () => {
  it('saving only the warm-ups of a skipped max test does not count as a test', () => {
    const warmupsOnly = trainingDay(2, [{ ...hold('wrist-circles', 10, at(2)), kind: 'reps', section: 'warmup' }], {
      workoutKind: 'test',
      workoutName: 'Max Test',
    })
    const state = athlete('tuck', { sessions: [warmupsOnly] })
    expect(readSignals(state, NOW).daysSinceMaxTest).toBeNull()
    expect(readSignals(state, NOW).lastLoadedWasTest).toBe(false)
  })

  it('an unreviewed machine "broke" does not rewrite what the coach thinks happened', () => {
    const machineOnly: FormCheck = {
      rating: 'broke',
      confirmed: false,
      issues: ['arms', 'sag'],
      auto: { issues: ['arms', 'sag'], confidence: 0.9, cleanSeconds: 1, cleanRatio: 0.1 },
    }
    const day = trainingDay(1, [hold('tuck-planche', 10, at(1), { form: machineOnly })])
    expect(sessionLearningValue(day, 'tuck')).toBe(10)
    const confirmedBroke = trainingDay(1, [
      hold('tuck-planche', 10, at(1), { form: { ...machineOnly, confirmed: true } }),
    ])
    expect(sessionLearningValue(confirmedBroke, 'tuck')).toBe(0)
  })
})
