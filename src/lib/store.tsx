import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { BODY_REGIONS, CURRENT_STATE_VERSION } from '../types'
import type {
  AppState,
  AssessmentRecord,
  AssistType,
  AutoForm,
  BodyRegion,
  CheckIn,
  EndReason,
  EquipmentId,
  ExerciseSetup,
  FormCheck,
  FormIssue,
  Measurement,
  Profile,
  Session,
  SetLog,
  SetTiming,
  Settings,
  StepId,
  SymptomEvent,
  TrainingSurface,
  Units,
} from '../types'
import { STEPS, STEP_BY_ID } from '../data/progressions'
import { EXERCISE_BY_ID } from '../data/exercises'
import { ACHIEVEMENT_VERSION, REVALIDATED_ACHIEVEMENTS } from '../data/achievements'
import { applySession } from './engine'
import { configureAudio } from './audio'
import { clearMirror, readMirror, requestPersistence, writeMirror } from './persist'
import { pushToast } from './toast'
import { CLOCK_SKEW_MS } from './time'

const STORAGE_KEY = 'planchelab.v1'
const THEME_KEY = 'planchelab.theme'
/** Kept so a bad migration is recoverable rather than terminal. */
const BACKUP_KEY = 'planchelab.prev'
/**
 * Exact original bytes of a save that could not be read, or that lost records
 * when it was repaired. A repair is allowed to be conservative; it is not
 * allowed to be the only copy.
 */
export const QUARANTINE_KEY = 'planchelab.quarantine'
const DRAFT_KEY = 'planchelab.draft'

/** JavaScript's Date range. A "finite" 1e20 is not a moment in time. */
const MAX_TIME = 8.64e15

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

export function newEpoch(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}

export function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}

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
    rev: 0,
    epoch: newEpoch(),
    symptoms: [],
    deletedSessionIds: [],
  }
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
}

function isTime(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_TIME
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
const EQUIPMENT_IDS = new Set<EquipmentId>(['floor', 'parallettes', 'band', 'pullup-bar', 'dip-bars', 'box'])
const TRAINING_SURFACES = new Set<TrainingSurface>(['floor', 'parallettes'])
const SECTIONS = new Set(['warmup', 'main', 'strength', 'core', 'cooldown'])
const STRATEGIES = new Set(['balanced', 'volume', 'intensity', 'density', 'technique'])
const ASSIST_TYPES = new Set<AssistType>(['none', 'band', 'feet', 'partner', 'other'])
const END_REASONS = new Set<EndReason>(['target', 'balance', 'technique', 'effort', 'interruption', 'timing', 'unsure'])
const TIMING_METHODS = new Set<SetTiming['method']>(['stopwatch', 'interrupted', 'edited'])
const TIMING_ALLOWANCES = new Set<NonNullable<SetTiming['allowance']>>(['walk-back', 'reaction', 'interruption'])
const SYMPTOM_SOURCES = new Set<SymptomEvent['source']>(['onboarding', 'check-in', 'attempt', 'manual'])

/** Caps on append-only lists, so a long life of use cannot grow them without bound. */
const MAX_SYMPTOMS = 400
const MAX_TOMBSTONES = 1000
const MAX_RETIRED_EPOCHS = 20

/**
 * A camera reading, validated field by field.
 *
 * Absent and malformed are different. A field an older version never wrote is
 * legacy and keeps its historical meaning; a field that is *present but wrong*
 * (`unseen: "elbows"`, `cleanSeconds: null`) is corruption. Repairing the second
 * kind by dropping it used to *increase* credit — a lost clean-seconds cap is
 * full credit, a lost `unseen` list is "the elbows were seen". So any such
 * repair marks the reading malformed, which keeps it visible and stops it
 * counting for anything.
 */
function sanitizeAuto(a: unknown, repairs: string[]): AutoForm | undefined {
  if (typeof a !== 'object' || a === null) return undefined
  const c = a as Record<string, unknown>
  let malformed = c.malformed === true
  const flag = (field: string) => {
    malformed = true
    repairs.push(`form.auto.${field}`)
  }
  const issueList = (field: 'issues' | 'heldIssues'): FormIssue[] | undefined => {
    const v = c[field]
    if (v === undefined) {
      // Every reading the app has ever written carries `issues`.
      if (field === 'issues') flag(field)
      return field === 'issues' ? [] : undefined
    }
    if (!Array.isArray(v)) {
      flag(field)
      return field === 'issues' ? [] : undefined
    }
    const kept = v.filter((i): i is FormIssue => typeof i === 'string' && FORM_ISSUES.has(i as FormIssue))
    // An issue this catalog does not know cannot simply vanish: dropping a
    // fault is the one repair that makes a set look cleaner than it was.
    if (kept.length !== v.length) flag(field)
    return kept
  }
  const issues = issueList('issues') ?? []
  const heldIssues = issueList('heldIssues')

  let unseen: string[] = []
  if (c.unseen !== undefined) {
    if (!Array.isArray(c.unseen) || c.unseen.some((u) => typeof u !== 'string')) flag('unseen')
    else unseen = (c.unseen as string[]).slice(0, 8)
  }

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  /** A measurement that gates credit: present but unusable is malformed, not absent. */
  const gating = (field: 'cleanSeconds' | 'cleanRatio' | 'confidence', lo: number, hi: number) => {
    const v = c[field]
    if (v === undefined) return undefined
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      flag(field)
      return undefined
    }
    return Math.min(hi, Math.max(lo, v))
  }
  const confidence = gating('confidence', 0, 1)
  if (c.confidence === undefined) flag('confidence')

  return {
    issues,
    ...(heldIssues ? { heldIssues } : {}),
    ...(unseen.length ? { unseen } : {}),
    confidence: confidence ?? 0,
    score: clampOptional(c.score, 0, 100),
    cleanSeconds: gating('cleanSeconds', 0, 3600),
    cleanRatio: gating('cleanRatio', 0, 1),
    elbowDeg: num(c.elbowDeg),
    kneeDeg: num(c.kneeDeg),
    hipAngleDeg: num(c.hipAngleDeg),
    hipOffset: num(c.hipOffset),
    leanRatio: num(c.leanRatio),
    shrugRatio: num(c.shrugRatio),
    asymmetry: num(c.asymmetry),
    wobble: num(c.wobble),
    analysedSec: clampOptional(c.analysedSec, 0, 3600),
    samplingGapSec: clampOptional(c.samplingGapSec, 0, 60),
    ...(typeof c.model === 'string' ? { model: c.model.slice(0, 60) } : {}),
    ...(typeof c.judge === 'number' && Number.isFinite(c.judge) ? { judge: c.judge } : {}),
    ...(malformed ? { malformed: true } : {}),
  }
}

