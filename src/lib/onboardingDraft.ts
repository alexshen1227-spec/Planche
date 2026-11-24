import { SKILL_IDS, type EquipmentId, type SkillId, type StepId, type Units } from '../types'
import { EQUIPMENT_OPTIONS } from '../data/equipment'
import { SKILLS, isRepGoal } from '../data/skills'
import { startingMinutesByDay } from '../components/plan/onboardingPlan'
import { defaultPrefs, homeLocation, sanitizeLocation, sanitizePrefs } from './gym/state'
import type { GymLocation, TrainingPrefs } from './gym/types'
import { nextInterviewItem, type InterviewAnswers } from './placement'
import { SETUP_DRAFT_KEY } from './store'

const STAGES = ['welcome', 'goals', 'skills', 'goal', 'interview', 'result', 'places', 'schedule', 'muscles', 'safety'] as const
export type SetupStage = typeof STAGES[number]
type StepsBySkill = Partial<Record<SkillId, StepId>>

export interface SetupDraft {
  stage: SetupStage
  name: string
  skills: SkillId[]
  goals: StepsBySkill
  pressGoals: Partial<Record<SkillId, string>>
  answers: InterviewAnswers
  wristReport?: { answer: number; at: number }
  skippedInterview: boolean
  manual: StepsBySkill
  manualIndex: number
  prefs: TrainingPrefs
  home?: GymLocation
  gyms: GymLocation[]
  editing: { location: GymLocation; isNew: boolean } | null
  birthYear: string
  ageDeclined: boolean
  bodyweightReminders: boolean
  units: Units
  weight: string
  heightCm: string
  heightFt: string
  heightIn: string
  equipment: EquipmentId[]
  injuryNote: string
}

export function setupHome(draft: Pick<SetupDraft, 'equipment' | 'units' | 'home'>): GymLocation {
  const kit: EquipmentId[] = draft.equipment.length ? draft.equipment : ['floor']
  if (!draft.home) return homeLocation(kit, draft.units === 'imperial' ? 'lb' : 'kg')
  const weights = draft.home.equipment.filter((id) => !EQUIPMENT_OPTIONS.some((item) => item.id === id))
  return { ...draft.home, equipment: [...kit, ...weights] }
}

