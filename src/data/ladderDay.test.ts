import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AppState, SkillId, WorkoutRequest } from '../types'
import { SKILL_IDS } from '../types'
import { stepsOf } from './progressions'
import { SKILLS } from './skills'
import { finalizeWorkout, requestFor } from './workouts'
import { startingState } from '../lib/skillLoop'
import { ladderStatus } from '../lib/repLadder'
import { LADDER_DAY_SETS } from './skillSession'

const NOW = Date.UTC(2026, 10, 20, 12)
const GOLDEN = fileURLToPath(new URL('./ladderDay.golden.json', import.meta.url))
const KIT = ['floor', 'parallettes', 'pullup-bar', 'wall', 'pole', 'band', 'box', 'dip-bars'] as const

function athlete(skills: SkillId[], steps: Partial<Record<SkillId, string>> = {}, minutes = 45): AppState {
  return { ...startingState({ skills, steps: steps as never, sessionMinutes: minutes, equipment: [...KIT] }), startedAt: NOW - 30 * 86_400_000 }
}

/** First, middle and last step of every skill, alone and beside others. */
function cases(): { name: string; state: AppState; request: WorkoutRequest }[] {
  const out: { name: string; state: AppState; request: WorkoutRequest }[] = []
  for (const skill of SKILL_IDS) {
    const steps = stepsOf(skill)
    for (const step of [steps[0], steps[Math.floor(steps.length / 2)], steps[steps.length - 1]]) {
      const state = athlete([skill], { [skill]: step.id })
      for (const request of [
        { source: 'auto' },
        { source: 'auto', skills: [skill] },
        { source: 'auto', skills: [skill], minutes: 20 },
      ] as WorkoutRequest[]) {
        out.push({ name: `${skill}/${step.id}/${JSON.stringify(request)}`, state, request })
      }
    }
  }
  const mixed = athlete(['planche', 'frontlever', 'handstand', 'ninety', 'flag'], { handstand: 'hs-free' }, 60)
  for (const request of [{ source: 'auto' }, { source: 'auto', skills: ['handstand', 'planche'] }, { source: 'test' }] as WorkoutRequest[]) {
    out.push({ name: `mixed/${JSON.stringify(request)}`, state: mixed, request })
  }
  return out
}

// A snapshot of every session the builder made before ladder days existed.
// After an intended change to how skill sessions are built, regenerate it:
//   WRITE_GOLDEN=1 npx vitest run src/data/ladderDay.test.ts
// and read the diff of ladderDay.golden.json before committing it.
describe('sessions built without the ladder-day field', () => {
  it('are exactly what they were before the field existed', () => {
    const built = Object.fromEntries(
      cases().map(({ name, state, request }) => {
        const w = finalizeWorkout(state, request, undefined, NOW)
        // The request is stored on the workout: it is part of the result.
        return [name, w]
      }),
    )
    if (process.env.WRITE_GOLDEN || !existsSync(GOLDEN)) writeFileSync(GOLDEN, JSON.stringify(built, null, 1))
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'))
    expect(JSON.stringify(built)).toBe(JSON.stringify(golden))
    expect(Object.keys(built).length).toBeGreaterThan(40)
  })
})

describe('a skill day', () => {
  it('is a full session for that one skill at the usual minutes, whatever its priority', () => {
    const state = athlete(['planche', 'frontlever', 'handstand', 'ninety', 'flag'], {}, 45)
    for (const skill of SKILL_IDS) {
      const w = finalizeWorkout(state, { source: 'auto', skills: [skill] }, undefined, NOW)
      expect(w.skills).toEqual([skill])
      expect(w.blocks.some((b) => b.role === 'skill' && (b.skill ?? skill) === skill)).toBe(true)
      expect(w.blocks.every((b) => b.section === 'warmup' || b.section === 'cooldown' || (b.skill ?? skill) === skill)).toBe(true)
      expect(w.minutes).toBeGreaterThan(20)
    }
  })
})

describe('a ladder day', () => {
  const ladderSkills = SKILL_IDS.filter((s) => SKILLS[s].ladder)
  it('exists for the skills with a ladder', () => {
    expect(ladderSkills.sort()).toEqual(['handstand', 'ninety'])
  })
  for (const skill of ['handstand', 'ninety'] as const) {
    const state = athlete([skill], skill === 'handstand' ? { handstand: 'hs-free' } : {}, 45)
    const request: WorkoutRequest = { source: 'auto', skills: [skill], focus: 'ladder' }

    it(`${skill}: the rung is the first work after the warm-up, at about five sets, with the hold as practice`, () => {
      const w = finalizeWorkout(state, request, undefined, NOW)
      const rung = ladderStatus(state, skill)!.rung.exerciseId
      const work = w.blocks.filter((b) => b.section !== 'warmup')
      expect(work[0].exerciseId).toBe(rung)
      expect(work[0].sets).toBe(LADDER_DAY_SETS)
      expect(w.blocks.slice(0, w.blocks.length - work.length).every((b) => b.section === 'warmup')).toBe(true)
      const hold = w.blocks.find((b) => b.role === 'skill')!
      expect(hold.sets).toBeLessThanOrEqual(2)
      expect(hold.reach ?? 0).toBe(0)
      // No second maximal effort beside the rep sets.
      expect(w.blocks.some((b) => b.role === 'attempt' || b.role === 'bridge')).toBe(false)
      // The same day without the field has a longer hold and a shorter rung.
      const plain = finalizeWorkout(state, { source: 'auto', skills: [skill] }, undefined, NOW)
      expect(plain.blocks.find((b) => b.exerciseId === rung)!.sets).toBeLessThan(LADDER_DAY_SETS)
    })

    it(`${skill}: a re-plan from requestFor stays a ladder day`, () => {
      const w = finalizeWorkout(state, request, undefined, NOW)
      expect(requestFor(w).focus).toBe('ladder')
      const again = finalizeWorkout(state, requestFor(w), undefined, NOW)
      expect(again.blocks.find((b) => b.section !== 'warmup')!.sets).toBe(LADDER_DAY_SETS)
    })

    it(`${skill}: a tight budget still keeps the rung first`, () => {
      const w = finalizeWorkout(state, { ...request, minutes: 15 }, undefined, NOW)
      const rung = ladderStatus(state, skill)!.rung.exerciseId
      expect(w.blocks.some((b) => b.exerciseId === rung && b.section !== 'warmup')).toBe(true)
      expect(w.blocks.filter((b) => b.section !== 'warmup')[0].exerciseId).toBe(rung)
    })
  }

  it('is ignored by a skill with no ladder', () => {
    for (const skill of ['planche', 'frontlever', 'flag'] as const) {
      const state = athlete([skill])
      const a = finalizeWorkout(state, { source: 'auto', skills: [skill], focus: 'ladder' }, undefined, NOW)
      const b = finalizeWorkout(state, { source: 'auto', skills: [skill] }, undefined, NOW)
      expect(a.blocks).toEqual(b.blocks)
    }
  })
})
