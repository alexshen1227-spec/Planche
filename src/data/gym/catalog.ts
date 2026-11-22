/**
 * The gym side of Fitness Lab: muscles, equipment and movement patterns.
 *
 * Muscles are the unit the planner counts weekly sets in. Two sub-targets sit
 * beside their parents — the upper chest and the triceps' long head — because
 * they are the ones athletes most often name as lagging, and exercises bias
 * them in ways a plain "chest" or "triceps" count cannot show. A set of an
 * incline press counts for the upper chest *and* the chest.
 */

export type Muscle =
  | 'chest'
  | 'chest-upper'
  | 'front-delts'
  | 'side-delts'
  | 'rear-delts'
  | 'triceps'
  | 'triceps-long'
  | 'biceps'
  | 'forearms'
  | 'lats'
  | 'upper-back'
  | 'traps'
  | 'lower-back'
  | 'abs'
  | 'obliques'
  | 'hip-flexors'
  | 'glutes'
  | 'quads'
  | 'hamstrings'
  | 'adductors'
  | 'calves'

export type MuscleGroup = 'chest' | 'shoulders' | 'arms' | 'back' | 'core' | 'legs'

export const MUSCLES: { id: Muscle; label: string; group: MuscleGroup; sub?: Muscle }[] = [
  { id: 'chest', label: 'Chest', group: 'chest' },
  { id: 'chest-upper', label: 'Upper chest', group: 'chest', sub: 'chest' },
  { id: 'front-delts', label: 'Front delts', group: 'shoulders' },
  { id: 'side-delts', label: 'Side delts', group: 'shoulders' },
  { id: 'rear-delts', label: 'Rear delts', group: 'shoulders' },
  { id: 'triceps', label: 'Triceps', group: 'arms' },
  { id: 'triceps-long', label: 'Triceps long head', group: 'arms', sub: 'triceps' },
  { id: 'biceps', label: 'Biceps', group: 'arms' },
  { id: 'forearms', label: 'Forearms and grip', group: 'arms' },
  { id: 'lats', label: 'Lats', group: 'back' },
  { id: 'upper-back', label: 'Upper back', group: 'back' },
  { id: 'traps', label: 'Traps', group: 'back' },
  { id: 'lower-back', label: 'Lower back', group: 'back' },
  { id: 'abs', label: 'Abs', group: 'core' },
  { id: 'obliques', label: 'Obliques', group: 'core' },
  { id: 'hip-flexors', label: 'Hip flexors', group: 'core' },
  { id: 'glutes', label: 'Glutes', group: 'legs' },
  { id: 'quads', label: 'Quads', group: 'legs' },
  { id: 'hamstrings', label: 'Hamstrings', group: 'legs' },
  { id: 'adductors', label: 'Adductors', group: 'legs' },
  { id: 'calves', label: 'Calves', group: 'legs' },
]

export const MUSCLE_BY_ID = Object.fromEntries(MUSCLES.map((m) => [m.id, m])) as Record<Muscle, (typeof MUSCLES)[number]>

export const MUSCLE_GROUPS: { id: MuscleGroup; label: string }[] = [
  { id: 'chest', label: 'Chest' },
  { id: 'shoulders', label: 'Shoulders' },
  { id: 'arms', label: 'Arms' },
  { id: 'back', label: 'Back' },
  { id: 'core', label: 'Core' },
  { id: 'legs', label: 'Legs' },
]

/** Joints and tissues a movement loads — what pain reports and shared fatigue are counted on. */
export type Joint = 'wrists' | 'elbows' | 'shoulders' | 'lower-back' | 'knees' | 'hips' | 'ankles'

export type Pattern =
  | 'horizontal-press'
  | 'incline-press'
  | 'vertical-press'
  | 'dip'
  | 'chest-fly'
  | 'lateral-raise'
  | 'rear-delt'
  | 'triceps'
  | 'biceps'
  | 'vertical-pull'
  | 'horizontal-pull'
  | 'straight-arm-pull'
  | 'squat'
  | 'lunge'
  | 'hinge'
  | 'knee-extension'
  | 'knee-flexion'
  | 'calf'
  | 'core-flexion'
  | 'core-anti-rotation'
  | 'carry'
  | 'jump'
  | 'throw'

export const PATTERN_LABEL: Record<Pattern, string> = {
  'horizontal-press': 'Horizontal press',
  'incline-press': 'Incline press',
  'vertical-press': 'Overhead press',
  dip: 'Dip',
  'chest-fly': 'Chest fly',
  'lateral-raise': 'Lateral raise',
  'rear-delt': 'Rear delt',
  triceps: 'Triceps',
  biceps: 'Biceps',
  'vertical-pull': 'Vertical pull',
  'horizontal-pull': 'Row',
  'straight-arm-pull': 'Straight-arm pull',
  squat: 'Squat',
  lunge: 'Single-leg',
  hinge: 'Hinge',
  'knee-extension': 'Knee extension',
  'knee-flexion': 'Knee flexion',
  calf: 'Calf',
  'core-flexion': 'Core',
  'core-anti-rotation': 'Anti-rotation',
  carry: 'Carry',
  jump: 'Jump',
  throw: 'Throw',
}

/**
 * Gym equipment. A location's list mixes these with the calisthenics kit
 * (`EquipmentId`: floor, parallettes, pull-up bar, rings, dip bars, box, wall,
 * band, pole), so one list says everything that is there.
 */
