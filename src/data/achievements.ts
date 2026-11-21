import type { AppState, Session, SkillId } from '../types'
import { totalHoldSec, totalSets, weekStreak } from '../lib/stats'
import { EXERCISE_BY_ID } from './exercises'
import { STEP_BY_ID } from './progressions'
import { SKILL_LIST, skillOfExercise } from './skills'
import { progressionCredit, qualifyingProgress, testWasAttempted } from '../lib/progression'
import { standardsMet, verifiedReps } from '../lib/repLadder'
import { isSkillHold } from '../lib/skills'

/**
 * Bump whenever existing history should be rechecked against the catalog.
 * Version 4 added the front lever, handstand, 90° and flag badges, and widened
 * three planche-only ones (film study, precision pass, two minutes on the
 * line) to any skill's holds. Version 5 recounts records without warm-up and
 * cooldown sets, which had been setting them.
 */
export const ACHIEVEMENT_VERSION = 5

/**
 * Badges whose *rule* was corrected in a catalog version, so an award made
 * under the old rule is re-derived from history instead of kept.
 *
 * Normally an existing timestamp wins on reconcile — a badge is a record of
 * something that happened. These are the exception: version 3 found that the
 * "verified N-second" badges read the stopwatch value of a qualifying set
 * rather than the camera-verified clean seconds, so a 20s timer hold the
 * camera saw break down at 5s earned "Verified 20-second tuck planche". A
 * record of something that did not happen is not a record. Replaying gives the
 * date the corrected rule was genuinely first met, or no award at all.
 */
export const REVALIDATED_ACHIEVEMENTS: Record<number, readonly string[]> = {
  3: [
    'lean-30',
    'frog-30',
    'tuck-5',
    'tuck-10',
    'tuck-20',
    'advtuck-10',
    'straddle-5',
    'full-5',
    'full-10',
    'tester',
  ],
}

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
  /**
   * The skill a badge belongs to. It is only listed for an athlete who trains
   * that skill, or has already earned it: thirty locked badges for roads
   * nobody is on are noise, not goals.
   */
  skill?: SkillId
  /** Evaluated against the state AFTER the session is applied. */
  check: (state: AppState, last: Session) => boolean
  /** Optional live progress toward the unlock, for locked-card hints. */
  progress?: (state: AppState) => AchievementProgress
}

/**
 * Best verified duration, measured exactly as an unlock measures it.
 *
 * Eligibility is not the same as duration: a set can qualify on its evidence
 * while the camera watched it break down partway through. `progressionCredit`
 * caps at the camera-verified clean seconds, so a badge saying "verified 20
 * seconds" now means twenty verified seconds — one canonical number shared by
 * badges, the qualified chart and unlocks.
 */
const cleanBest = (state: AppState, exerciseId: string) =>
  state.sessions
    .filter((session) => session.workoutName !== 'Quick Log')
    .flatMap((session) => session.sets)
    .reduce((best, set) => Math.max(best, progressionCredit(set, exerciseId)), 0)


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

/** Holds on any skill's own line that carry a camera reading. */
const filmedSkillSets = (state: AppState) =>
  state.sessions
    .flatMap((session) => session.sets)
    .filter((set) => isSkillHold(EXERCISE_BY_ID[set.exerciseId]) && set.form?.auto).length

/** Most reps of a movement shown in one set with a replay-checked review. */
const repBest = (state: AppState, exerciseId: string) =>
  state.sessions
    .filter((session) => session.workoutName !== 'Quick Log')
    .flatMap((session) => session.sets)
    .reduce((best, set) => (set.exerciseId === exerciseId ? Math.max(best, verifiedReps(set)) : best), 0)

const repsAtLeast = (exerciseId: string, reps: number) => (state: AppState) => repBest(state, exerciseId) >= reps
const repProgress = (exerciseId: string, target: number) => (state: AppState) => ({
  current: Math.min(target, repBest(state, exerciseId)),
  target,
})

/** Skills with at least one verified second on one of their own holds. */
const verifiedSkillCount = (state: AppState) => {
  const seen = new Set<SkillId>()
  for (const session of state.sessions) {
    if (session.workoutName === 'Quick Log') continue
    for (const set of session.sets) {
      const skill = skillOfExercise(set.exerciseId)
      if (skill && !seen.has(skill) && progressionCredit(set, set.exerciseId) > 0) seen.add(skill)
    }
  }
  return seen.size
}

