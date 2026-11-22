import { MUSCLE_BY_ID, type Joint, type Muscle } from '../../data/gym/catalog'
import { STEP_BY_ID } from '../../data/progressions'
import type { AppState, BodyRegion, SkillId } from '../../types'
import { forecastUnlock, goalOutlook } from '../forecast'
import { readinessTimeline } from '../signals'
import { skillView } from '../skills'
import { weekStart } from '../time'
import type { GymFocus } from '../gym/builder'
import { conservative } from '../gym/draft'
import { estimateOneRepMax } from '../gym/progression'
import { defaultPrefs } from '../gym/state'
import type { SkillGoal, TrainingPrefs } from '../gym/types'
import { fatigueAt, lastHardStraightArm, lastTrainedAt, setsPerMuscle, volumeTarget } from './load'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export const FOCUS_MUSCLES: Record<GymFocus, Muscle[]> = {
  push: ['chest', 'chest-upper', 'front-delts', 'side-delts', 'triceps', 'triceps-long'],
  pull: ['lats', 'upper-back', 'rear-delts', 'biceps', 'forearms'],
  lower: ['quads', 'hamstrings', 'glutes', 'calves', 'adductors'],
  upper: ['chest', 'chest-upper', 'front-delts', 'side-delts', 'rear-delts', 'triceps', 'lats', 'upper-back', 'biceps'],
  full: ['quads', 'glutes', 'hamstrings', 'chest', 'front-delts', 'lats', 'upper-back', 'triceps', 'biceps'],
}

const LEG_MUSCLES: Muscle[] = ['quads', 'hamstrings', 'glutes', 'calves', 'adductors']
/** Days of absence that count toward "left longest", and how much they weigh. */
const STALE_CAP_DAYS = 14
const STALE_WEIGHT = 0.25

/** Which straight-arm family a skill's hard work belongs to. The handstand is balance work. */
export function skillFamily(skill: SkillId): 'push' | 'pull' | 'balance' {
  if (skill === 'planche' || skill === 'ninety') return 'push'
  if (skill === 'frontlever' || skill === 'flag') return 'pull'
  return 'balance'
}

const REGION_JOINT: Partial<Record<BodyRegion, Joint>> = {
  wrist: 'wrists',
  elbow: 'elbows',
  shoulder: 'shoulders',
  'lower-back': 'lower-back',
  knee: 'knees',
}

export interface TodayPlan {
  minutes: number
  rest: boolean
  /** Skill work comes first in the session, while fresh. */
  skill?: { minutes: number; skills: SkillId[] }
  gym?: { minutes: number; focus: GymFocus; avoidJoints: Joint[]; volumeFactor: number; deload: boolean; musclesOff: Muscle[] }
  /** Why the day looks the way it does, in the athlete's terms. */
  reasons: string[]
}

