import { describe, expect, it } from 'vitest'
import type { Muscle, Pattern } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID, GYM_EXERCISES, LADDERS } from '../../data/gym/exercises'
import { steerInput } from '../plan/screens'
import { availableAt } from './availability'
import type { BodyweightCapacity } from './bodyweight'
import {
  buildGymSession, FINISHER_SETS, HARDER_VARIANT_SETS, ISOLATION_PER_MUSCLE, MAIN_COMPOUND_SETS, MAX_LIFTING_MIN, type GymFocus, type GymPlan,
} from './builder'
import { draftItemFromPlan, FINISHER_LABEL } from './draft'
import { sampleSessions, sampleTable, sessionIssues } from './sampleSessions'
import type { GymLocation, GymSession, Rating } from './types'

// The generator's second set of rules (the athlete's, 2026-11-24): no redundant pairs, an easier version only as a
// finisher straight after the harder one, a harder one only in small volume, about two isolation exercises a muscle,
// lifting capped near an hour, and spare time spent on the day's own exercises before anything new.

const NOW = new Date(2026, 10, 24, 17).getTime()
const home: GymLocation = { id: 'home', name: 'Home', unit: 'kg', updatedAt: 1, equipment: ['floor', 'dumbbells', 'incline-bench', 'pullup-bar'] }
const homeBand: GymLocation = { ...home, id: 'home-band', equipment: [...home.equipment, 'band'] }
const gym: GymLocation = { id: 'gym', name: 'Gym', unit: 'kg', updatedAt: 1,
  equipment: ['barbell', 'squat-rack', 'bench', 'incline-bench', 'dumbbells', 'cable', 'lat-pulldown', 'cable-row', 'pullup-bar', 'dip-bars', 'leg-press', 'leg-curl', 'leg-extension'] }
const goals = { skills: 3, physique: 5, strength: 3, power: 0, endurance: 0 }
const ex = (id: string) => GYM_EXERCISE_BY_ID[id]
type Input = Parameters<typeof buildGymSession>[0]
const build = (focus: GymFocus, minutes: number, extra: Partial<Input> = {}, own: Muscle[] = []) =>
  buildGymSession({ location: home, focus, minutes, sessions: [], goals, now: NOW, ...steerInput({}, own), ...extra })
const ids = (plan: GymPlan) => plan.items.map((it) => it.exerciseId)
/** Every exercise at a place of these patterns rated avoid, so a day leaves room for what spare time adds. */
const avoidPatterns = (place: GymLocation, patterns: Pattern[], keep: string[] = []): Record<string, Rating> =>
  Object.fromEntries(availableAt(place).filter((e) => patterns.includes(e.pattern) && !keep.includes(e.id)).map((e) => [e.id, 'avoid' as Rating]))

describe('ladders', () => {
  it('tags every rung with an exercise in the catalogue, easiest first', () => {
    for (const [id, rungs] of Object.entries(LADDERS)) rungs.forEach((rung, i) => {
      for (const exerciseId of rung) expect(ex(exerciseId)?.ladder, `${id} ${exerciseId}`).toEqual({ id, level: i + 1 })
    })
    expect(ex('hanging-knee-raise').ladder!.level).toBeLessThan(ex('hanging-leg-raise').ladder!.level)
    expect(ex('band-assisted-pull-up').ladder!.level).toBeLessThan(ex('pull-up').ladder!.level)
    expect(GYM_EXERCISES.filter((e) => e.ladder).length).toBeGreaterThan(25)
  })
})

