import { MUSCLE_BY_ID, MUSCLES, type Joint, type Muscle } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { STEP_BY_ID } from '../../data/progressions'
import type { AppState, BodyRegion, Session, SkillId } from '../../types'
import { forecastUnlock, goalOutlook } from '../forecast'
import { readinessTimeline } from '../signals'
import { skillView } from '../skills'
import { addDays, dayKey, weekStart } from '../time'
import { FOCUS_LABEL, type GymFocus } from '../gym/builder'
import { conservative } from '../gym/draft'
import { estimateOneRepMax } from '../gym/progression'
import { defaultPrefs } from '../gym/state'
import type { SkillGoal, TrainingPrefs } from '../gym/types'
import {
  activityLoad,
  familyLoading,
  fatigueAt,
  lastHardStraightArm,
  lastTrainedAt,
  setsPerMuscle,
  skillSetLoading,
  volumeTarget,
  type Credit,
} from './load'
import { dayReadiness, READINESS_FACTOR, type DayReadiness } from './readiness'
import { isHardForLegs, isHardSport, sportBetween, sportName, type SportEvent } from './sport'

export { recentPatternUse, rotationHints, type PatternUse, type RotationHint } from './rotation'
export type { DayReadiness, ReadinessLevel } from './readiness'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export const FOCUS_MUSCLES: Record<GymFocus, Muscle[]> = {
  push: ['chest', 'chest-upper', 'front-delts', 'side-delts', 'triceps', 'triceps-long'],
  pull: ['lats', 'upper-back', 'rear-delts', 'biceps', 'forearms'],
  lower: ['quads', 'hamstrings', 'glutes', 'calves', 'adductors'],
  upper: ['chest', 'chest-upper', 'front-delts', 'side-delts', 'rear-delts', 'triceps', 'lats', 'upper-back', 'biceps'],
  full: ['quads', 'glutes', 'hamstrings', 'chest', 'front-delts', 'lats', 'upper-back', 'triceps', 'biceps'],
  athletic: ['quads', 'glutes', 'hamstrings', 'calves'],
}

/**
 * Roughly how a session of each focus spreads its working sets over the
 * muscles (a primary counts 1, a secondary 0.5, summed per set): read off the
 * builder's slot order. An estimate for planning the week — the builder picks
 * the actual movements on the day.
 */
const FOCUS_SHARE: Record<GymFocus, Partial<Record<Muscle, number>>> = {
  push: { chest: 0.5, 'chest-upper': 0.2, 'front-delts': 0.45, 'side-delts': 0.2, triceps: 0.45, 'triceps-long': 0.15 },
  pull: { lats: 0.5, 'upper-back': 0.45, 'rear-delts': 0.2, biceps: 0.45, forearms: 0.15, abs: 0.1 },
  lower: { quads: 0.45, glutes: 0.45, hamstrings: 0.35, calves: 0.15, adductors: 0.15, abs: 0.1 },
  upper: { chest: 0.3, 'chest-upper': 0.12, 'front-delts': 0.25, 'side-delts': 0.12, 'rear-delts': 0.12, triceps: 0.25, lats: 0.3, 'upper-back': 0.3, biceps: 0.2 },
  full: { quads: 0.22, glutes: 0.22, hamstrings: 0.15, chest: 0.18, 'front-delts': 0.12, lats: 0.18, 'upper-back': 0.18, triceps: 0.1, biceps: 0.1, abs: 0.06 },
  athletic: { quads: 0.3, glutes: 0.3, hamstrings: 0.25, calves: 0.25, abs: 0.05 },
}
const FOCI = Object.keys(FOCUS_SHARE) as GymFocus[]
/** Muscles some gym focus trains: the only ones the week can be planned toward. */
const PLANNABLE = new Set<Muscle>(FOCI.flatMap((f) => Object.keys(FOCUS_SHARE[f]) as Muscle[]))

const LEG_MUSCLES: Muscle[] = ['quads', 'hamstrings', 'glutes', 'calves', 'adductors']
/** Days of absence that count toward "left longest", and how much they weigh. */
const STALE_CAP_DAYS = 14
const STALE_WEIGHT = 0.35

/** Working sets a gym block of this length holds: a warm-up, then a set about every 2.7 minutes with its rest. */
const sessionSets = (minutes: number, factor: number) => (Math.max(0, minutes - 6) / 2.7) * factor

/**
 * Hard straight-arm sessions a week each family is planned toward: three for
 * the family of the athlete's first skill, two for the others. A coaching
 * convention (skills move with frequency; 48 h between hard straight-arm
 * sessions), not a measured dose.
 */
export const FAMILY_SESSIONS_LEAD = 3
export const FAMILY_SESSIONS_OTHER = 2

/** Which straight-arm family a skill's hard work belongs to. The handstand is balance work. */
export function skillFamily(skill: SkillId): 'push' | 'pull' | 'balance' {
  if (skill === 'planche' || skill === 'ninety') return 'push'
  if (skill === 'frontlever' || skill === 'flag') return 'pull'
  return 'balance'
}

type Family = ReturnType<typeof skillFamily>
type Straight = 'push' | 'pull'

const REGION_JOINT: Partial<Record<BodyRegion, Joint>> = {
  wrist: 'wrists',
  elbow: 'elbows',
  shoulder: 'shoulders',
  'lower-back': 'lower-back',
  knee: 'knees',
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const dayName = (t: number) => DAY_NAMES[new Date(t).getDay()]
const skillName = (s: SkillId) => (s === 'frontlever' ? 'front lever' : s === 'ninety' ? '90° hold' : s)
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

export interface TodayPlan {
  minutes: number
  rest: boolean
  /** Skill work comes first in the session, while fresh. */
  skill?: { minutes: number; skills: SkillId[] }
  gym?: { minutes: number; focus: GymFocus; avoidJoints: Joint[]; volumeFactor: number; deload: boolean; musclesOff: Muscle[] }
  /** How hard today is pitched (light / normal / push) and why. Today only; later days are planned as normal. */
  readiness?: DayReadiness
  /** Why the day looks the way it does, in the athlete's terms. */
  reasons: string[]
}

function joinNames(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/** A run of hard gym weeks, or a fortnight of grinding sets: time for a lighter week (convention). */
export function gymDeloadDue(state: AppState, now: number): { due: boolean; why?: string } {
  const sessions = state.gym?.sessions ?? []
  const youth = conservative(state.profile, now)
  const weeksNeeded = youth ? 3 : 5
  const startThis = weekStart(now)
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const from = startThis - (i + 1) * WEEK
    const inWeek = sessions.filter((s) => s.startedAt >= from && s.startedAt < from + WEEK)
    const working = inWeek.flatMap((s) => s.exercises.flatMap((e) => e.sets.filter((x) => !x.warmup && x.reps > 0)))
    const rpes = working.filter((x) => x.rpe !== undefined).map((x) => x.rpe!)
    return { sessions: inWeek.length, sets: working.length, avg: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : 0 }
  })
  // A week well under the usual volume is a lighter week, however hard its
  // sets felt — it ends the run, or a deload logged at RPE 8 would call
  // another one every week after.
  const usual = Math.max(0, ...weeks.map((w) => w.sets))
  let hardRun = 0
  for (const w of weeks) {
    if (w.sessions >= 2 && w.avg >= 7.5 && w.sets >= 0.7 * usual) hardRun++
    else break
  }
  if (hardRun >= weeksNeeded) {
    return {
      due: true,
      why: `${hardRun} hard gym weeks in a row${youth ? ' (under 18 the lighter week comes sooner)' : ''}: this week is lighter — fewer sets, stopping further from failure. Deloads are a coaching convention; controlled trials have not shown they add strength, but they keep a long run of hard weeks sustainable.`,
    }
  }
  const recent = sessions.filter((s) => s.startedAt >= now - 14 * DAY && s.startedAt < now)
  const recentRpe = recent.flatMap((s) => s.exercises.flatMap((e) => e.sets.filter((x) => !x.warmup && x.rpe !== undefined).map((x) => x.rpe!)))
  if (recent.length >= 3 && recentRpe.length >= 12) {
    const avg = recentRpe.reduce((a, b) => a + b, 0) / recentRpe.length
    // Effort up while the estimated maxes did not move: the same work is costing more.
    // Only where both weeks have an estimate: no estimate is not "held still".
    const e1 = (from: number, to: number): number | null => {
      const values = recent
        .filter((s) => s.startedAt >= from && s.startedAt < to)
        .flatMap((s) => s.exercises.flatMap((e) => e.sets.filter((x) => !x.warmup).map((x) => estimateOneRepMax(x))))
        .filter((v): v is number => v !== null)
      return values.length ? Math.max(...values) : null
    }
    const thisWeek = e1(now - 7 * DAY, now)
    const lastWeek = e1(now - 14 * DAY, now - 7 * DAY)
    const stalled = thisWeek !== null && lastWeek !== null && thisWeek <= lastWeek
    if (avg >= 9 && stalled) {
      return { due: true, why: 'Your sets have averaged RPE 9 or more for two weeks while your estimated maxes held still: a lighter week now, then build again. A coaching convention, not a proven rule.' }
    }
  }
  return { due: false }
}

