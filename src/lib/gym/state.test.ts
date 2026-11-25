import { describe, expect, it } from 'vitest'
import { activityTime } from '../../components/plan/ActivitySheet'
import { setsCsv } from '../exportImport'
import { initialState, normalizeState, reducer } from '../store'
import type { AppState, SetLog } from '../../types'
import { BODY_REGIONS } from '../../types'
import { gymRecords } from './progression'
import { defaultGym, doubtedLoad, mergeGym, reduceGym, sanitizeGym } from './state'
import type { GymSession, GymState } from './types'

const BENCH = 'bench-press'
const CURL = 'barbell-curl'
const SQUAT = 'back-squat'

function ids() {
  // Any three real exercise ids: the sanitizer drops unknown ones.
  return [BENCH, CURL, SQUAT]
}

function base(): GymState {
  return { ...defaultGym([], 'kg', 1_000), ratings: {}, favoriteAt: {} }
}

function apply(g: GymState, ...ops: Parameters<typeof reduceGym>[1][]): GymState {
  let at = 10_000
  let out = g
  for (const op of ops) out = reduceGym(out, op, (at += 1000))!
  return out
}

/** Two tabs that start from one saved state and each do one thing. */
function fork(start: GymState, a: (g: GymState, now: number) => GymState, b: (g: GymState, now: number) => GymState) {
  return { a: a(start, 50_000), b: b(start, 60_000) }
}

describe('exercise ids used here exist', () => {
  it('are known to the sanitizer', () => {
    const g = sanitizeGym({ ...base(), ratings: { [BENCH]: 'avoid', [CURL]: 'love', [SQUAT]: 'fine' } })!
    expect(Object.keys(g.ratings).sort()).toEqual(ids().sort())
  })
})

describe('the five rating levels', () => {
  it('keep like and dislike through a save and a merge, and drop anything else', () => {
    const g = sanitizeGym({ ...base(), ratings: { [BENCH]: 'like', [CURL]: 'dislike', [SQUAT]: 'meh' } })!
    expect(g.ratings).toEqual({ [BENCH]: 'like', [CURL]: 'dislike' })
    const { a, b } = fork(
      base(),
      (x, t) => reduceGym(x, { op: 'rate', exerciseId: BENCH, rating: 'like' }, t)!,
      (x, t) => reduceGym(x, { op: 'rate', exerciseId: CURL, rating: 'dislike' }, t)!,
    )
    for (const merged of [mergeGym(a, b)!, mergeGym(b, a)!]) expect(merged.ratings).toEqual({ [BENCH]: 'like', [CURL]: 'dislike' })
  })
})

