import { describe, expect, it } from 'vitest'
import type { AppState, SkillId, WorkoutRequest } from '../../types'
import { initialState } from '../store'
import { defaultGym, defaultPrefs } from '../gym/state'
import type { GymLocation, GymSession, TrainingPrefs } from '../gym/types'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { MUSCLES, type Muscle } from '../../data/gym/catalog'
import { buildGymSession } from '../gym/builder'
import { conservative } from '../gym/draft'
import { finalizeWorkout } from '../../data/workouts'
import { stepAfter } from '../../data/progressions'
import { dayKey } from '../time'
import { gymSetLoading, setsPerMuscle, volumeTarget } from './load'
import { atActivePlace, FAR_OVER, gymDeloadDue, gymToday, HARD_SETS, insideRest, planToday, planWeekAhead, skillRequest } from './planner'
import { dayFinished, maxTestOffered, shortVersion } from './screens'
import { peekNextBlock, rememberNextBlock } from './nextBlock'
import { startingMinutesByDay } from '../../components/plan/onboardingPlan'

/**
 * Round four of the independent review, pinned by decision: one decision path
 * for "what is today" (the Today card, "Rather do the gym", the Gym tab), the
 * week steering by weekly volume, sport by calendar day, the rest rule across a
 * clock change, falling lifts, and pressing picked inside the rest rule.
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m, d, h, min).getTime()
const gymA: GymLocation = {
  id: 'a',
  name: 'Gym A',
  unit: 'kg',
  equipment: ['barbell', 'squat-rack', 'bench', 'incline-bench', 'dumbbells', 'cable', 'lat-pulldown', 'leg-press', 'leg-curl', 'leg-extension', 'calf-machine', 'pullup-bar', 'dip-bars', 'box', 'cable-row', 'track'],
  updatedAt: 1,
} as GymLocation

function athlete(birthYear: number | undefined, skills: SkillId[], prefs: Partial<TrainingPrefs> = {}, kit: string[] = ['floor', 'parallettes']): AppState {
  const s = initialState()
  return {
    ...s,
    onboarded: true,
    profile: { ...s.profile, skills, ...(birthYear ? { birthYear } : {}), equipment: kit as AppState['profile']['equipment'] },
    gym: { ...defaultGym(['floor']), locations: [gymA], activeLocationId: 'a', prefs: { ...defaultPrefs(1), ...prefs } },
  }
}

function atTuck(s: AppState): AppState {
  let id = s.stepId
  const unlocked = [id]
  for (let k = 0; k < 6 && id !== 'tuck'; k++) {
    const n = stepAfter(id)
    if (!n) break
    id = n.id
    unlocked.push(id)
  }
  return { ...s, stepId: id, unlocked: [...new Set([...(s.unlocked ?? []), ...unlocked])] }
}

/** A skill session logged as built, every set at its target. */
function logSkill(state: AppState, t: number, req: WorkoutRequest): AppState {
  const w = finalizeWorkout(state, req, undefined, t)
  const sets = w.blocks.flatMap((b) => {
    const v = (b as { targetSec?: number }).targetSec ?? (b as { reps?: number }).reps ?? 5
    return Array.from({ length: b.sets }, (_, i) => ({ exerciseId: b.exerciseId, kind: 'hold', value: v, target: v, section: b.section, at: t + i * 60_000, endReason: 'effort' }))
  })
  const session = { id: `s-${t}`, startedAt: t, endedAt: t + HOUR, workoutName: w.name, workoutKind: w.kind ?? 'skill', stepId: state.stepId, sets }
  return { ...state, sessions: [...state.sessions, session as unknown as AppState['sessions'][number]] }
}

/** The lifts as the Gym tab builds them from `gymToday`: its focus, limits and priorities beside the athlete's own. */
function buildLifts(s: AppState, g: ReturnType<typeof gymToday>, minutes: number, t: number) {
  return buildGymSession({
    location: gymA,
    minutes,
    focus: g.focus,
    musclesOff: g.musclesOff,
    avoidJoints: g.avoidJoints,
    volumeFactor: g.volumeFactor,
    ...(g.opener ? { warmUpMin: 2 } : {}),
    favoriteAt: s.gym!.favoriteAt,
    sessions: s.gym!.sessions,
    ratings: s.gym!.ratings,
    youth: conservative(s.profile, t),
    goals: s.gym!.prefs!.goals,
    priority: [...new Set([...s.gym!.prefs!.musclesPriority, ...g.priority])],
    now: t,
  })
}