describe('obvious redundant pairs are blocked', () => {
  it('never programs a hanging knee raise as its own exercise beside a hanging leg raise', () => {
    // Round seven's fill once added a hanging knee raise as the first spare-time movement of an abs-priority Pull day
    // that already had hanging leg raises.
    const tempt = { ratings: { 'hanging-knee-raise': 'love' as Rating } }
    for (const focus of ['pull', 'push', 'upper', 'full', 'lower'] as const) for (const minutes of [30, 45, 60, 75, 90]) for (const place of [home, gym]) {
      for (const extra of [{}, tempt, { spare: ['front-delts', 'triceps'] as Muscle[] }]) {
        const plan = build(focus, minutes, { location: place, ...extra }, ['abs', 'hip-flexors'])
        const raise = plan.items.findIndex((it) => it.exerciseId === 'hanging-leg-raise' && !it.finisher)
        const knees = plan.items.findIndex((it) => it.exerciseId === 'hanging-knee-raise')
        if (raise >= 0 && knees >= 0) {
          expect(plan.items[knees].finisher, `${focus} ${minutes} ${place.id}`).toEqual({ of: 'hanging-leg-raise' })
          expect(knees, `${focus} ${minutes} ${place.id}`).toBe(raise + 1)
          expect(plan.items[knees].sets).toBeLessThanOrEqual(FINISHER_SETS)
        }
      }
    }
  })

  it('never puts two exercises of the same rung, or an easier version on its own, in one session', () => {
    const priorities: Muscle[][] = [[], ['abs'], ['biceps', 'lats'], ['chest', 'triceps'], ['side-delts', 'rear-delts']]
    for (const focus of ['pull', 'push', 'upper', 'full', 'lower'] as const) for (const minutes of [30, 45, 60, 90]) for (const place of [home, homeBand, gym]) {
      for (const own of priorities) {
        const plan = build(focus, minutes, { location: place }, own)
        const standalone = plan.items.filter((it) => !it.finisher).map((it) => ex(it.exerciseId))
        for (const a of standalone) for (const b of standalone) {
          if (a === b || !a.ladder || !b.ladder || a.ladder.id !== b.ladder.id) continue
          expect(a.ladder.level, `${focus} ${minutes} ${place.id} [${own}]: ${a.id} + ${b.id}`).not.toBe(b.ladder.level)
          // Two rungs of one ladder only as a harder version in small volume.
          const harder = a.ladder.level > b.ladder.level ? a : b
          expect(plan.items.find((it) => it.exerciseId === harder.id)!.sets, `${focus} ${minutes}: ${harder.id}`).toBeLessThanOrEqual(HARDER_VARIANT_SETS)
        }
      }
    }
  })
})

describe('two exercises for one muscle when they hit it differently', () => {
  // A Pull day with room to spare: the straight-arm, rear-delt and core work avoided, the curls loved.
  const roomy = (loved: string[]) => ({
    location: home,
    ratings: { ...avoidPatterns(home, ['straight-arm-pull', 'rear-delt', 'core-flexion', 'core-anti-rotation', 'shrug']),
      ...Object.fromEntries(loved.map((id) => [id, 'love' as Rating])) },
  })

  it('allows a dumbbell curl and an incline curl together, never a third curl', () => {
    const curlsOf = (plan: GymPlan) => plan.items.filter((it) => ex(it.exerciseId).pattern === 'biceps' && ex(it.exerciseId).primary.includes('biceps'))
    const twoCurls = roomy(['db-curl', 'incline-db-curl'])
    twoCurls.ratings = { ...twoCurls.ratings, ...avoidPatterns(home, ['biceps'], ['db-curl', 'incline-db-curl']) }
    expect(curlsOf(build('pull', 60, twoCurls, ['biceps'])).map((it) => it.exerciseId)).toEqual(['db-curl', 'incline-db-curl'])
    // Three loved curls and room to spare: still two.
    const plan = build('pull', 60, roomy(['db-curl', 'incline-db-curl', 'hammer-curl']), ['biceps'])
    const curls = curlsOf(plan)
    expect(curls.length).toBe(ISOLATION_PER_MUSCLE)
    expect(new Set(curls.map((it) => ex(it.exerciseId).variantOf ?? it.exerciseId)).size).toBe(2)
    // Spare time raised the first curl to four sets before the second came in.
    expect(curls[0].sets).toBe(MAIN_COMPOUND_SETS)
    expect(plan.notes.some((n) => n.includes(ex(curls[1].exerciseId).name))).toBe(true)
    // And the curls never outnumber the pull-ups and rows.
    const back = plan.items.filter((it) => ex(it.exerciseId).compound).reduce((n, it) => n + it.sets, 0)
    expect(curls.reduce((n, it) => n + it.sets, 0)).toBeLessThanOrEqual(back)
  })

  it('keeps about two isolation exercises a muscle at every length and priority', () => {
    for (const focus of ['pull', 'push', 'upper', 'full', 'lower'] as const) for (const minutes of [45, 60, 120]) for (const place of [home, gym]) {
      for (const own of [[], ['biceps'], ['side-delts'], ['abs'], ['triceps-long', 'chest-upper']] as Muscle[][]) {
        const plan = build(focus, minutes, { location: place }, own)
        const perMuscle = new Map<Muscle, number>()
        for (const it of plan.items.filter((i) => !i.finisher && !ex(i.exerciseId).compound)) {
          perMuscle.set(ex(it.exerciseId).primary[0], (perMuscle.get(ex(it.exerciseId).primary[0]) ?? 0) + 1)
        }
        for (const [m, n] of perMuscle) expect(n, `${focus} ${minutes} ${place.id} [${own}]: ${m}`).toBeLessThanOrEqual(ISOLATION_PER_MUSCLE)
      }
    }
  })
})

