import { describe, expect, it } from 'vitest'
import type { AppState, FormCheck, Session, SetLog, StepId } from '../types'
import { initialState } from './store'
import { readSignals } from './signals'
import { STEP_BY_ID } from '../data/progressions'
import {
  CONSISTENT_SPREAD,
  describeForecast,
  forecastUnlock,
  goalOutlook,
  measuredSeries,
  noiseReading,
  NOISY_SPREAD,
  seriesSpread,
} from './forecast'
import { diagnosePlateau, recentBreakthrough } from './plateau'
import { CAPABILITY_JUMP_PCT, readCapabilityJump } from './loading'
import { diagnose } from './diagnose'
import { buildPlan, debriefSession } from './coach'
import { skillGoalPace } from './plan/planner'
import { describeTrend, readFormTrends } from './formTrend'

/**
 * The ninth review's skill-progress numbers: every headline number refuses
 * through noise, measures from a robust level, refuses old evidence, prints
 * the kind it is, and its copy agrees with its own numbers. Each assertion is
 * the decision (a kind, a null, a number), never only the sentence.
 */

const DAY = 86_400_000
const NOW = new Date(2026, 10, 23, 12).getTime()

function form(): FormCheck {
  return { rating: 'clean', confirmed: true, flightConfirmed: true, auto: { issues: [], confidence: 0.9, cleanRatio: 1 } } as FormCheck
}
function hold(ex: string, value: number, at: number, o: Partial<SetLog> = {}): SetLog {
  return { exerciseId: ex, kind: 'hold', value, target: value, endReason: 'effort', section: 'main', at, form: form(), ...o } as SetLog
}
function hist(stepId: StepId, pts: { daysAgo: number; value: number }[], now = NOW): Session[] {
  const key = STEP_BY_ID[stepId].keyExerciseId
  return pts.map((p, i) => {
    const at = now - p.daysAgo * DAY
    return { id: `s${stepId}${i}-${p.daysAgo}`, startedAt: at, endedAt: at + 60_000, workoutName: 'S', workoutKind: 'auto', stepId, sets: [hold(key, p.value, at)] } as Session
  })
}
function st(stepId: StepId, sessions: Session[], patch: Partial<AppState> = {}): AppState {
  return { ...initialState(), onboarded: true, stepId, baseStepId: stepId, unlocked: [stepId], sessions, ...patch } as AppState
}
const days = (values: number[], first: number, every: number) => values.map((value, i) => ({ daysAgo: first - i * every, value }))

/** The reviewer's scenario: eight alternating verified tuck holds. */
const NOISY = st('tuck', hist('tuck', days([6, 13, 7, 14, 8, 15, 9, 16], 30, 4)))

