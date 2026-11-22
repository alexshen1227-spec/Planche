import { useMemo, useState } from 'react'
import { FOCUS_LABEL } from '../../lib/gym/builder'
import type { ActivityKind } from '../../lib/gym/types'
import { planWeekAhead, skillFamily, type WeekAhead } from '../../lib/plan/planner'
import { useStore } from '../../lib/store'
import type { SkillId } from '../../types'

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
  other: 'Sport',
}

/**
 * The week at a glance: each day's skills, gym focus and sport, planned
 * together so the week's sets and skill sessions add up, and why — tap a day.
 * A plan, not a promise: it is planned again from what actually happened.
 */
export function WeekPreview({ week: given }: { week?: WeekAhead } = {}) {
  const { state } = useStore()
  const computed = useMemo(() => (given ? null : planWeekAhead(state)), [state, given])
  const week = given ?? computed!
  const [picked, setPicked] = useState(0)
  const selected = week.days[Math.min(picked, week.days.length - 1)]
  return (
    <section aria-label="The week ahead">
      <h3 className="text-footnote font-semibold text-ink2">The week ahead</h3>
      {week.missed.length ? (
        <p className="mt-1 text-caption leading-snug text-ink2">
          {week.missed.map((m) => m.text).join(' ')}
        </p>
      ) : null}
      <ol className="mt-2 grid grid-cols-7 gap-1.5">
        {week.days.map(({ day, at, plan, sport, movedFrom }, i) => {
          const label = i === 0 ? 'Today' : new Date(at).toLocaleDateString(undefined, { weekday: 'short' })
          const skills = plan.skill?.skills ?? []
          const families = new Set(skills.map(skillFamily))
          return (
            <li key={day}>
              <button
                onClick={() => setPicked(i)}
                aria-pressed={picked === i}
                aria-label={`${i === 0 ? 'Today' : new Date(at).toLocaleDateString(undefined, { weekday: 'long' })}: ${
                  plan.rest ? 'rest' : [skills.map((s) => SHORT[s]).join(' and '), plan.gym ? FOCUS_LABEL[plan.gym.focus] : ''].filter(Boolean).join(', then ')
                }${sport ? `, ${SPORT[sport.kind]}` : ''} — show why`}
                className={`flex min-h-[104px] w-full flex-col items-stretch gap-1 rounded-control border p-1.5 text-center ${
                  picked === i ? 'border-accent' : i === 0 ? 'border-line-strong' : 'border-line'
                } ${plan.rest ? 'bg-raised' : 'bg-surface'}`}
              >
                <span className="text-caption font-semibold text-ink3">{label}</span>
                {plan.rest ? <span className="my-auto text-caption text-ink3">Rest</span> : null}
                {skills.length ? (
                  <span className="rounded-md bg-accent-soft px-1 py-0.5 text-caption font-medium leading-tight text-accent-text">
                    {skills.length > 2 ? `${skills.length} skills` : skills.map((s) => SHORT[s]).join(' + ')}
                  </span>
                ) : null}
                {plan.gym ? (
                  <span className="rounded-md bg-raised px-1 py-0.5 text-caption font-medium leading-tight text-ink2">
                    {FOCUS_LABEL[plan.gym.focus].replace(' body', '')}
                  </span>
                ) : null}
                {sport ? (
                  <span className="rounded-md border border-line px-1 py-0.5 text-caption leading-tight text-ink2">{SPORT[sport.kind]}</span>
                ) : null}
                {!plan.rest ? <span className="mt-auto text-caption tnum text-ink3">{plan.minutes}′</span> : null}
                <span className="sr-only">
                  {families.has('push') ? 'Push skills. ' : ''}
                  {families.has('pull') ? 'Pull skills. ' : ''}
                  {movedFrom ? `Takes over ${movedFrom}’s missed work.` : ''}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      {selected ? (
        <div className="mt-2 rounded-inner bg-raised p-3" aria-live="polite">
          <p className="text-caption font-semibold text-ink2">
            {picked === 0 ? 'Today' : new Date(selected.at).toLocaleDateString(undefined, { weekday: 'long' })}
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
      <p className="mt-1.5 text-caption text-ink3">
        A plan, not a promise — each day is planned again from what you actually did. Spreading weekly sets, two-day
        gaps for hard straight-arm work and fresh legs around your sport are coaching conventions.
      </p>
    </section>
  )
}
