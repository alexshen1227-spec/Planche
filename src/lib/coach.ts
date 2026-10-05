import type { AppState, BodyRegion, CheckIn, EquipmentId, Session, StepId, StrategyId, SymptomEvent } from '../types'
import { STEP_BY_ID } from '../data/progressions'
import { defaultSurface } from '../data/equipment'
import { diagnosePlateau, type PlateauVerdict } from './plateau'
import { emphasisFromGaps } from './assessment'
import {
  MAX_WEEKLY_LOAD_RAMP,
  readCapabilityJump,
  readDifficultyDrift,
  readLoadRamp,
  type CapabilityJump,
} from './loading'
import {
  readSignals,
  observedRestSec,
  median,
  strainOf,
  trustedCameraEvidence,
  LOADED_STRAIN,
  LONG_GAP_DAYS,
  type ReadinessAnswer,
  type Signals,
} from './signals'
import {
  qualifyingProgress,
  qualifyingSessionValue,
  sessionLearningValue,
  sessionSurface,
  type LearningScope,
} from './progression'

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
    // Not "builds tendon capacity": the tendon-loading evidence points at
    // intensity, not accumulated easy time, so that claim had it backwards.
    id: 'volume',
    name: 'High volume',
    blurb: 'More sets at a slightly easier hold — more practice of the position at a dose you can repeat.',
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
    // "Cheap on joints" was a claim; an easy hold is a smaller dose, which is
    // all that can honestly be said — a novice's easy tuck can still be hard.
    blurb: 'Easier targets and careful positions — a smaller dose per set, spent practising the shape.',
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
  /** Attempts with an evaluated outcome (a comparable session followed in time). */
  n: number
  /**
   * Selection utility, shrunk toward the overall average — see armStats. A
   * unitless score that includes effort and complaint penalties and an unlock
   * bonus. It ranks; it is not a rate and must never be shown as seconds.
   */
  mean: number
  /** Unshrunk utility average. */
  rawMean: number
  /**
   * Observed change in the key hold around these sessions, seconds per week,
   * measured from timestamped observations — or null when none could be
   * measured. This is what the athlete sees. It is an observation, not an
   * estimate of what the strategy caused.
   */
  secPerWeek: number | null
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
/**
 * The comparable observations around one strategy session.
 *
 * Comparable means the same step and the same surface: a floor session
 * followed by a parallette session is a change of task, not a result, and
 * pooling them was enough to manufacture gains from two flat series. A
 * session that mixed surfaces on its key hold has no single task to compare
 * and is left unevaluated.
 */
function comparableWindow(
  sessions: Session[],
  session: Session,
): { prior: { at: number; value: number }[]; follow: { at: number; value: number }[] } | null {
  const surface = sessionSurface(session, session.stepId)
  if (surface === 'mixed') return null
  const scope: LearningScope = { surface }
  const value = (candidate: Session) => sessionLearningValue(candidate, session.stepId, scope)
  if (value(session) <= 0) return null
  const prior = sessions
    .filter((s) => s.startedAt < session.startedAt && s.stepId === session.stepId && value(s) > 0)
    .slice(-3)
    .map((s) => ({ at: s.startedAt, value: value(s) }))
  const follow = sessions
    .filter(
      (s) =>
        s.startedAt > session.startedAt &&
        s.startedAt <= session.startedAt + ATTRIBUTION_DAYS * DAY &&
        s.stepId === session.stepId &&
        value(s) > 0,
    )
    .slice(0, 2)
    .map((s) => ({ at: s.startedAt, value: value(s) }))
  return { prior, follow }
}

/**
 * Observed key-hold change around one strategy session, in seconds per week.
 *
 * The utility below mixed two different things into the number athletes saw:
 * its time base divided a change measured across ~10 days by the ~6 days from
 * the session to the last follow-up (a true +1.0s/week read as +1.75), and it
 * multiplied effort and complaint penalties by the unlock bar, so a perfectly
 * flat history displayed "−0.6s/week". This measures only the hold: the median
 * of the comparable sessions before against the median of those after, divided
 * by the time between those two medians. Null when nothing comparable exists.
 */
export function observedRateFor(sessions: Session[], session: Session): number | null {
  const window = comparableWindow(sessions, session)
  if (!window || window.prior.length < 2 || window.follow.length === 0) return null
  const before = median(window.prior.map((p) => p.value))
  const after = median(window.follow.map((p) => p.value))
  const beforeAt = median(window.prior.map((p) => p.at))
  const afterAt = median(window.follow.map((p) => p.at))
  if (before === null || after === null || beforeAt === null || afterAt === null) return null
  const weeks = (afterAt - beforeAt) / (7 * DAY)
  if (weeks <= 0) return null
  return (after - before) / weeks
}

/**
 * Joint complaints reported in a session's attribution window — from any
 * source, on any kind of day.
 *
 * The complaint search used to run over the *follow-up key-hold sessions*
 * only, so pain reported on a recovery day — the most likely day to report it,
 * and one with no key hold by design — simply disappeared from the strategy's
 * record. A temporal association, not proof the strategy caused it; still a
 * cost the optimizer should see.
 */
function complaintsAfter(sessions: Session[], session: Session, symptoms: SymptomEvent[]): CheckIn['joints'][] {
  const from = session.startedAt
  const to = session.startedAt + ATTRIBUTION_DAYS * DAY
  const reports = new Map<number, CheckIn['joints']>()
  for (const s of sessions) {
    if (s.checkIn) reports.set(s.checkIn.at, s.checkIn.joints)
  }
  for (const e of symptoms) {
    if (!e.correction) reports.set(e.at, e.joints)
  }
  // A correction withdraws the most recent complaint made at or before it,
  // exactly as on the readiness timeline: an accidental "pain" tap the
  // athlete took back is not a cost this strategy should carry.
  const timeline = [...reports.entries()].sort((a, b) => a[0] - b[0])
  const corrections = symptoms
    .filter((e) => e.correction)
    .map((e) => e.at)
    .sort((a, b) => a - b)
  for (const at of corrections) {
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i][0] <= at && timeline[i][1] !== 'good') {
        timeline.splice(i, 1)
        break
      }
    }
  }
  return timeline.filter(([at, joints]) => at > from && at <= to && joints !== 'good').map(([, joints]) => joints)
}

