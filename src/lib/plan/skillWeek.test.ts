import { describe, expect, it } from 'vitest'
import type { AppState, EquipmentId, LineupRole, SkillId } from '../../types'
import { startingState } from '../skillLoop'
import { skillWeekLines, skillDayWords, type SkillWeekLine } from './skillWeek'
import type { SkillBlock, WeekAhead } from './planner'

/**
 * `skillWeekLines` answers "when and where does each of my skills train this
 * week, and if it does not, why" — every branch asserted on its kind and its
 * days, with the sentence only checked for what it must name.
 */

const MONDAY = new Date(2026, 10, 23, 17).getTime() // Monday 23 November 2026

type Cell = Partial<SkillBlock> & { skills?: SkillId[] }
/** A week from seven cells: undefined is a rest day. A cell with skills is a calisthenics day, or a gym day with an opener. */
function week(cells: (Cell | undefined)[]): WeekAhead {
  const days = cells.map((cell, i) => {
    const at = MONDAY + i * 86_400_000
    const plan = cell
      ? {
          minutes: 45,
          rest: false,
          kind: (cell.opener ? 'gym' : 'calisthenics') as 'gym' | 'calisthenics',
          skill: { minutes: 45, ...cell, skills: cell.skills ?? [] } as SkillBlock,
        }
      : { minutes: 0, rest: true, kind: 'rest' as const }
    return { day: new Date(at).toISOString().slice(0, 10), at, plan, kind: plan.kind, why: [] }
  })
  return { days, missed: [], shortfall: [], frequency: [] } as unknown as WeekAhead
}

function athlete(skills: SkillId[], equipment: EquipmentId[], places: { id: string; name: string; equipment: string[] }[] = []): AppState {
  const base = startingState({ skills, steps: {}, sessionMinutes: 45, equipment })
  return {
    ...base,
    gym: { ...(base.gym ?? {}), locations: places.map((p) => ({ unit: 'kg', ...p })) } as never,
  }
}

const GYM = { id: 'gym-a', name: 'Gym A', equipment: ['pullup-bar', 'dip-bars', 'wall', 'floor'] }
const by = (lines: SkillWeekLine[], skill: SkillId) => lines.find((l) => l.skill === skill)!
const rest = (n: number) => Array<undefined>(n).fill(undefined)

describe('days a skill trains', () => {
  const state = athlete(['planche', 'handstand', 'frontlever'], ['floor', 'parallettes', 'pullup-bar', 'wall'], [GYM])
  // Mon planche + handstand, Wed gym with a lever opener at Gym A, Fri planche + lever + a short handstand dose.
  const w = week([
    { skills: ['planche', 'handstand'] },
    undefined,
    { skills: ['frontlever'], opener: true, placeId: 'gym-a' },
    undefined,
    { skills: ['planche', 'frontlever', 'handstand'], roles: ['lead', 'partner', 'maintenance'] as LineupRole[] },
    undefined,
    undefined,
  ])
  const lines = skillWeekLines(w, state)

  it('one line per skill, in the athlete order', () => {
    expect(lines.map((l) => l.skill)).toEqual(['planche', 'handstand', 'frontlever'])
  })

  it('lists each skill days with its role; without roles the first leads and the rest train beside it', () => {
    expect(by(lines, 'planche').days.map((d) => [d.label, d.role])).toEqual([['Today', 'lead'], ['Friday', 'lead']])
    expect(by(lines, 'handstand').days.map((d) => [d.label, d.role])).toEqual([['Today', 'partner'], ['Friday', 'maintenance']])
    expect(by(lines, 'frontlever').days.map((d) => [d.label, d.role])).toEqual([['Wednesday', 'lead'], ['Friday', 'partner']])
    expect(by(lines, 'planche').reason).toBeUndefined()
  })

  it('names the place from the places the athlete added, and home otherwise; an opener says it opens the gym session', () => {
    const lever = by(lines, 'frontlever').days
    expect(lever[0]).toMatchObject({ place: 'Gym A', opener: true })
    expect(lever[1]).toMatchObject({ place: 'home', opener: false })
    expect(skillDayWords(lever[0])).toContain('opens the gym session, at Gym A')
    expect(by(lines, 'planche').days[0].place).toBe('home')
  })

  it('a place no longer in the list reads as home rather than a raw id', () => {
    const gone = skillWeekLines(week([{ skills: ['planche'], placeId: 'deleted' }, ...rest(6)]), state)
    expect(by(gone, 'planche').days[0].place).toBe('home')
  })
})

