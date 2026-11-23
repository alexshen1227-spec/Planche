import { describe, expect, it } from 'vitest'
import { defaultGym, mergeGym, reduceGym, sanitizeGym, sanitizeGymReport } from './state'
import type { GymSession, GymState } from './types'

const T = 1_800_000_000_000

function gymWith(sessions: unknown[]): unknown {
  return { ...defaultGym([], 'kg', T), sessions }
}

const session = (exercises: unknown[]): unknown => ({ id: 's1', locationId: 'home', startedAt: T, endedAt: T + 1000, name: 'Push', exercises })

describe('review 9: gym data the loader cannot read is reported, not dropped', () => {
  it('keeps a log whose exercise is no longer in the catalogue, and says so', () => {
    const raw = gymWith([session([{ exerciseId: 'renamed-press', sets: [{ reps: 8, kg: 40, at: T }] }])])
    const { gym, losses } = sanitizeGymReport(raw)
    const log = gym!.sessions[0].exercises[0]
    expect(log.exerciseId).toBe('renamed-press')
    expect(log.sets).toHaveLength(1)
    expect(log.sets[0].kg).toBe(40)
    expect(losses.some((l) => l.includes('renamed-press') && l.includes('no longer in the catalogue'))).toBe(true)
  })

  it('never turns a load it cannot believe into bodyweight', () => {
    const raw = gymWith([session([{ exerciseId: 'goblet-squat', sets: [{ reps: 8, kg: 1000, at: T }] }])])
    const { gym, losses } = sanitizeGymReport(raw)
    const set = gym!.sessions[0].exercises[0].sets[0]
    expect(set.kg).toBe(1000)
    expect(losses.some((l) => l.includes('1000'))).toBe(true)
  })

  it('a load with no meaning takes its set out loudly rather than reading as bodyweight', () => {
    const raw = gymWith([session([{ exerciseId: 'goblet-squat', sets: [{ reps: 8, kg: -5, at: T }, { reps: 8, kg: 20, at: T }] }])])
    const { gym, losses } = sanitizeGymReport(raw)
    expect(gym!.sessions[0].exercises[0].sets.map((s) => s.kg)).toEqual([20])
    expect(losses.some((l) => l.includes('-5'))).toBe(true)
  })

  it('a clean save has no losses, and sanitizeGym is the same read', () => {
    const raw = gymWith([session([{ exerciseId: 'goblet-squat', sets: [{ reps: 8, kg: 20, at: T }] }])])
    expect(sanitizeGymReport(raw).losses).toEqual([])
    expect(sanitizeGym(raw)).toEqual(sanitizeGymReport(raw).gym)
  })

  it('reports a session, a place and a rating it had to leave out', () => {
    const raw = { ...(gymWith([{ id: '', startedAt: T }, 5]) as object), ratings: { 'gone-lift': 'love' }, locations: [{ nope: 1 }, ...defaultGym([], 'kg', T).locations] }
    const { losses } = sanitizeGymReport(raw)
    expect(losses.filter((l) => l.includes('gym session')).length).toBe(2)
    expect(losses.some((l) => l.includes('gym place'))).toBe(true)
    expect(losses.some((l) => l.includes('gone-lift'))).toBe(true)
  })
})

const play = (id: string): GymSession => ({ id, locationId: 'home', startedAt: T, endedAt: T + 5, name: 'x', exercises: [{ exerciseId: 'goblet-squat', sets: [{ reps: 5, kg: 20, at: T }] }] })

describe('review 9: a save is never a silent no-op', () => {
  it('saving a session while the gym side is absent creates it and keeps the session', () => {
    const next = reduceGym(undefined, { op: 'saveSession', session: play('g') }, T)
    expect(next?.sessions.map((s) => s.id)).toEqual(['g'])
    expect(next?.locations.length).toBeGreaterThan(0)
  })

  it('a session saved at a place that is not "home" gets that place', () => {
    const next = reduceGym(undefined, { op: 'saveSession', session: { ...play('g'), locationId: 'loc-9' } }, T)
    expect(next?.locations.some((l) => l.id === 'loc-9')).toBe(true)
  })

  it('other ops with no gym stay no-ops', () => {
    expect(reduceGym(undefined, { op: 'deleteSession', id: 'g' }, T)).toBeUndefined()
  })
})

describe('review 9: the active place converges between tabs', () => {
  const two = (): GymState => {
    const g = defaultGym([], 'kg', T)
    return { ...g, locations: [...g.locations, { id: 'gym', name: 'Gym', unit: 'kg', equipment: [], updatedAt: T }] }
  }

  it('the later choice wins whichever side is local', () => {
    const a = reduceGym(two(), { op: 'setActiveLocation', id: 'gym' }, T + 10)!
    const b = reduceGym(reduceGym(two(), { op: 'setActiveLocation', id: 'gym' }, T + 5)!, { op: 'setActiveLocation', id: 'home' }, T + 20)!
    const forward = mergeGym(a, b)!
    const backward = mergeGym(b, a)!
    expect(forward.activeLocationId).toBe('home')
    expect(backward.activeLocationId).toBe('home')
  })

  it('returns local itself when nothing changed', () => {
    const a = reduceGym(two(), { op: 'setActiveLocation', id: 'gym' }, T + 10)!
    expect(mergeGym(a, { ...a })).toBe(a)
  })

  it('a choice of a place that was deleted elsewhere does not win', () => {
    const a = reduceGym(two(), { op: 'setActiveLocation', id: 'gym' }, T + 30)!
    const b = reduceGym(two(), { op: 'deleteLocation', id: 'gym' }, T + 40)!
    expect(mergeGym(a, b)!.activeLocationId).toBe('home')
  })

  it('the time survives a read through the loader', () => {
    const a = reduceGym(two(), { op: 'setActiveLocation', id: 'gym' }, T + 10)!
    expect(sanitizeGym(JSON.parse(JSON.stringify(a)))).toEqual(a)
  })
})
