import { useState } from 'react'
import type { BodyRegion, CheckIn } from '../types'
import { BODY_REGIONS } from '../types'
import { Icon } from './Icon'

const REGION_LABEL: Record<BodyRegion, string> = {
  wrist: 'Wrist',
  elbow: 'Elbow',
  shoulder: 'Shoulder',
  'lower-back': 'Lower back',
  other: 'Somewhere else',
}

export interface CheckInContext {
  /** A report the athlete made earlier that this answer will update. */
  concern?: string
  /** Days since anything was logged, when long enough to ask what the gap was. */
  gapDays?: number
}

/**
 * The coach's readiness questions — answers change today's plan.
 *
 * Kept to what changes a decision. The gap question appears only after a long
 * logging gap, because weeks with nothing logged are not evidence of rest and
 * the right first session depends on which it was. Every answer can be
 * skipped; a skipped answer stays unknown rather than counting as good news.
 */
export function CheckInForm({
  onDone,
  onSkip,
  context = {},
}: {
  onDone: (c: CheckIn) => void
  onSkip: () => void
  context?: CheckInContext
}) {
  const [joints, setJoints] = useState<CheckIn['joints'] | null>(null)
  const [energy, setEnergy] = useState<CheckIn['energy'] | null>(null)
  const [regions, setRegions] = useState<BodyRegion[]>([])
  const [gap, setGap] = useState<CheckIn['gap'] | null>(null)

  const JOINTS: { id: CheckIn['joints']; label: string; hint: string }[] = [
    { id: 'good', label: 'All good', hint: 'Wrists, elbows and shoulders feel normal' },
    { id: 'niggle', label: 'A bit off', hint: 'Slight ache or stiffness, no real pain' },
    { id: 'pain', label: 'Painful', hint: 'Sharp or persistent joint pain' },
  ]
  const ENERGY: { id: CheckIn['energy']; label: string }[] = [
    { id: 'fresh', label: 'Fresh' },
    { id: 'ok', label: 'Okay' },
    { id: 'tired', label: 'Tired' },
  ]
  const GAP: { id: NonNullable<CheckIn['gap']>; label: string }[] = [
    { id: 'trained-elsewhere', label: 'Kept training elsewhere' },
    { id: 'break', label: 'Took a break' },
    { id: 'unsure', label: 'Not sure' },
  ]

  // Asked only when there is something to locate. A region changes what the
  // session actually contains — a sore lower back gets its core work swapped
  // out, a wrist keeps it — so this is a real question, not extra paperwork.
  const needsRegion = joints === 'niggle' || joints === 'pain'
  const ready = Boolean(joints && energy && (!needsRegion || regions.length > 0))

  return (
    <div className="p-6">
      <div className="pr-10">
        <div className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-wider text-accent-text">
          <Icon name="target" size={14} /> Quick check-in
        </div>
        <h2 className="mt-1 font-display text-[20px] font-bold text-ink">How are you feeling?</h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink2">
          Your answers change today's warm-up, intensity and volume — being honest here is what keeps you training
          instead of recovering.
        </p>
        {context.concern ? (
          <p className="mt-2 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-[13px] leading-relaxed text-ink">
            {context.concern}
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        <div className="text-[13px] font-semibold text-ink" id="ci-joints">
          Wrists, elbows and shoulders
        </div>
        <div className="mt-2 space-y-2" role="group" aria-labelledby="ci-joints">
          {JOINTS.map((j) => (
            <button
              key={j.id}
              aria-pressed={joints === j.id}
              onClick={() => {
                setJoints(j.id)
                if (j.id === 'good') setRegions([])
              }}
              className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition ${
                joints === j.id ? 'border-accent bg-accent-soft' : 'border-line bg-raised hover:border-line-strong'
              }`}
            >
              <span>
                <span className="block text-[14px] font-medium text-ink">{j.label}</span>
                <span className="block text-[12.5px] text-ink2">{j.hint}</span>
              </span>
              <span
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                  joints === j.id ? 'border-accent bg-accent text-on-accent' : 'border-line-strong'
                }`}
              >
                {joints === j.id ? <Icon name="check" size={11} strokeWidth={3} /> : null}
              </span>
            </button>
          ))}
        </div>
      </div>

      {needsRegion ? (
        <div className="mt-4">
          <div className="text-[13px] font-semibold text-ink" id="ci-regions">
            Where? <span className="font-normal text-ink2">Pick all that apply.</span>
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink3">
            This changes the session rather than just being recorded — the plan leaves out whatever loads the area you
            name.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-labelledby="ci-regions">
            {BODY_REGIONS.map((r) => {
              const on = regions.includes(r)
              return (
                <button
                  key={r}
                  aria-pressed={on}
                  onClick={() => setRegions((v) => (on ? v.filter((x) => x !== r) : [...v, r]))}
                  className={`min-h-10 rounded-full border px-3.5 py-2 text-[13px] font-medium transition ${
                    on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2 hover:text-ink'
                  }`}
                >
                  {REGION_LABEL[r]}
                </button>
              )
            })}
          </div>
          {joints === 'pain' ? (
            <p className="mt-2 text-[12px] leading-relaxed text-ink3">
              Severe pain, swelling, numbness, or a joint you cannot use normally needs prompt care rather than a
              training plan.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4">
        <div className="text-[13px] font-semibold text-ink" id="ci-energy">
          Energy today
        </div>
        <div className="mt-2 flex gap-2" role="group" aria-labelledby="ci-energy">
          {ENERGY.map((e) => (
            <button
              key={e.id}
              aria-pressed={energy === e.id}
              onClick={() => setEnergy(e.id)}
              className={`min-h-11 flex-1 rounded-xl border py-2.5 text-[13.5px] font-medium transition ${
                energy === e.id
                  ? 'border-transparent bg-accent text-on-accent'
                  : 'border-line bg-raised text-ink2 hover:text-ink'
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      {context.gapDays !== undefined ? (
        <div className="mt-4">
          <div className="text-[13px] font-semibold text-ink" id="ci-gap">
            Nothing logged for {context.gapDays} days — what was that?{' '}
            <span className="font-normal text-ink3">(optional)</span>
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink3">
            Time without a log is not the same as rest. This decides whether today re-establishes your level or carries
            on as normal.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-labelledby="ci-gap">
            {GAP.map((g) => (
              <button
                key={g.id}
                aria-pressed={gap === g.id}
                onClick={() => setGap(gap === g.id ? null : g.id)}
                className={`min-h-10 rounded-full border px-3.5 py-2 text-[13px] font-medium transition ${
                  gap === g.id ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2 hover:text-ink'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <button
        disabled={!ready}
        onClick={() =>
          ready &&
          joints &&
          energy &&
          onDone({
            joints,
            energy,
            at: Date.now(),
            ...(regions.length ? { regions } : {}),
            ...(gap ? { gap } : {}),
          })
        }
        className="mt-5 w-full rounded-2xl px-6 py-3.5 font-display text-[16px] font-semibold text-on-accent shadow-card transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
        style={{ background: 'var(--t-btn-accent)' }}
      >
        Start session
      </button>
      {needsRegion && regions.length === 0 ? (
        <p className="mt-1.5 text-center text-[12px] text-ink3" aria-live="polite">
          Pick where it is, so the session can leave that out.
        </p>
      ) : null}
      <button onClick={onSkip} className="mt-2 w-full py-2.5 text-[13px] font-medium text-ink3 hover:text-ink">
        Skip for now
      </button>
    </div>
  )
}
