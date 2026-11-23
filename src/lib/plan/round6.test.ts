import { afterAll, describe, expect, it, vi } from 'vitest'
import type { AppState, Session, SetLog, StepId, WorkoutRequest } from '../../types'
import { MUSCLE_BY_ID } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { STEP_BY_ID } from '../../data/progressions'
import { finalizeWorkout } from '../../data/workouts'
import { applySession } from '../engine'
import { buildGymSession, focusMain } from '../gym/builder'
import { ladderStatus } from '../repLadder'
import { sessionFromWorkout } from '../skillLoop'
import { stepOfSkill } from '../skills'
import { reducer } from '../store'
import { addDays, dayKey, weekStart } from '../time'
import { familyEvents, restFamilyOf, setsPerMuscle, skillSetLoading, volumeTarget } from './load'
import { gymToday, insideRestRule, planWeekAhead, soreJoints } from './planner'
import { weeklySummary } from './weekly'
import { GYM_PLACE, makeAthlete, runLoop, SPORT_WEEK, weeksOf, type AthleteCfg, type LoopOut } from './wholeAthleteLoop'

/**
 * Round six: the athlete's other skills and the gym. Every rule here is pinned by the decision it makes — the event
 * counted, the day spaced, the focus chosen, the muscle kept or spared, the joint kept out — never by its sentence.
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR
/** Monday 12 October 2026, 17:00. */
const MON = new Date(2026, 9, 12, 17).getTime()
const at = (days: number, hour = 17) => new Date(2026, 9, 12 + days, hour).getTime()
const GOALS = { strength: 3, power: 2, physique: 4, skills: 5, endurance: 1 }

/** The athlete: the planche first, then the handstand push-up, then the front lever. */
const athlete = (prefs: AthleteCfg['prefs'] = {}, over: Partial<AthleteCfg> = {}): AppState =>
  makeAthlete({
    skills: ['planche', 'handstand', 'frontlever'],
    birthYear: 2012,
    steps: { planche: 'tuck' as StepId, handstand: 'hs-wall' as StepId, frontlever: 'fl-tuck' as StepId },
    prefs: { goals: GOALS, sportSchedule: SPORT_WEEK, ...prefs },
    ...over,
  })

/** The handstand push-up ladder placed at a rung: 0 pike push-up … 4 deficit wall push-up. */
function onRung(state: AppState, index: number): AppState {
  const track = state.tracks!.handstand!
  const answers = { ...(track.assessment?.answers ?? {}), 'ladder:hspu': index }
  const assessment = { at: 0, placedStepId: track.stepId, confidence: 'good' as const, gapIds: [], ...(track.assessment ?? {}), answers }
  return { ...state, tracks: { ...state.tracks, handstand: { ...track, assessment } } }
}

function doSkill(state: AppState, request: WorkoutRequest, t: number): AppState {
  const workout = finalizeWorkout(state, request, undefined, t)
  return applySession(state, sessionFromWorkout(state, workout, workout.lineup ?? [], t, `s-${t}`, () => 12)).next
}

const set = (exerciseId: string, t: number, extra: Partial<SetLog> = {}): SetLog =>
  ({ exerciseId, kind: EXERCISE_KIND(exerciseId), value: 3, target: 3, section: 'strength', at: t, ...extra }) as SetLog
const EXERCISE_KIND = (id: string) => (id.includes('planche') ? 'hold' : 'reps') as SetLog['kind']
const session = (t: number, sets: SetLog[]): Session => ({ id: `x-${t}`, startedAt: t, endedAt: t + HOUR, sets, workoutName: 'x' }) as unknown as Session

function season(cfg: AppState, days: number): LoopOut {
  const truthStart: Record<string, number> = { 'tuck-planche': 16, 'adv-tuck-planche': 4 }
  for (const skill of cfg.profile.skills ?? []) {
    const step = STEP_BY_ID[stepOfSkill(cfg, skill)]
    if (!(step.keyExerciseId in truthStart)) truthStart[step.keyExerciseId] = step.startSec * 1.6
  }
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    return runLoop(cfg, { from: new Date(2026, 9, 5), days, perSet: 0.08, truthStart, setClock: (t) => vi.setSystemTime(t) })
  } finally {
    restoreClock()
  }
}
const restoreClock = () => {
  if (process.env.FAKE_NOW) vi.setSystemTime(new Date(process.env.FAKE_NOW))
  else vi.useRealTimers()
}
afterAll(restoreClock)

