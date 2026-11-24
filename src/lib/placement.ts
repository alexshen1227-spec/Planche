import type { AssessmentRecord, SkillId, StepId } from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { SKILLS } from '../data/skills'
import {
  ASSESSMENT_BY_ID,
  assessmentProgress,
  nextAssessmentItem,
  placeFromAssessment,
  type AssessmentAnswers,
  type AssessmentOption,
  type Placement,
} from './assessment'

/**
 * Placement across several skills.
 *
 * The planche keeps its own interview (`assessment.ts`): a rung-by-rung ladder
 * that took a review to get right. Every other skill is placed by one
 * question — the hardest hold on its road the athlete already owns — plus the
 * capacity questions its sessions size themselves from. One question is thin
 * evidence, and the result says so: a placement here is never better than
 * "moderate", and prerequisites cap it downward, never up.
 *
 * Pure: skills and answers in, the next question or a placement out.
 */

export type InterviewAnswers = Record<string, number>

export interface InterviewItem {
  id: string
  question: string
  standard?: string
  options: AssessmentOption[]
  /** The skill a level question places, for the screen's eyebrow. */
  skill?: SkillId
}

/** The answer key for "how far along this skill's road are you". */
export const levelId = (skill: SkillId) => `level:${skill}`

/** Strict pull-ups: what the pulling skills' sessions and prerequisites are sized from. */
export const PULLUPS_ITEM: InterviewItem = {
  id: 'pullups',
  question: 'How many strict pull-ups can you do in one set?',
  standard: 'From a dead hang, chin over the bar, no swing or kick. Count the ones you would be happy to film.',
  options: [
    { label: 'None yet', value: 0 },
    { label: '1–4', value: 3 },
    { label: '5–9', value: 7 },
    { label: '10 or more', value: 12 },
  ],
}

/** Skills whose sessions put bodyweight through the wrists. */
const WRIST_LOADED: SkillId[] = ['planche', 'handstand', 'ninety']
/** Skills whose strength work is pressing. */
const PRESSING: SkillId[] = ['planche', 'handstand', 'ninety']
/** Skills that need a pulling base. */
const PULLING: SkillId[] = ['frontlever', 'flag']

/**
 * "Which of these do you already own?" for one skill's road.
 *
 * Each option is a step's own unlock standard, so the answer means the same
 * thing the app will later ask the camera to verify. The value is how many
 * steps are owned: 0 for none, 1 for the first, and so on.
 */
export function levelItem(skill: SkillId): InterviewItem {
  const def = SKILLS[skill]
  return {
    id: levelId(skill),
    skill,
    question: `${def.name}: which is the hardest of these you can already hold?`,
    standard:
      'Pick the last one you are sure of — held clean for the whole time shown, not the best you have ever touched. From your first sessions these holds are filmed: the camera checks the ones it can judge, and you check the rest yourself on the replay.',
    options: [
      { label: 'None of these yet', value: 0, hint: 'Start at the beginning of the road' },
      ...def.steps.map((step, index) => ({
        label: `${EXERCISE_BY_ID[step.keyExerciseId]?.name ?? step.name} — ${step.unlockSec}s`,
        value: index + 1,
        ...(step.repeatDays && step.repeatDays > 1 ? { hint: `On ${step.repeatDays} separate days` } : {}),
      })),
    ],
  }
}

/** The answer key for where a skill's rep ladder starts — the one `ladderStatus` reads. */
export const ladderId = (skill: SkillId) => `ladder:${SKILLS[skill].ladder?.id ?? skill}`

/**
 * "Which of these can you already do?" for a skill's rep line.
 *
 * The value is the rung itself: the athlete trains at the hardest one they can
 * do a clean rep of, until its standard opens the next.
 */
export function ladderItem(skill: SkillId): InterviewItem | null {
  const ladder = SKILLS[skill].ladder
  if (!ladder) return null
  return {
    id: ladderId(skill),
    skill,
    question: `${ladder.name}: which is the hardest of these you can do at least one clean rep of?`,
    standard:
      'A clean rep goes all the way down under control and finishes with the arms locked. Pick the last one you are sure of.',
    options: [...(skill === 'handstand' ? [{ label: 'No full pike push-up yet', value: -1, hint: 'Start with knee-supported presses' }] : []), ...ladder.rungs.map((rung, index) => ({
      label: EXERCISE_BY_ID[rung.exerciseId]?.name ?? rung.exerciseId,
      value: index,
      ...(index === 0 && skill !== 'handstand' ? { hint: 'Or none of these yet — the line starts here' } : {}),
    }))],
  }
}

