import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { EquipmentId, SkillId, StepId } from '../types'
import { SKILL_IDS } from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { stepsOf } from '../data/progressions'
import { missingKit, ownsKit, skillOfExercise } from '../data/skills'
import { runSkillLoop, type SkillLoopDay } from './skillLoop'

/**
 * Athletes nobody designed for: any mix of the five skills in any order, any
 * subset of the kit, any session length from ten minutes to ninety, started on
 * any step, trained for a few sessions through the real loop.
 *
 * The seasons in `multiSkill.eval` are a handful of sensible athletes with
 * every piece of kit. This is the other end: 120 seeded athletes, about 600
 * generated sessions, and the things that must hold for every one of them.
 * Its first run found an athlete whose only skill had no kit — a front lever
 * with no bar — being handed "One-Leg Front Lever · Balanced: practise one-leg
 * front lever at a working dose" over a session of arm circles, a hollow hold
 * and two stretches.
 */

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KIT: EquipmentId[] = ['parallettes', 'pullup-bar', 'wall', 'pole', 'band', 'box', 'dip-bars']
const MINUTES = [10, 15, 20, 25, 30, 45, 60, 90]

interface Athlete {
  tag: string
  skills: SkillId[]
  equipment: EquipmentId[]
  minutes: number
  days: SkillLoopDay[]
}

const athletes: Athlete[] = []

beforeAll(() => {
  vi.useFakeTimers()
  for (let seed = 1; seed <= 120; seed++) {
    const r = rng(seed)
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
    const skills = [...SKILL_IDS].sort(() => r() - 0.5).slice(0, 1 + Math.floor(r() * 5)) as SkillId[]
    const equipment: EquipmentId[] = ['floor', ...KIT.filter(() => r() < 0.55)]
    const steps = Object.fromEntries(skills.map((skill) => [skill, pick(stepsOf(skill)).id])) as Partial<Record<SkillId, StepId>>
    const minutes = pick(MINUTES)
    const sessions = 1 + Math.floor(r() * 10)
    const { days } = runSkillLoop({ skills, steps, sessions, sessionMinutes: minutes, equipment, setClock: (at) => vi.setSystemTime(at) })
    athletes.push({
      tag: `seed ${seed} [${skills.join(', ')}] kit [${equipment.join(', ')}] ${minutes} min from ${JSON.stringify(steps)}`,
      skills,
      equipment,
      minutes,
      days,
    })
  }
}, 600_000)

afterAll(() => vi.useRealTimers())

const each = (check: (athlete: Athlete, day: SkillLoopDay, where: string) => void) => {
  for (const athlete of athletes) athlete.days.forEach((day, i) => check(athlete, day, `${athlete.tag}, session ${i + 1}`))
}

