import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { getClipBlob } from '../lib/clips'
import { replayKeypointsAtTime, type PoseTrack } from '../lib/poseForm'
import type { FormIssue } from '../types'
import { Icon } from './Icon'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; blob: Blob; url: string }
  | { kind: 'missing' }
  | { kind: 'playback-error'; blob: Blob; url: string }

interface ClipPlayerProps {
  clipKey: string
  className?: string
  label?: string
  onAvailabilityChange?: (available: boolean) => void
  /** The fullscreen reviewer opened or closed. */
  onReviewOpenChange?: (open: boolean) => void
  /** Sampled poses from the analysis, drawn over the replay when present. */
  overlay?: PoseTrack | null
  /** Faults found — the joints involved are drawn in the warning colour. */
  overlayIssues?: FormIssue[]
  /** Offer marking where the hold started and ended, in the fullscreen reviewer. */
  onMarkInterval?: (interval: ClipInterval) => void
  /** The interval already marked on this clip, if any. */
  markedInterval?: ClipInterval
}

/** A stretch of the clip, in clip seconds. */
export interface ClipInterval {
  startSec: number
  endSec: number
}

/** Shortest hold the reviewer will time — below it the marks are noise. */
const MIN_MARKED_HOLD_SEC = 0.5

/** Limb connections drawn between tracked joints. */
const BONES: [string, string][] = [
  ['left_ear', 'left_shoulder'],
  ['right_ear', 'right_shoulder'],
  ['left_shoulder', 'right_shoulder'],
  ['left_shoulder', 'left_elbow'],
  ['left_elbow', 'left_wrist'],
  ['right_shoulder', 'right_elbow'],
  ['right_elbow', 'right_wrist'],
  ['left_shoulder', 'left_hip'],
  ['right_shoulder', 'right_hip'],
  ['left_hip', 'right_hip'],
  ['left_hip', 'left_knee'],
  ['left_knee', 'left_ankle'],
  ['right_hip', 'right_knee'],
  ['right_knee', 'right_ankle'],
]

/** Which joints each fault implicates, for colouring the skeleton. */
const ISSUE_JOINTS: Partial<Record<FormIssue, string[]>> = {
  arms: ['left_elbow', 'right_elbow', 'left_wrist', 'right_wrist'],
  shrug: ['left_shoulder', 'right_shoulder', 'left_ear', 'right_ear'],
  sag: ['left_hip', 'right_hip'],
  pike: ['left_hip', 'right_hip'],
  hips: ['left_hip', 'right_hip'],
  level: ['left_hip', 'right_hip'],
  closed: ['left_hip', 'right_hip', 'left_knee', 'right_knee'],
  knees: ['left_knee', 'right_knee'],
  lean: ['left_shoulder', 'right_shoulder', 'left_wrist', 'right_wrist'],
  twist: ['left_shoulder', 'right_shoulder'],
}

/**
 * Draws the pose evidence the form judge actually used, synced to playback.
 *
 * The point is trust: a verdict like "elbows sat at 152°" is easy to argue
 * with until you can see exactly where the model thought your elbow was. It
 * also self-diagnoses bad visible-side tracking — dots off the athlete explain
 * a refused verdict faster than any copy. Hidden-side guesses stay in the raw
 * diagnostics instead of being connected into a second, misleading body.
 */
function PoseOverlay({
  videoRef,
  track,
  issues,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  track: PoseTrack
  issues: FormIssue[]
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let raf = 0
    const bad = new Set(issues.flatMap((i) => ISSUE_JOINTS[i] ?? []))
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas || !video) return
      const box = canvas.getBoundingClientRect()
      if (!box.width || !box.height) return
      const dpr = window.devicePixelRatio || 1
      const cw = Math.round(box.width * dpr)
      const ch = Math.round(box.height * dpr)
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw
        canvas.height = ch
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, cw, ch)

      // Blend adjacent analysed moments so the replay follows the athlete
      // instead of snapping between frozen samples. Real gaps stay blank.
      const keypoints = replayKeypointsAtTime(track, video.currentTime - (track.offsetSec ?? 0))
      if (!keypoints.length) return

      // The <video> renders object-contain: work out where the letterboxed
      // content actually sits so keypoints land on the body, not the bars.
      const scale = Math.min(box.width / track.width, box.height / track.height) * dpr
      const ox = (cw - track.width * scale) / 2
      const oy = (ch - track.height * scale) / 2
      const at = (name: string) => {
        const k = keypoints.find((p) => p.name === name)
        return k ? { x: ox + k.x * scale, y: oy + k.y * scale } : null
      }

      ctx.lineCap = 'round'
      for (const [a, b] of BONES) {
        const pa = at(a)
        const pb = at(b)
        if (!pa || !pb) continue
        const flagged = bad.has(a) || bad.has(b)
        ctx.strokeStyle = flagged ? 'rgba(248,113,113,0.95)' : 'rgba(34,211,238,0.85)'
        ctx.lineWidth = (flagged ? 3 : 2) * dpr
        ctx.beginPath()
        ctx.moveTo(pa.x, pa.y)
        ctx.lineTo(pb.x, pb.y)
        ctx.stroke()
      }
      for (const k of keypoints) {
        if (!k.name) continue
        const p = at(k.name)
        if (!p) continue
        ctx.fillStyle = bad.has(k.name) ? 'rgb(248,113,113)' : 'rgb(224,242,254)'
        ctx.beginPath()
        ctx.arc(p.x, p.y, (bad.has(k.name) ? 3.5 : 2.5) * dpr, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [videoRef, track, issues])

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
}

