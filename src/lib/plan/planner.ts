import { MUSCLE_BY_ID, MUSCLES, type Joint, type Muscle } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { STEP_BY_ID } from '../../data/progressions'
import { missingKit } from '../../data/skills'
import { finalizeWorkout } from '../../data/workouts'
import type { AppState, BodyRegion, EquipmentId, LineupRole, Session, SkillId } from '../../types'
import { forecastUnlock, goalOutlook } from '../forecast'
import { todaysLineup } from '../lineup'
import { fullParts, shortDoses } from '../sessionRoom'
import { readinessTimeline } from '../signals'
import { skillView } from '../skills'
import { addDays, dayKey, weekStart } from '../time'
import { readDay, weekdayOf } from '../weekPlan'
import { buildGymSession, FOCUS_LABEL, focusOpen, type GymFocus } from '../gym/builder'
import { conservative } from '../gym/draft'
import { estimateOneRepMax } from '../gym/progression'
import { defaultPrefs } from '../gym/state'
import type { GymLocation, SkillGoal, TrainingPrefs } from '../gym/types'
import {
  activityLoad,
  familyEvents,
  familyLoading,
  fatigueAt,
  lastTrainedAt,
  setsPerMuscle,
  skillSetLoading,
  volumeTarget,
  type Credit,
  type FamilyEvent,
} from './load'
import { dayReadiness, MIN_RATED_SETS, READINESS_FACTOR, type DayReadiness } from './readiness'
import { isHardForLegs, isHardSport, sportBetween, sportName, type SportEvent } from './sport'

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

/**
 * The smallest skill block the session builder keeps to, by how many skills
 * the block holds — measured, not chosen (2026-11-22: `finalizeWorkout` over
 * thirteen athletes, one to five skills, steps from foundations to advanced
 * tuck, both ages, budgets from 10 to 90 minutes). One skill never built under
 * 16 minutes and kept to every budget from 18; two built 21–23 minutes under
 * 25 and kept to every budget from 25; a third gets no work below 30
 * (`shortDoses`). A block is never planned smaller: the session it starts
 * would run past the day's minutes.
 */
export const MIN_SKILL_MINUTES = { 1: 18, 2: 25, 3: 30 } as const
/** The smallest gym block planned: a warm-up and two movements. */
export const MIN_GYM_MINUTES = 20
/**
 * A gym day's skill opener: one skill's ordinary session at the smallest size
 * the builder keeps to (`MIN_SKILL_MINUTES[1]`), so the gym stays the main
 * session of the day.
 */
export const OPENER_MINUTES = MIN_SKILL_MINUTES[1]

/** Skills a skill block of this length holds, as the line-up counts them: a lead, a partner, one short dose. */
function roomFor(minutes: number): number {
  if (minutes < MIN_SKILL_MINUTES[1]) return 0
  return fullParts(minutes) < 2 ? 1 : 2 + Math.min(1, shortDoses(minutes))
}

/** Which straight-arm family a skill's hard work belongs to. The handstand is balance work. */
export function skillFamily(skill: SkillId): 'push' | 'pull' | 'balance' {
  if (skill === 'planche' || skill === 'ninety') return 'push'
  if (skill === 'frontlever' || skill === 'flag') return 'pull'
  return 'balance'
}

type Straight = 'push' | 'pull'

const REGION_JOINT: Partial<Record<BodyRegion, Joint>> = {
  wrist: 'wrists',
  elbow: 'elbows',
  shoulder: 'shoulders',
  'lower-back': 'lower-back',
  knee: 'knees',
  hip: 'hips',
  ankle: 'ankles',
}

/** The joints each straight-arm family loads hardest (INFERENCE from the positions). */
const FAMILY_JOINTS: Record<Straight, Joint[]> = { push: ['wrists', 'elbows', 'shoulders'], pull: ['elbows', 'shoulders'] }

export interface SoreJoints {
  /** Joints named in a report that was not "all good" in the last 72 hours. */
  joints: Joint[]
  /** Pain, not a niggle, in the last 48 hours: the day stays light. */
  pain: boolean
  /** The latest such report. */
  lastAt?: number
}

/**
 * What a gym session built on the Gym side follows. "Auto" is today's plan —
 * its focus, its lighter-day factor and the legs it keeps out for sport — and
 * the pain memory holds whichever focus is picked (an Upper body pick once got
 * barbell presses the day after an elbow report); an explicit pick keeps only
 * the athlete's own switched-off muscles beside it.
 */
export function gymSessionInputs(
  focus: GymFocus | 'auto',
  planned: TodayPlan['gym'],
  musclesOff: Muscle[],
  sore: SoreJoints,
): { focus?: GymFocus; musclesOff: Muscle[]; avoidJoints: Joint[]; volumeFactor: number } {
  const avoidJoints = [...new Set([...(planned?.avoidJoints ?? []), ...sore.joints])]
  if (focus === 'auto' && planned) {
    return { focus: planned.focus, musclesOff: planned.musclesOff, avoidJoints, volumeFactor: planned.volumeFactor }
  }
  return {
    ...(focus === 'auto' ? {} : { focus }),
    musclesOff,
    avoidJoints,
    volumeFactor: Math.min(planned?.volumeFactor ?? 1, sore.pain ? 0.6 : 1),
  }
}

/**
 * The pain memory every gym session obeys, whoever builds it: the union of
 * every report that was not "all good" in the last 72 hours (never only the
 * latest), the same reading the week plan uses day by day.
 */
export function soreJoints(state: AppState, now: number): SoreJoints {
  const reports = readinessTimeline(state, now).filter((a) => a.at <= now && now - a.at < 72 * HOUR && a.joints !== 'good')
  const joints = [...new Set(reports.flatMap((a) => a.regions ?? []).map((r) => REGION_JOINT[r]).filter((j): j is Joint => Boolean(j)))]
  return {
    joints,
    pain: reports.some((a) => a.joints === 'pain' && now - a.at < 48 * HOUR),
    ...(reports.length ? { lastAt: Math.max(...reports.map((a) => a.at)) } : {}),
  }
}

/** What a gym day's opener is decided from. */
interface OpenerDay {
  /** The day's minutes: the opener and the gym together. */
  minutes: number
  sore: Joint[]
  pain: boolean
  /** Whether the family's rest rule allows a hard session of it today (the gym day itself is today's). */
  clear: (family: Straight) => boolean
}

const trainedSkills = (state: AppState) => (state.profile.skills?.length ? state.profile.skills : ['planche']) as SkillId[]

/**
 * The skill a gym day of this focus opens with, or none: the athlete's
 * highest-priority skill of a family the focus trains hard — push days the
 * planche or 90° hold, pull days the front lever or flag, upper days either —
 * whose kit is at the place and in the athlete's own kit list (the session is
 * built from that list). Only with skills among the goals, no pain, no sore
 * joint the family loads, the family's rest rule clear and room for both
 * blocks. Lower, full-body and speed days open with nothing. Shared recovery
 * is CONSENSUS; the shared joints are INFERENCE from the positions.
 */
function openerSkill(state: AppState, focus: GymFocus, location: GymLocation, day: OpenerDay): SkillId | undefined {
  const goals = state.gym?.prefs?.goals ?? defaultPrefs(0).goals
  if (goals.skills <= 0 || day.pain || day.minutes < OPENER_MINUTES + MIN_GYM_MINUTES) return undefined
  const families = focusFamilies(focus)
  const placeKit = location.equipment as EquipmentId[]
  return trainedSkills(state).find((s) => {
    const f = skillFamily(s)
    return (
      f !== 'balance' &&
      families.includes(f) &&
      day.clear(f) &&
      !FAMILY_JOINTS[f].some((j) => day.sore.includes(j)) &&
      missingKit(s, placeKit).length === 0 &&
      missingKit(s, state.profile.equipment).length === 0
    )
  })
}

/** Main sets of each straight-arm family in the session a request builds, counted as a logged one is (`lastHardStraightArm`). */
function familySets(state: AppState, skills: SkillId[], minutes: number, at: number): Record<Straight, number> {
  const built = finalizeWorkout(state, { source: 'auto', minutes, skills }, undefined, at)
  const sets = { push: 0, pull: 0 }
  for (const b of built.blocks) {
    if (b.section !== 'main' && b.section !== 'strength') continue
    const f = skillSetLoading(b.exerciseId, b.section)?.straightArm
    if (f) sets[f] += b.sets
  }
  return sets
}

/** An opener block: the skill's ordinary one-skill session, hard when it gives three or more main sets of its family. */
function openerBlock(state: AppState, skill: SkillId, at: number): SkillBlock {
  const f = skillFamily(skill)
  const hard = f !== 'balance' && familySets(state, [skill], OPENER_MINUTES, at)[f] >= 3
  return { minutes: OPENER_MINUTES, skills: [skill], hard: hard ? [f as Straight] : [], opener: true }
}

/**
 * What a gym session of this focus at this place opens with today, or nothing
 * (`openerSkill`'s rules). The rest rule reads logged hard sessions on earlier
 * days — today's own never rest today; sore joints and pain are `soreJoints`.
 * `minutes` is the day's time for both blocks, the scheduled minutes when not
 * given. The opener is an ordinary one-skill session, `{ source: 'auto',
 * minutes, skills }`, logged to the skill history like any other.
 */
