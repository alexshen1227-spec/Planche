import {
  apparentBodyWidthRatio,
  MAX_SIDE_VIEW_RATIO,
  type Kp,
} from './poseBackend'
import { MOMENTARY_MATERIAL_TOLERANCE, signedElbowBend } from './poseForm'

/**
 * A spoken "lock your elbows" during a filmed hold, decided from the live
 * camera.
 *
 * Everything else the camera says arrives after the set, when the bend has
 * already been practised. Soft elbows are the fault that matters most (bent
 * arms are a different skill) and the one athletes most often cannot feel —
 * so a cue in the moment is worth having, *if* it is never wrong in a way
 * that teaches people to ignore it.
 *
 * So it is deliberately the most conservative thing the judge knows how to
 * say: the momentary bar (16°, wider than the 8° whole-hold deadband, because
 * one moment carries far more landmark error), every reading in a ~1.2 s
 * window beyond it, at least three of them, side-on, and nothing in the first
 * second while the athlete is still settling into the hold. That is the same
 * persistence rule that has produced no false accusations on exactly straight
 * synthetic arms at 2% landmark noise (formJudge.eval). At most one cue a
 * hold: one correction at a time.
 *
 * The verdict after the set is unchanged — this only speaks. Beta, off by
 * default: running the model live while recording costs battery and has not
 * been measured on a phone.
 */

/** Seconds at the start of a hold that never cue — entry is not the hold. */
export const CUE_SETTLE_SEC = 1
/** The window every reading must agree across. */
export const CUE_WINDOW_SEC = 1.2
/** Readings needed inside the window. */
export const CUE_MIN_READINGS = 3
const MIN_SCORE = 0.42

export interface LiveReading {
  /** Seconds since the hold started. */
  t: number
  /** Elbow angle (180 = locked) when measurable on a side-on frame. */
  elbowDeg?: number
}

/** The near arm's elbow angle from one live frame, or undefined when it cannot be read honestly. */
export function liveElbowDeg(kps: Kp[], width: number, height: number): number | undefined {
  // Joints outside the picture are not observations (judge v4).
  const seen = (name: string) => {
    const k = kps.find((p) => p.name === name)
    if (!k || (k.score ?? 0) < MIN_SCORE) return undefined
    if (!Number.isFinite(k.x) || !Number.isFinite(k.y) || k.x < 0 || k.y < 0 || k.x > width || k.y > height) return undefined
    return k
  }
  const ratio = apparentBodyWidthRatio(kps)
  if (ratio !== undefined && ratio > MAX_SIDE_VIEW_RATIO) return undefined
  const sideScore = (side: string) =>
    ['shoulder', 'elbow', 'wrist', 'hip'].reduce((t, part) => t + (seen(`${side}_${part}`)?.score ?? 0), 0)
  const side = sideScore('left') >= sideScore('right') ? 'left' : 'right'
  const shoulder = seen(`${side}_shoulder`)
  const elbow = seen(`${side}_elbow`)
  const wrist = seen(`${side}_wrist`)
  const hip = seen(`${side}_hip`)
  if (!shoulder || !elbow || !wrist || !hip) return undefined
  const torso = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y)
  if (torso < 1) return undefined
  const bend = signedElbowBend(shoulder, elbow, wrist, hip, torso)
  return bend === undefined ? undefined : 180 - Math.max(0, bend)
}

/** Whether the readings so far call for the cue now. */
export function elbowCueDue(readings: LiveReading[], minElbowDeg = 180): boolean {
  const usable = readings.filter((r) => r.t >= CUE_SETTLE_SEC)
  if (!usable.length) return false
  const latest = usable[usable.length - 1].t
  const window = usable.filter((r) => r.t >= latest - CUE_WINDOW_SEC)
  if (window.length < CUE_MIN_READINGS) return false
  const bar = minElbowDeg - MOMENTARY_MATERIAL_TOLERANCE.elbowDeg
  return window.every((r) => r.elbowDeg !== undefined && r.elbowDeg < bar)
}
