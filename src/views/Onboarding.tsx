import { Button } from '../components/ds'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssessmentRecord, Profile, EquipmentId, SkillId, StepId, Units } from '../types'
import { normalizeStateWithReport, rebuildDerivedState, reportHasLosses, useStore } from '../lib/store'
import { readImportFile, validateImport } from '../lib/exportImport'
import { pushToast } from '../lib/toast'
import { ALL_STEPS, STEPS, STEP_BY_ID } from '../data/progressions'
import { EXERCISE_BY_ID } from '../data/exercises'
import { onlyWallMissing, WALL_TICK_HINT } from '../components/weekPlanCopy'
import { EQUIPMENT_OPTIONS, equipmentPhrase, kitNeedsPhrase } from '../data/equipment'
import { APP_NAME, APP_TAGLINE } from '../data/app'
import { missingKit, SKILL_LIST, SKILLS } from '../data/skills'
import { displayToKg, CM_PER_IN } from '../lib/units'
import type { Placement } from '../lib/assessment'
import { goalMovedNote, goalPastPlacement, interviewCounter, interviewLength, ladderStopNote, pruneBlockedAnswers, skillKitStanding } from '../lib/onboardingFlow'
import {
  goalChoices,
  nextInterviewItem,
  placementRecord,
  placeSkill,
  type InterviewAnswers,
} from '../lib/placement'
import { Icon } from '../components/Icon'
import { Figure } from '../components/Figure'
import { LocationEditor } from '../components/gym/LocationEditor'
import { AgeAndSafety } from '../components/plan/FitnessSetup'
import { GoalsEditor, MusclesEditor, ScheduleEditor } from '../components/plan/PlanSettings'
import {
  activeLocationFor,
  parseBirthYear,
  startingMinutesByDay,
  summariseSchedule,
} from '../components/plan/onboardingPlan'
import { conservative } from '../lib/gym/draft'
import { availableAt } from '../lib/gym/availability'
import { defaultGym, defaultPrefs, homeLocation, newLocation } from '../lib/gym/state'
import type { GymLocation, TrainingPrefs } from '../lib/gym/types'

/**
 * Onboarding, in the order the answers actually matter.
 *
 * Skills first — which of the five roads to train, in priority order, because
 * everything after it depends on the answer. Then the goal, because it is one
 * tap and it makes everything after it feel like it is about something. Then
 * the placement interview, which is the part that
 * earns its keep: the previous screen asked the athlete to pick which of five
 * descriptions sounded like them, and self-placement fails in both directions.
 * Place too high and every prescribed set is a failure; place too low and the
 * first month is spent re-earning something you already owned. Both cost weeks.
 *
 * The interview is skippable and ends the moment the answers stop being
 * plausible, so most people answer five or six questions. Skipping lands on the
 * old manual picker rather than a dead end.
 */

/** Only steps worth aiming at — the early ones are waypoints, not destinations. */
const GOAL_CHOICES: StepId[] = ['tuck', 'advtuck', 'straddle', 'full']

const GOAL_BLURB: Record<string, string> = {
  tuck: 'The first true planche. A realistic first destination for most people.',
  advtuck: 'Flat back, open hips — the posture every later planche is built on.',
  straddle: 'The one most people picture. Serious straight-arm strength.',
  full: 'Legs together, body level. The summit, and a multi-year project.',
}

/**
 * The first run, in the order Fitness Lab asks for: goals → skills (with their
 * destination and placement) → places and equipment → schedule and time →
 * muscle preferences → age and safety.
 */
type Stage =
  | 'welcome'
  | 'goals'
  | 'skills'
  | 'goal'
  | 'interview'
  | 'result'
  | 'places'
  | 'schedule'
  | 'muscles'
  | 'safety'

/** The progress the athlete sees: seven sections, the skills one spanning four screens. */
const SECTIONS = ['Welcome', 'Goals', 'Skills', 'Places', 'Schedule', 'Muscles', 'Age and safety'] as const
const SECTION_OF: Record<Stage, number> = {
  welcome: 0,
  goals: 1,
  skills: 2,
  goal: 2,
  interview: 2,
  result: 2,
  places: 3,
  schedule: 4,
  muscles: 5,
  safety: 6,
}

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th']

/**
 * How many questions the interview has, counting the ones already answered:
 * the fewest it can still end on and the most it can still run to.
 *
 * The two differ only while the planche ladder is open, because it stops at the
 * first hold answered "not yet". The counter used to add one rung to its total
 * with each rung cleared, so an interview of nineteen questions opened on "of
 * about 12" and read "of about 20" on its last. An upper bound is what can be
 * promised: it is never less than the question on screen, and an answer can
 * only bring it down.
 */
