import type { AppState, Session, SetLog, Section, StrategyId } from '../types'
import { applySession } from '../lib/engine'
import { initialState } from '../lib/store'
import { addDays } from '../lib/time'
import { STEP_BY_ID } from './progressions'

let idCounter = 1
function sid() {
  return `sample-${idCounter++}`
}

function holdSet(exerciseId: string, value: number, target: number, section: Section, at: number): SetLog {
  return { exerciseId, kind: 'hold', value, target, section, at }
}
function repSet(exerciseId: string, value: number, target: number, section: Section, at: number): SetLog {
  return { exerciseId, kind: 'reps', value, target, section, at }
}

/**
 * ~9 weeks of plausible history: foundations → lean → frog → tuck,
 * finishing with a growing tuck planche. Replayed through the real engine so
 * PRs, unlocks and achievements are all consistent.
 */
export function buildSampleState(): AppState {
  idCounter = 1
  const sessions: Session[] = []
  const now = Date.now()
  const start = addDays(now, -62)

  const weekPlan: { day: number; hour: number }[] = [
    { day: 0, hour: 7 },
    { day: 2, hour: 18 },
    { day: 4, hour: 18 },
  ]

  // Rotate strategies and let this simulated athlete respond best to volume,
  // so the coach has a real signal to discover in the demo history.
  const rotation: StrategyId[] = ['balanced', 'volume', 'intensity', 'density', 'technique']
  let rotIdx = 0
  let prevStrategy: StrategyId | null = null

  for (let week = 0; week < 9; week++) {
    for (const slot of weekPlan) {
      const at = addDays(start, week * 7 + slot.day)
      const t0 = new Date(at)
      t0.setHours(slot.hour, 10, 0, 0)
      const begin = t0.getTime()
      if (begin > now) continue

      const strategy = rotation[rotIdx % rotation.length]
      rotIdx += 1
      const boost = prevStrategy === 'volume' ? 2 : 0
      prevStrategy = strategy

      const sets: SetLog[] = []
      let clock = begin
      const add = (s: SetLog) => {
        sets.push(s)
        clock += 150_000
      }

      add(repSet('wrist-circles', 10, 10, 'warmup', clock))
      add(repSet('wrist-rocks', 8, 8, 'warmup', clock))
      add(repSet('scap-pushup', 8, 8, 'warmup', clock))

      // Progress curves per phase of the sample story.
      const jitter = (v: number, j: number) => Math.max(2, Math.round(v + (Math.random() - 0.5) * 2 * j))
      if (week === 0) {
        const best = 22 + week * 6
        for (let i = 0; i < 4; i++) add(holdSet('ppp-hold', jitter(best * 0.7, 3), 20, 'main', clock))
        add(holdSet('ppp-hold', best + 10, 20, 'main', clock)) // clears 30s → unlock lean
      } else if (week <= 3) {
        const best = Math.min(34, 12 + week * 7)
        for (let i = 0; i < 4; i++) add(holdSet('planche-lean', jitter(best * 0.65, 2), Math.round(best * 0.6), 'main', clock))
        add(holdSet('planche-lean', best, Math.round(best * 0.6), 'main', clock))
        if (week === 3) add(holdSet('frog-stand', 12, 10, 'main', clock))
      } else if (week <= 5) {
        const best = Math.min(33, 14 + (week - 3) * 10)
        for (let i = 0; i < 4; i++) add(holdSet('frog-stand', jitter(best * 0.7, 3), Math.round(best * 0.6), 'main', clock))
        add(holdSet('frog-stand', best, Math.round(best * 0.6), 'main', clock))
        add(holdSet('planche-lean', jitter(30, 3), 20, 'main', clock))
      } else {
        const best = Math.round(4 + (week - 6) * 3.4 + (slot.day / 4) * 1.6 + boost)
        for (let i = 0; i < 4; i++) add(holdSet('tuck-planche', jitter(Math.max(3, best * 0.65), 1), Math.max(3, Math.round(best * 0.6)), 'main', clock))
        add(holdSet('tuck-planche', best, Math.max(3, Math.round(best * 0.6)), 'main', clock))
        add(holdSet('planche-lean', jitter(31, 3), 20, 'main', clock))
      }

      add(repSet('pppu', jitter(5 + week * 0.4, 1), 6, 'strength', clock))
      add(repSet('pppu', jitter(5 + week * 0.4, 1), 6, 'strength', clock))
      add(repSet('pike-pushup', jitter(8, 2), 8, 'strength', clock))
      add(holdSet('hollow-hold', jitter(30 + week, 4), 30, 'core', clock))
      add(holdSet('hollow-hold', jitter(30 + week, 4), 30, 'core', clock))
      add(holdSet('wrist-stretch', 30, 30, 'cooldown', clock))

      sessions.push({
        id: sid(),
        startedAt: begin,
        endedAt: clock,
        workoutName: 'Training Day',
        workoutKind: 'auto',
        stepId: 'foundations',
        sets,
        rpe: 7 + Math.round(Math.random()),
        strategy,
      })
    }
  }

  let state: AppState = { ...initialState(), onboarded: true, name: 'Sample Athlete', startedAt: start }
  for (const s of sessions) {
    s.stepId = state.stepId
    s.workoutName = `${STEP_BY_ID[state.stepId].name} Day`
    state = applySession(state, s).next
  }
  return state
}
