import type { BodyRegion, SkillId, Weekday } from '../types'
import { SKILLS } from '../data/skills'
import { roomIn } from '../lib/lineup'
import { describeDay, WEEKDAY_NAMES, type DayReading, type PlanCoverage } from '../lib/weekPlan'

/**
 * What the week plan's screens say, kept apart from the screens so every
 * branch can be read and tested without a browser.
 *
 * The plan is the athlete's own. Nothing here calls a split good, and the
 * sentence about today describes the plan — when today's session cannot follow
 * it (a pain-safe day, a skill the time has no room for) it says so rather
 * than leaving "today is your front lever day" beside a session that is not.
 */

/** "planche", "planche and front lever", "planche, front lever and human flag". */
export function skillWords(skills: readonly SkillId[]): string {
  const names = skills.map((skill) => SKILLS[skill].name.toLowerCase())
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Why skills a day names cannot train right now. `readDay` leaves a skill out
 * for exactly two reasons: it is on the athlete's list but its kit is not, or
 * it is no longer on the list.
 */
export function whyNot(unavailable: readonly SkillId[], active: readonly SkillId[]): string {
  const waiting = unavailable.filter((skill) => active.includes(skill)).length
  if (waiting === unavailable.length) return 'waiting for kit'
  if (waiting === 0) return 'not in your skills now'
  return 'not trainable right now'
}

/** "Front lever is waiting for kit" — for a day that names skills it cannot train. */
export function unavailableClause(unavailable: readonly SkillId[], active: readonly SkillId[]): string {
  return `${capitalised(skillWords(unavailable))} ${unavailable.length === 1 ? 'is' : 'are'} ${whyNot(unavailable, active)}`
}

function counted(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/**
 * A plan's week in one line: "Planche 2 days · Front lever 2 days · 4 days
 * left to the coach". A third place on a day is a short dose, not a day of
 * training, so it is counted apart; days left to the coach are counted for no
 * skill, because who trains on them is not fixed. Null while nothing is set.
 */
export function coverageSummary(coverage: PlanCoverage): string | null {
  if (coverage.trainingDays === 0 && coverage.restDays === 0) return null
  const parts =
    coverage.trainingDays === 0
      ? ['No training days']
      : coverage.skills.map(({ skill, full, short }) => {
          const name = SKILLS[skill].name
          if (short === 0) return `${name} ${counted(full, 'day')}`
          return full === 0 ? `${name} ${counted(short, 'short dose')}` : `${name} ${counted(full, 'day')} + ${counted(short, 'short dose')}`
        })
  if (coverage.restDays > 0) parts.push(counted(coverage.restDays, 'rest day'))
  if (coverage.openDays > 0) parts.push(`${counted(coverage.openDays, 'day')} left to the coach`)
  return parts.join(' · ')
}

export interface TodayLineInput {
  /** `todaysDay(state, now)`. */
  today: DayReading
  /** `nextPlannedDay(state, now)`. */
  next: { weekday: Weekday; skills: SkillId[] } | null
  /** Whether any week plan is saved. */
  hasPlan: boolean
  /** The skills the athlete trains (`activeSkills`). */
  active: readonly SkillId[]
  /** The session length the recommended session is built for, to say what it has room for. */
  minutes: number
  /**
   * The skills today's recommended session trains once the rails have run,
   * lead first — empty when it trains none of them (the pain-safe session).
   * Absent = not known here, and the sentence speaks for the plan alone.
   */
  sessionSkills?: readonly SkillId[]
  /** Areas named in a niggle reported today (`niggleRegionsToday`). */
  sore?: readonly BodyRegion[]
}

/** The one thing the "Your week" card says about today. */
export function todayLine({ today, next, hasPlan, active, minutes, sessionSkills, sore = [] }: TodayLineInput): string {
  const several = active.length > 1
  const nextUp = next ? `${WEEKDAY_NAMES[next.weekday]} — ${describeDay(next.skills)}` : null

  if (today.kind === 'rest') {
    return `Rest day in your plan.${nextUp ? ` Next: ${nextUp}.` : ''} Starting a session anyway is fine${
      several ? ' — the coach then decides what it trains' : ''
    }.`
  }

  if (today.kind === 'open') {
    if (today.unavailable.length) {
      const one = today.unavailable.length === 1
      return `Today is set to ${skillWords(today.unavailable)} in your plan, but ${one ? 'it is' : 'they are'} ${whyNot(
        today.unavailable,
        active,
      )}, so the coach decides today.`
    }
    if (!hasPlan) {
      return several
        ? 'Give each training day its skill, or leave it to the coach.'
        : 'Mark your training days and rest days, or leave the week open.'
    }
    return `Nothing is set for today${several ? ', so the coach decides' : ''}.${nextUp ? ` Next in your plan: ${nextUp}.` : ''}`
  }

  const { skills, unavailable } = today
  const named = `Today is your ${skillWords(skills)} day`
  // What was reported outranks the plan: a pain-safe session trains none of it.
  if (sessionSkills && sessionSkills.length === 0) {
    return `${named} in your plan, but today's session is the pain-safe one — what you reported comes first.`
  }
  const lines = [`${named}${skills.length > 1 ? `, ${skillWords(skills.slice(0, 1))} first` : ''}.`]
  if (unavailable.length) {
    const one = unavailable.length === 1
    lines.push(
      `${capitalised(skillWords(unavailable))} ${one ? 'is' : 'are'} in your plan for today too, but ${one ? 'it is' : 'they are'} ${whyNot(
        unavailable,
        active,
      )}.`,
    )
  }
  const leftOut = sessionSkills ? skills.filter((skill) => !sessionSkills.includes(skill)) : []
  if (leftOut.length) {
    // The line-up leaves a planned skill out for two reasons only, and gives
    // both in these words: no room in the time, or a short dose withheld from
    // a skill that loads what was flagged today.
    const flagged = leftOut.some((skill) => sore.some((region) => SKILLS[skill].loads.includes(region)))
    lines.push(
      `${capitalised(skillWords(leftOut))} ${leftOut.length === 1 ? 'is' : 'are'} left out of today's session: a ${minutes}-minute session has room for ${roomIn(
        minutes,
      )}${flagged ? ', and a short dose is not given to a skill that loads a joint you flagged today' : ''}.`,
    )
  }
  return lines.join(' ')
}
