import { useState } from 'react'
import { useStore } from '../../lib/store'
import { fmtDate } from '../../lib/time'
import { Button, Card, EmptyState, Sheet } from '../ds'
import { SessionDetail } from './SessionDetail'

export function GymHistory({ limit }: { limit?: number }) {
  const { state } = useStore()
  const gym = state.gym
  const [selected, setSelected] = useState<string | null>(null)
  const [count, setCount] = useState(20)
  const sessions = [...(gym?.sessions ?? [])].sort((a, b) => b.startedAt - a.startedAt)
  const openSession = selected ? sessions.find((s) => s.id === selected) : undefined
  return (
    <section>
      <h2 className="text-footnote font-semibold uppercase tracking-wide text-ink3">{limit ? 'Recent sessions' : 'Workout history'}</h2>
      {sessions.length ? (
        <ul className="mt-2 space-y-2">
          {sessions.slice(0, limit ?? count).map((s) => {
            const sets = s.exercises.reduce((n, e) => n + e.sets.filter((x) => !x.warmup && x.reps > 0).length, 0)
            const place = gym?.locations.find((l) => l.id === s.locationId)?.name ?? 'Previous gym'
            return (
              <li key={s.id}>
                <button onClick={() => setSelected(s.id)} aria-label={`${s.name}, ${fmtDate(s.startedAt)} — open to correct or delete`}
                  className="ds-press block min-h-11 w-full rounded-card border border-line bg-surface p-4 text-left">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-body font-semibold">{s.name}</span>
                    <span className="text-caption text-ink3">{fmtDate(s.startedAt)}</span>
                  </span>
                  <span className="mt-0.5 block text-footnote text-ink2">
                    {place} · {s.exercises.length} {s.exercises.length === 1 ? 'exercise' : 'exercises'} · {sets} {sets === 1 ? 'set' : 'sets'}
                    {s.completion === 'partial' ? ' · some sets skipped' : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <Card className="mt-2"><EmptyState icon="calendar" title="No gym sessions yet">Save a workout to see your sets and next targets here.</EmptyState></Card>
      )}
      {!limit && sessions.length > count ? <Button variant="secondary" className="mt-2" onClick={() => setCount(count + 20)}>Show older workouts</Button> : null}
      <Sheet open={Boolean(openSession)} onClose={() => setSelected(null)} label="Gym session">
        {openSession ? <SessionDetail session={openSession} onClose={() => setSelected(null)} /> : null}
      </Sheet>
    </section>
  )
}
