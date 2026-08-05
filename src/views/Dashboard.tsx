import { useMemo } from 'react'
import type { Tab, Workout } from '../types'
import { useStore } from '../lib/store'
import { STEP_BY_ID, stepAfter } from '../data/progressions'
import { EXERCISE_BY_ID } from '../data/exercises'
import { todaysSession, maxTestWorkout, TEMPLATES } from '../data/workouts'
import { tipOfTheDay } from '../data/tips'
import { ACHIEVEMENT_BY_ID } from '../data/achievements'
import { sessionsInWeekOf, weekStreak, totalHoldSec, sessionHighlight } from '../lib/stats'
import { buildPlan, STRATEGY_BY_ID, coachConfidence } from '../lib/coach'
import { CONFIDENCE_NOTE, describeForecast, forecastUnlock, goalOutlook } from '../lib/forecast'
import { PLATEAU_LABEL, recentBreakthrough } from '../lib/plateau'
import { qualifyingProgress } from '../lib/progression'
import { addDays, dayKey, fmtDate, fmtDuration, fmtHold, weekStart } from '../lib/time'
import { exportData } from '../lib/exportImport'
import { pushToast } from '../lib/toast'
import { Icon } from '../components/Icon'
import { Figure } from '../components/Figure'
import { ProgressRing, Stat, SectionTitle } from '../components/ui'

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

