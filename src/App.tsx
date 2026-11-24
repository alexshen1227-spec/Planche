import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from './components/ds'
import { quarantinedData, useStore } from './lib/store'
import { BackupButton } from './components/BackupButton'
import { Icon } from './components/Icon'
import { Toasts } from './components/Toasts'
import { APP_NAME } from './data/app'
import { setAthleteLockout } from './lib/lockout'

/**
 * A bench for the camera form judge, reached at #devlab.
 *
 * Code-split deliberately: it pulls in the synthetic pose generator and a pile
 * of controls that no workout ever needs, and none of that should sit in the
 * bundle an athlete downloads on a phone at the gym.
 */
const DevLab = lazy(() => import('./views/DevLab'))

const Onboarding = lazy(() => import('./views/Onboarding').then((m) => ({ default: m.Onboarding })))

const TrainingApp = lazy(() => import('./TrainingApp'))

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
 * Fallback updater while no service worker controls this page: poll the deployed
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
  const staleFallback = useVersionJsonCheck(!HAS_SW || !navigator.serviceWorker?.controller)
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
      <div className="animate-rise flex items-center gap-3 rounded-inner border border-accent/35 bg-raised py-2.5 pl-4 pr-2.5 shadow-pop backdrop-blur">
        <Icon name="sparkle" size={17} className="shrink-0 text-accent-text" />
        <span className="text-footnote font-medium text-ink">A new version of {APP_NAME} is ready.</span>
        <Button
          onClick={refresh}
          className=" "
        >
          Refresh
        </Button>
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
  const { persist, retrySave } = useStore()
  // A newer version saved this data: this older copy holds every write so it never strips the newer fields.
  // Only a refresh fixes it, and a toast alone was easy to miss.
  if (persist.newer) {
    return (
      <div className="fixed inset-x-0 top-0 z-[70] flex justify-center px-3 pt-[max(env(safe-area-inset-top),8px)]">
        <div
          role="alert"
          className="flex max-w-xl flex-wrap items-center gap-2 rounded-inner border border-danger/40 bg-danger-soft px-4 py-2.5 shadow-pop"
        >
          <Icon name="info" size={16} className="shrink-0 text-danger-text" />
          <span className="min-w-0 flex-1 text-footnote leading-snug text-ink">
            A newer version of Fitness Lab saved your data, so this older copy is not saving anything. Refresh to update it.
          </span>
          <button onClick={() => window.location.reload()} className="rounded-lg bg-danger-solid px-3 py-1.5 text-footnote font-semibold text-white">
            Refresh
          </button>
        </div>
      </div>
    )
  }
  if (persist.primary !== 'failed') return null
  return (
    <div className="fixed inset-x-0 top-0 z-[70] flex justify-center px-3 pt-[max(env(safe-area-inset-top),8px)]">
      <div
        role="alert"
        className="flex max-w-xl flex-wrap items-center gap-2 rounded-inner border border-danger/40 bg-danger-soft px-4 py-2.5 shadow-pop"
      >
        <Icon name="info" size={16} className="shrink-0 text-danger-text" />
        <span className="min-w-0 flex-1 text-footnote leading-snug text-ink">
          Your latest changes are not being saved on this device
          {persist.error ? ` (${persist.error})` : ''}. Export a backup now, then free up storage.
        </span>
        <BackupButton className="rounded-lg bg-danger-solid px-3 py-1.5 text-footnote font-semibold text-white">
          Export
        </BackupButton>
        <button
          onClick={retrySave}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-footnote font-medium text-ink"
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
function BootSplash({ label = 'Checking for saved data…' }: { label?: string }) {
  return (
    <div className="app-ambient grid min-h-screen place-items-center px-6" role="status">
      <div className="text-center text-footnote text-ink3">{label}</div>
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
    a.download = 'calisthenics-lab-unreadable-data.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
  return (
    <div className="app-ambient min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
        <h1 className="font-display text-[24px] font-bold text-ink">Your saved data could not be read</h1>
        <p className="mt-2 text-body leading-relaxed text-ink2">
          Nothing has been overwritten. The original is kept aside on this device, exactly as it was, and there was no
          on-device backup to restore from.
        </p>
        {boot.failure ? (
          <pre className="mt-3 overflow-x-auto rounded-control border border-line bg-raised p-3 text-caption text-ink3">
            {boot.failure.reason}
          </pre>
        ) : null}
        <Button size="lg"
          onClick={download}
          className="mt-4 "
        >
          Download the unreadable data
        </Button>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 rounded-inner border border-line bg-surface py-3 text-body font-medium text-ink"
        >
          Try again
        </button>
        <button
          onClick={startFresh}
          className="mt-2 rounded-inner border border-line bg-surface py-3 text-body font-medium text-ink2"
        >
          Start fresh (the unreadable copy stays aside)
        </button>
        <p className="mt-4 text-center text-footnote text-ink3">
          If you have an exported backup file, start fresh and import it from Settings → Data.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const { state, boot } = useStore()
  const devLab = useDevLabRoute()
  const [workoutOpen, setWorkoutOpen] = useState(true)
  useEffect(() => setAthleteLockout(state.settings.lockoutDeg), [state.settings.lockoutDeg])
  const ready = state.onboarded && boot.phase === 'ready'
  const bench = devLab ? (
    <div className="app-ambient grain min-h-screen">
      <Suspense fallback={<div className="p-6 text-footnote text-ink3">Loading the bench…</div>}>
        <DevLab onClose={() => { window.location.hash = '' }} />
      </Suspense>
    </div>
  ) : null
  let screen: ReactNode
  if (ready) screen = <TrainingApp key={state.epoch} bench={bench} onWorkoutChange={setWorkoutOpen} />
  else if (bench) screen = bench
  else if (boot.phase === 'checking-backup') screen = <BootSplash />
  else if (boot.phase === 'unreadable') screen = <BootRecovery />
  else screen = <Onboarding key={state.epoch} />
  return (
    <AppShell deferUpdate={ready && workoutOpen}>
      <Suspense fallback={<BootSplash label={ready ? 'Opening your training…' : 'Opening Fitness Lab…'} />}>
        {screen}
      </Suspense>
    </AppShell>
  )
}
