import { describe, expect, it } from 'vitest'
import type { AppState, Session, SetLog, SkillId, StepId, WeekPlan } from '../../types'
import { finalizeWorkout } from '../../data/workouts'
import { buildGymSession } from '../gym/builder'
import { defaultGym, defaultPrefs } from '../gym/state'
import type { GymLocation, GymSession, OutsideActivity, TrainingPrefs } from '../gym/types'
import { lineupFor } from '../lineup'
import { startingState } from '../skillLoop'
import { addDays, weekStart } from '../time'
import { familyEvents, skillSetLoading } from './load'
import { focusFamilies, gymDeloadDue, MIN_SKILL_MINUTES, planToday, planWeekAhead, skillGoalPace } from './planner'
import { sportBetween } from './sport'

// Monday 16 November 2026, 9 am local.
const MON = new Date(2026, 10, 16, 9, 0).getTime()
const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = (dayOffset: number, hour: number, minute = 0) => {
  const d = new Date(MON)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}
const KIT = ['floor', 'wall', 'parallettes', 'pullup-bar', 'rings', 'box'] as AppState['profile']['equipment']
const gymA: GymLocation = {
  id: 'a',
  name: 'Gym A',
  unit: 'kg',
  equipment: ['barbell', 'squat-rack', 'bench', 'incline-bench', 'dumbbells', 'cable', 'lat-pulldown', 'leg-press', 'leg-curl', 'pullup-bar', 'dip-bars', 'box'],
  updatedAt: 1,
}

/** A real athlete: skills at real steps, with a gym set up unless `gym` is false. */
function athlete(skills: SkillId[], prefs: Partial<TrainingPrefs> = {}, opts: { steps?: Partial<Record<SkillId, StepId>>; gym?: boolean; birthYear?: number } = {}): AppState {
  const base = startingState({ skills, steps: { planche: 'tuck', frontlever: 'fl-tuck', ...opts.steps } as never, equipment: KIT })
  return {
    ...base,
    profile: { ...base.profile, birthYear: opts.birthYear ?? 2010 },
    ...(opts.gym === false ? { gym: undefined } : { gym: { ...defaultGym(['floor']), locations: [gymA], activeLocationId: 'a', prefs: { ...defaultPrefs(1), ...prefs } } }),
  }
}
const hold = (exerciseId: string, t: number): SetLog => ({ exerciseId, kind: 'hold', value: 8, target: 8, section: 'main', at: t })
const skillSession = (t: number, exerciseId = 'tuck-planche', n = 4): Session => ({
  id: `s-${t}`,
  startedAt: t,
  endedAt: t + HOUR,
  workoutName: 'Skill',
  workoutKind: 'skill' as Session['workoutKind'],
  stepId: 'tuck',
  sets: Array.from({ length: n }, () => hold(exerciseId, t)),
})
const lift = (exerciseId: string, n: number, t: number, kg?: number) => ({ exerciseId, sets: Array.from({ length: n }, () => ({ ...(kg ? { kg } : {}), reps: 6, rpe: 9, at: t })) })
const heavyPush = (t: number): GymSession => ({
  id: `hp-${t}`,
  locationId: 'a',
  startedAt: t,
  endedAt: t + HOUR,
  name: 'Push',
  exercises: [lift('bench-press', 5, t, 70), lift('dip', 4, t), lift('overhead-press', 4, t, 40)],
})
const heavyPull = (t: number): GymSession => ({
  id: `hl-${t}`,
  locationId: 'a',
  startedAt: t,
  endedAt: t + HOUR,
  name: 'Pull',
  exercises: [lift('pull-up', 5, t), lift('lat-pulldown', 4, t, 50)],
})
const withGymSessions = (s: AppState, sessions: GymSession[]): AppState => ({ ...s, gym: { ...s.gym!, sessions } })

