import { describe, expect, it } from 'vitest'
import type { AppState, Session, SetLog } from '../types'
import { initialState } from './store'
import { applySession } from './engine'
import { adaptiveTarget, workingTarget } from './workingTarget'
import { debriefSession } from './coach'
import { capacityOn } from './bridge'
import { STEP_BY_ID } from '../data/progressions'
import { placeFromAssessment, type AssessmentAnswers } from './assessment'

/**
 * Review round four (M6): a brand-new athlete held about 4s on the timer
 * against a 12s target, rated it Clean at RPE 7, and was told "Working target
 * moves 12s → 1s next session — rebuilding quality before pushing again".
 *
 * Reproduced exactly: at the planche lean with no answer for the lean (the
 * athlete picked their own level), 12s is the step's conventional start, and
 * four holds of 2.1s (4.4s on the timer less the 2.3s stop reaction delay)
 * that fell short of it are measurements — so the next target is 60% of what
 * was held. With a placement answer for the hold, the answer stands beside
 * the first session (`settled`/`toldHold`) and the same session moves 12s to
 * 7s. The rule held; the copy did not: nothing about quality moved it.
 */

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 20, 17)

function athlete(answers: AssessmentAnswers | null, stepIdIfSkipped?: Session['stepId']): AppState {
  const base = initialState()
  const stepId = answers ? placeFromAssessment(answers).stepId : stepIdIfSkipped!
  return {
    ...base,
    onboarded: true,
    stepId,
    baseStepId: stepId,
    unlocked: [stepId],
    ...(answers ? { assessment: { at: NOW - DAY, answers, placedStepId: stepId, confidence: 'moderate' } } : {}),
    profile: { ...base.profile, equipment: ['floor'] },
  } as AppState
}

/** Four key holds logged at 2.1s against the target given: 4.4s on the timer, short of the call, rated Clean. */
function firstSession(state: AppState, target: number): Session {
  const key = STEP_BY_ID[state.stepId].keyExerciseId
  const sets: SetLog[] = [0, 1, 2, 3].map((i) => ({
    exerciseId: key,
    kind: 'hold',
    value: 2.1,
    raw: 4.4,
    target,
    section: 'main',
    surface: 'floor',
    at: NOW + i * 120_000,
    timing: { method: 'stopwatch', allowanceSec: 2.3, allowance: 'reaction' },
    form: { rating: 'clean', confirmed: true },
  }))
  return {
    id: 'first',
    startedAt: NOW,
    endedAt: NOW + 30 * 60_000,
    workoutName: 'Session',
    workoutKind: 'auto',
    stepId: state.stepId,
    sets,
    rpe: 7,
  } as Session
}

function afterFirstSession(state: AppState) {
  const before = adaptiveTarget(state, state.stepId, NOW)
  const session = firstSession(state, before)
  const { next } = applySession(state, session)
  const after = adaptiveTarget(next, next.stepId, NOW + DAY)
  const said = debriefSession(state, next, next.sessions.find((s) => s.id === session.id) ?? session, { before, after })
    .map((d) => d.text)
    .join(' ')
  return { before, after, next, said }
}

describe('one session is not a level (review round four, M6)', () => {
  it('keeps a placement answer beside one session of short holds', () => {
    // Placed on Foundations by a "15–29s" pseudo planche plank answer.
    const placed = athlete({ wrist: 2, pushups: 20, hollow: 30, 'ppp-hold': 20 })
    expect(placed.stepId).toBe('foundations')
    const { before, after, next, said } = afterFirstSession(placed)
    expect(before).toBe(12)
    // The answer (20s) stands beside the 2.1s holds: the median of the two, not the holds alone.
    expect(after).toBe(7)
    expect(capacityOn(next, 'foundations')).toBe(20)
    expect(workingTarget(next, 'foundations', 1, NOW + DAY)).toEqual({ sec: 7, heldByCapacity: false })
    expect(said).toMatch(/Working target moves 12s → 7s next session: your pseudo planche plank holds came in under 12s \(best 2\.1s\)/)
    // Not a first estimate: the athlete told us this hold.
    expect(said).not.toMatch(/starting estimate/)
    expect(said).not.toMatch(/rebuilding quality/)
  })

  it('reads the holds alone when nothing was said about that hold, and says why the target fell', () => {
    // The athlete picked the lean themselves: no answer for it, so 12s is the step's conventional start.
    const own = athlete(null, 'lean')
    const { before, after, said } = afterFirstSession(own)
    expect(before).toBe(STEP_BY_ID.lean.startSec)
    expect(before).toBe(12)
    expect(after).toBe(1)
    expect(said).toMatch(
      /Working target moves 12s → 1s next session: your planche lean holds came in under 12s \(best 2\.1s\), and the target follows what you hold\. The 12s was a starting estimate, not a measure of you\./,
    )
    expect(said).not.toMatch(/rebuilding quality/)
  })

  it('a target that rises says nothing more than the move', () => {
    const own = athlete(null, 'lean')
    const before = adaptiveTarget(own, own.stepId, NOW)
    const session = firstSession(own, before)
    const longer: Session = { ...session, sets: session.sets.map((s) => ({ ...s, value: 26, raw: 28.3 })) }
    const { next } = applySession(own, longer)
    const after = adaptiveTarget(next, next.stepId, NOW + DAY)
    expect(after).toBeGreaterThan(before)
    const said = debriefSession(own, next, longer, { before, after }).map((d) => d.text)
    expect(said).toContain(`Working target moves ${before}s → ${after}s next session.`)
  })
})
