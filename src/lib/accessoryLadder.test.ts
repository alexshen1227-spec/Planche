import { describe, expect, it } from 'vitest'
import type { AppState, Block, Session, SetLog } from '../types'
import { initialState } from './store'
import { capacityAdjustBlocks, programmedPress } from '../data/workouts'
import { STEPS, STEP_BY_ID } from '../data/progressions'

/**
 * A swap made from the setup answers has to be able to end.
 *
 * Found by playing a new athlete's second day: "Pseudo Planche Push-Up swapped
 * for push-up, from your setup answer (push-up count)". The swap re-read the
 * setup answer whenever no pseudo planche push-up was logged — and the swap is
 * why none ever was. Every answer under "20 or more" push-ups kept a lean-step
 * athlete on push-ups for good, however many they logged; the same held for
 * knee push-ups and tuck hollow holds. Decisions asserted: which exercise the
 * block ends up as, and at what dose.
 */

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 1, 12)

function athlete(answers: Record<string, number>, logged: Record<string, number> = {}): AppState {
  const base = initialState()
  // Three recent sessions, so the median of their bests is the logged value.
  const sessions: Session[] = [9, 6, 3].map((daysAgo) => {
    const at = NOW - daysAgo * DAY
    const sets: SetLog[] = Object.entries(logged).map(([exerciseId, value]) => ({
      exerciseId,
      kind: exerciseId.includes('hold') ? 'hold' : 'reps',
      value,
      target: value,
      section: 'strength',
      at,
    }))
    return { id: `s-${daysAgo}`, startedAt: at, endedAt: at + 1_800_000, workoutName: 'Session', workoutKind: 'auto', stepId: 'lean', sets }
  })
  return {
    ...base,
    onboarded: true,
    stepId: 'lean',
    baseStepId: 'lean',
    unlocked: STEPS.filter((s) => s.order <= STEP_BY_ID.lean.order).map((s) => s.id),
    sessions,
    assessment: { at: 0, answers, placedStepId: 'lean', confidence: 'good', gapIds: [] },
  }
}

const press: Block = { exerciseId: 'pppu', sets: 3, target: { kind: 'reps', reps: 6 }, restSec: 90, section: 'strength', role: 'press' }
const pushupBlock: Block = { exerciseId: 'pushup', sets: 3, target: { kind: 'reps', reps: 8 }, restSec: 90, section: 'strength', role: 'press' }
const hollow: Block = { exerciseId: 'hollow-hold', sets: 2, target: { kind: 'hold', sec: 30 }, restSec: 45, section: 'core', role: 'core' }

const adjust = (state: AppState, block: Block) => capacityAdjustBlocks(state, [block], NOW)

describe('a swap made from the setup answers can end', () => {
  it('swaps pseudo planche push-ups for push-ups on a "10–19" answer, and says where the way up is', () => {
    const { blocks, notes } = adjust(athlete({ pushups: 12 }), press)
    expect(blocks[0].exerciseId).toBe('pushup')
    expect(notes.join(' ')).toMatch(/setup answer/)
    expect(blocks[0].note).toMatch(/once your push-up sets reach about 15 reps/)
  })

  it('keeps the swap while logged push-ups are still short of it', () => {
    const { blocks, notes } = adjust(athlete({ pushups: 12 }, { pushup: 12 }), press)
    expect(blocks[0].exerciseId).toBe('pushup')
    // The setup answer still says more than twelve logged push-ups would.
    expect(notes.join(' ')).toMatch(/setup answer/)
  })

  it('brings pseudo planche push-ups back once logged push-ups reach the bar, at a cautious dose', () => {
    const { blocks, notes } = adjust(athlete({ pushups: 12 }, { pushup: 15 }), press)
    expect(blocks[0].exerciseId).toBe('pppu')
    // A third of fifteen is five; seventy percent of that, rounded down.
    expect(blocks[0].target).toEqual({ kind: 'reps', reps: 3 })
    expect(notes.join(' ')).toMatch(/from your recent push-up sets/)
  })

  it('never reads the easier version as less than the setup answer', () => {
    // Five logged push-ups (an echo of a low target) must not swap a block the
    // answer alone would have kept.
    const { blocks } = adjust(athlete({ pushups: 22 }, { pushup: 5 }), press)
    expect(blocks[0].exerciseId).toBe('pppu')
  })

  it('leads from knee push-ups on to push-ups', () => {
    const weak = { pushups: 3 }
    expect(adjust(athlete(weak), pushupBlock).blocks[0].exerciseId).toBe('knee-pushup')
    expect(adjust(athlete(weak), press).blocks[0].exerciseId).toBe('knee-pushup')
    const grown = athlete(weak, { 'knee-pushup': 10 })
    expect(adjust(grown, pushupBlock).blocks[0].exerciseId).toBe('pushup')
    // The harder press now steps down only one rung.
    expect(adjust(grown, press).blocks[0].exerciseId).toBe('pushup')
  })

  it('brings the hollow hold back once tuck hollow holds reach the bar', () => {
    expect(adjust(athlete({ hollow: 8 }), hollow).blocks[0].exerciseId).toBe('tuck-hollow-hold')
    expect(adjust(athlete({ hollow: 8 }, { 'tuck-hollow-hold': 14 }), hollow).blocks[0].exerciseId).toBe('tuck-hollow-hold')
    expect(adjust(athlete({ hollow: 8 }, { 'tuck-hollow-hold': 20 }), hollow).blocks[0].exerciseId).toBe('hollow-hold')
  })
})

describe('the pressing ladder marks the press a day actually programs', () => {
  it('marks push-ups while the setup swap holds, and says what moves it', () => {
    const swapped = programmedPress(athlete({ pushups: 12 }), NOW)
    expect(swapped).toMatchObject({ exerciseId: 'pushup', swapped: true })
    expect(swapped.note).toMatch(/about 15 reps/)
  })

  it('marks the step’s own press once the swap has ended', () => {
    expect(programmedPress(athlete({ pushups: 12 }, { pushup: 15 }), NOW)).toMatchObject({ exerciseId: 'pppu', swapped: false })
  })
})
