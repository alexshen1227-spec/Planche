import type { Exercise, StepDef } from '../../types'
import type { SkillDef } from './types'

/**
 * The 90° hold road.
 *
 * A bent-arm planche: body level, elbows at about a right angle, and — this is
 * what separates it from an elbow lever — nothing resting on the elbows. From
 * it comes the 90° push-up (Sommer's "Bower"): lowering from a handstand into
 * the hold and pressing back. It sits between the planche and the handstand
 * push-up and borrows from both.
 *
 * **Thinly sourced, and the screens say so** (ledger §13.6). No research on it
 * was found and no named coach publishes hold times for it: one gymnastics
 * coach's forum posts, one official exercise page, and vendor material that
 * disagrees with itself by years. So every bar here is this app's design, the
 * road says so on screen (`sourcing`), and three things the sources do not
 * support are deliberately absent: a "forearms vertical" cue (no source states
 * it, and for a straight body the mechanics argue against it), the elbow lever
 * as a step (it removes the shoulder demand that defines the hold; whether it
 * carries over is unknown, so it is offered only as optional balance practice),
 * and any timeline.
 */
export const NINETY_STEPS: StepDef[] = [
  {
    id: 'n90-lean',
    skill: 'ninety',
    order: 0,
    name: 'Foundations',
    short: 'Foundations',
    tagline: 'The bottom of the push-up, held',
    keyExerciseId: 'bent-arm-lean-hold',
    unlockSec: 20,
    startSec: 8,
    description:
      'The bottom of a deep pseudo planche push-up, held: elbows at about 90° tight to the sides, shoulders well ahead of the hands, body one level line a few centimetres off the floor, toes still down. It loads the bent-arm position the whole skill is made of while the feet carry part of you.',
    formChecks: [
      'Elbows at about a right angle, tucked to the sides',
      'Shoulders well ahead of the hands — a real forward lean',
      'Body one straight line from shoulders to heels, level with the floor',
      'Hands turned out a little; wrists prepared first',
    ],
    mistakes: [
      'Elbows flaring out so it becomes the bottom of an ordinary push-up',
      'Hips sagging or piking to make the seconds',
      'No lean — shoulders over the hands is a low plank, a different exercise',
    ],
    whyItMatters:
      'A 90° hold is this position with the feet lifted. Holding it on the floor is how the wrists, elbows and shoulders meet the load before it is all of you.',
    scheme: '2–3 sessions/week · 4 holds of 8–20s · pseudo planche push-ups 3×6 · dips · hollow hold',
  },
  {
    id: 'n90-tuck',
    skill: 'ninety',
    order: 1,
    name: 'Tuck 90° Hold',
    short: 'Tuck',
    tagline: 'Feet up, nothing resting',
    keyExerciseId: 'tuck-ninety-hold',
    unlockSec: 10,
    startSec: 3,
    description:
      'Knees tucked to the chest, back level, elbows at about 90° beside the ribs — and the elbows hold nothing up. The whole of you is carried by bent arms in a forward lean. Expect two or three seconds at first.',
    formChecks: [
      'Elbows at about 90°, close to the sides but not propping the body',
      'Back level, hips at shoulder height',
      'Knees tight to the chest, feet off the floor',
      'Shoulders ahead of the hands',
    ],
    mistakes: [
      'Resting the hips or thighs on the elbows — that is an elbow lever, a different hold',
      'Elbows opening toward straight, turning it into a tuck planche attempt',
      'Hips low, so it is a crouch over the hands',
    ],
    whyItMatters: 'The first true 90° hold. Every later step is this with the hips opened and the legs let out.',
    scheme: '2–3 sessions/week · 5–6 holds of 3–8s · lean holds as back-off · pseudo planche push-ups',
  },
  {
    id: 'n90-advtuck',
    skill: 'ninety',
    order: 2,
    name: 'Advanced Tuck 90° Hold',
    short: 'Adv. tuck',
    tagline: 'Flat back, hips open',
    keyExerciseId: 'adv-tuck-ninety-hold',
    unlockSec: 8,
    startSec: 2,
    description:
      'The tuck hold with the back flat and the hips opened to about a right angle, knees under the hips. The lever is longer, and the lean has to grow with it to stay balanced.',
    formChecks: [
      'Back flat and level',
      'Hips open to about 90°, knees pointing at the floor',
      'Elbows still at about 90°, unsupported',
      'More forward lean than the tuck',
    ],
    mistakes: [
      'A rounded back creeping back in',
      'Elbows straightening to cope with the longer lever',
      'Hips dropping below the shoulders',
    ],
    whyItMatters: 'The flat back is the posture of the finished hold; this is the shortest lever it can be learned at.',
    scheme: '2–3 sessions/week · 4–6 holds of 2–6s · tuck holds as back-off',
  },
  {
    id: 'n90-straddle',
    skill: 'ninety',
    order: 3,
    name: 'Straddle 90° Hold',
    short: 'Straddle',
    tagline: 'Legs out wide',
    keyExerciseId: 'straddle-ninety-hold',
    unlockSec: 6,
    startSec: 2,
    description:
      'Both legs extended and spread wide, body level, elbows at 90°. A wide straddle shortens the lever; the lean is now deep enough that the hands sit near the waist.',
    formChecks: [
      'Legs straight and wide, hips fully open',
      'Shoulders, hips and feet on one level line',
      'Elbows at about 90°, tight to the sides, unsupported',
      'Deep forward lean — hands near the waist',
    ],
    mistakes: ['Piked hips', 'Feet dropping', 'Elbows drifting toward straight'],
    whyItMatters: 'The first shape that reads as the finished skill; from here the full hold is a narrowing.',
    scheme: '2 sessions/week · 4–6 holds of 2–5s · advanced tuck as back-off',
  },
  {
    id: 'n90-full',
    skill: 'ninety',
    order: 4,
    name: '90° Hold',
    short: 'Full',
    tagline: 'Legs together, level, on bent arms',
    keyExerciseId: 'ninety-hold',
    unlockSec: 5,
    startSec: 2,
    description:
      'Legs together, body one level line, elbows at a right angle with nothing resting on them. The summit of the hold road, and the bottom position of the 90° push-up.',
    formChecks: [
      'Shoulders, hips and heels level',
      'Elbows at about 90°, unsupported',
      'Legs together, knees locked, toes pointed',
      'Still — balanced by the lean, not by kicking',
    ],
    mistakes: ['An arched back with the legs high', 'Hips resting on the elbows', 'Counting a hold that is still moving'],
    whyItMatters: 'The summit of this road, and where the push-up line turns around.',
    scheme: '2 quality sessions/week · low volume, long rests · film the holds',
  },
]