/**
 * Rung standards met on the push-up lines since placement, across skills —
 * from the history alone, so that changing the kit list cannot take a badge
 * back (see `standardsMet`).
 */
const rungsClimbed = (state: AppState) => SKILL_LIST.reduce((total, skill) => total + standardsMet(state, skill.id), 0)

/** The skills whose own holds a session trained as main work. */
const skillsTrainedIn = (session: Session) =>
  new Set(
    session.sets
      .filter((set) => set.section === 'main' && set.value > 0 && isSkillHold(EXERCISE_BY_ID[set.exerciseId]))
      .map((set) => skillOfExercise(set.exerciseId)),
  ).size

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
  { id: 'lean-30', skill: 'planche', name: 'Lean Machine', desc: 'Verified 30-second planche lean.', icon: '🎯', check: (s) => prAtLeast(s, 'planche-lean', 30), progress: prProgress('planche-lean', 30) },
  { id: 'frog-30', skill: 'planche', name: 'Zen Frog', desc: 'Verified 30-second frog stand.', icon: '🐸', check: (s) => prAtLeast(s, 'frog-stand', 30), progress: prProgress('frog-stand', 30) },
  { id: 'tuck-5', skill: 'planche', name: 'First Flight', desc: 'Verified 5-second tuck planche.', icon: '🪽', check: (s) => prAtLeast(s, 'tuck-planche', 5), progress: prProgress('tuck-planche', 5) },
  { id: 'tuck-10', skill: 'planche', name: 'Liftoff', desc: 'Verified 10-second tuck planche.', icon: '🛫', check: (s) => prAtLeast(s, 'tuck-planche', 10), progress: prProgress('tuck-planche', 10) },
  { id: 'tuck-20', skill: 'planche', name: 'Cleared for Takeoff', desc: 'Verified 20-second tuck planche.', icon: '🚀', check: (s) => prAtLeast(s, 'tuck-planche', 20), progress: prProgress('tuck-planche', 20) },
  { id: 'advtuck-10', skill: 'planche', name: 'Open the Hips', desc: 'Verified 10-second advanced tuck.', icon: '📏', check: (s) => prAtLeast(s, 'adv-tuck-planche', 10), progress: prProgress('adv-tuck-planche', 10) },
  { id: 'oneleg-5', skill: 'planche', name: 'Split Decision', desc: 'Verified 5-second one-leg planche on both sides.', icon: '🌓', check: (s) => qualifyingProgress(s, 'oneleg').value >= 5, progress: (s) => ({ current: Math.min(5, Math.round(qualifyingProgress(s, 'oneleg').value)), target: 5, unit: 'seconds' }) },
  { id: 'straddle-5', skill: 'planche', name: 'Wingspan', desc: 'Verified 5-second straddle planche.', icon: '🦅', check: (s) => prAtLeast(s, 'straddle-planche', 5), progress: prProgress('straddle-planche', 5) },
  { id: 'unlock-advtuck', skill: 'planche', name: 'Flat Back Society', desc: 'Verify the Advanced Tuck unlock.', icon: '📐', check: (s) => stepMastered(s, 'tuck') },
  { id: 'unlock-straddle', skill: 'planche', name: 'Wings Out', desc: 'Verify the Straddle Planche unlock.', icon: '🦅', check: (s) => stepMastered(s, 'oneleg') },
  { id: 'unlock-full', skill: 'planche', name: 'The Summit', desc: 'Verify the Full Planche unlock.', icon: '🏔️', check: (s) => stepMastered(s, 'straddle') },
  { id: 'full-5', skill: 'planche', name: 'Gravity Is a Suggestion', desc: 'Verified 5-second full planche.', icon: '👑', check: (s) => prAtLeast(s, 'full-planche', 5), progress: prProgress('full-planche', 5) },
  { id: 'full-10', skill: 'planche', name: 'Double Digits', desc: 'Verified 10-second full planche.', icon: '💫', check: (s) => prAtLeast(s, 'full-planche', 10), progress: prProgress('full-planche', 10) },
  { id: 'early-bird', name: 'Early Bird', desc: 'Train before 7am.', icon: '🌅', check: (_s, last) => new Date(last.startedAt).getHours() < 7 },
  { id: 'night-owl', name: 'Night Owl', desc: 'Train after 10pm.', icon: '🦉', check: (_s, last) => new Date(last.startedAt).getHours() >= 22 },
  {
    // Id kept so earned history is untouched. The name is a record of what
    // was done; "Guardian" implied the routine protects the wrist, which no
    // preparation routine has been shown to do.
    id: 'wrist-guardian',
    name: 'Wrist Prep Habit',
    desc: '10 sessions that included wrist preparation.',
    icon: '🔄',
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
  { id: 'tester', name: 'Moment of Truth', desc: 'Make an attempt in a max test.', icon: '🔬', check: (_s, last) => testWasAttempted(last) },
  { id: 'deload-disciple', skill: 'planche', name: 'Restraint', desc: 'Complete a Deload Flow.', icon: '🧘', check: (_s, last) => last.workoutName === 'Deload Flow' },
  {
    id: 'film-study',
    name: 'Film Study',
    desc: 'Have the camera judge read 10 of your skill holds.',
    icon: '🎬',
    check: (s) => filmedSkillSets(s) >= 10,
    progress: (s) => ({ current: Math.min(10, filmedSkillSets(s)), target: 10 }),
  },
  {
    id: 'precision-pass',
    name: 'Precision Pass',
    desc: 'Earn a confirmed 90+ camera form score.',
    icon: '💎',
    check: (_s, last) =>
      last.sets.some(
        (set) =>
          isSkillHold(EXERCISE_BY_ID[set.exerciseId]) &&
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
                set.form?.confirmed && isSkillHold(EXERCISE_BY_ID[set.exerciseId])
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
    // Skill-line holds include leans and wall work with the feet down, so
    // "airborne" claimed something most of those seconds were not.
    id: 'big-day',
    name: 'Two Minutes on the Line',
    desc: '120+ seconds of skill holds in one session.',
    icon: '💪',
    check: (_s, last) => {
      let t = 0
      for (const set of last.sets) {
        if (set.kind !== 'hold') continue
        if (isSkillHold(EXERCISE_BY_ID[set.exerciseId])) t += set.value
      }
      return t >= 120
    },
  },

  // ——— Front lever ———
  { id: 'fl-tuck-10', skill: 'frontlever', name: 'Off the Floor', desc: 'Verified 10-second tuck front lever.', icon: '🪝', check: (s) => prAtLeast(s, 'tuck-front-lever', 10), progress: prProgress('tuck-front-lever', 10) },
  { id: 'fl-advtuck-10', skill: 'frontlever', name: 'Flat Back, Hanging', desc: 'Verified 10-second advanced tuck front lever.', icon: '🧲', check: (s) => prAtLeast(s, 'adv-tuck-front-lever', 10), progress: prProgress('adv-tuck-front-lever', 10) },
  { id: 'fl-straddle-5', skill: 'frontlever', name: 'Wide and Level', desc: 'Verified 5-second straddle front lever.', icon: '🦇', check: (s) => prAtLeast(s, 'straddle-front-lever', 5), progress: prProgress('straddle-front-lever', 5) },
  { id: 'fl-full-3', skill: 'frontlever', name: 'Dead Level', desc: 'Verified 3-second front lever.', icon: '🎚️', check: (s) => prAtLeast(s, 'front-lever', 3), progress: prProgress('front-lever', 3) },
  { id: 'fl-full-8', skill: 'frontlever', name: 'Lever Pulled', desc: 'Verified 8-second front lever.', icon: '🏆', check: (s) => prAtLeast(s, 'front-lever', 8), progress: prProgress('front-lever', 8) },

  // ——— Handstand and handstand push-up ———
  { id: 'hs-wall-30', skill: 'handstand', name: 'Stacked', desc: 'Verified 30-second wall handstand.', icon: '🧍', check: (s) => prAtLeast(s, 'wall-handstand', 30), progress: prProgress('wall-handstand', 30) },
  { id: 'hs-free-5', skill: 'handstand', name: 'Hands for Feet', desc: 'Verified 5-second freestanding handstand.', icon: '🤸', check: (s) => prAtLeast(s, 'freestanding-handstand', 5), progress: prProgress('freestanding-handstand', 5) },
  { id: 'hs-free-15', skill: 'handstand', name: 'Found the Balance', desc: 'Verified 15-second freestanding handstand.', icon: '⚖️', check: (s) => prAtLeast(s, 'freestanding-handstand', 15), progress: prProgress('freestanding-handstand', 15) },
  { id: 'hs-free-30', skill: 'handstand', name: 'Half a Minute Upside Down', desc: 'Verified 30-second freestanding handstand.', icon: '🙃', check: (s) => prAtLeast(s, 'freestanding-handstand', 30), progress: prProgress('freestanding-handstand', 30) },
  { id: 'hspu-wall-1', skill: 'handstand', name: 'Pressed Upside Down', desc: 'A replay-checked wall handstand push-up.', icon: '🔺', check: repsAtLeast('wall-hspu', 1) },
  { id: 'hspu-wall-5', skill: 'handstand', name: 'Five Strict', desc: 'Five replay-checked wall handstand push-ups in one set.', icon: '🖐️', check: repsAtLeast('wall-hspu', 5), progress: repProgress('wall-hspu', 5) },
  { id: 'hspu-free-1', skill: 'handstand', name: 'No Wall', desc: 'A replay-checked freestanding handstand push-up.', icon: '🎪', check: repsAtLeast('freestanding-hspu', 1) },

  // ——— 90° hold and push-up ———
  { id: 'n90-tuck-5', skill: 'ninety', name: 'Right Angle', desc: 'Verified 5-second tuck 90° hold.', icon: '🦾', check: (s) => prAtLeast(s, 'tuck-ninety-hold', 5), progress: prProgress('tuck-ninety-hold', 5) },
  { id: 'n90-full-3', skill: 'ninety', name: 'Ninety', desc: 'Verified 3-second 90° hold.', icon: '🧊', check: (s) => prAtLeast(s, 'ninety-hold', 3), progress: prProgress('ninety-hold', 3) },
  { id: 'n90-pushup-1', skill: 'ninety', name: 'There and Back', desc: 'A replay-checked 90° push-up.', icon: '🎖️', check: repsAtLeast('ninety-pushup', 1) },

  // ——— Human flag ———
  { id: 'flag-tuck-5', skill: 'flag', name: 'Half Mast', desc: 'Verified 5-second tuck flag.', icon: '🚩', check: (s) => prAtLeast(s, 'tuck-flag', 5), progress: prProgress('tuck-flag', 5) },
  { id: 'flag-straddle-3', skill: 'flag', name: 'Unfurled', desc: 'Verified 3-second straddle flag.', icon: '🎏', check: (s) => prAtLeast(s, 'straddle-flag', 3), progress: prProgress('straddle-flag', 3) },
  { id: 'flag-full-3', skill: 'flag', name: 'Flying the Flag', desc: 'Verified 3-second human flag.', icon: '🎌', check: (s) => prAtLeast(s, 'human-flag', 3), progress: prProgress('human-flag', 3) },
  { id: 'flag-full-5', skill: 'flag', name: 'Full Mast', desc: 'Verified 5-second human flag.', icon: '⛳', check: (s) => prAtLeast(s, 'human-flag', 5), progress: prProgress('human-flag', 5) },

  // ——— More than one skill ———
  { id: 'two-skills-session', name: 'Double Feature', desc: 'Train two skills’ own holds as main work in one session.', icon: '🎭', check: (_s, last) => skillsTrainedIn(last) >= 2 },
  { id: 'three-roads', name: 'Triple Threat', desc: 'A verified hold on three different skills.', icon: '🔱', check: (s) => verifiedSkillCount(s) >= 3, progress: (s) => ({ current: Math.min(3, verifiedSkillCount(s)), target: 3 }) },
  { id: 'rung-opened', name: 'Next Rung', desc: 'Meet a rung’s standard on a push-up line with a replay-checked set.', icon: '🪜', check: (s) => rungsClimbed(s) >= 1 },
]

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.id, a]),
)
