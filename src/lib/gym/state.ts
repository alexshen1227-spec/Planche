import { GYM_EQUIPMENT_BY_ID, type GymEquipmentId, type Unit } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID, type LocationEquipment } from '../../data/gym/exercises'
import { EQUIPMENT_OPTIONS } from '../../data/equipment'
import type { EquipmentId } from '../../types'
import { MUSCLES, type Muscle } from '../../data/gym/catalog'
import { SKILL_IDS, type SkillId, type StepId } from '../../types'
import { STEP_BY_ID } from '../../data/progressions'
import type {
  ActivityKind,
  GymExerciseLog,
  GymLocation,
  GymSession,
  GymSet,
  GymState,
  OutsideActivity,
  Rating,
  SkillGoal,
  SportSlot,
  TrainingPrefs,
} from './types'

const MAX_TOMBSTONES = 500
const KIT = new Set<string>(EQUIPMENT_OPTIONS.map((o) => o.id))
const isEquipment = (v: unknown): v is LocationEquipment =>
  typeof v === 'string' && (KIT.has(v) || v in GYM_EQUIPMENT_BY_ID)
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
const isUnit = (v: unknown): v is Unit => v === 'kg' || v === 'lb'
const RATINGS: Rating[] = ['love', 'fine', 'avoid']

const MUSCLE_IDS = new Set<string>(MUSCLES.map((m) => m.id))
const ACTIVITY_KINDS: ActivityKind[] = ['sprint', 'practice', 'game', 'pe', 'run', 'other']
const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

/** What an athlete who has set nothing gets: balanced goals, 45 minutes most days. */
export function defaultPrefs(now = Date.now()): TrainingPrefs {
  return {
    goals: { strength: 3, power: 2, physique: 3, skills: 4, endurance: 1 },
    skillGoals: [],
    musclesOff: [],
    musclesPriority: [],
    minutesByDay: [60, 45, 0, 45, 0, 45, 60],
    straightArmRestHours: 48,
    updatedAt: now,
  }
}

function sanitizePrefs(raw: unknown): TrainingPrefs | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const g = (typeof r.goals === 'object' && r.goals !== null ? r.goals : {}) as Record<string, unknown>
  const base = defaultPrefs(1)
  const muscles = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.filter((m): m is Muscle => typeof m === 'string' && MUSCLE_IDS.has(m)))] : []
  const skillGoals: SkillGoal[] = Array.isArray(r.skillGoals)
    ? r.skillGoals.flatMap((sg): SkillGoal[] => {
        if (typeof sg !== 'object' || sg === null) return []
        const v = sg as Record<string, unknown>
        const step = typeof v.stepId === 'string' ? STEP_BY_ID[v.stepId as StepId] : undefined
        if (!step || typeof v.by !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.by)) return []
        if (!SKILL_IDS.includes(step.skill as SkillId)) return []
        return [{ id: typeof v.id === 'string' && v.id ? v.id : `goal-${step.id}`, skill: step.skill, stepId: step.id, by: v.by }]
      })
    : []
  const sportSchedule = sanitizeSportSchedule(r.sportSchedule)
  const fieldTimes = sanitizeFieldTimes(r.fieldTimes)
  const minutes = Array.isArray(r.minutesByDay) && r.minutesByDay.length === 7
    ? r.minutesByDay.map((m) => Math.round(clamp(m, 0, 240, 0)))
    : base.minutesByDay
  return {
    goals: {
      strength: clamp(g.strength, 0, 5, base.goals.strength),
      power: clamp(g.power, 0, 5, base.goals.power),
      physique: clamp(g.physique, 0, 5, base.goals.physique),
      skills: clamp(g.skills, 0, 5, base.goals.skills),
      endurance: clamp(g.endurance, 0, 5, base.goals.endurance),
    },
    skillGoals,
    musclesOff: muscles(r.musclesOff),
    musclesPriority: muscles(r.musclesPriority),
    minutesByDay: minutes,
    straightArmRestHours: Math.round(clamp(r.straightArmRestHours, 24, 96, 48)),
    ...(r.season === 'in' ? { season: 'in' as const } : {}),
    ...(sportSchedule.length ? { sportSchedule } : {}),
    ...(fieldTimes ? { fieldTimes } : {}),
    updatedAt: isTime(r.updatedAt) ? r.updatedAt : 1,
  }
}

/** Every setting a training-prefs edit can change on its own (all but the stamps). */
const PREF_FIELDS = ['goals', 'skillGoals', 'musclesOff', 'musclesPriority', 'minutesByDay', 'straightArmRestHours', 'season', 'sportSchedule'] as const

