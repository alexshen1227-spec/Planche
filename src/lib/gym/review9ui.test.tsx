// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { defaultGym } from './state'
import type { GymSession } from './types'

const T = Date.UTC(2026, 10, 2, 17)
const gym = { ...defaultGym([], 'kg', T) }
const saved: GymSession = {
  id: 's1',
  locationId: 'home',
  startedAt: T,
  endedAt: T + 3_600_000,
  name: 'Pull',
  notes: 'Left shoulder felt tight on the warm-up',
  exercises: [
    { exerciseId: 'leg-curl', repRange: [10, 15], targetRpe: 8, sets: [{ reps: 15, kg: 15, rpe: 8, at: T }] },
    { exerciseId: 'old-lift', sets: [{ reps: 8, kg: 30, rpe: 9, at: T }] },
  ],
}

vi.mock('../../lib/store', () => ({
  useStore: () => ({ state: { gym: { ...gym, sessions: [saved] }, profile: { birthYear: 1990 } }, dispatch: () => undefined }),
}))

afterEach(cleanup)

describe('7, 6. a saved session shows its effort, its note and what to do next', () => {
  it('prints each set’s effort, the session note, a retired movement by its id, and a next-time line per lift', async () => {
    const { SessionDetail } = await import('../../components/gym/SessionDetail')
    render(<SessionDetail session={saved} onClose={() => undefined} />)
    expect(screen.getByText(/effort 8/)).toBeTruthy()
    expect(screen.getByText(/effort 9/)).toBeTruthy()
    expect(screen.getByText(/Left shoulder felt tight/)).toBeTruthy()
    expect(screen.getByText(`old-lift (no longer in the catalogue)`)).toBeTruthy()
    expect(screen.getAllByText(/Next time|Repeat|No suggestion/).length).toBe(2)
    expect(screen.getByText(GYM_EXERCISE_BY_ID['leg-curl'].name)).toBeTruthy()
  })
})
