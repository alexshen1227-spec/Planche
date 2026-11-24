import type { AppState, CheckIn, Workout, WorkoutRequest } from '../types'
import { estimateMinutes, finalizeWorkoutWithPlan, hasEquipmentFor, isPainSafe, restrictTemplate } from '../data/workouts'
import { kitAt } from './plan/planner'
import { readTodayChoice } from './plan/todayChoice'
import { latestSkillPartial, skillPlanVersion } from './skillSession'

/** Start, or recheck, the actual remaining rounds using the equipment and readiness available now. */
export function resumeSkillWorkout(state: AppState, id: string, checkIn?: CheckIn, now = Date.now()) {
  const session = latestSkillPartial(state.sessions, now)
  const left = session?.remaining
  if (!left || !session || session.id !== id) return undefined
  const placeId = readTodayChoice(now).placeId ?? left.placeId ?? state.gym?.activeLocationId
  const location = state.gym?.locations.find((place) => place.id === placeId)
  const here = location ? kitAt(state, location) : state.profile.equipment
  const kit = location?.id === 'home' ? [...new Set([...state.profile.equipment, ...here])] : here
  const request: WorkoutRequest = { source: session.workoutKind, resumeSessionId: id, skills: left.skills,
    kit, ...(location ? { placeId: location.id } : {}), ...(left.focus ? { focus: left.focus } : {}) }
  const current = finalizeWorkoutWithPlan(state, request, checkIn, now)
  const restrictedTest = session.workoutKind === 'test' && current.workout.kind !== 'test'
  const recovery = isPainSafe(current.workout)
  if ((recovery && !left.recovery) || restrictedTest) {
    const workout = { ...current.workout, request, adjustments: [...(current.workout.adjustments ?? []),
      'Your saved session stays in history. Today’s check-in calls for a separate, lighter workout.'] }
    return { workout, plan: current.plan }
  }
  const allowed = (b: Workout['blocks'][number]) => hasEquipmentFor(b.exerciseId, kit) &&
    (!recovery || current.workout.blocks.some((safe) => safe.exerciseId === b.exerciseId && safe.section === b.section))
  const blocks = left.blocks.filter(allowed)
  if (!blocks.some((b) => b.section !== 'warmup' && b.section !== 'cooldown')) return undefined
  const deferred = left.blocks.filter((b) => !allowed(b))
  const preset = { ...request, ...(left.gymAfter ? { gymAfter: left.gymAfter } : {}) }
  const minutes = estimateMinutes(blocks, state.settings.stopLatencySec, state.settings.phoneWithinReach)
  const saved: Workout = { id: (left.recovery ? 'pain-safe-recovery-continue-' : 'continue-') + id, name: session.workoutName, kind: session.workoutKind,
    focus: 'Continue the rounds left in your saved workout.', minutes, blocks, request: preset,
    skills: left.skills, lineup: left.lineup, strategy: session.strategy, baseTargetSec: session.baseTargetSec,
    continuation: { id, endedAt: session.endedAt, version: skillPlanVersion(session) }, ...(deferred.length ? { deferredBlocks: deferred } : {}) }
  const workout = recovery ? saved : restrictTemplate(saved, current.plan)
  const adjustments = ['Your earlier sets are saved. These rounds continue the same session.']
  if (deferred.length) adjustments.push('Rounds that need different equipment or load an area you are resting stay in your saved workout.')
  return { workout: { ...workout, adjustments }, plan: current.plan }
}
