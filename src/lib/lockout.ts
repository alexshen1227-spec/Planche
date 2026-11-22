/**
 * The athlete's lockout calibration, kept apart from the judge so the app shell
 * can set it without loading the pose model's module.
 */

/**
 * Where a locked arm reads, before the athlete has calibrated (judge v8).
 *
 * The elbow bars above are *noise* margins, swept around a known lockout. A
 * real lockout is not a known 180: a 2D model places the elbow on the skin
 * over the joint, a carrying angle and an arm a little out of the picture's
 * plane all shorten it, and real side-on frames of straight arms read
 * 164–179° (handstands, realPoses) while one athlete's locked tuck read
 * 167–170° on their own phone. Measured from 180 every one of those holds was
 * a named bend. Until the athlete measures their own lockout the reference is
 * 173°, which puts the named-fault bar at 165° (173 − 8) — the athlete's ask —
 * and the per-moment and softening bars at the same measured widths below it.
 * A real bend still has to clear those widths; only the zero point moved.
 */
export const UNCALIBRATED_LOCKOUT_DEG = 173
/** A calibration reading below this is a bend, not a lockout, and is refused. */
export const MIN_LOCKOUT_DEG = 160

/** The lockout reference a judge run measures straight-arm bends from. */
export function lockoutReference(deg: number | undefined): number {
  if (deg === undefined || !Number.isFinite(deg)) return 180
  return Math.min(180, Math.max(MIN_LOCKOUT_DEG, deg))
}

let athleteLockoutDeg: number | undefined
/** The app's current athlete calibration; `undefined` = not calibrated. */
export function setAthleteLockout(deg: number | undefined): void {
  athleteLockoutDeg = deg !== undefined && Number.isFinite(deg) ? lockoutReference(deg) : undefined
}
/** What a clip analysed now is judged against. */
export function currentLockoutDeg(): number {
  return athleteLockoutDeg ?? UNCALIBRATED_LOCKOUT_DEG
}
