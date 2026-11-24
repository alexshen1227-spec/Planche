import { addDays, dayKey } from '../time'
import type { GymSession, GymSet } from './types'
import { portableReps, unfinishedLiftSets } from './progression'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'

export const UNASSISTED_LIFTS = ['push-up', 'pull-up'] as const
export type UnassistedLift = (typeof UNASSISTED_LIFTS)[number]

export const LEG_VARIATIONS: Partial<Record<string, string[]>> = {
  'bodyweight-squat': ['bulgarian-split-squat', 'split-squat'],
  'glute-bridge': ['single-leg-hip-thrust', 'single-leg-glute-bridge'],
  'floor-calf-raise': ['single-leg-calf-raise', 'single-leg-floor-calf-raise'],
}

interface LegPractice {
  baseReps?: number
  working?: { id: string; reps: number; sets: number }
}

/** Floor work travels with the athlete. A step, bench or added load keeps its local setup. */
export function legPracticeAt(sessions: GymSession[], locationId: string | undefined, now: number) {
  const result = new Map<string, LegPractice>()
  const from = addDays(now, -28)
  for (const visit of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    if (visit.startedAt < from || visit.startedAt >= now) continue
    for (const [base, variants] of Object.entries(LEG_VARIATIONS)) {
      const relevant = visit.exercises.filter((log) => (log.exerciseId === base || variants?.includes(log.exerciseId)) &&
        log.sets.some((s) => !s.warmup && s.at <= now) && (visit.locationId === locationId ||
          (portableReps(GYM_EXERCISE_BY_ID[log.exerciseId]) && !log.sets.some((s) => !s.warmup && s.kg))))
      if (!relevant.length) continue
      const evidence: LegPractice = {}
      for (const log of relevant) {
        const sets = log.sets.filter((s) => !s.warmup && s.at <= now)
        if (unfinishedLiftSets(visit, log.exerciseId) || sets.some((s) => s.kg || s.reps <= 0 || s.rpe === undefined || s.rpe > (log.targetRpe ?? 8))) continue
        const reps = Math.min(...sets.map((s) => s.reps))
        if (log.exerciseId === base) {
          if (sets.length >= 2 && reps >= (log.repRange?.[1] ?? 15)) evidence.baseReps = reps
        } else if (reps >= 3) {
          evidence.working = { id: log.exerciseId, reps, sets: sets.length }
        }
      }
      result.set(base, evidence)
    }
  }
  return result
}

export const DRAGON_FLAG_STEPS = ['tuck-dragon-flag-lower', 'one-leg-dragon-flag-lower', 'dragon-flag']

export function easierDragonFlag(id: string): string | undefined {
  const level = DRAGON_FLAG_STEPS.indexOf(id)
  return level < 0 ? undefined : level === 0 ? 'reverse-crunch' : DRAGON_FLAG_STEPS[level - 1]
}

export function preparesFor(exerciseId: string): UnassistedLift | undefined {
  if (exerciseId === 'incline-push-up' || exerciseId === 'kneeling-push-up') return 'push-up'
  if (exerciseId === 'band-assisted-pull-up' || exerciseId === 'negative-pull-up') return 'pull-up'
  return undefined
}

export interface UnassistedWork {
  reps: number[]
  manageable: boolean
  hard: boolean
}

interface LiftEvidence {
  easyDays: Map<string, number>
  clearPushupDay?: string
  latest?: { day: string; at: number; sets: GymSet[]; building: boolean }
}

