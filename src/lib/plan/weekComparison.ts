import { skillOfExercise } from '../../data/skills'
import type { Muscle } from '../../data/gym/catalog'
import type { AppState, SkillId } from '../../types'
import type { GymFocus } from '../gym/focus'
import { setWeekdayFocus } from '../gym/state'
import { activeSkills } from '../skills'
import { addDays, dayKey, weekStart } from '../time'
import { weekForChoice } from './currentWeek'
import { volumeTarget } from './load'
import { FOCUS_MUSCLES, OPENER_MINUTES } from './planner'
import type { TodayChoice } from './todayChoice'
import { dayStage, remainingLifts, type GymPreset } from './screens'
import { peekNextBlock } from './nextBlock'

export interface WeekOption {
  gymDate?: string
  split?: { day: string; focus: GymFocus }
  muscleSets: Partial<Record<Muscle, number>>
  practiceDays: Partial<Record<SkillId, number>>
  remainingSkillSets: Partial<Record<SkillId, number>>
  remainingRepSets: Partial<Record<SkillId, number>>
  remainingSkillMinutes: number
  remainingLiftMinutes: number
  gymDays: number
  liftingVisits: { day: string; place?: string; focus?: GymFocus; minutes: number }[]
}

/** Price a one-day change with the coach that will actually build it. Every candidate uses the same goals, days and minutes. */
export function compareLiftingDays(state: AppState, choice: TodayChoice, now: number) {
  const gym = state.gym
  const prefs = gym?.prefs
  if (!gym || !prefs || !prefs.goals.skills) return undefined
  const muscles = prefs.musclesPriority.filter((m) => !prefs.musclesOff.includes(m))
  if (!muscles.length) return undefined
  const skills = activeSkills(state)
  const start = weekStart(now)
  const end = addDays(start, 7)
  const logged = state.sessions.filter((s) => s.startedAt >= start && s.startedAt <= now && s.workoutKind !== 'micro')
  const gymLog = gym.sessions.filter((s) => s.startedAt >= start && s.startedAt <= now)
  const done = new Set([...gymLog, ...logged.filter((s) => s.completion !== 'partial')].map((s) => dayKey(s.startedAt)))
  const skillLogged = new Set(state.sessions.filter((s) => s.startedAt >= start && s.startedAt <= now).map((s) => dayKey(s.startedAt)))
  const practiced = (skill: SkillId) => logged.filter((s) => s.sets.some((set) =>
    set.section === 'main' && set.value > 0 && skillOfExercise(set.exerciseId) === skill)).map((s) => dayKey(s.startedAt))
  const snapshot = (gymDate?: string, shortSkillOpeners = prefs.shortSkillOpeners, split?: WeekOption['split']): WeekOption => {
    const configured = split ? setWeekdayFocus(prefs, new Date(split.day + 'T12:00').getDay(), split.focus) : prefs
    const athlete = !split && gymDate === prefs.extraGymDate && shortSkillOpeners === prefs.shortSkillOpeners ? state :
      { ...state, gym: { ...gym, prefs: { ...configured, extraGymDate: gymDate, shortSkillOpeners } } }
    const week = weekForChoice(athlete, choice, now)
    const days = week.days.filter((d) => d.at < end && !d.plan.rest)
    const practiceDays: WeekOption['practiceDays'] = {}
    const remainingSkillSets: WeekOption['remainingSkillSets'] = {}
    const remainingRepSets: WeekOption['remainingRepSets'] = {}
    for (const skill of skills) {
      const dates = new Set(practiced(skill))
      for (const d of days) {
        const trained = done.has(d.day)
        if (!trained && !d.plan.skill?.painSafe && d.plan.skill?.skills.includes(skill)) dates.add(d.day)
        if (!trained && !d.plan.skill?.painSafe && !skillLogged.has(d.day)) {
          remainingSkillSets[skill] = (remainingSkillSets[skill] ?? 0) + (d.skillWorkingSets?.[skill] ?? 0)
          if (d.repSets?.[skill] !== undefined) remainingRepSets[skill] = (remainingRepSets[skill] ?? 0) + d.repSets[skill]!
        }
      }
      practiceDays[skill] = dates.size
    }
    const today = dayKey(now)
    const remainingSkillMinutes = days.reduce((sum, d) => sum + (!done.has(d.day) && !skillLogged.has(d.day) ? d.plan.skill?.minutes ?? 0 : 0), 0)
    const liftingVisits = week.days.filter((d) => d.at < end).flatMap((d) => {
      const stage = d.day === today ? dayStage(state, d.plan, now) : undefined
      if (stage === 'done' || stage === 'skill-partial' || (stage !== 'lifts-next' && trained.has(d.day))) return []
      const block = stage === 'lifts-next' ? remainingLifts(d.plan, peekNextBlock<GymPreset>(now), choice.placeId) : d.plan.gym
      return block ? [{ day: d.day, place: gym.locations.find((place) => place.id === block.placeId)?.name, focus: block.focus, minutes: block.minutes }] : []
    })
    const gymDays = new Set([...gymLog.map((s) => dayKey(s.startedAt)), ...liftingVisits.map((d) => d.day)]).size
    const selected = gymDate && days.some((d) => d.day === gymDate && d.plan.gym) ? gymDate : undefined
    const usedSplit = split && days.some((d) => d.day === split.day && d.plan.gym?.focus === split.focus) ? split : undefined
    return { gymDate: selected, split: usedSplit, muscleSets: week.weekTotal, practiceDays, remainingSkillSets, remainingRepSets, gymDays, liftingVisits,
      remainingSkillMinutes, remainingLiftMinutes: liftingVisits.reduce((sum, d) => sum + d.minutes, 0) }
  }
  const trained = new Set([...logged, ...gymLog].map((s) => dayKey(s.startedAt)))
  const current = snapshot(prefs.extraGymDate)
  const funded = (option: WeekOption) => muscles.reduce((n, m) => n + Math.min(option.muscleSets[m] ?? 0, volumeTarget(m, prefs)[0]), 0)
  const retained = (option: WeekOption) => skills.filter((s) => (current.practiceDays[s] ?? 0) > 0 && (option.practiceDays[s] ?? 0) > 0).length
  const lostWork = (option: WeekOption) => skills.reduce((n, s) => n +
    Math.max(0, (current.remainingSkillSets[s] ?? 0) - (option.remainingSkillSets[s] ?? 0)) +
    Math.max(0, (current.remainingRepSets[s] ?? 0) - (option.remainingRepSets[s] ?? 0)), 0)
  // A different place on the same number of visits can train a priority better
  // while preserving every chosen muscle, practice day and progression set.
  const improvesAtSameFrequency = (o: WeekOption) => o.gymDays === current.gymDays && !lostWork(o) &&
    skills.every((s) => (o.practiceDays[s] ?? 0) >= (current.practiceDays[s] ?? 0)) &&
    muscles.every((m) => (o.muscleSets[m] ?? 0) >= (current.muscleSets[m] ?? 0))
  const remaining = weekForChoice(state, choice, now).days.filter((d) => d.at < end && !trained.has(d.day) && !d.plan.skill?.painSafe)
  const candidates = remaining.filter((d) => d.kind === 'calisthenics')
  const options = candidates.map((d) => snapshot(d.day))
    .filter((o) => o.gymDate && (o.gymDays > current.gymDays || improvesAtSameFrequency(o)) && funded(o) > funded(current) &&
      (!current.practiceDays[skills[0]] || o.practiceDays[skills[0]]))
    .sort((a, b) => retained(b) - retained(a) || lostWork(a) - lostWork(b) || funded(b) - funded(a))
  const shorter = !prefs.shortSkillOpeners && remaining.some((d) => d.plan.gym && d.plan.skill?.opener && d.plan.skill.minutes > OPENER_MINUTES)
    ? snapshot(prefs.extraGymDate, true) : undefined
  const compact = shorter && funded(shorter) > funded(current) &&
    skills.every((s) => (shorter.practiceDays[s] ?? 0) >= (current.practiceDays[s] ?? 0)) ? shorter : undefined
  const behind = muscles.filter((m) => (current.muscleSets[m] ?? 0) < volumeTarget(m, prefs)[0])
  const lower = behind.some((m) => FOCUS_MUSCLES.lower.includes(m))
  const upper = behind.some((m) => FOCUS_MUSCLES.upper.includes(m) || FOCUS_MUSCLES.push.includes(m) || FOCUS_MUSCLES.pull.includes(m))
  const foci: GymFocus[] = lower && upper ? ['full', 'lower', 'upper'] : lower ? ['lower', 'full'] : upper ? ['upper', 'full'] : []
  const visits = remaining.filter((d) => d.plan.gym && !prefs.focusByDay?.[new Date(d.at).getDay()] &&
    (d.day !== dayKey(now) || !choice.gymFocus))
  // Price a few alternatives on demand. Never replace a saved weekday focus.
  const trials = foci.flatMap((focus) => visits.filter((v) => v.plan.gym?.focus !== focus).map((v) => ({ day: v.day, focus }))).slice(0, 4)
  const repeats = (o: WeekOption) => o.liftingVisits.filter((v, i, list) => i && v.focus && v.focus !== 'full' && list[i - 1].focus === v.focus).length
  const split = trials.map((s) => snapshot(prefs.extraGymDate, prefs.shortSkillOpeners, s))
    .filter((o) => o.split && o.gymDays === current.gymDays && repeats(o) <= repeats(current) && funded(o) >= funded(current) + 1 &&
      skills.every((s) => (o.practiceDays[s] ?? 0) >= (current.practiceDays[s] ?? 0) &&
        (o.remainingRepSets[s] ?? 0) >= Math.min(1, current.remainingRepSets[s] ?? 0)) &&
      muscles.every((m) => (o.muscleSets[m] ?? 0) >= Math.min(current.muscleSets[m] ?? 0, volumeTarget(m, prefs)[0])))
    .sort((a, b) => lostWork(a) - lostWork(b) || funded(b) - funded(a))[0] as WeekOption | undefined
  return { current, alternative: options[0] as WeekOption | undefined, compact, split, skills, muscles }
}
