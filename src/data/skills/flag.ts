import type { Exercise, StepDef } from '../../types'
import type { SkillDef } from './types'

/**
 * The human flag road.
 *
 * Gripping an upright pole with one hand high and one low, the body held out
 * sideways and level: the bottom arm pushes, the top arm pulls, and the side
 * of the trunk holds the rest. What the coaches who teach it share is thin but
 * consistent — start near vertical, where the lever is short, bring the body
 * down toward level, shorten the legs before the full shape, train both sides
 * — and this road follows it: the grip and the push–pull with the feet still
 * down, the vertical flag, then tuck, one leg, straddle, full.
 *
 * It is one-sided by nature (a flag has a top hand), so every hold is logged
 * per side and a step opens on the weaker one, as the one-leg planche does.
 *
 * Sourcing is much thinner than for the front lever (ledger §13): no study of
 * the hold was found, the only named-coach numbers are for the early holds
 * (a vertical flag of 20–30 s), and no coach's standard for the full flag
 * could be verified. Every bar past the vertical flag is this app's design.
 */
export const FLAG_STEPS: StepDef[] = [
  {
    id: 'flag-foundations',
    skill: 'flag',
    order: 0,
    name: 'Foundations',
    short: 'Foundations',
    tagline: 'The grip, the push and the pull',
    keyExerciseId: 'supported-flag',
    unlockSec: 15,
    startSec: 5,
    description:
      'Hands set on the pole — one low, one high — and the body leaned out sideways with the feet still on the ground. The bottom arm locks and pushes, the top arm pulls, and you take as much weight off the feet as you control. This is where the grip and the push–pull are learned, at a load you choose; the session’s pull-ups and pike push-ups build the two arms behind it.',
    formChecks: [
      'Bottom arm locked and pushing the pole away',
      'Top arm long and pulling; shoulders set, not sunk toward the pole',
      'Chest facing forward, hips and shoulders square',
      'Both sides trained, the weaker one first',
    ],
    mistakes: [
      'A bent bottom arm',
      'Hands too close together to push and pull against each other',
      'Only training the stronger side',
    ],
    whyItMatters:
      'Every later step is this push and pull with more of you hanging from it. Finding the hand positions and the locked bottom arm with the feet down is the cheapest place to find them.',
    scheme: '2–3 sessions/week · supported holds 3×5–15s a side · pull-ups · pike push-ups · side plank',
  },
  {
    id: 'flag-vertical',
    skill: 'flag',
    order: 1,
    name: 'Vertical Flag',
    short: 'Vertical',
    tagline: 'Up the pole: grip, push, pull',
    keyExerciseId: 'vertical-flag',
    unlockSec: 20,
    startSec: 5,
    description:
      'Grip the pole — bottom arm locked and pushing, top arm pulling — and kick up until the body is upside down along it, hips above the shoulders. With the body over the hands there is almost no lever to hold, so this is where the grip, the locked bottom arm and the push–pull are learned.',
    formChecks: [
      'Bottom arm locked, pushing the pole away',
      'Top arm long, pulling; shoulders set, not collapsed toward the pole',
      'Hips stacked above the shoulders, body close to upright',
      'A controlled way up and a controlled way down',
    ],
    mistakes: [
      'A bent bottom arm — the body then sinks into the pole',
      'Throwing the legs up and falling past upright',
      'Hands too close together to push and pull against each other',
    ],
    whyItMatters:
      'Every flag is entered from here and lowered out to the side. A locked bottom arm and a calm inverted position are what make the lowering possible.',
    scheme: '2–3 sessions/week · 3 holds a side of 5–20s · flag negatives when ready',
  },
  {
    id: 'flag-tuck',
    skill: 'flag',
    order: 2,
    name: 'Tuck Flag',
    short: 'Tuck',
    tagline: 'Out to the side, knees in',
    keyExerciseId: 'tuck-flag',
    unlockSec: 10,
    startSec: 3,
    description:
      'From the vertical flag, lower the hips out to the side with the knees tucked, until the trunk is level. The lever is as short as it can be while still being a flag. Expect a few seconds at first.',
    formChecks: [
      'Trunk level, out to the side of the pole',
      'Bottom arm locked and pushing, top arm pulling',
      'Chest facing forward — hips and shoulders square, not rolled toward the floor',
      'Knees tucked in line with the body',
    ],
    mistakes: [
      'The hips hanging below the shoulders',
      'Rotating to face the floor, which turns it into a different hold',
      'The bottom elbow bending as the body goes out',
    ],
    whyItMatters:
      'The first true flag: the same push, pull and side line as the full one, at the shortest lever.',
    scheme: '2–3 sessions/week · 4–6 holds of 3–8s · flag negatives · side plank kept',
  },
  {
    id: 'flag-oneleg',
    skill: 'flag',
    order: 3,
    name: 'One-Leg Flag',
    short: 'One-leg',
    tagline: 'One leg long',
    keyExerciseId: 'one-leg-flag',
    unlockSec: 8,
    startSec: 3,
    description:
      'The tuck flag with one leg extended in line with the body and the other still tucked. A step toward the straddle that lengthens the lever by half.',
    formChecks: [
      'Extended leg straight and level with the trunk',
      'Trunk still level; hips do not drop as the leg goes out',
      'Both arms as in the tuck: bottom locked, top pulling',
      'Chest stays square to the front',
    ],
    mistakes: ['The long leg hanging low', 'Hips dropping', 'Rolling toward the floor'],
    whyItMatters: 'Shows the level line survives a longer lever before both legs go out.',
    scheme: '2–3 sessions/week · 4–5 holds of 3–6s · tuck holds as back-off',
  },
  {
    id: 'flag-straddle',
    skill: 'flag',
    order: 4,
    name: 'Straddle Flag',
    short: 'Straddle',
    tagline: 'Both legs out, apart',
    keyExerciseId: 'straddle-flag',
    unlockSec: 6,
    startSec: 2,
    description:
      'Both legs straight and spread, body level. Spreading the legs brings their weight closer to the pole, which is what makes this hold reachable before the full flag.',
    formChecks: [
      'Shoulders and hips level, legs straight and apart',
      'Bottom arm locked, top arm pulling',
      'Body square to the front',
      'No fold at the waist',
    ],
    mistakes: ['Folding at the waist so the legs hang', 'Feet well below the hips', 'A bent bottom arm'],
    whyItMatters: 'The first flag that reads as the finished skill; from here it is a narrowing.',
    scheme: '2–3 sessions/week · 4–5 holds of 2–6s · negatives · one-leg holds as back-off',
  },
  {
    id: 'flag-full',
    skill: 'flag',
    order: 5,
    name: 'Human Flag',
    short: 'Full',
    tagline: 'Legs together. Level.',
    keyExerciseId: 'human-flag',
    unlockSec: 5,
    startSec: 2,
    description:
      'Legs together, body one level line out from the pole, both arms straight. The summit of this road.',
    formChecks: [
      'Shoulders, hips and feet on one level line',
      'Both arms straight: bottom pushing, top pulling',
      'Chest square to the front, legs together',
      'Held still, then lowered or returned to vertical under control',
    ],
    mistakes: ['Feet above or below level being counted as level', 'A fold at the waist', 'Dropping off the pole to finish'],
    whyItMatters: 'The summit: every step below it was built so this line can be held for a few seconds.',
    scheme: '2 quality sessions/week · low volume, long rests · film from the front',
  },
]

