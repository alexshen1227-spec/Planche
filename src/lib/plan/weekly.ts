import { countsSkillDay } from '../skillSession'
import { workingGymSets } from '../progressTotals'
import { MUSCLE_BY_ID, MUSCLES } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import type { AppState } from '../../types'
import { estimatedMaxGains } from '../gym/progression'
import { defaultPrefs } from '../gym/state'
import type { GymSession } from '../gym/types'
import { addDays, dayKey, weekStart } from '../time'
import { setsPerMuscle, volumeStatus, volumeTarget } from './load'
import { gymDeloadDue, planWeekAhead, PLANNABLE_MUSCLES, skillGoalPace, type WeekAhead } from './planner'

const DAY = 86_400_000

/** Skill sessions a week, over the last four weeks, under which frequency is a fair thing to name. */
export const LOW_SKILL_FREQUENCY = 3

/** Skill sessions per week over the four weeks before `now`, or fewer weeks when the athlete is newer (never a flat divide). */
export function skillSessionsPerWeek(state: Pick<AppState, 'sessions'>, now: number): number {
  const recent = state.sessions.filter((s) => s.startedAt <= now && s.startedAt > now - 28 * DAY && countsSkillDay(s))
  if (!recent.length) return 0
  const first = Math.min(...recent.map((s) => s.startedAt))
  const weeks = Math.max(1, Math.min(28, (now - first) / DAY) / 7)
  return recent.length / weeks
}

export interface GymBadge {
  id: string
  name: string
  desc: string
  icon: 'trophy' | 'flame' | 'target' | 'sparkle' | 'bolt' | 'route' | 'chart' | 'check'
  /** When it was earned, or absent when not yet. */
  at?: number
}

/**
 * Gym badges, derived by replaying history like every other record here —
 * never stored, so an edit or deletion can never leave a badge behind.
 */
export function gymBadges(state: Pick<AppState, 'sessions' | 'gym'>): GymBadge[] {
  const gym = [...(state.gym?.sessions ?? [])].sort((a, b) => a.startedAt - b.startedAt)
  const nth = (n: number) => gym[n - 1]?.endedAt
  const places = new Map<string, number>()
  for (const s of gym) if (!places.has(s.locationId)) places.set(s.locationId, s.endedAt)
  const secondPlace = [...places.values()].sort((a, b) => a - b)[1]
  // The first estimated max that beat an earlier session's on the same lift (the same place for a machine).
  const firstPr = estimatedMaxGains(gym)[0]?.endedAt
  // A step up earned: the same lift, same place, heavier working load than last time.
  let firstStep: number | undefined
  const lastLoad = new Map<string, number>()
  for (const s of gym) {
    const sessionLoads = new Map<string, number>()
    for (const log of s.exercises) {
      // An assisted lift gets easier as the help goes down: a bigger number is not a step up.
      if (GYM_EXERCISE_BY_ID[log.exerciseId]?.assisted) continue
      const key = `${s.locationId}:${log.exerciseId}`
      const top = Math.max(0, ...log.sets.filter((x) => !x.warmup && x.reps > 0).map((x) => x.kg ?? 0))
      if (top > 0) sessionLoads.set(key, Math.max(sessionLoads.get(key) ?? 0, top))
    }
    for (const [key, top] of sessionLoads) {
      const had = lastLoad.get(key)
      if (had !== undefined && top > had && firstStep === undefined) firstStep = s.endedAt
      lastLoad.set(key, top)
    }
  }
  // Skills and the gym in the same calendar week.
  let together: number | undefined
  const firstSkillEnd = new Map<number, number>()
  for (const skill of state.sessions.filter(countsSkillDay)) {
    const week = weekStart(skill.startedAt)
    firstSkillEnd.set(week, Math.min(firstSkillEnd.get(week) ?? Infinity, skill.endedAt ?? skill.startedAt))
  }
  for (const s of gym) {
    const skillAt = firstSkillEnd.get(weekStart(s.startedAt))
    if (skillAt !== undefined) together = Math.min(together ?? Infinity, Math.max(skillAt, s.endedAt))
  }
  const badge = (id: string, name: string, desc: string, icon: GymBadge['icon'], at?: number): GymBadge => ({
    id,
    name,
    desc,
    icon,
    ...(at !== undefined ? { at } : {}),
  })
  return [
    badge('gym-first', 'First lift', 'Log your first gym session.', 'check', nth(1)),
    badge('gym-together', 'Planned together', 'Train skills and the gym in the same week.', 'route', together),
    badge('gym-step', 'Earned the step', 'Lift a heavier working weight than last time on the same lift.', 'bolt', firstStep),
    badge('gym-pr', 'New estimated max', 'Beat an earlier estimated max on any lift.', 'trophy', firstPr),
    badge('gym-places', 'Two places', 'Train at a second place.', 'target', secondPlace),
    badge('gym-10', 'Ten gym sessions', 'Log ten gym sessions.', 'flame', nth(10)),
    badge('gym-25', 'Twenty-five gym sessions', 'Log twenty-five gym sessions.', 'flame', nth(25)),
    badge('gym-50', 'Fifty gym sessions', 'Log fifty gym sessions.', 'sparkle', nth(50)),
  ]
}

export interface WeeklySummary {
  from: number
  skillSessions: number
  gymSessions: number
  /** Seconds held in skill main work this week. */
  holdSec: number
  gymSets: number
  /** Lifts whose estimated max went up this week. */
  newMaxes: string[]
  /** Weeks in a row (this one included when it qualifies) with two or more training days. */
  streakWeeks: number
  /** What to focus on next week, most important first. Empty means nothing stands out. */
  focus: string[]
}

