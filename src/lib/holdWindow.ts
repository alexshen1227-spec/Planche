import type { Kp } from './poseBackend'

/**
 * Where the hold actually is in a filmed stretch (judge v8).
 *
 * The analysed window comes from the timer, and the timer cannot know when
 * the athlete's feet left the floor: the walk allowance is an estimate, and
 * getting into a tuck takes a second or two of its own. Those moments used to
 * be judged as part of the hold — a crouch with the feet down reads as hips
 * far below the shoulders, so a clean hold could open with a run of "sag" and
 * a clean window that ended before it began. This finds the stretch to judge:
 *
 * - **Feet off the floor** for the holds that need it (`FEET_OFF_HOLDS`): an
 *   ankle clearly above the hands. A foot on the floor sits at or below the
 *   hands — level with them on the floor, below them on parallettes. Only the
 *   feet-down stretches before the lift and after the landing are trimmed.
 * - **Settled**: moments at either edge where the body is still moving into
 *   or out of the position (hand-relative shoulder or hip speed) are setup and
 *   exit, not hold. Only the edges are trimmed — a fault in the middle of the
 *   hold stays in the hold, however fast it happens.
 *
 * Pure: upright keypoints in (after `turnUpright`), a window out. When the
 * clip cannot say (too few readable moments), nothing is trimmed.
 */

/** Holds whose feet must be off the floor; leans, pseudo-planche and hangs are not. */
export const FEET_OFF_HOLDS: ReadonlySet<string> = new Set([
  'tuck-planche',
  'adv-tuck-planche',
  'one-leg-planche',
  'straddle-planche',
  'band-straddle-planche',
  'full-planche',
  'elbow-lever',
  'tuck-ninety-hold',
  'adv-tuck-ninety-hold',
  'straddle-ninety-hold',
  'ninety-hold',
])

/**
 * How far above the hands an ankle must sit, in torso lengths, to count as off
 * the floor. A foot on the floor beside hands on the floor reads about level
 * with them (ankle and wrist joints both a few centimetres up); every planche
 * shape from the tuck up carries the ankles at hip height or above. Measured in
 * `holdWindow.test.ts` on the synthetic holds and the athlete's real clips.
 */
export const FEET_OFF_MARGIN = 0.15
/**
 * How far below the clip's own hold height (its upper-quartile ankle height)
 * the feet must drop to count as down when the hold itself carries them low.
 */
export const FEET_DOWN_DROP = 0.35
/**
 * Hand-relative speed, torso lengths per second, above which the body is still
 * moving into or out of the hold. Real landmark jitter (~2% of the torso per
 * moment, three moments a second) stays far below it; lifting into a tuck or
 * coming down moves the hips half a torso or more inside a second.
 */
export const SETTLING_SPEED = 0.6
/** Never trim more than this from either edge on movement alone. */
export const MAX_EDGE_TRIM_SEC = 2.5

const MIN_SCORE = 0.42
const MIN_MOMENTS = 5

export interface HoldMoment {
  t: number
  /** Ankle height above the hands in torso lengths (+ = above); undefined when unread. */
  feetAboveHands?: number
  /** Hand-relative shoulder and hip, in torso lengths. */
  shoulder?: { x: number; y: number }
  hip?: { x: number; y: number }
}

export interface HoldWindowResult {
  /** First and last moment judged as hold, in the input's time base. */
  start: number
  end: number
  /** Whether anything was trimmed. */
  trimmed: boolean
  /** Moments read as feet down inside the analysed stretch. */
  feetDown: number
  /** No moment had the feet off the floor: the hold never happened on camera. */
  neverOff?: true
}

function point(kps: Kp[], name: string): Kp | undefined {
  const k = kps.find((p) => p.name === name)
  return k && (k.score ?? 0) >= MIN_SCORE && Number.isFinite(k.x) && Number.isFinite(k.y) ? k : undefined
}

