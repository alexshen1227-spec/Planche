import { describe, expect, it } from 'vitest'
import type { AppState, BodyRegion, FormCheck, Session, SetLog, StepId } from '../types'
import { initialState } from './store'
import { readSignals } from './signals'
import { buildPlan } from './coach'
import {
  CAPABILITY_JUMP_PCT,
  LEVER_FRACTION,
  readCapabilityJump,
  weightedHoldSeconds,
} from './loading'
import { STEP_BY_ID } from '../data/progressions'
import {
  CONFIDENCE_NOTE,
  MIN_FORECAST_POINTS,
  MIN_FORECAST_SPAN_DAYS,
  describeForecast,
  forecastUnlock,
  goalOutlook,
  qualifyingSeries,
} from './forecast'
import {
  FLAT_RATE,
  PLATEAU_LABEL,
  PLATEAU_MIN_DAYS,
  PLATEAU_MIN_SESSIONS,
  diagnosePlateau,
  recentBreakthrough,
} from './plateau'
import {
  ASSESSMENT_ITEMS,
  assessmentProgress,
  emphasisFromGaps,
  nextAssessmentItem,
  placeFromAssessment,
  type AssessmentAnswers,
} from './assessment'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 7, 4)

function form(cleanSeconds?: number): FormCheck {
  return {
    rating: 'clean',
    confirmed: true,
    flightConfirmed: true,
    auto: { issues: [], confidence: 0.9, cleanSeconds, cleanRatio: 1 },
  }
}

function holdSet(exerciseId: string, value: number, at: number, overrides: Partial<SetLog> = {}): SetLog {
  return {
    exerciseId,
    kind: 'hold',
    value,
    target: value,
    section: 'main',
    at,
    form: form(),
    ...overrides,
  }
}

/** A history of verified session bests on the step's key hold. */
function historyOf(
  stepId: StepId,
  points: { daysAgo: number; value: number }[],
  overrides: Partial<Session> = {},
): Session[] {
  const key = STEP_BY_ID[stepId].keyExerciseId
  return points.map((p) => {
    const at = NOW - p.daysAgo * DAY
    return {
      id: `s-${p.daysAgo}-${p.value}`,
      startedAt: at,
      endedAt: at + 60_000,
      workoutName: 'Session',
      workoutKind: 'auto' as const,
      stepId,
      sets: [holdSet(key, p.value, at)],
      ...overrides,
    }
  })
}

function stateWith(stepId: StepId, sessions: Session[], patch: Partial<AppState> = {}): AppState {
  return {
    ...initialState(),
    onboarded: true,
    stepId,
    baseStepId: stepId,
    unlocked: [stepId],
    sessions,
    ...patch,
  }
}

// ————————————————————————————— Forecast —————————————————————————————

