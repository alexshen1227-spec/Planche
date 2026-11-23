import type { AppState } from '../../types'
import { readinessTimeline } from '../signals'
import { sportName, type SportEvent } from './sport'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const RECENT_DAYS = 10
const BEFORE_DAYS = 21
/** Fewer rated sets than this in a window and the trend is not read at all. */
export const MIN_RATED_SETS = 6

export type ReadinessLevel = 'light' | 'normal' | 'push'

/**
 * How hard today is pitched, and why. Reading effort this way is a coaching
 * convention (RPE-based autoregulation is MODERATE evidence for load choice,
 * nothing more); it describes how training has felt and never claims to know
 * recovery.
 */
export interface DayReadiness {
  level: ReadinessLevel
  reason: string
  /** The effort read: mean RPE of rated working sets lately, before, and against what was asked. Absent when too few. */
  effort?: { recent: number; before?: number; vsAsked?: number; sets: number }
}

export interface ReadinessContext {
  /** A pain report in the last two days. */
  pain: boolean
  /** Any pain or niggle report still inside its three-day window. */
  niggle: boolean
  deload: boolean
  inSeason: boolean
  /** A hard sport session yesterday or earlier today. */
  hardSportBefore?: SportEvent
  /** A hard sport session in the next day and a half. */
  hardSportNext?: SportEvent
}

/** Light days take this share of the sets; a push day adds about one set to each lift. */
export const READINESS_FACTOR: Record<ReadinessLevel, number> = { light: 0.7, normal: 1, push: 1.2 }

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const one = (v: number) => Math.round(v * 10) / 10

/**
 * Rated working sets (gym and skill) in two windows before `at`, the gym sets' distance from the effort asked, and
 * how the loads moved: of the lifts done in both windows, how many were heavier lately (their heaviest working set).
 */
export function ratedEffort(
  state: Pick<AppState, 'sessions' | 'gym'>,
  at: number,
): { recent: number[]; before: number[]; vsAsked: number[]; loads: { compared: number; heavier: number } } {
  const recentFrom = at - RECENT_DAYS * DAY
  const beforeFrom = recentFrom - BEFORE_DAYS * DAY
  const recent: number[] = []
  const before: number[] = []
  const vsAsked: number[] = []
  const heaviest = { recent: new Map<string, number>(), before: new Map<string, number>() }
  const put = (t: number, rpe: number) => {
    if (t >= recentFrom && t < at) recent.push(rpe)
    else if (t >= beforeFrom && t < recentFrom) before.push(rpe)
  }
  for (const s of state.gym?.sessions ?? []) {
    if (s.startedAt < beforeFrom || s.startedAt >= at) continue
    const window = s.startedAt >= recentFrom ? heaviest.recent : heaviest.before
    for (const log of s.exercises) {
      for (const x of log.sets) {
        if (x.warmup || !(x.reps > 0)) continue
        if (x.kg !== undefined && x.kg > (window.get(log.exerciseId) ?? -Infinity)) window.set(log.exerciseId, x.kg)
        if (x.rpe === undefined) continue
        put(s.startedAt, x.rpe)
        if (log.targetRpe !== undefined && s.startedAt >= recentFrom) vsAsked.push(x.rpe - log.targetRpe)
      }
    }
  }
  const both = [...heaviest.recent.keys()].filter((id) => heaviest.before.has(id))
  const loads = { compared: both.length, heavier: both.filter((id) => heaviest.recent.get(id)! > heaviest.before.get(id)! + 0.01).length }
  for (const s of state.sessions) {
    if (s.startedAt < beforeFrom || s.startedAt >= at) continue
    for (const x of s.sets) {
      if ((x.section === 'main' || x.section === 'strength') && x.rpe !== undefined) put(s.startedAt, x.rpe)
    }
  }
  return { recent, before, vsAsked, loads }
}

/**
 * Light, normal or push, from the recent effort trend and what the athlete
 * reported. Never a push with an open pain or niggle report, the day after a
 * hard sport session, before a hard one, on a lighter week or in season; and
 * with too few rated sets it says it cannot tell rather than guessing.
 */