// ---------------------------------------------------------------------------
// The week. Every day from today to the end of the calendar week (and on into
// the next one when today + 6 crosses it) is planned together: skill days by
// the rest rule and each family's weekly sessions, gym days so each muscle's
// weekly sets are met across the days that are left, never by one day alone.
// It is planned again from what actually happened every time it is read, so a
// missed day re-balances the rest of the week by itself.
// ---------------------------------------------------------------------------

type Answer = ReturnType<typeof readinessTimeline>[number]

/** One day of the horizon, with everything decided before its gym focus. */
interface DayCtx {
  index: number
  key: string
  start: number
  /** The moment it is planned for: now for today, 5 pm for later days. */
  at: number
  week: number
  minutes: number
  /** A rest day in the schedule (and no minutes given for today). */
  restDay: boolean
  sport: SportEvent[]
  /** Sport in the last 48 h that loaded the legs (logged, or a hard one from the sport week). */
  legsCovered?: SportEvent
  /** Sport in the next 36 h the legs stay fresh for. */
  upcoming?: SportEvent
  hardBefore?: SportEvent
  hardNext?: SportEvent
  reports: Answer[]
  avoidJoints: Joint[]
  pain: boolean
  niggle: boolean
  deload: { due: boolean; why?: string }
  readiness?: DayReadiness
  factor: number
  /** Muscles the gym leaves out that day: the athlete's own, plus legs around sport. */
  off: Set<Muscle>
  fatigue: Credit
}

interface SkillSlot {
  skillMin: number
  gymMin: number
  skills: SkillId[]
  families: Set<Family>
  blocked: Record<Straight, boolean>
  lastHard: Partial<Record<Straight, number>>
  short?: 'skills' | 'gym'
  /** The family a short day went to skills for, to reach its sessions this week. */
  urgent?: Straight
  noSkillFits: boolean
  /** Hard sessions of each family this calendar week, up to and including this day. */
  count: Record<Straight, number>
  credit: Credit
}

const startOfDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
const fivePm = (dayStart: number) => {
  const d = new Date(dayStart)
  d.setHours(17, 0, 0, 0)
  return d.getTime()
}
function addCredit(into: Credit, credit: Credit, scale = 1) {
  for (const [m, v] of Object.entries(credit) as [Muscle, number][]) into[m] = (into[m] ?? 0) + v * scale
}

/** Hard skill sessions (three or more main sets of a family, as the rest rule counts them) in [from, to). */
function hardCount(sessions: Session[], from: number, to: number): Record<Straight, number> {
  const out = { push: 0, pull: 0 }
  for (const s of sessions) {
    if (s.startedAt < from || s.startedAt >= to) continue
    const n = { push: 0, pull: 0 }
    for (const set of s.sets) {
      if (set.section !== 'main' && set.section !== 'strength') continue
      const f = skillSetLoading(set.exerciseId, set.section)?.straightArm
      if (f) n[f]++
    }
    for (const f of ['push', 'pull'] as const) if (n[f] >= 3) out[f]++
  }
  return out
}

/** Speed-and-power gym sessions in [from, to): named so, or mostly explosive movements. */
function athleticCount(state: AppState, from: number, to: number): number {
  return (state.gym?.sessions ?? []).filter((s) => {
    if (s.startedAt < from || s.startedAt >= to) return false
    if (s.name === FOCUS_LABEL.athletic) return true
    const explosive = s.exercises.filter((e) => GYM_EXERCISE_BY_ID[e.exerciseId]?.explosive).length
    return s.exercises.length > 0 && explosive * 2 >= s.exercises.length
  }).length
}

