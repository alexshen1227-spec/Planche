import { useState, type KeyboardEvent } from 'react'
import { MUSCLE_GROUPS, MUSCLES, type Muscle } from '../../data/gym/catalog'
import { ALL_STEPS } from '../../data/progressions'
import { cycleMuscleState, defaultPrefs, setLiftingWeekday, setWeekdayFocus } from '../../lib/gym/state'
import type { GoalWeights, GymLocation, SkillGoal, SportSlot, TrainingPrefs } from '../../lib/gym/types'
import { SPORT_KINDS } from '../../lib/plan/sport'
import { FOCUS_LABEL, type GymFocus } from '../../lib/gym/focus'
import { SportAreas } from './SportAreas'
import { OPENER_MINUTES } from '../../lib/sessionRoom'
import { skillGoalPace } from '../../lib/plan/goalPace'
import { useStore } from '../../lib/store'
import { pushToast } from '../../lib/toast'
import type { SkillId } from '../../types'
import { Button, SegmentedControl, ToggleChip } from '../ds'

const GOALS: { id: keyof GoalWeights; label: string; hint: string }[] = [
  { id: 'skills', label: 'Calisthenics skills', hint: 'Planche, front lever and the rest' },
  { id: 'strength', label: 'Strength', hint: 'Heavier lifts, lower reps' },
  { id: 'physique', label: 'Physique and muscle', hint: 'More weekly sets per muscle' },
  { id: 'power', label: 'Explosiveness', hint: 'Jumps and throws first, fresh' },
  { id: 'endurance', label: 'Endurance', hint: 'Higher reps, shorter rests' },
]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** Easy / medium / hard, stored as the 1–10 effort a logged activity uses. */
const INTENSITY = [
  { value: '4', label: 'Easy' },
  { value: '6', label: 'Medium' },
  { value: '8', label: 'Hard' },
]
const SPORT_MINUTES = [30, 45, 60, 75, 90, 120, 150, 180]

