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
  // Chromium's WebM recorder is much more mature than its newer fragmented
  // MP4 path. Safari falls through to MP4 because it rejects WebM here.
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
]

export function selectRecorderMime(
  isSupported: (mime: string) => boolean,
): string | undefined {
  return MIME_CANDIDATES.find(isSupported)
}

export function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return selectRecorderMime((mime) => MediaRecorder.isTypeSupported(mime))
}

export function useFormRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  /** Frame shape actually granted, so the UI can ask for a better one. */
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const videoRef = useRef<HTMLVideoElement | null>(null)
  /** In-flight getUserMedia, so two callers never open two cameras. */
  const openingRef = useRef<Promise<boolean> | null>(null)
  /** In-flight stop, so teardown cannot destroy a clip mid-finalise. */
  const stoppingRef = useRef<Promise<Blob | null> | null>(null)
  /** Invalidates camera permission requests that resolve after release/unmount. */
  const openGenerationRef = useRef(0)

  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setFrame(null)
  }, [])

  /**
   * Point the preview element at the live stream.
   *
   * Called from both the open path and the ref callback, because the two can
   * happen in either order: the element mounts and unmounts with the ready
   * screen while the stream outlives it, so a preview that only ever attached
   * inside getUserMedia's callback rendered black on every set after the first.
   */
  const attachPreview = useCallback((el: HTMLVideoElement | null) => {
    if (!el || !streamRef.current) return
    if (el.srcObject !== streamRef.current) el.srcObject = streamRef.current
    void el.play().catch(() => {
      /* autoplay refused — the frame still updates once visible */
    })
  }, [])

  /** Ref callback for the preview <video>; attaches the stream on mount. */
  const previewRef = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el
      attachPreview(el)
    },
    [attachPreview],
  )

  /** Open the camera and show a live preview, without recording yet. */
  const prepare = useCallback((): Promise<boolean> => {
    if (!supported) {
      setStatus('unsupported')
      return Promise.resolve(false)
    }
    if (streamRef.current) {
      if (streamRef.current.getVideoTracks().some((track) => track.readyState === 'live')) {
        // Re-point the preview: this early return is hit when the ready screen
        // comes back with a fresh <video> over a stream that never closed.
        attachPreview(videoRef.current)
        return Promise.resolve(true)
      }
      stopStream()
    }
    // getUserMedia can take seconds behind a permission sheet. Without this
    // guard, tapping Start mid-request opens a second camera and orphans the
    // first stream — leaving the camera indicator on for good.
    if (openingRef.current) return openingRef.current

    setStatus('starting')
    const generation = ++openGenerationRef.current
    const attempt = navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: 'environment',
          // Resolution only — deliberately no aspectRatio constraint. Asking a
          // phone standing upright for 16:9 does not rotate it; the browser
          // satisfies the ratio by cropping the sensor instead, which narrows
          // the field of view exactly when you need all of it to fit a body.
          // Orientation is a physical property of how the phone is propped, so
          // it is handled by telling you to turn it, not by constraining here.
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24 },
        },
        audio: false,
      })
      .then((stream) => {
        if (generation !== openGenerationRef.current) {
          stream.getTracks().forEach((t) => t.stop())
          return false
        }
        if (streamRef.current) {
          // Lost a race with another caller — drop this one rather than leak.
          stream.getTracks().forEach((t) => t.stop())
          return true
        }
        streamRef.current = stream
        attachPreview(videoRef.current)
        const settings = stream.getVideoTracks()[0]?.getSettings()
        setFrame(
          settings?.width && settings?.height
            ? { width: settings.width, height: settings.height }
            : null,
        )
        setStatus('idle')
        return true
      })
      .catch(() => {
        setStatus('denied')
        return false
      })
      .finally(() => {
        openingRef.current = null
      })

    openingRef.current = attempt
    return attempt
  }, [supported])

  const start = useCallback(async (): Promise<boolean> => {
    const ready = streamRef.current ? true : await prepare()
    if (!ready || !streamRef.current) return false
    try {
      const mimeType = pickRecorderMime()
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
      // Construction/codec errors are not a permission denial, and a failed
      // recorder must never leave the camera indicator burning.
      stopStream()
      setStatus('unsupported')
      return false
    }
  }, [prepare, stopStream])

  /** Stop and hand back the clip; resolves null if nothing usable was captured. */
  const stop = useCallback((): Promise<Blob | null> => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') {
      setStatus('idle')
      return Promise.resolve(null)
    }
    const finished = new Promise<Blob | null>((resolve) => {
      let settled = false
      const finish = (blob: Blob | null) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        recorderRef.current = null
        setStatus('idle')
        resolve(blob && blob.size > 0 ? blob : null)
      }
      rec.onstop = () => {
        const type = rec.mimeType || 'video/webm'
        const blob = chunksRef.current.length ? new Blob(chunksRef.current, { type }) : null
        chunksRef.current = []
        finish(blob)
      }
      rec.onerror = () => finish(null)
      const timeout = window.setTimeout(() => finish(null), 5000)
      try {
        // Some mobile recorders otherwise omit the final partial timeslice.
        // requestData flushes it before stop emits the terminal chunk.
        if (rec.state === 'recording') rec.requestData()
        rec.stop()
      } catch {
        finish(null)
      }
    })
    stoppingRef.current = finished
    void finished.finally(() => {
      stoppingRef.current = null
    })
    return finished
  }, [])

  const teardown = useCallback(() => {
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

  const release = useCallback(() => {
    openGenerationRef.current++
    // Idempotent on purpose: this is called from an effect, and setting state
    // when there is nothing to release would re-render into a loop.
    if (!recorderRef.current && !streamRef.current) return
    // A stop() is still finalising the clip. Tearing down now would clear the
    // chunk buffer and kill the source tracks it depends on, silently losing
    // the recording the athlete just made.
    if (stoppingRef.current) {
      void stoppingRef.current.finally(() => teardown())
      return
    }
    teardown()
  }, [teardown])

  // Never leave the camera light on, even if a stop is still in flight.
  useEffect(
    () => () => {
      openGenerationRef.current++
      teardown()
    },
    [teardown],
  )

  // A frame taller than it is wide means the phone is standing upright, which
  // crops a horizontal body down to whatever fits between the long edges.
  const portrait = frame !== null && frame.height > frame.width

  // Stable identity — consumers use this in effect dependency lists.
  return useMemo(
    () => ({ status, supported, videoRef, previewRef, frame, portrait, prepare, start, stop, release }),
    [status, supported, previewRef, frame, portrait, prepare, start, stop, release],
  )
}
