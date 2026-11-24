import type { GymPlan } from './builder'
import { GYM_EXERCISE_BY_ID, jointsToRest } from '../../data/gym/exercises'
import type { Joint, Muscle } from '../../data/gym/catalog'
import { countUnit, lastPerformance, repPlanFor, type LoadSuggestion, type RepPlan } from './progression'
import type { GoalWeights, GymLocation, GymRemainder, GymSession, GymState, RemainingLift } from './types'
import { canDoHere } from './availability'
import { preparesFor } from './bodyweightSteps'
import { useStraightSets } from './pairedSets'
import { dayKey } from '../time'
import { entryLoad, toKg } from './units'
import type { Unit } from '../../data/gym/catalog'
import type { AttemptSymptom, Profile } from '../../types'

/** A gym session in progress, mirrored to storage on every change so a dying tab loses nothing. */
export interface DraftSet {
  /** In the exercise's display unit at this location. */
  load?: number
  reps: number
  rpe?: number
  done: boolean
  at?: number
  warmup?: boolean
}

export interface DraftItem {
  exerciseId: string
  pairedWith?: string
  /** Previously logged sets retained when today's joint check or equipment excludes the movement. */
  held?: boolean
  plan: RepPlan
  suggestion?: LoadSuggestion
  restSec: number
  unit: Unit
  sets: DraftSet[]
  swappedFrom?: string
  /**
   * Last session's working sets of this movement at this place, in the display
   * unit — shown beside each set ("Previous", as Strong and Hevy do) and one
   * tap away from being copied in. Absent the first time.
   */
  previous?: { load?: number; reps: number; rpe?: number }[]
}

/** Last time's sets, ready to show: loads in the display unit. */
export function previousSets(
  sessions: GymSession[],
  exerciseId: string,
  locationId: string,
  unit: Unit,
  now = Infinity,
): DraftItem['previous'] {
  const ex = GYM_EXERCISE_BY_ID[exerciseId]
  const last = lastPerformance(sessions, exerciseId, locationId, now, (s) => countUnit(ex, s) === countUnit(ex))
  if (!last) return undefined
  return last.sets.map((s) => ({
    ...(s.kg !== undefined ? { load: entryLoad(s.kg, unit) } : {}),
    reps: s.reps,
    ...(s.rpe !== undefined ? { rpe: s.rpe } : {}),
  }))
}

export interface GymDraft {
  id: string
  epoch?: string
  startedAt: number
  locationId: string
  name: string
  items: DraftItem[]
  /** End time of the saved partial session being continued. */
  resumeFrom?: number
  resumedAt?: number
  /** Restrictions of the original plan, before a continuation's pain check. */
  originalAvoidJoints?: Joint[]
  /** Previously prescribed lifts that the current joint check keeps out. */
  deferred?: RemainingLift[]
  /** Absolute end time so the timer keeps time while the phone sleeps. */
  rest?: { until: number; total: number; nextExerciseId?: string }
  effortFor?: { item: number; set: number }
  notes?: string
  stopReport?: AttemptSymptom & { at: number }
  /** What today's plan kept out — swaps and additions honour it too. */
  avoidJoints?: Joint[]
  musclesOff?: Muscle[]
  /**
   * The day's volume factor and the athlete's goals, so a movement added or swapped in mid-session is
   * dosed like the rest of the day. Both absent on an older draft: it then reads as a usual day on
   * the athlete's saved goals.
   */
  volumeFactor?: number
  goals?: GoalWeights
}

/**
 * What the day gave a movement, read back from its block so a swap can keep it: the kind of rep
 * range (strength, muscle, endurance, power) it was programmed with and how far its target effort
 * sits from that kind's usual (a lighter day stops a rep sooner). The kind is undefined when the
 * range matches none of them.
 */
