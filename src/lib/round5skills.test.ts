import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppState, CheckIn, Session, SetLog, SkillId, Workout, WorkoutRequest } from '../types'
import { STEP_BY_ID } from '../data/progressions'
import { skillOfExercise } from '../data/skills'
import { challengeBlockedReason, finalizeFromPlan, finalizeWorkout, finalizeWorkoutWithPlan, planForToday, TEMPLATE_BY_ID } from '../data/workouts'
import { buildPlan } from './coach'
import { applySession } from './engine'
import { lineupFor, todaysLineup } from './lineup'
import { readSignals, sessionLoadsSkill } from './signals'
import { sessionFromWorkout, startingState, runSkillLoop } from './skillLoop'
import { skillView, stepOfSkill } from './skills'
import { reducer } from './store'
import { synthesizeAthlete } from './athleteSynth'

/**
 * The skill side of the fifth strict review, pinned by the decisions it made.
 *
 * The athlete it came from is fourteen, planche first and almost at an
 * advanced tuck, with the handstand push-up and the front lever beside it, on
 * a Sunday-Monday-Wednesday-Friday-Saturday week. Their words: make sure the
 * planche is not lost to everything being spread out, and that the planche,
 * the other skills and the gym all still improve.
 */

const DAY = 86_400_000
const HOUR = 3_600_000

afterEach(() => vi.useRealTimers())

function hold(exerciseId: string, sec: number, at: number, extra: Partial<SetLog> = {}): SetLog {
  return { exerciseId, kind: 'hold', value: sec, target: sec, section: 'main', at, ...extra }
}

function session(at: number, sets: SetLog[], extra: Partial<Session> = {}): Session {
  return { id: `s-${at}`, startedAt: at, endedAt: at + 30 * 60_000, workoutName: 'Test', workoutKind: 'auto', stepId: 'advtuck', sets, ...extra }
}

/** The athlete of the review: planche first at the advanced tuck, then the lever and the handstand. */
function teen(extra: { minutes?: number } = {}): AppState {
  const base = startingState({
    skills: ['planche', 'frontlever', 'handstand'],
    steps: { planche: 'advtuck', frontlever: 'fl-tuck', handstand: 'hs-wall' },
    sessionMinutes: extra.minutes ?? 45,
  })
  return { ...base, profile: { ...base.profile, birthYear: 2012 } }
}

const niggle = (state: AppState, at: number, regions: CheckIn['regions']): AppState =>
  reducer(state, { type: 'RECORD_SYMPTOM', event: { at, joints: 'niggle', regions, source: 'check-in' } })

const keyHoldSets = (workout: Workout, state: AppState, skill: SkillId) => {
  const key = STEP_BY_ID[stepOfSkill(state, skill)].keyExerciseId
  return workout.blocks
    .filter((b) => b.exerciseId === key && b.section === 'main' && b.role === 'skill' && (b.skill ?? skill) === skill)
    .reduce((sum, b) => sum + b.sets, 0)
}

/**
 * The review's week, run closed: what each day asks for is what the planner
 * gave this athlete — the lever leading on Saturday and Monday, each the day
 * after a planche session — done by an athlete who comes down at every call.
 */
const WEEK: Partial<Record<number, WorkoutRequest>> = {
  0: { source: 'auto', skills: ['planche', 'handstand'], minutes: 60 },
  1: { source: 'auto', skills: ['frontlever'], minutes: 18 },
  3: { source: 'auto', skills: ['planche', 'handstand'], minutes: 45 },
  5: { source: 'auto', skills: ['planche'], minutes: 18 },
  6: { source: 'auto', skills: ['frontlever', 'handstand'], minutes: 60 },
}

