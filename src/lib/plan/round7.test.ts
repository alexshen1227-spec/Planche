import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppState, BodyRegion, CheckIn, SkillId, StepId, SymptomEvent } from '../../types'
import { SKILLS } from '../../data/skills'
import { lineupFor, standingNiggle, todaysLineup } from '../lineup'
import { gymOpener, gymToday, ownMovements, planToday, planWeek, skillFamily, soreJoints } from './planner'
import { familyEvents } from './load'
import { weekStart } from '../time'
import { GYM_PLACE, HOME_KIT, makeAthlete, runLoop, SPORT_WEEK, type AthleteCfg } from './wholeAthleteLoop'

/**
 * Round seven: the rest of what the athlete told the app. A fourteen-year-old
 * whose order is the planche, then the handstand (its push-up ladder), then the
 * front lever, at home with a bar and at a gym, with a game on Saturdays.
 */

const at = (y: number, m: number, d: number, h = 17) => new Date(y, m, d, h).getTime()
// Monday 26 October 2026, then Tuesday morning and Wednesday evening.
const MON_NOON = at(2026, 9, 26, 12)
const TUE_MORNING = at(2026, 9, 27, 9)
const WED = at(2026, 9, 28, 17)

const cfg = (over: Partial<AthleteCfg> = {}): AthleteCfg => ({
  skills: ['planche', 'handstand', 'frontlever'] as SkillId[],
  birthYear: 2012,
  steps: { planche: 'tuck' as StepId, handstand: 'hs-wall' as StepId, frontlever: 'fl-tuck' as StepId },
  kit: [...HOME_KIT, 'pullup-bar'],
  prefs: { goals: { strength: 3, power: 2, physique: 4, skills: 5, endurance: 1 }, sportSchedule: SPORT_WEEK },
  active: 'home',
  ...over,
})

const report = (id: string, when: number, joints: CheckIn['joints'], regions: BodyRegion[] = []): SymptomEvent => ({ id, at: when, joints, ...(regions.length ? { regions } : {}), source: 'check-in' })
const withReports = (state: AppState, ...reports: SymptomEvent[]): AppState => ({ ...state, symptoms: [...(state.symptoms ?? []), ...reports] })
const loadsWrist = (skill: SkillId) => SKILLS[skill].loads.includes('wrist')

afterEach(() => vi.useRealTimers())

