import { describe, expect, it } from 'vitest'
import type { AppState, CheckIn, FormCheck, FormIssue, Session, SetLog } from '../types'
import { initialState, normalizeState, rebuildDerivedState, reconcileAchievements, skipToStep } from './store'
import { applySession } from './engine'
import { formEvidenceCoversArms, passesProgressionFormCheck, progressionCredit, qualifyingProgress } from './progression'
import {
  POSE_PROFILES,
  bandedScore,
  bridgeKeypointGaps,
  chooseSampleCount,
  computeFormScore,
  gradeCoverage,
  hasVerifiableHoldDuration,
  materialIssuesForReading,
  plancheArmAngle,
  pickFixFirst,
  poseKeypointsAtTime,
  reliableJointAngle,
  shoulderHipLineMismatch,
  shoulderHipLevelOffset,
  suppressBilateralCollisions,
  suppressIsolatedMetricSpikes,
  stabilizeKeypointSpikes,
  sustainedCleanSeconds,
  sustainedMinimum,
  sustainedMaterialIssues,
  sustainedObservableCleanSeconds,
  sustainedTypical,
  unrotateKeypoints,
} from './poseForm'
import { buildPlan, debriefSession, rewardFor } from './coach'
import { adaptiveTarget, estimateMinutes, painSafeRecoveryWorkout, todaysSession } from '../data/workouts'
import { validateImport } from './exportImport'
import { buildSampleState } from '../data/sample'
import { ACHIEVEMENTS, ACHIEVEMENT_VERSION } from '../data/achievements'
import { selectRecorderMime } from './recorder'
import { observedRestSec, readSignals, robustSlopePerWeek, trustedCameraEvidence } from './signals'
import { leadInSecondsFor, stopLatencySecondsFor } from './sessionTiming'

const DAY = 86_400_000

function state(stepId: AppState['stepId'] = 'foundations'): AppState {
  return {
    ...initialState(),
    onboarded: true,
    stepId,
    baseStepId: stepId,
    unlocked: [stepId],
  }
}

function form(
  rating: FormCheck['rating'] = 'clean',
  confirmed = true,
  cameraIssues: FormIssue[] = [],
  confidence = 0.9,
  cleanSeconds?: number,
  cleanRatio?: number,
): FormCheck {
  return {
    rating,
    confirmed,
    flightConfirmed: true,
    auto: { issues: cameraIssues, confidence, cleanSeconds, cleanRatio },
  }
}

function log(
  exerciseId: string,
  value: number,
  overrides: Partial<SetLog> = {},
): SetLog {
  return {
    exerciseId,
    kind: 'hold',
    value,
    target: value,
    section: 'main',
    at: Date.now(),
    ...overrides,
  }
}

function session(
  stepId: AppState['stepId'],
  sets: SetLog[],
  overrides: Partial<Session> = {},
): Session {
  const at = overrides.startedAt ?? Date.now()
  return {
    id: crypto.randomUUID(),
    startedAt: at,
    endedAt: at + 1_000,
    workoutName: 'Test session',
    workoutKind: 'test',
    stepId,
    sets,
    ...overrides,
  }
}

describe('progression hold timing', () => {
  const mainHolds = [
    'ppp-hold',
    'frog-stand',
    'tuck-planche',
    'adv-tuck-planche',
    'one-leg-planche',
    'straddle-planche',
    'full-planche',
  ]

  it.each(mainHolds)('uses the longer setup and stop allowance for %s', (exerciseId) => {
    expect(leadInSecondsFor(exerciseId)).toBe(8)
    expect(stopLatencySecondsFor(exerciseId, 2.3)).toBe(5)
  })

  it('keeps Planche Lean and non-progression holds on calibrated timing', () => {
    expect(leadInSecondsFor('planche-lean')).toBe(5)
    expect(stopLatencySecondsFor('planche-lean', 2.3)).toBe(2.3)
    expect(leadInSecondsFor('one-leg-lean')).toBe(5)
    expect(stopLatencySecondsFor('one-leg-lean', 2.3)).toBe(2.3)
  })

  it('reconstructs coach-observed rest with the matching lead-in', () => {
    const at = Date.now()
    const tuck = session('tuck', [
      log('tuck-planche', 10, { at }),
      log('tuck-planche', 10, { at: at + 123_000 }),
    ])
    const lean = session('lean', [
      log('planche-lean', 10, { at }),
      log('planche-lean', 10, { at: at + 117_300 }),
    ])

    expect(observedRestSec(tuck, 'tuck-planche')).toBe(100)
    expect(observedRestSec(lean, 'planche-lean')).toBe(100)
  })

  it('uses the actual raw hold and skipped countdown when learning rest', () => {
    const at = Date.now()
    const skippedLead = session('tuck', [
      log('tuck-planche', 7, { at }),
      log('tuck-planche', 7, { at: at + 112_000, raw: 12, leadInSec: 0 }),
    ])
    expect(observedRestSec(skippedLead, 'tuck-planche')).toBe(100)
  })

  it('includes setup, phone reach and no final rest in session estimates', () => {
    expect(
      estimateMinutes([
        {
          exerciseId: 'tuck-planche',
          sets: 3,
          target: { kind: 'hold', sec: 5 },
          restSec: 150,
          section: 'main',
        },
      ]),
    ).toBe(6)
  })
})