describe('one evidence gate for the headline numbers', () => {
  it('the alternating holds are noise to the signals, and to the forecast, the breakthrough and Progress alike', () => {
    const sig = readSignals(NOISY, NOW)
    expect(sig.noisy).toBe(true)
    const f = forecastUnlock(NOISY, 'tuck', NOW)
    expect(f.kind).toBe('noisy')
    expect(forecastUnlock(NOISY, 'tuck', NOW, sig).kind).toBe('noisy')
    // Without the gate this compares 13s typical holds with a 6s month-old one and celebrates.
    expect(recentBreakthrough(NOISY, 'tuck', NOW)).toBeNull()
    expect(recentBreakthrough(NOISY, 'tuck', NOW, sig)).toBeNull()
    const d = diagnose(NOISY, NOW)
    expect(d.status).toBe('noisy')
    expect(d.gainPerWeek).toBeNull()
    // Same words on both screens: the forecast's refusal is Progress's summary.
    if (f.kind !== 'noisy') throw new Error('unreachable')
    expect(d.summary.startsWith(f.basis)).toBe(true)
    expect(f.variability).toBeCloseTo(sig.variability ?? 0, 5)
  })

  it('a jump read through noise holds nothing: no jump, no volume hold', () => {
    // 12, 6, 12, 6, 6 then 13: the level before reads 6, so the last hold is a 117% "jump".
    const s = st('tuck', hist('tuck', [...days([12, 6, 12, 6], 40, 7), { daysAgo: 10, value: 6 }, { daysAgo: 4, value: 13 }]))
    expect(noiseReading(s, 'tuck', NOW).noisy).toBe(true)
    expect(readCapabilityJump(s, 'tuck', NOW)).toBeNull()
    expect(buildPlan(s, NOW).capabilityJump).toBeNull()
    // The same jump out of steady holds still holds volume (v2.test keeps the coach's side).
    const steady = st('tuck', hist('tuck', [...days([6, 6.5, 6, 6.5], 60, 13), { daysAgo: 5, value: 11 }]))
    expect(noiseReading(steady, 'tuck', NOW).noisy).toBe(false)
    expect(readCapabilityJump(steady, 'tuck', NOW)!.gainPct).toBeGreaterThanOrEqual(CAPABILITY_JUMP_PCT)
  })

  it('"Good confidence" needs the holds to sit close to their trend', () => {
    // Twelve holds over 44 days, 8 → 12s: steady, and the same climb with ±1.3s of swing.
    const climb = Array.from({ length: 12 }, (_, i) => 8 + (4 * i) / 11)
    const clean = st('tuck', hist('tuck', days(climb, 46, 4)))
    const swung = st('tuck', hist('tuck', days(climb.map((v, i) => v + (i % 2 ? 1.3 : -1.3)), 46, 4)))
    const spread = seriesSpread(measuredSeries(swung, 'tuck'))!
    expect(spread).toBeGreaterThan(CONSISTENT_SPREAD)
    expect(spread).toBeLessThanOrEqual(NOISY_SPREAD)
    const a = forecastUnlock(clean, 'tuck', NOW)
    const b = forecastUnlock(swung, 'tuck', NOW)
    expect(a.kind === 'range' && a.confidence).toBe('good')
    expect(b.kind).toBe('range')
    expect(b.kind === 'range' && b.confidence).not.toBe('good')
  })

  it("the noise bar is the signals' own", () => {
    // Verified holds only, so the signals read the same points the forecast does.
    let agreed = 0
    const seen = new Set<boolean>()
    for (let seed = 1; seed <= 24; seed++) {
      let x = seed * 7919
      const rnd = () => ((x = (x * 48271) % 2147483647) / 2147483647)
      const amp = 0.5 + (seed % 6)
      const values = Array.from({ length: 8 }, (_, i) => Math.max(1, 8 + i * 0.4 + (rnd() - 0.5) * 2 * amp))
      const s = st('tuck', hist('tuck', days(values.map((v) => Math.round(v * 10) / 10), 34, 4)))
      const own = seriesSpread(measuredSeries(s, 'tuck'))
      expect(readSignals(s, NOW).noisy, `seed ${seed}`).toBe(own !== null && own > NOISY_SPREAD)
      seen.add(own !== null && own > NOISY_SPREAD)
      agreed++
    }
    expect(agreed).toBe(24)
    // Both sides of the bar were exercised, or the agreement proves nothing.
    expect(seen.size).toBe(2)
  })
})

describe('one lucky hold cannot swing the forecast', () => {
  const base = [
    { daysAgo: 35, value: 8 }, { daysAgo: 31, value: 8.5 }, { daysAgo: 28, value: 9 }, { daysAgo: 24, value: 9 },
    { daysAgo: 21, value: 9.5 }, { daysAgo: 17, value: 10 }, { daysAgo: 14, value: 10 }, { daysAgo: 10, value: 10.5 },
    { daysAgo: 7, value: 11 }, { daysAgo: 3, value: 11 },
  ]
  it('a 19s hold beside a steady 8 → 11s climb leaves the range where it was', () => {
    const bar = STEP_BY_ID.tuck.unlockSec
    const lucky = [...base.slice(0, 5), { daysAgo: 19, value: bar - 1 }, ...base.slice(5)]
    const a = forecastUnlock(st('tuck', hist('tuck', base)), 'tuck', NOW)
    const b = forecastUnlock(st('tuck', hist('tuck', lucky)), 'tuck', NOW)
    if (a.kind !== 'range' || b.kind !== 'range') throw new Error(`expected ranges, got ${a.kind} / ${b.kind}`)
    expect(a.lowWeeks).toBeGreaterThanOrEqual(8)
    expect(Math.abs(b.lowWeeks - a.lowWeeks)).toBeLessThanOrEqual(2)
    expect(b.lowWeeks).toBeGreaterThanOrEqual(8)
  })
})

