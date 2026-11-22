import { useMemo, useState } from 'react'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { activeLocation } from '../../lib/gym/draft'
import { estimateOneRepMax } from '../../lib/gym/progression'
import { formatLoad, unitFor } from '../../lib/gym/units'
import { gymBadges, weeklySummary } from '../../lib/plan/weekly'
import { useStore } from '../../lib/store'
import { fmtHold } from '../../lib/time'
import { HoldLineChart } from '../charts'
import { Icon } from '../Icon'

/** The week in one place: skills and gym together, what moved, and what to focus on next. */
export function WeeklySummary() {
  const { state } = useStore()
  const summary = useMemo(() => weeklySummary(state), [state])
  const badges = useMemo(() => gymBadges(state), [state])
  const location = activeLocation(state.gym)

  // Estimated max over time, per lift with at least two sessions of it.
  const series = useMemo(() => {
    const out = new Map<string, { at: number; value: number }[]>()
    for (const s of state.gym?.sessions ?? []) {
      for (const log of s.exercises) {
        const best = Math.max(0, ...log.sets.filter((x) => !x.warmup).map((x) => estimateOneRepMax(x) ?? 0))
        if (best > 0) out.set(log.exerciseId, [...(out.get(log.exerciseId) ?? []), { at: s.startedAt, value: best }])
      }
    }
    return [...out.entries()].filter(([, pts]) => pts.length >= 2).sort((a, b) => b[1].length - a[1].length)
  }, [state.gym?.sessions])
  const [lift, setLift] = useState<string | null>(null)
  const shown = series.find(([id]) => id === lift) ?? series[0]
  const shownEx = shown ? GYM_EXERCISE_BY_ID[shown[0]] : undefined
  const unit = shownEx && location ? unitFor(shownEx, location) : location?.unit ?? 'kg'
  const earned = badges.filter((b) => b.at !== undefined)

  return (
    <section className="space-y-4 rounded-3xl border border-line bg-surface p-4">
      <div>
        <h2 className="text-[17px] font-semibold">This week</h2>
        <p className="text-[12px] text-ink3">Skills and gym together, Monday to Sunday.</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['Skill sessions', String(summary.skillSessions)],
          ['Gym sessions', String(summary.gymSessions)],
          ['Skill hold time', fmtHold(Math.round(summary.holdSec))],
          ['Gym sets', String(summary.gymSets)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-raised p-3">
            <dt className="text-[12px] text-ink3">{k}</dt>
            <dd className="text-[22px] font-semibold tabular-nums leading-tight">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[13px] text-ink2">
        {summary.streakWeeks > 0
          ? `${summary.streakWeeks} ${summary.streakWeeks === 1 ? 'week' : 'weeks'} in a row with two or more training days.`
          : 'Two training days in a week starts a streak.'}
        {summary.newMaxes.length
          ? ` New estimated max this week: ${summary.newMaxes.map((id) => GYM_EXERCISE_BY_ID[id]?.name ?? id).join(', ')}.`
          : ''}
      </p>
      {summary.focus.length ? (
        <div>
          <h3 className="text-[13px] font-semibold">Focus next week</h3>
          <ul className="mt-1 space-y-1">
            {summary.focus.map((f) => (
              <li key={f} className="flex gap-2 text-[13px] leading-snug text-ink2">
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
            <h3 className="text-[13px] font-semibold">Estimated max — {shownEx.name}</h3>
            {series.length > 1 ? (
              <select
                value={shown[0]}
                onChange={(e) => setLift(e.target.value)}
                className="min-h-10 max-w-[50%] rounded-lg border border-line bg-raised px-2 text-[13px]"
                aria-label="Lift to chart"
              >
                {series.map(([id]) => (
                  <option key={id} value={id}>
                    {GYM_EXERCISE_BY_ID[id]?.name ?? id}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
          <HoldLineChart points={shown[1]} height={160} label={`Estimated max for ${shownEx.name}`} format={(v) => formatLoad(v, unit)} />
          <p className="text-[12px] text-ink3">Estimated from your best set of 12 reps or fewer each session, adjusted for effort. Tap a point to read it.</p>
        </div>
      ) : null}

      {earned.length ? (
        <div>
          <h3 className="text-[13px] font-semibold">Gym badges</h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {badges.map((b) => (
              <li
                key={b.id}
                title={b.desc}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium ${b.at !== undefined ? 'border-transparent bg-accent-soft text-accent-text' : 'border-line text-ink3'}`}
              >
                <Icon name={b.icon} size={14} />
                {b.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
