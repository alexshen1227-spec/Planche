// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { forgetUnfinishedWork, initialState, reducer, SETUP_DRAFT_KEY, StoreProvider, useStore } from '../store'
import { loadSetupDraft, newSetupDraft, saveSetupDraft } from '../onboardingDraft'
import { nextInterviewItem } from '../placement'
import { Onboarding } from '../../views/Onboarding'
import { Dashboard } from '../../views/Dashboard'
import { Train } from '../../views/Train'
import { Library } from '../../views/Library'
import { Stats } from '../../views/Stats'
import { defaultGym, defaultPrefs, sanitizeGym } from './state'
import type { GymEntry } from '../plan/screens'
import { loadDraft, resumePartial, saveDraft, sessionFromDraft, type DraftItem } from './draft'
import { GYM_EXERCISE_BY_ID, jointsToRest } from '../../data/gym/exercises'
import { Toasts } from '../../components/Toasts'
import { GymPlayer } from '../../components/gym/GymPlayer'
import { GymWorkoutGate } from '../../components/gym/GymWorkoutGate'
import { PartialWorkout } from '../../components/gym/PartialWorkout'
import { WeekVolume } from '../../components/plan/WeekVolume'
import { PlanSettings } from '../../components/plan/PlanSettings'
import { WeekPreview } from '../../components/plan/WeekPreview'
import { makeAthlete } from '../plan/wholeAthleteLoop'
import { dayKey, addDays } from '../time'
import { skillGoalPace } from '../plan/planner'
import type { Session, SetLog } from '../../types'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('retires an open gym writer and its draft when another tab replaces the training history', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const athlete = makeAthlete({ skills: ['handstand'], active: 'home' })
  const place = athlete.gym!.locations[0]
  localStorage.setItem('planchelab.v1', JSON.stringify(athlete))
  const at = Date.now() - 60_000
  const item: DraftItem = { exerciseId: 'goblet-squat', plan: { range: [6, 10], targetRpe: 8 }, restSec: 120, unit: 'lb',
    sets: [{ reps: 10, load: 35, done: true, rpe: 8, at: at + 30_000 }] }
  const draft = { id: 'old', startedAt: at, locationId: place.id, name: 'Lower body', items: [item] }
  const close = vi.fn()
  render(<StoreProvider><GymWorkoutGate draft={draft} location={place} onClose={close} /></StoreProvider>)
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
  const save = screen.getByRole('button', { name: 'Save session' })
  expect(loadDraft(athlete.epoch)?.epoch).toBe(athlete.epoch)
  const replacement = reducer(athlete, { type: 'IMPORT_REPLACE', state: athlete, expectedRev: athlete.rev ?? 0 })
  expect(replacement.epoch).not.toBe(athlete.epoch)
  localStorage.setItem('planchelab.v1', JSON.stringify(replacement))
  forgetUnfinishedWork()
  fireEvent.click(save)
  fireEvent(window, new StorageEvent('storage', { key: 'planchelab.v1', newValue: JSON.stringify(replacement) }))
  expect(close).toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Save session' })).toBeNull()
  expect(loadDraft()).toBeNull()
  expect(reducer(replacement, { type: 'GYM', expectedEpoch: athlete.epoch, op: { op: 'saveSession', session: sessionFromDraft(draft, Date.now()) } })).toBe(replacement)
  expect(JSON.parse(localStorage.getItem('planchelab.v1')!).gym.sessions).toHaveLength(0)
})