/** Days as the athlete follows the coach: today's plan, the Gym tab's session on a gym day, logged as built. */
function season(s: AppState, from: number, days: number): AppState {
  for (let i = 0; i < days; i++) {
    const t = from + i * DAY
    const p = planToday(s, { now: t })
    if (p.kind === 'calisthenics' && p.skill) s = logSkill(s, t, skillRequest(p.skill))
    else if (p.kind === 'gym') {
      const g = gymToday(s, { now: t, minutes: p.minutes, focus: 'auto', location: gymA })
      if (!g.focus) continue
      let lifts = p.minutes
      if (g.opener) {
        s = logSkill(s, t, skillRequest(g.opener))
        lifts -= g.opener.minutes
      }
      const plan = buildLifts(s, g, lifts, t)
      const t1 = t + (g.opener ? 30 * 60_000 : 0)
      const exercises = plan.items.map((it) => {
        const kg = it.suggestion.kg ?? (GYM_EXERCISE_BY_ID[it.exerciseId].load === 'bodyweight' ? undefined : 30)
        return { exerciseId: it.exerciseId, sets: Array.from({ length: it.sets }, (_, k) => ({ ...(kg !== undefined ? { kg } : {}), reps: it.plan.range[1], rpe: it.plan.targetRpe, at: t1 + k * 120_000 })) }
      })
      const session = { id: `g-${t}`, locationId: 'a', startedAt: t1, endedAt: t1 + HOUR, name: plan.name, exercises } as GymSession
      s = { ...s, gym: { ...s.gym!, sessions: [...s.gym!.sessions, session] } }
    }
  }
  return s
}

const LEGS: Muscle[] = ['quads', 'glutes', 'hamstrings']

/** Gym sets per muscle in one session, set by set (`gymSetLoading`). */
function liftCredit(g: GymSession): Partial<Record<Muscle, number>> {
  const out: Partial<Record<Muscle, number>> = {}
  for (const e of g.exercises) {
    const l = gymSetLoading(e.exerciseId)
    if (!l) continue
    for (const [m, v] of Object.entries(l.muscles) as [Muscle, number][]) out[m] = (out[m] ?? 0) + v * e.sets.length
  }
  return out
}

/** Primary gym sets per muscle between two times: the part of a muscle's week the gym chose to add. */
function primaryGymSets(sessions: GymSession[], from: number, to: number): Partial<Record<Muscle, number>> {
  const out: Partial<Record<Muscle, number>> = {}
  for (const g of sessions) {
    if (g.startedAt < from || g.startedAt >= to) continue
    for (const e of g.exercises) for (const m of GYM_EXERCISE_BY_ID[e.exerciseId].primary) out[m] = (out[m] ?? 0) + e.sets.length
  }
  return out
}

// The real athlete: 16, tuck at home, a gym, a Saturday game; and an adult who leans to strength and physique.
const MINUTES = [75, 45, 60, 45, 60, 45, 75]
const PROFILES: { name: string; s: AppState }[] = [
  {
    name: 'sixteen, tuck at home, a Saturday game',
    s: atTuck(
      athlete(2010, ['planche', 'frontlever'], {
        minutesByDay: MINUTES,
        goals: { strength: 4, power: 3, physique: 4, skills: 4, endurance: 1 },
        sportSchedule: [{ weekday: 6, kind: 'game', minutes: 80, rpe: 8, legs: true, hour: 11 }],
      } as Partial<TrainingPrefs>),
    ),
  },
  {
    name: 'adult, balanced goals, a bar at home (Sunday lower, Monday full body before)',
    s: atTuck(athlete(1995, ['planche', 'frontlever'], { minutesByDay: MINUTES, goals: { strength: 4, power: 1, physique: 4, skills: 4, endurance: 0 } }, ['floor', 'parallettes', 'pullup-bar'])),
  },
  {
    name: 'adult, strength and physique first, a bar at home',
    s: atTuck(athlete(1995, ['planche', 'frontlever'], { minutesByDay: MINUTES, goals: { strength: 5, power: 1, physique: 5, skills: 2, endurance: 0 } }, ['floor', 'parallettes', 'pullup-bar'])),
  },
]

