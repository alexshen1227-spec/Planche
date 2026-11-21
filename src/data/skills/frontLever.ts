import type { Exercise, StepDef } from '../../types'
import type { SkillDef } from './types'

/**
 * The front lever road.
 *
 * The planche's pulling mirror: straight arms, a level body, hung from a bar
 * instead of pressed off the floor. What every coach shares is the outline —
 * tuck first, a flat-backed tuck second, the full lever last, the lever
 * lengthened in stages. The middle is contested: Low's chart puts the straddle
 * *before* the one-leg lever, Antranik and Cali Move the other way round, GMB
 * has no one-leg step at all. This road takes one leg before the straddle for
 * a product reason, said on the step itself: a side-on camera reads one long
 * leg far better than two spread across its line of sight.
 *
 * No study of the hold was found (ledger §13.3), and the hold times that open
 * each step are this app's choices. Named coaches' own bars run from 10–15 s
 * to 60 s; the 5 s figure that makes the published spread about twelvefold is
 * from an unattributed page, and two of the most systematic sources set no bar
 * at all. The bars here shorten as the lever lengthens, as the planche's do.
 */
export const FRONT_LEVER_STEPS: StepDef[] = [
  {
    id: 'fl-hang',
    skill: 'frontlever',
    order: 0,
    name: 'Foundations',
    short: 'Foundations',
    tagline: 'Grip, shoulders, hollow body',
    keyExerciseId: 'active-hang',
    unlockSec: 30,
    startSec: 15,
    description:
      'Before the lever, the hang. A grip that lasts, shoulders that stay pulled down from the ears with the arms straight, and a hollow body that does not swing. This phase is short, and coaches put it first because every later step hangs from the same shoulders at a far longer lever.',
    formChecks: [
      'Arms straight, shoulders pulled down away from the ears — an active hang, not a slump',
      'Ribs down, legs together and a little in front of the bar: a shallow hollow shape',
      'A still hang, no swing',
      'Thumbs around the bar, hands about shoulder width',
    ],
    mistakes: [
      'Hanging passively with the shoulders up by the ears',
      'Bending the arms to hold the shoulders down',
      'Swinging to make the time',
    ],
    whyItMatters:
      'A front lever is this hang with the body turned level: straight arms, shoulders set, trunk rigid. Learning to keep that set with the feet below you is the cheapest place to learn it.',
    scheme: '3–4 sessions/week · active hang 4×15–30s · scapular pulls 3×8 · hollow hold 3×30s · pull-ups',
  },
  {
    id: 'fl-tuck',
    skill: 'frontlever',
    order: 1,
    name: 'Tuck Front Lever',
    short: 'Tuck',
    tagline: 'First level back',
    keyExerciseId: 'tuck-front-lever',
    unlockSec: 20,
    startSec: 5,
    description:
      'Knees pulled to the chest, hips lifted until the back is close to level, arms straight. The lever arm is as short as it gets, which is what makes this the first position most people can hold at all. Expect single seconds at first.',
    formChecks: [
      'Arms locked — the elbows do not bend to lift the hips',
      'Hips up near shoulder height, so the back is close to level',
      'Knees tight to the chest, shins tucked',
      'Shoulders pulled down and back, not rounding up toward the ears',
    ],
    mistakes: [
      'Bent arms — a bent-arm tuck is a different, easier position',
      'Hips hanging low, so the body is closer to a knee raise than a lever',
      'Kicking into it and swinging through the position',
    ],
    whyItMatters:
      'Every later lever is this shape with the hips opened and the legs let out. The straight-arm pull and the set shoulders are learned here, where the load is friendliest.',
    scheme: '3 sessions/week · 4–6 holds of 5–15s · tuck rows 3×5 · pull-ups 3×5–8',
  },
  {
    id: 'fl-advtuck',
    skill: 'frontlever',
    order: 2,
    name: 'Advanced Tuck Front Lever',
    short: 'Adv. tuck',
    tagline: 'Flat back, hips open',
    keyExerciseId: 'adv-tuck-front-lever',
    unlockSec: 15,
    startSec: 4,
    description:
      'The same tuck with the back flattened to level and the hips opened to about a right angle, so the thighs point up instead of sitting on the chest. The lever grows meaningfully and so does the load. This step commonly takes months.',
    formChecks: [
      'Back flat and level from shoulders to hips — film from the side to see it',
      'Hips open to about 90°, thighs pointing at the ceiling',
      'Arms locked the whole hold',
      'Shoulders stay pulled down as the back flattens',
    ],
    mistakes: [
      'Calling a slightly opened tuck an advanced tuck — check the side video',
      'Hips sinking below the shoulders as the seconds add up',
      'The elbows softening to keep the hips up',
    ],
    whyItMatters:
      'The flat, level back is the posture of every end-stage lever. Holding it here, with the shortest lever that allows it, is what makes the longer shapes approachable.',
    scheme: '3 sessions/week · 4–6 holds of 4–12s · advanced tuck rows · tuck holds as back-off',
  },
  {
    id: 'fl-oneleg',
    skill: 'frontlever',
    order: 3,
    name: 'One-Leg Front Lever',
    short: 'One-leg',
    tagline: 'One leg long, one side at a time',
    keyExerciseId: 'one-leg-front-lever',
    unlockSec: 12,
    startSec: 3,
    description:
      'From a level advanced tuck, extend one leg straight out in line with the body while the other stays tucked. It lengthens the lever in a step smaller than the jump to a straddle, and shows any difference between sides. Train both legs evenly. Coaches order this step and the straddle differently — some put the straddle first, some skip one of the two — and this road takes one leg first partly because a side-on camera can read it.',
    formChecks: [
      'Extended leg straight and level with the body, toes pointed',
      'Hips stay level — the long leg does not drag them down',
      'Back flat, arms locked',
      'Swap legs between holds, not during one',
    ],
    mistakes: [
      'The extended leg hanging low because the hips dropped',
      'Only training the stronger leg',
      'Bending the arms as soon as the leg goes out',
    ],
    whyItMatters:
      'A controlled one-leg lever shows the level back survives a longer lever — the same test the straddle runs at full scale.',
    scheme: '3 sessions/week · 3–5 holds a side of 3–8s · advanced tuck rows · keep advanced tuck volume',
  },
  {
    id: 'fl-straddle',
    skill: 'frontlever',
    order: 4,
    name: 'Straddle Front Lever',
    short: 'Straddle',
    tagline: 'Both legs out, wide',
    keyExerciseId: 'straddle-front-lever',
    unlockSec: 10,
    startSec: 3,
    description:
      'Both legs straight and spread wide, body level from shoulders to feet. The wider the straddle, the shorter the lever and the cheaper the hold — hip mobility buys real seconds here.',
    formChecks: [
      'Hips fully open: shoulders, hips and feet on one level line',
      'Legs straight, spread as wide as your hips allow',
      'Arms locked, shoulders pulled down',
      'No arch — ribs stay down, glutes on',
    ],
    mistakes: [
      'Hips piked, so the feet are level but the body is a shallow V',
      'A narrow straddle because the mobility was never trained',
      'Feet dropping below the shoulders as the hold goes on',
    ],
    whyItMatters:
      'The straddle is the first lever that reads as the finished skill, and from here the full lever is a narrowing rather than a new shape.',
    scheme: '3 sessions/week · 4–6 holds of 3–10s · straddle rows · lever negatives',
  },
  {
    id: 'fl-full',
    skill: 'frontlever',
    order: 5,
    name: 'Full Front Lever',
    short: 'Full',
    tagline: 'Legs together. Level.',
    keyExerciseId: 'front-lever',
    unlockSec: 8,
    startSec: 2,
    description:
      'Legs together, body one rigid level line under the bar. The lever is at its longest. From a solid straddle the route is narrowing the legs a little at a time.',
    formChecks: [
      'Shoulders, hips and heels level — one straight line',
      'Legs together, knees locked, toes pointed',
      'Arms locked; the shoulders stay pulled down at full effort',
      'Head neutral, eyes on the bar or the ceiling',
    ],
    mistakes: [
      'Counting a lever with the hips piked or the feet well below the shoulders',
      'Bent arms to make the line',
      'Dropping the straddle and tuck volume the moment fulls begin',
    ],
    whyItMatters: 'The summit of this road: every step below it was built so this line can be held for a few seconds.',
    scheme: '2–3 quality sessions/week · low volume, long rests · film the holds',
  },
]

