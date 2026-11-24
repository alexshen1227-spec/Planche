import { useMemo, useState } from 'react'
import { MUSCLE_BY_ID, MUSCLE_GROUPS, MUSCLES, locationEquipmentLabel, type Muscle } from '../../data/gym/catalog'
import { missingPriorityOption } from '../../lib/gym/availability'
import { gymPlaceOf } from '../../lib/plan/planner'
import { defaultPrefs } from '../../lib/gym/state'
import { emptySetSources, setsPerMuscle, volumeStatus, volumeTarget, type VolumeStatus } from '../../lib/plan/load'
import { useStore } from '../../lib/store'
import { weekStart } from '../../lib/time'
import { useToday } from '../../lib/useToday'
import { weekForChoice } from '../../lib/plan/currentWeek'
import { useTodayChoice } from '../../lib/plan/todayChoice'
import { usePlanClock } from '../../lib/plan/usePlanClock'
import { compareLiftingDays } from '../../lib/plan/weekComparison'
import { SKILLS } from '../../data/skills'
import { pushToast } from '../../lib/toast'
import { Sheet } from '../ds'
import { PlanSettings } from './PlanSettings'

const STATUS: Record<VolumeStatus, { label: string; tone: string }> = {
  off: { label: 'off', tone: 'text-ink3' },
  under: { label: 'below range', tone: 'text-ink2' },
  on: { label: 'on target', tone: 'text-ok-text' },
  over: { label: 'above range', tone: 'text-ink2' },
}

