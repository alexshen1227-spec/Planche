import { describe, expect, it } from 'vitest'
import { adjustsSetToSet, adviseNextHold, adviseNextReps, DROP_OFF_SHARE, MAX_RISE } from './autoregulate'

describe('set-to-set hold targets', () => {
  it('changes nothing before the first set or on an ordinary set', () => {
    expect(adviseNextHold(5, [])).toEqual({ target: 5, change: 'same' })
    expect(adviseNextHold(5, [{ value: 5.4, target: 5 }]).change).toBe('same')
  })

  it('raises the next target after a hold that went well past it, by a small bounded step', () => {
    const advice = adviseNextHold(4, [{ value: 9, target: 4 }])
    expect(advice.change).toBe('up')
    expect(advice.target).toBe(5)
    // Never past half again the plan, the bar, or the best hold of the day.
    let target = 4
    const done = []
    for (let i = 0; i < 8; i++) {
      done.push({ value: 30, target })
      target = adviseNextHold(4, done, 20).target
    }
    expect(target).toBeLessThanOrEqual(Math.floor(4 * MAX_RISE))
    expect(adviseNextHold(10, [{ value: 30, target: 10 }], 11).target).toBeLessThanOrEqual(11)
  })

  it('does not raise after a hold the athlete said slipped', () => {
    expect(adviseNextHold(4, [{ value: 9, target: 4, rating: 'slipped' }]).change).toBe('same')
  })

  it('treats one short set as noise and two in a row as the new reality', () => {
    const one = adviseNextHold(8, [{ value: 4, target: 8 }])
    expect(one.change).toBe('same')
    expect(one.target).toBe(8)
    const two = adviseNextHold(8, [
      { value: 4, target: 8 },
      { value: 5, target: 8 },
    ])
    expect(two.change).toBe('down')
    expect(two.target).toBe(5)
  })

  it('eases straight away after a set the athlete confirmed broke down', () => {
    const advice = adviseNextHold(8, [{ value: 7, target: 8, rating: 'broke' }])
    expect(advice.change).toBe('down')
    expect(advice.target).toBeLessThan(8)
  })

  it('ignores an interrupted attempt entirely', () => {
    const advice = adviseNextHold(8, [
      { value: 8, target: 8 },
      { value: 1, target: 8, nonCapacity: true },
      { value: 2, target: 8, nonCapacity: true },
    ])
    expect(advice).toEqual({ target: 8, change: 'same' })
  })

  it('suggests moving on only after two consecutive holds well under the best of the day', () => {
    const fresh = [
      { value: 10, target: 6 },
      { value: 8, target: 7 },
    ]
    expect(adviseNextHold(6, fresh).suggestMoveOn).toBeUndefined()
    const tired = [...fresh, { value: 10 * DROP_OFF_SHARE - 1, target: 7 }, { value: 10 * DROP_OFF_SHARE - 1, target: 7 }]
    expect(adviseNextHold(6, tired).suggestMoveOn).toBeDefined()
    // A single bad set does not trigger it.
    const once = [...fresh, { value: 2, target: 7 }]
    expect(adviseNextHold(6, once).suggestMoveOn).toBeUndefined()
  })
})

describe('set-to-set rep targets', () => {
  it('adds a rep after clear spare reps, at most three over the plan', () => {
    expect(adviseNextReps(6, [{ value: 9, target: 6 }])).toMatchObject({ target: 7, change: 'up' })
    let target = 6
    const done = []
    for (let i = 0; i < 6; i++) {
      done.push({ value: 20, target })
      target = adviseNextReps(6, done).target
    }
    expect(target).toBe(9)
  })

  it('matches a clear miss and leaves a near miss alone', () => {
    expect(adviseNextReps(6, [{ value: 3, target: 6 }])).toMatchObject({ target: 3, change: 'down' })
    expect(adviseNextReps(6, [{ value: 5, target: 6 }]).change).toBe('same')
  })
})

describe('which blocks follow the athlete set to set', () => {
  const block = { section: 'strength' as const, sets: 3 }

  it('adjusts ordinary multi-set work', () => {
    expect(adjustsSetToSet(block, 'auto', false)).toBe(true)
    expect(adjustsSetToSet({ ...block, section: 'main', role: 'skill' }, 'auto', false)).toBe(true)
  })

  it('leaves an easy day’s light dose light, however easy its first set felt', () => {
    expect(adjustsSetToSet({ ...block, light: true }, 'auto', false)).toBe(false)
  })

  it('never moves warm-ups, cooldowns, attempts, tests, single sets or per-side work', () => {
    expect(adjustsSetToSet({ ...block, section: 'warmup' }, 'auto', false)).toBe(false)
    expect(adjustsSetToSet({ ...block, section: 'cooldown' }, 'auto', false)).toBe(false)
    expect(adjustsSetToSet({ ...block, section: 'main', role: 'attempt' }, 'auto', false)).toBe(false)
    expect(adjustsSetToSet(block, 'test', false)).toBe(false)
    expect(adjustsSetToSet({ ...block, sets: 1 }, 'auto', false)).toBe(false)
    expect(adjustsSetToSet(block, 'auto', true)).toBe(false)
  })
})
