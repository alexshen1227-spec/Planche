import { useState } from 'react'
import type { ActivityKind } from '../../lib/gym/types'
import { useStore } from '../../lib/store'
import { pushToast } from '../../lib/toast'

const KINDS: { id: ActivityKind; label: string; legs: boolean }[] = [
  { id: 'sprint', label: 'Sprinting', legs: true },
  { id: 'practice', label: 'Practice', legs: true },
  { id: 'game', label: 'Game', legs: true },
  { id: 'pe', label: 'PE', legs: true },
  { id: 'run', label: 'Run', legs: true },
  { id: 'other', label: 'Other', legs: false },
]

/** Log a sport or activity so it counts toward fatigue and the plan around it. */
export function ActivitySheet({ onDone }: { onDone: () => void }) {
  const { dispatch } = useStore()
  const [kind, setKind] = useState<ActivityKind>('sprint')
  const [minutes, setMinutes] = useState(60)
  const [rpe, setRpe] = useState(7)
  const [legs, setLegs] = useState(true)
  const [when, setWhen] = useState<'today' | 'yesterday'>('today')
  const save = () => {
    const at = Date.now() - (when === 'yesterday' ? 86_400_000 : 0)
    dispatch({
      type: 'GYM',
      op: { op: 'logActivity', activity: { id: `act-${at.toString(36)}`, at, kind, minutes, rpe, legs } },
    })
    pushToast('Logged — the plan now counts it.', 'success')
    onDone()
  }
  const chip = (active: boolean) =>
    `min-h-11 rounded-xl border px-3 text-[14px] font-medium ${active ? 'border-transparent bg-accent text-on-accent' : 'border-line text-ink2'}`
  return (
    <div className="space-y-4">
      <p className="text-[14px] text-ink2">
        Sports and activities outside the app count toward fatigue: a hard sprint day means lighter legs in the gym, and
        it can stand in for leg day.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {KINDS.map((k) => (
          <button
            key={k.id}
            aria-pressed={kind === k.id}
            onClick={() => {
              setKind(k.id)
              setLegs(k.legs)
            }}
            className={chip(kind === k.id)}
          >
            {k.label}
          </button>
        ))}
      </div>
      <div>
        <p className="text-[13px] font-medium text-ink2">How long</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {[20, 30, 45, 60, 90, 120].map((m) => (
            <button key={m} aria-pressed={minutes === m} onClick={() => setMinutes(m)} className={chip(minutes === m)}>
              {m} min
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[13px] font-medium text-ink2">How hard (1 easy — 10 all-out)</p>
        <div className="mt-1 grid grid-cols-5 gap-2">
          {[2, 4, 6, 7, 8, 9, 10].map((r) => (
            <button key={r} aria-pressed={rpe === r} onClick={() => setRpe(r)} className={chip(rpe === r)}>
              {r}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button aria-pressed={legs} onClick={() => setLegs(!legs)} className={`${chip(legs)} flex-1`}>
          {legs ? 'Hard on the legs' : 'Not hard on the legs'}
        </button>
        <button aria-pressed={when === 'yesterday'} onClick={() => setWhen(when === 'today' ? 'yesterday' : 'today')} className={`${chip(false)} flex-1`}>
          {when === 'today' ? 'Today' : 'Yesterday'}
        </button>
      </div>
      <button onClick={save} className="min-h-12 w-full rounded-xl bg-accent text-[15px] font-semibold text-on-accent">
        Log it
      </button>
    </div>
  )
}