describe('pressing and straight-arm skill work share recovery', () => {
  it('rests the planche after heavy pressing last night, and says so instead of calling the day hard', () => {
    const s = withGymSessions(athlete(['planche']), [heavyPush(MON - 14 * HOUR)])
    expect(familyEvents(s, MON).push).toEqual([{ at: MON - 14 * HOUR, gym: true }])
    const day = planWeekAhead(s, MON).days[0]
    expect(day.plan.skill?.skills ?? []).not.toContain('planche')
    expect(day.plan.skill?.hard ?? []).not.toContain('push')
    expect(day.why.some((w) => /Planche: hard session/.test(w)), day.why.join(' | ')).toBe(false)
    // A light pressing day (three sets) is not a hard session of the family.
    const light = withGymSessions(athlete(['planche']), [{ ...heavyPush(MON - 14 * HOUR), exercises: [lift('bench-press', 3, MON - 14 * HOUR, 40)] }])
    expect(planToday(light, { now: MON, minutes: 60 }).skill?.skills).toContain('planche')
  })

  it('rests the front lever after heavy pulling, and keeps the gym off pressing beside a planche day', () => {
    const s = withGymSessions(athlete(['planche', 'frontlever']), [heavyPull(MON - 20 * HOUR)])
    const p = planToday(s, { now: MON, minutes: 60 })
    expect(p.skill?.skills).not.toContain('frontlever')
    expect(p.skill?.skills).toContain('planche')
  })

  it('never puts planche Friday, a push gym day Saturday and planche Sunday: hard sessions of a family sit the rest rule apart', () => {
    const FRI = at(4, 17)
    for (const restH of [48, 72]) {
      const s = { ...athlete(['planche'], { minutesByDay: [60, 60, 60, 60, 60, 60, 60], straightArmRestHours: restH, goals: { strength: 3, power: 0, physique: 5, skills: 3, endurance: 0 } }), sessions: [skillSession(FRI)] }
      for (const now of [at(5, 8), at(5, 18)]) {
        const week = planWeekAhead(s, now)
        const events = [FRI, ...week.days.flatMap((d) => ((d.plan.skill?.hard ?? []).includes('push') || (d.plan.gym && focusFamilies(d.plan.gym.focus).includes('push')) ? [d.at] : []))]
        for (let i = 0; i < events.length; i++)
          for (let j = i + 1; j < events.length; j++) {
            if (new Date(events[i]).toDateString() === new Date(events[j]).toDateString()) continue
            expect(Math.abs(events[j] - events[i]), `${restH}h: ${new Date(events[i])} vs ${new Date(events[j])}`).toBeGreaterThanOrEqual(restH * HOUR)
          }
        // Saturday, the day after Friday's planche: no pressing.
        const sat = week.days[0].plan.gym
        if (sat) expect(['push', 'upper']).not.toContain(sat.focus)
      }
    }
  })

  it('lets one day carry the holds and the pressing, skills first — that is where the week presses', () => {
    const s = athlete(['planche'], { minutesByDay: [60, 60, 60, 60, 60, 60, 60], goals: { strength: 3, power: 0, physique: 5, skills: 3, endurance: 0 } })
    const week = planWeekAhead(s, MON)
    const both = week.days.filter((d) => (d.plan.skill?.hard ?? []).includes('push') && d.plan.gym && focusFamilies(d.plan.gym.focus).includes('push'))
    expect(both.length, week.days.map((d) => `${d.plan.skill?.skills.join('+') ?? '-'} ${d.plan.gym?.focus ?? '-'}`).join(' | ')).toBeGreaterThan(0)
    for (const d of both) expect(d.plan.reasons.some((r) => r.includes('the holds first, then the pressing'))).toBe(true)
  })
})

