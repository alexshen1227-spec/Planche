import type { Exercise, StepDef } from '../../types'
import type { SkillDef } from './types'

/**
 * The handstand push-up road: two lines that meet at the top.
 *
 * Balance and pressing strength grow at different speeds and neither waits for
 * the other, so they are kept apart. The *hold* road is the handstand — wall
 * line first, then balance — and runs through the same machinery as every other
 * hold. The *press* line is a rep ladder (`ladder` below) from pike push-ups to
 * the freestanding handstand push-up, with its own standards. A freestanding
 * push-up needs both, which is why they live in one skill.
 *
 * The order of both lines is what coaches broadly agree on. The numbers are
 * not: each hold time and rep standard is one coach's figure or this app's
 * own choice (ledger §13.5), and the screens say so.
 */
export const HANDSTAND_STEPS: StepDef[] = [
  {
    id: 'hs-foundations',
    skill: 'handstand',
    order: 0,
    name: 'Foundations',
    short: 'Foundations',
    tagline: 'Wrists, tall shoulders, weight on the hands',
    keyExerciseId: 'wall-plank',
    unlockSec: 30,
    startSec: 15,
    description:
      'Feet walked up a wall until the body is a steep incline, arms locked, shoulders pushed tall. It puts real weight through the wrists and open shoulders without yet being upside down — the first thing a handstand asks for, at a height that is easy to step out of.',
    formChecks: [
      'Arms locked, hands about shoulder width, weight across the whole hand',
      'Shoulders pushed tall toward the ears — the floor pushed away',
      'One straight line from wrists to hips; ribs in, no arch',
      'Wrist routine done pain-free before every session',
    ],
    mistakes: [
      'Shoulders sinking so the chest drops between the arms',
      'An arched lower back with the ribs flared',
      'Walking higher than you can step down from under control',
    ],
    whyItMatters:
      'Everything later is this with the feet higher: straight arms, shoulders pushed tall, a body that does not fold. Learning to step down calmly from here is also the first lesson in coming out of a handstand safely.',
    scheme: 'Short and often · wall plank 4×15–30s · pike push-ups · hollow hold 3×30s · wrists first',
  },
  {
    id: 'hs-wall',
    skill: 'handstand',
    order: 1,
    name: 'Wall Handstand',
    short: 'Wall',
    tagline: 'The line, with the wall’s help',
    keyExerciseId: 'wall-handstand',
    unlockSec: 60,
    startSec: 20,
    description:
      'Chest to the wall, hands a hand-length out, body stacked: wrists, shoulders, hips and ankles on one vertical line. Facing the wall makes an arched back hard to hide, which is why most coaches teach the line this way round. This is where the shape and the endurance are built.',
    formChecks: [
      'Arms locked and vertical, shoulders pushed tall and fully open',
      'Ribs in and glutes squeezed — a straight body, not a banana',
      'Legs together, knees locked, toes pointed',
      'Only the toes touch the wall',
    ],
    mistakes: [
      'An arched back with the belly toward the wall',
      'Shoulders closed, so the chest hangs in front of the hands',
      'Bent elbows as the seconds add up',
    ],
    whyItMatters:
      'A free handstand is balanced by small corrections on top of a line that is already right. Building the line with the wall first means balance practice later is spent balancing, not fixing shape.',
    scheme: '3–5 sessions/week · 3–5 holds of 20–60s · learn to step or turn out · handstand push-up line',
  },
  {
    id: 'hs-float',
    skill: 'handstand',
    order: 2,
    name: 'First Balance',
    short: 'Float',
    tagline: 'Toes off the wall',
    keyExerciseId: 'wall-float',
    unlockSec: 8,
    startSec: 2,
    repeatDays: 2,
    description:
      'From the wall handstand, take one foot and then both a few centimetres off the wall and balance there on your hands. The wall is still right behind your toes, so every attempt has a safe ending. Balance is steered through the fingers and the heel of the hand; the counted time is the time free of the wall.',
    formChecks: [
      'Both feet clear of the wall for the counted time',
      'Same line as the wall handstand — arms locked, shoulders tall',
      'Corrections from the fingers and palms, not the hips',
      'Legs together and still',
    ],
    mistakes: [
      'Pushing off the wall hard and falling away from it',
      'Bending at the hips or arching to chase balance',
      'Counting time with a toe still resting on the wall',
    ],
    whyItMatters:
      'This is where balance is learned with the fall taken out of it. Seconds here turn into freestanding seconds more directly than any amount of wall time.',
    scheme: 'Short and often · many short attempts, 2–8s free · wall holds as back-off · practise the way out',
  },
  {
    id: 'hs-free',
    skill: 'handstand',
    order: 3,
    name: 'Freestanding Handstand',
    short: 'Free',
    tagline: 'No wall. Balanced.',
    keyExerciseId: 'freestanding-handstand',
    unlockSec: 30,
    startSec: 5,
    repeatDays: 2,
    description:
      'Kicked or pressed up in open space and held. The strength was built at the wall; this is the skill of staying over your hands. Attempts are short and many, and a calm exit — a step-down or a quarter-turn out — is part of every one.',
    formChecks: [
      'A controlled entry that arrives at balance, not past it',
      'Arms locked, shoulders tall, one straight line to the toes',
      'Balance held through the hands — still hips, still legs',
      'A chosen exit, not a collapse',
    ],
    mistakes: [
      'Kicking up as hard as possible and hoping',
      'Walking on the hands to stay up — that is a different skill',
      'A banana back to keep the feet over the hands',
    ],
    whyItMatters:
      'The summit of the hold line, and the platform the freestanding push-up is done from.',
    scheme: 'Short and often · 10–15 minutes of attempts · wall line work kept · handstand push-up line',
  },
]

