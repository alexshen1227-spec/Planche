import type { AppState, SkillId } from '../../types'
import { familyEvents, familyWorkingSets, HARD_GYM_FAMILY_SETS } from './load'
import { defaultPrefs } from '../gym/state'
import type { TrainingPrefs } from '../gym/types'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Which straight-arm family a skill's hard work belongs to. The handstand is balance work. */
export function skillFamily(skill: SkillId): 'push' | 'pull' | 'balance' {
  if (skill === 'planche' || skill === 'ninety') return 'push'
  if (skill === 'frontlever' || skill === 'flag') return 'pull'
  return 'balance'
}

export const startOfDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Rest between two days, counted in calendar days: two 5 pm anchors are 47
 * hours apart across a spring-forward change, and a 48 h rule then pushed a
 * session out a day.
 */
export const apart = (a: number, b: number) => Math.round(Math.abs(startOfDay(a) - startOfDay(b)) / DAY) * DAY

/**
 * How far a logged session's real hours may fall short of the rest rule on a
 * day the calendar already clears: a late session followed by an early one —
 * Sunday 21:00, then Tuesday 07:00 under a 48 h rule — is still refused; a
 * 17:40 session and the 17:00 one two days later are not. The app's own line.
 */
export const REST_SLACK_HOURS = 12

/**
 * Whether a logged session at `earlier` still rests its family at `later`.
 * In calendar days, the unit planned days are spaced in: a push day's lifts are
 * stamped when they start, after the opener, and in real hours Monday's 17:40
 * lifts refused the Wednesday 17:00 planche day the plan had promised (47 h).
 * A session's event is the moment it started; the real hours decide only a
 * genuinely short gap — more than `REST_SLACK_HOURS` under the rule — with an
 * hour allowed for a clock change.
 */
export function insideRest(later: number, earlier: number, restMs: number): boolean {
  if (apart(later, earlier) < restMs) return true
  const floor = restMs - REST_SLACK_HOURS * HOUR
  const real = later - earlier
  const wall = real - (new Date(later).getTimezoneOffset() - new Date(earlier).getTimezoneOffset()) * 60_000
  return real < floor && wall < floor
}

/** A logged visit has a known start. Future days use their projected training time. */
export function restWindow(prefs: Pick<TrainingPrefs, 'straightArmRestHours' | 'exactRestHours'>) {
  const duration = prefs.straightArmRestHours * HOUR
  const elapsed = (a: number, b: number) => Math.abs(a - b) < duration
  if (prefs.exactRestHours) return { fromLog: elapsed, betweenPlans: elapsed }
  return {
    fromLog: (later: number, earlier: number) => insideRest(later, earlier, duration),
    betweenPlans: (a: number, b: number) => apart(a, b) < duration,
  }
}

export function restHoursApart(a: number, b: number, exact = false): number {
  const hours = Math.abs(a - b) / HOUR
  return exact ? Math.floor(hours) : Math.round(hours)
}

/** Maximal holds share recovery with hard work from their own pressing or pulling family. */
export function holdRestWindow(state: AppState, skill: SkillId, now: number) {
  const family = skillFamily(skill)
  if (family === 'balance') return undefined
  const prefs = state.gym?.prefs ?? defaultPrefs(now)
  const recovery = restWindow(prefs)
  const ruleHours = prefs.straightArmRestHours
  const hit = familyEvents(state, now)[family].filter((e) => recovery.fromLog(now, e.at)).at(-1)
  if (!hit) return undefined
  return { hours: Math.max(1, restHoursApart(now, hit.at, prefs.exactRestHours)), ruleHours }
}

/** Actual compound lifting in the recovery window, including two short visits on the same day. */
export function recentGymWork(state: AppState, now: number): Partial<Record<'push' | 'pull', { sets: number; at: number }>> {
  const recovery = restWindow(state.gym?.prefs ?? defaultPrefs(now))
  const days = new Map<number, { push: number; pull: number; at: number }>()
  for (const session of state.gym?.sessions ?? []) {
    if (session.startedAt > now || !recovery.fromLog(now, session.startedAt)) continue
    const date = startOfDay(session.startedAt)
    const entry = days.get(date) ?? { push: 0, pull: 0, at: 0 }
    const working = familyWorkingSets(session.exercises, now)
    entry.push += working.push
    entry.pull += working.pull
    entry.at = Math.max(entry.at, session.startedAt)
    days.set(date, entry)
  }
  const result: Partial<Record<'push' | 'pull', { sets: number; at: number }>> = {}
  for (const day of days.values()) for (const f of ['push', 'pull'] as const) {
    if (day[f] >= HARD_GYM_FAMILY_SETS && day.at > (result[f]?.at ?? 0)) result[f] = { sets: day[f], at: day.at }
  }
  return result
}
