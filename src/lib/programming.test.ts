import { describe, expect, it } from 'vitest'
import type { AppState, Block, Session, SetLog } from '../types'
import { initialState } from './store'
import { buildPlan } from './coach'
import {
  accessoryProgression,
  estimateMinutes,
  fitToBudget,
  KEY_HOLD_AGGREGATE_SEC,
  mainHoldSets,
  restAfterHold,
  todaysSession,
} from '../data/workouts'
import { PRESS_AT_LEVEL_SHARE, PRESS_LADDER, PUSHUP_VERSION, pressingChoiceFor } from '../data/pressing'
import { EXERCISE_BY_ID } from '../data/exercises'
import { STEPS, STEP_BY_ID } from '../data/progressions'

/**
 * The 2026-11 programming upgrade: a complete session at every level (key
 * hold, its push-up version, pseudo planche push-ups, leans, core), sets that
 * scale with hold length, accessories that progress, and a trimmer that gives
 * up generic work before the strength work. Decisions are asserted, not copy.
 */

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 1, 12)

function athlete(stepId: AppState['stepId'], overrides: Partial<AppState> = {}): AppState {
  const base = initialState()
  return {
    ...base,
    onboarded: true,
    stepId,
    baseStepId: stepId,
    unlocked: STEPS.filter((s) => s.order <= STEP_BY_ID[stepId].order).map((s) => s.id),
    ...overrides,
    profile: { ...base.profile, equipment: ['floor', 'parallettes'], ...overrides.profile },
    settings: { ...base.settings, ...overrides.settings },
  }
}

function session(sets: Partial<SetLog>[], daysAgo: number, stepId: AppState['stepId'] = 'tuck'): Session {
  const at = NOW - daysAgo * DAY
  return {
    id: `s-${daysAgo}-${Math.random()}`,
    startedAt: at,
    endedAt: at + 40 * 60_000,
    workoutName: 'Training Day',
    workoutKind: 'auto',
    stepId,
    sets: sets.map((s, i) => ({
      exerciseId: 'pppu',
      kind: 'reps',
      value: 6,
      target: 6,
      section: 'strength',
      at: at + i * 60_000,
      ...s,
    })) as SetLog[],
  }
}

