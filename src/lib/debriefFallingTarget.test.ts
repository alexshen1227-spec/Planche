import { describe, expect, it } from 'vitest'
import type { AppState, Session, SetLog } from '../types'
import { STEP_BY_ID } from '../data/progressions'
import { initialState } from './store'
import { debriefSession } from './coach'
import { workingTargetSec } from './workingTarget'
import { adaptiveTarget } from './workingTarget'

/**
 * A target that falls after a hold that beat it must say why — and the reason
 * is read from the same functions the target is (`toldHold`, `settled`,
 * `workingTarget`), not guessed. The case from the review: placed at about
 * 18 s, given an 11 s target, held 14.7 s, and told "it follows your recent
 * holds".
 */

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 16, 12)
const KEY = STEP_BY_ID.lean.keyExerciseId

const base = (told?: number): AppState => ({
  ...initialState(),
  onboarded: true,
  stepId: 'lean',
  baseStepId: 'lean',
  ...(told !== undefined ? { assessment: { at: NOW - 3 * DAY, answers: { [KEY]: told }, placedStepId: 'lean', confidence: 'moderate' as const, gapIds: [] } } : {}),
})

const hold = (value: number, target: number, at: number): SetLog => ({ exerciseId: KEY, kind: 'hold', value, target, endReason: 'effort', section: 'main', at })

function sessionAt(id: string, daysAgo: number, value: number, target: number): Session {
  const at = NOW - daysAgo * DAY
  return { id, startedAt: at, endedAt: at + 60_000, workoutName: 'Lean', workoutKind: 'auto', stepId: 'lean', baseTargetSec: target, sets: [hold(value, target, at)] }
}

/** The line the athlete reads about the target, for a session applied to a state. */
function targetLine(prev: AppState, session: Session): { before: number; after: number; text: string | undefined } {
  const next = { ...prev, sessions: [...prev.sessions, session] }
  const before = workingTargetSec(prev, 'lean', 1, NOW)
  const after = workingTargetSec(next, 'lean', 1, NOW)
  const text = debriefSession(prev, next, session, { before, after }).find((d) => d.text.startsWith('Working target moves'))?.text
  return { before, after, text }
}

describe('a falling target names its real reason', () => {
  const first = sessionAt('s1', 0, 14.7, 11)

  it('the review case: told 18, given 11, held 14.7 — the target falls, and the line says the setup answer is why', () => {
    const r = targetLine(base(18), first)
    expect(r.before).toBe(11)
    expect(r.after).toBeLessThan(r.before)
    expect(r.text).toBeDefined()
    // The reason is the setup answer standing beside the log, quoting the real numbers.
    expect(r.text).toContain('beat the 11s target')
    expect(r.text).toContain('the 18s you gave at setup')
    expect(r.text).toContain(`near ${r.after}s`)
    expect(r.text).not.toContain('it follows your recent holds')
  })

  it('once the step is settled (three sessions, one measured) the setup answer is not blamed', () => {
    const prev: AppState = { ...base(18), sessions: [sessionAt('a', 9, 15, 11), sessionAt('b', 6, 14, 11)] }
    const third = sessionAt('c', 0, 12, 11)
    const next = { ...prev, sessions: [...prev.sessions, third] }
    const text = debriefSession(prev, next, third, { before: 11, after: 9 }).find((d) => d.text.startsWith('Working target moves'))?.text
    expect(text).toBeDefined()
    expect(text).not.toContain('you gave at setup')
  })

  it('a hold above the setup answer is not blamed on it', () => {
    // A fall the setup answer cannot explain (forced: the blend never falls here by itself).
    const s = sessionAt('s1', 0, 14.7, 11)
    const prev = base(12)
    const text = debriefSession(prev, { ...prev, sessions: [s] }, s, { before: 11, after: 10 }).find((d) => d.text.startsWith('Working target moves'))?.text
    expect(text).toBeDefined()
    expect(text).not.toContain('you gave at setup')
  })

  it('a hold under its target keeps its own reason', () => {
    const r = targetLine(base(18), sessionAt('s1', 0, 8, 11))
    expect(r.text).toContain('came in under 11s')
    expect(r.text).not.toContain('beat the')
  })

  it('without a setup answer there is nothing to blame, and the line says only what is known', () => {
    const text = debriefSession(base(), { ...base(), sessions: [first] }, first, { before: 11, after: 10 }).find((d) => d.text.startsWith('Working target moves'))?.text
    expect(text).not.toContain('you gave at setup')
  })

  it('the number it quotes is the target the next session is built on', () => {
    const r = targetLine(base(18), first)
    const next = { ...base(18), sessions: [first] }
    expect(adaptiveTarget(next, 'lean', NOW)).toBe(r.after)
  })
})
