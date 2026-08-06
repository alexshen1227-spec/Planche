import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import { BODY_REGIONS, CURRENT_STATE_VERSION } from '../types'
import type {
  AppState,
  AssessmentRecord,
  AutoForm,
  BodyRegion,
  CheckIn,
  EquipmentId,
  FormCheck,
  FormIssue,
  Measurement,
  Profile,
  Session,
  SetLog,
  Settings,
  StepId,
  TrainingSurface,
  Units,
} from '../types'
import { STEPS, STEP_BY_ID } from '../data/progressions'
import { EXERCISE_BY_ID } from '../data/exercises'
import { ACHIEVEMENT_VERSION } from '../data/achievements'
import { applySession } from './engine'
import { configureAudio } from './audio'
import { readMirror, requestPersistence, writeMirror } from './persist'
import { pushToast } from './toast'

const STORAGE_KEY = 'planchelab.v1'
const THEME_KEY = 'planchelab.theme'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  sound: true,
  volume: 0.7,
  voice: true,
  restMainSec: 150,
  restAccessorySec: 90,
  weeklyGoal: 3,
  warmup: true,
  beeps: true,
  sessionMinutes: 30,
  // Regular-hold calibration. Main Path holds use their longer fixed allowance
  // unless the athlete says the phone is within reach.
  stopLatencySec: 2.3,
  phoneWithinReach: false,
  units: 'metric',
  recordForm: true,
  autoAnalyze: true,
}

/**
 * Stop-latency defaults that have since been superseded. Filming means the
 * phone is propped up across the room, so getting out of the hold and back to
 * the button takes considerably longer than the first estimates assumed.
 */
const LEGACY_LATENCIES = [0.4, 1]

export function initialState(): AppState {
  return {
    version: CURRENT_STATE_VERSION,
    onboarded: false,
    name: '',
    startedAt: Date.now(),
    stepId: 'foundations',
    baseStepId: 'foundations',
    unlocked: ['foundations'],
    sessions: [],
    prs: {},
    achievementVersion: ACHIEVEMENT_VERSION,
    achievements: {},
    videoLinks: {},
    profile: { equipment: ['floor'], preferredSurface: 'floor', goalStepId: 'straddle' },
    measurements: [],
    settings: { ...DEFAULT_SETTINGS },
  }
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
}

const FORM_RATINGS = new Set(['clean', 'slipped', 'broke'])
// Must list every FormIssue. Anything missing here is silently stripped from
// saved sessions on the next load, which quietly discards what the camera
// detected — keep this in step with the union in types.ts.
const FORM_ISSUES = new Set<FormIssue>([
  'arms',
  'scapula',
  'shrug',
  'pike',
  'sag',
  'closed',
  'knees',
  'lean',
  'twist',
  'narrow',
  'hips',
  'level',
])
const EQUIPMENT_IDS = new Set(['floor', 'parallettes', 'band', 'pullup-bar', 'dip-bars'])
const TRAINING_SURFACES = new Set<TrainingSurface>(['floor', 'parallettes'])
const SECTIONS = new Set(['warmup', 'main', 'strength', 'core', 'cooldown'])
const STRATEGIES = new Set(['balanced', 'volume', 'intensity', 'density', 'technique'])

/**
 * A hand-edited `issues` string would otherwise be iterated per character.
 *
 * Every validated field is assigned unconditionally. Spreading first and then
 * overriding *conditionally* looks like it preserves unknown fields, but it
 * silently re-admits exactly the malformed values this exists to reject.
 */
function sanitizeForm(f: unknown): FormCheck | undefined {
  if (typeof f !== 'object' || f === null) return undefined
  const c = f as Partial<FormCheck>
  if (typeof c.rating !== 'string' || !FORM_RATINGS.has(c.rating)) return undefined

  const issues = Array.isArray(c.issues)
    ? c.issues.filter((i): i is FormIssue => typeof i === 'string' && FORM_ISSUES.has(i as FormIssue))
    : []

  const out: FormCheck = { rating: c.rating as FormCheck['rating'] }
  if (typeof c.confirmed === 'boolean') out.confirmed = c.confirmed
  if (typeof c.visualReviewPassed === 'boolean') out.visualReviewPassed = c.visualReviewPassed
  if (typeof c.flightConfirmed === 'boolean') out.flightConfirmed = c.flightConfirmed
  if (issues.length) out.issues = issues
  if (typeof c.clipKey === 'string') out.clipKey = c.clipKey

  const auto = sanitizeAuto(c.auto)
  if (auto) out.auto = auto
  return out
}

