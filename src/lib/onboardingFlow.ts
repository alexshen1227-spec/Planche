import type { EquipmentId, SkillId, StepId } from '../types'
import { missingKit, SKILLS } from '../data/skills'
import { placesWithKit, type KitPlace } from '../components/weekPlanCopy'
import { ASSESSMENT_ITEMS } from './assessment'
import { nextInterviewItem, type InterviewAnswers } from './placement'

/**
 * Keep an athlete's chosen destination. If an untouched default is behind
 * the starting step, suggest the next step. Placement alone verifies no hold.
 */
export function goalPastPlacement(
  skill: SkillId,
  placed: StepId,
  goal: StepId,
  chosen = false,
): { goal: StepId; moved: boolean } {
  const steps = SKILLS[skill].steps
  const placedAt = steps.findIndex((step) => step.id === placed)
  const goalAt = steps.findIndex((step) => step.id === goal)
  if (chosen || placedAt < 0 || goalAt < 0 || goalAt >= placedAt) return { goal, moved: false }
  const next = steps[Math.min(placedAt + 1, steps.length - 1)].id
  return { goal: next, moved: next !== goal }
}

/** The sentence the result screen shows when a destination moved. */
export function goalMovedNote(toName: string, placedName: string): string {
  if (toName === placedName) return `Your goal moved to ${toName}: you are already at the end of this road.`
  return `Your goal moved to ${toName}: you are already at ${placedName}.`
}

/**
 * How many questions the interview for these skills will ask in all, counting
 * those already answered: the shortest and the longest way through, by always
 * picking the lowest or the highest option.
 */
export function interviewLength(skills: SkillId[], answers: InterviewAnswers): { atLeast: number; atMost: number } {
  const asked = Object.keys(answers).length
  const run = (pick: (values: number[]) => number) => {
    const sim: InterviewAnswers = { ...answers }
    let more = 0
    // Bounded: no interview is this long, and a stuck one must not spin.
    for (let item = nextInterviewItem(skills, sim); item && more < 60; item = nextInterviewItem(skills, sim)) {
      sim[item.id] = pick(item.options.map((option) => option.value))
      more += 1
    }
    return asked + more
  }
  const shortest = run((values) => Math.min(...values))
  const longest = run((values) => Math.max(...values))
  return { atLeast: Math.min(shortest, longest), atMost: Math.max(shortest, longest) }
}

/** Every skill on offer: the skills screen's bound, before the choice is made. */
export const ALL_SKILL_IDS = Object.keys(SKILLS) as SkillId[]

/**
 * Where the Skills section's counter stands. Its screens are: pick the skills,
 * the destination, each question the interview will ask (one flow across the
 * chosen skills, or one screen per skill when the athlete picks their own
 * level) and the result. `total` is an upper bound while the planche ladder is
 * still open, which `open` says.
 */
export function skillsProgress(input: {
  stage: 'skills' | 'goal' | 'interview' | 'result'
  skillCount: number
  skipped: boolean
  /** Questions answered so far (interview), or the index of the skill being placed by hand. */
  position: number
  longest: number
  shortest: number
  /**
   * The longest interview any choice of skills could ask (`interviewLength`
   * over every skill). The skills screen is where the choice is made, so its
   * count cannot follow the skills ticked so far: it once read "1 of 5" with
   * one skill ticked, and the next screen of the same step "2 of up to 17".
   * Bounded by every choice, the total only ever tightens through the step.
   */
  widest?: number
}): { at: number; total: number; open: boolean } {
  const middle = (asked: number) => (input.skipped ? Math.max(1, input.skillCount) : Math.max(asked, input.longest))
  if (input.stage === 'skills' && !input.skipped) {
    return { at: 1, total: 3 + Math.max(1, input.widest ?? input.longest, input.longest), open: true }
  }
  const total = 3 + middle(input.position + 1)
  const open = !input.skipped && input.shortest !== input.longest
  if (input.stage === 'skills') return { at: 1, total, open }
  if (input.stage === 'goal') return { at: 2, total, open }
  if (input.stage === 'interview') return { at: 3 + input.position, total, open }
  const lastMiddle = input.skipped ? Math.max(1, input.skillCount) : input.position
  return { at: 3 + lastMiddle, total: 3 + lastMiddle, open: false }
}

