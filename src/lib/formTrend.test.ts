import { describe, expect, it } from 'vitest'
import type { AppState, AutoForm, Session, SetLog } from '../types'
import { initialState } from './store'
import { MATERIAL_TOLERANCE } from './poseForm'
import {
  MIN_TREND_POINTS,
  MIN_TREND_SPAN_DAYS,
  describeTrend,
  filmedExercises,
  formatCriterionValue,
  readFormTrends,
} from './formTrend'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 7, 5)

function filmedSet(exerciseId: string, at: number, auto: Partial<AutoForm>): SetLog {
  return {
    exerciseId,
    kind: 'hold',
    value: 10,
    target: 10,
    section: 'main',
    at,
    form: {
      rating: 'clean',
      confirmed: true,
      auto: { issues: [], confidence: 0.9, ...auto },
    },
  }
}

function stateOf(sets: SetLog[]): AppState {
  const sessions: Session[] = sets.map((s, i) => ({
    id: `s${i}`,
    startedAt: s.at,
    endedAt: s.at + 60_000,
    workoutName: 'Session',
    workoutKind: 'auto',
    stepId: 'tuck',
    sets: [s],
  }))
  return { ...initialState(), onboarded: true, sessions }
}

/** n filmed sets of one exercise, spaced a week apart, with a per-index reading. */
function series(exerciseId: string, n: number, auto: (i: number) => Partial<AutoForm>): SetLog[] {
  return Array.from({ length: n }, (_, i) => filmedSet(exerciseId, NOW - (n - 1 - i) * 7 * DAY, auto(i)))
}

describe('readFormTrends — refusing before reporting', () => {
  it('refuses below the minimum number of filmed sets', () => {
    const r = readFormTrends(stateOf(series('planche-lean', 3, () => ({ elbowDeg: 178 }))), 'planche-lean', NOW)
    expect(r.kind).toBe('insufficient')
    if (r.kind === 'insufficient') expect(r.need).toContain(`${MIN_TREND_POINTS}`)
  })

  it('refuses when plenty of sets are crammed into a few days', () => {
    const sets = Array.from({ length: 8 }, (_, i) =>
      filmedSet('planche-lean', NOW - i * DAY, { elbowDeg: 170 + i }),
    )
    const r = readFormTrends(stateOf(sets), 'planche-lean', NOW)
    expect(r.kind).toBe('insufficient')
    if (r.kind === 'insufficient') expect(r.need).toContain(`${MIN_TREND_SPAN_DAYS}`)
  })

  it('ignores clips the judge had no confidence in', () => {
    const sets = series('planche-lean', 8, () => ({ elbowDeg: 178, confidence: 0.1 }))
    const r = readFormTrends(stateOf(sets), 'planche-lean', NOW)
    expect(r.kind).toBe('insufficient')
    if (r.kind === 'insufficient') expect(r.filmedSets).toBe(0)
  })

  it('says so when nothing was seen often enough, rather than showing an empty card', () => {
    // Filmed plenty, but every criterion out of shot every time.
    const sets = series('planche-lean', 8, () => ({
      unseen: ['elbows', 'forward lean', 'body line', 'shoulder-to-ear line', 'knees'],
    }))
    const r = readFormTrends(stateOf(sets), 'planche-lean', NOW)
    expect(r.kind).toBe('insufficient')
    if (r.kind === 'insufficient') {
      expect(r.filmedSets).toBe(8)
      expect(r.need).toMatch(/framing/i)
    }
  })
})

describe('readFormTrends — the unseen rule', () => {
  it('excludes sets where the camera could not see that criterion', () => {
    // Elbows visible in 4 of 8; lean visible in all 8.
    const sets = series('planche-lean', 8, (i) => ({
      elbowDeg: 170 + i,
      leanRatio: 0.4 + i * 0.02,
      ...(i % 2 === 0 ? { unseen: ['elbows'] } : {}),
    }))
    const r = readFormTrends(stateOf(sets), 'planche-lean', NOW)
    expect(r.kind).toBe('trends')
    if (r.kind !== 'trends') return
    const elbow = r.trends.find((t) => t.criterion === 'elbow')!
    const lean = r.trends.find((t) => t.criterion === 'lean')!
    expect(elbow.seen).toBe(4)
    expect(elbow.unseen).toBe(4)
    expect(lean.seen).toBe(8)
    expect(lean.unseen).toBe(0)
    // Thin coverage costs confidence rather than being hidden.
    expect(elbow.confidence).not.toBe('good')
  })

  it('never plots a value the judge listed as unseen, even if the field is populated', () => {
    // The stored number exists but the judge said it did not see it — the
    // trend must not quietly use it anyway.
    const sets = series('planche-lean', 8, (i) => ({
      elbowDeg: 120 + i, // nonsense reading
      leanRatio: 0.5,
      unseen: ['elbows'],
    }))
    const r = readFormTrends(stateOf(sets), 'planche-lean', NOW)
    if (r.kind !== 'trends') return
    expect(r.trends.some((t) => t.criterion === 'elbow')).toBe(false)
    expect(r.skipped.some((s) => /Elbow/.test(s.label))).toBe(true)
  })
})

