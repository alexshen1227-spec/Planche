import type { StepDef, StepId } from '../types'

/**
 * The planche road, in order. Unlock targets follow common calisthenics
 * practice: own a position comfortably before loading the next one.
 */
export const STEPS: StepDef[] = [
  {
    id: 'foundations',
    order: 0,
    name: 'Foundations',
    tagline: 'Wrists, scapula, hollow body',
    keyExerciseId: 'ppp-hold',
    unlockSec: 30,
    startSec: 15,
    description:
      'Before leaning an entire bodyweight over your hands, the supporting cast has to be ready: wrists that tolerate extension under load, shoulder blades that can protract hard, and a trunk that holds a hollow line without leaking. This phase is short but skipping it is how people earn wrist and elbow issues.',
    formChecks: [
      'Pseudo planche plank: shoulders in front of the wrists, elbows locked',
      'Scapula pushed apart (protracted) — upper back gently rounded',
      'Ribs down, glutes squeezed, body one straight line',
      'Wrist routine done pain-free before every session',
    ],
    mistakes: [
      'Rushing past this phase because it feels easy',
      'Sagging hips or flared ribs in the plank',
      'Bent elbows taking the load instead of straight arms',
    ],
    whyItMatters:
      'Every later step is a harder version of exactly this shape: straight arms, protracted scapula, hollow body. Groove it now while the loading is friendly.',
    scheme: '3–4 sessions/week · pseudo plank 4×15–30s · scap push-ups 3×8 · hollow 3×30s',
  },
  {
    id: 'lean',
    order: 1,
    name: 'Planche Lean',
    tagline: 'Load the lean, condition the joints',
    keyExerciseId: 'planche-lean',
    unlockSec: 30,
    startSec: 12,
    description:
      'From a push-up plank, shift your shoulders forward past your hands and hold. The further the lean, the closer the loading gets to a real planche. This is the single most important strength builder on the whole road — treat it as a main lift, not a warm-up.',
    formChecks: [
      'Elbows completely locked, biceps facing slightly forward',
      'Shoulders travel forward past the fingertips',
      'Scapula protracted and depressed — no shrugging',
      'Straight hollow line from shoulders to heels',
    ],
    mistakes: [
      'Bending the elbows to fake a bigger lean',
      'Piking the hips up instead of leaning the shoulders forward',
      'Measuring progress by seconds while the lean angle quietly shrinks',
    ],
    whyItMatters:
      'The lean conditions wrists, biceps tendons and anterior delts to straight-arm loading — the exact capacity every planche position runs on.',
    scheme: '3–4 sessions/week · 4–6 leans of 10–30s at a lean that feels like RPE 8',
  },
  {
    id: 'frog',
    order: 2,
    name: 'Frog Stand',
    tagline: 'Balance on straight(ish) arms',
    keyExerciseId: 'frog-stand',
    unlockSec: 30,
    startSec: 10,
    description:
      'Crouch, plant your hands, rest your knees on your elbows and float your feet. The frog stand teaches the balance half of the planche: fingertip pressure, weight over the hands, and a calm head while balancing. Work toward straighter arms over time.',
    formChecks: [
      'Fingers spread, weight toward the fingertips to steer balance',
      'Look slightly ahead of the hands, not down at them',
      'Knees resting on the elbows or triceps',
      'Balance corrections come from the fingers, not big shoulder movements',
    ],
    mistakes: [
      'Head tucked in, staring straight down — you lose the horizon',
      'Jumping into it instead of shifting weight gradually',
      'Never progressing toward straighter arms',
    ],
    whyItMatters:
      'Planche is strength *and* balance. The frog stand builds hand balance with almost no strength cost, so you learn the skill before the strength arrives.',
    scheme: 'Daily practice is fine · accumulate 2–3 minutes in holds of 5–30s',
  },
  {
    id: 'tuck',
    order: 3,
    name: 'Tuck Planche',
    tagline: 'First real flight',
    keyExerciseId: 'tuck-planche',
    unlockSec: 20,
    startSec: 5,
    description:
      'Knees pulled to the chest, hips at shoulder height, feet off the floor, arms straight: the first true planche. Parallettes make it far friendlier on the wrists. Expect single seconds at first — that is normal and it grows fast.',
    formChecks: [
      'Arms locked and vertical-ish, shoulders leaning forward of the wrists',
      'Scapula protracted — back rounded like an angry cat',
      'Knees tight to the chest, heels tucked to your butt',
      'Hips rise to shoulder height',
    ],
    mistakes: [
      'Bent arms — a bent-arm tuck builds the wrong pattern',
      'Hips too low, so the hold is really a supported crouch',
      'Holding breath and going purple; breathe shallowly',
    ],
    whyItMatters:
      'This is the base camp every higher planche is trained from. A big tuck planche (20s+) is the price of admission for flat-back work.',
    scheme: '3–4 sessions/week · 5–8 sets of 40–60% of your max hold · rest 2–3 min',
  },
  {
    id: 'advtuck',
    order: 4,
    name: 'Advanced Tuck',
    tagline: 'Flatten the back, open the hips',
    keyExerciseId: 'adv-tuck-planche',
    unlockSec: 20,
    startSec: 5,
    description:
      'Same tuck, but the back flattens to horizontal and the hips open so the knees sit under the hips instead of at the chest. The lever gets meaningfully longer and the loading jumps. This step usually takes months — respect it.',
    formChecks: [
      'Back flat and parallel to the floor (film yourself from the side)',
      'Hips open to roughly 90°, knees pointing down',
      'Bigger forward lean than the tuck — the shoulders must travel',
      'Glutes on, lower back doing quiet work',
    ],
    mistakes: [
      'Calling a slightly-unrounded tuck an advanced tuck — the camera decides',
      'Losing scapular protraction as the back flattens',
      'Adding flat-back time while the elbows quietly bend',
    ],
    whyItMatters:
      'The flat back is the posture of every end-stage planche. Learning to hold it here, with the shortest possible lever, is what makes straddle work approachable later.',
    scheme: '3 sessions/week · 5–6 sets of 40–60% max · plus tuck volume as back-off work',
  },
  {
    id: 'oneleg',
    order: 5,
    name: 'One-Leg Extension',
    tagline: 'Lengthen the lever, one side at a time',
    keyExerciseId: 'one-leg-planche',
    unlockSec: 12,
    startSec: 4,
    description:
      'From a solid advanced tuck, extend one leg straight back while the other stays tucked. It bridges the gap to straddle without the full loading jump, and exposes any left/right imbalance. Train both sides evenly.',
    formChecks: [
      'Extended leg fully straight, toes pointed, in line with the flat back',
      'Hips stay square — no rolling toward the tucked side',
      'Forward lean increases again to balance the longer lever',
      'Swap legs between sets, not mid-hold',
    ],
    mistakes: [
      'Extended leg drifting high because the hips tilt',
      'Only training the comfortable side',
      'Losing the flat back the moment the leg extends',
    ],
    whyItMatters:
      'A controlled one-leg extension proves the flat-back position survives a longer lever — the exact test the straddle will run at full scale.',
    scheme: '3 sessions/week · 4–6 sets/side of 3–8s · keep advanced tuck volume',
  },
  {
    id: 'straddle',
    order: 6,
    name: 'Straddle Planche',
    tagline: 'Legs out wide — real flight',
    keyExerciseId: 'straddle-planche',
    unlockSec: 15,
    startSec: 3,
    description:
      'Both legs extended and spread wide. This is the planche most people chase — it photographs like magic and demands serious straight-arm strength. Wide straddle mobility (pancake work) makes the lever shorter and the hold cheaper.',
    formChecks: [
      'Legs straight, locked at the knees, spread as wide as your pancake allows',
      'Hips fully open — body one flat plane from shoulders to toes',
      'Aggressive forward lean, shoulders well past the hands',
      'Toes pointed like you mean it',
    ],
    mistakes: [
      'Hips piked so the legs hover but the body is a tent',
      'Narrow straddle because pancake mobility was never trained',
      'Chasing seconds with a sagging lower back',
    ],
    whyItMatters:
      'The straddle is the first planche that reads as the finished skill — and the platform from which the full planche is a narrowing, not a new skill.',
    scheme: '3 sessions/week · band-assisted + short free holds · pancake mobility 2×/week',
  },
  {
    id: 'full',
    order: 7,
    name: 'Full Planche',
    tagline: 'Legs together. The summit.',
    keyExerciseId: 'full-planche',
    unlockSec: 10,
    startSec: 2,
    description:
      'Legs together, body a single rigid line floating over your hands. The lever is at its absolute longest. From a solid straddle, the path is narrowing the legs a few degrees at a time. A 5s clean full planche puts you in rare company; 10s+ is elite.',
    formChecks: [
      'Body one straight line — shoulders, hips, heels level',
      'Legs glued together, knees locked, toes pointed',
      'Maximum forward lean; wrists deep in extension (parallettes help)',
      'Scapula still protracted at maximum effort — the first thing to fail',
    ],
    mistakes: [
      'Counting arched-back, legs-high "planches" — level line or it does not count',
      'Abandoning straddle and lean volume once fulls start',
      'Training it fatigued; max-lever work wants a fresh nervous system',
    ],
    whyItMatters:
      'This is the summit. Everything below it was built so this position can exist for a few impossible-looking seconds.',
    scheme: '2–3 quality sessions/week · low volume, high rest · film everything',
  },
]

export const STEP_BY_ID: Record<StepId, StepDef> = Object.fromEntries(
  STEPS.map((s) => [s.id, s]),
) as Record<StepId, StepDef>

export function stepAfter(id: StepId): StepDef | undefined {
  const s = STEP_BY_ID[id]
  return STEPS.find((x) => x.order === s.order + 1)
}

export function stepBefore(id: StepId): StepDef | undefined {
  const s = STEP_BY_ID[id]
  return STEPS.find((x) => x.order === s.order - 1)
}
