import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react'
import type {
  AppState,
  EquipmentId,
  FormCheck,
  FormIssue,
  Measurement,
  Profile,
  Session,
  SetLog,
  Settings,
  StepId,
  Units,
} from '../types'
import { STEPS, STEP_BY_ID } from '../data/progressions'
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
  // Coming out of a hold and then reaching the button is realistically about
  // a second unless the phone is literally in your hand.
  stopLatencySec: 1,
  units: 'metric',
  recordForm: true,
}

/** The stop-latency default before it was found to be optimistic. */
const LEGACY_LATENCY = 0.4

export function initialState(): AppState {
  return {
    version: 2,
    onboarded: false,
    name: '',
    startedAt: Date.now(),
    stepId: 'foundations',
    baseStepId: 'foundations',
    unlocked: ['foundations'],
    sessions: [],
    prs: {},
    achievements: {},
    videoLinks: {},
    profile: { equipment: ['floor'] },
    measurements: [],
    settings: { ...DEFAULT_SETTINGS },
  }
}

function clampNum(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
}

const FORM_RATINGS = new Set(['clean', 'slipped', 'broke'])
const FORM_ISSUES = new Set(['arms', 'scapula', 'hips', 'level'])
const EQUIPMENT_IDS = new Set(['floor', 'parallettes', 'band', 'pullup-bar', 'dip-bars'])

/** A hand-edited `issues` string would otherwise be iterated per character. */
function sanitizeForm(f: unknown): FormCheck | undefined {
  if (typeof f !== 'object' || f === null) return undefined
  const c = f as Partial<FormCheck>
  if (typeof c.rating !== 'string' || !FORM_RATINGS.has(c.rating)) return undefined
  const issues = Array.isArray(c.issues)
    ? c.issues.filter((i): i is FormIssue => typeof i === 'string' && FORM_ISSUES.has(i))
    : undefined
  return {
    rating: c.rating as FormCheck['rating'],
    ...(issues && issues.length ? { issues } : {}),
    ...(typeof c.clipKey === 'string' ? { clipKey: c.clipKey } : {}),
  }
}

function clampOptional(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined
}

/**
 * Drop anything that would crash the app downstream. An imported file is
 * untrusted input: a session without a `sets` array used to white-screen every
 * screen that sums it, and the bad state was already persisted by then.
 */
function sanitizeSessions(raw: unknown): Session[] {
  if (!Array.isArray(raw)) return []
  const out: Session[] = []
  for (const s of raw) {
    if (typeof s !== 'object' || s === null) continue
    const c = s as Partial<Session>
    if (typeof c.startedAt !== 'number' || !Number.isFinite(c.startedAt)) continue
    const sets = Array.isArray(c.sets)
      ? c.sets
          .filter(
            (x): x is Session['sets'][number] =>
              typeof x === 'object' &&
              x !== null &&
              typeof (x as SetLog).exerciseId === 'string' &&
              typeof (x as SetLog).value === 'number' &&
              Number.isFinite((x as SetLog).value),
          )
          .map((x) => ({ ...x, form: sanitizeForm(x.form) }))
      : []
    out.push({
      id: typeof c.id === 'string' && c.id ? c.id : crypto.randomUUID(),
      startedAt: c.startedAt,
      endedAt: typeof c.endedAt === 'number' ? c.endedAt : c.startedAt,
      workoutName: typeof c.workoutName === 'string' ? c.workoutName : 'Session',
      workoutKind: c.workoutKind === 'template' || c.workoutKind === 'test' ? c.workoutKind : 'auto',
      stepId: c.stepId && STEP_BY_ID[c.stepId] ? c.stepId : 'foundations',
      sets,
      rpe: typeof c.rpe === 'number' ? c.rpe : undefined,
      notes: typeof c.notes === 'string' ? c.notes : undefined,
      strategy: c.strategy,
      checkIn: c.checkIn,
    })
  }
  return out
}

