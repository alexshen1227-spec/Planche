import type { AppState, EquipmentId, WorkoutRequest } from '../../types'
import type { GymLocation } from '../gym/types'

/** The place the app is set to: the active one, or the first set up. */
export function activePlace(state: AppState): GymLocation | undefined {
  const gym = state.gym
  return gym?.locations.find((l) => l.id === gym.activeLocationId) ?? gym?.locations[0]
}

/** Kit an athlete can bring: a doorway bar or a wall at home is not at the gym. */
const PORTABLE_KIT: EquipmentId[] = ['floor', 'parallettes', 'band', 'rings']

/**
 * What can be used at a place: its own list, plus the athlete's kit that
 * travels. A home pull-up bar once counted at a gym with none, so a lever
 * opener was offered where nothing could hold it.
 */
export function kitAt(state: AppState, location: GymLocation): EquipmentId[] {
  const carried = state.profile.equipment.filter((e) => PORTABLE_KIT.includes(e))
  return [...new Set([...carried, ...(location.equipment as EquipmentId[])])]
}

/**
 * The kit a skill session is built with where the athlete is: their own list
 * and the active place's (`kitAt`: its list and their portable kit) together;
 * none without a place. Nothing the athlete has at home is lost by setting a
 * gym up, and the gym's bar counts on a lever day.
 */
export function placeKit(state: AppState): EquipmentId[] | undefined {
  const place = activePlace(state)
  return place ? hereKit(state, place) : undefined
}
export function hereKit(state: AppState, place: GymLocation): EquipmentId[] {
  return place.id === 'home' ? [...new Set([...state.profile.equipment, ...kitAt(state, place)])] : kitAt(state, place)
}

/**
 * A skill request built where the athlete is: the active place's kit beside
 * their own (`placeKit`, `WorkoutRequest.kit`). A front lever with no bar at
 * home was "waiting for kit" on a lever day at a gym with one.
 */
export function atActivePlace(state: AppState, request: WorkoutRequest): WorkoutRequest {
  const place = activePlace(state)
  return place ? { ...request, placeId: place.id, kit: [...new Set([...(request.kit ?? []), ...hereKit(state, place)])] } : request
}

export function weekdayPlace(state: AppState, at: number): GymLocation | undefined {
  const id = state.gym?.prefs?.placeByDay?.[new Date(at).getDay()]
  return id ? state.gym?.locations.find((p) => p.id === id) : undefined
}

/** A request already built for a place keeps its kit; any other is built where the athlete is. */
export function atPlanPlace(state: AppState, request: WorkoutRequest, pickedId?: string, now = Date.now()): WorkoutRequest {
  if (request.kit?.length) return request
  const selected = state.gym?.locations.find((p) => p.id === (pickedId ?? request.placeId)) ?? weekdayPlace(state, now)
  return selected ? { ...request, placeId: selected.id, kit: [...new Set<EquipmentId>(['floor', ...hereKit(state, selected)])] } : atActivePlace(state, request)
}
