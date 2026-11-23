import { describe, expect, it } from 'vitest'
import { holdAxis } from './chartAxis'

describe('the weekly hold axis', () => {
  it('reads seconds under a minute, never "0.1m"', () => {
    const axis = holdAxis(12)
    expect(axis.unit).toBe('s')
    expect(axis.ticks.map(axis.label)).toEqual(['0s', '5s', '10s'])
    for (const sec of [1, 5, 12, 30, 52]) expect(holdAxis(sec).ticks.map(holdAxis(sec).label).join(' ')).not.toMatch(/\d\.\d+m/)
  })
  it('reads minutes from a minute up', () => {
    const axis = holdAxis(300)
    expect(axis.unit).toBe('m')
    expect(axis.label(axis.ticks[axis.ticks.length - 1])).toMatch(/m$/)
    expect(axis.secPerTick).toBe(60)
  })
})
