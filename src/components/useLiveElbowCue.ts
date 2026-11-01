import { useEffect, useRef, useState } from 'react'
import { getBackend, poseModelReady } from '../lib/poseBackend'
import { analysisInFlight } from '../lib/poseForm'
import { elbowCueDue, liveElbowDeg, type LiveReading } from '../lib/liveCue'

/** How often the live cue reads a frame — the judge's own sampling rate. */
const READ_EVERY_MS = 350

/**
 * Watch a filmed hold for a sustained elbow bend and call `onCue` once.
 *
 * Runs only while `active`, only when the pose model is already on the device
 * (it must never trigger a download mid-hold), and never while a form check
 * is analysing another clip — the detector is not reliably re-entrant on
 * phones. The stream is read through a detached video element, so nothing
 * about the recording or the screen changes. See lib/liveCue for the rule.
 */
export function useLiveElbowCue({
  active,
  getStream,
  minElbowDeg,
  onCue,
}: {
  active: boolean
  getStream: () => MediaStream | null
  minElbowDeg: number | undefined
  onCue: () => void
}): 'off' | 'watching' | 'cued' {
  const [state, setState] = useState<'off' | 'watching' | 'cued'>('off')
  const onCueRef = useRef(onCue)
  onCueRef.current = onCue

  useEffect(() => {
    const stream = active && minElbowDeg !== undefined && poseModelReady() ? getStream() : null
    if (!stream) {
      setState('off')
      return
    }
    let cancelled = false
    let busy = false
    let cued = false
    const startedAt = performance.now()
    const readings: LiveReading[] = []
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    void video.play().catch(() => {
      /* a detached element that will not play simply never reads */
    })
    setState('watching')

    const tick = async () => {
      if (busy || cancelled || cued || analysisInFlight()) return
      if (video.readyState < 2 || !video.videoWidth) return
      busy = true
      try {
        const backend = await getBackend('mediapipe')
        if (cancelled) return
        const kps = await backend.estimate(video)
        if (cancelled) return
        readings.push({
          t: (performance.now() - startedAt) / 1000,
          elbowDeg: liveElbowDeg(kps, video.videoWidth, video.videoHeight),
        })
        if (elbowCueDue(readings, minElbowDeg)) {
          cued = true
          setState('cued')
          onCueRef.current()
        }
      } catch {
        // A failed read is a missing moment, never a cue.
      } finally {
        busy = false
      }
    }
    const timer = window.setInterval(() => void tick(), READ_EVERY_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      video.pause()
      video.srcObject = null
    }
  }, [active, getStream, minElbowDeg])

  return state
}
