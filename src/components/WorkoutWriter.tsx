import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { newId, useStore } from '../lib/store'
import { pushToast } from '../lib/toast'
import { Button, Sheet } from './ds'

/** Only the tab holding the workout can write its draft or save its sets. */
export function WorkoutWriter<T>({ ownerKey, restoring = false, load, onClose, children }: {
  ownerKey: string
  restoring?: boolean
  load: () => T | null
  onClose: () => void
  children: (source: T, canEdit: () => boolean) => ReactNode
}) {
  const [token] = useState(newId)
  const { state, getState } = useStore()
  const openedEpoch = useRef(state.epoch).current
  const [takeOver, setTakeOver] = useState(false)
  const [retry, setRetry] = useState(0)
  const [waiting, setWaiting] = useState(false)
  const [ready, setReady] = useState<{ source: T } | null>(null)
  const storageWorks = useRef(true)
  const callbacks = useRef({ load, onClose })
  callbacks.current = { load, onClose }
  const owns = useCallback(() => {
    if (getState().epoch !== openedEpoch) return false
    if (!storageWorks.current) return true
    try { return localStorage.getItem(ownerKey) === token } catch { return true }
  }, [getState, openedEpoch, ownerKey, token])
  // This is the intention at opening. A check-in can rebuild the workout in the same player.
  const passive = useRef(restoring).current && !takeOver
  useLayoutEffect(() => {
    if (state.epoch !== openedEpoch) {
      pushToast('Training data was replaced. This workout has closed.', 'info')
      callbacks.current.onClose()
    }
  }, [openedEpoch, state.epoch])

  useLayoutEffect(() => {
    let live = true
    let claimed = false
    let release: (() => void) | undefined
    let waitingTimer: number | undefined
    const abort = new AbortController()
    const returnKey = ownerKey + '.returning'
    const claim = () => {
      try { localStorage.setItem(ownerKey, token) } catch { storageWorks.current = false }
      try { sessionStorage.removeItem(returnKey) } catch { /* The lock also works without session storage. */ }
      claimed = true
    }
    const leaving = (event: PageTransitionEvent) => {
      if (event.persisted || !claimed || !owns()) return
      try { sessionStorage.setItem(returnKey, token) } catch { /* A returning tab can still use the lock. */ }
    }
    const finish = (message: string) => {
      if (!live) return
      live = false
      release?.()
      pushToast(message, 'info')
      callbacks.current.onClose()
    }
    const changed = (event: StorageEvent) => {
      if (!live || event.key !== ownerKey) return
      if (claimed && event.newValue !== token && !owns()) {
        finish(event.newValue ? 'Your workout is open in another tab. Resume there to keep logging.' : 'The saved training data changed. This workout has closed.')
      } else if (!claimed && !event.newValue) {
        setRetry((n) => n + 1)
      }
    }
    window.addEventListener('storage', changed)
    window.addEventListener('pagehide', leaving)
    const open = () => {
      if (!live || (claimed && !owns())) return
      if (!claimed) claim()
      const source = callbacks.current.load()
      if (source === null) { finish('This workout was closed in another tab. Your saved sets are in workout history.'); return }
      setWaiting(false)
      setReady({ source })
    }
    const fallback = () => {
      if (!live) return
      try {
        const other = localStorage.getItem(ownerKey)
        let returning = false
        try { returning = sessionStorage.getItem(returnKey) === other } catch { /* Ask before taking another writer. */ }
        if (passive && other && other !== token && !returning) { setWaiting(true); return }
      } catch { storageWorks.current = false }
      open()
    }
    // Opening a second tab should leave a running stopwatch with its athlete.
    // An explicit transfer signals the old editor, then waits for it to release the lock.
    if (!passive) claim()
    if (navigator.locks) {
      // On refresh Chrome can still be releasing the previous document's
      // lock. Queue for it before offering to take over a genuinely busy tab.
      if (passive) waitingTimer = window.setTimeout(() => { if (live && !claimed) setWaiting(true) }, 450)
      void navigator.locks.request(ownerKey, { signal: abort.signal }, async () => {
        if (!live) return
        window.clearTimeout(waitingTimer)
        const held = new Promise<void>((resolve) => { release = resolve })
        open()
        if (live) await held
      }).catch(fallback)
    } else fallback()
    return () => {
      live = false
      abort.abort()
      release?.()
      window.clearTimeout(waitingTimer)
      window.removeEventListener('storage', changed)
      window.removeEventListener('pagehide', leaving)
      try { if (claimed && storageWorks.current && owns()) localStorage.removeItem(ownerKey) } catch { /* Storage may be unavailable. */ }
    }
  }, [ownerKey, owns, passive, retry, token])

  if (state.epoch !== openedEpoch) return null
  if (ready) return children(ready.source, owns)
  if (waiting) return <Sheet open onClose={onClose} title="Workout open in another tab">
    <p className="text-body text-ink2">Continue in the original tab, or bring your latest sets here.</p>
    <div className="mt-4 flex flex-wrap gap-2">
      <Button onClick={() => { setWaiting(false); setTakeOver(true) }}>Continue in this tab</Button>
      <Button variant="secondary" onClick={onClose}>Back to training</Button>
    </div>
  </Sheet>
  return <p role="status" className="p-3 text-footnote text-ink2">Opening the latest workout…</p>
}
