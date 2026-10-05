import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * Records a short clip of a hold from the device camera.
 *
 * Deliberately low resolution and bitrate: this exists so you can see whether
 * your arms stayed locked and your hips stayed level, which needs far less
 * fidelity than real video — and clips are stored on-device where quota is
 * limited. Nothing is ever uploaded.
 */

/**
 * What the camera is actually doing — not what the athlete asked for.
 *
 * Filming *intent* (the switch) used to stand in for capture *readiness*: the
 * ready screen said "Filming this set" over a refused permission, and a camera
 * that opened five seconds into the hold silently started recording late. Each
 * of these is now its own state, and only `live` may start a filmed attempt.
 */
export type RecorderStatus =
  /** No camera open. */
  | 'off'
  /** Permission sheet or camera start in flight. */
  | 'starting'
  /** Preview running; a recording can start immediately. */
  | 'live'
  | 'recording'
  /** Permission refused (by the athlete, the browser or a policy). */
  | 'denied'
  /** No usable camera — none present, or none matching the request. */
  | 'unavailable'
  /** The camera exists but could not start, usually because another app holds it. */
  | 'busy'
  /** This browser cannot record video at all. */
  | 'unsupported'

export type CameraFailure = 'denied' | 'unavailable' | 'busy'

/** Which glass is in use, as far as the device will say. */
export type LensState = 'ultra-wide' | 'standard' | 'unknown'

const ULTRA_WIDE_LABEL = /ultra.?wide|0\.5|wide.?angle/i
const FRONT_LABEL = /front|user|face|selfie|facetime/i

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

/** Only the newest, non-retired camera request may publish state or clean up. */
export function ownsCameraAttempt(
  attempt: Promise<boolean>,
  pending: Promise<boolean> | null,
  generation: number,
  currentGeneration: number,
): boolean {
  return attempt === pending && generation === currentGeneration
}

/**
 * Turn a getUserMedia failure into something the athlete can act on.
 *
 * Every failure used to read as "Camera access was blocked", which sends
 * someone whose camera is merely in use by another app off to change
 * permissions that were never the problem.
 */
export function classifyCameraError(err: unknown): CameraFailure {
  const e = err as { name?: unknown; message?: unknown } | null | undefined
  const tag = `${typeof e?.name === 'string' ? e.name : ''} ${typeof e?.message === 'string' ? e.message : ''}`
  if (/NotAllowed|Security|Permission/i.test(tag)) return 'denied'
  if (/NotReadable|TrackStart|Abort|in use|busy/i.test(tag)) return 'busy'
  // NotFound, Overconstrained, DevicesNotFound and anything unrecognised.
  return 'unavailable'
}

/** What a lens label says about the glass, when it says anything. */
export function lensFromLabel(label: string | null | undefined): LensState {
  if (!label) return 'unknown'
  if (ULTRA_WIDE_LABEL.test(label)) return 'ultra-wide'
  return 'standard'
}

/**
 * Pick the rear ultra-wide from a device list, if one is identifiable.
 *
 * A front-facing "ultra wide" selfie camera is never a substitute: the
 * preference is for the widest *rear* view, and quietly swapping to the front
 * camera films the wrong side of the phone. Unlabelled lists (before any
 * permission has been granted) identify nothing.
 */
export function pickRearUltraWide(devices: Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>[]): string | null {
  const rear = devices.filter((d) => d.kind === 'videoinput' && d.label && !FRONT_LABEL.test(d.label))
  return rear.find((d) => ULTRA_WIDE_LABEL.test(d.label))?.deviceId ?? null
}

/**
 * Push an open camera to the widest view it is capable of.
 *
 * Two separate things narrow a phone camera: a zoom setting above its minimum,
 * and a capture mode that reads only part of the sensor. Both are negotiated
 * here *after* the camera is open, because capabilities cannot be read until
 * there is a live track to ask. Every step is best-effort — a camera that
 * refuses simply keeps the view it already gave us.
 */
