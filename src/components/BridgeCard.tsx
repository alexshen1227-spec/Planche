import { useMemo } from 'react'
import type { AppState, StepId } from '../types'
import { STEP_BY_ID } from '../data/progressions'
import { EXERCISE_BY_ID } from '../data/exercises'
import { TRANSITION_FROM } from '../data/transitions'
import { ADV_TUCK_HIP_DEG, bridgeStatus, hipOpening, leanDepth, PLANK_LEAN, STRONG_LEAN, TUCK_HIP_DEG } from '../lib/bridge'
import { fmtHold } from '../lib/time'
import { Icon } from './Icon'

/** A labelled progress bar toward a target, honest about "not measured yet". */
function Meter({ label, value, target, unit = 's' }: { label: string; value: number | undefined; target: number; unit?: string }) {
  const share = value === undefined ? 0 : Math.min(1, value / Math.max(0.1, target))
  const met = value !== undefined && value >= target
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="min-w-0 text-ink2">{label}</span>
        <span className="shrink-0 tnum text-ink3">
          <span className={`font-semibold ${met ? 'text-ok-text' : 'text-ink'}`}>
            {value === undefined ? '—' : unit === 's' ? fmtHold(value) : `${Math.round(value)}${unit}`}
          </span>{' '}
          / {unit === 's' ? fmtHold(target) : `${Math.round(target)}${unit}`}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden="true">
        <div className={`h-full rounded-full ${met ? 'bg-ok' : 'bg-accent'}`} style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
    </div>
  )
}

/**
 * The bridge from the current step to the next: whether next-shape practice
 * is open, how close early promotion is, the camera's hip-opening meter at the
 * tuck, and the transition guide.
 */
