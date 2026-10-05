import type {
  AppState,
  Block,
  BlockTarget,
  BodyRegion,
  CheckIn,
  EquipmentId,
  StepId,
  Workout,
  WorkoutRequest,
} from '../types'
import { EXERCISE_BY_ID } from './exercises'
import { STEP_BY_ID, stepBefore } from './progressions'
import { defaultSurface, equipmentLabel } from './equipment'
import { buildPlan, STRATEGY_BY_ID, type CoachPlan, type WarmupLevel } from '../lib/coach'
import { median } from '../lib/signals'
import { learningSeries, qualifyingProgress } from '../lib/progression'
import { leadInSecondsFor, stopLatencySecondsFor } from '../lib/sessionTiming'

const hold = (sec: number): BlockTarget => ({ kind: 'hold', sec })
const reps = (n: number): BlockTarget => ({ kind: 'reps', reps: n })

const DAY = 86_400_000

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
  // Starting/stopping the timer and changing position costs real time even
  // with the phone nearby. Exported sessions showed the old work+rest-only
  // estimate was consistently optimistic, so budget a small transition per
  // set rather than pretending every movement begins instantly.
  const transitionSec = phoneWithinReach ? 6 : 8
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
      sec += work + setup + transitionSec
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
 *
 * Read from one comparable task: the surface the athlete trains on now, with a
 * unilateral hold's weaker side setting the value. With nothing comparable
 * logged, the placement answer for this exact hold is the next-best evidence,
 * then the timer PR as a ceiling, then the step's conventional start.
 */
export function adaptiveTarget(state: AppState, stepId: StepId): number {
  const step = STEP_BY_ID[stepId]
  const surface = defaultSurface(state.profile.equipment, state.profile.preferredSurface)
  const series = learningSeries(state, stepId, surface)
  const recentBests = series.points.map((p) => p.value).slice(-6)

  if (recentBests.length === 0) {
    // A standalone unverified PR must never raise a target or unlock a step,
    // but it is still useful as a safety ceiling. A beginner with a real 3s
    // tuck should not receive generic 5s working sets merely because the clip
    // failed.
    const timerBest = state.prs[step.keyExerciseId]?.value ?? 0
    if (timerBest > 0) return clamp(Math.round(timerBest * 0.6), 1, step.startSec)
    const answered = state.assessment?.answers[step.keyExerciseId]
    if (answered !== undefined) {
      // "Can't hold it yet" is not a reason to prescribe the conventional
      // start anyway. A short hold at an easier lean is the honest dose; the
      // block note says how to make it easier.
      return answered > 0 ? clamp(Math.round(answered * 0.6), 1, step.startSec) : Math.min(step.startSec, 5)
    }
    return step.startSec
  }

  const verifiedBest = qualifyingProgress(state, stepId).value
  const typical = median(recentBests)
  // Blend: mostly what you can repeat, with a nod to your peak. A verified best
  // on another surface is not this task's peak.
  const peak = series.transferred || series.surface === null ? 0 : verifiedBest
  const observedBest = Math.max(peak, ...recentBests)
  const anchor =
    typical === null
      ? observedBest
      : typical * 0.75 + Math.min(observedBest, typical * 1.5) * 0.25
  const t = anchor * 0.6
  const target = clamp(Math.round(t), 1, step.unlockSec)
  // Nothing on this surface yet: another surface's numbers are an uncertain
  // transfer, so they may only lower the conventional start, never raise it.
  return series.transferred ? Math.min(target, step.startSec) : target
}

/**
 * The most the athlete has shown they can hold on this step's key exercise,
 * on the comparable surface — or undefined when nothing has been measured.
 * Working targets may be scaled by strategy, but never past this.
 */
export function observedCapacity(state: AppState, stepId: StepId): number | undefined {
  const step = STEP_BY_ID[stepId]
  const surface = defaultSurface(state.profile.equipment, state.profile.preferredSurface)
  const series = learningSeries(state, stepId, surface)
  const recent = series.points.slice(-6).map((p) => p.value)
  if (recent.length) return Math.max(...recent)
  const timerBest = state.prs[step.keyExerciseId]?.value
  if (timerBest !== undefined && timerBest > 0) return timerBest
  const answered = state.assessment?.answers[step.keyExerciseId]
  return answered !== undefined && answered > 0 ? answered : undefined
}

/**
 * Easier versions the planner may swap in when an athlete's *reported*
 * capacity is below what the default block asks for. A regression is a
 * different exercise with its own records, never the same one at a lower
 * number dressed up as progress.
 */
function regressionFor(exerciseId: string, state: AppState): string | undefined {
  const pushups = state.assessment?.answers.pushups
  switch (exerciseId) {
    case 'pushup':
      return 'knee-pushup'
    case 'pppu':
      // Someone with a solid set of push-ups regresses to push-ups; someone
      // without one regresses further.
      return pushups !== undefined && pushups >= 5 ? 'pushup' : 'knee-pushup'
    case 'hollow-hold':
      return 'tuck-hollow-hold'
    default:
      return undefined
  }
}

/** Best recent value logged on one exercise (median of the last few sessions' bests). */
function recentBest(state: AppState, exerciseId: string, now: number): number | undefined {
  const bests = [...state.sessions]
    .filter((s) => s.startedAt <= now && now - s.startedAt <= 42 * DAY)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => s.sets.reduce((b, set) => (set.exerciseId === exerciseId && set.value > b ? set.value : b), 0))
    .filter((v) => v > 0)
    .slice(-3)
  return median(bests) ?? undefined
}

