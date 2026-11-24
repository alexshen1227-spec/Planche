import type { EquipmentId, SkillId, StepId } from '../../types'
import { SKILL_IDS } from '../../types'
import { EXERCISE_BY_ID } from '../exercises'
import { STEP_BY_ID, stepForKeyExercise } from '../progressions'
import { FLAG } from './flag'
import { FRONT_LEVER } from './frontLever'
import { HANDSTAND } from './handstand'
import { NINETY } from './ninety'
import { PLANCHE } from './planche'
import type { SkillDef } from './types'

export type { BlockSpec, IssueGuidance, RepLadder, RepRung, SkillDef, SkillFamily, SkillWords, StepProgram } from './types'

/** Every skill the app coaches. */
export const SKILLS: Record<SkillId, SkillDef> = {
  planche: PLANCHE,
  frontlever: FRONT_LEVER,
  handstand: HANDSTAND,
  ninety: NINETY,
  flag: FLAG,
}

/** The skills in their standard display order. */
export const SKILL_LIST: SkillDef[] = SKILL_IDS.map((id) => SKILLS[id])

export function isRepGoal(skill: SkillId, exerciseId: unknown): exerciseId is string {
  return typeof exerciseId === 'string' && Boolean(SKILLS[skill]?.ladder?.rungs.some((rung) => rung.exerciseId === exerciseId))
}

/** The skill a step's road belongs to, as a definition. */
export function skillForStep(stepId: StepId): SkillDef {
  return SKILLS[STEP_BY_ID[stepId]?.skill ?? 'planche']
}

/**
 * The skill a movement belongs to, when it is part of one skill's road rather
 * than shared support work. Planche-line movements predate the `skill` tag and
 * are recognised by their category — and a step's key hold belongs to its road
 * whatever it is filed under: the planche's Foundations hold is a pseudo
 * planche plank, catalogued with the scapula drills, and for an athlete on
 * several roads those sessions were not being counted as planche training.
 */
export function skillOfExercise(exerciseId: string): SkillId | undefined {
  const exercise = EXERCISE_BY_ID[exerciseId]
  if (!exercise) return undefined
  if (exercise.skill) return exercise.skill
  if (exercise.category === 'planche') return 'planche'
  return stepForKeyExercise(exerciseId)?.skill
}

/** Kit that counts as another: rings are a bar to hang from. */
const STANDS_IN: Partial<Record<EquipmentId, EquipmentId[]>> = {
  'pullup-bar': ['rings'],
}

/** Whether the athlete owns a piece of kit, or something that does its job. */
export function ownsKit(equipment: EquipmentId[], id: EquipmentId): boolean {
  return equipment.includes(id) || (STANDS_IN[id] ?? []).some((alt) => equipment.includes(alt))
}

/**
 * What a skill still needs before its road can be trained: one entry per
 * requirement not met, each a list of the kit that would meet it. Empty means
 * the athlete can train it with what they have.
 */
export function missingKit(skill: SkillId, equipment: EquipmentId[], stepId?: StepId): EquipmentId[][] {
  const step = stepId && STEP_BY_ID[stepId]
  const movement = step && step.skill === skill && EXERCISE_BY_ID[step.keyExerciseId]
  const requirements = movement ? (movement.requires ?? []).map((id) => [id, ...(STANDS_IN[id] ?? [])]) : SKILLS[skill].requires
  return requirements.filter((options) => !options.some((id) => ownsKit(equipment, id)))
}

/** Skills the athlete can train with their current kit, in standard order. */
export function trainableSkills(equipment: EquipmentId[]): SkillId[] {
  return SKILL_IDS.filter((skill) => missingKit(skill, equipment).length === 0)
}
