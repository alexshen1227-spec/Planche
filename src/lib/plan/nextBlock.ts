import { dayKey } from '../time'

/**
 * A mixed day as one flow: starting the skill block from the Today card
 * remembers the gym block that follows it; when that skill session is saved
 * and closed, the app opens the gym side and starts it. Kept for the tab's
 * lifetime only (sessionStorage), and only for the same calendar day.
 */
const KEY = 'planchelab.nextBlock'

export interface NextBlock<P> {
  day: string
  preset: P
}

export function rememberNextBlock<P>(preset: P | null, now = Date.now()): void {
  try {
    if (preset) sessionStorage.setItem(KEY, JSON.stringify({ day: dayKey(now), preset } satisfies NextBlock<P>))
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
    return next && next.day === dayKey(now) ? next.preset : null
  } catch {
    return null
  }
}
