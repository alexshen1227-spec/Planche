import type { GymPlan } from './builder'
import type { LoadSuggestion, RepPlan } from './progression'
import type { GymSession, GymState } from './types'
import { toKg } from './units'
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
}

export interface GymDraft {
  id: string
  startedAt: number
  locationId: string
  name: string
  items: DraftItem[]
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
    return d && typeof d.id === 'string' && Array.isArray(d.items) ? d : null
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
  const age = ageOf(profile, now)
  return age === undefined || age < 18
}

export function activeLocation(gym: GymState | undefined) {
  return gym?.locations.find((l) => l.id === gym.activeLocationId) ?? gym?.locations[0]
}

export type { GymPlan }