describe('progression safety', () => {
  it('records a poor-form PR without unlocking a harder step', () => {
    const result = applySession(
      state(),
      session('foundations', [log('ppp-hold', 35, { form: form('broke') })]),
    )
    expect(result.next.prs['ppp-hold']?.value).toBe(35)
    expect(result.next.stepId).toBe('foundations')
  })

  it('unlocks from an athlete-confirmed clean hold with a passing camera check', () => {
    const result = applySession(
      state(),
      session('foundations', [log('ppp-hold', 30, { form: form() })]),
    )
    expect(result.next.stepId).toBe('lean')
  })

  it('keeps an athlete-confirmed clean hold as a PR when no form check exists', () => {
    const result = applySession(
      state(),
      session('foundations', [
        log('ppp-hold', 30, { form: { rating: 'clean', confirmed: true } }),
      ]),
    )
    expect(result.next.prs['ppp-hold']?.value).toBe(30)
    expect(result.next.stepId).toBe('foundations')
  })

  it('requires the athlete to confirm true flight because 2D pose cannot see support', () => {
    const cameraAndAthlete = form()
    delete cameraAndAthlete.flightConfirmed
    const unsupportedUnknown = applySession(
      state('tuck'),
      session('tuck', [log('tuck-planche', 20, { form: cameraAndAthlete })]),
    )
    expect(unsupportedUnknown.next.prs['tuck-planche']?.value).toBe(20)
    expect(unsupportedUnknown.next.stepId).toBe('tuck')

    const confirmedFlight = applySession(
      state('tuck'),
      session('tuck', [log('tuck-planche', 20, { form: form() })]),
    )
    expect(confirmedFlight.next.stepId).toBe('advtuck')
  })

  it('keeps separate floor and parallettes records without losing the overall PR', () => {
    const first = applySession(
      state('tuck'),
      session('tuck', [
        log('tuck-planche', 4, { surface: 'floor' }),
        log('tuck-planche', 3, { surface: 'parallettes' }),
      ]),
    )
    expect(first.next.prs['tuck-planche']).toMatchObject({
      value: 4,
      bySurface: {
        floor: { value: 4 },
        parallettes: { value: 3 },
      },
    })

    const second = applySession(
      first.next,
      session('tuck', [log('tuck-planche', 5, { surface: 'parallettes' })]),
    )
    expect(second.next.prs['tuck-planche']).toMatchObject({
      value: 5,
      bySurface: {
        floor: { value: 4 },
        parallettes: { value: 5 },
      },
    })
    expect(second.events.prs).toContainEqual(
      expect.objectContaining({ exerciseId: 'tuck-planche', surface: 'parallettes', previous: 3, value: 5 }),
    )
  })

  it('uses an unverified timer PR only to lower an unsafe first target', () => {
    const novice = {
      ...state('tuck'),
      prs: { 'tuck-planche': { value: 3, at: Date.now() } },
    }
    expect(adaptiveTarget(novice, 'tuck')).toBe(2)
    expect(
      adaptiveTarget(
        { ...novice, prs: { 'tuck-planche': { value: 20, at: Date.now() } } },
        'tuck',
      ),
    ).toBe(5)
  })

  it('accepts one isolated camera flag but rejects multiple flags', () => {
    const minor = session('foundations', [
      log('ppp-hold', 30, { form: form('clean', true, ['shrug']) }),
    ])
    expect(applySession(state(), minor).next.stepId).toBe('lean')

    const multiple = session('foundations', [
      log('ppp-hold', 35, { form: form('clean', true, ['arms', 'sag']) }),
    ])
    expect(applySession(state(), multiple).next.stepId).toBe('foundations')
  })

  it('credits only the camera-verified clean portion of a confirmed hold', () => {
    const set = log('ppp-hold', 34, { form: form('clean', true, [], 0.9, 24.2) })
    expect(progressionCredit(set, 'ppp-hold')).toBe(24.2)
    expect(applySession(state(), session('foundations', [set])).next.stepId).toBe('foundations')

    const controlled = log('ppp-hold', 31, { form: form('clean', true, [], 0.9, 30.4) })
    expect(applySession(state(), session('foundations', [controlled])).next.stepId).toBe('lean')
  })

  it('rejects an unconfirmed or low-confidence form check', () => {
    const suggested = session('foundations', [
      log('ppp-hold', 30, { form: form('clean', false) }),
    ])
    expect(applySession(state(), suggested).next.stepId).toBe('foundations')

    const uncertain = session('foundations', [
      log('ppp-hold', 30, { form: form('clean', true, [], 0.34) }),
    ])
    expect(applySession(state(), uncertain).next.stepId).toBe('foundations')
  })

  it('requires a filmed replay review for Frog Stand', () => {
    const unreviewed = session('frog', [
      log('frog-stand', 30, {
        clipKey: 'frog:1',
        form: { rating: 'clean', confirmed: true, clipKey: 'frog:1' },
      }),
    ])
    expect(applySession(state('frog'), unreviewed).next.stepId).toBe('frog')

    const reviewed = session('frog', [
      log('frog-stand', 30, {
        clipKey: 'frog:2',
        form: {
          rating: 'clean',
          confirmed: true,
          clipKey: 'frog:2',
          visualReviewPassed: true,
        },
      }),
    ])
    expect(applySession(state('frog'), reviewed).next.stepId).toBe('tuck')
  })

  it('does not unlock from Quick Log', () => {
    const s = session('foundations', [log('ppp-hold', 40, { form: form() })], {
      workoutName: 'Quick Log',
      workoutKind: 'auto',
    })
    expect(applySession(state(), s).next.stepId).toBe('foundations')
  })

  it('does not jump back up from unrelated work after selecting a lower step', () => {
    const owned = {
      ...state('lean'),
      unlocked: ['foundations', 'lean', 'frog'] as AppState['unlocked'],
      sessions: [
        session('lean', [log('planche-lean', 30, { form: form() })]),
      ],
    }
    const wristWork = session('lean', [log('wrist-stretch', 30, { section: 'cooldown' })], {
      workoutName: 'Wrist Armor',
      workoutKind: 'template',
    })
    expect(applySession(owned, wristWork).next.stepId).toBe('lean')
  })

  it('uses the weaker side for a unilateral unlock', () => {
    const base = state('oneleg')
    const oneSide = session('oneleg', [
      log('one-leg-planche', 14, { side: 'left', form: form() }),
      log('one-leg-planche', 9, { side: 'right', form: form() }),
    ])
    expect(qualifyingProgress(base, 'oneleg', [oneSide])).toMatchObject({
      value: 9,
      left: 14,
      right: 9,
    })
    expect(applySession(base, oneSide).next.stepId).toBe('oneleg')

    const both = session('oneleg', [log('one-leg-planche', 12, { side: 'right', form: form() })])
    const after = applySession(applySession(base, oneSide).next, both).next
    expect(after.stepId).toBe('straddle')
  })

  it('keeps sample history compatible with the same evidence contract', () => {
    const sample = buildSampleState()
    expect(sample.stepId).toBe('tuck')
    expect(sample.sessions.length).toBeGreaterThan(20)
  })
})

describe('manual progression placement', () => {
  it('makes every earlier step available without inventing evidence', () => {
    const original = state()
    const skipped = skipToStep(original, 'tuck')

    expect(skipped.stepId).toBe('tuck')
    expect(skipped.baseStepId).toBe('tuck')
    expect(skipped.unlocked).toEqual(['foundations', 'lean', 'frog', 'tuck'])
    expect(skipped.prs).toEqual(original.prs)
    expect(skipped.achievements).toEqual(original.achievements)
    expect(qualifyingProgress(skipped, 'foundations').value).toBe(0)
  })

  it('survives a history rebuild and preserves an intentionally selected lower step', () => {
    const skipped = skipToStep(state(), 'straddle')
    const lower = { ...skipped, stepId: 'tuck' as const }
    const rebuilt = rebuildDerivedState(lower)

    expect(rebuilt.baseStepId).toBe('straddle')
    expect(rebuilt.stepId).toBe('tuck')
    expect(rebuilt.unlocked).toEqual(['foundations', 'lean', 'frog', 'tuck', 'advtuck', 'oneleg', 'straddle'])
  })

  it('does not award verified-unlock badges after an unrelated post-skip session', () => {
    const skipped = skipToStep(state(), 'full')
    const wristWork = session('full', [log('wrist-stretch', 30, { section: 'cooldown' })], {
      workoutName: 'Wrist Armor',
      workoutKind: 'template',
    })
    const result = applySession(skipped, wristWork)

    expect(result.next.achievements['unlock-advtuck']).toBeUndefined()
    expect(result.next.achievements['unlock-straddle']).toBeUndefined()
    expect(result.next.achievements['unlock-full']).toBeUndefined()
  })

  it('still awards the badge once the corresponding unlock is actually verified', () => {
    const skipped = skipToStep(state(), 'tuck')
    const verified = session('tuck', [log('tuck-planche', 20, { form: form() })])
    const result = applySession(skipped, verified)

    expect(result.next.achievements['unlock-advtuck']).toBe(verified.endedAt)
    expect(result.events.achievements).toContain('unlock-advtuck')
  })
})

