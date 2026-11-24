import { describe, expect, it } from 'vitest'
import type { AppState, Session, SetLog, SkillId } from '../../types'
import { initialState } from '../store'
import { defaultGym, defaultPrefs } from '../gym/state'
import type { GymLocation, GymSession, TrainingPrefs } from '../gym/types'
import { GYM_EXERCISES } from '../../data/gym/exercises'
import { buildGymSession } from '../gym/builder'
import { conservative } from '../gym/draft'
import { finalizeWorkout } from '../../data/workouts'
import { AWAY_FACTOR, gymDaysAway, gymDeloadDue, gymToday, insideRestRule, openerMinutes, openerMinutesFor, planToday, skillRequest } from './planner'
import { calisthenicsCardLabel, goalStanding, openerLine, stepPassed } from './screens'
import { planClockTick, PLAN_CLOCK_MIN } from './usePlanClock'
import { STEP_BY_ID } from '../../data/progressions'

// Found by the third independent review (2026-11-22, round three). Each test pins the decision, not the copy.
const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = new Date(2026, 10, 22, 17, 0).getTime() // Sunday
const gymA: GymLocation = {
  id: 'a',
  name: 'Gym A',
  unit: 'kg',
  equipment: ['barbell', 'squat-rack', 'bench', 'incline-bench', 'dumbbells', 'cable', 'lat-pulldown', 'leg-press', 'leg-curl', 'leg-extension', 'calf-machine', 'pullup-bar', 'dip-bars', 'box', 'cable-row'] as GymLocation['equipment'],
  updatedAt: 1,
}
function athlete(skills: SkillId[], prefs: Partial<TrainingPrefs> = {}, birthYear = 2013, extra: Partial<AppState> = {}): AppState {
  const s = initialState()
  return {
    ...s,
    onboarded: true,
    profile: { ...s.profile, skills, birthYear, equipment: ['floor', 'parallettes'] as AppState['profile']['equipment'] },
    gym: { ...defaultGym(['floor']), locations: [gymA], activeLocationId: 'a', prefs: { ...defaultPrefs(1), ...prefs } },
    ...extra,
  } as AppState
}
const planche = (t: number, n = 5): Session =>
  ({
    id: `s-${t}`,
    startedAt: t,
    endedAt: t + HOUR,
    workoutName: 'Skill',
    workoutKind: 'skill',
    stepId: 'tuck',
    sets: Array.from({ length: n }, () => ({ exerciseId: 'tuck-planche', kind: 'hold', value: 8, target: 8, section: 'main', at: t, endReason: 'effort' }) as SetLog),
  }) as unknown as Session
const squat = GYM_EXERCISES.find((e) => e.load === 'barbell' && e.pattern === 'squat')!
const row = GYM_EXERCISES.find((e) => e.load === 'barbell' && e.pattern === 'horizontal-pull')!
const bench = GYM_EXERCISES.find((e) => e.load === 'barbell' && e.pattern === 'horizontal-press')!
/** A gym session of two lifts, `sets` unrated working sets each. */
const lifts = (t: number, sets: number): GymSession => ({
  id: `g${t}`,
  locationId: 'a',
  startedAt: t,
  endedAt: t + HOUR,
  name: 'Full body',
  exercises: [squat, row].map((e) => ({ exerciseId: e.id, sets: Array.from({ length: sets }, () => ({ kg: 30, reps: 8, at: t })) })),
})
/** Local calendar arithmetic: day `d` after `y-m-day0` at `h` o'clock, whatever the clock changes do. */
const on = (y: number, m: number, day0: number, d: number, h: number) => new Date(y, m, day0 + d, h, 0, 0, 0).getTime()