function season(weeks: number) {
  let state = teen()
  const truth = new Map<string, number>()
  const capOf = (exerciseId: string) => {
    if (!truth.has(exerciseId)) {
      const step = Object.values(STEP_BY_ID).find((s) => s.keyExerciseId === exerciseId)
      const placed = step && stepOfSkill(teen(), step.skill) === step.id
      truth.set(exerciseId, step ? step.startSec * (placed ? 1.6 : 0.8) : 30)
    }
    return truth.get(exerciseId)!
  }
  const log: { at: number; workout: Workout; skills: SkillId[]; retest: SkillId[]; flTarget?: number }[] = []
  const start = new Date(2026, 9, 3, 17, 0).getTime() // a Saturday
  vi.useFakeTimers()
  for (let d = 0; d < weeks * 7; d++) {
    const date = new Date(start)
    date.setDate(date.getDate() + d)
    const at = date.getTime()
    const request = WEEK[date.getDay()]
    if (!request) continue
    vi.setSystemTime(at)
    const { workout, lineup } = finalizeWorkoutWithPlan(state, request, undefined, at)
    const done = sessionFromWorkout(state, workout, lineup, at, `w-${d}`, capOf)
    const flKey = STEP_BY_ID[stepOfSkill(state, 'frontlever')].keyExerciseId
    const flWork = workout.blocks.find((b) => b.exerciseId === flKey && b.role === 'skill' && b.target.kind === 'hold')
    log.push({
      at,
      workout,
      skills: lineup.map((entry) => entry.skill),
      retest: workout.blocks.filter((b) => b.retest).map((b) => (b.skill ?? workout.skills?.[0] ?? 'planche') as SkillId),
      ...(flWork && flWork.target.kind === 'hold' ? { flTarget: flWork.target.sec } : {}),
    })
    state = applySession(state, done).next
    const trained = new Set(done.sets.filter((s) => s.section === 'main').map((s) => skillOfExercise(s.exerciseId)))
    for (const [id, sec] of truth) if (trained.has(skillOfExercise(id))) truth.set(id, sec + 0.3)
  }
  vi.useRealTimers()
  return { state, log, truth }
}

