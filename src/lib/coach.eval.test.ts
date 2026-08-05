import { describe, expect, it } from 'vitest'
import type { AppState, CheckIn, Session, StrategyId } from '../types'
import { armStats, buildPlan, coachConfidence, pickStrategy } from './coach'
import { readSignals } from './signals'
import {
  simulateSeason,
  synthesizeAthlete,
  synthesizeAthleteState,
  type AthleteParams,
} from './athleteSynth'
import { adaptiveTarget } from '../data/workouts'
import { applySession } from './engine'
import { initialState } from './store'
import { addDays, weekStart } from './time'

/**
 * Accuracy and safety eval for the coach.
 *
 * The unit tests next door pin individual branches. These ask the questions an
 * athlete would: given someone who genuinely responds to one kind of session,
 * does the coach find it? Given someone in pain, does it back off every time?
 * And does it ever say something untrue — a placeholder number, a NaN, a
 * sentence contradicting the plan it just made?
 *
 * Assertions are deliberately about properties rather than exact wording, so
 * the copy can be improved without a test rewrite, while anything the athlete
 * could act on stays pinned.
 */

const STRATEGIES: StrategyId[] = ['balanced', 'volume', 'intensity', 'density', 'technique']

/** Everything the coach says today, as one string. */
function allText(state: AppState, now = Date.now(), checkIn?: CheckIn): string {
  const plan = buildPlan(state, now, checkIn)
  return [
    plan.dayReason,
    plan.strategyReason,
    plan.limiter?.label,
    plan.limiter?.evidence,
    plan.limiter?.prescription,
    ...plan.decisions.map((d) => d.text),
  ]
    .filter(Boolean)
    .join(' \n ')
}

describe('the coach finds what actually works', () => {
  for (const responder of STRATEGIES) {
    it(`identifies an athlete who responds to ${responder}`, () => {
      // Enough history for every arm to have been tried several times, and a
      // response big enough that a coach paying attention cannot miss it.
      const state = synthesizeAthleteState({
        weeks: 16,
        sessionsPerWeek: 3,
        respondsTo: responder,
        gainPerWeek: 2,
        noise: 0.04,
        seed: 5,
      })
      const ranked = [...armStats(state)].sort((a, b) => b.mean - a.mean)
      expect(ranked[0].id).toBe(responder)
      // And it must have real evidence behind that answer, not a lucky draw.
      expect(ranked[0].n).toBeGreaterThanOrEqual(2)
    })
  }

  it('does not invent a winner for an athlete nothing works on', () => {
    const state = synthesizeAthleteState({
      weeks: 14,
      respondsTo: null,
      gainPerWeek: 0,
      noise: 0.06,
      seed: 9,
    })
    const stats = armStats(state)
    const spread = Math.max(...stats.map((s) => s.mean)) - Math.min(...stats.map((s) => s.mean))
    // Shrinkage should keep a flat athlete's arms close together rather than
    // crowning whichever one caught the kindest noise.
    expect(spread).toBeLessThan(0.1)
  })

  it('will not claim a winner when the leader is only nominally ahead', () => {
    // A gain shows up in the sessions on either side of the one that caused
    // it, so under a strict rotation the neighbouring strategies collect
    // near-identical credit: measured directly, balanced/volume/intensity all
    // earned 0.2475 on a noiseless history. The ranking still has to order
    // them, but the coach must not narrate a rounding error as a finding.
    const confounded = synthesizeAthleteState({
      weeks: 16,
      respondsTo: 'balanced',
      gainPerWeek: 2,
      noise: 0,
      strategyOrder: 'rotation',
      seed: 5,
    })
    const stats = [...armStats(confounded)].sort((a, b) => b.mean - a.mean)
    const lead = (stats[0].mean - stats[1].mean) * 20
    expect(lead).toBeLessThan(0.5)
    const pick = pickStrategy(confounded)
    if (!pick.exploring) {
      expect(pick.reason).toMatch(/neck and neck|holding up best/)
      expect(pick.reason).not.toMatch(/fastest gains/)
    }
  })

  it('still names a clear winner when one genuinely is ahead', () => {
    const decided = synthesizeAthleteState({
      weeks: 18,
      respondsTo: 'volume',
      gainPerWeek: 3,
      noise: 0.03,
      seed: 11,
    })
    const stats = [...armStats(decided)].sort((a, b) => b.mean - a.mean)
    // Only assert the wording when the evidence really does separate them.
    if ((stats[0].mean - stats[1].mean) * 20 >= 0.5) {
      const pick = pickStrategy(decided)
      if (!pick.exploring) expect(pick.reason).toMatch(/fastest gains/)
    }
    expect(stats[0].id).toBe('volume')
  })

  it('reports how much evidence it is standing on', () => {
    const thin = synthesizeAthleteState({ weeks: 1, sessionsPerWeek: 2, seed: 2 })
    const thick = synthesizeAthleteState({ weeks: 16, seed: 2 })
    expect(coachConfidence(thin).evaluated).toBeLessThan(coachConfidence(thick).evaluated)
    expect(coachConfidence(thick).tested).toBeGreaterThan(0)
  })

  it('keeps learning from an athlete who never films a single set', () => {
    // The bar for learning is deliberately lower than the unlock bar.
    const state = synthesizeAthleteState({
      weeks: 16,
      respondsTo: 'density',
      gainPerWeek: 2,
      filmedRate: 0,
      noise: 0.04,
      seed: 4,
    })
    const ranked = [...armStats(state)].sort((a, b) => b.mean - a.mean)
    expect(ranked[0].id).toBe('density')
    expect(coachConfidence(state).evaluated).toBeGreaterThan(0)
  })
})

