import { useMemo, useState } from 'react'
import { MUSCLE_BY_ID } from '../../data/gym/catalog'
import { SKILLS } from '../../data/skills'
import { setLiftingWeekday } from '../../lib/gym/state'
import { useTodayChoice } from '../../lib/plan/todayChoice'
import { usePlanClock } from '../../lib/plan/usePlanClock'
import { compareLiftingDays } from '../../lib/plan/weekComparison'
import { OPENER_MINUTES } from '../../lib/plan/planner'
import { useStore } from '../../lib/store'
import { pushToast } from '../../lib/toast'
import { useToday } from '../../lib/useToday'
import { Button, SegmentedControl, Sheet } from '../ds'

export function WeekPlanComparison() {
  const { state, getState, dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const [option, setOption] = useState<'day' | 'time'>('day')
  const today = useToday()
  const [choice] = useTodayChoice(today)
  const tick = usePlanClock()
  const comparison = useMemo(() => open ? compareLiftingDays(state, choice, Date.now()) : undefined, [open, state, choice, today, tick])
  const prefs = state.gym?.prefs
  if (!prefs?.goals.skills || !prefs.musclesPriority.some((m) => !prefs.musclesOff.includes(m))) return null
  const time = Boolean(comparison?.compact && (option === 'time' || !comparison.alternative))
  const alternative = time ? comparison?.compact : comparison?.alternative
  const day = !time && alternative?.gymDate ? new Date(alternative.gymDate + 'T12:00') : undefined
  const weekday = day?.toLocaleDateString(undefined, { weekday: 'long' })
  const to = alternative?.liftingVisits.find((visit) => visit.day === alternative.gymDate)
  const from = comparison?.current.liftingVisits.find((visit) => !alternative?.liftingVisits.some((next) => next.day === visit.day))
  const visitName = (visit: { day: string; place?: string }) => new Date(visit.day + 'T12:00').toLocaleDateString(undefined, { weekday: 'long' }) +
    (visit.place ? ` at ${visit.place}` : '')
  const rows: [string, number, number | undefined][] = []
  if (comparison) {
    const current = comparison.current
    for (const m of comparison.muscles) rows.push([`${MUSCLE_BY_ID[m].label} sets`, current.muscleSets[m] ?? 0, alternative?.muscleSets[m] ?? 0])
    for (const s of comparison.skills) {
      rows.push([`${SKILLS[s].name} practice days`, current.practiceDays[s] ?? 0, alternative?.practiceDays[s] ?? 0],
        [`${SKILLS[s].name} working sets left`, current.remainingSkillSets[s] ?? 0, alternative?.remainingSkillSets[s] ?? 0])
    }
    rows.push(['Lifting days', current.gymDays, alternative?.gymDays])
  }
  const save = (weekly: boolean) => {
    const latest = getState().gym?.prefs
    if (!latest) return
    if (time) {
      dispatch({ type: 'GYM', op: { op: 'setPrefs', prefs: { ...latest, shortSkillOpeners: true } } })
      setOpen(false)
      pushToast('Shorter skill openers saved. You can change them in your schedule.', 'success')
      return
    }
    if (!alternative?.gymDate || !day) return
    const chosen = weekly ? { ...setLiftingWeekday(latest, day.getDay(), true), extraGymDate: undefined } : { ...latest, extraGymDate: alternative.gymDate }
    dispatch({ type: 'GYM', op: { op: 'setPrefs', prefs: chosen } })
    setOpen(false)
    pushToast(weekly ? `${weekday} is now a regular lifting day.` : 'Lifting day selected. Your week has been recalculated.', 'success')
  }
  return <>
    <button type="button" className="ds-press min-h-11 text-left text-footnote font-semibold text-accent-text" onClick={() => { setOption('day'); setOpen(true) }}>Compare skill and lifting days</button>
    <Sheet open={open} onClose={() => setOpen(false)} title="Compare weekly plans">
      {comparison?.alternative && comparison.compact && <SegmentedControl className="mb-3" label="Weekly plan change" value={option} onChange={setOption}
        options={[{ value: 'day', label: 'Lifting day' }, { value: 'time', label: 'Shorter opener' }]} />}
      {time ? <p className="text-footnote text-ink2">Aim for {OPENER_MINUTES} minutes of warm-up and skill practice before lifting. This setting applies each week.</p>
        : alternative && day ? <>
        <p className="text-footnote text-ink2">{to && from && alternative.gymDays === comparison?.current.gymDays ?
          `Move lifting from ${visitName(from)} to ${visitName(to)}.` :
          `Use ${day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}${to?.place ? ' at ' + to.place : ''} for lifting within your available time.`} Logging a workout can change the estimates for the remaining days.</p>
        {prefs.extraGymDate && prefs.extraGymDate >= today && prefs.extraGymDate !== alternative.gymDate && <p className="mt-2 text-footnote text-ink2">This replaces the extra lifting date you chose earlier this week.</p>}
      </> : <p className="text-footnote text-ink2">This is the current forecast for your available days. The planner found no change that improves priority muscle work and keeps your first skill in practice.</p>}
        <table className="mt-3 w-full text-left text-footnote tnum">
          <thead><tr className="border-b border-line"><th scope="col" className="py-2">Training</th><th scope="col" className="text-right">Current</th>{alternative && <th scope="col" className="text-right">With change</th>}</tr></thead>
          <tbody>{rows.map(([label, a, b]) => <tr key={label} className="border-b border-line"><th scope="row" className="py-2 pr-2 font-medium">{label}</th>
            <td className="text-right">{a}</td>{alternative && <td className="text-right">{b}</td>}</tr>)}</tbody>
        </table>
        <p className="mt-2 text-caption text-ink2">Working sets left are the scheduled sets of each skill’s current progression exercise. Warm-ups and tests are excluded. Weekly muscle estimates and practice days include work already logged.</p>
        {time ? <Button className="mt-4" onClick={() => save(false)}>Use shorter skill openers</Button>
          : alternative && day && <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => save(false)}>Use this lifting day</Button>
          <Button variant="secondary" onClick={() => save(true)}>Keep {weekday}s for lifting</Button>
        </div>}
      <button type="button" className="mt-2 min-h-11 text-footnote font-semibold text-accent-text" onClick={() => setOpen(false)}>Keep my current plan</button>
    </Sheet>
  </>
}