const exercises: Exercise[] = [
  // ————— 90° hold line —————
  {
    id: 'bent-arm-lean-hold',
    name: 'Bent-Arm Lean Hold',
    category: 'ninety',
    skill: 'ninety',
    type: 'hold',
    difficulty: 2,
    equipment: ['Floor or parallettes'],
    blurb:
      'The bottom of a deep pseudo planche push-up, held: elbows at 90° by the sides, shoulders ahead of the hands, body level, toes down.',
    howTo: [
      'Set a push-up position with the hands by the lower ribs, turned out a little.',
      'Lean the shoulders forward past the hands and lower until the elbows are at about a right angle.',
      'Hold with the body one level line a few centimetres off the floor, elbows tight to the sides.',
      'Press back up or lower to the floor under control.',
    ],
    cues: ['Elbows in', 'Lean first, then lower', 'One level line'],
    mistakes: ['Elbows flaring', 'Hips sagging', 'Shoulders over the hands, no lean'],
    muscles: ['Anterior delts', 'Triceps', 'Chest', 'Core'],
  },
  {
    id: 'elbow-lever',
    name: 'Elbow Lever',
    category: 'ninety',
    skill: 'ninety',
    type: 'hold',
    difficulty: 2,
    equipment: ['Floor or parallettes'],
    blurb:
      'Balanced level on the hands with the elbows dug into the sides of the abdomen. A balance drill at the same level position — the elbows carry you, so it is not a step on the 90° road, and whether it carries over to the unsupported hold is not established.',
    howTo: [
      'Kneel, hands on the floor with the fingers turned out or back.',
      'Bend the elbows and press them into the abdomen just inside the hip bones.',
      'Tip forward, straightening the legs behind you, until the feet float and the body is level.',
      'Balance by leaning a little further or less. Lower the feet to come out.',
    ],
    cues: ['Elbows in by the hips', 'Tip forward until the feet float', 'Long, straight body'],
    mistakes: ['Feet low — not tipped far enough', 'Arching to lift the legs', 'Elbows too wide'],
    muscles: ['Wrists & forearms', 'Triceps', 'Lower back', 'Balance'],
  },
  {
    id: 'tuck-ninety-hold',
    name: 'Tuck 90° Hold',
    category: 'ninety',
    skill: 'ninety',
    type: 'hold',
    difficulty: 3,
    equipment: ['Parallettes recommended'],
    blurb: 'Knees to the chest, back level, elbows at 90° with nothing resting on them. The first unsupported bent-arm hold.',
    howTo: [
      'From a crouch with the hands by the hips, lean the shoulders forward over the hands.',
      'Bend the elbows to about 90° and lift the feet, knees tight to the chest.',
      'Hold the back level with the elbows close to the sides — not under the body.',
      'Put the feet down before the shape goes.',
    ],
    cues: ['Lean, then lift', 'Elbows beside you, not under you', 'Back level'],
    mistakes: ['Propping the thighs on the elbows', 'Elbows opening', 'Hips low'],
    muscles: ['Anterior delts', 'Triceps', 'Chest', 'Core'],
  },
  {
    id: 'adv-tuck-ninety-hold',
    name: 'Advanced Tuck 90° Hold',
    category: 'ninety',
    skill: 'ninety',
    type: 'hold',
    difficulty: 4,
    equipment: ['Parallettes recommended'],
    blurb: 'Tuck 90° hold with a flat back and the hips opened to about 90°.',
    howTo: [
      'Start in a tuck 90° hold.',
      'Lean a little further and flatten the back to level.',
      'Open the hips until the knees point at the floor.',
      'Hold; re-tuck to come down.',
    ],
    cues: ['Flat back', 'Knees under hips', 'More lean'],
    mistakes: ['Rounding the back', 'Straightening the arms', 'Hips dropping'],
    muscles: ['Anterior delts', 'Triceps', 'Lower back', 'Core'],
  },
  {
    id: 'straddle-ninety-hold',
    name: 'Straddle 90° Hold',
    category: 'ninety',
    skill: 'ninety',
    type: 'hold',
    difficulty: 5,
    equipment: ['Parallettes or floor'],
    blurb: 'Both legs out wide, body level, elbows at 90°.',
    howTo: [
      'From an advanced tuck 90° hold, extend both legs back and wide.',
      'Open the hips and squeeze the glutes so the feet rise level.',
      'Lean until balanced; keep the elbows at a right angle.',
      'Tuck to come down.',
    ],
    cues: ['Wide legs', 'Hips open', 'Level line'],
    mistakes: ['Piked hips', 'Feet low', 'Elbows opening'],
    muscles: ['Anterior delts', 'Triceps', 'Glutes', 'Core'],
  },
  {
    id: 'ninety-hold',
    name: '90° Hold',
    category: 'ninety',
    skill: 'ninety',
    type: 'hold',
    difficulty: 5,
    equipment: ['Parallettes or floor'],
    blurb: 'Legs together, body level, elbows at a right angle and unsupported. A full bent-arm planche.',
    howTo: [
      'From a straddle 90° hold, draw the legs together.',
      'Keep the lean and the whole body tight.',
      'Hold one level line with the elbows at 90° beside the ribs.',
      'Straddle or tuck to come down.',
    ],
    cues: ['One rigid line', 'Elbows in', 'Still'],
    mistakes: ['Arched back', 'Resting on the elbows', 'Legs high'],
    muscles: ['Anterior delts', 'Triceps', 'Chest', 'Core'],
  },
  // ————— 90° push-up line —————
  {
    id: 'tuck-ninety-pushup',
    name: 'Tuck 90° Push-Up',
    category: 'push',
    skill: 'ninety',
    type: 'reps',
    difficulty: 4,
    equipment: ['Parallettes recommended'],
    blurb: 'From a tuck 90° hold, press up toward straight arms and lower back to 90°, feet off the floor throughout.',
    howTo: [
      'Hold a tuck 90° hold.',
      'Press until the arms are straight, staying tucked and leaning forward.',
      'Lower back to elbows at 90° under control.',
    ],
    cues: ['Stay tucked', 'Lean stays', 'Full press, full return'],
    mistakes: ['Feet touching between reps', 'Half presses', 'Resting on the elbows at the bottom'],
    muscles: ['Anterior delts', 'Triceps', 'Chest', 'Core'],
  },
  {
    id: 'ninety-negative',
    name: '90° Negative',
    category: 'push',
    skill: 'ninety',
    type: 'reps',
    difficulty: 4,
    equipment: ['Clear floor space; a wall to start from if needed'],
    blurb:
      'From a handstand — at the wall or free — lower forward and down into your 90° hold over about five seconds, and stop there. The lowering half of the push-up; it needs a handstand you can already hold.',
    howTo: [
      'Hold a handstand: free, or chest to the wall a little further out than usual.',
      'Bend the elbows and let the shoulders travel forward as the body tips toward level.',
      'Lower over about five seconds into your current 90° shape — tuck, straddle or full.',
      'Stop in the hold for a moment rather than dropping, then put the feet down.',
    ],
    cues: ['Five seconds down', 'Shoulders forward as you lower', 'Stop in the hold'],
    mistakes: ['Dropping the last part', 'Elbows flaring', 'Landing instead of stopping'],
    muscles: ['Anterior delts', 'Triceps', 'Chest', 'Core'],
  },
  {
    id: 'straddle-ninety-pushup',
    name: 'Straddle 90° Push-Up',
    category: 'push',
    skill: 'ninety',
    type: 'reps',
    difficulty: 5,
    equipment: ['Clear floor space or parallettes'],
    blurb: 'From a handstand, lower into the straddle 90° hold and press back up with the legs apart. Singles count.',
    howTo: [
      'Hold a steady handstand and open the legs.',
      'Lower with a forward lean until the body is level in the straddle 90° hold.',
      'Press back up, tipping toward vertical, to a locked handstand.',
    ],
    cues: ['Lean as you lower', 'Level at the bottom', 'Press back to balance'],
    mistakes: ['Collapsing through the bottom', 'Feet touching down', 'An arched press'],
    muscles: ['Anterior delts', 'Triceps', 'Chest', 'Traps', 'Core'],
  },
  {
    id: 'ninety-pushup',
    name: '90° Push-Up',
    category: 'push',
    skill: 'ninety',
    type: 'reps',
    difficulty: 5,
    equipment: ['Clear floor space or parallettes'],
    blurb: 'From a handstand, lower into the 90° hold and press back to the handstand, legs together. The summit of this skill.',
    howTo: [
      'Hold a steady handstand.',
      'Bend the elbows and lean forward, lowering until the body is level with the elbows at 90°.',
      'Press back up, the body tipping back toward vertical, to a locked handstand.',
    ],
    cues: ['Lean as you lower', 'Pause level', 'Press back to balance'],
    mistakes: ['Collapsing through the bottom', 'Feet touching down', 'Finishing short of the handstand'],
    muscles: ['Anterior delts', 'Triceps', 'Chest', 'Traps', 'Core'],
  },
]

