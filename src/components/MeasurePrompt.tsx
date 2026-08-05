import { useState } from 'react'
import type { AppState } from '../types'
import { useStore } from '../lib/store'
import { displayToKg, weightUnitLabel, CM_PER_IN, fmtHeight } from '../lib/units'
import { pushToast } from '../lib/toast'
import { Icon } from './Icon'
import { Modal } from './ui'

const DAY = 86_400_000
const WEIGHT_EVERY_DAYS = 7
/**
 * How long before height is *prompted for* rather than merely offered.
 *
 * The field itself is always present — it is one optional box that keeps its
 * current value when left blank, and hiding it entirely meant an athlete who
 * had grown, mistyped it once, or simply wanted to check what the app thought
 * had no way to correct it short of hunting through Settings. Past this age it
 * is highlighted as worth a moment.
 */
const HEIGHT_EVERY_DAYS = 180

export function lastOf(state: AppState, field: 'weightKg' | 'heightCm'): { at: number; value: number } | null {
  for (let i = state.measurements.length - 1; i >= 0; i--) {
    const v = state.measurements[i][field]
    if (v !== undefined) return { at: state.measurements[i].at, value: v }
  }
  return null
}

/** Dismissing the prompt holds it off for this long rather than forever. */
const SNOOZE_DAYS = 3

export function measurementDue(state: AppState, now = Date.now()): { weight: boolean; height: boolean } {
  if (!state.onboarded) return { weight: false, height: false }
  const w = lastOf(state, 'weightKg')
  const h = lastOf(state, 'heightCm')
  // Without this, saying "not now" meant being asked again on every single
  // refresh, because nothing about the state had actually changed.
  const snoozed = state.measureSnoozedAt !== undefined && now - state.measureSnoozedAt < SNOOZE_DAYS * DAY
  return {
    weight: !snoozed && (!w || now - w.at >= WEIGHT_EVERY_DAYS * DAY),
    height: !h || now - h.at >= HEIGHT_EVERY_DAYS * DAY,
  }
}

/**
 * Periodic bodyweight (and occasional height) check-in. Weight is the biggest
 * lever in a strength-to-weight skill, so the coach wants it current — but it
 * is always skippable and never framed as a target.
 */