describe('forecastUnlock', () => {
  it('refuses a forecast below the minimum number of measured points', () => {
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 40, value: 4 },
        { daysAgo: 20, value: 6 },
        { daysAgo: 5, value: 8 },
      ]),
    )
    const f = forecastUnlock(state, 'tuck', NOW)
    expect(f.kind).toBe('insufficient')
    if (f.kind === 'insufficient') {
      expect(f.need).toContain(`${MIN_FORECAST_POINTS}`)
    }
  })

  it('refuses when the evidence is dense but spans too few days', () => {
    // Five sessions inside a week measures cadence, not progress.
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 6, value: 4 },
        { daysAgo: 5, value: 5 },
        { daysAgo: 3, value: 6 },
        { daysAgo: 2, value: 7 },
        { daysAgo: 1, value: 8 },
      ]),
    )
    const f = forecastUnlock(state, 'tuck', NOW)
    expect(f.kind).toBe('insufficient')
    if (f.kind === 'insufficient') expect(f.need).toContain(`${MIN_FORECAST_SPAN_DAYS}`)
  })

  it('returns a range, not a point estimate, on a steady climb', () => {
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 56, value: 4 },
        { daysAgo: 42, value: 6 },
        { daysAgo: 28, value: 8 },
        { daysAgo: 21, value: 9 },
        { daysAgo: 14, value: 11 },
        { daysAgo: 7, value: 12 },
      ]),
    )
    const f = forecastUnlock(state, 'tuck', NOW)
    expect(f.kind).toBe('range')
    if (f.kind !== 'range') return
    expect(f.lowWeeks).toBeGreaterThanOrEqual(1)
    expect(f.highWeeks === null || f.highWeeks >= f.lowWeeks).toBe(true)
    expect(f.ratePerWeek).toBeGreaterThan(0)
    // The whole point: an interval, and one wide enough to be honest.
    expect(describeForecast(f)).toMatch(/weeks/)
    expect(CONFIDENCE_NOTE[f.confidence]).toBeTruthy()
  })

  it('says the bar is already cleared instead of forecasting zero', () => {
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 40, value: 12 },
        { daysAgo: 30, value: 15 },
        { daysAgo: 20, value: 18 },
        { daysAgo: 10, value: 21 },
      ]),
    )
    expect(forecastUnlock(state, 'tuck', NOW).kind).toBe('ready')
  })

  it('refuses to project a flat trend rather than inventing a date', () => {
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 56, value: 8 },
        { daysAgo: 42, value: 8 },
        { daysAgo: 28, value: 8 },
        { daysAgo: 14, value: 8 },
        { daysAgo: 3, value: 8 },
      ]),
    )
    const f = forecastUnlock(state, 'tuck', NOW)
    expect(f.kind).toBe('not-trending')
    expect(describeForecast(f)).not.toMatch(/\d+\s*weeks/)
  })

  it('refuses to project a declining trend', () => {
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 56, value: 14 },
        { daysAgo: 42, value: 12 },
        { daysAgo: 28, value: 11 },
        { daysAgo: 14, value: 9 },
        { daysAgo: 3, value: 8 },
      ]),
    )
    const f = forecastUnlock(state, 'tuck', NOW)
    expect(f.kind).toBe('not-trending')
    if (f.kind === 'not-trending') expect(f.ratePerWeek).toBeLessThan(0)
  })

  it('reports an open-ended upper edge instead of a number past the horizon', () => {
    // A crawl: the slow quartile puts the far edge beyond a year.
    const state = stateWith(
      'full',
      historyOf('full', [
        { daysAgo: 120, value: 1 },
        { daysAgo: 90, value: 1.1 },
        { daysAgo: 60, value: 1.15 },
        { daysAgo: 30, value: 1.3 },
        { daysAgo: 2, value: 1.35 },
      ]),
    )
    const f = forecastUnlock(state, 'full', NOW)
    if (f.kind === 'range') {
      expect(f.highWeeks).toBeNull()
      expect(describeForecast(f)).toContain('+ weeks')
    } else {
      expect(f.kind).toBe('not-trending')
    }
  })

  it('never quotes a range narrower than a week or inverted', () => {
    for (let seed = 0; seed < 40; seed++) {
      const points = Array.from({ length: 6 }, (_, i) => ({
        daysAgo: 60 - i * 10,
        // Deterministic pseudo-noise around a climb.
        value: 3 + i * 1.5 + (((seed * 7 + i * 13) % 9) - 4) * 0.3,
      }))
      const state = stateWith('tuck', historyOf('tuck', points))
      const f = forecastUnlock(state, 'tuck', NOW)
      if (f.kind !== 'range') continue
      expect(f.lowWeeks).toBeGreaterThanOrEqual(1)
      expect(Number.isFinite(f.lowWeeks)).toBe(true)
      if (f.highWeeks !== null) {
        expect(f.highWeeks).toBeGreaterThanOrEqual(f.lowWeeks)
        expect(Number.isInteger(f.highWeeks)).toBe(true)
      }
    }
  })

  it('ignores unverified sets, matching what the unlock actually requires', () => {
    const key = STEP_BY_ID.tuck.keyExerciseId
    const unverified = historyOf('tuck', [
      { daysAgo: 50, value: 5 },
      { daysAgo: 40, value: 7 },
      { daysAgo: 30, value: 9 },
      { daysAgo: 20, value: 11 },
    ]).map((s) => ({
      ...s,
      sets: [holdSet(key, s.sets[0].value, s.startedAt, { form: undefined })],
    }))
    expect(qualifyingSeries(stateWith('tuck', unverified), 'tuck')).toHaveLength(0)
    expect(forecastUnlock(stateWith('tuck', unverified), 'tuck', NOW).kind).toBe('insufficient')
  })
})

