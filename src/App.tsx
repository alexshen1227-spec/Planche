import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import type { CheckIn, Tab, Workout, WorkoutRequest } from './types'
import { quarantinedData, useStore } from './lib/store'
import { loadDraft } from './lib/draft'
import { finalizeWorkout, finalizeWorkoutWithPlan, requestFor } from './data/workouts'
import { LONG_GAP_DAYS } from './lib/signals'
import type { CoachPlan } from './lib/coach'
import { MeasurePrompt, measurementDue } from './components/MeasurePrompt'
import { pruneClips } from './lib/clips'
import { exportData } from './lib/exportImport'
import { Icon, type IconName } from './components/Icon'
import { Toasts } from './components/Toasts'
import { Dashboard } from './views/Dashboard'
import { Train } from './views/Train'
import { Path } from './views/Path'
import { Library } from './views/Library'
import { Stats } from './views/Stats'
import { Settings } from './views/Settings'
import { Updates } from './views/Updates'
import { Onboarding } from './views/Onboarding'
import { SessionPlayer, type CheckInContext } from './views/SessionPlayer'

/**
 * A bench for the camera form judge, reached at #devlab.
 *
 * Code-split deliberately: it pulls in the synthetic pose generator and a pile
 * of controls that no workout ever needs, and none of that should sit in the
 * bundle an athlete downloads on a phone at the gym.
 */
const DevLab = lazy(() => import('./views/DevLab'))

function useDevLabRoute(): boolean {
  const [open, setOpen] = useState(() => window.location.hash === '#devlab')
  useEffect(() => {
    const sync = () => setOpen(window.location.hash === '#devlab')
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])
  return open
}

/**
 * Fallback updater for browsers without service workers: poll the deployed
 * version.json for a build id different from the one baked into this bundle.
 */
function useVersionJsonCheck(enabled: boolean): boolean {
  const [stale, setStale] = useState(false)
  useEffect(() => {
    if (!enabled || !import.meta.env.PROD) return
    let stopped = false
    const check = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { build?: string }
        if (!stopped && data.build && data.build !== __BUILD_ID__) setStale(true)
      } catch {
        /* offline — try again next interval */
      }
    }
    void check()
    const iv = window.setInterval(() => void check(), 5 * 60_000)
    const onFocus = () => {
      if (document.visibilityState === 'visible') void check()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      stopped = true
      window.clearInterval(iv)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [enabled])
  return stale
}

const HAS_SW = 'serviceWorker' in navigator

function UpdateBanner({ defer = false }: { defer?: boolean }) {
  const regRef = useRef<ServiceWorkerRegistration | null>(null)
  // Primary path: the service worker precaches the app (works offline) and
  // reports when a newer build is waiting. The banner activates it on accept.
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      regRef.current = registration ?? null
    },
  })

  // Kept in an effect rather than the registration callback so the timer and
  // listeners are actually torn down instead of accumulating.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible') void regRef.current?.update()
    }
    const iv = window.setInterval(check, 5 * 60_000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(iv)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])
  const staleFallback = useVersionJsonCheck(!HAS_SW)
  const [dismissed, setDismissed] = useState(false)

  // Never invite a reload over a live workout. The update remains waiting and
  // appears as soon as the player closes.
  const show = (needRefresh || staleFallback) && !dismissed && !defer
  if (!show) return null
  const refresh = () => {
    if (needRefresh) void updateServiceWorker(true)
    else window.location.reload()
  }
  return (
    <div className="fixed inset-x-0 bottom-20 z-[65] flex justify-center px-4 lg:bottom-6">
      <div className="animate-rise flex items-center gap-3 rounded-2xl border border-accent/35 bg-raised py-2.5 pl-4 pr-2.5 shadow-pop backdrop-blur">
        <Icon name="sparkle" size={17} className="shrink-0 text-accent-text" />
        <span className="text-[13.5px] font-medium text-ink">A new version of Planche Lab is ready.</span>
        <button
          onClick={refresh}
          className="rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-on-accent transition hover:brightness-105"
          style={{ background: 'var(--t-btn-accent)' }}
        >
          Refresh
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss update notice"
          className="grid h-9 w-9 place-items-center rounded-lg text-ink3 transition hover:text-ink"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  )
}

/**
 * Said when the latest changes are not reaching storage.
 *
 * Both writes used to fail silently — a full disk, a blocked private window —
 * so an athlete could finish a session, see "Saved ✓", close the app and lose
 * it. This stays until saving works again, and offers the one thing that
 * protects the data in the meantime.
 */
