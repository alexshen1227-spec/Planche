import { describe, expect, it } from 'vitest'
import { GYM_EXERCISES, GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { buildGymSession, type GymFocus } from './builder'
import { conservative } from './draft'
import { isHardBodyweight, repPlanFor, suggestLoad, YOUTH_REP_FLOOR } from './progression'
import { mergeGym, reduceGym, sanitizeGym } from './state'
import type { GymLocation, GymSession, GymState } from './types'

// Review round seven: long days use their minutes, priority beats the week's steer, a coarse machine step
// does not oscillate, the youth rep floor holds for every movement, and two tabs keep each other's place edits.

const GYM: GymLocation = {
  id: 'gym',
  name: 'The gym',
  unit: 'kg',
  updatedAt: 1,
  equipment: ['barbell', 'squat-rack', 'bench', 'incline-bench', 'dumbbells', 'cable', 'lat-pulldown', 'leg-press', 'leg-curl', 'leg-extension', 'calf-machine', 'pullup-bar', 'dip-bars', 'cable-row'],
}
const goals = { strength: 3, power: 2, physique: 4, skills: 5, endurance: 1 }
const NOW = new Date(2026, 10, 2, 17).getTime()
const DAY = 86_400_000
const sets = (b: ReturnType<typeof buildGymSession>) => b.items.reduce((n, i) => n + i.sets, 0)
const ex = (id: string) => GYM_EXERCISE_BY_ID[id]
const build = (focus: GymFocus, minutes: number, extra: Partial<Parameters<typeof buildGymSession>[0]> = {}) =>
  buildGymSession({ location: GYM, minutes, focus, sessions: [], ratings: {}, youth: false, goals, now: NOW, ...extra })
/** Working-set credit a built day gives a muscle: a primary is a set, a secondary half of one. */
const credit = (b: ReturnType<typeof buildGymSession>, m: string) =>
  b.items.reduce((n, i) => n + (ex(i.exerciseId).primary.includes(m as never) ? i.sets : ex(i.exerciseId).secondary.includes(m as never) ? i.sets / 2 : 0), 0)

/**
 * Short-day reference prescriptions, including the available introductory alternatives to barbell bench variants.
 * Push and Pull rows were re-pinned on 2026-11-24 for the athlete's rules: the main compounds reach four sets
 * before any other movement gets time, and a lighter day gives up the other movements first.
 */
const BEFORE: Record<string, string> = {
  'full|20|1|y': '17:goblet-squatx2,db-bench-pressx2',
  'full|20|1|a': '17:goblet-squatx2,db-bench-pressx2',
  'full|20|0.8|y': '14:goblet-squatx2,db-bench-pressx1',
  'full|20|0.8|a': '14:goblet-squatx2,db-bench-pressx1',
  'full|30|1|y': '27:goblet-squatx2,db-bench-pressx2,pull-upx2,romanian-deadliftx2',
  'full|30|1|a': '27:goblet-squatx2,db-bench-pressx2,pull-upx2,romanian-deadliftx2',
  'full|30|0.8|y': '22:goblet-squatx2,db-bench-pressx2,pull-upx1,romanian-deadliftx1',
  'full|30|0.8|a': '22:goblet-squatx2,db-bench-pressx2,pull-upx1,romanian-deadliftx1',
  'full|45|1|y': '42:goblet-squatx2,db-bench-pressx2,pull-upx2,romanian-deadliftx2,db-rowx2,db-lateral-raisex2,diamond-push-upx2',
  'full|45|1|a': '42:goblet-squatx2,db-bench-pressx2,pull-upx2,romanian-deadliftx2,db-rowx2,db-lateral-raisex2,diamond-push-upx2',
  'full|45|0.8|y': '35:goblet-squatx2,db-bench-pressx2,pull-upx2,romanian-deadliftx2,db-rowx1,db-lateral-raisex1,diamond-push-upx1',
  'full|45|0.8|a': '35:goblet-squatx2,db-bench-pressx2,pull-upx2,romanian-deadliftx2,db-rowx1,db-lateral-raisex1,diamond-push-upx1',
  'upper|20|1|y': '17:incline-db-pressx2,pull-upx2',
  'upper|20|1|a': '17:incline-db-pressx2,pull-upx2',
  'upper|20|0.8|y': '14:incline-db-pressx2,pull-upx1',
  'upper|20|0.8|a': '14:incline-db-pressx2,pull-upx1',
  'upper|30|1|y': '27:incline-db-pressx2,pull-upx2,db-bench-pressx2,db-rowx2',
  'upper|30|1|a': '27:incline-db-pressx2,pull-upx2,db-bench-pressx2,db-rowx2',
  'upper|30|0.8|y': '22:incline-db-pressx2,pull-upx2,db-bench-pressx1,db-rowx1',
  'upper|30|0.8|a': '22:incline-db-pressx2,pull-upx2,db-bench-pressx1,db-rowx1',
  'upper|45|1|y': '44:incline-db-pressx2,pull-upx2,db-bench-pressx2,db-rowx2,db-lateral-raisex2,diamond-push-upx2,barbell-curlx2,face-pullx2',
  'upper|45|1|a': '44:incline-db-pressx2,pull-upx2,db-bench-pressx2,db-rowx2,db-lateral-raisex2,diamond-push-upx2,barbell-curlx2,face-pullx2',
  'upper|45|0.8|y': '38:incline-db-pressx2,pull-upx2,db-bench-pressx2,db-rowx2,db-lateral-raisex1,diamond-push-upx2,barbell-curlx1,face-pullx1',
  'upper|45|0.8|a': '38:incline-db-pressx2,pull-upx2,db-bench-pressx2,db-rowx2,db-lateral-raisex1,diamond-push-upx2,barbell-curlx1,face-pullx1',
  'lower|20|1|y': '17:goblet-squatx2,romanian-deadliftx2',
  'lower|20|1|a': '17:goblet-squatx2,romanian-deadliftx2',
  'lower|20|0.8|y': '14:goblet-squatx2,romanian-deadliftx1',
  'lower|20|0.8|a': '14:goblet-squatx2,romanian-deadliftx1',
  'lower|30|1|y': '30:goblet-squatx2,romanian-deadliftx2,bulgarian-split-squatx2,leg-curlx2,leg-extensionx2',
  'lower|30|1|a': '30:goblet-squatx2,romanian-deadliftx2,bulgarian-split-squatx2,leg-curlx2,leg-extensionx2',
  'lower|30|0.8|y': '26:goblet-squatx2,romanian-deadliftx2,bulgarian-split-squatx2,leg-curlx1,leg-extensionx1',
  'lower|30|0.8|a': '26:goblet-squatx2,romanian-deadliftx2,bulgarian-split-squatx2,leg-curlx1,leg-extensionx1',
  'lower|45|1|y': '43:goblet-squatx3,romanian-deadliftx3,bulgarian-split-squatx2,leg-curlx2,leg-extensionx2,standing-calf-raisex2,hanging-leg-raisex2',
  'lower|45|1|a': '43:goblet-squatx3,romanian-deadliftx3,bulgarian-split-squatx2,leg-curlx2,leg-extensionx2,standing-calf-raisex2,hanging-leg-raisex2',
  'lower|45|0.8|y': '35:goblet-squatx2,romanian-deadliftx2,bulgarian-split-squatx2,leg-curlx2,leg-extensionx2,standing-calf-raisex2,hanging-leg-raisex1',
  'lower|45|0.8|a': '35:goblet-squatx2,romanian-deadliftx2,bulgarian-split-squatx2,leg-curlx2,leg-extensionx2,standing-calf-raisex2,hanging-leg-raisex1',
  'push|20|1|y': '19:db-bench-pressx3,db-shoulder-pressx2',
  'push|20|1|y|s': '17:cable-incline-pressx2,db-lateral-raisex3',
  'push|20|1|a': '19:db-bench-pressx3,db-shoulder-pressx2',
  'push|20|1|a|s': '17:cable-incline-pressx2,db-lateral-raisex3',
  'push|20|0.8|y': '17:db-bench-pressx2,db-shoulder-pressx2',
  'push|20|0.8|y|s': '15:cable-incline-pressx2,db-lateral-raisex2',
  'push|20|0.8|a': '17:db-bench-pressx2,db-shoulder-pressx2',
  'push|20|0.8|a|s': '15:cable-incline-pressx2,db-lateral-raisex2',
  'push|30|1|y': '27:db-bench-pressx4,db-shoulder-pressx4',
  'push|30|1|y|s': '23:cable-incline-pressx2,db-lateral-raisex3,low-high-cable-flyx3',
  'push|30|1|a': '27:db-bench-pressx4,db-shoulder-pressx4',
  'push|30|1|a|s': '23:cable-incline-pressx2,db-lateral-raisex3,low-high-cable-flyx3',
  'push|30|0.8|y': '22:db-bench-pressx3,db-shoulder-pressx3',
  'push|30|0.8|y|s': '19:cable-incline-pressx2,db-lateral-raisex2,low-high-cable-flyx2',
  'push|30|0.8|a': '22:db-bench-pressx3,db-shoulder-pressx3',
  'push|30|0.8|a|s': '19:cable-incline-pressx2,db-lateral-raisex2,low-high-cable-flyx2',
  'push|45|1|y': '45:db-bench-pressx4,db-shoulder-pressx4,incline-db-pressx3,db-lateral-raisex3,low-high-cable-flyx2',
  'push|45|1|a': '45:db-bench-pressx4,db-shoulder-pressx4,incline-db-pressx3,db-lateral-raisex3,low-high-cable-flyx2',
  'push|45|0.8|y': '37:db-bench-pressx4,db-shoulder-pressx4,incline-db-pressx2,db-lateral-raisex2',
  'push|45|0.8|a': '37:db-bench-pressx4,db-shoulder-pressx4,incline-db-pressx2,db-lateral-raisex2',
  'pull|20|1|y': '19:pull-upx2,db-rowx3',
  'pull|20|1|a': '19:pull-upx2,db-rowx3',
  'pull|20|0.8|y': '17:pull-upx2,db-rowx2',
  'pull|20|0.8|a': '17:pull-upx2,db-rowx2',
  'pull|30|1|y': '27:pull-upx4,db-rowx4',
  'pull|30|1|a': '27:pull-upx4,db-rowx4',
  'pull|30|0.8|y': '22:pull-upx3,db-rowx3',
  'pull|30|0.8|a': '22:pull-upx3,db-rowx3',
  'pull|45|1|y': '45:pull-upx4,db-rowx4,straight-arm-pulldownx3,face-pullx3,barbell-curlx3',
  'pull|45|1|a': '45:pull-upx4,db-rowx4,straight-arm-pulldownx3,face-pullx3,barbell-curlx3',
  'pull|45|0.8|y': '35:pull-upx4,db-rowx4,straight-arm-pulldownx2,face-pullx2',
  'pull|45|0.8|a': '35:pull-upx4,db-rowx4,straight-arm-pulldownx2,face-pullx2',
  'athletic|20|1|y': '13:landing-stickx3,goblet-squatx3',
  'athletic|20|1|a': '18:jump-squatx3,explosive-push-upx3,goblet-squatx2',
  'athletic|20|0.8|y': '12:landing-stickx2,goblet-squatx3',
  'athletic|20|0.8|a': '15:jump-squatx2,explosive-push-upx2,goblet-squatx2',
  'athletic|30|1|y': '13:landing-stickx3,goblet-squatx3',
  'athletic|30|1|a': '21:jump-squatx3,explosive-push-upx3,goblet-squatx3',
  'athletic|30|0.8|y': '12:landing-stickx2,goblet-squatx3',
  'athletic|30|0.8|a': '16:jump-squatx3,explosive-push-upx2,goblet-squatx2',
  'athletic|45|1|y': '13:landing-stickx3,goblet-squatx3',
  'athletic|45|1|a': '21:jump-squatx3,explosive-push-upx3,goblet-squatx3',
  'athletic|45|0.8|y': '12:landing-stickx2,goblet-squatx3',
  'athletic|45|0.8|a': '16:jump-squatx3,explosive-push-upx2,goblet-squatx2',
}

const PRESS = ['horizontal-press', 'incline-press', 'vertical-press', 'dip']
const PULL = ['vertical-pull', 'horizontal-pull', 'straight-arm-pull']
const LEGS = ['quads', 'hamstrings', 'glutes', 'calves'] as const

describe('1. long days use their minutes', () => {
  it('a short day fits the expected movements and sets (20, 30 and 45 minutes, every focus, light and usual, under and over 18)', () => {
    const seen: string[] = []
    for (const focus of ['full', 'upper', 'lower', 'push', 'pull', 'athletic'] as const) {
      for (const minutes of [20, 30, 45]) {
        for (const factor of [1, 0.8]) {
          for (const youth of [true, false]) {
            const b = build(focus, minutes, { youth, volumeFactor: factor })
            const key = `${focus}|${minutes}|${factor}|${youth ? 'y' : 'a'}`
            seen.push(key)
            expect(`${b.estimatedMin}:${b.items.map((i) => `${i.exerciseId}x${i.sets}`).join(',')}`, key).toBe(BEFORE[key])
            expect(b.notes, key).toEqual([])
          }
        }
      }
    }
    expect(seen).toHaveLength(72)
    // A steered short day too (the week's pressing spared): the light presses keep their dose, the rest is pinned.
    for (const minutes of [20, 30]) {
      const b = build('push', minutes, { spare: ['front-delts', 'triceps', 'chest'] })
      expect(`${b.estimatedMin}:${b.items.map((i) => `${i.exerciseId}x${i.sets}`).join(',')}`).toBe(BEFORE[`push|${minutes}|1|a|s`])
    }
  })

  it('fills a long push day, a full-body day and a steered day with movements, within a ceiling', () => {
    // Before: a 120-minute push day built 18 sets (50 min) unsteered and 8 sets (23 min) steered; a full-body day 24 sets (66 min).
    const push = build('push', 120)
    expect(sets(push)).toBeGreaterThanOrEqual(22)
    expect(push.estimatedMin).toBeGreaterThanOrEqual(58)
    const steered = build('push', 120, { spare: ['front-delts', 'triceps', 'chest'] })
    expect(sets(steered)).toBeGreaterThan(8)
    expect(steered.estimatedMin).toBeGreaterThan(23)
    for (const minutes of [95, 120]) {
      const full = build('full', minutes)
      expect(sets(full), `full ${minutes}`).toBeGreaterThanOrEqual(28)
      expect(full.estimatedMin, `full ${minutes}`).toBeGreaterThanOrEqual(70)
      expect(full.estimatedMin).toBeLessThanOrEqual(minutes)
      // A ceiling: a long day is not an endless one.
      expect(sets(full)).toBeLessThanOrEqual(30)
      expect(full.notes.some((n) => n.includes('time left'))).toBe(true)
    }
    // Never past the minutes asked for, at any length.
    for (const focus of ['push', 'pull', 'upper', 'lower', 'full'] as const) for (const minutes of [60, 75, 95, 120]) expect(build(focus, minutes).estimatedMin, `${focus} ${minutes}`).toBeLessThanOrEqual(minutes)
  })

  it('adds for the muscles the session gives least: priority first, and no muscle past its ceiling', () => {
    const plain = build('push', 120)
    const prio = build('push', 120, { priority: ['chest-upper', 'triceps-long'] })
    expect(credit(prio, 'chest-upper')).toBeGreaterThan(credit(plain, 'chest-upper'))
    expect(credit(prio, 'triceps-long')).toBeGreaterThan(credit(plain, 'triceps-long'))
    for (const m of ['chest', 'chest-upper', 'side-delts', 'triceps', 'front-delts']) expect(credit(plain, m), m).toBeLessThanOrEqual(14)
    // With little room, the first movement added is for the priority muscle, not the one the session gives least.
    const firstAdded = (b: ReturnType<typeof buildGymSession>) => b.notes.find((n) => n.includes('time left'))!.replace(/^.*so /, '').split(', ')[0].replace(/ w(as|ere) added.*$/, '')
    // A Pull day's rows and pull-ups take four sets each before anything else (2026-11-24), so the spare time a
    // fill can use starts later than the 60 minutes it once did.
    for (const [muscle, name] of [['biceps', 'Hammer curl'], ['rear-delts', 'Incline Y raise'], ['abs', 'Hanging knee raise']] as const) {
      const b = build('pull', 70, { priority: [muscle] })
      expect(firstAdded(b), muscle).toBe(name)
      expect(ex(b.items.find((i) => ex(i.exerciseId).name === name)!.exerciseId).primary).toContain(muscle)
    }
    // Without a priority the muscle the session gives least comes first; the back is already at its ceiling.
    expect(firstAdded(build('pull', 75))).toBe('Pallof press')
    const upper = build('upper', 120, { priority: ['rear-delts'] })
    expect(credit(upper, 'rear-delts')).toBeGreaterThan(credit(build('upper', 120), 'rear-delts'))
  })

  it('holds every rule while filling: switched-off muscles, joints, kit, under-18 coaching, the day’s family and the factor', () => {
    // A game on Saturday: the legs are switched off, so no leg work is added to a full-body day.
    const legsOff = build('full', 120, { musclesOff: [...LEGS] })
    expect(legsOff.items.some((i) => ex(i.exerciseId).primary.some((m) => (LEGS as readonly string[]).includes(m)))).toBe(false)
    expect(legsOff.estimatedMin).toBeGreaterThan(build('full', 60, { musclesOff: [...LEGS] }).estimatedMin)
    // A sore elbow: nothing that loads elbows, including the added movements.
    const sore = build('upper', 120, { avoidJoints: ['elbows'] })
    expect(sore.items.length).toBeGreaterThan(0)
    expect(sore.items.some((i) => ex(i.exerciseId).stress.includes('elbows'))).toBe(false)
    // Kit: a bench and dumbbells only.
    const bare: GymLocation = { ...GYM, equipment: ['bench', 'dumbbells'] }
    const kit = buildGymSession({ location: bare, minutes: 120, focus: 'full', sessions: [], youth: false, goals, now: NOW })
    for (const i of kit.items) expect(ex(i.exerciseId).needs.every((group) => group.some((g) => [...bare.equipment, 'floor'].includes(g))), i.exerciseId).toBe(true)
    // Under 18, nothing that needs coaching is added.
    const youth = build('upper', 120, { youth: true })
    expect(youth.items.filter((i) => ex(i.exerciseId).technical)).toEqual([])
    // The day's family: a full-body or lower day never gains pressing or pulling from spare time.
    const fam = (b: ReturnType<typeof buildGymSession>, patterns: string[]) => b.items.filter((i) => patterns.includes(ex(i.exerciseId).pattern)).reduce((n, i) => n + i.sets, 0)
    for (const focus of ['full', 'lower'] as const) {
      const long = build(focus, 120)
      const short = build(focus, 60)
      expect(fam(long, PRESS), focus).toBe(fam(short, PRESS))
      expect(fam(long, PULL), focus).toBe(fam(short, PULL))
    }
    // A push day adds pressing but no pulling.
    expect(build('push', 120).items.some((i) => PULL.includes(ex(i.exerciseId).pattern))).toBe(false)
    // A lighter day is lighter: the same long day at 0.6 has well under the usual sets.
    expect(sets(build('full', 120, { volumeFactor: 0.6 }))).toBeLessThan(sets(build('full', 120)) * 0.75)
    // A harder day has more than the usual one.
    expect(sets(build('upper', 75, { volumeFactor: 1.2 }))).toBeGreaterThan(sets(build('upper', 75)))
  })

  it('does not fill a day that had to be trimmed to fit', () => {
    const tight = build('full', 40)
    expect(tight.notes).toEqual([])
    expect(tight.estimatedMin).toBeLessThanOrEqual(40)
  })
})

describe('2. priority beats spare', () => {
  it('keeps a movement built on a priority muscle although it leans on a spared one', () => {
    const base = { spare: ['chest', 'front-delts'] as never[] }
    const without = build('push', 60, base)
    const withPrio = build('push', 60, { ...base, priority: ['chest-upper'] })
    expect(credit(withPrio, 'chest-upper')).toBeGreaterThan(credit(without, 'chest-upper'))
    expect(withPrio.items.some((i) => ex(i.exerciseId).primary.includes('chest-upper') && ex(i.exerciseId).primary.includes('front-delts') && i.sets >= 3)).toBe(true)
  })

  it('treats a muscle on both lists as a priority', () => {
    const b = build('push', 60, { spare: ['triceps'], priority: ['triceps'] })
    const t = b.items.filter((i) => ex(i.exerciseId).primary.includes('triceps'))
    expect(t.length).toBeGreaterThan(0)
    expect(Math.max(...t.map((i) => i.sets))).toBeGreaterThanOrEqual(3)
  })

  it('still spares movements built on a muscle nobody asked for', () => {
    const b = build('push', 60, { spare: ['triceps'], priority: ['chest-upper'] })
    expect(b.items.filter((i) => ex(i.exerciseId).primary.includes('triceps') && !ex(i.exerciseId).primary.includes('chest-upper') && i.sets > 2)).toEqual([])
  })

  it('keeps the light-pressing rail: with the pressing pair spared, no priority brings back a movement built on them', () => {
    const b = build('push', 120, { spare: ['front-delts', 'triceps', 'chest'], priority: ['chest-upper', 'triceps-long'] })
    const onPair = b.items.filter((i) => ex(i.exerciseId).primary.some((m) => m === 'front-delts' || m === 'triceps'))
    // The one press the day is named for, at two sets, and nothing else built on them.
    expect(onPair.length).toBeLessThanOrEqual(1)
    for (const i of onPair) expect(i.sets).toBe(2)
    // The upper chest still gets work that does not press.
    expect(b.items.some((i) => ex(i.exerciseId).primary.includes('chest-upper') && !PRESS.includes(ex(i.exerciseId).pattern))).toBe(true)
  })

  it('never brings back what the athlete switched off', () => {
    const b = build('push', 120, { musclesOff: ['triceps'], priority: ['triceps'] })
    expect(b.items.some((i) => ex(i.exerciseId).primary.includes('triceps'))).toBe(false)
  })
})

describe('3. a coarse machine step does not oscillate', () => {
  const leg = 'leg-curl'
  const at = (i: number) => NOW - 400 * DAY + i * 3.5 * DAY
  const session = (i: number, kg: number, reps: number, rpe: number): GymSession =>
    ({
      id: `s${i}`,
      locationId: 'gym',
      startedAt: at(i),
      endedAt: at(i) + 3_600_000,
      name: 'Lower',
      completion: 'full',
      exercises: [{ exerciseId: leg, repRange: [10, 15], targetRpe: 8, sets: [1, 2, 3].map(() => ({ kg, reps, rpe })) }],
    }) as unknown as GymSession
  const plan = repPlanFor(ex(leg))
  const suggest = (sessions: GymSession[], when = NOW, youth = true) => suggestLoad({ exerciseId: leg, location: GYM, sessions, plan, youth, now: when })

  /** An athlete: strength `s0` (a one-rep-max-like number) growing `growth` a session, who stops `past` reps beyond the top of the range. */
  function simulate(n: number, s0: number, growth: number, past: number, youth = true) {
    const sessions: GymSession[] = []
    const loads: number[] = []
    let s = s0
    for (let i = 0; i < n; i++) {
      const sug = suggest(sessions, at(i) + 1000, youth)
      const kg = sug.kg ?? 15
      const toFailure = Math.max(0, Math.floor(30 * (s / kg - 1)))
      let reps = Math.min(15 + past, toFailure - 2)
      let rpe = Math.max(6, Math.min(10, 10 - (toFailure - reps)))
      if (reps < 10) {
        reps = Math.max(1, toFailure)
        rpe = 10
      }
      sessions.push(session(i, kg, reps, rpe))
      loads.push(kg)
      s *= 1 + growth
    }
    return loads
  }
  const changes = (l: number[]) => l.slice(1).filter((x, i) => x !== l[i]).length

  it('the old rhythm (15, 20, 15, 20…) is gone for an athlete who cannot hold the heavier step: ten sessions settle', () => {
    const loads = simulate(10, 23.5, 0, 0, false)
    expect(loads.slice(0, 3)).toEqual([15, 20, 15])
    expect(loads.slice(3)).toEqual([15, 15, 15, 15, 15, 15, 15])
    expect(changes(loads)).toBeLessThanOrEqual(2)
  })

  it('goes up again once the lighter load shows room — reps past the top of the range — and then stays up', () => {
    const loads = simulate(10, 23.5, 0.03, 4)
    expect(loads.at(-1)).toBe(20)
    expect(loads.slice(-4)).toEqual([20, 20, 20, 20])
    // The step failed at most twice on the way (each failure raised the bar), against a drop every other session.
    expect(loads.slice(1).filter((x, i) => x < loads[i]).length).toBeLessThanOrEqual(2)
  })

  it('says what it asks for', () => {
    const after = [session(0, 15, 15, 8), session(1, 20, 7, 10), session(2, 15, 15, 8)]
    const s = suggest(after, at(3))
    expect(s.kg).toBe(15)
    expect(s.kind).toBe('repeat')
    expect(s.why).toContain('17 reps')
  })

  it('moves up on reps past the top, and the bar rises with each failed step', () => {
    const one = [session(0, 20, 7, 10), session(1, 15, 17, 8)]
    expect(suggest(one, at(2)).kg).toBe(20)
    const two = [session(0, 20, 7, 10), session(1, 15, 15, 8), session(2, 20, 6, 10), session(3, 15, 17, 8)]
    expect(suggest(two, at(4)).kg).toBe(15)
    expect(suggest([...two.slice(0, 3), session(3, 15, 19, 8)], at(4)).kg).toBe(20)
  })

  it('an adult who blew well past the range after a failed step still takes one step, not two', () => {
    const adult = (sessions: GymSession[], when: number) => suggestLoad({ exerciseId: leg, location: GYM, sessions, plan, youth: false, now: when })
    const easy = (i: number) => ({ ...session(i, 15, 19, 7) })
    expect(adult([easy(0)], at(1)).kg).toBe(25)
    expect(adult([session(0, 20, 7, 10), easy(1)], at(2)).kg).toBe(20)
  })

  it('forgets a failure after eight weeks, and a heavier load that was handled clears the slate', () => {
    const failed = session(0, 20, 7, 10)
    const recent = [failed, session(1, 15, 15, 8)]
    expect(suggest(recent, at(2)).kg).toBe(15)
    const late = [failed, { ...session(1, 15, 15, 8), startedAt: failed.startedAt + 60 * DAY }]
    expect(suggest(late, late[1].startedAt + DAY, false).kg).toBe(20)
    const handled = [failed, session(1, 20, 12, 8), session(2, 15, 15, 8)]
    expect(suggest(handled, at(3), false).kg).toBe(20)
  })

  it('does not change a lift that never failed a step', () => {
    const first = suggest([session(0, 15, 15, 8)], at(1), false)
    expect(first.kg).toBe(20)
    expect(first.kind).toBe('increase')
  })
})

describe('4. the under-18 rep floor holds for every movement', () => {
  const NOW_Y = new Date(2026, 10, 2).getTime()
  const profileFor = (age: number | undefined) => ({ birthYear: age === undefined ? undefined : 2026 - age }) as never
  it('treats ages 13, 17 and unknown as under 18', () => {
    for (const age of [13, 17, undefined]) expect(conservative(profileFor(age), NOW_Y), String(age)).toBe(true)
  })

  it('no movement in the catalogue is programmed under six reps for them, but the hard bodyweight work (four) and a run or a hold', () => {
    let checked = 0
    for (const e of GYM_EXERCISES) {
      // A sprint is one run a set and a hold is counted in seconds: neither is a rep range.
      if (e.pattern === 'sprint' || e.count === 'seconds') continue
      for (const emphasis of ['strength', 'muscle', 'endurance', 'power'] as const) {
        const floor = isHardBodyweight(e) && emphasis !== 'power' ? 4 : YOUTH_REP_FLOOR
        expect(repPlanFor(e, emphasis, true).range[0], `${e.id} ${emphasis}`).toBeGreaterThanOrEqual(floor)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(400)
    // The landing the review found at 5–8: six or more now, and the adult range is unchanged.
    expect(repPlanFor(ex('landing-stick'), 'muscle', true).range).toEqual([6, 8])
    expect(repPlanFor(ex('landing-stick'), 'muscle', false).range).toEqual([5, 8])
    expect(repPlanFor(ex('box-jump'), 'muscle', true).range[0]).toBe(6)
    expect(repPlanFor(ex('box-jump'), 'muscle', false).range).toEqual([3, 5])
    // A run is one rep, a hold is seconds: the floor is not theirs.
    expect(repPlanFor(ex('build-up-run'), 'muscle', true).range).toEqual([1, 1])
    expect(repPlanFor(ex('plank'), 'muscle', true).range).toEqual([20, 40])
  })

  it('reaches the built session at every one of those ages', () => {
    for (const age of [13, 17, undefined]) {
      const youth = conservative(profileFor(age), NOW_Y)
      const b = build('athletic', 45, { youth, now: NOW_Y })
      const stick = b.items.find((i) => i.exerciseId === 'landing-stick')
      expect(stick, String(age)).toBeDefined()
      expect(stick!.plan.range[0], String(age)).toBeGreaterThanOrEqual(6)
      for (const i of b.items) {
        if (ex(i.exerciseId).pattern === 'sprint' || ex(i.exerciseId).count === 'seconds') continue
        expect(i.plan.range[0], `${age} ${i.exerciseId}`).toBeGreaterThanOrEqual(isHardBodyweight(ex(i.exerciseId)) ? 4 : 6)
      }
    }
  })
})

describe('5. two tabs keep each other’s edits to a place', () => {
  const base = (): GymState =>
    ({ locations: [GYM, { ...GYM, id: 'home', name: 'Home', equipment: ['dumbbells'] }], activeLocationId: 'gym', sessions: [], ratings: {}, favoriteAt: {} }) as GymState
  const place = (g: GymState, id = 'gym') => g.locations.find((l) => l.id === id)! as GymLocation & { fieldTimes?: Record<string, number> }

  it('the unit set on one tab and the rings added on the other, a second apart, both survive — in either order', () => {
    const a = reduceGym(base(), { op: 'saveLocation', location: { ...GYM, unit: 'lb' } }, NOW)!
    const b = reduceGym(base(), { op: 'saveLocation', location: { ...GYM, equipment: [...GYM.equipment, 'rings'] } }, NOW + 1000)!
    for (const m of [mergeGym(a, b)!, mergeGym(b, a)!]) {
      expect(place(m).unit).toBe('lb')
      expect(place(m).equipment).toContain('rings')
    }
  })

  it('the newer edit of the same setting wins, and a tie keeps the local one', () => {
    const a = reduceGym(base(), { op: 'saveLocation', location: { ...GYM, name: 'Left' } }, NOW)!
    const b = reduceGym(base(), { op: 'saveLocation', location: { ...GYM, name: 'Right' } }, NOW + 1000)!
    expect(place(mergeGym(a, b)!).name).toBe('Right')
    expect(place(mergeGym(b, a)!).name).toBe('Right')
    const c = reduceGym(base(), { op: 'saveLocation', location: { ...GYM, name: 'Tie' } }, NOW)!
    expect(place(mergeGym(a, c)!).name).toBe('Left')
  })

  it('a save with no field times (an older save) is read as one time for every setting', () => {
    const old = { ...base(), locations: [{ ...GYM, unit: 'lb' as const, updatedAt: 10 }, base().locations[1]] }
    const newer = { ...base(), locations: [{ ...GYM, equipment: [...GYM.equipment, 'rings' as const], updatedAt: 20 }, base().locations[1]] }
    const m = mergeGym(old, newer)!
    expect(place(m).unit).toBe('kg')
    expect(place(m).equipment).toContain('rings')
    expect(place(m).fieldTimes).toBeUndefined()
    // ...and mixed with a stamped copy, the stamps stand against the plain time.
    const stamped = reduceGym({ ...base(), locations: [{ ...GYM, updatedAt: 5 }, base().locations[1]] }, { op: 'saveLocation', location: { ...GYM, name: 'Stamped' } }, 15)!
    expect(place(mergeGym(stamped, old)!).name).toBe('Stamped')
    expect(place(mergeGym(stamped, old)!).unit).toBe('lb')
  })

  it('returns the local copy itself when nothing changed', () => {
    const a = reduceGym(base(), { op: 'saveLocation', location: { ...GYM, unit: 'lb' } }, NOW)!
    const b = reduceGym(base(), { op: 'saveLocation', location: { ...GYM, equipment: [...GYM.equipment, 'rings'] } }, NOW + 1000)!
    const m = mergeGym(a, b)!
    expect(mergeGym(m, a)).toBe(m)
    expect(mergeGym(m, b)).toBe(m)
    expect(mergeGym(m, m)).toBe(m)
  })

  it('stamps only the settings a save changed, and keeps the stamps through a reload', () => {
    const a = reduceGym(base(), { op: 'saveLocation', location: { ...GYM, unit: 'lb' } }, NOW)!
    const t = place(a).fieldTimes!
    expect(t.unit).toBe(NOW)
    expect(t.equipment).toBe(GYM.updatedAt)
    expect(place(sanitizeGym(JSON.parse(JSON.stringify(a)))!).fieldTimes).toEqual(t)
  })

  it('a hard-here mark still merges mark by mark beside the settings', () => {
    const a = reduceGym(base(), { op: 'toggleHardHere', locationId: 'gym', exerciseId: 'pull-up' }, NOW)!
    const b = reduceGym(base(), { op: 'saveLocation', location: { ...GYM, unit: 'lb' } }, NOW + 1000)!
    const m = mergeGym(a, b)!
    expect(place(m).hardHere).toContain('pull-up')
    expect(place(m).unit).toBe('lb')
  })
})
