import { describe, expect, it } from 'vitest'
import type { AppState, Session, SetLog } from '../types'
import {
  calledAtTargetAfterCorrection,
  callMarksCompliance,
  holdCues,
  PROGRESSION_STOP_LATENCY_SEC,
  stoppedAtTargetCall,
} from './sessionTiming'
import { adviseNextHold } from './autoregulate'
import { initialState } from './store'
import { accessoryProgression, adaptiveTarget } from '../data/workouts'
import { capacityReading, sessionLearningValue, sessionTargetCap } from './progression'
import { capacityOn } from './bridge'
import { readSignals } from './signals'

/**
 * What the hold screen tells an athlete still in position. The stop allowance
 * — reaction time, or the walk back to a phone across the room — happens after
 * the hold, so it comes off the logged value and never off these cues.
 */
describe('cues for a hold in progress', () => {
  const walk = PROGRESSION_STOP_LATENCY_SEC

  it('calls the target when it has been held, not after the walk-back allowance', () => {
    // A 7s working target, phone across the room. The call used to come at
    // 12s held — the whole max of an athlete whose best is twelve.
    expect(holdCues(6.9, walk, 7, 12).targetReached).toBe(false)
    expect(holdCues(7, walk, 7, 12).targetReached).toBe(true)
    // A minimum-dose hold: three seconds means three seconds.
    expect(holdCues(3, walk, 3, 12).targetReached).toBe(true)
  })

  it('counts the seconds actually held', () => {
    expect(holdCues(10.4, walk, 7, 12).heldSec).toBe(10.4)
  })

  it('announces a record only once the logged value would stand', () => {
    // Best 12s: at 13s held the log would read 8s if it were stopped now.
    expect(holdCues(13, walk, 7, 12).pr).toBe(false)
    expect(holdCues(17.1, walk, 7, 12).pr).toBe(true)
    // With the phone in hand there is nothing to take off.
    expect(holdCues(12.1, 0, 7, 12).pr).toBe(true)
    // No best yet: nothing to beat, nothing to announce.
    expect(holdCues(30, walk, 7, undefined).pr).toBe(false)
  })

  it('never calls a target that does not exist', () => {
    expect(holdCues(20, walk, 0, 12).targetReached).toBe(false)
  })
})