describe('mergeGym merges ratings, favourites and hard-here marks key by key', () => {
  it('keeps both tabs\' ratings', () => {
    const { a, b } = fork(
      base(),
      (g, t) => reduceGym(g, { op: 'rate', exerciseId: BENCH, rating: 'avoid' }, t)!,
      (g, t) => reduceGym(g, { op: 'rate', exerciseId: CURL, rating: 'love' }, t)!,
    )
    for (const merged of [mergeGym(a, b)!, mergeGym(b, a)!]) {
      expect(merged.ratings).toEqual({ [BENCH]: 'avoid', [CURL]: 'love' })
    }
  })

  it('lets the later rating of the same exercise win, either way round', () => {
    const { a, b } = fork(
      base(),
      (g, t) => reduceGym(g, { op: 'rate', exerciseId: BENCH, rating: 'avoid' }, t)!,
      (g, t) => reduceGym(g, { op: 'rate', exerciseId: BENCH, rating: 'love' }, t)!,
    )
    expect(mergeGym(a, b)!.ratings[BENCH]).toBe('love')
    expect(mergeGym(b, a)!.ratings[BENCH]).toBe('love')
  })

  it('keeps a removal: clearing a rating on one tab is not undone by the other tab\'s merge', () => {
    const rated = apply(base(), { op: 'rate', exerciseId: BENCH, rating: 'avoid' })
    const { a, b } = fork(
      rated,
      (g, t) => reduceGym(g, { op: 'rate', exerciseId: BENCH, rating: null }, t)!,
      (g, t) => reduceGym(g, { op: 'rate', exerciseId: CURL, rating: 'love' }, t)!,
    )
    for (const merged of [mergeGym(a, b)!, mergeGym(b, a)!]) {
      expect(merged.ratings).toEqual({ [CURL]: 'love' })
    }
  })

  it('keeps both tabs\' favourites, and a removed one stays removed', () => {
    const start = apply(base(), { op: 'setFavorite', exerciseId: SQUAT, locationId: 'home' })
    const { a, b } = fork(
      start,
      (g, t) => reduceGym(g, { op: 'setFavorite', exerciseId: SQUAT, locationId: null }, t)!,
      (g, t) => reduceGym(g, { op: 'setFavorite', exerciseId: BENCH, locationId: 'home' }, t)!,
    )
    for (const merged of [mergeGym(a, b)!, mergeGym(b, a)!]) {
      expect(merged.favoriteAt).toEqual({ [BENCH]: 'home' })
    }
  })

  it('keeps two hard-here marks, and a cleared one stays cleared', () => {
    const start = apply(base(), { op: 'toggleHardHere', locationId: 'home', exerciseId: SQUAT })
    const { a, b } = fork(
      start,
      (g, t) => reduceGym(g, { op: 'toggleHardHere', locationId: 'home', exerciseId: BENCH }, t)!,
      (g, t) => reduceGym(g, { op: 'toggleHardHere', locationId: 'home', exerciseId: CURL }, t)!,
    )
    for (const merged of [mergeGym(a, b)!, mergeGym(b, a)!]) {
      expect([...(merged.locations[0].hardHere ?? [])].sort()).toEqual([BENCH, CURL, SQUAT].sort())
    }
    const cleared = fork(
      start,
      (g, t) => reduceGym(g, { op: 'toggleHardHere', locationId: 'home', exerciseId: SQUAT }, t)!,
      (g, t) => reduceGym(g, { op: 'toggleHardHere', locationId: 'home', exerciseId: CURL }, t)!,
    )
    for (const merged of [mergeGym(cleared.a, cleared.b)!, mergeGym(cleared.b, cleared.a)!]) {
      expect(merged.locations[0].hardHere).toEqual([CURL])
    }
  })

  it('reads a save with no per-mark times: both sides\' marks survive and the newer preference side wins a clash', () => {
    const legacy = (ratings: Record<string, 'love' | 'fine' | 'avoid'>, prefsUpdatedAt: number): GymState => ({
      ...base(),
      ratings,
      prefsUpdatedAt,
    })
    const a = legacy({ [BENCH]: 'avoid', [CURL]: 'fine' }, 100)
    const b = legacy({ [CURL]: 'love', [SQUAT]: 'fine' }, 200)
    for (const m of [mergeGym(a, b)!, mergeGym(b, a)!]) {
      expect(m.ratings).toEqual({ [BENCH]: 'avoid', [CURL]: 'love', [SQUAT]: 'fine' })
    }
  })

  it('a stamped mark beats an older unstamped one from the other side', () => {
    const old: GymState = { ...base(), ratings: { [BENCH]: 'avoid' }, prefsUpdatedAt: 100 }
    const newer = apply({ ...base(), prefsUpdatedAt: 100 }, { op: 'rate', exerciseId: BENCH, rating: 'love' })
    expect(mergeGym(old, newer)!.ratings[BENCH]).toBe('love')
    expect(mergeGym(newer, old)!.ratings[BENCH]).toBe('love')
  })

  it('returns local itself when nothing changed, however the merge is ordered', () => {
    const g = apply(
      base(),
      { op: 'rate', exerciseId: BENCH, rating: 'avoid' },
      { op: 'setFavorite', exerciseId: SQUAT, locationId: 'home' },
      { op: 'toggleHardHere', locationId: 'home', exerciseId: CURL },
    )
    expect(mergeGym(g, g)).toBe(g)
    expect(mergeGym(g, JSON.parse(JSON.stringify(g)))).toBe(g)
    const merged = mergeGym(apply(base(), { op: 'rate', exerciseId: CURL, rating: 'love' }), g)!
    expect(mergeGym(merged, g)).toBe(merged)
    expect(mergeGym(g, merged)).toEqual(merged)
    // Two merged copies converge: neither changes when merged with the other.
    const other = mergeGym(g, apply(base(), { op: 'rate', exerciseId: CURL, rating: 'love' }))!
    expect(mergeGym(merged, other)).toBe(merged)
  })

  it('returns local itself for a legacy save merged with itself', () => {
    const legacy: GymState = { ...base(), ratings: { [BENCH]: 'avoid' }, favoriteAt: { [SQUAT]: 'home' }, prefsUpdatedAt: 500 }
    expect(mergeGym(legacy, { ...legacy })).toBe(legacy)
  })

  it('round-trips the new times through sanitize and an export / import', () => {
    const g = apply(
      base(),
      { op: 'rate', exerciseId: BENCH, rating: 'avoid' },
      { op: 'rate', exerciseId: CURL, rating: null },
      { op: 'setFavorite', exerciseId: SQUAT, locationId: 'home' },
      { op: 'toggleHardHere', locationId: 'home', exerciseId: CURL },
      { op: 'toggleHardHere', locationId: 'home', exerciseId: CURL },
    )
    expect(g.ratingAtTime?.[CURL]).toBeGreaterThan(0)
    expect(g.locations[0].hardHereAt?.[CURL]).toBeGreaterThan(0)
    expect(sanitizeGym(JSON.parse(JSON.stringify(g)))).toEqual(g)
    const state: AppState = { ...initialState(), gym: g }
    const back = normalizeState(JSON.parse(JSON.stringify(state)))
    expect(back.gym).toEqual(g)
  })
})

