import { describe, expect, it } from 'vitest'
import type { StrategyId } from '../types'
import { DECIDED_LEAD_SEC_PER_WEEK, strategyStanding } from './coach'

const arm = (id: StrategyId, n: number, mean: number, secPerWeek: number | null) => ({ id, n, mean, secPerWeek })
const BAR = 20

describe('which approach is leading, if any', () => {
  it('names nobody on five level results', () => {
    // "Leading" once went to whichever approach sorted first — with five on
    // one result each and level scores, the first in the list, badged beside
    // the smallest gain of the five.
    const level = (['balanced', 'volume', 'intensity', 'density', 'technique'] as StrategyId[]).map((id, i) => arm(id, 1, 0.1, 1 + i))
    expect(strategyStanding(level, BAR)).toEqual({ leader: null, why: 'level' })
  })

  it('says why there is nothing to rank', () => {
    expect(strategyStanding([], BAR)).toEqual({ leader: null, why: 'unmeasured' })
    expect(strategyStanding([arm('volume', 0, 0.5, null), arm('balanced', 0, 0.2, null)], BAR)).toEqual({ leader: null, why: 'unmeasured' })
    expect(strategyStanding([arm('volume', 3, 0.5, 2), arm('balanced', 0, 0.2, null)], BAR)).toEqual({ leader: null, why: 'alone' })
  })

  it('needs a clear lead on the coach’s score, at the bar the coach itself uses', () => {
    const just = DECIDED_LEAD_SEC_PER_WEEK / BAR
    expect(strategyStanding([arm('volume', 3, 0.3 + just * 1.01, 4), arm('balanced', 3, 0.3, 2.6)], BAR)).toEqual({ leader: 'volume' })
    expect(strategyStanding([arm('volume', 3, 0.3 + just * 0.9, 4), arm('balanced', 3, 0.3, 2.6)], BAR)).toEqual({ leader: null, why: 'level' })
  })

  it('never badges an approach beside a number that contradicts it', () => {
    // Ranked first by the coach, but another shows the bigger observed gain.
    expect(strategyStanding([arm('volume', 3, 0.6, 1.2), arm('balanced', 3, 0.3, 2.6)], BAR)).toEqual({ leader: null, why: 'split' })
    // The same figure once printed to a tenth: not told apart by a badge.
    expect(strategyStanding([arm('volume', 3, 0.6, 2.64), arm('balanced', 3, 0.3, 2.61)], BAR)).toEqual({ leader: null, why: 'split' })
    // Ranked first with no gain to show for it.
    expect(strategyStanding([arm('volume', 3, 0.6, 0), arm('balanced', 3, 0.3, 0)], BAR)).toEqual({ leader: null, why: 'flat' })
    expect(strategyStanding([arm('volume', 3, 0.6, null), arm('balanced', 3, 0.3, 1)], BAR)).toEqual({ leader: null, why: 'split' })
  })
})
