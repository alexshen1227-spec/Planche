import { useMemo, useState } from 'react'
import type { AssistType, Section, Session, SetLog, TrainingSurface, Workout, WorkoutRequest } from '../types'
import { useStore } from '../lib/store'
import {
  TEMPLATES,
  describeBlock,
  describeTarget,
  primaryTargetBlock,
  countRounds,
  challengeBlockedReason,
  finalizeFromPlan,
} from '../data/workouts'
import { EXERCISES, EXERCISE_BY_ID, CATEGORY_LABEL } from '../data/exercises'
import { STEP_BY_ID } from '../data/progressions'
import { applySession } from '../lib/engine'
import { pushToast } from '../lib/toast'
import { confetti } from '../lib/confetti'
import { sfx } from '../lib/audio'
import { fmtHold } from '../lib/time'
import { Icon } from '../components/Icon'
import { Modal, SectionTitle } from '../components/ui'
import { defaultSurface, surfaceLabel, TRAINING_SURFACES } from '../data/equipment'
import { recordForSurface } from '../lib/records'
import { buildPlan, STRATEGY_BY_ID } from '../lib/coach'
import { useToday } from '../lib/useToday'
import { ASSIST_LABEL } from '../components/SetupRow'

const SECTION_LABEL: Record<Section, string> = {
  warmup: 'Warm-up',
  main: 'Main',
  strength: 'Strength',
  core: 'Core',
  cooldown: 'Cooldown',
}

function WorkoutTarget({ workout }: { workout: Workout }) {
  const target = primaryTargetBlock(workout)
  if (!target) return null
  const exercise = EXERCISE_BY_ID[target.exerciseId]
  return (
    <div className="mt-4 flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-on-accent">
        <Icon name="target" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10.5px] font-bold uppercase tracking-wider text-accent-text">Main target</div>
        <div className="truncate text-[14px] font-semibold text-ink">{exercise.name}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[15px] font-bold text-ink tnum">{describeTarget(target)}</div>
        <div className="text-[11.5px] text-ink3 tnum">{describeBlock(target)}</div>
      </div>
    </div>
  )
}

/** Request identity for the preview, so a fresh decision is made per card. */
function requestKey(request: WorkoutRequest): string {
  return `${request.source}:${request.templateId ?? ''}:${request.stepId ?? ''}:${request.minutes ?? ''}`
}

