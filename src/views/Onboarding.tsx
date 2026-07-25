import { useState } from 'react'
import type { EquipmentId, StepId, Units } from '../types'
import { useStore } from '../lib/store'
import { STEP_BY_ID } from '../data/progressions'
import { displayToKg, CM_PER_IN } from '../lib/units'
import { Icon } from '../components/Icon'
import { Figure } from '../components/Figure'

const EQUIPMENT: { id: EquipmentId; label: string; hint: string }[] = [
  { id: 'floor', label: 'Just the floor', hint: 'Everything early works with nothing at all' },
  { id: 'parallettes', label: 'Parallettes', hint: 'Kinder on the wrists — the best thing to own' },
  { id: 'band', label: 'Resistance band', hint: 'Assisted straddle work later on' },
  { id: 'pullup-bar', label: 'Pull-up bar', hint: 'To hang a band from' },
  { id: 'dip-bars', label: 'Dip bars', hint: 'Extra pressing volume' },
]

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
  const [page, setPage] = useState(0)
  const [name, setName] = useState('')
  const [placement, setPlacement] = useState<StepId>('foundations')
  const [goal, setGoal] = useState(3)
  const [units, setUnits] = useState<Units>('metric')
  const [weight, setWeight] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [heightFt, setHeightFt] = useState('')
  const [heightIn, setHeightIn] = useState('')
  const [equipment, setEquipment] = useState<EquipmentId[]>(['floor'])
  const [injuryNote, setInjuryNote] = useState('')
  const [measurementError, setMeasurementError] = useState<string | null>(null)

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
    const inch = parseFloat(heightIn) || 0
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
    setPage(3)
  }

  const finish = () => {
    dispatch({
      type: 'COMPLETE_ONBOARDING',
      name: name.trim(),
      stepId: placement,
      weeklyGoal: goal,
      units,
      weightKg: parsedWeight,
      heightCm: parsedHeight,
      profile: {
        equipment: equipment.length ? equipment : ['floor'],
        injuryNote: injuryNote.trim() || undefined,
        heightCm: parsedHeight,
      },
    })
  }

  return (
    <div className="app-ambient grain fixed inset-0 z-50 overflow-y-auto bg-bg">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center px-5 py-10">
        {/* Progress dots */}
        <div className="mb-8 flex justify-center gap-2">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === page ? 'w-8 bg-accent' : 'w-1.5 bg-line-strong'}`}
            />
          ))}
        </div>

        {page === 0 ? (
          <div className="animate-rise text-center">
            <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl text-on-accent shadow-card" style={{ background: 'var(--t-btn-accent)' }}>
              <Figure step="full" className="h-10 w-12" />
            </div>
            <h1 className="font-display text-[34px] font-bold leading-tight text-ink">Planche Lab</h1>
            <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-ink2">
              A focused, adaptive road to the fastest sustainable planche progress — guided sessions, honest form
              tracking, and every hold timed.
            </p>
            <div className="mx-auto mt-7 max-w-sm text-left">
              <label className="text-[13.5px] font-medium text-ink2">What should we call you? (optional)</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="mt-1.5 w-full rounded-2xl border border-line bg-surface px-4 py-3.5 text-[15px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
            </div>
            <button
              onClick={() => setPage(1)}
              className="mx-auto mt-6 flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl px-6 py-4 font-display text-[16px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
              style={{ background: 'var(--t-btn-accent)' }}
            >
              Let's go <Icon name="arrowR" size={17} />
            </button>
          </div>
        ) : null}

        {page === 1 ? (
          <div className="animate-rise">
            <h1 className="text-center font-display text-[26px] font-bold text-ink">Where are you starting?</h1>
            <p className="mt-1 text-center text-[14px] text-ink2">
              Honest placement beats ambitious placement — you can test up any time.
            </p>
            <div className="mt-6 space-y-2.5">
              {PLACEMENTS.map((p) => {
                const active = placement === p.stepId
                return (
                  <button
                    key={p.stepId}
                    onClick={() => setPlacement(p.stepId)}
                    className={`flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition ${
                      active ? 'border-accent bg-accent-soft shadow-card' : 'border-line bg-surface hover:border-line-strong'
                    }`}
                  >
                    <Figure step={p.stepId} className={`h-14 w-[70px] shrink-0 ${active ? 'text-accent' : 'text-ink2'}`} />
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold text-ink">{p.label}</div>
                      <div className="mt-0.5 text-[13px] leading-relaxed text-ink2">{p.desc}</div>
                    </div>
                    <div
                      className={`ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
                        active ? 'border-accent bg-accent text-on-accent' : 'border-line-strong'
                      }`}
                    >
                      {active ? <Icon name="check" size={13} strokeWidth={3} /> : null}
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="mt-6 flex gap-2.5">
              <button
                onClick={() => setPage(0)}
                className="rounded-2xl border border-line bg-surface px-5 py-3.5 text-[14.5px] font-medium text-ink2 hover:text-ink"
              >
                Back
              </button>
              <button
                onClick={() => setPage(2)}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl px-6 py-3.5 font-display text-[16px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
                style={{ background: 'var(--t-btn-accent)' }}
              >
                Continue <Icon name="arrowR" size={16} />
              </button>
            </div>
          </div>
        ) : null}

        {page === 2 ? (
          <div className="animate-rise">
            <h1 className="text-center font-display text-[26px] font-bold text-ink">A few quick details</h1>
            <p className="mt-1 text-center text-[14px] text-ink2">
              All optional, all stays on your device. Equipment shapes exercise choices; measurements add context.
            </p>

            <div className="mt-5 flex justify-center">
              <div className="flex overflow-hidden rounded-xl border border-line">
                {(['metric', 'imperial'] as const).map((u) => (
                  <button
                    key={u}
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
                    className="mt-1.5 w-full rounded-xl border border-line bg-raised px-3 py-2.5 text-[15px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                  />
                ) : (
                  <div className="mt-1.5 flex gap-2">
                    <input
                      value={heightFt}
                      onChange={(e) => setHeightFt(e.target.value)}
                      inputMode="numeric"
                      placeholder="5"
                      className="w-full rounded-xl border border-line bg-raised px-3 py-2.5 text-[15px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                    />
                    <input
                      value={heightIn}
                      onChange={(e) => setHeightIn(e.target.value)}
                      inputMode="numeric"
                      placeholder="9"
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
              <div className="text-[13px] font-medium text-ink2">What do you have to train with?</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {EQUIPMENT.map((eq) => {
                  const on = equipment.includes(eq.id)
                  return (
                    <button
                      key={eq.id}
                      onClick={() =>
                        setEquipment((v) => (on ? v.filter((x) => x !== eq.id) : [...v, eq.id]))
                      }
                      title={eq.hint}
                      className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition ${
                        on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2'
                      }`}
                    >
                      {eq.label}
                    </button>
                  )
                })}
              </div>
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
              <button
                onClick={() => setPage(1)}
                className="rounded-2xl border border-line bg-surface px-5 py-3.5 text-[14.5px] font-medium text-ink2 hover:text-ink"
              >
                Back
              </button>
              <button
                onClick={continueFromDetails}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl px-6 py-3.5 font-display text-[16px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
                style={{ background: 'var(--t-btn-accent)' }}
              >
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

        {page === 3 ? (
          <div className="animate-rise text-center">
            <h1 className="font-display text-[26px] font-bold text-ink">How often will you train?</h1>
            <p className="mx-auto mt-1 max-w-md text-[14px] leading-relaxed text-ink2">
              Sessions per week — this sets your streak goal. Planche loves frequency, but rest days are where strength
              actually arrives.
            </p>
            <div className="mt-7 flex justify-center gap-2.5">
              {[2, 3, 4, 5].map((n) => (
                <button
                  key={n}
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
            <div className="mt-2 text-[13px] text-ink3">{goal <= 3 ? 'Sustainable. Good call.' : goal === 4 ? 'Solid — watch your elbows.' : 'Spicy. Keep two easy days.'}</div>
            <div className="mx-auto mt-7 max-w-md rounded-2xl border border-line bg-surface p-4 text-left">
              <div className="text-[13px] font-semibold uppercase tracking-wide text-ink3">Your starting point</div>
              <div className="mt-1.5 flex items-center gap-3">
                <Figure step={placement} className="h-12 w-16 text-accent" />
                <div>
                  <div className="font-display text-[17px] font-semibold text-ink">{STEP_BY_ID[placement].name}</div>
                  <div className="text-[13px] text-ink2">{STEP_BY_ID[placement].tagline}</div>
                </div>
              </div>
            </div>
            <div className="mt-6 flex gap-2.5">
              <button
                onClick={() => setPage(2)}
                className="rounded-2xl border border-line bg-surface px-5 py-3.5 text-[14.5px] font-medium text-ink2 hover:text-ink"
              >
                Back
              </button>
              <button
                onClick={finish}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl px-6 py-3.5 font-display text-[16px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
                style={{ background: 'var(--t-btn-accent)' }}
              >
                <Icon name="bolt" size={17} /> Start training
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
