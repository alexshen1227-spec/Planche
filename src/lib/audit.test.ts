import { describe, expect, it } from 'vitest'
import type { AppState, FormCheck, Session, SetLog, StepId } from '../types'
import { STEP_BY_ID, STEPS } from '../data/progressions'
import {
  adaptiveTarget,
  challengeBlockedReason,
  finalizeWorkout,
  finalizeWorkoutWithPlan,
  requestFor,
  restrictTemplate,
  TEMPLATE_BY_ID,
  todaysSession,
} from '../data/workouts'
import { ACHIEVEMENTS } from '../data/achievements'
import { initialState, mergeExternalState, normalizeStateWithReport, reducer, reportHasLosses } from './store'
import { buildPlan, debriefSession, rewardFor } from './coach'
import { readSignals, readinessTimeline } from './signals'
import {
  endedForNonCapacityReason,
  isQualifyingSet,
  measuredLevel,
  progressionCredit,
  sessionLearningPoint,
  sessionLearningValue,
  sessionTargetCap,
  stoppedAtTarget,
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

describe('a low-energy day removes every maximal effort', () => {
  it('an athlete within reach of the bar gets no queued attempt when tired', () => {
    const near = athlete('tuck', {
      sessions: [9, 6, 3].map((d) => trainingDay(d, [hold('tuck-planche', 18, at(d), { form: verified() })])),
    })
    const fresh = buildPlan(near, NOW, { joints: 'good', energy: 'fresh', at: NOW })
    const tired = buildPlan(near, NOW, { joints: 'good', energy: 'tired', at: NOW })
    expect(fresh.challengeAllowed).toBe(true)
    expect(tired.challengeAllowed).toBe(false)
    expect(tired.queueUnlockAttempt).toBe(false)
    expect(tired.suggestMaxTest).toBe(false)
    expect(tired.dayType).not.toBe('push')
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

describe('a mistaken joint report can be withdrawn without rewriting history', () => {
  it('undoing a mis-tapped pain report restores normal loading', () => {
    const tapped = reducer(athlete(), {
      type: 'RECORD_SYMPTOM',
      event: { at: NOW - 120_000, joints: 'pain', regions: ['elbow'], source: 'attempt' },
    })
    expect(buildPlan(tapped, NOW).loadPermission).toBe('none')
    const undone = reducer(tapped, {
      type: 'RECORD_SYMPTOM',
      event: { at: NOW - 60_000, joints: 'pain', regions: ['elbow'], source: 'attempt', correction: true },
    })
    expect(undone.symptoms).toHaveLength(2)
    expect(buildPlan(undone, NOW).loadPermission).not.toBe('none')
  })

  it('a correction stamped just after an older report withdraws that one, not the latest', () => {
    const older = { id: 'a', at: NOW - 3 * DAY, joints: 'pain' as const, regions: ['wrist' as const], source: 'check-in' as const }
    const newer = { id: 'b', at: NOW - DAY, joints: 'niggle' as const, regions: ['shoulder' as const], source: 'check-in' as const }
    const state = athlete('tuck', {
      symptoms: [older, newer, { id: 'c', at: older.at + 1, joints: 'pain', source: 'manual', correction: true }],
    })
    const complaints = readinessTimeline(state, NOW).filter((r) => r.joints !== 'good')
    expect(complaints.map((r) => r.at)).toEqual([newer.at])
  })

  it('a withdrawn complaint no longer costs the strategy that preceded it', () => {
    // Held to the limit, so each is a measurement the reward can read.
    const limit = { endReason: 'effort' as const }
    const strategyDay = trainingDay(5, [hold('tuck-planche', 10, at(5), limit)], { strategy: 'volume' })
    const follow = trainingDay(2, [hold('tuck-planche', 11, at(2), limit)])
    const prior = [9, 8, 7].map((d) => trainingDay(d, [hold('tuck-planche', 10, at(d), limit)]))
    const sessions = [...prior, strategyDay, follow]
    const complaint = { id: 'p', at: at(3), joints: 'pain' as const, source: 'check-in' as const }
    const withComplaint = rewardFor(sessions, strategyDay, [complaint])
    const withdrawn = rewardFor(sessions, strategyDay, [
      complaint,
      { id: 'q', at: at(3) + 1, joints: 'pain', source: 'manual', correction: true },
    ])
    const none = rewardFor(sessions, strategyDay, [])
    expect(withComplaint).not.toBeNull()
    expect(withdrawn).toBe(none)
    expect(withComplaint!).toBeLessThan(withdrawn!)
  })
})

describe('a hold can be timed from its video', () => {
  it('re-timing a saved hold from the clip replaces the value, keeps the timer reading and replays records', () => {
    const set = hold('tuck-planche', 3, at(1), {
      raw: 8,
      timing: { method: 'stopwatch', allowanceSec: 5, allowance: 'walk-back' },
    })
    const saved = reducer(athlete(), { type: 'SAVE_SESSION', session: trainingDay(1, [set]) })
    expect(saved.prs['tuck-planche']?.value).toBe(3)
    const session = saved.sessions[0]
    const retimed = reducer(saved, {
      type: 'UPDATE_SET_TIMING',
      sessionId: session.id,
      setAt: set.at,
      value: 6.4,
      timing: { method: 'video', videoStartSec: 0.8, videoEndSec: 7.2 },
    })
    const after = retimed.sessions[0].sets[0]
    expect(after.value).toBe(6.4)
    expect(after.raw).toBe(8)
    expect(after.timing).toEqual({ method: 'video', videoStartSec: 0.8, videoEndSec: 7.2 })
    // Records come from replaying history, so the re-timed value is the PR now.
    expect(retimed.prs['tuck-planche']?.value).toBe(6.4)
  })

  it('video timing survives an export round trip; a backwards interval does not', () => {
    const good = hold('tuck-planche', 5, at(1), { timing: { method: 'video', videoStartSec: 1, videoEndSec: 6 } })
    const bad = hold('tuck-planche', 5, at(1) + 1, { timing: { method: 'video', videoStartSec: 6, videoEndSec: 1 } })
    const { state } = normalizeStateWithReport({ ...athlete(), sessions: [trainingDay(1, [good, bad])] }, NOW)
    const [a, b] = state.sessions[0].sets
    expect(a.timing).toEqual({ method: 'video', videoStartSec: 1, videoEndSec: 6 })
    expect(b.timing).toEqual({ method: 'video' })
  })
})

describe('stopping at the target does not shrink the next target', () => {
  const daySession = (daysAgo: number, value: number, target: number) =>
    trainingDay(daysAgo, [0, 1, 2].map((i) => hold('tuck-planche', value, at(daysAgo) + i * 60_000, { target })), {
      baseTargetSec: 8,
    })

  it('a prescription completed as asked holds the next base up', () => {
    const state = athlete('tuck', { sessions: [daySession(2, 8.3, 8)] })
    expect(adaptiveTarget(state, 'tuck', NOW)).toBeGreaterThanOrEqual(8)
  })

  it('a missed prescription is a real reading and lifts nothing', () => {
    const state = athlete('tuck', { sessions: [daySession(2, 5, 8)] })
    expect(adaptiveTarget(state, 'tuck', NOW)).toBeLessThan(8)
  })

  it('an old completed prescription does not hold anything up after a long gap', () => {
    const state = athlete('tuck', { sessions: [daySession(30, 8.3, 8)] })
    expect(adaptiveTarget(state, 'tuck', NOW)).toBeLessThan(8)
  })
})

describe('one permission for maximal effort includes the day itself', () => {
  // Found by playing the app: right after a max test, on a scheduled easy
  // week, the Train tab still offered another max test.
  const DAY = 86_400_000
  const morning = new Date(2026, 10, 1, 9).getTime()
  const evening = new Date(2026, 10, 1, 18).getTime()
  const session = (start: number, rpe: number): Session => ({
    id: `gate-${start}`,
    startedAt: start,
    endedAt: start + 1_800_000,
    workoutName: 'Training Day',
    workoutKind: 'auto',
    stepId: 'tuck',
    rpe,
    sets: [0, 1, 2, 3].map(
      (i): SetLog => ({ exerciseId: 'tuck-planche', kind: 'hold', value: 9, target: 9, section: 'main', surface: 'parallettes', at: start + i * 60_000 }),
    ),
  })
  const athlete = (sessions: Session[]): AppState => {
    const base = initialState()
    return {
      ...base,
      onboarded: true,
      stepId: 'tuck',
      baseStepId: 'tuck',
      unlocked: STEPS.filter((s) => s.order <= STEP_BY_ID.tuck.order).map((s) => s.id),
      sessions,
      profile: { ...base.profile, equipment: ['floor', 'parallettes'], preferredSurface: 'parallettes' },
    }
  }

  it('withholds a max test after a hard session today, and says so', () => {
    const trainedToday = buildPlan(athlete([session(morning - 5 * DAY, 7), session(morning, 9)]), evening)
    expect(trainedToday.challengeAllowed).toBe(false)
    expect(challengeBlockedReason(trainedToday)).toBe('you already trained hard today')
    expect(finalizeWorkout(athlete([session(morning - 5 * DAY, 7), session(morning, 9)]), { source: 'test' }, undefined, evening).kind).not.toBe('test')
  })

  it('still allows one on a fresh day', () => {
    expect(buildPlan(athlete([session(morning - 5 * DAY, 7)]), evening).challengeAllowed).toBe(true)
  })
})

describe('a scaled template says why', () => {
  // Found by playing the app: a scheduled easy week read "Scaled for low
  // energy" to an athlete who had just answered "Fresh".
  it('names the easy week, the lighter day or the energy answer — whichever it was', () => {
    const plan = buildPlan(initialState())
    const template = Object.values(TEMPLATE_BY_ID)[0]
    const scaled = (over: Partial<typeof plan>) => restrictTemplate(template, { ...plan, loadPermission: 'normal', volumeFactor: 0.6, ...over }).focus
    expect(scaled({ dayType: 'deload' })).toMatch(/Scaled for this easy week/)
    expect(scaled({ dayType: 'technique' })).toMatch(/Scaled for a lighter day/)
    const tired = { ...plan.signals, lastCheckIn: { ...(plan.signals.lastCheckIn ?? { at: 0, joints: 'good' as const }), source: 'fresh' as const, energy: 'tired' as const } }
    expect(scaled({ dayType: 'build', signals: tired as typeof plan.signals })).toMatch(/Scaled for low energy/)
    expect(scaled({ dayType: 'deload' })).not.toMatch(/low energy/)
  })
})

describe('the coach’s read speaks about the step’s own hold', () => {
  // Found by playing the app: after a wrist routine, its plank was reported
  // as "Best hold today 13s — logged as a PR … the 20s unlock".
  const at = Date.UTC(2026, 10, 1, 12)
  const base = initialState()
  const state: AppState = {
    ...base,
    onboarded: true,
    stepId: 'advtuck',
    baseStepId: 'advtuck',
    unlocked: STEPS.filter((s) => s.order <= STEP_BY_ID.advtuck.order).map((s) => s.id),
    prs: { 'adv-tuck-planche': { value: 9, at: at - 86_400_000 } },
  }
  const session = (exerciseId: string, value: number): Session => ({
    id: `d-${exerciseId}`,
    startedAt: at,
    endedAt: at + 600_000,
    workoutName: 'Wrist Prep',
    workoutKind: 'template',
    stepId: 'advtuck',
    sets: [{ exerciseId, kind: 'hold', value, target: value, section: 'main', at }],
  })
  const read = (s: Session) => debriefSession(state, state, s).map((d) => d.text).join(' ')

  it('calls a session without the key hold supporting work', () => {
    expect(read(session('ppp-hold', 13))).toMatch(/^Supporting work logged/)
  })

  it('names a PR only when it was one', () => {
    expect(read(session('adv-tuck-planche', 7))).not.toMatch(/PR/)
    expect(read(session('adv-tuck-planche', 11))).toMatch(/a PR/)
  })
})

describe('next-shape attempts are reported as they stand', () => {
  // Found by playing a new athlete's first day: unrated, unfilmed frog stand
  // attempts were summed up as "Held clean for 10s — rated Clean, camera pass
  // — it opens the step early …", which reads as a report of what happened.
  const at = Date.UTC(2026, 10, 1, 12)
  const base = initialState()
  const state: AppState = {
    ...base,
    onboarded: true,
    stepId: 'lean',
    baseStepId: 'lean',
    unlocked: STEPS.filter((s) => s.order <= STEP_BY_ID.lean.order).map((s) => s.id),
  }
  const frog: Session = {
    id: 'frog-attempts',
    startedAt: at,
    endedAt: at + 600_000,
    workoutName: 'Session',
    workoutKind: 'auto',
    stepId: 'lean',
    sets: [12, 7].map((value, i) => ({
      exerciseId: 'frog-stand',
      kind: 'hold' as const,
      value,
      target: 10,
      section: 'main' as const,
      at: at + i * 60_000,
    })),
  }

  it('says nothing is verified, and puts the evidence as a condition', () => {
    const line = debriefSession(state, state, frog).find((d) => /Frog Stand attempts/.test(d.text))
    expect(line?.kind).toBe('info')
    expect(line?.text).toMatch(/none of it verified yet/)
    expect(line?.text).not.toMatch(/Held clean/)
    // The frog stand is verified by its replay checklist, not the pose check.
    expect(line?.text).not.toMatch(/camera pass/)
  })
})

describe('a due re-test happens inside the session', () => {
  // Found by simulating the athlete the hold screen asks for: one who stops
  // every set at its call logs only lower bounds, so their target sat on the
  // last measured number until they chose a separate max test — 5s for twelve
  // weeks while the hold grew from 8s to 30s.
  const obedient = (extra: Session[] = []) =>
    athlete('tuck', {
      sessions: [
        ...[24, 21, 19, 17, 14, 12, 10, 7, 5].map((daysAgo) =>
          trainingDay(daysAgo, [6, 6, 6, 6].map((v, i) => hold('tuck-planche', v, at(daysAgo) + i * 60_000, { target: 6 })), {
            baseTargetSec: 6,
          }),
        ),
        ...extra,
      ],
    })

  it('queues one max clean hold at the bar, first in the main work', () => {
    const state = obedient()
    const plan = buildPlan(state, NOW)
    expect(plan.suggestMaxTest).toBe(true)
    expect(plan.queueRetest).toBe(true)
    const blocks = todaysSession(state, plan).blocks
    const first = blocks.find((b) => b.section === 'main')
    expect(first).toMatchObject({ role: 'attempt', retest: true, sets: 1, target: { kind: 'hold', sec: STEP_BY_ID.tuck.unlockSec } })
    expect(first?.note).toMatch(/re-measures/)
    // One maximal focus a day: no next-shape attempts beside it.
    expect(blocks.some((b) => b.role === 'bridge')).toBe(false)
  })

  it('is not queued again once a session has measured the hold', () => {
    const measured = trainingDay(3, [hold('tuck-planche', 14, at(3), { target: STEP_BY_ID.tuck.unlockSec }), hold('tuck-planche', 8, at(3) + 60_000, { target: 8 })])
    const state = obedient([measured])
    expect(readSignals(state, NOW).daysSinceMaxTest).toBe(3)
    const plan = buildPlan(state, NOW)
    expect(plan.queueRetest).toBe(false)
    // And the measurement re-anchors the working target above the old one.
    expect(adaptiveTarget(state, 'tuck', NOW)).toBeGreaterThan(6)
  })

  it('backs off for a week when it was offered and skipped', () => {
    // Re-queued at every session, a skipped re-test kept next-shape attempts
    // (never beside a max effort) out of all of them.
    const skipped = (daysAgo: number) =>
      trainingDay(daysAgo, [hold('tuck-planche', 6, at(daysAgo), { target: 6 })], { retestOffered: true, baseTargetSec: 6 })
    expect(buildPlan(obedient([skipped(3)]), NOW).queueRetest).toBe(false)
    expect(buildPlan(obedient([skipped(8)]), NOW).queueRetest).toBe(true)
    // Done, it is a measurement like any other.
    const done = trainingDay(3, [hold('tuck-planche', 14, at(3), { target: STEP_BY_ID.tuck.unlockSec })], { retestOffered: true })
    expect(readSignals(obedient([done]), NOW).daysSinceSkippedRetest).toBeNull()
  })

  it('measures a newly opened step soon, not three weeks after the test that opened it', () => {
    // The max test that unlocked advanced tuck measured the tuck.
    const unlockTest = trainingDay(4, [hold('tuck-planche', 21, at(4), { target: STEP_BY_ID.tuck.unlockSec })], {
      workoutKind: 'test',
      workoutName: 'Max test',
    })
    const promoted = { ...obedient([unlockTest]), stepId: 'advtuck' as const, unlocked: [...STEPS.filter((s) => s.order <= STEP_BY_ID.advtuck.order).map((s) => s.id)] }
    expect(readSignals(obedient([unlockTest]), NOW).daysSinceMaxTest).toBe(4)
    expect(readSignals(promoted, NOW).daysSinceMaxTest).toBeNull()
    expect(buildPlan(promoted, NOW).queueRetest).toBe(true)
  })

  it('never on a day a max effort is not allowed', () => {
    const plan = buildPlan(obedient(), NOW, { joints: 'good', energy: 'tired', at: NOW })
    expect(plan.challengeAllowed).toBe(false)
    expect(plan.queueRetest).toBe(false)
  })
})

describe('a max effort at the bar is not a missed working set', () => {
  // Found while checking the in-session re-test: the hit rate read every
  // main set against its target, and a max test's sets target the bar — so
  // after any max test the coach said "Most sets fell short last time —
  // easing the target back" and cut the target it had just re-measured.
  const bar = STEP_BY_ID.tuck.unlockSec
  const working = (daysAgo: number) =>
    trainingDay(daysAgo, [6, 6, 6, 6].map((v, i) => hold('tuck-planche', v, at(daysAgo) + i * 60_000, { target: 6 })))

  it('reads the hit rate past a max test, from the working sets before it', () => {
    const test = trainingDay(2, [hold('tuck-planche', 12, at(2), { target: bar }), hold('tuck-planche', 13, at(2) + 180_000, { target: bar })], {
      workoutKind: 'test',
      workoutName: 'Max test',
    })
    const state = athlete('tuck', { sessions: [working(6), working(4), test] })
    expect(readSignals(state, NOW).mainHitRate).toBe(1)
    expect(buildPlan(state, NOW).decisions.some((d) => /fell short/.test(d.text))).toBe(false)
  })

  it('counts only the working sets of a session that opened with an attempt', () => {
    const day = trainingDay(2, [
      hold('tuck-planche', 11, at(2), { target: bar }),
      ...[6, 6, 6].map((v, i) => hold('tuck-planche', v, at(2) + (i + 1) * 60_000, { target: 6 })),
    ])
    const state = athlete('tuck', { sessions: [working(6), day] })
    const sig = readSignals(state, NOW)
    expect(sig.mainHitRate).toBe(1)
    expect(sig.mainSetCount).toBe(3)
  })
})

describe('what the coach says about the target is the target', () => {
  // "You hit nearly every set last time — nudging the target up 7%" sat beside
  // the same 5s, session after session: the coach spoke from its factor, and
  // at five seconds 7% is a third of a second that rounding took.
  // The session reads the real clock, so this history is relative to it.
  const now = Date.now()
  const ago = (daysAgo: number) => now - daysAgo * DAY
  const hitEvery = (sec: number, lastSet = sec) =>
    athlete('tuck', {
      sessions: [6, 4, 2].map((daysAgo) => ({
        ...trainingDay(
          daysAgo,
          [sec, sec, sec, lastSet].map((v, i) => hold('tuck-planche', v, ago(daysAgo) + i * 60_000, { target: sec })),
          { baseTargetSec: sec },
        ),
        startedAt: ago(daysAgo),
        endedAt: ago(daysAgo) + 30 * 60_000,
      })),
    })

  it.each([
    [5, 5],
    [10, 10],
    [5, 9], // a last set taken past the call: the record moves
    [10, 16],
  ])('quotes the working target the session prescribes (%ss sets, last %ss)', (sec, lastSet) => {
    const state = hitEvery(sec, lastSet)
    const plan = buildPlan(state, now)
    const line = plan.decisions.find((d) => /hit nearly every set/.test(d.text))?.text
    expect(line).toBeDefined()
    const today = todaysSession(state, plan).blocks.find((b) => b.section === 'main' && b.role === 'skill')
    const sec_ = today?.target.kind === 'hold' ? today.target.sec : NaN
    // The number it ends on is today's target, and no percentage is promised.
    const quoted = [...line!.matchAll(/(\d+)s/g)].map((m) => Number(m[1]))
    expect(quoted[quoted.length - 1]).toBe(sec_)
    expect(line).not.toMatch(/%/)
    if (sec_ === sec) expect(line).not.toMatch(/→/)
  })
})

describe('found by an independent review of the 2026-11 changes', () => {
  // Each of these reached an athlete as a number or a sentence; the review
  // confirmed them with throwaway tests, and these keep them fixed.

  it('does not read last step’s next-shape attempts as this step’s missed working sets', () => {
    // Promoted to advanced tuck; the newest session with advanced tuck holds
    // is the tuck session that attempted it (3s, 2s, 2s against its 5s bar).
    const bridging = trainingDay(3, [
      hold('adv-tuck-planche', 3, at(3), { target: 5 }),
      hold('adv-tuck-planche', 2, at(3) + 60_000, { target: 5 }),
      hold('adv-tuck-planche', 2, at(3) + 120_000, { target: 5 }),
      hold('tuck-planche', 12, at(3) + 300_000, { target: 12 }),
    ])
    const promoted = athlete('advtuck', { sessions: [bridging] })
    const sig = readSignals(promoted, NOW)
    expect(sig.mainHitRate).toBeNull()
    expect(sig.lastWorkingTarget).toBeNull()
    expect(buildPlan(promoted, NOW).decisions.some((d) => /fell short/.test(d.text))).toBe(false)
  })

  it('quotes the coach’s own last target, not a template’s fixed one', () => {
    const coach = trainingDay(5, [15, 15, 15].map((v, i) => hold('tuck-planche', v, at(5) + i * 60_000, { target: 15 })), {
      baseTargetSec: 15,
    })
    const template = trainingDay(2, [6, 6, 6, 6].map((v, i) => hold('tuck-planche', v, at(2) + i * 60_000, { target: 6 })), {
      workoutKind: 'template',
      workoutName: 'Setup Practice',
    })
    expect(readSignals(athlete('tuck', { sessions: [coach, template] }), NOW).lastWorkingTarget).toBe(15)
  })

  it('queues the in-session max hold only on its cadence, whatever a plateau suggests', () => {
    // A plan whose re-test clock says three days: due or not is the clock's
    // call, not the plateau's.
    // Verified holds swinging 5–13s around a level line: a measurement-noise
    // plateau, which suggests a max test. The last max hold (9s, as level as
    // the rest) was three days ago.
    const pattern = [9, 13, 5]
    const noisy = [30, 27, 24, 21, 18, 15, 12, 9, 6].map((daysAgo, i) =>
      trainingDay(daysAgo, [hold('tuck-planche', pattern[i % 3], at(daysAgo), { target: 8, endReason: 'effort', form: verified(pattern[i % 3]) })], {
        baseTargetSec: 8,
      }),
    )
    const measured = trainingDay(3, [hold('tuck-planche', 9, at(3), { target: STEP_BY_ID.tuck.unlockSec, form: verified(9) })])
    const state = athlete('tuck', { sessions: [...noisy, measured] })
    const plan = buildPlan(state, NOW)
    expect(readSignals(state, NOW).daysSinceMaxTest).toBe(3)
    expect(plan.plateau?.suggestMaxTest).toBe(true)
    expect(plan.suggestMaxTest).toBe(true)
    expect(plan.queueRetest).toBe(false)
  })
})

describe('a hold stopped at its call is a floor, not a measurement', () => {
  const key = 'tuck-planche'
  const set = (value: number, target: number, overrides: Partial<SetLog> = {}): SetLog => ({
    exerciseId: key,
    kind: 'hold',
    value,
    target,
    section: 'main',
    at: at(3),
    ...overrides,
  })
  const one = (sets: SetLog[]) => trainingDay(3, sets)

  it('reads the best set, so a later set falling short does not make it a measurement', () => {
    const stopped = [set(7.4, 8, { calledAtTarget: true }), set(7.2, 8, { calledAtTarget: true }), set(6, 8)]
    expect(sessionLearningPoint(one(stopped), 'tuck')).toEqual({ value: 8, floorAt: 8 })
    // A set held past its target is the measurement, whatever the others did.
    expect(sessionLearningPoint(one([...stopped, set(11, 8)]), 'tuck')).toEqual({ value: 11, floorAt: null })
  })

  it('takes the athlete’s word for why a hold ended', () => {
    expect(stoppedAtTarget(set(8, 8), 'tuck')).toBe(true)
    expect(stoppedAtTarget(set(8, 8, { endReason: 'effort' }), 'tuck')).toBe(false)
    expect(stoppedAtTarget(set(8, 8, { endReason: 'balance' }), 'tuck')).toBe(false)
    expect(stoppedAtTarget(set(5, 8, { endReason: 'target' }), 'tuck')).toBe(true)
    // A maximal effort at the bar is never a floor.
    expect(stoppedAtTarget(set(9, STEP_BY_ID.tuck.unlockSec, { calledAtTarget: true }), 'tuck')).toBe(false)
    // Done as prescribed is a different question: the base it completed still holds the next one up.
    expect(sessionTargetCap(one([set(8, 8, { endReason: 'effort' })]), 'tuck', null)).toBe(8)
  })

  it('follows a higher reading at once and waits for a second lower one', () => {
    const points = (values: (number | string)[]) =>
      values.map((v, i) => (typeof v === 'string' ? { at: i, value: Number(v.slice(1)), cappedAt: 3 } : { at: i, value: v }))
    expect(measuredLevel(points([5, 5, 8.4]))).toBe(8.4)
    expect(measuredLevel(points([10, 10, 7]))).toBe(10)
    expect(measuredLevel(points([10, 7, 7]))).toBe(7)
    expect(measuredLevel(points([5, 'F9', 'F9']))).toBe(5)
    expect(measuredLevel(points(['F3']))).toBeNull()
  })

  it('names the measurement, not the hit rate, when it lifts the target', () => {
    const coachDay = (daysAgo: number, sets: SetLog[]) => trainingDay(daysAgo, sets, { baseTargetSec: 5 })
    const stoppedAt5 = (daysAgo: number) =>
      [0, 1, 2].map((i) => set(4.6, 5, { at: at(daysAgo) + i * 60_000, calledAtTarget: true }))
    const sessions = [
      ...[16, 14, 12, 10, 8, 6].map((d) => coachDay(d, stoppedAt5(d))),
      coachDay(2, [...stoppedAt5(2), set(18.6, 5, { at: at(2) + 600_000 })]),
    ]
    const plan = buildPlan(athlete('tuck', { sessions }), NOW)
    const text = plan.decisions.map((d) => d.text).join(' ')
    expect(text).toMatch(/Your 18\.6s hold measured you well past your 5s working target, so the target moves 5s → \d+s\./)
    expect(text).not.toMatch(/You hit nearly every set last time — the working target moves/)
  })

  it('does not call a bigger target "clean hold grew"', () => {
    const filmed = (value: number, target: number, daysAgo: number) =>
      trainingDay(daysAgo, [set(value, target, { at: at(daysAgo), calledAtTarget: value <= target, form: { ...verified(value), auto: { issues: [], confidence: 0.9, cleanSeconds: value, cleanRatio: 1 } } })])
    const grew = (prevSession: Session, session: Session) =>
      debriefSession(athlete('tuck', { sessions: [prevSession] }), athlete('tuck', { sessions: [prevSession, session] }), session).some((d) =>
        /clean hold grew/.test(d.text),
      )
    // A technique day stopped at 2s, then an intensity day stopped at 4s.
    expect(grew(filmed(2, 2, 5), filmed(4, 4, 3))).toBe(false)
    // Held past the target both times: that is the hold growing.
    expect(grew(filmed(5, 3, 5), filmed(7, 4, 3))).toBe(true)
  })
})

