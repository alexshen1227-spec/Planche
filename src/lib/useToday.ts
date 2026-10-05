import { useEffect, useState } from 'react'
import { dayKey } from './time'

/**
 * Today's local date key, kept current.
 *
 * A screen left open overnight, or a phone that wakes the app on a new day,
 * used to keep yesterday's plan in a memo keyed only on state — so the short
 * session it offered was computed for the wrong date, and the heatmap's range
 * ended before today. Anything date-dependent should depend on this too.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => dayKey(Date.now()))
  useEffect(() => {
    const sync = () => setToday((current) => {
      const next = dayKey(Date.now())
      return next === current ? current : next
    })
    // Wake exactly when the date changes, and re-check whenever the app is
    // brought back — timers do not run while a phone sleeps.
    let timer: number | undefined
    const schedule = () => {
      window.clearTimeout(timer)
      const now = new Date()
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
      timer = window.setTimeout(() => {
        sync()
        schedule()
      }, Math.max(1000, midnight - now.getTime() + 500))
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        sync()
        schedule()
      }
    }
    schedule()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])
  return today
}
