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
  /** Same movement with another implement. Its loads and records have their own id. */
  variantOf?: string
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
  /**
   * Intensity tier of speed and power work (CONSENSUS — a coaching ladder, not
   * a measured scale): low = mechanics and gentle landings, medium = submaximal
   * jumps, throws and sprint work, high = maximal or high-impact work.
   */
  tier?: IntensityTier
  /** Order inside its domain, 1 = first to learn. The builder moves up the ladder in this order. */
  rung?: number
  /** What a set is counted in when it is not a load: foot contacts, or runs and throws. */
  count?: 'reps' | 'contacts' | 'seconds'
  /** Length of one run, in metres, for sprints and drills. */
  distanceM?: number
  /** A maximal-effort run: always gated like a high tier, whatever its listed tier. */
  maximal?: boolean
  /** How the work is dosed, when sets of reps at a weight is not the unit. */
  dose?: { sets: number; range: [number, number]; restSec: number; rpe: number; workSec?: number }
  /**
   * The logged weight is help, not load (an assisted pull-up machine): less
   * is harder, so progress takes weight off, and it never gives an estimated
   * max or a heaviest-lift record.
   */
  assisted?: boolean
}

export type IntensityTier = 'low' | 'medium' | 'high'
export const TIER_ORDER: IntensityTier[] = ['low', 'medium', 'high']

/** The three progressions speed and power work is gated in. */
export type AthleticDomain = 'jump' | 'sprint' | 'throw'

/** Which progression an exercise belongs to, or null for ordinary strength work. */
export function athleticDomain(ex: Pick<GymExercise, 'pattern' | 'tier'>): AthleticDomain | null {
  if (!ex.tier) return null
  if (ex.pattern === 'jump') return 'jump'
  if (ex.pattern === 'sprint' || ex.pattern === 'drill') return 'sprint'
  if (ex.pattern === 'throw') return 'throw'
  return null
}

type Opts = Partial<
  Pick<GymExercise, 'stepFrom' | 'variantOf' | 'unilateral' | 'explosive' | 'technical' | 'carries' | 'tier' | 'rung' | 'count' | 'distanceM' | 'maximal' | 'dose' | 'assisted'>
>

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

