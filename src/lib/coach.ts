import type { AppState, CheckIn, Session, StrategyId } from '../types'
import { STEP_BY_ID } from '../data/progressions'
import {
  readSignals,
  observedRestSec,
  median,
  strainOf,
  trustedCameraEvidence,
  LOADED_STRAIN,
  type Signals,
} from './signals'
import { qualifyingProgress, qualifyingSessionValue } from './progression'

/**
 * The coach is an on-device optimizer, not a chatbot.
 *
 * It treats "how should today's session be shaped?" as a multi-armed bandit.
 * Each arm is a training strategy; the reward is how fast you actually moved
 * toward your next unlock in the two weeks after using it. It picks with
 * UCB1, so under-tested strategies get explored and the winner gets exploited.
 * Everything is derived from your logged sessions — nothing is stored, so
 * deleting or importing history recomputes the coach honestly.
 */

export interface StrategyDef {
  id: StrategyId
  name: string
  blurb: string
  /** Shaping applied to the main isometric block. */
  setsDelta: number
  targetFactor: number
  restFactor: number
}

export const STRATEGIES: StrategyDef[] = [
  {
    id: 'balanced',
    name: 'Balanced',
    blurb: 'Moderate sets at your working target — the reliable default.',
    setsDelta: 0,
    targetFactor: 1,
    restFactor: 1,
  },
  {
    id: 'volume',
    name: 'High volume',
    blurb: 'More sets at a slightly easier hold. Builds tendon capacity.',
    setsDelta: 2,
    targetFactor: 0.85,
    restFactor: 1,
  },
  {
    id: 'intensity',
    name: 'High intensity',
    blurb: 'Fewer, harder holds close to your limit. Sharpens max strength.',
    setsDelta: -1,
    targetFactor: 1.25,
    restFactor: 1.2,
  },
  {
    id: 'density',
    name: 'Short rests',
    blurb: 'Same work, less recovery between sets. Trains fatigue resistance.',
    setsDelta: 1,
    targetFactor: 0.9,
    restFactor: 0.65,
  },
  {
    id: 'technique',
    name: 'Technique',
    blurb: 'Easy targets, perfect positions. Cheap on joints, big on skill.',
    setsDelta: 1,
    targetFactor: 0.7,
    restFactor: 0.85,
  },
]

export const STRATEGY_BY_ID: Record<StrategyId, StrategyDef> = Object.fromEntries(
  STRATEGIES.map((s) => [s.id, s]),
) as Record<StrategyId, StrategyDef>

const DAY = 86_400_000
/** How long a session can plausibly be credited for the next result. */
const ATTRIBUTION_DAYS = 10
/** Exploration weight, scaled to the reward range. */
const UCB_C = 0.06

export interface ArmStats {
  id: StrategyId
  /** Sessions in which this strategy was actually attempted on this step. */
  attempts: number
  n: number
  /** Shrunk toward the overall average — see armStats. */
  mean: number
  /** Unshrunk average, for honest display of what was measured. */
  rawMean: number
  /** Mean expressed as seconds gained per week on the step's key hold. */
  secPerWeek: number
}

/**
 * Strength of the pull toward the overall average. With k = 2, a strategy
 * needs a couple of measured sessions before its own result dominates.
 */
const SHRINKAGE_K = 2

export interface CoachPick {
  strategy: StrategyId
  reason: string
  exploring: boolean
}

/**
 * Reward for one strategy session: change from a robust pre-session baseline
 * to the next one or two comparable sessions. The strategy session's own best
 * is deliberately excluded: intensity days prescribe higher targets than
 * technique days, so comparing each arm to itself created regression-to-mean
 * bias rather than learning.
 */
export function rewardFor(sessions: Session[], session: Session): number | null {
  const step = STEP_BY_ID[session.stepId]
  if (!step) return null
  const qualifyingBest = (candidate: Session) => qualifyingSessionValue(candidate, session.stepId)
  if (qualifyingBest(session) <= 0) return null
  const prior = sessions
    .filter((s) => s.startedAt < session.startedAt && qualifyingBest(s) > 0)
    .slice(-3)
    .map(qualifyingBest)
  const follow = sessions
    .filter(
      (s) =>
        s.startedAt > session.startedAt &&
        s.startedAt <= session.startedAt + ATTRIBUTION_DAYS * DAY &&
        qualifyingBest(s) > 0,
    )
    .slice(0, 2)
  const before = median(prior)
  const after = median(follow.map(qualifyingBest))
  if (prior.length < 2 || before === null || after === null || follow.length === 0) return null

  const days = Math.max(1, (follow[follow.length - 1].startedAt - session.startedAt) / DAY)
  let reward = ((after - before) / days) * 7 / step.unlockSec

  // Clearing the bar is the whole point — weight it.
  if (before < step.unlockSec && after >= step.unlockSec) reward += 0.15
  // Grinding at RPE 9+ and going nowhere is a cost, not a neutral outcome.
  if ((session.rpe ?? 0) >= 9 && after <= before) reward -= 0.03

  // Seconds gained while the camera watched the position decay are borrowed,
  // not earned. Positive rewards are scaled by the filmed clean share of the
  // strategy session itself; unfilmed sessions keep full credit — a missing
  // camera is not evidence of bad form.
  const filmedRatios = session.sets
    .filter((x) => x.section === 'main' && trustedCameraEvidence(x))
    .map((x) => x.form?.auto?.cleanRatio)
    .filter((r): r is number => r !== undefined)
  const filmedClean = median(filmedRatios)
  if (reward > 0 && filmedClean !== null && filmedRatios.length >= 2) {
    reward *= 0.6 + 0.4 * Math.min(1, filmedClean)
  }

  // A strategy that precedes joint complaints is expensive whatever the
  // stopwatch says — the next check-in in the window gets a vote.
  const echo = follow.find((s) => s.checkIn && s.checkIn.joints !== 'good')?.checkIn
  if (echo) reward -= echo.joints === 'pain' ? 0.1 : 0.04

  return Math.max(-0.2, Math.min(0.6, reward))
}