const exercises: Exercise[] = [
  // ————— Handstand line —————
  {
    id: 'wall-plank',
    name: 'Wall Plank',
    category: 'handstand',
    skill: 'handstand',
    type: 'hold',
    difficulty: 1,
    equipment: ['Wall'],
    requires: ['wall'],
    blurb:
      'Hands on the floor, feet walked a little way up a wall, body a steep straight incline. Weight on the hands and open shoulders, at a height that is easy to step down from.',
    howTo: [
      'Start in a push-up position with your feet against the base of a wall.',
      'Walk the feet up the wall and the hands back until your body is a steep incline — about halfway to vertical.',
      'Lock the arms and push the floor away so the shoulders rise toward the ears.',
      'Hold a straight line; walk the feet down before the shape goes.',
    ],
    cues: ['Push tall', 'Ribs in', 'Arms locked'],
    mistakes: ['Sinking between the shoulders', 'Arching the lower back', 'Going higher than you can come down from'],
    muscles: ['Delts', 'Traps', 'Wrists', 'Core'],
  },
  {
    id: 'wall-float',
    name: 'Wall Float',
    category: 'handstand',
    skill: 'handstand',
    type: 'hold',
    difficulty: 3,
    equipment: ['Wall'],
    requires: ['wall'],
    blurb:
      'From a chest-to-wall handstand, float the toes off the wall and balance. The first free balance, with the wall right behind you.',
    howTo: [
      'Walk into a chest-to-wall handstand, hands a hand-length from the wall.',
      'Shift a little weight toward the fingertips and take one foot off the wall, then the other.',
      'Balance with the fingers and palms; let the toes touch back whenever you need to.',
      'Time only the stretch with both feet free. Walk down under control.',
    ],
    cues: ['Fingers steer', 'Light off the wall, not a push', 'Hips still'],
    mistakes: ['Shoving off the wall', 'Folding at the hips to balance', 'Counting time with a toe on the wall'],
    muscles: ['Forearms', 'Delts', 'Core', 'Balance'],
  },
  {
    id: 'freestanding-handstand',
    name: 'Freestanding Handstand',
    category: 'handstand',
    skill: 'handstand',
    type: 'hold',
    difficulty: 4,
    equipment: ['Clear floor space'],
    blurb: 'A handstand in open space: kicked up, balanced, and exited on purpose.',
    howTo: [
      'Clear the space around you and decide your exit first: step down, or turn a quarter and step out.',
      'Hands down shoulder width, arms locked; kick up with just enough swing to arrive at balance.',
      'Squeeze the legs together, push tall, and balance through the hands.',
      'Come down by choice before the line breaks.',
    ],
    cues: ['Arrive, do not overshoot', 'Push tall', 'Fingers and palms steer'],
    mistakes: ['Kicking too hard', 'Walking on the hands', 'Arching to stay up'],
    muscles: ['Delts', 'Forearms', 'Traps', 'Core'],
  },
  {
    id: 'handstand-bail',
    name: 'Bail Practice',
    category: 'handstand',
    skill: 'handstand',
    type: 'reps',
    difficulty: 2,
    equipment: ['Wall'],
    requires: ['wall'],
    blurb:
      'The way out of a handstand, practised on purpose: turn a quarter, step a hand, and land on your feet. Coaches teach it before any balance work, so that falling has an ending you have rehearsed.',
    howTo: [
      'Walk into a chest-to-wall handstand, a little further from the wall than usual.',
      'Shift your weight onto one hand and turn your body a quarter toward that side.',
      'Step the other hand forward and let the feet come down one after the other, like the end of a cartwheel.',
      'Stand up facing along the wall. Alternate sides; each exit is a rep.',
    ],
    cues: ['Turn, step, land', 'Eyes on the floor as you turn', 'Both sides'],
    mistakes: ['Collapsing straight down toward the head', 'Rushing before the weight has shifted', 'Only ever turning one way'],
    muscles: ['Shoulders', 'Core', 'Coordination'],
  },
  {
    id: 'kick-up',
    name: 'Kick-Up Practice',
    category: 'handstand',
    skill: 'handstand',
    type: 'reps',
    difficulty: 2,
    equipment: ['Wall or clear floor space'],
    blurb:
      'The entry, rehearsed: the same lunge and the same swing every time, arriving at vertical without crashing into the wall or past it.',
    howTo: [
      'Stand a lunge-length from your hands’ spot, back to a wall if you have one.',
      'Reach down with locked arms and swing the back leg up, the other following.',
      'Aim to arrive with the heels brushing the wall softly — or, in open space, at balance for a moment.',
      'Step down and reset. Each rep is one attempt.',
    ],
    cues: ['Same lunge every time', 'Locked arms before the feet leave', 'Soft arrival'],
    mistakes: ['Throwing the legs', 'Bent arms on landing', 'A different run-up each time'],
    muscles: ['Delts', 'Hips', 'Core', 'Balance'],
  },
  {
    id: 'heel-pull',
    name: 'Heel Pull',
    category: 'handstand',
    skill: 'handstand',
    type: 'reps',
    difficulty: 2,
    equipment: ['Wall'],
    requires: ['wall'],
    blurb:
      'Back to the wall, heels resting on it: press through the fingers until the heels float off, then let them return. The finger pressure that saves an underbalanced handstand, practised on its own.',
    howTo: [
      'Kick up with your back to the wall, hands about a hand-length out, heels resting on it.',
      'Press the fingertips into the floor until both heels come off the wall.',
      'Hold the balance for a moment, then let the heels touch again.',
    ],
    cues: ['Fingertips pull you off', 'Body stays one piece', 'Small and controlled'],
    mistakes: ['Pushing off with the feet', 'Bending at the hips', 'Arching to find the wall again'],
    muscles: ['Forearms', 'Delts', 'Balance'],
  },
  {
    id: 'wall-shoulder-tap',
    name: 'Wall Shoulder Tap',
    category: 'handstand',
    skill: 'handstand',
    type: 'reps',
    difficulty: 3,
    equipment: ['Wall'],
    requires: ['wall'],
    blurb:
      'In a chest-to-wall handstand, shift the weight onto one hand and lift the other to tap its shoulder. Weight shift and single-arm support at the wall.',
    howTo: [
      'Hold a chest-to-wall handstand with the hands a little wider than usual.',
      'Shift your weight over one hand without bending at the hips.',
      'Lift the other hand, tap the shoulder, and place it back quietly.',
      'Alternate. Count each tap as a rep.',
    ],
    cues: ['Shift, then lift', 'Hips stay stacked', 'Quiet hands'],
    mistakes: ['Snatching the hand up before shifting', 'Twisting at the hips', 'Bending the support arm'],
    muscles: ['Delts', 'Traps', 'Core', 'Wrists'],
  },
  {
    id: 'pike-shrug',
    name: 'Pike Shrug',
    category: 'handstand',
    skill: 'handstand',
    type: 'reps',
    difficulty: 1,
    equipment: ['Floor'],
    blurb:
      'In a pike with the hips high and the arms locked, let the chest sink between the shoulders, then push tall. The push that keeps a handstand long, practised without being upside down.',
    howTo: [
      'Set a pike: hands on the floor, hips high, arms locked, head between the arms.',
      'Let the chest sink a few centimetres between the shoulders without bending the elbows.',
      'Push the floor away so the shoulders lift toward the ears. Pause.',
    ],
    cues: ['Elbows stay locked', 'Push tall and hold a beat', 'Hips stay high'],
    mistakes: ['Bending the arms', 'Rushing the top', 'Hips drifting back to a plank'],
    muscles: ['Traps', 'Serratus', 'Delts'],
  },
  // ————— Handstand push-up line —————
  {
    id: 'kneeling-pike-pushup',
    name: 'Kneeling Pike Push-Up',
    category: 'push',
    skill: 'handstand',
    type: 'reps',
    difficulty: 1,
    equipment: ['Floor'],
    blurb: 'Practise the overhead press with your knees supporting part of your weight. Move your hips back to make each rep easier.',
    howTo: [
      'Start on your hands and knees. Set your hands just outside shoulder width, then lift your hips and keep your knees planted.',
      'Bend your elbows and bring your head toward a spot just ahead of your hands. Choose a depth you can reverse smoothly and keep your weight off your head.',
      'Press the floor away to straighten your arms. Shorten the range or shift your hips back if the next rep would stall.',
    ],
    cues: ['Knees stay down', 'Head travels ahead of hands', 'Press back to straight arms'],
    mistakes: ['Dropping weight onto the head', 'Flaring the elbows wide', 'Rushing through the bottom'],
    muscles: ['Delts', 'Triceps', 'Upper back'],
  },
  {
    id: 'elevated-pike-pushup',
    name: 'Feet-Elevated Pike Push-Up',
    category: 'push',
    skill: 'handstand',
    type: 'reps',
    difficulty: 3,
    equipment: ['Stable box or step'],
    requires: ['box'],
    blurb:
      'A pike push-up with the feet on a box, so the hips sit over the shoulders and more of your weight is pressed. The step between the floor pike and the wall.',
    howTo: [
      'Feet on a stable box about knee to hip height, hands on the floor, hips stacked high over the shoulders.',
      'Lower the top of the head toward the floor a little in front of the hands, elbows tracking back at about 45°.',
      'Touch lightly — the neck does not take weight — and press to locked arms.',
    ],
    cues: ['Hips over shoulders', 'Head forward of the hands', 'Lock out every rep'],
    mistakes: ['Elbows flaring wide', 'Hips drifting back so it becomes a push-up', 'Half range'],
    muscles: ['Delts', 'Triceps', 'Upper chest', 'Traps'],
  },
  {
    id: 'wall-hspu-negative',
    name: 'Wall Handstand Push-Up Negative',
    category: 'push',
    skill: 'handstand',
    type: 'reps',
    difficulty: 3,
    equipment: ['Wall'],
    requires: ['wall'],
    blurb:
      'From a wall handstand, lower as slowly as you can until the head reaches the floor, then come down. The full load of a handstand push-up, on the way down only.',
    howTo: [
      'Kick up with your back to a wall, or walk in chest-to-wall. Put a folded mat where your head will arrive.',
      'Bend the elbows and lower over about five seconds, head travelling forward of the hands to make a triangle.',
      'Let the head touch lightly — the arms hold your weight, not the neck — then step down.',
      'Reset at the top for the next rep.',
    ],
    cues: ['Five seconds down', 'Head forward, a triangle with the hands', 'Arms carry you all the way'],
    mistakes: ['Dropping the last half', 'Landing weight on the head', 'Elbows flaring wide'],
    muscles: ['Delts', 'Triceps', 'Traps'],
  },
  {
    id: 'wall-hspu',
    name: 'Wall Handstand Push-Up',
    category: 'push',
    skill: 'handstand',
    type: 'reps',
    difficulty: 4,
    equipment: ['Wall'],
    requires: ['wall'],
    blurb: 'A strict handstand push-up with the wall for balance: head to the floor, press to locked arms. No kip.',
    howTo: [
      'Get into a wall handstand with a folded mat under your head’s spot.',
      'Lower under control until the head touches lightly, a little forward of the hands.',
      'Press back to locked arms with the body one tight line — no kick from the legs.',
    ],
    cues: ['Touch, do not rest', 'Elbows back about 45°', 'Lock out at the top'],
    mistakes: ['Kipping with the legs', 'Resting weight on the head', 'Stopping short of lockout'],
    muscles: ['Delts', 'Triceps', 'Traps', 'Core'],
  },
  {
    id: 'deficit-wall-hspu',
    name: 'Deficit Wall Handstand Push-Up',
    category: 'push',
    skill: 'handstand',
    type: 'reps',
    difficulty: 5,
    equipment: ['Wall', 'Parallettes'],
    requires: ['wall', 'parallettes'],
    blurb:
      'Wall handstand push-ups with the hands on parallettes, so the head travels below hand height. The full range a floor rep stops short of.',
    howTo: [
      'Set parallettes shoulder width by the wall and get into a wall handstand on them.',
      'Lower until the shoulders reach about hand height — as deep as you control.',
      'Press back to locked arms with no kick.',
    ],
    cues: ['Deeper only if controlled', 'Elbows back', 'Lock out'],
    mistakes: ['Dropping into the bottom', 'Losing the line coming out', 'Kipping'],
    muscles: ['Delts', 'Triceps', 'Traps', 'Core'],
  },
  {
    id: 'freestanding-hspu',
    name: 'Freestanding Handstand Push-Up',
    category: 'push',
    skill: 'handstand',
    type: 'reps',
    difficulty: 5,
    equipment: ['Clear floor space'],
    blurb: 'A handstand push-up with no wall: lower, touch, press, and stay balanced throughout. The summit of this skill.',
    howTo: [
      'Hold a steady freestanding handstand.',
      'Lower with the head travelling forward and the hips back just enough to stay over the hands.',
      'Touch lightly and press back to a locked, balanced handstand.',
    ],
    cues: ['Balance moves with the head', 'Slow enough to steer', 'Finish balanced'],
    mistakes: ['Falling out of the bottom', 'Pressing into an arch', 'Counting a rep that ends in a step-down'],
    muscles: ['Delts', 'Triceps', 'Traps', 'Forearms', 'Core'],
  },
  // ————— Shoulder stretch —————
  {
    id: 'overhead-shoulder-stretch',
    name: 'Overhead Shoulder Stretch',
    category: 'mobility',
    type: 'hold',
    difficulty: 1,
    equipment: ['Wall or a low support'],
    blurb: 'Hands on a wall or support at hip height, chest sinking between the arms. The open shoulder a straight handstand needs.',
    howTo: [
      'Place both hands on a wall or support at about hip height, arms straight.',
      'Step back and hinge until the arms and back make one line.',
      'Let the chest sink between the arms without arching the lower back; hold.',
    ],
    cues: ['Ribs down', 'Arms straight', 'Ease in over breaths'],
    mistakes: ['Arching the lower back instead of opening the shoulders', 'Bending the elbows'],
    muscles: ['Lats', 'Shoulders', 'Upper back'],
  },
]

