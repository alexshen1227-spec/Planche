import { afterAll, describe, expect, it, vi } from 'vitest'
import type { EquipmentId, SkillId, StepId } from '../../types'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { STEP_BY_ID, stepsOf } from '../../data/progressions'
import { buildPlan } from '../coach'
import { readSignals } from '../signals'
import { skillView, stepOfSkill } from '../skills'
import { dayKey } from '../time'
import { familyWorkingSets, HARD_GYM_FAMILY_SETS } from './load'
import { exposureDays, exposuresOf, GYM_PLACE, keySets, makeAthlete, runLoop, SPORT_WEEK, weeksOf, type AthleteCfg, type DayRun, type LoopOpts, type LoopOut } from './wholeAthleteLoop'

/**
 * The whole athlete, closed (round five). A fourteen-year-old whose first
 * priority is the planche — a tuck of about 16 seconds against its 20-second
 * bar, almost at the advanced tuck — who also trains the front lever and the
 * handstand, at home on parallettes and at a gym, with practice on Tuesday
 * evening and a game on Saturday morning. Every day the screens' own
 * recommendation is started and done by a body whose truth is known
 * (`wholeAthleteLoop`), from Monday 5 October 2026 — ten weeks cross the US
 * clock change on 1 November — at 17:00 local time.
 *
 * The yardstick is the same athlete training the planche alone on the same
 * days. Their words: "make sure I won't lose my planche progress … and make
 * sure I'll still improve in the planche and the other skills, plus the gym."
 * The rule this pins is the app's own: the first priority gets every session
 * its rest rule allows on the training days, each with its key hold's kept
 * dose, and the other skills and the gym fill the days it cannot use — the gym
 * pressing every week, lightly beside the planche's days (round 5b).
 *
 * Every bar below was set from a measured run with room under it (the
 * measurement is in the comment beside it): when later work moves one, measure
 * again and say why; do not loosen it to pass. Hold capacity rises with the
 * main sets a skill got, so a plan that thins the planche's sets shows here.
 */

const FROM = new Date(2026, 9, 5)
const CROSSES_A_CLOCK_CHANGE = new Date(2026, 9, 5).getTimezoneOffset() !== new Date(2026, 11, 13).getTimezoneOffset()

const teen = (prefs: AthleteCfg['prefs'] = {}, over: Partial<AthleteCfg> = {}): AthleteCfg => ({
  skills: ['planche', 'frontlever', 'handstand'],
  birthYear: 2012,
  steps: { planche: 'tuck' as StepId, frontlever: 'fl-tuck' as StepId, handstand: 'hs-wall' as StepId },
  prefs: { goals: { strength: 3, power: 2, physique: 4, skills: 5, endurance: 1 }, sportSchedule: SPORT_WEEK, ...prefs },
  ...over,
})
/** The planche alone on the same days: no gym goals, the same schedule and sport. */
const control = (prefs: AthleteCfg['prefs'] = {}): AthleteCfg => ({
  skills: ['planche'],
  birthYear: 2012,
  steps: { planche: 'tuck' as StepId },
  prefs: { goals: { strength: 0, power: 0, physique: 0, skills: 5, endurance: 0 }, sportSchedule: SPORT_WEEK, ...prefs },
})

/** The days, at the fixed hour, with the system clock on each (anything that reads it reads the day being trained). */
function season(cfg: AthleteCfg, days: number, extra: Partial<LoopOpts> = {}, place = GYM_PLACE): LoopOut {
  let start = makeAthlete(cfg)
  if (place !== GYM_PLACE) start = { ...start, gym: { ...start.gym!, locations: start.gym!.locations.map((l) => (l.id === GYM_PLACE.id ? place : l)) } }
  // Almost at an advanced tuck: a 16 s tuck against its 20 s bar, a few seconds of the next shape.
  const truthStart: Record<string, number> = { 'tuck-planche': 16, 'adv-tuck-planche': 4 }
  for (const skill of cfg.skills) {
    const step = STEP_BY_ID[stepOfSkill(start, skill)]
    if (!(step.keyExerciseId in truthStart)) truthStart[step.keyExerciseId] = step.startSec * 1.6
  }
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    return runLoop(start, { from: FROM, days, perSet: 0.08, truthStart, setClock: (t) => vi.setSystemTime(t), ...extra })
  } finally {
    restoreClock()
  }
}
const restoreClock = () => {
  if (process.env.FAKE_NOW) vi.setSystemTime(new Date(process.env.FAKE_NOW))
  else vi.useRealTimers()
}
afterAll(restoreClock)