describe('a second skill is re-tested on the athlete’s real schedule', () => {
  it('counts a skill’s freshness from its own work and its family’s hard work, never another skill’s session', () => {
    const t = new Date(2026, 9, 5, 17).getTime()
    const planche = session(t, [hold('adv-tuck-planche', 5, t), hold('adv-tuck-planche', 5, t), hold('adv-tuck-planche', 5, t)])
    const leverDose = session(t, [hold('tuck-front-lever', 5, t), hold('tuck-front-lever', 5, t)])
    const flag = session(t, [1, 2, 3].map(() => hold('tuck-flag', 4, t)))
    const flagOnce = session(t, [hold('tuck-flag', 4, t)])
    const wristPrep = session(t, [{ exerciseId: 'wrist-rocks', kind: 'reps', value: 10, target: 10, section: 'main', at: t }])
    const empty = session(t, [hold('adv-tuck-planche', 0, t)])
    // Another skill's session is not the lever's; two sets of its own are.
    expect(sessionLoadsSkill(planche, 'frontlever')).toBe(false)
    expect(sessionLoadsSkill(planche, 'planche')).toBe(true)
    expect(sessionLoadsSkill(leverDose, 'frontlever')).toBe(true)
    // Hard work of the family counts for the lever: three main sets of the flag, not one.
    expect(skillOfExercise('tuck-flag')).toBe('flag')
    expect(sessionLoadsSkill(flag, 'frontlever')).toBe(true)
    expect(sessionLoadsSkill(flagOnce, 'frontlever')).toBe(false)
    // Nor is the handstand anyone's family.
    expect(sessionLoadsSkill(flag, 'handstand')).toBe(false)
    // Work no skill can be told from counts for every skill, as it always did.
    expect(sessionLoadsSkill(wristPrep, 'frontlever')).toBe(true)
    expect(sessionLoadsSkill(empty, 'frontlever')).toBe(true)
  })

  it('reads the lever as rested the day after a planche session, and the body as not', () => {
    const state0 = teen()
    const sat = new Date(2026, 9, 10, 17).getTime()
    const sun = sat + DAY
    const mon = sun + DAY
    const state: AppState = {
      ...state0,
      sessions: [
        { ...session(sat, [hold('tuck-front-lever', 5, sat)]), stepId: 'advtuck', skills: { frontlever: { stepId: 'fl-tuck' }, handstand: { stepId: 'hs-wall' } } },
        { ...session(sun, [hold('adv-tuck-planche', 5, sun), hold('wall-handstand', 20, sun)]), skills: { frontlever: { stepId: 'fl-tuck' }, handstand: { stepId: 'hs-wall' } } },
      ],
    }
    const lever = readSignals(skillView(state, 'frontlever'), mon)
    expect(lever.restDays).toBe(1)
    expect(lever.skillRestDays).toBe(2)
    const plancheSig = readSignals(state, mon)
    expect(plancheSig.skillRestDays).toBe(1)
    // The handstand trained yesterday too.
    expect(readSignals(skillView(state, 'handstand'), mon).skillRestDays).toBe(1)
  })

  it('re-tests the lever, and its target climbs, on a week where it always follows a planche day', () => {
    // Measured before the fix: no lever re-test in ten weeks and a 5s target
    // for all of them, while the simulated hold grew from 8s to 15s.
    const { log, truth } = season(10)
    const leverDays = log.filter((entry) => entry.skills[0] === 'frontlever')
    expect(leverDays.length).toBeGreaterThanOrEqual(18)
    const leverRetests = log.filter((entry) => entry.retest.includes('frontlever'))
    expect(leverRetests.length).toBeGreaterThanOrEqual(2)
    // Every lever day after the first follows a session the calendar day before.
    for (const day of leverDays.slice(1)) {
      const before = new Date(day.at)
      before.setDate(before.getDate() - 1)
      expect(log.some((entry) => new Date(entry.at).toDateString() === before.toDateString()), new Date(day.at).toDateString()).toBe(true)
    }
    const targets = leverDays.map((d) => d.flTarget).filter((x): x is number => x !== undefined)
    expect(Math.max(...targets.slice(-6))).toBeGreaterThan(targets[0])
    expect(truth.get('tuck-front-lever')!).toBeGreaterThan(10)
  })
})

describe('a planche-only athlete reads exactly as before', () => {
  it('has a skill rest that is the body’s rest on every day of a closed-loop season', () => {
    const { days } = runSkillLoop({ skills: ['planche'], steps: { planche: 'tuck' }, sessions: 40, trainOn: [0, 1, 3, 5, 6] })
    for (const day of days) expect(day.plan.signals.skillRestDays, new Date(day.at).toDateString()).toBe(day.plan.signals.restDays)
    // And on the days in between.
    const last = days[days.length - 1]
    let state = startingState({ skills: ['planche'], steps: { planche: 'tuck' } })
    for (const day of days) state = applySession(state, day.session).next
    for (let k = 1; k <= 5; k++) {
      const sig = readSignals(state, last.at + k * DAY)
      expect(sig.skillRestDays).toBe(sig.restDays)
    }
  })

  it('counts templates, quick logs, the minimum dose and empty sessions like any session', () => {
    const now = new Date(2026, 9, 20, 17).getTime()
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const history = synthesizeAthlete({ weeks: 6, sessionsPerWeek: 3, stepId: 'tuck', seed, now, restDaysBeforeNow: 1 + (seed % 3) })
      const extras: Session[] = [
        { ...session(now - 1 * DAY, [{ exerciseId: 'wrist-rocks', kind: 'reps', value: 10, target: 10, section: 'main', at: now - DAY }]), workoutName: TEMPLATE_BY_ID['wrist-armor'].name, workoutKind: 'template', stepId: 'tuck' },
        { ...session(now - 3 * DAY, [hold('hollow-hold', 30, now - 3 * DAY)]), workoutName: 'Core & Compression', workoutKind: 'template', stepId: 'tuck' },
        { ...session(now - 5 * DAY, [hold('tuck-planche', 3, now - 5 * DAY)]), workoutName: 'Quick Log', stepId: 'tuck' },
        { ...session(now - 9 * DAY, []), workoutKind: 'micro', stepId: 'tuck' },
      ]
      for (const sessions of [history, [...history, ...extras]]) {
        const base = startingState({ skills: ['planche'], steps: { planche: 'tuck' } })
        const state = { ...base, sessions: [...sessions].sort((a, b) => a.startedAt - b.startedAt) }
        for (let k = -10; k <= 3; k++) {
          const sig = readSignals(state, now + k * DAY)
          expect(sig.skillRestDays, `seed ${seed}, day ${k}`).toBe(sig.restDays)
        }
      }
    }
  })
})

