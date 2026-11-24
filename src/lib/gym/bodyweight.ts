import type { AppState } from '../../types'

type Base = 'pushups' | 'pullups' | 'dips'
export type BodyweightCapacity = { base: Partial<Record<Base, number>>; practiced: Map<string, number> }

// These are starting gates for automated picks. An athlete can always add a movement manually.
const gates = new Map<string, { base: Base; reps: number }>()
function gate(base: Base, reps: number, ids: string[]) {
  for (const id of ids) gates.set(id, { base, reps })
}
gate('pushups', 5, ['push-up'])
gate('pushups', 8, ['diamond-push-up', 'pike-push-up', 'ring-push-up'])
gate('pushups', 12, ['weighted-push-up', 'band-resisted-push-up', 'pseudo-planche-push-up', 'archer-push-up', 'explosive-push-up', 'clap-push-up'])
gate('pullups', 5, ['pull-up', 'chin-up', 'neutral-pull-up'])
gate('pullups', 10, ['weighted-pull-up', 'wide-pull-up', 'l-sit-pull-up'])
gate('pullups', 12, ['archer-pull-up', 'typewriter-pull-up', 'ice-cream-maker'])
gate('dips', 5, ['dip', 'straight-bar-dip'])
gate('dips', 12, ['weighted-dip', 'ring-dip'])

const baseOf: Record<string, Base> = { pushup: 'pushups', 'push-up': 'pushups', pullup: 'pullups', 'pull-up': 'pullups', 'chin-up': 'pullups', dip: 'dips' }

/** The most recent direct report or working session for each movement. Zero reps is evidence too. */
export function bodyweightCapacity(state: AppState, now: number): BodyweightCapacity {
  const from = now - 84 * 86_400_000
  const evidence = new Map<string, { at: number; reps: number }>()
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
      const base = baseOf[x.exerciseId]
      if (base && x.kind === 'reps' && x.section !== 'warmup' && x.section !== 'cooldown') record(base, s.startedAt, x.value)
    }
  }
  for (const s of state.gym?.sessions ?? []) {
    if (s.startedAt < from || s.startedAt > now) continue
    for (const log of s.exercises) {
      if (!gates.has(log.exerciseId)) continue
      for (const x of log.sets) {
        if (x.warmup) continue
        record(log.exerciseId, s.startedAt, x.reps)
        const base = baseOf[log.exerciseId]
        if (base) record(base, s.startedAt, x.reps)
      }
    }
  }
  return {
    base: { pushups: evidence.get('pushups')?.reps, pullups: evidence.get('pullups')?.reps, dips: evidence.get('dips')?.reps },
    practiced: new Map([...evidence].map(([id, e]) => [id, e.reps])),
  }
}

export function readyForBodyweight(id: string, capacity?: BodyweightCapacity): boolean {
  const rule = gates.get(id)
  if (!capacity || !rule) return true
  const own = capacity.practiced.get(id)
  if (own !== undefined) return own >= 4
  return (capacity.base[rule.base] ?? 0) >= rule.reps
}
