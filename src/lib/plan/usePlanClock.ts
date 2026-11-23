import { useEffect, useState } from 'react'

/** Minutes between re-plans while a screen stays open. */
export const PLAN_CLOCK_MIN = 15

/** The coarse clock's tick for a moment: one value per `PLAN_CLOCK_MIN` minutes. */
export function planClockTick(now: number): number {
  return Math.floor(now / (PLAN_CLOCK_MIN * 60_000))
}

/**
 * A coarse clock for plans, beside the calendar day (`useToday`): it moves every
 * `PLAN_CLOCK_MIN` minutes while the app is open, and when it is brought back.
 * The day alone missed the rules that run in hours — 48 h pain, 72 h joints,
 * the rest rule in real hours — so a screen open since the morning kept the
 * morning's plan. Anything planned for "now" should depend on this too.
 */
export function usePlanClock(): number {
  const [tick, setTick] = useState(() => planClockTick(Date.now()))
  useEffect(() => {
    const sync = () => setTick((current) => {
      const next = planClockTick(Date.now())
      return next === current ? current : next
    })
    // Checked every minute (cheap); timers do not run while a phone sleeps, so visibility re-checks too.
    const timer = window.setInterval(sync, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])
  return tick
}