const exercises: Exercise[] = [
  // ————— Flag line —————
  {
    id: 'supported-flag',
    name: 'Supported Flag Hold',
    category: 'flag',
    skill: 'flag',
    type: 'hold',
    difficulty: 2,
    equipment: ['Sturdy upright pole or stall bars'],
    requires: ['pole'],
    blurb:
      'Hands set on the pole and the body leaned out sideways with the feet still down. The grip and the push–pull of a flag, at a load you choose.',
    howTo: [
      'Bottom hand low on the pole, about hip height, fingers pointing down and the arm locked; top hand high, above your head.',
      'Stand side-on to the pole, a step away, and lean your body out away from it.',
      'Push with the bottom arm and pull with the top until your feet are only lightly on the ground.',
      'Hold, then stand back up. Swap hands for the same time.',
    ],
    cues: ['Bottom arm locked', 'Push low, pull high', 'Light feet'],
    mistakes: ['Bent bottom arm', 'Hands too close together', 'Favouring one side'],
    muscles: ['Shoulders', 'Lats', 'Obliques', 'Grip'],
    perSide: true,
  },
  {
    id: 'side-plank',
    name: 'Side Plank',
    category: 'core',
    type: 'hold',
    difficulty: 1,
    equipment: ['Floor'],
    blurb: 'On one straight arm and the side of the feet, body a straight line. Side-of-trunk strength — coaches who teach the flag name the top-side obliques as a common weak link.',
    howTo: [
      'From a push-up position, turn onto one hand and the outside edge of the same-side foot.',
      'Stack the feet, hips and shoulders; reach the top arm up.',
      'Push the floor away and hold one straight line. Swap sides for the same time.',
    ],
    cues: ['Hips up, in line', 'Chest square to the front', 'Push the floor away'],
    mistakes: ['Hips sagging', 'Rolling forward', 'Favouring one side'],
    muscles: ['Obliques', 'Shoulder', 'Glutes'],
    perSide: true,
  },
  {
    id: 'vertical-flag',
    name: 'Vertical Flag',
    category: 'flag',
    skill: 'flag',
    type: 'hold',
    difficulty: 3,
    equipment: ['Sturdy upright pole or stall bars'],
    requires: ['pole'],
    blurb: 'Gripping the pole and held upside down along it, bottom arm locked. The position a flag is lowered from.',
    howTo: [
      'Bottom hand low on the pole, fingers pointing down, arm locked; top hand high, about a metre above, palm facing forward.',
      'Push with the bottom arm, pull with the top, and kick up until the hips are above the shoulders.',
      'Hold upside down, close to the pole, with the bottom arm locked.',
      'Come down the way you went up, feet first.',
    ],
    cues: ['Bottom arm locked', 'Push low, pull high', 'Hips over shoulders'],
    mistakes: ['Bent bottom arm', 'Kicking past upright', 'Hands too close together'],
    muscles: ['Shoulders', 'Lats', 'Obliques', 'Grip'],
    perSide: true,
  },
  {
    id: 'tuck-flag',
    name: 'Tuck Flag',
    category: 'flag',
    skill: 'flag',
    type: 'hold',
    difficulty: 4,
    equipment: ['Sturdy upright pole or stall bars'],
    requires: ['pole'],
    blurb: 'Trunk level out from the pole with the knees tucked. The first true flag.',
    howTo: [
      'Get into a vertical flag.',
      'Keeping the bottom arm locked, lower the hips out to the side with the knees tucked.',
      'Stop with the trunk level and the chest facing forward; hold.',
      'Return to vertical or lower the feet under control.',
    ],
    cues: ['Bottom arm locked', 'Chest forward, not down', 'Trunk level'],
    mistakes: ['Hips below the shoulders', 'Rolling toward the floor', 'Bottom elbow bending'],
    muscles: ['Obliques', 'Shoulders', 'Lats', 'Grip'],
    perSide: true,
  },
  {
    id: 'one-leg-flag',
    name: 'One-Leg Flag',
    category: 'flag',
    skill: 'flag',
    type: 'hold',
    difficulty: 4,
    equipment: ['Sturdy upright pole or stall bars'],
    requires: ['pole'],
    blurb: 'Tuck flag with one leg extended in line with the trunk.',
    howTo: [
      'Hold a level tuck flag.',
      'Extend one leg straight out, level with the trunk.',
      'Keep the other knee tucked and the hips level; hold.',
      'Re-tuck and come down under control.',
    ],
    cues: ['Leg long and level', 'Hips level', 'Bottom arm locked'],
    mistakes: ['The long leg low', 'Hips dropping', 'Rolling'],
    muscles: ['Obliques', 'Shoulders', 'Lats', 'Glutes'],
    perSide: true,
  },
  {
    id: 'straddle-flag',
    name: 'Straddle Flag',
    category: 'flag',
    skill: 'flag',
    type: 'hold',
    difficulty: 5,
    equipment: ['Sturdy upright pole or stall bars'],
    requires: ['pole'],
    blurb: 'Both legs straight and apart, body level out from the pole.',
    howTo: [
      'From a vertical flag, open the legs and lower the body out to the side.',
      'Stop level, legs straight and apart, chest facing forward.',
      'Hold; return to vertical or lower under control.',
    ],
    cues: ['Legs straight', 'No fold at the waist', 'Level'],
    mistakes: ['Folding at the waist', 'Feet low', 'Bent bottom arm'],
    muscles: ['Obliques', 'Shoulders', 'Lats', 'Glutes'],
    perSide: true,
  },
  {
    id: 'human-flag',
    name: 'Human Flag',
    category: 'flag',
    skill: 'flag',
    type: 'hold',
    difficulty: 5,
    equipment: ['Sturdy upright pole or stall bars'],
    requires: ['pole'],
    blurb: 'Legs together, body one level line out from the pole. The summit.',
    howTo: [
      'From a straddle flag, bring the legs together — or lower from vertical with them together.',
      'Hold shoulders, hips and feet level, both arms straight.',
      'Lower the feet or return to vertical under control.',
    ],
    cues: ['One rigid line', 'Push low, pull high', 'Square to the front'],
    mistakes: ['Feet off level', 'A fold at the waist', 'Dropping to finish'],
    muscles: ['Obliques', 'Shoulders', 'Lats', 'The whole side of the chain'],
    perSide: true,
  },
  {
    id: 'flag-negative',
    name: 'Flag Negative',
    category: 'flag',
    skill: 'flag',
    type: 'reps',
    difficulty: 4,
    equipment: ['Sturdy upright pole or stall bars'],
    requires: ['pole'],
    blurb:
      'From the vertical flag, lower out to the side as slowly as you can in your current shape. Time under the lever, at a load you control on the way down.',
    howTo: [
      'Get into a vertical flag with the bottom arm locked.',
      'Take your current shape — tuck, one leg, straddle — and lower the hips out and down over three to five seconds.',
      'Pass through level under control and put the feet down.',
      'Reset at the top for each rep.',
    ],
    cues: ['Slow through level', 'Bottom arm stays locked', 'Chest forward'],
    mistakes: ['Dropping through level', 'Bending the bottom arm to slow down', 'Rolling toward the floor'],
    muscles: ['Obliques', 'Shoulders', 'Lats'],
  },
  {
    id: 'hanging-side-raise',
    name: 'Hanging Side Knee Raise',
    category: 'core',
    type: 'reps',
    difficulty: 2,
    equipment: ['Pull-up bar or rings'],
    requires: ['pullup-bar'],
    blurb: 'From a hang, bring the knees up toward one side, then the other. Side-of-trunk strength with the grip working too.',
    howTo: [
      'Hang with the shoulders set down.',
      'Bring both knees up and across toward one elbow.',
      'Lower slowly, stop the swing, and go to the other side.',
    ],
    cues: ['No swing', 'Knees across, not just up', 'Slow down'],
    mistakes: ['Swinging', 'Twisting the shoulders instead of lifting the hips'],
    muscles: ['Obliques', 'Abs', 'Grip'],
  },
]