describe('goalOutlook', () => {
  it('counts the steps but refuses a duration without measured step history', () => {
    const state = stateWith('tuck', [], { profile: { ...initialState().profile, goalStepId: 'straddle' } })
    const o = goalOutlook(state, NOW)
    expect(o.stepsRemaining).toBe(STEP_BY_ID.straddle.order - STEP_BY_ID.tuck.order)
    expect(o.estimate).toBeNull()
    expect(o.note).toMatch(/steps? between you and/i)
  })

  it('estimates from completed steps of comparable difficulty', () => {
    const sessions: Session[] = [
      ...historyOf('tuck', [{ daysAgo: 300, value: 8 }]),
      ...historyOf('advtuck', [{ daysAgo: 200, value: 8 }]),
      ...historyOf('oneleg', [{ daysAgo: 90, value: 5 }]),
    ]
    const state = stateWith('oneleg', sessions, {
      profile: { ...initialState().profile, goalStepId: 'full' },
    })
    const o = goalOutlook(state, NOW)
    expect(o.estimate).not.toBeNull()
    expect(o.estimate!.lowWeeks).toBeGreaterThan(0)
    expect(o.estimate!.highWeeks).toBeGreaterThan(o.estimate!.lowWeeks)
    expect(o.estimate!.measuredFrom).toBe(2)
  })

  it('refuses to extrapolate the quick early steps onto the hard ones', () => {
    // The bug this pins: Foundations, Lean and Frog can each take a fortnight,
    // and multiplying that pace by the four steps to a straddle produced
    // "1-14 weeks", which is not a wide estimate but a wrong one.
    const sessions: Session[] = [
      ...historyOf('foundations', [{ daysAgo: 60, value: 32 }]),
      ...historyOf('lean', [{ daysAgo: 45, value: 32 }]),
      ...historyOf('frog', [{ daysAgo: 30, value: 32 }]),
      ...historyOf('tuck', [{ daysAgo: 14, value: 8 }]),
    ]
    const state = stateWith('tuck', sessions, {
      profile: { ...initialState().profile, goalStepId: 'straddle' },
    })
    const o = goalOutlook(state, NOW)
    expect(o.estimate).toBeNull()
    expect(o.stepsRemaining).toBe(3)
    expect(o.note).not.toMatch(/\d+\s*[–-]\s*\d+\s*weeks/)
  })

  it('handles an athlete already at their chosen goal', () => {
    const state = stateWith('straddle', [], {
      profile: { ...initialState().profile, goalStepId: 'straddle' },
    })
    const o = goalOutlook(state, NOW)
    expect(o.stepsRemaining).toBe(0)
    expect(o.estimate).toBeNull()
  })
})

// ————————————————————————————— Plateau —————————————————————————————

function diagnose(state: AppState) {
  return diagnosePlateau(state, readSignals(state, NOW), NOW)
}

