import { useState } from 'react'
import { MUSCLE_GROUPS, MUSCLES, type Muscle } from '../../data/gym/catalog'
import { ALL_STEPS } from '../../data/progressions'
import { defaultPrefs } from '../../lib/gym/state'
import type { GoalWeights, SkillGoal, TrainingPrefs } from '../../lib/gym/types'
import { skillGoalPace } from '../../lib/plan/planner'
import { useStore } from '../../lib/store'
import { pushToast } from '../../lib/toast'
import type { SkillId } from '../../types'

const GOALS: { id: keyof GoalWeights; label: string; hint: string }[] = [
  { id: 'skills', label: 'Calisthenics skills', hint: 'Planche, front lever and the rest' },
  { id: 'strength', label: 'Strength', hint: 'Heavier lifts, lower reps' },
  { id: 'physique', label: 'Physique and muscle', hint: 'More weekly sets per muscle' },
  { id: 'power', label: 'Explosiveness', hint: 'Jumps and throws first, fresh' },
  { id: 'endurance', label: 'Endurance', hint: 'Higher reps, shorter rests' },
]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SKILL_LABEL: Record<SkillId, string> = {
  planche: 'Planche',
  frontlever: 'Front lever',
  handstand: 'Handstand',
  ninety: '90° hold',
  flag: 'Human flag',
}