/**
 * The athlete's rating, validated.
 *
 * Every validated field is assigned unconditionally. Spreading first and then
 * overriding *conditionally* looks like it preserves unknown fields, but it
 * silently re-admits exactly the malformed values this exists to reject.
 */
function sanitizeForm(f: unknown, repairs: string[]): FormCheck | undefined {
  if (typeof f !== 'object' || f === null) return undefined
  const c = f as Partial<FormCheck> & Record<string, unknown>
  if (typeof c.rating !== 'string' || !FORM_RATINGS.has(c.rating)) {
    // Dropping the whole rating removes evidence, which can only cost credit.
    repairs.push('form.rating')
    return undefined
  }

  const out: FormCheck = { rating: c.rating as FormCheck['rating'] }
  // Confirmation flags: a non-boolean is simply not a confirmation.
  if (typeof c.confirmed === 'boolean') out.confirmed = c.confirmed
  if (typeof c.visualReviewPassed === 'boolean') out.visualReviewPassed = c.visualReviewPassed
  if (typeof c.flightConfirmed === 'boolean') out.flightConfirmed = c.flightConfirmed
  if (typeof c.variantConfirmed === 'boolean') out.variantConfirmed = c.variantConfirmed
  if (c.issues !== undefined) {
    if (!Array.isArray(c.issues)) repairs.push('form.issues')
    else {
      const kept = c.issues.filter((i): i is FormIssue => typeof i === 'string' && FORM_ISSUES.has(i as FormIssue))
      if (kept.length !== c.issues.length) repairs.push('form.issues')
      if (kept.length) out.issues = kept
    }
  }
  if (typeof c.clipKey === 'string') out.clipKey = c.clipKey

  const auto = sanitizeAuto(c.auto, repairs)
  if (auto) out.auto = auto
  return out
}

function clampOptional(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined
}

const JOINT_STATES = new Set(['good', 'niggle', 'pain'])
const ENERGY_STATES = new Set(['fresh', 'ok', 'tired'])
const SLEEP_STATES = new Set(['good', 'ok', 'poor'])
const GAP_STATES = new Set(['trained-elsewhere', 'break', 'unsure'])
const REGION_IDS = new Set<BodyRegion>(BODY_REGIONS)

function sanitizeRegions(raw: unknown): BodyRegion[] {
  return Array.isArray(raw)
    ? [...new Set(raw.filter((r): r is BodyRegion => typeof r === 'string' && REGION_IDS.has(r as BodyRegion)))]
    : []
}

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
  if (!isTime(c.at)) return undefined
  const regions = sanitizeRegions(c.regions)
  const out: CheckIn = { joints: c.joints, energy: c.energy, at: c.at }
  if (regions.length) out.regions = regions
  if (typeof c.sleep === 'string' && SLEEP_STATES.has(c.sleep)) out.sleep = c.sleep
  if (typeof c.gap === 'string' && GAP_STATES.has(c.gap)) out.gap = c.gap
  return out
}

function sanitizeSymptoms(raw: unknown): SymptomEvent[] {
  if (!Array.isArray(raw)) return []
  const out: SymptomEvent[] = []
  const ids = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const c = item as Partial<SymptomEvent>
    if (!isTime(c.at)) continue
    if (typeof c.joints !== 'string' || !JOINT_STATES.has(c.joints)) continue
    const id = typeof c.id === 'string' && c.id ? c.id : newId()
    if (ids.has(id)) continue
    ids.add(id)
    const regions = sanitizeRegions(c.regions)
    out.push({
      id,
      at: c.at,
      joints: c.joints,
      ...(regions.length ? { regions } : {}),
      source: typeof c.source === 'string' && SYMPTOM_SOURCES.has(c.source) ? c.source : 'manual',
      ...(typeof c.energy === 'string' && ENERGY_STATES.has(c.energy) ? { energy: c.energy } : {}),
      ...(c.correction === true ? { correction: true } : {}),
    })
  }
  return out.sort((a, b) => a.at - b.at).slice(-MAX_SYMPTOMS)
}

/** Placement answers are numbers keyed by known item ids; anything else goes. */
function sanitizeAssessment(raw: unknown): AssessmentRecord | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const c = raw as Partial<AssessmentRecord>
  if (!isTime(c.at)) return undefined
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

/** What normalizing a saved or imported state did, so nothing is lost silently. */
export interface NormalizeReport {
  sessionsIn: number
  sessionsKept: number
  /** Sessions that could not be kept at all, and why. */
  rejectedSessions: { index: number; reason: string }[]
  /** Byte-for-byte copies of a session already present (same id, same content). */
  duplicateSessions: number
  /** Same id as an earlier session but different content: set aside, not merged. */
  conflictingSessions: number
  /** Kept, but dated past this device's clock — ignored for readiness and goals. */
  futureSessions: number
  setsIn: number
  setsKept: number
  droppedSets: { reason: string; count: number }[]
  /** Kept sets with a field that had to be repaired; they no longer qualify. */
  repairedSets: number
}

export function emptyReport(): NormalizeReport {
  return {
    sessionsIn: 0,
    sessionsKept: 0,
    rejectedSessions: [],
    duplicateSessions: 0,
    conflictingSessions: 0,
    futureSessions: 0,
    setsIn: 0,
    setsKept: 0,
    droppedSets: [],
    repairedSets: 0,
  }
}

/** True when normalizing changed or set aside anything worth telling the athlete. */
export function reportHasLosses(report: NormalizeReport): boolean {
  return (
    report.rejectedSessions.length > 0 ||
    report.conflictingSessions > 0 ||
    report.duplicateSessions > 0 ||
    report.droppedSets.length > 0 ||
    report.repairedSets > 0
  )
}

