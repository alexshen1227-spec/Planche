import { useMemo, useRef, useState } from 'react'
import { FOCUS_LABEL, type GymFocus } from '../../lib/gym/builder'
import { AFTER_OPENER_WARM_UP_MIN, planWeekAhead, skillRequest, type ReadinessLevel } from '../../lib/plan/planner'
import { openerLine } from '../../lib/plan/screens'
import { usePlanClock } from '../../lib/plan/usePlanClock'
import { rememberNextBlock } from '../../lib/plan/nextBlock'
import { useTodayChoice } from '../../lib/plan/todayChoice'
import { useStore } from '../../lib/store'
import { useToday } from '../../lib/useToday'
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
  /** Warm-up minutes for the lifts: short straight after a skill opener (`AFTER_OPENER_WARM_UP_MIN`), the usual otherwise. */
  warmUpMin?: number
}

const SKILL_LABEL: Record<SkillId, string> = {
  planche: 'planche',
  frontlever: 'front lever',
  handstand: 'handstand',
  ninety: '90° hold',
  flag: 'flag',
}
const QUICK = [20, 30, 45, 60, 90]
const READINESS_LABEL: Record<ReadinessLevel, string> = { light: 'Light day', normal: 'Normal day', push: 'Push day' }
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

/**
 * Today, as one recommended session: calisthenics, or the gym — opening with a
 * skill on a push or pull day when it fits — chosen by the coach from the
 * athlete's goals and week, with the reasons, and the other kind one tap away.
 */
