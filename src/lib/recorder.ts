import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Records a short clip of a hold from the device camera.
 *
 * Deliberately low resolution and bitrate: this exists so you can see whether
 * your arms stayed locked and your hips stayed level, which needs far less
 * fidelity than real video — and clips are stored on-device where quota is
 * limited. Nothing is ever uploaded.
 */

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'denied' | 'unsupported'

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
]

function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m))
}

export function useFormRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  /** Open the camera and show a live preview, without recording yet. */
  const prepare = useCallback(async (): Promise<boolean> => {
    if (!supported) {
      setStatus('unsupported')
      return false
    }
    if (streamRef.current) return true
    setStatus('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        void videoRef.current.play().catch(() => {})
      }
      setStatus('idle')
      return true
    } catch {
      setStatus('denied')
      return false
    }
  }, [supported])

  const start = useCallback(async (): Promise<boolean> => {
    const ready = streamRef.current ? true : await prepare()
    if (!ready || !streamRef.current) return false
    try {
      const mimeType = pickMime()
      const rec = new MediaRecorder(streamRef.current, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 800_000,
      })
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.start(1000)
      recorderRef.current = rec
      setStatus('recording')
      return true
    } catch {
      setStatus('denied')
      return false
    }
  }, [prepare])

  /** Stop and hand back the clip; resolves null if nothing usable was captured. */
  const stop = useCallback((): Promise<Blob | null> => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') {
      setStatus('idle')
      return Promise.resolve(null)
    }
    return new Promise((resolve) => {
      rec.onstop = () => {
        const type = rec.mimeType || 'video/webm'
        const blob = chunksRef.current.length ? new Blob(chunksRef.current, { type }) : null
        chunksRef.current = []
        recorderRef.current = null
        setStatus('idle')
        resolve(blob && blob.size > 0 ? blob : null)
      }
      try {
        rec.stop()
      } catch {
        resolve(null)
      }
    })
  }, [])

  const release = useCallback(() => {
    // Idempotent on purpose: this is called from an effect, and setting state
    // when there is nothing to release would re-render into a loop.
    if (!recorderRef.current && !streamRef.current) return
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
    } catch {
      /* already gone */
    }
    recorderRef.current = null
    chunksRef.current = []
    stopStream()
    setStatus('idle')
  }, [stopStream])

  // Never leave the camera light on.
  useEffect(() => release, [release])

  // Stable identity — consumers use this in effect dependency lists.
  return useMemo(
    () => ({ status, supported, videoRef, prepare, start, stop, release }),
    [status, supported, prepare, start, stop, release],
  )
}
