import { describe, expect, it } from 'vitest'
import type { Muscle, Pattern } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { LIGHT_PRESS_SPARE } from '../plan/load'
import { steerInput } from '../plan/screens'
import { buildGymSession, PATTERN_LIMIT, type GymFocus, type GymPlan } from './builder'
import { aimedAt, planViolations, relationalViolations, setCount, type GymInput, type Violation } from './planInvariants'
import { caseFor, GOALS, MATRIX_SIZE, matrixCase, PLACES, RANDOM_SEED_BASE, simulateHistory, STRESS_NOW, type StressCase } from './planStress'

// The workout generator's invariants (`planInvariants.ts`), held over generated athletes (`planStress.ts`): every
// focus × time × place × day factor, then seeded random requests mixing priorities, steers, exclusions, ratings,
// capacities, opener warm-ups and closed-loop histories. A failure prints its seed: `caseFor(seed)` rebuilds it.
// `STRESS_N=20000 npx vitest run src/lib/gym/planInvariants.test.ts` runs a larger random sweep.

const RANDOM = Number(process.env.STRESS_N ?? 600)
const ex = (id: string) => GYM_EXERCISE_BY_ID[id]
const describePlan = (plan: GymPlan) =>
  `${plan.name} ${plan.estimatedMin}m: ${plan.items.map((it) => `${it.finisher ? '↳' : ''}${ex(it.exerciseId).name}×${it.sets}`).join('; ') || 'empty'}`

function sweep(cases: StressCase[], relational = true): string[] {
  const failures: string[] = []
  for (const c of cases) {
    const plan = buildGymSession(c.input)
    const found: Violation[] = [...planViolations(c.input, plan), ...(relational ? relationalViolations(c.input, plan) : [])]
    for (const v of found) failures.push(`#${c.seed} [${c.tags}] ${v.rule}: ${v.detail}\n    ${describePlan(plan)}`)
  }
  return failures
}

describe('every generated plan holds every invariant', () => {
  const foci = ['full', 'upper', 'lower', 'push', 'pull', 'athletic', 'auto'] as const
  const perFocus = MATRIX_SIZE / foci.length
  for (const [i, focus] of foci.entries()) {
    it(`the matrix: ${focus} days at every time, place and day factor`, () => {
      // Matrix cells run focus-major (`matrixCase`), so each focus is one contiguous block of seeds.
      const cases = Array.from({ length: perFocus }, (_, k) => ({ ...matrixCase(i * perFocus + k), seed: i * perFocus + k + 1 }))
      expect(new Set(cases.map((c) => c.input.focus ?? 'auto'))).toEqual(new Set([focus]))
      expect(sweep(cases).slice(0, 10)).toEqual([])
    })
  }

  it('the seeds that once broke a rule outside the default sweep', () => {
    // 103490: a build-up limit's last trim removed a two-set movement to lose one set, leaving the usual day under the
    // lighter one built from the same request. 110799: a priority's second exercise came back after the time fit had
    // listed it as left out. 114089: a stalled glute bridge "replaced" by a single-leg hip thrust came back as that
    // lift's back-off finisher.
    expect(sweep([103490, 110799, 114089].map(caseFor))).toEqual([])
  })

  it(`${RANDOM} random athletes`, () => {
    const cases = Array.from({ length: RANDOM }, (_, i) => caseFor(RANDOM_SEED_BASE + i))
    expect(sweep(cases).slice(0, 10)).toEqual([])
  }, 120_000)
})