export function dayReadiness(state: AppState, at: number, ctx: ReadinessContext): DayReadiness {
  const { recent, before, vsAsked, loads } = ratedEffort(state, at)
  const enough = recent.length >= MIN_RATED_SETS
  const effort = enough
    ? {
        recent: one(mean(recent)),
        sets: recent.length,
        ...(before.length >= MIN_RATED_SETS ? { before: one(mean(before)) } : {}),
        ...(vsAsked.length >= MIN_RATED_SETS ? { vsAsked: one(mean(vsAsked)) } : {}),
      }
    : undefined
  const withEffort = (r: Omit<DayReadiness, 'effort'>): DayReadiness => ({ ...r, ...(effort ? { effort } : {}) })

  if (ctx.pain) return withEffort({ level: 'light', reason: 'Pain reported in the last two days: a light day, and never a push.' })
  // The latest check-in in the last 18 hours: tired or a poor night is a light day.
  const latest = readinessTimeline(state, at)
    .filter((a) => a.at <= at && at - a.at < 18 * HOUR)
    .pop()
  if (latest?.energy === 'tired') return withEffort({ level: 'light', reason: 'You said you were tired: a light day — fewer sets, stopping further from failure.' })
  if (latest?.sleep === 'poor') return withEffort({ level: 'light', reason: 'A poor night’s sleep: a light day — fewer sets, stopping further from failure.' })
  // Effort up is the same work costing more only when it is the same work, at or past what was asked: loads that went
  // up, or sets still coming in under the effort asked, are the plan working. Read without either, a teenager whose
  // loads had climbed — sets at RPE 7.3 against an asked 7.5–8 — got six light gym days in a row.
  const heavier = loads.compared > 0 && loads.heavier * 2 >= loads.compared
  const underAsked = effort?.vsAsked !== undefined && effort.vsAsked < 0
  if (effort && effort.before !== undefined && effort.recent - effort.before >= 0.75 && !heavier && !underAsked) {
    return withEffort({
      level: 'light',
      reason: `Your rated sets averaged RPE ${effort.recent} over the last ten days, up from ${effort.before} before, at the same loads: the same work is costing more, so today is lighter. Reading effort like this is a coaching convention.`,
    })
  }
  if (effort && effort.recent >= 9.25) {
    return withEffort({ level: 'light', reason: `Your rated sets have averaged RPE ${effort.recent} over the last ten days — close to all-out — so today is lighter.` })
  }
  const easier =
    effort !== undefined &&
    ((effort.vsAsked !== undefined && effort.vsAsked <= -1) ||
      (effort.before !== undefined && effort.recent - effort.before <= -0.75 && effort.recent <= 8))
  if (easier) {
    const blocker = ctx.niggle
      ? 'a pain or niggle report is still open'
      : ctx.hardSportBefore
        ? `you had a hard ${sportName(ctx.hardSportBefore.kind)} ${dayOf(ctx.hardSportBefore.at, at)}`
        : ctx.hardSportNext
          ? `a hard ${sportName(ctx.hardSportNext.kind)} is coming up`
          : ctx.deload
            ? 'this is a lighter week'
            : ctx.inSeason
              ? 'in season the sport comes first'
              : null
    if (blocker) return withEffort({ level: 'normal', reason: `Your sets have been feeling easier than asked, but ${blocker}: a normal day, not a push.` })
    const by = effort!.vsAsked !== undefined && effort!.vsAsked <= -1 ? `about ${one(-effort!.vsAsked)} RPE under what was asked` : `easier than before (RPE ${effort!.recent}, from ${effort!.before})`
    return withEffort({
      level: 'push',
      reason: `Your rated sets have come in ${by}, with nothing hard yesterday and no pain reported: a push day — one more set on each lift, same weights. A coaching convention, not a test.`,
    })
  }
  if (!effort) {
    return { level: 'normal', reason: 'Not enough rated sets in the last ten days to tell how training is feeling — a normal day. Rating your sets (RPE) lets the plan scale days to it.' }
  }
  return withEffort({ level: 'normal', reason: `Effort has been steady (RPE ${effort.recent} on average lately): a normal day.` })
}

function dayOf(t: number, at: number): string {
  const a = new Date(t)
  const b = new Date(at)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() ? 'earlier today' : 'yesterday'
}