function sanitizeFieldTimes(raw: unknown): Record<string, number> | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const out: Record<string, number> = {}
  for (const k of PREF_FIELDS) {
    const t = (raw as Record<string, unknown>)[k]
    if (isTime(t)) out[k] = t
  }
  return Object.keys(out).length ? out : undefined
}

const prefFieldTime = (p: TrainingPrefs, k: string) => p.fieldTimes?.[k] ?? p.updatedAt

/**
 * Two copies of the training prefs, converged field by field: each setting
 * comes from the side that changed it last (a tie keeps `local`).
 */
export function mergePrefs(local: TrainingPrefs | undefined, incoming: TrainingPrefs | undefined): TrainingPrefs | undefined {
  if (!incoming) return local
  if (!local) return incoming
  const out: Record<string, unknown> = {}
  const times: Record<string, number> = {}
  for (const k of PREF_FIELDS) {
    const useIncoming = prefFieldTime(incoming, k) > prefFieldTime(local, k)
    const from = useIncoming ? incoming : local
    const v = (from as unknown as Record<string, unknown>)[k]
    if (v !== undefined) out[k] = v
    times[k] = prefFieldTime(from, k)
  }
  const stamped = Boolean(local.fieldTimes || incoming.fieldTimes)
  return { ...(out as unknown as TrainingPrefs), ...(stamped ? { fieldTimes: times } : {}), updatedAt: Math.max(local.updatedAt, incoming.updatedAt) }
}

/**
 * The regular sport week: one slot per weekday (the first one wins), a weekday
 * outside 0–6 dropped, an unknown kind read as "other" like a logged activity.
 */
function sanitizeSportSchedule(raw: unknown): SportSlot[] {
  if (!Array.isArray(raw)) return []
  const byDay = new Map<number, SportSlot>()
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    const weekday = v.weekday
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 0 || weekday > 6 || byDay.has(weekday)) continue
    const hour = typeof v.hour === 'number' && Number.isInteger(v.hour) && v.hour >= 0 && v.hour <= 23 ? v.hour : undefined
    byDay.set(weekday, {
      weekday,
      kind: ACTIVITY_KINDS.includes(v.kind as ActivityKind) ? (v.kind as ActivityKind) : 'other',
      minutes: Math.round(clamp(v.minutes, 10, 300, 60)),
      rpe: Math.round(clamp(v.rpe, 1, 10, 6)),
      legs: v.legs === true,
      ...(hour !== undefined ? { hour } : {}),
    })
  }
  return [...byDay.values()].sort((a, b) => a.weekday - b.weekday)
}

function sanitizeActivity(raw: unknown): OutsideActivity | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id || !isTime(r.at)) return null
  const kind = ACTIVITY_KINDS.includes(r.kind as ActivityKind) ? (r.kind as ActivityKind) : 'other'
  return {
    id: r.id,
    at: r.at,
    kind,
    minutes: Math.round(clamp(r.minutes, 1, 600, 30)),
    rpe: Math.round(clamp(r.rpe, 1, 10, 6)),
    legs: r.legs === true,
    ...(typeof r.note === 'string' && r.note ? { note: r.note.slice(0, 200) } : {}),
    updatedAt: isTime(r.updatedAt) ? r.updatedAt : r.at,
  }
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** The first location, seeded from the calisthenics kit the athlete already listed. */
export function homeLocation(kit: EquipmentId[], unit: Unit = 'kg', now = Date.now()): GymLocation {
  return { id: 'home', name: 'Home', unit, equipment: [...new Set<LocationEquipment>(kit)], updatedAt: now }
}

export function defaultGym(kit: EquipmentId[], unit: Unit = 'kg', now = Date.now()): GymState {
  return { locations: [homeLocation(kit, unit, now)], activeLocationId: 'home', sessions: [], ratings: {}, favoriteAt: {} }
}

export function newLocation(name: string, unit: Unit, equipment: LocationEquipment[] = [], now = Date.now()): GymLocation {
  return { id: newId('loc'), name: name.trim() || 'Gym', unit, equipment, updatedAt: now }
}

export function newGymSessionId(): string {
  return newId('gym')
}

/** Per-exercise times: only known exercises, only real times. */
function sanitizeTimes(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (typeof raw === 'object' && raw !== null) {
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      if (id in GYM_EXERCISE_BY_ID && isTime(v)) out[id] = v
    }
  }
  return out
}