describe('joint memory reaches the skill work (round seven)', () => {
  const base = makeAthlete(cfg())

  it('a Monday wrist niggle with no check-in since steers Wednesday’s line-up round the wrist', () => {
    expect(loadsWrist('planche') && loadsWrist('handstand') && !loadsWrist('frontlever')).toBe(true)
    const control = todaysLineup(base, WED, 45)
    expect(control[0].skill).toBe('planche')
    const sore = withReports(base, report('n1', MON_NOON, 'niggle', ['wrist']))
    expect(standingNiggle(sore, WED).regions).toEqual(['wrist'])
    const lineup = todaysLineup(sore, WED, 45)
    // The skill that spares the wrist leads; a wrist-loading skill gets no optional short dose.
    expect(lineup[0].skill).toBe('frontlever')
    expect(lineup.filter((e) => e.role === 'maintenance' || e.role === 'practice').some((e) => loadsWrist(e.skill))).toBe(false)
    expect(lineup.find((e) => e.skill === 'frontlever')?.role).toBe('lead')
    // The copy says when it was flagged, not "today".
    expect(lineup[0].reason).toContain('on Monday')
    // The planner's calisthenics day is the same line-up.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(WED)
    const plan = planToday(sore, { now: WED, minutes: 45, kind: 'calisthenics' })
    expect(plan.skill?.skills[0]).toBe('frontlever')
    // An explicit pick keeps its skills, ordered round the wrist.
    expect(lineupFor(sore, { source: 'auto', skills: ['planche', 'frontlever'] }, WED)[0].skill).toBe('frontlever')
  })

  it('a later all-good check-in ends the skill-side steering, while the lifts keep the 72-hour union', () => {
    const niggleThenGood = withReports(base, report('n1', MON_NOON, 'niggle', ['wrist']), report('g1', TUE_MORNING, 'good'))
    expect(standingNiggle(niggleThenGood, WED).regions).toEqual([])
    expect(todaysLineup(niggleThenGood, WED, 45).map((e) => e.skill)).toEqual(todaysLineup(base, WED, 45).map((e) => e.skill))
    expect(soreJoints(niggleThenGood, WED).joints).toContain('wrists')

    const painThenGood = withReports(base, report('p1', MON_NOON, 'pain', ['elbow']), report('g1', TUE_MORNING, 'good'))
    expect(todaysLineup(painThenGood, WED, 45).map((e) => e.skill)).toEqual(todaysLineup(base, WED, 45).map((e) => e.skill))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(WED)
    const lifts = gymToday(painThenGood, { now: WED, minutes: 60, focus: 'push' })
    expect(lifts.avoidJoints).toContain('elbows')
  })

  it('a fresh check-in given moments ago counts before it is saved', () => {
    const sore = withReports(base, report('n1', MON_NOON, 'niggle', ['wrist']))
    const fresh: CheckIn = { at: WED - 60_000, joints: 'good', energy: 'ok' } as CheckIn
    expect(standingNiggle(sore, WED, fresh).regions).toEqual([])
    expect(todaysLineup(sore, WED, 45, fresh)[0].skill).toBe('planche')
  })

  it('every reason line names only what the day changes', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(WED)
    const painThenGood = withReports(base, report('p1', MON_NOON, 'pain', ['elbow']), report('g1', TUE_MORNING, 'good'))
    const cal = planToday(painThenGood, { now: WED, minutes: 45, kind: 'calisthenics' })
    const calLine = cal.reasons.find((r) => r.startsWith('You reported pain'))!
    // The skills train (no pain-safe session), so the line claims nothing is left out of them.
    expect(cal.skill?.painSafe).toBeFalsy()
    expect(calLine).not.toMatch(/leaves? out anything/)
    expect(calLine).toMatch(/said all good/)
    const gym = planToday(painThenGood, { now: WED, minutes: 60, kind: 'gym' })
    expect(gym.gym?.avoidJoints).toContain('elbows')
    expect(gym.reasons.find((r) => r.startsWith('You reported pain'))).toMatch(/the lifts leave out/)

    const niggle = withReports(base, report('n1', MON_NOON, 'niggle', ['wrist']))
    const steered = planToday(niggle, { now: WED, minutes: 45, kind: 'calisthenics' })
    const line = steered.reasons.find((r) => r.startsWith('You mentioned a niggle'))!
    expect(steered.skill?.skills[0]).toBe('frontlever')
    expect(line).toMatch(/front lever leads today and leaves it alone/)
  })
})

describe('the athlete’s order between the other skills (round seven)', () => {
  const wallGym = { ...GYM_PLACE, equipment: [...GYM_PLACE.equipment, 'wall' as const] }

  it('the handstand’s push-up ladder opens a push day in the athlete’s order, never an upper one, under the push rest rule', () => {
    const st = makeAthlete(cfg({ skills: ['handstand', 'frontlever'] as SkillId[] }))
    expect(gymOpener(st, 'push', wallGym, WED, 60)?.skills).toEqual(['handstand'])
    // An upper day's opener counts for its pulling too: the lever's.
    expect(gymOpener(st, 'upper', wallGym, WED, 60)?.skills).toEqual(['frontlever'])
    // No wall at the gym, no handstand opener; a sore wrist keeps it out like the planche's.
    expect(gymOpener(st, 'push', GYM_PLACE, WED, 60)).toBeUndefined()
    const sore = withReports(st, report('n1', WED - 3_600_000, 'niggle', ['wrist']))
    expect(gymOpener(sore, 'push', wallGym, WED, 60)).toBeUndefined()
    // Behind a push skill ranked above it, the planche opens.
    const both = makeAthlete(cfg({ skills: ['planche', 'handstand', 'frontlever'] as SkillId[] }))
    expect(gymOpener(both, 'push', wallGym, WED, 60)?.skills).toEqual(['planche'])
  })
})

