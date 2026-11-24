import { useId } from 'react'
import { EXERCISE_BY_ID } from '../data/exercises'
import type { RepLadder } from '../data/skills'
import type { LadderStatus } from '../lib/repLadder'

export function PressMilestonePicker({ ladder, value, onChange }: {
  ladder: RepLadder
  value?: string
  onChange: (exerciseId: string) => void
}) {
  const id = useId()
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block text-footnote font-semibold text-ink">Pressing milestone</label>
      <p id={id + '-hint'} className="mt-1 text-footnote text-ink2">Choose the press you want to do for one clean rep. You train the progression from your current level.</p>
      <select id={id} aria-describedby={id + '-hint'} value={value ?? ladder.rungs[ladder.rungs.length - 1].exerciseId}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 min-h-11 w-full rounded-control border border-line bg-raised px-3 text-body text-ink">
        {ladder.rungs.map((r) => <option key={r.exerciseId} value={r.exerciseId}>{EXERCISE_BY_ID[r.exerciseId].name}</option>)}
      </select>
    </div>
  )
}

export function pressMilestoneProgress({ goal, rung }: LadderStatus): string {
  const name = EXERCISE_BY_ID[goal.rung.exerciseId].name
  if (goal.reviewed) return `Milestone reached. You reviewed a clean rep of ${name} on film.`
  if (goal.logged) return `You’ve logged a rep of ${name}. Review a filmed set against its form checks to confirm this milestone.`
  return `Your goal is one clean ${name.toLowerCase()}. Your current exercise is ${EXERCISE_BY_ID[rung.exerciseId].name.toLowerCase()}.`
}
