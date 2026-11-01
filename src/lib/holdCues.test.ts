import { describe, expect, it } from 'vitest'
import { holdCues, PROGRESSION_STOP_LATENCY_SEC } from './sessionTiming'

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
