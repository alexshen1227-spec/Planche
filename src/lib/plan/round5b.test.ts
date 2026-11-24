import { afterAll, describe, expect, it, vi } from 'vitest'
import type { AppState, EquipmentId, Session, SkillId, StepId, WorkoutRequest } from '../../types'
import type { Muscle } from '../../data/gym/catalog'
import { GYM_EXERCISES, GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { STEP_BY_ID } from '../../data/progressions'
import { finalizeWorkout, MAX_REQUEST_MINUTES, sessionBudget, todaysSession } from '../../data/workouts'
import { mixedSession } from '../../data/mixedSession'
import { buildPlan } from '../coach'
import { buildGymSession, type GymFocus } from '../gym/builder'
import type { GymLocation, GymSession } from '../gym/types'
import { todaysLineup } from '../lineup'
import { startingState } from '../skillLoop'
import { skillView, stepOfSkill } from '../skills'
import { dayKey } from '../time'
import { familyWorkingSets, HARD_GYM_FAMILY_SETS, LIGHT_PRESS_SPARE, pressedIn } from './load'
import { focusFamilies, planWeekAhead, skillFamily, skillRequest, type WeekAhead } from './planner'
import { GYM_PLACE, makeAthlete, runLoop, SPORT_WEEK, type AthleteCfg } from './wholeAthleteLoop'

/**
 * Round 5b of the fifth strict review: the gym keeps its pressing every week
 * beside the planche, and a time asked for is the time a session gets.
 */

const restoreClock = () => {
  if (process.env.FAKE_NOW) vi.setSystemTime(new Date(process.env.FAKE_NOW))
  else vi.useRealTimers()
}
afterAll(restoreClock)

/** A gym plan's pressing as `familyEvents` would count it once logged, one working set per planned set. */
const pressingSets = (items: readonly { exerciseId: string; sets: number }[]) =>
  familyWorkingSets(items.map((it) => ({ exerciseId: it.exerciseId, sets: Array.from({ length: it.sets }, () => ({ reps: 8 })) }))).push
/** A bench or incline press: the movement a pressing day is named for. */
const chestPress = (id: string) => ['horizontal-press', 'incline-press'].includes(GYM_EXERCISE_BY_ID[id]?.pattern ?? '')

const SMALL: GymLocation = { id: 'small', name: 'Small gym', unit: 'kg', equipment: ['dumbbells', 'bench', 'pullup-bar', 'dip-bars', 'cable'], updatedAt: 1 }
const HOME: GymLocation = { id: 'home', name: 'Home', unit: 'kg', equipment: ['floor', 'parallettes', 'wall', 'dip-bars', 'pullup-bar'], updatedAt: 1 }

describe('round 5b: light pressing is never a hard pressing session', () => {
  it('every pressing movement in the catalog leans on a muscle a light day spares', () => {
    const pressing = GYM_EXERCISES.filter((e) => familyWorkingSets([{ exerciseId: e.id, sets: [{ reps: 8 }] }]).push === 1)
    expect(pressing.length).toBeGreaterThan(30)
    const escapes = pressing.filter((e) => !e.primary.some((m) => LIGHT_PRESS_SPARE.includes(m))).map((e) => e.id)
    expect(escapes, 'a press, dip or shoulder press a light day would build in full').toEqual([])
    // Lateral raises and chest flies are not pressing: a light day keeps them.
    expect(LIGHT_PRESS_SPARE).not.toContain('side-delts')
    expect(LIGHT_PRESS_SPARE).not.toContain('chest')
  })

  it('a pressing day built with them spared presses one movement at two sets, whatever else it is given', () => {
    let built = 0
    let hardWithout = 0
    for (const focus of ['push', 'upper', 'full'] as GymFocus[])
      for (const location of [GYM_PLACE, SMALL, HOME])
        for (const minutes of [20, 30, 45, 60, 90])
          for (const volumeFactor of [0.6, 1, 1.15])
            for (const priority of [[], ['chest'], ['chest', 'chest-upper', 'front-delts', 'triceps']] as Muscle[][])
              for (const youth of [true, false]) {
                const input = { location, minutes, focus, sessions: [] as GymSession[], youth, priority, volumeFactor, goals: { strength: 3, power: 3, physique: 4, skills: 5, endurance: 1 }, now: Date.UTC(2026, 10, 23, 17) }
                const light = buildGymSession({ ...input, spare: [...LIGHT_PRESS_SPARE] })
                const where = `${focus} ${location.id} ${minutes}m x${volumeFactor} [${priority}] youth ${youth}: ${light.items.map((it) => `${it.exerciseId}x${it.sets}`)}`
                expect(pressingSets(light.items), where).toBeLessThan(HARD_GYM_FAMILY_SETS)
                expect(pressingSets(light.items), where).toBeLessThanOrEqual(2)
                // The day still presses when its place has a press it may use: one movement, no more.
                const presses = light.items.filter((it) => familyWorkingSets([{ exerciseId: it.exerciseId, sets: [{ reps: 8 }] }]).push === 1)
                expect(presses.length, where).toBeLessThanOrEqual(1)
                if (light.items.length) built++
                if (pressingSets(buildGymSession(input).items) >= HARD_GYM_FAMILY_SETS) hardWithout++
              }
    expect(built).toBeGreaterThan(400)
    // The same days without the spared muscles press hard: the spare is what keeps them light.
    expect(hardWithout).toBeGreaterThan(100)
  })
})

/** The teen of the whole-athlete eval, with its sport week. */
const teen = (prefs: AthleteCfg['prefs'] = {}): AthleteCfg => ({
  skills: ['planche', 'frontlever', 'handstand'],
  birthYear: 2012,
  steps: { planche: 'tuck' as StepId, frontlever: 'fl-tuck' as StepId, handstand: 'hs-wall' as StepId },
  prefs: { goals: { strength: 3, power: 2, physique: 4, skills: 5, endurance: 1 }, sportSchedule: SPORT_WEEK, ...prefs },
})

/** Monday 5 October 2026, 17:00: the eval's first day. */
const FROM = new Date(2026, 9, 5)
const at = (day: number, hour = 17) => new Date(2026, 9, 5 + day, hour).getTime()

/** The athlete after `days` real days of the eval's loop (planned, trained and logged by the real engine). */
function lived(cfg: AthleteCfg, days: number): AppState {
  const start = makeAthlete(cfg)
  const truthStart: Record<string, number> = { 'tuck-planche': 16, 'adv-tuck-planche': 4 }
  for (const skill of cfg.skills) {
    const step = STEP_BY_ID[stepOfSkill(start, skill)]
    if (!(step.keyExerciseId in truthStart)) truthStart[step.keyExerciseId] = step.startSec * 1.6
  }
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    return runLoop(start, { from: FROM, days, perSet: 0.08, truthStart, setClock: (t) => vi.setSystemTime(t) }).state
  } finally {
    restoreClock()
  }
}

