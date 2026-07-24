import type { AppState, Session, SessionEvents, StepId } from '../types'
import { ACHIEVEMENTS } from '../data/achievements'
import { STEP_BY_ID, stepAfter } from '../data/progressions'

/**
 * Pure state transition for saving a session: updates history and PRs,
 * advances the progression when an unlock bar is cleared, and evaluates
 * achievements. Returns the noteworthy events so the UI can celebrate.
 */
export function applySession(state: AppState, session: Session): { next: AppState; events: SessionEvents } {
  const events: SessionEvents = { prs: [], achievements: [] }

  const prs = { ...state.prs }
  const bestInSession: Record<string, number> = {}
  for (const set of session.sets) {
    if (set.value <= 0) continue
    if (!bestInSession[set.exerciseId] || set.value > bestInSession[set.exerciseId]) {
      bestInSession[set.exerciseId] = set.value
    }
  }
  for (const [exId, v] of Object.entries(bestInSession)) {
    const prev = prs[exId]?.value
    if (prev === undefined || v > prev) {
      prs[exId] = { value: v, at: session.endedAt }
      events.prs.push({ exerciseId: exId, value: v, previous: prev })
    }
  }

  let next: AppState = { ...state, prs, sessions: [...state.sessions, session] }

  // Advance along the road while the current step's unlock bar is cleared.
  const unlocked = [...state.unlocked]
  let stepId: StepId = state.stepId
  let unlockedStep: StepId | undefined
  for (let guard = 0; guard < 10; guard++) {
    const cur = STEP_BY_ID[stepId]
    const following = stepAfter(stepId)
    if (!following) break
    const pr = prs[cur.keyExerciseId]?.value ?? 0
    if (pr < cur.unlockSec) break
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
