import { describe, expect, it } from 'vitest'
import type { AppState, Session, SetLog, SkillId } from '../../types'
import { initialState, reducer } from '../store'
import { defaultGym, defaultPrefs } from '../gym/state'
import { buildGymSession } from '../gym/builder'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import type { GymLocation, GymSession, TrainingPrefs } from '../gym/types'
import { lastHardStraightArm, setsPerMuscle, volumeStatus, volumeTarget } from './load'
import { gymDeloadDue, MIN_GYM_MINUTES, MIN_SKILL_MINUTES, openerMinutesFor, planToday, REST_SLACK_HOURS, skillGoalPace } from './planner'
import { weekStart } from '../time'

// A Saturday afternoon, local time: the default schedule gives Saturday 60 minutes.
const NOW = new Date(2026, 10, 21, 16, 0).getTime()
const HOUR = 3_600_000
const DAY = 24 * HOUR

const gymA: GymLocation = {
  id: 'a',
  name: 'Gym A',
  unit: 'kg',
  equipment: ['barbell', 'squat-rack', 'bench', 'incline-bench', 'dumbbells', 'cable', 'lat-pulldown', 'leg-press', 'leg-curl', 'pullup-bar', 'dip-bars', 'box'],
  updatedAt: 1,
}

function athlete(skills: SkillId[], prefs: Partial<TrainingPrefs> = {}, birthYear = 2012): AppState {
  const s = initialState()
  return {
    ...s,
    onboarded: true,
    profile: { ...s.profile, skills, birthYear },
    gym: { ...defaultGym(['floor']), locations: [gymA], activeLocationId: 'a', prefs: { ...defaultPrefs(1), ...prefs } },
  }
}

const set = (exerciseId: string, section: SetLog['section'], at: number): SetLog => ({ exerciseId, kind: 'hold', value: 8, target: 8, section, at })
function skillSession(at: number, exerciseId: string, n = 4): Session {
  return {
    id: `s-${at}-${exerciseId}`,
    startedAt: at,
    endedAt: at + HOUR,
    workoutName: 'Skill',
    workoutKind: 'skill' as Session['workoutKind'],
    stepId: 'tuck',
    sets: [set('wrist-prep', 'warmup', at), ...Array.from({ length: n }, () => set(exerciseId, 'main', at))],
  }
}
const gymSession = (at: number, exerciseId: string, sets: number, rpe = 8): GymSession => ({
  id: `g-${at}-${exerciseId}`,
  locationId: 'a',
  startedAt: at,
  endedAt: at + HOUR,
  name: 'Upper body',
  exercises: [{ exerciseId, sets: Array.from({ length: sets }, () => ({ kg: 40, reps: 8, rpe, at })) }],
})

