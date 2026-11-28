// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialState, StoreProvider } from '../store'
import { GymPlayer } from '../../components/gym/GymPlayer'
import { ExerciseRatings } from '../../components/gym/ExerciseRatings'
import { GYM_EXERCISES, GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { defaultGym } from './state'
import { loadDraft, type DraftItem, type GymDraft } from './draft'
import { pickerRows } from './picker'
import { canDoHere } from './availability'
import { fitsGymFocus } from './focus'
import type { GymLocation } from './types'

// The athlete's asks: swap or add any exercise in the bank from inside a workout, with search and the app's
// recommendations on top; a how-to guide and video for every exercise in the workout that never changes the
// workout; and a place to rate every exercise.

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
})

const item = (exerciseId: string, sets = 3, done = 0): DraftItem => ({
  exerciseId, unit: 'kg', restSec: 90, plan: { range: [8, 12], targetRpe: 8 },
  sets: Array.from({ length: sets }, (_, i) => (i < done ? { reps: 10, load: 12, done: true, at: Date.now() - 600_000 + i * 60_000 } : { reps: 10, load: 12, done: false })),
})

function setUp(items: DraftItem[], extra: { name?: string; avoidJoints?: GymDraft['avoidJoints'] } = {}) {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const gym = defaultGym(['floor', 'pullup-bar'])
  gym.locations[0].equipment.push('dumbbells', 'bench', 'incline-bench')
  localStorage.setItem('planchelab.v1', JSON.stringify({ ...initialState(), onboarded: true, gym }))
  const draft: GymDraft = { id: 'open-pull', name: extra.name ?? 'Pull', startedAt: Date.now() - 900_000, locationId: gym.locations[0].id, items,
    ...(extra.avoidJoints ? { avoidJoints: extra.avoidJoints } : {}) }
  render(<StoreProvider><GymPlayer draft={draft} location={gym.locations[0]} onClose={() => undefined} /></StoreProvider>)
  return { location: gym.locations[0] as GymLocation, player: within(screen.getByRole('dialog', { name: 'Gym session' })) }
}
const stored = () => JSON.parse(localStorage.getItem('planchelab.v1')!)

