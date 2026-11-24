import { useMemo } from 'react'
import { MUSCLE_GROUPS, MUSCLES } from '../../data/gym/catalog'
import { defaultPrefs } from '../../lib/gym/state'
import { setsPerMuscle, volumeStatus, volumeTarget, type VolumeStatus } from '../../lib/plan/load'
import { useStore } from '../../lib/store'
import { weekStart } from '../../lib/time'
import { useToday } from '../../lib/useToday'

const STATUS: Record<VolumeStatus, { label: string; tone: string }> = {
  off: { label: 'off', tone: 'text-ink3' },
  under: { label: 'under', tone: 'text-accent-text' },
  on: { label: 'on target', tone: 'text-ok-text' },
  over: { label: 'over', tone: 'text-danger-text' },
}

/** This week's sets per muscle — gym and skill work counted together — against the targets. */
export function WeekVolume() {
  const { state } = useStore()
  const today = useToday()
  const now = Date.now()
  const prefs = state.gym?.prefs ?? defaultPrefs()
  const sets = useMemo(
    () => setsPerMuscle(state.sessions, state.gym?.sessions ?? [], weekStart(now), now + 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.sessions, state.gym?.sessions, today],
  )
  return (
    <section>
      <h2 className="text-footnote font-semibold uppercase tracking-wide text-ink3">This week, sets per muscle</h2>
      <p className="mt-1 text-caption text-ink3">
        These are estimated working sets. A secondary muscle gets half credit. Skill attempts below half their target
        stay in your practice log. Light skill sets that reach that mark get half credit. The ranges are weekly coaching targets.
      </p>
      <div className="mt-3 space-y-4">
        {MUSCLE_GROUPS.map((group) => (
          <div key={group.id}>
            <p className="text-caption font-semibold text-ink2">{group.label}</p>
            <ul className="mt-1 space-y-1.5">
              {MUSCLES.filter((m) => m.group === group.id).map((m) => {
                const target = volumeTarget(m.id, prefs)
                const done = Math.round((sets[m.id] ?? 0) * 2) / 2
                const status = volumeStatus(done, target)
                const width = target[1] > 0 ? Math.min(100, (done / target[1]) * 100) : 0
                return (
                  <li key={m.id} className="grid grid-cols-[7.5rem_1fr_5.5rem] items-center gap-2 text-footnote">
                    <span className="truncate">{m.label}</span>
                    <span className="relative h-2 overflow-hidden rounded-full bg-raised" aria-hidden>
                      {target[1] > 0 ? (
                        <span
                          className="absolute inset-y-0 rounded-full bg-ok-soft"
                          style={{ left: `${(target[0] / target[1]) * 100}%`, right: 0 }}
                        />
                      ) : null}
                      <span
                        className={`absolute inset-y-0 left-0 rounded-full ${status === 'over' ? 'bg-danger' : status === 'on' ? 'bg-ok' : 'bg-accent'} transition-[width] duration-700 motion-reduce:transition-none`}
                        style={{ width: `${width}%` }}
                      />
                    </span>
                    <span className={`text-right tnum ${STATUS[status].tone}`}>
                      {status === 'off' ? 'off' : `${done}/${target[0]}–${target[1]}`}
                      {status !== 'off' ? <span className="block text-caption">{STATUS[status].label}</span> : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
