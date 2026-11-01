import { describe, expect, it } from 'vitest'
import type { AppState, Session, SetLog } from '../types'
import { holdCues, PROGRESSION_STOP_LATENCY_SEC, stoppedAtTargetCall } from './sessionTiming'
import { adviseNextHold } from './autoregulate'
import { initialState } from './store'
import { adaptiveTarget } from '../data/workouts'
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
      const first = adaptiveTarget(athlete(sessions), 'tuck', START + 1 * DAY)
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
        target = adaptiveTarget(athlete(sessions), 'tuck', START + (i * 2 + 1) * DAY)
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