/** `auto.issues` is iterated directly, so a missing array crashes every screen. */
function sanitizeAuto(a: unknown): AutoForm | undefined {
  if (typeof a !== 'object' || a === null) return undefined
  const c = a as Partial<AutoForm>
  const issues = Array.isArray(c.issues)
    ? c.issues.filter((i): i is FormIssue => typeof i === 'string' && FORM_ISSUES.has(i as FormIssue))
    : []
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  // `unseen` must round-trip: losing it on import would quietly re-arm unlock
  // evidence whose elbows the camera never actually saw.
  const unseen = Array.isArray(c.unseen)
    ? c.unseen.filter((u): u is string => typeof u === 'string').slice(0, 8)
    : []
  return {
    issues,
    ...(unseen.length ? { unseen } : {}),
    confidence: num(c.confidence) ?? 0,
    score: clampOptional(c.score, 0, 100),
    cleanSeconds: clampOptional(c.cleanSeconds, 0, 3600),
    cleanRatio: clampOptional(c.cleanRatio, 0, 1),
    elbowDeg: num(c.elbowDeg),
    kneeDeg: num(c.kneeDeg),
    hipAngleDeg: num(c.hipAngleDeg),
    hipOffset: num(c.hipOffset),
    leanRatio: num(c.leanRatio),
    shrugRatio: num(c.shrugRatio),
    asymmetry: num(c.asymmetry),
    wobble: num(c.wobble),
  }
}

function clampOptional(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined
}

const JOINT_STATES = new Set(['good', 'niggle', 'pain'])
const ENERGY_STATES = new Set(['fresh', 'ok', 'tired'])
const SLEEP_STATES = new Set(['good', 'ok', 'poor'])
const REGION_IDS = new Set<BodyRegion>(BODY_REGIONS)

/**
 * A check-in drives safety rails, so every field is validated rather than
 * waved through. An imported file claiming `regions: 'elbow'` (a string, not an
 * array) would otherwise be spread into a rail that iterates it per character.
 */
function sanitizeCheckIn(raw: unknown): CheckIn | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const c = raw as Partial<CheckIn>
  if (typeof c.joints !== 'string' || !JOINT_STATES.has(c.joints)) return undefined
  if (typeof c.energy !== 'string' || !ENERGY_STATES.has(c.energy)) return undefined
  if (typeof c.at !== 'number' || !Number.isFinite(c.at)) return undefined
  const regions = Array.isArray(c.regions)
    ? [...new Set(c.regions.filter((r): r is BodyRegion => typeof r === 'string' && REGION_IDS.has(r)))]
    : []
  const out: CheckIn = { joints: c.joints, energy: c.energy, at: c.at }
  if (regions.length) out.regions = regions
  if (typeof c.sleep === 'string' && SLEEP_STATES.has(c.sleep)) out.sleep = c.sleep
  return out
}

/** Placement answers are numbers keyed by known item ids; anything else goes. */
function sanitizeAssessment(raw: unknown): AssessmentRecord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const c = raw as Partial<AssessmentRecord>
  if (typeof c.at !== 'number' || !Number.isFinite(c.at)) return undefined
  if (typeof c.placedStepId !== 'string' || !STEP_BY_ID[c.placedStepId as StepId]) return undefined
  const answers: Record<string, number> = {}
  if (typeof c.answers === 'object' && c.answers !== null) {
    for (const [k, v] of Object.entries(c.answers)) {
      if (typeof k === 'string' && typeof v === 'number' && Number.isFinite(v)) {
        answers[k.slice(0, 40)] = Math.min(3600, Math.max(0, v))
      }
    }
  }
  return {
    at: c.at,
    answers,
    placedStepId: c.placedStepId as StepId,
    confidence:
      c.confidence === 'good' || c.confidence === 'moderate' || c.confidence === 'low' ? c.confidence : 'low',
    gapIds: Array.isArray(c.gapIds)
      ? c.gapIds.filter((g): g is string => typeof g === 'string').slice(0, 8)
      : [],
  }
}