describe('an easier version only as a finisher, straight after the harder one', () => {
  const threePullUps: BodyweightCapacity = { base: { pullups: 3, pushups: 15 }, practiced: new Map(), reportedPullups: 3 }

  it('finishes a pull-up practice with one or two band-assisted sets, labelled, never a separate exercise', () => {
    for (const minutes of [30, 45, 60]) {
      const plan = build('pull', minutes, { location: homeBand, capacity: threePullUps })
      const i = ids(plan).indexOf('pull-up')
      const finisher = plan.items[i + 1]
      expect(finisher, `${minutes}`).toMatchObject({ exerciseId: 'band-assisted-pull-up', finisher: { of: 'pull-up' } })
      expect(finisher.sets).toBeLessThanOrEqual(FINISHER_SETS)
      expect(plan.items.filter((it) => it.exerciseId === 'band-assisted-pull-up')).toHaveLength(1)
      // The player and the plan list show it as the finisher it is.
      expect(draftItemFromPlan(finisher, homeBand, [])).toMatchObject({ exerciseId: 'band-assisted-pull-up', finisherOf: 'pull-up' })
    }
    expect(FINISHER_LABEL).toBe('Finisher (easier variant)')
  })

  it('finishes hanging leg raises with knee raises to burn out, on a day with room for them', () => {
    // A light-pressing Push day leaves room, and the abs are the priority: leg raises first, knee raises to finish.
    const fullGym: GymLocation = { ...gym, equipment: [...gym.equipment, 'calf-machine'] }
    const plan = buildGymSession({ location: fullGym, focus: 'push', minutes: 120, sessions: [], youth: false, now: NOW,
      goals: { strength: 3, power: 2, physique: 4, skills: 5, endurance: 1 }, spare: ['front-delts', 'triceps'], priority: ['abs'] })
    const i = ids(plan).indexOf('hanging-leg-raise')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(plan.items[i + 1]).toMatchObject({ exerciseId: 'hanging-knee-raise', finisher: { of: 'hanging-leg-raise' } })
    expect(plan.items[i + 1].sets).toBeLessThanOrEqual(FINISHER_SETS)
  })

  it('places every easier version straight after its harder one, in every sample session', () => {
    for (const { sample, plan } of sampleSessions(NOW)) {
      plan.items.forEach((it, i) => {
        const e = ex(it.exerciseId)
        const harder = plan.items.find((o) => !o.finisher && ex(o.exerciseId).ladder?.id === e.ladder?.id && (ex(o.exerciseId).ladder?.level ?? 0) > (e.ladder?.level ?? 0))
        if (!e.ladder || !harder) return
        expect(it.finisher, `${sample.focus} ${sample.minutes}: ${e.id}`).toEqual({ of: harder.exerciseId })
        expect(plan.items[i - 1].exerciseId).toBe(harder.exerciseId)
      })
    }
  })
})

describe('a harder version only in small volume, and only when shown', () => {
  // Rows and pull-ups only, so spare time can add a vertical pull.
  const pullsOnly = { location: home, ratings: { ...avoidPatterns(home, ['straight-arm-pull', 'rear-delt', 'biceps', 'core-flexion', 'core-anti-rotation', 'shrug']),
    ...avoidPatterns(home, ['horizontal-pull'], ['db-row']), 'scapular-pull-up': 'avoid' as Rating } }
  const wide = (at: number): GymSession => ({ id: `w${at}`, name: 'Pull', locationId: 'home', startedAt: at, endedAt: at + 3_600_000,
    exercises: [{ exerciseId: 'wide-pull-up', sets: [0, 1].map((k) => ({ at: at + k * 60_000, reps: 6, rpe: 8 })) }] })

  it('adds a harder pull-up variation for one or two sets beside the pull-up when the athlete has done it', () => {
    const strong: BodyweightCapacity = { base: { pullups: 12 }, practiced: new Map([['wide-pull-up', 6]]) }
    const plan = build('pull', 60, { ...pullsOnly, capacity: strong, sessions: [wide(NOW - 7 * 86_400_000)] })
    const harder = plan.items.filter((it) => (ex(it.exerciseId).ladder?.level ?? 0) > ex('pull-up').ladder!.level && ex(it.exerciseId).ladder?.id === 'pull-up')
    expect(ids(plan)).toContain('pull-up')
    expect(harder.length).toBeGreaterThan(0)
    for (const it of harder) expect(it.sets, it.exerciseId).toBeLessThanOrEqual(HARDER_VARIANT_SETS)
  })

  it('never adds one the athlete has not shown', () => {
    const plan = build('pull', 60, pullsOnly)
    expect(plan.items.filter((it) => (ex(it.exerciseId).ladder?.level ?? 0) > 2 && ex(it.exerciseId).ladder?.id === 'pull-up')).toEqual([])
  })
})

