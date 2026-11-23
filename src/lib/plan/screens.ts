import type { AppState, SkillId, StepId, Workout, WorkoutRequest } from '../../types'
import { STEP_BY_ID, stepAfter } from '../../data/progressions'
import { qualifyingProgress } from '../progression'
import { addDays, dayKey, weekStart } from '../time'
import { missingKit } from '../../data/skills'
import { atActivePlace, insideRestRule, MIN_SKILL_MINUTES, planToday, skillFamily, type SkillBlock, type TodayPlan } from './planner'

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
export function maxTestOffered(state: AppState, blockedReason: string | null | undefined, now = Date.now()): boolean {
  return state.sessions.length > 0 && !blockedReason && !trainedToday(state, now)
}

/** Whether a session (skill or gym, a minimum dose aside) was logged today, by the athlete's calendar day. */
export function trainedToday(state: AppState, now = Date.now()): { skill: boolean; gym: boolean } | false {
  const from = startOfDay(now)
  const skill = state.sessions.some((s) => s.startedAt >= from && s.startedAt <= now && s.workoutKind !== 'micro')
  const gym = (state.gym?.sessions ?? []).some((s) => s.startedAt >= from && s.startedAt <= now)
  return skill || gym ? { skill, gym } : false
}

/**
 * Whether today's one main session is done: the lifts on a gym day (its
 * opener alone is half of it), and any session on another day. Once it is,
 * nothing more is recommended — "Today: done" once sat over "Calisthenics ·
 * 60 min — Again", with reasons why the planche needed it, and the Gym side
 * offered a 55-minute leg session.
 */
export function dayFinished(state: AppState, plan: Pick<TodayPlan, 'kind'>, now = Date.now()): boolean {
  const done = trainedToday(state, now)
  if (!done) return false
  return plan.kind === 'gym' ? done.gym : true
}

/**
 * Home's "Short on time?" through the coach: the plan for those minutes, as
 * "I have X min" plans it. It once built a hard planche session 22 hours after
 * heavy bench — inside the rest rule, on a day the coach had made a gym day —
 * and said nothing. A calisthenics day trains its own skills short; any other
 * day only skills outside the rest rule (never on a pain day), and with none
 * the reason is said instead of a session. Built where the athlete is.
 */
export function shortVersion(
  state: AppState,
  minutes: number,
  opts: { now?: number; kind?: 'calisthenics' | 'gym' } = {},
): { request: WorkoutRequest } | { reason: string } {
  const now = opts.now ?? Date.now()
  const plan = planToday(state, { now, minutes: Math.max(minutes, MIN_SKILL_MINUTES[1]), ...(opts.kind ? { kind: opts.kind } : {}) })
  if (plan.kind === 'calisthenics' && plan.skill && !plan.skill.opener) {
    return { request: atActivePlace(state, { source: 'auto', minutes, skills: plan.skill.skills }) }
  }
  const skills = (state.profile.skills?.length ? state.profile.skills : ['planche']) as SkillId[]
  const pain = plan.reasons.some((r) => r.startsWith('You reported pain'))
  const free = skills.filter((s) => !insideRestRule(state, [s], now) && missingKit(s, state.profile.equipment).length === 0)
  if (free.length && !pain) return { request: atActivePlace(state, { source: 'auto', minutes, skills: free }) }
  const rule = skills.map((s) => insideRestRule(state, [s], now)).find(Boolean)
  return {
    reason: rule
      ? `Your last ${rule.gym ? `heavy ${rule.family === 'push' ? 'pressing' : 'pulling'}` : 'hard straight-arm'} session was ${rule.hours} h ago — under your ${rule.ruleHours} h rest rule, so a short session of it waits too. Pick it on Train if you want it anyway.`
      : (plan.reasons[0] ?? 'Nothing short fits today.'),
  }
}

const startOfDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
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