/**
 * Drop anything that would crash the app downstream. An imported file is
 * untrusted input: a session without a `sets` array used to white-screen every
 * screen that sums it, and the bad state was already persisted by then.
 */
function sanitizeSessions(raw: unknown): Session[] {
  if (!Array.isArray(raw)) return []
  const out: Session[] = []
  const ids = new Set<string>()
  for (const s of raw) {
    if (typeof s !== 'object' || s === null) continue
    const c = s as Partial<Session>
    if (typeof c.startedAt !== 'number' || !Number.isFinite(c.startedAt)) continue
    const sets: SetLog[] = []
    if (Array.isArray(c.sets)) {
      for (const rawSet of c.sets) {
        if (typeof rawSet !== 'object' || rawSet === null) continue
        const x = rawSet as Partial<SetLog>
        const exercise = typeof x.exerciseId === 'string' ? EXERCISE_BY_ID[x.exerciseId] : undefined
        if (!exercise || typeof x.value !== 'number' || !Number.isFinite(x.value)) continue
        const kind = x.kind === 'hold' || x.kind === 'reps' ? x.kind : exercise.type
        const section = typeof x.section === 'string' && SECTIONS.has(x.section) ? x.section : 'main'
        sets.push({
          exerciseId: exercise.id,
          kind,
          value: clampNum(x.value, 0, kind === 'hold' ? 3600 : 1000, 0),
          ...(typeof x.raw === 'number' && Number.isFinite(x.raw)
            ? { raw: clampNum(x.raw, 0, 3600, 0) }
            : {}),
          target: clampNum(x.target, 0, kind === 'hold' ? 3600 : 1000, 0),
          section: section as SetLog['section'],
          at: typeof x.at === 'number' && Number.isFinite(x.at) ? x.at : c.startedAt,
          ...(x.side === 'left' || x.side === 'right' ? { side: x.side } : {}),
          ...(typeof x.surface === 'string' && TRAINING_SURFACES.has(x.surface as TrainingSurface)
            ? { surface: x.surface as TrainingSurface }
            : {}),
          ...(typeof x.leadInSec === 'number' && Number.isFinite(x.leadInSec)
            ? { leadInSec: clampNum(x.leadInSec, 0, 60, 0) }
            : {}),
          ...(typeof x.clipKey === 'string' ? { clipKey: x.clipKey } : {}),
          ...(sanitizeForm(x.form) ? { form: sanitizeForm(x.form) } : {}),
        })
      }
    }
    let id = typeof c.id === 'string' && c.id ? c.id : crypto.randomUUID()
    if (ids.has(id)) id = crypto.randomUUID()
    ids.add(id)
    const checkIn = sanitizeCheckIn(c.checkIn)
    const endedAt = typeof c.endedAt === 'number' && Number.isFinite(c.endedAt) ? c.endedAt : c.startedAt
    out.push({
      id,
      startedAt: c.startedAt,
      endedAt,
      ...(typeof c.pausedMs === 'number' && Number.isFinite(c.pausedMs)
        ? { pausedMs: clampNum(c.pausedMs, 0, Math.max(0, endedAt - c.startedAt), 0) }
        : {}),
      workoutName: typeof c.workoutName === 'string' ? c.workoutName : 'Session',
      workoutKind: c.workoutKind === 'template' || c.workoutKind === 'test' ? c.workoutKind : 'auto',
      stepId: c.stepId && STEP_BY_ID[c.stepId] ? c.stepId : 'foundations',
      sets,
      rpe: typeof c.rpe === 'number' && Number.isFinite(c.rpe) ? clampNum(c.rpe, 1, 10, 8) : undefined,
      notes: typeof c.notes === 'string' ? c.notes : undefined,
      strategy: typeof c.strategy === 'string' && STRATEGIES.has(c.strategy) ? c.strategy : undefined,
      checkIn,
    })
  }
  return out
}

