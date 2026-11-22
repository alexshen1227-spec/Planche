import { useEffect, useState } from 'react'
import { useStore } from '../../lib/store'
import { pushToast } from '../../lib/toast'
import { ageOf, activeLocation } from '../../lib/gym/draft'
import { defaultGym, defaultPrefs, newLocation } from '../../lib/gym/state'
import type { TrainingPrefs } from '../../lib/gym/types'
import { availableAt } from '../../lib/gym/availability'
import { LocationEditor } from '../gym/LocationEditor'
import { GoalsEditor, MusclesEditor, ScheduleEditor, SkillGoalsEditor } from './PlanSettings'

const STEPS = ['Goals', 'Places', 'Schedule', 'Muscles', 'Age and safety'] as const

/**
 * Fitness Lab's setup, in the order the goal asks for: goals → places and
 * equipment → schedule and time → muscles → age and safety. Opened from the
 * Today card for anyone who has not set a plan yet — new athletes after the
 * skill onboarding, and existing ones the first time they meet the gym side.
 */
export function FitnessSetup({ onDone }: { onDone: () => void }) {
  const { state, dispatch } = useStore()
  const [step, setStep] = useState(0)
  const [prefs, setPrefsState] = useState<TrainingPrefs>(() => state.gym?.prefs ?? defaultPrefs())
  const setPrefs = (fn: (p: TrainingPrefs) => TrainingPrefs) => setPrefsState(fn)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [birthYear, setBirthYear] = useState(state.profile.birthYear ? String(state.profile.birthYear) : '')
  const [bodyweight, setBodyweight] = useState(state.settings.trackBodyweight === true)

  // The places step needs somewhere to put them.
  useEffect(() => {
    if (!state.gym) dispatch({ type: 'GYM', op: { op: 'init', gym: defaultGym(state.profile.equipment) } })
  }, [state.gym, state.profile.equipment, dispatch])

  const gym = state.gym
  const year = Number(birthYear)
  const validYear = Number.isInteger(year) && year >= 1920 && year <= new Date().getFullYear() - 6
  const age = validYear ? new Date().getFullYear() - year : ageOf(state.profile)
  const finish = () => {
    const { updatedAt: _ignored, ...rest } = prefs
    void _ignored
    dispatch({ type: 'GYM', op: { op: 'setPrefs', prefs: rest } })
    if (validYear && year !== state.profile.birthYear) dispatch({ type: 'SET_PROFILE', patch: { birthYear: year } })
    dispatch({ type: 'SET_SETTINGS', patch: { trackBodyweight: bodyweight } })
    pushToast('Fitness Lab is set up — Today now plans skills and the gym together.', 'success')
    onDone()
  }

  if (editing && gym) {
    const loc = editing === 'new' ? newLocation('Gym', activeLocation(gym)?.unit ?? 'kg') : gym.locations.find((l) => l.id === editing)
    if (loc) {
      return (
        <LocationEditor
          location={loc}
          canDelete={editing !== 'new' && gym.locations.length > 1}
          onSave={(l) => {
            dispatch({ type: 'GYM', op: { op: 'saveLocation', location: l } })
            setEditing(null)
          }}
          onDelete={() => {
            dispatch({ type: 'GYM', op: { op: 'deleteLocation', id: loc.id } })
            setEditing(null)
          }}
        />
      )
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[12px] font-medium text-ink3">
          Step {step + 1} of {STEPS.length} · {STEPS[step]}
        </p>
        <div className="mt-2 grid grid-cols-5 gap-1" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className={`h-1 rounded-full ${i <= step ? 'bg-accent' : 'bg-raised'}`} />
          ))}
        </div>
      </div>

      {step === 0 ? (
        <>
          <GoalsEditor prefs={prefs} setPrefs={setPrefs} />
          <SkillGoalsEditor prefs={prefs} setPrefs={setPrefs} />
        </>
      ) : null}

      {step === 1 && gym ? (
        <section className="space-y-3">
          <h3 className="text-[15px] font-semibold">Where do you train?</h3>
          <p className="text-[13px] text-ink2">Each place keeps its own equipment and weights, so sessions only use what is there. Home already has your calisthenics kit.</p>
          <ul className="space-y-2">
            {gym.locations.map((l) => (
              <li key={l.id}>
                <button
                  onClick={() => setEditing(l.id)}
                  className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-line px-4 text-left"
                >
                  <span>
                    <span className="block text-[15px] font-semibold">{l.name}</span>
                    <span className="block text-[12px] text-ink3">
                      {l.equipment.length} pieces of kit · {availableAt(l).length} exercises · {l.unit}
                    </span>
                  </span>
                  <span className="text-[13px] font-medium text-accent-text">Edit</span>
                </button>
              </li>
            ))}
          </ul>
          <button onClick={() => setEditing('new')} className="min-h-12 w-full rounded-2xl border border-dashed border-line-strong text-[14px] font-medium text-ink2">
            Add a gym
          </button>
        </section>
      ) : null}

      {step === 2 ? <ScheduleEditor prefs={prefs} setPrefs={setPrefs} /> : null}
      {step === 3 ? <MusclesEditor prefs={prefs} setPrefs={setPrefs} /> : null}

      {step === 4 ? (
        <section className="space-y-4">
          <label className="block">
            <span className="text-[15px] font-semibold">Year you were born</span>
            <input
              inputMode="numeric"
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
              placeholder="e.g. 2010"
              className="mt-1 min-h-11 w-full rounded-xl border border-line bg-raised px-3 text-[15px]"
            />
            <span className="mt-1 block text-[12px] text-ink3">Stays on this phone. It only changes how careful the plan is.</span>
          </label>
          <div className="rounded-2xl bg-raised p-3 text-[13px] leading-relaxed text-ink2">
            {age === undefined || age < 18 ? (
              <p>
                <strong className="text-ink">Careful mode is on{age === undefined ? ' until you add your age' : ''}.</strong> Rep ranges stay at 6 or more
                with no max testing (maxes are estimated from your sets), loads go up one step at a time, lifts that need
                coaching are not picked unless you choose them, lighter weeks come sooner, and straight-arm skills always
                start with a full warm-up.
              </p>
            ) : (
              <p>
                <strong className="text-ink">Standard mode.</strong> Rep ranges and load steps follow your goals; maxes are
                still estimated from your sets rather than tested.
              </p>
            )}
            <p className="mt-2">
              Every session asks whether anything hurts. Pain keeps the area out of that day’s work — never train through it,
              and if it keeps coming back, tell a parent, coach or physio.
            </p>
          </div>
          <label className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-line px-4">
            <span>
              <span className="block text-[14px] font-medium">Bodyweight reminders</span>
              <span className="block text-[12px] text-ink3">Off by default{age !== undefined && age < 18 ? ' — and never under 18' : ''}. No weight-loss or calorie features, ever.</span>
            </span>
            <input type="checkbox" checked={bodyweight} onChange={(e) => setBodyweight(e.target.checked)} className="h-5 w-5 accent-[var(--t-accent)]" />
          </label>
        </section>
      ) : null}

      <div className="flex gap-2">
        {step > 0 ? (
          <button onClick={() => setStep(step - 1)} className="min-h-12 rounded-xl border border-line px-5 text-[15px] font-medium">
            Back
          </button>
        ) : null}
        {step < STEPS.length - 1 ? (
          <button onClick={() => setStep(step + 1)} className="min-h-12 flex-1 rounded-xl bg-accent text-[15px] font-semibold text-on-accent">
            Next
          </button>
        ) : (
          <button onClick={finish} className="min-h-12 flex-1 rounded-xl bg-accent text-[15px] font-semibold text-on-accent">
            Finish
          </button>
        )}
      </div>
    </div>
  )
}
