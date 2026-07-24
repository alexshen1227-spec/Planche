import type { AppState, Session, StrategyId } from '../types'
import { STEP_BY_ID } from '../data/progressions'

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
  mean: number
  /** Mean expressed as seconds gained per week on the step's key hold. */
  secPerWeek: number
}

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
  return STRATEGIES.map((def) => {
    const a = acc[def.id]
    const mean = a.n > 0 ? a.total / a.n : 0
    return { id: def.id, n: a.n, mean, secPerWeek: mean * unlockSec }
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
