import type { AppState, Session } from '../types'
import { totalHoldSec, totalSets, weekStreak } from '../lib/stats'
import { EXERCISE_BY_ID } from './exercises'
import { STEP_BY_ID } from './progressions'
import { isQualifyingSet, qualifyingProgress } from '../lib/progression'

export interface AchievementProgress {
  current: number
  target: number
  unit?: 'seconds' | 'duration' | 'score'
}

export interface AchievementDef {
  id: string
  name: string
  desc: string
  icon: string
  /** Evaluated against the state AFTER the session is applied. */
  check: (state: AppState, last: Session) => boolean
  /** Optional live progress toward the unlock, for locked-card hints. */
  progress?: (state: AppState) => AchievementProgress
}

const cleanBest = (state: AppState, exerciseId: string) =>
  state.sessions
    .filter((session) => session.workoutName !== 'Quick Log')
    .flatMap((session) => session.sets)
    .filter((set) => isQualifyingSet(set, exerciseId))
    .reduce((best, set) => Math.max(best, set.value), 0)

const prAtLeast = (state: AppState, exerciseId: string, sec: number) => cleanBest(state, exerciseId) >= sec
const stepMastered = (state: AppState, stepId: 'tuck' | 'oneleg' | 'straddle') =>
  qualifyingProgress(state, stepId).value >= STEP_BY_ID[stepId].unlockSec

const prProgress =
  (exerciseId: string, target: number) =>
  (s: AppState): { current: number; target: number; unit: 'seconds' } => ({
    current: Math.min(target, Math.round(cleanBest(s, exerciseId))),
    target,
    unit: 'seconds',
  })

const durationProgress = (target: number) => (s: AppState) => ({
  current: Math.min(target, totalHoldSec(s)),
  target,
  unit: 'duration' as const,
})

const filmedPlancheSets = (state: AppState) =>
  state.sessions
    .flatMap((session) => session.sets)
    .filter((set) => EXERCISE_BY_ID[set.exerciseId]?.category === 'planche' && set.form?.auto).length

