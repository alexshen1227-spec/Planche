// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { defaultGym } from './state'
import { loadDraft, type GymDraft } from './draft'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'

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
  localStorage.clear()
  dispatch.mockClear()
})

it.each(['weighted-pull-up', 'weighted-dip', 'weighted-push-up'])('logs a first fractional added load on %s and carries it into the next session', async (id) => {
  const { GymPlayer, draftItemFor } = await import('../../components/gym/GymPlayer')
  const ex = GYM_EXERCISE_BY_ID[id]
  const location = { ...gym.locations[0], gear: { [ex.stepFrom!]: { stepKg: 1.25 } } }
  const now = Date.now()
  const item = draftItemFor(ex, location, [], false, 1, now)
  render(<GymPlayer draft={{ ...draft, startedAt: now, items: [item] }} location={location} onClose={() => undefined} />)
  const label = `${ex.name}, set 1 added load`
  const field = screen.getByRole('textbox', { name: label }) as HTMLInputElement
  fireEvent.focus(field)
  for (const value of ['5', '5,', '5,0']) fireEvent.change(field, { target: { value } })
  expect(field.value).toBe('5,0')
  fireEvent.blur(field)
  fireEvent.click(screen.getByRole('button', { name: `More kg, ${label}` }))
  expect(field.value).toBe('6.25')
  fireEvent.click(screen.getByLabelText('Complete set 1'))
  fireEvent.click(screen.getByRole('button', { name: '8' }))
  fireEvent.click(screen.getByText('Finish'))
  fireEvent.click(screen.getByText('Save session'))
  const saved = dispatch.mock.calls.map(([action]) => action.op?.session).find(Boolean)
  expect(saved.exercises[0].sets[0]).toMatchObject({ kg: 6.25, rpe: 8 })
  expect(draftItemFor(ex, location, [saved], false, 1, now + 86_400_000).sets[0].load).toBe(6.25)
})

it('recovers the remaining rest, unanswered effort and typed notes when the phone reloads', async () => {
  const { GymPlayer } = await import('../../components/gym/GymPlayer')
  const start = { ...draft, startedAt: Date.now(), items: [{ ...draft.items[0], sets: [{ reps: 10, load: 25, done: false }] }] }
  const mount = (d: GymDraft) => render(<GymPlayer draft={d} location={gym.locations[0]} onClose={() => undefined} />)
  const first = mount(start)
  fireEvent.click(screen.getByLabelText('Complete set 1'))
  fireEvent.click(screen.getByText('Finish'))
  fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'Seat at 4' } })
  const savedDraft = loadDraft()!
  expect(savedDraft.rest!.until).toBeGreaterThan(Date.now())
  first.unmount()
  mount(savedDraft)
  expect(screen.getByRole('group', { name: 'How hard was that set?' })).toBeTruthy()
  expect(screen.getByLabelText('15 seconds more')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '8' }))
  fireEvent.click(screen.getByText('Finish'))
  expect((screen.getByLabelText('Notes (optional)') as HTMLTextAreaElement).value).toBe('Seat at 4')
  fireEvent.click(screen.getByText('Save session'))
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ op: expect.objectContaining({ session: expect.objectContaining({ notes: 'Seat at 4' }) }) }))
  expect(loadDraft()).toBeNull()
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
