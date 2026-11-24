import { afterEach, describe, expect, it } from 'vitest'
import type { AppState, StepId } from '../../types'
import { buildGymSession } from '../gym/builder'
import { activeLocation } from '../gym/draft'
import { atActivePlace, planWeekAhead, skillRequest, type SkillBlock } from './planner'
import { atPlanPlace, calisthenicsPlaceLine, calisthenicsRequest, calisthenicsTitle, gymPlaceLine, gymPreset, openerLine, resolveGymPlace, shortVersion, steerInput } from './screens'
import { choiceOptions, readTodayChoice, writeTodayChoice } from './todayChoice'
import { GYM_PLACE, makeAthlete, SPORT_WEEK } from './wholeAthleteLoop'

// The screens build where the plan says and pass every limit the planner returns (2026-11-22, sixth review).
const MON = new Date(2026, 9, 5, 17).getTime()
const GOALS = { strength: 3, power: 2, physique: 4, skills: 5, endurance: 1 }
const homeAthlete = (): AppState =>
  makeAthlete({
    skills: ['planche', 'frontlever', 'handstand'],
    birthYear: 2012,
    steps: { planche: 'tuck' as StepId, frontlever: 'fl-tuck' as StepId, handstand: 'hs-wall' as StepId },
    prefs: { goals: GOALS, sportSchedule: SPORT_WEEK },
    active: 'home',
  })
const homeOf = (s: AppState) => s.gym!.locations.find((l) => l.id !== GYM_PLACE.id)!

describe('a gym day is built where the plan has it', () => {
  const s = homeAthlete()
  const home = homeOf(s)

  it('is not built at home because home is the place set now', () => {
    expect(activeLocation(s.gym)!.id).toBe(home.id)
    const where = resolveGymPlace(s, MON)!
    expect(where.place.id).toBe(GYM_PLACE.id)
    expect(where.moved).toBe(false)
    expect(gymPlaceLine(where)).toBe(`At ${GYM_PLACE.name}`)
    // The plan itself says the same place (`TodayPlan.gym.placeId`).
    const gymDay = planWeekAhead(s, MON).days.find((d) => d.plan.gym)!.plan.gym!
    expect(resolveGymPlace(s, MON, { plannedId: gymDay.placeId })!.place.id).toBe(GYM_PLACE.id)
  })

  it('goes where the athlete says they are, and says where the plan had it', () => {
    const where = resolveGymPlace(s, MON, { pickedId: home.id })!
    expect(where.place.id).toBe(home.id)
    expect(where.moved).toBe(true)
    expect(gymPlaceLine(where)).toBe(`At ${home.name}. The plan had this at ${GYM_PLACE.name}.`)
    // A pick that names a place that is gone is no pick.
    expect(resolveGymPlace(s, MON, { pickedId: 'gone' })!.place.id).toBe(GYM_PLACE.id)
    // Picking the planned place is not a move.
    expect(resolveGymPlace(s, MON, { pickedId: GYM_PLACE.id })!.moved).toBe(false)
  })

  it('has nothing to say without places', () => {
    expect(resolveGymPlace({ ...s, gym: undefined }, MON)).toBeUndefined()
    expect(gymPlaceLine(undefined)).toBeNull()
  })
})

describe('a calisthenics day is built with the kit of the place the plan has it at', () => {
  const s = homeAthlete()
  const home = homeOf(s)
  const lever = (): SkillBlock => {
    const day = planWeekAhead(s, MON).days.find((d) => d.plan.skill?.skills.includes('frontlever') && d.plan.skill.placeId)
    return day!.plan.skill!
  }

  it('keeps the gym’s bar on a lever day with home set, and says where', () => {
    const block = lever()
    expect(block.placeId).toBe(GYM_PLACE.id)
    expect(calisthenicsRequest(s, block).kit).toContain('pullup-bar')
    expect(calisthenicsRequest(s, block)).toEqual({ source: 'auto', minutes: block.minutes, skills: block.skills, kit: block.kit, placeId: GYM_PLACE.id, ...(block.opener ? { deferPulling: true } : {}) })
    expect(atActivePlace(s, { source: 'auto' }).kit ?? []).not.toContain('pullup-bar')
    expect(calisthenicsPlaceLine(s, block)).toBe(`At ${GYM_PLACE.name}`)
  })

  it('builds where the athlete is when they said so, and says where the plan had it', () => {
    const block = lever()
    const here = calisthenicsRequest(s, block, home.id)
    expect(here.kit ?? []).not.toContain('pullup-bar')
    expect(calisthenicsPlaceLine(s, block, home.id)).toBe(`At ${home.name}. The plan had this at ${GYM_PLACE.name}.`)
    // The place the plan has it is no move.
    expect(calisthenicsRequest(s, block, GYM_PLACE.id).kit).toContain('pullup-bar')
    expect(calisthenicsPlaceLine(s, block, GYM_PLACE.id)).toBe(`At ${GYM_PLACE.name}`)
  })

  it('says nothing of a place when the plan names none', () => {
    expect(calisthenicsPlaceLine(s, {})).toBeNull()
  })

  it('keeps a request built for a place, and builds any other where the athlete is', () => {
    const placed = calisthenicsRequest(s, lever())
    expect(atPlanPlace(s, placed)).toBe(placed)
    expect(atPlanPlace(s, { source: 'auto' })).toEqual(atActivePlace(s, { source: 'auto' }))
  })

  it('builds a short version of a lever day at the place of the day', () => {
    const day = planWeekAhead(s, MON).days.find((d) => d.plan.skill?.skills.includes('frontlever') && d.plan.skill.placeId)!
    const short = shortVersion(s, 20, { now: day.at, kind: 'calisthenics' })
    if ('request' in short && short.request.skills?.includes('frontlever')) expect(short.request.kit).toContain('pullup-bar')
  })

  it('is the kit the block starts with', () => {
    const block = lever()
    expect(calisthenicsRequest(s, block)).toMatchObject({ kit: skillRequest(block).kit })
  })
})

