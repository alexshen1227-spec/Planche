import type { SetLog, Workout } from '../types'

/**
 * Crash-proof live-session storage.
 *
 * A phone that sleeps or backgrounds the tab can have its page discarded by
 * the OS to reclaim memory — which used to wipe an in-progress workout
 * entirely. Every meaningful change is mirrored here so the session can be
 * picked up exactly where it left off, even after a full reload.
 */

const KEY = 'planchelab.draft'
/** Older than this and it is yesterday's session, not an interruption. */
const MAX_AGE_MS = 18 * 3_600_000

export interface SessionDraft {
  v: 1
  savedAt: number
  workout: Workout
  startedAt: number
  blockIndex: number
  setIndex: number
  logs: SetLog[]
  /** A hold was running when the page went away. */
  wasHolding: boolean
  /** Seconds already accumulated on that interrupted hold. */
  holdElapsed: number
  restEndsAt: number | null
  rpe?: number
  notes?: string
}

export type DraftInput = Omit<SessionDraft, 'v' | 'savedAt'>

export function saveDraft(input: DraftInput): void {
  try {
    const draft: SessionDraft = { ...input, v: 1, savedAt: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(draft))
  } catch {
    // Storage unavailable — the session still runs, it just can't be resumed.
  }
}

export function loadDraft(): SessionDraft | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as SessionDraft
    if (d?.v !== 1 || !d.workout || !Array.isArray(d.logs)) return null
    // Nothing logged and nothing mid-hold means nothing to lose — don't force
    // someone back into a session they only opened and walked away from. An
    // interrupted first hold still counts as work worth recovering.
    const holdInFlight = d.wasHolding && d.holdElapsed > 1
    if (d.logs.length === 0 && !holdInFlight) {
      clearDraft()
      return null
    }
    if (Date.now() - d.savedAt > MAX_AGE_MS) {
      clearDraft()
      return null
    }
    return d
  } catch {
    return null
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to clean up */
  }
}

export function hasDraft(): boolean {
  return loadDraft() !== null
}
