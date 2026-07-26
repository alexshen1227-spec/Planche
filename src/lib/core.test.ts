import { describe, expect, it } from 'vitest'
import type { AppState, CheckIn, FormCheck, FormIssue, Session, SetLog } from '../types'
import { initialState, normalizeState, rebuildDerivedState } from './store'
import { applySession } from './engine'
import { formEvidenceCoversArms, progressionCredit, qualifyingProgress } from './progression'
import { POSE_PROFILES, gradeCoverage, sustainedCleanSeconds, sustainedMinimum } from './poseForm'
import { buildPlan, rewardFor } from './coach'
import { painSafeRecoveryWorkout, todaysSession } from '../data/workouts'
import { validateImport } from './exportImport'
import { buildSampleState } from '../data/sample'
import { selectRecorderMime } from './recorder'
import { readSignals } from './signals'

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

describe('camera evaluator primitives', () => {
  it('uses the lower quartile so a few straight frames cannot hide a bent hold', () => {
    expect(sustainedMinimum([150, 150, 150, 150, 150, 150, 175, 175])).toBe(150)
  })

  it('prefers broadly compatible WebM before falling back to MP4', () => {
    const supported = new Set(['video/webm', 'video/mp4'])
    expect(selectRecorderMime((mime) => supported.has(mime))).toBe('video/webm')
  })

  it('ignores one noisy frame but caps clean time at a sustained breakdown', () => {
    expect(
      sustainedCleanSeconds(
        [
          { t: 2, bad: false },
          { t: 4, bad: true },
          { t: 6, bad: false },
          { t: 8, bad: true },
          { t: 10, bad: true },
        ],
        12,
      ),
    ).toBe(8)
    expect(sustainedCleanSeconds([{ t: 6, bad: true }], 12)).toBe(12)
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
    const pike = form('clean', true, ['pike'])
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

  it('switches to technique work when filmed holds repeatedly break down early', () => {
    const now = Date.now()
    const earlyBreak = form('clean', true, [], 0.9, 6, 0.6)
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
