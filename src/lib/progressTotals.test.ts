import { describe, expect, it } from 'vitest'
import type { AppState, Session, SetLog } from '../types'
import type { GymSession } from './gym/types'
import { initialState } from './store'
import { defaultGym } from './gym/state'
import { weeklySummary } from './plan/weekly'
import { countsAsSkillHold, historyEntries, progressTotals, skillHoldSecOf, workingSkillSets } from './progressTotals'

/**
 * Review round four (M4): after one planche session and one gym session,
 * Progress read "Skill hold time 8s" for the week, "Time under tension 21s"
 * and "21s held" in History, and "Sessions 2 · Total sets 19" over a History
 * listing one session. Every figure now counts the same working sets.
 */

const NOW = Date.UTC(2026, 10, 18, 17) // a Wednesday: the whole history is in this week
const MIN = 60_000

function hold(exerciseId: string, value: number, section: SetLog['section'], i: number): SetLog {
  return { exerciseId, kind: 'hold', value, target: value, section, at: NOW + i * MIN }
}

/** The reviewer's planche day: warm-up holds, four short leans, a frog stand, core, a stretch. */
const plancheDay: Session = {
  id: 'planche-day',
  startedAt: NOW,
  endedAt: NOW + 40 * MIN,
  workoutName: 'Lean day',
  workoutKind: 'auto',
  stepId: 'lean',
  sets: [
    hold('wrist-rocks', 20, 'warmup', 0),
    hold('frog-stand', 5, 'warmup', 1),
    hold('planche-lean', 2.1, 'main', 2),
    hold('planche-lean', 2.1, 'main', 3),
    hold('planche-lean', 2.1, 'main', 4),
    hold('planche-lean', 2.1, 'main', 5),
    { exerciseId: 'pppu', kind: 'reps', value: 6, target: 6, section: 'strength', at: NOW + 6 * MIN },
    hold('scap-pushup-hold', 3.3, 'strength', 7),
    hold('hollow-hold', 15, 'core', 8),
    hold('shoulder-extension-stretch', 4.4, 'cooldown', 9),
  ],
  rpe: 7,
}

const gymDay: GymSession = {
  id: 'gym-day',
  locationId: 'home',
  startedAt: NOW + 3 * 60 * MIN,
  endedAt: NOW + 3 * 60 * MIN + 35 * MIN,
  name: 'Lower',
  exercises: [
    {
      exerciseId: 'goblet-squat',
      sets: [
        { kg: 8, reps: 10, warmup: true, at: NOW + 181 * MIN },
        { kg: 16, reps: 8, at: NOW + 183 * MIN },
        { kg: 16, reps: 8, at: NOW + 186 * MIN },
        { kg: 16, reps: 7, at: NOW + 189 * MIN },
      ],
    },
  ],
}

function athlete(): AppState {
  const base = initialState()
  return { ...base, onboarded: true, sessions: [plancheDay], gym: { ...defaultGym(['floor'], 'kg', NOW), sessions: [gymDay] } }
}

describe('Progress counts what it says (review round four, M4)', () => {
  it('counts skill hold time the way the week does, so the tile, the totals and History agree', () => {
    const state = athlete()
    const totals = progressTotals(state)
    // 4 × 2.1s of lean + 3.3s of strength hold; not the warm-up, core or stretch.
    expect(totals.skillHoldSec).toBe(12)
    expect(totals.skillHoldSec).toBe(Math.round(weeklySummary(state, NOW + 4 * 60 * MIN).holdSec))
    expect(skillHoldSecOf(plancheDay.sets)).toBe(totals.skillHoldSec)
    expect(countsAsSkillHold(hold('shoulder-extension-stretch', 4.4, 'cooldown', 0))).toBe(false)
    expect(countsAsSkillHold(hold('frog-stand', 5, 'warmup', 0))).toBe(false)
  })

  it('counts working sets on both sides, as the week counts gym sets', () => {
    const state = athlete()
    const totals = progressTotals(state)
    expect(workingSkillSets(plancheDay)).toBe(7)
    expect(totals.skillSets).toBe(7)
    expect(totals.gymSets).toBe(3)
    expect(totals.gymSets).toBe(weeklySummary(state, NOW + 4 * 60 * MIN).gymSets)
    expect(totals.sets).toBe(10)
    expect(totals).toMatchObject({ skillSessions: 1, gymSessions: 1, sessions: 2 })
  })

  it('lists every session it counts: the gym session is in History, newest first', () => {
    const state = athlete()
    const entries = historyEntries(state.sessions, state.gym!.sessions)
    expect(entries.map((entry) => `${entry.kind}:${entry.id}`)).toEqual(['gym:gym-day', 'skill:planche-day'])
    expect(entries.length).toBe(progressTotals(state).sessions)
  })
})