/** Coerce anything (old versions, imported files) into a valid AppState. */
export function normalizeState(raw: unknown): AppState {
  const base = initialState()
  if (typeof raw !== 'object' || raw === null) return base
  const r = raw as Partial<AppState>
  const priorVersion = typeof r.version === 'number' ? r.version : 1
  const stepId: StepId = r.stepId && STEP_BY_ID[r.stepId] ? r.stepId : 'foundations'
  const unlocked = Array.isArray(r.unlocked)
    ? (r.unlocked.filter((id): id is StepId => typeof id === 'string' && id in STEP_BY_ID) as StepId[])
    : []
  if (!unlocked.includes('foundations')) unlocked.unshift('foundations')
  if (!unlocked.includes(stepId)) unlocked.push(stepId)
  const highestUnlocked = unlocked.reduce<StepId>(
    (highest, id) => (STEP_BY_ID[id].order > STEP_BY_ID[highest].order ? id : highest),
    'foundations',
  )
  const grandfatheredStepId =
    // Any version bump anchors the athlete at what they had already earned.
    // v4 could not store the human "feet stayed unsupported" confirmation, so
    // v5 needed this to avoid revoking steps under stricter evidence; v6 adds
    // no new gate, and re-anchoring is a no-op for those saves because the
    // floor only ever moves up. Keeping it unconditional means the next
    // version that *does* tighten evidence cannot silently demote anybody.
    priorVersion < CURRENT_STATE_VERSION
      ? highestUnlocked
      : r.grandfatheredStepId && STEP_BY_ID[r.grandfatheredStepId]
        ? r.grandfatheredStepId
        : undefined

  const rawSettings = (typeof r.settings === 'object' && r.settings !== null ? r.settings : {}) as Partial<Settings>
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...rawSettings,
    // Numeric settings come from an editable file; a zero or NaN here would
    // stall loops and divide-by-zero their way across the whole UI.
    weeklyGoal: clampNum(rawSettings.weeklyGoal, 1, 14, DEFAULT_SETTINGS.weeklyGoal),
    sessionMinutes: clampNum(rawSettings.sessionMinutes, 5, 120, DEFAULT_SETTINGS.sessionMinutes),
    restMainSec: clampNum(rawSettings.restMainSec, 15, 600, DEFAULT_SETTINGS.restMainSec),
    restAccessorySec: clampNum(rawSettings.restAccessorySec, 10, 600, DEFAULT_SETTINGS.restAccessorySec),
    stopLatencySec: clampNum(rawSettings.stopLatencySec, 0, 5, DEFAULT_SETTINGS.stopLatencySec),
    volume: clampNum(rawSettings.volume, 0, 1, DEFAULT_SETTINGS.volume),
    // An unrecognised unit would silently make the whole app read imperial.
    units: rawSettings.units === 'imperial' ? 'imperial' : 'metric',
    theme:
      rawSettings.theme === 'light' || rawSettings.theme === 'system' ? rawSettings.theme : DEFAULT_SETTINGS.theme,
    sound: typeof rawSettings.sound === 'boolean' ? rawSettings.sound : DEFAULT_SETTINGS.sound,
    voice: typeof rawSettings.voice === 'boolean' ? rawSettings.voice : DEFAULT_SETTINGS.voice,
    warmup: typeof rawSettings.warmup === 'boolean' ? rawSettings.warmup : DEFAULT_SETTINGS.warmup,
    beeps: typeof rawSettings.beeps === 'boolean' ? rawSettings.beeps : DEFAULT_SETTINGS.beeps,
    recordForm: typeof rawSettings.recordForm === 'boolean' ? rawSettings.recordForm : DEFAULT_SETTINGS.recordForm,
    autoAnalyze: typeof rawSettings.autoAnalyze === 'boolean' ? rawSettings.autoAnalyze : DEFAULT_SETTINGS.autoAnalyze,
    phoneWithinReach:
      typeof rawSettings.phoneWithinReach === 'boolean'
        ? rawSettings.phoneWithinReach
        : DEFAULT_SETTINGS.phoneWithinReach,
  }
  // One-time migration: anyone still carrying the old optimistic default gets
  // the realistic one. Deliberate choices made after this are left alone.
  if (priorVersion < 3 && LEGACY_LATENCIES.includes(settings.stopLatencySec)) {
    settings.stopLatencySec = DEFAULT_SETTINGS.stopLatencySec
  }

  return {
    version: CURRENT_STATE_VERSION,
    onboarded: Boolean(r.onboarded),
    name: typeof r.name === 'string' ? r.name : '',
    startedAt: typeof r.startedAt === 'number' ? r.startedAt : Date.now(),
    lastBackupAt: typeof r.lastBackupAt === 'number' ? r.lastBackupAt : undefined,
    measureSnoozedAt: typeof r.measureSnoozedAt === 'number' ? r.measureSnoozedAt : undefined,
    ...(sanitizeAssessment(r.assessment) ? { assessment: sanitizeAssessment(r.assessment) } : {}),
    stepId,
    // Older saves predate this field and their placement is unrecoverable, so
    // anchor at the current step: never demote someone who is already there.
    baseStepId: r.baseStepId && STEP_BY_ID[r.baseStepId] ? r.baseStepId : stepId,
    ...(grandfatheredStepId ? { grandfatheredStepId } : {}),
    unlocked,
    sessions: sanitizeSessions(r.sessions),
    prs:
      typeof r.prs === 'object' && r.prs !== null
        ? Object.fromEntries(
            Object.entries(r.prs).flatMap(([id, rawPr]) => {
              if (
                !EXERCISE_BY_ID[id] ||
                typeof rawPr !== 'object' ||
                rawPr === null ||
                typeof rawPr.value !== 'number' ||
                !Number.isFinite(rawPr.value) ||
                typeof rawPr.at !== 'number' ||
                !Number.isFinite(rawPr.at)
              ) {
                return []
              }
              const bySurface =
                typeof rawPr.bySurface === 'object' && rawPr.bySurface !== null
                  ? Object.fromEntries(
                      Object.entries(rawPr.bySurface).filter(
                        ([surface, mark]) =>
                          TRAINING_SURFACES.has(surface as TrainingSurface) &&
                          typeof mark === 'object' &&
                          mark !== null &&
                          typeof mark.value === 'number' &&
                          Number.isFinite(mark.value) &&
                          typeof mark.at === 'number' &&
                          Number.isFinite(mark.at),
                      ),
                    )
                  : {}
              return [[id, { value: rawPr.value, at: rawPr.at, ...(Object.keys(bySurface).length ? { bySurface } : {}) }]]
            }),
          )
        : {},
    achievementVersion:
      typeof r.achievementVersion === 'number' && Number.isFinite(r.achievementVersion)
        ? Math.min(ACHIEVEMENT_VERSION, Math.max(0, Math.floor(r.achievementVersion)))
        : 0,
    achievements:
      typeof r.achievements === 'object' && r.achievements !== null
        ? Object.fromEntries(
            Object.entries(r.achievements).filter(([, at]) => typeof at === 'number' && Number.isFinite(at)),
          )
        : {},
    videoLinks:
      typeof r.videoLinks === 'object' && r.videoLinks !== null
        ? Object.fromEntries(
            Object.entries(r.videoLinks).filter(
              ([id, url]) => Boolean(EXERCISE_BY_ID[id]) && typeof url === 'string',
            ),
          )
        : {},
    profile: {
      equipment: (() => {
        const valid = Array.isArray(r.profile?.equipment)
          ? r.profile.equipment.filter((e): e is EquipmentId => typeof e === 'string' && EQUIPMENT_IDS.has(e))
          : []
        return valid.length ? valid : (['floor'] as EquipmentId[])
      })(),
      heightCm: clampOptional(r.profile?.heightCm, 100, 250),
      injuryNote: typeof r.profile?.injuryNote === 'string' ? r.profile.injuryNote : undefined,
      birthYear: clampOptional(r.profile?.birthYear, 1920, new Date().getFullYear()),
      trainingAgeMonths: clampOptional(r.profile?.trainingAgeMonths, 0, 1200),
      preferredSurface:
        typeof r.profile?.preferredSurface === 'string' &&
        TRAINING_SURFACES.has(r.profile.preferredSurface as TrainingSurface) &&
        (r.profile.preferredSurface !== 'parallettes' || r.profile?.equipment?.includes('parallettes'))
          ? (r.profile.preferredSurface as TrainingSurface)
          : r.profile?.equipment?.includes('parallettes') && !r.profile?.equipment?.includes('floor')
            ? 'parallettes'
            : 'floor',
      goalStepId:
        typeof r.profile?.goalStepId === 'string' && STEP_BY_ID[r.profile.goalStepId as StepId]
          ? (r.profile.goalStepId as StepId)
          : 'straddle',
    },
    measurements: Array.isArray(r.measurements)
      ? r.measurements
          .filter(
            (m): m is Measurement =>
              typeof m === 'object' && m !== null && typeof (m as Measurement).at === 'number',
          )
          .map((m) => ({
            at: m.at,
            weightKg: clampOptional(m.weightKg, 20, 400),
            heightCm: clampOptional(m.heightCm, 100, 250),
          }))
          .sort((a, b) => a.at - b.at)
      : [],
    settings,
  }
}