export function dayOfItem(old: DraftItem, youth: boolean): { emphasis?: 'strength' | 'muscle' | 'endurance' | 'power'; rpeShift: number } {
  const ex = GYM_EXERCISE_BY_ID[old.exerciseId]
  const kind = ex
    ? (['muscle', 'strength', 'endurance', 'power'] as const).find((e) => {
        const r = repPlanFor(ex, e, youth).range
        return r[0] === old.plan.range[0] && r[1] === old.plan.range[1]
      })
    : undefined
  const base = ex ? repPlanFor(ex, kind ?? 'muscle', youth) : old.plan
  return { ...(kind ? { emphasis: kind } : {}), rpeShift: old.plan.targetRpe - base.targetRpe }
}

/** Reps to pre-fill: the bottom of the range, or one more than last time when repeating a load. */
export function prefillReps(plan: RepPlan, suggestion: LoadSuggestion | undefined, lastReps?: number): number {
  const [lo, hi] = plan.range
  // A lift held back shows the bar it has to clear, and the screen starts there.
  if (suggestion?.repsToMoveUp !== undefined) return suggestion.repsToMoveUp
  if (suggestion?.targetReps !== undefined) return suggestion.targetReps
  if (suggestion?.kind === 'repeat' && lastReps !== undefined) return Math.min(hi, Math.max(lo, lastReps + 1))
  return lo
}

/** Reps for a set added to a block: the last set's, else the bar a held-back lift must clear, else the top of the range. */
export function addedSetReps(lastReps: number | undefined, plan: RepPlan, suggestion: LoadSuggestion | undefined): number {
  return lastReps ?? suggestion?.repsToMoveUp ?? suggestion?.targetReps ?? plan.range[1]
}

const KEY = 'planchelab.gymDraft'

export function saveDraft(draft: GymDraft | null): void {
  try {
    if (draft) localStorage.setItem(KEY, JSON.stringify(draft))
    else localStorage.removeItem(KEY)
  } catch {
    // Storage full or blocked: the session still runs, it just cannot be resumed.
  }
}

export function loadDraft(epoch?: string): GymDraft | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as GymDraft
    if (!d || typeof d.id !== 'string' || !Array.isArray(d.items)) return null
    if (d.epoch && epoch && d.epoch !== epoch) return null
    return { ...d, items: d.items.filter((it) => it && typeof it.exerciseId === 'string' && it.exerciseId in GYM_EXERCISE_BY_ID) }
  } catch {
    return null
  }
}

function remainingLift(item: DraftItem, sets: DraftSet[]): RemainingLift {
  const trial = item.suggestion?.floorPushupTrial ?? item.suggestion?.pullupTrial
  const s = item.suggestion
  return {
    exerciseId: item.exerciseId, repRange: item.plan.range, targetRpe: item.plan.targetRpe,
    ...(item.plan.measure ? { measure: item.plan.measure } : {}),
    restSec: item.restSec, unit: item.unit, swappedFrom: item.swappedFrom,
    ...(item.pairedWith ? { pairedWith: item.pairedWith } : {}),
    sets: sets.map(({ reps, load, warmup }) => ({ reps, load, warmup })),
    ...(trial ? { trialReps: trial } : {}), ...(s?.variationTrial ? { variationTrial: s.variationTrial } : {}),
    ...(s?.easierId ? { easierId: s.easierId } : {}),
    ...(s && (s.kind === 'at-minimum-weight' || s.kind === 'at-top-weight') ? { rackTarget: {
      kind: s.kind, reps: s.targetReps, why: s.why, chooseAlternative: s.chooseAlternative,
    } } : {}),
  }
}