function joinNames(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`
}

/** A run of hard gym weeks, or a fortnight of grinding sets: time for a lighter week (convention). */
export function gymDeloadDue(state: AppState, now: number): { due: boolean; why?: string } {
  const sessions = state.gym?.sessions ?? []
  const youth = conservative(state.profile, now)
  const weeksNeeded = youth ? 3 : 5
  const startThis = weekStart(now)
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const from = startThis - (i + 1) * WEEK
    const inWeek = sessions.filter((s) => s.startedAt >= from && s.startedAt < from + WEEK)
    const working = inWeek.flatMap((s) => s.exercises.flatMap((e) => e.sets.filter((x) => !x.warmup && x.reps > 0)))
    const rpes = working.filter((x) => x.rpe !== undefined).map((x) => x.rpe!)
    return { sessions: inWeek.length, sets: working.length, avg: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : 0 }
  })
  // A week well under the usual volume is a lighter week, however hard its
  // sets felt — it ends the run, or a deload logged at RPE 8 would call
  // another one every week after.
  const usual = Math.max(0, ...weeks.map((w) => w.sets))
  let hardRun = 0
  for (const w of weeks) {
    if (w.sessions >= 2 && w.avg >= 7.5 && w.sets >= 0.7 * usual) hardRun++
    else break
  }
  if (hardRun >= weeksNeeded) {
    return {
      due: true,
      why: `${hardRun} hard gym weeks in a row${youth ? ' (under 18 the lighter week comes sooner)' : ''}: this week is lighter — fewer sets, stopping further from failure. Deloads are a coaching convention; controlled trials have not shown they add strength, but they keep a long run of hard weeks sustainable.`,
    }
  }
  const recent = sessions.filter((s) => s.startedAt >= now - 14 * DAY && s.startedAt < now)
  const recentRpe = recent.flatMap((s) => s.exercises.flatMap((e) => e.sets.filter((x) => !x.warmup && x.rpe !== undefined).map((x) => x.rpe!)))
  if (recent.length >= 3 && recentRpe.length >= 12) {
    const avg = recentRpe.reduce((a, b) => a + b, 0) / recentRpe.length
    // Effort up while the estimated maxes did not move: the same work is costing more.
    // Only where both weeks have an estimate: no estimate is not "held still".
    const e1 = (from: number, to: number): number | null => {
      const values = recent
        .filter((s) => s.startedAt >= from && s.startedAt < to)
        .flatMap((s) => s.exercises.flatMap((e) => e.sets.filter((x) => !x.warmup).map((x) => estimateOneRepMax(x))))
        .filter((v): v is number => v !== null)
      return values.length ? Math.max(...values) : null
    }
    const thisWeek = e1(now - 7 * DAY, now)
    const lastWeek = e1(now - 14 * DAY, now - 7 * DAY)
    const stalled = thisWeek !== null && lastWeek !== null && thisWeek <= lastWeek
    if (avg >= 9 && stalled) {
      return { due: true, why: 'Your sets have averaged RPE 9 or more for two weeks while your estimated maxes held still: a lighter week now, then build again. A coaching convention, not a proven rule.' }
    }
  }
  return { due: false }
}

/**
 * Today's plan: how the minutes split between skill work and the gym, which
 * skills and which gym focus, and why. Pure: state and time in, plan out.
 */
export function planToday(state: AppState, opts: { now?: number; minutes?: number } = {}): TodayPlan {
  const now = opts.now ?? Date.now()
  const prefs: TrainingPrefs = state.gym?.prefs ?? defaultPrefs(now)
  const reasons: string[] = []
  const scheduled = prefs.minutesByDay[new Date(now).getDay()] ?? 0
  const minutes = opts.minutes ?? scheduled
  if (opts.minutes === undefined && scheduled === 0) {
    return {
      minutes: 0,
      rest: true,
      reasons: ['A rest day in your schedule. If you do have time after all, pick how many minutes and a session is built for them.'],
    }
  }

  // Pain and niggles: steer round the area for three days; pain also lightens the day.
  // Every report in the window counts, not only the latest: a "good" check-in
  // an hour later is not the elbow healing (the same reason the coach's
  // persistent-complaint rail outranks today's answer).
  const timeline = readinessTimeline(state, now)
  const reports = timeline.filter((a) => a.at <= now && now - a.at < 72 * HOUR && a.joints !== 'good')
  const recent = reports[reports.length - 1]
  const avoidJoints = [
    ...new Set(reports.flatMap((a) => a.regions ?? []).map((r) => REGION_JOINT[r]).filter((j): j is Joint => Boolean(j))),
  ]
  const pain = reports.some((a) => a.joints === 'pain' && now - a.at < 48 * HOUR)
  if (recent) {
    const where = avoidJoints.length ? avoidJoints.join(' and ') : 'the sore area'
    reasons.push(
      pain
        ? `You reported pain in ${where}: today leaves out anything that loads it and stays light. Never train through pain — if it keeps coming back, tell a parent, coach or physio.`
        : `You mentioned a niggle in ${where}: today steers round it.`,
    )
  }

  // Straight-arm rest rule: hard sessions of one family at least N hours apart.
  // Today's own sessions do not rest today: a planche block done this
  // morning must not turn the rest of today's plan into something else.
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const hard = lastHardStraightArm(
    state.sessions.filter((s) => s.startedAt < startOfToday.getTime()),
    now,
  )
  const restH = prefs.straightArmRestHours
  const blocked = {
    push: hard.push !== undefined && now - hard.push < restH * HOUR,
    pull: hard.pull !== undefined && now - hard.pull < restH * HOUR,
  }
  const skills = (state.profile.skills?.length ? state.profile.skills : ['planche']) as SkillId[]
  const allowed = skills.filter((s) => {
    const f = skillFamily(s)
    return f === 'balance' || !blocked[f]
  })
  for (const family of ['push', 'pull'] as const) {
    if (!blocked[family]) continue
    const hours = Math.round((now - hard[family]!) / HOUR)
    const names = skills.filter((s) => skillFamily(s) === family).map((s) => (s === 'frontlever' ? 'front lever' : s === 'ninety' ? '90° hold' : s))
    if (names.length) reasons.push(`Your last hard ${joinNames(names)} session was ${hours}h ago — under your ${restH}h rest rule for straight-arm work, so ${names.length > 1 ? 'they rest' : 'it rests'} today.`)
  }

  // The split: skills by their weight against the strongest gym goal.
  const g = prefs.goals
  const gymWeight = Math.max(g.strength, g.physique, g.power, g.endurance)
  const wantsSkills = g.skills > 0 && allowed.length > 0
  const wantsGym = gymWeight > 0
  let skillMin = 0
  if (wantsSkills && wantsGym) {
    const share = Math.min(0.75, Math.max(0.25, g.skills / (g.skills + gymWeight)))
    skillMin = Math.round((minutes * share) / 5) * 5
    if (minutes < 35) skillMin = share >= 0.5 ? minutes : 0
    else skillMin = Math.max(15, Math.min(minutes - 20, skillMin))
  } else if (wantsSkills) {
    skillMin = minutes
  }
  const gymMin = minutes - skillMin
  const skillBlock = skillMin > 0 ? { minutes: skillMin, skills: allowed } : undefined
  if (skillBlock && gymMin > 0) reasons.push('Skill work comes first, while you are fresh; the gym follows.')
  if (skillBlock && conservative(state.profile, now) && allowed.some((s) => skillFamily(s) !== 'balance')) {
    reasons.push('Warm wrists, elbows and shoulders up fully before the holds — the session starts with it, so do not skip it.')
  }
  if (!wantsSkills && g.skills > 0 && skills.length) reasons.push('No skill work fits today’s rest rules, so the time goes to the gym.')

  if (gymMin <= 0 || !wantsGym) return { minutes, rest: false, ...(skillBlock ? { skill: skillBlock } : {}), reasons }

  // Which gym focus: under-target muscles, minus what is still tired, minus what today's skills load.
  const weekSets = setsPerMuscle(state.sessions, state.gym?.sessions ?? [], weekStart(now), now)
  const fatigue = fatigueAt(state, now)
  const legActivity = (state.gym?.activities ?? []).filter((a) => a.legs && now - a.at < 48 * HOUR && a.at <= now)
  // A game, practice or sprint session on the calendar in the next day and a
  // half: legs stay fresh for it.
  const upcoming = (state.gym?.activities ?? [])
    .filter((a) => a.legs && a.at > now && a.at - now < 36 * HOUR)
    .sort((a, b) => a.at - b.at)[0]
  const inSeason = prefs.season === 'in'
  const legsCovered = legActivity.length > 0
  const legsOff = LEG_MUSCLES.every((m) => prefs.musclesOff.includes(m))
  const skillFamilies = new Set((skillBlock?.skills ?? []).map(skillFamily))
  // The part of the body left longest: days since each muscle was last hit,
  // capped so a long layoff does not swamp every other rule.
  const lastHit = lastTrainedAt(state, now)
  const daysSince = (m: Muscle) => Math.min(STALE_CAP_DAYS, lastHit[m] === undefined ? STALE_CAP_DAYS : (now - lastHit[m]!) / DAY)
  const staleness = (muscles: Muscle[]) => (muscles.length ? muscles.reduce((sum, m) => sum + daysSince(m), 0) / muscles.length : 0)
  const scores = (['push', 'pull', 'lower', 'upper', 'full'] as GymFocus[]).map((focus) => {
    const muscles = FOCUS_MUSCLES[focus].filter((m) => !prefs.musclesOff.includes(m))
    if (!muscles.length) return { focus, score: -Infinity, muscles }
    const need = muscles.reduce((sum, m) => sum + Math.max(0, volumeTarget(m, prefs)[0] - (weekSets[m] ?? 0)), 0) / muscles.length
    const tired = muscles.reduce((sum, m) => sum + (fatigue.muscles[m] ?? 0), 0) / muscles.length
    let score = need - 1.5 * tired + STALE_WEIGHT * staleness(muscles)
    if ((focus === 'lower' || focus === 'full') && (legsCovered || legsOff || upcoming)) score -= focus === 'lower' ? 1000 : 2
    if (focus === 'push' && (skillFamilies.has('push') || blocked.push)) score -= 4
    if (focus === 'pull' && (skillFamilies.has('pull') || blocked.pull)) score -= 4
    if (focus === 'upper' && (skillFamilies.has('push') || skillFamilies.has('pull'))) score -= 1.5
    if (avoidJoints.includes('wrists') && focus === 'push') score -= 3
    if (avoidJoints.includes('knees') && focus === 'lower') score -= 1000
    return { focus, score, muscles }
  })
  const best = scores.sort((a, b) => b.score - a.score)[0]
  const focus = best.focus
  // Say so when the part of the body left longest is what the day is for.
  const groupStale = (['lower', 'push', 'pull'] as GymFocus[])
    .map((f) => ({ f, days: staleness(FOCUS_MUSCLES[f].filter((m) => !prefs.musclesOff.includes(m))) }))
    .filter((g) => g.days >= 5)
    .sort((a, b) => b.days - a.days)[0]
  if (groupStale && (focus === groupStale.f || (focus === 'full' && groupStale.f === 'lower') || (focus === 'upper' && groupStale.f !== 'lower'))) {
    const name = groupStale.f === 'lower' ? 'Legs' : groupStale.f === 'push' ? 'Chest, shoulders and triceps' : 'Back and biceps'
    const days = Math.round(groupStale.days)
    reasons.push(`${name} ${days >= STALE_CAP_DAYS ? 'have not been trained in two weeks or more' : `were last trained ${days} days ago`} — today’s gym session goes there. Pick a different focus on the Gym side to override it.`)
  }
  if (legsCovered) {
    const a = legActivity[legActivity.length - 1]
    reasons.push(`${a.kind === 'pe' ? 'PE' : a.kind[0].toUpperCase() + a.kind.slice(1)} ${now - a.at < DAY ? 'today or yesterday' : 'in the last two days'} already loaded your legs — no leg work in the gym today.`)
  }
  if (skillFamilies.has('push') && focus !== 'push') {
    reasons.push('Planche-type holds and pressing share the front delts, wrists and elbows, so the gym side avoids heavy pressing today.')
  } else if (skillFamilies.has('pull') && focus !== 'pull') {
    reasons.push('Front lever work and rows or pull-ups share the lats and elbows, so the gym side avoids heavy pulling today.')
  }
  const short = best.muscles
    .map((m) => ({ m, sets: weekSets[m] ?? 0, target: volumeTarget(m, prefs) }))
    .filter((x) => x.target[1] > 0 && x.sets < x.target[0])
    .sort((a, b) => a.sets / a.target[0] - b.sets / b.target[0])
    .slice(0, 2)
  if (short.length) {
    reasons.push(
      `Under this week’s target: ${joinNames(
        short.map((x) => `${MUSCLE_BY_ID[x.m].label.toLowerCase()} (${Math.round(x.sets)} of ${x.target[0]}–${x.target[1]} sets)`),
      )}.`,
    )
  }
  const deload = gymDeloadDue(state, now)
  if (deload.due && deload.why) reasons.push(deload.why)
  if (upcoming) {
    const what = upcoming.kind === 'pe' ? 'PE' : upcoming.kind === 'other' ? 'Your activity' : `Your ${upcoming.kind}`
    reasons.push(`${what} ${upcoming.at - now < 18 * HOUR ? 'is coming up soon' : 'is tomorrow'}: legs stay fresh — no leg work today, and the gym is a little lighter.`)
  }
  if (inSeason) {
    reasons.push('In season: the sport comes first, so the gym keeps the weights but drops some sets.')
  }
  const legMuscles = legsCovered || upcoming ? LEG_MUSCLES : []
  const factor = Math.min(pain ? 0.6 : deload.due ? 0.6 : 1, inSeason ? 0.7 : 1, upcoming ? 0.8 : 1)
  return {
    minutes,
    rest: false,
    ...(skillBlock ? { skill: skillBlock } : {}),
    gym: {
      minutes: gymMin,
      focus,
      avoidJoints,
      volumeFactor: factor,
      deload: deload.due,
      musclesOff: [...new Set([...prefs.musclesOff, ...legMuscles])],
    },
    reasons,
  }
}

export type GoalPace = { status: 'reached' | 'on-pace' | 'possible' | 'behind' | 'unknown'; text: string }

/** Whether a dated skill goal is on pace — or that the app cannot tell yet. */
export function skillGoalPace(state: AppState, goal: SkillGoal, now = Date.now()): GoalPace {
  const target = STEP_BY_ID[goal.stepId]
  if (!target) return { status: 'unknown', text: 'Not a step this app knows.' }
  const view = skillView(state, goal.skill)
  const current = STEP_BY_ID[view.stepId]
  if (!current) return { status: 'unknown', text: 'Not started on this skill yet.' }
  if (view.unlocked.includes(goal.stepId) && current.order > target.order) return { status: 'reached', text: `Reached ${target.name}.` }
  const [y, m, d] = goal.by.split('-').map(Number)
  const weeksLeft = (new Date(y, m - 1, d, 23, 59).getTime() - now) / WEEK
  if (weeksLeft <= 0) return { status: 'behind', text: `The date has passed — set a new one.` }
  let range: { low: number; high: number | null } | null = null
  let why = ''
  if (current.id === target.id) {
    const f = forecastUnlock(view, target.id, now)
    if (f.kind === 'ready') return { status: 'on-pace', text: `Your holds already clear ${target.name}'s bar — time to test it.` }
    if (f.kind === 'range') range = { low: f.lowWeeks, high: f.highWeeks }
    else why = 'need' in f ? String(f.need) : 'the recent holds are not trending up'
  } else if (current.order < target.order) {
    const o = goalOutlook({ ...view, profile: { ...view.profile, goalStepId: target.id } }, now)
    if (o.estimate) range = { low: o.estimate.lowWeeks, high: o.estimate.highWeeks }
    else why = o.note
  }
  if (!range) return { status: 'unknown', text: `Can't tell yet whether ${Math.ceil(weeksLeft)} weeks is enough: ${why || 'not enough history'}.` }
  if (range.high !== null && range.high <= weeksLeft) return { status: 'on-pace', text: `On pace: about ${range.low}–${range.high} weeks at your current rate, ${Math.floor(weeksLeft)} left.` }
  if (range.low > weeksLeft) return { status: 'behind', text: `Behind: about ${range.low}${range.high !== null ? `–${range.high}` : '+'} weeks at your current rate, ${Math.floor(weeksLeft)} left.` }
  return { status: 'possible', text: `Possible: ${range.low}${range.high !== null ? `–${range.high}` : '+'} weeks at your current rate, ${Math.floor(weeksLeft)} left.` }
}

