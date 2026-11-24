import type { AppState, EquipmentId, SkillId, StepId, Workout, WorkoutRequest } from '../../types'
import type { Joint, Muscle } from '../../data/gym/catalog'
import type { GymFocus } from '../gym/builder'
import type { GymLocation } from '../gym/types'
import { STEP_BY_ID, stepAfter } from '../../data/progressions'
import { qualifyingProgress } from '../progression'
import { addDays, weekStart } from '../time'
import { goalDaysInWeekOf } from '../stats'
import { missingKit } from '../../data/skills'
import { readDayMarks, type DayMarks } from './nextBlock'
import { atActivePlace, gymPlaceOf, insideRestRule, kitAt, MIN_SKILL_MINUTES, placeKit, planToday, skillFamily, type SkillBlock, type TodayPlan } from './planner'

/**
 * Decisions the Home and Train screens make about today and this week, kept
 * pure so they can be pinned: the screens once disagreed — Home counted skill
 * sessions only and offered "Start today's session" on a rest day while Train
 * had a gym week and said rest.
 */

/** This calendar week's training, skill and gym alike: a day with a gym session is a gym day, as the planner counts it. */
export interface TrainingWeek {
  /** Days trained this week, up to now. */
  days: number
  cal: number
  gym: number
  /** Each trained day's kind, by local day key. */
  kinds: Map<string, 'calisthenics' | 'gym'>
  gymSessions: number
  /** Working gym sets this week (warm-ups and empty sets left out). */
  gymSets: number
}

export function trainingWeek(state: AppState, now = Date.now()): TrainingWeek {
  const from = weekStart(now)
  const to = Math.min(addDays(from, 7), now + 1)
  const inWeek = (t: number) => t >= from && t < to
  // The days the weekly goal is judged by, counted the one way the streak and
  // the badges count them (`goalDaysInWeekOf`).
  const kinds = goalDaysInWeekOf(state, now, now)
  const gym = (state.gym?.sessions ?? []).filter((s) => inWeek(s.startedAt))
  const values = [...kinds.values()]
  return {
    days: kinds.size,
    cal: values.filter((k) => k === 'calisthenics').length,
    gym: values.filter((k) => k === 'gym').length,
    kinds,
    gymSessions: gym.length,
    gymSets: gym.reduce((n, s) => n + s.exercises.reduce((m, e) => m + e.sets.filter((x) => !x.warmup && x.reps > 0).length, 0), 0),
  }
}

/** What Home leads with today: the coach's one main session, or rest with a way to train anyway. */
export function homeToday(plan: TodayPlan): 'rest' | 'gym' | 'calisthenics' {
  if (plan.rest || plan.kind === 'rest') return 'rest'
  return plan.kind === 'gym' && plan.gym ? 'gym' : plan.skill ? 'calisthenics' : 'rest'
}

/**
 * Whether Train offers the max test card: not to a brand-new athlete (the
 * first session comes first), and not on a day the test is blocked — the card
 * once sat there saying "Not today".
 */
export function maxTestOffered(state: AppState, blockedReason: string | null | undefined, now = Date.now()): boolean {
  return state.sessions.length > 0 && !blockedReason && !trainedToday(state, now)
}

/** Whether a session (skill or gym, a minimum dose aside) was logged today, by the athlete's calendar day. */
export function trainedToday(state: AppState, now = Date.now()): { skill: boolean; gym: boolean } | false {
  const from = startOfDay(now)
  const skill = state.sessions.some((s) => s.startedAt >= from && s.startedAt <= now && s.workoutKind !== 'micro')
  const gym = (state.gym?.sessions ?? []).some((s) => s.startedAt >= from && s.startedAt <= now)
  return skill || gym ? { skill, gym } : false
}

/** Where today's one main session stands: not begun, half done (an opener saved, the lifts owed), or done. */
export type DayStage = 'open' | 'lifts-next' | 'done'

/**
 * Today's stage, from what was logged and what the day was. A gym day with an
 * opener is finished when its lifts are saved or the athlete ends the day —
 * never by the opener alone: once the opener is logged the planner sees a
 * trained skill day and its `kind` flips, so the day is read from the marks
 * (`DayMarks.openerDay`, set when an opener starts) as well as the plan.
 * Another day is done with any session. An ended day is done whatever was
 * logged. "Today: done" once sat over a gym player that had just opened.
 */
