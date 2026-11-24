// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { initialState, SETUP_DRAFT_KEY, StoreProvider, useStore } from '../store'
import { loadSetupDraft, newSetupDraft, saveSetupDraft } from '../onboardingDraft'
import { nextInterviewItem } from '../placement'
import { Onboarding } from '../../views/Onboarding'
import { Dashboard } from '../../views/Dashboard'
import { Train } from '../../views/Train'
import { Library } from '../../views/Library'
import { Stats } from '../../views/Stats'
import { defaultGym, defaultPrefs } from './state'
import type { GymEntry } from '../plan/screens'
import { loadDraft, saveDraft, type DraftItem } from './draft'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { Toasts } from '../../components/Toasts'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

function FirstRun() {
  const { state } = useStore()
  const [train, setTrain] = useState(false)
  const [entry, setEntry] = useState<GymEntry | null>(null)
  if (!state.onboarded) return <Onboarding />
  if (train) return <Train startWorkout={vi.fn()} entryPreset={entry} onEntryUsed={() => setEntry(null)} />
  return <Dashboard go={vi.fn()} startWorkout={vi.fn()} viewSession={vi.fn()} startGym={(p) => {
    setEntry(p)
    setTrain(true)
  }} />
}

it('confirms the imported workout count after restoring a backup on the welcome screen', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const at = Date.now()
  const gym = defaultGym(['floor'])
  const backup = { ...initialState(), onboarded: true, gym: { ...gym, sessions: [{
    id: 'my-squat', locationId: 'home', name: 'Lifting', startedAt: at - 300_000, endedAt: at,
    exercises: [{ exerciseId: 'bodyweight-squat', sets: [{ at, reps: 8 }] }],
  }] } }
  const { container } = render(<StoreProvider><FirstRun /><Toasts /></StoreProvider>)
  const file = new File([JSON.stringify(backup)], 'training.json', { type: 'application/json' })
  fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } })
  expect(await screen.findByText('Backup restored — 1 session.')).toBeTruthy()
  expect(screen.queryByText(/backup could not be applied/i)).toBeNull()
  expect(JSON.parse(localStorage.getItem('planchelab.v1')!).gym.sessions[0].id).toBe('my-squat')
})

it('restores an unfinished gym editor, then finishes setup with the saved name, unit and equipment', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  localStorage.setItem('planchelab.v1', JSON.stringify(initialState()))
  const mount = () => render(<StoreProvider><FirstRun /></StoreProvider>)
  const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
  const first = mount()
  fireEvent.change(screen.getByLabelText(/what should we call you/i), { target: { value: 'Quinn' } })
  click(/let's go/i)
  fireEvent.click(screen.getByRole('radio', { name: 'Calisthenics skills: off' }))
  click(/continue/i)
  click(/add a gym/i)
  fireEvent.change(screen.getByLabelText('Name of this place'), { target: { value: 'Track gym' } })
  const weightUnit = () => within(screen.getByRole('radiogroup', { name: 'Unit' })).getByRole('radio', { name: 'lb' })
  fireEvent.click(weightUnit())
  click('Dumbbells')
  const increment = () => screen.getByRole('spinbutton', { name: 'Dumbbells weight increment in lb' }) as HTMLInputElement
  fireEvent.change(screen.getByLabelText('Heaviest dumbbells in lb'), { target: { value: '52.5' } })
  fireEvent.change(increment(), { target: { value: '2.5' } })
  first.unmount()
  mount()
  expect(screen.getByDisplayValue('Track gym')).toBeTruthy()
  expect(weightUnit().getAttribute('aria-checked')).toBe('true')
  expect(increment().value).toBe('2.5')
  expect((screen.getByLabelText('Heaviest dumbbells in lb') as HTMLInputElement).value).toBe('52.5')
  expect(screen.getByRole('button', { name: 'Dumbbells' }).getAttribute('aria-pressed')).toBe('true')
  click('Save')
  click(/continue/i)
  click(/continue/i)
  click(/skip.*every muscle normal/i)
  click(/prefer not to say/i)
  click(/start training/i)
  const finished = JSON.parse(localStorage.getItem('planchelab.v1')!)
  expect(finished.name).toBe('Quinn')
  expect(finished.gym.locations).toContainEqual(expect.objectContaining({ name: 'Track gym', unit: 'lb', equipment: ['dumbbells'] }))
  const dumbbells = finished.gym.locations.find((l: { name: string }) => l.name === 'Track gym').gear.dumbbells
  expect(dumbbells.stepKg).toBeCloseTo(2.5 * 0.45359237)
  expect(dumbbells.maxKg).toBeCloseTo(52.5 * 0.45359237)
  expect(localStorage.getItem(SETUP_DRAFT_KEY)).toBeNull()
})