describe('1. handstand push-ups are pressing for the rest rule', () => {
  it('counts a session of three hard presses as a push event, and not pike push-ups or an easy day’s light dose', () => {
    const t = MON - 2 * DAY
    expect(HARD_RUNGS.every((id) => restFamilyOf({ exerciseId: id, section: 'strength' }) === 'push')).toBe(true)
    expect(restFamilyOf({ exerciseId: 'pike-pushup', section: 'strength' })).toBeUndefined()
    expect(restFamilyOf({ exerciseId: 'elevated-pike-pushup', section: 'strength' })).toBeUndefined()
    expect(restFamilyOf({ exerciseId: 'wall-hspu', section: 'warmup' })).toBeUndefined()
    const hard = familyEvents({ sessions: [session(t, [0, 1, 2].map((k) => set('deficit-wall-hspu', t + k)))], gym: undefined }, MON).push
    expect(hard).toEqual([{ at: t, gym: false, press: true }])
    const pike = familyEvents({ sessions: [session(t, [0, 1, 2].map((k) => set('pike-pushup', t + k)))], gym: undefined }, MON).push
    expect(pike).toEqual([])
    const light = familyEvents({ sessions: [session(t, [0, 1, 2].map((k) => set('wall-hspu', t + k, { light: true })))], gym: undefined }, MON).push
    expect(light).toEqual([])
    // Mixed with planche holds it is one push event, the holds' own.
    const mixed = familyEvents({ sessions: [session(t, [set('tuck-planche', t, { section: 'main', value: 8 }), set('wall-hspu', t + 1), set('wall-hspu', t + 2)])], gym: undefined }, MON).push
    expect(mixed).toEqual([{ at: t, gym: false, press: true }])
  })

  it('names a picked handstand push-up session inside the planche’s rest rule, and not one of pike push-ups', () => {
    const planche = session(MON - 23 * HOUR, [0, 1, 2, 3].map((k) => set('tuck-planche', MON - 23 * HOUR + k, { section: 'main', value: 8 })))
    const deficit = onRung({ ...athlete(), sessions: [planche] }, 4)
    expect(ladderStatus(deficit, 'handstand')?.rung.exerciseId).toBe('deficit-wall-hspu')
    const hit = insideRestRule(deficit, ['handstand'], MON)
    expect(hit && [hit.skill, hit.family, hit.hours, hit.gym]).toEqual(['handstand', 'push', 23, false])
    // A ladder day (five sets) is the pick the probe made: named the same way.
    expect(insideRestRule(deficit, ['handstand'], MON, { focus: 'ladder', minutes: 45 })?.family).toBe('push')
    const pike = onRung({ ...athlete(), sessions: [planche] }, 0)
    expect(insideRestRule(pike, ['handstand'], MON)).toBeUndefined()
    // The planche itself is named as before; past the rule nothing is.
    expect(insideRestRule(deficit, ['planche'], MON)?.family).toBe('push')
    expect(insideRestRule(deficit, ['handstand'], MON + 30 * HOUR)).toBeUndefined()
  })

  it('never plans a hard handstand push-up session inside the rest rule of a planche day, and the plan is followed so', () => {
    const out = season(onRung(athlete(), 4), 28)
    const events = familyEvents(out.state, out.days[out.days.length - 1].at + HOUR).push
    const calendar = (a: number, b: number) => Math.round(Math.abs(new Date(a).setHours(0, 0, 0, 0) - new Date(b).setHours(0, 0, 0, 0)) / DAY)
    const presses = events.filter((e) => e.press)
    const holds = events.filter((e) => !e.press && !e.gym)
    const near = presses.flatMap((p) => holds.filter((h) => dayKey(h.at) !== dayKey(p.at) && calendar(h.at, p.at) * 24 < 48).map((h) => `${dayKey(p.at)}~${dayKey(h.at)}`))
    expect(near, 'pressing days beside planche days').toEqual([])
    // And every day planned to press so carries the block's mark (the screens' rest note reads it).
    for (const d of out.days) {
      const p = d.plan.skill
      if (!p || p.opener) continue
      const logged = out.state.sessions.find((s) => s.startedAt === d.at)
      if (!logged) continue
      const pushSets = logged.sets.reduce((n, x) => n + (restFamilyOf(x) === 'push' ? 1 : 0), 0)
      const holdSets = logged.sets.reduce((n, x) => n + (skillSetLoading(x.exerciseId, x.section)?.straightArm === 'push' && (x.section === 'main' || x.section === 'strength') ? 1 : 0), 0)
      if (pushSets >= 3 && holdSets < 3) expect(p.presses, dayKey(d.at)).toBe(true)
    }
  }, 120_000)
})