export const HANDSTAND: SkillDef = {
  id: 'handstand',
  name: 'Handstand push-up',
  short: 'HSPU',
  holdName: 'handstand',
  tagline: 'Balance on the hands, then press there',
  blurb:
    'Two things learned side by side: the handstand — a straight line balanced over the hands — and the strict overhead press that becomes a handstand push-up. The balance line and the press line each move at their own pace and meet at the freestanding push-up.',
  family: 'balance',
  straightArm: false,
  surfaces: false,
  requires: [['wall']],
  requiresNote: 'The early handstand steps and the wall push-ups need a clear wall.',
  loads: ['wrist', 'shoulder'],
  camera: {
    view: 'side',
    placement: 'Phone side-on, low, far enough back that hands and toes are both in frame when you are upside down.',
    honesty:
      'From the side, with the picture the right way up, the camera reads how open the shoulders are and whether hips and legs continue the line. Of your arms it sees only a large bend — upside down, a small one does not show — so you confirm the lockout on the replay. It cannot see whether a toe is still touching the wall — you confirm the free part. It does not count push-up reps: those sets are filmed so that you can check them on the replay.',
  },
  sourcing:
    'The order — wall line, a bail, balance drills at the wall, then free — is what coaches broadly agree on. The numbers are convention: wall-hold standards alone run from sets of 20 seconds to three minutes.',
  prerequisites: [
    'Wrists that tolerate a push-up position without pain; the Foundations step builds from there.',
    'For the push-up line, a pressing base first — coaches mention around 20 push-ups and some dips.',
  ],
  safety: [
    'Wrist pain is common among people who practise handstands, and no study has shown that warming up, wraps or parallettes prevent it. Prepare the wrists, keep sessions short, and treat pain that is still there the next day as a reason to rest and get it checked.',
    'Learn the way out before the balance: stepping down from the wall, then a quarter-turn out. Clear the space around you.',
    'Breathe. Holding your breath and straining upside down is the one habit worth breaking early.',
    'If you have glaucoma or another eye condition, ask your clinician before training upside down — eye pressure rises while inverted.',
    'In the push-up line the head touches the floor lightly and never takes a landing: strict reps only, a folded mat under the head, and no set taken to failure.',
  ],
  frequency:
    'Balance practice is short and frequent — coaches range from two to four times a week up to most days once built up to; the push-up line is strength work, two or three times a week.',
  steps: HANDSTAND_STEPS,
  defaultGoal: 'hs-free',
  words: {
    strength: 'pressing',
    strengthVerb: 'press',
    support: 'wall line work',
    contact: 'the floor',
    summit: 'the freestanding handstand',
  },
  // Balance practice is low in load and learned by time spent: about two
  // minutes of holds, where the strength skills aim at one.
  holdAggregateSec: 120,
  holdRestMaxSec: 75,
  program: {
    warmup: [
      { exerciseId: 'arm-circles', sets: 1, amount: 10, rest: 10, skipWhenShort: true },
      { exerciseId: 'wrist-circles', sets: 1, amount: 10, rest: 10 },
      { exerciseId: 'wrist-rocks', sets: 1, amount: 8, rest: 15 },
      { exerciseId: 'pike-shrug', sets: 1, amount: 8, rest: 25, skipWhenShort: true },
    ],
    primer: (stepId) =>
      stepId === 'hs-foundations'
        ? undefined
        : {
            exerciseId: 'wall-plank',
            sets: 1,
            amount: 15,
            rest: 40,
            note: 'Easy primer — weight on the hands and shoulders tall before going all the way up.',
          },
    steps: {
      'hs-foundations': {
        support: {
          exerciseId: 'pike-shrug',
          sets: 3,
          amount: 8,
          rest: 'accessory',
          note: 'The push that keeps a handstand tall. Elbows locked; pause at the top of every rep.',
        },
        core: [{ exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45, note: 'The straight line of a handstand, lying down.' }],
        mobility: { exerciseId: 'overhead-shoulder-stretch', sets: 1, amount: 30, rest: 10 },
      },
      'hs-wall': {
        balance: {
          exerciseId: 'handstand-bail',
          sets: 2,
          amount: 3,
          rest: 45,
          note: 'The way out, before the balance: from the wall, turn a quarter and step down to your feet. Coaches teach this first so that losing balance later has a practised ending.',
        },
        support: {
          exerciseId: 'wall-shoulder-tap',
          sets: 2,
          amount: 6,
          rest: 60,
          note: 'Weight shift at the wall — shift first, then lift the hand. Stop when the hips start to twist.',
        },
        core: [{ exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 }],
        mobility: { exerciseId: 'overhead-shoulder-stretch', sets: 1, amount: 30, rest: 10 },
        bridgeCue: ' Bridge open: on the last seconds of each hold, lighten the toes on the wall.',
      },
      'hs-float': {
        balance: {
          exerciseId: 'heel-pull',
          sets: 3,
          amount: 5,
          rest: 45,
          note: 'Back to the wall: press through the fingers until the heels float, then return. Finger pressure is the correction for tipping over the top.',
        },
        support: {
          exerciseId: 'kick-up',
          sets: 2,
          amount: 5,
          rest: 45,
          note: 'Entry practice — arrive at vertical softly. Away from the wall only once your exit is automatic.',
        },
        core: [{ exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 }],
        mobility: { exerciseId: 'overhead-shoulder-stretch', sets: 1, amount: 30, rest: 10 },
      },
      'hs-free': {
        balance: {
          exerciseId: 'kick-up',
          sets: 2,
          amount: 5,
          rest: 45,
          note: 'Entries, on their own: the same lunge every time, arriving at balance rather than past it. A few controlled entries every session is how coaches build the kick-up.',
        },
        support: {
          exerciseId: 'heel-pull',
          sets: 2,
          amount: 5,
          rest: 45,
          note: 'Finger-pressure practice at the wall — the correction for tipping over the top.',
        },
        core: [{ exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 }],
        mobility: { exerciseId: 'overhead-shoulder-stretch', sets: 1, amount: 30, rest: 10 },
      },
    },
    cooldown: [{ exerciseId: 'wrist-stretch', sets: 1, amount: 30, rest: 10 }],
  },
  ladder: {
    id: 'hspu',
    name: 'Handstand push-up',
    summit: 'a strict freestanding handstand push-up',
    sourcing:
      'The order of the rungs is what coaches broadly agree on. The rep numbers are single coaches’ figures or this app’s own choices — none is a measured threshold.',
    rungs: [
      {
        exerciseId: 'pike-pushup',
        startReps: 5,
        standardReps: 8,
        why: 'Overhead pressing with the feet on the floor — the pattern, at the lightest load.',
        check: [
          'Head came down to the floor, in front of the hands',
          'Arms locked straight at the top',
          'Hips stayed high — it never flattened into a push-up',
        ],
        frame: 'wide',
      },
      {
        exerciseId: 'elevated-pike-pushup',
        startReps: 4,
        standardReps: 8,
        why: 'Feet up, hips over the shoulders: more of your weight on the press.',
        check: [
          'Head touched down lightly, in front of the hands',
          'Arms locked straight at the top',
          'Hips stayed over the shoulders',
        ],
        frame: 'wide',
      },
      {
        exerciseId: 'wall-hspu-negative',
        startReps: 2,
        standardReps: 3,
        why: 'Your whole weight, on the way down only — about five seconds a rep.',
        check: [
          'Started from locked arms',
          'Lowered for about five seconds, with no drop at the end',
          'Head touched down lightly — the arms carried you all the way',
        ],
        frame: 'tall',
      },
      {
        exerciseId: 'wall-hspu',
        startReps: 1,
        standardReps: 5,
        why: 'The press to a light head touch and back, with the wall keeping the balance.',
        check: [
          'Head touched the floor lightly — no bounce, no rest',
          'Arms locked straight at the top',
          'No kick from the legs',
        ],
        frame: 'tall',
      },
      {
        exerciseId: 'deficit-wall-hspu',
        startReps: 1,
        standardReps: 5,
        why: 'Hands raised, so the shoulders come down to the hands — the full range a floor rep stops short of.',
        check: [
          'Shoulders came down to about hand height',
          'Arms locked straight at the top',
          'No kick from the legs',
        ],
        frame: 'tall',
      },
      {
        exerciseId: 'freestanding-hspu',
        startReps: 1,
        standardReps: 1,
        needsStep: 'hs-free',
        why: 'Press and balance together — one clean rep is the summit, and it needs the freestanding handstand as much as the strength.',
        check: [
          'Started and finished in a balanced handstand with locked arms',
          'Head touched the floor lightly',
          'No step, no fall, no wall',
        ],
        frame: 'tall',
      },
    ],
  },
  issues: {
    arms: {
      label: 'elbows bending',
      limiter: 'Locked arms',
      emphasis: 'lockout',
      prescription:
        'Wall holds with the elbows squeezed straight get the extra time, and each hold ends when they soften. A bent-arm handstand is held by the triceps instead of stacked on the bones.',
    },
    shoulders: {
      label: 'shoulders not fully open',
      limiter: 'Shoulder opening',
      emphasis: 'scapula',
      prescription:
        'Pike shrugs and the overhead shoulder stretch get the extra work: push tall until the arms sit by the ears, at the wall first.',
    },
    closed: {
      label: 'hips out of line',
      limiter: 'Body line',
      emphasis: 'core',
      prescription: 'Hollow-body work and chest-to-wall holds target the line: ribs in, glutes on, legs continuing the torso.',
    },
    knees: {
      label: 'knees bending',
      limiter: 'Whole-body tension',
      emphasis: 'core',
      prescription: 'Hollow-body work with locked knees and pointed toes reinforces the tension a still handstand needs.',
    },
  },
  exercises,
}