it('resumes the actual skill interview question and rejects obsolete or unreadable setup data', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const athlete = initialState()
  const epoch = athlete.epoch!
  localStorage.setItem('planchelab.v1', JSON.stringify(athlete))
  const draft = newSetupDraft()
  draft.stage = 'interview'
  draft.skills = ['handstand', 'frontlever']
  const first = nextInterviewItem(draft.skills, {})!
  draft.answers = { [first.id]: first.options[0].value, 'level:flag': 999 }
  const next = nextInterviewItem(draft.skills, draft.answers)!
  saveSetupDraft(epoch, draft)
  expect(loadSetupDraft('different-athlete')).toBeNull()
  expect(loadSetupDraft(epoch)?.answers).toEqual({ [first.id]: first.options[0].value })
  const ui = render(<StoreProvider><FirstRun /></StoreProvider>)
  expect(screen.getByRole('heading', { name: next.question })).toBeTruthy()
  ui.unmount()
  localStorage.setItem(SETUP_DRAFT_KEY, '{broken')
  expect(loadSetupDraft(epoch)).toBeNull()
  render(<StoreProvider><FirstRun /></StoreProvider>)
  expect(screen.getByRole('button', { name: /let's go/i })).toBeTruthy()
})

it('honors wrist pain when an athlete skips the remaining skill interview and finishes after a reload', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const athlete = initialState()
  localStorage.setItem('planchelab.v1', JSON.stringify(athlete))
  saveSetupDraft(athlete.epoch!, { ...newSetupDraft(), stage: 'interview', name: 'Kai', skills: ['frontlever', 'handstand'], equipment: ['floor', 'wall', 'pullup-bar'] })
  const mount = () => render(<StoreProvider><FirstRun /></StoreProvider>)
  const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
  const ui = mount()
  click(/no — it hurts/i)
  const report = loadSetupDraft(athlete.epoch)?.wristReport
  expect(report?.answer).toBe(0)
  click(/skip.*pick my own level/i)
  ui.unmount()
  mount()
  click(/continue/i)
  click(/continue/i)
  expect(screen.getByText(/wrist report will carry into training/i)).toBeTruthy()
  click(/looks right/i)
  click(/continue/i)
  click(/continue/i)
  click(/skip.*every muscle normal/i)
  click(/prefer not to say/i)
  click(/start training/i)
  const saved = JSON.parse(localStorage.getItem('planchelab.v1')!)
  expect(saved.symptoms).toEqual(expect.arrayContaining([expect.objectContaining({ at: report!.at, source: 'onboarding', joints: 'pain', regions: ['wrist'] })]))
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
    if (name === 'Goblet squat') {
      expect(guide.querySelector('iframe')).toBeNull()
      fireEvent.click(within(guide).getByRole('button', { name: 'Play Goblet squat demonstration' }))
      expect(within(guide).getByTitle('Goblet squat demonstration').getAttribute('src')).toContain('youtube-nocookie.com/embed/qBZ9pJf7uHY')
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
      fireEvent(window, new Event('offline'))
      expect(guide.querySelector('iframe')).toBeNull()
      expect(within(guide).getByText(/Video needs an internet connection/)).toBeTruthy()
      vi.restoreAllMocks()
      fireEvent(window, new Event('online'))
      expect(within(guide).getByRole('button', { name: /Play Goblet squat/ })).toBeTruthy()
    }
    fireEvent.click(within(guide).getByRole('button', { name: /close/i }))
  }
})

