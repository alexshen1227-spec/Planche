import { useRef, useState } from 'react'
import { FOCUS_LABEL } from '../../lib/gym/builder'
import { AFTER_OPENER_WARM_UP_MIN, type ReadinessLevel } from '../../lib/plan/planner'
import { weekForChoice } from '../../lib/plan/currentWeek'
import {
  calisthenicsPlaceLine,
  calisthenicsRequest,
  calisthenicsTitle,
  dayStage,
  gymPlaceLine,
  gymPreset,
  openerLine,
  remainingLifts,
  resolveGymPlace,
  type GymEntry,
  type GymPreset,
} from '../../lib/plan/screens'
import { usePlanClock } from '../../lib/plan/usePlanClock'
import { endTheDay, useDayMarks, useNextBlock } from '../../lib/plan/nextBlock'
import { useTodayChoice } from '../../lib/plan/todayChoice'
import { useStore } from '../../lib/store'
import { useToday } from '../../lib/useToday'
import { latestPartialToday } from '../../lib/gym/draft'
import { PartialWorkout } from '../gym/PartialWorkout'
import { PartialSkillWorkout } from './PartialSkillWorkout'
import { countsSkillDay, latestSkillPartial } from '../../lib/skillSession'
import type { WorkoutRequest } from '../../types'
import { Button, Card, Sheet, ToggleChip } from '../ds'
import { Icon } from '../Icon'
import { ActivitySheet } from './ActivitySheet'
import { PlanSettings } from './PlanSettings'
import { FitnessSetup } from './FitnessSetup'
import { WeekPreview } from './WeekPreview'

export type { GymEntry, GymPreset }

