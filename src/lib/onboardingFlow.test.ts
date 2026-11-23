import { describe, expect, it } from 'vitest'
import { SKILLS, SKILL_LIST } from '../data/skills'
import { goalMovedNote, goalPastPlacement, skillsProgress } from './onboardingFlow'

describe('goalPastPlacement', () => {
  it('moves a goal the placement has reached to the next step on the road', () => {
    expect(goalPastPlacement('planche', 'straddle', 'straddle')).toEqual({ goal: 'full', moved: true })
    expect(goalPastPlacement('planche', 'advtuck', 'tuck')).toEqual({ goal: 'oneleg', moved: true })
  })
  it('keeps a goal still ahead of the placement', () => {
    expect(goalPastPlacement('planche', 'tuck', 'straddle')).toEqual({ goal: 'straddle', moved: false })
  })
  it('keeps the road end when the athlete is placed on the last step', () => {
    const steps = SKILLS.planche.steps
    const last = steps[steps.length - 1].id
    expect(goalPastPlacement('planche', last, last)).toEqual({ goal: last, moved: false })
  })
  it('on every road lands strictly past the placement, or on the last step', () => {
    for (const def of SKILL_LIST) {
      const steps = def.steps
      steps.forEach((placed, p) => {
        steps.forEach((goal, g) => {
          const out = steps.findIndex((s) => s.id === goalPastPlacement(def.id, placed.id, goal.id).goal)
          expect(out).toBe(g > p ? g : Math.min(p + 1, steps.length - 1))
        })
      })
    }
  })
  it('words the note, and does not say "moved to X, already at X" at the road end', () => {
    expect(goalMovedNote('Full Planche', 'Full Planche')).toBe('Your goal moved to Full Planche: you are already at the end of this road.')
    expect(goalMovedNote('Full planche', 'Straddle')).toBe('Your goal moved to Full planche: you are already at Straddle.')
  })
})

describe('skillsProgress', () => {
  const base = { skillCount: 3, skipped: false, longest: 12, shortest: 12 }
  it('advances on every screen and ends on the result', () => {
    const seq = [
      skillsProgress({ ...base, stage: 'skills', position: 0 }).at,
      skillsProgress({ ...base, stage: 'goal', position: 0 }).at,
      ...Array.from({ length: 12 }, (_, i) => skillsProgress({ ...base, stage: 'interview', position: i }).at),
      skillsProgress({ ...base, stage: 'result', position: 12 }).at,
    ]
    expect(seq).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
    expect(skillsProgress({ ...base, stage: 'skills', position: 0 }).total).toBe(15)
    expect(skillsProgress({ ...base, stage: 'result', position: 12 })).toEqual({ at: 15, total: 15, open: false })
  })
  it('counts one screen per chosen skill when the level is picked by hand', () => {
    const s = { ...base, skipped: true }
    expect(skillsProgress({ ...s, stage: 'interview', position: 0 })).toEqual({ at: 3, total: 6, open: false })
    expect(skillsProgress({ ...s, stage: 'result', position: 0 })).toEqual({ at: 6, total: 6, open: false })
  })
  it('reports an open upper bound while the ladder can still end early', () => {
    expect(skillsProgress({ ...base, shortest: 5, stage: 'interview', position: 2 }).open).toBe(true)
  })
})

import { DAY_MINUTE_CHOICES, stepDayMinutes } from '../components/plan/PlanSettings'

describe('stepDayMinutes', () => {
  it('steps by fifteen both ways and stops at rest and two hours', () => {
    expect(stepDayMinutes(45, 1)).toBe(60)
    expect(stepDayMinutes(45, -1)).toBe(30)
    expect(stepDayMinutes(15, -1)).toBe(0)
    expect(stepDayMinutes(0, -1)).toBe(0)
    expect(stepDayMinutes(120, 1)).toBe(120)
    expect(stepDayMinutes(0, 1)).toBe(15)
  })
  it('snaps an off-grid value onto the grid', () => {
    expect(stepDayMinutes(50, 1)).toBe(60)
    expect(stepDayMinutes(50, -1)).toBe(45)
  })
  it('every choice is reachable by stepping from rest', () => {
    let m = 0
    for (const c of DAY_MINUTE_CHOICES.slice(1)) { m = stepDayMinutes(m, 1); expect(m).toBe(c) }
  })
})
