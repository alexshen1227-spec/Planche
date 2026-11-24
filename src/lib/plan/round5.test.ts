import { describe, expect, it } from 'vitest'
import type { AppState, SkillId, StepId, WorkoutRequest } from '../../types'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { finalizeWorkout } from '../../data/workouts'
import { applySession } from '../engine'
import { buildGymSession } from '../gym/builder'
import type { GymSession } from '../gym/types'
import { sessionFromWorkout } from '../skillLoop'
import { reducer } from '../store'
import { addDays, dayKey, weekStart } from '../time'
import {
  FAMILY_SESSIONS_OTHER,
  gymPlaceOf,
  gymToday,
  insideRest,
  insideRestRule,
  LEG_DAY_EVERY_DAYS,
  openerMinutesFor,
  planToday,
  planWeekAhead,
  skillFamily,
  skillRequest,
  type WeekAhead,
} from './planner'
import { dayReadiness } from './readiness'
import { holdRestWindow, recentGymWork, restWindow } from './restWindow'
import { sanitizePrefs } from '../gym/state'
import { GYM_PLACE, HOME_KIT, makeAthlete, SPORT_WEEK, type AthleteCfg } from './wholeAthleteLoop'

/**
 * Round five, pinned by decision: the first priority gets every session its
 * rest rule allows on the training days, each carrying its key hold's kept
 * dose, and the rest fill the days it cannot use; following the plan does not
 * change it; a push day keeps its press; short days take turns; the rest rule
 * counts days the way the plan does; effort read with the loads; an opener is
 * offered once; each kind of day is planned where it happens; a pain day says
 * what it trains; the legs get the week's last day for them.
 */

const HOUR = 3_600_000
const MON = new Date(2026, 9, 5, 17).getTime()
const at = (day: number, hour = 17, min = 0) => new Date(2026, 9, 5 + day, hour, min).getTime()

const GOALS = { strength: 3, power: 2, physique: 4, skills: 5, endurance: 1 }
const teen = (prefs: AthleteCfg['prefs'] = {}, over: Partial<AthleteCfg> = {}): AppState =>
  makeAthlete({
    skills: ['planche', 'frontlever', 'handstand'],
    birthYear: 2012,
    steps: { planche: 'tuck' as StepId, frontlever: 'fl-tuck' as StepId, handstand: 'hs-wall' as StepId },
    prefs: { goals: GOALS, sportSchedule: SPORT_WEEK, ...prefs },
    ...over,
  })
const alone = (prefs: AthleteCfg['prefs'] = {}): AppState =>
  makeAthlete({ skills: ['planche'], birthYear: 2012, steps: { planche: 'tuck' as StepId }, prefs: { goals: { strength: 0, power: 0, physique: 0, skills: 5, endurance: 0 }, sportSchedule: SPORT_WEEK, ...prefs } })

/** The days a week gives the first priority: it leads the calisthenics day, or opens the gym day. */
const firstDays = (week: WeekAhead, skill: SkillId = 'planche') =>
  week.days.filter((d) => d.plan.skill?.skills[0] === skill && (d.plan.kind === 'calisthenics' || d.plan.skill.opener)).map((d) => d.day)

/** A skill session done as the coach built it, saved through the engine. */
function doSkill(state: AppState, request: WorkoutRequest, t: number, hold = 12): AppState {
  const workout = finalizeWorkout(state, request, undefined, t)
  return applySession(state, sessionFromWorkout(state, workout, workout.lineup ?? [], t, `s-${t}`, () => hold)).next
}

/** A gym session of these lifts at the gym, every set at 30 kg (bodyweight ones without), saved through the store. */
function doLifts(state: AppState, ids: string[], t: number, sets = 3, rpe = 8): AppState {
  const session: GymSession = {
    id: `g-${t}`,
    locationId: GYM_PLACE.id,
    startedAt: t,
    endedAt: t + HOUR,
    name: 'Lifts',
    exercises: ids.map((exerciseId) => ({
      exerciseId,
      sets: Array.from({ length: sets }, (_, k) => ({ ...(GYM_EXERCISE_BY_ID[exerciseId].load === 'bodyweight' ? {} : { kg: 30 }), reps: 8, rpe, at: t + k * 120_000 })),
      targetRpe: 8,
    })),
  }
  return reducer(state, { type: 'GYM', op: { op: 'saveSession', session } })
}

