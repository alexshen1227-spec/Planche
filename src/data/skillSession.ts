import type { AppState, Block, BlockRole, Section, SkillId, StepDef, StepId, Workout } from '../types'
import { hold, reps } from './blocks'
import { withKitArticles } from './equipment'
import { EXERCISE_BY_ID } from './exercises'
import { STEP_BY_ID, stepAfter, stepBefore } from './progressions'
import { pressingChoiceFor } from './pressing'
import { SKILLS, type BlockSpec, type SkillDef } from './skills'
import { bridgeStatus } from '../lib/bridge'
import { buildPlan, STRATEGY_BY_ID, type CoachPlan, type WarmupLevel } from '../lib/coach'
import { isReviewOnly } from '../lib/progression'
import { ladderStatus } from '../lib/repLadder'
import { adaptiveTarget, workingTargetSec } from '../lib/workingTarget'
import {
  capacityAdjustBlocks,
  estimateMinutes,
  fitToBudget,
  hasEquipmentFor,
  joinWords,
  LIGHT_DOSE_SHARE,
  lightDose,
  mainHoldFloorSets,
  mainHoldSets,
  observedCapacity,
  painSafeRecoveryWorkout,
  resolveEquipment,
  restAfterHold,
  withSides,
} from './workouts'

/**
 * One session for one skill, assembled from that skill's description
 * (`data/skills/*`) and the coach's plan for today.
 *
 * It has the same shape the planche's hand-built session has, because the
 * promise is the same at every skill: warm-up → an unlock attempt or re-test
 * when one is earned → next-shape attempts while the bridge is open → the key
 * hold → the moving version of the step → a second strength movement → support
 * work → balance practice → core → cooldown. The plan decides the dose exactly
 * as it does for the planche — the strategy shapes sets and reps, a fatigue day
 * takes its light share, a measured limiter gets the extra set — and the same
 * equipment, capacity and time-budget passes run last.
 *
 * Called with the athlete *viewed as* the skill (`skillView`), so everything it
 * asks of the state — the step, the working target, the bridge — is this
 * skill's.
 */

/** How a step reads in a title: "Tuck Front Lever", or "Front lever foundations". */
export function stepTitle(step: StepDef): string {
  return step.name === 'Foundations' ? `${SKILLS[step.skill].name} foundations` : step.name
}

/** Sets of the ladder's rung on a ladder day (about five). */
export const LADDER_DAY_SETS = 5

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

/** A spec as a block, with the rest it asks for resolved against the plan. */
function blockFrom(
  spec: BlockSpec,
  section: Section,
  rests: { main: number; accessory: number },
  extra: Partial<Block> = {},
): Block {
  const exercise = EXERCISE_BY_ID[spec.exerciseId]
  const restSec =
    spec.rest === 'main'
      ? Math.max(rests.accessory, Math.round(rests.main * 0.8))
      : spec.rest === undefined || spec.rest === 'accessory'
        ? rests.accessory
        : spec.rest
  return {
    exerciseId: spec.exerciseId,
    sets: spec.sets,
    target: exercise?.type === 'reps' ? reps(spec.amount) : hold(spec.amount),
    restSec,
    section,
    ...(spec.note ? { note: spec.note } : {}),
    ...extra,
  }
}

/**
 * A skill's warm-up at the level the coach asked for. General preparation is in
 * every version — as preparation, not as protection; no trial shows that it
 * prevents injury in this kind of training.
 *
 * `workingSec` scales a primer that rehearses the key hold itself, so a primer
 * is never as long as the work it primes.
 */