/**
 * What the athlete can currently do on an accessory, from their own log first
 * and their placement answers second. Undefined means unknown — and unknown
 * leaves the default dose alone rather than guessing either way.
 */
function accessoryCapacity(
  state: AppState,
  exerciseId: string,
  now: number,
): { value: number; source: 'log' | 'placement' } | undefined {
  const logged = recentBest(state, exerciseId, now)
  if (logged !== undefined) return { value: logged, source: 'log' }
  const a = state.assessment?.answers
  if (!a) return undefined
  const pushups = a.pushups
  const fromPlacement = (v: number | undefined) => (v === undefined ? undefined : { value: v, source: 'placement' as const })
  switch (exerciseId) {
    case 'pushup':
      return fromPlacement(pushups)
    case 'pppu':
      // A pseudo planche push-up is far harder than a push-up; a third of
      // the push-up answer is a deliberately cautious starting read.
      return fromPlacement(pushups === undefined ? undefined : Math.floor(pushups / 3))
    case 'pike-pushup':
      return fromPlacement(pushups === undefined ? undefined : Math.floor(pushups / 2))
    case 'hollow-hold':
      return fromPlacement(a.hollow)
    default:
      return undefined
  }
}

const PLACEMENT_BAND: Record<string, (v: number) => string> = {
  pushup: (v) => (v < 5 ? 'fewer than 5 push-ups' : `about ${v} push-ups`),
  pppu: () => 'push-up count',
  'pike-pushup': () => 'push-up count',
  'hollow-hold': (v) => (v < 15 ? 'a hollow hold under 15s' : `a hollow hold of about ${v}s`),
}

/**
 * Bring accessory doses down to what this athlete can actually do.
 *
 * Accessory targets were fixed: someone who answered "fewer than 5 push-ups"
 * and "under 15 seconds of hollow hold" was handed 2×10 push-ups and 2×30s
 * hollow holds on day one. This only ever lowers a dose or swaps in an easier
 * version, and every change says what it was based on.
 */
export function capacityAdjustBlocks(
  state: AppState,
  blocks: Block[],
  now = Date.now(),
): { blocks: Block[]; notes: string[] } {
  const notes: string[] = []
  const adjustable = (b: Block) => b.section === 'strength' || b.section === 'core'
  const basisFor = (exerciseId: string, capacity: { value: number; source: 'log' | 'placement' }) =>
    capacity.source === 'log'
      ? 'your recent sessions'
      : `your setup answer (${PLACEMENT_BAND[exerciseId]?.(capacity.value) ?? 'what you reported'})`

  // 1. Swap in an easier version where the placement says the default is out
  //    of reach. Only placement answers do this: logged history is real
  //    performance, and sizing the dose (step 3) is the right response to it.
  const swapped: Block[] = blocks.map((block) => {
    if (!adjustable(block)) return block
    const capacity = accessoryCapacity(state, block.exerciseId, now)
    if (!capacity || capacity.source !== 'placement') return block
    const regression = regressionFor(block.exerciseId, state)
    const tooHard =
      block.target.kind === 'reps' ? capacity.value < Math.min(5, block.target.reps) : capacity.value < Math.min(10, block.target.sec / 2)
    if (!tooHard || !regression || !EXERCISE_BY_ID[regression]) return block
    const reg = EXERCISE_BY_ID[regression]
    const basis = basisFor(block.exerciseId, capacity)
    notes.push(`${EXERCISE_BY_ID[block.exerciseId].name} swapped for ${reg.name.toLowerCase()}, from ${basis}.`)
    return {
      ...block,
      exerciseId: regression,
      target: reg.type === 'hold' ? hold(Math.min(10, block.target.kind === 'hold' ? block.target.sec : 10)) : reps(5),
      note: `${reg.name} instead of ${EXERCISE_BY_ID[block.exerciseId].name.toLowerCase()}, from ${basis}. Move up when these feel controlled.`,
    }
  })

  // 2. Two blocks that became the same exercise are one block: keep the first
  //    position, the larger set count and the smaller target.
  const merged: Block[] = []
  for (const block of swapped) {
    const twin = adjustable(block) ? merged.find((b) => adjustable(b) && b.exerciseId === block.exerciseId) : undefined
    if (!twin) {
      merged.push({ ...block })
      continue
    }
    twin.sets = Math.max(twin.sets, block.sets)
    if (twin.target.kind === 'reps' && block.target.kind === 'reps') twin.target = reps(Math.min(twin.target.reps, block.target.reps))
    if (twin.target.kind === 'hold' && block.target.kind === 'hold') twin.target = hold(Math.min(twin.target.sec, block.target.sec))
  }

  // 3. Size what remains to measured or reported capacity. Only ever lowers.
  const out = merged.map((block) => {
    if (!adjustable(block)) return block
    const capacity = accessoryCapacity(state, block.exerciseId, now)
    if (!capacity) return block
    const basis = basisFor(block.exerciseId, capacity)
    if (block.target.kind === 'reps') {
      const dose = Math.max(1, Math.floor(capacity.value * 0.7))
      if (dose >= block.target.reps) return block
      notes.push(`${EXERCISE_BY_ID[block.exerciseId].name} set to ${dose} reps, from ${basis}.`)
      return { ...block, target: reps(dose), note: block.note ?? `Sized from ${basis}.` }
    }
    const dose = Math.max(1, Math.round(capacity.value * 0.6))
    if (dose >= block.target.sec) return block
    notes.push(`${EXERCISE_BY_ID[block.exerciseId].name} set to ${dose}s, from ${basis}.`)
    return { ...block, target: hold(dose), note: block.note ?? `Sized from ${basis}.` }
  })
  return { blocks: out, notes }
}