const HARD_RUNGS = ['wall-hspu-negative', 'wall-hspu', 'deficit-wall-hspu', 'freestanding-hspu']

describe('4. handstand push-ups are credited as overhead pressing', () => {
  it('credits front delts and triceps, never chest', () => {
    for (const id of ['pike-pushup', 'elevated-pike-pushup', ...HARD_RUNGS]) {
      const credit = skillSetLoading(id, 'strength')!.muscles
      expect(credit.chest, id).toBeUndefined()
      expect([credit['front-delts'], credit.triceps], id).toEqual([1, 1])
    }
    // The pseudo planche push-up is still a push-up.
    expect(skillSetLoading('pppu', 'strength')!.muscles.chest).toBe(1)
  })
})

describe('2–3. the gym focus sees the week as planned, and never spares the athlete’s priorities', () => {
  let prio: LoopOut
  const PRIORITY = ['chest-upper', 'triceps-long'] as const
  const run = () => (prio ??= season(athlete({ musclesPriority: [...PRIORITY] }), 28))

  it('chooses no gym focus whose own muscles the week has spent, and the day’s reasons name none it spares', () => {
    for (const d of run().days) {
      const g = d.plan.gym
      if (!g || g.lightPress || g.focus === 'athletic' || g.focus === 'full') continue
      const main = focusMain(g.focus).filter((m) => !g.musclesOff.includes(m))
      const spared = main.filter((m) => (g.spare ?? []).includes(m))
      expect(spared.length * 2, `${dayKey(d.at)} ${g.focus} spares ${spared}`).toBeLessThan(main.length)
      const serves = d.week.days[0].why.find((w) => w.includes('furthest from this week'))
      for (const m of g.spare ?? []) expect(serves ?? '', dayKey(d.at)).not.toContain(MUSCLE_BY_ID[m].label.toLowerCase())
    }
  }, 120_000)

  it('never spares a priority, and gives both priorities sets in every week with a gym day that can train them', () => {
    const out = run()
    for (const d of out.days) for (const w of d.week.days) {
      const spare = w.plan.gym?.spare ?? []
      for (const m of PRIORITY) expect(spare, `${w.day} spare`).not.toContain(m)
    }
    for (const week of weeksOf(out)) {
      const from = weekStart(week[0].at)
      const sets = setsPerMuscle([], out.state.gym!.sessions, from, addDays(from, 7))
      for (const m of PRIORITY) {
        // A day that could train it: not light, and its block as planned — the week's limits, no steer — has a
        // movement for it with the athlete's priorities as they are.
        const able = week.filter((d) => {
          const g = d.plan.gym
          if (!g || g.lightPress) return false
          const plain = buildGymSession({ location: GYM_PLACE, minutes: g.minutes, focus: g.focus, sessions: out.state.gym!.sessions.filter((s) => s.startedAt < d.at), youth: true, musclesOff: g.musclesOff, priority: [...PRIORITY], avoidJoints: g.avoidJoints, volumeFactor: g.volumeFactor, now: d.at })
          return plain.items.some((it) => GYM_EXERCISE_BY_ID[it.exerciseId]?.primary.includes(m))
        })
        if (able.length) expect(sets[m] ?? 0, `${dayKey(from)} ${m} with ${able.map((d) => dayKey(d.at)).join(', ')}`).toBeGreaterThan(0)
      }
    }
  }, 120_000)

  it('carries the week’s steer into a gym session after the day’s own, and never a priority', () => {
    let s = athlete({ musclesPriority: [...PRIORITY] })
    for (const day of [-6, -4, -2]) s = doSkill(s, { source: 'auto', skills: ['planche'], minutes: 45 }, at(day))
    // Today's gym session is done: "Train again" on the Gym side.
    s = reducer(s, {
      type: 'GYM',
      op: { op: 'saveSession', session: { id: 'g-today', locationId: GYM_PLACE.id, startedAt: MON - 2 * HOUR, endedAt: MON - HOUR, name: 'Lifts', completion: 'full', exercises: [{ exerciseId: 'lat-pulldown', repRange: [8, 12], targetRpe: 8, sets: [0, 1, 2].map((k) => ({ kg: 30, reps: 10, rpe: 8, at: MON - 2 * HOUR + k })) }] } },
    })
    const again = gymToday(s, { now: MON, minutes: 45, focus: 'push' })
    const week = planWeekAhead(s, MON, { todayKind: 'gym', todayFocus: 'push' }).weekTotal
    const far = (['front-delts', 'triceps'] as const).filter((m) => (week[m] ?? 0) > 1.3 * volumeTarget(m, s.gym!.prefs!)[1])
    expect(far.length, JSON.stringify(week)).toBeGreaterThan(0)
    for (const m of far) expect(again.spare, `${m} past the line`).toContain(m)
    for (const m of PRIORITY) expect(again.spare).not.toContain(m)
  })
})