describe('readFormTrends — direction and deadband', () => {
  it('calls a real improvement improving', () => {
    // Elbow climbing well past the 8° tolerance across the window.
    const sets = series('planche-lean', 8, (i) => ({ elbowDeg: 160 + i * 2.5 }))
    const r = readFormTrends(stateOf(sets), 'planche-lean', NOW)
    if (r.kind !== 'trends') return
    const elbow = r.trends.find((t) => t.criterion === 'elbow')!
    expect(elbow.direction).toBe('improving')
    expect(elbow.latest).toBeGreaterThan(elbow.earliest)
    expect(describeTrend(elbow)).toMatch(/direction you want/i)
  })

  it('calls a real regression declining, and says which way is better', () => {
    const sets = series('planche-lean', 8, (i) => ({ elbowDeg: 180 - i * 2.5 }))
    const r = readFormTrends(stateOf(sets), 'planche-lean', NOW)
    if (r.kind !== 'trends') return
    const elbow = r.trends.find((t) => t.criterion === 'elbow')!
    expect(elbow.direction).toBe('declining')
    expect(describeTrend(elbow)).toMatch(/wrong way/i)
    expect(describeTrend(elbow)).toMatch(/180°|locked/i)
  })

  it('will not call a change smaller than the camera error a trend', () => {
    // Total drift of ~4°, under the measured 8° elbow tolerance.
    const sets = series('planche-lean', 8, (i) => ({ elbowDeg: 174 + i * 0.5 }))
    const r = readFormTrends(stateOf(sets), 'planche-lean', NOW)
    if (r.kind !== 'trends') return
    const elbow = r.trends.find((t) => t.criterion === 'elbow')!
    expect(Math.abs(elbow.latest - elbow.earliest)).toBeLessThan(MATERIAL_TOLERANCE.elbowDeg)
    expect(elbow.direction).toBe('steady')
    expect(describeTrend(elbow)).toMatch(/its own error/i)
  })

  it('knows that a smaller body-line offset is better, not worse', () => {
    // hipOffset falling = hips getting level = improving.
    const sets = series('tuck-planche', 8, (i) => ({ hipOffset: 0.4 - i * 0.03 }))
    const r = readFormTrends(stateOf(sets), 'tuck-planche', NOW)
    if (r.kind !== 'trends') return
    const line = r.trends.find((t) => t.criterion === 'line')!
    expect(line.higherIsBetter).toBe(false)
    expect(line.latest).toBeLessThan(line.earliest)
    expect(line.direction).toBe('improving')
  })

  it('knows that a smaller shoulder-to-ear gap means more shrug, not less', () => {
    const sets = series('tuck-planche', 8, (i) => ({ shrugRatio: 0.45 - i * 0.03 }))
    const r = readFormTrends(stateOf(sets), 'tuck-planche', NOW)
    if (r.kind !== 'trends') return
    const shrug = r.trends.find((t) => t.criterion === 'shrug')!
    expect(shrug.direction).toBe('declining')
  })

  it('is not flipped by one hallucinated frame, even at the end of the series', () => {
    // The hard case: the outlier is the most recent point, so a naive
    // first-to-last slope reads the whole trend as collapsing. A median of
    // pairwise slopes still sees the eight climbing sets underneath it.
    // (BlazePose does produce confident nonsense on cropped bodies — this is a
    // documented model limitation, not a hypothetical.)
    const sets = series('planche-lean', 9, (i) => ({ elbowDeg: i === 8 ? 90 : 160 + i * 2.5 }))
    const r = readFormTrends(stateOf(sets), 'planche-lean', NOW)
    if (r.kind !== 'trends') return
    const elbow = r.trends.find((t) => t.criterion === 'elbow')!
    expect(elbow.changePerWeek).toBeGreaterThan(0)
    expect(elbow.direction).toBe('improving')

    // And a mid-series outlier is equally survivable.
    const mid = series('planche-lean', 9, (i) => ({ elbowDeg: i === 4 ? 90 : 160 + i * 2.5 }))
    const rm = readFormTrends(stateOf(mid), 'planche-lean', NOW)
    if (rm.kind !== 'trends') return
    expect(rm.trends.find((t) => t.criterion === 'elbow')!.direction).toBe('improving')
  })
})