describe('the push-up version of every step', () => {
  it('has a pressing twin for every step on the road, and every twin is a real rep exercise', () => {
    for (const step of STEPS) {
      const id = PUSHUP_VERSION[step.id]
      expect(EXERCISE_BY_ID[id]?.type).toBe('reps')
      expect(PRESS_LADDER).toContain(id)
    }
  })

  it('presses one step behind until the hold reaches half its bar, then at level', () => {
    for (const stepId of ['tuck', 'advtuck', 'straddle', 'full'] as const) {
      const bar = STEP_BY_ID[stepId].unlockSec * PRESS_AT_LEVEL_SHARE
      const behind = pressingChoiceFor(stepId, bar - 0.5)
      const level = pressingChoiceFor(stepId, bar)
      const unknown = pressingChoiceFor(stepId, undefined)
      expect(level.atLevel).toBe(true)
      expect(level.exerciseId).toBe(PUSHUP_VERSION[stepId])
      expect(behind.atLevel).toBe(false)
      expect(unknown.atLevel).toBe(false)
      expect(PRESS_LADDER.indexOf(behind.exerciseId)).toBeLessThan(PRESS_LADDER.indexOf(level.exerciseId))
    }
  })

  it('never asks for a press that needs parallettes the athlete does not own', () => {
    const floorOnly = athlete('advtuck', {
      profile: { equipment: ['floor'] } as AppState['profile'],
      settings: { sessionMinutes: 90 } as AppState['settings'],
    })
    const workout = todaysSession(floorOnly, buildPlan(floorOnly, NOW))
    const press = workout.blocks.find((b) => b.role === 'press')!
    expect((EXERCISE_BY_ID[press.exerciseId].requires ?? []).every((id) => floorOnly.profile.equipment.includes(id))).toBe(true)
  })

  it('steps a planche push-up down to the pseudo planche push-up on a joint-complaint day', () => {
    const strong = athlete('tuck', {
      settings: { sessionMinutes: 90 } as AppState['settings'],
      sessions: [
        session([{ exerciseId: 'tuck-planche', kind: 'hold', value: 12, target: 8, section: 'main', surface: 'parallettes' }], 3),
      ],
    })
    const normal = todaysSession(strong, { ...buildPlan(strong, NOW), strategy: 'balanced' })
    expect(normal.blocks.find((b) => b.role === 'press')!.exerciseId).toBe('tuck-planche-pushup')
    const niggle = buildPlan(strong, NOW, { joints: 'niggle', energy: 'ok', at: NOW, regions: ['wrist'] })
    expect(niggle.loadPermission).toBe('reduced')
    const eased = todaysSession(strong, niggle)
    expect(eased.blocks.find((b) => b.role === 'press')!.exerciseId).toBe('pppu')
    expect(eased.blocks.some((b) => b.exerciseId === 'tuck-planche-pushup')).toBe(false)
  })

  it('prescribes the band-assisted straddle at the straddle once the kit is there', () => {
    const banded = athlete('straddle', {
      profile: { equipment: ['floor', 'parallettes', 'band', 'pullup-bar'] } as AppState['profile'],
      settings: { sessionMinutes: 90 } as AppState['settings'],
    })
    const plain = athlete('straddle', { settings: { sessionMinutes: 90 } as AppState['settings'] })
    const withBand = todaysSession(banded, { ...buildPlan(banded, NOW), strategy: 'balanced' })
    const without = todaysSession(plain, { ...buildPlan(plain, NOW), strategy: 'balanced' })
    expect(withBand.blocks.some((b) => b.exerciseId === 'band-straddle-planche' && b.role === 'assisted')).toBe(true)
    expect(without.blocks.some((b) => b.exerciseId === 'band-straddle-planche')).toBe(false)
  })
})

describe('soft elbows get lockout work, not more bent-arm pressing', () => {
  it('turns a recurring camera arm fault into an extra locked-lean set', () => {
    const armFault = (daysAgo: number) =>
      session(
        [0, 1, 2].map(() => ({
          exerciseId: 'tuck-planche',
          kind: 'hold' as const,
          value: 8,
          target: 6,
          section: 'main' as const,
          surface: 'parallettes' as const,
          form: {
            rating: 'slipped' as const,
            confirmed: true,
            issues: ['arms' as const],
            auto: { issues: ['arms' as const], heldIssues: ['arms' as const], confidence: 0.9, cleanSeconds: 0, cleanRatio: 0 },
          },
        })),
        daysAgo,
      )
    const state = athlete('tuck', {
      settings: { sessionMinutes: 90 } as AppState['settings'],
      sessions: [armFault(9), armFault(6), armFault(3)],
    })
    const plan = buildPlan(state, NOW)
    expect(plan.limiter?.label).toBe('Straight-arm strength')
    expect(plan.accessoryEmphasis).toBe('lockout')
    const workout = todaysSession(state, { ...plan, strategy: 'balanced', dayType: 'build' })
    const lean = workout.blocks.find((b) => b.exerciseId === 'planche-lean' && b.section === 'strength')!
    expect(lean.emphasis).toBe(true)
    expect(lean.sets).toBeGreaterThanOrEqual(4)
    // No extra pike push-ups for a lockout limiter.
    expect(workout.blocks.filter((b) => b.exerciseId === 'pike-pushup' && b.emphasis)).toHaveLength(0)
  })

  it('keeps that work on the plan the coach actually builds, not only on a hand-picked one', () => {
    // The test above pins strategy and day type. The real plan for this same
    // athlete is a form-repair technique day — the camera verified none of
    // their recent holds — and technique days used to drop every lean and
    // press, so the lockout work never reached the athlete it was built for.
    const armFault = (daysAgo: number) =>
      session(
        [0, 1, 2].map(() => ({
          exerciseId: 'tuck-planche',
          kind: 'hold' as const,
          value: 8,
          target: 6,
          section: 'main' as const,
          surface: 'parallettes' as const,
          form: {
            rating: 'slipped' as const,
            confirmed: true,
            issues: ['arms' as const],
            auto: { issues: ['arms' as const], heldIssues: ['arms' as const], confidence: 0.9, cleanSeconds: 0, cleanRatio: 0 },
          },
        })),
        daysAgo,
      )
    const state = athlete('tuck', {
      settings: { sessionMinutes: 90 } as AppState['settings'],
      sessions: [armFault(9), armFault(6), armFault(3)],
    })
    const plan = buildPlan(state, NOW)
    expect(plan.strategy).toBe('technique')
    expect(plan.dayType === 'technique' || plan.dayType === 'deload').toBe(false)
    const workout = todaysSession(state, plan)
    const lean = workout.blocks.find((b) => b.exerciseId === 'planche-lean' && b.section === 'strength')!
    expect(lean.emphasis).toBe(true)
    expect(lean.sets).toBeGreaterThanOrEqual(4)
    expect(workout.blocks.some((b) => b.role === 'press')).toBe(true)
    expect(workout.blocks.some((b) => b.role === 'pressing')).toBe(true)
    // Not a fatigue day, so nothing is lightened...
    expect(workout.blocks.some((b) => b.light)).toBe(false)
    // ...but the key hold is still eased, and the next shape waits.
    expect(workout.blocks.some((b) => b.role === 'bridge')).toBe(false)
  })
})