function dayContexts(state: AppState, prefs: TrainingPrefs, now: number, horizonEnd: number, todayMinutes?: number): DayCtx[] {
  const today = startOfDay(now)
  // Every report in the window counts, not only the latest: a "good" check-in
  // an hour later is not the elbow healing (the same reason the coach's
  // persistent-complaint rail outranks today's answer).
  const timeline = readinessTimeline(state, now)
  const inSeason = prefs.season === 'in'
  const deloads = new Map<number, { due: boolean; why?: string }>()
  const out: DayCtx[] = []
  for (let i = 0; i < 21; i++) {
    const start = addDays(today, i)
    if (start >= horizonEnd) break
    const at = i === 0 ? now : fivePm(start)
    const weekday = new Date(start).getDay()
    const scheduled = prefs.minutesByDay[weekday] ?? 0
    const given = i === 0 && todayMinutes !== undefined
    const minutes = given ? todayMinutes! : scheduled
    const near = sportBetween(state.gym, at - 48 * HOUR, at + 36 * HOUR)
    // A logged activity marked as loading the legs counts as it always has; a
    // session from the sport week only when it is a hard one.
    const loadsLegs = (a: SportEvent) => (a.scheduled ? isHardForLegs(a) : a.legs)
    const legsCovered = near.filter((a) => a.at <= at && at - a.at < 48 * HOUR && loadsLegs(a)).pop()
    const upcoming = near.find((a) => a.at > at && loadsLegs(a))
    const yesterday = addDays(start, -1)
    const hardBefore = near.filter((a) => a.at <= at && a.at >= yesterday && isHardSport(a)).pop()
    const hardNext = near.find((a) => a.at > at && isHardSport(a))
    const reports = timeline.filter((a) => a.at <= at && at - a.at < 72 * HOUR && a.joints !== 'good')
    const avoidJoints = [
      ...new Set(reports.flatMap((a) => a.regions ?? []).map((r) => REGION_JOINT[r]).filter((j): j is Joint => Boolean(j))),
    ]
    const pain = reports.some((a) => a.joints === 'pain' && at - a.at < 48 * HOUR)
    const niggle = reports.some((a) => a.joints === 'niggle')
    const week = weekStart(start)
    if (!deloads.has(week)) deloads.set(week, gymDeloadDue(state, week === weekStart(now) ? now : at))
    const deload = deloads.get(week)!
    let factor = Math.min(pain ? 0.6 : deload.due ? 0.6 : 1, inSeason ? 0.7 : 1, upcoming ? 0.8 : 1)
    const restDay = !given && scheduled === 0
    let readiness =
      i === 0 && !restDay && minutes > 0
        ? dayReadiness(state, now, { pain, niggle: reports.length > 0, deload: deload.due, inSeason, hardSportBefore: hardBefore, hardSportNext: hardNext })
        : undefined
    // A push never lifts a day another rail has lightened, and then it does not say push.
    if (readiness?.level === 'push' && factor < 1) {
      readiness = { ...readiness, level: 'normal', reason: 'Your sets have been feeling easier than asked, but the day is kept lighter for what is coming up: a normal day, not a push.' }
    }
    if (readiness?.level === 'light') factor = Math.min(factor, READINESS_FACTOR.light)
    else if (readiness?.level === 'push' && factor === 1) factor = READINESS_FACTOR.push
    out.push({
      index: i,
      key: dayKey(start),
      start,
      at,
      week,
      minutes,
      restDay,
      sport: sportBetween(state.gym, start, addDays(start, 1)),
      ...(legsCovered ? { legsCovered } : {}),
      ...(upcoming ? { upcoming } : {}),
      ...(hardBefore ? { hardBefore } : {}),
      ...(hardNext ? { hardNext } : {}),
      reports,
      avoidJoints,
      pain,
      niggle,
      deload,
      ...(readiness ? { readiness } : {}),
      factor,
      off: new Set<Muscle>([...prefs.musclesOff, ...(legsCovered || upcoming ? LEG_MUSCLES : [])]),
      fatigue: fatigueAt(state, at).muscles,
    })
  }
  return out
}

/** Which skills train on each day: the rest rule first, then each family's weekly sessions on short days. */
function planSkills(state: AppState, prefs: TrainingPrefs, days: DayCtx[], now: number, skills: SkillId[]): SkillSlot[] {
  const g = prefs.goals
  const gymWeight = Math.max(g.strength, g.physique, g.power, g.endurance)
  const restMs = prefs.straightArmRestHours * HOUR
  const today = days[0].start
  const thisWeek = days[0].week
  // Today's own sessions do not rest today: a planche block done this
  // morning must not turn the rest of today's plan into something else.
  const beforeToday = lastHardStraightArm(state.sessions.filter((s) => s.startedAt < today), now)
  const lastAll = lastHardStraightArm(state.sessions, now)
  const last: Partial<Record<Straight, number>> = { ...lastAll }
  const done = hardCount(state.sessions, thisWeek, today)
  const planned = new Map<number, Record<Straight, number>>()
  const lead = skillFamily(skills[0])
  const target = (f: Straight) => (f === lead ? FAMILY_SESSIONS_LEAD : FAMILY_SESSIONS_OTHER)
  // Days after `i` this week a family could still train hard, spaced by the rest rule.
  const feasibleAfter = (f: Straight, i: number) => {
    let l = i === 0 ? lastAll[f] : last[f]
    let k = 0
    for (let j = i + 1; j < days.length && days[j].week === days[i].week; j++) {
      const dj = days[j]
      if (dj.restDay || dj.minutes <= 0) continue
      if (l === undefined || dj.at - l >= restMs) {
        k++
        l = dj.at
      }
    }
    return k
  }
  return days.map((d, i): SkillSlot => {
    const counts = planned.get(d.week) ?? { push: 0, pull: 0 }
    planned.set(d.week, counts)
    const base = d.week === thisWeek ? done : { push: 0, pull: 0 }
    const ref = i === 0 ? beforeToday : last
    const blocked = {
      push: ref.push !== undefined && d.at - ref.push < restMs,
      pull: ref.pull !== undefined && d.at - ref.pull < restMs,
    }
    const lastHard = { ...ref }
    const tally = () => ({ push: base.push + counts.push, pull: base.pull + counts.pull })
    if (d.restDay || d.minutes <= 0) {
      return { skillMin: 0, gymMin: 0, skills: [], families: new Set(), blocked, lastHard, noSkillFits: false, count: tally(), credit: {} }
    }
    const allowed = skills.filter((s) => {
      const f = skillFamily(s)
      return f === 'balance' || !blocked[f]
    })
    const wantsSkills = g.skills > 0 && allowed.length > 0
    const wantsGym = gymWeight > 0
    let skillMin = 0
    let short: SkillSlot['short']
    let urgent: Straight | undefined
    if (wantsSkills && wantsGym) {
      const share = Math.min(0.75, Math.max(0.25, g.skills / (g.skills + gymWeight)))
      if (d.minutes < 35) {
        // Short on time: one block, not two crumbs. Skills take it when their
        // share leads — or when a family needs this day to get its sessions in.
        const behind = (['push', 'pull'] as const).find(
          (f) => allowed.some((s) => skillFamily(s) === f) && target(f) - (base[f] + counts[f]) > feasibleAfter(f, i),
        )
        skillMin = share >= 0.5 || behind ? d.minutes : 0
        if (share < 0.5 && behind) urgent = behind
        short = skillMin ? 'skills' : 'gym'
      } else {
        skillMin = Math.max(15, Math.min(d.minutes - 20, Math.round((d.minutes * share) / 5) * 5))
      }
    } else if (wantsSkills) {
      skillMin = d.minutes
    }
    const block = skillMin > 0 ? allowed : []
    const families = new Set(block.map(skillFamily))
    for (const f of ['push', 'pull'] as const) {
      if (!families.has(f)) continue
      counts[f]++
      last[f] = Math.max(last[f] ?? 0, d.at)
    }
    const credit: Credit = {}
    for (const f of families) addCredit(credit, familyLoading(f), skillMin >= 25 ? 4 : 3)
    return {
      skillMin,
      gymMin: wantsGym ? d.minutes - skillMin : 0,
      skills: block,
      families,
      blocked,
      lastHard,
      ...(short ? { short } : {}),
      ...(urgent ? { urgent } : {}),
      noSkillFits: g.skills > 0 && allowed.length === 0,
      count: tally(),
      credit,
    }
  })
}

interface Path {
  foci: (GymFocus | null)[]
  serves: Muscle[][]
  P: Credit
  prev: Credit
  /** The previous day's gym sets alone, for the two-days-running rule. */
  prevGym: Credit
  last: Partial<Record<Muscle, number>>
  athletic: number
  score: number
}

