import type { GymPlan } from './builder'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import type { Joint, Muscle } from '../../data/gym/catalog'
import { lastPerformance, type LoadSuggestion, type RepPlan } from './progression'
import type { GymSession, GymState } from './types'
import { displayLoad, toKg } from './units'
import type { Unit } from '../../data/gym/catalog'
import type { Profile } from '../../types'

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
): DraftItem['previous'] {
  const last = lastPerformance(sessions, exerciseId, locationId)
  if (!last) return undefined
  return last.sets.map((s) => ({
    ...(s.kg !== undefined && s.kg > 0 ? { load: displayLoad(s.kg, unit) } : {}),
    reps: s.reps,
    ...(s.rpe !== undefined ? { rpe: s.rpe } : {}),
  }))
}

export interface GymDraft {
  id: string
  startedAt: number
  locationId: string
  name: string
  items: DraftItem[]
  /** What today's plan kept out — swaps and additions honour it too. */
  avoidJoints?: Joint[]
  musclesOff?: Muscle[]
}

/** Reps to pre-fill: the bottom of the range, or one more than last time when repeating a load. */
export function prefillReps(plan: RepPlan, suggestion: LoadSuggestion | undefined, lastReps?: number): number {
  const [lo, hi] = plan.range
  if (suggestion?.kind === 'repeat' && lastReps !== undefined) return Math.min(hi, Math.max(lo, lastReps + 1))
  return lo
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

export function loadDraft(): GymDraft | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as GymDraft
    if (!d || typeof d.id !== 'string' || !Array.isArray(d.items)) return null
    return { ...d, items: d.items.filter((it) => it && typeof it.exerciseId === 'string' && it.exerciseId in GYM_EXERCISE_BY_ID) }
  } catch {
    return null
  }
}

/** Finished sets only, loads back to kg. Planned sets never done make the session partial. */
export function sessionFromDraft(draft: GymDraft, endedAt: number): GymSession {
  let skipped = false
  const exercises = draft.items
    .map((item) => {
      const done = item.sets.filter((s) => s.done)
      if (done.length < item.sets.length) skipped = true
      return {
        exerciseId: item.exerciseId,
        sets: done.map((s) => ({
          reps: Math.max(0, Math.round(s.reps)),
          at: s.at ?? endedAt,
          ...(s.load !== undefined && s.load > 0 ? { kg: toKg(s.load, item.unit), unit: item.unit } : {}),
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
    endedAt,
    name: draft.name,
    exercises,
    completion: skipped ? 'partial' : 'full',
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
