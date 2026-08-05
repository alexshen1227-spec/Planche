import type { AppState, CheckIn, Session, SetLog, StepId, StrategyId } from '../types'
import { STEP_BY_ID } from '../data/progressions'
import { initialState } from './store'

/**
 * Training histories built from known truth, for testing the coach.
 *
 * The form judge has `poseSynth`: skeletons built *from* the angles you chose,
 * so a verdict can be checked against an answer nobody had to guess. The coach
 * had no equivalent — its tests were hand-built fixtures asserting one branch
 * each, which cannot answer the question that actually matters: *given an
 * athlete who genuinely responds to volume, does the coach work that out?*
 *
 * So this generates an athlete. You state what is true about them — which
 * stimulus their body answers, how fast they gain, how honestly they film, how
 * hard they push, when they took a fortnight off — and it produces the session
 * history a person like that would leave behind. The coach then has to
 * rediscover the truth from the log alone.
 *
 * The generator deliberately knows nothing about `coach.ts`. It models an
 * athlete, not the thing under test.
 */

export interface AthleteParams {
  weeks?: number
  sessionsPerWeek?: number
  stepId?: StepId
  /**
   * The stimulus this body actually answers. Sessions using it move capacity;
   * the others hold it roughly steady. `null` means nothing works — a
   * genuinely plateaued athlete, which the coach must not mistake for signal.
   */
  respondsTo?: StrategyId | null
  /** Hold seconds on the key exercise at the start of the history. */
  startSec?: number
  /** Seconds of real capacity gained per week, from the responding stimulus. */
  gainPerWeek?: number
  /** Day-to-day swing as a fraction of the hold — sleep, caffeine, mood. */
  noise?: number
  /** Session RPE, or a function of week for a fatiguing athlete. */
  rpe?: number | ((week: number) => number)
  /** Share of main sets carrying camera evidence. */
  filmedRate?: number
  /** Share of main sets the athlete rates Clean. */
  cleanRate?: number
  /** Camera-measured clean share on filmed sets. */
  cameraCleanRatio?: number
  /** Days between the final session and "now". */
  restDaysBeforeNow?: number
  /** Attached to every session, so the coach sees a consistent athlete. */
  checkIn?: CheckIn
  /** A gap in the middle of the history, in days — illness, holiday, exams. */
  layoffDays?: number
  /** Include the accessory work that makes a session read as real load. */
  accessories?: boolean
  /**
   * How the strategies are ordered through the history.
   *
   * `varied` (the default) mixes them the way the real bandit does once it has
   * estimates to act on. `rotation` walks them in a strict cycle, which is the
   * pathological case: the sessions on either side of a gain always carry the
   * same two strategies, so the true cause and its neighbours are perfectly
   * confounded and no amount of data can separate them.
   */
  strategyOrder?: 'varied' | 'rotation'
  seed?: number
  now?: number
}

const DAY = 86_400_000
const ROTATION: StrategyId[] = ['balanced', 'volume', 'intensity', 'density', 'technique']