/** Whether boot found a usable primary copy — drives mirror-restore logic. */
let bootedFresh = false

/** Kept so a bad migration is recoverable rather than terminal. */
const BACKUP_KEY = 'planchelab.prev'

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      bootedFresh = true
      return initialState()
    }
    const parsed = JSON.parse(raw)
    const next = reconcileAchievements(normalizeState(parsed))

    // Upgrades are the moment data is most at risk. Snapshot what was on disk
    // before this version rewrites it, and shout if the rewrite lost sessions.
    const priorVersion = typeof parsed?.version === 'number' ? parsed.version : 1
    if (priorVersion !== next.version) {
      try {
        localStorage.setItem(BACKUP_KEY, raw)
      } catch {
        /* a full disk should not block the upgrade */
      }
    }
    const before = Array.isArray(parsed?.sessions) ? parsed.sessions.length : 0
    if (next.sessions.length < before) {
      console.warn(`Planche Lab: ${before - next.sessions.length} session(s) failed validation and were dropped.`)
    }
    return next
  } catch {
    bootedFresh = true
    return initialState()
  }
}

/** The pre-upgrade snapshot, if one exists. */
export function previousBackup(): { json: string; sessions: number } | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY)
    if (!raw) return null
    const p = JSON.parse(raw)
    return { json: raw, sessions: Array.isArray(p?.sessions) ? p.sessions.length : 0 }
  } catch {
    return null
  }
}

