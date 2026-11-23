// @vitest-environment jsdom
/**
 * Data safety, pinned by decision: what is kept, merged, refused or counted.
 * Each block names the defect it pins (independent review, 2026-11-23).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_STATE_VERSION, type AppState, type Session, type SetLog } from '../types'
import {
  eraseRecoveryCopies,
  forgetUnfinishedWork,
  initialState,
  isNewerSave,
  mergeExternalState,
  normalizeState,
  normalizeStateWithReport,
  rebuildDerivedState,
  reducer,
  reportHasLosses,
} from './store'
import { dataOnDevice, ImportError, validateImport } from './exportImport'
import { clearDraft, loadDraft, oldDraftNotice, saveDraft, type DraftInput } from './draft'
import { goalForWeek, weekStreak } from './stats'
import { trainingWeek } from './plan/screens'
import { defaultGym } from './gym/state'
import { weekStart } from './time'
import { buildSampleState } from '../data/sample'

const DAY = 86_400_000
const HOUR = 3_600_000
const wire = (s: AppState) => normalizeState(JSON.parse(JSON.stringify(s)))
const plain = (v: unknown) => JSON.parse(JSON.stringify(v))
const holdSet = (exerciseId: string, value: number, at: number): SetLog => ({ exerciseId, kind: 'hold', value, target: 10, section: 'main', at })
const session = (id: string, at: number, sets: SetLog[] = [holdSet('tuck-planche', 6, at + 10)]): Session => ({
  id,
  startedAt: at,
  endedAt: at + 1_800_000,
  workoutName: 'Session',
  workoutKind: 'auto',
  stepId: 'foundations',
  sets,
  savedAt: at + 1_800_000,
})
const at = (t: number) => {
  vi.useFakeTimers()
  vi.setSystemTime(t)
}
afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

const onboarding = {
  type: 'COMPLETE_ONBOARDING' as const,
  name: 'Kid',
  stepId: 'tuck' as const,
  weeklyGoal: 3,
  profile: { equipment: ['floor', 'parallettes'], preferredSurface: 'floor', goalStepId: 'straddle', birthYear: 2010 } as AppState['profile'],
  units: 'metric' as const,
  weightKg: 55,
  heightCm: 168,
}

describe('an unfinished session with logged sets is never deleted for its age', () => {
  const draft = (logs: number, holding = false): DraftInput =>
    ({ workout: { name: 'W' }, logs: Array.from({ length: logs }, (_, i) => ({ at: i, value: 12 })), wasHolding: holding, holdElapsed: holding ? 8 : 0 }) as never

  it('kept and offered at 19 hours and at three days, with its age said', () => {
    const t = new Date(2026, 9, 5, 18).getTime()
    at(t)
    saveDraft(draft(2))
    expect(loadDraft(t + 19 * HOUR)).not.toBeNull()
    expect(loadDraft(t + 3 * DAY)).not.toBeNull()
    expect(localStorage.getItem('planchelab.draft')).not.toBeNull()
    expect(oldDraftNotice({ savedAt: t, logs: [] as never }, t + 3 * DAY)).not.toBeNull()
    // A recent interruption needs no notice.
    expect(oldDraftNotice({ savedAt: t, logs: [] as never }, t + HOUR)).toBeNull()
  })

  it('with nothing logged, the 18-hour rule still clears it', () => {
    const t = new Date(2026, 9, 5, 18).getTime()
    at(t)
    saveDraft(draft(0, true))
    expect(loadDraft(t + HOUR)).not.toBeNull()
    expect(loadDraft(t + 19 * HOUR)).toBeNull()
    expect(localStorage.getItem('planchelab.draft')).toBeNull()
    clearDraft()
  })
})

describe('setup in one tab, the welcome screen in another', () => {
  it('finishing setup is merged one way, and the dataset starts when either tab first had it', () => {
    at(new Date(2026, 9, 5, 18).getTime())
    const base = initialState()
    let A = base
    const B0 = wire(base)
    vi.setSystemTime(Date.now() + 60_000)
    A = reducer(A, onboarding)
    const B = reducer(B0, { type: 'MERGE_EXTERNAL', incoming: wire(A) })
    expect(B.onboarded).toBe(true)
    expect(wire(B).onboarded).toBe(true)
    const A2 = reducer(A, { type: 'MERGE_EXTERNAL', incoming: wire(B) })
    expect(A2.onboarded).toBe(true)
    expect(A2.startedAt).toBe(Math.min(base.startedAt, A.startedAt))
    // Either order lands on the same dataset, and a second pass changes nothing.
    const pick = (s: AppState) => ({ onboarded: s.onboarded, startedAt: s.startedAt, name: s.name, stepId: s.stepId })
    expect(pick(mergeExternalState(A, wire(B0)))).toEqual(pick(mergeExternalState(B0, wire(A))))
    expect(mergeExternalState(A2, wire(A2))).toBe(A2)
  })

  it('setup finished again over a history keeps measurements, kit, birth year, start date and placement', () => {
    at(new Date(2026, 9, 5, 18).getTime())
    let C = wire(reducer(initialState(), onboarding))
    vi.setSystemTime(Date.now() + DAY)
    C = reducer(C, { type: 'SAVE_SESSION', session: { ...session('s1', Date.now()), stepId: 'tuck' } })
    C = reducer(C, { type: 'LOG_MEASUREMENT', weightKg: 56 })
    const before = { measurements: C.measurements.length, startedAt: C.startedAt }
    vi.setSystemTime(Date.now() + DAY)
    C = reducer(C, { ...onboarding, stepId: 'foundations', profile: { equipment: ['floor'] }, weightKg: 57, heightCm: undefined })
    expect(C.onboarded).toBe(true)
    expect(C.measurements).toHaveLength(before.measurements + 1)
    expect(C.startedAt).toBe(before.startedAt)
    expect(C.stepId).toBe('tuck')
    expect(C.profile.equipment).toContain('parallettes')
    expect(C.profile.birthYear).toBe(2010)
  })
})

describe('an untouched placeholder never replaces a history', () => {
  const full = (): AppState => ({ ...initialState(), onboarded: true, name: 'Real', sessions: [session('s1', 1e12), session('s2', 1e12 + DAY)] })
  it('whatever the epoch order, and in either direction', () => {
    for (const [fullEpoch, emptyEpoch] of [
      ['1111', 'ffff'],
      ['ffff', '1111'],
    ]) {
      const f = { ...full(), epoch: fullEpoch }
      const e = { ...initialState(), epoch: emptyEpoch }
      expect(mergeExternalState(f, e).sessions).toHaveLength(2)
      expect(mergeExternalState(e, f).sessions).toHaveLength(2)
      expect(mergeExternalState(e, f).onboarded).toBe(true)
    }
  })
  it('a reset still reaches the other tab: it retired the old dataset on purpose', () => {
    const f = { ...full(), epoch: 'aaaa' }
    const reset = wire(reducer(f, { type: 'RESET' }))
    expect(mergeExternalState(f, reset).sessions).toHaveLength(0)
  })
})

describe('a newer version’s data', () => {
  it('is recognised by its version, and its backup is refused as newer, not as incomplete', () => {
    const valid = plain({ ...initialState(), onboarded: true })
    expect(isNewerSave(valid)).toBe(false)
    expect(isNewerSave({ ...valid, version: CURRENT_STATE_VERSION + 1 })).toBe(true)
    expect(() => validateImport(valid)).not.toThrow()
    const reason = (raw: unknown) => {
      try {
        validateImport(raw)
        return 'accepted'
      } catch (err) {
        return err instanceof ImportError ? err.reason : 'other'
      }
    }
    expect(reason({ ...valid, version: CURRENT_STATE_VERSION + 1 })).toBe('newer-version')
    expect(reason({ ...valid, sessions: 'none' })).toBe('incomplete')
    expect(reason(42)).toBe('not-backup')
  })
})

describe('the birth year is not bounded by the device clock', () => {
  it('a clock in 2001 keeps 2010, now and after the clock is fixed', () => {
    at(new Date(2026, 9, 5).getTime())
    const saved = plain(reducer({ ...initialState(), onboarded: true }, { type: 'SET_PROFILE', patch: { birthYear: 2010 } }))
    vi.setSystemTime(new Date(2001, 0, 1).getTime())
    const loaded = normalizeStateWithReport(saved, new Date(2026, 9, 5).getTime()).state
    expect(loaded.profile.birthYear).toBe(2010)
    expect(normalizeStateWithReport(saved, new Date(2001, 0, 1).getTime()).state.profile.birthYear).toBe(2010)
    expect(normalizeStateWithReport(saved).state.profile.birthYear).toBe(2010)
  })
})

describe('weekly goal: each week keeps the goal it was trained under', () => {
  it('streak badges earned at 2 a week survive two goal changes and a replay', () => {
    const mon = new Date(2026, 5, 1, 18).getTime()
    at(mon)
    let s: AppState = { ...initialState(), onboarded: true, settings: { ...initialState().settings, weeklyGoal: 2 } }
    for (let w = 0; w < 5; w++)
      for (const d of [0, 2]) {
        const t = mon + (w * 7 + d) * DAY
        vi.setSystemTime(t)
        s = reducer(s, { type: 'SAVE_SESSION', session: session(`w${w}d${d}`, t, [holdSet('planche-lean', 10, t + 1000)]) })
      }
    expect(Object.keys(s.achievements)).toEqual(expect.arrayContaining(['streak-2', 'streak-4']))
    vi.setSystemTime(mon + 5 * 7 * DAY + DAY)
    s = reducer(s, { type: 'SET_SETTINGS', patch: { weeklyGoal: 3 } })
    vi.setSystemTime(mon + 6 * 7 * DAY + DAY)
    s = reducer(s, { type: 'SET_SETTINGS', patch: { weeklyGoal: 5 } })
    const t = mon + 6 * 7 * DAY + 2 * DAY
    vi.setSystemTime(t)
    s = reducer(s, { type: 'SAVE_SESSION', session: session('oops', t) })
    s = reducer(s, { type: 'DELETE_SESSION', id: 'oops' })
    expect(Object.keys(s.achievements)).toEqual(expect.arrayContaining(['streak-2', 'streak-4']))
    expect(weekStreak(s, mon + 4 * 7 * DAY + 3 * DAY).weeks).toBe(5)
    expect(goalForWeek(s.settings, weekStart(mon))).toBe(2)
    expect(goalForWeek(s.settings, weekStart(mon + 5 * 7 * DAY))).toBe(3)
    expect(goalForWeek(s.settings, weekStart(t))).toBe(5)
    // Saved, loaded and replayed, the same.
    const back = rebuildDerivedState(wire(s))
    expect(Object.keys(back.achievements)).toEqual(expect.arrayContaining(['streak-2', 'streak-4']))
  })

  it('two tabs that each changed the goal keep both changes, in either merge order', () => {
    const mon = new Date(2026, 5, 1, 18).getTime()
    at(mon)
    const base = wire({ ...initialState(), onboarded: true })
    vi.setSystemTime(mon + 7 * DAY)
    const A = reducer(base, { type: 'SET_SETTINGS', patch: { weeklyGoal: 4 } })
    vi.setSystemTime(mon + 14 * DAY)
    const B = reducer(base, { type: 'SET_SETTINGS', patch: { weeklyGoal: 5 } })
    const ab = mergeExternalState(A, wire(B))
    const ba = mergeExternalState(B, wire(A))
    expect(ab.settings.weeklyGoal).toBe(5)
    expect(ab.settings.goalHistory).toEqual(ba.settings.goalHistory)
    expect(ab.settings.goalHistory?.map((c) => c.goal)).toEqual([3, 4, 5])
    expect(mergeExternalState(ab, wire(ba))).toBe(ab)
  })

  it('an older save’s single remembered goal becomes the start of the history', () => {
    const raw = plain({ ...initialState(), onboarded: true })
    raw.settings.weeklyGoal = 4
    raw.settings.goalBefore = { goal: 2, until: 1_780_000_000_000 }
    expect(normalizeState(raw).settings.goalHistory).toEqual([
      { goal: 2, at: 0 },
      { goal: 4, at: 1_780_000_000_000 },
    ])
  })
})

describe('the weekly goal is counted one way: training days, skill and gym alike', () => {
  it('two skill days and a gym day meet a goal of three for Home, the streak and the badges', () => {
    const mon = new Date(2026, 5, 1, 17).getTime()
    at(mon)
    let s: AppState = { ...initialState(), onboarded: true, settings: { ...initialState().settings, weeklyGoal: 3 }, gym: defaultGym(['floor'], 'kg', mon) }
    for (let w = 0; w < 4; w++) {
      for (const d of [0, 2]) {
        const t = mon + (w * 7 + d) * DAY
        vi.setSystemTime(t)
        s = reducer(s, { type: 'SAVE_SESSION', session: session(`w${w}d${d}`, t, [holdSet('planche-lean', 10, t + 10)]) })
      }
      const t = mon + (w * 7 + 4) * DAY
      vi.setSystemTime(t)
      s = reducer(s, {
        type: 'GYM',
        op: { op: 'saveSession', session: { id: `gw${w}`, locationId: 'home', startedAt: t, endedAt: t + HOUR, name: 'Legs', exercises: [{ exerciseId: 'goblet-squat', sets: [{ reps: 8, kg: 24, at: t }] }] } },
      })
    }
    const end = mon + (3 * 7 + 6) * DAY
    expect(trainingWeek(s, end).days).toBe(3)
    expect(weekStreak(s, end)).toEqual({ weeks: 4, currentMet: true })
    expect(s.achievements['streak-2']).toBeDefined()
    // A skill session and a gym session on one day are one training day, everywhere.
    const sameDay = reducer(s, { type: 'GYM', op: { op: 'saveSession', session: { id: 'extra', locationId: 'home', startedAt: mon + 3 * 7 * DAY + HOUR, endedAt: mon + 3 * 7 * DAY + 2 * HOUR, name: 'Push', exercises: [{ exerciseId: 'goblet-squat', sets: [{ reps: 8, kg: 24, at: mon + 3 * 7 * DAY + HOUR }] }] } } })
    expect(trainingWeek(sameDay, end).days).toBe(3)
  })
})

describe('small store contracts', () => {
  it('a height logged in one tab reaches the other', () => {
    at(new Date(2026, 9, 5, 18).getTime())
    const base = wire(reducer({ ...initialState(), onboarded: true }, { type: 'SET_PROFILE', patch: { heightCm: 172 } }))
    vi.setSystemTime(Date.now() + HOUR)
    const A = reducer(base, { type: 'LOG_MEASUREMENT', heightCm: 175 })
    vi.setSystemTime(Date.now() + HOUR)
    const B = reducer(base, { type: 'SET_SETTINGS', patch: { restMainSec: 170 } })
    expect(mergeExternalState(B, wire(A)).profile.heightCm).toBe(175)
    expect(mergeExternalState(A, wire(B)).profile.heightCm).toBe(175)
  })

  it('sets saved without a time get one each, the same on every load, so an edit finds one set', () => {
    const t = new Date(2026, 9, 5, 18).getTime()
    const raw = plain({ ...initialState(), onboarded: true })
    raw.sessions = [
      {
        ...session('old-1', t),
        sets: [{ ...holdSet('tuck-planche', 4, t) }, ...[5, 6, 7].map((value) => ({ exerciseId: 'tuck-planche', kind: 'hold', value, target: 10, section: 'main' }))],
      },
    ]
    const s = normalizeState(raw)
    const ats = s.sessions[0].sets.map((x) => x.at)
    expect(new Set(ats).size).toBe(4)
    expect(normalizeState(raw).sessions[0].sets.map((x) => x.at)).toEqual(ats)
    expect(wire(s).sessions[0].sets.map((x) => x.at)).toEqual(ats)
    const edited = reducer(s, { type: 'UPDATE_SET_TIMING', sessionId: 'old-1', setAt: ats[2], value: 9, timing: { method: 'edited' } })
    expect(edited.sessions[0].sets.map((x) => x.value)).toEqual([4, 5, 9, 7])
  })

  it('a session saved twice is one session, and a deleted one is not brought back', () => {
    at(new Date(2026, 9, 5, 18).getTime())
    const t = Date.now()
    const x = session('dup-1', t)
    const once = reducer({ ...initialState(), onboarded: true }, { type: 'SAVE_SESSION', session: x })
    expect(reducer(once, { type: 'SAVE_SESSION', session: x })).toBe(once)
    const longer = reducer(once, { type: 'SAVE_SESSION', session: { ...x, sets: [...x.sets, holdSet('tuck-planche', 7, t + 2000)], savedAt: x.savedAt! + 1 } })
    expect(longer.sessions.filter((s) => s.id === 'dup-1')).toHaveLength(1)
    expect(longer.sessions.find((s) => s.id === 'dup-1')!.sets).toHaveLength(2)
    const deleted = reducer(once, { type: 'DELETE_SESSION', id: 'dup-1' })
    const zombie = reducer(deleted, { type: 'SAVE_SESSION', session: x })
    expect(zombie.sessions.some((s) => s.id === 'dup-1')).toBe(false)
  })

  it('gym records the loader cannot keep count as losses, so the original is kept aside', () => {
    const t = new Date(2026, 9, 5, 18).getTime()
    const s: AppState = { ...initialState(), onboarded: true, gym: defaultGym(['floor'], 'kg', t) }
    const squat = { exerciseId: 'goblet-squat', sets: [{ reps: 8, kg: 24, at: t }] }
    s.gym!.sessions = [{ id: 'g1', locationId: 'home', startedAt: t, endedAt: t + 1000, name: 'Legs', exercises: [{ exerciseId: 'renamed-or-removed-lift', sets: [{ reps: 5, kg: 100, at: t }] }, squat] }]
    const { report } = normalizeStateWithReport(plain(s), t)
    expect(report.gymLosses.length).toBeGreaterThan(0)
    expect(reportHasLosses(report)).toBe(true)
    s.gym!.sessions = [{ ...s.gym!.sessions[0], exercises: [squat] }]
    expect(normalizeStateWithReport(plain(s), t).report.gymLosses).toEqual([])
    // A save this version wrote reads back with nothing to report, so a load
    // never quarantines over an earlier kept copy for no reason.
    const sample = normalizeState(plain(buildSampleState()))
    expect(normalizeStateWithReport(plain(sample), t).report).toMatchObject({ gymLosses: [], droppedSets: [], repairedSets: 0 })
  })

  it('reset and import leave no unfinished work from the old data behind', async () => {
    for (const run of [() => eraseRecoveryCopies(), async () => forgetUnfinishedWork()]) {
      for (const key of ['planchelab.draft', 'planchelab.gymDraft', 'planchelab.nextBlock']) localStorage.setItem(key, '{}')
      await run()
      for (const key of ['planchelab.draft', 'planchelab.gymDraft', 'planchelab.nextBlock']) expect(localStorage.getItem(key)).toBeNull()
    }
  })

  it('the import dialog counts the gym side it would replace', () => {
    const t = new Date(2026, 9, 5, 18).getTime()
    const s: AppState = { ...initialState(), gym: defaultGym(['floor'], 'kg', t) }
    s.gym!.sessions = [{ id: 'g1', locationId: 'home', startedAt: t, endedAt: t + 1, name: 'Legs', exercises: [] }]
    const here = dataOnDevice(s)
    expect(here).toMatchObject({ sessions: 0, gymSessions: 1, places: s.gym!.locations.length })
  })
})

describe('round trips and convergence with the new fields', () => {
  it('state -> export -> import -> state is identical', () => {
    const mon = new Date(2026, 5, 1, 18).getTime()
    at(mon)
    let s = reducer(initialState(), onboarding)
    s = { ...s, gym: defaultGym(['floor'], 'kg', mon) }
    vi.setSystemTime(mon + DAY)
    s = reducer(s, { type: 'SAVE_SESSION', session: session('a', mon + DAY) })
    s = reducer(s, { type: 'SET_SETTINGS', patch: { weeklyGoal: 4 } })
    vi.setSystemTime(mon + 9 * DAY)
    s = reducer(s, { type: 'SET_SETTINGS', patch: { weeklyGoal: 2 } })
    s = reducer(s, { type: 'LOG_MEASUREMENT', heightCm: 170 })
    const loaded = rebuildDerivedState(wire(s))
    const raw = plain(loaded)
    validateImport(raw)
    const staged = rebuildDerivedState(normalizeStateWithReport(raw).state)
    const imported = reducer(loaded, { type: 'IMPORT_REPLACE', state: staged, expectedRev: loaded.rev ?? 0 })
    const strip = (x: AppState) => {
      const { epoch: _e, retiredEpochs: _r, rev: _v, ...rest } = plain(x)
      return rest
    }
    expect(strip(imported)).toEqual(strip(loaded))
  })
})