/**
 * Swaps for movements that need kit the athlete has not got, in order of
 * preference. A substitute must itself be doable with what they own; nothing
 * here ever suggests an improvised support.
 */
const EQUIPMENT_SUBSTITUTES: Record<string, { id: string; repsFactor: number }[]> = {
  dip: [
    { id: 'pushup', repsFactor: 1.5 },
    { id: 'pppu', repsFactor: 0.75 },
  ],
  'tuck-planche-pushup': [{ id: 'pppu', repsFactor: 2 }],
  'band-straddle-planche': [],
  'supported-tuck-lean': [],
}

/** Whether every piece of kit this exercise needs is in the profile. */
export function hasEquipmentFor(exerciseId: string, equipment: EquipmentId[]): boolean {
  return (EXERCISE_BY_ID[exerciseId]?.requires ?? []).every((id) => equipment.includes(id))
}

/**
 * Resolve every block against the athlete's equipment.
 *
 * Templates used to prescribe dips to an athlete who had told onboarding they
 * train on the floor only. A catalogue can list movements someone cannot do;
 * a session they are about to start must not quietly assume kit they lack.
 */
export function resolveEquipment(
  blocks: Block[],
  equipment: EquipmentId[],
): { blocks: Block[]; notes: string[] } {
  const notes: string[] = []
  const out: Block[] = []
  for (const block of blocks) {
    if (hasEquipmentFor(block.exerciseId, equipment)) {
      out.push(block)
      continue
    }
    const exercise = EXERCISE_BY_ID[block.exerciseId]
    const missing = (exercise?.requires ?? []).filter((id) => !equipment.includes(id)).map(equipmentLabel)
    const substitute = (EQUIPMENT_SUBSTITUTES[block.exerciseId] ?? []).find(
      ({ id }) =>
        hasEquipmentFor(id, equipment) && !blocks.some((b) => b.exerciseId === id) && !out.some((b) => b.exerciseId === id),
    )
    if (substitute) {
      const sub = EXERCISE_BY_ID[substitute.id]
      out.push({
        ...block,
        exerciseId: substitute.id,
        target:
          sub.type === 'reps' && block.target.kind === 'reps'
            ? reps(Math.max(1, Math.round(block.target.reps * substitute.repsFactor)))
            : sub.type === 'hold'
              ? hold(15)
              : reps(6),
        note: `${missing.join(' and ')} not in your equipment — ${sub.name.toLowerCase()} instead.`,
      })
      notes.push(
        `${exercise?.name ?? block.exerciseId} needs ${missing.join(' and ')}, so ${sub.name.toLowerCase()} is used instead.`,
      )
    } else {
      notes.push(`${exercise?.name ?? block.exerciseId} was left out — it needs ${missing.join(' and ')}.`)
    }
  }
  return { blocks: out, notes }
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
    if (coreIdx.length > (preserveCorePair ? 2 : 1)) {
      out.splice(coreIdx[coreIdx.length - 1], 1)
      continue
    }
    // 4. The final supporting block is still less important than the key
    //    planche dose. Drop it before cutting the work the strategy selected.
    const lastStrength = out.findIndex((b) => b.section === 'strength')
    if (lastStrength >= 0) {
      out.splice(lastStrength, 1)
      continue
    }
    // 5. Reduce main sets, floor 3 (again in pairs for unilateral work).
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
 * athletes get general prep first. Wrist preparation is in every version —
 * as preparation, not as protection; no warm-up has been shown to prevent
 * injury in this kind of training.
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
  // The pain session promises "no loaded planche, pressing or wrist work";
  // Cat–Cow is a straight-arm support on all fours, so an elbow session that
  // kept it contradicted its own heading.
  elbow: ['cat-cow'],
  shoulder: ['jumping-jacks', 'cat-cow'],
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
    purpose: 'Gentle movement on a day something hurts — not treatment, and not a test of whether it still hurts.',
  }
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** Movements that put load through the upper body, for template scaling. */
function upperLoaded(exerciseId: string): boolean {
  const category = EXERCISE_BY_ID[exerciseId]?.category
  return category === 'planche' || category === 'push' || category === 'scapula' || category === 'wrist'
}

/**
 * Apply today's final decision to a template the athlete chose.
 *
 * This used to read the raw check-in answer and short-circuit only on
 * "pain" — so an elbow niggle, which the planner itself turns into "no
 * loading today", reached Push Strength as pseudo planche push-ups, pike
 * push-ups and dips at 80%, and a persistent complaint with a reassuring
 * answer today reached it unscaled. Choosing a template is choosing *what* to
 * train; it is never a second authority on *whether* to load.
 */