export function gymOpener(state: AppState, focus: GymFocus, location: GymLocation, now = Date.now(), minutes?: number): SkillBlock | undefined {
  const own = state.gym?.prefs
  const restMs = (own?.straightArmRestHours ?? 48) * HOUR
  const scheduled = own ? (own.minutesByDay[weekdayOf(now)] ?? 0) : 0
  const sore = soreJoints(state, now)
  const logged = familyEvents(state, now)
  const today = startOfDay(now)
  const skill = openerSkill(state, focus, location, {
    minutes: minutes ?? (scheduled > 0 ? scheduled : state.settings.sessionMinutes),
    sore: sore.joints,
    pain: sore.pain,
    clear: (f) => !logged[f].some((e) => e.at < today && now - e.at < restMs),
  })
  return skill ? openerBlock(state, skill, now) : undefined
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const dayName = (t: number) => DAY_NAMES[new Date(t).getDay()]
const skillName = (s: SkillId) => (s === 'frontlever' ? 'front lever' : s === 'ninety' ? '90° hold' : s)
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

/**
 * A skill block. `skills` is the line-up in the order the session gives it
 * roles — lead, partner, then a short dose — and `hard` the straight-arm
 * families it trains hard (its full parts that reach the app's own
 * hard-session count). An opener (`opener: true`) is one skill's session that
 * starts a gym day, while fresh.
 */
export interface SkillBlock {
  minutes: number
  skills: SkillId[]
  hard?: Straight[]
  opener?: true
}

/** The one main session a day holds: calisthenics (skills), the gym (with an optional skill opener), or none. */
export type DayKind = 'calisthenics' | 'gym' | 'rest'

export interface TodayPlan {
  minutes: number
  /** A rest day in the schedule or the week plan. A training day the rules leave nothing to train in is `kind: 'rest'` without it. */
  rest: boolean
  /**
   * The day's one main session. Calisthenics gives `skill` all the minutes,
   * with no `gym`; the gym gives `gym` the minutes, less an optional opener in
   * `skill` (`opener: true`) that comes first.
   */
  kind: DayKind
  /** Today only: the other kind today could be — what "Rather do … today?" switches to. */
  alternative?: 'calisthenics' | 'gym'
  skill?: SkillBlock
  gym?: { minutes: number; focus: GymFocus; avoidJoints: Joint[]; volumeFactor: number; deload: boolean; musclesOff: Muscle[] }
  /** How hard today is pitched (light / normal / push) and why. Today only; later days are planned as normal. */
  readiness?: DayReadiness
  /** Why the day looks the way it does, in the athlete's terms. */
  reasons: string[]
}

function joinNames(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/**
 * A run of hard gym weeks, or a fortnight of grinding sets: time for a lighter
 * week (convention). A week counts toward the run when it held two sessions or
 * more at its usual volume and its rated sets averaged RPE 7.5 or more — or
 * when too few of its sets were rated to judge (`MIN_RATED_SETS`): an athlete
 * who does not rate sets still gets the built-in lighter weeks (under 18 the
 * spec asks for them), rather than never being "due" because unrated weeks
 * averaged zero. Weeks are calendar weeks, stepped with `addDays` so a
 * daylight-saving change cannot shift a boundary by an hour.
 */
export function gymDeloadDue(state: AppState, now: number): { due: boolean; why?: string } {
  const sessions = state.gym?.sessions ?? []
  const youth = conservative(state.profile, now)
  const weeksNeeded = youth ? 3 : 5
  const startThis = weekStart(now)
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const from = addDays(startThis, -7 * (i + 1))
    const to = addDays(from, 7)
    const inWeek = sessions.filter((s) => s.startedAt >= from && s.startedAt < to)
    const working = inWeek.flatMap((s) => s.exercises.flatMap((e) => e.sets.filter((x) => !x.warmup && x.reps > 0)))
    const rpes = working.filter((x) => x.rpe !== undefined).map((x) => x.rpe!)
    const judged = rpes.length >= MIN_RATED_SETS
    return { sessions: inWeek.length, sets: working.length, judged, avg: judged ? rpes.reduce((a, b) => a + b, 0) / rpes.length : 0 }
  })
  // A week well under the usual volume is a lighter week, however hard its
  // sets felt — it ends the run, or a deload logged at RPE 8 would call
  // another one every week after.
  const usual = Math.max(0, ...weeks.map((w) => w.sets))
  let hardRun = 0
  let unrated = 0
  for (const w of weeks) {
    if (w.sessions >= 2 && w.sets >= 0.7 * usual && (!w.judged || w.avg >= 7.5)) {
      hardRun++
      if (!w.judged) unrated++
    } else break
  }
  if (hardRun >= weeksNeeded) {
    return {
      due: true,
      why: `${hardRun} ${unrated ? 'full' : 'hard'} gym weeks in a row${unrated ? ` (${unrated === hardRun ? 'too few sets rated to tell how hard they were, so they count as hard' : 'some with too few sets rated to tell, counted as hard'})` : ''}${youth ? ' — under 18 the lighter week comes sooner' : ''}: this week is lighter — fewer sets, stopping further from failure. Deloads are a coaching convention; controlled trials have not shown they add strength, but they keep a long run of hard weeks sustainable.`,
    }
  }
  const recent = sessions.filter((s) => s.startedAt >= addDays(now, -14) && s.startedAt < now)
  const recentRpe = recent.flatMap((s) => s.exercises.flatMap((e) => e.sets.filter((x) => !x.warmup && x.rpe !== undefined).map((x) => x.rpe!)))
  if (recent.length >= 3 && recentRpe.length >= 12) {
    const avg = recentRpe.reduce((a, b) => a + b, 0) / recentRpe.length
    // Effort up while the estimated maxes did not move: the same work is costing more.
    // Lift by lift, and only lifts with an estimate in both weeks: no estimate
    // is not "held still", and a lift skipped this week did not stall (the
    // heaviest lift of all left out once read as every max holding still).
    const bestByLift = (from: number, to: number) => {
      const out = new Map<string, number>()
      for (const s of recent) {
        if (s.startedAt < from || s.startedAt >= to) continue
        for (const e of s.exercises) for (const x of e.sets) {
          if (x.warmup) continue
          const v = estimateOneRepMax(x, e.exerciseId)
          if (v !== null && v > (out.get(e.exerciseId) ?? 0)) out.set(e.exerciseId, v)
        }
      }
      return out
    }
    const thisWeek = bestByLift(addDays(now, -7), now)
    const lastWeek = bestByLift(addDays(now, -14), addDays(now, -7))
    const both = [...thisWeek.keys()].filter((id) => lastWeek.has(id))
    const stalled = both.length > 0 && both.every((id) => thisWeek.get(id)! <= lastWeek.get(id)! + 0.01)
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
//
// Shared recovery (CONSENSUS; the shared joints are INFERENCE from the
// positions): planche-type holds, push-ups and presses load the same front
// delts, wrists and elbows, and the front lever and rows or pull-ups the same
// lats and elbows. So a hard session of a family — a skill block that reaches
// the hard count, a push or upper gym day (pull or upper for the pull family),
// or a logged gym session with `HARD_GYM_FAMILY_SETS` working sets of pressing
// or pulling — is one event, and two events on different days sit at least the
// athlete's straight-arm rest rule apart, in both directions, planned or
// logged. The same day may hold both, the holds first and then the gym: that
// is how a push day concentrates the load, and the days around it stay clear.
// The athlete's own week plan is trained as written and the rest is planned
// around it; every block is no smaller than the session it starts can keep to.
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
  /** Why it rests: the gym schedule, the athlete's week plan, or a weekly goal already met. */
  restWhy?: 'schedule' | 'plan' | 'goal'
  /** The skills the athlete's own week plan gives this day, in their order (those that can train). */
  assigned?: SkillId[]
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

/** One skill's share of a day's skill block, by the line-up's rules. */
interface Part {
  skill: SkillId
  role: LineupRole
  /** A full part that reaches the app's own hard-session count: a hard straight-arm session of its family. */
  hard: boolean
}

/** Why a straight-arm family rests on a day: the hard session of it nearest in time. */
interface FamilyBlock extends FamilyEvent {
  /** In the athlete's week plan, rather than logged. */
  planned: boolean
}

/** Why a day is the kind it is, for its reasons. */
type KindWhy =
  | 'picked'
  | 'followed'
  | 'plan'
  | 'no-place'
  | 'no-gym-goal'
  | 'skills-rest'
  | 'no-skill-goal'
  | 'gym-unfit'
  | 'gym-blocked'
  | 'family'
  | 'family-opener'
  | 'pair'
  | 'sport'
  | 'sets'
  | 'share'

interface SkillSlot {
  /** The day's one main session. */
  kind: DayKind
  why?: KindWhy
  /** Today only: the other kind the day could be. */
  alternative?: 'calisthenics' | 'gym'
  skillMin: number
  gymMin: number
  /** The skill block's line-up, in role order: lead, partner, short dose (a gym day's opener alone). */
  skills: SkillId[]
  parts: Part[]
  /** Straight-arm families this day trains hard: its full parts (or its opener) that reach the hard-session count. */
  families: Set<Straight>
  /** Families resting today under the rest rule, and the session that rests them. */
  blocked: Partial<Record<Straight, FamilyBlock>>
  /** The family a calisthenics day was chosen for, to reach its sessions this week. */
  urgent?: Straight
  /** A gym day chosen to open with this family's skill, for its sessions this week: its focus trains that family. */
  hint?: Straight
  /** The skill a gym day opens with, once its focus is known. */
  opener?: SkillId
  /** The gym's weekly sets need this day: gym days still needed, and open days left after it. */
  setsNeed?: { need: number; left: number }
  noSkillFits: boolean
  /** Nothing fits the minutes. */
  tooShort?: boolean
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

/**
 * Every day of the horizon with what is known before anything is chosen for
 * it. The minutes come from the gym schedule when the athlete set one, and
 * otherwise from the skill side's own settings — the session length every
 * day, rest only where the week plan says rest, and, once the weekly goal is
 * met, the rest of that week — never from a schedule the athlete did not set.
 * The week plan's own days win over the gym schedule: a day assigned to skills
 * trains them (at the session length if the schedule had no minutes for it),
 * and a day marked rest rests.
 */
function dayContexts(state: AppState, prefs: TrainingPrefs, own: boolean, now: number, horizonEnd: number, todayMinutes?: number): DayCtx[] {
  const today = startOfDay(now)
  const thisWeek = weekStart(now)
  // Days trained this week before a given moment (skill or gym), for the weekly goal.
  const trainedDays = (before: number) =>
    new Set(
      [
        ...state.sessions.filter((s) => s.workoutKind !== 'micro').map((s) => s.startedAt),
        ...(state.gym?.sessions ?? []).map((s) => s.startedAt),
      ]
        .filter((x) => x >= thisWeek && x < before)
        .map(dayKey),
    ).size
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
    const weekday = weekdayOf(start)
    const reading = state.settings.weekPlan ? readDay(state, weekday) : undefined
    let scheduled = own ? (prefs.minutesByDay[weekday] ?? 0) : state.settings.sessionMinutes
    if (reading?.kind === 'skills' && scheduled <= 0) scheduled = state.settings.sessionMinutes
    const given = i === 0 && todayMinutes !== undefined
    const minutes = given ? todayMinutes! : scheduled
    const goal = state.settings.weeklyGoal
    const goalMet = !own && reading?.kind !== 'skills' && weekStart(start) === thisWeek && goal > 0 && trainedDays(Math.min(start, now)) >= goal
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
    const restWhy: DayCtx['restWhy'] = reading?.kind === 'rest' ? 'plan' : scheduled <= 0 ? 'schedule' : goalMet ? 'goal' : undefined
    const restDay = !given && restWhy !== undefined
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
      ...(restDay ? { restWhy } : {}),
      ...(reading?.kind === 'skills' ? { assigned: reading.skills } : {}),
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

/** What the skill side of planning needs beside the days. */
interface SkillCtx {
  restMs: number
  /** Logged hard sessions of each family, skill and gym alike. */
  logged: Record<Straight, FamilyEvent[]>
  /** The athlete wants gym work and has a place to do it. */
  wantsGym: boolean
  /** Gym goals are set, place or not. */
  gymWanted: boolean
  /** Whether a gym block of this many minutes builds two movements or more on this day, at some focus. */
  gymFits: (d: DayCtx, minutes: number) => boolean
  /** Whether it builds at a focus that trains the family hard (push or pull, or upper). */
  familyGymFits: (d: DayCtx, minutes: number, family: Straight) => boolean
  place?: GymLocation
  /** Skills' share of the training days, from the goal weights. */
  share: number
  targets: Record<Muscle, [number, number]>
  weights: Record<Muscle, number>
  /** Sets each muscle got this week before today. */
  weekSets: Credit
  /** Training days this week before today, by the kind they were: a day with a gym session counts as a gym day. */
  before: { cal: number; gym: number }
  /** Today's kind, picked by the athlete or read off what they logged today. */
  todayKind?: 'calisthenics' | 'gym'
  todayWhy?: 'picked' | 'followed'
}

/**
 * The line-up for a skill block of `minutes`: the day as the athlete wrote it,
 * or the coach's pick among `allowed`. Hard is what the session this block
 * starts holds, counted the way the app counts a logged one
 * (`lastHardStraightArm`): three or more main sets of the family. A second
 * skill in a short block gets two sets of its hold (measured: under 35 minutes
 * beside the lead, under 40 with a short dose too), and a planche at
 * Foundations holds a scapula position, so neither is called hard — the
 * line-up rules alone could not say so.
 */
function lineupParts(state: AppState, d: DayCtx, allowed: SkillId[], minutes: number): Part[] {
  if (!allowed.length || roomFor(minutes) === 0) return []
  const view = d.assigned ? state : { ...state, profile: { ...state.profile, skills: allowed } }
  const entries = todaysLineup(view, d.at, minutes).filter((e) => allowed.includes(e.skill))
  const first = entries.find((e) => e.role === 'lead')
  if (!first) return []
  const partner = entries.find((e) => e.role === 'partner')
  // An explicit request gives roles by position (lead, partner, short dose) and holds three at most.
  const dose = partner ? entries.find((e) => e.role === 'maintenance' || e.role === 'practice') : undefined
  const out: Part[] = [{ skill: first.skill, role: 'lead', hard: false }]
  if (partner) out.push({ skill: partner.skill, role: 'partner', hard: false })
  if (dose) out.push({ skill: dose.skill, role: skillFamily(dose.skill) === 'balance' ? 'practice' : 'maintenance', hard: false })
  const sets = familySets(state, out.map((x) => x.skill), minutes, d.at)
  return out.map((x) => {
    const f = skillFamily(x.skill)
    return { ...x, hard: (x.role === 'lead' || x.role === 'partner') && f !== 'balance' && sets[f] >= 3 }
  })
}

/** Muscle credit of a skill block's parts: full parts three or four sets of their family's loading, a short dose two. */
function partsCredit(parts: Part[], minutes: number): Credit {
  const credit: Credit = {}
  for (const part of parts) {
    const full = part.role === 'lead' || part.role === 'partner'
    addCredit(credit, familyLoading(skillFamily(part.skill)), full ? (minutes >= 25 ? 4 : 3) : 2)
  }
  return credit
}

/**
 * Whether a skill's session at its current step can be a hard straight-arm
 * session by the app's own count: its key hold loads the family (a planche at
 * Foundations holds a scapula position, not a planche) and its kit is there.
 */
function hardAtStep(state: AppState, skill: SkillId): boolean {
  const f = skillFamily(skill)
  if (f === 'balance' || missingKit(skill, state.profile.equipment).length > 0) return false
  const step = STEP_BY_ID[skillView(state, skill).stepId]
  return Boolean(step) && skillSetLoading(step.keyExerciseId, 'main')?.straightArm === f
}

/**
 * Each day's one main session — calisthenics, the gym, or nothing — and, for a
 * calisthenics day, which skills. The athlete's own week plan is placed first
 * and trained as written; then every other day, in order (`decide`). Hard
 * sessions of one family (skill holds, heavy pressing or pulling, logged or
 * planned) sit at least the rest rule apart on different days, in both
 * directions; a gym day's opener shares its day with the gym's own pressing or
 * pulling. What a block trains is the line-up's own answer for those minutes
 * (lead, partner, short dose), so nothing is claimed that the session will not
 * hold. The gym's focus, and so each opener, is chosen after (`allocate`).
 */
function planSkills(state: AppState, prefs: TrainingPrefs, days: DayCtx[], skills: SkillId[], ctx: SkillCtx): SkillSlot[] {
  const g = prefs.goals
  const today = days[0].start
  const thisWeek = days[0].week
  const done = hardCount(state.sessions, thisWeek, today)
  const lead = skillFamily(skills[0])
  const target = (f: Straight) => (f === lead ? FAMILY_SESSIONS_LEAD : FAMILY_SESSIONS_OTHER)
  // Whether each skill's session at its current step reaches the hard count at all.
  const keyHard = new Map<SkillId, boolean>()
  const stepIsHard = (skill: SkillId) => {
    if (!keyHard.has(skill)) keyHard.set(skill, hardAtStep(state, skill))
    return keyHard.get(skill)!
  }
  // Straight-arm sessions planned so far, by family — every full part of a push
  // or pull skill, hard by the count or not, so skill days keep the rest rule
  // between them as they always have, and every gym day chosen to open with a
  // family's skill: the athlete's own days first, then each open day.
  const planned: Record<Straight, { i: number; at: number }[]> = { push: [], pull: [] }
  /** The hard session of a family on another day inside the rest rule, nearest first; today's own sessions do not rest today. */
  const conflict = (f: Straight, i: number): FamilyBlock | undefined => {
    const d = days[i]
    const near: FamilyBlock[] = [
      ...ctx.logged[f].filter((e) => e.at < d.start && d.at - e.at < ctx.restMs).map((e) => ({ ...e, planned: false })),
      ...planned[f]
        .filter((x) => x.i !== i && Math.abs(days[x.i].at - d.at) < ctx.restMs)
        .map((x) => ({ at: days[x.i].at, gym: false, planned: true })),
    ]
    return near.sort((a, b) => Math.abs(d.at - a.at) - Math.abs(d.at - b.at))[0]
  }
  /**
   * Open days after `i` this week a family could still train hard, spaced by
   * the rest rule. Today is read from what came before it, so its choice holds
   * still once its first block is logged.
   */
  const feasibleAfter = (f: Straight, i: number) => {
    const before = [
      ...ctx.logged[f].map((e) => e.at).filter((x) => (i === 0 ? x < days[0].start : x <= days[i].at)),
      ...planned[f].filter((x) => x.i <= i).map((x) => days[x.i].at),
    ]
    let l = before.length ? Math.max(...before) : undefined
    let k = 0
    for (let j = i + 1; j < days.length && days[j].week === days[i].week; j++) {
      const dj = days[j]
      if (dj.restDay || dj.assigned || dj.minutes < MIN_SKILL_MINUTES[1]) continue
      const clear = !planned[f].some((x) => x.i !== j && Math.abs(days[x.i].at - dj.at) < ctx.restMs)
      if ((l === undefined || dj.at - l >= ctx.restMs) && clear) {
        k++
        l = dj.at
      }
    }
    return k
  }
  const slots: SkillSlot[] = new Array(days.length)
  /** Training days of a calendar week so far, by kind: those logged before today, then those decided. */
  const tally = (week: number) => {
    const t = week === thisWeek ? { ...ctx.before } : { cal: 0, gym: 0 }
    slots.forEach((sl, j) => {
      if (days[j].week !== week) return
      if (sl.kind === 'calisthenics') t.cal++
      else if (sl.kind === 'gym') t.gym++
    })
    return t
  }
  /**
   * Whether the gym's weekly sets need this day: the gym days each muscle group
   * still needs to reach its lower target — its prime movers, from what is
   * logged this week and the calisthenics days decided — are more than the open
   * days after it could give, even if every one of them went to the gym. An
   * estimate for choosing the day, not a count of sets.
   */
  const groupNeed = (i: number): Record<'push' | 'pull' | 'lower', number> => {
    const d = days[i]
    const have: Credit = d.week === thisWeek ? { ...ctx.weekSets } : {}
    slots.forEach((sl, j) => {
      if (days[j].week === d.week && sl.kind === 'calisthenics') addCredit(have, sl.credit)
    })
    const S = sessionSets(d.minutes, 1)
    const out = { push: 0, pull: 0, lower: 0 }
    for (const group of ['push', 'pull', 'lower'] as const) {
      if (!focusOpen(group, prefs.musclesOff)) continue
      let sessions = 0
      for (const m of FOCUS_MUSCLES[group]) {
        const share = FOCUS_SHARE[group][m] ?? 0
        if (share >= 0.3 && ctx.weights[m] > 0) sessions = Math.max(sessions, (ctx.targets[m][0] - (have[m] ?? 0)) / (share * S))
      }
      out[group] = Math.ceil(Math.max(0, sessions - 0.25))
    }
    return out
  }
  /** Gym days decided in a calendar week, or those chosen to open with a family's skill. */
  const gymDaysIn = (week: number, hint?: Straight) => slots.filter((sl, j) => days[j].week === week && sl.kind === 'gym' && (!hint || sl.hint === hint)).length
  /** Whether the gym still needs a session of the family's own muscles this week (pressing for push, pulling for pull). */
  const musclesWant = (f: Straight, i: number) => groupNeed(i)[f] > gymDaysIn(days[i].week, f)
  const gymNeedsDay = (i: number): SkillSlot['setsNeed'] => {
    const d = days[i]
    const n = groupNeed(i)
    const need = n.push + n.pull + n.lower - gymDaysIn(d.week)
    let left = 0
    for (let j = i + 1; j < days.length && days[j].week === d.week; j++) {
      const dj = days[j]
      if (!slots[j] && !dj.restDay && !dj.assigned && dj.minutes >= MIN_GYM_MINUTES && ctx.gymFits(dj, dj.minutes)) left++
    }
    return need > left ? { need, left } : undefined
  }
  /**
   * The day's one main session. The athlete's own day is calisthenics as
   * written, and so is every day without a gym place or gym goals; a day only
   * one kind fits is that kind. Otherwise, in order: a straight-arm family that
   * needs this day for its weekly hard sessions gets it — as calisthenics, or as
   * a gym day that opens with its skill when the goals lean to the gym or its
   * muscles still need the gym this week; a day the goals give to calisthenics
   * goes to the gym, its skill first, when that family's muscles still need a gym
   * session (a calisthenics day of the family would keep the gym's pressing or
   * pulling off the days around it); then the goal weights decide how the
   * week's training days split, and a close call
   * goes to calisthenics when sport keeps the legs out of the gym, to the gym
   * when its weekly sets need the day, and otherwise to the side the goals
   * favour. The split and its order are the app's own rules; skill frequency
   * and shared recovery are CONSENSUS.
   */
  const decide = (i: number): SkillSlot => {
    const d = days[i]
    const blocked: SkillSlot['blocked'] = {}
    for (const f of ['push', 'pull'] as const) {
      const c = conflict(f, i)
      if (c) blocked[f] = c
    }
    const base: SkillSlot = {
      kind: 'rest',
      skillMin: 0,
      gymMin: 0,
      skills: [],
      parts: [],
      families: new Set(),
      blocked,
      noSkillFits: false,
      count: { push: 0, pull: 0 },
      credit: {},
    }
    if (d.restDay || d.minutes <= 0) return base
    // The athlete's own day trains as written; any other day leaves out a family inside its rest rule.
    const allowed = d.assigned ?? skills.filter((s) => skillFamily(s) === 'balance' || !blocked[skillFamily(s) as Straight])
    const calOK = allowed.length > 0 && d.minutes >= MIN_SKILL_MINUTES[1]
    const gymOK = ctx.wantsGym && d.minutes >= MIN_GYM_MINUTES && ctx.gymFits(d, d.minutes)
    const skillsWanted = g.skills > 0 || Boolean(d.assigned) || !ctx.wantsGym
    const forced = i === 0 ? ctx.todayKind : undefined
    let kind: 'calisthenics' | 'gym' | undefined
    let why: KindWhy
    let urgent: Straight | undefined
    let hint: Straight | undefined
    let setsNeed: SkillSlot['setsNeed']
    if (forced && (forced === 'gym' ? gymOK : calOK)) {
      kind = forced
      why = ctx.todayWhy ?? 'picked'
    } else if (d.assigned) {
      kind = calOK ? 'calisthenics' : undefined
      why = 'plan'
    } else if (!ctx.wantsGym) {
      kind = calOK ? 'calisthenics' : undefined
      why = ctx.gymWanted ? 'no-place' : 'no-gym-goal'
    } else if (!calOK || !skillsWanted) {
      kind = gymOK ? 'gym' : undefined
      why = skillsWanted ? 'skills-rest' : 'no-skill-goal'
    } else if (!gymOK) {
      kind = 'calisthenics'
      why = 'gym-unfit'
    } else {
      const t = tally(d.week)
      const n = t.cal + t.gym
      const calDue = ctx.share * (n + 1) - t.cal
      const gymDue = (1 - ctx.share) * (n + 1) - t.gym
      const lean: 'calisthenics' | 'gym' = calDue > gymDue + 1e-9 ? 'calisthenics' : gymDue > calDue + 1e-9 ? 'gym' : ctx.share >= 0.5 ? 'calisthenics' : 'gym'
      const close = Math.abs(calDue - gymDue) < 0.5
      // Pairing moves a day to the gym only while calisthenics is under a whole day ahead of its share: the goals
      // decide how many days each kind gets, the pairing which days the gym takes.
      const movable = calDue - gymDue < 1
      const behind = (['push', 'pull'] as const).find(
        (f) =>
          allowed.some((s) => skillFamily(s) === f && stepIsHard(s)) &&
          target(f) - ((d.week === thisWeek ? done[f] : 0) + planned[f].filter((x) => days[x.i].week === d.week).length) > feasibleAfter(f, i),
      )
      /** Whether a gym day here can open with a skill of the family that counts toward its sessions. */
      const opensWith = (f: Straight) => {
        const skill = ctx.place ? openerSkill(state, f, ctx.place, { minutes: d.minutes, sore: d.avoidJoints, pain: d.pain, clear: (x) => !blocked[x] }) : undefined
        return Boolean(skill && stepIsHard(skill) && ctx.familyGymFits(d, d.minutes - OPENER_MINUTES, f))
      }
      // A calisthenics day of a family keeps the gym's pressing (or pulling) off the days around it, so a family
      // whose muscles still need the gym this week pairs the two on one day: the gym, its skill first.
      const pairs = (['push', 'pull'] as const).find(
        (f) => lean === 'calisthenics' && movable && allowed.some((s) => skillFamily(s) === f && stepIsHard(s)) && musclesWant(f, i) && opensWith(f),
      )
      if (behind) {
        if ((lean === 'gym' || (movable && musclesWant(behind, i))) && opensWith(behind)) {
          kind = 'gym'
          hint = behind
          why = 'family-opener'
        } else {
          kind = 'calisthenics'
          urgent = behind
          why = 'family'
        }
      } else if (pairs) {
        kind = 'gym'
        hint = pairs
        why = 'pair'
      } else if (close && (d.legsCovered || d.upcoming)) {
        kind = 'calisthenics'
        why = 'sport'
      } else if (close && gymNeedsDay(i)) {
        setsNeed = gymNeedsDay(i)
        kind = 'gym'
        why = 'sets'
      } else {
        kind = lean
        why = 'share'
      }
    }
    let parts: Part[] = []
    if (kind === 'calisthenics') {
      parts = lineupParts(state, d, allowed, d.minutes)
      if (!parts.length) {
        // Nothing of the skills fits these minutes: the gym takes the day if it can.
        kind = gymOK ? 'gym' : undefined
        why = 'skills-rest'
        urgent = undefined
      }
    }
    const families = new Set(parts.filter((p) => p.hard).map((p) => skillFamily(p.skill) as Straight))
    const alternative = i !== 0 ? undefined : kind === 'calisthenics' && gymOK ? 'gym' : kind === 'gym' && calOK ? 'calisthenics' : undefined
    return {
      ...base,
      kind: kind ?? 'rest',
      why,
      ...(alternative ? { alternative } : {}),
      skillMin: kind === 'calisthenics' ? d.minutes : 0,
      gymMin: kind === 'gym' ? d.minutes : 0,
      skills: parts.map((p) => p.skill),
      parts,
      families,
      ...(urgent ? { urgent } : {}),
      ...(hint ? { hint } : {}),
      ...(kind === 'gym' && setsNeed ? { setsNeed } : {}),
      // Nothing planned, and the minutes are why: shorter than the session that would otherwise be built.
      ...(!kind && d.minutes < (allowed.length ? MIN_SKILL_MINUTES[1] : MIN_GYM_MINUTES) ? { tooShort: true } : {}),
      noSkillFits: g.skills > 0 && !d.assigned && allowed.length === 0,
      credit: partsCredit(parts, d.minutes),
    }
  }
  // The athlete's own days are fixed first, so the days the planner chooses keep the rest rule around them both ways.
  for (const own of [true, false]) {
    for (let i = 0; i < days.length; i++) {
      if (Boolean(days[i].assigned) !== own) continue
      slots[i] = decide(i)
      for (const part of slots[i].parts) {
        const f = skillFamily(part.skill)
        if (f !== 'balance' && (part.role === 'lead' || part.role === 'partner') && !planned[f].some((x) => x.i === i)) planned[f].push({ i, at: days[i].at })
      }
      const h = slots[i].hint
      if (h && !planned[h].some((x) => x.i === i)) planned[h].push({ i, at: days[i].at })
    }
  }
  return slots
}

interface Path {
  foci: (GymFocus | null)[]
  serves: Muscle[][]
  P: Credit
  prev: Credit
  /** The previous day's gym sets alone, for the two-days-running rule. */
  prevGym: Credit
  /** When this path presses or pulls hard in the gym (push, pull or upper days), for the family rest rule. */
  gymEvents: Record<Straight, number[]>
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
  /** The athlete's own switched-off muscles (sport cover is separate, per day). */
  musclesOff: Muscle[]
  /** The first day of the horizon with a gym block. */
  nextGymDay: number
  /** The part of the body left longest (five days or more), which that next session goes to. */
  staleGroup?: 'lower' | 'push' | 'pull'
  /** The straight-arm rest rule, in ms. */
  restMs: number
  /** Families the athlete trains a skill of: only those share recovery with the gym's pressing or pulling. */
  shared: Record<Straight, boolean>
  /**
   * Whether the gym may press (push) or pull hard on day `i` as far as
   * everything fixed is concerned: no logged hard session of the family, and
   * no planned skill session of it, on another day inside the rest rule.
   */
  clear: (family: Straight, i: number) => boolean
  /** Whether this focus builds two movements or more in this many minutes on this day. */
  viable: (d: DayCtx, minutes: number, focus: GymFocus) => boolean
  /** The skill a gym day of this focus opens with, when one can (`openerSkill`, and the gym still builds beside it). */
  opener: (i: number, focus: GymFocus) => SkillId | undefined
  /** The gym's own minutes on a day at this focus: the day's, less the opener's when it has one. */
  gymMinutes: (i: number, focus: GymFocus) => number
}

/** The straight-arm families a gym focus trains hard: pressing on push days, pulling on pull days, both on upper days. */
export function focusFamilies(focus: GymFocus): Straight[] {
  return focus === 'push' ? ['push'] : focus === 'pull' ? ['pull'] : focus === 'upper' ? ['push', 'pull'] : []
}

/** The foci that train a group left longest — the same ones the reason names. */
const TRAINS: Record<'lower' | 'push' | 'pull', GymFocus[]> = { lower: ['lower', 'full', 'athletic'], push: ['push', 'upper'], pull: ['pull', 'upper'] }

/** The group left longest as of `at`, when it has waited five days or more. */
function staleGroupAt(prefs: TrainingPrefs, lastHit: Partial<Record<Muscle, number>>, at: number): { f: 'lower' | 'push' | 'pull'; days: number } | undefined {
  const daysSince = (m: Muscle) => Math.min(STALE_CAP_DAYS, lastHit[m] === undefined ? STALE_CAP_DAYS : (at - lastHit[m]!) / DAY)
  return (['lower', 'push', 'pull'] as const)
    .filter((f) => focusOpen(f, prefs.musclesOff))
    .map((f) => {
      const ms = FOCUS_MUSCLES[f].filter((m) => !prefs.musclesOff.includes(m))
      return { f, days: ms.length ? ms.reduce((sum, m) => sum + daysSince(m), 0) / ms.length : 0 }
    })
    .filter((x) => x.days >= 5)
    .sort((a, b) => b.days - a.days)[0]
}

/**
 * Whether a focus is open on a day by the day's own rules: the muscles it is
 * for switched on, no legs around sport or with a sore knee, and speed and
 * power only on a full, fresh, pain-free day with nothing hard either side.
 */
function openOnDay(d: DayCtx, f: GymFocus, musclesOff: Muscle[], legsOff: boolean, power: number): boolean {
  if (!FOCUS_MUSCLES[f].some((m) => !d.off.has(m))) return false
  // Most of what the focus is for must be switched on (legs off once still gave "Lower" days of one ab exercise).
  if (!focusOpen(f, musclesOff)) return false
  const legsBlocked = Boolean(d.legsCovered || d.upcoming) || legsOff
  if (f === 'lower' && (legsBlocked || d.avoidJoints.includes('knees'))) return false
  if (f === 'athletic') {
    return power >= 3 && !legsBlocked && !d.hardBefore && !d.hardNext && !d.pain && !d.avoidJoints.includes('knees') && d.factor >= 1
  }
  return true
}

/** The place gym sessions are built at: the active one, or the first set up. */
function activePlace(state: AppState): GymLocation | undefined {
  const gym = state.gym
  return gym?.locations.find((l) => l.id === gym.activeLocationId) ?? gym?.locations[0]
}

const BEAM = 40
/** A muscle with this many sets in a day was worked hard that day (a planning line, not a measured one). */
export const HARD_SETS = 4

function gymCredit(d: DayCtx, minutes: number, focus: GymFocus): Credit {
  const sets = sessionSets(minutes, d.factor)
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
  init: Pick<Path, 'P' | 'prev' | 'last' | 'athletic'> & { prevGym?: Credit; prevFocus?: GymFocus | null; gymEvents?: Record<Straight, number[]> },
  ctx: GymCtx,
  fixed?: { index: number; focus: GymFocus | null; credit: Credit; prev: Credit; prevGym: Credit },
): Path {
  let paths: Path[] = [
    {
      foci: [],
      serves: [],
      P: { ...init.P },
      prev: { ...init.prev },
      prevGym: { ...(init.prevGym ?? {}) },
      gymEvents: { push: [...(init.gymEvents?.push ?? [])], pull: [...(init.gymEvents?.pull ?? [])] },
      last: { ...init.last },
      athletic: init.athletic,
      score: 0,
    },
  ]
  const gymDays = idxs.filter((i) => slots[i].gymMin > 0 && fixed?.index !== i)
  const step = (p: Path, i: number, focus: GymFocus | null, credit: Credit, prev: Credit, prevGym: Credit, served: Muscle[], gain: number): Path => {
    const P = { ...p.P }
    addCredit(P, credit)
    const last = { ...p.last }
    for (const [m, v] of Object.entries(credit) as [Muscle, number][]) if (v >= 1) last[m] = i
    const gymEvents = { push: [...p.gymEvents.push], pull: [...p.gymEvents.pull] }
    for (const f of focus ? focusFamilies(focus) : []) gymEvents[f].push(days[i].at)
    return { foci: [...p.foci, focus], serves: [...p.serves, served], P, prev, prevGym, gymEvents, last, athletic: p.athletic + (focus === 'athletic' ? 1 : 0), score: p.score + gain }
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
    const open = FOCI.filter((f) => openOnDay(d, f, ctx.musclesOff, ctx.legsOff, ctx.power)).filter(
      (f) => ctx.viable(d, ctx.gymMinutes(i, f), f) && focusFamilies(f).every((fam) => !ctx.shared[fam] || ctx.clear(fam, i)),
    )
    // The next gym session goes to the part of the body left longest, when anything open today trains it —
    // unless the day was chosen to open with a family's skill, which its focus must train.
    if (i === ctx.nextGymDay && ctx.staleGroup && !slot.hint) {
      const group = ctx.staleGroup
      const trains = open.filter((f) => TRAINS[group].includes(f) && FOCUS_MUSCLES[group].some((m) => !d.off.has(m) && (FOCUS_SHARE[f][m] ?? 0) > 0))
      if (trains.length) open.splice(0, open.length, ...trains)
    }
    // Pressing beside planche-type holds, or pulling beside lever work, is no
    // longer marked down on the same day: the family rest rule spaces hard
    // sessions of a family apart on different days, so a push day carries the
    // holds and the pressing together (skills first) and the days around it
    // stay clear of both.
    const penalty = (f: GymFocus) => {
      let x = 0
      if (f === 'push' && d.avoidJoints.includes('wrists')) x += 0.35
      if (f === 'full' && legsBlocked) x += 0.2
      return x * S
    }
    const staleDays = (m: Muscle, p: Path) =>
      p.last[m] !== undefined
        ? Math.min(STALE_CAP_DAYS, i - p.last[m]!)
        : Math.min(STALE_CAP_DAYS, ctx.lastHit[m] === undefined ? STALE_CAP_DAYS : (d.at - ctx.lastHit[m]!) / DAY)
    const next: Path[] = []
    for (const p of paths) {
      // Hard pressing or pulling this path already put on another day inside the rest rule rules the family out today.
      const familyFree = (f: GymFocus) =>
        focusFamilies(f).every((fam) => !ctx.shared[fam] || p.gymEvents[fam].every((t) => startOfDay(t) === d.start || Math.abs(t - d.at) >= ctx.restMs))
      let choices = open.filter((f) => familyFree(f) && (f !== 'athletic' || (p.athletic < ctx.athleticWanted && p.foci[p.foci.length - 1] !== 'athletic')))
      // A day chosen to open with a family's skill trains that family, when anything open lets it.
      const hint = slot.hint
      // Its own family's focus first: an upper day would press and pull, and rest the other family around it too.
      if (hint && choices.some((f) => focusFamilies(f).includes(hint) && ctx.opener(i, f))) {
        const opening = choices.filter((f) => focusFamilies(f).includes(hint) && ctx.opener(i, f))
        const own = opening.filter((f) => f === hint)
        choices = own.length ? own : opening
      }
      // Not the same focus, nor the same muscles hard, in the gym two days running — while anything else is open.
      const lastFocus = p.foci.length ? p.foci[p.foci.length - 1] : (init.prevFocus ?? null)
      const clash = (f: GymFocus) =>
        f === lastFocus || (Object.entries(gymCredit(d, ctx.gymMinutes(i, f), f)) as [Muscle, number][]).some(([m, c]) => c >= HARD_SETS && (p.prevGym[m] ?? 0) >= HARD_SETS)
      const calm = choices.filter((f) => !clash(f))
      if (!choices.length) {
        // Nothing builds or fits the rules today: no gym block, said in the day's reasons.
        const prev = { ...slot.credit }
        addCredit(prev, legs)
        next.push(step(p, i, null, slot.credit, prev, {}, [], 0))
        continue
      }
      if (!calm.length) {
        // Everything left repeats yesterday's focus or its hard muscles: no gym block rather than the same muscles two days running.
        const prev = { ...slot.credit }
        addCredit(prev, legs)
        next.push(step(p, i, null, slot.credit, prev, {}, [], 0))
        continue
      }
      for (const f of calm) {
        const credit = gymCredit(d, ctx.gymMinutes(i, f), f)
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
        // A push day concentrates the load: pressing goes beside the day's own holds — its opener, first — since the
        // days around them are kept clear of it (CONSENSUS: shared recovery; the weight is a planning heuristic).
        const opener = ctx.opener(i, f)
        if (opener) gain += 0.3 * S
        if (f === 'athletic') gain += (ctx.power / 5) * 0.8 * S
        const dayCredit = { ...slot.credit }
        addCredit(dayCredit, credit)
        if (opener) addCredit(dayCredit, familyLoading(skillFamily(opener)), 3)
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
  /** The day's one main session (the same as `plan.kind`). */
  kind: DayKind
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

/** "planche and front lever", "pull, front lever first" — a day in a few words. */
function describe(plan: TodayPlan): string {
  const names = plan.skill ? joinNames(plan.skill.skills.map(skillName)) : ''
  if (plan.kind === 'gym' && plan.gym) return `${FOCUS_LABEL[plan.gym.focus].toLowerCase()}${plan.skill?.opener ? `, ${names} first` : ''}`
  return names
}

/** Today's kind, picked by the athlete or read off what they logged today. */
export type TodayKindPick = { todayKind?: 'calisthenics' | 'gym'; todayWhy?: 'picked' | 'followed' }

/**
 * The week from today: each day's one main session — calisthenics or the gym,
 * with any opener — and why, planned together and again from what actually
 * happened. `todayMinutes` is "I have X minutes" for today, `todayKind` "Rather
 * do … today". Pure: state and time in, plan out.
 */
export function planWeekAhead(state: AppState, now = Date.now(), opts: { todayMinutes?: number; inner?: boolean } & TodayKindPick = {}): WeekAhead {
  // An athlete who never set the gym side up keeps the skill side's own days and minutes (`dayContexts`).
  const own = state.gym?.prefs
  const prefs: TrainingPrefs = own ?? defaultPrefs(now)
  const skills = trainedSkills(state)
  const today = startOfDay(now)
  const thisWeek = weekStart(now)
  const nextWeek = addDays(thisWeek, 7)
  const horizonEnd = addDays(today, 7) > nextWeek ? addDays(nextWeek, 7) : nextWeek
  const days = dayContexts(state, prefs, Boolean(own), now, horizonEnd, opts.todayMinutes)
  const gymSessions = state.gym?.sessions ?? []
  const place = activePlace(state)
  const youth = conservative(state.profile, now)
  const restMs = prefs.straightArmRestHours * HOUR
  const logged = familyEvents(state, now)
  const legsOff = !focusOpen('lower', prefs.musclesOff)
  // A focus counts only when it builds two movements or more at the place with the day's limits —
  // checked by building it, once per distinct set of limits.
  const built = new Map<string, boolean>()
  const viable = (d: DayCtx, minutes: number, focus: GymFocus): boolean => {
    if (!place || minutes < MIN_GYM_MINUTES) return false
    const factor = focus === 'athletic' ? Math.min(1, d.factor) : d.factor
    const off = [...d.off].sort()
    const key = [focus, minutes, factor, [...d.avoidJoints].sort().join(','), off.join(',')].join('|')
    if (!built.has(key)) {
      const plan = buildGymSession({
        location: place,
        minutes,
        focus,
        sessions: gymSessions,
        ratings: state.gym?.ratings,
        youth,
        goals: prefs.goals,
        musclesOff: off,
        priority: prefs.musclesPriority,
        avoidJoints: d.avoidJoints,
        volumeFactor: factor,
        favoriteAt: state.gym?.favoriteAt,
        now: d.at,
      })
      built.set(key, plan.fits && plan.items.length >= 2)
    }
    return built.get(key)!
  }
  const g = prefs.goals
  const gymWeight = Math.max(g.strength, g.physique, g.power, g.endurance)
  const gymWanted = gymWeight > 0
  const targets = {} as Record<Muscle, [number, number]>
  const weights = {} as Record<Muscle, number>
  for (const m of MUSCLES) {
    targets[m.id] = volumeTarget(m.id, prefs)
    weights[m.id] = prefs.musclesOff.includes(m.id) ? 0 : prefs.musclesPriority.includes(m.id) ? 1.5 : m.sub ? 0.5 : 1
  }
  // Training days this week before today, by kind: a day with a gym session was a gym day (an opener and its gym, or the old split).
  const before = { cal: 0, gym: 0 }
  for (let t = thisWeek; t < today; t = addDays(t, 1)) {
    const on = (x: number) => x >= t && x < addDays(t, 1)
    if (gymSessions.some((s) => on(s.startedAt))) before.gym++
    else if (state.sessions.some((s) => s.workoutKind !== 'micro' && on(s.startedAt))) before.cal++
  }
  const openOn = (d: DayCtx, f: GymFocus) => openOnDay(d, f, prefs.musclesOff, legsOff, g.power)
  const slots = planSkills(state, prefs, days, skills, {
    restMs,
    logged,
    wantsGym: gymWanted && Boolean(place),
    gymWanted,
    gymFits: (d, minutes) => FOCI.some((f) => openOn(d, f) && viable(d, minutes, f)),
    familyGymFits: (d, minutes, fam) => ([fam, 'upper'] as GymFocus[]).some((f) => openOn(d, f) && viable(d, minutes, f)),
    ...(place ? { place } : {}),
    share: Math.min(0.75, Math.max(0.25, g.skills / Math.max(1, g.skills + gymWeight))),
    targets,
    weights,
    weekSets: setsPerMuscle(state.sessions, gymSessions, thisWeek, today),
    before,
    ...(opts.todayKind ? { todayKind: opts.todayKind, todayWhy: opts.todayWhy ?? 'picked' } : {}),
  })
  const shared = {
    push: skills.some((s) => skillFamily(s) === 'push'),
    pull: skills.some((s) => skillFamily(s) === 'pull'),
  }
  // The days that hold hard sessions of a family: the calisthenics days while the gym is planned, then every day's.
  let familySlots = slots
  // Logged hard sessions and planned skill sessions of a family on other days, inside the rest rule.
  const fixedNear = (fam: Straight, i: number) => {
    const d = days[i]
    return [
      ...logged[fam].filter((e) => e.at < d.start && d.at - e.at < restMs).map((e) => ({ at: e.at, gym: e.gym, logged: true })),
      ...familySlots.flatMap((sl, j) => (j !== i && sl.families.has(fam) && Math.abs(days[j].at - d.at) < restMs ? [{ at: days[j].at, gym: false, logged: false }] : [])),
    ]
  }
  /** Whether a gym day may open with the family: no logged hard session on an earlier day, nor a skill day of it, inside the rest rule. */
  const openerClear = (fam: Straight, i: number) => {
    const d = days[i]
    if (logged[fam].some((e) => e.at < d.start && d.at - e.at < restMs)) return false
    return !slots.some(
      (sl, j) => j !== i && Math.abs(days[j].at - d.at) < restMs && sl.parts.some((p) => (p.role === 'lead' || p.role === 'partner') && skillFamily(p.skill) === fam),
    )
  }
  const openers = new Map<string, SkillId | undefined>()
  const opener = (i: number, focus: GymFocus): SkillId | undefined => {
    const key = `${i}|${focus}`
    if (!openers.has(key)) {
      const d = days[i]
      const skill =
        place && slots[i].kind === 'gym'
          ? openerSkill(state, focus, place, { minutes: d.minutes, sore: d.avoidJoints, pain: d.pain, clear: (fam) => openerClear(fam, i) })
          : undefined
      // The gym must still build beside it.
      openers.set(key, skill && viable(d, d.minutes - OPENER_MINUTES, focus) ? skill : undefined)
    }
    return openers.get(key)
  }
  const ctx: GymCtx = {
    targets,
    weights,
    lastHit: lastTrainedAt(state, now),
    power: g.power,
    athleticWanted: g.power >= 4 ? 2 : g.power >= 3 ? 1 : 0,
    legsOff,
    musclesOff: prefs.musclesOff,
    nextGymDay: slots.findIndex((sl) => sl.gymMin > 0),
    restMs,
    shared,
    clear: (fam, i) => fixedNear(fam, i).length === 0,
    viable,
    opener,
    gymMinutes: (i, focus) => slots[i].gymMin - (opener(i, focus) ? OPENER_MINUTES : 0),
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
      gymEvents: { push: [], pull: [] },
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
    if (!gymDone && todayFocus && slots[0].gymMin > 0) addCredit(remaining, gymCredit(days[0], ctx.gymMinutes(0, todayFocus), todayFocus))
    const prev = setsPerMuscle(state.sessions, gymSessions, today, now + 1)
    addCredit(prev, remaining)
    const prevGym = setsPerMuscle([], gymSessions, today, now + 1)
    if (!gymDone && todayFocus && slots[0].gymMin > 0) addCredit(prevGym, gymCredit(days[0], ctx.gymMinutes(0, todayFocus), todayFocus))
    week = allocate(
      days,
      slots,
      cur,
      {
        P: setsPerMuscle(state.sessions, gymSessions, thisWeek, now + 1),
        prev: setsPerMuscle(state.sessions, gymSessions, yesterday, today),
        prevGym: setsPerMuscle([], gymSessions, yesterday, today),
        gymEvents: { push: [], pull: [] },
        last: {},
        athletic: athleticCount(state, thisWeek, now + 1),
      },
      ctx,
      { index: 0, focus: todayFocus, credit: remaining, prev, prevGym },
    )
  }
  const later = nxt.length
    ? allocate(
        days,
        slots,
        nxt,
        { P: {}, prev: week.prev, prevGym: week.prevGym, prevFocus: week.foci[week.foci.length - 1] ?? null, gymEvents: week.gymEvents, last: week.last, athletic: 0 },
        ctx,
      )
    : undefined
  const focusOf = (i: number): GymFocus | null => (cur.includes(i) ? week.foci[cur.indexOf(i)] : later?.foci[nxt.indexOf(i)] ?? null)
  const servesOf = (i: number): Muscle[] => (i === 0 ? first.serves[0] : cur.includes(i) ? week.serves[cur.indexOf(i)] : later?.serves[nxt.indexOf(i)] ?? [])

  // Each gym day's opener, now that its focus is known.
  const final: SkillSlot[] = slots.map((slot, i) => {
    const focus = slot.kind === 'gym' ? focusOf(i) : null
    const skill = focus ? opener(i, focus) : undefined
    if (!skill) return slot
    const block = openerBlock(state, skill, days[i].at)
    const part: Part = { skill, role: 'lead', hard: Boolean(block.hard?.length) }
    return {
      ...slot,
      opener: skill,
      skillMin: block.minutes,
      gymMin: slot.gymMin - block.minutes,
      skills: [skill],
      parts: [part],
      families: new Set(block.hard),
      credit: partsCredit([part], block.minutes),
    }
  })
  // A gym day the gym could not fill under its rules (rest rules, the day before, what the place has) is
  // calisthenics when a skill is clear of every session of its family around it, and otherwise has nothing.
  const gymFamilies = (j: number): Straight[] => {
    const f = final[j].kind === 'gym' ? focusOf(j) : null
    return f ? focusFamilies(f) : []
  }
  for (let i = 0; i < final.length; i++) {
    const slot = final[i]
    if (slot.kind !== 'gym' || focusOf(i)) continue
    const d = days[i]
    const near = (fam: Straight) =>
      logged[fam].some((e) => e.at < d.start && d.at - e.at < restMs) ||
      final.some(
        (sl, j) =>
          j !== i &&
          Math.abs(days[j].at - d.at) < restMs &&
          (gymFamilies(j).includes(fam) || sl.parts.some((p) => (p.role === 'lead' || p.role === 'partner') && skillFamily(p.skill) === fam)),
      )
    const allowed = d.assigned ?? (g.skills > 0 ? skills.filter((s) => skillFamily(s) === 'balance' || !near(skillFamily(s) as Straight)) : [])
    const parts = d.minutes >= MIN_SKILL_MINUTES[1] ? lineupParts(state, d, allowed, d.minutes) : []
    final[i] = parts.length
      ? {
          ...slot,
          kind: 'calisthenics',
          why: 'gym-blocked',
          alternative: undefined,
          skillMin: d.minutes,
          gymMin: 0,
          skills: parts.map((p) => p.skill),
          parts,
          families: new Set(parts.filter((p) => p.hard).map((p) => skillFamily(p.skill) as Straight)),
          credit: partsCredit(parts, d.minutes),
        }
      : { ...slot, kind: 'rest', why: 'gym-blocked', alternative: undefined, gymMin: 0 }
  }
  familySlots = final
  // Hard sessions of each family this calendar week, up to and including each day.
  const doneHard = hardCount(state.sessions, thisWeek, today)
  const tally = new Map<number, Record<Straight, number>>()
  final.forEach((slot, i) => {
    const d = days[i]
    const counts = tally.get(d.week) ?? (d.week === thisWeek ? { ...doneHard } : { push: 0, pull: 0 })
    tally.set(d.week, counts)
    for (const f of slot.families) counts[f]++
    final[i] = { ...slot, count: { ...counts } }
  })
  /** Training days of a calendar week by kind: logged before today, and planned. */
  const kindsIn = (wk: number) => {
    const t = wk === thisWeek ? { ...before } : { cal: 0, gym: 0 }
    final.forEach((sl, j) => {
      if (days[j].week !== wk) return
      if (sl.kind === 'calisthenics') t.cal++
      else if (sl.kind === 'gym') t.gym++
    })
    return t
  }

  const shortfall = MUSCLES.map((m) => m.id)
    .filter((m) => PLANNABLE.has(m) && targets[m][0] > 0 && (week.P[m] ?? 0) < targets[m][0] - 0.5)
    .sort((a, b) => weights[a] - weights[b] || targets[b][0] - (week.P[b] ?? 0) - (targets[a][0] - (week.P[a] ?? 0)))
  // Only families with a skill whose current step can be a hard session: a target nothing at the step can meet is not shown.
  const frequency = (['push', 'pull'] as const)
    .filter((f) => skills.some((s) => skillFamily(s) === f && hardAtStep(state, s)))
    .map((f) => ({
      family: f,
      skills: skills.filter((s) => skillFamily(s) === f),
      done: doneHard[f],
      planned: cur.filter((i) => final[i].families.has(f)).length,
      target: skillFamily(skills[0]) === f ? FAMILY_SESSIONS_LEAD : FAMILY_SESSIONS_OTHER,
    }))

  const weekSets = setsPerMuscle(state.sessions, gymSessions, thisWeek, now)
  // Hard pressing and pulling the gym was given, for the days it keeps clear.
  const plannedGym: Record<Straight, number[]> = { push: [], pull: [] }
  for (const d of days) for (const fam of gymFamilies(d.index)) plannedGym[fam].push(d.at)
  const restH = prefs.straightArmRestHours
  /** Why the gym does not press (or pull) hard today, or how a day carries both: one line per family that applies. */
  const familyNotes = (d: DayCtx, slot: SkillSlot, focus: GymFocus | null): { long: string[]; short: string[] } => {
    const long: string[] = []
    const short: string[] = []
    if (!focus || slot.gymMin <= 0) return { long, short }
    for (const fam of ['push', 'pull'] as const) {
      if (!shared[fam]) continue
      const names = joinNames(skills.filter((s) => skillFamily(s) === fam).map(skillName))
      const work = fam === 'push' ? 'pressing' : 'pulling'
      const holds = fam === 'push' ? `${cap(names)} and pressing share the front delts, wrists and elbows` : `${cap(names)} and rows or pull-ups share the lats and elbows`
      if (focusFamilies(focus).includes(fam)) {
        if (slot.families.has(fam)) {
          long.push(`${holds}, so today carries both: the holds first, then the ${work}, and the days around it stay clear of both under your ${restH}h rest rule (a coaching convention).`)
          short.push(`${cap(names)} and ${work} share today: holds first.`)
        }
        continue
      }
      const near = [
        ...fixedNear(fam, d.index),
        ...plannedGym[fam].filter((x) => startOfDay(x) !== d.start && Math.abs(x - d.at) < restMs).map((x) => ({ at: x, gym: true, logged: false })),
      ].sort((a, b) => Math.abs(d.at - a.at) - Math.abs(d.at - b.at))[0]
      if (!near) continue
      const hours = Math.round(Math.abs(d.at - near.at) / HOUR)
      const what = near.logged
        ? near.gym
          ? `your heavy ${work} session ${hours}h ago`
          : `your hard ${names} session ${hours}h ago`
        : `${near.gym ? work : names} on ${dayName(near.at)}`
      long.push(`No heavy ${work} in the gym today: ${what} is inside your ${restH}h rest rule. ${holds}, so hard sessions of either are spaced like one, or share a day with the holds first (a coaching convention).`)
      short.push(`No heavy ${work}: ${what} is inside the ${restH} h rule.`)
    }
    return { long, short }
  }
  const goals = { skills: g.skills, gym: gymWeight }
  const out: WeekDayPlan[] = days.slice(0, 7).map((d) => {
    const slot = final[d.index]
    const focus = slot.kind === 'gym' ? focusOf(d.index) : null
    const notes = familyNotes(d, slot, focus)
    const kinds = kindsIn(d.week)
    const plan = assembleDay(state, prefs, d, slot, focus, d.index === 0 ? weekSets : null, ctx.lastHit, skills, {
      ...(place ? { place } : {}),
      notes: notes.long,
      wantsGym: gymWanted && Boolean(place),
      week: kinds,
      goals,
    })
    return {
      day: d.key,
      at: d.at,
      kind: plan.kind,
      plan,
      why: whyFor(d, slot, plan, servesOf(d.index), prefs, skills, notes.short, kinds),
      ...(d.sport.length ? { sport: d.sport[d.sport.length - 1] } : {}),
    }
  })
  // Today as it happened: a gym session logged on a calisthenics day, or a skill session on a gym day
  // with no opener, is the athlete's own switch — today becomes that kind and the week is planned around it.
  if (!opts.todayKind && !opts.inner && !days[0].assigned) {
    const p0 = out[0].plan
    const skillToday = state.sessions.some((s) => s.startedAt >= today && s.startedAt <= now && s.workoutKind !== 'micro')
    const switched = p0.kind === 'calisthenics' && gymDone && !skillToday ? 'gym' : p0.kind === 'gym' && !p0.skill && skillToday && !gymDone ? 'calisthenics' : undefined
    if (switched) return planWeekAhead(state, now, { ...opts, todayKind: switched, todayWhy: 'followed' })
  }

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
      const planned = cap(describe(was))
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
      `The rest of this week: ${rest.map((p) => `${dayName(p.at)} ${p.plan.kind === 'gym' ? 'gym' : 'calisthenics'} (${describe(p.plan)})`).join(', ')}. Spread so each muscle gets its weekly sets across your training days without the same muscles worked hard two days running — coaching conventions, and the week is planned again from what you log.`,
    )
  }
  return { days: out, missed, shortfall, frequency }
}

/** What `assembleDay` needs beside the day's decisions. */
interface DayExtra {
  place?: GymLocation
  notes: string[]
  wantsGym: boolean
  /** Training days of the day's calendar week by kind, logged and planned. */
  week: { cal: number; gym: number }
  /** The goal weights the split follows: skills, and the strongest gym goal. */
  goals: { skills: number; gym: number }
}

const familyNames = (skills: SkillId[], f: Straight) => joinNames(skills.filter((s) => skillFamily(s) === f).map(skillName))
const familyTarget = (skills: SkillId[], f: Straight) => (f === skillFamily(skills[0]) ? FAMILY_SESSIONS_LEAD : FAMILY_SESSIONS_OTHER)

/** Why the day is the kind it is, in the athlete's terms — the decision `planSkills` made, said. */
function kindReason(slot: SkillSlot, d: DayCtx, skills: SkillId[], extra: DayExtra): string | undefined {
  const at = extra.place ? ` at ${extra.place.name}` : ''
  const share = () =>
    `${slot.kind === 'gym' ? 'A gym day' : 'Calisthenics today'}: your goals weigh skills at ${extra.goals.skills} and the gym at ${extra.goals.gym}, so this week has ${extra.week.cal} calisthenics and ${extra.week.gym} gym ${extra.week.gym === 1 ? 'day' : 'days'} (the app’s own split, not a measured dose).`
  switch (slot.why) {
    case 'picked':
      return slot.kind === 'rest' ? undefined : `You picked ${slot.kind === 'gym' ? 'the gym' : 'calisthenics'} today; the rest of the week is planned around it.`
    case 'followed':
      return `You trained ${slot.kind === 'gym' ? 'at the gym' : 'skills'} today, so today counts as a ${slot.kind === 'gym' ? 'gym' : 'calisthenics'} day and the rest of the week is planned around it.`
    case 'no-place':
      return slot.kind === 'calisthenics' ? 'No gym place is set up yet, so every training day is calisthenics. Add a place on the Gym tab to plan gym days.' : undefined
    case 'no-gym-goal':
      return slot.kind === 'calisthenics' ? 'None of your goals is a gym goal, so every training day is calisthenics.' : undefined
    case 'skills-rest':
      return slot.kind === 'gym' ? 'No skill work fits today’s rest rules, so today is a gym day.' : undefined
    case 'no-skill-goal':
      return slot.kind === 'gym' ? 'Skills are not among your goals, so training days go to the gym.' : undefined
    case 'gym-unfit':
      return `No gym session fits today${at}${d.avoidJoints.length ? ` with your ${d.avoidJoints.join(' and ')} kept out` : ''}: fewer than two movements are left, so today is calisthenics.`
    case 'gym-blocked':
      return `No gym session fits today’s rules${at} — rest rules, sore joints and what the place has leave fewer than two movements — ${slot.kind === 'calisthenics' ? 'so today is calisthenics' : 'and no skill work fits beside them, so nothing is planned today'}.`
    case 'family':
      return slot.urgent
        ? `Calisthenics today: ${familyNames(skills, slot.urgent)} needs it to get ${familyTarget(skills, slot.urgent)} hard sessions in this week (a coaching convention for skill frequency).`
        : undefined
    case 'family-opener':
      return slot.hint && slot.opener
        ? `A gym day that opens with the ${skillName(slot.opener)}: ${familyNames(skills, slot.hint)} needs ${familyTarget(skills, slot.hint)} hard sessions this week, and the opener is one of them (a coaching convention for skill frequency).`
        : share()
    case 'pair':
      return slot.hint && slot.opener
        ? `A ${slot.hint} gym day that opens with the ${skillName(slot.opener)}: your ${slot.hint === 'push' ? 'chest, shoulders and triceps' : 'back and biceps'} still need a gym session this week, and the holds and the ${slot.hint === 'push' ? 'pressing' : 'pulling'} share recovery — on one day, the days around it stay clear of both (a coaching convention).`
        : share()
    case 'sport': {
      const s = d.legsCovered ?? d.upcoming
      if (!s) return undefined
      const what = s.scheduled ? `Your usual ${sportName(s.kind)}` : s.kind === 'pe' ? 'PE' : s.kind === 'other' ? 'Your activity' : cap(s.kind)
      return `${what} ${d.legsCovered ? 'already loaded your legs' : 'is coming up'}, so the gym would leave the legs out today: today is calisthenics, and the gym waits for fresher legs.`
    }
    case 'sets':
      return slot.setsNeed
        ? `A gym day: your muscles need about ${slot.setsNeed.need} more gym ${slot.setsNeed.need === 1 ? 'session' : 'sessions'} to reach this week’s sets, with ${slot.setsNeed.left} open ${slot.setsNeed.left === 1 ? 'day' : 'days'} left after today (an estimate).`
        : share()
    case 'share':
      return share()
    default:
      return undefined
  }
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
  extra: DayExtra,
): TodayPlan {
  if (d.restDay) {
    const pick = 'If you do have time after all, pick how many minutes and a session is built for them.'
    const text =
      d.restWhy === 'plan'
        ? `A rest day in your week plan. ${pick}`
        : d.restWhy === 'goal'
          ? `Your weekly goal of ${state.settings.weeklyGoal} ${state.settings.weeklyGoal === 1 ? 'session' : 'sessions'} is done, so today is a rest day unless you want more. ${pick}`
          : `A rest day in your schedule. ${pick}`
    return { minutes: 0, rest: true, kind: 'rest', reasons: [text] }
  }
  const reasons: string[] = []
  const recent = d.reports[d.reports.length - 1]
  if (recent) {
    const where = d.avoidJoints.join(' and ')
    // Pain somewhere the plan has no joint for ("other") leaves nothing out: say only what is true.
    reasons.push(
      d.pain
        ? where
          ? `You reported pain in ${where}: today leaves out anything that loads it and stays light. Never train through pain — if it keeps coming back, tell a parent, coach or physio.`
          : 'You reported pain: today stays light. The plan cannot tell which movements load that spot, so stop anything that hurts it. Never train through pain — if it keeps coming back, tell a parent, coach or physio.'
        : where
          ? `You mentioned a niggle in ${where}: today steers round it.`
          : 'You mentioned a niggle: the plan cannot tell which movements load that spot, so stop anything that makes it worse.',
    )
  }
  // Straight-arm rest rule: hard sessions of one family (holds, heavy pressing or pulling) at least N hours apart.
  const restH = prefs.straightArmRestHours
  for (const family of ['push', 'pull'] as const) {
    const b = slot.blocked[family]
    const names = skills.filter((s) => skillFamily(s) === family).map(skillName)
    if (!b || !names.length) continue
    const hours = Math.round(Math.abs(d.at - b.at) / HOUR)
    if (d.assigned) {
      if (slot.families.has(family)) {
        reasons.push(`Your week plan has ${joinNames(names)} today, inside your ${restH}h rest rule for straight-arm work (${b.planned ? `${dayName(b.at)} as well` : `${hours}h since the last hard session`}) — it is your plan, so it stays.`)
      }
      continue
    }
    const they = names.length > 1 ? 'they rest' : 'it rests'
    reasons.push(
      b.planned
        ? `${cap(joinNames(names))} ${names.length > 1 ? 'are' : 'is'} in your week plan for ${dayName(b.at)}, inside your ${restH}h rest rule from today, so ${they} today.`
        : b.gym
          ? `Your heavy ${family === 'push' ? 'pressing' : 'pulling'} session ${hours}h ago shares recovery with ${joinNames(names)} — under your ${restH}h rest rule for straight-arm work, so ${they} today.`
          : `Your last hard ${joinNames(names)} session was ${hours}h ago — under your ${restH}h rest rule for straight-arm work, so ${they} today.`,
    )
  }
  const why = kindReason(slot, d, skills, extra)
  if (why) reasons.push(why)
  const skillBlock: SkillBlock | undefined =
    slot.skillMin > 0 ? { minutes: slot.skillMin, skills: slot.skills, hard: [...slot.families], ...(slot.opener ? { opener: true as const } : {}) } : undefined
  const wantsGym = extra.wantsGym
  if (d.assigned && slot.kind === 'calisthenics') {
    const left = d.assigned.filter((s) => !slot.skills.includes(s))
    reasons.push(
      `${dayName(d.at)} is set to ${joinNames(d.assigned.map(skillName))} in your week plan, so today is calisthenics${
        left.length && skillBlock ? ` — ${joinNames(left.map(skillName))} ${left.length > 1 ? 'are' : 'is'} left out: a ${slot.skillMin}-minute session has room for ${roomFor(slot.skillMin) === 1 ? 'one skill' : `${roomFor(slot.skillMin)} skills`}` : ''
      }.`,
    )
  }
  if (slot.tooShort) {
    reasons.push(`${d.minutes} minutes is shorter than the smallest session the app builds (${MIN_SKILL_MINUTES[1]} minutes of skill work${wantsGym ? `, ${MIN_GYM_MINUTES} at the gym` : ''}), so nothing is planned today. Pick more minutes if you have them.`)
  }
  if (slot.opener && focus) {
    reasons.push(`The ${skillName(slot.opener)} opens the session while you are fresh — its ordinary ${OPENER_MINUTES}-minute session, logged with your skills — then the ${FOCUS_LABEL[focus].toLowerCase()} lifts.`)
  }
  if (skillBlock && conservative(state.profile, d.at) && slot.skills.some((s) => skillFamily(s) !== 'balance')) {
    reasons.push('Warm wrists, elbows and shoulders up fully before the holds — the session starts with it, so do not skip it.')
  }
  if (slot.noSkillFits && slot.kind === 'rest' && !slot.tooShort) reasons.push('No skill work fits today’s rest rules, so the skills rest today.')
  const base = { minutes: d.minutes, rest: false, kind: slot.kind, ...(slot.alternative ? { alternative: slot.alternative } : {}), ...(skillBlock ? { skill: skillBlock } : {}) }
  // Readiness scales the gym block; a calisthenics day is the skill coach's call, from its own check-in.
  if (slot.kind !== 'gym' || slot.gymMin <= 0 || !wantsGym || !focus) return { ...base, reasons }
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
    .filter((f) => focusOpen(f, prefs.musclesOff))
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
  reasons.push(...extra.notes)
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

/** The week view's first line for a day: why it is the kind it is. */
function kindShort(slot: SkillSlot, skills: SkillId[], week: { cal: number; gym: number }): string | undefined {
  const share = `${slot.kind === 'gym' ? 'Gym' : 'Calisthenics'}: ${week.cal} calisthenics and ${week.gym} gym ${week.gym === 1 ? 'day' : 'days'} this week, by your goals.`
  switch (slot.why) {
    case 'picked':
      return slot.kind === 'rest' ? undefined : 'Your pick today.'
    case 'followed':
      return 'As you trained today.'
    case 'plan':
      return slot.kind === 'calisthenics' ? 'Skills from your week plan.' : undefined
    case 'no-place':
      return slot.kind === 'calisthenics' ? 'No gym place set up: calisthenics.' : undefined
    case 'no-gym-goal':
      return slot.kind === 'calisthenics' ? 'No gym goals: calisthenics.' : undefined
    case 'skills-rest':
      return slot.kind === 'gym' ? 'No skill work fits the rest rules: a gym day.' : undefined
    case 'gym-unfit':
    case 'gym-blocked':
      return slot.kind === 'calisthenics' ? 'No gym session fits today: calisthenics.' : 'No gym session fits today: under two movements.'
    case 'family':
      return slot.urgent ? `Calisthenics: ${familyNames(skills, slot.urgent)} needs it for this week’s ${familyTarget(skills, slot.urgent)} sessions.` : undefined
    case 'family-opener':
      return slot.opener ? `Gym, the ${skillName(slot.opener)} first: it counts toward this week’s sessions.` : share
    case 'pair':
      return slot.opener ? `Gym, the ${skillName(slot.opener)} first: holds and ${slot.hint === 'pull' ? 'pulling' : 'pressing'} share one day.` : share
    case 'sport':
      return 'Calisthenics: sport keeps legs out of the gym today.'
    case 'sets':
      return 'Gym: the muscles need it for this week’s sets.'
    case 'share':
      return share
    default:
      return undefined
  }
}

/** The short lines the week view shows under a day. */
function whyFor(d: DayCtx, slot: SkillSlot, plan: TodayPlan, serves: Muscle[], prefs: TrainingPrefs, skills: SkillId[], notes: string[], week: { cal: number; gym: number }): string[] {
  const why: string[] = []
  const sport = d.sport[d.sport.length - 1]
  if (plan.rest) {
    why.push(sport ? `No gym or skills: your ${sportName(sport.kind)} day.` : d.restWhy === 'plan' ? 'Rest day in your week plan.' : d.restWhy === 'goal' ? 'Rest day: your weekly goal is done.' : 'Rest day in your schedule.')
    return why
  }
  const line = kindShort(slot, skills, week)
  if (line) why.push(line)
  // What each skill actually gets, by the line-up's rules: only a full part that reaches the hard count is called hard.
  for (const part of slot.parts) {
    const f = skillFamily(part.skill)
    const name = cap(skillName(part.skill))
    if (slot.opener) {
      why.push(part.hard && f !== 'balance' ? `${name}: opens the session — hard session ${slot.count[f]} of the week.` : `${name}: opens the session — groundwork at your current step.`)
      continue
    }
    if (part.role === 'maintenance') {
      why.push(`${name}: a short dose — two sets at your current step.`)
      continue
    }
    if (part.role === 'practice') {
      why.push(`${name}: balance practice, first while fresh.`)
      continue
    }
    if (f === 'balance') {
      why.push(`${name}: ${part.role === 'lead' ? 'the main skill today' : 'the second skill'} — balance work.`)
      continue
    }
    // A sore joint the family loads: the skill coach steps the session back
    // (its own rail after any pain report), so the week does not call it hard.
    const sore = d.avoidJoints.filter((j) => FAMILY_JOINTS[f].includes(j))
    if (sore.length) why.push(`${name}: an eased session — you reported your ${joinNames(sore.map((j) => j.replace('-', ' ')))}, so it steps back rather than counting as hard.`)
    else if (part.hard) why.push(`${name}: hard session ${slot.count[f]} of the week.`)
    else if (part.role === 'partner') why.push(`${name}: the second skill — its hold and strength work, short of a hard session in a ${slot.skillMin}-minute block.`)
    else why.push(`${name}: groundwork at your current step, not a hard straight-arm session.`)
  }
  for (const f of ['push', 'pull'] as const) {
    const b = slot.blocked[f]
    if (!b || d.assigned || !skills.some((s) => skillFamily(s) === f)) continue
    const who = f === 'push' ? 'Push' : 'Pull'
    why.push(
      b.planned
        ? `${who} skills rest: your plan has them ${dayName(b.at)}, inside the ${prefs.straightArmRestHours} h rule.`
        : b.gym
          ? `${who} skills rest: heavy ${f === 'push' ? 'pressing' : 'pulling'} under ${prefs.straightArmRestHours} h ago.`
          : `${who} skills rest: under ${prefs.straightArmRestHours} h since the last hard session.`,
    )
  }
  if (slot.tooShort) why.push('Too short for a session the app builds.')
  if (plan.gym) {
    const label = FOCUS_LABEL[plan.gym.focus]
    if (plan.gym.focus === 'athletic') why.push(`${label}: fresh legs, and explosiveness is a goal.`)
    else why.push(serves.length ? `${label}: ${joinNames(serves.map((m) => MUSCLE_BY_ID[m].label.toLowerCase()))} furthest from this week’s sets.` : `${label}: keeps the week balanced.`)
  }
  why.push(...notes)
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
export function planToday(state: AppState, opts: { now?: number; minutes?: number; kind?: 'calisthenics' | 'gym' } = {}): TodayPlan {
  return planWeekAhead(state, opts.now ?? Date.now(), { todayMinutes: opts.minutes, ...(opts.kind ? { todayKind: opts.kind } : {}) }).days[0].plan
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
  const left = Math.ceil(weeksLeft)
  // One full stop, whatever the reason ends with; "1 week", never "1 weeks".
  const because = (why || 'not enough history').trim().replace(/[.\s]+$/, '')
  if (!range) return { status: 'unknown', text: `Can't tell yet whether ${left} ${left === 1 ? 'week is' : 'weeks are'} enough: ${because}.` }
  const whole = Math.floor(weeksLeft)
  const remaining = `${whole} ${whole === 1 ? 'week' : 'weeks'} left`
  const span = `${range.low}${range.high !== null ? `–${range.high}` : '+'} ${range.high === 1 || (range.high === null && range.low === 1) ? 'week' : 'weeks'}`
  if (range.high !== null && range.high <= weeksLeft) return { status: 'on-pace', text: `On pace: about ${span} at your current rate, ${remaining}.` }
  if (range.low > weeksLeft) return { status: 'behind', text: `Behind: about ${span} at your current rate, ${remaining}.` }
  return { status: 'possible', text: `Possible: ${span} at your current rate, ${remaining}.` }
}

/**
 * The next seven days, from the week plan: each day's skills, gym focus and
 * why. Every real day is planned again from what actually happened.
 */
export function planWeek(state: AppState, now = Date.now()): WeekDayPlan[] {
  return planWeekAhead(state, now).days
}