function sanitizeLocation(raw: unknown): GymLocation | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id) return null
  const gear: GymLocation['gear'] = {}
  if (typeof r.gear === 'object' && r.gear !== null) {
    for (const [id, g] of Object.entries(r.gear as Record<string, unknown>)) {
      if (!(id in GYM_EQUIPMENT_BY_ID) || typeof g !== 'object' || g === null) continue
      const v = g as Record<string, unknown>
      const entry: NonNullable<GymLocation['gear']>[GymEquipmentId] = {}
      if (isUnit(v.unit)) entry.unit = v.unit
      if (typeof v.maxKg === 'number' && v.maxKg > 0 && v.maxKg < 1000) entry.maxKg = v.maxKg
      if (typeof v.stepKg === 'number' && v.stepKg > 0 && v.stepKg <= 50) entry.stepKg = v.stepKg
      if (Object.keys(entry).length) gear[id as GymEquipmentId] = entry
    }
  }
  const hardHere = Array.isArray(r.hardHere)
    ? [...new Set(r.hardHere.filter((id): id is string => typeof id === 'string' && id in GYM_EXERCISE_BY_ID))]
    : []
  const hardHereAt = sanitizeTimes(r.hardHereAt)
  const fieldTimes = sanitizeLocationTimes(r.fieldTimes)
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : 'Gym',
    unit: isUnit(r.unit) ? r.unit : 'kg',
    equipment: Array.isArray(r.equipment) ? [...new Set(r.equipment.filter(isEquipment))] : [],
    ...(Object.keys(gear).length ? { gear } : {}),
    ...(hardHere.length ? { hardHere } : {}),
    ...(Object.keys(hardHereAt).length ? { hardHereAt } : {}),
    ...(fieldTimes ? { fieldTimes } : {}),
    updatedAt: isTime(r.updatedAt) ? r.updatedAt : 1,
  }
}

/**
 * A place's own settings, each stamped when it last changed: two tabs that edit different ones (the unit on one,
 * the equipment on the other) both keep their edit. A save from before these stamps has none, and the place's
 * `updatedAt` stands in for every field.
 */
export const LOCATION_FIELDS = ['name', 'unit', 'equipment', 'gear'] as const
type LocationField = (typeof LOCATION_FIELDS)[number]
export type LocationFieldTimes = Partial<Record<LocationField, number>>
/** A place as stored: `GymLocation` plus the per-setting times. */
export type StampedLocation = GymLocation & { fieldTimes?: LocationFieldTimes }

function sanitizeLocationTimes(raw: unknown): LocationFieldTimes | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const out: LocationFieldTimes = {}
  for (const k of LOCATION_FIELDS) {
    const t = (raw as Record<string, unknown>)[k]
    if (isTime(t)) out[k] = t
  }
  return Object.keys(out).length ? out : undefined
}

const locationFieldTime = (l: StampedLocation, k: LocationField) => l.fieldTimes?.[k] ?? l.updatedAt

/** The most one set can hold: an hour for a movement counted in seconds, 1000 reps otherwise. */
export function maxCountFor(exerciseId: string | undefined): number {
  return exerciseId !== undefined && GYM_EXERCISE_BY_ID[exerciseId]?.count === 'seconds' ? 3600 : 1000
}

function sanitizeSet(raw: unknown, exerciseId?: string): GymSet | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const reps = typeof r.reps === 'number' && Number.isFinite(r.reps) ? Math.round(r.reps) : NaN
  if (!(reps >= 0 && reps <= maxCountFor(exerciseId)) || !isTime(r.at)) return null
  const kg = typeof r.kg === 'number' && Number.isFinite(r.kg) && r.kg > 0 && r.kg < 1000 ? r.kg : undefined
  const rpe = typeof r.rpe === 'number' && r.rpe >= 1 && r.rpe <= 10 ? Math.round(r.rpe * 2) / 2 : undefined
  return {
    reps,
    at: r.at,
    ...(kg !== undefined ? { kg } : {}),
    ...(rpe !== undefined ? { rpe } : {}),
    ...(isUnit(r.unit) ? { unit: r.unit } : {}),
    ...(r.warmup === true ? { warmup: true } : {}),
    ...(isTime(r.editedAt) ? { editedAt: r.editedAt } : {}),
  }
}

function sanitizeLog(raw: unknown): GymExerciseLog | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.exerciseId !== 'string' || !(r.exerciseId in GYM_EXERCISE_BY_ID)) return null
  const sets = Array.isArray(r.sets) ? r.sets.map((x) => sanitizeSet(x, r.exerciseId as string)).filter((s): s is GymSet => s !== null) : []
  const range =
    Array.isArray(r.repRange) && r.repRange.length === 2 && r.repRange.every((n) => typeof n === 'number' && n > 0 && n < 100)
      ? ([r.repRange[0], r.repRange[1]] as [number, number])
      : undefined
  return {
    exerciseId: r.exerciseId,
    sets,
    ...(typeof r.swappedFrom === 'string' && r.swappedFrom in GYM_EXERCISE_BY_ID ? { swappedFrom: r.swappedFrom } : {}),
    ...(range ? { repRange: range } : {}),
    ...(typeof r.targetRpe === 'number' && r.targetRpe >= 5 && r.targetRpe <= 10 ? { targetRpe: r.targetRpe } : {}),
    ...(typeof r.note === 'string' && r.note ? { note: r.note.slice(0, 500) } : {}),
  }
}

