import { describe, expect, it } from 'vitest'
import { GYM_EQUIPMENT } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { finalizeWorkout } from '../../data/workouts'
import { planWeekAhead } from '../plan/planner'
import { calisthenicsRequest } from '../plan/screens'
import { volumeTarget } from '../plan/load'
import { compareLiftingDays } from '../plan/weekComparison'
import { makeAthlete } from '../plan/wholeAthleteLoop'
import { addDays } from '../time'
import { availableAt, searchExercises } from './availability'
import { buildGymSession } from './builder'
import { comparablePerformance, suggestLoad } from './progression'
import { previousSets } from './draft'
import { defaultPrefs, homeLocation, sanitizePrefs, setLiftingWeekday, setWeekdayFocus } from './state'
import { bodyweightCapacity } from './bodyweight'
import { fitsGymFocus, loggedFocus } from './focus'
import type { GymSession } from './types'

const now = +new Date(2026, 10, 30, 9)
const gym = homeLocation(['floor', 'wall', 'box', 'band', 'pullup-bar', 'rings'], 'kg', now)
gym.equipment.push(...GYM_EQUIPMENT.map((e) => e.id))
const logs = (id: string, place: string, exerciseId: string, at: number, reps: number[], rpe = 7): GymSession =>
  ({ id, name: 'Custom workout', locationId: place, startedAt: at, endedAt: at + 9000,
    exercises: [{ exerciseId, sets: reps.map((n, i) => ({ at: at + i * 1000, reps: n, rpe })) }] })