/** The regular sport week, entered once: the planner reads each slot like a logged activity. */
export function SportWeekEditor({ prefs, setPrefs }: Edit) {
  const slots = prefs.sportSchedule ?? []
  const put = (weekday: number, slot: SportSlot | null) =>
    setPrefs((p) => {
      const rest = (p.sportSchedule ?? []).filter((x) => x.weekday !== weekday)
      const next = slot ? [...rest, slot].sort((a, b) => a.weekday - b.weekday) : rest
      const { sportSchedule: _old, ...others } = p
      void _old
      return next.length ? { ...others, sportSchedule: next } : others
    })
  // Each change merges into the slot as it is now, not as it was when this
  // screen last drew: two quick taps (kind, then effort) once lost the first.
  const patch = (weekday: number, fields: Partial<SportSlot> | ((cur: SportSlot) => Partial<SportSlot>)) =>
    setPrefs((p) => {
      const current = (p.sportSchedule ?? []).find((x) => x.weekday === weekday)
      if (!current) return p
      const next = [...(p.sportSchedule ?? []).filter((x) => x.weekday !== weekday), { ...current, ...(typeof fields === 'function' ? fields(current) : fields) }].sort((a, b) => a.weekday - b.weekday)
      return { ...p, sportSchedule: next }
    })
  const intensity = (rpe: number) => (rpe >= 7 ? '8' : rpe >= 5 ? '6' : '4')
  return (
    <section>
      <h3 className="font-display text-title3 font-semibold">Your sport week</h3>
      <p className="mt-1 text-caption text-ink3">
        Your regular sessions, entered once. Each one is counted as done (a log on the same day replaces it), legs stay
        out of the gym on the day of a hard one and the day after, and stay fresh the day before. Rules of thumb from
        coaching practice, not measured limits.
      </p>
      <ul className="mt-2 space-y-2">
        {FULL_DAYS.map((name, d) => {
          const slot = slots.find((x) => x.weekday === d)
          return (
            <li key={name} className="rounded-inner border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-body font-medium">
                  {name}
                  {slot ? <span className="text-caption font-normal text-ink3"> · {SPORT_KINDS.find((k) => k.id === slot.kind)?.label} {slot.minutes} min</span> : null}
                </span>
                {slot ? (
                  <button onClick={() => put(d, null)} className="min-h-11 px-2 text-footnote text-danger-text" aria-label={`Remove ${name}’s sport`}>
                    Remove
                  </button>
                ) : (
                  <button
                    onClick={() => put(d, { weekday: d, kind: 'practice', minutes: 90, rpe: 6, legs: true })}
                    className="min-h-11 px-2 text-footnote font-medium text-accent-text"
                    aria-label={`Add sport on ${name}`}
                  >
                    Add sport
                  </button>
                )}
              </div>
              {slot ? (
                <div className="mt-2 space-y-2">
                  <div className="flex flex-wrap gap-2" role="group" aria-label={`${name}: what`}>
                    {SPORT_KINDS.map((k) => (
                      <ToggleChip key={k.id} active={slot.kind === k.id} onClick={() => patch(d, { kind: k.id, legs: k.legs, upperPush: k.upperPush, upperPull: k.upperPull })}>
                        {k.label}
                      </ToggleChip>
                    ))}
                  </div>
                  <SegmentedControl
                    label={`${name}: how hard`}
                    value={intensity(slot.rpe)}
                    onChange={(v) => patch(d, { rpe: Number(v) })}
                    options={INTENSITY}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={slot.minutes}
                      onChange={(e) => patch(d, { minutes: Number(e.target.value) })}
                      className="min-h-11 rounded-control border border-line bg-raised px-3 text-body"
                      aria-label={`${name}: minutes`}
                    >
                      {[...new Set([...SPORT_MINUTES, slot.minutes])].sort((a, b) => a - b).map((m) => (
                        <option key={m} value={m}>
                          {m} min
                        </option>
                      ))}
                    </select>
                  </div>
                  <SportAreas areas={slot} onChange={(fields) => patch(d, fields)} />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
const SKILL_LABEL: Record<SkillId, string> = {
  planche: 'Planche',
  frontlever: 'Front lever',
  handstand: 'Handstand',
  ninety: '90° hold',
  flag: 'Human flag',
}

type Edit = { prefs: TrainingPrefs; setPrefs: (fn: (p: TrainingPrefs) => TrainingPrefs) => void }

/**
 * Off, 1 to 5 — a radio group like the design system's SegmentedControl, but
 * every option carries its own name ("Strength: 3 of 5"), which that control
 * cannot give a chip showing only a number. Arrow keys move the choice.
 */
function WeightScale({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const values = [0, 1, 2, 3, 4, 5]
  const move = (e: KeyboardEvent<HTMLButtonElement>, v: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const next = (v + dir + values.length) % values.length
    onChange(next)
    const group = e.currentTarget.parentElement
    window.setTimeout(() => group?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(), 0)
  }
  return (
    <div role="radiogroup" aria-label={`${label}: how much it matters`} className="mt-1 flex gap-1 rounded-inner bg-raised p-1">
      {values.map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          aria-label={v === 0 ? `${label}: off` : `${label}: ${v} of 5`}
          tabIndex={value === v ? 0 : -1}
          onClick={() => onChange(v)}
          onKeyDown={(e) => move(e, v)}
          className={`ds-press min-h-11 flex-1 rounded-control px-2 text-body font-semibold ${
            value === v ? 'bg-surface text-ink shadow-card' : 'text-ink2 hover:text-ink'
          }`}
        >
          {v === 0 ? 'Off' : v}
        </button>
      ))}
    </div>
  )
}

export function GoalsEditor({ prefs, setPrefs }: Edit) {
  return (
      <section>
        <h3 className="font-display text-title3 font-semibold">What matters to you</h3>
        <p className="mt-1 text-caption text-ink3">These decide how a day splits between skills and the gym, the rep ranges, and how many sets each muscle gets.</p>
        <ul className="mt-3 space-y-3">
          {GOALS.map((g) => (
            <li key={g.id}>
              <div className="flex items-baseline justify-between">
                <span className="text-body font-medium">{g.label}</span>
                <span className="text-caption text-ink3">{g.hint}</span>
              </div>
              <WeightScale
                label={g.label}
                value={prefs.goals[g.id]}
                onChange={(v) => setPrefs((p) => ({ ...p, goals: { ...p.goals, [g.id]: v } }))}
              />
            </li>
          ))}
        </ul>
      </section>
  )
}

export function SkillGoalsEditor({ prefs, setPrefs }: Edit) {
  const { state } = useStore()
  const skills = (state.profile.skills?.length ? state.profile.skills : ['planche']) as SkillId[]
  const [goalSkill, setGoalSkill] = useState<SkillId>(skills[0])
  const [goalStep, setGoalStep] = useState<string>('')
  const [goalBy, setGoalBy] = useState('')
  return (
      <section>
        <h3 className="font-display text-title3 font-semibold">Skill goals with a date</h3>
        <ul className="mt-2 space-y-2">
          {prefs.skillGoals.map((goal) => {
            const pace = skillGoalPace(state, goal)
            const step = ALL_STEPS.find((s) => s.id === goal.stepId)
            return (
              <li key={goal.id} className="rounded-inner border border-line p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-body font-semibold">
                    {step?.name} by {new Date(`${goal.by}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  <button
                    onClick={() => setPrefs((p) => ({ ...p, skillGoals: p.skillGoals.filter((x) => x.id !== goal.id) }))}
                    className="min-h-11 px-2 text-footnote text-danger-text"
                  >
                    Remove
                  </button>
                </div>
                <p
                  className={`mt-1 text-footnote ${
                    pace.status === 'on-pace' || pace.status === 'reached' ? 'text-ok-text' : pace.status === 'behind' ? 'text-danger-text' : 'text-ink2'
                  }`}
                >
                  {pace.text}
                </p>
              </li>
            )
          })}
        </ul>
        <div className="mt-2 grid gap-2 rounded-inner border border-dashed border-line-strong p-4">
          <div className="flex flex-wrap gap-2">
            {skills.map((s) => (
              <ToggleChip
                key={s}
                active={goalSkill === s}
                onClick={() => {
                  setGoalSkill(s)
                  setGoalStep('')
                }}
              >
                {SKILL_LABEL[s]}
              </ToggleChip>
            ))}
          </div>
          <select
            value={goalStep}
            onChange={(e) => setGoalStep(e.target.value)}
            className="min-h-11 rounded-control border border-line bg-raised px-3 text-body"
            aria-label="Step to reach"
          >
            <option value="">Pick a step…</option>
            {ALL_STEPS.filter((s) => s.skill === goalSkill).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={goalBy}
            onChange={(e) => setGoalBy(e.target.value)}
            className="min-h-11 rounded-control border border-line bg-raised px-3 text-body"
            aria-label="Reach it by"
          />
          <Button
            variant="secondary"
            disabled={!goalStep || !goalBy}
            onClick={() => {
              const goal: SkillGoal = { id: `goal-${Date.now().toString(36)}`, skill: goalSkill, stepId: goalStep as SkillGoal['stepId'], by: goalBy }
              setPrefs((p) => ({ ...p, skillGoals: [...p.skillGoals, goal] }))
              setGoalStep('')
              setGoalBy('')
            }}
          >
            Add goal
          </Button>
        </div>
      </section>
  )
}

export function MusclesEditor({ prefs, setPrefs }: Edit) {
  const muscleState = (m: Muscle): 'off' | 'normal' | 'priority' =>
    prefs.musclesOff.includes(m) ? 'off' : prefs.musclesPriority.includes(m) ? 'priority' : 'normal'
  const cycleMuscle = (m: Muscle) => setPrefs((p) => cycleMuscleState(p, m))
  return (
      <section>
        <h3 className="font-display text-title3 font-semibold">Muscles</h3>
        <p className="mt-1 text-caption text-ink3">Tap to cycle: normal → priority (about a third more weekly sets) → off (the gym leaves it out, e.g. legs when you sprint).</p>
        <div className="mt-2 space-y-3">
          {MUSCLE_GROUPS.map((group) => (
            <div key={group.id}>
              <p className="text-caption font-semibold text-ink2">{group.label}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {MUSCLES.filter((m) => m.group === group.id).map((m) => {
                  const st = muscleState(m.id)
                  return (
                    <button
                      key={m.id}
                      onClick={() => cycleMuscle(m.id)}
                      aria-label={`${m.label}: ${st}`}
                      className={`min-h-11 rounded-full border px-3 text-footnote font-medium ${
                        st === 'priority' ? 'border-transparent bg-accent text-on-accent' : st === 'off' ? 'border-line text-ink3 line-through' : 'border-line text-ink2'
                      }`}
                    >
                      {m.label}
                      {st === 'priority' ? ' · priority' : ''}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
  )
}

/** The minutes a day can take: rest, then 15-minute steps up to two hours. */
export const DAY_MINUTE_CHOICES = [0, 15, 30, 45, 60, 75, 90, 105, 120]

/** One step up or down the day's minutes, never past rest or two hours. Off-grid values snap onto the grid. */
export function stepDayMinutes(minutes: number, direction: 1 | -1): number {
  const next = direction === 1 ? Math.floor(minutes / 15) * 15 + 15 : Math.ceil(minutes / 15) * 15 - 15
  return Math.min(120, Math.max(0, next))
}

const stepBtn = 'ds-press flex min-h-11 min-w-11 items-center justify-center rounded-control border border-line bg-surface text-title3 font-semibold text-ink disabled:opacity-40'

export function ScheduleEditor({ prefs, setPrefs, locations = [] }: Edit & { locations?: GymLocation[] }) {
  const [picked, setPicked] = useState<number | null>(null)
  const setDay = (i: number, minutes: number) =>
    setPrefs((p) => ({ ...p, minutesByDay: p.minutesByDay.map((m, j) => (j === i ? minutes : m)) }))
  const pickedMinutes = picked === null ? 0 : (prefs.minutesByDay[picked] ?? 0)
  const placeName = (i: number) => locations.find((place) => place.id === prefs.placeByDay?.[i])?.name
  return (
    <>
      <section>
        <h3 className="font-display text-title3 font-semibold">When you can train</h3>
        <p className="mt-1 text-caption text-ink3">Choose a day to set your training time{locations.length > 1 ? ' and location' : ''}. You can change today’s plan at any time.</p>
        <ul className="mt-2 grid grid-cols-7 gap-1">
          {DAYS.map((d, i) => (
            <li key={d} className="flex flex-col items-center gap-1">
              <span className="text-caption font-medium text-ink3">{d}</span>
              <button
                onClick={() => setPicked(picked === i ? null : i)}
                aria-pressed={picked === i}
                className={`min-h-12 w-full rounded-control border text-body font-semibold tnum ${
                  picked === i ? 'border-accent bg-accent-soft' : prefs.minutesByDay[i] ? 'border-line bg-surface' : 'border-dashed border-line text-ink3'
                }`}
                aria-label={`${FULL_DAYS[i]}: ${prefs.minutesByDay[i] ? `${prefs.minutesByDay[i]} minutes${placeName(i) ? ` at ${placeName(i)}` : ''}` : 'rest'} — choose`}
              >
                {prefs.minutesByDay[i] || 'Rest'}
              </button>
            </li>
          ))}
        </ul>
        {picked === null ? (
          <p className="mt-1 text-caption text-ink3">Tap a day to set its minutes.</p>
        ) : (
          <div className="mt-3 rounded-inner border border-line bg-surface p-3" role="group" aria-label={`${FULL_DAYS[picked]} minutes`}>
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => setDay(picked, stepDayMinutes(pickedMinutes, -1))}
                disabled={pickedMinutes <= 0}
                aria-label={`${FULL_DAYS[picked]}: 15 minutes less`}
                className={stepBtn}
              >
                −
              </button>
              <div className="text-center text-body font-semibold text-ink tnum" aria-live="polite">
                {FULL_DAYS[picked]}: {pickedMinutes ? `${pickedMinutes} minutes` : 'rest'}
              </div>
              <button
                onClick={() => setDay(picked, stepDayMinutes(pickedMinutes, 1))}
                disabled={pickedMinutes >= 120}
                aria-label={`${FULL_DAYS[picked]}: 15 minutes more`}
                className={stepBtn}
              >
                +
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {DAY_MINUTE_CHOICES.map((m) => (
                <button
                  key={m}
                  onClick={() => setDay(picked, m)}
                  aria-pressed={pickedMinutes === m}
                  className={`min-h-11 min-w-11 rounded-full border px-3 text-footnote font-medium tnum ${
                    pickedMinutes === m ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2'
                  }`}
                >
                  {m === 0 ? 'Rest' : m}
                </button>
              ))}
            </div>
            {pickedMinutes > 0 && locations.length > 1 && <label className="mt-3 block text-footnote font-semibold">
              Training location on {FULL_DAYS[picked]}
              <select className="mt-1 block min-h-11 w-full rounded-control border border-line bg-surface px-3 text-body font-normal text-ink"
                value={placeName(picked) ? prefs.placeByDay?.[picked] ?? '' : ''}
                onChange={(e) => {
                  const id = e.currentTarget.value || null
                  setPrefs((p) => {
                    const places = Array.from({ length: 7 }, (_, i) => i === picked ? id : p.placeByDay?.[i] ?? null)
                    return { ...p, placeByDay: places.some(Boolean) ? places : undefined }
                  })
                }}>
                <option value="">Automatic</option>
                {locations.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}
              </select>
            </label>}
            {pickedMinutes > 0 && (prefs.gymWeekdays?.includes(picked) || (prefs.goals.skills > 0 && Math.max(prefs.goals.strength, prefs.goals.physique, prefs.goals.power, prefs.goals.endurance) > 0)) &&
              <label className="mt-2 flex min-h-11 items-center gap-2 text-footnote font-medium">
                <input type="checkbox" className="size-5 accent-accent" checked={prefs.gymWeekdays?.includes(picked) ?? false}
                  onChange={(e) => { const checked = e.currentTarget.checked; setPrefs((p) => setLiftingWeekday(p, picked, checked)) }} />
                Keep {FULL_DAYS[picked]}s for lifting
              </label>}
            {pickedMinutes > 0 && (prefs.gymWeekdays?.includes(picked) || (!prefs.goals.skills && Math.max(prefs.goals.physique, prefs.goals.strength, prefs.goals.power, prefs.goals.endurance) > 0)) && <label className="mt-2 block text-footnote font-medium">
              Preferred lifting focus on {FULL_DAYS[picked]}s
              <select className="mt-1 block min-h-11 w-full rounded-control border border-line bg-surface px-3 text-body text-ink"
                value={prefs.focusByDay?.[picked] ?? ''} onChange={(e) => {
                  const focus = e.currentTarget.value as GymFocus | ''
                  setPrefs((p) => setWeekdayFocus(p, picked, focus || null))
                }}>
                <option value="">Auto</option>
                {Object.entries(FOCUS_LABEL).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
              <span className="mt-1 block text-caption font-normal text-ink2">The coach uses this focus when equipment, recovery and your skill practice allow it.</span>
            </label>}
          </div>
        )}
      </section>

      {prefs.goals.skills > 0 && Math.max(prefs.goals.strength, prefs.goals.physique, prefs.goals.power, prefs.goals.endurance) > 0 && <section>
        <h3 className="font-display text-title3 font-semibold">Skill practice before lifting</h3>
        <label className="mt-1 flex min-h-11 items-center gap-2 text-footnote font-medium">
          <input type="checkbox" className="size-5 accent-accent" checked={Boolean(prefs.shortSkillOpeners)}
            onChange={(e) => { const short = e.currentTarget.checked; setPrefs((p) => ({ ...p, shortSkillOpeners: short || undefined })) }} />
          Use shorter skill openers
        </label>
        <p className="text-caption text-ink2">Aim for {OPENER_MINUTES} minutes of warm-up and skill before lifting. A scheduled skill session can keep a longer block.</p>
      </section>}
      {prefs.goals.skills > 0 && <section>
        <h3 className="font-display text-title3 font-semibold">Rest between hard straight-arm sessions</h3>
        <SegmentedControl
          className="mt-2"
          label="Hours between hard straight-arm sessions"
          value={String(prefs.straightArmRestHours)}
          onChange={(v) => setPrefs((p) => ({ ...p, straightArmRestHours: Number(v) }))}
          options={[24, 36, 48, 72].map((h) => ({ value: String(h), label: `${h}h` }))}
        />
        <p className="mt-1 text-caption text-ink3">
          Hard planche-type work and hard front lever work each wait this long before the next hard session of the same
          kind. 48 hours is a common coaching default for connective tissue under straight-arm load — a convention, not a
          measured rule.
        </p>
      </section>}

      <SportWeekEditor prefs={prefs} setPrefs={setPrefs} />

      <section>
        <h3 className="font-display text-title3 font-semibold">Your sport’s season</h3>
        <SegmentedControl
          className="mt-2"
          label="Season"
          value={prefs.season ?? 'off'}
          onChange={(v) => setPrefs((p) => ({ ...p, season: v === 'in' ? 'in' : undefined }))}
          options={[
            { value: 'off', label: 'Off-season' },
            { value: 'in', label: 'In season' },
          ]}
        />
        <p className="mt-1 text-caption text-ink3">
          In season the sport comes first: the gym keeps the weights but drops some sets, and legs stay fresh before hard
          sessions in your sport week or ones you log as upcoming.
        </p>
      </section>
    </>
  )
}

/** Goals, dated skill goals, muscles and the weekly schedule the planner reads. */
export function PlanSettings({ onDone }: { onDone: () => void }) {
  const { state, dispatch } = useStore()
  const [prefs, setPrefsState] = useState<TrainingPrefs>(() => state.gym?.prefs ?? defaultPrefs())
  const setPrefs = (fn: (p: TrainingPrefs) => TrainingPrefs) => setPrefsState(fn)
  const save = () => {
    if (!state.gym) return
    const { updatedAt: _ignored, ...rest } = prefs
    void _ignored
    dispatch({ type: 'GYM', op: { op: 'setPrefs', prefs: rest } })
    pushToast('Plan settings saved.', 'success')
    onDone()
  }
  return (
    <div className="space-y-6">
      <h2 className="font-display text-title2 font-semibold text-ink">Goals and schedule</h2>
      <GoalsEditor prefs={prefs} setPrefs={setPrefs} />
      {prefs.goals.skills > 0 && <SkillGoalsEditor prefs={prefs} setPrefs={setPrefs} />}
      <MusclesEditor prefs={prefs} setPrefs={setPrefs} />
      <ScheduleEditor prefs={prefs} setPrefs={setPrefs} locations={state.gym?.locations} />
      <Button size="lg" full onClick={save}>
        Save
      </Button>
    </div>
  )
}