function sanitizeSession(raw: unknown): GymSession | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id || !isTime(r.startedAt)) return null
  const exercises = Array.isArray(r.exercises)
    ? r.exercises.map(sanitizeLog).filter((l): l is GymExerciseLog => l !== null)
    : []
  return {
    id: r.id,
    locationId: typeof r.locationId === 'string' ? r.locationId : 'home',
    startedAt: r.startedAt,
    endedAt: isTime(r.endedAt) && r.endedAt >= r.startedAt ? r.endedAt : r.startedAt,
    name: typeof r.name === 'string' && r.name ? r.name.slice(0, 80) : 'Gym session',
    exercises,
    ...(typeof r.notes === 'string' && r.notes ? { notes: r.notes.slice(0, 2000) } : {}),
    ...(r.completion === 'full' || r.completion === 'partial' ? { completion: r.completion } : {}),
    ...(isTime(r.updatedAt) ? { updatedAt: r.updatedAt } : {}),
  }
}

/** Anything unreadable is dropped, never guessed; absent stays absent. */
export function sanitizeGym(raw: unknown): GymState | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const r = raw as Record<string, unknown>
  const locations = Array.isArray(r.locations)
    ? r.locations.map(sanitizeLocation).filter((l): l is GymLocation => l !== null)
    : []
  const uniqueLocations = [...new Map(locations.map((l) => [l.id, l])).values()]
  const sessions = Array.isArray(r.sessions)
    ? r.sessions.map(sanitizeSession).filter((s): s is GymSession => s !== null)
    : []
  const uniqueSessions = [...new Map(sessions.map((s) => [s.id, s])).values()].sort((a, b) => a.startedAt - b.startedAt)
  const ratings: Record<string, Rating> = {}
  if (typeof r.ratings === 'object' && r.ratings !== null) {
    for (const [id, v] of Object.entries(r.ratings as Record<string, unknown>)) {
      if (id in GYM_EXERCISE_BY_ID && RATINGS.includes(v as Rating)) ratings[id] = v as Rating
    }
  }
  const favoriteAt: Record<string, string> = {}
  if (typeof r.favoriteAt === 'object' && r.favoriteAt !== null) {
    for (const [id, v] of Object.entries(r.favoriteAt as Record<string, unknown>)) {
      if (id in GYM_EXERCISE_BY_ID && typeof v === 'string' && uniqueLocations.some((l) => l.id === v)) favoriteAt[id] = v
    }
  }
  const ratingAtTime = sanitizeTimes(r.ratingAtTime)
  const favoriteAtTime = sanitizeTimes(r.favoriteAtTime)
  const ids = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))].slice(-MAX_TOMBSTONES) : []
  const deletedSessionIds = ids(r.deletedSessionIds)
  const deletedLocationIds = ids(r.deletedLocationIds)
  const prefs = sanitizePrefs(r.prefs)
  const activities = Array.isArray(r.activities)
    ? [...new Map(r.activities.map(sanitizeActivity).filter((a): a is OutsideActivity => a !== null).map((a) => [a.id, a])).values()].sort(
        (a, b) => a.at - b.at,
      )
    : []
  const deletedActivityIds = ids(r.deletedActivityIds)
  const active =
    typeof r.activeLocationId === 'string' && uniqueLocations.some((l) => l.id === r.activeLocationId)
      ? r.activeLocationId
      : uniqueLocations[0]?.id
  return {
    locations: uniqueLocations,
    ...(active ? { activeLocationId: active } : {}),
    sessions: uniqueSessions,
    ...(deletedSessionIds.length ? { deletedSessionIds } : {}),
    ...(deletedLocationIds.length ? { deletedLocationIds } : {}),
    ratings,
    favoriteAt,
    ...(Object.keys(ratingAtTime).length ? { ratingAtTime } : {}),
    ...(Object.keys(favoriteAtTime).length ? { favoriteAtTime } : {}),
    ...(isTime(r.prefsUpdatedAt) ? { prefsUpdatedAt: r.prefsUpdatedAt } : {}),
    ...(prefs ? { prefs } : {}),
    ...(activities.length ? { activities } : {}),
    ...(deletedActivityIds.length ? { deletedActivityIds } : {}),
  }
}

/** A load this far above the athlete's best for the lift is asked about before it is saved. */
export const IMPLAUSIBLE_LOAD_RATIO = 1.5

