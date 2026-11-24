import type { AppState } from '../../types'
import { EXERCISE_BY_ID } from '../../data/exercises'
import { STEP_BY_ID } from '../../data/progressions'
import { addDays, dayKey, weekStart } from '../time'
import { unassistedSteps, type UnassistedLift, type UnassistedWork } from './bodyweightSteps'
import { unfinishedLiftSets } from './progression'
import { conservative } from './draft'

type Base = 'pushups' | 'pullups' | 'dips'
export type BodyweightCapacity = {
  base: Partial<Record<Base, number>>
  practiced: Map<string, number>
  introductory?: boolean
  introductoryVisitsLeft?: number
  introductoryEffort?: boolean
  buildUpSetLimit?: number
  tryPullup?: boolean
  /** An optional single floor set replaces one easier set. It is never a full floor prescription. */
  floorPushupTrial?: number
  pullupTrial?: number
  unassistedWork?: Partial<Record<UnassistedLift, UnassistedWork>>
}

// These are starting gates for automated picks. An athlete can always add a movement manually.
const gates = new Map<string, { base: Base; reps: number }>()
function gate(base: Base, reps: number, ids: string[]) {
  for (const id of ids) gates.set(id, { base, reps })
}
gate('pushups', 5, ['push-up'])
gate('pushups', 8, ['diamond-push-up', 'pike-push-up', 'ring-push-up', 'decline-push-up'])
gate('pushups', 12, ['weighted-push-up', 'band-resisted-push-up', 'pseudo-planche-push-up', 'archer-push-up', 'explosive-push-up', 'clap-push-up', 'elevated-pike-push-up', 'ring-fly'])
gate('pullups', 5, ['pull-up', 'chin-up', 'neutral-pull-up'])
gate('pullups', 10, ['weighted-pull-up', 'wide-pull-up', 'l-sit-pull-up'])
gate('pullups', 12, ['archer-pull-up', 'typewriter-pull-up', 'ice-cream-maker'])
gate('dips', 5, ['dip', 'straight-bar-dip'])
gate('dips', 12, ['weighted-dip', 'ring-dip'])

const baseOf: Record<string, Base> = { pushup: 'pushups', 'push-up': 'pushups', pullup: 'pullups', 'pull-up': 'pullups', 'chin-up': 'pullups', dip: 'dips' }
const specificPrep: Record<string, { id: string; reps: number }> = {
  'wall-hspu': { id: 'elevated-pike-push-up', reps: 8 },
  'elevated-pike-push-up': { id: 'pike-push-up', reps: 8 },
}
const skillTwins: Record<string, string> = { 'pike-pushup': 'pike-push-up', 'elevated-pike-pushup': 'elevated-pike-push-up', 'wall-hspu': 'wall-hspu' }