function sanitizeSet(rawSet: unknown, sessionStart: number, report: NormalizeReport): SetLog | null {
  const drop = (reason: string) => {
    const existing = report.droppedSets.find((d) => d.reason === reason)
    if (existing) existing.count += 1
    else report.droppedSets.push({ reason, count: 1 })
    return null
  }
  if (typeof rawSet !== 'object' || rawSet === null) return drop('not a set record')
  const x = rawSet as Partial<SetLog> & Record<string, unknown>
  const exercise = typeof x.exerciseId === 'string' ? EXERCISE_BY_ID[x.exerciseId] : undefined
  if (!exercise) return drop('unknown exercise')
  if (typeof x.value !== 'number' || !Number.isFinite(x.value)) return drop('value is not a number')

  const repairs: string[] = []
  // A set's kind is its exercise's kind. A record claiming otherwise ("seconds"
  // for a hold) is kept as history under the right kind, and flagged.
  const kind = exercise.type
  if (x.kind !== undefined && x.kind !== exercise.type) repairs.push('kind')

  let section: SetLog['section'] = 'main'
  if (x.section !== undefined) {
    if (typeof x.section === 'string' && SECTIONS.has(x.section)) section = x.section as SetLog['section']
    else {
      // Unknown: never default *into* the one section that can earn
      // progression. Strength keeps the number as history.
      repairs.push('section')
      section = 'strength'
    }
  }

  const max = kind === 'hold' ? 3600 : 1000
  if (x.value < 0 || x.value > max) repairs.push('value')
  const form = sanitizeForm(x.form, repairs)

  let assist: AssistType | undefined
  if (x.assist !== undefined) {
    if (typeof x.assist === 'string' && ASSIST_TYPES.has(x.assist as AssistType)) assist = x.assist as AssistType
    else repairs.push('assist')
  }

  let timing: SetTiming | undefined
  if (typeof x.timing === 'object' && x.timing !== null) {
    const t = x.timing as Partial<SetTiming>
    if (typeof t.method === 'string' && TIMING_METHODS.has(t.method)) {
      timing = {
        method: t.method,
        ...(typeof t.allowanceSec === 'number' && Number.isFinite(t.allowanceSec)
          ? { allowanceSec: clampNum(t.allowanceSec, 0, 60, 0) }
          : {}),
        ...(typeof t.allowance === 'string' && TIMING_ALLOWANCES.has(t.allowance) ? { allowance: t.allowance } : {}),
      }
    }
  }

  const priorRepairs = Array.isArray(x.repaired)
    ? x.repaired.filter((r): r is string => typeof r === 'string')
    : x.repaired !== undefined
      ? ['repaired']
      : []
  const allRepairs = [...new Set([...priorRepairs, ...repairs])].slice(0, 12)
  if (repairs.length) report.repairedSets += 1

  return {
    exerciseId: exercise.id,
    kind,
    value: clampNum(x.value, 0, max, 0),
    ...(typeof x.raw === 'number' && Number.isFinite(x.raw) ? { raw: clampNum(x.raw, 0, 3600, 0) } : {}),
    target: clampNum(x.target, 0, max, 0),
    section,
    at: isTime(x.at) ? x.at : sessionStart,
    ...(x.side === 'left' || x.side === 'right' ? { side: x.side } : {}),
    ...(typeof x.surface === 'string' && TRAINING_SURFACES.has(x.surface as TrainingSurface)
      ? { surface: x.surface as TrainingSurface }
      : {}),
    ...(typeof x.leadInSec === 'number' && Number.isFinite(x.leadInSec)
      ? { leadInSec: clampNum(x.leadInSec, 0, 60, 0) }
      : {}),
    ...(typeof x.clipKey === 'string' ? { clipKey: x.clipKey } : {}),
    ...(form ? { form } : {}),
    ...(timing ? { timing } : {}),
    ...(typeof x.endReason === 'string' && END_REASONS.has(x.endReason as EndReason)
      ? { endReason: x.endReason as EndReason }
      : {}),
    ...(assist ? { assist } : {}),
    ...(typeof x.recordingOffsetSec === 'number' && Number.isFinite(x.recordingOffsetSec)
      ? { recordingOffsetSec: clampNum(x.recordingOffsetSec, 0, 600, 0) }
      : {}),
    ...(allRepairs.length ? { repaired: allRepairs } : {}),
  }
}

/**
 * Drop anything that would crash the app downstream, and say what was dropped.
 *
 * An imported file is untrusted input: a session without a `sets` array used
 * to white-screen every screen that sums it. Identity matters as much as shape:
 * four copies of one session inside one backup used to become four sessions —
 * four strategy attempts, a met weekly goal and a quadrupled load ratio, all
 * from one workout. Exact copies are now dropped and same-id sessions with
 * different content are set aside rather than both believed.
 */
function sanitizeSessions(
  raw: unknown,
  report: NormalizeReport,
  tombstones: Set<string>,
  now: number,
): Session[] {
  if (!Array.isArray(raw)) return []
  report.sessionsIn = raw.length
  const out: Session[] = []
  const byId = new Map<string, string>()
  raw.forEach((s, index) => {
    if (typeof s !== 'object' || s === null) {
      report.rejectedSessions.push({ index, reason: 'not a session record' })
      return
    }
    const c = s as Partial<Session> & Record<string, unknown>
    if (!isTime(c.startedAt)) {
      report.rejectedSessions.push({ index, reason: 'start time is not a real date' })
      return
    }
    const startedAt = c.startedAt
    const sets: SetLog[] = []
    if (Array.isArray(c.sets)) {
      report.setsIn += c.sets.length
      for (const rawSet of c.sets) {
        const set = sanitizeSet(rawSet, startedAt, report)
        if (set) sets.push(set)
      }
    }
    report.setsKept += sets.length
    const checkIn = sanitizeCheckIn(c.checkIn)
    const endedAt = isTime(c.endedAt) && c.endedAt >= startedAt ? c.endedAt : startedAt
    const session: Session = {
      id: typeof c.id === 'string' && c.id ? c.id : newId(),
      startedAt,
      endedAt,
      ...(typeof c.pausedMs === 'number' && Number.isFinite(c.pausedMs)
        ? { pausedMs: clampNum(c.pausedMs, 0, Math.max(0, endedAt - startedAt), 0) }
        : {}),
      workoutName: typeof c.workoutName === 'string' ? c.workoutName : 'Session',
      workoutKind: c.workoutKind === 'template' || c.workoutKind === 'test' ? c.workoutKind : 'auto',
      stepId: c.stepId && STEP_BY_ID[c.stepId] ? c.stepId : 'foundations',
      sets,
      rpe: typeof c.rpe === 'number' && Number.isFinite(c.rpe) ? clampNum(c.rpe, 1, 10, 8) : undefined,
      notes: typeof c.notes === 'string' ? c.notes : undefined,
      strategy: typeof c.strategy === 'string' && STRATEGIES.has(c.strategy) ? c.strategy : undefined,
      checkIn,
      ...(isTime(c.savedAt) ? { savedAt: c.savedAt } : {}),
      ...(isTime(c.updatedAt) ? { updatedAt: c.updatedAt } : {}),
      ...(c.completion === 'full' || c.completion === 'partial' ? { completion: c.completion } : {}),
      ...(typeof c.plannedRounds === 'number' && Number.isInteger(c.plannedRounds) && c.plannedRounds >= 0
        ? { plannedRounds: Math.min(500, c.plannedRounds) }
        : {}),
    }
    if (tombstones.has(session.id)) return
    const fingerprint = JSON.stringify(session)
    const seen = byId.get(session.id)
    if (seen !== undefined) {
      if (seen === fingerprint) report.duplicateSessions += 1
      else {
        report.conflictingSessions += 1
        report.rejectedSessions.push({ index, reason: 'same id as an earlier session with different content' })
      }
      return
    }
    byId.set(session.id, fingerprint)
    if (startedAt > now + CLOCK_SKEW_MS) report.futureSessions += 1
    out.push(session)
  })
  report.sessionsKept = out.length
  return out
}

