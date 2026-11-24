import { useMemo, useState } from 'react'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { activeLocation } from '../../lib/gym/draft'
import { estimateOneRepMax, maxKey } from '../../lib/gym/progression'
import { displayLoad, formatLoad, unitFor } from '../../lib/gym/units'
import { gymBadges, weeklySummary } from '../../lib/plan/weekly'
import { useStore } from '../../lib/store'
import { fmtHold } from '../../lib/time'
import { useToday } from '../../lib/useToday'
import { HoldLineChart } from '../charts'
import { Icon } from '../Icon'
import { Card, CardTitle, CountUp, EmptyState, Metric } from '../ds'

/** The week in one place: skills and gym together, what moved, and what to focus on next. */
export function WeeklySummary() {
  const { state } = useStore()
  const today = useToday()
  const summary = useMemo(() => weeklySummary(state), [state, today])
  const badges = useMemo(() => gymBadges(state), [state, today])
  const location = activeLocation(state.gym)
  const gymOnly = state.gym?.prefs?.goals.skills === 0

  // Estimated max over time, per lift with at least two sessions of it.
  const series = useMemo(() => {
    const out = new Map<string, { key: string; id: string; placeId?: string; points: { at: number; value: number }[] }>()
    for (const s of [...(state.gym?.sessions ?? [])].sort((a, b) => a.startedAt - b.startedAt)) {
      const bests = new Map<string, number>()
      for (const log of s.exercises) {
        const best = Math.max(0, ...log.sets.filter((x) => !x.warmup).map((x) => estimateOneRepMax(x, log.exerciseId) ?? 0))
        if (best > (bests.get(log.exerciseId) ?? 0)) bests.set(log.exerciseId, best)
      }
      for (const [id, value] of bests) {
        const key = maxKey(id, s.locationId)
        if (!out.has(key)) out.set(key, { key, id, placeId: key === id ? undefined : s.locationId, points: [] })
        out.get(key)!.points.push({ at: s.startedAt, value })
      }
    }
    return [...out.values()].filter((s) => s.points.length >= 2).sort((a, b) => b.points.length - a.points.length)
  }, [state.gym?.sessions])
  const [lift, setLift] = useState<string | null>(null)
  const shown = series.find((s) => s.key === lift) ?? series[0]
  const shownEx = shown ? GYM_EXERCISE_BY_ID[shown.id] : undefined
  const place = (id?: string) => state.gym?.locations.find((l) => l.id === id)
  const chartName = (s: (typeof series)[number]) => (GYM_EXERCISE_BY_ID[s.id]?.name ?? s.id) + (s.placeId ? ` · ${place(s.placeId)?.name ?? 'Previous gym'}` : '')
  const unit = shownEx ? unitFor(shownEx, shown.placeId ? place(shown.placeId) : location) : 'kg'
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

      {shown && shownEx ? (
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-display text-body font-semibold">Estimated max — {chartName(shown)}</h3>
            {series.length > 1 ? (
              <select
                value={shown.key}
                onChange={(e) => setLift(e.target.value)}
                className="min-h-11 max-w-[50%] rounded-control border border-line bg-raised px-2 text-footnote"
                aria-label="Lift to chart"
              >
                {series.map((s) => (
                  <option key={s.key} value={s.key}>
                    {chartName(s)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <HoldLineChart points={shown.points} height={160} label={`Estimated max for ${chartName(shown)}`} format={(v) => formatLoad(v, unit)}
          axisFormat={(v) => String(Math.round(displayLoad(v, unit)))} />
          <p className="text-caption text-ink3">Estimated from your best set of 12 reps or fewer each session, adjusted for effort. Tap a point to read it.</p>
        </div>
      ) : (
        <EmptyState icon="chart" title="No chart yet">
          Log the same lift in two sessions and its estimated max appears here.
        </EmptyState>
      )}

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