/** Actual work on the harder movement stays separate from its easier variations. */
export function unassistedSteps(sessions: GymSession[], known: { pushups: number; pullups: number }, now: number, adult = false) {
  const recent = addDays(now, -28)
  const from = addDays(now, -84)
  const evidence: Record<UnassistedLift, LiftEvidence> = { 'push-up': { easyDays: new Map() }, 'pull-up': { easyDays: new Map() } }
  for (const session of sessions) {
    if (session.endedAt < from || session.startedAt > now) continue
    for (const row of session.exercises) {
      const prep = preparesFor(row.exerciseId)
      const lift = row.exerciseId === 'push-up' || row.exerciseId === 'pull-up' ? row.exerciseId : undefined
      if (!prep && !lift) continue
      const sets = row.sets.filter((s) => !s.warmup && s.at >= from && s.at <= now)
      if (prep) {
        if (unfinishedLiftSets(session, row.exerciseId)) continue
        // Two sets on two days, or an adult's very easy pair of push-up sets far
        // beyond the assigned range. Either earns one optional check.
        const minimum = prep === 'push-up' ? Math.max(8, row.repRange?.[1] ?? 12) : row.exerciseId === 'negative-pull-up' ? 4 : Math.min(8, row.repRange?.[1] ?? 8)
        const byDate = new Map<string, GymSet[]>()
        for (const set of sets) if (set.at >= recent) {
          const day = dayKey(set.at)
          if (!byDate.has(day)) byDate.set(day, [])
          byDate.get(day)!.push(set)
        }
        for (const [day, work] of byDate) if (work.length >= 2 && work.every((s) => s.reps >= minimum && s.rpe !== undefined && s.rpe <= (prep === 'push-up' ? 7 : 8))) {
          evidence[prep].easyDays.set(day, Math.max(evidence[prep].easyDays.get(day) ?? 0, ...work.map((s) => s.at)))
          if (adult && prep === 'push-up' && day < dayKey(now) && work.every((s) => s.reps >= Math.max(16, minimum * 2) && s.rpe! <= 6)) {
            if (!evidence[prep].clearPushupDay || day > evidence[prep].clearPushupDay!) evidence[prep].clearPushupDay = day
          }
        }
      } else if (lift) {
        const track = evidence[lift]
        const building = Boolean(row.repRange && row.repRange[0] === row.repRange[1] && row.repRange[0] <= 8 &&
          !(row.swappedFrom && preparesFor(row.swappedFrom) === lift))
        for (const set of sets) {
          if ((set.kg ?? 0) > 0) continue
          const day = dayKey(set.at)
          if (!track.latest || day > track.latest.day) track.latest = { day, at: set.at, sets: [], building: false }
          if (track.latest.day === day) {
            track.latest.at = Math.max(track.latest.at, set.at)
            track.latest.sets.push(set)
            track.latest.building ||= building
          }
        }
      }
    }
  }
  const trials: Partial<Record<UnassistedLift, number>> = {}
  const practice: Partial<Record<UnassistedLift, UnassistedWork>> = {}
  for (const lift of UNASSISTED_LIFTS) {
    const { easyDays, latest } = evidence[lift]
    const best = Math.max(0, ...(latest?.sets.map((s) => s.reps) ?? []))
    if (latest && best > 0 && (best >= 4 || latest.building)) {
      practice[lift] = { reps: latest.sets.map((s) => s.reps),
        manageable: latest.at >= recent && latest.sets.every((s) => s.reps > 0 && s.rpe !== undefined && s.rpe <= 7),
        hard: latest.sets.some((s) => s.reps === 0 || (s.rpe ?? 0) >= 9) }
      continue
    }
    if ((lift === 'push-up' ? known.pushups : known.pullups) >= 5 || latest?.day === dayKey(now)) continue
    const afterMiss = latest && best === 0 ? latest.at : -Infinity
    const ready = (!latest && Boolean(evidence[lift].clearPushupDay)) ||
      [...easyDays].filter(([day, at]) => day !== dayKey(now) && at > afterMiss && (best > 0 || day !== latest?.day)).length >= 2
    if (ready) {
      const last = latest && latest.at >= recent ? latest.sets.reduce((a, b) => a.at > b.at ? a : b) : undefined
      trials[lift] = Math.max(1, Math.min(4, (last?.reps ?? 0) + (last?.rpe !== undefined && last.rpe <= 7 ? 1 : 0)))
    }
  }
  return { trials, practice }
}

/** Split a first successful set across shorter sets, then earn another set or another rep. */
export function unassistedDose(work: UnassistedWork, slots: number, minimum: number) {
  const reps = work.reps.filter((n) => n > 0).sort((a, b) => b - a)
  if (!reps.length || slots < 1) return undefined
  const count = Math.min(slots, reps.length)
  const repeated = reps[count - 1]
  if (count === slots && repeated >= minimum) return undefined
  if (reps.length === 1) {
    const sets = Math.min(2, slots)
    return { sets, reps: Math.max(1, Math.floor(reps[0] / sets)) }
  }
  if (count < slots && repeated >= 4 && work.manageable) {
    return { sets: count + 1, reps: Math.max(1, Math.floor((count * repeated + 1) / (count + 1))) }
  }
  return { sets: count, reps: Math.max(1, Math.min(minimum, repeated + (work.manageable ? 1 : work.hard ? -1 : 0))) }
}