function sanitizeSetups(raw: unknown): Record<string, ExerciseSetup> {
  if (typeof raw !== 'object' || raw === null) return {}
  const out: Record<string, ExerciseSetup> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (!EXERCISE_BY_ID[id] || typeof value !== 'object' || value === null) continue
    const v = value as Partial<ExerciseSetup>
    if (typeof v.assist !== 'string' || !ASSIST_TYPES.has(v.assist)) continue
    out[id] = {
      assist: v.assist,
      ...(typeof v.note === 'string' && v.note.trim() ? { note: v.note.trim().slice(0, 80) } : {}),
      updatedAt: isTime(v.updatedAt) ? v.updatedAt : 0,
    }
  }
  return out
}

function sanitizeFieldTimes(raw: unknown): Record<string, number> {
  if (typeof raw !== 'object' || raw === null) return {}
  return Object.fromEntries(
    Object.entries(raw).filter(([k, v]) => typeof k === 'string' && isTime(v)),
  ) as Record<string, number>
}

function stringList(raw: unknown, cap: number): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string' && x.length > 0))].slice(-cap) : []
}

/** Coerce anything (old versions, imported files) into a valid AppState. */
export function normalizeState(raw: unknown): AppState {
  return normalizeStateWithReport(raw).state
}

/**
 * Normalize, and report what had to change.
 *
 * Never throws: every nested field is read defensively, because a throw here
 * used to make boot fall back to an empty state that the next save then wrote
 * over the athlete's real data.
 */
export function normalizeStateWithReport(
  raw: unknown,
  now = Date.now(),
): { state: AppState; report: NormalizeReport } {
  const report = emptyReport()
  const base = initialState()
  if (typeof raw !== 'object' || raw === null) return { state: base, report }
  const r = raw as Partial<AppState> & Record<string, unknown>
  const priorVersion = typeof r.version === 'number' ? r.version : 1
  const stepId: StepId = typeof r.stepId === 'string' && STEP_BY_ID[r.stepId] ? r.stepId : 'foundations'
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
    // v5 needed this to avoid revoking steps under stricter evidence; v7
    // tightens evidence again (variant confirmation, repaired records), and
    // this is what keeps that from silently demoting anybody. The floor only
    // ever moves up, and it grants access, not verified evidence.
    priorVersion < CURRENT_STATE_VERSION
      ? highestUnlocked
      : typeof r.grandfatheredStepId === 'string' && STEP_BY_ID[r.grandfatheredStepId as StepId]
        ? (r.grandfatheredStepId as StepId)
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

  // Read nested profile fields only through validated values: a malformed
  // `equipment` object once made `.includes` throw here, and that single throw
  // turned a recoverable save into an empty app.
  const rawProfile = (typeof r.profile === 'object' && r.profile !== null ? r.profile : {}) as Partial<Profile>
  const equipment = (() => {
    const valid = Array.isArray(rawProfile.equipment)
      ? [...new Set(rawProfile.equipment.filter((e): e is EquipmentId => typeof e === 'string' && EQUIPMENT_IDS.has(e as EquipmentId)))]
      : []
    return valid.length ? valid : (['floor'] as EquipmentId[])
  })()
  const preferredSurface: TrainingSurface =
    typeof rawProfile.preferredSurface === 'string' &&
    TRAINING_SURFACES.has(rawProfile.preferredSurface as TrainingSurface) &&
    (rawProfile.preferredSurface !== 'parallettes' || equipment.includes('parallettes'))
      ? (rawProfile.preferredSurface as TrainingSurface)
      : equipment.includes('parallettes') && !equipment.includes('floor')
        ? 'parallettes'
        : 'floor'

  const tombstones = stringList(r.deletedSessionIds, MAX_TOMBSTONES)
  const sessions = sanitizeSessions(r.sessions, report, new Set(tombstones), now)
  const legacyEpoch = `legacy-${typeof r.startedAt === 'number' ? Math.round(r.startedAt) : 0}`

  const state: AppState = {
    version: CURRENT_STATE_VERSION,
    onboarded: Boolean(r.onboarded),
    name: typeof r.name === 'string' ? r.name : '',
    startedAt: isTime(r.startedAt) ? r.startedAt : Date.now(),
    lastBackupAt: isTime(r.lastBackupAt) ? r.lastBackupAt : undefined,
    measureSnoozedAt: isTime(r.measureSnoozedAt) ? r.measureSnoozedAt : undefined,
    ...(sanitizeAssessment(r.assessment) ? { assessment: sanitizeAssessment(r.assessment) } : {}),
    stepId,
    // Older saves predate this field and their placement is unrecoverable, so
    // anchor at the current step: never demote someone who is already there.
    baseStepId: typeof r.baseStepId === 'string' && STEP_BY_ID[r.baseStepId as StepId] ? (r.baseStepId as StepId) : stepId,
    ...(grandfatheredStepId ? { grandfatheredStepId } : {}),
    unlocked,
    sessions,
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
                !isTime(rawPr.at)
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
                          isTime(mark.at),
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
        ? Object.fromEntries(Object.entries(r.achievements).filter(([, at]) => isTime(at)))
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
      equipment,
      heightCm: clampOptional(rawProfile.heightCm, 100, 250),
      injuryNote: typeof rawProfile.injuryNote === 'string' ? rawProfile.injuryNote : undefined,
      birthYear: clampOptional(rawProfile.birthYear, 1920, new Date().getFullYear()),
      trainingAgeMonths: clampOptional(rawProfile.trainingAgeMonths, 0, 1200),
      preferredSurface,
      goalStepId:
        typeof rawProfile.goalStepId === 'string' && STEP_BY_ID[rawProfile.goalStepId as StepId]
          ? (rawProfile.goalStepId as StepId)
          : 'straddle',
    },
    measurements: Array.isArray(r.measurements)
      ? r.measurements
          .filter(
            (m): m is Measurement => typeof m === 'object' && m !== null && isTime((m as Measurement).at),
          )
          .map((m) => ({
            at: m.at,
            weightKg: clampOptional(m.weightKg, 20, 400),
            heightCm: clampOptional(m.heightCm, 100, 250),
          }))
          .sort((a, b) => a.at - b.at)
      : [],
    settings,
    rev: typeof r.rev === 'number' && Number.isInteger(r.rev) && r.rev >= 0 ? r.rev : 0,
    // Saves that predate epochs get a deterministic one, so two tabs opening
    // the same old save agree on which dataset they hold.
    epoch: typeof r.epoch === 'string' && r.epoch ? r.epoch : legacyEpoch,
    retiredEpochs: stringList(r.retiredEpochs, MAX_RETIRED_EPOCHS),
    fieldTimes: sanitizeFieldTimes(r.fieldTimes),
    deletedSessionIds: tombstones,
    symptoms: sanitizeSymptoms(r.symptoms),
    setups: sanitizeSetups(r.setups),
  }
  return { state, report }
}