/** This week's sets per muscle — gym and skill work counted together — against the targets. */
export function WeekVolume() {
  const { state, dispatch, getState } = useStore()
  const [editing, setEditing] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [detail, setDetail] = useState<Muscle | null>(null)
  const today = useToday()
  usePlanClock()
  const [choice] = useTodayChoice(today)
  const now = Date.now()
  const prefs = state.gym?.prefs ?? defaultPrefs(now)
  const priorities = prefs.musclesPriority.filter((m) => !prefs.musclesOff.includes(m))
  const week = priorities.length || detail ? weekForChoice(state, choice, now) : undefined
  const planned = week?.weekTotal ?? {}
  const shortfalls = priorities.map((muscle) => ({
    muscle,
    gap: volumeTarget(muscle, prefs)[0] - (planned[muscle] ?? 0),
  })).filter(({ gap }) => gap > 0).sort((a, b) => b.gap - a.gap)
  const largest = shortfalls[0]
  const comparison = useMemo(() => comparing ? compareLiftingDays(state, choice, Date.now()) : undefined, [comparing, state, choice, today])
  const dateLabel = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
  const place = gymPlaceOf(state, now)
  const { sets, sources } = useMemo(
    () => {
      const sources = emptySetSources()
      return { sets: setsPerMuscle(state.sessions, state.gym?.sessions ?? [], weekStart(now), now + 1, sources), sources }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.sessions, state.gym?.sessions, today],
  )
  return (
    <section>
      <h2 className="text-footnote font-semibold uppercase tracking-wide text-ink3">This week, sets per muscle</h2>
      {priorities.length > 0 && (
        <div className="mt-3 rounded-card border border-line bg-surface p-4">
          <h3 className="text-body font-semibold">Your priority muscles</h3>
          <table aria-label="Priority muscles" className="mt-2 w-full text-left text-footnote tnum">
            <thead><tr className="text-caption text-ink3">
              <th scope="col" className="font-medium">Muscle</th>
              <th scope="col" className="text-right font-medium">Logged</th>
              <th scope="col" className="text-right font-medium">Week plan</th>
              <th scope="col" className="text-right font-medium">Range</th>
            </tr></thead>
            <tbody>{priorities.map((m) => (
              <tr key={m} className="border-b border-line last:border-0">
                <th scope="row" className="pr-1 font-medium"><button type="button" className="min-h-11 text-left text-accent-text underline decoration-accent/40 underline-offset-4"
                  aria-label={`See ${MUSCLE_BY_ID[m].label.toLowerCase()} set breakdown`} onClick={() => setDetail(m)}>{MUSCLE_BY_ID[m].label}</button></th>
                <td className="text-right">{sets[m] ?? 0}</td>
                <td className="text-right">{planned[m] ?? 0}</td>
                <td className="text-right text-ink2">{volumeTarget(m, prefs).join('–')}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="mt-2 text-caption text-ink3">The week plan includes your logged sets and the workouts still scheduled. Ranges are coaching estimates for a full week.</p>
          {prefs.extraGymDate && prefs.extraGymDate >= today && <div className="mt-2 text-footnote text-ink2">
            You chose {dateLabel(prefs.extraGymDate)} for lifting.
            <button type="button" className="ml-2 min-h-11 font-semibold text-accent-text" onClick={() => {
              const latest = getState().gym?.prefs
              if (latest) dispatch({ type: 'GYM', op: { op: 'setPrefs', prefs: { ...latest, extraGymDate: undefined } } })
            }}>Undo day change</button>
          </div>}
          {largest && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-footnote text-ink2">This plan leaves {MUSCLE_BY_ID[largest.muscle].label.toLowerCase()} {largest.gap} {largest.gap === 1 ? 'set' : 'sets'} below its range. More lifting time or fewer simultaneous priorities can change how much fits.</p>
              <div className="flex flex-wrap gap-x-4">
                {prefs.goals.skills > 0 && <button type="button" className="ds-press min-h-11 text-footnote font-semibold text-accent-text" onClick={() => setComparing(true)}>Compare plans in my available time</button>}
                <button type="button" className="ds-press min-h-11 text-footnote font-semibold text-accent-text" onClick={() => setEditing(true)}>Review goals and schedule</button>
              </div>
            </div>
          )}
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
          stay in your practice log. Light skill sets that reach that mark get half credit. Speed drills, jumps, throws and sprints
          count toward your athletic training and recovery. The ranges here cover resistance work.
        </p>
        <div className="my-3 space-y-4">
          {MUSCLE_GROUPS.map((group) => (
            <div key={group.id}>
              <p className="text-caption font-semibold text-ink2">{group.label}</p>
              <ul className="mt-1 space-y-1.5">
                {MUSCLES.filter((m) => m.group === group.id).map((m) => {
                  const target = volumeTarget(m.id, prefs)
                  const done = sets[m.id] ?? 0
                  const status = volumeStatus(done, target)
                  const width = target[1] > 0 ? Math.min(100, (done / target[1]) * 100) : 0
                  return (
                    <li key={m.id}><button type="button" onClick={() => setDetail(m.id)}
                      aria-label={`See ${m.label.toLowerCase()} set breakdown`}
                      className="grid min-h-11 w-full grid-cols-[minmax(5rem,7.5rem)_1fr_5.5rem] items-center gap-2 rounded-control text-left text-footnote hover:bg-raised">
                      <span>{m.label}</span>
                      <span className="relative h-2 overflow-hidden rounded-full bg-raised" aria-hidden>
                        {target[1] > 0 ? (
                          <span
                            className="absolute inset-y-0 rounded-full bg-ok-soft"
                            style={{ left: `${(target[0] / target[1]) * 100}%`, right: 0 }}
                          />
                        ) : null}
                        <span
                          className={`absolute inset-y-0 left-0 rounded-full ${status === 'on' ? 'bg-ok' : 'bg-accent'} transition-[width] duration-700 motion-reduce:transition-none`}
                          style={{ width: `${width}%` }}
                        />
                      </span>
                      <span className={`text-right tnum ${STATUS[status].tone}`}>
                        {status === 'off' ? 'off' : `${done}/${target[0]}–${target[1]}`}
                        {status !== 'off' ? <span className="block text-caption">{STATUS[status].label}</span> : null}
                      </span>
                    </button></li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </details>
      <Sheet open={detail !== null} onClose={() => setDetail(null)} title={detail ? `${MUSCLE_BY_ID[detail].label} set breakdown` : 'Set breakdown'}>
        {detail && week && <div>
          <table className="w-full text-left text-footnote tnum">
            <thead><tr className="border-b border-line text-ink2"><th scope="col" className="py-2">Source</th><th scope="col" className="text-right">Logged</th><th scope="col" className="text-right">Week plan</th></tr></thead>
            <tbody>{([['direct', 'Direct gym work'], ['assisting', 'Assisting gym work'], ['skill', 'Estimated skill work']] as const).map(([key, label]) =>
              <tr key={key} className="border-b border-line"><th scope="row" className="py-3 font-medium">{label}</th>
                <td className="text-right">{sources[key][detail] ?? 0}</td><td className="text-right">{week.weekSources[key][detail] ?? 0}</td></tr>)}</tbody>
            <tfoot><tr><th scope="row" className="py-3">Total</th><td className="text-right font-semibold">{sets[detail] ?? 0}</td><td className="text-right font-semibold">{planned[detail] ?? 0}</td></tr></tfoot>
          </table>
          <p className="mt-2 text-footnote text-ink2">A gym set counts once for a primary muscle and half for an assisting muscle. Skill work estimates this muscle’s contribution from the exercise, effort and completed holds or reps.</p>
          <p className="mt-2 text-footnote text-ink2">The week plan combines your log with scheduled work. {volumeTarget(detail, prefs)[1] > 0
            ? `Your full-week coaching range is ${volumeTarget(detail, prefs).join('–')} set equivalents.` : 'You have switched off the weekly target for this muscle.'}</p>
        </div>}
      </Sheet>
      <Sheet open={comparing} onClose={() => setComparing(false)} label="Compare weekly plans">
        {comparing && comparison && <div className="p-5">
          <h2 className="pr-9 font-display text-title2 font-semibold">Compare weekly plans</h2>
          {comparison.alternative ? <>
            <p className="mt-2 text-footnote text-ink2">Use {dateLabel(comparison.alternative.gymDate!)} for lifting within your available minutes. These estimates include the training you have logged this week.</p>
            <table className="mt-4 w-full text-left text-footnote tnum">
              <thead><tr className="border-b border-line"><th scope="col" className="py-2">Training</th><th scope="col" className="text-right">Current</th><th scope="col" className="text-right">Alternative</th></tr></thead>
              <tbody>{[
                ...comparison.muscles.map((m) => [MUSCLE_BY_ID[m].label + ' sets', comparison.current.muscleSets[m] ?? 0, comparison.alternative!.muscleSets[m] ?? 0] as const),
                ...comparison.skills.map((s) => [SKILLS[s].name + ' days', comparison.current.practiceDays[s] ?? 0, comparison.alternative!.practiceDays[s] ?? 0] as const),
                ['Lifting days', comparison.current.gymDays, comparison.alternative.gymDays] as const,
              ].map(([label, a, b]) => <tr key={label} className="border-b border-line"><th scope="row" className="py-2 pr-1 font-medium">{label}</th><td className="text-right">{Math.round(a * 2) / 2}</td><td className="text-right">{Math.round(b * 2) / 2}</td></tr>)}</tbody>
            </table>
            <button type="button" className="mt-4 min-h-11 rounded-control bg-accent px-4 font-semibold text-on-accent" onClick={() => {
              const latest = getState().gym?.prefs
              if (!latest || !comparison.alternative) return
              dispatch({ type: 'GYM', op: { op: 'setPrefs', prefs: { ...latest, extraGymDate: comparison.alternative.gymDate } } })
              setComparing(false)
              pushToast('Lifting day selected. Your week has been recalculated.', 'success')
            }}>Use this lifting day</button>
          </> : <p className="mt-3 text-footnote text-ink2">The remaining training days do not fit an extra lifting day that improves your priority sets and keeps your first skill in practice. You can review available time and muscle priorities in your schedule.</p>}
          <button type="button" className="mt-2 block min-h-11 text-footnote font-semibold text-accent-text" onClick={() => setComparing(false)}>Keep my current plan</button>
        </div>}
      </Sheet>
      <Sheet open={editing} onClose={() => setEditing(false)} label="Goals and schedule">
        {editing && <PlanSettings onDone={() => setEditing(false)} />}
      </Sheet>
    </section>
  )
}