it('alternates the two nominated lifts, keeps recovery across a reload, and restores straight sets after a hard effort', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const gym = defaultGym(['floor'], 'kg'), place = gym.locations[0]
  place.equipment.push('dumbbells')
  localStorage.setItem('planchelab.v1', JSON.stringify({ ...initialState(), onboarded: true, gym }))
  const lifts = ['db-lateral-raise', 'floor-calf-raise']
  const items: DraftItem[] = lifts.map((exerciseId, i) => ({ exerciseId, pairedWith: lifts[1 - i], plan: { range: [10, 15], targetRpe: 8 },
    restSec: 75, unit: 'kg', sets: Array.from({ length: 3 }, () => ({ reps: 12, load: i ? undefined : 4, done: false })) }))
  const start = Date.now()
  const initial = { id: 'pair', startedAt: start, locationId: place.id, name: 'Upper', items }
  const open = (draft = loadDraft() ?? initial) => render(<StoreProvider><GymPlayer draft={draft} location={place} onClose={() => {}} /></StoreProvider>)
  const first = open()
  const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
  click('Complete set 1 of Dumbbell lateral raise')
  expect(loadDraft()?.rest).toMatchObject({ total: 20, nextExerciseId: lifts[1] })
  click('8')
  first.unmount()
  open()
  expect(screen.getByText('Next · Floor calf raise')).toBeTruthy()
  click('Complete set 1 of Floor calf raise')
  expect(loadDraft()?.rest?.until).toBeGreaterThanOrEqual(start + 75_000)
  expect(loadDraft()?.rest?.nextExerciseId).toBe(lifts[0])
  click('9')
  const stored = loadDraft()!
  expect(stored.items.every((it) => !it.pairedWith)).toBe(true)
  expect(stored.items[1].sets[0].rpe).toBe(9)
  expect(stored.rest?.nextExerciseId).toBeUndefined()
  expect(stored.rest?.until).toBeGreaterThanOrEqual(stored.items[1].sets[0].at! + 75_000)
  expect(screen.queryByText('Use straight sets')).toBeNull()
})

it.each([['push-up', 0], ['push-up', 1], ['pull-up', 0], ['pull-up', 1]] as const)('saves the actual %s trial of %i reps, preserves the easier sets and recovers the draft', (id, reps) => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const gym = defaultGym(['floor', 'wall', 'band', 'pullup-bar'], 'kg')
  const push = id === 'push-up'
  const prep = push ? 'kneeling-push-up' : 'band-assisted-pull-up'
  const label = push ? 'Try a floor push-up' : 'Try an unassisted pull-up'
  localStorage.setItem('planchelab.v1', JSON.stringify({ ...initialState(), onboarded: true, gym }))
  const item: DraftItem = { exerciseId: prep, restSec: 90, unit: 'kg', plan: { range: [8, 12], targetRpe: 7 },
    suggestion: { kind: 'bodyweight', reps: [8, 12], targetRpe: 7, ...(push ? { floorPushupTrial: 1 } : { pullupTrial: 1 }), why: 'One optional set.' },
    sets: [0, 1, 2].map(() => ({ done: false, reps: 12 })) }
  const draft = { id: 'floor-trial', name: 'Upper body', startedAt: Date.now(), locationId: gym.locations[0].id, items: [item] }
  const mount = (d: typeof draft | NonNullable<ReturnType<typeof loadDraft>>) =>
    render(<StoreProvider><GymPlayer draft={d} location={gym.locations[0]} onClose={() => {}} /></StoreProvider>)
  const first = mount(draft)
  fireEvent.click(screen.getByRole('button', { name: label }))
  fireEvent.click(screen.getByRole('button', { name: 'Keep my planned sets' }))
  expect(loadDraft()?.items[0].sets).toHaveLength(3)
  fireEvent.click(screen.getByRole('button', { name: label }))
  fireEvent.click(screen.getByRole('button', { name: `Log ${reps} ${push ? 'floor push-up' : 'unassisted pull-up'} ${reps === 1 ? 'rep' : 'reps'}` }))
  const active = loadDraft()!
  expect(active.items[0]).toMatchObject({ exerciseId: id, sets: [{ reps, done: true }] })
  expect(active.items[1].sets).toHaveLength(2)
  first.unmount()
  mount(active)
  expect(screen.queryByRole('button', { name: label })).toBeNull()
  if (reps) fireEvent.click(screen.getByRole('button', { name: '7' }))
  fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save session' }))
  const saved = JSON.parse(localStorage.getItem('planchelab.v1')!).gym.sessions[0]
  expect(saved.exercises).toMatchObject([{ exerciseId: id, sets: [{ reps }] }])
  expect(saved.remaining.items[0]).toMatchObject({ exerciseId: prep })
  expect(saved.remaining.items[0].trialReps).toBeUndefined()
  expect(saved.remaining.items[0].sets).toHaveLength(2)
})

