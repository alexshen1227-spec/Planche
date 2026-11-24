import { useState } from 'react'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { allowsUnloaded, countUnit, countWord } from '../../lib/gym/progression'
import { doubtedLoad, maxCountFor } from '../../lib/gym/state'
import { conservative } from '../../lib/gym/draft'
import { effortLabel, exerciseTitle, nextTimeLines } from '../../lib/gym/sessionLines'
import type { GymSession, GymSet } from '../../lib/gym/types'
import { entryLoad, formatLoad, toKg } from '../../lib/gym/units'
import { useStore } from '../../lib/store'
import { pushToast } from '../../lib/toast'
import { Button } from '../ds'

function when(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

/**
 * One saved gym session: its sets, a way to correct a load or rep count, and
 * Delete behind a confirmation. Records, estimated maxes and the next suggested
 * loads are derived from the sessions, so both change them at once.
 */
export function SessionDetail({ session, onClose }: { session: GymSession; onClose: () => void }) {
  const { state, dispatch } = useStore()
  const gym = state.gym
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState<{ ei: number; si: number } | null>(null)
  const place = gym?.locations.find((l) => l.id === session.locationId)
  const unit = place?.unit ?? 'kg'
  // Next time for each lift, from the rule the builder uses on the history as it stands now.
  const next = nextTimeLines(session, gym?.sessions ?? [], place, conservative(state.profile), Date.now())
  const nextOf = (id: string) => next.find((n) => n.exerciseId === id)

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-title2 font-semibold">{session.name}</h2>
        <p className="text-footnote text-ink3">{when(session.startedAt)}</p>
        {session.notes ? (
          <p className="mt-2 rounded-control bg-raised p-3 text-footnote text-ink2">
            <span className="font-semibold text-ink">Your note: </span>
            {session.notes}
          </p>
        ) : null}
      </div>
      {session.exercises.map((log, ei) => {
        const ex = GYM_EXERCISE_BY_ID[log.exerciseId]
        return (
          <section key={`${log.exerciseId}-${ei}`}>
            <h3 className="text-body font-semibold">{exerciseTitle(log.exerciseId)}</h3>
            {log.note ? <p className="text-footnote text-ink2">Note: {log.note}</p> : null}
            <ul className="mt-1 divide-y divide-line">
              {log.sets.map((set, si) => (
                <li key={si} className="py-1">
                  {editing && editing.ei === ei && editing.si === si ? (
                    <SetEditor
                      session={session}
                      exerciseId={log.exerciseId}
                      set={set}
                      unit={set.unit ?? unit}
                      onDone={() => setEditing(null)}
                      onSave={(kg, reps) => {
                        dispatch({
                          type: 'GYM',
                          op: { op: 'correctSet', sessionId: session.id, exerciseIndex: ei, setIndex: si, kg, reps },
                        })
                        pushToast('Set corrected — records are recalculated.', 'success')
                        setEditing(null)
                      }}
                    />
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-footnote tnum text-ink2">
                        {set.warmup ? 'Warm-up · ' : ''}
                        {countUnit(ex) !== 'reps' ? `${countWord(ex, set.reps)}${set.kg || ex?.stepFrom === 'sled' ? ` · ${formatLoad(set.kg, set.unit ?? unit, ex)}` : ''}` : `${set.reps} × ${formatLoad(set.kg, set.unit ?? unit, ex)}`}
                        {effortLabel(set.rpe) ? ` · ${effortLabel(set.rpe)}` : ''}
                      </span>
                      <button
                        onClick={() => setEditing({ ei, si })}
                        aria-label={`Correct set ${si + 1} of ${ex?.name ?? log.exerciseId}`}
                        className="min-h-11 px-3 text-footnote font-medium text-accent-text"
                      >
                        Correct
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {nextOf(log.exerciseId) ? (
              <div className="mt-1 rounded-control bg-raised p-3">
                {nextOf(log.exerciseId)!.superseded ? (
                  <p className="text-footnote text-ink2">A later session trained this lift, so its own “next time” is the one to follow. As of now:</p>
                ) : null}
                <p className="text-footnote font-semibold text-ink">{nextOf(log.exerciseId)!.text}</p>
                <p className="text-caption text-ink3">{nextOf(log.exerciseId)!.why}</p>
                {nextOf(log.exerciseId)!.maxNote ? <p className="text-caption text-ink3">{nextOf(log.exerciseId)!.maxNote}</p> : null}
              </div>
            ) : null}
          </section>
        )
      })}
      {session.remaining?.items.length ? (
        <section>
          <h3 className="text-body font-semibold">Unfinished sets</h3>
          <ul className="mt-1 text-footnote text-ink2">
            {session.remaining.items.map((item, i) => <li key={i}>{exerciseTitle(item.exerciseId)} · {item.sets.length} {item.sets.length === 1 ? 'set' : 'sets'} left</li>)}
          </ul>
        </section>
      ) : null}
      {confirming ? (
        <div className="rounded-card border border-line-strong bg-raised p-4" role="alertdialog" aria-label="Confirm delete">
          <p className="text-body font-semibold">
            Delete “{session.name}” from {when(session.startedAt)}?
          </p>
          <p className="mt-1 text-footnote text-ink2">
            Every set in it goes, and your records, estimated maxes and next suggested loads are worked out again without it.
            This cannot be undone.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              variant="danger"
              onClick={() => {
                dispatch({ type: 'GYM', op: { op: 'deleteSession', id: session.id } })
                pushToast('Session deleted.', 'info')
                onClose()
              }}
            >
              Delete it
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" full onClick={() => setConfirming(true)}>
          Delete session
        </Button>
      )}
    </div>
  )
}

function SetEditor({
  session,
  exerciseId,
  set,
  unit,
  onSave,
  onDone,
}: {
  session: GymSession
  exerciseId: string
  set: GymSet
  unit: 'kg' | 'lb'
  onSave: (kg: number | null, reps: number) => void
  onDone: () => void
}) {
  const { state } = useStore()
  const [load, setLoad] = useState(set.kg !== undefined ? String(entryLoad(set.kg, unit)) : '')
  const [reps, setReps] = useState(String(set.reps))
  const [doubt, setDoubt] = useState<{ bestKg: number; probablyKg?: number; typedKg: number } | null>(null)
  const field = 'min-h-11 w-24 rounded-control border border-line-strong bg-surface px-3 text-body tnum'

  const submit = (kg: number | null) => onSave(kg, Math.round(Number(reps)))
  const valid = reps !== '' && Number(reps) >= 0 && Number(reps) <= maxCountFor(exerciseId)
  const typed = load.trim() === '' ? null : toKg(Number(load), unit)
  const exercise = GYM_EXERCISE_BY_ID[exerciseId]
  // A loaded lift cannot be corrected to no weight: that would read as a 0 kg set.
  const needsWeight = typed === null && !allowsUnloaded(exercise)
  const loadOk = !needsWeight && (typed === null || (Number.isFinite(typed) && (typed > 0 || (typed === 0 && exercise?.assisted)) && typed < 1000))

  if (doubt) {
    const shown = (kg: number) => formatLoad(kg, unit)
    return (
      <div className="space-y-2 rounded-control bg-raised p-3">
        <p className="text-footnote text-ink2">
          Did you mean {doubt.probablyKg !== undefined ? shown(doubt.probablyKg) : 'a lighter load'}? {shown(doubt.typedKg)} is well above
          your best of {shown(doubt.bestKg)} on this lift.
        </p>
        <div className="flex flex-wrap gap-2">
          {doubt.probablyKg !== undefined ? <Button onClick={() => submit(doubt.probablyKg!)}>Use {shown(doubt.probablyKg)}</Button> : null}
          <Button variant="secondary" onClick={() => submit(doubt.typedKg)}>
            Keep {shown(doubt.typedKg)}
          </Button>
          <Button variant="ghost" onClick={() => setDoubt(null)}>
            Edit again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-2 py-1">
      <label className="text-caption text-ink3">
        {exercise?.assisted ? 'Assistance' : 'Load'} ({unit})
        <input className={`${field} mt-0.5 block`} inputMode="decimal" value={load} onChange={(e) => setLoad(e.target.value)} placeholder={exercise?.assisted ? 'Unknown' : exercise?.stepFrom === 'sled' ? 'Empty sled' : allowsUnloaded(exercise) ? 'Bodyweight' : 'Weight'} />
      </label>
      <label className="text-caption text-ink3">
        <span className="capitalize">{countUnit(exercise)}</span>{countUnit(exercise) === 'trips' ? ` of ${exercise!.distanceM} m` : ''}
        <input className={`${field} mt-0.5 block`} inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} />
      </label>
      <Button
        disabled={!valid || !loadOk}
        onClick={() => {
          if (typed === null || exercise?.assisted) return submit(typed)
          const d = doubtedLoad(state.gym?.sessions ?? [], exerciseId, typed, session.id, session.locationId)
          if (d) setDoubt({ ...d, typedKg: typed })
          else submit(typed)
        }}
      >
        Save
      </Button>
      <Button variant="ghost" onClick={onDone}>
        Cancel
      </Button>
    </div>
  )
}
