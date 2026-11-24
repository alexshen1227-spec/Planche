import { useState } from 'react'
import type { ActivityKind, SportLoadAreas } from '../../lib/gym/types'
import { SPORT_KINDS, sportStart } from '../../lib/plan/sport'
import { SportAreas } from './SportAreas'
import { SportOnDate } from './SportOnDate'
import { dayKey } from '../../lib/time'
import { useStore } from '../../lib/store'
import { pushToast } from '../../lib/toast'
import { Button, SegmentedControl, ToggleChip } from '../ds'

/**
 * When a logged activity happened: `ahead` calendar days from now (negative =
 * past). Something coming up is put at 5 pm that day. Calendar arithmetic, not
 * 24-hour steps — across a daylight-saving change those land an hour off.
 */
export function activityTime(now: number, ahead: number): number {
  const day = new Date(now)
  day.setDate(day.getDate() + ahead)
  if (ahead > 0) day.setHours(17, 0, 0, 0)
  return day.getTime()
}

/** Log a sport or activity so it counts toward fatigue and the plan around it. */
export function ActivitySheet({ onDone }: { onDone: () => void }) {
  const { state, dispatch } = useStore()
  const nearby = (state.gym?.activities ?? [])
    .filter((a) => Math.abs(a.at - Date.now()) < 7 * 86_400_000)
    .sort((a, b) => b.at - a.at)
  const [kind, setKind] = useState<ActivityKind>('sprint')
  const [minutes, setMinutes] = useState(60)
  const [rpe, setRpe] = useState(7)
  const [areas, setAreas] = useState<SportLoadAreas>({ legs: true })
  const [when, setWhen] = useState<'yesterday' | 'today' | 'tomorrow' | 'in2'>('today')
  const [scheduleDay, setScheduleDay] = useState(() => dayKey(Date.now()))
  const [exact, setExact] = useState<string | null>(null)
  const save = () => {
    const ahead = { yesterday: -1, today: 0, tomorrow: 1, in2: 2 }[when]
    // Something coming up is put at 5 pm that day, so the plan can keep legs fresh for it.
    const at = exact === null ? activityTime(Date.now(), ahead) : sportStart(exact)
    if (at === undefined) return
    dispatch({
      type: 'GYM',
      op: { op: 'logActivity', activity: { id: `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, at, kind, minutes, rpe, ...areas } },
    })
    pushToast(at > Date.now() ? 'Added to your training week.' : 'Activity logged.', 'success')
    onDone()
  }
  return (
    <div className="space-y-4">
      <h2 className="font-display text-title2 font-semibold text-ink">Log a sport or activity</h2>
      {Boolean(state.gym?.prefs?.sportSchedule?.length || state.gym?.sportChanges?.length) && <details className="rounded-inner border border-line px-3">
        <summary className="cursor-pointer py-3 text-footnote font-semibold">Move or skip a scheduled session</summary>
        <label className="block text-footnote font-medium">Scheduled date
          <input type="date" value={scheduleDay} onChange={(e) => setScheduleDay(e.target.value)}
            className="mt-1 block min-h-11 w-full rounded-control border border-line bg-surface px-2 text-body" />
        </label>
        <div className="mb-3">{scheduleDay && <SportOnDate key={scheduleDay} at={new Date(scheduleDay + 'T12:00').getTime()} showEmpty />}</div>
      </details>}
      <p className="text-body text-ink2">
        Choose the areas you used. Your plan gives those areas time to recover after a hard session.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="What you did">
        {SPORT_KINDS.map((k) => (
          <ToggleChip
            key={k.id}
            active={kind === k.id}
            onClick={() => {
              setKind(k.id)
              setAreas({ legs: k.legs, upperPull: k.upperPull, upperPush: k.upperPush })
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
      <SportAreas areas={areas} onChange={(p) => setAreas((a) => ({ ...a, ...p }))} />
      {exact === null ? <SegmentedControl
        label="When"
        value={when}
        onChange={setWhen}
        options={[
          { value: 'yesterday' as const, label: 'Yesterday' },
          { value: 'today' as const, label: 'Today' },
          { value: 'tomorrow' as const, label: 'Tomorrow' },
          { value: 'in2' as const, label: 'In 2 days' },
        ]}
      /> : <label className="block text-footnote font-medium">Activity date and time
        <input type="datetime-local" value={exact} onChange={(e) => setExact(e.target.value)}
          className="mt-1 block min-h-11 w-full min-w-0 rounded-control border border-line bg-surface px-2 text-body" />
      </label>}
      <button type="button" className="min-h-11 text-footnote font-semibold text-accent-text"
        onClick={() => setExact(exact === null ? dayKey(Date.now()) + 'T' + new Date().toTimeString().slice(0, 5) : null)}>
        {exact === null ? 'Choose a date and time' : 'Use quick dates'}
      </button>
      <Button size="lg" full onClick={save} disabled={exact !== null && sportStart(exact) === undefined}>
        Log it
      </Button>
      {nearby.length ? (
        <div>
          <p className="text-footnote font-medium text-ink2">This week, before and ahead</p>
          <ul className="mt-1 divide-y divide-line">
            {nearby.map((a) => (
              <li key={a.id} className="flex min-h-11 items-center justify-between gap-2 py-1">
                <span className="text-footnote">
                  {SPORT_KINDS.find((k) => k.id === a.kind)?.label ?? a.kind} · {a.minutes} min · {a.rpe}/10
                  <span className="text-ink3">
                    {' '}
                    · {new Date(a.at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                    {a.at > Date.now() ? ' (upcoming)' : ''}
                  </span>
                </span>
                <Button variant="ghost" onClick={() => dispatch({ type: 'GYM', op: { op: 'deleteActivity', id: a.id } })}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