describe('expanded achievements', () => {
  it('keeps every achievement id unique', () => {
    expect(new Set(ACHIEVEMENTS.map((achievement) => achievement.id)).size).toBe(ACHIEVEMENTS.length)
  })

  it('awards the new early consistency milestone on the third session', () => {
    const first = session('foundations', [log('wrist-rocks', 8)])
    const second = session('foundations', [log('scap-pushup', 8)])
    const third = session('foundations', [log('hollow-hold', 10)])
    const athlete = { ...state(), sessions: [first, second] }
    const result = applySession(athlete, third)

    expect(result.events.achievements).toContain('sessions-3')
    expect(result.next.achievements['sessions-3']).toBe(third.endedAt)
  })

  it('requires a confirmed camera result for the precision badge', () => {
    const highScore = (confirmed: boolean) =>
      session('lean', [
        log('planche-lean', 20, {
          form: {
            rating: 'clean',
            confirmed,
            auto: { issues: [], confidence: 0.92, score: 94 },
          },
        }),
      ])

    expect(applySession(state('lean'), highScore(false)).events.achievements).not.toContain('precision-pass')
    expect(applySession(state('lean'), highScore(true)).events.achievements).toContain('precision-pass')
  })

  it('counts one-leg progress only after both sides have verified time', () => {
    const left = session('oneleg', [log('one-leg-planche', 6, { side: 'left', form: form() })])
    const right = session('oneleg', [log('one-leg-planche', 5, { side: 'right', form: form() })])
    const result = applySession({ ...state('oneleg'), sessions: [left] }, right)

    expect(result.events.achievements).toContain('oneleg-5')
  })

  it('retroactively unlocks new badges from saved history after an update', () => {
    const first = session('foundations', [log('wrist-rocks', 8)], { startedAt: 1_000, endedAt: 2_000 })
    const second = session('foundations', [log('scap-pushup', 8)], { startedAt: 3_000, endedAt: 4_000 })
    const third = session('foundations', [log('hollow-hold', 10)], { startedAt: 5_000, endedAt: 6_000 })
    const reconciled = reconcileAchievements({
      ...state(),
      achievementVersion: ACHIEVEMENT_VERSION - 1,
      sessions: [first, second, third],
      achievements: { 'first-session': 2_000 },
    })

    expect(reconciled.achievementVersion).toBe(ACHIEVEMENT_VERSION)
    expect(reconciled.achievements['first-session']).toBe(2_000)
    expect(reconciled.achievements['sessions-3']).toBe(6_000)
  })

  it('does not replay history again after the current catalog was reconciled', () => {
    const current = state()
    expect(reconcileAchievements(current)).toBe(current)
  })
})

describe('partial camera coverage', () => {
  const lean = POSE_PROFILES['planche-lean']
  const full = { elbows: 10, knees: 10, hipAngles: 10, hipOffsets: 10, leans: 10 }

  it('grades every criterion when the whole body was in shot', () => {
    const { judged, unseen } = gradeCoverage(lean, full, 10)
    expect(unseen).toEqual([])
    expect(judged.elbow && judged.knee && judged.line && judged.lean).toBe(true)
  })

  it('drops only the criterion it could not see, keeping the rest', () => {
    const { judged, unseen } = gradeCoverage(lean, { ...full, knees: 2 }, 10)
    expect(unseen).toEqual(['knees'])
    expect(judged.knee).toBe(false)
    // The whole point: an unseen knee must not cost the other verdicts.
    expect(judged.elbow).toBe(true)
    expect(judged.line).toBe(true)
    expect(judged.lean).toBe(true)
  })

  it('reports a total blackout so the caller can refuse', () => {
    const { judged, unseen } = gradeCoverage(lean, { elbows: 0, knees: 0, hipAngles: 0, hipOffsets: 0, leans: 0 }, 10)
    expect(Object.values(judged).some(Boolean)).toBe(false)
    expect(unseen).toContain('elbows')
  })

  it('never lists a criterion the position does not even check', () => {
    // Tuck planche deliberately has bent knees, so knees are not a criterion.
    const { unseen } = gradeCoverage(POSE_PROFILES['tuck-planche'], { ...full, knees: 0 }, 10)
    expect(unseen).not.toContain('knees')
  })

  const withUnseen = (unseen: string[]): FormCheck => ({
    rating: 'clean',
    confirmed: true,
    auto: { issues: [], confidence: 0.9, unseen },
  })

  it('still unlocks when a secondary criterion was out of frame', () => {
    const result = applySession(
      state(),
      session('foundations', [log('ppp-hold', 30, { form: withUnseen(['knees']) })]),
    )
    expect(result.next.stepId).toBe('lean')
  })

  it('refuses to unlock when the elbows themselves were never seen', () => {
    const result = applySession(
      state(),
      session('foundations', [log('ppp-hold', 30, { form: withUnseen(['elbows']) })]),
    )
    expect(result.next.prs['ppp-hold']?.value).toBe(30)
    expect(result.next.stepId).toBe('foundations')
  })

  it('never treats a detected bent-arm planche as progression-quality evidence', () => {
    expect(
      passesProgressionFormCheck(
        {
          rating: 'clean',
          confirmed: true,
          flightConfirmed: true,
          auto: { issues: ['arms'], confidence: 0.9 },
        },
        'tuck-planche',
      ),
    ).toBe(false)
  })

  it('treats pre-partial-grading records as fully covered', () => {
    expect(formEvidenceCoversArms({ issues: [], confidence: 0.9 })).toBe(true)
    expect(formEvidenceCoversArms(undefined)).toBe(true)
  })
})

describe('session debrief', () => {
  const base = state()
  const run = (sets: SetLog[], overrides: Partial<Session> = {}) => {
    const s = session('foundations', sets, overrides)
    return debriefSession(base, applySession(base, s).next, s)
  }

  it('always says something about a finished session', () => {
    // An ordinary session with nothing rated used to return no bullets at all,
    // so the finish screen simply showed an empty space.
    expect(run([log('ppp-hold', 18)], { workoutKind: 'auto' }).length).toBeGreaterThan(0)
    expect(run([], { workoutKind: 'auto' }).length).toBeGreaterThan(0)
  })

  it('explains why an unrated hold cannot count toward the unlock', () => {
    const [first] = run([log('ppp-hold', 18)], { workoutKind: 'auto' })
    expect(first.text).toMatch(/nothing was rated/i)
    expect(first.text).toMatch(/18/)
  })

  it('still names the gap after a missed max test', () => {
    const [first] = run([log('ppp-hold', 18)], { workoutKind: 'test' })
    expect(first.text).toMatch(/not an unlock/i)
  })

  it('describes accessory-only work as supporting load', () => {
    const [first] = run([log('hollow-hold', 40, { section: 'core' })], { workoutKind: 'auto' })
    expect(first.text).toMatch(/supporting work/i)
  })

  it('never returns more than three bullets', () => {
    const many = run(
      [
        log('ppp-hold', 30, { form: form('broke'), side: 'left' }),
        log('ppp-hold', 12, { form: form('broke'), side: 'right' }),
        log('ppp-hold', 30, { form: form('broke') }),
      ],
      { workoutKind: 'test' },
    )
    expect(many.length).toBeLessThanOrEqual(3)
  })
})

