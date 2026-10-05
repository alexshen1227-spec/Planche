// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState, Session, Workout } from '../types'
import { initialState, StoreProvider } from '../lib/store'
import { SessionPlayer } from './SessionPlayer'

/**
 * The session screen's exit and save policies, driven through the real
 * component and store.
 *
 * These were verified by hand in a browser during the 2026-10 audit fixes;
 * this keeps them from regressing silently. Audio, confetti and the wake lock
 * are stubbed (jsdom has none of them); everything else — the reducer, the
 * draft mirror, the phases — is the real thing.
 */

vi.mock('../lib/audio', () => ({
  sfx: new Proxy({}, { get: () => () => {} }),
  speak: () => {},
  buzz: () => {},
  configureAudio: () => {},
}))
vi.mock('../lib/confetti', () => ({ confetti: () => {} }))

let clock = Date.UTC(2026, 9, 5, 9)

function seed(): AppState {
  return {
    ...initialState(),
    onboarded: true,
    stepId: 'foundations',
    baseStepId: 'foundations',
    unlocked: ['foundations'],
  }
}

/** One warm-up rep block, then two more, so there is a rest between them. */
const workout: Workout = {
  id: 'test-workout',
  name: 'Test Workout',
  focus: 'Exit policy fixture',
  minutes: 5,
  kind: 'template',
  blocks: [
    { exerciseId: 'wrist-circles', sets: 1, target: { kind: 'reps', reps: 10 }, restSec: 30, section: 'warmup' },
    { exerciseId: 'wrist-circles', sets: 2, target: { kind: 'reps', reps: 10 }, restSec: 30, section: 'warmup' },
  ],
}

const saved = (): Session[] => JSON.parse(localStorage.getItem('planchelab.v1') ?? '{}').sessions ?? []
const draft = () => localStorage.getItem('planchelab.draft')
const player = () => screen.getByRole('dialog', { name: /Test Workout training session/ })
const click = (name: RegExp | string, root: HTMLElement = player()) =>
  act(() => {
    fireEvent.click(within(root).getByRole('button', { name }))
  })

function mount(onExit = vi.fn()) {
  render(
    <StoreProvider>
      <SessionPlayer workout={workout} onExit={onExit} />
    </StoreProvider>,
  )
  return onExit
}

/** Begin, then log one set of reps (warm-up rep blocks need no lead-in). */
function logOneSet() {
  click(/Begin session/)
  click(/Begin set/)
  click(/Log 10 reps/)
}

beforeEach(() => {
  // jsdom has no media queries; the store's theme listener needs one.
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
  clock = Date.UTC(2026, 9, 5, 9)
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  localStorage.clear()
  localStorage.setItem('planchelab.v1', JSON.stringify(seed()))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('leaving the session never silently discards work', () => {
  it('the header exit on an unsaved summary asks instead of discarding', () => {
    const onExit = mount()
    logOneSet()
    // Rest after the first block; skip the remaining sets to reach the summary.
    click(/Skip rest/)
    click(/Skip exercise/)
    expect(within(player()).getByText(/Not saved yet/)).toBeTruthy()

    click(/Exit session/)
    const prompt = screen.getByRole('dialog', { name: /Leave without saving/ })
    expect(within(prompt).getByText(/1 logged set is not saved yet/)).toBeTruthy()
    expect(onExit).not.toHaveBeenCalled()
    expect(draft()).not.toBeNull()

    click(/Keep reviewing/, prompt)
    expect(onExit).not.toHaveBeenCalled()
    expect(saved()).toHaveLength(0)

    click(/Exit session/)
    click(/Discard 1 set/, screen.getByRole('dialog', { name: /Leave without saving/ }))
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(saved()).toHaveLength(0)
    expect(draft()).toBeNull()
  })

  it('finishing early saves only what was done, marked partial', () => {
    mount()
    logOneSet()
    click(/Exit session/)
    click(/Finish early/, screen.getByRole('dialog', { name: /Leave training session/ }))
    expect(within(player()).getByText(/Finished early/)).toBeTruthy()
    expect(within(player()).getByText(/1 of 3 planned rounds done/)).toBeTruthy()

    click(/^Save session$/)
    const [session] = saved()
    expect(session.sets).toHaveLength(1)
    expect(session.completion).toBe('partial')
    expect(session.plannedRounds).toBe(3)
  })

  it('review time on the summary is not training time', () => {
    mount()
    const start = clock
    logOneSet()
    click(/Skip rest/)
    click(/Skip exercise/)
    const trainingEnded = clock
    // Ten minutes reading the summary, rating and writing notes.
    clock += 10 * 60_000
    click(/^Save session$/)
    const [session] = saved()
    expect(session.startedAt).toBe(start)
    expect(session.endedAt).toBe(trainingEnded)
    expect(session.savedAt).toBe(trainingEnded + 10 * 60_000)
  })

  it('a double tap on Save stores one session', () => {
    mount()
    logOneSet()
    click(/Skip rest/)
    click(/Skip exercise/)
    const save = within(player()).getByRole('button', { name: /^Save session$/ })
    act(() => {
      fireEvent.click(save)
      fireEvent.click(save)
    })
    expect(saved()).toHaveLength(1)
  })
})