describe('labels on the Today card', () => {
  it('names a pain-safe day for what it is, under its lead only', () => {
    const t = calisthenicsTitle({ skills: ['planche'], minutes: 30, painSafe: true })
    expect(t.title).toBe('Pain-safe recovery · 30 min')
    expect(t.line).toContain('planche')
    // A block that still lists two skills names one.
    const two = calisthenicsTitle({ skills: ['planche', 'frontlever'], minutes: 30, painSafe: true })
    expect(two.title).toMatch(/^Pain-safe recovery/)
    expect(two.line).not.toMatch(/front lever/)
    expect(calisthenicsTitle({ skills: ['planche', 'frontlever'], minutes: 30 })).toEqual({ title: 'Calisthenics · 30 min', line: 'Planche, front lever' })
  })

  it('says plainly when an opener is short', () => {
    expect(openerLine({ skills: ['planche'], minutes: 18, half: true })).toContain('short opener')
    expect(openerLine({ skills: ['planche'], minutes: 18 })).not.toContain('short opener')
  })
})

describe('the week’s steer reaches the lifts', () => {
  it('carries spare and placeId into the preset, leaving empty ones out', () => {
    const g = { focus: 'push' as const, minutes: 40, avoidJoints: [], volumeFactor: 1, musclesOff: [], priority: ['side-delts' as const], spare: ['chest' as const] }
    expect(gymPreset(g, { placeId: 'gym', warmUpMin: 2 })).toEqual({ ...g, placeId: 'gym', warmUpMin: 2 })
    const bare = gymPreset({ ...g, priority: [], spare: [] })
    expect(bare).not.toHaveProperty('spare')
    expect(bare).not.toHaveProperty('priority')
    expect(bare).not.toHaveProperty('placeId')
  })

  it('passes the week’s spare muscles and priorities to the builder, beside the athlete’s own', () => {
    expect(steerInput({ priority: ['side-delts'], spare: ['chest', 'chest'] }, ['biceps'])).toEqual({ priority: ['biceps', 'side-delts'], athletePriority: ['biceps'], spare: ['chest'] })
    expect(steerInput({})).toEqual({ priority: [], athletePriority: [] })
    // And it changes what is built: a push day leaning away from the chest builds other movements.
    const base = { location: GYM_PLACE, minutes: 45, focus: 'push' as const, sessions: [], now: MON }
    const plain = buildGymSession(base)
    const steered = buildGymSession({ ...base, ...steerInput({ spare: ['chest', 'triceps', 'front-delts'] }) })
    expect(steered.items.map((i) => i.exerciseId)).not.toEqual(plain.items.map((i) => i.exerciseId))
  })
})

describe('where the athlete said they are is kept for the day', () => {
  const real = globalThis.localStorage
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true })
  })
  const stub = () => {
    const m = new Map<string, string>()
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true })
  }
  it('is today’s choice, not a planning option', () => {
    stub()
    writeTodayChoice({ kind: 'gym', placeId: 'home-1' }, MON)
    expect(readTodayChoice(MON)).toEqual({ kind: 'gym', placeId: 'home-1' })
    expect(choiceOptions(readTodayChoice(MON))).toEqual({ kind: 'gym' })
    expect(readTodayChoice(MON + 2 * 86_400_000)).toEqual({})
    writeTodayChoice({ placeId: 'a' }, MON)
    expect(readTodayChoice(MON)).toEqual({ placeId: 'a' })
    writeTodayChoice({ placeId: undefined }, MON)
    expect(readTodayChoice(MON)).toEqual({})
  })
})