describe('a niggle moves the lead off the skill that loads it', () => {
  const T = new Date(2026, 10, 25, 17).getTime() // a Wednesday

  it('leads with a skill that leaves the flagged wrist alone, and eases the planche into the second part', () => {
    const state = niggle(teen(), T - 60_000, ['wrist'])
    const lineup = todaysLineup(state, T, 45)
    expect(lineup.map((e) => `${e.skill}:${e.role}`)).toEqual(['frontlever:lead', 'planche:partner'])
    expect(lineup[0].reason).toMatch(/planche loads the wrist you flagged today/)
    const { workout, plan } = finalizeWorkoutWithPlan(state, { source: 'auto' }, undefined, T)
    expect(plan.skill).toBe('frontlever')
    expect(plan.loadPermission).toBe('reduced')
    expect(plan.challengeAllowed).toBe(false)
    expect(workout.skills?.[0]).toBe('frontlever')
    // The handstand loads the wrist too, and gets no short dose.
    expect(workout.blocks.some((b) => b.skill === 'handstand')).toBe(false)
    // Without the niggle, the planche leads as ever.
    expect(todaysLineup(teen(), T, 45)[0].skill).toBe('planche')
  })

  it('moves the lead of a day planned before the check-in, from the answer itself', () => {
    // The planner's day is an explicit list, written before the check-in; the
    // session is then rebuilt from it with the answer not yet saved.
    const request: WorkoutRequest = { source: 'auto', skills: ['planche', 'frontlever'], minutes: 45 }
    const answer: CheckIn = { joints: 'niggle', energy: 'ok', at: T, regions: ['wrist'] }
    expect(lineupFor(teen(), request, T).map((e) => e.skill)).toEqual(['planche', 'frontlever'])
    const moved = lineupFor(teen(), request, T, answer)
    expect(moved.map((e) => `${e.skill}:${e.role}`)).toEqual(['frontlever:lead', 'planche:partner'])
    const rebuilt = finalizeWorkoutWithPlan(teen(), request, answer, T)
    expect(rebuilt.plan.skill).toBe('frontlever')
    expect(rebuilt.lineup[0].skill).toBe('frontlever')
    expect(rebuilt.plan.loadPermission).toBe('reduced')
    // The skills asked for stay the session's.
    expect(rebuilt.workout.skills?.slice().sort()).toEqual(['frontlever', 'planche'])
  })

  it('keeps the first priority leading, under the niggle rails, when every skill loads the area', () => {
    const state = niggle(teen(), T - 60_000, ['shoulder'])
    expect(todaysLineup(state, T, 45)[0].skill).toBe('planche')
    const both = niggle(startingState({ skills: ['planche', 'handstand'], steps: { planche: 'advtuck' } }), T - 60_000, ['wrist'])
    const { plan, lineup } = finalizeWorkoutWithPlan(both, { source: 'auto' }, undefined, T)
    expect(lineup[0].skill).toBe('planche')
    expect(plan.loadPermission).toBe('reduced')
    expect(plan.volumeFactor).toBeLessThanOrEqual(0.85)
    expect(plan.challengeAllowed).toBe(false)
    // An elbow still takes loaded work off altogether.
    const elbow = niggle(teen(), T - 60_000, ['elbow'])
    expect(finalizeWorkoutWithPlan(elbow, { source: 'auto' }, undefined, T).plan.loadPermission).toBe('none')
  })

  it('gives a one-skill session to the lever, and moves an assigned day’s lead too', () => {
    const short = niggle(teen({ minutes: 20 }), T - 60_000, ['wrist'])
    expect(todaysLineup(teen({ minutes: 20 }), T, 20)[0].skill).toBe('planche')
    const turn = todaysLineup(short, T, 20)
    expect(turn.map((e) => e.skill)).toEqual(['frontlever'])
    expect(turn[0].reason).toMatch(/wrist you flagged today/)
    // Wednesday written as planche then lever.
    const planned = reducer(teen(), { type: 'SET_WEEK_PLAN', plan: { 3: ['planche', 'frontlever'] } })
    expect(todaysLineup(planned, T, 45).map((e) => e.skill)).toEqual(['planche', 'frontlever'])
    const sore = niggle(planned, T - 60_000, ['wrist'])
    const day = todaysLineup(sore, T, 45)
    expect(day.map((e) => `${e.skill}:${e.role}`)).toEqual(['frontlever:lead', 'planche:partner'])
    expect(day[0].reason).toMatch(/week plan/)
  })
})

