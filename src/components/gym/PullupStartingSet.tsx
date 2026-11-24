import { useId, useState } from 'react'
import type { TrainingPrefs } from '../../lib/gym/types'
import { Button } from '../ds'

type StartingSet = TrainingPrefs['pullupStartingSet']

export function PullupStartingSet({ saved, onSave }: { saved: StartingSet; onSave: (set: StartingSet) => void }) {
  const id = useId()
  const [input, setInput] = useState<string | null>(null)
  const value = input ?? (saved ? String(saved.reps) : '')
  const valid = /^\d{1,3}$/.test(value.trim()) && Number(value) <= 100
  return <details className="mt-3 rounded-inner border border-line px-3">
    <summary className="min-h-11 cursor-pointer py-3 text-footnote font-medium text-accent-text">
      {saved ? `Strict pull-up starting set · ${saved.reps} reps` : 'Set a starting point for pull-ups'}
    </summary>
    <div className="space-y-2 pb-3">
      <label htmlFor={id} className="block text-footnote font-semibold">Recent strict pull-ups in one set</label>
      <p id={id + '-hint'} className="text-caption text-ink2">Use a recent set from straight arms to chin above the bar, without swinging. Enter 0 if you’re working on your first rep. Your next logged sets guide the plan.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input id={id} aria-describedby={id + '-hint'} type="text" inputMode="numeric" maxLength={3} placeholder="Reps"
          value={value} onChange={(e) => setInput(e.target.value)}
          className="min-h-11 w-20 rounded-control border border-line bg-raised px-2 text-body tnum" />
        <Button variant="secondary" disabled={!valid || (input === null && saved !== undefined)} onClick={() => {
          if (valid) { onSave({ reps: Number(value), at: Date.now() }); setInput(null) }
        }}>Save starting set</Button>
        {saved && <Button variant="ghost" onClick={() => { onSave(undefined); setInput(null) }}>Clear</Button>}
      </div>
    </div>
  </details>
}