export function dayStage(state: AppState, plan: Pick<TodayPlan, 'kind'> & { skill?: { opener?: boolean } }, now = Date.now(), marks: DayMarks = readDayMarks(now)): DayStage {
  if (marks.ended) return 'done'
  const done = trainedToday(state, now)
  if (marks.openerSessionId) {
    const opener = state.sessions.find((s) => s.id === marks.openerSessionId)
    if (opener) {
      const lifted = state.gym?.sessions.some((s) => s.startedAt >= opener.startedAt && s.startedAt <= now)
      // Once yesterday's lifts were saved, today's plan starts normally.
      if (!lifted) return 'lifts-next'
      if (done && done.gym) return 'done'
    }
  }
  if (!done) return 'open'
  if (done.gym) return 'done'
  const owesLifts = (!marks.openerSessionId && marks.openerDay) || (plan.kind === 'gym' && Boolean(plan.skill?.opener))
  if (owesLifts && done.skill) return 'lifts-next'
  return plan.kind === 'gym' ? 'open' : 'done'
}

/**
 * Whether today's one main session is done: the lifts on a gym day (its
 * opener alone is half of it), and any session on another day. Once it is,
 * nothing more is recommended — "Today: done" once sat over "Calisthenics ·
 * 60 min — Again", with reasons why the planche needed it, and the Gym side
 * offered a 55-minute leg session.
 */
export function dayFinished(state: AppState, plan: Pick<TodayPlan, 'kind'> & { skill?: { opener?: boolean } }, now = Date.now(), marks?: DayMarks): boolean {
  return dayStage(state, plan, now, marks) === 'done'
}

/** Whether a gym day's opener is saved and its lifts are what is left. */
export function liftsNext(state: AppState, plan: Pick<TodayPlan, 'kind'> & { skill?: { opener?: boolean } }, now = Date.now(), marks?: DayMarks): boolean {
  return dayStage(state, plan, now, marks) === 'lifts-next'
}

/**
 * Home's "Short on time?" through the coach: the plan for those minutes, as
 * "I have X min" plans it. It once built a hard planche session 22 hours after
 * heavy bench — inside the rest rule, on a day the coach had made a gym day —
 * and said nothing. A calisthenics day trains its own skills short; any other
 * day only skills outside the rest rule (never on a pain day), and with none
 * the reason is said instead of a session. Built where the athlete is.
 */
export function shortVersion(
  state: AppState,
  minutes: number,
  opts: { now?: number; kind?: 'calisthenics' | 'gym'; placeId?: string } = {},
): { request: WorkoutRequest } | { reason: string } {
  const now = opts.now ?? Date.now()
  const plan = planToday(state, { now, minutes: Math.max(minutes, MIN_SKILL_MINUTES[1]), ...(opts.kind ? { kind: opts.kind } : {}) })
  if (plan.kind === 'calisthenics' && plan.skill && !plan.skill.opener) {
    // Built where the plan has it (a lever day at the gym with the bar), or where the athlete said they are.
    return { request: { ...calisthenicsRequest(state, plan.skill, opts.placeId), minutes } }
  }
  const skills = (state.profile.skills?.length ? state.profile.skills : ['planche']) as SkillId[]
  const pain = plan.reasons.some((r) => r.startsWith('You reported pain'))
  const free = skills.filter((s) => !insideRestRule(state, [s], now) && missingKit(s, state.profile.equipment).length === 0)
  if (free.length && !pain) return { request: atActivePlace(state, { source: 'auto', minutes, skills: free }) }
  const rule = skills.map((s) => insideRestRule(state, [s], now)).find(Boolean)
  return {
    reason: rule
      ? `Your last ${rule.gym ? `heavy ${rule.family === 'push' ? 'pressing' : 'pulling'}` : 'hard straight-arm'} session was ${rule.hours} h ago — under your ${rule.ruleHours} h rest rule, so a short session of it waits too. Pick it on Train if you want it anyway.`
      : (plan.reasons[0] ?? 'Nothing short fits today.'),
  }
}

const startOfDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * An explicitly picked skill day inside the athlete's rest rule carries the
 * fact on its request (`WorkoutRequest.insideRest`), so the coach steps back
 * for it. The pick stands — the flag only says how recently the family was
 * trained hard. Anything not picked, or outside the rule, is returned as it was.
 */
export function withRestFlag<R extends WorkoutRequest>(request: R, hit: { hours: number; ruleHours: number } | undefined): R {
  return hit ? { ...request, insideRest: { hours: hit.hours, ruleHours: hit.ruleHours } } : request
}

/** A skill day previewed on a pain day: the session built is the pain-safe one, and the preview says so. */
export function becamePainSafe(request: WorkoutRequest | null, workout: Workout | null, isPainSafe: (w: Workout) => boolean): boolean {
  return Boolean(request?.skills?.length && workout && isPainSafe(workout))
}

const OPENER_HOLDS: Record<SkillId, string> = {
  planche: 'planche holds',
  frontlever: 'front lever holds',
  handstand: 'handstand practice',
  ninety: '90° holds',
  flag: 'human flag holds',
}

