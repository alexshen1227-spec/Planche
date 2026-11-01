import type {
  AppState,
  Block,
  BlockRole,
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
import { PRESS_LADDER, pressingChoiceFor } from './pressing'
import { bridgeStatus, capacityOn } from '../lib/bridge'
import { buildPlan, STRATEGY_BY_ID, type CoachPlan, type WarmupLevel } from '../lib/coach'
import { median } from '../lib/signals'
import {
  capacityReading,
  completedBaseTarget,
  endedForNonCapacityReason,
  isAssisted,
  learningSeries,
  qualifyingProgress,
} from '../lib/progression'
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
  // The key hold, not merely the first main block: next-shape attempts and an
  // unlock attempt come first in the session but are not today's target.
  return (
    workout.blocks.find((block) => block.role === 'skill') ??
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
export function adaptiveTarget(state: AppState, stepId: StepId, now = Date.now()): number {
  const step = STEP_BY_ID[stepId]
  const surface = defaultSurface(state.profile.equipment, state.profile.preferredSurface)
  const series = learningSeries(state, stepId, surface, now)
  // Sessions stopped at their targets are right-censored: they say "at least
  // this much". They may not pull the estimate below what the athlete has
  // actually been measured at — the last sessions that went past or fell
  // short of their targets (a max test, a set taken to the limit).
  const measured = median(series.points.filter((p) => p.cappedAt === undefined).slice(-3).map((p) => p.value))
  const recentBests = series.points
    .slice(-6)
    .map((p) => (p.cappedAt !== undefined && measured !== null ? Math.max(p.value, measured) : p.value))

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
  // A prescription completed as asked is evidence it was within capacity: the
  // next base does not fall below it (strategy and rail factors still apply).
  // Without this, an athlete who stopped every set at its target — as the
  // hold screen invites — saw each target come out at a fraction of the last.
  const floor = series.transferred ? null : completedBaseTarget(state, stepId, series.surface, now)
  const target = clamp(Math.max(Math.round(t), floor ?? 0), 1, step.unlockSec)
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
  return capacityOn(state, stepId)
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

/**
 * Most an accessory progresses to before the next harder variation is the
 * better use of the time. Reps for rep work, seconds for holds. Coaching
 * convention: past these, add difficulty (a deeper lean, the next press on the
 * ladder) rather than more of the same.
 */
const ACCESSORY_CEILING: Record<string, number> = {
  'knee-pushup': 20,
  pushup: 20,
  pppu: 12,
  'pike-pushup': 12,
  dip: 12,
  'tuck-planche-pushup': 8,
  'adv-tuck-planche-pushup': 6,
  'straddle-planche-pushup': 5,
  'full-planche-pushup': 3,
  'scap-pushup': 15,
  // A transition drill: past a handful of controlled reps, open further instead.
  'tuck-open-close': 6,
  'planche-lean': 20,
  'one-leg-lean': 20,
  'frog-stand': 30,
  'band-straddle-planche': 15,
  'hollow-hold': 45,
  'tuck-hollow-hold': 40,
  'arch-hold': 40,
  'l-sit': 20,
  'hollow-rocks': 20,
  'leg-lifts': 15,
}

export interface AccessoryProgression {
  target: number
  /** 'repeat' covers both a partial session and a capped one. */
  change: 'up' | 'repeat' | 'down'
  /** The target the last session prescribed. */
  lastTarget: number
}

/**
 * A light day's share of an accessory dose. Convention, like the easy week it
 * serves: a lower dose of the same patterns, with no claim that it adds
 * strength — see the deload note in the research ledger.
 */
export const LIGHT_DOSE_SHARE = 0.7

/** An accessory block at a light day's share of the dose capacity chose. */
function lightDose(block: Block): Block {
  const target =
    block.target.kind === 'reps'
      ? reps(Math.max(2, Math.round(block.target.reps * LIGHT_DOSE_SHARE)))
      : hold(Math.max(3, Math.round(block.target.sec * LIGHT_DOSE_SHARE)))
  return { ...block, target }
}

/**
 * Double progression for supporting work, read from the last session that
 * trained the exercise: every set reached its target → a little more next
 * time; at least half did → the same again; most fell short → what was
 * actually achieved.
 *
 * This replaced sizing from "the median of recent bests × 0.6", which only ever
 * lowered a dose — and because an accessory is usually stopped at its target,
 * the logged best *was* the last target, so every session's dose came out at
 * 60% of the one before: a 30-second hollow hold became 18, then 11. Finishing
 * the prescription is evidence it was within capacity, not a measurement of
 * capacity.
 *
 * Interrupted, assisted and timing-problem attempts are left out like
 * everywhere else. Undefined when nothing comparable is logged in six weeks.
 */
export function accessoryProgression(
  state: Pick<AppState, 'sessions'>,
  exerciseId: string,
  kind: 'hold' | 'reps',
  now = Date.now(),
): AccessoryProgression | undefined {
  const recent = state.sessions
    .filter((s) => s.startedAt <= now && now - s.startedAt <= 42 * DAY && s.workoutName !== 'Quick Log')
    .sort((a, b) => b.startedAt - a.startedAt)
  for (const s of recent) {
    const sets = s.sets.filter(
      (x) =>
        x.exerciseId === exerciseId &&
        x.kind === kind &&
        x.section !== 'warmup' &&
        x.section !== 'cooldown' &&
        x.value > 0 &&
        x.target > 0 &&
        !x.light &&
        !isAssisted(x) &&
        !endedForNonCapacityReason(x),
    )
    if (!sets.length) continue
    const lastTarget = Math.max(...sets.map((x) => x.target))
    const ceiling = ACCESSORY_CEILING[exerciseId] ?? (kind === 'reps' ? 15 : 45)
    const tolerance = kind === 'reps' ? 0 : Math.max(0.5, lastTarget * 0.05)
    // A hold stopped at its target call reached it, even when the stop
    // allowance logs it a little under.
    const hits = sets.filter((x) => capacityReading(x) >= x.target - tolerance).length
    if (hits === sets.length) {
      const next = lastTarget + (kind === 'reps' ? 1 : Math.max(1, Math.round(lastTarget * 0.1)))
      return next <= ceiling
        ? { target: next, change: 'up', lastTarget }
        : { target: Math.min(ceiling, lastTarget), change: 'repeat', lastTarget }
    }
    if (hits * 2 >= sets.length) return { target: Math.min(ceiling, lastTarget), change: 'repeat', lastTarget }
    const achieved = median(sets.map((x) => x.value)) ?? lastTarget
    return {
      target: Math.min(ceiling, Math.max(1, kind === 'reps' ? Math.floor(achieved) : Math.round(achieved))),
      change: 'down',
      lastTarget,
    }
  }
  return undefined
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
): { blocks: Block[]; notes: string[]; about: string[] } {
  const notes: string[] = []
  /** The exercise each note describes, so a note can leave with its block. */
  const about: string[] = []
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
    about.push(regression)
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

  // 3. Size what remains. With a logged history the last session decides
  //    (double progression, below); without one, the placement answers may
  //    only lower the default.
  const out = merged.map((block) => {
    if (!adjustable(block)) return block
    if (block.role !== 'backoff') {
      const kind = block.target.kind
      const progression = accessoryProgression(state, block.exerciseId, kind, now)
      if (progression) {
        const current = kind === 'reps' ? (block.target as { reps: number }).reps : (block.target as { sec: number }).sec
        if (progression.target === current) return block
        const name = EXERCISE_BY_ID[block.exerciseId].name
        const unit = (n: number) => (kind === 'reps' ? `${n} rep${n === 1 ? '' : 's'}` : `${n}s`)
        if (progression.change === 'up') {
          notes.push(`${name} up to ${unit(progression.target)} — every set reached ${unit(progression.lastTarget)} last time.`)
          about.push(block.exerciseId)
        } else if (progression.change === 'down') {
          notes.push(`${name} at ${unit(progression.target)} — most sets fell short of ${unit(progression.lastTarget)} last time.`)
          about.push(block.exerciseId)
        }
        return {
          ...block,
          target: kind === 'reps' ? reps(progression.target) : hold(progression.target),
        }
      }
    }
    const capacity = accessoryCapacity(state, block.exerciseId, now)
    if (!capacity || capacity.source === 'log') return block
    const basis = basisFor(block.exerciseId, capacity)
    if (block.target.kind === 'reps') {
      const dose = Math.max(1, Math.floor(capacity.value * 0.7))
      if (dose >= block.target.reps) return block
      notes.push(`${EXERCISE_BY_ID[block.exerciseId].name} set to ${dose} reps, from ${basis}.`)
      about.push(block.exerciseId)
      return { ...block, target: reps(dose), note: block.note ?? `Sized from ${basis}.` }
    }
    const dose = Math.max(1, Math.round(capacity.value * 0.6))
    if (dose >= block.target.sec) return block
    notes.push(`${EXERCISE_BY_ID[block.exerciseId].name} set to ${dose}s, from ${basis}.`)
    about.push(block.exerciseId)
    return { ...block, target: hold(dose), note: block.note ?? `Sized from ${basis}.` }
  })
  return { blocks: out, notes, about }
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
  'tuck-planche-pushup': [
    { id: 'pppu', repsFactor: 2 },
    { id: 'pike-pushup', repsFactor: 2 },
  ],
  'adv-tuck-planche-pushup': [
    { id: 'pppu', repsFactor: 2 },
    { id: 'pike-pushup', repsFactor: 2 },
  ],
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
): { blocks: Block[]; notes: string[]; about: (string | undefined)[] } {
  const notes: string[] = []
  /** The substitute each note introduced; undefined for a note about something left out. */
  const about: (string | undefined)[] = []
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
      about.push(substitute.id)
    } else {
      notes.push(`${exercise?.name ?? block.exerciseId} was left out — it needs ${missing.join(' and ')}.`)
      about.push(undefined)
    }
  }
  return { blocks: out, notes, about }
}

/**
 * The role a block plays, for blocks built before roles existed (templates,
 * older drafts). Generated sessions always set it explicitly.
 */
function roleOf(b: Block): BlockRole | undefined {
  if (b.role) return b.role
  if (b.section === 'main') return 'skill'
  if (b.section === 'core') return 'core'
  if (b.section === 'strength') return 'pressing'
  return undefined
}

/**
 * Trim a session to the athlete's time budget, giving up the least
 * planche-specific work first.
 *
 * The order is the point. The skill holds are the most specific thing in the
 * session and keep their sets longest. Behind them the strength work an
 * athlete asked to see at every level — the push-up version of the step,
 * pseudo planche push-ups, leans — keeps a minimum of two sets each before any
 * of it is dropped, and generic core and mobility go first. The old trimmer
 * worked by section, so at a thirty-minute budget it deleted the pressing
 * work at almost every step while keeping a second core exercise.
 *
 * Warm-up and cooldown are never trimmed. Unilateral blocks lose sets in pairs
 * so a side never goes untrained. Returns what was dropped so the session can
 * say so instead of quietly being smaller.
 */
export function fitToBudget(
  blocks: Block[],
  budgetMin: number,
  preserveCorePair = false,
  calibratedStopLatencySec = 2.3,
  phoneWithinReach = false,
): { blocks: Block[]; dropped: string[] } {
  const out = blocks.map((b) => ({ ...b }))
  const dropped: string[] = []
  const over = () => estimateMinutes(out, calibratedStopLatencySec, phoneWithinReach) > budgetMin
  const stepOf = (b: Block) => (EXERCISE_BY_ID[b.exerciseId]?.perSide ? 2 : 1)
  const isAccessory = (b: Block) => {
    const role = roleOf(b)
    return (
      role === 'backoff' ||
      role === 'assisted' ||
      role === 'balance' ||
      role === 'press' ||
      role === 'pressing' ||
      role === 'straight-arm' ||
      role === 'core'
    )
  }
  /** Remove the last block matching, newest-first so earlier work survives. */
  const dropLast = (match: (b: Block) => boolean): boolean => {
    for (let i = out.length - 1; i >= 0; i--) {
      if (!match(out[i])) continue
      dropped.push(out[i].exerciseId)
      out.splice(i, 1)
      return true
    }
    return false
  }
  /** Take a set off the last block matching, down to `floor`. */
  const shaveLast = (match: (b: Block) => boolean, floor: number): boolean => {
    for (let i = out.length - 1; i >= 0; i--) {
      const b = out[i]
      if (match(b) && b.sets - stepOf(b) >= floor) {
        b.sets -= stepOf(b)
        return true
      }
    }
    return false
  }
  const coreProtected = (b: Block) => preserveCorePair && roleOf(b) === 'core' && b.emphasis === true
  const steps: (() => boolean)[] = [
    // 1. Optional goal mobility and the second compression hold.
    () => dropLast((b) => roleOf(b) === 'mobility' && b.section !== 'warmup' && Boolean(b.note?.includes('goal'))),
    () => dropLast((b) => b.exerciseId === 'l-sit' && !b.emphasis),
    // 2. Sets before blocks: core first, then accessories, each to two.
    () => shaveLast((b) => roleOf(b) === 'core' && !coreProtected(b), 2),
    () => shaveLast((b) => isAccessory(b) && roleOf(b) !== 'core' && !b.emphasis, 2),
    // 3. Whole blocks, least specific first.
    () => dropLast((b) => roleOf(b) === 'backoff'),
    () => dropLast((b) => roleOf(b) === 'balance' && !b.emphasis),
    () => dropLast((b) => roleOf(b) === 'core' && !b.emphasis),
    () => dropLast((b) => roleOf(b) === 'straight-arm' && !b.emphasis),
    () => dropLast((b) => roleOf(b) === 'pressing' && !b.emphasis),
    () => dropLast((b) => roleOf(b) === 'assisted'),
    () => dropLast((b) => roleOf(b) === 'press' && !b.emphasis),
    // 4. The coach's limiter work, the bridge drill, the next-shape attempts,
    //    then — last of all — main sets, floor 3.
    () => shaveLast((b) => Boolean(b.emphasis) && isAccessory(b), 2),
    () => dropLast((b) => Boolean(b.emphasis) && isAccessory(b) && !coreProtected(b)),
    () => dropLast((b) => roleOf(b) === 'bridge' && b.section !== 'main'),
    () => shaveLast((b) => roleOf(b) === 'bridge' && b.section === 'main', 2),
    () => dropLast((b) => roleOf(b) === 'bridge'),
    () => shaveLast((b) => b.section === 'main' && roleOf(b) !== 'attempt' && roleOf(b) !== 'bridge', 3),
  ]
  for (let guard = 0; guard < 80 && over(); guard++) {
    if (!steps.some((step) => step())) break
  }
  return { blocks: out, dropped }
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
 * Main-hold sets for a working target, before the plan's volume factor.
 *
 * A hold dose is the time practised, not the number of sets: four sets of two
 * seconds is eight seconds of practice, four of eight is thirty-two. A fixed
 * four sets therefore handed a beginner with a two-second tuck a quarter of an
 * intermediate's practice. Short targets get more sets instead — the common
 * coaching pattern of many short, fresh, clean attempts when a position can
 * only be held briefly. A convention, not a measured dose-response, and the
 * strategy's own set delta still shapes it either way.
 */
export function mainHoldSets(
  targetSec: number,
  setsDelta: number,
  volumeFactor: number,
  unlockQueued = false,
): number {
  const base = targetSec <= 2 ? 6 : targetSec <= 4 ? 5 : 4
  return clamp(Math.max(1, Math.round(((unlockQueued ? base - 1 : base) + setsDelta) * volumeFactor)), 2, 8)
}

/**
 * Rest after a main hold, scaled to how long the hold is.
 *
 * The planned rest suits a hold of ten seconds or more. A three-second hold is
 * a far smaller effort, and two and a half minutes after each one made a
 * beginner's session — the athlete with the shortest holds and the most to
 * gain from showing up again — the longest and slowest in the app. Short holds
 * keep at least ninety seconds. A design choice, not a measured recovery time;
 * the short-rest strategy still tests shorter rests on its own.
 */
export function restAfterHold(restMainSec: number, targetSec: number): number {
  const factor = targetSec <= 5 ? 0.8 : targetSec < 10 ? 0.9 : 1
  return Math.max(Math.min(90, restMainSec), Math.round((restMainSec * factor) / 5) * 5)
}

/** Default reps for a press when nothing is logged yet: a few, done well. */
const PRESS_DEFAULT_REPS: Record<string, number> = {
  'knee-pushup': 8,
  pushup: 8,
  pppu: 6,
  'tuck-planche-pushup': 3,
  'adv-tuck-planche-pushup': 3,
  'straddle-planche-pushup': 2,
  'full-planche-pushup': 1,
}

const PLANCHE_PRESS = new Set([
  'tuck-planche-pushup',
  'adv-tuck-planche-pushup',
  'straddle-planche-pushup',
  'full-planche-pushup',
])

/** Step down the pressing ladder until the athlete owns the kit for it. */
function pressWithinKit(exerciseId: string, equipment: EquipmentId[]): string {
  let at = PRESS_LADDER.indexOf(exerciseId)
  let id = exerciseId
  while (at > 0 && !hasEquipmentFor(id, equipment)) {
    at -= 1
    id = PRESS_LADDER[at]
  }
  return id
}

/** How a lean reads as an accessory at each stage of the road. */
function leanAccessoryNote(stepId: StepId): string {
  if (stepId === 'frog' || stepId === 'tuck') {
    return 'Straight-arm strength work — lean farther with locked elbows instead of chasing a longer stopwatch. Keep the same hand and foot position every set so the sets compare.'
  }
  return 'Straight-arm conditioning at a deep lean — shoulders well past the fingertips, elbows locked, the lean you can return from under control. It keeps feeding the position after the main work, at a load you can repeat.'
}

/**
 * The recommended session, assembled from the coach's plan for today.
 *
 * Every level gets the same shape, because the user-facing promise is a
 * complete planche session at every step rather than a key hold with whatever
 * survives the clock:
 *
 * 1. warm-up;
 * 2. the step's key hold (with an unlock attempt first when one is earned);
 * 3. the push-up version of the step — tuck planche push-ups at Tuck, and so
 *    on — pressed one step behind until the hold is solid enough to press in;
 * 4. pseudo planche push-ups (or pike push-ups when the press already is one);
 * 5. planche leans as straight-arm work, at every level from the frog stand up;
 * 6. core, then cooldown.
 *
 * The coach's measured limiter adds or reshapes accessory work, the strategy
 * shapes the dose, and easy days drop the loaded accessories. A short time
 * budget trims generic work first (see `fitToBudget`) and says what it cut.
 *
 * @param minutesOverride a smaller time budget for today only. The realistic
 * alternative to "I have twenty minutes" is skipping entirely, and a skipped
 * session teaches the coach nothing — so re-scoping today beats re-planning
 * the week.
 */
export function todaysSession(state: AppState, planIn?: CoachPlan, minutesOverride?: number): Workout {
  const stepId = state.stepId
  const step = STEP_BY_ID[stepId]
  const plan = planIn ?? buildPlan(state)
  if (plan.loadPermission === 'none') {
    return painSafeRecoveryWorkout(plan.signals.lastCheckIn?.regions ?? [])
  }
  const now = Date.now()
  const rMain = plan.restMainSec
  const rAcc = plan.restAccessorySec
  const vol = plan.volumeFactor
  const scale = (n: number) => Math.max(1, Math.round(n * vol))
  const blocks: Block[] = []
  const adjustments: string[] = []
  const equipment = state.profile.equipment

  // An extended warm-up is a coach safety rail and cannot be disabled by the
  // convenience preference.
  if (state.settings.warmup || plan.warmup === 'extended') blocks.push(...warmupFor(stepId, plan.warmup))

  // Fresh and within reach → attempt the unlock while at your best. The plan
  // only sets this when today's challenge permission allows it.
  const attemptQueued = plan.queueUnlockAttempt && plan.challengeAllowed
  if (attemptQueued) {
    blocks.push({
      exerciseId: step.keyExerciseId,
      sets: 1,
      target: hold(step.unlockSec),
      restSec: 180,
      section: 'main',
      role: 'attempt',
      note: `Unlock attempt — you're within reach. Hold ${step.unlockSec}s clean, film it, and pass both form confirmations. Stop the moment the shape goes; a stopped attempt is still useful.`,
    })
  }

  // ——— 2. The key hold ———
  //
  // The floor is one second, not three. A three-second floor silently raised a
  // capacity-capped one-second target back above what the athlete had shown,
  // and contradicted Full Planche's own two-second start. And no strategy may
  // push a working target past the best this athlete has actually held.
  const baseTarget = adaptiveTarget(state, stepId)
  const capacity = observedCapacity(state, stepId)
  let target = clamp(Math.round(baseTarget * plan.targetFactor), 1, step.unlockSec)
  if (capacity !== undefined) target = Math.min(target, Math.max(1, Math.floor(capacity)))
  const surface = defaultSurface(equipment, state.profile.preferredSurface)
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
  const easyDay = plan.strategy === 'technique' || plan.dayType === 'technique' || plan.dayType === 'deload'
  // ——— The bridge to the next step ———
  //
  // Once the current hold is halfway to its bar, the next shape is practised
  // directly: a few short attempts first, while fresh, then the drill that
  // teaches the change between the two shapes. Only on a day that allows a
  // maximal effort (it is one), never beside an unlock attempt (one maximal
  // focus per day), never on an easy day. Logged as main work on the next
  // step's own exercise, so it is filmed, judged by the camera, and — held
  // clean at its opening dose — opens the next step early (lib/bridge).
  const bridge = bridgeStatus(state, stepId)
  const bridging = Boolean(bridge?.open) && !easyDay && plan.challengeAllowed && !attemptQueued
  if (bridging && bridge) {
    const next = bridge.next
    const nextEx = EXERCISE_BY_ID[next.keyExerciseId]
    const shown = capacityOn(state, next.id)
    const balance = next.keyExerciseId === 'frog-stand'
    // Short attempts sized from what the athlete has shown on the next shape;
    // with nothing shown, about 40% of its opening dose — two seconds of a
    // tuck, five of a lean. A balance skill gets longer practice.
    const opening = Math.max(2, Math.round(next.startSec * 0.4))
    const bridgeTarget = balance
      ? clamp(shown !== undefined ? Math.round(shown * 0.7) : 10, 5, 20)
      : clamp(shown !== undefined ? Math.round(shown * 0.7) : opening, 1, next.startSec)
    blocks.push({
      exerciseId: next.keyExerciseId,
      sets: nextEx.perSide ? 2 : 3,
      target: hold(bridgeTarget),
      // Brief maximal attempts: full recovery between them, but a two-second
      // hold does not need the rest a twenty-second one does.
      restSec: balance ? rAcc : restAfterHold(Math.max(rMain, 120), bridgeTarget),
      section: 'main',
      role: 'bridge',
      note: balance
        ? `Next shape: ${nextEx.name.toLowerCase()} practice, first while you are fresh. Balance comes from the fingertips — lean until the feet get light rather than jumping. Film one and review it against the checklist: ${next.startSec}s reviewed opens the step early once your lean reaches ${Math.round(bridge.promotionCurrentSec)}s.`
        : `Next shape, first while you are fresh: short, fresh attempts at the ${nextEx.name.toLowerCase()} — stop at the first loss of shape; a one-second clean hold beats five ugly ones. Held clean on camera for ${next.startSec}s${nextEx.perSide ? ' each side' : ''}, it opens the step early once your ${step.name.toLowerCase()} is verified past ${Math.round(bridge.promotionCurrentSec)}s.`,
    })
  }

  // A per-side hold is two rounds a set, so it starts a set lighter: one-leg
  // sessions otherwise spent their whole budget on the key hold and every
  // accessory was trimmed away.
  const mainSets = Math.max(
    2,
    mainHoldSets(target, plan.setsDelta, vol, attemptQueued || bridging) -
      (EXERCISE_BY_ID[step.keyExerciseId]?.perSide ? 1 : 0),
  )
  // While bridging, the main holds lean toward the next shape too: the change
  // between two steps is a dial, not a switch.
  const lockoutCue =
    plan.accessoryEmphasis === 'lockout'
      ? ' Lock the elbows before the feet leave the floor; the moment they soften, the set is over.'
      : ''
  const bridgeCue = !bridging
    ? ''
    : stepId === 'tuck'
      ? ' Bridge open: hold each tuck with the back a little flatter than last week — the hip meter on Home tracks the opening.'
      : stepId === 'straddle'
        ? ' Bridge open: narrow the legs a few degrees at a time, keeping the line level.'
        : stepId === 'advtuck'
          ? ' Bridge open: keep the back flat while you lean a little further each week — the one-leg shape needs both.'
          : ''
  blocks.push({
    exerciseId: step.keyExerciseId,
    sets: mainSets,
    target: hold(target),
    restSec: restAfterHold(rMain, target),
    section: 'main',
    role: 'skill',
    note: `${strategyNote}${lockoutCue}${shortNote}${placementNote}${transferNote}${bridgeCue}`,
  })

  const easy = easyDay
  // Why the day is easy decides what eases. A fatigue day — the day after a
  // max test or an RPE 9+ session, a second session today, a scheduled easy
  // week — keeps the whole session at a light dose. A form-repair day eases
  // only the key hold. Easy days used to swap the pressing and leans for a
  // frog stand and scap push-ups, and the coach turns every day into a
  // form-repair day while the camera keeps flagging the same fault — so an
  // athlete with soft elbows lost the lockout leans built for them, and all
  // their pressing, for as long as the fault lasted.
  const light = plan.dayType === 'technique' || plan.dayType === 'deload'

  // The transition drill comes after the key holds, so the main volume is
  // practised fresh and the drill still lands while the arms are warm.
  if (bridging && stepId === 'tuck') {
    blocks.push({
      exerciseId: 'tuck-open-close',
      sets: 2,
      target: reps(3),
      restSec: rAcc,
      section: 'strength',
      role: 'bridge',
      note: 'The transition itself: from your tuck, open a little toward the flat back and return. Small range, locked arms, controlled landing.',
    })
  }

  // Band-assisted straddle: the full shape rehearsed with help, long before it
  // can be held free. At the straddle, and from the one-leg step once its
  // bridge opens; only with the kit to anchor it.
  if (
    (stepId === 'straddle' || (stepId === 'oneleg' && bridging)) &&
    hasEquipmentFor('band-straddle-planche', equipment) &&
    plan.strategy !== 'intensity'
  ) {
    blocks.push({
      exerciseId: 'band-straddle-planche',
      sets: light ? 2 : 3,
      target: hold(10),
      restSec: rAcc,
      section: 'strength',
      role: 'assisted',
      ...(light ? { light: true } : {}),
      note: 'Assisted practice in the real shape — same form rules as the free hold, same band and anchor every time so sessions compare. Never counts toward the unassisted unlock.',
    })
  }

  // Balanced and volume sessions keep an owned position in the session;
  // intensity protects freshness, while density protects the short-rest
  // identity. Tuck uses loaded leans below instead of Frog Stand as its
  // back-off — the exported history showed that generic previous-step rule was
  // making nearly every Tuck session look the same without adding useful
  // straight-arm capacity.
  const prev = stepBefore(stepId)
  if (
    prev &&
    stepId !== 'tuck' &&
    stepId !== 'frog' &&
    (plan.strategy === 'balanced' || plan.strategy === 'volume') &&
    !easy
  ) {
    blocks.push({
      exerciseId: prev.keyExerciseId,
      sets: plan.strategy === 'volume' ? 3 : 2,
      target: hold(clamp(Math.round(prev.unlockSec * 0.6), 5, prev.unlockSec)),
      restSec: rAcc,
      section: 'strength',
      role: 'backoff',
      note:
        plan.strategy === 'volume'
          ? 'Capacity work on a position you already own — clean accumulation, not a second max effort.'
          : 'A small back-off dose on the position you already own.',
    })
  }

  // A second loaded session on the same day is skill work only, as its day
  // reason says: balance practice and light protraction, no pressing.
  const skillOnly = plan.dayType === 'technique' && plan.signals.daysSinceLoaded === 0
  if (skillOnly) {
    blocks.push(
      {
        exerciseId: 'frog-stand',
        sets: 2,
        target: hold(15),
        restSec: rAcc,
        section: 'strength',
        role: 'balance',
        note: 'Balance practice — a lower-load skill drill, though not a free one for wrists.',
      },
      {
        exerciseId: 'scap-pushup',
        sets: 2,
        target: reps(8),
        restSec: Math.min(60, rAcc),
        section: 'strength',
        role: 'straight-arm',
        light: true,
        note: 'Light protraction practice — crisp reps, nowhere near failure. No loaded pressing or lean volume in a second session today.',
      },
    )
  } else {
    // ——— 3. The push-up version of the step ———
    const choice = pressingChoiceFor(stepId, capacity)
    // A day with a joint complaint keeps its pressing but not the hardest of
    // it: a planche push-up is a maximal, deep-wrist press, so it steps down
    // to the pseudo planche push-up until the complaint is updated. A light
    // day steps down the same way — a planche push-up is maximal however few
    // reps are asked for.
    const easedForJoints = plan.loadPermission === 'reduced' && PLANCHE_PRESS.has(choice.exerciseId)
    const easedForDay = !easedForJoints && light && PLANCHE_PRESS.has(choice.exerciseId)
    const pressId = easedForJoints || easedForDay ? 'pppu' : pressWithinKit(choice.exerciseId, equipment)
    const pressKitNote = easedForJoints
      ? ` ${EXERCISE_BY_ID[choice.exerciseId].name} is set aside today for the joint you flagged — stop any set that makes it worse.`
      : easedForDay
        ? ` ${EXERCISE_BY_ID[choice.exerciseId].name} waits for a full day; today presses lighter.`
        : pressId !== choice.exerciseId
          ? ` ${EXERCISE_BY_ID[choice.exerciseId].name} needs parallettes, so this is the closest press your kit allows.`
          : ''
    const planchePress = PLANCHE_PRESS.has(pressId)
    const pressSets =
      plan.strategy === 'volume' ? 4 : plan.strategy === 'intensity' || plan.strategy === 'density' ? 3 : 3
    const pressDefault = PRESS_DEFAULT_REPS[pressId] ?? 5
    const pressTargetReps =
      plan.strategy === 'intensity' ? Math.max(1, pressDefault - (planchePress ? 1 : 2)) : pressDefault
    blocks.push({
      exerciseId: pressId,
      sets: light ? 2 : scale(pressSets + (plan.accessoryEmphasis === 'pressing' ? 1 : 0)),
      target: reps(pressTargetReps),
      restSec: planchePress || plan.strategy === 'intensity' ? Math.max(rAcc, Math.round(rMain * 0.8)) : plan.strategy === 'density' ? Math.min(60, rAcc) : rAcc,
      section: 'strength',
      role: 'press',
      ...(light ? { light: true } : plan.accessoryEmphasis === 'pressing' ? { emphasis: true } : {}),
      note: `Push-up version of this step. ${choice.reason}${pressKitNote}${
        planchePress
          ? ' Can’t press back up yet? Lower slowly over about three seconds, step out, reset at the top — log the reps you completed.'
          : ''
      }`,
    })

    // ——— 4. Pressing accessory ———
    // Pseudo planche push-ups after the planche press; when the press already
    // is the pseudo planche push-up (or a plain push-up at Foundations), a
    // different pressing angle instead of the same exercise twice. Intensity
    // keeps one press and stops, for freshness; density keeps one press so the
    // session stays compact; a light day presses once.
    if (!light && ((plan.strategy !== 'intensity' && plan.strategy !== 'density') || plan.accessoryEmphasis === 'pressing')) {
      const accessoryId = pressId === 'pppu' ? 'pike-pushup' : 'pppu'
      blocks.push({
        exerciseId: accessoryId,
        sets: scale(plan.strategy === 'volume' ? 3 : plan.strategy === 'density' ? 2 : 3),
        target: reps(accessoryId === 'pike-pushup' ? 8 : 6),
        restSec: plan.strategy === 'density' ? Math.min(45, rAcc) : rAcc,
        section: 'strength',
        role: 'pressing',
        ...(plan.accessoryEmphasis === 'pressing' ? { emphasis: true } : {}),
        note:
          accessoryId === 'pppu'
            ? 'Bent-arm pressing in the lean — the same lean every rep, shoulders past the hands at the top and the bottom.'
            : accessoryId === 'pike-pushup'
              ? 'A second pressing angle — overhead-leaning strength that supports the press above.'
              : undefined,
      })
    }

    // ——— 5. Straight-arm accessory ———
    // Leans at every level from the frog stand up. At Foundations and the
    // lean itself the main work already is a lean, so protraction strength
    // takes the slot instead.
    const scapulaLimiter = plan.accessoryEmphasis === 'scapula'
    if (step.order <= STEP_BY_ID.lean.order || scapulaLimiter) {
      blocks.push({
        exerciseId: 'scap-pushup',
        sets: light ? (scapulaLimiter ? 3 : 2) : scale(scapulaLimiter ? 4 : 3),
        target: reps(10),
        restSec: plan.strategy === 'density' ? Math.min(45, rAcc) : rAcc,
        section: 'strength',
        role: 'straight-arm',
        ...(scapulaLimiter ? { emphasis: true } : {}),
        ...(light ? { light: true } : {}),
        note: scapulaLimiter
          ? 'Scapular control is the limiter — finish every rep by pushing the floor fully away.'
          : 'Protraction strength — the push-away every straight-arm hold depends on. Finish each rep with the upper back gently rounded.',
      })
    }
    if (step.order >= STEP_BY_ID.frog.order && stepId === 'advtuck' && bridging) {
      // Bridging to the one-leg: the lean with one foot lifted trains the
      // square hips the next shape needs, and shows any side difference.
      blocks.push({
        exerciseId: 'one-leg-lean',
        sets: scale(2),
        target: hold(8),
        restSec: rAcc,
        section: 'strength',
        role: 'straight-arm',
        note: 'Bridge to the one-leg: a deep lean with one foot lifted, hips square. Same time each side; the weaker side goes first.',
      })
    } else if (step.order >= STEP_BY_ID.frog.order) {
      const lockout = plan.accessoryEmphasis === 'lockout'
      blocks.push({
        exerciseId: 'planche-lean',
        // A lockout limiter keeps its extra set even on a light day: a locked
        // lean at a depth the elbows can hold is the repair, not extra load.
        sets: light
          ? 2 + (lockout ? 1 : 0)
          : scale(
              (plan.strategy === 'intensity' || plan.strategy === 'density' ? 2 : plan.strategy === 'volume' && stepId === 'tuck' ? 4 : 3) +
                (lockout ? 1 : 0),
            ),
        target: hold(stepId === 'frog' || stepId === 'tuck' ? 12 : 10),
        restSec: plan.strategy === 'density' ? Math.min(45, rAcc) : rAcc,
        section: 'strength',
        role: 'straight-arm',
        ...(lockout ? { emphasis: true } : {}),
        ...(light ? { light: true } : {}),
        note: lockout
          ? 'Lockout practice — your camera keeps seeing soft elbows. Lock first, then lean: find the deepest lean your elbows stay fully locked in and hold there. Squeeze the triceps; a shallower locked lean beats a deep bent one.'
          : leanAccessoryNote(stepId),
      })
    }

    // The coach's other measured limiters.
    if (plan.accessoryEmphasis === 'balance' && stepId !== 'frog') {
      blocks.splice(blocks.findIndex((b) => b.role === 'skill') + 1, 0, {
        exerciseId: 'frog-stand',
        sets: light ? 2 : scale(3),
        target: hold(20),
        restSec: rAcc,
        section: 'strength',
        role: 'balance',
        emphasis: true,
        note: 'Balance practice gets the extra time today.',
      })
    }
    if (plan.accessoryEmphasis === 'pressing' && pressId !== 'pppu' && !light) {
      // Already has a second press; pike push-ups add the overhead angle.
      blocks.push({
        exerciseId: 'pike-pushup',
        sets: scale(3),
        target: reps(8),
        restSec: rAcc,
        section: 'strength',
        role: 'pressing',
        emphasis: true,
        note: 'Extra bent-arm pressing — a supporting option for a stalled hold, not a guaranteed fix.',
      })
    }
    if (plan.strategy === 'volume' && step.order > STEP_BY_ID.lean.order && !scapulaLimiter) {
      blocks.push({
        exerciseId: 'scap-pushup',
        sets: scale(3),
        target: reps(10),
        restSec: rAcc,
        section: 'strength',
        role: 'straight-arm',
        note: 'Capacity support — repeat crisp protraction without turning the session into another max-strength day.',
      })
    }
  }

  // ——— 6. Core ———
  // Transition-specific trunk work while bridging: the flat back of the
  // advanced tuck is held by the posterior chain, and the straddle's straight,
  // raised legs by compression.
  if (bridging && plan.accessoryEmphasis !== 'core') {
    if (stepId === 'tuck') {
      blocks.push({
        exerciseId: 'arch-hold',
        sets: 2,
        target: hold(20),
        restSec: 45,
        section: 'core',
        role: 'core',
        note: 'For the flat back the advanced tuck needs: glutes and back extensors hold the line the tuck never asked for.',
      })
    } else if (stepId === 'oneleg') {
      blocks.push({
        exerciseId: 'leg-lifts',
        sets: 2,
        target: reps(8),
        restSec: 45,
        section: 'core',
        role: 'core',
        note: 'Compression for the straddle: straight legs that lift and stay lifted.',
      })
    }
  }
  if (plan.accessoryEmphasis === 'core') {
    blocks.push(
      {
        exerciseId: 'hollow-hold',
        sets: scale(4),
        target: hold(25),
        restSec: 60,
        section: 'core',
        role: 'core',
        emphasis: true,
        note: 'Body line is the limiter — lock ribs, pelvis and legs into one unit.',
      },
      { exerciseId: 'arch-hold', sets: scale(3), target: hold(20), restSec: 60, section: 'core', role: 'core', emphasis: true },
    )
  } else if (plan.strategy === 'density') {
    blocks.push({ exerciseId: 'hollow-rocks', sets: 3, target: reps(10), restSec: Math.min(40, rAcc), section: 'core', role: 'core' })
  } else {
    blocks.push({
      exerciseId: 'hollow-hold',
      sets: plan.strategy === 'volume' ? scale(3) : scale(2),
      target: hold(light ? 20 : 30),
      restSec: 45,
      section: 'core',
      role: 'core',
    })
    if (step.order >= STEP_BY_ID.tuck.order && !easy && plan.strategy === 'balanced') {
      blocks.push({ exerciseId: 'l-sit', sets: 2, target: hold(12), restSec: 60, section: 'core', role: 'core' })
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
      role: 'mobility',
      note:
        step.order < 5
          ? `${goal.name} goal — range now makes a wider straddle available later. Practice time, not a measure of straddle strength.`
          : undefined,
    })
  }

  // Kit first (so a substitute is sized like everything else), then capacity,
  // then a light day's share of the dose that capacity chose.
  const kit = resolveEquipment(blocks, equipment)
  const sized = capacityAdjustBlocks(state, kit.blocks, now)
  const lightened = sized.blocks.map((b) => (b.light ? lightDose(b) : b))
  if (lightened.some((b) => b.light)) {
    adjustments.push(
      `Easy day: pressing and leans at about ${Math.round(LIGHT_DOSE_SHARE * 100)}% of your usual dose — keep the pattern, leave the fatigue. These sets do not change your accessory targets.`,
    )
  }

  // Shorter than a full day, long enough for the whole shape at its light dose.
  const baseBudget = light ? Math.min(30, state.settings.sessionMinutes) : state.settings.sessionMinutes
  const budget = minutesOverride !== undefined ? Math.min(baseBudget, Math.max(8, minutesOverride)) : baseBudget
  // Sides are expanded before trimming, so the budget accounts for the fact
  // that unilateral work costs twice as long.
  const fit = fitToBudget(
    withSides(lightened),
    budget,
    plan.accessoryEmphasis === 'core',
    state.settings.stopLatencySec,
    state.settings.phoneWithinReach,
  )
  const fitted = fit.blocks

  // Notes about blocks the budget then removed would describe a session the
  // athlete is not getting — "pseudo planche push-ups set to 4 reps" above a
  // list with no pseudo planche push-ups in it. Warm-up primers do not count
  // as the block being present: an 8-second primer lean is not the lean work.
  const present = new Set(fitted.filter((b) => b.section !== 'warmup').map((b) => b.exerciseId))
  kit.notes.forEach((note, i) => {
    const subject = kit.about[i]
    if (subject === undefined || present.has(subject)) adjustments.push(note)
  })
  // A progression note about a light block would quote a target the block no
  // longer has ("up to 9 reps" above a set of six).
  const lightIds = new Set(lightened.filter((b) => b.light).map((b) => b.exerciseId))
  sized.notes.forEach((note, i) => {
    if (present.has(sized.about[i]) && !lightIds.has(sized.about[i])) adjustments.push(note)
  })
  const droppedNames = [...new Set(fit.dropped)]
    .filter((id) => !present.has(id))
    .map((id) => EXERCISE_BY_ID[id]?.name.toLowerCase())
    .filter((name): name is string => Boolean(name))
  if (droppedNames.length) {
    adjustments.push(
      `Left out to fit ${budget} minutes: ${joinWords(droppedNames)}. ${
        minutesOverride !== undefined
          ? 'They come back on a full-length day.'
          : 'A longer session length in Settings keeps them.'
      }`,
    )
  }

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
    baseTargetSec: baseTarget,
    purpose: skillOnly
      ? `Practise ${EXERCISE_BY_ID[step.keyExerciseId]?.name.toLowerCase() ?? step.name} at an easy dose, with balance and protraction work only — no pressing or leans in a second session today.`
      : light
        ? `Practise ${EXERCISE_BY_ID[step.keyExerciseId]?.name.toLowerCase() ?? step.name} at an easy dose, with the pressing and lean work kept light.`
        : easy
          ? `Practise ${EXERCISE_BY_ID[step.keyExerciseId]?.name.toLowerCase() ?? step.name} at easier targets so the position stays clean, then build the strength behind it as usual.`
          : `Practise ${EXERCISE_BY_ID[step.keyExerciseId]?.name.toLowerCase() ?? step.name} at a working dose, then build the pressing and straight-arm strength behind it.`,
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

/** A minimum dose's holds: short, maximal and few. */
export const MICRO_HOLD_SEC = 3
export const MICRO_HOLDS = 5

/**
 * Why there is no minimum dose today, or null when there may be one.
 *
 * It is maximal work, so it needs everything a max test needs, and more: not
 * on a lighter day (after a max test, an RPE 9+ session or a scheduled easy
 * week), not while the camera keeps flagging the shape (easier positions come
 * first there), not after loaded training today, and once a day at most.
 */
export function microBlockedReason(state: Pick<AppState, 'sessions'>, plan: CoachPlan, now = Date.now()): string | null {
  const challenge = challengeBlockedReason(plan)
  if (challenge) return challenge
  // Before the day type: training today is what made it a lighter day.
  if (plan.signals.daysSinceLoaded === 0) return 'you already trained today'
  if (plan.dayType === 'technique' || plan.dayType === 'deload' || plan.dayType === 'recovery') {
    return 'today is set up as a lighter day'
  }
  if (plan.strategy === 'technique') return 'your recent holds are losing their shape, and easier positions come first'
  const today = new Date(now).toDateString()
  if (state.sessions.some((s) => s.workoutKind === 'micro' && new Date(s.startedAt).toDateString() === today)) {
    return 'you already did one today'
  }
  return null
}

/**
 * The minimum dose: a few short, maximal holds for a day a full session will
 * not happen.
 *
 * At the hardest shape held clean — the next shape once the bridge is open,
 * otherwise the step's own hold leaned further than the working sets. Short
 * maximal holds were the stronger tendon stimulus in the one trial comparing
 * hold lengths (3 s against 12 s, ledger §2), and brief daily maximal holds
 * raised strength in small trials on simpler movements (ledger §12) — none on
 * the planche, which the copy says. It is extra, not a session: kept out of
 * the coach's learning, the frequency signal and the weekly goal, and its
 * targets never move set to set.
 */
export function microDoseWorkout(state: AppState, plan: CoachPlan): Workout {
  const step = STEP_BY_ID[state.stepId]
  const bridge = bridgeStatus(state, step.id)
  const next = bridge?.open ? bridge.next : undefined
  const shape = next ?? step
  const exercise = EXERCISE_BY_ID[shape.keyExerciseId]
  const shown = capacityOn(state, shape.id)
  // About three seconds where the athlete has held more; never past what they
  // have shown, and a short opener on a next shape not held yet.
  const target =
    shown !== undefined
      ? clamp(Math.floor(shown), 1, MICRO_HOLD_SEC)
      : next
        ? clamp(Math.round(next.startSec * 0.4), 1, MICRO_HOLD_SEC)
        : MICRO_HOLD_SEC
  const blocks: Block[] = [
    // Wrists and a primer lean are the warm-up three-second holds need; a coach
    // that asked for the extended one (skipped warm-ups, a cold start) gets it.
    ...warmupFor(step.id, plan.warmup === 'extended' ? 'extended' : 'short'),
    {
      exerciseId: shape.keyExerciseId,
      // A per-side hold is a pair of rounds a set.
      sets: exercise.perSide ? 3 : MICRO_HOLDS,
      target: hold(target),
      restSec: 40,
      section: 'main',
      role: next ? 'bridge' : 'skill',
      note: next
        ? `Short, hard holds at the ${exercise.name.toLowerCase()} — the shape you are building toward. About ${target}s each, and stop the moment the shape goes. Filmed and held clean, they count like any other attempt.`
        : `Short, hard holds: lean further than in your working sets, until about ${target}s is all you could hold clean. Stop the moment the shape goes — a held position, not a struggle.`,
    },
    { exerciseId: 'wrist-stretch', sets: 1, target: hold(30), restSec: 10, section: 'cooldown' },
  ]
  const kit = resolveEquipment(blocks, state.profile.equipment)
  const sided = withSides(kit.blocks)
  return {
    id: `micro-${step.id}`,
    name: `${step.name} · Minimum dose`,
    focus: `A few short, maximal holds for a day a full session will not happen — it does not replace your sessions. Brief maximal holds raised strength in small trials on simpler movements; none tested the planche.`,
    minutes: estimateMinutes(sided, state.settings.stopLatencySec, state.settings.phoneWithinReach),
    kind: 'micro',
    blocks: sided,
    purpose: next
      ? `${MICRO_HOLDS} short, hard holds at the next shape, then done.`
      : `${MICRO_HOLDS} short, hard holds at the hardest version of your hold you can keep clean, then done.`,
    ...(kit.notes.length ? { adjustments: kit.notes } : {}),
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
      'Wrist preparation: controlled range, then light loading. Preparation, not treatment — it does not make a sore wrist safe to load.',
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
  } else if (request.source === 'micro') {
    const blocked = microBlockedReason(state, plan, now)
    if (blocked) {
      workout = todaysSession(state, plan, request.minutes)
      adjustments.push(`No minimum dose today because ${blocked} — this is an ordinary session instead.`)
    } else {
      workout = microDoseWorkout(state, plan)
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
  if (workout.kind === 'micro') return { source: 'micro' }
  if (workout.kind === 'template') {
    const id = workout.id.replace(/-readiness-adjusted$/, '')
    return TEMPLATE_BY_ID[id] ? { source: 'template', templateId: id } : { source: 'auto' }
  }
  return { source: 'auto' }
}
