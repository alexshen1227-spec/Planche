import { useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import type { Tab, Workout } from './types'
import { useStore } from './lib/store'
import { loadDraft } from './lib/draft'
import { buildPlan } from './lib/coach'
import { todaysSession } from './data/workouts'
import { MeasurePrompt, measurementDue } from './components/MeasurePrompt'
import { pruneClips } from './lib/clips'
import { Icon, type IconName } from './components/Icon'
import { Toasts } from './components/Toasts'
import { Dashboard } from './views/Dashboard'
import { Train } from './views/Train'
import { Path } from './views/Path'
import { Library } from './views/Library'
import { Stats } from './views/Stats'
import { Settings } from './views/Settings'
import { Onboarding } from './views/Onboarding'
import { SessionPlayer } from './views/SessionPlayer'

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

function UpdateBanner() {
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

  const show = (needRefresh || staleFallback) && !dismissed
  if (!show) return null
  const refresh = () => {
    if (needRefresh) void updateServiceWorker(true)
    else window.location.reload()
  }
  return (
    <div className="fixed inset-x-0 bottom-20 z-[65] flex justify-center px-4 lg:bottom-6">
      <div className="animate-rise flex items-center gap-3 rounded-2xl border border-accent/35 bg-raised py-2.5 pl-4 pr-2.5 shadow-pop backdrop-blur">
        <Icon name="sparkle" size={17} className="shrink-0 text-accent" />
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
          className="grid h-7 w-7 place-items-center rounded-lg text-ink3 transition hover:text-ink"
        >
          <Icon name="x" size={14} />
        </button>
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

export default function App() {
  const { state } = useStore()
  const [tab, setTab] = useState<Tab>('home')
  // An interrupted session (phone slept, tab discarded) is picked back up
  // automatically on the next load instead of being silently lost.
  const [resumeDraft] = useState(() => loadDraft())
  const [activeWorkout, setActiveWorkout] = useState<Workout | null>(resumeDraft?.workout ?? null)
  const [resuming, setResuming] = useState(resumeDraft !== null)

  const [askCheckIn, setAskCheckIn] = useState(false)

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

  const startWorkout = (w: Workout) => {
    setResuming(false)
    // Only ask on generated sessions — templates are the athlete's own call.
    setAskCheckIn(w.kind === 'auto' && buildPlan(state).askCheckIn)
    setActiveWorkout(w)
  }

  // Rendered once, outside the onboarding branch: mounting it in both places
  // left the first instance's update timer and listeners running forever.
  if (!state.onboarded) {
    return (
      <>
        <Onboarding />
        <Toasts />
      </>
    )
  }

  return (
    <div className="app-ambient grain min-h-screen">
      <div className="mx-auto flex w-full max-w-6xl gap-6 px-4 pb-24 pt-5 sm:px-6 lg:pb-10 lg:pt-8">
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
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14.5px] font-medium transition ${
                  tab === n.tab
                    ? 'bg-surface text-ink shadow-card border border-line'
                    : 'border border-transparent text-ink2 hover:bg-surface/60 hover:text-ink'
                }`}
              >
                <Icon name={n.icon} size={18} className={tab === n.tab ? 'text-accent' : ''} />
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

          {tab === 'home' ? <Dashboard startWorkout={startWorkout} go={setTab} /> : null}
          {tab === 'train' ? <Train startWorkout={startWorkout} /> : null}
          {tab === 'path' ? <Path startWorkout={startWorkout} /> : null}
          {tab === 'library' ? <Library /> : null}
          {tab === 'stats' ? <Stats /> : null}
          {tab === 'settings' ? <Settings /> : null}
        </main>
      </div>

      {/* Bottom tab bar (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur-lg lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 pb-[max(env(safe-area-inset-bottom),6px)] pt-1.5">
          {NAV.map((n) => (
            <button
              key={n.tab}
              onClick={() => setTab(n.tab)}
              className={`flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-[10.5px] font-medium transition ${
                tab === n.tab ? 'text-accent' : 'text-ink3 hover:text-ink2'
              }`}
            >
              <Icon name={n.icon} size={21} />
              {n.label}
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
          onCheckInAnswered={(c) => {
            // Nothing is logged yet at this point, so the session can be
            // safely rebuilt around what the athlete just reported.
            if (activeWorkout.kind !== 'auto') return
            setActiveWorkout(todaysSession(state, buildPlan(state, Date.now(), c)))
          }}
          onExit={() => {
            setResuming(false)
            setAskCheckIn(false)
            setActiveWorkout(null)
          }}
        />
      ) : null}
      <UpdateBanner />
      <Toasts />
    </div>
  )
}