async function maximiseFieldOfView(track: MediaStreamTrack): Promise<void> {
  const caps = track.getCapabilities?.() as
    | { width?: { max?: number }; height?: { max?: number }; zoom?: { min?: number } }
    | undefined
  if (!caps) return

  // Widest end of whatever zoom range this camera exposes. On phones that
  // present the ultra-wide as a zoom level rather than a separate device,
  // this is what actually gets you to 0.5x.
  if (typeof caps.zoom?.min === 'number') {
    await track
      .applyConstraints({ advanced: [{ zoom: caps.zoom.min } as MediaTrackConstraintSet] })
      .catch(() => {})
  }

  const maxW = caps.width?.max
  const maxH = caps.height?.max
  if (!maxW || !maxH) return
  // Full sensor readout rather than a cropped preview mode, scaled down to a
  // sane ceiling: the extra pixels beyond this buy no field of view, only
  // bigger clips and slower analysis. Aspect is preserved so nothing is cut.
  const CEILING = 1920
  const scale = Math.min(1, CEILING / Math.max(maxW, maxH))
  await track
    .applyConstraints({
      width: { ideal: Math.round(maxW * scale) },
      height: { ideal: Math.round(maxH * scale) },
    })
    .catch(() => {})
}

/** Whether a zoom below 1× is in effect — the other way phones expose 0.5×. */
function zoomedWide(track: MediaStreamTrack | undefined): boolean {
  const zoom = (track?.getSettings?.() as { zoom?: number } | undefined)?.zoom
  return typeof zoom === 'number' && zoom < 0.9
}

/**
 * Find the widest back lens the device will admit to having.
 *
 * Labels are vendor strings, not a spec, and they are blank until camera
 * permission has been granted — so this is asked again *after* the first
 * camera opens, and anything unidentifiable stays on the default back camera.
 */
export async function findUltraWideDeviceId(): Promise<string | null> {
  if (!navigator.mediaDevices?.enumerateDevices) return null
  try {
    return pickRearUltraWide(await navigator.mediaDevices.enumerateDevices())
  } catch {
    return null
  }
}

/** One recording and everything it owns. Nothing here is shared with the next one. */
interface Recording {
  rec: MediaRecorder
  chunks: BlobPart[]
}

