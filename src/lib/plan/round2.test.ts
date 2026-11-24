import { afterEach, describe, expect, it } from 'vitest'
import type { AppState, Session, SetLog, SkillId, Workout } from '../../types'
import { initialState } from '../store'
import { defaultGym, defaultPrefs } from '../gym/state'
import type { GymLocation, GymSession, TrainingPrefs } from '../gym/types'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { missingSkillKit } from '../skills'
import { finalizeWorkout } from '../../data/workouts'
import { gymDeloadDue, gymToday, planToday, planWeekAhead, skillRequest } from './planner'
import { choiceOptions, readTodayChoice, writeTodayChoice } from './todayChoice'
import { becamePainSafe, homeToday, maxTestOffered, trainingWeek } from './screens'

// Found by the second independent review of the planner (2026-11-22, round two). Each test pins the decision.
const HOUR = 3_600_000
const MON = new Date(2026, 10, 16, 9, 0).getTime()
const at = (dayOffset: number, hour: number, from = MON) => {
  const d = new Date(from)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, 0, 0, 0)
  return d.getTime()
}
const LEGS = ['quads', 'hamstrings', 'glutes', 'calves', 'adductors']
const gymA: GymLocation = {
  id: 'a',
  name: 'Gym A',
  unit: 'kg',
  equipment: ['barbell', 'squat-rack', 'bench', 'incline-bench', 'dumbbells', 'cable', 'lat-pulldown', 'leg-press', 'leg-curl', 'pullup-bar', 'dip-bars', 'box'] as GymLocation['equipment'],
  updatedAt: 1,
}
function athlete(skills: SkillId[], prefs: Partial<TrainingPrefs> = {}, extra: Partial<AppState> = {}, kit: string[] = ['floor', 'parallettes']): AppState {
  const s = initialState()
  return {
    ...s,
    onboarded: true,
    stepId: 'tuck',
    unlocked: ['foundations', 'lean', 'frog', 'tuck'],
    profile: { ...s.profile, skills, birthYear: 2010, equipment: kit as AppState['profile']['equipment'] },
    gym: { ...defaultGym(['floor']), locations: [gymA], activeLocationId: 'a', prefs: { ...defaultPrefs(1), ...prefs } },
    ...extra,
  } as AppState
}
const hold = (exerciseId: string, t: number): SetLog => ({ exerciseId, kind: 'hold', value: 8, target: 8, section: 'main', at: t }) as SetLog
const skillSession = (t: number, n = 5): Session =>
  ({ id: `s-${t}`, startedAt: t, endedAt: t + HOUR, workoutName: 'Skill', workoutKind: 'skill', stepId: 'tuck', sets: Array.from({ length: n }, () => hold('tuck-planche', t)) }) as unknown as Session
const lifts = ['bench-press', 'barbell-row', 'back-squat'].filter((id) => id in GYM_EXERCISE_BY_ID)
const gymSession = (t: number, sets: number, reps: number, rpe: number): GymSession => ({
  id: `g${t}`,
  locationId: 'a',
  startedAt: t,
  endedAt: t + HOUR,
  name: 'Full body',
  exercises: lifts.map((exerciseId) => ({ exerciseId, sets: Array.from({ length: sets }, () => ({ kg: 60, reps, rpe, at: t })) })),
})
const pattern = (w: ReturnType<typeof planWeekAhead>) => w.days.map((d) => (d.kind === 'calisthenics' ? 'P' : '-')).join('')