/** How boot went — drives the recovery screen and whether saving is allowed yet. */
export type BootPhase = 'ready' | 'checking-backup' | 'unreadable'

export interface BootInfo {
  phase: BootPhase
  /** Present when the saved data could not be read; the exact bytes are quarantined. */
  failure?: { reason: string; bytes: number }
}

interface LoadResult {
  state: AppState
  /** Primary storage held nothing. */
  empty: boolean
  /** Primary storage held something that could not be read at all. */
  failed?: string
  rawBytes?: number
}

function quarantine(raw: string, reason: string) {
  try {
    localStorage.setItem(QUARANTINE_KEY, JSON.stringify({ at: Date.now(), reason, raw }))
    return true
  } catch {
    return false
  }
}

/** The quarantined original, if one is being kept. */
export function quarantinedData(): { at: number; reason: string; raw: string } | null {
  try {
    const stored = localStorage.getItem(QUARANTINE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored)
    return typeof parsed?.raw === 'string' && typeof parsed?.at === 'number'
      ? { at: parsed.at, reason: typeof parsed.reason === 'string' ? parsed.reason : 'unreadable', raw: parsed.raw }
      : null
  } catch {
    return null
  }
}

export function clearQuarantine(): void {
  try {
    localStorage.removeItem(QUARANTINE_KEY)
  } catch {
    /* nothing to clear */
  }
}