export function useFormRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('off')
  /** Frame shape actually being delivered, from the live video when it can be read. */
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null)
  /** Label of the lens in use, so the UI can say which glass is active. */
  const [lensLabel, setLensLabel] = useState<string | null>(null)
  const [zoomWide, setZoomWide] = useState(false)
  /** Prefer the ultra-wide lens. Held in a ref so reopening reads it live. */
  const [wide, setWideState] = useState(true)
  const wideRef = useRef(true)
  const streamRef = useRef<MediaStream | null>(null)
  /** The recording in progress, if any. Cleared the moment it is asked to stop. */
  const currentRef = useRef<Recording | null>(null)
  /** Recordings still finalising; a stream they use is not stopped under them. */
  const finalizingRef = useRef<Set<Promise<Blob | null>>>(new Set())
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const detachVideoRef = useRef<(() => void) | null>(null)
  /** In-flight getUserMedia, so two callers never open two cameras. */
  const openingRef = useRef<Promise<boolean> | null>(null)
  /** Invalidates camera permission requests that resolve after release/unmount. */
  const openGenerationRef = useRef(0)
  const mountedRef = useRef(true)

  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'

  const publish = useCallback((next: RecorderStatus) => {
    if (mountedRef.current) setStatus(next)
  }, [])

  /** Read the delivered frame shape — the video element first, the track's claim second. */
  const readFrame = useCallback(() => {
    if (!mountedRef.current) return
    const el = videoRef.current
    if (el && el.videoWidth > 0 && el.videoHeight > 0 && el.srcObject === streamRef.current) {
      setFrame((current) =>
        current && current.width === el.videoWidth && current.height === el.videoHeight
          ? current
          : { width: el.videoWidth, height: el.videoHeight },
      )
      return
    }
    const settings = streamRef.current?.getVideoTracks()[0]?.getSettings?.()
    if (settings?.width && settings?.height) {
      const { width, height } = settings
      setFrame((current) => (current && current.width === width && current.height === height ? current : { width, height }))
    }
  }, [])

  /**
   * Stop one specific stream — never "whatever is current".
   *
   * A deferred stop used to act on the current stream when it finally ran,
   * which by then could be the *next* set's camera.
   */
  const stopTracks = useCallback((stream: MediaStream | null) => {
    stream?.getTracks().forEach((t) => t.stop())
  }, [])

  const dropStream = useCallback(() => {
    const stream = streamRef.current
    streamRef.current = null
    if (mountedRef.current) {
      setFrame(null)
      setLensLabel(null)
      setZoomWide(false)
    }
    return stream
  }, [])

  /**
   * Point the preview element at the live stream.
   *
   * Called from both the open path and the ref callback, because the two can
   * happen in either order: the element mounts and unmounts with the ready
   * screen while the stream outlives it, so a preview that only ever attached
   * inside getUserMedia's callback rendered black on every set after the first.
   */
  const attachPreview = useCallback(
    (el: HTMLVideoElement | null) => {
      if (!el || !streamRef.current) return
      if (el.srcObject !== streamRef.current) el.srcObject = streamRef.current
      void el.play?.()?.catch?.(() => {
        /* autoplay refused — the frame still updates once visible */
      })
      readFrame()
    },
    [readFrame],
  )

  /** Ref callback for the preview <video>; attaches the stream and watches its real shape. */
  const previewRef = useCallback(
    (el: HTMLVideoElement | null) => {
      detachVideoRef.current?.()
      detachVideoRef.current = null
      videoRef.current = el
      if (!el) return
      // The frame shape was sampled once, at opening, so a phone turned on
      // its side kept "turn the phone on its side" advice and the old aspect
      // box. The element reports its intrinsic size whenever it changes.
      const onShape = () => readFrame()
      el.addEventListener('loadedmetadata', onShape)
      el.addEventListener('resize', onShape)
      detachVideoRef.current = () => {
        el.removeEventListener('loadedmetadata', onShape)
        el.removeEventListener('resize', onShape)
      }
      attachPreview(el)
    },
    [attachPreview, readFrame],
  )

  // A rotated phone can keep the same encoded size until the next frame; the
  // track's settings are re-read too, as corroboration.
  useEffect(() => {
    const onTurn = () => window.setTimeout(readFrame, 250)
    window.addEventListener('orientationchange', onTurn)
    window.addEventListener('resize', onTurn)
    return () => {
      window.removeEventListener('orientationchange', onTurn)
      window.removeEventListener('resize', onTurn)
    }
  }, [readFrame])

  /** Open the camera and show a live preview, without recording yet. */
  const prepare = useCallback((): Promise<boolean> => {
    if (!supported) {
      publish('unsupported')
      return Promise.resolve(false)
    }
    if (streamRef.current) {
      if (streamRef.current.getVideoTracks().some((track) => track.readyState === 'live')) {
        // Re-point the preview: this early return is hit when the ready screen
        // comes back with a fresh <video> over a stream that never closed.
        attachPreview(videoRef.current)
        if (!currentRef.current) publish('live')
        return Promise.resolve(true)
      }
      stopTracks(dropStream())
    }
    // getUserMedia can take seconds behind a permission sheet. Without this
    // guard, tapping Start mid-request opens a second camera and orphans the
    // first stream — leaving the camera indicator on for good.
    if (openingRef.current) return openingRef.current

    publish('starting')
    const generation = ++openGenerationRef.current
    const owns = () => ownsCameraAttempt(attempt, openingRef.current, generation, openGenerationRef.current)
    let attempt!: Promise<boolean>
    attempt = (async () => {
      // A previous recording still finalising keeps its tracks until done;
      // opening a second camera under it fails on some phones.
      if (finalizingRef.current.size) await Promise.allSettled([...finalizingRef.current])
      // No size and no aspect ratio asked for, on purpose.
      //
      // Every constraint here is a licence to crop. Asking an upright phone
      // for 16:9 does not rotate it — the browser satisfies the ratio by
      // cutting the sensor down. `resizeMode: 'none'` asks for the native
      // frame rather than a cropped-and-rescaled one; the resolution is then
      // negotiated upward from the camera's own capabilities.
      const base: MediaTrackConstraints = {
        frameRate: { ideal: 24 },
        ...({ resizeMode: 'none' } as MediaTrackConstraints),
      }
      const open = (video: MediaTrackConstraints) => navigator.mediaDevices.getUserMedia({ video, audio: false })
      const wanted = wideRef.current ? await findUltraWideDeviceId() : null
      let stream: MediaStream
      try {
        stream = await open(wanted ? { ...base, deviceId: { exact: wanted } } : { ...base, facingMode: 'environment' })
      } catch (err) {
        // A specific lens can be busy or refused; the shot matters more than
        // the glass, so fall back to the default back camera.
        if (!wanted) throw err
        stream = await open({ ...base, facingMode: 'environment' })
      }
      // Labels only exist after permission, so on a first grant the lookup
      // above found nothing. Ask again now, and move to an identified rear
      // ultra-wide if the default camera is not it.
      if (wideRef.current && !wanted && owns()) {
        const current = stream.getVideoTracks()[0]
        if (lensFromLabel(current?.label) !== 'ultra-wide') {
          const found = await findUltraWideDeviceId()
          const currentId = (current?.getSettings?.() as { deviceId?: string } | undefined)?.deviceId
          if (found && found !== currentId && owns()) {
            stopTracks(stream)
            try {
              stream = await open({ ...base, deviceId: { exact: found } })
            } catch {
              stream = await open({ ...base, facingMode: 'environment' })
            }
          }
        }
      }
      return stream
    })()
      .then(async (stream) => {
        if (!owns()) {
          stopTracks(stream)
          return false
        }
        if (streamRef.current) {
          // Lost a race with another caller — drop this one rather than leak.
          stopTracks(stream)
          return true
        }
        streamRef.current = stream
        attachPreview(videoRef.current)
        const track = stream.getVideoTracks()[0]
        if (wideRef.current && track) await maximiseFieldOfView(track)
        // `applyConstraints` can keep this continuation suspended while the
        // athlete switches lenses or filming off. Do not let the retired
        // request overwrite the replacement stream's frame/status afterwards.
        if (!owns() || streamRef.current !== stream) {
          if (streamRef.current === stream) streamRef.current = null
          stopTracks(stream)
          return false
        }
        // A camera revoked or unplugged mid-session ends its track. Say so,
        // instead of leaving a black preview that still claims to be filming.
        track?.addEventListener?.('ended', () => {
          if (streamRef.current !== stream) return
          dropStream()
          if (!currentRef.current) publish('unavailable')
        })
        readFrame()
        if (mountedRef.current) {
          setLensLabel(track?.label ?? null)
          setZoomWide(zoomedWide(track))
        }
        publish('live')
        return true
      })
      .catch((err) => {
        // A retired request can reject after a replacement has already opened.
        // Its error must not turn the working camera into a failure screen.
        if (!owns()) return false
        publish(classifyCameraError(err))
        return false
      })
      .finally(() => {
        // An older request finishing after a replacement must not clear the
        // replacement's in-flight guard.
        if (openingRef.current === attempt) openingRef.current = null
      })

    openingRef.current = attempt
    return attempt
  }, [supported, attachPreview, dropStream, publish, readFrame, stopTracks])

  /**
   * Begin recording — only from a camera that is live right now.
   *
   * This used to open the camera itself when none was ready, so a permission
   * sheet answered five seconds into a hold produced a clip that started five
   * seconds late and was judged as if it were the whole hold. A filmed attempt
   * now needs a live preview first; otherwise it is a timer-only attempt.
   */
  const start = useCallback(async (): Promise<boolean> => {
    if (currentRef.current) return true
    const stream = streamRef.current
    if (!stream || !stream.getVideoTracks().some((track) => track.readyState === 'live')) {
      if (stream) stopTracks(dropStream())
      publish(supported ? 'off' : 'unsupported')
      return false
    }
    try {
      const mimeType = pickRecorderMime()
      const rec = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 800_000,
      })
      // Each recording keeps its own buffer. A shared one was reset by the
      // next start, so a slow finalisation lost everything but its last chunk.
      const recording: Recording = { rec, chunks: [] }
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) recording.chunks.push(e.data)
      }
      rec.start(1000)
      currentRef.current = recording
      publish('recording')
      return true
    } catch {
      // Construction/codec errors are not a permission denial, and a failed
      // recorder must never leave the camera indicator burning.
      stopTracks(dropStream())
      publish('unsupported')
      return false
    }
  }, [supported, dropStream, publish, stopTracks])

  /** Stop and hand back the clip; resolves null if nothing usable was captured. */
  const stop = useCallback((): Promise<Blob | null> => {
    const recording = currentRef.current
    // Released immediately: a new recording may start while this one finalises.
    currentRef.current = null
    if (!recording || recording.rec.state === 'inactive') {
      if (recording === null) publish(streamRef.current ? 'live' : 'off')
      return Promise.resolve(null)
    }
    publish(streamRef.current ? 'live' : 'off')
    const { rec, chunks } = recording
    const finished = new Promise<Blob | null>((resolve) => {
      let settled = false
      const finish = (blob: Blob | null) => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        resolve(blob && blob.size > 0 ? blob : null)
      }
      rec.onstop = () => {
        const type = rec.mimeType || 'video/webm'
        finish(chunks.length ? new Blob(chunks, { type }) : null)
      }
      rec.onerror = () => finish(null)
      const timeout = window.setTimeout(() => finish(chunks.length ? new Blob(chunks, { type: rec.mimeType || 'video/webm' }) : null), 5000)
      try {
        // Some mobile recorders otherwise omit the final partial timeslice.
        // requestData flushes it before stop emits the terminal chunk.
        if (rec.state === 'recording') rec.requestData()
        rec.stop()
      } catch {
        finish(null)
      }
    })
    finalizingRef.current.add(finished)
    void finished.finally(() => finalizingRef.current.delete(finished))
    return finished
  }, [publish])

  /**
   * Close the camera. Anything still finalising keeps *its own* stream until
   * it is done; a camera opened afterwards is never touched by that cleanup.
   */
  const release = useCallback(() => {
    openGenerationRef.current++
    const wasOpening = openingRef.current !== null
    // Retire it immediately. Re-enabling filming should open a fresh camera,
    // not await a request whose generation release() just invalidated.
    openingRef.current = null
    const recording = currentRef.current
    currentRef.current = null
    if (recording && recording.rec.state !== 'inactive') {
      // Abandoned mid-recording (unmount, page hidden): the footage is not
      // kept, but the recorder must not keep the tracks alive.
      try {
        recording.rec.ondataavailable = null
        recording.rec.stop()
      } catch {
        /* already gone */
      }
    }
    const stream = streamRef.current
    // Idempotent on purpose: this is called from an effect, and setting state
    // when there is nothing to release would re-render into a loop.
    if (!stream && !recording) {
      if (wasOpening) publish('off')
      return
    }
    dropStream()
    publish('off')
    const pending = [...finalizingRef.current]
    if (pending.length) void Promise.allSettled(pending).then(() => stopTracks(stream))
    else stopTracks(stream)
  }, [dropStream, publish, stopTracks])

  // Never leave the camera light on, even if a stop is still in flight.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      openGenerationRef.current++
      openingRef.current = null
      const recording = currentRef.current
      currentRef.current = null
      try {
        if (recording && recording.rec.state !== 'inactive') recording.rec.stop()
      } catch {
        /* already gone */
      }
      const stream = streamRef.current
      streamRef.current = null
      stopTracks(stream)
      detachVideoRef.current?.()
    }
  }, [stopTracks])

  // A frame taller than it is wide means the phone is standing upright, which
  // crops a horizontal body down to whatever fits between the long edges.
  const portrait = frame !== null && frame.height > frame.width
  /** The lens in use, from the device's own label or an applied sub-1× zoom. */
  const lens: LensState = zoomWide ? 'ultra-wide' : lensFromLabel(lensLabel)
  /** Back-compat convenience for callers that only need yes/no. */
  const onWideLens = lens === 'ultra-wide'

  /** Switch lens preference and reopen the camera on the new one. */
  const setWide = useCallback(
    (next: boolean) => {
      wideRef.current = next
      setWideState(next)
      if (!streamRef.current && !openingRef.current) return
      // Retire any open still in flight before reopening. Without this, a tap
      // during the permission or camera-open delay would be handed back the
      // *previous* lens's pending request, so the switch silently did nothing.
      if (currentRef.current) return // never swap glass mid-recording
      openGenerationRef.current++
      openingRef.current = null
      stopTracks(dropStream())
      void prepare()
    },
    [prepare, dropStream, stopTracks],
  )

  // Stable identity — consumers use this in effect dependency lists.
  return useMemo(
    () => ({
      status,
      supported,
      videoRef,
      previewRef,
      frame,
      portrait,
      wide,
      setWide,
      lens,
      onWideLens,
      lensLabel,
      prepare,
      start,
      stop,
      release,
    }),
    [status, supported, previewRef, frame, portrait, wide, setWide, lens, onWideLens, lensLabel, prepare, start, stop, release],
  )
}