/**
 * Rows trail the hold: the coaching chart that lists both puts each row a level
 * or two above the hold of the same shape, so a step rows in the shape before
 * it — and, like the planche's push-ups, one further back until the hold is
 * half-way to its bar.
 */
const ROW_NOTE = 'The lever, moved: rows in the tuck you already hold.'

const exercises: Exercise[] = [
  // ————— Front lever line —————
  {
    id: 'active-hang',
    name: 'Active Hang',
    category: 'lever',
    skill: 'frontlever',
    type: 'hold',
    difficulty: 1,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb:
      'A straight-arm hang with the shoulders pulled down away from the ears. The starting position of every lever, held on purpose.',
    howTo: [
      'Hang from the bar with the thumbs wrapped, hands about shoulder width.',
      'Keeping the arms straight, pull the shoulders down — the neck gets longer, the body rises a few centimetres.',
      'Ribs down, legs together and slightly in front of you. Hold still.',
      'Lower the shoulders back up under control before letting go.',
    ],
    cues: ['Long neck', 'Arms stay straight', 'Still, not swinging'],
    mistakes: ['Shoulders creeping up to the ears', 'Bending the elbows to hold the position', 'Swinging'],
    muscles: ['Lats', 'Lower traps', 'Grip', 'Core'],
  },
  {
    id: 'tuck-front-lever',
    name: 'Tuck Front Lever',
    category: 'lever',
    skill: 'frontlever',
    type: 'hold',
    difficulty: 3,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb: 'Knees to the chest, back close to level, arms straight. The first true lever hold.',
    howTo: [
      'From an active hang, pull the knees tight to the chest.',
      'With straight arms, pull the bar toward your hips so the hips rise and the back turns level.',
      'Hold with the hips near shoulder height and the shoulders set down and back.',
      'Lower the hips under control; do not drop out of it.',
    ],
    cues: ['Bar to the hips, arms straight', 'Knees glued to the chest', 'Back level'],
    mistakes: ['Bent arms', 'Hips well below the shoulders', 'Swinging in and out'],
    muscles: ['Lats', 'Rear delts', 'Core', 'Grip'],
  },
  {
    id: 'adv-tuck-front-lever',
    name: 'Advanced Tuck Front Lever',
    category: 'lever',
    skill: 'frontlever',
    type: 'hold',
    difficulty: 4,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb: 'Tuck front lever with a flat, level back and the hips opened to about 90°.',
    howTo: [
      'Start in a level tuck front lever.',
      'Flatten the back and open the hips until the thighs point at the ceiling.',
      'Keep pulling the bar toward the hips with straight arms; the hips want to sink.',
      'Hold level, then re-tuck to come down.',
    ],
    cues: ['Back flat like a table', 'Thighs to the ceiling', 'Hips up'],
    mistakes: ['A rounded back sneaking back in', 'Hips sinking', 'Elbows softening'],
    muscles: ['Lats', 'Rear delts', 'Lower back', 'Core'],
  },
  {
    id: 'one-leg-front-lever',
    name: 'One-Leg Front Lever',
    category: 'lever',
    skill: 'frontlever',
    type: 'hold',
    difficulty: 4,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb: 'Advanced tuck with one leg extended in line with the body. The bridge to the straddle.',
    howTo: [
      'Hold a level advanced tuck front lever.',
      'Extend one leg straight out, level with the body, toes pointed.',
      'Keep the hips level and the other knee tucked.',
      'Re-tuck, rest, and repeat with the other leg.',
    ],
    cues: ['Leg long and level', 'Hips do not drop', 'Even sets each leg'],
    mistakes: ['The long leg hanging low', 'Hips sinking', 'Favouring one leg'],
    muscles: ['Lats', 'Core', 'Glutes', 'Hip flexors'],
    perSide: true,
  },
  {
    id: 'straddle-front-lever',
    name: 'Straddle Front Lever',
    category: 'lever',
    skill: 'frontlever',
    type: 'hold',
    difficulty: 5,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb: 'Both legs straight and wide, body level. The first lever that looks like the finished skill.',
    howTo: [
      'From an advanced tuck, extend both legs out and wide.',
      'Open the hips fully — squeeze the glutes so the feet rise level with the shoulders.',
      'Pull the bar toward the hips with locked arms.',
      'Hold level; tuck to come down.',
    ],
    cues: ['Wider legs, cheaper hold', 'Hips open', 'Level line, no V'],
    mistakes: ['Piked hips', 'Feet below the shoulders', 'A narrow straddle'],
    muscles: ['Lats', 'Core', 'Glutes', 'Rear delts'],
  },
  {
    id: 'front-lever',
    name: 'Front Lever',
    category: 'lever',
    skill: 'frontlever',
    type: 'hold',
    difficulty: 5,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb: 'Legs together, body rigid and level beneath the bar. The summit.',
    howTo: [
      'From a straddle front lever, draw the legs together.',
      'Keep the hips open and the whole body tight — glutes, quads, pointed toes.',
      'Hold one level line from shoulders to heels with locked arms.',
      'Straddle out or tuck to come down.',
    ],
    cues: ['One rigid line', 'Legs zipped together', 'Bar to the hips'],
    mistakes: ['Hips piked', 'Feet low', 'Bent arms'],
    muscles: ['The whole back of the chain', 'Lats', 'Core'],
  },
  {
    id: 'band-front-lever',
    name: 'Band-Assisted Front Lever',
    category: 'lever',
    skill: 'frontlever',
    type: 'hold',
    difficulty: 3,
    equipment: ['Pull-up bar', 'Resistance band'],
    requires: ['pullup-bar', 'band'],
    blurb:
      'The lever shape with a band under the hips. Practice in the real position with help — a band is a nickname, not a measured amount of help, so keep the band and its anchor the same to compare sessions.',
    howTo: [
      'Loop a band over the bar and step or sit your hips into it.',
      'Take the lever shape you are working toward, the band carrying part of you.',
      'Hold the true shape — level, hips open, arms locked.',
      'Come down under control.',
    ],
    cues: ['Same form rules as the free hold', 'Band at the hips, not the knees'],
    mistakes: ['Letting the band hold a piked shape', 'Changing bands and comparing the times'],
    muscles: ['Lats', 'Core', 'Pattern practice'],
  },
  {
    id: 'fl-negative',
    name: 'Front Lever Negative',
    category: 'lever',
    skill: 'frontlever',
    type: 'reps',
    difficulty: 3,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb:
      'Lower slowly from an inverted hang through the lever in your current shape. Time spent in the hardest part of the range, at a load you can control on the way down.',
    howTo: [
      'Tuck up to an inverted hang: hips over the bar, body upside down, arms straight.',
      'Take your current lever shape — tuck, advanced tuck, straddle.',
      'Lower as slowly as you can through level, arms locked, about three to five seconds.',
      'Finish in an active hang, tuck back up and repeat.',
    ],
    cues: ['Slow through level', 'Arms stay locked', 'Same shape top to bottom'],
    mistakes: ['Dropping through the level part', 'Bending the arms to slow down', 'Opening the shape past what you hold'],
    muscles: ['Lats', 'Core', 'Rear delts'],
  },
  // ————— Pulling strength —————
  {
    id: 'scap-pull',
    name: 'Scapular Pull',
    category: 'pull',
    type: 'reps',
    difficulty: 1,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb: 'From a dead hang, pull the shoulders down with straight arms and let them rise again. The first inch of every pull.',
    howTo: [
      'Hang with straight arms and relaxed shoulders.',
      'Without bending the elbows, pull the shoulders down — the body rises a few centimetres.',
      'Pause, then let the shoulders rise slowly.',
    ],
    cues: ['Elbows stay straight', 'Long neck at the top', 'Slow on the way back'],
    mistakes: ['Bending the arms', 'Bouncing', 'Shrugging instead of pulling down'],
    muscles: ['Lower traps', 'Lats', 'Grip'],
  },
  {
    id: 'pullup',
    name: 'Pull-Up',
    category: 'pull',
    type: 'reps',
    difficulty: 2,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb: 'The baseline vertical pull. Full range, no swing.',
    howTo: [
      'Start from an active hang, hands a little wider than the shoulders.',
      'Pull until the chin clears the bar, elbows driving down.',
      'Lower all the way to straight arms under control.',
    ],
    cues: ['Chest to the bar', 'Full hang at the bottom', 'No kip'],
    mistakes: ['Half reps', 'Swinging', 'Chin poking forward to reach'],
    muscles: ['Lats', 'Biceps', 'Rear delts', 'Grip'],
  },
  {
    id: 'negative-pullup',
    name: 'Pull-Up Negative',
    category: 'pull',
    type: 'reps',
    difficulty: 1,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb:
      'Start at the top of a pull-up and lower slowly. The same pattern at a load more people can repeat — a step toward pull-ups, with its own record.',
    howTo: [
      'Jump or step up so the chin is over the bar.',
      'Lower as slowly as you can, about three to five seconds, to straight arms.',
      'Step back up and repeat.',
    ],
    cues: ['Slow all the way down', 'Finish at straight arms'],
    mistakes: ['Dropping the last half', 'Skipping the straight-arm finish'],
    muscles: ['Lats', 'Biceps', 'Grip'],
  },
  {
    id: 'tuck-fl-row',
    name: 'Tuck Front Lever Row',
    category: 'pull',
    skill: 'frontlever',
    type: 'reps',
    difficulty: 3,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb: 'From a tuck front lever, pull the hips toward the bar and lower back to straight arms. The lever, moved.',
    howTo: [
      'Hold a level tuck front lever.',
      'Pull the bar toward your hips by bending the elbows, keeping the back level.',
      'Lower to locked arms without letting the hips drop.',
    ],
    cues: ['Back stays level', 'Bar to the hips', 'Lock out every rep'],
    mistakes: ['Hips dropping as the arms straighten', 'Turning it into a tucked pull-up', 'Cutting the lockout'],
    muscles: ['Lats', 'Rear delts', 'Biceps', 'Core'],
  },
  {
    id: 'adv-tuck-fl-row',
    name: 'Advanced Tuck Front Lever Row',
    category: 'pull',
    skill: 'frontlever',
    type: 'reps',
    difficulty: 4,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb: 'Rows from a flat-backed advanced tuck lever. The same pull at a longer lever.',
    howTo: [
      'Hold a level advanced tuck front lever.',
      'Row the bar toward the hips, back flat throughout.',
      'Lower to locked arms under control.',
    ],
    cues: ['Flat back, level', 'Hips do not sink', 'Lock out'],
    mistakes: ['Rounding into a tuck to finish the rep', 'Hips sinking at the bottom'],
    muscles: ['Lats', 'Rear delts', 'Biceps', 'Core'],
  },
  {
    id: 'straddle-fl-row',
    name: 'Straddle Front Lever Row',
    category: 'pull',
    skill: 'frontlever',
    type: 'reps',
    difficulty: 5,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb: 'Rows from a straddle front lever. Few people repeat many; a clean single counts.',
    howTo: [
      'Hold a level straddle front lever.',
      'Row the bar toward the hips with the body one level line.',
      'Lower to locked arms without piking.',
    ],
    cues: ['Level line', 'Hips open', 'Lock out'],
    mistakes: ['Piking to pull', 'Feet dropping'],
    muscles: ['Lats', 'Rear delts', 'Biceps', 'Core'],
  },
  {
    id: 'fl-row',
    name: 'Front Lever Row',
    category: 'pull',
    skill: 'frontlever',
    type: 'reps',
    difficulty: 5,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb: 'Rows from a full front lever. The end of the pulling line.',
    howTo: [
      'Hold a full front lever.',
      'Row the bar toward the hips, the body rigid and level.',
      'Lower to locked arms and hold the line.',
    ],
    cues: ['One rigid line', 'Bar to the hips', 'Lock out'],
    mistakes: ['Piking', 'Feet dropping', 'Half range'],
    muscles: ['Lats', 'Rear delts', 'Biceps', 'Core'],
  },
  // ————— Hanging core —————
  {
    id: 'hanging-knee-raise',
    name: 'Hanging Knee Raise',
    category: 'core',
    type: 'reps',
    difficulty: 1,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb: 'From an active hang, bring the knees to the chest without swinging. Compression for the tuck.',
    howTo: [
      'Hang with the shoulders set down.',
      'Curl the knees up to the chest, rounding the lower back a little at the top.',
      'Lower slowly and stop the swing before the next rep.',
    ],
    cues: ['No swing', 'Knees to the chest, not just up', 'Slow down'],
    mistakes: ['Swinging', 'Lifting only the thighs'],
    muscles: ['Abs', 'Hip flexors', 'Grip'],
  },
  {
    id: 'hanging-leg-raise',
    name: 'Hanging Leg Raise',
    category: 'core',
    type: 'reps',
    difficulty: 3,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb: 'Straight legs raised from a hang, to level or beyond. The trunk strength that holds a long lever level.',
    howTo: [
      'Hang with the shoulders set down and the legs straight.',
      'Raise the legs to level — or to the bar — without swinging.',
      'Lower over about three seconds.',
    ],
    cues: ['Legs straight', 'No swing', 'Slow on the way down'],
    mistakes: ['Bending the knees to finish', 'Kicking up with a swing'],
    muscles: ['Abs', 'Hip flexors', 'Lats', 'Grip'],
  },
  // ————— Hang prep and stretch —————
  {
    id: 'dead-hang',
    name: 'Dead Hang',
    category: 'general',
    type: 'hold',
    difficulty: 1,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb: 'A relaxed hang with the shoulders loose. Grip and shoulders meet the bar before anything is asked of them.',
    howTo: [
      'Hang from the bar with a full grip and let the shoulders relax upward.',
      'Breathe; let the body be long.',
      'Step down rather than dropping.',
    ],
    cues: ['Relaxed, long', 'Full grip'],
    mistakes: ['Holding the breath', 'Dropping off the bar'],
    muscles: ['Grip', 'Lats', 'Shoulders'],
  },
  {
    id: 'lat-stretch',
    name: 'Lat Stretch',
    category: 'mobility',
    type: 'hold',
    difficulty: 1,
    equipment: ['Floor or a low support'],
    blurb: 'Kneeling with the hands on the floor or a support in front, hips sitting back. A long stretch down the sides after pulling work.',
    howTo: [
      'Kneel and reach both hands forward on the floor or onto a low support.',
      'Sit the hips back toward the heels and let the chest sink.',
      'Breathe into the sides of the back; hold.',
    ],
    cues: ['Hips back', 'Chest heavy', 'Ease in over breaths'],
    mistakes: ['Forcing the range', 'Arching the lower back to go further'],
    muscles: ['Lats', 'Shoulders', 'Upper back'],
  },
]