describe('a session picked inside the rest rule is built lighter', () => {
  /** A hard planche session, then the same planche day picked 22 hours later. */
  function picked() {
    const state0 = teen()
    const t = new Date(2026, 10, 23, 17).getTime()
    const w = finalizeWorkout(state0, { source: 'auto', skills: ['planche'], minutes: 45 }, undefined, t)
    const state = applySession(state0, sessionFromWorkout(state0, w, [], t, 'hard', () => 8)).next
    return { state, at: t + 22 * HOUR }
  }
  const note = { hours: 22, ruleHours: 48 }

  it('is never a push day, asks for no target above the base, trims volume and allows nothing maximal', () => {
    const { state, at } = picked()
    const free = buildPlan(state, at)
    const inside = buildPlan(state, at, undefined, { insideRest: note })
    // The same moment without the note: an ordinary day that may push.
    expect(free.insideRest).toBeUndefined()
    expect(inside.insideRest).toEqual(note)
    expect(inside.dayType).not.toBe('push')
    expect(inside.targetFactor).toBeLessThanOrEqual(1)
    expect(inside.volumeFactor).toBeLessThanOrEqual(0.85)
    expect(inside.challengeAllowed).toBe(false)
    expect(inside.queueRetest).toBe(false)
    expect(inside.queueUnlockAttempt).toBe(false)
    expect(['volume', 'intensity', 'density']).not.toContain(inside.strategy)
    expect(challengeBlockedReason(inside)).toMatch(/48 h rest rule/)
    // Said once, with the hours and the rule, and as the athlete's own setting.
    const said = inside.decisions.filter((d) => /rest rule/.test(d.text))
    expect(said).toHaveLength(1)
    expect(said[0].text).toMatch(/22 h/)
    expect(said[0].text).toMatch(/coaching convention/)
  })

  it('builds fewer key-hold sets than the same pick without the note, from every entry point', () => {
    const { state, at } = picked()
    const request: WorkoutRequest = { source: 'auto', skills: ['planche'], minutes: 45 }
    const free = finalizeWorkoutWithPlan(state, request, undefined, at)
    const inside = finalizeWorkoutWithPlan(state, { ...request, insideRest: note }, undefined, at)
    expect(keyHoldSets(inside.workout, state, 'planche')).toBeLessThan(keyHoldSets(free.workout, state, 'planche'))
    expect(inside.workout.blocks.some((b) => b.role === 'attempt' || b.role === 'bridge' || b.retest)).toBe(false)
    // A screen previews many requests from one plan built without the note: the pick still gets its own.
    const screenPlan = planForToday(state, at)
    const preview = finalizeFromPlan(state, { ...request, insideRest: note }, screenPlan, at)
    expect(preview.plan.insideRest).toEqual(note)
    expect(keyHoldSets(preview.workout, state, 'planche')).toBe(keyHoldSets(inside.workout, state, 'planche'))
    // Every part of a mixed pick is built under it.
    const mixed = finalizeWorkoutWithPlan(state, { source: 'auto', skills: ['planche', 'frontlever'], minutes: 45, insideRest: note }, undefined, at)
    expect(mixed.plan.challengeAllowed).toBe(false)
    expect(mixed.workout.blocks.some((b) => b.role === 'attempt' || b.role === 'bridge' || b.retest)).toBe(false)
  })

  it('turns a push day into a build day when the hard session was at the gym, out of the skill log’s sight', () => {
    // Two days after the hard planche session the skill log alone reads a
    // push day; heavy pressing at the gym 20 h ago is what the rule saw.
    const { state, at } = picked()
    const later = at + 28 * HOUR
    const free = buildPlan(state, later)
    expect(free.dayType).toBe('push')
    expect(free.challengeAllowed).toBe(true)
    const inside = buildPlan(state, later, undefined, { insideRest: { hours: 20, ruleHours: 48 } })
    expect(inside.dayType).toBe('build')
    expect(inside.dayReason).toMatch(/48 h rest rule/)
    expect(inside.challengeAllowed).toBe(false)
    expect(inside.targetFactor).toBeLessThanOrEqual(1)
  })

  it('ignores a note that is not inside the rule, and leaves a no-load day to its own rail', () => {
    const { state, at } = picked()
    const outside = buildPlan(state, at, undefined, { insideRest: { hours: 50, ruleHours: 48 } })
    expect(outside.insideRest).toBeUndefined()
    expect(outside).toEqual(buildPlan(state, at))
    const pain = buildPlan(state, at, { joints: 'pain', energy: 'ok', at, regions: ['wrist'] }, { insideRest: note })
    expect(pain.loadPermission).toBe('none')
    expect(pain.decisions.some((d) => /rest rule/.test(d.text))).toBe(false)
  })
})