interface GymCtx {
  targets: Record<Muscle, [number, number]>
  weights: Record<Muscle, number>
  lastHit: Partial<Record<Muscle, number>>
  power: number
  athleticWanted: number
  legsOff: boolean
  /** The first day of the horizon with a gym block. */
  nextGymDay: number
  /** The part of the body left longest (five days or more), which that next session goes to. */
  staleGroup?: 'lower' | 'push' | 'pull'
}

/** The foci that train a group left longest — the same ones the reason names. */
const TRAINS: Record<'lower' | 'push' | 'pull', GymFocus[]> = { lower: ['lower', 'full', 'athletic'], push: ['push', 'upper'], pull: ['pull', 'upper'] }

/** The group left longest as of `at`, when it has waited five days or more. */
function staleGroupAt(prefs: TrainingPrefs, lastHit: Partial<Record<Muscle, number>>, at: number): { f: 'lower' | 'push' | 'pull'; days: number } | undefined {
  const daysSince = (m: Muscle) => Math.min(STALE_CAP_DAYS, lastHit[m] === undefined ? STALE_CAP_DAYS : (at - lastHit[m]!) / DAY)
  return (['lower', 'push', 'pull'] as const)
    .map((f) => {
      const ms = FOCUS_MUSCLES[f].filter((m) => !prefs.musclesOff.includes(m))
      return { f, days: ms.length ? ms.reduce((sum, m) => sum + daysSince(m), 0) / ms.length : 0 }
    })
    .filter((x) => x.days >= 5)
    .sort((a, b) => b.days - a.days)[0]
}

const BEAM = 40
/** A muscle with this many sets in a day was worked hard that day (a planning line, not a measured one). */
export const HARD_SETS = 4

function gymCredit(d: DayCtx, slot: SkillSlot, focus: GymFocus): Credit {
  const sets = sessionSets(slot.gymMin, d.factor)
  const out: Credit = {}
  for (const [m, share] of Object.entries(FOCUS_SHARE[focus]) as [Muscle, number][]) if (!d.off.has(m)) out[m] = share * sets
  return out
}

/**
 * The gym focus of each day in one calendar week, chosen together (a beam
 * search over the days): weekly sets toward each muscle's target, the most
 * behind first and earliest, not the same muscles hard on consecutive days,
 * the part of the body left longest, and never against the day's skills or
 * sport. The weights are planning heuristics, not measurements.
 */
function allocate(
  days: DayCtx[],
  slots: SkillSlot[],
  idxs: number[],
  init: Pick<Path, 'P' | 'prev' | 'last' | 'athletic'> & { prevGym?: Credit; prevFocus?: GymFocus | null },
  ctx: GymCtx,
  fixed?: { index: number; focus: GymFocus | null; credit: Credit; prev: Credit; prevGym: Credit },
): Path {
  let paths: Path[] = [
    { foci: [], serves: [], P: { ...init.P }, prev: { ...init.prev }, prevGym: { ...(init.prevGym ?? {}) }, last: { ...init.last }, athletic: init.athletic, score: 0 },
  ]
  const gymDays = idxs.filter((i) => slots[i].gymMin > 0 && fixed?.index !== i)
  const step = (p: Path, i: number, focus: GymFocus | null, credit: Credit, prev: Credit, prevGym: Credit, served: Muscle[], gain: number): Path => {
    const P = { ...p.P }
    addCredit(P, credit)
    const last = { ...p.last }
    for (const [m, v] of Object.entries(credit) as [Muscle, number][]) if (v >= 1) last[m] = i
    return { foci: [...p.foci, focus], serves: [...p.serves, served], P, prev, prevGym, last, athletic: p.athletic + (focus === 'athletic' ? 1 : 0), score: p.score + gain }
  }
  for (const i of idxs) {
    const d = days[i]
    const slot = slots[i]
    const legs: Credit = {}
    for (const a of d.sport) if (a.legs) addCredit(legs, { quads: 1, hamstrings: 1, glutes: 1, calves: 1 }, activityLoad(a))
    if (fixed?.index === i) {
      const prev = { ...fixed.prev }
      addCredit(prev, legs)
      paths = paths.map((p) => step(p, i, fixed.focus, fixed.credit, prev, fixed.prevGym, [], 0))
      continue
    }
    if (slot.gymMin <= 0) {
      const prev = { ...slot.credit }
      addCredit(prev, legs)
      paths = paths.map((p) => step(p, i, null, slot.credit, prev, {}, [], 0))
      continue
    }
    const legsBlocked = Boolean(d.legsCovered || d.upcoming) || ctx.legsOff
    const S = sessionSets(slot.gymMin, d.factor)
    const ord = gymDays.indexOf(i)
    const open = FOCI.filter((f) => {
      if (!FOCUS_MUSCLES[f].some((m) => !d.off.has(m))) return false
      if (f === 'lower' && (legsBlocked || d.avoidJoints.includes('knees'))) return false
      // Speed and power: a goal, fresh legs, nothing hard the day before or
      // after, no pain, a full day — and never two days running.
      if (f === 'athletic') {
        return ctx.power >= 3 && !legsBlocked && !d.hardBefore && !d.hardNext && !d.pain && !d.avoidJoints.includes('knees') && d.factor >= 1
      }
      return true
    })
    // The next gym session goes to the part of the body left longest, when anything open today trains it.
    if (i === ctx.nextGymDay && ctx.staleGroup) {
      const group = ctx.staleGroup
      const trains = open.filter((f) => TRAINS[group].includes(f) && FOCUS_MUSCLES[group].some((m) => !d.off.has(m) && (FOCUS_SHARE[f][m] ?? 0) > 0))
      if (trains.length) open.splice(0, open.length, ...trains)
    }
    const penalty = (f: GymFocus) => {
      let x = 0
      if (f === 'push') x += slot.families.has('push') ? 1.2 : slot.blocked.push ? 0.25 : 0
      if (f === 'push' && d.avoidJoints.includes('wrists')) x += 0.35
      if (f === 'pull') x += slot.families.has('pull') ? 1.2 : slot.blocked.pull ? 0.25 : 0
      if (f === 'upper' && (slot.families.has('push') || slot.families.has('pull'))) x += 0.5
      if (f === 'full' && legsBlocked) x += 0.2
      return x * S
    }
    const staleDays = (m: Muscle, p: Path) =>
      p.last[m] !== undefined
        ? Math.min(STALE_CAP_DAYS, i - p.last[m]!)
        : Math.min(STALE_CAP_DAYS, ctx.lastHit[m] === undefined ? STALE_CAP_DAYS : (d.at - ctx.lastHit[m]!) / DAY)
    const next: Path[] = []
    for (const p of paths) {
      const choices = open.filter((f) => f !== 'athletic' || (p.athletic < ctx.athleticWanted && p.foci[p.foci.length - 1] !== 'athletic'))
      // Not the same focus, nor the same muscles hard, in the gym two days running — while anything else is open.
      const lastFocus = p.foci.length ? p.foci[p.foci.length - 1] : (init.prevFocus ?? null)
      const clash = (f: GymFocus) =>
        f === lastFocus || (Object.entries(gymCredit(d, slot, f)) as [Muscle, number][]).some(([m, c]) => c >= HARD_SETS && (p.prevGym[m] ?? 0) >= HARD_SETS)
      const calm = choices.filter((f) => !clash(f))
      for (const f of calm.length ? calm : choices.length ? choices : (['full'] as GymFocus[])) {
        const credit = gymCredit(d, slot, f)
        const have = { ...p.P }
        addCredit(have, slot.credit)
        let need = 0
        let band = 0
        let over = 0
        const served: [Muscle, number][] = []
        for (const [m, c] of Object.entries(credit) as [Muscle, number][]) {
          const [lo, hi] = ctx.targets[m]
          const w = ctx.weights[m]
          const h = have[m] ?? 0
          const met = Math.max(0, Math.min(lo, h + c) - Math.min(lo, h))
          need += w * met
          if (met >= 0.5) served.push([m, w * met])
          band += w * Math.max(0, Math.min(hi, h + c) - Math.max(lo, h))
          over += Math.max(0, h + c - hi) - Math.max(0, h - hi)
        }
        // The most behind first and earliest: a later day may not happen.
        let gain = need * (1 + 0.03 * (gymDays.length - 1 - ord)) + 0.3 * band - 0.5 * over
        for (const [m, c] of Object.entries(credit) as [Muscle, number][]) gain -= 0.8 * Math.min(p.prev[m] ?? 0, c)
        for (const [m, share] of Object.entries(FOCUS_SHARE[f]) as [Muscle, number][]) if (!d.off.has(m)) gain -= 1.5 * share * (d.fatigue[m] ?? 0)
        const main = FOCUS_MUSCLES[f].filter((m) => !d.off.has(m))
        if (main.length) gain += (STALE_WEIGHT * main.reduce((sum, m) => sum + staleDays(m, p), 0)) / main.length
        gain -= penalty(f)
        if (f === 'athletic') gain += (ctx.power / 5) * 0.8 * S
        const dayCredit = { ...slot.credit }
        addCredit(dayCredit, credit)
        const prev = { ...dayCredit }
        addCredit(prev, legs)
        next.push(step(p, i, f, dayCredit, prev, credit, served.sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]), gain))
      }
    }
    next.sort((a, b) => b.score - a.score)
    paths = next.slice(0, BEAM)
  }
  return paths[0]
}