describe('a lighter week the plan called is a lighter week', () => {
  // Monday 2 Nov 2026; weeks are built by calendar day.
  const week = (w: number, d: number) => on(2026, 10, 2, 7 * w + d, 17)
  const youth = athlete(['planche'], { minutesByDay: [0, 60, 0, 60, 0, 0, 0] })
  const withSessions = (gs: GymSession[]): AppState => ({ ...youth, gym: { ...youth.gym!, sessions: gs } })
  const full = (w: number) => [lifts(week(w, 0), 3), lifts(week(w, 2), 3)]

  it('ends the hard run whatever its sets, and the next one comes a full cycle later', () => {
    const three = [...full(-3), ...full(-2), ...full(-1)]
    expect(gymDeloadDue(withSessions(three), on(2026, 10, 2, 0, 9)).due).toBe(true)
    // The lighter week, logged at 10 of the usual 12 sets — over the 70% line, unrated.
    const lighter = [...three, lifts(week(0, 0), 3), lifts(week(0, 2), 2)]
    expect(gymDeloadDue(withSessions(lighter), on(2026, 10, 2, 7, 9)).due).toBe(false)
    const after = [...lighter, ...full(1), ...full(2)]
    expect(gymDeloadDue(withSessions(after), on(2026, 10, 2, 21, 9)).due).toBe(false)
    expect(gymDeloadDue(withSessions([...after, ...full(3)]), on(2026, 10, 2, 28, 9)).due).toBe(true)
  })

  // Twice: doing exactly what the plan says, and logging the lighter week's sessions at the usual sets — the
  // builder's lighter day once kept 75–100% of them, and the count must not depend on how far it trims.
  it.each([false, true])('closed loop: a 13-year-old on 3×45 min who never rates sets gets one lighter week per cycle (usual sets on the lighter week: %s)', (usualSets) => {
    let state = athlete(['planche'], { minutesByDay: [0, 45, 0, 45, 0, 45, 0], goals: { strength: 4, physique: 4, power: 0, skills: 0, endurance: 0 } })
    const light: number[] = []
    const gymDays: number[] = []
    for (let w = 0; w < 12; w++) {
      // Monday 7 Sep 2026 onwards, across the October clock change, in calendar days.
      if (gymDeloadDue(state, on(2026, 8, 7, 7 * w, 12)).due) light.push(w)
      let days = 0
      for (const d of [0, 2, 4]) {
        const at = on(2026, 8, 7, 7 * w + d, 17)
        const plan = planToday(state, { now: at })
        if (plan.kind !== 'gym' || !plan.gym) continue
        days++
        const built = buildGymSession({
          location: gymA,
          minutes: plan.gym.minutes,
          focus: plan.gym.focus,
          sessions: state.gym!.sessions,
          youth: conservative(state.profile, at),
          goals: state.gym!.prefs!.goals,
          musclesOff: plan.gym.musclesOff,
          avoidJoints: plan.gym.avoidJoints,
          volumeFactor: usualSets ? 1 : plan.gym.volumeFactor,
          now: at,
        })
        const session: GymSession = {
          id: `w${w}d${d}`,
          locationId: 'a',
          startedAt: at,
          endedAt: at + HOUR,
          name: built.name,
          exercises: built.items.map((i) => ({ exerciseId: i.exerciseId, sets: Array.from({ length: i.sets }, () => ({ reps: i.plan.range[1], at, kg: i.suggestion.kg ?? 20 })) })),
        }
        state = { ...state, gym: { ...state.gym!, sessions: [...state.gym!.sessions, session] } }
      }
      gymDays.push(days)
    }
    expect(gymDays.every((n) => n >= 2)).toBe(true)
    expect(light).toEqual([3, 7, 11])
  }, 120_000)
})