/** Rebuild PRs / unlocks / achievements by replaying history (after deletes/imports). */
export function rebuildDerivedState(state: AppState, sessions = state.sessions): AppState {
  const startingCandidates = [state.baseStepId, state.grandfatheredStepId].filter(
    (id): id is StepId => Boolean(id && STEP_BY_ID[id]),
  )
  const base = startingCandidates.reduce<StepId>(
    (highest, id) => (STEP_BY_ID[id].order > STEP_BY_ID[highest].order ? id : highest),
    'foundations',
  )
  const baseOrder = STEP_BY_ID[base].order
  const selectedStep = state.stepId
  const selectedWasIntentionalLowerStep = state.unlocked.some(
    (id) => STEP_BY_ID[id].order > STEP_BY_ID[selectedStep].order,
  )
  let acc: AppState = {
    ...state,
    sessions: [],
    prs: {},
    achievementVersion: ACHIEVEMENT_VERSION,
    achievements: {},
    stepId: base,
    unlocked: STEPS.filter((s) => s.order <= baseOrder).map((s) => s.id),
  }
  for (const s of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    acc = applySession(acc, s).next
  }
  return selectedWasIntentionalLowerStep && acc.unlocked.includes(selectedStep)
    ? { ...acc, stepId: selectedStep }
    : acc
}

/**
 * Recheck saved history once when the achievement catalog changes. Existing
 * timestamps win; newly introduced badges use the first historical session
 * at which their rule became true instead of waiting for another workout.
 */
