import { GYM_EQUIPMENT_BY_ID, LB_PER_KG, type Unit } from '../../data/gym/catalog'
import type { GymExercise } from '../../data/gym/exercises'
import type { GymLocation } from './types'

export function toKg(value: number, unit: Unit): number {
  return unit === 'kg' ? value : value / LB_PER_KG
}

export function fromKg(kg: number, unit: Unit): number {
  return unit === 'kg' ? kg : kg * LB_PER_KG
}

/** Convert a logged load for editing without rounding away a small plate. */
export function entryLoad(kg: number, unit: Unit): number {
  return Math.round(fromKg(kg, unit) * 1000) / 1000
}

export function takesAddedLoad(exercise: GymExercise, location: GymLocation | undefined): boolean {
  if (exercise.load !== 'bodyweight' || !exercise.stepFrom) return false
  return exercise.stepFrom !== 'dumbbells' || Boolean(location?.equipment.includes('dumbbells'))
}

/** Summarise estimates to half units, preserving an actual quarter-unit plate. */
export function displayLoad(kg: number, unit: Unit): number {
  const v = entryLoad(kg, unit)
  if (Number.isInteger(v * 4)) return v
  return Math.round(v * 2) / 2
}

export function unloadedLabel(ex?: GymExercise): string {
  if (ex?.assisted) return 'No assistance'
  return ex?.needs.some((group) => group.length === 1 && group[0] === 'band') ? 'Band' : 'Bodyweight'
}

export function formatLoad(kg: number | undefined, unit: Unit, ex?: GymExercise): string {
  if (kg === undefined && ex?.assisted) return 'Assistance unrecorded'
  if (kg === undefined || kg <= 0) return unloadedLabel(ex)
  const v = displayLoad(kg, unit)
  return `${v} ${unit}`
}

/** The unit loads for this exercise are entered in at this location. */
export function unitFor(exercise: GymExercise, location: GymLocation | undefined): Unit {
  const own = exercise.stepFrom ? location?.gear?.[exercise.stepFrom]?.unit : undefined
  return own ?? location?.unit ?? 'kg'
}

/** The smallest load change, in kg, this exercise allows at this location. */
export function stepKgFor(exercise: GymExercise, location: GymLocation | undefined): number {
  if (!exercise.stepFrom) return 0
  const set = location?.gear?.[exercise.stepFrom]?.stepKg
  if (set !== undefined && set > 0) return set
  const def = GYM_EQUIPMENT_BY_ID[exercise.stepFrom]?.step
  if (!def) return 0
  const unit = unitFor(exercise, location)
  return toKg(unit === 'kg' ? def.kg : def.lb, unit)
}

/** The heaviest load available for it here, when the equipment runs out (dumbbells). */
export function maxKgFor(exercise: GymExercise, location: GymLocation | undefined): number | undefined {
  if (!exercise.stepFrom) return undefined
  return location?.gear?.[exercise.stepFrom]?.maxKg
}

/** Round to a reachable load: the nearest step, never below zero, never past the top weight. */
export function roundToStep(kg: number, stepKg: number, maxKg?: number): number {
  const step = stepKg > 0 ? stepKg : 0.25
  const limit = maxKg !== undefined ? Math.floor(maxKg / step + 1e-9) : Infinity
  return Math.max(0, Math.min(Math.round(kg / step), limit)) * step
}
