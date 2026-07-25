import type { AppState, CheckIn, Session, StrategyId } from '../types'
import { STEP_BY_ID } from '../data/progressions'
import { readSignals, observedRestSec, median, type Signals } from './signals'

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

function bestInSession(session: Session, exerciseId: string): number {
  let best = 0
  for (const set of session.sets) if (set.exerciseId === exerciseId && set.value > best) best = set.value
  return best
}

/**
 * Reward for one session: how much the step's key hold moved between this
 * session and the next one that trained it. Attribution is deliberately
 * tight — crediting a whole fortnight to one session smears every strategy
 * together. Expressed as "fraction of the unlock bar gained per week" so
 * steps of different sizes stay comparable, and allowed to go negative so a
 * strategy that costs you ground actually scores worse.
 */
function rewardFor(sessions: Session[], session: Session): number | null {
  const step = STEP_BY_ID[session.stepId]
  if (!step) return null
  const keyId = step.keyExerciseId
  const own = bestInSession(session, keyId)
  if (own <= 0) return null // this session never trained the key hold

  const next = sessions.find(
    (s) =>
      s.startedAt > session.startedAt &&
      s.startedAt <= session.startedAt + ATTRIBUTION_DAYS * DAY &&
      bestInSession(s, keyId) > 0,
  )
  if (!next) return null // not evaluable yet

  const nextBest = bestInSession(next, keyId)
  const days = Math.max(1, (next.startedAt - session.startedAt) / DAY)
  let reward = ((nextBest - own) / days) * 7 / step.unlockSec

  // Clearing the bar is the whole point — weight it.
  if (own < step.unlockSec && nextBest >= step.unlockSec) reward += 0.15
  // Grinding at RPE 9+ and going nowhere is a cost, not a neutral outcome.
  if ((session.rpe ?? 0) >= 9 && nextBest <= own) reward -= 0.03

  return Math.max(-0.2, Math.min(0.6, reward))
}

/** Per-strategy performance, derived fresh from history. */
export function armStats(state: AppState): ArmStats[] {
  const sessions = [...state.sessions].sort((a, b) => a.startedAt - b.startedAt)
  const acc: Record<StrategyId, { n: number; total: number }> = {
    balanced: { n: 0, total: 0 },
    volume: { n: 0, total: 0 },
    intensity: { n: 0, total: 0 },
    density: { n: 0, total: 0 },
    technique: { n: 0, total: 0 },
  }
  for (const s of sessions) {
    if (!s.strategy || !acc[s.strategy]) continue
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
    return { id: def.id, n: a.n, mean, rawMean, secPerWeek: rawMean * unlockSec }
  })
}

/**
 * UCB1 selection: untested strategies are tried first (in listed order),
 * then the arm with the best optimistic estimate wins.
 */