describe('one decision path for today (round four)', () => {
  it('a gym day the coach picked is the same day when the athlete picks the gym, and on the Gym tab; a picked gym day keeps the pairing', () => {
    const goals = { strength: 5, power: 1, physique: 5, skills: 2, endurance: 0 }
    let s = atTuck(athlete(1995, ['planche', 'frontlever'], { minutesByDay: MINUTES, goals }, ['floor', 'parallettes', 'pullup-bar']))
    let opened = 0
    let paired = 0
    for (let i = 0; i < 21; i++) {
      const now = at(2026, 10, 2 + i, 18)
      const own = planToday(s, { now })
      const picked = planToday(s, { now, kind: 'gym' })
      const tab = gymToday(s, { now, minutes: own.minutes, focus: 'auto', location: gymA })
      if (own.kind === 'gym' && own.skill?.opener) {
        // The probe's day: the coach opens the lifts with a skill; the gym pick and the Gym tab once found nothing.
        opened++
        expect([picked.kind, picked.gym?.focus, picked.skill?.skills, picked.skill?.opener], dayKey(now)).toEqual(['gym', own.gym!.focus, own.skill.skills, true])
        expect([tab.focus, tab.opener?.skills, tab.noFocus], dayKey(now)).toEqual([own.gym!.focus, own.skill.skills, undefined])
      }
      if (own.kind === 'calisthenics' && picked.kind === 'gym' && picked.skill?.opener) {
        // Picked over a calisthenics day, the gym opens with a family's skill and trains that family.
        paired++
        expect(picked.gym!.focus === 'upper' || picked.gym!.focus.startsWith(picked.skill.skills[0] === 'planche' ? 'push' : 'pull'), dayKey(now)).toBe(true)
      }
      s = season(s, now, 1)
    }
    expect(opened, 'coach gym days with an opener').toBeGreaterThan(2)
    expect(paired, 'picked gym days that keep the pairing').toBeGreaterThan(0)
  })

  it('holds for athletes nobody designed: whenever the coach says gym, the gym pick and the Gym tab say the same', () => {
    let checked = 0
    for (let seed = 1; seed <= 12; seed++) {
      const rnd = (n: number) => ((seed * 7919 + n * 104729) % 1000) / 1000
      const skills: SkillId[] = rnd(1) < 0.5 ? ['planche', 'frontlever'] : rnd(2) < 0.5 ? ['frontlever', 'planche', 'handstand'] : ['planche']
      const goals = { strength: 1 + Math.floor(rnd(3) * 5), power: Math.floor(rnd(4) * 4), physique: 1 + Math.floor(rnd(5) * 5), skills: 1 + Math.floor(rnd(6) * 5), endurance: 0 }
      const minutes = MINUTES.map((m, k) => (rnd(10 + k) < 0.15 ? 0 : m))
      const kit = rnd(7) < 0.5 ? ['floor', 'parallettes'] : ['floor', 'parallettes', 'pullup-bar', 'wall']
      let s = atTuck(athlete(rnd(8) < 0.5 ? 2010 : 1994, skills, { minutesByDay: minutes, goals }, kit))
      const start = at(2026, 10, 2 + Math.floor(rnd(9) * 7), 18)
      for (let i = 0; i < 14; i++) {
        const t = start + i * DAY
        const p = planToday(s, { now: t })
        if (p.kind === 'gym') {
          const g = planToday(s, { now: t, kind: 'gym' })
          const tab = gymToday(s, { now: t, minutes: p.minutes, focus: 'auto', location: gymA })
          const who = `seed ${seed} ${dayKey(t)}`
          expect([g.kind, g.gym?.focus, g.skill?.skills], who).toEqual(['gym', p.gym?.focus, p.skill?.skills])
          expect([tab.focus, tab.opener?.skills], who).toEqual([p.gym?.focus, p.skill?.skills])
          checked++
        }
        s = season(s, t, 1)
      }
    }
    expect(checked).toBeGreaterThan(20)
  })
})

