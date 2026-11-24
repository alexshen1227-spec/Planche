import { lazy, startTransition, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { CheckIn, Tab, Workout, WorkoutRequest } from './types'
import { useStore } from './lib/store'
import { loadDraft } from './lib/draft'
import { resumeSkillWorkout } from './lib/resumeSkillWorkout'
import { pushToast } from './lib/toast'
import { finalizeWorkout, finalizeWorkoutWithPlan, requestFor } from './data/workouts'
import { LONG_GAP_DAYS } from './lib/signals'
import type { CoachPlan } from './lib/coach'
import { MeasurePrompt, measurementDue } from './components/MeasurePrompt'
import { pruneClips } from './lib/clips'
import { syncMilestonePins } from './lib/highlights'
import { Icon, type IconName } from './components/Icon'
import type { CheckInContext } from './views/SessionPlayer'
import { APP_NAME } from './data/app'
import { legacyOpenerLifts, readDayMarks } from './lib/plan/nextBlock'
import type { GymEntry } from './lib/plan/screens'
import { Dashboard } from './views/Dashboard'

/**
 * The update log is the largest single file in the app and only one page
 * reads it, so it loads when that page opens rather than with every launch.
 */
const Updates = lazy(() => import('./views/Updates').then((m) => ({ default: m.Updates })))

// The service worker keeps these screens available offline. Only download and
// evaluate the screen an athlete opens, warming a tab when they focus or touch it.
const routes = {
  train: () => import('./views/Train').then((m) => ({ default: m.Train })),
  path: () => import('./views/Path').then((m) => ({ default: m.Path })),
  library: () => import('./views/Library').then((m) => ({ default: m.Library })),
  stats: () => import('./views/Stats').then((m) => ({ default: m.Stats })),
  settings: () => import('./views/Settings').then((m) => ({ default: m.Settings })),
}
const Train = lazy(routes.train)
const Path = lazy(routes.path)
const Library = lazy(routes.library)
const Stats = lazy(routes.stats)
const Settings = lazy(routes.settings)
const SessionPlayer = lazy(() => import('./views/SessionPlayer').then((m) => ({ default: m.SkillWorkoutGate })))
function warmTab(next: Tab) {
  if (next !== 'home' && next !== 'updates') void routes[next]().catch(() => undefined)
}

const NAV: { tab: Tab; label: string; icon: IconName }[] = [
  { tab: 'home', label: 'Home', icon: 'home' },
  { tab: 'train', label: 'Train', icon: 'bolt' },
  { tab: 'path', label: 'Path', icon: 'route' },
  { tab: 'library', label: 'Learn', icon: 'book' },
  { tab: 'stats', label: 'Progress', icon: 'chart' },
  { tab: 'settings', label: 'Settings', icon: 'sliders' },
]

/** What the readiness question should remind the athlete of, from today's plan. */
function checkInContextFor(plan: CoachPlan): CheckInContext {
  const concern = plan.openConcern
  const where = (concern?.regions ?? []).filter((r) => r !== 'other').map((r) => r.replace('-', ' '))
  const what = concern ? `${where.length ? `${where.join(' and ')} ` : ''}${concern.joints === 'pain' ? 'pain' : 'a niggle'}` : ''
  const days = plan.signals.daysSinceCheckIn
  return {
    ...(concern
      ? {
          concern:
            concern.source === 'onboarding'
              ? `At setup you reported ${what}. Answer for today — the plan leaves out what loads a painful area.`
              : concern.source === 'attempt'
                ? `You reported ${what} during your last session. How is it now?`
                : `Your last report${days ? ` (${days} day${days === 1 ? '' : 's'} ago)` : ''} was ${what}. How is it now?`,
        }
      : {}),
    ...(plan.signals.totalSessions > 0 && plan.signals.restDays >= LONG_GAP_DAYS
      ? { gapDays: plan.signals.restDays }
      : {}),
  }
}

export default function TrainingApp({ bench, onWorkoutChange }: { bench: ReactNode; onWorkoutChange: (open: boolean) => void }) {
  const { state, dispatch } = useStore()
  const [tab, setTabNow] = useState<Tab>('home')
  const [gymEntry, setGymEntry] = useState<GymEntry | null>(null)
  // A transition keeps the current screen on show while a lazy one loads,
  // rather than flashing a placeholder over the whole page.
  const setTab = (next: Tab) => startTransition(() => setTabNow(next))
  // An interrupted session (phone slept, tab discarded) is picked back up
  // automatically on the next load instead of being silently lost.
  const [resumeDraft] = useState(() => loadDraft(Date.now(), state.epoch))
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(() => {
    const workout = resumeDraft?.workout
    if (!workout) return null
    const older = !workout.request?.gymAfter && legacyOpenerLifts()
    return older ? { ...workout, request: { ...requestFor(workout), gymAfter: older } } : workout
  })
  useLayoutEffect(() => { onWorkoutChange(Boolean(activeWorkout)) }, [activeWorkout, onWorkoutChange])
  const [resuming, setResuming] = useState(resumeDraft !== null)

  const [askCheckIn, setAskCheckIn] = useState(false)
  /** A just-saved session to open in History, from the celebration screen. */
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null)
  const [checkInContext, setCheckInContext] = useState<CheckInContext>({})

  // Updates has no nav entry of its own; it lives under Settings, so Settings
  // stays lit while you are reading it rather than nothing being selected.
  const navTab: Tab = tab === 'updates' ? 'settings' : tab
  const navigation = state.gym?.prefs?.goals.skills === 0 && !state.sessions.length ? NAV.filter((item) => item.tab !== 'path') : NAV

  // Each tab is a page, even though the app does not navigate to a new URL.
  // Resetting scroll prevents a long Progress/Settings page from opening the
  // next tab halfway down its content.
  useEffect(() => {
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [tab])

  // Keep each step's milestone clips pinned (lib/highlights), then sweep
  // expired footage once per launch so storage does not creep up over months.
  // Only once saved history is loaded: a sync against a still-empty state would
  // unpin every milestone, and the sweep straight after would delete them.
  const swept = useRef(false)
  useEffect(() => {
    const sync = syncMilestonePins(state).catch(() => undefined)
    if (!swept.current) {
      swept.current = true
      void sync.then(() => pruneClips())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sessions])
  // Asked once on open when it comes due, never mid-workout.
  const [showMeasure, setShowMeasure] = useState(false)
  useEffect(() => {
    // Guarded on activeWorkout in the deps as well as the condition: the
    // timer previously fired over a session started within the delay, which
    // covered the player and blocked the key that stops a hold.
    if (!state.onboarded || activeWorkout || !measurementDue(state).weight) return
    const t = window.setTimeout(() => setShowMeasure(true), 900)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.onboarded, activeWorkout])

  /**
   * Start what the athlete asked for, decided *now*.
   *
   * Screens pass a request, not a workout they built earlier: a plan memoised
   * yesterday, or a preview opened before a check-in, must not be what runs.
   */
  const startWorkout = (request: WorkoutRequest) => {
    setResuming(false)
    const now = Date.now()
    const session = request.resumeSessionId ? resumeSkillWorkout(state, request.resumeSessionId, undefined, now) : finalizeWorkoutWithPlan(state, request, undefined, now)
    if (!session) {
      pushToast('This session has no working rounds available here right now. Check its saved workout, equipment and readiness before continuing.', 'info')
      return
    }
    const { workout, plan } = session
    // Asked on every kind of session when due — a check-in before a template
    // still feeds the rails and the record. A test always asks: a maximal
    // effort needs today's answer, not last week's.
    setAskCheckIn(Boolean(request.resumeSessionId) || request.source === 'test' || plan.askCheckIn)
    setCheckInContext(checkInContextFor(plan))
    setActiveWorkout(workout)
  }

  if (bench) return bench

  return (
    <div className="app-ambient grain min-h-screen">
      <div
        aria-hidden={activeWorkout ? true : undefined}
        inert={activeWorkout ? true : undefined}
        className="mx-auto flex w-full max-w-6xl gap-6 px-4 pb-24 pt-5 sm:px-6 lg:pb-10 lg:pt-8"
      >
        {/* Sidebar (desktop) */}
        <aside className="sticky top-8 hidden h-fit w-52 shrink-0 lg:block">
          <div className="mb-8 flex items-center gap-2.5 px-2">
            <div
              className="grid h-9 w-9 place-items-center rounded-control text-on-accent bg-accent"

            >
              {/* tiny planche glyph */}
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <circle cx="18.5" cy="9" r="2.6" fill="currentColor" />
                <rect x="2.5" y="10.5" width="13.5" height="3.2" rx="1.6" fill="currentColor" />
                <rect x="8.5" y="13.5" width="3" height="7" rx="1.5" fill="currentColor" />
              </svg>
            </div>
            <div>
              <div className="font-display text-title3 font-bold leading-tight text-ink">{APP_NAME}</div>
              <div className="text-caption font-medium text-ink3">own the hold</div>
            </div>
          </div>
          <nav className="space-y-1">
            {navigation.map((n) => (
              <button
                key={n.tab}
                onFocus={() => warmTab(n.tab)}
                onPointerEnter={() => warmTab(n.tab)}
                onClick={() => setTab(n.tab)}
                aria-label={n.label}
                aria-current={navTab === n.tab ? 'page' : undefined}
                className={`flex w-full items-center gap-3 rounded-control px-3.5 py-2.5 text-body font-medium transition ${
                  navTab === n.tab
                    ? 'bg-surface text-ink shadow-card border border-line'
                    : 'border border-transparent text-ink2 hover:bg-surface/60 hover:text-ink'
                }`}
              >
                <Icon name={n.icon} size={18} className={navTab === n.tab ? 'text-accent-text' : ''} />
                {n.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <main className="min-w-0 flex-1">
          {/* Mobile header */}
          <div className="mb-5 flex items-center gap-2.5 lg:hidden">
            <div
              className="grid h-8 w-8 place-items-center rounded-lg text-on-accent bg-accent"

            >
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                <circle cx="18.5" cy="9" r="2.6" fill="currentColor" />
                <rect x="2.5" y="10.5" width="13.5" height="3.2" rx="1.6" fill="currentColor" />
                <rect x="8.5" y="13.5" width="3" height="7" rx="1.5" fill="currentColor" />
              </svg>
            </div>
            <span className="font-display text-title3 font-bold text-ink">{APP_NAME}</span>
          </div>

          <Suspense fallback={<div role="status" className="p-6 text-footnote text-ink3">Opening your training…</div>}>
          {tab === 'home' ? (
            <Dashboard
              startWorkout={startWorkout}
              startGym={(preset) => {
                setGymEntry(preset)
                setTab('train')
              }}
              go={setTab}
              viewSession={(sessionId) => {
                setFocusSessionId(sessionId)
                setTab('stats')
              }}
            />
          ) : null}
          {tab === 'train' ? <Train startWorkout={startWorkout} entryPreset={gymEntry} onEntryUsed={() => setGymEntry(null)} /> : null}
          {tab === 'path' ? <Path startWorkout={startWorkout} /> : null}
          {tab === 'library' ? <Library /> : null}
          {tab === 'stats' ? <Stats focusSessionId={focusSessionId} onFocused={() => setFocusSessionId(null)} /> : null}
          {tab === 'settings' ? <Settings go={setTab} /> : null}
          {tab === 'updates' ? <Updates go={setTab} /> : null}
          </Suspense>
        </main>
      </div>

      {/* Bottom tab bar (mobile) */}
      <nav
        aria-hidden={activeWorkout ? true : undefined}
        inert={activeWorkout ? true : undefined}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur-lg lg:hidden"
      >
        <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5">
          {navigation.map((n) => (
            <button
              key={n.tab}
              onFocus={() => warmTab(n.tab)}
              onPointerDown={() => warmTab(n.tab)}
              onClick={() => setTab(n.tab)}
              aria-label={n.label}
              aria-current={navTab === n.tab ? 'page' : undefined}
              className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-control px-1 py-1.5 text-caption font-medium transition ${
                navTab === n.tab
                  ? 'bg-accent-soft text-accent-text shadow-[inset_0_0_0_1px_var(--t-line)]'
                  : 'text-ink3 hover:bg-raised hover:text-ink2'
              }`}
            >
              <Icon name={n.icon} size={21} />
              <span className="w-full truncate text-center">{n.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <MeasurePrompt open={showMeasure && !activeWorkout} onClose={() => setShowMeasure(false)} />
      {activeWorkout ? (
        <Suspense fallback={<div role="status" className="fixed inset-0 z-50 grid place-items-center bg-bg px-5 text-body text-ink2">Opening your session…</div>}>
        <SessionPlayer
          workout={activeWorkout}
          resumeFrom={resuming ? resumeDraft : null}
          askCheckIn={askCheckIn}
          checkInContext={checkInContext}
          onCheckInAnswered={(c: CheckIn) => {
            // Recorded the moment it is given, not only on the saved session:
            // a pain answer followed by a discarded session used to vanish.
            dispatch({
              type: 'RECORD_SYMPTOM',
              event: {
                at: c.at,
                joints: c.joints,
                ...(c.regions?.length ? { regions: c.regions } : {}),
                energy: c.energy,
                source: 'check-in',
              },
            })
            // Nothing is logged yet at this point, so the session can be
            // safely rebuilt — from the same request, so a 15-minute version
            // stays a 15-minute version after the answer.
            const request = requestFor(activeWorkout)
            setActiveWorkout(request.resumeSessionId ? resumeSkillWorkout(state, request.resumeSessionId, c)?.workout ?? null : finalizeWorkout(state, request, c))
          }}
          onExit={(savedSessionId) => {
            setResuming(false)
            setAskCheckIn(false)
            setActiveWorkout(null)
            if (savedSessionId && readDayMarks().openerSessionId === savedSessionId) setTab('train')
          }}
          onViewSession={(sessionId) => {
            setResuming(false)
            setAskCheckIn(false)
            setActiveWorkout(null)
            setFocusSessionId(sessionId)
            setTab('stats')
          }}
        />
        </Suspense>
      ) : null}
    </div>
  )
}