/**
 * The rung a rep line starts on. Capped like a hold placement: wrists that
 * hurt, or a thin push-up base, start the line at its first rung whatever was
 * claimed.
 */
export function ladderStart(skill: SkillId, answers: InterviewAnswers): number | undefined {
  const ladder = SKILLS[skill].ladder
  const claimed = answers[ladderId(skill)]
  if (!ladder || claimed === undefined) return undefined
  const index = Math.min(ladder.rungs.length - 1, Math.max(0, Math.round(claimed)))
  if (answers.wrist === 0) return 0
  if (answers.pushups !== undefined && answers.pushups < 10) return 0
  return index
}

/** The shared capacity questions a set of skills needs, in asking order. */
function sharedItemIds(skills: SkillId[]): ('wrist' | 'pushups' | 'hollow')[] {
  const ids: ('wrist' | 'pushups' | 'hollow')[] = []
  if (skills.some((skill) => WRIST_LOADED.includes(skill))) ids.push('wrist')
  if (skills.some((skill) => PRESSING.includes(skill))) ids.push('pushups')
  ids.push('hollow')
  return ids
}

/**
 * The next question worth asking for these skills, or null when done.
 *
 * With the planche chosen its own interview runs first — it already asks about
 * wrists, push-ups and the hollow hold. Without it those are asked directly.
 * Training experience is always last.
 */
export function nextInterviewItem(skills: SkillId[], answers: InterviewAnswers): InterviewItem | null {
  if (skills.includes('planche')) {
    const item = nextAssessmentItem(answers as AssessmentAnswers)
    if (item && item.id !== 'experience') return item
  } else {
    for (const id of sharedItemIds(skills)) {
      if (answers[id] === undefined) return ASSESSMENT_BY_ID[id]
    }
  }
  if (skills.some((skill) => PULLING.includes(skill)) && answers.pullups === undefined) return PULLUPS_ITEM
  for (const skill of skills) {
    if (skill === 'planche') continue
    if (answers[levelId(skill)] === undefined) return levelItem(skill)
    const ladder = ladderItem(skill)
    if (ladder && answers[ladder.id] === undefined) return ladder
  }
  if (answers.experience === undefined) return ASSESSMENT_BY_ID.experience
  return null
}

/** Roughly how far through the interview the athlete is — "roughly" for the same reason as the planche's. */
export function interviewProgress(skills: SkillId[], answers: InterviewAnswers): { answered: number; likelyTotal: number } {
  const answered = Object.keys(answers).length
  const others = skills
    .filter((skill) => skill !== 'planche')
    .reduce((total, skill) => total + 1 + (SKILLS[skill].ladder ? 1 : 0), 0)
  const pulling = skills.some((skill) => PULLING.includes(skill)) ? 1 : 0
  if (skills.includes('planche')) {
    const planche = assessmentProgress(answers as AssessmentAnswers)
    return { answered, likelyTotal: Math.max(answered, planche.likelyTotal + pulling + others) }
  }
  // Shared questions, pull-ups, one level question per skill, experience.
  return { answered, likelyTotal: Math.max(answered, sharedItemIds(skills).length + pulling + others + 1) }
}

/**
 * Where one skill's road starts for these answers.
 *
 * The planche is placed by its own ladder. Every other skill starts on the
 * step after the last one the athlete says they own, and is then *capped* by
 * what its sessions need on day one: nobody is placed on a lever they would
 * have to hang from without a single pull-up, or on a wall handstand with
 * wrists that already hurt. Caps move a placement down, never up.
 */
