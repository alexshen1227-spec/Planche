import { useMemo, useState, type CSSProperties } from 'react'
import type { SkillId } from '../types'
import { useStore } from '../lib/store'
import { SKILLS } from '../data/skills'
import { activeSkills, wholeState } from '../lib/skills'
import { standingNiggle } from '../lib/lineup'
import { useToday } from '../lib/useToday'
import { usePlanClock } from '../lib/plan/usePlanClock'
import { describeDay, nextPlannedDay, todaysDay, weekOutline, WEEKDAY_NAMES, WEEKDAY_SHORT, type WeekOutlineDay } from '../lib/weekPlan'
import { Icon } from './Icon'
import { WeekPlanEditor } from './WeekPlanEditor'
import { todayLine } from './weekPlanCopy'

/** A day of the strip in words: "Planche + Front lever", "Rest" or "Coach decides". */
function planWords(day: WeekOutlineDay): string {
  return describeDay(day.plan.kind === 'skills' ? day.plan.skills : day.plan.kind === 'rest' ? 'rest' : undefined)
}

/**
 * "Your own week plan (optional)": the athlete's own plan, Monday to Sunday,
 * and what it says about today. Beside the coach's "The week ahead" it once
 * read as a second plan (all "–" when empty), so it is labelled as the
 * athlete's own and folds to a one-line link until there is one.
 *
 * The strip shows what each day is for as the app will train it — a skill that
 * cannot train (dropped, or waiting for kit) is not listed, and a day with
 * none left reads as the coach's. A check marks a day a session was logged on.
 *
 * `sessionSkills` is what today's recommended session trains once the rails
 * have run (empty on a pain-safe day). The plan is written before them, so the
 * sentence about today defers to it rather than naming a skill day beside a
 * session that trains something else.
 */
export function WeekPlanCard({
  sessionSkills,
  className = '',
  style,
}: {
  sessionSkills?: readonly SkillId[]
  className?: string
  style?: CSSProperties
}) {
  const { state: stored } = useStore()
  const state = wholeState(stored)
  const todayKey = useToday()
  const clock = usePlanClock()
  const [editing, setEditing] = useState(false)
  // One moment for everything read off the calendar, re-read when the date changes.
  const { week, today, next, sore } = useMemo(() => {
    const now = Date.now()
    return {
      week: weekOutline(state, now),
      today: todaysDay(state, now),
      next: nextPlannedDay(state, now),
      // The line-up's own memory: a niggle flagged today, or earlier with no check-in since.
      sore: standingNiggle(state, now).regions,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, todayKey, clock])
  const hasPlan = state.settings.weekPlan !== undefined
  if (!hasPlan) {
    return (
      <section aria-label="Your own week plan" className={`rounded-2xl border border-line bg-surface px-4 shadow-card ${className}`} style={style}>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left text-[13px] text-ink2 transition hover:text-ink"
        >
          <span>
            <span className="font-semibold text-ink">Your own week plan (optional)</span> — choose which day is for which skill
          </span>
          <Icon name="chevronR" size={14} />
        </button>
        <WeekPlanEditor open={editing} onClose={() => setEditing(false)} />
      </section>
    )
  }
  const line = todayLine({
    today,
    next,
    hasPlan,
    active: activeSkills(state),
    minutes: state.settings.sessionMinutes,
    sessionSkills,
    sore,
  })
  // The strip is one button, so its name carries the whole week in words.
  const spoken = week
    .map(
      (day) =>
        `${WEEKDAY_NAMES[day.weekday]}${day.isToday ? ', today' : ''}: ${planWords(day)}${day.sessionLogged ? ', session logged' : ''}`,
    )
    .join('. ')

  return (
    <section aria-label="Your own week plan" className={`rounded-2xl border border-line bg-surface p-4 shadow-card ${className}`} style={style}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink3">Your own week plan (optional)</h2>
        {hasPlan ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit your week plan"
            className="-my-1.5 -mr-1.5 inline-flex min-h-10 items-center gap-0.5 rounded-lg px-2.5 text-[13px] font-medium text-ink2 transition hover:text-ink"
          >
            Edit <Icon name="chevronR" size={14} />
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`${spoken}. ${hasPlan ? 'Edit your week plan' : 'Plan your week'}.`}
        className="mt-2.5 block w-full overflow-hidden rounded-xl border border-line bg-raised text-center transition hover:border-line-strong"
      >
        {/* The grid is a span inside the button: a button is not a dependable grid container everywhere. */}
        <span className="grid grid-cols-7 divide-x divide-line">
          {week.map((day) => {
            const logged = (day.isPast || day.isToday) && day.sessionLogged
            return (
              <span
                key={day.weekday}
                data-weekday={day.weekday}
                data-today={day.isToday ? 'true' : undefined}
                className={`flex min-w-0 flex-col items-center pb-1.5 pt-2 ${day.isToday ? 'bg-accent-soft' : ''}`}
              >
                <span
                  className={`inline-flex h-[18px] items-center rounded-full px-1.5 text-[10.5px] font-semibold leading-none ${
                    day.isToday ? 'bg-accent text-on-accent' : 'text-ink3'
                  }`}
                >
                  {WEEKDAY_SHORT[day.weekday]}
                </span>
                {/* Sized from the screen: a cell is a seventh of the card, and
                    "Planche" at one fixed size was 0.2px from being cut at
                    375px and was cut at 360px. Measured to fit from 320px up. */}
                <span className="mt-1.5 flex w-full min-w-0 flex-col items-center text-[length:clamp(8.75px,2.67vw,11px)] leading-[1.3] sm:text-[12px]">
                  {day.plan.kind === 'skills' ? (
                    day.plan.skills.map((skill, index) => (
                      <span
                        key={skill}
                        className={`block max-w-full truncate font-semibold ${index === 0 ? 'text-ink' : 'text-ink2'}`}
                      >
                        {SKILLS[skill].short}
                      </span>
                    ))
                  ) : day.plan.kind === 'rest' ? (
                    <span className="font-medium text-ink3">Rest</span>
                  ) : (
                    <span className="text-ink3">–</span>
                  )}
                </span>
                <span className="mt-auto grid h-4 place-items-center pt-1 text-ok-text">
                  {logged ? <Icon name="check" size={12} strokeWidth={3} /> : null}
                </span>
              </span>
            )
          })}
        </span>
      </button>

      <p className="mt-3 text-[13px] leading-relaxed text-ink2">{line}</p>
      {hasPlan ? null : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-2.5 min-h-11 rounded-control bg-accent px-4 py-2 text-footnote font-semibold text-on-accent"
        >
          Plan my week
        </button>
      )}

      <WeekPlanEditor open={editing} onClose={() => setEditing(false)} />
    </section>
  )
}
