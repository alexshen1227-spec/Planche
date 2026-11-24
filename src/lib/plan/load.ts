import { MUSCLES, type Joint, type Muscle, type Pattern } from '../../data/gym/catalog'
import { athleticDomain, equivalentGymExercise, GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { EXERCISE_BY_ID } from '../../data/exercises'
import { SKILLS } from '../../data/skills'
import type { AppState, Category, Session, SetLog, SkillId } from '../../types'
import type { GoalWeights, GymSession, OutsideActivity, SportLoadAreas, TrainingPrefs } from '../gym/types'
import { sportBetween } from './sport'

/**
 * One count for everything an athlete does: gym sets, skill sets and outside
 * activity, in muscles and joints. This is what "planned together" rests on —
 * a planche session and a bench press both land on the front delts, wrists and
 * elbows, a front lever and a row on the lats and elbows, a sprint on the legs.
 *
 * Credits are the usual volume convention (CONSENSUS): a set counts fully for
 * a primary muscle and half for a secondary one. Skill holds count as sets of
 * the muscles their category loads — an inference from the positions, not a
 * measurement.
 */

export type Credit = Partial<Record<Muscle, number>>
export interface MuscleSetSources {
  direct: Credit
  assisting: Credit
  skill: Credit
}

export const emptySetSources = (): MuscleSetSources => ({ direct: {}, assisting: {}, skill: {} })

interface Loading {
  muscles: Credit
  joints: Joint[]
  /** Which straight-arm family a hard set of this belongs to. */
  straightArm?: 'push' | 'pull'
  /**
   * A hard bent-arm press of the push family: a rung of the handstand's pressing ladder that puts the whole body
   * weight on the arms overhead (`HARD_PRESSES`). Counted with the push family's sets by the rest rule
   * (`restFamilyOf`), as heavy gym pressing is; the handstand hold itself stays balance work.
   */
  press?: boolean
}

/**
 * The handstand's pressing ladder is overhead pressing, and is credited as the
 * gym credits the same movement (`data/gym/exercises.ts`): the pike push-ups
 * as its pike push-ups, every wall rung — negative, deficit and freestanding
 * included — as its wall handstand push-up. Front delts and triceps, the side
 * delts and upper back half (INFERENCE from the movement, like every skill
 * credit here); never chest, which the category's push-up credit once gave
 * them.
 */
const HANDSTAND_PRESSES: readonly string[] = SKILLS.handstand.ladder?.rungs.map((r) => r.exerciseId) ?? []

/**
 * The rungs that are a hard press, read off the ladder's own data: from the
 * wall negative up — "your whole weight", then the press, the deficit and the
 * freestanding press. The pike push-up is "the pattern, at the lightest load"
 * and the feet-elevated one "more of your weight", not all of it, so neither
 * counts (INFERENCE from the positions, like the rest rule's shared joints).
 */
const FIRST_HARD_PRESS = 'wall-hspu-negative'
export const HARD_PRESSES: ReadonlySet<string> = new Set(HANDSTAND_PRESSES.slice(Math.max(0, HANDSTAND_PRESSES.indexOf(FIRST_HARD_PRESS))))

/** Skills whose sessions can press hard (a rung of their ladder is in `HARD_PRESSES`): the handstand. */
export const PRESS_SKILLS: ReadonlySet<SkillId> = new Set(
  Object.values(SKILLS)
    .filter((sk) => sk.ladder?.rungs.some((r) => HARD_PRESSES.has(r.exerciseId)))
    .map((sk) => sk.id),
)

function pressLoading(exerciseId: string): Loading | null {
  if (!HANDSTAND_PRESSES.includes(exerciseId) && exerciseId !== 'kneeling-pike-pushup') return null
  const twin = gymSetLoading(exerciseId === 'kneeling-pike-pushup' ? 'pike-push-up' : equivalentGymExercise(exerciseId)?.id ?? 'wall-hspu')
  if (!twin) return null
  return { muscles: twin.muscles, joints: twin.joints, ...(HARD_PRESSES.has(exerciseId) ? { press: true } : {}) }
}

const SKILL_LOADING: Partial<Record<Category, Loading>> = {
  planche: {
    muscles: { 'front-delts': 1, chest: 0.5, triceps: 0.5, biceps: 0.5, abs: 0.5 },
    joints: ['wrists', 'elbows', 'shoulders'],
    straightArm: 'push',
  },
  ninety: { muscles: { 'front-delts': 1, triceps: 1, chest: 0.5 }, joints: ['wrists', 'elbows', 'shoulders'], straightArm: 'push' },
  push: { muscles: { chest: 1, 'front-delts': 1, triceps: 1 }, joints: ['wrists', 'elbows', 'shoulders'] },
  handstand: { muscles: { 'front-delts': 1, triceps: 0.5, traps: 0.5 }, joints: ['wrists', 'shoulders'] },
  lever: {
    muscles: { lats: 1, 'upper-back': 0.5, abs: 0.5, biceps: 0.5 },
    joints: ['elbows', 'shoulders'],
    straightArm: 'pull',
  },
  flag: { muscles: { lats: 1, obliques: 1, 'side-delts': 0.5 }, joints: ['shoulders', 'elbows', 'wrists'], straightArm: 'pull' },
  pull: { muscles: { lats: 1, biceps: 1, 'upper-back': 1 }, joints: ['elbows', 'shoulders'] },
  scapula: { muscles: { 'upper-back': 0.5 }, joints: ['shoulders'] },
  core: { muscles: { abs: 1, 'hip-flexors': 0.5 }, joints: [] },
}

/** What one hard set of a skill family adds, by muscle: its category's loading (the handstand stands in for balance work). */
export function familyLoading(family: 'push' | 'pull' | 'balance'): Credit {
  return (family === 'push' ? SKILL_LOADING.planche : family === 'pull' ? SKILL_LOADING.lever : SKILL_LOADING.handstand)!.muscles
}

/** How a skill set loads the body; warm-up and cooldown sets count for nothing. */
export function skillSetLoading(exerciseId: string, section: string): Loading | null {
  if (section === 'warmup' || section === 'cooldown') return null
  return SKILL_MOVEMENT_LOAD[exerciseId] ?? null
}

function loadingOfSkill(exerciseId: string): Loading | null {
  const press = pressLoading(exerciseId)
  if (press) return press
  const ex = EXERCISE_BY_ID[exerciseId]
  if (!ex) return null
  const category = SKILL_LOADING[ex.category]
  const twinId = equivalentGymExercise(exerciseId)?.id
  const twin = twinId && gymSetLoading(twinId)
  if (twin) return { ...category, ...twin }
  return category ?? null
}

/**
 * The family a skill set counts toward for the straight-arm rest rule: a
 * straight-arm set of it (main or strength work), or a hard press of the
 * handstand's ladder (`HARD_PRESSES`) for the push family — pressing the whole
 * body weight overhead loads the front delts, wrists and elbows a planche
 * does, as heavy gym pressing does (CONSENSUS: shared recovery; the joints are
 * INFERENCE). An easy day's light dose is not a hard press.
 */
export function restFamilyOf(set: { exerciseId: string; section: string; light?: boolean }): 'push' | 'pull' | undefined {
  if (set.section !== 'main' && set.section !== 'strength') return undefined
  const l = skillSetLoading(set.exerciseId, set.section)
  if (!l) return undefined
  if (l.straightArm) return l.straightArm
  return l.press && !set.light ? 'push' : undefined
}

const GYM_MOVEMENT_LOAD: Record<string, Loading> = Object.fromEntries(Object.values(GYM_EXERCISE_BY_ID).map((ex) => {
  const muscles: Credit = {}
  for (const m of ex.secondary) muscles[m] = 0.5
  for (const m of ex.primary) muscles[m] = 1
  return [ex.id, { muscles, joints: ex.stress }]
}))
const SKILL_MOVEMENT_LOAD: Record<string, Loading | null> = Object.fromEntries(
  Object.keys(EXERCISE_BY_ID).map((id) => [id, loadingOfSkill(id)]),
)

export function gymSetLoading(exerciseId: string): Loading | null {
  return GYM_MOVEMENT_LOAD[exerciseId] ?? null
}

function add(into: Credit, credit: Credit, scale = 1) {
  for (const [m, v] of Object.entries(credit) as [Muscle, number][]) into[m] = (into[m] ?? 0) + v * scale
}

/** A planning estimate for muscle work. All attempts still count in the skill log and fatigue model. */
function skillVolumeCredit(set: SetLog): number {
  if (!(set.value > 0) || set.value < set.target / 2) return 0
  const effortCredit = set.light || (set.rpe !== undefined && set.rpe <= 6) ? 0.5 : 1
  return effortCredit * sideCredit(set)
}

// The gym logs one round for both sides. The skill player logs each side separately.
// Older entries without a recorded side keep their original whole-round interpretation.
const sideCredit = (set: SetLog) => EXERCISE_BY_ID[set.exerciseId]?.perSide && set.side ? 0.5 : 1

/** Speed and impact sessions have their own records and recovery cost. Only resistance work enters the lifting volume target. */
export function resistanceSetLoading(exerciseId: string): Loading | null {
  const ex = GYM_EXERCISE_BY_ID[exerciseId]
  return ex && !athleticDomain(ex) ? gymSetLoading(exerciseId) : null
}

/** Use the same primary and secondary weights for logged sets and scheduled lifts. */
export function addLiftVolume(total: Credit, exerciseId: string, sets: number, sources?: MuscleSetSources) {
  const loading = resistanceSetLoading(exerciseId)
  if (!loading || sets <= 0) return
  for (const [muscle, factor] of Object.entries(loading.muscles) as [Muscle, number][]) {
    const amount = factor * sets
    total[muscle] = (total[muscle] ?? 0) + amount
    if (sources) {
      const part = factor === 1 ? sources.direct : sources.assisting
      part[muscle] = (part[muscle] ?? 0) + amount
    }
  }
}

/** Weekly sets per muscle between `from` and `to` (ms), from gym and skill work alike. */
export function setsPerMuscle(
  skillSessions: Session[],
  gymSessions: GymSession[],
  from: number,
  to: number,
  sources?: MuscleSetSources,
): Credit {
  const out: Credit = {}
  for (const s of skillSessions) {
    if ((s.endedAt ?? s.startedAt) < from || s.startedAt >= to) continue
    for (const set of s.sets) {
      const at = set.at ?? s.startedAt
      if (at < from || at >= to) continue
      const l = skillSetLoading(set.exerciseId, set.section)
      const credit = skillVolumeCredit(set)
      if (l && credit > 0) {
        add(out, l.muscles, credit)
        if (sources) add(sources.skill, l.muscles, credit)
      }
    }
  }
  for (const s of gymSessions) {
    if ((s.endedAt ?? s.startedAt) < from || s.startedAt >= to) continue
    for (const log of s.exercises) {
      const completed = log.sets.filter((set) => {
        const at = set.at ?? s.startedAt
        return !set.warmup && set.reps > 0 && at >= from && at < to
      }).length
      addLiftVolume(out, log.exerciseId, completed, sources)
    }
  }
  return out
}

export type VolumeStatus = 'off' | 'under' | 'on' | 'over'

/**
 * Weekly set targets per muscle (CONSENSUS ranges; the dose-response evidence
 * for hypertrophy is MODERATE that more sets help up to roughly 10–20 a week,
 * and silent on exact numbers). The physique goal sets the band; a priority
 * muscle gets about a third more; a muscle switched off gets none. The two
 * sub-targets (upper chest, triceps long head) sit inside their parents'
 * counts, so their own bands are smaller.
 */
export function volumeTarget(muscle: Muscle, prefs: Pick<TrainingPrefs, 'goals' | 'musclesOff' | 'musclesPriority'>): [number, number] {
  if (prefs.musclesOff.includes(muscle)) return [0, 0]
  const p = prefs.goals.physique
  let band: [number, number] = p >= 4 ? [12, 20] : p >= 3 ? [10, 16] : p >= 1 ? [8, 12] : [4, 8]
  const sub = MUSCLES.find((m) => m.id === muscle)?.sub
  if (sub) band = [Math.round(band[0] / 2), Math.round(band[1] / 2)]
  if (prefs.musclesPriority.includes(muscle)) band = [Math.round(band[0] * 1.3), Math.round(band[1] * 1.3)]
  return band
}

export function volumeStatus(sets: number, target: [number, number]): VolumeStatus {
  if (target[1] === 0) return 'off'
  if (sets < target[0]) return 'under'
  if (sets > target[1]) return 'over'
  return 'on'
}

const HALF_LIFE_H = 36
const decay = (hours: number) => Math.pow(0.5, Math.max(0, hours) / HALF_LIFE_H)
const effort = (rpe?: number) => (rpe === undefined ? 1 : Math.min(1.25, Math.max(0.6, rpe / 8)))

export interface Fatigue {
  muscles: Credit
}

export const SPORT_UPPER_MUSCLES: Record<'push' | 'pull', Muscle[]> = {
  push: ['chest', 'front-delts', 'triceps'],
  pull: ['lats', 'upper-back', 'biceps', 'forearms'],
}

export function sportLoading(areas: SportLoadAreas): Credit {
  const result: Credit = {}
  if (areas.legs) Object.assign(result, { quads: 1, hamstrings: 1, glutes: 1, calves: 1 })
  if (areas.upperPush) for (const m of SPORT_UPPER_MUSCLES.push) result[m] = 1
  if (areas.upperPull) for (const m of SPORT_UPPER_MUSCLES.pull) result[m] = 1
  return result
}

/**
 * Recent load per muscle, decaying with a 36-hour half-life — a planning
 * convention, not a physiological measurement. It ranks what is freshest; it
 * never claims a muscle is "recovered". (Joint and whole-body totals were once
 * computed beside it and never read: what joints share is decided by the
 * straight-arm family rule — `familyEvents` — not by a number nothing used.)
 */
export function fatigueAt(state: Pick<AppState, 'sessions' | 'gym'>, now: number): Fatigue {
  const out: Fatigue = { muscles: {} }
  const horizon = now - 5 * 86_400_000
  for (const s of state.sessions) {
    if (s.startedAt < horizon || s.startedAt > now) continue
    const age = decay((now - s.startedAt) / 3_600_000)
    for (const set of s.sets) {
      const l = skillSetLoading(set.exerciseId, set.section)
      if (l) add(out.muscles, l.muscles, age * effort(set.rpe ?? s.rpe) * sideCredit(set))
    }
  }
  for (const s of state.gym?.sessions ?? []) {
    if (s.startedAt < horizon || s.startedAt > now) continue
    const age = decay((now - s.startedAt) / 3_600_000)
    for (const log of s.exercises) {
      const l = gymSetLoading(log.exerciseId)
      if (!l) continue
      for (const set of log.sets) {
        if (set.warmup || !(set.reps > 0)) continue
        add(out.muscles, l.muscles, age * effort(set.rpe))
      }
    }
  }
  // Logged activities and the regular sport week alike (a log of the same kind replaces that day's usual session).
  for (const a of sportBetween(state.gym, horizon, now + 1)) {
    add(out.muscles, sportLoading(a), decay((now - a.at) / 3_600_000) * activityLoad(a))
  }
  return out
}

/** An outside activity as an equivalent number of hard sets: minutes × effort. */
export function activityLoad(a: Pick<OutsideActivity, 'minutes' | 'rpe' | 'kind'>): number {
  const sprintFactor = a.kind === 'sprint' || a.kind === 'game' ? 1.5 : 1
  return (a.minutes / 10) * (a.rpe / 7) * sprintFactor
}

/** When each straight-arm family was last trained hard: three or more main sets of it in a skill session. */
export function lastHardStraightArm(sessions: Session[], now: number): { push?: number; pull?: number } {
  const out: { push?: number; pull?: number } = {}
  for (const s of sessions) {
    if (s.startedAt > now) continue
    const count = { push: 0, pull: 0 }
    for (const set of s.sets) {
      if (set.section !== 'main' && set.section !== 'strength') continue
      const family = skillSetLoading(set.exerciseId, set.section)?.straightArm
      if (family) count[family]++
    }
    for (const family of ['push', 'pull'] as const) {
      if (count[family] >= 3 && (out[family] ?? 0) < s.startedAt) out[family] = s.startedAt
    }
  }
  return out
}

/** Gym movements that count toward each straight-arm family's shared recovery. */
const FAMILY_PATTERNS: Record<'push' | 'pull', ReadonlySet<Pattern>> = {
  push: new Set<Pattern>(['horizontal-press', 'incline-press', 'vertical-press', 'dip']),
  pull: new Set<Pattern>(['vertical-pull', 'horizontal-pull', 'straight-arm-pull']),
}

/**
 * Working sets of one family's movements that make a gym session a hard
 * session of that family: the planner's `HARD_SETS` line (a muscle worked hard
 * that day) — a planning line, not a measured one.
 */
export const HARD_GYM_FAMILY_SETS = 4

/**
 * Muscles that every pressing movement (`FAMILY_PATTERNS.push`) has among its
 * prime movers — each press, dip and shoulder press leans on the front delts or
 * the triceps. A gym day built with them spared (`buildGymSession`'s `spare`)
 * keeps the one press it is named for at two sets and leaves every other
 * pressing movement out, so it stays under `HARD_GYM_FAMILY_SETS` and is never
 * a hard pressing session: the planner's light pressing beside push-family
 * skill days. Chest flies and lateral raises are not pressing and stay.
 */
export const LIGHT_PRESS_SPARE: readonly Muscle[] = ['front-delts', 'triceps']

/** A gym session's working sets of each family's movements, as `familyEvents` counts them. */
export function familyWorkingSets(exercises: readonly { exerciseId: string; sets: readonly { warmup?: boolean; reps: number }[] }[]): Record<'push' | 'pull', number> {
  const count = { push: 0, pull: 0 }
  for (const log of exercises) {
    const pattern = GYM_EXERCISE_BY_ID[log.exerciseId]?.pattern
    if (!pattern) continue
    const working = log.sets.filter((x) => !x.warmup && x.reps > 0).length
    for (const f of ['push', 'pull'] as const) if (FAMILY_PATTERNS[f].has(pattern)) count[f] += working
  }
  return count
}

/** The presses a push day is named for: a gym session with a working set of one has pressed (the weekly pressing rule). */
const CHEST_PRESS_PATTERNS: ReadonlySet<Pattern> = new Set<Pattern>(['horizontal-press', 'incline-press'])

/** Whether a logged gym session pressed: a working set of a bench or incline press. */
export function pressedIn(session: Pick<GymSession, 'exercises'>): boolean {
  return session.exercises.some((log) => CHEST_PRESS_PATTERNS.has(GYM_EXERCISE_BY_ID[log.exerciseId]?.pattern as Pattern) && log.sets.some((x) => !x.warmup && x.reps > 0))
}

/** A hard session of a straight-arm family, logged: skill work or the gym. */
export interface FamilyEvent {
  at: number
  /** A gym session (heavy pressing or pulling) rather than skill work. */
  gym: boolean
  /** A skill session that reached the count only with its handstand push-ups (`HARD_PRESSES`), not with holds. */
  press?: true
}

/**
 * Every logged hard session of each straight-arm family up to `now`: skill
 * sessions with three or more main sets of the family — straight-arm holds,
 * and for the push family the handstand's hard presses (`restFamilyOf`) — and
 * gym sessions with `HARD_GYM_FAMILY_SETS` or more working sets of pressing
 * (push) or pulling (pull). Planche, handstand push-ups and presses load the
 * same front delts, wrists and elbows, and the front lever and rows or
 * pull-ups the same lats and elbows, so the rest rule spaces them together
 * (CONSENSUS; the shared joints are INFERENCE from the positions).
 */
export function familyEvents(state: Pick<AppState, 'sessions' | 'gym'>, now: number): Record<'push' | 'pull', FamilyEvent[]> {
  const out: Record<'push' | 'pull', FamilyEvent[]> = { push: [], pull: [] }
  for (const s of state.sessions) {
    if (s.startedAt > now) continue
    const count = { push: 0, pull: 0 }
    const holds = { push: 0, pull: 0 }
    for (const set of s.sets) {
      const family = restFamilyOf(set)
      if (!family) continue
      count[family]++
      if (skillSetLoading(set.exerciseId, set.section)?.straightArm) holds[family]++
    }
    for (const f of ['push', 'pull'] as const) if (count[f] >= 3) out[f].push({ at: s.startedAt, gym: false, ...(holds[f] < 3 ? { press: true as const } : {}) })
  }
  for (const s of state.gym?.sessions ?? []) {
    if (s.startedAt > now) continue
    const count = familyWorkingSets(s.exercises)
    for (const f of ['push', 'pull'] as const) if (count[f] >= HARD_GYM_FAMILY_SETS) out[f].push({ at: s.startedAt, gym: true })
  }
  for (const f of ['push', 'pull'] as const) out[f].sort((a, b) => a.at - b.at)
  return out
}

/** The dominant gym emphasis from the goal weights. */
export function emphasisFor(goals: GoalWeights): {
  compound: 'strength' | 'muscle' | 'endurance'
  isolation: 'muscle' | 'endurance'
  power: boolean
} {
  const compound = goals.endurance > Math.max(goals.strength, goals.physique) ? 'endurance' : goals.strength > goals.physique ? 'strength' : 'muscle'
  return { compound, isolation: goals.endurance > goals.physique ? 'endurance' : 'muscle', power: goals.power >= 3 }
}

/**
 * When each muscle was last trained — a working gym set (primary or
 * secondary) or a skill set that loads it. Absent means never in the history.
 */
export function lastTrainedAt(state: Pick<AppState, 'sessions' | 'gym'>, now: number): Partial<Record<Muscle, number>> {
  const out: Partial<Record<Muscle, number>> = {}
  const mark = (credit: Credit, at: number) => {
    for (const m of Object.keys(credit) as Muscle[]) if (at <= now && (out[m] ?? 0) < at) out[m] = at
  }
  for (const s of state.sessions) {
    for (const set of s.sets) {
      const l = skillSetLoading(set.exerciseId, set.section)
      if (l && skillVolumeCredit(set) > 0) mark(l.muscles, s.startedAt)
    }
  }
  for (const s of state.gym?.sessions ?? []) {
    for (const log of s.exercises) {
      const l = gymSetLoading(log.exerciseId)
      if (l && log.sets.some((x) => !x.warmup && x.reps > 0)) mark(l.muscles, s.startedAt)
    }
  }
  return out
}
