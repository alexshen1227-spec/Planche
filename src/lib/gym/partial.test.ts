import { expect, it } from 'vitest'
import { adaptOpenDraft, resumePartial, sessionFromDraft, type GymDraft } from './draft'
import { defaultGym, mergeSession, reduceGym, sanitizeGymReport } from './state'
import { canPairExercises, restAfterSet, useStraightSets } from './pairedSets'
import { buildGymSession } from './builder'

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

it('restores the fixed-rack rep target and the offered easier movement after an import', () => {
  const open = structuredClone(draft)
  open.items[0].suggestion = { kind: 'at-top-weight', kg: 2, reps: [6, 10], targetRpe: 7, targetReps: 11, why: 'Use the same weight for 11.' }
  open.items[1].suggestion = { kind: 'at-minimum-weight', reps: [12, 15], targetRpe: 8, chooseAlternative: true,
    easierId: 'bent-arm-db-lateral-raise', why: 'Choose an easier movement.' }
  const saved = sessionFromDraft(open, start + 2000)
  const { gym, losses } = sanitizeGymReport({ ...defaultGym(['floor']), sessions: [saved] })
  expect(losses).toEqual([])
  const resumed = resumePartial(gym!.sessions[0])!
  expect(resumed.items[0].suggestion).toMatchObject({ targetReps: 11, kind: 'at-top-weight' })
  expect(resumed.items[1].suggestion).toMatchObject({ chooseAlternative: true, easierId: 'bent-arm-db-lateral-raise' })
})

it('restores the original time target and reps needed for a load increase after an interruption', () => {
  const open = structuredClone(draft)
  open.items[0] = { ...open.items[0], exerciseId: 'suitcase-carry', plan: { range: [20, 30], measure: 'seconds', targetRpe: 7 },
    suggestion: { kind: 'repeat', reps: [20, 30], targetRpe: 7, targetReps: 25, why: 'Walk for 25 seconds on each side.' },
    sets: [{ reps: 23, load: 10, done: true }, { reps: 24, load: 10, done: false }] }
  open.items[1].suggestion = { kind: 'repeat', reps: [12, 15], targetRpe: 8, repsToMoveUp: 17, why: 'Repeat the same load for 17.' }
  const saved = sessionFromDraft(open, start + 2_000)
  const { gym } = sanitizeGymReport({ ...defaultGym(['floor']), sessions: [saved] })
  const [carry, raise] = resumePartial(gym!.sessions[0])!.items
  expect(carry.suggestion).toMatchObject({ targetReps: 25, why: open.items[0].suggestion!.why })
  expect(carry.sets[0].reps).toBe(24)
  expect(raise.suggestion).toMatchObject({ repsToMoveUp: 17, why: open.items[1].suggestion.why })
})

it('budgets one alternating pair at the same station and carries a timed recovery through a saved partial', () => {
  const gym = defaultGym(['floor', 'pullup-bar'], 'kg', start)
  gym.locations[0].equipment.push('dumbbells', 'incline-bench')
  const input = { location: gym.locations[0], minutes: 22, warmUpMin: 2, focus: 'upper' as const, sessions: [],
    priority: ['calves', 'side-delts'] as ('calves' | 'side-delts')[], athletePriority: ['calves', 'side-delts'] as const,
    goals: { strength: 2, physique: 5, skills: 5, endurance: 0, power: 0 }, now: start }
  const plan = buildGymSession(input), lifts = plan.items.filter((it) => it.pairedWith)
  expect(lifts).toHaveLength(2)
  expect(plan.items.indexOf(lifts[1])).toBe(plan.items.indexOf(lifts[0]) + 1)
  expect(plan.estimatedMin).toBeLessThanOrEqual(22)
  expect(buildGymSession({ ...input, avoidJoints: ['wrists'] }).items.some((it) => it.pairedWith)).toBe(false)
  expect(buildGymSession({ ...input, volumeFactor: 0.6 }).items.some((it) => it.pairedWith)).toBe(false)
  expect(canPairExercises('standing-calf-raise', 'machine-lateral-raise')).toBe(false)
  expect(canPairExercises('db-lateral-raise', 'goblet-squat')).toBe(false)
  const items = lifts.map((it, i) => ({ ...it, unit: 'kg' as const, sets: [
    { reps: 12, done: i === 0, at: i === 0 ? start : undefined }, { reps: 12, done: false },
  ] }))
  const partial = sessionFromDraft({ ...draft, items }, start + 2000)
  const saved = sanitizeGymReport({ ...gym, sessions: [partial] }).gym!.sessions[0]
  const open = resumePartial(saved, [], gym.locations[0], start + 4000)!
  expect(open.items.map((it) => it.pairedWith)).toEqual(lifts.map((it) => it.pairedWith))
  open.items[1].sets[0] = { ...open.items[1].sets[0], done: true, at: start + 10_000 }
  open.rest = restAfterSet(open, 1, 0, start + 10_000, saved)
  expect(open.rest).toEqual({ nextExerciseId: lifts[0].exerciseId, until: start + 75_000, total: 65 })
  useStraightSets(open, 1, start + 11_000)
  expect(open.rest?.until).toBe(start + 85_000)
  expect(open.items.every((it) => !it.pairedWith)).toBe(true)
})

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