const BASE_EXERCISES: GymExercise[] = [
  // Horizontal press
  // The barbell bench and incline press are `technical`: alone under a bar a lifter needs a spotter or
  // safeties, so under 18 dumbbells or a machine come first unless the athlete loves the barbell.
  x('bench-press', 'Barbell bench press', 'horizontal-press', ['chest', 'front-delts', 'triceps'], ['chest-upper'], [['barbell'], ['bench']], 'barbell', true, ['shoulders', 'elbows', 'wrists'], 'Shoulder blades pinned, bar to the lower chest, press up and slightly back.', { technical: true, carries: ['planche', 'ninety'] }),
  x('db-bench-press', 'Dumbbell bench press', 'horizontal-press', ['chest', 'front-delts', 'triceps'], [], [['dumbbells'], ['bench', 'incline-bench']], 'dumbbell', true, ['shoulders', 'elbows', 'wrists'], 'Elbows about 45° from the body, a deep stretch at the bottom.', { carries: ['planche'] }),
  x('machine-chest-press', 'Machine chest press', 'horizontal-press', ['chest', 'front-delts', 'triceps'], [], [['chest-press-machine']], 'machine', true, ['shoulders', 'elbows'], 'Seat so the handles start at mid-chest; push without the shoulders rolling forward.', { stepFrom: 'chest-press-machine' }),
  x('smith-bench-press', 'Smith machine bench press', 'horizontal-press', ['chest', 'front-delts', 'triceps'], [], [['smith-machine'], ['bench', 'incline-bench']], 'machine', true, ['shoulders', 'elbows'], 'Bench placed so the bar touches the lower chest.', { stepFrom: 'smith-machine' }),
  x('push-up', 'Push-up', 'horizontal-press', ['chest', 'front-delts', 'triceps'], ['abs'], [], 'bodyweight', true, ['wrists', 'shoulders', 'elbows'], 'A rigid plank from head to heels; chest to a fist from the floor.', { carries: ['planche', 'ninety'] }),
  x('weighted-push-up', 'Weighted push-up', 'horizontal-press', ['chest', 'front-delts', 'triceps'], ['abs'], [['plates']], 'bodyweight', true, ['wrists', 'shoulders', 'elbows'], 'Use a secure plate on the upper back and keep the same rigid plank. Log the added weight.', { stepFrom: 'plates', carries: ['planche'] }),
  x('band-resisted-push-up', 'Band-resisted push-up', 'horizontal-press', ['chest', 'front-delts', 'triceps'], ['abs'], [['band']], 'bodyweight', true, ['wrists', 'shoulders', 'elbows'], 'Run the band across the upper back and anchor it under your palms. Use the same band to compare reps.', { carries: ['planche'] }),
  x('dip', 'Dip', 'dip', ['chest', 'triceps', 'front-delts'], [], [['dip-bars', 'parallettes', 'rings']], 'bodyweight', true, ['shoulders', 'elbows', 'wrists'], 'Lean slightly forward, down until the shoulders are just below the elbows, never forced deeper.', { carries: ['planche', 'ninety'] }),
  x('weighted-dip', 'Weighted dip', 'dip', ['chest', 'triceps', 'front-delts'], [], [['dip-bars'], ['dip-belt']], 'bodyweight', true, ['shoulders', 'elbows', 'wrists'], 'Add weight only once 12 clean bodyweight dips are easy.', { stepFrom: 'dip-belt', carries: ['planche'] }),
  // Incline press
  x('incline-bench-press', 'Incline barbell press', 'incline-press', ['chest-upper', 'chest', 'front-delts'], ['triceps'], [['barbell'], ['incline-bench']], 'barbell', true, ['shoulders', 'elbows', 'wrists'], 'Bench at 30–45°; bar to the upper chest.', { technical: true }),
  x('incline-db-press', 'Incline dumbbell press', 'incline-press', ['chest-upper', 'chest', 'front-delts'], ['triceps'], [['dumbbells'], ['incline-bench']], 'dumbbell', true, ['shoulders', 'elbows', 'wrists'], 'Bench at 30°; press up and slightly in.'),
  x('incline-machine-press', 'Incline machine press', 'incline-press', ['chest-upper', 'chest', 'front-delts'], ['triceps'], [['incline-press-machine']], 'machine', true, ['shoulders', 'elbows'], 'Handles start at the upper chest.', { stepFrom: 'incline-press-machine' }),
  x('smith-incline-press', 'Smith machine incline press', 'incline-press', ['chest-upper', 'chest', 'front-delts'], ['triceps'], [['smith-machine'], ['incline-bench']], 'machine', true, ['shoulders', 'elbows'], 'Bench at 30°, bar path to the upper chest.', { stepFrom: 'smith-machine' }),
  x('low-high-cable-fly', 'Low-to-high cable fly', 'chest-fly', ['chest-upper'], ['front-delts'], [['cable']], 'cable', false, ['shoulders'], 'Handles from hip height up to chin height, a soft bend in the elbows.'),
  // Flies
  x('cable-fly', 'Cable fly', 'chest-fly', ['chest'], ['front-delts'], [['cable']], 'cable', false, ['shoulders'], 'Hug a big tree; feel the stretch, do not chase the weight.'),
  x('pec-deck', 'Pec deck fly', 'chest-fly', ['chest'], [], [['pec-deck']], 'machine', false, ['shoulders'], 'Elbows just below the shoulders, squeeze for a second.', { stepFrom: 'pec-deck' }),
  x('db-fly', 'Dumbbell fly', 'chest-fly', ['chest'], [], [['dumbbells'], ['bench', 'incline-bench']], 'dumbbell', false, ['shoulders', 'wrists'], 'Light, slow, and only as deep as the shoulders allow.'),
  // Overhead press
  x('overhead-press', 'Standing barbell press', 'vertical-press', ['front-delts', 'triceps'], ['side-delts', 'upper-back', 'abs'], [['barbell']], 'barbell', true, ['shoulders', 'elbows', 'lower-back', 'wrists'], 'Glutes tight, bar straight up past the face, head through at the top.', { technical: true, carries: ['handstand'] }),
  x('db-shoulder-press', 'Dumbbell shoulder press', 'vertical-press', ['front-delts', 'triceps'], ['side-delts'], [['dumbbells']], 'dumbbell', true, ['shoulders', 'elbows', 'wrists'], 'Seated or standing, forearms vertical, no arching.', { carries: ['handstand'] }),
  x('machine-shoulder-press', 'Machine shoulder press', 'vertical-press', ['front-delts', 'triceps'], ['side-delts'], [['shoulder-press-machine']], 'machine', true, ['shoulders', 'elbows'], 'Handles start at chin height.', { stepFrom: 'shoulder-press-machine', carries: ['handstand'] }),
  x('pike-push-up', 'Pike push-up', 'vertical-press', ['front-delts', 'triceps'], ['side-delts', 'upper-back'], [], 'bodyweight', true, ['wrists', 'shoulders', 'elbows'], 'Hips high, head travels forward of the hands into a tripod.', { carries: ['handstand'] }),
  // Lateral and rear delts
  x('db-lateral-raise', 'Dumbbell lateral raise', 'lateral-raise', ['side-delts'], ['traps'], [['dumbbells']], 'dumbbell', false, ['shoulders'], 'Lead with the elbows to shoulder height; light enough to pause at the top.'),
  x('cable-lateral-raise', 'Cable lateral raise', 'lateral-raise', ['side-delts'], [], [['cable']], 'cable', false, ['shoulders'], 'Cable from behind or in front, one arm at a time.', { unilateral: true }),
  x('machine-lateral-raise', 'Machine lateral raise', 'lateral-raise', ['side-delts'], [], [['lateral-raise-machine']], 'machine', false, ['shoulders'], 'Pads on the forearms just below the elbows.', { stepFrom: 'lateral-raise-machine' }),
  x('seated-db-lateral-raise', 'Seated dumbbell lateral raise', 'lateral-raise', ['side-delts'], ['traps'], [['dumbbells'], ['bench', 'incline-bench']], 'dumbbell', false, ['shoulders'], 'Sit on the bench with the weights by your sides. Keep your legs relaxed and lift the elbows to shoulder height without swinging.', { variantOf: 'db-lateral-raise' }),
  x('reverse-pec-deck', 'Reverse pec deck', 'rear-delt', ['rear-delts'], ['upper-back'], [['pec-deck']], 'machine', false, ['shoulders'], 'Arms long, sweep wide, do not shrug.', { stepFrom: 'pec-deck' }),
  x('face-pull', 'Face pull', 'rear-delt', ['rear-delts', 'upper-back'], ['traps'], [['cable']], 'cable', false, ['shoulders'], 'Rope to the eyes, thumbs pointing back at the end.'),
  x('db-rear-delt-fly', 'Dumbbell rear delt fly', 'rear-delt', ['rear-delts'], ['upper-back'], [['dumbbells']], 'dumbbell', false, ['shoulders'], 'Chest on an incline bench or hinged over; sweep wide.'),
  // Triceps
  x('cable-pushdown', 'Cable triceps pushdown', 'triceps', ['triceps'], [], [['cable']], 'cable', false, ['elbows'], 'Elbows pinned at the sides; full lockout each rep.'),
  x('overhead-cable-extension', 'Overhead cable extension', 'triceps', ['triceps-long', 'triceps'], [], [['cable']], 'cable', false, ['elbows', 'shoulders'], 'Face away from the stack, arms overhead — the long head works from the stretch.'),
  x('db-overhead-extension', 'Dumbbell overhead extension', 'triceps', ['triceps-long', 'triceps'], [], [['dumbbells']], 'dumbbell', false, ['elbows', 'shoulders', 'wrists'], 'One dumbbell in both hands, elbows pointing up, a deep stretch.'),
  x('skull-crusher', 'Skull crusher', 'triceps', ['triceps-long', 'triceps'], [], [['ez-bar'], ['bench', 'incline-bench']], 'barbell', false, ['elbows', 'wrists'], 'Lower behind the head, not to the forehead.', { stepFrom: 'ez-bar' }),
  x('close-grip-bench', 'Close-grip bench press', 'triceps', ['triceps', 'chest'], ['front-delts'], [['barbell'], ['bench']], 'barbell', true, ['elbows', 'wrists', 'shoulders'], 'Hands just inside shoulder width, elbows tucked.', { carries: ['planche'] }),
  // Biceps
  x('barbell-curl', 'Barbell curl', 'biceps', ['biceps'], ['forearms'], [['barbell']], 'barbell', false, ['elbows', 'wrists'], 'No swing: elbows stay by the ribs.'),
  x('db-curl', 'Dumbbell curl', 'biceps', ['biceps'], ['forearms'], [['dumbbells']], 'dumbbell', false, ['elbows', 'wrists'], 'Turn the palm up as it rises.'),
  x('incline-db-curl', 'Incline dumbbell curl', 'biceps', ['biceps'], [], [['dumbbells'], ['incline-bench']], 'dumbbell', false, ['elbows', 'shoulders', 'wrists'], 'Arms hang behind the body for the stretch.'),
  x('hammer-curl', 'Hammer curl', 'biceps', ['biceps', 'forearms'], [], [['dumbbells']], 'dumbbell', false, ['elbows', 'wrists'], 'Thumbs up throughout.'),
  x('cable-curl', 'Cable curl', 'biceps', ['biceps'], ['forearms'], [['cable']], 'cable', false, ['elbows', 'wrists'], 'Constant tension; slow on the way down.'),
  x('preacher-curl', 'Preacher curl', 'biceps', ['biceps'], [], [['preacher-bench'], ['ez-bar']], 'barbell', false, ['elbows', 'wrists'], 'Stop just short of a locked elbow at the bottom.', { stepFrom: 'ez-bar' }),
  // Vertical pull
  x('pull-up', 'Pull-up', 'vertical-pull', ['lats', 'biceps', 'upper-back'], ['forearms', 'abs'], [['pullup-bar', 'rings']], 'bodyweight', true, ['elbows', 'shoulders'], 'Dead hang to chin over the bar; ribs down, no kipping.', { carries: ['frontlever', 'flag'] }),
  x('chin-up', 'Chin-up', 'vertical-pull', ['lats', 'biceps'], ['upper-back', 'forearms'], [['pullup-bar', 'rings']], 'bodyweight', true, ['elbows', 'shoulders'], 'Palms toward you, chest to the bar.', { carries: ['frontlever'] }),
  x('weighted-pull-up', 'Weighted pull-up', 'vertical-pull', ['lats', 'biceps', 'upper-back'], ['forearms'], [['pullup-bar'], ['dip-belt']], 'bodyweight', true, ['elbows', 'shoulders'], 'Add weight only once 10 strict pull-ups are easy.', { stepFrom: 'dip-belt', carries: ['frontlever'] }),
  x('lat-pulldown', 'Lat pulldown', 'vertical-pull', ['lats', 'biceps'], ['upper-back'], [['lat-pulldown']], 'machine', true, ['elbows', 'shoulders'], 'Bar to the upper chest, elbows down and in.', { stepFrom: 'lat-pulldown', carries: ['frontlever'] }),
  x('assisted-pull-up', 'Assisted pull-up', 'vertical-pull', ['lats', 'biceps'], ['upper-back'], [['assisted-pullup']], 'machine', true, ['elbows', 'shoulders'], 'Set the machine to enough assistance for controlled reps. Log the weight that helps you.', { stepFrom: 'assisted-pullup', carries: ['frontlever'], assisted: true }),
  x('band-assisted-pull-up', 'Band-assisted pull-up', 'vertical-pull', ['lats', 'biceps'], ['upper-back'], [['band'], ['pullup-bar']], 'bodyweight', true, ['elbows', 'shoulders'], 'Secure the band to the bar. Use enough assistance for clean reps and note which band you used.', { carries: ['frontlever'] }),
  // Straight-arm pulls (front lever carry-over)
  x('straight-arm-pulldown', 'Straight-arm pulldown', 'straight-arm-pull', ['lats'], ['triceps-long', 'abs'], [['cable']], 'cable', false, ['shoulders', 'elbows'], 'Arms locked, sweep the bar to the thighs — the front lever’s pulling pattern.', { carries: ['frontlever'] }),
  // Joint tags (INFERENCE, from the mechanics, not from a trial): a loaded wrist curl works the forearm flexors, which
  // attach at the inner elbow, and a near-straight-arm pullover holds the elbow under load in a lengthened position.
  // Both are tagged elbows, so a reported elbow keeps them out. A reverse wrist curl is not in the catalogue.
  x('db-pullover', 'Dumbbell pullover', 'straight-arm-pull', ['lats'], ['chest', 'triceps-long'], [['dumbbells'], ['bench', 'incline-bench']], 'dumbbell', false, ['shoulders', 'elbows'], 'Arms nearly straight, ribs down, only as far back as the shoulders allow.', { carries: ['frontlever'] }),
  // Rows
  x('barbell-row', 'Barbell row', 'horizontal-pull', ['upper-back', 'lats', 'rear-delts'], ['biceps', 'lower-back'], [['barbell']], 'barbell', true, ['lower-back', 'elbows'], 'Hinge to about 45°, bar to the lower ribs, back flat.', { technical: true, carries: ['frontlever'] }),
  x('db-row', 'One-arm dumbbell row', 'horizontal-pull', ['lats', 'upper-back'], ['rear-delts', 'biceps'], [['dumbbells'], ['bench', 'incline-bench']], 'dumbbell', true, ['elbows', 'wrists'], 'Pull the elbow toward the hip.', { unilateral: true, carries: ['frontlever'] }),
  x('cable-row', 'Seated cable row', 'horizontal-pull', ['upper-back', 'lats'], ['rear-delts', 'biceps'], [['cable-row']], 'machine', true, ['elbows'], 'Chest up, squeeze the shoulder blades, no rocking.', { stepFrom: 'cable-row', carries: ['frontlever'] }),
  x('chest-supported-row', 'Chest-supported row', 'horizontal-pull', ['upper-back', 'rear-delts'], ['lats', 'biceps'], [['row-machine']], 'machine', true, ['elbows'], 'Chest on the pad: the back does the work, not the hips.', { stepFrom: 'row-machine', carries: ['frontlever'] }),
  x('inverted-row', 'Inverted row', 'horizontal-pull', ['upper-back', 'lats'], ['rear-delts', 'biceps', 'abs'], [['rings', 'smith-machine']], 'bodyweight', true, ['elbows', 'shoulders'], 'Set the handles or bar low enough to row. Stand more upright for easier reps.', { carries: ['frontlever'] }),
  // Squat and single-leg
  x('back-squat', 'Back squat', 'squat', ['quads', 'glutes'], ['adductors', 'lower-back'], [['barbell'], ['squat-rack']], 'barbell', true, ['knees', 'hips', 'lower-back'], 'Brace, sit between the hips, knees track the toes.', { technical: true }),
  x('front-squat', 'Front squat', 'squat', ['quads'], ['glutes', 'upper-back'], [['barbell'], ['squat-rack']], 'barbell', true, ['knees', 'wrists'], 'Elbows high, torso upright.', { technical: true }),
  x('goblet-squat', 'Goblet squat', 'squat', ['quads', 'glutes'], ['adductors'], [['dumbbells']], 'dumbbell', true, ['knees', 'hips'], 'Weight at the chest, elbows inside the knees at the bottom.'),
  x('leg-press', 'Leg press', 'squat', ['quads', 'glutes'], ['adductors'], [['leg-press']], 'machine', true, ['knees', 'hips'], 'Lower back stays on the pad; do not lock the knees hard.', { stepFrom: 'leg-press' }),
  x('hack-squat', 'Hack squat', 'squat', ['quads'], ['glutes'], [['hack-squat']], 'machine', true, ['knees'], 'Feet low on the platform for more quads.', { stepFrom: 'hack-squat' }),
  x('smith-squat', 'Smith machine squat', 'squat', ['quads', 'glutes'], [], [['smith-machine']], 'machine', true, ['knees', 'hips'], 'Feet slightly forward of the bar.', { stepFrom: 'smith-machine' }),
  x('bulgarian-split-squat', 'Bulgarian split squat', 'lunge', ['quads', 'glutes'], ['adductors'], [['bench', 'box', 'incline-bench']], 'bodyweight', true, ['knees', 'hips'], 'Rest the back foot on a bench. Start at bodyweight and add dumbbells when the reps are controlled.', { unilateral: true, stepFrom: 'dumbbells' }),
  x('walking-lunge', 'Walking lunge', 'lunge', ['quads', 'glutes'], ['adductors'], [], 'bodyweight', true, ['knees', 'hips'], 'Take long steps and lower the back knee gently. Start at bodyweight.', { unilateral: true, stepFrom: 'dumbbells' }),
  x('step-up', 'Step-up', 'lunge', ['quads', 'glutes'], [], [['box', 'bench']], 'bodyweight', true, ['knees'], 'Drive through the front heel and keep the push from the back leg minimal.', { unilateral: true, stepFrom: 'dumbbells' }),
  x('leg-extension', 'Leg extension', 'knee-extension', ['quads'], [], [['leg-extension']], 'machine', false, ['knees'], 'Pause at the top, slow down.', { stepFrom: 'leg-extension' }),
  // Hinge
  x('deadlift', 'Deadlift', 'hinge', ['glutes', 'hamstrings', 'lower-back'], ['upper-back', 'traps', 'forearms', 'quads'], [['barbell']], 'barbell', true, ['lower-back', 'hips'], 'Bar over mid-foot, brace, push the floor away; back stays flat.', { technical: true }),
  x('trap-bar-deadlift', 'Trap bar deadlift', 'hinge', ['glutes', 'quads', 'hamstrings'], ['lower-back', 'traps', 'forearms'], [['trap-bar']], 'barbell', true, ['lower-back', 'hips', 'knees'], 'Stand in the middle, push the floor away.', { stepFrom: 'trap-bar' }),
  x('romanian-deadlift', 'Romanian deadlift', 'hinge', ['hamstrings', 'glutes'], ['lower-back', 'forearms'], [['barbell']], 'barbell', true, ['lower-back', 'hips'], 'Hips back, soft knees, the bar slides down the thighs.'),
  x('hip-thrust', 'Hip thrust', 'hinge', ['glutes'], ['hamstrings'], [['barbell'], ['bench', 'incline-bench']], 'barbell', true, ['hips'], 'Chin tucked, ribs down, squeeze at the top.'),
  x('back-extension', 'Back extension', 'hinge', ['lower-back', 'glutes'], ['hamstrings'], [['back-extension']], 'bodyweight', false, ['lower-back'], 'Hinge at the hips, stop at a straight line.'),
  x('kettlebell-swing', 'Kettlebell swing', 'hinge', ['glutes', 'hamstrings'], ['lower-back', 'abs'], [['kettlebells']], 'kettlebell', true, ['lower-back', 'hips'], 'A hinge, not a squat: snap the hips, the arms just hold on.', { explosive: true }),
  x('nordic-curl', 'Nordic hamstring curl', 'knee-flexion', ['hamstrings'], [], [['nordic-anchor', 'ghd']], 'bodyweight', false, ['knees'], 'Ankles anchored, lower as slowly as you can, catch with the hands.', { technical: true }),
  x('leg-curl', 'Leg curl', 'knee-flexion', ['hamstrings'], ['calves'], [['leg-curl']], 'machine', false, ['knees'], 'Pause with the heels near the glutes.', { stepFrom: 'leg-curl' }),
  // Calves
  x('standing-calf-raise', 'Standing calf raise', 'calf', ['calves'], [], [['calf-machine']], 'machine', false, ['ankles'], 'Full stretch at the bottom, pause at the top.', { stepFrom: 'calf-machine' }),
  // Core
  x('hanging-leg-raise', 'Hanging leg raise', 'core-flexion', ['abs', 'hip-flexors'], ['forearms', 'lats'], [['pullup-bar', 'rings']], 'bodyweight', false, ['shoulders'], 'Curl the pelvis up, no swing.', { carries: ['frontlever', 'ninety'] }),
  x('cable-crunch', 'Cable crunch', 'core-flexion', ['abs'], [], [['cable']], 'cable', false, ['lower-back'], 'Round the spine down; the hips stay still.'),
  x('ab-wheel', 'Ab wheel rollout', 'core-flexion', ['abs'], ['lats'], [['ab-wheel']], 'bodyweight', false, ['lower-back', 'shoulders'], 'Ribs down; only as far as the back stays flat.', { carries: ['planche', 'frontlever'] }),
  x('pallof-press', 'Pallof press', 'core-anti-rotation', ['obliques', 'abs'], [], [['cable']], 'cable', false, [], 'Press straight out and resist the turn.'),
  // Carries
  x('farmer-carry', 'Farmer carry', 'carry', ['forearms', 'traps'], ['abs', 'obliques'], [['dumbbells']], 'dumbbell', true, ['wrists'], 'Tall posture, short quick steps.'),
  // ---- More presses ----
  x('db-floor-press', 'Dumbbell floor press', 'horizontal-press', ['chest', 'triceps', 'front-delts'], [], [['dumbbells']], 'dumbbell', true, ['shoulders', 'elbows', 'wrists'], 'Lie on the floor; the upper arms stop on the ground each rep, then press.', { carries: ['planche'] }),
  x('barbell-floor-press', 'Barbell floor press', 'horizontal-press', ['triceps', 'chest', 'front-delts'], [], [['barbell'], ['squat-rack']], 'barbell', true, ['shoulders', 'elbows', 'wrists'], 'Triceps touch the floor, pause, press; a shoulder-friendly bench press.'),
  x('cable-chest-press', 'Cable chest press', 'horizontal-press', ['chest', 'front-delts', 'triceps'], [], [['cable']], 'cable', true, ['shoulders', 'elbows'], 'Staggered stance, press forward at mid-chest height without leaning on the stack.'),
  x('ring-push-up', 'Ring push-up', 'horizontal-press', ['chest', 'front-delts', 'triceps'], ['abs', 'upper-back'], [['rings']], 'bodyweight', true, ['shoulders', 'elbows', 'wrists'], 'Rings stay still and turn slightly out at the top; plank body throughout.', { technical: true, carries: ['planche', 'ninety'] }),
  x('archer-push-up', 'Archer push-up', 'horizontal-press', ['chest', 'front-delts', 'triceps'], ['abs'], [], 'bodyweight', true, ['wrists', 'shoulders', 'elbows'], 'Wide hands; lower over one arm while the other stays long, then switch sides.', { unilateral: true, carries: ['planche'] }),
  x('pseudo-planche-push-up', 'Pseudo planche push-up', 'horizontal-press', ['front-delts', 'chest', 'triceps'], ['abs', 'biceps'], [], 'bodyweight', true, ['wrists', 'shoulders', 'elbows'], 'Hands by the hips, fingers turned out, lean the shoulders well past the hands and stay there.', { carries: ['planche'] }),
  x('decline-push-up', 'Feet-elevated push-up', 'incline-press', ['chest-upper', 'front-delts', 'triceps'], ['chest', 'abs'], [['box', 'bench', 'incline-bench']], 'bodyweight', true, ['wrists', 'shoulders', 'elbows'], 'Feet on a box, body one plank; the higher the feet, the more the shoulders work.', { carries: ['planche', 'handstand'] }),
  x('incline-push-up', 'Hands-elevated push-up', 'horizontal-press', ['chest', 'triceps', 'front-delts'], ['abs'], [['box', 'bench', 'incline-bench', 'wall']], 'bodyweight', true, ['wrists', 'shoulders', 'elbows'], 'Hands on a bench or wall: the way to earn clean push-ups before the floor ones.'),
  x('kneeling-push-up', 'Kneeling push-up', 'horizontal-press', ['chest', 'triceps', 'front-delts'], ['abs'], [], 'bodyweight', true, ['wrists', 'elbows', 'shoulders'], 'Keep a straight line from knees to shoulders. Lower your chest between your hands and press the floor away.'),
  x('landmine-press', 'Landmine press', 'incline-press', ['front-delts', 'chest-upper', 'triceps'], ['abs', 'upper-back'], [['barbell'], ['landmine']], 'barbell', true, ['shoulders', 'elbows', 'wrists'], 'Bar at the shoulder, press up and forward along its arc; a kind angle for the shoulder.', { stepFrom: 'barbell' }),
  x('barbell-incline-close-grip', 'Close-grip incline press', 'incline-press', ['chest-upper', 'triceps'], ['front-delts'], [['barbell'], ['incline-bench']], 'barbell', true, ['elbows', 'wrists', 'shoulders'], 'Hands just inside shoulder width on a low incline; bar to the upper chest.'),
  x('cable-incline-press', 'Cable incline press', 'incline-press', ['chest-upper', 'front-delts'], ['triceps'], [['cable'], ['incline-bench']], 'cable', true, ['shoulders', 'elbows'], 'Bench at 30°, cables from low pulleys; press up and slightly in.'),
  // ---- Dips ----
  x('ring-dip', 'Ring dip', 'dip', ['chest', 'triceps', 'front-delts'], ['abs', 'upper-back'], [['rings']], 'bodyweight', true, ['shoulders', 'elbows', 'wrists'], 'Rings turned out at the top; learn it from a strong parallel-bar dip first.', { technical: true, carries: ['planche', 'ninety'] }),
  x('bench-dip', 'Bench dip', 'dip', ['triceps'], ['chest', 'front-delts'], [['bench', 'box', 'incline-bench']], 'bodyweight', false, ['shoulders', 'elbows', 'wrists'], 'Hands behind you on the bench; go only as deep as the front of the shoulder stays comfortable.'),
  x('straight-bar-dip', 'Straight-bar dip', 'dip', ['chest', 'triceps', 'front-delts'], ['abs'], [['pullup-bar']], 'bodyweight', true, ['shoulders', 'elbows', 'wrists'], 'Hands on top of the bar, lean forward, down until the shoulders pass the elbows slightly.', { technical: true, carries: ['ninety'] }),
  x('korean-dip-assisted', 'Band-assisted dip', 'dip', ['chest', 'triceps'], ['front-delts'], [['dip-bars', 'parallettes'], ['band']], 'bodyweight', true, ['shoulders', 'elbows', 'wrists'], 'A band under the knees takes load off the bottom: shorten it as the dips get easy.', { carries: ['planche'] }),
  // ---- Flies ----
  x('incline-db-fly', 'Incline dumbbell fly', 'chest-fly', ['chest-upper', 'chest'], ['front-delts'], [['dumbbells'], ['incline-bench']], 'dumbbell', false, ['shoulders', 'wrists'], 'Bench at 30°; a wide arc to a comfortable stretch, then squeeze back up.'),
  x('high-low-cable-fly', 'High-to-low cable fly', 'chest-fly', ['chest'], ['front-delts'], [['cable']], 'cable', false, ['shoulders'], 'Pulleys high, hands sweep down to the hips; the lower chest works.'),
  x('ring-fly', 'Ring fly', 'chest-fly', ['chest'], ['front-delts', 'abs'], [['rings']], 'bodyweight', false, ['shoulders', 'elbows', 'wrists'], 'Rings low, body in a plank, arms wide with a soft bend; a hard move, start with a steep angle.', { technical: true, carries: ['planche'] }),
  // ---- Overhead press ----
  x('arnold-press', 'Arnold press', 'vertical-press', ['front-delts', 'side-delts'], ['triceps'], [['dumbbells']], 'dumbbell', true, ['shoulders', 'elbows', 'wrists'], 'Palms in at the chest, rotate out as you press; slow and light.'),
  x('z-press', 'Dumbbell Z press', 'vertical-press', ['front-delts', 'triceps'], ['side-delts', 'abs', 'upper-back'], [['dumbbells']], 'dumbbell', true, ['shoulders', 'elbows', 'lower-back', 'wrists'], 'Sit on the floor, legs straight out; no leg drive, no leaning back, so the shoulders and trunk do it all.', { carries: ['handstand'] }),
  x('barbell-z-press', 'Barbell Z press', 'vertical-press', ['front-delts', 'triceps'], ['side-delts', 'abs', 'upper-back'], [['barbell'], ['squat-rack']], 'barbell', true, ['shoulders', 'elbows', 'lower-back', 'wrists'], 'Seated on the floor with the bar from low pins; brace hard and press straight up.', { technical: true, carries: ['handstand'] }),
  x('seated-db-press', 'Seated dumbbell press', 'vertical-press', ['front-delts', 'triceps'], ['side-delts'], [['dumbbells'], ['bench', 'incline-bench']], 'dumbbell', true, ['shoulders', 'elbows', 'wrists'], 'Back supported, forearms vertical, press without arching.', { carries: ['handstand'] }),
  x('kettlebell-press', 'Kettlebell press', 'vertical-press', ['front-delts', 'triceps'], ['side-delts', 'abs'], [['kettlebells']], 'kettlebell', true, ['shoulders', 'elbows', 'wrists'], 'Rack position, wrist straight, press in a close path past the face.', { unilateral: true, carries: ['handstand'] }),
  x('smith-shoulder-press', 'Smith machine shoulder press', 'vertical-press', ['front-delts', 'triceps'], ['side-delts'], [['smith-machine'], ['bench', 'incline-bench']], 'machine', true, ['shoulders', 'elbows'], 'Bench upright; bar down to the chin, press without the lower back arching.', { stepFrom: 'smith-machine' }),
  x('push-press', 'Push press', 'vertical-press', ['front-delts', 'triceps'], ['quads', 'glutes', 'side-delts'], [['barbell']], 'barbell', true, ['shoulders', 'elbows', 'knees', 'lower-back', 'wrists'], 'A small dip and drive of the legs sends the bar up; lock out overhead and lower with control.', { technical: true, carries: ['handstand'] }),
  x('elevated-pike-push-up', 'Feet-elevated pike push-up', 'vertical-press', ['front-delts', 'triceps'], ['side-delts', 'upper-back'], [['box', 'bench', 'incline-bench']], 'bodyweight', true, ['wrists', 'shoulders', 'elbows'], 'Feet on a box, hips stacked over the hands, head travels forward into a tripod.', { carries: ['handstand'] }),
  x('wall-hspu', 'Wall handstand push-up', 'vertical-press', ['front-delts', 'triceps'], ['side-delts', 'upper-back', 'abs'], [['wall']], 'bodyweight', true, ['wrists', 'shoulders', 'elbows'], 'Belly to the wall, a controlled tripod lowering, press back up; only once the pike push-up is solid.', { technical: true, carries: ['handstand', 'ninety'] }),
  x('landmine-shoulder-press', 'Half-kneeling landmine press', 'vertical-press', ['front-delts', 'triceps'], ['chest-upper', 'abs', 'obliques'], [['barbell'], ['landmine']], 'barbell', true, ['shoulders', 'elbows', 'wrists'], 'Half-kneeling, bar held at the shoulder, ribs down; press up along its arc.', { unilateral: true, stepFrom: 'barbell' }),
  // ---- Lateral and rear delts, shoulder health ----
  x('lu-raise', 'Lu raise', 'lateral-raise', ['side-delts', 'front-delts'], ['traps', 'upper-back'], [['dumbbells']], 'dumbbell', false, ['shoulders'], 'Light plates or dumbbells, raise forward and out in one arc to above the head, thumbs up.', { technical: true }),
  x('leaning-lateral-raise', 'Leaning dumbbell lateral raise', 'lateral-raise', ['side-delts'], [], [['dumbbells']], 'dumbbell', false, ['shoulders'], 'Hold a rack or post and lean away; the lean puts tension on the bottom of the raise.', { unilateral: true }),
  x('cable-y-raise', 'Cable Y raise', 'lateral-raise', ['side-delts', 'traps'], ['upper-back', 'rear-delts'], [['cable']], 'cable', false, ['shoulders'], 'Cables crossed low, raise both arms into a Y with thumbs up; very light.'),
  x('y-raise', 'Incline Y raise', 'rear-delt', ['traps', 'rear-delts'], ['side-delts', 'upper-back'], [['dumbbells'], ['incline-bench']], 'dumbbell', false, ['shoulders'], 'Chest on a bench at 45°, arms lift into a Y with thumbs up; a few kg is plenty.'),
  x('prone-t-raise', 'Prone T raise', 'rear-delt', ['rear-delts', 'upper-back'], ['traps'], [['dumbbells'], ['incline-bench']], 'dumbbell', false, ['shoulders'], 'Chest on the bench, arms out to the sides, lift to shoulder height and squeeze.'),
  x('band-pull-apart', 'Band pull-apart', 'rear-delt', ['rear-delts', 'upper-back'], ['traps'], [['band']], 'bodyweight', false, ['shoulders'], 'Arms straight, pull the band to the chest by sweeping wide; high reps, no shrug.'),
  x('cuban-press', 'Cuban press', 'rear-delt', ['rear-delts', 'side-delts'], ['upper-back', 'traps'], [['dumbbells']], 'dumbbell', false, ['shoulders'], 'Upright row to the ears, rotate the hands up, press, and lower; use very light dumbbells.', { technical: true }),
  // ---- Triceps ----
  x('jm-press', 'JM press', 'triceps', ['triceps', 'triceps-long'], ['chest'], [['barbell'], ['bench']], 'barbell', true, ['elbows', 'wrists'], 'A cross between a close-grip bench and a skull crusher: bar to the chin, elbows forward.', { technical: true, stepFrom: 'barbell' }),
  x('overhead-ez-extension', 'Overhead EZ-bar extension', 'triceps', ['triceps-long', 'triceps'], [], [['ez-bar']], 'barbell', false, ['elbows', 'shoulders', 'wrists'], 'Press the bar overhead, lower behind the head with the elbows close, stretch then extend.', { stepFrom: 'ez-bar' }),
  x('rope-pushdown', 'Rope pushdown', 'triceps', ['triceps'], [], [['cable']], 'cable', false, ['elbows'], 'Elbows pinned; spread the rope at the bottom for a harder lockout.'),
  x('single-arm-cable-pushdown', 'Single-arm cable pushdown', 'triceps', ['triceps'], [], [['cable']], 'cable', false, ['elbows'], 'Palm down or up, elbow still, finish each rep locked out.', { unilateral: true }),
  x('db-kickback', 'Dumbbell kickback', 'triceps', ['triceps'], [], [['dumbbells']], 'dumbbell', false, ['elbows', 'wrists'], 'Upper arm parallel to the floor, only the forearm moves.', { unilateral: true }),
  x('diamond-push-up', 'Diamond push-up', 'triceps', ['triceps', 'chest'], ['front-delts'], [], 'bodyweight', true, ['wrists', 'elbows', 'shoulders'], 'Hands together under the chest, elbows close; easier from the knees or hands on a bench.', { carries: ['planche'] }),
  x('ring-triceps-extension', 'Ring triceps extension', 'triceps', ['triceps', 'triceps-long'], ['abs'], [['rings']], 'bodyweight', false, ['elbows', 'shoulders', 'wrists'], 'Body angled, arms overhead; bend only at the elbows and push the rings back out. Elbows work hard here: start steep.', { technical: true, carries: ['planche'] }),
  // ---- Biceps ----
  x('spider-curl', 'Spider curl', 'biceps', ['biceps'], [], [['dumbbells'], ['incline-bench']], 'dumbbell', false, ['elbows', 'wrists'], 'Chest on the bench, arms hang straight down, curl without letting the elbows drift back.'),
  x('bayesian-curl', 'Bayesian cable curl', 'biceps', ['biceps'], [], [['cable']], 'cable', false, ['elbows', 'shoulders', 'wrists'], 'Facing away from the cable, arm behind the body; the curl starts from a long stretch.', { unilateral: true }),
  x('concentration-curl', 'Concentration curl', 'biceps', ['biceps'], [], [['dumbbells'], ['bench', 'incline-bench']], 'dumbbell', false, ['elbows', 'wrists'], 'Elbow against the inner thigh, curl slowly and squeeze at the top.', { unilateral: true }),
  x('reverse-curl', 'Reverse curl', 'biceps', ['forearms', 'biceps'], [], [['ez-bar']], 'barbell', false, ['elbows', 'wrists'], 'Palms down, elbows still; the forearms work as much as the biceps.', { stepFrom: 'ez-bar' }),
  x('wrist-curl', 'Wrist curl', 'biceps', ['forearms'], [], [['dumbbells']], 'dumbbell', false, ['wrists', 'elbows'], 'Forearms on a bench or thigh, curl the weight with the wrist only.'),
  x('drag-curl', 'Drag curl', 'biceps', ['biceps'], ['forearms'], [['ez-bar']], 'barbell', false, ['elbows', 'wrists'], 'The bar slides up the body with the elbows pulled back; no swing.', { stepFrom: 'ez-bar' }),
  x('ring-curl', 'Ring curl', 'biceps', ['biceps'], ['forearms', 'abs'], [['rings']], 'bodyweight', false, ['elbows', 'shoulders', 'wrists'], 'Lean back under the rings, elbows high and forward, curl the hands to the forehead.', { carries: ['frontlever'] }),
  // ---- Vertical pulls ----
  x('neutral-grip-pulldown', 'Neutral-grip pulldown', 'vertical-pull', ['lats', 'biceps'], ['upper-back'], [['lat-pulldown']], 'machine', true, ['elbows', 'shoulders'], 'Palms facing in, elbows travel down and slightly forward to the ribs.', { stepFrom: 'lat-pulldown' }),
  x('single-arm-pulldown', 'Single-arm cable pulldown', 'vertical-pull', ['lats'], ['biceps', 'upper-back'], [['cable']], 'cable', true, ['elbows', 'shoulders'], 'Elbow drives down toward the hip; stay tall, do not lean away.', { unilateral: true }),
  x('wide-pull-up', 'Wide-grip pull-up', 'vertical-pull', ['lats', 'upper-back'], ['biceps', 'forearms'], [['pullup-bar', 'rings']], 'bodyweight', true, ['elbows', 'shoulders'], 'Hands a little wider than shoulders; chest to the bar, no kip.', { carries: ['frontlever'] }),
  x('neutral-pull-up', 'Neutral-grip pull-up', 'vertical-pull', ['lats', 'biceps'], ['upper-back', 'forearms'], [['rings', 'pullup-bar']], 'bodyweight', true, ['elbows', 'shoulders'], 'Palms facing; the friendliest grip for the elbows and shoulders.', { carries: ['frontlever', 'flag'] }),
  x('archer-pull-up', 'Archer pull-up', 'vertical-pull', ['lats', 'biceps'], ['upper-back', 'forearms', 'obliques'], [['pullup-bar', 'rings']], 'bodyweight', true, ['elbows', 'shoulders'], 'Wide grip; pull toward one hand while the other arm stays straight, then switch.', { unilateral: true, technical: true, carries: ['frontlever'] }),
  x('typewriter-pull-up', 'Typewriter pull-up', 'vertical-pull', ['lats', 'biceps'], ['upper-back', 'obliques', 'forearms'], [['pullup-bar', 'rings']], 'bodyweight', true, ['elbows', 'shoulders'], 'Pull to the top, slide across to one hand, back to the middle, then the other side.', { technical: true, carries: ['frontlever', 'flag'] }),
  x('ice-cream-maker', 'Ice cream maker', 'vertical-pull', ['lats', 'abs'], ['biceps', 'upper-back', 'forearms'], [['pullup-bar', 'rings']], 'bodyweight', true, ['elbows', 'shoulders'], 'Pull up, then tip the body back through a tuck front lever and lower slowly; only with strong pull-ups.', { technical: true, carries: ['frontlever'] }),
  x('l-sit-pull-up', 'L-sit pull-up', 'vertical-pull', ['lats', 'biceps', 'abs'], ['hip-flexors', 'upper-back'], [['pullup-bar', 'rings']], 'bodyweight', true, ['elbows', 'shoulders'], 'Legs held straight out in front for every rep; pull the bar to the chest.', { technical: true, carries: ['frontlever', 'ninety'] }),
  x('scapular-pull-up', 'Scapular pull-up', 'vertical-pull', ['lats', 'upper-back'], ['forearms'], [['pullup-bar', 'rings']], 'bodyweight', false, ['shoulders'], 'Arms stay straight; only the shoulder blades pull down and the body rises a few centimetres.', { carries: ['frontlever', 'flag'] }),
  x('negative-pull-up', 'Slow negative pull-up', 'vertical-pull', ['lats', 'biceps'], ['upper-back', 'forearms'], [['pullup-bar', 'rings'], ['box', 'bench']], 'bodyweight', true, ['elbows', 'shoulders'], 'Step up to the top, lower for five slow seconds; a way to build the first pull-up.', { carries: ['frontlever'] }),
  // ---- Straight-arm pulls ----
  x('barbell-pullover', 'Barbell pullover', 'straight-arm-pull', ['lats'], ['chest', 'triceps-long'], [['barbell'], ['bench']], 'barbell', false, ['shoulders', 'elbows'], 'Arms nearly straight, a light bar, only as far back as the shoulders and ribs allow.', { stepFrom: 'barbell', carries: ['frontlever'] }),
  x('kneeling-rope-pullover', 'Kneeling cable pullover', 'straight-arm-pull', ['lats'], ['abs', 'triceps-long'], [['cable']], 'cable', false, ['shoulders'], 'Kneel facing the stack, rope overhead, sweep to the thighs with straight arms.', { carries: ['frontlever'] }),
  x('single-arm-straight-pulldown', 'Single-arm straight-arm pulldown', 'straight-arm-pull', ['lats'], ['triceps-long'], [['cable']], 'cable', false, ['shoulders', 'elbows'], 'One arm at a time, arm locked, sweep from overhead to the hip.', { unilateral: true, carries: ['frontlever'] }),
  // ---- Rows ----
  x('pendlay-row', 'Pendlay row', 'horizontal-pull', ['upper-back', 'lats', 'rear-delts'], ['biceps', 'lower-back'], [['barbell']], 'barbell', true, ['lower-back', 'elbows'], 'Bar starts on the floor each rep, back flat and parallel, pull explosively to the lower chest.', { technical: true, carries: ['frontlever'] }),
  x('seal-row', 'Seal row', 'horizontal-pull', ['upper-back', 'lats', 'rear-delts'], ['biceps'], [['bench', 'incline-bench'], ['barbell']], 'barbell', true, ['elbows'], 'Lie face down on a raised bench so the bar hangs free; the back works, the legs cannot help.', { carries: ['frontlever'] }),
  x('t-bar-row', 'T-bar row', 'horizontal-pull', ['upper-back', 'lats'], ['rear-delts', 'biceps', 'lower-back'], [['barbell'], ['landmine']], 'barbell', true, ['lower-back', 'elbows'], 'Straddle the bar, hinge, and pull the handle to the chest.', { technical: true, stepFrom: 'barbell', carries: ['frontlever'] }),
  x('meadows-row', 'Meadows row', 'horizontal-pull', ['lats', 'upper-back'], ['rear-delts', 'biceps'], [['barbell'], ['landmine']], 'barbell', true, ['lower-back', 'elbows'], 'Stand side-on to a landmine bar, hinge, and row the end toward the hip.', { unilateral: true, technical: true, stepFrom: 'barbell', carries: ['frontlever'] }),
  x('chest-supported-db-row', 'Chest-supported dumbbell row', 'horizontal-pull', ['upper-back', 'rear-delts'], ['lats', 'biceps'], [['dumbbells'], ['incline-bench']], 'dumbbell', true, ['elbows'], 'Chest on an incline bench; row both elbows back and squeeze.', { carries: ['frontlever'] }),
  x('one-arm-cable-row', 'One-arm cable row', 'horizontal-pull', ['lats', 'upper-back'], ['rear-delts', 'biceps'], [['cable']], 'cable', true, ['elbows'], 'Staggered stance, pull the elbow past the ribs and rotate nothing else.', { unilateral: true, carries: ['frontlever'] }),
  x('smith-row', 'Smith machine row', 'horizontal-pull', ['upper-back', 'lats'], ['rear-delts', 'biceps', 'lower-back'], [['smith-machine']], 'machine', true, ['lower-back', 'elbows'], 'Hinge to 45°, bar to the lower ribs; the track keeps the path honest.', { stepFrom: 'smith-machine' }),
  x('feet-elevated-inverted-row', 'Feet-elevated inverted row', 'horizontal-pull', ['upper-back', 'lats'], ['rear-delts', 'biceps', 'abs'], [['rings', 'smith-machine'], ['box', 'bench']], 'bodyweight', true, ['elbows', 'shoulders'], 'With a low bar or rings, set your feet on the bench. Keep a straight plank as you pull.', { carries: ['frontlever'] }),
  x('renegade-row', 'Renegade row', 'horizontal-pull', ['lats', 'upper-back'], ['abs', 'obliques', 'biceps'], [['dumbbells']], 'dumbbell', true, ['wrists', 'shoulders', 'elbows'], 'Plank on two dumbbells; row one while the hips stay square to the floor.', { unilateral: true, carries: ['planche'] }),
  x('band-seated-row', 'Seated band row', 'horizontal-pull', ['lats', 'upper-back'], ['biceps', 'rear-delts'], [['band']], 'bodyweight', true, ['elbows', 'shoulders'], 'Sit tall with the center of a long band around both midfeet. Draw your elbows back toward your ribs. Use the same band and starting stretch to compare sessions.', { carries: ['frontlever'] }),
  x('band-lateral-raise', 'Band lateral raise', 'lateral-raise', ['side-delts'], ['traps'], [['band']], 'bodyweight', false, ['shoulders'], 'Stand on a long band. With a soft elbow, raise one arm out to the side and lower under control.', { unilateral: true }),
  x('band-biceps-curl', 'Band biceps curl', 'biceps', ['biceps'], ['forearms'], [['band']], 'bodyweight', false, ['elbows', 'wrists'], 'Stand on the band with palms forward. Keep the elbows beside the ribs as you curl.'),
  x('band-overhead-extension', 'Band overhead triceps extension', 'triceps', ['triceps', 'triceps-long'], [], [['band']], 'bodyweight', false, ['elbows', 'shoulders', 'wrists'], 'Stand on one end of a long band. Hold the other end overhead and straighten your elbows within a comfortable range.'),
  x('band-straight-arm-pulldown', 'Band straight-arm pulldown', 'straight-arm-pull', ['lats'], ['triceps-long', 'abs'], [['band'], ['pullup-bar', 'squat-rack']], 'bodyweight', false, ['shoulders', 'elbows'], 'Loop the band securely over a high bar and sweep your arms to your thighs, keeping the elbows straight.', { carries: ['frontlever'] }),
  x('band-pallof-press', 'Band Pallof press', 'core-anti-rotation', ['obliques', 'abs'], [], [['band'], ['pole', 'squat-rack']], 'bodyweight', false, ['shoulders'], 'Fix the band to a sturdy post at chest height. Stand sideways and press it forward without turning.'),
  x('floor-calf-raise', 'Floor calf raise', 'calf', ['calves'], [], [], 'bodyweight', false, ['ankles'], 'Rise onto the balls of both feet and pause. Lower the heels under control. Use support for balance if you need it.', { stepFrom: 'dumbbells' }),
  x('hamstring-walkout', 'Hamstring bridge walkout', 'knee-flexion', ['hamstrings'], ['glutes'], [], 'bodyweight', false, ['knees', 'hips'], 'Lift your hips from a bridge and take small steps out and back with your heels. One trip out and back is one rep. Start with short steps.'),
  // ---- Squat and single-leg ----
  x('bodyweight-squat', 'Bodyweight squat', 'squat', ['quads', 'glutes'], ['adductors'], [], 'bodyweight', true, ['knees', 'hips'], 'Feet shoulder width, sit between the hips, chest tall.'),
  x('box-squat', 'Box squat', 'squat', ['quads', 'glutes'], ['hamstrings', 'adductors'], [['barbell'], ['squat-rack'], ['box', 'bench']], 'barbell', true, ['knees', 'hips', 'lower-back'], 'Sit back to the box, pause without relaxing, stand up.', { technical: true }),
  x('pause-squat', 'Pause back squat', 'squat', ['quads', 'glutes'], ['adductors', 'lower-back'], [['barbell'], ['squat-rack']], 'barbell', true, ['knees', 'hips', 'lower-back'], 'Hold the bottom for two seconds, braced, then stand.', { technical: true, stepFrom: 'barbell' }),
  x('zercher-squat', 'Zercher squat', 'squat', ['quads', 'glutes'], ['abs', 'upper-back', 'biceps'], [['barbell'], ['squat-rack']], 'barbell', true, ['knees', 'hips', 'elbows'], 'Bar in the crook of the elbows, elbows in front of the knees at the bottom.', { technical: true, stepFrom: 'barbell' }),
  x('kb-front-squat', 'Double kettlebell front squat', 'squat', ['quads', 'glutes'], ['abs', 'upper-back'], [['kettlebells']], 'kettlebell', true, ['knees', 'wrists', 'hips'], 'Two bells in the rack, elbows against the ribs, an upright squat.'),
  x('single-leg-press', 'Single-leg press', 'squat', ['quads', 'glutes'], ['adductors'], [['leg-press']], 'machine', true, ['knees', 'hips'], 'One foot mid-platform, lower back flat on the pad, do not lock out.', { unilateral: true, stepFrom: 'leg-press' }),
  x('heel-elevated-goblet-squat', 'Heel-elevated goblet squat', 'squat', ['quads'], ['glutes', 'adductors'], [['dumbbells'], ['plates', 'box']], 'dumbbell', true, ['knees', 'ankles'], 'Heels on a plate, an upright torso, knees travel far forward.'),
  x('box-pistol-squat', 'Box pistol squat', 'lunge', ['quads', 'glutes'], ['adductors', 'abs'], [['box', 'bench']], 'bodyweight', true, ['knees', 'ankles', 'hips'], 'Sit down to a box on one leg and stand; lower the box over weeks.', { unilateral: true, technical: true }),
  x('split-squat', 'Split squat', 'lunge', ['quads', 'glutes'], ['adductors'], [], 'bodyweight', true, ['knees', 'hips'], 'A fixed stance, drop the back knee straight down, front shin near vertical.', { unilateral: true, stepFrom: 'dumbbells' }),
  x('ffe-split-squat', 'Front-foot-elevated split squat', 'lunge', ['quads'], ['glutes', 'adductors'], [['plates', 'box']], 'bodyweight', true, ['knees', 'ankles', 'hips'], 'Raise the front foot on a low platform. Let the knee travel over the toes as you lower.', { unilateral: true, stepFrom: 'dumbbells' }),
  x('reverse-lunge', 'Dumbbell reverse lunge', 'lunge', ['glutes', 'quads'], ['hamstrings', 'adductors'], [['dumbbells']], 'dumbbell', true, ['knees', 'hips'], 'Step back and drop the rear knee; easier on the front knee than a forward lunge.', { unilateral: true }),
  x('lateral-lunge', 'Lateral lunge', 'lunge', ['glutes', 'adductors'], ['quads'], [['dumbbells']], 'dumbbell', true, ['knees', 'hips'], 'Step wide, sit back into one hip with the other leg straight; chest tall.', { unilateral: true }),
  x('cossack-squat', 'Cossack squat', 'lunge', ['adductors', 'glutes'], ['quads'], [], 'bodyweight', true, ['knees', 'hips'], 'Wide stance, sink onto one leg while the other stays straight with the toes up.', { unilateral: true }),
  x('curtsy-lunge', 'Curtsy lunge', 'lunge', ['glutes', 'quads'], ['adductors'], [['dumbbells']], 'dumbbell', true, ['knees', 'hips'], 'Step behind and across, lower the back knee diagonally; keep the front knee tracking the toes.', { unilateral: true }),
  x('smith-split-squat', 'Smith machine split squat', 'lunge', ['quads', 'glutes'], ['adductors'], [['smith-machine']], 'machine', true, ['knees', 'hips'], 'Front foot well forward of the bar; the track holds the balance.', { unilateral: true, stepFrom: 'smith-machine' }),
  x('sissy-squat', 'Sissy squat', 'knee-extension', ['quads'], ['hip-flexors'], [['wall', 'pole', 'squat-rack']], 'bodyweight', false, ['knees'], 'Hold a post, lean back with the knees forward and the heels rising; build the depth slowly.'),
  x('spanish-squat', 'Spanish squat', 'knee-extension', ['quads'], [], [['band'], ['pole', 'squat-rack']], 'bodyweight', false, ['knees'], 'A band behind the knees anchored to a post; sit back with an upright shin and hold or rep.'),
  x('reverse-nordic', 'Reverse Nordic curl', 'knee-extension', ['quads'], ['hip-flexors'], [['floor']], 'bodyweight', false, ['knees'], 'Kneel tall and lean back as far as you can control, then come back up; a strong quad stretch.', { technical: true }),
  x('tibialis-raise', 'Tibialis raise', 'dorsiflexion', ['tibialis-anterior'], [], [['wall']], 'bodyweight', false, ['ankles'], 'Lean your back against a wall with your heels planted out in front. Lift your toes toward your shins and lower slowly.'),
  x('seated-calf-raise', 'Seated calf raise', 'calf', ['calves'], [], [['calf-machine']], 'machine', false, ['ankles'], 'Knees bent works the deeper calf muscle: full stretch, pause at the top.', { stepFrom: 'calf-machine' }),
  x('single-leg-calf-raise', 'Single-leg calf raise', 'calf', ['calves'], [], [['box', 'bench']], 'bodyweight', false, ['ankles'], 'Ball of one foot on a step, a full stretch, a full rise, no bounce.', { unilateral: true }),
  x('leg-press-calf-raise', 'Leg press calf raise', 'calf', ['calves'], [], [['leg-press']], 'machine', false, ['ankles'], 'Toes on the bottom of the platform; stretch deep and drive up.', { stepFrom: 'leg-press' }),
  // ---- Hinge and hamstrings ----
  x('single-leg-rdl', 'Single-leg Romanian deadlift', 'hinge', ['hamstrings', 'glutes'], ['lower-back', 'abs', 'forearms'], [['dumbbells']], 'dumbbell', true, ['lower-back', 'hips', 'ankles'], 'Hips back, the free leg reaches behind in line with the torso; a soft knee, square hips.', { unilateral: true }),
  x('db-rdl', 'Dumbbell Romanian deadlift', 'hinge', ['hamstrings', 'glutes'], ['lower-back', 'forearms'], [['dumbbells']], 'dumbbell', true, ['lower-back', 'hips'], 'Dumbbells slide down the thighs, hips back, flat back; stop where the hamstrings stretch.', { variantOf: 'romanian-deadlift' }),
  x('good-morning', 'Good morning', 'hinge', ['hamstrings', 'glutes', 'lower-back'], ['abs'], [['barbell'], ['squat-rack']], 'barbell', true, ['lower-back', 'hips'], 'Bar on the back, soft knees, hinge until the torso is near parallel; light weights only.', { technical: true }),
  x('rack-pull', 'Rack pull', 'hinge', ['glutes', 'lower-back', 'traps'], ['hamstrings', 'forearms', 'upper-back'], [['barbell'], ['squat-rack']], 'barbell', true, ['lower-back', 'hips'], 'Bar from pins at the knee; stand tall, shoulders back, no leaning at the top.', { technical: true }),
  x('sumo-deadlift', 'Sumo deadlift', 'hinge', ['glutes', 'adductors', 'quads'], ['hamstrings', 'lower-back', 'forearms'], [['barbell']], 'barbell', true, ['hips', 'knees', 'lower-back'], 'Wide stance, toes out, knees follow the toes, push the floor apart.', { technical: true }),
  x('kb-deadlift', 'Kettlebell deadlift', 'hinge', ['glutes', 'hamstrings'], ['lower-back', 'quads', 'forearms'], [['kettlebells']], 'kettlebell', true, ['lower-back', 'hips'], 'Bell between the feet, push the floor away; a good first deadlift pattern.'),
  x('cable-pull-through', 'Cable pull-through', 'hinge', ['glutes', 'hamstrings'], ['lower-back'], [['cable']], 'cable', true, ['hips', 'lower-back'], 'Face away from the stack, rope between the legs; hinge back, then squeeze the glutes to stand.'),
  x('glute-bridge', 'Glute bridge', 'hinge', ['glutes'], ['hamstrings'], [], 'bodyweight', false, ['hips'], 'Feet flat, ribs down, lift the hips and squeeze; add a plate or dumbbell later.'),
  x('single-leg-hip-thrust', 'Single-leg hip thrust', 'hinge', ['glutes'], ['hamstrings'], [['bench', 'box', 'incline-bench']], 'bodyweight', false, ['hips'], 'Upper back on a bench, one foot down, level hips at the top.', { unilateral: true }),
  x('ghd-back-extension', 'GHD back extension', 'hinge', ['lower-back', 'glutes'], ['hamstrings'], [['ghd']], 'bodyweight', false, ['lower-back', 'hips'], 'Hinge at the hips to a straight line, never past it.'),
  x('glute-ham-raise', 'Glute-ham raise', 'knee-flexion', ['hamstrings', 'glutes'], ['lower-back', 'calves'], [['ghd']], 'bodyweight', true, ['knees', 'lower-back'], 'Lower the torso under control and curl back up with the hamstrings; hands across the chest or help from the arms.', { technical: true }),
  x('seated-leg-curl', 'Seated leg curl', 'knee-flexion', ['hamstrings'], ['calves'], [['leg-curl']], 'machine', false, ['knees'], 'Thigh pad snug, curl to full range and return slowly.', { stepFrom: 'leg-curl' }),
  x('slider-leg-curl', 'Slider hamstring curl', 'knee-flexion', ['hamstrings'], ['glutes', 'calves'], [['sliders']], 'bodyweight', false, ['knees'], 'Hips up in a bridge, heels on a towel or slider; slide out and curl back without dropping the hips.'),
  x('single-leg-curl', 'Single-leg leg curl', 'knee-flexion', ['hamstrings'], [], [['leg-curl']], 'machine', false, ['knees'], 'One leg at a time; the same full range each rep.', { unilateral: true, stepFrom: 'leg-curl' }),
  x('banded-lateral-walk', 'Banded lateral walk', 'abduction', ['glutes'], ['quads'], [['band']], 'bodyweight', false, ['hips', 'knees'], 'Band above the knees, half squat, small steps sideways; keep the tension on the whole time.'),
  x('cable-hip-abduction', 'Cable hip abduction', 'abduction', ['glutes'], [], [['cable']], 'cable', false, ['hips'], 'Cuff on the outside ankle, lift the leg out to the side, trunk still.', { unilateral: true }),
  x('cable-kickback', 'Cable glute kickback', 'abduction', ['glutes'], ['hamstrings'], [['cable']], 'cable', false, ['hips', 'lower-back'], 'Cuff on the ankle, drive the leg back without arching the lower back.', { unilateral: true }),
  x('side-lying-abduction', 'Side-lying hip abduction', 'abduction', ['glutes'], [], [['floor']], 'bodyweight', false, ['hips'], 'Lie on your side, lift the top leg with the toes forward; a good warm-up or rehab pick.', { unilateral: true }),
  x('copenhagen-plank', 'Copenhagen plank', 'adduction', ['adductors'], ['obliques', 'abs'], [['bench', 'box', 'incline-bench']], 'bodyweight', false, ['hips', 'knees'], 'Side plank with the top leg on a bench; lift the bottom leg to meet it. Build up to full holds gradually.', { count: 'seconds', dose: { sets: 3, range: [10, 20], restSec: 60, rpe: 8, workSec: 20 }, technical: true }),
  x('short-copenhagen', 'Short-lever Copenhagen plank', 'adduction', ['adductors'], ['obliques'], [['bench', 'box', 'incline-bench']], 'bodyweight', false, ['hips', 'knees'], 'Top knee on the bench instead of the foot; the easier version to start with.', { count: 'seconds', dose: { sets: 3, range: [15, 30], restSec: 60, rpe: 8, workSec: 30 } }),
  x('cable-hip-adduction', 'Cable hip adduction', 'adduction', ['adductors'], [], [['cable']], 'cable', false, ['hips'], 'Cuff on the inside ankle, sweep the leg across in front of the standing leg, slowly.', { unilateral: true }),
  x('adductor-squeeze', 'Ball squeeze', 'adduction', ['adductors'], ['abs'], [['medicine-ball']], 'bodyweight', false, ['hips'], 'Lying with knees bent, a ball between them: squeeze for five seconds, release.'),
  // ---- Core ----
  x('dead-bug', 'Dead bug', 'core-flexion', ['abs'], ['hip-flexors'], [['floor']], 'bodyweight', false, [], 'Lower back stays pressed down; opposite arm and leg reach out slowly.', { carries: ['planche', 'frontlever'] }),
  x('hollow-hold', 'Hollow body hold', 'core-flexion', ['abs'], ['hip-flexors'], [['floor']], 'bodyweight', false, ['lower-back'], 'Lower back glued to the floor, legs and shoulders just off it; shorten the lever if the back lifts.', { count: 'seconds', dose: { sets: 3, range: [20, 40], restSec: 60, rpe: 8, workSec: 40 }, carries: ['planche', 'frontlever', 'ninety'] }),
  x('plank', 'Plank', 'core-flexion', ['abs'], ['obliques', 'glutes'], [['floor']], 'bodyweight', false, ['shoulders'], 'A straight line, ribs down, glutes squeezed; stop when the hips sag.', { count: 'seconds', dose: { sets: 3, range: [20, 40], restSec: 60, rpe: 8, workSec: 40 }, carries: ['planche'] }),
  x('l-sit', 'L-sit', 'core-flexion', ['abs', 'hip-flexors'], ['triceps', 'front-delts'], [['parallettes', 'dip-bars', 'rings']], 'bodyweight', false, ['wrists', 'shoulders'], 'Press down tall, legs straight out in front; tuck the knees if the legs sink.', { count: 'seconds', dose: { sets: 3, range: [10, 20], restSec: 60, rpe: 8, workSec: 20 }, technical: true, carries: ['planche', 'ninety'] }),
  x('hanging-knee-raise', 'Hanging knee raise', 'core-flexion', ['abs', 'hip-flexors'], ['forearms'], [['pullup-bar', 'rings']], 'bodyweight', false, ['shoulders'], 'Curl the pelvis up as the knees rise; the easier hanging raise.', { carries: ['frontlever'] }),
  x('toes-to-bar', 'Toes to bar', 'core-flexion', ['abs', 'hip-flexors'], ['lats', 'forearms'], [['pullup-bar', 'rings']], 'bodyweight', false, ['shoulders'], 'Pull the bar down as the legs rise to touch it; slow, no swing.', { technical: true, carries: ['frontlever'] }),
  x('dragon-flag', 'Dragon flag', 'core-flexion', ['abs'], ['lats', 'hip-flexors', 'lower-back'], [['bench']], 'bodyweight', false, ['shoulders', 'lower-back'], 'Hold the bench behind the head, body straight from the shoulders; lower slowly with the hips down.', { technical: true, carries: ['frontlever'] }),
  x('reverse-crunch', 'Reverse crunch', 'core-flexion', ['abs'], [], [['floor']], 'bodyweight', false, [], 'Curl the pelvis off the floor, knees to the chest, no swinging.'),
  x('v-up', 'V-up', 'core-flexion', ['abs', 'hip-flexors'], [], [['floor']], 'bodyweight', false, ['lower-back'], 'Reach hands to toes in a V; slow down if the lower back arches.'),
  x('side-plank', 'Side plank', 'core-anti-rotation', ['obliques'], ['glutes', 'abs'], [['floor']], 'bodyweight', false, ['shoulders'], 'Stack the feet, hips high, a straight line; hold each side the same.', { count: 'seconds', dose: { sets: 3, range: [20, 40], restSec: 60, rpe: 8, workSec: 40 }, unilateral: true, carries: ['flag'] }),
  x('cable-woodchop', 'Cable woodchop', 'core-anti-rotation', ['obliques'], ['abs', 'glutes'], [['cable']], 'cable', false, ['lower-back'], 'Pull diagonally across the body, turning the trunk and hips together; the arms stay long.', { unilateral: true }),
  x('bird-dog', 'Bird dog', 'core-anti-rotation', ['lower-back', 'glutes'], ['abs', 'obliques'], [['floor']], 'bodyweight', false, [], 'Reach the opposite arm and leg out with a still trunk; a glass of water on the back would not spill.'),
  // ---- More carries ----
  x('suitcase-carry', 'Suitcase carry', 'carry', ['obliques', 'forearms'], ['traps', 'glutes', 'abs'], [['dumbbells']], 'dumbbell', true, ['wrists', 'lower-back'], 'One heavy weight in one hand; walk tall and do not lean toward it.', { unilateral: true, carries: ['flag'] }),
  x('overhead-carry', 'Overhead carry', 'carry', ['front-delts', 'traps'], ['abs', 'obliques', 'upper-back'], [['kettlebells']], 'kettlebell', true, ['shoulders', 'wrists'], 'Arm locked overhead, ribs down, steady steps; light and slow.', { unilateral: true, carries: ['handstand'] }),
  x('front-rack-carry', 'Front-rack carry', 'carry', ['abs', 'upper-back'], ['obliques', 'forearms', 'traps'], [['kettlebells']], 'kettlebell', true, ['wrists', 'shoulders'], 'Two bells in the rack position, elbows tucked, tall posture.'),
  x('trap-bar-carry', 'Trap bar carry', 'carry', ['traps', 'forearms'], ['glutes', 'abs', 'quads'], [['trap-bar']], 'barbell', true, ['wrists', 'lower-back'], 'Stand tall inside the bar and walk with short, even steps.', { stepFrom: 'trap-bar', variantOf: 'farmer-carry' }),
  x('sled-drag-backward', 'Backward sled drag', 'carry', ['quads'], ['calves', 'glutes'], [['sled']], 'machine', true, ['knees'], 'Walk backward leaning slightly away from the sled, short steps; easy on the joints and a good warm-up.', { stepFrom: 'sled' }),
  // ---- Speed and power: running mechanics, plyometrics, sprints, throws ----
  // CONSENSUS throughout: coaching ladders, not measured progressions. Tiers and
  // rungs say what to learn first; contacts and runs are counted, never loaded.
  x('wall-drill', 'Wall drill', 'drill', ['hip-flexors', 'glutes'], ['abs', 'calves'], [['wall']], 'bodyweight', false, ['ankles'], 'Lean into a wall at about 45° in a straight line, drive one knee up with the foot under it, then cycle quickly.', { tier: 'low', rung: 1, count: 'contacts', dose: { sets: 2, range: [8, 12], restSec: 45, rpe: 6, workSec: 20 } }),
  x('a-march', 'A-march', 'drill', ['hip-flexors', 'glutes'], ['calves', 'abs'], [['track']], 'bodyweight', false, ['ankles'], 'Tall posture, knee up, toes up, foot lands under the hip; march, do not run.', { tier: 'low', rung: 2, count: 'contacts', distanceM: 20, dose: { sets: 2, range: [10, 16], restSec: 45, rpe: 6, workSec: 20 } }),
  x('a-skip', 'A-skip', 'drill', ['hip-flexors', 'glutes', 'calves'], ['hamstrings'], [['track']], 'bodyweight', false, ['ankles', 'knees'], 'A rhythmic skip with the knee up and the foot snapping down under the hip.', { tier: 'low', rung: 3, count: 'contacts', distanceM: 20, dose: { sets: 2, range: [10, 16], restSec: 45, rpe: 6, workSec: 20 } }),
  x('b-skip', 'B-skip', 'drill', ['hamstrings', 'hip-flexors', 'glutes'], ['calves'], [['track']], 'bodyweight', false, ['ankles', 'knees'], 'An A-skip plus a leg extension and a pawing action back under the hip; relaxed, not forced.', { tier: 'medium', rung: 4, count: 'contacts', distanceM: 20, dose: { sets: 2, range: [10, 16], restSec: 60, rpe: 6, workSec: 20 } }),
  x('wicket-run', 'Wicket run', 'drill', ['hip-flexors', 'hamstrings', 'glutes'], ['calves', 'quads'], [['track'], ['cones']], 'bodyweight', false, ['ankles', 'knees', 'hips'], 'Low cones set at an even spacing; run over them with quick, tall steps and a stiff ankle at each contact.', { tier: 'medium', rung: 5, count: 'contacts', distanceM: 20, dose: { sets: 3, range: [8, 12], restSec: 90, rpe: 7, workSec: 12 } }),
  x('build-up-run', 'Build-up run', 'sprint', ['hamstrings', 'glutes'], ['quads', 'calves'], [['track']], 'bodyweight', true, ['hips', 'knees', 'ankles'], 'Ease from a jog to about 80% over 40 m and run tall; stay relaxed, the speed comes from rhythm.', { tier: 'low', rung: 1, count: 'reps', distanceM: 40, dose: { sets: 4, range: [1, 1], restSec: 75, rpe: 6, workSec: 10 } }),
  x('acceleration-run', 'Submaximal acceleration run', 'sprint', ['quads', 'glutes', 'hamstrings'], ['calves', 'hip-flexors'], [['track']], 'bodyweight', true, ['hips', 'knees', 'ankles'], 'From a standing or two-point start, 15 to 20 m at about 85-90%: forward lean at first, then rise tall.', { tier: 'medium', rung: 2, count: 'reps', distanceM: 20, explosive: true, dose: { sets: 4, range: [1, 1], restSec: 120, rpe: 7, workSec: 6 } }),
  x('sled-push', 'Sled push', 'sprint', ['quads', 'glutes'], ['calves', 'hamstrings', 'abs'], [['sled'], ['track']], 'machine', true, ['knees', 'hips', 'ankles'], 'Light to moderate load, a straight line from head to heel, drive hard for 10 to 20 m with a low lean.', { tier: 'medium', rung: 3, count: 'reps', distanceM: 15, stepFrom: 'sled', explosive: true, dose: { sets: 4, range: [1, 1], restSec: 120, rpe: 7, workSec: 10 } }),
  x('acceleration-start', 'Acceleration start', 'sprint', ['quads', 'glutes', 'hamstrings'], ['calves', 'hip-flexors'], [['track']], 'bodyweight', true, ['hips', 'knees', 'ankles'], 'A maximal 10 to 20 m from a crouched or three-point start; full rest between runs, stop when speed drops.', { tier: 'high', rung: 4, maximal: true, count: 'reps', distanceM: 20, explosive: true, technical: true, dose: { sets: 4, range: [1, 1], restSec: 180, rpe: 9, workSec: 6 } }),
  x('flying-sprint', 'Flying sprint', 'sprint', ['hamstrings', 'glutes'], ['quads', 'calves', 'hip-flexors'], [['track']], 'bodyweight', true, ['hips', 'knees', 'ankles'], 'Build up over 20 m, then hold top speed for 10 to 20 m; full rest, a few runs only. Hamstrings are the risk here.', { tier: 'high', rung: 5, maximal: true, count: 'reps', distanceM: 20, explosive: true, technical: true, dose: { sets: 3, range: [1, 1], restSec: 180, rpe: 9, workSec: 6 } }),
  x('landing-stick', 'Step-down landing', 'jump', ['quads', 'glutes'], ['calves'], [['box', 'bench']], 'bodyweight', false, ['knees', 'ankles'], 'Step off a low box, land on both feet with soft knees and stick it for two seconds. Landing is the skill.', { tier: 'low', rung: 1, count: 'reps', dose: { sets: 3, range: [5, 8], restSec: 45, rpe: 5, workSec: 20 }, explosive: true }),
  x('pogo-hop', 'Pogo hops', 'jump', ['calves'], ['quads'], [], 'bodyweight', false, ['ankles', 'knees'], 'Stiff ankles, quick contacts, the heels barely touch; a sprinter’s drill.', { tier: 'low', rung: 2, count: 'contacts', explosive: true, dose: { sets: 3, range: [10, 20], restSec: 60, rpe: 6, workSec: 15 } }),
  x('jump-squat', 'Jump squat', 'jump', ['quads', 'glutes'], ['calves'], [], 'bodyweight', true, ['knees', 'ankles'], 'Quarter-depth dip, jump tall, land soft.', { tier: 'medium', rung: 3, count: 'reps', explosive: true, dose: { sets: 3, range: [4, 6], restSec: 90, rpe: 7, workSec: 20 } }),
  x('vertical-jump', 'Countermovement jump', 'jump', ['quads', 'glutes'], ['calves', 'hamstrings'], [], 'bodyweight', true, ['knees', 'ankles'], 'Swing the arms, dip, jump as high as you can and land softly on both feet.', { tier: 'medium', rung: 3, count: 'reps', explosive: true, dose: { sets: 3, range: [3, 5], restSec: 90, rpe: 7, workSec: 15 } }),
  x('broad-jump', 'Broad jump', 'jump', ['glutes', 'quads'], ['calves', 'hamstrings'], [], 'bodyweight', true, ['knees', 'ankles'], 'Swing the arms, stick the landing, reset fully between reps.', { tier: 'medium', rung: 4, count: 'reps', explosive: true, dose: { sets: 3, range: [3, 5], restSec: 90, rpe: 7, workSec: 15 } }),
  x('box-jump', 'Box jump', 'jump', ['quads', 'glutes'], ['calves'], [['box']], 'bodyweight', true, ['knees', 'ankles'], 'Land softly and step down: the jump up is the rep.', { tier: 'medium', rung: 4, count: 'reps', explosive: true, dose: { sets: 3, range: [3, 5], restSec: 90, rpe: 7, workSec: 15 } }),
  x('low-hurdle-hop', 'Low hurdle hop', 'jump', ['calves', 'quads', 'glutes'], ['hamstrings'], [['cones', 'box']], 'bodyweight', true, ['knees', 'ankles'], 'Six low hurdles in a row: quick contacts, knees up a little, minimal time on the ground.', { tier: 'medium', rung: 5, count: 'contacts', explosive: true, dose: { sets: 3, range: [6, 10], restSec: 90, rpe: 7, workSec: 15 } }),
  x('lateral-bound', 'Lateral bound', 'jump', ['glutes', 'quads'], ['adductors', 'calves'], [], 'bodyweight', true, ['knees', 'ankles', 'hips'], 'Push off one leg to the side, land on the other and stick it for a second; a skater jump.', { tier: 'medium', rung: 5, count: 'contacts', unilateral: true, explosive: true, dose: { sets: 3, range: [6, 10], restSec: 90, rpe: 7, workSec: 15 } }),
  x('depth-drop', 'Depth drop (landing only)', 'jump', ['quads', 'glutes'], ['calves', 'hamstrings'], [['box']], 'bodyweight', true, ['knees', 'ankles', 'hips'], 'Step off a 30 to 40 cm box and absorb the landing with no jump. A hard way to load the legs: few reps, full rest.', { tier: 'high', rung: 6, count: 'reps', explosive: true, technical: true, dose: { sets: 3, range: [3, 5], restSec: 120, rpe: 7, workSec: 15 } }),
  x('bounding', 'Bounding', 'jump', ['glutes', 'hamstrings', 'quads'], ['calves', 'hip-flexors'], [['track']], 'bodyweight', true, ['knees', 'ankles', 'hips'], 'Exaggerated running strides for distance, long and powerful with a full arm swing; stop when the landings get loud.', { tier: 'high', rung: 7, count: 'contacts', distanceM: 30, explosive: true, technical: true, dose: { sets: 3, range: [8, 12], restSec: 120, rpe: 8, workSec: 12 } }),
  x('single-leg-hop', 'Single-leg hop', 'jump', ['calves', 'quads', 'glutes'], ['hamstrings'], [], 'bodyweight', true, ['knees', 'ankles', 'hips'], 'Hop forward on one leg and stick the landing; equal reps on each side.', { tier: 'high', rung: 7, count: 'contacts', unilateral: true, explosive: true, technical: true, dose: { sets: 3, range: [4, 6], restSec: 120, rpe: 8, workSec: 12 } }),
  x('depth-jump', 'Depth jump', 'jump', ['quads', 'glutes', 'calves'], ['hamstrings'], [['box']], 'bodyweight', true, ['knees', 'ankles', 'hips'], 'Step off a low box and rebound straight into a jump as quickly as possible; only after depth drops are easy.', { tier: 'high', rung: 8, count: 'reps', explosive: true, technical: true, dose: { sets: 3, range: [3, 5], restSec: 150, rpe: 8, workSec: 15 } }),
  x('kneeling-chest-pass', 'Kneeling medicine ball chest pass', 'throw', ['chest', 'triceps'], ['front-delts', 'abs'], [['medicine-ball'], ['wall', 'floor']], 'bodyweight', true, ['wrists', 'elbows'], 'Kneel tall with a light ball and pass it hard into the wall; full rest between throws.', { tier: 'low', rung: 1, count: 'reps', explosive: true, dose: { sets: 3, range: [5, 8], restSec: 60, rpe: 6, workSec: 15 } }),
  x('half-kneeling-rotational-throw', 'Half-kneeling rotational throw', 'throw', ['obliques', 'abs'], ['glutes', 'front-delts'], [['medicine-ball'], ['wall']], 'bodyweight', true, ['lower-back', 'shoulders'], 'Half-kneeling, side to the wall, rotate through the hips and throw; the arms follow the trunk.', { tier: 'low', rung: 2, count: 'reps', unilateral: true, explosive: true, dose: { sets: 3, range: [5, 8], restSec: 60, rpe: 6, workSec: 15 } }),
  x('med-ball-chest-throw', 'Medicine ball chest throw', 'throw', ['chest', 'triceps'], ['front-delts', 'abs'], [['medicine-ball'], ['wall', 'floor']], 'bodyweight', true, ['wrists', 'elbows'], 'Throw it through the wall; full rest between throws.', { tier: 'medium', rung: 3, count: 'reps', explosive: true, dose: { sets: 3, range: [4, 6], restSec: 75, rpe: 7, workSec: 15 } }),
  x('med-ball-slam', 'Medicine ball slam', 'throw', ['lats', 'abs'], ['triceps', 'glutes'], [['medicine-ball']], 'bodyweight', true, ['shoulders', 'lower-back'], 'Reach tall, slam with the whole body.', { tier: 'medium', rung: 3, count: 'reps', explosive: true, dose: { sets: 3, range: [5, 8], restSec: 75, rpe: 7, workSec: 15 } }),
  x('med-ball-scoop-toss', 'Medicine ball scoop toss', 'throw', ['glutes', 'quads'], ['hamstrings', 'abs'], [['medicine-ball']], 'bodyweight', true, ['lower-back', 'hips', 'knees'], 'Hinge and squat, then explode up and throw the ball forward and up with a full leg extension.', { tier: 'medium', rung: 4, count: 'reps', explosive: true, dose: { sets: 3, range: [4, 6], restSec: 75, rpe: 7, workSec: 15 } }),
  x('med-ball-rotational-throw', 'Standing rotational throw', 'throw', ['obliques', 'glutes'], ['abs', 'front-delts'], [['medicine-ball'], ['wall']], 'bodyweight', true, ['lower-back', 'hips', 'shoulders'], 'Stand side on, load the back hip and throw from the legs through the trunk; do both sides.', { tier: 'medium', rung: 4, count: 'reps', unilateral: true, explosive: true, dose: { sets: 3, range: [4, 6], restSec: 75, rpe: 7, workSec: 15 } }),
  x('med-ball-overhead-throw', 'Overhead medicine ball throw', 'throw', ['lats', 'abs'], ['front-delts', 'triceps'], [['medicine-ball']], 'bodyweight', true, ['shoulders', 'lower-back'], 'Arms overhead, a small backward lean, then whip the ball forward from the hips; light ball.', { tier: 'medium', rung: 4, count: 'reps', explosive: true, dose: { sets: 3, range: [4, 6], restSec: 75, rpe: 7, workSec: 15 } }),
  x('explosive-push-up', 'Explosive push-up', 'throw', ['chest', 'triceps'], ['front-delts', 'abs'], [], 'bodyweight', true, ['wrists', 'shoulders', 'elbows'], 'Push hard enough for the hands to leave the floor a little; land with soft elbows. Hands on a bench make it easier.', { tier: 'medium', rung: 5, count: 'reps', explosive: true, dose: { sets: 3, range: [4, 6], restSec: 90, rpe: 7, workSec: 15 } }),
  x('clap-push-up', 'Clap push-up', 'throw', ['chest', 'triceps'], ['front-delts', 'abs'], [], 'bodyweight', true, ['wrists', 'shoulders', 'elbows'], 'Explode high enough to clap and land with soft elbows; stop the set when the landings get stiff.', { tier: 'high', rung: 6, count: 'reps', explosive: true, technical: true, dose: { sets: 3, range: [3, 5], restSec: 120, rpe: 8, workSec: 15 } }),
]

