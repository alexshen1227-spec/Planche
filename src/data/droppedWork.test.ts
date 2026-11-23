import { describe, expect, it } from 'vitest'
import type { Block } from '../types'
import { droppedWorkNames } from './workouts'

// "Left out to fit 25 minutes: … planche lean" once sat above a warm-up that
// still held an 8-second primer lean (review round seven). A movement whose
// main sets went but whose primer stays is named as its sets.
const block = (exerciseId: string, section: Block['section']) => ({ exerciseId, section, sets: 1 }) as unknown as Block

describe('the work a budget left out, as the athlete reads it', () => {
  it('names a movement kept only as a warm-up primer by its sets', () => {
    const fitted = [block('planche-lean', 'warmup'), block('tuck-planche', 'main')]
    expect(droppedWorkNames(['planche-lean', 'hollow-hold'], fitted)).toEqual([
      'planche lean sets (the warm-up primer stays)',
      'hollow body hold',
    ])
  })

  it('never lists a movement the main work still holds, and names each once', () => {
    const fitted = [block('tuck-planche', 'main')]
    expect(droppedWorkNames(['tuck-planche', 'hollow-hold', 'hollow-hold'], fitted)).toEqual(['hollow body hold'])
  })

  it('leaves out ids the catalogue does not know', () => {
    expect(droppedWorkNames(['not-a-movement'], [])).toEqual([])
  })
})