describe('the first priority gets every session its rest rule allows (round five)', () => {
  it('as many days as the planche alone on the same days, under 48 h and 72 h, and the others fill the rest', () => {
    for (const rule of [48, 72]) {
      const mixed = planWeekAhead(teen({ straightArmRestHours: rule }), MON)
      const solo = planWeekAhead(alone({ straightArmRestHours: rule }), MON)
      const soloDays = solo.days.filter((d) => d.plan.kind === 'calisthenics').map((d) => d.day)
      expect(firstDays(mixed), `${rule} h`).toEqual(soloDays)
      // Its family's target is what the week holds, and the reason says that number.
      const push = mixed.frequency.find((f) => f.family === 'push')!
      expect(push.target, `${rule} h`).toBe(push.done + push.planned)
      // Every other training day goes to the other skills or the gym.
      for (const d of mixed.days) {
        if (d.plan.rest || firstDays(mixed).includes(d.day)) continue
        expect(d.plan.skill?.skills.includes('planche') ?? false, `${rule} h ${d.day}`).toBe(false)
        expect(Boolean(d.plan.gym) || Boolean(d.plan.skill), `${rule} h ${d.day} holds something`).toBe(true)
      }
    }
  })

  it('says the week’s own count beside its days, never a target the week does not hold', () => {
    const week = planWeekAhead(teen({ straightArmRestHours: 72 }), MON)
    const n = week.frequency.find((f) => f.family === 'push')!
    const said = week.days.flatMap((d) => d.plan.reasons).filter((r) => r.includes('every session your 72h rest rule allows'))
    expect(said.length).toBeGreaterThan(0)
    for (const r of said) expect(r, r).toContain(`— ${n.done + n.planned} sessions this week`)
    expect(week.days.flatMap((d) => d.plan.reasons).some((r) => /needs it to get 3 hard sessions/.test(r))).toBe(false)
  })

  it('reserves the long block for the first skill and gives unused front-lever minutes back to the lifts', () => {
    expect([38, 44, 45, 59, 60].map((m) => openerMinutesFor(true, m))).toEqual([18, 18, 25, 25, 25])
    expect([38, 45, 59, 60].map((m) => openerMinutesFor(false, m))).toEqual([18, 18, 18, 25])
    const s = teen()
    expect(gymToday(s, { now: MON, minutes: 45, focus: 'push', location: GYM_PLACE }).opener?.minutes).toBe(25)
    expect(gymToday(s, { now: MON, minutes: 45, focus: 'pull', location: GYM_PLACE }).opener).toMatchObject({ skills: ['frontlever'], minutes: 17 })
  })

  it('counts an opener short of its kept dose as half, and gives the planche its own day rather than one', () => {
    // At the lean, 18 minutes holds three of its four kept sets.
    const lean = teen({}, { steps: { planche: 'lean' as StepId, frontlever: 'fl-tuck' as StepId, handstand: 'hs-wall' as StepId } })
    const picked = gymToday(lean, { now: MON, minutes: 40, focus: 'push', location: GYM_PLACE })
    expect(picked.opener).toMatchObject({ skills: ['planche'], minutes: 18, half: true })
    // At the one-leg, even 25 minutes holds six of eight: its days are its own calisthenics days, never openers.
    const oneleg = teen({}, { steps: { planche: 'oneleg' as StepId, frontlever: 'fl-tuck' as StepId, handstand: 'hs-wall' as StepId } })
    const week = planWeekAhead(oneleg, MON)
    expect(firstDays(week).length).toBeGreaterThanOrEqual(3)
    expect(week.days.filter((d) => d.plan.skill?.opener && d.plan.skill.skills[0] === 'planche').map((d) => d.day)).toEqual([])
  })

  it('opens at most one gym day a week with it, and none when it has fewer than three days that week', () => {
    for (const [rule, most] of [
      [48, 1],
      [72, 0],
    ] as const) {
      const week = planWeekAhead(teen({ straightArmRestHours: rule }), MON)
      const byWeek = new Map<number, number>()
      for (const d of week.days) if (d.plan.skill?.opener && d.plan.skill.skills[0] === 'planche') byWeek.set(weekStart(d.at), (byWeek.get(weekStart(d.at)) ?? 0) + 1)
      for (const [wk, n] of byWeek) expect(n, `${rule} h, week of ${dayKey(wk)}`).toBeLessThanOrEqual(most)
    }
  })

  it('keeps hard pressing off the days around its days: pressing shares its day as an opener, or waits', () => {
    const cases: [number, AthleteCfg['prefs']][] = [
      [48, {}],
      [72, {}],
      [48, { minutesByDay: [60, 60, 60, 60, 60, 60, 60], goals: { strength: 4, power: 0, physique: 4, skills: 4, endurance: 0 } }],
    ]
    for (const [rule, prefs] of cases) {
      const week = planWeekAhead(teen({ straightArmRestHours: rule, ...prefs }), MON)
      const mine = week.days.filter((d) => firstDays(week).includes(d.day))
      for (const d of week.days) {
        const f = d.plan.gym?.focus
        if (!f || !['push', 'upper'].includes(f) || firstDays(week).includes(d.day)) continue
        for (const p of mine) expect(Math.abs(d.at - p.at), `${rule} h: ${d.day} ${f} beside ${p.day}`).toBeGreaterThanOrEqual(rule * HOUR - 2 * HOUR)
      }
    }
  })

  it('lets the lever partner its days only up to the lever’s own weekly sessions', () => {
    // Hour-long sessions, a bar at home, skills only: the lever beside the planche is a hard session of its own.
    let s = teen({ goals: { strength: 0, power: 0, physique: 0, skills: 5, endurance: 0 }, minutesByDay: [60, 60, 60, 60, 60, 60, 60] }, { kit: [...HOME_KIT, 'pullup-bar'] })
    s = { ...s, settings: { ...s.settings, sessionMinutes: 60 } }
    const week = planWeekAhead(s, MON)
    const beside = week.days.filter((d) => weekStart(d.at) === weekStart(MON) && firstDays(week).includes(d.day) && d.plan.skill!.skills.includes('frontlever'))
    expect(beside.length).toBeGreaterThan(0)
    for (const d of beside) expect(d.plan.skill!.hard, d.day).toContain('pull')
    expect(beside.length, beside.map((d) => d.day).join(' ')).toBeLessThanOrEqual(FAMILY_SESSIONS_OTHER)
  })

  it('lets another family partner its day only while that family is under its weekly sessions, and only as a hard session', () => {
    const week = planWeekAhead(teen(), MON)
    for (const d of week.days) {
      if (!firstDays(week).includes(d.day) || d.plan.kind !== 'calisthenics') continue
      if (d.plan.skill!.skills.includes('frontlever')) expect(d.plan.skill!.hard, d.day).toContain('pull')
    }
    const pull = week.frequency.find((f) => f.family === 'pull')
    const levers = week.days.filter((d) => weekStart(d.at) === weekStart(MON) && (d.plan.skill?.hard ?? []).includes('pull'))
    if (pull) expect(pull.planned).toBe(levers.length)
    expect(levers.filter((d) => d.plan.kind === 'calisthenics' && d.plan.skill!.skills[0] === 'planche').length).toBeLessThanOrEqual(FAMILY_SESSIONS_OTHER)
  })
})