describe('safety rails always get the last word', () => {
  const painful: CheckIn = { at: Date.now(), joints: 'pain', energy: 'tired' }

  it('never prescribes loaded pushing on a pain day, whatever the history says', () => {
    for (const responder of STRATEGIES) {
      for (const seed of [1, 2, 3]) {
        const state = synthesizeAthleteState({
          weeks: 12,
          respondsTo: responder,
          gainPerWeek: 3,
          seed,
        })
        const plan = buildPlan(state, Date.now(), painful)
        expect(plan.loadPermission).not.toBe('normal')
        expect(plan.dayType).not.toBe('push')
        expect(plan.queueUnlockAttempt).toBe(false)
      }
    }
  })

  it('keeps every prescription inside its hard limits across wildly different athletes', () => {
    const shapes: AthleteParams[] = [
      { weeks: 1, sessionsPerWeek: 1 },
      { weeks: 30, sessionsPerWeek: 5, gainPerWeek: 6 },
      { weeks: 12, rpe: 10, cleanRate: 0.2, cameraCleanRatio: 0.3 },
      { weeks: 12, rpe: 6, gainPerWeek: 0, respondsTo: null },
      { weeks: 20, layoffDays: 45, restDaysBeforeNow: 40 },
      { weeks: 6, startSec: 0.5, gainPerWeek: 0.1 },
      { weeks: 6, startSec: 300, gainPerWeek: 40 },
    ]
    for (const shape of shapes) {
      for (const seed of [1, 7]) {
        const plan = buildPlan(synthesizeAthleteState({ ...shape, seed }))
        expect(plan.targetFactor).toBeGreaterThanOrEqual(0.6)
        expect(plan.targetFactor).toBeLessThanOrEqual(1.3)
        expect(plan.setsDelta).toBeGreaterThanOrEqual(-2)
        expect(plan.setsDelta).toBeLessThanOrEqual(3)
        expect(plan.restMainSec).toBeGreaterThanOrEqual(60)
        expect(plan.restMainSec).toBeLessThanOrEqual(240)
        expect(plan.restAccessorySec).toBeGreaterThanOrEqual(30)
        expect(plan.restAccessorySec).toBeLessThanOrEqual(150)
        expect(plan.volumeFactor).toBeGreaterThanOrEqual(0.5)
        expect(plan.volumeFactor).toBeLessThanOrEqual(1)
        expect(Number.isFinite(plan.targetFactor)).toBe(true)
      }
    }
  })

  it('eases off an athlete who is grinding at RPE 10 with collapsing form', () => {
    const grinding = synthesizeAthleteState({
      weeks: 10,
      rpe: 10,
      cleanRate: 0.15,
      cameraCleanRatio: 0.35,
      gainPerWeek: 0,
      respondsTo: null,
      seed: 3,
    })
    const plan = buildPlan(grinding)
    // Either the day itself backs off, or the target does. Something must.
    const backedOff =
      plan.dayType === 'technique' ||
      plan.dayType === 'deload' ||
      plan.dayType === 'recovery' ||
      plan.targetFactor < 1
    expect(backedOff).toBe(true)
  })

  it('does not schedule a max test for someone who just trained hard', () => {
    const fresh = synthesizeAthleteState({ weeks: 8, restDaysBeforeNow: 0, rpe: 9, seed: 6 })
    expect(buildPlan(fresh).suggestMaxTest).toBe(false)
  })
})