const planAt = (state: AppState, t: number): WeekAhead => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(t)
  try {
    return planWeekAhead(state, t)
  } finally {
    restoreClock()
  }
}

/** A plan's gym block as the screens build it: the week's spare muscles and priorities beside the athlete's own. */
const asBuilt = (state: AppState, d: WeekAhead['days'][number], extra: { priority?: Muscle[]; volumeFactor?: number } = {}) => {
  const g = d.plan.gym!
  return buildGymSession({
    location: state.gym!.locations.find((l) => l.id === g.placeId) ?? GYM_PLACE,
    minutes: g.minutes,
    focus: g.focus,
    sessions: state.gym!.sessions,
    youth: true,
    goals: state.gym!.prefs!.goals,
    musclesOff: g.musclesOff,
    priority: [...new Set([...(extra.priority ?? []), ...(g.priority ?? [])])],
    ...(g.spare?.length ? { spare: g.spare } : {}),
    avoidJoints: g.avoidJoints,
    volumeFactor: extra.volumeFactor ?? g.volumeFactor,
    now: d.at,
  })
}

describe('round 5b: the gym presses every week beside the planche', () => {
  // A 72 h rule: the planche on Monday and Friday, the front lever's days on Wednesday and Saturday, no planche opener.
  const rule = { straightArmRestHours: 72 }
  let afterWeekOne: AppState
  const state = () => (afterWeekOne ??= lived(teen(rule), 7))

  it('carries the week’s pressing on the lever’s day as a light upper day, with its opener — not on a day that may change kind', () => {
    const week = planAt(state(), at(7))
    const kinds = week.days.map((d) => `${d.day.slice(5)} ${d.kind}${d.plan.gym ? `:${d.plan.gym.focus}${d.plan.gym.lightPress ? '·light' : ''}` : ''}`)
    const wed = week.days.find((d) => d.day === dayKey(at(9)))!
    expect(wed.plan.gym?.focus, kinds.join(' | ')).toBe('upper')
    expect(wed.plan.gym?.lightPress, kinds.join(' | ')).toBe(true)
    expect(wed.plan.skill?.opener && wed.plan.skill.skills, 'the lever still opens it').toEqual(['frontlever'])
    expect(LIGHT_PRESS_SPARE.every((m) => wed.plan.gym!.spare?.includes(m)), String(wed.plan.gym!.spare)).toBe(true)
    // Built as the screens build it — and with the chest a priority on a push day — it presses, and lightly.
    for (const extra of [{}, { priority: ['chest'] as Muscle[], volumeFactor: 1.15 }]) {
      const built = asBuilt(state(), wed, extra)
      expect(built.items.some((it) => chestPress(it.exerciseId)), built.items.map((it) => it.exerciseId).join()).toBe(true)
      expect(pressingSets(built.items)).toBeLessThan(HARD_GYM_FAMILY_SETS)
    }
    // The light pressing days of the week: the lever's Wednesday among them, none pressing hard, the planche's days its
    // own. (Round six: handstand push-ups are pressing, so the handstand's Sunday — 48 h after Friday's planche, inside
    // the 72 h rule — went to the lever, and Saturday's game day is a light full-body day; it was one light day.)
    const thisWeek = week.days.filter((d) => d.at < at(14))
    const light = thisWeek.filter((d) => d.plan.gym?.lightPress)
    expect(light.map((d) => d.day)).toContain(wed.day)
    for (const d of light) expect(pressingSets(asBuilt(state(), d, {}).items), d.day).toBeLessThan(HARD_GYM_FAMILY_SETS)
    expect(thisWeek.filter((d) => d.plan.skill?.skills[0] === 'planche' && d.kind === 'calisthenics').map((d) => d.day)).toEqual([dayKey(at(7)), dayKey(at(11))])
    expect(wed.plan.reasons.some((r) => r.startsWith('Pressing stays light today'))).toBe(true)
  })

  it('takes the pressing already logged this week as the week’s pressing: the lever’s Saturday stays a pull day', () => {
    // The athlete lived through Wednesday's light upper day: its press is in the log, and it was not a heavy session.
    const thursday = lived(teen(rule), 10)
    const wednesday = thursday.gym!.sessions.filter((g) => dayKey(g.startedAt) === dayKey(at(9)))
    expect(wednesday.map((g) => g.exercises.filter((e) => chestPress(e.exerciseId)).length)).toEqual([1])
    expect(wednesday.map((g) => familyWorkingSets(g.exercises).push)).toEqual([2])
    const week = planAt(thursday, at(10))
    const saturday = week.days.find((d) => d.day === dayKey(at(12)))!
    expect(week.days.filter((d) => d.at < at(14) && d.plan.gym?.lightPress).map((d) => d.day)).toEqual([])
    expect(saturday.plan.gym?.focus, week.days.map((d) => `${d.day} ${d.plan.gym?.focus ?? d.kind}`).join(' | ')).toBe('pull')
    expect(saturday.plan.skill?.opener && saturday.plan.skill.skills).toEqual(['frontlever'])
    // A pressing session logged this week, light or not, is what the rule reads.
    expect(thursday.gym!.sessions.some((g) => g.startedAt >= at(7, 0) && g.startedAt < at(10) && pressedIn(g))).toBe(true)
  })

  /** A planche athlete's fresh week (the gym active, the sport week), and its gym days that press. */
  const pressingDays = (skills: SkillId[], prefs: AthleteCfg['prefs']) => {
    const s = makeAthlete({ skills, birthYear: 2012, steps: { planche: 'tuck' as StepId, handstand: 'hs-wall' as StepId }, prefs: { goals: { strength: 3, power: 2, physique: 4, skills: 5, endurance: 1 }, sportSchedule: SPORT_WEEK, ...prefs } })
    const week = planAt(s, at(0)).days.filter((d) => d.at < at(7))
    return { s, week, pressing: week.filter((d) => d.plan.gym && ['push', 'upper', 'full'].includes(d.plan.gym.focus)) }
  }

  it('presses in a week with no lever or planche gym day to carry it: the best plan that presses, not the best that does not', () => {
    // Side delts switched off: the upper day that presses scores under the pull day, and the week takes it anyway.
    const { s, week, pressing } = pressingDays(['planche', 'handstand'], { ...rule, minutesByDay: [45, 0, 30, 0, 45, 30, 45], musclesOff: ['side-delts'] })
    expect(week.every((d) => !d.plan.skill?.opener), 'no gym day opens with a skill').toBe(true)
    expect(pressing, week.map((d) => `${d.day} ${d.plan.gym?.focus ?? d.kind}`).join(' | ')).toHaveLength(1)
    expect(pressing[0].plan.gym!.lightPress).toBe(true)
    const built = asBuilt(s, pressing[0])
    expect(built.items.some((it) => chestPress(it.exerciseId))).toBe(true)
    expect(pressingSets(built.items)).toBeLessThan(HARD_GYM_FAMILY_SETS)
  })

  it('presses every week across schedules, rest rules and switched-off muscles', () => {
    const missed: string[] = []
    for (const minutesByDay of [[45, 0, 30, 0, 45, 30, 45], [45, 0, 25, 0, 45, 25, 0], [60, 25, 0, 25, 0, 25, 0], [45, 0, 45, 0, 45, 45, 45], [45, 30, 0, 45, 0, 30, 0]])
      for (const musclesOff of [[], ['side-delts']] as Muscle[][])
        for (const straightArmRestHours of [48, 72])
          for (const skills of [['planche', 'handstand'], ['planche']] as SkillId[][]) {
            const { pressing } = pressingDays(skills, { minutesByDay, musclesOff, straightArmRestHours })
            if (!pressing.length) missed.push(`${skills} ${minutesByDay} off [${musclesOff}] ${straightArmRestHours}h`)
          }
    expect(missed).toEqual([])
  })

  it('rests nothing around a light pressing day: the planche’s gym day can follow it', () => {
    // The planche alone, every day trained, a 48 h rule: Sunday carries the week's pressing lightly, and Monday is the
    // planche's own gym day — its holds, then hard pressing. Counted as a hard pressing session, Sunday took Monday's.
    const all = planAt(makeAthlete({ skills: ['planche'], birthYear: 2012, steps: { planche: 'tuck' as StepId }, prefs: { goals: { strength: 3, power: 2, physique: 4, skills: 5, endurance: 1 }, sportSchedule: [], minutesByDay: [60, 45, 45, 45, 45, 45, 60] } }), at(3)).days
    const sunday = all.find((d) => d.day === dayKey(at(6)))!
    const monday = all.find((d) => d.day === dayKey(at(7)))!
    const line = all.map((d) => `${d.day} ${d.plan.gym ? d.plan.gym.focus + (d.plan.gym.lightPress ? '·light' : '') : d.kind}${d.plan.skill?.opener ? '+' + d.plan.skill.skills[0] : ''}`).join(' | ')
    expect(sunday.plan.gym?.lightPress, line).toBe(true)
    expect(monday.plan.gym?.focus, line).toBe('push')
    expect(monday.plan.gym?.lightPress, line).toBeUndefined()
    expect(monday.plan.skill?.opener && monday.plan.skill.skills, line).toEqual(['planche'])
  })

  it('never names a light pressing day as the heavy pressing a later day is kept clear of', () => {
    let checked = 0
    for (const minutesByDay of [[45, 0, 30, 0, 45, 30, 45], [60, 45, 45, 45, 45, 45, 60], [45, 30, 0, 45, 0, 30, 45]]) {
      const { week } = pressingDays(['planche', 'handstand'], { ...rule, minutesByDay, sportSchedule: [] })
      for (const light of week.filter((d) => d.plan.gym?.lightPress)) {
        const name = new Date(light.at).toLocaleDateString('en-US', { weekday: 'long' })
        for (const later of week.filter((d) => d.at > light.at && d.at - light.at <= 72 * 3_600_000)) {
          const said = [...later.why, ...later.plan.reasons].filter((r) => /heavy pressing/i.test(r))
          for (const line of said) {
            expect(line).not.toMatch(new RegExp(`pressing on ${name}|${name}’s pressing`))
            if (/planche on/.test(line)) checked++
          }
        }
      }
    }
    expect(checked, 'a later day explains the hard planche session that it is resting').toBeGreaterThan(0)
  })

  it('keeps the pull family’s rest rule on a light upper day, and never opens one with the planche', () => {
    // Gym-heavy goals, every day 45 minutes, hard planche and front lever sessions logged on Tuesday: next Monday is
    // the planche's gym day, the day after the lever's. A light upper day there would pull hard beside the lever.
    const s0 = makeAthlete({ skills: ['planche', 'frontlever'], birthYear: 2012, steps: { planche: 'tuck' as StepId, frontlever: 'fl-tuck' as StepId }, prefs: { goals: { strength: 5, power: 0, physique: 4, skills: 2, endurance: 0 }, sportSchedule: [], minutesByDay: [45, 45, 45, 45, 45, 45, 45] } })
    const hard = (t: number, exerciseId: string, stepId: StepId): Session => ({ id: `s-${exerciseId}`, startedAt: t, endedAt: t + 3_600_000, workoutName: 'Skill', workoutKind: 'auto', stepId, sets: Array.from({ length: 4 }, () => ({ exerciseId, kind: 'hold' as const, value: 8, target: 8, section: 'main' as const, at: t })) })
    const s: AppState = { ...s0, sessions: [...s0.sessions, hard(at(1, 17), 'tuck-planche', 'tuck'), hard(at(1, 18), 'tuck-front-lever', 'fl-tuck')] }
    const days = planAt(s, at(2)).days
    const line = days.map((d) => `${d.day} ${d.plan.gym ? d.plan.gym.focus + (d.plan.gym.lightPress ? '·light' : '') : d.kind}${d.plan.skill ? '+' + d.plan.skill.skills.join('+') : ''}`).join(' | ')
    expect(days.filter((d) => d.plan.gym?.lightPress && skillFamily(d.plan.skill?.skills[0] ?? 'handstand') === 'push').map((d) => d.day), line).toEqual([])
    // Hard pulling — the lever's sessions, and pull or upper days, light or not — sits the 48 h rule apart.
    const pulls = days.filter((d) => (d.plan.skill?.hard ?? []).includes('pull') || (d.plan.gym && focusFamilies(d.plan.gym.focus).includes('pull'))).map((d) => d.at)
    for (let i = 1; i < pulls.length; i++) expect(Math.round((pulls[i] - pulls[i - 1]) / 86_400_000), line).toBeGreaterThanOrEqual(2)
    const monday = days.find((d) => d.day === dayKey(at(7)))!
    expect(monday.plan.gym?.focus, line).toBe('push')
  })

  it('presses lightly on a full-body day beside a planche day, even with the chest a priority on a push day', () => {
    // A fresh week under the 72 h rule: planche Monday and Friday, a full-body day on Wednesday between them.
    const s = makeAthlete(teen({ ...rule, musclesPriority: ['chest'] }))
    const week = planAt(s, at(0))
    const wed = week.days.find((d) => d.day === dayKey(at(2)))!
    expect(wed.plan.gym?.focus, week.days.map((d) => `${d.day} ${d.plan.gym?.focus ?? d.kind}`).join(' | ')).toBe('full')
    expect(wed.plan.gym?.lightPress).toBe(true)
    expect(LIGHT_PRESS_SPARE.every((m) => wed.plan.gym!.spare?.includes(m)), String(wed.plan.gym!.spare)).toBe(true)
    // Built as planned, and on a longer push day, it stays under the heavy-pressing line.
    for (const minutes of [wed.plan.gym!.minutes, 90]) {
      const day = { ...wed, plan: { ...wed.plan, gym: { ...wed.plan.gym!, minutes } } }
      const built = asBuilt(s, day, { priority: ['chest'], volumeFactor: 1.15 })
      expect(pressingSets(built.items), `${minutes}m ${built.items.map((it) => `${it.exerciseId}x${it.sets}`).join()}`).toBeLessThan(HARD_GYM_FAMILY_SETS)
    }
    // Without the spared muscles the 90-minute day is a hard pressing session, which would rest Friday's planche.
    const { spare: _spare, ...unspared } = wed.plan.gym!
    const heavy = asBuilt(s, { ...wed, plan: { ...wed.plan, gym: { ...unspared, minutes: 90 } } }, { priority: ['chest'], volumeFactor: 1.15 })
    expect(pressingSets(heavy.items), heavy.items.map((it) => `${it.exerciseId}x${it.sets}`).join()).toBeGreaterThanOrEqual(HARD_GYM_FAMILY_SETS)
  })
})