describe('a fatigue day keeps the session’s shape at a light dose', () => {
  const pppu = (value: number, target: number, extra: Partial<SetLog> = {}) => ({
    exerciseId: 'pppu',
    kind: 'reps' as const,
    value,
    target,
    section: 'strength' as const,
    ...extra,
  })

  it('presses once, lighter, after an RPE 9 session yesterday', () => {
    const yesterday = {
      ...session(
        [
          ...[0, 1, 2, 3].map(() => ({ exerciseId: 'tuck-planche', kind: 'hold' as const, value: 8, target: 8, section: 'main' as const, surface: 'parallettes' as const })),
          pppu(8, 8),
          pppu(8, 8),
          pppu(8, 8),
        ],
        1,
      ),
      rpe: 9,
    }
    const state = athlete('tuck', { settings: { sessionMinutes: 90 } as AppState['settings'], sessions: [yesterday] })
    const plan = buildPlan(state, NOW)
    expect(plan.dayType).toBe('technique')
    const workout = todaysSession(state, plan)
    const press = workout.blocks.find((b) => b.role === 'press')!
    const lean = workout.blocks.find((b) => b.exerciseId === 'planche-lean' && b.section === 'strength')!
    expect(press.light && lean.light).toBe(true)
    expect(press.sets).toBe(2)
    expect(lean.sets).toBe(2)
    expect(workout.blocks.some((b) => b.role === 'pressing')).toBe(false)
    // The light dose is a share of what progression chose (9 after 3×8 hit),
    // never the progression's own next step.
    const pppuBlock = workout.blocks.find((b) => b.exerciseId === 'pppu' && b.section === 'strength')!
    expect(pppuBlock.target).toEqual({ kind: 'reps', reps: Math.round(9 * 0.7) })
  })

  it('steps a planche push-up down to the pseudo planche push-up, and only on the light day', () => {
    // Twelve-second tucks are past half the bar, so a full day presses the
    // tuck planche push-up; the day after an RPE 9 session presses lighter.
    const tucks = (daysAgo: number, rpe: number) => ({
      ...session(
        [0, 1, 2, 3].map(() => ({ exerciseId: 'tuck-planche', kind: 'hold' as const, value: 12, target: 12, section: 'main' as const, surface: 'parallettes' as const })),
        daysAgo,
      ),
      rpe,
    })
    const tired = athlete('tuck', { settings: { sessionMinutes: 90 } as AppState['settings'], sessions: [tucks(1, 9)] })
    const fresh = athlete('tuck', { settings: { sessionMinutes: 90 } as AppState['settings'], sessions: [tucks(3, 7)] })
    const tiredPlan = buildPlan(tired, NOW)
    const freshPlan = buildPlan(fresh, NOW)
    expect(tiredPlan.dayType).toBe('technique')
    expect(freshPlan.dayType === 'technique' || freshPlan.dayType === 'deload').toBe(false)
    expect(todaysSession(fresh, freshPlan).blocks.find((b) => b.role === 'press')!.exerciseId).toBe('tuck-planche-pushup')
    expect(todaysSession(tired, tiredPlan).blocks.find((b) => b.role === 'press')!.exerciseId).toBe('pppu')
  })

  it('keeps a second session on the same day to skill work: no pressing at all', () => {
    // "Today" is the athlete's local calendar day, so both times are local.
    const evening = new Date(2026, 10, 1, 18, 0).getTime()
    const morning = new Date(2026, 10, 1, 9, 0).getTime()
    const earlier = {
      ...session(
        [0, 1, 2, 3].map(() => ({ exerciseId: 'tuck-planche', kind: 'hold' as const, value: 8, target: 8, section: 'main' as const, surface: 'parallettes' as const })),
        0,
      ),
      startedAt: morning,
      endedAt: morning + 40 * 60_000,
      // Hard enough to count as loaded (main planche work at RPE 9).
      rpe: 9,
    }
    earlier.sets = earlier.sets.map((set, i) => ({ ...set, at: morning + i * 60_000 }))
    const state = athlete('tuck', { settings: { sessionMinutes: 90 } as AppState['settings'], sessions: [earlier] })
    const plan = buildPlan(state, evening)
    expect(plan.dayType).toBe('technique')
    expect(plan.signals.daysSinceLoaded).toBe(0)
    const workout = todaysSession(state, plan)
    expect(workout.blocks.some((b) => b.role === 'press' || b.role === 'pressing')).toBe(false)
    expect(workout.blocks.some((b) => b.exerciseId === 'frog-stand' && b.role === 'balance')).toBe(true)
  })

  it('never lets a light day move accessory progression, either way', () => {
    const normal = session([pppu(8, 8), pppu(8, 8), pppu(8, 8)], 6)
    // Every light set hit its easy target: read as capacity, that echoed the
    // light target back and the next full day would ask for 7, not 9.
    const lightHit = session([pppu(6, 6, { light: true }), pppu(6, 6, { light: true })], 2)
    expect(accessoryProgression({ sessions: [normal, lightHit] }, 'pppu', 'reps', NOW)).toMatchObject({ target: 9, change: 'up' })
    // A short light day says nothing about capacity either.
    const lightShort = session([pppu(3, 6, { light: true }), pppu(2, 6, { light: true })], 2)
    expect(accessoryProgression({ sessions: [normal, lightShort] }, 'pppu', 'reps', NOW)).toMatchObject({ target: 9 })
  })
})