function loadState(): LoadResult {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return { state: initialState(), empty: true }
  }
  if (!raw) return { state: initialState(), empty: true }
  try {
    const parsed = JSON.parse(raw)
    const { state: normalized, report } = normalizeStateWithReport(parsed)
    const next = reconcileAchievements(normalized)

    // Upgrades are the moment data is most at risk. Snapshot what was on disk
    // before this version rewrites it.
    const priorVersion = typeof parsed?.version === 'number' ? parsed.version : 1
    if (priorVersion !== next.version) {
      try {
        localStorage.setItem(BACKUP_KEY, raw)
      } catch {
        /* a full disk should not block the upgrade */
      }
    }
    // Repairs are conservative, but conservative is not lossless: keep the
    // exact original bytes whenever normalizing dropped or repaired anything.
    if (reportHasLosses(report)) {
      quarantine(raw, 'Some saved records needed repair when this version loaded them.')
      console.warn('Planche Lab: saved data needed repair; the original was kept aside.', report)
    }
    return { state: next, empty: false }
  } catch (err) {
    // Unreadable. Keep the bytes before anything can overwrite them.
    quarantine(raw, err instanceof Error ? err.message : 'unreadable')
    return {
      state: initialState(),
      empty: false,
      failed: err instanceof Error ? err.message : 'unreadable',
      rawBytes: raw.length,
    }
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

/**
 * Remove every recovery copy this app keeps outside the main state.
 *
 * A reset that said "permanently deleted" while the pre-upgrade snapshot sat
 * in storage — and the error screen offered to restore it — was a promise the
 * app could not keep. Resolves which stores could not be cleared.
 */
export async function eraseRecoveryCopies(): Promise<{ failed: string[] }> {
  const failed: string[] = []
  for (const key of [BACKUP_KEY, QUARANTINE_KEY, DRAFT_KEY]) {
    try {
      localStorage.removeItem(key)
    } catch {
      failed.push(key)
    }
  }
  if (!(await clearMirror())) failed.push('on-device backup')
  return { failed }
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
 * Badges whose rule was *corrected* are the exception — see
 * REVALIDATED_ACHIEVEMENTS — and are re-derived from history.
 */
export function reconcileAchievements(state: AppState): AppState {
  if (state.achievementVersion >= ACHIEVEMENT_VERSION) return state
  if (state.sessions.length === 0) return { ...state, achievementVersion: ACHIEVEMENT_VERSION }

  const replayed = rebuildDerivedState({ ...state, achievementVersion: ACHIEVEMENT_VERSION })
  const revalidate = new Set(
    Object.entries(REVALIDATED_ACHIEVEMENTS)
      .filter(([version]) => Number(version) > state.achievementVersion && Number(version) <= ACHIEVEMENT_VERSION)
      .flatMap(([, ids]) => ids),
  )
  const kept = Object.fromEntries(Object.entries(state.achievements).filter(([id]) => !revalidate.has(id)))
  const corrected = Object.fromEntries(Object.entries(replayed.achievements).filter(([id]) => revalidate.has(id)))
  return {
    ...state,
    achievementVersion: ACHIEVEMENT_VERSION,
    achievements: { ...replayed.achievements, ...kept, ...corrected },
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

/** A symptom report as the reducer accepts it; the id is assigned here. */
export type SymptomInput = Omit<SymptomEvent, 'id'> & { id?: string }

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
      /** Joint reports made during onboarding, so they reach the first session's rails. */
      symptoms?: SymptomInput[]
    }
  | { type: 'SET_VIDEO'; exerciseId: string; url: string | null }
  | { type: 'LOG_MEASUREMENT'; weightKg?: number; heightCm?: number }
  | { type: 'SNOOZE_MEASURE' }
  | { type: 'SET_PROFILE'; patch: Partial<Profile> }
  | { type: 'SET_NAME'; name: string }
  | { type: 'STAMP_BACKUP'; at: number }
  | { type: 'RECORD_SYMPTOM'; event: SymptomInput }
  | {
      /** Attach or correct a saved set's form evidence, e.g. a later gallery check. */
      type: 'UPDATE_SET_FORM'
      sessionId: string
      setAt: number
      form: FormCheck
    }
  | { type: 'SET_SETUP'; exerciseId: string; setup: Omit<ExerciseSetup, 'updatedAt'> | null }
  | { type: 'MERGE_EXTERNAL'; incoming: AppState }
  /** Wholesale replacement: a mirror restore, sample data, or an unguarded legacy caller. */
  | { type: 'REPLACE'; state: AppState; reason?: 'restore' | 'sample' }
  /** An import, applied only if nothing changed since it was staged. */
  | { type: 'IMPORT_REPLACE'; state: AppState; expectedRev: number }
  | { type: 'RESET' }

function stamp(state: AppState, keys: string[], at = Date.now()): Record<string, number> {
  const times = { ...(state.fieldTimes ?? {}) }
  for (const key of keys) times[key] = at
  return times
}

function appendSymptom(state: AppState, input: SymptomInput): AppState {
  const existing = state.symptoms ?? []
  // The same answer arriving twice (a re-render, a resumed draft) is one report.
  if (existing.some((e) => e.at === input.at && e.source === input.source && e.joints === input.joints)) return state
  const regions = (input.regions ?? []).filter((r) => REGION_IDS.has(r))
  const event: SymptomEvent = {
    id: input.id ?? newId(),
    at: input.at,
    joints: input.joints,
    ...(regions.length ? { regions: [...new Set(regions)] } : {}),
    source: input.source,
    ...(input.energy ? { energy: input.energy } : {}),
    ...(input.correction ? { correction: true } : {}),
  }
  return {
    ...state,
    symptoms: [...existing, event].sort((a, b) => a.at - b.at).slice(-MAX_SYMPTOMS),
  }
}

/** When a saved session last changed, for picking the newer of two copies. */
function sessionVersion(s: Session): number {
  return s.updatedAt ?? s.savedAt ?? s.endedAt
}

/**
 * Fold another tab's write into this one.
 *
 * The old merge added and replaced sessions by id and ignored everything else,
 * which lost two kinds of update: a deletion (the stale tab still had the
 * session, wrote it back, and it came back to life) and any setting changed in
 * the other tab (the stale tab's next write reverted it). Now:
 * - a different dataset (reset/import elsewhere) is adopted or refused by
 *   epoch, never merged;
 * - sessions merge by id, minus tombstones from either side;
 * - user-editable fields merge per field, newest write wins.
 */
export function mergeExternalState(local: AppState, incoming: AppState): AppState {
  const localEpoch = local.epoch
  const incomingEpoch = incoming.epoch
  if (localEpoch && incomingEpoch && localEpoch !== incomingEpoch) {
    const adopt = (): AppState => ({
      ...incoming,
      retiredEpochs: [...new Set([...(incoming.retiredEpochs ?? []), localEpoch])].slice(-MAX_RETIRED_EPOCHS),
      rev: Math.max(local.rev ?? 0, incoming.rev ?? 0),
    })
    // A fresh object makes the persistence effect rewrite ours, so a stale
    // write does not stay in storage.
    const keep = (): AppState => ({ ...local })
    const incomingIsStale = local.retiredEpochs?.includes(incomingEpoch) ?? false
    const localIsStale = incoming.retiredEpochs?.includes(localEpoch) ?? false
    // The other tab reset, imported or loaded samples: this dataset is gone.
    if (localIsStale && !incomingIsStale) return adopt()
    // A tab still holding a dataset this one replaced must not merge back in.
    if (incomingIsStale && !localIsStale) return keep()
    // Two replacements raced. Any consistent rule converges; the epoch order is
    // one every tab computes identically, so they cannot ping-pong forever.
    return incomingEpoch > localEpoch ? adopt() : keep()
  }

  const tombstones = [...new Set([...(local.deletedSessionIds ?? []), ...(incoming.deletedSessionIds ?? [])])].slice(
    -MAX_TOMBSTONES,
  )
  const dead = new Set(tombstones)
  const byId = new Map<string, Session>()
  for (const s of local.sessions) if (!dead.has(s.id)) byId.set(s.id, s)
  let sessionsChanged = local.sessions.some((s) => dead.has(s.id))
  for (const s of incoming.sessions) {
    if (dead.has(s.id)) continue
    const current = byId.get(s.id)
    if (!current || sessionVersion(s) > sessionVersion(current)) {
      byId.set(s.id, s)
      sessionsChanged = true
    }
  }

  const lt = local.fieldTimes ?? {}
  const it = incoming.fieldTimes ?? {}
  const newer = (key: string) => (it[key] ?? 0) > (lt[key] ?? 0)
  const fieldTimes = { ...lt }
  let fieldsChanged = false
  const settings = { ...local.settings }
  for (const key of Object.keys(incoming.settings) as (keyof Settings)[]) {
    if (newer(`settings.${key}`) && settings[key] !== incoming.settings[key]) {
      ;(settings as Record<string, unknown>)[key] = incoming.settings[key]
      fieldTimes[`settings.${key}`] = it[`settings.${key}`]
      fieldsChanged = true
    }
  }
  const profile = { ...local.profile }
  for (const key of new Set([...Object.keys(incoming.profile), ...Object.keys(local.profile)]) as Set<keyof Profile>) {
    if (newer(`profile.${key}`) && JSON.stringify(profile[key]) !== JSON.stringify(incoming.profile[key])) {
      ;(profile as Record<string, unknown>)[key] = incoming.profile[key]
      fieldTimes[`profile.${key}`] = it[`profile.${key}`]
      fieldsChanged = true
    }
  }
  const videoLinks = { ...local.videoLinks }
  for (const key of new Set([...Object.keys(incoming.videoLinks), ...Object.keys(local.videoLinks)])) {
    if (newer(`videoLinks.${key}`) && videoLinks[key] !== incoming.videoLinks[key]) {
      if (incoming.videoLinks[key]) videoLinks[key] = incoming.videoLinks[key]
      else delete videoLinks[key]
      fieldTimes[`videoLinks.${key}`] = it[`videoLinks.${key}`]
      fieldsChanged = true
    }
  }
  const setups = { ...(local.setups ?? {}) }
  for (const [key, setup] of Object.entries(incoming.setups ?? {})) {
    if ((setup.updatedAt ?? 0) > (setups[key]?.updatedAt ?? 0)) {
      setups[key] = setup
      fieldsChanged = true
    }
  }
  let name = local.name
  if (newer('name') && incoming.name !== local.name) {
    name = incoming.name
    fieldTimes.name = it.name
    fieldsChanged = true
  }
  let stepFields: Pick<AppState, 'stepId' | 'baseStepId' | 'unlocked' | 'grandfatheredStepId'> = {
    stepId: local.stepId,
    baseStepId: local.baseStepId,
    unlocked: local.unlocked,
    grandfatheredStepId: local.grandfatheredStepId,
  }
  if (newer('step')) {
    stepFields = {
      stepId: incoming.stepId,
      baseStepId: incoming.baseStepId,
      unlocked: incoming.unlocked,
      grandfatheredStepId: incoming.grandfatheredStepId,
    }
    fieldTimes.step = it.step
    fieldsChanged = true
  }

  const symptomIds = new Set((local.symptoms ?? []).map((s) => s.id))
  const newSymptoms = (incoming.symptoms ?? []).filter((s) => !symptomIds.has(s.id))
  const measurementTimes = new Set(local.measurements.map((m) => m.at))
  const newMeasurements = incoming.measurements.filter((m) => !measurementTimes.has(m.at))
  const lastBackupAt = Math.max(local.lastBackupAt ?? 0, incoming.lastBackupAt ?? 0) || undefined
  const measureSnoozedAt = Math.max(local.measureSnoozedAt ?? 0, incoming.measureSnoozedAt ?? 0) || undefined
  const assessment =
    incoming.assessment && (!local.assessment || incoming.assessment.at > local.assessment.at)
      ? incoming.assessment
      : local.assessment
  const tombstonesChanged = tombstones.length !== (local.deletedSessionIds ?? []).length

  if (
    !sessionsChanged &&
    !fieldsChanged &&
    !tombstonesChanged &&
    newSymptoms.length === 0 &&
    newMeasurements.length === 0 &&
    lastBackupAt === local.lastBackupAt &&
    measureSnoozedAt === local.measureSnoozedAt &&
    assessment === local.assessment
  ) {
    return local
  }

  const merged: AppState = {
    ...local,
    ...stepFields,
    name,
    settings,
    profile,
    videoLinks,
    setups,
    fieldTimes,
    deletedSessionIds: tombstones,
    symptoms: [...(local.symptoms ?? []), ...newSymptoms].sort((a, b) => a.at - b.at).slice(-MAX_SYMPTOMS),
    measurements: [...local.measurements, ...newMeasurements].sort((a, b) => a.at - b.at),
    lastBackupAt,
    measureSnoozedAt,
    ...(assessment ? { assessment } : {}),
  }
  return sessionsChanged || stepFields.stepId !== local.stepId
    ? rebuildDerivedState(merged, [...byId.values()].sort((a, b) => a.startedAt - b.startedAt))
    : merged
}

function reduceAction(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SAVE_SESSION':
      return applySession(state, action.session).next
    case 'DELETE_SESSION': {
      const deletedSessionIds = [...new Set([...(state.deletedSessionIds ?? []), action.id])].slice(-MAX_TOMBSTONES)
      return rebuildDerivedState(
        { ...state, deletedSessionIds },
        state.sessions.filter((s) => s.id !== action.id),
      )
    }
    case 'SET_SETTINGS':
      return {
        ...state,
        settings: { ...state.settings, ...action.patch },
        fieldTimes: stamp(state, Object.keys(action.patch).map((k) => `settings.${k}`)),
      }
    case 'SET_STEP': {
      if (!state.unlocked.includes(action.stepId)) return state
      return { ...state, stepId: action.stepId, fieldTimes: stamp(state, ['step']) }
    }
    case 'SKIP_TO_STEP':
      return { ...skipToStep(state, action.stepId), fieldTimes: stamp(state, ['step']) }
    case 'COMPLETE_ONBOARDING': {
      const target = STEP_BY_ID[action.stepId]
      const unlocked = STEPS.filter((s) => s.order <= target.order).map((s) => s.id)
      let next: AppState = {
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
        fieldTimes: stamp(state, [
          'name',
          'step',
          'settings.weeklyGoal',
          'settings.units',
          ...Object.keys(action.profile).map((k) => `profile.${k}`),
        ]),
      }
      for (const event of action.symptoms ?? []) next = appendSymptom(next, event)
      return next
    }
    case 'SET_VIDEO': {
      const videoLinks = { ...state.videoLinks }
      if (action.url) videoLinks[action.exerciseId] = action.url
      else delete videoLinks[action.exerciseId]
      return { ...state, videoLinks, fieldTimes: stamp(state, [`videoLinks.${action.exerciseId}`]) }
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
      return {
        ...state,
        profile: { ...state.profile, ...action.patch },
        fieldTimes: stamp(state, Object.keys(action.patch).map((k) => `profile.${k}`)),
      }
    case 'SET_NAME':
      return state.name === action.name ? state : { ...state, name: action.name, fieldTimes: stamp(state, ['name']) }
    case 'STAMP_BACKUP':
      return { ...state, lastBackupAt: action.at }
    case 'RECORD_SYMPTOM':
      return appendSymptom(state, action.event)
    case 'UPDATE_SET_FORM': {
      let found = false
      const sessions = state.sessions.map((s) => {
        if (s.id !== action.sessionId) return s
        const sets = s.sets.map((set) => {
          if (set.at !== action.setAt) return set
          found = true
          return { ...set, form: action.form }
        })
        return { ...s, sets, updatedAt: Date.now() }
      })
      if (!found) return state
      // Unlocks and badges depend on form evidence, so history is replayed.
      return rebuildDerivedState({ ...state, sessions }, sessions)
    }
    case 'SET_SETUP': {
      const setups = { ...(state.setups ?? {}) }
      if (action.setup) setups[action.exerciseId] = { ...action.setup, updatedAt: Date.now() }
      else delete setups[action.exerciseId]
      return { ...state, setups }
    }
    case 'MERGE_EXTERNAL':
      return mergeExternalState(state, action.incoming)
    case 'REPLACE': {
      const replaced = reconcileAchievements(normalizeState(action.state))
      if (action.reason === 'sample') {
        // Sample data is a different dataset, not an edit of this one.
        return {
          ...replaced,
          epoch: newEpoch(),
          retiredEpochs: [...(state.retiredEpochs ?? []), ...(state.epoch ? [state.epoch] : [])].slice(
            -MAX_RETIRED_EPOCHS,
          ),
        }
      }
      return replaced
    }
    case 'IMPORT_REPLACE': {
      // The guard that makes the import a transaction: if anything was saved
      // after the file was staged, the staged snapshot is stale and replacing
      // with it would silently erase that newer work.
      if ((state.rev ?? 0) !== action.expectedRev) return state
      const imported = reconcileAchievements(normalizeState(action.state))
      return {
        ...imported,
        epoch: newEpoch(),
        retiredEpochs: [...(state.retiredEpochs ?? []), ...(state.epoch ? [state.epoch] : [])].slice(
          -MAX_RETIRED_EPOCHS,
        ),
      }
    }
    case 'RESET':
      return {
        ...initialState(),
        settings: { ...state.settings },
        retiredEpochs: [...(state.retiredEpochs ?? []), ...(state.epoch ? [state.epoch] : [])].slice(
          -MAX_RETIRED_EPOCHS,
        ),
      }
  }
}

/** Every change is a new revision, so long operations can detect a newer write. */
export function reducer(state: AppState, action: Action): AppState {
  const next = reduceAction(state, action)
  if (next === state) return state
  return { ...next, rev: Math.max(state.rev ?? 0, next.rev ?? 0) + 1 }
}

/** Whether the latest changes reached durable storage, in the athlete's terms. */
export interface PersistStatus {
  /** The primary copy (localStorage). "Saved" means this. */
  primary: 'ok' | 'failed' | 'held'
  /** The second on-device copy (IndexedDB). */
  mirror: 'ok' | 'failed' | 'pending' | 'idle'
  error?: string
}

interface StoreValue {
  state: AppState
  dispatch: (action: Action) => void
  /** The latest state, readable from async code after its awaits. */
  getState: () => AppState
  persist: PersistStatus
  boot: BootInfo
  /** Resolve an unreadable boot: start fresh (the original stays quarantined). */
  startFresh: () => void
  /** Retry writing the current state to both copies now. */
  retrySave: () => void
}

const StoreCtx = createContext<StoreValue | null>(null)

/** How long boot waits for the mirror before showing an editable UI anyway. */
const MIRROR_BOOT_WAIT_MS = 1500

export function StoreProvider({ children }: { children: ReactNode }) {
  const [load] = useState(loadState)
  const [state, dispatch] = useReducer(reducer, load.state)
  const stateRef = useRef(state)
  stateRef.current = state
  const mirrorTimer = useRef<number | undefined>(undefined)
  const pendingMirror = useRef<string | null>(null)
  const [persist, setPersist] = useState<PersistStatus>({ primary: load.failed ? 'held' : 'ok', mirror: 'idle' })
  const [boot, setBoot] = useState<BootInfo>(() =>
    load.failed
      ? { phase: 'checking-backup', failure: { reason: load.failed, bytes: load.rawBytes ?? 0 } }
      : load.empty
        ? { phase: 'checking-backup' }
        : { phase: 'ready' },
  )
  // While the saved data is unreadable and unresolved, nothing may overwrite
  // it — not even the empty placeholder state the app is showing.
  const holdWrites = boot.phase === 'unreadable' || (boot.phase === 'checking-backup' && Boolean(load.failed))

  const flushMirror = useCallback(() => {
    window.clearTimeout(mirrorTimer.current)
    const json = pendingMirror.current
    if (json === null) return
    pendingMirror.current = null
    void writeMirror(json).then((ok) => {
      setPersist((p) => (p.mirror === (ok ? 'ok' : 'failed') ? p : { ...p, mirror: ok ? 'ok' : 'failed' }))
    })
  }, [])

  const writeNow = useCallback(
    (current: AppState) => {
      let json: string
      try {
        json = JSON.stringify(current)
      } catch {
        return
      }
      try {
        localStorage.setItem(STORAGE_KEY, json)
        setPersist((p) => (p.primary === 'ok' && !p.error ? p : { ...p, primary: 'ok', error: undefined }))
      } catch (err) {
        // Storage full, evicted, or private mode. Keep going: the mirror is the
        // recovery copy for exactly this failure — but say so, because silence
        // here is how an athlete closes the app believing a session was saved.
        setPersist((p) => ({
          ...p,
          primary: 'failed',
          error: err instanceof Error ? err.name || err.message : 'storage unavailable',
        }))
      }
      // Not reported as 'pending' in React state: toggling it on every change
      // would re-render every store consumer twice per write for no benefit.
      pendingMirror.current = json
      window.clearTimeout(mirrorTimer.current)
      mirrorTimer.current = window.setTimeout(flushMirror, 1500)
    },
    [flushMirror],
  )

  // Persist on every change: localStorage immediately, the IndexedDB mirror
  // debounced (it's the recovery copy, not the hot path).
  useEffect(() => {
    if (holdWrites) {
      setPersist((p) => (p.primary === 'held' ? p : { ...p, primary: 'held' }))
      return
    }
    writeNow(state)
  }, [state, holdWrites, writeNow])

  // A pending mirror write must not die with a backgrounded tab: hidden can be
  // the last moment a phone ever runs this page.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushMirror()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flushMirror)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flushMirror)
    }
  }, [flushMirror])

  // Other tabs are independent writers; fold their writes in.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || !event.newValue) return
      try {
        const incoming = normalizeState(JSON.parse(event.newValue))
        dispatch({ type: 'MERGE_EXTERNAL', incoming })
      } catch {
        /* ignore an incomplete/corrupt external write */
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Primary copy missing or unreadable: look for the mirror before handing the
  // athlete an editable app. A restore that arrives *after* they have started
  // using it must not overwrite what they did — that is the late-mirror race
  // that replaced fresh onboarding choices with an older recovered state.
  useEffect(() => {
    if (boot.phase !== 'checking-backup') return
    const bootRev = stateRef.current.rev ?? 0
    let settled = false
    const finishWithoutRestore = () => {
      if (settled) return
      settled = true
      setBoot((b) => (load.failed ? { ...b, phase: 'unreadable' } : { phase: 'ready' }))
    }
    const timer = window.setTimeout(finishWithoutRestore, MIRROR_BOOT_WAIT_MS)
    void readMirror().then((raw) => {
      let recovered: AppState | null = null
      if (raw) {
        try {
          const candidate = normalizeState(JSON.parse(raw))
          if (candidate.onboarded || candidate.sessions.length > 0) recovered = candidate
        } catch {
          recovered = null
        }
      }
      if (!recovered) {
        window.clearTimeout(timer)
        finishWithoutRestore()
        return
      }
      if ((stateRef.current.rev ?? 0) !== bootRev) {
        // The athlete has already acted. Their newer state wins; the older
        // copy is offered, not imposed.
        pushToast(
          'An older on-device backup was found after you had started. Your current data was kept — export it before restoring anything else.',
          'info',
          8000,
        )
        return
      }
      window.clearTimeout(timer)
      settled = true
      dispatch({ type: 'REPLACE', state: recovered, reason: 'restore' })
      setBoot({ phase: 'ready' })
      pushToast(
        load.failed
          ? 'Your saved data could not be read, so the on-device backup was restored. The unreadable copy is kept aside in Settings → Data.'
          : 'Restored your data from the on-device backup.',
        'success',
        6000,
      )
    })
    return () => window.clearTimeout(timer)
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

  const getState = useCallback(() => stateRef.current, [])
  const startFresh = useCallback(() => setBoot({ phase: 'ready' }), [])
  const retrySave = useCallback(() => {
    writeNow(stateRef.current)
    flushMirror()
  }, [writeNow, flushMirror])

  const value = useMemo(
    () => ({ state, dispatch, getState, persist, boot, startFresh, retrySave }),
    [state, getState, persist, boot, startFresh, retrySave],
  )
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore(): StoreValue {
  const v = useContext(StoreCtx)
  if (!v) throw new Error('useStore must be used inside StoreProvider')
  return v
}