describe('the day plan', () => {
  it('keeps a scheduled rest day, and builds one when the athlete says they have time', () => {
    const s = athlete(['planche'], { minutesByDay: [0, 0, 0, 0, 0, 0, 0] })
    expect(planToday(s, { now: NOW }).rest).toBe(true)
    const p = planToday(s, { now: NOW, minutes: 40 })
    expect(p.rest).toBe(false)
    expect((p.skill?.minutes ?? 0) + (p.gym?.minutes ?? 0)).toBe(40)
  })

  it('gives the day one main session — calisthenics with all the minutes, or the gym less an opener — never a block smaller than the session it starts', () => {
    for (const minutes of [25, 35, 40, 45, 60, 90]) {
      for (const kind of [undefined, 'calisthenics', 'gym'] as const) {
        const p = planToday(athlete(['planche', 'frontlever']), { now: NOW, minutes, ...(kind ? { kind } : {}) })
        const what = `${minutes} ${kind}`
        if (kind) expect(p.kind, what).toBe(kind)
        if (p.kind === 'calisthenics') {
          expect(p.gym, what).toBeUndefined()
          expect(p.skill!.minutes, what).toBe(minutes)
          expect(p.skill!.opener, what).toBeUndefined()
          // Two skills only where the block holds two full parts.
          if (p.skill!.skills.length > 1) expect(p.skill!.minutes, what).toBeGreaterThanOrEqual(MIN_SKILL_MINUTES[2])
        } else {
          expect(p.kind, what).toBe('gym')
          expect(p.gym!.minutes, what).toBeGreaterThanOrEqual(MIN_GYM_MINUTES)
          // An opener only with room for both blocks: 35 minutes cannot hold an 18-minute skill session beside a 20-minute gym one.
          if (p.skill) {
            expect(p.skill.opener, what).toBe(true)
            expect(p.skill.skills, what).toHaveLength(1)
            // The first priority's opener is the long one whenever the lifts keep their smallest block (round five).
            expect(p.skill.minutes, what).toBe(openerMinutesFor(p.skill.skills[0] === 'planche', minutes))
            expect(p.skill.minutes + p.gym!.minutes, what).toBe(minutes)
          } else expect(p.gym!.minutes, what).toBe(minutes)
          if (minutes < MIN_SKILL_MINUTES[1] + MIN_GYM_MINUTES) expect(p.skill, what).toBeUndefined()
        }
      }
    }
  })

  it('rests a straight-arm family inside the rest window, and trains the other', () => {
    // The lever needs its bar in the athlete's own kit: a calisthenics day is built from that list.
    const a = athlete(['planche', 'frontlever'])
    const s = { ...a, profile: { ...a.profile, equipment: [...a.profile.equipment, 'pullup-bar' as const] }, sessions: [skillSession(NOW - 20 * HOUR, 'tuck-planche')] }
    expect(lastHardStraightArm(s.sessions, NOW).push).toBe(NOW - 20 * HOUR)
    const p = planToday(s, { now: NOW, minutes: 60, kind: 'calisthenics' })
    expect(p.skill!.skills).toEqual(['frontlever'])
    // Past the window it is back.
    expect(planToday(s, { now: NOW + 30 * HOUR, minutes: 60, kind: 'calisthenics' }).skill!.skills).toContain('planche')
    // Only planche trained and it is resting: the time goes to the gym.
    const solo = { ...athlete(['planche']), sessions: [skillSession(NOW - 20 * HOUR, 'tuck-planche')] }
    const g = planToday(solo, { now: NOW, minutes: 60 })
    expect(g.skill).toBeUndefined()
    expect(g.gym!.minutes).toBe(60)
  })

  it('presses beside a hard planche day or two days clear of it, never the day after — and pulls the same way around the lever', async () => {
    const { focusFamilies, planWeekAhead } = await import('./planner')
    for (const [skill, fam] of [['planche', 'push'], ['frontlever', 'pull']] as const) {
      // Trained hard yesterday: no heavy pressing (or pulling) in the gym today.
      const s = { ...athlete([skill], { minutesByDay: [60, 60, 60, 60, 60, 60, 60] }), sessions: [skillSession(NOW - 20 * HOUR, skill === 'planche' ? 'tuck-planche' : 'tuck-front-lever')] }
      const today = planToday(s, { now: NOW, minutes: 60 })
      expect(today.gym && focusFamilies(today.gym.focus), skill).not.toContain(fam)
      // Across the week, a gym day of the family is a day of its holds or clear of them by the rest rule — in calendar
      // days, the unit the plan spaces days in, and never a genuinely short gap in real hours (round five: a logged
      // session's real hours once refused a day the plan had promised).
      const week = planWeekAhead(s, NOW).days
      const holds = [NOW - 20 * HOUR, ...week.filter((d) => (d.plan.skill?.hard ?? []).includes(fam)).map((d) => d.at)]
      const calendarDays = (a: number, b: number) => Math.round(Math.abs(new Date(a).setHours(0, 0, 0, 0) - new Date(b).setHours(0, 0, 0, 0)) / (24 * HOUR))
      for (const d of week) {
        if (!d.plan.gym || !focusFamilies(d.plan.gym.focus).includes(fam)) continue
        for (const h of holds) {
          if (new Date(h).toDateString() === new Date(d.at).toDateString()) continue
          expect(calendarDays(d.at, h), d.day).toBeGreaterThanOrEqual(2)
          expect(Math.abs(d.at - h), d.day).toBeGreaterThanOrEqual((48 - REST_SLACK_HOURS) * HOUR)
        }
      }
    }
  })

  it('lets a sprint session stand in for leg day, and leaves the legs alone when switched off', () => {
    const base = athlete(['planche'])
    const sprinted: AppState = {
      ...base,
      gym: { ...base.gym!, activities: [{ id: 'x', at: NOW - 18 * HOUR, kind: 'sprint', minutes: 60, rpe: 9, legs: true, updatedAt: 1 }] },
    }
    const p = planToday(sprinted, { now: NOW, minutes: 60, kind: 'gym' })
    expect(p.gym!.focus).not.toBe('lower')
    expect(p.gym!.musclesOff).toContain('quads')
    const noLegs = athlete(['planche'], { musclesOff: ['quads', 'hamstrings', 'glutes', 'calves', 'adductors'] })
    for (let d = 0; d < 7; d++) expect(planToday(noLegs, { now: NOW + d * DAY, minutes: 60, kind: 'gym' }).gym!.focus).not.toBe('lower')
  })

  it('keeps load off a joint reported painful, and lightens the day', () => {
    const s = reducer(athlete(['planche']), {
      type: 'RECORD_SYMPTOM',
      event: { at: NOW - 2 * HOUR, joints: 'pain', regions: ['wrist'], source: 'check-in' },
    })
    const p = planToday(s, { now: NOW, minutes: 60 })
    expect(p.gym!.avoidJoints).toContain('wrists')
    expect(p.gym!.volumeFactor).toBeLessThan(1)
    const built = buildGymSession({ location: gymA, minutes: 60, focus: p.gym!.focus, sessions: [], avoidJoints: p.gym!.avoidJoints, volumeFactor: p.gym!.volumeFactor })
    for (const item of built.items) expect(GYM_EXERCISE_BY_ID[item.exerciseId].stress, item.exerciseId).not.toContain('wrists')
  })
})

