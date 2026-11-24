import { addDays, dayKey } from '../time'
import type { GymSession, GymSet } from './types'

export const UNASSISTED_LIFTS = ['push-up', 'pull-up'] as const
export type UnassistedLift = (typeof UNASSISTED_LIFTS)[number]

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
  latest?: { day: string; at: number; sets: GymSet[]; building: boolean }
}

/** Actual work on the harder movement stays separate from its easier variations. */
export function unassistedSteps(sessions: GymSession[], known: { pushups: number; pullups: number }, now: number) {
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
        // Two sets on each of two different days. A band does not establish an
        // equivalent bodyweight load. Success only earns an optional check.
        const minimum = prep === 'push-up' ? Math.max(8, row.repRange?.[1] ?? 12) : row.exerciseId === 'negative-pull-up' ? 4 : Math.min(8, row.repRange?.[1] ?? 8)
        const byDate = new Map<string, GymSet[]>()
        for (const set of sets) if (set.at >= recent) {
          const day = dayKey(set.at)
          if (!byDate.has(day)) byDate.set(day, [])
          byDate.get(day)!.push(set)
        }
        for (const [day, work] of byDate) if (work.length >= 2 && work.every((s) => s.reps >= minimum && s.rpe !== undefined && s.rpe <= (prep === 'push-up' ? 7 : 8))) {
          evidence[prep].easyDays.set(day, Math.max(evidence[prep].easyDays.get(day) ?? 0, ...work.map((s) => s.at)))
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
    const ready = [...easyDays].filter(([day, at]) => day !== dayKey(now) && at > afterMiss && (best > 0 || day !== latest?.day)).length >= 2
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
