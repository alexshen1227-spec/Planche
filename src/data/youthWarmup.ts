import type { Block, Profile, SkillId, StepId } from '../types'
import { hold, reps } from './blocks'
import { EXERCISE_BY_ID } from './exercises'
import { STEP_BY_ID } from './progressions'
import { conservative } from '../lib/gym/draft'

/**
 * The longer warm-up for straight-arm skills under 18 (or with no age set).
 * A house rule from the athlete's own spec, not a proven protection: nothing
 * here claims it prevents injury. It adds a second set of wrist preparation,
 * a second set of scapular work and an easy primer hold of the day's main
 * position — about three minutes, and warm-ups are never trimmed to fit.
 */
const STRAIGHT_ARM: Partial<Record<SkillId, { wrist: boolean; scap: string }>> = {
  planche: { wrist: true, scap: 'scap-pushup' },
  handstand: { wrist: true, scap: 'pike-shrug' },
  frontlever: { wrist: false, scap: 'scap-pull' },
  flag: { wrist: true, scap: 'scap-pull' },
}

export const YOUTH_WARMUP_NOTE =
  'Longer straight-arm warm-up: you are under 18 or no age is set, so wrists, shoulder blades and an easy primer hold come first. This is the app’s own rule; it is not shown to prevent injury.'

/** Whether a skill's session gets the longer warm-up for this athlete. */
export function needsYouthWarmup(profile: Profile, skill: SkillId, now = Date.now()): boolean {
  return STRAIGHT_ARM[skill] !== undefined && conservative(profile, now)
}

export function youthWarmup(
  profile: Profile,
  skill: SkillId,
  stepId: StepId,
  warmup: Block[],
  workingSec: number | undefined,
  now = Date.now(),
): Block[] {
  const spec = STRAIGHT_ARM[skill]
  if (!spec || !conservative(profile, now)) return warmup
  const out = warmup.map((b) => ({ ...b }))
  const added: Block[] = []
  const ensure = (exerciseId: string, sets: number, make: () => Block) => {
    const have = out.find((b) => b.exerciseId === exerciseId)
    if (have) {
      // The second set follows at once: preparation, not a rest-between-sets exercise.
      if (have.sets < sets) have.restSec = Math.min(have.restSec, 12)
      have.sets = Math.max(have.sets, sets)
    }
    else added.push(make())
  }
  if (spec.wrist) {
    ensure('wrist-circles', 1, () => ({ exerciseId: 'wrist-circles', sets: 1, target: reps(10), restSec: 10, section: 'warmup' }))
    ensure('wrist-rocks', 2, () => ({ exerciseId: 'wrist-rocks', sets: 2, target: reps(8), restSec: 15, section: 'warmup' }))
  }
  ensure(spec.scap, 2, () => ({ exerciseId: spec.scap, sets: 2, target: reps(8), restSec: 12, section: 'warmup' }))
  // Preparation goes before the first hold of the warm-up; the primer stays last.
  const firstHold = out.findIndex((b) => b.target.kind === 'hold')
  const at = firstHold === -1 ? out.length : firstHold
  out.splice(at, 0, ...added)
  const key = STEP_BY_ID[stepId].keyExerciseId
  const hasPrimer = out.some((b) => b.target.kind === 'hold' && b.exerciseId !== 'dead-hang') || out.some((b) => b.exerciseId === key)
  if (!hasPrimer && EXERCISE_BY_ID[key]?.type === 'hold') {
    const sec = workingSec === undefined ? 5 : Math.min(5, Math.max(2, Math.round(workingSec / 2)))
    out.push({ exerciseId: key, sets: 1, target: hold(sec), restSec: 40, section: 'warmup', note: 'Easy primer — well inside what you can hold.' })
  }
  const first = out.find((b) => b.section === 'warmup' && !warmup.some((w) => w.exerciseId === b.exerciseId && w.sets === b.sets)) ?? out[0]
  if (first && !first.note) first.note = YOUTH_WARMUP_NOTE
  return out
}
