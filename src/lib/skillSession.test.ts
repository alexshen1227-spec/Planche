import { describe, expect, it } from 'vitest'
import { initialState, normalizeState, reducer } from './store'
import type { Session, SetLog, Workout } from '../types'
import { continueSkillSession, readSkillRemainder, remainingSkillWork } from './skillSession'
import { resumeSkillWorkout } from './resumeSkillWorkout'

const start = new Date(2026, 9, 5, 17).getTime()
const left: SetLog = { exerciseId: 'side-plank', section: 'core', kind: 'hold', value: 12, target: 12, at: start + 1000, side: 'left' }
const workout: Workout = { id: 'side', name: 'Core practice', kind: 'template', focus: 'Core', minutes: 10, blocks: [
  { exerciseId: 'side-plank', sets: 2, restSec: 60, section: 'core', target: { kind: 'hold', sec: 12 } },
] }
const partial: Session = { id: 'shared', startedAt: start, endedAt: start + 2000, workoutName: workout.name,
  workoutKind: 'template', stepId: 'foundations', plannedRounds: 2, sets: [left], completion: 'partial',
  remaining: remainingSkillWork(workout, [left], { 0: [left.at] }) }

describe('continued skill rounds', () => {
  it('keeps the side still owed and the original prescription across a backup round-trip', () => {
    expect(partial.remaining?.blocks[0]).toMatchObject({ exerciseId: 'side-plank', sets: 1, firstSide: 'right' })
    const state = normalizeState({ ...initialState(), onboarded: true, sessions: [partial] })
    expect(state.sessions[0].remaining).toEqual(partial.remaining)
    expect(readSkillRemainder({ blocks: [{ ...workout.blocks[0], target: null }] })).toBeUndefined()
  })

  it('keeps earlier edits and counts one session when a continuation is retried or the original was deleted', () => {
    const corrected = { ...partial, sets: [{ ...left, value: 10 }] }
    const part: Session = { ...partial, startedAt: start + 10_000, endedAt: start + 12_000, completion: 'full', remaining: undefined,
      sets: [{ ...left, side: 'right', at: start + 11_000 }], notes: 'Finished both sides' }
    const before = { ...initialState(), sessions: [corrected] }
    const action = { type: 'SAVE_SESSION' as const, session: part, resumeFrom: partial.endedAt }
    const after = reducer(before, action)
    expect(after.sessions).toHaveLength(1)
    expect(after.sessions[0].sets.map((s) => [s.side, s.value])).toEqual([['left', 10], ['right', 12]])
    expect(after.sessions[0].pausedMs).toBe(8000)
    expect(reducer(after, action).sessions).toEqual(after.sessions)
    expect(continueSkillSession(after.sessions[0], part)).toBe(after.sessions[0])
    const removed = reducer(before, { type: 'DELETE_SESSION', id: partial.id })
    expect(reducer(removed, action).sessions).toHaveLength(0)
  })

  it('offers a separate recovery workout when a new check-in restricts a loaded partial', () => {
    const state = { ...initialState(), sessions: [partial] }
    const at = start + 60_000
    const next = resumeSkillWorkout(state, partial.id, { at, joints: 'pain', regions: ['wrist'], energy: 'ok' }, at)
    expect(next?.workout.id).toMatch(/^pain-safe-recovery/)
    expect(next?.workout.continuation).toBeUndefined()
    expect(state.sessions[0].remaining).toBe(partial.remaining)
  })
})