/**
 * Is `kg` far above anything logged for this exercise? Returns the athlete's
 * best and, when a slipped decimal point or a unit mix-up would explain it, the
 * load they probably meant. Null when it is plausible or there is no history to
 * compare with (a first load is never doubted). Warm-ups and `exceptSessionId`
 * (the session being corrected) are not counted.
 */
export function doubtedLoad(
  sessions: GymSession[],
  exerciseId: string,
  kg: number,
  exceptSessionId?: string,
): { bestKg: number; probablyKg?: number } | null {
  let best = 0
  for (const s of sessions) {
    if (s.id === exceptSessionId) continue
    for (const log of s.exercises) {
      if (log.exerciseId !== exerciseId) continue
      for (const set of log.sets) if (!set.warmup && set.kg !== undefined && set.kg > best) best = set.kg
    }
  }
  if (!(best > 0) || !(kg > best * IMPLAUSIBLE_LOAD_RATIO)) return null
  const tenth = Math.round((kg / 10) * 2) / 2
  const poundsAsKg = Math.round((kg / 2.2046) * 2) / 2
  const fits = (v: number) => v > 0 && v <= best * IMPLAUSIBLE_LOAD_RATIO
  const probablyKg = fits(tenth) ? tenth : fits(poundsAsKg) ? poundsAsKg : undefined
  return { bestKg: best, ...(probablyKg !== undefined ? { probablyKg } : {}) }
}

/**
 * Two copies of one session: the newer wins as a whole, except that sets
 * corrected on both sides merge set by set, the later edit taking each set.
 */
export function mergeSession(a: GymSession, b: GymSession): GymSession {
  const [older, newer] = sessionStamp(b) > sessionStamp(a) ? [a, b] : [b, a]
  // A tie keeps `a`.
  const shaped =
    older.exercises.length === newer.exercises.length &&
    older.exercises.every((e, i) => e.exerciseId === newer.exercises[i].exerciseId && e.sets.length === newer.exercises[i].sets.length)
  if (!shaped) return newer
  let changed = false
  const exercises = newer.exercises.map((e, i) => ({
    ...e,
    sets: e.sets.map((set, j) => {
      const other = older.exercises[i].sets[j]
      if ((other.editedAt ?? 0) > (set.editedAt ?? 0)) {
        changed = true
        return other
      }
      return set
    }),
  }))
  return changed ? { ...newer, exercises } : newer
}

const sessionStamp = (s: GymSession) => s.updatedAt ?? s.endedAt

/**
 * Two tabs' gym data, converged: union by id, the newer copy of anything
 * edited on both, deletions honoured on both sides, preferences from whichever
 * side changed them last. Returns `local` itself when nothing differs.
 */
