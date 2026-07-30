import type { AppState, PR, Session, SessionEvents, StepId, TrainingSurface } from '../types'
import { ACHIEVEMENTS } from '../data/achievements'
import { STEP_BY_ID, stepAfter } from '../data/progressions'
import { isQualifyingSet, qualifyingProgress } from './progression'

/**
 * Pure state transition for saving a session: updates history and PRs,
 * advances the progression when an unlock bar is cleared, and evaluates
 * achievements. Returns the noteworthy events so the UI can celebrate.
 */
export function applySession(state: AppState, session: Session): { next: AppState; events: SessionEvents } {
  const events: SessionEvents = { prs: [], achievements: [] }

  const prs = { ...state.prs }
  const bestInSession: Record<
    string,
    { overall: number; bySurface: Partial<Record<TrainingSurface, number>> }
  > = {}
  for (const set of session.sets) {
    if (set.value <= 0) continue
    const best = (bestInSession[set.exerciseId] ??= { overall: 0, bySurface: {} })
    if (set.value > best.overall) best.overall = set.value
    if (set.surface && set.value > (best.bySurface[set.surface] ?? 0)) {
      best.bySurface[set.surface] = set.value
    }
  }
  for (const [exId, best] of Object.entries(bestInSession)) {
    const current = prs[exId]
    const nextPr: PR =
      current && current.value >= best.overall
        ? { ...current, bySurface: { ...current.bySurface } }
        : { value: best.overall, at: session.endedAt, bySurface: { ...current?.bySurface } }
    const overallImproved = current === undefined || best.overall > current.value
    let surfacedEvent = false

    for (const surface of ['floor', 'parallettes'] as const) {
      const value = best.bySurface[surface]
      if (value === undefined) continue
      const previous = current?.bySurface?.[surface]?.value
      if (previous === undefined || value > previous) {
        nextPr.bySurface![surface] = { value, at: session.endedAt }
        events.prs.push({ exerciseId: exId, value, previous, surface })
        surfacedEvent = true
      }
    }
    if (nextPr.bySurface && Object.keys(nextPr.bySurface).length === 0) delete nextPr.bySurface
    prs[exId] = nextPr
    // Old logs and non-planche exercises have no surface. Preserve the
    // existing event behavior for them; surface-tagged records get one clear
    // floor/parallettes celebration instead of a duplicate overall one.
    if (overallImproved && !surfacedEvent) {
      events.prs.push({ exerciseId: exId, value: best.overall, previous: current?.value })
    }
  }

  let next: AppState = { ...state, prs, sessions: [...state.sessions, session] }

  // Advance only from a clean main-work hold backed by both an explicit
  // athlete rating and a passing filmed form review. PRs remain an honest
  // record of best effort, but a weak-evidence/accessory/one-sided number is
  // not mastery.
  const unlocked = [...state.unlocked]
  let stepId: StepId = state.stepId
  let unlockedStep: StepId | undefined
  for (let guard = 0; guard < 10; guard++) {
    const cur = STEP_BY_ID[stepId]
    const following = stepAfter(stepId)
    if (!following) break
    // Saving unrelated work must not snap an athlete back up after they
    // deliberately selected a lower unlocked step.
    if (
      session.workoutName === 'Quick Log' ||
      !session.sets.some((set) => isQualifyingSet(set, cur.keyExerciseId))
    ) {
      break
    }
    const qualified = qualifyingProgress(state, stepId, [session])
    if (qualified.value < cur.unlockSec) break
    if (!unlocked.includes(following.id)) unlocked.push(following.id)
    stepId = following.id
    unlockedStep = following.id
  }
  next = { ...next, unlocked, stepId }

  const achievements = { ...state.achievements }
  for (const a of ACHIEVEMENTS) {
    if (achievements[a.id]) continue
    if (a.check(next, session)) {
      achievements[a.id] = session.endedAt
      events.achievements.push(a.id)
    }
  }
  next = { ...next, achievements }
  if (unlockedStep) events.unlockedStep = unlockedStep
  return { next, events }
}
