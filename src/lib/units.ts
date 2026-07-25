import type { Units } from '../types'

/** Weight and height are stored in metric and converted only for display. */
export const KG_PER_LB = 0.45359237
export const CM_PER_IN = 2.54

export function kgToDisplay(kg: number, units: Units): number {
  return units === 'metric' ? kg : kg / KG_PER_LB
}

export function displayToKg(v: number, units: Units): number {
  return units === 'metric' ? v : v * KG_PER_LB
}

export function fmtWeight(kg: number | undefined, units: Units): string {
  if (kg === undefined) return '—'
  const v = kgToDisplay(kg, units)
  return `${v.toFixed(1)} ${units === 'metric' ? 'kg' : 'lb'}`
}

export function weightUnitLabel(units: Units): string {
  return units === 'metric' ? 'kg' : 'lb'
}

/** Height in imperial reads as feet and inches, not decimal inches. */
export function fmtHeight(cm: number | undefined, units: Units): string {
  if (cm === undefined) return '—'
  if (units === 'metric') return `${Math.round(cm)} cm`
  const totalIn = cm / CM_PER_IN
  const ft = Math.floor(totalIn / 12)
  const inch = Math.round(totalIn - ft * 12)
  return inch === 12 ? `${ft + 1}'0"` : `${ft}'${inch}"`
}