describe('main-hold dose', () => {
  it('aims at about a minute of practice in the position, in three to six sets', () => {
    // The fixed four sets gave a 5–10s target 20–40s of practice.
    for (const target of [10, 12, 15, 20]) {
      expect(mainHoldSets(target, 0, 1) * target).toBeGreaterThanOrEqual(KEY_HOLD_AGGREGATE_SEC)
    }
    expect(mainHoldSets(5, 0, 1)).toBe(6)
    expect(mainHoldSets(20, 0, 1)).toBe(3)
    // A short hold is never given fewer sets than a longer one…
    for (let t = 1; t < 30; t++) expect(mainHoldSets(t, 0, 1)).toBeGreaterThanOrEqual(mainHoldSets(t + 1, 0, 1))
    // …and the time practised still grows with the hold.
    expect(mainHoldSets(2, 0, 1) * 2).toBeLessThan(mainHoldSets(8, 0, 1) * 8)
  })

  it('keeps the rails: the volume factor still cuts sets, and the limits hold', () => {
    expect(mainHoldSets(4, 0, 0.5)).toBeLessThan(mainHoldSets(4, 0, 1))
    for (const target of [1, 2, 3, 5, 8, 15, 30]) {
      for (const delta of [-2, 0, 3]) {
        const sets = mainHoldSets(target, delta, 1)
        expect(sets).toBeGreaterThanOrEqual(2)
        expect(sets).toBeLessThanOrEqual(8)
      }
    }
  })

  it('rests less after a very short hold, never below ninety seconds, and fully after a long one', () => {
    expect(restAfterHold(150, 3)).toBeLessThan(150)
    expect(restAfterHold(150, 3)).toBeGreaterThanOrEqual(90)
    expect(restAfterHold(150, 15)).toBe(150)
    expect(restAfterHold(60, 3)).toBe(60)
  })
})