const LADDER = ASSESSMENT_ITEMS.filter((item) => item.ladder)

/** The first planche rung answered "not yet" (the frog stand aside, it gates nothing), if any. */
function firstZeroRung(answers: InterviewAnswers): number {
  return LADDER.findIndex((item) => item.id !== 'frog-stand' && answers[item.id] === 0)
}

/**
 * The placement ladder stops at the first rung answered zero (the frog stand
 * aside): harder holds are not asked. An answer to one that was given anyway —
 * the athlete went back and changed a lower rung after answering above it —
 * must not stay in the record, or a stale "1–3 s" on a straddle would sit past
 * a "not yet" on the advanced tuck.
 */
export function pruneBlockedAnswers(answers: InterviewAnswers): InterviewAnswers {
  const stop = firstZeroRung(answers)
  if (stop < 0) return answers
  const next: InterviewAnswers = { ...answers }
  let changed = false
  for (const item of LADDER.slice(stop + 1)) {
    if (item.id !== 'frog-stand' && next[item.id] !== undefined) {
      delete next[item.id]
      changed = true
    }
  }
  return changed ? next : answers
}

/** Said while the ladder is cut short, so the missing questions read as a decision rather than as the app not asking. */
export function ladderStopNote(answers: InterviewAnswers): string | null {
  const stop = firstZeroRung(answers)
  if (stop < 0 || stop >= LADDER.length - 1) return null
  const rung = LADDER[stop]
  const name = rung.exerciseId ? rung.question.split(' — ')[0].toLowerCase() : 'that hold'
  return `You answered “not yet” to the ${name}, so the harder planche holds are skipped. They would not change your start.`
}

/**
 * Where each chosen skill can train, counting the places the athlete has
 * added. The schedule and "Your plan" steps once said a skill was "waiting for
 * kit at home" after the athlete had added a gym with the bar, the wall and
 * the dip bars: waiting is for a skill that no place has the kit for.
 *
 * - `home`: the kit ticked for home trains it.
 * - `atPlaces`: home lacks something, a place has all of it — it trains there.
 * - `waiting`: nothing the athlete has told the app about has it.
 */
export function skillKitStanding(
  skills: readonly SkillId[],
  homeKit: EquipmentId[],
  places: readonly KitPlace[],
  placedFor?: (skill: SkillId) => StepId,
): {
  home: SkillId[]
  atPlaces: { skill: SkillId; places: string[] }[]
  waiting: { skill: SkillId; missing: EquipmentId[][] }[]
} {
  const out: ReturnType<typeof skillKitStanding> = { home: [], atPlaces: [], waiting: [] }
  for (const skill of skills) {
    const step = placedFor?.(skill)
    const missing = missingKit(skill, homeKit, step)
    if (missing.length === 0) {
      out.home.push(skill)
      continue
    }
    const at = placesWithKit(skill, homeKit, places, step)
    if (at.length) out.atPlaces.push({ skill, places: at })
    else out.waiting.push({ skill, missing })
  }
  return out
}

/**
 * The counter beside the section name while the placement runs: "Question 4
 * of 16" through the interview, and on the goal screen before it "Then up to
 * 16 questions" — so "Step 3 of 7 · Skills" does not sit unchanged through
 * seventeen screens. The total is the interview's longest way through while it
 * is still open ("of up to 16"). Null on every other screen, and when the
 * athlete places themselves by hand (one screen per skill, no questions).
 */
export function interviewCounter(input: {
  stage: string
  skipped: boolean
  /** Questions answered so far. */
  answered: number
  /** `interviewLength`: the shortest and the longest way through. */
  shortest: number
  longest: number
}): string | null {
  if (input.skipped) return null
  const open = input.shortest !== input.longest
  if (input.stage === 'goal') return `Then ${open ? 'up to ' : ''}${Math.max(1, input.longest)} questions`
  if (input.stage !== 'interview') return null
  const at = input.answered + 1
  return `Question ${at} of ${open ? 'up to ' : ''}${Math.max(at, input.longest)}`
}
