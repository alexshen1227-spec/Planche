// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { initialState, StoreProvider, useStore } from '../store'
import { Onboarding } from '../../views/Onboarding'
import { Dashboard } from '../../views/Dashboard'
import { Train } from '../../views/Train'
import { Library } from '../../views/Library'
import { Stats } from '../../views/Stats'
import { defaultGym, defaultPrefs } from './state'
import type { GymPreset } from '../plan/screens'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it('shows an opted-in gym-only athlete their recorded bodyweight and comparable bodyweight sets on Progress', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const base = initialState()
  const now = Date.now()
  const dates = [now - 7 * 86_400_000, now]
  const gym = defaultGym(['floor'])
  const prefs = defaultPrefs(now)
  localStorage.setItem('planchelab.v1', JSON.stringify({
    ...base, onboarded: true, profile: { ...base.profile, birthYear: 1994 },
    settings: { ...base.settings, trackBodyweight: true, units: 'metric' },
    measurements: dates.map((at, i) => ({ at, weightKg: 72 + i })),
    gym: { ...gym, prefs: { ...prefs, goals: { ...prefs.goals, skills: 0 } },
      sessions: dates.map((at, i) => ({ id: `log-${i}`, locationId: gym.locations[0].id, name: 'Gym', startedAt: at - 3600, endedAt: at,
        exercises: [{ exerciseId: 'split-squat', sets: [{ at, reps: 8 + i }] }] })) },
  }))
  render(<StoreProvider><Stats /></StoreProvider>)
  expect(screen.getByText('73.0 kg', { selector: 'strong' })).toBeTruthy()
  expect(screen.getByRole('img', { name: /Recorded bodyweight/ })).toBeTruthy()
  expect(screen.getByRole('img', { name: /Most reps at bodyweight for .*split squat/i })).toBeTruthy()
})

it('finds prescribed gym movements in Learn and opens their equipment and technique guides', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  render(<StoreProvider><Library /></StoreProvider>)
  const query = screen.getByRole('searchbox', { name: 'Search exercises' })
  for (const name of ['Reverse Nordic curl', 'Slider hamstring curl', 'Goblet squat']) {
    fireEvent.change(query, { target: { value: name } })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}, gym exercise`, 'i') }))
    const guide = screen.getByRole('dialog', { name: `${name} exercise guide` })
    expect(within(guide).getByText('Equipment')).toBeTruthy()
    expect(within(guide).getByText('Main muscles')).toBeTruthy()
    fireEvent.click(within(guide).getByRole('button', { name: /close/i }))
  }
})

it('takes a gym-only athlete from goals through Home into a loggable first set', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  function FirstRun() {
    const { state } = useStore()
    const [train, setTrain] = useState(false)
    const [entry, setEntry] = useState<GymPreset | null>(null)
    if (!state.onboarded) return <Onboarding />
    if (train) return <Train startWorkout={vi.fn()} entryPreset={entry} onEntryUsed={() => setEntry(null)} />
    return <Dashboard go={vi.fn()} startWorkout={vi.fn()} viewSession={vi.fn()} startGym={(p) => {
      setEntry(p)
      setTrain(true)
    }} />
  }
  const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
  render(<StoreProvider><FirstRun /></StoreProvider>)
  click(/let's go/i)
  fireEvent.click(screen.getByRole('radio', { name: 'Calisthenics skills: off' }))
  click(/continue/i)
  expect(screen.getByRole('heading', { name: 'Where do you train?' })).toBeTruthy()
  click('Back')
  expect(screen.getByRole('heading', { name: 'What are you training for?' })).toBeTruthy()
  click(/continue/i)
  click(/continue/i)
  click(/continue/i)
  click(/skip.*every muscle normal/i)
  click(/prefer not to say/i)
  click(/start training/i)
  expect(screen.getByRole('heading', { name: 'Your training' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /rather do calisthenics/i })).toBeNull()
  fireEvent.click(within(screen.getByRole('region', { name: 'Today’s session' })).getByRole('button'))
  click(/nothing hurts.*start/i)
  const firstSet = screen.getAllByLabelText('Complete set 1')[0]
  fireEvent.click(firstSet)
  expect(screen.getByRole('group', { name: 'How hard was that set?' })).toBeTruthy()
})
