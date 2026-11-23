import { describe, expect, it } from 'vitest'
import { askStillApplies, parseTypedLoad } from './loadAsk'

describe('the weight question belongs to one movement', () => {
  const items = [{ exerciseId: 'db-fly', sets: [{}, {}, {}] }, { exerciseId: 'row', sets: [{}] }]
  it('stands while the same movement is there', () => {
    expect(askStillApplies({ item: 0, set: 1, exerciseId: 'db-fly' }, items)).toBe(true)
  })
  it('is forgotten when a swap put another movement in its place', () => {
    expect(askStillApplies({ item: 0, set: 1, exerciseId: 'db-fly' }, [{ exerciseId: 'cable-fly', sets: [{}, {}] }, items[1]])).toBe(false)
  })
  it('is forgotten when the set or the movement is gone, and when nothing was asked', () => {
    expect(askStillApplies({ item: 0, set: 3, exerciseId: 'db-fly' }, items)).toBe(false)
    expect(askStillApplies({ item: 5, set: 0, exerciseId: 'db-fly' }, items)).toBe(false)
    expect(askStillApplies(null, items)).toBe(false)
  })
})

describe('a typed weight answers the question', () => {
  it('reads positive numbers, with a decimal comma', () => {
    expect(parseTypedLoad('12.5')).toBe(12.5)
    expect(parseTypedLoad(' 12,5 ')).toBe(12.5)
  })
  it('refuses nothing, zero, words and a slipped decimal', () => {
    for (const bad of ['', '0', 'abc', '-3', '1000', undefined, null]) expect(parseTypedLoad(bad as never)).toBeUndefined()
  })
})
