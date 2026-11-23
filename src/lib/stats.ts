import type { AppState, Session, Settings, TrainingSurface } from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { addDays, CLOCK_SKEW_MS, dayKey, weekStart } from './time'
import { progressionCredit } from './progression'
import { isSkillHold, wholeState } from './skills'

/** One change of weekly goal: from `at` on (the week it falls in included), the goal was `goal`. */
export interface GoalChange {
  goal: number
  at: number
}

declare module '../types' {
  interface Settings {
    /**
     * Every weekly-goal change, oldest first. The first entry (at 0) is the goal
     * before any change was recorded. Each finished week is judged by the goal
     * in force in it: `goalBefore` remembered one earlier goal, so a second
     * change re-judged every older week against the middle goal, and the next
     * replay took back streak badges that had been earned.
     */
    goalHistory?: GoalChange[]
  }
}

/** Every weekly-goal change is kept, up to this many (the oldest go first). */
export const MAX_GOAL_HISTORY = 100

const goalNumber = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(14, Math.max(1, Math.round(v))) : undefined

/**
 * The goal history as stored, or as an older save implies it: `goalBefore`
 * says the goal before its change, and the current goal since.
 */
export function goalHistoryOf(settings: Pick<Settings, 'weeklyGoal' | 'goalBefore' | 'goalHistory'>): GoalChange[] {
  if (settings.goalHistory?.length) return settings.goalHistory
  const before = settings.goalBefore
  return before
    ? [
        { goal: before.goal, at: 0 },
        { goal: settings.weeklyGoal, at: before.until },
      ]
    : [{ goal: settings.weeklyGoal, at: 0 }]
}

