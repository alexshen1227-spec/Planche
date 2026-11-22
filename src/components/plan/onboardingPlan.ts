import { GYM_EQUIPMENT_BY_ID } from '../../data/gym/catalog'
import type { GymLocation } from '../../lib/gym/types'

/**
 * What the first-run schedule means for the two settings the old "how often"
 * screen used to ask for. The weekly schedule is the one question now; these
 * are read off it so the streak goal and the session length cannot disagree
 * with the plan the athlete just made.
 */
export interface ScheduleSummary {
  /** Days with any minutes set: the days the athlete said they can train. */
  days: number
  /** The typical minutes on a training day (median, to the nearest 5), or undefined with no training day. */
  typicalMinutes: number | undefined
  /** `settings.weeklyGoal`: one session a training day, 1–7. */
  weeklyGoal: number
  /** `settings.sessionMinutes`: the typical day, kept inside the 15–60 range the app offers. */
  sessionMinutes: number
}

/** What the reducer keeps when nothing is said (matches DEFAULT_SETTINGS). */
const FALLBACK_GOAL = 3
const FALLBACK_MINUTES = 45
export const MIN_SESSION_MINUTES = 15
export const MAX_SESSION_MINUTES = 60

export function summariseSchedule(minutesByDay: readonly number[]): ScheduleSummary {
  const trained = minutesByDay.filter((m) => Number.isFinite(m) && m > 0).sort((a, b) => a - b)
  if (trained.length === 0) {
    return { days: 0, typicalMinutes: undefined, weeklyGoal: FALLBACK_GOAL, sessionMinutes: FALLBACK_MINUTES }
  }
  const mid = Math.floor(trained.length / 2)
  const median = trained.length % 2 ? trained[mid] : (trained[mid - 1] + trained[mid]) / 2
  const typical = Math.max(5, Math.round(median / 5) * 5)
  return {
    days: trained.length,
    typicalMinutes: typical,
    weeklyGoal: Math.min(7, trained.length),
    sessionMinutes: Math.min(MAX_SESSION_MINUTES, Math.max(MIN_SESSION_MINUTES, typical)),
  }
}

/** Three weekday sessions: what the old first run defaulted to, so a skipped schedule changes nothing. */
export const STARTING_MINUTES_BY_DAY = [0, 45, 0, 45, 0, 45, 0]

/** A birth year the app accepts: a whole year, 1920 or later, at least six years ago. */
export function parseBirthYear(text: string, now = new Date()): number | undefined {
  const year = Number(text.trim())
  return Number.isInteger(year) && year >= 1920 && year <= now.getFullYear() - 6 ? year : undefined
}

const hasGymKit = (l: Pick<GymLocation, 'equipment'>) => l.equipment.some((e) => e in GYM_EQUIPMENT_BY_ID)

/**
 * Where sessions are built for. Home, unless Home has no gym kit and a gym was
 * added here: then the first gym that has some, as in the Fitness Lab setup.
 */
export function activeLocationFor(home: Pick<GymLocation, 'id' | 'equipment'>, added: GymLocation[]): string {
  if (hasGymKit(home)) return home.id
  return added.find(hasGymKit)?.id ?? home.id
}