export interface WeekDayPlan {
  /** Local calendar day, YYYY-MM-DD. */
  day: string
  at: number
  plan: TodayPlan
}

const PREVIEW_SKILL_EXERCISE: Partial<Record<'push' | 'pull', string>> = { push: 'tuck-planche', pull: 'tuck-front-lever' }
const PREVIEW_GYM_EXERCISES: Record<GymFocus, string[]> = {
  push: ['db-bench-press', 'db-shoulder-press'],
  pull: ['lat-pulldown', 'db-row'],
  lower: ['goblet-squat', 'romanian-deadlift'],
  upper: ['db-bench-press', 'db-row'],
  full: ['goblet-squat', 'db-bench-press', 'db-row'],
}

/**
 * The next seven days, each planned as if the days before it went as planned:
 * a preview of how the rest rules and the push / pull / legs rotation play
 * out. Only a preview — every real day is planned again from what actually
 * happened.
 */
export function planWeek(state: AppState, now = Date.now()): WeekDayPlan[] {
  const out: WeekDayPlan[] = []
  let s: AppState = state
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  for (let d = 0; d < 7; d++) {
    const day = new Date(startOfToday)
    day.setDate(day.getDate() + d)
    const at = d === 0 ? now : day.getTime() + 17 * HOUR
    const plan = planToday(s, { now: at })
    out.push({ day: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`, at, plan })
    if (plan.rest) continue
    // Pretend the day happened, so tomorrow is planned around it.
    const families = new Set((plan.skill?.skills ?? []).map(skillFamily))
    const skillSets = [...families].flatMap((f) => {
      const id = f === 'balance' ? undefined : PREVIEW_SKILL_EXERCISE[f]
      return id ? Array.from({ length: 3 }, () => ({ exerciseId: id, kind: 'hold' as const, value: 8, target: 8, section: 'main' as const, at })) : []
    })
    const sessions = skillSets.length
      ? [
          ...s.sessions,
          { id: `preview-${at}`, startedAt: at, endedAt: at + HOUR, workoutName: 'Preview', workoutKind: 'skill' as AppState['sessions'][number]['workoutKind'], stepId: s.stepId, sets: skillSets },
        ]
      : s.sessions
    const gymSessions = plan.gym && s.gym
      ? [
          ...s.gym.sessions,
          {
            id: `preview-gym-${at}`,
            locationId: s.gym.activeLocationId ?? 'home',
            startedAt: at + HOUR,
            endedAt: at + 2 * HOUR,
            name: plan.gym.focus,
            exercises: PREVIEW_GYM_EXERCISES[plan.gym.focus].map((exerciseId) => ({
              exerciseId,
              sets: Array.from({ length: 3 }, () => ({ kg: 20, reps: 8, rpe: 8, at: at + HOUR })),
            })),
          },
        ]
      : s.gym?.sessions
    s = { ...s, sessions, ...(s.gym ? { gym: { ...s.gym, sessions: gymSessions ?? [] } } : {}) }
  }
  return out
}