function PersistenceBanner() {
  const { state, persist, dispatch, retrySave } = useStore()
  if (persist.primary !== 'failed') return null
  return (
    <div className="fixed inset-x-0 top-0 z-[70] flex justify-center px-3 pt-[max(env(safe-area-inset-top),8px)]">
      <div
        role="alert"
        className="flex max-w-xl flex-wrap items-center gap-2 rounded-2xl border border-danger/40 bg-danger-soft px-4 py-2.5 shadow-pop"
      >
        <Icon name="info" size={16} className="shrink-0 text-danger-text" />
        <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink">
          Your latest changes are not being saved on this device
          {persist.error ? ` (${persist.error})` : ''}. Export a backup now, then free up storage.
        </span>
        <button
          onClick={() => {
            const at = Date.now()
            exportData({ ...state, lastBackupAt: at })
            dispatch({ type: 'STAMP_BACKUP', at })
          }}
          className="rounded-lg bg-danger px-3 py-1.5 text-[12.5px] font-semibold text-white"
        >
          Export
        </button>
        <button
          onClick={retrySave}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink"
        >
          Try again
        </button>
      </div>
    </div>
  )
}

/**
 * Everything that must exist no matter which screen is showing.
 *
 * `UpdateBanner` is not only a banner: mounting it is what registers the
 * service worker, so a branch that renders without it has no offline shell and
 * no update checks at all. It used to sit inside the main branch only, which
 * meant a fresh install had no service worker for the whole of onboarding —
 * exactly the moment a new PWA is being added to a home screen. Mounting it
 * here keeps that single instance (duplicate mounts once left two update
 * timers running) while guaranteeing every branch has it.
 */
function AppShell({ children, deferUpdate = false }: { children: ReactNode; deferUpdate?: boolean }) {
  return (
    <>
      {children}
      <PersistenceBanner />
      <UpdateBanner defer={deferUpdate} />
      <Toasts />
    </>
  )
}

/** Shown while boot looks for the on-device backup — usually for a few milliseconds. */
function BootSplash() {
  return (
    <div className="app-ambient grid min-h-screen place-items-center px-6" role="status">
      <div className="text-center text-[13px] text-ink3">Checking for saved data…</div>
    </div>
  )
}

/**
 * The saved data could not be read and there was no usable backup.
 *
 * The old behaviour started an empty app and saved it over the unreadable
 * data on the first render. Now the original bytes are kept aside and nothing
 * is written until the athlete chooses.
 */
