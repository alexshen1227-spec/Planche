import type { StepId } from '../types'
import { STEP_BY_ID, stepBefore } from './progressions'

/**
 * The push-up version of every step on the road.
 *
 * Each planche hold has a pressing twin — the same body shape, moved through a
 * push-up. Coaches commonly program the two side by side because the press
 * trains the bent-arm half of the position (the bottom of a planche press, the
 * strength to fight back into lockout) that a pure hold never visits. That
 * pairing is coaching consensus; no trial compares planche programs with and
 * without it.
 *
 * Earlier steps have no planche-shaped press, so their twin is the closest
 * movement that trains the same lean: a push-up at Foundations, the pseudo
 * planche push-up at the lean and frog stand.
 */
export const PUSHUP_VERSION: Record<StepId, string> = {
  foundations: 'pushup',
  lean: 'pppu',
  frog: 'pppu',
  tuck: 'tuck-planche-pushup',
  advtuck: 'adv-tuck-planche-pushup',
  // There is no common one-leg planche push-up; the advanced tuck press is
  // the shape the one-leg step is built on.
  oneleg: 'adv-tuck-planche-pushup',
  straddle: 'straddle-planche-pushup',
  full: 'full-planche-pushup',
}

/**
 * Pressing movements from easiest to hardest. Used to order the Library and to
 * step down when a press is out of reach. Not a strength scale — the gaps
 * between neighbours are nothing like equal.
 */
export const PRESS_LADDER: string[] = [
  'knee-pushup',
  'pushup',
  'pppu',
  'tuck-planche-pushup',
  'adv-tuck-planche-pushup',
  'straddle-planche-pushup',
  'full-planche-pushup',
]

/**
 * How much of the step's hold bar the athlete must own before pressing in that
 * shape. Pressing a position you can barely hold means every rep starts from a
 * shape that is already failing — so until the hold is half-way to its bar the
 * press stays one step behind, which is the usual coaching advice ("your press
 * trails your hold by a progression"). A convention, not a measured threshold.
 */
export const PRESS_AT_LEVEL_SHARE = 0.5

export interface PressingChoice {
  exerciseId: string
  /** True when this is the step's own push-up version rather than the one behind it. */
  atLevel: boolean
  /** Plain-language reason, for the block note. */
  reason: string
}

/**
 * The push-up version to program for an athlete at `stepId` whose best
 * comparable hold on the step's key exercise is `holdSec` (undefined = never
 * measured).
 */
export function pressingChoiceFor(stepId: StepId, holdSec: number | undefined): PressingChoice {
  const step = STEP_BY_ID[stepId]
  const own = PUSHUP_VERSION[stepId]
  const prev = stepBefore(stepId)
  const behind = prev ? PUSHUP_VERSION[prev.id] : own
  // Steps whose twin is not a planche-shaped press have nothing to trail.
  if (own === behind || step.order <= STEP_BY_ID.frog.order) {
    return { exerciseId: own, atLevel: true, reason: 'The pressing twin of this step.' }
  }
  const bar = step.unlockSec * PRESS_AT_LEVEL_SHARE
  if (holdSec !== undefined && holdSec >= bar) {
    return {
      exerciseId: own,
      atLevel: true,
      reason: `Your ${step.name.toLowerCase()} is solid enough to press in — the push-up version of the hold you are building.`,
    }
  }
  return {
    exerciseId: behind,
    atLevel: false,
    reason:
      holdSec === undefined
        ? `Pressing one step behind until your ${step.name.toLowerCase()} has a measured hold — the press usually trails the hold by a progression.`
        : `Pressing one step behind until your ${step.name.toLowerCase()} reaches about ${Math.round(bar)}s — the press usually trails the hold by a progression.`,
  }
}