describe('2–3 on the athlete with no priorities, and with a priority the planche spends', () => {
  let plain: LoopOut
  const run = () => (plain ??= season(athlete(), 28))

  it('counts the week’s planned skill days when choosing foci: no coach-chosen focus is one the week has spent', () => {
    const apart = (a: number, b: number) => Math.round(Math.abs(new Date(a).setHours(0, 0, 0, 0) - new Date(b).setHours(0, 0, 0, 0)) / DAY)
    for (const d of run().days) {
      const g = d.plan.gym
      if (!g || g.lightPress || !['push', 'pull', 'upper'].includes(g.focus)) continue
      const main = focusMain(g.focus).filter((m) => !g.musclesOff.includes(m))
      const spared = main.filter((m) => (g.spare ?? []).includes(m))
      // Only a planche opener's push day may be spent, and only when an upper day — the other focus it opens — was
      // ruled out by the pull family's rest rule (a pulling day within it).
      const forced =
        g.focus === 'push' &&
        Boolean(d.plan.skill?.opener) &&
        d.week.days.some((o) => o.day !== d.week.days[0].day && apart(o.at, d.at) < 2 && ((o.plan.skill?.hard ?? []).includes('pull') || (o.plan.gym && ['pull', 'upper'].includes(o.plan.gym.focus))))
      if (!forced) expect(spared.length * 2, `${dayKey(d.at)} ${g.focus} spares ${spared}`).toBeLessThan(main.length)
      const serves = d.week.days[0].why.find((w) => w.includes('furthest from this week')) ?? ''
      for (const m of g.spare ?? []) expect(serves, dayKey(d.at)).not.toContain(MUSCLE_BY_ID[m].label.toLowerCase())
    }
  }, 120_000)

  it('never spares a priority the planche days take far past its target, except on a light pressing day', () => {
    const s0 = athlete({ musclesPriority: ['front-delts'] })
    let s = s0
    for (const day of [-6, -4, -2]) s = doSkill(s, { source: 'auto', skills: ['planche'], minutes: 45 }, at(day))
    const week = planWeekAhead(s, MON, { todayKind: 'gym', todayFocus: 'push' })
    expect((week.weekTotal['front-delts'] ?? 0) > 1.3 * volumeTarget('front-delts', s.gym!.prefs!)[1]).toBe(true)
    for (const d of week.days) if (d.plan.gym && !d.plan.gym.lightPress) expect(d.plan.gym.spare ?? [], d.day).not.toContain('front-delts')
  })

  it('keeps another push skill’s day the rest rule away from a planned handstand push-up day', () => {
    // The athlete's own Monday is handstand push-ups (their week plan); the 90° hold's days are the coach's.
    const base = onRung(
      makeAthlete({ skills: ['handstand', 'ninety'], birthYear: 2012, steps: { handstand: 'hs-wall' as StepId }, prefs: { goals: { strength: 0, power: 0, physique: 0, skills: 5, endurance: 0 } } }),
      4,
    )
    const s: AppState = { ...base, settings: { ...base.settings, weekPlan: { 1: ['handstand'] } as never } }
    const days = planWeekAhead(s, at(-1, 9)).days
    const pressing = days.filter((d) => d.plan.skill?.presses)
    const ninety = days.filter((d) => (d.plan.skill?.hard ?? []).includes('push'))
    expect(pressing.length, days.map((d) => `${d.day} ${d.plan.skill?.skills ?? ''}`).join(' | ')).toBeGreaterThan(0)
    const apart = (a: number, b: number) => Math.round(Math.abs(new Date(a).setHours(0, 0, 0, 0) - new Date(b).setHours(0, 0, 0, 0)) / DAY)
    for (const p of pressing) for (const n of ninety) if (p.day !== n.day) expect(apart(p.at, n.at), `${p.day} ~ ${n.day}`).toBeGreaterThanOrEqual(2)
  })
})

