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

it.each([true, false])('checks a large correction before changing completed sets and records (prior visit %s)', async (priorVisit) => {
  const { GymPlayer } = await import('../../components/gym/GymPlayer')
  const id = 'chest-supported-db-row'
  gym.sessions = priorVisit ? [{ id: 'previous-row', name: 'Pull', locationId: gym.locations[0].id, startedAt: T - 1, endedAt: T,
    exercises: [{ exerciseId: id, sets: [{ at: T, reps: 10, kg: 20, rpe: 8 }] }] }] : []
  try {
    const done = { reps: 10, load: 20, done: true, rpe: 8, at: T }
    const row = { ...draft.items[0], exerciseId: id, sets: [{ ...done }, { ...done, at: T + 10 }] }
    render(<GymPlayer draft={{ ...draft, name: 'Pull', items: [row] }} location={gym.locations[0]} onClose={() => undefined} />)
    const input = screen.getByRole('textbox', { name: 'Chest-supported dumbbell row, set 1 load' })
    const edit = (value: string) => { fireEvent.focus(input); fireEvent.change(input, { target: { value } }); fireEvent.blur(input) }
    edit('200')
    expect(screen.getByRole('dialog', { name: 'Check this load' })).toBeTruthy()
    expect(loadDraft()!.items[0].sets[0].load).toBe(20)
    fireEvent.click(screen.getByText('Let me change it'))
    expect(loadDraft()!.items[0].sets[0]).toEqual(done)
    edit('200')
    fireEvent.click(screen.getByText('I meant 20 kg'))
    expect(loadDraft()!.items[0].sets[0]).toMatchObject(done)
    edit('200')
    fireEvent.click(screen.getByText('Yes, 200 kg is right'))
    fireEvent.click(screen.getByText('Finish'))
    fireEvent.click(screen.getByText('Save session'))
    const saved = dispatch.mock.calls.map(([action]) => action.op?.session).find(Boolean)
    expect(saved.exercises[0].sets).toEqual([{ at: T, reps: 10, kg: 200, unit: 'kg', rpe: 8 }, { at: T + 10, reps: 10, kg: 20, unit: 'kg', rpe: 8 }])
  } finally {
    gym.sessions = []
  }
})

it('prefills later working sets with the reps and load just logged, including after reopening the workout', async () => {
  const { GymPlayer } = await import('../../components/gym/GymPlayer')
  const row = { ...draft.items[0], exerciseId: 'chest-supported-db-row', plan: { range: [6, 12] as [number, number], targetRpe: 8 },
    sets: [...Array.from({ length: 4 }, () => ({ reps: 6, load: 20, done: false })),
      { reps: 5, load: 12, done: false, warmup: true }, { reps: 7, load: 18, done: true, at: T }] }
  const mount = (d: GymDraft) => render(<GymPlayer draft={d} location={gym.locations[0]} onClose={() => undefined} />)
  const first = mount({ ...draft, items: [row, draft.items[0]] })
  const field = (set: number, kind: 'reps' | 'load') =>
    screen.getByRole('textbox', { name: `Chest-supported dumbbell row, set ${set} ${kind}` }) as HTMLInputElement
  const enter = (set: number, kind: 'reps' | 'load', value: string) => {
    fireEvent.change(field(set, kind), { target: { value } })
    fireEvent.blur(field(set, kind))
  }
  const complete = (set: number) => fireEvent.click(screen.getByRole('button', { name: `Complete set ${set} of Chest-supported dumbbell row` }))
  enter(3, 'load', '18')
  enter(4, 'reps', '8')
  enter(1, 'load', '24')
  enter(1, 'reps', '10')
  complete(1)
  expect([field(2, 'load').value, field(2, 'reps').value]).toEqual(['24', '10'])
  expect([field(3, 'load').value, field(3, 'reps').value]).toEqual(['18', '10'])
  expect([field(4, 'load').value, field(4, 'reps').value]).toEqual(['24', '8'])

  first.unmount()
  mount(loadDraft()!)
  enter(2, 'reps', '9')
  complete(2)
  const saved = loadDraft()!
  expect(saved.items[0].sets.map((s) => [s.load, s.reps])).toEqual([[24, 10], [24, 9], [18, 9], [24, 8], [12, 5], [18, 7]])
  expect(saved.items[1]).toEqual(draft.items[0])
})

it('asks the first time for machine assistance and keeps an intentional zero on subsequent sets and reload', async () => {
  const { GymPlayer } = await import('../../components/gym/GymPlayer')
  const it = { ...draft.items[0], exerciseId: 'assisted-pull-up', sets: [0, 1].map(() => ({ reps: 10, done: false })) }
  render(<GymPlayer draft={{ ...draft, items: [it] }} location={gym.locations[0]} onClose={() => undefined} />)
  fireEvent.click(screen.getByLabelText('Complete set 1 of Assisted pull-up'))
  expect(screen.getByText('How much assistance did you use?')).toBeTruthy()
  fireEvent.click(screen.getByText('Log with no assistance'))
  fireEvent.click(screen.getByRole('button', { name: '7' }))
  fireEvent.click(screen.getByLabelText('Complete set 2 of Assisted pull-up'))
  expect(screen.queryByText('How much assistance did you use?')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '7' }))
  fireEvent.click(screen.getByText('Finish'))
  fireEvent.click(screen.getByText('Save session'))
  const session = dispatch.mock.calls.map(([a]) => a.op?.session).find(Boolean)
  const { sanitizeGym } = await import('./state')
  expect(sanitizeGym({ ...gym, sessions: [session] })?.sessions[0].exercises[0].sets.map((s) => s.kg)).toEqual([0, 0])
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
  fireEvent.click(screen.getByLabelText(/^Complete set 1 of /))
  fireEvent.click(screen.getByRole('button', { name: '8' }))
  fireEvent.click(screen.getByText('Finish'))
  fireEvent.click(screen.getByText('Save session'))
  const saved = dispatch.mock.calls.map(([action]) => action.op?.session).find(Boolean)
  expect(saved.exercises[0].sets[0]).toMatchObject({ kg: 6.25, rpe: 8 })
  expect(draftItemFor(ex, location, [saved], false, 1, now + 86_400_000).sets[0].load).toBe(6.25)
})

it('recovers the remaining rest, unanswered effort and typed notes when the phone reloads', async () => {
  const { GymPlayer } = await import('../../components/gym/GymPlayer')
  const start = { ...draft, startedAt: Date.now(), items: [{ ...draft.items[0], sets: [{ reps: 10, load: 25, done: false }, { reps: 10, load: 25, done: false }] }] }
  const mount = (d: GymDraft) => render(<GymPlayer draft={d} location={gym.locations[0]} onClose={() => undefined} />)
  const first = mount(start)
  fireEvent.click(screen.getByLabelText('Complete set 1 of Leg curl'))
  fireEvent.click(screen.getByText('Finish'))
  fireEvent.change(screen.getByLabelText('Notes (optional)'), { target: { value: 'Seat at 4' } })
  const savedDraft = loadDraft()!
  expect(savedDraft.rest!.until).toBeGreaterThan(Date.now())
  first.unmount()
  mount(savedDraft)
  expect(screen.getByRole('group', { name: 'Effort for Leg curl, set 1' })).toBeTruthy()
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
    fireEvent.click(screen.getByLabelText('Complete set 1 of Leg curl'))
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
    expect(screen.getByText(/1 unfinished set left in your plan/)).toBeTruthy()
  })
})
