import { describe, expect, it } from 'vitest'
import type { AppState, CheckIn, FormCheck, FormIssue, Session, SetLog } from '../types'
import { initialState, normalizeState, rebuildDerivedState } from './store'
import { applySession } from './engine'
import { formEvidenceCoversArms, progressionCredit, qualifyingProgress } from './progression'
import {
  POSE_PROFILES,
  bandedScore,
  bridgeKeypointGaps,
  chooseSampleCount,
  computeFormScore,
  gradeCoverage,
  materialIssuesForReading,
  pickFixFirst,
  reliableJointAngle,
  suppressBilateralCollisions,
  suppressIsolatedMetricSpikes,
  sustainedCleanSeconds,
  sustainedMinimum,
  sustainedTypical,
  unrotateKeypoints,
} from './poseForm'
import { buildPlan, debriefSession, rewardFor } from './coach'
import { painSafeRecoveryWorkout, todaysSession } from '../data/workouts'
import { validateImport } from './exportImport'
import { buildSampleState } from '../data/sample'
import { selectRecorderMime } from './recorder'
import { readSignals, trustedCameraEvidence } from './signals'

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
          elbowDeg: 168,
          kneeDeg: 162,
          hipAngleDeg: 153,
          hipOffset: 0.27,
          leanRatio: 0.35,
          shrugRatio: 0.28,
          asymmetry: 0.27,
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

describe('coach learning', () => {
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

  it('round-trips camera score, shrug, asymmetry and unseen evidence through import', () => {
    const raw = {
      ...state(),
      sessions: [
        session('foundations', [
          log('ppp-hold', 12, {
            form: {
              rating: 'clean' as const,
              confirmed: true,
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
