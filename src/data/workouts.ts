import type { AppState, Block, BlockTarget, StepId, Workout } from '../types'
import { EXERCISE_BY_ID } from './exercises'
import { STEP_BY_ID, stepBefore } from './progressions'
import { dayKey } from '../lib/time'

const hold = (sec: number): BlockTarget => ({ kind: 'hold', sec })
const reps = (n: number): BlockTarget => ({ kind: 'reps', reps: n })

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

export function estimateMinutes(blocks: Block[]): number {
  let sec = 0
  for (const b of blocks) {
    const work = b.target.kind === 'hold' ? b.target.sec : b.target.reps * 3
    sec += b.sets * (work + b.restSec)
  }
  return Math.max(5, Math.round(sec / 60))
}

// ————————————————————————————— Adaptive engine —————————————————————————————

export type DayType = 'push' | 'standard' | 'technique'

export interface DayContext {
  type: DayType
  reason: string
  restDays: number
}

/**
 * Reads recovery state from the log: fresh athletes get pushed, cooked
 * athletes get a technique day. This is what keeps hard days hard and easy
 * days actually easy — the fastest sustainable route up the progression.
 */
export function dayContext(state: AppState, now = Date.now()): DayContext {
  const last = [...state.sessions].sort((a, b) => b.startedAt - a.startedAt)[0]
  if (!last) return { type: 'standard', reason: 'First session — establishing your baseline.', restDays: 99 }
  const dayMs = 86_400_000
  const restDays = Math.max(
    0,
    Math.round((new Date(dayKey(now)).getTime() - new Date(dayKey(last.startedAt)).getTime()) / dayMs),
  )
  if (restDays === 0) {
    return { type: 'technique', reason: 'Second visit today — light skill work only, tendons keep score.', restDays }
  }
  if (restDays === 1 && (last.rpe ?? 8) >= 9) {
    return { type: 'technique', reason: 'Yesterday hit RPE 9+ — today recovers it into strength.', restDays }
  }
  if (restDays >= 2) {
    return {
      type: 'push',
      reason: `${restDays} rest day${restDays > 1 ? 's' : ''} banked — you're fresh, so today pushes.`,
      restDays,
    }
  }
  return { type: 'standard', reason: 'Build day — steady volume at working intensity.', restDays }
}

/**
 * Working-set target that adapts to how the last session actually went:
 * hit ≥80% of your main sets and the bar nudges up; miss most and it backs
 * off. Anchored to ~60% of your best, never above the unlock bar.
 */
export function adaptiveTarget(state: AppState, stepId: StepId): number {
  const step = STEP_BY_ID[stepId]
  const best = state.prs[step.keyExerciseId]?.value
  if (!best) return step.startSec
  let t = best * 0.6
  const lastMain = [...state.sessions]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((s) => s.sets.filter((x) => x.exerciseId === step.keyExerciseId && x.section === 'main'))
    .find((sets) => sets.length >= 2)
  if (lastMain) {
    const hitRate = lastMain.filter((x) => x.value >= x.target).length / lastMain.length
    if (hitRate >= 0.8) t *= 1.15
    else if (hitRate < 0.5) t *= 0.85
  }
  return clamp(Math.round(t), 3, step.unlockSec)
}

/** True when the athlete is close enough to test the unlock for real. */
export function unlockAttemptReady(state: AppState, stepId: StepId): boolean {
  const step = STEP_BY_ID[stepId]
  const best = state.prs[step.keyExerciseId]?.value ?? 0
  return best >= step.unlockSec * 0.85 && best < step.unlockSec
}

/**
 * Trim a session to the athlete's time budget, sacrificing least-important
 * work first: accessory sets → whole accessory blocks → a main back-off set.
 * Warm-up, the key main work and the cooldown are never cut below minimums.
 */