export function restrictTemplate(workout: Workout, plan: CoachPlan): Workout {
  if (plan.loadPermission === 'none') return painSafeRecoveryWorkout(plan.signals.lastCheckIn?.regions ?? [])
  const reduced = plan.loadPermission === 'reduced'
  const volume = Math.min(1, plan.volumeFactor)
  if (!reduced && volume >= 0.999) return workout

  const blocks = workout.blocks.map((block) => {
    if (block.section === 'warmup' || block.section === 'cooldown') return block
    const loaded = upperLoaded(block.exerciseId)
    const targetFactor = reduced && loaded ? 0.8 : 1
    // Only ever lowers: a 2s hold must not become a 3s one on a reduced day.
    const target =
      block.target.kind === 'hold'
        ? hold(Math.min(block.target.sec, Math.max(1, Math.round(block.target.sec * targetFactor))))
        : reps(Math.min(block.target.reps, Math.max(1, Math.round(block.target.reps * targetFactor))))
    return {
      ...block,
      sets: Math.max(1, Math.round(block.sets * volume)),
      target,
      restSec: reduced && loaded ? Math.max(block.restSec, 90) : block.restSec,
    }
  })
  const why = reduced
    ? plan.signals.persistentComplaint
      ? `a ${plan.signals.persistentComplaint.region.replace('-', ' ')} complaint that keeps coming back`
      : plan.signals.lastCheckIn?.joints === 'niggle'
        ? 'today’s joint niggle'
        : plan.openConcern
          ? 'a joint report that has not been updated'
          : 'today’s readiness'
    : 'low energy'
  return {
    ...workout,
    id: `${workout.id}-readiness-adjusted`,
    name: `${workout.name} · Adjusted`,
    focus: `${workout.focus} Scaled for ${why}; stop any set that worsens symptoms.`,
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
  const adjustments: string[] = []

  // An extended warm-up is a coach safety rail and cannot be disabled by the
  // convenience preference.
  if (state.settings.warmup || plan.warmup === 'extended') blocks.push(...warmupFor(stepId, plan.warmup))

  // Fresh and within reach → attempt the unlock while at your best. The plan
  // only sets this when today's challenge permission allows it.
  if (plan.queueUnlockAttempt && plan.challengeAllowed) {
    blocks.push({
      exerciseId: step.keyExerciseId,
      sets: 1,
      target: hold(step.unlockSec),
      restSec: 180,
      section: 'main',
      note: `Unlock attempt — you're within reach. Hold ${step.unlockSec}s clean, film it, and pass both form confirmations. Stop the moment the shape goes; a stopped attempt is still useful.`,
    })
  }

  // Main isometrics, shaped by the strategy the coach measured.
  //
  // The floor is one second, not three. A three-second floor silently raised a
  // capacity-capped one-second target back above what the athlete had shown,
  // and contradicted Full Planche's own two-second start. And no strategy may
  // push a working target past the best this athlete has actually held.
  const baseTarget = adaptiveTarget(state, stepId)
  const capacity = observedCapacity(state, stepId)
  let target = clamp(Math.round(baseTarget * plan.targetFactor), 1, step.unlockSec)
  if (capacity !== undefined) target = Math.min(target, Math.max(1, Math.floor(capacity)))
  const surface = defaultSurface(state.profile.equipment, state.profile.preferredSurface)
  const transferred = plan.signals.keySeriesTransferred
  const strategyNote =
    plan.strategy === 'technique'
      ? 'Easy targets today — careful positions, no grinding.'
      : plan.strategy === 'intensity'
        ? 'Harder clean holds. Rest fully and stop the instant elbow lock or body line goes.'
        : plan.strategy === 'density'
          ? 'Short rests on purpose, but never chase the timer past the first loss of shape.'
          : 'Stop each set about 2s before failure or at the first loss of shape. Quality over seconds.'
  const shortNote =
    target < 3
      ? ` Your recent holds are short, so these are too — that is a real dose, not a failure. If getting into the position or balancing is the struggle rather than strength, practising ${
          stepBefore(stepId) ? EXERCISE_BY_ID[stepBefore(stepId)!.keyExerciseId].name.toLowerCase() : 'an easier lean'
        } or using a smaller lean is worth reviewing with your replay.`
      : ''
  const placementNote =
    plan.signals.totalSessions === 0 && state.assessment?.answers[step.keyExerciseId] === 0
      ? ' You said you cannot hold this yet: use a smaller lean — shoulders only just past the wrists — so the target is holdable, and build the lean as it gets controlled.'
      : ''
  const transferNote = transferred
    ? ` No ${surface} holds are logged yet, so this target comes conservatively from your other surface — expect the first sets to tell you more.`
    : ''
  blocks.push({
    exerciseId: step.keyExerciseId,
    sets: clamp(scale((plan.queueUnlockAttempt && plan.challengeAllowed ? 3 : 4) + plan.setsDelta), 2, 8),
    target: hold(target),
    restSec: rMain,
    section: 'main',
    note: `${strategyNote}${shortNote}${placementNote}${transferNote}`,
  })

  // Balanced and volume sessions keep an owned position in the session;
  // intensity protects freshness, while density protects the short-rest
  // identity. Tuck deliberately uses loaded leans below instead of Frog Stand
  // as its back-off — the exported history showed that generic previous-step
  // rule was making nearly every Tuck session look the same without adding
  // useful straight-arm capacity.
  const prev = stepBefore(stepId)
  if (
    prev &&
    prev.order >= 0 &&
    stepId !== 'tuck' &&
    (plan.strategy === 'balanced' || plan.strategy === 'volume') &&
    plan.dayType !== 'technique' &&
    plan.dayType !== 'deload'
  ) {
    blocks.push({
      exerciseId: prev.keyExerciseId,
      sets: plan.strategy === 'volume' ? 3 : 2,
      target: hold(clamp(Math.round(prev.unlockSec * 0.6), 5, prev.unlockSec)),
      restSec: rAcc,
      section: 'strength',
      note:
        plan.strategy === 'volume'
          ? 'Capacity work on a position you already own — clean accumulation, not a second max effort.'
          : 'A small back-off dose on the position you already own.',
    })
  }

  const easy = plan.strategy === 'technique' || plan.dayType === 'technique' || plan.dayType === 'deload'

  // Leans remain strength work when an athlete first earns Tuck, then taper
  // to maintenance at Advanced Tuck. Longer-lever steps keep only the warm-up
  // primer above so their best energy still goes to the specific progression.
  const leanStrength: Block | null =
    !easy && (stepId === 'tuck' || stepId === 'advtuck')
      ? {
          exerciseId: 'planche-lean',
          sets:
            stepId === 'tuck'
              ? plan.strategy === 'volume'
                ? clamp(scale(4), 3, 5)
                : plan.strategy === 'density'
                  ? 0
                  : plan.strategy === 'intensity'
                    ? 2
                    : clamp(scale(3), 3, 4)
              : plan.strategy === 'density'
                ? 0
                : 2,
          target: hold(stepId === 'tuck' ? 12 : 10),
          restSec: rAcc,
          section: 'strength',
          note:
            stepId === 'tuck'
              ? 'Straight-arm strength work — lean farther with locked elbows instead of chasing a longer stopwatch. Keep the same hand and foot position every set so the sets compare.'
              : 'Maintenance volume — keep the lean sharp, but save your best strength for Advanced Tuck.',
        }
      : null

  // With no measured limiter, this is the first accessory and survives before
  // generic pressing work when a short time budget needs trimming.
  if (leanStrength && leanStrength.sets > 0 && plan.accessoryEmphasis === 'none') {
    blocks.push(leanStrength)
  }

  // Accessories: the coach decides what is actually limiting you.
  if (plan.accessoryEmphasis === 'scapula') {
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
      { exerciseId: 'frog-stand', sets: scale(3), target: hold(20), restSec: rAcc, section: 'strength', note: 'Balance practice gets the extra time today.' },
      { exerciseId: 'pppu', sets: scale(2), target: reps(6), restSec: rAcc, section: 'strength' },
    )
  } else if (plan.accessoryEmphasis === 'pressing') {
    blocks.push(
      { exerciseId: 'pppu', sets: scale(4), target: reps(6), restSec: rAcc, section: 'strength', note: 'Extra bent-arm pressing — a supporting option for a stalled hold, not a guaranteed fix.' },
      { exerciseId: 'pike-pushup', sets: scale(3), target: reps(8), restSec: rAcc, section: 'strength' },
    )
  } else if (easy) {
    blocks.push({
      exerciseId: 'frog-stand',
      sets: 2,
      target: hold(15),
      restSec: rAcc,
      section: 'strength',
      note: 'Balance practice — a lower-load skill drill, though not a free one for wrists.',
    })
  } else if (plan.strategy === 'volume') {
    blocks.push({
      exerciseId: 'scap-pushup',
      sets: scale(3),
      target: reps(10),
      restSec: rAcc,
      section: 'strength',
      note: 'Capacity support — repeat crisp protraction without turning the session into another max-strength day.',
    })
  } else if (plan.strategy === 'intensity') {
    blocks.push({
      exerciseId: 'pppu',
      sets: 2,
      target: reps(step.order <= 2 ? 5 : 6),
      restSec: rMain,
      section: 'strength',
      note: 'One specific strength accessory, then stop — freshness is part of the high-intensity dose.',
    })
  } else if (plan.strategy === 'density') {
    blocks.push(
      {
        exerciseId: 'scap-pushup',
        sets: 3,
        target: reps(8),
        restSec: Math.min(45, rAcc),
        section: 'strength',
        note: 'Fast, clean support work. The session stays dense by limiting exercise changes.',
      },
      {
        exerciseId: 'hollow-rocks',
        sets: 3,
        target: reps(10),
        restSec: Math.min(40, rAcc),
        section: 'core',
      },
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
      { exerciseId: 'tuck-planche-pushup', sets: scale(3), target: reps(4), restSec: rMain, section: 'strength' },
      { exerciseId: 'pike-pushup', sets: scale(2), target: reps(8), restSec: rAcc, section: 'strength' },
    )
  }

  // A personalized limiter takes priority in a tight session, so its blocks
  // are inserted first and the supporting lean becomes the first thing cut.
  if (leanStrength && leanStrength.sets > 0 && plan.accessoryEmphasis !== 'none') {
    blocks.push(leanStrength)
  }

  if (plan.accessoryEmphasis !== 'core') {
    if (plan.strategy !== 'density') {
      blocks.push({
        exerciseId: 'hollow-hold',
        sets: plan.strategy === 'volume' ? scale(3) : scale(2),
        target: hold(easy ? 20 : 30),
        restSec: 45,
        section: 'core',
      })
    }
    if (step.order >= 3 && !easy && plan.strategy === 'balanced') {
      blocks.push({ exerciseId: 'l-sit', sets: 2, target: hold(12), restSec: 60, section: 'core' })
    }
  }

  // Cooldown.
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
          ? `${goal.name} goal — range now makes a wider straddle available later. Practice time, not a measure of straddle strength.`
          : undefined,
    })
  }

  // Kit first (so a substitute is sized like everything else), then capacity.
  const kit = resolveEquipment(blocks, state.profile.equipment)
  const sized = capacityAdjustBlocks(state, kit.blocks)
  adjustments.push(...kit.notes, ...sized.notes)

  const baseBudget = easy ? Math.min(22, state.settings.sessionMinutes) : state.settings.sessionMinutes
  const budget = minutesOverride !== undefined ? Math.min(baseBudget, Math.max(8, minutesOverride)) : baseBudget
  // Sides are expanded before trimming, so the budget accounts for the fact
  // that unilateral work costs twice as long.
  const fitted = fitToBudget(
    withSides(sized.blocks),
    budget,
    plan.accessoryEmphasis === 'core',
    state.settings.stopLatencySec,
    state.settings.phoneWithinReach,
  )

  // The *fitted* length, not the requested one. `fitToBudget` protects the
  // warm-up, the key main work and a floor of sets, so a session that is
  // already near-minimal (a deload, say) cannot always reach a small budget —
  // and promising "about 15 minutes" for a 20-minute session is the kind of
  // number this app is not allowed to invent.
  const fittedMinutes = estimateMinutes(fitted, state.settings.stopLatencySec, state.settings.phoneWithinReach)
  const shortened = minutesOverride !== undefined && fittedMinutes < baseBudget
  const strategy = STRATEGY_BY_ID[plan.strategy]
  const strategyContext = `${strategy.blurb} ${plan.dayReason}`
  return {
    id: `auto-${stepId}-${plan.dayType}-${plan.strategy}${shortened ? `-${budget}m` : ''}`,
    name: `${step.name} · ${strategy.name}${shortened ? ' · Short' : ''}`,
    focus: shortened
      ? `Trimmed to about ${fittedMinutes} minutes${
          fittedMinutes > budget ? ` — as short as this day gets without cutting the work that matters` : ''
        }. The warm-up and your main ${
          EXERCISE_BY_ID[step.keyExerciseId]?.name.toLowerCase() ?? 'work'
        } are intact; accessories came off first, because a short session you actually do beats a full one you skip. ${strategyContext}`
      : plan.limiter
        ? `${strategyContext} Current limiter: ${plan.limiter.label}. ${plan.limiter.prescription}`
        : strategyContext,
    minutes: fittedMinutes,
    kind: 'auto',
    blocks: fitted,
    strategy: plan.strategy,
    purpose: `Practise ${EXERCISE_BY_ID[step.keyExerciseId]?.name.toLowerCase() ?? step.name} at a working dose, with supporting work around it.`,
    ...(adjustments.length ? { adjustments } : {}),
  }
}

