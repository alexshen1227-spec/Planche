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
  /** `settings.weeklyGoal`: one main session a training day, 1–7 — skill and gym days alike, as the streak counts them. */
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

/**
 * Three sessions of 45 minutes, every other day from today: a first run on a
 * Sunday once started on a rest day (the old default was Monday, Wednesday and
 * Friday, which it still is for a Monday start).
 */
export function startingMinutesByDay(now = new Date()): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0]
  for (const k of [0, 2, 4]) out[(now.getDay() + k) % 7] = 45
  return out
}

/** The first-run schedule as the app opens: `startingMinutesByDay` for the day it was opened. */
export const STARTING_MINUTES_BY_DAY: readonly number[] = startingMinutesByDay()

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