export function mergeGym(local: GymState | undefined, incoming: GymState | undefined): GymState | undefined {
  if (!incoming) return local
  if (!local) return incoming
  const deadSessions = [...new Set([...(local.deletedSessionIds ?? []), ...(incoming.deletedSessionIds ?? [])])].slice(-MAX_TOMBSTONES)
  const deadLocations = [...new Set([...(local.deletedLocationIds ?? []), ...(incoming.deletedLocationIds ?? [])])].slice(-MAX_TOMBSTONES)
  const deadS = new Set(deadSessions)
  const deadL = new Set(deadLocations)
  const sessions = new Map<string, GymSession>()
  for (const s of [...local.sessions, ...incoming.sessions]) {
    if (deadS.has(s.id)) continue
    const have = sessions.get(s.id)
    if (!have) sessions.set(s.id, s)
    else sessions.set(s.id, mergeSession(have, s))
  }
  const locations = new Map<string, GymLocation>()
  for (const l of [...local.locations, ...incoming.locations]) {
    if (deadL.has(l.id)) continue
    const have = locations.get(l.id)
    if (!have) locations.set(l.id, l)
    else locations.set(l.id, mergeLocation(have, l))
  }
  let deadLocationIds = deadLocations
  if (locations.size === 0) {
    // Two tabs each deleting a different place must not leave none: the newest survivor stays.
    const all = [...local.locations, ...incoming.locations]
    if (all.length) {
      const keep = all.reduce((best, l) => (l.updatedAt > best.updatedAt ? l : best))
      for (const l of all) if (l.id === keep.id) locations.set(l.id, locations.has(l.id) ? mergeLocation(locations.get(l.id)!, l) : l)
      deadLocationIds = deadLocations.filter((id) => id !== keep.id)
    }
  }
  const prefsStamp =
    local.prefsUpdatedAt === undefined && incoming.prefsUpdatedAt === undefined
      ? undefined
      : Math.max(local.prefsUpdatedAt ?? 0, incoming.prefsUpdatedAt ?? 0)
  const freezeLocal = prefsStamp !== local.prefsUpdatedAt
  const freezeIncoming = prefsStamp !== incoming.prefsUpdatedAt
  const ratings = mergeStamped(
    { vals: local.ratings, at: local.ratingAtTime, fallback: local.prefsUpdatedAt ?? 0, freeze: freezeLocal },
    { vals: incoming.ratings, at: incoming.ratingAtTime, fallback: incoming.prefsUpdatedAt ?? 0, freeze: freezeIncoming, side: 'incoming' },
  )
  const favorites = mergeStamped(
    { vals: local.favoriteAt, at: local.favoriteAtTime, fallback: local.prefsUpdatedAt ?? 0, freeze: freezeLocal },
    { vals: incoming.favoriteAt, at: incoming.favoriteAtTime, fallback: incoming.prefsUpdatedAt ?? 0, freeze: freezeIncoming, side: 'incoming' },
  )
  // A favourite at a place that no longer exists is no favourite.
  for (const [id, loc] of Object.entries(favorites.vals)) if (!locations.has(loc)) delete favorites.vals[id]
  const deadActivities = [...new Set([...(local.deletedActivityIds ?? []), ...(incoming.deletedActivityIds ?? [])])].slice(-MAX_TOMBSTONES)
  const deadA = new Set(deadActivities)
  const activities = new Map<string, OutsideActivity>()
  for (const a of [...(local.activities ?? []), ...(incoming.activities ?? [])]) {
    if (deadA.has(a.id)) continue
    const have = activities.get(a.id)
    if (!have || a.updatedAt > have.updatedAt) activities.set(a.id, a)
  }
  const prefs = mergePrefs(local.prefs, incoming.prefs)
  const merged: GymState = {
    locations: [...locations.values()],
    activeLocationId:
      local.activeLocationId && locations.has(local.activeLocationId)
        ? local.activeLocationId
        : incoming.activeLocationId && locations.has(incoming.activeLocationId)
          ? incoming.activeLocationId
          : [...locations.keys()][0],
    sessions: [...sessions.values()].sort((a, b) => a.startedAt - b.startedAt),
    ...(deadSessions.length ? { deletedSessionIds: deadSessions } : {}),
    ...(deadLocationIds.length ? { deletedLocationIds: deadLocationIds } : {}),
    ratings: ratings.vals,
    favoriteAt: favorites.vals,
    ...(Object.keys(ratings.at).length ? { ratingAtTime: ratings.at } : {}),
    ...(Object.keys(favorites.at).length ? { favoriteAtTime: favorites.at } : {}),
    ...(prefs ? { prefs } : {}),
    ...(activities.size ? { activities: [...activities.values()].sort((a, b) => a.at - b.at) } : {}),
    ...(deadActivities.length ? { deletedActivityIds: deadActivities } : {}),
    ...(prefsStamp !== undefined ? { prefsUpdatedAt: prefsStamp } : {}),
  }
  return stableJson(merged) === stableJson(local) ? local : merged
}

interface Side<V> {
  vals: Record<string, V>
  at: Record<string, number> | undefined
  /** The time a mark with no time of its own is read as (older saves). */
  fallback: number
  /** Write a time for a surviving mark that had none, because `fallback` is about to move. */
  freeze: boolean
  side?: 'incoming'
}

/**
 * Two keyed maps merged key by key, each key by its own time: the later set or
 * removal wins, a tie keeps the local side. A removal is a time with no value,
 * so it survives the merge. Marks from a save with no times read as `fallback`,
 * and a key nobody has ever stamped or held loses to anything.
 */
function mergeStamped<V>(a: Side<V>, b: Side<V>): { vals: Record<string, V>; at: Record<string, number> } {
  const vals: Record<string, V> = {}
  const at: Record<string, number> = {}
  const keys = new Set([...Object.keys(a.vals), ...Object.keys(a.at ?? {}), ...Object.keys(b.vals), ...Object.keys(b.at ?? {})])
  const stampOf = (s: Side<V>, k: string) => s.at?.[k] ?? (k in s.vals ? s.fallback : -1)
  for (const k of keys) {
    const sa = stampOf(a, k)
    const sb = stampOf(b, k)
    const win = sb > sa ? b : a
    const stamp = Math.max(sa, sb)
    if (k in win.vals) vals[k] = win.vals[k]
    if (stamp < 0) continue
    const explicit = win.at?.[k] !== undefined
    if (explicit || win.freeze || win.side === 'incoming') at[k] = stamp
  }
  return { vals, at }
}

/**
 * Two copies of a place, converged setting by setting: each of name, unit, equipment and gear comes from the side
 * that changed it last (a tie keeps `a`, the local one), and the hard-here marks merge mark by mark.
 */
