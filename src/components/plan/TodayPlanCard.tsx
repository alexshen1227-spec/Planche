import { useMemo, useState } from 'react'
import { FOCUS_LABEL, type GymFocus } from '../../lib/gym/builder'
import { planToday } from '../../lib/plan/planner'
import { useStore } from '../../lib/store'
import type { Joint, Muscle } from '../../data/gym/catalog'
import type { SkillId, WorkoutRequest } from '../../types'
import { Modal } from '../ui'
import { ActivitySheet } from './ActivitySheet'
import { PlanSettings } from './PlanSettings'
import { FitnessSetup } from './FitnessSetup'

export interface GymPreset {
  focus: GymFocus
  minutes: number
  avoidJoints: Joint[]
  volumeFactor: number
  musclesOff: Muscle[]
}

const SKILL_LABEL: Record<SkillId, string> = {
  planche: 'planche',
  frontlever: 'front lever',
  handstand: 'handstand',
  ninety: '90° hold',
  flag: 'flag',
}
const QUICK = [20, 30, 45, 60, 90]

/**
 * Today, planned as one: skill work first while fresh, then the gym, split by
 * the athlete's goals and steered by what is still tired — with the reasons.
 */
export function TodayPlanCard({
  startWorkout,
  onStartGym,
}: {
  startWorkout: (request: WorkoutRequest) => void
  onStartGym: (preset: GymPreset) => void
}) {
  const { state } = useStore()
  const [override, setOverride] = useState<number | undefined>(undefined)
  const [sheet, setSheet] = useState<'settings' | 'activity' | 'setup' | null>(null)
  const plan = useMemo(() => planToday(state, override !== undefined ? { minutes: override } : {}), [state, override])
  const skillNames = plan.skill?.skills.map((s) => SKILL_LABEL[s]) ?? []

  return (
    <section className="mb-5 rounded-3xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[17px] font-semibold">{plan.rest ? 'Today: rest' : `Today: ${plan.minutes} minutes`}</h2>
        <button onClick={() => setSheet('settings')} className="min-h-10 px-1 text-[13px] font-medium text-accent-text">
          Goals and schedule
        </button>
      </div>
      {!state.gym?.prefs ? (
        <button
          onClick={() => setSheet('setup')}
          className="mt-3 flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl bg-accent-soft px-4 text-left"
        >
          <span>
            <span className="block text-[15px] font-semibold text-ink">Set up Fitness Lab</span>
            <span className="block text-[12px] text-ink2">Goals, places, schedule, muscles, age — about two minutes. Until then the plan uses balanced defaults.</span>
          </span>
          <span className="text-[13px] font-semibold text-accent-text">Start</span>
        </button>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Minutes you have today">
        <span className="text-[12px] text-ink3">I have</span>
        {QUICK.map((m) => (
          <button
            key={m}
            aria-pressed={override === m}
            onClick={() => setOverride(override === m ? undefined : m)}
            className={`min-h-10 rounded-full border px-3 text-[13px] font-medium ${override === m ? 'border-transparent bg-accent text-on-accent' : 'border-line text-ink2'}`}
          >
            {m} min
          </button>
        ))}
      </div>

      {!plan.rest ? (
        <ol className="mt-4 space-y-2">
          {plan.skill ? (
            <li className="flex items-center gap-3 rounded-2xl bg-raised p-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent-text">1</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">Skills · {plan.skill.minutes} min</span>
                <span className="block truncate text-[12px] text-ink3">{skillNames.join(', ')} — first, while you are fresh</span>
              </span>
              <button
                onClick={() => startWorkout({ source: 'auto', minutes: plan.skill!.minutes, skills: plan.skill!.skills })}
                className="min-h-11 rounded-xl bg-accent px-4 text-[14px] font-semibold text-on-accent active:scale-[0.97]"
              >
                Start
              </button>
            </li>
          ) : null}
          {plan.gym ? (
            <li className="flex items-center gap-3 rounded-2xl bg-raised p-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent-text">
                {plan.skill ? 2 : 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">
                  Gym · {FOCUS_LABEL[plan.gym.focus]} · {plan.gym.minutes} min
                </span>
                <span className="block truncate text-[12px] text-ink3">
                  {plan.gym.deload ? 'A lighter week' : plan.gym.volumeFactor < 1 ? 'Kept light today' : 'Built from your place’s equipment'}
                </span>
              </span>
              <button
                onClick={() =>
                  onStartGym({
                    focus: plan.gym!.focus,
                    minutes: plan.gym!.minutes,
                    avoidJoints: plan.gym!.avoidJoints,
                    volumeFactor: plan.gym!.volumeFactor,
                    musclesOff: plan.gym!.musclesOff,
                  })
                }
                className={`min-h-11 rounded-xl px-4 text-[14px] font-semibold active:scale-[0.97] ${plan.skill ? 'border border-line' : 'bg-accent text-on-accent'}`}
              >
                Start
              </button>
            </li>
          ) : null}
        </ol>
      ) : null}

      {plan.reasons.length ? (
        <ul className="mt-3 space-y-1.5">
          {plan.reasons.map((r) => (
            <li key={r} className="flex gap-2 text-[13px] leading-snug text-ink2">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink3" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <button onClick={() => setSheet('activity')} className="mt-3 min-h-11 w-full rounded-xl border border-dashed border-line-strong text-[13px] font-medium text-ink2">
        Log a sport or activity
      </button>

      <Modal open={sheet === 'settings'} onClose={() => setSheet(null)} label="Goals and schedule" wide>
        {sheet === 'settings' ? (
          state.gym ? (
            <PlanSettings onDone={() => setSheet(null)} />
          ) : (
            <p className="text-[14px] text-ink2">Set up your places on the Gym side first — goals and schedule are saved with them.</p>
          )
        ) : null}
      </Modal>
      <Modal open={sheet === 'setup'} onClose={() => setSheet(null)} label="Set up Fitness Lab" wide>
        {sheet === 'setup' ? <FitnessSetup onDone={() => setSheet(null)} /> : null}
      </Modal>
      <Modal open={sheet === 'activity'} onClose={() => setSheet(null)} label="Log a sport or activity">
        {sheet === 'activity' ? (
          state.gym ? (
            <ActivitySheet onDone={() => setSheet(null)} />
          ) : (
            <p className="text-[14px] text-ink2">Set up your places on the Gym side first — activities are saved with them.</p>
          )
        ) : null}
      </Modal>
    </section>
  )
}