const originals: Record<string, GymExercise> = Object.fromEntries(BASE_EXERCISES.map((e) => [e.id, e]))

/** Share the movement's anatomy, while keeping equipment, units, coaching and training history specific. */
function variant(sourceId: string, id: string, name: string, gear: GymEquipmentId, load: LoadKind, cue?: string, needs?: LocationEquipment[][]): GymExercise {
  const base = originals[sourceId]
  return { ...base, id, name, load, stepFrom: gear, variantOf: sourceId, cue: cue ?? base.cue,
    needs: needs ?? base.needs.map((group) => group.some((g) => g === base.stepFrom) ? [gear] : group) }
}

export const GYM_EXERCISES: GymExercise[] = [
  ...BASE_EXERCISES,
  variant('skull-crusher', 'db-skull-crusher', 'Dumbbell skull crusher', 'dumbbells', 'dumbbell', 'Keep the upper arms steady and bend the elbows to lower one dumbbell past each side of the head.'),
  variant('skull-crusher', 'barbell-skull-crusher', 'Barbell skull crusher', 'barbell', 'barbell'),
  variant('barbell-curl', 'ez-bar-curl', 'EZ-bar curl', 'ez-bar', 'barbell'),
  variant('preacher-curl', 'db-preacher-curl', 'Dumbbell preacher curl', 'dumbbells', 'dumbbell'),
  variant('lat-pulldown', 'high-cable-pulldown', 'Kneeling cable pulldown', 'cable', 'cable', 'Kneel beneath the high pulley, brace the ribs and pull the attachment toward the upper chest.'),
  variant('neutral-grip-pulldown', 'neutral-cable-pulldown', 'Neutral-grip cable pulldown', 'cable', 'cable'),
  variant('cable-row', 'low-cable-row', 'Low-pulley cable row', 'cable', 'cable', 'Sit facing a low pulley, brace the feet and draw the handle to the lower ribs without leaning back.'),
  variant('goblet-squat', 'kb-goblet-squat', 'Kettlebell goblet squat', 'kettlebells', 'kettlebell'),
  variant('hip-thrust', 'db-hip-thrust', 'Dumbbell hip thrust', 'dumbbells', 'dumbbell', 'Support your upper back on a stable bench. Steady a padded dumbbell across the hips and lift to a level torso.'),
  variant('hip-thrust', 'machine-hip-thrust', 'Machine hip thrust', 'hip-thrust-machine', 'machine', 'Set the hip pad securely, plant both feet and extend the hips while keeping the ribs down.', [['hip-thrust-machine']]),
  variant('standing-calf-raise', 'smith-calf-raise', 'Smith machine calf raise', 'smith-machine', 'machine', 'Set the stops and support the bar across the upper back. Rise onto the balls of your feet and lower under control.'),
  variant('farmer-carry', 'kb-farmer-carry', 'Kettlebell farmer carry', 'kettlebells', 'kettlebell'),
  variant('jm-press', 'ez-jm-press', 'EZ-bar JM press', 'ez-bar', 'barbell'),
  variant('reverse-curl', 'barbell-reverse-curl', 'Barbell reverse curl', 'barbell', 'barbell'),
  variant('reverse-curl', 'db-reverse-curl', 'Dumbbell reverse curl', 'dumbbells', 'dumbbell'),
  variant('wrist-curl', 'barbell-wrist-curl', 'Barbell wrist curl', 'barbell', 'barbell'),
  variant('wrist-curl', 'ez-wrist-curl', 'EZ-bar wrist curl', 'ez-bar', 'barbell'),
  variant('drag-curl', 'barbell-drag-curl', 'Barbell drag curl', 'barbell', 'barbell'),
  variant('barbell-pullover', 'ez-pullover', 'EZ-bar pullover', 'ez-bar', 'barbell'),
  variant('heel-elevated-goblet-squat', 'kb-heel-elevated-squat', 'Heel-elevated kettlebell squat', 'kettlebells', 'kettlebell'),
  variant('lateral-lunge', 'kb-lateral-lunge', 'Kettlebell lateral lunge', 'kettlebells', 'kettlebell'),
  variant('single-leg-rdl', 'kb-single-leg-rdl', 'Single-leg kettlebell Romanian deadlift', 'kettlebells', 'kettlebell'),
  variant('suitcase-carry', 'kb-suitcase-carry', 'Kettlebell suitcase carry', 'kettlebells', 'kettlebell'),
  variant('overhead-carry', 'db-overhead-carry', 'Dumbbell overhead carry', 'dumbbells', 'dumbbell'),
  variant('front-rack-carry', 'db-front-rack-carry', 'Dumbbell front-rack carry', 'dumbbells', 'dumbbell', 'Rest a dumbbell at each shoulder, keep your elbows forward and walk with a steady, upright torso.'),
]

