import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { getClipBlob } from '../lib/clips'
import type { PoseTrack } from '../lib/poseForm'
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
  /** Sampled poses from the analysis, drawn over the replay when present. */
  overlay?: PoseTrack | null
  /** Faults found — the joints involved are drawn in the warning colour. */
  overlayIssues?: FormIssue[]
}

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
 * Draws what the pose model saw over the replay, synced to playback time.
 *
 * The point is trust: a verdict like "elbows sat at 152°" is easy to argue
 * with until you can see exactly where the model thought your elbow was. It
 * also self-diagnoses bad tracking — dots on the curtains instead of the
 * athlete explain a refused verdict faster than any copy.
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

      // Nearest sampled pose to the playhead. Samples are sparse, so anything
      // further than ~0.7s is a gap, not a match — draw nothing rather than a
      // skeleton from the wrong moment.
      let frame: PoseTrack['frames'][number] | null = null
      let gap = 0.7
      for (const f of track.frames) {
        const d = Math.abs(f.t - video.currentTime)
        if (d < gap) {
          gap = d
          frame = f
        }
      }
      if (!frame) return

      // The <video> renders object-contain: work out where the letterboxed
      // content actually sits so keypoints land on the body, not the bars.
      const scale = Math.min(box.width / track.width, box.height / track.height) * dpr
      const ox = (cw - track.width * scale) / 2
      const oy = (ch - track.height * scale) / 2
      const at = (name: string) => {
        const k = frame!.kps.find((p) => p.name === name)
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
      for (const k of frame.kps) {
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
  overlay,
  overlayIssues,
}: ClipPlayerProps) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [expanded, setExpanded] = useState(false)
  const [showSkeleton, setShowSkeleton] = useState(true)
  const inlineRef = useRef<HTMLVideoElement | null>(null)
  const hasOverlay = Boolean(overlay && overlay.frames.length)

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
          onClick={() => setExpanded(true)}
          aria-label="Review clip fullscreen"
          title="Review fullscreen"
          className="absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-white/20 bg-black/75 px-2.5 py-1.5 text-[11.5px] font-semibold text-white shadow-lg backdrop-blur hover:bg-black/90"
        >
          <Icon name="monitor" size={13} /> Review
        </button>
        {hasOverlay ? (
          <button
            onClick={() => setShowSkeleton((s) => !s)}
            aria-pressed={showSkeleton}
            aria-label="Toggle tracked skeleton"
            title="What the form checker saw"
            className={`absolute left-2 top-2 flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold shadow-lg backdrop-blur ${
              showSkeleton
                ? 'border-accent/50 bg-black/75 text-accent'
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
              onClose={() => setExpanded(false)}
            />,
            document.body,
          )
        : null}
    </>
  )
}

function ClipReviewOverlay({
  url,
  label,
  initialTime,
  overlay,
  overlayIssues,
  onClose,
}: {
  url: string
  label: string
  initialTime: number
  overlay?: PoseTrack | null
  overlayIssues?: FormIssue[]
  onClose: () => void
}) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const [speed, setSpeed] = useState(1)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft' && videoRef.current) {
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 1 / 30)
      }
      if (event.key === 'ArrowRight' && videoRef.current) {
        videoRef.current.currentTime = Math.min(
          videoRef.current.duration || Infinity,
          videoRef.current.currentTime + 1 / 30,
        )
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

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
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-3 py-2 text-white">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{label}</div>
          <div className="text-[10.5px] text-white/55">Arrow keys step one frame while paused</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => void enterDeviceFullscreen()}
            className="rounded-lg border border-white/20 px-2.5 py-1.5 text-[11.5px] font-semibold"
          >
            Device fullscreen
          </button>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close fullscreen review"
            className="grid h-8 w-8 place-items-center rounded-lg border border-white/20"
          >
            <Icon name="x" size={16} />
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
      <div className="flex shrink-0 items-center justify-center gap-2 border-t border-white/10 px-3 py-2 text-white">
        <button
          onClick={() => {
            if (!videoRef.current) return
            videoRef.current.pause()
            videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 1 / 30)
          }}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-[12px] font-semibold"
        >
          − frame
        </button>
        {[0.25, 0.5, 1].map((value) => (
          <button
            key={value}
            onClick={() => {
              setSpeed(value)
              if (videoRef.current) videoRef.current.playbackRate = value
            }}
            aria-pressed={speed === value}
            className={`rounded-lg border px-3 py-1.5 text-[12px] font-semibold ${
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
            videoRef.current.currentTime = Math.min(
              videoRef.current.duration || Infinity,
              videoRef.current.currentTime + 1 / 30,
            )
          }}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-[12px] font-semibold"
        >
          + frame
        </button>
      </div>
    </div>
  )
}