export function pickStrategy(state: AppState): CoachPick {
  const stats = armStats(state)
  const totalN = stats.reduce((t, s) => t + s.n, 0)

  const untested = stats.find((s) => s.n === 0)
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
    const score = s.mean + UCB_C * Math.sqrt(Math.log(totalN + 1) / s.n)
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

export type DayType = 'push' | 'build' | 'technique' | 'deload'
export type WarmupLevel = 'short' | 'standard' | 'extended'

export interface CoachDecision {
  text: string
  kind: 'info' | 'good' | 'warn'
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
  accessoryEmphasis: 'pressing' | 'balance' | 'core' | 'none'
  volumeFactor: number
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
      .slice(-6)
      .map((s) => observedRestSec(s, step.keyExerciseId))
      .filter((r): r is number => r !== null),
  )
  if (observed !== null) rest = rest * 0.7 + observed * 0.3

  if ((sig.lastRpe ?? 0) >= 9) rest *= 1.2
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

  // ——— Recovery state sets the day's character ———
  if (sig.restDays === 0 && sig.totalSessions > 0) {
    dayType = 'technique'
    dayReason = 'Second session today — skill work only, tendons keep score.'
  } else if (sig.restDays === 1 && (sig.lastRpe ?? 0) >= 9) {
    dayType = 'technique'
    dayReason = 'Yesterday hit RPE 9+ — today turns that into strength instead of fatigue.'
  } else if (sig.restDays >= 2) {
    dayType = 'push'
    dayReason = `${sig.restDays} rest day${sig.restDays > 1 ? 's' : ''} banked — you're fresh, so today pushes.`
  }

  // ——— Deload is scheduled, not earned ———
  if (sig.weeksSinceDeload >= 5 && sig.totalSessions >= 12) {
    dayType = 'deload'
    dayReason = `${sig.weeksSinceDeload} weeks without an easy week — this one is deliberately light. Strength lands during recovery.`
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
    hips: 'hips sagging',
    level: 'body not level',
  }
  if (sig.formDegrading) {
    targetFactor = Math.min(targetFactor, 0.9)
    targetIntent = 'steady'
    decisions.push({
      text: 'Your holds are getting longer but your own form ratings are getting worse — that is a stall dressed up as progress. Backing the target off to rebuild the position.',
      kind: 'warn',
    })
  } else if (sig.formCleanRate !== null && sig.formCleanRate < 0.5) {
    targetFactor = Math.min(targetFactor, 0.9)
    decisions.push({
      text: `Only ${Math.round(sig.formCleanRate * 100)}% of your recent main sets were clean. Easier targets today so the position is the thing you practise.`,
      kind: 'warn',
    })
  }
  if (sig.topFormIssue) {
    const label = FORM_LABEL[sig.topFormIssue.issue] ?? sig.topFormIssue.issue
    decisions.push({
      text: `Your most common breakdown is ${label} (${sig.topFormIssue.count} sets). That is the cue to hold in your head today.`,
      kind: 'info',
    })
    if (sig.topFormIssue.issue === 'scapula' || sig.topFormIssue.issue === 'arms') accessoryEmphasis = 'pressing'
  }

  if (sig.lastWasOutlier) {
    decisions.push({
      text: 'Your last best was far outside your usual range — if the setup was different (parallettes vs floor), it is not being trusted as a new baseline.',
      kind: 'warn',
    })
  }

  // ——— Accessory work informs the main work ———
  if (sig.pressingLags) {
    accessoryEmphasis = 'pressing'
    decisions.push({
      text: 'Your holds and your pressing numbers have both flattened — adding pressing volume, which usually unblocks the hold.',
      kind: 'info',
    })
  } else if (sig.accessoryTrend === 'up' && (sig.trendPerWeek ?? 0) <= 0.1) {
    accessoryEmphasis = 'balance'
    decisions.push({
      text: 'Pressing strength is climbing but the hold is not — that points at balance and position, so skill work is up today.',
      kind: 'info',
    })
  }

  // ——— Warm-up adherence and readiness ———
  if (sig.skippedLastWarmup || sig.warmupRate < 0.7) {
    warmup = 'extended'
    decisions.push({
      text: 'Warm-ups have been getting skipped. Today includes the full one — wrist pain is the most common reason people stop training.',
      kind: 'warn',
    })
  } else if (sig.restDays >= 4) {
    warmup = 'extended'
    decisions.push({ text: 'A few days off means cold tissue — longer warm-up before anything heavy.', kind: 'info' })
  } else if (dayType === 'technique' && sig.lastCheckIn?.joints === 'good') {
    warmup = 'short'
  }

  // ——— Opportunities ———
  const best = state.prs[step.keyExerciseId]?.value ?? 0
  if (dayType === 'push' && best >= step.unlockSec * 0.85 && best < step.unlockSec && !sig.noisy) {
    queueUnlockAttempt = true
    decisions.push({
      text: `You're within reach of the ${step.unlockSec}s bar — an unlock attempt is queued first, while you're freshest.`,
      kind: 'good',
    })
  }
  const suggestMaxTest =
    (sig.daysSinceMaxTest === null ? sig.totalSessions >= 8 : sig.daysSinceMaxTest >= 21) &&
    sig.restDays >= 2 &&
    !sig.noisy &&
    dayType !== 'deload'

  // ——————————————— SAFETY RAILS — these always win ———————————————
  const joints = sig.lastCheckIn?.joints
  const checkInAge = sig.daysSinceCheckIn
  const checkInFresh = checkInAge !== null && checkInAge <= 5

  if (checkInFresh && joints === 'pain') {
    dayType = 'technique'
    dayReason = 'You reported joint pain — today is deliberately easy. Tendons take months to heal and weeks to calm down.'
    strategy = 'technique'
    targetFactor = Math.min(targetFactor, 0.7)
    volumeFactor = 0.6
    warmup = 'extended'
    queueUnlockAttempt = false
    decisions.push({
      text: 'Joint pain reported — intensity is locked out until you report otherwise. If it persists past two weeks, see a physio rather than training through it.',
      kind: 'warn',
    })
  } else if (checkInFresh && joints === 'niggle') {
    if (strategy === 'intensity') strategy = 'balanced'
    targetFactor = Math.min(targetFactor, 1)
    volumeFactor = Math.min(volumeFactor, 0.85)
    warmup = 'extended'
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
  const strategyReason = overridden
    ? `${STRATEGY_BY_ID[pick.strategy].name} is your fastest approach, but it is on hold today — ${dayReason.charAt(0).toLowerCase()}${dayReason.slice(1)}`
    : pick.reason
  const finalSets = clampTo(shape.setsDelta, LIMITS.setsDelta)
  const restMainSec = smartRest(state, shape.restFactor, sig)
  const restAccessorySec = Math.round(
    clampTo(state.settings.restAccessorySec * (dayType === 'deload' ? 1.1 : 1), LIMITS.restAccessory) / 5,
  ) * 5

  // Ask for a check-in when the answer would actually change something.
  const askCheckIn =
    sig.totalSessions >= 1 &&
    (checkInAge === null ||
      checkInAge >= 7 ||
      (sig.lastRpe ?? 0) >= 9 ||
      sig.restDays >= 5 ||
      (checkInFresh && joints !== 'good' && checkInAge >= 2))

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
    volumeFactor: clampTo(volumeFactor, LIMITS.volume),
    askCheckIn,
    decisions,
    signals: sig,
  }
}