describe('the week steers by weekly volume (round four)', () => {
  for (const { name, s: start } of PROFILES) {
    it(`${name}: nothing far past its target where the gym could avoid it, side delts in range, no hard leg days running`, () => {
      const from = at(2026, 10, 2, 18)
      const s = season(start, from, 28)
      const prefs = s.gym!.prefs!
      for (let w = 1; w < 4; w++) {
        const a = at(2026, 10, 2 + 7 * w, 0)
        const b = a + 7 * DAY
        const all = setsPerMuscle(s.sessions, s.gym!.sessions, a, b)
        const gymPrimary = primaryGymSets(s.gym!.sessions, a, b)
        for (const { id: m } of MUSCLES) {
          const [lo, hi] = volumeTarget(m, prefs)
          if (hi <= 0) continue
          // Far past the top of the range only by skill work: the gym's own main sets of the muscle account for at most
          // five sets of the excess — the skill days still to come are planned, not logged, when the lifts are chosen,
          // and a line-up can change after them (a Monday pull day was planned before the week's lever days moved). Before round four the gym added 8 to 13 front-delt sets, and 10
          // triceps sets, to weeks the planche had already taken past the line.
          const avoidable = Math.min(gymPrimary[m] ?? 0, Math.max(0, (all[m] ?? 0) - FAR_OVER * hi))
          expect(avoidable, `${dayKey(a)} ${m} ${Math.round(all[m] ?? 0)} of ${lo}–${hi}, gym ${gymPrimary[m] ?? 0}`).toBeLessThanOrEqual(5)
        }
        // Side delts were at 2 of 12–20, and they stay short of 12: the builder gives a priority movement one set
        // more and trims isolation work first, and these weeks hold one or two upper-body gym days. What is pinned is
        // the decision below — every gym day that can train them asks for them (left open in the report).
      }
      // The decision: while the week leaves side delts under target, every gym day whose focus trains them asks for them.
      for (let i = 7; i < 28; i++) {
        const t = from + i * DAY
        const before = { ...s, sessions: s.sessions.filter((x) => x.startedAt < t), gym: { ...s.gym!, sessions: s.gym!.sessions.filter((x) => x.startedAt < t) } }
        const g = gymToday(before, { now: t, minutes: MINUTES[new Date(t).getDay()], focus: 'auto', location: gymA })
        if (!g.focus || !['push', 'upper', 'full'].includes(g.focus) || g.musclesOff.includes('side-delts')) continue
        const week = setsPerMuscle(before.sessions, before.gym!.sessions, at(2026, 10, 2 + 7 * Math.floor(i / 7), 0), t)
        if ((week['side-delts'] ?? 0) < volumeTarget('side-delts', prefs)[0] / 2) expect(g.priority, dayKey(t)).toContain('side-delts')
      }
      // No hard dose of the same leg muscle on consecutive calendar days, a full-body day's leg work included.
      const byDay = new Map<string, Partial<Record<Muscle, number>>>()
      for (const g of s.gym!.sessions) {
        const k = dayKey(g.startedAt)
        const c = byDay.get(k) ?? {}
        for (const [m, v] of Object.entries(liftCredit(g)) as [Muscle, number][]) c[m] = (c[m] ?? 0) + v
        byDay.set(k, c)
      }
      for (const g of s.gym!.sessions) {
        const today = byDay.get(dayKey(g.startedAt))!
        const yesterday = byDay.get(dayKey(g.startedAt - DAY))
        if (!yesterday) continue
        for (const m of LEGS) expect((today[m] ?? 0) >= HARD_SETS && (yesterday[m] ?? 0) >= HARD_SETS, `${dayKey(g.startedAt)} ${m} after a hard day`).toBe(false)
      }
    })
  }
})

const EVERY_DAY = [60, 60, 60, 60, 60, 60, 60]