export function skillWarmup(skill: SkillId, stepId: StepId, level: WarmupLevel, workingSec?: number): Block[] {
  const program = SKILLS[skill].program
  if (!program) return []
  const rests = { main: 40, accessory: 25 }
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
      { exerciseId: 'cat-cow', sets: 1, target: reps(8), restSec: 10, section: 'warmup' },
    )
  }
  for (const spec of program.warmup) {
    if (level === 'short' && spec.skipWhenShort) continue
    blocks.push(blockFrom(spec, 'warmup', rests))
  }
  const primer = program.primer?.(stepId)
  if (primer) {
    const block = blockFrom(primer, 'warmup', rests)
    // The primer is the key hold itself at the step that introduces it: half
    // the working hold there, so it stays a primer.
    if (workingSec !== undefined && primer.exerciseId === STEP_BY_ID[stepId].keyExerciseId && block.target.kind === 'hold') {
      block.target = hold(clamp(Math.round(workingSec / 2), 2, primer.amount))
    }
    blocks.push(block)
  }
  return blocks
}

/**
 * The moving version of the step to program today: the rung of the skill's rep
 * ladder where it has one, otherwise the step's own twin — one step behind
 * until the hold is half-way to its bar, as on the planche road.
 */
function twinFor(
  state: AppState,
  skill: SkillDef,
  step: StepDef,
  capacity: number | undefined,
  easeDown: boolean,
): { spec: BlockSpec; reason: string; standard?: number; eased?: string } | null {
  if (skill.ladder) {
    const status = ladderStatus(state, skill.id)
    if (!status) return null
    // A maximal press steps down a rung on a day that calls for less.
    const eased = easeDown && status.index > 0 && (EXERCISE_BY_ID[status.rung.exerciseId]?.difficulty ?? 0) >= 4
    const rung = eased ? status.rungs[status.index - 1] : status.rung
    return {
      spec: { exerciseId: rung.exerciseId, sets: 3, amount: rung.startReps, rest: 'main' },
      reason: rung.why,
      standard: rung.standardReps,
      ...(eased ? { eased: status.rung.exerciseId } : {}),
    }
  }
  const own = skill.program?.steps[step.id]?.twin
  if (!own) return null
  const choice = pressingChoiceFor(step.id, capacity)
  const prev = stepBefore(step.id)
  const behind = prev ? skill.program?.steps[prev.id]?.twin : undefined
  let spec = choice.exerciseId === own.exerciseId || !behind ? own : behind
  let eased: string | undefined
  if (easeDown && behind && (EXERCISE_BY_ID[spec.exerciseId]?.difficulty ?? 0) >= 4 && behind.exerciseId !== spec.exerciseId) {
    eased = spec.exerciseId
    spec = behind
  }
  return { spec, reason: choice.reason, ...(eased ? { eased } : {}) }
}

