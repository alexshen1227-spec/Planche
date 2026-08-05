import type { AppState, Block, BlockTarget, BodyRegion, CheckIn, StepId, Workout } from '../types'
import { EXERCISE_BY_ID } from './exercises'
import { STEP_BY_ID, stepBefore } from './progressions'
import { buildPlan, type CoachPlan, type WarmupLevel } from '../lib/coach'
import { median } from '../lib/signals'
import { qualifyingProgress, qualifyingSessionValue } from '../lib/progression'
import { leadInSecondsFor, stopLatencySecondsFor } from '../lib/sessionTiming'

const hold = (sec: number): BlockTarget => ({ kind: 'hold', sec })
const reps = (n: number): BlockTarget => ({ kind: 'reps', reps: n })

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

/**
 * Unilateral work is stored as two rounds per set — left then right — so the
 * player can label each side and both get logged separately.
 */
function withSides(blocks: Block[]): Block[] {
  return blocks.map((b) =>
    EXERCISE_BY_ID[b.exerciseId]?.perSide ? { ...b, sets: b.sets * 2 } : b,
  )
}

/**
 * How a block reads in a plan list. Unilateral blocks are stored doubled, so
 * showing the raw count would claim twice the rounds actually prescribed.
 */
export function describeBlock(b: Block): string {
  const perSide = EXERCISE_BY_ID[b.exerciseId]?.perSide
  const rounds = perSide ? Math.ceil(b.sets / 2) : b.sets
  const target = b.target.kind === 'hold' ? `${b.target.sec}s` : `${b.target.reps}`
  return `${rounds}×${target}${perSide ? ' / side' : ''}`
}

/** The single work target worth surfacing before a session starts. */
export function primaryTargetBlock(workout: Workout): Block | undefined {
  return (
    workout.blocks.find((block) => block.section === 'main') ??
    workout.blocks.find((block) => block.section === 'strength') ??
    workout.blocks.find((block) => block.section !== 'warmup' && block.section !== 'cooldown') ??
    workout.blocks[0]
  )
}

/** Human-readable target for the preview and setup screens. */
export function describeTarget(block: Block): string {
  const perSide = EXERCISE_BY_ID[block.exerciseId]?.perSide
  const target = block.target.kind === 'hold' ? `${block.target.sec}s hold` : `${block.target.reps} reps`
  return `${target}${perSide ? ' each side' : ' each set'}`
}

/**
 * Rounds as the athlete counts them: a unilateral block stored as four rounds
 * is two sets. Keeps the "N sets" badge consistent with the block list.
 */
export function countRounds(blocks: Block[]): number {
  return blocks.reduce(
    (n, b) => n + (EXERCISE_BY_ID[b.exerciseId]?.perSide ? Math.ceil(b.sets / 2) : b.sets),
    0,
  )
}

export function estimateMinutes(
  blocks: Block[],
  calibratedStopLatencySec = 2.3,
  phoneWithinReach = false,
): number {
  let sec = 0
  let remaining = blocks.reduce((total, block) => total + block.sets, 0)
  for (const b of blocks) {
    const work = b.target.kind === 'hold' ? b.target.sec : b.target.reps * 3
    const setup =
      b.target.kind === 'hold'
        ? leadInSecondsFor(b.exerciseId) +
          stopLatencySecondsFor(b.exerciseId, calibratedStopLatencySec, phoneWithinReach)
        : 0
    for (let set = 0; set < b.sets; set++) {
      sec += work + setup
      remaining -= 1
      // The player rests between blocks too, but never after the final set.
      if (remaining > 0) sec += b.restSec
    }
  }
  return Math.max(5, Math.round(sec / 60))
}

// ————————————————————————————— Adaptive engine —————————————————————————————
// Day type, rest, warm-up level and emphasis all come from the coach's plan
// (src/lib/coach.ts). This module only assembles blocks from that plan.

/**
 * Working-set target, anchored robustly.
 *
 * Anchoring on the all-time best is tempting but fragile: a single
 * mis-measured or lucky hold would permanently inflate every future target
 * and quietly set the athlete up to fail every set. Instead the anchor is the
 * median of recent session bests — immune to one bad value — and the all-time
 * best is only allowed to pull it up a little. The coach applies the one
 * evidence-scaled hit-rate nudge later; doing it here as well caused swings.
 */
