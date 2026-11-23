import { useEffect, useState } from 'react'
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
    if (preset) {
      sessionStorage.setItem(KEY, JSON.stringify({ day: dayKey(now), at: now, preset } satisfies NextBlock<P>))
      // Remembering a block means a skill opener is running: the lifts are part of today until saved or ended.
      markOpenerDay(now)
    } else sessionStorage.removeItem(KEY)
    notify()
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

/**
 * What today is, beyond what was logged: a gym day that opened with a skill
 * (so its lifts are still owed after the opener is saved) and a day the
 * athlete ended on purpose. The plan alone cannot say it — once the opener is
 * logged the planner sees a trained skill day — and a tab that closed would
 * forget a sessionStorage-only note, so these live in localStorage for the
 * calendar day they were made on.
 */
export interface DayMarks {
  /** An opener was started today: the lifts are part of the day. */
  openerDay: boolean
  /** The athlete said the day is over (the lifts skipped on purpose). */
  ended: boolean
}

const MARKS_KEY = 'planchelab.dayMarks'
const MARKS_EVENT = 'planchelab:daymarks'
const NO_MARKS: DayMarks = { openerDay: false, ended: false }

export function readDayMarks(now = Date.now()): DayMarks {
  try {
    const raw = globalThis.localStorage?.getItem(MARKS_KEY)
    if (!raw) return NO_MARKS
    const x = JSON.parse(raw) as { day?: unknown; opener?: unknown; ended?: unknown } | null
    if (!x || x.day !== dayKey(now)) return NO_MARKS
    return { openerDay: x.opener === true, ended: x.ended === true }
  } catch {
    return NO_MARKS
  }
}

function writeDayMarks(marks: DayMarks, now: number): void {
  try {
    globalThis.localStorage?.setItem(MARKS_KEY, JSON.stringify({ day: dayKey(now), opener: marks.openerDay, ended: marks.ended }))
  } catch {
    // A per-device convenience: without storage the plan's own reading stands.
  }
  notify()
}

function notify(): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(MARKS_EVENT))
  } catch {
    // Nothing listening.
  }
}

/** An opener was started: today's lifts are owed until they are saved or the day is ended. */
export function markOpenerDay(now = Date.now()): void {
  writeDayMarks({ ...readDayMarks(now), openerDay: true }, now)
}

/** The athlete ends today without the rest of it. */
export function endTheDay(now = Date.now()): void {
  writeDayMarks({ ...readDayMarks(now), ended: true }, now)
}

/** Every screen reading today's marks hears a change; a new day reads none. */
export function useDayMarks(todayKey: string): DayMarks {
  const [marks, setMarks] = useState<DayMarks>(() => readDayMarks())
  useEffect(() => {
    const sync = () =>
      setMarks((cur) => {
        const next = readDayMarks()
        return next.openerDay === cur.openerDay && next.ended === cur.ended ? cur : next
      })
    sync()
    window.addEventListener(MARKS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(MARKS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [todayKey])
  return marks
}

/** The remembered gym block of today's opener, read again whenever it or today's marks change. */
export function useNextBlock<P>(todayKey: string): P | null {
  const [, bump] = useState(0)
  useEffect(() => {
    const sync = () => bump((n) => n + 1)
    window.addEventListener(MARKS_EVENT, sync)
    return () => window.removeEventListener(MARKS_EVENT, sync)
  }, [todayKey])
  return peekNextBlock<P>()
}
