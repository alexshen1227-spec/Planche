import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import type { AppState, Session, Settings, StepId } from '../types'
import { STEPS, STEP_BY_ID } from '../data/progressions'
import { applySession } from './engine'
import { configureAudio } from './audio'

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
}

export function initialState(): AppState {
  return {
    version: 1,
    onboarded: false,
    name: '',
    startedAt: Date.now(),
    stepId: 'foundations',
    unlocked: ['foundations'],
    sessions: [],
    prs: {},
    achievements: {},
    settings: { ...DEFAULT_SETTINGS },
  }
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
  return {
    version: 1,
    onboarded: Boolean(r.onboarded),
    name: typeof r.name === 'string' ? r.name : '',
    startedAt: typeof r.startedAt === 'number' ? r.startedAt : Date.now(),
    stepId,
    unlocked,
    sessions: Array.isArray(r.sessions) ? (r.sessions as Session[]) : [],
    prs: typeof r.prs === 'object' && r.prs !== null ? (r.prs as AppState['prs']) : {},
    achievements:
      typeof r.achievements === 'object' && r.achievements !== null
        ? (r.achievements as AppState['achievements'])
        : {},
    settings: { ...DEFAULT_SETTINGS, ...(typeof r.settings === 'object' ? r.settings : {}) },
  }
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialState()
    return normalizeState(JSON.parse(raw))
  } catch {
    return initialState()
  }
}

/** Rebuild PRs / unlocks / achievements by replaying history (after deletes/imports). */
function replay(state: AppState, sessions: Session[]): AppState {
  let acc: AppState = {
    ...state,
    sessions: [],
    prs: {},
    achievements: {},
    stepId: 'foundations',
    unlocked: ['foundations'],
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
  | { type: 'COMPLETE_ONBOARDING'; name: string; stepId: StepId; weeklyGoal: number }
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
        unlocked,
        settings: { ...state.settings, weeklyGoal: action.weeklyGoal },
      }
    }
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

  // Persist on every change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Storage full or unavailable — the app still works for this session.
    }
  }, [state])

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