export function MeasurePrompt({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useStore()
  const units = state.settings.units
  const due = measurementDue(state)
  const lastW = lastOf(state, 'weightKg')
  const lastH = lastOf(state, 'heightCm')

  const [weight, setWeight] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [heightFt, setHeightFt] = useState('')
  const [heightIn, setHeightIn] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = () => {
    const wNum = parseFloat(weight)
    const parsedWeight = Number.isFinite(wNum) && wNum > 0 ? displayToKg(wNum, units) : undefined
    const weightKg =
      parsedWeight !== undefined && parsedWeight >= 20 && parsedWeight <= 400 ? parsedWeight : undefined
    let newHeight: number | undefined
    if (units === 'metric') {
      const n = parseFloat(heightCm)
      if (Number.isFinite(n) && n >= 100 && n <= 250) newHeight = n
    } else {
      const ft = parseFloat(heightFt)
      const inch = parseFloat(heightIn) || 0
      if (Number.isFinite(ft) && ft > 0 && Number.isFinite(inch) && inch >= 0 && inch < 12) {
        const cm = (ft * 12 + inch) * CM_PER_IN
        if (cm >= 100 && cm <= 250) newHeight = cm
      }
    }
    // Typing something unparseable used to close the dialog silently and
    // snooze, so it looked saved when nothing had been recorded.
    if (weight.trim() && weightKg === undefined) {
      setError(`Enter a bodyweight between ${units === 'metric' ? '20–400 kg' : '44–882 lb'}.`)
      return
    }
    const heightEntered = units === 'metric' ? heightCm.trim() : heightFt.trim() || heightIn.trim()
    if (heightEntered && newHeight === undefined) {
      setError(
        units === 'metric'
          ? 'Enter a height between 100–250 cm.'
          : 'Enter a realistic height; inches must be from 0 to under 12.',
      )
      return
    }
    if (weightKg === undefined && newHeight === undefined) {
      dismiss()
      return
    }
    dispatch({ type: 'LOG_MEASUREMENT', weightKg, heightCm: newHeight })
    // Snooze regardless of which field was filled: a height-only save left
    // the weekly weight check due, so it reappeared on every launch.
    dispatch({ type: 'SNOOZE_MEASURE' })
    pushToast('Logged as progress context.', 'success')
    onClose()
  }

  // Any dismissal counts as "not now", including the close button and the
  // backdrop — otherwise those routes still re-asked on every refresh.
  const dismiss = () => {
    dispatch({ type: 'SNOOZE_MEASURE' })
    onClose()
  }

  return (
    <Modal open={open} onClose={dismiss} label="Weekly bodyweight and height check">
      <div className="p-6">
        <div className="pr-10">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-wider text-accent-text">
            <Icon name="chart" size={14} /> Weekly check
          </div>
          <h2 className="mt-1 font-display text-[20px] font-bold text-ink">Where are you at?</h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink2">
            Planche is strength-to-weight, so bodyweight helps you interpret the same hold over time. Skip it any
            time — it is never a target, just context.
          </p>
        </div>

        <label className="mt-4 block">
          <span className="text-[13px] font-medium text-ink2">Bodyweight ({weightUnitLabel(units)})</span>
          <input
            value={weight}
            onChange={(e) => {
              setWeight(e.target.value)
              setError(null)
            }}
            inputMode="decimal"
            autoFocus
            placeholder={weightUnitLabel(units)}
            // Without this the accessible name is just the placeholder — a
            // screen reader announced "kg" with no clue what it was asking.
            aria-label={`Bodyweight in ${units === 'metric' ? 'kilograms' : 'pounds'}`}
            aria-invalid={error !== null}
            className={`mt-1.5 w-full rounded-xl border bg-raised px-3.5 py-3 text-[16px] text-ink outline-none placeholder:text-ink3 focus:border-accent ${
              error ? 'border-danger' : 'border-line'
            }`}
          />
          {error ? <span className="mt-1 block text-[12.5px] text-danger-text">{error}</span> : null}
          {lastW ? (
            <span className="mt-1 block text-[12px] text-ink3">
              Last logged {new Date(lastW.at).toLocaleDateString()} — leave blank to skip.
            </span>
          ) : null}
        </label>

        <div className="mt-4">
          <span className="text-[13px] font-medium text-ink2">
            Height{' '}
            {lastH ? (
              <span className="text-ink3">(currently {fmtHeight(lastH.value, units)})</span>
            ) : (
              <span className="text-ink3">(optional)</span>
            )}
            {due.height && lastH ? (
              <span className="ml-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-text">
                worth a check
              </span>
            ) : null}
          </span>
          {units === 'metric' ? (
            <input
              value={heightCm}
              onChange={(e) => setHeightCm(e.target.value)}
              inputMode="decimal"
              placeholder={lastH ? String(Math.round(lastH.value)) : 'cm'}
              aria-label="Height in centimetres"
              className="mt-1.5 w-full rounded-xl border border-line bg-raised px-3.5 py-3 text-[16px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
            />
          ) : (
            <div className="mt-1.5 flex gap-2">
              <input
                value={heightFt}
                onChange={(e) => setHeightFt(e.target.value)}
                inputMode="numeric"
                placeholder="ft"
                aria-label="Height, feet"
                className="w-full rounded-xl border border-line bg-raised px-3.5 py-3 text-[16px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
              <input
                value={heightIn}
                onChange={(e) => setHeightIn(e.target.value)}
                inputMode="numeric"
                placeholder="in"
                aria-label="Height, inches"
                className="w-full rounded-xl border border-line bg-raised px-3.5 py-3 text-[16px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
            </div>
          )}
          <span className="mt-1 block text-[12px] text-ink3">
            {lastH ? `Leave blank to keep ${fmtHeight(lastH.value, units)}.` : 'Optional.'}
          </span>
        </div>

        <button
          onClick={save}
          className="mt-5 w-full rounded-2xl px-6 py-3.5 font-display text-[16px] font-semibold text-on-accent shadow-card transition hover:brightness-105"
          style={{ background: 'var(--t-btn-accent)' }}
        >
          Save
        </button>
        <button onClick={dismiss} className="mt-2 w-full py-2 text-[13px] font-medium text-ink3 hover:text-ink">
          Not now — ask me in a few days
        </button>
      </div>
    </Modal>
  )
}
