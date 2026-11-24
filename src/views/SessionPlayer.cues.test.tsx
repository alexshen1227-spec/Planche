// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState, StepId, Workout } from '../types'
import { initialState, StoreProvider } from '../lib/store'
import { STEPS, STEP_BY_ID } from '../data/progressions'
import { SessionPlayer } from './SessionPlayer'
import { loadDraft } from '../lib/draft'
import { peekNextBlock } from '../lib/plan/nextBlock'
import { resumeSkillWorkout } from '../lib/resumeSkillWorkout'

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

function seed(stepId: StepId, walkBackSec?: number): AppState {
  const base = initialState()
  return {
    ...base,
    settings: { ...base.settings, ...(walkBackSec !== undefined ? { walkBackSec } : {}) },
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
function startHold(workout: Workout, stepId: StepId, walkBackSec?: number) {
  const state = seed(stepId, walkBackSec)
  if (workout.skills?.includes('frontlever')) state.profile.equipment.push('pullup-bar')
  localStorage.setItem('planchelab.v1', JSON.stringify(state))
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

it.each([false, true])('stops a front lever session after a joint report, including across reload (corrected: %s)', (corrected) => {
  const workout: Workout = {
    id: 'lever', name: 'Front lever', focus: '', minutes: 10, kind: 'auto', skills: ['frontlever'],
    blocks: [{ exerciseId: 'tuck-front-lever', sets: 3, target: { kind: 'hold', sec: 5 }, restSec: 60, section: 'main', role: 'skill' }],
    request: { source: 'auto', gymAfter: { focus: 'upper', minutes: 25, avoidJoints: [], musclesOff: [], volumeFactor: 1 } },
  }
  const button = (name: string | RegExp) => screen.getByRole('button', { name })
  startHold(workout, 'foundations')
  holdFor(11.2)
  fireEvent.click(button('Stop hold'))
  fireEvent.click(button('Clean'))
  expect(screen.getByText('raised')).toBeTruthy()
  fireEvent.click(button('Pain or discomfort?'))
  fireEvent.click(button('Pain'))
  fireEvent.click(button('Shoulder'))
  fireEvent.click(button('Wrist'))
  act(() => { vi.advanceTimersByTime(65_000) })
  fireEvent.click(button('Record it'))
  expect(screen.getByRole('heading', { name: 'Training stopped' })).toBeTruthy()
  expect(screen.queryByText('raised')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Skip rest' })).toBeNull()
  const draft = loadDraft()!
  expect(draft.logs).toHaveLength(1)
  expect(draft.logs[0]).toMatchObject({ value: 8.9, target: 5, form: { rating: 'clean' } })
  cleanup()
  render(<StoreProvider><SessionPlayer workout={workout} resumeFrom={draft} onExit={() => {}} /></StoreProvider>)
  fireEvent.keyDown(window, { key: 's' })
  fireEvent.keyDown(window, { code: 'Space' })
  expect(screen.getByText(/Pain \(shoulder, wrist\) recorded/i)).toBeTruthy()
  if (corrected) {
    fireEvent.click(button(/Undo — I tapped/))
    expect(screen.queryByRole('heading', { name: 'Training stopped' })).toBeNull()
    expect(button(/lead-in$/)).toBeTruthy()
    expect(loadDraft()!.logs).toEqual(draft.logs)
    expect(loadDraft()!.attemptReport).toBeUndefined()
  } else {
    fireEvent.click(button('Save session'))
    const state: AppState = JSON.parse(localStorage.getItem('planchelab.v1')!)
    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0]).toMatchObject({ completion: 'partial', sets: draft.logs })
    expect(state.sessions[0].remaining).toBeUndefined()
    expect(state.symptoms?.at(-1)).toMatchObject({ joints: 'pain', regions: ['shoulder', 'wrist'] })
    expect(peekNextBlock(Date.now())).toBeNull()
  }
})

describe('what the athlete hears during a hold', () => {
  it('resumes the eased target displayed before saving early', () => {
    const workout: Workout = { id: 'hangs', name: 'Active hangs', focus: '', minutes: 15, kind: 'auto', skills: ['frontlever'],
      blocks: [{ exerciseId: 'active-hang', sets: 4, target: { kind: 'hold', sec: 15 }, section: 'main', restSec: 60, role: 'skill' }] }
    startHold(workout, 'foundations')
    const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
    holdFor(5.9)
    click('Stop hold')
    click('Skip rest')
    act(() => { vi.advanceTimersByTime(100) })
    click(/lead-in$/)
    click('Skip lead-in')
    holdFor(4.5)
    click('Stop hold')
    expect(screen.getByText('eased')).toBeTruthy()
    const target = Number(screen.getByText('eased').previousElementSibling?.textContent?.replace('s', ''))
    expect(target).toBeGreaterThan(0)
    expect(target).toBeLessThan(15)
    click('Exit session')
    click(/Finish early/)
    click('Save session')
    const state: AppState = JSON.parse(localStorage.getItem('planchelab.v1')!)
    expect(state.sessions[0].remaining?.blocks[0]).toMatchObject({ sets: 2, target: { kind: 'hold', sec: target } })
    expect(resumeSkillWorkout(state, state.sessions[0].id, undefined, Date.now())?.workout.blocks[0].target).toEqual({ kind: 'hold', sec: target })
  })
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

  it('keeps "Target" when a measured walk lands the call just before a count', () => {
    // A 4.6s measured walk: the call at 24.6s, the "25" count 0.4s later.
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
      4.6,
    )
    holdFor(27)
    const call = spoken.find((s) => s.word === 'Target')!
    expect(call).toBeDefined()
    expect(call.at).toBeLessThan(25)
    expect(spoken.filter((s) => s.at > call.at && s.at < call.at + 1.5)).toEqual([])
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
