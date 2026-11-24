import { describe, expect, it } from 'vitest'
import { GYM_EXERCISES, GYM_EXERCISE_BY_ID } from '../../data/gym/exercises'
import type { GymDraft } from './draft'
import { repPlanFor, suggestLoad } from './progression'
import {
  draftConflictLine,
  draftContents,
  draftJointConflicts,
  effortLabel,
  EXTRA_SESSION_LINE,
  exerciseTitle,
  finishBlocker,
  leftOutLine,
  nextTimeLines,
  noMaxReason,
  openDraftFor,
  resumeLine,
  unfinishedLine,
} from './sessionLines'
import type { GymLocation, GymSession } from './types'

const DAY = 86_400_000
const NOW = new Date(2026, 10, 2, 17).getTime()
const at = (i: number) => NOW - 300 * DAY + i * 3.5 * DAY
const KG: GymLocation = { id: 'gym', name: 'Gym', unit: 'kg', updatedAt: 1, equipment: ['dumbbells', 'leg-curl', 'leg-extension', 'calf-machine', 'cable'] as GymLocation['equipment'] }
const leg = 'leg-curl'
const lift = (id: string, i: number, kg: number, reps: number, rpe: number | undefined, exerciseId = leg, n = 3): GymSession =>
  ({
    id,
    locationId: 'gym',
    startedAt: at(i),
    endedAt: at(i) + 3_600_000,
    name: 'x',
    completion: 'full',
    exercises: [{ exerciseId, repRange: [10, 15], targetRpe: 8, sets: Array.from({ length: n }, (_, k) => ({ kg, reps, at: at(i) + k, ...(rpe !== undefined ? { rpe } : {}) })) }],
  }) as unknown as GymSession

describe('6. next time, for every lift, from the builder own rule', () => {
  it('a lift that earned a step shows the heavier load and the range, as suggestLoad gives it', () => {
    const s = lift('a', 0, 15, 15, 8)
    const [line] = nextTimeLines(s, [s], KG, false)
    const direct = suggestLoad({ exerciseId: leg, location: KG, sessions: [s], plan: { range: [10, 15], targetRpe: 8 }, youth: false, now: s.endedAt + 60_000 })
    expect(direct.kind).toBe('increase')
    expect(line.text).toBe(`Next time: ${direct.kg} kg × 10–15`)
    expect(direct.kg).toBeGreaterThan(15)
    expect(line.why).toBe(direct.why)
  })

  it('a held-back lift says to repeat the load and what every set needs', () => {
    const a = lift('a', 0, 20, 7, 10)
    const b = lift('b', 1, 15, 15, 8)
    const [line] = nextTimeLines(b, [a, b], KG, false)
    expect(line.text).toBe('Repeat 15 kg: every set needs 17 reps')
    expect(line.why).toMatch(/stay here until every set reaches 17/)
  })

  it('a lift past 12 reps says why there is no estimated max, and still gives a next time', () => {
    const s = lift('a', 0, 10, 20, undefined)
    const [line] = nextTimeLines(s, [s], KG, false)
    expect(line.maxNote).toMatch(/past 12 reps/)
    expect(line.text).toMatch(/^(Next time|Repeat)/)
    expect(noMaxReason(s.exercises[0])).toMatch(/past 12 reps/)
  })

  it('no estimated max is explained for unloaded, held, assisted and bodyweight movements', () => {
    const find = (f: (e: (typeof GYM_EXERCISES)[number]) => boolean) => GYM_EXERCISES.find(f)!.id
    const log = (exerciseId: string, kg?: number) => ({ exerciseId, sets: [{ reps: 8, at: 1, ...(kg ? { kg } : {}) }] })
    expect(noMaxReason(log(find((e) => e.load === 'bodyweight' && !e.assisted && e.count !== 'seconds')))).toMatch(/bodyweight/)
    expect(noMaxReason(log(find((e) => e.count === 'seconds')))).toMatch(/hold/)
    expect(noMaxReason(log(find((e) => Boolean(e.assisted)), 20))).toMatch(/help/)
    expect(noMaxReason(log(leg))).toMatch(/no weight was logged/)
    expect(noMaxReason(log(leg, 40))).toBeUndefined()
  })

  it('a movement the catalogue lost is named by its id, with a reason, never nothing', () => {
    const s = lift('a', 0, 20, 8, 8, 'old-lift')
    const [line] = nextTimeLines(s, [s], KG, false)
    expect(line.name).toBe('old-lift (no longer in the catalogue)')
    expect(line.text).toMatch(/no longer in the catalogue/)
  })

  it('a lift trained again later is marked as taken over', () => {
    const a = lift('a', 0, 15, 15, 8)
    const b = lift('b', 1, 17.5, 12, 8)
    expect(nextTimeLines(a, [a, b], KG, false)[0].superseded).toBe(true)
    expect(nextTimeLines(b, [a, b], KG, false)[0].superseded).toBeUndefined()
  })

  it('uses the plan the lift was programmed with, else the usual one', () => {
    const s = lift('a', 0, 15, 15, 8)
    delete (s.exercises[0] as { repRange?: unknown }).repRange
    const [line] = nextTimeLines(s, [s], KG, false)
    const [lo, hi] = repPlanFor(GYM_EXERCISE_BY_ID[leg], 'muscle', false).range
    expect(line.text.endsWith(`× ${lo}–${hi}`)).toBe(true)
  })
})