export interface WeekDayPlan {
  /** Local calendar day, YYYY-MM-DD. */
  day: string
  at: number
  plan: TodayPlan
  /** Short lines for the week view: why this day looks the way it does. */
  why: string[]
  /** Sport on this day, logged or from the sport week. */
  sport?: SportEvent
  /** The day whose work moved here because it was missed. */
  movedFrom?: string
}

/** A planned day this week that passed with nothing logged, and what the week did about it. */
export interface MissedDay {
  day: string
  at: number
  /** What it held, in a few words ("Planche + pull"). */
  planned: string
  text: string
}

export interface WeekAhead {
  /** Today and the six days after it. */
  days: WeekDayPlan[]
  missed: MissedDay[]
  /** Muscles the days left cannot bring to this week's target, least important first. */
  shortfall: Muscle[]
  /** Hard sessions of each straight-arm family this week: done before today, planned from today, and the convention's target. */
  frequency: { family: Straight; skills: SkillId[]; done: number; planned: number; target: number }[]
}

const covers = (by: GymFocus, focus: GymFocus) =>
  by === focus || (by === 'upper' && (focus === 'push' || focus === 'pull')) || (by === 'full' && focus !== 'athletic' && focus !== 'upper')

function stateBefore(state: AppState, t: number): AppState {
  const gym = state.gym
  return {
    ...state,
    sessions: state.sessions.filter((s) => s.startedAt < t),
    symptoms: (state.symptoms ?? []).filter((e) => e.at < t),
    ...(gym
      ? {
          gym: {
            ...gym,
            sessions: gym.sessions.filter((s) => s.startedAt < t),
            ...(gym.activities ? { activities: gym.activities.filter((a) => a.at < t || a.updatedAt < t) } : {}),
          },
        }
      : {}),
  }
}

/** "planche + pull" — a day in a few words. */
function describe(plan: TodayPlan): string {
  return [plan.skill ? joinNames(plan.skill.skills.map(skillName)) : '', plan.gym ? FOCUS_LABEL[plan.gym.focus].toLowerCase() : ''].filter(Boolean).join(' + ')
}

/**
 * The week from today: each day's skills and gym focus and why, planned
 * together and again from what actually happened. `todayMinutes` is "I have
 * X minutes" for today. Pure: state and time in, plan out.
 */