describe('a first-priority day stays its own (round five)', () => {
  it('turns a gym day that cannot open with it into its calisthenics day, said as its day', () => {
    // Heavy triceps and side-delt work yesterday: today's push lifts would repeat the same muscles two days running,
    // so the gym day planned to open with the planche has no lifts — the day is the planche's own.
    const s = doLifts(teen(), ['overhead-cable-extension', 'db-lateral-raise'], MON - 24 * HOUR, 4)
    const today = planToday(s, { now: MON })
    expect(today.skill?.skills[0], today.reasons.join(' | ')).toBe('planche')
    if (today.kind === 'calisthenics') expect(today.reasons.some((r) => r.startsWith('Calisthenics today: the planche is your first priority')), today.reasons.join(' | ')).toBe(true)
  })
})

describe('following the plan does not change the plan (round five)', () => {
  it('a saved opener leaves today the gym day, lifts next, and moves no later planche day; nor do the lifts', () => {
    const s = teen()
    const plan = planToday(s, { now: MON })
    // A pressing day the planche opens: push, or (round six) upper when the week's planche days already take the front
    // delts and triceps past the steer's line, so a push day could not fill its time.
    expect([plan.kind, plan.skill?.skills, plan.skill?.opener]).toEqual(['gym', ['planche'], true])
    expect(['push', 'upper']).toContain(plan.gym?.focus)
    const before = firstDays(planWeekAhead(s, MON))
    const opened = doSkill(s, skillRequest(plan.skill!), MON)
    const mid = planWeekAhead(opened, MON + 30 * 60_000)
    expect([mid.days[0].plan.kind, mid.days[0].plan.gym?.focus, mid.days[0].plan.skill?.opener]).toEqual(['gym', plan.gym?.focus, true])
    expect(firstDays(mid)).toEqual(before)
    // The lifts, stamped when they start — after the opener.
    const lifted = doLifts(opened, ['db-bench-press', 'incline-db-press', 'db-lateral-raise'], MON + 40 * 60_000)
    expect(firstDays(planWeekAhead(lifted, MON + 2 * HOUR))).toEqual(before)
    // Wednesday at 17:00 is 47 hours after the lifts: the day the plan promised is the planche's.
    const wed = planToday(lifted, { now: at(2) })
    expect(wed.skill?.skills[0], wed.reasons.join(' | ')).toBe('planche')
  })

  it('plans today from the state as the day began: saving today’s planned opener changes nothing about today', () => {
    const s = teen()
    const plan = planToday(s, { now: MON })
    // The opener done, every set rated all-out: read as news, those ratings would make today's lifts a light day.
    const workout = finalizeWorkout(s, skillRequest(plan.skill!), undefined, MON)
    const logged = sessionFromWorkout(s, workout, workout.lineup ?? [], MON, 'opener', () => 12)
    const opened = applySession(s, { ...logged, sets: logged.sets.map((x) => ({ ...x, rpe: 9.5 })) }).next
    const later = MON + 30 * 60_000
    const strip = (w: WeekAhead) => w.days.map((d) => ({ kind: d.kind, plan: { ...d.plan, reasons: d.plan.reasons.filter((r) => !/today counts as|You trained/.test(r)) } }))
    expect(strip(planWeekAhead(opened, later))).toEqual(strip(planWeekAhead(s, later)))
    expect(planToday(opened, { now: later }).gym?.volumeFactor).toBe(plan.gym?.volumeFactor)
  })

  it('counts a logged session’s rest in calendar days, refusing only a genuinely short gap', () => {
    expect(insideRest(at(2), at(0, 17, 40), 48 * HOUR)).toBe(false)
    expect(insideRest(at(2, 7), at(0, 21), 48 * HOUR)).toBe(true)
    expect(insideRest(at(1, 23), at(0, 8), 48 * HOUR)).toBe(true)
  })

  it('honors a saved 48-hour minimum after a late lift across planning, custom workouts and hold tests', () => {
    const last = at(0, 20)
    const morning = at(2, 9, 15)
    const state = doLifts(alone({ minutesByDay: [0, 45, 0, 45, 0, 45, 0], sportSchedule: [], exactRestHours: true }), ['bench-press'], last, 4)
    state.gym!.prefs = sanitizePrefs(JSON.parse(JSON.stringify(state.gym!.prefs)))
    expect(state.gym!.prefs!.exactRestHours).toBe(true)
    expect(insideRestRule(state, ['planche'], morning)?.hours).toBe(37)
    expect(holdRestWindow(state, 'planche', last + 48 * HOUR - 1)?.hours).toBe(47)
    expect(recentGymWork(state, morning).push?.sets).toBe(4)
    expect(planWeekAhead(state, morning).days[0].plan.skill?.hard ?? []).not.toContain('push')
    expect(holdRestWindow(state, 'frontlever', morning)).toBeUndefined()
    const ready = last + 48 * HOUR
    expect(insideRestRule(state, ['planche'], ready)).toBeUndefined()
    expect(holdRestWindow(state, 'planche', ready)).toBeUndefined()
    expect(recentGymWork(state, ready).push).toBeUndefined()
    expect(planWeekAhead(state, ready).days[0].plan.skill?.hard).toContain('push')
    const exact = restWindow(state.gym!.prefs!)
    // Same local hour, two dates later, across the spring clock change.
    const fri = Date.parse('2026-03-06T17:00:00-08:00'), sun = Date.parse('2026-03-08T17:00:00-07:00')
    expect(exact.betweenPlans(fri, sun)).toBe(true)
    expect(exact.betweenPlans(fri, sun + HOUR)).toBe(false)
  })

  it('keeps the weekly goal’s spread when today’s session is the one it planned', () => {
    // No gym schedule: the weekly goal spreads the days.
    let s = teen()
    s = { ...s, gym: { ...s.gym!, prefs: undefined }, settings: { ...s.settings, weeklyGoal: 3 } }
    const week = planWeekAhead(s, MON).days.filter((d) => !d.plan.rest).map((d) => d.day)
    expect(week[0]).toBe(dayKey(MON))
    const done = doSkill(s, skillRequest(planToday(s, { now: MON }).skill!), MON)
    expect(planWeekAhead(done, MON + 2 * HOUR).days.filter((d) => !d.plan.rest).map((d) => d.day)).toEqual(week)
  })
})

