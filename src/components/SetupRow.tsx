import { useState } from 'react'
import type { AssistType, ExerciseSetup } from '../types'
import { Icon } from './Icon'

export const ASSIST_LABEL: Record<AssistType, string> = {
  none: 'No assistance',
  band: 'Band',
  feet: 'Toe or foot support',
  partner: 'Partner support',
  other: 'Other support',
}

const ASSIST_ORDER: AssistType[] = ['none', 'band', 'feet', 'partner', 'other']

/** One line for the remembered setup, in the athlete's terms. */
export function describeSetup(setup: ExerciseSetup | undefined): string {
  if (!setup) return 'Assistance not recorded'
  const base = setup.assist === 'none' ? 'No assistance (your report)' : ASSIST_LABEL[setup.assist]
  return setup.note ? `${base} · ${setup.note}` : base
}

/**
 * The remembered setup for this exercise, changed in place.
 *
 * Asked once and reused, rather than every set: more help is not progress in
 * the old task, so an assisted hold needs to be labelled as one — but someone
 * training plainly on the floor should never have to answer a band interview.
 * Nothing is assumed: an unanswered setup stays "not recorded", and "no
 * assistance" is only ever the athlete's own report. Changing it affects the
 * next sets only; sets already logged keep the setup they were done with.
 */
export function SetupRow({
  exerciseName,
  setup,
  onSave,
}: {
  exerciseName: string
  setup: ExerciseSetup | undefined
  onSave: (next: { assist: AssistType; note?: string } | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [assist, setAssist] = useState<AssistType | null>(setup?.assist ?? null)
  const [note, setNote] = useState(setup?.note ?? '')
  const assisted = setup !== undefined && setup.assist !== 'none'

  return (
    <div className="mx-auto mt-2 w-full max-w-sm rounded-2xl border border-line bg-surface px-4 py-2.5 text-left">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-[13px] text-ink2">
          <span className="font-medium text-ink">Setup:</span> {describeSetup(setup)}
        </span>
        <button
          onClick={() => {
            setAssist(setup?.assist ?? null)
            setNote(setup?.note ?? '')
            setOpen((value) => !value)
          }}
          aria-expanded={open}
          className="min-h-9 shrink-0 rounded-lg border border-line bg-raised px-2.5 py-1 text-[12px] font-semibold text-ink2 hover:text-ink"
        >
          {open ? 'Close' : 'Change'}
        </button>
      </div>
      {assisted && !open ? (
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink3">
          Assisted holds count as training and never toward unlocking the unassisted skill.
        </p>
      ) : null}
      {open ? (
        <div className="mt-2.5">
          <div className="text-[12.5px] font-semibold text-ink" id="setup-assist">
            Any help holding the {exerciseName.toLowerCase()}?
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-labelledby="setup-assist">
            {ASSIST_ORDER.map((id) => (
              <button
                key={id}
                onClick={() => setAssist(id)}
                aria-pressed={assist === id}
                className={`min-h-10 rounded-full border px-3.5 py-2 text-[12.5px] font-medium transition ${
                  assist === id ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2 hover:text-ink'
                }`}
              >
                {ASSIST_LABEL[id]}
              </button>
            ))}
          </div>
          {assist && assist !== 'none' ? (
            <>
              <label className="mt-2.5 block text-[12.5px] font-semibold text-ink" htmlFor="setup-note">
                How is it set up? <span className="font-normal text-ink3">(optional)</span>
              </label>
              <input
                id="setup-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={60}
                placeholder="e.g. red band, top of the rig"
                className="mt-1 w-full rounded-xl border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink3">
                Same colour at a different anchor is a different setup — say where it acts so later sets compare
                like with like.
              </p>
            </>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button
              disabled={!assist}
              onClick={() => {
                if (!assist) return
                const trimmed = note.trim()
                onSave({ assist, ...(assist !== 'none' && trimmed ? { note: trimmed } : {}) })
                setOpen(false)
              }}
              className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-[13px] font-semibold text-on-accent disabled:opacity-40"
            >
              <Icon name="check" size={14} /> Use for the next sets
            </button>
            {setup ? (
              <button
                onClick={() => {
                  onSave(null)
                  setOpen(false)
                }}
                className="min-h-11 rounded-xl border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink2 hover:text-ink"
              >
                Forget it
              </button>
            ) : null}
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink3">
            Sets you already logged keep the setup they were done with.
          </p>
        </div>
      ) : null}
    </div>
  )
}