describe('diagnosePlateau', () => {
  it('says nothing before there is a block of training to judge', () => {
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 10, value: 8 },
        { daysAgo: 6, value: 8 },
        { daysAgo: 3, value: 8 },
      ]),
    )
    expect(diagnose(state)).toBeNull()
  })

  it('requires the evidence to span a real period, not a dense week', () => {
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 8, value: 8 },
        { daysAgo: 6, value: 8 },
        { daysAgo: 4, value: 8 },
        { daysAgo: 2, value: 8 },
      ]),
    )
    // Four points but only six days apart — under PLATEAU_MIN_DAYS.
    expect(PLATEAU_MIN_SESSIONS).toBe(4)
    expect(diagnose(state)).toBeNull()
  })

  it('stays silent while the athlete is progressing', () => {
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 56, value: 4 },
        { daysAgo: 42, value: 6 },
        { daysAgo: 28, value: 8 },
        { daysAgo: 14, value: 10 },
        { daysAgo: 3, value: 12 },
      ]),
    )
    expect(diagnose(state)).toBeNull()
  })

  it('calls a flat block a stall and gives it a cause and a prescription', () => {
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 56, value: 8 },
        { daysAgo: 42, value: 8 },
        { daysAgo: 28, value: 8 },
        { daysAgo: 14, value: 8 },
        { daysAgo: 3, value: 8 },
      ]),
    )
    const v = diagnose(state)
    expect(v).not.toBeNull()
    expect(v!.status).toBe('stalled')
    expect(v!.evidence.length).toBeGreaterThan(20)
    expect(v!.intervention.length).toBeGreaterThan(20)
    expect(PLATEAU_LABEL[v!.cause]).toBeTruthy()
  })

  it('blames the measurement, not the athlete, when the numbers are too noisy', () => {
    // Swing wider than the trend itself: median 8s, MAD 3s (±37%), net slope
    // slightly negative. Neither "you stalled" nor "you improved" is knowable.
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 56, value: 8 },
        { daysAgo: 45, value: 14 },
        { daysAgo: 35, value: 5 },
        { daysAgo: 24, value: 13 },
        { daysAgo: 12, value: 5 },
        { daysAgo: 3, value: 8 },
      ]),
    )
    const v = diagnose(state)
    expect(v?.cause).toBe('measurement-noise')
    expect(v?.suggestMaxTest).toBe(true)
    // Critically: it must not tell a noisy athlete to train harder.
    expect(v?.intervention).not.toMatch(/more (sets|volume|sessions)/i)
  })

  it('prescribes rest, not effort, when the athlete is buried in load', () => {
    const sessions = historyOf(
      'tuck',
      [
        { daysAgo: 40, value: 8 },
        { daysAgo: 30, value: 8 },
        { daysAgo: 20, value: 8 },
        { daysAgo: 10, value: 8 },
        { daysAgo: 2, value: 8 },
      ],
      { rpe: 9.5 },
    )
    // Pile on enough recent work that the acute:chronic read is elevated.
    const heavy: Session[] = Array.from({ length: 8 }, (_, i) => {
      const at = NOW - (i + 1) * DAY
      return {
        id: `heavy-${i}`,
        startedAt: at,
        endedAt: at + 60_000,
        workoutName: 'Session',
        workoutKind: 'auto' as const,
        stepId: 'tuck' as StepId,
        rpe: 9.5,
        sets: Array.from({ length: 6 }, () => holdSet('tuck-planche', 10, at, { form: undefined })),
      }
    })
    const state = stateWith('tuck', [...sessions, ...heavy], {})
    const v = diagnose(state)
    expect(v).not.toBeNull()
    expect(['under-recovered', 'measurement-noise']).toContain(v!.cause)
    if (v!.cause === 'under-recovered') {
      expect(v!.suggestDeload).toBe(true)
      expect(v!.intervention).toMatch(/easy week|recovery/i)
    }
  })

  it('tells an athlete training twice a month that frequency is the problem', () => {
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 84, value: 8 },
        { daysAgo: 60, value: 8 },
        { daysAgo: 40, value: 8 },
        { daysAgo: 18, value: 8 },
      ]),
    )
    const v = diagnose(state)
    expect(v?.cause).toBe('under-stimulated')
    // Must not be told to deload when they have barely trained.
    expect(v?.suggestDeload).toBeUndefined()
  })

  it('never returns a verdict without both evidence and an intervention', () => {
    const shapes = [
      [8, 8, 8, 8, 8],
      [12, 11, 10, 9, 8],
      [6, 9, 6, 9, 6],
      [3, 3.1, 3, 3.2, 3.1],
    ]
    for (const values of shapes) {
      const state = stateWith(
        'tuck',
        historyOf(
          'tuck',
          values.map((value, i) => ({ daysAgo: 60 - i * 14, value })),
        ),
      )
      const v = diagnose(state)
      if (!v) continue
      expect(v.evidence.trim().length).toBeGreaterThan(0)
      expect(v.intervention.trim().length).toBeGreaterThan(0)
      expect(v.weeksFlat).toBeGreaterThanOrEqual(1)
      expect(Number.isFinite(v.weeksFlat)).toBe(true)
      // No sentinel or placeholder ever reaches the athlete.
      expect(v.evidence).not.toMatch(/\b99\b|NaN|undefined|null/)
      expect(v.intervention).not.toMatch(/\b99\b|NaN|undefined|null/)
    }
  })

  it('uses a flat-rate threshold that does not fire on real progress', () => {
    expect(FLAT_RATE).toBeGreaterThan(0)
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 56, value: 8 },
        { daysAgo: 42, value: 8.5 },
        { daysAgo: 28, value: 9 },
        { daysAgo: 14, value: 9.6 },
        { daysAgo: 3, value: 10.2 },
      ]),
    )
    // ~0.25s/week — slow, but real. Not a plateau.
    expect(diagnose(state)).toBeNull()
  })

  it('requires the documented minimum span', () => {
    expect(PLATEAU_MIN_DAYS).toBeGreaterThanOrEqual(21)
  })
})

