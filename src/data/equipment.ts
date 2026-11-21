import type { EquipmentId, TrainingSurface } from '../types'

/**
 * `article` is what the name takes as the object of a sentence — "needs a
 * pull-up bar", "needs dip bars". It is written down per item rather than
 * guessed from the spelling: a rule that looked for a final "s" read "Sturdy
 * pole or stall bars" as a plural and printed "Needs sturdy pole or stall
 * bars", and the bare label elsewhere gave "it needs pull-up bar".
 */
export const EQUIPMENT_OPTIONS: { id: EquipmentId; label: string; article: 'a' | 'the' | ''; hint: string }[] = [
  { id: 'floor', label: 'Floor', article: 'the', hint: 'Always available; useful for wrist-specific carryover' },
  { id: 'parallettes', label: 'Parallettes', article: '', hint: 'A different wrist angle and extra clearance for tuck work' },
  { id: 'band', label: 'Resistance band', article: 'a', hint: 'Assisted longer-lever work later on' },
  { id: 'pullup-bar', label: 'Pull-up bar', article: 'a', hint: 'Front lever and pulling work; also anchors assistance bands' },
  { id: 'rings', label: 'Gymnastic rings', article: '', hint: 'Somewhere to hang from — counts as a bar for front lever work' },
  { id: 'dip-bars', label: 'Dip bars', article: '', hint: 'Extra pressing volume' },
  { id: 'box', label: 'Stable box or step', article: 'a', hint: 'A fixed foot support for pike push-ups and supported leans' },
  { id: 'wall', label: 'Clear wall', article: 'a', hint: 'Wall handstands and wall handstand push-ups' },
  {
    id: 'pole',
    label: 'Sturdy pole or stall bars',
    article: 'a',
    hint: 'An upright that takes your whole weight pulling sideways — needed for the human flag',
  },
]

const LABEL: Record<EquipmentId, string> = Object.fromEntries(
  EQUIPMENT_OPTIONS.map((option) => [option.id, option.label.toLowerCase()]),
) as Record<EquipmentId, string>

const PHRASE: Record<EquipmentId, string> = Object.fromEntries(
  EQUIPMENT_OPTIONS.map((option) => [
    option.id,
    option.article ? `${option.article} ${option.label.toLowerCase()}` : option.label.toLowerCase(),
  ]),
) as Record<EquipmentId, string>

/** The bare name of a piece of kit, lower-cased ("pull-up bar", "dip bars"). */
export function equipmentLabel(id: EquipmentId): string {
  return LABEL[id] ?? id
}

/** A piece of kit as the object of a sentence: "a pull-up bar", "dip bars", "a sturdy pole or stall bars". */
export function equipmentPhrase(id: EquipmentId): string {
  return PHRASE[id] ?? id
}

/** One requirement that any of these would meet: "a pull-up bar or gymnastic rings". */
export function kitOptionsPhrase(options: EquipmentId[]): string {
  return options.map(equipmentPhrase).join(' or ')
}

/**
 * Everything still needed, in `missingKit`'s shape — one entry per requirement,
 * each met by any of its options: "a pull-up bar or gymnastic rings, and a
 * clear wall".
 */
export function kitNeedsPhrase(needs: EquipmentId[][]): string {
  return needs.map(kitOptionsPhrase).join(', and ')
}

const PHRASE_BY_LABEL: Record<string, string> = Object.fromEntries(
  EQUIPMENT_OPTIONS.map((option) => [LABEL[option.id], PHRASE[option.id]]),
)

/**
 * The same for a list that arrives already joined from bare names ("pull-up
 * bar and resistance band"), which is how `resolveEquipment` reports what a
 * movement was left out for. Anything that is not a kit name comes back as it
 * was, so text that already carries its articles is left alone.
 */
export function withKitArticles(names: string): string {
  return names
    .split(' and ')
    .map((name) => PHRASE_BY_LABEL[name] ?? name)
    .join(' and ')
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