/** What one upright moment says about feet and position. */
export function readHoldMoment(t: number, kps: Kp[]): HoldMoment {
  let best: { s: Kp; h: Kp; w: Kp; q: number; side: 'left' | 'right' } | undefined
  for (const side of ['left', 'right'] as const) {
    const s = point(kps, `${side}_shoulder`)
    const h = point(kps, `${side}_hip`)
    const w = point(kps, `${side}_wrist`)
    if (!s || !h || !w) continue
    const q = (s.score ?? 0) + (h.score ?? 0) + (w.score ?? 0)
    if (!best || q > best.q) best = { s, h, w, q, side }
  }
  if (!best) return { t }
  const torso = Math.hypot(best.s.x - best.h.x, best.s.y - best.h.y)
  if (!(torso > 1)) return { t }
  const ankles = [point(kps, 'left_ankle'), point(kps, 'right_ankle')].filter((a): a is Kp => Boolean(a))
  // The lower ankle decides: one foot down is a foot down.
  const lowest = ankles.length ? Math.max(...ankles.map((a) => a.y)) : undefined
  return {
    t,
    ...(lowest !== undefined ? { feetAboveHands: (best.w.y - lowest) / torso } : {}),
    shoulder: { x: (best.s.x - best.w.x) / torso, y: (best.s.y - best.w.y) / torso },
    hip: { x: (best.h.x - best.w.x) / torso, y: (best.h.y - best.w.y) / torso },
  }
}

function speedBetween(a: HoldMoment, b: HoldMoment): number | undefined {
  if (!a.shoulder || !a.hip || !b.shoulder || !b.hip) return undefined
  const dt = b.t - a.t
  if (!(dt > 0)) return undefined
  const ds = Math.hypot(b.shoulder.x - a.shoulder.x, b.shoulder.y - a.shoulder.y)
  const dh = Math.hypot(b.hip.x - a.hip.x, b.hip.y - a.hip.y)
  return Math.max(ds, dh) / dt
}

/**
 * The stretch of `moments` (sorted by time) that is the hold. With
 * `feetOff`, from the first lift to the last landing, then the settling edges
 * either side.
 */
export function findHoldWindow(moments: HoldMoment[], feetOff: boolean): HoldWindowResult | null {
  const usable = moments.filter((m) => m.shoulder && m.hip)
  if (usable.length < MIN_MOMENTS) return null
  const first = usable[0].t
  const last = usable[usable.length - 1].t
  let from = 0
  let to = usable.length - 1
  let feetDown = 0
  if (feetOff) {
    const read = usable.filter((m) => m.feetAboveHands !== undefined)
    if (read.length < MIN_MOMENTS) return null
    // An advanced tuck carries its feet barely above the hands (synthetic
    // holds: 0.1), so the bar is also set against this clip's own hold —
    // feet well below where the hold carries them are feet coming down.
    const heights = read.map((m) => m.feetAboveHands!).sort((a, b) => a - b)
    const holdHeight = heights[Math.floor((heights.length - 1) * 0.75)]
    const bar = Math.min(FEET_OFF_MARGIN, holdHeight - FEET_DOWN_DROP)
    const down = usable.map((m) => (m.feetAboveHands === undefined ? null : m.feetAboveHands < bar))
    feetDown = down.filter((d) => d === true).length
    if (down.every((d) => d !== false)) return { start: first, end: last, trimmed: false, feetDown, neverOff: true }
    // Only the edges: the feet-down stretch before the lift and after the
    // landing. Anything in between stays in the hold and is judged — a sag
    // deep enough to bring the feet near the hands, or a foot touching down,
    // is a fault of the hold, not a reason to stop looking at it.
    // Two feet-off moments in a row open the hold, so one misread does not.
    let start = -1
    for (let i = 0; i < usable.length; i++) {
      if (down[i] === false && (i + 1 >= usable.length || down[i + 1] !== true)) {
        start = i
        break
      }
    }
    let stop = -1
    for (let i = usable.length - 1; i >= 0; i--) {
      if (down[i] === false && (i === 0 || down[i - 1] !== true)) {
        stop = i
        break
      }
    }
    if (start < 0 || stop <= start) return { start: first, end: last, trimmed: false, feetDown, neverOff: true }
    from = start
    to = stop
  }
  // Settling edges: still moving into the position, or already leaving it.
  const startT = usable[from].t
  while (from < to - 1) {
    const v = speedBetween(usable[from], usable[from + 1])
    if (v === undefined || v <= SETTLING_SPEED || usable[from + 1].t - startT > MAX_EDGE_TRIM_SEC) break
    from++
  }
  const endT = usable[to].t
  while (to > from + 1) {
    const v = speedBetween(usable[to - 1], usable[to])
    if (v === undefined || v <= SETTLING_SPEED || endT - usable[to - 1].t > MAX_EDGE_TRIM_SEC) break
    to--
  }
  const start = usable[from].t
  const end = usable[to].t
  return { start, end, trimmed: start > first || end < last, feetDown }
}
