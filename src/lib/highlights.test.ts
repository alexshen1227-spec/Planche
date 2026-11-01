import { describe, expect, it } from 'vitest'
import type { Session, SetLog } from '../types'
import { milestoneClips, planMilestonePins } from './highlights'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 1, 12)

function tuck(value: number, daysAgo: number, clipKey: string | undefined, verified: boolean): SetLog {
  return {
    exerciseId: 'tuck-planche',
    kind: 'hold',
    value,
    target: value,
    section: 'main',
    surface: 'parallettes',
    at: NOW - daysAgo * DAY,
    ...(clipKey ? { clipKey } : {}),
    ...(verified
      ? {
          form: {
            rating: 'clean' as const,
            confirmed: true,
            flightConfirmed: true,
            auto: { issues: [], heldIssues: [], confidence: 0.9, cleanSeconds: value, cleanRatio: 1 },
          },
        }
      : {}),
  }
}

const session = (sets: SetLog[]): Session => ({
  id: `s${sets[0].at}`,
  startedAt: sets[0].at,
  endedAt: sets[0].at + 1_800_000,
  workoutName: 'Training Day',
  workoutKind: 'auto',
  stepId: 'tuck',
  sets,
})

describe('milestone clips', () => {
  it('keeps where you started and your best verified hold, per step', () => {
    const read = (set: SetLog): SetLog => ({ ...set, form: { rating: 'slipped', auto: { issues: ['lean'], confidence: 0.8, cleanSeconds: 1, cleanRatio: 0.3 } } })
    const sessions = [
      // Filmed, but the camera could not read it: nothing to watch.
      session([tuck(3, 70, 'refused', false)]),
      session([tuck(3, 60, undefined, false), read(tuck(4, 60, 'first', false))]),
      session([tuck(9, 30, 'nine', true)]),
      // Longest on the stopwatch, but unverified: not the best verified hold.
      session([tuck(15, 10, 'fifteen-unverified', false), tuck(12, 10, 'twelve', true)]),
    ]
    expect(milestoneClips({ sessions })).toEqual([
      { stepId: 'tuck', kind: 'first', clipKey: 'first', value: 4, at: NOW - 60 * DAY },
      { stepId: 'tuck', kind: 'best', clipKey: 'twelve', value: 12, at: NOW - 10 * DAY },
    ])
  })

  it('falls back to the first filmed hold when the camera read none of them', () => {
    const sessions = [session([tuck(3, 20, 'a', false)]), session([tuck(5, 10, 'b', false)])]
    expect(milestoneClips({ sessions })).toEqual([{ stepId: 'tuck', kind: 'first', clipKey: 'a', value: 3, at: NOW - 20 * DAY }])
  })

  it('names one clip once when the first filmed hold is also the best', () => {
    const sessions = [session([tuck(8, 5, 'only', true)])]
    expect(milestoneClips({ sessions })).toEqual([{ stepId: 'tuck', kind: 'first', clipKey: 'only', value: 8, at: NOW - 5 * DAY }])
  })
})

describe('keeping milestone clips pinned', () => {
  const clip = (key: string, pinned = false) => ({ key, pinned })

  it('pins milestones that are not pinned yet, and remembers them as its own', () => {
    expect(planMilestonePins(['a', 'b'], [], [clip('a'), clip('b')])).toEqual({ pin: ['a', 'b'], unpin: [], ours: ['a', 'b'] })
  })

  it('unpins its own pin once a better hold replaces it, so it ages out normally', () => {
    expect(planMilestonePins(['first', 'new-best'], ['first', 'old-best'], [clip('first', true), clip('old-best', true), clip('new-best')])).toEqual({
      pin: ['new-best'],
      unpin: ['old-best'],
      ours: ['new-best', 'first'],
    })
  })

  it('never touches a pin the athlete set', () => {
    // Pinned by hand: wanted or not, it is not this code's to remove.
    const plan = planMilestonePins(['milestone'], [], [clip('milestone', true), clip('favourite', true)])
    expect(plan.unpin).toEqual([])
    expect(plan.ours).toEqual([])
  })

  it('leaves alone a milestone the athlete unpinned by hand', () => {
    const plan = planMilestonePins(['first'], ['first'], [clip('first', false)], ['first'])
    expect(plan.pin).toEqual([])
    expect(plan.ours).toEqual([])
  })

  it('skips milestones whose footage is already gone', () => {
    expect(planMilestonePins(['deleted'], ['deleted'], [])).toEqual({ pin: [], unpin: [], ours: [] })
  })
})