const exerciseVariety = (state: AppState) =>
  new Set(
    state.sessions
      .filter((session) => session.workoutName !== 'Quick Log')
      .flatMap((session) => session.sets.map((set) => set.exerciseId)),
  ).size

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-session', name: 'First Blood', desc: 'Log your first session.', icon: '🏁', check: (s) => s.sessions.length >= 1 },
  { id: 'sessions-3', name: 'Getting Rolling', desc: 'Log 3 sessions.', icon: '🛞', check: (s) => s.sessions.length >= 3, progress: (s) => ({ current: Math.min(3, s.sessions.length), target: 3 }) },
  { id: 'sessions-10', name: 'Showing Up', desc: '10 sessions logged.', icon: '📅', check: (s) => s.sessions.length >= 10, progress: (s) => ({ current: Math.min(10, s.sessions.length), target: 10 }) },
  { id: 'sessions-25', name: 'Quarter Century', desc: '25 sessions logged.', icon: '🎟️', check: (s) => s.sessions.length >= 25, progress: (s) => ({ current: Math.min(25, s.sessions.length), target: 25 }) },
  { id: 'sessions-50', name: 'Brick by Brick', desc: '50 sessions logged.', icon: '🧱', check: (s) => s.sessions.length >= 50, progress: (s) => ({ current: Math.min(50, s.sessions.length), target: 50 }) },
  { id: 'sessions-100', name: 'Centurion', desc: '100 sessions logged.', icon: '🏛️', check: (s) => s.sessions.length >= 100, progress: (s) => ({ current: Math.min(100, s.sessions.length), target: 100 }) },
  { id: 'streak-2', name: 'Warm Streak', desc: 'Hit your weekly goal 2 weeks running.', icon: '🔥', check: (s, last) => weekStreak(s, last.endedAt).weeks >= 2, progress: (s) => ({ current: Math.min(2, weekStreak(s).weeks), target: 2 }) },
  { id: 'streak-4', name: 'On Fire', desc: 'Hit your weekly goal 4 weeks running.', icon: '🔥', check: (s, last) => weekStreak(s, last.endedAt).weeks >= 4, progress: (s) => ({ current: Math.min(4, weekStreak(s).weeks), target: 4 }) },
  { id: 'streak-8', name: 'Unstoppable', desc: 'Hit your weekly goal 8 weeks running.', icon: '🌋', check: (s, last) => weekStreak(s, last.endedAt).weeks >= 8, progress: (s) => ({ current: Math.min(8, weekStreak(s).weeks), target: 8 }) },
  { id: 'streak-12', name: 'Seasoned', desc: 'Hit your weekly goal 12 weeks running.', icon: '🌲', check: (s, last) => weekStreak(s, last.endedAt).weeks >= 12, progress: (s) => ({ current: Math.min(12, weekStreak(s).weeks), target: 12 }) },
  { id: 'tut-300', name: 'First Five', desc: '5 cumulative minutes under tension.', icon: '⌛', check: (s) => totalHoldSec(s) >= 300, progress: durationProgress(300) },
  { id: 'tut-600', name: 'Ten Minutes of Truth', desc: '10 cumulative minutes under tension.', icon: '⏱️', check: (s) => totalHoldSec(s) >= 600, progress: durationProgress(600) },
  { id: 'tut-3600', name: 'Hour of Power', desc: 'One cumulative hour of holds.', icon: '⏳', check: (s) => totalHoldSec(s) >= 3600, progress: durationProgress(3600) },
  { id: 'tut-10800', name: 'Made of Stone', desc: 'Three cumulative hours of holds.', icon: '🗿', check: (s) => totalHoldSec(s) >= 10800, progress: durationProgress(10800) },
  { id: 'tut-21600', name: 'Time Bender', desc: 'Six cumulative hours of holds.', icon: '🌀', check: (s) => totalHoldSec(s) >= 21600, progress: durationProgress(21600) },
  { id: 'lean-30', name: 'Lean Machine', desc: 'Verified 30-second planche lean.', icon: '🎯', check: (s) => prAtLeast(s, 'planche-lean', 30), progress: prProgress('planche-lean', 30) },
  { id: 'frog-30', name: 'Zen Frog', desc: 'Verified 30-second frog stand.', icon: '🐸', check: (s) => prAtLeast(s, 'frog-stand', 30), progress: prProgress('frog-stand', 30) },
  { id: 'tuck-5', name: 'First Flight', desc: 'Verified 5-second tuck planche.', icon: '🪽', check: (s) => prAtLeast(s, 'tuck-planche', 5), progress: prProgress('tuck-planche', 5) },
  { id: 'tuck-10', name: 'Liftoff', desc: 'Verified 10-second tuck planche.', icon: '🛫', check: (s) => prAtLeast(s, 'tuck-planche', 10), progress: prProgress('tuck-planche', 10) },
  { id: 'tuck-20', name: 'Cleared for Takeoff', desc: 'Verified 20-second tuck planche.', icon: '🚀', check: (s) => prAtLeast(s, 'tuck-planche', 20), progress: prProgress('tuck-planche', 20) },
  { id: 'advtuck-10', name: 'Open the Hips', desc: 'Verified 10-second advanced tuck.', icon: '📏', check: (s) => prAtLeast(s, 'adv-tuck-planche', 10), progress: prProgress('adv-tuck-planche', 10) },
  { id: 'oneleg-5', name: 'Split Decision', desc: 'Verified 5-second one-leg planche on both sides.', icon: '🌓', check: (s) => qualifyingProgress(s, 'oneleg').value >= 5, progress: (s) => ({ current: Math.min(5, Math.round(qualifyingProgress(s, 'oneleg').value)), target: 5, unit: 'seconds' }) },
  { id: 'straddle-5', name: 'Wingspan', desc: 'Verified 5-second straddle planche.', icon: '🦅', check: (s) => prAtLeast(s, 'straddle-planche', 5), progress: prProgress('straddle-planche', 5) },
  { id: 'unlock-advtuck', name: 'Flat Back Society', desc: 'Verify the Advanced Tuck unlock.', icon: '📐', check: (s) => stepMastered(s, 'tuck') },
  { id: 'unlock-straddle', name: 'Wings Out', desc: 'Verify the Straddle Planche unlock.', icon: '🦅', check: (s) => stepMastered(s, 'oneleg') },
  { id: 'unlock-full', name: 'The Summit', desc: 'Verify the Full Planche unlock.', icon: '🏔️', check: (s) => stepMastered(s, 'straddle') },
  { id: 'full-5', name: 'Gravity Is a Suggestion', desc: 'Verified 5-second full planche.', icon: '👑', check: (s) => prAtLeast(s, 'full-planche', 5), progress: prProgress('full-planche', 5) },
  { id: 'full-10', name: 'Double Digits', desc: 'Verified 10-second full planche.', icon: '💫', check: (s) => prAtLeast(s, 'full-planche', 10), progress: prProgress('full-planche', 10) },
  { id: 'early-bird', name: 'Early Bird', desc: 'Train before 7am.', icon: '🌅', check: (_s, last) => new Date(last.startedAt).getHours() < 7 },
  { id: 'night-owl', name: 'Night Owl', desc: 'Train after 10pm.', icon: '🦉', check: (_s, last) => new Date(last.startedAt).getHours() >= 22 },
  {
    id: 'wrist-guardian',
    name: 'Wrist Guardian',
    desc: '10 sessions that included wrist work.',
    icon: '🛡️',
    check: (s) =>
      s.sessions.filter((ss) => ss.sets.some((set) => EXERCISE_BY_ID[set.exerciseId]?.category === 'wrist')).length >= 10,
    progress: (s) => ({
      current: Math.min(
        10,
        s.sessions.filter((ss) => ss.sets.some((set) => EXERCISE_BY_ID[set.exerciseId]?.category === 'wrist')).length,
      ),
      target: 10,
    }),
  },
  { id: 'tester', name: 'Moment of Truth', desc: 'Complete a max test.', icon: '🔬', check: (_s, last) => last.workoutKind === 'test' },
  { id: 'deload-disciple', name: 'Restraint', desc: 'Complete a Deload Flow. Recovery is training.', icon: '🧘', check: (_s, last) => last.workoutName === 'Deload Flow' },
  {
    id: 'film-study',
    name: 'Film Study',
    desc: 'Review 10 planche sets with the camera judge.',
    icon: '🎬',
    check: (s) => filmedPlancheSets(s) >= 10,
    progress: (s) => ({ current: Math.min(10, filmedPlancheSets(s)), target: 10 }),
  },
  {
    id: 'precision-pass',
    name: 'Precision Pass',
    desc: 'Earn a confirmed 90+ camera form score.',
    icon: '💎',
    check: (_s, last) =>
      last.sets.some(
        (set) =>
          EXERCISE_BY_ID[set.exerciseId]?.category === 'planche' &&
          set.form?.confirmed === true &&
          (set.form.auto?.confidence ?? 0) >= 0.75 &&
          (set.form.auto?.score ?? 0) >= 90,
      ),
    progress: (s) => ({
      current: Math.min(
        90,
        Math.round(
          Math.max(
            0,
            ...s.sessions.flatMap((session) =>
              session.sets.map((set) =>
                set.form?.confirmed && EXERCISE_BY_ID[set.exerciseId]?.category === 'planche'
                  ? (set.form.auto?.score ?? 0)
                  : 0,
              ),
            ),
          ),
        ),
      ),
      target: 90,
      unit: 'score',
    }),
  },
  {
    id: 'exercise-variety-12',
    name: 'Full Toolbox',
    desc: 'Train 12 different movements in full sessions.',
    icon: '🧰',
    check: (s) => exerciseVariety(s) >= 12,
    progress: (s) => ({ current: Math.min(12, exerciseVariety(s)), target: 12 }),
  },
  {
    id: 'sets-250',
    name: 'Built by Reps',
    desc: 'Log 250 total sets.',
    icon: '⚒️',
    check: (s) => totalSets(s) >= 250,
    progress: (s) => ({ current: Math.min(250, totalSets(s)), target: 250 }),
  },
  {
    id: 'big-day',
    name: 'Two Minutes Airborne',
    desc: '120+ seconds of planche-line holds in one session.',
    icon: '💪',
    check: (_s, last) => {
      let t = 0
      for (const set of last.sets) {
        if (set.kind !== 'hold') continue
        if (EXERCISE_BY_ID[set.exerciseId]?.category === 'planche') t += set.value
      }
      return t >= 120
    },
  },
]

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
)
