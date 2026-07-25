import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getClipBlob } from '../lib/clips'
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
}: ClipPlayerProps) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [expanded, setExpanded] = useState(false)
  const inlineRef = useRef<HTMLVideoElement | null>(null)

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
        <button
          onClick={() => setExpanded(true)}
          aria-label="Review clip fullscreen"
          title="Review fullscreen"
          className="absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-white/20 bg-black/75 px-2.5 py-1.5 text-[11.5px] font-semibold text-white shadow-lg backdrop-blur hover:bg-black/90"
        >
          <Icon name="monitor" size={13} /> Review
        </button>
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
  onClose,
}: {
  url: string
  label: string
  initialTime: number
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
      <div className="min-h-0 flex-1">
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