describe('a session shorter than its time says why, and is not called trimmed', () => {
  it('names a lever day that holds 37 of 45 minutes as it is, and keeps its blocks', () => {
    const state = teen()
    const at = new Date(2026, 10, 23, 17).getTime()
    const asked = finalizeWorkout(state, { source: 'auto', skills: ['frontlever'], minutes: 45 }, undefined, at)
    const plain = finalizeWorkout(state, { source: 'auto', skills: ['frontlever'] }, undefined, at)
    expect(asked.minutes).toBeLessThan(45 - 4)
    expect(asked.name).not.toMatch(/Short/)
    expect(asked.focus).not.toMatch(/Trimmed/)
    expect(asked.adjustments?.some((a) => /holds about \d+ minutes/.test(a))).toBe(true)
    expect(asked.blocks).toEqual(plain.blocks)
    // A ladder day says what it keeps, and where the full hold practice is.
    const ladder = finalizeWorkout(state, { source: 'auto', skills: ['handstand'], focus: 'ladder', minutes: 45 }, undefined, at)
    expect(ladder.name).not.toMatch(/Short/)
    expect(ladder.adjustments?.some((a) => /ladder day holds about \d+ minutes/.test(a))).toBe(true)
    // Twenty minutes does take things off: that one is short, and says so.
    const twenty = finalizeWorkout(state, { source: 'auto', skills: ['frontlever'], minutes: 20 }, undefined, at)
    expect(twenty.name).toMatch(/Short/)
    expect(twenty.adjustments?.some((a) => /holds about/.test(a))).toBe(false)
  })

  it('does the same for a planche day that is light by design', () => {
    // A second loaded session today is skill work only, under a 30-minute cap:
    // it was called "Short — accessories came off first" with nothing taken off.
    const state0 = teen()
    const at = new Date(2026, 10, 23, 17).getTime()
    const w = finalizeWorkout(state0, { source: 'auto', skills: ['planche'] }, undefined, at)
    const state = applySession(state0, sessionFromWorkout(state0, w, [], at, 'first', () => 8)).next
    const later = at + 2 * HOUR
    const asked = finalizeWorkoutWithPlan(state, { source: 'auto', skills: ['planche'], minutes: 45 }, undefined, later)
    expect(asked.plan.dayType).toBe('technique')
    expect(asked.workout.minutes).toBeLessThan(30)
    expect(asked.workout.name).not.toMatch(/Short/)
    expect(asked.workout.focus).not.toMatch(/Trimmed/)
    expect(asked.workout.blocks).toEqual(finalizeWorkout(state, { source: 'auto', skills: ['planche'] }, undefined, later).blocks)
  })
})

