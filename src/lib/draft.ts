import type { CheckIn, SetLog, Settings, Workout } from '../types'
import { pushToast } from './toast'

/**
 * Crash-proof live-session storage.
 *
 * A phone that sleeps or backgrounds the tab can have its page discarded by
 * the OS to reclaim memory — which used to wipe an in-progress workout
 * entirely. Every meaningful change is mirrored here so the session can be
 * picked up exactly where it left off, even after a full reload.
 */

const KEY = 'planchelab.draft'
/**
 * Older than this, a draft with nothing logged (a hold that was running when
 * the page went away) is yesterday's session, not an interruption. A draft
 * with logged sets never expires: those sets are the athlete's work, and the
 * 18 hours once deleted them — sets and all — without a word.
 */
export const MAX_EMPTY_DRAFT_AGE_MS = 18 * 3_600_000

export interface SessionDraft {
  v: 1 | 2
  savedAt: number
  workout: Workout
  startedAt: number
  /** Inactive time already completed before the current pause. */
  pausedMs?: number
  /** Wall-clock time when the app most recently became inactive. */
  pausedAt?: number
  blockIndex: number
  setIndex: number
  logs: SetLog[]
  /** A hold was running when the page went away. */
  wasHolding: boolean
  /** Seconds already accumulated on that interrupted hold. */
  holdElapsed: number
  restEndsAt: number | null
  /** Stable phases that can be resumed exactly. Older v1 drafts omit this. */
  phase?: 'ready' | 'rest' | 'summary'
  /** A backgrounded hold awaiting the athlete's log-or-redo decision (credited seconds). */
  interrupted?: number
  /** The stopwatch reading behind `interrupted`, so the raw observation survives a reload. */
  interruptedRaw?: number
  interruptedAt?: { bi: number; si: number }
  /** When training actually ended (the summary opened). Review time after it is not training. */
  endedAt?: number
  /** The athlete chose to finish before the plan was complete. */
  finishedEarly?: boolean
  restTotal?: number
  checkIn?: CheckIn
  /** Per-set stop setup carried to the next hold. */
  walkedBack?: boolean
  /** Session camera choice; may differ from the profile default. */
  cameraOn?: boolean
  rpe?: number
  notes?: string
  /**
   * Timestamps of the sets logged in each block, by block index. The next
   * set's adjusted target is derived from them, so a reload resumes with the
   * same targets the athlete was being given.
   */
  blockLogAts?: Record<number, number[]>
}

export type DraftInput = Omit<SessionDraft, 'v' | 'savedAt'>

/**
 * Restore choices made inside the session before falling back to Settings.
 *
 * These are session state, not profile state: an athlete can correct the stop
 * setup after one set and can turn filming off for this workout. Losing either
 * on reload changes recorded seconds or unexpectedly reopens the camera.
 */
export function restoredSessionSetup(
  draft: Pick<SessionDraft, 'walkedBack' | 'cameraOn'> | null | undefined,
  settings: Pick<Settings, 'phoneWithinReach' | 'recordForm'>,
): { walkedBack: boolean; cameraOn: boolean } {
  return {
    walkedBack: draft?.walkedBack ?? !settings.phoneWithinReach,
    cameraOn: draft?.cameraOn ?? settings.recordForm,
  }
}

export function saveDraft(input: DraftInput): void {
  try {
    const draft: SessionDraft = { ...input, v: 2, savedAt: Date.now() }
    localStorage.setItem(KEY, JSON.stringify(draft))
  } catch {
    // Storage unavailable — the session still runs, it just can't be resumed.
  }
}

export function loadDraft(now = Date.now()): SessionDraft | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as SessionDraft
    if ((d?.v !== 1 && d?.v !== 2) || !d.workout || !Array.isArray(d.logs)) return null
    // Nothing logged and nothing mid-hold means nothing to lose — don't force
    // someone back into a session they only opened and walked away from. An
    // interrupted first hold still counts as work worth recovering.
    const holdInFlight = d.wasHolding && d.holdElapsed > 1
    if (d.logs.length === 0 && !holdInFlight) {
      clearDraft()
      return null
    }
    if (d.logs.length === 0 && now - d.savedAt > MAX_EMPTY_DRAFT_AGE_MS) {
      clearDraft()
      return null
    }
    // An old one is offered like any other, and the athlete is told how old.
    announceOldDraft(d, now)
    return d
  } catch {
    return null
  }
}

const DAY_MS = 86_400_000

/** Local calendar days between two moments (0 = the same day). */
function calendarDaysBetween(from: number, to: number): number {
  const a = new Date(from)
  const b = new Date(to)
  const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  return Math.round((dayB - dayA) / DAY_MS)
}

/**
 * What to tell the athlete about an unfinished session past the interruption
 * window, or null while it is still a recent interruption.
 */
export function oldDraftNotice(draft: Pick<SessionDraft, 'savedAt' | 'logs'>, now = Date.now()): string | null {
  if (!Number.isFinite(draft.savedAt) || now - draft.savedAt <= MAX_EMPTY_DRAFT_AGE_MS) return null
  const days = calendarDaysBetween(draft.savedAt, now)
  const when = days <= 0 ? 'earlier today' : days === 1 ? 'yesterday' : `${days} days ago`
  const sets = draft.logs.length
  return `This unfinished session is from ${when}, with ${sets} ${sets === 1 ? 'set' : 'sets'} logged. Finish it to save those sets, or end it without saving.`
}

/** The draft last announced, so reading it again in the same visit says nothing more. */
let announced: number | undefined

function announceOldDraft(draft: SessionDraft, now: number) {
  const text = oldDraftNotice(draft, now)
  if (!text || announced === draft.savedAt) return
  announced = draft.savedAt
  pushToast(text, 'info', 10_000)
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
