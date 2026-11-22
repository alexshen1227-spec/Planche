import { MIN_LOCKOUT_DEG } from './lockout'

export type LockoutMeasurement =
  | { kind: 'measured'; deg: number; readings: number; spread: number }
  | { kind: 'refused'; reason: string }

/** Fewer elbow readings than this cannot place a lockout. */
export const MIN_LOCKOUT_READINGS = 6

function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo)
}

/**
 * The athlete's lockout from a calibration clip's per-moment elbow readings:
 * the median, refused when there are too few readings or when the median is
 * itself a bend. Pure, so the refusal branches are tested rather than assumed.
 */
export function lockoutFromReadings(readings: (number | undefined)[]): LockoutMeasurement {
  const usable = readings.filter((r): r is number => typeof r === 'number' && Number.isFinite(r)).sort((a, b) => a - b)
  if (usable.length < MIN_LOCKOUT_READINGS) {
    return {
      kind: 'refused',
      reason: `Only ${usable.length} reading${usable.length === 1 ? '' : 's'} of your elbows came through. Film a little longer, side-on, with your whole arm in the picture.`,
    }
  }
  const median = quantile(usable, 0.5)
  if (median < MIN_LOCKOUT_DEG) {
    return {
      kind: 'refused',
      reason: `Your elbows read about ${Math.round(median)}° — that is a bend the camera can see, not a lockout, so it was not saved. Lock them as straight as they go and try again.`,
    }
  }
  const spread = Math.round((quantile(usable, 0.75) - quantile(usable, 0.25)) / 2)
  return { kind: 'measured', deg: Math.min(180, Math.round(median)), readings: usable.length, spread }
}