describe('the Today card for an athlete without a gym, and the athlete’s own week', () => {
  it('gives a skills-only athlete every day at their session length, with no gym block and no invented rest days', () => {
    const s = athlete(['planche'], {}, { gym: false })
    const week = planWeekAhead(s, MON)
    for (const d of week.days) {
      expect(d.plan.rest, d.day).toBe(false)
      expect(d.plan.gym, d.day).toBeUndefined()
      // A day the rest rule rests the planche has nothing else to train; every other day is a full session.
      if (d.plan.skill) expect(d.plan.skill.minutes, d.day).toBe(s.settings.sessionMinutes)
      else expect(d.plan.reasons.some((r) => r.includes('rest rule')), d.day).toBe(true)
    }
    expect(week.days.filter((d) => d.plan.skill).length).toBeGreaterThanOrEqual(3)
  })

  it('gives the time to skills when the gym side has goals but no place', () => {
    const s = athlete(['planche'])
    const noPlace = { ...s, gym: { ...s.gym!, locations: [], activeLocationId: undefined } }
    const p = planToday(noPlace, { now: MON, minutes: 60 })
    expect(p.gym).toBeUndefined()
    expect(p.skill?.minutes).toBe(60)
  })

  it('trains a day the athlete assigned exactly as written, rests a day marked rest, and plans the rest', () => {
    const plan: WeekPlan = { 2: ['planche', 'frontlever'], 3: ['frontlever'], 4: 'rest' }
    for (const gym of [true, false]) {
      const base = athlete(['planche', 'frontlever'], { minutesByDay: [60, 60, 0, 60, 60, 60, 60] }, { gym })
      const s: AppState = { ...base, settings: { ...base.settings, weekPlan: plan } }
      const week = planWeekAhead(s, MON)
      const on = (weekday: number) => week.days.find((d) => new Date(d.at).getDay() === weekday)!.plan
      expect(on(2).skill?.skills, `gym ${gym}`).toEqual(['planche', 'frontlever'])
      expect(on(3).skill?.skills, `gym ${gym}`).toEqual(['frontlever'])
      expect(on(4).rest, `gym ${gym}`).toBe(true)
      // The session the card starts trains the same skills.
      const tue = on(2)
      expect(lineupFor(s, { source: 'auto', minutes: tue.skill!.minutes, skills: tue.skill!.skills }, at(1, 17)).map((e) => e.skill)).toEqual(['planche', 'frontlever'])
    }
  })

  it('without a gym schedule, rests the open days once the weekly goal is met — and only then', () => {
    const base = athlete(['planche'], {}, { gym: false })
    const s = { ...base, settings: { ...base.settings, weeklyGoal: 2 }, sessions: [skillSession(at(0, 8)), skillSession(at(1, 8))] }
    const wed = planWeekAhead(s, at(2, 9))
    expect(wed.days[0].plan.rest).toBe(true)
    expect(planWeekAhead({ ...s, sessions: [skillSession(at(0, 8))] }, at(2, 9)).days[0].plan.rest).toBe(false)
  })
})

describe('days that fit their minutes', () => {
  it('never plans a skill block smaller than the session it starts', () => {
    for (const skills of [['planche'], ['planche', 'frontlever'], ['frontlever', 'planche', 'handstand']] as SkillId[][]) {
      for (const minutes of [15, 18, 20, 25, 30, 35, 40, 45, 60]) {
        for (const gym of [true, false]) {
          const s = athlete(skills, {}, { gym })
          const p = planToday(s, { now: MON, minutes })
          if (!p.skill) continue
          expect(p.skill.minutes, `${skills} ${minutes} ${gym}`).toBeGreaterThanOrEqual(MIN_SKILL_MINUTES[Math.min(3, p.skill.skills.length) as 1 | 2 | 3])
          const built = finalizeWorkout(s, { source: 'auto', minutes: p.skill.minutes, skills: p.skill.skills }, undefined, MON)
          expect(built.minutes, `${skills} ${minutes} ${gym}`).toBeLessThanOrEqual(p.skill.minutes + 1)
          expect(p.skill.minutes + (p.gym?.minutes ?? 0)).toBeLessThanOrEqual(minutes)
        }
      }
    }
  })
})

