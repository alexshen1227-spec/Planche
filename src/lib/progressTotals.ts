import type { AppState, Session, SetLog } from '../types'
import type { GymSession } from './gym/types'

/**
 * What Progress counts, in one place, so its numbers say the same thing.
 *
 * After one planche session and one gym session the screen once read "Skill
 * hold time 8s" for the week beside "Time under tension 21s" and a History line
 * of "21s held", with "19 sets" over a History that listed one session. The
 * week (`lib/plan/weekly`) counted holds in a session's main and strength
 * work; the totals and History added every hold — warm-up drills and
 * cool-down stretches, logged at their prescribed counts — and the set total
 * counted every skill set, warm-ups and stretches included, beside the gym's
 * *working* sets only. Nothing on screen said why.
 *
 * Now every figure counts working sets: skill sets outside the warm-up and
 * cool-down, gym sets not marked warm-up. Skill hold time is the week's rule
 * — holds in main and strength work — so a week with all of the history in
 * it shows the same seconds in the tile, the totals and History.
 */

/** A hold the week's "Skill hold time" counts: the key holds and strength work, not drills or stretches. */
export function countsAsSkillHold(set: Pick<SetLog, 'kind' | 'section'>): boolean {
  return set.kind === 'hold' && (set.section === 'main' || set.section === 'strength')
}

/** A skill set that is training: anything outside the warm-up and the cool-down. */
export function isWorkingSkillSet(set: Pick<SetLog, 'section'>): boolean {
  return set.section !== 'warmup' && set.section !== 'cooldown'
}

/** Seconds of skill hold time in a list of sets, rounded once. */
export function skillHoldSecOf(sets: readonly SetLog[]): number {
  return Math.round(sets.filter(countsAsSkillHold).reduce((sum, set) => sum + set.value, 0))
}

export function workingSkillSets(session: Pick<Session, 'sets'>): number {
  return session.sets.filter((set) => isWorkingSkillSet(set) && set.value > 0).length
}

export function workingGymSets(session: Pick<GymSession, 'exercises'>): number {
  return session.exercises.reduce((n, exercise) => n + exercise.sets.filter((set) => !set.warmup && set.reps > 0).length, 0)
}

export interface ProgressTotals {
  skillSessions: number
  gymSessions: number
  sessions: number
  /** Skill sets outside warm-up and cool-down. */
  skillSets: number
  /** Gym sets not marked warm-up. */
  gymSets: number
  sets: number
  /** Seconds held in main and strength work, all time — the week tile's rule. */
  skillHoldSec: number
}

export function progressTotals(state: Pick<AppState, 'sessions' | 'gym'>): ProgressTotals {
  const gym = state.gym?.sessions ?? []
  const skillSets = state.sessions.reduce((n, session) => n + workingSkillSets(session), 0)
  const gymSets = gym.reduce((n, session) => n + workingGymSets(session), 0)
  return {
    skillSessions: state.sessions.length,
    gymSessions: gym.length,
    sessions: state.sessions.length + gym.length,
    skillSets,
    gymSets,
    sets: skillSets + gymSets,
    skillHoldSec: skillHoldSecOf(state.sessions.flatMap((session) => session.sets)),
  }
}

export type HistoryEntry =
  | { kind: 'skill'; id: string; at: number; session: Session }
  | { kind: 'gym'; id: string; at: number; session: GymSession }

/**
 * Progress's History: skill and gym sessions together, newest first. The
 * sessions count above it has included the gym since Fitness Lab; the list
 * once held only skill sessions, so "Sessions 2" sat over one entry.
 */
export function historyEntries(skill: readonly Session[], gym: readonly GymSession[]): HistoryEntry[] {
  return [
    ...skill.map((session): HistoryEntry => ({ kind: 'skill', id: session.id, at: session.startedAt, session })),
    ...gym.map((session): HistoryEntry => ({ kind: 'gym', id: session.id, at: session.startedAt, session })),
  ].sort((a, b) => b.at - a.at)
}