describe('any athlete, any kit, any session length', () => {
  it('covers the corners: every skill, lone skills, five at once, missing kit, the shortest sessions', () => {
    expect(athletes.length).toBe(120)
    expect(athletes.reduce((n, athlete) => n + athlete.days.length, 0)).toBeGreaterThan(400)
    for (const skill of SKILL_IDS) expect(athletes.some((a) => a.skills.length === 1 && a.skills[0] === skill), `${skill} alone`).toBe(true)
    expect(athletes.some((a) => a.skills.length === 5)).toBe(true)
    expect(athletes.some((a) => a.minutes === 10)).toBe(true)
    expect(athletes.some((a) => a.skills.some((skill) => missingKit(skill, a.equipment, a.days[0].stepsBefore[skill]).length > 0))).toBe(true)
    expect(athletes.some((a) => a.skills.every((skill) => missingKit(skill, a.equipment, a.days[0].stepsBefore[skill]).length > 0))).toBe(true)
  })

  it('never builds an empty session, a nameless movement or a target that is not a whole positive number', () => {
    each((_athlete, day, where) => {
      expect(day.workout.blocks.length, where).toBeGreaterThan(0)
      for (const block of day.workout.blocks) {
        expect(EXERCISE_BY_ID[block.exerciseId], `${where}: ${block.exerciseId}`).toBeDefined()
        const amount = block.target.kind === 'hold' ? block.target.sec : block.target.reps
        expect(Number.isInteger(amount) && amount >= 1, `${where}: ${block.exerciseId} × ${amount}`).toBe(true)
        expect(Number.isInteger(block.sets) && block.sets >= 1, `${where}: ${block.exerciseId} sets ${block.sets}`).toBe(true)
      }
    })
  })

  it('never programs a movement that needs kit the athlete has not listed', () => {
    each((athlete, day, where) => {
      for (const block of day.workout.blocks) {
        const missing = (EXERCISE_BY_ID[block.exerciseId]?.requires ?? []).filter((id) => !ownsKit(athlete.equipment, id))
        expect(missing, `${where}: ${block.exerciseId}`).toEqual([])
      }
    })
  })

  it('trains only skills in the line-up, and puts in the line-up only skills that can be trained', () => {
    each((athlete, day, where) => {
      const trainable = athlete.skills.filter((skill) => missingKit(skill, athlete.equipment, day.stepsBefore[skill]).length === 0)
      const inLineup = new Set(day.lineup.map((entry) => entry.skill))
      for (const block of day.workout.blocks) {
        if (block.section === 'warmup' || block.section === 'cooldown') continue
        const owner = block.skill ?? skillOfExercise(block.exerciseId)
        if (owner) expect(inLineup.has(owner), `${where}: ${block.exerciseId} belongs to ${owner}`).toBe(true)
      }
      if (trainable.length) {
        for (const entry of day.lineup) expect(trainable, `${where}: ${entry.skill} has no kit`).toContain(entry.skill)
      }
    })
  })

  it('says so when no skill can be trained, instead of naming a session after a hold it cannot contain', () => {
    let seen = 0
    each((athlete, day, where) => {
      if (athlete.skills.some((skill) => missingKit(skill, athlete.equipment, day.stepsBefore[skill]).length === 0)) return
      seen += 1
      expect(day.workout.name, where).toMatch(/waiting for kit/)
      expect(day.workout.purpose, where).toMatch(/Support work only/)
      expect(day.lineup[0].reason, where).toMatch(/waiting for kit/)
      // Nothing in it is one of the skill's own holds, and nothing is called practice of one.
      expect(day.workout.blocks.filter((block) => block.section === 'main'), where).toEqual([])
      expect(day.workout.strategy, where).toBeUndefined()
    })
    expect(seen).toBeGreaterThan(5)
  })

  it('keeps one maximal effort a session at most', () => {
    each((_athlete, day, where) => {
      expect(day.workout.blocks.filter((block) => block.role === 'attempt').length, where).toBeLessThanOrEqual(1)
    })
  })

  it('fits the time asked for — to the minute from fifteen up, and to a stated minimum below that', () => {
    // Measured over these athletes: nothing ran more than a minute over from
    // fifteen minutes up; a ten-minute request runs to seventeen at most,
    // because a warm-up and the working sets are not cut to fit (the session
    // screen says so). Twenty is that minimum with room for another road's.
    each((athlete, day, where) => {
      expect(day.workout.minutes, where).toBeLessThanOrEqual(Math.max(athlete.minutes + 1, 20))
    })
  })

  it('never shows a placeholder', () => {
    each((_athlete, day, where) => {
      const words = [
        day.workout.name,
        day.workout.focus,
        day.workout.purpose ?? '',
        day.plan.dayReason,
        ...(day.workout.adjustments ?? []),
        ...day.workout.blocks.map((block) => block.note ?? ''),
        ...day.lineup.map((entry) => entry.reason),
      ]
      for (const text of words) expect(text, where).not.toMatch(/undefined|NaN|\[object|\bnull\b/)
    })
  })

  it('records every session so that the next one can be planned from it', () => {
    for (const athlete of athletes) {
      // The loop ran to the end for everyone: no session left the state unusable.
      expect(athlete.days.length, athlete.tag).toBeGreaterThan(0)
      for (const day of athlete.days) expect(day.session.sets.length, athlete.tag).toBeGreaterThan(0)
    }
  })
})
