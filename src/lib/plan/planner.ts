import { activePlace, hereKit, kitAt, placeKit, weekdayPlace } from './trainingPlace'
export { atActivePlace, kitAt, placeKit, weekdayPlace } from './trainingPlace'
import { apart, insideRest, skillFamily, startOfDay } from './restWindow'
export { insideRest, REST_SLACK_HOURS, skillFamily } from './restWindow'
import { countsSkillDay } from '../skillSession'
import { MUSCLE_BY_ID, MUSCLES, type Joint, type Muscle } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { EXERCISE_BY_ID } from '../../data/exercises'
import { STEP_BY_ID } from '../../data/progressions'
import { kitNeedsPhrase } from '../../data/equipment'
import { skillOfExercise, SKILLS } from '../../data/skills'
import { finalizeWorkout, withRequestKit } from '../../data/workouts'
import type { AppState, BodyRegion, EquipmentId, LineupRole, Session, SkillId, WorkoutRequest } from '../../types'
export { skillGoalPace, type GoalPace } from './goalPace'
import { humanRating, isBarAttempt, stoppedAtTarget } from '../progression'
import { daysSinceFullPart, todaysLineup } from '../lineup'
import { fullParts, OPENER_MINUTES, shortDoses } from '../sessionRoom'
import { readinessTimeline } from '../signals'
import { missingSkillKit, skillView } from '../skills'
import { addDays, dayKey, weekStart } from '../time'
import { readDay, weekdayOf } from '../weekPlan'
import { planGymExercises, FOCUS_LABEL, focusMain, focusOpen, NAMED_PATTERNS, type GymFocus } from '../gym/builder'
import { conservative } from '../gym/draft'
import { bodyweightCapacity } from '../gym/bodyweight'
import { estimateOneRepMax } from '../gym/progression'
import { defaultPrefs } from '../gym/state'
import type { GymLocation, GymSession, TrainingPrefs } from '../gym/types'
import {
  activityLoad,
  sportLoading,
  SPORT_UPPER_MUSCLES,
  familyEvents,
  fatigueAt,
  addLiftVolume,
  emptySetSources,
  HARD_GYM_FAMILY_SETS,
  lastTrainedAt,
  LIGHT_PRESS_SPARE,
  pressedIn,
  PRESS_SKILLS,
  restFamilyOf,
  setsPerMuscle,
  skillSetLoading,
  volumeTarget,
  type Credit,
  type MuscleSetSources,
  type FamilyEvent,
} from './load'
import { dayReadiness, MIN_RATED_SETS, READINESS_FACTOR, type DayReadiness } from './readiness'
import { fitLiftingPlace } from './placeWeek'
import { isHardForLegs, isHardSport, namedSport, sportBetween, sportName, type SportEvent } from './sport'

export type { DayReadiness, ReadinessLevel } from './readiness'

const HOUR = 3_600_000
const DAY = 24 * HOUR