export function newSetupDraft(): SetupDraft {
  return {
    stage: 'welcome', name: '', skills: [], goals: {}, pressGoals: {}, answers: {},
    skippedInterview: false, manual: {}, manualIndex: 0,
    prefs: { ...defaultPrefs(), minutesByDay: startingMinutesByDay() },
    gyms: [], editing: null, birthYear: '', ageDeclined: false, bodyweightReminders: false,
    units: 'metric', weight: '', heightCm: '', heightFt: '', heightIn: '', equipment: ['floor'], injuryNote: '',
  }
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const stringOf = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : ''

function skillSteps(value: unknown): StepsBySkill {
  const fields = record(value)
  const result: StepsBySkill = {}
  for (const skill of SKILL_IDS) {
    const step = SKILLS[skill].steps.find((item) => item.id === fields[skill])
    if (step) result[skill] = step.id
  }
  return result
}

/** Only answers reachable through the current interview can place an athlete. */
function readAnswers(skills: SkillId[], value: unknown): InterviewAnswers {
  const fields = record(value)
  const answers: InterviewAnswers = {}
  if (!skills.length) return answers
  let question = nextInterviewItem(skills, answers)
  while (question) {
    const answer = fields[question.id]
    if (typeof answer !== 'number' || !question.options.some((opt) => opt.value === answer)) break
    answers[question.id] = answer
    question = nextInterviewItem(skills, answers)
  }
  return answers
}

export function loadSetupDraft(epoch: string | undefined): SetupDraft | null {
  if (!epoch) return null
  try {
    const json = localStorage.getItem(SETUP_DRAFT_KEY)
    if (!json) return null
    const envelope = record(JSON.parse(json))
    if (envelope.v !== 1 || envelope.epoch !== epoch) return null
    const d = record(envelope.draft)
    let stage = STAGES.find((value) => value === d.stage)
    if (!stage) return null
    const base = newSetupDraft()
    const prefs = sanitizePrefs(d.prefs) ?? base.prefs
    const skills = Array.isArray(d.skills) ? [...new Set(d.skills.filter((id): id is SkillId => SKILL_IDS.includes(id)))] : []
    const answers = readAnswers(skills, d.answers)
    const wrist = record(d.wristReport)
    const wristReport = typeof wrist.answer === 'number' && [0, 1, 2].includes(wrist.answer) &&
      typeof wrist.at === 'number' && Number.isFinite(wrist.at) && wrist.at > 0 && wrist.at <= Date.now()
      ? { answer: wrist.answer, at: wrist.at } : undefined
    const skippedInterview = d.skippedInterview === true
    if (prefs.goals.skills === 0 && ['skills', 'goal', 'interview', 'result'].includes(stage)) stage = 'places'
    if (prefs.goals.skills > 0 && !skills.length && !['welcome', 'goals'].includes(stage)) stage = 'skills'
    if (!skippedInterview && skills.length) {
      if (stage === 'result' && nextInterviewItem(skills, answers)) stage = 'interview'
      else if (stage === 'interview' && !nextInterviewItem(skills, answers)) stage = 'result'
    }
    const pressGoals: SetupDraft['pressGoals'] = {}
    for (const skill of SKILL_IDS) {
      const id = record(d.pressGoals)[skill]
      if (isRepGoal(skill, id)) pressGoals[skill] = id
    }
    const gyms: GymLocation[] = []
    if (Array.isArray(d.gyms)) {
      for (const item of d.gyms) {
        const place = sanitizeLocation(item)
        if (place && place.id !== 'home' && !gyms.some((g) => g.id === place.id)) gyms.push(place)
      }
    }
    const edit = record(d.editing)
    const place = stage === 'places' ? sanitizeLocation(edit.location) : null
    const home = sanitizeLocation(d.home)
    const existing = place?.id === 'home' || gyms.some((g) => g.id === place?.id)
    const editing = place && (edit.isNew === true) !== existing
      ? { location: { ...place, name: stringOf(record(edit.location).name, 40) }, isNew: edit.isNew === true }
      : null
    const equipment = Array.isArray(d.equipment)
      ? [...new Set(d.equipment.filter((id): id is EquipmentId => EQUIPMENT_OPTIONS.some((o) => o.id === id)))]
      : base.equipment
    return {
      stage, name: stringOf(d.name, 100), skills, goals: skillSteps(d.goals), pressGoals, answers, skippedInterview,
      ...(wristReport ? { wristReport } : {}),
      manual: skillSteps(d.manual),
      manualIndex: typeof d.manualIndex === 'number' && Number.isInteger(d.manualIndex) ? Math.max(0, Math.min(d.manualIndex, skills.length - 1)) : 0,
      prefs, gyms, editing, ...(home?.id === 'home' ? { home } : {}), birthYear: stringOf(d.birthYear, 8), ageDeclined: d.ageDeclined === true,
      bodyweightReminders: d.bodyweightReminders === true, units: d.units === 'imperial' ? 'imperial' : 'metric',
      weight: stringOf(d.weight, 32), heightCm: stringOf(d.heightCm, 32), heightFt: stringOf(d.heightFt, 32),
      heightIn: stringOf(d.heightIn, 32), equipment, injuryNote: stringOf(d.injuryNote, 2000),
    }
  } catch { return null }
}

export function saveSetupDraft(epoch: string, draft: SetupDraft): boolean {
  try {
    localStorage.setItem(SETUP_DRAFT_KEY, JSON.stringify({ v: 1, epoch, draft }))
    return true
  } catch { return false }
}
