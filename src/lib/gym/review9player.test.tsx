// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { defaultGym } from './state'
import type { GymDraft } from './draft'

const T = Date.UTC(2026, 10, 2, 17)
const gym = defaultGym([], 'kg', T)
const dispatch = vi.fn()

vi.mock('../../lib/store', () => ({
  useStore: () => ({ state: { gym, sessions: [], profile: { birthYear: 1990 }, settings: {} }, dispatch }),
}))

const draft: GymDraft = {
  id: 'd1',
  startedAt: T,
  locationId: 'home',
  name: 'Legs',
  items: [{ exerciseId: 'leg-curl', plan: { range: [10, 15], targetRpe: 8 }, restSec: 60, unit: 'kg', sets: [{ reps: 10, done: false }] }],
}

afterEach(() => {
  cleanup()
  dispatch.mockClear()
})

describe('8. a pending weight question holds Finish and Save', () => {
  it('Finish does not open while the weight question is waiting, and nothing is saved', async () => {
    const { GymPlayer } = await import('../../components/gym/GymPlayer')
    render(<GymPlayer draft={draft} location={gym.locations[0]} onClose={() => undefined} />)
    fireEvent.click(screen.getByLabelText('Complete set 1'))
    expect(screen.getByText('What weight was that?')).toBeTruthy()
    fireEvent.click(screen.getByText('Finish'))
    expect(screen.queryByText('Finish this session?')).toBeNull()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('with nothing pending Finish opens, and says which sets will not be saved', async () => {
    const { GymPlayer } = await import('../../components/gym/GymPlayer')
    render(<GymPlayer draft={draft} location={gym.locations[0]} onClose={() => undefined} />)
    fireEvent.click(screen.getByText('Finish'))
    expect(screen.getByText('Finish this session?')).toBeTruthy()
    expect(screen.getByText(/1 set not done will not be saved/)).toBeTruthy()
  })
})
