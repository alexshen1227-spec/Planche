import type { PR, PRMark, Session, SetLog, TrainingSurface } from '../types'

export function recordForSurface(pr: PR | undefined, surface: TrainingSurface | undefined): PRMark | undefined {
  return surface ? pr?.bySurface?.[surface] : pr
}

export function hasSurfaceRecords(pr: PR | undefined): boolean {
  return Boolean(pr?.bySurface && Object.keys(pr.bySurface).length)
}

export function isRecordSet(set: SetLog): boolean {
  return set.value > 0 && set.section !== 'warmup' && set.section !== 'cooldown'
}

/** Unlabelled older records do not establish a best for either side. */
export function sideRecord(sessions: Session[], exerciseId: string, side: 'left' | 'right', surface?: TrainingSurface): number | undefined {
  let best = 0
  for (const s of sessions) {
    if (s.workoutKind === 'micro') continue
    for (const set of s.sets) {
      if (set.exerciseId === exerciseId && set.side === side && (!surface || set.surface === surface) && isRecordSet(set)) best = Math.max(best, set.value)
    }
  }
  return best || undefined
}
