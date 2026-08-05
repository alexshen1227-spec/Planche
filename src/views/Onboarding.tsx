import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssessmentRecord, EquipmentId, StepId, Units } from '../types'
import { useStore } from '../lib/store'
import { STEPS, STEP_BY_ID } from '../data/progressions'
import { EQUIPMENT_OPTIONS } from '../data/equipment'
import { displayToKg, CM_PER_IN } from '../lib/units'
import {
  assessmentProgress,
  nextAssessmentItem,
  placeFromAssessment,
  type AssessmentAnswers,
} from '../lib/assessment'
import { Icon } from '../components/Icon'
import { Figure } from '../components/Figure'

/**
 * Onboarding, in the order the answers actually matter.
 *
 * Goal first, because it is one tap and it makes everything after it feel like
 * it is about something. Then the placement interview, which is the part that
 * earns its keep: the previous screen asked the athlete to pick which of five
 * descriptions sounded like them, and self-placement fails in both directions.
 * Place too high and every prescribed set is a failure; place too low and the
 * first month is spent re-earning something you already owned. Both cost weeks.
 *
 * The interview is skippable and ends the moment the answers stop being
 * plausible, so most people answer five or six questions. Skipping lands on the
 * old manual picker rather than a dead end.
 */

/** Only steps worth aiming at — the early ones are waypoints, not destinations. */
const GOAL_CHOICES: StepId[] = ['tuck', 'advtuck', 'straddle', 'full']

const GOAL_BLURB: Record<string, string> = {
  tuck: 'The first true planche. A realistic first destination for most people.',
  advtuck: 'Flat back, open hips — the posture every later planche is built on.',
  straddle: 'The one most people picture. Serious straight-arm strength.',
  full: 'Legs together, body level. The summit, and a multi-year project.',
}

type Stage = 'welcome' | 'goal' | 'interview' | 'result' | 'details' | 'frequency'

const STAGE_ORDER: Stage[] = ['welcome', 'goal', 'interview', 'result', 'details', 'frequency']

/** The self-declared fallback, kept for anyone who skips the interview. */
const PLACEMENTS: { stepId: StepId; label: string; desc: string }[] = [
  {
    stepId: 'foundations',
    label: 'Brand new to this',
    desc: 'Little or no bodyweight training yet. We start with wrists, scapula and core.',
  },
  {
    stepId: 'lean',
    label: 'Comfortable with push-ups & planks',
    desc: '10+ clean push-ups, a solid 45s plank. Straight into planche leans.',
  },
  {
    stepId: 'tuck',
    label: 'I can hold a frog stand',
    desc: '20–30s balancing on your hands. Time to chase the tuck planche.',
  },
  {
    stepId: 'advtuck',
    label: 'I have a 20s tuck planche',
    desc: 'Ready to flatten the back. Welcome to the grind.',
  },
  {
    stepId: 'straddle',
    label: 'Advanced tuck is mine',
    desc: '20s flat-back advanced tuck. Straddle work begins.',
  },
]

