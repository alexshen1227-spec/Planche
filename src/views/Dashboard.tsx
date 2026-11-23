import { Button, Card, Metric } from '../components/ds'
import { useMemo, useState } from 'react'
import type { SkillId, Tab, WorkoutRequest } from '../types'
import { useStore } from '../lib/store'
import { STEP_BY_ID, stepAfter, stepsOf } from '../data/progressions'
import { SKILLS } from '../data/skills'
import { activeSkills, skillView } from '../lib/skills'
import { EXERCISE_BY_ID } from '../data/exercises'
import {
  challengeBlockedReason,
  finalizeFromPlan,
  finalizeWorkoutWithPlan,
  isPainSafe,
  microBlockedReason,
  microDoseWorkout,
} from '../data/workouts'
import { weekPlan, weekWork, workSets } from '../lib/volume'
import { BridgeCard } from '../components/BridgeCard'
import { BASIS_LABEL, tipOfTheDay } from '../data/tips'
import { ACHIEVEMENT_BY_ID } from '../data/achievements'
import { weekStreak, totalHoldSec, sessionHighlight } from '../lib/stats'
import { buildPlan, STRATEGY_BY_ID, coachConfidence } from '../lib/coach'
import { CONFIDENCE_NOTE, describeForecast, forecastUnlock, goalOutlook } from '../lib/forecast'
import { PLATEAU_LABEL, recentBreakthrough } from '../lib/plateau'
import { qualifyingProgress } from '../lib/progression'
import { addDays, dayKey, fmtDate, fmtDuration, fmtHold, weekStart } from '../lib/time'
import { exportData } from '../lib/exportImport'
import { useToday } from '../lib/useToday'
import { pushToast } from '../lib/toast'
import { Icon } from '../components/Icon'
import { BadgeGlyph } from '../components/ds/BadgeGlyph'
import { Figure } from '../components/Figure'
import { Modal, ProgressRing, SectionTitle } from '../components/ui'
import { AddSkill } from '../components/AddSkill'
import { WeekPlanCard } from '../components/WeekPlanCard'
import { INSTALL_STEPS, installState } from '../lib/install'
import { WalkBackCalibrator } from '../components/WalkBackCalibrator'
import { walkMeasureDue } from '../lib/sessionTiming'
import { kitStatusLine, skillChipLabel, streakText } from '../components/weekPlanCopy'
import { coachTodayLabel } from '../lib/coachLabel'
import { recordNote } from '../lib/sessionSummary'
import { AFTER_OPENER_WARM_UP_MIN, atActivePlace, planToday } from '../lib/plan/planner'
import { endTheDay, rememberNextBlock, useDayMarks, useNextBlock } from '../lib/plan/nextBlock'
import { choiceOptions, useTodayChoice } from '../lib/plan/todayChoice'
import {
  calisthenicsPlaceLine,
  calisthenicsRequest,
  dayStage,
  GOAL_HERE_TEXT,
  goalStanding,
  gymPlaceLine,
  gymPreset,
  homeToday,
  maxTestOffered,
  openerLine,
  resolveGymPlace,
  shortVersion,
  stepPassed,
  trainingWeek,
} from '../lib/plan/screens'
import { usePlanClock } from '../lib/plan/usePlanClock'
import { ladderStatus } from '../lib/repLadder'
import { WeekPreview } from '../components/plan/WeekPreview'
import type { GymPreset } from '../components/plan/TodayPlanCard'
import { FOCUS_LABEL } from '../lib/gym/builder'

/** Per-device memory of the complete-sessions notice; never state that matters. */
const SESSIONS_NOTICE_KEY = 'planchelab.notice.complete-sessions'

function noticeSeen(): boolean {
  try {
    return localStorage.getItem(SESSIONS_NOTICE_KEY) === '1'
  } catch {
    return false
  }
}

function markNoticeSeen() {
  try {
    localStorage.setItem(SESSIONS_NOTICE_KEY, '1')
  } catch {
    /* private mode: the notice simply returns next launch */
  }
}

/** Per-device memory of the measure-your-walk card. */
const WALK_NOTICE_KEY = 'planchelab.notice.measure-walk'

function walkNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(WALK_NOTICE_KEY) === '1'
  } catch {
    return false
  }
}

/** Per-device memory of the "more skills" card shown to athletes from before the other roads existed. */
const SKILLS_NOTICE_KEY = 'planchelab.notice.more-skills'

function skillsNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(SKILLS_NOTICE_KEY) === '1'
  } catch {
    return false
  }
}

/** Per-device memory of the "add to Home Screen" card. */
const INSTALL_NOTICE_KEY = 'planchelab.notice.install'

function installNoticeDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_NOTICE_KEY) === '1'
  } catch {
    return false
  }
}

/** One row of the weekly work card: done against about-planned. */
function WorkBar({ label, done, planned, unit }: { label: string; done: number; planned: number; unit: 's' | ' reps' }) {
  const share = planned > 0 ? Math.min(1, done / planned) : 0
  const met = planned > 0 && done >= planned
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-footnote">
        <span className="min-w-0 truncate font-medium text-ink2">{label}</span>
        <span className="shrink-0 text-ink3 tnum">
          <span className={`font-semibold ${met ? 'text-ok-text' : 'text-ink'}`}>
            {done}
            {unit}
          </span>
          {planned > 0 ? ` of ~${planned}${unit}` : ''}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-raised" aria-hidden="true">
        <div
          className={`h-full rounded-full ${met ? 'bg-ok' : 'bg-accent'}`}
          style={{ width: `${Math.round(share * 100)}%` }}
        />
      </div>
    </div>
  )
}

function WeekStrip({ trainedDays }: { trainedDays: Set<string> }) {
  const start = weekStart(Date.now())
  const today = dayKey(Date.now())
  const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  return (
    // A seven-column grid rather than fixed-size circles in a row: at 20px a
    // piece the strip needed 176px inside a card that is 166px wide on a
    // phone, so the weekend spilled out past the card edge. Square cells sized
    // from the available width fit whatever the card gives them.
    <div className="grid grid-cols-7 gap-1">
      {letters.map((l, i) => {
        const k = dayKey(addDays(start, i))
        const trained = trainedDays.has(k)
        const isToday = k === today
        return (
          <span
            key={i}
            title={fmtDate(addDays(start, i))}
            className={`grid aspect-square w-full place-items-center rounded-full text-[9.5px] font-bold leading-none ${
              trained
                ? 'bg-accent text-on-accent'
                : isToday
                  ? 'border-[1.5px] border-accent text-accent-text'
                  : 'border border-line text-ink3'
            }`}
          >
            {trained ? <Icon name="check" size={10} strokeWidth={3.5} /> : l}
          </span>
        )
      })}
    </div>
  )
}

