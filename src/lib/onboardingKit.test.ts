import { describe, expect, it } from 'vitest'
import type { EquipmentId, SkillId } from '../types'
import { interviewCounter, interviewLength, skillKitStanding } from './onboardingFlow'

/**
 * The onboarding decisions that were wrong on screen: a skill "waiting for
 * kit at home" after the athlete added a gym that has it, and a step label
 * that read "Step 3 of 7" through seventeen screens.
 */

const HOME: EquipmentId[] = ['floor', 'parallettes']
const GYM = { name: 'Gym A', equipment: ['pullup-bar', 'dip-bars', 'wall', 'floor'] }
const SKILLS: SkillId[] = ['planche', 'handstand', 'frontlever']

describe('where each chosen skill can train', () => {
  it('home kit trains what it can; a place added later takes the skills home lacks', () => {
    const none = skillKitStanding(SKILLS, HOME, [])
    expect(none.waiting.map((w) => w.skill)).toContain('frontlever')
    expect(none.atPlaces).toEqual([])

    const withGym = skillKitStanding(SKILLS, HOME, [GYM])
    expect(withGym.waiting).toEqual([])
    expect(withGym.atPlaces.find((p) => p.skill === 'frontlever')?.places).toEqual(['Gym A'])
    // What home can already train stays at home.
    expect(withGym.home).toContain('planche')
  })

  it('a place that has only some of the kit leaves the skill waiting', () => {
    const park = { name: 'Park', equipment: ['floor'] }
    const standing = skillKitStanding(['frontlever'], HOME, [park])
    expect(standing.atPlaces).toEqual([])
    expect(standing.waiting.map((w) => w.skill)).toEqual(['frontlever'])
    expect(standing.waiting[0].missing.length).toBeGreaterThan(0)
  })

  it('names every place that has it', () => {
    const second = { name: 'Rec centre', equipment: ['pullup-bar'] }
    const standing = skillKitStanding(['frontlever'], HOME, [GYM, second])
    expect(standing.atPlaces[0].places).toEqual(['Gym A', 'Rec centre'])
  })

  it('every skill is in exactly one of the three lists', () => {
    const standing = skillKitStanding(SKILLS, HOME, [GYM])
    const all = [...standing.home, ...standing.atPlaces.map((p) => p.skill), ...standing.waiting.map((w) => w.skill)]
    expect([...all].sort()).toEqual([...SKILLS].sort())
  })
})

describe('the step label counts the placement beside the section', () => {
  const length = interviewLength(['planche'], {})
  const base = { skipped: false, answered: 0, shortest: length.atLeast, longest: length.atMost }

  it('the interview shows its own question number, which moves with every answer', () => {
    expect(interviewCounter({ ...base, stage: 'interview', answered: 3 })).toMatch(/^Question 4 of /)
    expect(interviewCounter({ ...base, stage: 'interview', answered: 0 })).toMatch(/^Question 1 of /)
  })

  it('"up to" appears only while the ladder is open, and the total never falls under the question number', () => {
    expect(interviewCounter({ stage: 'interview', skipped: false, answered: 3, shortest: 12, longest: 16 })).toBe('Question 4 of up to 16')
    expect(interviewCounter({ stage: 'interview', skipped: false, answered: 3, shortest: 12, longest: 12 })).toBe('Question 4 of 12')
    expect(interviewCounter({ stage: 'interview', skipped: false, answered: 15, shortest: 12, longest: 12 })).toBe('Question 16 of 16')
  })

  it('the goal screen says what follows, instead of repeating the step', () => {
    expect(interviewCounter({ stage: 'goal', skipped: false, answered: 0, shortest: 12, longest: 16 })).toBe('Then up to 16 questions')
    expect(interviewCounter({ stage: 'goal', skipped: false, answered: 0, shortest: 12, longest: 12 })).toBe('Then 12 questions')
  })

  it('has nothing to count on any other screen, or when the athlete places themselves by hand', () => {
    for (const stage of ['welcome', 'skills', 'result', 'schedule']) expect(interviewCounter({ ...base, stage })).toBeNull()
    expect(interviewCounter({ ...base, stage: 'interview', skipped: true })).toBeNull()
    expect(interviewCounter({ ...base, stage: 'goal', skipped: true })).toBeNull()
  })
})