describe('a skill with no day says one reason', () => {
  it('kit-elsewhere: its kit is only at a place no day is planned at', () => {
    const state = athlete(['planche', 'frontlever'], ['floor', 'parallettes'], [GYM])
    const w = week([{ skills: ['planche'] }, undefined, { skills: ['planche'] }, undefined, { skills: ['planche'] }, undefined, undefined])
    const lever = by(skillWeekLines(w, state), 'frontlever')
    expect(lever.days).toEqual([])
    expect(lever.reason?.kind).toBe('kit-elsewhere')
    expect(lever.reason?.text).toContain('Gym A')
    expect(lever.reason?.text).toContain('no day this week is planned there')
  })

  it('kit-missing: no place has it', () => {
    const state = athlete(['planche', 'frontlever'], ['floor', 'parallettes'], [{ id: 'park', name: 'Park', equipment: ['floor'] }])
    const lever = by(skillWeekLines(week([{ skills: ['planche'] }, ...rest(6)]), state), 'frontlever')
    expect(lever.reason?.kind).toBe('kit-missing')
    expect(lever.reason?.text).toContain('no place you have added')
  })

  it('a day at the place that has the kit, which left the skill out, is room and not kit', () => {
    const state = athlete(['planche', 'frontlever'], ['floor', 'parallettes'], [GYM])
    const w = week([{ skills: ['planche'], opener: true, placeId: 'gym-a' }, ...rest(6)])
    expect(by(skillWeekLines(w, state), 'frontlever').reason?.kind).not.toBe('kit-elsewhere')
  })

  it('pain: the day that named it is the pain-safe session', () => {
    const state = athlete(['planche', 'handstand'], ['floor', 'parallettes', 'wall'])
    const w = week([{ skills: ['planche', 'handstand'], painSafe: true }, ...rest(6)])
    const lines = skillWeekLines(w, state)
    expect(by(lines, 'handstand').reason?.kind).toBe('pain')
    expect(by(lines, 'planche').reason?.kind).toBe('pain')
    expect(by(lines, 'planche').days).toEqual([])
  })

  it('no-skill-days: nothing this week trains a skill', () => {
    const state = athlete(['planche'], ['floor', 'parallettes'])
    expect(by(skillWeekLines(week(rest(7)), state), 'planche').reason?.kind).toBe('no-skill-days')
  })

  it('rest-rule: another skill of its family has the days the rule allows', () => {
    const state = athlete(['planche', 'ninety'], ['floor', 'parallettes', 'dip-bars'])
    const w = week([{ skills: ['planche'] }, undefined, { skills: ['planche'] }, undefined, { skills: ['planche'] }, undefined, undefined])
    const ninety = by(skillWeekLines(w, state), 'ninety')
    expect(ninety.reason?.kind).toBe('rest-rule')
    expect(ninety.reason?.text).toContain('coaching convention')
  })

  it('no-room: skills of other families fill the days; it names the minutes and what they hold', () => {
    const state = athlete(['planche', 'handstand'], ['floor', 'parallettes', 'wall'])
    const w = week([{ skills: ['planche'], minutes: 20 }, undefined, { skills: ['planche'], minutes: 20 }, ...rest(4)])
    const hs = by(skillWeekLines(w, state), 'handstand')
    expect(hs.reason?.kind).toBe('no-room')
    expect(hs.reason?.text).toContain('20 minutes')
    expect(hs.reason?.text).toContain('one skill')
  })

  it('a line without a day says it has none, and never promises one', () => {
    const state = athlete(['planche'], ['floor', 'parallettes'])
    const [line] = skillWeekLines(week(rest(7)), state)
    expect(line.text).toContain('no day this week in your plan')
    expect(line.text).not.toMatch(/later this week|will train|you will/i)
  })
})
