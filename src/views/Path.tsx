import { useState } from 'react'
import type { StepDef, Workout } from '../types'
import { useStore } from '../lib/store'
import { STEPS } from '../data/progressions'
import { EXERCISE_BY_ID } from '../data/exercises'
import { maxTestWorkout } from '../data/workouts'
import { fmtHold, fmtDate } from '../lib/time'
import { pushToast } from '../lib/toast'
import { Icon } from '../components/Icon'
import { Figure } from '../components/Figure'
import { Modal } from '../components/ui'
import { qualifyingProgress } from '../lib/progression'

export function Path({ startWorkout }: { startWorkout: (w: Workout) => void }) {
  const { state } = useStore()
  const [detail, setDetail] = useState<StepDef | null>(null)

  const currentOrder = STEPS.find((s) => s.id === state.stepId)?.order ?? 0

  return (
    <div className="animate-rise">
      <h1 className="font-display text-[28px] font-bold text-ink">The Road to Planche</h1>
      <p className="mt-0.5 max-w-2xl text-[14px] leading-relaxed text-ink2">
        Eight steps from first plank to full flight. Clear each unlock bar — a clean max hold on the step's key
        exercise — and the next door opens. Tap any step for the full coaching notes.
      </p>

      <div className="relative mt-7 pb-2">
        {/* Spine, with a gradient fill up to the current step */}
        <div className="absolute bottom-6 left-[27px] top-2 w-0.5 rounded bg-line sm:left-[31px]" />
        <div
          className="absolute left-[27px] top-2 w-0.5 rounded sm:left-[31px]"
          style={{
            height: `${(currentOrder / (STEPS.length - 1)) * 92}%`,
            background: 'linear-gradient(to bottom, var(--t-ok), var(--t-accent))',
          }}
        />
        <div className="space-y-3">
          {STEPS.map((step) => {
            const unlocked = state.unlocked.includes(step.id)
            const isCurrent = state.stepId === step.id
            const done = unlocked && step.order < currentOrder
            const best = qualifyingProgress(state, step.id).value
            const pct = Math.min(1, best / step.unlockSec)
            const keyEx = EXERCISE_BY_ID[step.keyExerciseId]
            return (
              <button
                key={step.id}
                onClick={() => setDetail(step)}
                className={`card-int relative flex w-full items-center gap-4 rounded-2xl border p-4 pl-3 text-left sm:gap-5 sm:p-5 sm:pl-4 ${
                  isCurrent
                    ? 'card-sheen border-accent/40 bg-surface shadow-card'
                    : unlocked
                      ? 'border-line bg-surface shadow-card'
                      : 'border-line bg-surface/40 opacity-80 hover:opacity-100'
                }`}
              >
                {/* Node */}
                <div
                  className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 sm:h-9 sm:w-9 ${
                    done
                      ? 'border-ok bg-ok-soft text-ok'
                      : isCurrent
                        ? 'border-accent bg-accent-soft text-accent'
                        : unlocked
                          ? 'border-line-strong bg-raised text-ink2'
                          : 'border-line bg-raised text-ink3'
                  }`}
                >
                  {isCurrent ? (
                    <span className="absolute inset-[-5px] rounded-full border-2 border-accent/50 animate-ping-soft" />
                  ) : null}
                  {done ? (
                    <Icon name="check" size={15} strokeWidth={2.5} />
                  ) : unlocked ? (
                    <span className="font-display text-[13px] font-bold tnum">{step.order + 1}</span>
                  ) : (
                    <Icon name="lock" size={14} />
                  )}
                </div>
                <Figure step={step.id} className={`h-16 w-20 shrink-0 ${unlocked ? 'text-ink' : 'text-ink3'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5">
                    <span className={`font-display text-[17px] font-semibold ${unlocked ? 'text-ink' : 'text-ink2'}`}>
                      {step.name}
                    </span>
                    {isCurrent ? (
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-on-accent">
                        current
                      </span>
                    ) : done ? (
                      <span className="text-[12px] font-medium text-ok">cleared</span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-[13.5px] text-ink2">{step.tagline}</div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-line">
                      <div
                        className={`h-full rounded-full ${done || pct >= 1 ? 'bg-ok' : 'bg-accent'}`}
                        style={{ width: `${pct * 100}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[12.5px] text-ink3 tnum">
                      {best ? fmtHold(best) : '0s'} / {step.unlockSec}s clean
                      {keyEx.perSide ? ' / both sides' : ''} {keyEx.name.toLowerCase()}
                    </span>
                  </div>
                </div>
                <Icon name="chevronR" size={17} className="shrink-0 text-ink3" />
              </button>
            )
          })}
        </div>
      </div>

      {/* Detail modal */}
      <Modal open={detail !== null} onClose={() => setDetail(null)} wide>
        {detail ? <StepDetail step={detail} onClose={() => setDetail(null)} startWorkout={startWorkout} /> : null}
      </Modal>
    </div>
  )
}

function StepDetail({
  step,
  onClose,
  startWorkout,
}: {
  step: StepDef
  onClose: () => void
  startWorkout: (w: Workout) => void
}) {
  const { state, dispatch } = useStore()
  const unlocked = state.unlocked.includes(step.id)
  const isCurrent = state.stepId === step.id
  const pr = state.prs[step.keyExerciseId]
  const keyEx = EXERCISE_BY_ID[step.keyExerciseId]

  return (
    <div className="p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-5 pr-10">
        <Figure step={step.id} className="h-24 w-28 text-ink" />
        <div>
          <div className="text-[12.5px] font-semibold uppercase tracking-wider text-accent">
            Step {step.order + 1} of 8
          </div>
          <h2 className="font-display text-[26px] font-bold text-ink">{step.name}</h2>
          <div className="text-[14px] text-ink2">{step.tagline}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
        <span className="rounded-full border border-line bg-raised px-3 py-1.5 text-ink2">
          Key hold: <span className="font-medium text-ink">{keyEx.name}</span>
        </span>
        <span className="rounded-full border border-line bg-raised px-3 py-1.5 text-ink2 tnum">
          Unlock bar: <span className="font-medium text-ink">{step.unlockSec}s</span>
        </span>
        <span className="rounded-full border border-line bg-raised px-3 py-1.5 text-ink2 tnum">
          Your best:{' '}
          <span className="font-medium text-ink">{pr ? `${fmtHold(pr.value)} (${fmtDate(pr.at)})` : '—'}</span>
        </span>
      </div>

      <p className="mt-4 text-[14.5px] leading-relaxed text-ink2">{step.description}</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-raised p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ok">
            <Icon name="check" size={14} /> Form checklist
          </div>
          <ul className="space-y-1.5 text-[13.5px] leading-relaxed text-ink2">
            {step.formChecks.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink3" />
                {c}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-raised p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-danger">
            <Icon name="x" size={14} /> Common mistakes
          </div>
          <ul className="space-y-1.5 text-[13.5px] leading-relaxed text-ink2">
            {step.mistakes.map((c) => (
              <li key={c} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink3" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-accent/25 bg-accent-soft p-4">
        <div className="text-[13px] font-semibold text-accent">Why it matters</div>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink">{step.whyItMatters}</p>
        <div className="mt-2.5 text-[13px] text-ink2">
          <span className="font-semibold text-ink">Suggested dose:</span> {step.scheme}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2.5">
        {isCurrent ? (
          <button
            onClick={() => {
              onClose()
              startWorkout(maxTestWorkout(step.id))
            }}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-3 font-display text-[15px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            <Icon name="target" size={16} /> Take the max test
          </button>
        ) : unlocked ? (
          <button
            onClick={() => {
              dispatch({ type: 'SET_STEP', stepId: step.id })
              pushToast(`Current step set to ${step.name}.`, 'success')
              onClose()
            }}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-3 font-display text-[15px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
            style={{ background: 'var(--t-btn-accent)' }}
          >
            <Icon name="check" size={16} /> Make this my current step
          </button>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-line bg-raised px-4 py-3 text-[13.5px] text-ink2">
            <Icon name="lock" size={15} className="text-ink3" />
            Unlocks automatically at{' '}
            {(() => {
              const prev = STEPS.find((s) => s.order === step.order - 1)
              return prev ? (
                <span>
                  <span className="font-semibold text-ink tnum">{prev.unlockSec}s</span>{' '}
                  {EXERCISE_BY_ID[prev.keyExerciseId].name.toLowerCase()}
                </span>
              ) : null
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