/** A short max-effort test on a step's key hold. */
export function maxTestWorkout(stepId: StepId): Workout {
  const step = STEP_BY_ID[stepId]
  // Unilateral tests must be even, or one side gets an extra attempt and the
  // unlock could be earned off the strong side alone.
  const perSide = EXERCISE_BY_ID[step.keyExerciseId]?.perSide
  const attempts = perSide ? 4 : 3
  const blocks: Block[] = [
    { exerciseId: 'wrist-circles', sets: 1, target: reps(10), restSec: 15, section: 'warmup' },
    { exerciseId: 'wrist-rocks', sets: 1, target: reps(8), restSec: 20, section: 'warmup' },
    {
      exerciseId: step.keyExerciseId,
      sets: attempts,
      target: hold(step.unlockSec),
      restSec: 180,
      section: 'main',
      note: 'Film the attempt. Hold only while the shape stays clean, then confirm your rating and form check. Stopping early for pain or a lost position is the right call, not a failed test.',
    },
  ]
  return {
    id: `test-${stepId}`,
    name: `Max Test · ${step.name}`,
    focus: `${perSide ? 'Two fresh max attempts per side' : 'Three fresh max attempts'} at the ${EXERCISE_BY_ID[step.keyExerciseId].name.toLowerCase()}. Hit ${step.unlockSec}s with athlete + filmed form confirmation to unlock the next step.`,
    minutes: estimateMinutes(blocks),
    kind: 'test',
    blocks,
    purpose: 'Answer one question — what you can hold today, cleanly — at a fresh, planned opportunity.',
  }
}