describe('a step the athlete cannot hold yet', () => {
  it('keeps its target and says what to do, through the shape before it', () => {
    const base = teen()
    const placed: AppState = {
      ...base,
      assessment: { at: base.startedAt, answers: { 'adv-tuck-planche': 0, 'tuck-planche': 12 }, placedStepId: 'advtuck', confidence: 'good', gapIds: [] },
    }
    const w = finalizeWorkout(placed, { source: 'auto', skills: ['planche'] }, undefined, new Date(2026, 10, 23, 17).getTime())
    const key = w.blocks.find((b) => b.exerciseId === 'adv-tuck-planche' && b.role === 'skill')!
    expect(key.target).toEqual({ kind: 'hold', sec: 5 })
    expect(key.note).toMatch(/every step starts there/)
    expect(key.note).toMatch(/tuck planche/)
    expect(key.note).not.toMatch(/smaller lean/)
  })
})

describe('a partner does not cost the first priority its dose', () => {
  it('holds the planche’s key-hold sets beside a partner in 45 minutes, and keeps the partner’s floor and moving version', () => {
    // Measured before: 6 sets alone, 4 beside the lever or the handstand.
    const state = teen()
    const at = new Date(2026, 10, 23, 17).getTime()
    const alone = finalizeWorkout(state, { source: 'auto', skills: ['planche'], minutes: 45 }, undefined, at)
    const lead = keyHoldSets(alone, state, 'planche')
    expect(lead).toBe(6)
    for (const partner of ['frontlever', 'handstand'] as const) {
      const mixed = finalizeWorkout(state, { source: 'auto', skills: ['planche', partner], minutes: 45 }, undefined, at)
      expect(keyHoldSets(mixed, state, 'planche'), partner).toBe(lead)
      expect(keyHoldSets(mixed, state, partner), partner).toBeGreaterThanOrEqual(2)
      expect(mixed.blocks.some((b) => b.skill === partner && b.role === 'press'), partner).toBe(true)
      // The session's one core block stays in: behind the partner's extra
      // holds it fell out of most 45-minute sessions once the dose went first.
      expect(mixed.blocks.some((b) => b.section === 'core'), partner).toBe(true)
      expect(mixed.minutes).toBeLessThanOrEqual(45)
    }
  })

  it('holds it across a season of the review’s week too', () => {
    const { state } = season(4)
    const at = state.sessions[state.sessions.length - 1].startedAt
    for (let k = 1; k <= 6; k++) {
      const t = at + k * DAY
      const alone = finalizeWorkoutWithPlan(state, { source: 'auto', skills: ['planche'], minutes: 45 }, undefined, t)
      if (alone.plan.dayType !== 'build' && alone.plan.dayType !== 'push') continue
      for (const partner of ['frontlever', 'handstand'] as const) {
        const mixed = finalizeWorkout(state, { source: 'auto', skills: ['planche', partner], minutes: 45 }, undefined, t)
        expect(keyHoldSets(mixed, state, 'planche'), `${partner} +${k}d`).toBe(keyHoldSets(alone.workout, state, 'planche'))
      }
    }
  })
})
