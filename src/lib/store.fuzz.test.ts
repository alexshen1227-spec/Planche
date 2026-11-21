import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppState, EquipmentId, SkillId } from '../types'
import { SKILL_IDS } from '../types'
import { EXERCISE_BY_ID } from '../data/exercises'
import { STEP_BY_ID, skillOfStep, stepsOf } from '../data/progressions'
import { ownsKit, SKILLS } from '../data/skills'
import { finalizeFromPlan, planForToday } from '../data/workouts'
import { readJourney } from './journey'
import { ladderStatus } from './repLadder'
import { sessionFromWorkout, startingState } from './skillLoop'
import { activeSkills, hasTrack, stepOfSkill, trackOf, trackedSkills } from './skills'
import { normalizeState, rebuildDerivedState, reducer } from './store'

/**
 * The store, driven the way a restless athlete would drive it: train, add a
 * skill, reorder, drop one, bring it back, delete a session, change the kit,
 * change the session length, export and re-import — in any order, for weeks.
 *
 * Everything an athlete has is this one object, replayed from its sessions.
 * So after every single action the same few things must hold: the roads are
 * coherent, replaying the history gives the athlete that is already on screen,
 * a save file reads back as itself, and today's session can still be built.
 */

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DAY = 86_400_000
const KIT: EquipmentId[] = ['parallettes', 'pullup-bar', 'wall', 'pole', 'band', 'box', 'dip-bars']

interface Trace {
  tag: string
  /** The state after each action, with what the action was. */
  steps: { action: string; at: number; state: AppState }[]
}

const traces: Trace[] = []

/** What a road looks like from outside: where the athlete is, and what is open. */
const roads = (state: AppState) =>
  Object.fromEntries(trackedSkills(state).map((skill) => [skill, { at: stepOfSkill(state, skill), open: [...trackOf(state, skill).unlocked].sort() }]))

beforeAll(() => {
  vi.useFakeTimers()
  for (let seed = 1; seed <= 60; seed++) {
    const r = rng(seed * 7919)
    const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
    const shuffled = <T,>(xs: T[]) => [...xs].sort(() => r() - 0.5)
    const skills = shuffled([...SKILL_IDS]).slice(0, 1 + Math.floor(r() * 3)) as SkillId[]
    let clock = new Date(2026, 0, 5, 18, 0).getTime()
    vi.setSystemTime(clock)
    let state = startingState({
      skills,
      equipment: ['floor', ...KIT.filter(() => r() < 0.75)],
      sessionMinutes: pick([20, 30, 45, 60]),
    })
    // What the athlete can hold, per movement: comfortably above a step's opening dose, and growing.
    const capacity = new Map<string, number>()
    const capOf = (exerciseId: string) => {
      if (!capacity.has(exerciseId)) {
        const step = Object.values(STEP_BY_ID).find((candidate) => candidate.keyExerciseId === exerciseId)
        capacity.set(exerciseId, step ? step.startSec * 1.6 : 30)
      }
      return capacity.get(exerciseId)!
    }
    const trace: Trace = { tag: `seed ${seed} starting [${skills.join(', ')}]`, steps: [] }
    const actions = 10 + Math.floor(r() * 14)
    for (let n = 0; n < actions; n++) {
      vi.setSystemTime(clock)
      const roll = r()
      const active = activeSkills(state)
      let action = 'train'
      if (roll < 0.5) {
        const plan = planForToday(state, clock)
        const { workout, lineup } = finalizeFromPlan(state, { source: 'auto' }, plan, clock)
        const session = sessionFromWorkout(state, workout, lineup, clock, `fuzz-${seed}-${n}`, capOf)
        state = reducer(state, { type: 'SAVE_SESSION', session })
        for (const [id, seconds] of capacity) capacity.set(id, seconds + 0.4)
        action = `train (${workout.name})`
        clock += (1 + Math.floor(r() * 3)) * DAY
      } else if (roll < 0.62) {
        const absent = SKILL_IDS.filter((skill) => !active.includes(skill))
        if (absent.length) {
          const skill = pick(absent)
          if (skill === 'planche' || hasTrack(state, skill)) {
            // A road trained before is brought back where it was left.
            state = reducer(state, { type: 'SET_SKILLS', skills: [...active, skill] })
            action = `bring back ${skill}`
          } else {
            const stepId = pick(stepsOf(skill)).id
            state = reducer(state, { type: 'ADD_SKILL', skill, stepId })
            action = `add ${skill} at ${stepId}`
          }
        }
      } else if (roll < 0.72) {
        state = reducer(state, { type: 'SET_SKILLS', skills: shuffled(active) })
        action = 'reorder'
      } else if (roll < 0.8) {
        if (active.length > 1) {
          const gone = pick(active)
          state = reducer(state, { type: 'SET_SKILLS', skills: active.filter((skill) => skill !== gone) })
          action = `drop ${gone}`
        }
      } else if (roll < 0.87) {
        if (state.sessions.length) {
          const id = pick(state.sessions).id
          state = reducer(state, { type: 'DELETE_SESSION', id })
          action = 'delete a session'
        }
      } else if (roll < 0.93) {
        const item = pick(KIT)
        const has = state.profile.equipment.includes(item)
        const equipment = has ? state.profile.equipment.filter((id) => id !== item) : [...state.profile.equipment, item]
        state = reducer(state, { type: 'SET_PROFILE', patch: { equipment } })
        action = `${has ? 'lose' : 'gain'} ${item}`
      } else if (roll < 0.96) {
        state = reducer(state, { type: 'SET_SETTINGS', patch: { sessionMinutes: pick([15, 20, 30, 45, 60, 90]) } })
        action = 'change session length'
      } else {
        // Export, then import the file into the same app.
        const file = JSON.parse(JSON.stringify(state)) as unknown
        state = reducer(state, { type: 'IMPORT_REPLACE', state: rebuildDerivedState(normalizeState(file)), expectedRev: state.rev ?? 0 })
        action = 'export and re-import'
      }
      trace.steps.push({ action, at: clock, state })
    }
    traces.push(trace)
  }
}, 600_000)