function template(w: Omit<Workout, 'minutes' | 'kind'> & { kind?: Workout['kind'] }): Workout {
  // Minutes come from the blocks, not a hand-typed label: "Quick Ten" must not
  // claim ten minutes it does not fit in.
  return { ...w, kind: 'template', minutes: estimateMinutes(w.blocks) }
}

export const TEMPLATES: Workout[] = [
  template({
    // Id kept so history and links still resolve; the old name ("Armor") and
    // "your future self says thanks" promised protection no routine provides.
    id: 'wrist-armor',
    name: 'Wrist Prep',
    focus:
      'Ten-odd minutes of wrist preparation: controlled range, then light loading. Preparation, not treatment — it does not make a sore wrist safe to load.',
    purpose: 'Prepare wrists for straight-arm loading.',
    blocks: [
      { exerciseId: 'wrist-circles', sets: 2, target: reps(10), restSec: 15, section: 'main' },
      { exerciseId: 'wrist-rocks', sets: 3, target: reps(10), restSec: 30, section: 'main' },
      { exerciseId: 'palm-lifts', sets: 3, target: reps(10), restSec: 30, section: 'main' },
      { exerciseId: 'ppp-hold', sets: 2, target: hold(15), restSec: 60, section: 'main' },
      { exerciseId: 'wrist-stretch', sets: 2, target: hold(30), restSec: 20, section: 'cooldown' },
    ],
  }),
  template({
    id: 'push-strength',
    name: 'Push Strength',
    focus: 'Bent-arm pressing volume for the days you want to build supporting strength, not test the skill.',
    purpose: 'Bent-arm pressing support, kept separate from straight-arm skill time.',
    blocks: [
      { exerciseId: 'wrist-circles', sets: 1, target: reps(10), restSec: 15, section: 'warmup' },
      { exerciseId: 'scap-pushup', sets: 2, target: reps(10), restSec: 30, section: 'warmup' },
      { exerciseId: 'pppu', sets: 4, target: reps(6), restSec: 150, section: 'main' },
      { exerciseId: 'pike-pushup', sets: 4, target: reps(8), restSec: 120, section: 'main' },
      { exerciseId: 'dip', sets: 3, target: reps(8), restSec: 120, section: 'strength' },
      { exerciseId: 'pushup', sets: 2, target: reps(15), restSec: 90, section: 'strength' },
      { exerciseId: 'shoulder-extension-stretch', sets: 1, target: hold(30), restSec: 10, section: 'cooldown' },
    ],
  }),
  template({
    id: 'setup-practice',
    name: 'Setup Practice',
    focus:
      'Learn one repeatable lean setup: the same hand position, foot position and lean every set, entered and left under control. Success is a setup you can reproduce, not a longer hold.',
    purpose: 'Learn a repeatable setup, so later sets are comparable.',
    blocks: [
      { exerciseId: 'wrist-circles', sets: 1, target: reps(10), restSec: 15, section: 'warmup' },
      { exerciseId: 'wrist-rocks', sets: 1, target: reps(8), restSec: 20, section: 'warmup' },
      {
        exerciseId: 'scap-pushup',
        sets: 2,
        target: reps(8),
        restSec: 45,
        section: 'main',
        note: 'Teaching reps — on your knees is fine. Elbows and trunk stay still; only the shoulder blades move.',
      },
      {
        exerciseId: 'planche-lean',
        sets: 4,
        target: hold(6),
        restSec: 75,
        section: 'main',
        note: 'Mark your hand and foot positions. Lean only as far as you can return from with straight arms, and film one set side-on.',
      },
      { exerciseId: 'wrist-stretch', sets: 1, target: hold(30), restSec: 10, section: 'cooldown' },
    ],
  }),
  template({
    id: 'balance-skill',
    name: 'Balance & Skill',
    focus: 'Lower-fatigue hand-balance practice: frog stand, wall line work, easy leans.',
    purpose: 'Balance and position practice.',
    blocks: [
      { exerciseId: 'wrist-circles', sets: 1, target: reps(10), restSec: 15, section: 'warmup' },
      { exerciseId: 'wrist-rocks', sets: 2, target: reps(8), restSec: 20, section: 'warmup' },
      { exerciseId: 'frog-stand', sets: 5, target: hold(20), restSec: 90, section: 'main' },
      { exerciseId: 'wall-handstand', sets: 3, target: hold(20), restSec: 120, section: 'main' },
      { exerciseId: 'planche-lean', sets: 3, target: hold(10), restSec: 90, section: 'strength' },
      { exerciseId: 'wrist-stretch', sets: 1, target: hold(30), restSec: 10, section: 'cooldown' },
    ],
  }),
  template({
    id: 'core-compression',
    name: 'Core & Compression',
    focus: 'Hollow, L-sit and pike compression — trunk and compression support for holding a flat line.',
    purpose: 'Trunk and compression support.',
    blocks: [
      { exerciseId: 'hollow-hold', sets: 3, target: hold(30), restSec: 60, section: 'main' },
      { exerciseId: 'hollow-rocks', sets: 3, target: reps(12), restSec: 60, section: 'main' },
      { exerciseId: 'l-sit', sets: 4, target: hold(12), restSec: 90, section: 'main' },
      { exerciseId: 'leg-lifts', sets: 3, target: reps(10), restSec: 60, section: 'strength' },
      { exerciseId: 'arch-hold', sets: 3, target: hold(20), restSec: 60, section: 'strength' },
      { exerciseId: 'pancake-stretch', sets: 2, target: hold(40), restSec: 30, section: 'cooldown' },
    ],
  }),
  template({
    id: 'deload',
    name: 'Deload Flow',
    focus:
      'Lower volume and easy targets for a lighter week. Periodic easy weeks are common practice; trials have not shown they add strength, so treat this as a choice rather than a requirement.',
    purpose: 'A deliberately lighter session.',
    blocks: [
      { exerciseId: 'wrist-circles', sets: 2, target: reps(10), restSec: 20, section: 'warmup' },
      { exerciseId: 'wrist-rocks', sets: 2, target: reps(8), restSec: 30, section: 'warmup' },
      { exerciseId: 'scap-pushup', sets: 2, target: reps(8), restSec: 45, section: 'main' },
      { exerciseId: 'planche-lean', sets: 3, target: hold(8), restSec: 90, section: 'main', note: 'Gentle lean, well shy of max.' },
      { exerciseId: 'hollow-hold', sets: 2, target: hold(20), restSec: 60, section: 'core' },
      { exerciseId: 'wrist-stretch', sets: 2, target: hold(30), restSec: 20, section: 'cooldown' },
      { exerciseId: 'shoulder-extension-stretch', sets: 1, target: hold(40), restSec: 10, section: 'cooldown' },
    ],
  }),
  template({
    id: 'quick-ten',
    name: 'Quick Ten',
    focus: 'A short session: brief preparation and a small amount of familiar main work. Shortened by removing work, never by cutting rest short.',
    purpose: 'A genuinely short session.',
    blocks: [
      { exerciseId: 'wrist-circles', sets: 1, target: reps(10), restSec: 10, section: 'warmup' },
      { exerciseId: 'planche-lean', sets: 3, target: hold(10), restSec: 60, section: 'main' },
      { exerciseId: 'pppu', sets: 2, target: reps(5), restSec: 60, section: 'main' },
    ],
  }),
]