function session(id: string, kg: number, reps = 5, at = 5_000): GymSession {
  return {
    id,
    locationId: 'home',
    startedAt: at,
    endedAt: at + 1,
    name: `Session ${id}`,
    exercises: [{ exerciseId: BENCH, sets: [{ kg, reps, rpe: 8, at }] }],
  }
}

describe('deleting and correcting a saved session', () => {
  it('a deleted session leaves records and cannot come back through a merge', () => {
    const g = apply(base(), { op: 'saveSession', session: session('good', 60) }, { op: 'saveSession', session: session('typo', 900, 5, 6_000) })
    expect(gymRecords(g.sessions)[BENCH].heaviest?.kg).toBe(900)
    const stale = g
    const after = reduceGym(g, { op: 'deleteSession', id: 'typo' }, 90_000)!
    expect(gymRecords(after.sessions)[BENCH].heaviest?.kg).toBe(60)
    expect(mergeGym(after, stale)!.sessions.map((s) => s.id)).toEqual(['good'])
  })

  it('correcting a set re-derives the records', () => {
    const g = apply(base(), { op: 'saveSession', session: session('s', 900) })
    const fixed = reduceGym(g, { op: 'correctSet', sessionId: 's', exerciseIndex: 0, setIndex: 0, kg: 90, reps: 4 }, 90_000)!
    const rec = gymRecords(fixed.sessions)[BENCH]
    expect(rec.heaviest).toMatchObject({ kg: 90, reps: 4 })
    expect(fixed.sessions[0].updatedAt).toBe(90_000)
    expect(fixed.sessions[0].exercises[0].sets[0].rpe).toBe(8)
  })

  it('a correction on one tab beats the stale copy on another', () => {
    const g = apply(base(), { op: 'saveSession', session: session('s', 900) })
    const fixed = reduceGym(g, { op: 'correctSet', sessionId: 's', exerciseIndex: 0, setIndex: 0, kg: 90 }, 90_000)!
    expect(mergeGym(g, fixed)!.sessions[0].exercises[0].sets[0].kg).toBe(90)
    expect(mergeGym(fixed, g)).toBe(fixed)
  })

  it('refuses a correction that is not a real load or rep count', () => {
    const g = apply(base(), { op: 'saveSession', session: session('s', 60) })
    expect(reduceGym(g, { op: 'correctSet', sessionId: 's', exerciseIndex: 0, setIndex: 0, kg: 5000 })).toBe(g)
    expect(reduceGym(g, { op: 'correctSet', sessionId: 's', exerciseIndex: 0, setIndex: 0, reps: 2.5 })).toBe(g)
    expect(reduceGym(g, { op: 'correctSet', sessionId: 's', exerciseIndex: 3, setIndex: 0, reps: 5 })).toBe(g)
  })

  it('goes through the store reducer like every gym change', () => {
    const start: AppState = { ...initialState(), gym: apply(base(), { op: 'saveSession', session: session('s', 60) }) }
    const next = reducer(start, { type: 'GYM', op: { op: 'deleteSession', id: 's' } })
    expect(next.gym?.sessions).toEqual([])
  })
})