function BootRecovery() {
  const { boot, startFresh } = useStore()
  const download = () => {
    const kept = quarantinedData()
    if (!kept) return
    const url = URL.createObjectURL(new Blob([kept.raw], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'planche-lab-unreadable-data.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
  return (
    <div className="app-ambient min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
        <h1 className="font-display text-[24px] font-bold text-ink">Your saved data could not be read</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink2">
          Nothing has been overwritten. The original is kept aside on this device, exactly as it was, and there was no
          on-device backup to restore from.
        </p>
        {boot.failure ? (
          <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-raised p-3 text-[11.5px] text-ink3">
            {boot.failure.reason}
          </pre>
        ) : null}
        <button
          onClick={download}
          className="mt-4 rounded-2xl px-6 py-3.5 font-display text-[15px] font-semibold text-on-accent"
          style={{ background: 'var(--t-btn-accent)' }}
        >
          Download the unreadable data
        </button>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 rounded-2xl border border-line bg-surface py-3 text-[14px] font-medium text-ink"
        >
          Try again
        </button>
        <button
          onClick={startFresh}
          className="mt-2 rounded-2xl border border-line bg-surface py-3 text-[14px] font-medium text-ink2"
        >
          Start fresh (the unreadable copy stays aside)
        </button>
        <p className="mt-4 text-center text-[12.5px] text-ink3">
          If you have an exported backup file, start fresh and import it from Settings → Data.
        </p>
      </div>
    </div>
  )
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

export default function App() {
  const { state, dispatch, boot } = useStore()
  const [tab, setTab] = useState<Tab>('home')
  const devLab = useDevLabRoute()
  // An interrupted session (phone slept, tab discarded) is picked back up
  // automatically on the next load instead of being silently lost.
  const [resumeDraft] = useState(() => loadDraft())
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(resumeDraft?.workout ?? null)
  const [resuming, setResuming] = useState(resumeDraft !== null)

  const [askCheckIn, setAskCheckIn] = useState(false)
  /** A just-saved session to open in History, from the celebration screen. */
  const [focusSessionId, setFocusSessionId] = useState<string | null>(null)
  const [checkInContext, setCheckInContext] = useState<CheckInContext>({})

  // Updates has no nav entry of its own; it lives under Settings, so Settings
  // stays lit while you are reading it rather than nothing being selected.
  const navTab: Tab = tab === 'updates' ? 'settings' : tab

  // Each tab is a page, even though the app does not navigate to a new URL.
  // Resetting scroll prevents a long Progress/Settings page from opening the
  // next tab halfway down its content.
  useEffect(() => {
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [tab])

  // Sweep expired footage once per launch, so storage does not creep up over
  // months even if a session never finishes.
  useEffect(() => {
    void pruneClips()
  }, [])
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
    const { workout, plan } = finalizeWorkoutWithPlan(state, request, undefined, now)
    // Asked on every kind of session when due — a check-in before a template
    // still feeds the rails and the record. A test always asks: a maximal
    // effort needs today's answer, not last week's.
    setAskCheckIn(request.source === 'test' || plan.askCheckIn)
    setCheckInContext(checkInContextFor(plan))
    setActiveWorkout(workout)
  }

  // Ahead of both branches so the bench is reachable from a fresh install as
  // well as mid-training, and so it never has to fight the session player for
  // the screen.
  if (devLab) {
    return (
      <AppShell>
        <div className="app-ambient grain min-h-screen">
          <Suspense fallback={<div className="p-6 text-[13px] text-ink3">Loading the bench…</div>}>
            <DevLab onClose={() => { window.location.hash = '' }} />
          </Suspense>
        </div>
      </AppShell>
    )
  }

  if (boot.phase === 'checking-backup') {
    return (
      <AppShell>
        <BootSplash />
      </AppShell>
    )
  }
  if (boot.phase === 'unreadable') {
    return (
      <AppShell>
        <BootRecovery />
      </AppShell>
    )
  }

  if (!state.onboarded) {
    return (
      <AppShell>
        <Onboarding />
      </AppShell>
    )
  }

  return (
    <AppShell deferUpdate={Boolean(activeWorkout)}>
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
              className="grid h-9 w-9 place-items-center rounded-xl text-on-accent"
              style={{ background: 'var(--t-btn-accent)' }}
            >
              {/* tiny planche glyph */}
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <circle cx="18.5" cy="9" r="2.6" fill="currentColor" />
                <rect x="2.5" y="10.5" width="13.5" height="3.2" rx="1.6" fill="currentColor" />
                <rect x="8.5" y="13.5" width="3" height="7" rx="1.5" fill="currentColor" />
              </svg>
            </div>
            <div>
              <div className="font-display text-[16px] font-bold leading-tight text-ink">Planche Lab</div>
              <div className="text-[11.5px] font-medium text-ink3">own the hold</div>
            </div>
          </div>
          <nav className="space-y-1">
            {NAV.map((n) => (
              <button
                key={n.tab}
                onClick={() => setTab(n.tab)}
                aria-current={navTab === n.tab ? 'page' : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14.5px] font-medium transition ${
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
              className="grid h-8 w-8 place-items-center rounded-lg text-on-accent"
              style={{ background: 'var(--t-btn-accent)' }}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                <circle cx="18.5" cy="9" r="2.6" fill="currentColor" />
                <rect x="2.5" y="10.5" width="13.5" height="3.2" rx="1.6" fill="currentColor" />
                <rect x="8.5" y="13.5" width="3" height="7" rx="1.5" fill="currentColor" />
              </svg>
            </div>
            <span className="font-display text-[16px] font-bold text-ink">Planche Lab</span>
          </div>

          {tab === 'home' ? (
            <Dashboard
              startWorkout={startWorkout}
              go={setTab}
              viewSession={(sessionId) => {
                setFocusSessionId(sessionId)
                setTab('stats')
              }}
            />
          ) : null}
          {tab === 'train' ? <Train startWorkout={startWorkout} /> : null}
          {tab === 'path' ? <Path startWorkout={startWorkout} /> : null}
          {tab === 'library' ? <Library /> : null}
          {tab === 'stats' ? <Stats focusSessionId={focusSessionId} onFocused={() => setFocusSessionId(null)} /> : null}
          {tab === 'settings' ? <Settings go={setTab} /> : null}
          {tab === 'updates' ? <Updates go={setTab} /> : null}
        </main>
      </div>

      {/* Bottom tab bar (mobile) */}
      <nav
        aria-hidden={activeWorkout ? true : undefined}
        inert={activeWorkout ? true : undefined}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur-lg lg:hidden"
      >
        <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5">
          {NAV.map((n) => (
            <button
              key={n.tab}
              onClick={() => setTab(n.tab)}
              aria-current={navTab === n.tab ? 'page' : undefined}
              className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[10.5px] font-medium transition ${
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
            setActiveWorkout(finalizeWorkout(state, requestFor(activeWorkout), c))
          }}
          onExit={() => {
            setResuming(false)
            setAskCheckIn(false)
            setActiveWorkout(null)
          }}
          onViewSession={(sessionId) => {
            setResuming(false)
            setAskCheckIn(false)
            setActiveWorkout(null)
            setFocusSessionId(sessionId)
            setTab('stats')
          }}
        />
      ) : null}
    </div>
    </AppShell>
  )
}