export function Dashboard({ startWorkout, go }: { startWorkout: (w: Workout) => void; go: (t: Tab) => void }) {
  const { state, dispatch } = useStore()
  const step = STEP_BY_ID[state.stepId]
  const keyEx = EXERCISE_BY_ID[step.keyExerciseId]
  const prBest = state.prs[step.keyExerciseId]?.value ?? 0
  const qualified = qualifyingProgress(state, state.stepId)
  const best = qualified.value
  const unlockPct = Math.min(1, best / step.unlockSec)
  const next = stepAfter(state.stepId)
  const goalStep = STEP_BY_ID[state.profile.goalStepId ?? 'straddle']

  const hour = new Date().getHours()
  const greeting = hour < 5 ? 'Burning the midnight oil' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const thisWeek = sessionsInWeekOf(state, Date.now()).length
  const goal = state.settings.weeklyGoal
  const streak = weekStreak(state)
  const tut = totalHoldSec(state)
  const trainedToday = state.sessions.some((s) => dayKey(s.startedAt) === dayKey(Date.now()))
  const tip = tipOfTheDay()
  const forecast = useMemo(() => forecastUnlock(state), [state])
  const outlook = useMemo(() => goalOutlook(state), [state])
  const plan = useMemo(() => buildPlan(state), [state])
  const breakthrough = useMemo(() => recentBreakthrough(state), [state])
  const confidence = useMemo(() => coachConfidence(state), [state])
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
  const trainedDays = useMemo(() => new Set(state.sessions.map((s) => dayKey(s.startedAt))), [state.sessions])
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
          <h1 className="font-display text-[28px] font-bold leading-tight text-ink">
            {greeting}
            {state.name ? `, ${state.name}` : ''}
          </h1>
          <p className="mt-0.5 text-[14px] text-ink2">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            {trainedToday ? ' · trained today ✓' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-[13.5px] font-medium text-ink2">
          <Icon name="flame" size={16} className={streak.weeks > 0 ? 'text-accent-text' : 'text-ink3'} />
          <span className="tnum">
            {streak.weeks} week{streak.weeks === 1 ? '' : 's'} streak
          </span>
        </div>
      </div>

      {/* Current step hero */}
      <div className="card-sheen relative mt-5 overflow-hidden rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-7">
        <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-accent-soft blur-2xl" />
        <div className="pointer-events-none absolute -left-16 -bottom-20 h-48 w-48 rounded-full blur-3xl" style={{ background: 'var(--t-glow2)' }} />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-5">
            <Figure step={step.id} className="h-28 w-32 shrink-0 text-ink animate-floaty" />
            <div>
              <div className="text-[12.5px] font-semibold uppercase tracking-wider text-accent-text">
                Step {step.order + 1} of 8 · current
                {goalStep.order > step.order ? ` · goal ${goalStep.name}` : ' · goal reached'}
              </div>
              <div className="font-display text-[24px] font-bold leading-tight text-ink">{step.name}</div>
              <div className="mt-0.5 text-[14px] text-ink2">{step.tagline}</div>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-between gap-5 sm:justify-end">
            <div className="sm:text-right">
              <div className="text-[13px] text-ink2">
                {keyEx.name} verified best{' '}
                <span className="font-semibold text-ink tnum">{best ? fmtHold(best) : '—'}</span>
                {prBest > best ? <span className="text-ink3"> · PR {fmtHold(prBest)}</span> : null}
              </div>
              <div className="text-[13px] text-ink2">
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
                <div className="mt-1 sm:flex sm:justify-end">
                  <div className="max-w-xs sm:text-right">
                    {forecast.kind === 'ready' ? (
                      <span className="text-[12.5px] font-medium text-accent-text">
                        Attempt ready — you have already held this bar. Test it.
                      </span>
                    ) : forecast.kind === 'range' ? (
                      <>
                        <span className="text-[12.5px] font-medium text-accent-text">
                          {describeForecast(forecast)} at your measured rate
                        </span>
                        <div className="mt-0.5 text-[11.5px] leading-relaxed text-ink3">
                          {CONFIDENCE_NOTE[forecast.confidence]}
                        </div>
                      </>
                    ) : forecast.kind === 'not-trending' ? (
                      // The module's own `basis` rather than a hardcoded
                      // sentence: three different situations land here — flat,
                      // falling, and climbing too slowly to date — and calling
                      // all three "flat" told some athletes the opposite of
                      // what their own data said.
                      <span className="text-[12.5px] leading-relaxed text-ink3">{forecast.basis}</span>
                    ) : (
                      <span className="text-[12.5px] leading-relaxed text-ink3">
                        No forecast yet — {forecast.need}
                      </span>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <ProgressRing value={unlockPct} size={76} stroke={7}>
              <span className="font-display text-[16px] font-bold text-ink tnum">{Math.round(unlockPct * 100)}%</span>
            </ProgressRing>
          </div>
        </div>
        <div className="relative mt-6 flex flex-wrap gap-2.5">
          <button
            onClick={() => startWorkout(todaysSession(state))}
            className="glow-accent inline-flex items-center gap-2 rounded-xl px-5 py-3 font-display text-[15px] font-semibold text-on-accent transition hover:brightness-105 active:scale-[0.99]"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            <Icon name="play" size={16} /> Start today's session
          </button>
          <button
            onClick={() => startWorkout(maxTestWorkout(state.stepId))}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-raised px-5 py-3 text-[15px] font-medium text-ink transition hover:border-line-strong"
          >
            <Icon name="target" size={16} /> Max test
          </button>
          <button
            onClick={() => go('path')}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-3 text-[14px] font-medium text-ink2 transition hover:text-ink"
          >
            View the road <Icon name="chevronR" size={15} />
          </button>
        </div>
        {/* Re-scope today rather than re-plan the week. The realistic
            alternative to "I've got twenty minutes" is training nothing, and a
            skipped session teaches the coach nothing either. */}
        {state.settings.sessionMinutes > 18 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-ink3">Short on time?</span>
            {[15, 20].map((m) => (
              <button
                key={m}
                onClick={() => startWorkout(todaysSession(state, plan, m))}
                className="rounded-lg border border-line bg-raised px-3 py-1.5 font-medium text-ink2 transition hover:border-line-strong hover:text-ink"
              >
                {m} min version
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* A named stall, or a real jump. Neither is filler: the card only
          exists when the log supports one, so an athlete who is simply
          progressing normally never sees it. */}
      {plan.plateau ? (
        <div
          className="animate-rise mt-4 rounded-2xl border border-line bg-surface p-5 shadow-card"
          style={{ animationDelay: '20ms' }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-ink3">
              <Icon name="chart" size={15} />
              {plan.plateau.status === 'regressing' ? 'Going backwards' : 'Plateau'}
            </span>
            <span className="rounded-full border border-line bg-raised px-3 py-1 text-[12.5px] font-semibold text-ink2">
              {PLATEAU_LABEL[plan.plateau.cause]}
            </span>
            <span className="text-[12.5px] text-ink3">
              {plan.plateau.confidence === 'good'
                ? 'confident read'
                : plan.plateau.confidence === 'moderate'
                  ? 'likely cause'
                  : 'best guess'}
            </span>
          </div>
          <h2 className="mt-2 font-display text-[17px] font-semibold text-ink">
            {plan.plateau.weeksFlat} week{plan.plateau.weeksFlat === 1 ? '' : 's'} without moving the{' '}
            {keyEx.name.toLowerCase()}
          </h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink2">{plan.plateau.evidence}</p>
          {plan.loadPermission === 'none' ? (
            // What they reported outranks the plateau. Showing the "do more"
            // prescription beside a rest day would be the plan contradicting
            // itself on the one screen where it should be clearest.
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">
              Worth fixing, but not today — what you reported in your check-in comes first. This returns as soon as
              you are training loaded again.
            </p>
          ) : (
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">{plan.plateau.intervention}</p>
          )}
          {plan.plateau.suggestMaxTest && plan.loadPermission !== 'none' ? (
            <button
              onClick={() => startWorkout(maxTestWorkout(state.stepId))}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-line bg-raised px-4 py-2.5 text-[13.5px] font-medium text-ink transition hover:border-line-strong"
            >
              <Icon name="target" size={15} /> Run a max test
            </button>
          ) : null}
        </div>
      ) : breakthrough ? (
        <div
          className="animate-rise mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-ok/25 bg-ok-soft px-5 py-3.5"
          style={{ animationDelay: '20ms' }}
        >
          <Icon name="sparkle" size={17} className="shrink-0 text-ok-text" />
          <span className="text-[14px] leading-relaxed text-ink">
            <span className="font-semibold">
              Your verified {keyEx.name.toLowerCase()} is up {breakthrough.gainSec}s
            </span>{' '}
            on where it sat a month ago. That is real, camera-checked progress rather than a stopwatch number.
          </span>
        </div>
      ) : null}

      {/* Backup nudge once real history has accumulated */}
      {state.sessions.length >= 8 &&
      (!state.lastBackupAt || Date.now() - state.lastBackupAt > 30 * 86_400_000) ? (
        <div className="animate-rise mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-3.5" style={{ animationDelay: '20ms' }}>
          <div className="flex items-center gap-2.5 text-[14px] text-ink2">
            <Icon name="download" size={16} className="text-ink3" />
            <span>
              <span className="font-semibold text-ink">{state.sessions.length} sessions</span> live only on this
              device. Keep a copy somewhere safe.
            </span>
          </div>
          <button
            onClick={() => {
              const stamped = { ...state, lastBackupAt: Date.now() }
              exportData(stamped)
              dispatch({ type: 'REPLACE', state: stamped })
              pushToast('Backup exported.', 'success')
            }}
            className="rounded-lg border border-line bg-raised px-3.5 py-2 text-[13px] font-medium text-ink2 transition hover:text-ink"
          >
            Export backup
          </button>
        </div>
      ) : null}

      {/* Recovery nudge on trained days */}
      {trainedToday ? (
        <div className="animate-rise mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ok/25 bg-ok-soft px-5 py-3.5" style={{ animationDelay: '40ms' }}>
          <div className="flex items-center gap-2.5 text-[14px] text-ink">
            <Icon name="check" size={16} className="text-ok-text" />
            <span>
              <span className="font-semibold">Today is banked.</span> Recovery counts too — happy wrists hold longer.
            </span>
          </div>
          <button
            onClick={() => {
              const w = TEMPLATES.find((t) => t.id === 'wrist-armor')
              if (w) startWorkout(w)
            }}
            className="rounded-lg border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-ink2 transition hover:text-ink"
          >
            10-min Wrist Armor →
          </button>
        </div>
      ) : null}

      {/* Stats */}
      <div className="animate-rise mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" style={{ animationDelay: '80ms' }}>
        {/* Ring beside the count, strip across the full width beneath it —
            sharing one row left the strip a sliver of the card to live in. */}
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-ink3">This week</div>
              <div className="mt-1 font-display text-[26px] font-semibold leading-tight text-ink tnum">
                {thisWeek}
                <span className="text-[15px] text-ink3">/{goal}</span>
              </div>
            </div>
            <ProgressRing value={thisWeek / Math.max(1, goal)} size={52} stroke={6} />
          </div>
          <div className="mt-3">
            <WeekStrip trainedDays={trainedDays} />
          </div>
        </div>
        <Stat
          label="Week streak"
          value={<span className="tnum">{streak.weeks}</span>}
          // "N more to keep it" frames training as defending something you are
          // about to lose — and the displayed streak already counts the
          // in-progress week, so part of what it threatened had not been
          // earned. The North Star puts streak preservation below actually
          // training, so this states the fact and drops the loss frame.
          sub={
            streak.currentMet
              ? 'this week is banked'
              : `${Math.max(0, goal - thisWeek)} more this week to meet your goal`
          }
        />
        <Stat label="Time under tension" value={fmtDuration(tut)} sub="all holds, all time" />
        <Stat
          label="Sessions"
          value={<span className="tnum">{state.sessions.length}</span>}
          sub={fmtDate(state.startedAt) === 'Today' ? 'started today' : `since ${fmtDate(state.startedAt)}`}
        />
      </div>

      {/* Coach */}
      <div className="animate-rise card-sheen mt-4 rounded-2xl border border-line bg-surface p-5 shadow-card" style={{ animationDelay: '110ms' }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-accent-text">
              <Icon name="target" size={15} /> Coach
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-accent-soft px-3 py-1 text-[13px] font-semibold text-accent-text">
                {STRATEGY_BY_ID[plan.strategy].name}
              </span>
              {plan.limiter ? (
                <span className="rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-[12.5px] font-semibold text-accent-text">
                  Limiter: {plan.limiter.label}
                </span>
              ) : null}
              <span className="rounded-full border border-line bg-raised px-3 py-1 text-[12.5px] font-medium text-ink2">
                {plan.warmup === 'extended' ? 'Full warm-up' : plan.warmup === 'short' ? 'Short warm-up' : 'Standard warm-up'}
              </span>
              <span className="rounded-full border border-line bg-raised px-3 py-1 text-[12.5px] font-medium text-ink2 tnum">
                {Math.floor(plan.restMainSec / 60)}:{String(plan.restMainSec % 60).padStart(2, '0')} rest
              </span>
            </div>
            <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-ink2">{plan.strategyReason}</p>
            {plan.limiter ? (
              <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-ink3">
                {plan.limiter.evidence} {plan.limiter.prescription}
              </p>
            ) : null}
            <ul className="mt-2 space-y-1.5">
              {topDecisions.map((d) => (
                <li key={d.text} className="flex gap-2 text-[13px] leading-relaxed">
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
          <button
            onClick={() => go('stats')}
            className="shrink-0 rounded-lg border border-line bg-raised px-3 py-2 text-[12.5px] font-medium text-ink2 transition hover:text-ink"
          >
            What it learned →
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink3">
          <div className="h-1 w-24 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent/70"
              style={{ width: `${Math.min(100, (confidence.evaluated / 12) * 100)}%` }}
            />
          </div>
          <span className="tnum">
            {confidence.evaluated === 0
              ? 'Learning starts after your first couple of sessions'
              : `${confidence.evaluated} session${confidence.evaluated === 1 ? '' : 's'} measured · ${confidence.tested}/5 approaches tested`}
          </span>
        </div>
      </div>

      {/* Where the road ends, and how honestly far that is */}
      <div
        className="animate-rise mt-4 rounded-2xl border border-line bg-surface p-5 shadow-card"
        style={{ animationDelay: '125ms' }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-ink3">
              <Icon name="route" size={15} /> Your goal
            </div>
            {/* The separator is a real space, not only the `ml-2` margin: a
                screen reader reads the concatenated text, and without it this
                announced as "Straddle Planche3 steps to go". */}
            <h2 className="mt-1.5 font-display text-[17px] font-semibold text-ink">
              {STEP_BY_ID[outlook.goalStepId].name}
              {outlook.stepsRemaining > 0 ? (
                <>
                  {' '}
                  <span className="ml-1 text-[13.5px] font-medium text-ink2">
                    · {outlook.stepsRemaining} step{outlook.stepsRemaining === 1 ? '' : 's'} to go
                  </span>
                </>
              ) : null}
            </h2>
            {outlook.estimate ? (
              <div className="mt-1 text-[13.5px] font-medium text-accent-text">
                Roughly {outlook.estimate.lowWeeks}–{outlook.estimate.highWeeks} weeks at your own measured pace
              </div>
            ) : null}
            <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-ink3">{outlook.note}</p>
          </div>
          <button
            onClick={() => go('path')}
            className="shrink-0 rounded-lg border border-line bg-raised px-3 py-2 text-[12.5px] font-medium text-ink2 transition hover:text-ink"
          >
            Change goal →
          </button>
        </div>
      </div>

      {/* Tip + achievements */}
      <div className="animate-rise mt-4 grid gap-3 lg:grid-cols-2" style={{ animationDelay: '140ms' }}>
        <div className="card-sheen rounded-2xl border border-line bg-surface p-5 shadow-card">
          <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-accent-text">
            <Icon name="sparkle" size={15} /> Coach's tip
          </div>
          <div className="mt-2 text-[15px] font-semibold text-ink">{tip.title}</div>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink2">{tip.body}</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-ink3">
              <Icon name="trophy" size={15} /> Latest achievements
            </div>
            <button onClick={() => go('stats')} className="-my-2 px-1 py-2 text-[13px] font-medium text-ink3 hover:text-ink">
              All →
            </button>
          </div>
          {recentAchievements.length === 0 ? (
            <p className="mt-3 text-[13.5px] text-ink2">
              None yet — your first session unlocks the first one. They are a record of what you have done, not
              something to chase.
            </p>
          ) : (
            <div className="mt-3 space-y-2.5">
              {recentAchievements.map(({ def, at }) => (
                <div key={def.id} className="flex items-center gap-3">
                  <span className="text-[22px]">{def.icon}</span>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-semibold text-ink">{def.name}</div>
                    <div className="text-[12.5px] text-ink3">{fmtDate(at)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent sessions */}
      <SectionTitle
        right={
          state.sessions.length > 0 ? (
            <button onClick={() => go('stats')} className="-my-2 px-1 py-2 text-[13px] font-medium text-ink3 hover:text-ink">
              Full history →
            </button>
          ) : undefined
        }
      >
        Recent sessions
      </SectionTitle>
      {recent.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface/50 p-8 text-center">
          <Figure step="tuck" className="mx-auto h-16 w-20 text-ink3" />
          <div className="mt-2 text-[15px] font-medium text-ink">Nothing logged yet</div>
          <p className="mx-auto mt-1 max-w-sm text-[13.5px] text-ink2">
            Hit <span className="font-semibold text-ink">Start today's session</span> above — the app walks you through
            every set, times every hold, and logs it all.
          </p>
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-3">
          {recent.map((s) => {
            const hl = sessionHighlight(s)
            return (
              <div key={s.id} className="card-int rounded-2xl border border-line bg-surface p-4 shadow-card">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="truncate text-[14px] font-semibold text-ink">{s.workoutName}</div>
                  <div className="shrink-0 text-[12.5px] text-ink3">{fmtDate(s.startedAt)}</div>
                </div>
                <div className="mt-1 text-[13px] text-ink2 tnum">
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
  )
}