describe('recentBreakthrough', () => {
  it('recognises a real jump so the app is not only ever bad news', () => {
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 80, value: 6 },
        { daysAgo: 70, value: 6 },
        { daysAgo: 60, value: 6.5 },
        { daysAgo: 20, value: 9 },
        { daysAgo: 10, value: 10 },
        { daysAgo: 3, value: 11 },
      ]),
    )
    const b = recentBreakthrough(state, 'tuck', NOW)
    expect(b).not.toBeNull()
    expect(b!.gainSec).toBeGreaterThan(0)
  })

  it('does not celebrate noise', () => {
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 80, value: 8 },
        { daysAgo: 60, value: 8.2 },
        { daysAgo: 20, value: 8.1 },
        { daysAgo: 10, value: 8.3 },
        { daysAgo: 3, value: 8.2 },
      ]),
    )
    expect(recentBreakthrough(state, 'tuck', NOW)).toBeNull()
  })
})

// ————————————————————————— Tissue and pain rails —————————————————————————

describe('capability jump and load ramp', () => {
  it('holds volume after a big verified jump rather than rewarding it', () => {
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 60, value: 6 },
        { daysAgo: 45, value: 6.5 },
        { daysAgo: 30, value: 6 },
        { daysAgo: 20, value: 6.5 },
        { daysAgo: 5, value: 11 },
      ]),
    )
    const jump = readCapabilityJump(state, 'tuck', NOW)
    expect(jump).not.toBeNull()
    expect(jump!.gainPct).toBeGreaterThanOrEqual(CAPABILITY_JUMP_PCT)

    const plan = buildPlan(state, NOW)
    expect(plan.capabilityJump).not.toBeNull()
    expect(plan.volumeFactor).toBeLessThanOrEqual(0.85)
    // The claim it makes must be the defensible one about neural gains, not
    // the popular "tendons lag muscle by two months" overstatement.
    const text = plan.decisions.map((d) => d.text).join(' ')
    expect(text).toMatch(/nervous system|tissue/i)
  })

  it('does not fire on ordinary week-to-week progress', () => {
    const state = stateWith(
      'tuck',
      historyOf('tuck', [
        { daysAgo: 60, value: 8 },
        { daysAgo: 45, value: 8.5 },
        { daysAgo: 30, value: 9 },
        { daysAgo: 15, value: 9.5 },
        { daysAgo: 4, value: 10 },
      ]),
    )
    expect(readCapabilityJump(state, 'tuck', NOW)).toBeNull()
  })

  it('weights hold volume by how hard the position is', () => {
    // 30s of planche lean is not 30s of advanced tuck, and summing them
    // unweighted makes an athlete look like they trained less as they improve.
    const lean = weightedHoldSeconds({
      ...historyOf('lean', [{ daysAgo: 1, value: 30 }])[0],
    })
    const advTuck = weightedHoldSeconds({
      ...historyOf('advtuck', [{ daysAgo: 1, value: 10 }])[0],
    })
    expect(lean).toBeCloseTo(30 * LEVER_FRACTION['planche-lean'], 5)
    expect(advTuck).toBeCloseTo(10 * LEVER_FRACTION['adv-tuck-planche'], 5)
    // A third of the stopwatch time, but comparable real load.
    expect(advTuck / lean).toBeGreaterThan(0.5)
  })

  it('orders the lever table the same way the road does', () => {
    const ladder = ['ppp-hold', 'planche-lean', 'tuck-planche', 'adv-tuck-planche', 'straddle-planche', 'full-planche']
    for (let i = 1; i < ladder.length; i++) {
      expect(LEVER_FRACTION[ladder[i]]).toBeGreaterThan(LEVER_FRACTION[ladder[i - 1]])
    }
    expect(LEVER_FRACTION['full-planche']).toBe(1)
  })
})