describe('weekly volume', () => {
  it('counts gym and skill sets on the same muscles, warm-ups not at all', () => {
    const sets = setsPerMuscle([skillSession(NOW - DAY, 'tuck-planche', 4)], [gymSession(NOW - DAY, 'incline-db-press', 3)], NOW - 7 * DAY, NOW)
    // 4 planche sets (front delts 1 each) + 3 incline presses (front delts primary).
    expect(sets['front-delts']).toBe(7)
    expect(sets['chest-upper']).toBe(3)
    expect(sets.triceps).toBe(4 * 0.5 + 3 * 0.5)
  })
  it('sets targets from the physique goal, more for a priority muscle, none for one switched off', () => {
    const prefs = { ...defaultPrefs(1), musclesOff: ['calves' as const], musclesPriority: ['chest-upper' as const] }
    expect(volumeTarget('calves', prefs)).toEqual([0, 0])
    expect(volumeTarget('chest', prefs)).toEqual([10, 16])
    expect(volumeTarget('chest-upper', prefs)[0]).toBeGreaterThan(volumeTarget('triceps-long', prefs)[0])
    expect(volumeStatus(3, [10, 16])).toBe('under')
    expect(volumeStatus(12, [10, 16])).toBe('on')
    expect(volumeStatus(20, [10, 16])).toBe('over')
    expect(volumeStatus(0, [0, 0])).toBe('off')
  })
})

describe('deloads and goals', () => {
  // Two hard sessions inside each of the last `weeks` calendar weeks.
  const weeksOfHardGym = (weeks: number) =>
    Array.from({ length: weeks }, (_, w) => {
      const from = weekStart(NOW) - (w + 1) * 7 * DAY
      return [gymSession(from + DAY + 10 * HOUR, 'bench-press', 4, 8.5), gymSession(from + 3 * DAY + 10 * HOUR, 'back-squat', 4, 8.5)]
    }).flat()
  it('calls a lighter week after a run of hard ones — sooner under 18', () => {
    const adult = (w: number) => ({ ...athlete(['planche'], {}, 1990), gym: { ...athlete(['planche']).gym!, sessions: weeksOfHardGym(w) } })
    const teen = (w: number) => ({ ...athlete(['planche'], {}, 2012), gym: { ...athlete(['planche']).gym!, sessions: weeksOfHardGym(w) } })
    expect(gymDeloadDue(adult(4), NOW).due).toBe(false)
    expect(gymDeloadDue(adult(5), NOW).due).toBe(true)
    expect(gymDeloadDue(teen(3), NOW).due).toBe(true)
    // The week after a run was itself the lighter week the plan called, whatever was logged in it (round three):
    // the next one comes a full run later, not every week.
    expect(gymDeloadDue(adult(6), NOW).due).toBe(false)
    expect(gymDeloadDue(teen(4), NOW).due).toBe(false)
    expect(gymDeloadDue(teen(7), NOW).due).toBe(true)
  })
  it('says when a dated skill goal cannot be judged yet, and when its date has passed', () => {
    const s = athlete(['planche'])
    expect(skillGoalPace(s, { id: 'g', skill: 'planche', stepId: 'advtuck', by: '2026-12-31' }, NOW).status).toBe('unknown')
    expect(skillGoalPace(s, { id: 'g', skill: 'planche', stepId: 'advtuck', by: '2026-01-01' }, NOW).status).toBe('behind')
  })
})

