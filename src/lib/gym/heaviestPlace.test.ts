import { describe, expect, it } from 'vitest'
import { gymRecords, liftTrend } from './progression'
import type { GymSession } from './types'

// Machines differ from gym to gym (round nine): the estimate was keyed by place,
// but the heaviest load was still taken from any gym's machine.
const DAY = 86_400_000
const NOW = new Date(2026, 10, 26, 18).getTime()
let n = 0
function gs(loc: string, daysAgo: number, ex: string, kg: number): GymSession {
  const at = NOW - daysAgo * DAY
  return {
    id: `h${n++}`,
    locationId: loc,
    startedAt: at,
    endedAt: at + 3_600_000,
    name: 'Lift',
    exercises: [{ exerciseId: ex, sets: [{ kg, unit: 'kg', reps: 8, rpe: 8, at }, { kg, unit: 'kg', reps: 8, rpe: 8, at: at + 60_000 }] }],
  } as unknown as GymSession
}

describe('the heaviest load is compared where it can be', () => {
  it('uses the current machine for the player and never declares a stall from gyms with different stacks', () => {
    const id = 'machine-chest-press'
    const logs = [gs('B', 12, id, 90), gs('A', 8, id, 50), gs('A', 4, id, 50), gs('B', 1, id, 60)]
    expect(gymRecords(logs, 'A')[id].bestE1rm?.locationId).toBe('A')
    expect(liftTrend(logs, id, NOW, 'A')).toEqual({ status: 'unknown', sessions: 2 })
    expect(liftTrend(logs, id, NOW)).toEqual({ status: 'unknown', sessions: 2 })
  })
  it('a machine at another gym never sets the heaviest of the one used now', () => {
    const records = gymRecords([gs('B', 7, 'machine-chest-press', 90), gs('A', 1, 'machine-chest-press', 50)])
    expect(records['machine-chest-press'].heaviest?.kg).toBe(50)
  })

  it('a free weight carries across gyms', () => {
    const records = gymRecords([gs('B', 7, 'bench-press', 70), gs('A', 1, 'bench-press', 60)])
    expect(records['bench-press'].heaviest?.kg).toBe(70)
  })
})
