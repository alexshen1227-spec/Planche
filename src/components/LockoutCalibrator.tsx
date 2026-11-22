import { useState } from 'react'
import { MIN_LOCKOUT_DEG } from '../lib/lockout'
import { ErrorState } from './ds'
import { lockoutFromVerdict, type LockoutMeasurement } from '../lib/lockoutCalibration'

/**
 * One-time lockout calibration (judge v8). A 2D pose model reads a locked
 * elbow short of 180° — by how much depends on the athlete and their camera —
 * so the bent-arm bars are measured from where *this* athlete's lockout reads.
 * The athlete films (or picks) a few seconds of a straight-arm support, side
 * on, elbows locked as hard as they go; the median reading becomes the
 * reference. A reading that is a bend in its own right is refused, never
 * stored, so calibrating cannot be used to excuse soft elbows.
 */
export function LockoutCalibrator({ onDone }: { onDone: (deg: number) => void }) {
  const [stage, setStage] = useState<'idle' | 'working' | 'result' | 'refused'>('idle')
  const [measured, setMeasured] = useState<LockoutMeasurement | null>(null)
  const [reason, setReason] = useState('')

  const analyse = async (file: File | undefined) => {
    if (!file) return
    setStage('working')
    try {
      const { analyseClipDetailed, judgeTrackedFrames } = await import('../lib/poseForm')
      const analysis = await analyseClipDetailed(file, 'lockout-check')
      if (!analysis.poses) {
        setReason(analysis.result.reason || 'The camera could not read a body in that clip.')
        setStage('refused')
        return
      }
      // Measure against a textbook 180 so the reading is the raw one.
      const judged = judgeTrackedFrames({ ...analysis.poses, lockoutDeg: 180 }, 'lockout-check', { explain: true })
      const result = lockoutFromVerdict(judged)
      if (result.kind === 'refused') {
        setReason(result.reason)
        setStage('refused')
        return
      }
      setMeasured(result)
      setStage('result')
    } catch (err) {
      setReason(err instanceof Error ? err.message : 'The clip could not be analysed.')
      setStage('refused')
    }
  }

  return (
    <div className="space-y-4 text-[14px] leading-relaxed text-ink2">
      <p>
        A phone camera reads a fully locked elbow a little short of 180°, and how far short depends on you and your
        phone. Film your own lockout once and bent-arm calls are measured from it.
      </p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Phone on its side, side-on to you, your whole body in the picture.</li>
        <li>Get into a support with straight arms — a plank on your hands, or a support on parallettes.</li>
        <li>Lock your elbows as straight as they go and hold still for about 5 seconds.</li>
      </ol>
      {stage === 'working' ? (
        <p className="rounded-xl border border-line bg-raised px-3.5 py-3 text-ink" role="status">
          Reading your elbows… the first check downloads the camera checker if it is not on this phone yet.
        </p>
      ) : null}
      {stage === 'result' && measured?.kind === 'measured' ? (
        <div className="space-y-3 rounded-xl border border-line bg-raised px-3.5 py-3" role="status">
          <p className="text-ink">
            Your locked arms read <strong>{measured.deg}°</strong> ({measured.readings} readings, spread ±
            {measured.spread}°).
          </p>
          <p>
            Bent arms will be named from about {measured.deg - 8}° down, instead of {173 - 8}° before calibrating.
            {measured.spread > 6 ? ' The readings moved around — a steadier phone gives a firmer number.' : ''}
          </p>
          <button
            onClick={() => onDone(measured.deg)}
            className="w-full rounded-xl bg-accent px-4 py-3 text-[15px] font-semibold text-on-accent"
          >
            Use {measured.deg}°
          </button>
        </div>
      ) : null}
      {stage === 'refused' ? <ErrorState title="That clip could not set your lockout">{reason}</ErrorState> : null}
      {stage !== 'working' ? (
        <label className="block cursor-pointer rounded-xl border border-line bg-raised px-4 py-3 text-center text-[15px] font-semibold text-ink hover:border-accent">
          {stage === 'idle' ? 'Film or choose a clip' : 'Try another clip'}
          <input
            type="file"
            accept="video/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => {
              void analyse(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      ) : null}
      <p className="text-[12px] text-ink3">
        A reading under {MIN_LOCKOUT_DEG}° is a bend, not a lockout, and is not saved. The clip stays on this phone.
      </p>
    </div>
  )
}
