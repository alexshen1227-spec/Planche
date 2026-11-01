import type { StepId } from '../types'

/**
 * The road between each pair of steps: what actually changes, how the app
 * bridges it, what usually stalls people there, and what to watch.
 *
 * Every transition shares the same machinery (lib/bridge): bridge practice
 * opens once the current hold is halfway to its bar, and the next step opens
 * early when its shape is held clean at its opening dose. What differs is the
 * physical change, the drill that teaches it, and the tissue that takes the
 * new load — which is what this file is for.
 *
 * Evidence: the mechanics are INFERENCE (the app's rigid-body lever model,
 * loading.ts); the drills, blockers and cues are CONSENSUS — what experienced
 * planche coaches teach, not anything a trial has compared. The one STRONG
 * finding used here is the wrist one (ledger §6). No transition carries a
 * timeline: none is known.
 */
export interface Transition {
  from: StepId
  to: StepId
  /** What physically changes between the two shapes. */
  change: string
  /** What the app adds to sessions once the bridge opens. */
  bridge: string[]
  /** Extra things worth doing on your own, beyond the plan. */
  extras: string[]
  /** What usually stalls people here, and the fix that usually helps. */
  blockers: { stall: string; fix: string }[]
  /** The tissue that takes new load here, and what to do about it. */
  watch: string
}