describe('the Gym tab asks the coach for today as a gym day', () => {
  it('keeps the season, sport, deload and knee rules on Auto and on any picked focus, on a day the plan gave to skills', () => {
    const base = athlete(['planche'], { season: 'in' })
    const s: AppState = {
      ...base,
      settings: { ...base.settings, weekPlan: { 1: ['planche'] } } as AppState['settings'],
      gym: { ...base.gym!, activities: [{ id: 'g1', at: at(-1, 15), kind: 'game', minutes: 90, rpe: 9, legs: true, updatedAt: 1 }] },
    }
    const now = at(0, 16)
    expect(planToday(s, { now }).kind).toBe('calisthenics')
    for (const focus of ['auto', 'upper', 'lower', 'full'] as const) {
      const g = gymToday(s, { now, minutes: 60, focus })
      expect(g.volumeFactor, focus).toBeLessThanOrEqual(0.7)
      for (const m of LEGS) expect(g.musclesOff, `${focus} ${m}`).toContain(m)
    }
    expect(gymToday(s, { now, minutes: 60, focus: 'auto' }).focus).not.toBe('lower')
    // A rest day before tomorrow's game: fresh legs, a lighter gym.
    const r = athlete(['planche'], { minutesByDay: [0, 0, 0, 0, 0, 0, 0], sportSchedule: [{ weekday: 2, kind: 'game', minutes: 90, rpe: 9, legs: true }] })
    const g2 = gymToday(r, { now: at(0, 10), minutes: 45, focus: 'push' })
    expect(g2.volumeFactor).toBeLessThanOrEqual(0.8)
    for (const m of LEGS) expect(g2.musclesOff).toContain(m)
    // A knee report: knees out of every focus, and no leg day on Auto.
    const k: AppState = { ...athlete(['planche']), symptoms: [{ id: 'k', at: at(0, 8), joints: 'niggle', regions: ['knee'], source: 'check-in' }] as AppState['symptoms'] }
    for (const focus of ['auto', 'lower'] as const) expect(gymToday(k, { now: at(0, 10), minutes: 60, focus }).avoidJoints, focus).toContain('knees')
    expect(gymToday(k, { now: at(0, 10), minutes: 60, focus: 'auto' }).focus).not.toBe('lower')
  })

  it('holds a deload called for the week through Wednesday, after two lighter sessions, on the Gym tab too', () => {
    expect(lifts.length).toBeGreaterThanOrEqual(2)
    const adult = { ...athlete(['planche']), profile: { ...athlete(['planche']).profile, birthYear: 1995 } }
    const hard = [-13, -10, -7, -4, -2].map((d) => gymSession(at(d, 17), 3, 6, 9.5))
    expect(gymDeloadDue({ ...adult, gym: { ...adult.gym!, sessions: hard } }, at(0, 9)).due).toBe(true)
    const s: AppState = { ...adult, gym: { ...adult.gym!, sessions: [...hard, gymSession(at(0, 17), 2, 5, 7), gymSession(at(1, 17), 2, 5, 7)] } }
    expect(gymDeloadDue(s, at(2, 9)).due).toBe(true)
    const g = gymToday(s, { now: at(2, 9), minutes: 60, focus: 'push' })
    expect(g.deload).toBe(true)
    expect(g.volumeFactor).toBeLessThanOrEqual(0.6)
    // The next week decides again.
    expect(gymDeloadDue(s, at(7, 9)).due).toBe(false)
  })
})

describe('openers', () => {
  it('never opens a second hard session of a family the same day, nor beside a skill day the week plan holds', () => {
    const s = athlete(['planche'], {}, { sessions: [skillSession(at(0, 8))] })
    const late = gymToday(s, { now: at(0, 18), minutes: 60, focus: 'push' })
    expect(late.opener).toBeUndefined()
    expect(late.noOpener).toBeTruthy()
    expect(gymToday({ ...s, sessions: [] }, { now: at(0, 18), minutes: 60, focus: 'push' }).opener?.skills).toEqual(['planche'])
    // Tuesday is planche in the athlete's own week: Monday's push session opens with nothing, and says why.
    const base = athlete(['planche'], { minutesByDay: [0, 60, 60, 0, 0, 0, 0] })
    const planned: AppState = { ...base, settings: { ...base.settings, weekPlan: { 2: ['planche'] } } as AppState['settings'] }
    const mon = gymToday(planned, { now: MON, minutes: 60, focus: 'push' })
    expect(mon.opener).toBeUndefined()
    expect(mon.noOpener).toMatch(/Tuesday/)
    expect(gymToday(base, { now: MON, minutes: 60, focus: 'push' }).opener?.skills).toEqual(['planche'])
  })

  it('checks kit at the place and in the athlete’s own list together, and starts the opener with the place’s kit', () => {
    const s = athlete(['frontlever', 'planche'], {}, {}, ['floor'])
    const op = gymToday(s, { now: at(0, 17), minutes: 60, focus: 'pull' }).opener
    expect(op?.skills).toEqual(['frontlever'])
    // The whole kit at the place (round three: `WorkoutRequest.kit` is the kit for that build): the gym's list and the athlete's portable kit.
    expect(new Set(op?.kit)).toEqual(new Set(['floor', ...gymA.equipment]))
    expect(skillRequest(op!)).toEqual({ source: 'auto', minutes: op!.minutes, skills: ['frontlever'], kit: op!.kit, deferPulling: true })
    const paired = finalizeWorkout(s, skillRequest(op!), undefined, at(0, 17))
    const solo = finalizeWorkout(s, { ...skillRequest(op!), deferPulling: undefined, minutes: 60 }, undefined, at(0, 17))
    const main = (w: typeof paired) => w.blocks.filter((b) => b.role === 'skill').reduce((n, b) => n + b.sets - (b.reach ?? 0), 0)
    expect(main(paired)).toBeGreaterThanOrEqual(main(solo))
    expect(paired.blocks.some((b) => b.role === 'press' || b.role === 'pressing')).toBe(false)
    expect(solo.blocks.some((b) => b.role === 'press' || b.role === 'pressing')).toBe(true)
    expect(op!.minutes).toBe(Math.max(15, paired.minutes))
    const noBar = { ...gymA, id: 'nb', name: 'No bar', equipment: gymA.equipment.filter((e) => e !== 'pullup-bar') }
    expect(gymToday(s, { now: at(0, 17), minutes: 60, focus: 'pull', location: noBar }).opener).toBeUndefined()
  })
})