describe('the builder under the planner', () => {
  it('puts explosive work first when power matters, and favours a lagging muscle', () => {
    const goals = { strength: 2, power: 4, physique: 3, skills: 3, endurance: 0 }
    const p = buildGymSession({ location: gymA, minutes: 75, focus: 'push', sessions: [], goals, priority: ['chest-upper'] })
    expect(GYM_EXERCISE_BY_ID[p.items[0].exerciseId].explosive).toBe(true)
    const incline = p.items.find((i) => GYM_EXERCISE_BY_ID[i.exerciseId].primary.includes('chest-upper'))
    expect(incline?.sets).toBe(4)
  })
})

describe('the week in review', () => {
  it('derives gym badges from history, and takes them back when history changes', async () => {
    const { gymBadges } = await import('./weekly')
    const s = athlete(['planche'])
    const none = gymBadges(s)
    expect(none.every((b) => b.at === undefined)).toBe(true)
    const withGym: AppState = {
      ...s,
      sessions: [skillSession(NOW - DAY, 'tuck-planche')],
      gym: { ...s.gym!, sessions: [gymSession(NOW - 9 * DAY, 'bench-press', 3), gymSession(NOW - 2 * DAY, 'bench-press', 3)] },
    }
    const earned = new Set(gymBadges(withGym).filter((b) => b.at !== undefined).map((b) => b.id))
    expect(earned.has('gym-first')).toBe(true)
    expect(earned.has('gym-together')).toBe(true)
    expect(earned.has('gym-10')).toBe(false)
    expect(gymBadges({ ...withGym, gym: { ...withGym.gym!, sessions: [] } }).some((b) => b.at !== undefined)).toBe(false)
  })
  it('summarises the week across skills and gym, and names a lagging priority muscle', async () => {
    const { weeklySummary } = await import('./weekly')
    const s: AppState = {
      ...athlete(['planche'], { musclesPriority: ['chest-upper'] }),
      sessions: [skillSession(NOW - HOUR, 'tuck-planche', 4)],
    }
    const w = weeklySummary({ ...s, gym: { ...s.gym!, sessions: [gymSession(NOW - 2 * HOUR, 'lat-pulldown', 3)] } }, NOW)
    expect(w.skillSessions).toBe(1)
    expect(w.gymSessions).toBe(1)
    expect(w.holdSec).toBe(32)
    expect(w.gymSets).toBe(3)
    expect(w.focus.some((f) => f.includes('upper chest'))).toBe(true)
  })
})

describe('the week preview', () => {
  it('plans seven days, keeps rest days, and never puts a straight-arm family on back-to-back hard days', async () => {
    const { planWeek, skillFamily } = await import('./planner')
    const s = athlete(['planche', 'frontlever'], { minutesByDay: [60, 60, 60, 60, 60, 60, 60] })
    const week = planWeek(s, NOW)
    expect(week).toHaveLength(7)
    for (let i = 1; i < week.length; i++) {
      const before = new Set((week[i - 1].plan.skill?.skills ?? []).map(skillFamily))
      const today = new Set((week[i].plan.skill?.skills ?? []).map(skillFamily))
      for (const f of ['push', 'pull'] as const) expect(before.has(f) && today.has(f), `${week[i].day} ${f}`).toBe(false)
    }
    // The gym side rotates rather than repeating one focus all week.
    expect(new Set(week.map((d) => d.plan.gym?.focus).filter(Boolean)).size).toBeGreaterThan(1)
    const rest = planWeek(athlete(['planche'], { minutesByDay: [0, 45, 0, 45, 0, 45, 0] }), NOW)
    expect(rest.filter((d) => d.plan.rest)).toHaveLength(4)
  })
})