describe('old evidence is not a pace', () => {
  const layoff = st('tuck', hist('tuck', Array.from({ length: 12 }, (_, i) => ({ daysAgo: 240 - i * 5, value: 6 + i * 0.7 }))))
  it('six months off: the forecast refuses and says how old the evidence is; Progress quotes no pace', () => {
    const f = forecastUnlock(layoff, 'tuck', NOW)
    expect(f.kind).toBe('insufficient')
    expect(f.kind === 'insufficient' && f.staleDays).toBeGreaterThan(150)
    const d = diagnose(layoff, NOW)
    expect(d.gainPerWeek).toBeNull()
    expect(d.status).not.toBe('progressing')
  })

  it('a plateau counts trained weeks, not the months off after it', () => {
    const flat = st('tuck', hist('tuck', Array.from({ length: 10 }, (_, i) => ({ daysAgo: 230 - i * 4, value: 10 + (i % 3) * 0.3 }))))
    const v = diagnosePlateau(flat, readSignals(flat, NOW), NOW)
    expect(v).not.toBeNull()
    // Five flat weeks and a fortnight's grace, never ~31.
    expect(v!.weeksFlat).toBeLessThanOrEqual(8)
    expect(v!.weeksFlat).toBeGreaterThanOrEqual(2)
  })

  it('a breakthrough compares with a reference from the last twelve weeks, and says how far back', () => {
    const stale = [
      ...Array.from({ length: 10 }, (_, i) => ({ daysAgo: 230 - i * 4, value: 7 + (i % 3) * 0.3 })),
      { daysAgo: 20, value: 9 }, { daysAgo: 12, value: 10 }, { daysAgo: 5, value: 10.5 },
    ]
    expect(recentBreakthrough(st('tuck', hist('tuck', stale)), 'tuck', NOW)).toBeNull()
    const fresh = st('tuck', hist('tuck', [...days([7, 7, 7, 7], 60, 4), ...days([10, 10.5, 11], 20, 7)]))
    expect(noiseReading(fresh, 'tuck', NOW).noisy).toBe(false)
    const b = recentBreakthrough(fresh, 'tuck', NOW)
    expect(b).not.toBeNull()
    // The reference sits about eight weeks back (days 60–48), not "a month".
    expect(b!.weeks).toBe(8)
    expect(b!.gainSec).toBe(3.5)
  })
})

describe('the display is the kind the forecast is', () => {
  it('a range always has two edges, so it is never printed as a single week', () => {
    // A fast steady climb close to the bar: both edges once rounded to the same week.
    for (const step of [1.2, 1.4, 1.6, 2]) {
      const s = st('tuck', hist('tuck', days(Array.from({ length: 8 }, (_, i) => 20 - 3.2 - (7 - i) * step * (5 / 7)), 36, 5)))
      const f = forecastUnlock(s, 'tuck', NOW)
      if (f.kind !== 'range') continue
      expect(f.highWeeks === null || f.highWeeks > f.lowWeeks, `${step}`).toBe(true)
      expect(describeForecast(f)).toMatch(/–|\+/)
    }
    const s = st('tuck', hist('tuck', days(Array.from({ length: 8 }, (_, i) => 20 - 3.2 - (7 - i) * 1.4 * (5 / 7)), 36, 5)))
    expect(forecastUnlock(s, 'tuck', NOW).kind).toBe('range')
  })

  it('a dated goal at the step being trained is reached, as Home says', () => {
    const unlocked = ['foundations', 'lean', 'frog', 'tuck', 'advtuck'] as StepId[]
    const s = st('advtuck', hist('advtuck', days(Array.from({ length: 8 }, (_, i) => 8 + i * 0.8), 50, 6)), { unlocked })
    const withGoal = { ...s, profile: { ...s.profile, goalStepId: 'advtuck' as StepId } }
    expect(skillGoalPace(withGoal, { id: 'g', skill: 'planche', stepId: 'advtuck', by: '2026-12-31' }, NOW).status).toBe('reached')
    expect(goalOutlook(withGoal, NOW).stepsRemaining).toBe(0)
  })

  it('weeks left are rounded one way in every goal-pace sentence', () => {
    // 38.5 days left: 5.5 weeks — "5", whether the pace is known or not.
    const s = st('tuck', hist('tuck', days([8, 8.5], 10, 5)), { unlocked: ['foundations', 'lean', 'frog', 'tuck'] as StepId[] })
    const pace = skillGoalPace(s, { id: 'g', skill: 'planche', stepId: 'advtuck', by: '2026-12-31' }, NOW)
    expect(pace.status).toBe('unknown')
    expect(pace.text).toMatch(/whether 5 weeks are enough/)
  })
})

