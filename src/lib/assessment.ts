import type { StepId } from '../types'
import { STEPS, STEP_BY_ID, stepAfter } from '../data/progressions'

/**
 * Working out where an athlete actually is, instead of asking them to guess.
 *
 * The old placement screen offered five self-descriptions ("I can hold a frog
 * stand") and trusted the tap. That fails in both directions: people place
 * themselves ambitiously and then fail every prescribed set, or modestly and
 * spend a month re-earning something they already own. Both cost weeks, and
 * the second one is the reason people abandon a program.
 *
 * This asks instead for numbers the athlete can check against a stopwatch, in
 * ascending order, and stops at the first thing they cannot do. Typically five
 * questions. The result carries a confidence and a list of prerequisite gaps,
 * because placement is a claim about strength and the gaps are usually what
 * actually decide how fast the next month goes.
 *
 * Everything here is pure: answers in, placement out. It is the whole reason
 * the placement can be unit-tested against the contradictory, exaggerated and
 * empty inputs real people produce.
 */

export type AssessmentItemId =
  | 'wrist'
  | 'pushups'
  | 'hollow'
  | 'ppp-hold'
  | 'planche-lean'
  | 'frog-stand'
  | 'tuck-planche'
  | 'adv-tuck-planche'
  | 'one-leg-planche'
  | 'straddle-planche'
  | 'full-planche'
  | 'experience'

export interface AssessmentOption {
  label: string
  /** Seconds, reps, or months — whatever the item measures. */
  value: number
  hint?: string
}

export interface AssessmentItem {
  id: AssessmentItemId
  /** Set when the item measures a real exercise, so the Library can link it. */
  exerciseId?: string
  question: string
  /** What "counts", in the athlete's language. Honesty depends on this. */
  standard?: string
  unit: 'sec' | 'reps' | 'months' | 'choice'
  options: AssessmentOption[]
  /**
   * True for the planche ladder itself. The interview stops at the first
   * ladder item answered zero, so nobody is asked about a full planche after
   * saying they cannot hold a tuck.
   */
  ladder?: boolean
}

/**
 * Ordered as asked. The ladder items are in road order so the stop-at-first-
 * zero rule matches the progression the placement returns.
 */