export function planWeekAhead(state: AppState, now = Date.now(), opts: { todayMinutes?: number; inner?: boolean } = {}): WeekAhead {
  const prefs: TrainingPrefs = state.gym?.prefs ?? defaultPrefs(now)
  const skills = (state.profile.skills?.length ? state.profile.skills : ['planche']) as SkillId[]
  const today = startOfDay(now)
  const thisWeek = weekStart(now)
  const nextWeek = addDays(thisWeek, 7)
  const horizonEnd = addDays(today, 7) > nextWeek ? addDays(nextWeek, 7) : nextWeek
  const days = dayContexts(state, prefs, now, horizonEnd, opts.todayMinutes)
  const slots = planSkills(state, prefs, days, now, skills)
  const gymSessions = state.gym?.sessions ?? []
  const targets = {} as Record<Muscle, [number, number]>
  const weights = {} as Record<Muscle, number>
  for (const m of MUSCLES) {
    targets[m.id] = volumeTarget(m.id, prefs)
    weights[m.id] = prefs.musclesOff.includes(m.id) ? 0 : prefs.musclesPriority.includes(m.id) ? 1.5 : m.sub ? 0.5 : 1
  }
  const g = prefs.goals
  const ctx: GymCtx = {
    targets,
    weights,
    lastHit: lastTrainedAt(state, now),
    power: g.power,
    athleticWanted: g.power >= 4 ? 2 : g.power >= 3 ? 1 : 0,
    legsOff: LEG_MUSCLES.every((m) => prefs.musclesOff.includes(m)),
    nextGymDay: slots.findIndex((sl) => sl.gymMin > 0),
  }
  if (ctx.nextGymDay >= 0) {
    const stale = staleGroupAt(prefs, ctx.lastHit, days[ctx.nextGymDay].at)
    if (stale) ctx.staleGroup = stale.f
  }
  const cur = days.filter((d) => d.week === thisWeek).map((d) => d.index)
  const nxt = days.filter((d) => d.week !== thisWeek).map((d) => d.index)
  // Today's slot is chosen from what was done before today, so it holds still once started.
  // Yesterday as it happened: the two-days-running rule reaches back past today.
  const yesterday = addDays(today, -1)
  const first = allocate(
    days,
    slots,
    cur,
    {
      P: setsPerMuscle(state.sessions, gymSessions, thisWeek, today),
      prev: setsPerMuscle(state.sessions, gymSessions, yesterday, today),
      prevGym: setsPerMuscle([], gymSessions, yesterday, today),
      last: {},
      athletic: athleticCount(state, thisWeek, today),
    },
    ctx,
  )
  const todayFocus = first.foci[0] ?? null
  const skillDone = state.sessions.some((s) => s.startedAt >= today && s.startedAt <= now)
  const gymDone = gymSessions.some((s) => s.startedAt >= today && s.startedAt <= now)
  let week = first
  if (skillDone || gymDone) {
    // The rest of the week, from what actually happened today.
    const remaining: Credit = {}
    if (!skillDone) addCredit(remaining, slots[0].credit)
    if (!gymDone && todayFocus && slots[0].gymMin > 0) addCredit(remaining, gymCredit(days[0], slots[0], todayFocus))
    const prev = setsPerMuscle(state.sessions, gymSessions, today, now + 1)
    addCredit(prev, remaining)
    const prevGym = setsPerMuscle([], gymSessions, today, now + 1)
    if (!gymDone && todayFocus && slots[0].gymMin > 0) addCredit(prevGym, gymCredit(days[0], slots[0], todayFocus))
    week = allocate(
      days,
      slots,
      cur,
      {
        P: setsPerMuscle(state.sessions, gymSessions, thisWeek, now + 1),
        prev: setsPerMuscle(state.sessions, gymSessions, yesterday, today),
        prevGym: setsPerMuscle([], gymSessions, yesterday, today),
        last: {},
        athletic: athleticCount(state, thisWeek, now + 1),
      },
      ctx,
      { index: 0, focus: todayFocus, credit: remaining, prev, prevGym },
    )
  }
  const later = nxt.length
    ? allocate(days, slots, nxt, { P: {}, prev: week.prev, prevGym: week.prevGym, prevFocus: week.foci[week.foci.length - 1] ?? null, last: week.last, athletic: 0 }, ctx)
    : undefined
  const focusOf = (i: number): GymFocus | null => (cur.includes(i) ? week.foci[cur.indexOf(i)] : later?.foci[nxt.indexOf(i)] ?? null)
  const servesOf = (i: number): Muscle[] => (i === 0 ? first.serves[0] : cur.includes(i) ? week.serves[cur.indexOf(i)] : later?.serves[nxt.indexOf(i)] ?? [])

  const shortfall = MUSCLES.map((m) => m.id)
    .filter((m) => PLANNABLE.has(m) && targets[m][0] > 0 && (week.P[m] ?? 0) < targets[m][0] - 0.5)
    .sort((a, b) => weights[a] - weights[b] || targets[b][0] - (week.P[b] ?? 0) - (targets[a][0] - (week.P[a] ?? 0)))
  const doneHard = hardCount(state.sessions, thisWeek, today)
  const frequency = (['push', 'pull'] as const)
    .filter((f) => skills.some((s) => skillFamily(s) === f))
    .map((f) => ({
      family: f,
      skills: skills.filter((s) => skillFamily(s) === f),
      done: doneHard[f],
      planned: cur.filter((i) => slots[i].families.has(f)).length,
      target: skillFamily(skills[0]) === f ? FAMILY_SESSIONS_LEAD : FAMILY_SESSIONS_OTHER,
    }))

  const weekSets = setsPerMuscle(state.sessions, gymSessions, thisWeek, now)
  const out: WeekDayPlan[] = days.slice(0, 7).map((d) => {
    const slot = slots[d.index]
    const focus = slot.gymMin > 0 ? focusOf(d.index) : null
    const plan = assembleDay(state, prefs, d, slot, focus, d.index === 0 ? weekSets : null, ctx.lastHit, skills)
    return {
      day: d.key,
      at: d.at,
      plan,
      why: whyFor(d, slot, plan, servesOf(d.index), prefs),
      ...(d.sport.length ? { sport: d.sport[d.sport.length - 1] } : {}),
    }
  })

  // Missed days: what each held, and where its work went.
  const missed: MissedDay[] = []
  if (!opts.inner && state.gym?.prefs) {
    const remaining = out.filter((p) => weekStart(p.at) === thisWeek && !p.plan.rest)
    const within = (x: number, from: number, to: number) => x >= from && x < to
    const trainedOn = (t: number) =>
      state.sessions.some((s) => within(s.startedAt, t, addDays(t, 1))) || gymSessions.some((s) => within(s.startedAt, t, addDays(t, 1)))
    const scheduledOn = (t: number) => (prefs.minutesByDay[new Date(t).getDay()] ?? 0) > 0
    // A session moved to a day off is not a missed one: each training day off the schedule makes up one miss.
    let madeUp = 0
    for (let t = thisWeek; t < today; t = addDays(t, 1)) if (!scheduledOn(t) && trainedOn(t)) madeUp++
    for (let t = thisWeek; t < today; t = addDays(t, 1)) {
      if (!scheduledOn(t) || trainedOn(t)) continue
      if (madeUp > 0) {
        madeUp--
        continue
      }
      // Only for an athlete who was training: a first week is not a list of misses.
      const from = addDays(t, -14)
      const active =
        state.sessions.some((s) => within(s.startedAt, from, t)) ||
        gymSessions.some((s) => within(s.startedAt, from, t)) ||
        (state.gym.activities ?? []).some((a) => within(a.at, from, t))
      if (!active) continue
      const was = planWeekAhead(stateBefore(state, t), fivePm(t), { inner: true }).days[0].plan
      if (was.rest || (!was.skill && !was.gym)) continue
      const parts: string[] = []
      if (was.gym) {
        const f = was.gym.focus
        const same = remaining.find((p) => p.plan.gym?.focus === f)
        const to = same ?? remaining.find((p) => p.plan.gym && covers(p.plan.gym.focus, f))
        if (to) {
          to.movedFrom = to.movedFrom ?? dayName(t)
          const where = to.at === now ? 'today' : dayName(to.at)
          parts.push(
            same
              ? `${FOCUS_LABEL[f].toLowerCase()} moves to ${where}`
              : `its ${FOCUS_LABEL[f].toLowerCase()} work goes into ${where === 'today' ? 'today’s' : `${where}’s`} ${FOCUS_LABEL[to.plan.gym!.focus].toLowerCase()} session`,
          )
        } else {
          parts.push(`${FOCUS_LABEL[f].toLowerCase()} drops this week — the days left go to what is furthest behind`)
        }
      }
      for (const f of ['push', 'pull', 'balance'] as const) {
        const names = (was.skill?.skills ?? []).filter((s) => skillFamily(s) === f).map(skillName)
        if (!names.length) continue
        const nextDay = remaining.find((p) => (p.plan.skill?.skills ?? []).some((s) => skillFamily(s) === f))
        parts.push(`${joinNames(names)} ${nextDay ? (nextDay.at === now ? 'is on today' : `is next on ${dayName(nextDay.at)}`) : 'waits for next week'}`)
      }
      const planned = cap([was.skill ? joinNames(was.skill.skills.map(skillName)) : '', was.gym ? FOCUS_LABEL[was.gym.focus].toLowerCase() : ''].filter(Boolean).join(' + '))
      missed.push({ day: dayKey(t), at: t, planned, text: `${dayName(t)}’s session (${planned}) did not happen: ${joinNames(parts)}.` })
    }
    // Today's reasons say so near the top: after a pain report, before the rest.
    if (missed.length && !out[0].plan.rest) {
      const lines = missed.map((m) => m.text)
      const short = shortfall.slice(0, 3).map((m) => MUSCLE_BY_ID[m].label.toLowerCase())
      if (short.length) lines.push(`Not every weekly target fits in the days left: ${joinNames(short)} end the week short — the least important go first.`)
      out[0].plan.reasons.splice(days[0].reports.length ? 1 : 0, 0, ...lines)
    }
  }
  // Today's reasons end with the rest of the week, so today reads as part of it.
  const rest = out.slice(1).filter((p) => weekStart(p.at) === thisWeek && !p.plan.rest && (p.plan.skill || p.plan.gym))
  if (!out[0].plan.rest && rest.length) {
    out[0].plan.reasons.push(
      `The rest of this week: ${rest.map((p) => `${dayName(p.at)} ${describe(p.plan)}`).join(', ')}. Spread so each muscle gets its weekly sets across your training days without the same muscles worked hard two days running — coaching conventions, and the week is planned again from what you log.`,
    )
  }
  return { days: out, missed, shortfall, frequency }
}