/** The first priority's key-hold working sets, mixed against the control, over the weeks after the first. */
const doseRatio = (mixed: LoopOut, ctrl: LoopOut, weeks?: number) => {
  const after = (out: LoopOut) => weeksOf(out).slice(1, weeks).flat()
  return keySets(after(mixed), 'planche') / keySets(after(ctrl), 'planche')
}

/** Every exposure the control had, the mixed athlete had too, and each one carried its dose. */
function expectExposures(mixed: LoopOut, ctrl: LoopOut, ctrlDays?: DayRun[]) {
  const mine = exposuresOf(mixed.days, 'planche')
  const theirs = exposuresOf(ctrlDays ?? ctrl.days, 'planche')
  expect(mine.length, 'as many first-priority sessions as the planche alone').toBe(theirs.length)
  const thin = mine.filter((e) => !e.full).map((e) => dayKey(e.at))
  expect(thin, 'each one with its key hold’s kept dose').toEqual([])
}

/** Each planche step the control reached, the mixed athlete reached within a week of it. */
function expectSteps(mixed: LoopOut, ctrl: LoopOut) {
  for (const step of stepsOf('planche')) {
    const theirs = ctrl.reached.get(step.id)
    if (!theirs) continue
    const mine = mixed.reached.get(step.id)
    expect(mine, `${step.id}: reached by the planche alone on ${theirs}`).toBeDefined()
    const late = (new Date(`${mine}T12:00:00`).getTime() - new Date(`${theirs}T12:00:00`).getTime()) / 86_400_000
    expect(late, `${step.id}: ${mine} against ${theirs}`).toBeLessThanOrEqual(7)
  }
}

/** Calendar days between two moments, as the rest rule counts planned days. */
const daysApart = (a: number, b: number) => Math.round(Math.abs(new Date(a).setHours(0, 0, 0, 0) - new Date(b).setHours(0, 0, 0, 0)) / 86_400_000)

/**
 * The gym presses every week (round 5b), and next to the planche only lightly: every calendar week has a chest press
 * at the gym; no gym session inside the rest rule of a planche session on another day is a hard pressing session (the
 * count `familyEvents` reads); and every planche day planned on a light pressing day happened. Returns how many light
 * pressing days the run had, so a variant can say it reached the check.
 */
function expectWeeklyPressing(mixed: LoopOut, restHours: number): number {
  const unpressed = weeksOf(mixed)
    .map((week, w) => ({ w: w + 1, pressed: week.some((d) => d.gym?.chestPress) }))
    .filter((x) => !x.pressed)
    .map((x) => `week ${x.w}`)
  expect(unpressed, 'weeks with no chest press at the gym').toEqual([])
  const planche = exposuresOf(mixed.days, 'planche').map((e) => e.at)
  const happened = new Set(planche.map(dayKey))
  const last = dayKey(mixed.days[mixed.days.length - 1].at)
  let light = 0
  for (const d of mixed.days) {
    if (!d.gym) continue
    const session = mixed.state.gym!.sessions.find((g) => g.startedAt === d.gym!.at)!
    const beside = planche.filter((t) => dayKey(t) !== dayKey(d.at) && daysApart(t, d.at) * 24 < restHours)
    if (beside.length) {
      expect(familyWorkingSets(session.exercises).push, `${dayKey(d.at)} ${d.gym.focus} beside the planche on ${beside.map(dayKey).join(', ')}`).toBeLessThan(HARD_GYM_FAMILY_SETS)
    }
    if (!d.plan.gym?.lightPress) continue
    light++
    // Nothing the light day did moved a planche day planned when it was trained.
    const missing = exposureDays(d.week, 'planche').filter((day) => day <= last && !happened.has(day))
    expect(missing, `${dayKey(d.at)}: planche days planned that day`).toEqual([])
  }
  return light
}