export const ASSESSMENT_ITEMS: AssessmentItem[] = [
  {
    id: 'wrist',
    question: 'Can you hold a push-up position on your palms for 30 seconds without wrist pain?',
    standard: 'Straight arms, hands flat on the floor. Discomfort is not the same as pain.',
    unit: 'choice',
    options: [
      { label: 'Yes, comfortably', value: 2 },
      { label: 'It aches, but no pain', value: 1 },
      { label: 'No — it hurts', value: 0, hint: 'Wrist prep becomes the priority before loaded work' },
    ],
  },
  {
    id: 'pushups',
    question: 'How many clean push-ups can you do in one set?',
    standard: 'Chest to fist height, body in one line, no sagging hips.',
    unit: 'reps',
    options: [
      { label: 'Fewer than 5', value: 3 },
      { label: '5–9', value: 6 },
      { label: '10–19', value: 12 },
      { label: '20 or more', value: 22 },
    ],
  },
  {
    id: 'hollow',
    question: 'How long can you hold a hollow body position?',
    standard: 'Lower back flat on the floor, shoulders and legs off it. It stops when the back lifts.',
    unit: 'sec',
    options: [
      { label: 'Under 15s', value: 8 },
      { label: '15–29s', value: 20 },
      { label: '30–44s', value: 35 },
      { label: '45s or more', value: 50 },
    ],
  },
  {
    id: 'ppp-hold',
    exerciseId: 'ppp-hold',
    question: 'Pseudo planche plank — shoulders in front of your wrists, elbows locked. How long?',
    standard: 'Shoulders clearly ahead of the hands, arms completely straight, hips level.',
    unit: 'sec',
    ladder: true,
    options: [
      { label: "Can't hold it yet", value: 0 },
      { label: 'Up to 15s', value: 10 },
      { label: '15–29s', value: 20 },
      { label: '30s or more', value: 32 },
    ],
  },
  {
    id: 'planche-lean',
    exerciseId: 'planche-lean',
    question: 'Planche lean — shoulders travelling well past your fingertips. How long?',
    standard: 'Elbows locked the whole time. If the elbows bend to get further forward, it does not count.',
    unit: 'sec',
    ladder: true,
    options: [
      { label: "Can't hold a real lean yet", value: 0 },
      { label: 'Up to 12s', value: 8 },
      { label: '12–29s', value: 18 },
      { label: '30s or more', value: 32 },
    ],
  },
  {
    id: 'frog-stand',
    exerciseId: 'frog-stand',
    question: 'Frog stand — knees resting on your elbows, feet off the floor. How long?',
    standard: 'Balance skill rather than strength. It is fine to have none of this yet.',
    unit: 'sec',
    ladder: true,
    options: [
      { label: 'Not yet', value: 0 },
      { label: 'A few seconds', value: 6 },
      { label: '10–29s', value: 18 },
      { label: '30s or more', value: 32 },
    ],
  },
  {
    id: 'tuck-planche',
    exerciseId: 'tuck-planche',
    question: 'Tuck planche — knees to chest, feet off the floor, arms straight. How long?',
    standard: 'Hips at roughly shoulder height and arms locked. A supported crouch is not a tuck planche.',
    unit: 'sec',
    ladder: true,
    options: [
      { label: 'Not yet', value: 0 },
      { label: '1–4s', value: 3 },
      { label: '5–14s', value: 8 },
      { label: '15–19s', value: 16 },
      { label: '20s or more', value: 22 },
    ],
  },
  {
    id: 'adv-tuck-planche',
    exerciseId: 'adv-tuck-planche',
    question: 'Advanced tuck — back flat and parallel to the floor, hips open. How long?',
    standard: 'Film it from the side once before answering. A slightly-unrounded tuck is not an advanced tuck.',
    unit: 'sec',
    ladder: true,
    options: [
      { label: 'Not yet', value: 0 },
      { label: '1–4s', value: 3 },
      { label: '5–14s', value: 8 },
      { label: '15–19s', value: 16 },
      { label: '20s or more', value: 22 },
    ],
  },
  {
    id: 'one-leg-planche',
    exerciseId: 'one-leg-planche',
    question: 'One-leg extension from an advanced tuck — how long, on your weaker side?',
    standard: 'Weaker side on purpose: the road is limited by it, not by your best side.',
    unit: 'sec',
    ladder: true,
    options: [
      { label: 'Not yet', value: 0 },
      { label: '1–3s', value: 2 },
      { label: '4–9s', value: 6 },
      { label: '10s or more', value: 13 },
    ],
  },
  {
    id: 'straddle-planche',
    exerciseId: 'straddle-planche',
    question: 'Straddle planche — both legs straight and wide, hips open. How long?',
    standard: 'Body one flat plane. Hips piked into a tent shape does not count.',
    unit: 'sec',
    ladder: true,
    options: [
      { label: 'Not yet', value: 0 },
      { label: '1–3s', value: 2 },
      { label: '4–9s', value: 6 },
      { label: '10–14s', value: 11 },
      { label: '15s or more', value: 16 },
    ],
  },
  {
    id: 'full-planche',
    exerciseId: 'full-planche',
    question: 'Full planche — legs together, body level. How long?',
    standard: 'Shoulders, hips and heels level. An arched back with the legs high is a different skill.',
    unit: 'sec',
    ladder: true,
    options: [
      { label: 'Not yet', value: 0 },
      { label: '1–2s', value: 1.5 },
      { label: '3–5s', value: 4 },
      { label: '6s or more', value: 7 },
    ],
  },
  {
    id: 'experience',
    question: 'How long have you been training straight-arm strength — leans, planche work, levers?',
    standard: 'Tendons and connective tissue adapt far more slowly than muscle, so this changes the sensible starting dose.',
    unit: 'months',
    options: [
      { label: 'Just starting', value: 0 },
      { label: 'Under 6 months', value: 3 },
      { label: '6–18 months', value: 12 },
      { label: 'Over 18 months', value: 24 },
    ],
  },
]