describe('copy that agrees with its own numbers', () => {
  function filmed(daysAgo: number, auto: Record<string, unknown>): Session {
    const at = NOW - daysAgo * DAY
    const set = { exerciseId: 'tuck-planche', kind: 'hold', value: 8, target: 8, endReason: 'effort', section: 'main', at,
      form: { rating: 'clean', confirmed: true, auto: { issues: [], confidence: 0.9, cleanRatio: 1, score: 80, ...auto } } } as SetLog
    return { id: 'f' + daysAgo, startedAt: at, endedAt: at + 60_000, workoutName: 'S', workoutKind: 'auto', stepId: 'tuck', sets: [set] } as Session
  }

  it('a form trend quotes its robust line and says up only when the number went up', () => {
    const elbows = [160, 162, 165, 167, 170, 140]
    const line = [0.2, 0.17, 0.14, 0.1, 0.08, 0.05]
    const when = [35, 29, 22, 15, 8, 1]
    const sessions = when.map((d, i) => filmed(d, { elbowDeg: elbows[i], hipOffset: line[i], leanRatio: 0.3 + i * 0.01 }))
    const r = readFormTrends({ sessions }, 'tuck-planche', NOW)
    if (r.kind !== 'trends') throw new Error('expected trends')
    const elbow = r.trends.find((t) => t.points.some((p) => p.value === 140))
    expect(elbow).toBeDefined()
    // One bad last frame is not the endpoint quoted.
    expect(elbow!.latest).toBeGreaterThan(elbow!.earliest)
    expect(elbow!.latest).toBeGreaterThan(165)
    for (const t of r.trends) {
      if (t.direction === 'steady') continue
      expect(describeTrend(t).includes('That is up'), t.label).toBe(t.latest > t.earliest)
      expect(describeTrend(t).includes('That is down'), t.label).toBe(t.latest < t.earliest)
    }
  })

  const key = STEP_BY_ID.tuck.keyExerciseId
  function maxTest(record: number, sets: SetLog[]) {
    const prev = { ...initialState(), onboarded: true, stepId: 'tuck', baseStepId: 'tuck', unlocked: ['foundations', 'lean', 'frog', 'tuck'],
      prs: { [key]: { value: record, at: NOW - 30 * DAY } } } as unknown as AppState
    const at = NOW - DAY
    const session = { id: 't1', startedAt: at, endedAt: at + 900_000, workoutName: 'Max test', workoutKind: 'test', stepId: 'tuck', sets } as Session
    return debriefSession(prev, { ...prev, sessions: [session] } as AppState, session).map((d) => d.text).join(' ')
  }
  const unrated = (value: number, section: SetLog['section'], i: number) =>
    ({ exerciseId: key, kind: 'hold', value, section, at: NOW - DAY + i, endReason: 'effort' }) as SetLog

  it('a max test is called a PR only when it beat the record, read from the test holds alone', () => {
    expect(maxTest(18, [unrated(12, 'main', 0), unrated(11, 'main', 1)])).not.toMatch(/\bPR\b/)
    expect(maxTest(10, [unrated(12, 'main', 0)])).toMatch(/\bPR\b/)
    // A long warm-up primer is neither the timer best nor a record.
    const text = maxTest(18, [unrated(25, 'warmup', 0), unrated(12, 'main', 1)])
    expect(text).toMatch(/Timer best 12s/)
    expect(text).not.toMatch(/\bPR\b/)
  })

  it('a left/right gap compares one exercise, main section, with itself', () => {
    const prev = { ...initialState(), onboarded: true } as AppState
    const at = NOW - DAY
    const sets = [
      { exerciseId: 'flag-tuck', kind: 'hold', value: 5, section: 'main', side: 'left', at },
      { exerciseId: 'flag-tuck', kind: 'hold', value: 8, section: 'main', side: 'right', at: at + 1 },
      { exerciseId: 'sleeper-stretch', kind: 'hold', value: 30, section: 'cooldown', side: 'left', at: at + 2 },
      { exerciseId: 'sleeper-stretch', kind: 'hold', value: 30, section: 'cooldown', side: 'right', at: at + 3 },
      { exerciseId: 'side-plank', kind: 'hold', value: 30, section: 'strength', side: 'left', at: at + 4 },
    ] as SetLog[]
    const session = { id: 'x', startedAt: at, endedAt: at + 900_000, workoutName: 'S', workoutKind: 'auto', stepId: 'tuck', sets } as Session
    const lines = debriefSession(prev, { ...prev, sessions: [session] } as AppState, session).map((d) => d.text)
    const gap = lines.find((t) => /side trailed/.test(t))
    expect(gap).toMatch(/left side trailed/)
    expect(gap).toMatch(/5s vs 8s/)
    // Sides that differ only outside the main work say nothing.
    const quiet = { ...session, sets: sets.slice(2).map((x, i) => (i === 0 ? { ...x, value: 15 } : x)) } as Session
    expect(debriefSession(prev, { ...prev, sessions: [quiet] } as AppState, quiet).some((d) => /side trailed/.test(d.text))).toBe(false)
  })

  it('the bodyweight card waits for an athlete the app treats as adult', () => {
    const sessions = Array.from({ length: 8 }, (_, i) => {
      const at = NOW - (40 - i * 5) * DAY
      return { id: 'w' + i, startedAt: at, endedAt: at + 1_800_000, workoutName: 'S', workoutKind: 'auto', stepId: 'tuck',
        sets: [{ exerciseId: key, kind: 'hold', value: 8 + i * 0.5, target: 8, section: 'main', at, endReason: 'effort' } as SetLog] } as Session
    })
    const measurements = Array.from({ length: 8 }, (_, i) => ({ id: 'm' + i, at: NOW - (49 - i * 7) * DAY, weightKg: 55 + i * 0.35 }))
    const card = (birthYear: number | undefined) => {
      const s = initialState()
      const state = { ...s, onboarded: true, stepId: 'tuck', baseStepId: 'tuck', unlocked: ['foundations', 'lean', 'frog', 'tuck'], sessions, measurements,
        profile: { ...s.profile, birthYear } } as unknown as AppState
      return diagnose(state, NOW).causes.some((c) => c.id === 'weight')
    }
    expect(card(1995)).toBe(true)
    // 2008 may still be 17 in 2026; unknown age is treated as under 18.
    expect(card(2008)).toBe(false)
    expect(card(undefined)).toBe(false)
    expect(card(2012)).toBe(false)
  })

  it('the capability jump says what was measured, not that tissue lags', () => {
    const steady = st('tuck', hist('tuck', [...days([6, 6.5, 6, 6.5], 60, 13), { daysAgo: 5, value: 11 }]))
    const plan = buildPlan(steady, NOW)
    expect(plan.capabilityJump).not.toBeNull()
    expect(plan.volumeFactor).toBeLessThanOrEqual(0.85)
    const text = plan.decisions.map((d) => d.text).join(' ')
    expect(text).not.toMatch(/caught up|structures carrying/i)
  })
})

