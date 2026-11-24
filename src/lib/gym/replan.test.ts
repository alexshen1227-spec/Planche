import { expect, it } from 'vitest'
import { sessionFromDraft, type DraftItem, type GymDraft } from './draft'
import { canReplanGym, GYM_PLAN_REVISION, outdatedGymPlan, replanGymDraft } from './replan'

const now = +new Date(2026, 10, 24, 12)
const item = (exerciseId: string): DraftItem => ({ exerciseId, plan: { range: [6, 12], targetRpe: 7 }, unit: 'kg', restSec: 90,
  sets: [{ load: 10, reps: 6, done: false }, { load: 10, reps: 6, done: false }] })
const draft = (items: DraftItem[]): GymDraft => ({ id: 'open', name: 'Pull', startedAt: now - 60_000, locationId: 'home', items })

it('respects earlier manual edits, venue boundaries and saved continuations when refreshing', () => {
  const old = draft([item('db-row')])
  expect(outdatedGymPlan(old)).toBe(true)
  for (const changed of [{ planRevision: GYM_PLAN_REVISION }, { notes: 'Slow tempo' }, { edited: true as const }, { resumeFrom: now }, { name: 'Gym session' }]) {
    expect(outdatedGymPlan({ ...old, ...changed })).toBe(false)
  }
  old.items[0].sets[0].loadEdited = true
  expect(outdatedGymPlan(old)).toBe(false)
  expect(canReplanGym(old, 'gym', now)).toBe(false)
  expect(canReplanGym(old, 'home', now + 86400000)).toBe(false)
  expect(canReplanGym({ ...old, resumeFrom: now }, 'home', now)).toBe(false)
})

it('counts old sets against the new dose and keeps the row, its actuals, manual back-off, notes and rest', () => {
  const fly = item('db-fly'), row = item('db-row')
  const actual = { load: 24, reps: 10, rpe: 7, at: now - 5000, done: true }
  row.sets = [actual, { load: 18, reps: 8, loadEdited: true, repsEdited: true, done: false }]
  fly.sets[0] = { load: 6, reps: 10, at: now - 50_000, done: true }
  const old = { ...draft([fly, row]), notes: 'Lunch break' }
  const fresh = { ...draft([item('db-row'), item('hammer-curl')]), id: 'new', planRevision: GYM_PLAN_REVISION }
  const revised = replanGymDraft(old, fresh, now)
  expect(revised).toMatchObject({ id: old.id, notes: old.notes, startedAt: old.startedAt, rest: { until: actual.at + 90_000 } })
  expect(revised.items.map((it) => [it.exerciseId, it.sets.length])).toEqual([['db-fly', 1], ['db-row', 2], ['hammer-curl', 1]])
  expect(revised.items[1].sets).toEqual(row.sets)
  expect(old.items[0].sets).toHaveLength(2)
  const otherUnit = { ...fresh, items: [{ ...item('db-row'), unit: 'lb' as const }, item('hammer-curl')] }
  expect(replanGymDraft(old, otherUnit, now).items.find((it) => it.exerciseId === 'db-row')).toMatchObject({ unit: 'kg', held: true, sets: [actual] })
  expect(replanGymDraft(old, otherUnit, now).items.find((it) => it.exerciseId === 'db-row' && !it.held)).toMatchObject({ unit: 'lb', sets: [{ done: false }] })
  const changed = { ...fresh, items: [{ ...item('db-row'), plan: { range: [8, 10] as [number, number], targetRpe: 8 },
    sets: [{ reps: 8, done: false }, { reps: 8, done: false }] }, item('hammer-curl')] }
  const saved = sessionFromDraft(replanGymDraft(old, changed, now), now)
  expect(saved.exercises.find((it) => it.exerciseId === 'db-row')).toMatchObject({ repRange: [6, 12], targetRpe: 7, sets: [{ reps: 10, kg: 24, at: actual.at }] })
  expect(saved.remaining?.items.find((it) => it.exerciseId === 'db-row')).toMatchObject({ repRange: [8, 10], targetRpe: 8, sets: [{ reps: 8 }] })
})
