import { describe, expect, it } from 'vitest'
import type { AppState, FormCheck, Session, SetLog } from '../types'
import { STEP_BY_ID } from '../data/progressions'
import { initialState } from './store'
import { debriefSession } from './coach'
import { splitRecords } from './sessionSummary'

/**
 * Four main holds of 5.8s on the timer each counted 0.8s after the assumed 5s
 * walk-back; the summary showed "NEW RECORDS Advanced Tuck Planche 0.8s" and
 * the coach said "keep stacking sessions like this one". Asserted by kind and
 * by what is said about the number, not by wording alone.
 */
const KEY = STEP_BY_ID['advtuck'].keyExerciseId
const AT = Date.UTC(2026, 10, 20, 12)
const clean: FormCheck = { rating: 'clean', confirmed: true, auto: { issues: [], confidence: 0.9, cleanRatio: 1 } }
const make = (value: number, target: number, rated: boolean): Session => {
  const sets: SetLog[] = [0, 1, 2, 3].map((i) => ({
    exerciseId: KEY, kind: 'hold', value, target, endReason: 'effort', section: 'main', at: AT + i * 1000, ...(rated ? { form: clean } : {}),
  }))
  return { id: 's', startedAt: AT, endedAt: AT + 60_000, workoutName: 'x', workoutKind: 'auto', stepId: 'advtuck', sets }
}
const state = (): AppState => ({ ...initialState(), onboarded: true, stepId: 'advtuck', baseStepId: 'advtuck', unlocked: ['tuck', 'advtuck'] })
const say = (s: Session) => debriefSession(state(), state(), s)

describe('a near-zero hold is not praised', () => {
  for (const rated of [false, true]) {
    it(`far under its target (${rated ? 'rated' : 'unrated'}) is a low reading, not "keep stacking"`, () => {
      const out = say(make(0.8, 6, rated))
      const text = out.map((d) => d.text).join(' ')
      expect(text).not.toMatch(/Keep stacking/)
      expect(text).not.toMatch(/PR/)
      expect(out.some((d) => d.kind === 'good')).toBe(false)
      expect(text).toMatch(/0\.8s/)
      expect(text).toMatch(/6s/)
    })
  }
  it('a hold near its target is still met with the good line (the control)', () => {
    const out = say(make(5.5, 6, true))
    expect(out.some((d) => d.kind === 'good')).toBe(true)
  })
})

describe('the first hold ever logged is not a beaten record', () => {
  it('splits first holds from records by whether there was anything to beat', () => {
    const { records, firsts } = splitRecords([
      { exerciseId: 'a', value: 0.8 },
      { exerciseId: 'b', value: 12, previous: 10 },
    ])
    expect(firsts.map((p) => p.exerciseId)).toEqual(['a'])
    expect(records.map((p) => p.exerciseId)).toEqual(['b'])
  })
})
