import { PATTERN_LABEL, type Pattern } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import type { GymState } from '../gym/types'

const DAY = 86_400_000

/**
 * Which movement patterns the gym sessions used lately, and with which
 * movements — so the builder (or the athlete) can choose variety. Pure
 * history: nothing here says a change is needed. Rotating exercises is a
 * coaching preference (CONSENSUS); staying with a lift that keeps
 * progressing is fine too.
 */
export interface PatternUse {
  pattern: Pattern
  label: string
  /** Sessions in the window that trained this pattern with at least one working set. */
  sessions: number
  lastAt: number
  /** The movements used for it, most sessions first. */
  exercises: { exerciseId: string; sessions: number; lastAt: number }[]
}

/** Patterns used in the last `days` (default 21: about three weeks), most used first. */
export function recentPatternUse(gym: Pick<GymState, 'sessions'> | undefined, now: number, days = 21): PatternUse[] {
  const from = now - days * DAY
  const byPattern = new Map<Pattern, { sessions: Set<string>; lastAt: number; exercises: Map<string, { sessions: Set<string>; lastAt: number }> }>()
  for (const s of gym?.sessions ?? []) {
    if (s.startedAt < from || s.startedAt > now) continue
    for (const log of s.exercises) {
      const ex = GYM_EXERCISE_BY_ID[log.exerciseId]
      if (!ex || !log.sets.some((x) => !x.warmup && x.reps > 0)) continue
      const entry = byPattern.get(ex.pattern) ?? { sessions: new Set<string>(), lastAt: 0, exercises: new Map() }
      entry.sessions.add(s.id)
      entry.lastAt = Math.max(entry.lastAt, s.startedAt)
      const e = entry.exercises.get(ex.id) ?? { sessions: new Set<string>(), lastAt: 0 }
      e.sessions.add(s.id)
      e.lastAt = Math.max(e.lastAt, s.startedAt)
      entry.exercises.set(ex.id, e)
      byPattern.set(ex.pattern, entry)
    }
  }
  return [...byPattern.entries()]
    .map(([pattern, v]) => ({
      pattern,
      label: PATTERN_LABEL[pattern] ?? pattern,
      sessions: v.sessions.size,
      lastAt: v.lastAt,
      exercises: [...v.exercises.entries()]
        .map(([exerciseId, e]) => ({ exerciseId, sessions: e.sessions.size, lastAt: e.lastAt }))
        .sort((a, b) => b.sessions - a.sessions || b.lastAt - a.lastAt || (a.exerciseId < b.exerciseId ? -1 : 1)),
    }))
    .sort((a, b) => b.sessions - a.sessions || b.lastAt - a.lastAt || (a.pattern < b.pattern ? -1 : 1))
}

export interface RotationHint {
  pattern: Pattern
  exerciseId: string
  sessions: number
  text: string
}

/**
 * Patterns where one movement filled every session of it in the window, at
 * least `minSessions` times: a variation is an option there. Absent means
 * nothing repeated that often — not that the week lacked variety.
 */
export function rotationHints(uses: PatternUse[], minSessions = 3): RotationHint[] {
  return uses.flatMap((u) => {
    const only = u.exercises.length === 1 ? u.exercises[0] : undefined
    if (!only || only.sessions < minSessions) return []
    const name = GYM_EXERCISE_BY_ID[only.exerciseId]?.name ?? only.exerciseId
    return [
      {
        pattern: u.pattern,
        exerciseId: only.exerciseId,
        sessions: only.sessions,
        text: `${name} has been your only ${u.label.toLowerCase()} in ${only.sessions} sessions lately — a variation is an option if you want one; keeping a lift that still progresses is fine too.`,
      },
    ]
  })
}
