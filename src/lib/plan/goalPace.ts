import { STEP_BY_ID } from '../../data/progressions'
import type { AppState } from '../../types'
import { goalOutlook } from '../forecast'
import type { SkillGoal } from '../gym/types'
import { barMet, daysAtBar, qualifyingProgress } from '../progression'
import { skillView } from '../skills'
import { dayKey } from '../time'

const WEEK = 7 * 86_400_000

export type GoalPace = { status: 'reached' | 'practicing' | 'past' | 'on-pace' | 'possible' | 'behind' | 'unknown'; text: string }

/** Whether a dated skill goal is on pace — or that the app cannot tell yet. */
export function skillGoalPace(state: AppState, goal: SkillGoal, now = Date.now()): GoalPace {
  const target = STEP_BY_ID[goal.stepId]
  if (!target) return { status: 'unknown', text: 'Not a step this app knows.' }
  const view = skillView(state, goal.skill)
  const current = STEP_BY_ID[view.stepId]
  if (!current) return { status: 'unknown', text: 'Not started on this skill yet.' }
  const evidence = { sessions: view.sessions.filter((s) => s.startedAt <= now) }
  if (barMet(evidence, target.id)) return { status: 'reached', text: `Verified ${target.name}. Your logged holds meet the ${target.unlockSec}s standard.` }
  if (current.order >= target.order) {
    const best = qualifyingProgress(evidence, target.id).value
    const days = target.repeatDays ?? 1
    const repeat = days > 1 ? ` ${daysAtBar(evidence, target.id)} of ${days} required practice days at the standard.` : ''
    const when = current.id === target.id ? 'Practicing' : 'Training past'
    const expired = goal.by < dayKey(now) ? ' The target date has passed.' : ''
    return { status: current.id === target.id ? 'practicing' : 'past',
      text: `${when} ${target.name}. Verified hold ${Math.round(best * 10) / 10}s of ${target.unlockSec}s.${repeat}${expired}` }
  }
  const [y, m, d] = goal.by.split('-').map(Number)
  const weeksLeft = (new Date(y, m - 1, d, 23, 59).getTime() - now) / WEEK
  if (weeksLeft <= 0) return { status: 'behind', text: `The date has passed — set a new one.` }
  let range: { low: number; high: number | null } | null = null
  let why = ''
  const o = goalOutlook({ ...view, profile: { ...view.profile, goalStepId: target.id } }, now)
  if (o.estimate) range = { low: o.estimate.lowWeeks, high: o.estimate.highWeeks }
  else why = o.note
  // Whole weeks left, rounded down in every sentence: 5.5 once read "6 weeks"
  // when the pace was unknown and "5 weeks left" when it was not.
  const whole = Math.floor(weeksLeft)
  const leftText = whole < 1 ? 'under a week' : `${whole} ${whole === 1 ? 'week' : 'weeks'}`
  // One full stop, whatever the reason ends with; "1 week", never "1 weeks".
  const because = (why || 'not enough history').trim().replace(/[.\s]+$/, '')
  if (!range) return { status: 'unknown', text: `Can't tell yet whether ${leftText} ${whole > 1 ? 'are' : 'is'} enough: ${because}.` }
  const remaining = `${leftText} left`
  // One number when both ends agree: "7–7 weeks" read as a bug.
  const span =
    range.high === null
      ? `${range.low}+ weeks`
      : range.low === range.high
        ? `${range.low} ${range.low === 1 ? 'week' : 'weeks'}`
        : `${range.low}–${range.high} weeks`
  if (range.high !== null && range.high <= weeksLeft) return { status: 'on-pace', text: `On pace to start ${target.name} in about ${span}, with ${remaining}. Mastery requires a verified hold.` }
  if (range.low > weeksLeft) return { status: 'behind', text: `About ${span} to start ${target.name} at your current rate, with ${remaining}.` }
  return { status: 'possible', text: `You could start ${target.name} in ${span} at your current rate, with ${remaining}.` }
}