describe('keypoint dropout repair', () => {
  const kp = (name: string, x: number, y: number, score = 0.9) => ({ name, x, y, score })
  const frames = (...scores: (number | null)[]) =>
    scores.map((s, i) => ({
      t: i,
      kps: s === null ? [] : [kp('left_shoulder', 100 + i * 10, 200 + i * 10, s)],
    }))

  it('interpolates a single missing frame from its neighbours', () => {
    const f = frames(0.9, null, 0.9)
    expect(bridgeKeypointGaps(f)).toBe(1)
    const filled = f[1].kps.find((k) => k.name === 'left_shoulder')!
    expect(filled.x).toBe(110)
    expect(filled.y).toBe(210)
    // Reduced score so a bridged point cannot inflate tracking confidence.
    expect(filled.score).toBeLessThan(0.9)
  })

  it('refuses to bridge two consecutive misses', () => {
    const f = frames(0.9, null, null, 0.9)
    expect(bridgeKeypointGaps(f)).toBe(0)
    expect(f[1].kps).toHaveLength(0)
    expect(f[2].kps).toHaveLength(0)
  })

  it('never invents a keypoint at the start or end of a clip', () => {
    const f = frames(null, 0.9, 0.9, null)
    expect(bridgeKeypointGaps(f)).toBe(0)
    expect(f[0].kps).toHaveLength(0)
    expect(f[3].kps).toHaveLength(0)
  })

  it('does not bridge from low-confidence neighbours', () => {
    // 0.31 * 0.9 falls under the keypoint floor, so nothing is fabricated.
    const f = frames(0.31, null, 0.31)
    expect(bridgeKeypointGaps(f)).toBe(0)
  })
})

describe('skeleton stabilization', () => {
  const pose = (t: number, offset: number) => ({
    t,
    kps: [
      { name: 'left_shoulder', x: offset, y: 0, score: 0.9 },
      { name: 'left_elbow', x: offset + 35, y: 25, score: 0.9 },
      { name: 'left_wrist', x: offset + 70, y: 50, score: 0.9 },
      { name: 'left_hip', x: offset, y: 100, score: 0.9 },
    ],
  })

  it('repairs a one-frame skeleton teleport before form is measured', () => {
    const frames = [pose(0, 0), pose(0.3, 300), pose(0.6, 0)]
    expect(stabilizeKeypointSpikes(frames)).toEqual({ jointsRepaired: 4, framesTouched: 1 })
    expect(frames[1].kps.map((point) => point.x)).toEqual([0, 35, 70, 0])
    expect(frames[1].kps.every((point) => point.score! < 0.9)).toBe(true)
  })

  it('does not flatten real movement that continues into the next sample', () => {
    const frames = [pose(0, 0), pose(0.3, 0), pose(0.6, 80), pose(0.9, 80)]
    expect(stabilizeKeypointSpikes(frames)).toEqual({ jointsRepaired: 0, framesTouched: 0 })
    expect(frames[2].kps[0].x).toBe(80)
  })

  it('interpolates nearby replay samples but leaves detector gaps blank', () => {
    const short = { width: 200, height: 100, frames: [pose(0, 0), pose(1, 100)] }
    expect(poseKeypointsAtTime(short, 0.5, 1.1)[0].x).toBe(50)

    const gap = { width: 200, height: 100, frames: [pose(0, 0), pose(2, 100)] }
    expect(poseKeypointsAtTime(gap, 1)).toEqual([])
  })
})

describe('rotation-robust tracking', () => {
  // A 640x480 frame rotated 90° clockwise becomes 480x640 on the canvas.
  // Un-rotating has to land keypoints back on the exact original pixel, or
  // hip height and forward lean — the two measures defined in screen axes —
  // silently invert.
  const W = 640
  const H = 480

  it('maps a 90° keypoint back to its original position', () => {
    // Source (100, 50) draws to canvas (H - 50, 100) = (430, 100).
    const [back] = unrotateKeypoints([{ x: 430, y: 100 }], 90, W, H)
    expect(back).toEqual({ x: 100, y: 50 })
  })

  it('maps a 270° keypoint back to its original position', () => {
    // Source (100, 50) draws to canvas (50, W - 100) = (50, 540).
    const [back] = unrotateKeypoints([{ x: 50, y: 540 }], 270, W, H)
    expect(back).toEqual({ x: 100, y: 50 })
  })

  it('leaves unrotated frames untouched and preserves keypoint fields', () => {
    const kps = [{ x: 12, y: 34, score: 0.8, name: 'left_hip' }]
    expect(unrotateKeypoints(kps, 0, W, H)).toEqual(kps)
    expect(unrotateKeypoints(kps, 90, W, H)[0].name).toBe('left_hip')
  })

  it('keeps a horizontal body horizontal after the round trip', () => {
    // Shoulder and hip level in the original frame must stay level once a
    // rotated detection is mapped back — this is what hip-offset reads.
    const shoulder = { x: 300, y: 200 }
    const hip = { x: 200, y: 200 }
    const toCanvas = (p: { x: number; y: number }) => ({ x: H - p.y, y: p.x })
    const [s, h] = unrotateKeypoints([toCanvas(shoulder), toCanvas(hip)], 90, W, H)
    expect(s.y).toBe(h.y)
    expect(s.x).toBeGreaterThan(h.x)
  })
})