/** One day's plan and its reasons, from the week's decisions for it. */
function assembleDay(
  state: AppState,
  prefs: TrainingPrefs,
  d: DayCtx,
  slot: SkillSlot,
  focus: GymFocus | null,
  weekSets: Credit | null,
  lastHit: Partial<Record<Muscle, number>>,
  skills: SkillId[],
): TodayPlan {
  if (d.restDay) {
    return { minutes: 0, rest: true, reasons: ['A rest day in your schedule. If you do have time after all, pick how many minutes and a session is built for them.'] }
  }
  const reasons: string[] = []
  const recent = d.reports[d.reports.length - 1]
  if (recent) {
    const where = d.avoidJoints.length ? d.avoidJoints.join(' and ') : 'the sore area'
    reasons.push(
      d.pain
        ? `You reported pain in ${where}: today leaves out anything that loads it and stays light. Never train through pain — if it keeps coming back, tell a parent, coach or physio.`
        : `You mentioned a niggle in ${where}: today steers round it.`,
    )
  }
  // Straight-arm rest rule: hard sessions of one family at least N hours apart.
  const restH = prefs.straightArmRestHours
  for (const family of ['push', 'pull'] as const) {
    if (!slot.blocked[family]) continue
    const hours = Math.round((d.at - slot.lastHard[family]!) / HOUR)
    const names = skills.filter((s) => skillFamily(s) === family).map(skillName)
    if (names.length) reasons.push(`Your last hard ${joinNames(names)} session was ${hours}h ago — under your ${restH}h rest rule for straight-arm work, so ${names.length > 1 ? 'they rest' : 'it rests'} today.`)
  }
  const skillBlock = slot.skillMin > 0 ? { minutes: slot.skillMin, skills: slot.skills } : undefined
  const g = prefs.goals
  const wantsGym = Math.max(g.strength, g.physique, g.power, g.endurance) > 0
  if (skillBlock && slot.gymMin > 0) reasons.push('Skill work comes first, while you are fresh; the gym follows.')
  if (skillBlock && conservative(state.profile, d.at) && slot.skills.some((s) => skillFamily(s) !== 'balance')) {
    reasons.push('Warm wrists, elbows and shoulders up fully before the holds — the session starts with it, so do not skip it.')
  }
  if (slot.noSkillFits) reasons.push('No skill work fits today’s rest rules, so the time goes to the gym.')
  if (slot.urgent) {
    const names = skills.filter((s) => skillFamily(s) === slot.urgent).map(skillName)
    const n = slot.urgent === skillFamily(skills[0]) ? FAMILY_SESSIONS_LEAD : FAMILY_SESSIONS_OTHER
    reasons.push(`A short day goes to one block: skills, because ${joinNames(names)} needs it to get ${n} hard sessions in this week (a coaching convention for skill frequency).`)
  }
  const base = { minutes: d.minutes, rest: false, ...(skillBlock ? { skill: skillBlock } : {}) }
  // Readiness scales the gym block; a skills-only day is the skill coach's call, from its own check-in.
  if (slot.gymMin <= 0 || !wantsGym || !focus) return { ...base, reasons }
  // Speed and power work is done fresh for quality: a push day never adds to it.
  const factor = focus === 'athletic' ? Math.min(1, d.factor) : d.factor
  const readiness =
    d.readiness && focus === 'athletic' && d.readiness.level === 'push'
      ? { ...d.readiness, reason: d.readiness.reason.replace('one more set on each lift, same weights', 'speed and power work keeps its usual dose — it is done fresh, for quality, not volume') }
      : d.readiness

  const muscles = FOCUS_MUSCLES[focus].filter((m) => !prefs.musclesOff.includes(m))
  // Say so when the part of the body left longest is what the day is for.
  const daysSince = (m: Muscle) => Math.min(STALE_CAP_DAYS, lastHit[m] === undefined ? STALE_CAP_DAYS : (d.at - lastHit[m]!) / DAY)
  const staleness = (ms: Muscle[]) => (ms.length ? ms.reduce((sum, m) => sum + daysSince(m), 0) / ms.length : 0)
  const groupStale = (['lower', 'push', 'pull'] as GymFocus[])
    .map((f) => ({ f, days: staleness(FOCUS_MUSCLES[f].filter((m) => !prefs.musclesOff.includes(m))) }))
    .filter((x) => x.days >= 5)
    .sort((a, b) => b.days - a.days)[0]
  if (
    groupStale &&
    (focus === groupStale.f ||
      ((focus === 'full' || focus === 'athletic') && groupStale.f === 'lower') ||
      (focus === 'upper' && groupStale.f !== 'lower'))
  ) {
    const name = groupStale.f === 'lower' ? 'Legs' : groupStale.f === 'push' ? 'Chest, shoulders and triceps' : 'Back and biceps'
    const n = Math.round(groupStale.days)
    reasons.push(`${name} ${n >= STALE_CAP_DAYS ? 'have not been trained in two weeks or more' : `were last trained ${n} days ago`} — today’s gym session goes there. Pick a different focus on the Gym side to override it.`)
  }
  if (focus === 'athletic') {
    reasons.push('Speed and power today: your legs are fresh — nothing hard yesterday or tomorrow — and explosiveness is one of your goals. Jumps and sprints come first, before anything tiring.')
  }
  const covered = d.legsCovered
  if (covered) {
    const what = covered.scheduled ? `Your usual ${sportName(covered.kind)}` : covered.kind === 'pe' ? 'PE' : cap(covered.kind)
    const when = d.at - covered.at < DAY ? 'today or yesterday' : 'in the last two days'
    reasons.push(`${what} ${when} already loaded your legs — no leg work in the gym today.${covered.scheduled ? ' (Counted from your sport week; log it if it went differently.)' : ''}`)
  }
  if (slot.families.has('push') && focus !== 'push' && focus !== 'upper' && focus !== 'full') {
    reasons.push('Planche-type holds and pressing share the front delts, wrists and elbows, so the gym side avoids heavy pressing today.')
  } else if (slot.families.has('pull') && focus !== 'pull' && focus !== 'upper' && focus !== 'full') {
    reasons.push('Front lever work and rows or pull-ups share the lats and elbows, so the gym side avoids heavy pulling today.')
  }
  if (weekSets) {
    const short = muscles
      .map((m) => ({ m, sets: weekSets[m] ?? 0, target: volumeTarget(m, prefs) }))
      .filter((x) => x.target[1] > 0 && x.sets < x.target[0])
      .sort((a, b) => a.sets / a.target[0] - b.sets / b.target[0])
      .slice(0, 2)
    if (short.length) {
      reasons.push(
        `Under this week’s target: ${joinNames(
          short.map((x) => `${MUSCLE_BY_ID[x.m].label.toLowerCase()} (${Math.round(x.sets)} of ${x.target[0]}–${x.target[1]} sets)`),
        )}.`,
      )
    }
  }
  if (d.deload.due && d.deload.why) reasons.push(d.deload.why)
  const upcoming = d.upcoming
  if (upcoming) {
    const what = upcoming.scheduled ? `Your usual ${sportName(upcoming.kind)}` : upcoming.kind === 'pe' ? 'PE' : upcoming.kind === 'other' ? 'Your activity' : `Your ${upcoming.kind}`
    reasons.push(`${what} ${upcoming.at - d.at < 18 * HOUR ? 'is coming up soon' : 'is tomorrow'}: legs stay fresh — no leg work today, and the gym is a little lighter.`)
  }
  if (prefs.season === 'in') reasons.push('In season: the sport comes first, so the gym keeps the weights but drops some sets.')
  const legMuscles = d.legsCovered || d.upcoming ? LEG_MUSCLES : []
  return {
    ...base,
    ...(readiness ? { readiness } : {}),
    gym: {
      minutes: slot.gymMin,
      focus,
      avoidJoints: d.avoidJoints,
      volumeFactor: factor,
      deload: d.deload.due,
      musclesOff: [...new Set([...prefs.musclesOff, ...legMuscles])],
    },
    reasons,
  }
}

