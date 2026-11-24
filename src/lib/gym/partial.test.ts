import { expect, it } from 'vitest'
import { adaptOpenDraft, resumePartial, sessionFromDraft, type GymDraft } from './draft'
import { defaultGym, mergeSession, reduceGym, sanitizeGymReport } from './state'

const start = new Date(2026, 10, 16, 10).getTime()
const draft: GymDraft = {
  id: 'split', startedAt: start, locationId: 'home', name: 'Full body', notes: 'First block',
  items: [
    { exerciseId: 'split-squat', plan: { range: [6, 10], targetRpe: 7 }, restSec: 90, unit: 'lb',
      sets: [{ reps: 8, at: start + 100, done: true, rpe: 7 }, { reps: 9, load: 5.25, done: false }] },
    { exerciseId: 'db-lateral-raise', plan: { range: [12, 15], targetRpe: 8 }, restSec: 60, unit: 'kg',
      sets: [{ reps: 12, load: 5, done: false }] },
  ],
}

it('ends a saved partial after a new joint report before the next set, preserving corrections and a newer continuation', () => {
  const original = sessionFromDraft(draft, start + 500)
  const gym = reduceGym(defaultGym([], 'kg'), { op: 'saveSession', session: original }, start + 501)!
  const end = { op: 'endPartial' as const, id: original.id, resumeFrom: original.endedAt }
  const stopped = reduceGym(gym, end, start + 1000)!
  expect(stopped.sessions[0]).toMatchObject({ exercises: original.exercises, endedAt: original.endedAt, completion: 'partial' })
  expect(stopped.sessions[0].remaining).toBeUndefined()
  expect(reduceGym(stopped, end)).toBe(stopped)
  for (const [a, b] of [[original, stopped.sessions[0]], [stopped.sessions[0], original]]) expect(mergeSession(a, b).remaining).toBeUndefined()
  expect(reduceGym(gym, { ...end, resumeFrom: start - 1 })).toBe(gym)
})

it('keeps a sore elbow off the remaining presses while preserving the squat already logged', () => {
  const item = { ...draft.items[1], exerciseId: 'incline-push-up' }
  const home = { ...draft, items: [{ ...draft.items[0], exerciseId: 'bodyweight-squat' }, item] }
  const partial = sessionFromDraft(home, start + 1000)
  const again = resumePartial(partial, ['elbows'], undefined, start + 2000)!
  expect(again.items.map((i) => i.exerciseId)).toEqual(['bodyweight-squat'])
  expect(again.deferred?.map((i) => i.exerciseId)).toEqual(['incline-push-up'])
  const open = adaptOpenDraft(home, ['elbows'], true)
  expect(open.items.map((i) => i.exerciseId)).toEqual(['bodyweight-squat'])
  expect(open.items[0].sets[0]).toEqual(home.items[0].sets[0])
})

it('keeps unfinished prescription outside volume, carries a late correction, and rejects duplicate or deleted continuations', () => {
  const first = sessionFromDraft(draft, start + 1000)
  const base = defaultGym(['floor'], 'kg', start)
  const logged = reduceGym(base, { op: 'saveSession', session: first }, first.endedAt)!
  const { gym, losses } = sanitizeGymReport(JSON.parse(JSON.stringify(logged)))
  expect(losses).toEqual([])
  const open = resumePartial(gym!.sessions[0], ['shoulders'], undefined, start + 3000)!
  expect(open.items.map((it) => it.exerciseId)).toEqual(['split-squat'])
  expect(open.items[0]).toMatchObject({ unit: 'lb', sets: [{ reps: 9, load: 5.25, done: false }] })
  open.items[0].sets[0] = { ...open.items[0].sets[0], done: true, at: start + 4000, rpe: 8 }
  const segment = sessionFromDraft(open, start + 5000)
  expect(segment.remaining?.items.map((it) => it.exerciseId)).toEqual(['db-lateral-raise'])
  const append = { op: 'saveSession' as const, session: segment, resumeFrom: first.endedAt }
  const continued = reduceGym(gym, append, segment.endedAt)!
  expect(continued.sessions).toHaveLength(1)
  expect(continued.sessions[0].exercises[0].sets.map((x) => x.reps)).toEqual([8, 9])
  expect(reduceGym(continued, append)).toBe(continued)
  const corrected = reduceGym(gym, { op: 'correctSet', sessionId: first.id, exerciseIndex: 0, setIndex: 0, reps: 7 }, start + 6000)!.sessions[0]
  for (const [a, b] of [[corrected, continued.sessions[0]], [continued.sessions[0], corrected]]) {
    const merged = mergeSession(a, b)
    expect(merged.exercises[0].sets.map((x) => x.reps)).toEqual([7, 9])
    expect(resumePartial(merged)?.items[0].exerciseId).toBe('db-lateral-raise')
  }
  const deleted = reduceGym(continued, { op: 'deleteSession', id: first.id })!
  expect(reduceGym(deleted, append)).toBe(deleted)
})