describe('swapping inside a workout', () => {
  it('lists the whole bank under the recommendations, searchable, and swaps to anything picked', () => {
    const { player, location } = setUp([item('pull-up'), item('db-row'), item('db-curl')])
    fireEvent.click(player.getByRole('button', { name: 'Swap Dumbbell curl' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Swap Dumbbell curl' }))
    expect(sheet.getByRole('heading', { name: 'Recommended' })).toBeTruthy()
    // Recommendations are curls first; below them is every Pull-day exercise this place can do, not ten.
    const recommended = within(sheet.getByRole('heading', { name: 'Recommended' }).nextElementSibling as HTMLElement)
      .getAllByRole('button', { name: /^How to do / })
    expect(recommended.length).toBeGreaterThan(1)
    expect(recommended.every((b) => GYM_EXERCISES.find((e) => `How to do ${e.name}` === b.getAttribute('aria-label'))?.pattern === 'biceps')).toBe(true)
    const all = sheet.getByRole('heading', { name: /^All exercises · \d+$/ })
    const listed = Number(all.textContent!.split('· ')[1])
    const pullDayHere = GYM_EXERCISES.filter((e) => e.id !== 'db-curl' && fitsGymFocus('pull', e) && canDoHere(e.id, location))
    expect(recommended.length + listed).toBe(pullDayHere.length)
    while (sheet.queryByRole('button', { name: 'Show more exercises' })) fireEvent.click(sheet.getByRole('button', { name: 'Show more exercises' }))
    expect(within(all.nextElementSibling as HTMLElement).getAllByRole('button', { name: /^How to do / })).toHaveLength(listed)
    expect(listed).toBeGreaterThan(10)
    fireEvent.change(sheet.getByRole('searchbox', { name: 'Search exercises' }), { target: { value: 'chest supported' } })
    fireEvent.click(sheet.getByRole('button', { name: /^Chest-supported dumbbell row/ }))
    expect(loadDraft()!.items.map((it) => it.exerciseId)).toEqual(['pull-up', 'db-row', 'chest-supported-db-row'])
    expect(loadDraft()!.items[2].swappedFrom).toBe('db-curl')
  })

  it('can swap to a movement that needs equipment the place does not list, once asked to show them', () => {
    const { player } = setUp([item('pull-up'), item('db-row', 3, 1)])
    fireEvent.click(player.getByRole('button', { name: 'Swap One-arm dumbbell row' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Swap One-arm dumbbell row' }))
    const search = sheet.getByRole('searchbox', { name: 'Search exercises' })
    fireEvent.change(search, { target: { value: 'seated cable row' } })
    expect(sheet.queryByRole('button', { name: /^Seated cable row/ })).toBeNull()
    fireEvent.click(sheet.getByRole('button', { name: /^Include equipment Home does not list/ }))
    const row = sheet.getByRole('button', { name: /^Seated cable row/ })
    expect(row.textContent).toMatch(/not listed at Home/)
    fireEvent.click(row)
    // The logged set stays on the row it was done on; the rest move to the new movement.
    const items = loadDraft()!.items
    expect(items.map((it) => [it.exerciseId, it.sets.length])).toEqual([['pull-up', 3], ['db-row', 1], ['cable-row', 2]])
    expect(items[1].sets[0].done).toBe(true)
  })

  it('still keeps out what today’s joint check rested, and says how many and why', () => {
    const { player } = setUp([item('pull-up'), item('db-curl')], { avoidJoints: ['elbows'] })
    fireEvent.click(player.getByRole('button', { name: 'Swap Dumbbell curl' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Swap Dumbbell curl' }))
    fireEvent.change(sheet.getByRole('searchbox', { name: 'Search exercises' }), { target: { value: 'curl' } })
    expect(sheet.queryByRole('button', { name: /^Hammer curl/ })).toBeNull()
    expect(sheet.getByText(/^Kept out today: \d+ that load your elbows/)).toBeTruthy()
    expect(sheet.getByRole('button', { name: 'Leave it out today' })).toBeTruthy()
  })
})

describe('adding inside a workout', () => {
  it('recommends first, searches the whole bank and adds the pick', () => {
    const { player } = setUp([item('pull-up'), item('db-row')])
    fireEvent.click(player.getByRole('button', { name: 'Add an exercise' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Add an exercise' }))
    expect(sheet.getByRole('heading', { name: 'Recommended' })).toBeTruthy()
    // What the workout already has is not offered again.
    expect(sheet.queryByRole('button', { name: /^Pull-up/ })).toBeNull()
    fireEvent.change(sheet.getByRole('searchbox', { name: 'Search exercises' }), { target: { value: 'hammer' } })
    fireEvent.click(sheet.getByRole('button', { name: /^Hammer curl/ }))
    expect(loadDraft()!.items.map((it) => it.exerciseId)).toEqual(['pull-up', 'db-row', 'hammer-curl'])
  })
})

describe('the guide for an exercise in the workout', () => {
  it('shows how to do it, other versions, a video and a rating, and leaves the workout exactly as it was', () => {
    const { player } = setUp([item('pull-up', 4, 2), item('db-row'), item('db-curl')])
    const before = localStorage.getItem('planchelab.gymDraft')
    fireEvent.click(player.getByRole('button', { name: 'How to do Pull-up' }))
    let guide = within(screen.getByRole('dialog', { name: 'How to do Pull-up' }))
    expect(guide.getByRole('heading', { name: 'How to do it' })).toBeTruthy()
    expect(guide.getByText('Main muscles')).toBeTruthy()
    const find = guide.getByRole('link', { name: /^Find Pull-up demos on YouTube/ })
    expect(find.getAttribute('href')).toContain('youtube.com/results')
    expect(find.getAttribute('target')).toBe('_blank')
    // An easier version can be read without changing what the workout has.
    fireEvent.click(guide.getByRole('button', { name: 'Band-assisted pull-up' }))
    expect(guide.getByRole('heading', { name: 'Band-assisted pull-up' })).toBeTruthy()
    expect(guide.getByText(/^Reading only: today’s workout still has pull-up/)).toBeTruthy()
    fireEvent.click(guide.getByRole('button', { name: /^Back to Pull-up/ }))
    // Rate it and pin a video from here.
    fireEvent.click(guide.getByRole('button', { name: 'Love Pull-up: picked most often' }))
    expect(stored().gym.ratings['pull-up']).toBe('love')
    fireEvent.click(guide.getByRole('button', { name: 'Pin one' }))
    fireEvent.change(guide.getByRole('textbox', { name: 'YouTube demonstration link' }), { target: { value: 'https://www.youtube.com/watch?v=eGo4IYlbE5g' } })
    fireEvent.click(guide.getByRole('button', { name: 'Pin' }))
    expect(stored().videoLinks['pull-up']).toBe('https://www.youtube.com/watch?v=eGo4IYlbE5g')
    fireEvent.click(guide.getByRole('button', { name: 'Back to the workout' }))
    expect(localStorage.getItem('planchelab.gymDraft')).toBe(before)
    // The same from the options menu.
    fireEvent.click(player.getByRole('button', { name: 'Exercise options for Dumbbell curl' }))
    const menu = within(screen.getByRole('dialog', { name: 'Options for Dumbbell curl' }))
    fireEvent.click(menu.getByRole('button', { name: 'Dislike Dumbbell curl: picked rarely' }))
    fireEvent.click(menu.getByRole('button', { name: 'How to do it and a video' }))
    guide = within(screen.getByRole('dialog', { name: 'How to do Dumbbell curl' }))
    expect(guide.getByRole('button', { name: 'Dislike Dumbbell curl: picked rarely' }).getAttribute('aria-pressed')).toBe('true')
    expect(stored().gym.ratings['db-curl']).toBe('dislike')
    expect(localStorage.getItem('planchelab.gymDraft')).toBe(before)
  })

  it('keeps a pinned gym video through a reload', () => {
    setUp([item('db-curl')])
    const state = stored()
    localStorage.setItem('planchelab.v1', JSON.stringify({ ...state, videoLinks: { 'db-curl': 'https://youtu.be/ykJmrZ5v0Oo', 'not-an-exercise': 'https://youtu.be/ykJmrZ5v0Oo' } }))
    cleanup()
    render(<StoreProvider><ExerciseRatings /></StoreProvider>)
    const links = stored().videoLinks
    expect(links['db-curl']).toBe('https://youtu.be/ykJmrZ5v0Oo')
    expect(links['not-an-exercise']).toBeUndefined()
  })
})

describe('rating every exercise', () => {
  it('searches the bank, rates, filters by rating and clears a rating with a second tap', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const gym = defaultGym(['floor', 'pullup-bar'])
    localStorage.setItem('planchelab.v1', JSON.stringify({ ...initialState(), onboarded: true, gym }))
    render(<StoreProvider><ExerciseRatings location={gym.locations[0]} /></StoreProvider>)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search exercises to rate' }), { target: { value: 'wrist curl' } })
    fireEvent.click(screen.getByRole('button', { name: 'Dislike Wrist curl: picked rarely' }))
    fireEvent.click(screen.getByRole('button', { name: 'Like Barbell wrist curl: picked often' }))
    expect(stored().gym.ratings).toEqual({ 'wrist-curl': 'dislike', 'barbell-wrist-curl': 'like' })
    fireEvent.click(screen.getByRole('button', { name: 'Like Barbell wrist curl: picked often' }))
    expect(stored().gym.ratings).toEqual({ 'wrist-curl': 'dislike' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search exercises to rate' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rated · 1' }))
    expect(screen.getAllByRole('group', { name: /^How much you like / }).map((g) => g.getAttribute('aria-label'))).toEqual(['How much you like Wrist curl'])
    fireEvent.click(screen.getByRole('button', { name: 'Not rated' }))
    expect(screen.queryByRole('group', { name: 'How much you like Wrist curl' })).toBeNull()
    // Every exercise is reachable: the list grows to the whole bank.
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    while (screen.queryByRole('button', { name: 'Show more exercises' })) fireEvent.click(screen.getByRole('button', { name: 'Show more exercises' }))
    expect(screen.getAllByRole('group', { name: /^How much you like / })).toHaveLength(GYM_EXERCISES.length)
  // Role queries over the whole bank are slow in jsdom: about 20s alone, right at the default limit, before any change.
  }, 120_000)
})

describe('the ratings list order', () => {
  it('starts with the exercises already done, most recent first', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const gym = defaultGym(['floor', 'pullup-bar'])
    const at = Date.now() - 86_400_000
    gym.sessions = [
      { id: 'a', name: 'Pull', locationId: 'home', startedAt: at - 86_400_000, endedAt: at - 86_000_000, exercises: [{ exerciseId: 'pull-up', sets: [{ at: at - 86_400_000, reps: 5 }] }] },
      { id: 'b', name: 'Pull', locationId: 'home', startedAt: at, endedAt: at + 3_600_000, exercises: [{ exerciseId: 'zottman-curl', sets: [{ at, reps: 10, kg: 8, unit: 'kg' }] }] },
    ]
    localStorage.setItem('planchelab.v1', JSON.stringify({ ...initialState(), onboarded: true, gym }))
    render(<StoreProvider><ExerciseRatings location={gym.locations[0]} /></StoreProvider>)
    const groups = screen.getAllByRole('group', { name: /^How much you like / }).slice(0, 3).map((g) => g.getAttribute('aria-label'))
    expect(groups).toEqual(['How much you like Zottman curl', 'How much you like Pull-up', 'How much you like A-march'])
  })
})

describe('the picker’s rows', () => {
  it('puts the recommendations first, never twice, and counts what the rails keep out', () => {
    const location = { ...defaultGym(['floor', 'pullup-bar']).locations[0], equipment: ['floor', 'pullup-bar', 'dumbbells'] } as GymLocation
    const recommended = [GYM_EXERCISE_BY_ID['hammer-curl'], GYM_EXERCISE_BY_ID['cable-curl']]
    const rows = pickerRows({ location, ratings: { 'db-curl': 'love' }, query: 'curl', day: 'pull', anyEquipment: false, exclude: ['db-curl'],
      allowed: (e) => e.id !== 'zottman-curl', recommended })
    // A recommendation that needs missing kit (the cable) is not shown unless equipment is widened.
    expect(rows.recommended.map((r) => r.exercise.id)).toEqual(['hammer-curl'])
    expect(rows.rest.some((r) => r.exercise.id === 'hammer-curl' || r.exercise.id === 'db-curl')).toBe(false)
    expect(rows.hidden.map((e) => e.id)).toEqual(['zottman-curl'])
    expect(rows.rest.every((r) => r.here)).toBe(true)
    const wide = pickerRows({ location, ratings: {}, query: 'curl', day: 'pull', anyEquipment: true, exclude: [], allowed: () => true, recommended })
    expect(wide.recommended.map((r) => r.exercise.id)).toEqual(['hammer-curl', 'cable-curl'])
    expect(wide.rest.find((r) => r.exercise.id === 'preacher-curl')?.here).toBe(false)
    // What can be done here comes before what cannot.
    const firstAway = wide.rest.findIndex((r) => !r.here)
    expect(wide.rest.slice(firstAway).every((r) => !r.here)).toBe(true)
  })
})
