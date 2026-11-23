import { MUSCLE_BY_ID, MUSCLES } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import type { AppState } from '../../types'
import { estimateOneRepMax } from '../gym/progression'
import { defaultPrefs } from '../gym/state'
import type { GymSession } from '../gym/types'
import { addDays, dayKey, weekStart } from '../time'
import { setsPerMuscle, volumeStatus, volumeTarget } from './load'
import { gymDeloadDue, skillGoalPace } from './planner'

const DAY = 86_400_000

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
  // The first estimated max that beat an earlier one on the same lift.
  let firstPr: number | undefined
  const best = new Map<string, number>()
  for (const s of gym) {
    for (const log of s.exercises) {
      for (const set of log.sets) {
        if (set.warmup) continue
        const e = estimateOneRepMax(set, log.exerciseId)
        if (e === null) continue
        const had = best.get(log.exerciseId)
        if (had !== undefined && e > had + 0.01 && firstPr === undefined) firstPr = s.endedAt
        if (had === undefined || e > had) best.set(log.exerciseId, e)
      }
    }
  }
  // A step up earned: the same lift, same place, heavier working load than last time.
  let firstStep: number | undefined
  const lastLoad = new Map<string, number>()
  for (const s of gym) {
    for (const log of s.exercises) {
      // An assisted lift gets easier as the help goes down: a bigger number is not a step up.
      if (GYM_EXERCISE_BY_ID[log.exerciseId]?.assisted) continue
      const key = `${s.locationId}:${log.exerciseId}`
      const top = Math.max(0, ...log.sets.filter((x) => !x.warmup).map((x) => x.kg ?? 0))
      const had = lastLoad.get(key)
      if (had !== undefined && top > had && firstStep === undefined) firstStep = s.endedAt
      if (top > 0) lastLoad.set(key, top)
    }
  }
  // Skills and the gym in the same calendar week.
  let together: number | undefined
  const skillWeeks = new Set(state.sessions.map((s) => weekStart(s.startedAt)))
  for (const s of gym) {
    if (skillWeeks.has(weekStart(s.startedAt))) {
      together = s.endedAt
      break
    }
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

export function weeklySummary(state: AppState, now = Date.now()): WeeklySummary {
  const from = weekStart(now)
  const to = addDays(from, 7)
  const gym: GymSession[] = state.gym?.sessions ?? []
  const skill = state.sessions.filter((s) => s.startedAt >= from && s.startedAt < to)
  const gymWeek = gym.filter((s) => s.startedAt >= from && s.startedAt < to)
  const holdSec = skill.reduce(
    (sum, s) => sum + s.sets.filter((x) => x.kind === 'hold' && (x.section === 'main' || x.section === 'strength')).reduce((a, x) => a + x.value, 0),
    0,
  )
  const gymSets = gymWeek.reduce((n, s) => n + s.exercises.reduce((m, e) => m + e.sets.filter((x) => !x.warmup).length, 0), 0)
  const bestBefore = new Map<string, number>()
  for (const s of gym) {
    if (s.startedAt >= from) continue
    for (const e of s.exercises) for (const x of e.sets) {
      const v = estimateOneRepMax(x, e.exerciseId)
      if (v !== null && v > (bestBefore.get(e.exerciseId) ?? 0)) bestBefore.set(e.exerciseId, v)
    }
  }
  const newMaxes = new Set<string>()
  for (const s of gymWeek) for (const e of s.exercises) for (const x of e.sets) {
    if (x.warmup) continue
    const v = estimateOneRepMax(x, e.exerciseId)
    const before = bestBefore.get(e.exerciseId)
    if (v !== null && before !== undefined && v > before + 0.01) newMaxes.add(e.exerciseId)
  }
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
  const sets = setsPerMuscle(state.sessions, gym, from, to)
  const under = MUSCLES.map((m) => ({ m: m.id, done: sets[m.id] ?? 0, target: volumeTarget(m.id, prefs) }))
    .filter((x) => volumeStatus(x.done, x.target) === 'under' && x.target[0] > 0)
    .sort((a, b) => a.done / a.target[0] - b.done / b.target[0])
  const focus: string[] = []
  const priorityUnder = under.filter((x) => prefs.musclesPriority.includes(x.m))
  if (priorityUnder.length) {
    focus.push(`Your priority ${priorityUnder.length > 1 ? 'muscles' : 'muscle'} — ${priorityUnder.map((x) => MUSCLE_BY_ID[x.m].label.toLowerCase()).join(', ')} — ${priorityUnder.length > 1 ? 'are' : 'is'} short of target this week.`)
  }
  for (const goal of prefs.skillGoals) {
    const pace = skillGoalPace(state, goal, now)
    if (pace.status === 'behind') focus.push(`${pace.text} More frequent skill sessions are the biggest lever.`)
  }
  if (skill.length === 0 && prefs.goals.skills > 0 && now - from > 3 * DAY) focus.push('No skill session yet this week — skills move with frequency, so get one in early next week.')
  const deload = gymDeloadDue(state, now)
  if (deload.due) focus.push('This is a lighter gym week — fewer sets, stopping further from failure (see Today’s reasons).')
  if (!priorityUnder.length && under.length >= 4) {
    focus.push(`Several muscles are under target so far (${under.slice(0, 3).map((x) => MUSCLE_BY_ID[x.m].label.toLowerCase()).join(', ')} and more) — the plan steers the rest of the week toward them.`)
  }
  return { from, skillSessions: skill.length, gymSessions: gymWeek.length, holdSec, gymSets, newMaxes: [...newMaxes], streakWeeks, focus }
}