export const ASSESSMENT_BY_ID: Record<AssessmentItemId, AssessmentItem> = Object.fromEntries(
  ASSESSMENT_ITEMS.map((i) => [i.id, i]),
) as Record<AssessmentItemId, AssessmentItem>

export type AssessmentAnswers = Partial<Record<AssessmentItemId, number>>

export type GapId = 'wrist' | 'pressing' | 'core' | 'balance' | 'straight-arm-novice'

export interface AssessmentGap {
  id: GapId
  label: string
  detail: string
}

export interface Placement {
  stepId: StepId
  /**
   * How much the placement can be trusted. Never 'high' on self-report alone —
   * the first filmed session is what actually verifies it.
   */
  confidence: 'low' | 'moderate' | 'good'
  /** Why this step, in the athlete's language. */
  reason: string
  /** Prerequisite shortfalls worth training regardless of placement. */
  gaps: AssessmentGap[]
  /** Safety or honesty notes that deserve to be read before starting. */
  caveats: string[]
  /** Items whose answers contradict each other. */
  inconsistencies: string[]
}

/** Ladder steps in road order, excluding the pure balance skill. */
const STRENGTH_LADDER: StepId[] = ['foundations', 'lean', 'tuck', 'advtuck', 'oneleg', 'straddle', 'full']

/**
 * The next question worth asking, or null when the interview is done.
 *
 * Ladder items stop as soon as one is answered below its step's working
 * threshold: someone who cannot hold a tuck planche does not need to be asked
 * about a full one, and asking anyway reads as the app not listening.
 */
export function nextAssessmentItem(answers: AssessmentAnswers): AssessmentItem | null {
  const ladderItems = ASSESSMENT_ITEMS.filter((i) => i.ladder)
  for (const item of ASSESSMENT_ITEMS) {
    if (answers[item.id] !== undefined) continue
    if (item.ladder) {
      // Stop the ladder once a rung below this one came back zero. The frog
      // stand is exempt: it is balance, and it gates nothing above it.
      const rung = ladderItems.indexOf(item)
      const blockedBelow = ladderItems
        .slice(0, rung)
        .some((lower) => lower.id !== 'frog-stand' && answers[lower.id] === 0)
      if (blockedBelow) continue
    }
    return item
  }
  return null
}

/**
 * Roughly how far through the interview the athlete is.
 *
 * "Roughly" is honest rather than lazy: the remaining count genuinely depends
 * on answers not yet given, and a progress bar that promises eleven questions
 * to someone who will be asked five is worse than an approximate one.
 */
export function assessmentProgress(answers: AssessmentAnswers): { answered: number; likelyTotal: number } {
  const answered = ASSESSMENT_ITEMS.filter((i) => answers[i.id] !== undefined).length
  const fixed = ASSESSMENT_ITEMS.filter((i) => !i.ladder).length
  const ladderAnswered = ASSESSMENT_ITEMS.filter((i) => i.ladder && answers[i.id] !== undefined).length
  const laddersDone = nextAssessmentItem(answers) === null
  // While the ladder is still climbing, assume one more rung than answered.
  const ladderEstimate = laddersDone ? ladderAnswered : ladderAnswered + 1
  return { answered, likelyTotal: Math.max(answered, fixed + ladderEstimate) }
}

function answerFor(answers: AssessmentAnswers, stepId: StepId): number | undefined {
  const key = STEP_BY_ID[stepId]?.keyExerciseId as AssessmentItemId | undefined
  return key ? answers[key] : undefined
}

