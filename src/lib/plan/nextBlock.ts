import { dayKey } from '../time'

/**
 * A mixed day as one flow: starting the skill block from the Today card
 * remembers the gym block that follows it; when that skill session is saved
 * and closed, the app opens the gym side and starts it. Kept for the tab's
 * lifetime only (sessionStorage), and for `NEXT_BLOCK_HOURS` after it was
 * remembered — not only the same calendar day, which lost a late opener's lifts.
 */
const KEY = 'planchelab.nextBlock'

export interface NextBlock<P> {
  day: string
  /** When it was remembered: an opener started at 23:30 still hands its lifts on after midnight. */
  at?: number
  preset: P
}

/** How long a remembered block waits: a session's length and more, so a late opener's lifts are not lost at midnight. */
export const NEXT_BLOCK_HOURS = 8

export function rememberNextBlock<P>(preset: P | null, now = Date.now()): void {
  try {
    if (preset) sessionStorage.setItem(KEY, JSON.stringify({ day: dayKey(now), at: now, preset } satisfies NextBlock<P>))
    else sessionStorage.removeItem(KEY)
  } catch {
    // Without storage the gym block simply waits on the Today card.
  }
}

/** The remembered block for today, if any; reading it does not clear it. */
export function peekNextBlock<P>(now = Date.now()): P | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const next = JSON.parse(raw) as NextBlock<P>
    if (!next) return null
    // The same calendar day, or within a few hours of being remembered (an opener that ran past midnight).
    const fresh = next.at !== undefined ? now >= next.at && now - next.at < NEXT_BLOCK_HOURS * 3_600_000 : next.day === dayKey(now)
    return fresh ? next.preset : null
  } catch {
    return null
  }
}
