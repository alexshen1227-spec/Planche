import type { PR, PRMark, TrainingSurface } from '../types'

export function recordForSurface(pr: PR | undefined, surface: TrainingSurface | undefined): PRMark | undefined {
  return surface ? pr?.bySurface?.[surface] : pr
}

export function hasSurfaceRecords(pr: PR | undefined): boolean {
  return Boolean(pr?.bySurface && Object.keys(pr.bySurface).length)
}
