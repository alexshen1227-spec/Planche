import { useLayoutEffect, useRef, useState } from 'react'
import { adaptOpenDraft, loadDraft, type GymDraft } from '../../lib/gym/draft'
import type { GymLocation } from '../../lib/gym/types'
import { useStore } from '../../lib/store'
import { pushToast } from '../../lib/toast'
import { GymPlayer } from './GymPlayer'

const OWNER = 'planchelab.gymWriter'

/** Resuming in a new tab transfers the workout after the previous editor releases it. */
export function GymWorkoutGate({ draft, location, onClose }: { draft: GymDraft; location: GymLocation; onClose: () => void }) {
  const { getState } = useStore()
  const [ready, setReady] = useState<GymDraft | null>(null)
  const [token] = useState(() => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`)
  const storageWorks = useRef(true)
  const hadDraft = useRef(Boolean(loadDraft()))
  const close = useRef(onClose)
  close.current = onClose
  const owns = () => {
    if (!storageWorks.current) return true
    try { return localStorage.getItem(OWNER) === token } catch { return true }
  }

  useLayoutEffect(() => {
    let live = true
    let release: (() => void) | undefined
    const abort = new AbortController()
    const finish = (message: string) => {
      if (!live) return
      live = false
      release?.()
      pushToast(message, 'info')
      close.current()
    }
    const changed = (event: StorageEvent) => {
      if (event.key === OWNER && event.newValue && event.newValue !== token && !owns()) {
        finish('Your workout is open in another tab. Resume here to bring the latest sets back.')
      }
    }
    window.addEventListener('storage', changed)
    try { localStorage.setItem(OWNER, token) } catch { storageWorks.current = false }
    const open = () => {
      if (!live || !owns()) return
      const latest = loadDraft()
      const existing = getState().gym?.sessions.find((s) => s.id === draft.id)
      if (!latest && (hadDraft.current || (existing && draft.resumeFrom === undefined))) {
        finish('This workout was closed in another tab. Your saved sets are in workout history.')
        return
      }
      const source = latest ?? draft
      const place = getState().gym?.locations.find((l) => l.id === source.locationId) ?? location
      setReady(adaptOpenDraft(source, draft.avoidJoints ?? [], (draft.volumeFactor ?? 1) <= 0.6, place))
    }
    if (navigator.locks) {
      void navigator.locks.request(OWNER, { signal: abort.signal }, async () => {
        if (!live) return
        const held = new Promise<void>((resolve) => { release = resolve })
        open()
        if (live) await held
      }).catch(() => { if (live) open() })
    } else open()
    return () => {
      live = false
      abort.abort()
      release?.()
      window.removeEventListener('storage', changed)
      try { if (storageWorks.current && owns()) localStorage.removeItem(OWNER) } catch { /* Storage may be unavailable. */ }
    }
    // The claim belongs to this player opening. Rerenders do not reclaim it from another tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  if (!ready) return <p role="status" className="p-3 text-footnote text-ink2">Opening the latest workout…</p>
  const place = getState().gym?.locations.find((l) => l.id === ready.locationId) ?? location
  return <GymPlayer draft={ready} location={place} onClose={onClose} canEdit={owns} />
}
