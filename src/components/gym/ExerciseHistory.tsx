import { useMemo, useState } from 'react'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { activeLocation } from '../../lib/gym/draft'
import { countWord, FIRST_ESTIMATE_NOTE, gymRecords, isFirstEstimate } from '../../lib/gym/progression'
import { formatLoad, unitFor } from '../../lib/gym/units'
import { useStore } from '../../lib/store'
import { liftSeries } from '../../lib/gym/performance'
import { PerformanceChart, seriesMetric, seriesValue } from './PerformanceChart'
import { EmptyState } from '../ds'

/** Every session of one lift: where, what was lifted, and its estimated max over time. */
export function ExerciseHistory({ exerciseId }: { exerciseId: string }) {
  const { state } = useStore()
  const gym = state.gym
  const ex = GYM_EXERCISE_BY_ID[exerciseId]
  const active = activeLocation(gym)
  const [pickedPlace, setPickedPlace] = useState<string>()
  const allRows = useMemo(
    () =>
      [...(gym?.sessions ?? [])]
        .filter((s) => s.exercises.some((e) => e.exerciseId === exerciseId))
        .sort((a, b) => b.startedAt - a.startedAt)
        .map((s) => ({
          s,
          sets: s.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter((x) => !x.warmup)),
        })),
    [gym?.sessions, exerciseId],
  )
  const placeIds = [...new Set(allRows.map(({ s }) => s.locationId))]
  const machine = ex?.load === 'machine' || ex?.load === 'cable'
  const selected = [pickedPlace, active?.id, placeIds[0]].find((id) => id !== undefined && placeIds.includes(id))
  const rows = useMemo(() => machine ? allRows.filter(({ s }) => s.locationId === selected) : allRows, [allRows, machine, selected])
  const location = machine ? gym?.locations.find((l) => l.id === selected) : active
  const unit = ex ? unitFor(ex, location) : 'kg'
  const series = useMemo(() => liftSeries(rows.map(({ s }) => s), exerciseId), [rows, exerciseId])
  const primary = series[0]
  const values = primary?.points.map((p) => p.value) ?? []
  const best = primary?.kind === 'assistance' ? Math.min(...values) : Math.max(...values)
  const record = useMemo(() => gym ? gymRecords(gym.sessions, machine ? selected : undefined)[exerciseId] : undefined, [gym, exerciseId, machine, selected])
  if (!ex) return null
  if (!rows.length) {
    return (
      <EmptyState icon="dumbbell" title={`No ${ex.name.toLowerCase()} yet`}>
        Log it once and its history starts here.
      </EmptyState>
    )
  }
  const place = (id: string) => gym?.locations.find((l) => l.id === id)?.name ?? 'A deleted place'
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-title2 font-semibold">{ex.name}</h2>
        <p className="text-footnote text-ink3">{ex.cue}</p>
      </div>
      {machine && selected ? (
        <label className="flex items-center gap-2 text-footnote text-ink2">
          Machine at
          {placeIds.length === 1 ? place(selected) : (
            <select aria-label="Gym for machine history" value={selected} onChange={(e) => setPickedPlace(e.target.value)}
              className="min-h-11 rounded-control border border-line bg-raised px-3 text-ink">
              {placeIds.map((id) => <option key={id} value={id}>{place(id)}</option>)}
            </select>
          )}
        </label>
      ) : null}
      <dl className="grid grid-cols-3 gap-2">
        <div className="rounded-inner bg-raised p-3">
          <dt className="text-caption text-ink3">Sessions</dt>
          <dd className="text-title2 font-semibold tnum">{rows.length}</dd>
        </div>
        <div className="rounded-inner bg-raised p-3">
          <dt className="text-caption text-ink3">{primary?.kind === 'estimate' ? 'Heaviest' : primary ? seriesMetric(primary, unit) : 'Best set'}</dt>
          <dd className="text-title3 font-semibold tnum">{primary?.kind === 'estimate' && record?.heaviest ? formatLoad(record.heaviest.kg, unit) : primary ? seriesValue(primary, best, unit) : '—'}</dd>
        </div>
        <div className="rounded-inner bg-raised p-3">
          <dt className="text-caption text-ink3">{primary?.kind === 'estimate' ? 'Est. max' : 'Latest comparable set'}</dt>
          <dd className="text-title3 font-semibold tnum">{primary?.kind === 'estimate' && record?.bestE1rm ? formatLoad(record.bestE1rm.kg, unit) : primary ? seriesValue(primary, values[values.length - 1], unit) : '—'}</dd>
          {primary?.kind === 'estimate' && record?.bestE1rm && isFirstEstimate(record) ? <p className="text-caption text-ink3">{FIRST_ESTIMATE_NOTE}</p> : null}
        </div>
      </dl>
      <PerformanceChart series={series} compact />
      <ol className="divide-y divide-line">
        {rows.map(({ s, sets }) => (
          <li key={s.id} className="py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-footnote font-semibold">
                {new Date(s.startedAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
              </span>
              <span className="text-caption text-ink3">{place(s.locationId)}</span>
            </div>
            <p className="mt-0.5 text-footnote tnum text-ink2">
              {sets
                .map((x) => `${x.kg ? `${formatLoad(x.kg, x.unit ?? unit)} × ` : ''}${ex.count === 'contacts' ? `${x.reps} contacts` : countWord(ex, x.reps)}${x.rpe !== undefined ? ` @${x.rpe}` : ''}`)
                .join(' · ')}
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}