/** Recheck the unperformed part of an open workout without changing a single logged set. */
export function adaptOpenDraft(draft: GymDraft, joints: Joint[], light: boolean, location?: GymLocation): GymDraft {
  if (draft.stopReport) return draft
  const avoidJoints = [...new Set([...(draft.avoidJoints ?? []), ...joints])]
  const factor = draft.volumeFactor ?? 1
  const reduce = light && factor > 0.6
  const missingKit = (id: string) => location && !canDoHere(id, location)
  if (!avoidJoints.length && !reduce && !draft.items.some((it) => missingKit(it.exerciseId))) return draft
  if (draft.items.some((it) => it.pairedWith)) {
    draft = structuredClone(draft)
    draft.items.forEach((_, index) => useStraightSets(draft, index, Date.now()))
  }
  const deferred = [...(draft.deferred ?? [])]
  const items = draft.items.flatMap((item): DraftItem[] => {
    const ex = GYM_EXERCISE_BY_ID[item.exerciseId]
    if (jointsToRest(item.exerciseId).some((j) => avoidJoints.includes(j)) || missingKit(item.exerciseId)) {
      const left = item.sets.filter((s) => !s.done)
      if (left.length) deferred.push(remainingLift(item, left))
      const done = item.sets.filter((s) => s.done)
      return done.length ? [{ ...item, sets: done, held: true }] : []
    }
    if (!reduce || !item.sets.some((s) => !s.done)) return [item]
    const working = item.sets.filter((s) => !s.warmup)
    let left = Math.max(1, Math.round(working.length * 0.6 / factor)) - working.filter((s) => s.done).length
    const sets = item.sets.flatMap((s) => {
      if (s.done || s.warmup) return [s]
      if (left-- <= 0) return []
      // Choose a comfortable load at the easier target. An assistance setting has the opposite meaning.
      return [{ ...s, reps: item.plan.range[0], load: ex?.assisted ? s.load : undefined }]
    })
    return [{ ...item, plan: { ...item.plan, targetRpe: Math.min(item.plan.targetRpe, 7) }, suggestion: undefined, sets }]
  })
  return { ...draft, items, deferred, avoidJoints, originalAvoidJoints: draft.originalAvoidJoints ?? draft.avoidJoints ?? [],
    volumeFactor: reduce ? 0.6 : draft.volumeFactor, effortFor: reduce || deferred.length !== (draft.deferred?.length ?? 0) ? undefined : draft.effortFor }
}

/** Finished sets only, loads back to kg. Planned sets never done make the session partial. */
export function sessionFromDraft(draft: GymDraft, endedAt: number): GymSession {
  const remainingItems: RemainingLift[] = [...(draft.deferred ?? [])]
  const exercises = draft.items
    .map((item) => {
      const done = item.sets.filter((s) => s.done)
      const left = item.sets.filter((s) => !s.done)
      const prescribed = item.sets.filter((s) => !s.warmup).length
      if (left.length) remainingItems.push(remainingLift(item, left))
      return {
        exerciseId: item.exerciseId,
        ...(prescribed > 0 ? { plannedWorkingSets: prescribed } : {}),
        sets: done.map((s) => ({
          reps: Math.max(0, Math.round(s.reps)),
          ...(item.plan.measure ? { measure: item.plan.measure } : {}),
          at: s.at ?? endedAt,
          ...(s.load !== undefined && (s.load > 0 || GYM_EXERCISE_BY_ID[item.exerciseId]?.assisted) ? { kg: toKg(s.load, item.unit), unit: item.unit } : {}),
          ...(s.rpe !== undefined ? { rpe: s.rpe } : {}),
          ...(s.warmup ? { warmup: true } : {}),
        })),
        repRange: item.plan.range,
        targetRpe: item.plan.targetRpe,
        ...(item.swappedFrom ? { swappedFrom: item.swappedFrom } : {}),
      }
    })
    .filter((e) => e.sets.length > 0)
  return {
    id: draft.id,
    locationId: draft.locationId,
    startedAt: draft.startedAt,
    endedAt: Math.max(draft.stopReport?.at ?? endedAt, draft.startedAt, (draft.resumeFrom ?? 0) + 1),
    name: draft.name,
    ...(draft.notes?.trim() ? { notes: draft.notes.trim().slice(0, 2000) } : {}),
    exercises,
    completion: remainingItems.length ? 'partial' : 'full',
    ...(remainingItems.length && !draft.stopReport ? { remaining: { items: remainingItems, avoidJoints: draft.originalAvoidJoints ?? draft.avoidJoints, musclesOff: draft.musclesOff, volumeFactor: draft.volumeFactor, goals: draft.goals } } : {}),
  }
}

