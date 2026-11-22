import type { AppState, Workout, WorkoutRequest } from '../../types'
import { addDays, dayKey, weekStart } from '../time'
import type { TodayPlan } from './planner'

/**
 * Decisions the Home and Train screens make about today and this week, kept
 * pure so they can be pinned: the screens once disagreed — Home counted skill
 * sessions only and offered "Start today's session" on a rest day while Train
 * had a gym week and said rest.
 */

/** This calendar week's training, skill and gym alike: a day with a gym session is a gym day, as the planner counts it. */
export interface TrainingWeek {
  /** Days trained this week, up to now. */
  days: number
  cal: number
  gym: number
  /** Each trained day's kind, by local day key. */
  kinds: Map<string, 'calisthenics' | 'gym'>
  gymSessions: number
  /** Working gym sets this week (warm-ups and empty sets left out). */
  gymSets: number
}

export function trainingWeek(state: AppState, now = Date.now()): TrainingWeek {
  const from = weekStart(now)
  const to = Math.min(addDays(from, 7), now + 1)
  const inWeek = (t: number) => t >= from && t < to
  const kinds = new Map<string, 'calisthenics' | 'gym'>()
  for (const s of state.sessions) if (s.workoutKind !== 'micro' && inWeek(s.startedAt)) kinds.set(dayKey(s.startedAt), 'calisthenics')
  const gym = (state.gym?.sessions ?? []).filter((s) => inWeek(s.startedAt))
  for (const s of gym) kinds.set(dayKey(s.startedAt), 'gym')
  const values = [...kinds.values()]
  return {
    days: kinds.size,
    cal: values.filter((k) => k === 'calisthenics').length,
    gym: values.filter((k) => k === 'gym').length,
    kinds,
    gymSessions: gym.length,
    gymSets: gym.reduce((n, s) => n + s.exercises.reduce((m, e) => m + e.sets.filter((x) => !x.warmup && x.reps > 0).length, 0), 0),
  }
}

/** What Home leads with today: the coach's one main session, or rest with a way to train anyway. */
export function homeToday(plan: TodayPlan): 'rest' | 'gym' | 'calisthenics' {
  if (plan.rest || plan.kind === 'rest') return 'rest'
  return plan.kind === 'gym' && plan.gym ? 'gym' : plan.skill ? 'calisthenics' : 'rest'
}

/**
 * Whether Train offers the max test card: not to a brand-new athlete (the
 * first session comes first), and not on a day the test is blocked — the card
 * once sat there saying "Not today".
 */
export function maxTestOffered(state: AppState, blockedReason: string | null | undefined): boolean {
  return state.sessions.length > 0 && !blockedReason
}

/** A skill day previewed on a pain day: the session built is the pain-safe one, and the preview says so. */
export function becamePainSafe(request: WorkoutRequest | null, workout: Workout | null, isPainSafe: (w: Workout) => boolean): boolean {
  return Boolean(request?.skills?.length && workout && isPainSafe(workout))
}