/**
 * A gym day's opener in words, honest about what it holds: the skill's holds
 * while fresh, and its family's strength work with the lifts. "Opens with
 * planche (18 min)" once stood for a warm-up, four short holds and a cooldown.
 */
export function openerLine(block: Pick<SkillBlock, 'skills' | 'minutes' | 'half'>): string {
  const skill = block.skills[0]
  const family = skillFamily(skill)
  const work = family === 'push' ? 'the pressing' : family === 'pull' ? 'the pulling' : 'the strength work'
  return `Opens with ${OPENER_HOLDS[skill]} (${block.minutes} min${block.half ? ', short opener' : ''}); ${work} comes with the lifts`
}

/**
 * What the calisthenics session card is to today: today's session on a
 * calisthenics day, and otherwise the alternative to what the coach planned —
 * on a gym day it once sat unlabelled under "the coach recommends the gym".
 */
export function calisthenicsCardLabel(plan: TodayPlan): string {
  const mode = homeToday(plan)
  return mode === 'calisthenics' ? 'Today’s calisthenics' : mode === 'gym' ? 'Instead of the gym: a calisthenics session' : 'If you train anyway: a calisthenics session'
}

/**
 * Where the goal stands against the step being trained. A goal that is the
 * current step is reached only once that step is passed — its bar verified,
 * or a later step open: a brand-new athlete placed on their goal once read
 * "goal reached" at 0%.
 */
export function goalStanding(current: { order: number }, goal: { order: number }, passed: boolean): 'ahead' | 'here' | 'reached' {
  if (goal.order > current.order) return 'ahead'
  if (goal.order < current.order) return 'reached'
  return passed ? 'reached' : 'here'
}

/** Said when the goal is the step the athlete is on and not yet passed. */
export const GOAL_HERE_TEXT = 'Your goal is the step you are on: hold it clean to complete it.'

/** Whether a skill view is past a step: the step after it open, or — on the last step — its bar verified. */
export function stepPassed(view: AppState, stepId: StepId): boolean {
  const next = stepAfter(stepId)
  if (next) return view.unlocked.includes(next.id)
  const step = STEP_BY_ID[stepId]
  return Boolean(step) && qualifyingProgress(view, stepId).value >= step.unlockSec
}

/**
 * A gym day's lifts as the screens hand them on: the plan's limits and where
 * they are built. `spare` is the muscles the week already has far past target,
 * and on a light pressing day the pressing muscles (`LIGHT_PRESS_SPARE`) — the
 * builder leans away from them — and `placeId` the place the day was planned
 * at: a gym day is planned at the gym even when Home is the place set now.
 */
export interface GymPreset {
  focus: GymFocus
  minutes: number
  avoidJoints: Joint[]
  volumeFactor: number
  musclesOff: Muscle[]
  /** Warm-up minutes for the lifts: short straight after a skill opener (`AFTER_OPENER_WARM_UP_MIN`), the usual otherwise. */
  warmUpMin?: number
  /** Muscles the week leaves furthest under target (`TodayPlan.gym.priority`), given priority beside the athlete's own. */
  priority?: Muscle[]
  /**
   * Muscles the lifts lean away from (`TodayPlan.gym.spare`): those the week already has far past target, and on a
   * light pressing day the pressing muscles, so the day's press keeps two sets and stays a light day.
   */
  spare?: Muscle[]
  /** Where the lifts are built. */
  placeId?: string
}

/** What a preset takes from a plan's gym block (or a `GymToday`, which has the same limits). */
export interface GymLimits {
  focus: GymFocus
  minutes: number
  avoidJoints: Joint[]
  volumeFactor: number
  musclesOff: Muscle[]
  priority?: Muscle[]
  /** Includes a light pressing day's pressing muscles: dropping it would turn a light day into a hard pressing day. */
  spare?: Muscle[]
}

/** A preset from the plan's limits: every limit the planner returns reaches the builder, empty ones left out. */
export function gymPreset(g: GymLimits, extra: { placeId?: string; warmUpMin?: number } = {}): GymPreset {
  return {
    focus: g.focus,
    minutes: g.minutes,
    avoidJoints: g.avoidJoints,
    volumeFactor: g.volumeFactor,
    musclesOff: g.musclesOff,
    ...(g.priority?.length ? { priority: g.priority } : {}),
    ...(g.spare?.length ? { spare: g.spare } : {}),
    ...(extra.placeId ? { placeId: extra.placeId } : {}),
    ...(extra.warmUpMin !== undefined ? { warmUpMin: extra.warmUpMin } : {}),
  }
}

