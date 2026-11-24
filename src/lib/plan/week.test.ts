import { describe, expect, it } from 'vitest'
import { bodyweightCapacity } from '../gym/bodyweight'
import type { AppState, EquipmentId, Session, SetLog, SkillId } from '../../types'
import { initialState, reducer } from '../store'
import { defaultGym, defaultPrefs, mergeGym, sanitizeGym } from '../gym/state'
import type { GymFocus } from '../gym/builder'
import type { GymLocation, GymSession, OutsideActivity, SportSlot, TrainingPrefs } from '../gym/types'
import { fatigueAt } from './load'
import { gymToday, planToday, planWeek, planWeekAhead, skillFamily, soreJoints } from './planner'
import { buildGymSession, nextFocus } from '../gym/builder'
import { liftTrend } from '../gym/progression'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { dayReadiness } from './readiness'
import { scheduledSport, sportBetween } from './sport'
import { finalizeWorkout } from '../../data/workouts'
import { startingState } from '../skillLoop'
import { readDay } from '../weekPlan'
import { conservative } from '../gym/draft'
import { weekStart } from '../time'
import { familyEvents, familyWorkingSets, HARD_GYM_FAMILY_SETS, LIGHT_PRESS_SPARE, skillSetLoading } from './load'
import { focusFamilies, gymOpener, MIN_GYM_MINUTES, MIN_SKILL_MINUTES, openerMinutes, openerMinutesFor, REST_SLACK_HOURS, skillRequest } from './planner'
import { missingKit } from '../../data/skills'
import type { StepId, Weekday, WeekPlan } from '../../types'

// Monday 16 November 2026, 9 am local: the start of a calendar week.
const MON = new Date(2026, 10, 16, 9, 0).getTime()
const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = (dayOffset: number, hour: number) => {
  const d = new Date(MON)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, 0, 0, 0)
  return d.getTime()
}

const gymA: GymLocation = {
  id: 'a',
  name: 'Gym A',
  unit: 'kg',
  equipment: ['barbell', 'squat-rack', 'bench', 'incline-bench', 'dumbbells', 'cable', 'lat-pulldown', 'leg-press', 'leg-curl', 'pullup-bar', 'dip-bars', 'box'],
  updatedAt: 1,
}

function athlete(skills: SkillId[], prefs: Partial<TrainingPrefs> = {}, extra: Partial<AppState> = {}): AppState {
  const s = initialState()
  return {
    ...s,
    onboarded: true,
    profile: { ...s.profile, skills, birthYear: 2010 },
    gym: { ...defaultGym(['floor']), locations: [gymA], activeLocationId: 'a', prefs: { ...defaultPrefs(1), ...prefs } },
    ...extra,
  }
}
const withGym = (s: AppState, gym: Partial<NonNullable<AppState['gym']>>): AppState => ({ ...s, gym: { ...s.gym!, ...gym } })

const hold = (exerciseId: string, t: number, rpe?: number): SetLog => ({ exerciseId, kind: 'hold', value: 8, target: 8, section: 'main', at: t, ...(rpe ? { rpe } : {}) })
const skillSession = (t: number, exerciseId = 'tuck-planche', n = 4): Session => ({
  id: `s-${t}`,
  startedAt: t,
  endedAt: t + HOUR,
  workoutName: 'Skill',
  workoutKind: 'skill' as Session['workoutKind'],
  stepId: 'tuck',
  sets: Array.from({ length: n }, () => hold(exerciseId, t)),
})
const gymSession = (t: number, exerciseId: string, sets = 4, rpe = 8, targetRpe?: number, name = 'Gym'): GymSession => ({
  id: `g-${t}-${exerciseId}`,
  locationId: 'a',
  startedAt: t,
  endedAt: t + HOUR,
  name,
  exercises: [{ exerciseId, ...(targetRpe ? { targetRpe } : {}), sets: Array.from({ length: sets }, () => ({ kg: 40, reps: 8, rpe, at: t })) }],
})
const activity = (t: number, kind: OutsideActivity['kind'], rpe: number, legs = true): OutsideActivity => ({ id: `a-${t}`, at: t, kind, minutes: 90, rpe, legs, updatedAt: 1 })
const practiceOn = (weekday: number, rpe = 8, kind: SportSlot['kind'] = 'practice'): SportSlot => ({ weekday, kind, minutes: 90, rpe, legs: true })

const LEGS: GymFocus[] = ['lower', 'full', 'athletic']
const PUSHES: GymFocus[] = ['push', 'upper', 'full']
const PULLS: GymFocus[] = ['pull', 'upper', 'full']
const GYM_ONLY = { goals: { strength: 3, power: 0, physique: 3, skills: 0, endurance: 1 } }

describe('the sport week', () => {
  it('loads unchanged without one, keeps a valid one through a reload, and drops what it cannot read', () => {
    const plain = athlete(['planche'])
    expect(sanitizeGym(JSON.parse(JSON.stringify(plain.gym)))!.prefs!.sportSchedule).toBeUndefined()
    const raw = {
      ...plain.gym,
      prefs: {
        ...plain.gym!.prefs,
        sportSchedule: [
          { weekday: 2, kind: 'practice', minutes: 90, rpe: 8, legs: true, hour: 16 },
          { weekday: 2, kind: 'game', minutes: 60, rpe: 9, legs: true }, // a second Tuesday: the first one wins
          { weekday: 9, kind: 'game', minutes: 60, rpe: 9, legs: true }, // no such day
          { weekday: 5, kind: 'chess', minutes: 5000, rpe: 42, legs: 'yes' }, // unknown kind → other, clamped
          'nonsense',
        ],
      },
    }
    const back = sanitizeGym(JSON.parse(JSON.stringify(raw)))!.prefs!.sportSchedule!
    expect(back).toEqual([
      { weekday: 2, kind: 'practice', minutes: 90, rpe: 8, legs: true, hour: 16 },
      { weekday: 5, kind: 'other', minutes: 300, rpe: 10, legs: false },
    ])
  })

  it('merges with the rest of the preferences: the side that changed them last wins', () => {
    const base = athlete(['planche']).gym!
    const older = { ...base, prefs: { ...base.prefs!, updatedAt: 10 } }
    const newer = { ...base, prefs: { ...base.prefs!, sportSchedule: [practiceOn(3)], updatedAt: 20 } }
    expect(mergeGym(older, newer)!.prefs!.sportSchedule).toEqual([practiceOn(3)])
    expect(mergeGym(newer, older)!.prefs!.sportSchedule).toEqual([practiceOn(3)])
  })

  it('counts a usual session toward fatigue like a logged one, and a log that day replaces it', () => {
    const wedPractice = at(2, 17)
    const scheduled = withGym(athlete(['planche']), { prefs: { ...defaultPrefs(1), sportSchedule: [practiceOn(3)] } })
    const logged = withGym(athlete(['planche']), { activities: [activity(wedPractice, 'practice', 8)] })
    const thu = at(3, 9)
    expect(scheduledSport([practiceOn(3)], MON, at(7, 0)).map((e) => e.at)).toEqual([wedPractice])
    expect(fatigueAt(scheduled, thu).muscles.quads).toBeCloseTo(fatigueAt(logged, thu).muscles.quads!, 6)
    // Logged differently that day (an easy hour): counted once, as logged.
    const both = withGym(scheduled, { activities: [{ ...activity(at(2, 12), 'practice', 4), minutes: 60 }] })
    expect(sportBetween(both.gym, MON, at(7, 0))).toHaveLength(1)
    expect(fatigueAt(both, thu).muscles.quads!).toBeLessThan(fatigueAt(scheduled, thu).muscles.quads!)
  })

  it('counts easy runs consistently and lets hard climbing recover across both skills and lifting', () => {
    const state = athlete(['frontlever', 'handstand'], { minutesByDay: [0, 60, 60, 0, 60, 0, 60] })
    const usual = { ...practiceOn(0, 2, 'run'), hour: 17, minutes: 20 }
    const logged = { ...activity(at(-1, 17), 'run', 2), minutes: 20 }
    for (const s of [
      withGym(state, { activities: [logged] }),
      withGym(state, { prefs: { ...state.gym!.prefs!, sportSchedule: [usual] } }),
    ]) expect(gymToday(s, { now: MON, minutes: 60, focus: 'lower' }).musclesOff).not.toContain('quads')

    for (const s of [
      withGym(state, { activities: [{ ...logged, kind: 'climb', rpe: 9, minutes: 120, legs: false, upperPull: true }] }),
      withGym(state, { prefs: { ...state.gym!.prefs!, sportSchedule: [{ ...usual, kind: 'climb', rpe: 9, minutes: 120, legs: false, upperPull: true }] } }),
    ]) {
      s.gym = sanitizeGym(JSON.parse(JSON.stringify(s.gym)))
      expect(fatigueAt(s, MON).muscles.forearms).toBeGreaterThan(0)
      const today = planWeekAhead(s, MON).days[0].plan
      expect(today.skill?.skills ?? []).not.toContain('frontlever')
      expect(today.reasons.join(' ')).toMatch(/climbing session/)
      const gym = gymToday(s, { now: MON, minutes: 60, focus: 'pull' })
      expect(gym.musclesOff).toContain('lats')
      expect(gym.opener?.skills ?? []).not.toContain('frontlever')
      expect(gym.musclesOff).not.toContain('quads')
      expect(gymToday(s, { now: at(2, 17), minutes: 60, focus: 'pull' }).musclesOff).not.toContain('lats')
    }
  })

  it('keeps legs out the day before, of and after a hard usual session — and not for an easy one', () => {
    const s = withGym(athlete(['planche'], { minutesByDay: [60, 60, 60, 60, 60, 60, 60], sportSchedule: [practiceOn(3)] }), {})
    for (const [day, why] of [[1, 'before'], [2, 'of'], [3, 'after']] as const) {
      const p = planToday(s, { now: at(day, 16), minutes: 60, kind: 'gym' })
      expect(['lower', 'athletic'], `${why}: ${p.gym!.focus}`).not.toContain(p.gym!.focus)
      expect(p.gym!.musclesOff, why).toContain('quads')
    }
    expect(planToday(s, { now: at(1, 16), minutes: 60, kind: 'gym' }).reasons.some((r) => r.startsWith('Your usual practice is'))).toBe(true)
    // Two days after, the legs are back.
    expect(planToday(s, { now: at(4, 17), minutes: 60, kind: 'gym' }).gym!.musclesOff).not.toContain('quads')
    // An easy usual session is fatigue, not a reason to keep legs out.
    const easy = withGym(athlete(['planche'], { minutesByDay: [60, 60, 60, 60, 60, 60, 60], sportSchedule: [practiceOn(3, 4)] }), {})
    expect(planToday(easy, { now: at(1, 16), minutes: 60, kind: 'gym' }).gym!.musclesOff).not.toContain('quads')
  })
})