export function TodayPlanCard({
  startWorkout,
  onStartGym,
  onSwitch,
}: {
  startWorkout: (request: WorkoutRequest) => void
  onStartGym: (preset: GymPreset) => void
  /** Told when the athlete picks the other kind for today; the card re-plans today as that kind itself. */
  onSwitch?: (kind: 'calisthenics' | 'gym') => void
}) {
  const { state } = useStore()
  // "I have X minutes" and "Rather do … today?" are today's choice on every
  // screen (Home, Train, the Gym tab), for the calendar day it was made on.
  const todayKey = useToday()
  const clock = usePlanClock()
  const [choice, setChoice] = useTodayChoice(todayKey)
  const override = choice.minutes
  const todayKind = choice.kind
  const [sheet, setSheet] = useState<'settings' | 'activity' | 'setup' | null>(null)
  // Today is one slot of the week plan; "I have X minutes" and a picked kind re-plan the rest of the week around it.
  const week = useMemo(
    () => planWeekAhead(state, Date.now(), { ...(override !== undefined ? { todayMinutes: override } : {}), ...(todayKind ? { todayKind } : {}) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, override, todayKind, todayKey, clock],
  )
  const plan = week.days[0].plan
  const lastSheet = useRef(sheet)
  if (sheet) lastSheet.current = sheet
  const shown = sheet ?? lastSheet.current
  // Today's parts tick off as they are done, and the next one takes the button.
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const skillDone = state.sessions.some((s) => s.startedAt >= todayStart.getTime())
  const gymDone = (state.gym?.sessions ?? []).some((s) => s.startedAt >= todayStart.getTime())
  const allDone = plan.kind === 'calisthenics' ? skillDone : plan.kind === 'gym' ? gymDone : false
  const opener = plan.kind === 'gym' && plan.skill?.opener ? plan.skill : undefined
  const preset: GymPreset | null = plan.gym
    ? { focus: plan.gym.focus, minutes: plan.gym.minutes, avoidJoints: plan.gym.avoidJoints, volumeFactor: plan.gym.volumeFactor, musclesOff: plan.gym.musclesOff }
    : null
  const session =
    plan.kind === 'calisthenics' && plan.skill
      ? { title: `Calisthenics · ${plan.skill.minutes} min`, line: cap(plan.skill.skills.map((s) => SKILL_LABEL[s]).join(', ')) }
      : plan.kind === 'gym' && plan.gym
        ? { title: `Gym · ${FOCUS_LABEL[plan.gym.focus]} · ${(opener?.minutes ?? 0) + plan.gym.minutes} min`, line: '' }
        : null
  const liftsLine = plan.gym
    ? plan.gym.deload
      ? 'A lighter week'
      : plan.gym.volumeFactor < 1
        ? 'Kept light today'
        : plan.gym.volumeFactor > 1
          ? 'One more set on each lift today'
          : 'Built from your place’s equipment'
    : ''
  const start = () => {
    if (plan.kind === 'calisthenics' && plan.skill) {
      rememberNextBlock(null)
      startWorkout({ source: 'auto', minutes: plan.skill.minutes, skills: plan.skill.skills })
    } else if (plan.kind === 'gym' && preset) {
      if (opener && !skillDone && !gymDone) {
        // The lifts follow on their own once the opener is saved.
        rememberNextBlock<GymPreset>({ ...preset, warmUpMin: AFTER_OPENER_WARM_UP_MIN })
        // The place's kit goes with it: a lever with no bar at home trains on the gym's.
        startWorkout(skillRequest(opener))
      } else onStartGym(preset)
    }
  }
  const startLabel = allDone ? 'Again' : opener && skillDone ? 'Start the lifts' : 'Start'
  const switchTo = plan.alternative && !skillDone && !gymDone ? plan.alternative : undefined
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
          <ToggleChip key={m} active={override === m} onClick={() => setChoice({ ...choice, minutes: override === m ? undefined : m })}>
            {m} min
          </ToggleChip>
        ))}
      </div>

      {plan.readiness && !plan.rest ? (
        <p className="mt-3 flex items-start gap-2 text-footnote leading-snug text-ink2">
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-caption font-semibold ${
              plan.readiness.level === 'light' ? 'bg-raised text-ink2' : plan.readiness.level === 'push' ? 'bg-accent-soft text-accent-text' : 'border border-line text-ink3'
            }`}
          >
            {READINESS_LABEL[plan.readiness.level]}
          </span>
          <span>{plan.readiness.reason}</span>
        </p>
      ) : null}

      {session && !plan.rest ? (
        <section className="mt-4 rounded-inner bg-raised p-4" aria-label="Today’s session">
          <div className="flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold">{session.title}</span>
              {session.line ? <span className="block text-caption text-ink3">{session.line}</span> : null}
            </span>
            {allDone ? marker(true, 1) : null}
          </div>
          {plan.kind === 'gym' && plan.gym ? (
            <ol className="mt-3 space-y-2">
              {opener ? (
                <li className="flex items-center gap-3">
                  {marker(skillDone, 1)}
                  <span className="min-w-0 flex-1">
                    <span className="block text-footnote font-semibold">{openerLine(opener)}</span>
                    <span className="block text-caption text-ink3">First, while you are fresh — logged with your skills</span>
                  </span>
                </li>
              ) : null}
              <li className="flex items-center gap-3">
                {marker(gymDone, opener ? 2 : 1)}
                <span className="min-w-0 flex-1">
                  <span className="block text-footnote font-semibold">
                    {opener ? 'Then the lifts' : 'The lifts'} · {plan.gym.minutes} min
                  </span>
                  <span className="block text-caption text-ink3">{liftsLine}</span>
                </span>
              </li>
            </ol>
          ) : null}
          <Button full className="mt-3" variant={allDone ? 'secondary' : 'primary'} onClick={start}>
            {startLabel}
          </Button>
        </section>
      ) : null}
      {switchTo ? (
        <button
          onClick={() => {
            setChoice({ ...choice, kind: switchTo })
            onSwitch?.(switchTo)
          }}
          className="mt-1 min-h-11 px-1 text-footnote font-medium text-accent-text"
        >
          {switchTo === 'gym' ? 'Rather do the gym today?' : 'Rather do calisthenics today?'}
        </button>
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

      {/* The coach's week folds away: today comes first on Train. */}
      {state.gym?.prefs ? (
        <details className="group mt-4 rounded-inner border border-line">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-footnote font-semibold text-ink2">
            The week ahead
            <Icon name="chevronR" size={14} className="transition group-open:rotate-90" />
          </summary>
          <div className="px-3 pb-3">
            <WeekPreview week={week} hideTitle />
          </div>
        </details>
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