const LEAN_SUPPORT = {
  exerciseId: 'bent-arm-lean-hold',
  sets: 3,
  amount: 12,
  rest: 'accessory' as const,
  note: 'Bent-arm conditioning at a load that repeats: deep lean, elbows at 90° and tight to the sides.',
}
const DIPS = (reps: number) => ({
  exerciseId: 'dip',
  sets: 3,
  amount: reps,
  rest: 'accessory' as const,
  note: 'Bent-arm pressing strength at depth.',
})

export const NINETY: SkillDef = {
  id: 'ninety',
  name: '90° hold',
  short: '90°',
  holdName: '90° hold',
  tagline: 'Level on bent arms, nothing resting',
  blurb:
    'A bent-arm planche: the body held level with the elbows at a right angle and nothing propped on them. From it comes the 90° push-up — lowering from a handstand into the hold and pressing back. It draws on the planche’s lean and the handstand push-up’s press, so it pairs naturally with either.',
  family: 'push',
  straightArm: false,
  surfaces: true,
  requires: [],
  loads: ['wrist', 'shoulder', 'elbow'],
  camera: {
    view: 'side',
    placement: 'Phone side-on at about hip height, far enough back to keep the hands and feet in frame.',
    honesty:
      'From the side the camera reads the elbow angle, hip opening, straight legs and whether hips and shoulders are level. It cannot see whether the body is resting on the elbows or a toe is on the floor — you confirm that the hold was unsupported.',
  },
  sourcing:
    'Thinly sourced: no research on it was found and no named coach publishes hold times for it, so every bar here is this app’s own design. Treat the numbers as a way to pace practice, not as standards.',
  prerequisites: [
    'Coaches who say anything ask for strength first, and disagree on how much — from 25 push-ups and a one-minute plank to a tuck planche, five strict wall handstand push-ups and a 10-second free handstand.',
    'The push-up line needs a handstand you can hold before its later rungs: they start upside down.',
  ],
  safety: [
    'It loads the wrists deeply and the shoulders about as hard as a planche does; the same pain rules apply, and a sore wrist or shoulder is a reason to stop, not to finish the set.',
    'Lower slowly in the push-up line — a fast drop loads the shoulder suddenly — and never take a set to failure upside down.',
  ],
  frequency: 'Twice a week, at least two days apart, is the only figure a coach states for the push-up line.',
  steps: NINETY_STEPS,
  defaultGoal: 'n90-full',
  words: {
    strength: 'pressing',
    strengthVerb: 'press',
    support: 'lean holds',
    contact: 'the floor',
    summit: 'the full 90° hold',
  },
  holdAggregateSec: 45,
  program: {
    warmup: [
      { exerciseId: 'arm-circles', sets: 1, amount: 10, rest: 10, skipWhenShort: true },
      { exerciseId: 'wrist-circles', sets: 1, amount: 10, rest: 10 },
      { exerciseId: 'wrist-rocks', sets: 1, amount: 8, rest: 15 },
      { exerciseId: 'scap-pushup', sets: 1, amount: 8, rest: 25, skipWhenShort: true },
    ],
    primer: (stepId) =>
      stepId === 'n90-lean'
        ? { exerciseId: 'plank', sets: 1, amount: 20, rest: 40 }
        : {
            exerciseId: 'bent-arm-lean-hold',
            sets: 1,
            amount: 6,
            rest: 40,
            note: 'Easy primer — a short, comfortable lean hold to find the elbow position before the work.',
          },
    steps: {
      'n90-lean': {
        strength: { exerciseId: 'pushup', sets: 3, amount: 8, rest: 'accessory', note: 'Pressing strength behind the hold. Elbows back, full range.' },
        balance: {
          exerciseId: 'elbow-lever',
          sets: 2,
          amount: 10,
          rest: 'accessory',
          note: 'Optional balance practice at the level position, with the elbows as a shelf. It teaches the balance point; whether it carries over to the unsupported hold is not established, so it never counts toward a step.',
        },
        core: [{ exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 }],
      },
      'n90-tuck': {
        support: LEAN_SUPPORT,
        strength: DIPS(6),
        core: [{ exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 }],
        bridgeCue: ' Bridge open: hold each tuck with the back a little flatter than last week.',
      },
      'n90-advtuck': {
        support: LEAN_SUPPORT,
        strength: DIPS(8),
        core: [
          { exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 },
          { exerciseId: 'arch-hold', sets: 2, amount: 20, rest: 45, note: 'The back of the body holds the legs level once they leave the tuck.' },
        ],
      },
      'n90-straddle': {
        support: LEAN_SUPPORT,
        strength: DIPS(8),
        core: [
          { exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 },
          { exerciseId: 'arch-hold', sets: 2, amount: 20, rest: 45 },
        ],
        mobility: { exerciseId: 'pancake-stretch', sets: 1, amount: 40, rest: 10 },
        bridgeCue: ' Bridge open: narrow the legs a few degrees at a time, keeping the line level.',
      },
      'n90-full': {
        support: LEAN_SUPPORT,
        strength: DIPS(8),
        core: [
          { exerciseId: 'hollow-hold', sets: 2, amount: 30, rest: 45 },
          { exerciseId: 'arch-hold', sets: 2, amount: 20, rest: 45 },
        ],
      },
    },
    cooldown: [
      { exerciseId: 'wrist-stretch', sets: 1, amount: 30, rest: 10 },
      { exerciseId: 'shoulder-extension-stretch', sets: 1, amount: 30, rest: 10 },
    ],
  },
  ladder: {
    id: 'ninety-pushup',
    name: '90° push-up',
    summit: 'a 90° push-up from a handstand and back',
    sourcing:
      'One coach has published a ladder toward this push-up, with no numbers on it. The order here is this app’s reading of that ladder, and every rep standard is this app’s own design — not a measured threshold. So are the gates: the rungs that start or finish in a handstand wait for the handstand road, because a push-up is not trained in a balance you do not have yet.',
    rungs: [
      {
        exerciseId: 'pppu',
        startReps: 5,
        standardReps: 10,
        why: 'Pressing in a forward lean — the base every later rung leans further into.',
        check: [
          'Shoulders stayed ahead of the hands, top and bottom',
          'Chest came down close to the floor',
          'Arms locked straight at the top, body in one line',
        ],
        frame: 'wide',
      },
      {
        exerciseId: 'tuck-ninety-pushup',
        startReps: 2,
        standardReps: 5,
        // Pressing out of a hold needs the hold.
        needsStep: 'n90-tuck',
        why: 'Pressing out of the unsupported hold itself, at the shortest lever.',
        check: [
          'Feet stayed off the floor from the first rep to the last',
          'Elbows came back to a right angle at the bottom, with nothing resting on them',
          'Arms pressed straight at the top',
        ],
        frame: 'wide',
      },
      {
        exerciseId: 'ninety-negative',
        startReps: 1,
        standardReps: 3,
        // Lowered from a handstand: the wall handstand held to its bar.
        needsStep: 'hs-float',
        why: 'The lowering half, from a handstand, stopping in the hold — it needs a handstand you can already hold.',
        check: [
          'Started from a handstand with locked arms',
          'Lowered for about five seconds',
          'Stopped in the hold — body level, elbows at a right angle — before the feet came down',
        ],
        frame: 'tall',
      },
      {
        exerciseId: 'straddle-ninety-pushup',
        startReps: 1,
        standardReps: 3,
        // Pressed back to a handstand, with nothing to lean on.
        needsStep: 'hs-free',
        why: 'The whole movement with the legs apart, which shortens the lever.',
        check: [
          'Lowered until the body was level, elbows at a right angle',
          'Feet never touched down',
          'Pressed back to a handstand with locked arms',
        ],
        frame: 'tall',
      },
      {
        exerciseId: 'ninety-pushup',
        startReps: 1,
        standardReps: 1,
        needsStep: 'hs-free',
        why: 'The whole movement, legs together — one clean rep is the summit.',
        check: [
          'Lowered until the body was level, elbows at a right angle, legs together',
          'Feet never touched down',
          'Pressed back to a handstand with locked arms',
        ],
        frame: 'tall',
      },
    ],
  },
  issues: {
    angle: {
      label: 'elbows away from a right angle',
      limiter: 'Elbow position',
      emphasis: 'lockout',
      prescription:
        'Lean holds at an exact right angle get the extra sets, elbows tight to the sides. Opening toward straight is a planche attempt, and sinking deeper rests the body on the arms.',
    },
    sag: {
      label: 'hips dropping',
      limiter: 'Body-line strength',
      emphasis: 'core',
      prescription: 'Hollow-body and arch work target the line that is dropping under fatigue.',
    },
    pike: {
      label: 'hips riding too high',
      limiter: 'Body-line control',
      emphasis: 'core',
      prescription: 'Hollow-body work at a level line reinforces the position the hold keeps drifting out of.',
    },
    closed: {
      label: 'hips not opening enough',
      limiter: 'Hip opening',
      emphasis: 'core',
      prescription: 'Arch and hollow work target the open hip a longer lever needs; glutes are what hold it there.',
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