export function Train({ startWorkout }: { startWorkout: (request: WorkoutRequest) => void }) {
  const { state } = useStore()
  const [previewRequest, setPreviewRequest] = useState<WorkoutRequest | null>(null)
  const [quickLog, setQuickLog] = useState(false)
  const todayKey = useToday()

  // One plan for every card on the screen, decided for today. Each card shows
  // what would actually run — after equipment, readiness and capacity — not
  // the template as written.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => buildPlan(state), [state, todayKey])
  const finalized = useMemo(() => {
    const now = Date.now()
    const build = (request: WorkoutRequest) => finalizeFromPlan(state, request, plan, now).workout
    return {
      today: build({ source: 'auto' }),
      templates: new Map(TEMPLATES.map((t) => [t.id, build({ source: 'template', templateId: t.id })])),
      build,
    }
  }, [state, plan])
  const today = finalized.today
  const testBlocked = challengeBlockedReason(plan)
  const preview: Workout | null = useMemo(
    () =>
      previewRequest
        ? previewRequest.source === 'auto' && !previewRequest.minutes
          ? finalized.today
          : previewRequest.source === 'template' && previewRequest.templateId
            ? (finalized.templates.get(previewRequest.templateId) ?? finalized.build(previewRequest))
            : finalized.build(previewRequest)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [previewRequest && requestKey(previewRequest), finalized],
  )
  const step = STEP_BY_ID[state.stepId]

  return (
    <div className="animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-bold text-ink">Train</h1>
          <p className="mt-0.5 text-[14px] text-ink2">Guided sessions with timers, rest and automatic logging.</p>
        </div>
        <button
          onClick={() => setQuickLog(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-4 py-2.5 text-[14px] font-medium text-ink2 transition hover:border-line-strong hover:text-ink"
        >
          <Icon name="plus" size={15} /> Quick log a set
        </button>
      </div>

      {/* Recommended */}
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <button
          onClick={() => setPreviewRequest({ source: 'auto' })}
          className="card-int card-sheen group relative overflow-hidden rounded-3xl border border-accent/25 bg-surface p-6 text-left shadow-card hover:border-accent/50 lg:col-span-2"
        >
          <div className="pointer-events-none absolute -right-8 -top-12 h-44 w-44 rounded-full bg-accent-soft blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-wider text-accent-text">
              <Icon name="bolt" size={14} /> Recommended today
            </div>
            <div className="mt-1.5 font-display text-[22px] font-bold text-ink">{today.name}</div>
            <p className="mt-1 max-w-lg text-[14px] leading-relaxed text-ink2">{today.focus}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-ink2">
              {today.strategy ? (
                <span className="rounded-full border border-accent/30 bg-accent-soft px-3 py-1 font-semibold text-accent-text">
                  {STRATEGY_BY_ID[today.strategy].name}
                </span>
              ) : null}
              <span className="rounded-full border border-line bg-raised px-3 py-1 tnum">~{today.minutes} min</span>
              <span className="rounded-full border border-line bg-raised px-3 py-1 tnum">
                {countRounds(today.blocks)} sets
              </span>
              {[...new Set(today.blocks.map((b) => b.section))].map((s) => (
                <span key={s} className="rounded-full border border-line bg-raised px-3 py-1">
                  {SECTION_LABEL[s]}
                </span>
              ))}
            </div>
          </div>
        </button>
        <button
          onClick={() => setPreviewRequest({ source: 'test', stepId: state.stepId })}
          className="card-int group rounded-3xl border border-line bg-surface p-6 text-left shadow-card"
        >
          <div className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-wider text-ink3">
            <Icon name="target" size={14} /> Test day
          </div>
          <div className="mt-1.5 font-display text-[22px] font-bold text-ink">Max Test</div>
          <p className="mt-1 text-[14px] leading-relaxed text-ink2">
            {EXERCISE_BY_ID[step.keyExerciseId].perSide ? 'Two fresh attempts per side' : 'Three fresh attempts'} at
            the {EXERCISE_BY_ID[step.keyExerciseId].name.toLowerCase()}. A verified{' '}
            <span className="font-semibold text-ink tnum">{step.unlockSec}s</span> unlocks the next step.
          </p>
          {testBlocked ? (
            <p className="mt-3 text-[12.5px] leading-relaxed text-ink3">Not today — {testBlocked}.</p>
          ) : (
            <div className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-accent-text">
              Test yourself <Icon name="arrowR" size={15} />
            </div>
          )}
        </button>
      </div>

      <SectionTitle>Focused sessions</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((t) => {
          const built = finalized.templates.get(t.id) ?? t
          const changed = Boolean(built.adjustments?.length) || built.id !== t.id
          return (
            <button
              key={t.id}
              onClick={() => setPreviewRequest({ source: 'template', templateId: t.id })}
              className="card-int rounded-2xl border border-line bg-surface p-5 text-left shadow-card"
            >
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-display text-[17px] font-semibold text-ink">{t.name}</div>
                <div className="shrink-0 text-[12.5px] text-ink3 tnum">~{built.minutes} min</div>
              </div>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink2">{t.focus}</p>
              {changed ? (
                <p className="mt-1.5 text-[12px] font-medium text-accent-text">Adjusted for today — see preview</p>
              ) : null}
            </button>
          )
        })}
      </div>

      {/* Workout preview */}
      <Modal
        open={preview !== null}
        onClose={() => setPreviewRequest(null)}
        label={preview ? `${preview.name} workout preview` : 'Workout preview'}
        wide
      >
        {preview ? (
          <div className="p-6 sm:p-7">
            <div className="pr-10">
              <h2 className="font-display text-[22px] font-bold text-ink">{preview.name}</h2>
              <p className="mt-1 text-[14px] text-ink2">{preview.focus}</p>
              <div className="mt-2 text-[13px] text-ink3 tnum">
                ~{preview.minutes} min · {countRounds(preview.blocks)} sets
              </div>
            </div>
            {preview.adjustments?.length ? (
              <div className="mt-3 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3">
                <div className="text-[10.5px] font-bold uppercase tracking-wider text-accent-text">Adjusted for today</div>
                <ul className="mt-1 space-y-1 text-[13px] leading-relaxed text-ink">
                  {preview.adjustments.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <WorkoutTarget workout={preview} />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {[...new Set(preview.blocks.map((b) => b.section))].map((sec) => (
                <div key={sec} className="rounded-2xl border border-line bg-raised p-4">
                  <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink3">
                    {SECTION_LABEL[sec]}
                  </div>
                  <div className="space-y-1.5">
                    {preview.blocks
                      .filter((b) => b.section === sec)
                      .map((b, i) => {
                        const ex = EXERCISE_BY_ID[b.exerciseId]
                        return (
                          <div key={i} className="flex items-baseline justify-between gap-3 text-[14px]">
                            <span className="text-ink">{ex.name}</span>
                            <span className="shrink-0 text-ink2 tnum">{describeBlock(b)}</span>
                          </div>
                        )
                      })}
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                const request = previewRequest
                setPreviewRequest(null)
                // The request, not this preview: the session is decided again
                // at the moment it starts, with whatever is true then.
                if (request) startWorkout(request)
              }}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 font-display text-[16px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
              style={{ background: 'var(--t-btn-accent)' }}
            >
              <Icon name="play" size={17} /> Start
            </button>
          </div>
        ) : null}
      </Modal>

      <QuickLogModal open={quickLog} onClose={() => setQuickLog(false)} onSaved={() => setQuickLog(false)} />
      <div className="mt-8 rounded-2xl border border-line bg-surface/60 p-4 text-[13px] leading-relaxed text-ink3">
        <span className="font-semibold text-ink2">Safety note:</span> prepare before loading, keep most holds a little
        shy of failure, and back off at the first sign of elbow or wrist pain — coaching conventions rather than tested
        rules. This app is a training log, not medical advice.
      </div>
    </div>
  )
}

function QuickLogModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { state, dispatch } = useStore()
  const [exerciseId, setExerciseId] = useState('planche-lean')
  const [value, setValue] = useState(10)
  const [surface, setSurface] = useState<TrainingSurface>(() =>
    defaultSurface(state.profile.equipment, state.profile.preferredSurface),
  )
  const [side, setSide] = useState<'left' | 'right' | null>(null)
  const [assist, setAssist] = useState<AssistType | null>(null)
  const ex = EXERCISE_BY_ID[exerciseId]
  const surfaceAware = ex.category === 'planche'
  /** Assistance matters only where it changes what a hold proves. */
  const assistAware = ex.type === 'hold' && ex.category === 'planche' && ex.id !== 'frog-stand'
  // A one-sided value without a side cannot be compared with anything, and
  // used to be filed as if it were both.
  const needsSide = Boolean(ex.perSide)
  const currentBest = surfaceAware
    ? recordForSurface(state.prs[exerciseId], surface)?.value
    : state.prs[exerciseId]?.value

  const save = () => {
    const now = Date.now()
    const session: Session = {
      id: crypto.randomUUID(),
      startedAt: now,
      endedAt: now,
      workoutName: 'Quick Log',
      workoutKind: 'auto',
      stepId: state.stepId,
      sets: [
        {
          exerciseId,
          kind: ex.type,
          value,
          target: value,
          section: 'main',
          at: now,
          ...(surfaceAware ? { surface } : {}),
          ...(needsSide && side ? { side } : {}),
          ...(assistAware && assist ? { assist } : {}),
          // Typed in by hand: an estimate, not a timer reading.
          ...(ex.type === 'hold' ? { timing: { method: 'edited' as const } } : {}),
        } satisfies SetLog,
      ],
    }
    const { events } = applySession(state, session)
    dispatch({ type: 'SAVE_SESSION', session })
    const pr = events.prs.find(
      (record) =>
        record.exerciseId === exerciseId &&
        (record.previous !== undefined || EXERCISE_BY_ID[record.exerciseId]?.category === 'planche'),
    )
    if (pr) {
      sfx.pr()
      confetti(1)
      pushToast(
        `New PR — ${ex.name} ${ex.type === 'hold' ? fmtHold(value) : `${value} reps`}${
          surfaceAware ? ` on ${surfaceLabel(surface).toLowerCase()}` : ''
        }!`,
        'pr',
      )
    } else {
      pushToast('Set logged.', 'success')
    }
    if (events.unlockedStep) {
      confetti(2)
      pushToast(`Unlocked: ${STEP_BY_ID[events.unlockedStep].name}!`, 'pr', 5000)
    }
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} label="Quick log a set">
      <div className="p-6">
        <h2 className="font-display text-[20px] font-bold text-ink">Quick log</h2>
        <p className="mt-1 text-[13.5px] text-ink2">Trained outside the app? Log a single best set here.</p>
        <label className="mt-4 block text-[13px] font-medium text-ink2">
          Exercise
          <select
            value={exerciseId}
            onChange={(e) => {
              setExerciseId(e.target.value)
              setValue(EXERCISE_BY_ID[e.target.value].type === 'hold' ? 10 : 8)
              setSide(null)
              setAssist(null)
            }}
            className="mt-1.5 w-full rounded-xl border border-line bg-raised px-3.5 py-3 text-[14.5px] text-ink outline-none focus:border-accent"
          >
            {Object.entries(CATEGORY_LABEL).map(([cat, label]) => (
              <optgroup key={cat} label={label}>
                {EXERCISES.filter((e) => e.category === cat).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {surfaceAware ? (
          <div className="mt-4">
            <div className="text-[13px] font-medium text-ink2">Surface</div>
            <div className="mt-1.5 flex overflow-hidden rounded-xl border border-line" role="group" aria-label="Surface">
              {TRAINING_SURFACES.map((item) => {
                const disabled = item.id === 'parallettes' && !state.profile.equipment.includes('parallettes')
                return (
                  <button
                    key={item.id}
                    onClick={() => setSurface(item.id)}
                    disabled={disabled}
                    aria-pressed={surface === item.id}
                    className={`min-h-11 flex-1 px-3 py-2.5 text-[13.5px] font-medium transition disabled:opacity-35 ${
                      surface === item.id ? 'bg-accent text-on-accent' : 'bg-raised text-ink2'
                    }`}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
        {needsSide ? (
          <div className="mt-4">
            <div className="text-[13px] font-medium text-ink2" id="ql-side">
              Which side?
            </div>
            <div className="mt-1.5 flex overflow-hidden rounded-xl border border-line" role="group" aria-labelledby="ql-side">
              {(['left', 'right'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSide(s)}
                  aria-pressed={side === s}
                  className={`min-h-11 flex-1 px-3 py-2.5 text-[13.5px] font-medium capitalize transition ${
                    side === s ? 'bg-accent text-on-accent' : 'bg-raised text-ink2'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {assistAware ? (
          <div className="mt-4">
            <div className="text-[13px] font-medium text-ink2" id="ql-assist">
              Any assistance? <span className="font-normal text-ink3">(optional)</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-labelledby="ql-assist">
              {(['none', 'band', 'feet', 'partner', 'other'] as AssistType[]).map((id) => (
                <button
                  key={id}
                  onClick={() => setAssist(assist === id ? null : id)}
                  aria-pressed={assist === id}
                  className={`min-h-10 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition ${
                    assist === id ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2'
                  }`}
                >
                  {ASSIST_LABEL[id]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-4">
          <div className="text-[13px] font-medium text-ink2">{ex.type === 'hold' ? 'Hold (seconds)' : 'Reps'}</div>
          <div className="mt-2 flex items-center justify-center gap-4">
            <button
              onClick={() => setValue((v) => Math.max(1, v - 1))}
              aria-label="Decrease"
              className="grid h-12 w-12 place-items-center rounded-xl border border-line bg-surface text-ink hover:border-line-strong"
            >
              <Icon name="minus" size={18} />
            </button>
            <div className="w-24 text-center font-display text-[44px] font-bold text-ink tnum">{value}</div>
            <button
              onClick={() => setValue((v) => v + 1)}
              aria-label="Increase"
              className="grid h-12 w-12 place-items-center rounded-xl border border-line bg-surface text-ink hover:border-line-strong"
            >
              <Icon name="plus" size={18} />
            </button>
          </div>
          {currentBest !== undefined ? (
            <div className="mt-1 text-center text-[13px] text-ink3 tnum">
              {surfaceAware ? `${surfaceLabel(surface)} best` : 'current best'}{' '}
              {ex.type === 'hold' ? fmtHold(currentBest) : currentBest}
            </div>
          ) : null}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-ink3">
          A hand-logged value counts toward your records and history, but not toward unlocking a step — that needs a
          filmed, confirmed hold.
        </p>
        <button
          onClick={save}
          disabled={needsSide && !side}
          className="mt-3 w-full rounded-2xl px-6 py-3.5 font-display text-[16px] font-semibold text-on-accent shadow-card transition hover:brightness-105 disabled:opacity-40"
          style={{ background: 'var(--t-btn-accent)' }}
        >
          {needsSide && !side ? 'Pick a side to save' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}