function trainingDays(state: Pick<AppState, 'sessions' | 'gym'>, from: number, to: number): number {
  const days = new Set<string>()
  for (const s of state.sessions) if (s.startedAt >= from && s.startedAt < to) days.add(dayKey(s.startedAt))
  for (const s of state.gym?.sessions ?? []) if (s.startedAt >= from && s.startedAt < to) days.add(dayKey(s.startedAt))
  return days.size
}

export function weeklySummary(state: AppState, now = Date.now(), week?: WeekAhead): WeeklySummary {
  const from = weekStart(now)
  const to = addDays(from, 7)
  const gym: GymSession[] = state.gym?.sessions ?? []
  const skill = state.sessions.filter((s) => s.startedAt >= from && s.startedAt < to)
  const gymWeek = gym.filter((s) => s.startedAt >= from && s.startedAt < to)
  const holdSec = skill.reduce(
    (sum, s) => sum + s.sets.filter((x) => x.kind === 'hold' && (x.section === 'main' || x.section === 'strength')).reduce((a, x) => a + x.value, 0),
    0,
  )
  const gymSets = gymWeek.reduce((n, s) => n + workingGymSets(s), 0)
  const newMaxes = [...new Set(estimatedMaxGains(gym).filter((g) => g.at >= from && g.at < to).map((g) => g.exerciseId))]
  let streakWeeks = 0
  for (let w = 0; w < 104; w++) {
    const start = addDays(from, -7 * w)
    const days = trainingDays(state, start, addDays(start, 7))
    if (days >= 2) streakWeeks++
    else if (w === 0) continue // this week is still under way
    else break
  }
  // Focus for next week, from the same numbers the plan uses.
  const prefs = state.gym?.prefs ?? defaultPrefs(now)
  const sets = setsPerMuscle(state.sessions, gym, from, now + 1)
  const under = MUSCLES.map((m) => ({ m: m.id, done: sets[m.id] ?? 0, target: volumeTarget(m.id, prefs) }))
    .filter((x) => volumeStatus(x.done, x.target) === 'under' && x.target[0] > 0)
    .sort((a, b) => a.done / a.target[0] - b.done / b.target[0])
  const focus: string[] = []
  // Nothing logged this week is nothing to compare with the weekly targets: a brand-new athlete was told several
  // muscles were under target and that the plan steered toward them, before a single session.
  const logged = skill.length + gymWeek.length > 0
  // The week can only be judged once most of it has happened (Friday on): a verdict on a Monday is a guess. Today's
  // plan names the muscles it steers toward from day one, so this card says the same instead of "nothing to compare".
  const judgeable = now - from >= 4 * DAY
  if (!logged) focus.push('Nothing logged this week yet, so no muscle has a count to judge — Today’s plan lists the muscles it is steering toward first.')
  const projection = logged && judgeable && under.length ? week ?? planWeekAhead(state, now) : undefined
  const priorityUnder = projection ? under.filter((x) => prefs.musclesPriority.includes(x.m) && (projection.weekTotal[x.m] ?? 0) < x.target[0]) : []
  if (priorityUnder.length) {
    for (const x of priorityUnder.slice(0, 2)) {
      const projected = Math.round((projection!.weekTotal[x.m] ?? 0) * 2) / 2
      focus.push(`You logged ${x.done} estimated sets for ${MUSCLE_BY_ID[x.m].label.toLowerCase()}. Completing the week as planned brings that to ${projected}. Your coaching range is ${x.target[0]}–${x.target[1]}.`)
    }
  }
  for (const goal of prefs.skillGoals) {
    const pace = skillGoalPace(state, goal, now)
    if (pace.status === 'behind') {
      // Frequency is only named when it is actually low, and never for a date that has simply passed.
      const lowFrequency = skillSessionsPerWeek(state, now) < LOW_SKILL_FREQUENCY && !/date has passed/.test(pace.text)
      focus.push(lowFrequency ? `${pace.text} You have trained skills under ${LOW_SKILL_FREQUENCY} times a week lately; coaches usually say more frequent practice helps skills (coaching convention, not a measured rule).` : pace.text)
    }
  }
  if (skill.length === 0 && prefs.goals.skills > 0 && now - from > 3 * DAY) focus.push('No skill session yet this week — coaches usually say regular practice matters for skills (a convention, not a measured rule), so plan one early next week.')
  const deload = gymDeloadDue(state, now)
  if (deload.due) focus.push('This is a lighter gym week — fewer sets, stopping further from failure (see Today’s reasons).')
  if (projection && !priorityUnder.length && under.length >= 4) {
    // Only what the days left can reach is said to be steered toward: the week as planned (`planWeekAhead`'s
    // shortfall), and no muscle that no gym focus plans for. Twelve weeks once said so while 13–18 of 21 muscles
    // stayed under every week.
    const short = new Set(projection.shortfall)
    const uncovered = under.filter((x) => short.has(x.m) || !PLANNABLE_MUSCLES.has(x.m))
    const names = (xs: typeof under) => xs.map((x) => MUSCLE_BY_ID[x.m].label.toLowerCase())
    if (!uncovered.length) {
      focus.push(`Several muscles are under target so far (${names(under.slice(0, 3)).join(', ')} and more) — the gym days planned for the rest of the week cover them.`)
    } else {
      const list = names(uncovered.slice(0, 4))
      const more = uncovered.length - list.length
      focus.push(
        `This week’s gym time cannot cover every muscle: ${list.join(', ')}${more > 0 ? ` and ${more} more` : ''} stay under the weekly target (the targets are coaching conventions).`,
      )
    }
  }
  return { from, skillSessions: skill.length, gymSessions: gymWeek.length, holdSec, gymSets, newMaxes, streakWeeks, focus }
}