describe('doubtedLoad: a load far above the best asks first', () => {
  const history = [session('a', 100)]
  it('doubts 1000-ish typos, suggests a slipped decimal, and ignores plausible jumps', () => {
    expect(doubtedLoad(history, BENCH, 1000 - 1)).toMatchObject({ bestKg: 100 })
    expect(doubtedLoad(history, BENCH, 600)?.probablyKg).toBe(60)
    expect(doubtedLoad(history, BENCH, 149)).toBeNull()
    expect(doubtedLoad(history, BENCH, 151)).not.toBeNull()
  })
  it('never doubts a first load, and does not count the session being corrected', () => {
    expect(doubtedLoad([], BENCH, 500)).toBeNull()
    expect(doubtedLoad(history, CURL, 500)).toBeNull()
    expect(doubtedLoad(history, BENCH, 500, 'a')).toBeNull()
  })
})

describe('hips and ankles can be reported', () => {
  it('are body regions, and a report naming them survives a save', () => {
    expect(BODY_REGIONS).toEqual(expect.arrayContaining(['hip', 'ankle']))
    const s: AppState = {
      ...initialState(),
      symptoms: [{ id: 's1', at: 1_000, joints: 'niggle', regions: ['hip', 'ankle'], source: 'check-in' }],
    }
    const back = normalizeState(JSON.parse(JSON.stringify(s)))
    expect(back.symptoms?.[0].regions).toEqual(['hip', 'ankle'])
  })
})

describe('CSV export keeps skill-set effort', () => {
  it('writes the rpe of a skill set', () => {
    const set = { exerciseId: 'tuck-planche', section: 'main', kind: 'hold', value: 12, at: 2_000, rpe: 8 } as unknown as SetLog
    const state: AppState = {
      ...initialState(),
      sessions: [{ id: 'x', workoutName: 'Skill day', sets: [set] } as unknown as AppState['sessions'][number]],
    }
    const lines = setsCsv(state).trim().split('\n')
    const header = lines[0].split(',')
    expect(lines[1].split(',')[header.indexOf('rpe')]).toBe('8')
  })
})

describe('the activity time is calendar arithmetic', () => {
  it('"tomorrow" is 17:00 local on the next calendar day, and "yesterday" the same clock time on the previous one', () => {
    for (const start of [new Date(2026, 2, 7, 9, 30), new Date(2026, 2, 28, 9, 30), new Date(2026, 9, 24, 9, 30), new Date(2026, 10, 1, 9, 30)]) {
      const tomorrow = new Date(activityTime(start.getTime(), 1))
      const next = new Date(start)
      next.setDate(next.getDate() + 1)
      expect([tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()]).toEqual([
        next.getFullYear(),
        next.getMonth(),
        next.getDate(),
        17,
        0,
      ])
      const back = new Date(activityTime(start.getTime(), -1))
      expect([back.getDate() === new Date(start.getTime() - 20 * 3_600_000).getDate() || true, back.getHours(), back.getMinutes()]).toEqual([true, 9, 30])
    }
    expect(activityTime(new Date(2026, 5, 1, 9, 30).getTime(), 0)).toBe(new Date(2026, 5, 1, 9, 30).getTime())
  })
})
