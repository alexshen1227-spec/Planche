import type { BodyRegion, EquipmentId, SkillId, StepId, Weekday } from '../types'
import { kitNeedsPhrase } from '../data/equipment'
import { missingKit, SKILLS } from '../data/skills'
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
    // a skill that loads a flagged joint (`standingNiggle`: flagged today, or
    // earlier with no check-in since).
    const flagged = leftOut.some((skill) => sore.some((region) => SKILLS[skill].loads.includes(region)))
    lines.push(
      `${capitalised(skillWords(leftOut))} ${leftOut.length === 1 ? 'is' : 'are'} left out of today's session: a ${minutes}-minute session has room for ${roomIn(
        minutes,
      )}${flagged ? ', and a short dose is not given to a skill that loads a joint you flagged and have not cleared' : ''}.`,
    )
  }
  return lines.join(' ')
}

/** Kit an athlete brings from place to place; a doorway bar or a wall at home is not at the gym (the planner's `PORTABLE_KIT`). */
const CARRIED_KIT: EquipmentId[] = ['floor', 'parallettes', 'band', 'rings']

export interface KitPlace {
  name: string
  equipment: readonly string[]
}

/** The places where a skill the athlete's own list cannot train has what it needs: their portable kit and the place's own list together. */
export function placesWithKit(skill: SkillId, own: EquipmentId[], places: readonly KitPlace[], step?: StepId): string[] {
  const carried = own.filter((id) => CARRIED_KIT.includes(id))
  return places
    .filter((place) => missingKit(skill, [...new Set([...carried, ...(place.equipment as EquipmentId[])])], step).length === 0)
    .map((place) => place.name)
}

/**
 * Whether the only thing a skill waits for is a clear wall — the handstand
 * with a bar, barbell, dumbbells and machines at a gym and no wall ticked read
 * "waiting for kit" with nothing saying which kit or where.
 */
export function onlyWallMissing(missing: readonly (readonly EquipmentId[])[]): boolean {
  return missing.length > 0 && missing.every((options) => options.length === 1 && options[0] === 'wall')
}

/** Says where to tick it. It never says the athlete has one: the app cannot know. */
export const WALL_TICK_HINT = 'Tick ‘Clear wall’ under a place that has one (Settings → Equipment, or a place’s own kit) — most gyms and many homes do.'

/**
 * What to say about a skill the athlete's own kit cannot train: where it does
 * train, or what it is waiting for. "Front lever is waiting for kit" once sat
 * on Home beside a Gym A that has a pull-up bar.
 */
export function kitStatusLine(skill: SkillId, own: EquipmentId[], places: readonly KitPlace[], step?: StepId): { kind: 'ready' } | { kind: 'at-places'; text: string } | { kind: 'waiting'; text: string } {
  const missing = missingKit(skill, own, step)
  if (missing.length === 0) return { kind: 'ready' }
  const name = SKILLS[skill].name
  const at = placesWithKit(skill, own, places, step)
  if (at.length) {
    const where = at.length === 1 ? at[0] : `${at.slice(0, -1).join(', ')} and ${at[at.length - 1]}`
    return { kind: 'at-places', text: `${name} trains at ${where} — ${kitNeedsPhrase(missing)} is there. At home it waits for that kit.` }
  }
  if (onlyWallMissing(missing)) return { kind: 'waiting', text: `${name} is waiting for a clear wall. ${WALL_TICK_HINT}` }
  return { kind: 'waiting', text: `${name} is waiting for kit. ${SKILLS[skill].requiresNote ?? `It needs ${kitNeedsPhrase(missing)}.`}` }
}

/**
 * A skill day the kit where the athlete is cannot build: the places that have
 * what it needs, or what to add. "Add it under Settings → Equipment" once sat
 * on the front lever day while the athlete's gym had the bar.
 */
export function skillDayKitNote(skill: SkillId, needs: string, own: EquipmentId[], places: readonly KitPlace[], here?: string, step?: StepId): string {
  const at = placesWithKit(skill, own, places, step).filter((name) => name !== here)
  if (!at.length) return `Waiting for kit — needs ${needs}. Add it under Settings → Equipment.`
  const where = at.length === 1 ? at[0] : `${at.slice(0, -1).join(', ')} and ${at[at.length - 1]}`
  return `Needs ${needs}, which ${where} ${at.length === 1 ? 'has' : 'have'} — choose ${at.length === 1 ? 'it' : 'one'} under Gym → Where are you training?`
}

/** A skill chip's spoken name: "Planche" and its "main" badge need a break between them for a screen reader. */
export function skillChipLabel(skill: SkillId, isMain: boolean): string {
  return isMain ? `${SKILLS[skill].name}, main skill` : SKILLS[skill].name
}

/**
 * What the streak counts, said beside the number: "0-week streak" sat next to
 * "trained today ✓" with nothing to say it counts weeks that met the goal, and
 * that this week is still open. A zero is "no streak yet", never a failure.
 */
export function streakText(streak: { weeks: number; currentMet: boolean }, goal: number): { main: string; note: string } {
  const sessions = `${goal} session${goal === 1 ? '' : 's'}`
  if (streak.weeks > 0) {
    return {
      main: `${streak.weeks}-week streak`,
      note: `Weeks that met your goal of ${sessions}${streak.currentMet ? '' : ' — this week is still open'}`,
    }
  }
  return { main: 'No streak yet', note: `It counts weeks that met your goal of ${sessions}; this week is still open` }
}
