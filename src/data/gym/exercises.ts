import type { EquipmentId, SkillId } from '../../types'
import type { GymEquipmentId, Joint, Muscle, Pattern } from './catalog'

/** Anything a location can have: the calisthenics kit or gym equipment. */
export type LocationEquipment = EquipmentId | GymEquipmentId

export type LoadKind = 'barbell' | 'dumbbell' | 'kettlebell' | 'machine' | 'cable' | 'bodyweight'

export interface GymExercise {
  id: string
  name: string
  pattern: Pattern
  /** Full set credit in weekly volume. */
  primary: Muscle[]
  /** Half a set of credit — the convention most volume counts use (CONSENSUS). */
  secondary: Muscle[]
  /** Every inner list must be met by one of its items; empty means nothing is needed. */
  needs: LocationEquipment[][]
  load: LoadKind
  /** Whose weight step applies when the load changes. */
  stepFrom?: GymEquipmentId
  compound: boolean
  /** Joints it loads, for pain reports and the shared fatigue count. */
  stress: Joint[]
  unilateral?: boolean
  explosive?: boolean
  /**
   * Needs coaching to learn safely: never auto-programmed heavy for an athlete
   * under 18, and never as a beginner's first pick.
   */
  technical?: boolean
  /** Skills it builds strength toward. Coaching consensus, not a measured transfer. */
  carries?: SkillId[]
  cue: string
}

type Opts = Partial<Pick<GymExercise, 'stepFrom' | 'unilateral' | 'explosive' | 'technical' | 'carries'>>

function x(
  id: string,
  name: string,
  pattern: Pattern,
  primary: Muscle[],
  secondary: Muscle[],
  needs: LocationEquipment[][],
  load: LoadKind,
  compound: boolean,
  stress: Joint[],
  cue: string,
  opts: Opts = {},
): GymExercise {
  const stepFrom =
    opts.stepFrom ??
    (load === 'barbell'
      ? 'barbell'
      : load === 'dumbbell'
        ? 'dumbbells'
        : load === 'kettlebell'
          ? 'kettlebells'
          : load === 'cable'
            ? 'cable'
            : undefined)
  return { id, name, pattern, primary, secondary, needs, load, compound, stress, cue, ...opts, ...(stepFrom ? { stepFrom } : {}) }
}