const QUICK = [15, 20, 30, 45, 60, 90]
const READINESS_LABEL: Record<ReadinessLevel, string> = { light: 'Light day', normal: 'Normal day', push: 'Push day' }

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
  onStartGym: (preset: GymEntry) => void
  /** Told when the athlete picks the other kind for today; the card re-plans today as that kind itself. */
  onSwitch?: (kind: 'calisthenics' | 'gym') => void
}) {
  const { state } = useStore()
  // "I have X minutes" and "Rather do … today?" are today's choice on every
  // screen (Home, Train, the Gym tab), for the calendar day it was made on.
  const todayKey = useToday()
  usePlanClock()
  const [choice, setChoice] = useTodayChoice(todayKey)
  const override = choice.minutes
  const [sheet, setSheet] = useState<'settings' | 'activity' | 'setup' | null>(null)
  // Today is one slot of the week plan; "I have X minutes" and a picked kind re-plan the rest of the week around it.
  // Where the athlete said they are today, when that is not where the plan has the day: the plan is made there.
  const pickedId = choice.placeId
  const week = weekForChoice(state, choice)
  const plan = week.days[0].plan
  const lastSheet = useRef(sheet)
  if (sheet) lastSheet.current = sheet
  const shown = sheet ?? lastSheet.current
  // Today's parts tick off as they are done, and the next one takes the button.
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const skillDone = state.sessions.some((s) => s.startedAt >= todayStart.getTime() && s.startedAt <= Date.now() && countsSkillDay(s))
  const gymDone = (state.gym?.sessions ?? []).some((s) => s.startedAt >= todayStart.getTime() && s.startedAt <= Date.now())
  // Today's main session done: nothing more is recommended, only a quiet way to train again.
  const marks = useDayMarks(todayKey)
  const remembered = useNextBlock<GymPreset>(todayKey)
  const stage = dayStage(state, plan, Date.now(), marks)
  const allDone = stage === 'done'
  const skillPartial = stage === 'skill-partial' ? latestSkillPartial(state.sessions) : undefined
  const partial = allDone ? latestPartialToday(state.gym?.sessions) : undefined
  // A gym day whose opener is saved: the lifts are what is left, whatever the planner now calls the day.
  const liftsNext = stage === 'lifts-next'
  const opener = plan.kind === 'gym' && plan.skill?.opener ? plan.skill : undefined
  // A gym day is built where the plan has it (at the gym, even with Home set as the place now) unless the athlete
  // said they are somewhere else; the card says which.
  const where = plan.kind === 'gym' && plan.gym ? resolveGymPlace(state, Date.now(), { plannedId: pickedId ? undefined : plan.gym.placeId, pickedId }) : undefined
  const preset: GymPreset | null = plan.gym ? gymPreset(plan.gym, { placeId: where?.place.id ?? plan.gym.placeId }) : null
  const liftsPreset = remainingLifts(plan, remembered, where?.place.id)
  const session =
    plan.kind === 'calisthenics' && plan.skill
      ? { ...calisthenicsTitle(plan.skill), place: calisthenicsPlaceLine(state, plan.skill, pickedId) }
      : plan.kind === 'gym' && plan.gym
        ? { title: `Gym · ${FOCUS_LABEL[plan.gym.focus]} · ${(opener?.minutes ?? 0) + plan.gym.minutes} min`, line: '', place: gymPlaceLine(where) }
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
    if (liftsNext) {
      // The lifts, as the opener's day planned them; the pain check comes when this is tapped, never before.
      if (liftsPreset) onStartGym(liftsPreset)
      else onSwitch?.('gym')
    } else if (plan.kind === 'calisthenics' && plan.skill) {
      // Built where the plan has it (a lever day at the gym with the bar), or where the athlete said they are.
      startWorkout(calisthenicsRequest(state, plan.skill, pickedId))
    } else if (plan.kind === 'gym' && preset) {
      if (opener && !skillDone && !gymDone) {
        // The lifts follow on their own once the opener is saved.
        // The place's kit goes with it: a lever with no bar at home trains on the gym's.
        startWorkout({ ...calisthenicsRequest(state, opener, pickedId), gymAfter: { ...preset, warmUpMin: AFTER_OPENER_WARM_UP_MIN } })
      } else onStartGym(preset)
    }
  }
  const startLabel = allDone ? 'Again' : 'Start'
  const switchTo = plan.alternative && !skillDone && !gymDone && !liftsNext && (plan.alternative !== 'calisthenics' || state.gym?.prefs?.goals.skills !== 0) ? plan.alternative : undefined
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
          {partial || skillPartial ? 'Today’s saved workout' : allDone ? 'Today: done' : liftsNext ? 'Today: the lifts are next' : plan.rest ? 'Today: rest' : `Today: ${plan.minutes} minutes`}
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

      {skillPartial ? (
        <section className="mt-4 rounded-inner bg-raised p-4" aria-label="Today’s session">
          <PartialSkillWorkout session={skillPartial} startWorkout={startWorkout} />
        </section>
      ) : allDone ? (
        <section className="mt-4 rounded-inner bg-raised p-4" aria-label="Today’s session">
          {partial ? <PartialWorkout session={partial} onContinue={() => onStartGym({ resumeSessionId: partial.id })} /> : <div className="flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold">Today’s main session is done</span>
              <span className="block text-caption text-ink3">Nothing more is planned today. Rest is part of the plan.</span>
            </span>
            {marker(true, 1)}
          </div>}
          <button onClick={start} className="mt-2 min-h-11 px-1 text-footnote font-medium text-accent-text">
            Train again
          </button>
        </section>
      ) : liftsNext ? (
        <section className="mt-4 rounded-inner bg-raised p-4" aria-label="Today’s session">
          <div className="flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold">Your skill opener is saved. The lifts are next.</span>
              <span className="block text-caption text-ink3">
                {liftsPreset ? `${FOCUS_LABEL[liftsPreset.focus]} · ${liftsPreset.minutes} min — the day is not done until they are.` : 'Pick the lifts on the Gym side — the day is not done until they are.'}
              </span>
            </span>
            {marker(true, 1)}
          </div>
          <Button full className="mt-3" onClick={start}>
            {liftsPreset ? 'Start the lifts' : 'Open the Gym side'}
          </Button>
          <button onClick={() => endTheDay()} className="mt-1 min-h-11 px-1 text-footnote font-medium text-accent-text">
            End the day here — skip the lifts
          </button>
        </section>
      ) : session && !plan.rest ? (
        <section className="mt-4 rounded-inner bg-raised p-4" aria-label="Today’s session">
          <div className="flex items-start gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-body font-semibold">{session.title}</span>
              {session.line ? <span className="block text-caption text-ink3">{session.line}</span> : null}
              {session.place ? <span className="block text-caption text-ink3">{session.place}</span> : null}
            </span>
            {allDone ? marker(true, 1) : null}
          </div>
          {plan.kind === 'gym' && plan.gym && opener ? (
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

      {plan.reasons.length && !allDone && !liftsNext ? (
        <details className="group mt-3 rounded-inner border border-line" open={plan.rest || plan.readiness?.level === 'light' ? true : undefined}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-footnote font-semibold text-ink2">
            Why this session
            <Icon name="chevronR" size={14} className="transition group-open:rotate-90" />
          </summary>
          <ul className="space-y-1.5 px-3 pb-3">
          {plan.reasons.map((r) => (
            <li key={r} className="flex gap-2 text-footnote leading-snug text-ink2">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-ink3" />
              <span>{r}</span>
            </li>
          ))}
          </ul>
        </details>
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