function fitToBudget(blocks: Block[], budgetMin: number): Block[] {
  const out = blocks.map((b) => ({ ...b }))
  for (let guard = 0; guard < 40 && estimateMinutes(out) > budgetMin; guard++) {
    let changed = false
    // 1. Shave sets off strength/core blocks (from the back), floor 2.
    for (let i = out.length - 1; i >= 0; i--) {
      const b = out[i]
      if ((b.section === 'strength' || b.section === 'core') && b.sets > 2) {
        b.sets -= 1
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
    // 3. Drop a core block while more than one remains.
    const coreIdx = out.map((b, i) => (b.section === 'core' ? i : -1)).filter((i) => i >= 0)
    if (coreIdx.length > 1) {
      out.splice(coreIdx[coreIdx.length - 1], 1)
      continue
    }
    // 4. Reduce main sets, floor 3.
    const main = out.find((b) => b.section === 'main' && b.sets > 3)
    if (main) {
      main.sets -= 1
      continue
    }
    break
  }
  return out
}

const DAY_LABEL: Record<DayType, string> = {
  push: 'Push Day',
  standard: 'Build Day',
  technique: 'Technique Day',
}

/** The recommended session for wherever — and however recovered — the athlete is. */
export function todaysSession(state: AppState): Workout {
  const stepId = state.stepId
  const step = STEP_BY_ID[stepId]
  const ctx = dayContext(state)
  const rMain = ctx.type === 'technique' ? Math.max(60, state.settings.restMainSec - 30) : state.settings.restMainSec
  const rAcc = state.settings.restAccessorySec
  const blocks: Block[] = []

  // Short, targeted warm-up (~3 min): wrists first, always.
  if (state.settings.warmup) {
    blocks.push(
      { exerciseId: 'wrist-circles', sets: 1, target: reps(10), restSec: 10, section: 'warmup' },
      { exerciseId: 'wrist-rocks', sets: 1, target: reps(8), restSec: 20, section: 'warmup' },
      { exerciseId: 'scap-pushup', sets: 1, target: reps(8), restSec: 30, section: 'warmup' },
    )
    if (step.order >= 1) {
      blocks.push({
        exerciseId: 'planche-lean',
        sets: 1,
        target: hold(8),
        restSec: 45,
        section: 'warmup',
        note: 'Easy primer lean — grease the pattern, save the juice.',
      })
    } else {
      blocks.push({ exerciseId: 'plank', sets: 1, target: hold(20), restSec: 45, section: 'warmup' })
    }
  }

  // Fresh + close to the bar → attempt the unlock while at your best.
  const attempt = ctx.type === 'push' && unlockAttemptReady(state, stepId)
  if (attempt) {
    blocks.push({
      exerciseId: step.keyExerciseId,
      sets: 1,
      target: hold(step.unlockSec),
      restSec: 180,
      section: 'main',
      note: `Unlock attempt — you're within reach. Hold ${step.unlockSec}s clean and the next step opens.`,
    })
  }

  // Main isometrics at the adaptive working target.
  const baseTarget = adaptiveTarget(state, stepId)
  const target = ctx.type === 'technique' ? Math.max(3, Math.round(baseTarget * 0.75)) : baseTarget
  blocks.push({
    exerciseId: step.keyExerciseId,
    sets: ctx.type === 'technique' ? 3 : attempt ? 3 : 4,
    target: hold(target),
    restSec: rMain,
    section: 'main',
    note:
      ctx.type === 'technique'
        ? 'Easy targets today — perfect positions, zero grinding.'
        : 'Stop each set ~2s before failure. Quality over seconds.',
  })

  // One back-off block on the previous step keeps old positions honest.
  const prev = stepBefore(stepId)
  if (prev && prev.order >= 1 && ctx.type !== 'technique') {
    blocks.push({
      exerciseId: prev.keyExerciseId,
      sets: 2,
      target: hold(clamp(Math.round(prev.unlockSec * 0.6), 5, prev.unlockSec)),
      restSec: rAcc,
      section: 'main',
      note: 'Back-off volume on the step you already own.',
    })
  }

  // Strength accessories — trimmed on technique days.
  if (ctx.type === 'technique') {
    blocks.push({ exerciseId: 'frog-stand', sets: 2, target: hold(15), restSec: rAcc, section: 'strength', note: 'Balance practice — cheap on tendons, great for skill.' })
  } else if (step.order <= 2) {
    blocks.push(
      { exerciseId: 'pppu', sets: 3, target: reps(5), restSec: rAcc, section: 'strength' },
      { exerciseId: 'pushup', sets: 2, target: reps(10), restSec: rAcc, section: 'strength' },
    )
  } else if (step.order <= 4) {
    blocks.push(
      { exerciseId: 'pppu', sets: 3, target: reps(6), restSec: rAcc, section: 'strength' },
      { exerciseId: 'pike-pushup', sets: 2, target: reps(8), restSec: rAcc, section: 'strength' },
    )
  } else {
    blocks.push(
      { exerciseId: 'tuck-planche-pushup', sets: 3, target: reps(4), restSec: rMain, section: 'strength' },
      { exerciseId: 'pppu', sets: 2, target: reps(8), restSec: rAcc, section: 'strength' },
    )
  }

  // Core: one block, two on longer budgets (the trimmer sorts it out).
  blocks.push({ exerciseId: 'hollow-hold', sets: 2, target: hold(30), restSec: 45, section: 'core' })
  if (step.order >= 3) {
    blocks.push({ exerciseId: 'l-sit', sets: 2, target: hold(12), restSec: 60, section: 'core' })
  }

  // Short cooldown (~2 min): give back what the lean took.
  blocks.push(
    { exerciseId: 'wrist-stretch', sets: 1, target: hold(30), restSec: 10, section: 'cooldown' },
    { exerciseId: 'shoulder-extension-stretch', sets: 1, target: hold(30), restSec: 10, section: 'cooldown' },
  )
  if (step.order >= 5) {
    blocks.push({ exerciseId: 'pancake-stretch', sets: 1, target: hold(40), restSec: 10, section: 'cooldown' })
  }

  const budget = ctx.type === 'technique' ? Math.min(20, state.settings.sessionMinutes) : state.settings.sessionMinutes
  const fitted = fitToBudget(blocks, budget)

  return {
    id: `auto-${stepId}-${ctx.type}`,
    name: `${step.name} · ${DAY_LABEL[ctx.type]}`,
    focus: `${ctx.reason}${attempt ? ' An unlock attempt is queued while you are freshest.' : ''}`,
    minutes: estimateMinutes(fitted),
    kind: 'auto',
    blocks: fitted,
  }
}

/** A short max-effort test on the current step's key hold. */
export function maxTestWorkout(stepId: StepId): Workout {
  const step = STEP_BY_ID[stepId]
  return {
    id: `test-${stepId}`,
    name: `Max Test · ${step.name}`,
    focus: `Three fresh max attempts at the ${EXERCISE_BY_ID[step.keyExerciseId].name.toLowerCase()}. Hit ${step.unlockSec}s to unlock the next step.`,
    minutes: 15,
    kind: 'test',
    blocks: [
      { exerciseId: 'wrist-circles', sets: 1, target: reps(10), restSec: 15, section: 'warmup' },
      { exerciseId: 'wrist-rocks', sets: 1, target: reps(8), restSec: 20, section: 'warmup' },
      {
        exerciseId: step.keyExerciseId,
        sets: 3,
        target: hold(step.unlockSec),
        restSec: 180,
        section: 'main',
        note: 'All-out but clean. The timer keeps running — hold as long as form survives.',
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
