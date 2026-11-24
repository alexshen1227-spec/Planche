import { skillOfExercise } from '../../data/skills'
import type { Muscle } from '../../data/gym/catalog'
import type { AppState, SkillId } from '../../types'
import { activeSkills } from '../skills'
import { addDays, dayKey, weekStart } from '../time'
import { weekForChoice } from './currentWeek'
import { volumeTarget } from './load'
import { OPENER_MINUTES } from './planner'
import type { TodayChoice } from './todayChoice'
import { dayStage, remainingLifts, type GymPreset } from './screens'
import { peekNextBlock } from './nextBlock'

export interface WeekOption {
  gymDate?: string
  muscleSets: Partial<Record<Muscle, number>>
  practiceDays: Partial<Record<SkillId, number>>
  remainingSkillSets: Partial<Record<SkillId, number>>
  gymDays: number
  liftingVisits: { day: string; place?: string }[]
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
  const snapshot = (gymDate?: string, shortSkillOpeners = prefs.shortSkillOpeners): WeekOption => {
    const athlete = gymDate === prefs.extraGymDate && shortSkillOpeners === prefs.shortSkillOpeners ? state :
      { ...state, gym: { ...gym, prefs: { ...prefs, extraGymDate: gymDate, shortSkillOpeners } } }
    const week = weekForChoice(athlete, choice, now)
    const days = week.days.filter((d) => d.at < end && !d.plan.rest)
    const practiceDays: WeekOption['practiceDays'] = {}
    const remainingSkillSets: WeekOption['remainingSkillSets'] = {}
    for (const skill of skills) {
      const dates = new Set(practiced(skill))
      for (const d of days) {
        const trained = done.has(d.day)
        if (!trained && !d.plan.skill?.painSafe && d.plan.skill?.skills.includes(skill)) dates.add(d.day)
        if (!trained && !d.plan.skill?.painSafe && !skillLogged.has(d.day)) {
          remainingSkillSets[skill] = (remainingSkillSets[skill] ?? 0) + (d.skillWorkingSets?.[skill] ?? 0)
        }
      }
      practiceDays[skill] = dates.size
    }
    const today = dayKey(now)
    const liftingVisits = week.days.filter((d) => d.at < end).flatMap((d) => {
      const stage = d.day === today ? dayStage(state, d.plan, now) : undefined
      if (stage === 'done' || stage === 'skill-partial' || (stage !== 'lifts-next' && trained.has(d.day))) return []
      const block = stage === 'lifts-next' ? remainingLifts(d.plan, peekNextBlock<GymPreset>(now), choice.placeId) : d.plan.gym
      return block ? [{ day: d.day, place: gym.locations.find((place) => place.id === block.placeId)?.name }] : []
    })
    const gymDays = new Set([...gymLog.map((s) => dayKey(s.startedAt)), ...liftingVisits.map((d) => d.day)]).size
    const selected = gymDate && days.some((d) => d.day === gymDate && d.plan.gym) ? gymDate : undefined
    return { gymDate: selected, muscleSets: week.weekTotal, practiceDays, remainingSkillSets, gymDays, liftingVisits }
  }
  const trained = new Set([...logged, ...gymLog].map((s) => dayKey(s.startedAt)))
  const current = snapshot(prefs.extraGymDate)
  const funded = (option: WeekOption) => muscles.reduce((n, m) => n + Math.min(option.muscleSets[m] ?? 0, volumeTarget(m, prefs)[0]), 0)
  const retained = (option: WeekOption) => skills.filter((s) => (current.practiceDays[s] ?? 0) > 0 && (option.practiceDays[s] ?? 0) > 0).length
  const lostWork = (option: WeekOption) => skills.reduce((n, s) => n + Math.max(0, (current.remainingSkillSets[s] ?? 0) - (option.remainingSkillSets[s] ?? 0)), 0)
  // A different place on the same number of visits can train a priority better
  // while preserving every chosen muscle, practice day and progression set.
  const improvesAtSameFrequency = (o: WeekOption) => o.gymDays === current.gymDays && !lostWork(o) &&
    skills.every((s) => (o.practiceDays[s] ?? 0) >= (current.practiceDays[s] ?? 0)) &&
    muscles.every((m) => (o.muscleSets[m] ?? 0) >= (current.muscleSets[m] ?? 0))
  const candidates = weekForChoice(state, choice, now).days.filter((day) =>
    day.at < end && !trained.has(day.day) && day.kind === 'calisthenics' && !day.plan.skill?.painSafe)
  const options = candidates.map((d) => snapshot(d.day))
    .filter((o) => o.gymDate && (o.gymDays > current.gymDays || improvesAtSameFrequency(o)) && funded(o) > funded(current) &&
      (!current.practiceDays[skills[0]] || o.practiceDays[skills[0]]))
    .sort((a, b) => retained(b) - retained(a) || lostWork(a) - lostWork(b) || funded(b) - funded(a))
  const shorter = !prefs.shortSkillOpeners && weekForChoice(state, choice, now).days.some((d) =>
    d.at < end && !trained.has(d.day) && d.plan.gym && d.plan.skill?.opener && d.plan.skill.minutes > OPENER_MINUTES)
    ? snapshot(prefs.extraGymDate, true) : undefined
  const compact = shorter && funded(shorter) >= funded(current) + 1 &&
    skills.every((s) => (shorter.practiceDays[s] ?? 0) >= (current.practiceDays[s] ?? 0)) ? shorter : undefined
  return { current, alternative: options[0] as WeekOption | undefined, compact, skills, muscles }
}
