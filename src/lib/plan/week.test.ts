import { describe, expect, it } from 'vitest'
import type { AppState, Session, SetLog, SkillId } from '../../types'
import { initialState, reducer } from '../store'
import { defaultGym, defaultPrefs, mergeGym, sanitizeGym } from '../gym/state'
import type { GymFocus } from '../gym/builder'
import type { GymLocation, GymSession, OutsideActivity, SportSlot, TrainingPrefs } from '../gym/types'
import { fatigueAt } from './load'
import { planToday, planWeek, planWeekAhead, recentPatternUse, rotationHints, skillFamily } from './planner'
import { dayReadiness } from './readiness'
import { scheduledSport, sportBetween } from './sport'

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

  it('keeps legs out the day before, of and after a hard usual session — and not for an easy one', () => {
    const s = withGym(athlete(['planche'], { minutesByDay: [60, 60, 60, 60, 60, 60, 60], sportSchedule: [practiceOn(3)] }), {})
    for (const [day, why] of [[1, 'before'], [2, 'of'], [3, 'after']] as const) {
      const p = planToday(s, { now: at(day, 16), minutes: 60 })
      expect(['lower', 'athletic'], `${why}: ${p.gym!.focus}`).not.toContain(p.gym!.focus)
      expect(p.gym!.musclesOff, why).toContain('quads')
    }
    expect(planToday(s, { now: at(1, 16), minutes: 60 }).reasons.some((r) => r.startsWith('Your usual practice is'))).toBe(true)
    // Two days after, the legs are back.
    expect(planToday(s, { now: at(4, 17), minutes: 60 }).gym!.musclesOff).not.toContain('quads')
    // An easy usual session is fatigue, not a reason to keep legs out.
    const easy = withGym(athlete(['planche'], { minutesByDay: [60, 60, 60, 60, 60, 60, 60], sportSchedule: [practiceOn(3, 4)] }), {})
    expect(planToday(easy, { now: at(1, 16), minutes: 60 }).gym!.musclesOff).not.toContain('quads')
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
      expect(week.shortfall, `${m}: ${week.days.map((d) => d.plan.gym?.focus).join()}`).not.toContain(m)
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
    const s = athlete(['planche'], { goals: { strength: 4, power: 0, physique: 3, skills: 2, endurance: 0 }, minutesByDay: [30, 30, 30, 0, 30, 0, 30] })
    const week = planWeekAhead(s, MON)
    // One block a day, and three planche days in the week, spaced by the rest rule.
    for (const d of week.days) if (!d.plan.rest) expect(Boolean(d.plan.skill) !== Boolean(d.plan.gym), d.day).toBe(true)
    expect(week.frequency.find((f) => f.family === 'push')).toMatchObject({ planned: 3, target: 3 })
    expect(week.days.some((d) => d.plan.reasons.some((r) => r.includes('needs it to get 3 hard sessions in this week')))).toBe(true)
    // Sunday, the week's last day: with two done it takes the third; with three done it is the gym's.
    const sun = at(6, 9)
    const two = { ...s, sessions: [skillSession(at(0, 8)), skillSession(at(4, 8))] }
    const three = { ...s, sessions: [skillSession(at(0, 8)), skillSession(at(2, 8)), skillSession(at(4, 8))] }
    expect(planToday(two, { now: sun }).skill?.skills).toEqual(['planche'])
    expect(planToday(two, { now: sun }).gym).toBeUndefined()
    expect(planWeekAhead(three, sun).frequency[0].done).toBe(3)
    expect(planToday(three, { now: sun }).skill).toBeUndefined()
    expect(planToday(three, { now: sun }).gym).toBeDefined()
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
    // An easy run tomorrow keeps the legs fresh and the day a little lighter: a push never lifts that, nor says push.
    const run = planToday(withGym(base, { activities: [{ ...activity(at(1, 7), 'run', 4), minutes: 30 }] }), { now: MON, minutes: 60 })
    expect(run.gym!.volumeFactor).toBeLessThanOrEqual(0.8)
    expect(run.readiness!.level).toBe('normal')
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
  it('lists the patterns used in the last three weeks, most used first, and names a movement that filled every session of one', () => {
    const s = withGym(athlete(['planche']), {
      sessions: [
        gymSession(at(-2, 17), 'bench-press'),
        gymSession(at(-6, 17), 'bench-press'),
        gymSession(at(-12, 17), 'bench-press'),
        gymSession(at(-6, 18), 'lat-pulldown'),
        gymSession(at(-30, 17), 'back-squat'), // older than three weeks
      ],
    })
    const uses = recentPatternUse(s.gym, MON)
    expect(uses[0]).toMatchObject({ pattern: 'horizontal-press', sessions: 3 })
    expect(uses.some((u) => u.exercises.some((e) => e.exerciseId === 'back-squat'))).toBe(false)
    const hints = rotationHints(uses)
    expect(hints.map((h) => h.exerciseId)).toEqual(['bench-press'])
    expect(rotationHints(recentPatternUse(s.gym, MON, 7))).toEqual([])
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