/** Per-strategy performance, derived fresh from history. */
export function armStats(state: AppState): ArmStats[] {
  const sessions = [...state.sessions].sort((a, b) => a.startedAt - b.startedAt)
  const acc: Record<StrategyId, { attempts: number; n: number; total: number }> = {
    balanced: { attempts: 0, n: 0, total: 0 },
    volume: { attempts: 0, n: 0, total: 0 },
    intensity: { attempts: 0, n: 0, total: 0 },
    density: { attempts: 0, n: 0, total: 0 },
    technique: { attempts: 0, n: 0, total: 0 },
  }
  for (const s of sessions) {
    if (!s.strategy || !acc[s.strategy] || s.stepId !== state.stepId) continue
    if (qualifyingSessionValue(s, state.stepId) <= 0) continue
    acc[s.strategy].attempts += 1
    const r = rewardFor(sessions, s)
    if (r === null) continue
    acc[s.strategy].n += 1
    acc[s.strategy].total += r
  }
  const unlockSec = STEP_BY_ID[state.stepId]?.unlockSec ?? 20

  // Isometric results are noisy, so a strategy with one lucky session must not
  // outrank one with five solid ones. Each arm's average is pulled toward the
  // overall average in proportion to how little evidence supports it
  // (empirical-Bayes shrinkage); evidence earns influence.
  const totalN = STRATEGIES.reduce((t, d) => t + acc[d.id].n, 0)
  const grandTotal = STRATEGIES.reduce((t, d) => t + acc[d.id].total, 0)
  const grandMean = totalN > 0 ? grandTotal / totalN : 0

  return STRATEGIES.map((def) => {
    const a = acc[def.id]
    const rawMean = a.n > 0 ? a.total / a.n : 0
    const mean = a.n > 0 ? (a.total + SHRINKAGE_K * grandMean) / (a.n + SHRINKAGE_K) : 0
    return { id: def.id, attempts: a.attempts, n: a.n, mean, rawMean, secPerWeek: rawMean * unlockSec }
  })
}

/**
 * UCB1 selection: untested strategies are tried first (in listed order),
 * then the arm with the best optimistic estimate wins.
 */
export function pickStrategy(state: AppState): CoachPick {
  const stats = armStats(state)
  const totalN = stats.reduce((t, s) => t + s.attempts, 0)

  const untested = stats.find((s) => s.attempts === 0)
  if (untested) {
    return {
      strategy: untested.id,
      reason:
        totalN === 0
          ? 'Starting with a baseline so it can measure everything else against it.'
          : `Trying ${STRATEGY_BY_ID[untested.id].name.toLowerCase()} — it hasn't been tested on you yet.`,
      exploring: true,
    }
  }

  let best = stats[0]
  let bestScore = -Infinity
  for (const s of stats) {
    const score = s.mean + UCB_C * Math.sqrt(Math.log(totalN + 1) / Math.max(1, s.attempts))
    if (score > bestScore) {
      bestScore = score
      best = s
    }
  }
  const ranked = [...stats].sort((a, b) => b.mean - a.mean)
  const exploring = best.id !== ranked[0].id
  const name = STRATEGY_BY_ID[best.id].name
  return {
    strategy: best.id,
    reason: exploring
      ? `Re-testing ${name.toLowerCase()} to keep its read on you current.`
      : best.secPerWeek > 0.05
        ? `${name} has produced your fastest gains: ${formatRate(best.secPerWeek)}.`
        : `${name} is holding up best while your numbers are flat — keeping the stimulus steady.`,
    exploring,
  }
}

export function formatRate(secPerWeek: number): string {
  if (secPerWeek < -0.05) return `${secPerWeek.toFixed(1)}s/week`
  if (secPerWeek <= 0.05) return 'no measurable gain'
  return `+${secPerWeek.toFixed(1)}s/week`
}

/** How many evaluated sessions the coach has to learn from. */
export function coachConfidence(state: AppState): { evaluated: number; tested: number } {
  const stats = armStats(state)
  return {
    evaluated: stats.reduce((t, s) => t + s.n, 0),
    tested: stats.filter((s) => s.n > 0).length,
  }
}

// ————————————————————————————— The planner —————————————————————————————