const elbowLift = GYM_EXERCISES.find((e) => e.stress.includes('elbows'))!
const draft = (ids: string[], done = 0): GymDraft => ({
  id: 'd',
  startedAt: NOW,
  locationId: 'gym',
  name: 'Push',
  items: ids.map((exerciseId) => ({
    exerciseId,
    plan: { range: [8, 12], targetRpe: 8 },
    restSec: 60,
    unit: 'kg',
    sets: [0, 1, 2].map((i) => ({ reps: 8, done: i < done })),
  })),
})

describe('4-5. an open draft is offered fresh and never silently becomes the plan', () => {
  it('while the player runs nothing is offered; once it closes, storage decides', () => {
    const d = draft([leg])
    expect(openDraftFor(d, d)).toBeNull()
    expect(openDraftFor(d, null)).toBe(d)
    expect(openDraftFor(null, null)).toBeNull()
  })

  it('says what the draft holds, and that starting resumes it', () => {
    expect(draftContents(draft([leg, 'old-lift'], 1))).toEqual([
      `${GYM_EXERCISE_BY_ID[leg].name} — 1 of 3 sets done`,
      'old-lift (no longer in the catalogue) — 1 of 3 sets done',
    ])
    expect(resumeLine(draft([leg]))).toMatch(/still open, so it resumes first/)
  })

  it('names the lifts in the draft that load a joint just reported, and only those', () => {
    const d = draft([elbowLift.id, 'old-lift'])
    expect(draftJointConflicts(d, ['elbows']).map((c) => c.exerciseId)).toEqual([elbowLift.id])
    expect(draftJointConflicts(d, [])).toEqual([])
    // Only the reported joint is named, and a lift that loads other joints but not that one is no conflict.
    expect(draftJointConflicts(d, ['elbows'])[0].joints).toEqual(['elbows'])
    const other = GYM_EXERCISES.find((e) => e.stress.length > 0 && !e.stress.includes('elbows'))!
    expect(draftJointConflicts(draft([other.id]), ['elbows'])).toEqual([])
    expect(draftConflictLine(d, ['elbows'])).toContain(elbowLift.name)
    expect(draftConflictLine(draft(['old-lift']), ['elbows'])).toBeNull()
  })
})

describe('8. a pending ask must be answered or closed before finishing', () => {
  it('blocks on the weight question and on the load check, and not otherwise', () => {
    expect(finishBlocker({ needLoad: true, doubt: false })).toMatch(/weight question/)
    expect(finishBlocker({ needLoad: false, doubt: true })).toMatch(/Check the load/)
    expect(finishBlocker({ needLoad: false, doubt: false })).toBeNull()
  })

  it('names each unfinished lift and its remaining sets', () => {
    expect(unfinishedLine(draft([leg], 3))).toBeNull()
    expect(unfinishedLine(draft([leg], 2))).toContain(`1 unfinished set left in your plan. ${GYM_EXERCISE_BY_ID[leg].name} (1)`)
    expect(unfinishedLine(draft([leg, elbowLift.id], 0))).toMatch(/^6 unfinished sets/)
  })
})

describe('9. joint tags: forearm and straight-arm loaded work is tagged at the elbow (INFERENCE)', () => {
  it.each(['wrist-curl', 'db-pullover', 'barbell-pullover'])('%s loads the elbows', (id) => {
    expect(GYM_EXERCISE_BY_ID[id].stress).toContain('elbows')
  })
})

describe('7, 9. lines the screens print', () => {
  it('effort and a retired id', () => {
    expect(effortLabel(8)).toBe('effort 8')
    expect(effortLabel(undefined)).toBeNull()
    expect(exerciseTitle(leg)).toBe(GYM_EXERCISE_BY_ID[leg].name)
  })

  it('left-out copy names the lifts own minutes, not the whole session', () => {
    expect(leftOutLine(['Curl'], 20, 25)).toContain('Left out to fit 20 minutes of lifting (the lifts’ own minutes, after a 25-minute opener): Curl.')
    expect(leftOutLine(['Curl'], 45)).toBe('Left out to fit 45 minutes of lifting: Curl.')
    expect(leftOutLine([], 45)).toBeNull()
  })

  it('an extra session says it is extra', () => {
    expect(EXTRA_SESSION_LINE).toMatch(/already in/)
    expect(EXTRA_SESSION_LINE).toMatch(/extra/)
  })
})
