import { useState } from 'react'
import type { SportDateChange, SportDateEdit, SportSlot } from '../../lib/gym/types'
import { SPORT_KINDS, sportStart } from '../../lib/plan/sport'
import { useStore } from '../../lib/store'
import { dayKey } from '../../lib/time'
import { Button } from '../ds'

const dateLabel = (day: string) => new Date(day + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const timeLabel = (start: string) => new Date(start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

function Occurrence({ day, slot, change, apply }: { day: string; slot: SportSlot; change?: SportDateChange; apply: (edit: SportDateEdit) => void }) {
  const [editing, setEditing] = useState(false)
  const usual = day + 'T' + String(slot.hour ?? 17).padStart(2, '0') + ':00'
  const current = change?.status === 'moved' ? change.start : usual
  const [start, setStart] = useState(current)
  const name = SPORT_KINDS.find((k) => k.id === slot.kind)!.label
  const changed = change && change.status !== 'restored'
  const save = (edit: SportDateEdit) => { apply(edit); setEditing(false) }
  return <div className="rounded-inner border border-line px-3 py-1.5">
    <div className="flex flex-wrap items-center justify-between gap-x-2">
      <p className="text-footnote text-ink2"><strong className="text-ink">{name}</strong>{' · '}
        {change?.status === 'skipped' ? 'Skipped' : change?.status === 'moved'
          ? `Moved from ${dateLabel(day)} to ${dateLabel(current.slice(0, 10))} at ${timeLabel(current)}`
          : `${timeLabel(usual)} · ${slot.minutes} min`}
      </p>
      <button type="button" className="min-h-11 text-footnote font-semibold text-accent-text"
        aria-label={`Change ${name.toLowerCase()} scheduled for ${dateLabel(day)}`} aria-expanded={editing}
        onClick={() => { setStart(current); setEditing(!editing) }}>Change</button>
    </div>
    {editing && <div className="space-y-2 border-t border-line py-3">
      <label className="block text-footnote font-semibold">New date and time
        <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)}
          className="mt-1 block min-h-11 w-full min-w-0 rounded-control border border-line bg-surface px-2 text-body font-normal" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={sportStart(start) === undefined || start === current} onClick={() => save({ day, slot, status: 'moved', start })}>Move this session</Button>
        {change?.status !== 'skipped' && <Button variant="secondary" onClick={() => save({ day, slot, status: 'skipped' })}>Skip this session</Button>}
        {changed && <Button variant="secondary" onClick={() => save({ day, slot, status: 'restored' })}>Restore regular session</Button>}
      </div>
      <button type="button" className="min-h-11 text-footnote font-semibold text-accent-text" onClick={() => setEditing(false)}>Cancel</button>
    </div>}
  </div>
}

/** Edit a single local-date occurrence from either end of a move. */
export function SportOnDate({ at, showEmpty = false }: { at: number; showEmpty?: boolean }) {
  const { state, dispatch } = useStore()
  const gym = state.gym
  const day = dayKey(at)
  const regular = gym?.prefs?.sportSchedule?.find((s) => s.weekday === new Date(at).getDay())
  const rows = new Map<string, { day: string; slot: SportSlot; change?: SportDateChange }>()
  if (regular) rows.set(day + regular.kind, { day, slot: regular })
  for (const c of gym?.sportChanges ?? []) {
    if (c.status !== 'restored' && (c.day === day || (c.status === 'moved' && c.start.slice(0, 10) === day))) {
      rows.set(c.day + c.slot.kind, { day: c.day, slot: c.slot, change: c })
    }
  }
  if (!rows.size) return showEmpty ? <p className="text-footnote text-ink2">No scheduled sport on this date.</p> : null
  return <div className="mt-2 space-y-2" aria-label="Scheduled sport">
    {[...rows].map(([id, row]) => <Occurrence key={id} {...row} apply={(change) => dispatch({ type: 'GYM', op: { op: 'changeSportDate', change } })} />)}
  </div>
}
