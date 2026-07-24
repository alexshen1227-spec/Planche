import { useMemo } from 'react'
import type { Tab, Workout } from '../types'
import { useStore } from '../lib/store'
import { STEP_BY_ID, stepAfter } from '../data/progressions'
import { EXERCISE_BY_ID } from '../data/exercises'
import { todaysSession, maxTestWorkout, TEMPLATES } from '../data/workouts'
import { tipOfTheDay } from '../data/tips'
import { ACHIEVEMENT_BY_ID } from '../data/achievements'
import { sessionsInWeekOf, weekStreak, totalHoldSec, sessionHighlight, paceToUnlock } from '../lib/stats'
import { addDays, dayKey, fmtDate, fmtDuration, fmtHold, weekStart } from '../lib/time'
import { Icon } from '../components/Icon'
import { Figure } from '../components/Figure'
import { ProgressRing, Stat, SectionTitle } from '../components/ui'

function WeekStrip({ trainedDays }: { trainedDays: Set<string> }) {
  const start = weekStart(Date.now())
  const today = dayKey(Date.now())
  const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  return (
    <div className="flex items-center gap-1.5">
      {letters.map((l, i) => {
        const k = dayKey(addDays(start, i))
        const trained = trainedDays.has(k)
        const isToday = k === today
        return (
          <div key={i} className="flex flex-col items-center gap-1">
            <span
              className={`grid h-5 w-5 place-items-center rounded-full text-[9.5px] font-bold ${
                trained
                  ? 'bg-accent text-on-accent'
                  : isToday
                    ? 'border-[1.5px] border-accent text-accent'
                    : 'border border-line text-ink3'
              }`}
            >
              {trained ? <Icon name="check" size={10} strokeWidth={3.5} /> : l}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function Dashboard({ startWorkout, go }: { startWorkout: (w: Workout) => void; go: (t: Tab) => void }) {
  const { state } = useStore()
  const step = STEP_BY_ID[state.stepId]
  const keyEx = EXERCISE_BY_ID[step.keyExerciseId]
  const best = state.prs[step.keyExerciseId]?.value ?? 0
  const unlockPct = Math.min(1, best / step.unlockSec)
  const next = stepAfter(state.stepId)

  const hour = new Date().getHours()
  const greeting = hour < 5 ? 'Burning the midnight oil' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const thisWeek = sessionsInWeekOf(state, Date.now()).length
  const goal = state.settings.weeklyGoal
  const streak = weekStreak(state)
  const tut = totalHoldSec(state)
  const trainedToday = state.sessions.some((s) => dayKey(s.startedAt) === dayKey(Date.now()))
  const tip = tipOfTheDay()
  const pace = paceToUnlock(state)

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
          <Icon name="flame" size={16} className={streak.weeks > 0 ? 'text-accent' : 'text-ink3'} />
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
              <div className="text-[12.5px] font-semibold uppercase tracking-wider text-accent">
                Step {step.order + 1} of 8 · current
              </div>
              <div className="font-display text-[24px] font-bold leading-tight text-ink">{step.name}</div>
              <div className="mt-0.5 text-[14px] text-ink2">{step.tagline}</div>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-between gap-5 sm:justify-end">
            <div className="sm:text-right">
              <div className="text-[13px] text-ink2">
                {keyEx.name} best{' '}
                <span className="font-semibold text-ink tnum">{best ? fmtHold(best) : '—'}</span>
              </div>
              <div className="text-[13px] text-ink2">
                {next ? (
                  <>
                    Hold <span className="font-semibold text-ink tnum">{step.unlockSec}s</span> to unlock{' '}
                    <span className="font-semibold text-ink">{next.name}</span>
                  </>
                ) : (
                  <>
                    Mastery bar: <span className="font-semibold text-ink tnum">{step.unlockSec}s</span> clean
                  </>
                )}
              </div>
              {pace && next ? (
                <div className="mt-0.5 text-[12.5px] font-medium text-accent">
                  {pace.weeks === 0
                    ? 'Attempt ready — you can clear this bar. Test it.'
                    : `On pace to unlock in ~${pace.weeks} week${pace.weeks === 1 ? '' : 's'}`}
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
      </div>

      {/* Recovery nudge on trained days */}
      {trainedToday ? (
        <div className="animate-rise mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ok/25 bg-ok-soft px-5 py-3.5" style={{ animationDelay: '40ms' }}>
          <div className="flex items-center gap-2.5 text-[14px] text-ink">
            <Icon name="check" size={16} className="text-ok" />
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
        <div className="flex items-center justify-between rounded-2xl border border-line bg-surface p-4 shadow-card">
          <div>
            <div className="text-[13px] font-medium text-ink3">This week</div>
            <div className="mt-1 font-display text-[26px] font-semibold leading-tight text-ink tnum">
              {thisWeek}
              <span className="text-[15px] text-ink3">/{goal}</span>
            </div>
            <div className="mt-2">
              <WeekStrip trainedDays={trainedDays} />
            </div>
          </div>
          <ProgressRing value={thisWeek / Math.max(1, goal)} size={52} stroke={6} />
        </div>
        <Stat
          label="Week streak"
          value={<span className="tnum">{streak.weeks}</span>}
          sub={streak.currentMet ? 'this week is banked' : `${Math.max(0, goal - thisWeek)} more to keep it`}
        />
        <Stat label="Time under tension" value={fmtDuration(tut)} sub="all holds, all time" />
        <Stat
          label="Sessions"
          value={<span className="tnum">{state.sessions.length}</span>}
          sub={fmtDate(state.startedAt) === 'Today' ? 'started today' : `since ${fmtDate(state.startedAt)}`}
        />
      </div>

      {/* Tip + achievements */}
      <div className="animate-rise mt-4 grid gap-3 lg:grid-cols-2" style={{ animationDelay: '140ms' }}>
        <div className="card-sheen rounded-2xl border border-line bg-surface p-5 shadow-card">
          <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-accent">
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
            <button onClick={() => go('stats')} className="text-[13px] font-medium text-ink3 hover:text-ink">
              All →
            </button>
          </div>
          {recentAchievements.length === 0 ? (
            <p className="mt-3 text-[13.5px] text-ink2">
              None yet — your first session unlocks the first one. No pressure. (Some pressure.)
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
            <button onClick={() => go('stats')} className="text-[13px] font-medium text-ink3 hover:text-ink">
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
