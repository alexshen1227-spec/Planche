import type { EquipmentId, TrainingSurface } from '../types'

export const EQUIPMENT_OPTIONS: { id: EquipmentId; label: string; hint: string }[] = [
  { id: 'floor', label: 'Floor', hint: 'Always available; useful for wrist-specific carryover' },
  { id: 'parallettes', label: 'Parallettes', hint: 'A different wrist angle and extra clearance for tuck work' },
  { id: 'band', label: 'Resistance band', hint: 'Assisted longer-lever work later on' },
  { id: 'pullup-bar', label: 'Pull-up bar', hint: 'A place to anchor assistance bands' },
  { id: 'dip-bars', label: 'Dip bars', hint: 'Extra pressing volume' },
  { id: 'box', label: 'Stable box or step', hint: 'A fixed foot support for supported lean variations' },
]

const LABEL: Record<EquipmentId, string> = Object.fromEntries(
  EQUIPMENT_OPTIONS.map((option) => [option.id, option.label.toLowerCase()]),
) as Record<EquipmentId, string>

/** How a piece of kit reads inside a sentence ("dip bars", "a stable box or step"). */
export function equipmentLabel(id: EquipmentId): string {
  return LABEL[id] ?? id
}

export const TRAINING_SURFACES: { id: TrainingSurface; label: string }[] = [
  { id: 'floor', label: 'Floor' },
  { id: 'parallettes', label: 'Parallettes' },
]

export function defaultSurface(equipment: EquipmentId[], preferred?: TrainingSurface): TrainingSurface {
  if (preferred === 'parallettes' && equipment.includes('parallettes')) return preferred
  if (preferred === 'floor' && equipment.includes('floor')) return preferred
  return equipment.includes('parallettes') && !equipment.includes('floor') ? 'parallettes' : 'floor'
}

export function surfaceLabel(surface: TrainingSurface): string {
  return surface === 'parallettes' ? 'Parallettes' : 'Floor'
}