function mergeLocation(a: StampedLocation, b: StampedLocation): GymLocation {
  const list = (l: GymLocation) => Object.fromEntries((l.hardHere ?? []).map((id) => [id, true as const]))
  const m = mergeStamped(
    { vals: list(a), at: a.hardHereAt, fallback: a.updatedAt, freeze: false },
    { vals: list(b), at: b.hardHereAt, fallback: b.updatedAt, freeze: false, side: 'incoming' },
  )
  const hardHere = Object.keys(m.vals)
  const out: Record<string, unknown> = { id: a.id }
  const times: LocationFieldTimes = {}
  for (const k of LOCATION_FIELDS) {
    const from = locationFieldTime(b, k) > locationFieldTime(a, k) ? b : a
    if (from[k] !== undefined) out[k] = from[k]
    times[k] = locationFieldTime(from, k)
  }
  const stamped = Boolean(a.fieldTimes || b.fieldTimes)
  return {
    ...(out as unknown as GymLocation),
    ...(hardHere.length ? { hardHere } : {}),
    ...(Object.keys(m.at).length ? { hardHereAt: m.at } : {}),
    ...(stamped ? { fieldTimes: times } : {}),
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  }
}

/** JSON with keys sorted, so two equal states compare equal whatever order built them. */
function stableJson(v: unknown): string {
  return JSON.stringify(v, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  )
}

export type GymOp =
  | { op: 'init'; gym: GymState }
  | { op: 'saveSession'; session: GymSession }
  | { op: 'deleteSession'; id: string }
  /** Fix one logged set. `kg: null` makes it a bodyweight set. Records re-derive by replay. */
  | { op: 'correctSet'; sessionId: string; exerciseIndex: number; setIndex: number; kg?: number | null; reps?: number }
  | { op: 'saveLocation'; location: GymLocation }
  | { op: 'deleteLocation'; id: string }
  | { op: 'setActiveLocation'; id: string }
  | { op: 'rate'; exerciseId: string; rating: Rating | null }
  | { op: 'setFavorite'; exerciseId: string; locationId: string | null }
  | { op: 'toggleHardHere'; locationId: string; exerciseId: string }
  | { op: 'setPrefs'; prefs: Omit<TrainingPrefs, 'updatedAt'> }
  | { op: 'logActivity'; activity: Omit<OutsideActivity, 'updatedAt'> }
  | { op: 'deleteActivity'; id: string }