describe('the invariants have teeth', () => {
  // A checker that passes everything proves nothing: each rule is shown firing on a plan broken the way it guards.
  const base: GymInput = { location: PLACES.gym, focus: 'full', minutes: 45, sessions: [], goals: GOALS.mixed, now: STRESS_NOW }
  const plan = buildGymSession(base)
  const rules = (input: GymInput, p: GymPlan) => new Set(planViolations(input, p).map((v) => v.rule))
  const withItems = (items: GymPlan['items'], extra: Partial<GymPlan> = {}): GymPlan => ({ ...plan, items, ...extra })
  // The day's trunk work, or a dead bug standing in for it where the minutes left none.
  const core = plan.items.find((it) => ex(it.exerciseId).pattern.startsWith('core-')) ?? { ...plan.items[plan.items.length - 1], exerciseId: 'dead-bug' }
  const compounds = plan.items.filter((it) => ex(it.exerciseId).compound)

  it('starts from a clean plan', () => {
    expect(planViolations(base, plan)).toEqual([])
    expect(core).toBeDefined()
  })

  it('names each broken rule', () => {
    const first = plan.items[0]
    expect(rules({ ...base, ratings: { [first.exerciseId]: 'avoid' } }, plan)).toContain('avoid-rated')
    expect(rules({ ...base, musclesOff: [ex(first.exerciseId).primary[0]] }, plan)).toContain('muscle-off')
    expect(rules(base, withItems([...plan.items, first]))).toContain('duplicate-exercise')
    expect(rules(base, withItems(plan.items, { estimatedMin: 46 }))).toContain('time')
    expect(rules(base, withItems([core, ...plan.items.filter((it) => it !== core)]))).toContain('core-early')
    expect(rules(base, withItems(plan.items.filter((it) => !['vertical-pull', 'horizontal-pull'].includes(ex(it.exerciseId).pattern))))).toContain('named-missing')
    expect(rules(base, withItems(plan.items.map((it, i) => (i === 0 ? { ...it, sets: 7 } : it))))).toContain('item-sets')
    expect(rules(base, withItems(plan.items, { notes: [`Pull-up has not beaten its best in its last 3 sessions, so Chin-up takes its place for now.`] }))).toContain('note-stall')
    expect(rules(base, withItems(plan.items, { notes: ['Cable fly is new to you: now and then the plan tries an exercise you have not done yet.'] }))).toContain('note-explore')
    // A third exercise of one pattern, and a finisher that does not follow its lift.
    const squat = compounds.find((it) => ex(it.exerciseId).pattern === 'squat')!
    const third = ['leg-press', 'back-squat', 'front-squat', 'hack-squat'].filter((id) => ex(id) && !plan.items.some((it) => it.exerciseId === id)).slice(0, 2)
    expect(rules(base, withItems([...plan.items, ...third.map((id) => ({ ...squat, exerciseId: id }))]))).toContain('pattern-repeat')
    expect(rules(base, withItems([...plan.items, { ...core, exerciseId: 'hanging-knee-raise', finisher: { of: compounds[0].exerciseId } }]))).toContain('finisher')
  })

  it('names a light pressing day that presses hard, and a lighter day that is not lighter', () => {
    const light: GymInput = { ...base, focus: 'push', ...steerInput({ spare: [...LIGHT_PRESS_SPARE] }) }
    const lightPlan = buildGymSession(light)
    expect(planViolations(light, lightPlan)).toEqual([])
    const press = buildGymSession({ ...base, focus: 'push' }).items.filter((it) => ['horizontal-press', 'incline-press', 'vertical-press', 'dip'].includes(ex(it.exerciseId).pattern))
    expect(rules(light, { ...lightPlan, items: [...lightPlan.items, ...press.filter((p) => !lightPlan.items.some((it) => it.exerciseId === p.exerciseId))] })).toContain('light-press')
    expect(relationalViolations({ ...base, volumeFactor: 0.6 }, { ...plan, items: plan.items.map((it) => ({ ...it, sets: it.sets + 1 })) }).map((v) => v.rule)).toContain('light-not-lighter')
  })
})