describe('time away', () => {
  const adult = athlete(['planche'], { minutesByDay: [60, 60, 60, 60, 60, 60, 60], goals: { strength: 4, physique: 4, power: 0, skills: 1, endurance: 0 } }, 1995)
  const history = (lastAt: number): GymSession[] =>
    [0, 1, 2].map((k) => ({
      id: `b${k}`,
      locationId: 'a',
      startedAt: lastAt - k * 3 * DAY,
      endedAt: lastAt - k * 3 * DAY + HOUR,
      name: 'Push',
      exercises: [{ exerciseId: bench.id, sets: [1, 2, 3].map(() => ({ kg: 50, reps: 8, rpe: 8, at: lastAt - k * 3 * DAY })) }],
    }))
  const back = (daysAgo: number) => ({ ...adult, gym: { ...adult.gym!, sessions: history(on(2026, 10, 22, -daysAgo, 17)) } })

  it('the first gym session after 21 days or more keeps at most 0.8 of the sets, and says why', () => {
    expect(gymDaysAway(back(36), NOW)).toBe(36)
    const g = gymToday(back(36), { now: NOW, minutes: 60, focus: 'push' })
    expect(g.volumeFactor).toBeLessThanOrEqual(AWAY_FACTOR)
    expect(g.plan.gym?.volumeFactor).toBeLessThanOrEqual(AWAY_FACTOR)
    expect(g.plan.reasons.some((r) => r.startsWith('Back after 36 days'))).toBe(true)
    expect(g.limits.some((r) => r.startsWith('Back after 36 days'))).toBe(true)
    // Exactly three weeks counts; under it, and no history at all, do not.
    expect(gymDaysAway(back(21), NOW)).toBe(21)
    expect(gymDaysAway(back(20), NOW)).toBeUndefined()
    expect(gymDaysAway(adult, NOW)).toBeUndefined()
    const control = gymToday(back(10), { now: NOW, minutes: 60, focus: 'push' })
    expect(control.volumeFactor).toBeGreaterThan(AWAY_FACTOR)
    expect(control.plan.reasons.some((r) => r.startsWith('Back after'))).toBe(false)
  })
})

describe('a picked skill day inside the rest rule', () => {
  const base = athlete(['planche'], { straightArmRestHours: 48 })
  const near = { ...base, sessions: [planche(NOW - 20 * HOUR)] }
  const far = { ...base, sessions: [planche(NOW - 4 * DAY)] }

  it('is named, with the hours and the rule, and the pick still builds', () => {
    const hit = insideRestRule(near, ['planche'], NOW)
    expect(hit).toMatchObject({ skill: 'planche', family: 'push', hours: 20, ruleHours: 48, gym: false })
    expect(insideRestRule(far, ['planche'], NOW)).toBeUndefined()
    expect(insideRestRule({ ...near, gym: { ...near.gym!, prefs: { ...near.gym!.prefs!, straightArmRestHours: 12 } } }, ['planche'], NOW)).toBeUndefined()
    // A balance skill has no rule; a mix names the skill that is inside it.
    expect(insideRestRule(near, ['handstand'], NOW)).toBeUndefined()
    expect(insideRestRule(near, ['handstand', 'planche'], NOW)?.skill).toBe('planche')
    // The coach's plan rests the family today; the pick is still a full session.
    expect(planToday(near, { now: NOW }).skill?.skills ?? []).not.toContain('planche')
    const picked = finalizeWorkout(near, { source: 'auto', skills: ['planche'] }, undefined, NOW)
    expect(picked.blocks.some((b) => b.section === 'main')).toBe(true)
  })

  it('counts heavy pressing at the gym as the family’s hard session', () => {
    const press: GymSession = {
      id: 'p',
      locationId: 'a',
      startedAt: NOW - 30 * HOUR,
      endedAt: NOW - 29 * HOUR,
      name: 'Push',
      exercises: [{ exerciseId: bench.id, sets: Array.from({ length: 8 }, () => ({ kg: 40, reps: 8, at: NOW - 30 * HOUR })) }],
    }
    const hit = insideRestRule({ ...base, gym: { ...base.gym!, sessions: [press] } }, ['planche'], NOW)
    expect(hit).toMatchObject({ family: 'push', hours: 30, gym: true })
  })
})

