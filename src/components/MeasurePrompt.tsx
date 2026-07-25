import { useState } from 'react'
import type { AppState } from '../types'
import { useStore } from '../lib/store'
import { displayToKg, weightUnitLabel, CM_PER_IN, fmtHeight } from '../lib/units'
import { pushToast } from '../lib/toast'
import { Icon } from './Icon'
import { Modal } from './ui'

const DAY = 86_400_000
const WEIGHT_EVERY_DAYS = 7
/** Asked alongside weight — leaving it blank keeps the previous value. */
const HEIGHT_EVERY_DAYS = 7

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

  const save = () => {
    const wNum = parseFloat(weight)
    const weightKg = Number.isFinite(wNum) && wNum > 0 ? displayToKg(wNum, units) : undefined
    let newHeight: number | undefined
    if (units === 'metric') {
      const n = parseFloat(heightCm)
      if (Number.isFinite(n) && n > 0) newHeight = n
    } else {
      const ft = parseFloat(heightFt)
      const inch = parseFloat(heightIn) || 0
      if (Number.isFinite(ft) && ft > 0) newHeight = (ft * 12 + inch) * CM_PER_IN
    }
    if (weightKg === undefined && newHeight === undefined) {
      dismiss()
      return
    }
    dispatch({ type: 'LOG_MEASUREMENT', weightKg, heightCm: newHeight })
    pushToast('Logged. The coach will factor it in.', 'success')
    onClose()
  }

  // Any dismissal counts as "not now", including the close button and the
  // backdrop — otherwise those routes still re-asked on every refresh.
  const dismiss = () => {
    dispatch({ type: 'SNOOZE_MEASURE' })
    onClose()
  }

  return (
    <Modal open={open} onClose={dismiss}>
      <div className="p-6">
        <div className="pr-10">
          <div className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-wider text-accent">
            <Icon name="chart" size={14} /> Weekly check
          </div>
          <h2 className="mt-1 font-display text-[20px] font-bold text-ink">Where are you at?</h2>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink2">
            Planche is strength-to-weight, so the coach reads your holds against your bodyweight rather than in
            isolation. Skip it any time — it is never a target, just context.
          </p>
        </div>

        <label className="mt-4 block">
          <span className="text-[13px] font-medium text-ink2">Bodyweight ({weightUnitLabel(units)})</span>
          <input
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            inputMode="decimal"
            autoFocus
            placeholder={weightUnitLabel(units)}
            className="mt-1.5 w-full rounded-xl border border-line bg-raised px-3.5 py-3 text-[16px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
          />
          {lastW ? (
            <span className="mt-1 block text-[12px] text-ink3">
              Last logged {new Date(lastW.at).toLocaleDateString()} — leave blank to skip.
            </span>
          ) : null}
        </label>

        {due.height ? (
          <div className="mt-4">
            <span className="text-[13px] font-medium text-ink2">
              Height {lastH ? <span className="text-ink3">(currently {fmtHeight(lastH.value, units)})</span> : null}
            </span>
            {units === 'metric' ? (
              <input
                value={heightCm}
                onChange={(e) => setHeightCm(e.target.value)}
                inputMode="decimal"
                placeholder="cm"
                className="mt-1.5 w-full rounded-xl border border-line bg-raised px-3.5 py-3 text-[16px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
            ) : (
              <div className="mt-1.5 flex gap-2">
                <input
                  value={heightFt}
                  onChange={(e) => setHeightFt(e.target.value)}
                  inputMode="numeric"
                  placeholder="ft"
                  className="w-full rounded-xl border border-line bg-raised px-3.5 py-3 text-[16px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                />
                <input
                  value={heightIn}
                  onChange={(e) => setHeightIn(e.target.value)}
                  inputMode="numeric"
                  placeholder="in"
                  className="w-full rounded-xl border border-line bg-raised px-3.5 py-3 text-[16px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
                />
              </div>
            )}
            <span className="mt-1 block text-[12px] text-ink3">Leave blank to keep {fmtHeight(lastH?.value, units)}.</span>
          </div>
        ) : null}

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
