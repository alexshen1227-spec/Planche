import { describe, expect, it } from 'vitest'
import type { AppState, SkillId, WorkoutRequest } from '../types'
import { SKILL_IDS } from '../types'
import { finalizeWorkout, estimateMinutes, SHORTER_THAN_ASKED_MIN } from './workouts'
import { startingState } from '../lib/skillLoop'

/**
 * A ladder day given a time fills it with the skill's own strength work after
 * the rung, inside the budget — and says so when it still falls short. The
 * review's case: `minutes: 60` built 5 × rung and two wall holds in 29.
 */

const NOW = Date.UTC(2026, 10, 20, 12)
const KIT = ['floor', 'parallettes', 'pullup-bar', 'wall', 'pole', 'band', 'box', 'dip-bars'] as const
const athlete = (skill: SkillId, step?: string): AppState => ({
  ...startingState({ skills: [skill], steps: (step ? { [skill]: step } : {}) as never, sessionMinutes: 45, equipment: [...KIT] }),
  startedAt: NOW - 30 * 86_400_000,
})
const ladder = (minutes?: number, skill: SkillId = 'handstand'): WorkoutRequest => ({ source: 'auto', skills: [skill], focus: 'ladder', ...(minutes ? { minutes } : {}) })
const setsOf = (w: { blocks: { section: string; sets: number }[] }) => w.blocks.filter((b) => b.section !== 'warmup' && b.section !== 'cooldown').reduce((n, b) => n + b.sets, 0)

describe('a ladder day with a time given', () => {
  const state = athlete('handstand', 'hs-wall')

  it('adds work after the rung, up to the budget and never past it', () => {
    const asked = finalizeWorkout(state, ladder(60), undefined, NOW)
    const bare = finalizeWorkout(state, ladder(), undefined, NOW)
    expect(setsOf(asked)).toBeGreaterThan(setsOf(bare))
    expect(asked.minutes).toBeGreaterThan(bare.minutes)
    expect(asked.minutes).toBeLessThanOrEqual(60)
    // The rung is still the first work after the warm-up, at its five sets.
    const work = asked.blocks.filter((b) => b.section !== 'warmup')
    expect(work[0].role).toBe('press')
    expect(work[0].sets).toBe(5)
    expect(estimateMinutes(asked.blocks)).toBe(asked.minutes)
  })

  it('never goes over a smaller budget', () => {
    for (const minutes of [20, 25, 30, 40, 50]) {
      const w = finalizeWorkout(state, ladder(minutes), undefined, NOW)
      expect(w.minutes, `${minutes}`).toBeLessThanOrEqual(Math.max(minutes, 27))
    }
  })

  it('keeps the maximal effort single and the rung first on every budget', () => {
    for (const minutes of [15, 30, 60, 90]) {
      const w = finalizeWorkout(state, ladder(minutes), undefined, NOW)
      expect(w.blocks.filter((b) => b.section !== 'warmup')[0].role).toBe('press')
      expect(w.blocks.some((b) => b.role === 'attempt' || b.role === 'bridge')).toBe(false)
    }
  })

  it('says it is shorter when it still falls short, naming what it added', () => {
    const w = finalizeWorkout(state, ladder(90), undefined, NOW)
    expect(90 - w.minutes).toBeGreaterThanOrEqual(SHORTER_THAN_ASKED_MIN)
    const line = (w.adjustments ?? []).find((a) => a.includes('This ladder day holds about'))
    expect(line).toBeDefined()
    expect(line).toContain(`${w.minutes} minutes`)
    expect(line).toContain('shorter than the 90')
    expect(line).toContain('to fill the time')
  })

  it('without a time the ladder day is what it was', () => {
    const w = finalizeWorkout(state, ladder(), undefined, NOW)
    const hold = w.blocks.find((b) => b.role === 'skill')!
    expect(hold.sets).toBeLessThanOrEqual(2)
    expect(w.blocks.filter((b) => b.section !== 'warmup')[0].sets).toBe(5)
  })

  it('a session that is not a ladder day takes none of this', () => {
    const plain = finalizeWorkout(state, { source: 'auto', skills: ['handstand'], minutes: 60 }, undefined, NOW)
    const again = finalizeWorkout(state, { source: 'auto', skills: ['handstand'], minutes: 60 }, undefined, NOW)
    expect(plain.blocks).toEqual(again.blocks)
    expect(plain.blocks.find((b) => b.role === 'skill')!.sets).toBeGreaterThan(2)
    expect(SKILL_IDS.length).toBeGreaterThan(0)
  })
})
