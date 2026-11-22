import { useMemo } from 'react'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { activeLocation } from '../../lib/gym/draft'
import { estimateOneRepMax, gymRecords } from '../../lib/gym/progression'
import { formatLoad, unitFor } from '../../lib/gym/units'
import { useStore } from '../../lib/store'
import { HoldLineChart } from '../charts'
import { EmptyState } from '../ds'

/** Every session of one lift: where, what was lifted, and its estimated max over time. */
export function ExerciseHistory({ exerciseId }: { exerciseId: string }) {
  const { state } = useStore()
  const gym = state.gym
  const ex = GYM_EXERCISE_BY_ID[exerciseId]
  const location = activeLocation(gym)
  const unit = ex && location ? unitFor(ex, location) : location?.unit ?? 'kg'
  const rows = useMemo(
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
  const points = useMemo(
    () =>
      rows
        .map(({ s, sets }) => ({ at: s.startedAt, value: Math.max(0, ...sets.map((x) => estimateOneRepMax(x) ?? 0)) }))
        .filter((p) => p.value > 0)
        .reverse(),
    [rows],
  )
  const record = gym ? gymRecords(gym.sessions)[exerciseId] : undefined
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
      <dl className="grid grid-cols-3 gap-2">
        <div className="rounded-inner bg-raised p-3">
          <dt className="text-caption text-ink3">Sessions</dt>
          <dd className="text-title2 font-semibold tnum">{rows.length}</dd>
        </div>
        <div className="rounded-inner bg-raised p-3">
          <dt className="text-caption text-ink3">Heaviest</dt>
          <dd className="text-title3 font-semibold tnum">{record?.heaviest ? formatLoad(record.heaviest.kg, unit) : '—'}</dd>
        </div>
        <div className="rounded-inner bg-raised p-3">
          <dt className="text-caption text-ink3">Est. max</dt>
          <dd className="text-title3 font-semibold tnum">{record?.bestE1rm ? formatLoad(record.bestE1rm.kg, unit) : '—'}</dd>
        </div>
      </dl>
      {points.length >= 2 ? (
        <HoldLineChart points={points} height={160} label={`Estimated max for ${ex.name}`} format={(v) => formatLoad(v, unit)} />
      ) : (
        <p className="text-caption text-ink3">
          {ex.load === 'bodyweight'
            ? 'Bodyweight sets have no estimated max; the most reps in a set is the record.'
            : 'The estimated-max chart appears after two sessions with a loaded set of 12 reps or fewer.'}
        </p>
      )}
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
                .map((x) => `${x.kg ? `${formatLoad(x.kg, x.unit ?? unit)} × ` : ''}${x.reps}${x.rpe !== undefined ? ` @${x.rpe}` : ''}`)
                .join(' · ')}
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}