describe('the goal outlook reads the skill’s own road', () => {
  const climb = (stepId: StepId, n: number, first: number, every: number, from: number, per: number) =>
    hist(stepId, Array.from({ length: n }, (_, i) => ({ daysAgo: first - i * every, value: from + i * per })))

  it('a front-lever athlete with two finished steps gets an estimate', () => {
    const sessions = [...climb('fl-tuck', 6, 100, 5, 8, 0.6), ...climb('fl-advtuck', 6, 70, 5, 6, 0.6), ...climb('fl-oneleg', 6, 40, 5, 5, 0.5)]
    const view = st('fl-oneleg', sessions, { baseStepId: 'fl-tuck', unlocked: ['fl-hang', 'fl-tuck', 'fl-advtuck', 'fl-oneleg'] as StepId[] })
    const o = goalOutlook({ ...view, profile: { ...view.profile, goalStepId: 'fl-full' as StepId } }, NOW)
    expect(o.goalStepId).toBe('fl-full')
    expect(o.stepsRemaining).toBe(2)
    expect(o.estimate).not.toBeNull()
    expect(o.estimate!.measuredFrom).toBe(2)
    // A planche goal is not this road's: the skill's own default stands in.
    expect(goalOutlook({ ...view, profile: { ...view.profile, goalStepId: 'straddle' as StepId } }, NOW).goalStepId).toBe('fl-full')
  })

  it('with nothing to measure it counts steps and quotes no timeline', () => {
    const o = goalOutlook(st('tuck', hist('tuck', days([8, 9], 10, 5))), NOW)
    expect(o.estimate).toBeNull()
    expect(o.note).not.toMatch(/years rather than months/)
  })
})