describe('accessory progression', () => {
  it('adds a rep when every set reached its target', () => {
    const state = athlete('tuck', { sessions: [session([{}, {}, {}], 3)] })
    expect(accessoryProgression(state, 'pppu', 'reps', NOW)).toEqual({ target: 7, change: 'up', lastTarget: 6 })
  })

  it('repeats when only some sets reached it, and steps down to what was achieved when most missed', () => {
    const partial = athlete('tuck', { sessions: [session([{ value: 6 }, { value: 6 }, { value: 4 }], 3)] })
    expect(accessoryProgression(partial, 'pppu', 'reps', NOW)?.change).toBe('repeat')
    const missed = athlete('tuck', { sessions: [session([{ value: 4 }, { value: 3 }, { value: 6 }], 3)] })
    expect(accessoryProgression(missed, 'pppu', 'reps', NOW)).toEqual({ target: 4, change: 'down', lastTarget: 6 })
  })

  it('does not ratchet a completed hold downward session after session', () => {
    // The echo it replaced: a logged best equal to the target became 60% of
    // itself next time, so 30s → 18s → 11s for an athlete doing everything asked.
    let state = athlete('tuck')
    let target = 30
    for (let i = 0; i < 4; i++) {
      state = {
        ...state,
        sessions: [
          ...state.sessions,
          session(
            [0, 1].map(() => ({ exerciseId: 'hollow-hold', kind: 'hold' as const, value: target, target, section: 'core' as const })),
            20 - i * 5,
          ),
        ],
      }
      const next = accessoryProgression(state, 'hollow-hold', 'hold', NOW - (20 - i * 5 - 1) * DAY)!
      expect(next.target).toBeGreaterThanOrEqual(target)
      target = next.target
    }
  })

  it('ignores interrupted and assisted attempts, and stops at the ceiling', () => {
    const interrupted = athlete('tuck', {
      sessions: [session([{ value: 1, endReason: 'interruption' }, { value: 6 }], 3)],
    })
    expect(accessoryProgression(interrupted, 'pppu', 'reps', NOW)?.change).toBe('up')
    const capped = athlete('tuck', { sessions: [session([{ value: 12, target: 12 }, { value: 12, target: 12 }], 3)] })
    expect(accessoryProgression(capped, 'pppu', 'reps', NOW)?.target).toBe(12)
  })
})

