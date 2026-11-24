import { MUSCLE_BY_ID } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID, type GymExercise } from '../../data/gym/exercises'
import type { DraftItem, GymDraft } from './draft'
import type { GymSession } from './types'

/** Time to put down the first implement and get set for the other movement. */
export const PAIR_SWITCH_SEC = 20

const lightKit = new Set(['dumbbells', 'band', 'wall'])
const atBench = new Set([...lightKit, 'bench', 'incline-bench'])
const portable = (ex: GymExercise, kit: Set<string>) =>
  (ex.load === 'bodyweight' || ex.load === 'dumbbell') && ex.needs.every((choice) => choice.some((id) => kit.has(id)))

/** One upper and one lower isolation lift at a single station, with separate prime movers and helpers. */
export function canPairExercises(first: string, second: string): boolean {
  const a = GYM_EXERCISE_BY_ID[first], b = GYM_EXERCISE_BY_ID[second]
  if (!a || !b || [a, b].some((e) => e.compound || e.technical || e.unilateral || e.dose || e.explosive || e.assisted || e.load === 'barbell')) return false
  const muscles = new Set([...a.primary, ...a.secondary])
  if ([...b.primary, ...b.secondary].some((m) => muscles.has(m))) return false
  const legs = (ex: GymExercise) => ex.primary.every((m) => MUSCLE_BY_ID[m].group === 'legs')
  if (legs(a) === legs(b)) return false
  if ((legs(a) ? b : a).primary.some((m) => ['core', 'legs'].includes(MUSCLE_BY_ID[m].group))) return false
  return portable(a, lightKit) || portable(b, lightKit) || (portable(a, atBench) && portable(b, atBench))
}

type PairItem = { exerciseId: string; pairedWith?: string; held?: boolean; restSec: number }

export function partnerIndex(items: readonly PairItem[], index: number): number {
  const item = items[index]
  if (!item?.pairedWith || item.held || !canPairExercises(item.exerciseId, item.pairedWith)) return -1
  return items.findIndex((p) => !p.held && p.exerciseId === item.pairedWith && p.pairedWith === item.exerciseId)
}

/** Each short change replaces one ordinary rest. Unmatched sets still get their full interval. */
export function savedPairSeconds(a: number, b: number, restSec: number): number {
  const rounds = Math.min(a, b)
  return rounds > 0 ? (2 * rounds - 1) * Math.max(0, restSec - PAIR_SWITCH_SEC) : 0
}

function lastWorkingSet(item: DraftItem, previous?: GymSession): number {
  const times = item.sets.filter((s) => s.done && !s.warmup).map((s) => s.at ?? 0)
  for (const row of previous?.exercises ?? []) if (row.exerciseId === item.exerciseId) {
    for (const set of row.sets) if (!set.warmup) times.push(set.at)
  }
  return Math.max(0, ...times)
}

/** After undoing or removing the latest set, give the earlier completed set its actual remaining rest. */
export function restoreSetRest(draft: GymDraft, now: number, previous?: GymSession): void {
  let latest = 0, lift = -1, set = -1
  draft.items.forEach((item, i) => item.sets.forEach((row, j) => {
    if (row.done && row.at && row.at >= latest) { latest = row.at; lift = i; set = j }
  }))
  const rest = lift < 0 ? undefined : restAfterSet(draft, lift, set, latest, previous)
  draft.rest = rest && rest.until > now ? rest : undefined
}

/** Use the other lift's actual finish time even if an athlete logged the switch unusually quickly. */
export function restAfterSet(draft: GymDraft, index: number, set: number, at: number, previous?: GymSession): GymDraft['rest'] {
  if (!draft.items.some((it) => !it.held && it.sets.some((s) => !s.done))) return undefined
  const item = draft.items[index]
  const partner = draft.items[partnerIndex(draft.items, index)]
  if (partner && !item.sets[set].warmup && partner.sets.some((s) => !s.done && !s.warmup) &&
      !partner.sets.some((s) => !s.done && s.warmup)) {
    const until = Math.max(at + PAIR_SWITCH_SEC * 1000, lastWorkingSet(partner, previous) + partner.restSec * 1000)
    return { until, total: Math.ceil((until - at) / 1000), nextExerciseId: partner.exerciseId }
  }
  return { until: at + item.restSec * 1000, total: item.restSec }
}

/** Restore the ordinary recovery clock when a pair ends during a change of exercises. */
export function useStraightSets(draft: GymDraft, index: number, at: number): void {
  const item = draft.items[index]
  if (!item?.pairedWith) return
  const partner = draft.items.find((it) => it.exerciseId === item.pairedWith && it.pairedWith === item.exerciseId)
  if (partner && (draft.rest?.nextExerciseId === item.exerciseId || draft.rest?.nextExerciseId === partner.exerciseId ||
      (!draft.rest && draft.items.some((it) => !it.held && it.sets.some((s) => !s.done))))) {
    const until = Math.max(draft.rest?.until ?? 0, lastWorkingSet(item) + item.restSec * 1000, lastWorkingSet(partner) + partner.restSec * 1000)
    draft.rest = until > at ? { until, total: Math.ceil((until - at) / 1000) } : undefined
  }
  if (partner) delete partner.pairedWith
  delete item.pairedWith
}
