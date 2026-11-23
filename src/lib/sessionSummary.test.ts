import { describe, expect, it } from 'vitest'
import type { SetLog } from '../types'
import {
  allowanceName,
  creditedWhileHolding,
  deductionNote,
  ratedSetLabel,
  stopAllowanceFor,
  summaryLastSet,
} from './sessionSummary'
import { stopLatencySecondsFor } from './sessionTiming'

/**
 * Review round four (M5, m2): the summary read "Last set: 2.1s Shoulder
 * Extension Stretch (4.4s − 2.3s to stop it)" beside "How did your 2.1s
 * planche lean look?", and deductions were shown as bare numbers.
 */

const AT = Date.UTC(2026, 10, 20, 17)

function set(exerciseId: string, section: SetLog['section'], value: number, i: number, extra: Partial<SetLog> = {}): SetLog {
  return { exerciseId, kind: 'hold', value, target: 12, section, at: AT + i * 60_000, ...extra }
}

const session: SetLog[] = [
  set('wrist-rocks', 'warmup', 20, 0),
  set('planche-lean', 'main', 2.1, 1, { raw: 4.4, timing: { method: 'stopwatch', allowanceSec: 2.3, allowance: 'reaction' } }),
  set('planche-lean', 'main', 2.1, 2, { raw: 4.4, timing: { method: 'stopwatch', allowanceSec: 2.3, allowance: 'reaction' } }),
  set('hollow-hold', 'core', 15, 3),
  set('shoulder-extension-stretch', 'cooldown', 4.4, 4),
]

describe('the session summary reports a training set (review round four, M5)', () => {
  it('never reports a cool-down stretch or a warm-up drill as the last set', () => {
    expect(summaryLastSet(session)?.exerciseId).toBe('hollow-hold')
    expect(summaryLastSet(session.slice(0, 3))?.exerciseId).toBe('planche-lean')
    expect(summaryLastSet([session[0], session[4]])).toBeUndefined()
  })

  it('takes no stop allowance off a warm-up or cool-down hold, and the usual one off training holds', () => {
    expect(stopAllowanceFor('cooldown', 'shoulder-extension-stretch', 2.3, false)).toBe(0)
    expect(stopAllowanceFor('warmup', 'frog-stand', 2.3, false)).toBe(0)
    expect(stopAllowanceFor('main', 'planche-lean', 2.3, false)).toBe(2.3)
    expect(stopAllowanceFor('main', 'tuck-planche', 2.3, false)).toBe(stopLatencySecondsFor('tuck-planche', 2.3, false))
    expect(stopAllowanceFor('main', 'tuck-planche', 2.3, false)).toBe(5)
    expect(stopAllowanceFor('core', 'hollow-hold', 2.3, false)).toBe(2.3)
  })

  it('names the set a rating question rates when there are several of it', () => {
    expect(ratedSetLabel(session[2], session, 'planche lean')).toBe('your planche lean, set 2 of 2 (2.1s),')
    expect(ratedSetLabel(session[1], session, 'planche lean')).toBe('your planche lean, set 1 of 2 (2.1s),')
    expect(ratedSetLabel(session[3], session, 'hollow hold')).toBe('your 15s hollow hold')
  })
})

describe('a deduction says which allowance it is (review round four, m2)', () => {
  it('names the stop reaction delay and the walk-back allowance apart', () => {
    expect(deductionNote(session[1])).toBe('(4.4s on the timer − 2.3s stop reaction delay (phone in reach))')
    const pathHold = set('tuck-planche', 'main', 5.2, 5, {
      raw: 10.2,
      timing: { method: 'stopwatch', allowanceSec: 5, allowance: 'walk-back' },
    })
    expect(deductionNote(pathHold)).toBe('(10.2s on the timer − 5.0s walk-back allowance (phone across the room))')
    const measured = { ...pathHold, value: 7.1, timing: { ...pathHold.timing!, allowanceSec: 3.1, walkMeasured: true } }
    expect(deductionNote(measured)).toBe('(10.2s on the timer − 3.1s your measured walk back (phone across the room))')
    expect(allowanceName(undefined)).toBe('stop allowance')
  })

  it('says nothing when nothing came off, or the hold was not timed by the stopwatch', () => {
    expect(deductionNote(set('shoulder-extension-stretch', 'cooldown', 4.4, 6, { raw: 4.4 }))).toBeNull()
    expect(deductionNote(set('tuck-planche', 'main', 6, 7, { raw: 9, timing: { method: 'video' } }))).toBeNull()
  })

  it('says which allowance comes off while the hold runs', () => {
    expect(creditedWhileHolding(1.1, 2.3, 'reaction')).toBe('counts as 1.1s (2.3s off: stop reaction delay)')
    expect(creditedWhileHolding(5.2, 5, 'walk-back')).toBe('counts as 5.2s (5.0s off: walk-back allowance)')
    expect(creditedWhileHolding(7.1, 3.1, 'walk-back', true)).toBe('counts as 7.1s (3.1s off: your measured walk back)')
  })
})
