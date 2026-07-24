import type { AppState, Session } from '../types'
import { totalHoldSec, weekStreak } from '../lib/stats'
import { EXERCISE_BY_ID } from './exercises'

export interface AchievementDef {
  id: string
  name: string
  desc: string
  icon: string
  /** Evaluated against the state AFTER the session is applied. */
  check: (state: AppState, last: Session) => boolean
  /** Optional live progress toward the unlock, for locked-card hints. */
  progress?: (state: AppState) => { current: number; target: number }
}

const prAtLeast = (state: AppState, exerciseId: string, sec: number) =>
  (state.prs[exerciseId]?.value ?? 0) >= sec

const prProgress =
  (exerciseId: string, target: number) =>
  (s: AppState): { current: number; target: number } => ({
    current: Math.min(target, Math.round(s.prs[exerciseId]?.value ?? 0)),
    target,
  })

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-session', name: 'First Blood', desc: 'Log your first session.', icon: '🏁', check: (s) => s.sessions.length >= 1 },
  { id: 'sessions-10', name: 'Showing Up', desc: '10 sessions logged.', icon: '📅', check: (s) => s.sessions.length >= 10, progress: (s) => ({ current: Math.min(10, s.sessions.length), target: 10 }) },
  { id: 'sessions-50', name: 'Brick by Brick', desc: '50 sessions logged.', icon: '🧱', check: (s) => s.sessions.length >= 50, progress: (s) => ({ current: Math.min(50, s.sessions.length), target: 50 }) },
  { id: 'sessions-100', name: 'Centurion', desc: '100 sessions logged.', icon: '🏛️', check: (s) => s.sessions.length >= 100, progress: (s) => ({ current: Math.min(100, s.sessions.length), target: 100 }) },
  { id: 'streak-2', name: 'Warm Streak', desc: 'Hit your weekly goal 2 weeks running.', icon: '🔥', check: (s, last) => weekStreak(s, last.endedAt).weeks >= 2, progress: (s) => ({ current: Math.min(2, weekStreak(s).weeks), target: 2 }) },
  { id: 'streak-4', name: 'On Fire', desc: 'Hit your weekly goal 4 weeks running.', icon: '🔥', check: (s, last) => weekStreak(s, last.endedAt).weeks >= 4, progress: (s) => ({ current: Math.min(4, weekStreak(s).weeks), target: 4 }) },
  { id: 'streak-8', name: 'Unstoppable', desc: 'Hit your weekly goal 8 weeks running.', icon: '🌋', check: (s, last) => weekStreak(s, last.endedAt).weeks >= 8, progress: (s) => ({ current: Math.min(8, weekStreak(s).weeks), target: 8 }) },
  { id: 'tut-600', name: 'Ten Minutes of Truth', desc: '10 cumulative minutes under tension.', icon: '⏱️', check: (s) => totalHoldSec(s) >= 600, progress: (s) => ({ current: Math.min(600, totalHoldSec(s)), target: 600 }) },
  { id: 'tut-3600', name: 'Hour of Power', desc: 'One cumulative hour of holds.', icon: '⏳', check: (s) => totalHoldSec(s) >= 3600, progress: (s) => ({ current: Math.min(3600, totalHoldSec(s)), target: 3600 }) },
  { id: 'tut-10800', name: 'Made of Stone', desc: 'Three cumulative hours of holds.', icon: '🗿', check: (s) => totalHoldSec(s) >= 10800, progress: (s) => ({ current: Math.min(10800, totalHoldSec(s)), target: 10800 }) },
  { id: 'lean-30', name: 'Lean Machine', desc: '30-second planche lean.', icon: '🎯', check: (s) => prAtLeast(s, 'planche-lean', 30), progress: prProgress('planche-lean', 30) },
  { id: 'frog-30', name: 'Zen Frog', desc: '30-second frog stand.', icon: '🐸', check: (s) => prAtLeast(s, 'frog-stand', 30), progress: prProgress('frog-stand', 30) },
  { id: 'tuck-10', name: 'Liftoff', desc: '10-second tuck planche.', icon: '🛫', check: (s) => prAtLeast(s, 'tuck-planche', 10), progress: prProgress('tuck-planche', 10) },
  { id: 'tuck-20', name: 'Cleared for Takeoff', desc: '20-second tuck planche.', icon: '🚀', check: (s) => prAtLeast(s, 'tuck-planche', 20), progress: prProgress('tuck-planche', 20) },
  { id: 'unlock-advtuck', name: 'Flat Back Society', desc: 'Unlock the Advanced Tuck.', icon: '📐', check: (s) => s.unlocked.includes('advtuck') },
  { id: 'unlock-straddle', name: 'Wings Out', desc: 'Unlock the Straddle Planche.', icon: '🦅', check: (s) => s.unlocked.includes('straddle') },
  { id: 'unlock-full', name: 'The Summit', desc: 'Unlock the Full Planche.', icon: '🏔️', check: (s) => s.unlocked.includes('full') },
  { id: 'full-5', name: 'Gravity Is a Suggestion', desc: 'Hold a full planche for 5 seconds.', icon: '👑', check: (s) => prAtLeast(s, 'full-planche', 5), progress: prProgress('full-planche', 5) },
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
