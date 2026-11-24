import { useEffect, useState } from 'react'
import { dayKey } from '../time'
import type { GymPreset } from './screens'
import { planClockTick } from './usePlanClock'

/**
 * A saved skill opener hands its lifts to Home and Train. Older builds kept
 * the preset in the tab when the opener started. New drafts carry it with
 * the workout and publish it here only when that exact session is saved.
 */
const KEY = 'planchelab.nextBlock'

export interface NextBlock<P> {
  day: string
  /** When it was remembered: an opener started at 23:30 still hands its lifts on after midnight. */
  at?: number
  sessionId?: string
  preset: P
}

/** How long a remembered block waits: a session's length and more, so a late opener's lifts are not lost at midnight. */
export const NEXT_BLOCK_HOURS = 8

export function rememberNextBlock<P>(preset: P | null, now = Date.now(), sessionId?: string): void {
  const record = preset ? JSON.stringify({ day: dayKey(now), at: now, preset, sessionId } satisfies NextBlock<P>) : null
  let durable = false
  try {
    if (record && sessionId) {
      localStorage.setItem(KEY, record)
      durable = true
    } else localStorage.removeItem(KEY)
  } catch {
    // The tab copy can still be available.
  }
  try {
    if (record && !durable) sessionStorage.setItem(KEY, record)
    else sessionStorage.removeItem(KEY)
  } catch {
    // Storage may be unavailable in this tab.
  }
  notify()
}

function readBlock<P>(store: 'localStorage' | 'sessionStorage', now: number): NextBlock<P> | null {
  try {
    const raw = globalThis[store]?.getItem(KEY)
    if (!raw) return null
    const next = JSON.parse(raw) as NextBlock<P>
    if (!next) return null
    // The same calendar day, or within a few hours of being remembered (an opener that ran past midnight).
    const recent = typeof next.at === 'number' && now >= next.at && now - next.at < NEXT_BLOCK_HOURS * 3_600_000
    const sameDay = next.day === dayKey(now) && (next.at === undefined || now >= next.at)
    return (recent || sameDay) && next.preset ? next : null
  } catch {
    return null
  }
}

function nextBlock<P>(now: number): NextBlock<P> | null {
  return readBlock<P>('localStorage', now) ?? readBlock<P>('sessionStorage', now)
}

export function peekNextBlock<P>(now = Date.now()): P | null {
  return nextBlock<P>(now)?.preset ?? null
}

/** Older, interrupted workouts stored their lifts separately in this tab. */
export function legacyOpenerLifts(now = Date.now()): GymPreset | undefined {
  const block = readBlock<GymPreset>('sessionStorage', now)
  return block && !block.sessionId ? block.preset : undefined
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
  /** Identifies a saved opener even when it started the night before. */
  openerSessionId?: string
  /** The athlete said the day is over (the lifts skipped on purpose). */
  ended: boolean
}

const MARKS_KEY = 'planchelab.dayMarks'
const MARKS_EVENT = 'planchelab:daymarks'
const NO_MARKS: DayMarks = { openerDay: false, ended: false }

export function readDayMarks(now = Date.now()): DayMarks {
  const sessionId = nextBlock(now)?.sessionId
  const opener = typeof sessionId === 'string' ? { openerDay: true, ended: false, openerSessionId: sessionId } : NO_MARKS
  try {
    const raw = globalThis.localStorage?.getItem(MARKS_KEY)
    if (!raw) return opener
    const x = JSON.parse(raw) as { day?: unknown; opener?: unknown; ended?: unknown } | null
    if (!x || x.day !== dayKey(now)) return opener
    return { ...opener, openerDay: opener.openerDay || x.opener === true, ended: x.ended === true }
  } catch {
    return opener
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
  rememberNextBlock(null, now)
}

/** Every screen reading today's marks hears a change; a new day reads none. */
export function useDayMarks(todayKey: string): DayMarks {
  const [marks, setMarks] = useState<DayMarks>(() => readDayMarks())
  const tick = planClockTick(Date.now())
  useEffect(() => {
    const sync = () =>
      setMarks((cur) => {
        const next = readDayMarks()
        return next.openerDay === cur.openerDay && next.ended === cur.ended && next.openerSessionId === cur.openerSessionId ? cur : next
      })
    sync()
    window.addEventListener(MARKS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(MARKS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [todayKey, tick])
  return marks
}

/** The remembered gym block of today's opener, read again whenever it or today's marks change. */
export function useNextBlock<P>(todayKey: string): P | null {
  const [, bump] = useState(0)
  useEffect(() => {
    const sync = () => bump((n) => n + 1)
    window.addEventListener(MARKS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(MARKS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [todayKey])
  return peekNextBlock<P>()
}