describe('camera evaluator primitives', () => {
  it('uses a true lockout target at every straight-arm planche level', () => {
    const graded = Object.entries(POSE_PROFILES).filter(([, profile]) => !profile.noChecks)
    expect(graded.map(([id]) => id)).toEqual(
      expect.arrayContaining([
        'planche-lean',
        'tuck-planche',
        'adv-tuck-planche',
        'one-leg-planche',
        'straddle-planche',
        'full-planche',
      ]),
    )
    expect(graded.every(([, profile]) => profile.minElbowDeg === 180)).toBe(true)

    const elbowOnly = { elbow: true, knee: false, hipAngle: false, line: false, lean: false }
    for (const [, profile] of graded) {
      expect(materialIssuesForReading({ t: 0, elbowDeg: 178 }, profile, elbowOnly)).not.toContain('arms')
      expect(materialIssuesForReading({ t: 0, elbowDeg: 176 }, profile, elbowOnly)).toContain('arms')
    }
  })

  it('compares shoulder and hip rotation without depending on line width or camera roll', () => {
    const point = (x: number, y: number) => ({ x, y, score: 0.9 })
    const aligned = shoulderHipLineMismatch(
      point(0, 0),
      point(100, 20),
      point(10, 60),
      point(60, 70),
    )
    const twisted = shoulderHipLineMismatch(
      point(0, 0),
      point(100, 20),
      point(10, 60),
      point(60, 60),
    )

    expect(aligned).toBeCloseTo(0, 8)
    expect(twisted).toBeGreaterThan(0.15)
  })

  it('averages both visible sides to steady the shoulder-to-hip level call', () => {
    const point = (x: number, y: number) => ({ x, y, score: 0.9 })
    const nearOnly = shoulderHipLevelOffset(point(0, 0), point(100, 20))!
    const bilateral = shoulderHipLevelOffset(
      point(0, 0),
      point(100, 20),
      point(0, 20),
      point(100, 0),
    )!

    expect(Math.abs(nearOnly)).toBeGreaterThan(0.15)
    expect(bilateral).toBe(0)
  })

  it('tightens level and hip-opening standards as the lever lengthens', () => {
    const tuck = POSE_PROFILES['tuck-planche']
    const advanced = POSE_PROFILES['adv-tuck-planche']
    const oneLeg = POSE_PROFILES['one-leg-planche']
    const straddle = POSE_PROFILES['straddle-planche']
    const full = POSE_PROFILES['full-planche']

    expect(tuck.levelTolerance).toBeGreaterThan(advanced.levelTolerance!)
    expect(advanced.levelTolerance).toBeGreaterThan(oneLeg.levelTolerance!)
    expect(oneLeg.levelTolerance).toBeGreaterThan(straddle.levelTolerance!)
    expect(straddle.levelTolerance).toBeGreaterThan(full.levelTolerance!)
    expect(advanced.minHipAngleDeg).toBe(82)
    expect(oneLeg.minHipAngleDeg).toBeGreaterThan(advanced.minHipAngleDeg!)
    expect(full.minHipAngleDeg).toBeGreaterThan(straddle.minHipAngleDeg!)
    expect(oneLeg.minKneeDeg).toBe(180)

    const lineOnly = { elbow: false, knee: false, hipAngle: false, line: true, lean: false }
    for (const profile of [tuck, advanced, oneLeg, straddle, full]) {
      const tolerance = profile.levelTolerance!
      expect(materialIssuesForReading({ t: 0, hipOffset: tolerance + 0.05 }, profile, lineOnly)).not.toContain('pike')
      expect(materialIssuesForReading({ t: 0, hipOffset: tolerance + 0.07 }, profile, lineOnly)).toContain('pike')
      expect(materialIssuesForReading({ t: 0, hipOffset: -tolerance - 0.07 }, profile, lineOnly)).toContain('sag')
    }
  })

  it('samples short and long holds densely without growing without bound', () => {
    expect(chooseSampleCount(5)).toBe(18)
    expect(chooseSampleCount(10)).toBe(30)
    expect(chooseSampleCount(20)).toBe(60)
    expect(chooseSampleCount(40)).toBe(72)
    expect(chooseSampleCount(40, 12)).toBe(12)
  })

  it('uses the lower quartile so a few straight frames cannot hide a bent hold', () => {
    expect(sustainedMinimum([150, 150, 150, 150, 150, 150, 175, 175])).toBe(150)
  })

  it('uses the typical angle for the verdict so a minority of bad elbow detections cannot win', () => {
    expect(sustainedTypical([120, 125, 170, 171, 172, 173, 174, 175])).toBe(171.5)
  })

  it('rejects elbow angles built from impossible segment proportions', () => {
    const point = (x: number, y: number) => ({ x, y, score: 0.9 })
    expect(reliableJointAngle(point(0, 0), point(50, 0), point(100, 0), 100)).toBe(180)
    expect(reliableJointAngle(point(0, 0), point(50, 0), point(50, 50), 100)).toBe(90)
    expect(reliableJointAngle(point(0, 0), point(5, 0), point(100, 0), 100)).toBeUndefined()
  })

  it('distinguishes a small elbow bend from lockout hyperextension', () => {
    const point = (x: number, y: number) => ({ x, y, score: 0.9 })
    const shoulder = point(0, 0)
    const wrist = point(0, 100)
    const hip = point(100, 0)
    const bent = plancheArmAngle(shoulder, point(3, 50), wrist, hip, 100)!
    const hyperextended = plancheArmAngle(shoulder, point(-3, 50), wrist, hip, 100)

    expect(bent).toBeGreaterThan(170)
    expect(bent).toBeLessThan(175)
    expect(hyperextended).toBe(180)
  })

  it('names only faults that persist across enough samples and real time', () => {
    expect(
      sustainedMaterialIssues([
        { t: 0, issues: ['arms'] },
        { t: 0.3, issues: [] },
        { t: 0.6, issues: ['knees'] },
        { t: 1, issues: ['arms'] },
        { t: 1.3, issues: ['arms'] },
        { t: 1.6, issues: ['arms'] },
        { t: 1.9, issues: ['arms'] },
      ]),
    ).toEqual(['arms'])
  })

  it('removes a far wrist stacked on the visible hand but keeps genuinely separate hands', () => {
    const point = (name: string, x: number, y: number) => ({ name, x, y, score: 0.9 })
    const base = [
      point('left_shoulder', 0, 0),
      point('left_hip', 0, 100),
      point('left_wrist', 80, 50),
    ]
    const stacked = [{ kps: [...base, point('right_wrist', 83, 52)] }]
    expect(suppressBilateralCollisions(stacked, 'left')).toEqual({
      jointsIgnored: 1,
      framesTouched: 1,
    })
    expect(stacked[0].kps.some((k) => k.name === 'right_wrist')).toBe(false)
    expect(stacked[0].kps.some((k) => k.name === 'left_wrist')).toBe(true)

    const separate = [{ kps: [...base, point('right_wrist', 110, 50)] }]
    expect(suppressBilateralCollisions(separate, 'left').jointsIgnored).toBe(0)
    expect(separate[0].kps.some((k) => k.name === 'right_wrist')).toBe(true)
  })

  it('prefers broadly compatible WebM before falling back to MP4', () => {
    const supported = new Set(['video/webm', 'video/mp4'])
    expect(selectRecorderMime((mime) => supported.has(mime))).toBe('video/webm')
  })

  it('ignores one or two noisy samples but caps clean time at a sustained breakdown', () => {
    expect(
      sustainedCleanSeconds(
        [
          { t: 2, bad: false },
          { t: 4, bad: true },
          { t: 6, bad: false },
          { t: 8, bad: true },
          { t: 10, bad: true },
          { t: 12, bad: true },
        ],
        14,
      ),
    ).toBe(8)
    expect(sustainedCleanSeconds([{ t: 6, bad: true }], 12)).toBe(12)
    expect(
      sustainedCleanSeconds(
        [
          { t: 6, bad: true },
          { t: 8, bad: true },
        ],
        12,
      ),
    ).toBe(12)
  })

  it('keeps the breakdown tolerance stable when samples become denser', () => {
    expect(
      sustainedCleanSeconds(
        [
          { t: 2, bad: true },
          { t: 2.25, bad: true },
          { t: 2.5, bad: true },
        ],
        5,
      ),
    ).toBe(5)
    expect(
      sustainedCleanSeconds(
        [
          { t: 2, bad: true },
          { t: 2.25, bad: true },
          { t: 2.5, bad: true },
          { t: 2.75, bad: true },
        ],
        5,
      ),
    ).toBe(2)
  })

  it('refuses a touch-and-drop and ends clean time after sustained missing evidence', () => {
    expect(hasVerifiableHoldDuration(0)).toBe(false)
    expect(hasVerifiableHoldDuration(0.9)).toBe(false)
    expect(hasVerifiableHoldDuration(1)).toBe(true)

    expect(
      sustainedObservableCleanSeconds(
        [
          { t: 0, bad: false },
          { t: 0.25, bad: false },
          { t: 0.5, bad: null },
          { t: 0.75, bad: null },
          { t: 1, bad: null },
          { t: 1.25, bad: null },
        ],
        2,
      ),
    ).toBe(0.5)
  })

  it('still forgives an isolated unobservable camera sample', () => {
    expect(
      sustainedObservableCleanSeconds(
        [
          { t: 0, bad: false },
          { t: 0.5, bad: null },
          { t: 1, bad: false },
          { t: 1.5, bad: false },
        ],
        2,
      ),
    ).toBe(2)
  })

  it('removes an isolated detector jump without flattening real movement', () => {
    const readings = [
      { t: 0, elbowDeg: 171, hipOffset: 0.02 },
      { t: 1, elbowDeg: 170, hipOffset: 0.04 },
      { t: 2, elbowDeg: 112, hipOffset: 0.06 },
      { t: 3, elbowDeg: 169, hipOffset: 0.08 },
      { t: 4, elbowDeg: 168, hipOffset: 0.1 },
    ]
    const ignored = suppressIsolatedMetricSpikes(readings)
    expect(ignored).toEqual({ metricsIgnored: 1, framesTouched: 1 })
    expect(readings[2].elbowDeg).toBeUndefined()
    expect(readings[2].hipOffset).toBe(0.06)
  })
})