/** Deterministic noise — an athlete who is different every run proves nothing. */
function rng(seed: number) {
  let state = (seed >>> 0) || 1
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

function holdSet(
  exerciseId: string,
  value: number,
  at: number,
  section: SetLog['section'],
  form?: SetLog['form'],
): SetLog {
  return {
    exerciseId,
    kind: 'hold',
    value: Math.round(value * 10) / 10,
    target: Math.round(value),
    section,
    at,
    ...(form ? { form } : {}),
  }
}

/**
 * The sessions an athlete like this would leave behind.
 *
 * Capacity moves only after a session that used the stimulus they respond to,
 * which is precisely the relationship `rewardFor` is trying to detect: it
 * compares a strategy session against the sessions that follow it.
 */
export function synthesizeAthlete(params: AthleteParams = {}): Session[] {
  const {
    weeks = 8,
    sessionsPerWeek = 3,
    stepId = 'tuck',
    respondsTo = 'volume',
    startSec = 8,
    gainPerWeek = 1.2,
    noise = 0.08,
    rpe = 7,
    filmedRate = 1,
    cleanRate = 1,
    cameraCleanRatio = 1,
    restDaysBeforeNow = 2,
    checkIn,
    layoffDays = 0,
    accessories = true,
    strategyOrder = 'varied',
    seed = 1,
    now = Date.now(),
  } = params

  const rand = rng(seed)
  const step = STEP_BY_ID[stepId]
  const keyId = step.keyExerciseId
  const totalSessions = weeks * sessionsPerWeek
  const gainPerResponding = gainPerWeek / sessionsPerWeek
  const sessions: Session[] = []

  let capacity = startSec
  let rotationIndex = 0
  // Walk backwards from now so the final session sits at the requested rest.
  const lastAt = now - restDaysBeforeNow * DAY
  const spacingDays = 7 / sessionsPerWeek
  const layoffAfter = layoffDays > 0 ? Math.floor(totalSessions / 2) : -1

  for (let i = 0; i < totalSessions; i++) {
    // Evenly spaced back from the most recent session. Everything before the
    // layoff point is pushed further into the past, which opens the gap.
    const fromEnd = totalSessions - 1 - i
    const beforeLayoff = layoffAfter >= 0 && i <= layoffAfter
    const startedAt = Math.round(
      lastAt - fromEnd * spacingDays * DAY - (beforeLayoff ? layoffDays * DAY : 0),
    )
    // A varied order is what the real bandit produces: it plays its current
    // favourite most and explores the rest, so the strategies neighbouring a
    // gain change from one week to the next. Every arm still gets played.
    const strategy =
      strategyOrder === 'rotation'
        ? ROTATION[rotationIndex % ROTATION.length]
        : ROTATION[(rotationIndex + Math.floor(rand() * ROTATION.length)) % ROTATION.length]
    rotationIndex += 1
    const week = Math.floor(i / sessionsPerWeek)

    const sets: SetLog[] = []
    let clock = startedAt
    const push = (s: SetLog) => {
      sets.push(s)
      clock += 150_000
    }

    // Main work: five sets, the last one the athlete's best effort.
    for (let setIndex = 0; setIndex < 5; setIndex++) {
      const swing = 1 + (rand() - 0.5) * 2 * noise
      const isTop = setIndex === 4
      const value = Math.max(1, capacity * (isTop ? 1 : 0.7) * swing)
      const filmed = rand() < filmedRate
      const rated = rand() < cleanRate ? 'clean' : 'slipped'
      push(
        holdSet(keyId, value, clock, 'main', {
          rating: rated,
          confirmed: true,
          ...(filmed
            ? {
                flightConfirmed: true,
                auto: {
                  issues: [],
                  confidence: 0.9,
                  score: 88,
                  cleanSeconds: Math.round(value * cameraCleanRatio * 10) / 10,
                  cleanRatio: cameraCleanRatio,
                },
              }
            : {}),
        }),
      )
    }

    if (accessories) {
      // Enough real load that these read as training rather than upkeep.
      push({ exerciseId: 'pppu', kind: 'reps', value: 6, target: 6, section: 'strength', at: clock })
      push({ exerciseId: 'pppu', kind: 'reps', value: 6, target: 6, section: 'strength', at: clock })
      push(holdSet('hollow-hold', 30, clock, 'core'))
      push(holdSet('wrist-stretch', 30, clock, 'cooldown'))
    }

    sessions.push({
      id: `synth-${i}`,
      startedAt,
      endedAt: clock,
      workoutName: 'Training Day',
      workoutKind: 'auto',
      stepId,
      sets,
      rpe: typeof rpe === 'function' ? rpe(week) : rpe,
      strategy,
      ...(checkIn ? { checkIn } : {}),
    })

    // Capacity answers only the stimulus this athlete responds to.
    if (respondsTo && strategy === respondsTo) capacity += gainPerResponding * ROTATION.length
  }

  return sessions.sort((a, b) => a.startedAt - b.startedAt)
}

export interface SeasonResult {
  state: AppState
  plans: {
    dayType: string
    targetFactor: number
    strategy: StrategyId
    prescribed: number
    suggestMaxTest: boolean
  }[]
  /** Logged best on the key exercise, session by session. */
  performance: number[]
  /** True capacity, session by session — what the athlete could have done. */
  capacity: number[]
}

/**
 * Train an athlete *through* the coach, week after week.
 *
 * Every test above is open-loop: a fixed history goes in and one plan comes
 * out. But the coach's advice changes what the athlete does next, and that
 * output becomes its next input — which is where the interesting failures
 * live. A rule that quietly ratchets the target down feeds itself: lower
 * target, lower logged seconds, lower target again. Nothing in a single-plan
 * test can see that; a season can.
 *
 * The athlete here is cooperative and honest: they train to the prescribed
 * target, stop about there, and their body answers only the stimulus they
 * actually respond to. Anything bad that happens to them over a season is
 * therefore the coach's doing.
 */
export function simulateSeason(
  params: AthleteParams & {
    weeks?: number
    /**
     * How the athlete relates to the prescribed number.
     *
     * `to-capacity` is the athlete the app coaches: working sets at the
     * target, last set taken near the limit. `to-target` is the perfectly
     * obedient one who never exceeds what they were asked for — worth
     * simulating because the working target is a fraction of recent bests, so
     * a log that only ever echoes the target back feeds itself downward.
     */
    compliance?: 'to-capacity' | 'to-target'
  } = {},
  buildPlanFn: (
    state: AppState,
    now: number,
  ) => { dayType: string; targetFactor: number; strategy: StrategyId; suggestMaxTest: boolean },
  adaptiveTargetFn: (state: AppState, stepId: StepId) => number,
  applySessionFn: (state: AppState, session: Session) => { next: AppState },
): SeasonResult {
  const {
    weeks = 12,
    sessionsPerWeek = 3,
    stepId = 'tuck',
    respondsTo = 'volume',
    startSec = 8,
    gainPerWeek = 1.2,
    noise = 0.06,
    seed = 1,
    now = Date.now(),
    compliance = 'to-capacity',
  } = params

  const rand = rng(seed)
  const keyId = STEP_BY_ID[stepId].keyExerciseId
  const spacingMs = (7 / sessionsPerWeek) * DAY
  const total = weeks * sessionsPerWeek
  const start = now - total * spacingMs

  let state: AppState = {
    ...initialState(),
    onboarded: true,
    stepId,
    baseStepId: stepId,
    unlocked: Object.values(STEP_BY_ID)
      .filter((s) => s.order <= STEP_BY_ID[stepId].order)
      .map((s) => s.id),
  }
  let capacity = startSec
  const plans: SeasonResult['plans'] = []
  const performance: number[] = []
  const capacityTrail: number[] = []

  for (let i = 0; i < total; i++) {
    const at = Math.round(start + i * spacingMs)
    const plan = buildPlanFn(state, at)
    // What the coach actually asks for today.
    const prescribed = Math.max(1, adaptiveTargetFn(state, stepId) * plan.targetFactor)
    plans.push({
      dayType: plan.dayType,
      targetFactor: plan.targetFactor,
      strategy: plan.strategy,
      prescribed,
      suggestMaxTest: plan.suggestMaxTest,
    })

    const sets: SetLog[] = []
    let clock = at
    const push = (s: SetLog) => {
      sets.push(s)
      clock += 150_000
    }
    // Working sets sit at the prescribed target; the final set is taken close
    // to the limit, which is what the app's own coaching tells an athlete to
    // do ("finish about two seconds before you would collapse"). That last set
    // is what makes the log reflect capacity rather than merely echoing the
    // target back — see the `compliance` note below.
    for (let setIndex = 0; setIndex < 5; setIndex++) {
      const swing = 1 + (rand() - 0.5) * 2 * noise
      const topSet = setIndex === 4
      const ceiling =
        topSet && compliance === 'to-capacity'
          ? capacity
          : Math.min(capacity, prescribed * (topSet ? 1.05 : 0.8))
      const value = Math.max(1, ceiling * swing)
      push(
        holdSet(keyId, value, clock, 'main', {
          rating: 'clean',
          confirmed: true,
          flightConfirmed: true,
          auto: { issues: [], confidence: 0.9, score: 88, cleanSeconds: value, cleanRatio: 1 },
        }),
      )
    }
    push({ exerciseId: 'pppu', kind: 'reps', value: 6, target: 6, section: 'strength', at: clock })
    push(holdSet('hollow-hold', 30, clock, 'core'))

    const best = Math.max(...sets.filter((s) => s.exerciseId === keyId).map((s) => s.value))
    performance.push(best)
    capacityTrail.push(capacity)

    state = applySessionFn(state, {
      id: `season-${i}`,
      startedAt: at,
      endedAt: clock,
      workoutName: plan.dayType === 'deload' ? 'Deload Flow' : 'Training Day',
      workoutKind: 'auto',
      stepId,
      sets,
      rpe: plan.dayType === 'push' ? 8 : 7,
      strategy: plan.strategy,
    }).next

    // The body answers the right stimulus, and only when actually loaded.
    const loaded = plan.dayType !== 'recovery' && plan.dayType !== 'deload'
    if (loaded && respondsTo && plan.strategy === respondsTo) {
      capacity += (gainPerWeek / sessionsPerWeek) * ROTATION.length
    }
  }

  return { state, plans, performance, capacity: capacityTrail }
}

/** A full app state for an athlete like this, ready to hand to the coach. */
export function synthesizeAthleteState(
  params: AthleteParams = {},
  overrides: Partial<AppState> = {},
): AppState {
  const sessions = synthesizeAthlete(params)
  const stepId = params.stepId ?? 'tuck'
  const order = STEP_BY_ID[stepId].order
  const base = initialState()
  return {
    ...base,
    onboarded: true,
    stepId,
    baseStepId: stepId,
    unlocked: Object.values(STEP_BY_ID)
      .filter((s) => s.order <= order)
      .map((s) => s.id),
    sessions,
    ...overrides,
    profile: { ...base.profile, ...overrides.profile },
  }
}