export function Onboarding() {
  const { dispatch } = useStore()
  const [stage, setStage] = useState<Stage>('welcome')
  const [name, setName] = useState('')
  const [goalStepId, setGoalStepId] = useState<StepId>('straddle')
  const [answers, setAnswers] = useState<AssessmentAnswers>({})
  const [skippedInterview, setSkippedInterview] = useState(false)
  const [manualPlacement, setManualPlacement] = useState<StepId>('foundations')
  const [goal, setGoal] = useState(3)
  const [units, setUnits] = useState<Units>('metric')
  const [weight, setWeight] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [heightFt, setHeightFt] = useState('')
  const [heightIn, setHeightIn] = useState('')
  const [equipment, setEquipment] = useState<EquipmentId[]>(['floor'])
  const [injuryNote, setInjuryNote] = useState('')
  const [measurementError, setMeasurementError] = useState<string | null>(null)

  // Each stage is a page. Focus has to follow, or a screen-reader user is left
  // reading the previous screen with no idea anything moved.
  const headingRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [stage])

  const placement = useMemo(() => placeFromAssessment(answers), [answers])
  const currentItem = useMemo(() => nextAssessmentItem(answers), [answers])
  const progress = useMemo(() => assessmentProgress(answers), [answers])
  const placedStepId = skippedInterview ? manualPlacement : placement.stepId

  const parsedWeight = (() => {
    const n = parseFloat(weight)
    const kg = Number.isFinite(n) && n > 0 ? displayToKg(n, units) : undefined
    return kg !== undefined && kg >= 20 && kg <= 400 ? kg : undefined
  })()
  const parsedHeight = (() => {
    if (units === 'metric') {
      const n = parseFloat(heightCm)
      return Number.isFinite(n) && n >= 100 && n <= 250 ? n : undefined
    }
    const ft = parseFloat(heightFt)
    const inchRaw = heightIn.trim()
    const inch = inchRaw === '' ? 0 : parseFloat(inchRaw)
    const cm =
      Number.isFinite(ft) && ft > 0 && Number.isFinite(inch) && inch >= 0 && inch < 12
        ? (ft * 12 + inch) * CM_PER_IN
        : undefined
    return cm !== undefined && cm >= 100 && cm <= 250 ? cm : undefined
  })()

  const continueFromDetails = () => {
    if (weight.trim() && parsedWeight === undefined) {
      setMeasurementError(`Enter a bodyweight between ${units === 'metric' ? '20–400 kg' : '44–882 lb'}.`)
      return
    }
    const heightEntered = units === 'metric' ? heightCm.trim() : heightFt.trim() || heightIn.trim()
    if (heightEntered && parsedHeight === undefined) {
      setMeasurementError(
        units === 'metric'
          ? 'Enter a height between 100–250 cm.'
          : 'Enter a realistic height; inches must be from 0 to under 12.',
      )
      return
    }
    setMeasurementError(null)
    setStage('frequency')
  }

  const finish = () => {
    const assessment: AssessmentRecord | undefined = skippedInterview
      ? undefined
      : {
          at: Date.now(),
          answers: answers as Record<string, number>,
          placedStepId: placement.stepId,
          confidence: placement.confidence,
          gapIds: placement.gaps.map((g) => g.id),
        }
    dispatch({
      type: 'COMPLETE_ONBOARDING',
      name: name.trim(),
      stepId: placedStepId,
      weeklyGoal: goal,
      units,
      weightKg: parsedWeight,
      heightCm: parsedHeight,
      assessment,
      profile: {
        equipment: equipment.length ? equipment : ['floor'],
        preferredSurface: equipment.includes('parallettes') ? 'parallettes' : 'floor',
        goalStepId,
        injuryNote: injuryNote.trim() || undefined,
        heightCm: parsedHeight,
        trainingAgeMonths: answers.experience,
      },
    })
  }

  const stageIndex = STAGE_ORDER.indexOf(stage)
  const primaryBtn =
    'flex flex-1 items-center justify-center gap-2 rounded-2xl px-6 py-3.5 font-display text-[16px] font-semibold text-on-accent shadow-card transition hover:brightness-105'
  const backBtn =
    'rounded-2xl border border-line bg-surface px-5 py-3.5 text-[14.5px] font-medium text-ink2 hover:text-ink'

  return (
    <div className="app-ambient grain fixed inset-0 z-50 overflow-y-auto bg-bg">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center px-5 py-10">
        <div className="mb-8 flex justify-center gap-2" aria-hidden="true">
          {STAGE_ORDER.map((s, i) => (
            <span
              key={s}
              className={`h-1.5 rounded-full transition-all ${
                i === stageIndex ? 'w-8 bg-accent' : 'w-1.5 bg-line-strong'
              }`}
            />
          ))}
        </div>
        <div className="sr-only" aria-live="polite">
          Step {stageIndex + 1} of {STAGE_ORDER.length}
        </div>

        {stage === 'welcome' ? (
          <div className="animate-rise text-center" ref={headingRef} tabIndex={-1}>
            <div
              className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl text-on-accent shadow-card"
              style={{ background: 'var(--t-btn-accent)' }}
            >
              <Figure step="full" className="h-10 w-12" />
            </div>
            <h1 className="font-display text-[34px] font-bold leading-tight text-ink">Planche Lab</h1>
            <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-ink2">
              A focused, adaptive road to the fastest sustainable planche progress — guided sessions, honest form
              tracking, and every hold timed.
            </p>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink3">
              Everything stays on this device. No account, no server, nothing to cancel.
            </p>
            <div className="mx-auto mt-7 max-w-sm text-left">
              <label htmlFor="ob-name" className="text-[13.5px] font-medium text-ink2">
                What should we call you? (optional)
              </label>
              <input
                id="ob-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="mt-1.5 w-full rounded-2xl border border-line bg-surface px-4 py-3.5 text-[15px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
            </div>
            <button
              onClick={() => setStage('goal')}
              className={`${primaryBtn} mx-auto mt-6 w-full max-w-sm`}
              style={{ background: 'var(--t-btn-accent)' }}
            >
              Let's go <Icon name="arrowR" size={17} />
            </button>
          </div>
        ) : null}

        {stage === 'goal' ? (
          <div className="animate-rise">
            <h1 ref={headingRef} tabIndex={-1} className="text-center font-display text-[26px] font-bold text-ink outline-none">
              What are you chasing?
            </h1>
            <p className="mt-1 text-center text-[14px] text-ink2">
              This sets your destination, not your starting point. You can change it any time.
            </p>
            <div className="mt-6 space-y-2.5" role="radiogroup" aria-label="Training goal">
              {GOAL_CHOICES.map((id) => {
                const step = STEP_BY_ID[id]
                const active = goalStepId === id
                return (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={active}
                    onClick={() => setGoalStepId(id)}
                    className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${
                      active ? 'border-accent bg-accent-soft shadow-card' : 'border-line bg-surface hover:border-line-strong'
                    }`}
                  >
                    <Figure step={id} className={`h-14 w-[70px] shrink-0 ${active ? 'text-accent' : 'text-ink2'}`} />
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold text-ink">{step.name}</div>
                      <div className="mt-0.5 text-[13px] leading-relaxed text-ink2">{GOAL_BLURB[id]}</div>
                    </div>
                    <span
                      className={`ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
                        active ? 'border-accent bg-accent text-on-accent' : 'border-line-strong'
                      }`}
                    >
                      {active ? <Icon name="check" size={13} strokeWidth={3} /> : null}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="mt-6 flex gap-2.5">
              <button onClick={() => setStage('welcome')} className={backBtn}>
                Back
              </button>
              <button onClick={() => setStage('interview')} className={primaryBtn} style={{ background: 'var(--t-btn-accent)' }}>
                Continue <Icon name="arrowR" size={16} />
              </button>
            </div>
          </div>
        ) : null}

        {stage === 'interview' ? (
          skippedInterview || !currentItem ? (
            <ManualPlacement
              headingRef={headingRef}
              placement={manualPlacement}
              onPick={setManualPlacement}
              onBack={() => {
                setSkippedInterview(false)
                setAnswers({})
                setStage('goal')
              }}
              onContinue={() => setStage('result')}
              primaryBtn={primaryBtn}
              backBtn={backBtn}
            />
          ) : (
            <div className="animate-rise">
              <div className="text-center">
                <div className="text-[12.5px] font-semibold uppercase tracking-wider text-accent-text">
                  Question {progress.answered + 1} of about {progress.likelyTotal}
                </div>
                <h1
                  ref={headingRef}
                  tabIndex={-1}
                  className="mt-1 font-display text-[23px] font-bold leading-snug text-ink outline-none"
                >
                  {currentItem.question}
                </h1>
                {currentItem.standard ? (
                  <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-ink2">
                    {currentItem.standard}
                  </p>
                ) : null}
              </div>
              <div className="mt-6 space-y-2.5" role="radiogroup" aria-label={currentItem.question}>
                {currentItem.options.map((opt) => (
                  <button
                    key={opt.label}
                    role="radio"
                    aria-checked={false}
                    onClick={() => setAnswers((a) => ({ ...a, [currentItem.id]: opt.value }))}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-accent hover:bg-accent-soft"
                  >
                    <span className="min-w-0">
                      <span className="block text-[15px] font-medium text-ink">{opt.label}</span>
                      {opt.hint ? <span className="mt-0.5 block text-[12.5px] text-ink2">{opt.hint}</span> : null}
                    </span>
                    <Icon name="chevronR" size={16} className="shrink-0 text-ink3" />
                  </button>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <button
                  onClick={() => {
                    const asked = Object.keys(answers)
                    if (asked.length === 0) {
                      setStage('goal')
                      return
                    }
                    const next = { ...answers }
                    delete next[asked[asked.length - 1] as keyof AssessmentAnswers]
                    setAnswers(next)
                  }}
                  className="rounded-xl border border-line bg-surface px-4 py-2.5 text-[13.5px] font-medium text-ink2 hover:text-ink"
                >
                  Back
                </button>
                <button
                  onClick={() => {
                    setSkippedInterview(true)
                    setAnswers({})
                  }}
                  className="px-1 py-2 text-[13px] font-medium text-ink3 underline underline-offset-4 hover:text-ink"
                >
                  Skip — I'll pick my own level
                </button>
              </div>
              <p className="mt-4 text-center text-[12px] leading-relaxed text-ink3">
                Answer honestly rather than optimistically. Everything here is checked against a stopwatch later, and
                starting one step low costs you a fortnight — starting one step high costs you months.
              </p>
            </div>
          )
        ) : null}

        {stage === 'result' ? (
          <div className="animate-rise">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-center font-display text-[26px] font-bold text-ink outline-none"
            >
              {skippedInterview ? 'Your starting point' : "Here's where you start"}
            </h1>
            <div className="mt-5 rounded-2xl border border-line bg-surface p-5 shadow-card">
              <div className="flex items-center gap-4">
                <Figure step={placedStepId} className="h-16 w-20 shrink-0 text-accent" />
                <div className="min-w-0">
                  <div className="font-display text-[20px] font-bold text-ink">{STEP_BY_ID[placedStepId].name}</div>
                  <div className="text-[13px] text-ink2">{STEP_BY_ID[placedStepId].tagline}</div>
                </div>
              </div>
              <p className="mt-3 text-[13.5px] leading-relaxed text-ink2">
                {skippedInterview
                  ? 'You picked this yourself, so the app treats it as a starting guess and nothing more. Your first filmed sets are what confirm it.'
                  : placement.reason}
              </p>
              {!skippedInterview ? (
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2">
                  <Icon
                    name={placement.confidence === 'good' ? 'check' : 'info'}
                    size={15}
                    className={placement.confidence === 'good' ? 'text-ok' : 'text-ink3'}
                  />
                  <span className="text-[12.5px] leading-relaxed text-ink2">
                    {placement.confidence === 'good'
                      ? 'Your answers were consistent, so this is a confident starting point — still provisional until a filmed set backs it up.'
                      : placement.confidence === 'moderate'
                        ? 'A reasonable starting point from what you told us. The first sessions will confirm or correct it.'
                        : 'Low confidence — either the answers were thin or some of them disagreed. Expect the first week to adjust this.'}
                  </span>
                </div>
              ) : null}
            </div>

            {placement.inconsistencies.length > 0 && !skippedInterview ? (
              <div className="mt-3 rounded-2xl border border-danger/30 bg-danger-soft p-4">
                <div className="text-[13px] font-semibold text-ink">Worth double-checking</div>
                <ul className="mt-1.5 space-y-1">
                  {placement.inconsistencies.map((t) => (
                    <li key={t} className="text-[13px] leading-relaxed text-ink2">
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {placement.caveats.length > 0 && !skippedInterview ? (
              <div className="mt-3 space-y-2">
                {placement.caveats.map((t) => (
                  <div key={t} className="rounded-2xl border border-line bg-surface p-4 text-[13px] leading-relaxed text-ink2">
                    {t}
                  </div>
                ))}
              </div>
            ) : null}

            {placement.gaps.length > 0 && !skippedInterview ? (
              <div className="mt-3 rounded-2xl border border-line bg-surface p-4">
                <div className="text-[13px] font-semibold text-ink">What will actually limit you</div>
                <p className="mt-0.5 text-[12.5px] text-ink3">
                  Not blockers — these get built into your sessions from day one.
                </p>
                <ul className="mt-2 space-y-2">
                  {placement.gaps.map((g) => (
                    <li key={g.id}>
                      <div className="text-[13.5px] font-medium text-ink">{g.label}</div>
                      <div className="text-[12.5px] leading-relaxed text-ink2">{g.detail}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-6 flex gap-2.5">
              <button
                onClick={() => setStage('interview')}
                className={backBtn}
              >
                Back
              </button>
              <button onClick={() => setStage('details')} className={primaryBtn} style={{ background: 'var(--t-btn-accent)' }}>
                Looks right <Icon name="arrowR" size={16} />
              </button>
            </div>
          </div>
        ) : null}

        {stage === 'details' ? (
          <div className="animate-rise">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-center font-display text-[26px] font-bold text-ink outline-none"
            >
              A few quick details
            </h1>
            <p className="mt-1 text-center text-[14px] text-ink2">
              All optional, all stays on your device. Equipment shapes exercise choices; measurements add context.
            </p>

            <div className="mt-5 flex justify-center">
              <div className="flex overflow-hidden rounded-xl border border-line">
                {(['metric', 'imperial'] as const).map((u) => (
                  <button
                    key={u}
                    aria-pressed={units === u}
                    onClick={() => setUnits(u)}
                    className={`px-4 py-2 text-[13.5px] font-medium transition ${
                      units === u ? 'bg-accent text-on-accent' : 'bg-surface text-ink2 hover:text-ink'
                    }`}
                  >
                    {u === 'metric' ? 'kg / cm' : 'lb / ft'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="rounded-2xl border border-line bg-surface p-4">
                <span className="text-[13px] font-medium text-ink2">
                  Bodyweight ({units === 'metric' ? 'kg' : 'lb'})
                </span>
                <input
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  inputMode="decimal"
                  placeholder={units === 'metric' ? '70' : '155'}
                  className="mt-1.5 w-full rounded-xl border border-line bg-raised px-3 py-2.5 text-[15px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                />
                <span className="mt-1 block text-[12px] text-ink3">
                  Planche is strength-to-weight — this is one of the biggest levers there is.
                </span>
              </label>
              <label className="rounded-2xl border border-line bg-surface p-4">
                <span className="text-[13px] font-medium text-ink2">Height</span>
                {units === 'metric' ? (
                  <input
                    value={heightCm}
                    onChange={(e) => setHeightCm(e.target.value)}
                    inputMode="decimal"
                    placeholder="175"
                    aria-label="Height in centimetres"
                    className="mt-1.5 w-full rounded-xl border border-line bg-raised px-3 py-2.5 text-[15px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                  />
                ) : (
                  <div className="mt-1.5 flex gap-2">
                    <input
                      value={heightFt}
                      onChange={(e) => setHeightFt(e.target.value)}
                      inputMode="numeric"
                      placeholder="5"
                      aria-label="Height, feet"
                      className="w-full rounded-xl border border-line bg-raised px-3 py-2.5 text-[15px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                    />
                    <input
                      value={heightIn}
                      onChange={(e) => setHeightIn(e.target.value)}
                      inputMode="numeric"
                      placeholder="9"
                      aria-label="Height, inches"
                      className="w-full rounded-xl border border-line bg-raised px-3 py-2.5 text-[15px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                    />
                  </div>
                )}
                <span className="mt-1 block text-[12px] text-ink3">
                  Height gives useful lever-length context; it does not change your unlock bar.
                </span>
              </label>
            </div>

            <div className="mt-3 rounded-2xl border border-line bg-surface p-4">
              <div className="text-[13px] font-medium text-ink2" id="ob-equipment">
                What do you have to train with?
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-labelledby="ob-equipment">
                {EQUIPMENT_OPTIONS.map((eq) => {
                  const on = equipment.includes(eq.id)
                  return (
                    <button
                      key={eq.id}
                      aria-pressed={on}
                      onClick={() => setEquipment((v) => (on ? v.filter((x) => x !== eq.id) : [...v, eq.id]))}
                      className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition ${
                        on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2'
                      }`}
                    >
                      {eq.label}
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-ink3">
                {EQUIPMENT_OPTIONS.filter((eq) => equipment.includes(eq.id))
                  .map((eq) => eq.hint)
                  .filter(Boolean)
                  .join(' · ') || 'Pick everything you can get to — sessions substitute around what is missing.'}
              </p>
            </div>

            <label className="mt-3 block rounded-2xl border border-line bg-surface p-4">
              <span className="text-[13px] font-medium text-ink2">Anything currently sore or injured?</span>
              <input
                value={injuryNote}
                onChange={(e) => setInjuryNote(e.target.value)}
                placeholder="e.g. left wrist a bit cranky — or leave blank"
                className="mt-1.5 w-full rounded-xl border border-line bg-raised px-3 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
              <span className="mt-1 block text-[12px] text-ink3">
                Kept as a note so it is in front of you. Persistent joint pain deserves a physio, not a workaround.
              </span>
            </label>

            <div className="mt-6 flex gap-2.5">
              <button onClick={() => setStage('result')} className={backBtn}>
                Back
              </button>
              <button onClick={continueFromDetails} className={primaryBtn} style={{ background: 'var(--t-btn-accent)' }}>
                Continue <Icon name="arrowR" size={16} />
              </button>
            </div>
            {measurementError ? (
              <p className="mt-2 text-center text-[12.5px] text-danger" role="alert">
                {measurementError}
              </p>
            ) : null}
          </div>
        ) : null}

        {stage === 'frequency' ? (
          <div className="animate-rise text-center">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="font-display text-[26px] font-bold text-ink outline-none"
            >
              How often will you train?
            </h1>
            <p className="mx-auto mt-1 max-w-md text-[14px] leading-relaxed text-ink2">
              Sessions per week. Three is the number most coaching sources land on for straight-arm work, and rest days
              are where the strength actually arrives.
            </p>
            <div className="mt-7 flex justify-center gap-2.5" role="radiogroup" aria-label="Sessions per week">
              {[2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  role="radio"
                  aria-checked={goal === n}
                  onClick={() => setGoal(n)}
                  className={`h-16 w-16 rounded-2xl border font-display text-[22px] font-bold transition ${
                    goal === n
                      ? 'border-transparent bg-accent text-on-accent shadow-card'
                      : 'border-line bg-surface text-ink2 hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[13px] text-ink3" aria-live="polite">
              {goal <= 3 ? 'Sustainable. Good call.' : goal === 4 ? 'Solid — watch your elbows.' : 'Spicy. Keep two easy days.'}
            </div>
            <div className="mx-auto mt-7 max-w-md rounded-2xl border border-line bg-surface p-4 text-left">
              <div className="text-[13px] font-semibold uppercase tracking-wide text-ink3">Your plan</div>
              <div className="mt-1.5 flex items-center gap-3">
                <Figure step={placedStepId} className="h-12 w-16 text-accent" />
                <div className="min-w-0">
                  <div className="font-display text-[17px] font-semibold text-ink">
                    {STEP_BY_ID[placedStepId].name}
                  </div>
                  <div className="text-[13px] text-ink2">
                    Aiming at {STEP_BY_ID[goalStepId].name} ·{' '}
                    {Math.max(0, STEP_BY_ID[goalStepId].order - STEP_BY_ID[placedStepId].order)} step
                    {Math.max(0, STEP_BY_ID[goalStepId].order - STEP_BY_ID[placedStepId].order) === 1 ? '' : 's'} to go
                  </div>
                </div>
              </div>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink3">
                The coach needs a handful of sessions before it can tell which kind of training you respond to. Until
                then it runs a sensible default and says so rather than pretending to know.
              </p>
            </div>
            <div className="mt-6 flex gap-2.5">
              <button onClick={() => setStage('details')} className={backBtn}>
                Back
              </button>
              <button onClick={finish} className={primaryBtn} style={{ background: 'var(--t-btn-accent)' }}>
                <Icon name="bolt" size={17} /> Start training
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ManualPlacement({
  headingRef,
  placement,
  onPick,
  onBack,
  onContinue,
  primaryBtn,
  backBtn,
}: {
  headingRef: React.RefObject<HTMLDivElement | null>
  placement: StepId
  onPick: (id: StepId) => void
  onBack: () => void
  onContinue: () => void
  primaryBtn: string
  backBtn: string
}) {
  return (
    <div className="animate-rise">
      <h1 ref={headingRef} tabIndex={-1} className="text-center font-display text-[26px] font-bold text-ink outline-none">
        Where are you starting?
      </h1>
      <p className="mt-1 text-center text-[14px] text-ink2">
        Honest placement beats ambitious placement — you can test up any time.
      </p>
      <div className="mt-6 space-y-2.5" role="radiogroup" aria-label="Starting step">
        {PLACEMENTS.map((p) => {
          const active = placement === p.stepId
          return (
            <button
              key={p.stepId}
              role="radio"
              aria-checked={active}
              onClick={() => onPick(p.stepId)}
              className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${
                active ? 'border-accent bg-accent-soft shadow-card' : 'border-line bg-surface hover:border-line-strong'
              }`}
            >
              <Figure step={p.stepId} className={`h-14 w-[70px] shrink-0 ${active ? 'text-accent' : 'text-ink2'}`} />
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-ink">{p.label}</div>
                <div className="mt-0.5 text-[13px] leading-relaxed text-ink2">{p.desc}</div>
              </div>
              <span
                className={`ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
                  active ? 'border-accent bg-accent text-on-accent' : 'border-line-strong'
                }`}
              >
                {active ? <Icon name="check" size={13} strokeWidth={3} /> : null}
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-6 flex gap-2.5">
        <button onClick={onBack} className={backBtn}>
          Back
        </button>
        <button onClick={onContinue} className={primaryBtn} style={{ background: 'var(--t-btn-accent)' }}>
          Continue <Icon name="arrowR" size={16} />
        </button>
      </div>
    </div>
  )
}

/** Every step the road contains, for the Path screen's manual override. */
export const ALL_STEP_IDS: StepId[] = STEPS.map((s) => s.id)