describe('the week plan', () => {
  const fourDays = athlete(['planche'], { ...GYM_ONLY, minutesByDay: [0, 60, 60, 0, 60, 0, 60] })

  it('spreads the week so legs, pushing and pulling each get a day, and no focus runs two days in a row', () => {
    const week = planWeekAhead(fourDays, MON)
    const foci = week.days.map((d) => d.plan.gym?.focus ?? null)
    expect(foci.filter((f) => f && LEGS.includes(f)).length, foci.join()).toBeGreaterThan(0)
    expect(foci.filter((f) => f && PUSHES.includes(f)).length, foci.join()).toBeGreaterThan(0)
    expect(foci.filter((f) => f && PULLS.includes(f)).length, foci.join()).toBeGreaterThan(0)
    for (let i = 1; i < foci.length; i++) if (foci[i] && foci[i - 1]) expect(foci[i], foci.join()).not.toBe(foci[i - 1])
  })

  it('meets every big muscle’s weekly sets across the week when the days allow it', () => {
    const six = athlete(['planche'], { goals: { strength: 3, power: 0, physique: 2, skills: 0, endurance: 1 }, minutesByDay: [0, 60, 60, 60, 60, 60, 60] })
    const week = planWeekAhead(six, MON)
    for (const m of ['chest', 'front-delts', 'triceps', 'lats', 'upper-back', 'biceps', 'quads', 'glutes', 'hamstrings'] as const) {
      expect(week.shortfall, `${m}: ${week.weekTotal[m] ?? 0} sets across ${week.days.map((d) => d.plan.gym?.focus).join()}`).not.toContain(m)
    }
    // Four of the days cannot do it: what is left short is said, and the big muscles are not first.
    const four = planWeekAhead(fourDays, MON)
    expect(four.shortfall.length).toBeGreaterThan(0)
  })

  it('takes today from the week, and plans the rest again from what actually happened', () => {
    const planned = planToday(fourDays, { now: MON })
    expect(planned.gym!.focus).toBe(planWeek(fourDays, MON)[0].plan.gym!.focus)
    // Monday's plan said one thing; the athlete trained legs hard instead.
    const squatted = withGym(fourDays, { sessions: [gymSession(at(0, 18), 'back-squat', 5), gymSession(at(0, 18) + 1, 'romanian-deadlift', 4)] })
    const tue = planToday(squatted, { now: at(1, 9) })
    expect(['lower', 'full', 'athletic']).not.toContain(tue.gym!.focus)
    const rest = planWeek(squatted, at(1, 9)).filter((d) => d.day <= '2026-11-22')
    expect(rest.some((d) => d.plan.gym && PUSHES.includes(d.plan.gym.focus))).toBe(true)
  })

  it('gives a short day to skills when a straight-arm family needs it to get its sessions in', () => {
    // Skills matter less than the gym here, so a short day would normally go to the gym.
    // At the tuck, where a planche session is a hard straight-arm session by the app's own count.
    const s = athlete(['planche'], { goals: { strength: 4, power: 0, physique: 3, skills: 2, endurance: 0 }, minutesByDay: [30, 30, 30, 0, 30, 0, 30] }, { stepId: 'tuck' })
    const week = planWeekAhead(s, MON)
    // One block a day, and three planche days in the week, spaced by the rest rule.
    for (const d of week.days) if (!d.plan.rest) expect(Boolean(d.plan.skill) !== Boolean(d.plan.gym), d.day).toBe(true)
    expect(week.frequency.find((f) => f.family === 'push')).toMatchObject({ planned: 3, target: 3 })
    // Round five: the first priority gets every session its rest rule allows, and the reason says the week's own count.
    expect(week.days.some((d) => d.plan.reasons.some((r) => r.includes('every session your 48h rest rule allows on your training days — 3 sessions this week')))).toBe(true)
    // Sunday, the week's last day: with two done it takes the third — and with three done, the fourth: a
    // planche-only athlete on these days would train it, so the first priority does (round five; the convention's
    // three no longer caps it).
    const sun = at(6, 9)
    const two = { ...s, sessions: [skillSession(at(0, 8)), skillSession(at(4, 8))] }
    const three = { ...s, sessions: [skillSession(at(0, 8)), skillSession(at(2, 8)), skillSession(at(4, 8))] }
    expect(planToday(two, { now: sun }).skill?.skills).toEqual(['planche'])
    expect(planToday(two, { now: sun }).gym).toBeUndefined()
    expect(planWeekAhead(three, sun).frequency[0].done).toBe(3)
    expect(planToday(three, { now: sun }).skill?.skills).toEqual(['planche'])
    expect(planToday(three, { now: sun }).gym).toBeUndefined()
  })

  it('respects a longer straight-arm rest rule across the whole week', () => {
    const s = athlete(['planche', 'frontlever'], { minutesByDay: [60, 60, 60, 60, 60, 60, 60], straightArmRestHours: 72 })
    const week = planWeek(s, MON)
    for (const family of ['push', 'pull'] as const) {
      const days = week.map((d, i) => ((d.plan.skill?.skills ?? []).some((x) => skillFamily(x) === family) ? i : -1)).filter((i) => i >= 0)
      for (let k = 1; k < days.length; k++) expect(days[k] - days[k - 1], `${family} ${days}`).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('missed sessions', () => {
  // Trains Monday, Wednesday and Friday; last week went to plan.
  const lastWeek = [at(-7, 17), at(-5, 17), at(-3, 17)]
  const regular = (prefs: Partial<TrainingPrefs> = {}) =>
    withGym(athlete(['planche'], { minutesByDay: [0, 60, 0, 60, 0, 60, 0], ...prefs }, { sessions: lastWeek.map((t) => skillSession(t)) }), {
      sessions: lastWeek.map((t) => gymSession(t + HOUR, 'bench-press', 3)),
    })

  it('says a planned day was missed, and where its work went', () => {
    const wed = at(2, 10)
    const week = planWeekAhead(regular(), wed)
    expect(week.missed).toHaveLength(1)
    expect(week.missed[0].day).toBe('2026-11-16')
    expect(week.missed[0].text).toMatch(/^Monday’s session \(.+\) did not happen: /)
    // The gym work moves to a day left this week, or the text says it drops.
    const moved = week.days.filter((d) => d.movedFrom === 'Monday')
    expect(moved.length > 0 || week.missed[0].text.includes('drops this week')).toBe(true)
    expect(week.days[0].plan.reasons).toContain(week.missed[0].text)
  })

  it('moves the most important work and lets the least important drop', () => {
    // Six gym days a week, lats a priority; Monday and Tuesday passed with nothing logged.
    const before = [at(-4, 17), at(-3, 17), at(-2, 17)].flatMap((t) => [gymSession(t, 'back-squat', 3), gymSession(t + 1, 'bench-press', 3), gymSession(t + 2, 'lat-pulldown', 3)])
    const s = withGym(athlete(['planche'], { ...GYM_ONLY, goals: { ...GYM_ONLY.goals, physique: 2 }, minutesByDay: [0, 60, 60, 60, 60, 60, 60], musclesPriority: ['lats'] }), {
      sessions: before,
    })
    const week = planWeekAhead(s, at(2, 10))
    expect(week.missed.map((m) => m.day)).toEqual(['2026-11-16', '2026-11-17'])
    // The priority still gets its sets in the four days left; what falls short is named least important first.
    expect(week.shortfall).not.toContain('lats')
    expect(week.shortfall.length).toBeGreaterThan(0)
    const weight = (m: string) => (m === 'chest-upper' || m === 'triceps-long' ? 0.5 : 1)
    for (let i = 1; i < week.shortfall.length; i++) expect(weight(week.shortfall[i - 1])).toBeLessThanOrEqual(weight(week.shortfall[i]))
    expect(week.days[0].plan.reasons.some((r) => r.startsWith('Not every weekly target fits in the days left'))).toBe(true)
  })

  it('does not call a session moved to a day off a miss, nor a first week a list of misses', () => {
    const moved = regular()
    const tuesday = { ...moved, sessions: [...moved.sessions, skillSession(at(1, 17))] }
    expect(planWeekAhead(tuesday, at(2, 10)).missed).toEqual([])
    expect(planWeekAhead(athlete(['planche'], { minutesByDay: [0, 60, 0, 60, 0, 60, 0] }), at(2, 10)).missed).toEqual([])
  })
})

describe('readiness', () => {
  // Rated sets that came in well under the effort asked (RPE 6.5 against 8).
  const easy = [gymSession(at(-2, 17), 'bench-press', 4, 6.5, 8), gymSession(at(-5, 17), 'lat-pulldown', 4, 6.5, 8)]
  const base = withGym(athlete(['planche'], GYM_ONLY), { sessions: easy })

  it('pushes only on evidence: sets easier than asked, nothing hard yesterday, no pain', () => {
    const p = planToday(base, { now: MON, minutes: 60 })
    expect(p.readiness!.level).toBe('push')
    expect(p.gym!.volumeFactor).toBeGreaterThan(1)
  })

  it('never pushes the day after a hard sport session, logged or usual, nor before one', () => {
    for (const s of [
      withGym(base, { activities: [activity(at(-1, 15), 'game', 8, false)] }),
      withGym(base, { prefs: { ...base.gym!.prefs!, sportSchedule: [{ ...practiceOn(0, 8, 'sprint'), legs: false }] } }),
      withGym(base, { prefs: { ...base.gym!.prefs!, sportSchedule: [{ ...practiceOn(2, 9, 'game'), hour: 10 }] } }),
    ]) {
      const p = planToday(s, { now: MON, minutes: 60 })
      expect(p.readiness!.level).not.toBe('push')
      expect(p.gym!.volumeFactor).toBeLessThanOrEqual(1)
    }
    const after = planToday(withGym(base, { activities: [activity(at(-1, 15), 'game', 8, false)] }), { now: MON, minutes: 60 })
    expect(after.readiness!.reason).toContain('hard game yesterday')
    // A low-effort run tomorrow uses the same rule whether entered once or on the regular schedule.
    const run = planToday(withGym(base, { activities: [{ ...activity(at(1, 7), 'run', 4), minutes: 30 }] }), { now: MON, minutes: 60 })
    const scheduled = planToday(withGym(base, { prefs: { ...base.gym!.prefs!, sportSchedule: [{ ...practiceOn(2, 4, 'run'), hour: 7, minutes: 30 }] } }), { now: MON, minutes: 60 })
    expect(run.gym!.volumeFactor).toBe(scheduled.gym!.volumeFactor)
    expect(run.readiness!.level).toBe(scheduled.readiness!.level)
  })

  it('never pushes with an open pain or niggle report; pain makes the day light', () => {
    const pain = reducer(base, { type: 'RECORD_SYMPTOM', event: { at: MON - 3 * HOUR, joints: 'pain', regions: ['elbow'], source: 'check-in' } })
    const p = planToday(pain, { now: MON, minutes: 60 })
    expect(p.readiness!.level).toBe('light')
    expect(p.gym!.volumeFactor).toBeLessThan(1)
    const niggle = reducer(base, { type: 'RECORD_SYMPTOM', event: { at: MON - 3 * HOUR, joints: 'niggle', regions: ['wrist'], source: 'check-in' } })
    const n = planToday(niggle, { now: MON, minutes: 60 })
    expect(n.readiness!.level).toBe('normal')
    expect(n.gym!.volumeFactor).toBeLessThanOrEqual(1)
    // Pain two and a half days ago no longer lightens the day, but the report is still open: no push.
    const older = reducer(base, { type: 'RECORD_SYMPTOM', event: { at: MON - 60 * HOUR, joints: 'pain', regions: ['elbow'], source: 'check-in' } })
    const o = planToday(older, { now: MON, minutes: 60 })
    expect(o.readiness!.level).toBe('normal')
    expect(o.gym!.avoidJoints).toContain('elbows')
    expect(o.gym!.volumeFactor).toBeLessThanOrEqual(1)
  })

  it('lightens the day when the same work has been costing more', () => {
    const before = [gymSession(at(-16, 17), 'bench-press', 4, 7), gymSession(at(-20, 17), 'lat-pulldown', 4, 7)]
    const lately = [gymSession(at(-2, 17), 'bench-press', 4, 8.5), gymSession(at(-5, 17), 'lat-pulldown', 4, 8.5)]
    const s = withGym(athlete(['planche'], GYM_ONLY), { sessions: [...before, ...lately] })
    const p = planToday(s, { now: MON, minutes: 60 })
    expect(p.readiness!.level).toBe('light')
    expect(p.readiness!.effort).toMatchObject({ recent: 8.5, before: 7 })
    expect(p.gym!.volumeFactor).toBeLessThanOrEqual(0.7)
  })

  it('says it cannot tell with too few rated sets, and plans a normal day', () => {
    const r = dayReadiness(athlete(['planche']), MON, { pain: false, niggle: false, deload: false, inSeason: false })
    expect(r.level).toBe('normal')
    expect(r.effort).toBeUndefined()
    expect(r.reason).toContain('Not enough rated sets')
    expect(planToday(athlete(['planche'], GYM_ONLY), { now: MON, minutes: 60 }).gym!.volumeFactor).toBe(1)
  })
})

describe('speed and power days', () => {
  const powerful = (prefs: Partial<TrainingPrefs> = {}) =>
    athlete(['planche'], { goals: { strength: 3, power: 5, physique: 2, skills: 0, endurance: 0 }, minutesByDay: [45, 45, 45, 45, 45, 45, 45], ...prefs })

  it('gets a speed and power day on fresh legs — never the day before or after a hard session, never two in a row', () => {
    const week = planWeek(powerful({ sportSchedule: [practiceOn(3)] }), MON)
    const athletic = week.map((d, i) => (d.plan.gym?.focus === 'athletic' ? i : -1)).filter((i) => i >= 0)
    expect(athletic.length, week.map((d) => d.plan.gym?.focus).join()).toBeGreaterThan(0)
    // Tuesday (the day before), Wednesday (the practice) and Thursday (the day after) are out.
    for (const i of athletic) expect([1, 2, 3]).not.toContain(i)
    for (let k = 1; k < athletic.length; k++) expect(athletic[k] - athletic[k - 1]).toBeGreaterThan(1)
  })

  it('stays off the day before and after any hard session, legs or not', () => {
    const hardNoLegs: SportSlot = { weekday: 3, kind: 'other', minutes: 90, rpe: 9, legs: false }
    const week = planWeek(powerful({ sportSchedule: [hardNoLegs] }), MON)
    const athletic = week.map((d, i) => (d.plan.gym?.focus === 'athletic' ? i : -1)).filter((i) => i >= 0)
    expect(athletic.length, week.map((d) => d.plan.gym?.focus).join()).toBeGreaterThan(0)
    for (const i of athletic) expect([1, 2, 3]).not.toContain(i)
  })

  it('is not planned when explosiveness is not a goal', () => {
    const week = planWeek(powerful({ goals: { strength: 3, power: 1, physique: 3, skills: 0, endurance: 0 } }), MON)
    expect(week.some((d) => d.plan.gym?.focus === 'athletic')).toBe(false)
  })
})

describe('movement variety', () => {
  // Four bench sessions at the same weight and reps: no new best in the last three.
  const flat = [-12, -9, -5, -2].map((d) => gymSession(at(d, 17), 'bench-press', 3, 8, undefined, 'Push'))
  const pushDay = { location: gymA, minutes: 60, focus: 'push' as GymFocus, now: MON }

  it('lends a lift that has stopped progressing to a variation of the same movement, and says why', () => {
    expect(liftTrend(flat, 'bench-press', MON).status).toBe('stalled')
    const plan = buildGymSession({ ...pushDay, sessions: flat })
    expect(plan.items.map((i) => i.exerciseId)).not.toContain('bench-press')
    expect(GYM_EXERCISE_BY_ID[plan.items[0].exerciseId].pattern).toBe('horizontal-press')
    expect(plan.notes.join(' ')).toMatch(/Barbell bench press has not beaten its best in its last 3 sessions/)
  })

  it('keeps a favourite, and a lift that is still climbing', () => {
    expect(buildGymSession({ ...pushDay, sessions: flat, ratings: { 'bench-press': 'love' } }).items[0].exerciseId).toBe('bench-press')
    const climbing = flat.map((g, i) => ({ ...g, exercises: [{ exerciseId: 'bench-press', sets: g.exercises[0].sets.map((x) => ({ ...x, kg: 40 + 2.5 * i })) }] }))
    expect(liftTrend(climbing, 'bench-press', MON).status).toBe('progressing')
    const plan = buildGymSession({ ...pushDay, sessions: climbing })
    expect(plan.items[0].exerciseId).toBe('bench-press')
    // No stall note; a long day's fill says what it added (round six), which is not about this lift.
    expect(plan.notes.filter((n) => !n.startsWith('There was time left'))).toEqual([])
  })

  it('reads three rising sessions under an old high as progress, and says nothing without enough recent history', () => {
    const lucky = flat.map((g, i) => ({ ...g, exercises: [{ exerciseId: 'bench-press', sets: g.exercises[0].sets.map((x) => ({ ...x, kg: [50, 40, 41, 42.5][i] })) }] }))
    expect(liftTrend(lucky, 'bench-press', MON).status).toBe('progressing')
    expect(liftTrend(flat.slice(1), 'bench-press', MON).status).toBe('unknown')
    // A month off: the old stall says nothing about today.
    expect(liftTrend(flat, 'bench-press', MON + 30 * DAY).status).toBe('unknown')
    expect(buildGymSession({ ...pushDay, sessions: flat, now: MON + 30 * DAY }).items[0].exerciseId).toBe('bench-press')
  })
})

describe('muscles switched off', () => {
  const legsOff = athlete(['planche'], { ...GYM_ONLY, musclesOff: ['quads', 'hamstrings', 'glutes', 'calves'] })

  it('never plans a lower-body day while the main leg muscles are off, even with one leg muscle left on', () => {
    const week = planWeek(legsOff, MON)
    expect(week.some((d) => d.plan.gym), week.map((d) => d.plan.gym?.focus).join()).toBe(true)
    for (const d of week) expect(['lower', 'athletic']).not.toContain(d.plan.gym?.focus)
  })

  it('makes the gym side’s own Auto choice skip it too', () => {
    const afterUpper = [gymSession(at(-1, 17), 'bench-press', 3, 8, undefined, 'Upper body')]
    expect(nextFocus(afterUpper, MON)).toBe('lower')
    expect(nextFocus(afterUpper, MON, ['quads', 'hamstrings', 'glutes', 'calves'])).not.toBe('lower')
    const plan = buildGymSession({ location: gymA, minutes: 60, sessions: afterUpper, musclesOff: ['quads', 'hamstrings', 'glutes', 'calves'], now: MON })
    expect(plan.focus).not.toBe('lower')
    expect(plan.items.length).toBeGreaterThan(3)
  })
})

describe('the week plan holds its rules for athletes nobody designed for', () => {
  // A seeded generator, so a failure names an athlete that can be replayed.
  const rng = (seed: number) => {
    let x = (seed * 2654435761) % 4294967296 || 1
    return () => {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      return ((x >>> 0) % 100000) / 100000
    }
  }
  const SKILLS: SkillId[] = ['planche', 'frontlever', 'handstand', 'ninety', 'flag']
  const LIFTS = ['bench-press', 'lat-pulldown', 'back-squat', 'romanian-deadlift', 'incline-db-press', 'pull-up']
  const KINDS: SportSlot['kind'][] = ['sprint', 'practice', 'game', 'pe', 'run', 'other']
  it('one block or a split that adds up, rest rules, no repeats, no speed day beside hard sport, sane numbers', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const r = rng(seed)
      const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
      const g = () => Math.floor(r() * 6)
      const skills = SKILLS.filter(() => r() < 0.5)
      const slots: SportSlot[] = [0, 1, 2, 3, 4, 5, 6].filter(() => r() < 0.25).map((weekday) => ({ weekday, kind: pick(KINDS), minutes: pick([45, 60, 90]), rpe: 3 + Math.floor(r() * 7), legs: r() < 0.7 }))
      const base = athlete(skills.length ? skills : ['planche'], {
        goals: { strength: g(), power: g(), physique: g(), skills: g(), endurance: g() },
        minutesByDay: Array.from({ length: 7 }, () => pick([0, 0, 30, 45, 60, 90])),
        musclesPriority: r() < 0.4 ? [pick(['lats', 'chest', 'quads', 'side-delts'] as const)] : [],
        musclesOff: r() < 0.2 ? ['quads', 'hamstrings', 'glutes', 'calves', 'adductors'] : [],
        ...(slots.length ? { sportSchedule: slots } : {}),
        ...(r() < 0.2 ? { season: 'in' as const } : {}),
      })
      const history = Array.from({ length: Math.floor(r() * 6) }, () => gymSession(at(-1 - Math.floor(r() * 7), 8 + Math.floor(r() * 12)), pick(LIFTS), 2 + Math.floor(r() * 4), 6 + Math.floor(r() * 4)))
      const s = withGym({ ...base, sessions: Array.from({ length: Math.floor(r() * 4) }, () => skillSession(at(-1 - Math.floor(r() * 7), 10))) }, { sessions: history })
      const now = at(Math.floor(r() * 7), pick([7, 12, 18, 23]))
      const week = planWeekAhead(s, now)
      const who = `seed ${seed}`
      if (process.env.FUZZ_DEBUG === String(seed)) {
        process.stderr.write(JSON.stringify({ now: new Date(now).toString(), prefs: s.gym!.prefs, skills: s.profile.skills, gym: history.map((h) => [new Date(h.startedAt).toString().slice(0, 21), h.exercises[0].exerciseId, h.exercises[0].sets.length]) }) + String.fromCharCode(10))
        for (const d of week.days) process.stderr.write(`${d.day} ${d.plan.rest ? 'rest' : `${d.plan.skill?.skills.join('+') ?? '-'} ${d.plan.skill?.minutes ?? 0} | ${d.plan.gym?.focus ?? '-'} ${d.plan.gym?.minutes ?? 0} f=${d.plan.gym?.volumeFactor}`} | ${d.why.join(' / ')}
`)
      }
      expect(week.days, who).toHaveLength(7)
      const prefs = s.gym!.prefs!
      for (const [i, d] of week.days.entries()) {
        const p = d.plan
        const text = [...p.reasons, ...d.why, p.readiness?.reason ?? ''].join(' ')
        expect(text, who).not.toMatch(/undefined|NaN|\[object/)
        if (p.rest) continue
        expect((p.skill?.minutes ?? 0) + (p.gym?.minutes ?? 0), `${who} ${d.day}`).toBeLessThanOrEqual(p.minutes)
        if (p.gym) {
          expect(Number.isFinite(p.gym.volumeFactor) && p.gym.volumeFactor > 0 && p.gym.volumeFactor <= 1.2, who).toBe(true)
          if (p.gym.volumeFactor > 1) expect(i, `${who}: only today can be a push day`).toBe(0)
          if (p.gym.focus === 'athletic') expect(p.gym.volumeFactor, `${who}: a push never adds speed work`).toBeLessThanOrEqual(1)
        } else {
          expect(p.readiness, `${who}: readiness scales the gym; a skills-only day is the skill coach's call`).toBeUndefined()
        }
        if (i === 0 && p.readiness?.level === 'push') {
          const near = sportBetween(s.gym, now - 2 * DAY, now + 36 * HOUR).filter((a) => a.rpe >= 7 || a.kind === 'game' || a.kind === 'sprint')
          expect(near.filter((a) => a.at <= now && a.at >= now - DAY - 24 * HOUR), who).toEqual([])
        }
        const prev = week.days[i - 1]?.plan
        if (i > 0 && prev && !prev.rest) {
          if (prefs.straightArmRestHours >= 48) {
            for (const f of ['push', 'pull'] as const) {
              const has = (x: typeof p) => (x.skill?.skills ?? []).some((k) => skillFamily(k) === f)
              expect(has(prev) && has(p), `${who} ${d.day} ${f} two days running`).toBe(false)
            }
          }
          if (prev.gym && p.gym) expect(p.gym.focus, `${who} ${d.day} repeats ${p.gym.focus}`).not.toBe(prev.gym.focus)
        }
        if (p.gym?.focus === 'athletic') {
          const hard = sportBetween(s.gym, d.at - 2 * DAY, d.at + 2 * DAY).filter((a) => a.rpe >= 7 || a.kind === 'game' || a.kind === 'sprint')
          const dayOf = (t: number) => new Date(t).toDateString()
          const around = [-1, 0, 1].map((k) => dayOf(d.at + k * DAY))
          expect(hard.filter((a) => around.includes(dayOf(a.at))), `${who} ${d.day} speed day beside hard sport`).toEqual([])
          expect(prev?.gym?.focus, who).not.toBe('athletic')
        }
      }
    }
  })
})

describe('the week plan keeps shared recovery, the minutes and the athlete’s own days, for athletes nobody designed for', () => {
  const rng = (seed: number) => {
    let x = (seed * 2654435761) % 4294967296 || 1
    return () => {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      return ((x >>> 0) % 100000) / 100000
    }
  }
  const SKILLS: SkillId[] = ['planche', 'frontlever', 'handstand', 'ninety', 'flag']
  const KIT = ['floor', 'wall', 'parallettes', 'pullup-bar', 'rings', 'box'] as AppState['profile']['equipment']
  const home: GymLocation = { id: 'h', name: 'Home', unit: 'kg', equipment: ['pullup-bar', 'floor'], updatedAt: 1 }
  const PRESS = new Set(['horizontal-press', 'incline-press', 'vertical-press', 'dip'])
  const room = (m: number) => (m >= MIN_SKILL_MINUTES[3] ? 3 : m >= MIN_SKILL_MINUTES[2] ? 2 : m >= MIN_SKILL_MINUTES[1] ? 1 : 0)
  const heavy = (t: number, kind: 'push' | 'pull' | 'legs'): GymSession => ({
    id: `h-${t}-${kind}`,
    locationId: 'a',
    startedAt: t,
    endedAt: t + HOUR,
    name: kind,
    exercises: (kind === 'push' ? ['bench-press', 'overhead-press'] : kind === 'pull' ? ['pull-up', 'lat-pulldown'] : ['back-squat']).map((exerciseId) => ({
      exerciseId,
      sets: Array.from({ length: 3 }, () => ({ kg: 40, reps: 6, rpe: 8, at: t })),
    })),
  })

  it('hard sessions of a family the rest rule apart, every day within its minutes, two movements a gym block, assigned days as written', () => {
    const stats = { pressing: 0, athletes: 0, days: 0, cal: 0, gym: 0, openers: 0, kitless: 0, light: 0 }
    const calendarApart = (a: number, b: number) => {
      const d0 = (t: number) => new Date(new Date(t).toDateString()).getTime()
      return Math.round(Math.abs(d0(a) - d0(b)) / (24 * HOUR)) * 24 * HOUR
    }
    const FAMILY_JOINTS = { push: ['wrists', 'elbows', 'shoulders'], pull: ['elbows', 'shoulders'] } as const
    for (let seed = 1; seed <= 50; seed++) {
      const r = rng(seed + 7919)
      const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
      const g = () => Math.floor(r() * 6)
      const skills = SKILLS.filter(() => r() < 0.45)
      if (!skills.length) skills.push(pick(SKILLS))
      const steps = { planche: pick<StepId>(['foundations', 'lean', 'tuck', 'advtuck']), frontlever: pick<StepId>(['fl-tuck', 'fl-advtuck']) }
      // Kit varies on its own stream, so the rest of each athlete stays as it was.
      const rk = rng(seed + 104729)
      const kit = rk() < 0.35 ? KIT.filter((k) => k === 'floor' || rk() < 0.5) : KIT
      const base = startingState({ skills, steps: steps as never, equipment: kit })
      const mode = r()
      const loc = r() < 0.3 ? home : gymA
      const restH = pick([24, 48, 72])
      const goals = { strength: g(), power: g(), physique: g(), skills: g(), endurance: g() }
      const prefs: TrainingPrefs = {
        ...defaultPrefs(1),
        goals,
        minutesByDay: Array.from({ length: 7 }, () => pick([0, 0, 15, 20, 30, 40, 45, 60, 90])),
        straightArmRestHours: restH,
        ...(r() < 0.2 ? { musclesOff: ['quads', 'hamstrings', 'glutes', 'calves', 'adductors'] as TrainingPrefs['musclesOff'] } : {}),
        ...(r() < 0.3 ? { sportSchedule: [{ weekday: Math.floor(r() * 7), kind: pick(['game', 'practice', 'sprint'] as const), minutes: 90, rpe: 5 + Math.floor(r() * 5), legs: r() < 0.7 }] } : {}),
      }
      const weekPlan: WeekPlan = {}
      if (r() < 0.5) {
        for (const wd of [0, 1, 2, 3, 4, 5, 6] as Weekday[]) {
          const x = r()
          if (x < 0.15) weekPlan[wd] = 'rest'
          else if (x < 0.45) weekPlan[wd] = [...skills].sort(() => r() - 0.5).slice(0, 1 + Math.floor(r() * 3))
        }
      }
      const now = at(Math.floor(r() * 7), pick([7, 12, 18]))
      const history = Array.from({ length: Math.floor(r() * 5) }, () => heavy(now - (6 + Math.floor(r() * 110)) * HOUR, pick(['push', 'pull', 'legs'] as const)))
      const skillHistory = Array.from({ length: Math.floor(r() * 4) }, () =>
        skillSession(now - (6 + Math.floor(r() * 110)) * HOUR, pick(['tuck-planche', 'fl-tuck']), 3 + Math.floor(r() * 3)),
      )
      const s: AppState = {
        ...base,
        profile: { ...base.profile, birthYear: pick([2012, 2009, 1995]) },
        settings: { ...base.settings, ...(Object.keys(weekPlan).length ? { weekPlan } : {}) },
        sessions: [...base.sessions, ...skillHistory],
        gym: mode < 0.12 ? undefined : { ...defaultGym(['floor']), locations: [loc], activeLocationId: loc.id, sessions: history, ...(mode < 0.22 ? {} : { prefs }) },
      }
      const own = s.gym?.prefs
      const rest = (own?.straightArmRestHours ?? 48) * HOUR
      const week = planWeekAhead(s, now)
      const who = `seed ${seed}`
      const youth = conservative(s.profile, now)
      const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()
      let pressing = 0
      for (const d of week.days) {
        const p = d.plan
        const reading = s.settings.weekPlan ? readDay(s, new Date(d.at).getDay() as Weekday) : undefined
        if (reading?.kind === 'rest') expect(p.rest, `${who} ${d.day} planned rest`).toBe(true)
        expect(d.kind, `${who} ${d.day}`).toBe(p.kind)
        if (p.rest) {
          expect(p.kind, `${who} ${d.day} a rest day has no session`).toBe('rest')
          continue
        }
        stats.days++
        // Exactly one main session a day: calisthenics alone, or the gym with at most an opener, or nothing.
        if (p.kind === 'calisthenics') {
          stats.cal++
          expect(Boolean(p.skill) && !p.skill!.opener && !p.gym, `${who} ${d.day} calisthenics holds its skills alone`).toBe(true)
          if (reading?.kind === 'skills') expect(p.skill!.minutes, `${who} ${d.day} assigned day gets the minutes`).toBe(p.minutes)
        } else if (p.kind === 'gym') {
          stats.gym++
          expect(Boolean(p.gym) && (!p.skill || p.skill.opener === true), `${who} ${d.day} gym holds the gym and at most an opener`).toBe(true)
          expect(reading?.kind, `${who} ${d.day} an assigned day is calisthenics`).not.toBe('skills')
        } else {
          expect(!p.skill && !p.gym, `${who} ${d.day} nothing planned holds nothing`).toBe(true)
          // A balance skill is never rested by the straight-arm rule: with skills among the goals, a day long enough holds a session.
          if (skills.includes('handstand') && (own ?? defaultPrefs(1)).goals.skills > 0 && p.minutes >= MIN_SKILL_MINUTES[1]) {
            expect(p.kind, `${who} ${d.day} empty with the handstand free: ${p.reasons.join(' | ')}`).not.toBe('rest')
          }
        }
        if (!s.gym?.locations.length || !Math.max((own ?? defaultPrefs(1)).goals.strength, (own ?? defaultPrefs(1)).goals.physique, (own ?? defaultPrefs(1)).goals.power, (own ?? defaultPrefs(1)).goals.endurance)) {
          expect(p.kind, `${who} ${d.day} no gym place or goals: calisthenics`).not.toBe('gym')
        }
        if (p.skill?.opener) {
          stats.openers++
          const skill = p.skill.skills[0]
          const fam = skillFamily(skill)
          expect(p.skill.skills, `${who} ${d.day} one skill opens`).toHaveLength(1)
          // The first priority's opener is the long one from 45-minute days (round five).
          expect(p.skill.minutes, who).toBe(openerMinutesFor(skill === skills[0], p.minutes))
          expect(p.skill.minutes + p.gym!.minutes, `${who} ${d.day} opener and gym`).toBe(p.minutes)
          expect(p.gym!.minutes, who).toBeGreaterThanOrEqual(MIN_GYM_MINUTES)
          // Its family is the focus's, its kit is at the place, and no joint the family loads is sore.
          if (!p.skill.practiceFirst) expect(fam !== 'balance' && focusFamilies(p.gym!.focus).includes(fam), `${who} ${d.day} ${skill} opens ${p.gym!.focus}`).toBe(true)
          expect(missingKit(skill, [...loc.equipment, ...s.profile.equipment] as never), `${who} ${d.day} ${skill} kit at ${loc.name} or the athlete's`).toEqual([])
          const f = fam === 'balance' ? 'push' : fam
          expect(p.gym!.avoidJoints.filter((j) => (FAMILY_JOINTS[f] as readonly string[]).includes(j)), `${who} ${d.day} ${skill} opens on a sore joint`).toEqual([])
          // The family's rest rule: nothing logged on an earlier day, nor another day's hard session of it, inside it.
          // In calendar days, the unit planned days are spaced in, with no genuinely short gap in real hours (round five).
          for (const e of familyEvents(s, now)[f]) {
            if (!sameDay(e.at, d.at) && e.at < d.at) {
              expect(calendarApart(d.at, e.at), `${who} ${d.day} ${skill} opens after a logged session`).toBeGreaterThanOrEqual(rest)
              expect(d.at - e.at, `${who} ${d.day} ${skill} opens after a logged session`).toBeGreaterThanOrEqual(rest - REST_SLACK_HOURS * HOUR)
            }
          }
          for (const o of week.days) {
            if (o === d || o.plan.rest || calendarApart(o.at, d.at) >= rest) continue
            const hardThere = (o.plan.skill?.hard ?? []).includes(f) || Boolean(o.plan.gym && focusFamilies(o.plan.gym.focus).includes(f))
            expect(hardThere, `${who} ${d.day} ${skill} opens beside ${o.day}`).toBe(false)
          }
        }
        let used = 0
        if (p.skill) {
          // As the app starts it: the block's request, with the kit where the athlete is.
          const w = finalizeWorkout(s, skillRequest(p.skill), undefined, d.at)
          used += w.minutes
          // A calisthenics day only for a session that can train: never one that is waiting for kit.
          if (p.kind === 'calisthenics') {
            expect(w.name, `${who} ${d.day} ${p.skill.skills} with kit [${s.profile.equipment}]`).not.toMatch(/waiting for kit/)
            // With the kit it is built with: the athlete's own, or the gym's on a day planned there (round five).
            const builtWith = p.skill.kit?.length ? (['floor', ...p.skill.kit] as typeof s.profile.equipment) : s.profile.equipment
            for (const k of p.skill.skills) expect(missingKit(k, builtWith), `${who} ${d.day} ${k}`).toEqual([])
            stats.kitless += kit.length < KIT.length ? 1 : 0
          }
          // A family called hard gets the sets the app counts as hard.
          const sets = { push: 0, pull: 0 }
          for (const b of w.blocks) {
            if (b.section !== 'main' && b.section !== 'strength') continue
            const f = skillSetLoading(b.exerciseId, b.section)?.straightArm
            if (f) sets[f] += b.sets
          }
          for (const f of p.skill.hard ?? []) expect(sets[f], `${who} ${d.day} ${f} called hard over ${p.skill.skills}`).toBeGreaterThanOrEqual(3)
          if (reading?.kind === 'skills') {
            expect(p.skill.skills, `${who} ${d.day} assigned ${reading.skills}`).toEqual(reading.skills.slice(0, p.skill.skills.length))
            expect(p.skill.skills.length, `${who} ${d.day} assigned ${reading.skills} in ${p.skill.minutes}`).toBe(Math.min(3, reading.skills.length, room(p.skill.minutes)))
          }
        } else if (reading?.kind === 'skills') {
          expect(p.minutes, `${who} ${d.day} assigned day with no skill block`).toBeLessThan(MIN_SKILL_MINUTES[1])
        }
        if (p.gym) {
          expect(s.gym?.locations.length, `${who} gym block with no place`).toBeGreaterThan(0)
          const b = buildGymSession({
            location: loc,
            capacity: bodyweightCapacity(s, now),
            minutes: p.gym.minutes,
            focus: p.gym.focus,
            sessions: history,
            ratings: s.gym!.ratings,
            youth,
            goals: (own ?? defaultPrefs(1)).goals,
            musclesOff: p.gym.musclesOff,
            // As the screens hand the plan on: the week's spare muscles and priorities beside the athlete's own.
            priority: [...new Set([...(own ?? defaultPrefs(1)).musclesPriority, ...(p.gym.priority ?? [])])],
            ...(p.gym.spare?.length ? { spare: p.gym.spare } : {}),
            avoidJoints: p.gym.avoidJoints,
            volumeFactor: p.gym.volumeFactor,
            favoriteAt: s.gym!.favoriteAt,
            now: d.at,
          })
          expect(b.fits && b.items.length >= 2, `${who} ${d.day} ${p.gym.focus} ${p.gym.minutes}m at ${loc.name} builds ${b.items.length}`).toBe(true)
          used += b.estimatedMin
          for (const it of b.items) if (PRESS.has(GYM_EXERCISE_BY_ID[it.exerciseId].pattern)) pressing += it.sets
          // A light pressing day (round 5b) presses under the heavy-pressing line, whatever it is built from.
          if (p.gym.lightPress) {
            expect(LIGHT_PRESS_SPARE.every((m) => p.gym!.spare?.includes(m)), `${who} ${d.day} light spares ${p.gym.spare}`).toBe(true)
            const sets = familyWorkingSets(b.items.map((it) => ({ exerciseId: it.exerciseId, sets: Array.from({ length: it.sets }, () => ({ reps: 1 })) })))
            expect(sets.push, `${who} ${d.day} light ${p.gym.focus}: ${b.items.map((it) => `${it.exerciseId}x${it.sets}`)}`).toBeLessThan(HARD_GYM_FAMILY_SETS)
            stats.light++
          }
        }
        expect(used, `${who} ${d.day}: ${p.skill?.minutes ?? 0}+${p.gym?.minutes ?? 0} of ${p.minutes}`).toBeLessThanOrEqual(p.minutes + 1)
      }
      // Hard sessions of a family on different days sit the rest rule apart: logged and planned, skill and gym alike.
      const logged = familyEvents(s, now)
      for (const fam of ['push', 'pull'] as const) {
        if (!skills.some((k) => skillFamily(k) === fam)) continue
        const events = [
          ...logged[fam].map((e) => ({ at: e.at, fixed: true, what: e.gym ? 'logged gym' : 'logged skill' })),
          ...week.days.flatMap((d) => {
            const assigned = Boolean(s.settings.weekPlan) && readDay(s, new Date(d.at).getDay() as Weekday).kind === 'skills'
            return [
              ...((d.plan.skill?.hard ?? []).includes(fam) ? [{ at: d.at, fixed: assigned, what: `${d.day} skills` }] : []),
              // Light pressing is not a hard session of the push family (checked above by building it).
              ...(d.plan.gym && focusFamilies(d.plan.gym.focus).includes(fam) && !(fam === 'push' && d.plan.gym.lightPress)
                ? [{ at: d.at, fixed: false, what: `${d.day} ${d.plan.gym.focus}` }]
                : []),
            ]
          }),
        ]
        for (let i = 0; i < events.length; i++)
          for (let j = i + 1; j < events.length; j++) {
            const a = events[i]
            const b = events[j]
            if (sameDay(a.at, b.at) || (a.fixed && b.fixed)) continue
            // Every pair is counted in calendar days (daylight saving); a logged session also keeps clear of a genuinely
            // short gap in real hours (round five: its real hours once refused a day the plan had promised).
            const real2 = a.what.startsWith('logged') || b.what.startsWith('logged')
            expect(calendarApart(a.at, b.at), `${who} ${fam}: ${a.what} vs ${b.what} under ${rest / HOUR}h`).toBeGreaterThanOrEqual(rest)
            if (real2) expect(Math.abs(a.at - b.at), `${who} ${fam}: ${a.what} vs ${b.what} a short gap`).toBeGreaterThanOrEqual(rest - REST_SLACK_HOURS * HOUR)
          }
      }
      if (own && goals.physique >= 3 && loc === gymA) {
        stats.pressing += pressing
        stats.athletes++
      }
    }
    if (process.env.FUZZ_STATS) process.stderr.write(`FUZZ pressing sets a week, physique 3+: ${(stats.pressing / Math.max(1, stats.athletes)).toFixed(1)} over ${stats.athletes} athletes; ${stats.days} days checked: ${stats.cal} calisthenics, ${stats.gym} gym, ${stats.openers} openers\n`)
    // Both kinds happen, and gym days open with a skill.
    expect(stats.cal, 'calisthenics days').toBeGreaterThan(0)
    expect(stats.gym, 'gym days').toBeGreaterThan(0)
    expect(stats.openers, 'openers').toBeGreaterThan(0)
    expect(stats.kitless, 'calisthenics days for athletes missing some kit').toBeGreaterThan(0)
    // Light pressing days happen among them, so the check above is reached.
    expect(stats.light, 'light pressing days').toBeGreaterThan(0)
    // Physique athletes still press: the family rule concentrates pressing, it does not remove it.
    expect(stats.pressing / Math.max(1, stats.athletes)).toBeGreaterThanOrEqual(4)
  })
})

describe('a sore joint, wherever the session is built', () => {
  const report = (t: number, region: 'elbow' | 'wrist', joints: 'pain' | 'niggle' = 'pain') =>
    ({ at: t, joints, regions: [region], source: 'check-in' as const })
  const sore = (events: ReturnType<typeof report>[]) => {
    let s = athlete(['planche'], { goals: { strength: 3, power: 0, physique: 3, skills: 3, endurance: 0 } })
    for (const event of events) s = reducer(s, { type: 'RECORD_SYMPTOM', event })
    return s
  }

  it('remembers every report of the last three days, not only the latest', () => {
    const s = sore([report(MON - 40 * HOUR, 'elbow'), report(MON - 2 * HOUR, 'wrist', 'niggle'), report(MON - 90 * HOUR, 'wrist')])
    const r = soreJoints(s, MON)
    expect(r.joints.sort()).toEqual(['elbows', 'wrists'])
    expect(r.pain).toBe(true)
    expect(soreJoints(s, MON + 40 * HOUR).joints).toEqual(['wrists'])
  })

  it('calls the skill day eased, never hard, while a joint it loads is sore', () => {
    const s = sore([report(MON - 3 * HOUR, 'elbow')])
    const days = planWeekAhead(s, MON, { todayKind: 'calisthenics' }).days
    const lines = days.slice(0, 2).flatMap((d) => d.why)
    expect(lines.some((l) => /Planche: hard session/.test(l)), lines.join(' | ')).toBe(false)
    // Round five: a day whose session is the pain-safe one says that, not "eased" — it trains none of the holds.
    expect(lines.some((l) => /Planche: an eased session|Pain-safe recovery: gentle movement, no loaded holds/.test(l)), lines.join(' | ')).toBe(true)
  })
})

describe('one main session a day: the coach picks calisthenics or the gym', () => {
  const KIT = ['floor', 'wall', 'parallettes', 'pullup-bar', 'rings', 'box'] as AppState['profile']['equipment']
  const noBar: GymLocation = { ...gymA, id: 'nb', name: 'No bar', equipment: gymA.equipment.filter((e) => e !== 'pullup-bar') }
  const SKILLS_HEAVY = { strength: 1, power: 0, physique: 1, skills: 5, endurance: 0 }
  const BALANCED = { strength: 3, power: 0, physique: 3, skills: 3, endurance: 0 }
  const GYM_HEAVY = { strength: 5, power: 0, physique: 4, skills: 1, endurance: 0 }
  const EVERY_DAY = [60, 60, 60, 60, 60, 60, 60]
  /** A real athlete at the tuck on both roads, at a full gym unless told otherwise. */
  const real = (skills: SkillId[], prefs: Partial<TrainingPrefs>, opts: { place?: GymLocation | null; equipment?: AppState['profile']['equipment'] } = {}): AppState => {
    const base = startingState({ skills, steps: { planche: 'tuck', frontlever: 'fl-tuck' } as never, equipment: opts.equipment ?? KIT })
    const place = opts.place === undefined ? gymA : opts.place
    return {
      ...base,
      profile: { ...base.profile, birthYear: 2010 },
      gym: { ...defaultGym(['floor']), locations: place ? [place] : [], ...(place ? { activeLocationId: place.id } : {}), prefs: { ...defaultPrefs(1), minutesByDay: EVERY_DAY, ...prefs } },
    }
  }
  const kinds = (s: AppState, now = MON) => planWeekAhead(s, now).days.map((d) => d.kind)
  const count = (ks: string[], k: string) => ks.filter((x) => x === k).length
  const symptom = (region: 'elbow' | 'wrist', joints: 'pain' | 'niggle', t = MON - 2 * HOUR) => ({ id: `${region}-${t}`, at: t, joints, regions: [region], source: 'check-in' as const })

  it('gives skills-heavy goals more calisthenics days, gym-heavy goals more gym days — with openers on push and pull days', () => {
    const skillsWeek = kinds(real(['planche', 'frontlever'], { goals: SKILLS_HEAVY }))
    const gymWeekPlan = planWeekAhead(real(['planche', 'frontlever'], { goals: GYM_HEAVY }), MON)
    const gymWeek = gymWeekPlan.days.map((d) => d.kind)
    expect(count(skillsWeek, 'calisthenics'), skillsWeek.join()).toBeGreaterThan(count(skillsWeek, 'gym'))
    expect(count(gymWeek, 'gym'), gymWeek.join()).toBeGreaterThan(count(gymWeek, 'calisthenics'))
    expect(count(skillsWeek, 'calisthenics')).toBeGreaterThan(count(gymWeek, 'calisthenics'))
    const pushPull = gymWeekPlan.days.filter((d) => d.plan.gym && (d.plan.gym.focus === 'push' || d.plan.gym.focus === 'pull'))
    for (const d of pushPull) {
      expect(d.plan.skill?.opener, `${d.day} ${d.plan.gym!.focus}`).toBe(true)
      expect(skillFamily(d.plan.skill!.skills[0]), d.day).toBe(d.plan.gym!.focus)
    }
    // Pairing holds whichever pressing or pulling focus fills the day (round six: a push or pull day the week's skill
    // sessions have spent is an upper day): at least one gym day opens with a skill its focus trains.
    const paired = gymWeekPlan.days.filter((d) => d.plan.gym && d.plan.skill?.opener && (focusFamilies(d.plan.gym.focus) as string[]).includes(skillFamily(d.plan.skill.skills[0])))
    expect(paired.length, gymWeekPlan.days.map((d) => `${d.kind}:${d.plan.gym?.focus ?? ''}${d.plan.skill?.opener ? '+' + d.plan.skill.skills[0] : ''}`).join()).toBeGreaterThanOrEqual(1)
    for (const d of gymWeekPlan.days) if (d.plan.gym && ['lower', 'full', 'athletic'].includes(d.plan.gym.focus)) expect(d.plan.skill, d.day).toBeUndefined()
    // A hard opener counts toward its family's weekly sessions. The planche's gym day opens with it; the front lever's
    // two sessions are wherever they fit — since round 5b builds a 60-minute day as 60, they are the lever partnering
    // the planche's calisthenics days (built at the 45 of the setup answer, that partner was a thin one and gave its
    // place up, and the week paired the lever with two pull days instead).
    for (const f of gymWeekPlan.frequency) {
      const days = gymWeekPlan.days.filter((d) => (d.plan.skill?.hard ?? []).includes(f.family) && weekStart(d.at) === weekStart(MON))
      expect(f.planned, f.family).toBe(days.length)
      expect(f.planned, f.family).toBeGreaterThanOrEqual(f.family === 'push' ? 3 : 2)
      if (f.family === 'push') expect(days.some((d) => d.plan.skill!.opener), f.family).toBe(true)
    }
  })

  it('makes every training day calisthenics with no gym place, or no gym goals', () => {
    for (const s of [
      real(['planche', 'frontlever'], { goals: GYM_HEAVY }, { place: null }),
      real(['planche', 'frontlever'], { goals: { strength: 0, power: 0, physique: 0, skills: 2, endurance: 0 } }),
    ]) {
      const week = planWeekAhead(s, MON)
      for (const d of week.days) {
        expect(d.plan.gym, d.day).toBeUndefined()
        expect(d.kind, d.day).not.toBe('gym')
      }
      expect(week.days.filter((d) => d.kind === 'calisthenics').length).toBeGreaterThanOrEqual(4)
    }
  })

  it('opens no push or pull day with its skill while an elbow is sore, and does again once it is not', () => {
    const control = planWeekAhead(real(['planche', 'frontlever'], { goals: GYM_HEAVY }), MON).days
    const sore: AppState = { ...real(['planche', 'frontlever'], { goals: GYM_HEAVY }), symptoms: [symptom('elbow', 'niggle')] }
    const week = planWeekAhead(sore, MON).days
    const within = (t: number) => t - (MON - 2 * HOUR) < 72 * HOUR
    expect(control.filter((d) => within(d.at) && d.plan.skill?.opener).length, 'the control opens inside the window').toBeGreaterThan(0)
    for (const d of week) if (within(d.at)) expect(d.plan.skill?.opener, `${d.day} ${d.plan.gym?.focus}`).toBeUndefined()
    // Once the window has passed, the elbow no longer shuts the opener. (With 25-minute openers the week's own
    // rest rules can leave the rest of this particular week without one, so the rule is asked directly.)
    const after = MON + 4 * 24 * HOUR + 8 * HOUR
    expect(gymOpener(sore, 'push', gymA, after, 60)?.skills).toEqual(['planche'])
    expect(gymOpener(sore, 'push', gymA, MON + 8 * HOUR, 60)).toBeUndefined()
  })

  it('opens no front lever day at a place with no bar, and still opens push days with the planche', () => {
    const at = (place: GymLocation) => planWeekAhead(real(['frontlever', 'planche'], { goals: GYM_HEAVY }, { place }), MON).days
    const withBar = at(gymA)
    expect(withBar.some((d) => d.plan.skill?.opener && d.plan.skill.skills[0] === 'frontlever')).toBe(true)
    // Kit is the place's and the athlete's together: no bar at the place nor at home, no lever opener.
    const without = planWeekAhead(real(['frontlever', 'planche'], { goals: GYM_HEAVY }, { place: noBar, equipment: ['floor', 'parallettes'] }), MON).days
    for (const d of without) if (d.plan.skill?.opener) expect(d.plan.skill.skills, d.day).not.toContain('frontlever')
    // No bar at home, one at the gym: the lever opens a pull day there (found by review), built with the gym's kit.
    const gymBar = planWeekAhead(real(['frontlever', 'planche'], { goals: GYM_HEAVY }, { place: gymA, equipment: ['floor', 'parallettes'] }), MON).days
    const lever = gymBar.find((d) => d.plan.skill?.opener && d.plan.skill.skills[0] === 'frontlever')
    expect(new Set(lever?.plan.skill?.kit)).toEqual(new Set(['floor', 'parallettes', ...gymA.equipment]))
    // Calisthenics happens where the athlete is (round four): a lever on a calisthenics day there is built with the bar.
    for (const d of gymBar.filter((x) => x.kind === 'calisthenics' && x.plan.skill!.skills.includes('frontlever'))) {
      expect(d.plan.skill!.kit, d.day).toContain('pullup-bar')
      expect(finalizeWorkout(real(['frontlever', 'planche'], { goals: GYM_HEAVY }, { place: gymA, equipment: ['floor', 'parallettes'] }), skillRequest(d.plan.skill!), undefined, d.at).name, d.day).not.toMatch(/waiting for kit/)
    }
    // The planche needs no bar: it still opens a push day there.
    expect(gymOpener(real(['frontlever', 'planche'], { goals: GYM_HEAVY }, { place: noBar }), 'push', noBar, MON, 60)?.skills).toEqual(['planche'])
  })

  it('trains an assigned week-plan day as calisthenics with exactly its skills, whatever the goals', () => {
    const base = real(['planche', 'frontlever'], { goals: GYM_HEAVY })
    const s: AppState = { ...base, settings: { ...base.settings, weekPlan: { 2: ['frontlever', 'planche'], 4: ['planche'] } } }
    const week = planWeekAhead(s, MON).days
    const on = (weekday: number) => week.find((d) => new Date(d.at).getDay() === weekday)!
    for (const [weekday, skills] of [[2, ['frontlever', 'planche']], [4, ['planche']]] as const) {
      const d = on(weekday)
      expect(d.kind, d.day).toBe('calisthenics')
      expect(d.plan.gym, d.day).toBeUndefined()
      expect(d.plan.skill!.opener, d.day).toBeUndefined()
      expect(d.plan.skill!.skills, d.day).toEqual(skills)
    }
  })

  it('opens a gym session by the rules: focus, priority, room, pain, sore joints, rest rule, kit and goals', () => {
    const s = real(['planche', 'frontlever'], { goals: BALANCED })
    const op = (state: AppState, focus: GymFocus, minutes = 60, place = gymA, now = MON) => gymOpener(state, focus, place, now, minutes)?.skills[0]
    // 25 minutes from an hour up (round three), with the whole kit at the place: the gym's list and the portable kit.
    // The block says where it is planned (round five).
    expect(gymOpener(s, 'push', gymA, MON, 60)).toEqual({ minutes: openerMinutes(60), skills: ['planche'], hard: ['push'], opener: true, kit: expect.any(Array), placeId: gymA.id })
    expect(new Set(gymOpener(s, 'push', gymA, MON, 60)!.kit)).toEqual(new Set(['floor', 'parallettes', 'rings', ...gymA.equipment]))
    // The first priority's opener is the long one from 45 minutes (round five); another skill's keeps 18 under an hour.
    expect(gymOpener(s, 'push', gymA, MON, 45)?.minutes).toBe(openerMinutesFor(true, 45))
    expect(gymOpener(s, 'pull', gymA, MON, 45)?.minutes).toBe(MIN_SKILL_MINUTES[1])
    expect(op(s, 'pull')).toBe('frontlever')
    expect(op(s, 'upper')).toBe('planche')
    for (const focus of ['lower', 'full', 'athletic'] as GymFocus[]) expect(op(s, focus), focus).toBeUndefined()
    // Room for both blocks: the opener and the smallest gym block.
    expect(op(s, 'push', MIN_SKILL_MINUTES[1] + MIN_GYM_MINUTES)).toBe('planche')
    expect(op(s, 'push', MIN_SKILL_MINUTES[1] + MIN_GYM_MINUTES - 1)).toBeUndefined()
    // Pain shuts every opener; a sore joint shuts the families that load it.
    expect(op({ ...s, symptoms: [symptom('wrist', 'pain')] }, 'pull')).toBeUndefined()
    const elbow = { ...s, symptoms: [symptom('elbow', 'niggle')] }
    expect(op(elbow, 'push')).toBeUndefined()
    expect(op(elbow, 'pull')).toBeUndefined()
    const wrist = { ...s, symptoms: [symptom('wrist', 'niggle')] }
    expect(op(wrist, 'push')).toBeUndefined()
    expect(op(wrist, 'pull')).toBe('frontlever')
    expect(op(wrist, 'upper')).toBe('frontlever')
    // The rest rule: a hard planche session last night rests the push family, and so does one earlier today: the
    // opener is never a second hard session of its family in a day (found by review: 8 am, then a 6 pm push pick).
    const lastNight = { ...s, sessions: [skillSession(MON - 15 * HOUR)] }
    expect(op(lastNight, 'push')).toBeUndefined()
    expect(op(lastNight, 'upper')).toBe('frontlever')
    expect(op({ ...s, sessions: [skillSession(MON - 2 * HOUR)] }, 'push')).toBeUndefined()
    expect(op({ ...s, sessions: [skillSession(MON - 2 * HOUR)] }, 'pull')).toBe('frontlever')
    expect(op(lastNight, 'push', 60, gymA, MON + 40 * HOUR)).toBe('planche')
    // The kit: at the place, and in the athlete's own list the session is built from.
    const noHomeBar = real(['planche', 'frontlever'], { goals: BALANCED }, { equipment: ['floor', 'parallettes'] })
    expect(op(noHomeBar, 'pull', 60, noBar)).toBeUndefined()
    expect(op(noHomeBar, 'pull')).toBe('frontlever')
    // The highest-priority skill of the family whose kit is there: no pole, so the flag gives way to the lever.
    expect(op(real(['flag', 'frontlever'], { goals: BALANCED }), 'pull')).toBe('frontlever')
    // Skills are not among the goals: no opener.
    expect(op(real(['planche', 'frontlever'], { goals: { ...BALANCED, skills: 0 } }), 'push')).toBeUndefined()
  })

  it('pairs a family with its gym day, follows a pick or what was logged today, and gives a close call to calisthenics around sport', () => {
    // A day the goals would give to calisthenics goes to the gym, its skill first, while that family's muscles need the gym.
    const balanced = planWeekAhead(real(['planche', 'frontlever'], { goals: BALANCED }), MON).days
    const paired = balanced.filter((d) => d.plan.skill?.opener && d.plan.gym!.focus === skillFamily(d.plan.skill.skills[0]))
    expect(paired.length, balanced.map((d) => d.kind).join()).toBeGreaterThan(0)
    // The athlete's pick: today is that kind, and the other is offered back.
    const s = real(['planche', 'frontlever'], { goals: BALANCED })
    const gymPick = planWeekAhead(s, MON, { todayKind: 'gym' }).days[0].plan
    expect([gymPick.kind, gymPick.alternative]).toEqual(['gym', 'calisthenics'])
    const calPick = planWeekAhead(s, MON, { todayKind: 'calisthenics' }).days[0].plan
    expect([calPick.kind, calPick.alternative, calPick.gym]).toEqual(['calisthenics', 'gym', undefined])
    // What was logged today decides: a gym session on a calisthenics day makes it a gym day, a skill session on
    // a gym day with no opener a calisthenics day — and a gym day's own opener, done, leaves it a gym day.
    const hsSkills = real(['handstand'], { goals: SKILLS_HEAVY })
    expect(planToday(hsSkills, { now: MON }).kind).toBe('calisthenics')
    expect(planToday(withGym(hsSkills, { sessions: [gymSession(at(0, 8), 'bench-press', 4)] }), { now: MON }).kind).toBe('gym')
    const hsGym = real(['handstand'], { goals: GYM_HEAVY })
    expect(planToday(hsGym, { now: MON }).kind).toBe('gym')
    expect(planToday({ ...hsGym, sessions: [skillSession(at(0, 8))] }, { now: MON }).kind).toBe('calisthenics')
    const opening = planToday(s, { now: MON })
    expect([opening.kind, opening.skill?.opener]).toEqual(['gym', true])
    const opened = planToday({ ...s, sessions: [skillSession(at(0, 8))] }, { now: MON })
    expect([opened.kind, opened.skill?.opener, opened.gym?.focus]).toEqual(['gym', true, opening.gym!.focus])
    // A close call: calisthenics on the day before a game, the gym when its sets need the day.
    const fewDays = { minutesByDay: [45, 45, 0, 45, 0, 45, 0] }
    const plain = real(['handstand'], { goals: BALANCED, ...fewDays })
    const game = real(['handstand'], { goals: BALANCED, ...fewDays, sportSchedule: [{ weekday: 2, kind: 'game', minutes: 90, rpe: 9, legs: true }] })
    expect(planToday(plain, { now: MON }).kind).toBe('gym')
    expect(planToday(game, { now: MON }).kind).toBe('calisthenics')
  })
})

describe('the kind choice at its edges', () => {
  const KIT = ['floor', 'wall', 'parallettes', 'pullup-bar', 'rings', 'box'] as AppState['profile']['equipment']
  const real = (skills: SkillId[], prefs: Partial<TrainingPrefs>): AppState => {
    const base = startingState({ skills, steps: { planche: 'tuck', frontlever: 'fl-tuck' } as never, equipment: KIT })
    return { ...base, profile: { ...base.profile, birthYear: 2010 }, gym: { ...defaultGym(['floor']), locations: [gymA], activeLocationId: 'a', prefs: { ...defaultPrefs(1), minutesByDay: [60, 60, 60, 60, 60, 60, 60], ...prefs } } }
  }

  it('gives a gym day the gym cannot fill to calisthenics, never to nothing', () => {
    // Yesterday's squats make legs and full body repeat the same hard muscles, and last morning's planche and lever
    // sessions rest pressing and pulling: today's gym has nothing it may build, and the handstand is free.
    const base = real(['planche', 'frontlever', 'handstand'], { goals: { strength: 5, power: 0, physique: 4, skills: 1, endurance: 0 } })
    const s = withGym(
      { ...base, sessions: [skillSession(MON - 26 * HOUR, 'tuck-planche'), skillSession(MON - 25 * HOUR, 'tuck-front-lever')] },
      { sessions: [gymSession(MON - 15 * HOUR, 'back-squat', 5), gymSession(MON - 15 * HOUR + 1, 'romanian-deadlift', 4)] },
    )
    const today = planWeekAhead(s, MON).days[0]
    expect(today.kind, today.plan.reasons.join(' | ')).toBe('calisthenics')
    expect(today.plan.gym).toBeUndefined()
    expect(today.plan.skill!.skills).toContain('handstand')
    expect(today.plan.skill!.skills).not.toContain('planche')
    expect(today.plan.reasons.some((r) => r.startsWith('No gym session fits today’s rules'))).toBe(true)
  })

  it('lets pairing move days to the gym only while the goals allow: skills-heavy goals keep most days calisthenics', () => {
    const s = real(['planche', 'frontlever'], { goals: { strength: 1, power: 0, physique: 3, skills: 5, endurance: 0 }, minutesByDay: [45, 45, 45, 45, 45, 45, 45] })
    const week = planWeekAhead(s, MON).days
    expect(week.filter((d) => d.kind === 'calisthenics').length, week.map((d) => d.kind).join()).toBeGreaterThanOrEqual(4)
    // The gym days it does pair still open with the family's skill.
    expect(week.some((d) => d.kind === 'gym' && d.plan.skill?.opener)).toBe(true)
  })
})

describe('kit that travels', () => {
  it('counts a home pull-up bar only at home, while rings go anywhere', () => {
    const s = athlete(['frontlever'], { goals: { strength: 3, power: 0, physique: 3, skills: 3, endurance: 0 } })
    const kit = (equipment: EquipmentId[]): AppState => ({ ...s, profile: { ...s.profile, equipment } })
    const noBar: GymLocation = { ...gymA, id: 'nb', equipment: gymA.equipment.filter((e) => e !== 'pullup-bar') }
    expect(gymOpener(kit(['floor', 'pullup-bar']), 'pull', noBar, MON, 60)).toBeUndefined()
    expect(gymOpener(kit(['floor', 'pullup-bar']), 'pull', gymA, MON, 60)?.skills).toEqual(['frontlever'])
    expect(gymOpener(kit(['floor', 'rings']), 'pull', noBar, MON, 60)?.skills).toEqual(['frontlever'])
  })
})
