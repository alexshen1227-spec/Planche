import { skillOfExercise } from '../../data/skills'
import type { Muscle } from '../../data/gym/catalog'
import type { AppState, SkillId } from '../../types'
import { activeSkills } from '../skills'
import { addDays, dayKey, weekStart } from '../time'
import { weekForChoice } from './currentWeek'
import { volumeTarget } from './load'
import type { TodayChoice } from './todayChoice'

export interface WeekOption {
  gymDate?: string
  muscleSets: Partial<Record<Muscle, number>>
  practiceDays: Partial<Record<SkillId, number>>
  gymDays: number
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
  const practiced = (skill: SkillId) => logged.filter((s) => s.sets.some((set) =>
    set.section === 'main' && set.value > 0 && skillOfExercise(set.exerciseId) === skill)).map((s) => dayKey(s.startedAt))
  const snapshot = (gymDate?: string): WeekOption => {
    const athlete = gymDate === prefs.extraGymDate ? state : { ...state, gym: { ...gym, prefs: { ...prefs, extraGymDate: gymDate } } }
    const week = weekForChoice(athlete, choice, now)
    const days = week.days.filter((d) => d.at < end && !d.plan.rest)
    const practiceDays: WeekOption['practiceDays'] = {}
    for (const skill of skills) {
      const dates = new Set(practiced(skill))
      for (const d of days) {
        const trained = gymLog.some((s) => dayKey(s.startedAt) === d.day) || logged.some((s) => dayKey(s.startedAt) === d.day && s.completion !== 'partial')
        if (!trained && !d.plan.skill?.painSafe && d.plan.skill?.skills.includes(skill)) dates.add(d.day)
      }
      practiceDays[skill] = dates.size
    }
    const gymDays = new Set([...gymLog.map((s) => dayKey(s.startedAt)), ...days.filter((d) => d.plan.gym).map((d) => d.day)]).size
    const selected = gymDate && days.some((d) => d.day === gymDate && d.plan.gym) ? gymDate : undefined
    return { gymDate: selected, muscleSets: week.weekTotal, practiceDays, gymDays }
  }
  const current = snapshot(prefs.extraGymDate)
  const funded = (option: WeekOption) => muscles.reduce((n, m) => n + Math.min(option.muscleSets[m] ?? 0, volumeTarget(m, prefs)[0]), 0)
  const retained = (option: WeekOption) => skills.filter((s) => (current.practiceDays[s] ?? 0) > 0 && (option.practiceDays[s] ?? 0) > 0).length
  const trained = new Set([...logged, ...gymLog].map((s) => dayKey(s.startedAt)))
  const candidates = weekForChoice(state, choice, now).days.filter((day) =>
    day.at < end && !trained.has(day.day) && day.kind === 'calisthenics' && !day.plan.skill?.painSafe)
  const options = candidates.map((d) => snapshot(d.day))
    .filter((o) => o.gymDate && o.gymDays > current.gymDays && funded(o) > funded(current) && (!current.practiceDays[skills[0]] || o.practiceDays[skills[0]]))
    .sort((a, b) => retained(b) - retained(a) || funded(b) - funded(a))
  return { current, alternative: options[0] as WeekOption | undefined, skills, muscles }
}