/**
 * Reliable local clip playback with an app-level fullscreen reviewer.
 * Stored bytes are read directly from IndexedDB and each object URL has one
 * clear owner, so gallery refreshes cannot revoke a URL while it is playing.
 */
export function ClipPlayer({
  clipKey,
  className = 'h-40 w-full rounded-lg',
  label = 'Form-check clip',
  onAvailabilityChange,
  onReviewOpenChange,
  overlay,
  overlayIssues,
  onMarkInterval,
  markedInterval,
}: ClipPlayerProps) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [expanded, setExpandedState] = useState(false)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const inlineRef = useRef<HTMLVideoElement | null>(null)
  const reviewButtonRef = useRef<HTMLButtonElement | null>(null)
  const hasOverlay = Boolean(overlay && overlay.frames.length)
  const reviewChangeRef = useRef(onReviewOpenChange)
  reviewChangeRef.current = onReviewOpenChange
  const setExpanded = useCallback((open: boolean) => {
    setExpandedState(open)
    reviewChangeRef.current?.(open)
  }, [])
  // A reviewer that unmounts while open (the clip was deleted, the row went
  // away) must not leave its owner believing review is still in progress.
  useEffect(
    () => () => {
      reviewChangeRef.current?.(false)
    },
    [],
  )
  /** Stable for the overlay's effects; closing returns focus to the opener. */
  const closeReview = useCallback(() => {
    setExpanded(false)
    window.setTimeout(() => reviewButtonRef.current?.focus(), 0)
  }, [setExpanded])

  useEffect(() => {
    let cancelled = false
    let ownedUrl: string | null = null
    setState({ kind: 'loading' })
    onAvailabilityChange?.(false)
    void getClipBlob(clipKey).then((blob) => {
      if (cancelled) return
      if (!blob || blob.size === 0) {
        onAvailabilityChange?.(false)
        setState({ kind: 'missing' })
        return
      }
      ownedUrl = URL.createObjectURL(blob)
      onAvailabilityChange?.(true)
      setState({ kind: 'ready', blob, url: ownedUrl })
    })
    return () => {
      cancelled = true
      if (ownedUrl) URL.revokeObjectURL(ownedUrl)
    }
  }, [clipKey, attempt, onAvailabilityChange])

  if (state.kind === 'loading') {
    return (
      <div className={`grid place-items-center bg-black text-[12px] text-white/60 ${className}`} role="status">
        Loading clip…
      </div>
    )
  }

  if (state.kind === 'missing') {
    return (
      <div className={`grid place-items-center bg-black p-4 text-center ${className}`}>
        <div>
          <p className="text-[12.5px] text-white/70">This clip is no longer available on this device.</p>
          <button
            onClick={() => setAttempt((n) => n + 1)}
            className="mt-2 rounded-lg border border-white/20 px-3 py-1.5 text-[12px] font-semibold text-white"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const playbackFailed = state.kind === 'playback-error'
  return (
    <>
      <div className={`group relative overflow-hidden bg-black ${className}`}>
        <video
          ref={inlineRef}
          key={`${clipKey}:${attempt}`}
          src={state.url}
          controls
          playsInline
          preload="metadata"
          aria-label={label}
          onError={() => setState({ kind: 'playback-error', blob: state.blob, url: state.url })}
          className="h-full w-full object-contain"
        />
        {hasOverlay && showSkeleton ? (
          <PoseOverlay videoRef={inlineRef} track={overlay!} issues={overlayIssues ?? []} />
        ) : null}
        <button
          ref={reviewButtonRef}
          onClick={() => setExpanded(true)}
          aria-label="Review clip fullscreen"
          title="Review fullscreen"
          className="absolute right-1.5 top-1.5 flex min-h-10 items-center gap-1 rounded-lg border border-white/20 bg-black/75 px-3 py-2 text-[12px] font-semibold text-white shadow-lg backdrop-blur hover:bg-black/90"
        >
          <Icon name="monitor" size={13} /> Review
        </button>
        {hasOverlay ? (
          <button
            onClick={() => setShowSkeleton((s) => !s)}
            aria-pressed={showSkeleton}
            aria-label="Toggle tracked skeleton"
            title="What the form checker saw"
            className={`absolute left-1.5 top-1.5 flex min-h-10 items-center gap-1 rounded-lg border px-3 py-2 text-[12px] font-semibold shadow-lg backdrop-blur ${
              showSkeleton
                ? 'border-accent/50 bg-black/75 text-accent-text'
                : 'border-white/20 bg-black/75 text-white hover:bg-black/90'
            }`}
          >
            <Icon name="sparkle" size={13} /> Skeleton
          </button>
        ) : null}
        {playbackFailed ? (
          <div className="absolute inset-x-2 bottom-10 rounded-lg bg-black/85 p-2.5 text-center text-[11.5px] text-white/80">
            <p>This browser could not play the saved format.</p>
            <div className="mt-2 flex justify-center gap-2">
              <button
                onClick={() => setAttempt((n) => n + 1)}
                className="rounded-md border border-white/20 px-2 py-1 font-semibold text-white"
              >
                Retry
              </button>
              <a
                href={state.url}
                download={`planche-form-${clipKey.replace(/[^a-z0-9-]/gi, '-')}.${state.blob.type.includes('mp4') ? 'mp4' : 'webm'}`}
                className="rounded-md border border-white/20 px-2 py-1 font-semibold text-white"
              >
                Download
              </a>
            </div>
          </div>
        ) : null}
      </div>
      {expanded
        ? createPortal(
            <ClipReviewOverlay
              url={state.url}
              label={label}
              initialTime={inlineRef.current?.currentTime ?? 0}
              overlay={hasOverlay && showSkeleton ? overlay! : null}
              overlayIssues={overlayIssues ?? []}
              onClose={closeReview}
              onMarkInterval={onMarkInterval}
              markedInterval={markedInterval}
            />,
            document.body,
          )
        : null}
    </>
  )
}

/** The frame step the buttons use. Captures ask for ~24fps and files vary, so it is approximate. */
const FRAME_STEP_SEC = 1 / 30

function ClipReviewOverlay({
  url,
  label,
  initialTime,
  overlay,
  overlayIssues,
  onClose,
  onMarkInterval,
  markedInterval,
}: {
  url: string
  label: string
  initialTime: number
  overlay?: PoseTrack | null
  overlayIssues?: FormIssue[]
  onClose: () => void
  onMarkInterval?: (interval: ClipInterval) => void
  markedInterval?: ClipInterval
}) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const [speed, setSpeed] = useState(1)
  const [markStart, setMarkStart] = useState<number | null>(markedInterval?.startSec ?? null)
  const [markEnd, setMarkEnd] = useState<number | null>(markedInterval?.endSec ?? null)
  const [markSaved, setMarkSaved] = useState(false)
  const markedLength = markStart !== null && markEnd !== null ? markEnd - markStart : null
  const markValid = markedLength !== null && markedLength >= MIN_MARKED_HOLD_SEC
  /**
   * Read through a ref, never a dependency. The session player re-renders ten
   * times a second, and with `onClose` in the dependency list this effect
   * re-ran on every tick — refocusing Close each time, so a keyboard user
   * could never stay on the speed or frame controls.
   */
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const step = (direction: 1 | -1) => {
      const video = videoRef.current
      if (!video) return
      video.pause()
      video.currentTime = Math.min(video.duration || Infinity, Math.max(0, video.currentTime + direction * FRAME_STEP_SEC))
    }
    // Capture phase, and the event stops here: this is the top layer. The
    // session's own shortcuts used to see the same key — Escape closed the
    // review *and* opened "Leave training session" underneath it.
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        step(-1)
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        step(1)
        return
      }
      if (event.key === 'Tab' && shellRef.current) {
        const focusable = [
          ...shellRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])'),
        ]
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (!shellRef.current.contains(document.activeElement)) {
          event.preventDefault()
          first.focus()
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey, true)
    }
  }, [])

  const enterDeviceFullscreen = async () => {
    const shell = shellRef.current
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    try {
      if (shell?.requestFullscreen) await shell.requestFullscreen()
      else video?.webkitEnterFullscreen?.()
    } catch {
      video?.webkitEnterFullscreen?.()
    }
  }

  return (
    <div
      ref={shellRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Fullscreen review: ${label}`}
      className="fixed inset-0 z-[200] flex flex-col bg-black"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 pb-2 pt-[max(env(safe-area-inset-top),8px)] text-white">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{label}</div>
          <div className="text-[10.5px] text-white/55">Arrow keys step about 1/30 s — roughly one frame</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => void enterDeviceFullscreen()}
            className="min-h-11 rounded-lg border border-white/20 px-3 py-2 text-[12px] font-semibold"
          >
            Device fullscreen
          </button>
          <button
            ref={closeRef}
            onClick={() => onCloseRef.current()}
            aria-label="Close fullscreen review"
            className="grid h-11 w-11 place-items-center rounded-lg border border-white/20"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <video
          ref={videoRef}
          src={url}
          controls
          autoPlay
          playsInline
          preload="auto"
          aria-label={label}
          onLoadedMetadata={(event) => {
            event.currentTarget.currentTime = Math.min(initialTime, event.currentTarget.duration || initialTime)
            event.currentTarget.playbackRate = speed
          }}
          className="h-full w-full object-contain"
        />
        {overlay && overlay.frames.length ? (
          <PoseOverlay videoRef={videoRef} track={overlay} issues={overlayIssues ?? []} />
        ) : null}
      </div>
      <div
        className={`flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-white/10 px-3 pt-2 text-white ${
          onMarkInterval ? 'pb-2' : 'pb-[max(env(safe-area-inset-bottom),8px)]'
        }`}
      >
        <button
          onClick={() => {
            if (!videoRef.current) return
            videoRef.current.pause()
            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - FRAME_STEP_SEC)
          }}
          aria-label="Step back about one frame"
          className="min-h-11 rounded-lg border border-white/20 px-3 py-2 text-[12px] font-semibold"
        >
          − ~1/30 s
        </button>
        {[0.25, 0.5, 1].map((value) => (
          <button
            key={value}
            onClick={() => {
              setSpeed(value)
              if (videoRef.current) videoRef.current.playbackRate = value
            }}
            aria-pressed={speed === value}
            className={`min-h-11 rounded-lg border px-3 py-2 text-[12px] font-semibold ${
              speed === value ? 'border-accent bg-accent text-on-accent' : 'border-white/20'
            }`}
          >
            {value}×
          </button>
        ))}
        <button
          onClick={() => {
            if (!videoRef.current) return
            videoRef.current.pause()
            videoRef.current.currentTime = Math.min(videoRef.current.duration || Infinity, videoRef.current.currentTime + FRAME_STEP_SEC)
          }}
          aria-label="Step forward about one frame"
          className="min-h-11 rounded-lg border border-white/20 px-3 py-2 text-[12px] font-semibold"
        >
          + ~1/30 s
        </button>
      </div>
      {onMarkInterval ? (
        // Timing from the footage: the hold's real start and end, frame by
        // frame, instead of the stopwatch minus a guessed walk-back. The
        // interval *is* the measurement, so nothing is taken off it.
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-white/10 px-3 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 text-white">
          <button
            onClick={() => {
              if (!videoRef.current) return
              videoRef.current.pause()
              setMarkStart(Math.round(videoRef.current.currentTime * 100) / 100)
              setMarkSaved(false)
            }}
            className="min-h-11 rounded-lg border border-white/20 px-3 py-2 text-[12px] font-semibold"
          >
            Hold started here{markStart !== null ? ` · ${markStart.toFixed(2)}s` : ''}
          </button>
          <button
            onClick={() => {
              if (!videoRef.current) return
              videoRef.current.pause()
              setMarkEnd(Math.round(videoRef.current.currentTime * 100) / 100)
              setMarkSaved(false)
            }}
            className="min-h-11 rounded-lg border border-white/20 px-3 py-2 text-[12px] font-semibold"
          >
            Hold ended here{markEnd !== null ? ` · ${markEnd.toFixed(2)}s` : ''}
          </button>
          <button
            onClick={() => {
              if (!markValid || markStart === null || markEnd === null) return
              onMarkInterval({ startSec: markStart, endSec: markEnd })
              setMarkSaved(true)
            }}
            disabled={!markValid}
            className="min-h-11 rounded-lg bg-accent px-3 py-2 text-[12px] font-semibold text-on-accent disabled:opacity-40"
          >
            {markSaved
              ? `Timed from the video · ${markedLength!.toFixed(1)}s`
              : markValid
                ? `Use ${markedLength!.toFixed(1)}s for this hold`
                : markedLength !== null && markedLength < MIN_MARKED_HOLD_SEC
                  ? 'End must come after the start'
                  : 'Mark the start and end'}
          </button>
          <p className="w-full text-center text-[10.5px] text-white/55" role="status">
            Step to the first frame you are fully in position, then the last. The timer’s reading is kept on record.
          </p>
        </div>
      ) : null}
    </div>
  )
}