describe('the gym side of round five', () => {
  it('a push day keeps its press when the week has plenty of front delts and triceps; the athlete’s own switch still keeps it out', () => {
    const lift = (extra: Partial<Parameters<typeof buildGymSession>[0]>) =>
      buildGymSession({ location: GYM_PLACE, minutes: 45, focus: 'push', sessions: [], youth: true, now: MON, ...extra }).items.map((it) => ({
        ...it,
        ex: GYM_EXERCISE_BY_ID[it.exerciseId],
      }))
    const steered = lift({ spare: ['front-delts', 'triceps'], priority: ['chest'] })
    const presses = steered.filter((it) => it.ex.pattern === 'horizontal-press' || it.ex.pattern === 'incline-press')
    expect(presses.length).toBe(1)
    expect(presses[0].sets).toBe(2)
    // Nothing else built on them: no overhead press, dip or triceps isolation.
    expect(steered.filter((it) => it.ex !== presses[0].ex && it.ex.primary.some((m) => m === 'front-delts' || m === 'triceps'))).toEqual([])
    expect(steered.some((it) => it.ex.pattern === 'chest-fly')).toBe(true)
    const off = lift({ musclesOff: ['front-delts', 'triceps'] })
    expect(off.some((it) => it.ex.primary.includes('front-delts') || it.ex.primary.includes('triceps'))).toBe(false)
  })

  it('a push day the week steers keeps a chest press while chest is under target', () => {
    // A week whose planche work has front delts and triceps far past their tops.
    let s = teen()
    for (const day of [-6, -4, -2]) s = doSkill(s, { source: 'auto', skills: ['planche'], minutes: 45 }, at(day))
    // The coach no longer picks a push day the week has spent (round six): the athlete's own pick of one is steered.
    const week = planWeekAhead(s, MON, { todayKind: 'gym', todayFocus: 'push' })
    const push = week.days.filter((d) => d.plan.gym?.focus === 'push')
    expect(push.length).toBeGreaterThan(0)
    for (const d of push) {
      const g = d.plan.gym!
      const built = buildGymSession({ location: GYM_PLACE, minutes: g.minutes, focus: 'push', sessions: [], youth: true, musclesOff: g.musclesOff, ...(g.spare ? { spare: g.spare } : {}), priority: g.priority ?? [], volumeFactor: g.volumeFactor, now: d.at })
      expect(built.items.some((it) => ['horizontal-press', 'incline-press'].includes(GYM_EXERCISE_BY_ID[it.exerciseId].pattern)), `${d.day} ${built.items.map((it) => it.exerciseId)}`).toBe(true)
      expect(g.musclesOff, d.day).not.toContain('front-delts')
    }
  })

  it('reads rising effort as fatigue only for the same loads, at or past the effort asked', () => {
    const now = at(28)
    const session = (day: number, kg: number, rpe: number, targetRpe: number): GymSession => ({
      id: `r-${day}-${kg}`,
      locationId: GYM_PLACE.id,
      startedAt: at(day),
      endedAt: at(day) + HOUR,
      name: 'Lifts',
      exercises: ['db-bench-press', 'chest-supported-row'].map((exerciseId) => ({
        exerciseId,
        targetRpe,
        sets: [0, 1, 2].map((k) => ({ kg, reps: 8, rpe, at: at(day) + k })),
      })),
    })
    const read = (recentKg: number, recentRpe: number, asked: number) => {
      const s = teen()
      const sessions = [session(8, 30, 6.3, asked), session(12, 30, 6.3, asked), session(20, recentKg, recentRpe, asked), session(24, recentKg, recentRpe, asked)]
      return dayReadiness({ ...s, gym: { ...s.gym!, sessions } }, now, { pain: false, niggle: false, deload: false, inSeason: false }).level
    }
    expect(read(30, 7.5, 7.5), 'same loads, at the effort asked').toBe('light')
    expect(read(35, 7.5, 7.5), 'heavier loads').not.toBe('light')
    expect(read(30, 7.3, 8), 'still under the effort asked').not.toBe('light')
  })

  it('offers no opener for a skill already trained today, light or not', () => {
    const s = teen()
    expect(planToday(s, { now: MON }).skill).toMatchObject({ skills: ['planche'], opener: true })
    // Two sets of the key hold and nothing else loaded: under the hard count, so no rest rule covers it.
    const w = finalizeWorkout(s, { source: 'auto', skills: ['planche'], minutes: 45 }, undefined, MON)
    const key = w.blocks.find((b) => b.section === 'main' && b.role === 'skill')!
    const short = { ...w, blocks: [...w.blocks.filter((b) => b.section === 'warmup' || b.section === 'cooldown'), { ...key, sets: 2 }] }
    const done = applySession(s, sessionFromWorkout(s, short, [], MON, 'short', () => 12)).next
    for (const focus of ['auto', 'push'] as const) {
      const g = gymToday(done, { now: MON + HOUR, minutes: 45, focus, location: GYM_PLACE })
      expect(g.opener, focus).toBeUndefined()
      expect(g.noOpener, focus).toMatch(/planche session earlier today/)
    }
  })

  it('gives the week’s last day the sport leaves the legs fresh to them, every other week at least', () => {
    // Practice on Tuesday and a game on Saturday: Monday is the only day around them for the legs. Sunday was the
    // planche's, so Monday is not.
    const sunday = doSkill(teen(), { source: 'auto', skills: ['planche'], minutes: 45 }, at(6))
    const week = planWeekAhead(sunday, at(7))
    const monday = week.days.find((d) => d.day === dayKey(at(7)))!
    expect(monday.plan.gym?.focus, monday.plan.reasons.join(' | ')).toBe('lower')
    expect(monday.plan.reasons.some((r) => r.startsWith('A gym day for your legs'))).toBe(true)
    // Legs trained in the gym four days ago: the front lever keeps its Monday.
    const legs = doLifts(sunday, ['goblet-squat', 'romanian-deadlift'], at(7) - 4 * 24 * HOUR)
    expect(LEG_DAY_EVERY_DAYS).toBeGreaterThan(4)
    expect(planWeekAhead(legs, at(7)).days[0].plan.gym?.focus).not.toBe('lower')
    // Sport every day but Sunday, Sunday a rest day: no day for the legs, and today says so.
    const busy = teen({ sportSchedule: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, kind: 'game' as const, minutes: 60, rpe: 8, legs: true, hour: 10 })), minutesByDay: [0, 45, 45, 45, 45, 45, 45] })
    expect(planToday(busy, { now: at(7) }).reasons.some((r) => r.startsWith('No day left this week leaves your legs fresh'))).toBe(true)
  })
})