export const TEMPLATE_BY_ID: Record<string, Workout> = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]))

/**
 * Why a maximal test is not on today, in the athlete's words — or null when it is.
 */
export function challengeBlockedReason(plan: CoachPlan): string | null {
  if (plan.challengeAllowed) return null
  if (plan.loadPermission === 'none') return 'what you reported means no loaded work today'
  if (plan.signals.persistentComplaint) return 'a joint complaint keeps coming back'
  if (plan.openConcern && plan.loadPermission === 'reduced') {
    return plan.signals.lastCheckIn?.source === 'fresh' ? 'you flagged a joint today' : 'a joint report has not been updated'
  }
  if (plan.loadPermission === 'reduced') return 'today’s readiness calls for reduced loading'
  return 'you reported low energy'
}

/**
 * The one way a workout is built for an athlete to start.
 *
 * Every entry point — today's session, a short version, a template, a max test,
 * and the rebuild after a readiness answer — comes through here, so the final
 * decision is made once, with the latest answers, the current date, the
 * athlete's equipment and their measured capacity:
 *
 * - no-load days become the pain-safe session whatever was requested;
 * - a max test needs today's challenge permission, otherwise it becomes an
 *   ordinary session and says why;
 * - a template is scaled by the plan's decision, never by the raw answer;
 * - a requested short version survives the readiness re-plan.
 *
 * Nothing may widen what this allows; later steps can only choose within it.
 */
