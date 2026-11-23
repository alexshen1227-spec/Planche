import type { SkillId, StepId } from '../types'
import { SKILLS } from '../data/skills'

/**
 * The destination to keep once the placement is known. A goal at or behind the
 * placed step is already reached: the first screen would read "goal reached" at
 * 0%. It moves to the next step on the road, or stays at the road's end when the
 * athlete is placed on the last step.
 */
export function goalPastPlacement(
  skill: SkillId,
  placed: StepId,
  goal: StepId,
): { goal: StepId; moved: boolean } {
  const steps = SKILLS[skill].steps
  const placedAt = steps.findIndex((step) => step.id === placed)
  const goalAt = steps.findIndex((step) => step.id === goal)
  if (placedAt < 0 || goalAt < 0 || goalAt > placedAt) return { goal, moved: false }
  const next = steps[Math.min(placedAt + 1, steps.length - 1)].id
  return { goal: next, moved: next !== goal }
}

/** The sentence the result screen shows when a destination moved. */
export function goalMovedNote(toName: string, placedName: string): string {
  if (toName === placedName) return `Your goal moved to ${toName}: you are already at the end of this road.`
  return `Your goal moved to ${toName}: you are already at ${placedName}.`
}

/**
 * Where the Skills section's counter stands. Its screens are: pick the skills,
 * the destination, each question the interview will ask (one flow across the
 * chosen skills, or one screen per skill when the athlete picks their own
 * level) and the result. `total` is an upper bound while the planche ladder is
 * still open, which `open` says.
 */
export function skillsProgress(input: {
  stage: 'skills' | 'goal' | 'interview' | 'result'
  skillCount: number
  skipped: boolean
  /** Questions answered so far (interview), or the index of the skill being placed by hand. */
  position: number
  longest: number
  shortest: number
}): { at: number; total: number; open: boolean } {
  const middle = (asked: number) => (input.skipped ? Math.max(1, input.skillCount) : Math.max(asked, input.longest))
  const total = 3 + middle(input.position + 1)
  const open = !input.skipped && input.shortest !== input.longest
  if (input.stage === 'skills') return { at: 1, total, open }
  if (input.stage === 'goal') return { at: 2, total, open }
  if (input.stage === 'interview') return { at: 3 + input.position, total, open }
  const lastMiddle = input.skipped ? Math.max(1, input.skillCount) : input.position
  return { at: 3 + lastMiddle, total: 3 + lastMiddle, open: false }
}