describe('form scoring', () => {
  it('gives no deduction inside the FIG 5° free band and none below zero', () => {
    expect(bandedScore(0)).toBe(100)
    expect(bandedScore(5)).toBe(100)
    expect(bandedScore(20)).toBe(70)
    expect(bandedScore(45)).toBe(30)
    expect(bandedScore(200)).toBe(0)
  })

  const tuck = POSE_PROFILES['tuck-planche']
  const allJudged = { elbow: true, knee: true, hipAngle: true, line: true, lean: true }

  it('uses the same measurement deadband for red flags as the numeric score', () => {
    const full = POSE_PROFILES['full-planche']
    expect(
      materialIssuesForReading(
        {
          t: 0,
          elbowDeg: 177.1,
          kneeDeg: 173.1,
          hipAngleDeg: 170.1,
          hipOffset: 0.159,
          leanRatio: 0.391,
          shrugRatio: 0.271,
          asymmetry: 0.229,
        },
        full,
        allJudged,
      ),
    ).toEqual([])
    expect(
      materialIssuesForReading(
        {
          t: 0,
          elbowDeg: 160,
          kneeDeg: 150,
          hipAngleDeg: 140,
          hipOffset: 0.4,
          leanRatio: 0.2,
          shrugRatio: 0.2,
          asymmetry: 0.4,
        },
        full,
        allJudged,
      ),
    ).toEqual(expect.arrayContaining(['arms', 'knees', 'closed', 'pike', 'lean', 'shrug', 'twist']))
  })

  it('scores a clean hold at 100 across every judged criterion', () => {
    const scored = computeFormScore({
      profile: tuck,
      judged: allJudged,
      elbowDeg: 178,
      hipOffset: 0.05,
      leanRatio: 0.4,
      shrugRatio: 0.45,
      wobble: 0.01,
      cleanRatio: 1,
    })
    expect(scored?.score).toBe(100)
    expect(scored?.subscores.every((s) => s.score === 100)).toBe(true)
  })

  it('drops the headline score when the elbows bend materially', () => {
    const clean = computeFormScore({
      profile: tuck,
      judged: allJudged,
      elbowDeg: 178,
      cleanRatio: 1,
    })!
    const bent = computeFormScore({
      profile: tuck,
      judged: allJudged,
      elbowDeg: 140,
      cleanRatio: 1,
    })!
    expect(bent.score).toBeLessThan(clean.score)
    expect(bent.subscores.find((s) => s.key === 'elbow')?.score).toBeLessThan(70)
  })

  it('excludes criteria the camera did not judge instead of guessing them', () => {
    const scored = computeFormScore({
      profile: tuck,
      judged: { ...allJudged, elbow: false },
      elbowDeg: 120,
      hipOffset: 0,
      cleanRatio: 1,
    })!
    expect(scored.subscores.some((s) => s.key === 'elbow')).toBe(false)
  })

  it('refuses to score when nothing was judged', () => {
    expect(
      computeFormScore({
        profile: tuck,
        judged: { elbow: false, knee: false, hipAngle: false, line: false, lean: false },
      }),
    ).toBeNull()
  })

  it('prioritises bent arms over every cosmetic fault in the fix-first cue', () => {
    expect(pickFixFirst(['knees', 'twist', 'arms'])?.issue).toBe('arms')
    expect(pickFixFirst([])).toBeNull()
  })
})