/** "planche, front lever and human flag" — skills named inside a sentence. */
function skillNames(skills: SkillId[]): string {
  const names = skills.map((skill) => SKILLS[skill].name.toLowerCase())
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const capitalised = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/**
 * A step's key hold, when the step's name alone does not say what it is:
 * every road opens on a step called "Foundations", so a plan for five skills
 * listed the same word five times.
 */
function holdBehind(stepId: StepId): string | undefined {
  const step = STEP_BY_ID[stepId]
  if (ALL_STEPS.filter((other) => other.name === step.name).length < 2) return undefined
  return EXERCISE_BY_ID[step.keyExerciseId]?.name.toLowerCase()
}

/** The self-declared fallback, kept for anyone who skips the interview. */
const PLACEMENTS: { stepId: StepId; label: string; desc: string }[] = [
  {
    stepId: 'foundations',
    label: 'Brand new to this',
    desc: 'Little or no bodyweight training yet. We start with wrists, scapula and core.',
  },
  {
    stepId: 'lean',
    label: 'Comfortable with push-ups & planks',
    desc: '10+ clean push-ups, a solid 45s plank. Straight into planche leans.',
  },
  {
    stepId: 'tuck',
    label: 'I can hold a frog stand',
    desc: '20–30s balancing on your hands. Time to chase the tuck planche.',
  },
  {
    stepId: 'advtuck',
    label: 'I have a 20s tuck planche',
    desc: 'Ready to flatten the back. Welcome to the grind.',
  },
  {
    stepId: 'straddle',
    label: 'Advanced tuck is mine',
    desc: '20s flat-back advanced tuck. Straddle work begins.',
  },
]

export function Onboarding() {
  const { dispatch, getState } = useStore()
  const restoreRef = useRef<HTMLInputElement | null>(null)
  const [restoring, setRestoring] = useState(false)
  /**
   * Start from a backup instead of from the interview — how an athlete moves
   * to a new phone, or from a browser tab to the installed app, which keeps
   * its own storage. Nothing is here to lose yet, so the file is applied as
   * soon as it checks out; the same validation and repair as Settings → Import.
   */
  const restore = async (file: File) => {
    setRestoring(true)
    try {
      const raw = await readImportFile(file)
      validateImport(raw)
      const { state: normalized, report } = normalizeStateWithReport(raw)
      const before = getState()
      dispatch({ type: 'IMPORT_REPLACE', state: rebuildDerivedState(normalized), expectedRev: before.rev ?? 0 })
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      if (getState().epoch === before.epoch) {
        pushToast('That backup could not be applied. Try picking the file again.', 'danger', 7000)
        return
      }
      const count = report.sessionsKept
      pushToast(
        `Backup restored — ${count} session${count === 1 ? '' : 's'}.${
          reportHasLosses(report) ? ' Some entries in the file could not be read and were left out.' : ''
        }`,
        'success',
        7000,
      )
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'That backup could not be read.', 'danger', 7000)
    } finally {
      setRestoring(false)
    }
  }
  const [stage, setStage] = useState<Stage>('welcome')
  const [name, setName] = useState('')
  /** The skills chosen, in the order they were picked: the first is the focus. */
  const [skills, setSkills] = useState<SkillId[]>([])
  const [goals, setGoals] = useState<Partial<Record<SkillId, StepId>>>({})
  const [answers, setAnswers] = useState<InterviewAnswers>({})
  const [skippedInterview, setSkippedInterview] = useState(false)
  const [manual, setManual] = useState<Partial<Record<SkillId, StepId>>>({})
  /** Which skill the manual picker is on, when the interview was skipped. */
  const [manualIndex, setManualIndex] = useState(0)
  /** Goal weights, muscles and the week: what Fitness Lab's setup writes to `gym.prefs`. */
  const [prefs, setPrefs] = useState<TrainingPrefs>(() => ({
    ...defaultPrefs(),
    // Worked out when the first run opens, so today is a training day even in a tab left open overnight.
    minutesByDay: startingMinutesByDay(),
  }))
  /** Gyms added here; Home is always the first place and takes the kit ticked below. */
  const [gyms, setGyms] = useState<GymLocation[]>([])
  const gymOnly = prefs.goals.skills === 0
  const [editing, setEditing] = useState<{ location: GymLocation; isNew: boolean } | null>(null)
  const [birthYear, setBirthYear] = useState('')
  const [ageDeclined, setAgeDeclined] = useState(false)
  const [bodyweightReminders, setBodyweightReminders] = useState(false)
  const [units, setUnits] = useState<Units>('metric')
  const [weight, setWeight] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [heightFt, setHeightFt] = useState('')
  const [heightIn, setHeightIn] = useState('')
  const [equipment, setEquipment] = useState<EquipmentId[]>(['floor'])
  const [injuryNote, setInjuryNote] = useState('')
  const [measurementError, setMeasurementError] = useState<string | null>(null)

  // Each stage is a page, and so is each interview question. Focus has to
  // follow, or a screen-reader user is left reading the previous screen with
  // no idea anything moved — and the whole ladder lives inside one `stage`,
  // so keying this on `stage` alone fired exactly once for eleven questions.
  const headingRef = useRef<HTMLDivElement | null>(null)

  const focus: SkillId = skills[0] ?? 'planche'
  const goalFor = (skill: SkillId): StepId => goals[skill] ?? (skill === 'planche' ? 'straddle' : SKILLS[skill].defaultGoal)
  const placements = useMemo(
    () => Object.fromEntries(skills.map((skill) => [skill, placeSkill(skill, answers)])) as Partial<Record<SkillId, Placement>>,
    [skills, answers],
  )
  const currentItem = useMemo(() => nextInterviewItem(skills, answers), [skills, answers])
  const questionCount = useMemo(() => interviewLength(skills, answers), [skills, answers])
  const questionNumber = Object.keys(answers).length + 1
  /** "Question 5 of up to 19" while the ladder is open, "Question 5 of 12" once the rest is certain (`interviewCounter`). */
  const questionProgress =
    interviewCounter({ stage: 'interview', skipped: false, answered: questionNumber - 1, shortest: questionCount.atLeast, longest: questionCount.atMost }) ?? ''
  /** Beside "Step 3 of 7": the placement's own progress on the goal screen and through the interview. */
  const placementCounter = interviewCounter({
    stage,
    skipped: skippedInterview,
    answered: questionNumber - 1,
    shortest: questionCount.atLeast,
    longest: questionCount.atMost,
  })

  useEffect(() => {
    headingRef.current?.focus()
  }, [stage, currentItem?.id, skippedInterview, manualIndex])
  const placedFor = (skill: SkillId): StepId =>
    skippedInterview ? (manual[skill] ?? SKILLS[skill].steps[0].id) : (placements[skill]?.stepId ?? SKILLS[skill].steps[0].id)
  const goalStepId = goalFor(focus)
  /** The destination that is kept: one the placement has already reached moves on, so the first screen never says "reached" at 0%. */
  const settledGoal = (skill: SkillId) => goalPastPlacement(skill, placedFor(skill), goalFor(skill))
  const finalGoalFor = (skill: SkillId): StepId => settledGoal(skill).goal
  /** Chosen skills whose road cannot be trained with the kit ticked so far. */
  const kitGaps = skills
    .map((skill) => ({ skill, missing: missingKit(skill, equipment.length ? equipment : ['floor']) }))
    .filter((gap) => gap.missing.length > 0)
  /**
   * Where each chosen skill can train once the places already added are counted: a gym with the bar and the wall
   * trains the lever and the handstand there. Only a skill that nothing the athlete has told the app about can
   * train is waiting (`skillKitStanding`).
   */
  const kitStanding = skillKitStanding(skills, equipment.length ? equipment : ['floor'], gyms)
  const waitingSkills = kitStanding.waiting.map((entry) => entry.skill)
  /**
   * The chosen skills that kit can train, in the order picked. Sessions are
   * built from these alone, and the first of them leads — which is the first
   * skill picked only while its own kit is ticked.
   */
  const trainable = skills.filter((skill) => !waitingSkills.includes(skill))
  const lead: SkillId = trainable[0] ?? focus
  /** The gym sessions will be built for, when one added here has gym kit and Home has none. */
  const startingGym = gyms.find((place) => place.id === activeLocationFor(homeLocation(equipment.length ? equipment : ['floor']), gyms))
  /** The week asked for, read as the two numbers the app keeps: a weekly goal and a typical session. */
  const schedule = summariseSchedule(prefs.minutesByDay)
  const named = (skill: SkillId) => SKILLS[skill].name.toLowerCase()
  const sharing = trainable.length > 1
    ? `${SKILLS[lead].name} is your first skill priority, followed by ${skillNames(trainable.slice(1))}. Your time, equipment and recovery determine which skill fits each day.`
    : trainable.length === 1 && skills.length > 1
      ? `${SKILLS[lead].name} can train with the equipment available.` : ''
  /** Which of the chosen skills are waiting for kit, and what that means for the sessions. */
  const waitingNote = waitingSkills.length
    ? `${capitalised(skillNames(waitingSkills))} ${waitingSkills.length === 1 ? 'is' : 'are'} waiting for kit${
        trainable.length
          ? ` and ${waitingSkills.length === 1 ? 'joins' : 'join'} your sessions once you have it`
          : ', so until you have it your sessions are support work only'
      } — ${
        kitStanding.waiting.every((entry) => onlyWallMissing(entry.missing))
          ? WALL_TICK_HINT
          : `your plan below says what ${waitingSkills.length === 1 ? 'it needs' : 'each needs'}.`
      }`
    : ''
  /** Skills home lacks the kit for that a place already added has it for: they train there. */
  const placeNote = kitStanding.atPlaces.length
    ? kitStanding.atPlaces
        .map(({ skill, places }) => `${capitalised(named(skill))} trains at ${places.length === 1 ? places[0] : `${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}`}, which has the kit.`)
        .join(' ')
    : ''

  const parsedWeight = (() => {
    const n = parseFloat(weight)
    const kg = Number.isFinite(n) && n > 0 ? displayToKg(n, units) : undefined
    return kg !== undefined && kg >= 20 && kg <= 400 ? kg : undefined
  })()
  const parsedHeight = (() => {
    if (units === 'metric') {
      const n = parseFloat(heightCm)
      return Number.isFinite(n) && n >= 100 && n <= 250 ? n : undefined
    }
    const ft = parseFloat(heightFt)
    const inchRaw = heightIn.trim()
    const inch = inchRaw === '' ? 0 : parseFloat(inchRaw)
    const cm =
      Number.isFinite(ft) && ft > 0 && Number.isFinite(inch) && inch >= 0 && inch < 12
        ? (ft * 12 + inch) * CM_PER_IN
        : undefined
    return cm !== undefined && cm >= 100 && cm <= 250 ? cm : undefined
  })()

  /** The birth year as typed, when it is one; "prefer not to say" is the same as none. */
  const year = ageDeclined ? undefined : parseBirthYear(birthYear)
  const careful = conservative({ birthYear: year } as Profile)
  /** Age is asked, not assumed: a year or "prefer not to say" (careful mode) before the end. */
  const ageAnswered = ageDeclined || year !== undefined

  /** Measurements are optional, but one that was typed has to be a real one. */
  const measurementProblem = (): string | null => {
    if (weight.trim() && parsedWeight === undefined) {
      return `Enter a bodyweight between ${units === 'metric' ? '20–400 kg' : '44–882 lb'}, or clear it.`
    }
    const heightEntered = units === 'metric' ? heightCm.trim() : heightFt.trim() || heightIn.trim()
    if (heightEntered && parsedHeight === undefined) {
      return units === 'metric'
        ? 'Enter a height between 100–250 cm, or clear it.'
        : 'Enter a realistic height (inches from 0 to under 12), or clear it.'
    }
    return null
  }

  const finish = () => {
    const problem = measurementProblem()
    if (problem) {
      setMeasurementError(problem)
      return
    }
    setMeasurementError(null)
    const chosen: SkillId[] = gymOnly ? [] : skills.length ? skills : ['planche']
    const homeKit: EquipmentId[] = equipment.length ? equipment : ['floor']
    const plancheChosen = chosen.includes('planche')
    const assessment: AssessmentRecord | undefined =
      skippedInterview || !plancheChosen ? undefined : placementRecord('planche', answers, Date.now())
    // The wrist answer is a joint report, not just a placement input: it has
    // to reach the first session's safety rails. It used to shape only the
    // placement copy, so "it hurts" at setup was followed by loaded planche work.
    const wristAnswer = skippedInterview ? undefined : answers.wrist
    const reportedAt = Date.now()
    dispatch({
      type: 'COMPLETE_ONBOARDING',
      symptoms:
        wristAnswer === 0
          ? [{ at: reportedAt, joints: 'pain', regions: ['wrist'], source: 'onboarding' }]
          : wristAnswer === 1
            ? [{ at: reportedAt, joints: 'niggle', regions: ['wrist'], source: 'onboarding' }]
            : [],
      name: name.trim(),
      // The top-level step is the planche's; without the planche it rests at its first step.
      stepId: plancheChosen ? placedFor('planche') : 'foundations',
      skills: chosen,
      placements: Object.fromEntries(
        chosen
          .filter((skill) => skill !== 'planche')
          .map((skill) => [
            skill,
            {
              stepId: placedFor(skill),
              goalStepId: finalGoalFor(skill),
              ...(skippedInterview ? {} : { assessment: placementRecord(skill, answers, reportedAt) }),
            },
          ]),
      ),
      // Read off the week the athlete laid out, never asked a second time.
      weeklyGoal: schedule.weeklyGoal,
      sessionMinutes: schedule.sessionMinutes,
      units,
      weightKg: parsedWeight,
      heightCm: parsedHeight,
      assessment,
      profile: {
        equipment: homeKit,
        preferredSurface: homeKit.includes('parallettes') ? 'parallettes' : 'floor',
        goalStepId: finalGoalFor('planche'),
        injuryNote: injuryNote.trim() || undefined,
        heightCm: parsedHeight,
        trainingAgeMonths: answers.experience,
        // COMPLETE_ONBOARDING replaces the profile, so the birth year travels in it.
        ...(year !== undefined ? { birthYear: year } : {}),
      },
    })
    // What Fitness Lab's setup writes, in its order: the places first (Home
    // carries the kit above), then which one is in use, then the plan itself.
    // Everything lands in this one handler, so Today's first render already has
    // `gym.prefs` and shows no "Set up Fitness Lab" card.
    const gymUnit = units === 'imperial' ? 'lb' : 'kg'
    dispatch({ type: 'GYM', op: { op: 'init', gym: defaultGym(homeKit, gymUnit) } })
    for (const place of gyms) dispatch({ type: 'GYM', op: { op: 'saveLocation', location: place } })
    const active = activeLocationFor(homeLocation(homeKit, gymUnit), gyms)
    if (active !== 'home') dispatch({ type: 'GYM', op: { op: 'setActiveLocation', id: active } })
    const { updatedAt: _stamp, ...planPrefs } = prefs
    void _stamp
    dispatch({ type: 'GYM', op: { op: 'setPrefs', prefs: planPrefs } })
    if (bodyweightReminders) dispatch({ type: 'SET_SETTINGS', patch: { trackBodyweight: true } })
  }

  const sections: readonly (typeof SECTIONS)[number][] = gymOnly ? SECTIONS.filter((s) => s !== 'Skills') : SECTIONS
  const sectionIndex = sections.indexOf(SECTIONS[SECTION_OF[stage]])
  // The header counts the seven setup steps and nothing else: the screens inside Skills used to be counted
  // in it too ("2 of up to 19", "13 of 19", "16 of 16"). The interview counts its own questions.
  const progressText = `Step ${sectionIndex + 1} of ${sections.length} · ${sections[sectionIndex]}${placementCounter ? ` · ${placementCounter}` : ''}`
  // The primary action: big, last in the row, within thumb reach. Back is quiet.
  const primaryBtn = 'min-h-[52px] flex-1'
  const backBtn =
    'ds-press min-h-[52px] rounded-control px-5 text-body font-medium text-ink2 hover:text-ink'
  const actionRow =
    'sticky bottom-0 z-10 -mx-5 mt-6 flex gap-2 border-t border-line bg-bg px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3'

  return (
    <div className="app-ambient grain fixed inset-0 z-50 overflow-y-auto bg-bg">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center px-5 py-10">
        <div className="mb-8">
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${sections.length}, minmax(0, 1fr))` }}
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={1}
            aria-valuemax={sections.length}
            aria-valuenow={sectionIndex + 1}
            aria-valuetext={progressText}
          >
            {sections.map((section, i) => (
              <span
                key={section}
                className={`h-1 rounded-full transition-colors duration-300 ${i <= sectionIndex ? 'bg-accent' : 'bg-line-strong'}`}
              />
            ))}
          </div>
          <div className="mt-2 text-center text-caption font-medium text-ink3 tnum" aria-hidden="true">
            {progressText}
          </div>
        </div>
        {/* Carries the question, not only the stage: the whole ladder lives
            inside one stage, so a region that only said "Step 3 of 7" went
            silent for every question after the first. */}
        <div className="sr-only" aria-live="polite">
          {stage === 'interview' && currentItem && !skippedInterview ? `${questionProgress}. ${currentItem.question}` : progressText}
        </div>

        {stage === 'welcome' ? (
          <div className="animate-rise text-center" ref={headingRef} tabIndex={-1}>
            <div
              className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-card text-on-accent shadow-card bg-accent"

            >
              <Figure step="full" className="h-10 w-12" />
            </div>
            <h1 className="font-display text-display font-bold text-ink">{APP_NAME}</h1>
            <p className="mx-auto mt-2 max-w-md text-body leading-relaxed text-ink2">{APP_TAGLINE}</p>
            {/* Both halves, plainly: nothing the athlete records goes anywhere,
                and the checker is fetched from two outside hosts on first use
                (poseBackend's WASM_BASE and MODEL_URL). "No server" said the
                first and hid the second. */}
            <p className="mx-auto mt-2 max-w-md text-footnote leading-relaxed text-ink3">
              No account, nothing to cancel. What you log and film stays on this device — none of it is uploaded. The
              camera form checker is downloaded the first time you use it, from Google’s file hosting and jsDelivr, and
              then runs here.
            </p>
            <div className="mx-auto mt-7 max-w-sm text-left">
              <label htmlFor="ob-name" className="text-footnote font-medium text-ink2">
                What should we call you? (optional)
              </label>
              <input
                id="ob-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="mt-1.5 w-full rounded-inner border border-line bg-surface px-4 py-3.5 text-body text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
            </div>
            <Button
              onClick={() => setStage('goals')}
              className={`${primaryBtn} mx-auto mt-6 w-full max-w-sm`}
            >
              Let's go <Icon name="arrowR" size={17} />
            </Button>
            <input
              ref={restoreRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void restore(file)
                e.target.value = ''
              }}
            />
            <button
              onClick={() => restoreRef.current?.click()}
              disabled={restoring}
              className="mx-auto mt-3 block min-h-11 px-3 py-2 text-footnote font-medium text-ink2 underline-offset-2 hover:text-ink hover:underline disabled:opacity-60"
            >
              {restoring ? 'Reading the backup…' : 'I have a backup file'}
            </button>
          </div>
        ) : null}

        {stage === 'goals' ? (
          <div className="animate-rise">
            <h1 ref={headingRef} tabIndex={-1} className="text-center font-display text-[26px] font-bold text-ink outline-none">
              What are you training for?
            </h1>
            <p className="mt-1 text-center text-body leading-relaxed text-ink2">
              Give each goal a weight from Off to 5. Fitness Lab plans the gym and your skills together, and these decide
              how a day is shared between them. You can change them any time in Goals and schedule.
            </p>
            <div className="mt-6">
              <GoalsEditor prefs={prefs} setPrefs={setPrefs} />
            </div>
            <div className={actionRow}>
              <button onClick={() => setStage('welcome')} className={backBtn}>
                Back
              </button>
              <Button onClick={() => {
                if (gymOnly) {
                  setSkills([])
                  setAnswers({})
                }
                setStage(gymOnly ? 'places' : 'skills')
              }} className={primaryBtn}>
                Continue <Icon name="arrowR" size={16} />
              </Button>
            </div>
          </div>
        ) : null}

        {stage === 'skills' ? (
          <div className="animate-rise">
            <h1 ref={headingRef} tabIndex={-1} className="text-center font-display text-[26px] font-bold text-ink outline-none">
              What do you want to train?
            </h1>
            <p className="mt-1 text-center text-body leading-relaxed text-ink2">
              Pick your most important skill first. Your week can include dedicated skill days, skill practice before lifting, and gym days. You can change the order later.
            </p>
            <div className="mt-6 space-y-2.5" role="group" aria-label="Skills to train">
              {SKILL_LIST.map((def) => {
                const position = skills.indexOf(def.id)
                const active = position >= 0
                const summit = def.steps[def.steps.length - 1].id
                return (
                  <button
                    key={def.id}
                    aria-pressed={active}
                    aria-label={`${def.name}${active ? `, ${ORDINAL[position]} priority` : ''}: ${def.tagline}`}
                    onClick={() => {
                      setSkills((current) => (active ? current.filter((id) => id !== def.id) : [...current, def.id]))
                      // Answers given for a different set of skills place a
                      // different athlete: start the interview over.
                      setAnswers({})
                      setSkippedInterview(false)
                      setManualIndex(0)
                    }}
                    className={`flex w-full items-center gap-4 rounded-inner border p-4 text-left transition ${
                      active ? 'border-accent bg-accent-soft shadow-card' : 'border-line bg-surface hover:border-line-strong'
                    }`}
                  >
                    <Figure step={summit} className={`h-14 w-[70px] shrink-0 ${active ? 'text-accent-text' : 'text-ink2'}`} />
                    <div className="min-w-0">
                      <div className="text-body font-semibold text-ink">{def.name}</div>
                      <div className="mt-0.5 text-footnote leading-relaxed text-ink2">{def.tagline}</div>
                      <div className="mt-1 text-caption leading-relaxed text-ink3">
                        {def.requires.length ? `Needs ${kitNeedsPhrase(def.requires)}` : 'Floor space is enough'}
                      </div>
                    </div>
                    <span
                      className={`ml-auto grid h-7 min-w-7 shrink-0 place-items-center rounded-full border-2 px-1.5 text-caption font-bold ${
                        active ? 'border-accent bg-accent text-on-accent' : 'border-line-strong text-transparent'
                      }`}
                    >
                      {active ? ORDINAL[position] : '·'}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-center text-footnote leading-relaxed text-ink3" aria-live="polite">
              {skills.length === 0
                ? 'Choose at least one.'
                : skills.length === 1
                  ? `${SKILLS[focus].name} is your skill priority.`
                  : `Your skill priorities, in order: ${skillNames(skills)}.`}
            </p>
            <div className={actionRow}>
              <button onClick={() => setStage('goals')} className={backBtn}>
                Back
              </button>
              <Button
                onClick={() => setStage('goal')}
                disabled={skills.length === 0}
                className={`${primaryBtn} disabled:opacity-50`}
              >
                Continue <Icon name="arrowR" size={16} />
              </Button>
            </div>
          </div>
        ) : null}

        {stage === 'goal' ? (
          <div className="animate-rise">
            <h1 ref={headingRef} tabIndex={-1} className="text-center font-display text-[26px] font-bold text-ink outline-none">
              What are you chasing?
            </h1>
            <p className="mt-1 text-center text-body text-ink2">
              {skills.length > 1
                ? `The destination on your main skill, ${SKILLS[focus].name.toLowerCase()} — not your starting point. Your other skills aim at the top of their roads until you say otherwise.`
                : 'This sets your destination, not your starting point. You can change it any time.'}
            </p>
            <div className="mt-6 space-y-2.5" role="group" aria-label="Training goal">
              {(focus === 'planche' ? GOAL_CHOICES : goalChoices(focus)).map((id) => {
                const step = STEP_BY_ID[id]
                const active = goalStepId === id
                return (
                  <button
                    key={id}
                    aria-pressed={active}
                    aria-label={`${step.name}: ${GOAL_BLURB[id] ?? step.tagline}`}
                    onClick={() => setGoals((current) => ({ ...current, [focus]: id }))}
                    className={`flex w-full items-center gap-4 rounded-inner border p-4 text-left transition ${
                      active ? 'border-accent bg-accent-soft shadow-card' : 'border-line bg-surface hover:border-line-strong'
                    }`}
                  >
                    <Figure step={id} className={`h-14 w-[70px] shrink-0 ${active ? 'text-accent-text' : 'text-ink2'}`} />
                    <div className="min-w-0">
                      <div className="text-body font-semibold text-ink">{step.name}</div>
                      <div className="mt-0.5 text-footnote leading-relaxed text-ink2">{GOAL_BLURB[id] ?? step.tagline}</div>
                    </div>
                    <span
                      className={`ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
                        active ? 'border-accent bg-accent text-on-accent' : 'border-line-strong'
                      }`}
                    >
                      {active ? <Icon name="check" size={13} strokeWidth={3} /> : null}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className={actionRow}>
              <button onClick={() => setStage('skills')} className={backBtn}>
                Back
              </button>
              <Button onClick={() => setStage('interview')} className={primaryBtn}>
                Continue <Icon name="arrowR" size={16} />
              </Button>
            </div>
          </div>
        ) : null}

        {stage === 'interview' ? (
          skippedInterview ? (
            <ManualPlacement
              // One screen per chosen skill, in priority order.
              key={skills[manualIndex] ?? focus}
              headingRef={headingRef}
              skill={skills[manualIndex] ?? focus}
              several={skills.length > 1}
              placement={placedFor(skills[manualIndex] ?? focus)}
              onPick={(id) => setManual((current) => ({ ...current, [skills[manualIndex] ?? focus]: id }))}
              onBack={() => {
                if (manualIndex > 0) {
                  setManualIndex(manualIndex - 1)
                  return
                }
                setSkippedInterview(false)
                setAnswers({})
                setStage('goal')
              }}
              onContinue={() => {
                if (manualIndex < skills.length - 1) setManualIndex(manualIndex + 1)
                else setStage('result')
              }}
              primaryBtn={primaryBtn}
              backBtn={backBtn}
            />
          ) : currentItem ? (
            <div className="animate-rise">
              <div className="text-center">
                <div className="text-footnote font-semibold uppercase tracking-wider text-accent-text">
                  {questionProgress}
                </div>
                <h1
                  ref={headingRef}
                  tabIndex={-1}
                  className="mt-1 font-display text-[23px] font-bold leading-snug text-ink outline-none"
                >
                  {currentItem.question}
                </h1>
                {currentItem.standard ? (
                  <p className="mx-auto mt-2 max-w-md text-footnote leading-relaxed text-ink2">
                    {currentItem.standard}
                  </p>
                ) : null}
                {ladderStopNote(answers) ? <p className="mx-auto mt-2 max-w-md text-caption leading-relaxed text-ink3">{ladderStopNote(answers)}</p> : null}
              </div>
              {/* Not a radiogroup. These options are *actions* — tapping one
                  answers and immediately advances, so nothing is ever left
                  "selected", and announcing "radio, not checked" for every
                  option describes a control that does not exist. A plain list
                  of buttons is what they are. */}
              <div className="mt-6 space-y-2.5" role="group" aria-label={currentItem.question}>
                {currentItem.options.map((opt) => (
                  <button
                    // Keyed by question *and* option: consecutive rungs share
                    // option labels ("Not yet", "1–4s", …), so a label-only key
                    // let React reuse the DOM node across questions. Focus then
                    // stayed on the button just pressed while the question
                    // silently changed underneath it, and a double-press or a
                    // held key answered the *next* question with the same value
                    // — which, since clearing a rung is what surfaces the next
                    // one, placed the athlete a whole step high. Exactly the
                    // failure this interview exists to prevent.
                    key={`${currentItem.id}:${opt.label}`}
                    aria-label={opt.hint ? `${opt.label}. ${opt.hint}` : opt.label}
                    onClick={() => {
                      // Advance here rather than in an effect: the ladder ends
                      // the moment an answer makes the next question
                      // unnecessary, and that is knowable synchronously from
                      // the answer just given.
                      const next = pruneBlockedAnswers({ ...answers, [currentItem.id]: opt.value })
                      setAnswers(next)
                      if (nextInterviewItem(skills, next) === null) setStage('result')
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-inner border border-line bg-surface p-4 text-left transition hover:border-accent hover:bg-accent-soft"
                  >
                    <span className="min-w-0">
                      <span className="block text-body font-medium text-ink">{opt.label}</span>
                      {opt.hint ? <span className="mt-0.5 block text-footnote text-ink2">{opt.hint}</span> : null}
                    </span>
                    <Icon name="chevronR" size={16} className="shrink-0 text-ink3" />
                  </button>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <button
                  onClick={() => {
                    const asked = Object.keys(answers)
                    if (asked.length === 0) {
                      setStage('goal')
                      return
                    }
                    const next = { ...answers }
                    delete next[asked[asked.length - 1]]
                    setAnswers(next)
                  }}
                  className="ds-press min-h-11 rounded-control border border-line bg-surface px-4 text-footnote font-medium text-ink2 hover:text-ink"
                >
                  Back
                </button>
                <button
                  onClick={() => {
                    setSkippedInterview(true)
                    setManualIndex(0)
                    setAnswers({})
                  }}
                  className="min-h-11 px-1 text-footnote font-medium text-ink3 underline underline-offset-4 hover:text-ink"
                >
                  Skip — I'll pick my own level
                </button>
              </div>
              <p className="mt-4 text-center text-caption leading-relaxed text-ink3">
                Answer honestly rather than optimistically — the holds you claim here are timed for real in your first
                sessions. Placed a step low, a filmed clean hold at the bar moves you up; placed a step high, the first
                weeks go on holds you cannot keep clean.
              </p>
            </div>
          ) : null
        ) : null}

        {stage === 'result' ? (
          <div className="animate-rise">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-center font-display text-[26px] font-bold text-ink outline-none"
            >
              {skippedInterview ? 'Your starting point' : "Here's where you start"}
            </h1>
            {skills.map((skill, index) => {
              const def = SKILLS[skill]
              const stepId = placedFor(skill)
              const placement = placements[skill]
              const several = skills.length > 1
              return (
                <section key={skill} className={index ? 'mt-5' : 'mt-5'} aria-label={def.name}>
                  <div className="rounded-inner border border-line bg-surface p-5 shadow-card">
                    {several ? (
                      <div className="mb-2 text-caption font-bold uppercase tracking-wider text-accent-text">
                        {def.name}
                        {index === 0 ? ' · leads your sessions' : ''}
                      </div>
                    ) : null}
                    <div className="flex items-center gap-4">
                      <Figure step={stepId} className="h-16 w-20 shrink-0 text-accent-text" />
                      <div className="min-w-0">
                        <div className="font-display text-[20px] font-bold text-ink">{STEP_BY_ID[stepId].name}</div>
                        <div className="text-footnote text-ink2">{STEP_BY_ID[stepId].tagline}</div>
                      </div>
                    </div>
                    {settledGoal(skill).moved ? (
                      <p className="mt-3 text-footnote font-medium leading-relaxed text-ink">
                        {goalMovedNote(STEP_BY_ID[finalGoalFor(skill)].name, STEP_BY_ID[stepId].name)}
                      </p>
                    ) : null}
                    <p className="mt-3 text-footnote leading-relaxed text-ink2">
                      {skippedInterview || !placement
                        ? 'You picked this yourself, so the app treats it as a starting guess and nothing more. Your first filmed sets are what confirm it.'
                        : placement.reason}
                    </p>
                    {!skippedInterview && placement ? (
                      <div className="mt-3 flex items-center gap-2 rounded-control border border-line bg-raised px-3 py-2">
                        <Icon
                          name={placement.confidence === 'good' ? 'check' : 'info'}
                          size={15}
                          className={placement.confidence === 'good' ? 'text-ok-text' : 'text-ink3'}
                        />
                        <span className="text-footnote leading-relaxed text-ink2">
                          {placement.confidence === 'good'
                            ? 'Your answers were consistent, so this is a confident starting point — still provisional until a filmed set backs it up.'
                            : placement.confidence === 'moderate'
                              ? 'A reasonable starting point from what you told us. The first sessions will confirm or correct it.'
                              : 'Low confidence — either the answers were thin or some of them disagreed. Expect the first week to adjust this.'}
                        </span>
                      </div>
                    ) : null}
                    {skill !== 'planche' ? (
                      <details className="mt-3 rounded-control border border-line bg-raised px-3 py-2">
                        <summary className="cursor-pointer text-footnote font-semibold text-ink">
                          Worth knowing before you train {def.holdName === 'handstand' ? 'upside down' : `the ${def.holdName}`}
                        </summary>
                        <ul className="mt-2 space-y-1.5">
                          {def.safety.map((line) => (
                            <li key={line} className="text-footnote leading-relaxed text-ink2">
                              {line}
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-caption leading-relaxed text-ink3">{def.sourcing}</p>
                      </details>
                    ) : null}
                  </div>

                  {placement && placement.inconsistencies.length > 0 && !skippedInterview ? (
                    <div className="mt-3 rounded-inner border border-danger/30 bg-danger-soft p-4">
                      <div className="text-footnote font-semibold text-ink">Worth double-checking</div>
                      <ul className="mt-1.5 space-y-1">
                        {placement.inconsistencies.map((t) => (
                          <li key={t} className="text-footnote leading-relaxed text-ink2">
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {placement && placement.caveats.length > 0 && !skippedInterview ? (
                    <div className="mt-3 space-y-2">
                      {placement.caveats.map((t) => (
                        <div key={t} className="rounded-inner border border-line bg-surface p-4 text-footnote leading-relaxed text-ink2">
                          {t}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {placement && placement.gaps.length > 0 && !skippedInterview ? (
                    <div className="mt-3 rounded-inner border border-line bg-surface p-4">
                      <div className="text-footnote font-semibold text-ink">What will actually limit you</div>
                      <p className="mt-0.5 text-footnote text-ink3">
                        Not blockers — these get built into your sessions from day one.
                      </p>
                      <ul className="mt-2 space-y-2">
                        {placement.gaps.map((g) => (
                          <li key={g.id}>
                            <div className="text-footnote font-medium text-ink">{g.label}</div>
                            <div className="text-footnote leading-relaxed text-ink2">{g.detail}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>
              )
            })}

            <div className={actionRow}>
              <button
                onClick={() => {
                  // Going back into a *finished* interview would render an
                  // empty screen, because there is no next question to ask.
                  // Drop the last answer so the final question reappears.
                  if (!skippedInterview) {
                    const asked = Object.keys(answers)
                    if (asked.length > 0) {
                      const next = { ...answers }
                      delete next[asked[asked.length - 1]]
                      setAnswers(next)
                    }
                  } else {
                    setManualIndex(Math.max(0, skills.length - 1))
                  }
                  setStage('interview')
                }}
                className={backBtn}
              >
                Back
              </button>
              <Button onClick={() => setStage('places')} className={primaryBtn}>
                Looks right <Icon name="arrowR" size={16} />
              </Button>
            </div>
          </div>
        ) : null}

        {stage === 'places' && editing ? (
          <div className="animate-rise">
            <h1 ref={headingRef} tabIndex={-1} className="sr-only">
              {editing.isNew ? 'Add a gym' : 'Edit a gym'}
            </h1>
            <button onClick={() => setEditing(null)} className={`${backBtn} -ml-3`}>
              Cancel
            </button>
            <LocationEditor
              location={editing.location}
              canDelete={!editing.isNew}
              onSave={(saved) => {
                setGyms((current) =>
                  editing.isNew ? [...current, saved] : current.map((place) => (place.id === saved.id ? saved : place)),
                )
                setEditing(null)
              }}
              onDelete={() => {
                setGyms((current) => current.filter((place) => place.id !== editing.location.id))
                setEditing(null)
              }}
            />
          </div>
        ) : null}

        {stage === 'places' && !editing ? (
          <div className="animate-rise">
            <h1 ref={headingRef} tabIndex={-1} className="text-center font-display text-[26px] font-bold text-ink outline-none">
              Where do you train?
            </h1>
            <p className="mt-1 text-center text-body leading-relaxed text-ink2">
              Each place keeps its own equipment, so a session only uses what is there. Tick what you have at home, and add a
              gym if you use one. All optional, all stays on your device.
            </p>

            <div className="mt-5 flex items-center justify-between gap-3 rounded-inner border border-line bg-surface p-4">
              <span id="ob-units" className="text-footnote font-medium text-ink2">
                Weights and measurements in
              </span>
              <div className="flex overflow-hidden rounded-control border border-line" role="group" aria-labelledby="ob-units">
                {(['metric', 'imperial'] as const).map((u) => (
                  <button
                    key={u}
                    aria-pressed={units === u}
                    onClick={() => setUnits(u)}
                    className={`min-h-11 px-4 text-footnote font-medium transition ${
                      units === u ? 'bg-accent text-on-accent' : 'bg-surface text-ink2 hover:text-ink'
                    }`}
                  >
                    {u === 'metric' ? 'kg / cm' : 'lb / ft'}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-3 rounded-inner border border-line bg-surface p-4">
              <div className="text-footnote font-medium text-ink2" id="ob-equipment">
                At home — what do you have to train with?
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-labelledby="ob-equipment">
                {EQUIPMENT_OPTIONS.map((eq) => {
                  const on = equipment.includes(eq.id)
                  return (
                    <button
                      key={eq.id}
                      aria-pressed={on}
                      onClick={() => setEquipment((v) => (on ? v.filter((x) => x !== eq.id) : [...v, eq.id]))}
                      className={`min-h-11 rounded-full border px-3.5 text-footnote font-medium transition ${
                        on ? 'border-transparent bg-accent text-on-accent' : 'border-line bg-raised text-ink2'
                      }`}
                    >
                      {eq.label}
                    </button>
                  )
                })}
              </div>
              {equipment.length ? (
                <ul className="mt-2 space-y-1">
                  {EQUIPMENT_OPTIONS.filter((eq) => equipment.includes(eq.id) && eq.hint).map((eq) => (
                    <li key={eq.id} className="text-caption leading-relaxed text-ink3">
                      <span className="font-medium text-ink2">{eq.label}</span>: {eq.hint}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-caption leading-relaxed text-ink3">
                  Pick everything you can get to — sessions substitute around what is missing.
                </p>
              )}
              {kitGaps.length ? (
                <div className="mt-3 space-y-2" role="status">
                  {kitGaps.map(({ skill, missing }) => (
                    <div key={skill} className="rounded-control border border-accent/30 bg-accent-soft px-3 py-2.5">
                      <p className="text-footnote leading-relaxed text-ink">
                        <span className="font-semibold">{SKILLS[skill].name}</span> needs {kitNeedsPhrase(missing)}.
                        Without it at home this skill waits in your list
                        {trainable.length ? ` and ${trainable.length === 1 ? 'your other skill trains' : 'your other skills train'} as normal` : ''}{' '}
                        — tick it if you have it. A gym that has it counts too: you add your places next.
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {missing.flat().map((id) => (
                          <button
                            key={id}
                            onClick={() => setEquipment((v) => (v.includes(id) ? v : [...v, id]))}
                            className="min-h-11 rounded-lg border border-line bg-surface px-2.5 py-1 text-left text-caption font-semibold text-ink hover:border-line-strong"
                          >
                            I have {equipmentPhrase(id)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-3 rounded-inner border border-line bg-surface p-4">
              <div className="text-footnote font-medium text-ink2">Gyms</div>
              {gyms.length ? (
                <ul className="mt-2 space-y-2">
                  {gyms.map((place) => (
                    <li key={place.id}>
                      <button
                        onClick={() => setEditing({ location: place, isNew: false })}
                        className="ds-press flex min-h-14 w-full items-center justify-between rounded-inner border border-line px-4 text-left"
                      >
                        <span>
                          <span className="block text-body font-semibold text-ink">{place.name}</span>
                          <span className="block text-caption text-ink3">
                            {place.equipment.length} pieces of kit · {availableAt(place).length} exercises · {place.unit}
                          </span>
                        </span>
                        <span className="text-footnote font-medium text-accent-text">Edit</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-caption leading-relaxed text-ink3">
                  None yet. Without one, gym sessions are built from what you have at home.
                </p>
              )}
              <Button
                variant="secondary"
                full
                className="mt-3"
                onClick={() => setEditing({ location: newLocation('Gym', units === 'imperial' ? 'lb' : 'kg'), isNew: true })}
              >
                <Icon name="plus" size={15} /> Add a gym
              </Button>
              <p className="mt-2 text-caption leading-relaxed text-ink3">
                {startingGym
                  ? `Gym sessions will be built for ${startingGym.name}, since Home has no gym equipment. You can switch places on the Gym tab.`
                  : 'A gym that has gym equipment becomes the place sessions are built for, because Home has none. You can switch on the Gym tab.'}
              </p>
            </div>

            <div className={actionRow}>
              <button onClick={() => setStage(gymOnly ? 'goals' : 'result')} className={backBtn}>
                Back
              </button>
              <Button onClick={() => setStage('schedule')} className={primaryBtn}>
                Continue <Icon name="arrowR" size={16} />
              </Button>
            </div>
          </div>
        ) : null}

        {stage === 'schedule' ? (
          <div className="animate-rise">
            <h1 ref={headingRef} tabIndex={-1} className="text-center font-display text-[26px] font-bold text-ink outline-none">
              When can you train?
            </h1>
            <p className="mt-1 text-center text-body leading-relaxed text-ink2">
              Set the minutes you have on each day, and add the sport you already play. Your weekly goal and session length
              come from this week, so there is nothing else to set.
            </p>
            <div className="mt-6 space-y-6">
              <ScheduleEditor prefs={prefs} setPrefs={setPrefs} />
            </div>
            <div className="mt-5 rounded-inner border border-line bg-surface p-4" role="status">
              {schedule.days === 0 ? (
                <p className="text-footnote leading-relaxed text-ink2">
                  Give at least one day some minutes to continue — a day left on Rest is not trained.
                </p>
              ) : (
                <>
                  <p className="text-footnote font-semibold text-ink">
                    {schedule.days} training day{schedule.days === 1 ? '' : 's'} a week, about {schedule.typicalMinutes} minutes on a typical one.
                  </p>
                  <p className="mt-1 text-caption leading-relaxed text-ink3">
                    Your weekly goal is {schedule.weeklyGoal} and your usual session is {schedule.sessionMinutes} minutes.
                    You can change both in Settings.
                    {sharing ? ` ${sharing}` : ''}
                    {placeNote ? ` ${placeNote}` : ''}
                    {waitingNote ? ` ${waitingNote}` : ''}
                  </p>
                </>
              )}
            </div>
            <div className={actionRow}>
              <button onClick={() => setStage('places')} className={backBtn}>
                Back
              </button>
              <Button onClick={() => setStage('muscles')} disabled={schedule.days === 0} className={`${primaryBtn} disabled:opacity-50`}>
                Continue <Icon name="arrowR" size={16} />
              </Button>
            </div>
          </div>
        ) : null}

        {stage === 'muscles' ? (
          <div className="animate-rise">
            <h1 ref={headingRef} tabIndex={-1} className="text-center font-display text-[26px] font-bold text-ink outline-none">
              Any muscles to favour or leave out?
            </h1>
            <p className="mt-1 text-center text-body leading-relaxed text-ink2">
              Optional. Leave everything on normal and the gym spreads the work evenly.
            </p>
            <div className="mt-6">
              <MusclesEditor prefs={prefs} setPrefs={setPrefs} />
            </div>
            <div className="text-center">
              <button
                onClick={() => {
                  setPrefs((p) => ({ ...p, musclesOff: [], musclesPriority: [] }))
                  setStage('safety')
                }}
                className="min-h-11 px-3 text-footnote font-medium text-ink3 underline underline-offset-4 hover:text-ink"
              >
                Skip — keep every muscle normal
              </button>
            </div>
            <div className={actionRow}>
              <button onClick={() => setStage('schedule')} className={backBtn}>
                Back
              </button>
              <Button onClick={() => setStage('safety')} className={primaryBtn}>
                Continue <Icon name="arrowR" size={16} />
              </Button>
            </div>
          </div>
        ) : null}

        {stage === 'safety' ? (
          <div className="animate-rise">
            <h1 ref={headingRef} tabIndex={-1} className="text-center font-display text-[26px] font-bold text-ink outline-none">
              Age and safety
            </h1>
            <p className="mt-1 text-center text-body leading-relaxed text-ink2">
              The last step. Your age sets how careful the plan is; the rest is optional.
            </p>
            <div className="mt-6">
              <AgeAndSafety
                birthYear={birthYear}
                setBirthYear={setBirthYear}
                careful={careful}
                ageKnown={year !== undefined}
                bodyweight={bodyweightReminders}
                setBodyweight={setBodyweightReminders}
                declined={ageDeclined}
                onDecline={setAgeDeclined}
              />
            </div>

            <label className="mt-3 block rounded-inner border border-line bg-surface p-4">
              <span className="text-footnote font-medium text-ink2">Anything currently sore or injured?</span>
              <input
                value={injuryNote}
                aria-label="Anything currently sore or injured?"
                onChange={(e) => setInjuryNote(e.target.value)}
                placeholder="e.g. left wrist a bit cranky — or leave blank"
                className="mt-1.5 w-full rounded-control border border-line bg-raised px-3 py-2.5 text-body text-ink outline-none placeholder:text-ink3 focus:border-accent"
              />
              <span className="mt-1 block text-caption text-ink3">
                Kept as a note so it is in front of you. If something hurts on a training day, say so in the check-in —
                that is what changes the plan. Pain that is still there the next day, or swelling, needs qualified
                medical advice.
              </span>
            </label>

            <details className="mt-3 rounded-inner border border-line bg-surface p-4">
              <summary className="min-h-11 cursor-pointer text-footnote font-medium text-ink2">
                Bodyweight and height (optional)
              </summary>
              <p className="mt-1 text-caption leading-relaxed text-ink3">
                Never required, and nothing in the plan depends on them. They are kept as a first entry in your progress,
                in {units === 'metric' ? 'kg and cm' : 'lb and ft'} — change the units on the Places step.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-footnote font-medium text-ink2">Bodyweight ({units === 'metric' ? 'kg' : 'lb'})</span>
                  <input
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    inputMode="decimal"
                    placeholder={units === 'metric' ? '70' : '155'}
                    className="mt-1.5 min-h-11 w-full rounded-control border border-line bg-raised px-3 text-body text-ink outline-none placeholder:text-ink3 focus:border-accent"
                  />
                </label>
                <div>
                  <span className="text-footnote font-medium text-ink2" id="ob-height">
                    Height
                  </span>
                  {units === 'metric' ? (
                    <input
                      value={heightCm}
                      onChange={(e) => setHeightCm(e.target.value)}
                      inputMode="decimal"
                      placeholder="175"
                      aria-labelledby="ob-height"
                      className="mt-1.5 min-h-11 w-full rounded-control border border-line bg-raised px-3 text-body text-ink outline-none placeholder:text-ink3 focus:border-accent"
                    />
                  ) : (
                    <div className="mt-1.5 flex gap-2">
                      <input
                        value={heightFt}
                        onChange={(e) => setHeightFt(e.target.value)}
                        inputMode="numeric"
                        placeholder="5"
                        aria-label="Height, feet"
                        className="min-h-11 w-full rounded-control border border-line bg-raised px-3 text-body text-ink outline-none placeholder:text-ink3 focus:border-accent"
                      />
                      <input
                        value={heightIn}
                        onChange={(e) => setHeightIn(e.target.value)}
                        inputMode="numeric"
                        placeholder="9"
                        aria-label="Height, inches"
                        className="min-h-11 w-full rounded-control border border-line bg-raised px-3 text-body text-ink outline-none placeholder:text-ink3 focus:border-accent"
                      />
                    </div>
                  )}
                </div>
              </div>
            </details>

            <div className="mt-3 rounded-inner border border-line bg-surface p-4 text-left">
              <div className="text-footnote font-semibold uppercase tracking-wide text-ink3">Your plan</div>
              {gymOnly ? <p className="mt-2 text-body font-semibold">Gym training · {schedule.days} {schedule.days === 1 ? 'day' : 'days'} a week</p> : null}
              {skills.map((skill) => {
                const from = STEP_BY_ID[placedFor(skill)]
                const to = STEP_BY_ID[finalGoalFor(skill)]
                const stepsToGo = Math.max(0, to.order - from.order)
                const missing = kitStanding.waiting.find((entry) => entry.skill === skill)?.missing
                const trainsAt = kitStanding.atPlaces.find((entry) => entry.skill === skill)?.places
                const several = skills.length > 1
                // "Foundations" is the first step of every road: say which hold it is.
                const hold = holdBehind(from.id)
                return (
                  <div key={skill} className={`flex items-center gap-3 ${several ? 'mt-3' : 'mt-1.5'}`}>
                    <Figure step={from.id} className="h-12 w-16 shrink-0 text-accent-text" />
                    <div className="min-w-0">
                      {/* With several skills each row is headed by its skill
                          and names where that skill starts. */}
                      <div className="font-display text-title3 font-semibold text-ink">
                        {several ? SKILLS[skill].name : from.name}
                      </div>
                      {several || hold ? (
                        <div className="text-footnote text-ink">
                          {several ? `Starts at ${from.name}` : 'Key hold'}
                          {hold ? `${several ? ' — ' : ': '}${hold}` : ''}
                        </div>
                      ) : null}
                      <div className="text-footnote text-ink2">
                        {trainsAt
                          ? `Trains at ${trainsAt.length === 1 ? trainsAt[0] : `${trainsAt.slice(0, -1).join(', ')} and ${trainsAt[trainsAt.length - 1]}`} — the kit it needs is there. At home it waits for that kit.`
                          : missing
                          ? `Waiting for ${kitNeedsPhrase(missing)} at home — it joins your sessions once that is on your equipment list, or a place you add next has it.`
                          : stepsToGo === 0
                            ? `Placed at your goal: ${to.name}`
                            : `Aiming at ${to.name} · ${stepsToGo} step${stepsToGo === 1 ? '' : 's'} to go`}
                      </div>
                    </div>
                  </div>
                )
              })}
              <p className="mt-2.5 text-footnote leading-relaxed text-ink3">
                {gymOnly ? 'Your first workout uses the equipment at your training place. Log reps, weight and effort to set your next targets.' :
                  'Your first skill sessions help the coach adjust the starting plan to what you can do.'}
              </p>
            </div>

            {measurementError ? (
              <p className="mt-3 text-center text-footnote text-danger-text" role="alert">
                {measurementError}
              </p>
            ) : null}
            {!ageAnswered ? (
              <p className="mt-3 text-center text-footnote text-ink3" role="status">
                Add your birth year, or choose “Prefer not to say” — the plan then stays in careful mode.
              </p>
            ) : null}
            <div className={actionRow}>
              <button onClick={() => setStage('muscles')} className={backBtn}>
                Back
              </button>
              <Button onClick={finish} disabled={!ageAnswered} className={primaryBtn}>
                <Icon name="bolt" size={17} /> Start training
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ManualPlacement({
  headingRef,
  skill,
  several,
  placement,
  onPick,
  onBack,
  onContinue,
  primaryBtn,
  backBtn,
}: {
  headingRef: React.RefObject<HTMLDivElement | null>
  skill: SkillId
  /** More than one skill was chosen, so the heading names which this is. */
  several: boolean
  placement: StepId
  onPick: (id: StepId) => void
  onBack: () => void
  onContinue: () => void
  primaryBtn: string
  backBtn: string
}) {
  // The planche keeps its described levels; every other road lists its own steps.
  const choices =
    skill === 'planche'
      ? PLACEMENTS
      : SKILLS[skill].steps.map((step) => ({ stepId: step.id, label: step.name, desc: step.tagline }))
  return (
    <div className="animate-rise">
      <h1 ref={headingRef} tabIndex={-1} className="text-center font-display text-[26px] font-bold text-ink outline-none">
        {several ? `${SKILLS[skill].name}: where are you starting?` : 'Where are you starting?'}
      </h1>
      <p className="mt-1 text-center text-body text-ink2">
        Honest placement beats ambitious placement — you can test up any time.
      </p>
      <div className="mt-6 space-y-2.5" role="group" aria-label="Starting step">
        {choices.map((p) => {
          const active = placement === p.stepId
          return (
            <button
              key={p.stepId}
              aria-pressed={active}
              aria-label={`${p.label}: ${p.desc}`}
              onClick={() => onPick(p.stepId)}
              className={`flex w-full items-center gap-4 rounded-inner border p-4 text-left transition ${
                active ? 'border-accent bg-accent-soft shadow-card' : 'border-line bg-surface hover:border-line-strong'
              }`}
            >
              <Figure step={p.stepId} className={`h-14 w-[70px] shrink-0 ${active ? 'text-accent-text' : 'text-ink2'}`} />
              <div className="min-w-0">
                <div className="text-body font-semibold text-ink">{p.label}</div>
                <div className="mt-0.5 text-footnote leading-relaxed text-ink2">{p.desc}</div>
              </div>
              <span
                className={`ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 ${
                  active ? 'border-accent bg-accent text-on-accent' : 'border-line-strong'
                }`}
              >
                {active ? <Icon name="check" size={13} strokeWidth={3} /> : null}
              </span>
            </button>
          )
        })}
      </div>
      <div className="sticky bottom-0 z-10 -mx-5 mt-6 flex gap-2 border-t border-line bg-bg px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <button onClick={onBack} className={backBtn}>
          Back
        </button>
        <Button onClick={onContinue} className={primaryBtn}>
          Continue <Icon name="arrowR" size={16} />
        </Button>
      </div>
    </div>
  )
}

/** Every step the road contains, for the Path screen's manual override. */
export const ALL_STEP_IDS: StepId[] = STEPS.map((s) => s.id)