export const FRONT_LEVER: SkillDef = {
  id: 'frontlever',
  name: 'Front lever',
  short: 'Lever',
  holdName: 'front lever',
  tagline: 'Level under the bar, arms straight',
  blurb:
    'Hanging from a bar with the body held level, face up, on straight arms. It is the planche’s pulling counterpart — lats and trunk where the planche is shoulders and chest — and the two are commonly trained side by side.',
  family: 'pull',
  straightArm: true,
  surfaces: false,
  requires: [['pullup-bar', 'rings']],
  requiresNote: 'The front lever needs something to hang from: a pull-up bar or rings.',
  loads: ['elbow', 'shoulder', 'lower-back'],
  camera: {
    view: 'side',
    placement: 'Phone side-on to the bar at about chest height, far enough back to keep hands and feet in frame.',
    honesty:
      'From the side the camera reads hip opening, straight legs and whether hips and shoulders are level — a hang with the hips low is named, not passed. Of your arms it sees only a large bend: hanging, a small one does not show, so you confirm the lockout on the replay. It cannot see the shoulder blades, and it cannot tell a foot brushing the floor or a band from a free hold — you confirm those too.',
  },
  sourcing:
    'Coaches share the outline — tuck, a flat-backed tuck, then longer shapes to the full lever — and differ on the middle and on every number: named coaches’ hold-time bars run from 10–15 seconds to 60, and two of the most systematic sources set none. The bars here are this app’s choices inside that spread; no study of the hold was found.',
  prerequisites: [
    'Coaches ask for a base of pulling and straight-arm work first — one names five pull-ups and a 30-second inverted hang; another says pull-up strength alone is not enough. The Foundations step builds the hang, the shoulder control and the pull-ups.',
  ],
  safety: [
    'Coaches describe the levers as heavy on the shoulders and taxing on the joints. Stop and reassess on pain, step back a shape rather than push through, and treat pain that builds from week to week as the signal to back off.',
    'Come down under control: lower the hips rather than dropping out of a lever.',
  ],
  frequency: 'Coaches commonly train it two or three times a week, often in the same session as the planche — a pull beside a push.',
  steps: FRONT_LEVER_STEPS,
  defaultGoal: 'fl-full',
  words: {
    strength: 'pulling',
    strengthVerb: 'pull',
    support: 'hangs and negatives',
    contact: 'the bar',
    summit: 'the full front lever',
  },
  holdAggregateSec: 60,
  program: {
    warmup: [
      { exerciseId: 'arm-circles', sets: 1, amount: 10, rest: 10, skipWhenShort: true },
      { exerciseId: 'dead-hang', sets: 1, amount: 20, rest: 20 },
      { exerciseId: 'scap-pull', sets: 1, amount: 8, rest: 25, skipWhenShort: true },
    ],
    primer: (stepId) =>
      stepId === 'fl-hang'
        ? undefined
        : {
            exerciseId: 'tuck-front-lever',
            sets: 1,
            amount: 5,
            rest: 40,
            note: 'Easy primer — a short, comfortable tuck to find the straight-arm pull before the work.',
          },
    steps: {
      'fl-hang': {
        twin: { exerciseId: 'pullup', sets: 3, amount: 5, rest: 'accessory', note: 'Full range, no swing. The pulling strength the lever is built on.' },
        support: {
          exerciseId: 'scap-pull',
          sets: 3,
          amount: 8,
          rest: 'accessory',
          note: 'Straight-arm shoulder control — the first inch of every lever. Elbows locked, slow on the way back.',
        },
        core: [
          { exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 },
          { exerciseId: 'hanging-knee-raise', sets: 2, amount: 8, rest: 45, note: 'No swing — stop each rep still.' },
        ],
      },
      'fl-tuck': {
        twin: { exerciseId: 'pullup', sets: 3, amount: 6, rest: 'accessory', note: 'Bent-arm pulling strength behind the lever: full range, no swing.' },
        support: {
          exerciseId: 'fl-negative',
          sets: 3,
          amount: 3,
          rest: 'accessory',
          note: 'Straight-arm strength through the whole range: lower from inverted through your tuck as slowly as you can.',
        },
        core: [
          { exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 },
          { exerciseId: 'hanging-knee-raise', sets: 2, amount: 10, rest: 45 },
        ],
        transition: {
          exerciseId: 'fl-negative',
          sets: 2,
          amount: 2,
          rest: 'accessory',
          note: 'The transition itself: lower with the back a little flatter than your tuck, and re-tuck before the bottom.',
        },
        bridgeCue: ' Bridge open: hold each tuck with the back a little flatter than last week.',
      },
      'fl-advtuck': {
        twin: { exerciseId: 'tuck-fl-row', sets: 3, amount: 4, rest: 'main', note: ROW_NOTE },
        strength: { exerciseId: 'pullup', sets: 3, amount: 6, rest: 'accessory', note: 'Bent-arm pulling strength behind the lever. Full range.' },
        support: {
          exerciseId: 'fl-negative',
          sets: 3,
          amount: 3,
          rest: 'accessory',
          note: 'Lower from inverted through a flat-backed advanced tuck — slow through level, arms locked.',
        },
        core: [
          { exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 },
          { exerciseId: 'hanging-leg-raise', sets: 2, amount: 6, rest: 60 },
        ],
        bridgeCue: ' Bridge open: keep the back level while one leg starts to reach out.',
      },
      'fl-oneleg': {
        twin: {
          exerciseId: 'adv-tuck-fl-row',
          sets: 3,
          amount: 4,
          rest: 'main',
          note: 'The lever, moved: rows from the flat-backed tuck this step is built on.',
        },
        strength: { exerciseId: 'pullup', sets: 3, amount: 6, rest: 'accessory', note: 'Bent-arm pulling strength behind the lever. Full range.' },
        support: {
          exerciseId: 'fl-negative',
          sets: 3,
          amount: 3,
          rest: 'accessory',
          note: 'Lower from inverted with one leg long, alternating legs each rep. Slow through level.',
        },
        assisted: {
          exerciseId: 'band-front-lever',
          sets: 3,
          amount: 10,
          rest: 'accessory',
          note: 'Straddle shape with the band under the hips — the next position rehearsed with help. Never counts toward the unassisted unlock.',
        },
        core: [
          { exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 },
          { exerciseId: 'hanging-leg-raise', sets: 2, amount: 8, rest: 60 },
        ],
        mobility: { exerciseId: 'pancake-stretch', sets: 1, amount: 40, rest: 10, note: 'A wider straddle is a shorter lever. Practice time, not a measure of lever strength.' },
      },
      'fl-straddle': {
        twin: { exerciseId: 'adv-tuck-fl-row', sets: 3, amount: 4, rest: 'main', note: 'The lever, moved: rows from the flat-backed tuck.' },
        strength: { exerciseId: 'pullup', sets: 3, amount: 8, rest: 'accessory', note: 'Bent-arm pulling strength behind the lever. Full range.' },
        support: {
          exerciseId: 'fl-negative',
          sets: 3,
          amount: 3,
          rest: 'accessory',
          note: 'Lower from inverted through the straddle — hips open, slow through level.',
        },
        assisted: {
          exerciseId: 'band-front-lever',
          sets: 3,
          amount: 10,
          rest: 'accessory',
          note: 'Full shape with the band under the hips — same form rules as the free hold, same band every time. Never counts toward the unassisted unlock.',
        },
        core: [
          { exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 },
          { exerciseId: 'hanging-leg-raise', sets: 2, amount: 8, rest: 60 },
        ],
        mobility: { exerciseId: 'pancake-stretch', sets: 1, amount: 40, rest: 10 },
        bridgeCue: ' Bridge open: narrow the legs a few degrees at a time, keeping the line level.',
      },
      'fl-full': {
        twin: { exerciseId: 'straddle-fl-row', sets: 3, amount: 2, rest: 'main', note: 'The lever, moved: rows with the legs out wide.' },
        strength: { exerciseId: 'pullup', sets: 3, amount: 8, rest: 'accessory', note: 'Bent-arm pulling strength behind the lever. Full range.' },
        support: {
          exerciseId: 'fl-negative',
          sets: 3,
          amount: 3,
          rest: 'accessory',
          note: 'Full-lever negatives: lower from inverted in one rigid line, as slowly as you can.',
        },
        core: [
          { exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 },
          { exerciseId: 'hanging-leg-raise', sets: 2, amount: 8, rest: 60 },
        ],
      },
    },
    cooldown: [
      { exerciseId: 'dead-hang', sets: 1, amount: 20, rest: 10, note: 'Relaxed — let the shoulders and grip unwind.' },
      { exerciseId: 'lat-stretch', sets: 1, amount: 30, rest: 10 },
    ],
  },
  issues: {
    arms: {
      label: 'elbows bending',
      limiter: 'Straight-arm strength',
      emphasis: 'lockout',
      prescription:
        'Straight-arm work gets the extra sets: slow lever negatives and active hangs with the elbows locked, and every main hold ends the moment the lock goes. Pull-ups stay in the session, but they are not the fix for a soft elbow.',
    },
    sag: {
      label: 'hips dropping below the shoulders',
      limiter: 'Body-line strength',
      emphasis: 'core',
      prescription: 'Hollow-body and hanging leg-raise work target the line that is dropping under fatigue.',
    },
    pike: {
      label: 'hips riding above the shoulders',
      limiter: 'Body-line control',
      emphasis: 'core',
      prescription: 'Hollow-body work at a level line reinforces the position the hold keeps drifting out of.',
    },
    closed: {
      label: 'hips not opening enough',
      limiter: 'Hip opening',
      emphasis: 'core',
      prescription: 'Arch and hollow work target the open hip the longer lever needs; glutes are what hold it there.',
    },
    knees: {
      label: 'knees bending',
      limiter: 'Whole-body tension',
      emphasis: 'core',
      prescription: 'Body-line work reinforces active leg tension without adding more max-effort attempts.',
    },
  },
  exercises,
}
