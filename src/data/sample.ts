import type { AppState, LineupRole, Session, SetLog, Section, SkillId, StrategyId } from '../types'
import { applySession } from '../lib/engine'
import { isReviewOnly, requiresArmsConfirmation, requiresFlightConfirmation } from '../lib/progression'
import { ladderStatus } from '../lib/repLadder'
import { addTrack, sessionSkillSteps, stepOfSkill } from '../lib/skills'
import { initialState } from '../lib/store'
import { addDays } from '../lib/time'
import { STEP_BY_ID, stepForKeyExercise } from './progressions'
import { SKILLS } from './skills'

let idCounter = 1
function sid() {
  return `sample-${idCounter++}`
}

/**
 * A hold as the app would have logged it. A main-work hold on any road's key
 * position carries the evidence an unlock asks for — a camera reading, or the
 * athlete's own replay review where the camera cannot grade the shape — so the
 * demo exercises the same paths a really filmed set would.
 */
function holdSet(exerciseId: string, value: number, target: number, section: Section, at: number): SetLog {
  const keyHold = section === 'main' && stepForKeyExercise(exerciseId) !== undefined
  const form: SetLog['form'] | undefined = !keyHold
    ? undefined
    : isReviewOnly(exerciseId)
      ? { rating: 'clean', confirmed: true, visualReviewPassed: true }
      : {
          rating: 'clean',
          confirmed: true,
          // Support contact cannot be seen in a 2D pose; the athlete confirms it.
          ...(requiresFlightConfirmation(exerciseId) ? { flightConfirmed: true } : {}),
          // A small elbow bend cannot be seen in a hang or a handstand; the athlete confirms the lock.
          ...(requiresArmsConfirmation(exerciseId) ? { armsConfirmed: true } : {}),
          auto: {
            issues: [],
            confidence: 0.9,
            score: 84 + (Math.round(value) % 9),
            cleanSeconds: value,
            cleanRatio: 1,
          },
        }
  return { exerciseId, kind: 'hold', value, target, section, at, ...(form ? { form } : {}) }
}

function repSet(exerciseId: string, value: number, target: number, section: Section, at: number, reviewed = false): SetLog {
  return {
    exerciseId,
    kind: 'reps',
    value,
    target,
    section,
    at,
    // A filmed set the athlete passed on the replay — what a rung's standard asks for.
    ...(reviewed ? { form: { rating: 'clean' as const, confirmed: true, visualReviewPassed: true } } : {}),
  }
}

/**
 * About nine weeks of plausible history for an athlete training three skills:
 * the planche first (foundations → lean → frog → tuck), the front lever beside
 * it on two days a week (hang → tuck), and the handstand with its push-up line
 * on the third. Each session is built from where the athlete stands at that
 * moment and replayed through the real engine, so steps, rungs, PRs and
 * achievements are all the app's own derivations rather than typed-in results.
 */
