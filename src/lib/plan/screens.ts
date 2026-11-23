import type { AppState, SkillId, StepId, Workout, WorkoutRequest } from '../../types'
import { STEP_BY_ID, stepAfter } from '../../data/progressions'
import { qualifyingProgress } from '../progression'
import { addDays, dayKey, weekStart } from '../time'
import { skillFamily, type SkillBlock, type TodayPlan } from './planner'

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

const OPENER_HOLDS: Record<SkillId, string> = {
  planche: 'planche holds',
  frontlever: 'front lever holds',
  handstand: 'handstand practice',
  ninety: '90° holds',
  flag: 'human flag holds',
}

/**
 * A gym day's opener in words, honest about what it holds: the skill's holds
 * while fresh, and its family's strength work with the lifts. "Opens with
 * planche (18 min)" once stood for a warm-up, four short holds and a cooldown.
 */
export function openerLine(block: Pick<SkillBlock, 'skills' | 'minutes'>): string {
  const skill = block.skills[0]
  const family = skillFamily(skill)
  const work = family === 'push' ? 'the pressing' : family === 'pull' ? 'the pulling' : 'the strength work'
  return `Opens with ${OPENER_HOLDS[skill]} (${block.minutes} min); ${work} comes with the lifts`
}

/**
 * What the calisthenics session card is to today: today's session on a
 * calisthenics day, and otherwise the alternative to what the coach planned —
 * on a gym day it once sat unlabelled under "the coach recommends the gym".
 */
export function calisthenicsCardLabel(plan: TodayPlan): string {
  const mode = homeToday(plan)
  return mode === 'calisthenics' ? 'Today’s calisthenics' : mode === 'gym' ? 'Instead of the gym: a calisthenics session' : 'If you train anyway: a calisthenics session'
}

/**
 * Where the goal stands against the step being trained. A goal that is the
 * current step is reached only once that step is passed — its bar verified,
 * or a later step open: a brand-new athlete placed on their goal once read
 * "goal reached" at 0%.
 */
export function goalStanding(current: { order: number }, goal: { order: number }, passed: boolean): 'ahead' | 'here' | 'reached' {
  if (goal.order > current.order) return 'ahead'
  if (goal.order < current.order) return 'reached'
  return passed ? 'reached' : 'here'
}

/** Said when the goal is the step the athlete is on and not yet passed. */
export const GOAL_HERE_TEXT = 'Your goal is the step you are on: hold it clean to complete it.'

/** Whether a skill view is past a step: the step after it open, or — on the last step — its bar verified. */
export function stepPassed(view: AppState, stepId: StepId): boolean {
  const next = stepAfter(stepId)
  if (next) return view.unlocked.includes(next.id)
  const step = STEP_BY_ID[stepId]
  return Boolean(step) && qualifyingProgress(view, stepId).value >= step.unlockSec
}