describe('readiness rails', () => {
  it('starts a new athlete with a baseline instead of claiming 99 rest days', () => {
    const plan = buildPlan(state(), Date.now())

    expect(plan.dayType).toBe('build')
    expect(plan.dayReason).toContain('Baseline session')
    expect(plan.dayReason).not.toContain('99')
  })

  it('treats a timer target as missed when clean camera time fell short', () => {
    const now = Date.now()
    const logged = session(
      'foundations',
      [log('ppp-hold', 12, { target: 10, form: form('clean', true, [], 0.9, 8, 8 / 12) })],
      { startedAt: now - 3 * DAY },
    )
    expect(readSignals({ ...state(), sessions: [logged] }, now).mainHitRate).toBe(0)
  })

  it('targets accessories at a recurring camera-detected limiter', () => {
    const now = Date.now()
    const pike = form('slipped', true, ['pike'])
    const history = session(
      'advtuck',
      [
        log('adv-tuck-planche', 10, { form: pike }),
        log('adv-tuck-planche', 9, { form: pike }),
        log('adv-tuck-planche', 8, { form: pike }),
      ],
      { startedAt: now - 3 * DAY },
    )
    const athlete = { ...state('advtuck'), sessions: [history] }
    const plan = buildPlan(athlete, now)
    const workout = todaysSession(athlete, plan)

    expect(plan.limiter?.label).toBe('Body-line strength')
    expect(plan.accessoryEmphasis).toBe('core')
    expect(workout.blocks.some((block) => block.exerciseId === 'arch-hold')).toBe(true)
  })

  it('uses many reviewed clips as consensus instead of extra chances for a false limiter', () => {
    const now = Date.now()
    const occasionalPike = [0, 1].map(() =>
      log('adv-tuck-planche', 10, { form: form('slipped', true, ['pike']) }),
    )
    const clean = Array.from({ length: 6 }, () =>
      log('adv-tuck-planche', 10, { form: form('clean', true, []) }),
    )
    const history = session('advtuck', [...occasionalPike, ...clean], {
      startedAt: now - DAY,
    })
    expect(readSignals({ ...state('advtuck'), sessions: [history] }, now).topFormIssue).toBeNull()

    const consensus = session(
      'advtuck',
      [
        ...Array.from({ length: 4 }, () =>
          log('adv-tuck-planche', 10, { form: form('slipped', true, ['pike']) }),
        ),
        ...Array.from({ length: 4 }, () =>
          log('adv-tuck-planche', 10, { form: form('clean', true, []) }),
        ),
      ],
      { startedAt: now - DAY },
    )
    expect(readSignals({ ...state('advtuck'), sessions: [consensus] }, now).topFormIssue).toEqual({
      issue: 'pike',
      count: 4,
      of: 8,
    })
  })

  it('switches to technique work when filmed holds repeatedly break down early', () => {
    const now = Date.now()
    const earlyBreak = form('slipped', true, [], 0.9, 6, 0.6)
    const history = session(
      'tuck',
      [
        log('tuck-planche', 10, { form: earlyBreak }),
        log('tuck-planche', 10, { form: earlyBreak }),
        log('tuck-planche', 10, { form: earlyBreak }),
      ],
      { startedAt: now - 3 * DAY },
    )
    const plan = buildPlan({ ...state('tuck'), sessions: [history] }, now)

    expect(plan.strategy).toBe('technique')
    expect(plan.limiter?.label).toBe('Hold durability')
    expect(plan.suggestMaxTest).toBe(false)
  })

  it('removes loaded upper-body work after a pain check-in', () => {
    const checkIn: CheckIn = { joints: 'pain', energy: 'ok', at: Date.now() }
    const plan = buildPlan(state('tuck'), Date.now(), checkIn)
    expect(plan.loadPermission).toBe('none')
    expect(todaysSession(state('tuck'), plan)).toEqual(painSafeRecoveryWorkout())
    expect(
      todaysSession(state('tuck'), plan).blocks.some((block) =>
        ['planche', 'push', 'scapula', 'wrist'].includes(
          // The recovery contract is intentionally asserted by exercise ids
          // here so a later content edit cannot quietly re-add loaded work.
          ['hollow-hold', 'leg-lifts', 'arch-hold', 'pancake-stretch', 'jumping-jacks'].includes(
            block.exerciseId,
          )
            ? ''
            : 'planche',
        ),
      ),
    ).toBe(false)
  })
})

describe('stage-specific planche lean programming', () => {
  function generatedWorkout(
    stepId: AppState['stepId'],
    dayType: 'build' | 'technique' = 'build',
    sessionMinutes = 60,
  ) {
    const athlete = {
      ...state(stepId),
      settings: { ...state(stepId).settings, sessionMinutes },
    }
    const plan = {
      ...buildPlan(athlete, Date.now()),
      dayType,
      loadPermission: 'normal' as const,
      warmup: 'standard' as const,
      volumeFactor: 1,
      queueUnlockAttempt: false,
    }
    return todaysSession(athlete, plan)
  }

  it('keeps a primer plus meaningful lean strength work at Tuck', () => {
    const leans = generatedWorkout('tuck').blocks.filter(
      (block) => block.exerciseId === 'planche-lean',
    )

    expect(leans).toEqual([
      expect.objectContaining({ section: 'warmup', sets: 1, target: { kind: 'hold', sec: 8 } }),
      expect.objectContaining({ section: 'strength', sets: 3, target: { kind: 'hold', sec: 12 } }),
    ])
  })

  it('prioritises the Tuck lean over generic accessories in a standard session', () => {
    const leans = generatedWorkout('tuck', 'build', 30).blocks.filter(
      (block) => block.exerciseId === 'planche-lean',
    )

    expect(leans.some((block) => block.section === 'strength')).toBe(true)
  })

  it('tapers lean strength work to maintenance at Advanced Tuck', () => {
    const leans = generatedWorkout('advtuck').blocks.filter(
      (block) => block.exerciseId === 'planche-lean',
    )

    expect(leans).toEqual([
      expect.objectContaining({ section: 'warmup', sets: 1, target: { kind: 'hold', sec: 8 } }),
      expect.objectContaining({ section: 'strength', sets: 2, target: { kind: 'hold', sec: 10 } }),
    ])
  })

  it.each(['oneleg', 'straddle', 'full'] as const)(
    'keeps leans as a primer only at %s',
    (stepId) => {
      const leans = generatedWorkout(stepId).blocks.filter(
        (block) => block.exerciseId === 'planche-lean',
      )

      expect(leans).toHaveLength(1)
      expect(leans[0]).toEqual(
        expect.objectContaining({ section: 'warmup', sets: 1, target: { kind: 'hold', sec: 8 } }),
      )
      expect(leans[0].note).toContain('Primer only')
    },
  )

  it('does not add loaded lean volume to a Tuck technique day', () => {
    const leans = generatedWorkout('tuck', 'technique').blocks.filter(
      (block) => block.exerciseId === 'planche-lean',
    )

    expect(leans).toEqual([
      expect.objectContaining({ section: 'warmup', sets: 1, target: { kind: 'hold', sec: 8 } }),
    ])
  })
})