describe('days planned where they happen, short days by turns, a pain day said plainly (round five)', () => {
  it('plans gym days at the gym with home set, and the lever only where its bar is', () => {
    const home = teen({}, { active: 'home' })
    expect(gymPlaceOf(home, MON)?.id).toBe(GYM_PLACE.id)
    const week = planWeekAhead(home, MON)
    for (const d of week.days) {
      if (d.plan.gym) expect(d.plan.gym.placeId, d.day).toBe(GYM_PLACE.id)
      const block = d.plan.skill
      if (!block?.skills.includes('frontlever')) continue
      // Built where the bar is: the gym's kit, and the block says so.
      expect(block.placeId, d.day).toBe(GYM_PLACE.id)
      expect(block.kit, d.day).toContain('pullup-bar')
    }
    expect(week.days.some((d) => d.plan.skill?.skills[0] === 'frontlever')).toBe(true)
    // With the gym set, a later calisthenics day is still at home: no gym kit unless it is planned there. Skills
    // only, so the lever has calisthenics days of its own: they are planned at the gym, and build there.
    for (const s of [teen(), teen({ goals: { strength: 0, power: 0, physique: 0, skills: 5, endurance: 0 } })]) {
      const gym = planWeekAhead(s, MON)
      for (const d of gym.days.slice(1)) {
        const block = d.plan.skill
        if (!block || block.opener) continue
        if (!block.placeId) expect(block.kit, d.day).toBeUndefined()
        if (block.skills.includes('frontlever')) expect(block.placeId, d.day).toBe(GYM_PLACE.id)
        expect(finalizeWorkout(s, skillRequest(block), undefined, d.at).name, `${d.day} ${block.skills}`).not.toMatch(/waiting for kit/i)
      }
    }
  })

  it('takes one-skill days by turns, the first priority on its own days', () => {
    // Skills only, so every day is a calisthenics day: the planche on its days, the lever and the handstand between.
    const twenty = { minutesByDay: [20, 20, 20, 20, 20, 20, 20], goals: { strength: 0, power: 0, physique: 0, skills: 5, endurance: 0 } }
    const week = planWeekAhead(teen(twenty), MON)
    const leads = week.days.filter((d) => d.plan.kind === 'calisthenics').map((d) => d.plan.skill!.skills[0])
    expect(leads).toContain('handstand')
    expect(leads).toContain('frontlever')
    expect(firstDays(week)).toEqual(planWeekAhead(alone(twenty), MON).days.filter((d) => d.plan.kind === 'calisthenics').map((d) => d.day))
    // A bar at home too: the lever and the handstand are both free on the planche's off days, and still take turns.
    const barred = planWeekAhead(teen(twenty, { kit: [...HOME_KIT, 'pullup-bar'] }), MON)
    const turns = barred.days.filter((d) => d.plan.kind === 'calisthenics' && !firstDays(barred).includes(d.day)).map((d) => d.plan.skill!.skills[0])
    expect(turns).toContain('handstand')
    expect(turns).toContain('frontlever')
  })

  it('names a pain day’s session for what it is: the pain-safe one, under its lead only', () => {
    // Wrist pain on Tuesday morning; Wednesday is the planche's day, and the session it builds is the pain-safe one.
    const s = reducer(teen(), { type: 'RECORD_SYMPTOM', event: { at: at(1, 9), joints: 'pain', regions: ['wrist'], source: 'check-in' } })
    const today = planToday(s, { now: at(2) })
    expect(today.kind).toBe('calisthenics')
    const built = finalizeWorkout(s, skillRequest(today.skill!), undefined, at(2))
    expect(built.id.startsWith('pain-safe-recovery')).toBe(true)
    expect(today.skill).toMatchObject({ skills: ['planche'], painSafe: true })
    expect(today.reasons.some((r) => r.startsWith("Today's skill session is the pain-safe recovery one"))).toBe(true)
    // Without the report the same day trains its line-up, and says nothing of the kind.
    const clear = planToday(teen(), { now: at(2) })
    expect(clear.skill?.painSafe).toBeUndefined()
  })

  it('keeps the home kit for skills that train at home: the handstand day is built from the athlete’s own list', () => {
    const week = planWeekAhead(teen({}, { active: 'home' }), MON)
    const hs = week.days.find((d) => d.plan.kind === 'calisthenics' && d.plan.skill!.skills[0] === 'handstand')
    if (hs) {
      expect(hs.plan.skill!.placeId).toBeUndefined()
      expect(finalizeWorkout(teen({}, { active: 'home' }), skillRequest(hs.plan.skill!), undefined, hs.at).name).not.toMatch(/waiting for kit/)
    }
    expect(HOME_KIT).toContain('wall')
    expect(skillFamily('handstand')).toBe('balance')
    expect(addDays(MON, 0)).toBe(MON)
  })
})
