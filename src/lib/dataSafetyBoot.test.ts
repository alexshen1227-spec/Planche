// @vitest-environment jsdom
/**
 * Boot, the mirror and the primary copy, driven through the real provider.
 *
 * The history lives only in this browser, so the order of reads and writes at
 * boot decides whether it survives a full disk or a slow IndexedDB. Each test
 * asserts what ends up stored, never the wording around it.
 */
import { act, cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState, Session } from '../types'

const mirror = vi.hoisted(() => ({ value: null as string | null, writes: [] as string[], readDelayMs: 0 }))
vi.mock('./persist', () => ({
  readMirror: () => new Promise<string | null>((resolve) => setTimeout(() => resolve(mirror.value), mirror.readDelayMs)),
  writeMirror: async (json: string) => {
    mirror.writes.push(json)
    mirror.value = json
    return true
  },
  clearMirror: async () => {
    mirror.value = null
    return true
  },
  requestPersistence: async () => true,
  storageInfo: async () => ({ persisted: null, usageBytes: null }),
}))
const toasts = vi.hoisted(() => [] as { text: string; kind: string }[])
vi.mock('./toast', () => ({
  pushToast: (text: string, kind = 'info') => {
    toasts.push({ text, kind })
  },
  dismissToast: () => undefined,
  subscribeToasts: () => () => undefined,
}))

import { initialState, QUARANTINE_KEY, StoreProvider, useStore } from './store'

const KEY = 'planchelab.v1'
const DAY = 86_400_000
const T = new Date(2026, 9, 1, 12).getTime()
const sess = (id: string, at: number): Session => ({
  id,
  startedAt: at,
  endedAt: at + 1000,
  workoutName: 'Session',
  workoutKind: 'auto',
  stepId: 'foundations',
  sets: [{ exerciseId: 'tuck-planche', kind: 'hold', value: 6, target: 10, section: 'main', at: at + 10 }],
  savedAt: at + 1000,
})

type Store = ReturnType<typeof useStore>
let store: Store | undefined
function Grab() {
  store = useStore()
  return null
}
const mount = () => render(createElement(StoreProvider, null, createElement(Grab)))
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))
const sessionsIn = (json: string | null | undefined) => (json ? (JSON.parse(json).sessions as unknown[]).length : -1)
const storageNotices = () => toasts.filter((t) => t.kind === 'danger').length

beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).matchMedia = (q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })
  vi.useFakeTimers()
  vi.setSystemTime(T + 5 * DAY)
  mirror.value = null
  mirror.writes = []
  mirror.readDelayMs = 0
  toasts.length = 0
  store = undefined
})
afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function failPrimaryWrites() {
  const realSet = Storage.prototype.setItem
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
    if (k === KEY) throw new DOMException('full', 'QuotaExceededError')
    return realSet.call(this, k, v)
  })
}

describe('a full disk: the mirror holds the newest sessions', () => {
  it('boot merges the newer mirror and never writes the stale primary over it', async () => {
    const stale: AppState = { ...initialState(), onboarded: true, epoch: 'E', sessions: [sess('s1', T)], rev: 5 }
    const newer: AppState = { ...stale, sessions: [sess('s1', T), sess('s2', T + DAY), sess('s3', T + 2 * DAY)], rev: 9 }
    localStorage.setItem(KEY, JSON.stringify(stale))
    mirror.value = JSON.stringify(newer)
    failPrimaryWrites()
    mount()
    await advance(100)
    await advance(3000)
    // The app holds all three, and the mirror never held fewer.
    expect(store!.state.sessions.map((s) => s.id).sort()).toEqual(['s1', 's2', 's3'])
    expect(mirror.writes.length).toBeGreaterThan(0)
    expect(mirror.writes.map(sessionsIn)).toEqual(mirror.writes.map(() => 3))
    expect(sessionsIn(mirror.value)).toBe(3)
  })

  it('a failed save is said once a session, plainly, however many writes fail', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...initialState(), onboarded: true, epoch: 'E', sessions: [sess('s1', T)] }))
    failPrimaryWrites()
    mount()
    await advance(100)
    for (const name of ['A', 'B', 'C']) await act(async () => store!.dispatch({ type: 'SET_NAME', name }))
    await advance(3000)
    expect(store!.persist.primary).toBe('failed')
    expect(store!.persist.error).toBe('storage is full')
    expect(storageNotices()).toBe(1)
  })
})