/**
 * Turn answers into a starting step.
 *
 * Walks the strength ladder upward: every step whose unlock bar is already met
 * is passed through (the athlete owns it), and the placement lands on the first
 * step they can work but not yet own. The frog stand is skipped over rather
 * than blocking, because balance and straight-arm strength are genuinely
 * separable — plenty of people can hold a tuck planche and fall out of a frog
 * stand, and stalling them at a balance drill would be an invented delay.
 */
export function placeFromAssessment(answers: AssessmentAnswers): Placement {
  let placed: StepId = 'foundations'
  let reason = 'Starting at Foundations — the wrist, scapula and hollow-body base every later step is built on.'
  const inconsistencies: string[] = []

  for (const stepId of STRENGTH_LADDER) {
    const step = STEP_BY_ID[stepId]
    const a = answerFor(answers, stepId)
    if (a === undefined) break
    if (a >= step.unlockSec) {
      const following = stepAfter(stepId)
      placed = following?.id ?? stepId
      reason = following
        ? `You already hold ${step.name.toLowerCase()} to its ${step.unlockSec}s mastery bar, so the road starts you on ${following.name}.`
        : `You are at the top of the road — ${step.name} is the summit.`
      continue
    }
    if (a >= step.startSec) {
      placed = stepId
      reason = `${step.name} is where the work is: you can hold it (${describeSeconds(a)}) but not yet to its ${step.unlockSec}s mastery bar.`
      break
    }
    break
  }

  // The frog stand sits between the lean and the tuck on the road but gates
  // neither. If it is the only thing standing between the athlete and a tuck
  // they can already hold, step past it and note the gap instead.
  if (placed === 'frog') {
    const tuck = answers['tuck-planche']
    if (tuck !== undefined && tuck >= STEP_BY_ID.tuck.startSec) {
      const advanced = placeFromAssessment({ ...answers, 'frog-stand': STEP_BY_ID.frog.unlockSec })
      return {
        ...advanced,
        gaps: dedupeGaps([
          ...advanced.gaps,
          {
            id: 'balance',
            label: 'Hand balance',
            detail:
              'You have the strength for this step but not the frog stand that usually comes with it. Balance is cheap to train and it is often what makes a hold feel unstable rather than heavy.',
          },
        ]),
      }
    }
  }

  const gaps: AssessmentGap[] = []
  const caveats: string[] = []

  const wrist = answers.wrist
  if (wrist === 0) {
    caveats.push(
      'You reported wrist pain in a plain push-up position. Wrist prep comes before loaded planche work in every session the app builds, and parallettes (or fists) usually remove the problem entirely. Pain that persists for weeks is worth a physio rather than a workaround.',
    )
    gaps.push({
      id: 'wrist',
      label: 'Wrist tolerance',
      detail:
        'Loaded straight-arm work puts the wrist in deep extension. Until 30 seconds on the palms is comfortable, the wrist is the limiter regardless of how strong the rest is.',
    })
  } else if (wrist === 1) {
    gaps.push({
      id: 'wrist',
      label: 'Wrist conditioning',
      detail: 'An achy wrist under a plain plank tends to become a painful one under a lean. Wrist work stays in every warm-up.',
    })
  }

  const placedOrder = STEP_BY_ID[placed].order
  const pushups = answers.pushups
  if (pushups !== undefined && pushups < 8 && placedOrder >= STEP_BY_ID.tuck.order) {
    gaps.push({
      id: 'pressing',
      label: 'Pressing strength',
      detail:
        'Your pressing base is behind your straight-arm work. That combination usually stalls a tuck planche within a couple of months, so pressing volume is worth keeping in the plan now rather than later.',
    })
    inconsistencies.push(
      'A tuck planche or better alongside fewer than 8 push-ups is an unusual combination — worth re-checking one of the two.',
    )
  }

  const hollow = answers.hollow
  if (hollow !== undefined && hollow < 20 && placedOrder >= STEP_BY_ID.tuck.order) {
    gaps.push({
      id: 'core',
      label: 'Body line',
      detail:
        'A flat back and locked pelvis are what separate an advanced tuck from a tuck. With a short hollow hold, the line will fail before the arms do.',
    })
  }

  const frog = answers['frog-stand']
  if (frog !== undefined && frog < 10 && placedOrder >= STEP_BY_ID.tuck.order) {
    gaps.push({
      id: 'balance',
      label: 'Hand balance',
      detail:
        'Balance is a large share of what makes early planche holds feel impossible. It is also the cheapest thing on this list to train — it costs almost nothing in recovery.',
    })
  }

  const experience = answers.experience
  if (experience !== undefined && experience < 6 && placedOrder >= STEP_BY_ID.tuck.order) {
    gaps.push({
      id: 'straight-arm-novice',
      label: 'New to straight-arm loading',
      detail:
        'Strength arrives faster than the structures carrying it. Early gains are largely your nervous system learning the position — measured strength can climb by a third while muscle and tendon are still unchanged — so what you can do today is ahead of what your tissue has adapted to. Early sessions stay deliberately below what you could survive, which is the shortest path rather than the cautious one.',
    })
    caveats.push(
      'You can already hold advanced positions with under six months of straight-arm training. That combination is the one coaches most often associate with elbow and biceps-tendon trouble — it is coaching consensus rather than a measured risk, since nobody has studied injury rates in this population, but the cost of respecting it is small. The plan holds volume back for a while even when it feels easy.',
    )
  }

  // Contradiction check: a later rung answered above an earlier one.
  for (let i = 1; i < STRENGTH_LADDER.length; i++) {
    const lower = answerFor(answers, STRENGTH_LADDER[i - 1])
    const upper = answerFor(answers, STRENGTH_LADDER[i])
    if (lower !== undefined && upper !== undefined && upper > 0 && lower === 0) {
      inconsistencies.push(
        `You reported time on ${STEP_BY_ID[STRENGTH_LADDER[i]].name.toLowerCase()} but none on ${STEP_BY_ID[
          STRENGTH_LADDER[i - 1]
        ].name.toLowerCase()}, which is the easier of the two.`,
      )
    }
  }

  const answered = Object.values(answers).filter((v) => v !== undefined).length
  const confidence: Placement['confidence'] =
    inconsistencies.length > 0 ? 'low' : answered >= 6 ? 'good' : answered >= 4 ? 'moderate' : 'low'

  return { stepId: placed, confidence, reason, gaps: dedupeGaps(gaps), caveats, inconsistencies }
}