export const FOCUS_MUSCLES: Record<GymFocus, Muscle[]> = {
  push: ['chest', 'chest-upper', 'front-delts', 'side-delts', 'triceps', 'triceps-long'],
  pull: ['lats', 'upper-back', 'rear-delts', 'biceps', 'forearms'],
  lower: ['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'tibialis-anterior'],
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
  lower: { quads: 0.45, glutes: 0.45, hamstrings: 0.35, calves: 0.15, adductors: 0.15, abs: 0.1, 'tibialis-anterior': 0.05 },
  upper: { chest: 0.3, 'chest-upper': 0.12, 'front-delts': 0.25, 'side-delts': 0.12, 'rear-delts': 0.12, triceps: 0.25, lats: 0.3, 'upper-back': 0.3, biceps: 0.2 },
  full: { quads: 0.22, glutes: 0.22, hamstrings: 0.15, chest: 0.18, 'front-delts': 0.12, 'side-delts': 0.06, lats: 0.18, 'upper-back': 0.18, triceps: 0.1, biceps: 0.1, abs: 0.06 },
  athletic: { quads: 0.3, glutes: 0.3, hamstrings: 0.25, calves: 0.25, abs: 0.05 },
}
const FOCI = Object.keys(FOCUS_SHARE) as GymFocus[]
/** Muscles some gym focus trains: the only ones the week can be planned toward. */
const PLANNABLE = new Set<Muscle>(FOCI.flatMap((f) => Object.keys(FOCUS_SHARE[f]) as Muscle[]))
export const PLANNABLE_MUSCLES: ReadonlySet<Muscle> = PLANNABLE

const LEG_MUSCLES: Muscle[] = ['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'tibialis-anterior']
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

// A standalone 15-minute visit can be a single skill practice or a short
// lifting session. Combined days reserve a full lifting block after the opener.
export const MIN_SKILL_MINUTES = { 1: 15, 2: 25, 3: 30 } as const
export const MIN_GYM_MINUTES = 15
const MIN_LIFTS_AFTER_OPENER = 20
export { OPENER_MINUTES } from '../sessionRoom'
/** From this many minutes in the day, the opener is `LONG_OPENER_MINUTES`. */
export const LONG_OPENER_FROM = 60
/** A long day's opener: at 18 minutes a 60-minute day's opener was a warm-up, four short holds and a cooldown. */
export const LONG_OPENER_MINUTES = MIN_SKILL_MINUTES[2]

/** Warm-up minutes for the lifts straight after a skill opener: the opener's own warm-up has done the rest. */
export const AFTER_OPENER_WARM_UP_MIN = 2

/** A gym day's opener for a day of this many minutes (opener and lifts together): 18 minutes, 25 from an hour up. */
export function openerMinutes(dayMinutes: number): number {
  return dayMinutes >= LONG_OPENER_FROM ? LONG_OPENER_MINUTES : OPENER_MINUTES
}

/**
 * From this many minutes in a day the first priority's opener is
 * `LONG_OPENER_MINUTES`: the lifts still keep their full block beside it.
 */
export const FIRST_OPENER_FROM = LONG_OPENER_MINUTES + MIN_LIFTS_AFTER_OPENER

/**
 * A gym day's opener, by whose it is. The athlete's first priority gets the
 * long opener whenever the lifts still keep their smallest block — from
 * 45-minute days — because its opener is one of its sessions of the week and
 * must carry its key hold's kept dose: at 18 minutes a tuck planche opener was
 * often a set or two short of it. Any other skill keeps `openerMinutes`.
 */
export function openerMinutesFor(first: boolean, dayMinutes: number): number {
  return first && dayMinutes >= FIRST_OPENER_FROM ? LONG_OPENER_MINUTES : openerMinutes(dayMinutes)
}

/** Skills a skill block of this length holds, as the line-up counts them: a lead, a partner, one short dose. */
function roomFor(minutes: number): number {
  if (minutes < MIN_SKILL_MINUTES[1]) return 0
  return fullParts(minutes) < 2 ? 1 : 2 + Math.min(1, shortDoses(minutes))
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
  /**
   * Joints named in a report that was not "all good" in the last 72 hours, and in the latest report while it is not
   * "all good" however old (`standingReport`): the skill coach still treats that one as current.
   */
  joints: Joint[]
  /** Pain, not a niggle, in the last 48 hours: the day stays light. */
  pain: boolean
  /** The latest such report. */
  lastAt?: number
}

/**
 * The report the skill coach still treats as current: the latest one at or
 * before `at`, when it is not "all good". It stands until a later check-in or
 * report supersedes it, however old — the coach's open-concern rail — so the
 * gym keeps its joint out as long as the skill side does. A wrist pain report
 * once made the day's planche opener the pain-safe one five days later while
 * the push lifts after it pressed and dipped with nothing kept out.
 */
function standingReport(timeline: readonly Answer[], at: number): Answer | undefined {
  let latest: Answer | undefined
  for (const a of timeline) if (a.at <= at && (!latest || a.at >= latest.at)) latest = a
  return latest && latest.joints !== 'good' ? latest : undefined
}

const jointsOf = (reports: readonly Answer[]): Joint[] => [
  ...new Set(reports.flatMap((a) => a.regions ?? []).map((r) => REGION_JOINT[r]).filter((j): j is Joint => Boolean(j))),
]

/**
 * The pain memory every gym session obeys, whoever builds it: the union of
 * every report that was not "all good" in the last 72 hours (never only the
 * latest), the same reading the week plan uses day by day — and the latest
 * report while the skill side still treats it as current (`standingReport`).
 */
export function soreJoints(state: AppState, now: number): SoreJoints {
  const timeline = readinessTimeline(state, now)
  const reports = timeline.filter((a) => a.at <= now && now - a.at < 72 * HOUR && a.joints !== 'good')
  const standing = standingReport(timeline, now)
  const all = standing && !reports.includes(standing) ? [...reports, standing] : reports
  return {
    joints: jointsOf(all),
    pain: reports.some((a) => a.joints === 'pain' && now - a.at < 48 * HOUR),
    ...(all.length ? { lastAt: Math.max(...all.map((a) => a.at)) } : {}),
  }
}

/** What a gym day's opener is decided from. */
interface OpenerDay {
  /** The day's minutes: the opener and the gym together. */
  minutes: number
  sore: Joint[]
  pain: boolean
  /** Why the family's rest rule keeps a hard session of it off today, or nothing when it is clear (the gym day itself is today's). */
  blocked: (family: Straight) => string | undefined
}

const trainedSkills = (state: AppState) => (state.profile.skills?.length ? state.profile.skills : ['planche']) as SkillId[]

/** Whether a skill can train with the athlete's own kit: a calisthenics day is built from that list, so only these can hold one. */
function canTrainAtHome(state: AppState, skill: SkillId): boolean {
  return missingSkillKit(state, skill).length === 0
}

/**
 * The state as today began: today's skill and gym sessions left out, every
 * report and activity kept. Today's own choices — its kind, its focus, its
 * opener, how hard it is pitched — are made from this, so following the plan
 * cannot change it: a saved planche opener once added its own fatigue to the
 * push day it opened, the day turned into a pull day, and every screen then
 * called the day done with the lifts still to do. New information still counts:
 * a pain report or a logged game is not a session.
 */
export function asTodayBegan(state: AppState, now: number): AppState {
  const t0 = startOfDay(now)
  const before = (s: { startedAt: number }) => s.startedAt < t0
  const gym = state.gym
  if (state.sessions.every(before) && (gym?.sessions ?? []).every(before)) return state
  return { ...state, sessions: state.sessions.filter(before), ...(gym ? { gym: { ...gym, sessions: gym.sessions.filter(before) } } : {}) }
}

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
  return openerVerdict(state, focus, location, day).skill
}

/**
 * `openerSkill`'s decision with its reason: the skill a gym day of this focus
 * opens with, or why none does (said on the Gym side). The kit is the place's
 * and the athlete's together — a front lever with no bar at home still opens a
 * pull day at a gym that has one.
 */
function openerVerdict(state: AppState, focus: GymFocus, location: GymLocation, day: OpenerDay): { skill?: SkillId; why?: string } {
  const families = focusFamilies(focus)
  // The handstand's push-up ladder is pressing (round seven): it can open a push day, in the athlete's order, under the
  // push family's rest rule and sore joints. Never an upper day — that day's opener counts for its pulling too.
  const candidates = trainedSkills(state).filter((s) => {
    const f = openerFamily(s, focus)
    return f !== undefined && families.includes(f)
  })
  if (!candidates.length) return {}
  const goals = state.gym?.prefs?.goals ?? defaultPrefs(0).goals
  if (goals.skills <= 0) return { why: 'Skills are not among your goals, so the lifts start the session.' }
  if (day.pain) return { why: 'You reported pain, so no skill work goes first today.' }
  if (day.minutes < OPENER_MINUTES + MIN_LIFTS_AFTER_OPENER) {
    return { why: `${day.minutes} minutes has no room for skill work first: an opener and the lifts take ${OPENER_MINUTES + MIN_LIFTS_AFTER_OPENER} minutes or more.` }
  }
  const kit = kitAt(state, location)
  let why: string | undefined
  for (const s of candidates) {
    const f = openerFamily(s, focus)!
    const sore = FAMILY_JOINTS[f].filter((j) => day.sore.includes(j))
    const missing = missingSkillKit(state, s, kit)
    const rest = day.blocked(f)
    if (!rest && !sore.length && !missing.length) return { skill: s }
    why ??= sore.length
      ? `Your ${joinNames(sore.map((j) => j.replace('-', ' ')))} report keeps the ${skillName(s)} out of today.`
      : missing.length
        ? `The ${skillName(s)} needs ${kitNeedsPhrase(missing)}, which neither your kit nor ${location.name} has.`
        : rest
  }
  return why ? { why } : {}
}

/** The family a skill opens a gym day of this focus for: its straight-arm family, or push for a pressing skill on a push day. */
function openerFamily(skill: SkillId, focus: GymFocus): Straight | undefined {
  const f = skillFamily(skill)
  if (f !== 'balance') return f
  return focus === 'push' && PRESS_SKILLS.has(skill) ? 'push' : undefined
}

/** What the session a skill request builds holds, read as a logged one is. */
interface BuiltSkill {
  minutes: number
  /** Main sets of each straight-arm family (`lastHardStraightArm`). */
  sets: Record<Straight, number>
  /**
   * Sets of each family as the rest rule counts them (`restFamilyOf`): the straight-arm sets, and the handstand's hard
   * presses with the push family's — what makes the session a hard session of the family for spacing, not for the
   * family's weekly skill sessions.
   */
  rest: Record<Straight, number>
  /** Sets per muscle, as `setsPerMuscle` counts a logged session (`skillSetLoading`). */
  credit: Credit
  /** Working sets of each skill's key hold at its step (no attempts, next-shape work or re-tests). */
  key: Partial<Record<SkillId, number>>
  /** Attempts on the next shape or at an unlock, kept when a skill day shares its time with lifts. */
  attempts: number
  /** The lead's key hold without its reach (`Block.reach`), in this build: an untrimmed build's is its kept dose. */
  bare: number
  /** The skills the session trains, in its own order. */
  skills: SkillId[]
  /** The pain-safe recovery session: no skill is trained. */
  painSafe: boolean
}
const builtSkills = new WeakMap<AppState, Map<string, BuiltSkill>>()

/** A skill's key-hold working sets in a built session, and what its untrimmed block would keep without its reach. */
function keyHold(state: AppState, skill: SkillId, blocks: readonly { exerciseId: string; section: string; role?: string; retest?: boolean; sets: number; reach?: number; skill?: SkillId }[]): { sets: number; kept: number } {
  const keyId = STEP_BY_ID[skillView(state, skill).stepId]?.keyExerciseId
  let sets = 0
  let kept = 0
  for (const b of blocks) {
    if (b.section !== 'main' || b.exerciseId !== keyId || b.role !== 'skill' || b.retest) continue
    sets += b.sets
    kept += b.sets - (b.reach ?? 0)
  }
  return { sets, kept }
}

/** Recent controlled rounds on both sides of the current shape, in the same units as the built workout. */
function repeatedPairedSets(state: AppState, skill: SkillId, now: number): number {
  const view = skillView(state, skill)
  const step = STEP_BY_ID[view.stepId]
  if (!EXERCISE_BY_ID[step?.keyExerciseId]?.perSide) return 0
  const since = addDays(now, -28)
  let pairs = 0
  for (const session of view.sessions) {
    if (session.stepId !== step.id || session.startedAt < since || session.startedAt >= now ||
        session.workoutKind !== 'auto' || session.completion === 'partial' || session.plannedDeload) continue
    const work = session.sets.filter((set) => set.section === 'main' && set.exerciseId === step.keyExerciseId && !set.light &&
      set.value > 0 && set.target > 0 && !set.repaired?.length && !isBarAttempt(set, step.id) &&
      (set.rpe ?? session.rpe ?? 10) <= 8 && (humanRating(set.form) ?? 'clean') === 'clean' &&
      (set.value >= set.target || stoppedAtTarget(set, step.id)))
    pairs = Math.max(pairs, Math.min(work.filter((set) => set.side === 'left').length, work.filter((set) => set.side === 'right').length))
  }
  return pairs * 2
}

/**
 * The session a skill request builds, counted: the week is planned from the
 * sessions themselves. It once counted a planche day as four sets of front
 * delts while the session logged twelve or more (holds, push-ups, leans), so
 * the gym kept pressing into a week already far past its target.
 */
function builtSkill(state: AppState, skills: SkillId[], minutes: number, at: number, kit?: EquipmentId[], opener = false): BuiltSkill {
  let memo = builtSkills.get(state)
  if (!memo) builtSkills.set(state, (memo = new Map()))
  const key = `${skills.join(',')}|${minutes}|${at}|${(kit ?? []).join(',')}|${opener}`
  const hit = memo.get(key)
  if (hit) return hit
  const built = finalizeWorkout(state, skillRequest({ minutes, skills, kit, ...(opener ? { opener: true } : {}) }), undefined, at)
  const sets = { push: 0, pull: 0 }
  const rest = { push: 0, pull: 0 }
  const credit: Credit = {}
  for (const b of built.blocks) {
    const loading = skillSetLoading(b.exerciseId, b.section)
    if (loading) addCredit(credit, loading.muscles, b.sets * (b.light ? 0.5 : 1) * (EXERCISE_BY_ID[b.exerciseId]?.perSide ? 0.5 : 1))
    if (b.section !== 'main' && b.section !== 'strength') continue
    const f = loading?.straightArm
    if (f) sets[f] += b.sets
    const r = restFamilyOf(b)
    if (r) rest[r] += b.sets
  }
  const painSafe = built.id.startsWith('pain-safe-recovery')
  const trained = (built.skills?.length ? built.skills : skills.slice(0, 1)) as SkillId[]
  const keyOf: BuiltSkill['key'] = {}
  for (const s of trained) keyOf[s] = keyHold(state, s, built.blocks).sets
  const attempts = built.blocks.reduce((sum, b) => sum + (b.role === 'bridge' || b.role === 'attempt' || b.retest ? b.sets : 0), 0)
  const out: BuiltSkill = { minutes: built.minutes, sets, rest, credit, key: keyOf, attempts, bare: trained.length ? keyHold(state, trained[0], built.blocks).kept : 0, skills: painSafe ? [] : trained, painSafe }
  memo.set(key, out)
  return out
}

/**
 * Whether a built session is a hard session of the push family for the rest rule only through its handstand
 * push-ups: three or more push sets with its hard presses counted (`BuiltSkill.rest`), short of a hard straight-arm
 * push part. Such a day is spaced from the planche's days as heavy gym pressing is, and is never one of the planche's
 * own sessions (CONSENSUS: shared recovery; the joints are INFERENCE).
 */
function pressesHard(b: BuiltSkill | undefined, families: ReadonlySet<Straight>): boolean {
  return Boolean(b) && !b!.painSafe && b!.rest.push >= 3 && !families.has('push')
}

/** A budget no session is trimmed against: the kept dose is read off a build this long. */
const UNTRIMMED_MINUTES = 240

/**
 * Whether the session a request builds keeps its lead's key-hold dose: every
 * set but the reach of the same skill's untrimmed session at the same moment.
 * A pain-safe or eased day has nothing to keep and keeps it.
 */
function keepsDose(state: AppState, skills: SkillId[], minutes: number, at: number, kit?: EquipmentId[]): boolean {
  const b = builtSkill(state, skills, minutes, at, kit)
  const lead = b.skills[0]
  if (!lead || b.painSafe) return true
  return (b.key[lead] ?? 0) >= builtSkill(state, [lead], UNTRIMMED_MINUTES, at, kit).bare
}

/** Main sets of each straight-arm family in the session a request builds, counted as a logged one is (`lastHardStraightArm`). */
function familySets(state: AppState, skills: SkillId[], minutes: number, at: number, kit?: EquipmentId[]): Record<Straight, number> {
  return builtSkill(state, skills, minutes, at, kit).sets
}

/** Whether a skill is the athlete's first priority. */
const isFirst = (state: AppState, skill: SkillId) => trainedSkills(state)[0] === skill

/** A gym day's opener minutes for this skill on a day of this many minutes (`openerMinutesFor`). */
function openerMinutesOf(state: AppState, skill: SkillId, dayMinutes: number, at: number, place: GymLocation, budgetFloor = 0): number {
  const prefs = state.gym?.prefs
  const budget = prefs?.shortSkillOpeners ? OPENER_MINUTES : Math.max(budgetFloor, openerMinutesFor(isFirst(state, skill), dayMinutes))
  const shareMinutes = prefs && prefs.goals.physique >= 3 && prefs.musclesPriority.length > 0
  if (skill !== 'frontlever' && !shareMinutes) return budget
  const practice = builtSkill(state, [skill], budget, at, kitAt(state, place), true)
  const fitted = Math.min(budget, Math.max(MIN_SKILL_MINUTES[1], practice.minutes))
  if (skill === 'frontlever' || fitted === budget) return fitted
  const rebuilt = builtSkill(state, [skill], fitted, at, kitAt(state, place), true)
  return rebuilt.key[skill] === practice.key[skill] && rebuilt.attempts === practice.attempts && rebuilt.rest.push === practice.rest.push &&
    rebuilt.rest.pull === practice.rest.pull && rebuilt.minutes === practice.minutes ? fitted : budget
}

/**
 * An opener block: the skill's ordinary one-skill session at its opener
 * minutes (`openerMinutesFor`), built with the whole kit at the place
 * (`kitAt`: its list and the athlete's portable kit), hard when it gives three
 * or more main sets of its family.
 */
function openerBlock(state: AppState, skill: SkillId, at: number, place: GymLocation, minutes: number): SkillBlock {
  const f = skillFamily(skill)
  const kit = kitAt(state, place)
  const hard = f !== 'balance' && builtSkill(state, [skill], minutes, at, kit, true).sets[f] >= 3
  return { minutes, skills: [skill], hard: hard ? [f as Straight] : [], opener: true, kit, placeId: place.id }
}

/** The request that starts a skill block — an opener with the place's kit beside the athlete's. */
export function skillRequest(block: Pick<SkillBlock, 'minutes' | 'skills' | 'kit' | 'opener'>): WorkoutRequest {
  return {
    source: 'auto', minutes: block.minutes, skills: block.skills,
    ...(block.opener && block.minutes < MIN_SKILL_MINUTES[1] && block.skills[0] === 'handstand' ? { focus: 'ladder' } : {}),
    ...(block.opener && (block.skills[0] === 'planche' || block.skills[0] === 'ninety') ? { deferPressing: true } : {}),
    ...(block.opener && block.skills[0] === 'frontlever' ? { deferPulling: true } : {}),
    ...(block.kit?.length ? { kit: block.kit } : {}),
  }
}

/** The state as seen from one place: the planner builds at the active one. */
function atPlace(state: AppState, location: GymLocation): AppState {
  const gym = state.gym
  if (!gym || gym.activeLocationId === location.id) return state
  return { ...state, gym: { ...gym, locations: [location, ...gym.locations.filter((l) => l.id !== location.id)], activeLocationId: location.id } }
}

/** A gym session for right now, as the coach plans it. */
export interface GymToday {
  /** Today planned as a gym day at these minutes, by the same engine as every other day. */
  plan: TodayPlan
  /** The lifts' focus: the athlete's pick, or the plan's. None when nothing fits today and nothing was picked. */
  focus?: GymFocus
  /** The day's limits, whichever focus: muscles kept out (the athlete's, and legs around sport), joints, volume, deload. */
  musclesOff: Muscle[]
  /** Muscles the week already has far past target: the builder leans away from them (`buildGymSession`'s `spare`). */
  spare: Muscle[]
  avoidJoints: Joint[]
  volumeFactor: number
  deload: boolean
  /** Muscles the week leaves furthest under target: the builder's priorities beside the athlete's own. */
  priority: Muscle[]
  /** The skill that goes first, when one does now. */
  opener?: SkillBlock
  /** Why a push, pull or upper session has no skill first. */
  noOpener?: string
  /** Why Auto has no focus. */
  noFocus?: string
  /** What limits the day, in a few words each. */
  limits: string[]
}

/**
 * Today's gym session as if today were a gym day, wherever it is started: the
 * Gym tab asks this rather than keeping a second rule set beside the plan (it
 * once took its focus from a rotation by session name and dropped the season,
 * sport, deload and knee rules on any day the plan had not made a gym day).
 * Auto is the plan's focus; a picked focus keeps every limit of the day. The
 * opener is the plan's — the rest rule on both sides, the week's own skill
 * days included — and never a second hard session of its family today (a 6 pm
 * push pick once opened with the planche after a hard planche session at 8).
 */
export function gymToday(state: AppState, opts: { now: number; minutes: number; focus?: GymFocus | 'auto'; location?: GymLocation }): GymToday {
  const now = opts.now
  const location = opts.location ?? weekdayPlace(state, now)
  const base = location ? atPlace(state, location) : state
  const picked = opts.focus && opts.focus !== 'auto' ? opts.focus : undefined
  const here = activePlace(base)
  const week = planWeekAhead(state, now, { todayMinutes: opts.minutes, todayKind: 'gym', ...(picked ? { todayFocus: picked } : {}), ...(here ? { todayPlace: here } : {}) })
  const plan = week.days[0].plan
  const own = base.gym?.prefs
  const prefs = own ?? defaultPrefs(now)
  const d = dayContexts(base, asTodayBegan(base, now), prefs, Boolean(own), now, addDays(startOfDay(now), 1), opts.minutes)[0]
  const focus = picked ?? plan.gym?.focus
  const g = plan.gym
  // No gym block in today's plan (the day is done, or the gym is picked after its main session): the session is still
  // steered by the week as planned (round six) — a second push session once offered every chest, front-delt and
  // triceps movement after the plan had said those were far past their weekly target.
  // A gym session already logged today is the day's own: the week's steer reads past it (it plans the days left), so a
  // second one is steered here the same way.
  const gymDoneToday = (base.gym?.sessions ?? []).some((x) => x.startedAt >= startOfDay(now) && x.startedAt <= now)
  const steered = (!g || gymDoneToday) && focus ? steerOutside(week.weekTotal, focus, d.off, prefs) : undefined
  const limits = g
    ? {
        musclesOff: g.musclesOff,
        spare: steered ? [...new Set([...(g.lightPress ? LIGHT_PRESS_SPARE : []), ...steered.spare])] : (g.spare ?? []),
        avoidJoints: g.avoidJoints,
        volumeFactor: g.volumeFactor,
        deload: g.deload,
        priority: steered ? steered.priority : (g.priority ?? []),
      }
    : {
        musclesOff: [...d.off],
        spare: steered?.spare ?? [],
        avoidJoints: d.liftJoints,
        volumeFactor: focus === 'athletic' ? Math.min(1, d.factor) : d.factor,
        deload: d.deload.due,
        priority: steered?.priority ?? [],
      }
  const place = activePlace(base)
  const restMs = prefs.straightArmRestHours * HOUR
  const t0 = startOfDay(now)
  const logged = familyEvents(base, now)
  const skills = trainedSkills(base)
  const work = (f: Straight) => (f === 'push' ? 'pressing' : 'pulling')
  /** Why the rest rule keeps a family's skill from going first now: logged hard sessions (today's included), then the week's own days. */
  const restWhy = (f: Straight): string | undefined => {
    if (d.sportRest[f]) return upperSportReason(f, d.sportRest[f]!)
    const names = familyNames(skills, f)
    const hit = logged[f].filter((e) => e.at <= now && insideRest(now, e.at, restMs)).pop()
    if (hit) {
      const what = hit.gym ? `heavy ${work(f)}` : hit.press ? HSPU_NAME : `hard ${names}`
      return hit.at >= t0
        ? `You did ${what} work earlier today, so the ${names} does not open a second session of it.`
        : `Your ${what} session ${Math.round((now - hit.at) / HOUR)}h ago is inside your ${prefs.straightArmRestHours}h rest rule, so the ${names} does not open today.`
    }
    const near = week.days
      .slice(1)
      .find((x) => apart(x.at, now) < restMs && ((x.plan.skill?.hard ?? []).includes(f) || (f === 'push' && Boolean(x.plan.skill?.presses))))
    if (!near) return undefined
    return (near.plan.skill?.hard ?? []).includes(f)
      ? `The ${names} is planned for ${dayName(near.at)}, inside your ${prefs.straightArmRestHours}h rest rule, so it does not open today.`
      : `Handstand push-ups are planned for ${dayName(near.at)}, inside your ${prefs.straightArmRestHours}h rest rule — pressing shares recovery with the ${names} — so it does not open today.`
  }
  /** A skill trained today already, hard or not: an opener of it is not offered a second time. */
  const doneToday = (skill: SkillId) =>
    base.sessions.some(
      (s) => s.startedAt >= t0 && s.startedAt <= now && s.sets.some((x) => x.section !== 'warmup' && x.section !== 'cooldown' && x.value > 0 && skillOfExercise(x.exerciseId) === skill),
    )
  const doneWhy = (skill: SkillId) => `You did your ${skillName(skill)} session earlier today, so the lifts start this one.`
  let opener = plan.skill?.opener ? plan.skill : undefined
  let noOpener: string | undefined
  if (opener) {
    // A balance skill opens only for its pressing (`openerFamily`): the push family's.
    const own = skillFamily(opener.skills[0])
    const f: Straight = own === 'balance' ? 'push' : own
    // Once an opener (or any session of its skill) is done today it is not offered again: a light one — under three
    // main sets, so no hard session — was, and starting the lifts ran the skill session a second time.
    if (logged[f].some((e) => e.at >= t0 && e.at <= now) || doneToday(opener.skills[0])) {
      noOpener = logged[f].some((e) => e.at >= t0 && e.at <= now) ? restWhy(f) : doneWhy(opener.skills[0])
      opener = undefined
    }
  } else if (focus && place && focusFamilies(focus).length) {
    const blocked = (f: Straight) => {
      const done = skills.find((s) => skillFamily(s) === f && doneToday(s))
      return done ? doneWhy(done) : restWhy(f)
    }
    noOpener = openerVerdict(base, focus, place, { minutes: opts.minutes, sore: d.avoidJoints, pain: d.pain, blocked }).why
    const candidate = skills.find((s) => (focusFamilies(focus) as string[]).includes(skillFamily(s)))
    if (!noOpener && candidate) {
      noOpener = `The lifts would not fit beside a ${openerMinutesOf(base, candidate, opts.minutes, now, place)}-minute skill opener in ${opts.minutes} minutes.`
    }
  }
  const notes: string[] = []
  const sport = d.sameDay ?? d.legsCovered ?? d.upcoming
  if (sport) {
    const when = d.sameDay ? (sport.at > now ? 'later today' : 'today') : d.legsCovered ? `on ${dayName(sport.at)}` : 'tomorrow'
    notes.push(`Legs out: ${namedSport(sport)} ${when}.`)
  }
  // A picked focus that presses (or pulls) inside the rest rule still builds — it is the athlete's pick — and says so.
  for (const f of picked ? focusFamilies(picked) : []) {
    const names = familyNames(skills, f)
    const hit = names ? logged[f].filter((e) => e.at < t0 && insideRest(now, e.at, restMs)).pop() : undefined
    if (!hit) continue
    const ago = Math.max(1, Math.round((now - hit.at) / HOUR))
    notes.push(
      `Heavy ${work(f)} shares recovery with ${hit.gym ? `your heavy ${work(f)} session` : hit.press ? `your ${HSPU_NAME} session` : `your hard ${names} session`} ${ago} h ago, inside your ${prefs.straightArmRestHours} h rest rule. It is your pick, so it stays; the coach's plan would leave it out today (a coaching convention).`,
    )
  }
  if (g?.lightPress && focus === g.focus) notes.push(`Light pressing: one press at two sets, beside your ${familyNames(skills, 'push')} days.`)
  if (d.pain) notes.push('Kept light: you reported pain.')
  if (limits.deload) notes.push('A lighter week.')
  if (d.away !== undefined) notes.push(`Back after ${d.away} days: fewer sets.`)
  if (prefs.season === 'in') notes.push('In season: fewer sets.')
  return {
    plan,
    ...(focus ? { focus } : {}),
    ...limits,
    ...(opener ? { opener } : {}),
    ...(noOpener ? { noOpener } : {}),
    ...(!focus ? { noFocus: `Nothing fits today’s rules${place ? ` at ${place.name}` : ''} in ${opts.minutes} minutes. Pick a focus, or start an empty session.` } : {}),
    limits: notes,
  }
}

/**
 * The week's steer for a gym session the plan did not hold (`gymToday` with no gym block today), read off the week as
 * planned (`WeekAhead.weekTotal`): the focus's muscles past the steer's line are spared, and the two it trains that the
 * week leaves furthest under target get priority. Never one of the athlete's own priorities, nor a muscle switched off
 * today. The lines are the app's own; the targets are coaching conventions.
 */
function steerOutside(total: Credit, focus: GymFocus, off: ReadonlySet<Muscle>, prefs: TrainingPrefs): { spare: Muscle[]; priority: Muscle[] } {
  if (focus === 'athletic') return { spare: [], priority: [] }
  const target = (m: Muscle) => volumeTarget(m, prefs)
  const mine = (m: Muscle) => !off.has(m) && !prefs.musclesPriority.includes(m)
  const spare = FOCUS_MUSCLES[focus].filter((m) => mine(m) && target(m)[1] > 0 && (total[m] ?? 0) > STEER_LINE * target(m)[1])
  const priority = (Object.keys(FOCUS_SHARE[focus]) as Muscle[])
    .filter((m) => mine(m) && !spare.includes(m) && target(m)[0] > 0 && (total[m] ?? 0) < target(m)[0] - 0.5)
    .sort((a, b) => (total[a] ?? 0) / target(a)[0] - (total[b] ?? 0) / target(b)[0])
    .slice(0, 2)
  return { spare, priority }
}

/**
 * What a gym session of this focus at this place opens with now, or nothing:
 * `gymToday`'s opener. `minutes` is the day's time for both blocks, the
 * scheduled minutes when not given. The opener is an ordinary one-skill
 * session (`skillRequest`), logged to the skill history like any other.
 */
export function gymOpener(state: AppState, focus: GymFocus, location: GymLocation, now = Date.now(), minutes?: number): SkillBlock | undefined {
  const own = state.gym?.prefs
  const scheduled = own ? (own.minutesByDay[weekdayOf(now)] ?? 0) : 0
  return gymToday(state, { now, minutes: minutes ?? (scheduled > 0 ? scheduled : state.settings.sessionMinutes), focus, location }).opener
}

/** A picked skill session inside the athlete's straight-arm rest rule (`insideRestRule`). */
export interface RestRuleHit {
  skill: SkillId
  family: Straight
  /** Hours since the last hard session of the family. */
  hours: number
  ruleHours: number
  /** The hard session was heavy pressing or pulling at the gym, not holds. */
  gym: boolean
  text: string
}

/**
 * Whether a session of these skills, picked by the athlete, sits inside their
 * straight-arm rest rule: the family's last hard session (holds, or heavy
 * pressing or pulling at the gym, as `familyEvents` counts them) under
 * `straightArmRestHours` ago. A pick still outranks the plan — this only says
 * so: a "Planche day" 20 h after a hard planche session once built a full
 * session and said nothing, while the plan rested the family and the Gym side
 * refused the opener. Balance skills have no rule.
 */
export function insideRestRule(
  state: AppState,
  skills: readonly SkillId[],
  now: number,
  request?: Pick<WorkoutRequest, 'minutes' | 'focus' | 'kit'>,
): RestRuleHit | undefined {
  const ruleHours = (state.gym?.prefs ?? defaultPrefs(now)).straightArmRestHours
  const logged = familyEvents(state, now)
  for (const skill of skills) {
    const own = skillFamily(skill)
    // A handstand session is balance work, unless its handstand push-ups make it a hard push session (`pressesHard`).
    const family: Straight | undefined = own !== 'balance' ? own : PRESS_SKILLS.has(skill) ? 'push' : undefined
    if (!family) continue
    const hit = logged[family].filter((e) => e.at <= now && insideRest(now, e.at, ruleHours * HOUR)).pop()
    if (!hit) continue
    const pressing = own === 'balance'
    if (pressing && !pickPresses(state, skill, now, request)) continue
    const hours = Math.max(1, Math.round((now - hit.at) / HOUR))
    const kin = trainedSkills(state).filter((s) => skillFamily(s) === family)
    const what = hit.gym
      ? `heavy ${family === 'push' ? 'pressing' : 'pulling'} session`
      : hit.press
        ? `${HSPU_NAME} session`
        : `hard ${kin.length === 1 ? skillName(kin[0]) : `straight-arm ${family}`} session`
    return {
      skill,
      family,
      hours,
      ruleHours,
      gym: hit.gym,
      text: pressing
        ? `Your last ${what} was ${hours} h ago — under your ${ruleHours} h rest rule, and today's handstand push-ups are pressing that shares those front delts, wrists and elbows (a coaching convention). It is your pick, so it stays; the coach's plan would leave them out today.`
        : `Your last ${what} was ${hours} h ago — under your ${ruleHours} h rest rule. It is your pick, so it stays; the coach's plan would rest it today.`,
    }
  }
  return undefined
}

/**
 * Whether a picked session of a pressing skill (`PRESS_SKILLS`) is a hard push session by the rest rule's count:
 * three or more push sets with its hard presses counted, built as the pick builds it (its minutes, a ladder day's
 * focus, its kit; the athlete's session length otherwise).
 */
function pickPresses(state: AppState, skill: SkillId, now: number, request?: Pick<WorkoutRequest, 'minutes' | 'focus' | 'kit'>): boolean {
  const built = finalizeWorkout(
    state,
    { source: 'auto', skills: [skill], minutes: request?.minutes ?? state.settings.sessionMinutes, ...(request?.focus ? { focus: request.focus } : {}), ...(request?.kit ? { kit: request.kit } : {}) },
    undefined,
    now,
  )
  if (built.id.startsWith('pain-safe-recovery')) return false
  return built.blocks.reduce((n, b) => n + (restFamilyOf(b) === 'push' ? b.sets : 0), 0) >= 3
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
  /** Skill practice fitted before the lifts, even when those lifts train different muscles. */
  practiceFirst?: true
  /** The place's kit (the opener's place, or the active place for a calisthenics day), added to the athlete's for that one build (`WorkoutRequest.kit`). */
  kit?: EquipmentId[]
  /** The place it is planned at, when that is not home: a gym day's opener, or a calisthenics day for kit only the gym has. */
  placeId?: string
  /** The session it builds is the pain-safe recovery one: it trains none of `skills` today. */
  painSafe?: true
  /** An opener a set or more short of the first priority's kept dose: half of one of its sessions this week. */
  half?: true
  /**
   * Its handstand push-ups make the session a hard push session for the rest rule (`pressesHard`): the days around it
   * keep the planche and heavy pressing off, as for a planche day. Not one of the planche's own sessions.
   */
  presses?: true
  /**
   * Each skill's role, parallel to `skills`: lead, partner, then a short dose (`maintenance`, or `practice` for balance
   * work). Absent on an opener, whose one skill leads.
   */
  roles?: LineupRole[]
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
  /**
   * The lifts. `priority` is the muscles the week leaves furthest under target: the builder's priorities beside the
   * athlete's own. `placeId` is where the day is planned: the gym place (`gymPlaceOf`), wherever the app is set now.
   */
  gym?: {
    minutes: number
    focus: GymFocus
    avoidJoints: Joint[]
    volumeFactor: number
    deload: boolean
    musclesOff: Muscle[]
    priority?: Muscle[]
    /**
     * Muscles the lifts lean away from (`buildGymSession`'s `spare`): those the week already has far past target, and
     * on a light pressing day (`lightPress`) the pressing muscles (`LIGHT_PRESS_SPARE`).
     */
    spare?: Muscle[]
    /**
     * The day presses lightly: one press at two sets, under `HARD_GYM_FAMILY_SETS`, because a push-family skill day
     * (or a heavy pressing day) sits inside the rest rule. Carried to the builder by `spare`; never a hard session.
     */
    lightPress?: true
    placeId?: string
  }
  /** How hard today is pitched (light / normal / push) and why. Today only; later days are planned as normal. */
  readiness?: DayReadiness
  /** Why the day looks the way it does, in the athlete's terms. */
  reasons: string[]
}

function joinNames(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/** The legs get the week's last leg day over a skill family's session once their last gym session is this old (the app's own line). */
export const LEG_DAY_EVERY_DAYS = 10

/** Three weeks or more without a gym session is time away (the app's own line). */
export const AWAY_DAYS = 21
/** A lift whose best estimated max fell this share from one week to the next calls a lighter week (a coaching convention). */
export const LIFT_DROP = 0.05
/** The most of the usual sets the first gym session back gets. */
export const AWAY_FACTOR = 0.8

/**
 * Calendar days since the last gym session at or before `at`, when that is
 * `AWAY_DAYS` or more; otherwise nothing. No gym session at all is a first
 * session, not time away (a first machine load is never guessed anyway).
 * Counted in calendar days, so a clock change cannot move it an hour either side.
 */
export function gymDaysAway(state: AppState, at: number): number | undefined {
  let last = -Infinity
  for (const s of state.gym?.sessions ?? []) if (s.startedAt <= at && s.startedAt > last) last = s.startedAt
  if (!Number.isFinite(last)) return undefined
  const days = Math.round((startOfDay(at) - startOfDay(last)) / DAY)
  return days >= AWAY_DAYS ? days : undefined
}

/** One calendar week of logged gym work, as the hard-run count reads it. */
interface GymWeekLog {
  sessions: GymSession[]
  sets: number
  judged: boolean
  avg: number
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
 *
 * A week the plan called lighter is a lighter week, whatever its sets: each
 * past week's own verdict is replayed from the first gym week (derived from
 * history, like every other decision). The lighter day keeps more than 70% of
 * the usual sets, so an unrated lighter week once counted as another hard one
 * and an under-18 athlete got a lighter week every week from the fourth.
 */
export function gymDeloadDue(state: AppState, now: number): { due: boolean; why?: string } {
  const startThis = weekStart(now)
  const byWeek = new Map<number, GymSession[]>()
  for (const s of state.gym?.sessions ?? []) {
    if (s.startedAt >= startThis) continue
    const w = weekStart(s.startedAt)
    const list = byWeek.get(w)
    if (list) list.push(s)
    else byWeek.set(w, [s])
  }
  if (!byWeek.size) return { due: false }
  const logs = new Map<number, GymWeekLog>()
  const logOf = (from: number): GymWeekLog => {
    const hit = logs.get(from)
    if (hit) return hit
    const inWeek = byWeek.get(from) ?? []
    const working = inWeek.flatMap((s) => s.exercises.flatMap((e) => e.sets.filter((x) => !x.warmup && x.reps > 0)))
    const rpes = working.filter((x) => x.rpe !== undefined).map((x) => x.rpe!)
    const judged = rpes.length >= MIN_RATED_SETS
    const log = { sessions: inWeek, sets: working.length, judged, avg: judged ? rpes.reduce((a, b) => a + b, 0) / rpes.length : 0 }
    logs.set(from, log)
    return log
  }
  const called = new Set<number>()
  let verdict: { due: boolean; why?: string } = { due: false }
  // No week before the first gym week can be hard, so none was called: the replay starts there.
  for (let w = addDays(Math.min(...byWeek.keys()), 7); w <= startThis; w = addDays(w, 7)) {
    verdict = deloadVerdictAt(state, w, w === startThis ? now : w, logOf, called)
    if (verdict.due) called.add(w)
  }
  return verdict
}

/** `gymDeloadDue` for the calendar week starting at `ref`, given which weeks before it were called lighter. */
function deloadVerdictAt(state: AppState, ref: number, at: number, logOf: (from: number) => GymWeekLog, called: Set<number>): { due: boolean; why?: string } {
  const youth = conservative(state.profile, at)
  const weeksNeeded = youth ? 3 : 5
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const from = addDays(ref, -7 * (i + 1))
    return { ...logOf(from), called: called.has(from) }
  })
  // A week well under the usual volume is a lighter week, however hard its
  // sets felt — it ends the run, or a deload logged at RPE 8 would call
  // another one every week after.
  const usual = Math.max(0, ...weeks.map((w) => w.sets))
  let hardRun = 0
  let unrated = 0
  for (const w of weeks) {
    if (!w.called && w.sessions.length >= 2 && w.sets >= 0.7 * usual && (!w.judged || w.avg >= 7.5)) {
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
  // Decided at the week's start, from the two calendar weeks before it, like
  // the hard run above: a lighter week called on Monday holds to Sunday. Read
  // from `now`, two lighter sessions switched it off by Wednesday.
  const bestByLift = (list: GymSession[]) => {
    const out = new Map<string, number>()
    for (const s of list) {
      for (const e of s.exercises) for (const x of e.sets) {
        if (x.warmup) continue
        const v = estimateOneRepMax(x, e.exerciseId)
        if (v !== null && v > (out.get(e.exerciseId) ?? 0)) out.set(e.exerciseId, v)
      }
    }
    return out
  }
  // A lift going backwards, lift by lift: its best estimated max 5% or more under the week before, whatever the
  // effort ratings say (falling lifts at RPE 8.5 never called a lighter week). Not after a lighter week, whose
  // lighter loads read as lower estimates. Falling performance as a sign of too little recovery is CONSENSUS.
  if (!weeks[0].called && !weeks[1].called) {
    const latest = bestByLift(weeks[0].sessions)
    const before = bestByLift(weeks[1].sessions)
    const fell = [...latest.keys()]
      .filter((id) => before.has(id) && latest.get(id)! <= (1 - LIFT_DROP) * before.get(id)!)
      .sort((a, b) => latest.get(a)! / before.get(a)! - latest.get(b)! / before.get(b)!)
    if (fell.length) {
      const id = fell[0]
      const pct = Math.round((1 - latest.get(id)! / before.get(id)!) * 100)
      return {
        due: true,
        why: `Your estimated max on the ${GYM_EXERCISE_BY_ID[id]?.name.toLowerCase() ?? 'lift'} fell ${pct}% from one week to the next: this week is lighter — fewer sets, stopping further from failure — then build again. Lifts going backwards are a common coaching sign that recovery is behind (a coaching convention, not a proven rule).`,
      }
    }
  }
  const recent = [...weeks[1].sessions, ...weeks[0].sessions]
  const recentRpe = recent.flatMap((s) => s.exercises.flatMap((e) => e.sets.filter((x) => !x.warmup && x.rpe !== undefined).map((x) => x.rpe!)))
  if (recent.length >= 3 && recentRpe.length >= 12) {
    const avg = recentRpe.reduce((a, b) => a + b, 0) / recentRpe.length
    // Effort up while the estimated maxes did not move: the same work is costing more.
    // Lift by lift, and only lifts with an estimate in both weeks: no estimate
    // is not "held still", and a lift skipped this week did not stall (the
    // heaviest lift of all left out once read as every max holding still).
    const thisWeek = bestByLift(weeks[0].sessions)
    const lastWeek = bestByLift(weeks[1].sessions)
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
  /**
   * Why it rests: the gym schedule, the athlete's week plan, a weekly goal
   * already met, or — without a gym schedule — a day between the sessions the
   * weekly goal spreads over the week.
   */
  restWhy?: 'schedule' | 'plan' | 'goal' | 'spread'
  /** The skills the athlete's own week plan gives this day, in their order (those that can train). */
  assigned?: SkillId[]
  sport: SportEvent[]
  sportRest: Partial<Record<Straight, SportEvent>>
  /** Sport on an earlier day, in the last 48 h, that loaded the legs (logged, or a hard one from the sport week). */
  legsCovered?: SportEvent
  /** Sport on this calendar day that loads the legs, before or after the planned moment alike. */
  sameDay?: SportEvent
  /** Sport on a later day, in the next 36 h, the legs stay fresh for. */
  upcoming?: SportEvent
  hardBefore?: SportEvent
  hardNext?: SportEvent
  reports: Answer[]
  avoidJoints: Joint[]
  /** The latest report, older than 72 hours, that the skill side still treats as current (`standingReport`). */
  held?: Answer
  /**
   * The latest report while it is not "all good", however old (`standingReport`): what the skill side — the coach's
   * open concern and the line-up's niggle steering (`standingNiggle`) — still reads. A later all-good check-in ends it;
   * the lifts keep their 72-hour union.
   */
  standing?: Answer
  /** Joints the gym's lifts keep out: `avoidJoints`, and the held report's. */
  liftJoints: Joint[]
  pain: boolean
  niggle: boolean
  deload: { due: boolean; why?: string }
  /** Today only: calendar days since the last gym session, when that is `AWAY_DAYS` or more. */
  away?: number
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
  sport?: SportEvent
}

function upperSportReason(family: Straight, event: SportEvent): string {
  const work = family === 'push' ? 'pressing' : 'pulling and grip work'
  const name = event.movedFrom ? cap(namedSport(event)) : `Your ${sportName(event.kind)}`
  return `${name} on ${dayName(event.at)} loads the same muscles. Hard ${work} gets a break today.`
}

const sportRestsSkill = (day: DayCtx, skill: SkillId) => day.sportRest[skillFamily(skill) === 'pull' ? 'pull' : 'push']

/** Pressing is said by what it was: handstand push-ups, heavy gym pressing, or the family's holds. */
const HSPU_NAME = 'handstand push-up'

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
  | 'exposure'
  | 'exposure-opener'
  | 'legs'
  | 'leg-coverage'
  | 'skill-practice'
  | 'reserved-lifts'
  | 'lifting-place'
  | 'rotate-skills'

interface SkillSlot {
  workingSets?: Partial<Record<SkillId, number>>
  /** A practice block that shares the day with lifting independently of the lifting focus. */
  reservedOpener?: { skill: SkillId; minutes: number }
  /** The day's one main session. */
  kind: DayKind
  why?: KindWhy
  /** One of the first priority's sessions: every day its rest rule allows is its day (`reserveExposures`). */
  exposure?: boolean
  /** The place a calisthenics day is planned at when it is not home: the gym, for kit only it has. */
  placeId?: string
  /** The skill block builds the pain-safe recovery session. */
  painSafe?: boolean
  /** The first priority's opener a set or more short of its kept dose: half of one of its sessions this week. */
  half?: boolean
  /** Today only: the other kind the day could be. */
  alternative?: 'calisthenics' | 'gym'
  skillMin: number
  gymMin: number
  /** The skill block's line-up, in role order: lead, partner, short dose (a gym day's opener alone). */
  skills: SkillId[]
  parts: Part[]
  /** Straight-arm families this day trains hard: its full parts (or its opener) that reach the hard-session count. */
  families: Set<Straight>
  /** The day's session is a hard push session for the rest rule through its handstand push-ups (`pressesHard`). */
  presses?: boolean
  /** Families resting today under the rest rule, and the session that rests them. */
  blocked: Partial<Record<Straight, FamilyBlock>>
  /** The week's last day the sport leaves the legs fresh, given to the gym for them (`why: 'legs'`). */
  legDay?: boolean
  /** The week's only lifting session should cover the upper and lower body together. */
  wholeBody?: boolean
  /** The week traded one otherwise available skill day for requested leg work. */
  sharedSkillDay?: boolean
  /** The family a calisthenics day was chosen for, to reach its sessions this week. */
  urgent?: Straight
  /** A gym day chosen to open with this family's skill, for its sessions this week: its focus trains that family. */
  hint?: Straight
  /** The skill a gym day opens with, once its focus is known. */
  opener?: SkillId
  /** The gym's weekly sets need this day: gym days still needed, and open days left after it. */
  setsNeed?: { need: number; left: number }
  noSkillFits: boolean
  /** None of the athlete's skills has its kit in their own list, so no calisthenics day can be planned. */
  noKit?: boolean
  /** Nothing fits the minutes. */
  tooShort?: boolean
  /** Hard sessions of each family this calendar week, up to and including this day. */
  count: Record<Straight, number>
  credit: Credit
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
function dayContexts(state: AppState, base: AppState, prefs: TrainingPrefs, own: boolean, now: number, horizonEnd: number, todayMinutes?: number): DayCtx[] {
  const today = startOfDay(now)
  const thisWeek = weekStart(now)
  // Days trained this week before a given moment (skill or gym), for the weekly goal.
  const trainedDays = (before: number) =>
    new Set(
      [
        ...state.sessions.filter(countsSkillDay).map((s) => s.startedAt),
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
  const goal = state.settings.weeklyGoal
  // Without a gym schedule the weekly goal says how many days train: each
  // calendar week's open days are spread over what the goal still needs, today
  // first (the athlete is here), the athlete's own skill days counted toward
  // it. Every day at the session length once planned seven training days for a
  // goal of three.
  const between = new Map<string, 'goal' | 'spread'>()
  if (!own && goal > 0) {
    const trainedOn = (t: number) =>
      state.sessions.some((s) => s.startedAt >= t && s.startedAt < addDays(t, 1) && s.startedAt <= now && countsSkillDay(s)) ||
      (state.gym?.sessions ?? []).some((s) => s.startedAt >= t && s.startedAt < addDays(t, 1) && s.startedAt <= now)
    const spread = (need: number, open: number[]) =>
      new Set(need >= open.length ? open : need <= 0 ? [] : Array.from({ length: need }, (_, k) => open[Math.floor((k * open.length) / need)]))
    for (let wk = thisWeek; wk < horizonEnd; wk = addDays(wk, 7)) {
      let need = goal - (wk === thisWeek ? trainedDays(today) : 0)
      const open: number[] = []
      for (let t = Math.max(wk, today); t < addDays(wk, 7) && t < horizonEnd; t = addDays(t, 1)) {
        const reading = state.settings.weekPlan ? readDay(state, weekdayOf(t)) : undefined
        if (reading?.kind === 'rest') continue
        if (reading?.kind === 'skills') need--
        else open.push(t)
      }
      // Spread as the day began: a session logged today on a day the spread kept is that day's, and moves nothing —
      // counted again, it once re-spread the rest of the week (Monday done, Wednesday's session moved to Tuesday).
      // Only a session on a day it had left as rest is counted on its own, and the days after it are spread again.
      let keep = spread(need, open)
      if (wk === thisWeek && open.includes(today) && !keep.has(today) && trainedOn(today)) {
        open.splice(open.indexOf(today), 1)
        need--
        keep = spread(need, open)
      }
      const met = (wk === thisWeek ? trainedDays(today) + (trainedOn(today) ? 1 : 0) : 0) >= goal
      for (const t of open) if (!keep.has(t)) between.set(dayKey(t), met ? 'goal' : 'spread')
    }
  }
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
    const spread = between.get(dayKey(start))
    const upperRest = prefs.straightArmRestHours * HOUR
    const near = sportBetween(state.gym, at - Math.max(48 * HOUR, upperRest), at + 36 * HOUR)
    const loadsLegs = isHardForLegs
    const end = addDays(start, 1)
    // Sport on the day itself is one rule whatever the clock says: a 17:00 game
    // once counted as "upcoming" only when the day was planned before 17:00,
    // and as already played (no lighter gym) when it was planned at 17:00.
    const sameDay = sportBetween(state.gym, start, end).filter(loadsLegs).pop()
    const legsCovered = near.filter((a) => a.at < start && at - a.at < 48 * HOUR && loadsLegs(a)).pop()
    // Tomorrow is the next calendar day whatever the clock says: planned at 21:00 on a Thursday, a Saturday 08:00
    // game was inside the next 36 hours and was called "tomorrow", while the same plan at 08:00 kept legs in.
    const upcoming = sportBetween(state.gym, end, addDays(end, 1)).filter(loadsLegs)[0]
    const yesterday = addDays(start, -1)
    const hardBefore = near.filter((a) => a.at <= at && a.at >= yesterday && isHardSport(a)).pop()
    const hardNext = near.find((a) => a.at > at && isHardSport(a))
    const sportRest: DayCtx['sportRest'] = {}
    // Use the athlete's usual upper-body rest interval after hard sport and protect the day before it.
    const upperEvents = near.filter((a) => isHardSport(a) && at - a.at < upperRest && a.at <= at + 24 * HOUR)
      .sort((a, b) => Math.abs(at - a.at) - Math.abs(at - b.at))
    for (const a of upperEvents) {
      if (a.upperPush) sportRest.push ??= a
      if (a.upperPull) sportRest.pull ??= a
    }
    const reports = timeline.filter((a) => a.at <= at && at - a.at < 72 * HOUR && a.joints !== 'good')
    const avoidJoints = jointsOf(reports)
    const standing = standingReport(timeline, at)
    const held = standing && !reports.includes(standing) ? standing : undefined
    const liftJoints = held ? [...new Set([...avoidJoints, ...jointsOf([held])])] : avoidJoints
    const pain = reports.some((a) => a.joints === 'pain' && at - a.at < 48 * HOUR)
    const niggle = reports.some((a) => a.joints === 'niggle')
    const week = weekStart(start)
    if (!deloads.has(week)) deloads.set(week, gymDeloadDue(state, week === weekStart(now) ? now : at))
    const deload = deloads.get(week)!
    // The first gym session after time away is lighter. Today only, like
    // readiness: a later day is planned as normal and planned again when it comes.
    const away = i === 0 ? gymDaysAway(base, at) : undefined
    // The day of the sport takes the day-before rule: legs out and the gym a little lighter.
    let factor = Math.min(pain ? 0.6 : deload.due ? 0.6 : 1, inSeason ? 0.7 : 1, upcoming || sameDay ? 0.8 : 1, away !== undefined ? AWAY_FACTOR : 1)
    const restWhy: DayCtx['restWhy'] = reading?.kind === 'rest' ? 'plan' : scheduled <= 0 ? 'schedule' : spread
    const restDay = !given && restWhy !== undefined
    let readiness =
      i === 0 && !restDay && minutes > 0
        ? dayReadiness(base, now, { pain, niggle: reports.length > 0, deload: deload.due, inSeason, hardSportBefore: hardBefore, hardSportNext: hardNext })
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
      sportRest,
      ...(legsCovered ? { legsCovered } : {}),
      ...(sameDay ? { sameDay } : {}),
      ...(upcoming ? { upcoming } : {}),
      ...(hardBefore ? { hardBefore } : {}),
      ...(hardNext ? { hardNext } : {}),
      reports,
      avoidJoints,
      ...(held ? { held } : {}),
      ...(standing ? { standing } : {}),
      liftJoints,
      pain,
      niggle,
      deload,
      ...(away !== undefined ? { away } : {}),
      ...(readiness ? { readiness } : {}),
      factor,
      off: new Set<Muscle>([...prefs.musclesOff, ...(legsCovered || sameDay || upcoming ? LEG_MUSCLES : []),
        ...(sportRest.push ? SPORT_UPPER_MUSCLES.push : []), ...(sportRest.pull ? SPORT_UPPER_MUSCLES.pull : [])]),
      // As today began: a session the plan put on today is part of the plan, not news that changes it.
      fatigue: fatigueAt(base, at).muscles,
    })
  }
  return out
}

/** What the skill side of planning needs beside the days. */
interface SkillCtx {
  liftingPlaceDate?: string
  coverLegWeeks?: number[]
  restMs: number
  /** Whether the gym's goals train the legs: they are switched on and have a weekly target. */
  legsWanted: boolean
  /** Whether a lower-body gym block builds on this day at all (open by the sport and joint rules, and viable). */
  legsOpen: (d: DayCtx) => boolean
  /** When the legs last had a gym session (squats, hinges, lunges), or never. */
  legsLast?: number
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
  /** Where day `i`'s gym block is planned (`gymPlaceOf`; today, the place the Gym tab is at). */
  placeAt: (i: number) => GymLocation | undefined
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
  /** Today's gym focus, when the athlete picked one: a picked gym day opens with a skill of its families only. */
  todayFocus?: GymFocus
}

/** What a day's line-up is chosen with, beside its minutes. */
interface LineupOpts {
  /** One of the first priority's days: it leads, and what joins it may not cost its key hold a set (`exposureParts`). */
  exposure?: boolean
  /** Days since a skill last had a full part, logged or planned on an earlier day: whose turn a one-skill day is. */
  since?: (skill: SkillId) => number | null
}

/** A skill never trained in full is this many days overdue, as the line-up counts it (`todaysLineup`). */
const NEVER_TRAINED_DAYS = 30

/**
 * Whose turn a one-skill day is, among the skills free to train it: the
 * line-up's own rule (`todaysLineup`) — days since a full part, plus one, times
 * the athlete's order (the first priority counts double, each skill after it
 * 1/rank) — counted from what is logged and what the week has already planned.
 * The week once handed every such day to the front lever by its family's
 * target, and over four weeks of 20-minute days the handstand had none.
 */
function turnOf(order: SkillId[], allowed: SkillId[], since: (skill: SkillId) => number | null): SkillId | undefined {
  return allowed
    .map((skill) => {
      const rank = Math.max(0, order.indexOf(skill))
      const weight = rank === 0 ? 2 : 1 / rank
      return { skill, rank, score: ((since(skill) ?? NEVER_TRAINED_DAYS) + 1) * weight }
    })
    .sort((a, b) => b.score - a.score || a.rank - b.rank)[0]?.skill
}

/** Parts called hard by the session they build: three or more main sets of the family, for a lead or a partner. */
function markHard(state: AppState, at: number, parts: Part[], minutes: number): Part[] {
  const sets = familySets(state, parts.map((x) => x.skill), minutes, at)
  return parts.map((x) => {
    const f = skillFamily(x.skill)
    return { ...x, hard: (x.role === 'lead' || x.role === 'partner') && f !== 'balance' && sets[f] >= 3 }
  })
}

/**
 * The first priority's day, as its line-up: whatever joins it — a partner, a
 * short dose — stays while the first priority keeps its working dose.
 * A longer solo session can add an optional reach set beyond that dose.
 */
function exposureParts(state: AppState, at: number, parts: Part[], minutes: number): Part[] {
  const lead = parts[0]?.skill
  if (!lead || parts.length === 1) return parts
  const alone = Math.min(builtSkill(state, [lead], minutes, at).key[lead] ?? 0, builtSkill(state, [lead], UNTRIMMED_MINUTES, at).bare)
  const trials = [parts, parts.filter((p) => p.role !== 'maintenance' && p.role !== 'practice'), parts.filter((p) => p.role !== 'partner'), parts.slice(0, 1)]
  for (const trial of trials) {
    if (trial.length === 1) return trial
    if ((builtSkill(state, trial.map((p) => p.skill), minutes, at).key[lead] ?? 0) >= alone) return trial
  }
  return parts.slice(0, 1)
}

/**
 * The line-up for a skill block of `minutes`: the day as the athlete wrote it,
 * or the coach's pick among `allowed`. Hard is what the session this block
 * starts holds, counted the way the app counts a logged one
 * (`lastHardStraightArm`): three or more main sets of the family. A second
 * skill in a short block gets two sets of its hold (measured: under 35 minutes
 * beside the lead, under 40 with a short dose too), and a planche at
 * Foundations holds a scapula position, so neither is called hard — the
 * line-up rules alone could not say so. A block with room for one skill is the
 * first priority's on its own days and goes by turns otherwise (`turnOf`).
 */
function lineupParts(state: AppState, d: DayCtx, allowed: SkillId[], minutes: number, opts: LineupOpts = {}): Part[] {
  if (d.sportRest.push || d.sportRest.pull) allowed = allowed.filter((skill) => !sportRestsSkill(d, skill))
  if (minutes < OPENER_MINUTES) {
    allowed = allowed.filter((s) => builtSkill(state, [s], minutes, d.at, placeKit(state)).minutes <= minutes)
  }
  if (!allowed.length || roomFor(minutes) === 0) return []
  const order = trainedSkills(state)
  if (roomFor(minutes) === 1 && !d.assigned) {
    const lead = opts.exposure && allowed.includes(order[0]) ? order[0] : turnOf(order, allowed, opts.since ?? (() => null))
    return lead ? markHard(state, d.at, [{ skill: lead, role: 'lead', hard: false }], minutes) : []
  }
  const view = d.assigned ? state : { ...state, profile: { ...state.profile, skills: allowed } }
  const entries = todaysLineup(view, d.at, minutes).filter((e) => allowed.includes(e.skill))
  const first = entries.find((e) => e.role === 'lead')
  if (!first) return []
  const partner = entries.find((e) => e.role === 'partner')
  // An explicit request gives roles by position (lead, partner, short dose) and holds three at most.
  const dose = partner ? entries.find((e) => e.role === 'maintenance' || e.role === 'practice') : undefined
  let out: Part[] = [{ skill: first.skill, role: 'lead', hard: false }]
  if (partner) out.push({ skill: partner.skill, role: 'partner', hard: false })
  if (dose) out.push({ skill: dose.skill, role: skillFamily(dose.skill) === 'balance' ? 'practice' : 'maintenance', hard: false })
  if (opts.exposure && first.skill === order[0]) out = exposureParts(state, d.at, out, minutes)
  return markHard(state, d.at, out, minutes)
}

/**
 * Whether a skill's session at its current step can be a hard straight-arm
 * session by the app's own count: its key hold loads the family (a planche at
 * Foundations holds a scapula position, not a planche) and its kit is there.
 */
function hardAtStep(state: AppState, skill: SkillId, kit: EquipmentId[] = state.profile.equipment): boolean {
  const f = skillFamily(skill)
  if (f === 'balance' || missingSkillKit(state, skill, kit).length > 0) return false
  const step = STEP_BY_ID[skillView(state, skill).stepId]
  return Boolean(step) && skillSetLoading(step.keyExerciseId, 'main')?.straightArm === f
}

/** Whether a logged session gave a skill a full part: led it or partnered it (any work of it, from before roles were kept). */
function fullPartIn(s: Session, skill: SkillId): boolean {
  if (s.roles) return s.roles[skill] === 'lead' || s.roles[skill] === 'partner'
  return s.sets.some((set) => set.section !== 'warmup' && set.section !== 'cooldown' && set.value > 0 && skillOfExercise(set.exerciseId) === skill)
}

/**
 * Where each day's skill work is built. Calisthenics happens where the athlete
 * is: today with their kit and the active place's, every later day at home with
 * their own — a front lever planned for a later day once assumed the gym's bar
 * because the app was set to the gym that afternoon. A day for a skill whose
 * kit only the gym has is planned at the gym (`gymCal`), and says so.
 */
interface Places {
  /** A chosen location rules out moving this day's training to another gym. */
  fixed: (i: number) => boolean
  /** The view day `i`'s calisthenics session is built from. Today's leaves out today's own sessions (`asTodayBegan`). */
  cal: (i: number) => AppState
  /** The gym place's view (its kit and the athlete's portable kit), for a calisthenics day there. */
  gymCal?: AppState
  /** The place gym days are planned at (`gymPlaceOf`). */
  gym?: GymLocation
}

/**
 * Each day's one main session — calisthenics, the gym, or nothing — and, for a
 * calisthenics day, which skills. The athlete's own week plan is placed first
 * and trained as written. Then the first priority's days: every training day
 * its rest rule allows (`reserveExposures`), as many as it would get if it were
 * the only skill — its calisthenics day, or a gym day it opens with its kept
 * dose. Then every other day, in order (`decide`), where the lower priorities
 * and the gym fill what the first priority cannot use. Hard sessions of one
 * family (skill holds, heavy pressing or pulling, logged or planned) sit at
 * least the rest rule apart on different days, in both directions; a gym day's
 * opener shares its day with the gym's own pressing or pulling. What a block
 * trains is the line-up's own answer for those minutes (lead, partner, short
 * dose), so nothing is claimed that the session will not hold. The gym's focus,
 * and so each opener, is chosen after (`allocate`).
 */
function planSkills(state: AppState, places: Places, prefs: TrainingPrefs, days: DayCtx[], skills: SkillId[], ctx: SkillCtx): SkillSlot[] {
  const g = prefs.goals
  const today = days[0].start
  const thisWeek = days[0].week
  const done = hardCount(state.sessions, thisWeek, today)
  const first = skills[0]
  const lead = skillFamily(first)
  const trainingDays = prefs.minutesByDay.filter((m) => m >= MIN_SKILL_MINUTES[1]).length
  const shortWeek = trainingDays <= 3
  const gymGoal = Math.max(g.strength, g.physique, g.power, g.endurance)
  const gymFirst = ctx.wantsGym && g.skills > 0 && gymGoal >= g.skills + 2 &&
    prefs.minutesByDay.some((m) => m >= OPENER_MINUTES + MIN_LIFTS_AFTER_OPENER)
  const skillDays = Math.max(1, Math.ceil(trainingDays * ctx.share))
  const practiceDays = Math.max(1, Math.min(trainingDays - 1, Math.round(trainingDays * ctx.share)))
  const target = (f: Straight) => (f === lead ? FAMILY_SESSIONS_LEAD : FAMILY_SESSIONS_OTHER)
  // Whether each skill's session at its current step reaches the hard count at all (with the kit it has anywhere).
  const anyKit = [...new Set([...state.profile.equipment, ...(places.gymCal?.profile.equipment ?? []),
    ...days.flatMap((_, i) => places.fixed(i) ? places.cal(i).profile.equipment : [])])]
  const keyHard = new Map<SkillId, boolean>()
  const stepIsHard = (skill: SkillId) => {
    if (!keyHard.has(skill)) keyHard.set(skill, hardAtStep(state, skill, anyKit))
    return keyHard.get(skill)!
  }
  // Straight-arm sessions planned so far, by family — every full part of a push
  // or pull skill, hard by the count or not, so skill days keep the rest rule
  // between them as they always have, and every gym day chosen to open with a
  // family's skill: the athlete's own days first, then the first priority's,
  // then each open day.
  const planned: Record<Straight, { i: number; at: number; press?: true }[]> = { push: [], pull: [] }
  /** The hard session of a family on another day inside the rest rule, nearest first; today's own sessions do not rest today. */
  const conflict = (f: Straight, i: number): FamilyBlock | undefined => {
    const d = days[i]
    const sport = d.sportRest[f]
    if (sport) return { at: sport.at, gym: false, planned: sport.scheduled, sport }
    const near: FamilyBlock[] = [
      ...ctx.logged[f].filter((e) => e.at < d.start && insideRest(d.at, e.at, ctx.restMs)).map((e) => ({ ...e, planned: false })),
      ...planned[f]
        .filter((x) => x.i !== i && apart(days[x.i].at, d.at) < ctx.restMs)
        .map((x) => ({ at: days[x.i].at, gym: false, planned: true, ...(x.press ? { press: true as const } : {}) })),
    ]
    return near.sort((a, b) => Math.abs(d.at - a.at) - Math.abs(d.at - b.at))[0]
  }
  /** Whether a skill's kit is in a view's list: only those can hold a calisthenics day there. */
  const kitMemo = new WeakMap<AppState, Map<SkillId, boolean>>()
  const trains = (view: AppState, skill: SkillId) => {
    let memo = kitMemo.get(view)
    if (!memo) kitMemo.set(view, (memo = new Map()))
    if (!memo.has(skill)) memo.set(skill, canTrainAtHome(view, skill))
    return memo.get(skill)!
  }
  const canMove = (i: number) => !places.fixed(i)
  const available = (s: SkillId, i: number) => trains(places.cal(i), s) || Boolean(canMove(i) && places.gymCal && trains(places.gymCal, s))
  const noKit = !skills.some((s) => days.some((d, i) => !d.restDay && available(s, i)))
  /**
   * Open days after `i` this week a family could still train hard, spaced by
   * the rest rule. Today is read from what came before it, so its choice holds
   * still once its first block is logged.
   */
  const feasibleAfter = (f: Straight, i: number) => {
    const before = [
      ...ctx.logged[f]
        .map((e) => e.at)
        .filter((x) => (i === 0 ? x < days[0].start : x <= days[i].at))
        .map((at) => ({ at, logged: true })),
      ...planned[f].filter((x) => x.i <= i).map((x) => ({ at: days[x.i].at, logged: false })),
    ].sort((a, b) => a.at - b.at)
    let l = before[before.length - 1]
    let k = 0
    for (let j = i + 1; j < days.length && days[j].week === days[i].week; j++) {
      const dj = days[j]
      if (dj.restDay || dj.assigned || dj.minutes < MIN_SKILL_MINUTES[1]) continue
      if (places.fixed(j) && !skills.some((s) => skillFamily(s) === f && available(s, j))) continue
      // The first priority's days are its own: another family cannot lead one.
      if (f !== lead && exposures.has(j)) continue
      const clear = !planned[f].some((x) => x.i !== j && apart(days[x.i].at, dj.at) < ctx.restMs)
      if ((l === undefined || (l.logged ? !insideRest(dj.at, l.at, ctx.restMs) : apart(dj.at, l.at) >= ctx.restMs)) && clear) {
        k++
        l = { at: dj.at, logged: false }
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
   * Whether day `i` is the week's last chance for the legs: they are wanted and under target, the sport leaves
   * them fresh today, and no later open training day of the week does. The app's own rule around sport.
   */
  const legsLastChance = (i: number) => {
    const d = days[i]
    if (!ctx.legsWanted || exposures.has(i) || !ctx.legsOpen(d) || groupNeed(i).lower <= 0) return false
    for (let j = i + 1; j < days.length && days[j].week === d.week; j++) {
      const dj = days[j]
      if (!dj.restDay && !dj.assigned && !exposures.has(j) && dj.minutes >= MIN_GYM_MINUTES && ctx.legsOpen(dj)) return false
    }
    return true
  }
  /** Calendar days since the legs' last gym session on day `i`: logged, or a leg day planned on an earlier day. */
  const legsWaited = (i: number) => {
    let last = ctx.legsLast
    for (let j = i - 1; j >= 0; j--) {
      if (slots[j]?.legDay) {
        last = Math.max(last ?? -Infinity, days[j].start)
        break
      }
    }
    return last === undefined ? Infinity : Math.round((days[i].start - startOfDay(last)) / DAY)
  }
  /** The skill a gym day of a family opens with: its highest priority (`openerSkill` picks the same one when it is clear). */
  const openerOf = (f: Straight) => skills.find((s) => skillFamily(s) === f) ?? (f === 'push' ? skills.find((s) => PRESS_SKILLS.has(s)) : undefined)
  /** Whether a decided day gives a skill a full part: it leads or partners a calisthenics day, or opens a gym day planned for its family. */
  const fullOn = (sl: SkillSlot | undefined, skill: SkillId) =>
    Boolean(sl) && (sl!.parts.some((p) => p.skill === skill && (p.role === 'lead' || p.role === 'partner')) || (sl!.kind === 'gym' && sl!.hint !== undefined && openerOf(sl!.hint) === skill))
  const loggedFull = (skill: SkillId, week: number) =>
    state.sessions.some((s) => s.startedAt >= week && s.startedAt < today && s.startedAt < addDays(week, 7) && fullPartIn(s, skill))
  /** Calendar days since a skill's last full part on day `i`: logged, or planned on an earlier day of the horizon. */
  const sinceFull = (i: number) => (skill: SkillId): number | null => {
    const d = days[i]
    const logged = daysSinceFullPart(places.cal(i), skill, d.at)
    let ahead: number | null = null
    for (let j = i - 1; j >= 0; j--) {
      if (fullOn(slots[j], skill)) {
        ahead = Math.round((d.start - days[j].start) / DAY)
        break
      }
    }
    return logged === null ? ahead : ahead === null ? logged : Math.min(logged, ahead)
  }

  // ——— The first priority's days ———
  // Every training day its rest rule allows, greedily from its last hard session of the family (logged, or the
  // athlete's own days): the days it would train if it were the only skill. A heavy pressing session counts as one
  // (shared recovery), so the gym never takes one of these slots on another day. CONSENSUS frequency; the rule
  // and its order are the app's own.
  const exposures = new Set<number>()
  const lowerDays = new Set<number>()
  const sharedSkillDays = new Set<number>()
  // Days of this week before today that held both the first priority's hard session and a gym session: its openers.
  const openedBefore = (() => {
    const keys = new Set<string>()
    for (const e of ctx.logged[lead === 'balance' ? 'push' : lead]) {
      if (e.gym || e.at < thisWeek || e.at >= today) continue
      if ((state.gym?.sessions ?? []).some((g) => dayKey(g.startedAt) === dayKey(e.at))) keys.add(dayKey(e.at))
    }
    return keys.size
  })()
  /**
   * Whether day `i`, one of the first priority's, may be a gym day it opens. Its own calisthenics day carries its
   * whole session — the key hold's reach as well, two sets of six at a five-second target — and an opener its kept
   * dose, so the opener is the week's one only: never with fewer than three of its days in the calendar week, and
   * never a second. Two openers a week under a 72 h rule held the planche at three quarters of a planche-only
   * athlete's sets; the gym's pressing waits for the week's one opener day. The app's own rule.
   */
  const openerAllowed = (i: number) => {
    const wk = days[i].week
    const mine = [...exposures].filter((j) => days[j].week === wk)
    const before = wk === thisWeek ? done[lead as Straight] : 0
    const taken = (wk === thisWeek ? openedBefore : 0) + mine.filter((j) => j !== i && slots[j]?.kind === 'gym' && slots[j]?.hint === lead).length
    if (gymFirst) return skillDays === 1 || (taken === 0 && before + mine.length > 1)
    const sharedWeek = [...lowerDays].some((j) => days[j].week === wk)
    return before + mine.length >= (sharedWeek ? 2 : 3) && taken === 0
  }
  /** Whether the first priority can train on day `i` at all: its kit at home that day, or at the gym. */
  const holdsFirst = (i: number) => available(first, i)
  const reserveExposures = () => {
    if (lead === 'balance' || g.skills <= 0 || !stepIsHard(first)) return
    for (let i = 0; i < days.length; i++) {
      const d = days[i]
      if (d.restDay || d.minutes < MIN_SKILL_MINUTES[1] || d.assigned || d.sportRest[lead] || !holdsFirst(i)) continue
      // Today picked as a gym day of another family is not the first priority's: the pick stands.
      if (i === 0 && ctx.todayKind === 'gym' && ctx.todayFocus && !focusFamilies(ctx.todayFocus).includes(lead as Straight)) continue
      if (ctx.logged[lead].some((e) => e.at < d.start && insideRest(d.at, e.at, ctx.restMs))) continue
      if (planned[lead].some((x) => x.i !== i && apart(days[x.i].at, d.at) < ctx.restMs)) continue
      if (gymFirst && (d.week === thisWeek ? done[lead] : 0) + [...exposures].filter((j) => days[j].week === d.week).length >= skillDays) continue
      exposures.add(i)
      if (!planned[lead].some((x) => x.i === i)) planned[lead].push({ i, at: d.at })
    }
  }

  /**
   * The day's one main session. The athlete's own day is calisthenics as
   * written, and so is every day without a gym place or gym goals; a day only
   * one kind fits is that kind. The first priority's own day is its
   * calisthenics session, or a gym day it opens — when the goals lean to the gym
   * or its family's muscles still need the gym this week, and its opener keeps
   * its kept dose; an opener that would not is half a session, so its own day
   * comes first. Otherwise, in order: a straight-arm family that needs this day
   * for its weekly hard sessions gets it — as calisthenics, or as a gym day that
   * opens with its skill when the goals lean to the gym or its muscles still
   * need the gym this week; a day the goals give to calisthenics goes to the
   * gym, its skill first, when that family's muscles still need a gym session (a
   * calisthenics day of the family would keep the gym's pressing or pulling off
   * the days around it); then the goal weights decide how the week's training
   * days split, and a close call goes to calisthenics when sport keeps the legs
   * out of the gym, to the gym when its weekly sets need the day, and otherwise
   * to the side the goals favour. The split and its order are the app's own
   * rules; skill frequency and shared recovery are CONSENSUS.
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
    const view = places.cal(i)
    const exposure = exposures.has(i)
    // The athlete's own day trains as written; any other day leaves out a family inside its rest rule. Only a skill
    // with its kit can hold a calisthenics day: a front lever with no bar once filled the week as "Front lever 60
    // min" while the session it started was "waiting for kit".
    const pool = (d.assigned ?? skills.filter((s) => skillFamily(s) === 'balance' || !blocked[skillFamily(s) as Straight]))
      .filter((s) => !sportRestsSkill(d, s))
    const fitsSkill = (athlete: AppState, s: SkillId) => d.minutes >= OPENER_MINUTES ||
      builtSkill(athlete, [s], d.minutes, d.at, placeKit(athlete)).minutes <= d.minutes
    const allowed = pool.filter((s) => trains(view, s) && fitsSkill(view, s))
    // Skills free today that only the gym's kit holds: a calisthenics day for one of them is planned there.
    const gymOnly = canMove(i) && places.gymCal && !d.assigned ? pool.filter((s) => !trains(view, s) && trains(places.gymCal!, s) && fitsSkill(places.gymCal!, s)) : []
    const calOK = (allowed.length > 0 || gymOnly.length > 0) && d.minutes >= MIN_SKILL_MINUTES[1]
    // A place where a gym block builds; the gym goals decide whether the coach uses it, and an athlete's own pick
    // ("Rather do the gym", the Gym tab) needs only the place.
    const gymPlace = ctx.placeAt(i)
    const gymHere = Boolean(gymPlace) && d.minutes >= MIN_GYM_MINUTES && ctx.gymFits(d, d.minutes)
    const gymOK = ctx.wantsGym && gymHere
    const skillsWanted = g.skills > 0 || Boolean(d.assigned) || !ctx.wantsGym
    const chosenLifts = ctx.liftingPlaceDate === d.key || state.gym?.prefs?.extraGymDate === d.key || Boolean(ctx.wantsGym && state.gym?.prefs?.gymWeekdays?.includes(weekdayOf(d.start)))
    const reservedLifts = chosenLifts && !d.assigned && !(i === 0 && ctx.todayKind)
    const forced = reservedLifts ? 'gym' : i === 0 ? ctx.todayKind : undefined
    let kind: 'calisthenics' | 'gym' | undefined
    let why: KindWhy
    let urgent: Straight | undefined
    let hint: Straight | undefined
    let setsNeed: SkillSlot['setsNeed']
    /** The skill a gym day here could open with for a family, and whether that session reaches the hard count. */
    const canOpen = (f: Straight) => {
      const place = gymPlace
      const skill = place ? openerSkill(view, f, place, { minutes: d.minutes, sore: d.avoidJoints, pain: d.pain, blocked: (x) => (blocked[x] ? 'rest' : undefined) }) : undefined
      return place && skill && ctx.familyGymFits(d, d.minutes - openerMinutesOf(view, skill, d.minutes, d.at, place), f) ? { skill, hard: hardAtStep(view, skill, kitAt(view, place)) } : undefined
    }
    const hardIn = (f: Straight) => [...allowed, ...gymOnly].some((s) => skillFamily(s) === f && stepIsHard(s))
    /** Whether a family needs this day for its weekly hard sessions: it needs more than the open days after it could give. */
    const isBehind = (f: Straight) =>
      (exposure && f === lead) ||
      (f !== lead && hardIn(f) && target(f) - ((d.week === thisWeek ? done[f] : 0) + planned[f].filter((x) => days[x.i].week === d.week && !x.press).length) > feasibleAfter(f, i))
    /** Whether a gym day here can open with a skill of the family that counts toward its sessions. */
    const opensWith = (f: Straight) => Boolean(canOpen(f)?.hard)
    /** The first priority's opener keeps its kept dose: only then is the gym day one of its sessions in full. */
    const opensFull = (f: Straight) => {
      const o = canOpen(f)
      if (!o?.hard) return false
      if (o.skill !== first || !gymPlace) return true
      const kit = kitAt(view, gymPlace)
      const practice = builtSkill(view, [first], openerMinutesOf(view, first, d.minutes, d.at, gymPlace), d.at, kit, true)
      return practice.painSafe || (practice.key[first] ?? 0) >= builtSkill(view, [first], UNTRIMMED_MINUTES, d.at, kit).bare
    }
    if (d.assigned) {
      kind = calOK ? 'calisthenics' : undefined
      why = 'plan'
    } else if (!ctx.wantsGym) {
      kind = calOK ? 'calisthenics' : undefined
      why = exposure ? 'exposure' : ctx.gymWanted ? 'no-place' : 'no-gym-goal'
      if (exposure) urgent = lead as Straight
    } else if (lowerDays.has(i) && gymOK) {
      kind = 'gym'
      why = 'leg-coverage'
    } else if (!calOK || !skillsWanted) {
      kind = gymOK ? 'gym' : undefined
      why = skillsWanted ? 'skills-rest' : 'no-skill-goal'
    } else if (!gymOK) {
      kind = 'calisthenics'
      why = exposure ? 'exposure' : 'gym-unfit'
      if (exposure) urgent = lead as Straight
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
      // The week's last day the sport leaves the legs fresh goes to them while they are under target: a practice and
      // a game once kept every other day legs-out, this one went to a pull day, and ten weeks held no leg session. A
      // skill family behind on its sessions keeps the day while the legs had a gym session in the last
      // `LEG_DAY_EVERY_DAYS`, and while no later day this week is left for it: legs every other week at least, and
      // the front lever its sessions the rest of the time (taking every such day halved its sessions).
      const legDay = legsLastChance(i)
      const legsDue = legDay && legsWaited(i) >= LEG_DAY_EVERY_DAYS
      const behind = exposure
        ? (lead as Straight)
        : (['push', 'pull'] as const).find((f) => isBehind(f) && !(legsDue && feasibleAfter(f, i) > 0))
      // A calisthenics day of a family keeps the gym's pressing (or pulling) off the days around it, so a family
      // whose muscles still need the gym this week pairs the two on one day: the gym, its skill first.
      const pairs = legDay
        ? undefined
        : (['push', 'pull'] as const).find((f) => lean === 'calisthenics' && movable && hardIn(f) && musclesWant(f, i) && opensWith(f))
      // A missed day can leave just one practice slot beside a reserved leg day.
      // A secondary skill's hard-session goal must not take the whole week from
      // a primary balance or foundations skill which has no hard-session quota.
      const lastPractice = shortWeek && !gymFirst && g.skills > 0 && !d.pain && !legDay &&
        d.minutes >= MIN_SKILL_MINUTES[2] && (lead === 'balance' || !stepIsHard(first)) &&
        allowed.includes(first) && !loggedFull(first, d.week) &&
        !slots.some((sl, j) => days[j].week === d.week && fullOn(sl, first)) &&
        !days.some((later) => later.index > i && later.week === d.week && !later.restDay && !later.assigned &&
          !lowerDays.has(later.index) && later.minutes >= MIN_SKILL_MINUTES[1] && !sportRestsSkill(later, first))
      // A balance or foundations session can be productive without counting
      // as hard straight-arm work. Protect the actual practice days the
      // leading goal earns before the general muscle targets take the slots.
      const primaryPractice = shortWeek && trainingDays > 1 && g.skills > gymGoal && (lead === 'balance' || !stepIsHard(first)) &&
        !d.pain && !d.held && !d.niggle && (allowed.includes(first) || gymOnly.includes(first)) &&
        (!legDay || t.gym > 0) && t.cal < practiceDays &&
        (t.gym > 0 || days.some((later) => later.index > i && later.week === d.week && !later.assigned && !later.restDay && later.minutes >= MIN_GYM_MINUTES))
      if (lastPractice || primaryPractice) {
        kind = 'calisthenics'
        why = 'skill-practice'
      } else if (gymFirst && !exposure && !d.assigned && d.minutes >= OPENER_MINUTES + MIN_LIFTS_AFTER_OPENER && !d.pain) {
        // When gym training leads, use a second skill as an opener where it fits.
        // A full skill day still stands when its main hold needs more than an opener.
        kind = 'gym'
        hint = legDay ? undefined : (['pull', 'push'] as const).find((f) => isBehind(f) && opensWith(f))
        why = hint ? 'family-opener' : 'share'
      } else if (behind) {
        if ((lean === 'gym' || (movable && musclesWant(behind, i))) && (exposure ? openerAllowed(i) && opensFull(behind) : opensWith(behind))) {
          kind = 'gym'
          hint = behind
          why = exposure ? 'exposure-opener' : 'family-opener'
        } else {
          kind = 'calisthenics'
          urgent = behind
          why = exposure ? 'exposure' : 'family'
        }
      } else if (pairs) {
        kind = 'gym'
        hint = pairs
        why = 'pair'
      } else if (shortWeek && !d.pain && (lead === 'balance' || !stepIsHard(first)) && t.cal === 0 && (t.gym > 0 || lean === 'calisthenics') &&
        (t.gym > 0 || days.some((later) => later.index > i && later.week === d.week && !later.restDay && later.minutes >= MIN_GYM_MINUTES)) &&
        (!legDay || t.gym > 0)) {
        // Balance and Foundations work never fills a hard straight-arm quota.
        // Keep a feasible practice day before using the remaining time for volume.
        kind = 'calisthenics'
        why = 'skill-practice'
      } else if (legDay) {
        kind = 'gym'
        why = 'legs'
      } else if (close && (d.legsCovered || d.sameDay || d.upcoming)) {
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
    // The athlete's pick for today ("Rather do …", the Gym tab) outranks the coach's call, and is the coach's call,
    // unchanged, when the two agree: a forced gym day once dropped the opener that made its pulling legal, so the Gym
    // tab found nothing to do on the coach's own gym day. A gym day picked over a calisthenics one keeps the pairing
    // the coach makes: a family's skill first, when the family needs the session or its muscles need the gym.
    if (forced && kind !== forced && (forced === 'gym' ? gymHere : calOK)) {
      kind = forced
      why = ctx.liftingPlaceDate === d.key ? 'lifting-place' : reservedLifts ? 'reserved-lifts' : ctx.todayWhy ?? 'picked'
      urgent = undefined
      setsNeed = undefined
      hint =
        forced === 'gym'
          ? ((['push', 'pull'] as const).find((f) => isBehind(f) && opensWith(f)) ?? (['push', 'pull'] as const).find((f) => hardIn(f) && musclesWant(f, i) && opensWith(f)))
          : undefined
    }
    let parts: Part[] = []
    let placeId: string | undefined
    let built = view
    if (kind === 'calisthenics') {
      // At home, unless what the day is for trains only where the gym's kit is: the family it was chosen for, or —
      // on a one-skill day — the skill whose turn it is.
      const homeFor = (f: Straight) => allowed.some((s) => skillFamily(s) === f && stepIsHard(s))
      const turn = roomFor(d.minutes) === 1 && !exposure ? turnOf(trainedSkills(view), [...allowed, ...gymOnly], sinceFull(i)) : undefined
      const atGym =
        places.gymCal &&
        gymOnly.length > 0 &&
        ((urgent && !homeFor(urgent) && gymOnly.some((s) => skillFamily(s) === urgent)) || (turn !== undefined && gymOnly.includes(turn)) || !allowed.length)
      if (atGym && places.gymCal && places.gym) {
        built = places.gymCal
        placeId = places.gym.id
      }
      // On the first priority's day a skill of another straight-arm family partners only while that family is under
      // its weekly sessions: a partner part is one of them, hard by the same count. With the front lever beside every
      // planche day its rest rule left no day for the gym's pulling, and the pull day vanished from the week.
      const underTarget = (s: SkillId) => {
        const f = skillFamily(s)
        if (!exposure || f === 'balance' || f === lead) return true
        return (d.week === thisWeek ? done[f] : 0) + planned[f].filter((x) => x.i !== i && days[x.i].week === d.week && !x.press).length < target(f)
      }
      const list = (atGym ? pool.filter((s) => trains(places.gymCal!, s)) : allowed)
        .filter((s) => !atGym || !turn || roomFor(d.minutes) > 1 || s === turn)
        .filter(underTarget)
      parts = lineupParts(built, d, list, d.minutes, { exposure, since: sinceFull(i) })
      // Beside the first priority, a partner of another straight-arm family that would be short of a hard session is
      // practice that still spaces its family: a 60-minute planche day's two lever holds kept the gym's pull day the
      // day before from opening with the lever. It gives its place up (a balance skill, or nobody, takes it).
      const thin = exposure ? parts.find((p) => p.role === 'partner' && !p.hard && skillFamily(p.skill) !== 'balance' && skillFamily(p.skill) !== lead) : undefined
      if (thin) parts = lineupParts(built, d, list.filter((s) => s !== thin.skill), d.minutes, { exposure, since: sinceFull(i) })
      // Handstand push-ups are pressing: a session they make a hard push session (`pressesHard`) does not go on a day
      // the push family rests — it is planned beside the planche instead, where the day carries both. Probe: a Saturday
      // of three deficit wall push-ups sat a day before every Sunday planche session.
      if (blocked.push && !d.assigned && parts.length && pressesHard(builtSkill(built, parts.map((p) => p.skill), d.minutes, d.at), new Set())) {
        parts = lineupParts(built, d, list.filter((s) => !PRESS_SKILLS.has(s)), d.minutes, { exposure, since: sinceFull(i) })
      }
      if (!parts.length) {
        // Nothing of the skills fits these minutes: the gym takes the day if it can.
        kind = gymOK ? 'gym' : undefined
        why = 'skills-rest'
        urgent = undefined
        placeId = undefined
      }
    }
    // The first priority's day is its day only while it leads it: a niggle named today can move the lead.
    const isExposure = exposure && (kind === 'gym' ? hint === lead : parts[0]?.skill === first)
    if (exposure && !isExposure && (why! === 'exposure' || why! === 'exposure-opener')) {
      why = 'share'
      if (urgent === lead) urgent = undefined
    }
    const families = new Set(parts.filter((p) => p.hard).map((p) => skillFamily(p.skill) as Straight))
    const alternative = i !== 0 ? undefined : kind === 'calisthenics' && gymOK ? 'gym' : kind === 'gym' && calOK ? 'calisthenics' : undefined
    const session = parts.length ? builtSkill(built, parts.map((p) => p.skill), d.minutes, d.at) : undefined
    const presses = pressesHard(session, families)
    // A day whose session is the pain-safe recovery one trains none of the line-up: the block names its lead only (the
    // request still builds the same session), never three skills it will not hold. A wrist report once left the card
    // saying "Planche, front lever, handstand" above Pain-Safe Recovery.
    if (session?.painSafe) parts = parts.slice(0, 1).map((p) => ({ ...p, hard: false }))
    return {
      ...base,
      kind: kind ?? 'rest',
      why: why!,
      ...(isExposure ? { exposure: true } : {}),
      ...(sharedSkillDays.has(i) ? { sharedSkillDay: true } : {}),
      ...(placeId ? { placeId } : {}),
      ...(session?.painSafe ? { painSafe: true } : {}),
      ...(alternative ? { alternative } : {}),
      skillMin: kind === 'calisthenics' ? d.minutes : 0,
      gymMin: kind === 'gym' ? d.minutes : 0,
      skills: parts.map((p) => p.skill),
      parts,
      families,
      ...(presses ? { presses } : {}),
      ...(urgent ? { urgent } : {}),
      ...(hint ? { hint } : {}),
      ...(kind === 'gym' && (why! === 'legs' || why! === 'leg-coverage') ? { legDay: true } : {}),
      ...(kind === 'gym' && setsNeed ? { setsNeed } : {}),
      // Nothing planned, and the minutes are why: shorter than the session that would otherwise be built.
      ...(!kind && d.minutes < (allowed.length ? MIN_SKILL_MINUTES[1] : MIN_GYM_MINUTES) ? { tooShort: true } : {}),
      noSkillFits: g.skills > 0 && !d.assigned && allowed.length === 0 && gymOnly.length === 0,
      ...(noKit ? { noKit: true } : {}),
      credit: session?.credit ?? {},
      workingSets: session?.key,
    }
  }
  const record = (i: number) => {
    for (const part of slots[i].parts) {
      const f = skillFamily(part.skill)
      if (f !== 'balance' && (part.role === 'lead' || part.role === 'partner') && !planned[f].some((x) => x.i === i)) planned[f].push({ i, at: days[i].at })
    }
    const h = slots[i].hint
    if (h && !planned[h].some((x) => x.i === i)) planned[h].push({ i, at: days[i].at })
    // A day its handstand push-ups make a hard push session keeps the planche's days and heavy pressing away from it.
    if (slots[i].presses && !planned.push.some((x) => x.i === i)) planned.push.push({ i, at: days[i].at, press: true })
  }
  // The athlete's own days are fixed first, so the days the planner chooses keep the rest rule around them both ways.
  for (let i = 0; i < days.length; i++) {
    if (!days[i].assigned) continue
    slots[i] = decide(i)
    record(i)
  }
  // A focus picked for today presses or pulls today, opener or not: the rest of the week keeps the rest rule from
  // it. Planned the other way round, a skill day tomorrow took the opener away from the day being trained.
  if (ctx.todayKind === 'gym' && ctx.todayFocus) {
    for (const f of focusFamilies(ctx.todayFocus)) if (!planned[f].some((x) => x.i === 0)) planned[f].push({ i: 0, at: days[0].at })
  }
  reserveExposures()
  // On three spaced days the first skill can use every slot. Protect an actual
  // lower-body session when muscle is an equal goal or legs are a priority.
  // Prefer a day the skill does not need. Explicit days and sport still win.
  if (ctx.coverLegWeeks?.length) {
    let last = ctx.legsLast
    for (const wk of ctx.coverLegWeeks) {
      const training = days.filter((d) => d.week === wk && !d.restDay && d.minutes >= MIN_GYM_MINUTES)
      const trained = wk === thisWeek ? ctx.before.cal + ctx.before.gym : 0
      if (trained + training.length < 2) continue
      const options = training.filter((d) => !d.assigned && ctx.legsOpen(d)
        && (last === undefined || startOfDay(d.at) >= addDays(startOfDay(last), 2))
        && (d.index !== 0 || (ctx.todayKind !== 'calisthenics' && !ctx.todayFocus)))
      const pick = options.filter((d) => !exposures.has(d.index)).at(-1) ?? options.at(-1)
      if (!pick) continue
      lowerDays.add(pick.index)
      last = pick.at
      if (exposures.delete(pick.index) && lead !== 'balance') {
        planned[lead] = planned[lead].filter((x) => x.i !== pick.index)
        sharedSkillDays.add(pick.index)
      }
    }
  }
  for (let i = 0; i < days.length; i++) {
    if (days[i].assigned) continue
    slots[i] = decide(i)
    record(i)
  }
  // ——— A skill that would wait the week ———
  // The first priority's days are its own while the week has days for the others. A skill with no full part in a
  // calendar week otherwise — logged or planned — partners the first of its days that has room, the first
  // priority keeping every set of its kept dose: with three training days, all of them the planche's, the front lever
  // and the handstand would otherwise never train.
  // Two short training days can leave only one skill slot beside the gym. Share
  // that slot across weeks, using completed practice so a missed day costs no turn.
  const trainingMinutes = prefs.minutesByDay.filter((m) => m > 0)
  if (skills.length > 1 && ctx.wantsGym && trainingMinutes.length <= 2 && trainingMinutes.every((m) => m < MIN_SKILL_MINUTES[2])) {
    for (const d of days) {
      const i = d.index
      const sl = slots[i]
      if (sl?.kind !== 'calisthenics' || sl.skills[0] !== first || d.assigned || d.pain || sl.painSafe || (i === 0 && ctx.todayKind)) continue
      const waited = sinceFull(i)
      const leadWait = waited(first)
      if (leadWait === null || leadWait >= 12) continue
      const candidates = skills.slice(1).filter((s) => (waited(s) ?? Infinity) >= 12 && !loggedFull(s, d.week) &&
        !slots.some((other, j) => j !== i && days[j].week === d.week && fullOn(other, s)))
        .sort((a, b) => (waited(b) ?? NEVER_TRAINED_DAYS) - (waited(a) ?? NEVER_TRAINED_DAYS))
      for (const skill of candidates) {
        const fam = skillFamily(skill)
        if (fam !== 'balance' && conflict(fam, i)) continue
        const home = places.cal(i)
        const view = trains(home, skill) ? home : canMove(i) && places.gymCal && trains(places.gymCal, skill) ? places.gymCal : undefined
        if (!view) continue
        const parts = lineupParts(view, d, [skill], d.minutes)
        if (parts[0]?.skill !== skill) continue
        const built = builtSkill(view, [skill], d.minutes, d.at)
        if (built.painSafe || !built.key[skill]) continue
        const families = new Set(parts.filter((p) => p.hard).map((p) => skillFamily(p.skill) as Straight))
        const presses = pressesHard(built, families)
        if (presses && conflict('push', i)) continue
        for (const f of ['push', 'pull'] as const) planned[f] = planned[f].filter((e) => e.i !== i)
        slots[i] = { ...sl, why: 'rotate-skills', exposure: undefined, urgent: undefined, hint: undefined,
          placeId: view === places.gymCal ? places.gym?.id : undefined, skills: [skill], parts, families, presses, credit: built.credit, workingSets: built.key }
        record(i)
        break
      }
    }
  }
  for (let i = 0; i < days.length; i++) {
    const sl = slots[i]
    const d = days[i]
    if (!sl?.exposure || sl.kind !== 'calisthenics' || sl.painSafe || sl.parts.length !== 1 || roomFor(d.minutes) < 2) continue
    const view = sl.placeId && places.gymCal ? places.gymCal : places.cal(i)
    for (const skill of skills.slice(1)) {
      if (sportRestsSkill(d, skill) || !trains(view, skill) || loggedFull(skill, d.week)) continue
      if (skillFamily(skill) !== 'balance' && sl.blocked[skillFamily(skill) as Straight]) continue
      if (slots.some((other, j) => days[j].week === d.week && fullOn(other, skill))) continue
      const trial: Part[] = markHard(view, d.at, [sl.parts[0], { skill, role: 'partner', hard: false }], d.minutes)
      if (!keepsDose(view, trial.map((p) => p.skill), d.minutes, d.at)) continue
      const session = builtSkill(view, trial.map((p) => p.skill), d.minutes, d.at)
      const families = new Set(trial.filter((p) => p.hard).map((p) => skillFamily(p.skill) as Straight))
      slots[i] = { ...sl, skills: trial.map((p) => p.skill), parts: trial, families, presses: pressesHard(session, families), credit: session.credit, workingSets: session.key }
      record(i)
      break
    }
  }
  // ——— A skill whose kit only the gym has (round six) ———
  // A skill the athlete's own kit cannot hold, with no full part in a calendar week (logged or planned), takes the
  // partner or short-dose slot on the week's first calisthenics day whose lead trains at the gym too — that day is
  // planned there. Its lead keeps its dose (`exposureParts`); the longest-waiting such skill goes first. A three-day
  // week at home with no wall and no bar once gave the front lever and the handstand push-ups nothing for six weeks.
  if (places.gymCal && places.gym) {
    const gymView = places.gymCal
    const gymId = places.gym.id
    for (const wk of [...new Set(days.map((d) => d.week))]) {
      const inWeek = days.filter((d) => d.week === wk).map((d) => d.index)
      if (!inWeek.length) continue
      const waits = sinceFull(inWeek[0])
      const waiting = skills
        .slice(1)
        .filter((skill) => trains(gymView, skill) && !loggedFull(skill, wk) && !inWeek.some((j) => fullOn(slots[j], skill)))
        .sort((a, b) => (waits(b) ?? NEVER_TRAINED_DAYS) - (waits(a) ?? NEVER_TRAINED_DAYS))
      for (const skill of waiting) {
        for (const i of inWeek) {
          const sl = slots[i]
          const d = days[i]
          if (!sl || sl.kind !== 'calisthenics' || d.assigned || sl.painSafe || roomFor(d.minutes) < 2 || sl.skills.includes(skill)) continue
          if (!canMove(i) || trains(places.cal(i), skill) || !sl.parts.length || !trains(gymView, sl.parts[0].skill)) continue
          if (skillFamily(skill) !== 'balance' && sl.blocked[skillFamily(skill) as Straight]) continue
          const list = trainedSkills(gymView).filter((s) => sl.skills.includes(s) || s === skill)
          const trial = lineupParts(gymView, d, list, d.minutes, { exposure: sl.exposure, since: sinceFull(i) })
          if (trial[0]?.skill !== sl.parts[0].skill || !trial.some((p) => p.skill === skill)) continue
          const session = builtSkill(gymView, trial.map((p) => p.skill), d.minutes, d.at)
          const families = new Set(trial.filter((p) => p.hard).map((p) => skillFamily(p.skill) as Straight))
          const presses = pressesHard(session, families)
          if (presses && sl.blocked.push) continue
          if (sl.exposure && !keepsDose(gymView, trial.map((p) => p.skill), d.minutes, d.at)) continue
          slots[i] = { ...sl, placeId: gymId, skills: trial.map((p) => p.skill), parts: trial, families, presses, credit: session.credit, workingSets: session.key }
          record(i)
          break
        }
      }
    }
  }
  rankPass()
  return slots

  /**
   * The athlete's order between the other skills (round seven): a skill ranked above another gets at least as many
   * full parts — lead, partner or opener — in a calendar week, wherever the rest rules and kit allow. While the lower
   * one has more, one of its lead or partner parts on a calisthenics day goes to the higher one: the same line-up
   * without it, the lead keeping its dose on the first priority's days, the higher one's family clear of its rest
   * rule against every day planned so far (and under its weekly sessions beside the first priority), and its pressing
   * kept off a day the push family rests. Where none can move — a gym day the lower one opens for a family the higher
   * one's work cannot use — the lower one keeps it: taking it away would train nobody. With the planche, then the
   * handstand, then the front lever, the lever got 15 full parts in ten weeks against the handstand's 19 when the
   * lever was second, and 16 against 21 when it was third: the order changed almost nothing.
   */
  function rankPass() {
    const others = skills.slice(1)
    if (others.length < 2) return
    const loggedCount = (skill: SkillId, week: number) =>
      state.sessions.filter((x) => x.startedAt >= week && x.startedAt < today && x.startedAt < addDays(week, 7) && fullPartIn(x, skill)).length
    for (const wk of [...new Set(days.map((d) => d.week))]) {
      const inWeek = days.filter((d) => d.week === wk).map((d) => d.index)
      const count = (skill: SkillId) => (wk === thisWeek ? loggedCount(skill, wk) : 0) + inWeek.filter((j) => fullOn(slots[j], skill)).length
      for (let a = 0; a < others.length; a++) {
        for (let b = a + 1; b < others.length; b++) {
          const hi = others[a]
          const lo = others[b]
          const recent = (skill: SkillId) => state.sessions.filter((s) => s.startedAt >= addDays(wk, -21) && s.startedAt < wk && fullPartIn(s, skill)).length
          const higherRecent = recent(hi)
          const catchingUp = recent(lo) > higherRecent
          for (let guard = 0; guard < inWeek.length && count(lo) + Number(catchingUp) > count(hi); guard++) {
            const shorterPartner = catchingUp || (higherRecent >= 2 && count(lo) > count(hi))
            if (!moveOne(inWeek, hi, lo, shorterPartner)) break
          }
        }
      }
    }
  }

  /** Gives one of `lo`'s lead or partner parts in these days to `hi`, when the rules allow it; whether one moved. */
  function moveOne(inWeek: number[], hi: SkillId, lo: SkillId, shorterPartner: boolean): boolean {
    const fam = skillFamily(hi)
    for (const i of inWeek) {
      const sl = slots[i]
      const d = days[i]
      if (!sl || sl.kind !== 'calisthenics' || d.assigned || sl.painSafe || (i === 0 && ctx.todayKind)) continue
      if (!fullOn(sl, lo) || fullOn(sl, hi)) continue
      const current = sl.placeId && places.gymCal ? places.gymCal : places.cal(i)
      const view = trains(current, hi) ? current : canMove(i) && places.gymCal && trains(places.gymCal, hi) ? places.gymCal : undefined
      if (!view || sl.parts.some((p) => p.skill !== lo && !trains(view, p.skill))) continue
      if (fam !== 'balance') {
        if (conflict(fam, i)) continue
        const sessions = (d.week === thisWeek ? done[fam] : 0) + planned[fam].filter((x) => x.i !== i && days[x.i].week === d.week && !x.press).length
        if (sl.exposure && fam !== lead && sessions >= target(fam)) continue
      }
      const list = trainedSkills(view).filter((x) => x === hi || (sl.skills.includes(x) && x !== lo))
      const trial = lineupParts(view, d, list, d.minutes, { exposure: sl.exposure, since: sinceFull(i) })
      if (!trial.length || trial[0].skill !== (sl.parts[0].skill === lo ? hi : sl.parts[0].skill)) continue
      const part = trial.find((p) => p.skill === hi)
      if (!part || (part.role !== 'lead' && part.role !== 'partner')) continue
      // An established skill can use a shorter partner session to catch up in the
      // athlete's order. The lead's dose and both rest rules still apply.
      if (sl.exposure && fam !== 'balance' && fam !== lead && !part.hard && !shorterPartner) continue
      const session = builtSkill(view, trial.map((p) => p.skill), d.minutes, d.at)
      const families = new Set(trial.filter((p) => p.hard).map((p) => skillFamily(p.skill) as Straight))
      const presses = pressesHard(session, families)
      if (presses && (conflict('push', i) || sl.blocked.push)) continue
      if (sl.exposure && !keepsDose(view, trial.map((p) => p.skill), d.minutes, d.at)) continue
      slots[i] = { ...sl, ...(view !== current && places.gym ? { placeId: places.gym.id } : {}), skills: trial.map((p) => p.skill), parts: trial, families, presses, credit: session.credit, workingSets: session.key }
      record(i)
      return true
    }
    return false
  }
}

interface Path {
  foci: (GymFocus | null)[]
  /** Whether each day's focus presses lightly (`LIGHT_PRESS_SPARE`): not a hard pressing session. */
  light: boolean[]
  /** The calendar week has gym pressing: logged before, or a focus chosen in it that presses (push, upper, full). */
  pressed: boolean
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
  physique: number
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
  /** The athlete's own priority muscles: never spared, and never counted as a focus's spent muscles. */
  priority: ReadonlySet<Muscle>
  /**
   * Whether the gym may press (push) or pull hard on day `i` as far as
   * everything fixed is concerned: no logged hard session of the family, and
   * no planned skill session of it, on another day inside the rest rule.
   */
  clear: (family: Straight, i: number) => boolean
  /** Whether this focus builds two movements or more in this many minutes on this day. */
  viable: (d: DayCtx, minutes: number, focus: GymFocus, spare?: Muscle[]) => boolean
  /** The skill a gym day of this focus opens with, when one can (`openerSkill`, and the gym still builds beside it). */
  opener: (i: number, focus: GymFocus) => SkillId | undefined
  /** Today's focus, picked by the athlete on the Gym side: today's gym block takes it, the rest of the week is planned around it. */
  todayFocus?: GymFocus
  /** The gym's own minutes on a day at this focus: the day's, less the opener's when it has one. */
  gymMinutes: (i: number, focus: GymFocus) => number
  /** The muscle credit of the session a focus builds on a day, set by set: what the two-days-running rule reads. */
  lifts: (d: DayCtx, minutes: number, focus: GymFocus, spare?: Muscle[]) => Credit
  compoundSets: (d: DayCtx, minutes: number, focus: GymFocus, group: Straight) => number
  /** The muscle credit of a day's opener at a focus, from the session it builds. */
  openerCredit: (i: number, focus: GymFocus) => Credit
  /**
   * The weekly pressing rule applies: the athlete trains a push-family skill (whose rest rule keeps hard pressing off
   * the days around it), wants gym work, and has the chest switched on. Each calendar week then presses at the gym —
   * lightly, beside the skill's days, when nothing heavier fits.
   */
  weeklyPress: boolean
}

/** Muscles some movement trains beside the pressing pair (`LIGHT_PRESS_SPARE`) as a prime mover: the pair's rail holds them out. */
const PAIR_HELD: ReadonlySet<Muscle> = new Set(
  Object.values(GYM_EXERCISE_BY_ID)
    .filter((e) => e.primary.some((m) => LIGHT_PRESS_SPARE.includes(m)))
    .flatMap((e) => e.primary),
)

/** Gym foci with a press the day is named for (`NAMED_PATTERNS`): a week with one of them has pressed. */
const PRESSING: ReadonlySet<GymFocus> = new Set<GymFocus>(['push', 'upper', 'full'])

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
  if ((f === 'pull' || f === 'push') && d.sportRest[f]) return false
  if (!FOCUS_MUSCLES[f].some((m) => !d.off.has(m))) return false
  // Most of what the focus is for must be switched on (legs off once still gave "Lower" days of one ab exercise).
  if (!focusOpen(f, musclesOff)) return false
  const legsBlocked = Boolean(d.legsCovered || d.sameDay || d.upcoming) || legsOff
  if (f === 'lower' && (legsBlocked || d.liftJoints.includes('knees'))) return false
  if (f === 'athletic') {
    return power >= 3 && !legsBlocked && !d.hardBefore && !d.hardNext && !d.pain && !d.liftJoints.includes('knees') && d.factor >= 1
  }
  return true
}

/** A place with only skill equipment is treated as a home training space. */
const SKILL_KIT = new Set<string>(['floor', 'parallettes', 'band', 'pullup-bar', 'rings', 'dip-bars', 'box', 'wall', 'pole'])
const hasGymKit = (place: GymLocation) => place.equipment.some((e) => !SKILL_KIT.has(e))

/**
 * Where gym days are planned: the place the app is set to when it is a gym;
 * otherwise the gym the athlete has lifted at most in the last eight weeks,
 * then the best equipped; home only when it is the only kind of place there
 * is. With home set as the active place every "gym" day of a month was built
 * at home — push-ups and dips — and the front lever, whose bar is at the gym,
 * had no session in 28 days.
 */
function usualGymPlace(state: AppState, now: number): GymLocation | undefined {
  const gym = state.gym
  const active = activePlace(state)
  if (!gym || !active || hasGymKit(active)) return active
  const gyms = gym.locations.filter(hasGymKit)
  if (!gyms.length) return active
  const since = now - 56 * DAY
  const used = (place: GymLocation) => gym.sessions.filter((s) => s.locationId === place.id && s.startedAt >= since && s.startedAt <= now).length
  return [...gyms].sort((a, b) => used(b) - used(a) || b.equipment.length - a.equipment.length)[0]
}

export function gymPlaceOf(state: AppState, now: number): GymLocation | undefined {
  return weekdayPlace(state, now) ?? usualGymPlace(state, now)
}

const BEAM = 40
/** A muscle with this many sets in a day was worked hard that day (a planning line, not a measured one). */
export const HARD_SETS = 4
/** A week past this many times a muscle's top target has too much of it: the gym leaves it out where it can (the app's own line). */
export const FAR_OVER = 1.5
/**
 * The line the week is steered to, a little inside `FAR_OVER`: the skill
 * sessions still to come are planned, not logged, and a line-up or step that
 * changes before then moves their sets.
 */
const STEER_LINE = FAR_OVER - 0.2
const BASIC_LIFT_MUSCLES = new Set<Muscle>(['chest', 'lats', 'quads', 'hamstrings'])

/**
 * The gym focus of each day in one calendar week, chosen together (a beam
 * search over the days): weekly sets toward each muscle's target, the most
 * behind first and earliest, not the same muscles hard on consecutive days,
 * the part of the body left longest, and never against the day's skills or
 * sport. The weights are planning heuristics, not measurements.
 *
 * Pressing beside a push-family skill day is light (`LIGHT_PRESS_SPARE`): a
 * full-body day there keeps one press at two sets, and a push or upper day may
 * go there only light and only while the calendar week has no gym pressing —
 * the weekly pressing rule (`GymCtx.weeklyPress`), which then picks the best
 * path that presses. Light pressing is never a hard session of the family.
 */
function allocate(
  days: DayCtx[],
  slots: SkillSlot[],
  idxs: number[],
  init: Pick<Path, 'P' | 'prev' | 'last' | 'athletic'> & { prevGym?: Credit; prevFocus?: GymFocus | null; gymEvents?: Record<Straight, number[]>; pressed?: boolean },
  ctx: GymCtx,
  fixed?: { index: number; focus: GymFocus | null; credit: Credit; prev: Credit; prevGym: Credit; light?: boolean; logged?: boolean },
): Path {
  // The week as planned (round six): every calisthenics day's session counts from the start, so a gym day early in the
  // week sees the skill days after it. Monday once chose "push: chest and front delts furthest from this week's sets"
  // while the week's planche days took front delts and triceps past one and a half times their target — and the lifts
  // that day were one press, raises and a fly, with the back and legs at nothing for the week.
  const ahead: Credit = { ...init.P }
  for (const i of idxs) if (slots[i].gymMin <= 0 && fixed?.index !== i) addCredit(ahead, slots[i].credit)
  let paths: Path[] = [
    {
      foci: [],
      light: [],
      pressed: Boolean(init.pressed),
      serves: [],
      P: ahead,
      prev: { ...init.prev },
      prevGym: { ...(init.prevGym ?? {}) },
      gymEvents: { push: [...(init.gymEvents?.push ?? [])], pull: [...(init.gymEvents?.pull ?? [])] },
      last: { ...init.last },
      athletic: init.athletic,
      score: 0,
    },
  ]
  const gymDays = idxs.filter((i) => slots[i].gymMin > 0 && fixed?.index !== i)
  const lightSpare = [...LIGHT_PRESS_SPARE]
  // A later reserved opener will train its muscles whichever lift focus wins.
  // Count it when choosing today's lifts, once, just as we do later skill-only days.
  const laterPractice = new Map<number, Credit>()
  const upcoming: Credit = {}
  for (const i of [...gymDays].reverse()) {
    laterPractice.set(i, { ...upcoming })
    const reserved = slots[i].reservedOpener?.skill
    if (!reserved || ctx.physique < 3 || (ctx.shared.push && ctx.shared.pull)) continue
    const focus = FOCI.find((f) => ctx.opener(i, f) === reserved)
    if (focus) addCredit(upcoming, ctx.openerCredit(i, focus))
  }

  const step = (p: Path, i: number, focus: GymFocus | null, credit: Credit, prev: Credit, prevGym: Credit, served: Muscle[], gain: number, light = false, counted = false): Path => {
    const P = { ...p.P }
    // A calisthenics day's own credit is in the week's total from the start (`ahead`).
    if (!counted) addCredit(P, credit)
    const last = { ...p.last }
    for (const [m, v] of Object.entries(credit) as [Muscle, number][]) if (v >= 1) last[m] = i
    const gymEvents = { push: [...p.gymEvents.push], pull: [...p.gymEvents.pull] }
    // Light pressing is not a hard pressing session: it rests nothing around it.
    for (const f of focus ? focusFamilies(focus) : []) if (!(light && f === 'push')) gymEvents[f].push(days[i].at)
    return {
      foci: [...p.foci, focus],
      light: [...p.light, light],
      pressed: p.pressed || (focus !== null && PRESSING.has(focus)),
      serves: [...p.serves, served],
      P,
      prev,
      prevGym,
      gymEvents,
      last,
      athletic: p.athletic + (focus === 'athletic' ? 1 : 0),
      score: p.score + gain,
    }
  }
  for (const i of idxs) {
    const d = days[i]
    const slot = slots[i]
    const outsideLoad: Credit = {}
    for (const a of d.sport) addCredit(outsideLoad, sportLoading(a), activityLoad(a))
    if (fixed?.index === i) {
      const prev = { ...fixed.prev }
      addCredit(prev, outsideLoad)
      // Lifts already logged today count by what was logged (`init.pressed`), not by the focus planned for them.
      paths = paths.map((p) => {
        const s = step(p, i, fixed.focus, fixed.credit, prev, fixed.prevGym, [], 0, Boolean(fixed.light))
        return fixed.logged ? { ...s, pressed: p.pressed } : s
      })
      continue
    }
    if (slot.gymMin <= 0) {
      const prev = { ...slot.credit }
      addCredit(prev, outsideLoad)
      paths = paths.map((p) => step(p, i, null, slot.credit, prev, {}, [], 0, false, true))
      continue
    }
    const legsBlocked = Boolean(d.legsCovered || d.sameDay || d.upcoming) || ctx.legsOff
    const S = sessionSets(slot.gymMin, d.factor)
    const ord = gymDays.indexOf(i)
    const keepsOpener = (focus: GymFocus) => !slot.reservedOpener || ctx.opener(i, focus) === slot.reservedOpener.skill
    const open = FOCI.filter((f) => openOnDay(d, f, ctx.musclesOff, ctx.legsOff, ctx.power)).filter(
      (f) => keepsOpener(f) && ctx.viable(d, ctx.gymMinutes(i, f), f) && focusFamilies(f).every((fam) => !ctx.shared[fam] || ctx.clear(fam, i)),
    )
    // The week's last day for the legs trains them (`legsLastChance`).
    if (slot.legDay) {
      const full = slot.wholeBody && open.includes('full') ? ctx.lifts(d, ctx.gymMinutes(i, 'full'), 'full') : undefined
      const coversBoth = full && ((full.quads ?? 0) >= 1 || (full.hamstrings ?? 0) >= 1) && (full.chest ?? 0) >= 1
      const legs = coversBoth ? (['full'] as GymFocus[]) : open.filter((f) => {
        if (f === 'lower') return true
        if (f !== 'full' && f !== 'athletic') return false
        if (slot.why !== 'leg-coverage') return true
        const work = ctx.lifts(d, ctx.gymMinutes(i, f), f)
        return (work.quads ?? 0) >= 2 && (work.hamstrings ?? 0) >= 2
      })
      if (legs.length) open.splice(0, open.length, ...legs)
    }
    // A push or upper day the push family's rest rule keeps from pressing hard here, built light instead: offered only
    // to a week with no gym pressing yet, and never on the legs' day. (A day the push family's skill could open is one
    // of the first priority's own days, reserved before this, so a light day never opens with it.)
    // Light pressing is there for the weekly pressing rule when nothing heavier fits: never when a later gym day of this
    // week opens with the push family's skill, whose hard pressing carries the week (round six). Without this look
    // ahead a light upper day went the day before a 90° hold opener's push day, the opener beside a pressing day.
    const heavierLater = idxs.some((j) => j > i && slots[j].kind === 'gym' && slots[j].hint === 'push')
    let lightOpen: GymFocus[] =
      !heavierLater && ctx.weeklyPress && ctx.shared.push && !slot.legDay
        ? (['push', 'upper'] as GymFocus[]).filter((f) => keepsOpener(f) && openOnDay(d, f, ctx.musclesOff, ctx.legsOff, ctx.power) && ctx.viable(d, ctx.gymMinutes(i, f), f, lightSpare))
        : []
    // The next gym session goes to the part of the body left longest, when anything open today trains it —
    // unless the day was chosen to open with a family's skill, which its focus must train.
    if (i === ctx.nextGymDay && ctx.staleGroup && !slot.hint) {
      const group = ctx.staleGroup
      const trainsGroup = (f: GymFocus) => {
        const minutes = ctx.gymMinutes(i, f)
        if (f === 'full' && group !== 'lower' && slot.legDay && ctx.physique >= 3 &&
            (!ctx.shared[group] || ctx.clear(group, i)) && !d.sportRest[group]) {
          return ctx.compoundSets(d, minutes, f, group) >= 2
        }
        return TRAINS[group].includes(f) && FOCUS_MUSCLES[group].some((m) => !d.off.has(m) && (ctx.lifts(d, minutes, f)[m] ?? 0) >= 1)
      }
      const trains = open.filter(trainsGroup)
      if (trains.length) {
        open.splice(0, open.length, ...trains)
        lightOpen = lightOpen.filter(trainsGroup)
      }
    }
    // The week's pressing rides on the first gym day chosen for a family's skill that can carry it — those days hold,
    // where a day the goal split gave the gym can change kind as the week is logged (a light push day planned for a
    // Sunday once became that Sunday's calisthenics) — unless a push day that opens with the push family's skill (hard
    // pressing beside its holds) comes later this week. Elsewhere the best path that presses is taken.
    const pressHere = ctx.weeklyPress && Boolean(slot.hint) && !slot.legDay && !idxs.some((j) => j > i && slots[j].kind === 'gym' && slots[j].hint === 'push')
    /** Whether the push family leaves this day free for hard pressing on a path: nothing of it near, fixed or chosen. */
    const pushFree = (p: Path) =>
      !ctx.shared.push || (ctx.clear('push', i) && p.gymEvents.push.every((t) => startOfDay(t) === d.start || apart(t, d.at) >= ctx.restMs))
    const pullFree = (p: Path) =>
      !ctx.shared.pull || (ctx.clear('pull', i) && p.gymEvents.pull.every((t) => startOfDay(t) === d.start || apart(t, d.at) >= ctx.restMs))
    // Pressing beside planche-type holds, or pulling beside lever work, is no
    // longer marked down on the same day: the family rest rule spaces hard
    // sessions of a family apart on different days, so a push day carries the
    // holds and the pressing together (skills first) and the days around it
    // stay clear of both.
    const penalty = (f: GymFocus) => {
      let x = 0
      if (f === 'push' && d.liftJoints.includes('wrists')) x += 0.35
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
        focusFamilies(f).every((fam) => !ctx.shared[fam] || p.gymEvents[fam].every((t) => startOfDay(t) === d.start || apart(t, d.at) >= ctx.restMs))
      // The athlete's own pick for today stands, with every limit of the day; the rest of the week adapts to it. A
      // full-body day beside push-family work presses lightly, picked or not: it is not a pressing pick.
      const forced = i === 0 ? ctx.todayFocus : undefined
      let choices: { f: GymFocus; light: boolean }[] = forced
        ? [{ f: forced, light: forced === 'full' && !pushFree(p) }]
        : open
            .filter((f) => familyFree(f) && (f !== 'athletic' || (p.athletic < ctx.athleticWanted && p.foci[p.foci.length - 1] !== 'athletic')))
            .map((f) => ({ f, light: f === 'full' && !pushFree(p) }))
            // A full-body day that presses lightly is built with the pressing pair spared: it counts only while that
            // build still holds two movements for its own muscles (round seven) — at home, beside a planche day, one
            // push-up and four core movements once made a Saturday's hour.
            .filter((c) => !c.light || ctx.viable(d, ctx.gymMinutes(i, c.f), c.f, lightSpare))
      /**
       * Whether a focus cannot fill its day: half or more of the muscles it is for (`focusMain`) are ones the week as
       * planned — this path's days and every skill day — takes past the steer's line, so the steer would spare them and
       * leave the day what the probe found: one press, raises and a fly in an hour. Light pressing spares its pair by
       * design and is not judged here; the athlete's own priorities are never spared, so never spent.
       */
      const spent = (c: { f: GymFocus; light: boolean }) => {
        if (c.light) return false
        const have = { ...p.P }
        addCredit(have, laterPractice.get(i) ?? {})
        addCredit(have, slot.credit)
        addCredit(have, ctx.lifts(d, ctx.gymMinutes(i, c.f), c.f, c.light ? lightSpare : []))
        const main = focusMain(c.f).filter((m) => !d.off.has(m) && ctx.targets[m][1] > 0 && !ctx.priority.has(m))
        const over = main.filter((m) => (have[m] ?? 0) > STEER_LINE * ctx.targets[m][1])
        return main.length > 0 && over.length * 2 >= main.length
      }
      // Not the same focus, nor the same muscles hard, in the gym two days running — while anything else is open.
      const lastFocus = p.foci.length ? p.foci[p.foci.length - 1] : (init.prevFocus ?? null)
      // Read from the session each focus builds, not the estimate: a full-body day the morning after a lower day
      // was four glute sets, past `HARD_SETS`, while the estimate said three.
      const liftsOf = (c: { f: GymFocus; light: boolean }) => ctx.lifts(d, ctx.gymMinutes(i, c.f), c.f, c.light ? lightSpare : [])
      const clash = (c: { f: GymFocus; light: boolean }) =>
        c.f === lastFocus || (Object.entries(liftsOf(c)) as [Muscle, number][]).some(([m, n]) => n >= HARD_SETS && (p.prevGym[m] ?? 0) >= HARD_SETS)
      // A week with no gym pressing yet may press here lightly, where hard pressing is ruled out — on a gym day the
      // day's own rules fill anyway: the weekly pressing changes what a gym day presses, never a day's kind. A light
      // upper day still pulls hard, so the pull family's rest rule holds for it as for any pulling day.
      if (!forced && !p.pressed && choices.some((c) => !clash(c))) {
        for (const f of lightOpen) {
          if (choices.some((c) => c.f === f) || (f === 'upper' && !pullFree(p))) continue
          choices.push({ f, light: true })
        }
      }
      // A day chosen to open with a family's skill trains that family, when anything open lets it.
      const hint = forced ? undefined : slot.hint
      // Its own family's focus first: an upper day would press and pull, and rest the other family around it too —
      // unless its pressing is light, which rests nothing: then it stays a choice beside the family's own.
      if (hint && choices.some((c) => focusFamilies(c.f).includes(hint) && ctx.opener(i, c.f))) {
        const opening = choices.filter((c) => focusFamilies(c.f).includes(hint) && ctx.opener(i, c.f))
        const own = opening.filter((c) => c.f === hint || c.light)
        // Its own focus first — and when the week already has its muscles spent, beside it the other foci the skill opens
        // that fill the day (a planche opener before an upper day, rather than before one press, raises and a fly); the
        // rule below picks among them once the two-days-running rule has had its say.
        // A lever opener can precede upper body. Keep that option when it serves
        // a chosen muscle better, even if a pure pull workout would also fit.
        const ownFits = own.some((c) => !spent(c))
        // On a single-family road the opener already trains that family. An
        // upper-body session can use the same day for a neglected row or press.
        const opposite = hint === 'push' ? 'pull' : 'push'
        const needs = [...ctx.priority]
        if (!ctx.shared[opposite]) needs.push(hint === 'push' ? 'lats' : 'chest')
        const others = opening.filter((c) => !own.includes(c) && !spent(c) && (!ownFits ||
          needs.some((m) => (p.P[m] ?? 0) < ctx.targets[m][0] &&
            (liftsOf(c)[m] ?? 0) > Math.max(0, ...own.map((o) => liftsOf(o)[m] ?? 0)))))
        choices = own.length ? [...own, ...others] : opening
      }
      let calm = forced ? choices : choices.filter((c) => !clash(c))
      if (!forced && pressHere && !p.pressed) {
        const pressing = calm.filter((c) => PRESSING.has(c.f))
        if (pressing.length) calm = pressing
      }
      // A focus that cannot fill its day is not chosen while another one serves the week (round six).
      if (!forced) {
        const fills = calm.filter((c) => !spent(c))
        if (fills.length) calm = fills
      }
      if (!choices.length) {
        // Nothing builds or fits the rules today: no gym block, said in the day's reasons.
        const prev = { ...slot.credit }
        addCredit(prev, outsideLoad)
        next.push(step(p, i, null, slot.credit, prev, {}, [], 0))
        continue
      }
      if (!calm.length) {
        // Everything left repeats yesterday's focus or its hard muscles: no gym block rather than the same muscles two days running.
        const prev = { ...slot.credit }
        addCredit(prev, outsideLoad)
        next.push(step(p, i, null, slot.credit, prev, {}, [], 0))
        continue
      }
      for (const c of calm) {
        const f = c.f
        // A light push or upper day is read from the session it builds: the estimate would credit pressing it leaves out.
        const credit = liftsOf(c)
        const have = { ...p.P }
        addCredit(have, laterPractice.get(i) ?? {})
        addCredit(have, slot.credit)
        if (!(ctx.shared.push && ctx.shared.pull) && ctx.opener(i, f)) addCredit(have, ctx.openerCredit(i, f))
        let need = 0
        let band = 0
        let over = 0
        const served: [Muscle, number][] = []
        for (const [m, n] of Object.entries(credit) as [Muscle, number][]) {
          const [lo, hi] = ctx.targets[m]
          const w = ctx.weights[m]
          const h = have[m] ?? 0
          const met = Math.max(0, Math.min(lo, h + n) - Math.min(lo, h))
          need += w * met
          // A compound may credit several assisting muscles. Keep that breadth
          // from outweighing a large shortfall in a muscle the athlete chose.
          // The extra weight tapers out as the week approaches its target.
          if (ctx.physique >= 3 && ctx.priority.has(m)) {
            need += 2 * Math.min(n, Math.max(0, 0.75 * lo - h)) + 0.5 * met
          }
          // With only a few working sets available, a first dose of knee,
          // hip, push or pull work matters more than a third pressing angle.
          if ((slot.gymMin < MIN_LIFTS_AFTER_OPENER || (ctx.physique >= 3 && ctx.priority.size > 0)) && BASIC_LIFT_MUSCLES.has(m)) {
            need += 2 * w * Math.min(n, Math.max(0, Math.min(4, lo) - h))
          }
          if (met >= 0.5) served.push([m, w * met])
          band += w * Math.max(0, Math.min(hi, h + n) - Math.max(lo, h))
          over += Math.max(0, h + n - hi) - Math.max(0, h - hi)
        }
        // The most behind first and earliest: a later day may not happen. Sets past a muscle's top target cost; far
        // past it, the lifts leave it out (`steer`), from the whole week's work.
        let gain = need * (1 + 0.03 * (gymDays.length - 1 - ord)) + 0.3 * band - 0.5 * over
        for (const [m, n] of Object.entries(credit) as [Muscle, number][]) gain -= 0.8 * Math.min(p.prev[m] ?? 0, n)
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
        if (opener) addCredit(dayCredit, ctx.openerCredit(i, f))
        const prev = { ...dayCredit }
        addCredit(prev, outsideLoad)
        next.push(step(p, i, f, dayCredit, prev, liftsOf(c), served.sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]), gain, c.light))
      }
    }
    next.sort((a, b) => b.score - a.score)
    paths = next.slice(0, BEAM)
  }
  // The weekly pressing rule: the best path that presses this calendar week, when any can.
  return (ctx.weeklyPress ? paths.find((p) => p.pressed) : undefined) ?? paths[0]
}

export interface WeekDayPlan {
  /** Local calendar day, YYYY-MM-DD. */
  day: string
  at: number
  plan: TodayPlan
  /** Planned sets of each current progression exercise, excluding warm-ups and attempts. */
  skillWorkingSets?: Partial<Record<SkillId, number>>
  /** The day's one main session (the same as `plan.kind`). */
  kind: DayKind
  /** Short lines for the week view: why this day looks the way it does. */
  why: string[]
  /** Sport on this day, logged or from the sport week. */
  sport?: SportEvent
  /** Present when more than one sport session falls on the day. */
  sportCount?: number
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
  /**
   * Each muscle's sets this calendar week as planned: logged, every skill day as the session it builds, and the lifts
   * as each day's focus builds them, steered — what the steer reads, and what a session outside the plan is steered by.
   */
  weekTotal: Credit
  weekSources: MuscleSetSources
  /** The remaining lifts that supplied this calendar week's forecast. Same-day logged work is already counted. */
  remainingLifts: { at: number; placeId: string; minutes: number; estimatedMin: number; setLimit?: number; items: { exerciseId: string; sets: number }[] }[]
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
type WeekOptions = TodayKindPick & { todayMinutes?: number; inner?: boolean; todayFocus?: GymFocus; todayPlace?: GymLocation; coverLegWeeks?: number[]; restOpeners?: string[]; liftingPlaceDate?: string }
const weeksByState = new WeakMap<AppState, Map<string, WeekAhead>>()
const pastPlans = new WeakMap<AppState, Map<number, TodayPlan>>()

/**
 * The week from today: each day's one main session — calisthenics or the gym,
 * with any opener — and why, planned together and again from what actually
 * happened. `todayMinutes` is "I have X minutes" for today, `todayKind` "Rather
 * do … today". Pure: state and time in, plan out.
 */
export function planWeekAhead(
  state: AppState,
  now = Date.now(),
  opts: WeekOptions = {},
): WeekAhead {
  // Screens and the gym builder often ask for the identical week while rendering
  // one immutable store snapshot. A preview with an edited, unsaved place is distinct.
  if (opts.todayPlace && !state.gym?.locations.includes(opts.todayPlace)) return buildWeekAhead(state, now, opts)
  let cache = weeksByState.get(state)
  if (!cache) weeksByState.set(state, (cache = new Map()))
  const key = JSON.stringify([now, opts.todayMinutes, opts.todayKind, opts.todayWhy, opts.todayFocus, opts.todayPlace?.id, opts.inner, opts.coverLegWeeks, opts.restOpeners, opts.liftingPlaceDate])
  const cached = cache.get(key)
  if (cached) return cached
  const baseline = buildWeekAhead(state, now, opts)
  const week = opts.liftingPlaceDate || opts.coverLegWeeks || opts.restOpeners || opts.todayKind || opts.todayFocus ? baseline :
    fitLiftingPlace(state, baseline, now, (day) => planWeekAhead(state, now, { ...opts, liftingPlaceDate: day }))
  if (cache.size >= 16) cache.delete(cache.keys().next().value!)
  cache.set(key, week)
  return week
}

function buildWeekAhead(state: AppState, now: number, opts: WeekOptions): WeekAhead {
  // An athlete who never set the gym side up keeps the skill side's own days and minutes (`dayContexts`).
  const own = state.gym?.prefs
  const prefs: TrainingPrefs = own ?? defaultPrefs(now)
  const skills = trainedSkills(state)
  const canShareBalance = skills[0] === 'handstand' && prefs.goals.skills > 0 && prefs.goals.physique >= 3 &&
    (skills.length === 1 || prefs.goals.physique >= prefs.goals.skills)
  const balancedSkillWeek = skills.length === 1 && prefs.goals.skills > 0 &&
    prefs.goals.physique >= Math.max(3, prefs.goals.skills) && prefs.minutesByDay.filter((m) => m > 0).length >= 4
  const singleSkillWeek = skills.length === 1 && prefs.goals.skills > 0 && prefs.goals.physique >= 3 &&
    prefs.minutesByDay.filter((m) => m > 0).length <= 3
  // Choosing the gym should preserve a full handstand practice that already
  // shares today's gym session. Only this conversion happens after kind selection.
  if ((canShareBalance || singleSkillWeek || balancedSkillWeek) && opts.todayKind === 'gym' && !opts.todayFocus && !opts.coverLegWeeks && opts.todayWhy !== 'followed') {
    const recommended = planWeekAhead(state, now, { ...opts, todayKind: undefined, todayWhy: undefined })
    if (recommended.days[0].plan.gym) return recommended
  }
  const today = startOfDay(now)
  const thisWeek = weekStart(now)
  const nextWeek = addDays(thisWeek, 7)
  const horizonEnd = addDays(today, 7) > nextWeek ? addDays(nextWeek, 7) : nextWeek
  // Every session the week is built from is built as today began (`asTodayBegan`): what today's own sessions did is
  // read from the log where it matters — the rest rule, the week's sets — so following the plan cannot rebuild it.
  const base = asTodayBegan(state, now)
  const days = dayContexts(state, base, prefs, Boolean(own), now, horizonEnd, opts.todayMinutes)
  const gymSessions = state.gym?.sessions ?? []
  const capacity = bodyweightCapacity(base, now)
  // The first two visits have at most eight working sets. A later visit in
  // the preview can only budget a small increase until real sets are logged.
  const afterIntro = capacity.introductory
    ? { ...capacity, introductory: false, buildUpSetLimit: 10 }
    : capacity
  let firstRegularDay = Infinity
  const active = activePlace(state)
  // Gym days are planned at the gym (`gymPlaceOf`), wherever the app is set now.
  const place = usualGymPlace(state, now)
  const fixedPlaces = days.map((d, i) => (i === 0 ? opts.todayPlace : undefined) ?? weekdayPlace(state, d.at))
  const placeAt = (i: number) => fixedPlaces[i] ?? place
  // Calisthenics happens where the athlete is: today with the active place's kit beside the athlete's own, later
  // days at home. A front lever day with no bar at home was "waiting for kit" at a gym with one; planned a week
  // ahead from the gym, a lever day assumed the gym's bar on a day at home.
  // Unassigned skill sessions can train at home or move to the gym for its
  // equipment. An explicitly picked place fixes where today's session builds.
  const skillPlaceToday = fixedPlaces[0] ?? (active?.id === 'home' ? active : undefined)
  const oneSkillPlace = !fixedPlaces[0] && active && active.id !== 'home' && roomFor(days[0].minutes) === 1 ? active : undefined
  // One skill can take its turn at either place. The chosen session below is
  // built using only the actual place's equipment.
  const todayKit = oneSkillPlace ? [...new Set([...base.profile.equipment, ...kitAt(base, oneSkillPlace)])]
    : skillPlaceToday ? hereKit(base, skillPlaceToday) : undefined
  const here = todayKit ? withRequestKit(base, { source: 'auto', kit: todayKit }) : base
  const calViews = days.map((d, i) => {
    const original = i !== 0 && d.minutes < OPENER_MINUTES ? state : base
    const fixed = fixedPlaces[i]
    return fixed ? withRequestKit(original, { source: 'auto', kit: ['floor', ...hereKit(original, fixed)] })
      : i === 0 ? here : original
  })
  const places: Places = {
    fixed: (i) => Boolean(fixedPlaces[i]),
    // Today's recorded work can change the next warm-up. On a brief future
    // visit that can be the difference between two working holds and three.
    cal: (i) => calViews[i],
    ...(place && hasGymKit(place) ? { gymCal: withRequestKit(base, { source: 'auto', kit: kitAt(base, place) }), gym: place } : {}),
  }
  const youth = conservative(state.profile, now)
  const restMs = prefs.straightArmRestHours * HOUR
  const logged = familyEvents(state, now)
  const legsOff = !focusOpen('lower', prefs.musclesOff)
  // A focus counts only when it builds two movements or more at the place with the day's limits —
  // checked by building it, once per distinct set of limits.
  const built = new Map<string, ReturnType<typeof planGymExercises>>()
  const buildAt = (d: DayCtx, minutes: number, focus: GymFocus, spare: Muscle[] = [], extra: Muscle[] = []) => {
    const factor = focus === 'athletic' ? Math.min(1, d.factor) : d.factor
    const off = [...d.off].sort()
    const spared = [...new Set(spare)].sort()
    const priority = [...new Set([...prefs.musclesPriority, ...extra])]
    const location = placeAt(d.index)
    const level = d.index < firstRegularDay ? capacity : afterIntro
    const key = [focus, minutes, factor, [...d.liftJoints].sort().join(','), off.join(','), spared.join(','), priority.join(','), d.at, location?.id, level.introductory].join('|')
    if (!built.has(key)) {
      const plan = planGymExercises({
        location,
        capacity: level,
        minutes,
        focus,
        sessions: gymSessions,
        ratings: state.gym?.ratings,
        youth,
        goals: prefs.goals,
        musclesOff: off,
        ...(spared.length ? { spare: spared } : {}),
        priority,
        athletePriority: prefs.musclesPriority,
        avoidJoints: d.liftJoints,
        volumeFactor: factor,
        ...(minutes < d.minutes ? { warmUpMin: AFTER_OPENER_WARM_UP_MIN } : {}),
        favoriteAt: state.gym?.favoriteAt,
        now: d.at,
      })
      built.set(key, plan)
    }
    return built.get(key)!
  }
  const viable = (d: DayCtx, minutes: number, focus: GymFocus, spare: Muscle[] = []): boolean => {
    const minimum = minutes < d.minutes ? MIN_LIFTS_AFTER_OPENER : MIN_GYM_MINUTES
    if (!placeAt(d.index) || minutes < minimum) return false
    const plan = buildAt(d, minutes, focus, spare)
    return plan.fits && ownMovements(plan.items, focus) >= (minutes < MIN_LIFTS_AFTER_OPENER ? 1 : 2)
  }
  /** What the session a focus builds on a day does to each muscle, set by set (`gymSetLoading`): a full-body day's two squat and two hinge sets are four glute sets. */
  const credits = new WeakMap<ReturnType<typeof buildAt>, Credit>()
  const liftCredit = (d: DayCtx, minutes: number, focus: GymFocus, spare: Muscle[] = [], priority: Muscle[] = []): Credit => {
    const out: Credit = {}
    if (!placeAt(d.index) || minutes < MIN_GYM_MINUTES) return out
    const plan = buildAt(d, minutes, focus, spare, priority)
    const cached = credits.get(plan)
    if (cached) return cached
    for (const it of plan.items) addLiftVolume(out, it.exerciseId, it.sets)
    credits.set(plan, out)
    return out
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
    else if (state.sessions.some((s) => on(s.startedAt) && countsSkillDay(s))) before.cal++
  }
  const openOn = (d: DayCtx, f: GymFocus) => openOnDay(d, f, prefs.musclesOff, legsOff, g.power)
  /** Whether the sport and joint rules leave the legs open on a day, and a lower-body block builds there. */
  const legsOpen = (d: DayCtx) => d.minutes >= MIN_GYM_MINUTES && openOn(d, 'lower') && viable(d, d.minutes, 'lower')
  const legsLast = gymSessions
    .filter((x) => x.startedAt < today && x.exercises.some((e) => ['squat', 'hinge', 'lunge'].includes(GYM_EXERCISE_BY_ID[e.exerciseId]?.pattern ?? '') && e.sets.some((s) => !s.warmup && s.reps > 0)))
    .reduce<number | undefined>((m, x) => (m === undefined || x.startedAt > m ? x.startedAt : m), undefined)
  const slots = planSkills(base, places, prefs, days, skills, {
    coverLegWeeks: opts.coverLegWeeks,
    liftingPlaceDate: opts.liftingPlaceDate,
    restMs,
    logged,
    wantsGym: gymWanted && Boolean(place),
    gymWanted,
    gymFits: (d, minutes) => FOCI.some((f) => openOn(d, f) && viable(d, minutes, f)),
    familyGymFits: (d, minutes, fam) => ([fam, 'upper'] as GymFocus[]).some((f) => openOn(d, f) && viable(d, minutes, f)),
    legsWanted: gymWanted && !legsOff && targets.quads[0] > 0,
    legsOpen,
    ...(legsLast !== undefined ? { legsLast } : {}),
    placeAt,
    share: Math.min(0.75, Math.max(0.25, g.skills / Math.max(1, g.skills + gymWeight))),
    targets,
    weights,
    weekSets: setsPerMuscle(state.sessions, gymSessions, thisWeek, today),
    before,
    ...(opts.todayKind ? { todayKind: opts.todayKind, todayWhy: opts.todayWhy ?? 'picked' } : {}),
    ...(opts.todayFocus ? { todayFocus: opts.todayFocus } : {}),
  })
  if (capacity.introductoryVisitsLeft) {
    const lastIntro = slots.flatMap((sl, i) => sl.gymMin > 0 ? [i] : [])[capacity.introductoryVisitsLeft - 1]
    if (lastIntro !== undefined) firstRegularDay = lastIntro + 1
  }
  // Build the skill work before booking the whole visit for it. A gym with time left
  // after the working holds and next-shape attempts can also serve the physique goal.
  if ((canShareBalance || balancedSkillWeek) && gymWanted) {
    for (const d of days) {
      const slot = slots[d.index]
      const location = placeAt(d.index)
      const skill = slot.skills[0]
      if (!location || slot.kind !== 'calisthenics' || slot.skills.length !== 1 || skill !== skills[0] ||
          d.assigned || d.pain || d.niggle || d.held || d.factor < 1 || (d.index === 0 && opts.todayKind)) continue
      const family = skillFamily(skill) === 'pull' ? 'pull' : 'push'
      if (d.sportRest[family] || (skill !== 'handstand' && (!balancedSkillWeek || !hasGymKit(location)))) continue
      const kit = kitAt(base, location)
      if (missingSkillKit(base, skill, kit).length) continue
      const full = builtSkill(base, [skill], d.minutes, d.at, kit)
      const room = skill === 'handstand' ? full.minutes : builtSkill(base, [skill], d.minutes, d.at, kit, true).minutes
      const minutes = Math.max(MIN_SKILL_MINUTES[1], room)
      if (full.painSafe || d.minutes - minutes < MIN_LIFTS_AFTER_OPENER || !full.key[skill]) continue
      const opener = builtSkill(base, [skill], minutes, d.at, kit, true)
      if (opener.minutes > minutes || opener.key[skill] !== full.key[skill] || opener.attempts < full.attempts) continue
      if (skill === 'handstand' && (opener.rest.push !== full.rest.push ||
          (opener.credit['front-delts'] ?? 0) < (full.credit['front-delts'] ?? 0))) continue
      if (!FOCI.some((f) => f !== 'athletic' && openOn(d, f) && viable(d, d.minutes - minutes, f))) continue
      slots[d.index] = { ...slot, kind: 'gym', why: 'skill-practice', hint: undefined, exposure: true, reservedOpener: { skill, minutes },
        skillMin: 0, gymMin: d.minutes, skills: [], parts: [], families: new Set(), credit: {} }
    }
  }
  // One short lifting block cannot train the whole body beside three skill
  // practices. Keep the lead's working holds on another day and use its
  // accessory time for the legs when the actual workouts both fit.
  if (singleSkillWeek && !legsOff) {
    const lead = skills[0]
    for (const wk of new Set(days.map((d) => d.week))) {
      const inWeek = days.filter((d) => d.week === wk)
      const liftingDays = inWeek.filter((d) => slots[d.index].kind === 'gym').length + (wk === thisWeek ? before.gym : 0)
      if (liftingDays !== 1) continue
      for (const d of inWeek.reverse()) {
        const sl = slots[d.index]
        const place = placeAt(d.index)
        if (!place || sl.kind !== 'calisthenics' || sl.skills.length !== 1 || sl.skills[0] !== lead ||
          d.assigned || d.pain || d.niggle || d.held || d.factor < 1 || !legsOpen(d) || (d.index === 0 && opts.todayKind)) continue
        const kit = kitAt(base, place)
        const minutes = openerMinutesOf(base, lead, d.minutes, d.at, place)
        if (missingSkillKit(base, lead, kit).length || !viable(d, d.minutes - minutes, 'lower')) continue
        const practice = builtSkill(base, [lead], minutes, d.at, kit, true)
        if (practice.painSafe || !(practice.key[lead] && practice.key[lead] >= builtSkill(base, [lead], UNTRIMMED_MINUTES, d.at, kit).bare)) continue
        slots[d.index] = { ...sl, kind: 'gym', why: 'leg-coverage', legDay: true, reservedOpener: { skill: lead, minutes },
          exposure: true, skillMin: 0, gymMin: d.minutes, skills: [], parts: [], credit: {} }
        break
      }
    }
  }
  const selectedSkills = g.skills > 0 || days.some((d) => d.assigned?.length)
  const sharesRecovery = (fam: Straight) => (selectedSkills && skills.some((s) => skillFamily(s) === fam)) ||
    slots.some((s) => s.families.has(fam) || s.hint === fam || (fam === 'push' && s.presses)) ||
    logged[fam].some((e) => e.at < now && insideRest(now, e.at, restMs) &&
      (!e.gym || state.profile.skills?.some((s) => skillFamily(s) === fam)))
  const shared = { push: sharesRecovery('push'), pull: sharesRecovery('pull') }
  // The days that hold hard sessions of a family: the calisthenics days while the gym is planned, then every day's.
  let familySlots = slots
  const firstFamily = skillFamily(skills[0])
  /** Whether a day holds a hard session of the family: its hard parts, or — before its opener is chosen — the first priority's gym day it opens. */
  const holdsFamily = (sl: SkillSlot, fam: Straight) =>
    sl.families.has(fam) || (fam === 'push' && Boolean(sl.presses)) || (Boolean(sl.exposure) && sl.kind === 'gym' && fam === firstFamily)
  // Logged hard sessions and planned skill sessions of a family on other days, inside the rest rule. The first
  // priority's days count before their opener is chosen: the gym never presses beside them on another day.
  const fixedNear = (fam: Straight, i: number) => {
    const d = days[i]
    return [
      ...logged[fam].filter((e) => e.at < d.start && insideRest(d.at, e.at, restMs)).map((e) => ({ at: e.at, gym: e.gym, logged: true, press: Boolean(e.press) })),
      ...familySlots.flatMap((sl, j) =>
        j !== i && holdsFamily(sl, fam) && apart(days[j].at, d.at) < restMs
          ? [{ at: days[j].at, gym: false, logged: false, press: fam === 'push' && Boolean(sl.presses) && !sl.families.has('push') }]
          : [],
      ),
    ]
  }
  /** Whether a gym day may open with the family: no logged hard session on an earlier day, nor a skill day of it, inside the rest rule. */
  const openerClear = (fam: Straight, i: number) => {
    const d = days[i]
    if (d.sportRest[fam]) return false
    if (logged[fam].some((e) => e.at < d.start && insideRest(d.at, e.at, restMs))) return false
    return !slots.some(
      (sl, j) =>
        j !== i &&
        apart(days[j].at, d.at) < restMs &&
        (sl.parts.some((p) => (p.role === 'lead' || p.role === 'partner') && skillFamily(p.skill) === fam) ||
          (fam === 'push' && Boolean(sl.presses)) ||
          (Boolean(sl.exposure) && sl.kind === 'gym' && fam === firstFamily)),
    )
  }
  // A hard pulling quota can book the lever twice even when the athlete ranked
  // handstand first. Use the duplicate opener for balance when both skills keep
  // a real session and the lifts still fit in the same time.
  const balanceWithLifting = skills.length === 1 && skills[0] === 'handstand' && g.skills > 0 &&
    Math.max(g.strength, g.power) > g.skills
  if (canShareBalance || balanceWithLifting) {
    const practices = (sl: SkillSlot, skill: SkillId) => sl.skills.includes(skill) || (sl.reservedOpener
      ? sl.reservedOpener.skill === skill : Boolean(sl.hint && skills.find((s) => skillFamily(s) === sl.hint) === skill))
    // Replace an extra secondary opener first. On an all-gym week a plain
    // lifting slot can instead give the chosen first skill its only practice.
    const byOpportunity = [...days].sort((a, b) => Number(slots[b.index].why === 'family-opener') - Number(slots[a.index].why === 'family-opener'))
    for (const d of byOpportunity) {
      const sl = slots[d.index]
      const place = placeAt(d.index)
      const gap = daysSinceFullPart(base, 'handstand', d.at)
      const shortPress = d.index === 0 && d.minutes < OPENER_MINUTES + MIN_LIFTS_AFTER_OPENER &&
        d.minutes >= MIN_LIFTS_AFTER_OPENER + 8 && g.skills >= 3 && base.tracks?.handstand?.repGoal &&
        gap !== null && gap >= 6 && d.factor >= 1
      if (!place || sl.kind !== 'gym' || !(['family-opener', 'share', 'leg-coverage', 'legs', 'sets'].includes(sl.why ?? '') ||
          ((balanceWithLifting || shortPress) && sl.why === 'reserved-lifts')) || sl.reservedOpener || d.assigned ||
          d.pain || d.niggle || d.held || d.sportRest.push || (d.index === 0 && opts.todayFocus) || !openerClear('push', d.index)) continue
      const other = skills.find((skill) => skillFamily(skill) === sl.hint)
      const count = (skill: SkillId) => slots.filter((s, j) => days[j].week === d.week && practices(s, skill)).length +
        new Set(state.sessions.filter((s) => s.startedAt >= d.week && s.startedAt < Math.min(today, addDays(d.week, 7)) && fullPartIn(s, skill)).map((s) => dayKey(s.startedAt))).size
      const firstDays = count('handstand')
      const wanted = skills.length === 1 && g.skills >= 3 ? 2 : 1
      if (other ? other === 'handstand' || firstDays >= 2 || count(other) <= Math.max(1, firstDays) : firstDays >= wanted) continue
      const kit = kitAt(base, place)
      if (missingSkillKit(base, 'handstand', kit).length || FAMILY_JOINTS.push.some((joint) => d.avoidJoints.includes(joint))) continue
      const minutes = shortPress ? Math.min(MIN_SKILL_MINUTES[1] - 1, d.minutes - MIN_LIFTS_AFTER_OPENER) :
        balanceWithLifting && !canShareBalance ? OPENER_MINUTES : openerMinutes(d.minutes)
      const practice = builtSkill(base, ['handstand'], minutes, d.at, kit, true)
      const fitted = shortPress ? practice.minutes : minutes
      if (practice.painSafe || !practice.key.handstand || (shortPress && (fitted > minutes || !practice.rest.push)) ||
        !FOCI.some((f) => f !== 'athletic' && openOn(d, f) && viable(d, d.minutes - fitted, f))) continue
      sl.reservedOpener = { skill: 'handstand', minutes: fitted }
      sl.hint = undefined
      if (!sl.legDay) sl.why = 'skill-practice'
      sl.presses = practice.rest.push >= 3
    }
  }
  // When skills lead on a short week, the athlete may have just one lifting
  // day. Keep its existing skill opener and use the lifts for the whole body.
  if (g.skills > g.physique && g.physique >= 3 && !legsOff && prefs.minutesByDay.filter((m) => m > 0).length <= 3) {
    for (const wk of new Set(days.map((d) => d.week))) {
      if (legsLast !== undefined && legsLast >= addDays(wk, -3)) continue
      const gymDays = days.filter((d) => d.week === wk && slots[d.index].kind === 'gym')
      if (gymDays.length !== 1 || (wk === thisWeek && before.gym > 0)) continue
      const d = gymDays[0]
      const sl = slots[d.index]
      const place = placeAt(d.index)
      if (!place || d.assigned || d.pain || d.niggle || !legsOpen(d) || (d.index === 0 && opts.todayFocus)) continue
      const skill = sl.hint ? openerSkill(base, sl.hint, place, { minutes: d.minutes, sore: d.avoidJoints, pain: d.pain,
        blocked: (fam) => openerClear(fam, d.index) ? undefined : 'rest' }) : undefined
      if (skill) {
        const minutes = openerMinutesOf(base, skill, d.minutes, d.at, place)
        if (!viable(d, d.minutes - minutes, 'lower')) continue
        sl.reservedOpener = { skill, minutes }
      }
      sl.legDay = true
      sl.wholeBody = true
      sl.why = 'leg-coverage'
    }
  }
  // A lower-body session can also have skill practice. Give the space to a
  // selected skill that would otherwise miss the week, including a third priority.
  for (const d of days) {
    const slot = slots[d.index]
    const location = placeAt(d.index)
    // If the bar is only available on Saturday, a free wall on Tuesday
    // may be the only opportunity for a second skill. Keep both visits.
    const fixedGymVisit = slot.kind === 'gym' && weekdayPlace(state, d.at) && !slot.hint && !slot.exposure && g.skills > 0
    if ((!fixedGymVisit && slot.why !== 'leg-coverage') || slot.reservedOpener || !location || d.assigned || d.pain || d.niggle || d.held ||
        d.minutes < OPENER_MINUTES + MIN_LIFTS_AFTER_OPENER || (d.index === 0 && opts.todayFocus)) continue
    const kit = kitAt(base, location)
    const scheduled = (s: SkillId) => slots.some((sl, j) => days[j].week === d.week &&
      (sl.skills.includes(s) || sl.reservedOpener?.skill === s || (sl.hint && skills.find((sk) => skillFamily(sk) === sl.hint) === s)))
    const missing = skills.filter((s) => !scheduled(s) && !state.sessions.some((x) =>
      x.startedAt >= d.week && x.startedAt < today && x.startedAt < addDays(d.week, 7) && fullPartIn(x, s)))
    const waited = (s: SkillId) => daysSinceFullPart(base, s, d.at) ?? NEVER_TRAINED_DAYS
    missing.sort((a, b) => waited(b) - waited(a))
    for (const skill of missing) {
      if (missingSkillKit(base, skill, kit).length) continue
      const fam = skillFamily(skill) === 'pull' ? 'pull' : 'push'
      if (FAMILY_JOINTS[fam].some((j) => d.avoidJoints.includes(j)) || !openerClear(fam, d.index)) continue
      const minutes = openerMinutesOf(base, skill, d.minutes, d.at, location)
      if (!(slot.legDay ? viable(d, d.minutes - minutes, 'lower') :
          FOCI.some((f) => f !== 'athletic' && openOn(d, f) && viable(d, d.minutes - minutes, f)))) continue
      const practice = builtSkill(base, [skill], minutes, d.at, kit, true)
      if (practice.painSafe || !practice.key[skill]) continue
      slot.reservedOpener = { skill, minutes }
      if (practice.sets[fam] >= 3) slot.families.add(fam)
      if (practice.rest.push >= 3 && !slot.families.has('push')) slot.presses = true
      break
    }
  }
  // On a short, mixed-goal week a skill opener can precede squats or rows
  // just as well as pressing. Keep the skill's working dose and let the week
  // choose the lifts against the athlete's priorities across the whole body.
  const mixedPriorities = prefs.musclesPriority.some((m) => LEG_MUSCLES.includes(m)) &&
    prefs.musclesPriority.some((m) => !LEG_MUSCLES.includes(m))
  if (((singleSkillWeek && mixedPriorities) || (balancedSkillWeek && skills[0] !== 'handstand')) && g.physique >= g.skills) {
    const skill = skills[0]
    const family = skillFamily(skill) === 'pull' ? 'pull' : 'push'
    const pairedDose = singleSkillWeek ? repeatedPairedSets(base, skill, now) : 0
    for (const d of days) {
      const sl = slots[d.index], place = placeAt(d.index)
      if (!place || (balancedSkillWeek ? sl.kind !== 'gym' || sl.reservedOpener || !sl.hint : d.minutes >= LONG_OPENER_FROM) ||
        d.assigned || d.pain || d.niggle || d.held || d.factor < 1 ||
        (d.index === 0 && (opts.todayKind === 'calisthenics' || opts.todayFocus)) ||
        !(sl.skills.includes(skill) || sl.reservedOpener?.skill === skill || sl.hint === family || sl.exposure) ||
        d.avoidJoints.some((j) => FAMILY_JOINTS[family].includes(j)) || !openerClear(family, d.index)) continue
      const kit = kitAt(base, place)
      if (missingSkillKit(base, skill, kit).length) continue
      const liftingDays = slots.filter((slot, i) => days[i].week === d.week && slot.kind === 'gym').length + (d.week === thisWeek ? before.gym : 0)
      // At an equipped visit, a proven bilateral practice can share the week’s second lift.
      // Keep a full skill visit once the two lifting days fit, and retain any next-shape attempts.
      const sharePairs = !prefs.shortSkillOpeners && pairedDose >= 6 && liftingDays < 2 && hasGymKit(place)
      const budgetFloor = sharePairs ? Math.min(LONG_OPENER_MINUTES, d.minutes - MIN_LIFTS_AFTER_OPENER) : 0
      const minutes = openerMinutesOf(base, skill, d.minutes, d.at, place, budgetFloor)
      const practice = builtSkill(base, [skill], minutes, d.at, kit, true)
      const full = builtSkill(base, [skill], d.minutes, d.at, kit)
      const requiredSets = prefs.shortSkillOpeners ? 2 : sharePairs ? Math.min(pairedDose, full.bare) : full.bare
      if (practice.painSafe || practice.minutes > minutes || practice.attempts < full.attempts || (practice.key[skill] ?? 0) < Math.max(1, requiredSets) ||
        !FOCI.some((f) => f !== 'athletic' && openOn(d, f) && viable(d, d.minutes - minutes, f))) continue
      slots[d.index] = { ...sl, kind: 'gym', why: sl.legDay ? 'leg-coverage' : 'skill-practice',
        hint: undefined, reservedOpener: { skill, minutes }, exposure: true,
        skillMin: 0, gymMin: d.minutes, skills: [], parts: [], credit: {} }
    }
  }
  const openers = new Map<string, SkillId | undefined>()
  const openerTime = (i: number, skill: SkillId) => slots[i].reservedOpener?.minutes ?? openerMinutesOf(base, skill, days[i].minutes, days[i].at, placeAt(i)!)
  const opener = (i: number, focus: GymFocus): SkillId | undefined => {
    const key = `${i}|${focus}`
    if (!openers.has(key)) {
      const d = days[i]
      const at = placeAt(i)
      const reserved = slots[i].reservedOpener?.skill
      const resting = (family: string) => opts.restOpeners?.includes(`${i}:${family}`)
      const skill = (reserved && !resting(skillFamily(reserved)) ? reserved : undefined) ?? (
        at && slots[i].kind === 'gym'
          ? openerSkill(base, focus, at, { minutes: d.minutes, sore: d.avoidJoints, pain: d.pain, blocked: (fam) => (!resting(fam) && openerClear(fam, i) ? undefined : 'rest') })
          : undefined)
      // The gym must still build beside it.
      const minutes = skill ? openerTime(i, skill) : 0
      const practices = skill && at && viable(d, d.minutes - minutes, focus) ? builtSkill(base, [skill], minutes, d.at, kitAt(base, at), true) : undefined
      openers.set(key, skill && practices && !practices.painSafe && practices.skills.includes(skill) ? skill : undefined)
    }
    return openers.get(key)
  }
  const ctx: GymCtx = {
    targets,
    weights,
    lastHit: lastTrainedAt(state, now),
    power: g.power,
    physique: g.physique,
    athleticWanted: g.power >= 4 ? 2 : g.power >= 3 ? 1 : 0,
    legsOff,
    musclesOff: prefs.musclesOff,
    nextGymDay: slots.findIndex((sl) => sl.gymMin > 0),
    restMs,
    shared,
    priority: new Set(prefs.musclesPriority),
    clear: (fam, i) => fixedNear(fam, i).length === 0,
    viable,
    opener,
    gymMinutes: (i, focus) => {
      const skill = opener(i, focus)
      return slots[i].gymMin - (skill ? openerTime(i, skill) : 0)
    },
    lifts: liftCredit,
    compoundSets: (d, minutes, focus, group) => buildAt(d, minutes, focus).items.reduce((sets, item) => {
      const pattern = GYM_EXERCISE_BY_ID[item.exerciseId].pattern
      return sets + (NAMED_PATTERNS[group].some((options) => options.includes(pattern)) ? item.sets : 0)
    }, 0),
    openerCredit: (i, focus) => {
      const skill = opener(i, focus)
      const at = placeAt(i)
      return skill && at ? builtSkill(base, [skill], openerTime(i, skill), days[i].at, kitAt(base, at), true).credit : {}
    },
    ...(opts.todayFocus && slots[0]?.kind === 'gym' ? { todayFocus: opts.todayFocus } : {}),
    weeklyPress: (shared.push || prefs.musclesPriority.includes('chest') || prefs.musclesPriority.includes('chest-upper')) &&
      gymWanted && weights.chest > 0 && targets.chest[0] > 0 && focusOpen('push', prefs.musclesOff),
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
  /** Gym pressing logged this calendar week before `to`: the weekly pressing rule is met. */
  const pressedBy = (to: number) => gymSessions.some((s) => s.startedAt >= thisWeek && s.startedAt < to && pressedIn(s))
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
      pressed: pressedBy(today),
    },
    ctx,
  )
  const todayFocus = first.foci[0] ?? null
  const todayLight = Boolean(first.light[0])
  const skillDone = state.sessions.some((s) => s.startedAt >= today && s.startedAt <= now)
  const gymDone = gymSessions.some((s) => s.startedAt >= today && s.startedAt <= now)
  let week = first
  if (skillDone || gymDone) {
    // The rest of the week, from what actually happened today.
    const remaining: Credit = {}
    const todaySpare = todayLight ? [...LIGHT_PRESS_SPARE] : []
    if (!skillDone) addCredit(remaining, slots[0].credit)
    if (!gymDone && todayFocus && slots[0].gymMin > 0) {
      addCredit(remaining, ctx.lifts(days[0], ctx.gymMinutes(0, todayFocus), todayFocus, todaySpare))
    }
    const prev = setsPerMuscle(state.sessions, gymSessions, today, now + 1)
    addCredit(prev, remaining)
    const prevGym = setsPerMuscle([], gymSessions, today, now + 1)
    if (!gymDone && todayFocus && slots[0].gymMin > 0) addCredit(prevGym, ctx.lifts(days[0], ctx.gymMinutes(0, todayFocus), todayFocus, todaySpare))
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
        pressed: pressedBy(now + 1),
      },
      ctx,
      { index: 0, focus: todayFocus, credit: remaining, prev, prevGym, light: todayLight, logged: gymDone },
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
  // Optional openers are known only after lifting focuses have been selected.
  // Two adjacent gym days can each individually look free, including Sunday
  // and Monday. Keep the promised skill day and give the other time to its lifts.
  const openersByPriority = days.flatMap((d) => {
    const focus = slots[d.index].kind === 'gym' && focusOf(d.index)
    const skill = focus && opener(d.index, focus)
    if (!skill) return []
    const family = skillFamily(skill)
    if (family === 'balance') return []
    const promised = Boolean(slots[d.index].exposure || slots[d.index].reservedOpener || slots[d.index].hint === family)
    return [{ i: d.index, at: d.at, family, promised }]
  }).sort((a, b) => Number(b.promised) - Number(a.promised) || a.i - b.i)
  const kept: typeof openersByPriority = []
  const restOpeners = [...(opts.restOpeners ?? [])]
  for (const day of openersByPriority) {
    if (kept.some((prior) => prior.family === day.family && apart(prior.at, day.at) < restMs)) restOpeners.push(`${day.i}:${day.family}`)
    else kept.push(day)
  }
  if (restOpeners.length > (opts.restOpeners?.length ?? 0)) return planWeekAhead(state, now, { ...opts, restOpeners })
  // Keep a week that already covers the lower body. Only split off a skill
  // day if the actual gym allocation would otherwise leave the legs out.
  const wantsLegs = g.physique > 0 && (g.physique >= Math.max(g.skills, g.strength, g.power, g.endurance) || prefs.musclesPriority.some((m) => LEG_MUSCLES.includes(m)))
  if (!opts.coverLegWeeks && gymWanted && !legsOff && wantsLegs && (targets.quads[0] > 0 || targets.hamstrings[0] > 0)) {
    const uncovered = [...new Set(days.map((d) => d.week))].filter((wk) => {
      const training = days.filter((d) => d.week === wk && !d.restDay && d.minutes >= MIN_GYM_MINUTES)
      if (training.length + (wk === thisWeek ? before.cal + before.gym : 0) < 2) return false
      // A mixed week with a full lower-body visit already serves the legs.
      // Reallocating that week a second time can cost the first skill its practice.
      if (g.skills > 0 && training.some((d) => d.minutes >= MIN_SKILL_MINUTES[2] + MIN_LIFTS_AFTER_OPENER) &&
          ((legsLast !== undefined && weekStart(legsLast) === wk) || training.some((d) => {
            const focus = slots[d.index].kind === 'gym' ? focusOf(d.index) : null
            if (focus === 'lower') return true
            if (focus !== 'full' && focus !== 'athletic') return false
            const work = liftCredit(d, ctx.gymMinutes(d.index, focus), focus)
            return (work.quads ?? 0) >= 2 && (work.hamstrings ?? 0) >= 1
          }))) return false
      // A session labelled “full body” may only fit a squat and a press.
      // Check the sets across the entire week at every visit length.
      const legSets = setsPerMuscle([], gymSessions, wk, Math.min(today, addDays(wk, 7)))
      for (const d of training) {
        const focus = focusOf(d.index)
        if (focus && slots[d.index].kind === 'gym') addCredit(legSets, liftCredit(d, ctx.gymMinutes(d.index, focus), focus))
      }
      if ((['quads', 'hamstrings'] as const).every((m) => targets[m][0] === 0 || (legSets[m] ?? 0) >= 2)) return false
      return training.some((d) => !d.assigned && legsOpen(d))
    })
    if (uncovered.length) return planWeekAhead(state, now, { ...opts, coverLegWeeks: uncovered })
  }
  const servesOf = (i: number): Muscle[] => (i === 0 ? first.serves[0] : cur.includes(i) ? week.serves[cur.indexOf(i)] : later?.serves[nxt.indexOf(i)] ?? [])
  /** Whether day `i`'s gym block presses lightly (`LIGHT_PRESS_SPARE`): beside push-family work, never a hard pressing session. */
  const lightOf = (i: number): boolean => Boolean(cur.includes(i) ? week.light[cur.indexOf(i)] : later?.light[nxt.indexOf(i)])
  /** What day `i`'s lifts spare for light pressing, beside anything the week's steer adds. */
  const lightSpareOf = (i: number): Muscle[] => (lightOf(i) ? [...LIGHT_PRESS_SPARE] : [])

  // Each gym day's opener, now that its focus is known. The first priority's opener is one of its sessions of the
  // week in full only when it keeps its kept dose; short of it, it counts as half.
  const final: SkillSlot[] = slots.map((slot, i) => {
    const focus = slot.kind === 'gym' ? focusOf(i) : null
    const skill = focus ? opener(i, focus) : undefined
    const at = placeAt(i)
    if (!skill || !at) return slot
    const block = openerBlock(base, skill, days[i].at, at, openerTime(i, skill))
    const session = builtSkill(base, [skill], block.minutes, days[i].at, block.kit, true)
    const part: Part = { skill, role: 'lead', hard: Boolean(block.hard?.length) }
    const mine = skill === skills[0]
    return {
      ...slot,
      opener: skill,
      ...(mine ? { exposure: true } : { exposure: undefined }),
      ...(mine && (session.key[skill] ?? 0) < builtSkill(base, [skill], UNTRIMMED_MINUTES, days[i].at, block.kit).bare ? { half: true } : {}),
      ...(session.painSafe ? { painSafe: true } : {}),
      skillMin: block.minutes,
      gymMin: slot.gymMin - block.minutes,
      skills: [skill],
      parts: [part],
      families: new Set(block.hard),
      presses: pressesHard(session, new Set(block.hard)),
      credit: session.credit,
      workingSets: session.key,
    }
  })
  // A gym day the gym could not fill under its rules (rest rules, the day before, what the place has) is
  // calisthenics when a skill is clear of every session of its family around it, and otherwise has nothing. A
  // first-priority day whose gym could not open with it is its calisthenics day instead: its slot is its own.
  // The families a gym day presses or pulls hard: light pressing rests nothing.
  const gymFamilies = (j: number): Straight[] => {
    const f = final[j].kind === 'gym' ? focusOf(j) : null
    return f ? focusFamilies(f).filter((fam) => !(fam === 'push' && lightOf(j))) : []
  }
  for (let i = 0; i < final.length; i++) {
    const slot = final[i]
    // Not over the athlete's own pick for today: a gym day they asked for stays one.
    const lost = slot.kind === 'gym' && Boolean(slots[i].exposure) && slot.opener !== skills[0] && !(i === 0 && opts.todayKind)
    if (slot.kind !== 'gym' || (focusOf(i) && !lost)) continue
    const d = days[i]
    const view = places.cal(i)
    const near = (fam: Straight) =>
      logged[fam].some((e) => e.at < d.start && insideRest(d.at, e.at, restMs)) ||
      final.some(
        (sl, j) =>
          j !== i &&
          apart(days[j].at, d.at) < restMs &&
          (gymFamilies(j).includes(fam) || holdsFamily(sl, fam) || sl.parts.some((p) => (p.role === 'lead' || p.role === 'partner') && skillFamily(p.skill) === fam)),
      )
    const allowed = (d.assigned ?? (g.skills > 0 ? skills.filter((s) => skillFamily(s) === 'balance' || !near(skillFamily(s) as Straight)) : [])).filter((s) =>
      !sportRestsSkill(d, s) && canTrainAtHome(view, s),
    )
    const exposure = lost && allowed.includes(skills[0])
    if (lost && !exposure) continue
    let parts = d.minutes >= MIN_SKILL_MINUTES[1] ? lineupParts(view, d, allowed, d.minutes, { exposure }) : []
    // Handstand push-ups are pressing: not as a hard push session beside push work inside the rest rule.
    if (parts.length && near('push') && pressesHard(builtSkill(view, parts.map((p) => p.skill), d.minutes, d.at), new Set())) {
      parts = lineupParts(view, d, allowed.filter((s) => !PRESS_SKILLS.has(s)), d.minutes, { exposure })
    }
    const session = parts.length ? builtSkill(view, parts.map((p) => p.skill), d.minutes, d.at) : undefined
    if (session?.painSafe) parts = parts.slice(0, 1).map((p) => ({ ...p, hard: false }))
    const lostFamilies = new Set(parts.filter((p) => p.hard).map((p) => skillFamily(p.skill) as Straight))
    final[i] = parts.length
      ? {
          ...slot,
          kind: 'calisthenics',
          why: exposure ? 'exposure' : 'gym-blocked',
          ...(exposure ? { exposure: true, urgent: firstFamily as Straight } : { exposure: undefined }),
          hint: undefined,
          opener: undefined,
          alternative: undefined,
          skillMin: d.minutes,
          gymMin: 0,
          skills: parts.map((p) => p.skill),
          parts,
          families: lostFamilies,
          presses: pressesHard(session, lostFamilies),
          ...(session?.painSafe ? { painSafe: true } : {}),
          credit: session?.credit ?? {},
          workingSets: session?.key,
        }
      : { ...slot, kind: 'rest', why: 'gym-blocked', alternative: undefined, gymMin: 0 }
  }
  familySlots = final
  // Each gym day's steer, from the week as it will be done: everything logged and planned, skill sessions and
  // openers as the sessions they build, and the lifts as the sessions each focus builds. A muscle that week takes past
  // `FAR_OVER` times its top target is left out of the lifts (its main movements) day by day — the day that adds most
  // first, and only while the focus still builds two movements without it — until it is back under that line or no
  // gym day can give it up; then the muscles the week still leaves furthest under target that a day's focus trains go
  // to the builder as that day's priorities (each wins its slot and gets a set more). Weekly targets are CONSENSUS
  // ranges; both lines are the app's own.
  const steer = new Map<number, { priority: Muscle[]; keepOut: Muscle[] }>()
  for (const [idxs, path] of [
    [cur, week],
    [nxt, later],
  ] as const) {
    if (!path) continue
    const focusAt = (i: number) => (final[i].kind === 'gym' && !(i === 0 && gymDone) ? focusOf(i) : null)
    /** A day's spare muscles: the steer's own, and the pressing muscles on a light pressing day. */
    const sp = (i: number, out: Muscle[] = []) => [...out, ...lightSpareOf(i)]
    const total: Credit = { ...path.P }
    const keepOut = new Map<number, Muscle[]>()
    const steerable = idxs.filter((i) => focusAt(i) && focusAt(i) !== 'athletic')
    const line = (m: Muscle) => STEER_LINE * targets[m][1]
    const parentOf = new Map(MUSCLES.filter((m) => m.sub).map((m) => [m.id, m.sub!]))
    /** The muscles a day's lifts give priority to: those the week leaves furthest under target — never a sub-target whose parent is already past its top, which it would only add to. */
    const priorityOf = (i: number): Muscle[] => {
      const f = focusAt(i)!
      const out = keepOut.get(i) ?? []
      const opener = final[i].opener
      const family = opener && skillFamily(opener)
      const opposite = family === 'push' ? 'lats' : family === 'pull' ? 'chest' : undefined
      const covered = family === 'push' ? 'chest' : 'lats'
      const complement = f === 'upper' && opposite && !shared[family === 'push' ? 'pull' : 'push'] &&
        (total[opposite] ?? 0) < (total[covered] ?? 0) ? opposite : undefined
      const inFocus = (Object.keys(FOCUS_SHARE[f]) as Muscle[])
        .filter((m) => !days[i].off.has(m) && !out.includes(m) && weights[m] > 0 && !prefs.musclesPriority.includes(m) && targets[m][0] > 0)
        .filter((m) => (total[m] ?? 0) < targets[m][0] - 0.5 && !(parentOf.has(m) && (total[parentOf.get(m)!] ?? 0) >= targets[parentOf.get(m)!][1]))
        .sort((a, b) => Number(b === complement) - Number(a === complement) || (total[a] ?? 0) / targets[a][0] - (total[b] ?? 0) / targets[b][0])
        .slice(0, 2)
      // With one short upper session, holds can cover the back but leave the
      // chest or shoulders nearly idle. A longer leg day can take a small
      // accessory after its squat and hinge when the family is recovered.
      if (f !== 'lower' || g.physique < 4 || !g.skills || ctx.gymMinutes(i, f) < 35 || days[i].factor < 1) return inFocus
      const extra = (['chest', 'lats', 'side-delts'] as const).filter((m) => {
        const family = m === 'lats' ? 'pull' : 'push'
        if (weights[m] <= 0 || days[i].off.has(m) || days[i].sportRest[family] || out.includes(m) ||
            prefs.musclesPriority.includes(m) || (total[m] ?? 0) >= Math.min(6, targets[m][0] / 2) || !ctx.clear(family, i)) return false
        return !days.some((other) => other.index !== i && apart(other.at, days[i].at) < restMs && gymFamilies(other.index).includes(family))
      })
      return [...inFocus, ...extra.slice(0, 2)]
    }
    const given = new Map<number, Muscle[]>()
    const lifts = (i: number, out = keepOut.get(i) ?? []) => liftCredit(days[i], ctx.gymMinutes(i, focusAt(i)!), focusAt(i)!, sp(i, out), given.get(i))
    for (const i of steerable) {
      given.set(i, priorityOf(i))
      addCredit(total, liftCredit(days[i], ctx.gymMinutes(i, focusAt(i)!), focusAt(i)!, sp(i, keepOut.get(i) ?? [])), -1)
      addCredit(total, lifts(i))
    }
    // Never one of the athlete's own priorities (round six): with the upper chest and the long head of the triceps
    // asked for, push days spared the triceps and four weeks gave them 4 of 8–13 sets and none.
    const overs = MUSCLES.map((m) => m.id)
      .filter((m) => targets[m][1] > 0 && (total[m] ?? 0) > line(m) && !prefs.musclesPriority.includes(m))
      .sort((a, b) => (total[b] ?? 0) / targets[b][1] - (total[a] ?? 0) / targets[a][1])
    /**
     * Whether a day's lifts, with `after` left out, still hold what the day is named for — a push day presses — and
     * the main movement of every muscle the focus is for (`focusMain`) that the week leaves under target. All of a push day's
     * presses work the front delts and triceps, which planche work already took past the line: from the second week
     * a push day was lateral raises and a cable fly while its own reason said chest was at 0 of 12–20 sets.
     */
    const keepsWhatItIsFor = (i: number, f: GymFocus, before: Muscle[], after: Muscle[]) => {
      const minutes = ctx.gymMinutes(i, f)
      const was = buildAt(days[i], minutes, f, sp(i, before), given.get(i)).items
      const will = buildAt(days[i], minutes, f, sp(i, after), given.get(i)).items
      const holds = (items: typeof was, test: (ex: (typeof GYM_EXERCISE_BY_ID)[string]) => boolean) =>
        items.some((it) => {
          const ex = GYM_EXERCISE_BY_ID[it.exerciseId]
          return Boolean(ex) && test(ex)
        })
      for (const group of NAMED_PATTERNS[f]) {
        const named = (ex: (typeof GYM_EXERCISE_BY_ID)[string]) => group.includes(ex.pattern)
        if (holds(was, named) && !holds(will, named)) return false
      }
      for (const m of focusMain(f)) {
        if (targets[m][0] <= 0 || (total[m] ?? 0) >= targets[m][0]) continue
        const trains = (ex: (typeof GYM_EXERCISE_BY_ID)[string]) => ex.primary.includes(m)
        if (holds(was, trains) && !holds(will, trains)) return false
      }
      return true
    }
    // The pressing pair spared together is the light-pressing rail's mark (`LIGHT_PRESS_SPARE`): the builder then keeps
    // every movement on either out, the athlete's priorities too. On a day that is not light, an athlete whose priorities
    // those movements train keeps one of the pair (round six): the upper chest and the long head of the triceps once
    // got 4 of 8–13 sets and none, week after week, because every push day's steer spared both.
    const pairHolds = prefs.musclesPriority.some((m) => PAIR_HELD.has(m))
    for (const m of overs) {
      const order = steerable
        .map((i) => ({ i, c: lifts(i)[m] ?? 0 }))
        .filter((x) => x.c > 0)
        .sort((a, b) => b.c - a.c)
      for (const { i } of order) {
        if ((total[m] ?? 0) <= line(m)) break
        const f = focusAt(i)!
        const before = keepOut.get(i) ?? []
        if (pairHolds && !lightOf(i) && LIGHT_PRESS_SPARE.includes(m) && LIGHT_PRESS_SPARE.every((x) => x === m || before.includes(x))) continue
        const after = [...before, m]
        if (!viable(days[i], ctx.gymMinutes(i, f), f, sp(i, after))) continue
        if (!keepsWhatItIsFor(i, f, before, after)) continue
        addCredit(total, lifts(i, before), -1)
        addCredit(total, lifts(i, after))
        keepOut.set(i, after)
      }
    }
    for (const i of steerable) {
      const out = keepOut.get(i) ?? []
      const priority = (given.get(i) ?? []).filter((m) => !out.includes(m))
      if (out.length || priority.length) steer.set(i, { priority, keepOut: out })
    }
  }
  // What the athlete can actually start, after fitting, steering and any blocked
  // workout replacements. A partial workout today contributes only its logged sets.
  const weekSources = emptySetSources()
  const remainingLifts: WeekAhead['remainingLifts'] = []
  const weekTotal = setsPerMuscle(state.sessions, gymSessions, thisWeek, now + 1, weekSources)
  for (const i of cur) {
    const slot = final[i]
    if (i !== 0 || !skillDone) {
      addCredit(weekTotal, slot.credit)
      addCredit(weekSources.skill, slot.credit)
    }
    const focus = slot.kind === 'gym' ? focusOf(i) : null
    const location = placeAt(i)
    if (!focus || !location || slot.gymMin < MIN_GYM_MINUTES || (i === 0 && gymDone)) continue
    const steerDay = steer.get(i)
    const plan = buildAt(days[i], slot.gymMin, focus, [...(steerDay?.keepOut ?? []), ...lightSpareOf(i)], steerDay?.priority)
    for (const item of plan.items) addLiftVolume(weekTotal, item.exerciseId, item.sets, weekSources)
    if (plan.items.length) remainingLifts.push({ at: days[i].at, placeId: location.id, minutes: slot.gymMin, estimatedMin: plan.estimatedMin,
      setLimit: plan.setLimit, items: plan.items.map(({ exerciseId, sets }) => ({ exerciseId, sets })) })
  }
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
    .filter((m) => PLANNABLE.has(m) && targets[m][0] > 0 && (weekTotal[m] ?? 0) < targets[m][0] - 0.5)
    .sort((a, b) => weights[a] - weights[b] || targets[b][0] - (weekTotal[b] ?? 0) - (targets[a][0] - (weekTotal[a] ?? 0)))
  // A day's share of its family's weekly sessions: 1, or ½ for a first-priority opener short of its kept dose.
  const weightOf = (sl: SkillSlot, f: Straight) => (sl.families.has(f) ? (sl.half && f === firstFamily ? 0.5 : 1) : 0)
  /** Sessions of each family in a calendar week, done before today and planned from it, as they count toward it. */
  const sessionsIn = (wk: number): Record<Straight, number> => {
    const out = wk === thisWeek ? { ...doneHard } : { push: 0, pull: 0 }
    final.forEach((sl, j) => {
      if (days[j].week !== wk) return
      for (const f of ['push', 'pull'] as const) out[f] += weightOf(sl, f)
    })
    return out
  }
  const anyKit = [...new Set([...state.profile.equipment, ...(place ? kitAt(state, place) : [])])]
  // Only families with a skill whose current step can be a hard session: a target nothing at the step can meet is not
  // shown. The first priority's family is planned every session its rest rule allows on the training days, so its
  // target is what the week holds; another family's is the convention's two.
  const frequency = (['push', 'pull'] as const)
    .filter((f) => skills.some((s) => skillFamily(s) === f && hardAtStep(base, s, anyKit)))
    .map((f) => {
      const planned = cur.reduce((n, i) => n + weightOf(final[i], f), 0)
      return {
        family: f,
        skills: skills.filter((s) => skillFamily(s) === f),
        done: doneHard[f],
        planned,
        target: f === firstFamily ? doneHard[f] + planned : FAMILY_SESSIONS_OTHER,
      }
    })

  // As today began, like every other decision about today: a saved opener once changed which muscles today's lifts
  // said were furthest under target, between the opener and the lifts of the same planned day.
  const weekSets = setsPerMuscle(base.sessions, base.gym?.sessions ?? [], thisWeek, now)
  // Hard pressing and pulling the gym was given, for the days it keeps clear.
  const plannedGym: Record<Straight, number[]> = { push: [], pull: [] }
  for (const d of days) for (const fam of gymFamilies(d.index)) plannedGym[fam].push(d.at)
  const restH = prefs.straightArmRestHours
  /** Why the gym does not press (or pull) hard today, or how a day carries both: one line per family that applies. */
  const familyNotes = (d: DayCtx, slot: SkillSlot, focus: GymFocus | null): { long: string[]; short: string[] } => {
    const long: string[] = []
    const short: string[] = []
    if (!focus || slot.gymMin <= 0) return { long, short }
    const light = lightOf(d.index) && PRESSING.has(focus)
    for (const fam of ['push', 'pull'] as const) {
      if (!shared[fam]) continue
      const names = joinNames(skills.filter((s) => skillFamily(s) === fam).map(skillName))
      const work = fam === 'push' ? 'pressing' : 'pulling'
      const holds = fam === 'push' ? `${cap(names)} and pressing share the front delts, wrists and elbows` : `${cap(names)} and rows or pull-ups share the lats and elbows`
      // Light pressing presses, but is not a hard session of the family: it is said like a day kept light.
      const lightHere = fam === 'push' && light
      if (focusFamilies(focus).includes(fam) && !lightHere) {
        if (slot.families.has(fam)) {
          long.push(`${holds}, so today carries both: the holds first, then the ${work}, and the days around it stay clear of both under your ${restH}h rest rule (a coaching convention).`)
          short.push(`${cap(names)} and ${work} share today: holds first.`)
        }
        continue
      }
      // The week's light push or upper day is there for the weekly pressing rule: said once, on it.
      if (lightHere && focus !== 'full') {
        long.push(`Today carries this week’s gym pressing: every week presses at the gym, lightly beside your ${names} days when no heavier day fits (the app’s own rule).`)
      }
      const near = [
        ...fixedNear(fam, d.index),
        ...plannedGym[fam].filter((x) => startOfDay(x) !== d.start && apart(x, d.at) < restMs).map((x) => ({ at: x, gym: true, logged: false, press: false })),
      ].sort((a, b) => Math.abs(d.at - a.at) - Math.abs(d.at - b.at))[0]
      if (!near) continue
      const hours = Math.round(Math.abs(d.at - near.at) / HOUR)
      // How today's own pressing is kept light, when it presses at all.
      const lead = lightHere
        ? `Pressing stays light today — one press at two sets, under the ${HARD_GYM_FAMILY_SETS} working sets of pressing that make a heavy session (the app’s own line)`
        : `No heavy ${work} in the gym today`
      const tag = lightHere ? 'Light pressing, one press at two sets' : `No heavy ${work}`
      if (!near.logged && near.at > d.at) {
        // A day still to come keeps today light: "front lever on Monday is inside your rest rule" read as a
        // contradiction beside Monday's own "Gym pull, lever first".
        const day = `${dayName(near.at)}’s ${near.gym ? `${work} day` : near.press ? `${HSPU_NAME} day` : `${names} day`}`
        long.push(`${lead}: ${day} needs today kept light under your ${restH}h rest rule. ${holds}, so hard sessions of either are spaced like one, or share a day with the holds first (a coaching convention).`)
        short.push(`${tag}: ${day} needs today light (${restH} h rule).`)
        continue
      }
      const what = near.logged
        ? near.gym
          ? `your heavy ${work} session ${hours}h ago`
          : near.press
            ? `your ${HSPU_NAME} session ${hours}h ago`
            : `your hard ${names} session ${hours}h ago`
        : `${near.gym ? work : near.press ? `${HSPU_NAME}s` : names} on ${dayName(near.at)}`
      long.push(`${lead}: ${what} is inside your ${restH}h rest rule. ${holds}, so hard sessions of either are spaced like one, or share a day with the holds first (a coaching convention).`)
      short.push(`${tag}: ${what} is inside the ${restH} h rule.`)
    }
    return { long, short }
  }
  const goals = { skills: g.skills, gym: gymWeight }
  const out: WeekDayPlan[] = days.slice(0, 7).map((d) => {
    const slot = final[d.index]
    const focus = slot.kind === 'gym' ? focusOf(d.index) : null
    const notes = familyNotes(d, slot, focus)
    const kinds = kindsIn(d.week)
    // The kit a calisthenics day is built with: today the athlete's and the active place's, a later day at home their
    // own — or the gym's, on a day planned there for kit only it has.
    const needsGym = oneSkillPlace && slot.skills.some((s) => !canTrainAtHome(base, s))
    const fixed = fixedPlaces[d.index]
    const calPlace = slot.kind === 'calisthenics' && fixed ? fixed : slot.placeId ? place :
      d.index === 0 && slot.kind === 'calisthenics' ? (needsGym ? oneSkillPlace : skillPlaceToday) : undefined
    const calKit = fixed && slot.kind === 'calisthenics' ? calViews[d.index].profile.equipment :
      calPlace ? hereKit(state, calPlace) : d.index === 0 ? base.profile.equipment : undefined
    const at = placeAt(d.index)
    const steerDay = steer.get(d.index)
    const work = focus ? liftCredit(d, slot.gymMin, focus, [...(steerDay?.keepOut ?? []), ...lightSpareOf(d.index)], steerDay?.priority) : {}
    const located = calPlace && (fixed || calPlace.id !== 'home') && !slot.placeId ? { ...slot, placeId: calPlace.id } : slot
    const plan = assembleDay(state, prefs, d, located, focus, d.index === 0 ? weekSets : null, ctx.lastHit, skills, {
      ...((calPlace ?? at) ? { place: calPlace ?? at } : {}),
      ...(calKit ? { calKit } : {}),
      notes: notes.long,
      work,
      // Today picked as a gym day needs only the place: the athlete asked for it.
      wantsGym: (gymWanted || (d.index === 0 && (slot.why === 'picked' || slot.why === 'followed') && slot.kind === 'gym')) && Boolean(at),
      week: kinds,
      sharedSkillDay: final.some((s, i) => days[i].week === d.week && s.sharedSkillDay),
      goals,
      sessions: sessionsIn(d.week),
      restH: prefs.straightArmRestHours,
      ...(steer.get(d.index) ?? {}),
      ...(focus && lightOf(d.index) ? { lightPress: true } : {}),
    })
    return {
      day: d.key,
      at: d.at,
      kind: plan.kind,
      plan,
      ...(plan.skill && !plan.skill.painSafe && slot.workingSets ? { skillWorkingSets: slot.workingSets } : {}),
      // What a day serves never names a muscle its lifts lean away from (`spare`): the two lines once disagreed.
      why: whyFor(d, slot, plan, servesOf(d.index).filter((m) => !(plan.gym?.spare ?? []).includes(m)), prefs, skills, notes.short, kinds, state.settings.weeklyGoal, sessionsIn(d.week)),
      ...(d.sport.length ? { sport: d.sport[d.sport.length - 1] } : {}),
      ...(d.sport.length > 1 ? { sportCount: d.sport.length } : {}),
    }
  })
  // Today as it happened: a gym session logged on a calisthenics day, or a skill session on a gym day
  // with no opener, is the athlete's own switch — today becomes that kind and the week is planned around it.
  if (!opts.todayKind && !opts.inner && !days[0].assigned) {
    const p0 = out[0].plan
    const skillToday = state.sessions.some((s) => s.startedAt >= today && s.startedAt <= now && countsSkillDay(s))
    const switched = p0.kind === 'calisthenics' && gymDone && !skillToday ? 'gym' : p0.kind === 'gym' && !p0.skill && skillToday && !gymDone ? 'calisthenics' : undefined
    if (switched) return planWeekAhead(state, now, { ...opts, todayKind: switched, todayWhy: 'followed' })
  }

  // Missed days: what each held, and where its work went.
  const missed: MissedDay[] = []
  if (!opts.inner && state.gym?.prefs) {
    const remaining = out.filter((p) => weekStart(p.at) === thisWeek && !p.plan.rest)
    const within = (x: number, from: number, to: number) => x >= from && x < to
    const trainedOn = (t: number) =>
      state.sessions.some((s) => within(s.startedAt, t, addDays(t, 1)) && countsSkillDay(s)) || gymSessions.some((s) => within(s.startedAt, t, addDays(t, 1)))
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
      let past = pastPlans.get(state)
      if (!past) pastPlans.set(state, (past = new Map()))
      let was = past.get(t)
      if (!was) {
        was = planWeekAhead(stateBefore(state, t), fivePm(t), { inner: true }).days[0].plan
        if (past.size >= 14) past.delete(past.keys().next().value!)
        past.set(t, was)
      }
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
      for (const skill of was.skill?.skills ?? []) {
        const nextDay = remaining.find((p) => p.plan.skill?.skills.includes(skill))
        if (nextDay) nextDay.movedFrom ??= dayName(t)
        parts.push(`${skillName(skill)} ${nextDay ? (nextDay.at === now ? 'is on today' : `is next on ${dayName(nextDay.at)}`) : 'waits for next week'}`)
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
  // Legs wanted and under target, and no day left this week where the sport leaves them fresh: said, once, today.
  const legMuscles = (['quads', 'glutes', 'hamstrings'] as Muscle[]).filter((m) => targets[m][0] > 0)
  if (!out[0].plan.rest && gymWanted && !legsOff && legMuscles.some((m) => (weekSets[m] ?? 0) < targets[m][0])) {
    const thisWeekDays = days.filter((d) => d.week === thisWeek)
    const trainsLegs = thisWeekDays.some((d) => {
      const f = final[d.index].kind === 'gym' ? focusOf(d.index) : null
      return f === 'lower' || f === 'full' || f === 'athletic'
    })
    if (!trainsLegs && !thisWeekDays.some((d) => !d.restDay && legsOpen(d))) {
      out[0].plan.reasons.push(
        'No day left this week leaves your legs fresh around your sport, so the gym trains no legs this week — they come back when a day does (the app’s own rule around sport).',
      )
    }
  }
  // Today's reasons end with the rest of the week, so today reads as part of it.
  const rest = out.slice(1).filter((p) => weekStart(p.at) === thisWeek && !p.plan.rest && (p.plan.skill || p.plan.gym))
  if (!out[0].plan.rest && rest.length) {
    out[0].plan.reasons.push(
      `The rest of this week: ${rest.map((p) => `${dayName(p.at)} ${p.plan.kind === 'gym' ? 'gym' : 'calisthenics'} (${describe(p.plan)})`).join(', ')}. Spread so each muscle gets its weekly sets across your training days without the same muscles worked hard two days running — coaching conventions, and the week is planned again from what you log.`,
    )
  }
  return { days: out, missed, shortfall, frequency, weekTotal, weekSources, remainingLifts }
}

/** What `assembleDay` needs beside the day's decisions. */
interface DayExtra {
  work: Credit
  sharedSkillDay: boolean
  place?: GymLocation
  notes: string[]
  wantsGym: boolean
  /** Muscles the lifts give priority to: the week leaves them furthest under target. */
  priority?: Muscle[]
  /** Muscles the lifts lean away from (`spare`): the week's other work already takes them far past target. */
  keepOut?: Muscle[]
  /** The lifts press lightly (`LIGHT_PRESS_SPARE`, added to `spare`): push-family work sits inside the rest rule. */
  lightPress?: boolean
  /** Training days of the day's calendar week by kind, logged and planned. */
  week: { cal: number; gym: number }
  /** The goal weights the split follows: skills, and the strongest gym goal. */
  goals: { skills: number; gym: number }
  /** Hard sessions of each family in the day's calendar week, done and planned, as they count (an opener short of its dose is half). */
  sessions: Record<Straight, number>
  restH: number
  /** The kit a calisthenics day is built with, when it is not the athlete's own list (`WorkoutRequest.kit`). */
  calKit?: EquipmentId[]
}

const familyNames = (skills: SkillId[], f: Straight) => joinNames(skills.filter((s) => skillFamily(s) === f).map(skillName))
const familyTarget = (skills: SkillId[], f: Straight) => (f === skillFamily(skills[0]) ? FAMILY_SESSIONS_LEAD : FAMILY_SESSIONS_OTHER)
/** "3", "2½": sessions as they count toward a week. */
const countWord = (n: number) => (Number.isInteger(n) ? String(n) : `${Math.floor(n)}½`)
const sessionCount = (n: number) => `${countWord(n)} ${n === 1 ? 'session' : 'sessions'}`

/**
 * What a family's weekly sessions are said to be, true to the week that is
 * planned: the first priority gets every session its rest rule allows, and
 * another family's convention of two is said as a target only when the week
 * reaches it. "Planche needs 3 hard sessions this week" once stood beside a
 * week that planned two.
 */
function familyWeek(skills: SkillId[], f: Straight, extra: DayExtra): string {
  const names = familyNames(skills, f)
  const n = extra.sessions[f]
  const sessions = sessionCount(n)
  if (f === skillFamily(skills[0])) {
    if (extra.sharedSkillDay) return `the ${names} is your first skill and has ${sessions} this week, alongside a lower-body day for your muscle goal`
    return `the ${names} is your first priority, so it gets every session your ${extra.restH}h rest rule allows on your training days — ${sessions} this week (the app’s own rule; skill frequency is a coaching convention)`
  }
  const target = familyTarget(skills, f)
  return n >= target
    ? `${names} needs it to get ${target} hard sessions in this week (a coaching convention for skill frequency)`
    : `${names} gets ${sessions} this week — all the days left allow, short of the ${target} a coaching convention suggests`
}

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
      return `No gym session fits today${at}${d.liftJoints.length ? ` with your ${d.liftJoints.join(' and ')} kept out` : ''}: ${d.minutes < MIN_LIFTS_AFTER_OPENER ? 'no suitable lift fits the time' : 'fewer than two suitable movements fit'}, so today is calisthenics.`
    case 'gym-blocked':
      return `No gym session fits today’s rules${at}. The planner checked your equipment, recent training and joint limits. ${slot.kind === 'calisthenics' ? 'Your skill session fits today.' : 'Today is a recovery day.'}`
    case 'family':
      // Only while today's session is a hard session of the family, so the week's count holds today (round seven): a
      // 20-minute handstand Monday once said "front lever gets 1 session this week", and another day "0 sessions".
      return slot.urgent && slot.families.has(slot.urgent) && extra.sessions[slot.urgent] >= 1 ? `Calisthenics today: ${familyWeek(skills, slot.urgent, extra)}.` : share()
    case 'family-opener':
      return slot.hint && slot.opener
        ? `A gym day that opens with the ${skillName(slot.opener)}: ${familyWeek(skills, slot.hint, extra)}, and the opener is one of them.`
        : share()
    case 'exposure':
      // The pain-safe session trains none of the line-up: its own line says why, and "0 sessions this week, and today is
      // one of them" said the opposite (round seven).
      if (slot.painSafe || !slot.families.has(skillFamily(skills[0]) as Straight)) return undefined
      return `Calisthenics today: ${familyWeek(skills, skillFamily(skills[0]) as Straight, extra)}, and today is one of them.`
    case 'exposure-opener':
      return slot.opener
        ? `A gym day that opens with the ${skillName(slot.opener)}: ${familyWeek(skills, skillFamily(slot.opener) as Straight, extra)}. ${
            slot.half
              ? `Today's ${slot.skillMin}-minute opener has fewer holds than its own session, so it counts as half of one — and the week gives it its own day first wherever one is free.`
              : `Today's ${slot.skillMin}-minute opener is one of them, with every working hold of its session.`
          }`
        : share()
    case 'pair':
      return slot.hint && slot.opener
        ? `The ${skillName(slot.opener)} comes first. Today’s lifts include ${slot.hint === 'push' ? 'pressing' : 'pulling'}, so the next hard session for those muscles can follow your recovery interval.`
        : share()
    case 'sport': {
      const s = d.sameDay ?? d.legsCovered ?? d.upcoming
      if (!s) return undefined
      const what = s.scheduled ? cap(namedSport(s)) : s.kind === 'pe' ? 'PE' : s.kind === 'other' ? 'Your activity' : cap(s.kind)
      const when = d.sameDay ? 'is today' : d.legsCovered ? `on ${dayName(s.at)} already loaded your legs` : 'is coming up'
      return `${what} ${when}, so the gym would leave the legs out today: today is calisthenics, and the gym waits for fresher legs.`
    }
    case 'legs':
      return 'A gym day for your legs fits here. This is the last available session this week for lower-body work toward your target.'
    case 'leg-coverage':
      return slot.opener
        ? `This session pairs ${skillName(slot.opener)} practice with lower-body strength. Start with the skill while you are fresh.`
        : 'Your muscle goal reserves this session for lower-body strength.'
    case 'skill-practice':
      return slot.opener ? `Start with the ${skillName(slot.opener)}, your first priority. The lifts fit in the time left after this practice.`
        : 'Today gives your skill a practice session alongside this week’s gym work.'
    case 'reserved-lifts':
      return 'You set this day aside for lifting.'
    case 'lifting-place':
      return 'Lifting here gives your priority muscles more work this week while keeping your skill practice and total lifting visits.'
    case 'rotate-skills':
      return 'There is time for one skill today. Your first skill had recent practice, so this session goes to the one that has waited longest.'
    case 'sets':
      return slot.setsNeed
        ? `Today adds working sets toward your muscle goals. ${slot.setsNeed.left === 0 ? 'This is the last open training day this week.' : `You have ${slot.setsNeed.left} more open training ${slot.setsNeed.left === 1 ? 'day' : 'days'} after today.`}`
        : share()
    case 'share':
      return share()
    default:
      return undefined
  }
}

/**
 * The day's line about a joint report in the last 72 hours, naming only what changes and who changes it (round
 * seven). The lifts read every report of those 72 hours (`avoidJoints`); the skill side reads the standing report
 * alone (`DayCtx.standing`): standing pain makes the skill session the pain-safe one, a standing niggle orders the
 * line-up round it (`standingNiggle`), and a later all-good check-in ends both. Pain on Monday and "all good" on
 * Tuesday once read "today leaves out anything that loads it" over a planche, handstand and front-lever session,
 * and a Monday wrist niggle "today steers round it" over a planche day with handstand push-ups beside it.
 */
function reportLine(d: DayCtx, slot: SkillSlot, recent: Answer): string {
  const care = 'Never train through pain — if it keeps coming back, tell a parent, coach or physio.'
  const where = d.avoidJoints.join(' and ')
  const on = ` on ${dayName(recent.at)}`
  const lifts = slot.kind === 'gym'
  const skillWork = slot.kind === 'calisthenics' || Boolean(slot.opener)
  const standing = d.standing
  // Pain the skill side still holds: the skill session is the pain-safe one, and the lifts leave the joint out.
  if (d.pain || recent.joints === 'pain') {
    const when = d.pain ? '' : on
    if (!where) return `You reported pain${when}: ${d.pain ? 'today stays light. ' : ''}The plan cannot tell which movements load that spot, so stop anything that hurts it. ${care}`
    if (standing?.joints === 'pain' || !skillWork) {
      const who = skillWork ? 'today leaves' : 'the lifts leave'
      return `You reported pain in ${where}${when}: ${who} out anything that loads it${d.pain ? (skillWork ? ' and stays light' : ' and stay light') : ''}. ${care}`
    }
    const skills = standing ? `your latest report since is a niggle, which the skills are planned round` : 'your check-in since said all good, so the skills train'
    return `You reported pain in ${where}${when}: ${lifts ? `the lifts leave out anything that loads it${d.pain ? ' and stay light' : ''}, and ` : ''}${skills} — stop anything that hurts. ${care}`
  }
  if (!where) return 'You mentioned a niggle: the plan cannot tell which movements load that spot, so stop anything that makes it worse.'
  const liftWords = lifts ? `the lifts leave the ${where} out` : ''
  if (!skillWork) return `You mentioned a niggle in ${where}${on}: ${liftWords}.`
  if (!standing) return `You mentioned a niggle in ${where}${on}; your check-in since said all good, so the skills train as usual${lifts ? `, and ${liftWords}` : ''}.`
  const regions = (standing.regions ?? []).filter((r) => r !== 'other' && r !== 'elbow')
  const loads = (s: SkillId) => regions.some((r) => SKILLS[s].loads.includes(r))
  const loading = slot.skills.filter(loads)
  const spared = slot.skills.filter((s) => !loads(s))
  const skillWords = !regions.length
    ? 'the skills do not change for it — stop anything that makes it worse'
    : !loading.length
      ? `today's ${slot.skills.length === 1 ? 'skill leaves' : 'skills leave'} it alone`
      : spared.length
        ? `the ${joinNames(spared.map(skillName))} ${slot.skills[0] === spared[0] ? 'leads' : 'trains'} today and ${spared.length === 1 ? 'leaves' : 'leave'} it alone; the ${joinNames(loading.map(skillName))} still ${loading.length === 1 ? 'loads' : 'load'} it, so stop anything that makes it worse`
        : `every skill today loads it, so stop anything that makes it worse — the check-in before the session asks how it is now`
  return `You mentioned a niggle in ${where}${on}: ${skillWords}${lifts ? `, and ${liftWords}` : ''}.`
}

/**
 * Movements of a built gym session that train its focus's own muscles as a prime mover. A focus counts on a day only with two of them (round seven): at
 * home with no bar, three Saturdays were hour-long "pull" days of dead bugs, V-ups, hollow holds and planks — nine
 * sets of core — under "Back and biceps were last trained 9 days ago — today's gym session goes there."
 */
export function ownMovements(items: readonly { exerciseId: string }[], focus: GymFocus): number {
  // The planner's own muscles for the focus (`FOCUS_MUSCLES`): no core on any, side delts on a push day — a push day
  // steered off the triceps (`spare`) is still chest and shoulders.
  const own = FOCUS_MUSCLES[focus]
  return items.filter((it) => GYM_EXERCISE_BY_ID[it.exerciseId]?.primary.some((m) => own.includes(m))).length
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
    const goal = state.settings.weeklyGoal
    const sessions = `${goal} ${goal === 1 ? 'session' : 'sessions'}`
    const text =
      d.restWhy === 'plan'
        ? `A rest day in your week plan. ${pick}`
        : d.restWhy === 'goal'
          ? `Your weekly goal of ${sessions} is done, so today is a rest day unless you want more. ${pick}`
          : d.restWhy === 'spread'
            ? `A rest day between sessions: your weekly goal is ${sessions}, spread across the week (the app’s own spacing). ${pick}`
            : `A rest day in your schedule. ${pick}`
    return { minutes: 0, rest: true, kind: 'rest', reasons: [text] }
  }
  const reasons: string[] = []
  for (const family of ['push', 'pull'] as const) if (d.sportRest[family]) reasons.push(upperSportReason(family, d.sportRest[family]!))
  const recent = d.reports[d.reports.length - 1]
  if (recent) reasons.push(reportLine(d, slot, recent))
  // Older than three days, and still the latest report: the skill side treats it as current, and so do the lifts.
  if (d.held && slot.kind === 'gym') {
    const joints = jointsOf([d.held]).map((j) => j.replace('-', ' '))
    reasons.push(
      `Your last joint report (${d.held.joints === 'pain' ? 'pain' : 'a niggle'}${joints.length ? ` in the ${joinNames(joints)}` : ''}, ${dayName(d.held.at)}) has not been updated since, so the lifts keep ${joints.length ? `the ${joinNames(joints)}` : 'clear of it'}${joints.length ? ' out' : ''} until a check-in says how it is now.`,
    )
  }
  // Straight-arm rest rule: hard sessions of one family (holds, heavy pressing or pulling) at least N hours apart.
  const restH = prefs.straightArmRestHours
  for (const family of ['push', 'pull'] as const) {
    const b = slot.blocked[family]
    const names = skills.filter((s) => skillFamily(s) === family).map(skillName)
    if (!b || b.sport || !names.length) continue
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
        ? b.press
          ? `Handstand push-ups are planned for ${dayName(b.at)} — pressing that shares recovery with ${joinNames(names)} — inside your ${restH}h rest rule from today, so ${they} today.`
          : `${cap(joinNames(names))} ${names.length > 1 ? 'are' : 'is'} in your week plan for ${dayName(b.at)}, inside your ${restH}h rest rule from today, so ${they} today.`
        : b.gym || b.press
          ? `Your ${b.gym ? `heavy ${family === 'push' ? 'pressing' : 'pulling'}` : HSPU_NAME} session ${hours}h ago shares recovery with ${joinNames(names)} — under your ${restH}h rest rule for straight-arm work, so ${they} today.`
          : `Your last hard ${joinNames(names)} session was ${hours}h ago — under your ${restH}h rest rule for straight-arm work, so ${they} today.`,
    )
  }
  const why = kindReason(slot, d, skills, extra)
  if (why) reasons.push(why)
  // Where: a calisthenics day planned at the gym says why it is there.
  if (slot.kind === 'calisthenics' && slot.placeId && extra.place) {
    const away = slot.skills.filter((s) => missingSkillKit(state, s).length > 0)
    if (away.length) {
      const needs = kitNeedsPhrase(away.flatMap((s) => missingSkillKit(state, s)))
      reasons.push(`At ${extra.place.name}: the ${joinNames(away.map(skillName))} ${away.length > 1 ? 'need' : 'needs'} ${needs}, which your own kit does not have, so today's session is planned there.`)
    }
  }
  const skillBlock: SkillBlock | undefined =
    slot.skillMin > 0
      ? {
          minutes: slot.skillMin,
          skills: slot.skills,
          hard: [...slot.families],
          ...(slot.opener ? { opener: true as const } : {}),
          ...(slot.opener && slot.reservedOpener ? { practiceFirst: true as const } : {}),
          // An opener is built from the gym's kit alone (it is done there); today's calisthenics from the athlete's and
          // the active place's; a later day's from the athlete's own, or the gym's when it is planned there.
          ...(slot.opener && extra.place ? { kit: kitAt(state, extra.place), placeId: extra.place.id } : extra.calKit ? { kit: extra.calKit } : {}),
          ...(!slot.opener && slot.placeId ? { placeId: slot.placeId } : {}),
          ...(slot.painSafe ? { painSafe: true as const } : {}),
          ...(slot.half ? { half: true as const } : {}),
          ...(slot.presses ? { presses: true as const } : {}),
          // An opener is one skill's session, which it leads.
          ...(!slot.opener ? { roles: slot.parts.map((p) => p.role) } : {}),
        }
      : undefined
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
  if (slot.painSafe && skillBlock) {
    reasons.push(
      `Today's skill session is the pain-safe recovery one — gentle movement, no loaded ${skillBlock.skills.map(skillName).join(' or ')} holds — while your pain report is recent. The skills come back when it clears.`,
    )
  }
  if (slot.opener && focus) {
    reasons.push(`Start with ${slot.skillMin} minutes for ${skillName(slot.opener)}, then do the ${FOCUS_LABEL[focus].toLowerCase()} lifts. The opener counts in your skill history.`)
  }
  if (skillBlock && conservative(state.profile, d.at) && slot.skills.some((s) => skillFamily(s) !== 'balance')) {
    reasons.push('Warm wrists, elbows and shoulders up fully before the holds — the session starts with it, so do not skip it.')
  }
  if (slot.noKit && slot.kind !== 'calisthenics' && !d.assigned) {
    reasons.push('None of your skills can train with the kit you listed, so no calisthenics day is planned. Add the kit under Settings → Equipment.')
  } else if (slot.noSkillFits && slot.kind === 'rest' && !slot.tooShort) reasons.push('No skill work fits today’s rest rules, so the skills rest today.')
  const alternative = slot.alternative === slot.kind
    ? slot.kind === 'gym' ? 'calisthenics' : 'gym'
    : slot.alternative
  const base = { minutes: slot.kind === 'rest' ? 0 : d.minutes, rest: slot.kind === 'rest', kind: slot.kind, ...(alternative ? { alternative } : {}), ...(skillBlock ? { skill: skillBlock } : {}) }
  // Readiness scales the gym block; a calisthenics day is the skill coach's call, from its own check-in.
  if (slot.kind !== 'gym' || slot.gymMin <= 0 || !wantsGym || !focus) return { ...base, reasons }
  // Speed and power work is done fresh for quality: a push day never adds to it.
  const factor = focus === 'athletic' ? Math.min(1, d.factor) : d.factor
  const readiness =
    d.readiness && focus === 'athletic' && d.readiness.level === 'push'
      ? { ...d.readiness, reason: d.readiness.reason.replace('one more set on each lift, same weights', 'speed and power work keeps its usual dose — it is done fresh, for quality, not volume') }
      : d.readiness

  const muscles = FOCUS_MUSCLES[focus].filter((m) => !prefs.musclesOff.includes(m) && (extra.work[m] ?? 0) >= 1)
  // Say so when the part of the body left longest is what the day is for.
  const daysSince = (m: Muscle) => Math.min(STALE_CAP_DAYS, lastHit[m] === undefined ? STALE_CAP_DAYS : (d.at - lastHit[m]!) / DAY)
  const staleness = (ms: Muscle[]) => (ms.length ? ms.reduce((sum, m) => sum + daysSince(m), 0) / ms.length : 0)
  const groupStale = (['lower', 'push', 'pull'] as GymFocus[])
    .filter((f) => focusOpen(f, prefs.musclesOff))
    .map((f) => ({ f, days: staleness(FOCUS_MUSCLES[f].filter((m) => !prefs.musclesOff.includes(m))) }))
    .filter((x) => x.days >= 5)
    .sort((a, b) => b.days - a.days)[0]
  if (
    groupStale && FOCUS_MUSCLES[groupStale.f].some((m) => (extra.work[m] ?? 0) >= 1) &&
    (focus === groupStale.f ||
      ((focus === 'full' || focus === 'athletic') && groupStale.f === 'lower') ||
      (focus === 'upper' && groupStale.f !== 'lower'))
  ) {
    const worked = FOCUS_MUSCLES[groupStale.f].filter((m) => (extra.work[m] ?? 0) >= 1)
    const name = groupStale.f === 'lower' ? 'Legs' : cap(joinNames(worked.map((m) => MUSCLE_BY_ID[m].label.toLowerCase())))
    const n = Math.round(groupStale.days)
    if (worked.some((m) => lastHit[m] !== undefined)) {
      reasons.push(`${name} had the longest break in your log, about ${n} days. Your lifts today include this work again.`)
    } else {
      reasons.push(`${name} have no logged sets yet. Today’s workout gives you a starting point.`)
    }
  }
  if (focus === 'athletic') {
    reasons.push('Speed and power today: your legs are fresh — nothing hard yesterday or tomorrow — and explosiveness is one of your goals. Jumps and sprints come first, before anything tiring.')
  }
  const covered = d.legsCovered
  if (covered) {
    const what = covered.scheduled ? cap(namedSport(covered)) : covered.kind === 'pe' ? 'PE' : cap(covered.kind)
    reasons.push(
      `${what} on ${dayName(covered.at)} already loaded your legs — no leg work in the gym today.${covered.scheduled ? ' (Counted from your sport week; log it if it went differently.)' : ''}`,
    )
  }
  const onDay = d.sameDay
  if (onDay) {
    const what = onDay.scheduled ? cap(namedSport(onDay)) : onDay.kind === 'pe' ? 'PE' : onDay.kind === 'other' ? 'Your activity' : `Your ${onDay.kind}`
    reasons.push(`${what} is today: no leg work in the gym, and the gym is a little lighter — the same as the day before it.`)
  }
  reasons.push(...extra.notes)
  if (weekSets) {
    // Not a muscle the week as planned already takes far past its target: the line beside it says the lifts lean away.
    const short = muscles
      .filter((m) => !(extra.keepOut ?? []).includes(m))
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
  if (extra.keepOut?.length) {
    const names = extra.keepOut.map((m) => MUSCLE_BY_ID[m].label.toLowerCase())
    reasons.push(
      `The week already has plenty of work for ${joinNames(names)}. Today uses fewer lifts that train ${names.length > 1 ? 'them' : 'that area'}.`,
    )
  }
  if (d.deload.due && d.deload.why) reasons.push(d.deload.why)
  if (d.away !== undefined) {
    reasons.push(`Back after ${d.away} days without the gym: this first session back has fewer sets. Easing back in is a coaching convention, not a proven rule.`)
  }
  const upcoming = d.upcoming
  if (upcoming) {
    const what = upcoming.scheduled ? cap(namedSport(upcoming)) : upcoming.kind === 'pe' ? 'PE' : upcoming.kind === 'other' ? 'Your activity' : `Your ${upcoming.kind}`
    reasons.push(`${what} is tomorrow: legs stay fresh — no leg work today, and the gym is a little lighter.`)
  }
  if (prefs.season === 'in') reasons.push('In season: the sport comes first, so the gym keeps the weights but drops some sets.')
  // The builder's `spare` carries both: the muscles the week has far past target, and a light day's pressing muscles.
  const spare = [...new Set([...(extra.keepOut ?? []), ...(extra.lightPress ? LIGHT_PRESS_SPARE : [])])]
  return {
    ...base,
    ...(readiness ? { readiness } : {}),
    gym: {
      minutes: slot.gymMin,
      focus,
      avoidJoints: d.liftJoints,
      volumeFactor: factor,
      deload: d.deload.due,
      musclesOff: [...d.off],
      ...(spare.length ? { spare } : {}),
      ...(extra.lightPress ? { lightPress: true as const } : {}),
      ...(extra.priority?.length ? { priority: extra.priority } : {}),
      ...(extra.place ? { placeId: extra.place.id } : {}),
    },
    reasons,
  }
}

/** The week view's first line for a day: why it is the kind it is. */
function kindShort(slot: SkillSlot, skills: SkillId[], week: { cal: number; gym: number }, sessions: Record<Straight, number>): string | undefined {
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
      return slot.kind === 'calisthenics' ? 'No gym session fits today: calisthenics.' : 'No suitable lifting session fits today.'
    case 'family':
      return slot.urgent
        ? sessions[slot.urgent] >= familyTarget(skills, slot.urgent)
          ? `Calisthenics: ${familyNames(skills, slot.urgent)} needs it for this week’s ${familyTarget(skills, slot.urgent)} sessions.`
          : `Calisthenics: ${familyNames(skills, slot.urgent)} — ${countWord(sessions[slot.urgent])} of ${familyTarget(skills, slot.urgent)} sessions fit this week.`
        : undefined
    case 'family-opener':
      return slot.opener ? `Gym, the ${skillName(slot.opener)} first: it counts toward this week’s sessions.` : share
    case 'exposure':
      return `Your first-priority skill has ${sessionCount(sessions[skillFamily(skills[0]) as Straight])} this week.`
    case 'exposure-opener':
      return slot.opener
        ? `Gym, the ${skillName(slot.opener)} first: one of its ${countWord(sessions[skillFamily(skills[0]) as Straight])} sessions this week${slot.half ? ', counted as half' : ''}.`
        : share
    case 'pair':
      return slot.opener ? `Gym, the ${skillName(slot.opener)} first: holds and ${slot.hint === 'pull' ? 'pulling' : 'pressing'} share one day.` : share
    case 'sport':
      return 'Calisthenics: sport keeps legs out of the gym today.'
    case 'reserved-lifts':
      return 'Gym on your chosen lifting day.'
    case 'lifting-place':
      return 'The equipment here adds work for your priority muscles.'
    case 'sets':
      return 'Gym: the muscles need it for this week’s sets.'
    case 'legs':
      return 'The last available lower-body session this week.'
    case 'leg-coverage':
      return 'Lower-body strength for your muscle goal.'
    case 'skill-practice':
      return 'Skill practice alongside your gym sessions.'
    case 'rotate-skills':
      return 'A turn for a skill that has waited between sessions.'
    case 'share':
      return share
    default:
      return undefined
  }
}

/** The short lines the week view shows under a day. */
function whyFor(
  d: DayCtx,
  slot: SkillSlot,
  plan: TodayPlan,
  serves: Muscle[],
  prefs: TrainingPrefs,
  skills: SkillId[],
  notes: string[],
  week: { cal: number; gym: number },
  goal: number,
  sessions: Record<Straight, number>,
): string[] {
  const why: string[] = []
  const sport = d.sport[d.sport.length - 1]
  if (plan.rest) {
    why.push(
      sport
        ? `No gym or skills: your ${sportName(sport.kind)} day.`
        : d.restWhy === 'plan'
          ? 'Rest day in your week plan.'
          : d.restWhy === 'goal'
            ? 'Rest day: your weekly goal is done.'
            : d.restWhy === 'spread'
              ? `Rest day: your ${goal} sessions are spread across the week.`
              : 'Rest day in your schedule.',
    )
    return why
  }
  const line = kindShort(slot, skills, week, sessions)
  if (line) why.push(line)
  // A joint report reshapes the days it covers: say so on each of them, not only today.
  const report = d.reports[d.reports.length - 1]
  if (report) {
    const where = joinNames(d.avoidJoints.map((j) => j.replace('-', ' ')))
    const on = startOfDay(report.at) === d.start ? 'today' : `on ${dayName(report.at)}`
    why.push(d.pain ? `Kept light: pain reported ${on}${where ? `, ${where} kept out` : ''}.` : `Steers round the ${where || 'niggle'} you reported ${on}.`)
  }
  if (d.held && plan.gym) {
    const joints = jointsOf([d.held]).map((j) => j.replace('-', ' '))
    why.push(joints.length ? `Lifts keep the ${joinNames(joints)} out: your last report, not updated since.` : 'Lifts steer round your last report, not updated since.')
  }
  if (slot.painSafe) why.push('Pain-safe recovery: gentle movement, no loaded holds.')
  // What each skill actually gets, by the line-up's rules: only a full part that reaches the hard count is called hard.
  for (const part of slot.painSafe ? [] : slot.parts) {
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
    if (b?.sport) { why.push(upperSportReason(f, b.sport)); continue }
    if (!b || d.assigned || !skills.some((s) => skillFamily(s) === f)) continue
    const who = f === 'push' ? 'Push' : 'Pull'
    why.push(
      b.planned
        ? b.press
          ? `${who} skills rest: handstand push-ups ${dayName(b.at)}, inside the ${prefs.straightArmRestHours} h rule.`
          : `${who} skills rest: your plan has them ${dayName(b.at)}, inside the ${prefs.straightArmRestHours} h rule.`
        : b.gym
          ? `${who} skills rest: heavy ${f === 'push' ? 'pressing' : 'pulling'} under ${prefs.straightArmRestHours} h ago.`
          : b.press
            ? `${who} skills rest: handstand push-ups under ${prefs.straightArmRestHours} h ago.`
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
  // The sport's own day is named: "the day before" once showed two days after a Saturday game.
  if (d.sameDay) why.push(`Legs out of the gym: ${namedSport(d.sameDay)} today.`)
  else if (d.legsCovered) why.push(`Legs out of the gym: ${namedSport(d.legsCovered)} on ${dayName(d.legsCovered.at)}.`)
  else if (d.upcoming) why.push(`Legs stay fresh for the ${sportName(d.upcoming.kind)} tomorrow.`)
  if (plan.readiness?.level === 'light') why.push('A light day.')
  else if (plan.readiness?.level === 'push') why.push(plan.gym && plan.gym.volumeFactor > 1 ? 'A push day: one more set on each lift.' : 'A push day — speed work keeps its usual dose.')
  return why
}

/**
 * Today's plan: how the minutes split between skill work and the gym, which
 * skills and which gym focus, and why — today's slot of the week plan, planned
 * again from what actually happened. Pure: state and time in, plan out.
 */
export function planToday(state: AppState, opts: { now?: number; minutes?: number; kind?: 'calisthenics' | 'gym'; location?: GymLocation } = {}): TodayPlan {
  return planWeekAhead(state, opts.now ?? Date.now(), { todayMinutes: opts.minutes, todayPlace: opts.location, ...(opts.kind ? { todayKind: opts.kind } : {}) }).days[0].plan
}

/**
 * The next seven days, from the week plan: each day's skills, gym focus and
 * why. Every real day is planned again from what actually happened.
 */
export function planWeek(state: AppState, now = Date.now()): WeekDayPlan[] {
  return planWeekAhead(state, now).days
}