/** A stored goal history, validated: whole goals 1-14 at real times, oldest first, each change once. */
export function sanitizeGoalHistory(raw: unknown): GoalChange[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const out: GoalChange[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const goal = goalNumber((item as GoalChange).goal)
    const at = (item as GoalChange).at
    if (goal === undefined || typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > 8.64e15) continue
    const key = `${at}:${goal}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ goal, at })
  }
  out.sort((a, b) => a.at - b.at || a.goal - b.goal)
  return out.length ? out.slice(-MAX_GOAL_HISTORY) : undefined
}

/** The history after the goal changes to `goal` at `at`. */
export function goalHistoryWith(settings: Settings, goal: number, at: number): GoalChange[] {
  return [...goalHistoryOf(settings), { goal, at }].slice(-MAX_GOAL_HISTORY)
}

/**
 * Two tabs' histories as one: every change either side made, by its time.
 * Returns `mine` itself when the other side adds nothing, so a merge that
 * changed nothing stays the same object.
 */
export function mergeGoalHistory(mine: GoalChange[] | undefined, theirs: GoalChange[] | undefined): GoalChange[] | undefined {
  if (!theirs?.length) return mine
  if (!mine?.length) return theirs
  const known = new Set(mine.map((c) => `${c.at}:${c.goal}`))
  if (theirs.every((c) => known.has(`${c.at}:${c.goal}`))) return mine
  return sanitizeGoalHistory([...mine, ...theirs])
}

/**
 * The goal a week was trained under: the last change made before the week
 * ended that takes effect by its start, so a change mid-week holds that week
 * to the new goal (as it always has) and leaves earlier weeks alone. The
 * newest change's goal is the current one, `weeklyGoal`.
 */
export function goalForWeek(settings: Settings, weekStartsAt: number): number {
  const history = goalHistoryOf(settings)
  let index = -1
  for (let i = 0; i < history.length; i++) if (weekStart(history[i].at) <= weekStartsAt) index = i
  if (index === -1) return history[0]?.goal ?? settings.weeklyGoal
  return index === history.length - 1 ? settings.weeklyGoal : history[index].goal
}

/**
 * The days of the week holding `ts` that count toward the weekly goal: a skill
 * session (a minimum dose aside) or a gym session, by local calendar day, and
 * never one dated past `now`. One count for the streak, the badges and Home —
 * Home once counted gym days and the streak only skill sessions, so a week
 * shown as 3/3 broke the streak.
 */
export function goalDaysInWeekOf(state: AppState, ts: number, now = Date.now()): Map<string, 'calisthenics' | 'gym'> {
  const whole = wholeState(state)
  const start = weekStart(ts)
  const end = addDays(start, 7)
  const counts = (t: number) => t >= start && t < end && t <= now + CLOCK_SKEW_MS
  const kinds = new Map<string, 'calisthenics' | 'gym'>()
  for (const s of whole.sessions) if (s.workoutKind !== 'micro' && counts(s.startedAt)) kinds.set(dayKey(s.startedAt), 'calisthenics')
  for (const s of whole.gym?.sessions ?? []) if (counts(s.startedAt)) kinds.set(dayKey(s.startedAt), 'gym')
  return kinds
}

export function totalHoldSec(state: AppState): number {
  let t = 0
  for (const s of state.sessions) for (const set of s.sets) if (set.kind === 'hold') t += set.value
  return Math.round(t)
}

export function totalSets(state: AppState): number {
  return state.sessions.reduce((n, s) => n + s.sets.length, 0)
}

export function sessionsInWeekOf(state: AppState, ts: number, now = Date.now()): Session[] {
  const start = weekStart(ts)
  const end = addDays(start, 7)
  // A session stamped in the future (a clock that ran ahead, an import from a
  // device in another state) has not happened yet and cannot meet a goal.
  // A minimum dose is extra, not one of the week's sessions: counting it let a
  // few six-minute top-ups stand in for the sessions the goal is about.
  return state.sessions.filter(
    (s) => s.startedAt >= start && s.startedAt < end && s.startedAt <= now + CLOCK_SKEW_MS && s.workoutKind !== 'micro',
  )
}

/**
 * Consecutive fully-completed weeks (before the current one) that met the
 * weekly goal. The current week is reported separately so the UI can show
 * "streak alive if you finish this week".
 *
 * A week meets its goal by its training days (`goalDaysInWeekOf`), judged
 * against the goal in force that week (`goalForWeek`).
 */
export function weekStreak(state: AppState, now = Date.now()): { weeks: number; currentMet: boolean } {
  const settings = state.settings
  const met = (weekStartsAt: number) => goalDaysInWeekOf(state, weekStartsAt, now).size >= goalForWeek(settings, weekStartsAt)
  const currentMet = met(weekStart(now))
  let weeks = 0
  let cursor = addDays(weekStart(now), -7)
  while (met(cursor)) {
    weeks += 1
    cursor = addDays(cursor, -7)
    if (weeks > 520) break
  }
  return { weeks: weeks + (currentMet ? 1 : 0), currentMet }
}

/**
 * One point per session, oldest first.
 *
 * For a progression hold the point is the *credit* that session earned — the
 * same number unlocks use: only qualifying sets, capped at the camera's clean
 * window, and for a unilateral hold the weaker side (a session that trained
 * one side only earns no bilateral point). Plotting the stopwatch value of an
 * eligible set instead drew 20s and 30s against a 20s goal while the unlock
 * card correctly said five and six.
 *
 * Other holds plot their best timer value.
 */
/**
 * Whether a hold's chart plots unlock credit rather than the timer: the
 * planche line, plus Foundations' key hold. One rule, read by the series and
 * by every label describing it, so the heading cannot name a different
 * quantity from the line.
 */
export function plotsProgressionCredit(exerciseId: string): boolean {
  // Every skill line's own holds — a tuck planche, a front lever, a handstand.
  return isSkillHold(EXERCISE_BY_ID[exerciseId]) || exerciseId === 'ppp-hold'
}

export function bestSeries(
  state: AppState,
  exerciseId: string,
  surface?: TrainingSurface,
): { at: number; value: number }[] {
  const out: { at: number; value: number }[] = []
  const exercise = EXERCISE_BY_ID[exerciseId]
  const progressionExercise = plotsProgressionCredit(exerciseId)
  for (const s of [...state.sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    const sets = s.sets.filter((set) => set.exerciseId === exerciseId && (!surface || set.surface === surface))
    let value = 0
    if (!progressionExercise) {
      value = sets.reduce((best, set) => Math.max(best, set.value), 0)
    } else if (exercise?.perSide) {
      const side = (which: 'left' | 'right') =>
        sets.filter((set) => set.side === which).reduce((best, set) => Math.max(best, progressionCredit(set, exerciseId)), 0)
      value = Math.min(side('left'), side('right'))
    } else {
      value = sets.reduce((best, set) => Math.max(best, progressionCredit(set, exerciseId)), 0)
    }
    if (value > 0) out.push({ at: s.startedAt, value })
  }
  return out
}

export interface WeekVolume {
  start: number
  /** Seconds held in the skill lines' own positions — planche, lever, handstand, 90° hold, flag. */
  skillSec: number
  otherSec: number
}

/** Hold-time volume per week for the trailing `weeks` weeks (including current). */
export function weeklyVolume(state: AppState, weeks = 12, now = Date.now()): WeekVolume[] {
  const out: WeekVolume[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(weekStart(now), -7 * i)
    out.push({ start, skillSec: 0, otherSec: 0 })
  }
  const first = out[0].start
  for (const s of state.sessions) {
    if (s.startedAt < first) continue
    const idx = out.findIndex((w) => s.startedAt >= w.start && s.startedAt < addDays(w.start, 7))
    if (idx === -1) continue
    for (const set of s.sets) {
      if (set.kind !== 'hold') continue
      const ex = EXERCISE_BY_ID[set.exerciseId]
      if (isSkillHold(ex)) out[idx].skillSec += set.value
      else out[idx].otherSec += set.value
    }
  }
  for (const w of out) {
    w.skillSec = Math.round(w.skillSec)
    w.otherSec = Math.round(w.otherSec)
  }
  return out
}

/** Biggest hold on a skill line in a session (for feed summaries). */
export function sessionHighlight(session: Session): { exerciseId: string; value: number } | undefined {
  let best: { exerciseId: string; value: number } | undefined
  for (const set of session.sets) {
    if (set.kind !== 'hold') continue
    const ex = EXERCISE_BY_ID[set.exerciseId]
    if (!isSkillHold(ex)) continue
    if (!best || set.value > best.value) best = { exerciseId: set.exerciseId, value: set.value }
  }
  return best
}

export function sessionHoldSec(session: Session): number {
  return Math.round(session.sets.filter((s) => s.kind === 'hold').reduce((t, s) => t + s.value, 0))
}

/** Workout time with periods spent outside the app removed. */
export function sessionDurationSec(session: Session): number {
  return Math.max(0, (session.endedAt - session.startedAt - (session.pausedMs ?? 0)) / 1000)
}

/*
 * `paceToUnlock` used to live here: a least-squares fit over at most six noisy
 * session bests, printed as "on pace to unlock in ~N weeks".
 *
 * It was removed rather than tuned. Least squares lets one lucky hold rotate
 * the whole line, and a single number hid the fact that the honest answer
 * spans months — an athlete told four weeks who takes eleven is right to
 * conclude the app was guessing. `forecastUnlock` in lib/forecast.ts replaces
 * it with an interval built from the spread of the athlete's own pairwise
 * rates, a confidence tier, and the option to refuse outright.
 */