describe('5. one pain memory for the skill side and the gym', () => {
  it('keeps a joint out of the lifts while the latest report still names it, and a later check-in clears it', () => {
    const report = { id: 'w', at: MON - 5 * DAY, joints: 'pain' as const, regions: ['wrist' as const], source: 'check-in' as const }
    const sore: AppState = { ...athlete(), symptoms: [report] }
    expect(soreJoints(sore, MON).joints).toEqual(['wrists'])
    expect(gymToday(sore, { now: MON, minutes: 45, focus: 'push' }).avoidJoints).toContain('wrists')
    const week = planWeekAhead(sore, MON).days
    for (const d of week) if (d.plan.gym) expect(d.plan.gym.avoidJoints, d.day).toContain('wrists')
    // A check-in since says it is fine: as for the coach, the report no longer stands.
    const cleared: AppState = { ...sore, symptoms: [report, { id: 'ok', at: MON - DAY, joints: 'good' as const, source: 'check-in' as const }] }
    expect(soreJoints(cleared, MON).joints).toEqual([])
    expect(gymToday(cleared, { now: MON, minutes: 45, focus: 'push' }).avoidJoints).not.toContain('wrists')
    // Three days' memory still holds a report under a later "all good" (never only the latest).
    const recent: AppState = { ...sore, symptoms: [{ ...report, at: MON - 30 * HOUR }, { id: 'ok', at: MON - DAY, joints: 'good' as const, source: 'check-in' as const }] }
    expect(soreJoints(recent, MON).joints).toEqual(['wrists'])
  })
})

describe('6. skills whose kit only the gym has are trained, and the plan says where', () => {
  it('plans a calisthenics day at the gym for a gym-only skill, with roles beside its skills', () => {
    const wallGym = { ...GYM_PLACE, equipment: [...GYM_PLACE.equipment, 'wall' as const] }
    let s = athlete({ minutesByDay: [0, 45, 0, 45, 0, 45, 0] }, { kit: ['floor', 'parallettes'], active: 'home' })
    s = { ...s, gym: { ...s.gym!, locations: s.gym!.locations.map((l) => (l.id === GYM_PLACE.id ? wallGym : l)) } }
    const days = planWeekAhead(s, MON).days
    const there = days.filter((d) => d.plan.kind === 'calisthenics' && d.plan.skill?.placeId === GYM_PLACE.id)
    expect(there.length, days.map((d) => `${d.day} ${d.kind} ${d.plan.skill?.skills ?? ''}`).join(' | ')).toBeGreaterThanOrEqual(1)
    for (const d of there) {
      expect(d.plan.skill!.skills[0], d.day).toBe('planche')
      expect(d.plan.skill!.skills.some((k) => k === 'handstand' || k === 'frontlever'), d.day).toBe(true)
      expect(d.plan.skill!.roles?.length, d.day).toBe(d.plan.skill!.skills.length)
      expect(d.plan.skill!.roles?.[0], d.day).toBe('lead')
    }
    // At home the same week gives them nothing: the gym's kit is why.
    const home = planWeekAhead({ ...s, gym: { ...s.gym!, locations: s.gym!.locations.filter((l) => l.id !== GYM_PLACE.id), activeLocationId: s.gym!.locations[0].id } }, MON).days
    expect(home.some((d) => (d.plan.skill?.skills ?? []).some((k) => k === 'handstand' || k === 'frontlever'))).toBe(false)
  })
})

describe('8. the weekly summary can refuse to say the plan steers', () => {
  it('says nothing is logged yet to a new athlete, and names what this week’s gym time cannot cover', () => {
    const fresh = weeklySummary(athlete(), MON)
    expect(fresh.focus.some((f) => f.startsWith('Nothing logged this week yet'))).toBe(true)
    expect(fresh.focus.some((f) => /under target|cannot cover/.test(f))).toBe(false)
    // One planche session on Monday, read on Sunday night: no day is left for the gym.
    const sunday = at(6, 21)
    const s = doSkill(athlete(), { source: 'auto', skills: ['planche'], minutes: 45 }, MON)
    const w = weeklySummary(s, sunday)
    const line = w.focus.find((f) => /cannot cover|cover them/.test(f)) ?? ''
    expect(line, w.focus.join(' | ')).toMatch(/^This week’s gym time cannot cover every muscle/)
    expect(planWeekAhead(s, sunday).shortfall.length).toBeGreaterThan(0)
  })
})
