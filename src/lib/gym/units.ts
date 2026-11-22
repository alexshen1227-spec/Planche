import { GYM_EQUIPMENT_BY_ID, LB_PER_KG, type Unit } from '../../data/gym/catalog'
import type { GymExercise } from '../../data/gym/exercises'
import type { GymLocation } from './types'

export function toKg(value: number, unit: Unit): number {
  return unit === 'kg' ? value : value / LB_PER_KG
}

export function fromKg(kg: number, unit: Unit): number {
  return unit === 'kg' ? kg : kg * LB_PER_KG
}

/** A load as the athlete reads it: whole or half units, never 22.6796185. */
export function displayLoad(kg: number, unit: Unit): number {
  const v = fromKg(kg, unit)
  return Math.round(v * 2) / 2
}

export function formatLoad(kg: number | undefined, unit: Unit): string {
  if (kg === undefined || kg <= 0) return 'Bodyweight'
  const v = displayLoad(kg, unit)
  return `${Number.isInteger(v) ? v : v.toFixed(1)} ${unit}`
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
  const capped = maxKg !== undefined ? Math.min(kg, maxKg) : kg
  if (!(stepKg > 0)) return Math.max(0, Math.round(capped * 4) / 4)
  return Math.max(0, Math.round(capped / stepKg) * stepKg)
}