export type DayType = 'push' | 'build' | 'technique' | 'deload' | 'recovery'
export type WarmupLevel = 'short' | 'standard' | 'extended'

export interface CoachDecision {
  text: string
  kind: 'info' | 'good' | 'warn'
}

export interface CoachLimiter {
  label: string
  evidence: string
  prescription: string
}

export interface CoachPlan {
  dayType: DayType
  dayReason: string
  strategy: StrategyId
  strategyReason: string
  setsDelta: number
  targetFactor: number
  restMainSec: number
  restAccessorySec: number
  warmup: WarmupLevel
  queueUnlockAttempt: boolean
  suggestMaxTest: boolean
  accessoryEmphasis: 'pressing' | 'scapula' | 'balance' | 'core' | 'none'
  /** Best-supported current bottleneck, if enough history exists to name one. */
  limiter: CoachLimiter | null
  volumeFactor: number
  /** Whether loaded upper-body planche work is appropriate today. */
  loadPermission: 'normal' | 'reduced' | 'none'
  askCheckIn: boolean
  decisions: CoachDecision[]
  signals: Signals
}

/** Hard limits. Nothing the planner does is allowed outside these. */
const LIMITS = {
  targetFactor: [0.6, 1.3] as const,
  setsDelta: [-2, 3] as const,
  restMain: [60, 240] as const,
  restAccessory: [30, 150] as const,
  volume: [0.5, 1] as const,
}

const clampTo = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v))

/**
 * Rest prescription that learns from what actually works for this athlete:
 * it starts from their setting, applies the strategy's shape, then leans
 * partway toward the rest they genuinely take on productive days.
 */
function smartRest(state: AppState, restFactor: number, sig: Signals): number {
  const step = STEP_BY_ID[state.stepId]
  let rest = state.settings.restMainSec * restFactor

  const observed = median(
    state.sessions
      .map((s) => observedRestSec(s, step.keyExerciseId, state.settings.stopLatencySec))
      .filter((r): r is number => r !== null)
      .slice(-6),
  )
  if (observed !== null) rest = rest * 0.7 + observed * 0.3

  if ((sig.lastLoadedRpe ?? 0) >= 9) rest *= 1.2
  if (sig.lastCheckIn?.energy === 'tired') rest *= 1.1
  if (sig.mainHitRate !== null && sig.mainHitRate < 0.5) rest *= 1.15

  return Math.round(clampTo(rest, LIMITS.restMain) / 5) * 5
}

/**
 * The full session plan: bandit choice for stimulus shape, signal-driven
 * adjustments, then safety rails that always get the last word.
 */