describe('coach learning', () => {
  it('keeps a single bad camera score from reversing the quality trend', () => {
    const start = Date.now() - 5 * DAY
    expect(
      robustSlopePerWeek([
        { at: start, value: 70 },
        { at: start + DAY, value: 71 },
        { at: start + 2 * DAY, value: 10 },
        { at: start + 3 * DAY, value: 73 },
        { at: start + 4 * DAY, value: 74 },
      ]),
    ).toBeCloseTo(7)
  })

  it('compares follow-up performance with a prior baseline, not the arm session peak', () => {
    const t = Date.now() - 5 * DAY
    const history = [
      session('foundations', [log('ppp-hold', 10, { form: form() })], { startedAt: t }),
      session('foundations', [log('ppp-hold', 11, { form: form() })], { startedAt: t + DAY }),
      session('foundations', [log('ppp-hold', 20, { form: form() })], {
        startedAt: t + 2 * DAY,
        strategy: 'intensity',
      }),
      session('foundations', [log('ppp-hold', 12, { form: form() })], { startedAt: t + 4 * DAY }),
    ]
    expect(rewardFor(history, history[2])).toBeGreaterThan(0)
  })

  it('discounts seconds the camera watched decay, and pain that follows a strategy', () => {
    const t = Date.now() - 5 * DAY
    const build = (cleanRatio: number, checkIn?: CheckIn) => [
      session('foundations', [log('ppp-hold', 10, { form: form() })], { startedAt: t }),
      session('foundations', [log('ppp-hold', 11, { form: form() })], { startedAt: t + DAY }),
      session(
        'foundations',
        [
          log('ppp-hold', 20, {
            form: form(
              cleanRatio >= 0.8 ? 'clean' : 'slipped',
              true,
              cleanRatio >= 0.8 ? [] : ['arms'],
              0.9,
              20 * cleanRatio,
              cleanRatio,
            ),
          }),
          log('ppp-hold', 19, {
            form: form(
              cleanRatio >= 0.8 ? 'clean' : 'slipped',
              true,
              cleanRatio >= 0.8 ? [] : ['arms'],
              0.9,
              19 * cleanRatio,
              cleanRatio,
            ),
          }),
        ],
        { startedAt: t + 2 * DAY, strategy: 'intensity' },
      ),
      session('foundations', [log('ppp-hold', 12, { form: form() })], {
        startedAt: t + 4 * DAY,
        ...(checkIn ? { checkIn } : {}),
      }),
    ]
    const clean = build(1)
    const sloppy = build(0.85)
    const cleanReward = rewardFor(clean, clean[2])!
    expect(rewardFor(sloppy, sloppy[2])!).toBeLessThan(cleanReward)

    const pained = build(1, { joints: 'pain', energy: 'ok', at: t + 4 * DAY })
    expect(rewardFor(pained, pained[2])!).toBeLessThan(cleanReward)
  })

  it('never lets unconfirmed or athlete-disputed camera guesses change coaching', () => {
    const disputed = log('ppp-hold', 12, {
      form: form('clean', true, ['arms', 'lean'], 0.9, 4, 0.33),
    })
    const unconfirmed = log('ppp-hold', 12, {
      form: form('broke', false, ['arms', 'lean'], 0.9, 4, 0.33),
    })
    expect(trustedCameraEvidence(disputed)).toBe(false)
    expect(trustedCameraEvidence(unconfirmed)).toBe(false)

    const athlete = {
      ...state(),
      sessions: [
        session('foundations', [disputed, unconfirmed, disputed], {
          startedAt: Date.now() - DAY,
        }),
      ],
    }
    const signals = readSignals(athlete)
    expect(signals.cameraSetCount).toBe(0)
    expect(signals.meanCleanRatio).toBeNull()
    expect(signals.topFormIssue).toBeNull()
    expect(buildPlan(athlete).decisions.some((d) => d.text.includes('camera verified only'))).toBe(false)
  })

  it('explains repeated camera disagreement and excludes its trends from the prescription', () => {
    const now = Date.now()
    const disagreed = Array.from({ length: 3 }, () =>
      log('ppp-hold', 12, {
        form: form('clean', true, ['arms'], 0.9, 3, 0.25),
      }),
    )
    const athlete = {
      ...state(),
      sessions: [session('foundations', disagreed, { startedAt: now - DAY })],
    }
    const signals = readSignals(athlete, now)
    const plan = buildPlan(athlete, now)

    expect(signals.cameraReviewedCount).toBe(3)
    expect(signals.cameraAgreementRate).toBe(0)
    expect(signals.meanCleanRatio).toBeNull()
    expect(plan.decisions.some((decision) => decision.text.includes('leaving those camera trends out'))).toBe(true)
  })

  it('flags a chronically unseen criterion as a placement problem, not a form fault', () => {
    const now = Date.now()
    const unseenForm = (): FormCheck => ({
      rating: 'clean',
      confirmed: true,
      auto: { issues: [], confidence: 0.8, unseen: ['forward lean'] },
    })
    const history = session(
      'foundations',
      [
        log('ppp-hold', 10, { form: unseenForm() }),
        log('ppp-hold', 10, { form: unseenForm() }),
        log('ppp-hold', 10, { form: unseenForm() }),
      ],
      { startedAt: now - 2 * DAY },
    )
    const athlete = { ...state(), sessions: [history] }
    expect(readSignals(athlete, now).chronicUnseen).toEqual({
      criterion: 'forward lean',
      count: 3,
      of: 3,
    })
    expect(
      buildPlan(athlete, now).decisions.some((d) => d.text.includes('missed your forward lean')),
    ).toBe(true)
  })
})

describe('backup validation and normalization', () => {
  it('rejects unrelated valid JSON before destructive import work', () => {
    expect(() => validateImport({})).toThrow(/Planche Lab backup/)
  })

  it('accepts a backup created by the current app version', () => {
    expect(() => validateImport(initialState())).not.toThrow()
  })

  it('sanitizes behavior settings and rebuilds derived progress', () => {
    const raw = {
      ...state(),
      settings: { ...state().settings, theme: 'broken', sound: 'false' },
      sessions: [
        session('foundations', [log('ppp-hold', 30, { form: form() })]),
      ],
      prs: {},
    }
    const normalized = normalizeState(raw)
    expect(normalized.settings.theme).toBe('dark')
    expect(normalized.settings.sound).toBe(true)
    const rebuilt = rebuildDerivedState(normalized)
    expect(rebuilt.prs['ppp-hold']?.value).toBe(30)
    expect(rebuilt.stepId).toBe('lean')
  })

  it('round-trips camera, flight, surface and surface-PR evidence through import', () => {
    const raw = {
      ...state(),
      prs: {
        'tuck-planche': {
          value: 5,
          at: Date.now(),
          bySurface: { parallettes: { value: 5, at: Date.now() } },
        },
      },
      sessions: [
        session('foundations', [
          log('ppp-hold', 12, {
            surface: 'parallettes',
            leadInSec: 2.5,
            form: {
              rating: 'clean' as const,
              confirmed: true,
              flightConfirmed: true,
              auto: {
                issues: [],
                confidence: 0.8,
                score: 77,
                shrugRatio: 0.3,
                asymmetry: 0.1,
                unseen: ['knees'],
              },
            },
          }),
        ]),
      ],
    }
    const auto = normalizeState(raw).sessions[0].sets[0].form?.auto
    expect(auto?.score).toBe(77)
    expect(auto?.shrugRatio).toBeCloseTo(0.3)
    expect(auto?.asymmetry).toBeCloseTo(0.1)
    expect(auto?.unseen).toEqual(['knees'])
    expect(normalizeState(raw).sessions[0].sets[0]).toMatchObject({
      surface: 'parallettes',
      leadInSec: 2.5,
      form: { flightConfirmed: true },
    })
    expect(normalizeState(raw).prs['tuck-planche']?.bySurface?.parallettes?.value).toBe(5)
  })

  it('grandfathers pre-camera unlocks without changing the selected lower step', () => {
    const legacy = {
      ...state('lean'),
      version: 3,
      baseStepId: 'foundations',
      unlocked: ['foundations', 'lean', 'frog'],
      sessions: [],
    }
    const normalized = normalizeState(legacy)
    expect(normalized.grandfatheredStepId).toBe('frog')

    const rebuilt = rebuildDerivedState(normalized)
    expect(rebuilt.unlocked).toEqual(['foundations', 'lean', 'frog'])
    expect(rebuilt.stepId).toBe('lean')
  })
})
