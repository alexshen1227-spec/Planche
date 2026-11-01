import type { Block, FormRating, Workout } from '../types'

/**
 * Right difficulty, set by set.
 *
 * A session is planned before the first hold, from history; the first hold is
 * the best evidence of what today actually is. These rules let the plan follow
 * the athlete inside a session instead of holding a number that has just been
 * shown to be too easy or too hard:
 *
 * - a hold that blew well past its target raises the next one a little;
 * - two short holds in a row bring the target to what is being achieved — one
 *   short set alone is noise and changes nothing;
 * - an athlete-confirmed "broke" eases the next target straight away;
 * - when two consecutive holds fall far below the best of the session, more
 *   sets mostly rehearse a tired position, so moving on is *suggested* — the
 *   athlete decides.
 *
 * Changes are small and bounded: never more than half again above the plan,
 * never above the bar, never past the best hold of the session. This is the
 * set-to-set version of the autoregulation the coach already does between
 * sessions. The drop-off cut is borrowed by analogy from velocity-loss
 * training of dynamic lifts; no study has set an isometric threshold, so the
 * numbers are a design choice, and the wording says so where it reaches an
 * athlete.
 */

/**
 * Whether set-to-set advice may move a block's target at all. Never for
 * warm-ups, cooldowns, unlock attempts, max tests, single-set blocks,
 * per-side work (two sides, one target) or an easy day's light dose — which
 * is meant to stay light however easy its first set felt.
 */
export function adjustsSetToSet(
  block: Pick<Block, 'light' | 'role' | 'section' | 'sets'>,
  workoutKind: Workout['kind'],
  perSide: boolean,
): boolean {
  return !(
    workoutKind === 'test' ||
    block.light ||
    block.role === 'attempt' ||
    block.section === 'warmup' ||
    block.section === 'cooldown' ||
    block.sets <= 1 ||
    perSide
  )
}

export interface SetOutcome {
  /** Credited seconds for holds, reps for rep work. */
  value: number
  /** The target this set was asked for. */
  target: number
  /** The athlete's own confirmed rating, when given. */
  rating?: FormRating
  /** Ended for a reason that says nothing about capacity (interruption, timing). */
  nonCapacity?: boolean
}

export interface NextSetAdvice {
  /** Target for the next set. */
  target: number
  change: 'up' | 'down' | 'same'
  /** One short sentence for the rest screen, when the target changed or nearly did. */
  reason?: string
  /** Present when moving on is the better trade; the athlete chooses. */
  suggestMoveOn?: string
}

/** Above this share of the target, a hold was comfortably beyond it. */
export const EASY_SHARE = 1.5
/** Below this share of the target, a hold fell short. */
export const SHORT_SHARE = 0.75
/** Below this share of the session's best, a hold has dropped off. */
export const DROP_OFF_SHARE = 0.6
/** The most a target may rise above the plan within one session. */
export const MAX_RISE = 1.5

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Advice for the next hold of a main block.
 *
 * @param planned the target the plan gave this block
 * @param done this block's completed sets so far, oldest first
 * @param ceiling the most a target may ever be (the step's bar)
 */
export function adviseNextHold(planned: number, done: SetOutcome[], ceiling = Infinity): NextSetAdvice {
  const usable = done.filter((d) => !d.nonCapacity && Number.isFinite(d.value) && d.value >= 0)
  const last = usable[usable.length - 1]
  if (!last) return { target: planned, change: 'same' }
  const current = last.target > 0 ? last.target : planned
  const best = Math.max(...usable.map((d) => d.value))

  // Two holds in a row far below the best of the session: more sets now mostly
  // rehearse a tired position.
  const recent = usable.slice(-2)
  const droppedOff =
    usable.length >= 3 &&
    recent.length === 2 &&
    best > 0 &&
    recent.every((d) => d.value < best * DROP_OFF_SHARE)
  const suggestMoveOn = droppedOff
    ? `Your last two holds were under ${Math.round(DROP_OFF_SHARE * 100)}% of your best today. Extra sets now mostly practise a tired position — moving on is usually the better trade.`
    : undefined

  if (last.rating === 'broke') {
    const eased = Math.max(1, Math.min(current, Math.round(last.value * 0.8)))
    return eased < current
      ? { target: eased, change: 'down', reason: 'Last set broke down — the next target is eased so it can be held clean.', suggestMoveOn }
      : { target: current, change: 'same', suggestMoveOn }
  }

  const shortNow = last.value < last.target * SHORT_SHARE
  const prev = usable[usable.length - 2]
  const shortBefore = prev !== undefined && prev.value < prev.target * SHORT_SHARE
  if (shortNow && shortBefore) {
    const achieved = Math.max(1, Math.round(median([last.value, prev.value])))
    if (achieved < current) {
      return {
        target: achieved,
        change: 'down',
        reason: `Two holds in a row fell short — the target follows what you are holding today (${achieved}s), so every set stays clean.`,
        suggestMoveOn,
      }
    }
  }
  if (shortNow) {
    return {
      target: current,
      change: 'same',
      reason: 'One short hold is noise — same target. If the next is short too, it comes down.',
      suggestMoveOn,
    }
  }

  const easy =
    last.value >= last.target * EASY_SHARE &&
    last.value >= last.target + 2 &&
    last.rating !== 'slipped'
  if (easy) {
    const step = Math.max(1, Math.round(current * 0.15))
    const raised = Math.min(Math.floor(planned * MAX_RISE), Math.floor(ceiling), Math.floor(best), current + step)
    if (raised > current) {
      return {
        target: raised,
        change: 'up',
        reason: `That hold went well past ${current}s — next target ${raised}s. Still stop at the first loss of shape.`,
        suggestMoveOn,
      }
    }
  }
  return { target: current, change: 'same', suggestMoveOn }
}

/**
 * Advice for the next set of rep work: a rep more after a set that clearly had
 * spare reps, what was achieved after a clear miss. Never more than three
 * above the plan; never above the ceiling.
 */
export function adviseNextReps(planned: number, done: SetOutcome[], ceiling = Infinity): NextSetAdvice {
  const usable = done.filter((d) => !d.nonCapacity && Number.isFinite(d.value) && d.value >= 0)
  const last = usable[usable.length - 1]
  if (!last) return { target: planned, change: 'same' }
  const current = last.target > 0 ? last.target : planned
  if (last.value >= current + 2) {
    const raised = Math.min(planned + 3, Math.floor(ceiling), current + 1)
    if (raised > current) {
      return { target: raised, change: 'up', reason: `Spare reps last set — next set ${raised}.` }
    }
  }
  if (last.value < current - 1) {
    const matched = Math.max(1, Math.floor(last.value))
    return {
      target: matched,
      change: 'down',
      reason: `Next set matches what you just did (${matched}) — clean reps count, ground-out ones teach the wrong shape.`,
    }
  }
  return { target: current, change: 'same' }
}