it('shows the earned two-by-two floor prescription and moves only unfinished sets into its easier block', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const gym = defaultGym(['floor'], 'kg')
  localStorage.setItem('planchelab.v1', JSON.stringify({ ...initialState(), onboarded: true, gym }))
  const place = gym.locations[0]
  const floor: DraftItem = { exerciseId: 'push-up', restSec: 90, unit: 'kg', plan: { range: [2, 2], targetRpe: 7 },
    suggestion: { kind: 'bodyweight', reps: [2, 2], targetReps: 2, targetRpe: 7, easierId: 'kneeling-push-up', why: 'Two clean reps per set.' },
    sets: [{ reps: 2, done: true, rpe: 7, at: Date.now() }, { reps: 2, done: false }] }
  const easier: DraftItem = { exerciseId: 'kneeling-push-up', restSec: 90, unit: 'kg', plan: { range: [8, 12], targetRpe: 7 }, sets: [{ reps: 8, done: false }] }
  render(<StoreProvider><GymPlayer draft={{ id: 'split', name: 'Upper', startedAt: Date.now(), locationId: place.id, items: [floor, easier] }} location={place} onClose={() => {}} /></StoreProvider>)
  expect(screen.getByText(/2 × 2 reps · stop about RPE 7/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /use kneeling push-up for remaining sets/i }))
  const saved = loadDraft()!
  expect(saved.items).toHaveLength(2)
  expect(saved.items[0].sets).toMatchObject([{ done: true, reps: 2 }])
  expect(saved.items[1].sets).toMatchObject([{ done: false, reps: 8 }, { done: false, reps: 8 }])
})

it('keeps an unused trial and its later easier option when a partial session is exported and resumed', () => {
  const gym = defaultGym(['floor', 'wall', 'pullup-bar', 'band'], 'kg')
  const place = gym.locations[0]
  const at = Date.now()
  const prep: DraftItem = { exerciseId: 'band-assisted-pull-up', unit: 'kg', restSec: 120, plan: { range: [8, 10], targetRpe: 7 },
    suggestion: { kind: 'bodyweight', reps: [8, 10], targetRpe: 7, why: '', pullupTrial: 1 }, sets: [{ done: false, reps: 8 }, { done: false, reps: 8 }] }
  const work: DraftItem = { exerciseId: 'push-up', unit: 'kg', restSec: 90, plan: { range: [2, 2], targetRpe: 7 },
    suggestion: { kind: 'bodyweight', reps: [2, 2], targetRpe: 7, why: '', easierId: 'kneeling-push-up' }, sets: [{ done: true, reps: 2, at }, { done: false, reps: 2 }] }
  const partial = sessionFromDraft({ name: 'Upper', id: 'continuation', startedAt: at, locationId: place.id, items: [work, prep] }, at + 100)
  const restored = sanitizeGym(JSON.parse(JSON.stringify({ ...gym, sessions: [partial] })))!.sessions[0]
  const draft = resumePartial(restored, [], place, at + 200)!
  expect(draft.items.map((it) => it.suggestion?.easierId ?? it.suggestion?.pullupTrial)).toEqual(['kneeling-push-up', 1])
  expect(draft.items[0].sets).toEqual([{ done: false, reps: 2 }])
})

it('saves separate training locations for weekdays and resets one weekday to automatic', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const gym = defaultGym(['floor', 'wall'], 'kg')
  gym.locations.push({ ...gym.locations[0], id: 'club', name: 'Sports club', equipment: ['pullup-bar', 'dumbbells'] })
  gym.prefs = { ...defaultPrefs(Date.now()), minutesByDay: [0, 0, 45, 0, 45, 0, 45] }
  localStorage.setItem('planchelab.v1', JSON.stringify({ ...initialState(), onboarded: true, gym }))
  const mount = () => render(<StoreProvider><PlanSettings onDone={() => {}} /></StoreProvider>)
  const choose = (day: string, value: string) => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + day + ': 45 minutes') }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Training location on ' + day }), { target: { value } })
  }
  const ui = mount()
  choose('Tuesday', 'home')
  choose('Saturday', 'club')
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  ui.unmount()
  mount()
  expect(screen.getByRole('button', { name: /Saturday: 45 minutes at Sports club/ })).toBeTruthy()
  choose('Tuesday', '')
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(JSON.parse(localStorage.getItem('planchelab.v1')!).gym.prefs.placeByDay).toEqual([null, null, null, null, null, null, 'club'])
})

