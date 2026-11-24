import { useMemo, useState } from 'react'
import { FOCUS_LABEL } from '../../lib/gym/builder'
import type { ActivityKind } from '../../lib/gym/types'
import type { WeekAhead, WeekDayPlan } from '../../lib/plan/planner'
import { weekForChoice } from '../../lib/plan/currentWeek'
import { useTodayChoice } from '../../lib/plan/todayChoice'
import { useStore } from '../../lib/store'
import { useToday } from '../../lib/useToday'
import type { SkillId } from '../../types'
import { usePlanClock } from '../../lib/plan/usePlanClock'
import { skillDayWords, skillWeekLines } from '../../lib/plan/skillWeek'

const SHORT: Record<SkillId, string> = {
  planche: 'Planche',
  frontlever: 'Lever',
  handstand: 'Handstand',
  ninety: '90°',
  flag: 'Flag',
}
const SPORT: Record<ActivityKind, string> = {
  sprint: 'Sprints',
  practice: 'Practice',
  game: 'Game',
  pe: 'PE',
  run: 'Run',
  climb: 'Climbing',
  other: 'Sport',
}

/** A day in words, for its button and its detail: "Gym · Pull · lever first", "Calisthenics · Planche + Lever", "Rest". */
function dayWords({ plan }: WeekDayPlan): string {
  if (plan.rest) return 'Rest'
  const skills = (plan.skill?.skills ?? []).map((s) => SHORT[s]).join(' + ')
  if (plan.kind === 'gym' && plan.gym) return `Gym · ${FOCUS_LABEL[plan.gym.focus]}${plan.skill?.opener ? ` · ${skills.toLowerCase()} first` : ''}`
  if (plan.kind === 'calisthenics') return `Calisthenics · ${skills}`
  return 'Nothing planned'
}

/**
 * The week at a glance: each day's one main session — calisthenics, or the gym
 * with any skill opener — and its sport, planned together so the week's sets
 * and skill sessions add up, and why: tap a day. A plan, not a promise: it is
 * planned again from what actually happened.
 */
