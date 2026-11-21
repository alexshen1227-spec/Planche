import type { SkillDef } from './types'
import { STEPS } from '../progressions'

/**
 * The planche, as a skill definition.
 *
 * Its road (`STEPS`) and its movements predate the other skills and stay where
 * they were — `data/progressions.ts` and `data/exercises.ts` — and its sessions
 * are assembled by hand in `data/workouts.ts`, so this carries no `program`.
 * What lives here is what every skill needs said about it: what it is, what it
 * loads, and what the camera can honestly see.
 */
export const PLANCHE: SkillDef = {
  id: 'planche',
  name: 'Planche',
  short: 'Planche',
  holdName: 'planche',
  tagline: 'Level over the hands, arms straight',
  blurb:
    'The body held level above the floor on straight arms, shoulders leaned far ahead of the hands. It is straight-arm pushing strength and balance together, built over a long road of leans, tucks and longer levers.',
  family: 'push',
  straightArm: true,
  surfaces: true,
  requires: [],
  loads: ['wrist', 'elbow', 'shoulder'],
  camera: {
    view: 'side',
    placement: 'Phone side-on at about hip height, on its side, far enough back to keep the hands and feet in frame.',
    honesty:
      'From the side the camera reads elbow lock, forward lean, hip height, hip opening and straight legs. It cannot see the shoulder blades, and it cannot tell a toe on the floor from flight — you confirm that.',
  },
  sourcing:
    'The ladder is the one coaches use almost without exception; the hold times that open each step are coaching convention — credible coaches differ several-fold, and no study has validated any of them.',
  prerequisites: [
    'Comfortable push-ups and a plank you can hold — the Foundations step builds the wrists, shoulder blades and hollow body before any lean.',
  ],
  safety: [
    'Straight-arm work loads the elbows and the front of the shoulders hard, and the wrists deeply. Pain that builds from week to week is the signal to back off, whatever a single day feels like.',
    'Wrist preparation gets the wrists ready for load; no trial shows that it prevents injury.',
  ],
  frequency: 'Coaches commonly train it three times a week, a fourth only once the joints have adapted.',
  steps: STEPS,
  defaultGoal: 'straddle',
  words: {
    strength: 'pressing',
    strengthVerb: 'press',
    support: 'leans',
    contact: 'the floor',
    summit: 'the full planche',
  },
  holdAggregateSec: 60,
  exercises: [],
}