describe('lifting is capped around 60 minutes', () => {
  it('fits a long day into the hour, keeps every main compound at full sets, and says so', () => {
    for (const focus of ['pull', 'push', 'upper', 'full', 'lower'] as const) for (const place of [home, gym]) {
      const hour = build(focus, MAX_LIFTING_MIN, { location: place })
      for (const minutes of [75, 90, 120, 180]) {
        const plan = build(focus, minutes, { location: place })
        expect(plan.estimatedMin, `${focus} ${minutes} ${place.id}`).toBeLessThanOrEqual(MAX_LIFTING_MIN)
        expect(plan.cappedAt).toBe(MAX_LIFTING_MIN)
        expect(plan.notes.some((n) => n.startsWith(`Lifting is capped at about ${MAX_LIFTING_MIN} of your ${minutes} minutes`))).toBe(true)
        // The accessories and finishers gave way, never a main lift: every compound of the hour's session is there,
        // with at least its sets.
        for (const it of hour.items.filter((i) => ex(i.exerciseId).compound && !i.finisher)) {
          expect(plan.items.find((o) => o.exerciseId === it.exerciseId)?.sets ?? 0, `${focus} ${minutes} ${place.id}: ${it.exerciseId}`).toBeGreaterThanOrEqual(it.sets)
        }
        if (focus === 'pull' || focus === 'push') {
          const mains = plan.items.filter((it) => ex(it.exerciseId).compound &&
            (focus === 'pull' ? ['vertical-pull', 'horizontal-pull'] : ['horizontal-press', 'vertical-press']).includes(ex(it.exerciseId).pattern))
          expect(mains.length, `${focus} ${place.id}`).toBeGreaterThanOrEqual(2)
          for (const it of mains.slice(0, 2)) expect(it.sets).toBe(MAIN_COMPOUND_SETS)
        }
      }
    }
  })

  it('spends spare minutes on the day’s own exercises, up to four sets each, before adding anything new', () => {
    const plan = build('push', 120, { location: gym, spare: ['front-delts', 'triceps'] })
    const added = plan.notes.find((n) => n.startsWith('There was time left'))!
    expect(added).toBeDefined()
    for (const id of ['db-lateral-raise', 'low-high-cable-fly']) expect(plan.items.find((it) => it.exerciseId === id)?.sets, id).toBe(MAIN_COMPOUND_SETS)
  })
})

describe('the sample sessions', () => {
  it('break none of the generator rules (npm run sessions:sample prints them)', () => {
    const rows = sampleSessions(NOW)
    expect(rows.length).toBeGreaterThanOrEqual(20)
    expect(rows.filter((r) => r.issues.length).map((r) => `${r.sample.focus} ${r.sample.minutes} ${r.sample.place.id} [${r.sample.priority}]: ${r.issues.join('; ')}`)).toEqual([])
    expect(sampleTable(rows).split('\n')).toHaveLength(rows.length + 2)
  })

  it('catch the faults they look for', () => {
    // A hand-made bad Pull day: a chest exercise, a knee raise on its own beside leg raises, three curls, no row.
    const bad = { name: 'Pull', focus: 'pull' as const, dropped: [], estimatedMin: 70, fits: true, notes: [], items: [
      { exerciseId: 'pull-up', sets: 2 }, { exerciseId: 'db-fly', sets: 3 }, { exerciseId: 'hanging-leg-raise', sets: 3 },
      { exerciseId: 'hanging-knee-raise', sets: 3 }, { exerciseId: 'db-curl', sets: 3 }, { exerciseId: 'hammer-curl', sets: 3 },
      { exerciseId: 'incline-db-curl', sets: 3 },
    ].map((it) => ({ ...it, plan: { range: [8, 12] as [number, number], targetRpe: 8 }, restSec: 90, suggestion: { kind: 'bodyweight' as const, reps: [8, 12] as [number, number], targetRpe: 8, why: '' } })) }
    const issues = sessionIssues('pull', bad, 60, home).join(' | ')
    for (const fault of ['wrong day: Dumbbell fly', 'missing main horizontal-pull', 'easier version as its own exercise: Hanging knee raise',
      '3 isolation exercises for biceps', '9 curl sets for 2 back sets', '70 min for 60', 'isolation before Pull-up has 4 sets']) {
      expect(issues).toContain(fault)
    }
  })
})