describe('a hold stopped at its target call', () => {
  const walk = PROGRESSION_STOP_LATENCY_SEC

  it('is recognised from the stopwatch: the call sounded, and the stop came within the allowance', () => {
    expect(stoppedAtTargetCall(7 + 3, 7, walk)).toBe(true) // came down at the call, walked 3s
    expect(stoppedAtTargetCall(7.2, 7, 0.4)).toBe(true) // phone in hand
    expect(stoppedAtTargetCall(6.5, 7, walk)).toBe(false) // the call never sounded
    expect(stoppedAtTargetCall(7 + walk + 2, 7, walk)).toBe(false) // held on well past it
  })

  it('is never read as two short sets within a session', () => {
    // Compliant, with a 3s walk: a 7s target logs 5s.
    const atCall = { value: 5, target: 7, atTarget: true }
    expect(adviseNextHold(7, [atCall, atCall]).change).not.toBe('down')
    // The same numbers without the fact would ease the target.
    const short = { value: 5, target: 7 }
    expect(adviseNextHold(7, [short, short]).change).toBe('down')
    // One genuinely short set beside one stopped at the call is not two short sets, either way round.
    expect(adviseNextHold(7, [atCall, short]).change).not.toBe('down')
    expect(adviseNextHold(7, [short, atCall]).change).not.toBe('down')
  })

  it('keeps a compliant athlete’s targets from ratcheting down, session after session', () => {
    const DAY = 86_400_000
    const START = Date.UTC(2026, 9, 1, 12)
    const base = initialState()
    const athlete = (sessions: Session[]): AppState => ({
      ...base,
      onboarded: true,
      stepId: 'tuck',
      baseStepId: 'tuck',
      unlocked: ['foundations', 'lean', 'frog', 'tuck'],
      sessions,
      profile: { ...base.profile, equipment: ['floor', 'parallettes'], preferredSurface: 'parallettes' },
    })
    const sessionAt = (day: number, sets: Partial<SetLog>[], baseTargetSec?: number): Session => {
      const at = START + day * DAY
      return {
        id: `s${day}`,
        startedAt: at,
        endedAt: at + 1_800_000,
        workoutName: 'Training Day',
        workoutKind: 'auto',
        stepId: 'tuck',
        ...(baseTargetSec !== undefined ? { baseTargetSec } : {}),
        sets: sets.map((s, i) => ({ exerciseId: 'tuck-planche', kind: 'hold', section: 'main', surface: 'parallettes', at: at + i * 60_000, value: 5, target: 5, ...s })) as SetLog[],
      }
    }
    const run = (flag: boolean) => {
      // One measured session (bests of 12s), then six coached ones in which
      // every hold stops at the call and the walk back takes 3s, not 5.
      const sessions: Session[] = [sessionAt(0, [{ value: 12, target: 8 }, { value: 11, target: 8 }])]
      // What the session builder prescribes: the adaptive base, never above
      // the best the athlete has recently shown (todaysSession's capacity cap).
      const prescribe = (state: AppState, now: number) => {
        const capacity = capacityOn(state, 'tuck')
        const base = adaptiveTarget(state, 'tuck', now)
        return capacity === undefined ? base : Math.min(base, Math.max(1, Math.floor(capacity)))
      }
      const first = prescribe(athlete(sessions), START + 1 * DAY)
      let target = first
      for (let i = 1; i <= 6; i++) {
        const logged = Math.max(0, target - 2)
        sessions.push(
          sessionAt(
            i * 2,
            [0, 1, 2, 3].map(() => ({ value: logged, target, raw: target + 3, ...(flag ? { calledAtTarget: true } : {}) })),
            target,
          ),
        )
        target = prescribe(athlete(sessions), START + (i * 2 + 1) * DAY)
      }
      return { first, last: target }
    }
    const withFact = run(true)
    const without = run(false)
    expect(withFact.last).toBeGreaterThanOrEqual(withFact.first)
    // The spiral this prevents: the same holds, read as shortfalls.
    expect(without.last).toBeLessThan(without.first)

    // And the coach's session hit rate reads them as hits, so it does not ease
    // the next target "because most sets fell short".
    const day = START + 20 * DAY
    const atCall = athlete([sessionAt(19, [0, 1, 2, 3].map(() => ({ value: 5, target: 7, raw: 10, calledAtTarget: true })))])
    const unflagged = athlete([sessionAt(19, [0, 1, 2, 3].map(() => ({ value: 5, target: 7, raw: 10 })))])
    expect(readSignals(atCall, day).mainHitRate).toBe(1)
    expect(readSignals(unflagged, day).mainHitRate).toBe(0)
  })
})