/** The most recent direct report or working session for each movement. Zero reps is evidence too. */
export function bodyweightCapacity(state: AppState, now: number): BodyweightCapacity {
  const from = now - 84 * 86_400_000
  const evidence = new Map<string, { at: number; reps: number }>()
  let assistedTrial: { at: number; ready: boolean } | undefined
  const record = (id: string, at: number, reps: number) => {
    if (at < from || at > now || !Number.isFinite(reps)) return
    const was = evidence.get(id)
    if (!was || at > was.at || (at === was.at && reps > was.reps)) evidence.set(id, { at, reps })
  }
  const tracks = Object.values(state.tracks ?? {})
  const assessments = [state.assessment, ...tracks.map((t) => t.assessment)]
  let skillDose = 0
  for (const a of assessments) {
    if (!a) continue
    for (const key of ['pushups', 'pullups'] as const) record(key, a.at, a.answers[key])
  }
  for (const s of state.sessions) {
    if (s.startedAt < from || s.startedAt > now) continue
    const working = s.sets.filter((set) => set.section !== 'warmup' && set.section !== 'cooldown' && set.value > 0 &&
      set.value >= set.target / 2 && !set.light && (set.rpe ?? s.rpe ?? 7) <= 8 && set.at <= now)
    const strongSet = working.some((set) => set.kind === 'reps' &&
      ((baseOf[set.exerciseId] === 'pushups' && set.value >= 10) || (baseOf[set.exerciseId] === 'pullups' && set.value >= 5)))
    if (strongSet) {
      const rounds = working.reduce((n, set) => n + (set.side && EXERCISE_BY_ID[set.exerciseId]?.perSide ? 0.5 : 1), 0)
      if (rounds >= 8) skillDose = Math.max(skillDose, Math.floor(rounds))
    }
    for (const x of s.sets) {
      if (x.kind !== 'reps' || x.section === 'warmup' || x.section === 'cooldown') continue
      const base = baseOf[x.exerciseId]
      if (base) record(base, s.startedAt, x.value)
      const twin = skillTwins[x.exerciseId]
      if (twin) record(twin, s.startedAt, x.value)
    }
  }
  for (const s of state.gym?.sessions ?? []) {
    if (s.startedAt < from || s.startedAt > now) continue
    for (const log of s.exercises) {
      if (log.exerciseId === 'assisted-pull-up' && (!assistedTrial || s.startedAt >= assistedTrial.at)) {
        const sets = log.sets.filter((x) => !x.warmup && x.reps > 0)
        const top = log.repRange?.[1] ?? 10
        if (sets.length) assistedTrial = {
          at: s.startedAt,
          ready: !unfinishedLiftSets(s, log.exerciseId) && sets.length >= 2 && sets.every((x) => x.kg === 0 && x.reps >= top && x.rpe !== undefined && x.rpe <= (log.targetRpe ?? 8) + 0.5),
        }
      }
      for (const x of log.sets) {
        if (x.warmup || x.at > now) continue
        record(log.exerciseId, s.startedAt, x.reps)
        const base = baseOf[log.exerciseId]
        if (base) record(base, s.startedAt, x.reps)
      }
    }
  }
  // Placement describes the starting athlete. A newly earned push-up during week one
  // opens that exercise without also unlocking an experienced lifter's entire session.
  const placed = [state.stepId, ...tracks.map((t) => t.stepId)]
  const placedExperienced = placed.some((id) => (STEP_BY_ID[id]?.order ?? 0) >= 2) ||
    assessments.some((a) => a && a.at <= now && (a.answers.pushups >= 10 || a.answers.pullups >= 5))
  const established = placedExperienced || skillDose > 0
  const days = new Map<string, { at: number; sets: number; lifts: Set<string> }>()
  for (const session of state.gym?.sessions ?? []) {
    if (session.startedAt < from || session.startedAt > now) continue
    for (const row of session.exercises) {
      for (const set of row.sets) {
        if (set.warmup || set.at < from || set.at > now) continue
        const key = dayKey(set.at)
        const day = days.get(key) ?? { at: set.at, sets: 0, lifts: new Set<string>() }
        if (set.reps >= (row.repRange?.[0] ?? 3) && (set.rpe ?? row.targetRpe ?? 7) <= 8) {
          day.sets++
          day.lifts.add(row.exerciseId)
        }
        days.set(key, day)
      }
    }
  }
  const trainingDays = [...days.values()].sort((a, b) => a.at - b.at)
  const visits = trainingDays.filter((day) => day.sets >= 3 && day.lifts.size >= 2)
  const introductoryVisitsLeft = established ? 0 : Math.max(0, 2 - visits.length)
  let buildUpSetLimit: number | undefined
  if (!placedExperienced && (skillDose > 0 || visits.length >= 2)) {
    // Increase from a dose repeated on two recent days. A single large workout or
    // several hard sessions cannot establish a new baseline; short visits still count.
    const doses = trainingDays.slice(-4).map((day) => day.sets).sort((a, b) => b - a)
    const start = weekStart(now)
    const previous = visits.filter((day) => day.at >= addDays(start, -7) && day.at < start)
    const priorPeak = previous.reduce((n, day) => Math.max(n, day.sets), Math.max(8, skillDose))
    buildUpSetLimit = Math.min(priorPeak, Math.max(4, skillDose, doses[1] ?? 0)) + 2
  }
  const tryPullup = assistedTrial?.ready && now - assistedTrial.at <= 28 * 86_400_000 &&
    assistedTrial.at > (evidence.get('pullups')?.at ?? 0) && !evidence.has('pull-up')
  const { trials, practice } = unassistedSteps(state.gym?.sessions ?? [], {
    pushups: evidence.get('pushups')?.reps ?? 0, pullups: evidence.get('pullups')?.reps ?? 0,
  }, now, !conservative(state.profile, now))
  return {
    ...(tryPullup ? { tryPullup: true } : {}),
    ...(trials['push-up'] ? { floorPushupTrial: trials['push-up'] } : {}),
    ...(trials['pull-up'] ? { pullupTrial: trials['pull-up'] } : {}),
    ...(Object.keys(practice).length ? { unassistedWork: practice } : {}),
    introductory: introductoryVisitsLeft > 0,
    introductoryVisitsLeft,
    introductoryEffort: !established && visits.length < 6,
    ...(buildUpSetLimit ? { buildUpSetLimit } : {}),
    base: { pushups: evidence.get('pushups')?.reps, pullups: evidence.get('pullups')?.reps, dips: evidence.get('dips')?.reps },
    practiced: new Map([...evidence].map(([id, e]) => [id, e.reps])),
  }
}

export function readyForBodyweight(id: string, capacity?: BodyweightCapacity): boolean {
  const rule = gates.get(id)
  const prep = specificPrep[id]
  if (!capacity || (!rule && !prep)) return true
  if ((id === 'push-up' || id === 'pull-up') && capacity.unassistedWork?.[id]) return true
  const own = capacity.practiced.get(id)
  if (own !== undefined) return own >= 4
  if (id === 'pull-up' && capacity.tryPullup) return true
  if (prep) return (capacity.practiced.get(prep.id) ?? 0) >= prep.reps
  return Boolean(rule && (capacity.base[rule.base] ?? 0) >= rule.reps)
}