/** Coerce anything (old versions, imported files) into a valid AppState. */
export function normalizeState(raw: unknown): AppState {
  const base = initialState()
  if (typeof raw !== 'object' || raw === null) return base
  const r = raw as Partial<AppState>
  const stepId: StepId = r.stepId && STEP_BY_ID[r.stepId] ? r.stepId : 'foundations'
  const unlocked = Array.isArray(r.unlocked)
    ? (r.unlocked.filter((id): id is StepId => typeof id === 'string' && id in STEP_BY_ID) as StepId[])
    : []
  if (!unlocked.includes('foundations')) unlocked.unshift('foundations')
  if (!unlocked.includes(stepId)) unlocked.push(stepId)

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
    recordForm: typeof rawSettings.recordForm === 'boolean' ? rawSettings.recordForm : DEFAULT_SETTINGS.recordForm,
  }
  // One-time migration: anyone still carrying the old optimistic default gets
  // the realistic one. Deliberate choices made after this are left alone.
  const priorVersion = typeof r.version === 'number' ? r.version : 1
  if (priorVersion < 2 && settings.stopLatencySec === LEGACY_LATENCY) {
    settings.stopLatencySec = DEFAULT_SETTINGS.stopLatencySec
  }

  return {
    version: 2,
    onboarded: Boolean(r.onboarded),
    name: typeof r.name === 'string' ? r.name : '',
    startedAt: typeof r.startedAt === 'number' ? r.startedAt : Date.now(),
    lastBackupAt: typeof r.lastBackupAt === 'number' ? r.lastBackupAt : undefined,
    stepId,
    // Older saves predate this field and their placement is unrecoverable, so
    // anchor at the current step: never demote someone who is already there.
    baseStepId: r.baseStepId && STEP_BY_ID[r.baseStepId] ? r.baseStepId : stepId,
    unlocked,
    sessions: sanitizeSessions(r.sessions),
    prs: typeof r.prs === 'object' && r.prs !== null ? (r.prs as AppState['prs']) : {},
    achievements:
      typeof r.achievements === 'object' && r.achievements !== null
        ? (r.achievements as AppState['achievements'])
        : {},
    videoLinks:
      typeof r.videoLinks === 'object' && r.videoLinks !== null
        ? (r.videoLinks as AppState['videoLinks'])
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

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      bootedFresh = true
      return initialState()
    }
    return normalizeState(JSON.parse(raw))
  } catch {
    bootedFresh = true
    return initialState()
  }
}

/** Rebuild PRs / unlocks / achievements by replaying history (after deletes/imports). */
function replay(state: AppState, sessions: Session[]): AppState {
  const base = STEP_BY_ID[state.baseStepId] ? state.baseStepId : 'foundations'
  const baseOrder = STEP_BY_ID[base].order
  let acc: AppState = {
    ...state,
    sessions: [],
    prs: {},
    achievements: {},
    stepId: base,
    unlocked: STEPS.filter((s) => s.order <= baseOrder).map((s) => s.id),
  }
  for (const s of [...sessions].sort((a, b) => a.startedAt - b.startedAt)) {
    acc = applySession(acc, s).next
  }
  return acc
}

export type Action =
  | { type: 'SAVE_SESSION'; session: Session }
  | { type: 'DELETE_SESSION'; id: string }
  | { type: 'SET_SETTINGS'; patch: Partial<Settings> }
  | { type: 'SET_STEP'; stepId: StepId }
  | {
      type: 'COMPLETE_ONBOARDING'
      name: string
      stepId: StepId
      weeklyGoal: number
      profile: Profile
      units: Units
      weightKg?: number
      heightCm?: number
    }
  | { type: 'SET_VIDEO'; exerciseId: string; url: string | null }
  | { type: 'LOG_MEASUREMENT'; weightKg?: number; heightCm?: number }
  | { type: 'SET_PROFILE'; patch: Partial<Profile> }
  | { type: 'REPLACE'; state: AppState }
  | { type: 'RESET' }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SAVE_SESSION':
      return applySession(state, action.session).next
    case 'DELETE_SESSION':
      return replay(
        state,
        state.sessions.filter((s) => s.id !== action.id),
      )
    case 'SET_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.patch } }
    case 'SET_STEP': {
      if (!state.unlocked.includes(action.stepId)) return state
      return { ...state, stepId: action.stepId }
    }
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
      if (action.weightKg !== undefined) entry.weightKg = action.weightKg
      if (action.heightCm !== undefined) entry.heightCm = action.heightCm
      if (entry.weightKg === undefined && entry.heightCm === undefined) return state
      return {
        ...state,
        measurements: [...state.measurements, entry],
        profile: action.heightCm !== undefined ? { ...state.profile, heightCm: action.heightCm } : state.profile,
      }
    }
    case 'SET_PROFILE':
      return { ...state, profile: { ...state.profile, ...action.patch } }
    case 'REPLACE':
      return normalizeState(action.state)
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
      localStorage.setItem(STORAGE_KEY, json)
    } catch {
      // Storage full or unavailable — the app still works for this session.
      return
    }
    window.clearTimeout(mirrorTimer.current)
    mirrorTimer.current = window.setTimeout(() => void writeMirror(json), 1500)
  }, [state])

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
    configureAudio(state.settings.sound, state.settings.volume)
  }, [state.settings.sound, state.settings.volume])

  const value = useMemo(() => ({ state, dispatch }), [state])
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore(): StoreValue {
  const v = useContext(StoreCtx)
  if (!v) throw new Error('useStore must be used inside StoreProvider')
  return v
}
