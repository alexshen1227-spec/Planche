import type { ActivityKind, GymState, OutsideActivity, SportSlot } from '../gym/types'
import { dayKey } from '../time'

/**
 * The athlete's sport, as the planner sees it: what they logged, plus their
 * regular sport week (`prefs.sportSchedule`) read as if each session happened
 * as usual. A log on the same local day replaces that day's scheduled
 * session, so a changed practice is counted once, as logged.
 */

export interface SportEvent extends OutsideActivity {
  /** True when this comes from the regular sport week rather than a log. */
  scheduled: boolean
}

const DEFAULT_HOUR = 17

/**
 * Hard enough to plan the legs around: a game, a sprint session, or anything
 * the athlete rates 7 or more that loads the legs. The app's own rule of
 * thumb, not a measured threshold.
 */
export function isHardForLegs(a: Pick<OutsideActivity, 'legs' | 'rpe' | 'kind'>): boolean {
  return a.legs && isHardSport(a)
}

/** A hard session of any kind: the day after one is never a push day. */
export function isHardSport(a: Pick<OutsideActivity, 'rpe' | 'kind'>): boolean {
  return a.rpe >= 7 || a.kind === 'game' || a.kind === 'sprint'
}

const KIND_NAME: Record<ActivityKind, string> = {
  sprint: 'sprint session',
  practice: 'practice',
  game: 'game',
  pe: 'PE',
  run: 'run',
  other: 'activity',
}

/** "practice", "game", "PE" — for a sentence. */
export function sportName(kind: ActivityKind): string {
  return KIND_NAME[kind]
}

/** The regular sport week's sessions that fall in [from, to), one per matching local day. */
export function scheduledSport(schedule: SportSlot[] | undefined, from: number, to: number): SportEvent[] {
  if (!schedule?.length || !(to > from)) return []
  const out: SportEvent[] = []
  const day = new Date(from)
  day.setHours(0, 0, 0, 0)
  // Calendar days, not 24-hour steps: a daylight-saving change must not skip or repeat one.
  for (let guard = 0; day.getTime() < to && guard < 400; guard++) {
    const slot = schedule.find((s) => s.weekday === day.getDay())
    if (slot) {
      const at = new Date(day)
      at.setHours(slot.hour ?? DEFAULT_HOUR, 0, 0, 0)
      const t = at.getTime()
      if (t >= from && t < to) {
        out.push({ id: `sport-${dayKey(t)}`, at: t, kind: slot.kind, minutes: slot.minutes, rpe: slot.rpe, legs: slot.legs, updatedAt: 0, scheduled: true })
      }
    }
    day.setDate(day.getDate() + 1)
  }
  return out
}

/** Logged activities and the regular sport week in [from, to), oldest first. */
export function sportBetween(gym: Pick<GymState, 'activities' | 'prefs'> | undefined, from: number, to: number): SportEvent[] {
  const logs = gym?.activities ?? []
  const loggedDays = new Set(logs.map((a) => dayKey(a.at)))
  const logged = logs.filter((a) => a.at >= from && a.at < to).map((a): SportEvent => ({ ...a, scheduled: false }))
  const usual = scheduledSport(gym?.prefs?.sportSchedule, from, to).filter((s) => !loggedDays.has(dayKey(s.at)))
  return [...logged, ...usual].sort((a, b) => a.at - b.at)
}