export const TRANSITIONS: Transition[] = [
  {
    from: 'foundations',
    to: 'lean',
    change:
      'The shoulders travel forward of the hands and stay there. The pseudo planche plank is the same shape with a small lean; the planche lean is about leaning further while the arms stay locked.',
    bridge: [
      'Short planche-lean attempts first in the session, while fresh.',
      'Push-ups and pseudo planche push-ups for the pressing base.',
    ],
    extras: ['Mark your hand and foot positions so every lean is comparable.'],
    blockers: [
      { stall: 'Elbows bend to fake a bigger lean', fix: 'Lean less and lock first; the lean grows as the lock holds.' },
      { stall: 'Hips pike up', fix: 'Squeeze glutes and quads; lean from the shoulders, not the toes.' },
    ],
    watch:
      'Wrists start taking real load in extension. Keep the wrist routine before every session and build lean time gradually.',
  },
  {
    from: 'lean',
    to: 'frog',
    change:
      'The feet leave the floor for the first time, but the arms bend and the knees rest on them: the frog stand trades straight-arm strength for balance. Almost everything new is skill — steering with the fingertips.',
    bridge: [
      'Frog stand practice from day one — balance costs little strength, so there is nothing to wait for.',
      'Your lean stays the main strength work.',
    ],
    extras: [
      'A few relaxed frog stands on rest days are cheap practice; stop before the wrists complain.',
      'Look slightly ahead of the hands, not straight down.',
    ],
    blockers: [
      { stall: 'Tipping forward', fix: 'Press the fingertips into the floor to brake; that is the steering wheel.' },
      { stall: 'Feet will not lift', fix: 'Shift forward until they get light instead of jumping up.' },
      { stall: 'Crashing out of it', fix: 'Practise the exit: shift back onto the feet before you need to.' },
    ],
    watch:
      'All your bodyweight goes through extended wrists. Wrist pain is the best-documented problem in hand-balance training (gymnastics data, driven by weekly hours), so add frog time gradually and stop any set that hurts.',
  },
  {
    from: 'frog',
    to: 'tuck',
    change:
      'The knees come off the elbows and the arms straighten: the same balance point, now carried by straight-arm strength. The shoulders must lean further forward to keep the hips up.',
    bridge: [
      'Short tuck planche attempts first in the session once your frog stand is halfway to its bar: knees off the elbows, arms straightening.',
      'Deep planche leans — shoulders well past the fingertips — as the straight-arm strength work.',
    ],
    extras: ['From a frog stand, press the knees off the elbows for a second and set them back down — repeat a few times.'],
    blockers: [
      { stall: 'Arms stay bent', fix: 'That is still a frog stand. Lock the elbows first, then lean until the feet lift.' },
      { stall: 'Hips drop below the shoulders', fix: 'Round the upper back and pull the knees tight to the chest.' },
      { stall: 'Cannot lift at all', fix: 'More lean in your leans: the strength comes from the lean angle, not the stopwatch.' },
    ],
    watch:
      'The elbows meet straight-arm load for the first time. Coaches treat the elbow as the complaint not to train through — experienced opinion rather than established fact, but cheap to respect.',
  },
  {
    from: 'tuck',
    to: 'advtuck',
    change:
      'The back flattens and the hips open to about 90°, so the knees point down instead of tucking to the chest. That moves your centre of mass away from your hands: in the app’s lever model (an inference, not a measurement), shoulder load rises from about 54% to about 72% of a full planche. It is the jump most athletes stall on.',
    bridge: [
      'Advanced tuck attempts first in the session once your tuck reaches about 10s — short and fresh.',
      'Tuck open-and-close: the transition itself, opening toward the flat back and returning.',
      'Tuck planche push-ups as the pressing twin, deep leans for the bigger lean the flat back needs.',
    ],
    extras: [
      'Film your tucks from the side: the camera measures how open your hips are, so you can watch the angle move toward the advanced tuck.',
      'Open the hips a little at a time — a slightly flatter tuck is real progress, not a failed advanced tuck.',
    ],
    blockers: [
      { stall: 'The back rounds back into a tuck as the hips open', fix: 'Open in smaller steps and check the side-on replay.' },
      { stall: 'Hips drop when the back flattens', fix: 'Lean further: a longer lever needs the shoulders further past the hands.' },
      { stall: 'Elbows soften under the new load', fix: 'Reduce the opening until the lock holds; the camera flags a late softening.' },
      { stall: 'Protraction fades as the back flattens', fix: 'Push tall between the shoulder blades; scapula push-ups help.' },
    ],
    watch:
      'Load on the elbows and shoulders jumps here, and the lower back starts working to hold the flat line. If your verified hold jumps quickly, the plan deliberately holds volume steady rather than adding more.',
  },
  {
    from: 'advtuck',
    to: 'oneleg',
    change:
      'One leg extends straight back in line with the flat back while the other stays tucked. The lever grows on one side, so the hips want to roll and the lean must grow again.',
    bridge: [
      'One-leg attempts each side, first in the session, once your advanced tuck reaches about 10s — the weaker side leads.',
      'Advanced tuck push-ups as the pressing twin.',
    ],
    extras: ['One-leg planche leans (one foot lifted) expose the side-to-side difference cheaply.'],
    blockers: [
      { stall: 'Hips roll toward the tucked side', fix: 'Keep the hips square; lead every set with the weaker side.' },
      { stall: 'The extended leg drifts high', fix: 'Glutes on and the leg in line with the back, not above it.' },
      { stall: 'The back rounds when the leg goes out', fix: 'Extend part-way first and lengthen as the flat back holds.' },
    ],
    watch: 'Uneven sides load one shoulder more. Train both sides the same number of sets.',
  },
  {
    from: 'oneleg',
    to: 'straddle',
    change:
      'Both legs extend and spread. Width shortens the lever — a wider straddle is a lighter hold — so every degree of hip mobility buys a lighter position to hold.',
    bridge: [
      'Straddle attempts first in the session, as wide as you can hold straight-legged, once your one-leg reaches about 6s each side.',
      'Band-assisted straddle when you have a band and somewhere to anchor it.',
      'Pancake mobility in the cooldown.',
    ],
    extras: ['Seated pike lifts build the compression that keeps the legs up and straight.'],
    blockers: [
      { stall: 'Hips pike up', fix: 'Wider legs and glutes on; a tent shape is not a straddle.' },
      { stall: 'A narrow straddle', fix: 'Pancake work: every degree of width is a lighter hold.' },
      { stall: 'Knees bend', fix: 'Squeeze the quads; bent knees shorten the lever but are not the shape.' },
    ],
    watch: 'Adductors and the lower back join the load. Warm the hips before straddle work.',
  },
  {
    from: 'straddle',
    to: 'full',
    change:
      'The legs come together: the longest lever there is. The road is narrowing the straddle a few degrees at a time while the lean grows.',
    bridge: [
      'Full planche attempts first in the session once your straddle reaches about 7.5s — one or two seconds is a real attempt here.',
      'Straddle planche push-ups as the pressing twin.',
      'Narrow your straddle a little at a time within your main holds.',
    ],
    extras: ['Keep long rests: maximal levers want a fresh nervous system more than volume.'],
    blockers: [
      { stall: 'Legs high, back arched', fix: 'Ribs down, glutes on: a level line or it does not count.' },
      { stall: 'Protraction is the first thing to go', fix: 'End the set at the first shrug or sag rather than grinding.' },
    ],
    watch: 'The maximal lever puts the most stress on wrists, elbows and shoulders the road ever asks for. Low volume, long rests, nothing tired.',
  },
]

export const TRANSITION_FROM: Partial<Record<StepId, Transition>> = Object.fromEntries(
  TRANSITIONS.map((t) => [t.from, t]),
)