describe('readFormTrends — presentation contract', () => {
  it('puts a declining criterion above the improving ones', () => {
    const sets = series('tuck-planche', 8, (i) => ({
      elbowDeg: 180 - i * 2.5, // declining
      leanRatio: 0.3 + i * 0.05, // improving
    }))
    const r = readFormTrends(stateOf(sets), 'tuck-planche', NOW)
    if (r.kind !== 'trends') return
    expect(r.trends[0].direction).toBe('declining')
  })

  it('keeps every trend free of placeholders and unreadable numbers', () => {
    const sets = series('tuck-planche', 10, (i) => ({
      elbowDeg: 165 + i,
      leanRatio: 0.3 + i * 0.02,
      hipOffset: 0.3 - i * 0.01,
      shrugRatio: 0.3 + i * 0.01,
      kneeDeg: 150 + i * 2,
      score: 60 + i * 2,
      cleanRatio: 0.5 + i * 0.04,
    }))
    const r = readFormTrends(stateOf(sets), 'tuck-planche', NOW)
    if (r.kind !== 'trends') return
    expect(r.trends.length).toBeGreaterThanOrEqual(5)
    for (const t of r.trends) {
      expect(Number.isFinite(t.changePerWeek)).toBe(true)
      expect(describeTrend(t)).not.toMatch(/NaN|undefined|Infinity|\[object/)
      expect(formatCriterionValue(t.latest, t.unit)).not.toMatch(/NaN|undefined/)
      expect(t.seen).toBeGreaterThanOrEqual(MIN_TREND_POINTS)
    }
  })

  it('does not mix two exercises into one trend', () => {
    const lean = series('planche-lean', 8, () => ({ elbowDeg: 178 }))
    const tuck = series('tuck-planche', 8, () => ({ elbowDeg: 140 }))
    const r = readFormTrends(stateOf([...lean, ...tuck]), 'planche-lean', NOW)
    if (r.kind !== 'trends') return
    const elbow = r.trends.find((t) => t.criterion === 'elbow')!
    // Only the lean's eight sets, none of the tuck's much lower readings.
    expect(elbow.seen).toBe(8)
    expect(elbow.earliest).toBe(178)
    expect(elbow.latest).toBe(178)
  })

  it('formats each unit the way an athlete reads it', () => {
    expect(formatCriterionValue(178.4, 'deg')).toBe('178°')
    expect(formatCriterionValue(0.62, 'percent')).toBe('62%')
    expect(formatCriterionValue(0.415, 'ratio')).toBe('0.41')
    expect(formatCriterionValue(83.6, 'points')).toBe('84')
  })
})

describe('filmedExercises', () => {
  it('lists only exercises with camera-checked sets, most recent first', () => {
    const sets = [
      // Lean's most recent set is a day older than the tuck's, so "most
      // recent first" is actually being tested rather than insertion order.
      ...series('planche-lean', 4, () => ({ elbowDeg: 178 })).map((s) => ({ ...s, at: s.at - DAY })),
      filmedSet('tuck-planche', NOW, { elbowDeg: 150 }),
      // Unfilmed set of a third exercise must not appear.
      { exerciseId: 'pppu', kind: 'reps' as const, value: 6, target: 6, section: 'strength' as const, at: NOW },
    ]
    const list = filmedExercises(stateOf(sets))
    expect(list[0]).toBe('tuck-planche')
    expect(list).toContain('planche-lean')
    expect(list).not.toContain('pppu')
  })

  it('returns nothing for an athlete who has never filmed', () => {
    expect(filmedExercises(stateOf([]))).toEqual([])
  })
})
