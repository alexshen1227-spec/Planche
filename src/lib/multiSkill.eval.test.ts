import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppState, SkillId, StepId } from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { STEP_BY_ID, stepsOf } from '../data/progressions'
import { SKILLS, skillOfExercise } from '../data/skills'
import { finalizeWorkoutWithPlan } from '../data/workouts'
import { isHardSession, LOADED_STRAIN, strainOf } from './signals'
import { weightedHoldSeconds } from './loading'
import { runSkillLoop, startingState, type SkillLoopDay } from './skillLoop'
import { trackOf } from './skills'
import { workingCeiling } from './workingTarget'

/**
 * The closed loop, for every road and for mixes of them.
 *
 * `closedLoop.eval` runs the planche's loop and found six faults no unit test
 * could. Run for the other skills, the same loop found four more within a
 * day of existing:
 *
 * - a skill riding along as maintenance or balance practice was given 40% less
 *   every session, because the session did not record the base target its two
 *   sets were built from — a wall plank went from 15s to 1s and stayed there;
 * - its re-test was stripped every time ("the lead holds the one max effort"),
 *   so nothing could ever measure it back up;
 * - a couple of maintenance sets counted as "trained", so with four or five
 *   skills the lower ones never got a full part of a session again;
 * - and in sessions short enough for one skill, the second skill was never
 *   trained at all.
 *
 * The athlete here is obedient and steadily improving (lib/skillLoop.ts), so
 * anything that stalls, starves or shrinks is the app's doing.
 */

type Season = { days: SkillLoopDay[]; state: AppState; skills: SkillId[]; minutes: number }

const seasons: Record<string, Season> = {}

function run(name: string, skills: SkillId[], sessions: number, minutes = 45) {
  const { days, state } = runSkillLoop({ skills, sessions, sessionMinutes: minutes, setClock: (at) => vi.setSystemTime(at) })
  seasons[name] = { days, state, skills, minutes }
}

beforeAll(() => {
  vi.useFakeTimers()
  run('frontlever', ['frontlever'], 40)
  run('handstand', ['handstand'], 40)
  run('ninety', ['ninety'], 40)
  run('flag', ['flag'], 40)
  run('three', ['frontlever', 'handstand', 'planche'], 45)
  run('five', ['planche', 'frontlever', 'handstand', 'ninety', 'flag'], 45, 60)
  run('four', ['planche', 'frontlever', 'flag', 'handstand'], 30)
  run('short', ['planche', 'frontlever'], 30, 20)
}, 600_000)

afterAll(() => vi.useRealTimers())

const SOLO: SkillId[] = ['frontlever', 'handstand', 'ninety', 'flag']

/** The working (not maximal) key-hold block a session gave a skill, if any. */
function workingBlock(day: SkillLoopDay, skill: SkillId) {
  const stepId = day.stepsBefore[skill]
  if (!stepId) return undefined
  return day.workout.blocks.find(
    (b) => b.section === 'main' && b.role === 'skill' && b.exerciseId === STEP_BY_ID[stepId].keyExerciseId && b.target.kind === 'hold',
  )
}

/** Whether a skill had any of its own work in a session. */
const trainedIn = (day: SkillLoopDay, skill: SkillId) =>
  day.workout.blocks.some((b) => b.section !== 'warmup' && b.section !== 'cooldown' && (b.skill ?? skillOfExercise(b.exerciseId)) === skill)

const fullPart = (day: SkillLoopDay, skill: SkillId) => {
  const role = day.lineup.find((entry) => entry.skill === skill)?.role
  return role === 'lead' || role === 'partner'
}

/** Every sentence a session can put in front of the athlete. */
function wordsOf(day: SkillLoopDay): string[] {
  return [
    day.workout.name,
    day.workout.focus,
    day.workout.purpose ?? '',
    day.plan.dayReason,
    day.plan.strategyReason,
    ...(day.workout.adjustments ?? []),
    ...day.workout.blocks.map((b) => b.note ?? ''),
    ...day.plan.decisions.map((d) => d.text),
    ...day.lineup.map((entry) => entry.reason),
  ]
}

