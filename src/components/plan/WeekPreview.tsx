import { useMemo, useState } from 'react'
import { FOCUS_LABEL } from '../../lib/gym/builder'
import type { ActivityKind } from '../../lib/gym/types'
import { planWeekAhead, type WeekAhead, type WeekDayPlan } from '../../lib/plan/planner'
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

/** A day in words, for its button and its detail: "Gym · Pull, opens with Lever", "Calisthenics · Planche + Lever", "Rest". */
function dayWords({ plan }: WeekDayPlan): string {
  if (plan.rest) return 'Rest'
  const skills = (plan.skill?.skills ?? []).map((s) => SHORT[s]).join(' + ')
  if (plan.kind === 'gym' && plan.gym) return `Gym · ${FOCUS_LABEL[plan.gym.focus]}${plan.skill?.opener ? `, opens with ${skills}` : ''}`
  if (plan.kind === 'calisthenics') return `Calisthenics · ${skills}`
  return 'Nothing planned'
}

/**
 * The week at a glance: each day's one main session — calisthenics, or the gym
 * with any skill opener — and its sport, planned together so the week's sets
 * and skill sessions add up, and why: tap a day. A plan, not a promise: it is
 * planned again from what actually happened.
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
                className={`flex min-h-[104px] w-full flex-col items-stretch gap-1 rounded-control border p-1.5 text-center ${
                  picked === i ? 'border-accent' : i === 0 ? 'border-line-strong' : 'border-line'
                } ${plan.rest ? 'bg-raised' : 'bg-surface'}`}
              >
                <span className="text-caption font-semibold text-ink3">{label}</span>
                {plan.rest ? <span className="my-auto text-caption text-ink3">Rest</span> : null}
                {plan.kind === 'calisthenics' && skills.length ? (
                  <span className="rounded-md bg-accent-soft px-1 py-0.5 text-caption font-medium leading-tight text-accent-text">
                    {skills.length > 2 ? `${skills.length} skills` : skills.map((s) => SHORT[s]).join(' + ')}
                  </span>
                ) : null}
                {plan.kind === 'gym' && plan.gym ? (
                  <span className="rounded-md border border-line-strong px-1 py-0.5 text-caption font-medium leading-tight text-ink">
                    {FOCUS_LABEL[plan.gym.focus].replace(' body', '')}
                  </span>
                ) : null}
                {opener ? <span className="text-caption leading-tight text-accent-text">{SHORT[opener]} first</span> : null}
                {sport ? (
                  <span className="rounded-md border border-line px-1 py-0.5 text-caption leading-tight text-ink2">{SPORT[sport.kind]}</span>
                ) : null}
                {!plan.rest ? <span className="mt-auto text-caption tnum text-ink3">{plan.minutes}′</span> : null}
                <span className="sr-only">{movedFrom ? `Takes over ${movedFrom}’s missed work.` : ''}</span>
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
      <p className="mt-1.5 text-caption text-ink3">
        A plan, not a promise — each day is planned again from what you actually did. Coloured chips are calisthenics days,
        outlined ones gym days; which is which follows your goals (the app’s own split). Spreading weekly sets, two-day gaps
        for hard straight-arm work and fresh legs around your sport are coaching conventions.
      </p>
    </section>
  )
}