export function reconcileAchievements(state: AppState): AppState {
  if (state.achievementVersion >= ACHIEVEMENT_VERSION) return state
  if (state.sessions.length === 0) return { ...state, achievementVersion: ACHIEVEMENT_VERSION }

  const replayed = rebuildDerivedState({ ...state, achievementVersion: ACHIEVEMENT_VERSION })
  return {
    ...state,
    achievementVersion: ACHIEVEMENT_VERSION,
    achievements: { ...replayed.achievements, ...state.achievements },
  }
}

/**
 * Deliberately place the athlete at a later step without pretending the road
 * was verified. Earlier steps become selectable, while PRs, achievements and
 * filmed evidence remain untouched. Raising the base step makes the choice
 * survive history rebuilds; moving back later never lowers that floor.
 */
export function skipToStep(state: AppState, stepId: StepId): AppState {
  const target = STEP_BY_ID[stepId]
  const currentBase = STEP_BY_ID[state.baseStepId] ?? STEP_BY_ID.foundations
  const baseStepId = target.order > currentBase.order ? target.id : currentBase.id
  const unlocked = STEPS.filter((step) => state.unlocked.includes(step.id) || step.order <= target.order).map(
    (step) => step.id,
  )
  return { ...state, stepId: target.id, baseStepId, unlocked }
}

export type Action =
  | { type: 'SAVE_SESSION'; session: Session }
  | { type: 'DELETE_SESSION'; id: string }
  | { type: 'SET_SETTINGS'; patch: Partial<Settings> }
  | { type: 'SET_STEP'; stepId: StepId }
  | { type: 'SKIP_TO_STEP'; stepId: StepId }
  | {
      type: 'COMPLETE_ONBOARDING'
      name: string
      stepId: StepId
      weeklyGoal: number
      profile: Profile
      units: Units
      weightKg?: number
      heightCm?: number
      /** Absent when the athlete skipped the placement interview. */
      assessment?: AssessmentRecord
    }
  | { type: 'SET_VIDEO'; exerciseId: string; url: string | null }
  | { type: 'LOG_MEASUREMENT'; weightKg?: number; heightCm?: number }
  | { type: 'SNOOZE_MEASURE' }
  | { type: 'SET_PROFILE'; patch: Partial<Profile> }
  | { type: 'MERGE_EXTERNAL'; sessions: Session[] }
  | { type: 'REPLACE'; state: AppState }
  | { type: 'RESET' }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SAVE_SESSION':
      return applySession(state, action.session).next
    case 'DELETE_SESSION':
      return rebuildDerivedState(
        state,
        state.sessions.filter((s) => s.id !== action.id),
      )
    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.patch } }
    case 'SET_STEP': {
      if (!state.unlocked.includes(action.stepId)) return state
      return { ...state, stepId: action.stepId }
    }
    case 'SKIP_TO_STEP':
      return skipToStep(state, action.stepId)
    case 'COMPLETE_ONBOARDING': {
      const target = STEP_BY_ID[action.stepId]
      const unlocked = STEPS.filter((s) => s.order <= target.order).map((s) => s.id)
      return {
        ...state,
        onboarded: true,
        name: action.name,
        startedAt: Date.now(),
        stepId: action.stepId,
        baseStepId: action.stepId,
        unlocked,
        ...(action.assessment ? { assessment: action.assessment } : {}),
        profile: { ...action.profile, heightCm: action.heightCm ?? action.profile.heightCm },
        measurements:
          action.weightKg !== undefined || action.heightCm !== undefined
            ? [{ at: Date.now(), weightKg: action.weightKg, heightCm: action.heightCm }]
            : [],
        settings: { ...state.settings, weeklyGoal: action.weeklyGoal, units: action.units },
      }
    }
    case 'SET_VIDEO': {
      const videoLinks = { ...state.videoLinks }
      if (action.url) videoLinks[action.exerciseId] = action.url
      else delete videoLinks[action.exerciseId]
      return { ...state, videoLinks }
    }
    case 'LOG_MEASUREMENT': {
      const entry: Measurement = { at: Date.now() }
      if (action.weightKg !== undefined && action.weightKg >= 20 && action.weightKg <= 400) {
        entry.weightKg = action.weightKg
      }
      if (action.heightCm !== undefined && action.heightCm >= 100 && action.heightCm <= 250) {
        entry.heightCm = action.heightCm
      }
      if (entry.weightKg === undefined && entry.heightCm === undefined) return state
      return {
        ...state,
        measurements: [...state.measurements, entry],
        profile: entry.heightCm !== undefined ? { ...state.profile, heightCm: entry.heightCm } : state.profile,
      }
    }
    case 'SNOOZE_MEASURE':
      return { ...state, measureSnoozedAt: Date.now() }
    case 'SET_PROFILE':
      return { ...state, profile: { ...state.profile, ...action.patch } }
    case 'MERGE_EXTERNAL': {
      const byId = new Map(state.sessions.map((session) => [session.id, session]))
      let changed = false
      for (const incoming of action.sessions) {
        const current = byId.get(incoming.id)
        if (!current || incoming.endedAt > current.endedAt) {
          byId.set(incoming.id, incoming)
          changed = true
        }
      }
      if (!changed) return state
      return rebuildDerivedState(state, [...byId.values()].sort((a, b) => a.startedAt - b.startedAt))
    }
    case 'REPLACE':
      return reconcileAchievements(normalizeState(action.state))
    case 'RESET':
      return { ...initialState(), settings: { ...state.settings } }
  }
}

