import { afterAll, expect, it, vi } from 'vitest'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import type { StepId } from '../../types'
import { bodyweightCapacity } from '../gym/bodyweight'
import { buildGymSession } from '../gym/builder'
import { conservative } from '../gym/draft'
import { planViolations, type GymInput } from '../gym/planInvariants'
import { familyWorkingSets, HARD_GYM_FAMILY_SETS } from './load'
import { AFTER_OPENER_WARM_UP_MIN, soreJoints } from './planner'
import { makeAthlete, runLoop, SPORT_WEEK, type AthleteCfg } from './wholeAthleteLoop'

// The generator's invariants (`gym/planInvariants.ts`) on the gym days the planner itself makes: planche days beside
// lifting, light pressing next to a push skill, skill openers before the lifts, sport weeks and lighter days, each built
// the way the loop's athlete builds them. Beside them, what the plan promises the lifts: a light pressing day stays
// under a hard pressing session, an opener and its lifts fit the day, and a deload is a lighter day.

/** Six weeks by default; `PLANNER_DAYS=84` runs whole seasons. */
const DAYS = Number(process.env.PLANNER_DAYS ?? 42)
const restoreClock = () => {
  if (process.env.FAKE_NOW) vi.setSystemTime(new Date(process.env.FAKE_NOW))
  else vi.useRealTimers()
}
afterAll(restoreClock)

const ATHLETES: Record<string, AthleteCfg> = {
  // The athlete this app is built around: planche first, front lever and handstand, a sport week, under 18.
  teen: { skills: ['planche', 'frontlever', 'handstand'], birthYear: 2012, steps: { planche: 'tuck' as StepId, frontlever: 'fl-tuck' as StepId, handstand: 'hs-wall' as StepId },
    prefs: { goals: { strength: 3, power: 2, physique: 4, skills: 5, endurance: 1 }, sportSchedule: SPORT_WEEK } },
  adultPlanche: { skills: ['planche'], birthYear: 1993, steps: { planche: 'lean' as StepId }, active: 'gym',
    prefs: { goals: { strength: 4, power: 0, physique: 4, skills: 4, endurance: 0 }, musclesPriority: ['lats', 'biceps'] } },
  hspuHome: { skills: ['handstand', 'planche'], birthYear: 1997, steps: { handstand: 'hs-wall' as StepId, planche: 'tuck' as StepId }, active: 'home', kit: ['floor', 'wall', 'parallettes'],
    prefs: { goals: { strength: 3, power: 3, physique: 3, skills: 5, endurance: 1 }, minutesByDay: [30, 0, 45, 0, 30, 0, 90] } },
}

it('every gym day the planner makes holds the generator invariants and the plan’s own promises', () => {
  const failures: string[] = []
  const seen = { gym: 0, light: 0, openers: 0 }
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    for (const [name, cfg] of Object.entries(ATHLETES)) {
      const start = makeAthlete(cfg)
      const from = new Date(2026, 9, 5)
      const youth = conservative(start.profile, from.getTime())
      runLoop(start, { from, days: DAYS, perSet: 0.08, truthStart: { 'tuck-planche': 16, 'adv-tuck-planche': 4 }, setClock: (t) => vi.setSystemTime(t),
        observe: (state, at, plan) => {
          const g = plan.gym
          if (plan.kind !== 'gym' || !g) return
          seen.gym++
          if (g.lightPress) seen.light++
          if (plan.skill?.opener) seen.openers++
          const prefs = state.gym!.prefs!
          const input: GymInput = {
            location: state.gym!.locations.find((l) => l.id === (g.placeId ?? state.gym!.activeLocationId))!,
            capacity: bodyweightCapacity(state, at), minutes: g.minutes, focus: g.focus, sessions: state.gym!.sessions, ratings: state.gym!.ratings,
            favoriteAt: state.gym!.favoriteAt, youth, goals: prefs.goals, musclesOff: g.musclesOff, ...(g.spare?.length ? { spare: g.spare } : {}),
            priority: [...new Set([...prefs.musclesPriority, ...(g.priority ?? [])])], athletePriority: prefs.musclesPriority, weeklyPriority: g.priority,
            avoidJoints: [...new Set([...g.avoidJoints, ...soreJoints(state, at).joints])], volumeFactor: g.volumeFactor,
            ...(plan.skill?.opener ? { warmUpMin: AFTER_OPENER_WARM_UP_MIN } : {}), now: at,
          }
          const built = buildGymSession(input)
          const issues = planViolations(input, built).map((v) => `${v.rule}: ${v.detail}`)
          const pressing = familyWorkingSets(built.items.map((it) => ({ exerciseId: it.exerciseId, sets: Array.from({ length: it.sets }, () => ({ reps: 1 })) }))).push
          if (g.lightPress && pressing >= HARD_GYM_FAMILY_SETS) issues.push(`a light pressing day with ${pressing} pressing sets`)
          if (plan.skill?.opener && plan.skill.minutes + g.minutes > plan.minutes) issues.push(`opener ${plan.skill.minutes} + lifts ${g.minutes} over the day's ${plan.minutes}`)
          if (g.deload && g.volumeFactor >= 1) issues.push('a deload at the usual volume')
          if (issues.length) {
            failures.push(`${name} ${new Date(at).toDateString()} ${g.focus} ${g.minutes}m ×${g.volumeFactor}: ${built.items.map((it) => `${GYM_EXERCISE_BY_ID[it.exerciseId].name}×${it.sets}`).join('; ')}\n    ${issues.join('\n    ')}`)
          }
        } })
    }
  } finally { restoreClock() }
  if (process.env.PLANNER_DAYS) console.log(`planner days: ${seen.gym} gym days, ${seen.light} light pressing, ${seen.openers} after an opener`)
  expect(failures.slice(0, 5)).toEqual([])
  // Not a sweep of nothing: the planner made gym days, light pressing days and openers.
  expect(seen.gym).toBeGreaterThan(40)
  expect(seen.light).toBeGreaterThan(0)
  expect(seen.openers).toBeGreaterThan(10)
}, 120_000)
