import { useMemo } from 'react'
import { FOCUS_LABEL } from '../../lib/gym/builder'
import { planWeek, skillFamily } from '../../lib/plan/planner'
import { useStore } from '../../lib/store'
import type { SkillId } from '../../types'

const SHORT: Record<SkillId, string> = {
  planche: 'Planche',
  frontlever: 'Lever',
  handstand: 'Handstand',
  ninety: '90°',
  flag: 'Flag',
}

/**
 * The next seven days at a glance, each planned as if the days before went to
 * plan. A preview: every real day is planned again from what actually happened.
 */
export function WeekPreview() {
  const { state } = useStore()
  const week = useMemo(() => planWeek(state), [state])
  return (
    <section aria-label="The week ahead">
      <h3 className="text-footnote font-semibold text-ink2">The week ahead</h3>
      <ol className="mt-2 grid grid-cols-7 gap-1.5">
        {week.map(({ day, at, plan }, i) => {
          const date = new Date(at)
          const label = i === 0 ? 'Today' : date.toLocaleDateString(undefined, { weekday: 'short' })
          const skills = plan.skill?.skills ?? []
          const families = new Set(skills.map(skillFamily))
          return (
            <li
              key={day}
              className={`flex min-h-[92px] flex-col gap-1 rounded-control border p-1.5 text-center ${i === 0 ? 'border-accent' : 'border-line'} ${plan.rest ? 'bg-raised' : 'bg-surface'}`}
            >
              <span className="text-caption font-semibold text-ink3">{label}</span>
              {plan.rest ? (
                <span className="mt-auto mb-auto text-caption text-ink3">Rest</span>
              ) : (
                <>
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
                  <span className="mt-auto text-caption tnum text-ink3">{plan.minutes}′</span>
                  <span className="sr-only">
                    {families.has('push') ? 'Push skills. ' : ''}
                    {families.has('pull') ? 'Pull skills. ' : ''}
                  </span>
                </>
              )}
            </li>
          )
        })}
      </ol>
      <p className="mt-1.5 text-caption text-ink3">A preview — each day is planned again from what you actually did.</p>
    </section>
  )
}
