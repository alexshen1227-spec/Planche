import type { EquipmentId, TrainingSurface } from '../types'

export const EQUIPMENT_OPTIONS: { id: EquipmentId; label: string; hint: string }[] = [
  { id: 'floor', label: 'Floor', hint: 'Always available; useful for wrist-specific carryover' },
  { id: 'parallettes', label: 'Parallettes', hint: 'Neutral wrists and extra clearance for tuck work' },
  { id: 'band', label: 'Resistance band', hint: 'Assisted longer-lever work later on' },
  { id: 'pullup-bar', label: 'Pull-up bar', hint: 'A place to anchor assistance bands' },
  { id: 'dip-bars', label: 'Dip bars', hint: 'Extra pressing volume' },
]

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