describe('the week', () => {
  it('plans a calisthenics day only for a skill with its kit, so none builds a session waiting for kit', () => {
    const s = athlete(['frontlever', 'planche'], {}, {}, ['floor'])
    const w = planWeekAhead(s, at(0, 9))
    expect(w.days.some((d) => d.kind === 'calisthenics')).toBe(true)
    for (const d of w.days) {
      if (d.kind !== 'calisthenics') continue
      // The kit the session is built with: the athlete's and the active place's (round four: calisthenics happens where the athlete is).
      for (const k of d.plan.skill!.skills) expect(missingSkillKit(s, k, ['floor', ...(d.plan.skill!.kit ?? s.profile.equipment)]), d.day).toEqual([])
      expect(finalizeWorkout(s, skillRequest(d.plan.skill!), undefined, d.at).name, d.day).not.toMatch(/waiting for kit/)
    }
    // A lever alone with no bar at home nor at the place: no calisthenics day at all.
    const bare = athlete(['frontlever'], {}, {}, ['floor'])
    const noBar = { ...bare, gym: { ...bare.gym!, locations: bare.gym!.locations.map((l) => ({ ...l, equipment: l.equipment.filter((e) => e !== 'pullup-bar' && e !== 'rings') })) } }
    expect(planWeekAhead(noBar, at(0, 9)).days.filter((d) => d.kind === 'calisthenics')).toEqual([])
  })

  it('trains the weekly goal’s days without a gym schedule, today first, spread over what is left', () => {
    const s0 = initialState()
    const s: AppState = {
      ...s0,
      onboarded: true,
      profile: { ...s0.profile, skills: ['planche', 'handstand'], birthYear: 2010, equipment: ['floor', 'wall'] as AppState['profile']['equipment'] },
      settings: { ...s0.settings, weeklyGoal: 3 },
    }
    const mon = planWeekAhead(s, at(0, 9))
    expect(mon.days.filter((d) => !d.plan.rest).length).toBe(3)
    expect(mon.days[0].plan.rest).toBe(false)
    // Thursday, one day trained: two more this week, Thursday the first.
    const thu = planWeekAhead({ ...s, sessions: [skillSession(at(0, 10))] }, at(3, 9))
    const thisWeek = thu.days.filter((d) => d.at < at(7, 0))
    expect(thisWeek.filter((d) => !d.plan.rest).length).toBe(2)
    expect(thu.days[0].plan.rest).toBe(false)
  })

  it('treats sport on its own day as one rule — legs out and lighter, before or after the game — and names the day after', () => {
    const s = athlete(['planche'], { sportSchedule: [{ weekday: 6, kind: 'game', minutes: 90, rpe: 9, legs: true, hour: 17 }] })
    for (const now of [at(4, 9), at(5, 9), at(5, 18)]) {
      const g = gymToday(s, { now, minutes: 60, focus: 'upper' })
      expect(g.volumeFactor, new Date(now).toString()).toBeLessThanOrEqual(0.8)
      for (const m of LEGS) expect(g.musclesOff, new Date(now).toString()).toContain(m)
    }
    // Monday after a Saturday morning game: still inside the 48 h, and the day is named.
    const sat = athlete(['planche'], { sportSchedule: [{ weekday: 6, kind: 'game', minutes: 90, rpe: 9, legs: true, hour: 10 }] })
    const monday = at(7, 9)
    expect(gymToday(sat, { now: monday, minutes: 60, focus: 'upper' }).musclesOff).toContain('quads')
    const why = planWeekAhead(sat, monday).days[0].why.join(' ')
    expect(why).toMatch(/on Saturday/)
    expect(why).not.toMatch(/the day before/)
  })

  it('measures rest between planned days in calendar days, so a daylight-saving week plans like any other', () => {
    const s0 = initialState()
    const s: AppState = { ...s0, onboarded: true, profile: { ...s0.profile, skills: ['planche'], birthYear: 2010, equipment: ['floor'] as AppState['profile']['equipment'] }, settings: { ...s0.settings, weeklyGoal: 0 } }
    // Thursday 4 March 2027, and Thursday 11 March: the US clocks go forward on Sunday 14 March, Europe's on the 28th.
    for (const [a, b] of [[new Date(2027, 2, 4, 9).getTime(), new Date(2027, 2, 11, 9).getTime()], [new Date(2027, 2, 18, 9).getTime(), new Date(2027, 2, 25, 9).getTime()]]) {
      expect(pattern(planWeekAhead(s, b))).toBe(pattern(planWeekAhead(s, a)))
    }
  })

  it('gives every day a pain report reshapes a line that says so, and only those days', () => {
    const s: AppState = { ...athlete(['planche']), symptoms: [{ id: 'p', at: at(0, 8), joints: 'pain', regions: ['elbow'], source: 'check-in' }] as AppState['symptoms'] }
    const w = planWeekAhead(s, at(0, 9))
    for (const [i, d] of w.days.entries()) {
      if (d.plan.rest) continue
      const said = d.why.some((x) => /reported/.test(x))
      expect(said, `${d.day}: ${d.why.join(' / ')}`).toBe(d.at - at(0, 8) < 72 * HOUR)
      if (i <= 1 && d.plan.gym) expect(d.plan.gym.avoidJoints, d.day).toContain('elbows')
    }
  })
})