export const GYM_EXERCISE_BY_ID: Record<string, GymExercise> = Object.fromEntries(GYM_EXERCISES.map((e) => [e.id, e]))

// Supporting or gripping a load matters when an athlete asks to rest a sore wrist,
// even when the wrist is not a primary source of training fatigue for that lift.
const handsFree = new Set(['hip-thrust', 'zercher-squat', 'cable-kickback', 'cable-hip-abduction', 'cable-hip-adduction', 'machine-lateral-raise'])
const handPatterns = new Set<Pattern>(['horizontal-press', 'incline-press', 'vertical-press', 'dip', 'chest-fly', 'triceps', 'biceps', 'vertical-pull', 'horizontal-pull', 'straight-arm-pull', 'carry', 'throw'])
// These movements transfer load through both joints, including a supported
// arm in a plank or a carry. A request to keep off a joint is stricter than
// its usual fatigue contribution in the exercise catalogue.
const loadedArmPatterns = new Set<Pattern>(['horizontal-press', 'incline-press', 'vertical-press', 'dip', 'horizontal-pull', 'vertical-pull', 'straight-arm-pull', 'carry', 'throw'])
const loadedArmSupports = new Set(['plank', 'side-plank', 'copenhagen-plank', 'short-copenhagen', 'ab-wheel', 'sled-push', 'nordic-curl', 'dragon-flag'])
// Keeping weight off an ankle also rules out standing, bracing with the feet,
// pushing a platform and stepping or jumping up to equipment. List the setups
// that can actually be done seated or lying down with the feet unloaded.
const feetUnloaded = new Set([
  'db-floor-press', 'barbell-floor-press', 'machine-chest-press', 'incline-machine-press',
  'pec-deck', 'db-fly', 'incline-db-fly', 'db-pullover', 'barbell-pullover', 'ez-pullover',
  'z-press', 'barbell-z-press', 'seated-db-press', 'machine-shoulder-press',
  'seated-db-lateral-raise', 'machine-lateral-raise', 'reverse-pec-deck', 'prone-t-raise', 'y-raise',
  'incline-db-curl', 'preacher-curl', 'db-preacher-curl', 'spider-curl', 'concentration-curl',
  'skull-crusher', 'db-skull-crusher', 'barbell-skull-crusher',
  'lat-pulldown', 'neutral-grip-pulldown', 'chest-supported-row', 'seal-row',
  'side-lying-abduction', 'adductor-squeeze', 'dead-bug', 'hollow-hold', 'reverse-crunch', 'v-up',
])
const handSupports = new Set<LocationEquipment>(['pullup-bar', 'rings', 'parallettes', 'dip-bars', 'ab-wheel'])
const jointRest = new Map<string, Joint[]>(GYM_EXERCISES.map((ex) => {
  const supportedByHands = ex.needs.some((group) => group.length > 0 && group.every((id) => handSupports.has(id)))
  const gripped = !handsFree.has(ex.variantOf ?? ex.id) && (['barbell', 'dumbbell', 'kettlebell', 'cable'].includes(ex.load) ||
    handPatterns.has(ex.pattern) || supportedByHands || ex.id === 'sled-push' || ex.id === 'dragon-flag')
  const joints = new Set(ex.stress)
  if (!feetUnloaded.has(ex.id)) joints.add('ankles')
  if (gripped) joints.add('wrists')
  if (loadedArmPatterns.has(ex.pattern) || supportedByHands || loadedArmSupports.has(ex.id)) {
    joints.add('elbows')
    joints.add('shoulders')
  }
  return [ex.id, [...joints]]
}))

export function jointsToRest(exerciseId: string): Joint[] {
  return jointRest.get(exerciseId) ?? []
}

const SKILL_ALIASES: Record<string, string> = {
  pushup: 'push-up', pullup: 'pull-up', 'negative-pullup': 'negative-pull-up', 'scap-pull': 'scapular-pull-up',
  'pike-pushup': 'pike-push-up', 'elevated-pike-pushup': 'elevated-pike-push-up', 'knee-pushup': 'kneeling-push-up',
}

/** The same movement in both players. A related movement never supplies evidence for a skill milestone. */
export function equivalentGymExercise(skillExerciseId: string): GymExercise | undefined {
  return GYM_EXERCISE_BY_ID[SKILL_ALIASES[skillExerciseId] ?? skillExerciseId]
}
