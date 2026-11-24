import { useState } from 'react'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import type { Unit } from '../../data/gym/catalog'
import { activeLocation } from '../../lib/gym/draft'
import type { LiftSeries } from '../../lib/gym/performance'
import { displayLoad, formatLoad, unitFor, unloadedLabel } from '../../lib/gym/units'
import { useStore } from '../../lib/store'
import { HoldLineChart } from '../charts'
import { EmptyState } from '../ds'

export function seriesMetric(series: LiftSeries, unit: Unit) {
  const load = series.loadKg ? ` at ${formatLoad(series.loadKg, unit)}` : ''
  switch (series.kind) {
    case 'estimate': return 'Estimated max'
    case 'assistance': return `Least assistance for ${series.minReps}+ reps`
    case 'seconds': return `Longest ${GYM_EXERCISE_BY_ID[series.id]?.pattern === 'carry' ? 'carry' : 'hold'}${load}`
    case 'contacts': return `Session contacts${load}`
    case 'distance': return `Distance completed${load}`
    default: return `Most reps${load || (unloadedLabel(GYM_EXERCISE_BY_ID[series.id]) === 'Band' ? ' with a band' : ' at bodyweight')}`
  }
}

export function seriesValue(series: LiftSeries, value: number, unit: Unit): string {
  if (series.kind === 'assistance') return value === 0 ? 'No assistance' : formatLoad(value, unit)
  if (series.kind === 'estimate') return formatLoad(value, unit)
  return `${value} ${series.kind === 'seconds' ? 's' : series.kind === 'distance' ? 'm' : series.kind}`
}

export function PerformanceChart({ series, compact = false }: { series: LiftSeries[]; compact?: boolean }) {
  const { state } = useStore()
  const [picked, setPicked] = useState<string>()
  const available = series.filter((s) => s.points.length >= 2)
  const shown = available.find((s) => s.key === picked) ?? available[0]
  if (!shown) {
    const hint = 'Log this exercise in two sessions with comparable sets to see its trend.'
    return compact ? <p className="text-caption text-ink3">{hint}</p>
      : <EmptyState icon="chart" title="No chart yet">Log the same exercise in two sessions to compare your reps, time or load.</EmptyState>
  }
  const location = (s: LiftSeries) => s.placeId ? state.gym?.locations.find((l) => l.id === s.placeId) : activeLocation(state.gym)
  const unitOf = (s: LiftSeries) => unitFor(GYM_EXERCISE_BY_ID[s.id], location(s))
  const name = (s: LiftSeries) => GYM_EXERCISE_BY_ID[s.id].name + (s.placeId ? ` · ${location(s)?.name ?? 'Previous gym'}` : '')
  const unit = unitOf(shown)
  const label = seriesMetric(shown, unit)
  const weight = shown.kind === 'assistance' || shown.kind === 'estimate'
  const band = unloadedLabel(GYM_EXERCISE_BY_ID[shown.id]) === 'Band'
  return (
    <section className="space-y-2">
      <h3 className="font-display text-body font-semibold">{label}{!compact && ` — ${name(shown)}`}</h3>
      {available.length > 1 && (
        <select value={shown.key} onChange={(e) => setPicked(e.target.value)} aria-label="Lift to chart"
          className="min-h-11 w-full rounded-control border border-line bg-raised px-2 text-footnote">
          {available.map((s) => <option key={s.key} value={s.key}>{name(s)} · {seriesMetric(s, unitOf(s))}</option>)}
        </select>
      )}
      <HoldLineChart points={shown.points} height={160} label={`${label} for ${name(shown)}`}
        format={(v) => seriesValue(shown, v, unit)} axisFormat={(v) => String(weight ? displayLoad(v, unit) : v)} />
      <p className="text-caption text-ink3">
        {shown.kind === 'estimate' ? 'Estimated from each session’s best eligible working set, adjusted for effort.'
          : shown.kind === 'assistance' ? `Each point shows the least help you used for at least ${shown.minReps} reps on this machine.`
          : band ? 'Compare sessions using the same band and starting stretch.'
          : shown.kind === 'contacts' || shown.kind === 'distance' ? 'Each point totals the working sets completed in one session.'
          : 'Each point is your best working set in one session at the same load.'}
      </p>
    </section>
  )
}
