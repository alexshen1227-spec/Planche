// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState, StepId, Workout } from '../types'
import { initialState, StoreProvider } from '../lib/store'
import { STEPS, STEP_BY_ID } from '../data/progressions'
import { SessionPlayer } from './SessionPlayer'

/**
 * What the athlete hears during a hold, driven through the real player on a
 * fake clock. Found by an independent review: a banked call lands on
 * held = target + allowance, and when that is a multiple of five the spoken
 * count in the same tick cancelled "Target"; and a minimum dose's short
 * next-shape holds were banked like a bar.
 */

const spoken: { word: string; at: number }[] = []
let t0 = 0
vi.mock('../lib/audio', () => ({
  sfx: new Proxy({}, { get: () => () => {} }),
  speak: (word: string) => spoken.push({ word, at: (Date.now() - t0) / 1000 }),
  buzz: () => {},
  configureAudio: () => {},
}))
vi.mock('../lib/confetti', () => ({ confetti: () => {} }))

function seed(stepId: StepId): AppState {
  return {
    ...initialState(),
    onboarded: true,
    stepId,
    baseStepId: stepId,
    unlocked: STEPS.filter((s) => s.order <= STEP_BY_ID[stepId].order).map((s) => s.id),
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(Date.UTC(2026, 10, 1, 9))
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  localStorage.clear()
  spoken.length = 0
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Begin the session and its first hold, skipping the lead-in; time 0 = Go. */
function startHold(workout: Workout, stepId: StepId) {
  localStorage.setItem('planchelab.v1', JSON.stringify(seed(stepId)))
  render(
    <StoreProvider>
      <SessionPlayer workout={workout} onExit={() => {}} />
    </StoreProvider>,
  )
  const player = screen.getByRole('dialog', { name: /training session/ })
  const click = (name: RegExp) =>
    act(() => {
      fireEvent.click(within(player).getByRole('button', { name }))
    })
  click(/Begin session/)
  click(/lead-in$/)
  click(/Skip lead-in/)
  t0 = Date.now()
  spoken.length = 0
}

function holdFor(sec: number) {
  for (let i = 0; i < sec * 10; i++) {
    act(() => {
      vi.advanceTimersByTime(100)
    })
  }
}

describe('what the athlete hears during a hold', () => {
  it('keeps "Target" when the banked call lands on a five-second count', () => {
    // A 20s unlock attempt with the phone across the room: the call is at 25s
    // held, the same tick as the "25" count.
    startHold(
      {
        id: 'attempt',
        name: 'Attempt',
        focus: '',
        minutes: 5,
        kind: 'auto',
        blocks: [
          { exerciseId: 'tuck-planche', sets: 1, target: { kind: 'hold', sec: 20 }, restSec: 180, section: 'main', role: 'attempt' },
        ],
      },
      'tuck',
    )
    holdFor(26)
    const words = spoken.map((s) => s.word)
    expect(words).toContain('Target')
    // Nothing spoken after the call in that second, so nothing cut it off.
    const call = spoken.find((s) => s.word === 'Target')!
    expect(call.at).toBeGreaterThanOrEqual(25)
    expect(spoken.filter((s) => s.at >= call.at && s.word !== 'Target')).toEqual([])
  })

  it('calls a minimum dose’s short next-shape hold at its own target, not a banked one', () => {
    startHold(
      {
        id: 'micro',
        name: 'Minimum dose',
        focus: '',
        minutes: 5,
        kind: 'micro',
        blocks: [
          { exerciseId: 'frog-stand', sets: 1, target: { kind: 'hold', sec: 3 }, restSec: 40, section: 'main', role: 'bridge' },
        ],
      },
      'lean',
    )
    holdFor(9)
    const call = spoken.find((s) => s.word === 'Target')
    expect(call).toBeDefined()
    expect(call!.at).toBeLessThan(4)
  })
})