export function WeekPreview({ week: given, hideTitle = false }: { week?: WeekAhead; hideTitle?: boolean } = {}) {
  const { state } = useStore()
  // Today's choice and the calendar day: the same today as every other screen, re-planned after midnight,
  // and on the coarse clock for the rules that run in hours.
  const todayKey = useToday()
  usePlanClock()
  const [choice] = useTodayChoice(todayKey)
  const week = given ?? weekForChoice(state, choice)
  const [picked, setPicked] = useState(0)
  const bySkill = useMemo(() => skillWeekLines(week, state), [week, state])
  const selected = week.days[Math.min(picked, week.days.length - 1)]
  return (
    <section aria-label="The week ahead">
      {hideTitle ? null : <h3 className="text-footnote font-semibold text-ink2">The week ahead</h3>}
      {week.missed.length ? (
        <p className="mt-1 text-caption leading-snug text-ink2">
          {week.missed.map((m) => m.text).join(' ')}
        </p>
      ) : null}
      {/* At least 44 px a day: seven columns on a phone were 39 px, so the row scrolls rather than shrinks. */}
      <ol className="mt-2 grid auto-cols-[minmax(2.75rem,1fr)] grid-flow-col gap-1.5 overflow-x-auto pb-1">
        {week.days.map((d, i) => {
          const { day, at, plan, sport, movedFrom } = d
          const label = i === 0 ? 'Today' : new Date(at).toLocaleDateString(undefined, { weekday: 'short' })
          const skills = plan.skill?.skills ?? []
          const opener = plan.kind === 'gym' && plan.skill?.opener ? skills[0] : undefined
          return (
            <li key={day}>
              <button
                onClick={() => setPicked(i)}
                aria-pressed={picked === i}
                aria-label={`${i === 0 ? 'Today' : new Date(at).toLocaleDateString(undefined, { weekday: 'long' })}: ${dayWords(d)}${sport ? `, ${SPORT[sport.kind]}` : ''} — show why`}
                className={`relative flex min-h-[104px] w-full flex-col items-stretch gap-1 rounded-control border p-1.5 text-center ${
                  picked === i ? 'border-accent' : i === 0 ? 'border-line-strong' : 'border-line'
                } ${plan.rest ? 'bg-raised' : 'bg-surface'}`}
              >
                <span className="text-caption font-semibold text-ink3">{label}</span>
                {plan.rest ? <span className="my-auto text-caption text-ink3">Rest</span> : null}
                {plan.kind === 'calisthenics' && skills.length ? (
                  <span className="rounded-md bg-accent-soft px-1 py-0.5 text-caption font-medium leading-tight text-accent-text">
                    <span className="block text-[10px] font-semibold uppercase tracking-wide">Skills</span>
                    {skills.length > 2 ? `${skills.length} skills` : skills.map((s) => SHORT[s]).join(' + ')}
                  </span>
                ) : null}
                {plan.kind === 'gym' && plan.gym ? (
                  <span className="rounded-md border border-line-strong px-1 py-0.5 text-caption font-medium leading-tight text-ink">
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink3">Gym</span>
                    {FOCUS_LABEL[plan.gym.focus].replace(' body', '')}
                  </span>
                ) : null}
                {opener ? <span className="text-caption leading-tight text-accent-text">{SHORT[opener].toLowerCase()} first</span> : null}
                {sport ? (
                  <span className="rounded-md border border-line px-1 py-0.5 text-caption leading-tight text-ink2">{SPORT[sport.kind]}</span>
                ) : null}
                {!plan.rest ? <span className="mt-auto text-caption tnum text-ink3">{plan.minutes}′</span> : null}
                {movedFrom && <span className="sr-only">Takes over {movedFrom}’s missed work.</span>}
              </button>
            </li>
          )
        })}
      </ol>
      {selected ? (
        <div className="mt-2 rounded-inner bg-raised p-3" aria-live="polite">
          <p className="text-caption font-semibold text-ink2">
            {picked === 0 ? 'Today' : new Date(selected.at).toLocaleDateString(undefined, { weekday: 'long' })} · {dayWords(selected)}
            {selected.movedFrom ? ` · takes over ${selected.movedFrom}’s missed work` : ''}
          </p>
          <ul className="mt-1 space-y-1">
            {selected.why.map((w) => (
              <li key={w} className="text-caption leading-snug text-ink2">
                {w}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {bySkill.length ? (
        <div className="mt-3" role="group" aria-labelledby="week-by-skill">
          <h4 id="week-by-skill" className="text-footnote font-semibold text-ink2">
            This week by skill
          </h4>
          <ul className="mt-1 space-y-1.5">
            {bySkill.map((line) => (
              <li key={line.skill} className="min-w-0 break-words rounded-inner bg-raised px-3 py-2 text-caption leading-snug text-ink2">
                <span className="font-semibold text-ink">{line.name}</span>
                {line.days.length ? (
                  <ul className="mt-0.5 space-y-0.5" aria-label={`${line.name} days this week`}>
                    {line.days.map((d) => (
                      <li key={d.day}>{skillDayWords(d)}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="mt-0.5 block">No day this week in your plan. {line.reason?.text}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-caption text-ink3">
            From your plan as it stands — it is planned again from what you log. How often a skill trains is a coaching convention, not a measured amount.
          </p>
        </div>
      ) : null}
      <p className="mt-1.5 text-caption text-ink3">
        A plan, not a promise — each day is planned again from what you actually did. Each day says its kind — Skills (calisthenics)
        or Gym, with any skill that goes first; which is which follows your goals (the app’s own split). Spreading weekly sets, two-day gaps
        for hard straight-arm work and fresh legs around your sport are coaching conventions.
      </p>
    </section>
  )
}