export function skillSession(
  state: AppState,
  planIn?: CoachPlan,
  minutesOverride?: number,
  options: { part?: boolean; now?: number; focus?: 'ladder' } = {},
): Workout {
  const stepId = state.stepId
  const step = STEP_BY_ID[stepId]
  const skill = SKILLS[step.skill]
  const program = skill.program
  const now = options.now ?? Date.now()
  const plan = planIn ?? buildPlan(state, now)
  if (plan.loadPermission === 'none' || !program) {
    return painSafeRecoveryWorkout(plan.signals.lastCheckIn?.regions ?? [])
  }
  const stepProgram = program.steps[stepId] ?? { core: [] }
  const rMain = Math.min(plan.restMainSec, skill.holdRestMaxSec ?? Number.POSITIVE_INFINITY)
  const rAcc = plan.restAccessorySec
  const rests = { main: rMain, accessory: rAcc }
  const vol = plan.volumeFactor
  const scale = (n: number) => Math.max(1, Math.round(n * vol))
  const blocks: Block[] = []
  const adjustments: string[] = []
  const equipment = state.profile.equipment
  const keyExercise = EXERCISE_BY_ID[step.keyExerciseId]
  const keyName = keyExercise?.name.toLowerCase() ?? step.name.toLowerCase()
  const words = skill.words
  // A ladder day: the rep ladder's current rung is the main work and the holds
  // shrink to practice. Only for a skill that has a ladder; the planche never
  // reaches this file, and a request without `focus` takes none of these paths.
  const ladderDay = options.focus === 'ladder' && Boolean(skill.ladder)
  let ladderPlaced = false

  // ——— The key hold's numbers (shared with the coach, so its copy matches) ———
  const baseTarget = adaptiveTarget(state, stepId, now)
  const capacity = observedCapacity(state, stepId)
  const target = workingTargetSec(state, stepId, plan.targetFactor, now)

  // An extended warm-up is a coach safety rail and cannot be disabled by the
  // convenience preference.
  if (state.settings.warmup || plan.warmup === 'extended') {
    blocks.push(...skillWarmup(skill.id, stepId, plan.warmup, target))
  }

  // ——— 1. An unlock attempt or a due re-test, first while fresh ———
  // On a ladder day the rep sets are the day's maximal effort, so the hold's
  // attempt and re-test wait for a regular day.
  const unlockQueued = plan.queueUnlockAttempt && plan.challengeAllowed && !ladderDay
  const retestQueued = !unlockQueued && plan.queueRetest && plan.challengeAllowed && !ladderDay
  const attemptQueued = unlockQueued || retestQueued
  const next = stepAfter(stepId)
  const reviewOnly = isReviewOnly(step.keyExerciseId)
  const evidence = reviewOnly
    ? 'film it and review the replay against the checklist'
    : 'film it, and pass both form confirmations'
  if (attemptQueued) {
    blocks.push({
      exerciseId: step.keyExerciseId,
      sets: 1,
      target: hold(step.unlockSec),
      restSec: 180,
      section: 'main',
      role: 'attempt',
      ...(unlockQueued ? {} : { retest: true }),
      note: unlockQueued
        ? next
          ? `Unlock attempt — you're within reach. Hold ${step.unlockSec}s clean, ${evidence}. Stop the moment the shape goes; a stopped attempt is still useful.`
          : `Bar attempt — you're within reach of ${words.summit}'s ${step.unlockSec}s. Hold it clean, ${evidence}. Stop the moment the shape goes; a stopped attempt is still useful.`
        : `Max clean hold — the coach re-measures your hold today. Hold as long as the shape stays clean and stop the moment it starts to go: every working target is set from this number. ${
            next
              ? `Filmed and clean at ${step.unlockSec}s, it unlocks the step like any attempt.`
              : `Filmed and clean at ${step.unlockSec}s, it meets ${words.summit}'s bar.`
          }`,
    })
  }

  // ——— 2. The bridge to the next step ———
  const easyDay = plan.strategy === 'technique' || plan.dayType === 'technique' || plan.dayType === 'deload'
  const bridge = bridgeStatus(state, stepId)
  const bridging = Boolean(bridge?.open) && !easyDay && plan.challengeAllowed && !attemptQueued && !ladderDay
  // The next shape must be trainable with the athlete's kit to be bridged to.
  const bridgeNext = bridging && bridge && hasEquipmentFor(bridge.next.keyExerciseId, equipment) ? bridge.next : undefined
  if (bridgeNext && bridge) {
    const nextExercise = EXERCISE_BY_ID[bridgeNext.keyExerciseId]
    const nextReview = isReviewOnly(bridgeNext.keyExerciseId)
    blocks.push({
      exerciseId: bridgeNext.keyExerciseId,
      sets: nextExercise.perSide ? 2 : 3,
      target: hold(bridgeNext.startSec),
      restSec: restAfterHold(Math.max(rMain, 120), bridgeNext.startSec),
      section: 'main',
      role: 'bridge',
      note: nextReview
        ? `Next shape: ${nextExercise.name.toLowerCase()} practice, first while you are fresh. Stay as long as it is controlled. Film one and review it against the checklist: ${bridgeNext.startSec}s reviewed opens the step early once your ${keyName} reaches ${Math.round(bridge.promotionCurrentSec)}s.`
        : `Next shape, first while you are fresh: hold the ${nextExercise.name.toLowerCase()} as long as it stays clean and come down at the first loss of shape — a one-second clean hold beats five ugly ones. ${bridgeNext.startSec}s${nextExercise.perSide ? ' each side' : ''} clean on camera opens the step early once your ${keyName} is verified past ${Math.round(bridge.promotionCurrentSec)}s; the call comes when it will count.`,
    })
  }

  // ——— 3. The key hold ———
  const strategyNote =
    plan.strategy === 'technique'
      ? 'Easy targets today — careful positions, no grinding.'
      : plan.strategy === 'intensity'
        ? 'Harder clean holds. Rest fully and stop the instant the shape goes.'
        : plan.strategy === 'density'
          ? 'Short rests on purpose, but never chase the timer past the first loss of shape.'
          : 'Come down at the target call, or sooner at the first loss of shape. Quality over seconds.'
  // Whether this hold has ever been logged: "your recent holds" is not a thing
  // to say about a skill added this morning.
  const heldBefore = state.sessions.some((session) =>
    session.sets.some((set) => set.exerciseId === step.keyExerciseId && set.value > 0),
  )
  const prev = stepBefore(stepId)
  const shortNote =
    target < 3
      ? ` ${heldBefore ? 'Your recent holds are short' : 'You said this hold is short for you right now'}, so these are too — that is a real dose, not a failure. If getting into the position is the struggle rather than strength, ${
          prev ? `practising ${EXERCISE_BY_ID[prev.keyExerciseId].name.toLowerCase()}` : 'an easier version'
        } is worth reviewing with your replay.`
      : ''
  const placementNote =
    plan.signals.totalSessions === 0 && state.assessment?.answers[step.keyExerciseId] === 0
      ? ' You said you cannot hold this yet: take the easiest version you can keep clean so the target is holdable, and build from there.'
      : ''
  const lockoutCue =
    plan.accessoryEmphasis === 'lockout' && skill.straightArm
      ? ' Lock the elbows before you take the position; the moment they soften, the set is over.'
      : ''
  const fatigueDay = plan.dayType === 'technique' || plan.dayType === 'deload'
  const maximalBridge = Boolean(bridgeNext) && !isReviewOnly(bridgeNext!.keyExerciseId)
  const doseArgs = [baseTarget, plan.setsDelta, vol * (fatigueDay ? LIGHT_DOSE_SHARE : 1), attemptQueued || maximalBridge] as const
  const sideLess = keyExercise?.perSide ? 1 : 0
  // A ladder day keeps the hold as short practice: two sets, no reach.
  const mainSets = ladderDay ? 2 : Math.max(2, mainHoldSets(...doseArgs, skill.holdAggregateSec) - sideLess)
  const reach = ladderDay ? 0 : Math.max(0, mainSets - Math.max(2, mainHoldFloorSets(...doseArgs) - sideLess))
  blocks.push({
    exerciseId: step.keyExerciseId,
    sets: mainSets,
    ...(reach > 0 ? { reach } : {}),
    target: hold(target),
    restSec: restAfterHold(rMain, target),
    section: 'main',
    role: 'skill',
    note: `${strategyNote}${lockoutCue}${shortNote}${placementNote}${bridgeNext ? (stepProgram.bridgeCue ?? '') : ''}`,
  })

  const light = fatigueDay
  const lightTag = light ? { light: true as const } : {}
  const emphasis = plan.accessoryEmphasis
  const push = (spec: BlockSpec, section: Section, role: BlockRole, sets: number, extra: Partial<Block> = {}) =>
    blocks.push({ ...blockFrom(spec, section, rests, { role, ...extra }), sets })

  // ——— 4. The drill that teaches the change to the next step ———
  if (bridgeNext && stepProgram.transition) {
    push(stepProgram.transition, 'strength', 'bridge', stepProgram.transition.sets)
  }

  // ——— 5. The shape with help ———
  if (stepProgram.assisted && hasEquipmentFor(stepProgram.assisted.exerciseId, equipment) && plan.strategy !== 'intensity') {
    push(stepProgram.assisted, 'strength', 'assisted', light ? 2 : stepProgram.assisted.sets, lightTag)
  }

  // ——— 6. A back-off dose on the position already owned ———
  // From the third step up: below that the step before is foundation work the
  // support slot already carries.
  if (prev && step.order >= 2 && (plan.strategy === 'balanced' || plan.strategy === 'volume') && !easyDay) {
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

  // A second loaded session on the same day is skill work only.
  const skillOnly = plan.dayType === 'technique' && plan.signals.daysSinceLoaded === 0
  if (skillOnly) {
    const drill = stepProgram.balance ?? stepProgram.support
    if (drill) {
      push(drill, 'strength', stepProgram.balance ? 'balance' : 'straight-arm', 2, {
        light: true,
        note: `${drill.note ?? ''} Light and crisp — no loaded ${words.strength} in a second session today.`.trim(),
      })
    }
  } else {
    // ——— 7. The moving version of the step ———
    const easeForJoints = plan.loadPermission === 'reduced'
    const twin = twinFor(state, skill, step, capacity, easeForJoints || light)
    if (twin) {
      const exercise = EXERCISE_BY_ID[twin.spec.exerciseId]
      const maximal = (exercise?.difficulty ?? 0) >= 4
      const baseReps = twin.spec.amount
      const targetReps = plan.strategy === 'intensity' ? Math.max(1, baseReps - (maximal ? 1 : 2)) : baseReps
      const easedNote = twin.eased
        ? easeForJoints
          ? ` ${EXERCISE_BY_ID[twin.eased].name} is set aside today for the joint you flagged — stop any set that makes it worse.`
          : ` ${EXERCISE_BY_ID[twin.eased].name} waits for a full day; today is lighter.`
        : ''
      const standardNote =
        twin.standard !== undefined && !twin.eased
          ? ` One set of ${twin.standard} full rep${twin.standard === 1 ? '' : 's'} — filmed, rated Clean and checked on the replay — opens the next rung.`
          : ''
      const label = twin.spec.note ?? (skill.ladder ? `${skill.ladder.name} line.` : 'The moving version of this step.')
      const rungBlock: Block = {
        exerciseId: twin.spec.exerciseId,
        sets: light ? 2 : ladderDay ? scale(LADDER_DAY_SETS) : scale((plan.strategy === 'volume' ? 4 : 3) + (emphasis === 'pressing' ? 1 : 0)),
        target: exercise?.type === 'hold' ? hold(targetReps) : reps(targetReps),
        restSec: maximal || plan.strategy === 'intensity' ? Math.max(rAcc, Math.round(rMain * 0.8)) : plan.strategy === 'density' ? Math.min(60, rAcc) : rAcc,
        section: 'strength',
        role: 'press',
        // Emphasis keeps the rung through the budget fit: a ladder day without
        // its ladder is not one.
        ...(light ? { light: true } : ladderDay || emphasis === 'pressing' ? { emphasis: true } : {}),
        note: `${label} ${twin.reason}${easedNote}${standardNote}${
          maximal && !twin.eased ? ' Can’t finish a rep yet? Lower slowly over about three seconds, reset, and log the reps you completed.' : ''
        }`,
      }
      if (ladderDay) {
        // Right after the warm-up, while fresh.
        const first = blocks.findIndex((b) => b.section !== 'warmup')
        blocks.splice(first < 0 ? blocks.length : first, 0, rungBlock)
        ladderPlaced = true
      } else {
        blocks.push(rungBlock)
      }
    }

    // ——— 8. A second strength movement ———
    if (
      stepProgram.strength &&
      !light &&
      stepProgram.strength.exerciseId !== twin?.spec.exerciseId &&
      ((plan.strategy !== 'intensity' && plan.strategy !== 'density') || emphasis === 'pressing')
    ) {
      push(stepProgram.strength, 'strength', 'pressing', scale(stepProgram.strength.sets + (plan.strategy === 'volume' ? 0 : 0)), {
        ...(emphasis === 'pressing' ? { emphasis: true } : {}),
      })
    }

    // ——— 9. Support work ———
    if (stepProgram.support) {
      const limiter = emphasis === 'lockout' || emphasis === 'scapula'
      const base = plan.strategy === 'intensity' || plan.strategy === 'density' ? Math.min(2, stepProgram.support.sets) : stepProgram.support.sets
      push(stepProgram.support, 'strength', 'straight-arm', light ? 2 + (limiter ? 1 : 0) : scale(base + (limiter ? 1 : 0)), {
        ...(limiter ? { emphasis: true } : {}),
        ...lightTag,
        ...(plan.strategy === 'density' ? { restSec: Math.min(45, rAcc) } : {}),
      })
    }

    // ——— 10. Balance or position practice ———
    if (stepProgram.balance) {
      const limiter = emphasis === 'balance'
      const block = blockFrom(stepProgram.balance, 'strength', rests, {
        role: 'balance',
        ...(limiter ? { emphasis: true } : {}),
        ...lightTag,
      })
      block.sets = light ? 2 : scale(stepProgram.balance.sets + (limiter ? 1 : 0))
      // Balance practice is best done fresh: it goes straight after the key hold.
      blocks.splice(blocks.findIndex((b) => b.role === 'skill') + 1, 0, block)
    }
  }

  // ——— 11. Core ———
  const [firstCore, ...moreCore] = stepProgram.core
  if (emphasis === 'core') {
    for (const spec of stepProgram.core) {
      push(spec, 'core', 'core', scale(spec.sets + 1), {
        emphasis: true,
        note: spec.note ?? 'Body line is the limiter — lock ribs, pelvis and legs into one unit.',
      })
    }
  } else if (firstCore) {
    push(firstCore, 'core', 'core', plan.strategy === 'volume' ? scale(firstCore.sets + 1) : scale(firstCore.sets), {
      ...lightTag,
      ...(plan.strategy === 'density' ? { restSec: Math.min(40, rAcc) } : {}),
    })
    const second = moreCore[0]
    if (second && !easyDay && plan.strategy !== 'density' && plan.strategy !== 'intensity') {
      push(second, 'core', 'core', scale(second.sets))
    }
  }

  // ——— 12. Cooldown ———
  for (const spec of program.cooldown) blocks.push(blockFrom(spec, 'cooldown', rests))
  if (stepProgram.mobility) {
    blocks.push(blockFrom(stepProgram.mobility, 'cooldown', rests, { role: 'mobility' }))
  }

  // Kit first (so a substitute is sized like everything else), then capacity,
  // then a light day's share of the dose that capacity chose.
  const kit = resolveEquipment(blocks, equipment)
  const sized = capacityAdjustBlocks(state, kit.blocks, now)
  const lightened = sized.blocks.map((b) => (b.light ? lightDose(b) : b))
  if (lightened.some((b) => b.light)) {
    adjustments.push(
      `Easy day: ${words.strength} and support work at about ${Math.round(LIGHT_DOSE_SHARE * 100)}% of your usual dose — keep the pattern, leave the fatigue. These sets do not change your accessory targets.`,
    )
  }

  const baseBudget = light ? Math.min(30, state.settings.sessionMinutes) : state.settings.sessionMinutes
  // One part of a mixed session is built at whatever it is given.
  const budget =
    options.part && minutesOverride !== undefined
      ? minutesOverride
      : minutesOverride !== undefined
        ? Math.min(baseBudget, Math.max(8, minutesOverride))
        : baseBudget
  const fit = fitToBudget(
    withSides(lightened),
    budget,
    emphasis === 'core',
    state.settings.stopLatencySec,
    state.settings.phoneWithinReach,
  )
  const fitted = fit.blocks.map((b) => ({ ...b, skill: skill.id }))

  const present = new Set(fitted.filter((b) => b.section !== 'warmup').map((b) => b.exerciseId))
  // What the athlete's kit left out, said once per missing piece rather than
  // once per movement — a front lever session without a bar listed eight.
  const needs = [...new Set(kit.left.map((entry) => entry.needs))]
  for (const need of needs) {
    const names = kit.left.filter((entry) => entry.needs === need).map((entry) => entry.name.toLowerCase())
    // `need` arrives as bare kit names; "it needs pull-up bar" was the result.
    adjustments.push(
      `Left out — ${names.length === 1 ? 'it needs' : 'they need'} ${withKitArticles(need)}: ${joinWords(names)}.`,
    )
  }
  kit.notes.forEach((note, i) => {
    const subject = kit.about[i]
    if (subject !== undefined && present.has(subject)) adjustments.push(note)
  })
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
      options.part
        ? `Left out of the ${skill.name.toLowerCase()} part to make room for today's other skills: ${joinWords(droppedNames)}. They come back on a ${skill.name.toLowerCase()}-only day.`
        : `Left out to fit ${budget} minutes: ${joinWords(droppedNames)}. ${
            minutesOverride !== undefined ? 'They come back on a full-length day.' : 'A longer session length in Settings keeps them.'
          }`,
    )
  }

  const fittedMinutes = estimateMinutes(fitted, state.settings.stopLatencySec, state.settings.phoneWithinReach)
  const shortened = minutesOverride !== undefined && fittedMinutes < baseBudget && !options.part
  const strategy = STRATEGY_BY_ID[plan.strategy]
  const strategyContext = `${strategy.blurb} ${plan.dayReason}`
  const title = stepTitle(step)
  // The key hold itself needs kit the athlete has not listed: there is no
  // practising the skill today, and the session must not be named, described
  // or purposed as if there were. It once read "One-Leg Front Lever · Balanced
  // — practise one-leg front lever at a working dose" over a session of arm
  // circles, a hollow hold and two stretches.
  if (!hasEquipmentFor(step.keyExerciseId, equipment)) {
    const waitingFor = skill.requiresNote ?? `The ${skill.holdName} needs kit that is not on your list.`
    return {
      id: `auto-${stepId}-waiting`,
      name: `${skill.name} · waiting for kit`,
      focus: `${waitingFor} Until it is on your list in Settings → Equipment, a session cannot practise ${keyName} — this is the support work that needs none of it.`,
      minutes: fittedMinutes,
      kind: 'auto',
      blocks: fitted,
      purpose: `Support work only — ${keyName} is waiting for kit.`,
      ...(adjustments.length ? { adjustments } : {}),
    }
  }
  return {
    id: `auto-${stepId}-${plan.dayType}-${plan.strategy}${ladderPlaced ? '-ladder' : ''}${shortened ? `-${budget}m` : ''}`,
    name: `${ladderPlaced && skill.ladder ? `${skill.ladder.name} day` : title} · ${strategy.name}${shortened ? ' · Short' : ''}`,
    focus: shortened
      ? `Trimmed to about ${fittedMinutes} minutes${
          fittedMinutes > budget ? ' — as short as this day gets without cutting the work that matters' : ''
        }. The warm-up and your main ${keyName} are intact; accessories came off first, because a short session you actually do beats a full one you skip. ${strategyContext}`
      : plan.limiter
        ? `${strategyContext} Current limiter: ${plan.limiter.label}. ${plan.limiter.prescription}`
        : strategyContext,
    minutes: fittedMinutes,
    kind: 'auto',
    blocks: fitted,
    strategy: plan.strategy,
    baseTargetSec: baseTarget,
    ...(plan.dayType === 'deload' ? { plannedDeload: true } : {}),
    purpose: ladderPlaced
      ? `Work the ${skill.ladder?.name.toLowerCase()} line first, with ${keyName} kept as short practice.`
      : skillOnly
      ? `Practise ${keyName} at an easy dose, with light skill work only — no loaded ${words.strength} in a second session today.`
      : light
        ? `Practise ${keyName} at an easy dose, with the ${words.strength} and support work kept light.`
        : easyDay
          ? `Practise ${keyName} at easier targets so the position stays clean, then build the strength behind it as usual.`
          : `Practise ${keyName} at a working dose, then build the ${words.strength} strength behind it.`,
    ...(adjustments.length ? { adjustments } : {}),
  }
}
