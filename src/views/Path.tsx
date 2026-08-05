import { useState } from 'react'
import type { StepDef, StepId, Workout } from '../types'
import { useStore } from '../lib/store'
import { STEPS, STEP_BY_ID } from '../data/progressions'
import { EXERCISE_BY_ID } from '../data/exercises'
import { maxTestWorkout } from '../data/workouts'
import { fmtHold, fmtDate } from '../lib/time'
import { pushToast } from '../lib/toast'
import { Icon } from '../components/Icon'
import { Figure } from '../components/Figure'
import { Modal } from '../components/ui'
import { qualifyingProgress } from '../lib/progression'

/** Destinations worth aiming at; the early steps are waypoints, not goals. */
const GOAL_CHOICES: StepId[] = ['tuck', 'advtuck', 'straddle', 'full']

export function Path({ startWorkout }: { startWorkout: (w: Workout) => void }) {
  const { state, dispatch } = useStore()
  const [detail, setDetail] = useState<StepDef | null>(null)

  const currentOrder = STEPS.find((s) => s.id === state.stepId)?.order ?? 0
  const goalStepId = state.profile.goalStepId ?? 'straddle'

  return (
    <div className="animate-rise">
      <h1 className="font-display text-[28px] font-bold text-ink">The Road to Planche</h1>
      <p className="mt-0.5 max-w-2xl text-[14px] leading-relaxed text-ink2">
        Eight steps from first plank to full flight. Tap any step for coaching, form cues and a max test.
      </p>

      {/* Goal picker. Deliberately here rather than buried in Settings: the
          goal decides which cooldown mobility appears and how far the app
          says you have to go, so it belongs beside the road it describes. */}
      <div className="mt-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
        <div className="text-[13px] font-semibold text-ink" id="path-goal">
          What are you aiming at?
        </div>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink3">
          Your destination, not your current step. It shapes the mobility work in your sessions and how the app
          measures the distance left.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-labelledby="path-goal">
          {GOAL_CHOICES.map((id) => {
            const on = goalStepId === id
            return (
              <button
                key={id}
                aria-pressed={on}
                onClick={() => dispatch({ type: 'SET_PROFILE', patch: { goalStepId: id } })}
                className={`rounded-full border px-3.5 py-2 text-[13px] font-medium transition ${
                  on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2 hover:text-ink'
                }`}
              >
                {STEP_BY_ID[id].name}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/25 bg-ok-soft px-3 py-1.5 font-medium text-ok-text">
          <Icon name="check" size={13} /> Clean hold
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft px-3 py-1.5 font-medium text-accent-text">
          <Icon name="monitor" size={13} /> Camera pass
        </span>
        <details className="group">
          <summary className="cursor-pointer list-none rounded-full border border-line bg-surface px-3 py-1.5 font-medium text-ink2 transition hover:text-ink">
            How unlocks work <span className="ml-1 inline-block transition group-open:rotate-180">⌄</span>
          </summary>
          <p className="mt-2 max-w-2xl rounded-2xl border border-line bg-surface p-3.5 leading-relaxed text-ink2 shadow-card">
            Reach the bar with a hold you rate Clean and a passing filmed form check. Already training farther along?
            Open a locked step to place yourself there after the three-part safety check.
          </p>
        </details>
      </div>

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
            const best = qualifyingProgress(state, step.id).value
            const done = unlocked && step.order < currentOrder && best >= step.unlockSec
            const available = unlocked && step.order < currentOrder && !done
            const pct = Math.min(1, best / step.unlockSec)
            const keyEx = EXERCISE_BY_ID[step.keyExerciseId]
            return (
              <button
                key={step.id}
                onClick={() => setDetail(step)}
                className={`card-int relative flex w-full items-center gap-2.5 rounded-2xl border p-3 text-left min-[480px]:gap-4 sm:gap-5 sm:p-5 sm:pl-4 ${
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
                      ? 'border-ok bg-ok-soft text-ok-text'
                      : isCurrent
                        ? 'border-accent bg-accent-soft text-accent-text'
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
                <Figure
                  step={step.id}
                  className={`hidden h-14 w-16 shrink-0 min-[480px]:block sm:h-16 sm:w-20 ${unlocked ? 'text-ink' : 'text-ink3'}`}
                />
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
                      <span className="text-[12px] font-medium text-ok-text">cleared</span>
                    ) : available ? (
                      <span className="text-[12px] font-medium text-ink3">available</span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[13.5px] leading-snug text-ink2">{step.tagline}</div>
                  <div className="mt-2 space-y-1.5">
                    <div className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-line">
                      <div
                        className={`h-full rounded-full ${done || pct >= 1 ? 'bg-ok' : 'bg-accent'}`}
                        style={{ width: `${pct * 100}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-x-1.5 text-[12px] leading-snug text-ink3 tnum">
                      {best ? fmtHold(best) : '0s'} / {step.unlockSec}s verified
                      {keyEx.perSide ? <span>· both sides</span> : null}
                      <span className="hidden sm:inline">· {keyEx.name.toLowerCase()}</span>
                    </div>
                  </div>
                </div>
                <Icon name="chevronR" size={17} className="shrink-0 text-ink3" />
              </button>
            )
          })}
        </div>
      </div>

      {/* Detail modal */}
      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        label={detail ? `${detail.name} progression details` : 'Progression details'}
        wide
      >
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
  const [skipStage, setSkipStage] = useState<0 | 1 | 2 | 3>(0)
  const [skipAcknowledged, setSkipAcknowledged] = useState(false)

  if (skipStage > 0) {
    return (
      <SkipStepFlow
        step={step}
        stage={skipStage as 1 | 2 | 3}
        acknowledged={skipAcknowledged}
        setAcknowledged={setSkipAcknowledged}
        setStage={setSkipStage}
        onCancel={() => {
          setSkipAcknowledged(false)
          setSkipStage(0)
        }}
        onConfirm={() => {
          dispatch({ type: 'SKIP_TO_STEP', stepId: step.id })
          pushToast(`Moved to ${step.name}. Verified progress was left unchanged.`, 'success', 5000)
          onClose()
        }}
      />
    )
  }

  return (
    <div className="p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-5 pr-10">
        <Figure step={step.id} className="h-24 w-28 text-ink" />
        <div>
          <div className="text-[12.5px] font-semibold uppercase tracking-wider text-accent-text">
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
          <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ok-text">
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
          <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-danger-text">
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
        <div className="text-[13px] font-semibold text-accent-text">Why it matters</div>
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
          <div className="w-full space-y-2.5">
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
            <button
              onClick={() => setSkipStage(1)}
              className="inline-flex items-center gap-2 rounded-xl border border-accent/35 bg-accent-soft px-5 py-3 font-display text-[14.5px] font-semibold text-accent-text transition hover:border-accent/60"
            >
              <Icon name="skip" size={16} /> Skip ahead to {step.name}
            </button>
            <p className="text-[12.5px] leading-relaxed text-ink3">
              For athletes who already train this progression. Three confirmations appear before anything changes.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function SkipStepFlow({
  step,
  stage,
  acknowledged,
  setAcknowledged,
  setStage,
  onCancel,
  onConfirm,
}: {
  step: StepDef
  stage: 1 | 2 | 3
  acknowledged: boolean
  setAcknowledged: (value: boolean) => void
  setStage: (stage: 0 | 1 | 2 | 3) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="p-6 sm:p-8">
      <div className="pr-10 text-[12.5px] font-semibold uppercase tracking-wider text-accent-text">
        Safety check {stage} of 3
      </div>
      <div className="mt-4 flex items-center gap-4">
        <Figure step={step.id} className="h-20 w-24 shrink-0 text-ink" />
        <div>
          <div className="text-[13px] text-ink3">Jumping to</div>
          <h2 className="font-display text-[24px] font-bold text-ink">{step.name}</h2>
          <div className="text-[13.5px] text-ink2">{step.tagline}</div>
        </div>
      </div>

      {stage === 1 ? (
        <>
          <div className="mt-5 rounded-2xl border border-line bg-raised p-5">
            <h3 className="font-display text-[18px] font-semibold text-ink">This changes the plan, not your proof</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink2">
              The app will make {step.name} your current training step and make every earlier step selectable. It will
              not invent PRs, camera passes, verified unlock bars or achievement badges.
            </p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink3">
              Earlier skills without qualifying filmed holds will say available, not cleared.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <button
              onClick={onCancel}
              className="rounded-xl border border-line bg-surface px-4 py-3 text-[14px] font-medium text-ink2"
            >
              Back to step details
            </button>
            <button
              onClick={() => setStage(2)}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 font-display text-[14.5px] font-semibold text-on-accent"
            >
              I understand <Icon name="arrowR" size={15} />
            </button>
          </div>
        </>
      ) : null}

      {stage === 2 ? (
        <>
          <div className="mt-5 rounded-2xl border border-danger/30 bg-danger-soft p-5">
            <h3 className="font-display text-[18px] font-semibold text-ink">The loading jump is real</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink2">
              Later planche shapes increase leverage and straight-arm stress quickly. Choose this only if you can
              already enter the position deliberately, control the shape, and train it without joint pain. Otherwise,
              use the closest easier step.
            </p>
          </div>
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-raised p-4">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--t-accent)]"
            />
            <span className="text-[13.5px] leading-relaxed text-ink2">
              I understand this does not certify my form, and I will move back if the position causes wrist, elbow or
              shoulder pain.
            </span>
          </label>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <button
              onClick={() => setStage(1)}
              className="rounded-xl border border-line bg-surface px-4 py-3 text-[14px] font-medium text-ink2"
            >
              Back
            </button>
            <button
              onClick={() => setStage(3)}
              disabled={!acknowledged}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 font-display text-[14.5px] font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue <Icon name="arrowR" size={15} />
            </button>
          </div>
        </>
      ) : null}

      {stage === 3 ? (
        <>
          <div className="mt-5 rounded-2xl border border-accent/30 bg-accent-soft p-5">
            <h3 className="font-display text-[18px] font-semibold text-ink">Make {step.name} current?</h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink2">
              Generated sessions and the coach will switch immediately. Your existing history stays untouched, and
              you can return to any earlier step whenever you want.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <button
              onClick={() => setStage(2)}
              className="rounded-xl border border-line bg-surface px-4 py-3 text-[14px] font-medium text-ink2"
            >
              Back
            </button>
            <button
              onClick={onConfirm}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-3 font-display text-[14.5px] font-semibold text-on-accent shadow-card"
            >
              <Icon name="check" size={16} /> Yes — move me to {step.name}
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}