describe('a sport alongside', () => {
  it('does not let a skill block done this morning reshuffle the rest of today', () => {
    const morning = new Date(NOW)
    morning.setHours(8, 0, 0, 0)
    const s = { ...athlete(['planche']), sessions: [skillSession(morning.getTime(), 'tuck-planche')] }
    expect(planToday(s, { now: NOW, minutes: 60 }).skill?.skills).toContain('planche')
    // Tomorrow it rests.
    expect(planToday(s, { now: NOW + DAY, minutes: 60 }).skill).toBeUndefined()
  })
  it('keeps the legs fresh and the gym lighter the day before a game', () => {
    const base = athlete(['planche'])
    const s: AppState = {
      ...base,
      gym: { ...base.gym!, activities: [{ id: 'g', at: NOW + 20 * HOUR, kind: 'game', minutes: 60, rpe: 8, legs: true, updatedAt: 1 }] },
    }
    const p = planToday(s, { now: NOW, minutes: 60, kind: 'gym' })
    expect(p.gym!.focus).not.toBe('lower')
    expect(p.gym!.musclesOff).toContain('quads')
    expect(p.gym!.volumeFactor).toBeLessThanOrEqual(0.8)
    // A game a week away changes nothing.
    const later: AppState = { ...base, gym: { ...base.gym!, activities: [{ ...s.gym!.activities![0], at: NOW + 7 * DAY }] } }
    expect(planToday(later, { now: NOW, minutes: 60, kind: 'gym' }).gym!.volumeFactor).toBe(1)
  })
  it('drops sets in season, and keeps the setting through a reload', async () => {
    const { sanitizeGym } = await import('../gym/state')
    const s = athlete(['planche'], { season: 'in' })
    expect(planToday(s, { now: NOW, minutes: 60 }).gym!.volumeFactor).toBeLessThanOrEqual(0.7)
    expect(sanitizeGym(JSON.parse(JSON.stringify(s.gym)))!.prefs!.season).toBe('in')
    expect(sanitizeGym({ ...s.gym, prefs: { ...s.gym!.prefs, season: 'summer' } })!.prefs!.season).toBeUndefined()
  })
})

describe('found by the review of the planner', () => {
  it('remembers a pain report through a later good check-in, and keeps knee pain off the legs', () => {
    let s = reducer(athlete(['planche']), { type: 'RECORD_SYMPTOM', event: { at: NOW - 6 * HOUR, joints: 'pain', regions: ['elbow'], source: 'check-in' } })
    s = reducer(s, { type: 'RECORD_SYMPTOM', event: { at: NOW - HOUR, joints: 'good', source: 'check-in' } })
    const p = planToday(s, { now: NOW, minutes: 60 })
    expect(p.gym!.avoidJoints).toContain('elbows')
    expect(p.gym!.volumeFactor).toBeLessThan(1)
    const knee = reducer(athlete(['planche']), { type: 'RECORD_SYMPTOM', event: { at: NOW - HOUR, joints: 'pain', regions: ['knee'], source: 'check-in' } })
    const k = planToday(knee, { now: NOW, minutes: 60 })
    expect(k.gym!.avoidJoints).toContain('knees')
    expect(k.gym!.focus).not.toBe('lower')
  })
  it('does not call a stall it could not measure, and a lighter week ends the hard run', () => {
    // Two weeks of grinding bodyweight work: no estimates, so no "maxes held still".
    const bw = Array.from({ length: 4 }, (_, i) => ({
      ...gymSession(NOW - (2 + i * 3) * DAY, 'pull-up', 4, 9.5),
      exercises: [{ exerciseId: 'pull-up', sets: Array.from({ length: 4 }, () => ({ reps: 8, rpe: 9.5, at: NOW - (2 + i * 3) * DAY })) }],
    }))
    const base = athlete(['planche'], {}, 1990)
    expect(gymDeloadDue({ ...base, gym: { ...base.gym!, sessions: bw } }, NOW).due).toBe(false)
    // Five hard weeks, the most recent of them a light one logged at RPE 8: no second deload.
    const weeks = Array.from({ length: 6 }, (_, w) => {
      const from = weekStart(NOW) - (w + 1) * 7 * DAY
      const sets = w === 0 ? 2 : 5
      return [gymSession(from + DAY + 10 * HOUR, 'bench-press', sets, 8.5), gymSession(from + 3 * DAY + 10 * HOUR, 'back-squat', sets, 8.5)]
    }).flat()
    expect(gymDeloadDue({ ...base, gym: { ...base.gym!, sessions: weeks } }, NOW).due).toBe(false)
  })
})

