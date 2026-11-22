import { useState } from 'react'
import type { ActivityKind } from '../../lib/gym/types'
import { useStore } from '../../lib/store'
import { pushToast } from '../../lib/toast'
import { Button, SegmentedControl, ToggleChip } from '../ds'

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
  return (
    <div className="space-y-4">
      <h2 className="font-display text-title2 font-semibold text-ink">Log a sport or activity</h2>
      <p className="text-body text-ink2">
        Sports and activities outside the app count toward fatigue: a hard sprint day means lighter legs in the gym, and
        it can stand in for leg day.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="What you did">
        {KINDS.map((k) => (
          <ToggleChip
            key={k.id}
            active={kind === k.id}
            onClick={() => {
              setKind(k.id)
              setLegs(k.legs)
            }}
          >
            {k.label}
          </ToggleChip>
        ))}
      </div>
      <div>
        <p className="text-footnote font-medium text-ink2">How long</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {[20, 30, 45, 60, 90, 120].map((m) => (
            <ToggleChip key={m} active={minutes === m} onClick={() => setMinutes(m)}>
              {m} min
            </ToggleChip>
          ))}
        </div>
      </div>
      <div>
        <p className="text-footnote font-medium text-ink2">How hard (1 easy — 10 all-out)</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {[2, 4, 6, 7, 8, 9, 10].map((r) => (
            <ToggleChip key={r} active={rpe === r} onClick={() => setRpe(r)}>
              {r}
            </ToggleChip>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleChip active={legs} onClick={() => setLegs(!legs)}>
          {legs ? 'Hard on the legs' : 'Not hard on the legs'}
        </ToggleChip>
      </div>
      <SegmentedControl
        label="When"
        value={when}
        onChange={setWhen}
        options={[
          { value: 'today' as const, label: 'Today' },
          { value: 'yesterday' as const, label: 'Yesterday' },
        ]}
      />
      <Button size="lg" full onClick={save}>
        Log it
      </Button>
    </div>
  )
}