export const FLAG: SkillDef = {
  id: 'flag',
  name: 'Human flag',
  short: 'Flag',
  holdName: 'human flag',
  tagline: 'Out sideways from a pole, level',
  blurb:
    'Holding the body out sideways and level from an upright pole — the bottom arm pushing, the top arm pulling, the side of the trunk doing the rest. It is the one lateral skill here, and a one-sided one: a flag has a top hand, and both are worth practising.',
  family: 'lateral',
  straightArm: true,
  surfaces: false,
  requires: [['pole']],
  requiresNote: 'The flag needs a sturdy upright to grip: a fixed pole or stall bars that take your whole weight pulling sideways.',
  loads: ['shoulder', 'elbow', 'wrist', 'lower-back'],
  camera: {
    view: 'front',
    placement:
      'Phone facing you square-on — looking at your chest, the pole at one side of the picture — far enough back for hands and feet to be in frame.',
    honesty:
      'From the front the camera reads how level the body is, whether it stays one straight line, and a large bend in either arm — a small one does not show, so you confirm both arms stayed straight. It cannot see you rolling toward the floor or the camera — a flag filmed from the side cannot be judged at all — and it is the least-proven of the app’s checks, so it never stands alone: your own Clean rating, and your confirmation of anything it could not see, are needed with it.',
  },
  sourcing:
    'Thinly sourced: the order — near vertical first, then down toward level with the legs shortened — is what the coaches who teach it share, but the only named-coach numbers are for the early holds, and no verified standard exists for the full flag. Every bar past the vertical flag is this app’s design; no study of the hold was found.',
  prerequisites: [
    'Coaches who teach it ask for pulling and overhead pressing strength first, and do not agree on how much — one asks for three sets of five wall handstand push-ups, another only for “plenty” of pull-ups and handstand push-ups.',
    'A pole that will not move: it takes your whole weight pulling sideways.',
  ],
  safety: [
    'Check the pole before every session. A flag pulls sideways on it with your whole weight, which is not what most poles are fixed for.',
    'The bottom arm takes most of the load through a locked elbow and a bent wrist. Pain there, or in the shoulder, is a reason to stop rather than finish the hold.',
    'Come down feet first and on purpose; practise the way down from the vertical flag before anything else.',
    'It is one-sided: practise with each hand on top, the weaker side first. Coaches agree on training both; nothing shows that it prevents injury.',
  ],
  frequency: 'No coach source gives a frequency for the flag; two sessions a week is this app’s default for a maximal one-sided hold.',
  steps: FLAG_STEPS,
  defaultGoal: 'flag-full',
  words: {
    strength: 'pressing and pulling',
    strengthVerb: 'press',
    support: 'flag negatives',
    contact: 'the pole',
    summit: 'the full human flag',
  },
  holdAggregateSec: 45,
  program: {
    warmup: [
      { exerciseId: 'arm-circles', sets: 1, amount: 10, rest: 10, skipWhenShort: true },
      { exerciseId: 'wrist-circles', sets: 1, amount: 10, rest: 10 },
      { exerciseId: 'dead-hang', sets: 1, amount: 15, rest: 20, skipWhenShort: true },
    ],
    primer: (stepId) =>
      stepId === 'flag-foundations'
        ? undefined
        : {
            exerciseId: 'supported-flag',
            sets: 1,
            amount: 5,
            rest: 30,
            note: 'Easy primer — feet down, find the grip and the locked bottom arm on each side before any weight comes off.',
          },
    steps: {
      'flag-foundations': {
        twin: { exerciseId: 'pullup', sets: 3, amount: 5, rest: 'accessory', note: 'The top arm’s job in a flag is a pull: full range, no swing.' },
        strength: {
          exerciseId: 'pike-pushup',
          sets: 3,
          amount: 6,
          rest: 'accessory',
          note: 'The bottom arm’s job is an overhead press. Lock out every rep.',
        },
        core: [
          { exerciseId: 'side-plank', sets: 2, amount: 20, rest: 45, note: 'Side-of-trunk strength, both sides, the weaker one first.' },
          { exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 },
        ],
      },
      'flag-vertical': {
        twin: { exerciseId: 'pullup', sets: 3, amount: 6, rest: 'accessory', note: 'The top arm’s job in a flag is a pull: full range, no swing.' },
        strength: {
          exerciseId: 'pike-pushup',
          sets: 3,
          amount: 8,
          rest: 'accessory',
          note: 'The bottom arm’s job is an overhead press. Lock out every rep.',
        },
        core: [
          { exerciseId: 'side-plank', sets: 2, amount: 30, rest: 45, note: 'Both sides, the weaker one first.' },
          { exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 },
        ],
        bridgeCue: ' Bridge open: from the top of each hold, let the hips start out to the side a little before coming down.',
      },
      'flag-tuck': {
        support: {
          exerciseId: 'flag-negative',
          sets: 3,
          amount: 3,
          rest: 'main',
          note: 'Lower from vertical through your tuck as slowly as you can — bottom arm locked, chest facing forward.',
        },
        strength: { exerciseId: 'pullup', sets: 3, amount: 6, rest: 'accessory', note: 'Pulling strength for the top arm. Full range.' },
        core: [
          { exerciseId: 'side-plank', sets: 2, amount: 30, rest: 45, note: 'Both sides, the weaker one first.' },
          { exerciseId: 'hanging-side-raise', sets: 2, amount: 6, rest: 45 },
        ],
      },
      'flag-oneleg': {
        support: {
          exerciseId: 'flag-negative',
          sets: 3,
          amount: 3,
          rest: 'main',
          note: 'Lower from vertical with one leg long — slow through level, bottom arm locked.',
        },
        strength: { exerciseId: 'pullup', sets: 3, amount: 6, rest: 'accessory', note: 'Pulling strength for the top arm. Full range.' },
        core: [
          { exerciseId: 'side-plank', sets: 2, amount: 40, rest: 45, note: 'Both sides, the weaker one first.' },
          { exerciseId: 'hanging-side-raise', sets: 2, amount: 8, rest: 45 },
        ],
      },
      'flag-straddle': {
        support: {
          exerciseId: 'flag-negative',
          sets: 3,
          amount: 3,
          rest: 'main',
          note: 'Lower from vertical through the straddle — legs straight, no fold at the waist.',
        },
        strength: { exerciseId: 'pullup', sets: 3, amount: 8, rest: 'accessory', note: 'Pulling strength for the top arm. Full range.' },
        core: [
          { exerciseId: 'side-plank', sets: 2, amount: 40, rest: 45, note: 'Both sides, the weaker one first.' },
          { exerciseId: 'hanging-side-raise', sets: 2, amount: 8, rest: 45 },
        ],
        bridgeCue: ' Bridge open: narrow the legs a little at a time, keeping the line level.',
      },
      'flag-full': {
        support: {
          exerciseId: 'flag-negative',
          sets: 3,
          amount: 3,
          rest: 'main',
          note: 'Full-flag negatives: lower from vertical in one rigid line, as slowly as you can.',
        },
        strength: { exerciseId: 'pullup', sets: 3, amount: 8, rest: 'accessory', note: 'Pulling strength for the top arm. Full range.' },
        core: [
          { exerciseId: 'side-plank', sets: 2, amount: 45, rest: 45, note: 'Both sides, the weaker one first.' },
          { exerciseId: 'hanging-side-raise', sets: 2, amount: 8, rest: 45 },
        ],
      },
    },
    cooldown: [
      { exerciseId: 'lat-stretch', sets: 1, amount: 30, rest: 10 },
      { exerciseId: 'wrist-stretch', sets: 1, amount: 30, rest: 10 },
    ],
  },
  issues: {
    arms: {
      label: 'an arm bending',
      limiter: 'Locked arms',
      emphasis: 'lockout',
      prescription:
        'Vertical flag holds with the bottom arm locked get the extra time, and every hold ends when it bends. A bent bottom arm lets the body sink toward the pole.',
    },
    tilt: {
      label: 'the body off level',
      limiter: 'Level line',
      emphasis: 'core',
      prescription: 'Slow flag negatives and side planks target the level position: the strength is in holding the line as it passes through horizontal.',
    },
    closed: {
      label: 'a fold at the waist',
      limiter: 'Side-line strength',
      emphasis: 'core',
      prescription: 'Side planks and hanging side raises target the side of the trunk that is letting the legs hang.',
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
