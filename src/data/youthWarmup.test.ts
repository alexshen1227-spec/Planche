import { describe, expect, it } from 'vitest'
import type { AppState, SkillId, WorkoutRequest } from '../types'
import { finalizeWorkout, finalizeFromPlan, planForToday, requestFor } from './workouts'
import { startingState } from '../lib/skillLoop'

const NOW = Date.UTC(2026, 10, 20, 12)
const KIT = ['floor', 'parallettes', 'pullup-bar', 'wall', 'pole', 'band', 'box', 'dip-bars'] as const

function athlete(skill: SkillId, step: string, birthYear: number | undefined, equipment: string[] = [...KIT], minutes = 45): AppState {
  const base = startingState({ skills: [skill], steps: { [skill]: step } as never, sessionMinutes: minutes, equipment: equipment as never })
  const profile = { ...base.profile }
  if (birthYear === undefined) delete profile.birthYear
  else profile.birthYear = birthYear
  return { ...base, profile, startedAt: NOW - 30 * 86_400_000 }
}

const build = (state: AppState, request: WorkoutRequest = { source: 'auto' }) => finalizeWorkout(state, request, undefined, NOW)
const warmup = (w: ReturnType<typeof build>) => w.blocks.filter((b) => b.section === 'warmup')
const setsOf = (blocks: { exerciseId: string; sets: number }[], id: string) => blocks.find((b) => b.exerciseId === id)?.sets ?? 0
const total = (blocks: { sets: number }[]) => blocks.reduce((n, b) => n + b.sets, 0)

const CASES: { skill: SkillId; step: string; scap: string; wrist: boolean }[] = [
  { skill: 'planche', step: 'tuck', scap: 'scap-pushup', wrist: true },
  { skill: 'frontlever', step: 'fl-tuck', scap: 'scap-pull', wrist: false },
  { skill: 'handstand', step: 'hs-wall', scap: 'pike-shrug', wrist: true },
]

describe('the longer straight-arm warm-up under 18', () => {
  for (const c of CASES) {
    describe(c.skill, () => {
      const adult = build(athlete(c.skill, c.step, 1990))
      const teen = build(athlete(c.skill, c.step, 2010))
      const unknown = build(athlete(c.skill, c.step, undefined))

      it('gives a youth two sets of the shoulder-blade work and an adult one', () => {
        expect(setsOf(warmup(adult), c.scap)).toBeLessThanOrEqual(1)
        expect(setsOf(warmup(teen), c.scap)).toBe(2)
      })

      it('adds the second wrist set where the skill loads the wrists', () => {
        if (c.wrist) {
          expect(setsOf(warmup(adult), 'wrist-rocks')).toBe(1)
          expect(setsOf(warmup(teen), 'wrist-rocks')).toBe(2)
        } else {
          expect(setsOf(warmup(teen), 'wrist-rocks')).toBe(setsOf(warmup(adult), 'wrist-rocks'))
        }
      })

      it('is longer than the adult warm-up, keeps an easy primer hold last, and says why', () => {
        expect(total(warmup(teen))).toBeGreaterThan(total(warmup(adult)))
        const holds = warmup(teen).filter((b) => b.target.kind === 'hold')
        expect(holds.length).toBeGreaterThan(0)
        expect(warmup(teen).at(-1)!.target.kind).toBe('hold')
        expect(teen.adjustments?.length ?? 0).toBeGreaterThan(adult.adjustments?.length ?? 0)
      })

      it('treats an unknown age as careful, the same as a youth', () => {
        expect(warmup(unknown).map((b) => [b.exerciseId, b.sets])).toEqual(warmup(teen).map((b) => [b.exerciseId, b.sets]))
      })

      it('never costs the key hold: the main work is the same, and only accessories give way to the time', () => {
        const mainWork = (w: ReturnType<typeof build>) => w.blocks.filter((b) => b.section === 'main').map((b) => [b.exerciseId, b.sets])
        expect(mainWork(teen)).toEqual(mainWork(adult))
        const ids = (w: ReturnType<typeof build>) => w.blocks.filter((b) => b.section !== 'warmup').map((b) => b.exerciseId)
        for (const id of ids(teen)) expect(ids(adult)).toContain(id)
      })

      it('survives a short session: accessories go first, the warm-up stays whole', () => {
        const short = build(athlete(c.skill, c.step, 2010), { source: 'auto', minutes: 20 })
        expect(warmup(short).map((b) => [b.exerciseId, b.sets])).toEqual(warmup(teen).map((b) => [b.exerciseId, b.sets]))
        expect(total(short.blocks.filter((b) => b.section !== 'warmup'))).toBeLessThan(total(teen.blocks.filter((b) => b.section !== 'warmup')))
      })
    })
  }
})

describe('WorkoutRequest.kit', () => {
  const home = athlete('frontlever', 'fl-tuck', 1990, ['floor'])
  const mains = (w: ReturnType<typeof build>) => w.blocks.filter((b) => b.section === 'main').map((b) => b.exerciseId)

  it('builds a real lever session when the place has the bar, and waits for kit when it does not', () => {
    const without = build(home, { source: 'auto', skills: ['frontlever'] })
    expect(without.name).toMatch(/waiting for kit/)
    expect(mains(without)).toEqual([])
    const withBar = build(home, { source: 'auto', skills: ['frontlever'], kit: ['pullup-bar'] })
    expect(withBar.name).not.toMatch(/waiting for kit/)
    expect(mains(withBar)).toContain('tuck-front-lever')
  })

  it('stores nothing and keeps the field on the request', () => {
    const before = JSON.stringify(home)
    const request: WorkoutRequest = { source: 'auto', skills: ['frontlever'], kit: ['pullup-bar'] }
    const w = build(home, request)
    expect(JSON.stringify(home)).toBe(before)
    expect(home.profile.equipment).toEqual(['floor'])
    expect(requestFor(w).kit).toEqual(['pullup-bar'])
  })

  it('also applies through finalizeFromPlan', () => {
    const request: WorkoutRequest = { source: 'auto', skills: ['frontlever'], kit: ['pullup-bar'] }
    const { workout } = finalizeFromPlan(home, request, planForToday(home, NOW, undefined, request), NOW)
    expect(workout.blocks.filter((b) => b.section === 'main').map((b) => b.exerciseId)).toContain('tuck-front-lever')
  })

  it('a request without kit builds exactly what it built, with or without an empty list', () => {
    const rich = athlete('frontlever', 'fl-tuck', 1990)
    const plain = build(rich, { source: 'auto', skills: ['frontlever'] })
    const empty = build(rich, { source: 'auto', skills: ['frontlever'], kit: [] })
    const redundant = build(rich, { source: 'auto', skills: ['frontlever'], kit: ['floor'] })
    expect(empty.blocks).toEqual(plain.blocks)
    expect(redundant.blocks).toEqual(plain.blocks)
  })
})