interface StoreValue {
  state: AppState
  dispatch: (action: Action) => void
}

const StoreCtx = createContext<StoreValue | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  const mirrorTimer = useRef<number | undefined>(undefined)

  // Persist on every change: localStorage immediately, the IndexedDB mirror
  // debounced (it's the recovery copy, not the hot path).
  useEffect(() => {
    let json: string
    try {
      json = JSON.stringify(state)
    } catch {
      // Nothing serialisable to save; neither store can help.
      return
    }
    try {
      localStorage.setItem(STORAGE_KEY, json)
    } catch {
      // Storage full, evicted, or private mode. Deliberately keep going: the
      // IndexedDB mirror is the recovery copy for exactly this failure, and
      // bailing out here abandoned it at the one moment it was needed —
      // leaving the session with no durable copy at all. IndexedDB has its own
      // quota, so it can still succeed when localStorage cannot.
    }
    window.clearTimeout(mirrorTimer.current)
    mirrorTimer.current = window.setTimeout(() => void writeMirror(json), 1500)
  }, [state])

  // Other tabs are independent writers. Merge stable session ids so saving in
  // one PWA window cannot erase a session just saved in another.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return
      try {
        const incoming = normalizeState(JSON.parse(event.newValue))
        dispatch({ type: 'MERGE_EXTERNAL', sessions: incoming.sessions })
      } catch {
        /* ignore an incomplete/corrupt external write */
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // If the primary copy was missing or corrupt at boot, restore silently
  // from the IndexedDB mirror (real data only — never overwrite fresh use).
  useEffect(() => {
    if (!bootedFresh) return
    bootedFresh = false
    void (async () => {
      const raw = await readMirror()
      if (!raw) return
      try {
        const recovered = normalizeState(JSON.parse(raw))
        if (recovered.onboarded || recovered.sessions.length > 0) {
          dispatch({ type: 'REPLACE', state: recovered })
          pushToast('Restored your data from the on-device backup.', 'success', 5000)
        }
      } catch {
        /* mirror unreadable too — nothing to restore */
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Once there is anything worth protecting, ask the browser to exempt this
  // origin from automatic storage cleanup.
  useEffect(() => {
    if (state.onboarded) void requestPersistence()
  }, [state.onboarded])

  // Theme: apply the class and mirror the choice for the pre-paint bootstrap.
  useEffect(() => {
    const t = state.settings.theme
    try {
      localStorage.setItem(THEME_KEY, t)
    } catch {
      /* non-fatal */
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = t === 'system' ? mq.matches : t === 'dark'
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    if (t === 'system') {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [state.settings.theme])

  useEffect(() => {
    configureAudio(state.settings.sound, state.settings.voice, state.settings.volume)
  }, [state.settings.sound, state.settings.voice, state.settings.volume])

  const value = useMemo(() => ({ state, dispatch }), [state])
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore(): StoreValue {
  const v = useContext(StoreCtx)
  if (!v) throw new Error('useStore must be used inside StoreProvider')
  return v
}
