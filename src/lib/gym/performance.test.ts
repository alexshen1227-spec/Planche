import { expect, it } from 'vitest'
import type { GymSession } from './types'
import { liftSeries } from './performance'
import { estimateOneRepMax } from './progression'

function session(id: string, day: number, exerciseId: string, sets: { reps: number; kg?: number; warmup?: boolean }[], locationId = 'home'): GymSession {
  return { id, locationId, startedAt: day, endedAt: day + 1, name: 'Training', exercises: [{ exerciseId, sets: sets.map((s) => ({ ...s, at: day })) }] }
}

it('charts the logged bodyweight reps or hold time at the same weight', () => {
  const logs = [
    session('a', 1, 'split-squat', [{ reps: 8 }, { reps: 16, warmup: true }, { reps: 4, kg: 7.5 }]),
    session('b', 2, 'split-squat', [{ reps: 11 }, { reps: 7, kg: 7.5 }]),
    session('c', 3, 'short-copenhagen', [{ reps: 12 }]),
    session('d', 4, 'short-copenhagen', [{ reps: 18 }]),
  ]
  const series = liftSeries(logs)
  const values = (id: string, kg: number) => series.find((s) => s.id === id && s.loadKg === kg)?.points.map((p) => p.value)
  expect(values('split-squat', 0)).toEqual([8, 11])
  expect(values('split-squat', 7.5)).toEqual([4, 7])
  expect(series.find((s) => s.id === 'short-copenhagen')?.kind).toBe('seconds')
  expect(values('short-copenhagen', 0)).toEqual([12, 18])
})

it('compares assistance for a repeatable rep count at the same machine, including zero help', () => {
  const logs = [
    session('a', 1, 'assisted-pull-up', [{ reps: 2, kg: 10 }, { reps: 5, kg: 25 }], 'a'),
    session('b', 2, 'assisted-pull-up', [{ reps: 6 }], 'a'),
    session('c', 3, 'assisted-pull-up', [{ reps: 9, kg: 35 }], 'b'),
  ]
  const [local, away] = liftSeries(logs)
  expect(local).toMatchObject({ kind: 'assistance', placeId: 'a', minReps: 5, points: [{ value: 25 }, { value: 0 }] })
  expect(away.placeId).toBe('b')
  expect(estimateOneRepMax({ reps: 10, kg: 5 }, 'copenhagen-plank')).toBeNull()
})