describe('a focus is its focus (round seven)', () => {
  it('at home with no bar, no gym day is a focus that cannot train its own muscles', () => {
    // The reviewer's athlete with the gym place removed: home is floor, parallettes and a wall, and a game on Saturdays.
    const made = makeAthlete(cfg({ kit: HOME_KIT, prefs: { goals: { strength: 3, power: 2, physique: 4, skills: 5, endurance: 1 }, sportSchedule: [{ weekday: 6, kind: 'game', minutes: 80, rpe: 8, legs: true, hour: 10 }] } as AthleteCfg['prefs'] }))
    const home = made.gym!.locations.find((l) => l.id !== GYM_PLACE.id)!
    const start: AppState = { ...made, gym: { ...made.gym!, locations: [home], activeLocationId: home.id } }
    vi.useFakeTimers({ toFake: ['Date'] })
    const out = runLoop(start, { from: new Date(2026, 9, 5), days: 14, perSet: 0.08, truthStart: { 'tuck-planche': 16, 'adv-tuck-planche': 4, 'wall-handstand': 32, 'tuck-front-lever': 8 }, setClock: (t) => vi.setSystemTime(t) })
    const gymDays = out.days.filter((d) => d.gym)
    expect(gymDays.length).toBeGreaterThan(0)
    for (const d of gymDays) {
      const items = d.gym!.items.map((it) => ({ exerciseId: it.id }))
      expect(ownMovements(items, d.gym!.focus), `${new Date(d.at).toDateString()} ${d.gym!.focus}: ${d.gym!.items.map((it) => it.id).join(', ')}`).toBeGreaterThanOrEqual(2)
    }
    // The core-only pull day is gone: no pull day at a place with nothing to pull on.
    expect(gymDays.filter((d) => d.gym!.focus === 'pull').map((d) => new Date(d.at).toDateString())).toEqual([])
  }, 120_000)
})

describe('reason lines that agree with the session and the week (round seven)', () => {
  it('a family’s session count names today only when today trains it, and equals the week’s own days', () => {
    const made = makeAthlete(cfg({ kit: HOME_KIT, active: 'gym', prefs: { goals: { strength: 3, power: 2, physique: 4, skills: 5, endurance: 1 }, minutesByDay: [90, 20, 0, 20, 0, 20, 90], sportSchedule: [{ weekday: 6, kind: 'game', minutes: 80, rpe: 8, legs: true, hour: 10 }] } as AthleteCfg['prefs'] }))
    const checked: string[] = []
    vi.useFakeTimers({ toFake: ['Date'] })
    runLoop(made, {
      from: new Date(2026, 9, 5),
      days: 21,
      perSet: 0.08,
      truthStart: { 'tuck-planche': 16, 'adv-tuck-planche': 4, 'wall-handstand': 32, 'tuck-front-lever': 8 },
      setClock: (t) => vi.setSystemTime(t),
      observe: (state, now, plan) => {
        for (const line of plan.reasons) {
          const m = /^(?:Calisthenics today|A gym day that opens with the [a-z ]+): (?:the )?([A-Za-z ]+?) (?:is your first priority|gets|needs it to get)/.exec(line)
          if (!m) continue
          const skill = (Object.keys(SKILLS) as SkillId[]).find((k) => SKILLS[k].name.toLowerCase() === m[1].toLowerCase())!
          const f = skillFamily(skill) as 'push' | 'pull'
          const day = new Date(now).toDateString()
          // Today is one of the family's sessions: the plan's own session trains it hard.
          expect(plan.skill?.hard ?? [], `${day}: ${line}`).toContain(f)
          const count = /— (\d+)(½?) sessions? this week/.exec(line)
          if (!count || count[2]) continue
          const wk = weekStart(now)
          const startToday = new Date(now).setHours(0, 0, 0, 0)
          const logged = familyEvents(state, now)[f].filter((e) => !e.gym && !e.press && e.at >= wk && e.at < startToday).length
          const planned = planWeek(state, now).filter((x) => weekStart(x.at) === wk && x.at >= startToday && (x.plan.skill?.hard ?? []).includes(f)).length
          expect(Number(count[1]), `${day}: ${line}`).toBe(logged + planned)
          checked.push(day)
        }
        if (plan.skill?.painSafe) expect(plan.reasons.join(' '), new Date(now).toDateString()).not.toMatch(/today is one of them/)
      },
    })
    expect(checked.length).toBeGreaterThan(3)
  }, 180_000)

  it('a pain-safe day claims no skill session', () => {
    const base = makeAthlete(cfg())
    const pain = withReports(base, report('p1', MON_NOON, 'pain', ['wrist']))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(WED)
    const plan = planToday(pain, { now: WED, minutes: 45, kind: 'calisthenics' })
    expect(plan.skill?.painSafe).toBe(true)
    expect(plan.reasons.join(' ')).not.toMatch(/today is one of them|sessions? this week —/)
  })
})