export function adaptiveTarget(state: AppState, stepId: StepId): number {
  const step = STEP_BY_ID[stepId]
  const best = qualifyingProgress(state, stepId).value
  if (!best) {
    // Unverified time must never raise a target or unlock a step, but it is
    // still useful as a safety ceiling. A beginner with a real 3s tuck should
    // not receive the generic 5s working sets merely because the clip failed.
    const timerBest = state.prs[step.keyExerciseId]?.value ?? 0
    if (timerBest > 0) return clamp(Math.round(timerBest * 0.6), 1, step.startSec)
    return step.startSec
  }

  const recentBests = [...state.sessions]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => qualifyingSessionValue(s, stepId))
    .filter((v) => v > 0)
    .slice(-6)

  const typical = median(recentBests)
  // Blend: mostly what you can repeat, with a nod to your peak.
  const anchor = typical === null ? best : typical * 0.75 + Math.min(best, typical * 1.5) * 0.25
  const t = anchor * 0.6
  return clamp(Math.round(t), 1, step.unlockSec)
}


/**
 * Trim a session to the athlete's time budget, sacrificing least-important
 * work first: accessory sets → whole accessory blocks → a main back-off set.
 * Warm-up, the key main work and the cooldown are never cut below minimums.
 */
function fitToBudget(
  blocks: Block[],
  budgetMin: number,
  preserveCorePair = false,
  calibratedStopLatencySec = 2.3,
  phoneWithinReach = false,
): Block[] {
  const out = blocks.map((b) => ({ ...b }))
  for (
    let guard = 0;
    guard < 40 && estimateMinutes(out, calibratedStopLatencySec, phoneWithinReach) > budgetMin;
    guard++
  ) {
    let changed = false
    // 1. Shave sets off strength/core blocks (from the back), floor 2.
    //    Unilateral blocks come off in pairs so a side never goes untrained.
    for (let i = out.length - 1; i >= 0; i--) {
      const b = out[i]
      const stepSize = EXERCISE_BY_ID[b.exerciseId]?.perSide ? 2 : 1
      if ((b.section === 'strength' || b.section === 'core') && b.sets - stepSize >= 2) {
        b.sets -= stepSize
        changed = true
        break
      }
    }
    if (changed) continue
    // 2. Drop the last strength block while more than one remains.
    const strengthIdx = out.map((b, i) => (b.section === 'strength' ? i : -1)).filter((i) => i >= 0)
    if (strengthIdx.length > 1) {
      out.splice(strengthIdx[strengthIdx.length - 1], 1)
      continue
    }
    // A remaining generic strength block is supporting work, not more
    // important than the two separate core blocks the coach explicitly chose
    // for a measured body-line limiter.
    const coreCount = out.filter((b) => b.section === 'core').length
    if (preserveCorePair && strengthIdx.length === 1 && coreCount > 1) {
      out.splice(strengthIdx[0], 1)
      continue
    }
    if (preserveCorePair && coreCount > 1) {
      const main = out.find((b) => {
        const stepSize = EXERCISE_BY_ID[b.exerciseId]?.perSide ? 2 : 1
        return b.section === 'main' && b.sets - stepSize >= 3
      })
      if (main) {
        main.sets -= EXERCISE_BY_ID[main.exerciseId]?.perSide ? 2 : 1
        continue
      }
      const optionalGoalMobility = out.findIndex(
        (b) => b.exerciseId === 'pancake-stretch' && b.note?.includes('goal'),
      )
      if (optionalGoalMobility >= 0) {
        out.splice(optionalGoalMobility, 1)
        continue
      }
    }
    // 3. Drop a core block while more than one remains.
    const coreIdx = out.map((b, i) => (b.section === 'core' ? i : -1)).filter((i) => i >= 0)
    if (coreIdx.length > 1) {
      out.splice(coreIdx[coreIdx.length - 1], 1)
      continue
    }
    // 4. Reduce main sets, floor 3 (again in pairs for unilateral work).
    const main = out.find((b) => {
      const stepSize = EXERCISE_BY_ID[b.exerciseId]?.perSide ? 2 : 1
      return b.section === 'main' && b.sets - stepSize >= 3
    })
    if (main) {
      main.sets -= EXERCISE_BY_ID[main.exerciseId]?.perSide ? 2 : 1
      continue
    }
    break
  }
  return out
}