describe('persistent complaint rail', () => {
  function withCheckIns(checkIns: { daysAgo: number; joints: 'good' | 'niggle' | 'pain'; regions?: BodyRegion[] }[]) {
    const sessions: Session[] = checkIns.map((c, i) => {
      const at = NOW - c.daysAgo * DAY
      return {
        id: `ci-${i}`,
        startedAt: at,
        endedAt: at + 60_000,
        workoutName: 'Session',
        workoutKind: 'auto' as const,
        stepId: 'tuck' as StepId,
        sets: [holdSet('tuck-planche', 8, at)],
        checkIn: { joints: c.joints, energy: 'ok' as const, at, ...(c.regions ? { regions: c.regions } : {}) },
      }
    })
    return stateWith('tuck', sessions)
  }

  it('notices the same region flagged again and again', () => {
    const state = withCheckIns([
      { daysAgo: 20, joints: 'niggle', regions: ['elbow'] },
      { daysAgo: 14, joints: 'niggle', regions: ['elbow'] },
      { daysAgo: 8, joints: 'niggle', regions: ['elbow'] },
      { daysAgo: 3, joints: 'niggle', regions: ['elbow'] },
    ])
    const sig = readSignals(state, NOW)
    expect(sig.persistentComplaint).not.toBeNull()
    expect(sig.persistentComplaint!.region).toBe('elbow')
    // An elbow that keeps recurring stops loaded work outright.
    const plan = buildPlan(state, NOW)
    expect(plan.loadPermission).toBe('none')
    expect(plan.decisions.map((d) => d.text).join(' ')).toMatch(/next morning|week on week|not settling|clinician/i)
  })

  it('escalates when the same region turns from niggle into pain', () => {
    const state = withCheckIns([
      { daysAgo: 24, joints: 'niggle', regions: ['wrist'] },
      { daysAgo: 18, joints: 'niggle', regions: ['wrist'] },
      { daysAgo: 10, joints: 'pain', regions: ['wrist'] },
      { daysAgo: 3, joints: 'pain', regions: ['wrist'] },
    ])
    const sig = readSignals(state, NOW)
    expect(sig.persistentComplaint?.worsening).toBe(true)
    const plan = buildPlan(state, NOW)
    expect(plan.loadPermission).toBe('none')
    expect(plan.decisions.map((d) => d.text).join(' ')).toMatch(/clinician/i)
  })

  it('stays quiet for an isolated sore day', () => {
    const state = withCheckIns([
      { daysAgo: 20, joints: 'good' },
      { daysAgo: 14, joints: 'good' },
      { daysAgo: 8, joints: 'niggle', regions: ['wrist'] },
      { daysAgo: 3, joints: 'good' },
    ])
    expect(readSignals(state, NOW).persistentComplaint).toBeNull()
  })

  it('never invents a complaint from check-ins with no region recorded', () => {
    // Legacy check-ins predate regions entirely; they must not be read as
    // "everything hurts" nor crash the rail.
    const state = withCheckIns([
      { daysAgo: 20, joints: 'niggle' },
      { daysAgo: 14, joints: 'niggle' },
      { daysAgo: 8, joints: 'pain' },
      { daysAgo: 3, joints: 'niggle' },
    ])
    expect(readSignals(state, NOW).persistentComplaint).toBeNull()
  })
})

