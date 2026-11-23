import type { AppState, EquipmentId, LineupRole, SkillId, Weekday } from '../../types'
import { kitNeedsPhrase } from '../../data/equipment'
import { missingKit, SKILLS } from '../../data/skills'
import { placesWithKit } from '../../components/weekPlanCopy'
import { roomIn } from '../lineup'
import { activeSkills } from '../skills'
import { WEEKDAY_NAMES } from '../weekPlan'
import { skillFamily, type WeekAhead } from './planner'

/**
 * Each of the athlete's skills, week by week: which days it trains, and where,
 * or the one plain reason it has no day. Pure — the week in, lines out — so
 * every branch can be tested without a screen.
 *
 * It reads the week as planned. It never promises a day the plan does not
 * hold: a skill with no day says so, and the days shown are a plan that is
 * planned again from what gets logged. How often a skill trains is a coaching
 * convention (ledger §13.2), and the copy on the screen says so.
 */

export type SkillWeekReason =
  /** Its kit is only at a place no day this week is planned at. */
  | 'kit-elsewhere'
  /** Its kit is at no place the athlete has added. */
  | 'kit-missing'
  /** The days that named it are the pain-safe session, which trains none of it. */
  | 'pain'
  /** Another skill of its family has the days the rest rule allows. */
  | 'rest-rule'
  /** The days that train skills are too short to hold it beside the others. */
  | 'no-room'
  /** No day this week trains any skill. */
  | 'no-skill-days'

export interface SkillWeekDay {
  /** Local calendar day, YYYY-MM-DD. */
  day: string
  /** Index in the week: 0 is today. */
  index: number
  /** "Today", or the weekday's name. */
  label: string
  role: LineupRole
  /** A gym day's opener: the skill starts the gym session. */
  opener: boolean
  /** The place it trains at: a gym or place the athlete named, or "home". */
  place: string
}

export interface SkillWeekLine {
  skill: SkillId
  name: string
  days: SkillWeekDay[]
  /** Why it has no day; absent when it has one. */
  reason?: { kind: SkillWeekReason; text: string }
  /** The line in words, for a screen reader and the list. */
  text: string
}

const ROLE_WORDS: Record<LineupRole, string> = {
  lead: 'first',
  partner: 'beside the lead',
  maintenance: 'short dose',
  practice: 'short balance practice',
}

function listed(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** One day's words: "Wed (first, at Gym A)". */
export function skillDayWords(d: SkillWeekDay): string {
  const how = d.opener ? `opens the gym session, at ${d.place}` : `${ROLE_WORDS[d.role]}, at ${d.place}`
  return `${d.label} (${how})`
}

export function skillWeekLines(week: WeekAhead, state: AppState): SkillWeekLine[] {
  const own = state.profile.equipment
  const locations = state.gym?.locations ?? []
  const placeName = (id: string | undefined) => (id ? (locations.find((l) => l.id === id)?.name ?? 'home') : 'home')
  const labelOf = (i: number, at: number) => (i === 0 ? 'Today' : WEEKDAY_NAMES[new Date(at).getDay() as Weekday])

  const painSafeFor = (skill: SkillId) => week.days.some((d) => d.plan.skill?.painSafe && d.plan.skill.skills.includes(skill))
  const skillDays = week.days.filter((d) => d.plan.skill && !d.plan.rest)
  const trainingSkillDays = skillDays.filter((d) => !d.plan.skill?.painSafe)
  const longest = Math.max(0, ...trainingSkillDays.map((d) => d.plan.skill!.minutes))
  const placesPlanned = new Set(trainingSkillDays.map((d) => placeName(d.plan.skill!.placeId)))

  const lines: SkillWeekLine[] = []
  const trained = new Map<SkillId, SkillWeekDay[]>()
  week.days.forEach((d, index) => {
    const block = d.plan.skill
    if (!block || d.plan.rest || block.painSafe) return
    block.skills.forEach((skill, i) => {
      const role: LineupRole = block.roles?.[i] ?? (i === 0 ? 'lead' : 'partner')
      const entry: SkillWeekDay = {
        day: d.day,
        index,
        label: labelOf(index, d.at),
        role,
        opener: Boolean(block.opener) && i === 0,
        place: placeName(block.placeId),
      }
      trained.set(skill, [...(trained.get(skill) ?? []), entry])
    })
  })

  for (const skill of activeSkills(state)) {
    const name = SKILLS[skill].name
    const days = trained.get(skill) ?? []
    if (days.length) {
      lines.push({ skill, name, days, text: `${name}: ${days.map(skillDayWords).join(', ')}.` })
      continue
    }
    const reason = reasonFor(skill)
    lines.push({ skill, name, days, reason, text: `${name}: no day this week in your plan. ${reason.text}` })
  }
  return lines

  function reasonFor(skill: SkillId): { kind: SkillWeekReason; text: string } {
    const name = SKILLS[skill].name
    const missing = missingKit(skill, own)
    if (missing.length) {
      const needs = kitNeedsPhrase(missing)
      const at = placesWithKit(skill, own as EquipmentId[], locations)
      if (at.length === 0) return { kind: 'kit-missing', text: `${name} needs ${needs}, and no place you have added has it yet.` }
      // Only when no day is planned at a place that has the kit: a day there that left it out is a matter of room, below.
      if (!at.some((place) => placesPlanned.has(place))) {
        return {
          kind: 'kit-elsewhere',
          text: `${name} needs ${needs}, which ${listed(at)} ${at.length === 1 ? 'has' : 'have'} — and no day this week is planned there.`,
        }
      }
    }
    if (painSafeFor(skill)) {
      return { kind: 'pain', text: `The day that named it is the pain-safe session, which trains no skill — what you reported comes first.` }
    }
    if (trainingSkillDays.length === 0) {
      return { kind: 'no-skill-days', text: 'No day this week trains a skill — they are rest days, gym days without an opener, or the week is not planned yet.' }
    }
    const family = skillFamily(skill)
    const sibling = family !== 'balance' && [...trained.keys()].some((other) => other !== skill && skillFamily(other) === family)
    if (sibling) {
      return {
        kind: 'rest-rule',
        text: `Hard ${family === 'push' ? 'pushing' : 'pulling'} sessions keep your rest rule apart, and the days it allows this week go to another ${family === 'push' ? 'push' : 'pull'} skill (the app’s own rule; spacing is a coaching convention).`,
      }
    }
    return {
      kind: 'no-room',
      text: `The longest skill day this week is ${longest} minutes, which has room for ${roomIn(longest)}, and the places in it go to other skills first.`,
    }
  }
}
