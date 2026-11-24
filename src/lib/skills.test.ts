import { describe, expect, it } from 'vitest'
import type { AppState, Session, SetLog, SkillId } from '../types'
import { SKILL_IDS } from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { EQUIPMENT_OPTIONS } from '../data/equipment'
import { ALL_STEPS, STEP_BY_ID, skillOfStep, stepAfter, stepForKeyExercise, stepsOf } from '../data/progressions'
import { missingKit, SKILL_LIST, SKILLS, skillOfExercise, trainableSkills } from '../data/skills'
import { ACHIEVEMENTS } from '../data/achievements'
import { buildSampleState } from '../data/sample'
import { GUIDE_GROUPS, GUIDES, skillGuide } from '../data/learn'
import { BASIS_LABEL, TIPS, tipOfTheDay } from '../data/tips'
import {
  challengeBlockedReason,
  finalizeWorkoutWithPlan,
  planForToday,
  TEMPLATE_SKILLS,
  TEMPLATES,
  templatesFor,
} from '../data/workouts'
import { debriefSession } from './coach'
import { niggleRegionsToday, painReportedIn } from './signals'
import { autoFromResult, issuesFor, mergeHumanReview } from '../components/FormCheckRow'
import { bridgeStatus, capacityOn } from './bridge'
import { adaptiveTarget } from './workingTarget'
import { applySession } from './engine'
import { figureBounds, figureParts } from './figure'
import { filmedExercises, filmedExercisesFor, readFormTrends } from './formTrend'
import { readJourney } from './journey'
import { daysSinceFullPart, fullParts, lineupFor, roomIn, rolesTrained, shortDoses, todaysLineup } from './lineup'
import { LEVER_FRACTION } from './loading'
import {
  goalChoices,
  interviewProgress,
  ladderId,
  ladderStart,
  levelId,
  nextInterviewItem,
  placementRecord,
  placeSkill,
} from './placement'
import { coarseElbow, judgeTrackedFrames, POSE_PROFILES } from './poseForm'
import { IDEAL, synthesizeClip } from './poseSynth'
import {
  ARMS_PROMPT,
  athleteConfirmationLabel,
  athleteConfirmationPrompt,
  athleteConfirmed,
  cleanEvidence,
  FLIGHT_PROMPT,
  isQualifyingSet,
  isReviewOnly,
  passesProgressionFormCheck,
  progressionCredit,
  requiresArmsConfirmation,
  requiresFlightConfirmation,
  REVIEW_PROMPT,
  VARIANT_CRITICAL,
} from './progression'
import {
  ladderOfExercise,
  ladderStatus,
  repSetsToReview,
  rungInPlay,
  rungOutcome,
  rungsOpenedBy,
  verifiedReps,
  standardsMet,
  withRepCount,
} from './repLadder'
import { shareCardData, shareCardLines } from './shareCard'
import {
  activeSkills,
  assistAppliesTo,
  currentStepForExercise,
  isSkillHold,
  isSkillWork,
  isSurfaceAware,
  skillView,
  stepOfSkill,
  trackOf,
  trackedSkills,
  wholeState,
} from './skills'
import { startingState } from './skillLoop'
import { initialState, mergeExternalState, normalizeState, rebuildDerivedState, reducer } from './store'
import { weekWork, workSets } from './volume'

const DAY = 86_400_000
const T0 = new Date(2026, 0, 5, 18, 0).getTime()

/** A filmed, confirmed, passing hold — the evidence an unlock asks for. */
function verifiedHold(exerciseId: string, sec: number, at: number, extra: Partial<SetLog> = {}): SetLog {
  return {
    exerciseId,
    kind: 'hold',
    value: sec,
    target: sec,
    section: 'main',
    at,
    endReason: 'effort',
    form: {
      rating: 'clean',
      confirmed: true,
      flightConfirmed: true,
      armsConfirmed: true,
      visualReviewPassed: true,
      auto: { issues: [], confidence: 0.9, score: 92, cleanSeconds: sec, cleanRatio: 1 },
    },
    ...extra,
  }
}

function sessionOf(state: AppState, at: number, sets: SetLog[], id = `s-${at}`): Session {
  const notes: NonNullable<Session['skills']> = {}
  for (const skill of trackedSkills(state)) if (skill !== 'planche') notes[skill] = { stepId: trackOf(state, skill).stepId }
  return {
    id,
    startedAt: at,
    endedAt: at + 30 * 60_000,
    workoutName: 'Test session',
    workoutKind: 'auto',
    stepId: state.stepId,
    sets,
    ...(Object.keys(notes).length ? { skills: notes } : {}),
  }
}

describe('the skill registry', () => {
  it('describes five skills, each a complete road', () => {
    expect(SKILL_LIST.map((def) => def.id)).toEqual([...SKILL_IDS])
    for (const def of SKILL_LIST) {
      const where = def.id
      expect(def.steps.length, where).toBeGreaterThanOrEqual(4)
      expect(def.steps.map((step) => step.order), where).toEqual(def.steps.map((_, i) => i))
      expect(def.steps.every((step) => step.skill === def.id), where).toBe(true)
      expect(def.steps.some((step) => step.id === def.defaultGoal), where).toBe(true)
      // Words every screen prints: none may be empty.
      for (const text of [def.name, def.short, def.holdName, def.tagline, def.blurb, def.sourcing, def.frequency, def.camera.placement, def.camera.honesty]) {
        expect(text.trim().length, `${where}: an empty description`).toBeGreaterThanOrEqual(3)
      }
      expect(def.prerequisites.length, where).toBeGreaterThan(0)
      expect(def.safety.length, where).toBeGreaterThan(0)
      for (const step of def.steps) {
        const key = EXERCISE_BY_ID[step.keyExerciseId]
        expect(key, `${step.id}: missing key exercise`).toBeDefined()
        expect(key.type, step.id).toBe('hold')
        // A step's key hold is its road's work, whatever it is filed under in
        // the catalogue — the planche's Foundations hold sits with the scapula
        // drills, and was once not counted as planche training at all.
        expect(skillOfExercise(step.keyExerciseId), step.id).toBe(def.id)
        expect(isSkillHold(key), step.id).toBe(true)
        expect(isSkillWork(key), step.id).toBe(true)
        expect(step.startSec, step.id).toBeLessThan(step.unlockSec)
        expect(step.formChecks.length && step.mistakes.length, step.id).toBeGreaterThan(0)
      }
    }
  })

  it('gives every step an id no other road uses, and finds its road from it', () => {
    const ids = ALL_STEPS.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const step of ALL_STEPS) {
      expect(skillOfStep(step.id)).toBe(step.skill)
      expect(STEP_BY_ID[step.id]).toBe(step)
      expect(stepForKeyExercise(step.keyExerciseId)?.id).toBe(step.id)
      const next = stepAfter(step.id)
      // The road ends at its own summit, never on another skill's first step.
      if (next) expect(next.skill).toBe(step.skill)
    }
    for (const skill of SKILL_IDS) expect(stepAfter(stepsOf(skill)[stepsOf(skill).length - 1].id)).toBeUndefined()
  })

  it('programmes only movements that exist, with kit that can be listed', () => {
    const kit = new Set(EQUIPMENT_OPTIONS.map((option) => option.id))
    for (const def of SKILL_LIST) {
      for (const options of def.requires) for (const id of options) expect(kit.has(id), `${def.id} needs unknown kit ${id}`).toBe(true)
      for (const exercise of def.exercises) {
        for (const id of exercise.requires ?? []) expect(kit.has(id), `${exercise.id} needs unknown kit ${id}`).toBe(true)
      }
      if (!def.program) continue
      const specs = [
        ...def.program.warmup,
        ...def.program.cooldown,
        ...Object.values(def.program.steps).flatMap((program) =>
          program
            ? [program.twin, program.strength, program.support, program.balance, program.assisted, program.transition, program.mobility, ...program.core]
            : [],
        ),
      ].filter((spec): spec is NonNullable<typeof spec> => Boolean(spec))
      for (const spec of specs) {
        expect(EXERCISE_BY_ID[spec.exerciseId], `${def.id} programmes unknown ${spec.exerciseId}`).toBeDefined()
        expect(spec.sets).toBeGreaterThan(0)
        expect(spec.amount).toBeGreaterThan(0)
      }
      // Every step has a session shape of its own.
      for (const step of def.steps) expect(def.program.steps[step.id], `${step.id} has no session shape`).toBeDefined()
    }
  })

  it('has a rep ladder for the two skills with a push-up line, on movements that exist', () => {
    expect(SKILL_LIST.filter((def) => def.ladder).map((def) => def.id)).toEqual(['handstand', 'ninety'])
    for (const def of SKILL_LIST) {
      for (const rung of def.ladder?.rungs ?? []) {
        expect(EXERCISE_BY_ID[rung.exerciseId]?.type, rung.exerciseId).toBe('reps')
        expect(rung.standardReps).toBeGreaterThanOrEqual(rung.startReps > rung.standardReps ? rung.standardReps : 1)
        // A gate is a real step: on the skill's own road, or — where the
        // movement starts in a handstand — on the handstand's.
        if (rung.needsStep) expect([def.id, 'handstand'], `${rung.exerciseId} waits for ${rung.needsStep}`).toContain(STEP_BY_ID[rung.needsStep].skill)
      }
    }
  })
})