export function buildPlan(state: AppState, now = Date.now(), freshCheckIn?: CheckIn): CoachPlan {
  const sig = readSignals(state, now, freshCheckIn)
  const step = STEP_BY_ID[state.stepId]
  const pick = pickStrategy(state)
  const decisions: CoachDecision[] = []

  let strategy = pick.strategy
  let dayType: DayType = 'build'
  let dayReason = 'Build day — steady volume at working intensity.'
  let targetFactor = 1
  let volumeFactor = 1
  let warmup: WarmupLevel = 'standard'
  let queueUnlockAttempt = false
  let accessoryEmphasis: CoachPlan['accessoryEmphasis'] = 'none'
  let limiter: CoachLimiter | null = null
  let loadPermission: CoachPlan['loadPermission'] = 'normal'
  let strategyOverrideReason: string | null = null

  // ——— Recovery state sets the day's character ———
  // Judged on training LOAD, not on whether any session existed: a ten-minute
  // wrist routine yesterday neither blocks a push day nor grants one, and a
  // heavy template session counts even though the bandit never shaped it.
  if (sig.totalSessions === 0) {
    dayType = 'build'
    dayReason = 'Baseline session — start controlled so the coach can learn your current capacity.'
  } else if (sig.daysSinceLoaded === 0) {
    dayType = 'technique'
    dayReason = 'Second loaded session today — skill work only, tendons keep score.'
  } else if (sig.readinessLoad !== null && sig.readinessLoad > 1.5) {
    dayType = 'technique'
    dayReason =
      'Your recent training load is running well above your own four-week normal — today recovers it into strength instead of stacking more on top.'
  } else if (sig.daysSinceLoaded === 1 && (sig.lastLoadedRpe ?? 0) >= 9) {
    dayType = 'technique'
    dayReason = 'Your last hard session hit RPE 9+ — today turns that into strength instead of fatigue.'
  } else if (sig.daysSinceLoaded >= 2) {
    dayType = 'push'
    dayReason =
      sig.restDays < sig.daysSinceLoaded
        ? `No hard training in ${sig.daysSinceLoaded} days (light work doesn't count against you) — you're fresh, so today pushes.`
        : `${sig.daysSinceLoaded} rest day${sig.daysSinceLoaded > 1 ? 's' : ''} banked — you're fresh, so today pushes.`
  } else if (sig.readinessLoad !== null && sig.readinessLoad < 0.6 && sig.daysSinceLoaded >= 1) {
    dayType = 'push'
    dayReason = 'Your load has been light lately and yesterday was easy — fresh enough to push.'
  }

  // ——— Deload is scheduled, not earned ———
  if (sig.deloadActive || (sig.weeksSinceDeload >= 5 && sig.totalSessions >= 12)) {
    dayType = 'deload'
    dayReason = sig.deloadActive
      ? 'Your deload week is active — keep the whole week deliberately light so fatigue can clear.'
      : `${sig.weeksSinceDeload} weeks without an easy week — this one is deliberately light. Strength lands during recovery.`
    decisions.push({ text: 'Deload scheduled — adaptation happens on easy weeks.', kind: 'info' })
  }

  // ——— Performance-driven target nudges ———
  // Intent is recorded now but only explained once the rails have had their
  // say — otherwise the coach claims to be pushing on a day it scaled back.
  let targetIntent: 'up' | 'down' | 'steady' = 'steady'
  if (sig.noisy) {
    // Chasing noise is how a coach ruins a program. Hold steady instead.
    targetFactor = 1
    decisions.push({
      text: `Your last few holds swung ±${Math.round((sig.variability ?? 0) * 100)}% — that reads as measurement noise, not a trend. Holding targets steady until it settles.`,
      kind: 'warn',
    })
  } else if (sig.mainHitRate !== null) {
    // Two sets is thin evidence; four is reasonable. Scale the size of the
    // change to how much data stands behind it rather than reacting fully to
    // a single lucky or unlucky session.
    const confidence = Math.min(1, sig.mainSetCount / 4)
    const step = 0.1 * confidence
    if (sig.mainHitRate >= 0.8) {
      targetFactor = 1 + step
      targetIntent = 'up'
    } else if (sig.mainHitRate < 0.5) {
      targetFactor = 1 - step
      targetIntent = 'down'
    }
  }

  // Form outranks the clock. Seconds bought with bent arms are not progress,
  // they are a slower road and a louder injury risk.
  const FORM_LABEL: Record<string, string> = {
    arms: 'elbows bending',
    scapula: 'losing protraction',
    shrug: 'shoulders shrugging up',
    pike: 'hips riding too high',
    sag: 'hips dropping',
    closed: 'hips not opening enough',
    knees: 'knees bending',
    lean: 'not leaning far enough forward',
    twist: 'twisting — one side sitting higher',
    narrow: 'a straddle that is too narrow',
    hips: 'hips sagging',
    level: 'body not level',
  }
  const LIMITER_BY_ISSUE: Record<
    string,
    {
      label: string
      emphasis: CoachPlan['accessoryEmphasis']
      prescription: string
    }
  > = {
    arms: {
      label: 'Straight-arm strength',
      emphasis: 'pressing',
      prescription: 'Straight-arm pressing strength gets the extra work; every main hold still ends before elbow lock goes.',
    },
    scapula: {
      label: 'Scapular control',
      emphasis: 'scapula',
      prescription: 'Scapular push-ups and controlled leans reinforce pushing the floor away under load.',
    },
    shrug: {
      label: 'Scapular control',
      emphasis: 'scapula',
      prescription: 'Scapular push-ups and controlled leans reinforce a strong, non-shrugged shoulder position.',
    },
    pike: {
      label: 'Body-line strength',
      emphasis: 'core',
      prescription: 'Hollow-body and posterior-chain work target the line that is folding under fatigue.',
    },
    sag: {
      label: 'Body-line strength',
      emphasis: 'core',
      prescription: 'Hollow-body and posterior-chain work target the line that is dropping under fatigue.',
    },
    closed: {
      label: 'Hip opening / compression',
      emphasis: 'core',
      prescription: 'Compression and body-line work target the hip position that is closing under load.',
    },
    knees: {
      label: 'Whole-body tension',
      emphasis: 'core',
      prescription: 'Body-line work reinforces active leg tension without adding more max-effort attempts.',
    },
    hips: {
      label: 'Body-line strength',
      emphasis: 'core',
      prescription: 'Hollow-body and posterior-chain work target the line that is dropping under fatigue.',
    },
    level: {
      label: 'Body-line control',
      emphasis: 'core',
      prescription: 'Body-line work reinforces a level hip and shoulder position.',
    },
    lean: {
      label: 'Forward-lean control',
      emphasis: 'balance',
      prescription: 'Low-fatigue balance and lean practice build confidence over the hands before more load is added.',
    },
    twist: {
      label: 'Symmetry',
      emphasis: 'balance',
      prescription: 'Controlled balance work and weak-side-first practice target the recurring rotation.',
    },
    narrow: {
      label: 'Position control',
      emphasis: 'balance',
      prescription: 'Low-fatigue position practice gets priority over more grinding.',
    },
  }
  let formRepairNeeded = false
  if (sig.formDegrading) {
    targetFactor = Math.min(targetFactor, 0.9)
    targetIntent = 'steady'
    formRepairNeeded = true
    decisions.push({
      text: 'Your holds are getting longer but your own form ratings are getting worse — that is a stall dressed up as progress. Backing the target off to rebuild the position.',
      kind: 'warn',
    })
  } else if (sig.formCleanRate !== null && sig.formRatedCount >= 3 && sig.formCleanRate < 0.5) {
    targetFactor = Math.min(targetFactor, 0.9)
    formRepairNeeded = true
    decisions.push({
      text: `Only ${Math.round(sig.formCleanRate * 100)}% of your recent main sets were clean. Easier targets today so the position is the thing you practise.`,
      kind: 'warn',
    })
  }
  if (sig.meanCleanRatio !== null && sig.meanCleanRatio < 0.8) {
    targetFactor = Math.min(targetFactor, 0.9)
    targetIntent = 'steady'
    formRepairNeeded = true
    decisions.push({
      text: `The camera verified only ${Math.round(sig.meanCleanRatio * 100)}% of your recent timed holds as clean. Today's main work stops earlier so good seconds replace survival seconds.`,
      kind: 'warn',
    })
  }
  if (sig.topFormIssue) {
    const label = FORM_LABEL[sig.topFormIssue.issue] ?? sig.topFormIssue.issue
    const guidance = LIMITER_BY_ISSUE[sig.topFormIssue.issue]
    decisions.push({
      text: `Your most common breakdown is ${label} (${sig.topFormIssue.count} of ${sig.topFormIssue.of} reviewed sets). That is the one cue to hold in your head today.`,
      kind: 'info',
    })
    if (guidance) {
      accessoryEmphasis = guidance.emphasis
      limiter = {
        label: guidance.label,
        evidence: `${label} repeated across ${sig.topFormIssue.count} of ${sig.topFormIssue.of} recent reviewed sets.`,
        prescription: guidance.prescription,
      }
    }
  }
  if (formRepairNeeded) {
    strategy = 'technique'
    strategyOverrideReason =
      'recent form evidence says easier, repeatable positions will move you forward faster than another hard exposure.'
    if (!limiter) {
      limiter = {
        label: 'Hold durability',
        evidence: 'Recent filmed holds are losing their clean position before the timer stops.',
        prescription: 'Shorter, repeatable main holds rebuild clean time before intensity returns.',
      }
    }
  }

  // Reported, not acted on: drift is measured between samples seconds apart,
  // which cannot separate "slipping under load" from a nudged phone. Cutting
  // the target on it would also feed back on itself — shorter holds drift
  // less, which would look like improvement.
  if (sig.meanWobble !== null && sig.meanWobble > 0.05 && sig.cameraSetCount >= 3) {
    decisions.push({
      text: 'Your filmed sets show the position drifting as the hold goes on — the last few seconds are costing you shape rather than building it.',
      kind: 'info',
    })
  }

  // The quality axis the stopwatch cannot see. Report-only — the clean-ratio
  // caps above already do any acting, so this must never double-punish.
  if (sig.meanFormScore !== null && sig.formScoreTrend !== null && sig.cameraSetCount >= 4) {
    if (sig.formScoreTrend >= 2.5 && (sig.trendPerWeek ?? 0) <= 0.2) {
      decisions.push({
        text: `Your camera form score is climbing (~+${Math.round(sig.formScoreTrend)} points/week, now around ${Math.round(sig.meanFormScore)}) while hold times sit flat — the position is consolidating, and seconds usually follow it.`,
        kind: 'good',
      })
    } else if (sig.formScoreTrend <= -2.5) {
      decisions.push({
        text: `Your camera form score has been slipping (~${Math.round(sig.formScoreTrend)} points/week). Give the "fix first" cue on today's filmed sets priority over the stopwatch.`,
        kind: 'warn',
      })
    }
  }

  // Placement coaching: a criterion the camera chronically cannot see says
  // nothing about the athlete — it is a tripod problem with a thirty-second
  // fix, and until it is fixed that check silently stays out of every verdict.
  if (sig.chronicUnseen) {
    const u = sig.chronicUnseen
    decisions.push({
      text: `The camera missed your ${u.criterion} in ${u.count} of your last ${u.of} filmed sets, so that check keeps being skipped. Move the phone further back — or turn it sideways — until everything from hands to feet stays in frame.`,
      kind: 'info',
    })
  }

  if (sig.lastWasOutlier) {
    decisions.push({
      text: 'Your last best was far outside your usual range — if the setup was different (parallettes vs floor), it is not being trusted as a new baseline.',
      kind: 'warn',
    })
  }

  // ——— Left/right balance on unilateral work ———
  if (sig.sideGap) {
    const g = sig.sideGap
    if (!limiter) {
      limiter = {
        label: `${g.weakSide[0].toUpperCase()}${g.weakSide.slice(1)}-side strength`,
        evidence: `${Math.round(g.gapPct * 100)}% gap between sides on recent unilateral work.`,
        prescription: `Lead with the ${g.weakSide} side and cap both sides at the weaker side's dose.`,
      }
    }
    decisions.push({
      text: `Your ${g.weakSide} side is trailing on unilateral work (${Math.round(g.weakMean)}s vs ${Math.round(
        g.strongMean,
      )}s, ~${Math.round(g.gapPct * 100)}% behind). Lead every set with the ${g.weakSide} side while it catches up — never let the strong side set the dose.`,
      kind: 'info',
    })
  }

  // ——— Accessory work informs the main work ———
  if (sig.pressingLags && accessoryEmphasis === 'none') {
    accessoryEmphasis = 'pressing'
    limiter ??= {
      label: 'Pressing strength',
      evidence: 'The key hold and repeated pressing work have both flattened.',
      prescription: 'Planche-specific pressing volume increases while max attempts stay controlled.',
    }
    decisions.push({
      text: 'Your holds and your pressing numbers have both flattened — adding pressing volume, which usually unblocks the hold.',
      kind: 'info',
    })
  } else if (sig.accessoryTrend === 'up' && (sig.trendPerWeek ?? 0) <= 0.1 && accessoryEmphasis === 'none') {
    // Never override a form-driven emphasis — the plan text would then say
    // one thing while the session did another.
    accessoryEmphasis = 'balance'
    limiter ??= {
      label: 'Skill transfer',
      evidence: 'Pressing is improving while the key hold is flat.',
      prescription: 'Low-fatigue balance and position practice gets the extra work.',
    }
    decisions.push({
      text: 'Pressing strength is climbing but the hold is not — that points at balance and position, so skill work is up today.',
      kind: 'info',
    })
  }

  // ——— Warm-up adherence and readiness ———
  if (sig.skippedLastWarmup || sig.warmupRate < 0.7) {
    warmup = 'extended'
    decisions.push({
      text: 'Warm-ups have been getting skipped. Today includes the full one so wrists, elbows and shoulders are prepared before loading.',
      kind: 'warn',
    })
  } else if (sig.restDays >= 4) {
    warmup = 'extended'
    decisions.push({ text: 'A few days off means cold tissue — longer warm-up before anything heavy.', kind: 'info' })
  } else if (dayType === 'technique' && sig.lastCheckIn?.joints === 'good') {
    warmup = 'short'
  }

  // ——— Opportunities ———
  const best = qualifyingProgress(state, state.stepId).value
  if (
    dayType === 'push' &&
    best >= step.unlockSec * 0.85 &&
    best < step.unlockSec &&
    !sig.noisy &&
    !formRepairNeeded
  ) {
    queueUnlockAttempt = true
    decisions.push({
      text: `You're within reach of the ${step.unlockSec}s bar — an unlock attempt is queued first, while you're freshest.`,
      kind: 'good',
    })
  }
  let suggestMaxTest =
    (sig.daysSinceMaxTest === null ? sig.totalSessions >= 8 : sig.daysSinceMaxTest >= 21) &&
    sig.restDays >= 2 &&
    !sig.noisy &&
    dayType !== 'deload' &&
    !formRepairNeeded

  // ——————————————— SAFETY RAILS — these always win ———————————————
  const joints = sig.lastCheckIn?.joints
  const checkInAge = sig.daysSinceCheckIn
  const checkInFresh = checkInAge !== null && checkInAge <= 7

  if (checkInFresh && joints === 'pain') {
    dayType = 'recovery'
    dayReason = 'You reported joint pain — loaded planche work is off today. Use only pain-free recovery movement.'
    strategy = 'technique'
    targetFactor = 0.6
    volumeFactor = 0.5
    loadPermission = 'none'
    queueUnlockAttempt = false
    suggestMaxTest = false
    decisions.push({
      text: 'Joint pain reported — no loaded planche, pressing or wrist work today. Stop any recovery movement that reproduces symptoms and seek a qualified clinician for severe, worsening or persistent pain.',
      kind: 'warn',
    })
  } else if (checkInFresh && joints === 'niggle') {
    if (strategy === 'intensity') strategy = 'balanced'
    targetFactor = Math.min(targetFactor, 1)
    volumeFactor = Math.min(volumeFactor, 0.85)
    warmup = 'extended'
    loadPermission = 'reduced'
    queueUnlockAttempt = false
    decisions.push({ text: 'You flagged a niggle — no max-intensity work today, longer warm-up, slightly less volume.', kind: 'warn' })
  }

  if (checkInFresh && sig.lastCheckIn?.energy === 'tired') {
    volumeFactor = Math.min(volumeFactor, 0.85)
    targetFactor = Math.min(targetFactor, 1)
    decisions.push({ text: 'You reported low energy — trimming volume so today still counts without digging a hole.', kind: 'info' })
  }

  if (dayType === 'technique') {
    strategy = 'technique'
    targetFactor = Math.min(targetFactor, 0.8)
  }
  if (dayType === 'deload') {
    strategy = 'technique'
    targetFactor = Math.min(targetFactor, 0.7)
    volumeFactor = Math.min(volumeFactor, 0.6)
    queueUnlockAttempt = false
  }
  if (dayType === 'recovery') {
    strategy = 'technique'
    queueUnlockAttempt = false
  }

  const shape = STRATEGY_BY_ID[strategy]
  const finalTarget = clampTo(targetFactor * shape.targetFactor, LIMITS.targetFactor)

  // Explain the target only in terms of what actually happened to it.
  if (targetIntent === 'up' && targetFactor > 1.02) {
    decisions.push({
      text: `You hit nearly every set last time — nudging the target up ${Math.round((targetFactor - 1) * 100)}%.`,
      kind: 'good',
    })
  } else if (targetIntent === 'up' && targetFactor <= 1.02) {
    decisions.push({
      text: 'You earned a target increase, but recovery comes first today — it is banked for your next hard session.',
      kind: 'info',
    })
  } else if (targetIntent === 'down') {
    decisions.push({
      text: `Most sets fell short last time — easing the target back ${Math.round((1 - targetFactor) * 100)}% to rebuild quality.`,
      kind: 'info',
    })
  }

  // When a rail overrules the bandit, say so rather than quoting the bandit.
  const overridden = strategy !== pick.strategy
  const performanceOverrideReason =
    dayType === 'build' || dayType === 'push' ? strategyOverrideReason : null
  const strategyReason = overridden
    ? `${STRATEGY_BY_ID[pick.strategy].name} was selected, but it is on hold today — ${
        performanceOverrideReason ??
        `${dayReason.charAt(0).toLowerCase()}${dayReason.slice(1)}`
      }`
    : pick.reason
  const finalSets = clampTo(shape.setsDelta, LIMITS.setsDelta)
  const restMainSec = smartRest(state, shape.restFactor, sig)
  const restAccessorySec = Math.round(
    clampTo(state.settings.restAccessorySec * (dayType === 'deload' ? 1.1 : 1), LIMITS.restAccessory) / 5,
  ) * 5

  // Ask for a check-in when the answer would actually change something.
  const injuryCheckDue = Boolean(
    state.profile.injuryNote?.trim() && (checkInAge === null || checkInAge >= 2),
  )
  const profileAge = state.profile.birthYear
    ? new Date(now).getFullYear() - state.profile.birthYear
    : null
  // Younger athletes recover well, but joint feedback matters while they are
  // growing. Ask the same two quick questions a little more often; do not
  // lower earned performance or progression credit based on age.
  const routineCheckInterval = profileAge !== null && profileAge < 16 ? 2 : 3
  const askCheckIn =
    injuryCheckDue ||
    (sig.totalSessions >= 1 &&
      (checkInAge === null ||
        checkInAge >= routineCheckInterval ||
        (sig.lastRpe ?? 0) >= 9 ||
        sig.restDays >= 5 ||
        (checkInFresh && joints !== 'good' && checkInAge >= 2)))

  if (state.profile.injuryNote?.trim() && (checkInAge === null || checkInAge >= 2)) {
    decisions.push({
      text: `Your profile notes a prior or current issue (“${state.profile.injuryNote.trim().slice(0, 80)}”). The check-in gets the final say before loading today.`,
      kind: 'warn',
    })
  }

  // Said out loud, not just returned: this flag used to be computed and then
  // shown nowhere, so the one day it fired the athlete never heard about it.
  if (suggestMaxTest) {
    decisions.push({
      text:
        sig.daysSinceMaxTest === null
          ? 'You are fresh and your numbers are steady — a first max test today would calibrate every target the coach sets.'
          : `It has been ${sig.daysSinceMaxTest} days since your last max test and you are fresh today — a re-test would recalibrate your targets.`,
      kind: 'info',
    })
  }

  if (decisions.length === 0) {
    decisions.push({ text: 'Everything looks steady — running your best-performing setup unchanged.', kind: 'good' })
  }

  return {
    dayType,
    dayReason,
    strategy,
    strategyReason,
    setsDelta: finalSets,
    targetFactor: finalTarget,
    restMainSec,
    restAccessorySec,
    warmup,
    queueUnlockAttempt,
    suggestMaxTest,
    accessoryEmphasis,
    limiter,
    volumeFactor: clampTo(volumeFactor, LIMITS.volume),
    loadPermission,
    askCheckIn,
    decisions,
    signals: sig,
  }
}