describe('the coach never says anything untrue', () => {
  /**
   * Placeholders, NaN and undefined reaching a sentence is not cosmetic: this
   * app shipped "No hard training in 99 days" to athletes who had trained two
   * days earlier, because a sentinel was printed as a day count. This sweeps a
   * wide space of athletes looking for any recurrence.
   */
  it('never leaks a sentinel, NaN or undefined into anything it says', () => {
    const offenders: string[] = []
    const checkIns: (CheckIn | undefined)[] = [
      undefined,
      { at: Date.now(), joints: 'good', energy: 'fresh' },
      { at: Date.now(), joints: 'niggle', energy: 'ok' },
      { at: Date.now(), joints: 'pain', energy: 'tired' },
    ]
    let cases = 0
    for (const weeks of [0, 1, 2, 5, 12, 26]) {
      for (const sessionsPerWeek of [1, 3, 5]) {
        for (const responder of [null, 'volume', 'technique'] as const) {
          for (const restDaysBeforeNow of [0, 1, 3, 9, 40]) {
            for (const checkIn of checkIns) {
              const state =
                weeks === 0
                  ? { ...initialState(), onboarded: true }
                  : synthesizeAthleteState({
                      weeks,
                      sessionsPerWeek,
                      respondsTo: responder,
                      restDaysBeforeNow,
                      rpe: 8,
                      seed: weeks + sessionsPerWeek,
                    })
              cases++
              const text = allText(state, Date.now(), checkIn)
              const bad = text.match(/\bNaN\b|\bundefined\b|\bnull\b|\bInfinity\b|\b99 days\b|-\d+ days/)
              if (bad) offenders.push(`${weeks}w/${sessionsPerWeek}pw/${responder}/${restDaysBeforeNow}d: ${bad[0]}`)
            }
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(200)
    expect(offenders.slice(0, 5)).toEqual([])
  })

  it('never quotes a percentage or day count that is not a real number', () => {
    const offenders: string[] = []
    for (const weeks of [1, 3, 8, 20]) {
      for (const seed of [1, 2, 3, 4]) {
        const text = allText(synthesizeAthleteState({ weeks, seed, gainPerWeek: 2 }))
        for (const num of text.match(/-?\d+(\.\d+)?/g) ?? []) {
          if (!Number.isFinite(Number(num))) offenders.push(`${weeks}w seed${seed}: ${num}`)
        }
        // A percentage of "0%" reads as a change that did not happen.
        if (/\b0%\b/.test(text)) offenders.push(`${weeks}w seed${seed}: 0% change quoted`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('does not both raise and lower the target in the same breath', () => {
    for (const weeks of [4, 8, 16]) {
      for (const seed of [1, 3, 5]) {
        for (const cleanRate of [0.2, 1]) {
          const text = allText(synthesizeAthleteState({ weeks, seed, cleanRate }))
          const up = /nudging the target up/.test(text)
          const down = /easing the target back/.test(text)
          expect(`${weeks}/${seed}/${cleanRate} up=${up} down=${down}`).not.toBe(
            `${weeks}/${seed}/${cleanRate} up=true down=true`,
          )
        }
      }
    }
  })

  it('keeps the day type and what it says about the day consistent', () => {
    for (const weeks of [3, 9, 18]) {
      for (const seed of [2, 4]) {
        const state = synthesizeAthleteState({ weeks, seed })
        const plan = buildPlan(state)
        const text = [plan.dayReason, ...plan.decisions.map((d) => d.text)].join(' ')
        if (plan.dayType === 'deload' || plan.dayType === 'recovery') {
          // A backing-off day must not also be telling the athlete to push.
          expect(/so today pushes/.test(text)).toBe(false)
        }
        if (plan.loadPermission === 'none') {
          expect(plan.queueUnlockAttempt).toBe(false)
        }
      }
    }
  })
})

describe('the plan is stable and proportionate', () => {
  it('does not swing wildly from one day to the next for a steady athlete', () => {
    const state = synthesizeAthleteState({ weeks: 14, noise: 0.05, seed: 12 })
    const now = Date.now()
    const factors: number[] = []
    for (let day = 0; day < 5; day++) factors.push(buildPlan(state, now + day * 86_400_000).targetFactor)
    const swing = Math.max(...factors) - Math.min(...factors)
    // The athlete has not trained in between, so nothing justifies a lurch.
    expect(swing).toBeLessThanOrEqual(0.2)
  })

  it('keeps the briefing short enough to read between sets', () => {
    for (const weeks of [2, 8, 20, 40]) {
      for (const seed of [1, 5]) {
        const plan = buildPlan(synthesizeAthleteState({ weeks, seed, cleanRate: 0.5, rpe: 9 }))
        expect(plan.decisions.length).toBeGreaterThan(0)
        expect(plan.decisions.length).toBeLessThanOrEqual(8)
        // No two bullets saying the same thing.
        expect(new Set(plan.decisions.map((d) => d.text)).size).toBe(plan.decisions.length)
      }
    }
  })

  it('queues an unlock attempt only when the athlete is genuinely near the bar', () => {
    // Far below the 20s tuck bar: nothing to attempt yet.
    const early = synthesizeAthleteState({ weeks: 8, startSec: 4, gainPerWeek: 0.2, seed: 3 })
    expect(buildPlan(early).queueUnlockAttempt).toBe(false)
    // Already past it: the unlock is earned by logging, not by queueing.
    const past = synthesizeAthleteState({ weeks: 10, startSec: 30, gainPerWeek: 1, seed: 3 })
    expect(buildPlan(past).queueUnlockAttempt).toBe(false)
  })

  it('never claims an unlock attempt while refusing to load the athlete', () => {
    for (const seed of [1, 2, 3, 4]) {
      for (const checkIn of [
        { at: Date.now(), joints: 'pain', energy: 'tired' } as CheckIn,
        { at: Date.now(), joints: 'niggle', energy: 'ok' } as CheckIn,
      ]) {
        const plan = buildPlan(synthesizeAthleteState({ weeks: 12, startSec: 18, seed }), Date.now(), checkIn)
        if (plan.loadPermission !== 'normal') expect(plan.queueUnlockAttempt).toBe(false)
      }
    }
  })

  it('does not suggest a max test on a deload or recovery day', () => {
    for (const seed of [1, 2, 3]) {
      const state = synthesizeAthleteState({ weeks: 30, restDaysBeforeNow: 4, seed })
      const plan = buildPlan(state)
      if (plan.dayType === 'deload' || plan.dayType === 'recovery') {
        expect(plan.suggestMaxTest).toBe(false)
      }
    }
  })

  it('counts an easy week as a deload whatever the workout was called', () => {
    // The trap: weeksSinceDeload only reset for a workout literally named
    // "Deload Flow", and otherwise measured weeks since the athlete's *first
    // ever session*. Past five weeks that meant a permanent deload — every
    // session, forever, at reduced volume — for anyone who backed off in their
    // own way or simply used a different workout.
    const now = Date.now()
    const relentless = synthesizeAthleteState({ weeks: 14, seed: 30, now })
    expect(readSignals(relentless, now).weeksSinceDeload).toBeGreaterThanOrEqual(5)
    expect(buildPlan(relentless, now).dayType).toBe('deload')

    // The identical athlete, except they quietly skipped the week before last.
    // Nothing is renamed and no template is used — the load simply drops.
    const easyWeek = weekStart(addDays(now, -14))
    const backedOff: AppState = {
      ...relentless,
      sessions: relentless.sessions.filter((s) => weekStart(s.startedAt) !== easyWeek),
    }
    expect(readSignals(backedOff, now).weeksSinceDeload).toBeLessThan(5)
    expect(buildPlan(backedOff, now).dayType).not.toBe('deload')
  })

  it('gives varied histories a spread of day types', () => {
    // If every athlete comes back with the same day, the coach is not reading
    // anything. Each of these has a genuinely different recent picture.
    const seen = new Set<string>()
    seen.add(buildPlan(synthesizeAthleteState({ weeks: 10, layoffDays: 14, restDaysBeforeNow: 3, seed: 21 })).dayType)
    seen.add(buildPlan(synthesizeAthleteState({ weeks: 10, layoffDays: 14, restDaysBeforeNow: 0, rpe: 9, seed: 22 })).dayType)
    seen.add(buildPlan(synthesizeAthleteState({ weeks: 16, seed: 23 })).dayType)
    seen.add(buildPlan(synthesizeAthleteState({ weeks: 1, sessionsPerWeek: 1, seed: 24 })).dayType)
    seen.add(
      buildPlan(synthesizeAthleteState({ weeks: 10, layoffDays: 14, seed: 25 }), Date.now(), {
        at: Date.now(),
        joints: 'pain',
        energy: 'tired',
      }).dayType,
    )
    expect(seen.size).toBeGreaterThan(2)
  })
})

describe('a season coached end to end', () => {
  /**
   * Closed loop: the coach's target shapes what the athlete logs, and that log
   * becomes the coach's next input. Feedback pathologies — a target that
   * ratchets itself down, a day type that becomes absorbing — are invisible to
   * any single-plan test and obvious here.
   */
  const season = (params: Parameters<typeof simulateSeason>[0] = {}) =>
    simulateSeason(params, buildPlan, adaptiveTarget, applySession)

  it('lets a responsive athlete actually improve over twelve weeks', () => {
    const run = season({ weeks: 12, respondsTo: 'volume', gainPerWeek: 1.5, seed: 3 })
    const first = run.performance.slice(0, 3).reduce((a, b) => a + b, 0) / 3
    const last = run.performance.slice(-3).reduce((a, b) => a + b, 0) / 3
    expect(last).toBeGreaterThan(first)
    // The coach must not be the thing holding them below their own capacity.
    const finalCapacity = run.capacity[run.capacity.length - 1]
    expect(last).toBeGreaterThan(finalCapacity * 0.6)
  })

  it('never ratchets the target down into a spiral', () => {
    for (const seed of [1, 2, 3]) {
      const run = season({ weeks: 16, seed, gainPerWeek: 0.8 })
      const factors = run.plans.map((p) => p.targetFactor)
      // A spiral looks like the floor being reached and never left.
      const tail = factors.slice(-8)
      expect(Math.min(...tail)).toBeGreaterThan(0.6)
      expect(Math.max(...tail)).toBeGreaterThan(0.75)
      // Prescriptions stay in touch with what the athlete can actually do.
      const lastPrescribed = run.plans[run.plans.length - 1].prescribed
      expect(lastPrescribed).toBeGreaterThan(0)
      expect(Number.isFinite(lastPrescribed)).toBe(true)
    }
  })

  it('cycles hard blocks and easy weeks instead of getting stuck', () => {
    for (const seed of [4, 5]) {
      const run = season({ weeks: 16, seed })
      const days = run.plans.map((p) => p.dayType)
      // The permanent-deload bug looked like one value forever. A healthy
      // season is mostly loaded days punctuated by real easy weeks.
      expect(new Set(days).size).toBeGreaterThan(1)
      const deloads = days.filter((d) => d === 'deload').length
      expect(deloads).toBeGreaterThan(0)
      expect(deloads).toBeLessThan(days.length / 3)
      // And it must never leave the athlete on easy days from some point on.
      expect(days.slice(-4).every((d) => d === 'deload')).toBe(false)
    }
  })

  it('keeps trying every approach rather than locking onto its first guess', () => {
    const run = season({ weeks: 20, respondsTo: 'density', gainPerWeek: 1.5, seed: 6 })
    const used = new Set(run.plans.map((p) => p.strategy))
    expect(used.size).toBeGreaterThanOrEqual(4)
    // And it should end up favouring the one that actually worked.
    const lateCounts = new Map<string, number>()
    for (const p of run.plans.slice(-10)) lateCounts.set(p.strategy, (lateCounts.get(p.strategy) ?? 0) + 1)
    const favourite = [...lateCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    expect(favourite).toBe('density')
  })

  it('depends on the top set reflecting capacity, and says so', () => {
    /**
     * A property of the design worth knowing, found by running the loop.
     *
     * The working target is a fraction of recent session bests. That is stable
     * as long as the log reflects what the athlete can *do* — which is why the
     * app coaches a last set taken near the limit. An athlete who instead
     * never exceeds the number they were given makes the log echo the target
     * back, and the fraction then compounds downward.
     *
     * This is not a defect being tolerated silently: the floor below pins how
     * far it can go, so if anyone ever changes the anchoring maths, the change
     * shows up here rather than in someone's training.
     */
    const realistic = season({ weeks: 12, seed: 9, compliance: 'to-capacity' })
    const obedient = season({ weeks: 12, seed: 9, compliance: 'to-target' })
    const lastOf = (xs: number[]) => xs.slice(-3).reduce((a, b) => a + b, 0) / 3

    expect(lastOf(realistic.performance)).toBeGreaterThan(realistic.performance[0])
    expect(lastOf(obedient.performance)).toBeLessThan(obedient.performance[0])
    // The design's own corrective must engage: when the working numbers drift
    // away from what the athlete can do, the coach asks for a re-test, which
    // is precisely what re-anchors the target.
    expect(obedient.plans.some((p) => p.suggestMaxTest)).toBe(true)
    // Whatever happens, the prescription stays a real, usable number.
    for (const run of [realistic, obedient]) {
      for (const p of run.plans) {
        expect(p.prescribed).toBeGreaterThanOrEqual(1)
        expect(Number.isFinite(p.prescribed)).toBe(true)
      }
    }
  })

  it('leaves the athlete with a coherent record at the end of a season', () => {
    const run = season({ weeks: 14, seed: 7 })
    expect(run.state.sessions.length).toBe(14 * 3)
    // Every session it generated must still satisfy the app's own invariants.
    for (const s of run.state.sessions) {
      expect(s.sets.length).toBeGreaterThan(0)
      expect(Number.isFinite(s.startedAt)).toBe(true)
      expect(s.endedAt).toBeGreaterThanOrEqual(s.startedAt)
    }
    expect(Object.keys(run.state.prs).length).toBeGreaterThan(0)
  })
})

describe('the coach survives histories no athlete would produce', () => {
  const now = Date.now()
  const base = synthesizeAthlete({ weeks: 4, seed: 1 })
  const degenerate: { label: string; sessions: Session[] }[] = [
    { label: 'no sessions', sessions: [] },
    { label: 'one session', sessions: base.slice(0, 1) },
    { label: 'reverse order', sessions: [...base].reverse() },
    { label: 'all identical timestamps', sessions: base.map((s) => ({ ...s, startedAt: now, endedAt: now })) },
    { label: 'duplicate ids', sessions: base.map((s) => ({ ...s, id: 'same' })) },
    { label: 'sessions in the future', sessions: base.map((s) => ({ ...s, startedAt: now + 9e8, endedAt: now + 9e8 })) },
    { label: 'zero-value sets', sessions: base.map((s) => ({ ...s, sets: s.sets.map((x) => ({ ...x, value: 0 })) })) },
    { label: 'empty set lists', sessions: base.map((s) => ({ ...s, sets: [] })) },
    { label: 'no strategy stamped', sessions: base.map(({ strategy: _s, ...rest }) => rest as Session) },
    { label: 'absurd hold values', sessions: base.map((s) => ({ ...s, sets: s.sets.map((x) => ({ ...x, value: 1e9 })) })) },
    { label: 'negative rpe', sessions: base.map((s) => ({ ...s, rpe: -5 })) },
  ]

  for (const { label, sessions } of degenerate) {
    it(`does not throw or produce nonsense on: ${label}`, () => {
      const state: AppState = { ...initialState(), onboarded: true, stepId: 'tuck', sessions }
      expect(() => readSignals(state, now)).not.toThrow()
      expect(() => armStats(state)).not.toThrow()
      expect(() => pickStrategy(state)).not.toThrow()
      const plan = buildPlan(state, now)
      expect(Number.isFinite(plan.targetFactor)).toBe(true)
      expect(Number.isFinite(plan.restMainSec)).toBe(true)
      expect(Number.isFinite(plan.volumeFactor)).toBe(true)
      expect(plan.decisions.length).toBeGreaterThan(0)
      for (const d of plan.decisions) {
        expect(d.text).not.toMatch(/NaN|undefined|Infinity/)
        expect(d.text.length).toBeGreaterThan(10)
      }
    })
  }

  it('always says something, even to an athlete on day one', () => {
    const plan = buildPlan({ ...initialState(), onboarded: true }, now)
    expect(plan.decisions.length).toBeGreaterThan(0)
    expect(plan.dayReason.length).toBeGreaterThan(10)
  })

  it('is deterministic — the same athlete on the same day gets the same plan', () => {
    const state = synthesizeAthleteState({ weeks: 10, seed: 8 })
    const a = buildPlan(state, now)
    const b = buildPlan(state, now)
    expect(JSON.stringify({ ...a, signals: null })).toBe(JSON.stringify({ ...b, signals: null }))
  })
})