/** Goals, dated skill goals, muscles and the weekly schedule the planner reads. */
export function PlanSettings({ onDone }: { onDone: () => void }) {
  const { state, dispatch } = useStore()
  const [prefs, setPrefs] = useState<TrainingPrefs>(() => state.gym?.prefs ?? defaultPrefs())
  const skills = (state.profile.skills?.length ? state.profile.skills : ['planche']) as SkillId[]
  const [goalSkill, setGoalSkill] = useState<SkillId>(skills[0])
  const [goalStep, setGoalStep] = useState<string>('')
  const [goalBy, setGoalBy] = useState('')

  const muscleState = (m: Muscle): 'off' | 'normal' | 'priority' =>
    prefs.musclesOff.includes(m) ? 'off' : prefs.musclesPriority.includes(m) ? 'priority' : 'normal'
  const cycleMuscle = (m: Muscle) => {
    const next = { normal: 'priority', priority: 'off', off: 'normal' } as const
    const to = next[muscleState(m)]
    setPrefs((p) => ({
      ...p,
      musclesOff: to === 'off' ? [...p.musclesOff, m] : p.musclesOff.filter((x) => x !== m),
      musclesPriority: to === 'priority' ? [...p.musclesPriority, m] : p.musclesPriority.filter((x) => x !== m),
    }))
  }
  const save = () => {
    if (!state.gym) return
    const { updatedAt: _ignored, ...rest } = prefs
    void _ignored
    dispatch({ type: 'GYM', op: { op: 'setPrefs', prefs: rest } })
    pushToast('Plan settings saved.', 'success')
    onDone()
  }
  const seg = (active: boolean) =>
    `min-h-10 flex-1 rounded-lg text-[13px] font-semibold transition ${active ? 'bg-accent text-on-accent' : 'text-ink3'}`

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-[15px] font-semibold">What matters to you</h3>
        <p className="mt-1 text-[12px] text-ink3">These decide how a day splits between skills and the gym, the rep ranges, and how many sets each muscle gets.</p>
        <ul className="mt-3 space-y-3">
          {GOALS.map((g) => (
            <li key={g.id}>
              <div className="flex items-baseline justify-between">
                <span className="text-[14px] font-medium">{g.label}</span>
                <span className="text-[12px] text-ink3">{g.hint}</span>
              </div>
              <div className="mt-1 flex gap-1 rounded-xl border border-line bg-raised p-1" role="radiogroup" aria-label={g.label}>
                {[0, 1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={prefs.goals[g.id] === v}
                    onClick={() => setPrefs((p) => ({ ...p, goals: { ...p.goals, [g.id]: v } }))}
                    className={seg(prefs.goals[g.id] === v)}
                  >
                    {v === 0 ? 'Off' : v}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-[15px] font-semibold">Skill goals with a date</h3>
        <ul className="mt-2 space-y-2">
          {prefs.skillGoals.map((goal) => {
            const pace = skillGoalPace(state, goal)
            const step = ALL_STEPS.find((s) => s.id === goal.stepId)
            return (
              <li key={goal.id} className="rounded-xl border border-line p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[14px] font-semibold">
                    {step?.name} by {new Date(`${goal.by}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                  <button
                    onClick={() => setPrefs((p) => ({ ...p, skillGoals: p.skillGoals.filter((x) => x.id !== goal.id) }))}
                    className="min-h-10 px-2 text-[13px] text-danger-text"
                  >
                    Remove
                  </button>
                </div>
                <p
                  className={`mt-1 text-[13px] ${
                    pace.status === 'on-pace' || pace.status === 'reached' ? 'text-ok-text' : pace.status === 'behind' ? 'text-danger-text' : 'text-ink2'
                  }`}
                >
                  {pace.text}
                </p>
              </li>
            )
          })}
        </ul>
        <div className="mt-2 grid gap-2 rounded-xl border border-dashed border-line-strong p-3">
          <div className="flex flex-wrap gap-2">
            {skills.map((s) => (
              <button
                key={s}
                aria-pressed={goalSkill === s}
                onClick={() => {
                  setGoalSkill(s)
                  setGoalStep('')
                }}
                className={`min-h-10 rounded-full border px-3 text-[13px] font-medium ${goalSkill === s ? 'border-transparent bg-accent text-on-accent' : 'border-line text-ink2'}`}
              >
                {SKILL_LABEL[s]}
              </button>
            ))}
          </div>
          <select
            value={goalStep}
            onChange={(e) => setGoalStep(e.target.value)}
            className="min-h-11 rounded-xl border border-line bg-raised px-3 text-[14px]"
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
            className="min-h-11 rounded-xl border border-line bg-raised px-3 text-[14px]"
            aria-label="Reach it by"
          />
          <button
            disabled={!goalStep || !goalBy}
            onClick={() => {
              const goal: SkillGoal = { id: `goal-${Date.now().toString(36)}`, skill: goalSkill, stepId: goalStep as SkillGoal['stepId'], by: goalBy }
              setPrefs((p) => ({ ...p, skillGoals: [...p.skillGoals, goal] }))
              setGoalStep('')
              setGoalBy('')
            }}
            className="min-h-11 rounded-xl border border-line text-[14px] font-medium disabled:opacity-40"
          >
            Add goal
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-[15px] font-semibold">Muscles</h3>
        <p className="mt-1 text-[12px] text-ink3">Tap to cycle: normal → priority (about a third more weekly sets) → off (the gym leaves it out, e.g. legs when you sprint).</p>
        <div className="mt-2 space-y-3">
          {MUSCLE_GROUPS.map((group) => (
            <div key={group.id}>
              <p className="text-[12px] font-semibold text-ink2">{group.label}</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {MUSCLES.filter((m) => m.group === group.id).map((m) => {
                  const st = muscleState(m.id)
                  return (
                    <button
                      key={m.id}
                      onClick={() => cycleMuscle(m.id)}
                      aria-label={`${m.label}: ${st}`}
                      className={`min-h-10 rounded-full border px-3 text-[13px] font-medium ${
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

      <section>
        <h3 className="text-[15px] font-semibold">When you can train</h3>
        <p className="mt-1 text-[12px] text-ink3">Minutes per day; 0 is a rest day. “I have X minutes” on the day still overrides it.</p>
        <ul className="mt-2 grid grid-cols-7 gap-1.5">
          {DAYS.map((d, i) => (
            <li key={d} className="flex flex-col items-center gap-1">
              <span className="text-[12px] font-medium text-ink3">{d}</span>
              <button
                onClick={() => setPrefs((p) => ({ ...p, minutesByDay: p.minutesByDay.map((m, j) => (j === i ? (m >= 120 ? 0 : m + 15) : m)) }))}
                className={`min-h-12 w-full rounded-xl border text-[14px] font-semibold tabular-nums ${prefs.minutesByDay[i] ? 'border-line bg-surface' : 'border-dashed border-line text-ink3'}`}
                aria-label={`${d}: ${prefs.minutesByDay[i] ? `${prefs.minutesByDay[i]} minutes` : 'rest'} — tap to change`}
              >
                {prefs.minutesByDay[i] || 'Rest'}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-[12px] text-ink3">Tap a day to add 15 minutes; past 120 it goes back to rest.</p>
      </section>

      <section>
        <h3 className="text-[15px] font-semibold">Rest between hard straight-arm sessions</h3>
        <div className="mt-2 flex gap-1 rounded-xl border border-line bg-raised p-1" role="radiogroup" aria-label="Hours between hard straight-arm sessions">
          {[24, 36, 48, 72].map((h) => (
            <button
              key={h}
              role="radio"
              aria-checked={prefs.straightArmRestHours === h}
              onClick={() => setPrefs((p) => ({ ...p, straightArmRestHours: h }))}
              className={seg(prefs.straightArmRestHours === h)}
            >
              {h}h
            </button>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-ink3">
          Hard planche-type work and hard front lever work each wait this long before the next hard session of the same
          kind. 48 hours is a common coaching default for connective tissue under straight-arm load — a convention, not a
          measured rule.
        </p>
      </section>

      <button onClick={save} className="min-h-12 w-full rounded-xl bg-accent text-[15px] font-semibold text-on-accent">
        Save
      </button>
    </div>
  )
}