describe('round 5b: an explicit time is the session’s budget', () => {
  const NOW = at(0)
  const KIT: EquipmentId[] = ['floor', 'parallettes', 'pullup-bar', 'wall', 'dip-bars', 'band', 'box']
  const one = (skill: SkillId, step: StepId, sessionMinutes: number) => startingState({ skills: [skill], steps: { [skill]: step } as never, sessionMinutes, equipment: KIT })
  const sets = (w: { blocks: { sets: number }[] }) => w.blocks.reduce((n, b) => n + b.sets, 0)
  const build = (s: AppState, request: WorkoutRequest) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    try {
      return finalizeWorkout(s, request, undefined, NOW)
    } finally {
      restoreClock()
    }
  }

  it('is the request’s minutes up to two hours, the session length without one, and 30 on a light day either way', () => {
    expect(sessionBudget(45, false)).toBe(45)
    expect(sessionBudget(45, false, 20)).toBe(20)
    expect(sessionBudget(45, false, 60)).toBe(60)
    expect(sessionBudget(45, false, 500)).toBe(MAX_REQUEST_MINUTES)
    expect(MAX_REQUEST_MINUTES).toBe(120)
    expect(sessionBudget(45, false, 3)).toBe(8)
    expect(sessionBudget(45, true, 60)).toBe(30)
    expect(sessionBudget(20, true, 25)).toBe(25)
    expect(sessionBudget(20, true)).toBe(20)
  })

  for (const [skill, step] of [['planche', 'tuck'], ['frontlever', 'fl-tuck'], ['handstand', 'hs-wall']] as [SkillId, StepId][]) {
    it(`${skill}: longer when an hour is asked of a 25-minute athlete; the session length when nothing is`, () => {
      const s = one(skill, step, 25)
      const plain = build(s, { source: 'auto' })
      const asked = build(s, { source: 'auto', minutes: 60 })
      expect(asked.minutes, `${plain.minutes} → ${asked.minutes}`).toBeGreaterThan(plain.minutes + 5)
      expect(sets(asked)).toBeGreaterThan(sets(plain))
      expect(asked.minutes).toBeLessThanOrEqual(60)
      // Unchanged when nothing is asked: the same blocks as asking for the session length itself.
      expect(build(s, { source: 'auto', minutes: 25 }).blocks).toEqual(plain.blocks)
      expect(plain.minutes).toBeLessThanOrEqual(25)
    })
  }

  it('three skills in an hour hold more than the 45 of the setup answer, and never more than asked', () => {
    const s = startingState({ skills: ['planche', 'frontlever', 'handstand'], steps: { planche: 'tuck', frontlever: 'fl-tuck', handstand: 'hs-wall' } as never, sessionMinutes: 45, equipment: KIT })
    const request = (minutes?: number): WorkoutRequest => ({ source: 'auto', skills: ['planche', 'frontlever', 'handstand'], ...(minutes ? { minutes } : {}) })
    const plain = build(s, request())
    const hour = build(s, request(60))
    expect(hour.skills).toEqual(['planche', 'frontlever', 'handstand'])
    expect(hour.minutes).toBeGreaterThan(plain.minutes + 5)
    expect(hour.minutes).toBeLessThanOrEqual(60)
    expect(sets(hour)).toBeGreaterThan(sets(plain))
    expect(build(s, request(45)).blocks).toEqual(plain.blocks)
  })

  it('keeps a light day to 30 minutes, whatever is asked', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    try {
      const planche = one('planche', 'tuck', 45)
      const lever = skillView(one('frontlever', 'fl-tuck', 45), 'frontlever')
      for (const dayType of ['technique', 'deload'] as const) {
        expect(todaysSession(planche, { ...buildPlan(planche, NOW), dayType }, 90, { now: NOW }).minutes, dayType).toBeLessThanOrEqual(30)
        expect(todaysSession(lever, { ...buildPlan(lever, NOW), dayType }, 90, { now: NOW }).minutes, dayType).toBeLessThanOrEqual(30)
      }
      const mixed = startingState({ skills: ['planche', 'handstand'], steps: { planche: 'tuck', handstand: 'hs-wall' } as never, sessionMinutes: 45, equipment: KIT })
      const lineup = todaysLineup(mixed, NOW, 90)
      const plans = Object.fromEntries(lineup.map((e) => [e.skill, { ...buildPlan(skillView(mixed, e.skill), NOW), dayType: 'deload' as const }]))
      const w = mixedSession(mixed, lineup, plans, (view, p, minutes) => todaysSession(view, p, minutes, { part: true, now: NOW }), 90)
      expect(w.minutes).toBeLessThanOrEqual(30)
    } finally {
      restoreClock()
    }
  })

  it('builds the planner’s 60-minute weekend day for 60, not the 45 of the setup answer', () => {
    const s = makeAthlete(teen())
    const week = planAt(s, NOW)
    const sunday = week.days.find((d) => d.day === dayKey(at(6)))!
    expect(sunday.plan.kind).toBe('calisthenics')
    expect(sunday.plan.skill!.minutes).toBe(60)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(sunday.at)
    try {
      const w = finalizeWorkout(s, skillRequest(sunday.plan.skill!), undefined, sunday.at)
      expect(w.minutes, w.skills?.join('+')).toBeGreaterThan(45)
      expect(w.minutes).toBeLessThanOrEqual(60)
      expect(w.skills).toEqual(sunday.plan.skill!.skills)
    } finally {
      restoreClock()
    }
  })
})
