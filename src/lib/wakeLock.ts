import { useEffect } from 'react'
import { pushToast } from './toast'

/**
 * Said once per page load when the screen cannot be kept on: a phone that
 * locks during a rest stops the timer and the camera, and nothing else would
 * tell the athlete why. (iPhone home-screen apps before iOS 18.4 refused
 * wake locks silently, per MDN's compatibility data.)
 */
let warned = false
function warnOnce() {
  if (warned || document.visibilityState !== 'visible') return
  warned = true
  pushToast(
    'This browser will not keep the screen on — lengthen your phone’s auto-lock while you train, or the timer and camera stop when it locks.',
    'info',
    8000,
  )
}

/** Keep the screen awake while `active` (used during live sessions). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    if (!('wakeLock' in navigator)) {
      warnOnce()
      return
    }
    let sentinel: WakeLockSentinel | null = null
    let cancelled = false

    const request = async () => {
      try {
        sentinel = await navigator.wakeLock.request('screen')
        if (cancelled) await sentinel.release()
      } catch {
        // A hidden tab or battery saver can refuse it; only a visible refusal
        // is worth saying.
        warnOnce()
      }
    }
    void request()

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void request()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => {})
    }
  }, [active])
}