describe('what the stress test found (2026-11-26), each pinned by decision', () => {
  const build = (input: Partial<GymInput> & Pick<GymInput, 'location' | 'minutes'>) => buildGymSession({ sessions: [], now: STRESS_NOW, ...input })
  const patterns = (plan: GymPlan, ...p: Pattern[]) => plan.items.filter((it) => !it.finisher && p.includes(ex(it.exerciseId).pattern))
  const fired = (input: GymInput) => new Set(planViolations(input, buildGymSession(input)).map((v) => v.rule))

  it('a note about a pick names only a movement the plan still holds', () => {
    // A stalled lift's stand-in, and a movement tried for the first time, were said before the time fit, a lighter day or
    // a practice dose could take them out again: "Hollow body hold takes its place" on a session with no hollow hold.
    const sessions = simulateHistory({ location: PLACES.gym, youth: false, goals: GOALS.mixed, count: 14, end: STRESS_NOW, seed: 5, stall: true, foci: ['pull', 'push', 'lower', 'upper'] })
    let said = 0
    for (const focus of ['full', 'upper', 'lower', 'push', 'pull'] as GymFocus[]) for (const minutes of [15, 20, 30, 45, 60]) for (const volumeFactor of [0.6, 1]) {
      const plan = build({ location: PLACES.gym, focus, minutes, sessions, goals: GOALS.mixed, volumeFactor })
      for (const note of plan.notes) {
        const stall = /^(.+) has not beaten its best .*, so (.+) takes its place/.exec(note)
        if (!stall) continue
        said++
        expect(plan.items.map((it) => ex(it.exerciseId).name), `${focus} ${minutes} ×${volumeFactor}`).toContain(stall[2])
      }
    }
    expect(said).toBeGreaterThan(5)
  })

  it('the time fit reads the order the session runs in', () => {
    // Fitted with the row last (its 180 s rest the one skipped), the fatigue order then put the scapular pull-up last:
    // 16 minutes for a 15-minute Pull day.
    const input: GymInput = { location: PLACES.homeBand, focus: 'pull', minutes: 15, sessions: [], goals: GOALS.strength, musclesOff: ['biceps'],
      capacity: { base: { pushups: 3, pullups: 0, dips: 0 }, practiced: new Map() }, ...steerInput({ priority: ['chest'], spare: [...LIGHT_PRESS_SPARE] }, ['rear-delts']), now: STRESS_NOW }
    expect(buildGymSession(input).estimatedMin).toBeLessThanOrEqual(15)
    for (const focus of ['full', 'upper', 'lower', 'push', 'pull'] as GymFocus[]) for (let minutes = 15; minutes <= 30; minutes++) for (const goals of [GOALS.strength, GOALS.mixed]) {
      for (const location of [PLACES.home, PLACES.homeBand, PLACES.gym]) expect(build({ location, focus, minutes, goals }).estimatedMin, `${focus} ${minutes} ${location.id}`).toBeLessThanOrEqual(minutes)
    }
  })

  it('every day keeps one set of each movement it is named for before any of them goes', () => {
    // A 20-minute strength full-body day was one goblet squat; a 20-minute upper day one incline press; a 30-minute
    // full-body day with a power goal dropped its only pull and kept the pogo hops.
    for (const minutes of [20, 22, 25, 28]) for (const goals of [GOALS.strength, GOALS.mixed]) for (const location of [PLACES.home, PLACES.gym]) {
      const full = build({ location, focus: 'full', minutes, goals })
      expect(patterns(full, 'squat', 'lunge', 'hinge').length, `full ${minutes} ${location.id}`).toBeGreaterThan(0)
      expect(patterns(full, 'horizontal-press', 'incline-press', 'dip').length, `full ${minutes} ${location.id}`).toBeGreaterThan(0)
      expect(patterns(full, 'vertical-pull', 'horizontal-pull').length, `full ${minutes} ${location.id}`).toBeGreaterThan(0)
      const upper = build({ location, focus: 'upper', minutes, goals })
      expect(patterns(upper, 'horizontal-press', 'incline-press').length, `upper ${minutes} ${location.id}`).toBeGreaterThan(0)
      expect(patterns(upper, 'vertical-pull', 'horizontal-pull').length, `upper ${minutes} ${location.id}`).toBeGreaterThan(0)
    }
    const power = build({ location: PLACES.home, focus: 'full', minutes: 30, goals: GOALS.power, volumeFactor: 0.8, musclesOff: ['lower-back'],
      ratings: {}, ...steerInput({ priority: ['tibialis-anterior', 'chest'], spare: [...LIGHT_PRESS_SPARE] }, ['chest']) })
    expect(patterns(power, 'vertical-pull', 'horizontal-pull').length).toBeGreaterThan(0)
  })

  it('names a day by its compounds, and a lighter day thins its accessories first', () => {
    // An upper day's pull was the scapular pull-up listed before the row, so a lighter day cut the row to one set and
    // kept the drill at two; a lighter full-body day cut its only pull to one set beside two-set chest isolation.
    for (const volumeFactor of [0.6, 0.7, 0.8]) for (const minutes of [30, 35, 45]) for (const location of [PLACES.home, PLACES.homeBand, PLACES.gym]) {
      for (const input of [
        { location, focus: 'upper' as GymFocus, minutes, volumeFactor, goals: GOALS.power, capacity: { base: { pushups: 15, pullups: 6, dips: 8 }, practiced: new Map() }, ...steerInput({ spare: ['biceps'] }, ['calves']) },
        { location, focus: 'full' as GymFocus, minutes, volumeFactor, goals: GOALS.power, avoidJoints: ['hips' as const], ...steerInput({ priority: ['side-delts', 'rear-delts'] }, ['chest', 'chest-upper', 'side-delts']) },
      ]) {
        expect(fired({ sessions: [], now: STRESS_NOW, ...input }).has('named-thin'), `${input.focus} ${minutes} ${location.id} ×${volumeFactor}`).toBe(false)
      }
    }
  })

  it('no muscle passes its session ceiling on any day', () => {
    // The ceiling held only where spare time added work: a weekly glute priority's extra set on each of three glute
    // movements made twelve, and a chest priority put sixteen chest and triceps sets on an upper day of four push-ups.
    const glutes = build({ location: PLACES.home, focus: 'full', minutes: 60, goals: GOALS.strength, avoidJoints: ['wrists'], warmUpMin: 2,
      ...steerInput({ priority: ['glutes'], spare: ['upper-back', 'rear-delts'] }, ['side-delts']) })
    expect(aimedAt(glutes, 'glutes')).toBeLessThanOrEqual(10)
    const chest = build({ location: PLACES.bare, focus: 'upper', minutes: 120, goals: GOALS.power, avoidJoints: ['knees'],
      capacity: { base: { pushups: 40, pullups: 15, dips: 20 }, practiced: new Map([['pull-up', 12], ['dip', 15]]) }, ...steerInput({ priority: ['chest'] }, ['biceps']) })
    for (const m of ['chest', 'triceps'] as Muscle[]) expect(aimedAt(chest, m), m).toBeLessThanOrEqual(10)
    // A harder day raises the ceiling by its own factor, never past it.
    const hard = build({ location: PLACES.gym, focus: 'lower', minutes: 60, goals: GOALS.mixed, volumeFactor: 1.2, ...steerInput({ priority: ['glutes', 'quads'] }) })
    for (const m of ['glutes', 'quads', 'hamstrings'] as Muscle[]) expect(aimedAt(hard, m), m).toBeLessThanOrEqual(12)
  })

  it('a Push day takes a power drill’s sets before its main presses lose one', () => {
    // A power goal's explosive push-up kept four sets while the triceps ceiling cut both main presses to three.
    for (const location of [PLACES.gym, PLACES.home]) for (const minutes of [45, 60]) {
      const input: GymInput = { location, focus: 'push', minutes, sessions: [], goals: GOALS.power, ...steerInput({ priority: ['chest', 'lats'] }, ['front-delts', 'chest-upper']), now: STRESS_NOW }
      expect(fired(input).has('mains-first'), `${location.id} ${minutes}`).toBe(false)
    }
  })

  it('at most two exercises of one pattern', () => {
    // With the knees rested a lower day had three Romanian deadlifts: kickstand, dumbbell and single-leg.
    for (const location of [PLACES.home, PLACES.gym, PLACES.everything]) for (const minutes of [60, 90]) for (const volumeFactor of [1, 1.2]) {
      const plan = build({ location, focus: 'lower', minutes, volumeFactor, youth: true, goals: GOALS.mixed, avoidJoints: ['knees'], musclesOff: ['lower-back'], ...steerInput({}, ['abs']) })
      const counts = new Map<Pattern, number>()
      for (const it of plan.items.filter((x) => !x.finisher)) counts.set(ex(it.exerciseId).pattern, (counts.get(ex(it.exerciseId).pattern) ?? 0) + 1)
      for (const [p, n] of counts) expect(n, `${location.id} ${minutes} ${p}`).toBeLessThanOrEqual(PATTERN_LIMIT)
    }
  })

  it('one finisher a lift', () => {
    // Spare time gave the pull-up a slow negative to finish on, then its practice dose added a band-assisted back-off.
    const capacity = { base: { pullups: 3, pushups: 15 }, practiced: new Map(), reportedPullups: 3 }
    let backoffs = 0
    for (const location of [PLACES.cali, PLACES.homeBand]) {
      const sessions = simulateHistory({ location, youth: true, goals: GOALS.power, count: 24, end: STRESS_NOW, seed: 2 })
      for (const focus of ['upper', 'pull', 'full'] as GymFocus[]) for (const minutes of [45, 60, 90]) {
      const plan = build({ location, focus, minutes, sessions, youth: true, goals: GOALS.power, capacity, volumeFactor: 1.2, ...steerInput({ spare: [...LIGHT_PRESS_SPARE] }) })
      const parents = plan.items.flatMap((it) => (it.finisher ? [it.finisher.of] : []))
      expect(new Set(parents).size, `${location.id} ${focus} ${minutes}`).toBe(parents.length)
      backoffs += plan.items.filter((it) => it.practice?.easierId && plan.items.some((f) => f.finisher?.of === it.exerciseId)).length
      }
    }
    expect(backoffs).toBeGreaterThan(0)
  })

  it('a build-up limit is reached, not overshot, on a harder day', () => {
    // Removing a two-set movement to lose one set left the harder day nine sets under a limit of ten the usual day met.
    for (const location of [PLACES.cali, PLACES.gym, PLACES.hotel]) for (const focus of ['push', 'pull', 'full', 'upper'] as GymFocus[]) {
      const input: GymInput = { location, focus, minutes: 60, sessions: [], goals: GOALS.power, capacity: { base: { pushups: 12, pullups: 4 }, practiced: new Map(), buildUpSetLimit: 10 },
        ...steerInput({ spare: ['upper-back'] }, ['lats', 'biceps']), now: STRESS_NOW }
      const usual = buildGymSession(input), harder = buildGymSession({ ...input, volumeFactor: 1.2 }), lighter = buildGymSession({ ...input, volumeFactor: 0.6 })
      expect(setCount(harder), `${location.id} ${focus}`).toBeGreaterThanOrEqual(setCount(usual))
      expect(setCount(lighter), `${location.id} ${focus}`).toBeLessThanOrEqual(setCount(usual))
      expect(setCount(harder)).toBeLessThanOrEqual(10)
    }
  })

  it('trunk work comes after the compounds', () => {
    // An abs priority put the dead bug second on a lower day, between the squat and the split squat.
    for (const focus of ['lower', 'full', 'upper'] as GymFocus[]) for (const location of [PLACES.cali, PLACES.gym]) for (const minutes of [45, 60]) {
      const plan = build({ location, focus, minutes, youth: true, volumeFactor: 1.2, goals: GOALS.skills, ...steerInput({ priority: ['hamstrings', 'quads'] }, ['abs', 'obliques']) })
      const last = plan.items.map((it) => ex(it.exerciseId).compound && !ex(it.exerciseId).explosive).lastIndexOf(true)
      const firstCore = plan.items.findIndex((it) => ex(it.exerciseId).pattern.startsWith('core-'))
      if (firstCore >= 0) expect(firstCore, `${focus} ${location.id} ${minutes}`).toBeGreaterThan(last)
    }
  })

  it('a day that cannot have a movement it is named for says why', () => {
    // With the front delts off and the elbows rested a Push day was one dead bug under its name, and with the shoulders
    // and elbows rested at a hotel an empty one: no movement and no reason.
    const push = build({ location: PLACES.bare, focus: 'push', minutes: 35, youth: true, goals: GOALS.mixed, musclesOff: ['front-delts', 'glutes'], avoidJoints: ['elbows'],
      capacity: { base: { pushups: 40, pullups: 15, dips: 20 }, practiced: new Map() }, ...steerInput({}, ['abs']) })
    expect(patterns(push, 'horizontal-press', 'incline-press', 'vertical-press', 'dip')).toEqual([])
    expect(push.notes.find((n) => n.startsWith('No press today:'))).toMatch(/every option here (loads your rested elbows|works a muscle you switched off)/)
    expect(push.notes.some((n) => n.startsWith('No overhead press today:'))).toBe(true)
    const hotel = build({ location: PLACES.hotel, focus: 'push', minutes: 45, goals: GOALS.power, musclesOff: ['biceps'], avoidJoints: ['shoulders', 'elbows'] })
    expect(hotel.notes.find((n) => n.startsWith('No press today:'))).toContain('loads your rested shoulders and elbows')
    // Nothing to pull from on a bare floor: the upper day says so rather than passing its presses off as one.
    const bare = build({ location: PLACES.bare, focus: 'upper', minutes: 45, goals: GOALS.mixed })
    if (!patterns(bare, 'vertical-pull', 'horizontal-pull').length) expect(bare.notes).toContain('No pull today: nothing at bare trains it.')
    // A speed and power day with the knees rested has no speed work, and says why.
    const athletic = build({ location: PLACES.home, focus: 'athletic', minutes: 35, youth: true, goals: GOALS.strength, avoidJoints: ['knees'], musclesOff: ['calves'] })
    if (!athletic.items.some((it) => ex(it.exerciseId).explosive)) expect(athletic.notes.some((n) => n.startsWith('No speed or power work today:'))).toBe(true)
    // A day that has its movements says nothing of the kind.
    for (const focus of ['full', 'upper', 'lower', 'push', 'pull', 'athletic'] as GymFocus[]) {
      expect(build({ location: PLACES.gym, focus, minutes: 45, goals: GOALS.mixed }).notes.filter((n) => / today: /.test(n) && n.startsWith('No ')), focus).toEqual([])
    }
  })
})