it('lets a gym-only athlete log a first set, reload Home and finish the original workout', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
  const mount = () => render(<StoreProvider><FirstRun /></StoreProvider>)
  const first = mount()
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
  click('8')
  click('Finish')
  click('Save session')
  const stored = () => JSON.parse(localStorage.getItem('planchelab.v1')!).gym.sessions
  const original = stored()[0]
  const left = original.remaining.items.reduce((n: number, it: { sets: unknown[] }) => n + it.sets.length, 0)
  expect(left).toBeGreaterThan(0)
  first.unmount()
  mount()
  expect(screen.getByText(/1 set logged/)).toBeTruthy()
  click(`Continue ${left} remaining ${left === 1 ? 'set' : 'sets'}`)
  click(/nothing hurts.*start/i)
  const player = within(screen.getByRole('dialog', { name: 'Gym session' }))
  expect(player.getByText(/1 set was already saved/)).toBeTruthy()
  const pending = player.getAllByLabelText(/^Complete set /)
  expect(pending.length).toBe(left)
  for (const set of pending) {
    fireEvent.click(set)
    click('8')
  }
  click('Finish')
  click('Save session')
  expect(stored()).toHaveLength(1)
  expect(stored()[0]).toMatchObject({ id: original.id, startedAt: original.startedAt, completion: 'full' })
  expect(stored()[0].remaining).toBeUndefined()
  expect(stored()[0].exercises[0].sets[0]).toEqual(original.exercises[0].sets[0])
})

it('keeps finished sets and applies a new pain check when Home reopens an unfinished gym workout', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const base = initialState()
  const at = Date.now() - 180_000
  const gym = defaultGym(['floor'])
  gym.locations[0].equipment.push('dumbbells', 'bench')
  const prefs = defaultPrefs(at)
  prefs.minutesByDay = Array.from({ length: 7 }, (_, i) => i === new Date().getDay() ? 45 : 0)
  localStorage.setItem('planchelab.v1', JSON.stringify({
    ...base, onboarded: true, profile: { ...base.profile, birthYear: 1994 },
    gym: { ...gym, prefs: { ...prefs, goals: { ...prefs.goals, skills: 0 } } },
  }))
  const squat = { reps: 8, load: 12, rpe: 7, at, done: true }
  const press = { ...squat, load: 14, at: at + 60_000 }
  const block = (exerciseId: string, logged?: typeof squat): DraftItem => ({
    exerciseId, restSec: 90, unit: 'kg', plan: { range: [8, 12], targetRpe: 8 },
    sets: [logged ?? { reps: 8, done: false }, { reps: 8, done: false }, { reps: 8, done: false }],
  })
  saveDraft({ id: 'open-work', startedAt: at, name: 'Full body', locationId: gym.locations[0].id, notes: 'Lunch break',
    items: [block('goblet-squat', squat), block('db-bench-press', press), block('push-up')] })
  render(<StoreProvider><FirstRun /></StoreProvider>)
  fireEvent.click(within(screen.getByRole('region', { name: 'Today’s session' })).getByRole('button'))
  fireEvent.click(screen.getByRole('button', { name: 'Shoulders' }))
  fireEvent.click(screen.getByRole('button', { name: /it hurts.*keep off it/i }))
  const player = within(screen.getByRole('dialog', { name: 'Gym session' }))
  expect(player.getByText('Completed before this check-in')).toBeTruthy()
  expect(JSON.parse(localStorage.getItem('planchelab.v1')!).symptoms).toEqual([expect.objectContaining({ joints: 'pain', regions: ['shoulder'] })])
  const d = loadDraft()!
  expect(d).toMatchObject({ id: 'open-work', notes: 'Lunch break', avoidJoints: ['shoulders'], volumeFactor: 0.6 })
  const remaining = d.items.filter((item) => item.sets.some((s) => !s.done))
  expect(remaining.every((it) => !GYM_EXERCISE_BY_ID[it.exerciseId].stress.includes('shoulders'))).toBe(true)
  expect(remaining[0].sets).toHaveLength(2)
  expect(d.items.flatMap((it) => it.sets.filter((s) => s.done))).toEqual([squat, press])
  expect(d.deferred?.map((it) => it.exerciseId)).toContain('db-bench-press')
  fireEvent.click(player.getByRole('button', { name: 'Add an exercise' }))
  expect(screen.queryByRole('button', { name: /dumbbell bench press/i })).toBeNull()
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Exercise options' })).getByRole('button', { name: /close/i }))
  fireEvent.click(player.getByRole('button', { name: 'Finish' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save session' }))
  const saved = JSON.parse(localStorage.getItem('planchelab.v1')!).gym.sessions
  expect(saved).toHaveLength(1)
  expect(saved[0].exercises.map((it: { sets: unknown[] }) => it.sets)).toEqual([
    [{ kg: 12, reps: 8, rpe: 7, unit: 'kg', at }], [{ kg: 14, reps: 8, rpe: 7, unit: 'kg', at: at + 60_000 }],
  ])
})