/**
 * Warm-up scales with what the coach observed: cold, achy, or warm-up-skipping
 * athletes get general prep first. Wrists are in every version — they are the
 * most common reason people stop training.
 */
function warmupFor(stepId: StepId, level: WarmupLevel): Block[] {
  const step = STEP_BY_ID[stepId]
  const blocks: Block[] = []
  if (level === 'extended') {
    blocks.push(
      {
        exerciseId: 'jumping-jacks',
        sets: 1,
        target: reps(30),
        restSec: 15,
        section: 'warmup',
        note: 'Get genuinely warm before anything gets loaded.',
      },
      { exerciseId: 'arm-circles', sets: 1, target: reps(10), restSec: 10, section: 'warmup' },
      { exerciseId: 'cat-cow', sets: 1, target: reps(8), restSec: 10, section: 'warmup' },
    )
  } else if (level === 'standard') {
    blocks.push({ exerciseId: 'arm-circles', sets: 1, target: reps(10), restSec: 10, section: 'warmup' })
  }
  blocks.push(
    { exerciseId: 'wrist-circles', sets: 1, target: reps(10), restSec: 10, section: 'warmup' },
    { exerciseId: 'wrist-rocks', sets: 1, target: reps(8), restSec: 15, section: 'warmup' },
  )
  if (level !== 'short') {
    blocks.push({ exerciseId: 'scap-pushup', sets: 1, target: reps(8), restSec: 25, section: 'warmup' })
  }
  if (step.order >= 1) {
    blocks.push({
      exerciseId: 'planche-lean',
      sets: 1,
      target: hold(8),
      restSec: 40,
      section: 'warmup',
      note:
        step.order >= 5
          ? 'Primer only — keep the straight-arm lean pattern without stealing energy from longer-lever work.'
          : 'Easy primer lean — grease the pattern, save the juice.',
    })
  } else {
    blocks.push({ exerciseId: 'plank', sets: 1, target: hold(20), restSec: 40, section: 'warmup' })
  }
  return blocks
}

const DAY_LABEL: Record<CoachPlan['dayType'], string> = {
  push: 'Push Day',
  build: 'Build Day',
  technique: 'Technique Day',
  deload: 'Deload Day',
  recovery: 'Pain-Safe Recovery',
}

/**
 * Which reported region makes a given movement a bad idea today.
 *
 * Only movements that genuinely load the region are listed. Being too eager
 * here is its own failure: strip everything and the session becomes an empty
 * screen, which teaches athletes to stop reporting pain at all.
 */
const REGION_CONFLICTS: Record<BodyRegion, string[]> = {
  // Anything that puts bodyweight through an extended wrist. Cat–Cow looks
  // harmless but is on hands and knees — its own description says it loads the
  // wrists, and a recovery session is exactly where that matters.
  wrist: ['cat-cow'],
  // Nothing in the recovery set loads a straight arm — kept explicit so a
  // future addition has to make the same judgement rather than inherit a gap.
  elbow: [],
  shoulder: ['jumping-jacks'],
  // The default recovery block was three straight lumbar/hip-flexor exercises,
  // handed to the one athlete who should not be doing any of them.
  'lower-back': ['arch-hold', 'leg-lifts', 'hollow-hold'],
  other: [],
}

const REGION_LABEL: Record<BodyRegion, string> = {
  wrist: 'wrist',
  elbow: 'elbow',
  shoulder: 'shoulder',
  'lower-back': 'lower back',
  other: 'reported area',
}

/**
 * A session for a day something hurts.
 *
 * The region matters. This used to be one fixed block list handed to everyone
 * who reported pain — which meant an athlete with a sore lower back was
 * prescribed arch holds, leg lifts and hollow holds, three movements that load
 * exactly the thing they had just flagged. Naming the region lets the session
 * avoid it and say so, instead of hoping they read the disclaimer.
 */