// ————————————————————————————— Assessment —————————————————————————————

describe('assessment ladder', () => {
  it('asks the first question with no answers', () => {
    expect(nextAssessmentItem({})).not.toBeNull()
  })

  it('stops asking about harder holds once one comes back zero', () => {
    const answers: AssessmentAnswers = {
      wrist: 2,
      pushups: 12,
      hollow: 35,
      'ppp-hold': 32,
      'planche-lean': 18,
    }
    // Lean answered below its 30s bar but above start: the ladder keeps going
    // only while rungs are non-zero.
    const withZero: AssessmentAnswers = { ...answers, 'planche-lean': 0 }
    let cursor = withZero
    const asked: string[] = []
    for (let i = 0; i < 20; i++) {
      const item = nextAssessmentItem(cursor)
      if (!item) break
      asked.push(item.id)
      cursor = { ...cursor, [item.id]: item.options[0].value }
    }
    expect(asked).not.toContain('full-planche')
    expect(asked).not.toContain('straddle-planche')
    expect(asked).not.toContain('tuck-planche')
  })

  it('always terminates, for every combination of first-option answers', () => {
    let answers: AssessmentAnswers = {}
    let guard = 0
    while (guard++ < 50) {
      const item = nextAssessmentItem(answers)
      if (!item) break
      answers = { ...answers, [item.id]: item.options[item.options.length - 1].value }
    }
    expect(guard).toBeLessThan(50)
    expect(nextAssessmentItem(answers)).toBeNull()
  })

  it('reports progress that never exceeds its own total', () => {
    let answers: AssessmentAnswers = {}
    for (let i = 0; i < 20; i++) {
      const p = assessmentProgress(answers)
      expect(p.answered).toBeLessThanOrEqual(p.likelyTotal)
      const item = nextAssessmentItem(answers)
      if (!item) break
      answers = { ...answers, [item.id]: item.options[1]?.value ?? item.options[0].value }
    }
  })
})