describe('what the camera can and cannot grade, per hold', () => {
  const keyHolds = ALL_STEPS.map((step) => step.keyExerciseId)

  it('films every key hold: a measured profile, or an honest replay review', () => {
    for (const id of keyHolds) {
      const profile = POSE_PROFILES[id]
      expect(profile, `${id} has no camera profile`).toBeDefined()
      // The two lists are one rule: no checks means the athlete's review is the evidence.
      expect(isReviewOnly(id), id).toBe(Boolean(profile.noChecks))
      if (profile.noChecks) expect(REVIEW_PROMPT[id], `${id} has no review checklist`).toBeTruthy()
      else expect(IDEAL[id], `${id} has no textbook rep to test against`).toBeDefined()
    }
  })

  it('asks for the confirmation only the athlete can give, on every unsupported hold', () => {
    for (const id of Object.keys(FLIGHT_PROMPT)) {
      expect(EXERCISE_BY_ID[id], id).toBeDefined()
      expect(requiresFlightConfirmation(id)).toBe(true)
    }
    // A hold with the feet on the floor, the wall or the pole has nothing to confirm.
    for (const id of ['planche-lean', 'wall-plank', 'wall-handstand', 'bent-arm-lean-hold', 'supported-flag', 'active-hang']) {
      expect(requiresFlightConfirmation(id), id).toBe(false)
    }
    for (const [id, critical] of Object.entries(VARIANT_CRITICAL)) {
      expect(EXERCISE_BY_ID[id], id).toBeDefined()
      expect(critical.criteria.length && critical.prompt.length, id).toBeGreaterThan(0)
    }
  })

  it('asks the athlete for the lockout wherever the camera can only see a large bend', () => {
    // One rule, two lists: every graded straight-arm hold the judge reads
    // coarsely asks for the confirmation, and nothing else does.
    const coarse = Object.entries(POSE_PROFILES)
      .filter(([, profile]) => !profile.noChecks && profile.minElbowDeg !== undefined && coarseElbow(profile))
      .map(([id]) => id)
      .sort()
    expect(Object.keys(ARMS_PROMPT).sort()).toEqual(coarse)
    expect(coarse.length).toBeGreaterThanOrEqual(12)
    for (const id of coarse) {
      expect(EXERCISE_BY_ID[id], id).toBeDefined()
      expect(requiresArmsConfirmation(id), id).toBe(true)
      expect(athleteConfirmationPrompt(id), id).toMatch(/elbow|arms/i)
      expect(athleteConfirmationLabel(id), id).toMatch(/elbows|arms/i)
    }
    // The planche family and the 90° holds are read side-on on the hands, to
    // within a few degrees: the camera's own word stands, as it always has.
    for (const id of ['planche-lean', 'tuck-planche', 'full-planche', 'ninety-hold', 'elbow-lever', 'frog-stand']) {
      expect(requiresArmsConfirmation(id), id).toBe(false)
    }
    expect(athleteConfirmationLabel('tuck-planche')).toBe('Feet stayed off the floor')
    // One button says everything a hold needs said.
    expect(athleteConfirmationLabel('front-lever')).toBe('Hung free, elbows locked')
    expect(athleteConfirmationLabel('wall-handstand')).toBe('Elbows stayed locked')
    expect(athleteConfirmationLabel('freestanding-handstand')).toBe('Clear of the wall, elbows locked')
    expect(athleteConfirmationLabel('human-flag')).toBe('Hands only, both arms straight')
  })

  it('does not count a lever, a handstand or a flag on the camera alone', () => {
    const at = T0
    for (const id of ['tuck-front-lever', 'front-lever', 'wall-handstand', 'freestanding-handstand', 'tuck-flag', 'human-flag']) {
      const full = verifiedHold(id, 12, at)
      expect(isQualifyingSet(full, id), id).toBe(true)
      // The camera passed it and the athlete called it clean and unsupported —
      // and that used to be enough, on arms the camera cannot see bend.
      const noArms = verifiedHold(id, 12, at)
      delete noArms.form!.armsConfirmed
      expect(passesProgressionFormCheck(noArms.form, id), id).toBe(false)
      expect(isQualifyingSet(noArms, id), id).toBe(false)
      expect(athleteConfirmed(noArms.form, id), id).toBe(false)
      expect(athleteConfirmed(full.form, id), id).toBe(true)
    }
    // A support hold never needed it and still does not.
    const planche = verifiedHold('tuck-planche', 12, at)
    delete planche.form!.armsConfirmed
    expect(isQualifyingSet(planche, 'tuck-planche')).toBe(true)

    // The confirmation is the athlete's and only for a hold they called clean.
    const confirmed = mergeHumanReview(undefined, { rating: 'clean', issues: [], flightConfirmed: true, armsConfirmed: true })
    expect(confirmed.armsConfirmed).toBe(true)
    const slipped = mergeHumanReview(confirmed, { rating: 'slipped', issues: ['sag'], flightConfirmed: true, armsConfirmed: true })
    expect(slipped.armsConfirmed).toBeUndefined()
    expect(slipped.flightConfirmed).toBeUndefined()
  })

  it('never words a coarse elbow reading as locked arms', () => {
    for (const [id, bend] of [
      ['front-lever', 28],
      ['tuck-front-lever', 28],
      ['wall-handstand', 24],
      ['freestanding-handstand', 24],
      ['human-flag', 16],
    ] as const) {
      // Arms bent well short of what the camera can call in this position.
      const result = judgeTrackedFrames(synthesizeClip({ ...IDEAL[id], elbowBendDeg: bend, seed: 3, noise: 0.015 }), id)
      expect(result.ok, id).toBe(true)
      expect(result.issues, id).not.toContain('arms')
      const coarse = POSE_PROFILES[id].legsTogether ? ['elbows', 'leg position'] : ['elbows']
      expect(result.coarse, id).toEqual(coarse)
      const labels = (result.subscores ?? []).map((s) => s.label)
      expect(labels, id).not.toContain('Straight arms')
      expect(labels, id).not.toContain('Verified clean')
      expect(labels, id).toContain('Shape held')
      expect(result.good.join(' '), id).not.toMatch(/locked/i)
      // Stored, and read back as a window that leaves the arms out.
      const auto = autoFromResult(result, 5)
      expect(auto.coarse, id).toEqual(coarse)
      const evidence = cleanEvidence(auto)
      expect(evidence.state, id).toBe('verified')
      expect(evidence.state === 'verified' && evidence.armsUnmeasured, id).toBe(true)
      // And it survives being saved and loaded.
      const state = startingState({ skills: ['planche', 'frontlever', 'handstand', 'flag'] })
      const saved = normalizeState(
        JSON.parse(
          JSON.stringify({
            ...state,
            sessions: [sessionOf(state, T0, [verifiedHold(id, 6, T0, { form: { rating: 'clean', confirmed: true, flightConfirmed: true, armsConfirmed: true, auto } })])],
          }),
        ),
      )
      expect(saved.sessions[0].sets[0].form?.auto?.coarse, id).toEqual(coarse)
      expect(saved.sessions[0].sets[0].form?.armsConfirmed, id).toBe(true)
    }
    // A bend the camera can stand behind is still named, scored and blocks credit.
    const bent = judgeTrackedFrames(synthesizeClip({ ...IDEAL['front-lever'], elbowBendDeg: 60, seed: 3, noise: 0.015 }), 'front-lever')
    expect(bent.issues).toContain('arms')
    const elbow = bent.subscores?.find((s) => s.key === 'elbow')
    expect(elbow?.score ?? 100).toBeLessThan(85)
    expect(cleanEvidence(autoFromResult(bent, 5)).state).toBe('fault')
    // Side-on on the hands nothing changed: a number for the arms, and "verified".
    const planche = judgeTrackedFrames(synthesizeClip({ ...IDEAL['tuck-planche'], seed: 3, noise: 0.015 }), 'tuck-planche')
    const plancheLabels = (planche.subscores ?? []).map((s) => s.label)
    expect(plancheLabels).toContain('Straight arms')
    expect(plancheLabels).toContain('Verified clean')
    expect(planche.coarse).toBeUndefined()
    const plancheEvidence = cleanEvidence(autoFromResult(planche, 5))
    expect(plancheEvidence.state === 'verified' && plancheEvidence.armsUnmeasured).toBeFalsy()
    // A damaged list is not quietly dropped: that would turn it back into a pass.
    const state = startingState({ skills: ['planche', 'frontlever'] })
    const raw = JSON.parse(
      JSON.stringify({
        ...state,
        sessions: [sessionOf(state, T0, [verifiedHold('front-lever', 6, T0)])],
      }),
    )
    raw.sessions[0].sets[0].form.auto.coarse = 'elbows'
    expect(normalizeState(raw).sessions[0].sets[0].form?.auto?.malformed).toBe(true)
  })

  it('carries a judged clip all the way to progression credit, and a faulty one nowhere', () => {
    // The season evals hand the engine a perfect reading, so nothing there ever
    // ran the judge and the progression gate together for the new skills. Here
    // the reading is the judge's own, from a clip of known shape.
    const graded = ALL_STEPS.map((step) => step.keyExerciseId).filter((id) => !isReviewOnly(id) && skillOfExercise(id) !== 'planche')
    expect(graded.length).toBeGreaterThanOrEqual(14)
    let bentJudged = 0
    for (const id of graded) {
      const profile = POSE_PROFILES[id]
      const held = (form: SetLog['form']): SetLog => ({ exerciseId: id, kind: 'hold', value: 5, target: 5, section: 'main', at: T0, endReason: 'effort', form })
      const clean = judgeTrackedFrames(synthesizeClip({ ...IDEAL[id], seed: 7, noise: 0.015 }), id)
      expect(clean.ok, `${id}: ${clean.reason}`).toBe(true)
      expect(clean.issues, id).toEqual([])
      const confirmed = { rating: 'clean' as const, confirmed: true, flightConfirmed: true, armsConfirmed: true, variantConfirmed: true, auto: autoFromResult(clean, 5) }
      if (profile.legsTogether) expect(isQualifyingSet(held({ ...confirmed, variantConfirmed: false }), id)).toBe(false)
      expect(isQualifyingSet(held(confirmed), id), id).toBe(true)
      expect(progressionCredit(held(confirmed), id), id).toBeGreaterThan(3)
      // The camera's pass is never the whole of it.
      expect(isQualifyingSet(held({ ...confirmed, confirmed: false }), id), `${id}: a suggestion nobody confirmed`).toBe(false)
      expect(isQualifyingSet(held({ ...confirmed, rating: 'slipped' }), id), `${id}: rated slipped`).toBe(false)
      if (requiresFlightConfirmation(id)) {
        expect(progressionCredit(held({ ...confirmed, flightConfirmed: undefined }), id), `${id}: support not confirmed`).toBe(0)
      }
      if (requiresArmsConfirmation(id)) {
        expect(progressionCredit(held({ ...confirmed, armsConfirmed: undefined }), id), `${id}: lockout not confirmed`).toBe(0)
      }
      // Arms that are plainly wrong earn nothing, whatever the athlete confirms.
      const wrong = profile.elbowTargetDeg !== undefined ? { elbowBendDeg: 30 } : { elbowBendDeg: 65 }
      const bent = judgeTrackedFrames(synthesizeClip({ ...IDEAL[id], ...wrong, seed: 7, noise: 0.015 }), id)
      // (Bent that far, a wall plank is no longer an incline at all, and is refused instead.)
      if (!bent.ok) continue
      bentJudged += 1
      expect(bent.issues.some((issue) => issue === 'arms' || issue === 'angle'), `${id}: ${bent.issues.join(',')}`).toBe(true)
      expect(progressionCredit(held({ ...confirmed, auto: autoFromResult(bent, 5) }), id), `${id}: bent arms`).toBe(0)
    }
    expect(bentJudged).toBeGreaterThanOrEqual(graded.length - 2)
    // A lever with the hips hanging low is named and earns nothing.
    for (const id of graded.filter((key) => POSE_PROFILES[key].posture === 'hang')) {
      const low = judgeTrackedFrames(synthesizeClip({ ...IDEAL[id], hipOffset: -0.7, seed: 7, noise: 0.015 }), id)
      expect(low.issues, id).toContain('sag')
      const form = { rating: 'clean' as const, confirmed: true, flightConfirmed: true, armsConfirmed: true, auto: autoFromResult(low, 5) }
      expect(progressionCredit({ exerciseId: id, kind: 'hold', value: 5, target: 5, section: 'main', at: T0, form }, id), id).toBe(0)
    }
    // An ordinary plank or a lean is not a handstand, however it is filmed.
    for (const pose of ['ppp-hold', 'planche-lean', 'tuck-planche']) {
      for (const id of ['wall-plank', 'wall-handstand', 'freestanding-handstand']) {
        const result = judgeTrackedFrames(synthesizeClip({ ...IDEAL[pose], seed: 7, noise: 0.015 }), id)
        expect(result.ok && result.issues.length === 0, `${pose} judged as ${id}`).toBe(false)
      }
    }
  })

  it('offers each skill its own faults, in its own words, and only where the shape can have them', () => {
    const labels = (id: string) => issuesFor(id).map((issue) => issue.id)
    expect(labels('front-lever')).toEqual(expect.arrayContaining(['arms', 'sag', 'pike', 'closed', 'knees']))
    expect(labels('freestanding-handstand')).toEqual(expect.arrayContaining(['arms', 'shoulders', 'closed', 'knees']))
    expect(labels('ninety-hold')).toEqual(expect.arrayContaining(['angle', 'sag', 'pike']))
    expect(labels('human-flag')).toEqual(expect.arrayContaining(['arms', 'tilt', 'closed', 'knees']))
    // A tuck is meant to have bent knees and folded hips.
    for (const id of ['tuck-front-lever', 'tuck-ninety-hold', 'tuck-flag']) {
      expect(labels(id), id).not.toContain('knees')
      expect(labels(id), id).not.toContain('closed')
    }
    // Nothing to tick on a hold the camera does not grade.
    for (const id of ['active-hang', 'supported-flag', 'vertical-flag']) expect(issuesFor(id), id).toEqual([])
    // The planche line is unchanged.
    expect(labels('tuck-planche')).toEqual(['arms', 'scapula', 'shrug', 'pike', 'sag', 'lean', 'twist'])
    expect(issuesFor('human-flag').find((issue) => issue.id === 'closed')?.label).toBe('A fold at the waist')
  })

  it('draws every step of every road', () => {
    for (const step of ALL_STEPS) {
      const parts = figureParts(step.id)
      expect(parts.strokes.length, step.id).toBeGreaterThan(2)
      const bounds = figureBounds(step.id)
      for (const value of Object.values(bounds)) expect(Number.isFinite(value), step.id).toBe(true)
      expect(bounds.x2 - bounds.x1, step.id).toBeGreaterThan(10)
      for (const stroke of parts.strokes) expect(stroke.d, step.id).not.toMatch(/NaN|undefined/)
    }
  })

  it('weighs every key hold, and trends each posture on its own criteria', () => {
    for (const id of keyHolds) expect(LEVER_FRACTION[id], `${id} has no load fraction`).toBeGreaterThan(0)
    const criteria = (exerciseId: string) => {
      const sessions: Session[] = [0, 5, 10, 15, 20].map((day, i) => ({
        id: `f${i}`,
        startedAt: T0 + day * DAY,
        endedAt: T0 + day * DAY + 1,
        workoutName: 'x',
        workoutKind: 'auto',
        stepId: 'foundations',
        sets: [
          {
            ...verifiedHold(exerciseId, 8, T0 + day * DAY),
            form: {
              rating: 'clean',
              confirmed: true,
              auto: { issues: [], confidence: 0.9, score: 80 + i, cleanSeconds: 8, cleanRatio: 1, elbowDeg: 170, kneeDeg: 175, hipAngleDeg: 172, hipOffset: 0.05, shoulderDeg: 150 + i * 6, tiltDeg: 20 - i * 3 },
            },
          },
        ],
      }))
      const result = readFormTrends({ ...initialState(), sessions }, exerciseId)
      return result.kind === 'trends' ? result.trends.map((trend) => trend.criterion) : []
    }
    expect(criteria('freestanding-handstand')).toEqual(expect.arrayContaining(['elbow', 'shoulders', 'knees']))
    expect(criteria('human-flag')).toEqual(expect.arrayContaining(['elbow', 'tilt']))
    expect(criteria('ninety-hold')).toEqual(expect.arrayContaining(['angle']))
    // A 90° hold has no lockout to trend, and a handstand no level line.
    expect(criteria('ninety-hold')).not.toContain('elbow')
    expect(criteria('freestanding-handstand')).not.toContain('tilt')
  })
})