function dedupeGaps(gaps: AssessmentGap[]): AssessmentGap[] {
  const seen = new Set<GapId>()
  return gaps.filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
}

function describeSeconds(sec: number): string {
  return sec >= 1 ? `about ${Math.round(sec)}s` : 'under a second'
}

/** The placement the old five-option screen would have produced, for comparison. */
export const LEGACY_PLACEMENT_STEPS: StepId[] = ['foundations', 'lean', 'tuck', 'advtuck', 'straddle']

/**
 * Which accessory the placement gaps argue for on the athlete's first sessions.
 *
 * Takes ids rather than whole gaps so the saved `AssessmentRecord` — which
 * keeps only the ids — can be passed straight in without reconstructing
 * objects it never stored.
 *
 * Deliberately a single answer rather than a list: a beginner given four
 * priorities has none. Wrist gaps are handled by the warm-up and the equipment
 * advice instead, so they do not compete for this slot.
 */
export function emphasisFromGaps(gapIds: readonly string[]): 'pressing' | 'core' | 'balance' | 'none' {
  const ids = new Set(gapIds)
  if (ids.has('pressing')) return 'pressing'
  if (ids.has('core')) return 'core'
  if (ids.has('balance')) return 'balance'
  return 'none'
}

/** Every step the ladder can place someone at, for tests and for the UI. */
export const PLACEABLE_STEPS: StepId[] = STEPS.map((s) => s.id)