describe('placeFromAssessment', () => {
  it('places a complete beginner at Foundations', () => {
    const p = placeFromAssessment({ wrist: 2, pushups: 3, hollow: 8, 'ppp-hold': 0 })
    expect(p.stepId).toBe('foundations')
  })

  it('places someone who owns the pseudo plank onto the lean', () => {
    const p = placeFromAssessment({
      wrist: 2,
      pushups: 12,
      hollow: 35,
      'ppp-hold': 32,
      'planche-lean': 0,
    })
    expect(p.stepId).toBe('lean')
  })

  it('places a 20s tuck planche at Advanced Tuck even with no advanced tuck time', () => {
    const p = placeFromAssessment({
      wrist: 2,
      pushups: 22,
      hollow: 50,
      'ppp-hold': 32,
      'planche-lean': 32,
      'frog-stand': 32,
      'tuck-planche': 22,
      'adv-tuck-planche': 0,
    })
    expect(p.stepId).toBe('advtuck')
  })

  it('does not strand a strong athlete at the frog stand they never learned', () => {
    // The classic false negative: real tuck planche, no hand balance.
    const p = placeFromAssessment({
      wrist: 2,
      pushups: 22,
      hollow: 50,
      'ppp-hold': 32,
      'planche-lean': 32,
      'frog-stand': 0,
      'tuck-planche': 8,
    })
    expect(p.stepId).toBe('tuck')
    expect(p.gaps.map((g) => g.id)).toContain('balance')
  })

  it('flags a contradiction rather than silently trusting it', () => {
    const p = placeFromAssessment({
      wrist: 2,
      pushups: 3,
      hollow: 8,
      'ppp-hold': 32,
      'planche-lean': 32,
      'frog-stand': 32,
      'tuck-planche': 22,
      'adv-tuck-planche': 22,
    })
    expect(p.inconsistencies.length).toBeGreaterThan(0)
    expect(p.confidence).toBe('low')
    expect(p.gaps.map((g) => g.id)).toContain('pressing')
  })

  it('raises wrist pain as a caveat and a gap', () => {
    const p = placeFromAssessment({ wrist: 0, pushups: 12, hollow: 35, 'ppp-hold': 20 })
    expect(p.gaps.map((g) => g.id)).toContain('wrist')
    expect(p.caveats.join(' ')).toMatch(/wrist/i)
  })

  it('warns a strong novice about connective tissue instead of just placing them', () => {
    const p = placeFromAssessment({
      wrist: 2,
      pushups: 22,
      hollow: 50,
      'ppp-hold': 32,
      'planche-lean': 32,
      'frog-stand': 32,
      'tuck-planche': 16,
      experience: 3,
    })
    expect(p.gaps.map((g) => g.id)).toContain('straight-arm-novice')
    expect(p.caveats.join(' ')).toMatch(/tendon|volume/i)
  })

  it('never returns a step outside the road, for any answer combination', () => {
    const values = [0, 3, 8, 16, 22, 32]
    for (const a of values) {
      for (const b of values) {
        for (const c of values) {
          const p = placeFromAssessment({
            wrist: 2,
            pushups: 12,
            hollow: 35,
            'ppp-hold': a,
            'planche-lean': b,
            'frog-stand': 18,
            'tuck-planche': c,
          })
          expect(STEP_BY_ID[p.stepId]).toBeTruthy()
          expect(p.reason.length).toBeGreaterThan(10)
          expect(p.reason).not.toMatch(/undefined|NaN|\[object/)
        }
      }
    }
  })

  it('degrades to Foundations rather than throwing on empty answers', () => {
    const p = placeFromAssessment({})
    expect(p.stepId).toBe('foundations')
    expect(p.confidence).toBe('low')
  })

  it('picks one accessory emphasis, never a list', () => {
    expect(emphasisFromGaps([])).toBe('none')
    const many = placeFromAssessment({
      wrist: 1,
      pushups: 3,
      hollow: 8,
      'ppp-hold': 32,
      'planche-lean': 32,
      'frog-stand': 0,
      'tuck-planche': 16,
    })
    expect(["pressing", "core", "balance", "none"]).toContain(emphasisFromGaps(many.gaps.map((g) => g.id)))
  })

  it('has a standard on every measured item so answers mean the same thing', () => {
    for (const item of ASSESSMENT_ITEMS) {
      expect(item.options.length).toBeGreaterThanOrEqual(2)
      expect(item.question.trim().endsWith('?')).toBe(true)
      // Measured items ascend, so "higher answer" always means "more ability"
      // and the ladder comparisons stay monotone. Multiple-choice items are
      // ordered best-first for reading, which is a different contract.
      const values = item.options.map((o) => o.value)
      const sorted = [...values].sort((x, y) => x - y)
      expect(item.unit === 'choice' ? [...sorted].reverse() : sorted).toEqual(values)
    }
  })
})