describe('nothing is written to the mirror before the boot read has looked', () => {
  it('a slow read: the athlete acts first, and the mirror is untouched until the read arrives', async () => {
    const saved: AppState = { ...initialState(), onboarded: true, epoch: 'E', sessions: [sess('s1', T)], rev: 3 }
    localStorage.setItem(KEY, JSON.stringify(saved))
    mirror.value = JSON.stringify(saved)
    mirror.readDelayMs = 2500
    mount()
    await act(async () => store!.dispatch({ type: 'SET_NAME', name: 'Kid' }))
    await advance(2400)
    expect(mirror.writes).toHaveLength(0)
    await advance(4000)
    expect(mirror.writes.length).toBeGreaterThan(0)
    expect(JSON.parse(mirror.value!).name).toBe('Kid')
  })

  it('empty primary, slow mirror, athlete already acting: the found backup is kept aside, not overwritten', async () => {
    const full: AppState = { ...initialState(), onboarded: true, epoch: 'E', sessions: [sess('s1', T), sess('s2', T + DAY)], rev: 9 }
    mirror.value = JSON.stringify(full)
    mirror.readDelayMs = 2500
    mount()
    await advance(1600)
    await act(async () => store!.dispatch({ type: 'SET_NAME', name: 'Kid' }))
    const writesBeforeRead = mirror.writes.length
    await advance(4000)
    expect(writesBeforeRead).toBe(0)
    // The athlete's own state stays; the two-session backup survives in quarantine.
    expect(store!.state.name).toBe('Kid')
    const kept = JSON.parse(localStorage.getItem(QUARANTINE_KEY) ?? 'null')
    expect(sessionsIn(kept?.raw)).toBe(2)
  })

  it('a different dataset in the mirror is kept aside; one this browser retired on purpose is let go', async () => {
    const here: AppState = { ...initialState(), onboarded: true, epoch: 'B', sessions: [sess('h1', T)], rev: 4 }
    const other: AppState = { ...initialState(), onboarded: true, epoch: 'A', sessions: [sess('o1', T), sess('o2', T + DAY)], rev: 2 }
    localStorage.setItem(KEY, JSON.stringify(here))
    mirror.value = JSON.stringify(other)
    mount()
    await advance(3000)
    expect(store!.state.sessions.map((s) => s.id)).toEqual(['h1'])
    expect(sessionsIn(JSON.parse(localStorage.getItem(QUARANTINE_KEY) ?? 'null')?.raw)).toBe(2)
    cleanup()
    localStorage.clear()
    // After a reset (epoch A retired here) the old data is not resurrected.
    localStorage.setItem(KEY, JSON.stringify({ ...here, retiredEpochs: ['A'] }))
    mirror.value = JSON.stringify(other)
    mount()
    await advance(3000)
    expect(localStorage.getItem(QUARANTINE_KEY)).toBeNull()
    expect(sessionsIn(mirror.value)).toBe(1)
  })
})

describe('a newer version’s data is never written over', () => {
  const newerSave = () => {
    const s = JSON.parse(JSON.stringify({ ...initialState(), onboarded: true, epoch: 'E', sessions: [sess('s1', T)] }))
    s.version = 99
    s.futureTopLevel = { important: true }
    s.sessions[0].futureField = 1
    return JSON.stringify(s)
  }

  it('loaded at boot: shown, held, and the bytes on disk stay exactly as the newer version left them', async () => {
    const bytes = newerSave()
    localStorage.setItem(KEY, bytes)
    mirror.value = bytes
    mount()
    await advance(100)
    await act(async () => store!.dispatch({ type: 'SET_NAME', name: 'Older tab' }))
    await advance(4000)
    expect(localStorage.getItem(KEY)).toBe(bytes)
    expect(mirror.writes).toHaveLength(0)
    expect(store!.persist.primary).toBe('held')
    expect(storageNotices()).toBe(1)
  })

  it('found in the mirror at boot: neither copy is written', async () => {
    const mine = JSON.stringify({ ...initialState(), onboarded: true, epoch: 'E', sessions: [sess('s1', T)] })
    localStorage.setItem(KEY, mine)
    const bytes = newerSave()
    mirror.value = bytes
    mount()
    await advance(100)
    await act(async () => store!.dispatch({ type: 'SET_NAME', name: 'Older tab' }))
    await advance(4000)
    expect(mirror.writes).toHaveLength(0)
    expect(mirror.value).toBe(bytes)
    expect(store!.persist.primary).toBe('held')
  })

  it('arriving from another tab: this tab stops writing instead of stripping it', async () => {
    localStorage.setItem(KEY, JSON.stringify({ ...initialState(), onboarded: true, epoch: 'E', sessions: [sess('s1', T)] }))
    mount()
    await advance(3000)
    const bytes = newerSave()
    localStorage.setItem(KEY, bytes)
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: bytes }))
    })
    const mirrorWrites = mirror.writes.length
    await act(async () => store!.dispatch({ type: 'SET_NAME', name: 'Older tab' }))
    await advance(4000)
    expect(localStorage.getItem(KEY)).toBe(bytes)
    expect(mirror.writes).toHaveLength(mirrorWrites)
    expect(store!.persist.primary).toBe('held')
  })
})