export function buildSampleState(): AppState {
  idCounter = 1
  const now = Date.now()
  const start = addDays(now, -62)

  const weekPlan: { day: number; hour: number; partner: SkillId }[] = [
    { day: 0, hour: 7, partner: 'frontlever' },
    { day: 2, hour: 18, partner: 'handstand' },
    { day: 4, hour: 18, partner: 'frontlever' },
  ]

  // Rotate strategies and let this simulated athlete respond best to volume,
  // so the coach has a real signal to discover in the demo history.
  const rotation: StrategyId[] = ['balanced', 'volume', 'intensity', 'density', 'technique']
  let rotIdx = 0
  let prevStrategy: StrategyId | null = null

  // A weekly weigh-in that drifts slightly, so the bodyweight panel and the
  // coach's strength-to-weight reading have something real to work with.
  const measurements = Array.from({ length: 9 }, (_, w) => ({
    at: addDays(start, w * 7),
    weightKg: Math.round((72 - w * 0.15 + (Math.random() - 0.5) * 0.6) * 10) / 10,
    ...(w === 0 ? { heightCm: 178 } : {}),
  })).filter((m) => m.at <= now)

  let state: AppState = {
    ...initialState(),
    onboarded: true,
    name: 'Sample Athlete',
    startedAt: start,
    profile: {
      equipment: ['floor', 'parallettes', 'pullup-bar', 'wall'],
      heightCm: 178,
      skills: ['planche', 'frontlever', 'handstand'],
    },
    measurements,
  }
  state = addTrack(state, 'frontlever', start)
  state = addTrack(state, 'handstand', start)

  /** Sessions spent on each step so far, so a hold grows from where its step started. */
  const sessionsOn: Record<string, number> = {}
  const visit = (stepId: string) => {
    const n = sessionsOn[stepId] ?? 0
    sessionsOn[stepId] = n + 1
    return n
  }
  const jitter = (v: number, j: number) => Math.max(2, Math.round(v + (Math.random() - 0.5) * 2 * j))

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

      // ——— The planche leads every session ———
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

      // ——— Today's second skill, from the step it is on right now ———
      if (slot.partner === 'frontlever') {
        const stepId = stepOfSkill(state, 'frontlever')
        const n = visit(stepId)
        const key = STEP_BY_ID[stepId].keyExerciseId
        // A hang that clears its 30s bar in the second week, then a tuck lever
        // that grows about a second a session and is still short of its bar.
        const best = stepId === 'fl-hang' ? 18 + n * 5 : Math.min(18, 4 + n)
        const working = Math.max(2, Math.round(best * 0.65))
        add(repSet('scap-pull', 8, 8, 'warmup', clock))
        for (let i = 0; i < 3; i++) add(holdSet(key, jitter(working, 1), working, 'main', clock))
        add(holdSet(key, best, working, 'main', clock))
        add(repSet('pullup', jitter(5 + week * 0.3, 1), 5, 'strength', clock))
        add(repSet('pullup', jitter(5 + week * 0.3, 1), 5, 'strength', clock))
      } else {
        const stepId = stepOfSkill(state, 'handstand')
        const n = visit(stepId)
        const key = STEP_BY_ID[stepId].keyExerciseId
        // A wall plank past its bar in the fourth week, then wall handstands.
        const best = stepId === 'hs-foundations' ? 16 + n * 6 : Math.min(48, 20 + n * 4)
        const working = Math.round(best * 0.65)
        for (let i = 0; i < 2; i++) add(holdSet(key, jitter(working, 2), working, 'main', clock))
        add(holdSet(key, best, working, 'main', clock))
        // The push-up line: filmed and passed on the replay from the fifth
        // week, so the first rung opens on its standard and the next begins.
        const rung = ladderStatus(state, 'handstand')?.rung
        if (rung) {
          const m = visit(`rung:${rung.exerciseId}`)
          const reps = Math.min(rung.standardReps, rung.startReps + Math.floor(m / 2))
          const filmed = week >= 4
          add(repSet(rung.exerciseId, Math.max(1, reps - 1), rung.startReps, 'strength', clock, filmed))
          add(repSet(rung.exerciseId, reps, rung.startReps, 'strength', clock, filmed))
        }
      }

      add(repSet('pppu', jitter(5 + week * 0.4, 1), 6, 'strength', clock))
      add(repSet('pppu', jitter(5 + week * 0.4, 1), 6, 'strength', clock))
      add(holdSet('hollow-hold', jitter(30 + week, 4), 30, 'core', clock))
      add(holdSet('hollow-hold', jitter(30 + week, 4), 30, 'core', clock))
      add(holdSet('wrist-stretch', 30, 30, 'cooldown', clock))

      const roles: Partial<Record<SkillId, LineupRole>> = { planche: 'lead', [slot.partner]: 'partner' }
      const session: Session = {
        id: sid(),
        startedAt: begin,
        endedAt: clock,
        workoutName: `Planche + ${SKILLS[slot.partner].name}`,
        workoutKind: 'auto',
        // The steps this session was actually trained at. The coach only learns
        // from sessions matching the step it is planning for, so each session
        // is stamped with where the athlete stood when it began.
        stepId: state.stepId,
        sets,
        rpe: 7 + Math.round(Math.random()),
        strategy,
        // The partner's part was shaped by the same approach, as a real mixed
        // session records it — so the coach has something to read on every road.
        skills: Object.fromEntries(
          Object.entries(sessionSkillSteps(state)).map(([skill, note]) => [
            skill,
            skill === slot.partner ? { ...note, strategy } : note,
          ]),
        ),
        roles,
      }
      state = applySession(state, session).next
    }
  }
  return state
}
