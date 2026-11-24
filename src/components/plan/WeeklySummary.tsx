import { useMemo } from 'react'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { liftSeries } from '../../lib/gym/performance'
import { gymBadges, weeklySummary } from '../../lib/plan/weekly'
import { useStore } from '../../lib/store'
import { fmtHold } from '../../lib/time'
import { useToday } from '../../lib/useToday'
import { weekForChoice } from '../../lib/plan/currentWeek'
import { useTodayChoice } from '../../lib/plan/todayChoice'
import { usePlanClock } from '../../lib/plan/usePlanClock'
import { PerformanceChart } from '../gym/PerformanceChart'
import { Icon } from '../Icon'
import { Card, CardTitle, CountUp, Metric } from '../ds'

/** The week in one place: skills and gym together, what moved, and what to focus on next. */
export function WeeklySummary() {
  const { state } = useStore()
  const today = useToday()
  const [choice] = useTodayChoice(today)
  const tick = usePlanClock()
  const summary = useMemo(() => {
    const now = Date.now()
    return weeklySummary(state, now, weekForChoice(state, choice, now))
  }, [state, choice, today, tick])
  const badges = useMemo(() => gymBadges(state), [state, today])
  const gymOnly = state.gym?.prefs?.goals.skills === 0

  const series = useMemo(() => liftSeries(state.gym?.sessions ?? []), [state.gym?.sessions])
  const earned = badges.filter((b) => b.at !== undefined)

  return (
    <Card className="space-y-4">
      <div>
        <CardTitle>This week</CardTitle>
        <p className="-mt-2 text-footnote text-ink3">{gymOnly ? 'Monday to Sunday' : 'Skills and gym together, Monday to Sunday.'}</p>
      </div>
      <dl className={`grid grid-cols-2 gap-2 ${gymOnly ? '' : 'sm:grid-cols-4'}`}>
        {(
          [
            ['Skill sessions', <CountUp key="a" value={summary.skillSessions} />],
            ['Gym sessions', <CountUp key="b" value={summary.gymSessions} />],
            ['Skill hold time', fmtHold(Math.round(summary.holdSec))],
            ['Gym sets', <CountUp key="c" value={summary.gymSets} />],
          ] as const
        ).filter(([k]) => !gymOnly || k.startsWith('Gym')).map(([k, v]) => (
          <div key={k} className="rounded-inner bg-raised p-4">
            <Metric label={k} value={v} />
          </div>
        ))}
      </dl>
      <p className="text-footnote text-ink2">
        {summary.streakWeeks > 0
          ? `${summary.streakWeeks} ${summary.streakWeeks === 1 ? 'week' : 'weeks'} in a row with two or more training days.`
          : 'Two training days in a week starts a streak.'}
        {summary.newMaxes.length
          ? ` New estimated max this week: ${summary.newMaxes.map((id) => GYM_EXERCISE_BY_ID[id]?.name ?? id).join(', ')}.`
          : ''}
      </p>
      {summary.focus.length ? (
        <div>
          <h3 className="font-display text-body font-semibold">Focus for the rest of this week</h3>
          <ul className="mt-1 space-y-1">
            {summary.focus.map((f) => (
              <li key={f} className="flex gap-2 text-footnote leading-snug text-ink2">
                <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <PerformanceChart series={series} />

      {earned.length ? (
        <div>
          <h3 className="font-display text-body font-semibold">Gym badges</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {badges.map((b) => (
              <li
                key={b.id}
                title={b.desc}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-caption font-medium ${b.at !== undefined ? 'border-transparent bg-accent-soft text-accent-text' : 'border-line text-ink3'}`}
              >
                <Icon name={b.icon} size={14} />
                {b.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  )
}