describe('one athlete, several roads', () => {
  const athlete = () => startingState({ skills: ['frontlever', 'handstand', 'planche'], steps: { frontlever: 'fl-tuck', handstand: 'hs-wall', planche: 'lean' } })

  it('keeps the planche at the top level and every other road in its own track', () => {
    const state = athlete()
    expect(state.stepId).toBe('lean')
    expect(activeSkills(state)).toEqual(['frontlever', 'handstand', 'planche'])
    expect(trackedSkills(state)).toEqual(['planche', 'frontlever', 'handstand'])
    expect(stepOfSkill(state, 'frontlever')).toBe('fl-tuck')
    expect(trackOf(state, 'frontlever').unlocked).toEqual(['fl-hang', 'fl-tuck'])
    expect(trackOf(state, 'handstand').goalStepId ?? SKILLS.handstand.defaultGoal).toBe('hs-free')
  })

  it('reads the same athlete as each skill, and gives the whole athlete back', () => {
    const state = athlete()
    expect(skillView(state, 'planche')).toBe(state)
    const lever = skillView(state, 'frontlever')
    expect(lever.stepId).toBe('fl-tuck')
    expect(lever.unlocked).toEqual(['fl-hang', 'fl-tuck'])
    expect(lever.sessions).toHaveLength(state.sessions.length)
    expect(wholeState(lever)).toBe(state)
    // A view of a view is the view of the whole athlete.
    expect(skillView(lever, 'handstand').stepId).toBe('hs-wall')
    expect(skillView(state, 'frontlever')).toBe(lever)
    expect(currentStepForExercise(state, 'tuck-front-lever')?.id).toBe('fl-tuck')
    expect(currentStepForExercise(state, 'front-lever')).toBeUndefined()
  })

  it('opens a step on the road it was earned on, and on no other', () => {
    const state = athlete()
    const session = sessionOf(state, T0, [verifiedHold('tuck-front-lever', 21, T0)])
    const { next, events } = applySession(state, session)
    expect(events.unlocks).toEqual([{ stepId: 'fl-advtuck', via: 'bar' }])
    expect(stepOfSkill(next, 'frontlever')).toBe('fl-advtuck')
    expect(next.stepId).toBe('lean')
    expect(stepOfSkill(next, 'handstand')).toBe('hs-wall')
    // The same hold without the evidence is a record, not a step.
    const unfilmed = applySession(state, sessionOf(state, T0, [{ ...verifiedHold('tuck-front-lever', 21, T0), form: undefined }]))
    expect(stepOfSkill(unfilmed.next, 'frontlever')).toBe('fl-tuck')
    expect(unfilmed.next.prs['tuck-front-lever']?.value).toBe(21)
  })

  it('opens two roads from one session', () => {
    const state = athlete()
    const session = sessionOf(state, T0, [verifiedHold('tuck-front-lever', 21, T0), verifiedHold('planche-lean', 31, T0 + 1), verifiedHold('wall-handstand', 61, T0 + 2)])
    const { next, events } = applySession(state, session)
    expect(events.unlocks?.map((unlock) => unlock.stepId).sort()).toEqual(['fl-advtuck', 'frog', 'hs-float'])
    expect(next.stepId).toBe('frog')
    expect(stepOfSkill(next, 'handstand')).toBe('hs-float')
  })

  it('asks to see a balance on a second day before it opens the next step', () => {
    let state = startingState({ skills: ['handstand'], steps: { handstand: 'hs-float' } })
    const first = applySession(state, sessionOf(state, T0, [verifiedHold('wall-float', 9, T0), verifiedHold('wall-float', 9, T0 + 60_000)]))
    // Twice in one session is one day.
    expect(stepOfSkill(first.next, 'handstand')).toBe('hs-float')
    state = first.next
    const sameDay = applySession(state, sessionOf(state, T0 + 3 * 3_600_000, [verifiedHold('wall-float', 9, T0 + 3 * 3_600_000)], 'later'))
    expect(stepOfSkill(sameDay.next, 'handstand')).toBe('hs-float')
    const second = applySession(state, sessionOf(state, T0 + 2 * DAY, [verifiedHold('wall-float', 8.5, T0 + 2 * DAY)], 'day2'))
    expect(stepOfSkill(second.next, 'handstand')).toBe('hs-free')
    expect(second.events.unlocks).toEqual([{ stepId: 'hs-free', via: 'bar' }])
  })

  it('replays history to the same roads it built session by session', () => {
    let state = athlete()
    const days: [number, SetLog[]][] = [
      [0, [verifiedHold('tuck-front-lever', 21, T0)]],
      [2, [verifiedHold('wall-handstand', 62, T0 + 2 * DAY)]],
      [4, [verifiedHold('adv-tuck-front-lever', 15.5, T0 + 4 * DAY), verifiedHold('planche-lean', 30.5, T0 + 4 * DAY + 1)]],
    ]
    for (const [day, sets] of days) {
      const session = sessionOf(state, T0 + day * DAY, sets)
      state = reducer(state, { type: 'SAVE_SESSION', session })
    }
    expect(stepOfSkill(state, 'frontlever')).toBe('fl-oneleg')
    expect(stepOfSkill(state, 'handstand')).toBe('hs-float')
    expect(state.stepId).toBe('frog')
    const rebuilt = rebuildDerivedState(state)
    for (const skill of trackedSkills(state)) expect(trackOf(rebuilt, skill).unlocked, skill).toEqual(trackOf(state, skill).unlocked)
    // And the road remembers when each step opened, per skill.
    const journey = readJourney(state, T0 + 10 * DAY, 'frontlever')
    expect(journey.stops.filter((stop) => stop.via === 'bar').map((stop) => stop.stepId)).toEqual(['fl-advtuck', 'fl-oneleg'])
    expect(readJourney(state, T0 + 10 * DAY, 'planche').stops.find((stop) => stop.stepId === 'frog')?.via).toBe('bar')
    // Deleting the session that earned a step takes the step back, on that road only.
    const without = reducer(state, { type: 'DELETE_SESSION', id: `s-${T0 + 2 * DAY}` })
    expect(stepOfSkill(without, 'handstand')).toBe('hs-wall')
    expect(stepOfSkill(without, 'frontlever')).toBe('fl-oneleg')
  })

  it('survives being saved and loaded, and repairs what does not belong', () => {
    let state = athlete()
    const session = { ...sessionOf(state, T0, [verifiedHold('tuck-front-lever', 21, T0)]), roles: { frontlever: 'lead' as const, handstand: 'practice' as const } }
    state = reducer(state, { type: 'SAVE_SESSION', session })
    const loaded = normalizeState(JSON.parse(JSON.stringify(state)))
    expect(activeSkills(loaded)).toEqual(activeSkills(state))
    expect(stepOfSkill(loaded, 'frontlever')).toBe('fl-advtuck')
    expect(loaded.sessions[0].skills?.frontlever?.stepId).toBe('fl-tuck')
    expect(loaded.sessions[0].roles).toEqual({ frontlever: 'lead', handstand: 'practice' })
    // A track pointing at another road's step, an unknown skill, an unknown role: none survive.
    const raw = JSON.parse(JSON.stringify(state))
    raw.tracks.handstand.stepId = 'fl-full'
    raw.tracks.breakdance = { stepId: 'windmill', baseStepId: 'windmill', unlocked: ['windmill'], addedAt: 1 }
    raw.profile.skills = ['frontlever', 'breakdance', 'handstand', 'frontlever']
    raw.sessions[0].roles = { frontlever: 'boss', planche: 'lead' }
    const repaired = normalizeState(raw)
    expect(activeSkills(repaired)).toEqual(['frontlever', 'handstand'])
    expect(STEP_BY_ID[stepOfSkill(repaired, 'handstand')].skill).toBe('handstand')
    expect(Object.keys(repaired.tracks ?? {})).not.toContain('breakdance')
    expect(repaired.sessions[0].roles).toEqual({ planche: 'lead' })
  })

  it('reads a save from before the other skills as a planche athlete, unchanged', () => {
    const old = { ...initialState(), onboarded: true, stepId: 'tuck', baseStepId: 'tuck', unlocked: ['foundations', 'lean', 'frog', 'tuck'], version: 7 } as unknown as Record<string, unknown>
    delete old.tracks
    const state = normalizeState(old)
    expect(activeSkills(state)).toEqual(['planche'])
    expect(trackedSkills(state)).toEqual(['planche'])
    expect(state.stepId).toBe('tuck')
    expect(todaysLineup(state, T0).map((entry) => `${entry.skill}:${entry.role}`)).toEqual(['planche:lead'])
  })

  it('adds, reorders and drops skills without losing a road', () => {
    let state = startingState({ skills: ['planche'], steps: { planche: 'tuck' } })
    state = reducer(state, { type: 'ADD_SKILL', skill: 'frontlever', stepId: 'fl-advtuck', goalStepId: 'fl-straddle' })
    expect(activeSkills(state)).toEqual(['planche', 'frontlever'])
    expect(trackOf(state, 'frontlever')).toMatchObject({ stepId: 'fl-advtuck', baseStepId: 'fl-advtuck', goalStepId: 'fl-straddle' })
    state = reducer(state, { type: 'SET_SKILLS', skills: ['frontlever', 'planche'] })
    expect(activeSkills(state)[0]).toBe('frontlever')
    state = reducer(state, { type: 'SET_SKILLS', skills: ['planche'] })
    expect(activeSkills(state)).toEqual(['planche'])
    // Off the list, not gone: it comes back where it was left.
    expect(stepOfSkill(state, 'frontlever')).toBe('fl-advtuck')
    state = reducer(state, { type: 'SET_SKILLS', skills: ['planche', 'frontlever'] })
    expect(stepOfSkill(state, 'frontlever')).toBe('fl-advtuck')
    // The last skill cannot be dropped, and nonsense is ignored.
    expect(activeSkills(reducer(state, { type: 'SET_SKILLS', skills: [] }))).toEqual(['planche', 'frontlever'])
    expect(activeSkills(reducer(state, { type: 'SET_SKILLS', skills: ['juggling' as SkillId] }))).toEqual(['planche', 'frontlever'])
    state = reducer(state, { type: 'SET_GOAL', stepId: 'fl-full' })
    expect(trackOf(state, 'frontlever').goalStepId).toBe('fl-full')
  })
})

describe('placement on the new roads', () => {
  const base = { wrist: 2, pushups: 22, hollow: 40, pullups: 7, experience: 6 }

  it('starts on the step after the last one owned', () => {
    expect(placeSkill('frontlever', { ...base, [levelId('frontlever')]: 0 }).stepId).toBe('fl-hang')
    expect(placeSkill('frontlever', { ...base, [levelId('frontlever')]: 2 }).stepId).toBe('fl-advtuck')
    expect(placeSkill('handstand', { ...base, [levelId('handstand')]: 2 }).stepId).toBe('hs-float')
    // Owning the summit starts at the summit, not past it.
    expect(placeSkill('flag', { ...base, [levelId('flag')]: 6 }).stepId).toBe('flag-full')
    expect(placeSkill('ninety', { ...base, [levelId('ninety')]: 99 }).stepId).toBe('n90-full')
  })

  it('caps a placement by what the road needs on day one, and never upward', () => {
    const noPulls = placeSkill('frontlever', { ...base, pullups: 0, [levelId('frontlever')]: 3 })
    expect(noPulls.stepId).toBe('fl-hang')
    expect(noPulls.confidence).toBe('low')
    expect(noPulls.reason).toMatch(/no pull-ups/i)
    expect(placeSkill('flag', { ...base, pullups: 0, [levelId('flag')]: 2 }).stepId).toBe('flag-foundations')
    const soreWrists = placeSkill('handstand', { ...base, wrist: 0, [levelId('handstand')]: 3 })
    expect(soreWrists.stepId).toBe('hs-foundations')
    expect(soreWrists.caveats.join(' ')).toMatch(/looked at/)
    expect(placeSkill('ninety', { ...base, pushups: 6, [levelId('ninety')]: 3 }).stepId).toBe('n90-lean')
    // A cap lowers; plenty of pull-ups does not raise anyone.
    expect(placeSkill('frontlever', { ...base, pullups: 12, [levelId('frontlever')]: 0 }).stepId).toBe('fl-hang')
  })

  it('never claims confidence from one self-reported answer, and flags answers that disagree', () => {
    for (const skill of ['frontlever', 'handstand', 'ninety', 'flag'] as SkillId[]) {
      for (let owned = 0; owned <= stepsOf(skill).length; owned++) {
        const placement = placeSkill(skill, { ...base, [levelId(skill)]: owned })
        expect(placement.confidence, `${skill} ${owned}`).not.toBe('good')
        expect(STEP_BY_ID[placement.stepId].skill).toBe(skill)
        expect(placement.reason.length).toBeGreaterThan(20)
      }
      // Nothing said is a placement too: the start, at low confidence.
      const silent = placeSkill(skill, {})
      expect(silent.stepId).toBe(stepsOf(skill)[0].id)
      expect(silent.confidence).toBe('low')
    }
    const odd = placeSkill('frontlever', { ...base, pullups: 3, [levelId('frontlever')]: 3 })
    expect(odd.inconsistencies).toHaveLength(1)
    expect(odd.confidence).toBe('low')
  })

  it('asks what the chosen skills need, once, and stops', () => {
    const asked = (skills: SkillId[]) => {
      const answers: Record<string, number> = {}
      const ids: string[] = []
      for (let guard = 0; guard < 40; guard++) {
        const item = nextInterviewItem(skills, answers)
        if (!item) break
        ids.push(item.id)
        // "Not yet" everywhere: the shortest honest interview.
        answers[item.id] = item.options[0].value
        expect(interviewProgress(skills, answers).likelyTotal).toBeGreaterThanOrEqual(ids.length)
      }
      expect(new Set(ids).size, 'a question was asked twice').toBe(ids.length)
      return ids
    }
    expect(asked(['frontlever'])).toEqual(['hollow', 'pullups', levelId('frontlever'), 'experience'])
    expect(asked(['handstand'])).toEqual(['wrist', 'pushups', 'hollow', levelId('handstand'), ladderId('handstand'), 'experience'])
    expect(asked(['flag', 'ninety'])).toEqual(['wrist', 'pushups', 'hollow', 'pullups', levelId('flag'), levelId('ninety'), ladderId('ninety'), 'experience'])
    // With the planche its own interview runs first and is not repeated.
    const withPlanche = asked(['planche', 'frontlever'])
    expect(withPlanche.slice(0, 3)).toEqual(['wrist', 'pushups', 'hollow'])
    expect(withPlanche.slice(-3)).toEqual(['pullups', levelId('frontlever'), 'experience'])
    expect(withPlanche.filter((id) => id === 'experience')).toHaveLength(1)
  })

  it('starts the rep line where the caps allow and records it where the ladder reads it', () => {
    const answers = { ...base, [levelId('handstand')]: 2, [ladderId('handstand')]: 3 }
    expect(ladderStart('handstand', answers)).toBe(3)
    expect(ladderStart('handstand', { ...answers, wrist: 0 })).toBe(0)
    expect(ladderStart('handstand', { ...answers, pushups: 6 })).toBe(0)
    expect(ladderStart('frontlever', answers)).toBeUndefined()
    const record = placementRecord('handstand', { ...answers, pushups: 6 }, T0)
    expect(record.placedStepId).toBe('hs-float')
    expect(record.answers[ladderId('handstand')]).toBe(0)
    let state = startingState({ skills: ['handstand'] })
    state = reducer(state, { type: 'ADD_SKILL', skill: 'ninety', stepId: 'n90-tuck', assessment: placementRecord('ninety', { ...base, [levelId('ninety')]: 1, [ladderId('ninety')]: 1 }, T0) })
    expect(ladderStatus(state, 'ninety')?.rung.exerciseId).toBe(SKILLS.ninety.ladder!.rungs[1].exerciseId)
    expect(goalChoices('frontlever')).toEqual(['fl-oneleg', 'fl-straddle', 'fl-full'])
  })
})

