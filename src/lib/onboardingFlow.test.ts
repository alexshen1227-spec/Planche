import { describe, expect, it } from 'vitest'
import { SKILLS, SKILL_LIST } from '../data/skills'
import { ALL_SKILL_IDS, goalMovedNote, goalPastPlacement, interviewLength, skillsProgress } from './onboardingFlow'
import { nextInterviewItem, type InterviewAnswers } from './placement'
import type { SkillId } from '../types'

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

describe('the Skills step counter keeps one denominator (review round four, m3)', () => {
  /** Every screen of the step, walked forward with real answers: the counter shown on each. */
  function walk(skills: SkillId[], pick: (values: number[]) => number) {
    const shown: { at: number; total: number; open: boolean }[] = []
    let answers: InterviewAnswers = {}
    const counter = (stage: 'skills' | 'goal' | 'interview' | 'result', ticked: SkillId[]) => {
      const count = interviewLength(ticked, answers)
      return skillsProgress({
        stage,
        skillCount: ticked.length,
        skipped: false,
        position: Object.keys(answers).length,
        longest: count.atMost,
        shortest: count.atLeast,
        widest: interviewLength(ALL_SKILL_IDS, answers).atMost,
      })
    }
    // Ticking skills one at a time on the skills screen.
    for (let n = 0; n <= skills.length; n += 1) shown.push(counter('skills', skills.slice(0, n)))
    shown.push(counter('goal', skills))
    for (let item = nextInterviewItem(skills, answers); item; item = nextInterviewItem(skills, answers)) {
      shown.push(counter('interview', skills))
      answers = { ...answers, [item.id]: pick(item.options.map((option) => option.value)) }
    }
    shown.push(counter('result', skills))
    return shown
  }

  const choices: SkillId[][] = [['planche'], ['handstand'], ['frontlever', 'handstand'], ['planche', 'frontlever', 'handstand', 'ninety', 'flag'], ['flag', 'planche']]
  for (const skills of choices) {
    for (const [label, pick] of [['highest', (v: number[]) => Math.max(...v)], ['lowest', (v: number[]) => Math.min(...v)]] as const) {
      it(`never raises the total, ${skills.join(' + ')}, ${label} answers`, () => {
        const shown = walk(skills, pick)
        const ticking = shown.slice(0, skills.length + 1)
        // The skills screen shows one count whatever is ticked so far.
        expect(new Set(ticking.map((s) => s.total)).size).toBe(1)
        expect(ticking.every((s) => s.at === 1 && s.open)).toBe(true)
        const forward = shown.slice(skills.length)
        for (let i = 1; i < forward.length; i += 1) {
          expect(forward[i].at).toBe(forward[i - 1].at + 1)
          expect(forward[i].total).toBeLessThanOrEqual(forward[i - 1].total)
        }
        const last = forward[forward.length - 1]
        expect(last.at).toBe(last.total)
      })
    }
  }
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