export function painSafeRecoveryWorkout(regions: BodyRegion[] = []): Workout {
  const avoid = new Set(regions.flatMap((r) => REGION_CONFLICTS[r] ?? []))
  const candidates: Block[] = [
    {
      exerciseId: 'jumping-jacks',
      sets: 2,
      target: reps(20),
      restSec: 30,
      section: 'warmup',
      note: 'Easy pace. Skip if the arm motion reproduces symptoms.',
    },
    { exerciseId: 'cat-cow', sets: 2, target: reps(8), restSec: 20, section: 'warmup' },
    { exerciseId: 'hollow-hold', sets: 3, target: hold(20), restSec: 60, section: 'core' },
    { exerciseId: 'leg-lifts', sets: 3, target: reps(8), restSec: 60, section: 'core' },
    { exerciseId: 'arch-hold', sets: 2, target: hold(15), restSec: 45, section: 'core' },
    { exerciseId: 'pancake-stretch', sets: 2, target: hold(30), restSec: 30, section: 'cooldown' },
  ]
  const blocks = candidates.filter((b) => !avoid.has(b.exerciseId))
  const named = regions.filter((r) => r !== 'other').map((r) => REGION_LABEL[r])
  const removed = candidates.length - blocks.length

  const focus =
    named.length > 0
      ? `No loaded planche, pressing or wrist work. ${
          removed > 0
            ? `Movements that load your ${joinWords(named)} have been left out too. `
            : ''
        }Use only pain-free movement, and stop anything that reproduces symptoms.`
      : 'No loaded planche, pressing or wrist work. Use only pain-free movement; stop anything that reproduces symptoms.'

  return {
    id: named.length ? `pain-safe-recovery-${[...regions].sort().join('-')}` : 'pain-safe-recovery',
    name: 'Pain-Safe Recovery',
    focus,
    minutes: estimateMinutes(blocks),
    kind: 'auto',
    blocks,
    strategy: 'technique',
  }
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** Apply a readiness answer to a user-selected template before it can start. */
export function adjustedTemplateWorkout(workout: Workout, checkIn: CheckIn): Workout {
  if (checkIn.joints === 'pain') return painSafeRecoveryWorkout(checkIn.regions ?? [])
  if (workout.kind !== 'template' || (checkIn.joints === 'good' && checkIn.energy !== 'tired')) return workout

  const jointScale = checkIn.joints === 'niggle' ? 0.8 : 1
  const volumeScale = checkIn.energy === 'tired' ? 0.8 : checkIn.joints === 'niggle' ? 0.8 : 1
  const blocks = workout.blocks.map((block) => {
    if (block.section === 'warmup' || block.section === 'cooldown') return block
    const category = EXERCISE_BY_ID[block.exerciseId]?.category
    const upperLoaded = category === 'planche' || category === 'push' || category === 'scapula' || category === 'wrist'
    const targetFactor = upperLoaded ? jointScale : 1
    const target =
      block.target.kind === 'hold'
        ? hold(Math.max(3, Math.round(block.target.sec * targetFactor)))
        : reps(Math.max(1, Math.round(block.target.reps * targetFactor)))
    return {
      ...block,
      sets: Math.max(1, Math.round(block.sets * volumeScale)),
      target,
      restSec: upperLoaded ? Math.max(block.restSec, 90) : block.restSec,
    }
  })
  return {
    ...workout,
    id: `${workout.id}-readiness-adjusted`,
    name: `${workout.name} · Adjusted`,
    focus: `${workout.focus} Scaled for today's ${checkIn.joints === 'niggle' ? 'joint niggle' : 'low energy'}; stop any set that worsens symptoms.`,
    minutes: estimateMinutes(blocks),
    blocks,
  }
}

/**
 * The recommended session, assembled from the coach's plan for today.
 *
 * @param minutesOverride a smaller time budget for today only. The realistic
 * alternative to "I have twenty minutes" is skipping entirely, and a skipped
 * session teaches the coach nothing — so re-scoping today beats re-planning
 * the week. The trimming order in `fitToBudget` already protects the warm-up,
 * the key main work and the cooldown, so a short session is a real session.
 */
export function todaysSession(state: AppState, planIn?: CoachPlan, minutesOverride?: number): Workout {
  const stepId = state.stepId
  const step = STEP_BY_ID[stepId]
  const plan = planIn ?? buildPlan(state)
  if (plan.loadPermission === 'none') {
    return painSafeRecoveryWorkout(plan.signals.lastCheckIn?.regions ?? [])
  }
  const rMain = plan.restMainSec
  const rAcc = plan.restAccessorySec
  const vol = plan.volumeFactor
  const scale = (n: number) => Math.max(1, Math.round(n * vol))
  const blocks: Block[] = []

  // An extended warm-up is a coach safety rail and cannot be disabled by the
  // convenience preference.
  if (state.settings.warmup || plan.warmup === 'extended') blocks.push(...warmupFor(stepId, plan.warmup))

  // Fresh and within reach → attempt the unlock while at your best.
  if (plan.queueUnlockAttempt) {
    blocks.push({
      exerciseId: step.keyExerciseId,
      sets: 1,
      target: hold(step.unlockSec),
      restSec: 180,
      section: 'main',
      note: `Unlock attempt — you're within reach. Hold ${step.unlockSec}s clean, film it, and pass both form confirmations.`,
    })
  }

  // Main isometrics, shaped by the strategy the coach measured as fastest.
  const baseTarget = adaptiveTarget(state, stepId)
  const target = clamp(Math.round(baseTarget * plan.targetFactor), 3, step.unlockSec)
  const baseSets = plan.queueUnlockAttempt ? 3 : 4
  blocks.push({
    exerciseId: step.keyExerciseId,
    sets: clamp(scale(baseSets + plan.setsDelta), 2, 8),
    target: hold(target),
    restSec: rMain,
    section: 'main',
    note:
      plan.strategy === 'technique'
        ? 'Easy targets today — perfect positions, zero grinding.'
        : plan.strategy === 'intensity'
          ? 'Heavy clean holds. Rest fully and stop the instant elbow lock or body line goes.'
          : plan.strategy === 'density'
            ? 'Short rests on purpose, but never chase the timer past the first loss of shape.'
            : 'Stop each set ~2s before failure or at the first loss of shape. Quality over seconds.',
  })

  // One back-off block on the previous step keeps old positions honest.
  const prev = stepBefore(stepId)
  if (prev && prev.order >= 1 && plan.dayType !== 'technique' && plan.dayType !== 'deload') {
    blocks.push({
      exerciseId: prev.keyExerciseId,
      sets: 2,
      target: hold(clamp(Math.round(prev.unlockSec * 0.6), 5, prev.unlockSec)),
      restSec: rAcc,
      section: 'main',
      note: 'Back-off volume on the step you already own.',
    })
  }

  const easy = plan.dayType === 'technique' || plan.dayType === 'deload'

  // Leans remain strength work when an athlete first earns Tuck, then taper
  // to maintenance at Advanced Tuck. Longer-lever steps keep only the warm-up
  // primer above so their best energy still goes to the specific progression.
  const leanStrength: Block | null =
    !easy && (stepId === 'tuck' || stepId === 'advtuck')
      ? {
          exerciseId: 'planche-lean',
          sets: stepId === 'tuck' ? clamp(scale(3), 3, 4) : 2,
          target: hold(stepId === 'tuck' ? 12 : 10),
          restSec: rAcc,
          section: 'strength',
          note:
            stepId === 'tuck'
              ? 'Straight-arm strength work — lean farther with locked elbows instead of chasing a longer stopwatch.'
              : 'Maintenance volume — keep the lean sharp, but save your best strength for Advanced Tuck.',
        }
      : null

  // With no measured limiter, this is the first accessory and survives before
  // generic pressing work when a short time budget needs trimming.
  if (leanStrength && plan.accessoryEmphasis === 'none') {
    blocks.push(leanStrength)
  }

  // Accessories: the coach decides what is actually limiting you.
  if (easy) {
    blocks.push({
      exerciseId: 'frog-stand',
      sets: 2,
      target: hold(15),
      restSec: rAcc,
      section: 'strength',
      note: 'Balance practice — cheap on tendons, great for skill.',
    })
  } else if (plan.accessoryEmphasis === 'scapula') {
    blocks.push(
      {
        exerciseId: 'scap-pushup',
        sets: scale(4),
        target: reps(10),
        restSec: rAcc,
        section: 'strength',
        note: 'Scapular control is the limiter — finish every rep by pushing the floor fully away.',
      },
      { exerciseId: 'pppu', sets: scale(2), target: reps(6), restSec: rAcc, section: 'strength' },
    )
  } else if (plan.accessoryEmphasis === 'core') {
    blocks.push(
      {
        exerciseId: 'hollow-hold',
        sets: scale(4),
        target: hold(25),
        restSec: 60,
        section: 'core',
        note: 'Body line is the limiter — lock ribs, pelvis and legs into one unit.',
      },
      { exerciseId: 'arch-hold', sets: scale(3), target: hold(20), restSec: 60, section: 'core' },
    )
  } else if (plan.accessoryEmphasis === 'balance') {
    blocks.push(
      { exerciseId: 'frog-stand', sets: scale(3), target: hold(20), restSec: rAcc, section: 'strength', note: 'Balance is the limiter right now, not raw strength.' },
      { exerciseId: 'pppu', sets: scale(2), target: reps(6), restSec: rAcc, section: 'strength' },
    )
  } else if (plan.accessoryEmphasis === 'pressing') {
    blocks.push(
      { exerciseId: 'pppu', sets: scale(4), target: reps(6), restSec: rAcc, section: 'strength', note: 'Extra pressing volume — this is what unblocks a stalled hold.' },
      { exerciseId: 'pike-pushup', sets: scale(3), target: reps(8), restSec: rAcc, section: 'strength' },
    )
  } else if (step.order <= 2) {
    blocks.push(
      { exerciseId: 'pppu', sets: scale(3), target: reps(5), restSec: rAcc, section: 'strength' },
      { exerciseId: 'pushup', sets: scale(2), target: reps(10), restSec: rAcc, section: 'strength' },
    )
  } else if (step.order <= 4) {
    blocks.push(
      { exerciseId: 'pppu', sets: scale(3), target: reps(6), restSec: rAcc, section: 'strength' },
      { exerciseId: 'pike-pushup', sets: scale(2), target: reps(8), restSec: rAcc, section: 'strength' },
    )
  } else {
    blocks.push(
      state.profile.equipment.includes('parallettes')
        ? {
            exerciseId: 'tuck-planche-pushup',
            sets: scale(3),
            target: reps(4),
            restSec: rMain,
            section: 'strength',
          }
        : {
            exerciseId: 'pppu',
            sets: scale(3),
            target: reps(8),
            restSec: rMain,
            section: 'strength',
            note: 'Floor-friendly pressing substitute; parallettes are not in your equipment profile.',
          },
      { exerciseId: 'pike-pushup', sets: scale(2), target: reps(8), restSec: rAcc, section: 'strength' },
    )
  }

  // A personalized limiter takes priority in a tight session, so its blocks
  // are inserted first and the supporting lean becomes the first thing cut.
  if (leanStrength && plan.accessoryEmphasis !== 'none') {
    blocks.push(leanStrength)
  }

  if (plan.accessoryEmphasis !== 'core') {
    blocks.push({ exerciseId: 'hollow-hold', sets: scale(2), target: hold(30), restSec: 45, section: 'core' })
    if (step.order >= 3 && !easy) {
      blocks.push({ exerciseId: 'l-sit', sets: 2, target: hold(12), restSec: 60, section: 'core' })
    }
  }

  // Cooldown: give back what the lean took.
  blocks.push(
    { exerciseId: 'wrist-stretch', sets: 1, target: hold(30), restSec: 10, section: 'cooldown' },
    { exerciseId: 'shoulder-extension-stretch', sets: 1, target: hold(30), restSec: 10, section: 'cooldown' },
  )
  const goal = STEP_BY_ID[state.profile.goalStepId ?? 'straddle']
  if (goal.order >= STEP_BY_ID.straddle.order && step.order >= STEP_BY_ID.tuck.order) {
    blocks.push({
      exerciseId: 'pancake-stretch',
      sets: 1,
      target: hold(step.order >= 5 ? 40 : 30),
      restSec: 10,
      section: 'cooldown',
      note:
        step.order < 5
          ? `${goal.name} goal — build the hip range now so the later lever is cheaper.`
          : undefined,
    })
  }

  const baseBudget = easy ? Math.min(22, state.settings.sessionMinutes) : state.settings.sessionMinutes
  const budget = minutesOverride !== undefined ? Math.min(baseBudget, Math.max(8, minutesOverride)) : baseBudget
  // Sides are expanded before trimming, so the budget accounts for the fact
  // that unilateral work costs twice as long.
  const fitted = fitToBudget(
    withSides(blocks),
    budget,
    plan.accessoryEmphasis === 'core',
    state.settings.stopLatencySec,
    state.settings.phoneWithinReach,
  )

  const shortened = minutesOverride !== undefined && budget < baseBudget
  return {
    id: `auto-${stepId}-${plan.dayType}-${plan.strategy}${shortened ? `-${budget}m` : ''}`,
    name: `${step.name} · ${DAY_LABEL[plan.dayType]}${shortened ? ' · Short' : ''}`,
    focus: shortened
      ? `Trimmed to about ${budget} minutes. The warm-up and your main ${
          EXERCISE_BY_ID[step.keyExerciseId]?.name.toLowerCase() ?? 'work'
        } are intact — accessories came off first, because a short session you actually do beats a full one you skip. ${plan.dayReason}`
      : plan.limiter
        ? `${plan.dayReason} Current limiter: ${plan.limiter.label}. ${plan.limiter.prescription}`
        : plan.dayReason,
    minutes: estimateMinutes(fitted, state.settings.stopLatencySec, state.settings.phoneWithinReach),
    kind: 'auto',
    blocks: fitted,
    strategy: plan.strategy,
  }
}

/** A short max-effort test on the current step's key hold. */
export function maxTestWorkout(stepId: StepId): Workout {
  const step = STEP_BY_ID[stepId]
  // Unilateral tests must be even, or one side gets an extra attempt and the
  // unlock could be earned off the strong side alone.
  const perSide = EXERCISE_BY_ID[step.keyExerciseId]?.perSide
  const attempts = perSide ? 4 : 3
  return {
    id: `test-${stepId}`,
    name: `Max Test · ${step.name}`,
    focus: `${perSide ? 'Two fresh max attempts per side' : 'Three fresh max attempts'} at the ${EXERCISE_BY_ID[step.keyExerciseId].name.toLowerCase()}. Hit ${step.unlockSec}s with athlete + filmed form confirmation to unlock the next step.`,
    minutes: 15,
    kind: 'test',
    blocks: [
      { exerciseId: 'wrist-circles', sets: 1, target: reps(10), restSec: 15, section: 'warmup' },
      { exerciseId: 'wrist-rocks', sets: 1, target: reps(8), restSec: 20, section: 'warmup' },
      {
        exerciseId: step.keyExerciseId,
        sets: attempts,
        target: hold(step.unlockSec),
        restSec: 180,
        section: 'main',
        note: 'Film the attempt. Hold only while the shape stays clean, then confirm your rating and form check.',
      },
    ],
  }
}

export const TEMPLATES: Workout[] = [
  {
    id: 'wrist-armor',
    name: 'Wrist Armor',
    focus: 'Ten minutes of wrist conditioning. Do it on rest days; your future self says thanks.',
    minutes: 10,
    kind: 'template',
    blocks: [
      { exerciseId: 'wrist-circles', sets: 2, target: reps(10), restSec: 15, section: 'main' },
      { exerciseId: 'wrist-rocks', sets: 3, target: reps(10), restSec: 30, section: 'main' },
      { exerciseId: 'palm-lifts', sets: 3, target: reps(10), restSec: 30, section: 'main' },
      { exerciseId: 'ppp-hold', sets: 2, target: hold(15), restSec: 60, section: 'main' },
      { exerciseId: 'wrist-stretch', sets: 2, target: hold(30), restSec: 20, section: 'cooldown' },
    ],
  },
  {
    id: 'push-strength',
    name: 'Push Strength',
    focus: 'Pressing volume for the days you want to build the engine, not test the skill.',
    minutes: 35,
    kind: 'template',
    blocks: [
      { exerciseId: 'wrist-circles', sets: 1, target: reps(10), restSec: 15, section: 'warmup' },
      { exerciseId: 'scap-pushup', sets: 2, target: reps(10), restSec: 30, section: 'warmup' },
      { exerciseId: 'pppu', sets: 4, target: reps(6), restSec: 150, section: 'main' },
      { exerciseId: 'pike-pushup', sets: 4, target: reps(8), restSec: 120, section: 'main' },
      { exerciseId: 'dip', sets: 3, target: reps(8), restSec: 120, section: 'strength' },
      { exerciseId: 'pushup', sets: 2, target: reps(15), restSec: 90, section: 'strength' },
      { exerciseId: 'shoulder-extension-stretch', sets: 1, target: hold(30), restSec: 10, section: 'cooldown' },
    ],
  },
  {
    id: 'balance-skill',
    name: 'Balance & Skill',
    focus: 'Low-fatigue hand-balance practice: frog stand, wall line work, easy leans.',
    minutes: 25,
    kind: 'template',
    blocks: [
      { exerciseId: 'wrist-circles', sets: 1, target: reps(10), restSec: 15, section: 'warmup' },
      { exerciseId: 'wrist-rocks', sets: 2, target: reps(8), restSec: 20, section: 'warmup' },
      { exerciseId: 'frog-stand', sets: 5, target: hold(20), restSec: 90, section: 'main' },
      { exerciseId: 'wall-handstand', sets: 3, target: hold(20), restSec: 120, section: 'main' },
      { exerciseId: 'planche-lean', sets: 3, target: hold(10), restSec: 90, section: 'strength' },
      { exerciseId: 'wrist-stretch', sets: 1, target: hold(30), restSec: 10, section: 'cooldown' },
    ],
  },
  {
    id: 'core-compression',
    name: 'Core & Compression',
    focus: 'Hollow, L-sit and pike compression — the tension that keeps a planche flat.',
    minutes: 25,
    kind: 'template',
    blocks: [
      { exerciseId: 'hollow-hold', sets: 3, target: hold(30), restSec: 60, section: 'main' },
      { exerciseId: 'hollow-rocks', sets: 3, target: reps(12), restSec: 60, section: 'main' },
      { exerciseId: 'l-sit', sets: 4, target: hold(12), restSec: 90, section: 'main' },
      { exerciseId: 'leg-lifts', sets: 3, target: reps(10), restSec: 60, section: 'strength' },
      { exerciseId: 'arch-hold', sets: 3, target: hold(20), restSec: 60, section: 'strength' },
      { exerciseId: 'pancake-stretch', sets: 2, target: hold(40), restSec: 30, section: 'cooldown' },
    ],
  },
  {
    id: 'deload',
    name: 'Deload Flow',
    focus: 'Half volume, easy targets. Take one of these weeks every 4–6 — that’s where adaptation lands.',
    minutes: 20,
    kind: 'template',
    blocks: [
      { exerciseId: 'wrist-circles', sets: 2, target: reps(10), restSec: 20, section: 'warmup' },
      { exerciseId: 'wrist-rocks', sets: 2, target: reps(8), restSec: 30, section: 'warmup' },
      { exerciseId: 'scap-pushup', sets: 2, target: reps(8), restSec: 45, section: 'main' },
      { exerciseId: 'planche-lean', sets: 3, target: hold(8), restSec: 90, section: 'main', note: 'Gentle lean, well shy of max.' },
      { exerciseId: 'hollow-hold', sets: 2, target: hold(20), restSec: 60, section: 'core' },
      { exerciseId: 'wrist-stretch', sets: 2, target: hold(30), restSec: 20, section: 'cooldown' },
      { exerciseId: 'shoulder-extension-stretch', sets: 1, target: hold(40), restSec: 10, section: 'cooldown' },
    ],
  },
  {
    id: 'quick-ten',
    name: 'Quick Ten',
    focus: 'No time? Ten focused minutes that still move the needle.',
    minutes: 10,
    kind: 'template',
    blocks: [
      { exerciseId: 'wrist-circles', sets: 1, target: reps(10), restSec: 10, section: 'warmup' },
      { exerciseId: 'planche-lean', sets: 3, target: hold(12), restSec: 75, section: 'main' },
      { exerciseId: 'pppu', sets: 2, target: reps(6), restSec: 75, section: 'main' },
      { exerciseId: 'hollow-hold', sets: 2, target: hold(25), restSec: 45, section: 'core' },
    ],
  },
]