describe('the rep ladders', () => {
  const rep = (exerciseId: string, reps: number, at: number, form?: SetLog['form'], extra: Partial<SetLog> = {}): SetLog => ({
    exerciseId,
    kind: 'reps',
    value: reps,
    target: reps,
    section: 'strength',
    at,
    ...(form ? { form } : {}),
    ...extra,
  })
  const reviewed: SetLog['form'] = { rating: 'clean', confirmed: true, visualReviewPassed: true }

  it('trains a first pike rep from the knees and offers one trial after two manageable practice days', () => {
    const base = startingState({ skills: ['handstand'], equipment: ['floor', 'wall'] })
    const assessment = placementRecord('handstand', { [ladderId('handstand')]: -1, pushups: 3 }, T0)
    const state = normalizeState({ ...base, tracks: { ...base.tracks, handstand: { ...trackOf(base, 'handstand'), assessment } } })
    const withLog = (s: AppState, day: number, sets: SetLog[]) => ({ ...s, sessions: [...s.sessions, sessionOf(s, T0 + day * DAY, sets)] })
    const practice = (day: number, rpe: number) => [0, 1].map((i) => rep('kneeling-pike-pushup', 5, T0 + day * DAY + i, undefined, { rpe }))
    const pressBlocks = (s: AppState, day: number) => finalizeWorkoutWithPlan(s, { source: 'auto', skills: ['handstand'], focus: 'ladder', minutes: 45 }, undefined, T0 + day * DAY).workout.blocks.filter((b) => b.section === 'strength')
    expect(ladderStatus(state, 'handstand')!.pikePreparation).toBe('practice')
    expect(pressBlocks(state, 1).find((b) => b.role === 'press')).toMatchObject({ exerciseId: 'kneeling-pike-pushup', sets: 2 })
    expect(pressBlocks(state, 1).some((b) => b.exerciseId === 'pike-pushup')).toBe(false)
    const tooHard = withLog(state, 1, practice(1, 10))
    const once = withLog(tooHard, 3, practice(3, 7))
    expect(ladderStatus(once, 'handstand')!.pikePreparation).toBe('practice')
    const twice = withLog(once, 5, practice(5, 8))
    expect(ladderStatus(twice, 'handstand')!).toMatchObject({ pikePreparation: 'trial', loggedBest: 0, verifiedBest: 0 })
    const trial = pressBlocks(twice, 8).filter((b) => b.exerciseId === 'pike-pushup')
    expect(trial).toMatchObject([{ sets: 1, target: { reps: 1 } }])
    const failed = withLog(twice, 8, [rep('pike-pushup', 0, T0 + 8 * DAY, undefined, { target: 1 })])
    expect(ladderStatus(failed, 'handstand')!.pikePreparation).toBe('practice')
    const unplaced = withLog(base, 8, [rep('pike-pushup', 0, T0 + 8 * DAY, undefined, { target: 4, rpe: 10 })])
    expect(ladderStatus(unplaced, 'handstand')!.pikePreparation).toBe('practice')
    const firstFull = withLog(failed, 11, [rep('pike-pushup', 1, T0 + 11 * DAY)])
    expect(ladderStatus(firstFull, 'handstand')!.pikePreparation).toBeUndefined()
    expect(ladderStatus(firstFull, 'handstand')!).toMatchObject({ loggedBest: 1, verifiedBest: 0, index: 0 })
    expect(pressBlocks(firstFull, 14).find((b) => b.role === 'press')?.exerciseId).toBe('pike-pushup')
  })

  it('shows working pike reps from the gym on the press road and follows a correction or deletion', () => {
    const base = startingState({ skills: ['handstand'], equipment: ['floor'] })
    const choose = reducer(base, { type: 'SET_REP_GOAL', skill: 'handstand', exerciseId: 'pike-pushup' })
    const saved = reducer(choose, { type: 'GYM', op: { op: 'saveSession', session: {
      id: 'press-day', locationId: 'home', name: 'Pressing', startedAt: T0, endedAt: T0 + 2,
      exercises: [{ exerciseId: 'pike-push-up', sets: [{ at: T0, reps: 12, warmup: true }, { at: T0 + 1, reps: 5 }] }],
    } } })
    expect(ladderStatus(saved, 'handstand', T0)).toMatchObject({ loggedBest: 0, goal: { logged: false } })
    expect(ladderStatus(saved, 'handstand', T0 + 2)).toMatchObject({ loggedBest: 5, verifiedBest: 0, index: 0, goal: { logged: true, reviewed: false, gymBest: 5 } })
    const fixed = reducer(saved, { type: 'GYM', op: { op: 'correctSet', sessionId: 'press-day', exerciseIndex: 0, setIndex: 1, reps: 3 } })
    expect(ladderStatus(fixed, 'handstand')?.loggedBest).toBe(3)
    const removed = reducer(fixed, { type: 'GYM', op: { op: 'deleteSession', id: 'press-day' } })
    expect(ladderStatus(removed, 'handstand')?.goal.logged).toBe(false)
    const deficit = reducer(removed, { type: 'SET_REP_GOAL', skill: 'handstand', exerciseId: 'deficit-wall-hspu' })
    expect(ladderStatus(deficit, 'handstand')?.goal.missingKit).toEqual(['wall', 'parallettes'])
  })

  it('keeps a first-rep goal separate from the balance goal and checks it against the saved set', () => {
    const base = startingState({ skills: ['handstand'], equipment: ['floor', 'wall'] })
    expect(ladderStatus(base, 'handstand')!.goal.rung.exerciseId).toBe('freestanding-hspu')
    const chosen = reducer(base, { type: 'SET_REP_GOAL', skill: 'handstand', exerciseId: 'wall-hspu' })
    const other = reducer(base, { type: 'SET_GOAL', stepId: 'hs-float' })
    for (const merged of [mergeExternalState(chosen, other), mergeExternalState(other, chosen)]) {
      expect(normalizeState(merged).tracks!.handstand).toMatchObject({ goalStepId: 'hs-float', repGoal: 'wall-hspu' })
    }
    expect(reducer(chosen, { type: 'SET_REP_GOAL', skill: 'handstand', exerciseId: 'ninety-pushup' }).tracks).toEqual(chosen.tracks)
    const log = sessionOf(chosen, T0, [rep('wall-hspu', 1, T0)])
    const unreviewed = reducer(chosen, { type: 'SAVE_SESSION', session: log })
    expect(ladderStatus(unreviewed, 'handstand')!.goal).toMatchObject({ logged: true, reviewed: false })
    const proof = sessionOf(chosen, T0 + DAY, [rep('wall-hspu', 1, T0 + DAY, reviewed)])
    const met = reducer(unreviewed, { type: 'SAVE_SESSION', session: proof })
    expect(ladderStatus(met, 'handstand')!.goal.reviewed).toBe(true)
    expect(ladderStatus(reducer(met, { type: 'DELETE_SESSION', id: proof.id }), 'handstand')!.goal.reviewed).toBe(false)
  })

  it('credits only reps with evidence', () => {
    expect(verifiedReps(rep('pike-pushup', 8, 1, reviewed))).toBe(8)
    expect(verifiedReps(rep('pike-pushup', 8, 1))).toBe(0)
    expect(verifiedReps(rep('pike-pushup', 8, 1, { rating: 'clean', confirmed: true }))).toBe(0)
    expect(verifiedReps(rep('pike-pushup', 8, 1, { ...reviewed, rating: 'slipped' }))).toBe(0)
    expect(verifiedReps(rep('pike-pushup', 8, 1, reviewed, { light: true }))).toBe(0)
    expect(verifiedReps(rep('pike-pushup', 8, 1, reviewed, { assist: 'band' }))).toBe(0)
    expect(verifiedReps(rep('pike-pushup', 8, 1, reviewed, { section: 'warmup' }))).toBe(0)
    // A camera reading on file is not a rep count: nothing but the replay review credits a rep.
    const cameraOnly: SetLog['form'] = { rating: 'clean', confirmed: true, auto: { issues: [], confidence: 0.99, score: 100 } }
    expect(verifiedReps(rep('pike-pushup', 8, 1, cameraOnly))).toBe(0)
    // A review that was never confirmed by a person is a suggestion, not evidence.
    expect(verifiedReps(rep('pike-pushup', 8, 1, { rating: 'clean', confirmed: false, visualReviewPassed: true }))).toBe(0)
  })

  it('gives every rung a replay checklist and a way to film it', () => {
    for (const skill of SKILL_LIST) {
      for (const rung of skill.ladder?.rungs ?? []) {
        expect(EXERCISE_BY_ID[rung.exerciseId]?.type, rung.exerciseId).toBe('reps')
        expect(rung.check.length, rung.exerciseId).toBeGreaterThanOrEqual(2)
        for (const item of rung.check) expect(item.length, `${rung.exerciseId}: ${item}`).toBeGreaterThan(12)
        expect(['wide', 'tall'], rung.exerciseId).toContain(rung.frame)
        expect(rung.standardReps, rung.exerciseId).toBeGreaterThanOrEqual(rung.startReps)
        expect(ladderOfExercise(rung.exerciseId)?.skill, rung.exerciseId).toBe(skill.id)
      }
    }
    // A rep that starts in a handstand needs the tall frame.
    expect(SKILLS.handstand.ladder!.rungs.find((rung) => rung.exerciseId === 'wall-hspu')!.frame).toBe('tall')
    expect(SKILLS.handstand.ladder!.rungs.find((rung) => rung.exerciseId === 'pike-pushup')!.frame).toBe('wide')
  })

  it('films a rep set only where it can count: the current rung of a skill being trained, in real work', () => {
    const state = startingState({ skills: ['handstand'], equipment: ['floor', 'wall', 'box', 'parallettes'] })
    const first = SKILLS.handstand.ladder!.rungs[0].exerciseId
    const second = SKILLS.handstand.ladder!.rungs[1].exerciseId
    expect(rungInPlay(state, first, { section: 'strength' })?.rung.exerciseId).toBe(first)
    // Not the rung the athlete is on.
    expect(rungInPlay(state, second, { section: 'strength' })).toBeNull()
    // Not real work.
    expect(rungInPlay(state, first, { section: 'warmup' })).toBeNull()
    expect(rungInPlay(state, first, { section: 'cooldown' })).toBeNull()
    expect(rungInPlay(state, first, { section: 'strength', light: true })).toBeNull()
    // Not a rung of anything.
    expect(rungInPlay(state, 'pushup', { section: 'strength' })).toBeNull()
    // A planche athlete's pseudo planche push-ups are an accessory, not a rung:
    // the 90° line they belong to is not being trained.
    const plancheOnly = startingState({ skills: ['planche'] })
    expect(ladderOfExercise('pppu')?.skill).toBe('ninety')
    expect(rungInPlay(plancheOnly, 'pppu', { section: 'strength' })).toBeNull()
    const withNinety = startingState({ skills: ['planche', 'ninety'] })
    expect(rungInPlay(withNinety, 'pppu', { section: 'strength' })?.ladder.id).toBe('ninety-pushup')
    // Read through any skill's view of the athlete, not only the whole state.
    expect(rungInPlay(skillView(withNinety, 'planche'), 'pppu', { section: 'strength' })?.ladder.id).toBe('ninety-pushup')
  })

  it('says what a reviewed set does to the ladder', () => {
    const ladder = SKILLS.handstand.ladder!
    const state = startingState({ skills: ['handstand'], equipment: ['floor', 'wall', 'box', 'parallettes'] })
    const status = ladderStatus(state, 'handstand')!
    expect(rungOutcome(status, status.rung.standardReps - 1)).toBe('short')
    expect(rungOutcome(status, status.rung.standardReps)).toBe('opens')
    expect(rungOutcome(status, status.rung.standardReps + 3)).toBe('opens')
    // The last wall rung: its standard is met, but the freestanding rep waits for the balance.
    const lastWall = ladder.rungs.length - 2
    const placed = (stepId: 'hs-wall' | 'hs-free'): AppState => {
      const base = startingState({ skills: ['handstand'], steps: { handstand: stepId }, equipment: ['floor', 'wall', 'box', 'parallettes'] })
      return {
        ...base,
        tracks: {
          ...base.tracks,
          handstand: {
            ...trackOf(base, 'handstand'),
            assessment: { at: T0, answers: { [ladderId('handstand')]: lastWall }, placedStepId: stepId, confidence: 'moderate', gapIds: [] },
          },
        },
      }
    }
    const waiting = ladderStatus(placed('hs-wall'), 'handstand')!
    expect(waiting.rung.exerciseId).toBe(ladder.rungs[lastWall].exerciseId)
    expect(rungOutcome(waiting, waiting.rung.standardReps)).toBe('waits')
    expect(rungOutcome(ladderStatus(placed('hs-free'), 'handstand')!, waiting.rung.standardReps)).toBe('opens')
    // The top rung has nothing above it.
    const top = { ...waiting, rung: ladder.rungs[ladder.rungs.length - 1], next: undefined }
    expect(rungOutcome(top, 1)).toBe('top')
  })

  it('does not let a placement answer start a push-up line past a hold it needs', () => {
    const kit = ['floor', 'wall', 'box', 'parallettes'] as const
    const withAnswer = (state: AppState, skill: 'handstand' | 'ninety', rung: number): AppState => ({
      ...state,
      tracks: {
        ...state.tracks,
        [skill]: {
          ...trackOf(state, skill),
          assessment: { at: T0, answers: { [ladderId(skill)]: rung }, placedStepId: trackOf(state, skill).stepId, confidence: 'moderate', gapIds: [] },
        },
      },
    })
    // "I can do a freestanding handstand push-up", placed on the wall handstand.
    // The line once started on the freestanding rung: the starting rung was
    // never checked against the hold it needs.
    const hs = SKILLS.handstand.ladder!
    const top = hs.rungs.length - 1
    expect(hs.rungs[top].needsStep).toBe('hs-free')
    const onWall = withAnswer(startingState({ skills: ['handstand'], steps: { handstand: 'hs-wall' }, equipment: [...kit] }), 'handstand', top)
    const capped = ladderStatus(onWall, 'handstand')!
    expect(capped.index).toBe(top - 1)
    expect(capped.waitingOn).toBe('hs-free')
    expect(capped.placedPastGate).toBe(true)
    expect(rungOutcome(capped, capped.rung.standardReps)).toBe('waits')
    // With the balance, the claim stands.
    const free = withAnswer(startingState({ skills: ['handstand'], steps: { handstand: 'hs-free' }, equipment: [...kit] }), 'handstand', top)
    expect(ladderStatus(free, 'handstand')).toMatchObject({ index: top })
    expect(ladderStatus(free, 'handstand')!.placedPastGate).toBeUndefined()

    // The 90° push-up line: every rung past the first starts in a hold or a
    // handstand, and waits for it — it had no gate at all, and a claim could
    // start an athlete on a 90° push-up they had no handstand for.
    const n90 = SKILLS.ninety.ladder!
    expect(n90.rungs.map((rung) => rung.needsStep)).toEqual([undefined, 'n90-tuck', 'hs-float', 'hs-free', 'hs-free'])
    const summit = n90.rungs.length - 1
    const at = (ninety: 'n90-lean' | 'n90-tuck', handstand?: 'hs-wall' | 'hs-float' | 'hs-free') =>
      ladderStatus(
        withAnswer(
          startingState({
            skills: handstand ? ['ninety', 'handstand'] : ['ninety'],
            steps: { ninety, ...(handstand ? { handstand } : {}) },
            equipment: [...kit],
          }),
          'ninety',
          summit,
        ),
        'ninety',
      )!
    expect(at('n90-lean')).toMatchObject({ index: 0, waitingOn: 'n90-tuck', placedPastGate: true })
    // No handstand trained here at all: the line stops before the first rung that starts in one.
    expect(at('n90-tuck')).toMatchObject({ index: 1, waitingOn: 'hs-float', placedPastGate: true })
    expect(at('n90-tuck', 'hs-wall')).toMatchObject({ index: 1, waitingOn: 'hs-float' })
    expect(at('n90-tuck', 'hs-float')).toMatchObject({ index: 2, waitingOn: 'hs-free' })
    expect(at('n90-tuck', 'hs-free')).toMatchObject({ index: summit })
    // And a standard met below a gate waits there, on the other skill's road too.
    const below = at('n90-tuck', 'hs-wall')
    expect(rungOutcome(below, below.rung.standardReps)).toBe('waits')
    expect(rungOutcome(at('n90-tuck', 'hs-float'), below.rung.standardReps)).toBe('waits')
  })

  it('counts standards met from the history alone, whatever kit is listed today', () => {
    const ladder = SKILLS.handstand.ladder!
    const first = ladder.rungs[0]
    let state = startingState({ skills: ['handstand'], equipment: ['floor', 'wall', 'box', 'parallettes'] })
    expect(standardsMet(state, 'handstand')).toBe(0)
    state = reducer(state, { type: 'SAVE_SESSION', session: sessionOf(state, T0, [rep(first.exerciseId, first.standardReps - 1, T0, reviewed)]) })
    expect(standardsMet(state, 'handstand')).toBe(0)
    state = reducer(state, { type: 'SAVE_SESSION', session: sessionOf(state, T0 + DAY, [rep(first.exerciseId, first.standardReps, T0 + DAY, reviewed)]) })
    expect(standardsMet(state, 'handstand')).toBe(1)
    expect(state.achievements['rung-opened']).toBeDefined()
    // Un-ticking the wall changes where the ladder stands — and nothing about what was done.
    const noWall = reducer(state, { type: 'SET_PROFILE', patch: { equipment: ['floor'] } })
    expect(ladderStatus(noWall, 'handstand')!.rungs.length).toBeLessThan(ladderStatus(state, 'handstand')!.rungs.length)
    expect(standardsMet(noWall, 'handstand')).toBe(1)
    expect(rebuildDerivedState(noWall).achievements['rung-opened']).toBe(state.achievements['rung-opened'])
    // A standard below where placement started the athlete is not a rung climbed, and the top rung opens nothing.
    const placedHigh = {
      ...state,
      tracks: {
        ...state.tracks,
        handstand: {
          ...trackOf(state, 'handstand'),
          assessment: { at: T0, answers: { [ladderId('handstand')]: 3 }, placedStepId: 'hs-wall' as const, confidence: 'moderate' as const, gapIds: [] },
        },
      },
    }
    expect(standardsMet(placedHigh, 'handstand')).toBe(0)
    const top = ladder.rungs[ladder.rungs.length - 1]
    const summit = reducer(startingState({ skills: ['handstand'] }), {
      type: 'SAVE_SESSION',
      session: sessionOf(state, T0, [rep(top.exerciseId, top.standardReps, T0, reviewed)]),
    })
    expect(standardsMet(summit, 'handstand')).toBe(0)
    // A skill with no push-up line has none to meet.
    expect(standardsMet(state, 'frontlever')).toBe(0)
  })

  it('drops a replay review when the count is raised past what was reviewed', () => {
    const set = rep('pike-pushup', 6, 1, reviewed)
    // Fewer reps than were checked: the review still covers them.
    const lowered = withRepCount(set, 5)
    expect(lowered.value).toBe(5)
    expect(verifiedReps(lowered)).toBe(5)
    // More reps than were checked: the review cannot stretch to cover them.
    const raised = withRepCount(set, 8)
    expect(raised.value).toBe(8)
    expect(raised.form).toMatchObject({ rating: 'clean', confirmed: true })
    expect(raised.form?.visualReviewPassed).toBeUndefined()
    expect(verifiedReps(raised)).toBe(0)
    // The original is not touched, and a set with no review just changes its number.
    expect(set.form?.visualReviewPassed).toBe(true)
    expect(withRepCount(rep('pike-pushup', 6, 1), 9)).toMatchObject({ value: 9 })
    expect(withRepCount(set, 6).form?.visualReviewPassed).toBe(true)
  })

  it('asks for a review of the best filmed set per movement, and moves on when it is rated down', () => {
    const filmed = (set: SetLog) => set.clipKey !== undefined
    const a = rep('pike-pushup', 6, 1, undefined, { clipKey: 'a' })
    const b = rep('pike-pushup', 8, 2, undefined, { clipKey: 'b' })
    const c = rep('pike-pushup', 8, 3, undefined, { clipKey: 'c' })
    const unfilmed = rep('pike-pushup', 12, 4)
    const other = rep('pppu', 5, 5, undefined, { clipKey: 'd' })
    const hold: SetLog = { exerciseId: 'wall-handstand', kind: 'hold', value: 30, target: 30, section: 'main', at: 6, clipKey: 'e' }
    // The biggest filmed set of each movement; between equals the earlier; never the unfilmed one or a hold.
    expect(repSetsToReview([a, b, c, unfilmed, other, hold], filmed).map((set) => set.clipKey)).toEqual(['b', 'd'])
    // Once reviewed it stays listed, so the athlete sees what it earned.
    const passed = { ...b, form: reviewed }
    expect(repSetsToReview([a, passed, c], filmed).map((set) => set.clipKey)).toEqual(['b'])
    // Rated Slipped, the question moves to the next best.
    const slipped: SetLog = { ...b, form: { rating: 'slipped', confirmed: true } }
    expect(repSetsToReview([a, slipped, c], filmed).map((set) => set.clipKey)).toEqual(['c'])
    expect(repSetsToReview([a, slipped, { ...c, form: { rating: 'broke', confirmed: true } }], filmed).map((set) => set.clipKey)).toEqual(['a'])
    expect(repSetsToReview([], filmed)).toEqual([])
  })

  it('reports the rung a session opened, and nothing for a session that opened none', () => {
    const state = startingState({ skills: ['handstand'], equipment: ['floor', 'wall', 'box', 'parallettes'] })
    const ladder = SKILLS.handstand.ladder!
    const first = ladder.rungs[0]
    const short = sessionOf(state, T0, [rep(first.exerciseId, first.standardReps - 1, T0, reviewed)])
    expect(rungsOpenedBy(state, short)).toEqual([])
    const unreviewed = sessionOf(state, T0, [rep(first.exerciseId, first.standardReps, T0, { rating: 'clean', confirmed: true })])
    expect(rungsOpenedBy(state, unreviewed)).toEqual([])
    const met = sessionOf(state, T0, [rep(first.exerciseId, first.standardReps, T0, reviewed)])
    expect(rungsOpenedBy(state, met)).toEqual([{ skill: 'handstand', rung: ladder.rungs[1] }])
  })

  it('opens a rung on one verified set at its standard, and not on a logged number', () => {
    let state = startingState({ skills: ['handstand'], equipment: ['floor', 'wall', 'box', 'parallettes'] })
    const ladder = SKILLS.handstand.ladder!
    expect(ladderStatus(state, 'handstand')).toMatchObject({ index: 0, verifiedBest: 0 })
    const first = ladder.rungs[0]
    state = reducer(state, { type: 'SAVE_SESSION', session: sessionOf(state, T0, [rep(first.exerciseId, first.standardReps, T0)]) })
    expect(ladderStatus(state, 'handstand')).toMatchObject({ index: 0, verifiedBest: 0, loggedBest: first.standardReps })
    state = reducer(state, { type: 'SAVE_SESSION', session: sessionOf(state, T0 + DAY, [rep(first.exerciseId, first.standardReps - 1, T0 + DAY, reviewed)]) })
    expect(ladderStatus(state, 'handstand')).toMatchObject({ index: 0, verifiedBest: first.standardReps - 1 })
    state = reducer(state, { type: 'SAVE_SESSION', session: sessionOf(state, T0 + 2 * DAY, [rep(first.exerciseId, first.standardReps, T0 + 2 * DAY, reviewed)]) })
    const status = ladderStatus(state, 'handstand')!
    expect(status.index).toBe(1)
    expect(status.openedAt[status.rung.exerciseId]).toBeGreaterThan(T0)
    // A Quick Log entry never moves it.
    const quick = { ...sessionOf(state, T0 + 3 * DAY, [rep(status.rung.exerciseId, 20, T0 + 3 * DAY, reviewed)]), workoutName: 'Quick Log' }
    expect(ladderStatus(reducer(state, { type: 'SAVE_SESSION', session: quick }), 'handstand')?.index).toBe(1)
  })

  it('steps over a rung whose kit is missing, and waits for the balance before the freestanding rep', () => {
    const noBox = startingState({ skills: ['handstand'], equipment: ['floor', 'wall'] })
    expect(ladderStatus(noBox, 'handstand')!.rungs.map((rung) => rung.exerciseId)).not.toContain('elevated-pike-pushup')
    const ladder = SKILLS.handstand.ladder!
    const lastWall = ladder.rungs[ladder.rungs.length - 2]
    let state = startingState({ skills: ['handstand'], steps: { handstand: 'hs-wall' }, equipment: ['floor', 'wall', 'box', 'parallettes'] })
    state = reducer(state, {
      type: 'ADD_SKILL',
      skill: 'handstand',
    })
    // Placed on the last wall rung by the interview.
    state = { ...state, tracks: { ...state.tracks, handstand: { ...trackOf(state, 'handstand'), assessment: { at: T0, answers: { [ladderId('handstand')]: ladder.rungs.length - 2 }, placedStepId: 'hs-wall', confidence: 'moderate', gapIds: [] } } } }
    state = reducer(state, { type: 'SAVE_SESSION', session: sessionOf(state, T0, [rep(lastWall.exerciseId, lastWall.standardReps, T0, reviewed)]) })
    const status = ladderStatus(state, 'handstand')!
    expect(status.rung.exerciseId).toBe(lastWall.exerciseId)
    expect(status.waitingOn).toBe('hs-free')
  })
})

