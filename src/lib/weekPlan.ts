import type { AppState, DayPlan, SkillId, WeekPlan, Weekday } from '../types'
import { SKILL_IDS } from '../types'
import { missingKit, skillOfExercise, SKILLS } from '../data/skills'
import { activeSkills, wholeState } from './skills'
import { addDays, weekStart } from './time'

/**
 * The athlete's own week: which skills each weekday is for.
 *
 * Left alone, the coach shares every session between the athlete's skills by
 * priority and by who has waited longest. That is a reasonable default and not
 * what everyone wants: someone training Saturday, Sunday and Wednesday may
 * want a front lever day, a planche day and a day for both. A weekday set here
 * is honoured as written — the first skill leads, a second gets a full part, a
 * third a short dose — and a weekday left out is still the coach's to decide.
 *
 * Nothing here is a claim about what is best. How to spread skills across a
 * week has not been tested in any trial for these skills (ledger §13.2); this
 * is the athlete's schedule, and the copy says "your plan", never "optimal".
 *
 * "Today" is the athlete's local calendar day, like everywhere else.
 */

export const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6]
/** Monday first — the order the app's week runs in (`weekStart`). */
export const WEEK_ORDER: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 0]
export const WEEKDAY_NAMES: Record<Weekday, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
}
export const WEEKDAY_SHORT: Record<Weekday, string> = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' }

/** Skills one day can be given: a lead, a partner and one short dose. */
export const MAX_SKILLS_PER_DAY = 3

/** The local weekday a moment falls on. */
export function weekdayOf(now: number): Weekday {
  return new Date(now).getDay() as Weekday
}

/**
 * A week plan from storage or an import, validated day by day. Unknown days
 * and skills are dropped, a skill named twice counts once, and an empty day is
 * the same as a day left out. Returns undefined when nothing is left.
 */
export function sanitizeWeekPlan(raw: unknown): WeekPlan | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const out: WeekPlan = {}
  for (const day of WEEKDAYS) {
    const value = (raw as Record<string, unknown>)[String(day)]
    if (value === 'rest') {
      out[day] = 'rest'
      continue
    }
    if (!Array.isArray(value)) continue
    const skills = [...new Set(value.filter((skill): skill is SkillId => typeof skill === 'string' && SKILL_IDS.includes(skill as SkillId)))].slice(
      0,
      MAX_SKILLS_PER_DAY,
    )
    if (skills.length) out[day] = skills
  }
  return Object.keys(out).length ? out : undefined
}

/** Weekdays a plan trains on. */
export function plannedTrainingDays(plan: WeekPlan | undefined): number {
  return WEEKDAYS.filter((day) => Array.isArray(plan?.[day])).length
}

/** What a weekday is set aside for, as the athlete can train it right now. */
export type DayReading =
  /** Skills assigned, in order — only those still trained and with their kit to hand. */
  | { kind: 'skills'; weekday: Weekday; skills: SkillId[]; unavailable: SkillId[] }
  /** A planned rest day. Training anyway is allowed; the coach then decides. */
  | { kind: 'rest'; weekday: Weekday }
  /** Not assigned — or assigned only to skills that cannot train now. The coach decides. */
  | { kind: 'open'; weekday: Weekday; unavailable: SkillId[] }

/** Read one weekday of the athlete's plan. */
export function readDay(stateIn: AppState, weekday: Weekday): DayReading {
  const state = wholeState(stateIn)
  const assigned = state.settings.weekPlan?.[weekday]
  if (assigned === 'rest') return { kind: 'rest', weekday }
  if (!assigned?.length) return { kind: 'open', weekday, unavailable: [] }
  const active = activeSkills(state)
  const can = (skill: SkillId) => active.includes(skill) && missingKit(skill, state.profile.equipment).length === 0
  const skills = assigned.filter(can)
  const unavailable = assigned.filter((skill) => !can(skill))
  // A day whose skills were all dropped, or all wait for kit, is not a rest
  // day and not a session of nothing: it goes back to the coach, and the
  // screens say why.
  return skills.length ? { kind: 'skills', weekday, skills, unavailable } : { kind: 'open', weekday, unavailable }
}

/** Today's reading. */
export function todaysDay(state: AppState, now = Date.now()): DayReading {
  return readDay(state, weekdayOf(now))
}

/** "Planche", "Planche + Front lever", "Rest", or "Coach decides". */
export function describeDay(day: DayPlan | undefined): string {
  if (day === 'rest') return 'Rest'
  if (!day?.length) return 'Coach decides'
  return day.map((skill) => SKILLS[skill].name).join(' + ')
}