export const GYM_EXERCISES: GymExercise[] = [
  // Horizontal press
  x('bench-press', 'Barbell bench press', 'horizontal-press', ['chest', 'front-delts', 'triceps'], ['chest-upper'], [['barbell'], ['bench']], 'barbell', true, ['shoulders', 'elbows', 'wrists'], 'Shoulder blades pinned, bar to the lower chest, press up and slightly back.', { carries: ['planche', 'ninety'] }),
  x('db-bench-press', 'Dumbbell bench press', 'horizontal-press', ['chest', 'front-delts', 'triceps'], [], [['dumbbells'], ['bench', 'incline-bench']], 'dumbbell', true, ['shoulders', 'elbows'], 'Elbows about 45° from the body, a deep stretch at the bottom.', { carries: ['planche'] }),
  x('machine-chest-press', 'Machine chest press', 'horizontal-press', ['chest', 'front-delts', 'triceps'], [], [['chest-press-machine']], 'machine', true, ['shoulders', 'elbows'], 'Seat so the handles start at mid-chest; push without the shoulders rolling forward.', { stepFrom: 'chest-press-machine' }),
  x('smith-bench-press', 'Smith machine bench press', 'horizontal-press', ['chest', 'front-delts', 'triceps'], [], [['smith-machine'], ['bench', 'incline-bench']], 'machine', true, ['shoulders', 'elbows'], 'Bench placed so the bar touches the lower chest.', { stepFrom: 'smith-machine' }),
  x('push-up', 'Push-up', 'horizontal-press', ['chest', 'front-delts', 'triceps'], ['abs'], [], 'bodyweight', true, ['wrists', 'shoulders', 'elbows'], 'A rigid plank from head to heels; chest to a fist from the floor.', { carries: ['planche', 'ninety'] }),
  x('weighted-push-up', 'Weighted push-up', 'horizontal-press', ['chest', 'front-delts', 'triceps'], ['abs'], [['plates', 'band']], 'bodyweight', true, ['wrists', 'shoulders', 'elbows'], 'A plate on the upper back or a band across it; same rigid plank.', { carries: ['planche'] }),
  x('dip', 'Dip', 'dip', ['chest', 'triceps', 'front-delts'], [], [['dip-bars', 'parallettes', 'rings']], 'bodyweight', true, ['shoulders', 'elbows', 'wrists'], 'Lean slightly forward, down until the shoulders are just below the elbows, never forced deeper.', { carries: ['planche', 'ninety'] }),
  x('weighted-dip', 'Weighted dip', 'dip', ['chest', 'triceps', 'front-delts'], [], [['dip-bars'], ['dip-belt']], 'bodyweight', true, ['shoulders', 'elbows'], 'Add weight only once 12 clean bodyweight dips are easy.', { stepFrom: 'dip-belt', carries: ['planche'] }),
  // Incline press
  x('incline-bench-press', 'Incline barbell press', 'incline-press', ['chest-upper', 'chest', 'front-delts'], ['triceps'], [['barbell'], ['incline-bench']], 'barbell', true, ['shoulders', 'elbows', 'wrists'], 'Bench at 30–45°; bar to the upper chest.'),
  x('incline-db-press', 'Incline dumbbell press', 'incline-press', ['chest-upper', 'chest', 'front-delts'], ['triceps'], [['dumbbells'], ['incline-bench']], 'dumbbell', true, ['shoulders', 'elbows'], 'Bench at 30°; press up and slightly in.'),
  x('incline-machine-press', 'Incline machine press', 'incline-press', ['chest-upper', 'chest', 'front-delts'], ['triceps'], [['incline-press-machine']], 'machine', true, ['shoulders', 'elbows'], 'Handles start at the upper chest.', { stepFrom: 'incline-press-machine' }),
  x('smith-incline-press', 'Smith machine incline press', 'incline-press', ['chest-upper', 'chest', 'front-delts'], ['triceps'], [['smith-machine'], ['incline-bench']], 'machine', true, ['shoulders', 'elbows'], 'Bench at 30°, bar path to the upper chest.', { stepFrom: 'smith-machine' }),
  x('low-high-cable-fly', 'Low-to-high cable fly', 'chest-fly', ['chest-upper'], ['front-delts'], [['cable']], 'cable', false, ['shoulders'], 'Handles from hip height up to chin height, a soft bend in the elbows.'),
  // Flies
  x('cable-fly', 'Cable fly', 'chest-fly', ['chest'], ['front-delts'], [['cable']], 'cable', false, ['shoulders'], 'Hug a big tree; feel the stretch, do not chase the weight.'),
  x('pec-deck', 'Pec deck fly', 'chest-fly', ['chest'], [], [['pec-deck']], 'machine', false, ['shoulders'], 'Elbows just below the shoulders, squeeze for a second.', { stepFrom: 'pec-deck' }),
  x('db-fly', 'Dumbbell fly', 'chest-fly', ['chest'], [], [['dumbbells'], ['bench', 'incline-bench']], 'dumbbell', false, ['shoulders'], 'Light, slow, and only as deep as the shoulders allow.'),
  // Overhead press
  x('overhead-press', 'Standing barbell press', 'vertical-press', ['front-delts', 'triceps'], ['side-delts', 'upper-back', 'abs'], [['barbell']], 'barbell', true, ['shoulders', 'elbows', 'lower-back'], 'Glutes tight, bar straight up past the face, head through at the top.', { technical: true, carries: ['handstand'] }),
  x('db-shoulder-press', 'Dumbbell shoulder press', 'vertical-press', ['front-delts', 'triceps'], ['side-delts'], [['dumbbells']], 'dumbbell', true, ['shoulders', 'elbows'], 'Seated or standing, forearms vertical, no arching.', { carries: ['handstand'] }),
  x('machine-shoulder-press', 'Machine shoulder press', 'vertical-press', ['front-delts', 'triceps'], ['side-delts'], [['shoulder-press-machine']], 'machine', true, ['shoulders', 'elbows'], 'Handles start at chin height.', { stepFrom: 'shoulder-press-machine', carries: ['handstand'] }),
  x('pike-push-up', 'Pike push-up', 'vertical-press', ['front-delts', 'triceps'], ['side-delts', 'upper-back'], [], 'bodyweight', true, ['wrists', 'shoulders', 'elbows'], 'Hips high, head travels forward of the hands into a tripod.', { carries: ['handstand'] }),
  // Lateral and rear delts
  x('db-lateral-raise', 'Dumbbell lateral raise', 'lateral-raise', ['side-delts'], ['traps'], [['dumbbells']], 'dumbbell', false, ['shoulders'], 'Lead with the elbows to shoulder height; light enough to pause at the top.'),
  x('cable-lateral-raise', 'Cable lateral raise', 'lateral-raise', ['side-delts'], [], [['cable']], 'cable', false, ['shoulders'], 'Cable from behind or in front, one arm at a time.', { unilateral: true }),
  x('machine-lateral-raise', 'Machine lateral raise', 'lateral-raise', ['side-delts'], [], [['lateral-raise-machine']], 'machine', false, ['shoulders'], 'Pads on the forearms just below the elbows.', { stepFrom: 'lateral-raise-machine' }),
  x('reverse-pec-deck', 'Reverse pec deck', 'rear-delt', ['rear-delts'], ['upper-back'], [['pec-deck']], 'machine', false, ['shoulders'], 'Arms long, sweep wide, do not shrug.', { stepFrom: 'pec-deck' }),
  x('face-pull', 'Face pull', 'rear-delt', ['rear-delts', 'upper-back'], ['traps'], [['cable', 'band']], 'cable', false, ['shoulders'], 'Rope to the eyes, thumbs pointing back at the end.'),
  x('db-rear-delt-fly', 'Dumbbell rear delt fly', 'rear-delt', ['rear-delts'], ['upper-back'], [['dumbbells']], 'dumbbell', false, ['shoulders'], 'Chest on an incline bench or hinged over; sweep wide.'),
  // Triceps
  x('cable-pushdown', 'Cable triceps pushdown', 'triceps', ['triceps'], [], [['cable']], 'cable', false, ['elbows'], 'Elbows pinned at the sides; full lockout each rep.'),
  x('overhead-cable-extension', 'Overhead cable extension', 'triceps', ['triceps-long', 'triceps'], [], [['cable']], 'cable', false, ['elbows', 'shoulders'], 'Face away from the stack, arms overhead — the long head works from the stretch.'),
  x('db-overhead-extension', 'Dumbbell overhead extension', 'triceps', ['triceps-long', 'triceps'], [], [['dumbbells']], 'dumbbell', false, ['elbows', 'shoulders'], 'One dumbbell in both hands, elbows pointing up, a deep stretch.'),
  x('skull-crusher', 'Skull crusher', 'triceps', ['triceps-long', 'triceps'], [], [['ez-bar', 'barbell', 'dumbbells'], ['bench', 'incline-bench']], 'barbell', false, ['elbows'], 'Lower behind the head, not to the forehead.', { stepFrom: 'ez-bar' }),
  x('close-grip-bench', 'Close-grip bench press', 'triceps', ['triceps', 'chest'], ['front-delts'], [['barbell'], ['bench']], 'barbell', true, ['elbows', 'wrists', 'shoulders'], 'Hands just inside shoulder width, elbows tucked.', { carries: ['planche'] }),
  // Biceps
  x('barbell-curl', 'Barbell curl', 'biceps', ['biceps'], ['forearms'], [['barbell', 'ez-bar']], 'barbell', false, ['elbows', 'wrists'], 'No swing: elbows stay by the ribs.'),
  x('db-curl', 'Dumbbell curl', 'biceps', ['biceps'], ['forearms'], [['dumbbells']], 'dumbbell', false, ['elbows'], 'Turn the palm up as it rises.'),
  x('incline-db-curl', 'Incline dumbbell curl', 'biceps', ['biceps'], [], [['dumbbells'], ['incline-bench']], 'dumbbell', false, ['elbows', 'shoulders'], 'Arms hang behind the body for the stretch.'),
  x('hammer-curl', 'Hammer curl', 'biceps', ['biceps', 'forearms'], [], [['dumbbells']], 'dumbbell', false, ['elbows'], 'Thumbs up throughout.'),
  x('cable-curl', 'Cable curl', 'biceps', ['biceps'], ['forearms'], [['cable']], 'cable', false, ['elbows'], 'Constant tension; slow on the way down.'),
  x('preacher-curl', 'Preacher curl', 'biceps', ['biceps'], [], [['preacher-bench'], ['ez-bar', 'dumbbells']], 'barbell', false, ['elbows'], 'Stop just short of a locked elbow at the bottom.', { stepFrom: 'ez-bar' }),
  // Vertical pull
  x('pull-up', 'Pull-up', 'vertical-pull', ['lats', 'biceps', 'upper-back'], ['forearms', 'abs'], [['pullup-bar', 'rings']], 'bodyweight', true, ['elbows', 'shoulders'], 'Dead hang to chin over the bar; ribs down, no kipping.', { carries: ['frontlever', 'flag'] }),
  x('chin-up', 'Chin-up', 'vertical-pull', ['lats', 'biceps'], ['upper-back', 'forearms'], [['pullup-bar', 'rings']], 'bodyweight', true, ['elbows', 'shoulders'], 'Palms toward you, chest to the bar.', { carries: ['frontlever'] }),
  x('weighted-pull-up', 'Weighted pull-up', 'vertical-pull', ['lats', 'biceps', 'upper-back'], ['forearms'], [['pullup-bar'], ['dip-belt']], 'bodyweight', true, ['elbows', 'shoulders'], 'Add weight only once 10 strict pull-ups are easy.', { stepFrom: 'dip-belt', carries: ['frontlever'] }),
  x('lat-pulldown', 'Lat pulldown', 'vertical-pull', ['lats', 'biceps'], ['upper-back'], [['lat-pulldown', 'cable']], 'machine', true, ['elbows', 'shoulders'], 'Bar to the upper chest, elbows down and in.', { stepFrom: 'lat-pulldown', carries: ['frontlever'] }),
  x('assisted-pull-up', 'Assisted pull-up', 'vertical-pull', ['lats', 'biceps'], ['upper-back'], [['assisted-pullup', 'band']], 'machine', true, ['elbows', 'shoulders'], 'Use the least help that still gives clean reps.', { stepFrom: 'assisted-pullup', carries: ['frontlever'] }),
  // Straight-arm pulls (front lever carry-over)
  x('straight-arm-pulldown', 'Straight-arm pulldown', 'straight-arm-pull', ['lats'], ['triceps-long', 'abs'], [['cable', 'band']], 'cable', false, ['shoulders', 'elbows'], 'Arms locked, sweep the bar to the thighs — the front lever’s pulling pattern.', { carries: ['frontlever'] }),
  x('db-pullover', 'Dumbbell pullover', 'straight-arm-pull', ['lats'], ['chest', 'triceps-long'], [['dumbbells'], ['bench', 'incline-bench']], 'dumbbell', false, ['shoulders'], 'Arms nearly straight, ribs down, only as far back as the shoulders allow.', { carries: ['frontlever'] }),
  // Rows
  x('barbell-row', 'Barbell row', 'horizontal-pull', ['upper-back', 'lats', 'rear-delts'], ['biceps', 'lower-back'], [['barbell']], 'barbell', true, ['lower-back', 'elbows'], 'Hinge to about 45°, bar to the lower ribs, back flat.', { technical: true, carries: ['frontlever'] }),
  x('db-row', 'One-arm dumbbell row', 'horizontal-pull', ['lats', 'upper-back'], ['rear-delts', 'biceps'], [['dumbbells'], ['bench', 'incline-bench']], 'dumbbell', true, ['elbows'], 'Pull the elbow toward the hip.', { unilateral: true, carries: ['frontlever'] }),
  x('cable-row', 'Seated cable row', 'horizontal-pull', ['upper-back', 'lats'], ['rear-delts', 'biceps'], [['cable-row', 'cable']], 'machine', true, ['elbows'], 'Chest up, squeeze the shoulder blades, no rocking.', { stepFrom: 'cable-row', carries: ['frontlever'] }),
  x('chest-supported-row', 'Chest-supported row', 'horizontal-pull', ['upper-back', 'rear-delts'], ['lats', 'biceps'], [['row-machine', 'incline-bench']], 'machine', true, ['elbows'], 'Chest on the pad: the back does the work, not the hips.', { stepFrom: 'row-machine', carries: ['frontlever'] }),
  x('inverted-row', 'Inverted row', 'horizontal-pull', ['upper-back', 'lats'], ['rear-delts', 'biceps', 'abs'], [['rings', 'smith-machine', 'pullup-bar']], 'bodyweight', true, ['elbows', 'shoulders'], 'Body straight like a plank, chest to the hands.', { carries: ['frontlever'] }),
  // Squat and single-leg
  x('back-squat', 'Back squat', 'squat', ['quads', 'glutes'], ['adductors', 'lower-back'], [['barbell'], ['squat-rack']], 'barbell', true, ['knees', 'hips', 'lower-back'], 'Brace, sit between the hips, knees track the toes.', { technical: true }),
  x('front-squat', 'Front squat', 'squat', ['quads'], ['glutes', 'upper-back'], [['barbell'], ['squat-rack']], 'barbell', true, ['knees', 'wrists'], 'Elbows high, torso upright.', { technical: true }),
  x('goblet-squat', 'Goblet squat', 'squat', ['quads', 'glutes'], ['adductors'], [['dumbbells', 'kettlebells']], 'dumbbell', true, ['knees', 'hips'], 'Weight at the chest, elbows inside the knees at the bottom.'),
  x('leg-press', 'Leg press', 'squat', ['quads', 'glutes'], ['adductors'], [['leg-press']], 'machine', true, ['knees', 'hips'], 'Lower back stays on the pad; do not lock the knees hard.', { stepFrom: 'leg-press' }),
  x('hack-squat', 'Hack squat', 'squat', ['quads'], ['glutes'], [['hack-squat']], 'machine', true, ['knees'], 'Feet low on the platform for more quads.', { stepFrom: 'hack-squat' }),
  x('smith-squat', 'Smith machine squat', 'squat', ['quads', 'glutes'], [], [['smith-machine']], 'machine', true, ['knees', 'hips'], 'Feet slightly forward of the bar.', { stepFrom: 'smith-machine' }),
  x('bulgarian-split-squat', 'Bulgarian split squat', 'lunge', ['quads', 'glutes'], ['adductors'], [['bench', 'box', 'incline-bench']], 'dumbbell', true, ['knees', 'hips'], 'Back foot on the bench, front shin near vertical; bodyweight first, dumbbells later.', { unilateral: true }),
  x('walking-lunge', 'Walking lunge', 'lunge', ['quads', 'glutes'], ['adductors'], [], 'dumbbell', true, ['knees', 'hips'], 'Long steps, back knee lightly to the floor.', { unilateral: true }),
  x('step-up', 'Step-up', 'lunge', ['quads', 'glutes'], [], [['box', 'bench']], 'dumbbell', true, ['knees'], 'Drive through the front heel; no push from the back leg.', { unilateral: true }),
  x('leg-extension', 'Leg extension', 'knee-extension', ['quads'], [], [['leg-extension']], 'machine', false, ['knees'], 'Pause at the top, slow down.', { stepFrom: 'leg-extension' }),
  // Hinge
  x('deadlift', 'Deadlift', 'hinge', ['glutes', 'hamstrings', 'lower-back'], ['upper-back', 'traps', 'forearms', 'quads'], [['barbell']], 'barbell', true, ['lower-back', 'hips'], 'Bar over mid-foot, brace, push the floor away; back stays flat.', { technical: true }),
  x('trap-bar-deadlift', 'Trap bar deadlift', 'hinge', ['glutes', 'quads', 'hamstrings'], ['lower-back', 'traps', 'forearms'], [['trap-bar']], 'barbell', true, ['lower-back', 'hips', 'knees'], 'Stand in the middle, push the floor away.', { stepFrom: 'trap-bar' }),
  x('romanian-deadlift', 'Romanian deadlift', 'hinge', ['hamstrings', 'glutes'], ['lower-back', 'forearms'], [['barbell', 'dumbbells']], 'barbell', true, ['lower-back', 'hips'], 'Hips back, soft knees, the bar slides down the thighs.'),
  x('hip-thrust', 'Hip thrust', 'hinge', ['glutes'], ['hamstrings'], [['barbell', 'dumbbells', 'hip-thrust-machine'], ['bench', 'hip-thrust-machine']], 'barbell', true, ['hips'], 'Chin tucked, ribs down, squeeze at the top.'),
  x('back-extension', 'Back extension', 'hinge', ['lower-back', 'glutes'], ['hamstrings'], [['back-extension']], 'bodyweight', false, ['lower-back'], 'Hinge at the hips, stop at a straight line.'),
  x('kettlebell-swing', 'Kettlebell swing', 'hinge', ['glutes', 'hamstrings'], ['lower-back', 'abs'], [['kettlebells']], 'kettlebell', true, ['lower-back', 'hips'], 'A hinge, not a squat: snap the hips, the arms just hold on.', { explosive: true }),
  x('nordic-curl', 'Nordic hamstring curl', 'knee-flexion', ['hamstrings'], [], [['floor']], 'bodyweight', false, ['knees'], 'Ankles anchored, lower as slowly as you can, catch with the hands.'),
  x('leg-curl', 'Leg curl', 'knee-flexion', ['hamstrings'], ['calves'], [['leg-curl']], 'machine', false, ['knees'], 'Pause with the heels near the glutes.', { stepFrom: 'leg-curl' }),
  // Calves
  x('standing-calf-raise', 'Standing calf raise', 'calf', ['calves'], [], [['calf-machine', 'smith-machine', 'dumbbells', 'box']], 'machine', false, ['ankles'], 'Full stretch at the bottom, pause at the top.', { stepFrom: 'calf-machine' }),
  // Core
  x('hanging-leg-raise', 'Hanging leg raise', 'core-flexion', ['abs', 'hip-flexors'], ['forearms', 'lats'], [['pullup-bar', 'rings']], 'bodyweight', false, ['shoulders'], 'Curl the pelvis up, no swing.', { carries: ['frontlever', 'ninety'] }),
  x('cable-crunch', 'Cable crunch', 'core-flexion', ['abs'], [], [['cable']], 'cable', false, ['lower-back'], 'Round the spine down; the hips stay still.'),
  x('ab-wheel', 'Ab wheel rollout', 'core-flexion', ['abs'], ['lats'], [['ab-wheel']], 'bodyweight', false, ['lower-back', 'shoulders'], 'Ribs down; only as far as the back stays flat.', { carries: ['planche', 'frontlever'] }),
  x('pallof-press', 'Pallof press', 'core-anti-rotation', ['obliques', 'abs'], [], [['cable', 'band']], 'cable', false, [], 'Press straight out and resist the turn.'),
  // Carries
  x('farmer-carry', 'Farmer carry', 'carry', ['forearms', 'traps'], ['abs', 'obliques'], [['dumbbells', 'kettlebells', 'trap-bar']], 'dumbbell', true, ['wrists'], 'Tall posture, short quick steps.'),
  // Explosive and athletic
  x('box-jump', 'Box jump', 'jump', ['quads', 'glutes'], ['calves'], [['box']], 'bodyweight', true, ['knees', 'ankles'], 'Land softly and step down — the jump up is the rep.', { explosive: true }),
  x('broad-jump', 'Broad jump', 'jump', ['glutes', 'quads'], ['calves', 'hamstrings'], [], 'bodyweight', true, ['knees', 'ankles'], 'Swing the arms, stick the landing, reset fully between reps.', { explosive: true }),
  x('jump-squat', 'Jump squat', 'jump', ['quads', 'glutes'], ['calves'], [], 'bodyweight', true, ['knees', 'ankles'], 'Quarter-depth dip, jump tall, land soft.', { explosive: true }),
  x('pogo-hop', 'Pogo hops', 'jump', ['calves'], ['quads'], [], 'bodyweight', false, ['ankles'], 'Stiff ankles, quick contacts — a sprinter’s drill.', { explosive: true }),
  x('med-ball-chest-throw', 'Medicine ball chest throw', 'throw', ['chest', 'triceps'], ['front-delts', 'abs'], [['medicine-ball'], ['wall', 'floor']], 'bodyweight', true, ['wrists', 'elbows'], 'Throw it through the wall; full rest between throws.', { explosive: true }),
  x('med-ball-slam', 'Medicine ball slam', 'throw', ['lats', 'abs'], ['triceps', 'glutes'], [['medicine-ball']], 'bodyweight', true, ['shoulders', 'lower-back'], 'Reach tall, slam with the whole body.', { explosive: true }),
]

export const GYM_EXERCISE_BY_ID: Record<string, GymExercise> = Object.fromEntries(GYM_EXERCISES.map((e) => [e.id, e]))