afterAll(() => vi.useRealTimers())

const each = (check: (state: AppState, where: string, at: number) => void) => {
  for (const trace of traces) {
    trace.steps.forEach((step, i) => check(step.state, `${trace.tag}, after action ${i + 1} (${step.action})`, step.at))
  }
}

describe('the store under any sequence of actions', () => {
  it('exercised every kind of action', () => {
    const seen = new Set(traces.flatMap((trace) => trace.steps.map((step) => step.action.split(' ')[0])))
    for (const kind of ['train', 'add', 'bring', 'reorder', 'drop', 'delete', 'gain', 'lose', 'change', 'export']) {
      expect(seen.has(kind), kind).toBe(true)
    }
    expect(traces.reduce((n, trace) => n + trace.steps.length, 0)).toBeGreaterThan(700)
  })

  it('keeps every road coherent', () => {
    each((state, where) => {
      const active = activeSkills(state)
      expect(active.length, where).toBeGreaterThan(0)
      expect(new Set(active).size, where).toBe(active.length)
      for (const skill of active) {
        if (skill !== 'planche') expect(hasTrack(state, skill), `${where}: ${skill} is trained but has no road`).toBe(true)
      }
      for (const skill of trackedSkills(state)) {
        const track = trackOf(state, skill)
        expect(skillOfStep(track.stepId), `${where}: ${skill} stands on ${track.stepId}`).toBe(skill)
        expect(track.unlocked, `${where}: ${skill} stands on a step it has not opened`).toContain(track.stepId)
        for (const id of track.unlocked) expect(skillOfStep(id), `${where}: ${skill} holds ${id}`).toBe(skill)
        expect(new Set(track.unlocked).size, `${where}: ${skill}`).toBe(track.unlocked.length)
      }
      expect(skillOfStep(state.stepId), where).toBe('planche')
    })
  })

  it('shows the athlete that replaying their history from nothing gives', () => {
    each((state, where) => {
      const replayed = rebuildDerivedState(state)
      expect(roads(replayed), where).toEqual(roads(state))
      expect(Object.keys(replayed.achievements).sort(), where).toEqual(Object.keys(state.achievements).sort())
      expect(Object.keys(replayed.prs).sort(), where).toEqual(Object.keys(state.prs).sort())
    })
  })

  it('reads its own save file back as itself', () => {
    each((state, where) => {
      const read = normalizeState(JSON.parse(JSON.stringify(state)))
      expect(read.sessions.length, where).toBe(state.sessions.length)
      expect(activeSkills(read), where).toEqual(activeSkills(state))
      expect(roads(read), where).toEqual(roads(state))
      expect(read.profile.equipment, where).toEqual(state.profile.equipment)
      // Reading it twice changes nothing more.
      expect(normalizeState(JSON.parse(JSON.stringify(read))), where).toEqual(read)
    })
  })

  it('can always build today’s session, from kit the athlete owns', () => {
    each((state, where, at) => {
      const plan = planForToday(state, at)
      const { workout, lineup } = finalizeFromPlan(state, { source: 'auto' }, plan, at)
      expect(workout.blocks.length, where).toBeGreaterThan(0)
      expect(lineup.length, where).toBeGreaterThan(0)
      for (const entry of lineup) expect(activeSkills(state), `${where}: ${entry.skill} is in the line-up`).toContain(entry.skill)
      for (const block of workout.blocks) {
        const missing = (EXERCISE_BY_ID[block.exerciseId]?.requires ?? []).filter((id) => !ownsKit(state.profile.equipment, id))
        expect(missing, `${where}: ${block.exerciseId}`).toEqual([])
      }
      expect(JSON.stringify([workout.name, workout.focus, workout.purpose, workout.adjustments]), where).not.toMatch(/undefined|NaN|\[object/)
    })
  })

  it('reads every road’s journey and push-up line without tripping', () => {
    each((state, where, at) => {
      for (const skill of activeSkills(state)) {
        const journey = readJourney(state, at, skill)
        expect(journey.totalSessions, `${where}: ${skill}`).toBeLessThanOrEqual(state.sessions.length)
        expect(journey.stops.filter((stop) => stop.current).length, `${where}: ${skill}`).toBe(1)
        const ladder = ladderStatus(state, skill)
        expect(ladder === null, `${where}: ${skill}`).toBe(SKILLS[skill].ladder === undefined)
        if (ladder) {
          expect(ladder.index, `${where}: ${skill}`).toBeGreaterThanOrEqual(ladder.baseIndex)
          expect(ladder.rungs[ladder.index], `${where}: ${skill}`).toBe(ladder.rung)
        }
      }
    })
  })
})