export function BridgeCard({ state, stepId, compact = false }: { state: AppState; stepId: StepId; compact?: boolean }) {
  const status = useMemo(() => bridgeStatus(state, stepId), [state, stepId])
  const hips = useMemo(() => (stepId === 'tuck' ? hipOpening(state) : null), [state, stepId])
  const lean = useMemo(
    () => (stepId === 'foundations' || stepId === 'lean' || stepId === 'frog' ? leanDepth(state) : null),
    [state, stepId],
  )
  const guide = TRANSITION_FROM[stepId]
  if (!status) return null
  const step = STEP_BY_ID[stepId]
  const nextEx = EXERCISE_BY_ID[status.next.keyExerciseId]
  const perSide = nextEx?.perSide

  return (
    <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-accent-text">
          <Icon name="route" size={14} /> Next shape · {status.next.name}
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${
            status.open ? 'bg-ok-soft text-ok-text' : 'bg-raised text-ink3'
          }`}
        >
          {status.open ? 'practice on' : 'opens later'}
        </span>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink2">
        {status.open
          ? status.openAtSec === 0
            ? `${nextEx.name} practice is in your sessions from the start — it is balance more than strength.`
            : `Your ${step.name.toLowerCase()} is past halfway, so sessions open with short ${nextEx.name.toLowerCase()} attempts while you are fresh.`
          : `Short ${nextEx.name.toLowerCase()} attempts join your sessions once your ${step.name.toLowerCase()} reaches about ${fmtHold(status.openAtSec)}${
              status.currentSec !== undefined ? ` (recently: ${fmtHold(status.currentSec)})` : ''
            }.`}
      </p>

      <div className="mt-3 space-y-2.5">
        <div className="text-[12px] font-semibold text-ink">Opens early when both are verified on camera</div>
        <Meter
          label={`${nextEx.name}${perSide ? ', each side' : ''} — clean`}
          value={status.nextVerifiedSec || undefined}
          target={status.promotionSec}
        />
        <Meter
          label={`${EXERCISE_BY_ID[step.keyExerciseId].name} — clean`}
          value={status.currentVerifiedSec || undefined}
          target={status.promotionCurrentSec}
        />
        <p className="text-[11.5px] leading-relaxed text-ink3">
          Or the usual way: {fmtHold(step.unlockSec)} clean on the {step.name.toLowerCase()}. Both bars are this app’s
          convention — holding the next shape clean is the readiness the bar only predicts.
        </p>
      </div>

      {hips ? (
        <div className="mt-3 rounded-xl bg-raised p-3">
          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
            <span className="font-semibold text-ink">Hip opening on your filmed tucks</span>
            <span className="tnum font-semibold text-ink">{hips.recentDeg}°</span>
          </div>
          <div className="relative mt-2 h-2 rounded-full bg-line" aria-hidden="true">
            <div
              className="absolute top-0 h-2 rounded-full bg-accent"
              style={{
                width: `${Math.round(
                  Math.min(1, Math.max(0, (hips.recentDeg - 40) / (ADV_TUCK_HIP_DEG + 10 - 40))) * 100,
                )}%`,
              }}
            />
            <div
              className="absolute -top-1 h-4 w-0.5 bg-ok"
              style={{ left: `${Math.round(((ADV_TUCK_HIP_DEG - 40) / (ADV_TUCK_HIP_DEG + 10 - 40)) * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink3">
            Tucks usually read around {TUCK_HIP_DEG}°; an advanced tuck starts near {ADV_TUCK_HIP_DEG}° (the green mark).
            {hips.earlierDeg !== undefined
              ? ` Earlier filmed holds read ${hips.earlierDeg}° — ${
                  hips.recentDeg > hips.earlierDeg + 3
                    ? 'opening up.'
                    : hips.recentDeg < hips.earlierDeg - 3
                      ? 'closing again; check the side-on replay.'
                      : 'about the same.'
                }`
              : ''}{' '}
            The median of {hips.sets} side-on readings, each a few degrees either way.
          </p>
        </div>
      ) : null}

      {lean ? (
        <div className="mt-3 rounded-xl bg-raised p-3">
          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
            <span className="font-semibold text-ink">Lean depth on your filmed leans</span>
            <span className="tnum font-semibold text-ink">{lean.recentDeg.toFixed(2)}</span>
          </div>
          <div className="relative mt-2 h-2 rounded-full bg-line" aria-hidden="true">
            <div
              className="absolute top-0 h-2 rounded-full bg-accent"
              style={{ width: `${Math.round(Math.min(1, Math.max(0, lean.recentDeg / 1)) * 100)}%` }}
            />
            <div className="absolute -top-1 h-4 w-0.5 bg-ok" style={{ left: `${Math.round(STRONG_LEAN * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink3">
            How far your shoulders travel past your hands, in torso lengths. A plank reads about {PLANK_LEAN}; a strong
            planche lean about {STRONG_LEAN} (the green mark). Leaning further builds more than holding longer.
            {lean.earlierDeg !== undefined
              ? ` Earlier filmed leans read ${lean.earlierDeg.toFixed(2)}.`
              : ''}{' '}
            The median of {lean.sets} side-on readings.
          </p>
        </div>
      ) : null}

      {guide && !compact ? (
        <details className="mt-3 group">
          <summary className="cursor-pointer list-none text-[12.5px] font-semibold text-ink2 hover:text-ink">
            The {step.name.toLowerCase()} → {status.next.name.toLowerCase()} guide{' '}
            <span className="inline-block transition group-open:rotate-180">⌄</span>
          </summary>
          <div className="mt-2 space-y-2.5 text-[12.5px] leading-relaxed text-ink2">
            <p>{guide.change}</p>
            <div>
              <div className="font-semibold text-ink">What your sessions add</div>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                {guide.bridge.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            {guide.extras.length ? (
              <div>
                <div className="font-semibold text-ink">Worth doing on your own</div>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                  {guide.extras.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <div className="font-semibold text-ink">Where people stall</div>
              <ul className="mt-0.5 space-y-1">
                {guide.blockers.map((b) => (
                  <li key={b.stall}>
                    <span className="font-medium text-ink">{b.stall}</span> — {b.fix}
                  </li>
                ))}
              </ul>
            </div>
            <p className="rounded-lg bg-raised px-2.5 py-2">
              <span className="font-semibold text-ink">Watch: </span>
              {guide.watch}
            </p>
            <p className="text-[11.5px] text-ink3">Coaching consensus, not trial evidence; the load figures are the app’s lever model.</p>
          </div>
        </details>
      ) : null}
    </div>
  )
}
