import type { Pattern } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID, type GymExercise } from '../../data/gym/exercises'
import type { GymSession } from './types'

export const FOCUS_LABEL = {
  full: 'Full body', upper: 'Upper body', lower: 'Lower body', push: 'Push', pull: 'Pull', athletic: 'Speed & power',
} as const
export type GymFocus = keyof typeof FOCUS_LABEL
type Family = 'push' | 'pull' | 'lower'

const families: Partial<Record<Pattern, Family>> = {
  'horizontal-press': 'push', 'incline-press': 'push', 'vertical-press': 'push', dip: 'push', 'chest-fly': 'push',
  'lateral-raise': 'push', triceps: 'push',
  'horizontal-pull': 'pull', 'vertical-pull': 'pull', 'straight-arm-pull': 'pull', 'rear-delt': 'pull', biceps: 'pull', shrug: 'pull',
  squat: 'lower', lunge: 'lower', hinge: 'lower', 'knee-extension': 'lower', 'knee-flexion': 'lower',
  calf: 'lower', dorsiflexion: 'lower', adduction: 'lower', abduction: 'lower', jump: 'lower', sprint: 'lower', drill: 'lower',
}

function exerciseFamily(ex: Pick<GymExercise, 'pattern' | 'primary'>): Family | undefined {
  return ex.pattern === 'throw' && ex.primary.includes('chest') ? 'push' : families[ex.pattern]
}

/** A named split may include trunk work. Assisting muscles do not change a lift's main job. */
export function fitsGymFocus(focus: GymFocus, ex: Pick<GymExercise, 'pattern' | 'primary' | 'explosive'>): boolean {
  if (focus === 'full') return true
  if (focus === 'athletic') return Boolean(ex.explosive || ['carry', 'jump', 'throw', 'drill', 'sprint', 'squat', 'hinge'].includes(ex.pattern))
  if (ex.pattern === 'core-flexion' || ex.pattern === 'core-anti-rotation') return true
  const family = exerciseFamily(ex)
  return focus === 'upper' ? family === 'pull' || family === 'push' : family === focus
}

export function focusFromName(name: string): GymFocus | undefined {
  return (Object.keys(FOCUS_LABEL) as GymFocus[]).find((f) => FOCUS_LABEL[f].toLowerCase() === name.trim().toLowerCase())
}

type ExerciseSets = { exerciseId: string; sets: number }

/** Read the actual split, including short workouts and custom names. A lone set is too little to assign a day. */
export function trainedFocus(rows: readonly ExerciseSets[]): GymFocus | null {
  const sets = { push: 0, pull: 0, lower: 0 }
  for (const row of rows) {
    const ex = GYM_EXERCISE_BY_ID[row.exerciseId]
    const family = ex && exerciseFamily(ex)
    if (family) sets[family] += row.sets
  }
  const total = sets.push + sets.pull + sets.lower
  if (total < 2) return null
  for (const family of ['push', 'pull', 'lower'] as const) {
    if (sets[family] * 3 >= total * 2) return family
  }
  return sets.lower ? 'full' : 'upper'
}

export function loggedFocus(sessions: readonly GymSession[], from: number, to: number): GymFocus | null {
  const rows: ExerciseSets[] = []
  for (const session of sessions) {
    if (session.startedAt >= to || session.endedAt < from) continue
    for (const ex of session.exercises) {
      const sets = ex.sets.filter((s) => !s.warmup && s.reps > 0 && (s.at ?? session.startedAt) >= from && (s.at ?? session.startedAt) < to).length
      if (sets) rows.push({ exerciseId: ex.exerciseId, sets })
    }
  }
  return trainedFocus(rows)
}

