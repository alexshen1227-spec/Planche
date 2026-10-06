import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  apparentBodyWidthRatio,
  getBackend,
  MAX_SIDE_VIEW_RATIO,
  poseModelReady,
  trackingScore,
  type Kp,
} from '../lib/poseBackend'
import { floorEdge, type FloorEdge } from '../lib/poseForm'
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
  key: 'shoulders' | 'elbows' | 'hands' | 'hips' | 'feet'
  label: string
  joints: [string, string]
}

const REGIONS: Region[] = [
  { key: 'shoulders', label: 'shoulders', joints: ['left_shoulder', 'right_shoulder'] },
  { key: 'elbows', label: 'elbows', joints: ['left_elbow', 'right_elbow'] },
  { key: 'hands', label: 'hands', joints: ['left_wrist', 'right_wrist'] },
  { key: 'hips', label: 'hips', joints: ['left_hip', 'right_hip'] },
  { key: 'feet', label: 'feet', joints: ['left_ankle', 'right_ankle'] },
]

const MIN_SCORE = 0.3
/** A joint this close to the frame edge is about to leave it. */
const EDGE_MARGIN = 0.02

interface Reading {
  kps: Kp[]
  width: number
  height: number
  person: boolean
  missing: string[]
  /** Same validity contract as the judge: side-on, not side-on, or cannot tell. */
  view: 'side' | 'not-side' | 'unknown'
  /** Where the floor is in the preview, over the last few readings; null until known. */
  floor: FloorEdge | null
}

/** Readings the floor decision is taken over — the judge's own rule needs a few moments. */
const FLOOR_WINDOW = 5

/**
 * The judge's side-view gate, applied live. An unmeasurable span used to read
 * as zero — "side view" — so a far side too faint to measure was announced as
 * a confirmed side-on shot. Now it is checked at the looser bar too, and what
 * still cannot be measured is said to be unknown.
 */
export function viewOf(kps: Kp[]): Reading['view'] {
  const ratio = apparentBodyWidthRatio(kps) ?? apparentBodyWidthRatio(kps, MIN_SCORE)
  if (ratio === undefined) return 'unknown'
  return ratio > MAX_SIDE_VIEW_RATIO ? 'not-side' : 'side'
}

/** Seen with confidence *and* actually inside the frame — models place joints off-screen too. */
function inFrame(k: Kp | undefined, width: number, height: number): boolean {
  if (!k || (k.score ?? 0) < MIN_SCORE) return false
  const mx = width * EDGE_MARGIN
  const my = height * EDGE_MARGIN
  return k.x >= mx && k.x <= width - mx && k.y >= my && k.y <= height - my
}

export function FramingCheck({
  videoRef,
  active,
  onFloorChange,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  active: boolean
  /**
   * Where the floor sits in the live picture, once known. The player uses it
   * to stop asking for the phone to be turned on its side after it has been:
   * with rotation lock on, the preview stays portrait even then.
   */
  onFloorChange?: (floor: FloorEdge | null) => void
}) {
  const [reading, setReading] = useState<Reading | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const recent = useRef<Kp[][]>([])
  const onFloorRef = useRef(onFloorChange)
  onFloorRef.current = onFloorChange
  // The model is only borrowed when it is already on the device — this check
  // must never be the thing that triggers a multi-megabyte download.
  const [available] = useState(() => poseModelReady())

  useEffect(() => {
    if (!active || !available) {
      setReading(null)
      recent.current = []
      onFloorRef.current?.(null)
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
        const width = video.videoWidth
        const height = video.videoHeight
        const seen = (names: [string, string]) =>
          names.some((n) => inFrame(kps.find((k) => k.name === n), width, height))
        const person = trackingScore(kps) > 0.15
        if (person) recent.current = [...recent.current, kps].slice(-FLOOR_WINDOW)
        // The judge's own rule, over the last few readings — one frame of a
        // live preview is too little to say which way the floor is.
        const floor = floorEdge(recent.current.map((points) => ({ kps: points })))
        onFloorRef.current?.(floor)
        setReading({
          kps,
          width,
          height,
          person,
          missing: REGIONS.filter((r) => !seen(r.joints)).map((r) => r.label),
          view: viewOf(kps),
          floor,
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
      recent.current = []
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

  const inShot = reading.person && reading.missing.length === 0
  const good = inShot && reading.view === 'side'
  const onItsSide = reading.floor === 'left' || reading.floor === 'right'
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
        {!reading.person
          ? 'Step back until your whole body fits'
          : reading.view === 'not-side'
            ? 'Turn fully side-on to the camera'
            : reading.missing.length
              ? `Out of shot: ${reading.missing.join(', ')}`
              : good
                ? onItsSide
                  ? 'Side-on · whole body in frame · phone on its side is fine'
                  : 'Side-on · whole body in frame'
                : 'Whole body in frame · side-on view not confirmed'}
      </div>
    </>
  )
}