describe('trimming to a time budget', () => {
  const block = (exerciseId: string, role: Block['role'], sets = 3, extra: Partial<Block> = {}): Block => {
    const ex = EXERCISE_BY_ID[exerciseId]
    return {
      exerciseId,
      sets,
      target: ex.type === 'hold' ? { kind: 'hold', sec: 10 } : { kind: 'reps', reps: 6 },
      restSec: 90,
      section: role === 'skill' ? 'main' : role === 'core' ? 'core' : 'strength',
      role,
      ...extra,
    }
  }
  const full = [
    block('tuck-planche', 'skill', 5),
    block('tuck-planche-pushup', 'press'),
    block('pppu', 'pressing'),
    block('planche-lean', 'straight-arm'),
    block('hollow-hold', 'core', 2),
    block('l-sit', 'core', 2),
  ]

  it('gives up core before the strength work, and the strength work before main sets', () => {
    // A budget that only fits the key hold and the press at two sets: every
    // other block has to go, and the press must be the one that stays.
    const budget = estimateMinutes([full[0], { ...full[1], sets: 2 }]) + 1
    const { blocks, dropped } = fitToBudget(full, budget)
    const ids = blocks.map((b) => b.exerciseId)
    expect(ids).toContain('tuck-planche-pushup')
    expect(ids).not.toContain('hollow-hold')
    expect(dropped).toEqual(expect.arrayContaining(['l-sit', 'hollow-hold', 'planche-lean', 'pppu']))
    expect(blocks.find((b) => b.role === 'skill')!.sets).toBe(5)
    // And with a little more room, the core goes before any strength block.
    const roomier = fitToBudget(full, estimateMinutes(full) - 3)
    if (roomier.dropped.some((id) => id === 'tuck-planche-pushup' || id === 'pppu' || id === 'planche-lean')) {
      expect(roomier.dropped).toContain('hollow-hold')
    }
  })

  it('gives up the key hold’s reach toward a minute before any strength block, and only the reach', () => {
    // Six sets, two of them reach: a budget that fits four sets and the
    // strength work at two sets each keeps the press and the leans, not the
    // extra sets (accessories go to two sets first, as documented).
    const reaching = [{ ...full[0], sets: 6, reach: 2 }, ...full.slice(1)]
    const budget = estimateMinutes([{ ...full[0], sets: 4 }, ...full.slice(1, 4).map((b) => ({ ...b, sets: 2 }))]) + 1
    const { blocks, dropped } = fitToBudget(reaching, budget)
    expect(blocks.find((b) => b.role === 'skill')!.sets).toBe(4)
    for (const id of ['tuck-planche-pushup', 'pppu', 'planche-lean']) expect(dropped).not.toContain(id)
    // With no time at all, the kept dose still goes last, as before.
    expect(fitToBudget(reaching, 1).blocks.find((b) => b.role === 'skill')!.sets).toBe(3)
  })

  it('keeps the main sets intact until every accessory is gone', () => {
    const { blocks } = fitToBudget(full, 1)
    expect(blocks.filter((b) => b.role !== 'skill')).toHaveLength(0)
    expect(blocks.find((b) => b.role === 'skill')!.sets).toBe(3)
  })

  it('keeps the coach’s limiter work longer than default accessories', () => {
    const withLimiter = [...full.slice(0, 4), block('scap-pushup', 'straight-arm', 4, { emphasis: true })]
    const minutes = estimateMinutes(withLimiter)
    const { blocks } = fitToBudget(withLimiter, minutes - 8)
    expect(blocks.some((b) => b.exerciseId === 'scap-pushup')).toBe(true)
  })

  it('says what a short budget left out, and never describes a block it removed', () => {
    const tight = athlete('tuck', {
      settings: { sessionMinutes: 20 } as AppState['settings'],
      sessions: [session([{}, {}, {}], 3)],
    })
    const workout = todaysSession(tight, buildPlan(tight, NOW))
    const present = new Set(workout.blocks.filter((b) => b.section !== 'warmup').map((b) => b.exerciseId))
    const lines = workout.adjustments ?? []
    expect(lines.some((line) => /^Left out to fit/.test(line))).toBe(true)
    for (const line of lines) {
      if (/up to|at \d|set to|swapped/.test(line) && /Pseudo Planche Push-Up/.test(line)) {
        expect(present.has('pppu')).toBe(true)
      }
    }
  })
})