// ————————————————————————————— The debrief —————————————————————————————

/**
 * What the coach noticed about a session the athlete just finished — ANY
 * session: generated, template, max test or quick log. Shown on the finish
 * screen, capped at three bullets so it reads as coaching, not a report.
 */
export function debriefSession(
  prev: AppState,
  next: AppState,
  session: Session,
  targets?: { before: number; after?: number },
): CoachDecision[] {
  const out: CoachDecision[] = []
  const step = STEP_BY_ID[session.stepId]

  // Form slipped in this specific session — the highest-priority thing to say.
  const rated = session.sets.filter((x) => x.form?.confirmed !== false && x.form && x.section === 'main')
  const clean = rated.filter((x) => x.form!.rating === 'clean').length
  if (rated.length >= 2 && clean / rated.length < 0.5) {
    out.push({
      text: 'More rated sets slipped than held clean today. The next session eases the target — clean positions are the product, seconds are just the receipt.',
      kind: 'warn',
    })
  }
  const filmedRatios = rated
    .filter(trustedCameraEvidence)
    .map((set) => set.form?.auto?.cleanRatio)
    .filter((ratio): ratio is number => ratio !== undefined)
  const filmedCleanRatio = median(filmedRatios)
  if (filmedRatios.length >= 2 && filmedCleanRatio !== null && filmedCleanRatio < 0.8) {
    out.push({
      text: `The camera verified about ${Math.round(filmedCleanRatio * 100)}% of your timed holds as clean today. The next session shortens the dose so every second reinforces the position.`,
      kind: 'warn',
    })
  }

  // Verified clean-hold growth against the last filmed session — the realest
  // progress number this app has, said when it moves.
  const round1 = (n: number) => Math.round(n * 10) / 10
  const cleanBest = (s: Session) =>
    s.sets.reduce(
      (b, x) =>
        x.exerciseId === step.keyExerciseId &&
        x.section === 'main' &&
        trustedCameraEvidence(x) &&
        x.form?.auto?.cleanSeconds !== undefined
          ? Math.max(b, x.form.auto.cleanSeconds)
          : b,
      0,
    )
  const thisClean = cleanBest(session)
  const prevFilmed = [...prev.sessions].reverse().find((s) => cleanBest(s) > 0)
  if (thisClean > 0 && prevFilmed && thisClean >= cleanBest(prevFilmed) + 1) {
    out.push({
      text: `Camera-verified clean hold grew ${round1(cleanBest(prevFilmed))}s → ${round1(thisClean)}s — position-held progress, not just stopwatch growth.`,
      kind: 'good',
    })
  }

  // Unusually big day, judged against the athlete's own recent sessions.
  const thisStrain = strainOf(session)
  const priorStrains = prev.sessions
    .slice(-10)
    .map(strainOf)
    .filter((s) => s >= LOADED_STRAIN)
  const typical = median(priorStrains)
  if (typical !== null && priorStrains.length >= 3 && thisStrain >= typical * 1.4) {
    out.push({
      text: 'That was one of your biggest sessions in weeks. Expect it to echo tomorrow — the plan will lean easier until it settles.',
      kind: 'info',
    })
  }

  // The number that actually changes their next session.
  if (targets && targets.after !== undefined && Math.abs(targets.after - targets.before) >= 1) {
    const up = targets.after > targets.before
    out.push({
      text: `Working target moves ${targets.before}s → ${targets.after}s next session${up ? '' : ' — rebuilding quality before pushing again'}.`,
      kind: up ? 'good' : 'info',
    })
  }

  // A max test that missed the bar: name the gap instead of leaving silence.
  if (session.workoutKind === 'test' && next.stepId === session.stepId) {
    const timerBest = session.sets.reduce(
      (b, x) => (x.exerciseId === step.keyExerciseId && x.value > b ? x.value : b),
      0,
    )
    const verifiedBest = qualifyingSessionValue(session, session.stepId)
    if (timerBest > 0 && verifiedBest < step.unlockSec) {
      out.push({
        text:
          verifiedBest > 0
            ? `Camera-verified clean best ${Math.round(verifiedBest * 10) / 10}s against the ${step.unlockSec}s bar — ${Math.round((step.unlockSec - verifiedBest) * 10) / 10}s of clean time to close.`
            : `Timer best ${Math.round(timerBest * 10) / 10}s, but no attempt had both athlete-confirmed Clean form and passing filmed evidence. It remains a PR, not an unlock.`,
        kind: 'info',
      })
    }
  }

  // Left/right gap inside this session's unilateral work.
  const sided = session.sets.filter((x) => x.side && x.kind === 'hold' && x.value > 0)
  const lv = sided.filter((x) => x.side === 'left').map((x) => x.value)
  const rv = sided.filter((x) => x.side === 'right').map((x) => x.value)
  const lm = median(lv)
  const rm = median(rv)
  if (lm !== null && rm !== null && Math.max(lm, rm) > 0) {
    const gap = Math.abs(lm - rm) / Math.max(lm, rm)
    if (gap >= 0.15) {
      const weak = lm < rm ? 'left' : 'right'
      out.push({
        text: `Your ${weak} side trailed today (${Math.round(Math.min(lm, rm))}s vs ${Math.round(Math.max(lm, rm))}s). Lead with it next time so the strong side never sets the pace.`,
        kind: 'info',
      })
    }
  }

  // If nothing needed saying, say the good thing rather than nothing.
  if (out.length === 0 && rated.length >= 2 && clean === rated.length) {
    out.push({
      text: 'Every rated set held clean. Pair the unlock-level hold with a passing filmed check and that is mastery.',
      kind: 'good',
    })
  }

  // The coach always has something to say about a finished session. Silence
  // here reads as "that did not register", and the most common reason a
  // session produces no bullets is the one worth explaining: nothing was
  // rated, so none of it can count toward the next step.
  if (out.length === 0) {
    const mainHolds = session.sets.filter((x) => x.section === 'main' && x.kind === 'hold' && x.value > 0)
    const best = mainHolds.reduce((b, x) => Math.max(b, x.value), 0)
    if (best > 0 && rated.length === 0) {
      out.push({
        text: `Best hold today ${round1(best)}s — logged as a PR, but nothing was rated, so it cannot count toward the ${step.unlockSec}s unlock. A filmed set you confirm as Clean is what moves the road.`,
        kind: 'info',
      })
    } else if (best > 0) {
      out.push({
        text: `Best hold today ${round1(best)}s against a ${step.unlockSec}s bar. Keep stacking sessions like this one.`,
        kind: 'good',
      })
    } else {
      out.push({
        text: 'Supporting work logged. It does not move the unlock bar directly, but the coach counts it as load and plans tomorrow around it.',
        kind: 'info',
      })
    }
  }

  return out.slice(0, 3)
}