describe('what each skill actually gets', () => {
  it('calls a skill hard only where the session it starts gives it three or more sets of its hold', () => {
    const s = athlete(['planche', 'frontlever', 'handstand'], { minutesByDay: [45, 45, 30, 45, 30, 45, 60] })
    for (const minutes of [40, 45, 55, 60, 75, 90]) {
      const day = planWeekAhead(s, MON, { todayMinutes: minutes }).days[0]
      const block = day.plan.skill
      if (!block) continue
      const w = finalizeWorkout(s, { source: 'auto', minutes: block.minutes, skills: block.skills }, undefined, MON)
      const sets = { push: 0, pull: 0 }
      for (const b of w.blocks) {
        if (b.section !== 'main' && b.section !== 'strength') continue
        const f = skillSetLoading(b.exerciseId, b.section)?.straightArm
        if (f) sets[f] += b.sets
      }
      for (const f of block.hard ?? []) expect(sets[f], `${minutes}: ${f} called hard`).toBeGreaterThanOrEqual(3)
      // A family the session gives fewer than three sets is never called hard.
      for (const f of ['push', 'pull'] as const) if (sets[f] < 3) expect(block.hard ?? [], `${minutes}: ${f}`).not.toContain(f)
      // Every skill a line names is in the session.
      for (const line of day.why) {
        for (const [name, skill] of [['Handstand', 'handstand'], ['Front lever', 'frontlever'], ['Planche', 'planche']] as const) {
          if (line.startsWith(`${name}:`)) expect(block.skills, `${minutes}: ${line}`).toContain(skill)
        }
      }
      // The session the card starts holds every skill the block lists.
      if (block.skills.length > 1) for (const skill of block.skills) expect(w.blocks.some((b) => b.skill === skill), `${minutes}: ${skill} in the session`).toBe(true)
    }
  })
})

describe('a gym block that would build empty', () => {
  it('never plans a focus that holds fewer than two movements at the place, and gives the time to skills when none does', () => {
    const home: GymLocation = { id: 'h', name: 'Home', unit: 'kg', equipment: ['pullup-bar'], updatedAt: 1 }
    const base = athlete(['planche'], { minutesByDay: [60, 60, 60, 60, 60, 60, 60], musclesOff: ['quads', 'hamstrings', 'glutes', 'calves', 'adductors'] })
    const s: AppState = {
      ...base,
      gym: { ...base.gym!, locations: [home], activeLocationId: 'h' },
      symptoms: [{ id: 'x', at: MON - 2 * HOUR, joints: 'pain', regions: ['wrist', 'elbow', 'shoulder'], source: 'check-in' }],
    }
    const week = planWeekAhead(s, MON)
    for (const d of week.days) {
      if (!d.plan.gym) continue
      const b = buildGymSession({ location: home, minutes: d.plan.gym.minutes, focus: d.plan.gym.focus, sessions: [], youth: true, avoidJoints: d.plan.gym.avoidJoints, volumeFactor: d.plan.gym.volumeFactor, musclesOff: d.plan.gym.musclesOff, now: d.at })
      expect(b.fits && b.items.length >= 2, `${d.day} ${d.plan.gym.focus}`).toBe(true)
    }
    const today = week.days[0].plan
    if (!today.gym) expect(today.skill?.minutes ?? 0).toBe(today.minutes)
  })
})

describe('a logged activity and the sport week', () => {
  const game = { weekday: 6, kind: 'game' as const, minutes: 90, rpe: 9, legs: true, hour: 15 }
  const sat = at(5, 9)
  const pe: OutsideActivity = { id: 'pe', at: sat, kind: 'pe', minutes: 30, rpe: 3, legs: false, updatedAt: sat }
  it('keeps the scheduled game when a light PE class is logged that day, and lets a practice log stand in for it', () => {
    const s = athlete(['planche'], { sportSchedule: [game] })
    const kinds = (acts: OutsideActivity[]) => sportBetween({ ...s.gym!, activities: acts }, at(5, 0), at(6, 0)).map((e) => e.kind)
    expect(kinds([pe])).toEqual(['pe', 'game'])
    expect(kinds([{ ...pe, kind: 'practice', rpe: 6, legs: true }])).toEqual(['practice'])
    expect(kinds([{ ...pe, kind: 'game' }])).toEqual(['game'])
    // Sunday after the game, PE logged or not: legs stay out of the gym.
    const logged = { ...s, gym: { ...s.gym!, activities: [pe] } }
    expect(planToday(logged, { now: at(6, 9), minutes: 60 }).gym?.musclesOff).toContain('quads')
  })
})

