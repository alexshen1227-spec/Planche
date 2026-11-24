import type { AppState, SkillId } from '../../types'
import type { Muscle } from '../../data/gym/catalog'
import { availableAt } from '../gym/availability'
import { addDays, dayKey, weekStart } from '../time'
import { volumeTarget } from './load'
import type { WeekAhead } from './planner'

/** A skill-heavy week can already exceed one chosen muscle's band while leaving
 * another below it. Price a shared visit and keep it only when its actual lifts
 * improve that week and each skill keeps up to two real practices. */
export function fitPriorityLegs(state: AppState, week: WeekAhead, now: number, build: (day: string, skill: SkillId) => WeekAhead): WeekAhead {
  const prefs = state.gym?.prefs
  const skills = state.profile.skills ?? []
  if (!prefs || skills.length < 2 || prefs.goals.physique < Math.max(3, prefs.goals.skills) ||
    (prefs.extraGymDate && prefs.extraGymDate >= dayKey(now))) return week
  const priority = prefs.musclesPriority.filter((m) => !prefs.musclesOff.includes(m))
  const below = priority.filter((m) => ['quads', 'hamstrings', 'glutes', 'calves'].includes(m) && (week.weekTotal[m] ?? 0) + 2 <= volumeTarget(m, prefs)[0])
  const above = priority.filter((m) => (week.weekSources.skill[m] ?? 0) > 0 && (week.weekTotal[m] ?? 0) > volumeTarget(m, prefs)[1])
  const bothBehind = below.some((m) => (week.weekTotal[m] ?? 0) < volumeTarget(m, prefs)[0] / 2) &&
    priority.some((m) => !below.includes(m) && (week.weekTotal[m] ?? 0) < volumeTarget(m, prefs)[0] * 0.75)
  if (!below.length || (!above.length && !bothBehind)) return week
  const end = addDays(weekStart(now), 7)
  const days = (w: WeekAhead) => w.days.filter((d) => d.at < end && !d.plan.rest)
  const practice = (w: WeekAhead, skill: SkillId) => days(w).filter((d) => d.skillWorkingSets?.[skill]).length
  const trained = new Set([...state.sessions, ...state.gym!.sessions].filter((s) => s.startedAt <= now).map((s) => dayKey(s.startedAt)))
  const need = (w: WeekAhead) => below.reduce((n, m) => n + Math.max(0, volumeTarget(m, prefs)[0] - (w.weekTotal[m] ?? 0)), 0)
  const excess = (w: WeekAhead) => above.reduce((n, m) => n + Math.max(0, (w.weekTotal[m] ?? 0) - volumeTarget(m, prefs)[1]), 0)
  const options = days(week).filter((d) => d.kind === 'calisthenics' && (d.plan.skill?.skills.length ?? 0) >= (bothBehind ? 1 : 2) &&
    !d.plan.skill?.painSafe && !trained.has(d.day)).reverse()
  for (const day of options) {
    const [skill] = [...day.plan.skill!.skills].sort((a, b) => practice(week, a) - practice(week, b))
    const option = build(day.day, skill)
    if (need(option) + 2 > need(week) || (above.length && excess(option) >= excess(week)) ||
      skills.some((s) => practice(option, s) < Math.min(2, practice(week, s)))) continue
    if (!above.length && skills.some((s) => {
      const dose = (w: WeekAhead) => days(w).reduce((n, d) => n + (d.skillWorkingSets?.[s] ?? 0), 0)
      return dose(option) < dose(week) * 0.75
    })) continue
    if (priority.some((m) => (option.weekTotal[m] ?? 0) < Math.min(week.weekTotal[m] ?? 0, volumeTarget(m, prefs)[0]))) continue
    return option
  }
  return week
}

/** Compare real schedules at the athlete's assigned places while keeping each practice dose and the weekly frequency. */
export function fitLiftingPlace(state: AppState, week: WeekAhead, now: number, build: (day: string) => WeekAhead): WeekAhead {
  const gym = state.gym
  const prefs = gym?.prefs
  if (!gym || !prefs?.goals.skills || !prefs.goals.physique || !prefs.placeByDay || prefs.extraGymDate && prefs.extraGymDate >= dayKey(now)) return week
  const priority = prefs.musclesPriority.filter((m) => !prefs.musclesOff.includes(m))
  if (!priority.length || new Set(prefs.placeByDay.filter(Boolean)).size < 2) return week
  const end = addDays(weekStart(now), 7)
  const remaining = (w: WeekAhead) => w.days.filter((d) => d.at < end && !d.plan.rest)
  const days = remaining(week)
  const lifts = days.filter((d) => d.plan.gym)
  if (!lifts.length) return week
  const completed = new Set([...state.sessions, ...gym.sessions].filter((s) => s.startedAt <= now).map((s) => dayKey(s.startedAt)))
  const variety = new Map(gym.locations.map((place) => [place.id,
    new Set(availableAt(place).filter((e) => !e.explosive && e.primary.some((m) => priority.includes(m)) &&
      gym.ratings[e.id] !== 'avoid').map((e) => e.pattern + '/' + e.load)).size]))
  const choices = days.filter((d) => {
    const place = prefs.placeByDay?.[new Date(d.at).getDay()]
    return place && d.kind === 'calisthenics' && !d.plan.skill?.painSafe && !completed.has(d.day) &&
      lifts.some((other) => other.plan.gym?.placeId && (variety.get(other.plan.gym.placeId) ?? 0) < (variety.get(place) ?? 0))
  })
  const dose = (w: WeekAhead, skill: SkillId) => remaining(w).map((d) => d.skillWorkingSets?.[skill] ?? 0)
  const cap = (w: WeekAhead, m: Muscle) => Math.min(w.weekTotal[m] ?? 0, volumeTarget(m, prefs)[0])
  const score = (w: WeekAhead) => priority.reduce((n, m) => n + cap(w, m), 0)
  const equipmentCoverage = (w: WeekAhead) => remaining(w).reduce((n, d) => n + (variety.get(d.plan.gym?.placeId ?? '') ?? 0), 0)
  let best = week
  for (const day of choices) {
    const option = build(day.day)
    const next = remaining(option)
    if (!next.some((d) => d.day === day.day && d.plan.gym) || next.filter((d) => d.plan.gym).length !== lifts.length ||
        score(option) < score(best) || (score(option) === score(best) && equipmentCoverage(option) <= equipmentCoverage(best)) ||
        priority.some((m) => cap(option, m) < cap(week, m) ||
          (option.weekSources.direct[m] ?? 0) < (week.weekSources.direct[m] ?? 0))) continue
    // A gain for a chosen muscle cannot remove the week's basic push, pull, knee or hip work.
    if ((['chest', 'lats', 'quads', 'hamstrings'] as const).some((m) =>
      (option.weekTotal[m] ?? 0) < Math.min(4, week.weekTotal[m] ?? 0))) continue
    const skills = state.profile.skills?.length ? state.profile.skills : ['planche'] as const
    const lostPractice = skills.some((s) => {
      const before = dose(week, s), after = dose(option, s)
      return after.filter(Boolean).length < before.filter(Boolean).length ||
        after.reduce((n, sets) => n + sets, 0) < before.reduce((n, sets) => n + sets, 0)
    })
    if (!lostPractice && next.filter((d) => d.plan.gym?.focus === 'athletic').length >= lifts.filter((d) => d.plan.gym?.focus === 'athletic').length) best = option
  }
  return best
}
