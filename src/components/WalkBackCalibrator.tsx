import { useEffect, useRef, useState } from 'react'
import { primeSignal, releaseSignal, signalTone } from '../lib/audio'
import { WALK_BACK_MAX_SEC, WALK_BACK_MIN_SEC } from '../lib/sessionTiming'

/**
 * Measures the walk back to a phone across the room: start at the phone, get
 * into position, and on the beep come out, walk back and tap Stop. Three
 * walks, the slowest kept — the allowance should cover a normal day's walk,
 * not the quickest one.
 */
export function WalkBackCalibrator({ onDone }: { onDone: (sec: number) => void }) {
  const TRIALS = 3
  const [stage, setStage] = useState<'idle' | 'positioning' | 'go' | 'done'>('idle')
  const [times, setTimes] = useState<number[]>([])
  const goAtRef = useRef(0)
  const timerRef = useRef<number | undefined>(undefined)
  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current)
      releaseSignal()
    },
    [],
  )

  const start = () => {
    primeSignal()
    setStage('positioning')
    window.clearTimeout(timerRef.current)
    // Long enough to walk to the spot and settle into the hold.
    timerRef.current = window.setTimeout(
      () => {
        goAtRef.current = Date.now()
        setStage('go')
        signalTone()
      },
      10_000 + Math.random() * 3000,
    )
  }
  const stop = () => {
    const next = [...times, Date.now() - goAtRef.current]
    setTimes(next)
    setStage(next.length >= TRIALS ? 'done' : 'idle')
  }
  const cancel = () => {
    window.clearTimeout(timerRef.current)
    setStage('idle')
  }
  const slowest = times.length ? Math.max(...times) / 1000 : 0
  const measured = Math.min(WALK_BACK_MAX_SEC, Math.max(WALK_BACK_MIN_SEC, Math.ceil(slowest * 10) / 10))

  return (
    <div className="p-6">
      <div className="pr-10">
        <h2 className="font-display text-[20px] font-bold text-ink">Measure your walk back</h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink2">
          Set the phone where it films from. Tap Start, walk to your spot and get into your hold position, hands down.
          At the beep, come out of it, walk back and tap Stop — exactly as after a real hold. Three walks; the slowest
          is kept.
        </p>
      </div>
      <button
        onClick={stage === 'go' ? stop : stage === 'positioning' ? cancel : stage === 'idle' ? start : undefined}
        disabled={stage === 'done'}
        className={`mt-4 grid h-44 w-full place-items-center rounded-2xl border-2 px-4 text-center transition ${
          stage === 'go' ? 'border-transparent text-on-accent' : 'border-line bg-raised text-ink'
        }`}
        style={stage === 'go' ? { background: 'var(--t-btn-accent)' } : undefined}
      >
        <span className="font-display text-[19px] font-semibold">
          {stage === 'idle'
            ? times.length
              ? `Walk ${times.length + 1} of ${TRIALS} — tap to start`
              : 'Tap to start'
            : stage === 'positioning'
              ? 'Get into position… the beep comes in about ten seconds (tap to cancel)'
              : stage === 'go'
                ? 'STOP'
                : `Slowest walk ${slowest.toFixed(1)}s`}
        </span>
      </button>
      <div className="mt-2 flex justify-center gap-1.5">
        {Array.from({ length: TRIALS }, (_, i) => (
          <span key={i} className={`h-1.5 w-8 rounded-full ${i < times.length ? 'bg-accent' : 'bg-line'}`} />
        ))}
      </div>
      {stage === 'done' ? (
        <button
          onClick={() => onDone(measured)}
          className="mt-4 w-full rounded-2xl px-6 py-3.5 font-display text-[16px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
          style={{ background: 'var(--t-btn-accent)' }}
        >
          Use {measured.toFixed(1)}s
        </button>
      ) : (
        <p className="mt-3 text-center text-[12.5px] text-ink3">
          The beep plays even with sounds off. A filmed hold still never counts for more than the camera saw.
        </p>
      )}
    </div>
  )
}