describe('lifting splits and portable starting doses', () => {
  it('keeps every automatic slot, accessory and spare-time lift inside a named split', () => {
    for (const focus of ['push', 'pull', 'lower', 'upper'] as const) for (const minutes of [20, 45, 90]) {
      const priority = ['chest', 'upper-back', 'biceps', 'hamstrings', 'side-delts', 'quads', 'triceps'] as const
      const plan = buildGymSession({ focus, minutes, location: gym, priority: [...priority], athletePriority: priority, sessions: [],
        goals: { skills: 4, physique: 5, strength: 3, power: 4, endurance: 0 }, now })
      expect(plan.items.length, focus).toBeGreaterThan(0)
      expect(plan.items.every((it) => fitsGymFocus(focus, GYM_EXERCISE_BY_ID[it.exerciseId]))).toBe(true)
      if (focus === 'pull') expect(plan.items.flatMap((it) => GYM_EXERCISE_BY_ID[it.exerciseId].primary)).not.toEqual(expect.arrayContaining(['chest']))
      expect(plan.estimatedMin).toBeLessThanOrEqual(minutes)
    }
    for (const id of ['db-pullover', 'barbell-pullover', 'ez-pullover']) {
      expect(fitsGymFocus('pull', GYM_EXERCISE_BY_ID[id])).toBe(false)
      expect(fitsGymFocus('upper', GYM_EXERCISE_BY_ID[id])).toBe(true)
    }
  })

  it('fits two practices of each skill and two separated quad exposures into four visits with equal lat and quad goals', () => {
    const state = makeAthlete({ skills: ['frontlever', 'handstand'], active: 'home', birthYear: 1994,
      steps: { frontlever: 'fl-tuck', handstand: 'hs-wall' }, kit: ['floor', 'band', 'pullup-bar', 'wall'],
      prefs: { goals: { physique: 5, skills: 4, strength: 3, power: 0, endurance: 0 },
        minutesByDay: [0, 60, 60, 45, 0, 60, 0], placeByDay: [null, 'home', 'gym', null, null, 'gym', null], musclesPriority: ['lats', 'quads'] } })
    state.gym!.locations = state.gym!.locations.map((place, i) => ({ ...place,
      equipment: i ? [...place.equipment, 'wall'] : [...place.equipment, 'bench', 'dumbbells'] }))
    const answers = { wrist: 2, pushups: 12, hollow: 35, pullups: 7, experience: 12, 'level:frontlever': 1, 'level:handstand': 1 }
    for (const [skill, step] of [['frontlever', 'fl-tuck'], ['handstand', 'hs-wall']] as const) {
      state.tracks![skill]!.assessment = { at: now - 1, answers, placedStepId: step, confidence: 'moderate', gapIds: [] }
    }
    const week = planWeekAhead(state, now)
    for (const skill of ['frontlever', 'handstand'] as const) expect(week.days.filter((d) => d.skillWorkingSets?.[skill]).length).toBeGreaterThanOrEqual(2)
    for (const m of ['quads', 'lats'] as const) {
      const [low, high] = volumeTarget(m, state.gym!.prefs!)
      expect(week.weekTotal[m], m).toBeGreaterThanOrEqual(low)
      expect(week.weekTotal[m], m).toBeLessThanOrEqual(high)
    }
    const quadVisits = week.remainingLifts.filter((d) => d.items.some((it) => GYM_EXERCISE_BY_ID[it.exerciseId].primary.includes('quads')))
    expect(quadVisits.length).toBeGreaterThanOrEqual(2)
    expect(quadVisits[1].at - quadVisits[0].at).toBeGreaterThanOrEqual(2 * 86_400_000)
  })

  it('keeps a saved weekday split when feasible and rotates after the actual workout', () => {
    const state = makeAthlete({ skills: [], active: 'gym', birthYear: 1993, prefs: {
      goals: { strength: 3, physique: 5, skills: 0, endurance: 0, power: 0 }, minutesByDay: [0, 50, 50, 0, 50, 0, 0] } })
    let prefs = setWeekdayFocus(state.gym!.prefs!, 1, 'pull')
    prefs = setWeekdayFocus(prefs, 2, 'pull')
    state.gym!.prefs = sanitizePrefs(prefs)!
    expect(state.gym!.prefs!.focusByDay).toEqual([null, 'pull', 'pull', null, null, null, null])
    const week = planWeekAhead(state, now)
    expect(week.days[0].plan.gym?.focus).toBe('pull')
    expect(week.days[1].plan.gym?.focus).toBeTruthy()
    expect(week.days[1].plan.gym?.focus).not.toBe('pull')
    const workout = logs('renamed', 'gym', 'lat-pulldown', now, [10, 10, 10, 10], 8)
    workout.name = 'Chest'
    state.gym!.sessions = [workout]
    const tomorrow = planWeekAhead(state, addDays(now, 1)).days[0].plan
    expect(tomorrow.gym?.focus).toBeTruthy()
    expect(tomorrow.gym?.focus).not.toBe('pull')
    expect(tomorrow.reasons.join(' ')).toContain('usually choose Pull')
    const removed = setLiftingWeekday(state.gym!.prefs!, 1, false)
    expect(removed.focusByDay).toEqual([null, null, 'pull', null, null, null, null])
    expect(sanitizePrefs({ ...removed, focusByDay: [null, 'push', 'constructor'] })?.focusByDay).toBeUndefined()
  })

  it('keeps Tuesday Push and Saturday Lower when both lever practices fit on other gym visits', () => {
    const at = +new Date(2026, 10, 17, 17, 30)
    const state = makeAthlete({ skills: ['frontlever'], active: 'gym', birthYear: 1994, steps: { frontlever: 'fl-advtuck' }, kit: ['floor', 'box', 'band'],
      prefs: { goals: { skills: 4, strength: 2, physique: 5, endurance: 0, power: 0 }, minutesByDay: [45, 0, 60, 0, 45, 0, 60],
        placeByDay: ['home', null, 'gym', null, 'gym', null, 'gym'], musclesPriority: ['chest-upper', 'side-delts', 'calves'],
        gymWeekdays: [0, 2, 6], focusByDay: [null, null, 'push', null, null, null, 'lower'], shortSkillOpeners: true } })
    state.settings.weeklyGoal = 4
    state.tracks!.frontlever!.assessment = { at: at - 60000, placedStepId: 'fl-advtuck', confidence: 'moderate', gapIds: [],
      answers: { hollow: 50, pullups: 7, 'level:frontlever': 2, experience: 12 } }
    const week = planWeekAhead(state, at)
    expect(week.days[0].plan.gym?.focus).toBe('push')
    expect(week.days[0].plan.skill).toBeUndefined()
    expect(week.days[4].plan.gym?.focus).toBe('lower')
    expect(week.days[2].plan.gym?.focus).not.toBe('lower')
    for (const index of [2, 4]) expect(week.days[index].skillWorkingSets?.frontlever).toBeGreaterThanOrEqual(2)
    const push = week.remainingLifts.find((day) => day.at === week.days[0].at)!
    expect(push.items.every((item) => fitsGymFocus('push', GYM_EXERCISE_BY_ID[item.exerciseId]))).toBe(true)
  })

  it('fits two planche practices and leg training around a saved or confirmed home Pull day', () => {
    const at = +new Date(2026, 10, 24, 10, 40)
    const state = makeAthlete({ skills: ['planche'], active: 'home', birthYear: 1993, steps: { planche: 'lean' }, kit: ['floor', 'pullup-bar'],
      prefs: { goals: { strength: 3, power: 0, physique: 5, skills: 3, endurance: 0 }, minutesByDay: [0, 0, 45, 0, 45, 0, 45],
        gymWeekdays: [2], focusByDay: [null, null, 'pull', null, null, null, null], musclesPriority: ['chest', 'chest-upper', 'side-delts'],
        straightArmRestHours: 48 } })
    state.settings.weeklyGoal = 3
    state.profile.goalStepId = 'tuck'
    const home = state.gym!.locations[0]
    home.equipment = ['floor', 'pullup-bar', 'dumbbells', 'incline-bench']
    state.gym!.locations = [home]
    const saved = planWeekAhead(state, at)
    const confirmed = planWeekAhead(state, at, { todayKind: 'gym', todayFocus: 'pull', todayMinutes: 45, todayPlace: home })
    for (const week of [saved, confirmed]) {
      expect(week.days[0].plan.gym?.focus).toBe('pull')
      expect(week.days[0].plan.skill).toBeUndefined()
      for (const i of [2, 4]) {
        const day = week.days[i]
        expect(day.skillWorkingSets?.planche).toBeGreaterThanOrEqual(2)
        expect((day.plan.skill?.minutes ?? 0) + (day.plan.gym?.minutes ?? 0)).toBeLessThanOrEqual(45)
      }
      expect(week.remainingLifts.every((block) => block.estimatedMin <= block.minutes)).toBe(true)
      for (const m of ['chest-upper', 'side-delts', 'quads', 'hamstrings'] as const) expect(week.weekTotal[m] ?? 0, m).toBeGreaterThan(0)
    }
    expect(confirmed.remainingLifts).toEqual(saved.remainingLifts)
    const comparison = compareLiftingDays(state, {}, at)!.current
    expect(comparison.practiceDays.planche).toBe(2)
    expect(comparison.remainingSkillSets.planche).toBe(8)
    expect(comparison.remainingSkillMinutes + comparison.remainingLiftMinutes).toBe(3 * 45)
  })

  it('uses the recommended home kit and drops only extra pressing after actual bench work on a custom day', () => {
    const state = makeAthlete({ skills: ['frontlever', 'handstand'], active: 'gym', birthYear: 1994,
      kit: ['floor', 'wall', 'pullup-bar'], steps: { frontlever: 'fl-tuck', handstand: 'hs-wall' } })
    const yesterday = addDays(now, -1)
    const bench = logs('custom', 'gym', 'db-bench-press', yesterday, [10, 10, 10, 10], 8)
    bench.name = 'Lower'
    bench.exercises.push({ exerciseId: 'leg-extension', sets: [{ at: yesterday, reps: 12 }] })
    state.gym!.sessions = [bench]
    const request = calisthenicsRequest(state, { minutes: 45, skills: ['frontlever', 'handstand'], hard: [], placeId: 'home' })
    expect(request.placeId).toBe('home')
    expect(request.kit).toContain('wall')
    const workout = finalizeWorkout(state, request, undefined, now)
    expect(workout.blocks.some((b) => b.exerciseId === 'tuck-front-lever' && b.section === 'main')).toBe(true)
    expect(workout.blocks.some((b) => b.exerciseId === 'wall-handstand' && b.section === 'main')).toBe(true)
    expect(workout.blocks.some((b) => b.exerciseId === 'pike-pushup')).toBe(false)
    expect(workout.adjustments?.join(' ')).toContain('4 pressing sets')
    expect(workout.adjustments?.join(' ')).not.toContain('Pike Push-Up set to')
    const fresh = finalizeWorkout({ ...state, gym: { ...state.gym!, sessions: [] } }, request, undefined, now)
    expect(fresh.blocks.some((b) => b.exerciseId === 'pike-pushup')).toBe(true)
    expect(workout.blocks.filter((b) => b.exerciseId === 'pullup')).toEqual(fresh.blocks.filter((b) => b.exerciseId === 'pullup'))
  })

  it('reads a short off-plan workout across Sunday and Monday, excluding warm-ups and zero reps', () => {
    const state = makeAthlete({ skills: [], birthYear: 1994, active: 'gym', prefs: { goals: { skills: 0, physique: 5, strength: 4, power: 0, endurance: 0 },
      minutesByDay: [45, 35, 45, 45, 0, 45, 0], musclesPriority: ['lats', 'biceps'] } })
    const yesterday = addDays(now, -1)
    const actual = logs('off-plan', 'gym', 'db-bent-over-row', yesterday, [6, 5])
    actual.name = 'Push'
    actual.exercises.push({ exerciseId: 'push-up', sets: [{ at: yesterday, reps: 12, warmup: true }, { at: yesterday, reps: 0 }] })
    state.gym!.sessions = [actual]
    expect(loggedFocus([actual], yesterday, now)).toBe('pull')
    expect(loggedFocus([logs('one', 'home', 'push-up', yesterday, [1])], yesterday, now)).toBeNull()
    const plan = planWeekAhead(state, now).days[0].plan
    expect(plan.gym?.focus).toBeDefined()
    expect(plan.gym?.focus).not.toBe('pull')
    expect(planWeekAhead(state, now, { todayKind: 'gym', todayFocus: 'pull' }).days[0].plan.gym?.focus).toBe('pull')
  })

  it('uses Wednesday’s no-equipment reps on Friday at another site and keeps bands and weights local', () => {
    const home = homeLocation(['floor', 'wall', 'band'], 'kg', now)
    const earlier = addDays(now, -4), later = addDays(now, -2)
    const dose = { range: [8, 15] as [number, number], targetRpe: 8 }
    for (const [exerciseId, travels] of [['hamstring-walkout', true], ['sissy-squat', true], ['band-biceps-curl', false], ['incline-push-up', false]] as const) {
      const sessions = [logs('away', 'studio', exerciseId, later, [12, 12]), logs('home', home.id, exerciseId, earlier, [12, 10])]
      expect(comparablePerformance(sessions, exerciseId, home.id, now)?.session.id).toBe(travels ? 'away' : 'home')
      expect(previousSets(sessions, exerciseId, home.id, 'kg', now)?.map((s) => s.reps)).toEqual(travels ? [12, 12] : [12, 10])
      expect(suggestLoad({ location: home, exerciseId, sessions, plan: dose, now }).targetReps).toBe(travels ? 13 : 11)
    }
    const push = logs('easy', home.id, 'push-up', earlier, [10, 10], 6)
    expect(suggestLoad({ exerciseId: 'push-up', location: home, sessions: [push], plan: { range: [6, 10], targetRpe: 8 }, now }).targetReps).toBe(11)
  })

  it('starts a reported six strict pulls at four reps, then lets actual lifting replace the report', () => {
    const prefs = { ...defaultPrefs(now), pullupStartingSet: { at: addDays(now, -1), reps: 6 } }
    const state = makeAthlete({ skills: [], birthYear: 1995, prefs })
    const bar = homeLocation(['floor', 'pullup-bar'], 'kg', now)
    const plan = buildGymSession({ location: bar, minutes: 20, focus: 'pull', sessions: [], now, capacity: bodyweightCapacity(state, now) })
    const pull = plan.items.find((it) => it.exerciseId === 'pull-up')
    expect(pull?.plan.range).toEqual([4, 4])
    expect(pull?.suggestion.why).toContain('reported 6')
    expect(state.gym!.sessions).toHaveLength(0)
    state.gym!.sessions = [logs('fresh', 'home', 'pull-up', now - 20000, [2, 2], 9)]
    expect(bodyweightCapacity(state, now).reportedPullups).toBeUndefined()
    expect(sanitizePrefs({ ...prefs, pullupStartingSet: { at: now, reps: -1 } })?.pullupStartingSet).toBeUndefined()
    expect(sanitizePrefs({ ...prefs, pullupStartingSet: { at: now, reps: 0 } })?.pullupStartingSet?.reps).toBe(0)
  })

  it('finds real no-bench rows and matches exercise, pattern and muscle names on word boundaries', () => {
    const home = homeLocation(['floor'], 'kg', now)
    home.equipment.push('dumbbells')
    const eligible = availableAt(home)
    const rows = searchExercises(eligible, 'db rows').map((e) => e.id)
    expect(rows).toContain('db-bent-over-row')
    expect(rows).toContain('thigh-braced-db-row')
    expect(rows).not.toContain('db-row')
    expect(searchExercises(eligible, 'row').some((e) => e.pattern === 'throw')).toBe(false)
    expect(searchExercises(eligible, 'traps').map((e) => e.id)).toContain('db-shrug')
    expect(searchExercises(eligible, 'single leg RDL').map((e) => e.id)).toContain('single-leg-rdl')
    expect(searchExercises(eligible, 'RDL').some((e) => e.explosive)).toBe(false)
    expect(searchExercises(eligible, 'DB lateral raises').map((e) => e.id)).toContain('db-lateral-raise')
    expect(eligible.some((e) => e.id === 'leaning-lateral-raise')).toBe(false)
    expect(availableAt({ ...home, equipment: [...home.equipment, 'squat-rack'] }).some((e) => e.id === 'leaning-lateral-raise')).toBe(true)
  })
})