/** The next day after today the plan trains on: how far ahead, and what for. */
export function nextPlannedDay(state: AppState, now = Date.now()): { weekday: Weekday; daysAhead: number; skills: SkillId[] } | null {
  const today = weekdayOf(now)
  for (let ahead = 1; ahead <= 7; ahead++) {
    const reading = readDay(state, ((today + ahead) % 7) as Weekday)
    if (reading.kind === 'skills') return { weekday: reading.weekday, daysAhead: ahead, skills: reading.skills }
  }
  return null
}

export interface PlanCoverage {
  /** Per skill the athlete trains: days a week it has a full part (first or second on a day), and days it has a short dose (third). */
  skills: { skill: SkillId; full: number; short: number }[]
  trainingDays: number
  restDays: number
  /** Days left to the coach — who trains on them is not fixed, so they are not counted for any skill. */
  openDays: number
}

/** How the plan, as written, spreads the athlete's skills over the week. */
export function planCoverage(stateIn: AppState, plan: WeekPlan | undefined = wholeState(stateIn).settings.weekPlan): PlanCoverage {
  const state = wholeState(stateIn)
  const days = WEEKDAYS.map((day) => plan?.[day])
  const count = (skill: SkillId, positions: (index: number) => boolean) =>
    days.filter((day) => Array.isArray(day) && day.some((entry, index) => entry === skill && positions(index))).length
  return {
    skills: activeSkills(state).map((skill) => ({ skill, full: count(skill, (i) => i < 2), short: count(skill, (i) => i >= 2) })),
    trainingDays: days.filter((day) => Array.isArray(day) && day.length > 0).length,
    restDays: days.filter((day) => day === 'rest').length,
    openDays: days.filter((day) => day === undefined || (Array.isArray(day) && day.length === 0)).length,
  }
}

/**
 * What is worth saying about a plan before it is saved — only when the plan
 * itself settles the question, which it does not while any day is left to the
 * coach. Twice a week or more is what coaches commonly ask of a skill being
 * built (each skill's own page says so); it is convention, no trial has
 * compared weekly frequencies for these holds, and the note says that.
 */
export function coverageNotes(state: AppState, plan: WeekPlan | undefined): string[] {
  const coverage = planCoverage(state, plan)
  if (coverage.trainingDays === 0 || coverage.openDays > 0) return []
  const notes: string[] = []
  for (const { skill, full, short } of coverage.skills) {
    const name = SKILLS[skill].name
    if (full === 0 && short === 0) {
      notes.push(`${name} is in none of your days, so with this plan it is not trained at all. Add it to a day, or leave a day to the coach.`)
    } else if (full === 0) {
      notes.push(`${name} only ever gets a short dose in this plan — enough to keep a position, not to build one.`)
    } else if (full === 1) {
      notes.push(
        `${name} has one full day a week in this plan. Coaches commonly train a skill they are building two or three times a week — a convention, not something a trial has tested for these holds.`,
      )
    }
  }
  return notes
}

export interface WeekOutlineDay {
  weekday: Weekday
  /** Local midnight that starts the day. */
  startsAt: number
  isToday: boolean
  isPast: boolean
  plan: DayReading
  /** Skills that had work logged on this date (any session but a minimum dose). */
  trained: SkillId[]
  /** Whether any session was logged on this date. */
  sessionLogged: boolean
}

/** This week, Monday to Sunday: what each day is for and what was done on it. */
export function weekOutline(stateIn: AppState, now = Date.now()): WeekOutlineDay[] {
  const state = wholeState(stateIn)
  const start = weekStart(now)
  const today = new Date(now).setHours(0, 0, 0, 0)
  return WEEK_ORDER.map((weekday, i) => {
    const startsAt = addDays(start, i)
    const ends = addDays(start, i + 1)
    const sessions = state.sessions.filter((s) => s.startedAt >= startsAt && s.startedAt < ends && s.startedAt <= now && s.workoutKind !== 'micro')
    const trained = [
      ...new Set(
        sessions.flatMap((s) =>
          s.sets
            .filter((set) => set.section === 'main' && set.value > 0)
            .map((set) => skillOfExercise(set.exerciseId))
            .filter((skill): skill is SkillId => Boolean(skill)),
        ),
      ),
    ]
    return {
      weekday,
      startsAt,
      isToday: startsAt === today,
      isPast: startsAt < today,
      plan: readDay(state, weekday),
      trained,
      sessionLogged: sessions.length > 0,
    }
  })
}