export function remainingSetCount(plan?: GymRemainder): number {
  return plan?.items.reduce((n, it) => n + it.sets.length, 0) ?? 0
}

export function latestPartialToday(sessions: GymSession[] = [], now = Date.now()): GymSession | undefined {
  const today = dayKey(now)
  const latest = sessions.reduce<GymSession | undefined>((last, s) =>
    s.startedAt <= now && (dayKey(s.startedAt) === today || (s.endedAt <= now && dayKey(s.endedAt) === today)) &&
      (!last || s.endedAt > last.endedAt) ? s : last, undefined)
  return latest?.completion === 'partial' ? latest : undefined
}

/** Keep the original prescription, unit and location, and leave saved sets in history. */
export function resumePartial(session: GymSession, avoid: Joint[] = [], location?: GymLocation, now = Date.now()): GymDraft | null {
  const plan = session.remaining
  if (session.completion !== 'partial' || !plan?.items.length) return null
  const avoidJoints = [...new Set([...(plan.avoidJoints ?? []), ...avoid])]
  const items: DraftItem[] = []
  const deferred: RemainingLift[] = []
  for (const it of plan.items) {
    const ex = GYM_EXERCISE_BY_ID[it.exerciseId]
    if (!ex || jointsToRest(it.exerciseId).some((j) => avoidJoints.includes(j)) || (location && !canDoHere(it.exerciseId, location))) {
      deferred.push(it)
      continue
    }
    items.push({
      exerciseId: it.exerciseId, plan: { range: it.repRange, targetRpe: it.targetRpe, ...(it.measure ? { measure: it.measure } : {}) }, restSec: it.restSec, unit: it.unit,
      ...(it.pairedWith && !avoidJoints.length && (plan.volumeFactor ?? 1) >= 1 ? { pairedWith: it.pairedWith } : {}),
      sets: it.sets.map((s) => ({ ...s, done: false })), swappedFrom: it.swappedFrom,
      ...(it.rackTarget ? { suggestion: {
        kind: it.rackTarget.kind, reps: it.repRange, targetRpe: it.targetRpe, why: it.rackTarget.why,
        targetReps: it.rackTarget.reps, chooseAlternative: it.rackTarget.chooseAlternative, easierId: it.easierId,
      } } : it.trialReps || it.easierId || it.variationTrial ? { suggestion: {
        kind: 'bodyweight', reps: it.repRange, targetRpe: it.targetRpe, why: '', easierId: it.easierId,
        ...(it.variationTrial ? { variationTrial: it.variationTrial } : {}),
        ...(it.trialReps && (preparesFor(it.exerciseId) === 'push-up' ? { floorPushupTrial: it.trialReps } : { pullupTrial: it.trialReps })),
      } } : {}),
    })
  }
  if (!items.length) return null
  return {
    id: session.id, name: session.name, startedAt: session.startedAt, locationId: session.locationId,
    resumeFrom: session.endedAt, resumedAt: now, originalAvoidJoints: plan.avoidJoints ?? [],
    items, deferred, avoidJoints, musclesOff: plan.musclesOff, volumeFactor: plan.volumeFactor, goals: plan.goals, notes: session.notes,
  }
}

/** Age from the profile, when known. */
export function ageOf(profile: Profile, now = Date.now()): number | undefined {
  if (!profile.birthYear) return undefined
  return new Date(now).getFullYear() - profile.birthYear
}

/**
 * The careful defaults: under 18, or age unknown. No near-maximal low-rep
 * ranges, one load step at a time, coaching-heavy lifts not picked by default.
 */
export function conservative(profile: Profile, now = Date.now()): boolean {
  // Only the birth year is known, so a year difference of 18 may still be a
  // 17-year-old: careful until it is certainly 18.
  const age = ageOf(profile, now)
  return age === undefined || age <= 18
}

export function activeLocation(gym: GymState | undefined) {
  return gym?.locations.find((l) => l.id === gym.activeLocationId) ?? gym?.locations[0]
}

export type { GymPlan }