/** Where the lifts go: the place, the place the plan had them, and whether the athlete moved them. */
export interface GymPlaceChoice {
  place: GymLocation
  planned?: GymLocation
  moved: boolean
}

/**
 * The place a gym day is built at. The plan's own (`plannedId`, else
 * `gymPlaceOf`: the gym, wherever the app is set now) unless the athlete said
 * today where they are (`pickedId`, kept in `TodayChoice.placeId`). Home being
 * the active place is not a pick — a planned gym day is never built at home
 * silently. A pick naming a place that is gone is no pick.
 */
export function resolveGymPlace(state: AppState, now: number, opts: { plannedId?: string; pickedId?: string } = {}): GymPlaceChoice | undefined {
  const locations = state.gym?.locations ?? []
  const by = (id?: string) => (id ? locations.find((l) => l.id === id) : undefined)
  const planned = by(opts.plannedId) ?? gymPlaceOf(state, now)
  const place = by(opts.pickedId) ?? planned
  if (!place) return undefined
  return { place, ...(planned ? { planned } : {}), moved: Boolean(planned && planned.id !== place.id) }
}

/** "At Gym A" for a planned gym day; the athlete's own pick says where the plan had it. */
export function gymPlaceLine(choice: GymPlaceChoice | undefined): string | null {
  if (!choice) return null
  return choice.moved && choice.planned ? `At ${choice.place.name}. The plan had this at ${choice.planned.name}.` : `At ${choice.place.name}`
}

/**
 * A skill block as the request that starts it, built where the plan has it:
 * the block's kit (a lever day at the gym with the bar, an opener at its
 * place), or the active place's when the block names none. An athlete who said
 * today where they are (`pickedId`) gets that place's kit instead — the card
 * says where the plan had it (`calisthenicsPlaceLine`).
 */
export function calisthenicsRequest(state: AppState, block: SkillBlock, pickedId?: string): WorkoutRequest {
  const base: WorkoutRequest = { source: 'auto', minutes: block.minutes, skills: block.skills }
  const picked = state.gym?.locations.find((l) => l.id === pickedId)
  const kit: EquipmentId[] | undefined = picked ? kitAt(state, picked) : block.kit?.length ? block.kit : placeKit(state)
  return kit?.length ? { ...base, kit } : base
}

/** A request already built for a place keeps its kit; any other is built where the athlete is. */
export function atPlanPlace(state: AppState, request: WorkoutRequest): WorkoutRequest {
  return request.kit?.length ? request : atActivePlace(state, request)
}

/** Where a calisthenics day (or an opener) is planned, when the plan names a place; the athlete's own pick says where the plan had it. */
export function calisthenicsPlaceLine(state: AppState, block: Pick<SkillBlock, 'placeId'>, pickedId?: string): string | null {
  const locations = state.gym?.locations ?? []
  const planned = locations.find((l) => l.id === block.placeId)
  if (!planned) return null
  const picked = pickedId && pickedId !== planned.id ? locations.find((l) => l.id === pickedId) : undefined
  return picked ? `At ${picked.name}. The plan had this at ${planned.name}.` : `At ${planned.name}`
}

const SKILL_NAME: Record<SkillId, string> = { planche: 'planche', frontlever: 'front lever', handstand: 'handstand', ninety: '90° hold', flag: 'flag' }
const capital = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)

/**
 * The calisthenics day's title and line on the Today card. A pain-safe day
 * trains none of its skills, so it is named for what it is and names only its
 * lead.
 */
export function calisthenicsTitle(block: Pick<SkillBlock, 'skills' | 'minutes' | 'painSafe'>): { title: string; line: string } {
  if (block.painSafe) {
    const lead = block.skills[0]
    return { title: `Pain-safe recovery · ${block.minutes} min`, line: lead ? `Gentle movement, no loaded holds — ${SKILL_NAME[lead]} leads` : 'Gentle movement, no loaded holds' }
  }
  return { title: `Calisthenics · ${block.minutes} min`, line: capital(block.skills.map((s) => SKILL_NAME[s]).join(', ')) }
}

/**
 * What the week asks of the lifts, as `buildGymSession` takes it: the muscles
 * it leaves furthest under target (priority, beside the athlete's own) and the
 * ones already far past it (`spare`, left out when empty). Every place the app
 * builds lifts from a plan passes this, so the steer reaches the session.
 */
export function steerInput(limits: { priority?: readonly Muscle[]; spare?: readonly Muscle[] }, own: readonly Muscle[] = []): { priority: Muscle[]; spare?: Muscle[] } {
  const spare = [...new Set(limits.spare ?? [])]
  return { priority: [...new Set([...own, ...(limits.priority ?? [])])], ...(spare.length ? { spare } : {}) }
}
