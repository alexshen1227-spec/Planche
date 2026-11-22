import { useMemo, useRef, useState } from 'react'
import { FOCUS_LABEL, type GymFocus } from '../../lib/gym/builder'
import { planToday } from '../../lib/plan/planner'
import { useStore } from '../../lib/store'
import type { Joint, Muscle } from '../../data/gym/catalog'
import type { SkillId, WorkoutRequest } from '../../types'
import { Button, Card, Sheet, ToggleChip } from '../ds'
import { Icon } from '../Icon'
import { ActivitySheet } from './ActivitySheet'
import { PlanSettings } from './PlanSettings'
import { FitnessSetup } from './FitnessSetup'
import { WeekPreview } from './WeekPreview'

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
  const lastSheet = useRef(sheet)
  if (sheet) lastSheet.current = sheet
  const shown = sheet ?? lastSheet.current
  const skillNames = plan.skill?.skills.map((s) => SKILL_LABEL[s]) ?? []
  // Today's blocks tick off as they are done, and the next one takes the lead.
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const skillDone = state.sessions.some((s) => s.startedAt >= todayStart.getTime())
  const gymDone = (state.gym?.sessions ?? []).some((s) => s.startedAt >= todayStart.getTime())
  const allDone = (!plan.skill || skillDone) && (!plan.gym || gymDone) && (skillDone || gymDone)
  const marker = (done: boolean, n: number) => (
    <span
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-footnote font-semibold ${done ? 'bg-ok text-white' : 'bg-accent-soft text-accent-text'}`}
      aria-label={done ? 'Done' : `Step ${n}`}
    >
      {done ? <Icon name="check" size={16} /> : n}
    </span>
  )

  return (
    <Card className="mb-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-title3 font-semibold">
          {allDone ? 'Today: done' : plan.rest ? 'Today: rest' : `Today: ${plan.minutes} minutes`}
        </h2>
        <button onClick={() => setSheet('settings')} className="min-h-11 px-1 text-footnote font-medium text-accent-text">
          Goals and schedule
        </button>
      </div>
      {!state.gym?.prefs ? (
        <button
          onClick={() => setSheet('setup')}
          className="ds-press mt-3 flex min-h-14 w-full items-center justify-between gap-3 rounded-inner bg-accent-soft p-4 text-left"
        >
          <span>
            <span className="block text-body font-semibold text-ink">Set up Fitness Lab</span>
            <span className="block text-caption text-ink2">Goals, places, schedule, muscles, age — about two minutes. Until then the plan uses balanced defaults.</span>
          </span>
          <span className="text-footnote font-semibold text-accent-text">Start</span>
        </button>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Minutes you have today">
        <span className="text-caption text-ink3">I have</span>
        {QUICK.map((m) => (
          <ToggleChip key={m} active={override === m} onClick={() => setOverride(override === m ? undefined : m)}>
            {m} min
          </ToggleChip>
        ))}
      </div>

      {!plan.rest ? (
        <ol className="mt-4 space-y-2">
          {plan.skill ? (
            <li className="flex items-center gap-3 rounded-inner bg-raised p-3">
              {marker(skillDone, 1)}
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold">Skills · {plan.skill.minutes} min</span>
                <span className="block truncate text-caption text-ink3">{skillNames.join(', ')} — first, while you are fresh</span>
              </span>
              <Button
                variant={skillDone ? 'secondary' : 'primary'}
                onClick={() => startWorkout({ source: 'auto', minutes: plan.skill!.minutes, skills: plan.skill!.skills })}
              >
                {skillDone ? 'Again' : 'Start'}
              </Button>
            </li>
          ) : null}
          {plan.gym ? (
            <li className="flex items-center gap-3 rounded-inner bg-raised p-3">
              {marker(gymDone, plan.skill ? 2 : 1)}
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold">
                  Gym · {FOCUS_LABEL[plan.gym.focus]} · {plan.gym.minutes} min
                </span>
                <span className="block truncate text-caption text-ink3">
                  {plan.gym.deload ? 'A lighter week' : plan.gym.volumeFactor < 1 ? 'Kept light today' : 'Built from your place’s equipment'}
                </span>
              </span>
              <Button
                variant={(!plan.skill || skillDone) && !gymDone ? 'primary' : 'secondary'}
                onClick={() =>
                  onStartGym({
                    focus: plan.gym!.focus,
                    minutes: plan.gym!.minutes,
                    avoidJoints: plan.gym!.avoidJoints,
                    volumeFactor: plan.gym!.volumeFactor,
                    musclesOff: plan.gym!.musclesOff,
                  })
                }
              >
                {gymDone ? 'Again' : skillDone ? 'Next' : 'Start'}
              </Button>
            </li>
          ) : null}
        </ol>
      ) : null}

      {plan.reasons.length ? (
        <ul className="mt-3 space-y-1.5">
          {plan.reasons.map((r) => (
            <li key={r} className="flex gap-2 text-footnote leading-snug text-ink2">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink3" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {state.gym?.prefs ? (
        <div className="mt-4">
          <WeekPreview />
        </div>
      ) : null}

      <Button variant="secondary" full className="mt-3" onClick={() => setSheet('activity')}>
        Log a sport or activity
      </Button>

      <Sheet open={sheet === 'settings'} onClose={() => setSheet(null)} label="Goals and schedule">
        {shown === 'settings' ? (
          state.gym ? (
            <PlanSettings onDone={() => setSheet(null)} />
          ) : (
            <p className="text-body text-ink2">Set up your places on the Gym side first — goals and schedule are saved with them.</p>
          )
        ) : null}
      </Sheet>
      <Sheet open={sheet === 'setup'} onClose={() => setSheet(null)} label="Set up Fitness Lab">
        {shown === 'setup' ? <FitnessSetup onDone={() => setSheet(null)} /> : null}
      </Sheet>
      <Sheet open={sheet === 'activity'} onClose={() => setSheet(null)} label="Log a sport or activity">
        {shown === 'activity' ? (
          state.gym ? (
            <ActivitySheet onDone={() => setSheet(null)} />
          ) : (
            <p className="text-body text-ink2">Set up your places on the Gym side first — activities are saved with them.</p>
          )
        ) : null}
      </Sheet>
    </Card>
  )
}