describe('reading a hold stopped at its call', () => {
  const DAY = 86_400_000
  const NOW = Date.UTC(2026, 10, 1, 12)
  const sessionOf = (sets: Partial<SetLog>[], daysAgo = 2): Session => {
    const at = NOW - daysAgo * DAY
    return {
      id: `r${daysAgo}`,
      startedAt: at,
      endedAt: at + 1_800_000,
      workoutName: 'Training Day',
      workoutKind: 'auto',
      stepId: 'tuck',
      sets: sets.map((s, i) => ({ kind: 'hold', section: 'main', surface: 'parallettes', at: at + i * 60_000, ...s })) as SetLog[],
    }
  }

  it('counts as reaching the target in accessory progression too', () => {
    // A lean with the default 2.3s delay, stopped at the call: logs ~2s under.
    const leans = sessionOf(
      [0, 1, 2].map(() => ({ exerciseId: 'planche-lean', section: 'strength' as const, value: 10, target: 12, calledAtTarget: true })),
    )
    expect(accessoryProgression({ sessions: [leans] }, 'planche-lean', 'hold', NOW)?.change).not.toBe('down')
    const unflagged = sessionOf([0, 1, 2].map(() => ({ exerciseId: 'planche-lean', section: 'strength' as const, value: 10, target: 12 })))
    expect(accessoryProgression({ sessions: [unflagged] }, 'planche-lean', 'hold', NOW)?.change).toBe('down')
  })

  it('only treats a stop near the call as coming down at it for working sets', () => {
    // Maximal efforts fail before the target as a matter of course, and the
    // call can sound during the walk back after the athlete is already down.
    expect(callMarksCompliance({ role: 'skill', section: 'main' }, 'auto')).toBe(true)
    expect(callMarksCompliance({ role: 'straight-arm', section: 'strength' }, 'auto')).toBe(true)
    expect(callMarksCompliance({ section: 'core' }, 'auto')).toBe(true)
    expect(callMarksCompliance({ role: 'attempt', section: 'main' }, 'auto')).toBe(false)
    expect(callMarksCompliance({ role: 'bridge', section: 'main' }, 'auto')).toBe(false)
    expect(callMarksCompliance({ role: 'skill', section: 'main' }, 'test')).toBe(false)
    expect(callMarksCompliance({ role: 'skill', section: 'main' }, 'micro')).toBe(false)
    // A stretch is not "coming down at the call", and its log feeds nothing.
    expect(callMarksCompliance({ section: 'warmup' }, 'auto')).toBe(false)
    expect(callMarksCompliance({ section: 'cooldown' }, 'auto')).toBe(false)
  })

  it('keeps a call-stopped hold that logged zero in view', () => {
    // A 1s target with a 3s walk back: 4s on the stopwatch, less 5s, logs 0.
    const zero = sessionOf([{ exerciseId: 'tuck-planche', value: 0, target: 1, raw: 4, calledAtTarget: true }])
    expect(sessionLearningValue(zero, 'tuck')).toBe(1)
  })

  it('believes a confirmed camera over the assumption, either way', () => {
    const filmed = (clean: number): Partial<SetLog> => ({
      exerciseId: 'tuck-planche',
      value: 0,
      target: 2,
      raw: 4.5,
      calledAtTarget: true,
      form: {
        rating: clean >= 2 ? 'clean' : 'slipped',
        confirmed: true,
        issues: clean >= 2 ? [] : ['lean'],
        auto: { issues: clean >= 2 ? [] : ['lean'], confidence: 0.9, cleanSeconds: clean, cleanRatio: clean / 2 },
      },
    })
    // The camera saw the position end at 1.5s: down before the call.
    expect(capacityReading(filmed(1.5) as SetLog)).toBe(1.5)
    expect(sessionTargetCap(sessionOf([filmed(1.5)]), 'tuck', 'parallettes')).toBeNull()
    // The camera saw it last to the call.
    expect(capacityReading(filmed(2) as SetLog)).toBe(2)
  })

  it('reads the target as reached, unless the camera saw it break down earlier', () => {
    const atCall = sessionOf([{ exerciseId: 'tuck-planche', value: 5, target: 7, calledAtTarget: true }])
    expect(sessionLearningValue(atCall, 'tuck')).toBe(7)
    // Athlete-confirmed, camera-trusted: the clean window ended at 3s.
    const broke = sessionOf([
      {
        exerciseId: 'tuck-planche',
        value: 5,
        target: 7,
        calledAtTarget: true,
        form: { rating: 'slipped', confirmed: true, issues: ['lean'], auto: { issues: ['lean'], confidence: 0.9, cleanSeconds: 3, cleanRatio: 0.6 } },
      },
    ])
    expect(sessionLearningValue(broke, 'tuck')).toBe(3)
  })
})

describe('a bar the logged value must clear', () => {
  const walk = PROGRESSION_STOP_LATENCY_SEC

  it('calls an unlock attempt or max test once the bar is banked, not merely held', () => {
    // A 20s bar: held 20s, but the log would read 15s if stopped now.
    expect(holdCues(20, walk, 20, 12, true).targetReached).toBe(false)
    expect(holdCues(25, walk, 20, 12, true).targetReached).toBe(true)
    // An athlete who comes down at that call and walks back in 3s logs 22s:
    // the bar they held is the bar they get.
    expect(25 + 3 - walk).toBeGreaterThanOrEqual(20)
    // A working set keeps the call on time held.
    expect(holdCues(20, walk, 20, 12, false).targetReached).toBe(true)
  })

  it('fills the ring on the same clock as the call', () => {
    expect(holdCues(20, walk, 20, 12, true).towardSec).toBe(15)
    expect(holdCues(20, walk, 20, 12, false).towardSec).toBe(20)
  })
})

describe('correcting how a hold was stopped', () => {
  // Found by an independent review: "Had to walk back to the phone" re-credited
  // an 8.5s stopwatch reading to 3.5s but kept it marked as reaching its 8s
  // target, so the coach read it as 8s.
  it('withdraws the at-target reading when the stop came too soon after the call for a walk', () => {
    const log = { calledAtTarget: true, raw: 8.5, target: 8 }
    expect(calledAtTargetAfterCorrection(log, false, 2.3)).toBe(true)
    expect(calledAtTargetAfterCorrection(log, true, PROGRESSION_STOP_LATENCY_SEC)).toBe(false)
  })

  it('keeps it when the stop fits a walk after the call, and never adds it', () => {
    expect(calledAtTargetAfterCorrection({ calledAtTarget: true, raw: 11, target: 8 }, true, PROGRESSION_STOP_LATENCY_SEC)).toBe(true)
    expect(calledAtTargetAfterCorrection({ raw: 8.5, target: 8 }, false, 2.3)).toBe(false)
  })
})
