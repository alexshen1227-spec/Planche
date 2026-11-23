import { MUSCLES, type Muscle } from '../../data/gym/catalog'
import { GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import { STEP_BY_ID, stepsOf } from '../../data/progressions'
import { skillOfExercise } from '../../data/skills'
import { finalizeWorkout, finalizeWorkoutWithPlan } from '../../data/workouts'
import type { AppState, EquipmentId, SkillId, StepId, Workout, WorkoutRequest } from '../../types'
import { applySession } from '../engine'
import { buildGymSession, type GymFocus } from '../gym/builder'
import { conservative } from '../gym/draft'
import { loadForReps } from '../gym/progression'
import { defaultGym, defaultPrefs } from '../gym/state'
import type { GymLocation, GymSession, GymSet, SportSlot, TrainingPrefs } from '../gym/types'
import type { LineupEntry } from '../lineup'
import { sessionFromWorkout } from '../skillLoop'
import { stepOfSkill } from '../skills'
import { initialState, reducer } from '../store'
import { addDays, dayKey, weekStart } from '../time'
import { setsPerMuscle, volumeTarget } from './load'
import { AFTER_OPENER_WARM_UP_MIN, planWeekAhead, skillRequest, soreJoints, type TodayPlan, type WeekAhead } from './planner'

/**
 * The whole athlete, closed: every day the screens' own recommendation is
 * started — `planWeekAhead`'s today, its skill block through `skillRequest` and
 * the session builder, or a gym day's opener and then the lifts from the Today
 * card's preset — and done by a body whose truth is known, then fed back
 * through the real engine and the real gym store. A planche-only control on
 * the same days is the yardstick for what the first priority is owed.
 *
 * The athlete obeys: comes down at every working-set call, holds attempts and
 * re-tests to their limit, films and confirms every main hold (the skill
 * loop's `sessionFromWorkout`), and lifts every gym set the builder gives at a
 * load their known max allows. Hold capacity rises with the main sets a skill
 * got (`perSet`), or by a fixed amount per session trained, so a skill the
 * plan starves of sets visibly falls behind. Lifting maxes rise a little with
 * every lift trained. Nothing here is a claim about physiology: it is a body
 * the plan can be held to.
 */

export const HOME_KIT: EquipmentId[] = ['floor', 'parallettes', 'wall']

export const GYM_PLACE: GymLocation = {
  id: 'gym',
  name: 'The gym',
  unit: 'kg',
  equipment: [
    'barbell',
    'squat-rack',
    'bench',
    'incline-bench',
    'dumbbells',
    'cable',
    'lat-pulldown',
    'leg-press',
    'leg-curl',
    'leg-extension',
    'calf-machine',
    'pullup-bar',
    'dip-bars',
    'box',
    'cable-row',
    'track',
  ],
  updatedAt: 1,
}

/** Practice on Tuesday evening, a game on Saturday morning: the athlete's sport week. */
export const SPORT_WEEK: SportSlot[] = [
  { weekday: 2, kind: 'practice', minutes: 90, rpe: 6, legs: true, hour: 17 },
  { weekday: 6, kind: 'game', minutes: 80, rpe: 8, legs: true, hour: 10 },
]

export interface AthleteCfg {
  skills: SkillId[]
  birthYear?: number
  steps?: Partial<Record<SkillId, StepId>>
  prefs?: Partial<TrainingPrefs>
  kit?: EquipmentId[]
  /** Where the athlete has the app set: the gym or home. */
  active?: 'gym' | 'home'
}

export function makeAthlete(cfg: AthleteCfg): AppState {
  const steps = cfg.steps ?? {}
  const kit = cfg.kit ?? HOME_KIT
  let state = reducer(initialState(), {
    type: 'COMPLETE_ONBOARDING',
    name: 'Athlete',
    stepId: steps.planche ?? (cfg.skills.includes('planche') ? 'tuck' : 'foundations'),
    weeklyGoal: 4,
    sessionMinutes: 45,
    profile: { ...initialState().profile, equipment: kit, ...(cfg.birthYear ? { birthYear: cfg.birthYear } : {}) },
    units: 'metric',
    skills: cfg.skills,
    placements: Object.fromEntries(cfg.skills.filter((s) => s !== 'planche').map((s) => [s, { stepId: steps[s] ?? stepsOf(s)[0].id }])),
  })
  const gym = defaultGym(kit, 'kg', 1)
  state = {
    ...state,
    gym: {
      ...gym,
      locations: [...gym.locations, GYM_PLACE],
      activeLocationId: cfg.active === 'home' ? gym.locations[0].id : GYM_PLACE.id,
      prefs: { ...defaultPrefs(1), ...(cfg.prefs ?? {}) },
    },
  }
  return state
}

const LEG_MUSCLES = new Set<Muscle>(MUSCLES.filter((m) => m.group === 'legs').map((m) => m.id))

/** One skill's part of a logged session. */
export interface SkillPart {
  step: StepId
  role?: string
  /** Main-section sets of the skill (holds, attempts, next-shape work). */
  main: number
  /** Working sets of the step's key hold (no attempts, next-shape work or re-tests). */
  key: number
  /** The longest working target of the key hold. */
  target?: number
  retest: boolean
  attempt: boolean
}

export interface SkillRun {
  at: number
  opener: boolean
  name: string
  minutes: number
  lineup: LineupEntry[]
  parts: Partial<Record<SkillId, SkillPart>>
  /**
   * The first priority's key hold (`sets`) against its kept dose (every set but the reach) and its whole dose in an
   * untrimmed build at the same moment, and against what it gets alone in the same minutes (`alone`): a day too
   * short for the kept dose even alone can only be held to that.
   */
  dose?: { sets: number; kept: number; full: number; alone: number }
  painSafe: boolean
}

export interface GymRun {
  at: number
  focus: GymFocus
  items: { id: string; sets: number; kg?: number; reps: number[] }[]
  /** Chest was under its weekly lower target when the day was planned. */
  chestUnder: boolean
  /** A movement with chest as a primary muscle was in the session. */
  chestPress: boolean
}

export interface DayRun {
  at: number
  plan: TodayPlan
  week: WeekAhead
  skill: SkillRun[]
  gym?: GymRun
  /** Later days whose first-priority exposure moved when today's plan was followed (`stability`). */
  moved: string[]
  /** Today's plan after the opener was saved and before the lifts: still this gym day, lifts next. */
  afterOpener?: { kind: TodayPlan['kind']; focus?: GymFocus; skills?: SkillId[] }
}

export interface LoopOut {
  days: DayRun[]
  state: AppState
  truth: Map<string, number>
  /** The first calendar day each step was held, per skill (YYYY-MM-DD). */
  reached: Map<StepId, string>
}

export interface LoopOpts {
  from: Date
  days: number
  /** The local hour the athlete trains at. */
  hour?: number
  /** Seconds of capacity a skill gains per main set it got; otherwise `gain` per session with two or more. */
  perSet?: number
  gain?: number
  truthStart: Record<string, number>
  /** Called with each day's moment before anything is planned, for a fake clock. */
  setClock?: (at: number) => void
  /** Re-plan after following today's plan and record what moved (the days with an index below it; all when true). */
  stability?: boolean | number
  /** Called with the state and moment of each day, after it is planned and before it is trained. */
  observe?: (state: AppState, at: number, plan: TodayPlan) => void
}

const key = (state: AppState, skill: SkillId) => STEP_BY_ID[stepOfSkill(state, skill)]?.keyExerciseId

/** The first priority's exposure days among the days after today: led, or opened with. */
export function exposureDays(week: WeekAhead, skill: SkillId): string[] {
  return week.days
    .slice(1)
    .filter((d) => d.plan.skill?.skills[0] === skill && (d.plan.kind === 'calisthenics' || d.plan.skill?.opener))
    .map((d) => d.day)
}

export function runLoop(start: AppState, opts: LoopOpts): LoopOut {
  let state = start
  const first = (state.profile.skills?.[0] ?? 'planche') as SkillId
  const skills = (state.profile.skills?.length ? state.profile.skills : ['planche']) as SkillId[]
  const truth = new Map<string, number>(Object.entries(opts.truthStart))
  const capOf = (id: string) => {
    if (!truth.has(id)) {
      const step = Object.values(STEP_BY_ID).find((s) => s.keyExerciseId === id)
      truth.set(id, step ? step.startSec * 0.8 : 30)
    }
    return truth.get(id)!
  }
  const e1rm = new Map<string, number>()
  const e1Of = (id: string) => {
    if (!e1rm.has(id)) {
      const ex = GYM_EXERCISE_BY_ID[id]
      const legs = ex?.primary.some((m) => LEG_MUSCLES.has(m)) ? 1.8 : 1
      e1rm.set(id, (ex?.compound ? 45 : 14) * legs)
    }
    return e1rm.get(id)!
  }
  const reached = new Map<StepId, string>()
  const mark = (at: number) => {
    for (const s of skills) {
      const step = stepOfSkill(state, s)
      if (!reached.has(step)) reached.set(step, dayKey(at))
    }
  }
  mark(opts.from.getTime())
  const youth = conservative(state.profile, opts.from.getTime())
  const days: DayRun[] = []

  const doSkill = (request: WorkoutRequest, t: number, opener: boolean, run: DayRun): number => {
    const { workout, lineup } = finalizeWorkoutWithPlan(state, request, undefined, t)
    run.skill.push(describeSkill(state, workout, lineup, t, opener, request, first))
    const session = sessionFromWorkout(state, workout, lineup, t, `s-${t}`, capOf)
    const main: Partial<Record<SkillId, number>> = {}
    for (const b of workout.blocks) {
      const sk = skillOfExercise(b.exerciseId)
      if (sk && b.section === 'main') main[sk] = (main[sk] ?? 0) + b.sets
    }
    state = applySession(state, session).next
    for (const [id, v] of truth) {
      const owner = skillOfExercise(id)
      if (!owner) continue
      const n = main[owner] ?? 0
      if (opts.perSet !== undefined) truth.set(id, v + opts.perSet * n)
      else if (n >= 2) truth.set(id, v + (opts.gain ?? 0.35))
      else if (n === 1) truth.set(id, v + (opts.gain ?? 0.35) / 3)
    }
    mark(t)
    return session.endedAt ?? t + 30 * 60_000
  }

  for (let d = 0; d < opts.days; d++) {
    const date = addDays(new Date(opts.from.getFullYear(), opts.from.getMonth(), opts.from.getDate()).getTime(), d)
    const at = new Date(date).setHours(opts.hour ?? 17, 0, 0, 0)
    opts.setClock?.(at)
    const week = planWeekAhead(state, at)
    const plan = week.days[0].plan
    const run: DayRun = { at, plan, week, skill: [], moved: [] }
    opts.observe?.(state, at, plan)
    const stable = opts.stability === true || (typeof opts.stability === 'number' && d < opts.stability)
    const before = stable ? exposureDays(week, first) : []
    // Gym days are planned at the gym (`TodayPlan.gym.placeId`): the lifts are built there, wherever the app is set.
    const place = state.gym!.locations.find((l) => l.id === (plan.gym?.placeId ?? state.gym!.activeLocationId))!
    let t = at
    if (plan.kind === 'calisthenics' && plan.skill) {
      t = doSkill(skillRequest(plan.skill), t, false, run)
    } else if (plan.kind === 'gym' && plan.gym) {
      if (plan.skill?.opener) {
        t = doSkill(skillRequest(plan.skill), t, true, run) + 5 * 60_000
        if (stable) {
          opts.setClock?.(t)
          const mid = planWeekAhead(state, t).days[0].plan
          run.afterOpener = { kind: mid.kind, ...(mid.gym ? { focus: mid.gym.focus } : {}), ...(mid.skill ? { skills: mid.skill.skills } : {}) }
        }
      }
      run.gym = doGym(plan, t, place)
      t += 60 * 60_000
    }
    if (stable && run.skill.length + (run.gym ? 1 : 0) > 0) {
      opts.setClock?.(t)
      const after = exposureDays(planWeekAhead(state, t), first)
      run.moved = [...before.filter((x) => !after.includes(x)).map((x) => `-${x}`), ...after.filter((x) => !before.includes(x)).map((x) => `+${x}`)]
    }
    days.push(run)
  }
  return { days, state, truth, reached }

  function doGym(plan: TodayPlan, t: number, place: GymLocation): GymRun {
    const g = plan.gym!
    const opener = Boolean(plan.skill?.opener)
    const sore = soreJoints(state, t)
    const prefs = state.gym!.prefs!
    const weekSets = setsPerMuscle(state.sessions, state.gym!.sessions, weekStart(t), t)
    const chestUnder = (weekSets.chest ?? 0) < volumeTarget('chest', prefs)[0]
    const built = buildGymSession({
      location: place,
      minutes: g.minutes,
      focus: g.focus,
      sessions: state.gym!.sessions,
      ratings: state.gym!.ratings,
      favoriteAt: state.gym!.favoriteAt,
      youth,
      goals: prefs.goals,
      musclesOff: g.musclesOff,
      ...(g.spare?.length ? { spare: g.spare } : {}),
      priority: [...new Set([...prefs.musclesPriority, ...(g.priority ?? [])])],
      avoidJoints: [...new Set([...g.avoidJoints, ...sore.joints])],
      volumeFactor: g.volumeFactor,
      ...(opener ? { warmUpMin: AFTER_OPENER_WARM_UP_MIN } : {}),
      now: t,
    })
    let clock = t
    const exercises = built.items.map((it) => {
      const ex = GYM_EXERCISE_BY_ID[it.exerciseId]
      const [lo, hi] = it.suggestion.reps ?? it.plan.range
      const rpeT = it.suggestion.targetRpe ?? it.plan.targetRpe
      const sets: GymSet[] = []
      const loaded = ex && ex.load !== 'bodyweight' && !ex.assisted
      let kg = loaded ? (it.suggestion.kg ?? Math.max(2.5, Math.round(loadForReps(e1Of(it.exerciseId), hi, rpeT - 1) / 2.5) * 2.5)) : undefined
      if (kg !== undefined && !(kg > 0)) kg = 2.5
      for (let s = 0; s < it.sets; s++) {
        clock += 3 * 60_000
        if (kg === undefined) {
          sets.push({ reps: hi, rpe: rpeT, at: clock })
          continue
        }
        const max = 30 * (e1Of(it.exerciseId) / kg - 1) - 0.7 * s
        let reps = Math.min(hi, Math.floor(max - (10 - rpeT)))
        if (reps < lo) reps = Math.max(1, Math.floor(max))
        const rpe = Math.max(6, Math.min(10, Math.round((10 - (max - reps)) * 2) / 2))
        sets.push({ kg, reps, rpe, unit: 'kg', at: clock })
      }
      return { exerciseId: it.exerciseId, sets, repRange: [lo, hi] as [number, number], targetRpe: rpeT }
    })
    const session: GymSession = { id: `g-${t}`, locationId: place.id, startedAt: t, endedAt: clock + 60_000, name: built.name, exercises, completion: 'full' }
    state = reducer(state, { type: 'GYM', op: { op: 'saveSession', session } })
    for (const e of exercises) if (e.sets.length >= 2 && e.sets[0].kg) e1rm.set(e.exerciseId, e1Of(e.exerciseId) * 1.008)
    return {
      at: t,
      focus: g.focus,
      items: exercises.map((e) => ({ id: e.exerciseId, sets: e.sets.length, ...(e.sets[0]?.kg !== undefined ? { kg: e.sets[0].kg } : {}), reps: e.sets.map((s) => s.reps) })),
      chestUnder,
      chestPress: exercises.some((e) => { const ex = GYM_EXERCISE_BY_ID[e.exerciseId]; return Boolean(ex) && (ex.pattern === 'horizontal-press' || ex.pattern === 'incline-press') && (ex.primary.includes('chest') || ex.primary.includes('chest-upper')) }),
    }
  }
}

function describeSkill(state: AppState, workout: Workout, lineup: LineupEntry[], at: number, opener: boolean, request: WorkoutRequest, first: SkillId): SkillRun {
  const parts: Partial<Record<SkillId, SkillPart>> = {}
  for (const entry of lineup) {
    const k = key(state, entry.skill)
    const part: SkillPart = { step: stepOfSkill(state, entry.skill), role: entry.role, main: 0, key: 0, retest: false, attempt: false }
    for (const b of workout.blocks) {
      if (b.section !== 'main' || skillOfExercise(b.exerciseId) !== entry.skill) continue
      part.main += b.sets
      if (b.retest) part.retest = true
      if (b.role === 'attempt') part.attempt = true
      if (b.exerciseId === k && b.role === 'skill' && !b.retest && b.target.kind === 'hold') {
        part.key += b.sets
        part.target = Math.max(part.target ?? 0, b.target.sec)
      }
    }
    parts[entry.skill] = part
  }
  const painSafe = workout.id.startsWith('pain-safe-recovery')
  let dose: SkillRun['dose']
  if (lineup[0]?.skill === first && !painSafe) {
    const reference = finalizeWorkout(state, { source: 'auto', skills: [first], minutes: 240, ...(request.kit ? { kit: request.kit } : {}) }, undefined, at)
    const k = key(state, first)
    const block = reference.blocks.find((b) => b.section === 'main' && b.exerciseId === k && b.role === 'skill' && !b.retest)
    const solo = finalizeWorkout(state, { source: 'auto', skills: [first], ...(request.minutes ? { minutes: request.minutes } : {}), ...(request.kit ? { kit: request.kit } : {}) }, undefined, at)
    const alone = solo.blocks.filter((b) => b.section === 'main' && b.exerciseId === k && b.role === 'skill' && !b.retest).reduce((n, b) => n + b.sets, 0)
    if (block) dose = { sets: parts[first]?.key ?? 0, kept: block.sets - (block.reach ?? 0), full: block.sets, alone }
  }
  return { at, opener, name: workout.name, minutes: workout.minutes ?? 0, lineup, parts, ...(dose ? { dose } : {}), painSafe }
}

/** Calendar weeks of the run, Monday first, as lists of days. */
export function weeksOf(out: LoopOut): DayRun[][] {
  const by = new Map<number, DayRun[]>()
  for (const d of out.days) {
    const w = weekStart(d.at)
    const list = by.get(w)
    if (list) list.push(d)
    else by.set(w, [d])
  }
  return [...by.values()]
}

/** A skill's sessions: led (or opened), with its key-hold sets and whether the dose was kept. */
export function exposuresOf(days: DayRun[], skill: SkillId): { at: number; key: number; main: number; opener: boolean; full: boolean }[] {
  const out: { at: number; key: number; main: number; opener: boolean; full: boolean }[] = []
  for (const d of days) {
    for (const s of d.skill) {
      if (s.lineup[0]?.skill !== skill || s.painSafe) continue
      const p = s.parts[skill]
      out.push({ at: s.at, key: p?.key ?? 0, main: p?.main ?? 0, opener: s.opener, full: !s.dose || s.dose.sets >= Math.min(s.dose.kept, s.dose.alone) })
    }
  }
  return out
}

/** Key-hold working sets of a skill over some days, every session it appeared in. */
export function keySets(days: DayRun[], skill: SkillId): number {
  return days.reduce((n, d) => n + d.skill.reduce((m, s) => m + (s.parts[skill]?.key ?? 0), 0), 0)
}

/** Main sets of a skill over some days. */
export function mainSets(days: DayRun[], skill: SkillId): number {
  return days.reduce((n, d) => n + d.skill.reduce((m, s) => m + (s.parts[skill]?.main ?? 0), 0), 0)
}

/** One line a week, for reading a run: kinds, and per skill led/opened/short sessions and sets. */
export function weekRows(out: LoopOut, skills: SkillId[]): string[] {
  return weeksOf(out).map((ds, w) => {
    const kinds = ds.map((d) => (d.plan.kind === 'gym' ? (d.plan.skill?.opener ? 'G' : 'g') : d.plan.kind[0])).join('')
    const per = skills.map((sk) => {
      const ex = exposuresOf(ds, sk)
      const short = ds.reduce((n, d) => n + d.skill.filter((s) => s.lineup[0]?.skill !== sk && (s.parts[sk]?.main ?? 0) > 0).length, 0)
      return `${sk} ${ex.filter((e) => !e.opener).length}+${ex.filter((e) => e.opener).length}o+${short}s key ${keySets(ds, sk)} main ${mainSets(ds, sk)}${ex.some((e) => !e.full) ? ' (thin)' : ''}`
    })
    const gym = ds.filter((d) => d.gym).map((d) => `${d.gym!.focus}:${d.gym!.items.map((i) => `${i.id}${i.kg ? '@' + i.kg : ''}x${i.sets}`).join(',')}`)
    return `wk${w + 1} [${kinds}] ${per.join(' | ')} || ${gym.join(' ; ')}`
  })
}