it('compares actual skills and lifts from the week view, saves the recurring option and removes it in schedule settings', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 7, 17))
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  try {
    const athlete = makeAthlete({ skills: ['frontlever', 'handstand'], birthYear: 1994, active: 'home', kit: ['floor', 'wall', 'pullup-bar', 'rings'],
      steps: { frontlever: 'fl-advtuck', handstand: 'hs-float' }, prefs: { goals: { skills: 4, physique: 5, strength: 3, power: 0, endurance: 0 },
        musclesPriority: ['chest-upper', 'side-delts', 'calves'], minutesByDay: [0, 45, 75, 0, 45, 0, 75], placeByDay: [null, 'home', 'gym', null, 'home', null, 'gym'],
        sportSchedule: [{ weekday: 3, kind: 'climb', minutes: 75, rpe: 8, upperPull: true, legs: false }] } })
    localStorage.setItem('planchelab.v1', JSON.stringify(athlete))
    const view = render(<StoreProvider><WeekPreview /></StoreProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Compare skill and lifting days' }))
    expect(screen.getByRole('rowheader', { name: 'Front lever working sets left' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Keep Saturdays for lifting' }))
    const stored = () => JSON.parse(localStorage.getItem('planchelab.v1')!).gym.prefs
    expect(stored().gymWeekdays).toEqual([6])
    expect(stored().extraGymDate).toBeUndefined()
    view.unmount()
    render(<StoreProvider><PlanSettings onDone={() => {}} /></StoreProvider>)
    fireEvent.click(screen.getByRole('button', { name: /^Saturday: 75 minutes/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep Saturdays for lifting' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(stored().gymWeekdays).toBeUndefined()
  } finally {
    if (process.env.FAKE_NOW) vi.setSystemTime(new Date(process.env.FAKE_NOW))
    else vi.useRealTimers()
  }
})

it('opens a priority muscle’s breakdown and identifies which logged sets came from assisting on a lift', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const now = Date.now()
  const gym = defaultGym(['floor'], 'kg')
  gym.prefs = { ...defaultPrefs(now), musclesPriority: ['triceps'], minutesByDay: [0, 0, 0, 0, 0, 0, 0] }
  gym.sessions = [{ id: 'presses', startedAt: now, endedAt: now, locationId: gym.locations[0].id, name: 'Upper',
    exercises: [{ exerciseId: 'incline-db-press', sets: [{ kg: 12.5, reps: 9, at: now }] }] }]
  localStorage.setItem('planchelab.v1', JSON.stringify({ ...initialState(), onboarded: true, gym }))
  render(<StoreProvider><WeekVolume /></StoreProvider>)
  fireEvent.click(within(screen.getByRole('table', { name: 'Priority muscles' })).getByRole('button', { name: 'See triceps set breakdown' }))
  const dialog = within(screen.getByRole('dialog', { name: 'Triceps set breakdown' }))
  for (const [label, value] of [['Direct gym work', '0'], ['Assisting gym work', '0.5'], ['Estimated skill work', '0'], ['Total', '0.5']]) {
    const row = dialog.getByRole('rowheader', { name: label }).closest('tr')!
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([value, value])
  }
  fireEvent.click(dialog.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('stops a live gym session, restores the joint report, and saves only the completed dumbbell press', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const gym = defaultGym(['floor'], 'kg')
  const place = gym.locations[0]
  place.equipment.push('dumbbells', 'bench', 'incline-bench')
  localStorage.setItem('planchelab.v1', JSON.stringify({ ...initialState(), onboarded: true, gym }))
  const item: DraftItem = { exerciseId: 'incline-db-press', restSec: 90, unit: 'kg', plan: { range: [8, 12], targetRpe: 7 },
    sets: [0, 1].map(() => ({ load: 12.5, reps: 9, done: false })) }
  const draft = { id: 'new-pain', name: 'Upper', startedAt: Date.now() - 60_000, locationId: place.id, items: [item] }
  const player = (d: typeof draft | NonNullable<ReturnType<typeof loadDraft>>) =>
    render(<StoreProvider><GymPlayer draft={d} location={place} onClose={() => {}} /></StoreProvider>)
  const click = (label: string) => fireEvent.click(screen.getByRole('button', { name: label }))
  const first = player(draft)
  click('Complete set 1 of Incline dumbbell press')
  click('Something hurts')
  click('Pain')
  click('Shoulder')
  click('Record it')
  expect(screen.getByRole('dialog', { name: 'Training stopped' })).toBeTruthy()
  expect(loadDraft()?.stopReport?.regions).toEqual(['shoulder'])
  first.unmount()
  const second = player(loadDraft()!)
  expect(screen.queryByRole('button', { name: 'Keep training' })).toBeNull()
  click('Save session')
  const stored = JSON.parse(localStorage.getItem('planchelab.v1')!)
  expect(stored.symptoms).toContainEqual(expect.objectContaining({ source: 'attempt', joints: 'pain', regions: ['shoulder'] }))
  expect(stored.gym.sessions[0]).toMatchObject({ id: draft.id, completion: 'partial', exercises: [{ exerciseId: item.exerciseId, sets: [{ kg: 12.5, reps: 9 }] }] })
  expect(stored.gym.sessions[0].remaining).toBeUndefined()
  expect(loadDraft()).toBeNull()
  second.unmount()
  const oldPartial = sessionFromDraft({ ...draft, items: [{ ...item, sets: [{ ...item.sets[0], done: true }, item.sets[1]] }] }, Date.now())
  render(<StoreProvider><PartialWorkout session={oldPartial} onContinue={() => {}} /></StoreProvider>)
  expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull()
  expect(screen.getByText(/1 set is held/)).toBeTruthy()
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

it('shows both kinds of workout on their actual days in the consistency chart', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const athlete = makeAthlete({ skills: ['flag'], steps: { flag: 'flag-tuck' } })
  const now = Date.now() - 60_000
  const earlier = addDays(now, -4)
  athlete.sessions = [{ id: 'skill', startedAt: earlier, endedAt: earlier, stepId: 'flag-tuck', workoutKind: 'auto', workoutName: 'Flag', sets: [
    { exerciseId: 'tuck-flag', section: 'main', kind: 'hold', side: 'left', at: earlier, target: 5, value: 6 },
  ] }]
  athlete.gym!.sessions = [earlier, now].map((at, i) => ({ id: `gym-${i}`, startedAt: at, endedAt: at, name: 'Push day', locationId: 'home',
    exercises: [{ exerciseId: 'push-up', sets: [{ reps: 8, at, warmup: true }, { reps: 10, at }] }] }))
  localStorage.setItem('planchelab.v1', JSON.stringify(athlete))
  render(<StoreProvider><Stats /></StoreProvider>)
  expect(screen.getByRole('img', { name: /Consistency: 2 training days/ })).toBeTruthy()
  const date = screen.getByLabelText('Inspect a date')
  fireEvent.change(date, { target: { value: dayKey(earlier) } })
  expect(screen.getByText(/1 skill session and 1 gym session · 2 working sets/)).toBeTruthy()
  fireEvent.change(date, { target: { value: dayKey(now) } })
  expect(screen.getByText(/1 gym session · 1 working set/)).toBeTruthy()
})

it('calls the full flag practiced after placement and verified only after both sides meet its hold standard', () => {
  const athlete = makeAthlete({ skills: ['flag'], steps: { flag: 'flag-full' } })
  const now = Date.now()
  const goal = { id: 'full', skill: 'flag' as const, stepId: 'flag-full' as const, by: dayKey(addDays(now, 7)) }
  expect(skillGoalPace(athlete, goal, now)).toMatchObject({ status: 'practicing', text: expect.stringMatching(/0s of 5s/) })
  const set: SetLog = { exerciseId: 'human-flag', section: 'main', kind: 'hold', side: 'left', value: 6, target: 5, at: now - 200,
    form: { rating: 'clean', confirmed: true, armsConfirmed: true, flightConfirmed: true, variantConfirmed: true,
      auto: { issues: [], confidence: 0.9, cleanSeconds: 6, coarse: ['elbows', 'leg position'] } } }
  const session: Session = { id: 'flag', startedAt: now - 300, endedAt: now - 10, stepId: 'flag-full', workoutKind: 'auto', workoutName: 'Flag', sets: [set] }
  expect(skillGoalPace({ ...athlete, sessions: [session] }, goal, now).status).toBe('practicing')
  const both = { ...session, sets: [set, { ...set, side: 'right' as const, at: now - 100 }] }
  expect(skillGoalPace({ ...athlete, sessions: [both] }, goal, now)).toMatchObject({ status: 'reached', text: expect.stringMatching(/^Verified Human Flag/) })
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

it('lets a gym-only athlete log a set, finish after midnight, reload Home and complete the original workout', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 24, 23, 55))
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
  const firstSet = screen.getAllByLabelText(/^Complete set 1 of /)[0]
  vi.setSystemTime(new Date(2026, 10, 24, 23, 58))
  fireEvent.click(firstSet)
  expect(screen.getByRole('group', { name: /^Effort for .+, set 1$/ })).toBeTruthy()
  click('8')
  vi.setSystemTime(new Date(2026, 10, 25, 0, 2))
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

it('keeps ankle-bearing lifts out of a lower-body session, its swaps and the add menu after an ankle pain report', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const gym = defaultGym(['floor', 'pullup-bar'])
  gym.locations[0].equipment.push('dumbbells', 'incline-bench')
  localStorage.setItem('planchelab.v1', JSON.stringify({ ...initialState(), onboarded: true, gym }))
  const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
  render(<StoreProvider><Train startWorkout={vi.fn()} entryPreset={{ focus: 'lower', minutes: 20, placeId: gym.locations[0].id, volumeFactor: 1, avoidJoints: [], musclesOff: [] }} /></StoreProvider>)
  click('Ankles')
  click(/it hurts.*keep off it/i)
  const player = within(screen.getByRole('dialog', { name: 'Gym session' }))
  const adjusted = loadDraft()!
  expect(adjusted.avoidJoints).toContain('ankles')
  expect(adjusted.items.length).toBeGreaterThan(0)
  expect(adjusted.items.every((item) => !jointsToRest(item.exerciseId).includes('ankles'))).toBe(true)
  for (const id of ['goblet-squat', 'db-rdl', 'db-lateral-raise', 'split-squat', 'walking-lunge', 'cable-row', 'push-up', 'farmer-carry']) expect(jointsToRest(id), id).toContain('ankles')
  fireEvent.click(player.getAllByRole('button', { name: /exercise options for /i })[0])
  click(/swap.*machine taken/i)
  let sheet = within(screen.getByRole('dialog', { name: 'Exercise options' }))
  expect(sheet.queryByRole('button', { name: /squat|lunge|deadlift|standing/i })).toBeNull()
  fireEvent.click(sheet.getByRole('button', { name: /close/i }))
  fireEvent.click(player.getByRole('button', { name: 'Add an exercise' }))
  sheet = within(screen.getByRole('dialog', { name: 'Exercise options' }))
  const search = sheet.getByLabelText('Search exercises')
  fireEvent.change(search, { target: { value: 'lunge' } })
  expect(sheet.queryByRole('button', { name: /lunge/i })).toBeNull()
  fireEvent.change(search, { target: { value: 'lateral raise' } })
  expect(sheet.getByRole('button', { name: /seated dumbbell lateral raise/i })).toBeTruthy()
  expect(sheet.queryByRole('button', { name: /^Dumbbell lateral raise/i })).toBeNull()
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