describe('the opener scales with the day', () => {
  const s = athlete(['planche'], { minutesByDay: [60, 60, 60, 60, 60, 60, 60], goals: { strength: 3, physique: 3, power: 0, skills: 3, endurance: 0 } }, 2010, {
    stepId: 'tuck',
    unlocked: ['foundations', 'lean', 'frog', 'tuck'],
  } as Partial<AppState>)

  it('is 18 minutes under an hour and 25 from an hour up, and the lifts still fit beside it', () => {
    expect([30, 45, 59, 60, 75, 90].map(openerMinutes)).toEqual([18, 18, 18, 25, 25, 25])
    // Round five: the first priority's opener is 25 minutes whenever the lifts keep their 20 beside it — from 45.
    expect([30, 44, 45, 59, 60].map((m) => openerMinutesFor(true, m))).toEqual([18, 18, 25, 25, 25])
    for (const minutes of [45, 60, 75]) {
      const g = gymToday(s, { now: NOW, minutes, focus: 'push' })
      expect(g.opener?.skills, `${minutes} min`).toEqual(['planche'])
      expect(g.opener!.minutes).toBe(openerMinutesFor(true, minutes))
      expect(g.opener!.minutes + g.plan.gym!.minutes).toBeLessThanOrEqual(minutes)
      // The opener builds with everything usable at the place: the gym's list and the athlete's portable kit.
      expect(g.opener!.kit).toEqual(expect.arrayContaining(['parallettes', 'pullup-bar']))
      const built = finalizeWorkout(s, skillRequest(g.opener!), undefined, NOW)
      expect(built.minutes).toBeLessThanOrEqual(g.opener!.minutes + 1)
      const lifts = buildGymSession({ location: gymA, minutes: g.plan.gym!.minutes, focus: 'push', sessions: [], youth: true, warmUpMin: 2, now: NOW })
      expect(lifts.fits).toBe(true)
    }
    // The long opener holds more than the 18-minute one (the first priority gets it from 45 minutes, round five).
    const long = gymToday(s, { now: NOW, minutes: 45, focus: 'push' }).opener!
    const short = { ...long, minutes: openerMinutes(45) }
    const main = (o: typeof long) => finalizeWorkout(s, skillRequest(o), undefined, NOW).blocks.filter((b) => b.section !== 'warmup' && b.section !== 'cooldown').reduce((n, b) => n + b.sets, 0)
    expect(long.minutes).toBe(25)
    expect(main(long)).toBeGreaterThan(main(short))
  })

  it('is described as the holds it is, with the family’s strength work at the lifts', () => {
    expect(openerLine({ skills: ['planche'], minutes: 25 })).toBe('Opens with planche holds (25 min), followed by your lifts')
    expect(openerLine({ skills: ['frontlever'], minutes: 18 })).toBe('Opens with front lever holds (18 min), followed by your lifts')
  })
})

describe('one thing said about today', () => {
  it('labels the calisthenics card as the alternative on a gym or rest day', () => {
    const gymDay = { minutes: 60, rest: false, kind: 'gym' as const, gym: { minutes: 60, focus: 'push' as const, avoidJoints: [], volumeFactor: 1, deload: false, musclesOff: [] }, reasons: [] }
    expect(calisthenicsCardLabel(gymDay)).toMatch(/^Instead of the gym/)
    expect(calisthenicsCardLabel({ minutes: 0, rest: true, kind: 'rest', reasons: [] })).toMatch(/^If you train anyway/)
    expect(calisthenicsCardLabel({ minutes: 45, rest: false, kind: 'calisthenics', skill: { minutes: 45, skills: ['planche'] }, reasons: [] })).toBe('Today’s calisthenics')
  })

  it('a goal that is the current step is reached only once that step is passed', () => {
    expect(goalStanding({ order: 4 }, { order: 4 }, false)).toBe('here')
    expect(goalStanding({ order: 4 }, { order: 4 }, true)).toBe('reached')
    expect(goalStanding({ order: 5 }, { order: 4 }, false)).toBe('reached')
    expect(goalStanding({ order: 3 }, { order: 4 }, true)).toBe('ahead')
    // A brand-new athlete placed on their destination: not passed until the next step opens.
    const placed = { ...initialState(), stepId: 'tuck', unlocked: ['foundations', 'lean', 'frog', 'tuck'] } as AppState
    expect(stepPassed(placed, 'tuck')).toBe(false)
    expect(goalStanding(STEP_BY_ID.tuck, STEP_BY_ID.tuck, stepPassed(placed, 'tuck'))).toBe('here')
    expect(stepPassed({ ...placed, unlocked: [...placed.unlocked, 'advtuck'] } as AppState, 'tuck')).toBe(true)
  })

  it('re-plans on a coarse clock as well as the calendar day', () => {
    const t = new Date(2026, 10, 22, 9, 0).getTime()
    expect(planClockTick(t + PLAN_CLOCK_MIN * 60_000)).toBe(planClockTick(t) + 1)
    expect(planClockTick(t + 60_000)).toBe(planClockTick(t))
  })
})
