import { useMemo, useState } from 'react'
import { FOCUS_LABEL } from '../../lib/gym/builder'
import type { ActivityKind } from '../../lib/gym/types'
import type { WeekAhead, WeekDayPlan } from '../../lib/plan/planner'
import { weekForChoice } from '../../lib/plan/currentWeek'
import { useTodayChoice } from '../../lib/plan/todayChoice'
import { useStore } from '../../lib/store'
import { useToday } from '../../lib/useToday'
import { SportOnDate } from './SportOnDate'
import { WeekPlanComparison } from './WeekPlanComparison'
import type { SkillId } from '../../types'
import { usePlanClock } from '../../lib/plan/usePlanClock'
import { recordedTrainingDay, skillDayWords, skillWeekLines } from '../../lib/plan/skillWeek'
import { useDayMarks, useNextBlock } from '../../lib/plan/nextBlock'
import { dayStage, remainingLifts, type GymPreset } from '../../lib/plan/screens'
import { latestSkillPartial } from '../../lib/skillSession'

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
  const tick = usePlanClock()
  const marks = useDayMarks(todayKey)
  const [choice] = useTodayChoice(todayKey)
  const week = given ?? weekForChoice(state, choice)
  const [picked, setPicked] = useState(0)
  const today = week.days[0]
  const stage = today?.day === todayKey ? dayStage(state, today.plan, Date.now(), marks) : undefined
  const saved = useNextBlock<GymPreset>(todayKey)
  const nextLifts = stage === 'lifts-next' ? remainingLifts(today.plan, saved, choice.placeId) : null
  const partialRounds = stage === 'skill-partial' ? latestSkillPartial(state.sessions)?.remaining?.blocks.reduce((n, b) => n + b.sets, 0) : undefined
  const recorded = useMemo(() => {
    return stage === 'done' || stage === 'lifts-next' || stage === 'skill-partial'
      ? recordedTrainingDay(state, Date.now()) : undefined
  }, [stage, state, todayKey, tick])
  const bySkill = useMemo(() => skillWeekLines(week, state, recorded), [week, state, recorded])
  const activityKinds = [...new Set(recorded?.visits.map((v) => v.kind === 'gym' ? 'Gym' : 'Skills'))]
  const loggedLabel = stage === 'lifts-next' ? 'Lifts next' : stage === 'skill-partial' ? 'Skill workout paused' : activityKinds.join(' + ') || 'Day ended'
  const loggedHeading = activityKinds.length ? 'Logged' : 'Ended'
  const selected = week.days[Math.min(picked, week.days.length - 1)]
  const locationId = selected?.plan.gym?.placeId ?? selected?.plan.skill?.placeId
  const location = state.gym?.locations.find((place) => place.id === locationId)
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
          const sportLabel = d.sportCount ? `${d.sportCount} sport sessions` : sport ? SPORT[sport.kind] : undefined
          const label = i === 0 ? 'Today' : new Date(at).toLocaleDateString(undefined, { weekday: 'short' })
          const skills = plan.skill?.skills ?? []
          const opener = plan.kind === 'gym' && plan.skill?.opener ? skills[0] : undefined
          const logged = recorded?.day === day
          return (
            <li key={day}>
              <button
                onClick={() => setPicked(i)}
                aria-pressed={picked === i}
                aria-label={`${i === 0 ? 'Today' : new Date(at).toLocaleDateString(undefined, { weekday: 'long' })}: ${logged ? `${loggedHeading} · ${loggedLabel}` : dayWords(d)}${sportLabel ? `, ${sportLabel}` : ''} — show details`}
                className={`relative flex min-h-[104px] w-full flex-col items-stretch gap-1 rounded-control border p-1.5 text-center ${
                  picked === i ? 'border-accent' : i === 0 ? 'border-line-strong' : 'border-line'
                } ${plan.rest ? 'bg-raised' : 'bg-surface'}`}
              >
                <span className="text-caption font-semibold text-ink3">{label}</span>
                {logged ? <span className="my-auto text-caption font-semibold text-ink"><span className="block text-[10px] uppercase text-accent-text">{loggedHeading}</span>{loggedLabel}</span> : null}
                {!logged && plan.rest ? <span className="my-auto text-caption text-ink3">Rest</span> : null}
                {!logged && plan.kind === 'calisthenics' && skills.length ? (
                  <span className="rounded-md bg-accent-soft px-1 py-0.5 text-caption font-medium leading-tight text-accent-text">
                    <span className="block text-[10px] font-semibold uppercase tracking-wide">Skills</span>
                    {skills.length > 2 ? `${skills.length} skills` : skills.map((s) => SHORT[s]).join(' + ')}
                  </span>
                ) : null}
                {!logged && plan.kind === 'gym' && plan.gym ? (
                  <span className="rounded-md border border-line-strong px-1 py-0.5 text-caption font-medium leading-tight text-ink">
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-ink3">Gym</span>
                    {FOCUS_LABEL[plan.gym.focus].replace(' body', '')}
                  </span>
                ) : null}
                {!logged && opener ? <span className="text-caption leading-tight text-accent-text">{SHORT[opener].toLowerCase()} first</span> : null}
                {sportLabel ? (
                  <span className="rounded-md border border-line px-1 py-0.5 text-caption leading-tight text-ink2">{sportLabel}</span>
                ) : null}
                {!logged && !plan.rest ? <span className="mt-auto text-caption tnum text-ink3">{plan.minutes}′</span> : null}
                {!logged && movedFrom && <span className="sr-only">Takes over {movedFrom}’s missed work.</span>}
              </button>
            </li>
          )
        })}
      </ol>
      {selected ? (
        <div className="mt-2 rounded-inner bg-raised p-3" aria-live="polite">
          {recorded?.day === selected.day ? <>
            <p className="text-caption font-semibold text-ink2">Today · {recorded.visits.length ? 'Logged training' : 'Day ended'}</p>
            {recorded.visits.length ? <ul className="mt-1 space-y-1">
              {recorded.visits.map((v) => <li key={v.kind + v.id} className="text-caption leading-snug text-ink2">
                {v.name}{v.places.length > 0 && ` at ${v.places.join(' / ')}`} · {v.sets} working {v.sets === 1 ? 'set' : 'sets'}{v.partial && ' · partial workout'}
              </li>)}
            </ul> : <p className="text-caption text-ink2">No workout logged today.</p>}
            {stage === 'lifts-next' && <p className="mt-2 text-caption font-semibold text-ink">Lifts still to do{nextLifts ? ` · ${FOCUS_LABEL[nextLifts.focus]} · ${nextLifts.minutes} min` : ''}</p>}
            {partialRounds !== undefined && <p className="mt-2 text-caption font-semibold text-ink">{partialRounds} skill {partialRounds === 1 ? 'set' : 'sets'} left in the saved workout.</p>}
          </> : <>
          <p className="text-caption font-semibold text-ink2">
            {picked === 0 ? 'Today' : new Date(selected.at).toLocaleDateString(undefined, { weekday: 'long' })} · {dayWords(selected)}
            {location ? ` · ${location.name}` : ''}
            {selected.movedFrom ? ` · takes over ${selected.movedFrom}’s missed work` : ''}
          </p>
          <ul className="mt-1 space-y-1">
            {selected.why.map((w) => (
              <li key={w} className="text-caption leading-snug text-ink2">
                {w}
              </li>
            ))}
          </ul>
          </>}
          <SportOnDate key={selected.day} at={selected.at} />
          {state.gym?.prefs?.gymWeekdays?.includes(new Date(selected.at).getDay()) && <p className="mt-2 text-caption font-semibold text-ink2">You usually lift on this weekday.</p>}
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
                    {line.days.map((d) => {
                      const sets = d.loggedSets ?? week.days[d.index].skillWorkingSets?.[line.skill]
                      return <li key={d.day}>{skillDayWords(d)}{sets !== undefined && ` · ${sets} ${d.loggedSets !== undefined ? 'main' : 'progression'} ${sets === 1 ? 'set' : 'sets'}`}</li>
                    })}
                  </ul>
                ) : (
                  <span className="mt-0.5 block">No day this week in your plan. {line.reason?.text}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <WeekPlanComparison />
      <p className="mt-1.5 text-caption text-ink3">
        Upcoming sessions adapt to what you log, your recovery time and your sport.
      </p>
    </section>
  )
}
