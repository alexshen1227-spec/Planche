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
    updatedAt: isTime(r.updatedAt) ? r.updatedAt : 1,
  }
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
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : 'Gym',
    unit: isUnit(r.unit) ? r.unit : 'kg',
    equipment: Array.isArray(r.equipment) ? [...new Set(r.equipment.filter(isEquipment))] : [],
    ...(Object.keys(gear).length ? { gear } : {}),
    ...(hardHere.length ? { hardHere } : {}),
    updatedAt: isTime(r.updatedAt) ? r.updatedAt : 1,
  }
}

function sanitizeSet(raw: unknown): GymSet | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const reps = typeof r.reps === 'number' && Number.isFinite(r.reps) ? Math.round(r.reps) : NaN
  if (!(reps >= 0 && reps <= 200) || !isTime(r.at)) return null
  const kg = typeof r.kg === 'number' && Number.isFinite(r.kg) && r.kg > 0 && r.kg < 1000 ? r.kg : undefined
  const rpe = typeof r.rpe === 'number' && r.rpe >= 1 && r.rpe <= 10 ? Math.round(r.rpe * 2) / 2 : undefined
  return {
    reps,
    at: r.at,
    ...(kg !== undefined ? { kg } : {}),
    ...(rpe !== undefined ? { rpe } : {}),
    ...(isUnit(r.unit) ? { unit: r.unit } : {}),
    ...(r.warmup === true ? { warmup: true } : {}),
  }
}

function sanitizeLog(raw: unknown): GymExerciseLog | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.exerciseId !== 'string' || !(r.exerciseId in GYM_EXERCISE_BY_ID)) return null
  const sets = Array.isArray(r.sets) ? r.sets.map(sanitizeSet).filter((s): s is GymSet => s !== null) : []
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
    ...(isTime(r.prefsUpdatedAt) ? { prefsUpdatedAt: r.prefsUpdatedAt } : {}),
    ...(prefs ? { prefs } : {}),
    ...(activities.length ? { activities } : {}),
    ...(deletedActivityIds.length ? { deletedActivityIds } : {}),
  }
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
    if (!have || sessionStamp(s) > sessionStamp(have)) sessions.set(s.id, s)
  }
  const locations = new Map<string, GymLocation>()
  for (const l of [...local.locations, ...incoming.locations]) {
    if (deadL.has(l.id)) continue
    const have = locations.get(l.id)
    if (!have || l.updatedAt > have.updatedAt) locations.set(l.id, l)
  }
  const prefsFromIncoming = (incoming.prefsUpdatedAt ?? 0) > (local.prefsUpdatedAt ?? 0)
  const deadActivities = [...new Set([...(local.deletedActivityIds ?? []), ...(incoming.deletedActivityIds ?? [])])].slice(-MAX_TOMBSTONES)
  const deadA = new Set(deadActivities)
  const activities = new Map<string, OutsideActivity>()
  for (const a of [...(local.activities ?? []), ...(incoming.activities ?? [])]) {
    if (deadA.has(a.id)) continue
    const have = activities.get(a.id)
    if (!have || a.updatedAt > have.updatedAt) activities.set(a.id, a)
  }
  const prefs =
    (incoming.prefs?.updatedAt ?? 0) > (local.prefs?.updatedAt ?? 0) ? incoming.prefs : local.prefs
  const merged: GymState = {
    locations: [...locations.values()],
    activeLocationId: local.activeLocationId && locations.has(local.activeLocationId) ? local.activeLocationId : [...locations.keys()][0],
    sessions: [...sessions.values()].sort((a, b) => a.startedAt - b.startedAt),
    ...(deadSessions.length ? { deletedSessionIds: deadSessions } : {}),
    ...(deadLocations.length ? { deletedLocationIds: deadLocations } : {}),
    ratings: prefsFromIncoming ? incoming.ratings : local.ratings,
    favoriteAt: prefsFromIncoming ? incoming.favoriteAt : local.favoriteAt,
    ...(prefs ? { prefs } : {}),
    ...(activities.size ? { activities: [...activities.values()].sort((a, b) => a.at - b.at) } : {}),
    ...(deadActivities.length ? { deletedActivityIds: deadActivities } : {}),
    ...((prefsFromIncoming ? incoming.prefsUpdatedAt : local.prefsUpdatedAt) !== undefined
      ? { prefsUpdatedAt: prefsFromIncoming ? incoming.prefsUpdatedAt : local.prefsUpdatedAt }
      : {}),
  }
  return stableJson(merged) === stableJson(local) ? local : merged
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
    case 'saveLocation': {
      const location = { ...action.location, updatedAt: now }
      const exists = gym.locations.some((l) => l.id === location.id)
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
      return {
        ...gym,
        locations,
        activeLocationId: gym.activeLocationId === action.id ? locations[0]?.id : gym.activeLocationId,
        deletedLocationIds: [...(gym.deletedLocationIds ?? []), action.id].slice(-MAX_TOMBSTONES),
        favoriteAt,
        prefsUpdatedAt: now,
      }
    }
    case 'setActiveLocation':
      return gym.locations.some((l) => l.id === action.id) ? { ...gym, activeLocationId: action.id } : gym
    case 'rate': {
      const ratings = { ...gym.ratings }
      if (action.rating) ratings[action.exerciseId] = action.rating
      else delete ratings[action.exerciseId]
      return { ...gym, ratings, prefsUpdatedAt: now }
    }
    case 'setFavorite': {
      const favoriteAt = { ...gym.favoriteAt }
      if (action.locationId) favoriteAt[action.exerciseId] = action.locationId
      else delete favoriteAt[action.exerciseId]
      return { ...gym, favoriteAt, prefsUpdatedAt: now }
    }
    case 'setPrefs':
      return { ...gym, prefs: { ...action.prefs, updatedAt: now } }
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
          return { ...l, hardHere: [...hard], updatedAt: now }
        }),
      }
    }
  }
}