describe('each new skill, trained alone for a season', () => {
  for (const skill of SOLO) {
    it(`${skill}: the athlete moves up the road`, () => {
      const { state } = seasons[skill]
      const road = stepsOf(skill)
      const reached = STEP_BY_ID[trackOf(state, skill).stepId].order
      // Steadily stronger for forty sessions: at least one step, and two on the
      // roads whose first step is a short prerequisite.
      expect(reached, `${skill} ended on ${road[reached].id}`).toBeGreaterThanOrEqual(skill === 'handstand' ? 1 : 2)
    })

    it(`${skill}: every session is the skill's own, inside its time, at a target under the bar`, () => {
      const { days, minutes } = seasons[skill]
      for (const [i, day] of days.entries()) {
        const where = `${skill} session ${i + 1}`
        expect(day.workout.minutes, where).toBeLessThanOrEqual(minutes + 1)
        expect(day.lineup.map((entry) => `${entry.skill}:${entry.role}`), where).toEqual([`${skill}:lead`])
        const stepId = day.stepsBefore[skill]!
        const key = STEP_BY_ID[stepId].keyExerciseId
        expect(day.workout.blocks.some((b) => b.section === 'main' && b.exerciseId === key), `${where}: no key hold`).toBe(true)
        const working = workingBlock(day, skill)
        if (working && working.target.kind === 'hold') {
          expect(working.target.sec, `${where}: working target at the bar`).toBeLessThanOrEqual(workingCeiling(STEP_BY_ID[stepId]))
          expect(working.target.sec, where).toBeGreaterThanOrEqual(1)
        }
        // One maximal effort a session, at most.
        expect(day.workout.blocks.filter((b) => b.role === 'attempt').length, where).toBeLessThanOrEqual(1)
      }
    })

    it(`${skill}: the hold is measured at its max within the first dozen sessions`, () => {
      const { days } = seasons[skill]
      const first = days.findIndex((day) => day.workout.blocks.some((b) => b.role === 'attempt'))
      expect(first, `${skill}: no max effort in ${days.length} sessions`).toBeGreaterThanOrEqual(0)
      expect(first).toBeLessThan(12)
    })

    it(`${skill}: the coach never talks about the planche, and never prints a hole`, () => {
      const { days } = seasons[skill]
      for (const [i, day] of days.entries()) {
        // A movement's own name is not the coach talking: the 90° push-up line
        // starts on the pseudo planche push-up, and says so.
        const names = day.workout.blocks.map((b) => EXERCISE_BY_ID[b.exerciseId].name.toLowerCase())
        for (const text of wordsOf(day)) {
          const said = names.reduce((rest, name) => rest.split(name).join(''), text.toLowerCase())
          expect(said, `${skill} session ${i + 1}: ${text}`).not.toMatch(/planche/)
          expect(text, `${skill} session ${i + 1}`).not.toMatch(/undefined|NaN|\[object/)
        }
      }
    })
  }

  it('says what a session is in the skill’s own words', () => {
    const lever = seasons.frontlever.days.flatMap(wordsOf).join(' ')
    expect(lever).toMatch(/pull/i)
    expect(lever).not.toMatch(/push-up version/i)
    const flag = seasons.flag.days.flatMap(wordsOf).join(' ')
    // "The pressing and pulling twin of this step" was not a sentence.
    expect(flag).not.toMatch(/pressing and pulling twin/)
  })
})

describe('several skills, one athlete', () => {
  for (const name of ['three', 'five'] as const) {
    it(`${name}: the first priority leads every session`, () => {
      const { days, skills } = seasons[name]
      for (const [i, day] of days.entries()) {
        expect(day.lineup[0], `session ${i + 1}`).toMatchObject({ skill: skills[0], role: 'lead' })
        expect(trainedIn(day, skills[0]), `session ${i + 1}`).toBe(true)
      }
    })

    it(`${name}: every skill comes round for a full part, the higher priorities more often`, () => {
      const { days, skills } = seasons[name]
      const full = (skill: SkillId) => days.filter((day) => fullPart(day, skill)).length
      // No skill waits longer than this many sessions for real work.
      const window = name === 'three' ? 6 : 12
      for (const skill of skills) {
        for (let start = 0; start + window <= days.length; start++) {
          const got = days.slice(start, start + window).some((day) => fullPart(day, skill))
          expect(got, `${skill} had no full part in sessions ${start + 1}–${start + window}`).toBe(true)
        }
      }
      // Priority is a weighting, not a gate: more for the second than the last.
      expect(full(skills[1])).toBeGreaterThan(full(skills[skills.length - 1]))
    })

    it(`${name}: no skill's working target shrinks away while it is not leading`, () => {
      const { days, skills } = seasons[name]
      for (const skill of skills) {
        const best = new Map<StepId, number>()
        for (const [i, day] of days.entries()) {
          const working = workingBlock(day, skill)
          const stepId = day.stepsBefore[skill]!
          if (!working || working.target.kind !== 'hold') continue
          const loaded = day.plan.dayType === 'push' || day.plan.dayType === 'build'
          const soFar = best.get(stepId) ?? 0
          // A lighter strategy or a rounding step, yes. Half of what was already
          // being held, on a normal training day, is the target eating itself.
          if (loaded) {
            expect(working.target.sec, `${skill} session ${i + 1} on ${stepId}: ${working.target.sec}s after ${soFar}s`).toBeGreaterThanOrEqual(
              Math.floor(soFar * 0.5),
            )
          }
          best.set(stepId, Math.max(soFar, working.target.sec))
        }
      }
    })

    it(`${name}: every skill is measured at its max, one maximal effort a session`, () => {
      const { days, skills } = seasons[name]
      for (const [i, day] of days.entries()) {
        expect(day.workout.blocks.filter((b) => b.role === 'attempt').length, `session ${i + 1}`).toBeLessThanOrEqual(1)
      }
      for (const skill of skills) {
        const efforts = days.filter((day) => day.workout.blocks.some((b) => b.role === 'attempt' && (b.skill ?? skillOfExercise(b.exerciseId)) === skill))
        expect(efforts.length, `${skill} was never measured in ${days.length} sessions`).toBeGreaterThanOrEqual(1)
      }
    })

    it(`${name}: sessions fit their time and record what each skill's part was`, () => {
      const { days, minutes } = seasons[name]
      for (const [i, day] of days.entries()) {
        expect(day.workout.minutes, `session ${i + 1}`).toBeLessThanOrEqual(minutes + 1)
        expect(day.session.roles, `session ${i + 1}`).toEqual(Object.fromEntries(day.lineup.map((entry) => [entry.skill, entry.role])))
        // Every skill in the line-up really is in the session.
        for (const entry of day.lineup) expect(trainedIn(day, entry.skill), `session ${i + 1}: ${entry.skill}`).toBe(true)
        for (const text of wordsOf(day)) expect(text, `session ${i + 1}`).not.toMatch(/undefined|NaN|\[object/)
      }
    })
  }

  it('three skills: each of them moves', () => {
    const { state } = seasons.three
    expect(STEP_BY_ID[trackOf(state, 'frontlever').stepId].order).toBeGreaterThanOrEqual(2)
    expect(STEP_BY_ID[trackOf(state, 'handstand').stepId].order).toBeGreaterThanOrEqual(1)
  })

  it('five skills: the lower priorities still progress', () => {
    const { state } = seasons.five
    const order = (skill: SkillId) => STEP_BY_ID[trackOf(state, skill).stepId].order
    expect(order('planche')).toBeGreaterThanOrEqual(1)
    expect(order('frontlever')).toBeGreaterThanOrEqual(1)
    expect(order('handstand')).toBeGreaterThanOrEqual(1)
    // Fourth of five, trained in full about once in five sessions — and still up a step.
    expect(order('ninety')).toBeGreaterThanOrEqual(1)
  })

  it('a balance skill rides along as practice when it holds no strength slot', () => {
    const { days } = seasons.five
    const practice = days.filter((day) => day.lineup.some((entry) => entry.skill === 'handstand' && entry.role === 'practice'))
    expect(practice.length).toBeGreaterThan(5)
    for (const day of practice) {
      // Practice is its holds and its balance drill: no pressing line, no core of its own.
      const own = day.workout.blocks.filter((b) => b.skill === 'handstand' && b.section !== 'warmup' && b.section !== 'cooldown')
      expect(own.every((b) => b.section === 'main' || b.role === 'balance')).toBe(true)
    }
  })
})

describe('what a part of a mixed session is made of', () => {
  /** A strength-section movement brought by this skill's own part. */
  const strengthFor = (day: SkillLoopDay, skill: SkillId) =>
    day.workout.blocks.some((b) => b.section === 'strength' && b.skill === skill)
  const loadedDay = (day: SkillLoopDay) => day.plan.dayType === 'push' || day.plan.dayType === 'build'

  for (const name of ['three', 'four', 'five'] as const) {
    it(`${name}: a second skill gets its strength movement, not only its holds`, () => {
      // Every hold of every full part once went in before anything else, and a
      // second skill's holds took the room its strength movement needed: the
      // front lever got a pulling movement in four partner sessions of
      // thirteen, the flag in none of seven.
      const { days } = seasons[name]
      const partnered = days.filter(loadedDay).flatMap((day) =>
        day.lineup.filter((entry) => entry.role === 'partner').map((entry) => ({ day, skill: entry.skill })),
      )
      expect(partnered.length).toBeGreaterThan(10)
      const withStrength = partnered.filter(({ day, skill }) => strengthFor(day, skill))
      expect(withStrength.length / partnered.length, `${withStrength.length} of ${partnered.length}`).toBeGreaterThanOrEqual(0.9)
      // And the lead keeps its own, every loaded day.
      for (const [i, day] of days.entries()) {
        if (loadedDay(day)) expect(strengthFor(day, day.lineup[0].skill), `session ${i + 1}: the lead has no strength movement`).toBe(true)
      }
    })

    it(`${name}: a short dose is two sets of the hold and nothing else`, () => {
      const { days } = seasons[name]
      for (const [i, day] of days.entries()) {
        for (const entry of day.lineup.filter((e) => e.role === 'maintenance')) {
          const own = day.workout.blocks.filter((b) => b.skill === entry.skill && b.section !== 'warmup' && b.section !== 'cooldown')
          const where = `session ${i + 1}: ${entry.skill}`
          expect(own.every((b) => b.section === 'main'), where).toBe(true)
          const hold = own.find((b) => b.role === 'skill')!
          expect(hold, where).toBeDefined()
          expect(hold.sets, where).toBe(EXERCISE_BY_ID[hold.exerciseId].perSide ? 4 : 2)
        }
      }
    })

    it(`${name}: nothing the session says promises a day it cannot know`, () => {
      const { days } = seasons[name]
      for (const [i, day] of days.entries()) {
        for (const text of wordsOf(day)) {
          // "Waits for a later session this week" and "comes back on a day it
          // trains alone" were both said of skills neither was true of.
          expect(text, `session ${i + 1}`).not.toMatch(/this week|trains alone|later session/i)
        }
      }
    })
  }

  for (const name of ['four', 'five'] as const) {
    it(`${name}: how often a skill appears follows the athlete's order`, () => {
      // Balance practice once rode along in every session whatever its rank:
      // ranked last of four, the handstand was in thirty sessions of thirty
      // and the third priority in seven.
      const { days, skills } = seasons[name]
      const appearances = (skill: SkillId) => days.filter((day) => day.lineup.some((entry) => entry.skill === skill)).length
      const full = (skill: SkillId) => days.filter((day) => fullPart(day, skill)).length
      for (let rank = 0; rank + 1 < skills.length; rank++) {
        expect(appearances(skills[rank]), `${skills[rank]} against ${skills[rank + 1]}`).toBeGreaterThanOrEqual(appearances(skills[rank + 1]))
        expect(full(skills[rank]), `${skills[rank]} against ${skills[rank + 1]}, full parts`).toBeGreaterThanOrEqual(full(skills[rank + 1]))
      }
      // Nobody is forgotten: the last priority still appears about one session in three or more.
      expect(appearances(skills[skills.length - 1]) / days.length).toBeGreaterThanOrEqual(0.3)
    })
  }

  it('builds the same season whatever the wall clock says', () => {
    // Every builder takes the time it plans for. Two of them read the wall
    // clock for the working target instead, so a history replayed from another
    // date lost its "done as prescribed" floor: a compliant athlete's targets
    // fell from 12s to 3s. The same season, with the system clock parked years
    // away from the sessions, has to come out identical.
    const shape = (days: SkillLoopDay[]) =>
      days.map((day) =>
        day.workout.blocks.map((b) => `${b.exerciseId}:${b.sets}x${b.target.kind === 'hold' ? `${b.target.sec}s` : b.target.reps}`).join(' '),
      )
    const options = { skills: ['planche', 'frontlever', 'handstand'] as SkillId[], sessions: 24, sessionMinutes: 45 }
    const onTime = runSkillLoop({ ...options, setClock: (at) => vi.setSystemTime(at) })
    const parked = new Date(2031, 6, 1, 9, 0).getTime()
    const adrift = runSkillLoop({ ...options, setClock: () => vi.setSystemTime(parked) })
    expect(shape(adrift.days)).toEqual(shape(onTime.days))
  })
})

describe('sessions short enough for one skill', () => {
  it('rotates the one slot, the main skill about two times in three', () => {
    const { days, skills } = seasons.short
    for (const [i, day] of days.entries()) {
      expect(day.lineup.length, `session ${i + 1}`).toBe(1)
      expect(day.lineup[0].reason).toMatch(/one skill at a time/)
    }
    const share = days.filter((day) => day.lineup[0].skill === skills[0]).length / days.length
    expect(share).toBeGreaterThan(0.55)
    expect(share).toBeLessThan(0.75)
    // The second skill is never left more than three sessions.
    for (let start = 0; start + 4 <= days.length; start++) {
      expect(days.slice(start, start + 4).some((day) => day.lineup[0].skill === skills[1]), `sessions ${start + 1}–${start + 4}`).toBe(true)
    }
  })

  it('keeps a one-off short version of a longer session with the main skill', () => {
    const state = startingState({ skills: ['planche', 'frontlever'], sessionMinutes: 45 })
    const { lineup } = finalizeWorkoutWithPlan(state, { source: 'auto', minutes: 15 })
    expect(lineup.map((entry) => entry.skill)).toEqual(['planche'])
  })
})

describe('the body’s rails cover every skill', () => {
  it('counts a hard front lever, flag or 90° session as hard', () => {
    for (const exerciseId of ['front-lever', 'human-flag', 'ninety-hold', 'tuck-planche']) {
      const session = {
        id: 's',
        startedAt: 0,
        endedAt: 1,
        workoutName: 'x',
        workoutKind: 'auto' as const,
        stepId: 'tuck' as StepId,
        rpe: 9,
        sets: [1, 2, 3].map((n) => ({ exerciseId, kind: 'hold' as const, value: 6, target: 6, section: 'main' as const, at: n })),
      }
      expect(isHardSession(session), exerciseId).toBe(true)
      // The same seconds, the same strain as the planche's: the new lines once
      // fell to a fifth of it and the next day was planned as if rested.
      expect(strainOf(session), exerciseId).toBeCloseTo(strainOf({ ...session, sets: session.sets.map((set) => ({ ...set, exerciseId: 'tuck-planche' })) }), 6)
    }
    expect(LOADED_STRAIN).toBeGreaterThan(0)
  })

  it('weighs every key hold on every road in the weekly load', () => {
    for (const def of Object.values(SKILLS)) {
      for (const step of def.steps) {
        const session = {
          id: 's',
          startedAt: 0,
          endedAt: 1,
          workoutName: 'x',
          workoutKind: 'auto' as const,
          stepId: 'tuck' as StepId,
          sets: [{ exerciseId: step.keyExerciseId, kind: 'hold' as const, value: 10, target: 10, section: 'main' as const, at: 1 }],
        }
        expect(weightedHoldSeconds(session), `${step.keyExerciseId} weighs nothing`).toBeGreaterThan(0)
      }
    }
  })

  it('takes loaded work off the whole session on a pain day, whatever the skills', () => {
    const now = new Date(2026, 0, 5, 18, 0).getTime()
    vi.setSystemTime(now)
    const state = startingState({ skills: ['frontlever', 'handstand', 'planche'] })
    const checkIn = { at: now, energy: 'ok' as const, joints: 'pain' as const, regions: ['elbow' as const] }
    const { workout, plan } = finalizeWorkoutWithPlan(state, { source: 'auto' }, checkIn, now)
    expect(plan.loadPermission).toBe('none')
    for (const block of workout.blocks) {
      const exercise = EXERCISE_BY_ID[block.exerciseId]
      expect(['planche', 'lever', 'handstand', 'ninety', 'flag', 'push', 'pull'], `${exercise.name} on a pain day`).not.toContain(exercise.category)
    }
  })
})