export function finalizeWorkout(
  state: AppState,
  request: WorkoutRequest,
  freshCheckIn?: CheckIn,
  now = Date.now(),
): Workout {
  return finalizeWorkoutWithPlan(state, request, freshCheckIn, now).workout
}

/** `finalizeWorkout`, plus the plan it was decided from (for the check-in question). */
export function finalizeWorkoutWithPlan(
  state: AppState,
  request: WorkoutRequest,
  freshCheckIn?: CheckIn,
  now = Date.now(),
): { workout: Workout; plan: CoachPlan } {
  return finalizeFromPlan(state, request, buildPlan(state, now, freshCheckIn), now)
}

/**
 * The same decision from a plan already built for this state and moment —
 * for screens that preview several requests at once (one plan, many cards).
 * The plan must come from `buildPlan(state, now)`; nothing else is valid.
 */
export function finalizeFromPlan(
  state: AppState,
  request: WorkoutRequest,
  plan: CoachPlan,
  now = Date.now(),
): { workout: Workout; plan: CoachPlan } {
  const adjustments: string[] = []
  let workout: Workout

  if (plan.loadPermission === 'none') {
    workout = painSafeRecoveryWorkout(plan.signals.lastCheckIn?.regions ?? [])
    if (request.source !== 'auto') {
      adjustments.push(
        `You asked for ${
          request.source === 'test' ? 'a max test' : (TEMPLATE_BY_ID[request.templateId ?? '']?.name ?? 'a session')
        }, but no loaded work is appropriate today — this is the pain-safe session instead.`,
      )
    }
  } else if (request.source === 'test') {
    const blocked = challengeBlockedReason(plan)
    if (blocked) {
      workout = todaysSession(state, plan, request.minutes)
      adjustments.push(`No max test today because ${blocked} — this is an ordinary session instead, with no maximal attempt.`)
    } else {
      workout = maxTestWorkout(request.stepId ?? state.stepId)
    }
  } else if (request.source === 'template') {
    const chosen = TEMPLATE_BY_ID[request.templateId ?? '']
    if (!chosen) {
      workout = todaysSession(state, plan, request.minutes)
    } else {
      const restricted = restrictTemplate(chosen, plan)
      if (restricted.id === 'pain-safe-recovery' || restricted.id.startsWith('pain-safe-recovery-')) {
        workout = restricted
      } else {
        const kit = resolveEquipment(restricted.blocks, state.profile.equipment)
        const sized = capacityAdjustBlocks(state, kit.blocks, now)
        const blocks = withSides(sized.blocks.map((b) => ({ ...b })))
        adjustments.push(...kit.notes, ...sized.notes)
        workout = {
          ...restricted,
          blocks,
          minutes: estimateMinutes(blocks, state.settings.stopLatencySec, state.settings.phoneWithinReach),
        }
      }
    }
  } else {
    workout = todaysSession(state, plan, request.minutes)
  }

  const all = [...(workout.adjustments ?? []), ...adjustments]
  return { workout: { ...workout, request, ...(all.length ? { adjustments: all } : {}) }, plan }
}

/**
 * The request a workout came from. Drafts saved before requests existed carry
 * none, so it is reconstructed from the workout — never a time budget, which
 * an old fitted estimate cannot honestly supply.
 */
export function requestFor(workout: Workout): WorkoutRequest {
  if (workout.request) return workout.request
  if (workout.kind === 'test') {
    const stepId = workout.id.replace(/^test-/, '') as StepId
    return { source: 'test', ...(STEP_BY_ID[stepId] ? { stepId } : {}) }
  }
  if (workout.kind === 'template') {
    const id = workout.id.replace(/-readiness-adjusted$/, '')
    return TEMPLATE_BY_ID[id] ? { source: 'template', templateId: id } : { source: 'auto' }
  }
  return { source: 'auto' }
}