/** The short lines the week view shows under a day. */
function whyFor(d: DayCtx, slot: SkillSlot, plan: TodayPlan, serves: Muscle[], prefs: TrainingPrefs): string[] {
  const why: string[] = []
  const sport = d.sport[d.sport.length - 1]
  if (plan.rest) {
    why.push(sport ? `No gym or skills: your ${sportName(sport.kind)} day.` : 'Rest day in your schedule.')
    return why
  }
  const skills = plan.skill?.skills ?? []
  for (const f of ['push', 'pull'] as const) {
    const names = skills.filter((s) => skillFamily(s) === f).map(skillName)
    if (names.length) why.push(`${cap(joinNames(names))}: hard session ${slot.count[f]} of the week.`)
  }
  const balance = skills.filter((s) => skillFamily(s) === 'balance').map(skillName)
  if (balance.length) why.push(`${cap(joinNames(balance))}: balance practice.`)
  for (const f of ['push', 'pull'] as const) {
    if (slot.blocked[f]) why.push(`${f === 'push' ? 'Push' : 'Pull'} skills rest: under ${prefs.straightArmRestHours} h since the last hard session.`)
  }
  if (slot.urgent) why.push('Short day: all skills, to get this week’s sessions in.')
  else if (slot.short === 'gym' && plan.gym) why.push('Short day: one block — the gym.')
  if (plan.gym) {
    const label = FOCUS_LABEL[plan.gym.focus]
    if (plan.gym.focus === 'athletic') why.push(`${label}: fresh legs, and explosiveness is a goal.`)
    else why.push(serves.length ? `${label}: ${joinNames(serves.map((m) => MUSCLE_BY_ID[m].label.toLowerCase()))} furthest from this week’s sets.` : `${label}: keeps the week balanced.`)
  }
  if (d.legsCovered) why.push(`Legs out of the gym: ${d.legsCovered.scheduled ? 'your usual ' : ''}${sportName(d.legsCovered.kind)} ${startOfDay(d.legsCovered.at) === d.start ? 'today' : 'the day before'}.`)
  else if (d.upcoming) why.push(`Legs stay fresh for the ${sportName(d.upcoming.kind)} ${startOfDay(d.upcoming.at) === d.start ? 'later today' : 'tomorrow'}.`)
  if (plan.readiness?.level === 'light') why.push('A light day.')
  else if (plan.readiness?.level === 'push') why.push(plan.gym && plan.gym.volumeFactor > 1 ? 'A push day: one more set on each lift.' : 'A push day — speed work keeps its usual dose.')
  return why
}

/**
 * Today's plan: how the minutes split between skill work and the gym, which
 * skills and which gym focus, and why — today's slot of the week plan, planned
 * again from what actually happened. Pure: state and time in, plan out.
 */
export function planToday(state: AppState, opts: { now?: number; minutes?: number } = {}): TodayPlan {
  return planWeekAhead(state, opts.now ?? Date.now(), { todayMinutes: opts.minutes }).days[0].plan
}

export type GoalPace = { status: 'reached' | 'on-pace' | 'possible' | 'behind' | 'unknown'; text: string }

/** Whether a dated skill goal is on pace — or that the app cannot tell yet. */
export function skillGoalPace(state: AppState, goal: SkillGoal, now = Date.now()): GoalPace {
  const target = STEP_BY_ID[goal.stepId]
  if (!target) return { status: 'unknown', text: 'Not a step this app knows.' }
  const view = skillView(state, goal.skill)
  const current = STEP_BY_ID[view.stepId]
  if (!current) return { status: 'unknown', text: 'Not started on this skill yet.' }
  if (view.unlocked.includes(goal.stepId) && current.order > target.order) return { status: 'reached', text: `Reached ${target.name}.` }
  const [y, m, d] = goal.by.split('-').map(Number)
  const weeksLeft = (new Date(y, m - 1, d, 23, 59).getTime() - now) / WEEK
  if (weeksLeft <= 0) return { status: 'behind', text: `The date has passed — set a new one.` }
  let range: { low: number; high: number | null } | null = null
  let why = ''
  if (current.id === target.id) {
    const f = forecastUnlock(view, target.id, now)
    if (f.kind === 'ready') return { status: 'on-pace', text: `Your holds already clear ${target.name}'s bar — time to test it.` }
    if (f.kind === 'range') range = { low: f.lowWeeks, high: f.highWeeks }
    else why = 'need' in f ? String(f.need) : 'the recent holds are not trending up'
  } else if (current.order < target.order) {
    const o = goalOutlook({ ...view, profile: { ...view.profile, goalStepId: target.id } }, now)
    if (o.estimate) range = { low: o.estimate.lowWeeks, high: o.estimate.highWeeks }
    else why = o.note
  }
  if (!range) return { status: 'unknown', text: `Can't tell yet whether ${Math.ceil(weeksLeft)} weeks is enough: ${why || 'not enough history'}.` }
  if (range.high !== null && range.high <= weeksLeft) return { status: 'on-pace', text: `On pace: about ${range.low}–${range.high} weeks at your current rate, ${Math.floor(weeksLeft)} left.` }
  if (range.low > weeksLeft) return { status: 'behind', text: `Behind: about ${range.low}${range.high !== null ? `–${range.high}` : '+'} weeks at your current rate, ${Math.floor(weeksLeft)} left.` }
  return { status: 'possible', text: `Possible: ${range.low}${range.high !== null ? `–${range.high}` : '+'} weeks at your current rate, ${Math.floor(weeksLeft)} left.` }
}

/**
 * The next seven days, from the week plan: each day's skills, gym focus and
 * why. Every real day is planned again from what actually happened.
 */
export function planWeek(state: AppState, now = Date.now()): WeekDayPlan[] {
  return planWeekAhead(state, now).days
}