/** The gym reducer. Pure; `now` stamps what it changes. */
export function reduceGym(gym: GymState | undefined, action: GymOp, now = Date.now()): GymState | undefined {
  if (action.op === 'init') return gym ?? action.gym
  if (!gym) return gym
  switch (action.op) {
    case 'saveSession': {
      const session = { ...action.session, updatedAt: now }
      const rest = gym.sessions.filter((s) => s.id !== session.id)
      return { ...gym, sessions: [...rest, session].sort((a, b) => a.startedAt - b.startedAt) }
    }
    case 'deleteSession':
      return {
        ...gym,
        sessions: gym.sessions.filter((s) => s.id !== action.id),
        deletedSessionIds: [...(gym.deletedSessionIds ?? []), action.id].slice(-MAX_TOMBSTONES),
      }
    case 'correctSet': {
      const session = gym.sessions.find((s) => s.id === action.sessionId)
      const log = session?.exercises[action.exerciseIndex]
      const set = log?.sets[action.setIndex]
      if (!session || !log || !set) return gym
      const fixed: GymSet = { ...set, editedAt: now }
      if (action.kg === null) delete fixed.kg
      else if (action.kg !== undefined) {
        if (!(action.kg > 0 && action.kg < 1000)) return gym
        fixed.kg = action.kg
      }
      if (action.reps !== undefined) {
        if (!(Number.isInteger(action.reps) && action.reps >= 0 && action.reps <= maxCountFor(log.exerciseId))) return gym
        fixed.reps = action.reps
      }
      const exercises = session.exercises.map((e, i) =>
        i === action.exerciseIndex ? { ...e, sets: e.sets.map((x, j) => (j === action.setIndex ? fixed : x)) } : e,
      )
      return { ...gym, sessions: gym.sessions.map((s) => (s.id === session.id ? { ...session, exercises, updatedAt: now } : s)) }
    }
    case 'saveLocation': {
      const before = gym.locations.find((l) => l.id === action.location.id) as StampedLocation | undefined
      // Each setting is stamped when this save changed it; the rest keep their own time.
      const fieldTimes: LocationFieldTimes = {}
      for (const k of LOCATION_FIELDS) {
        fieldTimes[k] = !before || stableJson(before[k]) !== stableJson(action.location[k]) ? now : locationFieldTime(before, k)
      }
      const location: StampedLocation = { ...action.location, fieldTimes, updatedAt: now }
      const exists = Boolean(before)
      return {
        ...gym,
        locations: exists ? gym.locations.map((l) => (l.id === location.id ? location : l)) : [...gym.locations, location],
        activeLocationId: gym.activeLocationId ?? location.id,
      }
    }
    case 'deleteLocation': {
      if (gym.locations.length <= 1) return gym
      const locations = gym.locations.filter((l) => l.id !== action.id)
      const favoriteAt = Object.fromEntries(Object.entries(gym.favoriteAt).filter(([, loc]) => loc !== action.id))
      const favoriteAtTime = { ...gym.favoriteAtTime }
      for (const id of Object.keys(gym.favoriteAt)) if (!(id in favoriteAt)) favoriteAtTime[id] = now
      return {
        ...gym,
        locations,
        activeLocationId: gym.activeLocationId === action.id ? locations[0]?.id : gym.activeLocationId,
        deletedLocationIds: [...(gym.deletedLocationIds ?? []), action.id].slice(-MAX_TOMBSTONES),
        favoriteAt,
        favoriteAtTime,
        prefsUpdatedAt: now,
      }
    }
    case 'setActiveLocation':
      return gym.locations.some((l) => l.id === action.id) ? { ...gym, activeLocationId: action.id } : gym
    case 'rate': {
      const ratings = { ...gym.ratings }
      if (action.rating) ratings[action.exerciseId] = action.rating
      else delete ratings[action.exerciseId]
      return { ...gym, ratings, ratingAtTime: { ...gym.ratingAtTime, [action.exerciseId]: now }, prefsUpdatedAt: now }
    }
    case 'setFavorite': {
      const favoriteAt = { ...gym.favoriteAt }
      if (action.locationId) favoriteAt[action.exerciseId] = action.locationId
      else delete favoriteAt[action.exerciseId]
      return { ...gym, favoriteAt, favoriteAtTime: { ...gym.favoriteAtTime, [action.exerciseId]: now }, prefsUpdatedAt: now }
    }
    case 'setPrefs': {
      // Stamp only the fields this edit changed; the rest keep their own times.
      const prev = gym.prefs
      const next = action.prefs as unknown as Record<string, unknown>
      const before = (prev ?? {}) as unknown as Record<string, unknown>
      const fieldTimes: Record<string, number> = {}
      for (const k of PREF_FIELDS) {
        fieldTimes[k] = !prev || stableJson(before[k]) !== stableJson(next[k]) ? now : prefFieldTime(prev, k)
      }
      return { ...gym, prefs: { ...action.prefs, fieldTimes, updatedAt: now } }
    }
    case 'logActivity': {
      const activity = { ...action.activity, updatedAt: now }
      const rest = (gym.activities ?? []).filter((a) => a.id !== activity.id)
      return { ...gym, activities: [...rest, activity].sort((a, b) => a.at - b.at) }
    }
    case 'deleteActivity':
      return {
        ...gym,
        activities: (gym.activities ?? []).filter((a) => a.id !== action.id),
        deletedActivityIds: [...(gym.deletedActivityIds ?? []), action.id].slice(-MAX_TOMBSTONES),
      }
    case 'toggleHardHere': {
      return {
        ...gym,
        locations: gym.locations.map((l) => {
          if (l.id !== action.locationId) return l
          const hard = new Set(l.hardHere ?? [])
          if (hard.has(action.exerciseId)) hard.delete(action.exerciseId)
          else hard.add(action.exerciseId)
          // The place's own stamp stays put: marks carry their own times, and bumping it would let this
          // toggle outvote an equipment edit made on another tab.
          const { hardHere: _old, ...rest } = l
          void _old
          return { ...rest, ...(hard.size ? { hardHere: [...hard] } : {}), hardHereAt: { ...l.hardHereAt, [action.exerciseId]: now }, updatedAt: l.updatedAt }
        }),
      }
    }
  }
}

/**
 * One tap on a muscle: normal → priority → off → normal, advanced from the
 * state `prefs` holds *now* (never a render's copy of it), with the other two
 * lists cleaned so a muscle is in at most one, once.
 */
export function cycleMuscleState(prefs: TrainingPrefs, m: Muscle): TrainingPrefs {
  const state = prefs.musclesOff.includes(m) ? 'off' : prefs.musclesPriority.includes(m) ? 'priority' : 'normal'
  const to = ({ normal: 'priority', priority: 'off', off: 'normal' } as const)[state]
  const without = (list: Muscle[]) => list.filter((x) => x !== m)
  return {
    ...prefs,
    musclesOff: to === 'off' ? [...without(prefs.musclesOff), m] : without(prefs.musclesOff),
    musclesPriority: to === 'priority' ? [...without(prefs.musclesPriority), m] : without(prefs.musclesPriority),
  }
}
