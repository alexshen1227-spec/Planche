// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  items: [
    {
      exerciseId: 'leg-curl',
      plan: { range: [10, 15], targetRpe: 8 },
      restSec: 60,
      unit: 'kg',
      sets: [
        { reps: 10, load: 30, done: false },
        { reps: 10, load: 30, done: false },
      ],
    },
  ],
}

afterEach(() => {
  cleanup()
  dispatch.mockClear()
})

describe('progress9: the gym player names what it asks for and keeps focus', () => {
  it('every set input says which exercise it belongs to', async () => {
    const { GymPlayer } = await import('../../components/gym/GymPlayer')
    render(<GymPlayer draft={draft} location={gym.locations[0]} onClose={() => undefined} />)
    expect(screen.getAllByLabelText(/^Leg curl, set 1 load$/i).length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText(/^Leg curl, set 2 reps$/i).length).toBeGreaterThan(0)
    expect(screen.queryAllByLabelText(/^Set 1 load$/).length).toBe(0)
  })

  it('moves keyboard focus from set completion to effort, then to the next set or Finish', async () => {
    const { GymPlayer } = await import('../../components/gym/GymPlayer')
    render(<GymPlayer draft={draft} location={gym.locations[0]} onClose={() => undefined} />)
    fireEvent.click(screen.getByLabelText('Complete set 1 of Leg curl'))
    expect(document.activeElement?.closest('[data-effort]')).toBe(screen.getByRole('group', { name: 'Effort for Leg curl, set 1' }))
    fireEvent.click(screen.getByRole('button', { name: '7' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    const active = document.activeElement as HTMLElement
    expect(active).not.toBe(document.body)
    expect(active.closest('[data-set="0-1"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Undo set 1 of Leg curl' })).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Complete set 2 of Leg curl'))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Finish' }))
  })
})
