import type { AppState } from '../../types'
import { STEP_BY_ID } from '../../data/progressions'

type Base = 'pushups' | 'pullups' | 'dips'
export type BodyweightCapacity = { base: Partial<Record<Base, number>>; practiced: Map<string, number>; introductory?: boolean; introductoryVisitsLeft?: number; buildUpSetLimit?: number; tryPullup?: boolean }

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
  for (const a of [state.assessment, ...Object.values(state.tracks ?? {}).map((t) => t.assessment)]) {
    if (!a) continue
    for (const key of ['pushups', 'pullups'] as const) record(key, a.at, a.answers[key])
  }
  for (const s of state.sessions) {
    if (s.startedAt < from || s.startedAt > now) continue
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
          ready: sets.length >= 2 && sets.every((x) => x.kg === 0 && x.reps >= top && x.rpe !== undefined && x.rpe <= (log.targetRpe ?? 8) + 0.5),
        }
      }
      for (const x of log.sets) {
        if (x.warmup) continue
        record(log.exerciseId, s.startedAt, x.reps)
        const base = baseOf[log.exerciseId]
        if (base) record(base, s.startedAt, x.reps)
      }
    }
  }
  const placed = [state.stepId, ...Object.values(state.tracks ?? {}).map((t) => t.stepId)]
  const established = placed.some((id) => (STEP_BY_ID[id]?.order ?? 0) >= 2) || (evidence.get('pushups')?.reps ?? 0) >= 10 || (evidence.get('pullups')?.reps ?? 0) >= 5
  // A visit advances the beginner's dose when they actually tolerate a few working sets.
  // A short workout can qualify. Two attempts taken to failure on two days cannot.
  const days = new Map<string, { sets: number; lifts: Set<string> }>()
  for (const session of state.gym?.sessions ?? []) {
    if (session.startedAt < from || session.startedAt > now) continue
    const key = new Date(session.startedAt).toDateString()
    const day = days.get(key) ?? { sets: 0, lifts: new Set<string>() }
    for (const row of session.exercises) {
      const sets = row.sets.filter((s) => !s.warmup && s.reps >= (row.repRange?.[0] ?? 3) && (s.rpe ?? row.targetRpe ?? 7) <= 8)
      if (sets.length) { day.sets += sets.length; day.lifts.add(row.exerciseId) }
    }
    days.set(key, day)
  }
  const visits = [...days.values()].filter((day) => day.sets >= 3 && day.lifts.size >= 2)
  const introductoryVisitsLeft = established ? 0 : Math.max(0, 2 - visits.length)
  const buildUpSetLimit = !established && visits.length >= 2 && visits.length < 4 ? Math.min(12, Math.max(...visits.map((day) => day.sets)) + 2) : undefined
  const tryPullup = assistedTrial?.ready && now - assistedTrial.at <= 28 * 86_400_000 &&
    assistedTrial.at > (evidence.get('pullups')?.at ?? 0) && !evidence.has('pull-up')
  return {
    ...(tryPullup ? { tryPullup: true } : {}),
    introductory: introductoryVisitsLeft > 0,
    introductoryVisitsLeft,
    ...(buildUpSetLimit ? { buildUpSetLimit } : {}),
    base: { pushups: evidence.get('pushups')?.reps, pullups: evidence.get('pullups')?.reps, dips: evidence.get('dips')?.reps },
    practiced: new Map([...evidence].map(([id, e]) => [id, e.reps])),
  }
}

export function readyForBodyweight(id: string, capacity?: BodyweightCapacity): boolean {
  const rule = gates.get(id)
  const prep = specificPrep[id]
  if (!capacity || (!rule && !prep)) return true
  const own = capacity.practiced.get(id)
  if (own !== undefined) return own >= 4
  if (id === 'pull-up' && capacity.tryPullup) return true
  if (prep) return (capacity.practiced.get(prep.id) ?? 0) >= prep.reps
  return Boolean(rule && (capacity.base[rule.base] ?? 0) >= rule.reps)
}