describe('effort on skill sets', () => {
  it('keeps a skill set’s effort through a reload, drops a nonsense one, and lets it weigh on fatigue', async () => {
    const { normalizeState } = await import('../store')
    const { fatigueAt } = await import('./load')
    const s = skillSession(NOW - HOUR, 'tuck-planche', 2)
    const hard = { ...s, sets: s.sets.map((x) => (x.section === 'main' ? { ...x, rpe: 10 } : x)) }
    const easy = { ...s, sets: s.sets.map((x) => (x.section === 'main' ? { ...x, rpe: 6 } : x)) }
    const loaded = normalizeState(JSON.parse(JSON.stringify({ ...athlete(['planche']), sessions: [hard, { ...easy, id: 'junk', sets: easy.sets.map((x) => ({ ...x, rpe: 42 })) }] })))
    expect(loaded.sessions.find((x) => x.id === hard.id)!.sets.find((x) => x.section === 'main')!.rpe).toBe(10)
    expect(loaded.sessions.find((x) => x.id === 'junk')!.sets.some((x) => x.rpe !== undefined)).toBe(false)
    const fHard = fatigueAt({ sessions: [hard], gym: undefined }, NOW)
    const fEasy = fatigueAt({ sessions: [easy], gym: undefined }, NOW)
    expect(fHard.muscles['front-delts']!).toBeGreaterThan(fEasy.muscles['front-delts']!)
  })
})

describe('one flow for a mixed day', () => {
  it('remembers the gym block behind a skill session for the same day only, and forgets it on request', async () => {
    const store = new Map<string, string>()
    const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    const had = (globalThis as { sessionStorage?: unknown }).sessionStorage
    ;(globalThis as { sessionStorage?: unknown }).sessionStorage = fake
    try {
      const { peekNextBlock, rememberNextBlock } = await import('./nextBlock')
      rememberNextBlock({ focus: 'pull', minutes: 25 }, NOW)
      expect(peekNextBlock(NOW + HOUR)).toEqual({ focus: 'pull', minutes: 25 })
      expect(peekNextBlock(NOW + DAY)).toBeNull()
      rememberNextBlock(null)
      expect(peekNextBlock(NOW)).toBeNull()
    } finally {
      ;(globalThis as { sessionStorage?: unknown }).sessionStorage = had
    }
  })
})

describe('the part of the body left longest', () => {
  it('points the next gym session at it and says so — unless the athlete picks a focus', async () => {
    // Ten days of upper-body gym work and nothing for the legs.
    const upper = Array.from({ length: 5 }, (_, i) => [gymSession(NOW - (2 + i * 2) * DAY, 'bench-press', 4), gymSession(NOW - (2 + i * 2) * DAY + HOUR, 'lat-pulldown', 4)]).flat()
    const base = athlete(['planche'])
    const s: AppState = { ...base, gym: { ...base.gym!, sessions: upper } }
    const p = planToday(s, { now: NOW, minutes: 60, kind: 'gym' })
    expect(['lower', 'full']).toContain(p.gym!.focus)
    expect(p.reasons.some((r) => r.startsWith('Legs'))).toBe(true)
    // Switched-off legs are never "left longest".
    const off: AppState = { ...s, gym: { ...s.gym!, prefs: { ...s.gym!.prefs!, musclesOff: ['quads', 'hamstrings', 'glutes', 'calves', 'adductors'] } } }
    expect(planToday(off, { now: NOW, minutes: 60, kind: 'gym' }).gym!.focus).not.toBe('lower')
    // The athlete's own pick wins: an explicit focus is built as asked.
    expect(buildGymSession({ location: gymA, minutes: 45, focus: 'push', sessions: upper }).focus).toBe('push')
  })
})