describe('one today for every screen', () => {
  const real = globalThis.localStorage
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true })
  })
  const stub = () => {
    const m = new Map<string, string>()
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
    Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true })
  }
  it('keeps today’s kind and minutes for the calendar day only, and survives storage that throws', () => {
    stub()
    writeTodayChoice({ kind: 'gym', minutes: 30 }, MON)
    expect(readTodayChoice(MON + 3 * HOUR)).toEqual({ kind: 'gym', minutes: 30 })
    expect(choiceOptions(readTodayChoice(MON))).toEqual({ minutes: 30, kind: 'gym' })
    expect(readTodayChoice(at(1, 9))).toEqual({})
    writeTodayChoice({ kind: 'lifting' as never, minutes: Number.NaN }, MON)
    expect(readTodayChoice(MON)).toEqual({})
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } },
      configurable: true,
      writable: true,
    })
    expect(() => writeTodayChoice({ kind: 'gym' }, MON)).not.toThrow()
    expect(readTodayChoice(MON)).toEqual({})
  })

  it('counts gym days on Home as the plan does, says rest on a rest day, and offers the max test only when it can run', () => {
    const s = athlete(['planche'], {}, { sessions: [skillSession(at(0, 8)), skillSession(at(2, 8))] })
    const withGym: AppState = { ...s, gym: { ...s.gym!, sessions: [gymSession(at(2, 10), 3, 8, 7), gymSession(at(3, 17), 3, 8, 7)] } }
    const tw = trainingWeek(withGym, at(4, 9))
    expect([tw.days, tw.cal, tw.gym, tw.gymSessions]).toEqual([3, 1, 2, 2])
    expect(tw.gymSets).toBe(2 * 3 * lifts.length)
    expect(trainingWeek(withGym, at(7, 9)).days).toBe(0)
    const rest = planToday({ ...s, gym: { ...s.gym!, prefs: { ...s.gym!.prefs!, minutesByDay: [0, 0, 0, 0, 0, 0, 0] } } }, { now: at(0, 9) })
    expect(homeToday(rest)).toBe('rest')
    expect(homeToday(planToday({ ...s, gym: { ...s.gym!, prefs: { ...s.gym!.prefs!, minutesByDay: [0, 0, 0, 0, 0, 0, 0] } } }, { now: at(0, 9), minutes: 45 }))).not.toBe('rest')
    // Read on a day with nothing logged: since round four a day already trained offers no max test.
    expect(maxTestOffered({ ...s, sessions: [] }, null, at(4, 9))).toBe(false)
    expect(maxTestOffered(s, 'joint pain reported', at(4, 9))).toBe(false)
    expect(maxTestOffered(s, null, at(4, 9))).toBe(true)
    expect(maxTestOffered(s, null, at(0, 12))).toBe(false)
    const painSafe = { name: 'Pain-safe' } as Workout
    expect(becamePainSafe({ source: 'auto', skills: ['planche'] }, painSafe, () => true)).toBe(true)
    expect(becamePainSafe({ source: 'auto' }, painSafe, () => true)).toBe(false)
    expect(becamePainSafe({ source: 'auto', skills: ['planche'] }, painSafe, () => false)).toBe(false)
  })
})