export function Dashboard({
  startWorkout,
  go,
  viewSession,
}: {
  startWorkout: (request: WorkoutRequest) => void
  go: (t: Tab) => void
  viewSession: (sessionId: string) => void
}) {
  const { state: whole, dispatch } = useStore()
  // Everything date-dependent is keyed on today too: a screen left open
  // overnight used to offer yesterday's plan.
  const today = useToday()
  // The coarse clock re-plans a Home left open: pain, joints and the rest rule run in hours, not days.
  const clock = usePlanClock()
  // One skill is on screen at a time; the rest are a tap away. Everything
  // below that reads "the step", "the plan" or "the forecast" reads it for
  // this skill, through the same view the coach itself uses.
  const skills = activeSkills(whole)
  const [pickedSkill, setPickedSkill] = useState<SkillId | null>(null)
  const viewSkill: SkillId = pickedSkill && skills.includes(pickedSkill) ? pickedSkill : skills[0]
  const state = useMemo(() => skillView(whole, viewSkill), [whole, viewSkill])
  const skillDef = SKILLS[viewSkill]
  const several = skills.length > 1
  const step = STEP_BY_ID[state.stepId]
  const road = stepsOf(viewSkill)
  const keyEx = EXERCISE_BY_ID[step.keyExerciseId]
  const prBest = state.prs[step.keyExerciseId]?.value ?? 0
  const qualified = qualifyingProgress(state, state.stepId)
  const best = qualified.value
  // A record that is a stopwatch hold read short of its timer: both numbers, and why.
  const bestNote = useMemo(() => {
    const sets = state.sessions.flatMap((x) => x.sets)
    const shown = Math.max(best, prBest)
    return shown > 0 ? recordNote(sets, step.keyExerciseId, shown, state.settings.walkBackSec) : null
  }, [state.sessions, state.settings.walkBackSec, step.keyExerciseId, best, prBest])
  const unlockPct = Math.min(1, best / step.unlockSec)
  const next = stepAfter(state.stepId)
  const goalStep = STEP_BY_ID[state.profile.goalStepId ?? skillDef.defaultGoal] ?? road[road.length - 1]
  // A goal that is the step being trained is reached only once that step is passed: a new athlete placed on
  // their goal once read "goal reached" at 0%.
  const standing = goalStanding(step, goalStep, stepPassed(state, step.id))
  // A skill with a rep line moves on its own rungs: say where it is beside the hold's goal.
  const ladder = useMemo(() => (skillDef.ladder ? ladderStatus(whole, viewSkill) : null), [whole, viewSkill, skillDef.ladder])
  // Who trains today, and why — only worth a card when there is a choice. Read
  // off the session Start would build, after the rails: the planned line-up
  // once listed three skills above a button that built the pain-safe session.
  // Today's skill session is the skill block of today's plan (its minutes and
  // skills), the same request the Train tab's Today card starts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // Today's choice ("Rather do … today?", "I have X min", "Train anyway") is one for every screen.
  const [choice, setChoice] = useTodayChoice(today)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const dayPlan = useMemo(() => planToday(whole, choiceOptions(choice)), [whole, today, clock, choice.kind, choice.minutes])
  const mode = homeToday(dayPlan)
  const recommended: WorkoutRequest = useMemo(
    () =>
      // Only a calisthenics day's own block is today's calisthenics session: on a
      // gym day the skill block is the gym's opener, not this card.
      dayPlan.kind === 'calisthenics' && dayPlan.skill && !dayPlan.skill.opener
        ? // Built where the plan has it (a lever day at the gym with the bar), or where the athlete said they are.
          calisthenicsRequest(whole, dayPlan.skill, choice.placeId)
        : atActivePlace(whole, { source: 'auto' }),
    [dayPlan, whole, choice.placeId],
  )
  // Today's main session done: Home recommends nothing more, only a quiet way to train again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const marks = useDayMarks(today)
  const rememberedLifts = useNextBlock<GymPreset>(today)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stage = useMemo(() => dayStage(whole, dayPlan, Date.now(), marks), [whole, dayPlan, today, clock, marks])
  const finished = stage === 'done'
  // A gym day's opener is saved: the lifts are what is left, and nothing here recommends the opener's skill again.
  const liftsNext = stage === 'lifts-next'
  // "Short on time?" goes through the coach (`shortVersion`): never a hard session inside the rest rule, unsaid.
  const startShort = (m: number) => {
    const kind = choiceOptions(choice).kind
    const short = shortVersion(whole, m, { ...(kind ? { kind } : {}), ...(choice.placeId ? { placeId: choice.placeId } : {}) })
    if ('request' in short) startWorkout(short.request)
    else pushToast(short.reason, 'info')
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const todays = useMemo(() => finalizeWorkoutWithPlan(whole, recommended, undefined, Date.now()), [whole, today, clock, recommended])
  const lineup = todays.lineup
  /** Chosen skills that cannot train until some kit is added. */
  const kitLines = skills.flatMap((skill) => {
    const status = kitStatusLine(skill, whole.profile.equipment, whole.gym?.locations ?? [])
    return status.kind === 'ready' ? [] : [{ skill, status }]
  })

  const hour = new Date().getHours()
  const greeting = hour < 5 ? 'Burning the midnight oil' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  // Training days this week, skill and gym alike, as the plan counts them against the weekly goal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tw = useMemo(() => trainingWeek(whole, Date.now()), [whole, today])
  const thisWeek = tw.days
  const goal = state.settings.weeklyGoal
  const streak = weekStreak(state)
  const streakWords = streakText(streak, state.settings.weeklyGoal)
  const tut = totalHoldSec(state)
  const todaysLatest = useMemo(
    () =>
      state.sessions
        .filter((s) => dayKey(s.startedAt) === today)
        .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null,
    [state.sessions, today],
  )
  const trainedToday = todaysLatest !== null
  const tip = tipOfTheDay(Date.now(), skills)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => buildPlan(state), [state, today, clock])
  // Read with the plan's own signals: the forecast, the breakthrough card and
  // the coach refuse on one noise reading, the one Progress reports.
  const forecast = useMemo(() => forecastUnlock(state, state.stepId, Date.now(), plan.signals), [state, plan])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const outlook = useMemo(() => goalOutlook(state), [state, today])
  // The minimum dose is offered only on a day it is allowed (see microBlockedReason).
  const microMinutes = useMemo(
    () => (microBlockedReason(state, plan) ? null : microDoseWorkout(state, plan).minutes),
    [state, plan],
  )
  const breakthrough = useMemo(() => recentBreakthrough(state, state.stepId, Date.now(), plan.signals), [state, plan])
  const confidence = useMemo(() => coachConfidence(state), [state])
  // An athlete who set up before the other roads existed was never asked which
  // skills they want — their save has no list at all. They are told once, here,
  // rather than left to find "Add a skill" on the Path.
  const [skillsNoticeClosed, setSkillsNoticeClosed] = useState(skillsNoticeDismissed)
  const [addingSkill, setAddingSkill] = useState(false)
  const showSkillsNotice = !skillsNoticeClosed && whole.profile.skills === undefined
  const closeSkillsNotice = () => {
    try {
      localStorage.setItem(SKILLS_NOTICE_KEY, '1')
    } catch {
      /* private mode: the card simply returns next launch */
    }
    setSkillsNoticeClosed(true)
  }
  // Derived from the current state on every render: decided once at mount,
  // it never appeared for someone whose first session was saved on this screen.
  const [noticeClosed, setNoticeClosed] = useState(noticeSeen)
  const showSessionsNotice =
    !noticeClosed &&
    !showSkillsNotice &&
    !several &&
    viewSkill === 'planche' &&
    state.sessions.length > 0 &&
    state.settings.sessionMinutes < 40
  const closeSessionsNotice = () => {
    markNoticeSeen()
    setNoticeClosed(true)
  }
  const [installNoticeClosed, setInstallNoticeClosed] = useState(installNoticeDismissed)
  const showInstallNotice = !installNoticeClosed && installState() === 'ios-tab'
  const closeInstallNotice = () => {
    try {
      localStorage.setItem(INSTALL_NOTICE_KEY, '1')
    } catch {
      /* private mode: the card simply returns next launch */
    }
    setInstallNoticeClosed(true)
  }
  const [walkNoticeClosed, setWalkNoticeClosed] = useState(walkNoticeDismissed)
  const [measuringWalk, setMeasuringWalk] = useState(false)
  // One card at a time: the new roads first, then the session-length offer, then the walk.
  const showWalkNotice = !walkNoticeClosed && !showSessionsNotice && !showSkillsNotice && walkMeasureDue(state)
  const closeWalkNotice = () => {
    try {
      localStorage.setItem(WALK_NOTICE_KEY, '1')
    } catch {
      /* private mode: the card simply returns next launch */
    }
    setWalkNoticeClosed(true)
  }
  // The week in the currencies that move a planche, against today's plan times
  // the sessions the athlete means to train. Only a full day's plan stands for
  // a normal week. A lighter day is left out too: once today's session is
  // saved, "today" is a skill-only second session, and a new athlete's weekly
  // straight-arm target fell from ~198s to ~42s the moment they finished.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const work = useMemo(() => weekWork(state), [state, today])
  const loadedDay = plan.loadPermission === 'normal' && (plan.dayType === 'push' || plan.dayType === 'build')
  // With several skills the week's plan moves with the line-up — "today's
  // plan times your sessions" is no longer a week — so only what was done is
  // shown, and nothing is invented to compare it with.
  const planned = useMemo(
    () =>
      loadedDay && !several
        ? weekPlan(finalizeFromPlan(whole, { source: 'auto' }, plan).workout, step.keyExerciseId, goal)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [whole, plan, loadedDay, goal, several],
  )
  const testBlocked = challengeBlockedReason(plan)
  // Only three decisions fit the card. Warnings are picked first — a safety
  // rail's "joint pain reported" must never be squeezed out by an FYI that
  // happened to be pushed earlier in the plan.
  const topDecisions = useMemo(() => {
    // The plateau has its own card directly above; repeating the paragraph as
    // a bullet made one screen say the same thing twice.
    const shown = plan.decisions.filter((d) => d.source !== 'plateau')
    const warns = shown.filter((d) => d.kind === 'warn')
    const rest = shown.filter((d) => d.kind !== 'warn')
    return [...warns, ...rest].slice(0, 3)
  }, [plan])

  const recent = useMemo(() => [...state.sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, 3), [state.sessions])
  const trainedDays = useMemo(
    () => new Set([...state.sessions.map((s) => dayKey(s.startedAt)), ...(whole.gym?.sessions ?? []).map((s) => dayKey(s.startedAt))]),
    [state.sessions, whole.gym],
  )
  /** A gym day starts its opener here (the lifts follow when it is saved), or opens the plan on Train. */
  const gymWhere = useMemo(
    () => (dayPlan.kind === 'gym' && dayPlan.gym ? resolveGymPlace(whole, Date.now(), { plannedId: choice.placeId ? undefined : dayPlan.gym.placeId, pickedId: choice.placeId }) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [whole, dayPlan, choice.placeId, today, clock],
  )
  const startGymDay = () => {
    const g = dayPlan.gym
    const opener = dayPlan.skill?.opener ? dayPlan.skill : undefined
    const doneToday = whole.sessions.some((s) => dayKey(s.startedAt) === today) || (whole.gym?.sessions ?? []).some((s) => dayKey(s.startedAt) === today)
    if (g && opener && !doneToday) {
      rememberNextBlock<GymPreset>(gymPreset(g, { placeId: gymWhere?.place.id ?? g.placeId, warmUpMin: AFTER_OPENER_WARM_UP_MIN }))
      startWorkout(calisthenicsRequest(whole, opener, choice.placeId))
    } else go('train')
  }
  const recentAchievements = useMemo(
    () =>
      Object.entries(state.achievements)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id, at]) => ({ def: ACHIEVEMENT_BY_ID[id], at }))
        .filter((x) => x.def),
    [state.achievements],
  )

  return (
    <div className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-title1 font-bold text-ink">
            {greeting}
            {state.name ? `, ${state.name}` : ''}
          </h1>
          <p className="mt-0.5 text-body text-ink2">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {trainedToday ? ' · trained today ✓' : ''}
          </p>
        </div>
        {/* Day one has no streak to show: a "0-week streak" was one more thing on a full first screen. */}
        {streak.weeks > 0 || whole.sessions.length > 0 ? (
          <div className="flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-footnote font-medium text-ink2">
            <Icon name="flame" size={16} className={streak.weeks > 0 ? 'text-accent-text' : 'text-ink3'} />
            <span className="tnum" title={streakWords.note}>
              {streakWords.main}
              <span className="ml-1.5 hidden font-normal text-ink3 sm:inline">· {streakWords.note}</span>
            </span>
          </div>
        ) : null}
      </div>

      {several ? (
        <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Skill shown">
          {skills.map((skill, index) => {
            const on = skill === viewSkill
            return (
              <button
                key={skill}
                aria-pressed={on}
                aria-label={skillChipLabel(skill, index === 0)}
                onClick={() => setPickedSkill(skill)}
                className={`min-h-11 rounded-full border px-3.5 py-1.5 text-footnote font-semibold transition ${
                  on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-surface text-ink2 hover:text-ink'
                }`}
              >
                {SKILLS[skill].name}
                {index === 0 ? <span className={`ml-1.5 text-caption font-medium ${on ? 'opacity-80' : 'text-ink3'}`}>main</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}

      {/* Today: one hero card. Title and figure on top, progress and what it
          means beneath (never a narrow third column), the action last. */}
      <div className={`${several ? 'mt-3' : 'mt-5'} rounded-card border border-line bg-surface p-4`}>
        <div className="flex items-start gap-4">
          <Figure step={step.id} tone="accent" className="h-20 w-24 shrink-0 text-ink" />
          <div className="min-w-0">
            <div className="text-caption font-semibold uppercase tracking-wider text-accent-text">
                {several ? `${skillDef.name} · ` : ''}Step {step.order + 1} of {road.length} · current
                {standing === 'ahead' ? ` · goal ${goalStep.name}` : standing === 'reached' ? ' · goal reached' : ' · goal: this step'}
              </div>
            <div className="mt-1 font-display text-title2 font-bold leading-tight text-ink">{step.name}</div>
            <div className="mt-0.5 text-footnote text-ink2">{step.tagline}</div>
            {standing === 'here' ? <div className="mt-1 text-footnote font-medium text-accent-text">{GOAL_HERE_TEXT}</div> : null}
            {ladder ? (
              <div className="mt-1 text-caption text-ink3">
                {ladder.ladder.name}: now {EXERCISE_BY_ID[ladder.rung.exerciseId]?.name ?? ladder.rung.exerciseId}
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <ProgressRing value={unlockPct} size={64} stroke={6}>
            <span className="font-display text-body font-bold text-ink tnum">{Math.round(unlockPct * 100)}%</span>
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <div className="space-y-1">
              <div className="text-footnote text-ink2">
                {keyEx.name} verified best{' '}
                <span className="font-semibold text-ink tnum">{best ? fmtHold(best) : '—'}</span>
                {prBest > best ? <span className="text-ink3"> · PR {fmtHold(prBest)}</span> : null}
              </div>
              {bestNote ? <p className="text-caption leading-relaxed text-ink3">{bestNote}</p> : null}
              <div className="text-footnote text-ink2">
                {next ? (
                  <>
                    Hold <span className="font-semibold text-ink tnum">{step.unlockSec}s</span>
                    {keyEx.perSide ? ' on both sides' : ''} with athlete + filmed form confirmation to unlock{' '}
                    <span className="font-semibold text-ink">{next.name}</span>
                  </>
                ) : (
                  <>
                    Mastery bar: <span className="font-semibold text-ink tnum">{step.unlockSec}s</span> verified
                  </>
                )}
              </div>
              {next ? (
                <div>
                  <div>
                    {forecast.kind === 'ready' ? (
                      <span className="text-footnote font-medium text-accent-text">
                        Attempt ready — you have already held this bar. Test it.
                      </span>
                    ) : forecast.kind === 'range' ? (
                      <>
                        <span className="text-footnote font-medium text-accent-text">
                          {describeForecast(forecast)} at your measured rate
                        </span>
                        <div className="mt-0.5 text-caption leading-relaxed text-ink3">
                          {CONFIDENCE_NOTE[forecast.confidence]}
                        </div>
                      </>
                    ) : forecast.kind === 'not-trending' ? (
                      // The module's own `basis` rather than a hardcoded
                      // sentence: three different situations land here — flat,
                      // falling, and climbing too slowly to date — and calling
                      // all three "flat" told some athletes the opposite of
                      // what their own data said.
                      <span className="text-footnote leading-relaxed text-ink3">{forecast.basis}</span>
                    ) : forecast.kind === 'noisy' ? (
                      // Progress's own sentence: the two screens read one noise gate.
                      <span className="text-footnote leading-relaxed text-ink3">{forecast.basis}</span>
                    ) : (
                      <span className="text-footnote leading-relaxed text-ink3">
                        No forecast yet — {forecast.need}
                      </span>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {/* The coach picks one main session a day, and Home says the same as Train: a rest day is a rest day. */}
        {finished ? (
          <div className="mt-4 rounded-inner border border-line bg-raised p-3">
            <p className="text-footnote text-ink2">
              <span className="font-semibold text-ink">Today: done</span> — today’s main session is in, and nothing more is planned.
            </p>
            <button onClick={() => (mode === 'gym' ? go('train') : startWorkout(recommended))} className="mt-1 min-h-11 text-footnote font-medium text-accent-text">
              Train again
            </button>
          </div>
        ) : mode === 'rest' ? (
          <div className="mt-4 rounded-inner border border-line bg-raised p-3">
            <p className="text-footnote text-ink2">
              <span className="font-semibold text-ink">Today: rest</span> — {dayPlan.reasons[0] ?? 'nothing is planned today.'}
            </p>
            <Button className="mt-2" variant="secondary" onClick={() => setChoice({ ...choice, minutes: whole.settings.sessionMinutes })}>
              Train anyway
            </Button>
          </div>
        ) : null}
        {liftsNext ? (
          <div className="mt-4 rounded-inner border border-line bg-raised p-3">
            <p className="text-footnote text-ink2">
              <span className="font-semibold text-ink">Today: the lifts are next</span> — your skill opener is saved, and the day is not done until the lifts are
              {rememberedLifts ? ` (${FOCUS_LABEL[rememberedLifts.focus].toLowerCase()}, ${rememberedLifts.minutes} min)` : ''}.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button onClick={() => go('train')}>{rememberedLifts ? 'Go to the lifts' : 'Open the Gym side'}</Button>
              <button onClick={() => endTheDay()} className="min-h-11 px-1 text-footnote font-medium text-accent-text">
                End the day here
              </button>
            </div>
          </div>
        ) : null}
        {mode === 'gym' && dayPlan.gym && !finished && !liftsNext ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-inner border border-line bg-raised p-3">
            <span className="text-footnote text-ink2">
              <span className="font-semibold text-ink">Today the coach recommends the gym</span> — {FOCUS_LABEL[dayPlan.gym.focus].toLowerCase()},{' '}
              {dayPlan.minutes} min
              {dayPlan.skill?.opener ? `. ${openerLine(dayPlan.skill)}` : ''}.
              {gymPlaceLine(gymWhere) ? ` ${gymPlaceLine(gymWhere)}${gymPlaceLine(gymWhere)!.endsWith('.') ? '' : '.'}` : ''}
            </span>
            <Button variant="secondary" onClick={() => go('train')}>
              Go to Train
            </Button>
          </div>
        ) : null}
        {mode === 'calisthenics' && dayPlan.skill && !finished && !liftsNext && calisthenicsPlaceLine(whole, dayPlan.skill, choice.placeId) ? (
          <p className="mt-3 text-footnote text-ink3">{calisthenicsPlaceLine(whole, dayPlan.skill, choice.placeId)}</p>
        ) : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {finished || liftsNext ? null : mode === 'calisthenics' ? (
            <Button size="lg" onClick={() => startWorkout(recommended)} className="w-full sm:w-auto">
              <Icon name="play" size={16} /> Start today’s session
            </Button>
          ) : mode === 'gym' ? (
            <Button size="lg" onClick={startGymDay} className="w-full sm:w-auto">
              <Icon name="play" size={16} />{' '}
              {dayPlan.skill?.opener ? `Start with the ${SKILLS[dayPlan.skill.skills[0]].name.toLowerCase()}` : 'Open the gym session'}
            </Button>
          ) : null}
          {dayPlan.alternative && !finished && !liftsNext ? (
            <Button variant="ghost" onClick={() => setChoice({ ...choice, kind: dayPlan.alternative })}>
              {dayPlan.alternative === 'gym' ? 'Rather do the gym today?' : 'Rather do calisthenics today?'}
            </Button>
          ) : null}
          {/* The first session comes first: a max test is offered once there is one. */}
          {!maxTestOffered(whole, testBlocked) ? null : (
            <Button variant="secondary" onClick={() => startWorkout({ source: 'test', stepId: state.stepId })}>
              <Icon name="target" size={16} /> Max test{several ? ` · ${skillDef.short}` : ''}
            </Button>
          )}
          <Button variant="ghost" onClick={() => go('path')}>
            View the road <Icon name="chevronR" size={15} />
          </Button>
        </div>
        {/* Re-scope today rather than re-plan the week. The realistic
            alternative to "I've got twenty minutes" is training nothing, and a
            skipped session teaches the coach nothing either. */}
        {testBlocked && state.sessions.length > 0 ? (
          <p className="mt-3 text-footnote leading-relaxed text-ink3">
            No max test today — {testBlocked}.
          </p>
        ) : null}
        {/* Only on a calisthenics day: on a gym day it sat unlabelled under "the coach recommends the gym". */}
        {mode !== 'calisthenics' ? null : lineup.length > 1 ? (
          <div className="mt-3 rounded-control border border-line bg-raised p-3">
            <div className="text-caption font-bold uppercase tracking-wider text-ink3">Today's session trains</div>
            <ul className="mt-1.5 space-y-1.5">
              {lineup.map((entry) => (
                <li key={entry.skill} className="text-footnote leading-relaxed text-ink2">
                  <span className="font-semibold text-ink">{SKILLS[entry.skill].name}</span> — {entry.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : several && lineup[0] ? (
          <p className="mt-3 text-footnote leading-relaxed text-ink3">
            Today's session: {SKILLS[lineup[0].skill].name}. {lineup[0].reason}
          </p>
        ) : several && isPainSafe(todays.workout) ? (
          <p className="mt-3 text-footnote leading-relaxed text-ink3">
            Today's session trains none of your skills: with what you reported, it is the pain-safe session — easy
            movement only — until a check-in says the joint has settled.
          </p>
        ) : null}
      </div>

      {/* Quieter things, kept off the hero. */}
      {(kitLines.length > 0 || showSessionsNotice || showSkillsNotice || showWalkNotice) ? (
        <div className="mt-6 space-y-2">
        {kitLines.map(({ skill, status }) => (
          <p key={skill} className="rounded-card border border-line bg-surface p-4 text-footnote leading-relaxed text-ink">
            {status.kind === 'waiting' ? (
              <>
                {status.text} Add it under Settings → Equipment and it joins your sessions.
              </>
            ) : (
              status.text
            )}
          </p>
        ))}
        {showSessionsNotice ? (
          <div className="rounded-card border border-line bg-surface p-4 text-footnote leading-relaxed text-ink">
            <div className="font-semibold">Sessions are complete at every level now</div>
            <p className="mt-0.5 text-ink2">
              After the main holds: the push-up version of your step, pseudo planche push-ups, then leans. At your{' '}
              {state.settings.sessionMinutes}-minute length some of that gets trimmed — 45 minutes fits all of it.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  dispatch({ type: 'SET_SETTINGS', patch: { sessionMinutes: 45 } })
                  closeSessionsNotice()
                  pushToast('Sessions are now planned for about 45 minutes.', 'success')
                }}
                className="min-h-11 rounded-control bg-accent px-4 text-body font-semibold text-on-accent"
              >
                Use 45 minutes
              </button>
              <button
                onClick={closeSessionsNotice}
                className="min-h-11 rounded-control border border-line-strong bg-raised px-4 text-body font-medium text-ink"
              >
                Keep {state.settings.sessionMinutes}
              </button>
            </div>
          </div>
        ) : null}
        {showSkillsNotice ? (
          <div className="rounded-card border border-line bg-surface p-4 text-footnote leading-relaxed text-ink">
            <div className="font-semibold">New: four more skills</div>
            <p className="mt-0.5 text-ink2">
              The front lever, the handstand and handstand push-up, the 90° hold and the human flag each have their own
              road now. Add one and it gets a share of your sessions — your planche stays exactly where it is, and stays
              first unless you change the order.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => setAddingSkill(true)}
                className="min-h-11 rounded-control bg-accent px-4 text-body font-semibold text-on-accent"
              >
                Add a skill
              </button>
              <button
                onClick={closeSkillsNotice}
                className="min-h-11 rounded-control border border-line-strong bg-raised px-4 text-body font-medium text-ink"
              >
                Not now
              </button>
            </div>
            <p className="mt-1.5 text-caption text-ink3">You can add one any time from the Path or Settings.</p>
          </div>
        ) : null}
        {showWalkNotice ? (
          <div className="rounded-card border border-line bg-surface p-4 text-footnote leading-relaxed text-ink">
            <div className="font-semibold">Measure your walk back to the phone</div>
            <p className="mt-0.5 text-ink2">
              Your main Path holds have 5 seconds taken off for coming out and reaching the phone. If your walk is
              quicker or slower, every one of them reads that much off — and your targets are set from those numbers.
              Three timed walks, about a minute; it is in Settings too.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => setMeasuringWalk(true)}
                className="min-h-11 rounded-control bg-accent px-4 text-body font-semibold text-on-accent"
              >
                Measure my walk
              </button>
              <button
                onClick={closeWalkNotice}
                className="min-h-11 rounded-control border border-line-strong bg-raised px-4 text-body font-medium text-ink"
              >
                No thanks
              </button>
            </div>
          </div>
        ) : null}
        </div>
      ) : null}
      {state.settings.sessionMinutes > 18 || microMinutes !== null ? (
        <div className="mt-6 rounded-card border border-line bg-surface p-4">
          <h2 className="font-display text-title3 font-semibold text-ink">More options</h2>
          <div className="mt-3 space-y-3">
        {state.settings.sessionMinutes > 18 ? (
          <div className="flex flex-wrap items-center gap-2 text-footnote">
            <span className="text-ink3">Short on time?</span>
            {[15, 20].map((m) => (
              <button
                key={m}
                onClick={() => startShort(m)}
                className="min-h-11 rounded-control border border-line-strong bg-raised px-4 text-body font-medium text-ink"
              >
                {m} min version
              </button>
            ))}
          </div>
        ) : null}
        {microMinutes !== null && whole.sessions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-footnote">
            <span className="text-ink3">No full session today?</span>
            <button
              onClick={() => startWorkout(atActivePlace(whole, { source: 'micro', ...(several ? { skills: [viewSkill] } : {}) }))}
              className="min-h-11 rounded-control border border-line-strong bg-raised px-4 text-body font-medium text-ink"
            >
              Minimum dose · {microMinutes} min
            </button>
            <span className="w-full text-caption leading-relaxed text-ink3">
              A few short, maximal holds — it keeps the position trained on a busy day, and does not count as one of
              your sessions.
            </span>
          </div>
        ) : null}
          </div>
        </div>
      ) : null}

      {/* The athlete's own week, directly under today. It is told what the
          session above trains once the rails have run, so it never names a
          skill day beside a pain-safe session. */}
      <WeekPlanCard
        className="animate-rise mt-6"
        style={{ animationDelay: '10ms' }}
        sessionSkills={lineup.map((entry) => entry.skill)}
      />
      {/* The coach's week, the same as Train's: the athlete's own plan above can be empty. */}
      {whole.gym?.prefs ? (
        <Card className="animate-rise mt-4" style={{ animationDelay: '15ms' }}>
          <WeekPreview />
        </Card>
      ) : null}

      {/* A named stall, or a real jump. Neither is filler: the card only
          exists when the log supports one, so an athlete who is simply
          progressing normally never sees it. */}
      {plan.plateau ? (
        <div
          className="animate-rise mt-6 rounded-card border border-line bg-surface p-4"
          style={{ animationDelay: '20ms' }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-footnote font-semibold uppercase tracking-wide text-ink3">
              <Icon name="chart" size={15} />
              {plan.plateau.status === 'regressing' ? 'Going backwards' : 'Plateau'}
            </span>
            <span className="rounded-full border border-line bg-raised px-3 py-1 text-footnote font-semibold text-ink2">
              {PLATEAU_LABEL[plan.plateau.cause]}
            </span>
            <span className="text-footnote text-ink3">
              {plan.plateau.confidence === 'good'
                ? 'confident read'
                : plan.plateau.confidence === 'moderate'
                  ? 'likely cause'
                  : 'best guess'}
            </span>
          </div>
          <h2 className="mt-2 font-display text-title3 font-semibold text-ink">
            {plan.plateau.weeksFlat} week{plan.plateau.weeksFlat === 1 ? '' : 's'} without moving the{' '}
            {keyEx.name.toLowerCase()}
          </h2>
          <p className="mt-1 text-footnote leading-relaxed text-ink2">{plan.plateau.evidence}</p>
          {plan.loadPermission === 'none' ? (
            // What they reported outranks the plateau. Showing the "do more"
            // prescription beside a rest day would be the plan contradicting
            // itself on the one screen where it should be clearest.
            <p className="mt-1.5 text-footnote leading-relaxed text-ink">
              Worth fixing, but not today — what you reported in your check-in comes first. This returns as soon as
              you are training loaded again.
            </p>
          ) : (
            <p className="mt-1.5 text-footnote leading-relaxed text-ink">{plan.plateau.intervention}</p>
          )}
          {plan.plateau.suggestMaxTest && !testBlocked ? (
            <button
              onClick={() => startWorkout({ source: 'test', stepId: state.stepId })}
              className="mt-3 inline-flex items-center gap-2 min-h-11 rounded-control border border-line-strong bg-raised px-4 text-footnote font-medium text-ink"
            >
              <Icon name="target" size={15} /> Run a max test
            </button>
          ) : null}
        </div>
      ) : breakthrough ? (
        <div
          className="animate-rise mt-6 flex flex-wrap items-center gap-3 rounded-card border border-ok/25 bg-ok-soft p-4"
          style={{ animationDelay: '20ms' }}
        >
          <Icon name="sparkle" size={17} className="shrink-0 text-ok-text" />
          <span className="text-body leading-relaxed text-ink">
            <span className="font-semibold">
              Your verified {keyEx.name.toLowerCase()} is up {breakthrough.gainSec}s
            </span>{' '}
            on where it typically sat about {breakthrough.weeks} weeks ago. That is real, camera-checked progress rather than a
            stopwatch number.
          </span>
        </div>
      ) : null}

      {/* An iPhone tab's history is one quiet week from being cleared by Safari;
          said once there is something to lose, and only where it applies. */}
      {showInstallNotice ? (
        <div className="animate-rise mt-6 rounded-card border border-line bg-surface p-4 text-footnote leading-relaxed text-ink" style={{ animationDelay: '20ms' }}>
          <div className="font-semibold">Add this app to your Home Screen</div>
          <p className="mt-0.5 text-ink2">
            Your training is stored on this phone and nowhere else. Safari can clear a website’s saved data after about a
            week without a visit; an app on your Home Screen keeps its own data, opens full-screen and works without
            signal.
          </p>
          {whole.sessions.length > 0 ? (
            <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-ink2">
              <li>
                Export a backup — the Home Screen app starts empty; it does not share this tab’s data. Saved clips do
                not move with it.
              </li>
              <li>{INSTALL_STEPS['ios-tab']}</li>
              <li>Open the new app, choose “I have a backup file” on its first screen, and pick the file.</li>
            </ol>
          ) : (
            <p className="mt-1 text-ink2">
              {INSTALL_STEPS['ios-tab']} Do it before you log anything: the Home Screen app keeps its own data, and what
              you log in this tab will not move over by itself.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {whole.sessions.length > 0 ? (
              <button
                onClick={() => {
                  const at = Date.now()
                  exportData({ ...whole, lastBackupAt: at })
                  dispatch({ type: 'STAMP_BACKUP', at })
                  pushToast('Backup exported.', 'success')
                }}
                className="min-h-11 rounded-control bg-accent px-4 text-body font-semibold text-on-accent"
              >
                Export backup
              </button>
            ) : null}
            <button
              onClick={closeInstallNotice}
              className="min-h-11 rounded-control border border-line-strong bg-raised px-4 text-body font-medium text-ink"
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}

      {/* Backup nudge once real history has accumulated */}
      {state.sessions.length >= 8 &&
      (!state.lastBackupAt || Date.now() - state.lastBackupAt > 30 * 86_400_000) ? (
        <div className="animate-rise mt-6 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4" style={{ animationDelay: '20ms' }}>
          <div className="flex items-center gap-2.5 text-body text-ink2">
            <Icon name="download" size={16} className="text-ink3" />
            <span>
              <span className="font-semibold text-ink">{state.sessions.length} sessions</span> live only on this
              device. Keep a copy somewhere safe.
            </span>
          </div>
          <button
            onClick={() => {
              const at = Date.now()
              // The whole athlete, never the one-skill view this screen reads.
              exportData({ ...whole, lastBackupAt: at })
              dispatch({ type: 'STAMP_BACKUP', at })
              pushToast('Backup exported.', 'success')
            }}
            className="min-h-11 rounded-control border border-line-strong bg-raised px-4 text-footnote font-medium text-ink"
          >
            Export backup
          </button>
        </div>
      ) : null}

      {/* Trained today: point at what was logged. This used to offer a loaded
          wrist routine as "recovery", under a name ("Armor") that promised
          protection no routine provides. */}
      {todaysLatest ? (
        <div className="animate-rise mt-6 flex flex-wrap items-center justify-between gap-3 rounded-card border border-ok/25 bg-ok-soft p-4" style={{ animationDelay: '40ms' }}>
          <div className="flex items-center gap-2.5 text-body text-ink">
            <Icon name="check" size={16} className="text-ok-text" />
            {todaysLatest.workoutKind === 'micro' ? (
              // A minimum dose feeds nothing the coach plans from, so it must
              // not claim the next plan builds on it.
              <span>
                <span className="font-semibold">Minimum dose done.</span> Your next session is planned as usual.
              </span>
            ) : (
              <span>
                <span className="font-semibold">{liftsNext ? 'Your opener is banked.' : 'Today is banked.'}</span>{' '}
                {liftsNext ? 'The lifts are still to come.' : 'The next plan builds on what you logged.'}
              </span>
            )}
          </div>
          <button
            onClick={() => viewSession(todaysLatest.id)}
            className="min-h-11 rounded-control border border-line-strong bg-raised px-4 text-footnote font-medium text-ink"
          >
            See today’s session →
          </button>
        </div>
      ) : null}

      {/* The bridge to the next step — the part of the road that sets the pace */}
      {state.sessions.length > 0 ? (
        <div className="animate-rise mt-6" style={{ animationDelay: '90ms' }}>
          <BridgeCard state={state} stepId={state.stepId} compact />
        </div>
      ) : null}

      {/* Coach */}
      <div className="animate-rise mt-6 rounded-card border border-line bg-surface p-4" style={{ animationDelay: '110ms' }}>
        <div>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display text-title3 font-semibold text-ink">
              <Icon name="target" size={18} className="text-accent-text" /> Coach
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-accent-soft px-3 py-1 text-footnote font-semibold text-accent-text">
                {coachTodayLabel(STRATEGY_BY_ID[plan.strategy].name, several ? skillDef.name : null)}
              </span>
              {plan.limiter ? (
                <span className="rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-footnote font-semibold text-accent-text">
                  Limiter: {plan.limiter.label}
                </span>
              ) : null}
              <span className="rounded-full border border-line bg-raised px-3 py-1 text-footnote font-medium text-ink2">
                {plan.warmup === 'extended' ? 'Full warm-up' : plan.warmup === 'short' ? 'Short warm-up' : 'Standard warm-up'}
              </span>
              <span className="rounded-full border border-line bg-raised px-3 py-1 text-footnote font-medium text-ink2 tnum">
                {Math.floor(plan.restMainSec / 60)}:{String(plan.restMainSec % 60).padStart(2, '0')} rest
              </span>
            </div>
            <p className="mt-3 text-footnote leading-relaxed text-ink2">{plan.strategyReason}</p>
            {plan.limiter ? (
              <p className="mt-1 text-footnote leading-relaxed text-ink3">
                {plan.limiter.evidence} {plan.limiter.prescription}
              </p>
            ) : null}
            <ul className="mt-3 space-y-2">
              {topDecisions.map((d) => (
                <li key={d.text} className="flex gap-2 text-footnote leading-relaxed">
                  <span
                    className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                      d.kind === 'warn' ? 'bg-danger' : d.kind === 'good' ? 'bg-ok' : 'bg-ink3'
                    }`}
                  />
                  <span className="text-ink2">{d.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Button variant="secondary" full className="mt-4" onClick={() => go('stats')}>
          What it learned →
        </Button>
        <div className="mt-4 flex items-center gap-3 text-footnote text-ink3">
          <div className="h-1 w-20 shrink-0 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent/70"
              style={{ width: `${Math.min(100, (confidence.evaluated / 12) * 100)}%` }}
            />
          </div>
          <span className="tnum">
            {confidence.attempted === 0
              ? 'Ready to shape your first recommended session'
              : confidence.evaluated === 0
                ? `${confidence.attempted} coached session${confidence.attempted === 1 ? '' : 's'} tried · waiting for a later result`
                : `${confidence.evaluated} result${confidence.evaluated === 1 ? '' : 's'} measured · ${confidence.tried}/5 approaches tried`}
          </span>
        </div>
      </div>

      {/* Where the road ends, and how honestly far that is */}
      <div
        className="animate-rise mt-6 rounded-card border border-line bg-surface p-4"
        style={{ animationDelay: '125ms' }}
      >
        <div>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display text-title3 font-semibold text-ink">
              <Icon name="route" size={18} className="text-ink3" /> Your goal
            </h2>
            {/* The separator is a real space, not only the `ml-2` margin: a
                screen reader reads the concatenated text, and without it this
                announced as "Straddle Planche3 steps to go". */}
            <div className="mt-3 text-body font-semibold text-ink">
              {STEP_BY_ID[outlook.goalStepId].name}
              {outlook.stepsRemaining > 0 ? (
                <>
                  {' '}
                  <span className="ml-1 text-footnote font-medium text-ink2">
                    · {outlook.stepsRemaining} step{outlook.stepsRemaining === 1 ? '' : 's'} to go
                  </span>
                </>
              ) : null}
            </div>
            {outlook.estimate ? (
              <div className="mt-1 text-footnote font-medium text-accent-text">
                Roughly {outlook.estimate.lowWeeks}–{outlook.estimate.highWeeks} weeks at your own measured pace
              </div>
            ) : null}
            <p className="mt-1 text-footnote leading-relaxed text-ink3">{outlook.note}</p>
          </div>
        </div>
        <Button variant="secondary" full className="mt-4" onClick={() => go('path')}>
          Change goal →
        </Button>
      </div>

      {/* Secondary things fold away under More, so today's session and its Start lead the screen. */}
      <details className="group mt-6 rounded-card border border-line bg-surface">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-body font-semibold text-ink">
          More
          <span className="flex items-center gap-1 text-footnote font-normal text-ink3">
            This week · tip · achievements · recent sessions <Icon name="chevronR" size={14} className="transition group-open:rotate-90" />
          </span>
        </summary>
        <div className="px-1 pb-4">
      {/* This week, in one compact row */}
      <Card className="animate-rise mt-6" style={{ animationDelay: '80ms' }}>
        <div className="flex items-start justify-between gap-3">
          <Metric
            label="This week"
            value={
              <>
                {thisWeek}
                <span className="text-body text-ink3">/{goal}</span>
              </>
            }
          />
          <Metric label="Week streak" value={streak.weeks} />
          <Metric label="Skill sessions" value={state.sessions.length} />
        </div>
        <p className="mt-2 text-caption text-ink3 tnum">
          Training days this week: {tw.cal} calisthenics, {tw.gym} gym — a day with a gym session counts as a gym day.
        </p>
        <div className="mt-4">
          <WeekStrip trainedDays={trainedDays} />
        </div>
        {/* "N more to keep it" frames training as defending something you are
            about to lose — and the displayed streak already counts the
            in-progress week. This states the fact and drops the loss frame. */}
        <p className="mt-3 text-footnote text-ink2">
          {thisWeek >= goal ? 'this week is banked' : `${Math.max(0, goal - thisWeek)} more training ${goal - thisWeek === 1 ? 'day' : 'days'} this week to meet your goal`}
        </p>
        <p className="mt-1 text-footnote text-ink3">
          Time under tension <span className="tnum font-medium text-ink2">{fmtDuration(tut)}</span> — all holds, all time ·{' '}
          {fmtDate(state.startedAt) === 'Today' ? 'started today' : `since ${fmtDate(state.startedAt)}`}
        </p>
      </Card>

      {/* The week's work — volume made visible */}
      <div className="animate-rise mt-6 rounded-card border border-line bg-surface p-4" style={{ animationDelay: '95ms' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-footnote font-semibold uppercase tracking-wide text-ink3">This week’s work</div>
          <div className="text-caption text-ink3 tnum">
            {thisWeek}/{goal} training days
          </div>
        </div>
        <div className="mt-3 space-y-3">
          <WorkBar label={`${keyEx.name} practice`} done={work.skillSec} planned={planned?.skillSec ?? 0} unit="s" />
          <WorkBar
            label={viewSkill === 'planche' ? 'Pressing — push-up versions, PPPU' : 'Strength and drill reps'}
            done={work.pressReps}
            planned={planned?.pressReps ?? 0}
            unit=" reps"
          />
          {/* Only where the skill has accessory holds at all: a lever's support
              work is negatives and scapular pulls, counted in reps above. */}
          {workSets(viewSkill).support.size > 0 ? (
            <WorkBar
              label={viewSkill === 'planche' ? 'Straight-arm work — leans and holds' : `Support holds — ${skillDef.words.support}`}
              done={work.straightArmSec}
              planned={planned?.straightArmSec ?? 0}
              unit="s"
            />
          ) : null}
        </div>
        {tw.gymSessions ? (
          <p className="mt-3 text-footnote text-ink2 tnum">
            Gym: {tw.gymSessions} {tw.gymSessions === 1 ? 'session' : 'sessions'}, {tw.gymSets} working {tw.gymSets === 1 ? 'set' : 'sets'} this week.
          </p>
        ) : null}
        <p className="mt-3 text-caption leading-relaxed text-ink3">
          {several
            ? `What you have done on ${skillDef.name.toLowerCase()} this week. With several skills the week's plan follows the line-up day by day, so there is no weekly target to hold it against.`
            : planned
            ? `About: today’s plan × your ${goal} sessions a week, and each day re-plans from what you did. A planning aid — no study sets these numbers.`
            : todaysLatest
              ? 'Today is done — the weekly targets come back with your next full session.'
              : 'Weekly targets come back with your next full session; today is planned lighter.'}
        </p>
      </div>

      {/* Tip + achievements */}
      <div className="animate-rise mt-6 grid gap-6 lg:grid-cols-2" style={{ animationDelay: '140ms' }}>
        <div className="rounded-card border border-line bg-surface p-4">
          <h2 className="flex items-center gap-2 font-display text-title3 font-semibold text-ink">
            <Icon name="sparkle" size={18} className="text-accent-text" /> Coach's tip
          </h2>
          <div className="mt-3 text-body font-semibold text-ink">{tip.title}</div>
          <p className="mt-1 text-footnote leading-relaxed text-ink2">{tip.body}</p>
          <p className="mt-2 text-caption text-ink3">{BASIS_LABEL[tip.basis]}</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-title3 font-semibold text-ink">
              <Icon name="trophy" size={18} className="text-ink3" /> Latest achievements
            </h2>
            <button onClick={() => go('stats')} className="-my-2 inline-flex min-h-11 items-center px-2 text-footnote font-medium text-ink2 hover:text-ink">
              All →
            </button>
          </div>
          {recentAchievements.length === 0 ? (
            <p className="mt-3 text-footnote text-ink2">
              None yet — your first session unlocks the first one. They are a record of what you have done, not
              something to chase.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {recentAchievements.map(({ def, at }) => (
                <li key={def.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <BadgeGlyph icon={def.icon} size={36} />
                  <div className="min-w-0">
                    <div className="truncate text-body font-semibold text-ink">{def.name}</div>
                    <div className="text-footnote text-ink3">{fmtDate(at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Recent sessions */}
      <SectionTitle
        right={
          state.sessions.length > 0 ? (
            <button onClick={() => go('stats')} className="-my-2 px-1 py-2 text-footnote font-medium text-ink3 hover:text-ink">
              Full history →
            </button>
          ) : undefined
        }
      >
        Recent sessions
      </SectionTitle>
      {recent.length === 0 ? (
        <div className="rounded-inner border border-dashed border-line-strong bg-surface/50 p-8 text-center">
          <Figure step="tuck" className="mx-auto h-16 w-20 text-ink3" />
          <div className="mt-2 text-body font-medium text-ink">Nothing logged yet</div>
          <p className="mx-auto mt-1 max-w-sm text-footnote text-ink2">
            Hit <span className="font-semibold text-ink">Start today's session</span> above — the app walks you through
            every set, times every hold, and logs it all.
          </p>
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-3">
          {recent.map((s) => {
            const hl = sessionHighlight(s)
            return (
              <div key={s.id} className="card-int rounded-inner border border-line bg-surface p-4 shadow-card">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="truncate text-body font-semibold text-ink">{s.workoutName}</div>
                  <div className="shrink-0 text-footnote text-ink3">{fmtDate(s.startedAt)}</div>
                </div>
                <div className="mt-1 text-footnote text-ink2 tnum">
                  {s.sets.length} sets
                  {hl ? (
                    <>
                      {' '}
                      · best {EXERCISE_BY_ID[hl.exerciseId]?.name.toLowerCase()} {fmtHold(hl.value)}
                    </>
                  ) : null}
                  {s.rpe ? ` · RPE ${s.rpe}` : ''}
                </div>
              </div>
            )
          })}
        </div>
      )}
        </div>
      </details>
      <Modal open={addingSkill} onClose={() => setAddingSkill(false)} label="Add a skill" wide>
        {addingSkill ? <AddSkill onClose={() => setAddingSkill(false)} onAdded={() => setAddingSkill(false)} /> : null}
      </Modal>
      <Modal open={measuringWalk} onClose={() => setMeasuringWalk(false)} label="Measure your walk back">
        <WalkBackCalibrator
          onDone={(sec) => {
            dispatch({ type: 'SET_SETTINGS', patch: { walkBackSec: sec } })
            setMeasuringWalk(false)
            pushToast(`Walk back set to ${sec.toFixed(1)}s for main Path holds. Change it any time in Settings.`, 'success')
          }}
        />
      </Modal>
    </div>
  )
}
