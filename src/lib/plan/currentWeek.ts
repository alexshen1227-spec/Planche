import type { AppState } from '../../types'
import { dayKey } from '../time'
import { planWeekAhead, type WeekAhead } from './planner'
import type { TodayChoice } from './todayChoice'
import { planClockTick } from './usePlanClock'

// Home, Train, the gym and the week preview read the same immutable store
// snapshot. A change to the log, today's choice or the plan clock invalidates it.
const current = new WeakMap<AppState, { key: string; week: WeekAhead }>()

export function weekForChoice(state: AppState, choice: TodayChoice, now = Date.now()): WeekAhead {
  const key = JSON.stringify([dayKey(now), planClockTick(now), choice.minutes, choice.kind, choice.placeId, choice.gymFocus, choice.skipOpener])
  const cached = current.get(state)
  if (cached?.key === key) return cached.week
  const place = state.gym?.locations.find((location) => location.id === choice.placeId)
  const week = planWeekAhead(state, now, {
    todayMinutes: choice.minutes,
    todayKind: choice.kind,
    todayFocus: choice.gymFocus,
    todaySkipOpener: choice.skipOpener,
    todayPlace: place,
  })
  current.set(state, { key, week })
  return week
}
