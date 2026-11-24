import { GYM_EXERCISE_BY_ID, type GymExercise } from '../../data/gym/exercises'
import { estimateOneRepMax, isUnloadedSet } from './progression'
import type { GymSession, GymSet } from './types'

export interface LiftSeries {
  key: string
  id: string
  placeId?: string
  kind: 'estimate' | 'assistance' | 'reps' | 'seconds' | 'contacts' | 'distance'
  loadKg?: number
  minReps?: number
  points: { at: number; value: number }[]
}

interface LiftGroup {
  ex: GymExercise
  placeId?: string
  rows: { at: number; sets: GymSet[] }[]
}

/** One point per workout. Machines stay at their own gym and rep or hold records use the same load. */
export function liftSeries(sessions: GymSession[], exerciseId?: string): LiftSeries[] {
  const groups = new Map<string, LiftGroup>()
  for (const s of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    const working = new Map<string, GymSet[]>()
    for (const log of s.exercises) {
      if (exerciseId && log.exerciseId !== exerciseId) continue
      const ex = GYM_EXERCISE_BY_ID[log.exerciseId]
      if (!ex) continue
      const sets = log.sets.filter((x) => !x.warmup && x.reps > 0 && !isUnloadedSet(ex, x))
      if (sets.length) working.set(ex.id, [...(working.get(ex.id) ?? []), ...sets])
    }
    for (const [id, sets] of working) {
      const ex = GYM_EXERCISE_BY_ID[id]
      const placeId = ex.load === 'machine' || ex.load === 'cable' ? s.locationId : undefined
      const key = JSON.stringify([id, placeId])
      const group: LiftGroup = groups.get(key) ?? { ex, placeId, rows: [] }
      group.rows.push({ at: s.startedAt, sets })
      groups.set(key, group)
    }
  }
  const out: LiftSeries[] = []
  for (const [key, { ex, placeId, rows }] of groups) {
    const base = { id: ex.id, placeId }
    if (ex.assisted) {
      // Compare help at a rep count this athlete has actually reached in every session.
      const minReps = Math.min(5, ...rows.map(({ sets }) => Math.max(...sets.map((x) => x.reps))))
      const points = rows.map(({ at, sets }) => ({ at, value: Math.min(...sets.filter((x) => x.reps >= minReps).map((x) => x.kg ?? 0)) }))
      out.push({ ...base, key, kind: 'assistance', minReps, points })
      continue
    }
    const estimates = rows.flatMap(({ at, sets }) => {
      const value = Math.max(0, ...sets.map((set) => estimateOneRepMax(set, ex.id) ?? 0))
      return value > 0 ? [{ at, value }] : []
    })
    if (estimates.length) out.push({ ...base, key, kind: 'estimate', points: estimates })
    if (estimates.length >= 2) continue

    const kind = ex.count === 'seconds' ? 'seconds' : ex.count === 'contacts' ? 'contacts' : ex.distanceM ? 'distance' : 'reps'
    const loads = new Map<number, LiftSeries>()
    for (const { at, sets } of rows) {
      const byLoad = new Map<number, number>()
      for (const set of sets) {
        // Match stored kg across kg/lb entry to within a gram, preserving fractional plates.
        const kg = Math.round((set.kg ?? 0) * 1000) / 1000
        const prev = byLoad.get(kg) ?? 0
        const value = kind === 'distance' ? prev + set.reps * ex.distanceM! : kind === 'contacts' ? prev + set.reps : Math.max(prev, set.reps)
        byLoad.set(kg, value)
      }
      for (const [loadKg, value] of byLoad) {
        const series: LiftSeries = loads.get(loadKg) ?? { ...base, key: `${key}/${loadKg}`, kind, loadKg, points: [] }
        series.points.push({ at, value })
        loads.set(loadKg, series)
      }
    }
    out.push(...loads.values())
  }
  return out.sort((a, b) => b.points.length - a.points.length || b.points[b.points.length - 1].at - a.points[a.points.length - 1].at)
}