export type GymEquipmentId =
  | 'barbell'
  | 'squat-rack'
  | 'bench'
  | 'incline-bench'
  | 'dumbbells'
  | 'kettlebells'
  | 'ez-bar'
  | 'trap-bar'
  | 'plates'
  | 'dip-belt'
  | 'cable'
  | 'lat-pulldown'
  | 'cable-row'
  | 'smith-machine'
  | 'chest-press-machine'
  | 'incline-press-machine'
  | 'shoulder-press-machine'
  | 'pec-deck'
  | 'lateral-raise-machine'
  | 'row-machine'
  | 'assisted-pullup'
  | 'leg-press'
  | 'hack-squat'
  | 'leg-extension'
  | 'leg-curl'
  | 'calf-machine'
  | 'hip-thrust-machine'
  | 'back-extension'
  | 'preacher-bench'
  | 'ab-wheel'
  | 'medicine-ball'
  | 'track'

export type Unit = 'kg' | 'lb'
export const LB_PER_KG = 2.2046226218

export interface GymEquipmentDef {
  id: GymEquipmentId
  label: string
  kind: 'free-weight' | 'machine' | 'cable' | 'bench' | 'accessory' | 'space'
  /**
   * Smallest change in load this equipment usually allows, in its own unit:
   * the conventional default, editable per location.
   */
  step?: { kg: number; lb: number }
  /** Whether a top weight matters (dumbbells and kettlebells run out). */
  hasMax?: boolean
}

export const GYM_EQUIPMENT: GymEquipmentDef[] = [
  { id: 'barbell', label: 'Barbell and plates', kind: 'free-weight', step: { kg: 2.5, lb: 5 } },
  { id: 'squat-rack', label: 'Squat rack', kind: 'bench' },
  { id: 'bench', label: 'Flat bench', kind: 'bench' },
  { id: 'incline-bench', label: 'Adjustable bench', kind: 'bench' },
  { id: 'dumbbells', label: 'Dumbbells', kind: 'free-weight', step: { kg: 2, lb: 5 }, hasMax: true },
  { id: 'kettlebells', label: 'Kettlebells', kind: 'free-weight', step: { kg: 4, lb: 10 }, hasMax: true },
  { id: 'ez-bar', label: 'EZ bar', kind: 'free-weight', step: { kg: 2.5, lb: 5 } },
  { id: 'trap-bar', label: 'Trap bar', kind: 'free-weight', step: { kg: 2.5, lb: 5 } },
  { id: 'plates', label: 'Loose plates', kind: 'accessory', step: { kg: 2.5, lb: 5 } },
  { id: 'dip-belt', label: 'Dip belt', kind: 'accessory', step: { kg: 2.5, lb: 5 } },
  { id: 'cable', label: 'Cable station', kind: 'cable', step: { kg: 2.5, lb: 5 } },
  { id: 'lat-pulldown', label: 'Lat pulldown', kind: 'machine', step: { kg: 5, lb: 10 } },
  { id: 'cable-row', label: 'Seated cable row', kind: 'machine', step: { kg: 5, lb: 10 } },
  { id: 'smith-machine', label: 'Smith machine', kind: 'machine', step: { kg: 2.5, lb: 5 } },
  { id: 'chest-press-machine', label: 'Chest press machine', kind: 'machine', step: { kg: 5, lb: 10 } },
  { id: 'incline-press-machine', label: 'Incline press machine', kind: 'machine', step: { kg: 5, lb: 10 } },
  { id: 'shoulder-press-machine', label: 'Shoulder press machine', kind: 'machine', step: { kg: 5, lb: 10 } },
  { id: 'pec-deck', label: 'Pec deck / rear delt machine', kind: 'machine', step: { kg: 5, lb: 10 } },
  { id: 'lateral-raise-machine', label: 'Lateral raise machine', kind: 'machine', step: { kg: 2.5, lb: 5 } },
  { id: 'row-machine', label: 'Chest-supported row machine', kind: 'machine', step: { kg: 5, lb: 10 } },
  { id: 'assisted-pullup', label: 'Assisted pull-up machine', kind: 'machine', step: { kg: 5, lb: 10 } },
  { id: 'leg-press', label: 'Leg press', kind: 'machine', step: { kg: 5, lb: 10 } },
  { id: 'hack-squat', label: 'Hack squat', kind: 'machine', step: { kg: 5, lb: 10 } },
  { id: 'leg-extension', label: 'Leg extension', kind: 'machine', step: { kg: 5, lb: 10 } },
  { id: 'leg-curl', label: 'Leg curl', kind: 'machine', step: { kg: 5, lb: 10 } },
  { id: 'calf-machine', label: 'Calf raise machine', kind: 'machine', step: { kg: 5, lb: 10 } },
  { id: 'hip-thrust-machine', label: 'Hip thrust machine', kind: 'machine', step: { kg: 5, lb: 10 } },
  { id: 'back-extension', label: 'Back extension bench', kind: 'bench' },
  { id: 'preacher-bench', label: 'Preacher bench', kind: 'bench' },
  { id: 'ab-wheel', label: 'Ab wheel', kind: 'accessory' },
  { id: 'medicine-ball', label: 'Medicine ball', kind: 'accessory' },
  { id: 'track', label: 'Track or open space to sprint', kind: 'space' },
]

export const GYM_EQUIPMENT_BY_ID = Object.fromEntries(GYM_EQUIPMENT.map((e) => [e.id, e])) as Record<
  GymEquipmentId,
  GymEquipmentDef
>