describe('deloads for an athlete who does not rate sets', () => {
  const weeks = (n: number, rpe?: number): GymSession[] =>
    Array.from({ length: n }, (_, w) =>
      [0, 2, 4].map((d) => {
        const t = at(-7 * (w + 1) + d, 17)
        return { id: `y${w}${d}`, locationId: 'a', startedAt: t, endedAt: t + HOUR, name: 'Gym', exercises: [{ exerciseId: 'goblet-squat', sets: Array.from({ length: 3 }, () => ({ kg: 20, reps: 10, at: t, ...(rpe ? { rpe } : {}) })) }] }
      }),
    ).flat()
  it('counts a week too thinly rated to judge as a hard one, so the built-in lighter week still comes', () => {
    const kid = (sessions: GymSession[]) => withGymSessions(athlete(['planche'], {}, { birthYear: 2013 }), sessions)
    expect(gymDeloadDue(kid(weeks(8)), MON).due).toBe(true)
    expect(gymDeloadDue(kid(weeks(2)), MON).due).toBe(false)
    // Rated easy weeks are judged, and are not hard.
    expect(gymDeloadDue(kid(weeks(8, 6)), MON).due).toBe(false)
    expect(gymDeloadDue(kid(weeks(8, 8)), MON).due).toBe(true)
  })

  it('counts calendar weeks across a daylight-saving change', () => {
    // The first local day of 2027 that is not 24 hours long (none in UTC: nothing to check there).
    let change: number | undefined
    for (let t = new Date(2027, 0, 1).getTime(); t < new Date(2027, 11, 1).getTime(); t = addDays(t, 1)) {
      if (addDays(t, 1) - t !== DAY) {
        change = t
        break
      }
    }
    if (change === undefined) return
    const W = weekStart(change)
    const startThis = addDays(W, 7)
    const now = startThis + 9 * HOUR
    const spring = addDays(change, 1) - change < DAY
    const session = (t: number, sets: number): GymSession => ({ id: `d${t}`, locationId: 'a', startedAt: t, endedAt: t + HOUR, name: 'Gym', exercises: [{ exerciseId: 'goblet-squat', sets: Array.from({ length: sets }, () => ({ kg: 20, reps: 10, rpe: 8, at: t })) }] })
    const mwf = (weekMonday: number) => [0, 2, 4].map((d) => session(addDays(weekMonday, d) + 17 * HOUR, 4))
    const sessions = [...mwf(addDays(W, -7)), ...mwf(addDays(W, -14))]
    // Spring forward: a Sunday 23:30 session belongs to the week before; one session in the changed week is not a hard week.
    // Fall back: a Monday 00:30 session belongs to the changed week, which then holds two.
    if (spring) sessions.push(session(W - 30 * 60_000, 4), session(addDays(W, 2) + 17 * HOUR, 8))
    else sessions.push(session(W + 30 * 60_000, 6), session(addDays(W, 2) + 17 * HOUR, 6))
    const kid = withGymSessions(athlete(['planche'], {}, { birthYear: 2013 }), sessions)
    expect(gymDeloadDue(kid, now).due).toBe(!spring)
  })
})

describe('copy that says only what is true', () => {
  it('does not promise to leave out a joint it cannot name', () => {
    const s: AppState = { ...athlete(['planche']), symptoms: [{ id: 'x', at: MON - 2 * HOUR, joints: 'pain', regions: ['other'], source: 'check-in' }] }
    const p = planToday(s, { now: MON, minutes: 60 })
    expect(p.gym?.avoidJoints).toEqual([])
    expect(p.reasons[0]).not.toMatch(/leaves out anything that loads it/)
    expect(p.reasons[0]).toMatch(/stays light/)
  })

  it('writes one week, and one full stop', () => {
    const s = athlete(['planche'])
    const pace = skillGoalPace(s, { id: 'g', skill: 'planche', stepId: 'advtuck', by: new Date(MON + 5 * DAY).toISOString().slice(0, 10) }, MON)
    expect(pace.text).not.toMatch(/\b1 weeks\b|\.\./)
  })
})
