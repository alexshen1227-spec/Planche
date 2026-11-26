import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { dayKey } from '../time'
import { GYM_WRITER_KEY, type DraftItem, type GymDraft } from './draft'
import { focusFromName } from './focus'
import { partnerIndex, restoreSetRest } from './pairedSets'

/**
 * The workout generator's version, stored on every plan it builds (`GymDraft.planRevision`). Bump it whenever the
 * builder would pick different exercises or sets for the same inputs: an open plan that nothing has been done in
 * (`untouchedGymPlan`) and that an older version built is rebuilt with the new logic when the Gym screen opens
 * (`regeneratedPlan`). Saved sessions, logged sets and a workout in progress are never rebuilt.
 * 1: stale workouts are rebuilt. 2 (2026-11-24): Push and Pull days fund their main compounds first, curls never
 * outnumber the back compounds, and the pull-up is the default vertical pull. 3: no redundant pairs (an easier
 * version only as a finisher), about two isolation exercises a muscle, lifting capped near an hour, and spare time
 * raises existing exercises to four sets before adding new ones. 4: accessory slots are shared out by the athlete's
 * ratings, with a new exercise tried now and then (`rotation.ts`), and movements are classified by the muscles they
 * actually train (wrist curls are forearm work, not a biceps slot). 5 (2026-11-26, the generator stress test,
 * `planInvariants.ts`): every day keeps one set of each movement it is named for before any of them goes, and names it
 * by a compound; no muscle past its session ceiling on any day; at most two exercises of one pattern; one finisher a
 * lift; trunk work after the compounds; the time fit reads the order the session runs in; a lift a stall set aside
 * is not another lift's back-off; and a day that cannot have a movement it is named for says why.
 */
export const GYM_PLAN_REVISION = 5

export function untouchedGymPlan(draft: GymDraft): boolean {
  return !!focusFromName(draft.name) && !draft.edited && draft.resumeFrom === undefined && !draft.stopReport &&
    !draft.notes && !draft.deferred?.length && !draft.rest && !draft.effortFor &&
    draft.items.every((it) => !it.held && !it.swappedFrom && it.sets.every((s) =>
      !s.done && !s.warmup && !s.repsEdited && !s.loadEdited))
}

export function outdatedGymPlan(draft: GymDraft): boolean {
  return (draft.planRevision ?? 0) < GYM_PLAN_REVISION && untouchedGymPlan(draft)
}

/** Another tab's player holds the open workout (`WorkoutWriter`): it is that tab's to change. */
export function gymWriterBusy(): boolean {
  try {
    return Boolean(localStorage.getItem(GYM_WRITER_KEY))
  } catch {
    return false
  }
}

/**
 * A plan nothing has been done in, rebuilt by the current generator: the same workout (its id, day type, place and
 * the limits its check-in set) with today's exercises, not yet started. Null when anything was logged or edited in
 * the old one — work in progress is never rebuilt behind the athlete's back — or when the new build is empty.
 */
export function regeneratedPlan(old: GymDraft, fresh: Pick<GymDraft, 'name' | 'items'> & Partial<GymDraft>, now: number): GymDraft | null {
  if (!untouchedGymPlan(old) || !fresh.items.length) return null
  return { ...old, ...fresh, id: old.id, locationId: old.locationId, startedAt: now, planRevision: GYM_PLAN_REVISION,
    ...(old.epoch ? { epoch: old.epoch } : {}) }
}

/** Work already started belongs to the day and place where it was performed. */
export function canReplanGym(draft: GymDraft, placeId: string, now: number): boolean {
  return draft.resumeFrom === undefined && !draft.stopReport && !draft.deferred?.length &&
    (untouchedGymPlan(draft) || (draft.locationId === placeId && dayKey(draft.startedAt) === dayKey(now)))
}

/** Rebuild the unperformed work while keeping completed sets in their original units and prescription. */
export function replanGymDraft(old: GymDraft, fresh: GymDraft, now: number): GymDraft {
  if (!canReplanGym(old, fresh.locationId, now) || !fresh.items.length) return old
  if (untouchedGymPlan(old)) return fresh
  const completed: DraftItem[] = []
  const next = fresh.items.map((item) => ({ ...item, sets: [...item.sets] }))
  let extra = 0
  for (const item of old.items) {
    const done = item.sets.filter((s) => s.done)
    if (!done.length) continue
    const count = done.filter((s) => !s.warmup).length
    const match = next.find((it) => it.exerciseId === item.exerciseId && it.sets.length && !it.sets.some((s) => s.done))
    const covered = match ? Math.min(match.sets.length, count) : 0
    extra += count - covered
    if (match) {
      match.sets.splice(0, covered)
      // Combine identical prescriptions. Changed targets or units keep their own
      // log block, just as a saved partial does after its next prescription changes.
      const compatible = match.unit === item.unit && match.plan.measure === item.plan.measure &&
        match.plan.range[0] === item.plan.range[0] && match.plan.range[1] === item.plan.range[1] &&
        match.plan.targetRpe === item.plan.targetRpe && match.suggestion?.targetReps === item.suggestion?.targetReps &&
        match.suggestion?.repsToMoveUp === item.suggestion?.repsToMoveUp
      if (compatible) {
        const pending = item.sets.filter((s) => !s.done && !s.warmup)
        const last = done.filter((s) => !s.warmup).at(-1)
        match.sets = [...done, ...match.sets.map((s, i) => pending[i] ?? (last ? { ...s, load: last.load, reps: last.reps } : s))]
        continue
      }
    }
    completed.push({ ...item, sets: done, held: true, heldAfterReplan: true, pairedWith: undefined })
  }
  // Off-plan work still counts toward the visit. Spend remaining slots on the
  // prescribed compounds first, then on accessories in their planned order.
  const lastFirst = [...next].reverse()
  for (const item of [...lastFirst.filter((it) => !GYM_EXERCISE_BY_ID[it.exerciseId].compound),
    ...lastFirst.filter((it) => GYM_EXERCISE_BY_ID[it.exerciseId].compound)]) {
    while (extra > 0 && item.sets.length && !item.sets.at(-1)!.done) {
      item.sets.pop()
      extra--
    }
  }
  const items = [...completed, ...next.filter((item) => item.sets.length)]
  for (const [i, item] of items.entries()) if (item.pairedWith && partnerIndex(items, i) < 0) item.pairedWith = undefined
  const result: GymDraft = { ...fresh, items, id: old.id, startedAt: old.startedAt, notes: old.notes, edited: true }
  restoreSetRest(result, now)
  return result
}
