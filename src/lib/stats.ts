import type { AppState, Session, TrainingSurface } from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { STEP_BY_ID } from '../data/progressions'
import { addDays, weekStart } from './time'
import { isQualifyingSet } from './progression'

export function totalHoldSec(state: AppState): number {
  let t = 0
  for (const s of state.sessions) for (const set of s.sets) if (set.kind === 'hold') t += set.value
  return Math.round(t)
}

export function totalSets(state: AppState): number {
  return state.sessions.reduce((n, s) => n + s.sets.length, 0)
}

export function sessionsInWeekOf(state: AppState, ts: number): Session[] {
  const start = weekStart(ts)
  const end = addDays(start, 7)
  return state.sessions.filter((s) => s.startedAt >= start && s.startedAt < end)
}

/**
 * Consecutive fully-completed weeks (before the current one) that met the
 * weekly goal. The current week is reported separately so the UI can show
 * "streak alive if you finish this week".
 */
export function weekStreak(state: AppState, now = Date.now()): { weeks: number; currentMet: boolean } {
  const goal = state.settings.weeklyGoal
  const currentMet = sessionsInWeekOf(state, now).length >= goal
  let weeks = 0
  let cursor = addDays(weekStart(now), -7)
  while (sessionsInWeekOf(state, cursor).length >= goal) {
    weeks += 1
    cursor = addDays(cursor, -7)
    if (weeks > 520) break
  }
  return { weeks: weeks + (currentMet ? 1 : 0), currentMet }
}

/** Max value logged for one exercise per session, oldest first. */
export function bestSeries(
  state: AppState,
  exerciseId: string,
  surface?: TrainingSurface,
): { at: number; value: number }[] {
  const out: { at: number; value: number }[] = []
  for (const s of [...state.sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    let best = 0
    const progressionExercise =
      EXERCISE_BY_ID[exerciseId]?.category === 'planche' || exerciseId === 'ppp-hold'
    for (const set of s.sets) {
      if (
        set.exerciseId === exerciseId &&
        (!surface || set.surface === surface) &&
        set.value > best &&
        (!progressionExercise || isQualifyingSet(set, exerciseId))
      ) {
        best = set.value
      }
    }
    if (best > 0) out.push({ at: s.startedAt, value: best })
  }
  return out
}

export interface WeekVolume {
  start: number
  plancheSec: number
  otherSec: number
}

/** Hold-time volume per week for the trailing `weeks` weeks (including current). */
export function weeklyVolume(state: AppState, weeks = 12, now = Date.now()): WeekVolume[] {
  const out: WeekVolume[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(weekStart(now), -7 * i)
    out.push({ start, plancheSec: 0, otherSec: 0 })
  }
  const first = out[0].start
  for (const s of state.sessions) {
    if (s.startedAt < first) continue
    const idx = out.findIndex((w) => s.startedAt >= w.start && s.startedAt < addDays(w.start, 7))
    if (idx === -1) continue
    for (const set of s.sets) {
      if (set.kind !== 'hold') continue
      const ex = EXERCISE_BY_ID[set.exerciseId]
      if (ex?.category === 'planche') out[idx].plancheSec += set.value
      else out[idx].otherSec += set.value
    }
  }
  for (const w of out) {
    w.plancheSec = Math.round(w.plancheSec)
    w.otherSec = Math.round(w.otherSec)
  }
  return out
}

/** Biggest planche-line hold in a session (for feed summaries). */
export function sessionHighlight(session: Session): { exerciseId: string; value: number } | undefined {
  let best: { exerciseId: string; value: number } | undefined
  for (const set of session.sets) {
    if (set.kind !== 'hold') continue
    const ex = EXERCISE_BY_ID[set.exerciseId]
    if (ex?.category !== 'planche') continue
    if (!best || set.value > best.value) best = { exerciseId: set.exerciseId, value: set.value }
  }
  return best
}

export function sessionHoldSec(session: Session): number {
  return Math.round(session.sets.filter((s) => s.kind === 'hold').reduce((t, s) => t + s.value, 0))
}

/**
 * Least-squares trend over recent bests on the current step's key hold,
 * projected forward to the unlock bar. Returns null when there isn't enough
 * signal (or the trend is flat/negative) — never show a made-up forecast.
 */
export function paceToUnlock(state: AppState): { weeks: number } | null {
  const step = STEP_BY_ID[state.stepId]
  const series = bestSeries(state, step.keyExerciseId).slice(-6)
  if (series.length < 3) return null
  const best = Math.max(...series.map((p) => p.value))
  if (best >= step.unlockSec) return { weeks: 0 }
  const n = series.length
  const mx = series.reduce((t, p) => t + p.at, 0) / n
  const my = series.reduce((t, p) => t + p.value, 0) / n
  let num = 0
  let den = 0
  for (const p of series) {
    num += (p.at - mx) * (p.value - my)
    den += (p.at - mx) ** 2
  }
  if (den === 0) return null
  const slope = num / den // seconds gained per ms
  if (slope <= 0) return null
  const msLeft = (step.unlockSec - best) / slope
  const weeks = Math.max(1, Math.ceil(msLeft / (7 * 86_400_000)))
  return weeks > 26 ? null : { weeks }
}
