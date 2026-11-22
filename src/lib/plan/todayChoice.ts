import { useCallback, useEffect, useState } from 'react'
import { dayKey } from '../time'

/**
 * Today's choice — "Rather do the gym today?" and "I have X min" — kept for
 * the calendar day it was made on, so every screen plans the same today: the
 * Today card, Train, Home and the Gym tab once each kept their own, and only
 * the Today card heard either answer. A per-device convenience in
 * localStorage: lost storage means the coach's own day, never an error.
 */
export interface TodayChoice {
  kind?: 'calisthenics' | 'gym'
  minutes?: number
}

const KEY = 'planchelab.todayChoice'
const EVENT = 'planchelab:todaychoice'

function clean(x: { kind?: unknown; minutes?: unknown }): TodayChoice {
  const minutes = typeof x.minutes === 'number' && Number.isFinite(x.minutes) && x.minutes >= 5 && x.minutes <= 240 ? Math.round(x.minutes) : undefined
  return {
    ...(x.kind === 'calisthenics' || x.kind === 'gym' ? { kind: x.kind } : {}),
    ...(minutes !== undefined ? { minutes } : {}),
  }
}

/** Today's choice, or nothing: one made on another day, or unreadable, is no choice. */
export function readTodayChoice(now = Date.now()): TodayChoice {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (!raw) return {}
    const x = JSON.parse(raw) as { day?: unknown; kind?: unknown; minutes?: unknown }
    return x && x.day === dayKey(now) ? clean(x) : {}
  } catch {
    return {}
  }
}

/** Keep a choice for today; an empty one clears it. Every screen reading it hears the change. */
export function writeTodayChoice(choice: TodayChoice, now = Date.now()): void {
  const c = clean(choice)
  try {
    if (!c.kind && c.minutes === undefined) globalThis.localStorage?.removeItem(KEY)
    else globalThis.localStorage?.setItem(KEY, JSON.stringify({ day: dayKey(now), ...c }))
  } catch {
    // A per-device convenience only: without storage the choice lasts as long as the screen.
  }
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
  } catch {
    // Nothing listening.
  }
}

/** `planToday` options for a choice. */
export function choiceOptions(c: TodayChoice): { minutes?: number; kind?: 'calisthenics' | 'gym' } {
  return { ...(c.minutes !== undefined ? { minutes: c.minutes } : {}), ...(c.kind ? { kind: c.kind } : {}) }
}

/**
 * Today's choice for a screen, kept in step with every other screen and read
 * again when the day changes (`todayKey` from `useToday`).
 */
export function useTodayChoice(todayKey: string): [TodayChoice, (next: TodayChoice) => void] {
  const [choice, setChoice] = useState<TodayChoice>(() => readTodayChoice())
  useEffect(() => {
    const sync = () =>
      setChoice((cur) => {
        const next = readTodayChoice()
        return next.kind === cur.kind && next.minutes === cur.minutes ? cur : next
      })
    sync()
    window.addEventListener(EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [todayKey])
  const update = useCallback((next: TodayChoice) => {
    writeTodayChoice(next)
    setChoice(clean(next))
  }, [])
  return [choice, update]
}
