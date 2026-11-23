import { describe, expect, it } from 'vitest'
import type { AppState, Session, SetLog } from '../types'
import { initialState } from './store'
import { ACHIEVEMENTS } from '../data/achievements'
import { STEP_BY_ID } from '../data/progressions'
import { totalHoldSec, totalSkillHoldSec } from './stats'
import { progressTotals } from './progressTotals'
import { ladderStatus } from './repLadder'
import { defaultPrefs, newLocation } from './gym/state'
import { skillSessionsPerWeek, weeklySummary } from './plan/weekly'

const DAY = 86_400_000
const MON = new Date(2026, 10, 23, 10).getTime() // Monday 23 Nov 2026
const key = STEP_BY_ID.tuck.keyExerciseId

function hold(section: SetLog['section'], value: number, at: number): SetLog {
  return { exerciseId: key, kind: 'hold', value, target: value, section, at, endReason: 'effort' } as SetLog
}
function session(id: string, at: number, sets: SetLog[]): Session {
  return { id, startedAt: at, endedAt: at + 1_800_000, workoutName: 'S', workoutKind: 'auto', stepId: 'tuck', sets } as Session
}
function athlete(sessions: Session[], gymSessions: any[] = [], goals: any[] = []): AppState {
  const base = initialState()
  const home = { ...newLocation('Gym', 'kg', ['barbell', 'bench', 'dumbbells'] as any, MON - 100 * DAY), id: 'G' }
  return {
    ...base,
    onboarded: true,
    sessions,
    gym: { ...(base as any).gym, locations: [home], activeLocationId: 'G', sessions: gymSessions, ratings: {}, favoriteAt: {}, prefs: { ...defaultPrefs(MON - 100 * DAY), skillGoals: goals } },
  } as AppState
}
const oneLift = (at: number) => ({
  id: 'g1', locationId: 'G', startedAt: at, endedAt: at + 3_600_000, name: 'Lift',
  exercises: [{ exerciseId: 'bench-press', sets: [0, 1, 2].map((i) => ({ kg: 50, unit: 'kg', reps: 8, rpe: 8, at: at + i })) }],
})

describe('progress9: hold time says one thing', () => {
  const sessions = [
    session('a', MON - 5 * DAY, [hold('warmup', 120, 1), hold('main', 60, 2), hold('strength', 30, 3), hold('cooldown', 90, 4)]),
  ]
  const state = athlete(sessions)
  it('the tile and the badges count key and strength holds only', () => {
    expect(progressTotals(state).skillHoldSec).toBe(90)
    expect(totalSkillHoldSec(state)).toBe(progressTotals(state).skillHoldSec)
    // All holds, drills included, is a different number and is no longer what a badge reads.
    expect(totalHoldSec(state)).toBe(300)
  })
  it('a badge is not earned on warm-up and cool-down seconds', () => {
    const tut = ACHIEVEMENTS.find((a) => a.id === 'tut-300')!
    expect(tut.check(state, state.sessions[0])).toBe(false)
    const long = athlete([session('b', MON - 2 * DAY, [hold('main', 200, 1), hold('strength', 100, 2)])])
    expect(tut.check(long, long.sessions[0])).toBe(true)
    expect(tut.progress?.(state)?.current).toBe(90)
  })
})

describe('progress9: the selected skill shows its own ladder', () => {
  it('the planche has no rep ladder (it has the pressing ladder); the handstand has its own', () => {
    const s = athlete([])
    expect(ladderStatus(s, 'planche')).toBeNull()
    const hs = ladderStatus(s, 'handstand')
    expect(hs).not.toBeNull()
    expect(hs!.ladder.name.toLowerCase()).toContain('push-up')
  })
})

describe('progress9: the weekly card does not judge a week that has begun', () => {
  const lines = (s: AppState, now: number) => weeklySummary(s, now).focus.join(' | ')
  it('Monday after one gym session says nothing about muscles staying under target', () => {
    const s = athlete([], [oneLift(MON - 2 * 3_600_000)])
    expect(lines(s, MON)).not.toMatch(/stay under|cannot cover|under target so far|Several muscles/)
  })
  it('a week with nothing logged agrees with Today instead of saying there is nothing to compare', () => {
    const f = lines(athlete([]), MON)
    expect(f).toMatch(/^Nothing logged this week yet/)
    expect(f).not.toMatch(/nothing to compare/)
    expect(f).toMatch(/Today’s plan/)
  })
  it('names frequency only when it is low, and never for a date that has passed', () => {
    const busy = Array.from({ length: 16 }, (_, i) => session('b' + i, MON - (27 - i * 1.7) * DAY, [hold('main', 10, 1)]))
    expect(skillSessionsPerWeek(athlete(busy), MON)).toBeGreaterThanOrEqual(3)
    expect(skillSessionsPerWeek(athlete([]), MON)).toBe(0)
    const sparse = [session('s1', MON - 20 * DAY, [hold('main', 10, 1)]), session('s2', MON - 6 * DAY, [hold('main', 10, 1)])]
    expect(skillSessionsPerWeek(athlete(sparse), MON)).toBeLessThan(3)
    const passed = [{ skill: 'planche', stepId: 'straddle', by: '2026-11-01' }]
    for (const sessions of [busy, sparse]) {
      const w = lines({ ...athlete(sessions, [], passed), stepId: 'tuck', baseStepId: 'tuck', unlocked: ['foundations', 'lean', 'frog', 'tuck'] } as AppState, MON)
      expect(w).toMatch(/date has passed/)
      expect(w).not.toMatch(/biggest lever|more frequent|trained skills under/i)
    }
  })
  it('does not promise that skills move with frequency as a fact', () => {
    const w = lines(athlete([session('x', MON - 9 * DAY, [hold('main', 10, 1)])]), MON + 4 * DAY)
    expect(w).not.toMatch(/skills move with frequency/)
  })
})
