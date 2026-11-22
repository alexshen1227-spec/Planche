import { MUSCLES, type Joint, type Muscle } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { EXERCISE_BY_ID } from '../../data/exercises'
import type { AppState, Category, Session } from '../../types'
import type { GoalWeights, GymSession, OutsideActivity, TrainingPrefs } from '../gym/types'

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

interface Loading {
  muscles: Credit
  joints: Joint[]
  /** Which straight-arm family a hard set of this belongs to. */
  straightArm?: 'push' | 'pull'
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

/** How a skill set loads the body; warm-up and cooldown sets count for nothing. */
export function skillSetLoading(exerciseId: string, section: string): Loading | null {
  if (section === 'warmup' || section === 'cooldown') return null
  const ex = EXERCISE_BY_ID[exerciseId]
  return ex ? SKILL_LOADING[ex.category] ?? null : null
}

export function gymSetLoading(exerciseId: string): Loading | null {
  const ex = GYM_EXERCISE_BY_ID[exerciseId]
  if (!ex) return null
  const muscles: Credit = {}
  for (const m of ex.secondary) muscles[m] = 0.5
  for (const m of ex.primary) muscles[m] = 1
  return { muscles, joints: ex.stress }
}

function add(into: Credit, credit: Credit, scale = 1) {
  for (const [m, v] of Object.entries(credit) as [Muscle, number][]) into[m] = (into[m] ?? 0) + v * scale
}

/** Weekly sets per muscle between `from` and `to` (ms), from gym and skill work alike. */
export function setsPerMuscle(
  skillSessions: Session[],
  gymSessions: GymSession[],
  from: number,
  to: number,
): Credit {
  const out: Credit = {}
  for (const s of skillSessions) {
    if (s.startedAt < from || s.startedAt >= to) continue
    for (const set of s.sets) {
      const l = skillSetLoading(set.exerciseId, set.section)
      if (l) add(out, l.muscles)
    }
  }
  for (const s of gymSessions) {
    if (s.startedAt < from || s.startedAt >= to) continue
    for (const log of s.exercises) {
      const l = gymSetLoading(log.exerciseId)
      if (!l) continue
      add(out, l.muscles, log.sets.filter((x) => !x.warmup && x.reps > 0).length)
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
  joints: Partial<Record<Joint, number>>
  /** Whole-body, nervous-system load from hard work and hard sport. */
  system: number
}

/**
 * Recent load, decaying with a 36-hour half-life — a planning convention, not
 * a physiological measurement. It ranks what is freshest; it never claims a
 * muscle is "recovered".
 */
export function fatigueAt(state: Pick<AppState, 'sessions' | 'gym'>, now: number): Fatigue {
  const out: Fatigue = { muscles: {}, joints: {}, system: 0 }
  const horizon = now - 5 * 86_400_000
  const addJoints = (joints: Joint[], v: number) => {
    for (const j of joints) out.joints[j] = (out.joints[j] ?? 0) + v
  }
  for (const s of state.sessions) {
    if (s.startedAt < horizon || s.startedAt > now) continue
    const w = decay((now - s.startedAt) / 3_600_000) * effort(s.rpe)
    for (const set of s.sets) {
      const l = skillSetLoading(set.exerciseId, set.section)
      if (!l) continue
      add(out.muscles, l.muscles, w)
      addJoints(l.joints, w)
      out.system += 0.3 * w
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
        const w = age * effort(set.rpe)
        add(out.muscles, l.muscles, w)
        addJoints(l.joints, w)
        out.system += (GYM_EXERCISE_BY_ID[log.exerciseId]?.compound ? 0.5 : 0.2) * w
      }
    }
  }
  for (const a of state.gym?.activities ?? []) {
    if (a.at < horizon || a.at > now) continue
    const w = decay((now - a.at) / 3_600_000) * activityLoad(a)
    if (a.legs) {
      add(out.muscles, { quads: 1, hamstrings: 1, glutes: 1, calves: 1 }, w)
      addJoints(['knees', 'ankles', 'hips'], w)
    }
    out.system += w
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

/** The dominant gym emphasis from the goal weights. */
export function emphasisFor(goals: GoalWeights): {
  compound: 'strength' | 'muscle' | 'endurance'
  isolation: 'muscle' | 'endurance'
  power: boolean
} {
  const compound = goals.endurance > Math.max(goals.strength, goals.physique) ? 'endurance' : goals.strength > goals.physique ? 'strength' : 'muscle'
  return { compound, isolation: goals.endurance > goals.physique ? 'endurance' : 'muscle', power: goals.power >= 3 }
}