describe('the Learn guides', () => {
  it('shelves one guide per skill, built from that skill’s own definition', () => {
    expect(new Set(GUIDES.map((guide) => guide.id)).size).toBe(GUIDES.length)
    const groups = new Set(GUIDE_GROUPS.map((group) => group.id))
    for (const guide of GUIDES) {
      expect(groups.has(guide.group), guide.id).toBe(true)
      expect(guide.sections.length, guide.id).toBeGreaterThanOrEqual(3)
      for (const section of guide.sections) {
        const text = [section.heading, section.body, ...(section.bullets ?? [])].join(' ')
        expect(section.body.trim().length, `${guide.id} · ${section.heading}`).toBeGreaterThan(20)
        expect(text, `${guide.id} · ${section.heading}`).not.toMatch(/undefined|NaN|\[object/)
        // A sentence that ends twice is a template that joined two endings.
        expect(text, `${guide.id} · ${section.heading}`).not.toMatch(/\.\.(?!\.)|\. \.|The summit\. The summit/)
      }
    }
    for (const group of GUIDE_GROUPS) expect(GUIDES.some((guide) => guide.group === group.id), group.id).toBe(true)
    for (const def of SKILL_LIST) {
      const guide = GUIDES.find((candidate) => candidate.skill === def.id)!
      expect(guide, def.id).toBeDefined()
      expect(guide).toEqual(skillGuide(def))
      const road = guide.sections.find((section) => section.heading === 'The road')!
      expect(road.bullets!.length, def.id).toBe(def.steps.length)
      // Every step but the last names its bar; the last is the summit, once.
      def.steps.slice(0, -1).forEach((step, index) => expect(road.bullets![index], step.id).toContain(`Bar: ${step.unlockSec}s.`))
      expect(road.bullets!.at(-1)!.match(/summit/gi)?.length, def.id).toBe(1)
      const line = guide.sections.find((section) => / line$/.test(section.heading))
      expect(Boolean(line), def.id).toBe(Boolean(def.ladder))
      if (def.ladder) {
        expect(line!.bullets!.length).toBe(def.ladder.rungs.length)
        // The guide must say what the app does: no camera count, the replay instead.
        expect(line!.body).toMatch(/camera does not count reps/)
      }
      // What the road's own screens say is what the guide says.
      const all = guide.sections.map((section) => [section.body, ...(section.bullets ?? [])].join(' ')).join(' ')
      for (const sentence of [def.blurb, def.frequency, def.sourcing, def.camera.honesty, ...def.safety]) expect(all).toContain(sentence)
    }
    // A step that asks for its bar twice says so in the guide.
    const handstand = GUIDES.find((guide) => guide.skill === 'handstand')!
    expect(handstand.sections.find((section) => section.heading === 'The road')!.body).toMatch(/two separate days/)
    expect(GUIDES.find((guide) => guide.skill === 'planche')!.sections.find((section) => section.heading === 'The road')!.body).not.toMatch(/two separate days/)
    // The kit sentence is said once, not twice in different words.
    const flag = GUIDES.find((guide) => guide.skill === 'flag')!
    const before = flag.sections.find((section) => section.heading === 'Before you start')!
    expect(before.bullets!.filter((line) => /\bpole\b/i.test(line)).length).toBe(1)
  })
})

describe('a road’s first step is training like any other', () => {
  it('eases the day after a hard Foundations session, on every road', () => {
    // The planche's Foundations hold is filed with the scapula drills, so a
    // beginner's RPE 9+ session was never "hard" and the next day was planned
    // as if nothing had happened — the one step where that mattered most.
    for (const skill of SKILL_IDS) {
      const state = startingState({ skills: [skill] })
      const key = STEP_BY_ID[stepOfSkill(state, skill)].keyExerciseId
      const session = (rpe: number): Session => ({
        ...sessionOf(state, T0, [0, 1, 2, 3].map((i) => ({
          exerciseId: key,
          kind: 'hold' as const,
          value: 14,
          target: 14,
          section: 'main' as const,
          at: T0 + (i + 1) * 60_000,
          calledAtTarget: true,
        }))),
        rpe,
        roles: { [skill]: 'lead' },
      })
      const after = (rpe: number) => planForToday(applySession(state, session(rpe)).next, T0 + DAY)
      expect(after(9.5).dayType, `${skill}: the day after RPE 9.5`).toBe('technique')
      expect(after(7).dayType, `${skill}: the day after RPE 7`).not.toBe('technique')
    }
  })
})

describe('the share card on every road', () => {
  it('draws the road it is about, not the planche’s', () => {
    const sample = buildSampleState()
    const now = Date.now()
    for (const skill of activeSkills(sample)) {
      const card = shareCardData(sample, now, undefined, skill)
      const road = stepsOf(skill)
      expect(card.skill).toBe(skill)
      expect(card.stepId, skill).toBe(stepOfSkill(sample, skill))
      expect(card.totalSteps, skill).toBe(road.length)
      expect(card.ladder.map((stop) => stop.stepId), skill).toEqual(road.map((step) => step.id))
      expect(card.ladder.filter((stop) => stop.state === 'current').length, skill).toBe(1)
      if (card.nextName) expect(road.map((step) => step.name), skill).toContain(card.nextName)
      expect(shareCardLines(card).label, skill).toContain(SKILLS[skill].name.toUpperCase())
    }
    // The planche card is the same read through any skill's view of the athlete.
    expect(shareCardData(skillView(sample, 'frontlever'), now, undefined, 'planche')).toEqual(shareCardData(sample, now, undefined, 'planche'))
    // The front lever's verified best is its own, not a planche hold's.
    const lever = shareCardData(sample, now, undefined, 'frontlever')
    expect(lever.stepName).toBe('Tuck Front Lever')
    expect(lever.verifiedBest).toBeGreaterThan(0)
    expect(lever.bar).toBe(STEP_BY_ID['fl-tuck'].unlockSec)
  })

  it('captions a step that just opened with the hold that opened it, on its own road', () => {
    const sample = buildSampleState()
    const card = shareCardData(sample, Date.now(), { stepId: 'fl-tuck', via: 'bar' })
    expect(card.skill).toBe('frontlever')
    expect(card.milestone?.fromName).toBe('Foundations')
    // The hang that opened it — not the planche step that happens to share its number.
    expect(card.milestone?.fromBest).toBeGreaterThanOrEqual(STEP_BY_ID['fl-hang'].unlockSec)
    const lines = shareCardLines(card)
    expect(lines.label).toBe('FRONT LEVER · NEW STEP · 2 OF 6')
    expect(lines.caption).toMatch(/Tuck Front Lever opened/)
    expect(lines.caption).not.toMatch(/planche/i)
  })
})

describe('focused sessions', () => {
  const offered = (skills: SkillId[], equipment?: AppState['profile']['equipment']) =>
    templatesFor(startingState({ skills, ...(equipment ? { equipment } : {}) })).map((template) => template.id)

  it('offers each athlete the sessions that serve a skill they train', () => {
    // Every template named in the map exists, and names real skills.
    for (const [id, skills] of Object.entries(TEMPLATE_SKILLS)) {
      expect(TEMPLATES.some((template) => template.id === id), id).toBe(true)
      for (const skill of skills) expect(SKILL_IDS, id).toContain(skill)
    }
    // A planche athlete sees what they always did — everything but the pulling session.
    expect(offered(['planche'])).toEqual(TEMPLATES.map((template) => template.id).filter((id) => id !== 'pull-strength'))
    // Someone training only the front lever is not offered planche leans.
    const lever = offered(['frontlever'])
    expect(lever).toContain('pull-strength')
    expect(lever).toContain('core-compression')
    for (const id of ['setup-practice', 'quick-ten', 'deload', 'balance-skill', 'push-strength']) expect(lever, id).not.toContain(id)
    // No session in a planche-less list is built around a planche hold.
    for (const skills of [['frontlever'], ['flag'], ['handstand'], ['ninety']] as SkillId[][]) {
      for (const template of templatesFor(startingState({ skills }))) {
        const leans = template.blocks.filter((block) => block.section === 'main' && skillOfExercise(block.exerciseId) === 'planche')
        // Balance & Skill keeps its frog stand beside the wall handstand; nothing else may lead with planche work.
        if (template.id !== 'balance-skill' && template.id !== 'wrist-armor') expect(leans.map((b) => b.exerciseId), `${skills[0]}: ${template.id}`).toEqual([])
      }
    }
    // Several skills: the union.
    expect(offered(['frontlever', 'planche'])).toEqual(TEMPLATES.map((template) => template.id))
  })

  it('does not offer a session whose main work needs kit the athlete does not have', () => {
    expect(offered(['frontlever'], ['floor'])).not.toContain('pull-strength')
    expect(offered(['frontlever'], ['floor', 'pullup-bar'])).toContain('pull-strength')
    // A saved request for a hidden template still resolves.
    const state = startingState({ skills: ['frontlever'] })
    expect(finalizeWorkoutWithPlan(state, { source: 'template', templateId: 'quick-ten' }).workout.blocks.length).toBeGreaterThan(0)
  })
})

describe('the sample athlete', () => {
  it('trains three skills, and every step and rung it stands on was earned through the engine', () => {
    const sample = buildSampleState()
    expect(activeSkills(sample)).toEqual(['planche', 'frontlever', 'handstand'])
    // Each road moved, by evidence the engine accepted.
    expect(sample.stepId).toBe('tuck')
    expect(trackOf(sample, 'frontlever').stepId).toBe('fl-tuck')
    expect(trackOf(sample, 'handstand').stepId).toBe('hs-wall')
    // The push-up line opened a rung on a replay-checked set — and the pike
    // push-ups logged before any were filmed did not count toward it.
    const ladder = ladderStatus(sample, 'handstand')!
    expect(ladder.index).toBeGreaterThanOrEqual(1)
    expect(Object.keys(ladder.openedAt).length).toBeGreaterThanOrEqual(1)
    const opened = Math.min(...Object.values(ladder.openedAt))
    expect(opened).toBeGreaterThan(sample.startedAt + 28 * DAY)
    // Replaying the saved history from nothing gives the same athlete.
    const rebuilt = rebuildDerivedState(sample)
    expect(rebuilt.stepId).toBe(sample.stepId)
    expect(trackOf(rebuilt, 'frontlever').stepId).toBe('fl-tuck')
    expect(trackOf(rebuilt, 'handstand').stepId).toBe('hs-wall')
    expect(rebuilt.achievements).toEqual(sample.achievements)
    // Every session says what each skill's part was, and which step it was on.
    for (const session of sample.sessions) {
      expect(session.roles?.planche, session.id).toBe('lead')
      expect(Object.values(session.roles ?? {}), session.id).toContain('partner')
      expect(session.skills?.frontlever?.stepId, session.id).toBeDefined()
      expect(session.skills?.handstand?.stepId, session.id).toBeDefined()
    }
    // The road strip counts every session that trained the road — the first
    // week's Foundations holds included — and starts where training did.
    const road = readJourney(sample, Date.now(), 'planche')
    expect(road.totalSessions).toBe(sample.sessions.length)
    expect(road.firstSessionAt).toBe(Math.min(...sample.sessions.map((session) => session.startedAt)))
    const leverRoad = readJourney(sample, Date.now(), 'frontlever')
    expect(leverRoad.totalSessions).toBe(sample.sessions.filter((session) => session.roles?.frontlever).length)
    // The form-trend card opens on the skill being looked at, and still lists the rest.
    for (const skill of activeSkills(sample)) {
      const listed = filmedExercisesFor(sample, skill)
      expect(skillOfExercise(listed[0]), skill).toBe(skill)
      expect([...listed].sort(), skill).toEqual([...filmedExercises(sample)].sort())
    }
    // It earned badges on more than one road, and today's session can be built from it.
    expect(sample.achievements['two-skills-session']).toBeDefined()
    expect(sample.achievements['rung-opened']).toBeDefined()
    const { workout } = finalizeWorkoutWithPlan(sample, { source: 'auto' })
    expect(workout.blocks.length).toBeGreaterThan(5)
    expect(JSON.stringify(workout)).not.toMatch(/undefined|NaN/)
    // Nothing saved fails the importer's own validation.
    expect(normalizeState(JSON.parse(JSON.stringify(sample))).sessions.length).toBe(sample.sessions.length)
  })
})

describe('the tip of the day', () => {
  it('has tips for every skill, each with a stated basis', () => {
    for (const skill of SKILL_IDS) expect(TIPS.filter((tip) => tip.skill === skill).length, skill).toBeGreaterThanOrEqual(3)
    expect(new Set(TIPS.map((tip) => tip.title)).size).toBe(TIPS.length)
    for (const tip of TIPS) {
      expect(BASIS_LABEL[tip.basis], tip.title).toBeTruthy()
      expect(tip.body.length, tip.title).toBeGreaterThan(40)
    }
  })

  it('never gives advice for a road the athlete is not on, and reaches every road they are', () => {
    const year = Array.from({ length: 365 }, (_, day) => T0 + day * DAY)
    const plancheOnly = year.map((at) => tipOfTheDay(at, ['planche']))
    expect(plancheOnly.every((tip) => !tip.skill || tip.skill === 'planche')).toBe(true)
    const leverOnly = year.map((at) => tipOfTheDay(at, ['frontlever']))
    expect(leverOnly.every((tip) => !tip.skill || tip.skill === 'frontlever')).toBe(true)
    expect(leverOnly.some((tip) => tip.skill === 'frontlever')).toBe(true)
    const everything = new Set(year.map((at) => tipOfTheDay(at, [...SKILL_IDS]).skill))
    for (const skill of SKILL_IDS) expect(everything.has(skill), skill).toBe(true)
    // The same calendar day gives the same tip, from just after midnight to
    // just before the next — in the athlete's own timezone, whatever that is.
    const morning = new Date(2026, 0, 5, 0, 5).getTime()
    const night = new Date(2026, 0, 5, 23, 55).getTime()
    expect(tipOfTheDay(morning, ['flag'])).toBe(tipOfTheDay(night, ['flag']))
    expect(tipOfTheDay(morning, ['flag'])).toBe(tipOfTheDay(T0, ['flag']))
    // And the next day moves on to the next tip in the pool.
    expect(tipOfTheDay(night + 600_000, ['flag'])).not.toBe(tipOfTheDay(night, ['flag']))
  })
})

describe('badges for every skill', () => {
  const earnedBy = (state: AppState, session: Session) => applySession(state, session).events.achievements

  it('gives each new skill its own badges, pointing at movements that exist', () => {
    for (const skill of SKILL_IDS) {
      expect(ACHIEVEMENTS.filter((badge) => badge.skill === skill).length, skill).toBeGreaterThanOrEqual(3)
    }
    const icons = ACHIEVEMENTS.filter((badge) => badge.skill && badge.skill !== 'planche').map((badge) => badge.icon)
    expect(new Set(icons).size, 'a new badge reuses another new badge’s icon').toBe(icons.length)
    // Every progress hint runs on an athlete with nothing logged, and starts at zero.
    const fresh = startingState({ skills: [...SKILL_IDS] })
    for (const badge of ACHIEVEMENTS) {
      const progress = badge.progress?.(fresh)
      if (progress) expect(progress.current, badge.id).toBe(0)
      expect(badge.desc.endsWith('.'), badge.id).toBe(true)
    }
  })

  it('awards a hold badge for verified seconds, never for the stopwatch', () => {
    const state = startingState({ skills: ['frontlever'], steps: { frontlever: 'fl-tuck' } })
    const timed: SetLog = { exerciseId: 'tuck-front-lever', kind: 'hold', value: 14, target: 10, section: 'main', at: T0 }
    expect(earnedBy(state, sessionOf(state, T0, [timed]))).not.toContain('fl-tuck-10')
    // Rated clean, never filmed: still only a number.
    const rated: SetLog = { ...timed, form: { rating: 'clean', confirmed: true } }
    expect(earnedBy(state, sessionOf(state, T0, [rated]))).not.toContain('fl-tuck-10')
    // The camera saw it break at 6s: six verified seconds, not ten.
    const broke = verifiedHold('tuck-front-lever', 14, T0)
    broke.form!.auto = { ...broke.form!.auto!, cleanSeconds: 6, cleanRatio: 6 / 14 }
    expect(earnedBy(state, sessionOf(state, T0, [broke]))).not.toContain('fl-tuck-10')
    expect(earnedBy(state, sessionOf(state, T0, [verifiedHold('tuck-front-lever', 10, T0)]))).toContain('fl-tuck-10')
    // A front lever badge is not earned by a planche hold of the same length.
    expect(earnedBy(state, sessionOf(state, T0, [verifiedHold('tuck-planche', 10, T0)]))).not.toContain('fl-tuck-10')
  })

  it('awards the push-up line’s badges for replay-checked reps only', () => {
    const state = startingState({ skills: ['handstand'], equipment: ['floor', 'wall', 'box', 'parallettes'] })
    const reviewed: SetLog['form'] = { rating: 'clean', confirmed: true, visualReviewPassed: true }
    const set = (exerciseId: string, reps: number, form?: SetLog['form']): SetLog => ({
      exerciseId,
      kind: 'reps',
      value: reps,
      target: reps,
      section: 'strength',
      at: T0,
      ...(form ? { form } : {}),
    })
    expect(earnedBy(state, sessionOf(state, T0, [set('wall-hspu', 5)]))).not.toContain('hspu-wall-1')
    expect(earnedBy(state, sessionOf(state, T0, [set('wall-hspu', 5, { rating: 'clean', confirmed: true })]))).not.toContain('hspu-wall-1')
    const one = earnedBy(state, sessionOf(state, T0, [set('wall-hspu', 1, reviewed)]))
    expect(one).toContain('hspu-wall-1')
    expect(one).not.toContain('hspu-wall-5')
    expect(earnedBy(state, sessionOf(state, T0, [set('wall-hspu', 5, reviewed)]))).toEqual(expect.arrayContaining(['hspu-wall-1', 'hspu-wall-5']))
    // Opening a rung is its own badge — and a set short of the standard does not earn it.
    const first = SKILLS.handstand.ladder!.rungs[0]
    expect(earnedBy(state, sessionOf(state, T0, [set(first.exerciseId, first.standardReps - 1, reviewed)]))).not.toContain('rung-opened')
    expect(earnedBy(state, sessionOf(state, T0, [set(first.exerciseId, first.standardReps, reviewed)]))).toContain('rung-opened')
  })

  it('knows a session that trained two skills, and an athlete verified on three', () => {
    let state = startingState({ skills: ['planche', 'frontlever', 'handstand'], steps: { planche: 'tuck', frontlever: 'fl-tuck', handstand: 'hs-wall' } })
    const lever = verifiedHold('tuck-front-lever', 6, T0)
    const planche = verifiedHold('tuck-planche', 6, T0 + 1)
    expect(earnedBy(state, sessionOf(state, T0, [lever]))).not.toContain('two-skills-session')
    // A warm-up primer of a second skill is not training it.
    expect(earnedBy(state, sessionOf(state, T0, [lever, { ...planche, section: 'warmup' }]))).not.toContain('two-skills-session')
    const both = applySession(state, sessionOf(state, T0, [lever, planche]))
    expect(both.events.achievements).toContain('two-skills-session')
    expect(both.events.achievements).not.toContain('three-roads')
    state = both.next
    const third = applySession(state, sessionOf(state, T0 + DAY, [verifiedHold('wall-handstand', 20, T0 + DAY)]))
    expect(third.events.achievements).toContain('three-roads')
  })

  it('widens the camera badges to every skill’s holds without touching support work', () => {
    const state = startingState({ skills: ['frontlever'], steps: { frontlever: 'fl-tuck' } })
    const highScore = (exerciseId: string): SetLog => {
      const hold = verifiedHold(exerciseId, 8, T0)
      hold.form!.auto = { ...hold.form!.auto!, score: 95, confidence: 0.9 }
      return hold
    }
    expect(earnedBy(state, sessionOf(state, T0, [highScore('tuck-front-lever')]))).toContain('precision-pass')
    expect(earnedBy(state, sessionOf(state, T0, [highScore('hollow-hold')]))).not.toContain('precision-pass')
    const long = Array.from({ length: 5 }, (_, i) => verifiedHold('tuck-front-lever', 25, T0 + i))
    expect(earnedBy(state, sessionOf(state, T0, long))).toContain('big-day')
    const core = long.map((hold) => ({ ...hold, exerciseId: 'hollow-hold' }))
    expect(earnedBy(state, sessionOf(state, T0, core))).not.toContain('big-day')
  })
})

describe('the line-up', () => {
  it('fits full parts and short doses by the time there is', () => {
    const lengths = [15, 24, 25, 29, 30, 45, 50, 51, 90]
    expect(lengths.map(fullParts)).toEqual([1, 1, 2, 2, 2, 2, 2, 2, 2])
    expect(lengths.map(shortDoses)).toEqual([0, 0, 0, 0, 1, 1, 1, 2, 2])
    expect(roomIn(20)).toBe('one skill')
    expect(roomIn(26)).toBe('two skills in full')
    expect(roomIn(45)).toBe('two skills in full and one short dose')
    expect(roomIn(60)).toBe('two skills in full and two short doses')
  })

  it('leads with the first priority and pairs it with a skill that loads different joints', () => {
    const state = startingState({ skills: ['planche', 'frontlever', 'ninety'] })
    const lineup = todaysLineup(state, T0)
    expect(lineup[0]).toMatchObject({ skill: 'planche', role: 'lead' })
    expect(lineup[1]).toMatchObject({ skill: 'frontlever', role: 'partner' })
    expect(lineup[1].reason).toMatch(/pulling pairs with the planche's pressing/)
    // The athlete's own order still counts for most: a second priority that
    // shares the lead's joints is marked down, not passed over — and nobody is
    // told two pushing skills "pair".
    const pushPush = todaysLineup(startingState({ skills: ['planche', 'ninety', 'frontlever'] }), T0)
    expect(pushPush[1]).toMatchObject({ skill: 'ninety', role: 'partner' })
    expect(pushPush[1].reason).not.toMatch(/pairs with/)
  })

  it('leaves out a skill whose kit is missing, and says what it needs', () => {
    const state = startingState({ skills: ['planche', 'frontlever', 'flag'], equipment: ['floor'] })
    expect(todaysLineup(state, T0).map((entry) => entry.skill)).toEqual(['planche'])
    expect(missingKit('frontlever', ['floor'])).toEqual([['pullup-bar', 'rings']])
    expect(missingKit('frontlever', ['floor', 'rings'])).toEqual([])
    expect(missingKit('handstand', ['floor'], 'hs-free')).toEqual([])
    for (const step of ['hs-foundations', 'hs-wall', 'hs-float'] as const) expect(missingKit('handstand', ['floor'], step)).toEqual([['wall']])
    expect(trainableSkills(['floor'])).toEqual(['planche', 'ninety'])
    // A focus skill the kit does not support is still the athlete's choice.
    const stuck = startingState({ skills: ['flag'], equipment: ['floor'] })
    expect(todaysLineup(stuck, T0).map((entry) => entry.skill)).toEqual(['flag'])
  })

  it('gives the short dose in its own form: balance practice, or two sets', () => {
    const state = startingState({ skills: ['planche', 'frontlever', 'handstand'] })
    const lineup = todaysLineup(state, T0, 45)
    expect(lineup.find((entry) => entry.skill === 'handstand')?.role).toBe('practice')
    // Practice is done fresh: straight after the lead in the listing, first in the running order.
    expect(lineup.map((entry) => entry.skill)).toEqual(['planche', 'handstand', 'frontlever'])
    // Not in a session too short to carry one.
    expect(todaysLineup(state, T0, 26).map((entry) => `${entry.skill}:${entry.role}`)).toEqual(['planche:lead', 'frontlever:partner'])
    // A strength skill's short dose is a couple of sets at its step.
    const strength = todaysLineup(startingState({ skills: ['planche', 'frontlever', 'flag'] }), T0, 45)
    expect(strength.map((entry) => `${entry.skill}:${entry.role}`)).toEqual(['planche:lead', 'frontlever:partner', 'flag:maintenance'])
    expect(strength[2].reason).toMatch(/short dose/)
  })

  it('never lets a short dose outrank the athlete’s own order', () => {
    // Balance practice once rode along in every session whatever its rank: the
    // last priority was in thirty sessions of thirty, the third in seven.
    const state = startingState({ skills: ['planche', 'frontlever', 'flag', 'handstand'] })
    const first = todaysLineup(state, T0, 45)
    expect(first.map((entry) => `${entry.skill}:${entry.role}`)).toEqual(['planche:lead', 'frontlever:partner', 'flag:maintenance'])
    // The one left out is told the rule, not given a day nobody can promise.
    expect(first[0].reason).toMatch(/Handstand push-up sits this one out/)
    expect(first[0].reason).toMatch(/two skills in full and one short dose/)
    expect(first[0].reason).toMatch(/waited longest, weighted by your order/)
    expect(first.map((entry) => entry.reason).join(' ')).not.toMatch(/this week|trains alone/)
    // Sixty minutes carries two short doses: all four skills.
    expect(todaysLineup(state, T0, 60).map((entry) => `${entry.skill}:${entry.role}`)).toEqual([
      'planche:lead',
      'handstand:practice',
      'frontlever:partner',
      'flag:maintenance',
    ])
    // A skill already practised today is not handed a second short dose.
    const practised: Session = {
      ...sessionOf(state, T0, [{ exerciseId: 'supported-flag', kind: 'hold', value: 5, target: 5, section: 'main', at: T0 }]),
      roles: { planche: 'lead', frontlever: 'partner', flag: 'maintenance' },
    }
    const later = todaysLineup({ ...state, sessions: [practised] }, T0 + 3 * 3_600_000, 45)
    expect(later.some((entry) => entry.skill === 'flag' && entry.role === 'maintenance')).toBe(false)
    // Even when it is the only skill left to give one to.
    const three = startingState({ skills: ['planche', 'frontlever', 'flag'] })
    const earlier: Session = {
      ...sessionOf(three, T0, [{ exerciseId: 'active-hang', kind: 'hold', value: 15, target: 15, section: 'main', at: T0 }]),
      roles: { planche: 'lead', frontlever: 'partner' },
    }
    const again = todaysLineup({ ...three, sessions: [earlier] }, T0 + 3 * 3_600_000, 45)
    expect(again.map((entry) => `${entry.skill}:${entry.role}`)).toEqual(['planche:lead', 'flag:partner'])
  })

  it('honours a session the athlete chose, in their order, and keeps tests and short doses to one skill', () => {
    const state = startingState({ skills: ['planche', 'frontlever', 'handstand', 'flag'] })
    expect(lineupFor(state, { source: 'auto', skills: ['flag'] }, T0).map((entry) => `${entry.skill}:${entry.role}`)).toEqual(['flag:lead'])
    expect(lineupFor(state, { source: 'auto', skills: ['flag', 'planche', 'handstand', 'frontlever'] }, T0).map((entry) => `${entry.skill}:${entry.role}`)).toEqual([
      'flag:lead',
      'planche:partner',
      'handstand:practice',
    ])
    expect(lineupFor(state, { source: 'test', stepId: 'fl-hang' }, T0).map((entry) => entry.skill)).toEqual(['frontlever'])
    expect(lineupFor(state, { source: 'micro', skills: ['handstand'] }, T0).map((entry) => entry.skill)).toEqual(['handstand'])
    const chosen = finalizeWorkoutWithPlan(state, { source: 'auto', skills: ['flag'] }, undefined, T0).workout
    expect(chosen.skills).toEqual(['flag'])
    expect(chosen.blocks.some((block) => skillOfExercise(block.exerciseId) === 'planche')).toBe(false)
  })

  it('records the part a skill actually had, not the part it was planned', () => {
    const state = startingState({ skills: ['planche', 'frontlever', 'flag'] })
    const { workout, lineup } = finalizeWorkoutWithPlan(state, { source: 'auto' }, undefined, T0)
    expect(lineup.map((entry) => `${entry.skill}:${entry.role}`)).toEqual(['planche:lead', 'frontlever:partner', 'flag:maintenance'])
    const done = (keep: (exerciseId: string, n: number) => boolean) => {
      const seen = new Map<string, number>()
      return workout.blocks.flatMap((block) =>
        Array.from({ length: block.sets }, () => {
          const n = (seen.get(block.exerciseId) ?? 0) + 1
          seen.set(block.exerciseId, n)
          return { exerciseId: block.exerciseId, section: block.section, value: keep(block.exerciseId, n) ? 5 : 0 }
        }).filter((set) => set.value > 0),
      )
    }
    // Everything done: the plan stands.
    expect(rolesTrained(lineup, workout.blocks, done(() => true))).toEqual({ planche: 'lead', frontlever: 'partner', flag: 'maintenance' })
    // Ended after the first skill's holds: the others had no part at all, and
    // the one that got nothing keeps its turn.
    const leadOnly = rolesTrained(lineup, workout.blocks, done((id) => skillOfExercise(id) === 'planche'))
    expect(leadOnly).toEqual({ planche: 'lead' })
    // One hold of a planned full part is a short dose, which is what it was.
    const partnerHolds = workout.blocks.filter((b) => b.section === 'main' && b.skill === 'frontlever').reduce((n, b) => n + b.sets, 0)
    expect(partnerHolds).toBeGreaterThanOrEqual(2)
    const oneHold = rolesTrained(
      lineup,
      [...workout.blocks, { exerciseId: 'active-hang', sets: 3, section: 'main' as const, skill: 'frontlever' as const }],
      done((id, n) => skillOfExercise(id) !== 'frontlever' || n === 1),
    )
    expect(oneHold.frontlever).toBe('maintenance')
    expect(oneHold.planche).toBe('lead')
    // Nothing logged, nothing recorded.
    expect(rolesTrained(lineup, workout.blocks, [])).toEqual({})
  })

  it('hands back the line-up of the session it built, not of the one it had planned', () => {
    const state = startingState({ skills: ['planche', 'frontlever', 'handstand'] })
    const checkIn = { at: T0, energy: 'ok' as const, joints: 'pain' as const, regions: ['elbow' as const] }
    const pain = finalizeWorkoutWithPlan(state, { source: 'auto' }, checkIn, T0)
    expect(pain.plan.loadPermission).toBe('none')
    // Home once listed three skills for "today's session" above a button that
    // built the pain-safe one.
    expect(pain.lineup).toEqual([])
    const usual = finalizeWorkoutWithPlan(state, { source: 'auto' }, undefined, T0)
    expect(usual.lineup.map((entry) => entry.skill)).toEqual(usual.workout.lineup!.map((entry) => entry.skill))
    // A short dose the minutes had room for on paper, but the two full parts fill.
    const heavy = startingState({
      skills: ['ninety', 'planche', 'flag'],
      steps: { ninety: 'n90-straddle', planche: 'oneleg', flag: 'flag-tuck' },
      sessionMinutes: 30,
    })
    expect(todaysLineup(heavy, T0).map((entry) => `${entry.skill}:${entry.role}`)).toEqual(['ninety:lead', 'planche:partner', 'flag:maintenance'])
    const built = finalizeWorkoutWithPlan(heavy, { source: 'auto' }, undefined, T0)
    expect(built.workout.minutes).toBeLessThanOrEqual(31)
    if (!built.lineup.some((entry) => entry.skill === 'flag')) {
      expect(built.workout.blocks.some((b) => b.skill === 'flag' && b.section === 'main')).toBe(false)
      expect((built.workout.adjustments ?? []).join(' ')).toMatch(/Human flag was due a short dose/)
    }
    for (const entry of built.lineup) {
      expect(built.workout.blocks.some((b) => b.section === 'main' && b.skill === entry.skill), entry.skill).toBe(true)
    }
  })

  it('does not take one cut-short hold for the athlete’s level', () => {
    // Placed on the wall handstand saying they hold it for twenty seconds; the
    // first session logged one hold of two. The next asked for five sets of
    // one second.
    const base = startingState({ skills: ['handstand'], steps: { handstand: 'hs-wall' } })
    const assessment = { at: T0 - DAY, answers: { 'wall-handstand': 20 }, placedStepId: 'hs-wall' as const, confidence: 'good' as const, gapIds: [] }
    const told: AppState = { ...base, tracks: { ...base.tracks, handstand: { ...trackOf(base, 'handstand'), assessment } } }
    const view = () => skillView(told, 'handstand')
    const targetOf = (state: AppState) => {
      const hold = finalizeWorkoutWithPlan(state, { source: 'auto' }, undefined, T0 + 2 * DAY).workout.blocks.find((b) => b.role === 'skill')!
      return hold.target.kind === 'hold' ? hold.target.sec : 0
    }
    const fresh = targetOf(told)
    expect(fresh).toBeGreaterThanOrEqual(8)
    const short = (at: number): Session => sessionOf(view(), at, [{ exerciseId: 'wall-handstand', kind: 'hold', value: 2, target: fresh, section: 'main', at }], `cut-${at}`)
    const one = applySession(told, short(T0)).next
    expect(targetOf(one), 'after one short hold').toBeGreaterThanOrEqual(5)
    expect(capacityOn(skillView(one, 'handstand'), 'hs-wall')).toBe(20)
    // Three sessions that agree are a level, and the answer no longer outvotes them.
    let three = one
    for (const day of [-6, -3]) three = applySession(three, short(T0 + day * DAY)).next
    expect(targetOf(three), 'after three short sessions').toBeLessThanOrEqual(2)
    expect(capacityOn(skillView(three, 'handstand'), 'hs-wall')).toBe(2)
  })

  it('keeps a lone unfinished wall hold as practice until a second day or a reported limit confirms it', () => {
    const base = startingState({ skills: ['handstand'], steps: { handstand: 'hs-wall' } })
    const view = skillView(base, 'handstand')
    const key = 'wall-handstand'
    const block = finalizeWorkoutWithPlan(base, { source: 'auto', skills: ['handstand'] }, undefined, T0).workout.blocks.find((b) => b.exerciseId === key && b.section === 'main')!
    const entry = (at: number, endReason?: SetLog['endReason']): Session => ({
      ...sessionOf(view, at, [{ exerciseId: key, section: 'main', kind: 'hold', value: 5.2, target: 20, at, endReason }]),
      completion: 'partial', remaining: { blocks: [{ ...block, sets: 5 }], skills: ['handstand'] },
    })
    const after = (session: Session, state = base) => applySession(state, session).next
    const target = (state: AppState) => adaptiveTarget(skillView(state, 'handstand'), 'hs-wall', T0 + 7 * DAY)
    const first = after(entry(T0))
    expect(first.prs[key].value).toBe(5.2)
    expect(target(first)).toBe(target(base))
    expect(target(after(entry(T0, 'interruption')))).toBe(target(base))
    expect(target(after(entry(T0, 'effort')))).toBeLessThan(target(base))
    expect(target(after(entry(T0 + 2 * DAY), first))).toBeLessThan(target(base))
  })

  it('does not let holds stopped at their calls outvote what the athlete said they can hold', () => {
    // Said twelve seconds of tuck lever; every working set since stopped at its
    // seven-second call. Those are floors. Read as "the most they have shown",
    // they shut next-shape practice after two sessions until the first re-test.
    const base = startingState({ skills: ['frontlever'], steps: { frontlever: 'fl-tuck' } })
    const assessment = { at: T0 - DAY, answers: { 'tuck-front-lever': 12 }, placedStepId: 'fl-tuck' as const, confidence: 'good' as const, gapIds: [] }
    let state: AppState = { ...base, tracks: { ...base.tracks, frontlever: { ...trackOf(base, 'frontlever'), assessment } } }
    const view = () => skillView(state, 'frontlever')
    expect(capacityOn(view(), 'fl-tuck')).toBe(12)
    expect(bridgeStatus(view(), 'fl-tuck')?.open).toBe(true)
    for (let i = 0; i < 5; i++) {
      const at = T0 + i * 2 * DAY
      const calls = [1, 2, 3].map((n) => ({ ...verifiedHold('tuck-front-lever', 7, at + n * 60_000), endReason: undefined, calledAtTarget: true }))
      state = applySession(state, sessionOf(view(), at, calls, `call-${i}`)).next
      expect(capacityOn(view(), 'fl-tuck'), `after ${i + 1} sessions stopped at the call`).toBe(12)
      expect(bridgeStatus(view(), 'fl-tuck')?.open, `after ${i + 1} sessions`).toBe(true)
    }
    // A hold that fell short is a measurement, and three sessions in, it is the level.
    const at = T0 + 12 * DAY
    state = applySession(state, sessionOf(view(), at, [{ ...verifiedHold('tuck-front-lever', 4, at + 60_000), target: 7 }], 'short')).next
    expect(capacityOn(view(), 'fl-tuck')).toBeLessThan(12)
  })

  it('steers the second part and the short doses round a joint flagged today', () => {
    const state = startingState({ skills: ['planche', 'handstand', 'frontlever'] })
    // The handstand is second in the athlete's order, and takes the second part…
    expect(todaysLineup(state, T0, 45).map((entry) => `${entry.skill}:${entry.role}`)).toEqual(['planche:lead', 'handstand:partner', 'frontlever:maintenance'])
    // …until a wrist is flagged: the front lever is the one skill here that
    // leaves the wrist alone. It once went the other way — the handstand kept,
    // the lever dropped — under a form that said the plan leaves out whatever
    // loads the area you name. And since the fifth review it leads: the
    // planche once led a wrist-niggle day regardless, one set lighter. The
    // planche, first priority, takes the second part, eased with the rest.
    const flagged = reducer(state, { type: 'RECORD_SYMPTOM', event: { at: T0 - 60_000, joints: 'niggle', regions: ['wrist'], source: 'check-in' } })
    expect(niggleRegionsToday(flagged, T0)).toEqual(['wrist'])
    const lineup = todaysLineup(flagged, T0, 45)
    expect(lineup.map((entry) => `${entry.skill}:${entry.role}`)).toEqual(['frontlever:lead', 'planche:partner'])
    expect(lineup[0].reason).toMatch(/loads the wrist you flagged today/)
    // The day itself is eased, and says one thing about it.
    const { plan, workout } = finalizeWorkoutWithPlan(flagged, { source: 'auto' }, undefined, T0)
    expect(plan.loadPermission).toBe('reduced')
    expect(plan.dayType).not.toBe('push')
    expect(plan.challengeAllowed).toBe(false)
    expect([plan.dayReason, ...plan.decisions.map((d) => d.text)].join(' ')).not.toMatch(/today pushes/)
    expect(workout.blocks.some((b) => b.role === 'attempt')).toBe(false)
    expect(workout.blocks.some((b) => b.skill === 'handstand')).toBe(false)
    // A report made a minute ago is "today", however it reached the plan.
    expect(challengeBlockedReason(plan)).toBe('you flagged a joint today')
    // Yesterday's is not today's — but with no check-in since, it still stands (round seven): the line-up reads the
    // report the coach's open concern and the lifts read (`standingNiggle`), and says when it was flagged. A later
    // all-good check-in gives the athlete's order back.
    expect(niggleRegionsToday(flagged, T0 + DAY)).toEqual([])
    expect(todaysLineup(flagged, T0 + DAY, 45)[0].skill).toBe('frontlever')
    expect(todaysLineup(flagged, T0 + DAY, 45)[0].reason).not.toMatch(/flagged today/)
    const cleared = reducer(flagged, { type: 'RECORD_SYMPTOM', event: { at: T0 + DAY - 3_600_000, joints: 'good', source: 'check-in' } })
    expect(todaysLineup(cleared, T0 + DAY, 45)[1].skill).toBe('handstand')
    // An elbow or pain takes the load off altogether, so there is nothing to steer.
    const elbow = reducer(state, { type: 'RECORD_SYMPTOM', event: { at: T0 - 60_000, joints: 'niggle', regions: ['elbow'], source: 'check-in' } })
    expect(niggleRegionsToday(elbow, T0)).toEqual([])
    expect(finalizeWorkoutWithPlan(elbow, { source: 'auto' }, undefined, T0).lineup).toEqual([])
  })

  it('does not close a session that had a pain report in it on a number', () => {
    const state = startingState({ skills: ['planche'], steps: { planche: 'lean' } })
    const session = sessionOf(state, T0, [verifiedHold('planche-lean', 11, T0 + 60_000), verifiedHold('planche-lean', 6, T0 + 180_000)])
    const after = applySession(state, session).next
    const targets = { before: 11, after: 7 }
    const quiet = debriefSession(state, after, session, targets)
    expect(painReportedIn(after, session)).toBe(false)
    expect(quiet.map((d) => d.text).join(' ')).toMatch(/Working target moves 11s → 7s/)
    // The same session with pain reported mid-set.
    const hurt = reducer(after, { type: 'RECORD_SYMPTOM', event: { at: T0 + 200_000, joints: 'pain', regions: ['wrist'], source: 'attempt' } })
    expect(painReportedIn(hurt, session)).toBe(true)
    const said = debriefSession(state, hurt, session, targets)
    expect(said[0].kind).toBe('warn')
    expect(said[0].text).toMatch(/reported joint pain in this session/)
    expect(said.map((d) => d.text).join(' ')).not.toMatch(/Working target moves/)
    // Withdrawn, it is as if it had not been said.
    const undone = reducer(hurt, { type: 'RECORD_SYMPTOM', event: { at: T0 + 210_000, joints: 'pain', regions: ['wrist'], source: 'attempt', correction: true } })
    expect(painReportedIn(undone, session)).toBe(false)
    // A report from another day is not this session's.
    const earlier = reducer(after, { type: 'RECORD_SYMPTOM', event: { at: T0 - 3 * DAY, joints: 'pain', regions: ['wrist'], source: 'check-in' } })
    expect(painReportedIn(earlier, session)).toBe(false)
  })

  it('does not count a maintenance dose as a training day', () => {
    const state = startingState({ skills: ['planche', 'frontlever', 'ninety'] })
    const maintenance: Session = {
      ...sessionOf(state, T0, [{ exerciseId: 'bent-arm-lean-hold', kind: 'hold', value: 8, target: 8, section: 'main', at: T0 }]),
      roles: { planche: 'lead', frontlever: 'partner', ninety: 'maintenance' },
    }
    const after = { ...state, sessions: [maintenance] }
    expect(daysSinceFullPart(after, 'ninety', T0 + 2 * DAY)).toBeNull()
    expect(daysSinceFullPart(after, 'frontlever', T0 + 2 * DAY)).toBe(2)
    // From before roles were kept, any work on the skill is taken as a full day.
    const legacy = { ...state, sessions: [{ ...maintenance, roles: undefined }] }
    expect(daysSinceFullPart(legacy, 'ninety', T0 + 2 * DAY)).toBe(2)
  })
})

describe('shared predicates and the week’s work', () => {
  it('knows a skill’s own hold from an accessory', () => {
    expect(isSkillHold(EXERCISE_BY_ID['front-lever'])).toBe(true)
    expect(isSkillHold(EXERCISE_BY_ID['wall-handstand'])).toBe(true)
    expect(isSkillHold(EXERCISE_BY_ID['hollow-hold'])).toBe(false)
    expect(isSkillHold(EXERCISE_BY_ID['pullup'])).toBe(false)
    expect(isSurfaceAware(EXERCISE_BY_ID['tuck-planche'])).toBe(true)
    expect(isSurfaceAware(EXERCISE_BY_ID['ninety-hold'])).toBe(true)
    expect(isSurfaceAware(EXERCISE_BY_ID['front-lever'])).toBe(false)
    expect(assistAppliesTo(EXERCISE_BY_ID['straddle-front-lever'])).toBe(true)
    // The wall is the point of a wall hold; a hang has nothing to assist.
    expect(assistAppliesTo(EXERCISE_BY_ID['wall-handstand'])).toBe(false)
    expect(assistAppliesTo(EXERCISE_BY_ID['active-hang'])).toBe(false)
    expect(assistAppliesTo(EXERCISE_BY_ID['frog-stand'])).toBe(false)
  })

  it('counts a week in each skill’s own currencies', () => {
    expect(workSets('frontlever').strength.has('pullup')).toBe(true)
    expect(workSets('frontlever').strength.has('fl-negative')).toBe(true)
    expect(workSets('planche').strength.has('pppu')).toBe(true)
    let state = startingState({ skills: ['frontlever'], steps: { frontlever: 'fl-tuck' } })
    const now = T0 + 2 * 3_600_000
    state = {
      ...state,
      sessions: [
        sessionOf(state, T0, [
          { exerciseId: 'tuck-front-lever', kind: 'hold', value: 6, target: 6, section: 'main', at: T0 },
          { exerciseId: 'tuck-front-lever', kind: 'hold', value: 5, target: 6, section: 'main', at: T0 + 1 },
          { exerciseId: 'pullup', kind: 'reps', value: 5, target: 5, section: 'strength', at: T0 + 2 },
          { exerciseId: 'pppu', kind: 'reps', value: 9, target: 9, section: 'strength', at: T0 + 3 },
          { exerciseId: 'band-front-lever', kind: 'hold', value: 20, target: 20, section: 'strength', at: T0 + 4 },
          { exerciseId: 'dead-hang', kind: 'hold', value: 20, target: 20, section: 'warmup', at: T0 + 5 },
        ]),
      ],
    }
    const work = weekWork(skillView(state, 'frontlever'), now)
    expect(work).toMatchObject({ sessions: 1, skillSec: 11, pressReps: 5, straightArmSec: 20 })
  })
})