export function rewardFor(sessions: Session[], session: Session, symptoms: SymptomEvent[] = []): number | null {
  const step = STEP_BY_ID[session.stepId]
  if (!step) return null
  // Measured on learning value, not unlock credit — see sessionLearningValue.
  const window = comparableWindow(sessions, session)
  if (!window) return null
  const before = median(window.prior.map((p) => p.value))
  const after = median(window.follow.map((p) => p.value))
  const follow = window.follow
  if (window.prior.length < 2 || before === null || after === null || follow.length === 0) return null

  // The utility's own time base, kept as it was: it ranks strategies and is
  // never displayed. The displayed rate is observedRateFor.
  const days = Math.max(1, (follow[follow.length - 1].at - session.startedAt) / DAY)
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
  // stopwatch says — the worst report in the window gets a vote, wherever and
  // on whatever kind of day it was made.
  const complaints = complaintsAfter(sessions, session, symptoms)
  if (complaints.length) reward -= complaints.includes('pain') ? 0.1 : 0.04

  return Math.max(-0.2, Math.min(0.6, reward))
}

/** Steps where the wrist position of the main hold starts to matter a lot. */
const WRIST_SENSITIVE_STEPS = new Set<StepId>(['tuck', 'advtuck', 'oneleg', 'straddle', 'full'])

/**
 * Coaching that comes from the kit in the athlete's profile.
 *
 * The generated session already substitutes exercises for missing equipment,
 * but it did so silently — an athlete on the floor never learned that the
 * pressing block they were given was the fallback, or that the one purchase
 * that reliably buys seconds on a tuck planche is a pair of parallettes.
 *
 * Deliberately evidence-gated rather than a standing advert: kit advice only
 * appears when it would change today, so it cannot become the line that gets
 * scrolled past every session. Exported for tests — advice that fires at the
 * wrong moment is worse than none.
 */
export function equipmentAdvice(state: AppState, joints?: CheckIn['joints']): CoachDecision[] {
  const out: CoachDecision[] = []
  const has = (id: EquipmentId) => state.profile.equipment.includes(id)
  const wristSensitive = WRIST_SENSITIVE_STEPS.has(state.stepId)
  const wristNote = /wrist/i.test(state.profile.injuryNote ?? '')
  const jointsUnhappy = joints === 'niggle' || joints === 'pain'

  if (!has('parallettes') && wristSensitive && (wristNote || jointsUnhappy)) {
    out.push({
      text: 'Floor holds put your wrists in deep extension at this stage. Parallettes or push-up handles change that angle, and many athletes find them easier on the wrists — but a grip change does not explain or clear wrist pain. If a hold hurts, stop it; on the floor, keep the lean shallower.',
      kind: 'warn',
    })
  } else if (
    has('parallettes') &&
    wristSensitive &&
    defaultSurface(state.profile.equipment, state.profile.preferredSurface) === 'floor' &&
    (wristNote || jointsUnhappy)
  ) {
    out.push({
      text: 'You own parallettes but your main holds are set to the floor. A parallette grip changes the wrist angle, which some people find more comfortable — switch it in the set screen if you want to try. Parallette records are tracked separately, so nothing earned on the floor is disturbed. It is not a reason to keep loading a wrist that hurts.',
      kind: 'info',
    })
  }

  // Band work is what makes the straddle rehearsable before it is holdable.
  if (state.stepId === 'straddle' && !(has('band') && has('pullup-bar'))) {
    out.push({
      text: has('band')
        ? 'Band-assisted straddle work needs somewhere overhead to anchor the band — add a pull-up bar to your equipment and the plan will start using it.'
        : 'At this step a resistance band looped under the hips (never the knees) lets you rehearse the real straddle shape long before you can hold it. Your sessions are running unassisted until one is in your equipment profile.',
      kind: 'info',
    })
  }

  return out
}

/** Per-strategy performance, derived fresh from history. */
export function armStats(state: AppState, forStep: StepId = state.stepId): ArmStats[] {
  const sessions = [...state.sessions].sort((a, b) => a.startedAt - b.startedAt)
  const acc: Record<StrategyId, { attempts: number; n: number; total: number; rates: number[] }> = {
    balanced: { attempts: 0, n: 0, total: 0, rates: [] },
    volume: { attempts: 0, n: 0, total: 0, rates: [] },
    intensity: { attempts: 0, n: 0, total: 0, rates: [] },
    density: { attempts: 0, n: 0, total: 0, rates: [] },
    technique: { attempts: 0, n: 0, total: 0, rates: [] },
  }
  const symptoms = state.symptoms ?? []
  for (const s of sessions) {
    if (!s.strategy || !acc[s.strategy] || s.stepId !== forStep) continue
    if (sessionLearningValue(s, forStep) <= 0) continue
    acc[s.strategy].attempts += 1
    const r = rewardFor(sessions, s, symptoms)
    if (r === null) continue
    acc[s.strategy].n += 1
    acc[s.strategy].total += r
    const observed = observedRateFor(sessions, s)
    if (observed !== null) acc[s.strategy].rates.push(observed)
  }

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
    return { id: def.id, attempts: a.attempts, n: a.n, mean, rawMean, secPerWeek: median(a.rates) }
  })
}

/** The most recent step, before this one, the athlete logged strategy work at. */
export function previousTrainedStep(state: AppState): StepId | null {
  const earlier = [...state.sessions]
    .sort((a, b) => b.startedAt - a.startedAt)
    .find((s) => s.strategy && s.stepId !== state.stepId && sessionLearningValue(s, s.stepId) > 0)
  return earlier?.stepId ?? null
}

/**
 * UCB1 selection: untested strategies are tried first, then the arm with the
 * best optimistic estimate wins.
 *
 * Which untested arm goes first is where the previous step gets a say. Every
 * unlock resets all five arms to zero evidence, so the coach spent its first
 * sessions at a new step re-discovering things it had just finished learning —
 * at exactly the moment the athlete is most motivated. The previous step's
 * ranking is carried over as an *ordering* only: it decides what to try first,
 * never what to claim. The measured rates still start empty, because a tuck
 * planche is not an advanced tuck and pretending otherwise would be inventing
 * evidence.
 */
