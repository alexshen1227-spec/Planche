import { useEffect, useRef, useState, type RefObject } from 'react'
import { getBackend, poseModelReady, trackingScore, type Kp } from '../lib/poseBackend'
import { Icon } from './Icon'

/**
 * Live check that the camera can actually see the athlete, run on the ready-
 * screen preview before the set starts.
 *
 * The single most common reason a filmed set comes back ungradeable is
 * placement — feet cropped, body half out of shot — and today that is only
 * discovered *after* the hold, when the effort is already spent. This runs
 * the same pose model on the live preview at a low rate and says, before the
 * athlete commits, whether the framing will survive analysis.
 *
 * Deliberately conservative about cost and failure: it only runs when a pose
 * model is already cached on this device (the same gate warming uses), checks
 * ~1.5 times a second, and disappears silently if the model cannot load —
 * a framing hint must never block a workout.
 */

interface Region {
  key: 'shoulders' | 'hands' | 'hips' | 'feet'
  label: string
  joints: [string, string]
}

const REGIONS: Region[] = [
  { key: 'shoulders', label: 'shoulders', joints: ['left_shoulder', 'right_shoulder'] },
  { key: 'hands', label: 'hands', joints: ['left_wrist', 'right_wrist'] },
  { key: 'hips', label: 'hips', joints: ['left_hip', 'right_hip'] },
  { key: 'feet', label: 'feet', joints: ['left_ankle', 'right_ankle'] },
]

const MIN_SCORE = 0.3

interface Reading {
  kps: Kp[]
  width: number
  height: number
  person: boolean
  missing: string[]
}

export function FramingCheck({
  videoRef,
  active,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  active: boolean
}) {
  const [reading, setReading] = useState<Reading | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // The model is only borrowed when it is already on the device — this check
  // must never be the thing that triggers a multi-megabyte download.
  const [available] = useState(() => poseModelReady())

  useEffect(() => {
    if (!active || !available) {
      setReading(null)
      return
    }
    let cancelled = false
    let busy = false
    const tick = async () => {
      if (busy || cancelled) return
      const video = videoRef.current
      if (!video || video.readyState < 2 || !video.videoWidth) return
      busy = true
      try {
        const backend = await getBackend('mediapipe')
        const kps = await backend.estimate(video)
        if (cancelled) return
        const seen = (names: [string, string]) =>
          names.some((n) => (kps.find((k) => k.name === n)?.score ?? 0) >= MIN_SCORE)
        setReading({
          kps,
          width: video.videoWidth,
          height: video.videoHeight,
          person: trackingScore(kps) > 0.15,
          missing: REGIONS.filter((r) => !seen(r.joints)).map((r) => r.label),
        })
      } catch {
        // Offline or model failure: the check just stays quiet.
        if (!cancelled) setReading(null)
      } finally {
        busy = false
      }
    }
    const timer = window.setInterval(() => void tick(), 700)
    void tick()
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [active, available, videoRef])

  // Dots over the joints the model currently sees, so "out of shot" is
  // visible rather than asserted.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const box = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(box.width * dpr)
    canvas.height = Math.round(box.height * dpr)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!reading || !reading.person) return
    const scale = Math.min((box.width * dpr) / reading.width, (box.height * dpr) / reading.height)
    const ox = (canvas.width - reading.width * scale) / 2
    const oy = (canvas.height - reading.height * scale) / 2
    ctx.fillStyle = 'rgba(34,211,238,0.9)'
    for (const k of reading.kps) {
      if ((k.score ?? 0) < MIN_SCORE) continue
      ctx.beginPath()
      ctx.arc(ox + k.x * scale, oy + k.y * scale, 2.5 * dpr, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [reading])

  if (!active || !available || !reading) return null

  const good = reading.person && reading.missing.length === 0
  return (
    <>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
      <div
        role="status"
        className={`absolute left-2 top-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold shadow-lg backdrop-blur ${
          good ? 'bg-black/70 text-emerald-300' : 'bg-black/70 text-amber-300'
        }`}
      >
        <Icon name={good ? 'check' : 'monitor'} size={13} />
        {good
          ? 'Whole body in frame'
          : reading.person
            ? `Out of shot: ${reading.missing.join(', ')}`
            : 'Step back until your whole body fits'}
      </div>
    </>
  )
}
