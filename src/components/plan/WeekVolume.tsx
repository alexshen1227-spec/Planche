import { useMemo } from 'react'
import { MUSCLE_BY_ID, MUSCLE_GROUPS, MUSCLES, locationEquipmentLabel } from '../../data/gym/catalog'
import { missingPriorityOption } from '../../lib/gym/availability'
import { gymPlaceOf } from '../../lib/plan/planner'
import { defaultPrefs } from '../../lib/gym/state'
import { setsPerMuscle, volumeStatus, volumeTarget, type VolumeStatus } from '../../lib/plan/load'
import { useStore } from '../../lib/store'
import { weekStart } from '../../lib/time'
import { useToday } from '../../lib/useToday'
import { weekForChoice } from '../../lib/plan/currentWeek'
import { useTodayChoice } from '../../lib/plan/todayChoice'
import { usePlanClock } from '../../lib/plan/usePlanClock'

const STATUS: Record<VolumeStatus, { label: string; tone: string }> = {
  off: { label: 'off', tone: 'text-ink3' },
  under: { label: 'logged', tone: 'text-ink2' },
  on: { label: 'on target', tone: 'text-ok-text' },
  over: { label: 'over', tone: 'text-danger-text' },
}

/** This week's sets per muscle — gym and skill work counted together — against the targets. */
export function WeekVolume() {
  const { state } = useStore()
  const today = useToday()
  usePlanClock()
  const [choice] = useTodayChoice(today)
  const now = Date.now()
  const prefs = state.gym?.prefs ?? defaultPrefs(now)
  const priorities = prefs.musclesPriority.filter((m) => !prefs.musclesOff.includes(m))
  const planned = priorities.length ? weekForChoice(state, choice, now).weekTotal : {}
  const place = gymPlaceOf(state, now)
  const sets = useMemo(
    () => setsPerMuscle(state.sessions, state.gym?.sessions ?? [], weekStart(now), now + 1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.sessions, state.gym?.sessions, today],
  )
  return (
    <section>
      <h2 className="text-footnote font-semibold uppercase tracking-wide text-ink3">This week, sets per muscle</h2>
      {priorities.length > 0 && (
        <div className="mt-3 rounded-card border border-line bg-surface p-4">
          <h3 className="text-body font-semibold">Your priority muscles</h3>
          <table className="mt-2 w-full text-left text-footnote tnum">
            <thead><tr className="text-caption text-ink3">
              <th scope="col" className="font-medium">Muscle</th>
              <th scope="col" className="text-right font-medium">Logged</th>
              <th scope="col" className="text-right font-medium">Week plan</th>
              <th scope="col" className="text-right font-medium">Range</th>
            </tr></thead>
            <tbody>{priorities.map((m) => (
              <tr key={m} className="border-b border-line last:border-0">
                <th scope="row" className="py-2 pr-1 font-medium">{MUSCLE_BY_ID[m].label}</th>
                <td className="text-right">{Math.round((sets[m] ?? 0) * 2) / 2}</td>
                <td className="text-right">{Math.round((planned[m] ?? 0) * 2) / 2}</td>
                <td className="text-right text-ink2">{volumeTarget(m, prefs).join('–')}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="mt-2 text-caption text-ink3">The week plan includes what you’ve logged and the workouts still on your schedule. The range is your weekly coaching target.</p>
          {place && priorities.map((m) => {
            const option = missingPriorityOption(m, place)
            if (!option) return null
            const kit = option.needs.map((group) => group.map(locationEquipmentLabel).join(' or ')).join(' and ')
            return <p key={m} className="mt-2 text-footnote text-ink2">{place.name} has no direct gym exercise for {MUSCLE_BY_ID[m].label.toLowerCase()} with its listed equipment. {option.exercise.name} uses {kit.toLowerCase()}.</p>
          })}
        </div>
      )}
      <details className="mt-2 rounded-card border border-line bg-surface px-4">
        <summary className="cursor-pointer py-3 text-footnote font-semibold">All muscle groups</summary>
        <p className="mt-1 text-caption text-ink3">
          These are estimated working sets. A secondary muscle gets half credit. Skill attempts below half their target
          stay in your practice log. Light skill sets that reach that mark get half credit. The ranges are weekly coaching targets.
        </p>
        <div className="my-3 space-y-4">
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
      </details>
    </section>
  )
}