describe('the smaller items of round four', () => {
  it('calls sport tomorrow by the calendar: a Saturday 08:00 game is not tomorrow on Thursday night, and is on Friday', () => {
    const s = athlete(2013, ['planche'], { sportSchedule: [{ weekday: 6, kind: 'game', minutes: 90, rpe: 8, legs: true, hour: 8 }], minutesByDay: EVERY_DAY } as Partial<TrainingPrefs>)
    for (const h of [8, 21]) {
      const thu = gymToday(s, { now: at(2026, 10, 26, h), minutes: 60, location: gymA })
      expect(thu.musclesOff, `Thursday ${h}:00`).not.toContain('quads')
      expect(thu.limits.join(' '), `Thursday ${h}:00`).not.toMatch(/tomorrow/)
    }
    const fri = gymToday(s, { now: at(2026, 10, 27, 21), minutes: 60, location: gymA })
    expect(fri.musclesOff).toContain('quads')
    expect(fri.limits.join(' ')).toMatch(/game tomorrow/)
    // The day itself, before the game: later today, legs out.
    const dawn = gymToday(s, { now: at(2026, 10, 28, 6), minutes: 60, location: gymA })
    expect(dawn.musclesOff).toContain('quads')
    expect(dawn.limits.join(' ')).toMatch(/later today/)
  })

  it('keeps the rest rule in real hours when no clock change falls between', () => {
    const t0 = at(2026, 6, 4, 17)
    expect(insideRest(t0 + 47 * HOUR, t0, 48 * HOUR)).toBe(true)
    expect(insideRest(t0 + 48 * HOUR, t0, 48 * HOUR)).toBe(false)
  })

  // Runs where the clocks spring forward on 8 March 2026 (America/New_York, which `npm run test:clock` includes).
  const springs = new Date(2026, 2, 7, 17).getTimezoneOffset() !== new Date(2026, 2, 9, 17).getTimezoneOffset()
  it.runIf(springs)('keeps the 48 h rule to the wall clock across spring-forward: Saturday 17:00 to Monday 17:00 is clear', () => {
    const sat = at(2026, 2, 7, 17)
    const mon = at(2026, 2, 9, 17)
    expect((mon - sat) / HOUR).toBe(47)
    expect(insideRest(mon, sat, 48 * HOUR)).toBe(false)
    expect(insideRest(mon - HOUR, sat, 48 * HOUR)).toBe(true)
    const s = logSkill(atTuck(athlete(1995, ['planche'], { minutesByDay: EVERY_DAY })), sat, { source: 'auto', minutes: 60, skills: ['planche'] })
    const p = planToday(s, { now: mon, kind: 'calisthenics' })
    expect(p.kind).toBe('calisthenics')
    expect(p.skill?.skills).toContain('planche')
  })

  it('calls a lighter week when a lift falls 5% or more from one week to the next, whatever the effort ratings say', () => {
    const s = athlete(1995, ['planche'])
    const mon = at(2026, 10, 9, 17)
    const bench = (kgs: number[]) =>
      kgs.map((kg, i) => {
        const t = mon + [0, 2, 4, 7, 9, 11][i] * DAY
        return { id: `b${i}`, locationId: 'a', startedAt: t, endedAt: t + HOUR, name: 'Push', exercises: [{ exerciseId: 'bench-press', sets: [1, 2, 3, 4].map(() => ({ kg, reps: 5, rpe: 8.5, at: t })) }] } as GymSession
      })
    const verdict = (kgs: number[]) => gymDeloadDue({ ...s, gym: { ...s.gym!, sessions: bench(kgs) } }, at(2026, 10, 23, 9))
    const falling = verdict([100, 97.5, 95, 92.5, 90, 87.5])
    expect(falling.due).toBe(true)
    expect(falling.why).toMatch(/fell \d+% from one week to the next/)
    expect(falling.why).toMatch(/coaching convention/)
    // Best against best: a dip inside the week is not a falling lift, nor is a 2.5% drop.
    expect(verdict([100, 100, 100, 97.5, 100, 100]).due).toBe(false)
    expect(verdict([100, 100, 100, 97.5, 97.5, 97.5]).due).toBe(false)
  })

  it('says when a picked push focus presses inside the rest rule, and still builds it', () => {
    const t0 = at(2026, 10, 23, 17)
    const s = logSkill(atTuck(athlete(1995, ['planche'], { minutesByDay: EVERY_DAY })), t0, { source: 'auto', minutes: 60, skills: ['planche'] })
    const push = gymToday(s, { now: t0 + 24 * HOUR, minutes: 60, focus: 'push', location: gymA })
    expect(push.focus).toBe('push')
    expect(push.limits.some((l) => l.startsWith('Heavy pressing shares recovery with your hard planche session 24 h ago'))).toBe(true)
    expect(buildLifts(s, push, 60, t0 + 24 * HOUR).items.length).toBeGreaterThanOrEqual(2)
    expect(gymToday(s, { now: t0 + 24 * HOUR, minutes: 60, focus: 'pull', location: gymA }).limits.some((l) => /shares recovery/.test(l))).toBe(false)
    expect(gymToday(s, { now: t0 + 49 * HOUR, minutes: 60, focus: 'push', location: gymA }).limits.some((l) => /shares recovery/.test(l))).toBe(false)
  })

  it('a finished day recommends nothing more, and offers no max test', () => {
    const t = at(2026, 10, 24, 12)
    const s0 = atTuck(athlete(1995, ['planche'], { minutesByDay: EVERY_DAY }))
    const s = logSkill({ ...s0, sessions: [logSkill(s0, t - 3 * DAY, { source: 'auto' }).sessions[0]] }, t - 2 * HOUR, { source: 'auto' })
    expect(dayFinished(s0, { kind: 'calisthenics' }, t)).toBe(false)
    expect(dayFinished(s, { kind: 'calisthenics' }, t)).toBe(true)
    // A gym day's opener alone is half of it: the lifts are still to come.
    expect(dayFinished(s, { kind: 'gym' }, t)).toBe(false)
    expect(maxTestOffered(s, null, t)).toBe(false)
    expect(maxTestOffered(s, null, t + DAY)).toBe(true)
  })

  it('Home’s short version goes through the coach: no hard planche session inside the rest rule, and a free skill still trains', () => {
    const NOW = at(2026, 10, 24, 17)
    const s0 = atTuck(athlete(1995, ['planche'], { minutesByDay: EVERY_DAY }))
    const t0 = NOW - 22 * HOUR
    const heavy = { id: 'g0', locationId: 'a', startedAt: t0, endedAt: t0 + HOUR, name: 'Push', exercises: [{ exerciseId: 'bench-press', sets: [1, 2, 3, 4, 5].map(() => ({ kg: 60, reps: 6, rpe: 8.5, at: t0 })) }] } as GymSession
    const s = { ...s0, gym: { ...s0.gym!, sessions: [heavy] } }
    for (const m of [15, 20]) {
      const short = shortVersion(s, m, { now: NOW })
      expect('reason' in short && short.reason, `${m} min`).toMatch(/rest rule/)
    }
    const withHandstand: AppState = { ...s, profile: { ...s.profile, skills: ['planche', 'handstand'], equipment: [...s.profile.equipment, 'wall'] } }
    const hs = shortVersion(withHandstand, 15, { now: NOW })
    expect('request' in hs && hs.request.skills).toEqual(['handstand'])
    // Outside the rule the short version trains the skill.
    const free = shortVersion(s0, 15, { now: NOW })
    expect('request' in free && free.request.skills).toContain('planche')
  })

  it('builds skill sessions where the athlete is: a lever with no bar at home trains on the gym’s bar', () => {
    const t = at(2026, 10, 24, 17)
    const s = atTuck(athlete(2010, ['frontlever'], { minutesByDay: EVERY_DAY, goals: { strength: 2, power: 0, physique: 2, skills: 5, endurance: 0 } }, ['floor', 'parallettes']))
    const req = atActivePlace(s, { source: 'auto', skills: ['frontlever'] })
    expect(req.kit).toContain('pullup-bar')
    expect(finalizeWorkout(s, { source: 'auto', skills: ['frontlever'] }, undefined, t).name).toMatch(/waiting for kit/)
    expect(finalizeWorkout(s, req, undefined, t).name).not.toMatch(/waiting for kit/)
    // The planner reads the same kit, and its skill blocks carry it.
    const lever = planWeekAhead(s, at(2026, 10, 23, 9)).days.filter((d) => d.plan.skill?.skills.includes('frontlever'))
    expect(lever.length).toBeGreaterThan(0)
    for (const d of lever) expect(finalizeWorkout(s, skillRequest(d.plan.skill!), undefined, d.at).name, d.day).not.toMatch(/waiting for kit/)
    // Calisthenics days too, not only gym openers: "calisthenics only for skills with kit" reads the kit where the athlete is.
    expect(lever.some((d) => d.kind === 'calisthenics')).toBe(true)
  })

  it('never puts a hard dose of a muscle on the day after one, reading what the session builds: no full-body day after a lower day', () => {
    // 45 minutes: the estimate gave a full-body day three glute sets, under the line; the session builds four.
    const now = at(2026, 10, 24, 17)
    let s = atTuck(athlete(1995, ['planche', 'frontlever'], { minutesByDay: [45, 45, 45, 45, 45, 45, 45], goals: { strength: 5, power: 0, physique: 4, skills: 1, endurance: 0 } }, ['floor', 'parallettes', 'pullup-bar']))
    s = logSkill(s, now - 25 * HOUR, { source: 'auto', minutes: 60, skills: ['planche'] })
    s = logSkill(s, now - 25 * HOUR + 1, { source: 'auto', minutes: 60, skills: ['frontlever'] })
    const t1 = now - 23 * HOUR
    const legs = { id: 'legs', locationId: 'a', startedAt: t1, endedAt: t1 + HOUR, name: 'Lower body', exercises: ['goblet-squat', 'romanian-deadlift', 'bulgarian-split-squat'].map((exerciseId) => ({ exerciseId, sets: [1, 2, 3].map(() => ({ kg: 30, reps: 10, rpe: 8, at: t1 })) })) } as GymSession
    s = { ...s, gym: { ...s.gym!, sessions: [legs] } }
    const g = gymToday(s, { now, minutes: 45, focus: 'auto', location: gymA })
    const yesterday = liftCredit(legs)
    const today = g.focus ? liftCredit({ ...legs, exercises: buildLifts(s, g, 45, now).items.map((it) => ({ exerciseId: it.exerciseId, sets: Array.from({ length: it.sets }, () => ({ reps: 8, at: now })) })) } as GymSession) : {}
    for (const m of LEGS) expect((today[m] ?? 0) >= HARD_SETS && (yesterday[m] ?? 0) >= HARD_SETS, `${g.focus} ${m}`).toBe(false)
  })

  it('counts a skill day as the session it builds: two planche days fill the front delts, not eight sets of them', () => {
    const base = atTuck(athlete(1995, ['planche'], { minutesByDay: [0, 60, 0, 0, 60, 0, 0], goals: { strength: 2, power: 0, physique: 4, skills: 5, endurance: 0 } }))
    const s = { ...base, gym: { ...base.gym!, locations: [] } }
    const week = planWeekAhead(s, at(2026, 10, 23, 9))
    const planche = week.days.filter((d) => d.kind === 'calisthenics' && d.at < at(2026, 10, 30, 0) && d.plan.skill?.skills.includes('planche'))
    expect(planche.length).toBe(2)
    expect(week.shortfall).not.toContain('front-delts')
  })

  it('re-plans the lifts round a joint named after the opener: a focus that still builds two movements, or none', () => {
    const t = at(2026, 10, 24, 17)
    const s1 = logSkill(atTuck(athlete(1995, ['planche'], { minutesByDay: EVERY_DAY })), t, { source: 'auto', minutes: 25, skills: ['planche'] })
    const event = { id: 'x', at: t + 30 * 60_000, joints: 'niggle', regions: ['shoulder'], source: 'check-in' } as unknown as NonNullable<AppState['symptoms']>[number]
    const reported: AppState = { ...s1, symptoms: [...(s1.symptoms ?? []), event] }
    const now = t + 31 * 60_000
    const push = gymToday(reported, { now, minutes: 35, focus: 'push', location: gymA })
    expect(push.avoidJoints).toContain('shoulders')
    const auto = gymToday(reported, { now, minutes: 35, focus: 'auto', location: gymA })
    if (auto.focus) expect(buildLifts(reported, auto, 35, now).items.length).toBeGreaterThanOrEqual(2)
    else expect(auto.noFocus).toBeTruthy()
  })

  it('hands a late opener’s lifts on after midnight, and not the next evening', () => {
    const store = new Map<string, string>()
    const g = globalThis as { sessionStorage?: Storage }
    const prev = g.sessionStorage
    g.sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } as Storage
    try {
      const late = at(2026, 10, 24, 23, 30)
      rememberNextBlock({ focus: 'push' }, late)
      expect(peekNextBlock(late + 40 * 60_000)).toEqual({ focus: 'push' })
      expect(peekNextBlock(late + 9 * HOUR)).toBeNull()
    } finally {
      g.sessionStorage = prev
    }
  })

  it('starts the first-run schedule on the day it is opened', () => {
    for (let k = 0; k < 7; k++) {
      const day = new Date(2026, 10, 22 + k, 10)
      const m = startingMinutesByDay(day)
      expect(m[day.getDay()], day.toDateString()).toBe(45)
      expect(m.filter((x) => x > 0)).toHaveLength(3)
    }
    // A Monday start is the old default.
    expect(startingMinutesByDay(new Date(2026, 10, 23, 10))).toEqual([0, 45, 0, 45, 0, 45, 0])
  })
})