describe('the whole athlete: the planche first, then the rest (round five)', () => {
  // The default week: Sunday and Saturday an hour, Monday, Wednesday and Friday 45 minutes, a 48 h rule, the gym
  // active. Ten weeks; plan stability is read on the first five (each read re-plans twice).
  const FRONT_LEVER: { at: number; restDays: number; queued: boolean }[] = []
  let mixed: LoopOut
  let ctrl: LoopOut
  const run = () => {
    if (mixed) return
    mixed = season(teen(), 70, {
      stability: 35,
      observe: (state, at, plan) => {
        if (plan.skill?.skills[0] !== 'frontlever') return
        const view = skillView(state, 'frontlever')
        FRONT_LEVER.push({ at, restDays: readSignals(view, at).skillRestDays, queued: Boolean(buildPlan(view, at).queueRetest) })
      },
    })
    ctrl = season(control(), 70)
  }

  it('gives the planche every session a planche-only athlete gets on the same days, each with its kept dose, and keeps its steps on time', () => {
    run()
    if (CROSSES_A_CLOCK_CHANGE) expect(mixed.days).toHaveLength(70)
    expectExposures(mixed, ctrl)
    // Measured 0.95 (180 of 190 sets) of the control's key-hold working sets over weeks 2–10 — 0.89 until round 5b
    // built the weekend's hour as an hour, not the 45 minutes of the setup answer (the review's loop: 0.72); the
    // openers — 6 of 27 sessions — keep the kept dose, not the reach.
    expect(doseRatio(mixed, ctrl), 'key-hold sets against the planche alone').toBeGreaterThanOrEqual(0.85)
    // Measured: advanced tuck two days sooner, one-leg three days later than the planche alone.
    expectSteps(mixed, ctrl)
  })

  it('still moves the front lever on: its working target rises, and it is re-tested on this schedule', () => {
    run()
    const lever = mixed.days.flatMap((d) => d.skill.filter((s) => s.lineup[0]?.skill === 'frontlever').map((s) => s.parts.frontlever!))
    const first = lever[0]
    const later = lever.slice(1)
    const rose = later.some((p) => p.step !== first.step) || later.some((p) => (p.target ?? 0) > (first.target ?? 0))
    // Measured: 14 lever-led sessions in ten weeks, its target 5 s → 9 s, then the advanced tuck.
    expect(lever.length).toBeGreaterThanOrEqual(10)
    expect(rose, lever.map((p) => `${p.step}:${p.target}`).join(' ')).toBe(true)
    // The coach queued a re-test for it, with rest days behind it, and the session gave one.
    expect(FRONT_LEVER.some((x) => x.queued && x.restDays >= 1), JSON.stringify(FRONT_LEVER.slice(0, 6))).toBe(true)
    expect(lever.filter((p) => p.retest).length, 'lever sessions with a re-test').toBeGreaterThanOrEqual(1)
  })

  it('keeps the athlete’s order between the other skills wherever the rules allow (round seven)', () => {
    run()
    // Full parts — led, partnered or opened — of the second skill (the lever here) against the third.
    const full = (week: DayRun[], skill: SkillId) =>
      week.reduce((n, d) => n + d.skill.reduce((m, s) => m + s.lineup.filter((e) => e.skill === skill && (e.role === 'lead' || e.role === 'partner')).length, 0), 0)
    const behind = weeksOf(mixed).filter((week) => full(week, 'frontlever') < full(week, 'handstand'))
    expect(behind.length, 'weeks the second skill had fewer full parts than the third').toBeLessThanOrEqual(2) // measured 2 (3 before round seven)
  })

  it('keeps the handstand in the week', () => {
    run()
    // Measured: in 24 sessions over ten weeks, as a partner or balance practice.
    expect(mixed.days.filter((d) => d.skill.some((s) => (s.parts.handstand?.main ?? 0) > 0)).length).toBeGreaterThanOrEqual(15)
  })

  it('presses on push days while chest is under target, and the main lifts get heavier', () => {
    run()
    const push = mixed.days.filter((d) => d.gym?.focus === 'push')
    expect(push.length, 'push days').toBeGreaterThanOrEqual(4)
    for (const d of push) if (d.gym!.chestUnder) expect(d.gym!.chestPress, `${dayKey(d.at)}: ${d.gym!.items.map((i) => i.id).join(', ')}`).toBe(true)
    // The three lifts done most often with a load: the last working load above the first.
    const loads = new Map<string, number[]>()
    for (const d of mixed.days) for (const it of d.gym?.items ?? []) if (it.kg !== undefined && !GYM_EXERCISE_BY_ID[it.id]?.assisted) loads.set(it.id, [...(loads.get(it.id) ?? []), it.kg])
    const main = [...loads.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 3)
    for (const [id, kg] of main) expect(kg[kg.length - 1], `${id}: ${kg.join(' → ')}`).toBeGreaterThan(kg[0])
    // Legs, measured: a lower-body day every other week (Monday is the week's only day the practice and the game
    // leave them fresh, and the front lever needs it the other weeks).
    expect(mixed.days.filter((d) => d.gym?.focus === 'lower').length).toBeGreaterThanOrEqual(4)
  })

  it('presses at the gym every week — lightly beside the planche — and that pressing moves no planche day (round 5b)', () => {
    run()
    // Measured (gym chest and upper-chest sets a week): 4, 3, 3, 3, 3, 2.5, 3, 2, 2, 2 — the review's loop pressed only
    // on the planche's opener day, and weeks 8–10 had none (4, 2.5, 2.5, 3, 3, 2.5, 2.5, 0, 0, 0). Those three weeks
    // press on the lever's Saturday, a light upper day; the skill side already gives 17–32 chest sets a week.
    expect(expectWeeklyPressing(mixed, 48), 'light pressing days').toBeGreaterThanOrEqual(1) // measured 3
  })

  it('does not move a later planche day when today is followed, and a saved opener leaves its gym day the gym day', () => {
    run()
    const moved = mixed.days.filter((d) => d.moved.length).map((d) => `${dayKey(d.at)} ${d.moved.join(',')}`)
    expect(moved).toEqual([])
    const openers = mixed.days.filter((d) => d.afterOpener)
    expect(openers.length).toBeGreaterThanOrEqual(2)
    for (const d of openers) {
      expect(d.afterOpener, dayKey(d.at)).toMatchObject({ kind: 'gym', focus: d.plan.gym!.focus })
    }
  })

  it('under a 72 h rule gives the planche its own days, not openers, and as many as alone', () => {
    const rule = { straightArmRestHours: 72 }
    const m = season(teen(rule), 28)
    const c = season(control(rule), 28)
    expectExposures(m, c)
    // Measured 0.95 (the review's loop: two 18-minute openers a week, 7–9 sets against 12–14).
    expect(doseRatio(m, c)).toBeGreaterThanOrEqual(0.88)
    expect(exposuresOf(m.days, 'planche').filter((e) => e.opener)).toEqual([])
    expectSteps(m, c)
    // Measured chest sets a week 2, 4, 7, 4 (the review's loop: 2, 0, 2, 0): four light days — a full-body day, the
    // lever's Wednesday twice as an upper day, a push day — none of them a hard pressing session.
    expect(expectWeeklyPressing(m, 72), 'light pressing days').toBeGreaterThanOrEqual(1) // measured 4
  })

  it('on three days a week, every one the planche’s, still gives the other skills a place', () => {
    const days = { minutesByDay: [45, 0, 45, 0, 45, 0, 0] }
    const m = season(teen(days), 28)
    const c = season(control(days), 28)
    expectExposures(m, c)
    // Measured 0.89: one day a week is a gym day the planche opens.
    expect(doseRatio(m, c)).toBeGreaterThanOrEqual(0.84)
    expectSteps(m, c)
    // The others ride along beside it: the handstand and the lever as short doses or partners.
    const others = (skill: SkillId) => m.days.filter((d) => d.skill.some((s) => (s.parts[skill]?.main ?? 0) > 0)).length
    expect(others('handstand')).toBeGreaterThanOrEqual(4)
    expect(others('frontlever')).toBeGreaterThanOrEqual(3)
    // Measured chest sets a week 4, 4, 4, 3: each week's Tuesday is the planche's gym day, pressing beside its own holds.
    expectWeeklyPressing(m, 48)
  })

  it('on three days a week, with the wall and the bar only at the gym, takes the handstand and the lever there (round six)', () => {
    // The athlete's own order — the planche, the handstand push-up, the front lever — at home on parallettes, with no
    // wall and no bar there. Before round six every calisthenics day was the planche alone at home: six weeks, nothing
    // for the lever or the handstand.
    const wallGym = { ...GYM_PLACE, equipment: [...GYM_PLACE.equipment, 'wall' as const] }
    const days = { minutesByDay: [0, 45, 0, 45, 0, 45, 0] }
    const away = { kit: ['floor', 'parallettes'] as EquipmentId[], active: 'home' as const }
    const m = season(teen(days, { ...away, skills: ['planche', 'handstand', 'frontlever'] }), 42, {}, wallGym)
    const c = season({ ...control(days), ...away }, 42, {}, wallGym)
    expectExposures(m, c)
    // Measured 0.90 (75 of 83 key-hold sets), as before round six: the visits cost the planche nothing.
    expect(doseRatio(m, c)).toBeGreaterThanOrEqual(0.84)
    expectSteps(m, c)
    // Measured: every week the handstand once (2–4 main sets) and the lever once or twice (2–6), each beside the planche
    // at the gym, the planche leading.
    for (const [w, week] of weeksOf(m).entries()) {
      for (const skill of ['handstand', 'frontlever'] as SkillId[]) {
        const runs = week.filter((d) => d.skill.some((s) => (s.parts[skill]?.main ?? 0) > 0))
        expect(runs.length, `week ${w + 1} ${skill}`).toBeGreaterThanOrEqual(1)
        for (const d of runs) expect(d.plan.skill?.placeId ?? (d.plan.gym ? GYM_PLACE.id : 'home'), `${dayKey(d.at)} ${skill}`).toBe(GYM_PLACE.id)
      }
    }
  })

  it('on 20-minute days gives the handstand its turns', () => {
    const days = { minutesByDay: [20, 20, 20, 20, 20, 20, 20] }
    const m = season(teen(days), 28)
    const c = season(control(days), 28)
    expectExposures(m, c)
    expect(doseRatio(m, c)).toBeGreaterThanOrEqual(0.95) // measured 1.12
    // Measured: 4 handstand-led days in four weeks (the review's loop: none; every off day went to the lever).
    expect(m.days.filter((d) => d.skill.some((s) => s.lineup[0]?.skill === 'handstand')).length).toBeGreaterThanOrEqual(3)
    expect(m.days.filter((d) => d.skill.some((s) => s.lineup[0]?.skill === 'frontlever')).length).toBeGreaterThanOrEqual(3)
  })

  it('with home as the active place plans gym days at the gym, and the lever where its bar is', () => {
    run()
    const m = season(teen({}, { active: 'home' }), 28)
    const ctrlDays = ctrl.days.slice(0, 28)
    expectExposures(m, ctrl, ctrlDays)
    // Measured 0.91 over weeks 2–4 (0.88 before round 5b's hour-long weekend days).
    expect(keySets(weeksOf(m).slice(1).flat(), 'planche') / keySets(weeksOf({ ...ctrl, days: ctrlDays }).slice(1).flat(), 'planche')).toBeGreaterThanOrEqual(0.84)
    for (const d of m.days.filter((x) => x.plan.gym)) {
      expect(d.plan.gym!.placeId, dayKey(d.at)).toBe(GYM_PLACE.id)
      expect(d.gym!.items.some((it) => it.kg !== undefined), `${dayKey(d.at)} ${d.gym!.items.map((it) => it.id).join(', ')}`).toBe(true)
    }
    // Measured: 5 lever-led sessions in four weeks (the review's loop: none in 28 days).
    expect(m.days.filter((d) => d.skill.some((s) => s.lineup[0]?.skill === 'frontlever')).length).toBeGreaterThanOrEqual(4)
  })
})
