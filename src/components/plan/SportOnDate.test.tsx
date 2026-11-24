// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { defaultGym, defaultPrefs } from '../../lib/gym/state'
import { initialState, StoreProvider } from '../../lib/store'
import { SportOnDate } from './SportOnDate'
import { ActivitySheet } from './ActivitySheet'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

it('moves from the week, restores from the destination and can skip a past practice from the activity form', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  const gym = defaultGym(['floor'])
  gym.prefs = { ...defaultPrefs(1), sportSchedule: [{ weekday: 4, kind: 'practice', minutes: 90, rpe: 8, legs: true, hour: 17 }] }
  localStorage.setItem('planchelab.v1', JSON.stringify({ ...initialState(), gym }))
  const snapshot = () => JSON.parse(localStorage.getItem('planchelab.v1')!).gym
  const mount = (day: string) => render(<StoreProvider><SportOnDate at={new Date(day + 'T12:00').getTime()} /></StoreProvider>)
  const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))
  const source = mount('2026-10-08')
  click(/Change practice scheduled for/)
  fireEvent.change(screen.getByLabelText('New date and time'), { target: { value: '2026-10-09T19:30' } })
  click('Move this session')
  expect(snapshot().sportChanges[0]).toMatchObject({ day: '2026-10-08', status: 'moved', start: '2026-10-09T19:30' })
  source.unmount()
  const destination = mount('2026-10-09')
  expect(screen.getByText(/Moved from/)).toBeTruthy()
  click(/Change practice scheduled for/)
  click('Restore regular session')
  expect(snapshot().sportChanges[0].status).toBe('restored')
  destination.unmount()
  render(<StoreProvider><ActivitySheet onDone={() => {}} /></StoreProvider>)
  fireEvent.click(screen.getByText('Move or skip a scheduled session'))
  fireEvent.change(screen.getByLabelText('Scheduled date'), { target: { value: '2026-10-08' } })
  click(/Change practice scheduled for/)
  click('Skip this session')
  expect(snapshot().sportChanges[0].status).toBe('skipped')
  expect(snapshot().prefs.sportSchedule).toHaveLength(1)
  click('Choose a date and time')
  fireEvent.change(screen.getByLabelText('Activity date and time'), { target: { value: '2026-10-09T19:25' } })
  click('Log it')
  expect(snapshot().activities[0].at).toBe(new Date('2026-10-09T19:25').getTime())
})