export function pickStrategy(state: AppState): CoachPick {
  const stats = armStats(state)
  const totalN = stats.reduce((t, s) => t + s.attempts, 0)

  const untested = stats.filter((s) => s.attempts === 0)
  if (untested.length) {
    const priorStep = previousTrainedStep(state)
    const priorRanking = priorStep
      ? armStats(state, priorStep)
          .filter((arm) => arm.n > 0)
          .sort((a, b) => b.mean - a.mean)
          .map((arm) => arm.id)
      : []
    const rank = (id: StrategyId) => {
      const at = priorRanking.indexOf(id)
      return at < 0 ? Number.MAX_SAFE_INTEGER : at
    }
    const next = [...untested].sort((a, b) => rank(a.id) - rank(b.id))[0]
    const carried = priorRanking[0] === next.id && priorStep !== null
    return {
      strategy: next.id,
      reason:
        totalN === 0 && carried
          ? `Starting with ${STRATEGY_BY_ID[next.id].name.toLowerCase()}, which had your best measured result at ${STEP_BY_ID[priorStep!].name} — this step has to prove it again from scratch.`
          : totalN === 0
            ? 'Starting with a baseline so it can measure everything else against it.'
            : `Trying ${STRATEGY_BY_ID[next.id].name.toLowerCase()} — it hasn't been tested on you yet.`,
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

  /**
   * Whether the leader is actually ahead of the field, or merely first.
   *
   * A gain shows up in the sessions on either side of the one that caused it,
   * so neighbouring strategies collect near-identical credit and the ranking
   * can be decided by a rounding error. Ordering still has to pick something —
   * but claiming "your fastest gains" off a lead of two hundredths of a second
   * a week is the coach asserting something it does not know. Below half a
   * second a week the two are the same answer as far as an athlete is
   * concerned, so it says that instead.
   */
  const unlockSec = STEP_BY_ID[state.stepId]?.unlockSec ?? 20
  const runnerUp = ranked.find((arm) => arm.id !== best.id)
  const leadSecPerWeek = runnerUp ? (best.mean - runnerUp.mean) * unlockSec : Infinity
  const decided = leadSecPerWeek >= 0.5
  const evaluated = stats.reduce((t, s) => t + s.n, 0)

  return {
    strategy: best.id,
    // Every branch describes what was actually measured. "Holding up best while
    // your numbers are flat" was once printed when nothing had been measured at
    // all — every approach tried once, none with a later session to compare —
    // which is a claim of superiority made from zero evaluated outcomes.
    reason:
      evaluated === 0
        ? `Every approach has been tried, but none has a later comparable session to measure it against yet. Staying on ${name.toLowerCase()} until results come in.`
        : best.n === 0
          ? `${name} has been tried but not measured yet — it gets another turn before the coach leans on any one approach.`
          : exploring
            ? `Re-testing ${name.toLowerCase()} to keep its read on you current.`
            : best.secPerWeek === null || best.secPerWeek <= 0.05
              ? `${name} is holding up best while your numbers are flat — keeping the stimulus steady.`
              : decided
                ? `${name} has the best measured result so far: ${formatRate(best.secPerWeek)} observed in the sessions after it. That is an observation from your log, not proof it caused the gain.`
                : `${name} and ${STRATEGY_BY_ID[runnerUp!.id].name.toLowerCase()} are running neck and neck (${formatRate(
                    best.secPerWeek,
                  )} observed). Staying on ${name.toLowerCase()} while the difference is still inside the noise.`,
    exploring,
  }
}

export function formatRate(secPerWeek: number | null): string {
  if (secPerWeek === null) return 'not measurable yet'
  if (secPerWeek < -0.05) return `${secPerWeek.toFixed(1)}s/week`
  if (secPerWeek <= 0.05) return 'no measurable gain'
  return `+${secPerWeek.toFixed(1)}s/week`
}

/** Athlete-facing evidence state for one strategy in the Progress panel. */
export function formatStrategyEvidence(arm: Pick<ArmStats, 'attempts' | 'n' | 'secPerWeek'>): string {
  if (arm.n > 0) {
    return `${formatRate(arm.secPerWeek)} observed · ${arm.n}/${arm.attempts} result${arm.attempts === 1 ? '' : 's'} measured`
  }
  if (arm.attempts > 0) {
    return `tried ${arm.attempts}× · waiting for a later session`
  }
  return 'not tried yet'
}

/** How much current-step evidence the coach has attempted and evaluated. */
export function coachConfidence(
  state: AppState,
): { attempted: number; tried: number; evaluated: number; tested: number } {
  const stats = armStats(state)
  return {
    attempted: stats.reduce((t, s) => t + s.attempts, 0),
    tried: stats.filter((s) => s.attempts > 0).length,
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
  /**
   * Where the line came from.
   *
   * `plateau` lets a screen that already renders the full diagnosis card drop
   * the duplicate bullet. `load-advice` marks lines that prescribe *more*
   * loaded work — they are removed outright on a day the rails have forbidden
   * it, because "add pressing volume" beside "no loaded pressing today" is the
   * plan contradicting itself.
   */
  source?: 'plateau' | 'load-advice'
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
  /**
   * Named stall and its diagnosed cause, when the log supports one. Null is
   * the common and good case — it means the athlete is progressing, or that
   * there is not yet enough training to judge either way.
   */
  plateau: PlateauVerdict | null
  /**
   * A recent large gain in capability. Present means volume is deliberately
   * being held rather than added — see the tissue rails in buildPlan.
   */
  capabilityJump: CapabilityJump | null
  volumeFactor: number
  /** Whether loaded upper-body planche work is appropriate today. */
  loadPermission: 'normal' | 'reduced' | 'none'
  /**
   * Whether a maximal effort — a max test or a queued unlock attempt — is
   * appropriate today. Separate from load permission because ordinary work
   * can be fine on a day a maximal attempt is not (low energy, a complaint
   * that keeps recurring, a concern nobody has updated). Every route that
   * starts a test or queues an attempt reads this; none may recreate one.
   */
  challengeAllowed: boolean
  /**
   * After a long logging gap, what the athlete said it was. 'unknown' means
   * not asked or skipped — and stays unknown rather than becoming "rest".
   */
  gap: 'none' | 'trained-elsewhere' | 'break' | 'unknown'
  /**
   * The latest joint report when it was a complaint nobody has updated since.
   * A stale concern is asked about rather than silently forgotten.
   */
  openConcern: ReadinessAnswer | null
  askCheckIn: boolean
  decisions: CoachDecision[]
  signals: Signals
}

/**
 * What a specific region changes about today, beyond "rest it".
 *
 * Written per region because the useful advice genuinely differs: an elbow
 * needs time and nothing else, and a lower back changes which "safe" core work
 * is actually safe. Empty strings are deliberate for regions with nothing extra
 * worth saying — padding these out would train athletes to skip them.
 *
 * None of these may read as a diagnosis or a clearance. A different grip
 * changes the wrist's angle; it does not establish why the wrist hurts, and it
 * is not permission to keep loading a painful one.
 */
const REGION_PAIN_NOTE: Partial<Record<BodyRegion, string>> = {
  wrist:
    'Wrist pain: do not keep loading it to finish the session. Parallettes or fists change the wrist angle, which some people find more comfortable later — but they do not diagnose the cause and are not a reason to train through pain. If it is still sore the next day, keeps coming back, or there is swelling, get it checked by a qualified clinician.',
  // Hedged to match the ledger: coaches agree on this almost universally, and
  // there is essentially no literature on it — a 2025 review of tendon-loading
  // studies found one touching the distal biceps against six each for Achilles
  // and patellar. The advice is still worth giving; the certainty is not.
  elbow:
    'Elbow pain is the one most planche coaches take most seriously, and it is the one the research has least to say about — the tissue usually blamed is the biceps tendon near its insertion, which is precisely what straight-arm loading stresses. Treat that as experienced opinion rather than established fact, but the cautious reading costs you days and the other reading can cost months. Rest it rather than testing whether it still hurts.',
  shoulder:
    'Shoulder pain: skip overhead and pressing movement entirely today, including the warm-up arm circles. Pain at the front of the shoulder under a lean is worth a clinician rather than a deload.',
  'lower-back':
    'Lower back: the usual core work is off today, because hollow holds, arch holds and leg lifts all load exactly what you flagged. Walking and easy hip mobility are better uses of the day.',
}

/** How a region reads inside a sentence. */
const REGION_NOUN: Record<BodyRegion, string> = {
  wrist: 'wrist',
  elbow: 'elbow',
  shoulder: 'shoulder',
  'lower-back': 'lower back',
  other: 'reported area',
}

const REGION_NIGGLE_NOTE: Partial<Record<BodyRegion, string>> = {
  wrist:
    'For the wrist niggle: keep the lean shallower than usual, and if you have parallettes, a more neutral grip may feel better — a change of angle, not a fix. Stop any set that makes it worse, and if it is still there tomorrow, treat it as pain rather than a niggle.',
  shoulder:
    'For the shoulder: keep the lean conservative and stop any set where the position drifts, rather than pushing to the target.',
  'lower-back':
    'For the lower back: keep the hollow and arch work light today and prioritise a level pelvis over a longer hold.',
}

/** How a placement gap reads as a limiter, before any session exists. */
const GAP_LIMITER_LABEL: Record<'pressing' | 'core' | 'balance', string> = {
  pressing: 'Pressing strength',
  core: 'Body line',
  balance: 'Hand balance',
}

const GAP_LIMITER_PRESCRIPTION: Record<'pressing' | 'core' | 'balance', string> = {
  pressing:
    'Pressing volume is up while the holds stay conservative — your straight-arm work is ahead of the engine behind it.',
  core: 'Hollow and arch work gets the extra sets: a flat line is what separates the next step from this one.',
  balance:
    'Low-fatigue balance practice gets priority. It is the cheapest thing on the list in recovery terms and it is often what makes early holds feel impossible.',
}

/** Clause form, so the strategy sentence reads as one thought. */
const PLATEAU_REASON: Record<PlateauVerdict['cause'], string> = {
  'form-limited': 'the position rather than the strength',
  'under-recovered': 'accumulated fatigue',
  'under-stimulated': 'how little exposure the hold has had',
  monotony: 'a stimulus you have fully adapted to',
  'strength-ceiling': 'pressing strength',
  'skill-ceiling': 'balance and position rather than force',
  'measurement-noise': 'measurement spread rather than your training',
  unclear: 'nothing the log can separate',
}

/** Limiter-chip wording for a plateau that named no other bottleneck. */
const PLATEAU_LABEL_SHORT: Record<PlateauVerdict['cause'], string> = {
  'form-limited': 'Position quality',
  'under-recovered': 'Recovery',
  'under-stimulated': 'Training frequency',
  monotony: 'Stimulus variety',
  'strength-ceiling': 'Pressing strength',
  'skill-ceiling': 'Balance and position',
  'measurement-noise': 'Measurement consistency',
  unclear: 'Unresolved plateau',
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

  // ——— A long logging gap is not rest ———
  //
  // Ninety days without a log used to read as "90 rest days banked — you're
  // fresh, so today pushes", followed by an unlock attempt anchored on
  // three-month-old results. Silence in the log is not observed rest: it can be
  // a break, an injury, or training the app never saw. The check-in asks which,
  // and an unanswered question stays unknown rather than becoming either.
  const longGap = sig.totalSessions > 0 && sig.restDays >= LONG_GAP_DAYS
  const answeredGap = freshCheckIn?.gap
  const gap: CoachPlan['gap'] = !longGap
    ? 'none'
    : answeredGap === 'break' || answeredGap === 'trained-elsewhere'
      ? answeredGap
      : 'unknown'

  // ——— Recovery state sets the day's character ———
  // Judged on training LOAD, not on whether any session existed: a ten-minute
  // wrist routine yesterday neither blocks a push day nor grants one, and a
  // heavy template session counts even though the bandit never shaped it.
  if (sig.totalSessions === 0) {
    dayType = 'build'
    dayReason = 'Baseline session — start controlled so the coach can learn your current capacity.'
  } else if (longGap) {
    dayType = 'build'
    dayReason =
      gap === 'break'
        ? `Back after about ${sig.restDays} days away — today re-establishes your current working level rather than testing it. Everything you earned before still stands.`
        : gap === 'trained-elsewhere'
          ? `Nothing logged here for ${sig.restDays} days, but you kept training elsewhere — an ordinary session today, with no unlock attempt queued off results this old.`
          : `Nothing logged for ${sig.restDays} days. That could be a break or training the app could not see, so today is an ordinary session rather than a push day, and old results are not treated as today's capacity.`
  } else if (sig.daysSinceLoaded === 0) {
    dayType = 'technique'
    dayReason = 'Second loaded session today — skill work only. One hard session a day is this app’s ceiling: a design choice, not a measured limit.'
  } else if (sig.readinessLoad !== null && sig.readinessLoad > 1.5) {
    dayType = 'technique'
    dayReason =
      'Your recent training load is running well above your own four-week normal — today is skill work rather than more load stacked on top.'
  } else if (sig.daysSinceLoaded === 1 && sig.lastLoadedWasTest) {
    // A max test is maximal whatever its seconds add up to. Three five-second
    // attempts used to fall below the volume bar and leave the next day
    // claiming nothing hard had been logged.
    dayType = 'technique'
    dayReason = 'Yesterday was a max test — a maximal effort however short it was — so today is skill work rather than another push.'
  } else if (sig.daysSinceLoaded === 1 && (sig.lastLoadedRpe ?? 0) >= 9) {
    dayType = 'technique'
    dayReason = 'Your last hard session hit RPE 9+ — today is skill work, so fatigue does not stack on fatigue.'
  } else if (sig.daysSinceLoaded >= 2) {
    dayType = 'push'
    dayReason = !sig.hasLoadedSession
      ? // daysSinceLoaded is a sentinel here, not a count. It once reached
        // athletes as "No hard training in 99 days" two days after they trained.
        'Nothing logged so far has reached a hard-training load — today pushes, so the coach can see where your limit actually sits.'
      : sig.restDays < sig.daysSinceLoaded
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
      : `${sig.weeksSinceDeload} weeks without an easy week — this one is deliberately light.`
    // Deliberately not "strength lands during recovery". Only two controlled
    // trials of planned deloads exist and neither found a benefit; what is
    // well-established is what athletes *do* (about a week off every five or
    // six). The reduced-dose trial also did not detect a cost in the outcomes
    // it measured — which is not the same as proving there is none, so the
    // copy must not say "costs nothing" either.
    decisions.push({
      text: 'Scheduled easy week. Worth knowing this one is convention rather than proven: the two controlled trials of planned deloads found no performance benefit, and the one that reduced the dose did not detect a cost in what it measured — not proof that there is none. Backing off periodically is what almost every strength athlete does. Volume drops, the movements stay.',
      kind: 'info',
    })
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
  const cameraConsensusReliable = sig.cameraAgreementRate === null || sig.cameraAgreementRate >= 0.6
  if (cameraConsensusReliable && sig.meanCleanRatio !== null && sig.meanCleanRatio < 0.8) {
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

  // Reported, not acted on: drift cannot separate an athlete slipping from a
  // moving phone or a tracker that stayed on the wrong feature. Say exactly
  // that so a camera artefact never becomes a coaching accusation.
  if (
    cameraConsensusReliable &&
    sig.meanWobble !== null &&
    sig.meanWobble > 0.05 &&
    sig.cameraSetCount >= 3
  ) {
    decisions.push({
      text: 'The skeleton moved a lot across your recent clips. Scrub the replay: if the dots move with your body, stop the set before the position slides; if they drift off you, secure the phone and improve the lighting. This signal is not changing today\'s target by itself.',
      kind: 'info',
    })
  }

  if (
    sig.cameraAgreementRate !== null &&
    sig.cameraAgreementRate < 0.6 &&
    sig.cameraReviewedCount >= 3
  ) {
    const usable = Math.round(sig.cameraAgreementRate * sig.cameraReviewedCount)
    decisions.push({
      text: `Only ${usable} of ${sig.cameraReviewedCount} reviewed clips were confident and consistent with your rating. The coach is leaving those camera trends out of today's prescription; use the skeleton replay to improve the side view and lighting first.`,
      kind: 'info',
    })
  }

  // The quality axis the stopwatch cannot see. Report-only — the clean-ratio
  // caps above already do any acting, so this must never double-punish.
  if (
    cameraConsensusReliable &&
    sig.meanFormScore !== null &&
    sig.formScoreTrend !== null &&
    sig.cameraSetCount >= 4
  ) {
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
    // The fix depends on what went missing. Telling someone to move the phone
    // back when the problem is a hood over their ears is advice that cannot
    // work, and they will follow it for weeks before giving up on the check.
    const remedy =
      u.criterion === 'shoulder-to-ear line'
        ? 'That one is usually the head rather than the framing: a hood, long hair or a chin tucked hard into the chest hides the ear the measurement needs. Clear the ear and it comes back.'
        : 'Move the phone further back — or turn it sideways — until everything from hands to feet stays in frame.'
    decisions.push({
      text: `The camera missed your ${u.criterion} in ${u.count} of your last ${u.of} filmed sets, so that check keeps being skipped. ${remedy}`,
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
      source: 'load-advice',
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
      source: 'load-advice',
    })
  }

  // ——— The placement interview steers the first weeks ———
  //
  // A brand-new athlete has no logged form issues and no accessory trend, so
  // every signal-driven emphasis above stays silent and they get the generic
  // block. But they did tell us what was weak during placement, and that is
  // real information going unused. It only applies while history is thin —
  // once there are sessions to read, measured evidence outranks a self-report
  // from week one.
  if (accessoryEmphasis === 'none' && sig.totalSessions < 6 && state.assessment?.gapIds.length) {
    const fromGaps = emphasisFromGaps(state.assessment.gapIds)
    if (fromGaps !== 'none') {
      accessoryEmphasis = fromGaps
      limiter ??= {
        label: GAP_LIMITER_LABEL[fromGaps],
        evidence: 'From your placement answers — not yet from logged sessions.',
        prescription: GAP_LIMITER_PRESCRIPTION[fromGaps],
      }
    }
  }

  // ——— Warm-up adherence and readiness ———
  if (sig.skippedLastWarmup || sig.warmupRate < 0.7) {
    warmup = 'extended'
    decisions.push({
      text: 'Warm-ups have been getting skipped. Today includes the full one so wrists, elbows and shoulders are prepared before loading.',
      kind: 'warn',
    })
  } else if (sig.totalSessions > 0 && sig.restDays >= 4) {
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
    // Announced only once the rails have run (below): a pain, low-energy or
    // complaint day cancels the attempt, and the sentence used to survive it.
    queueUnlockAttempt = true
  }
  // Not on the first session back from a long gap: re-establishing working
  // evidence comes before a maximal test, and old numbers are not today's.
  let suggestMaxTest =
    (sig.daysSinceMaxTest === null ? sig.totalSessions >= 8 : sig.daysSinceMaxTest >= 21) &&
    sig.restDays >= 2 &&
    !longGap &&
    !sig.noisy &&
    dayType !== 'deload' &&
    !formRepairNeeded

  // ——— A named stall, and the one change it argues for ———
  //
  // Applied before the safety rails on purpose: a plateau prescription is a
  // training opinion, and a sore elbow outranks every training opinion. The
  // rails below still get the last word on strategy, day type and load.
  const plateau = diagnosePlateau(state, sig, now)
  if (plateau) {
    if (plateau.suggestStrategy && !formRepairNeeded) {
      strategy = plateau.suggestStrategy
      strategyOverrideReason = `your hold has been ${
        plateau.status === 'regressing' ? 'slipping' : 'flat'
      } and the evidence points at ${PLATEAU_REASON[plateau.cause]}.`
    }
    if (plateau.suggestDeload) {
      dayType = 'deload'
      dayReason = `Deload — ${plateau.weeksFlat} weeks flat with recovery debt behind it, so today backs off on purpose.`
    }
    // A plateau can *ask* for a re-test, but it does not get to bypass the
    // preconditions the suggestion already had. A max test on a day with no
    // rest behind it measures fatigue, and overriding the gate produced a plan
    // that said "your holds swung ±32%, this is measurement noise" and "you
    // are fresh and your numbers are steady" in the same breath. The later
    // rails still clear this flag on pain, elbow and persistent-complaint
    // days, so this is the floor rather than the last word.
    if (plateau.suggestMaxTest && dayType !== 'deload' && !formRepairNeeded && sig.restDays >= 2) {
      suggestMaxTest = true
    }
    // A stall is not the moment to also chase an unlock attempt.
    if (plateau.cause !== 'measurement-noise') queueUnlockAttempt = false
    limiter ??= {
      label: PLATEAU_LABEL_SHORT[plateau.cause],
      evidence: plateau.evidence,
      prescription: plateau.intervention,
    }
  }

  // ——————————————— SAFETY RAILS — these always win ———————————————
  const joints = sig.lastCheckIn?.joints
  const checkInAge = sig.daysSinceCheckIn
  const checkInFresh = checkInAge !== null && checkInAge <= 7

  const painRegions = sig.lastCheckIn?.regions ?? []
  const fromSetup = sig.lastCheckIn?.source === 'onboarding'
  const profileAge = state.profile.birthYear ? new Date(now).getFullYear() - state.profile.birthYear : null
  const youthNote =
    profileAge !== null && profileAge < 18
      ? ' If you are under 18, tell a parent, guardian or coach as well.'
      : ''
  if (checkInFresh && joints === 'pain') {
    dayType = 'recovery'
    dayReason = fromSetup
      ? 'At setup you said a plain push-up position hurts your wrists, so loaded planche work is off until a check-in says otherwise. Use only pain-free recovery movement.'
      : 'You reported joint pain — loaded planche work is off today. Use only pain-free recovery movement.'
    strategy = 'technique'
    targetFactor = 0.6
    volumeFactor = 0.5
    loadPermission = 'none'
    queueUnlockAttempt = false
    suggestMaxTest = false
    // Proportionate escalation rather than a diagnosis: next-day pain or
    // swelling in a wrist or elbow is the point where professional guidance
    // says to get it looked at, and that is what this says.
    decisions.push({
      text: `Joint pain reported — no loaded planche, pressing or wrist work today. Stop any movement that reproduces it. If it is still there the next day, keeps coming back, or there is swelling, get it checked by a qualified clinician; severe pain, numbness or a joint you cannot use normally needs prompt care.${youthNote}`,
      kind: 'warn',
    })
    for (const region of painRegions) {
      const note = REGION_PAIN_NOTE[region]
      if (note) decisions.push({ text: note, kind: 'warn' })
    }
  } else if (checkInFresh && joints === 'niggle') {
    if (strategy === 'intensity') strategy = 'balanced'
    targetFactor = Math.min(targetFactor, 1)
    volumeFactor = Math.min(volumeFactor, 0.85)
    warmup = 'extended'
    loadPermission = 'reduced'
    queueUnlockAttempt = false
    // "No max-intensity work" was said here while a max-test suggestion could
    // survive from earlier in the plan — the plan arguing with itself again.
    suggestMaxTest = false
    decisions.push({ text: 'You flagged a niggle — no max-intensity work today, longer warm-up, slightly less volume.', kind: 'warn' })
    for (const region of painRegions) {
      const note = REGION_NIGGLE_NOTE[region]
      if (note) decisions.push({ text: note, kind: 'warn' })
    }
    // An elbow is the one niggle that should stop straight-arm loading rather
    // than merely reduce it. The tissue that complains here is the biceps
    // tendon at its insertion, it is slow to settle, and a planche is the most
    // provocative thing an athlete could offer it.
    if (painRegions.includes('elbow')) {
      loadPermission = 'none'
      dayType = 'recovery'
      dayReason =
        'You flagged an elbow. Straight-arm loading is off today — this is the one complaint where training through it reliably turns weeks into months.'
      volumeFactor = Math.min(volumeFactor, 0.5)
      suggestMaxTest = false
    }
  }

  // ——— A complaint that is not settling outranks today's answer ———
  //
  // The best-supported rule available for loading irritated tissue is not
  // about any single session: it is that pain must not build week on week. An
  // athlete who reports the same elbow on most of their recent check-ins and
  // keeps training is following the exact path that turns a fortnight off into
  // a season off — and every per-session rail above will keep letting them
  // through, because on any given day it is only a niggle.
  const persistent = sig.persistentComplaint
  if (persistent && persistent.region !== 'other') {
    const label = REGION_NOUN[persistent.region]
    if (persistent.worsening || persistent.region === 'elbow') {
      loadPermission = 'none'
      dayType = 'recovery'
      strategy = 'technique'
      queueUnlockAttempt = false
      suggestMaxTest = false
      dayReason = `Your ${label} has been flagged in ${persistent.count} of your last ${persistent.of} check-ins${
        persistent.worsening ? ' and is getting worse, not better' : ''
      }. Loaded work is off until it settles.`
    } else {
      volumeFactor = Math.min(volumeFactor, 0.7)
      loadPermission = loadPermission === 'normal' ? 'reduced' : loadPermission
      queueUnlockAttempt = false
      // The non-escalating branch used to trim volume and nothing else, which
      // left the rest of the plan free to contradict it: an athlete told "the
      // current dose is more than it is tolerating" could be handed a push
      // day, a target increase and a max-test suggestion in the same breath.
      // A max test is the single most provocative thing you can offer tissue
      // that is already complaining.
      suggestMaxTest = false
      targetFactor = Math.min(targetFactor, 1)
      if (dayType === 'push') {
        dayType = 'build'
        dayReason = `You are fresh, but your ${label} has come up in ${persistent.count} of your last ${persistent.of} check-ins — so today builds rather than pushes.`
      }
      if (strategy === 'intensity') strategy = 'balanced'
    }
    decisions.push({
      text: `Your ${label} has come up in ${persistent.count} of your last ${persistent.of} check-ins${
        persistent.worsening ? ', and more of those were pain rather than a niggle than at the start' : ''
      }. A single sore day is normal; the same area not settling across weeks is the signal that the current dose is more than it is tolerating. A rule borrowed from supervised tendon rehabilitation (studied in knees and ankles, not wrists or elbows): discomfort should stay mild during and just after training, be back to normal by the next morning, and not build week on week. Yours is not doing that. ${
        persistent.worsening
          ? 'Please get it looked at by a clinician rather than working around it.'
          : 'Back the load off until it does, or get it looked at.'
      }`,
      kind: 'warn',
    })
  }

  // ——— A complaint nobody has updated is still a complaint ———
  //
  // The fresh-answer rails above only look back a week, so an unresolved pain
  // report used to lapse silently on day eight — and skipping the check-in was
  // enough to make it disappear. It is not a lockout: one check-in resolves it.
  // Until then the coach asks, and a reported *pain* keeps the day reduced and
  // free of maximal attempts.
  const openConcern = sig.lastCheckIn && sig.lastCheckIn.joints !== 'good' ? sig.lastCheckIn : null
  const staleConcern = openConcern !== null && !checkInFresh
  if (staleConcern && openConcern) {
    const where = (openConcern.regions ?? []).filter((r) => r !== 'other').map((r) => REGION_NOUN[r])
    const what = `${where.length ? `${where.join(' and ')} ` : ''}${openConcern.joints === 'pain' ? 'pain' : 'niggle'}`
    if (openConcern.joints === 'pain') {
      loadPermission = loadPermission === 'normal' ? 'reduced' : loadPermission
      volumeFactor = Math.min(volumeFactor, 0.85)
      targetFactor = Math.min(targetFactor, 1)
      queueUnlockAttempt = false
      suggestMaxTest = false
      if (dayType === 'push') {
        dayType = 'build'
        dayReason = `Your last report was ${what}, and nothing since has said how it is now — so today builds rather than pushes until a check-in updates it.`
      }
    }
    decisions.push({
      text: `Your last joint report (${checkInAge} days ago) was ${what}, and it has not been updated since. The check-in asks how it is now${
        openConcern.joints === 'pain' ? '; until then today stays reduced, with no maximal attempts' : ''
      }.`,
      kind: openConcern.joints === 'pain' ? 'warn' : 'info',
    })
  }

  // ——— Low energy: ordinary work, no maximal effort ———
  //
  // Tired used to trim volume and nothing else, so a tired athlete who had
  // started a max test was rerouted to a session that still queued an unlock
  // attempt — and still explained itself as "you're fresh, so today pushes".
  const tiredToday = checkInFresh && sig.lastCheckIn?.energy === 'tired'
  if (tiredToday) {
    volumeFactor = Math.min(volumeFactor, 0.85)
    targetFactor = Math.min(targetFactor, 1)
    queueUnlockAttempt = false
    suggestMaxTest = false
    if (dayType === 'push') {
      dayType = 'build'
      dayReason = 'You reported low energy, so today builds rather than pushes — ordinary sets, no maximal attempt.'
    }
    decisions.push({ text: 'You reported low energy — trimming volume and leaving out any maximal attempt so today still counts without digging a hole.', kind: 'info' })
  }

  // ——— Back after a break ———
  if (gap === 'break') {
    targetFactor = Math.min(targetFactor, 0.85)
    volumeFactor = Math.min(volumeFactor, 0.85)
    decisions.push({
      text: 'Coming back from a break: targets sit a little under your last numbers so the first sessions measure where you are now. No catch-up work, and no max test until you have a couple of sessions back under you.',
      kind: 'info',
    })
  } else if (gap === 'unknown') {
    decisions.push({
      text: `Your targets come from sessions ${sig.restDays} days ago. Treat the first sets as a check of where you are today rather than a promise of the old numbers.`,
      kind: 'info',
    })
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

  // ——— Tissue rails: applied last, where dayType is final ———
  //
  // These read the *load* rather than the athlete's report, so they belong
  // after the check-in rails: on a pain or deload day the volume is already
  // lower than anything they would ask for, and saying "volume stays where it
  // is" next to "no loaded work today" would be two answers to one question.
  const loadedDay = dayType !== 'deload' && dayType !== 'recovery'

  // The one place "you got stronger" means "add nothing".
  //
  // A fast jump in what you can hold is mostly a jump in *neural* drive and
  // skill: in the one study that measured all three monthly, strength rose
  // nearly 30% by month two while muscle cross-section and tendon stiffness
  // were both still unchanged. So the capacity of the tissue has not moved as
  // far as the stopwatch suggests, and this is precisely the moment an app
  // would normally reward the athlete with more work.
  //
  // Note this is deliberately *not* the popular "tendons lag muscle by two
  // months" claim, which the same time-course data does not support — on
  // detraining, muscle size decayed sooner than tendon did. The defensible
  // version is narrower: early gains outrun tissue change, so hold the dose.
  // It caps volume, not difficulty — an earned target rise still stands.
  const capabilityJump = readCapabilityJump(state, state.stepId, now)
  if (capabilityJump && loadedDay) {
    volumeFactor = Math.min(volumeFactor, 0.85)
    decisions.push({
      text: `Your verified hold has gone from about ${capabilityJump.fromSec}s — typical before the last two weeks — to ${capabilityJump.toSec}s within them. Volume is being held rather than raised to match. A climb that fast is mostly your nervous system learning the position rather than new tissue — measured strength can climb by a third while muscle and tendon are both still unchanged — so the structures carrying the load have not caught up with what the stopwatch says. Reasoning rather than a measured rule, and it costs you almost nothing to respect.`,
      kind: 'info',
    })
  }

  const ramp = readLoadRamp(state, now)
  // Never tell someone training barely once a week that they are ramping too
  // fast. Their baseline is so small that a single normal session clears the
  // threshold, and the plateau diagnosis is simultaneously telling them the
  // problem is too little exposure — two opposite instructions in one plan.
  const enoughVolumeToRamp = sig.sessionsPerWeek >= 2
  if (ramp?.rampingFast && loadedDay && enoughVolumeToRamp) {
    volumeFactor = Math.min(volumeFactor, 0.85)
    decisions.push({
      text: `Last week's planche-specific load was ${Math.round(
        ramp.ratio * 100,
      )}% of your typical week over the month before — above the ${Math.round(
        MAX_WEEKLY_LOAD_RAMP * 100,
      )}% this app allows. That limit is a cautious design choice, not a proven safety threshold — the 10%-a-week rule it resembles did not reduce injuries in its trial. Today is trimmed to bring it back in line. Load here is weighted by how hard each position is, so a long easy lean does not count the same as a short advanced tuck.`,
      kind: 'warn',
    })
  }

  // ——— The plateau, said only once the rails have decided today ———
  //
  // A plateau prescription is a training opinion and the rails outrank it, so
  // the sentence has to be written after they have run. The failure this
  // avoids was visible in the app: an athlete with a recurring elbow was told
  // "loaded work is off until it settles" and, two lines later, "two or three
  // sessions a week will move this number more than anything else" — the plan
  // arguing with itself about whether to train at all.
  if (plateau) {
    const stalled = `${
      plateau.status === 'regressing' ? 'Your key hold has been going backwards' : 'Your key hold has been flat'
    } for about ${plateau.weeksFlat} week${plateau.weeksFlat === 1 ? '' : 's'}. ${plateau.evidence}`
    decisions.push({
      source: 'plateau',
      kind: plateau.cause === 'measurement-noise' ? 'info' : 'warn',
      text:
        loadPermission === 'none'
          ? `${stalled} That is worth fixing, but not today — what you reported comes first, and the plan returns to it once you are training loaded again.`
          : `${stalled} ${plateau.intervention}`,
    })
  }

  // Progress that came from the shape rather than the strength.
  const drift = readDifficultyDrift(state, state.stepId, now)
  if (drift && drift.deltaPct < 0) {
    decisions.push({
      text: `Your recent holds on this step are being performed in a measurably easier position than they were a few weeks ago — the hips have drifted about ${Math.round(
        Math.abs(drift.deltaPct) * 100,
      )}% toward the next-easiest shape. A longer time in an easier position is not the same as getting stronger, so it is worth checking the side-on replay against the position checklist before trusting the trend.`,
      kind: 'warn',
    })
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
  // Younger athletes recover well, but joint feedback matters while they are
  // growing. Ask the same two quick questions a little more often; do not
  // lower earned performance or progression credit based on age.
  const routineCheckInterval = profileAge !== null && profileAge < 16 ? 2 : 3
  // A complaint made outside a pre-session check-in — at setup, or at the end
  // of an attempt — is asked about before the next session, including the
  // very first one. So is a complaint nobody has updated in over a week.
  const concernNeedsUpdate =
    openConcern !== null &&
    !freshCheckIn &&
    (staleConcern || openConcern.source === 'onboarding' || openConcern.source === 'attempt')
  const askCheckIn =
    injuryCheckDue ||
    concernNeedsUpdate ||
    (sig.totalSessions >= 1 &&
      (checkInAge === null ||
        checkInAge >= routineCheckInterval ||
        (sig.lastRpe ?? 0) >= 9 ||
        sig.restDays >= 5 ||
        (checkInFresh && joints !== 'good' && checkInAge >= 2)))

  // One permission for maximal effort, applied to everything that creates it.
  const challengeAllowed = loadPermission === 'normal' && !tiredToday
  queueUnlockAttempt = queueUnlockAttempt && challengeAllowed
  suggestMaxTest = suggestMaxTest && challengeAllowed
  if (queueUnlockAttempt) {
    decisions.push({
      text: `You're within reach of the ${step.unlockSec}s bar — an unlock attempt is queued first, while you're freshest.`,
      kind: 'good',
    })
  }

  if (state.profile.injuryNote?.trim() && (checkInAge === null || checkInAge >= 2)) {
    decisions.push({
      text: `Your profile notes a prior or current issue (“${state.profile.injuryNote.trim().slice(0, 80)}”). The check-in gets the final say before loading today.`,
      kind: 'warn',
    })
  }

  decisions.push(...equipmentAdvice(state, joints))

  // Said out loud, not just returned: this flag used to be computed and then
  // shown nowhere, so the one day it fired the athlete never heard about it.
  if (suggestMaxTest) {
    decisions.push({
      // "Steady" is a claim about the numbers, and it was being printed on
      // exactly the days the coach had just called them too noisy to read.
      text: sig.noisy
        ? `Your recent holds have been swinging too much to read a trend from${
            sig.daysSinceMaxTest === null ? '' : `, and it has been ${sig.daysSinceMaxTest} days since your last max test`
          }. You are fresh today, so a clean max test would give every target a real number to sit on instead of an average of scatter.`
        : sig.daysSinceMaxTest === null
          ? 'You are fresh and your numbers are steady — a first max test today would calibrate every target the coach sets.'
          : `It has been ${sig.daysSinceMaxTest} days since your last max test and you are fresh today — a re-test would recalibrate your targets.`,
      kind: 'info',
    })
  }

  // ——— Last word: nothing survives that argues with today's rails ———
  //
  // Advice about adding loaded work is written earlier in the plan, before the
  // rails know whether loading is happening at all. On a pain or recovery day
  // the session contains none of it, so lines like "adding pressing volume"
  // describe a workout the athlete will not be given. Drop them, and drop the
  // limiter chip with them — on a day like this the limiter is the complaint,
  // not a training quality.
  const loadForbidden = loadPermission === 'none'
  const finalDecisions = loadForbidden ? decisions.filter((d) => d.source !== 'load-advice') : decisions
  const finalLimiter = loadForbidden ? null : limiter

  if (finalDecisions.length === 0) {
    finalDecisions.push({
      // Not "your best-performing setup": with nothing measured yet that was a
      // claim of superiority the log could not support.
      text: 'Everything looks steady — today runs the plan as set.',
      kind: 'good',
    })
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
    limiter: finalLimiter,
    plateau,
    capabilityJump,
    volumeFactor: clampTo(volumeFactor, LIMITS.volume),
    loadPermission,
    challengeAllowed,
    gap,
    openConcern,
    askCheckIn,
    decisions: finalDecisions,
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