export function placeSkill(skill: SkillId, answers: InterviewAnswers): Placement {
  if (skill === 'planche') return placeFromAssessment(answers as AssessmentAnswers)
  const def = SKILLS[skill]
  const steps = def.steps
  const owned = answers[levelId(skill)]
  const inconsistencies: string[] = []
  const caveats: string[] = []
  if (owned === undefined) {
    return {
      stepId: steps[0].id,
      confidence: 'low',
      reason: `Starting at ${steps[0].name}, the beginning of the ${def.holdName} road, because nothing was said about where you are on it.`,
      gaps: [],
      caveats,
      inconsistencies,
    }
  }
  let index = Math.min(steps.length - 1, Math.max(0, Math.round(owned)))
  const claimed = index
  let capReason: string | undefined

  const pullups = answers.pullups
  const pushups = answers.pushups
  const wrist = answers.wrist
  if ((skill === 'frontlever' || skill === 'flag') && pullups !== undefined) {
    if (pullups === 0 && index > 0) {
      index = 0
      capReason =
        skill === 'frontlever'
          ? 'With no pull-ups yet, the road starts at the hang: every later step is held on arms that have to carry you first.'
          : 'With no pull-ups yet, the road starts at the supported hold: the top arm of a flag is a pull.'
    } else if (pullups < 5 && index >= 2) {
      inconsistencies.push(
        skill === 'frontlever'
          ? 'A tuck front lever alongside fewer than five pull-ups is unusual. Check the hold you counted was level — hips at shoulder height, arms straight.'
          : 'A flag held off the ground alongside fewer than five pull-ups is unusual. Check the hold you counted had both feet clear and both arms straight.',
      )
    }
  }
  if ((skill === 'handstand' || skill === 'ninety') && wrist === 0 && index > 0) {
    index = 0
    capReason =
      'Your wrists hurt in a push-up position, so this starts at the first step whatever you can already hold — it is the step that prepares them, and pain there needs settling before bodyweight goes through it.'
    caveats.push('Wrist pain that is still there the next day, or any swelling, is worth having looked at before loading it.')
  }
  if (skill === 'ninety' && pushups !== undefined && pushups < 10 && index > 0) {
    index = 0
    capReason =
      'A 90° hold is bent-arm strength first. With fewer than ten push-ups the road starts at the lean, which is where that strength is built.'
  }

  const step = steps[index]
  const previous = index > 0 ? steps[index - 1] : undefined
  const previousName = previous ? (EXERCISE_BY_ID[previous.keyExerciseId]?.name ?? previous.name) : undefined
  const reason =
    capReason ??
    (claimed === 0
      ? `Starting at ${step.name}, the beginning of the ${def.holdName} road. ${step.tagline}.`
      : owned >= steps.length
        ? `You said you already hold the top of this road, so you start there: ${step.name}. Your first filmed sets confirm it — and the bar stays in your sessions.`
        : `You said you already hold ${previousName!.toLowerCase()} for ${previous!.unlockSec}s, so you start on the next shape: ${step.name}. A filmed set is what confirms it.`)
  return {
    stepId: step.id,
    // One self-reported answer: never better than moderate, and lower when it
    // was capped or the answers disagree.
    confidence: inconsistencies.length || capReason ? 'low' : 'moderate',
    reason,
    gaps: [],
    caveats,
    inconsistencies,
  }
}

/** The record kept beside a skill's track: the answers that placed it, and where they put it. */
export function placementRecord(skill: SkillId, answers: InterviewAnswers, at: number): AssessmentRecord {
  const placement = placeSkill(skill, answers)
  const rung = ladderStart(skill, answers)
  return {
    at,
    // The rep line starts where the caps allow, not where it was claimed.
    answers: {
      ...answers,
      ...(rung !== undefined ? { [ladderId(skill)]: rung } : {}),
      ...(skill === 'handstand' && answers[ladderId(skill)] === -1 ? { 'prep:hspu': 1 } : {}),
    },
    placedStepId: placement.stepId,
    confidence: placement.confidence,
    gapIds: placement.gaps.map((gap) => gap.id),
  }
}

/** The steps of a skill's road worth choosing as a destination: its last three. */
export function goalChoices(skill: SkillId): StepId[] {
  const steps = SKILLS[skill].steps
  return steps.slice(Math.max(1, steps.length - 3)).map((step) => step.id)
}
